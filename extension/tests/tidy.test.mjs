import { test } from "node:test";
import assert from "node:assert/strict";
import { route, localAnalysis, buildPrompt, parseModelJSON, mergeColumns, exportTable, sampleRows, LARGE_TABLE_CELLS } from "../src/lib/tidy.js";

const headers = ["col1", "Customer", "email", "a href"];
const rows = [
  ["R 1 234,50", "Thandi Nkosi", "thandi@mail.example", "https://shop.example/1"],
  ["R 899,00", "Pieter van Wyk", "pieter@mail.example", "https://shop.example/2"],
  ["R 12 000,00", "Mary-Ann Smith", "mary@mail.example", "https://shop.example/3"],
];

test("routing: small -> prefer on device, large -> prefer cloud, settings override", () => {
  assert.equal(route(10, 4).mode, "PREFER_ON_DEVICE");
  assert.equal(route(LARGE_TABLE_CELLS, 2).mode, "PREFER_IN_CLOUD");
  assert.equal(route(10, 4, "device").mode, "ONLY_ON_DEVICE");
  assert.equal(route(10, 4, "device").mask, false);
  assert.equal(route(10, 4, "cloud").mode, "ONLY_IN_CLOUD");
  for (const p of ["auto", "cloud"]) assert.equal(route(10, 4, p).mask, true, "anything that can reach the cloud is masked");
});

test("prompt never contains personal values when masking", () => {
  const local = localAnalysis(headers, rows);
  assert.deepEqual(local.map((c) => c.pii), [false, true, true, false]);
  const { text } = buildPrompt(headers, rows, local, route(3, 4));
  for (const r of rows) { assert.ok(!text.includes(r[1]), "name leaked"); assert.ok(!text.includes(r[2]), "email leaked"); }
  assert.ok(text.includes("R 899,00"), "non-personal data is kept");
  const strict = buildPrompt(headers, rows, local, route(3, 4, "device"));
  assert.ok(strict.text.includes("Thandi Nkosi"), "on-device-only prompt keeps raw values");
});

test("model output: parse, merge, never un-flag, reject types that do not fit", () => {
  const local = localAnalysis(headers, rows);
  const model = parseModelJSON('```json\n{"title":"Orders","columns":[{"index":0,"name":"Amount","type":"money","personalData":false},{"index":1,"name":"Customer","type":"text","personalData":false},{"index":3,"name":"Link","type":"date","personalData":true}]}\n```');
  const cols = mergeColumns(local, model, rows);
  assert.equal(cols[0].name, "Amount");
  assert.equal(cols[0].type, "money");
  assert.equal(cols[1].pii, true, "device flag survives the model saying false");
  assert.equal(cols[3].type, "url", "date does not fit URLs, keep local type");
  assert.equal(cols[3].pii, true, "model may add a flag");
  assert.equal(cols[3].piiBy, "model");
  assert.equal(parseModelJSON("CPU backend ... Model: "), null, "garbage answer is rejected");
});

test("export drops personal columns and cleans values", () => {
  const cols = mergeColumns(localAnalysis(headers, rows), { columns: [{ index: 0, name: "Amount", type: "money", personalData: false }] }, rows);
  const t = exportTable(cols, rows);
  assert.deepEqual(t.headers, ["Amount", "a href"]);
  assert.deepEqual(t.rows[0], [1234.5, "https://shop.example/1"]);
  const raw = exportTable(cols, rows, { clean: false, dropPii: false });
  assert.equal(raw.headers.length, 4);
  assert.equal(raw.rows[0][0], "R 1 234,50");
});

test("sample spreads across the table", () => {
  const big = Array.from({ length: 100 }, (_, i) => [String(i)]);
  const s = sampleRows(big, 10);
  assert.equal(s.length, 10);
  assert.equal(s[0][0], "0");
  assert.equal(s[9][0], "90");
});
