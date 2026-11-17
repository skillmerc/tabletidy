// Cloud retry: a 5xx or "high demand" answer is tried three times in all (waits 1 s, 3 s) with a
// plain line on screen; a 4xx is not retried; nothing shows an address. Built during
// #BuildHybridAI 2026 after 3 of 12 judge-path runs failed with HTTP 500 on 17 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "../src/lib/hybrid.js";
import { ORDERS, SHIPMENTS, fakeSdk, goodAnswer, noLeakText, sdkError } from "./helpers.mjs";

const guarded = (sdk) => H.makeRunPrompt({ getModel: sdk.getModel, hasDeviceApi: sdk.hasDeviceApi, deviceStatus: sdk.deviceStatus });
function run(table, pref, sdk, extra = {}) {
  const waits = [], lines = [];
  const p = H.tidyTable(table, pref, { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: async (ms) => { waits.push(ms); await extra.duringWait?.(waits.length); }, onRetry: (r) => lines.push(r.text), isStrict: extra.isStrict });
  return p.then((out) => ({ out, waits, lines }));
}
const shown = (run) => JSON.stringify({ ...run, sent: "" });

test("fail, fail, succeed: three tries, waits of 1 s then 3 s, the busy line each time, then the answer", async () => {
  for (const pref of ["cloud", "auto"]) {
    const sdk = fakeSdk({ api: "none", cloud: [500, 500, "ok"] });
    const { out, waits, lines } = await run(ORDERS(), pref, sdk);
    assert.equal(sdk.cloudCalls.length, 3);
    assert.deepEqual(waits, [1000, 3000]);
    assert.deepEqual(lines, ["The cloud model is busy. Trying again (2 of 3).", "The cloud model is busy. Trying again (3 of 3)."]);
    assert.equal(out.run.source, "in_cloud");
    assert.match(out.run.reason, /the cloud model was busy, answered on try 3 of 3/);
    assert.equal(out.run.notice, null);
    assert.equal(sdk.maxInFlight, 1);
    assert.ok(noLeakText(shown(out.run)));
  }
});

test("fail, fail, fail: three tries, then one plain sentence with Try again, device rules kept, no address", async () => {
  for (const [pref, mk, st] of [["cloud", ORDERS, { api: "none" }], ["auto", ORDERS, { api: "downloadable" }], ["auto", SHIPMENTS, { api: "none" }], ["auto", ORDERS, { api: "available", device: "garbage" }]]) {
    const table = mk();
    const sdk = fakeSdk({ ...st, cols: table.headers.length, cloud: [500, 503, 500] });
    const { out, waits, lines } = await run(table, pref, sdk);
    assert.equal(sdk.cloudCalls.length, 3);
    assert.deepEqual(waits, [1000, 3000]);
    assert.equal(lines.length, 2);
    assert.equal(out.run.source, "local");
    assert.equal(out.run.notice, "The cloud model was busy on all three tries, so the columns below come from the rules on this device only.");
    assert.equal(out.run.action, "retry");
    assert.ok(noLeakText(shown(out.run)), shown(out.run));
    assert.equal(out.run.attempts.filter((a) => a.source === "in_cloud").every((a) => a.error === "cloud model busy"), true);
  }
});

test("a 4xx is not retried and gets its own plain sentence", async () => {
  const want = { 400: H.MESSAGES.refusedBad, 401: H.MESSAGES.refusedCheck, 403: H.MESSAGES.refusedCheck, 429: H.MESSAGES.refusedQuota };
  for (const status of [400, 401, 403, 429]) for (const pref of ["cloud", "auto"]) {
    const sdk = fakeSdk({ api: "none", cloud: [status, "ok"] });
    const { out, waits, lines } = await run(ORDERS(), pref, sdk);
    assert.equal(sdk.cloudCalls.length, 1, `status ${status} must not be retried`);
    assert.deepEqual(waits, []); assert.deepEqual(lines, []);
    assert.equal(out.run.source, "local");
    assert.equal(out.run.notice, want[status]);
    assert.equal(out.run.action, null);
    assert.ok(noLeakText(shown(out.run)));
  }
  assert.equal(new Set(Object.values(want)).size, 3);
});

