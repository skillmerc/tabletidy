// "On device only" with an answer that did not come from the device: the answer is thrown away,
// and the page must not say that nothing was sent, because the run cannot know that.
// Reviewer follow-up T4 (17 Nov 2026). The other two strict endings keep their words.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "../src/lib/hybrid.js";
import { route } from "../src/lib/tidy.js";
import { ORDERS, STUB_ECHO, fakeSdk, unguarded, goodAnswer, noLeakText } from "./helpers.mjs";

const DISCARDED_NOTICE = "The answer could not be confirmed as coming from the built-in model on this device, so it was thrown away and the columns below come from the rules on this device only.";
const DISCARDED_REASON = "The answer could not be confirmed as coming from this device and was thrown away. Strict privacy: kept device rules";
const FAILED_NOTICE = "The built-in model did not give a usable answer, so the columns below come from the rules on this device only. Nothing was sent to the cloud.";

const strictRun = (runPrompt) => H.runHybrid(route(10, 3, "device"), "p", { runPrompt, colCount: 3, status: "available" });

test("strict: a thrown-away non-device answer shows a notice and a reason that do not say nothing was sent", async () => {
  for (const source of ["in_cloud", "unknown"]) {
    const calls = [];
    const r = await strictRun(async (mode) => { calls.push(mode); return { text: goodAnswer(3), source, ms: 4 }; });
    assert.deepEqual(calls, ["ONLY_ON_DEVICE"], source);
    assert.equal(r.source, "local", source);
    assert.equal(r.answer, null, "the thrown-away answer is not used");
    assert.equal(r.attempts.length, 1);
    assert.equal(r.attempts[0].discarded, true);
    assert.equal(r.notice, DISCARDED_NOTICE);
    assert.equal(r.notice, H.MESSAGES.strictDiscarded);
    assert.equal(r.reason, DISCARDED_REASON);
    assert.equal(r.action, "auto");
    assert.equal(r.choices, null);
    for (const s of [r.notice, r.reason]) {
      assert.ok(!s.includes("othing was sent"), `must not claim nothing was sent: ${s}`);
      assert.ok(!/\bwas sent\b|\bwere sent\b|\bsent to\b/.test(s), `must not claim anything about sending: ${s}`);
    }
    assert.ok(noLeakText(JSON.stringify(r)));
  }
});

test("strict: the page entry point gives the same notice and reason when the SDK answered from the cloud", async () => {
  // A stale "available" and a caller without the guard: the request really left, so "nothing was sent" would be false.
  const sdk = fakeSdk({ api: "none" });
  const out = await H.tidyTable(ORDERS(), "device", { runPrompt: unguarded(sdk), deviceStatus: async () => "available" });
  assert.equal(sdk.cloudCalls.length, 1);
  assert.equal(out.run.source, "local");
  assert.equal(out.run.reachedCloud, true);
  assert.equal(out.run.notice, DISCARDED_NOTICE);
  assert.equal(out.run.reason, DISCARDED_REASON);
  assert.equal(out.run.action, "auto");
  assert.ok(!(out.run.notice + " " + out.run.reason).includes("othing was sent"));
  assert.ok(noLeakText(JSON.stringify({ ...out.run, sent: "" })));
});

test("strict: an on-device call that throws keeps MESSAGES.strictFailed word for word", async () => {
  const r = await strictRun(async () => { throw new Error("session failed"); });
  assert.equal(r.source, "local");
  assert.equal(H.MESSAGES.strictFailed, FAILED_NOTICE);
  assert.equal(r.notice, FAILED_NOTICE);
  assert.equal(r.reason, "On-device run failed. Strict privacy: nothing was sent to the cloud, kept device rules");
  assert.equal(r.action, "auto");
  assert.ok(noLeakText(JSON.stringify(r)));
});

test("strict: an on-device answer that fails validation keeps MESSAGES.strictFailed word for word", async () => {
  const r = await strictRun(async () => ({ text: STUB_ECHO, source: "on_device", ms: 700 }));
  assert.equal(r.source, "local");
  assert.equal(r.notice, FAILED_NOTICE);
  assert.match(r.reason, /^On-device answer failed validation \(.+\)\. Strict privacy: nothing was sent to the cloud, kept device rules$/);
  assert.equal(r.action, "auto");
  assert.ok(noLeakText(JSON.stringify(r)));
});
