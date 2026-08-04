import { afterEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, GatewayTimeoutException } from "@nestjs/common";
import { OpenRouterTranscriptionService } from "./openrouter-transcription.service";

const sessionId = "11111111-1111-4111-8111-111111111111";
const wordId = "22222222-2222-4222-8222-222222222222";

function wav(seconds = 0.1) {
  const data = Math.floor(16_000 * seconds) * 2;
  const buffer = Buffer.alloc(44 + data);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + data, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(data, 40);
  return buffer;
}

function upload(seconds = 0.1) {
  const buffer = wav(seconds);
  return { buffer, size: buffer.length } as Express.Multer.File;
}

function harness() {
  const learning = {
    reserveTranslationStt: vi.fn().mockResolvedValue({
      reserved: true,
      revision: 4,
    }),
  };
  const flags = { spellingTranslation: vi.fn() };
  return {
    learning,
    flags,
    service: new OpenRouterTranscriptionService(learning as any, flags as any),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of [
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
    "OPENROUTER_STT_MODEL",
    "OPENROUTER_STT_LANGUAGE",
    "OPENROUTER_STT_TIMEOUT_MS",
    "OPENROUTER_STT_REQUESTS_PER_MINUTE",
    "OPENROUTER_STT_REQUESTS_PER_DAY",
    "OPENROUTER_STT_MONTHLY_BUDGET_MICRO_USD",
    "OPENROUTER_STT_MICRO_USD_PER_SECOND",
    "OPENROUTER_FAKE",
    "PUBLIC_ORIGIN",
  ]) delete process.env[name];
});

describe("OpenRouter translation voice transcription", () => {
  it("uses the dedicated STT endpoint with Chinese recognition and no client secret exposure", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    process.env.PUBLIC_ORIGIN = "https://nalanda.online";
    const { service, learning, flags } = harness();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: "一种苹果",
      usage: { seconds: 0.1, cost: 0.00001 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(service.transcribe("user-a", sessionId, wordId, "4", upload()))
      .resolves.toEqual({
        text: "一种苹果",
        wordId,
        revision: 4,
        language: "zh",
      });
    expect(flags.spellingTranslation).toHaveBeenCalledOnce();
    expect(learning.reserveTranslationStt).toHaveBeenCalledWith(
      "user-a", sessionId, wordId, 4, 10, 20, 300, 5_000_000,
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-secret");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "fish-audio/transcribe-1",
      language: "zh",
      input_audio: { format: "wav" },
    });
    expect(Buffer.from(body.input_audio.data, "base64").equals(upload().buffer)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("test-secret");
    expect(JSON.stringify(learning.reserveTranslationStt.mock.calls)).not.toContain("RIFF");
  });

  it("returns the deterministic adapter in automation while retaining DB target validation", async () => {
    process.env.OPENROUTER_FAKE = "true";
    const { service, learning } = harness();
    vi.stubGlobal("fetch", vi.fn());
    await expect(service.transcribe("user-a", sessionId, wordId, "4", upload()))
      .resolves.toMatchObject({ text: "语音输入", language: "zh" });
    expect(learning.reserveTranslationStt).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not call OpenRouter when the session revision conflicts", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    learning.reserveTranslationStt.mockResolvedValue({ conflict: true, current_revision: 5 });
    vi.stubGlobal("fetch", vi.fn());
    await expect(service.transcribe("user-a", sessionId, wordId, "4", upload()))
      .rejects.toMatchObject({
        status: 409,
        response: { code: "SESSION_REVISION_CONFLICT", currentRevision: 5 },
      });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates the WAV and revision before reserving provider cost", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    await expect(service.transcribe("user-a", sessionId, wordId, "bad", upload()))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.transcribe("user-a", sessionId, wordId, "4", {
      buffer: Buffer.from("not-wav"), size: 7,
    } as Express.Multer.File)).rejects.toBeInstanceOf(BadRequestException);
    expect(learning.reserveTranslationStt).not.toHaveBeenCalled();
  });

  it("maps provider timeout without returning or persisting a transcript", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service } = harness();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new DOMException("timeout", "TimeoutError"),
    ));
    await expect(service.transcribe("user-a", sessionId, wordId, "4", upload()))
      .rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it("maps an unfunded provider key without treating the transcript as an answer", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service } = harness();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "payment required" } }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    )));
    await expect(service.transcribe("user-a", sessionId, wordId, "4", upload()))
      .rejects.toMatchObject({
        status: 503,
        response: { code: "TRANSLATION_STT_PROVIDER_CREDIT_REQUIRED" },
      });
  });
});
