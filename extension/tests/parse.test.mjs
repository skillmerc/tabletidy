import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { parseInput, parseDelimited, detectDelimiter } from "../src/lib/parse.js";

test("CSV with quotes, embedded commas and doubled quotes", () => {
  const r = parseInput('name,spend,note\n"Nkosi, Thandi","R 1 234,50","said ""hi"""\nPieter,R 899,\n');
  assert.equal(r.ok, true);
  assert.equal(r.format, "CSV");
  assert.deepEqual(r.headers, ["name", "spend", "note"]);
  assert.deepEqual(r.rows[0], ["Nkosi, Thandi", "R 1 234,50", 'said "hi"']);
  assert.deepEqual(r.rows[1], ["Pieter", "R 899", ""]);
});

test("TSV copied from a spreadsheet, and semicolon files", () => {
  const r = parseInput("Ref\tDate\tTotal\nA1\t03/11/2026\t1 234,50\nA2\t04/11/2026\t99,00");
  assert.equal(r.format, "TSV");
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], ["A1", "03/11/2026", "1 234,50"]);
  assert.equal(detectDelimiter("a;b;c\n1,5;2;3"), ";");
  assert.equal(parseDelimited("a;b\n1;2", ";").length, 2);
});

test("HTML table", () => {
  const r = parseInput("<table><tr><th>Customer</th><th>E-mail</th></tr><tr><td>Thandi  Nkosi</td><td><a href='#'>t@mail.example</a></td></tr></table>", DOMParser);
  assert.equal(r.ok, true);
  assert.equal(r.format, "HTML table");
  assert.deepEqual(r.headers, ["Customer", "E-mail"]);
  assert.deepEqual(r.rows, [["Thandi Nkosi", "t@mail.example"]]);
});

test("clear errors for unusable input; blank headers get names; ragged rows are squared", () => {
  assert.equal(parseInput("").ok, false);
  assert.match(parseInput("just one line of prose").error, /Could not find columns/);
  assert.match(parseInput("a,b").error, /header row and at least one data row/);
  const r = parseInput("a,,c\n1,2\n1,2,3,4");
  assert.deepEqual(r.headers, ["a", "col2", "c"]);
  assert.deepEqual(r.rows, [["1", "2", ""], ["1", "2", "3"]]);
});
