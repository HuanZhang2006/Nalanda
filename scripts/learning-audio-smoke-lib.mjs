import { createHash } from "node:crypto";

export const AUDIO_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

export function learningAudioCacheKey(
  normalizedTerm,
  locale,
  voice,
  outputFormat,
  synthesisVersion,
) {
  return createHash("sha256")
    .update([normalizedTerm, locale, voice, outputFormat, synthesisVersion].join("\x1f"))
    .digest("hex");
}
