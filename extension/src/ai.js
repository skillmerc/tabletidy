// Firebase AI Logic hybrid inference, shared by the hosted playground and the extension
// side panel. Built during #BuildHybridAI 2026.
// - One Firebase app + App Check (required by AI Logic): reCAPTCHA Enterprise on the hosted
//   site, a registered debug token in the extension (extensions cannot run reCAPTCHA).
// - getGenerativeModel(..., { mode }) with InferenceMode PREFER_ON_DEVICE / PREFER_IN_CLOUD /
//   ONLY_ON_DEVICE / ONLY_IN_CLOUD: Gemini Nano in Chrome when available, Gemini in the cloud otherwise.
// - The same structured-output schema is enforced on both runtimes; answers are validated
//   again in lib/hybrid.js, which also owns the fallback rules.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, CustomProvider, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from "firebase/ai";
import { TYPES } from "./lib/infer.js";
import { RESPONSE_JSON_SCHEMA } from "./lib/tidy.js";
import { makeRunPrompt } from "./lib/hybrid.js";

export const CLOUD_MODEL = "gemini-3.5-flash-lite";

// Same options for availability(), download and every on-device session.
const DEVICE_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

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

let settings = null;
let aiPromise = null;
const models = new Map();

/**
 * Set the Firebase web config and the App Check provider for this surface.
 * appCheck: { kind: "recaptcha-enterprise", siteKey } (hosted site)
 *        or { kind: "debug", getToken: async () => string } (extension, local development).
 */
export function configureAI(s) { settings = s; }

/** Start Firebase lazily: app, App Check, then the AI Logic backend (Gemini Developer API). */
export function initAI() {
  if (aiPromise) return aiPromise;
  aiPromise = (async () => {
    if (!settings) throw new Error("configureAI() was not called");
    const app = initializeApp(settings.firebaseConfig);
    if (settings.appCheck.kind === "recaptcha-enterprise") {
      initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(settings.appCheck.siteKey), isTokenAutoRefreshEnabled: true });
    } else {
      const token = await settings.appCheck.getToken?.();
      if (token) self.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
      initializeAppCheck(app, {
        provider: new CustomProvider({ getToken: () => Promise.reject(new Error("Cloud needs an App Check debug token (Settings)")) }),
        isTokenAutoRefreshEnabled: false,
      });
    }
    return getAI(app, { backend: new GoogleAIBackend() });
  })();
  return aiPromise;
}

/** Is the Chrome built-in model object (LanguageModel) on the global at all? The SDK uses no other. */
export function hasDeviceApi() {
  try { return typeof self !== "undefined" && "LanguageModel" in self && Boolean(self.LanguageModel); } catch { return false; }
}

/**
 * Hybrid model for one InferenceMode key ("PREFER_ON_DEVICE", ...). The SDK decides when the
 * model is created whether it gets an on-device adapter, so the cache is kept per mode AND
 * per "is the LanguageModel object there".
 */
export async function modelFor(modeKey) {
  const key = `${modeKey}:${hasDeviceApi() ? "api" : "no-api"}`;
  if (models.has(key)) return models.get(key);
  const model = getGenerativeModel(await initAI(), {
    mode: InferenceMode[modeKey],
    // On device: Chrome Prompt API (Gemini Nano) with a JSON Schema response constraint.
    onDeviceParams: {
      createOptions: DEVICE_OPTIONS,
      promptOptions: { responseConstraint: RESPONSE_JSON_SCHEMA },
    },
    // Cloud: Gemini Developer API through Firebase AI Logic, same schema.
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.2 },
    },
  });
  models.set(key, model);
  return model;
}

/** Gemini Nano in this browser right now: "available" | "downloadable" | "downloading" | "unavailable". */
export async function deviceStatus() {
  try {
    if (!hasDeviceApi()) return "unavailable";
    const s = await self.LanguageModel.availability(DEVICE_OPTIONS);
    return ["available", "downloadable", "downloading"].includes(s) ? s : "unavailable";
  } catch { return "unavailable"; }
}

/**
 * Download Gemini Nano. Must be called from a click (Chrome needs a user gesture).
 * onProgress gets 0..1. Resolves with the new deviceStatus() when the download ends.
 */
export async function downloadDeviceModel(onProgress) {
  const model = await modelFor("PREFER_ON_DEVICE");
  await model.initializeDeviceModel((p) => onProgress?.(p));
  return deviceStatus();
}

/**
 * Run one prompt through Firebase AI Logic. Returns { text, source: "on_device" | "in_cloud" | "unknown", ms }.
 * The answer is NOT trusted here: lib/hybrid.js validates it and decides about fallback.
 * For ONLY_ON_DEVICE the guard in makeRunPrompt (lib/hybrid.js) refuses to call the SDK unless
 * the LanguageModel object exists, reports "available" and the model has its on-device adapter:
 * without that object the SDK would send an ONLY_ON_DEVICE request to the cloud.
 */
export const runPrompt = makeRunPrompt({ getModel: modelFor, hasDeviceApi, deviceStatus, now: () => performance.now() });
