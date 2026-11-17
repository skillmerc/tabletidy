// Hybrid run: validate every model answer, fall back from Gemini Nano to the cloud when the
// on-device answer is unusable, retry a busy cloud model, keep On device only strict, and say why. Built during #BuildHybridAI 2026.
// Pure functions: the Firebase AI Logic call is injected (see runPrompt in ../ai.js), so the
// fallback rules are unit tested in tests/hybrid.test.mjs without a browser.
import { TYPES } from "./infer.js";
import { route, localAnalysis, buildPrompt, mergeColumns } from "./tidy.js";

/**
 * Check a model answer against the response schema (RESPONSE_JSON_SCHEMA in tidy.js) and
 * against the table: { title: string, columns: [{ index, name, type, personalData }] } with
 * every column index of the table present exactly once.
 * Returns { ok: true, value } or { ok: false, error } where error is a short reason.
 */
export function validateAnswer(text, colCount) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: false, error: "empty answer" };
  const m = raw.match(/\{[\s\S]*\}/); // tolerates ```json fences around the object
  if (!m) return { ok: false, error: "not JSON" };
  let o;
  try { o = JSON.parse(m[0]); } catch { return { ok: false, error: "not JSON" }; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, error: "not a JSON object" };
  if (typeof o.title !== "string") return { ok: false, error: "no title" };
  if (!Array.isArray(o.columns) || !o.columns.length) return { ok: false, error: "no columns" };
  const seen = new Set();
  for (const c of o.columns) {
    if (!c || typeof c !== "object") return { ok: false, error: "column is not an object" };
    if (!Number.isInteger(c.index) || c.index < 0 || c.index >= colCount) return { ok: false, error: `column index ${JSON.stringify(c.index)} out of range` };
    if (seen.has(c.index)) return { ok: false, error: `column ${c.index} listed twice` };
    seen.add(c.index);
    if (typeof c.name !== "string" || !c.name.trim()) return { ok: false, error: `column ${c.index} has no name` };
    if (!TYPES.includes(c.type)) return { ok: false, error: `column ${c.index} has unknown type` };
    if (typeof c.personalData !== "boolean") return { ok: false, error: `column ${c.index} has no personalData flag` };
  }
  if (seen.size !== colCount) return { ok: false, error: `${colCount - seen.size} of ${colCount} columns missing` };
  return { ok: true, value: o };
}

/** Cloud tries per run, and the waits between them. */
export const MAX_CLOUD_TRIES = 3;
export const RETRY_WAITS_MS = [1000, 3000];

/** Every sentence a person can see when a run did not use a model answer. No addresses, no error text. */
export const MESSAGES = {
  busyWait: (n, of) => `The cloud model is busy. Trying again (${n} of ${of}).`,
  busyFinal: "The cloud model was busy on all three tries, so the columns below come from the rules on this device only.",
  refusedCheck: "The cloud model turned this request down at its security check, so the columns below come from the rules on this device only.",
  refusedQuota: "This page has used up its cloud model allowance for now, so the columns below come from the rules on this device only.",
  refusedBad: "The cloud model could not accept this request, so the columns below come from the rules on this device only.",
  network: "This browser could not reach the cloud model, so the columns below come from the rules on this device only.",
  cloudOther: "The cloud model did not answer, so the columns below come from the rules on this device only.",
  badAnswer: "The model gave an answer that failed the checks, so the columns below come from the rules on this device only.",
  strictNoModel: "This browser has no built-in model, so On device only did not run and nothing was sent.",
  strictNotReady: "The built-in model is not ready in this browser yet, so On device only did not run and nothing was sent.",
  strictChoices: "Switch to Auto, or open this page in a browser that has Chrome's built-in model (Gemini Nano) ready.",
  strictChoicesNotReady: "Switch to Auto, or try again when the status line above shows Gemini Nano: ready.",
  strictFailed: "The built-in model did not give a usable answer, so the columns below come from the rules on this device only. Nothing was sent to the cloud.",
  strictSwitched: "You switched to On device only during the run, so no cloud answer was used and nothing more was sent.",
};

/** Thrown by the model caller (ai.js) instead of calling when On device only cannot run on this device. */
export function deviceUnavailable(state) {
  const e = new Error("On-device model not usable: " + state);
  e.code = "DEVICE_UNAVAILABLE";
  e.deviceState = state;
  return e;
}

/**
 * Sort a thrown model error into a kind, without passing its text on (the SDK puts the
 * request address into the message). kind: "busy" (5xx or a "high demand" answer, retried),
 * "refused" (4xx: bad request, App Check refusal, quota; not retried), "network", "no-device", "other".
 */
