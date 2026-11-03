import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

// Newer Supabase projects sign user tokens with asymmetric keys (ES256/RS256) — verify them through the project JWKS;
// legacy HS256 with the project JWT secret is the fallback.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function getJwks() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!jwks && url) {
    jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

export async function verifySupabaseHs256(token: string, secretValue: string, issuer?: string) {
  const secret = new TextEncoder().encode(secretValue);
  return jwtVerify(token, secret, {
    algorithms: ["HS256"],
    audience: "authenticated",
    ...(issuer ? { issuer } : {}),
  });
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers["authorization"] || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException("Missing bearer token");

    const issuer = process.env.SUPABASE_URL
      ? `${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`
      : undefined;
    let payload: JWTPayload | undefined;

    // 1) Asymmetric signature → JWKS
    const set = getJwks();
    if (set) {
      try {
        ({ payload } = await jwtVerify(token, set, {
          issuer, audience: "authenticated", algorithms: ["ES256", "RS256"],
        }));
      } catch {
        /* fall through to the HS256 fallback */
      }
    }
    // 2) Fallback: legacy HS256 + JWT secret
    if (!payload && process.env.SUPABASE_JWT_SECRET) {
      try {
        ({ payload } = await verifySupabaseHs256(token, process.env.SUPABASE_JWT_SECRET, issuer));
      } catch {
        /* noop */
      }
    }

    const id = payload?.sub;
    if (!id || !USER_ID.test(id) || payload?.role !== "authenticated") {
      throw new UnauthorizedException("Invalid token");
    }

    req.user = {
      id,
      email: payload!.email as string | undefined,
      role: payload!.role as string | undefined,
    } satisfies AuthUser;
    return true;
  }
}
