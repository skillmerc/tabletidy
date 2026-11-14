// Tabletidy app view, shared by the hosted playground and the extension side panel.
// Built during #BuildHybridAI 2026. Each surface only supplies a table ({ label, headers,
// rows }) through setTable(); status, tidy, result, "What the model saw" and export are here.
import { TYPES } from "./lib/infer.js";
import { localAnalysis, exportTable } from "./lib/tidy.js";
import { tidyTable } from "./lib/hybrid.js";
import { toCSV, toJSON, toTSV } from "./lib/export.js";
import { runPrompt, deviceStatus, downloadDeviceModel } from "./ai.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const SOURCE_LABEL = { on_device: "On device", in_cloud: "Cloud", local: "Device rules", unknown: "Model" };

const TEMPLATE = `
<section class="card statusbar" aria-live="polite">
  <span class="muted small">On-device model</span>
  <span id="nano" class="pill">Checking…</span>
  <button id="nano-dl" class="btn small" hidden>Download model</button>
  <progress id="nano-prog" max="1" value="0" hidden></progress>
  <span id="nano-note" class="muted small"></span>
</section>
<section class="card empty" id="step-empty"><p id="empty-text" class="muted"></p></section>
<section class="card" id="step-tidy" hidden>
  <h2><span class="num">2</span>Tidy columns</h2>
  <div class="seg" role="radiogroup" aria-label="Where the AI runs">
    <label><input type="radio" name="pref" value="auto" checked /><span>Auto</span></label>
    <label><input type="radio" name="pref" value="device" /><span>On device only</span></label>
    <label><input type="radio" name="pref" value="cloud" /><span>Cloud</span></label>
  </div>
  <p class="rule"><b>Privacy rule:</b> personal-data columns are found and masked on this device before any request that can reach the cloud. <i>On device only</i> never sends table data anywhere.</p>
  <button id="tidy" class="btn primary">Tidy columns</button>
  <p id="tidy-msg" class="muted small" role="status"></p>
</section>
<section class="card" id="step-result" hidden>
  <div class="runline">
    <span id="badge" class="badge"></span>
    <span id="runinfo" class="small"></span>
  </div>
  <p id="attempts" class="muted small attempts" hidden></p>
  <p id="run-error" class="error small" role="alert" hidden></p>
  <h3 id="title" class="title"></h3>
  <ol id="cols" class="cols"></ol>
  <details class="sent" id="sent-wrap"><summary>What the model saw</summary><p id="sent-note" class="muted small"></p><pre id="sent"></pre></details>
  <div class="preview-wrap"><table id="preview" class="preview"></table></div>
  <p id="preview-note" class="muted small"></p>
</section>
<section class="card" id="step-export" hidden>
  <h2><span class="num">3</span>Export</h2>
  <label class="check"><input type="checkbox" id="clean" checked /> Clean values (numbers, ISO dates)</label>
  <label class="check"><input type="checkbox" id="droppii" checked /> Leave out personal-data columns</label>
  <div class="row">
    <button id="csv" class="btn">Download CSV</button>
    <button id="json" class="btn">Download JSON</button>
    <button id="copy" class="btn ghost">Copy for Sheets</button>
  </div>
  <p id="export-msg" class="muted small" role="status"></p>
</section>`;

