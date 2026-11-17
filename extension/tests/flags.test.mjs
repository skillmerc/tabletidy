// Task T1 (Reviewer finding H, 17 Nov 2026): a column marked Personal on the page, by hand or
// by the model's answer, must be masked on the next run and keep its flag after it.
// Unit tests on tidyTable and page tests on src/app.js in a test DOM. Fakes only: no browser,
// no real cloud call. Built during #BuildHybridAI 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import * as H from "../src/lib/hybrid.js";
import * as T from "../src/lib/tidy.js";
import { ORDERS, fakeSdk, goodAnswer, flaggedValues, sdkError } from "./helpers.mjs";

// Customer orders: Customer, E-mail address, Cell, Town, Ordered, Order total. The device rules
// flag the first three. "Town" is the column they do NOT flag.
const EMAIL = 1, TOWN = 3;
const RULE_MASKED = ["Customer", "E-mail address", "Cell"];
const guarded = (sdk) => H.makeRunPrompt({ getModel: sdk.getModel, hasDeviceApi: sdk.hasDeviceApi, deviceStatus: sdk.deviceStatus });
const noSleep = async () => {};
/** The raw values of one column, one per row (12 for Customer orders). */
const rawOf = (table, i) => table.rows.map((r) => String(r[i] ?? "").trim()).filter((v) => v.length > 2);
/** How many of the raw values are in the text. Probe H counted 12 of 12 on the old code. */
const rawIn = (text, raw) => raw.filter((v) => String(text).includes(v)).length;
/** The flags as the page holds them (state.columns), after one change. */
const pageFlags = (table, change) => { const cols = T.localAnalysis(table.headers, table.rows); change?.(cols); return cols; };
const byHand = (cols, i, on = true) => { cols[i].pii = on; cols[i].piiBy = on ? "you" : null; };
/** An answer in which the model flags the given columns as personal data. */
const answerFlagging = (n, flagged) => JSON.stringify({ title: "Tidy", columns: Array.from({ length: n }, (_, i) => ({ index: i, name: `Col ${i}`, type: "text", personalData: flagged.includes(i) })) });
const everySend = (sdk) => [...sdk.cloudCalls, ...sdk.deviceCalls];

test("the Town column is not flagged by the device rules (so these tests test the hand flag)", () => {
  const table = ORDERS();
  const local = T.localAnalysis(table.headers, table.rows);
  assert.equal(table.headers[TOWN], "Town");
  assert.equal(local[TOWN].pii, false);
  assert.deepEqual(local.filter((c) => c.pii).map((c) => c.original), RULE_MASKED);
  assert.equal(rawOf(table, TOWN).length, 12);
});

const CASES = [
  { name: "Cloud, no model object", pref: "cloud", sdk: { api: "none" }, cloud: 1, device: 0 },
  { name: "Auto, no model object", pref: "auto", sdk: { api: "none" }, cloud: 1, device: 0 },
  { name: "Auto, model downloadable", pref: "auto", sdk: { api: "downloadable" }, cloud: 1, device: 0 },
  { name: "Auto, on-device model answers", pref: "auto", sdk: { api: "available" }, cloud: 0, device: 1 },
  { name: "Auto, on-device answer is garbage, cloud fallback", pref: "auto", sdk: { api: "available", device: "garbage" }, cloud: 1, device: 1 },
  { name: "Cloud, busy twice then an answer (retries)", pref: "cloud", sdk: { api: "none", cloud: [500, 503, "ok"] }, cloud: 3, device: 0 },
  { name: "Auto, busy twice then an answer (retries)", pref: "auto", sdk: { api: "none", cloud: [500, 503, "ok"] }, cloud: 3, device: 0 },
  { name: "Auto, on-device call throws, cloud busy on the two tries that are left (device rules kept)", pref: "auto", sdk: { api: "available", device: "throw", cloud: [500] }, cloud: 2, device: 1, local: true },
];

