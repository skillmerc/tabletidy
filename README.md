# Tabletidy

**Pick a table on any web page. Get a clean spreadsheet. Personal data never leaves your machine unmasked.**

Tabletidy is a Chrome extension built for #BuildHybridAI 2026. Open it on a page, pick one of the tables or repeated lists it finds, and it proposes clean column names, a type for every column (date, money, number, percent, email, phone, URL, text) and flags columns that hold personal data. Export CSV, JSON or paste straight into Sheets, with real numbers and ISO dates instead of `"R 1 234,50"` and `03 Nov 2026`.

## Value proposition

People who copy tables out of web pages (sales ops, researchers, analysts, admins) spend their time renaming `col3` and `a href` columns, fixing numbers with spaces and decimal commas, and deleting customer names and emails before they share a file. Tabletidy does that in one click, and it does the sensitive part on the device:

- **Small tables run on Gemini Nano in Chrome**: private, free, works offline, about a second.
- **Large tables go to Gemini in the cloud** through Firebase AI Logic, because Nano has a small context window. Columns flagged as personal data are **masked on the device before the request is built**.
- **Every run shows where it ran**: an `On device` or `Cloud` badge with the time and the reason ("Small table (84 cells)", "Large table (6,000 cells)", "Gemini Nano not available here, cloud fallback", "Strict privacy: on device only").
- **"What the model saw"** shows the exact sample that was sent, masks included.

## How Firebase AI Logic hybrid inference is used

All runtime calls are in [`extension/src/ai.js`](extension/src/ai.js):

| What | Where |
|---|---|
| App Check (required by AI Logic) | `initializeAppCheck(...)` [ai.js line 56](extension/src/ai.js#L56) |
| AI Logic backend (Gemini Developer API) | `getAI(app, { backend: new GoogleAIBackend() })` [ai.js line 60](extension/src/ai.js#L60) |
| Hybrid model per routing decision | `getGenerativeModel(ai, { mode: InferenceMode[...], onDeviceParams, inCloudParams })` [ai.js lines 67-84](extension/src/ai.js#L67) |
| Same JSON Schema on both runtimes | `responseConstraint` on device [line 77](extension/src/ai.js#L77), `responseSchema` in the cloud |
| Nano download on a user click | `model.initializeDeviceModel()` [line 103](extension/src/ai.js#L103) |
| The call | `model.generateContent(prompt)` [line 105](extension/src/ai.js#L105) |
| On device / Cloud badge | `result.response.inferenceSource` [line 108](extension/src/ai.js#L108) |

The routing and the privacy rule are plain, unit-tested functions in [`extension/src/lib/tidy.js`](extension/src/lib/tidy.js):

- `route()` ([tidy.js line 15](extension/src/lib/tidy.js#L15)): **Auto** uses `PREFER_ON_DEVICE` for tables up to 1,500 cells and `PREFER_IN_CLOUD` above that. **On device only** uses `ONLY_ON_DEVICE` (raw values allowed because nothing leaves the browser). **Cloud** uses `ONLY_IN_CLOUD`. Every mode that can reach the cloud has `mask: true`.
- `buildPrompt()` ([tidy.js line 46](extension/src/lib/tidy.js#L46)) masks the flagged columns *before* the prompt text exists. Masks keep the shape (`+00 00 000 0000`, `name@example.com`, `Person Name`) so the model can still type the column.
- `mergeColumns()` ([tidy.js line 109](extension/src/lib/tidy.js#L109)): the model can rename, retype (only if the values actually parse as that type) and *add* personal-data flags. It can never remove a flag set by the on-device rules.
- The side panel wires it together in [`extension/src/sidepanel.js`](extension/src/sidepanel.js#L60) (route, build prompt, `runPrompt`).

The flow for one run: scan page (reused engine) -> on-device rules type every column and flag personal data ([`lib/infer.js`](extension/src/lib/infer.js), [`lib/pii.js`](extension/src/lib/pii.js)) -> route -> mask -> Firebase AI Logic hybrid call -> merge -> preview -> export.

## Setup (under 10 minutes)

Requirements: Node 20+, desktop Google Chrome 139 or newer.

1. **Firebase project** (free Spark plan): create a project, add a Web app, open *AI Logic* and choose the Gemini Developer API. In *App Check*, register the web app and add a debug token.
2. **Config**: `cp .env.example web/.env.local` and fill in the web app config. `VITE_APPCHECK_DEBUG_TOKEN` is optional; you can paste the debug token into the extension's Settings instead.
3. **Build**: `npm install`, then `npm run build:ext` (outputs `extension/dist`). Run `npm test` for the unit tests.
4. **Load**: `chrome://extensions` -> Developer mode -> *Load unpacked* -> `extension/dist`. Pin Tabletidy and click it on any page with a table.
5. **Gemini Nano**: check `chrome://on-device-internals` (or `await LanguageModel.availability()` in DevTools). If it says `downloadable`, the first *Tidy columns* click starts the download; until it finishes, Auto mode falls back to the cloud and the badge says so.

The extension ID is fixed by the `key` in [`extension/public/manifest.json`](extension/public/manifest.json) (`cedaeknpomelhkeakeeifcmmmcjdookp`), so the Firebase browser API key can be restricted to that origin. Our key is also restricted to the Firebase AI Logic, App Check and Installations APIs.

A small web smoke test of the same hybrid call lives in [`web/`](web/) (`npm run dev`, http://localhost:5173).

## Built during the contest vs reused

Tabletidy reuses the scraping engine of SKILLMERC's existing **List & Table Scraper** browser extension (public on Firefox Add-ons, about 12 daily users). It brings the part that is not AI: finding repeated rows and tables in any DOM, extracting cells and links, and writing CSV/JSON. Reused files, unchanged and marked at the top: `extension/src/lib/detect.js`, `export.js`, `zip.js`, the icons and `tests/detect.test.mjs`.

Built during the submission period (from 11 Nov 2026):

- Firebase project, AI Logic (Gemini Developer API), App Check, API key restrictions.
- `ai.js`: Firebase AI Logic hybrid inference with structured output on both runtimes.
- `lib/tidy.js`: routing, privacy masking, prompt, merge rules, export shaping.
- `lib/pii.js`: on-device personal-data rules and shape-preserving masks.
- `lib/infer.js`: deterministic type inference and value normalising (decimal commas, currency, ISO dates).
- The side panel UI (`sidepanel.html/.css/.js`), the content script wrapper and the service worker.
- Unit tests `tests/infer`, `tests/pii`, `tests/tidy`; the `web/` smoke test.

## AI coding agent disclosure

Most of the code in this repository was written by an AI coding agent (Aside, an agentic browser assistant running Anthropic's Claude) working for SKILLMERC, directed and reviewed by Kyle Pretorius. The agent also set up the Firebase project and the API key restrictions through the consoles. No other pre-existing code is included beyond the List & Table Scraper engine listed above and the open-source npm dependencies in `package.json`.

## Privacy

- Table data is only read after you click the toolbar button on a page (`activeTab`).
- On device only mode never sends table data anywhere.
- In Auto and Cloud mode, columns flagged as personal data are replaced by placeholders before the prompt is built. You can flag or unflag any column, and exports leave flagged columns out by default.
- Nothing is stored except the App Check debug token you paste into Settings.

## License

Apache License 2.0. See [LICENSE](LICENSE).
