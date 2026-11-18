// Builder task T8 (Reviewer finding 17 Nov): in Auto, the Firebase AI Logic SDK checks
// LanguageModel.availability() itself before a PREFER_ON_DEVICE call and waits for it with no
// time limit. The page's own check (deviceStatus) gives up after 5 s, but a run that then made a
// PREFER_ON_DEVICE call could still wait forever. runHybrid now makes the first Auto call
// ONLY_IN_CLOUD whenever the status is not "available"; the SDK never asks availability() in that
// mode. Tested on the real module with the real SDK, a spy on fetch and node's mock clock.
// Built during #BuildHybridAI 2026.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { ORDERS, goodAnswer } from "./helpers.mjs";
import * as H from "../src/lib/hybrid.js";
import { route } from "../src/lib/tidy.js";

globalThis.self = globalThis;
const requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url?.url || url), body: typeof init.body === "string" ? init.body : "" });
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: goodAnswer(6) }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
};
const ai = await import("../src/ai.js");
// Invented config: no real project, key or token.
ai.configureAI({ firebaseConfig: { apiKey: "test-key-not-real", projectId: "test-project", appId: "1:1:web:test" }, appCheck: { kind: "debug", getToken: async () => "" } });

const never = () => new Promise(() => {});
const seen = { checks: 0, sessions: 0, prompts: 0 };
/** Put a stand-in LanguageModel object on the global. Its availability() is the check under test. */
function install(availability) {
  seen.checks = 0; seen.sessions = 0; seen.prompts = 0; requests.length = 0;
  globalThis.LanguageModel = {
    availability: (...a) => { seen.checks++; return availability(...a); },
    create: async () => { seen.sessions++; return { prompt: async () => { seen.prompts++; return goodAnswer(6); }, destroy() {} }; },
  };
}
const turn = () => new Promise((r) => setImmediate(r)); // setImmediate is not on the mock clock
function watch(promise) {
  const w = { done: false, value: undefined, error: undefined };
  promise.then((v) => { w.done = true; w.value = v; }, (e) => { w.done = true; w.error = e; });
  return w;
}
/** Move the mock clock forward one second at a time until the promise settles or maxMs has passed. */
async function runClock(w, maxMs = 30000) {
  let ms = 0;
  await turn();
  while (!w.done && ms < maxMs) { mock.timers.tick(1000); ms += 1000; await turn(); await turn(); }
  return ms;
}
/** The prompt text inside a request body sent to the cloud model. */
const promptOf = (req) => JSON.parse(req.body).contents.flatMap((c) => c.parts).map((p) => p.text).join("");
/** The values of the columns the run masked, read from the table itself. */
function maskedValues(table, masked) {
  const idx = masked.map((name) => table.headers.indexOf(name)).filter((i) => i >= 0);
  return table.rows.flatMap((r) => idx.map((i) => r[i])).filter((v) => v && v.length > 3);
}

test.afterEach(() => { mock.timers.reset(); delete globalThis.LanguageModel; });
test.after(() => { globalThis.fetch = realFetch; });

