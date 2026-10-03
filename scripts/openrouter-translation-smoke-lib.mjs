export const DEFAULT_OPENROUTER_TRANSLATION_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export const OPENROUTER_TRANSLATION_PROVIDER = "Nvidia";

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

export function openRouterSmokeTransportReason(error) {
  const name = error && typeof error === "object" ? error.name : "";
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
}

export async function runOpenRouterSmokeRequest(request, {
  maxAttempts,
  baseDelayMs,
  maxDelayMs,
  maxElapsedMs = 180_000,
  readBody = null,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onRetry = () => {},
} = {}) {
  let lastError;
  const startedAt = now();

  const ensureRetryFitsBudget = (delayMs, error) => {
    const elapsedMs = Math.max(0, now() - startedAt);
    if (elapsedMs + delayMs >= maxElapsedMs) {
      throw new Error(`OpenRouter translation smoke exceeded its ${maxElapsedMs} ms total retry budget`, {
        cause: error,
      });
    }
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const elapsedMs = Math.max(0, now() - startedAt);
    if (elapsedMs >= maxElapsedMs) {
      throw new Error(`OpenRouter translation smoke exceeded its ${maxElapsedMs} ms total retry budget`, {
        cause: lastError,
      });
    }
    let response;
    try {
      response = await request({ attempt, remainingMs: maxElapsedMs - elapsedMs });
      if (response.ok) {
        // A fetch promise resolves after response headers arrive. Consume the
        // body under the same retry boundary so an AbortSignal firing while
        // streaming the body is treated as a transient transport timeout,
        // instead of escaping as an uncaught DOMException after a nominal 2xx.
        const body = readBody ? await readBody(response) : undefined;
        return { response, body, attempts: attempt };
      }
    } catch (error) {
      lastError = error;
      const reason = openRouterSmokeTransportReason(error);
      if (attempt === maxAttempts) {
        const detail = reason === "timeout" ? "timed out" : "could not reach the provider";
        throw new Error(`OpenRouter translation smoke ${detail} after ${attempt} attempts`, {
          cause: error,
        });
      }
      const delayMs = openRouterSmokeRetryDelay({
        attempt,
        retryAfter: null,
        baseDelayMs,
        maxDelayMs,
      });
      ensureRetryFitsBudget(delayMs, error);
      onRetry({ attempt, delayMs, reason, status: null });
      await sleep(delayMs);
      continue;
    }

    if (!isRetryableOpenRouterSmokeStatus(response.status) || attempt === maxAttempts) {
      let upstreamCode = null;
      try {
        const payload = JSON.parse(await response.text());
        const candidate = payload?.error?.code ?? payload?.code;
        if (typeof candidate === "string" || typeof candidate === "number") {
          upstreamCode = String(candidate).slice(0, 80);
        }
      } catch {
        // Release diagnostics must never echo a provider response body. A
        // missing structured code is represented by the HTTP status alone.
      }
      const requestId = response.headers.get("request-id")
        || response.headers.get("x-request-id");
      const detail = [
        upstreamCode ? `code=${upstreamCode}` : null,
        requestId ? `requestId=${requestId}` : null,
      ].filter(Boolean).join(", ");
      throw new Error(
        `OpenRouter translation smoke failed with HTTP ${response.status} after ${attempt} attempts${detail ? ` (${detail})` : ""}`,
      );
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
    ensureRetryFitsBudget(delayMs);
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
    max_tokens: 768,
    reasoning: { enabled: false },
    tool_choice: "none",
    provider: {
      only: [OPENROUTER_TRANSLATION_PROVIDER.toLowerCase()],
      allow_fallbacks: false,
      require_parameters: true,
    },
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content: [
          "Judge whether each learner translation expresses at least one accepted meaning.",
          "Accept synonyms and natural paraphrases, but reject unrelated meanings.",
          "Return exactly one JSON object with no markdown and no additional fields.",
          "The object must be {\"decisions\":[{\"id\":\"semantic-match\",\"correct\":boolean},{\"id\":\"semantic-mismatch\",\"correct\":boolean}]}.",
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
  if (
    typeof payload?.provider !== "string"
    || payload.provider.toLowerCase() !== OPENROUTER_TRANSLATION_PROVIDER.toLowerCase()
  ) {
    throw new Error("OpenRouter translation smoke did not use the required Nvidia provider");
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenRouter response has no message content");
  let parsed;
  try {
    parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error("OpenRouter response is not valid JSON");
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.keys(parsed).length !== 1
    || !("decisions" in parsed)
  ) {
    throw new Error("OpenRouter semantic decisions did not match the required local schema");
  }
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  if (
    decisions.length !== 2
    || decisions.some((entry) => (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || Object.keys(entry).sort().join(",") !== "correct,id"
      || !["semantic-match", "semantic-mismatch"].includes(entry.id)
      || typeof entry.correct !== "boolean"
    ))
    || new Set(decisions.map((entry) => entry.id)).size !== 2
  ) {
    throw new Error("OpenRouter semantic decisions did not match the required local schema");
  }
  const byId = new Map(decisions.map((entry) => [entry?.id, entry?.correct]));
  if (byId.get("semantic-match") !== true || byId.get("semantic-mismatch") !== false) {
    throw new Error("OpenRouter semantic decisions did not match the release fixture");
  }
  return {
    upstreamProvider: OPENROUTER_TRANSLATION_PROVIDER,
    promptTokens: Number.isSafeInteger(payload?.usage?.prompt_tokens)
      ? payload.usage.prompt_tokens : null,
    completionTokens: Number.isSafeInteger(payload?.usage?.completion_tokens)
      ? payload.usage.completion_tokens : null,
    totalTokens: Number.isSafeInteger(payload?.usage?.total_tokens)
      ? payload.usage.total_tokens : null,
  };
}
