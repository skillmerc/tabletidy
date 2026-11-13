// Reused unchanged from List & Table Scraper 1.2.0 (pre-contest work, SKILLMERC). See README 'Built during the contest'.
// Detection and extraction core. Pure DOM code, no network, no browser APIs beyond the DOM.
// Works on the live page and on documents parsed with DOMParser (or linkedom in tests).

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "META", "LINK", "BR", "HR", "IFRAME", "OPTION", "PATH"]);
const MAX_SCAN = 25000;
const MAX_COLUMNS = 100;
const MAX_ROW_ELEMENTS = 400; // rows bigger than this are page sections, not data rows

function cleanClasses(el) {
  const raw = typeof el.className === "string" ? el.className : (el.getAttribute && el.getAttribute("class")) || "";
  return raw
    .split(/\s+/)
    .filter((c) => c && c.length < 40 && !/\d{2,}/.test(c) && !/^(active|selected|hover|focus|odd|even|first|last|is-|js-|has-)/i.test(c))
    .slice(0, 3) // structural classes come first; per-item modifiers and taxonomy tags come later
    .sort();
}

/** Tag plus stable classes, e.g. "div.card.product". Used to group sibling rows. */
export function signature(el) {
  const cls = cleanClasses(el);
  return el.tagName.toLowerCase() + (cls.length ? "." + cls.join(".") : "");
}

export function normText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function textLen(el) {
  return normText(el.textContent).length;
}

function hasLayout(el) {
  return typeof el.getBoundingClientRect === "function" && typeof window !== "undefined" && window.document === el.ownerDocument;
}

function areaOf(el) {
  if (!hasLayout(el)) return null;
  const r = el.getBoundingClientRect();
  return Math.max(0, r.width) * Math.max(0, r.height);
}

/**
 * Find candidate blocks of repeated data.
 * Returns [{ container, rowSig, rows, score }] sorted best first.
 * opts.exclude: an element (e.g. our own panel host) to ignore.
 */
export function findCandidates(doc, opts = {}) {
  const body = doc.body || doc.documentElement;
  if (!body) return [];
  const out = [];
  const all = body.querySelectorAll("*");
  const n = Math.min(all.length, MAX_SCAN);
  for (let i = -1; i < n; i++) {
    const el = i < 0 ? body : all[i];
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) continue;
    if (opts.exclude && (el === opts.exclude || opts.exclude.contains(el))) continue;
    const kids = Array.from(el.children).filter((c) => !SKIP_TAGS.has(c.tagName.toUpperCase()));
    if (kids.length < 3) continue;
    const groups = new Map();
    const byTag = new Map();
    for (const k of kids) {
      const s = signature(k);
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(k);
      const t = k.tagName.toLowerCase();
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t).push(k);
    }
    // Fallback: siblings with the same tag but no shared class set (e.g. per-item CSS classes).
    for (const [t, list] of byTag) {
      if (list.length < 3) continue;
      const covered = Array.from(groups.entries()).some(([sig, rows]) => rows.length >= 3 && rows[0].tagName.toLowerCase() === t);
      if (!covered) groups.set(`${t}*`, list);
    }
    let best = null;
    for (const [sig, rows] of groups) {
      if (rows.length < 3) continue;
      let total = 0, withContent = 0, size = 0;
      for (const r of rows) size += r.querySelectorAll("*").length;
      if (size / rows.length > MAX_ROW_ELEMENTS) continue;
      for (const r of rows) {
        const t = textLen(r);
        total += t;
        if (t > 0 || r.querySelector("img")) withContent++;
      }
      if (withContent < 3) continue;
      const homogeneity = rows.length / kids.length;
      let score = Math.sqrt(total) * Math.min(rows.length, 200) * Math.sqrt(homogeneity) * (withContent / rows.length);
      if (rows[0].tagName.toUpperCase() === "TR") score *= 2; // real tables are explicit data
      const area = areaOf(el);
      if (area !== null) {
        if (area === 0) continue; // hidden block
        score *= 1 + Math.min(1, Math.sqrt(area) / 1000);
      }
      if (!best || score > best.score) best = { container: el, rowSig: sig, rows, score };
    }
    if (best) out.push(best);
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.limit || 15);
}

/** Child-path segment: signature plus index among same-signature siblings. */
function cellSpan(el) {
  const n = Number(el.getAttribute && el.getAttribute("colspan"));
  return n > 0 && n < 100 ? n : 1;
}

function rowSpan(el) {
  const n = Number(el.getAttribute && el.getAttribute("rowspan"));
  return n > 0 && n < 1000 ? n : 1;
}

