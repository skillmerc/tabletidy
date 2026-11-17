// Reviewer follow-up T7 (17 Nov 2026): masking on a LARGE table that really has flagged columns.
// The older large-table cases used the Shipment log sample, which has no flagged column, so they
// had no raw value to look for. This table has 400 rows and 6 columns, and the on-device rules
// flag two of them (E-mail and Cell). Every cloud request body, retries included, is searched for
// every raw value of those two columns. Fakes only: no browser, no real cloud call.
// Built during #BuildHybridAI 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "../src/lib/hybrid.js";
import * as T from "../src/lib/tidy.js";
import { fakeSdk, flaggedValues } from "./helpers.mjs";

const ROWS = 400, COLS = 6, EMAIL = 1, CELL = 2;
const DEPOTS = ["Durban", "Paarl", "Polokwane", "Gqeberha", "Kimberley"];
const pad = (n, w) => String(n).padStart(w, "0");
/** 400 rows, 6 columns. Every e-mail address and every cell number is different from all others. */
const BIG = () => ({
  label: "Delivery contacts",
  headers: ["Ref", "E-mail", "Cell", "Depot", "Units", "Shipped"],
  rows: Array.from({ length: ROWS }, (_, i) => [
    `SH-${10001 + i}`,
    `buyer${pad(i + 1, 3)}@post-test.example`,
    `+27 82 ${100 + (i % 900)} ${1000 + i}`,
    DEPOTS[i % DEPOTS.length],
    String(1 + (i % 48)),
    `2026-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 28), 2)}`,
  ]),
});
const guarded = (sdk) => H.makeRunPrompt({ getModel: sdk.getModel, hasDeviceApi: sdk.hasDeviceApi, deviceStatus: sdk.deviceStatus });
/** The raw values that are in the text, as a list (so a failure can name one). */
const rawIn = (text, raw) => raw.filter((v) => String(text).includes(v));
/** The two flagged columns' raw values, taken from the table itself and checked before use. */
function rawValues(table) {
  const local = T.localAnalysis(table.headers, table.rows);
  const raw = flaggedValues(table, local);
  return { local, raw };
}

test("the large masking table is a fair test: 400 rows, 6 columns, large by the routing rule, E-mail and Cell flagged by the on-device rules, 800 raw values to look for", () => {
  const table = BIG();
  assert.equal(table.rows.length, ROWS);
  assert.equal(table.headers.length, COLS);
  assert.ok(table.rows.every((r) => r.length === COLS));
  assert.ok(ROWS * COLS > T.LARGE_TABLE_CELLS, "large by the routing rule");
  assert.equal(T.route(ROWS, COLS, "auto").mode, "PREFER_IN_CLOUD");
  assert.equal(T.route(ROWS, COLS, "cloud").mode, "ONLY_IN_CLOUD");
  const { local, raw } = rawValues(table);
  // Flagged by the rules alone: no page flags are passed anywhere in this file.
  assert.deepEqual(local.filter((c) => c.pii).map((c) => c.original), ["E-mail", "Cell"]);
  assert.equal(local[EMAIL].piiKind, "email");
  assert.equal(local[CELL].piiKind, "phone");
  // The values searched for: not an empty list, no empty string, all different, all from the table.
  assert.equal(raw.length, 2 * ROWS);
  assert.ok(raw.every((v) => typeof v === "string" && v.trim().length > 8));
  assert.equal(new Set(raw).size, 2 * ROWS);
  const inTable = new Set(table.rows.flatMap((r) => [r[EMAIL], r[CELL]]));
  assert.ok(raw.every((v) => inTable.has(v)), "every value searched for is a real cell of the table");
  // No raw value is its own placeholder, so a masked body cannot hold one by accident.
  assert.ok(raw.every((v) => v !== "name@example.com" && /[1-9]/.test(v)));
  // The search itself works: the same sample WITHOUT masking holds raw values (40 sample rows, 2 columns).
  for (const pref of ["auto", "cloud"]) {
    const plan = T.route(ROWS, COLS, pref);
    assert.equal(plan.mask, true);
    const unmasked = T.buildPrompt(table.headers, table.rows, local, { ...plan, mask: false }).text;
    assert.equal(rawIn(unmasked, raw).length, 2 * plan.sampleRows, `${pref}: the unmasked sample holds the raw values, so the search can find them`);
    const masked = T.buildPrompt(table.headers, table.rows, local, plan).text;
    assert.equal(rawIn(masked, raw).length, 0);
  }
});

