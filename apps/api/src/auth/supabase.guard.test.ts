import { afterEach, describe, expect, it } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { SignJWT } from "jose";
import { SupabaseAuthGuard, verifySupabaseHs256 } from "./supabase.guard";

const secret = "local-test-secret-with-at-least-32-characters";
const issuer = "https://project.supabase.co/auth/v1";

async function token(claims: { issuer?: string; audience?: string } = {}) {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("11111111-1111-4111-8111-111111111111")
    .setIssuer(claims.issuer || issuer)
    .setAudience(claims.audience || "authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
}

afterEach(() => {
  delete process.env.SUPABASE_JWT_SECRET;
});

describe("SupabaseAuthGuard", () => {
  it("rejects protected learning endpoints without a bearer token", async () => {
    const request = { headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    await expect(new SupabaseAuthGuard().canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("accepts a valid legacy token and rejects wrong issuer or audience claims", async () => {
    await expect(verifySupabaseHs256(await token(), secret, issuer)).resolves.toHaveProperty(
      "payload.sub", "11111111-1111-4111-8111-111111111111",
    );
    await expect(verifySupabaseHs256(await token({ issuer: "https://attacker.invalid/auth/v1" }), secret, issuer)).rejects.toThrow();
    await expect(verifySupabaseHs256(await token({ audience: "service_role" }), secret, issuer)).rejects.toThrow();
  });

  it("hydrates only an authenticated UUID user from the verified claims", async () => {
    const previousUrl = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL; process.env.SUPABASE_JWT_SECRET = secret;
    const request: any = { headers: { authorization: `Bearer ${await token()}` } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    try {
      await expect(new SupabaseAuthGuard().canActivate(context)).resolves.toBe(true);
      expect(request.user).toMatchObject({ id: "11111111-1111-4111-8111-111111111111", role: "authenticated" });
      const anon = await new SignJWT({ role: "anon" }).setProtectedHeader({ alg: "HS256" })
        .setSubject("11111111-1111-4111-8111-111111111111").setIssuer(issuer).setAudience("authenticated")
        .setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(secret));
      request.headers.authorization = `Bearer ${anon}`;
      await expect(new SupabaseAuthGuard().canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    } finally {
      if (previousUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    }
  });
});
