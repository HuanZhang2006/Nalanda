import { afterEach, describe, expect, it, vi } from "vitest";
import { beginWavRecording, encodeAssessmentWav, encodePcmWav } from "./recording";

function readBlob(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe("pronunciation WAV encoder", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it("preserves silence, quiet speech, boundaries, and duration without local VAD or trimming", async () => {
    const samples = new Float32Array(16_000 * 2);
    samples[0] = 0.001;
    samples[8_000] = 0.004;
    samples[samples.length - 1] = -0.001;
    const wav = encodeAssessmentWav(samples, 16_000);
    const buffer = await readBlob(wav);
    const view = new DataView(buffer);

    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(view.getInt16(44, true)).not.toBe(0);
    expect(view.getInt16(44 + 8_000 * 2, true)).not.toBe(0);
    expect(view.getInt16(44 + (samples.length - 1) * 2, true)).not.toBe(0);
    expect(() => encodeAssessmentWav(new Float32Array(16_000), 16_000)).not.toThrow();
  });

  it("only converts the device sample rate required by the Azure PCM contract", async () => {
    const samples = new Float32Array(48_000).fill(0.002);
    const wav = encodeAssessmentWav(samples, 48_000);
    const view = new DataView(await readBlob(wav));

    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(16_000 * 2);
  });

  it("disables browser audio processing and submits quiet captured frames without local rejection", async () => {
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    let contextOptions: AudioContextOptions | undefined;
    class QuietAudioContext {
      sampleRate = 16_000;
      destination = {};
      constructor(options?: AudioContextOptions) { contextOptions = options; }
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createScriptProcessor() {
        const processor = {
          onaudioprocess: null as null | ((event: {
            inputBuffer: { getChannelData: () => Float32Array };
          }) => void),
          connect: vi.fn(() => processor.onaudioprocess?.({
            inputBuffer: { getChannelData: () => new Float32Array(4_096).fill(0.0001) },
          })),
          disconnect: vi.fn(),
        };
        return processor;
      }
      close() { return Promise.resolve(); }
    }
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("AudioContext", QuietAudioContext);

    const stop = await beginWavRecording(vi.fn());
    const wav = await stop();

    expect(contextOptions).toEqual({ sampleRate: 16_000 });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    } });
    expect(wav?.size).toBe(44 + 4_096 * 2);
  });
});
