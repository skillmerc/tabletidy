// Shared test helpers (not a test file). Built during #BuildHybridAI 2026.
// fakeSdk() behaves like the Firebase AI Logic web SDK's hybrid routing (callCloudOrDevice in
// @firebase/ai): when the browser has no LanguageModel object the SDK builds no on-device
// adapter and sends EVERY mode to the cloud, ONLY_ON_DEVICE included.
import fs from "node:fs";
import { parseHTML } from "linkedom";

export const html = fs.readFileSync(new URL("../../site/index.html", import.meta.url), "utf8");
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
/** A sample table read from the hosted page the way web/src/playground.js reads it. */
export function sample(id, label) {
  const { document } = parseHTML(html);
  const t = document.getElementById(id);
  const headers = [...t.querySelector("thead tr").children].map(text);
  const rows = [...t.querySelectorAll("tbody tr")].map((r) => [...r.children].map(text));
  return { label, headers, rows };
}
export const ORDERS = () => sample("orders", "Customer orders");
export const SHIPMENTS = () => sample("shipmentlog", "Shipment log");

export const goodAnswer = (n) => JSON.stringify({ title: "Tidy", columns: Array.from({ length: n }, (_, i) => ({ index: i, name: `Col ${i}`, type: "text", personalData: false })) });
export const STUB_ECHO = "CPU backendFastest inferenceTopK: 64, Temp: 1User: You clean up tables... End.Model: ";
export const CLOUD_URL = "https://firebasevertexai.googleapis.com/v1beta/projects/tabletidy-82369/models/gemini-3.5-flash-lite:generateContent";
/** The error the SDK throws for a failed cloud call (AIError FETCH_ERROR), address in the message as in real life. */
export function sdkError(status, message = "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.") {
  return Object.assign(new Error(`AI: Error fetching from ${CLOUD_URL}: [${status} ] ${message} (AI/fetch-error)`), { code: "fetch-error", customErrorData: { status, statusText: "" } });
}
export const networkError = () => Object.assign(new Error(`AI: Error fetching from ${CLOUD_URL}: fetch failed (AI/error)`), { code: "error" });

/** The six on-device states of the brief. api: "none" | "legacy" (only the old ai.languageModel) | "unavailable" | "downloadable" | "downloading" | "available". */
export const STATES = [
  { name: "no API object", api: "none" },
  { name: "only the older ai.languageModel object", api: "legacy" },
  { name: "API present, unavailable", api: "unavailable" },
  { name: "downloadable", api: "downloadable" },
  { name: "downloading", api: "downloading" },
  { name: "available, on-device call throws", api: "available", device: "throw" },
  { name: "available, on-device answer is garbage", api: "available", device: "garbage" },
];

/**
 * cloud: script for successive cloud calls; each step is "ok", an HTTP status number, "network",
 * or a function (prompt) => text | Promise<text>. The last step repeats.
 */
export function fakeSdk({ api = "none", device = "good", cloud = ["ok"], cols = 6 } = {}) {
  const cloudCalls = [], deviceCalls = [];
  let n = 0, inFlight = 0, maxInFlight = 0;
  const hasApi = !["none", "legacy"].includes(api);
  const inCloud = async (prompt) => {
    const step = cloud[Math.min(n, cloud.length - 1)]; n++;
    cloudCalls.push(prompt);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (typeof step === "function") return await step(prompt);
      if (step === "ok") return goodAnswer(cols);
      if (step === "network") throw networkError();
      throw sdkError(step, step >= 500 ? undefined : step === 429 ? "Quota exceeded for this project." : step === 400 ? "Invalid request." : "Firebase App Check token is invalid.");
    } finally { inFlight--; }
  };
  const onDevice = async (prompt) => {
    deviceCalls.push(prompt);
    if (api !== "available") throw new Error("NotAllowedError: the model is not downloaded");
    if (device === "throw") throw new Error("session failed");
    return device === "garbage" ? STUB_ECHO : goodAnswer(cols);
  };
  const wrap = (text, src) => ({ response: { text: () => text, inferenceSource: src } });
  const getModel = async (mode) => ({
    chromeAdapter: hasApi ? { mode } : undefined,
    async generateContent(prompt) {
      if (!hasApi || mode === "ONLY_IN_CLOUD") return wrap(await inCloud(prompt), "in_cloud");
      if (mode === "ONLY_ON_DEVICE") {
        if (api === "unavailable") throw Object.assign(new Error("AI: Local LanguageModel API not available in this environment. (AI/api-not-enabled)"), { code: "api-not-enabled" });
        return wrap(await onDevice(prompt), "on_device");
      }
      if (mode === "PREFER_ON_DEVICE") return api === "available" ? wrap(await onDevice(prompt), "on_device") : wrap(await inCloud(prompt), "in_cloud");
      try { return wrap(await inCloud(prompt), "in_cloud"); } catch (e) { if (api === "available") return wrap(await onDevice(prompt), "on_device"); throw e; }
    },
  });
  return { cloudCalls, deviceCalls, getModel, hasDeviceApi: () => hasApi, deviceStatus: async () => (hasApi ? api : "unavailable"), get maxInFlight() { return maxInFlight; } };
}

/** runPrompt exactly as ai.js had it before 17 Nov 2026: straight to the SDK, no guard. Tests the routing layer alone. */
export const unguarded = (sdk) => async (modeKey, prompt) => {
  const model = await sdk.getModel(modeKey);
  const result = await model.generateContent(prompt);
  return { text: result.response.text(), source: String(result.response.inferenceSource || (modeKey === "ONLY_IN_CLOUD" ? "in_cloud" : "on_device")).toLowerCase(), ms: 5 };
};

/** Raw values of every column the device rules flag: none of these may appear in a cloud request. */
export function flaggedValues(table, local) {
  return local.filter((c) => c.pii).flatMap((c) => table.rows.map((r) => String(r[c.index] ?? "").trim()).filter((v) => v.length > 2));
}
export const noLeakText = (s) => !/https?:|googleapis|Error fetching|AI\/|\bat [\w.]+ \(/.test(String(s));
