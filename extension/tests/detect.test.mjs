// Reused from List & Table Scraper 1.2.0 (detection engine tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { findCandidates, extract, signature, rematch, cssPath, findNext, dedupeRows } from "../src/lib/detect.js";

const nav = `<ul class="nav"><li><a href="/a">Home</a></li><li><a href="/b">About</a></li><li><a href="/c">Blog</a></li><li><a href="/d">Help</a></li></ul>`;
const card = (i, extra = "") => `<div class="card product item-${1000 + i}"><a class="title" href="/p/${i}">Product number ${i} with a longer name</a><img src="/img/${i}.jpg"><span class="price">$${i}.99</span>${extra}<p class="desc">Description text for item ${i} that is long enough to matter.</p></div>`;
const shop = (n, start = 1) => `<html><body>${nav}<main><div class="grid">${Array.from({ length: n }, (_, k) => card(start + k, k % 4 === 0 ? '<span class="badge">Sale</span>' : "")).join("")}</div><a class="next" href="/page/2">Next</a></main><footer><p>a</p><p>b</p><p>c</p></footer></body></html>`;

test("signature ignores dynamic classes and sorts the rest", () => {
  const { document } = parseHTML(`<html><body><div class="product card item-12345 active"></div></body></html>`);
  assert.equal(signature(document.querySelector("div")), "div.card.product");
  const { document: d2 } = parseHTML(`<html><body><li class="wp-block-post post-163 plugin type-plugin status-publish plugin_tags-shop"></li></body></html>`);
  assert.equal(signature(d2.querySelector("li")), "li.plugin.type-plugin.wp-block-post");
});

test("picks the product grid over the nav menu and footer", () => {
  const { document } = parseHTML(shop(12));
  const c = findCandidates(document);
  assert.ok(c.length >= 2);
  assert.equal(c[0].container.className, "grid");
  assert.equal(c[0].rows.length, 12);
  assert.equal(c[0].rowSig, "div.card.product");
  assert.ok(c.some((x) => x.container.className === "nav"), "nav is a lower ranked alternative");
});

test("extracts text, absolute links and images; drops sparse columns", () => {
  const { document } = parseHTML(shop(10));
  const [best] = findCandidates(document);
  const { columns, rows } = extract(best, "https://shop.example/list");
  const names = columns.map((c) => c.name);
  assert.deepEqual(names, ["title", "title link", "image", "price", "badge", "desc"]);
  assert.equal(rows.length, 10);
  assert.equal(rows[0][1], "https://shop.example/p/1");
  assert.equal(rows[0][2], "https://shop.example/img/1.jpg");
  assert.equal(rows[2][3], "$3.99");
  assert.equal(rows[0][4], "Sale");
  assert.equal(rows[1][4], "");
  // badge is on 3 of 10 rows (30%): kept at the default 0.3, dropped at 0.5
  const strict = extract(best, "https://shop.example/", { minFill: 0.5 });
  assert.ok(!strict.columns.some((c) => c.name === "badge"));
});

test("columns filled in at least 30% of rows are kept", () => {
  const rows = Array.from({ length: 10 }, (_, i) => `<li class="r"><b>Name ${i}</b>${i < 3 ? `<i>note ${i}</i>` : ""}${i < 2 ? `<u>rare ${i}</u>` : ""}</li>`).join("");
  const { document } = parseHTML(`<html><body><ul>${rows}</ul></body></html>`);
  const { columns } = extract(findCandidates(document)[0], "https://x.test/");
  assert.deepEqual(columns.map((c) => c.name), ["b", "i"]);
});

test("tables use header cells as column names and skip the header row", () => {
  const body = Array.from({ length: 5 }, (_, i) => `<tr><td>Row ${i}</td><td><a href="https://x.test/${i}">link ${i}</a></td><td>${i * 10}</td></tr>`).join("");
  const { document } = parseHTML(`<html><body><table><thead><tr><th>Name</th><th>Site</th><th>Score</th></tr></thead><tbody>${body}</tbody></table></body></html>`);
  const [best] = findCandidates(document);
  assert.equal(best.container.tagName, "TBODY");
  const { columns, rows } = extract(best, "https://x.test/");
  assert.deepEqual(columns.map((c) => c.name), ["Name", "Site", "Site link", "Score"]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[4], ["Row 4", "link 4", "https://x.test/4", "40"]);
});

