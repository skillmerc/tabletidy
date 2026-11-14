// Robust hybrid run: validate every model answer, fall back from Gemini Nano to the cloud
// when the on-device answer is unusable, and say why. Built during #BuildHybridAI 2026.
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

const short = (e) => String(e?.message || e || "unknown error").replace(/\s+/g, " ").slice(0, 160);

/**
 * Run one prompt with validation and fallback.
 * plan: result of route() ({ mode, mask, reason }). deps.runPrompt(mode, text, onProgress)
 * resolves to { text, source: "on_device" | "in_cloud", ms }.
 *
 * Rules:
 * - Every answer is validated, wherever it ran.
 * - PREFER_ON_DEVICE: if the on-device answer is empty, not JSON or fails validation (or the
 *   on-device call throws), the same already-masked prompt is sent once with ONLY_IN_CLOUD.
 * - ONLY_ON_DEVICE (strict privacy) never falls back to the cloud.
 * - If nothing valid comes back the caller keeps the device rules result (source "local").
 * Returns { answer, source, ms, reason, attempts, error }.
 */
export async function runHybrid(plan, promptText, { runPrompt, colCount, status, onProgress } = {}) {
  const attempts = [];
  const attempt = async (mode) => {
    try {
      const out = await runPrompt(mode, promptText, onProgress);
      const v = validateAnswer(out.text, colCount);
      const a = { mode, source: out.source, ms: out.ms, ok: v.ok, error: v.ok ? null : v.error, threw: false, value: v.value };
      attempts.push(a);
      return a;
    } catch (e) {
      const a = { mode, source: mode === "ONLY_IN_CLOUD" ? "in_cloud" : mode === "ONLY_ON_DEVICE" ? "on_device" : "unknown", ms: 0, ok: false, error: short(e), threw: true };
      attempts.push(a);
      return a;
    }
  };
  const done = (a, reason) => ({ answer: a.value, source: a.source, ms: a.ms, reason, attempts: attempts.map(({ value, ...rest }) => rest), error: null });
  const local = (reason, error) => ({ answer: null, source: "local", ms: 0, reason, attempts: attempts.map(({ value, ...rest }) => rest), error });

  const first = await attempt(plan.mode);
  if (first.ok) {
    if (plan.mode === "PREFER_ON_DEVICE" && first.source === "in_cloud") return done(first, `Gemini Nano is not ready in this browser${status ? ` (${status})` : ""}, cloud fallback`);
    if (plan.mode === "PREFER_IN_CLOUD" && first.source === "on_device") return done(first, `${plan.reason}, cloud not reachable, ran on device`);
    return done(first, plan.reason);
  }
  // The device answered badly (or its call failed): one cloud retry, only for plans whose prompt is already masked.
  if (plan.mode === "PREFER_ON_DEVICE" && plan.mask && first.source !== "in_cloud") {
    const why = first.threw ? `On-device run failed (${first.error})` : `On-device answer failed validation (${first.error})`;
    const second = await attempt("ONLY_IN_CLOUD");
    if (second.ok) return done(second, `${why}, cloud fallback`);
    return local(`${why} and the cloud ${second.threw ? "request failed" : "answer failed validation"}, kept device rules`, second.error);
  }
  if (plan.mode === "ONLY_ON_DEVICE") {
    const why = first.threw ? "On-device run failed" : `On-device answer failed validation (${first.error})`;
    return local(`${why}. Strict privacy: nothing was sent to the cloud, kept device rules`, first.error);
  }
  return local(first.threw ? "Model request failed, kept device rules" : `Model answer failed validation (${first.error}), kept device rules`, first.error);
}

/**
 * The whole tidy step for one table: local rules -> route -> mask -> hybrid run -> merge.
 * table: { label, headers, rows }. pref: "auto" | "device" | "cloud".
 * deps: { runPrompt, deviceStatus?, onProgress?, onStart? }.
 */
export async function tidyTable(table, pref, deps) {
  const plan = route(table.rows.length, table.headers.length, pref);
  const local = localAnalysis(table.headers, table.rows);
  const prompt = buildPrompt(table.headers, table.rows, local, plan);
  const masked = plan.mask ? local.filter((c) => c.pii).map((c) => c.original || `col${c.index}`) : [];
  deps.onStart?.({ plan, masked });
  const status = deps.deviceStatus ? await deps.deviceStatus() : undefined;
  const res = await runHybrid(plan, prompt.text, { runPrompt: deps.runPrompt, colCount: table.headers.length, status, onProgress: deps.onProgress });
  return {
    columns: res.answer ? mergeColumns(local, res.answer, table.rows) : local,
    title: res.answer ? String(res.answer.title || table.label).slice(0, 60) : table.label,
    run: { source: res.source, ms: res.ms, reason: res.reason, attempts: res.attempts, error: res.error, sent: prompt.text, mask: plan.mask, masked, reachedCloud: res.attempts.some((a) => a.source === "in_cloud") },
  };
}
