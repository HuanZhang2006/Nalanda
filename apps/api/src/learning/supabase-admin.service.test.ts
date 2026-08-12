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

  it("keeps Storage network failures visible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(service().storageGet("vocabulary-audio", "word.mp3"))
      .rejects.toMatchObject({ response: { code: "UPSTREAM_UNREACHABLE" } });
  });

  it("maps a response-body timeout instead of letting the DOMException escape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockRejectedValue(new DOMException("slow body", "TimeoutError")),
    }));

    await expect(service().rest("rpc/learning_get_unit_audio_manifest", {
      method: "POST", body: "{}",
    })).rejects.toMatchObject({
      status: 503,
      response: { code: "UPSTREAM_TIMEOUT", retryAfterSeconds: 2 },
    });
  });

  it("resolves a raw signed object path against the Storage API base", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      signedURL: "/object/sign/materials/user/source.txt?token=private",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(service().storageCreateSignedUrl("materials", "user/source.txt", 1_200))
      .resolves.toBe("https://example.supabase.co/storage/v1/object/sign/materials/user/source.txt?token=private");
  });

  it("preserves a fully-qualified signed Storage URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      signedUrl: "http://127.0.0.1:54321/storage/v1/object/sign/materials/source.txt?token=private",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(service().storageCreateSignedUrl("materials", "source.txt"))
      .resolves.toBe("http://127.0.0.1:54321/storage/v1/object/sign/materials/source.txt?token=private");
  });
});
