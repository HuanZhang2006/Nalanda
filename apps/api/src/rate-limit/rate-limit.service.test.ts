import { HttpException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitService } from "./rate-limit.service";

function response() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
  };
}

function request(path: string, method = "GET", userId?: string, body: unknown = {}) {
  return {
    method,
    originalUrl: `/api${path}`,
    ip: "203.0.113.9",
    socket: {},
    body,
    ...(userId ? { user: { id: userId } } : {}),
  };
}

describe("RateLimitService", () => {
  const redis = {
    hmac: vi.fn(() => "b".repeat(64)),
    slidingWindow: vi.fn(),
    increment: vi.fn().mockResolvedValue(1),
  };
  const db = { rpc: vi.fn().mockResolvedValue(null) };
  let service: RateLimitService;

  beforeEach(() => {
    vi.clearAllMocks();
    redis.slidingWindow.mockResolvedValue({ allowed: true, count: 1, remaining: 4, resetAfterSeconds: 42 });
    redis.increment.mockResolvedValue(1);
    service = new RateLimitService(redis as any, db as any);
  });

  it("layers IP and normalized-email registration rules", async () => {
    const res = response();
    await service.enforce(request("/auth/register", "POST", undefined, {
      email: " Alice@Example.COM ",
    }) as any, res as any);
    expect(redis.hmac).toHaveBeenCalledWith("ip:203.0.113.9");
    expect(redis.hmac).toHaveBeenCalledWith("email:alice@example.com");
    expect(redis.slidingWindow).toHaveBeenCalledTimes(2);
    expect(res.headers.get("RateLimit-Policy")).toBe("3;w=3600");
  });

  it("returns standard 429 headers and writes only milestone audit facts", async () => {
    redis.slidingWindow.mockResolvedValue({ allowed: false, count: 5, remaining: 0, resetAfterSeconds: 42 });
    const res = response();
    let caught: unknown;
    try {
      await service.enforce(request("/auth/register", "POST", undefined, { email: "a@example.com" }) as any, res as any);
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(429);
    expect((caught as HttpException).getResponse()).toEqual({
      code: "RATE_LIMITED", message: "Too many requests", retryAfterSeconds: 42,
    });
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(db.rpc).toHaveBeenCalledWith("record_api_abuse_event", expect.objectContaining({
      p_actor_hmac: "b".repeat(64),
      p_route_group: "registration",
      p_event_count: 1,
    }));
  });

  it("fails open only for private reads and fails closed for protected writes", async () => {
    redis.slidingWindow.mockRejectedValue(new Error("redis offline"));
    await expect(service.enforce(
      request("/auth/register", "POST", undefined, { email: "a@example.com" }) as any,
      response() as any,
    )).rejects.toMatchObject({ status: 503, response: { code: "RATE_LIMIT_UNAVAILABLE" } });
    await expect(service.enforce(
      request("/learning-courses", "GET", "11111111-1111-4111-8111-111111111111") as any,
      response() as any,
    )).resolves.toBeUndefined();

    await expect(service.enforce(
      request("/learning-courses", "POST", "11111111-1111-4111-8111-111111111111") as any,
      response() as any,
    )).rejects.toMatchObject({ status: 503, response: { code: "RATE_LIMIT_UNAVAILABLE" } });
    await expect(service.enforce(
      request("/course-market", "GET") as any,
      response() as any,
    )).rejects.toMatchObject({ status: 503, response: { code: "RATE_LIMIT_UNAVAILABLE" } });
  });

  it("applies the global user rule plus Courses write and IP burst rules", async () => {
    await service.enforce(
      request("/learning-sessions/session/attempts", "POST", "11111111-1111-4111-8111-111111111111") as any,
      response() as any,
    );
    expect(redis.slidingWindow.mock.calls.map((call) => call[1])).toEqual([300, 120, 60]);
  });

  it("classifies public market/share reads by IP and ordinary authenticated reads by user", async () => {
    await service.enforce(request("/course-market") as any, response() as any);
    await service.enforce(request("/public/course-shares/token") as any, response() as any);
    await service.enforce(
      request("/me", "GET", "11111111-1111-4111-8111-111111111111") as any,
      response() as any,
    );
    expect(redis.slidingWindow.mock.calls.map((call) => call[1])).toEqual([120, 120, 300]);
    expect(redis.hmac).toHaveBeenCalledWith("ip:203.0.113.9");
    expect(redis.hmac).toHaveBeenCalledWith("user:11111111-1111-4111-8111-111111111111");
  });

  it("fails closed and layers Courses limits on reads that enqueue provider cost", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    await service.enforce(request("/pronunciation/audio/word-id", "GET", userId) as any, response() as any);
    await service.enforce(request("/learning-sessions/session-id", "GET", userId) as any, response() as any);
    expect(redis.slidingWindow.mock.calls.map((call) => call[1])).toEqual([
      300, 120, 60, 300, 120, 60,
    ]);

    redis.slidingWindow.mockRejectedValue(new Error("redis offline"));
    await expect(service.enforce(
      request("/pronunciation/audio/word-id", "GET", userId) as any,
      response() as any,
    )).rejects.toMatchObject({ status: 503, response: { code: "RATE_LIMIT_UNAVAILABLE" } });
  });

  it("aggregates denied requests in Redis and only persists audit milestones", async () => {
    redis.slidingWindow.mockResolvedValue({ allowed: false, count: 301, remaining: 0, resetAfterSeconds: 12 });
    redis.increment.mockResolvedValue(2);
    await expect(service.enforce(
      request("/me", "GET", "11111111-1111-4111-8111-111111111111") as any,
      response() as any,
    )).rejects.toMatchObject({ status: 429 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
