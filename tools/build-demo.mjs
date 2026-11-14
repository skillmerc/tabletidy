// Generates site/index.html: the public demo page with sample tables for Tabletidy.
// All people, companies, emails and phone numbers below are invented. Run: node tools/build-demo.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site", "index.html");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Small deterministic generator so the page is identical on every build.
let seed = 20261114;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n) => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const zar = (n) => { const [i, d] = n.toFixed(2).split("."); return `R ${i.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${d}`; };

const contacts = [
  ["Thandi Mokoena", "thandi.mokoena@example.com", "+27 82 555 0143", "Johannesburg", "03 Nov 2026", 4250],
  ["Pieter van Wyk", "pieter.vw@example.org", "+27 83 555 0178", "Pretoria", "04 Nov 2026", 1899.5],
  ["Aisha Patel", "aisha.patel@example.com", "+27 71 555 0112", "Durban", "04 Nov 2026", 12480],
  ["Sipho Dlamini", "sipho.d@example.net", "+27 76 555 0190", "Mbombela", "05 Nov 2026", 730],
  ["Lerato Khumalo", "lerato.khumalo@example.com", "+27 84 555 0127", "Bloemfontein", "06 Nov 2026", 2115.75],
  ["Johan Botha", "jbotha@example.org", "+27 82 555 0166", "Stellenbosch", "06 Nov 2026", 6020],
  ["Naledi Sithole", "naledi.s@example.com", "+27 79 555 0104", "Polokwane", "09 Nov 2026", 349.99],
  ["Riaan Naidoo", "riaan.naidoo@example.net", "+27 72 555 0155", "Pietermaritzburg", "09 Nov 2026", 18300],
  ["Zanele Mthembu", "zanele.m@example.com", "+27 81 555 0139", "Gqeberha", "10 Nov 2026", 905.2],
  ["Michael Abrahams", "m.abrahams@example.org", "+27 74 555 0181", "Cape Town", "11 Nov 2026", 2760],
  ["Fatima Ismail", "fatima.ismail@example.com", "+27 83 555 0120", "Rustenburg", "12 Nov 2026", 1540.4],
  ["Bongani Zulu", "bongani.zulu@example.net", "+27 78 555 0197", "Kimberley", "13 Nov 2026", 8875],
];

const prices = [
  ["WB-1040", "Wheelbarrow, 65 L steel", 1234.5, "Y", 18, "03 Nov 2026"],
  ["PT-2210", "Paint, exterior white 20 L", 1899, "Y", 42, "03 Nov 2026"],
  ["CM-0050", "Cement 42.5N, 50 kg bag", 112.95, "Y", 640, "10 Nov 2026"],
  ["LD-3301", "Ladder, aluminium 3.6 m", 2450, "Y", 7, "28 Oct 2026"],
  ["DR-7718", "Cordless drill 18 V kit", 3199.99, "Y", 11, "07 Nov 2026"],
  ["HP-0912", "Garden hose 30 m", 489.9, "Y", 55, "30 Oct 2026"],
  ["TL-4400", "Floor tile 600x600, per box", 359, "N", 210, "12 Nov 2026"],
  ["GS-1500", "Generator 5.5 kVA", 14999, "N", 3, "01 Nov 2026"],
  ["SC-0086", "Wood screws 8x40, box of 200", 74.5, "Y", 980, "05 Nov 2026"],
  ["RF-6020", "Roof sheet IBR 3.0 m", 412.75, "N", 126, "11 Nov 2026"],
];

const regions = ["Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape", "Free State", "Limpopo", "Mpumalanga", "North West", "Northern Cape"];
const depots = ["Midrand", "Bellville", "Pinetown", "East London", "Welkom", "Tzaneen", "Witbank", "Brits", "Upington"];
const carriers = ["Road freight", "Overnight van", "Rail", "Bakkie courier"];
const statuses = ["Delivered", "In transit", "Delayed", "Out for delivery", "Returned"];
const big = Array.from({ length: 260 }, (_, i) => {
  const r = Math.floor(rnd() * regions.length);
  const day = 1 + Math.floor(rnd() * 28), mon = 7 + Math.floor(rnd() * 4);
  return [`SH-${String(40001 + i)}`, `${pad(day)}/${pad(mon + 1)}/2026`, regions[r], depots[r], pick(carriers), `${(5 + rnd() * 1450).toFixed(1).replace(".", ",")} kg`, zar(180 + rnd() * 9200), pick(statuses)];
});

