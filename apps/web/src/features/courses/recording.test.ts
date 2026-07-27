import { describe, expect, it } from "vitest";
import { encodePcmWav, trimSpeechSamples } from "./recording";

describe("pronunciation WAV encoder", () => {
  it("writes clamped 16 kHz mono PCM samples with a valid WAV header", async () => {
    const wav = encodePcmWav(new Float32Array([-2, -0.5, 0, 0.5, 2]));
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(wav);
    });
    const view = new DataView(buffer);
    const text = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(view.buffer, offset, length));

    expect(wav.type).toBe("audio/wav");
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(-16_384);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(16_383);
    expect(view.getInt16(52, true)).toBe(32_767);
  });

  it("trims silence with padding and rejects recordings without clear speech", () => {
    const samples = new Float32Array(16_000 * 2);
    for (let index = 8_000; index < 16_000; index += 1) samples[index] = 0.2;
    const trimmed = trimSpeechSamples(samples);
    expect(trimmed.length).toBeGreaterThan(8_000);
    expect(trimmed.length).toBeLessThan(samples.length);
    expect(() => trimSpeechSamples(new Float32Array(16_000))).toThrow(/speech|语音/i);
  });
});