for (const c of CASES) {
  test(`FINDING H, tidyTable: a column flagged by hand is masked in every send and keeps its flag (${c.name})`, async () => {
    const table = ORDERS();
    const raw = rawOf(table, TOWN);
    const sdk = fakeSdk(c.sdk);
    const out = await H.tidyTable(table, c.pref, { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep, flags: pageFlags(table, (cols) => byHand(cols, TOWN)) });
    assert.equal(sdk.cloudCalls.length, c.cloud, "cloud sends");
    assert.equal(sdk.deviceCalls.length, c.device, "on-device prompts");
    for (const [n, text] of everySend(sdk).entries()) {
      assert.equal(rawIn(text, raw), 0, `send ${n + 1} of ${everySend(sdk).length} holds ${rawIn(text, raw)} of ${raw.length} raw Town values`);
      assert.ok(text.includes("[personal]"), "the placeholder stands in for the Town values");
      assert.ok(text.includes("Town"), "the header still goes, only the values are masked");
      assert.equal(rawIn(text, flaggedValues(table, T.localAnalysis(table.headers, table.rows))), 0, "the columns the device rules flag are still masked");
    }
    assert.equal(rawIn(out.run.sent, raw), 0, "What the model saw holds no raw Town value");
    assert.deepEqual(out.run.masked, [...RULE_MASKED, "Town"], "the run names every column it masked");
    assert.equal(out.run.source, c.local ? "local" : c.cloud && !(c.device && !c.sdk.device) ? "in_cloud" : "on_device");
    assert.equal(out.columns[TOWN].pii, true, "the hand flag is still set after the run");
    assert.equal(out.columns[TOWN].piiBy, "you");
  });
}

test("FINDING H, tidyTable: a column the model flagged on one run is masked on the next run and keeps its flag", async () => {
  const table = ORDERS();
  const raw = rawOf(table, TOWN);
  for (const pref of ["cloud", "auto"]) {
    // Run 1: nothing flagged Town yet. The model's answer flags it.
    const sdk = fakeSdk({ api: "none", cloud: [() => answerFlagging(6, [TOWN]), () => goodAnswer(6)] });
    const first = await H.tidyTable(table, pref, { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep, flags: pageFlags(table) });
    assert.equal(first.columns[TOWN].pii, true);
    assert.equal(first.columns[TOWN].piiBy, "model");
    assert.deepEqual(first.run.masked, RULE_MASKED, "run 1 did not mask Town: no flag existed before the model saw it");
    // Run 2: the page passes the flags it shows. This time the model's answer does NOT flag Town.
    const second = await H.tidyTable(table, pref, { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep, flags: first.columns });
    assert.equal(sdk.cloudCalls.length, 2);
    assert.equal(rawIn(sdk.cloudCalls[1], raw), 0, `the second request holds ${rawIn(sdk.cloudCalls[1], raw)} of ${raw.length} raw Town values`);
    assert.ok(sdk.cloudCalls[1].includes("[personal]"));
    assert.deepEqual(second.run.masked, [...RULE_MASKED, "Town"]);
    assert.equal(second.columns[TOWN].pii, true, "the model flag is kept although the second answer did not repeat it");
    assert.equal(second.columns[TOWN].piiBy, "model");
  }
});

test("the other direction, unchanged: a column the device rules flag is still masked after the person unflags it, and the run flags it again", async () => {
  const table = ORDERS();
  const raw = rawOf(table, EMAIL);
  for (const pref of ["cloud", "auto"]) {
    const sdk = fakeSdk({ api: "none" });
    const out = await H.tidyTable(table, pref, { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep, flags: pageFlags(table, (cols) => byHand(cols, EMAIL, false)) });
    assert.equal(sdk.cloudCalls.length, 1);
    assert.equal(rawIn(sdk.cloudCalls[0], raw), 0, "the rules still mask the column: a hand unflag never sends more");
    assert.ok(sdk.cloudCalls[0].includes("name@example.com"));
    assert.deepEqual(out.run.masked, RULE_MASKED);
    assert.equal(out.columns[EMAIL].pii, true, "after the run the rule flag is back on");
    assert.equal(out.columns[EMAIL].piiBy, "device rules");
  }
});

