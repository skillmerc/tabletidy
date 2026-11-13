# Tabletidy

Scrape any list or table on a web page and get a clean spreadsheet: named columns, real numbers and dates, and personal data flagged before anything leaves your machine.

Tabletidy is a Chrome extension (plus a small web demo) built for #BuildHybridAI 2026. It uses **Firebase AI Logic hybrid inference**: Gemini Nano runs on the device in Chrome for small and private jobs, and Gemini in the cloud takes over for long or messy pages, with an "On device" / "Cloud" badge on every run.

> Status: work in progress (phase 1 scaffold). The smoke test in `web/` makes a real hybrid call; the extension lands in phase 2.

## Why hybrid

| Job | Where it runs | Why |
|---|---|---|
| Name and type columns of a short table | Gemini Nano, on device | Private, free, offline, fast |
| Flag columns holding personal data | Gemini Nano, on device | Raw rows never leave the browser |
| Long or complex pages | Gemini in the cloud (Firebase AI Logic) | More context and accuracy; personal-data columns are masked first |
| Device without Gemini Nano | Gemini in the cloud | Same features on any desktop |

## How Firebase AI Logic is used

- `firebase/ai`: `getAI(app, { backend: new GoogleAIBackend() })` and `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, onDeviceParams, inCloudParams })` in [`web/src/firebase.js`](web/src/firebase.js) and [`web/src/main.js`](web/src/main.js).
- `model.initializeDeviceModel()` on a user click, then `generateContent()` with structured output (JSON Schema on device via `responseConstraint`, `responseSchema` in the cloud).
- `result.response.inferenceSource` drives the On device / Cloud badge.
- Firebase App Check with reCAPTCHA Enterprise protects the Gemini API; local development uses the App Check debug provider.

## Run the web smoke test

Requirements: Node 20+, desktop Google Chrome 139+ (for on-device inference).

```bash
npm install
cp .env.example web/.env.local   # fill in your Firebase web config, reCAPTCHA Enterprise site key and App Check debug token
npm run dev                      # http://localhost:5173
```

On-device inference: open `chrome://on-device-internals` (or run `await LanguageModel.availability()` in DevTools) and make sure the model is `available`. The first request downloads it if needed.

## Built on

The scraping engine (detecting repeated data, following Next pages, CSV/XLSX export) comes from SKILLMERC's existing open browser extension, List & Table Scraper. Everything AI-related (Firebase AI Logic, App Check, hybrid routing, column naming/typing, personal-data guard, the new UI) is built during the #BuildHybridAI submission period (from 11 Nov 2026). See [docs/BUILD_LOG.md](docs/BUILD_LOG.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
