# Devpost entry text (draft, #BuildHybridAI 2026)

**Name:** Tabletidy

**Tagline:** Paste or pick any table and get a clean spreadsheet. Gemini Nano tidies it on your device; big tables go to the cloud with personal data masked first.

**Platform:** Web (Chrome). **Entrant:** SKILLMERC (organisation), Representative: Kyle Pretorius.

**Links:** Try it https://tabletidy-82369.web.app | Code https://github.com/skillmerc/tabletidy (Apache 2.0)

## Description

### Inspiration
People who copy tables out of web pages and exports (sales ops, researchers, analysts, admins) lose time to the same three chores: renaming columns called `col3`, fixing numbers like `R 1 234,50` and dates like `03 Nov 2026`, and deleting customer names and emails before a file can be shared. The third chore is the one that stops people pasting a table into a cloud AI tool at all.

### What it does
Tabletidy is a web app you can try right now at https://tabletidy-82369.web.app, with no install and no account. Pick one of the sample tables or paste your own (HTML table, CSV, or rows copied from a spreadsheet) and press Tidy columns. The same code also ships as a Chrome extension that scans any page for tables and repeated lists. It then:

- proposes clean column names and a type for every column (date, money, number, percent, email, phone, URL, text);
- flags columns that hold personal data with on-device rules before any model is called;
- shows an **On device** or **Cloud** badge for every run, with the time and the reason (for example "Small table (72 cells)", "Large table (2,080 cells)" or "On-device answer failed validation (not JSON), cloud fallback");
- shows "What the model saw": the exact prompt that was sent, masks included;
- lets you rename, retype and re-flag any column, then exports CSV, JSON or a paste for Sheets with real numbers and ISO dates, leaving personal-data columns out by default.

### How we used Firebase AI Logic
Every model call goes through the Firebase AI Logic web SDK's hybrid inference (`firebase/ai`, Gemini Developer API backend), in `extension/src/ai.js`, one module shared by the hosted app and the extension:

- `getGenerativeModel(ai, { mode, onDeviceParams, inCloudParams })` is created per run with the `InferenceMode` chosen by our routing rule: `PREFER_ON_DEVICE` for tables up to 1,500 cells, `PREFER_IN_CLOUD` above that because Gemini Nano has a small context window, `ONLY_ON_DEVICE` for the strict privacy setting, `ONLY_IN_CLOUD` when the user picks Cloud.
- The same schema is passed to both runtimes (`responseConstraint` on device, `responseSchema` in the cloud), so the app handles one answer shape.
- Every answer is validated again in our own code (`lib/hybrid.js`). If a prefer-on-device answer is empty, not JSON or fails validation, the same already-masked prompt is retried once in the cloud and the badge says why. The strict "On device only" setting never falls back.
- The page shows the on-device model status (not available, not downloaded, downloading with progress, ready). `model.initializeDeviceModel()` runs on the user's click to download Gemini Nano; until it is ready, Auto mode uses the cloud and the badge says so.
- `result.response.inferenceSource` drives the On device / Cloud badge, so the badge reports where the call really ran.
- Firebase App Check protects the AI Logic endpoint: reCAPTCHA Enterprise on the hosted app, a debug token in the unpacked extension. A request without a valid token is rejected. The browser API key is restricted to the Firebase AI Logic, App Check and Installations APIs.
- Firebase Hosting serves the app.

The privacy rule is code, not a promise: any mode that can reach the cloud masks the flagged columns before the prompt text is built (`buildPrompt()` in `extension/src/lib/tidy.js`), with shape-preserving placeholders such as `name@example.com` so the model can still type the column. The model may add personal-data flags but can never remove one set by the device rules.

### Value proposition
One click instead of ten minutes of cleanup per table, without the usual trade: small tables can stay in the browser, and large ones leave it without the personal data. Hybrid inference is what makes that possible. On-device alone cannot read a 2,000-cell table, and cloud alone means sending customer data to a server to find out which columns are customer data.

### Built during the submission period vs reused
Tabletidy reuses the scraping engine of SKILLMERC's existing **List & Table Scraper** browser extension, which is public on Firefox Add-ons and has about 12 daily users. That engine is the core value the existing app brings: finding repeated rows and tables in any page, extracting cells and links, and writing CSV/JSON. The reused files are `extension/src/lib/detect.js`, `export.js`, `zip.js`, the icons and `tests/detect.test.mjs`, unchanged and marked at the top.

Built from 11 Nov 2026 for this contest: the Firebase project (AI Logic, App Check, API key restrictions, Hosting); `ai.js` (hybrid inference with structured output on both runtimes, model status and download); `lib/hybrid.js` (answer validation and fallback); `lib/tidy.js` (routing, masking, prompt, merge rules); `lib/pii.js` (on-device personal-data rules and masks); `lib/infer.js` (type inference and value normalising for decimal commas, currencies and dates); `lib/parse.js` (pasted tables); the shared view and look (`app.js`, `ui.css`); the hosted app and its build; the side panel, content script and service worker; 32 new unit tests (48 with the reused engine tests).

### How to test
Open https://tabletidy-82369.web.app in desktop Google Chrome. Under "Try it now" click Customer orders, then Tidy columns. Check the badge and its reason, open "What the model saw", edit a column, then Download CSV. Try Shipment log to see a large table route to the cloud, or paste your own table. No login or key is needed. If the status line says Gemini Nano is not downloaded yet, click Download model (about 3 GB, one time); until it is ready, runs use the cloud and say so. To try the extension as well, follow "Extension setup" in the README. `npm test` runs 48 unit tests.

### What's next
A Chrome Web Store listing, per-site saved recipes, and "ask the table" questions answered on device.

Built by SKILLMERC with an AI coding agent.

**Built with:** firebase, firebase-ai-logic, gemini, gemini-nano, chrome-extension, javascript, firebase-app-check, firebase-hosting