test("a model flag the person takes off by hand is not masked on the next run (the rules do not flag it, the page does not flag it)", async () => {
  const table = ORDERS();
  const sdk = fakeSdk({ api: "none" });
  const flags = pageFlags(table, (cols) => { cols[TOWN].pii = true; cols[TOWN].piiBy = "model"; byHand(cols, TOWN, false); });
  const out = await H.tidyTable(table, "cloud", { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep, flags });
  assert.equal(rawIn(sdk.cloudCalls[0], rawOf(table, TOWN)), 12, "an unflagged column that the rules do not flag goes as it is, as before");
  assert.deepEqual(out.run.masked, RULE_MASKED);
  assert.equal(out.columns[TOWN].pii, false);
});

test("On device only is unchanged by page flags: nothing is sent without a ready model, no cloud call ever, and the hand flag is kept", async () => {
  const table = ORDERS();
  for (const api of ["none", "legacy", "unavailable", "downloadable", "downloading"]) {
    const sdk = fakeSdk({ api });
    const out = await H.tidyTable(table, "device", { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep, flags: pageFlags(table, (cols) => byHand(cols, TOWN)) });
    assert.equal(everySend(sdk).length, 0, `${api}: nothing may be sent`);
    assert.equal(out.run.sent, "");
    assert.equal(out.run.mask, false);
    assert.deepEqual(out.run.masked, []);
    assert.equal(out.columns[TOWN].pii, true, `${api}: the hand flag is kept`);
    assert.equal(out.columns[TOWN].piiBy, "you");
  }
  // A ready model: one on-device prompt, raw values as before (nothing leaves the device), no cloud call.
  const sdk = fakeSdk({ api: "available" });
  const out = await H.tidyTable(table, "device", { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep, flags: pageFlags(table, (cols) => byHand(cols, TOWN)) });
  assert.equal(sdk.cloudCalls.length, 0);
  assert.equal(sdk.deviceCalls.length, 1);
  assert.equal(out.run.mask, false);
  assert.deepEqual(out.run.masked, []);
  assert.equal(out.run.source, "on_device");
  assert.equal(out.columns[TOWN].pii, true);
  // Auto passed in while the live setting is On device only: still no cloud call.
  const sdk2 = fakeSdk({ api: "none" });
  await H.tidyTable(table, "auto", { runPrompt: guarded(sdk2), deviceStatus: sdk2.deviceStatus, sleep: noSleep, isStrict: () => true, flags: pageFlags(table, (cols) => byHand(cols, TOWN)) });
  assert.equal(everySend(sdk2).length, 0);
});

test("no flags, or flags that are not a usable list, change nothing: the rules alone decide, as before", async () => {
  const table = ORDERS();
  for (const flags of [undefined, null, [], {}, "yes", [null, undefined, 7], [{ index: 99, pii: true }], [{ index: TOWN, pii: "true" }]]) {
    const sdk = fakeSdk({ api: "none" });
    const out = await H.tidyTable(table, "cloud", { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep, flags });
    assert.deepEqual(out.run.masked, RULE_MASKED, JSON.stringify(flags));
    assert.equal(rawIn(sdk.cloudCalls[0], flaggedValues(table, T.localAnalysis(table.headers, table.rows))), 0);
    assert.equal(out.columns[TOWN].pii, false);
  }
});

