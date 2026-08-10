import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import Redis from "ioredis";

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
if count >= limit then
  local retry = window
  if oldest[2] then retry = math.max(1, tonumber(oldest[2]) + window - now) end
  redis.call('PEXPIRE', key, window)
  return {0, count, retry}
end
redis.call('ZADD', key, now, member)
count = count + 1
oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = window
if oldest[2] then reset = math.max(1, tonumber(oldest[2]) + window - now) end
redis.call('PEXPIRE', key, window)
return {1, count, reset}
`;

const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface SlidingWindowResult {
  allowed: boolean;
  count: number;
  remaining: number;
  resetAfterSeconds: number;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private connectPromise: Promise<void> | null = null;

  configured() {
    return Boolean(process.env.REDIS_URL);
  }

  private instance() {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not configured");
    // ioredis enters the terminal `end` state after the deliberately bounded
    // retry strategy gives up. Drop that instance so the next request can
    // reconnect after Redis has recovered instead of requiring an API restart.
    if (this.client?.status === "end") {
      this.client.disconnect();
      this.client = null;
      this.connectPromise = null;
    }
    if (!this.client) {
      this.client = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
        commandTimeout: 2_000,
        retryStrategy: () => null,
      });
      this.client.on("error", (error) => {
        this.logger.warn(JSON.stringify({ event: "redis_error", message: error.message }));
      });
    }
    return this.client;
  }

  private async ready() {
    const client = this.instance();
    if (client.status === "ready") return client;
    if (!this.connectPromise) {
      this.connectPromise = client.connect().then(() => undefined).finally(() => {
        this.connectPromise = null;
      });
    }
    await this.connectPromise;
    return client;
  }

  async ping() {
    const client = await this.ready();
    return client.ping();
  }

  async slidingWindow(key: string, limit: number, windowMs: number): Promise<SlidingWindowResult> {
    const client = await this.ready();
    const raw = await client.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      Date.now(),
      windowMs,
      limit,
      `${Date.now()}:${randomUUID()}`,
    ) as [number, number, number];
    const allowed = Number(raw[0]) === 1;
    const count = Number(raw[1]);
    return {
      allowed,
      count,
      remaining: Math.max(0, limit - count),
      resetAfterSeconds: Math.max(1, Math.ceil(Number(raw[2]) / 1_000)),
    };
  }

  async increment(key: string, ttlSeconds: number) {
    const client = await this.ready();
    const tx = client.multi();
    tx.incr(key);
    tx.expire(key, ttlSeconds, "NX");
    const result = await tx.exec();
    return Number(result?.[0]?.[1] || 0);
  }

  async acquireLock(key: string, ttlSeconds: number) {
    const client = await this.ready();
    const token = randomUUID();
    const result = await client.set(key, token, "EX", ttlSeconds, "NX");
    return result === "OK" ? token : null;
  }

  async releaseLock(key: string, token: string) {
    const client = await this.ready();
    await client.eval(RELEASE_LOCK_LUA, 1, key, token);
  }

  hmac(value: string) {
    const secret = process.env.RATE_LIMIT_HMAC_SECRET || "";
    if (Buffer.byteLength(secret) < 32) {
      throw new Error("RATE_LIMIT_HMAC_SECRET must contain at least 32 bytes");
    }
    return createHmac("sha256", secret).update(value).digest("hex");
  }

  async onModuleDestroy() {
    const client = this.client;
    this.client = null;
    if (client) await client.quit().catch(() => client.disconnect());
  }
}
