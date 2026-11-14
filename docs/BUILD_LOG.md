# Build log (#BuildHybridAI 2026 submission period: 11-30 Nov 2026)

- 2026-11-13: Project created. Firebase project with Firebase AI Logic (Gemini Developer API) and App Check (reCAPTCHA Enterprise). Web smoke test making a hybrid `generateContent` call with structured output; verified the cloud path end to end.
- 2026-11-13: Chrome extension source: side panel, Firebase AI Logic hybrid module, routing, personal-data rules, type inference, unit tests. Browser API key restricted.
- 2026-11-14: Sample page on Firebase Hosting. Then the hosted playground: the same modules now run as a web app at https://tabletidy-82369.web.app with App Check (reCAPTCHA Enterprise). Added answer validation with on-device to cloud fallback (`lib/hybrid.js`), pasted-table parsing (`lib/parse.js`), a shared view and look for site and side panel (`app.js`, `ui.css`), model status with a download button, 48 unit tests, screenshots in `docs/screens`.
