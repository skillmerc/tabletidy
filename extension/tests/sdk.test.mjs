// The real module the hosted app runs (src/ai.js) on the real Firebase AI Logic SDK, with a spy
// on fetch. Node has no LanguageModel object, which is exactly the judge's case of 17 Nov 2026:
// "On device only" in a browser with no built-in model. Built during #BuildHybridAI 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDERS, goodAnswer, flaggedValues } from "./helpers.mjs";
import { tidyTable } from "../src/lib/hybrid.js";
import { localAnalysis } from "../src/lib/tidy.js";

globalThis.self = globalThis;
const requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url?.url || url), body: typeof init.body === "string" ? init.body : "" });
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: goodAnswer(6) }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
};
const ai = await import("../src/ai.js");
// Invented config: no real project, key or token. App Check has no token here; the spy answers anyway.
ai.configureAI({ firebaseConfig: { apiKey: "test-key-not-real", projectId: "test-project", appId: "1:1:web:test" }, appCheck: { kind: "debug", getToken: async () => "" } });
const modelCalls = () => requests.filter((r) => /googleapis\.com|generateContent/.test(r.url));

test("real SDK, no LanguageModel object, On device only, Customer orders: zero requests leave the page", async () => {
  assert.equal("LanguageModel" in globalThis, false);
  assert.equal(globalThis.ai?.languageModel, undefined);
  requests.length = 0;
  const table = ORDERS();
  const out = await tidyTable(table, "device", { runPrompt: ai.runPrompt, deviceStatus: ai.deviceStatus });
  const raw = flaggedValues(table, localAnalysis(table.headers, table.rows));
  const leaked = raw.filter((v) => requests.some((r) => r.body.includes(v)));
  assert.equal(modelCalls().length, 0, `On device only made ${modelCalls().length} request(s) to ${modelCalls()[0]?.url.replace(/\?.*/, "")} (${modelCalls()[0]?.body.length} bytes), with ${leaked.length} unmasked personal values such as "${leaked[0]}"`);
  assert.equal(requests.length, 0);
  assert.equal(out.run.source, "local");
  assert.equal(out.run.reachedCloud, false);
  assert.equal(out.run.sent, "");
});

test("real SDK, no LanguageModel object, Auto: the one cloud request holds masked rows only", async () => {
  requests.length = 0;
  const table = ORDERS();
  const out = await tidyTable(table, "auto", { runPrompt: ai.runPrompt, deviceStatus: ai.deviceStatus });
  assert.equal(modelCalls().length, 1);
  const raw = flaggedValues(table, localAnalysis(table.headers, table.rows));
  assert.ok(raw.length >= 30, "names, emails and phones of 12 rows");
  for (const v of raw) assert.ok(!requests[0].body.includes(v), `unmasked value in the cloud request: ${v}`);
  assert.ok(requests[0].body.includes("name@example.com"));
  assert.equal(out.run.source, "in_cloud");
  assert.deepEqual(out.run.masked, ["Customer", "E-mail address", "Cell"]);
});

test("real SDK: runPrompt('ONLY_ON_DEVICE') itself refuses before any request when there is no model object", async () => {
  requests.length = 0;
  await assert.rejects(() => ai.runPrompt("ONLY_ON_DEVICE", "Thandi Mokoena, thandi@example.com"), (e) => e.code === "DEVICE_UNAVAILABLE");
  assert.equal(requests.length, 0);
});

test.after(() => { globalThis.fetch = realFetch; });