test("withPageFlags: the union of rule flags and page flags; it adds flags, never removes one, and changes no input", () => {
  const table = ORDERS();
  const local = T.localAnalysis(table.headers, table.rows);
  const before = JSON.stringify(local);
  const flags = pageFlags(table, (cols) => { byHand(cols, TOWN); byHand(cols, EMAIL, false); });
  const merged = T.withPageFlags(local, flags);
  assert.equal(JSON.stringify(local), before);
  assert.deepEqual(merged.filter((c) => c.pii).map((c) => c.original), [...RULE_MASKED, "Town"]);
  assert.equal(merged[TOWN].piiBy, "you");
  assert.equal(merged[EMAIL].piiBy, "device rules");
  assert.equal(merged[EMAIL].piiKind, "email", "a rule flag keeps its own placeholder kind");
  assert.deepEqual(T.withPageFlags(local, undefined), local);
  // Flags listed in another order are matched by their index, not by their place in the list.
  const shuffled = [{ index: TOWN, pii: true, piiBy: "model" }, { index: 0, pii: false }];
  assert.equal(T.withPageFlags(local, shuffled)[TOWN].piiBy, "model");
  assert.equal(T.withPageFlags(local, shuffled)[0].pii, true);
});

// ---- The page itself (src/app.js) in a test DOM, clicked --------------------------------------
globalThis.self = globalThis;
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
  const ai = { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, downloadDeviceModel: async () => "unavailable" };
  const app = createApp(root, { ai, sleep: sleep || noSleep });
  const $ = (id) => root.querySelector("#" + id);
  const pick = (value) => { for (const r of root.querySelectorAll("input[name=pref]")) { if (r.value === value) r.setAttribute("checked", ""); else r.removeAttribute("checked"); } };
  const idle = async () => { for (let i = 0; i < 200 && app.state.busy; i++) await new Promise((r) => setTimeout(r, 2)); await new Promise((r) => setTimeout(r, 2)); };
  const fire = (el) => el.dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  const click = async (id) => { fire($(id)); await new Promise((r) => setTimeout(r, 0)); await idle(); };
  const flagButton = (i) => root.querySelectorAll("#cols li")[i].querySelector("button.pii");
  const toggle = (i) => fire(flagButton(i)); // the person clicks "Personal" / "Not personal" on column i
  const shownFlag = (i) => ({ text: flagButton(i).textContent, pressed: flagButton(i).getAttribute("aria-pressed"), state: app.state.columns[i].pii });
  return { app, root, $, pick, click, toggle, shownFlag };
}
const PERSONAL = { text: "Personal", pressed: "true", state: true };
const NOT_PERSONAL = { text: "Not personal", pressed: "false", state: false };

for (const c of CASES.filter((c) => !c.local)) {
  test(`FINDING H, page: "Town" set to Personal by hand, Tidy: 0 raw values in any send, the note names it, the flag stays (${c.name})`, async () => {
    fetched.length = 0;
    const table = ORDERS();
    const raw = rawOf(table, TOWN);
    // The line on the page while the first cloud send is out.
    let m, during = null;
    const note = () => { during ??= m.$("tidy-msg").textContent; };
    const sdk = fakeSdk({ ...c.sdk, cloud: (c.sdk.cloud || ["ok"]).map((s) => (s === "ok" ? () => { note(); return goodAnswer(6); } : () => { note(); throw sdkError(s); })) });
    m = mount(sdk);
    m.app.setTable(table);
    assert.deepEqual(m.shownFlag(TOWN), NOT_PERSONAL);
    m.toggle(TOWN);
    assert.deepEqual(m.shownFlag(TOWN), PERSONAL);
    m.pick(c.pref);
    await m.click("tidy");
    assert.equal(sdk.cloudCalls.length, c.cloud, "cloud sends");
    assert.equal(sdk.deviceCalls.length, c.device, "on-device prompts");
    for (const [n, text] of everySend(sdk).entries()) {
      assert.equal(rawIn(text, raw), 0, `send ${n + 1} of ${everySend(sdk).length} holds ${rawIn(text, raw)} of ${raw.length} raw Town values`);
      assert.ok(text.includes("[personal]"));
    }
    assert.equal(fetched.length, 0, "the fake model caller is the only way out in this test");
    assert.deepEqual(m.shownFlag(TOWN), PERSONAL, "the hand flag is still set after the run");
    assert.equal(m.app.state.columns[TOWN].piiBy, "you");
    assert.equal(rawIn(m.$("sent").textContent, raw), 0, "What the model saw");
    assert.equal(m.$("sent-note").textContent, "Masked on this device before the request was built: Customer, E-mail address, Cell, Town. " + (c.cloud ? "This exact text went to Gemini in the cloud." : "This run stayed on this device."));
    if (c.cloud) assert.equal(during, "Masked 4 personal-data columns on this device. Asking the model…");
    assert.match(m.$("preview-note").textContent, /4 personal-data columns left out\.$/);
    // A second run on the same page: still masked, still flagged.
    const sentBefore = everySend(sdk).length;
    await m.click("tidy");
    assert.ok(everySend(sdk).length > sentBefore, "the second run sent something");
    for (const text of everySend(sdk)) assert.equal(rawIn(text, raw), 0);
    assert.deepEqual(m.shownFlag(TOWN), PERSONAL);
    m.app.destroy();
  });
}

