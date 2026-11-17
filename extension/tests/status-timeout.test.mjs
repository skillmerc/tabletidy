// Reviewer follow-up T3 (probe P2): a model status check that never answers must not hang the
// run. deviceStatus() in src/ai.js gives up after 5 s and reports "unavailable". Tested on the
// real module with the real Firebase AI Logic SDK, a spy on fetch and node's mock clock, so no
// test waits 5 real seconds. Built during #BuildHybridAI 2026.
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
/** Put a fake LanguageModel object on the global. availability is the function under test. */
function install(availability) {
  seen.checks = 0; seen.sessions = 0; seen.prompts = 0; requests.length = 0;
  globalThis.LanguageModel = {
    availability: (...a) => { seen.checks++; return availability(...a); },
    create: async () => { seen.sessions++; return { prompt: async () => { seen.prompts++; return goodAnswer(6); }, destroy() {} }; },
  };
}
const turn = () => new Promise((r) => setImmediate(r)); // setImmediate is not on the mock clock
/** Follow a promise without waiting for it. */
function watch(promise) {
  const w = { done: false, value: undefined, error: undefined };
  promise.then((v) => { w.done = true; w.value = v; }, (e) => { w.done = true; w.error = e; });
  return w;
}
/** Move the mock clock forward one second at a time until the promise settles or maxMs has passed. */
async function runClock(w, maxMs = 30000) {
  let ms = 0;
  await turn();
  while (!w.done && ms < maxMs) { mock.timers.tick(1000); ms += 1000; await turn(); }
  return ms;
}
const nothingSent = () => { assert.equal(requests.length, 0, "requests"); assert.equal(seen.sessions, 0, "on-device sessions"); assert.equal(seen.prompts, 0, "on-device prompts"); };

test.afterEach(() => { mock.timers.reset(); delete globalThis.LanguageModel; });
test.after(() => { globalThis.fetch = realFetch; });

test("T3: the default wait is 5000 ms", () => {
  assert.equal(ai.STATUS_TIMEOUT_MS, 5000);
});

test("T3: availability() never answers: deviceStatus() gives \"unavailable\" at 5000 ms on the clock, not before", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  install(never);
  const w = watch(ai.deviceStatus());
  await turn();
  mock.timers.tick(4999);
  await turn();
  assert.equal(w.done, false, "still waiting at 4999 ms");
  mock.timers.tick(1);
  await turn();
  assert.equal(w.done, true, "answered at 5000 ms");
  assert.equal(w.value, "unavailable");
  assert.equal(seen.checks, 1);
  nothingSent();
});

test("T3: the wait can be passed in: deviceStatus({ timeoutMs: 30 }) answers \"unavailable\" on the real clock", async () => {
  install(never);
  const t0 = Date.now();
  const s = await Promise.race([ai.deviceStatus({ timeoutMs: 30 }), new Promise((r) => { const t = setTimeout(() => r("still waiting"), 1500); t.unref?.(); })]);
  assert.equal(s, "unavailable");
  assert.ok(Date.now() - t0 < 1000, "well under a second");
  nothingSent();
});

test("T3: an answer in time is returned and its timer is cleared (answer, error, throw)", async () => {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const set = [], cleared = [];
  globalThis.setTimeout = (fn, ms, ...rest) => { const t = realSet(fn, ms, ...rest); set.push({ t, ms }); return t; };
  globalThis.clearTimeout = (t) => { cleared.push(t); return realClear(t); };
  try {
    const cases = [
      [async () => "available", "available"],
      [async () => "downloadable", "downloadable"],
      [async () => "downloading", "downloading"],
      [async () => "no idea", "unavailable"],
      [async () => { throw new Error("status check failed"); }, "unavailable"],
      [() => { throw new Error("status check threw at once"); }, "unavailable"],
    ];
    for (const [availability, want] of cases) {
      set.length = 0; cleared.length = 0;
      install(availability);
      assert.equal(await ai.deviceStatus(), want);
      assert.equal(set.length, 1, "one timer per status check");
      assert.equal(set[0].ms, 5000);
      assert.ok(cleared.includes(set[0].t), `timer cleared after "${want}"`);
    }
    // No model object: no timer at all.
    set.length = 0;
    delete globalThis.LanguageModel;
    assert.equal(await ai.deviceStatus(), "unavailable");
    assert.equal(set.length, 0);
  } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
});

test("T3: an answer or an error that comes after the timeout changes nothing", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    for (const late of ["answer", "error"]) {
      let settle;
      install(() => new Promise((resolve, reject) => { settle = late === "answer" ? () => resolve("available") : () => reject(new Error("late failure")); }));
      const p = ai.deviceStatus();
      const w = watch(p);
      await runClock(w);
      assert.equal(w.value, "unavailable");
      settle();
      await turn(); await turn();
      assert.equal(await p, "unavailable", `still "unavailable" after a late ${late}`);
      nothingSent();
    }
    assert.equal(unhandled.length, 0, "a late error is not left unhandled");
    // The next check starts fresh: a model that answers is seen.
    install(async () => "available");
    assert.equal(await ai.deviceStatus(), "available");
  } finally { process.off("unhandledRejection", onUnhandled); }
});

test("T3: strict run on the page's real path (tidyTable with ai.runPrompt and ai.deviceStatus), availability() never answers: ends with the no-model sentence, nothing sent", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  install(never);
  const table = ORDERS();
  const w = watch(H.tidyTable(table, "device", { runPrompt: ai.runPrompt, deviceStatus: ai.deviceStatus, sleep: async () => {} }));
  const ms = await runClock(w);
  assert.equal(w.done, true, "the run ended");
  assert.equal(w.error, undefined);
  assert.equal(ms, 5000, "after one 5 s wait");
  assert.equal(w.value.run.notice, H.MESSAGES.strictNoModel);
  assert.equal(w.value.run.source, "local");
  assert.equal(w.value.run.reachedCloud, false);
  assert.equal(w.value.run.sent, "");
  nothingSent();
});

test("T3: strict run when the status was \"available\" at the start and the check then stops answering (runHybrid with ai.runPrompt): no-model sentence, nothing sent", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  install(never);
  const table = ORDERS();
  const plan = route(table.rows.length, table.headers.length, "device");
  const w = watch(H.runHybrid(plan, "Thandi Mokoena, thandi@example.com", { runPrompt: ai.runPrompt, colCount: table.headers.length, status: "available", sleep: async () => {} }));
  await runClock(w);
  assert.equal(w.done, true, "the run ended");
  assert.equal(w.error, undefined);
  assert.equal(w.value.notice, H.MESSAGES.strictNoModel);
  assert.equal(w.value.source, "local");
  nothingSent();
  // The model caller alone: refuses with the device-unavailable error, nothing sent.
  install(never);
  const w2 = watch(ai.runPrompt("ONLY_ON_DEVICE", "Thandi Mokoena, thandi@example.com"));
  await runClock(w2);
  assert.equal(w2.error?.code, "DEVICE_UNAVAILABLE");
  nothingSent();
});
