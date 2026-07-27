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

export function decodePcm16Wav(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF"
      || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("WAV must be a RIFF/WAVE file");
  }
  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) throw new Error(`Invalid WAV ${id} chunk`);
    if (id === "fmt " && size >= 16) {
      format = {
        codec: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bits: buffer.readUInt16LE(start + 14),
      };
    }
    if (id === "data") data = buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || format.codec !== 1 || format.channels !== 1 || format.bits !== 16 || !data) {
    throw new Error("WAV must be mono 16-bit PCM");
  }
  const samples = new Int16Array(data.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = data.readInt16LE(index * 2);
  }
  return { sampleRate: format.sampleRate, samples };
}

export function encodePcm16Wav(samples, sampleRate = 16_000) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }
  return buffer;
}

export function trimAssessmentFixture(bytes) {
  const decoded = decodePcm16Wav(bytes);
  if (decoded.sampleRate !== 16_000) throw new Error("Assessment fixture must be 16 kHz");
  const leadingSilence = new Int16Array(Math.round(decoded.sampleRate * 0.2));
  const trailingSilence = new Int16Array(Math.round(decoded.sampleRate * 0.3));
  const padded = new Int16Array(
    leadingSilence.length + decoded.samples.length + trailingSilence.length,
  );
  padded.set(decoded.samples, leadingSilence.length);

  const frameSize = Math.round(decoded.sampleRate * 0.02);
  const rms = (start, end) => {
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      const value = padded[index] / 32768;
      sum += value * value;
    }
    return Math.sqrt(sum / Math.max(1, end - start));
  };
  const noiseEnd = Math.round(decoded.sampleRate * 0.2);
  const threshold = Math.max(0.015, rms(0, noiseEnd) * 3);
  const active = [];
  for (let start = 0; start < padded.length; start += frameSize) {
    if (rms(start, Math.min(padded.length, start + frameSize)) >= threshold) {
      active.push(start);
    }
  }
  if (active.length * frameSize < decoded.sampleRate * 0.25) {
    throw new Error("Azure fixture contains less than 250 ms of detected speech");
  }
  const padding = Math.round(decoded.sampleRate * 0.15);
  const start = Math.max(0, active[0] - padding);
  const end = Math.min(
    padded.length,
    active.at(-1) + frameSize + padding,
    start + decoded.sampleRate * 6,
  );
  return encodePcm16Wav(padded.slice(start, end), decoded.sampleRate);
}
