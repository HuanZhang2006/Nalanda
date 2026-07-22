import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAdminService, SupabaseRequestError } from "./supabase-admin.service";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

function service() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  return new SupabaseAdminService();
}

describe("SupabaseAdminService Storage cache", () => {
  it("treats Supabase's HTTP 400/statusCode 404 object response as a cache miss", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      statusCode: "404", error: "not_found", message: "Object not found",
    }), { status: 400, headers: { "Content-Type": "application/json" } })));

    await expect(service().storageGet("vocabulary-audio", "missing.mp3")).resolves.toBeNull();
  });

  it("keeps genuine Storage failures visible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      statusCode: "400", error: "invalid_request", message: "Invalid bucket",
    }), { status: 400, headers: { "Content-Type": "application/json" } })));

    await expect(service().storageGet("vocabulary-audio", "word.mp3"))
      .rejects.toBeInstanceOf(SupabaseRequestError);
  });
});
