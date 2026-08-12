export const DEFAULT_OPENROUTER_TRANSLATION_MODEL = "google/gemma-4-26b-a4b-it:free";

const RETRYABLE_SMOKE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableOpenRouterSmokeStatus(status) {
  return RETRYABLE_SMOKE_STATUSES.has(status);
}

export function parseRetryAfterMilliseconds(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

export function openRouterSmokeRetryDelay({
  attempt,
  retryAfter,
  baseDelayMs,
  maxDelayMs,
  now = Date.now(),
}) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const requested = parseRetryAfterMilliseconds(retryAfter, now);
  if (requested !== null && requested > maxDelayMs) return null;
  return Math.max(exponential, requested ?? 0);
}

export async function runOpenRouterSmokeRequest(request, {
  maxAttempts,
  baseDelayMs,
  maxDelayMs,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onRetry = () => {},
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await request();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw new Error(`OpenRouter translation smoke could not reach the provider after ${attempt} attempts`, {
          cause: error,
        });
      }
      const delayMs = openRouterSmokeRetryDelay({
        attempt,
        retryAfter: null,
        baseDelayMs,
        maxDelayMs,
      });
      onRetry({ attempt, delayMs, reason: "network", status: null });
      await sleep(delayMs);
      continue;
    }

    if (response.ok) return { response, attempts: attempt };
    if (!isRetryableOpenRouterSmokeStatus(response.status) || attempt === maxAttempts) {
      throw new Error(`OpenRouter translation smoke failed with HTTP ${response.status} after ${attempt} attempts`);
    }
    const delayMs = openRouterSmokeRetryDelay({
      attempt,
      retryAfter: response.headers.get("Retry-After"),
      baseDelayMs,
      maxDelayMs,
    });
    if (delayMs === null) {
      throw new Error(`OpenRouter translation smoke Retry-After exceeds the ${maxDelayMs} ms retry budget`);
    }
    try {
      await response.body?.cancel();
    } catch {
      // The response is discarded before retrying; a failed cancellation must
      // not turn a retryable provider response into a different gate result.
    }
    onRetry({ attempt, delayMs, reason: "http", status: response.status });
    await sleep(delayMs);
  }
  throw new Error("OpenRouter translation smoke exhausted its retry budget", { cause: lastError });
}

export function buildOpenRouterSmokeBody(model = DEFAULT_OPENROUTER_TRANSLATION_MODEL) {
  return {
    model,
    temperature: 0,
    max_tokens: 160,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "nalanda_translation_smoke",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            decisions: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", enum: ["semantic-match", "semantic-mismatch"] },
                  correct: { type: "boolean" },
                },
                required: ["id", "correct"],
              },
            },
          },
          required: ["decisions"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content: [
          "Judge whether each learner translation expresses at least one accepted meaning.",
          "Accept synonyms and natural paraphrases, but reject unrelated meanings.",
          "Return only the requested structured result.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify([
          {
            id: "semantic-match",
            englishTerm: "apple",
            acceptedTranslations: ["苹果", "一种水果"],
            learnerTranslation: "一种常见的红色或绿色水果",
          },
          {
            id: "semantic-mismatch",
            englishTerm: "apple",
            acceptedTranslations: ["苹果", "一种水果"],
            learnerTranslation: "用于驾驶的车辆",
          },
        ]),
      },
    ],
  };
}

export function parseOpenRouterSmokePayload(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenRouter response has no message content");
  let parsed;
  try {
    parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error("OpenRouter response is not valid JSON");
  }
  const decisions = Array.isArray(parsed?.decisions) ? parsed.decisions : [];
  const byId = new Map(decisions.map((entry) => [entry?.id, entry?.correct]));
  if (byId.get("semantic-match") !== true || byId.get("semantic-mismatch") !== false) {
    throw new Error("OpenRouter semantic decisions did not match the release fixture");
  }
  return {
    promptTokens: Number.isSafeInteger(payload?.usage?.prompt_tokens)
      ? payload.usage.prompt_tokens : null,
    completionTokens: Number.isSafeInteger(payload?.usage?.completion_tokens)
      ? payload.usage.completion_tokens : null,
    totalTokens: Number.isSafeInteger(payload?.usage?.total_tokens)
      ? payload.usage.total_tokens : null,
  };
}
