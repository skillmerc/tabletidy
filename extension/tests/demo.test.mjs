// The hosted demo page (site/index.html, https://tabletidy-82369.web.app) must stay in step with the
// engine: every sample is found, typed and routed the way the page says. Built during #BuildHybridAI 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseHTML } from "linkedom";
import { findCandidates, extract } from "../src/lib/detect.js";
import { localAnalysis, route, buildPrompt, LARGE_TABLE_CELLS } from "../src/lib/tidy.js";

const html = fs.readFileSync(new URL("../../site/index.html", import.meta.url), "utf8");
const { document } = parseHTML(html);
const scanned = findCandidates(document, { limit: 12 }).map((c) => {
  const res = extract(c, "https://tabletidy-82369.web.app/");
  return { el: c.container, headers: res.columns.map((x) => x.name), rows: res.rows };
});
// Most specific match first: the element itself, then something inside it, then a wrapper around it.
const byId = (id) => scanned.find((t) => t.el.id === id) || scanned.find((t) => t.el.closest?.(`#${id}`)) || scanned.find((t) => t.el.querySelector?.(`#${id}`));

test("demo page: all four samples are detected", () => {
  for (const id of ["orders", "pricelist", "shipmentlog", "events"]) assert.ok(byId(id), `sample #${id} not detected`);
  assert.equal(byId("orders").rows.length, 12);
  assert.equal(byId("pricelist").rows.length, 10);
  assert.equal(byId("shipmentlog").rows.length, 260);
  assert.equal(byId("events").rows.length, 8);
});

test("demo page: orders table flags name, email and phone on the device and masks them", () => {
  const t = byId("orders");
  const local = localAnalysis(t.headers, t.rows);
  const flagged = local.filter((c) => c.pii).map((c) => c.piiKind).sort();
  assert.deepEqual(flagged, ["email", "person", "phone"]);
  const r = route(t.rows.length, t.headers.length, "auto");
  assert.equal(r.mode, "PREFER_ON_DEVICE");
  const p = buildPrompt(t.headers, t.rows, local, r);
  assert.ok(!/Mokoena|example\.org|555 01/.test(p.text), "raw personal data must not be in the prompt");
});

test("demo page: price list parses as money and dates", () => {
  const t = byId("pricelist");
  const types = localAnalysis(t.headers, t.rows).map((c) => c.type);
  assert.ok(types.includes("money"), `types: ${types}`);
  assert.ok(types.includes("date"), `types: ${types}`);
});

test("demo page: shipment log is above the cloud routing limit", () => {
  const t = byId("shipmentlog");
  assert.ok(t.rows.length * t.headers.length > LARGE_TABLE_CELLS);
  const r = route(t.rows.length, t.headers.length, "auto");
  assert.equal(r.mode, "PREFER_IN_CLOUD");
  assert.equal(r.mask, true);
});

test("demo page: event cards become rows with a real date column", () => {
  const t = byId("events");
  const local = localAnalysis(t.headers, t.rows);
  assert.equal(local[1].type, "date");
  assert.equal(t.headers.length, 5);
});
