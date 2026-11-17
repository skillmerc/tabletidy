import { hybridModel, InferenceMode } from "./firebase.js";
import { Schema } from "firebase/ai";

const $ = (id) => document.getElementById(id);

// Structured output: one entry per column.
const columnsSchema = Schema.object({
  properties: {
    columns: Schema.array({
      items: Schema.object({
        properties: {
          index: Schema.integer(),
          name: Schema.string(),
          type: Schema.enumString({ enum: ["text", "number", "currency", "date", "percent", "url", "email", "phone", "category"] }),
          formatHint: Schema.string(),
          personalData: Schema.boolean(),
        },
      }),
    }),
  },
});

let model = null;
let modelMode = null;

function getModel(mode) {
  if (!model || modelMode !== mode) {
    model = hybridModel(mode, {
      // On-device (Chrome Prompt API): JSON Schema constraint on the prompt.
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        },
        promptOptions: { responseConstraint: columnsSchema.toJSON() },
      },
      // Cloud fallback (Gemini Developer API via Firebase AI Logic): same schema.
      inCloudParams: {
        model: "gemini-3.5-flash-lite",
        generationConfig: { responseMimeType: "application/json", responseSchema: columnsSchema },
      },
    });
    modelMode = mode;
  }
  return model;
}

$("run").addEventListener("click", async () => {
  const mode = InferenceMode[$("mode").value.toUpperCase()] ?? $("mode").value;
  // Strict privacy: without a ready LanguageModel object the SDK would send an "only on device"
  // request to the cloud, so nothing is called here unless the built-in model is there and ready.
  if ($("mode").value === "only_on_device") {
    let ready = false;
    try { ready = "LanguageModel" in self && (await self.LanguageModel.availability({ expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] })) === "available"; } catch { ready = false; }
    if (!ready) { $("source").innerHTML = ""; $("out").textContent = ""; $("status").textContent = "This browser has no built-in model that is ready, so Only on device did not run and nothing was sent."; return; }
  }
  const m = getModel(mode);
  $("status").textContent = "Preparing model...";
  $("source").innerHTML = "";
  // Must be called on a user gesture, before the first request.
  m.initializeDeviceModel?.((p) => { $("status").textContent = `Downloading on-device model: ${Math.round(p * 100)}%`; });
  const prompt =
    "You label spreadsheet columns. For each column of this CSV sample, return its 0-based index, a short header name, " +
    "a data type, a format hint (e.g. 'decimal comma, ZAR', 'YYYY/MM/DD') and whether it holds personal data.\n\n" +
    $("input").value;
  const t0 = performance.now();
  try {
    const result = await m.generateContent(prompt);
    const src = String(result.response.inferenceSource || "unknown").toUpperCase();
    $("source").innerHTML = `<span class="badge ${src}">${src === "ON_DEVICE" ? "On device" : src === "IN_CLOUD" ? "Cloud" : src}</span>`;
    $("status").textContent = `Done in ${Math.round(performance.now() - t0)} ms`;
    $("out").textContent = result.response.text();
    console.log("[tabletidy] inferenceSource:", src);
  } catch (e) {
    $("status").textContent = "The call failed. The details are in the browser console.";
    console.error(e);
  }
});
