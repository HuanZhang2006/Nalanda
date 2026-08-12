import assert from "node:assert/strict";
import test from "node:test";
import {
  learningAudioCacheKey,
  runLearningAudioSmokeRequest,
} from "./learning-audio-smoke-lib.mjs";

test("audio cache key is deterministic across users and changes with synthesis inputs", () => {
  const first = learningAudioCacheKey(
    "apple", "en-US", "en-US-JennyNeural",
    "audio-24khz-48kbitrate-mono-mp3", "1",
  );
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, learningAudioCacheKey(
    "apple", "en-US", "en-US-JennyNeural",
    "audio-24khz-48kbitrate-mono-mp3", "1",
  ));
  assert.notEqual(first, learningAudioCacheKey(
    "apple", "en-US", "en-US-JennyNeural",
    "audio-24khz-48kbitrate-mono-mp3", "2",
  ));
});

test("audio smoke retries transient idempotent prewarm failures only", async () => {
  const errors = [
    Object.assign(new Error("temporary"), { status: 500 }),
    Object.assign(new Error("timeout"), { retryable: true }),
  ];
  let calls = 0;
  const result = await runLearningAudioSmokeRequest(async () => {
    calls += 1;
    const error = errors.shift();
    if (error) throw error;
    return "ready";
  }, { maxAttempts: 3, delaysMs: [1, 2], sleep: async () => {} });
  assert.equal(result, "ready");
  assert.equal(calls, 3);

  await assert.rejects(() => runLearningAudioSmokeRequest(async () => {
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }, { maxAttempts: 3, sleep: async () => {} }), /unauthorized/);
});
