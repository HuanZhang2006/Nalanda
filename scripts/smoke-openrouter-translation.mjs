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
const timeoutMs = Math.min(30_000, Math.max(1_000, Number(process.env.OPENROUTER_TIMEOUT_MS || 12_000)));
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
assert.ok(Number.isFinite(timeoutMs));
assert.ok(Number.isInteger(maxAttempts));
assert.ok(Number.isFinite(retryBaseMs));
assert.ok(Number.isFinite(retryMaxMs));

const startedAt = Date.now();
const { response, attempts } = await runOpenRouterSmokeRequest(() => (
  fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
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
  onRetry: ({ attempt, delayMs, reason, status }) => {
    const detail = reason === "http" ? `HTTP ${status}` : "network error";
    console.warn(`OpenRouter translation smoke ${detail}; retry ${attempt + 1}/${maxAttempts} in ${delayMs} ms`);
  },
});
const usage = parseOpenRouterSmokePayload(await response.json());
console.log(JSON.stringify({
  ok: true,
  provider: "openrouter",
  model,
  attempts,
  durationMs: Date.now() - startedAt,
  ...usage,
}));
