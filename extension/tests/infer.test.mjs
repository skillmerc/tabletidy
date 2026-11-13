import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyValue, inferColumnType, parseNumber, parseDate, normalise } from "../src/lib/infer.js";

test("classifies single values", () => {
  assert.equal(classifyValue("R 1 234,50"), "money");
  assert.equal(classifyValue("$12.99"), "money");
  assert.equal(classifyValue("1,234"), "number");
  assert.equal(classifyValue("12.5%"), "percent");
  assert.equal(classifyValue("2026/11/03"), "date");
  assert.equal(classifyValue("03 Nov 2026"), "date");
  assert.equal(classifyValue("a@b.co"), "email");
  assert.equal(classifyValue("+27 66 215 0000"), "phone");
  assert.equal(classifyValue("https://example.com/x"), "url");
  assert.equal(classifyValue("Cape Town"), "text");
  assert.equal(classifyValue("  "), null);
});

test("column type needs a clear majority", () => {
  assert.equal(inferColumnType(["R 899,00", "R 12 000,00", "R 1 234,50"]), "money");
  assert.equal(inferColumnType(["2026-11-04", "03 Nov 2026", "2026/11/03", ""]), "date");
  assert.equal(inferColumnType(["1", "two", "3", "four"]), "text");
});

test("parses numbers in many locales", () => {
  assert.equal(parseNumber("R 1 234,50"), 1234.5);
  assert.equal(parseNumber("$1,234.50"), 1234.5);
  assert.equal(parseNumber("1.234,50 EUR"), 1234.5);
  assert.equal(parseNumber("12'000"), 12000);
  assert.equal(parseNumber("1,234"), 1234);
  assert.equal(parseNumber("12,5"), 12.5);
  assert.equal(parseNumber("n/a"), null);
});

test("parses dates to ISO", () => {
  assert.equal(parseDate("2026/11/3"), "2026-11-03");
  assert.equal(parseDate("03/11/2026"), "2026-11-03");
  assert.equal(parseDate("11/25/2026"), "2026-11-25"); // month > 12 swaps
  assert.equal(parseDate("3 Nov 2026"), "2026-11-03");
  assert.equal(parseDate("Nov 3, 2026"), "2026-11-03");
  assert.equal(parseDate("soon"), null);
});

test("normalises by type and keeps unparseable text", () => {
  assert.equal(normalise("R 899,00", "money"), 899);
  assert.equal(normalise("45%", "percent"), 0.45);
  assert.equal(normalise("A@B.CO", "email"), "a@b.co");
  assert.equal(normalise("+27 (66) 215-0000", "phone"), "+27662150000");
  assert.equal(normalise("tbc", "date"), "tbc");
});
