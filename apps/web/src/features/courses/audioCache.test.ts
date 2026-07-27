import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAudioAsset, getCachedAudioBlob, prefetchAudioAssets } from "./audioCache";

const asset = {
  wordId: "word-a",
  cacheKey: "cache-a",
  status: "ready" as const,
  audioUrl: "/api/pronunciation/audio/word-a?v=cache-a",
  lastErrorCode: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("browser vocabulary audio cache", () => {
  it("stores a fetched audio blob and serves the second read without another request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      new TextEncoder().encode("audio"),
      { status: 200, headers: { "Content-Type": "audio/mpeg" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const fetched = await fetchAudioAsset(asset, "test");
    const cached = await getCachedAudioBlob(asset, "test");
    expect(fetched).toMatchObject({ size: 5, type: "audio/mpeg" });
    expect(cached).toMatchObject({ size: 5, type: "audio/mpeg" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats 202 as a queued cache miss", async () => {
    const pending = { ...asset, wordId: "word-pending", audioUrl: "/api/pronunciation/audio/word-pending" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "AUDIO_PENDING",
    }), { status: 202, headers: { "Content-Type": "application/json" } })));
    await expect(fetchAudioAsset(pending, "pending")).resolves.toBeNull();
    await expect(prefetchAudioAssets([pending], "pending", 2)).resolves.toBe(0);
  });
});
