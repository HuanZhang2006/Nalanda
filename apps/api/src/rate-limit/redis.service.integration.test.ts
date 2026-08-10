import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RedisService } from "./redis.service";

const redisDescribe = process.env.RUN_REDIS_E2E === "true" ? describe : describe.skip;

redisDescribe("RedisService real Redis", () => {
  let service: RedisService;

  beforeEach(() => {
    process.env.REDIS_URL ||= "redis://127.0.0.1:6379/15";
    process.env.RATE_LIMIT_HMAC_SECRET = "a".repeat(64);
    service = new RedisService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it("keeps a concurrent sliding window atomic", async () => {
    const key = `nalanda:test:window:${crypto.randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 30 }, () => service.slidingWindow(key, 7, 2_000)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(7);
    expect(results.filter((result) => !result.allowed)).toHaveLength(23);
    expect(results.at(-1)?.remaining).toBe(0);
  });

  it("expires windows and uses token-protected locks", async () => {
    const windowKey = `nalanda:test:expiry:${crypto.randomUUID()}`;
    expect((await service.slidingWindow(windowKey, 1, 80)).allowed).toBe(true);
    expect((await service.slidingWindow(windowKey, 1, 80)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 110));
    expect((await service.slidingWindow(windowKey, 1, 80)).allowed).toBe(true);

    const lockKey = `nalanda:test:lock:${crypto.randomUUID()}`;
    const token = await service.acquireLock(lockKey, 5);
    expect(token).toBeTruthy();
    expect(await service.acquireLock(lockKey, 5)).toBeNull();
    await service.releaseLock(lockKey, token!);
    expect(await service.acquireLock(lockKey, 5)).toBeTruthy();
  });
});
