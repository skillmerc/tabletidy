import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnswer, runHybrid, tidyTable } from "../src/lib/hybrid.js";
import { route } from "../src/lib/tidy.js";

const good = (n = 3) => JSON.stringify({ title: "Orders", columns: Array.from({ length: n }, (_, i) => ({ index: i, name: `Col ${i}`, type: "text", personalData: false })) });
// What the Aside browser's stub on-device model returns: a debug echo, no JSON.
const STUB_ECHO = "CPU backendFastest inferenceTopK: 64, Temp: 1User: You clean up tables... End.Model: ";

test("validator accepts a complete answer, with or without a code fence", () => {
  assert.equal(validateAnswer(good(), 3).ok, true);
  assert.equal(validateAnswer("```json\n" + good() + "\n```", 3).ok, true);
  assert.equal(validateAnswer(good(), 3).value.columns.length, 3);
});

test("validator rejects empty, non-JSON and schema-breaking answers with a reason", () => {
  assert.deepEqual(validateAnswer("", 3), { ok: false, error: "empty answer" });
  assert.deepEqual(validateAnswer("   \n", 3), { ok: false, error: "empty answer" });
  assert.deepEqual(validateAnswer(null, 3), { ok: false, error: "empty answer" });
  assert.deepEqual(validateAnswer(STUB_ECHO, 3), { ok: false, error: "not JSON" });
  assert.deepEqual(validateAnswer("{ title: nope }", 3), { ok: false, error: "not JSON" });
  assert.equal(validateAnswer("[1,2]", 3).ok, false);
  assert.equal(validateAnswer(JSON.stringify({ columns: [] }), 3).error, "no title");
  assert.equal(validateAnswer(JSON.stringify({ title: "x", columns: [] }), 3).error, "no columns");
  const col = (over) => JSON.stringify({ title: "x", columns: [{ index: 0, name: "A", type: "text", personalData: false, ...over }] });
  assert.match(validateAnswer(col({ index: 7 }), 1).error, /out of range/);
  assert.match(validateAnswer(col({ index: "0" }), 1).error, /out of range/);
  assert.match(validateAnswer(col({ name: " " }), 1).error, /no name/);
  assert.match(validateAnswer(col({ type: "currency" }), 1).error, /unknown type/);
  assert.match(validateAnswer(col({ personalData: "yes" }), 1).error, /personalData/);
  assert.match(validateAnswer(good(2), 3).error, /1 of 3 columns missing/);
  const twice = JSON.stringify({ title: "x", columns: [0, 0].map((i) => ({ index: i, name: "A", type: "text", personalData: false })) });
  assert.match(validateAnswer(twice, 2).error, /listed twice/);
});

const fake = (script) => {
  const calls = [];
  const runPrompt = async (mode) => { calls.push(mode); const r = script[mode]; if (r instanceof Error) throw r; return r; };
  return { calls, runPrompt };
};

test("prefer on device: a valid on-device answer is used, no cloud call", async () => {
  const f = fake({ PREFER_ON_DEVICE: { text: good(), source: "on_device", ms: 900 } });
  const r = await runHybrid(route(10, 3), "p", { runPrompt: f.runPrompt, colCount: 3 });
  assert.deepEqual(f.calls, ["PREFER_ON_DEVICE"]);
  assert.equal(r.source, "on_device");
  assert.match(r.reason, /Small table/);
  assert.equal(r.answer.columns.length, 3);
});

test("prefer on device: stub echo / empty / invalid answers fall back to the cloud with the reason", async () => {
  for (const [bad, why] of [[STUB_ECHO, "not JSON"], ["", "empty answer"], [good(2), "1 of 3 columns missing"]]) {
    const f = fake({ PREFER_ON_DEVICE: { text: bad, source: "on_device", ms: 800 }, ONLY_IN_CLOUD: { text: good(), source: "in_cloud", ms: 2000 } });
    const r = await runHybrid(route(10, 3), "p", { runPrompt: f.runPrompt, colCount: 3 });
    assert.deepEqual(f.calls, ["PREFER_ON_DEVICE", "ONLY_IN_CLOUD"]);
    assert.equal(r.source, "in_cloud");
    assert.equal(r.ms, 2000);
    assert.equal(r.reason, `On-device answer failed validation (${why}), cloud fallback`);
    assert.deepEqual(r.attempts.map((a) => [a.source, a.ok]), [["on_device", false], ["in_cloud", true]]);
  }
});

