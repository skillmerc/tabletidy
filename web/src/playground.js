// Hosted playground (https://tabletidy-82369.web.app). Built during #BuildHybridAI 2026.
// Supplies tables (page samples or pasted text) to the same app view, routing, masking and
// Firebase AI Logic module the extension side panel uses. App Check here is reCAPTCHA Enterprise.
import { firebaseConfig, recaptchaSiteKey } from "./config.js";
import { configureAI } from "./ai.js";
import { createApp } from "./app.js";
import { parseInput } from "./lib/parse.js";

configureAI({ firebaseConfig, appCheck: { kind: "recaptcha-enterprise", siteKey: recaptchaSiteKey } });

const $ = (id) => document.getElementById(id);
const app = createApp($("tt-app"), { emptyText: "Pick a sample or paste a table on the left. Nothing is sent anywhere until you press Tidy columns." });
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();

function unpress() { for (const b of $("samples").querySelectorAll("button")) b.setAttribute("aria-pressed", "false"); }

// Samples are read from the sample tables further down this page, so there is one copy of the data.
$("samples").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-sample]");
  if (!btn) return;
  const t = document.getElementById(btn.dataset.sample);
  const headers = [...t.tHead.rows[0].cells].map(text);
  const rows = [...t.tBodies[0].rows].map((r) => [...r.cells].map(text));
  unpress();
  btn.setAttribute("aria-pressed", "true");
  $("paste-msg").textContent = "";
  app.setTable({ label: btn.dataset.label, headers, rows });
});

$("use-paste").addEventListener("click", () => {
  const res = parseInput($("paste").value);
  const msg = $("paste-msg");
  msg.classList.toggle("bad", !res.ok);
  if (!res.ok) { msg.textContent = res.error; return; }
  unpress();
  msg.textContent = `Read ${res.rows.length.toLocaleString("en")} rows × ${res.headers.length} columns (${res.format})` + (res.truncated ? ", cut to the first 5,000 rows." : ".");
  app.setTable({ label: res.label, headers: res.headers, rows: res.rows });
});

// For tests and support: lets a script read what an export would contain.
window.tabletidy = app;
