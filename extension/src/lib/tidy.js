// Routing, prompt building and merging of model output. Built during #BuildHybridAI 2026.
// Pure functions (no Firebase, no DOM) so they are unit tested in tests/tidy.test.mjs.
import { TYPES, inferColumnType, normalise, parseDate, parseNumber } from "./infer.js";
import { scanColumn, maskRows } from "./pii.js";

/** Tables bigger than this go to the cloud model first (Gemini Nano has a small context window). */
export const LARGE_TABLE_CELLS = 1500;
export const SAMPLE_ROWS = { device: 12, cloud: 40 };

/**
 * Decide where a run should go and what it may contain.
 * pref: "auto" | "device" (strict privacy, never leaves this device) | "cloud".
 * Returns { mode, sampleRows, mask, reason } where mode is a Firebase AI Logic InferenceMode key.
 */
export function route(rowCount, colCount, pref = "auto") {
  const cells = rowCount * colCount;
  if (pref === "device") return { mode: "ONLY_ON_DEVICE", sampleRows: SAMPLE_ROWS.device, mask: false, reason: "Strict privacy: on device only" };
  if (pref === "cloud") return { mode: "ONLY_IN_CLOUD", sampleRows: SAMPLE_ROWS.cloud, mask: true, reason: "Cloud chosen in settings" };
  if (cells > LARGE_TABLE_CELLS) return { mode: "PREFER_IN_CLOUD", sampleRows: SAMPLE_ROWS.cloud, mask: true, reason: `Large table (${cells.toLocaleString("en")} cells)` };
  return { mode: "PREFER_ON_DEVICE", sampleRows: SAMPLE_ROWS.device, mask: true, reason: `Small table (${cells.toLocaleString("en")} cells)` };
}

/** Local, model-free analysis of every column: type + personal-data flag. */
export function localAnalysis(headers, rows) {
  return headers.map((h, i) => {
    const vals = rows.map((r) => r[i]);
    const pii = scanColumn(h, vals);
    return { index: i, original: h, name: h, type: inferColumnType(vals), pii: pii.pii, piiKind: pii.kind, piiReason: pii.reason, piiBy: pii.pii ? "device rules" : null };
  });
}

/** Evenly spread sample so long tables show their start, middle and end. */
export function sampleRows(rows, n) {
  if (rows.length <= n) return rows.slice();
  const step = rows.length / n;
  return Array.from({ length: n }, (_, k) => rows[Math.floor(k * step)]);
}

const csvCell = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").slice(0, 80); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * Build the prompt. When `mask` is true, columns flagged by `local` are replaced by
 * shape-only placeholders BEFORE the text is assembled, so raw personal data never
 * appears in a request that might be served by the cloud.
 */
export function buildPrompt(headers, rows, local, { sampleRows: n, mask }) {
  let sample = sampleRows(rows, n);
  if (mask) sample = maskRows(sample, local.map((c) => ({ pii: c.pii, kind: c.piiKind })));
  const csv = [headers.map((h, i) => csvCell(h || `col${i}`)), ...sample.map((r) => r.map(csvCell))].map((r) => r.join(",")).join("\n");
  return {
    sample,
    text:
      "You clean up tables scraped from web pages. For each column of the CSV sample below return: its 0-based index, " +
      "a short human header name in Title Case (max 4 words; replace scraper names like 'col3' or 'a href'), " +
      `its data type (one of ${TYPES.join(", ")}), and personalData=true if it holds data about a private person ` +
      "(names, emails, phone numbers, home addresses, ID numbers). Values like 'name@example.com', 'Person Name', '[personal]' " +
      "or all-zero numbers are masked personal data. Also return a short title for the whole table.\n\n" + csv,
  };
}

/** Firebase AI Logic structured-output schema, expressed as plain JSON Schema (used for both runtimes). */
export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          name: { type: "string" },
          type: { type: "string", enum: TYPES },
          personalData: { type: "boolean" },
        },
        required: ["index", "name", "type", "personalData"],
      },
    },
  },
  required: ["title", "columns"],
};

/** Parse model text into an object; tolerates ```json fences. Returns null when unusable. */
export function parseModelJSON(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    return o && Array.isArray(o.columns) ? o : null;
  } catch { return null; }
}

const PARSERS = { number: parseNumber, money: parseNumber, percent: parseNumber, date: (v) => parseDate(v) };

/** Does a proposed type actually fit the values? (60% must parse) */
export function typeFits(type, values) {
  const p = PARSERS[type];
  if (!p) return true;
  const vals = values.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (!vals.length) return true;
  return vals.filter((v) => p(v) != null).length / vals.length >= 0.6;
}

/**
 * Merge model output into the local analysis. The model can rename, retype (if the values
 * fit) and ADD personal-data flags. It can never remove a flag set by the device rules.
 */
export function mergeColumns(local, model, rows) {
  const byIndex = new Map((model?.columns || []).map((c) => [c.index, c]));
  return local.map((c) => {
    const m = byIndex.get(c.index);
    if (!m) return { ...c };
    const vals = rows.map((r) => r[c.index]);
    const name = String(m.name || "").trim().slice(0, 40) || c.name;
    const type = TYPES.includes(m.type) && typeFits(m.type, vals) ? m.type : c.type;
    const modelPii = m.personalData === true;
    return {
      ...c,
      name,
      type,
      pii: c.pii || modelPii,
      piiBy: c.pii ? c.piiBy : modelPii ? "model" : null,
      piiReason: c.pii ? c.piiReason : modelPii ? "flagged by the model" : c.piiReason,
    };
  });
}

/** Rows ready for export: optional clean values, optional drop of personal-data columns. */
export function exportTable(columns, rows, { clean = true, dropPii = true } = {}) {
  const keep = columns.filter((c) => !(dropPii && c.pii));
  return {
    headers: keep.map((c) => c.name),
    rows: rows.map((r) => keep.map((c) => (clean ? normalise(r[c.index], c.type) : r[c.index] ?? ""))),
  };
}
