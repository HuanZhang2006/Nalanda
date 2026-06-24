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

// 新版 Supabase 用非对称密钥（ES256/RS256）签发用户令牌 —— 走项目 JWKS 验证；
// 旧版 HS256 + 项目 JWT secret 作为回退。
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  const url = process.env.SUPABASE_URL;
  if (!jwks && url) {
    jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers["authorization"] || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException("Missing bearer token");

    const issuer = process.env.SUPABASE_URL
      ? `${process.env.SUPABASE_URL}/auth/v1`
      : undefined;
    let payload: JWTPayload | undefined;

    // 1) 非对称签名 → JWKS
    const set = getJwks();
    if (set) {
      try {
        ({ payload } = await jwtVerify(token, set, { issuer, audience: "authenticated" }));
      } catch {
        /* 落到 HS256 回退 */
      }
    }
    // 2) 回退：旧版 HS256 + JWT secret
    if (!payload && process.env.SUPABASE_JWT_SECRET) {
      try {
        const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
        ({ payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] }));
      } catch {
        /* noop */
      }
    }

    const id = payload?.sub;
    if (!id) throw new UnauthorizedException("Invalid token");

    req.user = {
      id,
      email: payload!.email as string | undefined,
      role: payload!.role as string | undefined,
    } satisfies AuthUser;
    return true;
  }
}
