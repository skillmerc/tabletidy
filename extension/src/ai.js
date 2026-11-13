// Firebase AI Logic hybrid inference for the side panel. Built during #BuildHybridAI 2026.
// - One Firebase app + App Check (required by AI Logic).
// - getGenerativeModel(..., { mode }) with InferenceMode PREFER_ON_DEVICE / PREFER_IN_CLOUD /
//   ONLY_ON_DEVICE / ONLY_IN_CLOUD: Gemini Nano in Chrome when available, Gemini in the cloud otherwise.
// - The same structured-output schema is enforced on both runtimes.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, CustomProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from "firebase/ai";
import { TYPES } from "./lib/infer.js";

// Firebase web config (public by design; the API key is restricted to this extension's
// origin and to the AI Logic / App Check / Installations APIs). Injected at build time
// from web/.env.local, see README "Setup".
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const CLOUD_MODEL = "gemini-3.5-flash-lite";

const responseSchema = Schema.object({
  properties: {
    title: Schema.string(),
    columns: Schema.array({
      items: Schema.object({
        properties: {
          index: Schema.integer(),
          name: Schema.string(),
          type: Schema.enumString({ enum: TYPES }),
          personalData: Schema.boolean(),
        },
      }),
    }),
  },
});

let ai = null;
const models = new Map();

/**
 * Start Firebase lazily. Extensions cannot use reCAPTCHA, so App Check runs with a
 * registered debug token (accepted by the contest rules) read from extension storage
 * (Settings) or, for local builds only, from the build env.
 */
export async function initAI() {
  if (ai) return ai;
  const { appCheckDebugToken } = await chrome.storage.local.get("appCheckDebugToken");
  const token = appCheckDebugToken || env.VITE_APPCHECK_DEBUG_TOKEN;
  if (token) self.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
  const app = initializeApp(firebaseConfig);
  initializeAppCheck(app, {
    provider: new CustomProvider({ getToken: () => Promise.reject(new Error("Cloud needs an App Check debug token (Settings)")) }),
    isTokenAutoRefreshEnabled: false,
  });
  ai = getAI(app, { backend: new GoogleAIBackend() });
  return ai;
}

/** Hybrid model for one InferenceMode key ("PREFER_ON_DEVICE", ...). Cached per mode. */
export async function modelFor(modeKey) {
  if (models.has(modeKey)) return models.get(modeKey);
  const model = getGenerativeModel(await initAI(), {
    mode: InferenceMode[modeKey],
    // On device: Chrome Prompt API (Gemini Nano) with a JSON Schema response constraint.
    onDeviceParams: {
      createOptions: {
        temperature: 0.2,
        topK: 3,
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      },
      promptOptions: { responseConstraint: responseSchema.toJSON() },
    },
    // Cloud: Gemini Developer API through Firebase AI Logic, same schema.
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.2 },
    },
  });
  models.set(modeKey, model);
  return model;
}

/** Is Gemini Nano usable in this browser right now? ("available" | "downloadable" | "downloading" | "unavailable") */
export async function deviceStatus() {
  try {
    if (!("LanguageModel" in self)) return "unavailable";
    return await self.LanguageModel.availability({ expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] });
  } catch { return "unavailable"; }
}

/**
 * Run one prompt. Must be called from a click handler the first time (Nano download needs
 * a user gesture). Returns { text, source: "on_device" | "in_cloud", ms }.
 */
export async function runPrompt(modeKey, prompt, onProgress) {
  const model = await modelFor(modeKey);
  if (modeKey !== "ONLY_IN_CLOUD") model.initializeDeviceModel?.((p) => onProgress?.(p));
  const t0 = performance.now();
  const result = await model.generateContent(prompt);
  return {
    text: result.response.text(),
    source: String(result.response.inferenceSource || (modeKey === "ONLY_IN_CLOUD" ? "in_cloud" : "on_device")).toLowerCase(),
    ms: Math.round(performance.now() - t0),
  };
}
