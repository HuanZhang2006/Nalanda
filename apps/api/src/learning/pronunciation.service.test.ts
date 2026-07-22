import { afterEach, describe, expect, it, vi } from "vitest";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { PronunciationService, validateAssessmentWav } from "./pronunciation.service";

function wav(seconds = 0.1) {
  const data = Math.floor(16_000 * seconds) * 2;
  const buffer = Buffer.alloc(44 + data);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + data, 4); buffer.write("WAVE", 8); buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(data, 40);
  return buffer;
}

function harness() {
  const db = { storageGet: vi.fn().mockResolvedValue(null), storagePut: vi.fn(), select: vi.fn().mockResolvedValue([{ id: "word", term: "apple" }]) };
  const learning = { ownedWordInSession: vi.fn().mockResolvedValue({ id: "w", term: "apple" }),
    reserveSpeechQuota: vi.fn(), recordSpeechAssessment: vi.fn().mockResolvedValue({ recorded: true, correct: true, retryQueued: false, passThreshold: 70 }) };
  const flags = { pronunciation: vi.fn() };
  return { db, learning, flags, service: new PronunciationService(db as any, learning as any, flags as any) };
}

afterEach(() => { vi.unstubAllGlobals(); delete process.env.AZURE_SPEECH_KEY; delete process.env.AZURE_SPEECH_REGION; delete process.env.AZURE_SPEECH_FAKE; delete process.env.AZURE_SPEECH_TIMEOUT_MS; delete process.env.AZURE_SPEECH_PRONUNCIATION_PASS_SCORE; });

describe("pronunciation adapter", () => {
  it("accepts only 16 kHz mono PCM WAV up to 8 seconds", () => {
    expect(() => validateAssessmentWav(wav())).not.toThrow();
    const invalid = wav(); invalid.writeUInt32LE(44_100, 24);
    expect(() => validateAssessmentWav(invalid)).toThrow(BadRequestException);
    expect(() => validateAssessmentWav(wav(8.2))).toThrow(BadRequestException);
  });

  it("maps Azure word/phoneme feedback and records no audio", async () => {
    process.env.AZURE_SPEECH_KEY = "test"; process.env.AZURE_SPEECH_REGION = "westus";
    const { service, learning } = harness();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ NBest: [{ PronunciationAssessment: {
      AccuracyScore: 82, FluencyScore: 76, CompletenessScore: 100, PronScore: 84,
    }, Words: [{ PronunciationAssessment: { ErrorType: "Mispronunciation" }, Phonemes: [
      { Phoneme: "æ", PronunciationAssessment: { AccuracyScore: 62 } }, { Phoneme: "p", PronunciationAssessment: { AccuracyScore: 91 } },
    ] }] }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const result = await service.assess("user", "session", "word", { buffer: wav(), size: wav().length } as any);
    expect(result.phonemes[0]).toEqual({ phoneme: "æ", accuracyScore: 62, needsPractice: true });
    expect(learning.reserveSpeechQuota).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result).toMatchObject({ passThreshold: 70, passed: true, queuedForRetry: false });
    expect(learning.recordSpeechAssessment).toHaveBeenCalledWith("user", "session", "word", expect.objectContaining({
      pronunciationScore: 84, passThreshold: 70, passed: true,
    }));
    expect(learning.recordSpeechAssessment.mock.calls[0][3]).not.toHaveProperty("audio");
  });

  it("maps the flattened pronunciation response returned by the live REST endpoint", async () => {
    process.env.AZURE_SPEECH_KEY = "test"; process.env.AZURE_SPEECH_REGION = "japaneast";
    const { service, learning } = harness();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ RecognitionStatus: "Success", NBest: [{
      AccuracyScore: 97, FluencyScore: 94, CompletenessScore: 100, PronScore: 96,
      Words: [{ Word: "apple", AccuracyScore: 97, ErrorType: "None", Phonemes: [
        { Phoneme: "æ", AccuracyScore: 96 }, { Phoneme: "p", AccuracyScore: 98 },
      ] }],
    }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const result = await service.assess("user", "session", "word", { buffer: wav(), size: wav().length } as any);
    expect(result).toMatchObject({ accuracyScore: 97, fluencyScore: 94, completenessScore: 100,
      pronunciationScore: 96, errorType: null });
    expect(result.phonemes).toEqual([
      { phoneme: "æ", accuracyScore: 96, needsPractice: false },
      { phoneme: "p", accuracyScore: 98, needsPractice: false },
    ]);
    expect(learning.recordSpeechAssessment).toHaveBeenCalledWith("user", "session", "word", expect.objectContaining({
      pronunciationScore: 96, passThreshold: 70, passed: true,
    }));
  });

  it("returns the configured overall score threshold and persisted retry decision", async () => {
    process.env.AZURE_SPEECH_KEY = "test"; process.env.AZURE_SPEECH_REGION = "japaneast";
    process.env.AZURE_SPEECH_PRONUNCIATION_PASS_SCORE = "75";
    const { service, learning } = harness();
    learning.recordSpeechAssessment.mockResolvedValue({ recorded: true, correct: false, retryQueued: true, passThreshold: 75 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ NBest: [{
      AccuracyScore: 72, FluencyScore: 70, CompletenessScore: 100, PronScore: 74, Words: [],
    }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(service.assess("user", "session", "word", { buffer: wav(), size: wav().length } as any)).resolves.toMatchObject({
      pronunciationScore: 74, passThreshold: 75, passed: false, queuedForRetry: true,
    });
  });

  it("returns generated TTS even when the optional cache write fails", async () => {
    process.env.AZURE_SPEECH_KEY = "test"; process.env.AZURE_SPEECH_REGION = "japaneast";
    const { service, db } = harness();
    db.storagePut.mockRejectedValue(new Error("cache unavailable"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([73, 68, 51, 4]), { status: 200 })));

    await expect(service.audio("user", "11111111-1111-4111-8111-111111111111"))
      .resolves.toEqual(new Uint8Array([73, 68, 51, 4]));
  });

  it("does not record an attempt when the provider times out", async () => {
    process.env.AZURE_SPEECH_KEY = "test"; process.env.AZURE_SPEECH_REGION = "westus";
    const { service, learning } = harness(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(service.assess("user", "session", "word", { buffer: wav(), size: wav().length } as any)).rejects.toBeInstanceOf(BadGatewayException);
    expect(learning.recordSpeechAssessment).not.toHaveBeenCalled();
  });

  it("rejects the 2 MB upload boundary before calling the provider", async () => {
    process.env.AZURE_SPEECH_FAKE = "true";
    const { service, learning } = harness();
    await expect(service.assess("user", "session", "word", {
      buffer: wav(), size: 2 * 1024 * 1024 + 1,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(learning.ownedWordInSession).not.toHaveBeenCalled();
    expect(learning.reserveSpeechQuota).not.toHaveBeenCalled();
  });
});