// In node the Firebase AI Logic package loads its node build, which never builds an on-device
// adapter, so it cannot show the wait. This stand-in model follows the browser build
// (@firebase/ai 3.1.0 in firebase 13.3.0, dist/esm/index.esm.js): callCloudOrDevice (line 2561) and ChromeAdapterImpl.isAvailable
// (lines 971-1007), which for every mode but ONLY_IN_CLOUD awaits LanguageModel.availability()
// with no time limit (line 980). Cloud sends are recorded, nothing leaves the process.
function standInSdk() {
  const cloud = [];
  const getModel = async (modeKey) => {
    const LM = globalThis.LanguageModel;
    const chromeAdapter = LM ? {
      mode: modeKey,
      async isAvailable() {
        if (modeKey === "ONLY_IN_CLOUD") return false; // line 976: asks nothing
        const availability = await LM.availability({}); // line 980: no time limit
        if (modeKey === "ONLY_ON_DEVICE") { if (availability === "unavailable") throw new Error("AI: Local LanguageModel API not available in this environment. (AI/api-not-enabled)"); return true; }
        return availability === "available";
      },
    } : undefined;
    const inCloud = async (prompt) => { cloud.push(prompt); return { response: { text: () => goodAnswer(6), inferenceSource: "in_cloud" } }; };
    const onDevice = async (prompt) => { const s = await LM.create({}); const t = await s.prompt(prompt); return { response: { text: () => t, inferenceSource: "on_device" } }; };
    return {
      chromeAdapter,
      async generateContent(prompt) {
        if (!chromeAdapter || modeKey === "ONLY_IN_CLOUD") return inCloud(prompt);
        if (modeKey === "ONLY_ON_DEVICE") { if (await chromeAdapter.isAvailable()) return onDevice(prompt); throw new Error("AI: Inference mode is ONLY_ON_DEVICE, but an on-device model is not available. (AI/unsupported)"); }
        if (modeKey === "PREFER_IN_CLOUD") { try { return await inCloud(prompt); } catch (e) { if (await chromeAdapter.isAvailable()) return onDevice(prompt); throw e; } }
        return (await chromeAdapter.isAvailable()) ? onDevice(prompt) : inCloud(prompt); // PREFER_ON_DEVICE
      },
    };
  };
  // The page's own model caller (makeRunPrompt) and status check (ai.deviceStatus, 5 s), around the stand-in.
  return { cloud, runPrompt: H.makeRunPrompt({ getModel, hasDeviceApi: ai.hasDeviceApi, deviceStatus: ai.deviceStatus }) };
}

test("T8: the stand-in reproduces the finding: a PREFER_ON_DEVICE call waits on availability() with no limit (120 s on the clock, 0 sends)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  install(never);
  const sdk = standInSdk();
  const w = watch(sdk.runPrompt("PREFER_ON_DEVICE", "Person Name, name@example.com"));
  const ms = await runClock(w, 120000);
  assert.equal(w.done, false, "the call is still waiting");
  assert.equal(ms, 120000);
  assert.equal(seen.checks, 1, "the SDK side asked availability() itself");
  assert.equal(sdk.cloud.length, 0);
  assert.equal(requests.length, 0);
  assert.equal(seen.sessions, 0);
});

test("T8 (done test): Auto run, stand-in SDK with an adapter, availability() never answers: ends at 5000 ms with one masked cloud send", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  install(never);
  const sdk = standInSdk();
  const table = ORDERS();
  const w = watch(H.tidyTable(table, "auto", { runPrompt: sdk.runPrompt, deviceStatus: ai.deviceStatus, sleep: async () => {} }));
  const ms = await runClock(w, 120000);
  assert.equal(w.done, true, "the run ended");
  assert.equal(w.error, undefined);
  assert.equal(ms, 5000, "after the page's one 5 s status wait, not later");
  const run = w.value.run;
  assert.equal(run.mask, true);
  assert.deepEqual(run.attempts.map((a) => [a.mode, a.source, a.ok]), [["ONLY_IN_CLOUD", "in_cloud", true]]);
  assert.equal(run.source, "in_cloud");
  assert.equal(run.reason, "Gemini Nano is not ready in this browser (unavailable), cloud fallback");
  assert.equal(sdk.cloud.length, 1, "one cloud send");
  assert.equal(seen.checks, 1, "only the page's own check asked availability()");
  assert.equal(seen.sessions, 0);
  assert.equal(sdk.cloud[0], run.sent, "the send is the prompt shown in What the model saw");
  const values = maskedValues(table, run.masked);
  assert.ok(run.masked.length > 0 && values.length > 0);
  for (const v of values) assert.ok(!sdk.cloud[0].includes(v), `masked value sent: ${v}`);
  // Strict mode with the same stand-in and the same check: ends at 5000 ms, nothing sent.
  install(never);
  const sdk2 = standInSdk();
  const w2 = watch(H.tidyTable(table, "device", { runPrompt: sdk2.runPrompt, deviceStatus: ai.deviceStatus, sleep: async () => {} }));
  assert.equal(await runClock(w2, 120000), 5000);
  assert.equal(w2.value.run.notice, H.MESSAGES.strictNoModel);
  assert.equal(w2.value.run.sent, "");
  assert.equal(sdk2.cloud.length, 0);
  assert.equal(seen.sessions, 0);
});

