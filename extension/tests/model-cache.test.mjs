// Reviewer follow-up T5 (probe P4b): modelFor() in src/ai.js must not keep a model that was
// built without its on-device adapter under the cache key that says the LanguageModel object
// exists. Tested on the real module and the real Firebase AI Logic SDK with a spy on fetch.
// The node build of the SDK has no adapter factory, so the test gives the AI service one that
// decides the way the browser build does: an adapter only when the object is on the global.
// Built during #BuildHybridAI 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDERS, goodAnswer } from "./helpers.mjs";
import * as H from "../src/lib/hybrid.js";

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

// The fake LanguageModel object: present or gone, as the test says.
let present = false;
const fakeLanguageModel = { availability: async () => "available" };
Object.defineProperty(globalThis, "LanguageModel", { configurable: true, get: () => (present ? fakeLanguageModel : undefined) });

let builds = 0;               // models the SDK built
let vanishAtBuild = false;    // the object goes away just as the SDK builds its next model
const devicePrompts = [];
const service = await ai.initAI();
service.chromeAdapterFactory = (mode) => {
  builds++;
  if (vanishAtBuild) { vanishAtBuild = false; present = false; }
  if (!globalThis.LanguageModel || !mode) return undefined; // as chromeAdapterFactory in the browser build
  return {
    mode,
    isAvailable: async () => true,
    generateContent: async (request) => {
      devicePrompts.push(JSON.stringify(request));
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: goodAnswer(6) }] }, finishReason: "STOP" }] }));
    },
  };
};
const reset = () => { requests.length = 0; devicePrompts.length = 0; builds = 0; vanishAtBuild = false; };

test.after(() => { globalThis.fetch = realFetch; delete globalThis.LanguageModel; });

test("T5: object present at the key check, gone when the SDK builds: the adapterless model is not handed back once the object is there again; after that the cache holds (two calls, one build)", async () => {
  reset();
  present = true;
  const pending = ai.modelFor("PREFER_ON_DEVICE"); // the key check has run, the build has not
  present = false;
  const first = await pending;
  assert.equal(first.chromeAdapter, undefined, "built without its adapter");
  assert.equal(builds, 1);

  present = true;
  const second = await ai.modelFor("PREFER_ON_DEVICE");
  assert.notEqual(second, first, "a new model, not the adapterless one from the cache");
  assert.ok(second.chromeAdapter, "the new model has its adapter");
  assert.equal(builds, 2);

  // Normal case: the object stays, the model is built once and reused.
  assert.equal(await ai.modelFor("PREFER_ON_DEVICE"), second);
  assert.equal(await ai.modelFor("PREFER_ON_DEVICE"), second);
  assert.equal(builds, 2, "no further build while the object stays");

  // The adapterless model sits under the key for "no object" and is reused there.
  present = false;
  assert.equal(await ai.modelFor("PREFER_ON_DEVICE"), first);
  assert.equal(builds, 2);
  present = true;
  assert.equal(await ai.modelFor("PREFER_ON_DEVICE"), second);
  assert.equal(builds, 2);
  assert.equal(requests.length, 0);
});

test("T5: the other way round, object absent at the key check and there when the SDK builds: the model with an adapter is not kept under the key for \"no object\"", async () => {
  reset();
  present = false;
  const pending = ai.modelFor("PREFER_IN_CLOUD");
  present = true;
  const withAdapter = await pending;
  assert.ok(withAdapter.chromeAdapter);
  present = false;
  const without = await ai.modelFor("PREFER_IN_CLOUD");
  assert.notEqual(without, withAdapter);
  assert.equal(without.chromeAdapter, undefined);
  assert.equal(await ai.modelFor("PREFER_IN_CLOUD"), without, "no object: two calls, one build");
  present = true;
  assert.equal(await ai.modelFor("PREFER_IN_CLOUD"), withAdapter, "object back: the model with the adapter, from the cache");
  assert.equal(builds, 2);
  assert.equal(requests.length, 0);
});

test("T5: strict run (tidyTable with ai.runPrompt and ai.deviceStatus) sends nothing in both states: object gone at build gives the no-model sentence, object back gives an on-device answer", async () => {
  reset();
  const table = ORDERS();
  const deps = { runPrompt: ai.runPrompt, deviceStatus: ai.deviceStatus, sleep: async () => {} };

  // State 1: the object passes every guard, then is gone when the SDK builds the model.
  present = true;
  vanishAtBuild = true;
  const one = await H.tidyTable(table, "device", deps);
  assert.equal(builds, 1);
  assert.equal(one.run.notice, H.MESSAGES.strictNoModel);
  assert.equal(one.run.source, "local");
  assert.equal(one.run.reachedCloud, false);
  assert.equal(requests.length, 0, "requests while the adapterless model exists");
  assert.equal(devicePrompts.length, 0);
  // The model caller alone, object still gone: refuses, nothing sent.
  await assert.rejects(() => ai.runPrompt("ONLY_ON_DEVICE", "Thandi Mokoena, thandi@example.com"), (e) => e.code === "DEVICE_UNAVAILABLE");
  assert.equal(requests.length, 0);

  // State 2: the object is there again. Strict runs on the device, without a page reload.
  present = true;
  const two = await H.tidyTable(table, "device", deps);
  assert.equal(two.run.source, "on_device", `strict still says: ${two.run.notice}`);
  assert.equal(two.run.reachedCloud, false);
  assert.equal(devicePrompts.length, 1, "one on-device prompt");
  assert.equal(requests.length, 0, "requests with the adapter model");
  assert.equal(builds, 2);
});