const STATES = [
  { name: "built-in model absent", sdk: { api: "none" } },
  { name: "built-in model unavailable", sdk: { api: "unavailable" } },
  { name: "built-in model downloadable", sdk: { api: "downloadable" } },
  { name: "built-in model available but answering garbage", sdk: { api: "available", device: "garbage" } },
];

test("large table with flagged E-mail and Cell columns, Auto and Cloud, four built-in model states, cloud answers 500, 500, 200: 3 sends each, 0 of 24 request bodies hold a flagged raw value", async () => {
  let bodies = 0, bodiesWithRaw = 0, rawFound = 0, devicePrompts = 0, devicePromptsWithRaw = 0, cases = 0;
  for (const pref of ["auto", "cloud"]) for (const st of STATES) {
    const where = `${pref}, ${st.name}`;
    const table = BIG();
    const { raw } = rawValues(table);
    assert.equal(raw.length, 2 * ROWS, where);
    const sdk = fakeSdk({ ...st.sdk, cols: COLS, cloud: [500, 500, "ok"] });
    const waits = [];
    const out = await H.tidyTable(table, pref, { runPrompt: guarded(sdk), deviceStatus: sdk.deviceStatus, sleep: async (ms) => { waits.push(ms); } });
    cases++;
    assert.equal(sdk.cloudCalls.length, 3, `${where}: cloud sends`);
    assert.deepEqual(waits, [1000, 3000], where);
    assert.equal(sdk.maxInFlight, 1, `${where}: one at a time`);
    for (const [n, body] of sdk.cloudCalls.entries()) {
      assert.equal(typeof body, "string");
      assert.ok(body.length > 500, `${where}: request body ${n + 1} is a real prompt`);
      assert.ok(body.includes("E-mail") && body.includes("Cell"), `${where}: the headers still go, only the values are masked`);
      assert.ok(body.includes("name@example.com") && body.includes("+00 00 000 0000"), `${where}: the placeholders stand in for the values`);
      assert.ok(body.includes("SH-10001") && body.includes("Durban"), `${where}: the columns that are not flagged go as they are`);
      const found = rawIn(body, raw);
      bodies++; rawFound += found.length; if (found.length) bodiesWithRaw++;
      assert.equal(found.length, 0, `${where}: request body ${n + 1} of 3 holds ${found.length} of ${raw.length} flagged raw values, the first is ${JSON.stringify(found[0])}`);
    }
    for (const prompt of sdk.deviceCalls) {
      const found = rawIn(prompt, raw);
      devicePrompts++; if (found.length) devicePromptsWithRaw++;
      assert.equal(found.length, 0, `${where}: the on-device prompt holds ${found.length} flagged raw values`);
    }
    // Only Auto with a ready model reaches the device: the SDK falls back to it after the first failed cloud call.
    assert.equal(sdk.deviceCalls.length, pref === "auto" && st.sdk.api === "available" ? 1 : 0, `${where}: on-device prompts`);
    assert.equal(rawIn(out.run.sent, raw).length, 0, `${where}: What the model saw`);
    assert.deepEqual(out.run.masked, ["E-mail", "Cell"], where);
    assert.equal(out.run.mask, true, where);
    assert.equal(out.run.source, "in_cloud", where);
    assert.match(out.run.reason, /answered on try 3 of 3/, where);
    assert.equal(out.columns[EMAIL].pii, true, where);
    assert.equal(out.columns[CELL].pii, true, where);
  }
  // The counts, so this test cannot pass on an empty list.
  assert.equal(cases, 8);
  assert.equal(bodies, 24, "request bodies checked");
  assert.equal(bodiesWithRaw, 0, "request bodies holding a flagged raw value");
  assert.equal(rawFound, 0, "flagged raw values found in all request bodies");
  assert.equal(devicePrompts, 1, "on-device prompts checked");
  assert.equal(devicePromptsWithRaw, 0);
});