test("T8: Auto with a ready model still goes through the device first (stand-in, availability() answers \"available\")", async () => {
  install(async () => "available");
  const sdk = standInSdk();
  const out = await H.tidyTable(ORDERS(), "auto", { runPrompt: sdk.runPrompt, deviceStatus: ai.deviceStatus, sleep: async () => {} });
  assert.deepEqual(out.run.attempts.map((a) => [a.mode, a.source, a.ok]), [["PREFER_ON_DEVICE", "on_device", true]]);
  assert.equal(out.run.source, "on_device");
  assert.equal(sdk.cloud.length, 0);
  assert.equal(seen.sessions, 1);
});

test("T8: Auto run with the real Firebase SDK (node build, no on-device adapter) and ai.runPrompt, availability() never answers: ends at 5000 ms with one masked cloud request", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  install(never);
  const table = ORDERS();
  const w = watch(H.tidyTable(table, "auto", { runPrompt: ai.runPrompt, deviceStatus: ai.deviceStatus, sleep: async () => {} }));
  const ms = await runClock(w);
  assert.equal(w.done, true, "the run ended");
  assert.equal(w.error, undefined);
  assert.equal(ms, 5000, "after the page's one 5 s status wait, not later");
  const run = w.value.run;
  assert.equal(run.mask, true, "Auto masks the prompt");
  assert.deepEqual(run.attempts.map((a) => [a.mode, a.source, a.ok]), [["ONLY_IN_CLOUD", "in_cloud", true]]);
  assert.equal(run.source, "in_cloud");
  assert.equal(run.reason, "Gemini Nano is not ready in this browser (unavailable), cloud fallback");
  assert.equal(run.notice, null);
  assert.equal(run.reachedCloud, true);
  assert.equal(requests.length, 1, "one cloud request");
  assert.equal(seen.checks, 1, "only the page's own check asked availability(); the SDK did not");
  assert.equal(seen.sessions, 0, "no on-device session");
  assert.equal(seen.prompts, 0);
  const sent = promptOf(requests[0]);
  assert.equal(sent, run.sent, "the request carries the prompt shown in What the model saw");
  assert.ok(run.masked.length > 0, "the sample has flagged columns");
  const values = maskedValues(table, run.masked);
  assert.ok(values.length > 0);
  for (const v of values) assert.ok(!sent.includes(v), `masked value left the device: ${v}`);
  assert.ok(sent.includes("name@example.com"), "placeholders in place of the flagged values");
});

test("T8: strict run with the same never-answering check still sends nothing (tidyTable \"device\")", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  install(never);
  const w = watch(H.tidyTable(ORDERS(), "device", { runPrompt: ai.runPrompt, deviceStatus: ai.deviceStatus, sleep: async () => {} }));
  const ms = await runClock(w);
  assert.equal(w.done, true);
  assert.equal(ms, 5000);
  assert.equal(w.value.run.notice, H.MESSAGES.strictNoModel);
  assert.equal(w.value.run.action, "auto", "the Switch to Auto button is offered");
  assert.equal(w.value.run.sent, "");
  assert.equal(requests.length, 0);
  assert.equal(seen.sessions, 0);
});

test("T8: Switch to Auto after that strict run (stand-in SDK with an adapter): the Auto run ends at 5000 ms with one masked cloud send", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  install(never);
  const sdk = standInSdk();
  const table = ORDERS();
  const strict = watch(H.tidyTable(table, "device", { runPrompt: sdk.runPrompt, deviceStatus: ai.deviceStatus, sleep: async () => {} }));
  await runClock(strict, 120000);
  assert.equal(strict.value.run.action, "auto", "the Switch to Auto button is offered");
  assert.equal(sdk.cloud.length, 0);
  const auto = watch(H.tidyTable(table, "auto", { runPrompt: sdk.runPrompt, deviceStatus: ai.deviceStatus, sleep: async () => {} }));
  const ms = await runClock(auto, 120000);
  assert.equal(auto.done, true, "the Auto run ended");
  assert.equal(ms, 5000);
  assert.equal(auto.value.run.source, "in_cloud");
  assert.equal(sdk.cloud.length, 1);
  assert.equal(sdk.cloud[0], auto.value.run.sent);
  assert.equal(seen.sessions, 0);
});

