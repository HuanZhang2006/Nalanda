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

  it("prioritizes pending assets with at most two concurrent requests and reports each result", async () => {
    const assets = Array.from({ length: 5 }, (_, index) => ({
      ...asset,
      wordId: `word-window-${index}`,
      cacheKey: `cache-window-${index}`,
      status: "pending" as const,
      audioUrl: `/api/pronunciation/audio/word-window-${index}`,
    }));
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return new Response(JSON.stringify({ code: "AUDIO_PENDING" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }));
    const results: string[] = [];
    const prefetch = prefetchAudioAssets(assets, "window", 2, (entry, result) => {
      results.push(`${entry.wordId}:${result}`);
    });

    await vi.waitFor(() => expect(active).toBe(2));
    expect(peak).toBe(2);
    while (results.length < assets.length) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await expect(prefetch).resolves.toBe(0);
    expect(peak).toBe(2);
    expect(results).toEqual(assets.map((entry) => `${entry.wordId}:pending`));
  });
});
