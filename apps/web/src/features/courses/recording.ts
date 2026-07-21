function resample(input: Float32Array, sourceRate: number, targetRate = 16_000) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0; i < output.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

export function encodePcmWav(samples: Float32Array, sampleRate = 16_000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2,
    Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff), true));
  return new Blob([buffer], { type: "audio/wav" });
}

export async function beginWavRecording(onAutoStop: (blob: Blob) => void) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("此浏览器不支持麦克风录音");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  source.connect(processor); processor.connect(context.destination);
  let done = false;
  const stop = async () => {
    if (done) return null;
    done = true; processor.disconnect(); source.disconnect(); stream.getTracks().forEach((track) => track.stop());
    await context.close();
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(length); let offset = 0;
    chunks.forEach((chunk) => { merged.set(chunk, offset); offset += chunk.length; });
    return encodePcmWav(resample(merged, context.sampleRate));
  };
  const timeout = window.setTimeout(async () => { const blob = await stop(); if (blob) onAutoStop(blob); }, 8_000);
  return async () => { window.clearTimeout(timeout); return stop(); };
}