export function classifyError(e) {
  const msg = String(e?.message || e || "");
  if (e?.code === "DEVICE_UNAVAILABLE") return { kind: "no-device", status: 0, cloud: false, label: "no usable on-device model" };
  const status = Number(e?.customErrorData?.status ?? e?.status ?? (msg.match(/\[(\d{3})\b/) || [])[1]) || 0;
  const fromCloud = status > 0 || /Error fetching from/i.test(msg) || e?.code === "fetch-error";
  if (status >= 500 || /high demand|overloaded/i.test(msg)) return { kind: "busy", status, cloud: true, label: "cloud model busy" };
  if (status >= 400) return { kind: "refused", status, cloud: true, label: status === 429 ? "cloud model allowance used up" : status === 401 || status === 403 ? "cloud model security check refused it" : "cloud model did not accept the request" };
  if (fromCloud || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return { kind: "network", status: 0, cloud: true, label: "cloud model not reachable" };
  return { kind: "other", status: 0, cloud: false, label: "model call failed" };
}

const refusedMessage = (status) => (status === 401 || status === 403 ? MESSAGES.refusedCheck : status === 429 ? MESSAGES.refusedQuota : MESSAGES.refusedBad);
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build the function that makes one model call. ai.js passes the Firebase AI Logic model
 * getter; tests pass fakes. The on-device-only guard lives here, right before the SDK call:
 * the SDK builds no on-device adapter when the browser has no LanguageModel object, and then
 * sends EVERY mode, ONLY_ON_DEVICE included, to the cloud. So for ONLY_ON_DEVICE nothing is
 * called unless the object exists, it reports "available" and the model has its adapter.
 * Returns runPrompt(modeKey, prompt) -> { text, source: "on_device" | "in_cloud" | "unknown", ms }.
 */
export function makeRunPrompt({ getModel, hasDeviceApi, deviceStatus, now = () => Date.now() }) {
  return async function runPrompt(modeKey, prompt) {
    const strict = modeKey === "ONLY_ON_DEVICE";
    if (strict) {
      if (!hasDeviceApi()) throw deviceUnavailable("no-api");
      const s = await deviceStatus();
      if (s !== "available") throw deviceUnavailable(String(s));
      if (!hasDeviceApi()) throw deviceUnavailable("no-api");
    }
    const model = await getModel(modeKey);
    if (strict && !model?.chromeAdapter) throw deviceUnavailable("no-adapter");
    const t0 = now();
    const result = await model.generateContent(prompt);
    let text = "";
    try { text = result.response.text(); } catch { text = ""; }
    const told = String(result.response.inferenceSource || "").toLowerCase();
    return { text, source: told || (modeKey === "ONLY_IN_CLOUD" ? "in_cloud" : strict ? "on_device" : "unknown"), ms: Math.round(now() - t0) };
  };
}

/**
 * Run one prompt with validation, fallback and cloud retry.
 * plan: result of route() ({ mode, mask, reason }). deps.runPrompt(mode, text, onProgress)
 * resolves to { text, source: "on_device" | "in_cloud", ms }.
 * deps.status: the on-device model state ("available" | "downloadable" | "downloading" |
 * "unavailable"; a browser with no model object reports "unavailable"). deps.isStrict():
 * true when the person has On device only selected RIGHT NOW (read before and after every call).
 * deps.onRetry({ attempt, of, waitMs, text }) fires before each wait. deps.sleep is injectable.
 *
 * Rules:
 * - Strict mode is decided first. With ONLY_ON_DEVICE, or isStrict() true, no call other than
 *   an ONLY_ON_DEVICE call is ever made, and that one only when status is "available". An
 *   answer that did not come from the device is thrown away. This holds for retries too.
 * - Every answer is validated, wherever it ran.
 * - PREFER_ON_DEVICE: if the on-device answer is empty, not JSON or fails validation (or the
 *   on-device call throws), the same already-masked prompt is sent with ONLY_IN_CLOUD.
 * - PREFER_IN_CLOUD: the SDK itself falls back to the device when the cloud call fails. If that
 *   device answer is unusable, the run goes back to the cloud (ONLY_IN_CLOUD) as one more try.
 * - A cloud call that fails with a 5xx or a "high demand" answer is tried again after 1 s and
 *   after 3 s: three tries in all. A call is only repeated after it has failed, so one run
 *   never has two cloud calls out at once. A 4xx is not retried.
 * - If nothing valid comes back the caller keeps the device rules result (source "local").
 * Returns { answer, source, ms, reason, attempts, error, notice, choices, action, retried }.
 * notice is a plain sentence for the page; action is "retry" (Try again), "auto" (Switch to Auto) or null.
 */
export async function runHybrid(plan, promptText, { runPrompt, colCount, status, onProgress, onRetry, isStrict, sleep = defaultSleep } = {}) {
  const attempts = [];
  const strictPlan = plan.mode === "ONLY_ON_DEVICE";
  const strictNow = () => strictPlan || isStrict?.() === true;
  const push = (a) => { attempts.push(a); return a; };
  const listed = () => attempts.map(({ value, ...rest }) => rest);
  let busy = 0;
  const done = (a, reason) => ({ answer: a.value, source: a.source, ms: a.ms, reason: busy ? `${reason} (the cloud model was busy, answered on try ${busy + 1} of ${MAX_CLOUD_TRIES})` : reason, attempts: listed(), error: null, notice: null, choices: null, action: null, retried: busy });
  const local = (reason, error, notice, action = null, choices = null) => ({ answer: null, source: "local", ms: 0, reason, attempts: listed(), error: error || null, notice: notice || null, choices, action, retried: busy });
  const switched = () => local("Switched to On device only during the run, kept device rules", "On device only is set", MESSAGES.strictSwitched);

  // The single place a model is called from. Nothing else in this file calls runPrompt.
  const call = async (mode) => {
    if (strictNow() && mode !== "ONLY_ON_DEVICE") return push({ mode, source: "none", ms: 0, ok: false, error: "not sent, On device only is set", threw: false, called: false, blocked: true });
    let out;
    try {
      out = await runPrompt(mode, promptText, onProgress);
    } catch (e) {
      const c = classifyError(e);
      const source = c.kind === "no-device" ? "none" : c.cloud || mode === "ONLY_IN_CLOUD" ? "in_cloud" : mode === "ONLY_ON_DEVICE" ? "on_device" : "unknown";
      return push({ mode, source, ms: 0, ok: false, error: c.kind === "other" && source === "on_device" ? "on-device model failed" : c.label, threw: true, called: c.kind !== "no-device", kind: c.kind, status: c.status });
    }
    // On device only is set (now, or since the call went out): only a device answer may be used.
    if (strictNow() && out.source !== "on_device") return push({ mode, source: out.source, ms: out.ms, ok: false, error: "answer thrown away, On device only is set", threw: false, called: true, discarded: true });
    const v = validateAnswer(out.text, colCount);
    return push({ mode, source: out.source, ms: out.ms, ok: v.ok, error: v.ok ? null : v.error, threw: false, called: true, value: v.value });
  };

  // ---- Strict mode first: no later branch is reached while it is set ------------------------
  if (strictPlan) {
    if (status !== "available") {
      const notReady = status === "downloadable" || status === "downloading";
      return local(`${notReady ? "Gemini Nano is not ready in this browser" : "No built-in model in this browser"}. Strict privacy: nothing was sent, kept device rules`, "no usable on-device model", notReady ? MESSAGES.strictNotReady : MESSAGES.strictNoModel, "auto", notReady ? MESSAGES.strictChoicesNotReady : MESSAGES.strictChoices);
    }
    const a = await call("ONLY_ON_DEVICE");
    if (a.ok) return done(a, plan.reason);
    if (a.kind === "no-device") return local("No usable built-in model in this browser. Strict privacy: nothing was sent, kept device rules", a.error, MESSAGES.strictNoModel, "auto", MESSAGES.strictChoices);
    const why = a.threw ? "On-device run failed" : a.discarded ? "The answer did not come from this device and was thrown away" : `On-device answer failed validation (${a.error})`;
    return local(`${why}. Strict privacy: nothing was sent to the cloud, kept device rules`, a.error, MESSAGES.strictFailed, "auto");
  }
  if (strictNow()) { push({ mode: plan.mode, source: "none", ms: 0, ok: false, error: "not sent, On device only is set", threw: false, called: false, blocked: true }); return switched(); }

  // ---- Auto and Cloud: every prompt here is already masked (route() sets mask for these plans) ----
  let mode = plan.mode, fellBack = null, a;
  for (;;) {
    a = await call(mode);
    if (a.ok || a.blocked || a.discarded) break;
    // PREFER_IN_CLOUD: the SDK tries the cloud first and, when that fails, the device. A failed
    // answer that is not from the cloud therefore means one cloud try has already failed.
    const deviceAfterCloud = mode === "PREFER_IN_CLOUD" && a.source !== "in_cloud";
    if ((a.threw && a.kind === "busy") || deviceAfterCloud) {
      if (busy >= MAX_CLOUD_TRIES - 1) break;
      if (deviceAfterCloud) mode = "ONLY_IN_CLOUD";
      const waitMs = RETRY_WAITS_MS[busy] ?? RETRY_WAITS_MS[RETRY_WAITS_MS.length - 1];
      busy++;
      onRetry?.({ attempt: busy + 1, of: MAX_CLOUD_TRIES, waitMs, text: MESSAGES.busyWait(busy + 1, MAX_CLOUD_TRIES) });
      await sleep(waitMs);
      continue; // call() checks strict mode again before anything is sent
    }
    // The device answered badly (or its call failed): go to the cloud once with the same masked prompt.
    if (!fellBack && plan.mode === "PREFER_ON_DEVICE" && plan.mask && a.source !== "in_cloud" && (!a.threw || a.kind === "other" || a.kind === "no-device")) {
      fellBack = a.threw ? "On-device run failed" : `On-device answer failed validation (${a.error})`;
      mode = "ONLY_IN_CLOUD";
      continue;
    }
    break;
  }
  if (a.blocked || a.discarded) return switched();
  if (a.ok) {
    if (fellBack) return done(a, `${fellBack}, cloud fallback`);
    if (plan.mode === "PREFER_ON_DEVICE" && a.source === "in_cloud") return done(a, `Gemini Nano is not ready in this browser${status ? ` (${status})` : ""}, cloud fallback`);
    if (plan.mode === "PREFER_IN_CLOUD" && a.source === "on_device") return done(a, `${plan.reason}, cloud not reachable, ran on device`);
    return done(a, plan.reason);
  }
  const lead = fellBack ? `${fellBack} and the cloud ` : "The cloud ";
  if (a.threw && a.kind === "busy") return local(`${lead}model was busy on all ${MAX_CLOUD_TRIES} tries, kept device rules`, a.error, MESSAGES.busyFinal, "retry");
  if (a.threw && a.kind === "refused") return local(`${lead}model refused the request, kept device rules`, a.error, refusedMessage(a.status));
  if (a.threw && a.kind === "network") return local(`${lead}model could not be reached, kept device rules`, a.error, MESSAGES.network, "retry");
  if (a.threw) return local(fellBack ? `${fellBack} and the cloud request failed, kept device rules` : "Model request failed, kept device rules", a.error, MESSAGES.cloudOther, "retry");
  return local(fellBack ? `${fellBack} and the cloud answer failed validation, kept device rules` : `Model answer failed validation (${a.error}), kept device rules`, a.error, MESSAGES.badAnswer, "retry");
}

/**
 * The whole tidy step for one table: local rules -> route -> mask -> hybrid run -> merge.
 * table: { label, headers, rows }. pref: "auto" | "device" | "cloud".
 * deps: { runPrompt, deviceStatus, onProgress?, onStart?, onRetry?, isStrict?, sleep? }.
 */
export async function tidyTable(table, pref, deps) {
  // Strict mode is decided first, from the setting passed in and from the live setting.
  const strict = pref === "device" || deps.isStrict?.() === true;
  const plan = route(table.rows.length, table.headers.length, strict ? "device" : pref);
  const local = localAnalysis(table.headers, table.rows);
  const prompt = buildPrompt(table.headers, table.rows, local, plan);
  const masked = plan.mask ? local.filter((c) => c.pii).map((c) => c.original || `col${c.index}`) : [];
  deps.onStart?.({ plan, masked });
  // No status function, or one that throws, counts as "no usable model": strict mode then sends nothing.
  let status;
  try { status = deps.deviceStatus ? await deps.deviceStatus() : undefined; } catch { status = "unavailable"; }
  const res = await runHybrid(plan, prompt.text, { runPrompt: deps.runPrompt, colCount: table.headers.length, status, onProgress: deps.onProgress, onRetry: deps.onRetry, isStrict: deps.isStrict, sleep: deps.sleep });
  const called = res.attempts.some((a) => a.called);
  return {
    columns: res.answer ? mergeColumns(local, res.answer, table.rows) : local,
    title: res.answer ? String(res.answer.title || table.label).slice(0, 60) : table.label,
    run: { source: res.source, ms: res.ms, reason: res.reason, attempts: res.attempts, error: res.error, notice: res.notice, choices: res.choices, action: res.action, retried: res.retried, sent: called ? prompt.text : "", mask: plan.mask, masked, strict: plan.mode === "ONLY_ON_DEVICE", reachedCloud: res.attempts.some((a) => a.called && (a.source !== "on_device" || a.mode === "PREFER_IN_CLOUD")) },
  };
}
