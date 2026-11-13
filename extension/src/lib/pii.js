// Personal-data guard. Built during #BuildHybridAI 2026.
// Runs on this device before any prompt is built. Columns it flags are masked in every
// request that could reach the cloud. The on-device model may flag more columns later;
// those are merged in (see mergeColumns in tidy.js) but never un-flag a column found here.

const HEADER_HINT = /\b(name|first|last|surname|customer|client|contact|owner|author|user(name)?|e-?mail|phone|mobile|cell|tel|address|street|zip|postcode|postal|birth|dob|id ?(no|number)|passport|ssn|iban|account|card)\b/i;

const VALUE_TESTS = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v),
  phone: (v) => /^\+?[\d\s().-]{9,}$/.test(v) && v.replace(/\D/g, "").length >= 9 && v.replace(/\D/g, "").length <= 15 && /[\s().+-]/.test(v),
  card: (v) => /^(?:\d[ -]?){13,19}$/.test(v) && luhn(v.replace(/\D/g, "")),
  iban: (v) => /^[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}$/.test(v),
  // Two or three capitalised words, no digits: "Thandi Nkosi", "Mary-Ann van Wyk"
  person: (v) => /^[A-Z][a-zà-ÿ'’-]+(?:\s+(?:van|de|der|du|von|le|la|da)?\s*[A-Z][a-zà-ÿ'’-]+){1,2}$/.test(v),
};

function luhn(d) {
  let sum = 0, dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n; dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * Scan one column. Returns { pii: boolean, kind: string|null, reason: string }.
 * A column is personal data when >= 60% of its non-empty values match a value test,
 * or its header looks personal and >= 30% of values match any test (catches name lists).
 */
export function scanColumn(header, values) {
  const vals = values.map((v) => String(v ?? "").trim()).filter(Boolean).slice(0, 200);
  if (!vals.length) return { pii: false, kind: null, reason: "empty" };
  let best = null, bestShare = 0;
  for (const [kind, test] of Object.entries(VALUE_TESTS)) {
    const share = vals.filter(test).length / vals.length;
    if (share > bestShare) { best = kind; bestShare = share; }
  }
  const headerHit = HEADER_HINT.test(String(header || ""));
  // Person-name test alone is weak (product names are capitalised too): need the header hint.
  if (best === "person" && !headerHit) return { pii: false, kind: null, reason: "capitalised words, header not personal" };
  if (bestShare >= 0.6) return { pii: true, kind: best, reason: `${Math.round(bestShare * 100)}% of values look like ${best}` };
  if (headerHit && bestShare >= 0.3) return { pii: true, kind: best, reason: `header "${header}" and ${Math.round(bestShare * 100)}% ${best} values` };
  return { pii: false, kind: null, reason: "no personal patterns" };
}

/** Placeholder for a masked value: keeps the shape (so the model can still type the column), drops the content. */
export function maskValue(v, kind) {
  const s = String(v ?? "");
  if (!s.trim()) return s;
  switch (kind) {
    case "email": return "name@example.com";
    case "phone": return s.replace(/\d/g, "0");
    case "card": return s.replace(/\d/g, "0");
    case "iban": return s.slice(0, 2) + s.slice(2).replace(/[A-Z0-9]/g, "0");
    case "person": return "Person Name";
    default: return "[personal]";
  }
}

/**
 * Mask every flagged column. `flags` is an array (per column) of { pii, kind }.
 * Returns new rows; the input is never modified.
 */
export function maskRows(rows, flags) {
  return rows.map((r) => r.map((v, i) => (flags[i] && flags[i].pii ? maskValue(v, flags[i].kind) : v)));
}
