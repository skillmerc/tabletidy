// Extension-only setup for the shared AI module. Built during #BuildHybridAI 2026.
// Firebase web config is injected at build time from web/.env.local (see README "Setup").
// Extensions cannot use reCAPTCHA, so App Check runs with a registered debug token read
// from extension storage (Settings) or, for local builds only, from the build env.
import { configureAI } from "./ai.js";

const env = import.meta.env;
configureAI({
  firebaseConfig: {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  },
  appCheck: {
    kind: "debug",
    getToken: async () => (await chrome.storage.local.get("appCheckDebugToken")).appCheckDebugToken || env.VITE_APPCHECK_DEBUG_TOKEN,
  },
});
