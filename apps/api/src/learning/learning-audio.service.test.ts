import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningAudioService } from "./learning-audio.service";

const unitId = "11111111-1111-4111-8111-111111111111";
const wordId = "22222222-2222-4222-8222-222222222222";
const cacheKey = "a".repeat(64);

function manifest(status = "pending") {
  return {
    unit_id: unitId,
    total: 1,
    ready: status === "ready" ? 1 : 0,
    pending: status === "ready" || status === "failed" ? 0 : 1,
    failed: status === "failed" ? 1 : 0,
    assets: [{
      word_id: wordId,
      cache_key: cacheKey,
      status,
      storage_path: `${cacheKey}.mp3`,
      last_error_code: null,
    }],
  };
}

function harness() {
  const db = {
    rpc: vi.fn(),
    storageGet: vi.fn().mockResolvedValue(null),
    storagePut: vi.fn(),
  };
  const learning = { reserveTtsQuota: vi.fn() };
  const flags = {
    audioPrewarm: vi.fn(),
    audioPrewarmEnabled: vi.fn().mockReturnValue(false),
  };
  const service = new LearningAudioService(db as any, learning as any, flags as any);
  return { db, learning, flags, service };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
  delete process.env.AZURE_SPEECH_FAKE;
  delete process.env.FEATURE_LEARNING_AUDIO_PREWARM_ENABLED;
});

describe("durable learning audio queue", () => {
  it("prepares a unit through one owner-checked RPC and returns stable asset URLs", async () => {
    process.env.AZURE_SPEECH_KEY = "test";
    process.env.AZURE_SPEECH_REGION = "japaneast";
    const { service, db } = harness();
    db.rpc.mockResolvedValue(manifest());
    await expect(service.prepareUnit("user", unitId, 80)).resolves.toMatchObject({
      unitId,
      total: 1,
      pending: 1,
      assets: [{
        wordId,
        cacheKey,
        audioUrl: `/api/pronunciation/audio/${wordId}?v=${cacheKey}`,
      }],
    });
    expect(db.rpc).toHaveBeenCalledWith("learning_prepare_unit_audio", expect.objectContaining({
      p_user_id: "user",
      p_unit_id: unitId,
      p_voice: "en-US-JennyNeural",
      p_priority: 80,
    }));
  });

  it("returns 202-ready metadata until the worker has stored the object", async () => {
    process.env.AZURE_SPEECH_KEY = "test";
    process.env.AZURE_SPEECH_REGION = "japaneast";
    const { service, db } = harness();
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "learning_prepare_word_audio") return manifest("pending").assets[0];
      return null;
    });
    await expect(service.audio("user", wordId)).resolves.toEqual({
      bytes: null,
      cacheKey,
      status: "pending",
    });
    expect(db.storageGet).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("learning_prepare_word_audio", expect.objectContaining({
      p_word_id: wordId,
      p_priority: 100,
    }));
  });

  it("generates one claimed fake asset, reserves character quota and stores it once", async () => {
    process.env.AZURE_SPEECH_KEY = "test";
    process.env.AZURE_SPEECH_REGION = "japaneast";
    process.env.AZURE_SPEECH_FAKE = "true";
    const { service, db, learning, flags } = harness();
    flags.audioPrewarmEnabled.mockReturnValue(true);
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "learning_claim_audio_asset") return {
        cache_key: cacheKey,
        text: "apple",
        locale: "en-US",
        voice: "en-US-JennyNeural",
        output_format: "audio-24khz-48kbitrate-mono-mp3",
        storage_path: `${cacheKey}.mp3`,
        attempt_count: 1,
      };
      return null;
    });
    await (service as any).work();
    expect(db.rpc).toHaveBeenCalledWith("learning_claim_audio_asset", expect.objectContaining({
      p_min_interval_milliseconds: 3100,
    }));
    expect(learning.reserveTtsQuota).toHaveBeenCalledWith(5, 80);
    expect(db.storagePut).toHaveBeenCalledWith(
      "vocabulary-audio", `${cacheKey}.mp3`, expect.any(Uint8Array), "audio/wav",
    );
    expect(db.rpc).toHaveBeenCalledWith("learning_finish_audio_asset", expect.objectContaining({
      p_cache_key: cacheKey,
      p_success: true,
    }));
  });

  it("recovers a Storage object after a worker crash without calling Azure or reserving quota", async () => {
    process.env.AZURE_SPEECH_KEY = "test";
    process.env.AZURE_SPEECH_REGION = "japaneast";
    const { service, db, learning, flags } = harness();
    flags.audioPrewarmEnabled.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn());
    db.storageGet.mockResolvedValue(new Uint8Array([73, 68, 51]));
    db.rpc.mockImplementation(async (name: string) => name === "learning_claim_audio_asset" ? {
      cache_key: cacheKey,
      text: "apple",
      storage_path: `${cacheKey}.mp3`,
      attempt_count: 1,
    } : null);
    await (service as any).work();
    expect(learning.reserveTtsQuota).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("learning_finish_audio_asset", expect.objectContaining({
      p_success: true,
    }));
  });
});