// Column position of every cell in a table section, honouring colspan and rowspan.
let CELL_POS = null;
function mapCells(container) {
  const pos = new Map();
  const left = [];
  for (const tr of container.children) {
    if (tr.tagName.toUpperCase() !== "TR") continue;
    let col = 0;
    for (const cell of tr.children) {
      if (!/^(TD|TH)$/i.test(cell.tagName)) continue;
      while (left[col] > 0) col++;
      pos.set(cell, col);
      const cs = cellSpan(cell), rs = rowSpan(cell);
      for (let k = 0; k < cs; k++) left[col + k] = rs;
      col += cs;
    }
    for (let k = 0; k < left.length; k++) if (left[k] > 0) left[k]--;
  }
  return pos;
}

function segment(el) {
  const tag = el.tagName.toUpperCase();
  if (tag === "TD" || tag === "TH") {
    // Table cells are keyed by column position (colspan and rowspan aware), so cells line up with headers.
    let pos = CELL_POS && CELL_POS.has(el) ? CELL_POS.get(el) : null;
    if (pos === null) {
      pos = 0;
      for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
        const t = p.tagName.toUpperCase();
        if (t === "TD" || t === "TH") pos += cellSpan(p);
      }
    }
    const cls = cleanClasses(el);
    const base = "td" + (cls.length ? "." + cls.join(".") : "");
    return pos ? `${base}[${pos}]` : base;
  }
  const sig = signature(el);
  let idx = 0;
  let p = el.previousElementSibling;
  while (p) { if (signature(p) === sig) idx++; p = p.previousElementSibling; }
  return idx ? `${sig}[${idx}]` : sig;
}

function ownText(el) {
  let s = "";
  for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue + " ";
  return normText(s);
}

function absUrl(v, base) {
  if (!v) return "";
  try { return new URL(v, base).href; } catch { return v; }
}

function parseSeg(seg) {
  const m = seg.match(/^([a-z0-9-]+)((?:\.[^.[\]]+)*)(?:\[(\d+)\])?$/i);
  if (!m) return { tag: seg, classes: [], idx: 0 };
  return { tag: m[1], classes: m[2] ? m[2].slice(1).split(".") : [], idx: m[3] ? Number(m[3]) : 0 };
}

/** Readable default column name: nearest class name on the path, plus position and kind. */
function shortName(path, kind) {
  const segs = path.split(" > ").filter((x) => x !== ".").map(parseSeg);
  const last = segs[segs.length - 1];
  let base = "";
  if (last) {
    for (let i = segs.length - 1; i >= 0 && !base; i--) if (segs[i].classes.length) base = segs[i].classes[segs[i].classes.length - 1];
    if (!base) base = last.tag === "img" ? "image" : last.tag === "a" ? "link" : last.tag;
    if (last.idx) base += " " + (last.idx + 1);
  } else base = "row";
  if (kind === "text") return base;
  if (kind === "image" && /^image( \d+)?$/.test(base)) return base;
  if (kind === "link" && /^link( \d+)?$/.test(base)) return base + " url";
  return `${base} ${kind}`;
}