test("prefer on device: an on-device crash also falls back; SDK-side fallback is labelled", async () => {
  const f = fake({ PREFER_ON_DEVICE: new Error("session failed"), ONLY_IN_CLOUD: { text: good(), source: "in_cloud", ms: 1500 } });
  const r = await runHybrid(route(10, 3), "p", { runPrompt: f.runPrompt, colCount: 3 });
  assert.equal(r.source, "in_cloud");
  assert.match(r.reason, /On-device run failed \(session failed\), cloud fallback/);
  const g = fake({ PREFER_ON_DEVICE: { text: good(), source: "in_cloud", ms: 1500 } });
  const r2 = await runHybrid(route(10, 3), "p", { runPrompt: g.runPrompt, colCount: 3, status: "downloadable" });
  assert.deepEqual(g.calls, ["PREFER_ON_DEVICE"]);
  assert.equal(r2.reason, "Gemini Nano is not ready in this browser (downloadable), cloud fallback");
});

test("on device only (strict privacy) never calls the cloud, even on a bad answer", async () => {
  const f = fake({ ONLY_ON_DEVICE: { text: STUB_ECHO, source: "on_device", ms: 700 }, ONLY_IN_CLOUD: { text: good(), source: "in_cloud", ms: 1 } });
  const r = await runHybrid(route(10, 3, "device"), "p", { runPrompt: f.runPrompt, colCount: 3 });
  assert.deepEqual(f.calls, ["ONLY_ON_DEVICE"]);
  assert.equal(r.source, "local");
  assert.equal(r.answer, null);
  assert.match(r.reason, /nothing was sent to the cloud/);
});

test("cloud failures keep the device rules and carry the error", async () => {
  const f = fake({ ONLY_IN_CLOUD: new Error("AppCheck: token rejected") });
  const r = await runHybrid(route(10, 3, "cloud"), "p", { runPrompt: f.runPrompt, colCount: 3 });
  assert.equal(r.source, "local");
  assert.match(r.error, /token rejected/);
  const g = fake({ PREFER_ON_DEVICE: { text: "", source: "on_device", ms: 5 }, ONLY_IN_CLOUD: { text: "oops", source: "in_cloud", ms: 5 } });
  const r2 = await runHybrid(route(10, 3), "p", { runPrompt: g.runPrompt, colCount: 3 });
  assert.equal(r2.source, "local");
  assert.match(r2.reason, /cloud answer failed validation, kept device rules/);
});

test("tidyTable: the fallback prompt is the masked one, and flags from device rules survive", async () => {
  const table = { label: "Orders", headers: ["Customer", "email", "Total"], rows: [["Thandi Nkosi", "thandi@mail.example", "R 1 234,50"], ["Pieter van Wyk", "pieter@mail.example", "R 899,00"], ["Mary-Ann Smith", "mary@mail.example", "R 12,00"]] };
  const sent = [];
  const answer = JSON.stringify({ title: "Customer Orders", columns: [{ index: 0, name: "Customer", type: "text", personalData: false }, { index: 1, name: "Email", type: "email", personalData: false }, { index: 2, name: "Order Total", type: "money", personalData: false }] });
  const runPrompt = async (mode, text) => { sent.push([mode, text]); return mode === "ONLY_IN_CLOUD" ? { text: answer, source: "in_cloud", ms: 10 } : { text: STUB_ECHO, source: "on_device", ms: 10 }; };
  const out = await tidyTable(table, "auto", { runPrompt, deviceStatus: async () => "available" });
  assert.equal(sent.length, 2);
  assert.equal(sent[0][1], sent[1][1], "same prompt for both attempts");
  for (const [, text] of sent) { assert.ok(!text.includes("Thandi")); assert.ok(!text.includes("thandi@mail.example")); assert.ok(text.includes("name@example.com")); }
  assert.equal(out.run.source, "in_cloud");
  assert.equal(out.run.reachedCloud, true);
  assert.deepEqual(out.run.masked, ["Customer", "email"]);
  assert.equal(out.title, "Customer Orders");
  assert.deepEqual(out.columns.map((c) => c.pii), [true, true, false], "the model cannot remove a device-rule flag");
  assert.equal(out.columns[2].name, "Order Total");
});