test("FINDING H, page: a hand flag survives a run that ends on the device rules (cloud busy three times), and Try again masks it too", async () => {
  const table = ORDERS();
  const raw = rawOf(table, TOWN);
  const sdk = fakeSdk({ api: "none", cloud: [500, 500, 500, "ok"] });
  const m = mount(sdk);
  m.app.setTable(table);
  m.toggle(TOWN);
  m.pick("cloud");
  await m.click("tidy");
  assert.equal(sdk.cloudCalls.length, 3);
  assert.equal(m.$("badge").textContent, "Device rules");
  assert.deepEqual(m.shownFlag(TOWN), PERSONAL);
  await m.click("run-retry");
  assert.equal(sdk.cloudCalls.length, 4);
  assert.equal(m.$("badge").textContent, "Cloud");
  for (const text of sdk.cloudCalls) assert.equal(rawIn(text, raw), 0);
  assert.deepEqual(m.shownFlag(TOWN), PERSONAL);
  m.app.destroy();
});

test("FINDING H, page: a column the model's answer flags on the first run is masked on the second run and stays flagged", async () => {
  const table = ORDERS();
  const raw = rawOf(table, TOWN);
  for (const pref of ["cloud", "auto"]) {
    const sdk = fakeSdk({ api: "none", cloud: [() => answerFlagging(6, [TOWN]), () => goodAnswer(6)] });
    const m = mount(sdk);
    m.app.setTable(table);
    m.pick(pref);
    await m.click("tidy");
    assert.deepEqual(m.shownFlag(TOWN), PERSONAL, "the model's answer set the flag");
    assert.equal(m.app.state.columns[TOWN].piiBy, "model");
    assert.equal(m.$("sent-note").textContent, "Masked on this device before the request was built: Customer, E-mail address, Cell. This exact text went to Gemini in the cloud.");
    await m.click("tidy");
    assert.equal(sdk.cloudCalls.length, 2);
    assert.equal(rawIn(sdk.cloudCalls[1], raw), 0, `the second request holds ${rawIn(sdk.cloudCalls[1], raw)} of ${raw.length} raw Town values`);
    assert.ok(sdk.cloudCalls[1].includes("[personal]"));
    assert.deepEqual(m.shownFlag(TOWN), PERSONAL, "kept although the second answer did not flag it");
    assert.equal(m.$("sent-note").textContent, "Masked on this device before the request was built: Customer, E-mail address, Cell, Town. This exact text went to Gemini in the cloud.");
    m.app.destroy();
  }
});

