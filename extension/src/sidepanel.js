// Tabletidy side panel: scans the active tab with the List & Table Scraper engine and hands
// the picked table to the shared app view (app.js). Built during #BuildHybridAI 2026.
import "./platform.js";
import { createApp } from "./app.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const app = createApp($("tt-app"), { emptyText: "Press Scan this page and pick a table. Nothing is sent anywhere until you press Tidy columns." });
const state = { tabId: null, tables: [] };

async function inPage(func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: state.tabId }, func, args });
  return result;
}

$("scan").addEventListener("click", async () => {
  $("scan-msg").textContent = "Scanning…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab.id;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    state.tables = await inPage(() => globalThis.__tabletidy.scan());
  } catch (e) {
    $("scan-msg").textContent = "Can't read this page. Click the Tabletidy toolbar button on the page first (Chrome pages and the Web Store are off limits).";
    return;
  }
  $("scan-msg").textContent = state.tables.length ? `Found ${state.tables.length} table${state.tables.length > 1 ? "s" : ""}. Pick one.` : "No tables or repeated lists found on this page.";
  $("tables").innerHTML = state.tables.map((t) => `<li><button data-id="${t.id}" aria-pressed="false"><span>${esc(t.label)}</span><span class="dim">${t.total} × ${t.headers.length}</span></button></li>`).join("");
});

$("tables").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-id]");
  if (!btn) return;
  for (const b of $("tables").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
  const table = state.tables.find((t) => t.id === Number(btn.dataset.id));
  inPage((id) => globalThis.__tabletidy.highlight(id), [table.id]);
  app.setTable(table); // local rules run at once; the model only runs on Tidy columns
});

$("save-token").addEventListener("click", async () => {
  await chrome.storage.local.set({ appCheckDebugToken: $("token").value.trim() });
  $("token").value = "";
  $("token").placeholder = "saved; reopen the panel to apply";
});
