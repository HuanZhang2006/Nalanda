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

export function retryableLearningAudioSmokeError(error) {
  const status = Number(error?.status);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return error?.retryable === true
    || error?.name === "TimeoutError"
    || error?.name === "AbortError";
}

export async function runLearningAudioSmokeRequest(request, {
  maxAttempts = 3,
  delaysMs = [500, 1_500],
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onRetry = () => {},
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try { return await request(attempt); }
    catch (error) {
      lastError = error;
      if (!retryableLearningAudioSmokeError(error) || attempt === maxAttempts) throw error;
      const delayMs = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0;
      onRetry({ attempt, delayMs, status: Number(error?.status) || null });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
