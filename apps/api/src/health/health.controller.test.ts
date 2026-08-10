import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthController } from "./health.controller";

describe("HealthController readiness", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://project.example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    process.env.REDIS_URL = "redis://redis:6379";
    delete process.env.AI_SERVICE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.REDIS_URL;
    delete process.env.AI_SERVICE_URL;
  });

  it("only reports ready after JWKS and PostgREST both respond", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const redis = { configured: () => true, hmac: vi.fn(), ping: vi.fn().mockResolvedValue("PONG") };
    await expect(new HealthController(redis as any).check()).resolves.toMatchObject({
      status: "ok",
      service: "nalanda-api",
      deps: { redis: "ok", ai: "unset", supabase: "ok" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      "https://project.example.com/auth/v1/.well-known/jwks.json",
      "https://project.example.com/rest/v1/profiles?select=id&limit=0",
    ]));
  });

  it("returns a sanitized 503 when a required dependency is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false }));

    const redis = { configured: () => true, hmac: vi.fn(), ping: vi.fn().mockResolvedValue("PONG") };
    const result = new HealthController(redis as any).check();
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toMatchObject({ response: {
      status: "error",
      service: "nalanda-api",
      deps: { supabase: "unavailable" },
    } });
  });

  it("keeps Supabase evidence when Redis readiness fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const redis = { configured: () => true, hmac: vi.fn(), ping: vi.fn().mockRejectedValue(new Error("offline")) };
    const result = new HealthController(redis as any).check();
    await expect(result).rejects.toMatchObject({ response: {
      status: "error",
      deps: { supabase: "ok", redis: "unavailable" },
    } });
  });
});
