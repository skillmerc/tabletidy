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
    $("status").textContent = "Error: " + e.message;
    console.error(e);
  }
});
