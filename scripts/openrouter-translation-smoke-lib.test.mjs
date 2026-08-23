import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenRouterSmokeBody,
  isRetryableOpenRouterSmokeStatus,
  openRouterSmokeRetryDelay,
  openRouterSmokeTransportReason,
  parseOpenRouterSmokePayload,
  parseRetryAfterMilliseconds,
  runOpenRouterSmokeRequest,
} from "./openrouter-translation-smoke-lib.mjs";

test("OpenRouter smoke uses the pinned model and strict two-case schema", () => {
  const body = buildOpenRouterSmokeBody();
  assert.equal(body.model, "stealth/ox-alpha");
  assert.deepEqual(body.provider.only, ["stealth"]);
  assert.equal(body.provider.allow_fallbacks, false);
  assert.deepEqual(body.reasoning, { effort: "low", exclude: true });
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.properties.decisions.minItems, 2);
  assert.doesNotMatch(JSON.stringify(body), /api[_-]?key/i);
});

test("OpenRouter smoke accepts the expected structured semantic decisions", () => {
  assert.deepEqual(parseOpenRouterSmokePayload({
    provider: "Stealth",
    choices: [{ message: { content: JSON.stringify({ decisions: [
      { id: "semantic-match", correct: true },
      { id: "semantic-mismatch", correct: false },
    ] }) } }],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
  }), { upstreamProvider: "Stealth", promptTokens: 20, completionTokens: 8, totalTokens: 28 });
  assert.throws(() => parseOpenRouterSmokePayload({
    provider: "Stealth",
    choices: [{ message: { content: JSON.stringify({ decisions: [
      { id: "semantic-match", correct: false },
      { id: "semantic-mismatch", correct: false },
    ] }) } }],
  }), /did not match/);
  assert.throws(() => parseOpenRouterSmokePayload({
    provider: "Other",
    choices: [{ message: { content: "{}" } }],
  }), /required Stealth provider/);
});

test("OpenRouter smoke retries only transient provider responses", () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableOpenRouterSmokeStatus(status), true);
  }
  for (const status of [400, 401, 402, 403, 404, 422]) {
    assert.equal(isRetryableOpenRouterSmokeStatus(status), false);
  }
  assert.equal(parseRetryAfterMilliseconds("7"), 7_000);
  assert.equal(parseRetryAfterMilliseconds("invalid"), null);
  assert.equal(parseRetryAfterMilliseconds("Thu, 01 Jan 2026 00:00:08 GMT", Date.UTC(2026, 0, 1)), 8_000);
  assert.equal(openRouterSmokeRetryDelay({
    attempt: 2,
    retryAfter: "7",
    baseDelayMs: 1_000,
    maxDelayMs: 10_000,
  }), 7_000);
  assert.equal(openRouterSmokeRetryDelay({
    attempt: 1,
    retryAfter: "120",
    baseDelayMs: 1_000,
    maxDelayMs: 60_000,
  }), null);
  assert.equal(openRouterSmokeTransportReason(new DOMException("slow body", "TimeoutError")), "timeout");
  assert.equal(openRouterSmokeTransportReason(new TypeError("fetch failed")), "network");
});

test("OpenRouter smoke honors Retry-After and succeeds with the same request", async () => {
  const responses = [
    new Response("", { status: 429, headers: { "Retry-After": "7" } }),
    new Response("{}", { status: 200 }),
  ];
  const delays = [];
  let calls = 0;
  const result = await runOpenRouterSmokeRequest(async () => {
    calls += 1;
    return responses.shift();
  }, {
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 10_000,
    sleep: async (delayMs) => delays.push(delayMs),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [7_000]);
});

test("OpenRouter smoke keeps persistent and non-retryable failures fail-closed", async () => {
  await assert.rejects(() => runOpenRouterSmokeRequest(async () => (
    new Response("", { status: 429 })
  ), {
    maxAttempts: 2,
    baseDelayMs: 1,
    maxDelayMs: 2,
    sleep: async () => {},
  }), /HTTP 429 after 2 attempts/);
  await assert.rejects(() => runOpenRouterSmokeRequest(async () => (
    new Response("", { status: 401 })
  ), {
    maxAttempts: 5,
    baseDelayMs: 1,
    maxDelayMs: 2,
    sleep: async () => {},
  }), /HTTP 401 after 1 attempts/);
});

test("OpenRouter smoke retries a timeout while consuming a successful response body", async () => {
  const responseBody = JSON.stringify({ ok: true });
  let calls = 0;
  const retries = [];
  const result = await runOpenRouterSmokeRequest(async () => {
    calls += 1;
    return new Response(responseBody, { status: 200 });
  }, {
    maxAttempts: 3,
    baseDelayMs: 10,
    maxDelayMs: 100,
    maxElapsedMs: 1_000,
    readBody: async (response) => {
      if (calls === 1) throw new DOMException("body stalled", "TimeoutError");
      return response.text();
    },
    sleep: async () => {},
    onRetry: (value) => retries.push(value),
  });
  assert.equal(calls, 2);
  assert.equal(result.body, responseBody);
  assert.equal(result.attempts, 2);
  assert.deepEqual(retries, [{ attempt: 1, delayMs: 10, reason: "timeout", status: null }]);
});

test("OpenRouter smoke stops retries that cannot fit the total time budget", async () => {
  let clock = 0;
  await assert.rejects(() => runOpenRouterSmokeRequest(async () => {
    clock += 80;
    throw new DOMException("slow", "TimeoutError");
  }, {
    maxAttempts: 5,
    baseDelayMs: 25,
    maxDelayMs: 100,
    maxElapsedMs: 100,
    now: () => clock,
    sleep: async (delayMs) => { clock += delayMs; },
  }), /total retry budget/);
});
