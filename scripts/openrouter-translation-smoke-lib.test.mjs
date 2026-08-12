import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenRouterSmokeBody,
  isRetryableOpenRouterSmokeStatus,
  openRouterSmokeRetryDelay,
  parseOpenRouterSmokePayload,
  parseRetryAfterMilliseconds,
  runOpenRouterSmokeRequest,
} from "./openrouter-translation-smoke-lib.mjs";

test("OpenRouter smoke uses the pinned model and strict two-case schema", () => {
  const body = buildOpenRouterSmokeBody();
  assert.equal(body.model, "google/gemma-4-26b-a4b-it:free");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.properties.decisions.minItems, 2);
  assert.doesNotMatch(JSON.stringify(body), /api[_-]?key/i);
});

test("OpenRouter smoke accepts the expected structured semantic decisions", () => {
  assert.deepEqual(parseOpenRouterSmokePayload({
    choices: [{ message: { content: JSON.stringify({ decisions: [
      { id: "semantic-match", correct: true },
      { id: "semantic-mismatch", correct: false },
    ] }) } }],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
  }), { promptTokens: 20, completionTokens: 8, totalTokens: 28 });
  assert.throws(() => parseOpenRouterSmokePayload({
    choices: [{ message: { content: JSON.stringify({ decisions: [
      { id: "semantic-match", correct: false },
      { id: "semantic-mismatch", correct: false },
    ] }) } }],
  }), /did not match/);
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