/** Mount the app into `root`. Returns { setTable(table), state }. */
export function createApp(root, { emptyText = "Pick a table to start." } = {}) {
  root.classList.add("tt");
  root.innerHTML = TEMPLATE;
  const $ = (id) => root.querySelector("#" + id);
  const state = { table: null, columns: null, title: "", run: null, busy: false };
  $("empty-text").textContent = emptyText;

  // ---- On-device model status: unavailable / downloadable / downloading / ready ------------
  let downloading = false;
  function paintStatus(s, progress) {
    const pill = $("nano"), dl = $("nano-dl"), prog = $("nano-prog"), note = $("nano-note");
    const text = { available: "Gemini Nano: ready", downloadable: "Gemini Nano: not downloaded yet", downloading: "Gemini Nano: downloading", unavailable: "Gemini Nano: not available in this browser" }[s] || `Gemini Nano: ${s}`;
    pill.textContent = s === "downloading" && progress != null ? `${text} ${Math.round(progress * 100)}%` : text;
    pill.className = "pill " + (s === "available" ? "ok" : s === "unavailable" ? "warn" : "");
    pill.dataset.status = s;
    dl.hidden = s !== "downloadable";
    prog.hidden = s !== "downloading";
    if (progress != null) prog.value = progress; else prog.removeAttribute("value");
    note.textContent = s === "unavailable" ? "Runs use the cloud model." : s === "downloadable" ? "About 3 GB, one time. Until then runs use the cloud model." : s === "downloading" ? "You can keep using the page; runs use the cloud until it is ready." : "";
  }
  async function refreshStatus() {
    if (downloading) return;
    paintStatus(await deviceStatus());
  }
  refreshStatus();
  const timer = setInterval(refreshStatus, 5000);
  $("nano-dl").addEventListener("click", async () => {
    downloading = true;
    paintStatus("downloading", 0);
    try {
      await downloadDeviceModel((p) => paintStatus("downloading", p));
    } catch (e) {
      $("nano-note").textContent = `Download did not start: ${e.message || e}`;
    } finally {
      downloading = false;
      const s = await deviceStatus();
      paintStatus(s);
    }
  });

  // ---- Table in: local rules first (instant, no model), then the Tidy step -------------------
  function setTable(table) {
    state.table = table;
    state.columns = localAnalysis(table.headers, table.rows);
    state.title = table.label;
    $("step-empty").hidden = true;
    $("step-tidy").hidden = false;
    $("tidy-msg").textContent = "";
    render({ source: "local", ms: 0, reason: "Device rules only, no model run yet", sent: "", attempts: [], masked: [], mask: true, reachedCloud: false, error: null });
  }

  $("tidy").addEventListener("click", async () => {
    const t = state.table;
    if (!t || state.busy) return;
    const pref = root.querySelector("input[name=pref]:checked").value;
    state.busy = true;
    $("tidy").disabled = true;
    $("tidy").textContent = "Working…";
    $("step-result").setAttribute("aria-busy", "true");
    try {
      const out = await tidyTable(t, pref, {
        runPrompt,
        deviceStatus,
        onStart: ({ plan, masked }) => { $("tidy-msg").textContent = plan.mask ? `Masked ${masked.length} personal-data column${masked.length === 1 ? "" : "s"} on this device. Asking the model…` : "Asking Gemini Nano on this device…"; },
      });
      if (state.table !== t) return; // the user picked another table meanwhile
      state.columns = out.columns;
      state.title = out.title;
      render(out.run);
      $("tidy-msg").textContent = "";
    } catch (e) {
      render({ source: "local", ms: 0, reason: "Something went wrong, kept device rules", sent: "", attempts: [], masked: [], mask: true, reachedCloud: false, error: e.message || String(e) });
      $("tidy-msg").textContent = "";
    } finally {
      state.busy = false;
      $("tidy").disabled = false;
      $("tidy").textContent = "Tidy columns";
      $("step-result").removeAttribute("aria-busy");
    }
  });

  // ---- Result view --------------------------------------------------------------------------
  function render(run) {
    state.run = run;
    $("step-result").hidden = false;
    $("step-export").hidden = false;
    const badge = $("badge");
    badge.className = "badge " + run.source;
    badge.textContent = SOURCE_LABEL[run.source] || run.source;
    $("runinfo").textContent = (run.ms ? `${secs(run.ms)} · ` : "") + run.reason;
    const at = $("attempts");
    at.hidden = run.attempts.length < 2;
    at.textContent = run.attempts.map((a, i) => `Attempt ${i + 1}: ${(SOURCE_LABEL[a.source] || a.source).toLowerCase()}${a.ms ? `, ${secs(a.ms)}` : ""}, ${a.ok ? "accepted" : `rejected (${a.error})`}`).join(" · ");
    const err = $("run-error");
    err.hidden = !(run.source === "local" && run.error);
    err.textContent = run.error ? `No model answer was used: ${run.error}` : "";
    $("title").textContent = state.title;
    $("sent").textContent = run.sent || "Nothing has been sent to a model yet. Press Tidy columns.";
    $("sent-note").textContent = !run.sent ? "" : !run.mask
      ? "On device only: raw values were used and nothing left this browser."
      : (run.masked.length ? `Masked on this device before the request was built: ${run.masked.join(", ")}. ` : "No personal-data columns found, nothing to mask. ") + (run.reachedCloud ? "This exact text went to Gemini in the cloud." : "This run stayed on this device.");
    $("sent-wrap").open = Boolean(run.sent && run.reachedCloud);
    $("cols").innerHTML = state.columns.map((c, i) => `
      <li data-i="${i}">
        <span class="orig" title="${esc(c.original)}">${esc(c.original || "(no header)")}</span>
        <input type="text" value="${esc(c.name)}" aria-label="Column name" />
        <select aria-label="Type">${TYPES.map((ty) => `<option${ty === c.type ? " selected" : ""}>${ty}</option>`).join("")}</select>
        <button class="pii${c.pii ? " on" : ""}" title="${esc(c.piiReason || "")}" aria-pressed="${c.pii}">${c.pii ? "Personal" : "Not personal"}</button>
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
    b.classList.toggle("on", c.pii); b.textContent = c.pii ? "Personal" : "Not personal"; b.setAttribute("aria-pressed", String(c.pii));
    renderPreview();
  });

  function current() {
    return exportTable(state.columns, state.table.rows, { clean: $("clean").checked, dropPii: $("droppii").checked });
  }
  function renderPreview() {
    const { headers, rows } = current();
    $("preview").innerHTML = headers.length
      ? `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 6).map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>`
      : "";
    const left = state.columns.length - headers.length;
    $("preview-note").textContent = `Export preview: first ${Math.min(6, rows.length)} of ${rows.length.toLocaleString("en")} rows, ${headers.length} column${headers.length === 1 ? "" : "s"}` + (left ? `, ${left} personal-data column${left === 1 ? "" : "s"} left out.` : ".");
  }
  $("clean").addEventListener("change", renderPreview);
  $("droppii").addEventListener("change", renderPreview);

  // ---- Export -------------------------------------------------------------------------------
  const fileBase = () => (state.title || "table").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "table";
  function download(text, ext, type, t) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${fileBase()}.${ext}` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    $("export-msg").textContent = `Saved ${fileBase()}.${ext} (${t.rows.length.toLocaleString("en")} rows, ${t.headers.length} columns)`;
  }
  $("csv").addEventListener("click", () => { const t = current(); download(toCSV(t.headers, t.rows), "csv", "text/csv", t); });
  $("json").addEventListener("click", () => { const t = current(); download(toJSON(t.headers, t.rows), "json", "application/json", t); });
  $("copy").addEventListener("click", async () => {
    const t = current();
    try { await navigator.clipboard.writeText(toTSV(t.headers, t.rows)); $("export-msg").textContent = "Copied. Paste into Sheets or Excel."; }
    catch { $("export-msg").textContent = "Could not reach the clipboard. Use Download CSV instead."; }
  });

  return { setTable, state, exportNow: (fmt) => { const t = current(); return fmt === "json" ? toJSON(t.headers, t.rows) : toCSV(t.headers, t.rows); }, destroy: () => clearInterval(timer) };
}
