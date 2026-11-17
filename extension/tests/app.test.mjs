// The page itself (src/app.js, shared by the hosted app and the side panel), mounted in a test
// DOM and clicked: strict mode with no model, the busy line, Try again, Switch to Auto, and
// that no address or raw error is ever on screen. Built during #BuildHybridAI 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ORDERS, fakeSdk, noLeakText } from "./helpers.mjs";
import * as H from "../src/lib/hybrid.js";

globalThis.self = globalThis;
// The app polls the model status every 5 s; do not let that timer keep the test process alive.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const t = realSetInterval(...args); t.unref?.(); return t; };
const fetched = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { fetched.push(String(url?.url || url)); return new Response("{}", { status: 500 }); };
const { createApp } = await import("../src/app.js");
const { configureAI } = await import("../src/ai.js");
// Invented config, no real project or key. Only matters to code that ignores the injected model caller.
configureAI({ firebaseConfig: { apiKey: "test-key-not-real", projectId: "test-project", appId: "1:1:web:test" }, appCheck: { kind: "debug", getToken: async () => "" } });

function mount(sdk, { sleep } = {}) {
  const { document } = parseHTML("<!doctype html><html><body><div id='tt-app'></div></body></html>");
  const root = document.getElementById("tt-app");
  const waits = [];
  const ai = { runPrompt: H.makeRunPrompt?.({ getModel: sdk.getModel, hasDeviceApi: sdk.hasDeviceApi, deviceStatus: sdk.deviceStatus }), deviceStatus: sdk.deviceStatus, downloadDeviceModel: async () => "unavailable" };
  const app = createApp(root, { ai, sleep: sleep || (async (ms) => { waits.push([ms, root.querySelector("#tidy-msg").textContent]); }) });
  const $ = (id) => root.querySelector("#" + id);
  const pick = (value) => { for (const r of root.querySelectorAll("input[name=pref]")) { if (r.value === value) r.setAttribute("checked", ""); else r.removeAttribute("checked"); } };
  const idle = async () => { for (let i = 0; i < 200 && app.state.busy; i++) await new Promise((r) => setTimeout(r, 2)); await new Promise((r) => setTimeout(r, 2)); };
  const click = async (id) => { $(id).dispatchEvent(new document.defaultView.Event("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); await idle(); };
  const seen = () => root.querySelector("#step-result").textContent.replace(/\s+/g, " ") + " " + $("tidy-msg").textContent;
  return { app, root, $, pick, click, seen, waits };
}

test("page: On device only with no model object says so in a plain sentence, offers the two choices, sends nothing", async () => {
  fetched.length = 0;
  const sdk = fakeSdk({ api: "none" });
  const m = mount(sdk);
  m.app.setTable(ORDERS());
  m.pick("device");
  await m.click("tidy");
  assert.equal(sdk.cloudCalls.length, 0, "calls to the cloud model");
  assert.equal(fetched.length, 0, `fetch was called: ${fetched[0]?.replace(/\?.*/, "")}`);
  assert.equal(m.$("badge").textContent, "Device rules", "the badge names no model answer");
  assert.equal(m.$("run-notice").textContent, "This browser has no built-in model that is ready, so On device only did not run and nothing was sent.");
  assert.equal(m.$("run-choices").textContent, "Switch to Auto, or open this page in a browser that has Chrome's built-in model (Gemini Nano) ready.");
  assert.equal(m.$("run-error").hidden, false);
  assert.equal(m.$("run-auto").hidden, false);
  assert.equal(m.$("run-retry").hidden, true);
  assert.equal(m.$("sent").textContent, "Nothing was sent to any model on this run.");
  assert.ok(noLeakText(m.seen()), m.seen());
  // The offered choice: Switch to Auto selects Auto and waits for the person to press Tidy columns.
  await m.click("run-auto");
  assert.equal(m.root.querySelector("input[name=pref][value=auto]").checked, true); // the test DOM has no radio groups; the browser click-through checks the real one
  assert.equal(m.$("tidy-msg").textContent, "Auto is selected. Press Tidy columns to run it.");
  assert.equal(sdk.cloudCalls.length, 0, "switching does not run anything by itself");
  m.app.destroy();
});

test("page: a busy cloud model shows the retry line, then one plain sentence with Try again; no address, no 'Error fetching'", async () => {
  const sdk = fakeSdk({ api: "none", cloud: [500, 500, 500, "ok"] });
  const m = mount(sdk);
  m.app.setTable(ORDERS());
  m.pick("cloud");
  await m.click("tidy");
  assert.deepEqual(m.waits, [[1000, "The cloud model is busy. Trying again (2 of 3)."], [3000, "The cloud model is busy. Trying again (3 of 3)."]]);
  assert.equal(sdk.cloudCalls.length, 3);
  assert.equal(m.$("badge").textContent, "Device rules");
  assert.equal(m.$("run-notice").textContent, "The cloud model was busy on all three tries, so the columns below come from the rules on this device only.");
  assert.equal(m.$("run-retry").hidden, false);
  assert.equal(m.$("run-retry").textContent, "Try again");
  assert.ok(noLeakText(m.seen()), m.seen());
  assert.ok(!m.seen().includes("No model answer was used"));
  await m.click("run-retry"); // the fourth call answers
  assert.equal(sdk.cloudCalls.length, 4);
  assert.equal(m.$("badge").textContent, "Cloud");
  assert.equal(m.$("run-error").hidden, true);
  m.app.destroy();
});

test("page: a 4xx shows its own sentence and no Try again; switching to On device only mid-run throws the answer away", async () => {
  const sdk = fakeSdk({ api: "none", cloud: [403] });
  const m = mount(sdk);
  m.app.setTable(ORDERS());
  m.pick("auto");
  await m.click("tidy");
  assert.equal(sdk.cloudCalls.length, 1);
  assert.equal(m.$("run-notice").textContent, H.MESSAGES.refusedCheck);
  assert.equal(m.$("run-retry").hidden, true);
  assert.ok(noLeakText(m.seen()), m.seen());
  m.app.destroy();

  const sdk2 = fakeSdk({ api: "none", cloud: [500, "ok"] });
  let m2;
  m2 = mount(sdk2, { sleep: async () => { m2.pick("device"); } }); // the person clicks On device only during the wait
  m2.app.setTable(ORDERS());
  m2.pick("auto");
  await m2.click("tidy");
  assert.equal(sdk2.cloudCalls.length, 1, "no second try after the switch");
  assert.equal(m2.$("badge").textContent, "Device rules");
  assert.equal(m2.$("run-notice").textContent, H.MESSAGES.strictSwitched);
  m2.app.destroy();
});

test.after(() => { globalThis.fetch = realFetch; });

test("page: On device only with a thrown-away answer that was not from this device does not say that no table data left", async () => {
  // An invented SDK that passes the guard and still answers from the cloud. The SDK in the build cannot do this.
  const answer = JSON.stringify({ title: "Tidy", columns: Array.from({ length: 6 }, (_, i) => ({ index: i, name: `Col ${i}`, type: "text", personalData: false })) });
  for (const told of ["in_cloud", "somewhere_new"]) {
    const sdk = { hasDeviceApi: () => true, deviceStatus: async () => "available", getModel: async () => ({ chromeAdapter: {}, generateContent: async () => ({ response: { text: () => answer, inferenceSource: told } }) }) };
    const m = mount(sdk);
    m.app.setTable(ORDERS());
    m.pick("device");
    await m.click("tidy");
    assert.equal(m.$("badge").textContent, "Device rules", told);
    assert.equal(m.$("run-notice").textContent, H.MESSAGES.strictDiscarded);
    assert.equal(m.$("sent-note").textContent, "On device only: raw values were used, and this page cannot confirm that this text stayed on this device.");
    assert.ok(!/othing was sent|no table data left/.test(m.seen()), m.seen());
    assert.equal(m.$("run-auto").hidden, false);
    assert.ok(noLeakText(m.seen()), m.seen());
    m.app.destroy();
  }
});
