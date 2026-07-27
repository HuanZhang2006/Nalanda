import type { LearningAudioManifestAsset } from "@nalanda/types";
import { authedFetch } from "../../lib/api";

const memory = new Map<string, Blob>();

function absolute(url: string) {
  return new URL(url, window.location.href).toString();
}

function cacheName(version: string) {
  return `nalanda-vocabulary-audio-${version.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

async function cache(version: string) {
  if (!("caches" in window)) return null;
  return window.caches.open(cacheName(version)).catch(() => null);
}

export async function getCachedAudioBlob(asset: LearningAudioManifestAsset, version: string) {
  const key = absolute(asset.audioUrl);
  const cached = await cache(version);
  const response = await cached?.match(key).catch(() => undefined);
  if (response?.ok) return response.blob();
  return memory.get(key) || null;
}

export async function fetchAudioAsset(asset: LearningAudioManifestAsset, version: string) {
  const existing = await getCachedAudioBlob(asset, version);
  if (existing) return existing;
  const response = await authedFetch(asset.audioUrl);
  if (response.status === 202) return null;
  if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
  const blob = await response.blob();
  const key = absolute(asset.audioUrl);
  memory.set(key, blob);
  const target = await cache(version);
  if (target) {
    await target.put(key, new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": blob.type || "audio/mpeg",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })).catch(() => undefined);
  }
  return blob;
}

export async function playAudioAsset(asset: LearningAudioManifestAsset, version: string) {
  const blob = await fetchAudioAsset(asset, version);
  if (!blob) return false;
  let objectUrl = URL.createObjectURL(blob);
  const audio = new Audio(objectUrl);
  const release = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
  };
  audio.onended = release;
  audio.onerror = release;
  try {
    await audio.play();
    return true;
  } catch (error) {
    release();
    throw error;
  }
}

export async function prefetchAudioAssets(
  assets: LearningAudioManifestAsset[],
  version: string,
  concurrency = 2,
  onResult?: (
    asset: LearningAudioManifestAsset,
    result: "cached" | "pending" | "failed",
  ) => void,
) {
  const queue = [...assets];
  let cached = 0;
  const worker = async () => {
    while (queue.length) {
      const asset = queue.shift();
      if (!asset) return;
      try {
        const blob = await fetchAudioAsset(asset, version);
        if (blob) {
          cached += 1;
          onResult?.(asset, "cached");
        } else {
          onResult?.(asset, "pending");
        }
      } catch {
        onResult?.(asset, "failed");
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), queue.length || 1) },
    () => worker(),
  ));
  return cached;
}

export async function cachedAudioCount(
  assets: LearningAudioManifestAsset[],
  version: string,
) {
  const values = await Promise.all(assets.map((asset) => getCachedAudioBlob(asset, version)));
  return values.filter(Boolean).length;
}

export async function removeCachedAudioAssets(
  assets: LearningAudioManifestAsset[],
  version: string,
) {
  const target = await cache(version);
  await Promise.all(assets.map(async (asset) => {
    const key = absolute(asset.audioUrl);
    memory.delete(key);
    await target?.delete(key).catch(() => false);
  }));
}

export async function requestPersistentAudioStorage() {
  return navigator.storage?.persist?.().catch(() => false) ?? false;
}
