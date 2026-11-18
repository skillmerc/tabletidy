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

// Reviewer follow-up T2 (17 Nov 2026): the hard cap. A PREFER_ON_DEVICE call can reach the cloud
// (the SDK sends it there when it decides the device cannot take it). If that send fails with an
// error classifyError cannot place (no status, no "Error fetching"), the run used to fall back and
// then try the cloud three more times. Since T8 a small Auto table with no ready model starts with
// ONLY_IN_CLOUD, so that path is checked with the status "available" and a scripted model caller.
test("small table, Auto, first send (may have reached the cloud) fails with an unclassified error, then always 500: exactly 3 cloud sends", async () => {
  assert.equal(H.classifyError(new Error("stream closed")).kind, "other", "the first failure is one classifyError cannot place");
  const calls = [], waits = [], lines = [];
  let n = 0;
  const runPrompt = async (mode, text) => { calls.push([mode, text]); if (n++ === 0) throw new Error("stream closed"); throw sdkError(500); };
  const table = ORDERS();
  const out = await H.tidyTable(table, "auto", { runPrompt, deviceStatus: async () => "available", sleep: async (ms) => { waits.push(ms); }, onRetry: (r) => lines.push(r.text) });
  assert.equal(out.run.attempts[0].mode, "PREFER_ON_DEVICE", "a small table in Auto with a ready model starts with PREFER_ON_DEVICE");
  assert.equal(out.run.attempts[0].kind, "other");
  assert.equal(calls.length, 3, `${calls.length} sends in one run, the cap is ${H.MAX_CLOUD_TRIES}`);
  assert.deepEqual(calls.map(([m]) => m), ["PREFER_ON_DEVICE", "ONLY_IN_CLOUD", "ONLY_IN_CLOUD"]);
  assert.equal(new Set(calls.map(([, t]) => t)).size, 1, "every send is the same masked prompt");
  assert.deepEqual(waits, [1000]);
  assert.deepEqual(lines, ["The cloud model is busy. Trying again (3 of 3)."]);
  assert.equal(out.run.notice, "The cloud model was still busy on the last of this run's three tries, so the columns below come from the rules on this device only.");
  assert.match(out.run.reason, /the cloud model was still busy on try 3 of 3, kept device rules$/);
  assert.equal(out.run.source, "local");
  assert.equal(out.run.action, "retry");
  assert.ok(noLeakText(shown(out.run)), shown(out.run));
  // With no model object (T8): one cloud send; an error that is not a 5xx is not retried.
  const sdk = fakeSdk({ api: "none", cloud: [() => { throw new Error("stream closed"); }, 500] });
  const { out: o2 } = await run(ORDERS(), "auto", sdk);
  assert.equal(o2.run.attempts[0].mode, "ONLY_IN_CLOUD");
  assert.equal(sdk.cloudCalls.length, 1);
  assert.equal(sdk.deviceCalls.length, 0);
  assert.equal(o2.run.notice, H.MESSAGES.cloudOther);
  assert.equal(o2.run.source, "local");
  assert.ok(noLeakText(shown(o2.run)), shown(o2.run));
});

// The same cap when a ready built-in model's call throws: that call cannot be shown to have stayed
// on the device, so it counts as one of the three and the cloud gets two tries.
test("small table, Auto, ready model whose call throws: the cloud gets 2 tries, and the lines count the failed first call", async () => {
  const busy = fakeSdk({ api: "available", device: "throw", cloud: [500] });
  const a = await run(ORDERS(), "auto", busy);
  assert.equal(busy.deviceCalls.length, 1);
  assert.equal(busy.cloudCalls.length, 2);
  assert.equal(busy.maxInFlight, 1);
  assert.deepEqual(a.waits, [1000]);
  assert.deepEqual(a.lines, ["The cloud model is busy. Trying again (3 of 3)."]);
  assert.equal(a.out.run.notice, "The cloud model was still busy on the last of this run's three tries, so the columns below come from the rules on this device only.");
  assert.equal(a.out.run.reason, "On-device run failed and the cloud model was still busy on try 3 of 3, kept device rules");
  assert.equal(a.out.run.source, "local");
  const answered = fakeSdk({ api: "available", device: "throw", cloud: [500, "ok"] });
  const b = await run(ORDERS(), "auto", answered);
  assert.equal(answered.cloudCalls.length, 2);
  assert.equal(b.out.run.source, "in_cloud");
  assert.equal(b.out.run.reason, "On-device run failed, cloud fallback (the cloud model was busy, answered on try 3 of 3)");
  const first = fakeSdk({ api: "available", device: "throw", cloud: ["ok"] });
  const c = await run(ORDERS(), "auto", first);
  assert.equal(first.cloudCalls.length, 1);
  assert.equal(c.out.run.reason, "On-device run failed, cloud fallback");
});