test("T8: runHybrid first call per status: only \"available\" keeps PREFER_ON_DEVICE; Cloud and strict plans unchanged", async () => {
  const calls = [];
  const runPrompt = async (mode) => { calls.push(mode); return { text: goodAnswer(3), source: mode === "ONLY_IN_CLOUD" || mode === "PREFER_IN_CLOUD" ? "in_cloud" : "on_device", ms: 1 }; };
  for (const [status, first] of [["available", "PREFER_ON_DEVICE"], ["downloadable", "ONLY_IN_CLOUD"], ["downloading", "ONLY_IN_CLOUD"], ["unavailable", "ONLY_IN_CLOUD"], [undefined, "ONLY_IN_CLOUD"]]) {
    calls.length = 0;
    const r = await H.runHybrid(route(10, 3), "p", { runPrompt, colCount: 3, status });
    assert.deepEqual(calls, [first], `status ${status}`);
    assert.equal(r.answer.columns.length, 3);
    if (first === "ONLY_IN_CLOUD") assert.equal(r.reason, `Gemini Nano is not ready in this browser${status ? ` (${status})` : ""}, cloud fallback`);
  }
  for (const status of ["available", "unavailable", undefined]) {
    calls.length = 0;
    await H.runHybrid(route(10, 3, "cloud"), "p", { runPrompt, colCount: 3, status });
    assert.deepEqual(calls, ["ONLY_IN_CLOUD"], "Cloud setting: ONLY_IN_CLOUD as before");
    calls.length = 0;
    await H.runHybrid(route(5000, 3), "p", { runPrompt, colCount: 3, status });
    assert.deepEqual(calls, ["PREFER_IN_CLOUD"], "large table in Auto: PREFER_IN_CLOUD as before");
    calls.length = 0;
    const s = await H.runHybrid(route(10, 3, "device"), "p", { runPrompt, colCount: 3, status });
    assert.deepEqual(calls, status === "available" ? ["ONLY_ON_DEVICE"] : [], "On device only: device call or nothing");
    if (status !== "available") assert.equal(s.source, "local");
  }
});

test("T8: Auto with no ready model, cloud busy every time: still at most three sends, the busy lines and waits as before", async () => {
  const calls = [], waits = [], lines = [];
  const busy = Object.assign(new Error("[503 ] high demand"), { customErrorData: { status: 503 } });
  const runPrompt = async (mode) => { calls.push(mode); throw busy; };
  const r = await H.runHybrid(route(10, 3), "p", { runPrompt, colCount: 3, status: "unavailable", sleep: async (ms) => { waits.push(ms); }, onRetry: (x) => lines.push(x.text) });
  assert.deepEqual(calls, ["ONLY_IN_CLOUD", "ONLY_IN_CLOUD", "ONLY_IN_CLOUD"]);
  assert.deepEqual(waits, [1000, 3000]);
  assert.deepEqual(lines, ["The cloud model is busy. Trying again (2 of 3).", "The cloud model is busy. Trying again (3 of 3)."]);
  assert.equal(r.source, "local");
  assert.equal(r.notice, H.MESSAGES.busyFinal);
});

test("T8: switching to On device only while the cloud call of a no-model Auto run is out: the answer is thrown away, nothing more sent", async () => {
  let strict = false;
  const calls = [];
  const runPrompt = async (mode) => { calls.push(mode); strict = true; return { text: goodAnswer(3), source: "in_cloud", ms: 1 }; };
  const r = await H.runHybrid(route(10, 3), "p", { runPrompt, colCount: 3, status: "unavailable", isStrict: () => strict });
  assert.deepEqual(calls, ["ONLY_IN_CLOUD"]);
  assert.equal(r.source, "local");
  assert.equal(r.notice, H.MESSAGES.strictSwitched);
});
