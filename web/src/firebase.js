// Firebase + App Check + Firebase AI Logic (hybrid) setup.
// Config comes from web/.env.local (gitignored; see .env.example). Firebase web config is
// public by design, but we keep it out of the repo; access is protected by App Check.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";

const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const RECAPTCHA_ENTERPRISE_SITE_KEY = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;

export const app = initializeApp(firebaseConfig);

// Local dev: use the App Check debug provider. The token comes from web/.env.local
// (never committed). `true` makes the SDK print a fresh token to register.
const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
if (import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true;
}

export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

export const ai = getAI(app, { backend: new GoogleAIBackend() });

export { InferenceMode };

/** Build a hybrid model. Default: on-device Gemini Nano first, cloud Gemini fallback. */
export function hybridModel(mode = InferenceMode.PREFER_ON_DEVICE, extra = {}) {
  return getGenerativeModel(ai, {
    mode,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      },
    },
    ...extra,
  });
}
