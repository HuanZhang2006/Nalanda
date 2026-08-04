import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const openRouterKey = process.env.OPENROUTER_API_KEY;
const openRouterBase = String(
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
).replace(/\/$/, "");
const model = process.env.OPENROUTER_STT_MODEL || "fish-audio/transcribe-1";
const language = process.env.OPENROUTER_STT_LANGUAGE || "zh";
const azureKey = process.env.AZURE_SPEECH_KEY;
const azureRegion = process.env.AZURE_SPEECH_REGION;
const fixturePath = process.env.OPENROUTER_STT_FIXTURE_WAV;

assert.ok(openRouterKey, "OPENROUTER_API_KEY is required");
if (!fixturePath) {
  assert.ok(azureKey, "AZURE_SPEECH_KEY is required to synthesize the fixed Chinese fixture");
  assert.ok(azureRegion, "AZURE_SPEECH_REGION is required");
}
assert.notEqual(process.env.OPENROUTER_FAKE, "true", "real STT smoke refuses OPENROUTER_FAKE");
assert.equal(model, "fish-audio/transcribe-1", "unexpected STT model");
assert.equal(language, "zh", "STT smoke requires the default Chinese language hint");

const startedAt = Date.now();
let wav;
if (fixturePath) {
  wav = await readFile(fixturePath);
} else {
  const azureResponse = await fetch(
    `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
        "User-Agent": "Nalanda-OpenRouter-STT-Smoke",
      },
      body: '<speak version="1.0" xml:lang="zh-CN"><voice name="zh-CN-XiaoxiaoNeural">苹果</voice></speak>',
    },
  );
  assert.equal(azureResponse.status, 200, `Azure fixture synthesis returned ${azureResponse.status}`);
  wav = Buffer.from(await azureResponse.arrayBuffer());
}
assert.ok(wav.length > 44, "Azure fixture WAV is empty");
assert.equal(wav.toString("ascii", 0, 4), "RIFF");
assert.equal(wav.toString("ascii", 8, 12), "WAVE");

const transcriptionResponse = await fetch(`${openRouterBase}/audio/transcriptions`, {
  method: "POST",
  signal: AbortSignal.timeout(30_000),
  headers: {
    Authorization: `Bearer ${openRouterKey}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": "Nalanda translation voice input smoke",
  },
  body: JSON.stringify({
    model,
    language,
    input_audio: { data: wav.toString("base64"), format: "wav" },
  }),
});
const payload = await transcriptionResponse.json().catch(() => null);
assert.equal(
  transcriptionResponse.status,
  200,
  `OpenRouter STT returned ${transcriptionResponse.status}`,
);
assert.match(String(payload?.text || ""), /苹果/, "Fish Audio transcript missed the fixed keyword");

console.log(JSON.stringify({
  ok: true,
  provider: "openrouter",
  model,
  language,
  audioBytes: wav.length,
  keywordMatched: true,
  providerSeconds: Number(payload?.usage?.seconds) || null,
  providerCostUsd: Number(payload?.usage?.cost) || null,
  durationMs: Date.now() - startedAt,
}));
