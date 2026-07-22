import assert from "node:assert/strict";

const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
const voice = process.env.AZURE_SPEECH_VOICE || "en-US-JennyNeural";
const referenceText = "apple";
const timeoutMs = 20_000;

assert.ok(key, "AZURE_SPEECH_KEY is required");
assert.match(region || "", /^[a-z0-9-]+$/, "AZURE_SPEECH_REGION is required and must be a valid region name");
assert.notEqual(process.env.AZURE_SPEECH_FAKE, "true", "real Azure smoke refuses AZURE_SPEECH_FAKE=true");

const escapeXml = (value) => value.replace(/[<>&"']/g, (char) => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
})[char]);

const ttsEndpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${escapeXml(voice)}">${referenceText}</voice></speak>`;

async function azureRequest(name, url, init) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`${name} could not reach Azure Speech`, { cause: error });
  }
  if (!response.ok) throw new Error(`${name} failed with Azure HTTP ${response.status}`);
  return response;
}

async function synthesize(outputFormat) {
  const response = await azureRequest("Azure TTS", ttsEndpoint, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": outputFormat,
      "User-Agent": "Nalanda-Release-Smoke",
    },
    body: ssml,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 44, `Azure TTS returned an unexpectedly small ${outputFormat} payload`);
  return bytes;
}

function assertPcmWav(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF", "assessment fixture is not RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE", "assessment fixture is not WAVE");
  let offset = 12;
  let format;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + size <= bytes.length, `invalid WAV ${id} chunk length`);
    if (id === "fmt " && size >= 16) {
      format = {
        codec: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bits: bytes.readUInt16LE(start + 14),
      };
    }
    if (id === "data") dataSize += size;
    offset = start + size + (size % 2);
  }
  assert.deepEqual(format, { codec: 1, channels: 1, sampleRate: 16_000, bits: 16 });
  assert.ok(dataSize > 0, "assessment fixture has no PCM samples");
}

const mp3 = await synthesize("audio-24khz-48kbitrate-mono-mp3");
const wav = await synthesize("riff-16khz-16bit-mono-pcm");
assertPcmWav(wav);

const pronunciationHeader = Buffer.from(JSON.stringify({
  ReferenceText: referenceText,
  GradingSystem: "HundredMark",
  Granularity: "Phoneme",
  Dimension: "Comprehensive",
  EnableMiscue: true,
  PhonemeAlphabet: "IPA",
})).toString("base64");
const assessmentEndpoint = new URL(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`);
assessmentEndpoint.searchParams.set("language", "en-US");
assessmentEndpoint.searchParams.set("format", "detailed");

const assessmentResponse = await azureRequest("Azure pronunciation assessment", assessmentEndpoint, {
  method: "POST",
  headers: {
    "Ocp-Apim-Subscription-Key": key,
    "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
    "Pronunciation-Assessment": pronunciationHeader,
    Accept: "application/json",
  },
  body: wav,
});
const payload = await assessmentResponse.json();
assert.equal(payload.RecognitionStatus, "Success", "Azure did not recognize the synthesized fixture");
const best = payload.NBest?.[0];
const scores = best?.PronunciationAssessment || best;
if (!scores) {
  const bestKeys = best && typeof best === "object" ? Object.keys(best).sort().join(",") : "none";
  const wordKeys = best?.Words?.[0] && typeof best.Words[0] === "object"
    ? Object.keys(best.Words[0]).sort().join(",") : "none";
  throw new Error(`Azure response has no pronunciation assessment (best keys: ${bestKeys}; word keys: ${wordKeys})`);
}
for (const name of ["AccuracyScore", "FluencyScore", "CompletenessScore", "PronScore"]) {
  assert.ok(Number.isFinite(Number(scores[name])), `Azure response has no numeric ${name}`);
}
assert.match(String(payload.DisplayText || best.Display || ""), /apple/i, "Azure transcript does not contain the reference word");
const phonemes = (best.Words || []).flatMap((word) => {
  if (Array.isArray(word.Phonemes) && word.Phonemes.length) return word.Phonemes;
  return (word.Syllables || []).flatMap((syllable) => syllable.Phonemes || []);
});
assert.ok(phonemes.length > 0, "Azure response has no phoneme-level feedback");

console.log(JSON.stringify({
  ok: true,
  provider: "azure-speech",
  region,
  voice,
  mp3Bytes: mp3.length,
  assessmentWavBytes: wav.length,
  recognitionStatus: payload.RecognitionStatus,
  accuracyScore: Number(scores.AccuracyScore),
  pronunciationScore: Number(scores.PronScore),
  phonemeCount: phonemes.length,
}));
