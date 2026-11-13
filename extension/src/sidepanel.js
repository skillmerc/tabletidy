// Tabletidy side panel. Built during #BuildHybridAI 2026.
import { TYPES } from "./lib/infer.js";
import { route, localAnalysis, buildPrompt, parseModelJSON, mergeColumns, exportTable } from "./lib/tidy.js";
import { toCSV, toJSON, toTSV } from "./lib/export.js";
import { runPrompt, deviceStatus } from "./ai.js";

const $ = (id) => document.getElementById(id);
const state = { tabId: null, tables: [], table: null, columns: null, title: "" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- Gemini Nano status pill -------------------------------------------------------------
async function showNano() {
  const s = await deviceStatus();
  const pill = $("nano");
  const text = { available: "Gemini Nano ready", downloadable: "Nano: download on first run", downloading: "Nano downloading…", unavailable: "Nano not available: cloud fallback" }[s] || s;
  pill.textContent = text;
  pill.className = "pill " + (s === "available" ? "ok" : s === "unavailable" ? "warn" : "");
}
showNano();

// ---- 1. Scan the page with the List & Table Scraper engine -----------------------------------
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
  state.table = state.tables.find((t) => t.id === Number(btn.dataset.id));
  inPage((id) => globalThis.__tabletidy.highlight(id), [state.table.id]);
  // Local analysis first: instant, model-free, decides what must be masked.
  state.columns = localAnalysis(state.table.headers, state.table.rows);
  state.title = state.table.label;
  $("step-tidy").hidden = false;
  render({ source: "local", ms: 0, reason: "Device rules only (no model yet)", sent: "" });
});

// ---- 2. Tidy with Firebase AI Logic (hybrid) ---------------------------------------------------
$("tidy").addEventListener("click", async () => {
  const t = state.table;
  if (!t) return;
  const pref = document.querySelector("input[name=pref]:checked").value;
  const plan = route(t.rows.length, t.headers.length, pref);
  const local = localAnalysis(t.headers, t.rows);
  const prompt = buildPrompt(t.headers, t.rows, local, plan);
  $("tidy").disabled = true;
  $("tidy-msg").textContent = plan.mask ? `Masked ${local.filter((c) => c.pii).length} personal-data column(s) on device. Asking the model…` : "Asking Gemini Nano on this device…";
  try {
    const out = await runPrompt(plan.mode, prompt.text, (p) => { $("tidy-msg").textContent = `Downloading Gemini Nano: ${Math.round(p * 100)}%`; });
    const parsed = parseModelJSON(out.text);
    if (!parsed) throw new Error("The model answer was not usable JSON; kept the device rules result.");
    state.columns = mergeColumns(local, parsed, t.rows);
    state.title = String(parsed.title || t.label).slice(0, 60);
    const fellBack = plan.mode === "PREFER_ON_DEVICE" && out.source === "in_cloud";
    render({ source: out.source, ms: out.ms, reason: fellBack ? "Gemini Nano not available here, cloud fallback" : plan.reason, sent: prompt.text });
    $("tidy-msg").textContent = "";
  } catch (e) {
    state.columns = local;
    render({ source: "local", ms: 0, reason: "Model unavailable, device rules only", sent: prompt.text });
    $("tidy-msg").textContent = e.message || String(e);
  } finally {
    $("tidy").disabled = false;
  }
});

// ---- Result view ------------------------------------------------------------------------------
function render(run) {
  $("step-result").hidden = false;
  $("step-export").hidden = false;
  const badge = $("badge");
  badge.className = "badge " + run.source;
  badge.textContent = run.source === "on_device" ? "On device" : run.source === "in_cloud" ? "Cloud" : "Local rules";
  $("runinfo").textContent = (run.ms ? `${(run.ms / 1000).toFixed(1)} s · ` : "") + run.reason;
  $("title").textContent = state.title;
  $("sent").textContent = run.sent || "Nothing sent yet.";
  $("cols").innerHTML = state.columns.map((c, i) => `
    <li data-i="${i}">
      <span class="orig" title="${esc(c.original)}">${esc(c.original || "(no header)")}</span>
      <input type="text" value="${esc(c.name)}" aria-label="Column name" />
      <select aria-label="Type">${TYPES.map((ty) => `<option${ty === c.type ? " selected" : ""}>${ty}</option>`).join("")}</select>
      <button class="pii${c.pii ? " on" : ""}" title="${esc(c.piiReason || "")}">${c.pii ? "Personal" : "Not personal"}</button>
    </li>`).join("");
  renderPreview();
}

$("cols").addEventListener("input", (ev) => {
  const li = ev.target.closest("li"); if (!li) return;
  const c = state.columns[Number(li.dataset.i)];
  if (ev.target.tagName === "INPUT") c.name = ev.target.value;
  if (ev.target.tagName === "SELECT") c.type = ev.target.value;
  renderPreview();
});
$("cols").addEventListener("click", (ev) => {
  const b = ev.target.closest("button.pii"); if (!b) return;
  const c = state.columns[Number(b.closest("li").dataset.i)];
  c.pii = !c.pii; c.piiBy = c.pii ? "you" : null;
  b.classList.toggle("on", c.pii); b.textContent = c.pii ? "Personal" : "Not personal";
  renderPreview();
});

function current() {
  return exportTable(state.columns, state.table.rows, { clean: $("clean").checked, dropPii: $("droppii").checked });
}
function renderPreview() {
  const { headers, rows } = current();
  $("preview").innerHTML = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 6).map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}
$("clean").addEventListener("change", renderPreview);
$("droppii").addEventListener("change", renderPreview);

// ---- 3. Export --------------------------------------------------------------------------------
const fileBase = () => (state.title || "table").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "table";
function download(text, ext, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${fileBase()}.${ext}` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  $("export-msg").textContent = `Saved ${fileBase()}.${ext}`;
}
$("csv").addEventListener("click", () => { const t = current(); download(toCSV(t.headers, t.rows), "csv", "text/csv"); });
$("json").addEventListener("click", () => { const t = current(); download(toJSON(t.headers, t.rows), "json", "application/json"); });
$("copy").addEventListener("click", async () => { const t = current(); await navigator.clipboard.writeText(toTSV(t.headers, t.rows)); $("export-msg").textContent = "Copied. Paste into Sheets or Excel."; });

// ---- Settings ---------------------------------------------------------------------------------
$("save-token").addEventListener("click", async () => {
  await chrome.storage.local.set({ appCheckDebugToken: $("token").value.trim() });
  $("token").value = "";
  $("token").placeholder = "saved; reopen the panel to apply";
});
