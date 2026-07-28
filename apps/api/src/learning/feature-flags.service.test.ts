import { afterEach, describe, expect, it } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { FeatureFlagsService } from "./feature-flags.service";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  delete process.env.AZURE_SPEECH_FAKE;
  delete process.env.FEATURE_LEARNING_COURSES_ENABLED;
  delete process.env.FEATURE_PRONUNCIATION_ENABLED;
  delete process.env.FEATURE_LEARNING_AUDIO_PREWARM_ENABLED;
  delete process.env.FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED;
  delete process.env.OPENROUTER_FAKE;
});

describe("FeatureFlagsService speech boundary", () => {
  it("allows the fake provider only outside production", () => {
    process.env.FEATURE_LEARNING_COURSES_ENABLED = "true";
    process.env.FEATURE_PRONUNCIATION_ENABLED = "true";
    process.env.FEATURE_LEARNING_AUDIO_PREWARM_ENABLED = "true";
    process.env.AZURE_SPEECH_FAKE = "true";
    const flags = new FeatureFlagsService();

    process.env.NODE_ENV = "test";
    expect(() => flags.audioPrewarm()).not.toThrow();

    process.env.NODE_ENV = "production";
    expect(() => flags.audioPrewarm()).toThrow(ServiceUnavailableException);
  });

  it("rejects the fake OpenRouter adapter in production", () => {
    process.env.FEATURE_LEARNING_COURSES_ENABLED = "true";
    process.env.FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED = "true";
    process.env.OPENROUTER_FAKE = "true";
    const flags = new FeatureFlagsService();

    process.env.NODE_ENV = "test";
    expect(() => flags.spellingTranslation()).not.toThrow();

    process.env.NODE_ENV = "production";
    expect(() => flags.spellingTranslation()).toThrow(ServiceUnavailableException);
  });
});
