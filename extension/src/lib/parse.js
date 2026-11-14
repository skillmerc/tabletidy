// Turn pasted text into a table: HTML <table>, CSV, TSV or semicolon-separated.
// Built during #BuildHybridAI 2026. Used by the hosted playground; unit tested in tests/parse.test.mjs.

export const MAX_ROWS = 5000;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Split delimited text into rows of cells. Handles quotes, doubled quotes and newlines inside quotes. */
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text ?? "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => clean(c) !== ""));
}

/** Pick the delimiter that gives the most columns consistently on the first lines. */
export function detectDelimiter(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ",", bestScore = 0;
  for (const d of ["\t", ",", ";", "|"]) {
    const counts = lines.map((l) => parseDelimited(l, d)[0]?.length || 1);
    const cols = counts[0];
    if (cols < 2) continue;
    const score = cols * (counts.filter((c) => c === cols).length / counts.length) * (d === "\t" ? 1.5 : 1);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return bestScore ? best : null;
}

/** First <table> in an HTML string. Needs a DOMParser (the browser's, or linkedom's in tests). */
export function parseHTMLTable(html, Parser = globalThis.DOMParser) {
  const doc = new Parser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
  const t = doc.querySelector("table");
  if (!t) return null;
  const grid = [...t.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => clean(c.textContent))).filter((r) => r.length);
  return grid.length ? grid : null;
}

/**
 * Parse pasted text. The first row is the header row. Short rows are padded and long rows
 * cut to the header width. Returns { ok, headers, rows, format, label } or { ok: false, error }.
 */
export function parseInput(text, Parser = globalThis.DOMParser) {
  const src = String(text ?? "").trim();
  if (!src) return { ok: false, error: "Paste a table first: HTML, CSV or tab-separated (copied from a spreadsheet)." };
  let grid, format;
  if (/<table[\s>]/i.test(src)) {
    grid = parseHTMLTable(src, Parser); format = "HTML table";
    if (!grid) return { ok: false, error: "That HTML has a table tag but no rows." };
  } else {
    const d = detectDelimiter(src);
    if (!d) return { ok: false, error: "Could not find columns. Use commas, tabs or semicolons between values, one row per line." };
    grid = parseDelimited(src, d); format = d === "\t" ? "TSV" : d === "," ? "CSV" : `"${d}"-separated`;
  }
  if (grid.length < 2) return { ok: false, error: "Need a header row and at least one data row." };
  const width = grid[0].length;
  if (width < 2) return { ok: false, error: "Need at least two columns." };
  const headers = grid[0].map((h, i) => clean(h) || `col${i + 1}`);
  const rows = grid.slice(1, MAX_ROWS + 1).map((r) => Array.from({ length: width }, (_, i) => clean(r[i])));
  return { ok: true, headers, rows, format, label: `Pasted ${format}`, truncated: grid.length - 1 > MAX_ROWS };
}