test("a 'high demand' answer is retried whatever its status; a network failure is not, and says so plainly", async () => {
  const sdk = fakeSdk({ api: "none", cloud: [() => { throw sdkError(429, "This model is currently experiencing high demand."); }, "ok"] });
  const a = await run(ORDERS(), "cloud", sdk);
  assert.equal(sdk.cloudCalls.length, 2); assert.equal(a.out.run.source, "in_cloud");
  const net = fakeSdk({ api: "none", cloud: ["network"] });
  const b = await run(ORDERS(), "cloud", net);
  assert.equal(net.cloudCalls.length, 1);
  assert.equal(b.out.run.notice, H.MESSAGES.network); assert.equal(b.out.run.action, "retry");
  assert.ok(noLeakText(shown(b.out.run)));
});

test("switching to On device only during the wait: no further try is sent", async () => {
  for (const st of [{ api: "none" }, { api: "available", device: "garbage" }]) {
    let strict = false;
    const sdk = fakeSdk({ ...st, cloud: [500, "ok"] });
    const { out, waits } = await run(ORDERS(), "auto", sdk, { isStrict: () => strict, duringWait: () => { strict = true; } });
    assert.deepEqual(waits, [1000]);
    assert.equal(sdk.cloudCalls.length, 1, "the second try must not go out");
    assert.equal(out.run.source, "local");
    assert.equal(out.run.notice, H.MESSAGES.strictSwitched);
  }
});

test("no double send: a slow first call that succeeds is the only call, and a retry starts only after the failure", async () => {
  const slow = fakeSdk({ api: "none", cloud: [async () => { await new Promise((r) => setTimeout(r, 30)); return goodAnswer(6); }] });
  const a = await run(ORDERS(), "cloud", slow);
  assert.equal(slow.cloudCalls.length, 1); assert.deepEqual(a.waits, []); assert.equal(a.out.run.source, "in_cloud");
  const order = [];
  const sdk = fakeSdk({ api: "none", cloud: [async () => { order.push("call 1 out"); await new Promise((r) => setTimeout(r, 20)); order.push("call 1 failed"); throw sdkError(500); }, async () => { order.push("call 2 out"); return goodAnswer(6); }] });
  await run(ORDERS(), "cloud", sdk);
  assert.deepEqual(order, ["call 1 out", "call 1 failed", "call 2 out"]);
  assert.equal(sdk.maxInFlight, 1);
});

test("Auto with a bad on-device answer and a busy cloud: fallback, one retry, and the badge says both", async () => {
  const sdk = fakeSdk({ api: "available", device: "garbage", cloud: [500, "ok"] });
  const { out } = await run(ORDERS(), "auto", sdk);
  assert.equal(sdk.deviceCalls.length, 1); assert.equal(sdk.cloudCalls.length, 2);
  assert.equal(out.run.reason, "On-device answer failed validation (not JSON), cloud fallback (the cloud model was busy, answered on try 2 of 3)");
});

test("classifyError never passes the SDK's text on", () => {
  for (const e of [sdkError(500), sdkError(401, "Firebase App Check token is invalid."), sdkError(429, "Quota exceeded."), new Error("session failed"), "x"]) assert.ok(noLeakText(H.classifyError(e).label));
  assert.equal(H.classifyError(sdkError(500)).kind, "busy");
  assert.equal(H.classifyError(sdkError(404, "Not found.")).kind, "refused");
  assert.equal(H.classifyError(new Error("AI: Error fetching from https://x.googleapis.com/y: [503 ] The model is overloaded.")).kind, "busy");
});

test("REPRODUCTION of 17 Nov: the cloud answers HTTP 500 'high demand' once on Customer orders: the run tries again and shows no address", async () => {
  const { unguarded } = await import("./helpers.mjs");
  for (const pref of ["cloud", "auto"]) {
    const sdk = fakeSdk({ api: "none", cloud: [500, "ok"] });
    const out = await H.tidyTable(ORDERS(), pref, { runPrompt: unguarded(sdk), deviceStatus: sdk.deviceStatus, sleep: async () => {} });
    assert.ok(noLeakText(shown(out.run)), `an address or raw error would be shown: ${String(out.run.error).slice(0, 90)}`);
    assert.equal(sdk.cloudCalls.length, 2, "tries");
    assert.equal(out.run.source, "in_cloud");
  }
});
