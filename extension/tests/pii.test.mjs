import { test } from "node:test";
import assert from "node:assert/strict";
import { scanColumn, maskValue, maskRows } from "../src/lib/pii.js";

test("flags emails, phones and cards by value", () => {
  assert.equal(scanColumn("col2", ["a@x.com", "b@y.org", "c@z.net"]).kind, "email");
  assert.equal(scanColumn("col3", ["+27 66 215 0001", "082 555 1234", "(011) 555-1234"]).pii, true);
  assert.equal(scanColumn("x", ["4111 1111 1111 1111", "4111 1111 1111 1111"]).kind, "card");
});

test("person names need a personal header", () => {
  const names = ["Thandi Nkosi", "Pieter van Wyk", "Mary-Ann Smith"];
  assert.equal(scanColumn("Customer", names).pii, true);
  assert.equal(scanColumn("Product", ["Desk Lamp", "Office Chair", "Paper Tray"]).pii, false);
});

test("plain business data is not personal", () => {
  assert.equal(scanColumn("City", ["Cape Town", "Durban", "Johannesburg"]).pii, false);
  assert.equal(scanColumn("Price", ["R 10,00", "R 20,00", "R 30,00"]).pii, false);
});

test("masking keeps shape, drops content, never mutates input", () => {
  assert.equal(maskValue("+27 66 215 0001", "phone"), "+00 00 000 0000");
  assert.equal(maskValue("thandi@x.com", "email"), "name@example.com");
  const rows = [["Thandi Nkosi", "Durban"], ["Pieter van Wyk", "Cape Town"]];
  const out = maskRows(rows, [{ pii: true, kind: "person" }, { pii: false }]);
  assert.deepEqual(out, [["Person Name", "Durban"], ["Person Name", "Cape Town"]]);
  assert.equal(rows[0][0], "Thandi Nkosi");
});
