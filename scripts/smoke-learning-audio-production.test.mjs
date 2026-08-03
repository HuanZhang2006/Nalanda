import assert from "node:assert/strict";
import test from "node:test";
import {
  learningAudioCacheKey,
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
