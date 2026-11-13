# #BuildHybridAI 2026 - idea selection (SKILLMERC)

Scored 1-5 against the four judging criteria. Weighting: equal.

| # | Idea | Tech: hybrid AI Logic | Design: complete product | Impact: real problem/audience | Idea: non-obvious | Total |
|---|------|------|------|------|------|------|
| A | **Tabletidy**: Chrome extension that scrapes lists/tables (our List & Table Scraper engine) and uses Gemini Nano on-device to clean, label and type columns; cloud Gemini takes over for long/complex pages; PII columns are redacted on-device before anything goes to cloud | 5 | 5 | 4 | 4 | **18** |
| B | Paste guard: extension that redacts personal data from text before you paste it into any cloud chatbot (Nano does detection, cloud does nothing) | 3 (cloud path is thin) | 4 | 4 | 4 | 15 |
| C | Private statement categoriser: web app that categorises bank statement CSVs on-device, cloud only for ambiguous merchants with amounts stripped | 4 | 3 | 3 | 3 | 13 |

## Pick: A, "Tabletidy" (working name; repo skillmerc/tabletidy)

Why A wins:
- Hybrid is load-bearing, not decorative. Each job is routed: short tables -> Gemini Nano (private, free, offline); long or messy pages -> cloud Gemini via Firebase AI Logic; and the cloud never sees raw personal data because a first on-device pass flags PII columns and masks them. That "privacy split" is the non-obvious part (it folds idea B into A).
- Complete product, not a PoC: the scraping engine (detect repeated data, follow Next pages, CSV/XLSX export) already works and has real users, so the build period goes into the AI layer and polish.
- Real audience: people who copy tables out of web pages into spreadsheets (sales ops, researchers, analysts) and fight with merged cells, units in strings, "R 1 234,50" style numbers, mixed date formats and unnamed columns.

### AI features to build (phase 2)
1. **Name columns**: Nano proposes header names for unnamed/garbled columns (structured JSON output).
2. **Type columns**: number / currency / date / percent / URL / email / category / text, with a normaliser (strings -> real values) applied in JS from the model's per-column type + format hint (e.g. decimal comma, currency symbol).
3. **PII guard**: Nano flags columns holding names/emails/phones/addresses; those are masked before any cloud call and can be dropped from export.
4. **Ask the table**: one-shot natural-language question or transform ("only rows where price < 500", "split city/country") answered as a filter/transform spec.
5. **Routing + indicator**: visible "On device" / "Cloud" badge per run with the reason ("table > N cells", "Nano not available", "user forced cloud"), using InferenceMode PREFER_ON_DEVICE by default and a settings toggle for ONLY_ON_DEVICE (strict privacy) and PREFER_IN_CLOUD.

### Rules compliance notes
- Existing code: List & Table Scraper existed before 11 Nov 2026 (MV3 extension, public on Firefox AMO with ~12 daily users). Submission text must include (a) a summary of what was built during 11-30 Nov (all AI features, Firebase/App Check integration, new UI), (b) the core value the existing app brings (detection/extraction/export engine), (c) optional usage numbers. Keep a CHANGELOG/commit history starting after 11 Nov for the new work.
- Demo: generic public demo pages we control (e.g. a GitHub Pages sample table), no third-party logos/brands on screen.
- No production secrets in repo; Firebase web config only (public by design), App Check enforced, debug token NOT committed.