/** Map of field key -> value for one row element. */
export function rowFields(row, baseUrl) {
  const fields = new Map();
  const add = (k, v) => { if (v && !fields.has(k)) fields.set(k, v); };
  const walk = (el, path) => {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return;
    if (path !== "." && /^(TD|TH)$/i.test(el.tagName)) {
      // A table cell is one unit: its full text, its first link and its first image.
      const txt = normText(el.textContent);
      if (txt && /[\p{L}\p{N}]/u.test(txt)) add(path + "|text", txt);
      const a = el.querySelector("a[href]");
      if (a && !/^(javascript:|#)/i.test(a.getAttribute("href"))) add(path + "|link", absUrl(a.getAttribute("href"), baseUrl));
      const img = el.querySelector("img");
      if (img) add(path + "|image", absUrl(img.getAttribute("src") || img.getAttribute("data-src") || "", baseUrl));
      return;
    }
    const t = ownText(el);
    if (t && /[\p{L}\p{N}]/u.test(t)) add(path + "|text", t);
    const tag = el.tagName.toUpperCase();
    if (tag === "A" && el.getAttribute("href") && !/^(javascript:|#$)/i.test(el.getAttribute("href"))) add(path + "|link", absUrl(el.getAttribute("href"), baseUrl));
    if (tag === "IMG") add(path + "|image", absUrl(el.getAttribute("src") || el.getAttribute("data-src") || "", baseUrl));
    for (const c of el.children) walk(c, path + " > " + segment(c));
  };
  walk(row, ".");
  return fields;
}

function headerNames(container) {
  // Name table columns from header cells when the block is a table body.
  const table = container.closest ? container.closest("table") : null;
  if (!table) return null;
  const head = table.querySelector("thead tr") || table.querySelector("tr");
  if (!head) return null;
  const ths = Array.from(head.children).filter((c) => c.tagName.toUpperCase() === "TH");
  if (!ths.length) return null;
  const names = [];
  for (const th of ths) {
    const span = cellSpan(th);
    for (let i = 0; i < span; i++) names.push(normText(th.textContent) + (span > 1 ? ` ${i + 1}` : ""));
  }
  return names;
}

/**
 * Extract a table from a candidate.
 * Returns { columns: [{ key, name }], rows: [[...values]] }.
 * opts.keys: reuse a fixed column key list (pagination keeps page 1 columns).
 * opts.minFill: fraction of rows a column must be filled in (default 0.3).
 */
export function extract(cand, baseUrl, opts = {}) {
  const minFill = opts.minFill ?? 0.3;
  const isHeaderRow = (r) => r.tagName.toUpperCase() === "TR" && r.children.length > 0 && Array.from(r.children).every((c) => c.tagName.toUpperCase() === "TH");
  const rowEls = cand.rows.filter((r) => !isHeaderRow(r));
  CELL_POS = rowEls.length && rowEls[0].tagName.toUpperCase() === "TR" ? mapCells(cand.container) : null;
  let maps;
  try { maps = rowEls.map((r) => rowFields(r, baseUrl)); } finally { CELL_POS = null; }
  let keys = opts.keys;
  if (!keys) {
    const count = new Map(), order = [];
    for (const m of maps) for (const k of m.keys()) { if (!count.has(k)) { count.set(k, 0); order.push(k); } count.set(k, count.get(k) + 1); }
    keys = order.filter((k) => count.get(k) >= Math.max(1, Math.ceil(maps.length * minFill))).slice(0, MAX_COLUMNS);
  }
  const heads = headerNames(cand.container);
  const used = new Map();
  const columns = keys.map((key) => {
    const [path, kind] = key.split("|");
    let name = shortName(path, kind);
    const cell = path.split(" > ")[1];
    if (heads && cell && /^t[dh]/i.test(cell)) {
      const m = cell.match(/\[(\d+)\]$/);
      const h = heads[m ? Number(m[1]) : 0];
      if (h) name = kind === "text" ? (path.split(" > ").length === 2 ? h : `${h} text`) : `${h} ${kind}`;
    }
    const n = (used.get(name) || 0) + 1;
    used.set(name, n);
    return { key, name: n > 1 ? `${name} (${n})` : name };
  });
  const rows = dedupeRows(maps.map((m) => keys.map((k) => m.get(k) || "")).filter((r) => r.some((v) => v)));
  return { columns, rows };
}

export function dedupeRows(rows, seen = new Set()) {
  const out = [];
  for (const r of rows) {
    const k = JSON.stringify(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Find the candidate in a (new) document that matches an earlier pick. */
export function rematch(doc, picked, opts = {}) {
  const cands = findCandidates(doc, { ...opts, limit: 50 });
  const parentSig = signature(picked.container);
  const same = cands.filter((c) => c.rowSig === picked.rowSig);
  if (!same.length) return null;
  return same.find((c) => signature(c.container) === parentSig) || same[0];
}

/** CSS path for an element, used to find the Next button again on a later page. */
export function cssPath(el) {
  const parts = [];
  let e = el;
  while (e && e.nodeType === 1 && e.tagName.toUpperCase() !== "HTML") {
    if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { parts.unshift(`#${e.id}`); break; }
    let i = 1, p = e.previousElementSibling;
    while (p) { if (p.tagName === e.tagName) i++; p = p.previousElementSibling; }
    parts.unshift(`${e.tagName.toLowerCase()}:nth-of-type(${i})`);
    e = e.parentElement;
  }
  return parts.join(" > ");
}

/** Locate the Next control in a document: same CSS path, then same link text, then rel=next. */
export function findNext(doc, spec) {
  if (!spec) return null;
  let el = null;
  try { el = doc.querySelector(spec.path); } catch { el = null; }
  const textOk = (x) => x && (!spec.text || normText(x.textContent) === spec.text);
  if (el && textOk(el)) return el;
  const want = spec.text;
  if (want) {
    const pool = doc.querySelectorAll("a, button, [role=button], input[type=button], input[type=submit]");
    for (const x of pool) if (normText(x.textContent || x.value) === want) return x;
  }
  return doc.querySelector("a[rel~=next], link[rel~=next]");
}
