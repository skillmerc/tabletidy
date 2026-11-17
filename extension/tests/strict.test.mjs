// "On device only" must send nothing, in every state of the browser's built-in model and on
// every path that can call a model. And in Auto every cloud call carries masked rows.
// Built during #BuildHybridAI 2026 after the judge walk of 17 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "../src/lib/hybrid.js";
import { localAnalysis } from "../src/lib/tidy.js";
import { parseInput } from "../src/lib/parse.js";
import { ORDERS, SHIPMENTS, STATES, fakeSdk, unguarded, flaggedValues, goodAnswer, noLeakText } from "./helpers.mjs";

const PASTED = () => { const r = parseInput("Name,Email,Phone,Total\nThandi Mokoena,thandi@example.com,082 555 0142,R 1 234,50\nPieter van Wyk,pieter@example.com,083 555 0199,R 899,00\nMary-Ann Smith,mary@example.com,084 555 0177,R 12,00"); return { label: r.label, headers: r.headers, rows: r.rows }; };
const TABLES = [["Customer orders sample", ORDERS], ["Shipment log sample (large-table route)", SHIPMENTS], ["pasted table", PASTED]];
const guarded = (sdk) => H.makeRunPrompt({ getModel: sdk.getModel, hasDeviceApi: sdk.hasDeviceApi, deviceStatus: sdk.deviceStatus });
const CALLERS = [["routing layer alone (caller without a guard, as before 17 Nov)", unguarded], ["routing layer plus the guard in the model caller", guarded]];
const noSleep = async () => {};

test("REPRODUCTION: no LanguageModel object, On device only, Tidy columns on Customer orders: zero cloud calls", async () => {
  const sdk = fakeSdk({ api: "none" });
  const table = ORDERS();
  const out = await H.tidyTable(table, "device", { runPrompt: unguarded(sdk), deviceStatus: sdk.deviceStatus });
  assert.equal(sdk.cloudCalls.length, 0, `On device only sent ${sdk.cloudCalls.length} request(s) to the cloud; the first holds "Thandi Mokoena": ${sdk.cloudCalls[0]?.includes("Thandi Mokoena")}`);
  assert.equal(sdk.deviceCalls.length, 0);
  assert.equal(out.run.source, "local", "the badge names no model answer");
  assert.equal(out.run.reachedCloud, false);
  assert.equal(out.run.sent, "", "nothing was sent to any model");
  assert.equal(out.run.notice, "This browser has no built-in model, so On device only did not run and nothing was sent.");
  assert.equal(out.run.choices, "Switch to Auto, or open this page in a browser with the built-in model (desktop Google Chrome).");
  assert.equal(out.run.action, "auto");
});