test("page, the other direction, unchanged: a column the rules flag, unflagged by hand, is still masked, and the run sets its flag again", async () => {
  const table = ORDERS();
  const raw = rawOf(table, EMAIL);
  for (const pref of ["cloud", "auto"]) {
    const sdk = fakeSdk({ api: "none" });
    const m = mount(sdk);
    m.app.setTable(table);
    assert.deepEqual(m.shownFlag(EMAIL), PERSONAL);
    m.toggle(EMAIL);
    assert.deepEqual(m.shownFlag(EMAIL), NOT_PERSONAL);
    assert.match(m.$("preview-note").textContent, /2 personal-data columns left out\.$/, "the unflag changes the export preview until the next run");
    m.pick(pref);
    await m.click("tidy");
    assert.equal(sdk.cloudCalls.length, 1);
    assert.equal(rawIn(sdk.cloudCalls[0], raw), 0, "still masked");
    assert.equal(m.$("sent-note").textContent, "Masked on this device before the request was built: Customer, E-mail address, Cell. This exact text went to Gemini in the cloud.");
    assert.deepEqual(m.shownFlag(EMAIL), PERSONAL, "the run sets the rule flag again");
    m.app.destroy();
  }
});

test("page: a flag set by hand while a run is out is not wiped by that run, and the next run masks the column", async () => {
  const table = ORDERS();
  const raw = rawOf(table, TOWN);
  const sdk = fakeSdk({ api: "none", cloud: [500, "ok", "ok"] });
  let m;
  m = mount(sdk, { sleep: async () => { m.toggle(TOWN); } }); // the person clicks during the retry wait
  m.app.setTable(table);
  m.pick("cloud");
  await m.click("tidy");
  assert.equal(sdk.cloudCalls.length, 2);
  assert.deepEqual(m.shownFlag(TOWN), PERSONAL, "the flag set during the run is still there");
  // The note stays true: this run's prompt was built before the click, so Town is not in its list.
  assert.equal(m.$("sent-note").textContent, "Masked on this device before the request was built: Customer, E-mail address, Cell. This exact text went to Gemini in the cloud.");
  await m.click("tidy");
  assert.equal(sdk.cloudCalls.length, 3);
  assert.equal(rawIn(sdk.cloudCalls[2], raw), 0);
  assert.equal(m.$("sent-note").textContent, "Masked on this device before the request was built: Customer, E-mail address, Cell, Town. This exact text went to Gemini in the cloud.");
  m.app.destroy();
});

test("page: On device only with a hand flag and no model object still sends nothing, and keeps the flag", async () => {
  fetched.length = 0;
  const sdk = fakeSdk({ api: "none" });
  const m = mount(sdk);
  m.app.setTable(ORDERS());
  m.toggle(TOWN);
  m.pick("device");
  await m.click("tidy");
  assert.equal(everySend(sdk).length, 0);
  assert.equal(fetched.length, 0);
  assert.equal(m.$("sent").textContent, "Nothing was sent to any model on this run.");
  assert.equal(m.$("run-notice").textContent, H.MESSAGES.strictNoModel);
  assert.deepEqual(m.shownFlag(TOWN), PERSONAL);
  m.app.destroy();
});

test("page: a new table starts from its own rule flags; a hand flag on the table before it is not carried over", async () => {
  const sdk = fakeSdk({ api: "none" });
  const m = mount(sdk);
  m.app.setTable(ORDERS());
  m.toggle(TOWN);
  m.app.setTable({ label: "Stock", headers: ["Item", "Colour", "Qty", "Depot"], rows: [["Kettle", "Red", "4", "Durban"], ["Toaster", "Blue", "2", "Paarl"]] });
  m.pick("cloud");
  const sdk4 = sdk; // same caller; the answer must have 4 columns
  sdk4.cloudCalls.length = 0;
  await m.click("tidy");
  assert.equal(m.app.state.columns.some((c) => c.pii), false);
  assert.ok(sdk.cloudCalls[0].includes("Paarl"), "column 3 of the new table is not masked by the old table's flag");
  m.app.destroy();
});

test.after(() => { globalThis.fetch = realFetch; });