const listings = [
  ["Spreadsheet clinic for small shops", "Sat 21 Nov 2026", "Braamfontein", "R 150,00", "24 seats"],
  ["Intro to pivot tables", "Tue 24 Nov 2026", "Online", "Free", "200 seats"],
  ["Stocktake without tears", "Thu 26 Nov 2026", "Durban North", "R 320,00", "16 seats"],
  ["Clean data for bookkeepers", "Mon 30 Nov 2026", "Online", "R 95,00", "120 seats"],
  ["Charts people can read", "Wed 02 Dec 2026", "Sea Point", "R 280,00", "30 seats"],
  ["Year-end reporting sprint", "Fri 04 Dec 2026", "Hatfield", "R 450,00", "12 seats"],
  ["Importing bank statements", "Tue 08 Dec 2026", "Online", "Free", "300 seats"],
  ["Price lists that stay tidy", "Thu 10 Dec 2026", "Nelspruit", "R 180,00", "20 seats"],
];

const table = (id, head, rows, cls = "") =>
  `<table id="${id}" class="${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>\n${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n")}\n</tbody></table>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tabletidy: clean any table with hybrid AI, in your browser</title>
<meta name="description" content="Paste a table or pick a sample. Tabletidy names and types the columns, flags personal data and exports clean CSV or JSON. Gemini Nano on device, Gemini in the cloud through Firebase AI Logic.">
<link rel="icon" href="icon.png">
<link rel="stylesheet" href="app/ui.css">
<style>
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 72px; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; }
.wrap { max-width: 1160px; margin: 0 auto; padding: 0 24px; }
header.site { background:var(--card); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:5; }
header.site .wrap { display:flex; align-items:center; justify-content:space-between; height:56px; gap:12px; }
.brand { font-weight:700; font-size:18px; display:flex; align-items:center; gap:10px; letter-spacing:-.01em; }
.logo { width:22px; height:22px; border-radius:6px; flex:none; background:
  linear-gradient(#fff 0 0) 5px 6px / 12px 2px no-repeat, linear-gradient(#fff 0 0) 5px 10px / 12px 2px no-repeat,
  linear-gradient(#fff 0 0) 5px 14px / 7px 2px no-repeat, var(--brand); }
nav { display:flex; gap:20px; }
nav a { text-decoration:none; font-size:14px; color:var(--muted); white-space:nowrap; }
nav a:hover { color:var(--brand); }
.hero { padding:40px 0 20px; }
.hero h1 { font-size:clamp(28px,4.6vw,42px); line-height:1.12; letter-spacing:-.025em; margin:0 0 12px; max-width:20em; }
.hero p { margin:0; max-width:46em; color:#33403e; font-size:17px; }
.facts { display:flex; flex-wrap:wrap; gap:8px; margin:18px 0 0; padding:0; list-style:none; }
.facts li { font-size:13px; font-weight:600; padding:4px 12px; border-radius:999px; }
.facts .device { background:var(--brand-soft); color:var(--brand); }
.facts .cloud { background:var(--cloud-soft); color:var(--cloud); }
.facts .pii { background:var(--warn-soft); color:var(--warn); }
main > section { padding:24px 0; }
main h2.sec { font-size:22px; letter-spacing:-.015em; margin:0 0 6px; display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
p.lede { margin:0 0 16px; color:var(--muted); max-width:48em; }
.tag { display:inline-block; font-size:12px; font-weight:600; padding:3px 10px; border-radius:999px; vertical-align:middle; }
.tag.device { background:var(--brand-soft); color:var(--brand); }
.tag.cloud { background:var(--cloud-soft); color:var(--cloud); }
.tag.pii { background:var(--warn-soft); color:var(--warn); }
/* Playground */
.play { display:grid; grid-template-columns:minmax(0, 380px) minmax(0, 1fr); gap:16px; align-items:start; }
.samples { display:grid; gap:8px; }
.samples button { font:inherit; text-align:left; width:100%; background:var(--bg); border:1px solid transparent; border-radius:10px; padding:10px 12px; cursor:pointer; color:var(--ink); display:grid; gap:2px; }
.samples button:hover { border-color:#b9c4c2; }
.samples button[aria-pressed="true"] { border-color:var(--brand); background:var(--brand-soft); }
.samples b { font-weight:600; }
.samples span { font-size:12px; color:var(--muted); }
.or { display:flex; align-items:center; gap:10px; color:var(--muted); font-size:12px; margin:14px 0 10px; }
.or::before, .or::after { content:""; flex:1; height:1px; background:var(--line); }
#paste { width:100%; min-height:120px; resize:vertical; font:12px/1.5 ui-monospace,Menlo,monospace; border:1px solid var(--line); border-radius:8px; padding:10px; background:var(--card); color:var(--ink); }
#paste-msg.bad { color:var(--err); }
/* Sample tables */
.sheet { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:auto; }
.sheet.scroll { max-height:420px; }
.sheet table { border-collapse:collapse; width:100%; font-size:14px; }
.sheet th, .sheet td { text-align:left; padding:10px 14px; border-bottom:1px solid var(--line); white-space:nowrap; }
.sheet th { background:#fafcfb; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); position:sticky; top:0; }
.sheet tbody tr:last-child td { border-bottom:0; }
.panel { background:var(--card); border:1px solid var(--line); border-radius:14px; }
ol.steps { margin:0; padding:18px 22px 18px 42px; display:grid; gap:8px; }
code { background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:1px 6px; font-size:.9em; }
.how { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:14px; }
.how div { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; }
.how h3 { margin:0 0 6px; font-size:16px; }
.how p { margin:0; font-size:14px; color:var(--muted); }
.listing { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:14px; }
.event { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; }
.event h3 { margin:0 0 8px; font-size:16px; line-height:1.3; }
.event span { display:block; font-size:14px; color:var(--muted); }
.event .price { color:var(--ink); font-weight:600; margin-top:8px; }
footer { padding:36px 0 56px; color:var(--muted); font-size:14px; }
a { color:var(--brand); }
@media (max-width: 860px) {
  .play, .how { grid-template-columns:minmax(0,1fr); }
  .wrap { padding:0 14px; }
  nav a.wide { display:none; }
  .hero { padding:26px 0 12px; }
}
</style>
</head>
<body>
<header class="site"><div class="wrap">
  <div class="brand"><span class="logo"></span>Tabletidy</div>
  <nav><a href="#try">Try it</a><a class="wide" href="#how">How it works</a><a class="wide" href="#contacts">Sample tables</a><a class="wide" href="#install">Extension</a><a href="https://github.com/skillmerc/tabletidy">GitHub</a></nav>
</div></header>

<main class="wrap">
<div class="hero">
  <h1>Turn a messy table into a clean spreadsheet, without leaking the personal data in it.</h1>
  <p>Pick a sample or paste your own table. Tabletidy names and types the columns, flags personal data and exports clean CSV or JSON. It runs right here in the page, no install and no account.</p>
  <ul class="facts"><li class="device">Small tables: Gemini Nano on your device</li><li class="cloud">Large tables: Gemini in the cloud</li><li class="pii">Personal data masked before any cloud request</li></ul>
</div>

<section id="try">
  <h2 class="sec">Try it now</h2>
  <p class="lede">Every run shows where it ran and why. If the on-device model is missing or gives a bad answer, the run falls back to the cloud and says so.</p>
  <div class="play">
    <div class="tt tt-box">
      <section class="card">
        <h2><span class="num">1</span>Pick a table</h2>
        <div class="samples" id="samples">
          <button data-sample="orders" data-label="Customer orders" aria-pressed="false"><b>Customer orders</b><span>12 rows × 6 columns · names, emails and phone numbers</span></button>
          <button data-sample="pricelist" data-label="Price list" aria-pressed="false"><b>Price list</b><span>10 rows × 6 columns · cryptic headers, rand prices</span></button>
          <button data-sample="shipmentlog" data-label="Shipment log" aria-pressed="false"><b>Shipment log</b><span>260 rows × 8 columns · large, routes to the cloud</span></button>
        </div>
        <div class="or">or paste your own</div>
        <label class="small muted" for="paste">HTML table, CSV or rows copied from a spreadsheet. First row is the header.</label>
        <textarea id="paste" spellcheck="false" placeholder="name,email,joined,spend&#10;Thandi Mokoena,thandi@example.com,03 Nov 2026,&quot;R 1 234,50&quot;"></textarea>
        <div class="row"><button id="use-paste" class="btn">Use pasted table</button></div>
        <p id="paste-msg" class="muted small" role="status"></p>
      </section>
    </div>
    <div class="tt-box"><div id="tt-app"><section class="card empty"><p class="muted">Loading the app…</p></section></div></div>
  </div>
  <noscript><p class="lede">The playground needs JavaScript.</p></noscript>
</section>

<section id="how">
  <h2 class="sec">How it works</h2>
  <div class="how">
    <div><h3>1. Rules on your device</h3><p>Plain code types every column and flags names, emails, phone numbers and card numbers. This step needs no model and never leaves the browser.</p></div>
    <div><h3>2. Hybrid model run</h3><p>Firebase AI Logic prefers Gemini Nano in Chrome for tables up to 1,500 cells and Gemini in the cloud above that. Flagged columns are masked before the request text exists.</p></div>
    <div><h3>3. Checked, then yours to edit</h3><p>Every answer is validated against the schema. A bad on-device answer is retried in the cloud and the badge tells you. Rename, retype, then export.</p></div>
  </div>
</section>

<section id="contacts">
  <h2 class="sec">Sample 1. Customer orders <span class="tag device">Small</span> <span class="tag pii">Personal data</span></h2>
  <p class="lede">72 cells with names, emails and phone numbers. Tabletidy flags those three columns on the device and leaves them out of the export unless you say otherwise. Everyone in this table is made up.</p>
  <div class="sheet">${table("orders", ["Customer", "E-mail address", "Cell", "Town", "Ordered", "Order total"], contacts.map((r) => [esc(r[0]), r[1], r[2], r[3], r[4], zar(r[5])]))}</div>
</section>

<section id="prices">
  <h2 class="sec">Sample 2. Price list with messy headers <span class="tag device">Small</span></h2>
  <p class="lede">Rand prices with spaces and decimal commas, cryptic headers and day-month-year dates. The export turns <code>R 1 234,50</code> into <code>1234.5</code> and <code>03 Nov 2026</code> into <code>2026-11-03</code>.</p>
  <div class="sheet">${table("pricelist", ["itm_cd", "DESC.", "Prys (R) incl", "VAT?", "QTY O/H", "lst_upd"], prices.map((r) => [r[0], esc(r[1]), zar(r[2]), r[3], r[4], r[5]]))}</div>
</section>

<section id="shipments">
  <h2 class="sec">Sample 3. Shipment log, 260 rows <span class="tag cloud">Routes to cloud</span></h2>
  <p class="lede">2,080 cells, above the 1,500-cell limit Tabletidy sets for Gemini Nano's small context window. In Auto mode this one goes to Gemini in the cloud through Firebase AI Logic and the badge says why.</p>
  <div class="sheet scroll">${table("shipmentlog", ["Ref", "Dispatched", "Province", "Depot", "Method", "Mass", "Charge", "State"], big)}</div>
</section>

<section id="events">
  <h2 class="sec">A list that is not a table <span class="tag device">Extension</span></h2>
  <p class="lede">Cards built from plain <code>div</code> elements. The Tabletidy extension detects the repeated layout on any page and turns it into rows and columns.</p>
  <div class="listing">
${listings.map((l) => `    <div class="event"><h3>${esc(l[0])}</h3><span class="when">${l[1]}</span><span class="where">${l[2]}</span><span class="price">${l[3]}</span><span class="seats">${l[4]}</span></div>`).join("\n")}
  </div>
</section>

<section id="install">
  <h2 class="sec">Also a Chrome extension</h2>
  <p class="lede">The same code runs in a Chrome side panel, where it scans whatever page you are on and lets you pick one of the tables or repeated lists it finds. It is loaded unpacked in desktop Google Chrome 139 or newer. Full setup is in the <a href="https://github.com/skillmerc/tabletidy#extension-setup">README</a>.</p>
  <div class="panel"><ol class="steps">
    <li>Clone <a href="https://github.com/skillmerc/tabletidy">github.com/skillmerc/tabletidy</a>, add your Firebase web config, then run <code>npm install</code> and <code>npm run build:ext</code>.</li>
    <li>Open <code>chrome://extensions</code>, turn on Developer mode, click <em>Load unpacked</em> and choose <code>extension/dist</code>.</li>
    <li>Open any page with a table (this one works), click the Tabletidy toolbar button and press <em>Scan this page</em>.</li>
  </ol></div>
</section>
</main>

<footer><div class="wrap">
  Tabletidy is an entry for #BuildHybridAI 2026, built by SKILLMERC with an AI coding agent. Open source under Apache 2.0:
  <a href="https://github.com/skillmerc/tabletidy">github.com/skillmerc/tabletidy</a>. All data on this page is invented sample data.
  Cloud requests are protected by Firebase App Check (reCAPTCHA Enterprise).
</div></footer>
<script type="module" src="app/playground.js"></script>
</body>
</html>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${html.length} bytes, big table ${big.length}x${big[0].length} = ${big.length * big[0].length} cells)`);
