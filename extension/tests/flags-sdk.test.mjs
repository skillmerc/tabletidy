// Task T1 (Reviewer finding H), probe H on the real stack: the real page code (src/app.js) with
// the real model caller (src/ai.js) on the real Firebase AI Logic SDK, and a spy on fetch that
// records every request body. No real cloud call is made. Built during #BuildHybridAI 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ORDERS, goodAnswer } from "./helpers.mjs";

globalThis.self = globalThis;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const t = realSetInterval(...args); t.unref?.(); return t; };
const requests = [];
let script = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url?.url || url), body: typeof init.body === "string" ? init.body : "" });
  const status = script.shift() || 200;
  if (status !== 200) return new Response(JSON.stringify({ error: { code: status, message: "This model is currently experiencing high demand." } }), { status, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: goodAnswer(6) }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
};
const { createApp } = await import("../src/app.js");
const ai = await import("../src/ai.js");
// Invented config: no real project, key or token. App Check has no token here; the spy answers anyway.
ai.configureAI({ firebaseConfig: { apiKey: "test-key-not-real", projectId: "test-project", appId: "1:1:web:test" }, appCheck: { kind: "debug", getToken: async () => "" } });

const TOWN = 3;
function mount() {
  const { document } = parseHTML("<!doctype html><html><body><div id='tt-app'></div></body></html>");
  const root = document.getElementById("tt-app");
  const app = createApp(root, { sleep: async () => {} }); // the real ai.js, no injected model caller
  const $ = (id) => root.querySelector("#" + id);
  const pick = (value) => { for (const r of root.querySelectorAll("input[name=pref]")) { if (r.value === value) r.setAttribute("checked", ""); else r.removeAttribute("checked"); } };
  const fire = (el) => el.dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  const idle = async () => { for (let i = 0; i < 1000 && app.state.busy; i++) await new Promise((r) => setTimeout(r, 2)); await new Promise((r) => setTimeout(r, 2)); };
  const click = async (id) => { fire($(id)); await new Promise((r) => setTimeout(r, 0)); await idle(); };
  const flagButton = (i) => root.querySelectorAll("#cols li")[i].querySelector("button.pii");
  return { app, root, $, pick, click, toggle: (i) => fire(flagButton(i)), flagButton };
}

for (const [pref, statuses, sends] of [["cloud", [200], 1], ["auto", [200], 1], ["cloud", [500, 503, 200], 3], ["auto", [500, 200], 2]]) {
  test(`probe H, real SDK and page: "Town" set to Personal by hand, ${pref}, cloud answers ${statuses.join(", ")}: 0 of 12 raw values in ${sends} request(s), flag kept`, async () => {
    assert.equal("LanguageModel" in globalThis, false);
    requests.length = 0;
    script = statuses.slice();
    const table = ORDERS();
    const raw = table.rows.map((r) => r[TOWN]);
    assert.equal(raw.length, 12);
    const m = mount();
    m.app.setTable(table);
    m.toggle(TOWN);
    m.pick(pref);
    await m.click("tidy");
    const model = requests.filter((r) => /generateContent/.test(r.url));
    assert.equal(model.length, sends, "requests to the model address");
    for (const [n, r] of requests.entries()) {
      const found = raw.filter((v) => r.body.includes(v)).length;
      assert.equal(found, 0, `request ${n + 1} of ${requests.length} holds ${found} of 12 raw Town values`);
    }
    for (const r of model) assert.ok(r.body.includes("[personal]"), "placeholders stand in for the Town values");
    assert.equal(m.$("badge").textContent, "Cloud");
    assert.equal(m.flagButton(TOWN).textContent, "Personal");
    assert.equal(m.flagButton(TOWN).getAttribute("aria-pressed"), "true");
    assert.equal(m.app.state.columns[TOWN].pii, true);
    assert.equal(m.$("sent-note").textContent, "Masked on this device before the request was built: Customer, E-mail address, Cell, Town. This exact text went to Gemini in the cloud.");
    m.app.destroy();
  });
}

test("real SDK and page: On device only with a hand flag and no model object makes no request at all", async () => {
  requests.length = 0;
  script = [];
  const m = mount();
  m.app.setTable(ORDERS());
  m.toggle(TOWN);
  m.pick("device");
  await m.click("tidy");
  assert.equal(requests.length, 0);
  assert.equal(m.flagButton(TOWN).textContent, "Personal");
  m.app.destroy();
});

test.after(() => { globalThis.fetch = realFetch; });
