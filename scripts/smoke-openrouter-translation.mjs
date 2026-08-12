import assert from "node:assert/strict";
import {
  buildOpenRouterSmokeBody,
  DEFAULT_OPENROUTER_TRANSLATION_MODEL,
  parseOpenRouterSmokePayload,
  runOpenRouterSmokeRequest,
} from "./openrouter-translation-smoke-lib.mjs";

const key = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_TRANSLATION_MODEL;
const baseUrl = String(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
// Keep the release gate independent from the interactive API's 12-second SLA.
// Free provider routes can legitimately take longer, while the bounded gate
// still fails closed if all attempts exceed its separate total budget.
const attemptTimeoutMs = Math.min(60_000, Math.max(5_000,
  Number(process.env.OPENROUTER_SMOKE_ATTEMPT_TIMEOUT_MS || 30_000)));
const totalBudgetMs = Math.min(300_000, Math.max(attemptTimeoutMs,
  Number(process.env.OPENROUTER_SMOKE_TOTAL_BUDGET_MS || 180_000)));
const maxAttempts = Math.min(6, Math.max(1, Number(process.env.OPENROUTER_SMOKE_MAX_ATTEMPTS || 5)));
const retryBaseMs = Math.min(30_000, Math.max(1_000,
  Number(process.env.OPENROUTER_SMOKE_RETRY_BASE_MS || 5_000)));
const retryMaxMs = Math.min(120_000, Math.max(retryBaseMs,
  Number(process.env.OPENROUTER_SMOKE_RETRY_MAX_MS || 60_000)));
const origin = process.env.PUBLIC_ORIGIN || "https://nalanda.online";

assert.ok(key, "OPENROUTER_API_KEY is required");
assert.equal(model, DEFAULT_OPENROUTER_TRANSLATION_MODEL,
  "production OpenRouter translation model must use the reviewed free Gemma route");
assert.notEqual(process.env.OPENROUTER_FAKE, "true", "production smoke refuses OPENROUTER_FAKE=true");
assert.equal(baseUrl, "https://openrouter.ai/api/v1", "production OpenRouter base URL is not reviewed");
assert.ok(Number.isFinite(attemptTimeoutMs));
assert.ok(Number.isFinite(totalBudgetMs));
assert.ok(Number.isInteger(maxAttempts));
assert.ok(Number.isFinite(retryBaseMs));
assert.ok(Number.isFinite(retryMaxMs));

const startedAt = Date.now();
const { body, attempts } = await runOpenRouterSmokeRequest(({ remainingMs }) => (
  fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(Math.max(1, Math.min(attemptTimeoutMs, remainingMs))),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": origin,
      "X-OpenRouter-Title": "Nalanda release smoke",
    },
    body: JSON.stringify(buildOpenRouterSmokeBody(model)),
  })
), {
  maxAttempts,
  baseDelayMs: retryBaseMs,
  maxDelayMs: retryMaxMs,
  maxElapsedMs: totalBudgetMs,
  readBody: (response) => response.text(),
  onRetry: ({ attempt, delayMs, reason, status }) => {
    const detail = reason === "http" ? `HTTP ${status}`
      : reason === "timeout" ? "transport timeout" : "network error";
    console.warn(`OpenRouter translation smoke ${detail}; retry ${attempt + 1}/${maxAttempts} in ${delayMs} ms`);
  },
});
let payload;
try {
  payload = JSON.parse(body);
} catch {
  throw new Error("OpenRouter translation smoke returned malformed JSON");
}
const usage = parseOpenRouterSmokePayload(payload);
console.log(JSON.stringify({
  ok: true,
  provider: "openrouter",
  model,
  attempts,
  durationMs: Date.now() - startedAt,
  ...usage,
}));
