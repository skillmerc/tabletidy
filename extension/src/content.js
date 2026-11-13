// Page side of Tabletidy (injected only after the user clicks Scan; activeTab permission).
// Uses the reused List & Table Scraper engine to find tables/lists and extract rows.
import { findCandidates, extract } from "./lib/detect.js";

const MAX_ROWS = 5000;
let cands = [];
let marker = null;

function label(c, i, res) {
  const el = c.container;
  const heading = el.closest("section, article, main, body")?.querySelector("h1, h2, h3, caption");
  const cap = el.querySelector?.("caption")?.textContent || el.getAttribute?.("aria-label") || heading?.textContent || "";
  const kind = c.rows[0].tagName === "TR" ? "Table" : "List";
  return `${kind} ${i + 1}${cap.trim() ? ": " + cap.trim().replace(/\s+/g, " ").slice(0, 48) : ""}`;
}

function scan() {
  cands = findCandidates(document, { limit: 8 });
  return cands.map((c, i) => {
    const res = extract(c, location.href);
    return { id: i, label: label(c, i, res), headers: res.columns.map((col) => col.name), rows: res.rows.slice(0, MAX_ROWS), total: res.rows.length };
  }).filter((t) => t.headers.length >= 2 && t.rows.length >= 2);
}

function highlight(id) {
  marker?.remove();
  marker = null;
  const c = cands[id];
  if (!c) return;
  c.container.scrollIntoView({ block: "center", behavior: "smooth" });
  const r = c.container.getBoundingClientRect();
  marker = document.createElement("div");
  Object.assign(marker.style, {
    position: "absolute", left: `${r.left + scrollX - 4}px`, top: `${r.top + scrollY - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`,
    border: "2px solid #0f766e", borderRadius: "8px", background: "rgba(15,118,110,.06)", pointerEvents: "none", zIndex: 2147483647, transition: "opacity .3s",
  });
  document.documentElement.appendChild(marker);
  setTimeout(() => { if (marker) marker.style.opacity = "0"; }, 2200);
}

globalThis.__tabletidy = { scan, highlight };