test("tables without thead still get header names from a th row", () => {
  const body = Array.from({ length: 4 }, (_, i) => `<tr><td>A${i}</td><td>B${i}</td></tr>`).join("");
  const { document } = parseHTML(`<html><body><table><tr><th>Col A</th><th>Col B</th></tr>${body}</table></body></html>`);
  const best = findCandidates(document)[0];
  const { columns, rows } = extract(best, "https://x.test/");
  assert.deepEqual(columns.map((c) => c.name), ["Col A", "Col B"]);
  assert.equal(rows.length, 4);
});

test("duplicate rows are removed, also across pages with a shared seen set", () => {
  const seen = new Set();
  assert.equal(dedupeRows([["a", "1"], ["a", "1"], ["b", "2"]], seen).length, 2);
  assert.equal(dedupeRows([["b", "2"], ["c", "3"]], seen).length, 1);
});

test("rematch finds the same block on the next page and keeps page 1 columns", () => {
  const p1 = parseHTML(shop(8)).document;
  const best = findCandidates(p1)[0];
  const first = extract(best, "https://shop.example/");
  const p2 = parseHTML(shop(8, 9)).document;
  const again = rematch(p2, best);
  assert.ok(again);
  assert.equal(again.rows.length, 8);
  const second = extract(again, "https://shop.example/page/2", { keys: first.columns.map((c) => c.key) });
  assert.equal(second.columns.length, first.columns.length);
  assert.equal(second.rows[0][0], "Product number 9 with a longer name");
});

test("Next button is found again by path, then by text, then rel=next", () => {
  const { document } = parseHTML(shop(5));
  const a = document.querySelector("a.next");
  const spec = { path: cssPath(a), text: "Next" };
  assert.equal(findNext(document, spec), a);
  const moved = parseHTML(`<html><body><div><span>x</span><a href="/3">Next</a></div></body></html>`).document;
  assert.equal(findNext(moved, spec).getAttribute("href"), "/3");
  const rel = parseHTML(`<html><head><link rel="next" href="/4"></head><body><p>x</p></body></html>`).document;
  assert.equal(findNext(rel, { path: "#nope", text: "Weiter" }).getAttribute("href"), "/4");
});

test("ignores the excluded element (our own panel)", () => {
  const { document } = parseHTML(`<html><body><div id="panel">${Array.from({ length: 30 }, (_, i) => `<p class="x">panel line ${i} with plenty of text in it</p>`).join("")}</div><ul>${Array.from({ length: 4 }, (_, i) => `<li>Item ${i}</li>`).join("")}</ul></body></html>`);
  const c = findCandidates(document, { exclude: document.getElementById("panel") });
  assert.equal(c[0].container.tagName, "UL");
});

test("Hacker News style rows: picks tr.athing", () => {
  const rows = Array.from({ length: 30 }, (_, i) => `<tr class="athing" id="${4000 + i}"><td class="title"><span class="rank">${i + 1}.</span></td><td class="title"><span class="titleline"><a href="https://site${i}.test/">Story title ${i} about something</a><span class="sitebit"> (<a href="from?site=s${i}"><span class="sitestr">s${i}.test</span></a>)</span></span></td></tr><tr><td colspan="2"></td><td class="subtext"><span class="score">${i} points</span></td></tr><tr class="spacer"></tr>`).join("");
  const { document } = parseHTML(`<html><body><table id="hnmain"><tr><td><table><tbody>${rows}</tbody></table></td></tr></table></body></html>`);
  const best = findCandidates(document)[0];
  assert.equal(best.rowSig, "tr.athing");
  const { columns, rows: out } = extract(best, "https://news.ycombinator.com/");
  assert.equal(out.length, 30);
  assert.ok(columns.some((c) => c.name.endsWith("link")));
  assert.equal(out[0][0], "1.");
});

