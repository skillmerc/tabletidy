// Deterministic column typing and value normalising. Built during #BuildHybridAI 2026.
// Used two ways: (1) as the fallback when no model answers, (2) to turn the model's
// per-column type into clean values on export. No network, no model.

const WEEKDAY = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(?=\d|[a-z]{3})/i;
export const TYPES = ["text", "number", "money", "percent", "date", "email", "phone", "url"];

const RE = {
  email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
  url: /^(https?:\/\/|www\.)\S+$/i,
  percent: /^[-+]?\d+(?:[.,]\d+)?\s?%$/,
  // currency symbol or ISO code before/after a number: "R 1 234,50", "$12.99", "12,00 EUR"
  money: /^(?:[-+]?\s?(?:[$€£¥₹]|R|US\$|[A-Z]{3})\s?[-+]?\d[\d\s.,']*|[-+]?\d[\d\s.,']*\s?(?:[$€£¥₹]|[A-Z]{3}))$/,
  number: /^[-+]?(?:\d{1,3}(?:[\s,.']\d{3})+|\d+)(?:[.,]\d+)?$/,
  phone: /^\+?[\d\s().-]{7,}$/,
  isoDate: /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/,
  dmyDate: /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/,
  textDate: /^(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{1,2},?\s+)?\d{4}$/i,
};

/** Classify one non-empty cell value. */
export function classifyValue(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (RE.email.test(v)) return "email";
  if (RE.url.test(v)) return "url";
  if (RE.percent.test(v)) return "percent";
  const d = v.replace(WEEKDAY, "");
  if (RE.isoDate.test(d) || RE.dmyDate.test(d) || RE.textDate.test(d)) return "date";
  if (RE.number.test(v)) return "number";
  if (RE.money.test(v)) return "money";
  const digits = v.replace(/\D/g, "").length;
  if (RE.phone.test(v) && digits >= 9 && digits <= 15) return "phone";
  return "text";
}

/** Majority type of a column (80% of non-empty values must agree, else "text"). */
export function inferColumnType(values) {
  const counts = new Map();
  let n = 0;
  for (const v of values) {
    const t = classifyValue(v);
    if (!t) continue;
    n++;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  if (!n) return "text";
  // Long digit strings look like numbers; if enough of them carry phone punctuation call it phone.
  let best = "text", bestN = 0;
  for (const [t, c] of counts) if (c > bestN) { best = t; bestN = c; }
  if (best === "number" && (counts.get("phone") || 0) / n >= 0.2) best = "phone";
  if (best === "number" && (counts.get("money") || 0) / n >= 0.2) best = "money";
  const agree = best === "money" ? bestN + (counts.get("number") || 0) : best === "phone" ? bestN + (counts.get("number") || 0) : bestN;
  return agree / n >= 0.8 ? best : "text";
}

/** Parse "1 234,50", "1,234.50", "1.234,50", "12'000" into a JS number (or null). */
export function parseNumber(raw) {
  let s = String(raw ?? "").replace(/[^\d.,'\s+-]/g, "").replace(/['\s]/g, "");
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // the later separator is the decimal mark
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "1,234" (thousands) vs "12,5" (decimal comma)
    s = /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0 && s.split(".").length > 2) {
    s = s.replace(/\./g, ""); // "1.234.567"
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");

/** Normalise a date string to YYYY-MM-DD. dayFirst decides 03/11/2026 (default true). */
export function parseDate(raw, dayFirst = true) {
  // A leading weekday ("Sat 21 Nov 2026", "Monday, 3 March 2026") carries no extra information.
  const v = String(raw ?? "").trim().replace(WEEKDAY, "");
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let [d, mo] = dayFirst ? [m[1], m[2]] : [m[2], m[1]];
    if (Number(mo) > 12 && Number(d) <= 12) [d, mo] = [mo, d];
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = v.match(/^(?:(\d{1,2})\s+)?([a-z]{3})[a-z]*\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/i);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[4]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1] || m[3] || 1)}`;
  return null;
}

/** Turn one cell into a clean value for its column type. Unparseable values stay as text. */
export function normalise(raw, type) {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  switch (type) {
    case "number": case "money": { const n = parseNumber(v); return n ?? v; }
    case "percent": { const n = parseNumber(v); return n == null ? v : n / 100; }
    case "date": return parseDate(v) ?? v;
    case "email": return v.toLowerCase();
    case "phone": return v.replace(/[^\d+]/g, "");
    default: return v;
  }
}
