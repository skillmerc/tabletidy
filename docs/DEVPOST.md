# Devpost entry text (draft, #BuildHybridAI 2026)

**Name:** Tabletidy

**Tagline:** Pick a table on any web page and get a clean spreadsheet. Gemini Nano tidies it on your device; big tables go to the cloud with personal data masked first.

**Platform:** Web (Chrome). **Entrant:** SKILLMERC (organisation), Representative: Kyle Pretorius.

**Links:** Code https://github.com/skillmerc/tabletidy (Apache 2.0) | Demo page https://tabletidy-82369.web.app

## Description

### Inspiration
People who copy tables out of web pages (sales ops, researchers, analysts, admins) lose time to the same three chores: renaming columns called `col3`, fixing numbers like `R 1 234,50` and dates like `03 Nov 2026`, and deleting customer names and emails before a file can be shared. The third chore is the one that stops people pasting a table into a cloud AI tool at all.

### What it does
Tabletidy is a Chrome extension. Open its side panel on any page, press Scan, and pick one of the tables or repeated lists it finds. It then:

- proposes clean column names and a type for every column (date, money, number, percent, email, phone, URL, text);
- flags columns that hold personal data with on-device rules before any model is called;
- shows an **On device** or **Cloud** badge for every run, with the time and the reason (for example "Small table (72 cells)" or "Large table (2,080 cells)");
- shows "What the model saw": the exact sample that was sent, masks included;
- exports CSV, JSON or a paste for Sheets with real numbers and ISO dates, leaving personal-data columns out by default.

### How we used Firebase AI Logic
Every model call goes through the Firebase AI Logic web SDK's hybrid inference (`firebase/ai`, Gemini Developer API backend), in `extension/src/ai.js`:

- `getGenerativeModel(ai, { mode, onDeviceParams, inCloudParams })` is created per run with the `InferenceMode` chosen by our routing rule: `PREFER_ON_DEVICE` for tables up to 1,500 cells, `PREFER_IN_CLOUD` above that because Gemini Nano has a small context window, `ONLY_ON_DEVICE` for the strict privacy setting, `ONLY_IN_CLOUD` when the user picks Cloud.
- The same JSON Schema is passed to both runtimes (`responseConstraint` on device, `responseSchema` in the cloud), so the app handles one answer shape.
- `model.initializeDeviceModel()` runs on the user's click to start the Gemini Nano download; until it finishes, Auto mode falls back to the cloud and the badge says so.
- `result.response.inferenceSource` drives the On device / Cloud badge, so the badge reports where the call really ran.
- Firebase App Check protects the AI Logic endpoint (reCAPTCHA Enterprise provider for the hosted origin, debug provider for the unpacked extension). The browser API key is restricted to the Firebase AI Logic, App Check and Installations APIs.
- Firebase Hosting serves the demo page.

The privacy rule is code, not a promise: any mode that can reach the cloud masks the flagged columns before the prompt text is built (`buildPrompt()` in `extension/src/lib/tidy.js`), with shape-preserving placeholders such as `name@example.com` so the model can still type the column. The model may add personal-data flags but can never remove one set by the device rules.

### Value proposition
One click instead of ten minutes of cleanup per table, without the usual trade: small tables never leave the browser, and large ones leave it without the personal data. Hybrid inference is what makes that possible. On-device alone cannot read a 2,000-cell table, and cloud alone means sending customer data to a server to find out which columns are customer data.

### Built during the submission period vs reused
Tabletidy reuses the scraping engine of SKILLMERC's existing **List & Table Scraper** browser extension, which is public on Firefox Add-ons and has about 12 daily users. That engine is the core value the existing app brings: finding repeated rows and tables in any page, extracting cells and links, and writing CSV/JSON. The reused files are `extension/src/lib/detect.js`, `export.js`, `zip.js`, the icons and `tests/detect.test.mjs`, unchanged and marked at the top.

Built from 11 Nov 2026 for this contest: the Firebase project (AI Logic, App Check, API key restrictions, Hosting); `ai.js` (hybrid inference with structured output on both runtimes); `lib/tidy.js` (routing, masking, prompt, merge rules); `lib/pii.js` (on-device personal-data rules and masks); `lib/infer.js` (type inference and value normalising for decimal commas, currencies and dates); the side panel UI, content script and service worker; 20 new unit tests (36 with the reused engine tests); the hosted demo page and its generator.

### How to test
Follow "Setup" in the README (about 10 minutes, free Spark plan, desktop Chrome 139 or newer), load `extension/dist` as an unpacked extension, then open https://tabletidy-82369.web.app and press Scan. The page has four samples: customer orders with personal data, a rand price list with messy headers, a 2,080-cell shipment log that routes to the cloud, and a card list that is not a table. `npm test` runs 36 unit tests, including one that checks the demo page against the detection, privacy and routing code.

### What's next
A Chrome Web Store listing, per-site saved recipes, and "ask the table" questions answered on device.

Built by SKILLMERC with an AI coding agent.

**Built with:** firebase, firebase-ai-logic, gemini, gemini-nano, chrome-extension, javascript, firebase-app-check, firebase-hosting
