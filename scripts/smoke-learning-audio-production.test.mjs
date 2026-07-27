import assert from "node:assert/strict";
import test from "node:test";
import {
  decodePcm16Wav,
  encodePcm16Wav,
  learningAudioCacheKey,
  trimAssessmentFixture,
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

test("release assessment fixture uses the same VAD limits and remains valid PCM", () => {
  const samples = new Int16Array(16_000 * 8);
  for (let index = 16_000; index < 16_000 * 7; index += 1) {
    samples[index] = Math.round(Math.sin(index / 7) * 8_000);
  }
  const trimmed = trimAssessmentFixture(encodePcm16Wav(samples));
  const decoded = decodePcm16Wav(trimmed);
  assert.equal(decoded.sampleRate, 16_000);
  assert.ok(decoded.samples.length >= 16_000 * 5.9);
  assert.ok(decoded.samples.length <= 16_000 * 6);
});
