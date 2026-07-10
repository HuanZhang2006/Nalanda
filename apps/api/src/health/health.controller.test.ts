import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthController } from "./health.controller";

describe("HealthController readiness", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://project.example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    delete process.env.REDIS_URL;
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

    await expect(new HealthController().check()).resolves.toMatchObject({
      status: "ok",
      service: "nalanda-api",
      deps: { redis: "unset", ai: "unset", supabase: "ok" },
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

    const result = new HealthController().check();
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toMatchObject({ response: {
      status: "error",
      service: "nalanda-api",
      deps: { supabase: "unavailable" },
    } });
  });
});
