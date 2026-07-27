import assert from "node:assert/strict";
import {
  buildOpenRouterSmokeBody,
  DEFAULT_OPENROUTER_TRANSLATION_MODEL,
  parseOpenRouterSmokePayload,
} from "./openrouter-translation-smoke-lib.mjs";

const key = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_TRANSLATION_MODEL;
const baseUrl = String(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
const timeoutMs = Math.min(30_000, Math.max(1_000, Number(process.env.OPENROUTER_TIMEOUT_MS || 12_000)));
const origin = process.env.PUBLIC_ORIGIN || "https://nalanda.online";

assert.ok(key, "OPENROUTER_API_KEY is required");
assert.equal(model, DEFAULT_OPENROUTER_TRANSLATION_MODEL,
  "production OpenRouter translation model must use the reviewed free Gemma route");
assert.notEqual(process.env.OPENROUTER_FAKE, "true", "production smoke refuses OPENROUTER_FAKE=true");
assert.equal(baseUrl, "https://openrouter.ai/api/v1", "production OpenRouter base URL is not reviewed");
assert.ok(Number.isFinite(timeoutMs));

const startedAt = Date.now();
let response;
try {
  response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": origin,
      "X-OpenRouter-Title": "Nalanda release smoke",
    },
    body: JSON.stringify(buildOpenRouterSmokeBody(model)),
  });
} catch (error) {
  throw new Error("OpenRouter translation smoke could not reach the provider", { cause: error });
}
if (!response.ok) {
  throw new Error(`OpenRouter translation smoke failed with HTTP ${response.status}`);
}
const usage = parseOpenRouterSmokePayload(await response.json());
console.log(JSON.stringify({
  ok: true,
  provider: "openrouter",
  model,
  durationMs: Date.now() - startedAt,
  ...usage,
}));