for (const [callerName, caller] of CALLERS) for (const st of STATES) for (const [tableName, mk] of TABLES) {
  test(`strict: ${st.name}; ${tableName}; ${callerName}: nothing reaches the cloud`, async () => {
    const table = mk();
    const sdk = fakeSdk({ ...st, cols: table.headers.length });
    const out = await H.tidyTable(table, "device", { runPrompt: caller(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep });
    assert.equal(sdk.cloudCalls.length, 0, "cloud calls");
    assert.equal(out.run.source, "local");
    assert.equal(out.run.reachedCloud, false);
    assert.ok(Object.values(H.MESSAGES).includes(out.run.notice), `plain sentence expected, got: ${out.run.notice}`);
    assert.ok(noLeakText(JSON.stringify({ ...out.run, sent: "" })));
    if (st.api !== "available") { assert.equal(sdk.deviceCalls.length, 0, "no model call at all"); assert.equal(out.run.sent, ""); assert.equal(out.run.action, "auto"); assert.ok(out.run.choices); }
    // A second press (re-run) and the Try again path use the same entry point: still nothing.
    await H.tidyTable(table, "device", { runPrompt: caller(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep });
    assert.equal(sdk.cloudCalls.length, 0, "cloud calls after a re-run");
  });
}

test("strict: a ready model that answers well is used, on the device, and nothing reaches the cloud", async () => {
  const table = ORDERS();
  const sdk = fakeSdk({ api: "available", cols: 6 });
  const out = await H.tidyTable(table, "device", { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus });
  assert.equal(out.run.source, "on_device");
  assert.equal(sdk.cloudCalls.length, 0);
  assert.equal(sdk.deviceCalls.length, 1);
  assert.equal(out.run.reachedCloud, false);
});

test("strict is decided first: the live setting wins over the setting the run was started with", async () => {
  for (const pref of ["auto", "cloud"]) for (const mk of [ORDERS, SHIPMENTS]) {
    const table = mk();
    const sdk = fakeSdk({ api: "none", cols: table.headers.length });
    const out = await H.tidyTable(table, pref, { runPrompt: unguarded(sdk), deviceStatus: sdk.deviceStatus, isStrict: () => true });
    assert.equal(sdk.cloudCalls.length, 0);
    assert.equal(out.run.source, "local");
    assert.equal(out.run.strict, true);
  }
});

test("strict: a missing or failing status check counts as no usable model (fails closed)", async () => {
  const sdk = fakeSdk({ api: "none" });
  const a = await H.tidyTable(ORDERS(), "device", { runPrompt: unguarded(sdk) });
  const b = await H.tidyTable(ORDERS(), "device", { runPrompt: unguarded(sdk), deviceStatus: async () => { throw new Error("boom"); } });
  assert.equal(sdk.cloudCalls.length, 0);
  assert.equal(a.run.source, "local"); assert.equal(b.run.source, "local");
});

test("strict: the status said available but the SDK answered from the cloud: the answer is thrown away", async () => {
  // A model object that was created before the browser lost its LanguageModel (no adapter), with a stale "available".
  const sdk = fakeSdk({ api: "none" });
  const out = await H.tidyTable(ORDERS(), "device", { runPrompt: unguarded(sdk), deviceStatus: async () => "available" });
  assert.equal(out.run.source, "local"); // routing layer alone cannot stop the send, but must never use or show the answer
  assert.match(out.run.reason, /thrown away/);
  // With the guard (what the app runs) the same stale state sends nothing at all.
  const sdk2 = fakeSdk({ api: "none" });
  const stale = H.makeRunPrompt({ getModel: sdk2.getModel, hasDeviceApi: () => true, deviceStatus: async () => "available" });
  const out2 = await H.tidyTable(ORDERS(), "device", { runPrompt: stale, deviceStatus: async () => "available" });
  assert.equal(sdk2.cloudCalls.length, 0, "no adapter on the model: no call");
  assert.equal(out2.run.source, "local");
  assert.equal(out2.run.action, "auto");
});

test("guard in the model caller: ONLY_ON_DEVICE never reaches generateContent unless the model is ready", async () => {
  for (const st of STATES.filter((s) => s.api !== "available")) {
    const sdk = fakeSdk(st);
    await assert.rejects(() => guarded(sdk)("ONLY_ON_DEVICE", "raw table"), (e) => e.code === "DEVICE_UNAVAILABLE", st.name);
    assert.equal(sdk.cloudCalls.length + sdk.deviceCalls.length, 0, st.name);
  }
});

test("switching to On device only while a cloud call is in flight: the answer is thrown away and nothing more is sent", async () => {
  for (const [pref, mk, st] of [["cloud", ORDERS, { api: "none" }], ["auto", ORDERS, { api: "available", device: "garbage" }], ["auto", SHIPMENTS, { api: "downloadable" }]]) {
    const table = mk();
    let strict = false, release;
    const gate = new Promise((r) => { release = r; });
    const sdk = fakeSdk({ ...st, cols: table.headers.length, cloud: [async () => { await gate; return goodAnswer(table.headers.length); }] });
    const p = H.tidyTable(table, pref, { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, isStrict: () => strict, sleep: noSleep });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(sdk.cloudCalls.length, 1, "the cloud call is out");
    strict = true; // the person clicks "On device only"
    release();
    const out = await p;
    assert.equal(out.run.source, "local", "the cloud answer is not used");
    assert.equal(out.columns.every((c, i) => c.name === table.headers[i]), true, "columns are the device rules result");
    assert.equal(out.run.notice, H.MESSAGES.strictSwitched);
    assert.equal(sdk.cloudCalls.length, 1, "nothing more was sent");
  }
});

// ---- Masking in Auto and Cloud ---------------------------------------------------------------
for (const st of [...STATES, { name: "available, good on-device answer", api: "available" }]) for (const pref of ["auto", "cloud"]) for (const [tableName, mk] of TABLES) {
  test(`masking: ${pref}; ${st.name}; ${tableName}: every cloud call (retries too) carries masked rows only`, async () => {
    const table = mk();
    const local = localAnalysis(table.headers, table.rows);
    const raw = flaggedValues(table, local);
    const sdk = fakeSdk({ ...st, cols: table.headers.length, cloud: [500, 503, "ok"] });
    const out = await H.tidyTable(table, pref, { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: noSleep });
    for (const body of sdk.cloudCalls) for (const v of raw) assert.ok(!body.includes(v), `unmasked value "${v}" in a cloud call`);
    assert.equal(new Set(sdk.cloudCalls).size <= 1, true, "retries send the same masked text");
    assert.deepEqual(out.run.masked, local.filter((c) => c.pii).map((c) => c.original));
    if (tableName !== "Shipment log sample (large-table route)") assert.ok(raw.length >= 9 && out.run.masked.length >= 3, "the page flags name, email and phone here");
    const expectCloud = !(st.api === "available" && !st.device && pref === "auto" && tableName !== "Shipment log sample (large-table route)");
    assert.equal(sdk.cloudCalls.length > 0, expectCloud, "cloud used");
    if (expectCloud) assert.equal(out.run.reachedCloud, true);
  });
}