test("rows whose classes all differ still group by tag", () => {
  const items = Array.from({ length: 6 }, (_, i) => `<li class="x${i}a y${i}b"><h3>Name ${i}</h3><p>Some text for row ${i}</p></li>`).join("");
  const { document } = parseHTML(`<html><body><ul class="results">${items}</ul><p>x</p></body></html>`);
  const [best] = findCandidates(document);
  assert.equal(best.rowSig, "li*");
  assert.equal(best.rows.length, 6);
  const p2 = parseHTML(`<html><body><ul class="results">${items}</ul></body></html>`).document;
  assert.equal(rematch(p2, best).rows.length, 6);
});

test("a data table outranks a similar sized text list", () => {
  const refs = Array.from({ length: 50 }, (_, i) => `<li><a href="#r${i}">^</a> <cite>Reference number ${i} with a fairly long citation title here</cite></li>`).join("");
  const trs = Array.from({ length: 40 }, (_, i) => `<tr><td>${i}</td><td>Company ${i}</td><td>$${i}00 billion</td><td>Country</td></tr>`).join("");
  const { document } = parseHTML(`<html><body><table><tbody><tr><th>#</th><th>Name</th><th>Revenue</th><th>HQ</th></tr>${trs}</tbody></table><ol class="references">${refs}</ol></body></html>`);
  assert.equal(findCandidates(document)[0].container.tagName, "TBODY");
});

test("row header cells (th) and colspan keep columns aligned with headers", () => {
  const trs = Array.from({ length: 4 }, (_, i) => `<tr><th>${i + 1}</th><td><a href="/c${i}">Co ${i}</a></td><td>${i}0</td></tr>`).join("");
  const { document } = parseHTML(`<html><body><table><thead><tr><th>Rank</th><th colspan="1">Name</th><th>Revenue</th></tr></thead><tbody>${trs}</tbody></table></body></html>`);
  const { columns, rows } = extract(findCandidates(document)[0], "https://x.test/");
  assert.deepEqual(columns.map((c) => c.name), ["Rank", "Name", "Name link", "Revenue"]);
  assert.deepEqual(rows[0], ["1", "Co 0", "https://x.test/c0", "00"]);
});

test("rowspan cells do not shift the next rows", () => {
  const { document } = parseHTML(`<html><body><table><tbody>
    <tr><th>Rank</th><th>Name</th><th>Industry</th><th>Revenue</th></tr>
    <tr><td>1</td><td>A</td><td rowspan="2">Retail</td><td>10</td></tr>
    <tr><td>2</td><td>B</td><td>20</td></tr>
    <tr><td>3</td><td>C</td><td>Oil</td><td>30</td></tr>
  </tbody></table></body></html>`);
  const { columns, rows } = extract(findCandidates(document)[0], "https://x.test/");
  assert.deepEqual(columns.map((c) => c.name), ["Rank", "Name", "Industry", "Revenue"]);
  assert.deepEqual(rows, [["1", "A", "Retail", "10"], ["2", "B", "", "20"], ["3", "C", "Oil", "30"]]);
});

test("rows without children (plain links) are kept, oversized section rows are skipped", () => {
  const big = (i) => `<section>${Array.from({ length: 450 }, (_, k) => `<i>${i}-${k}</i>`).join("")}</section>`;
  const { document } = parseHTML(`<html><body><main>${big(1)}${big(2)}${big(3)}</main><div class="tags"><a class="tag" href="/t/a">alpha</a><a class="tag" href="/t/b">beta</a><a class="tag" href="/t/c">gamma</a></div></body></html>`);
  const c = findCandidates(document);
  assert.ok(!c.some((x) => x.rowSig === "section"));
  const tags = c.find((x) => x.rowSig === "a.tag");
  const { columns, rows } = extract(tags, "https://x.test/");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ["alpha", "https://x.test/t/a"]);
  assert.equal(columns.length, 2);
});
