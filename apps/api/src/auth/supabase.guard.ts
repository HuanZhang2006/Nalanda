import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { jwtVerify } from "jose";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

// 校验 Supabase 签发的登录令牌（HS256 + 项目 JWT Secret）。
// 若项目改用新的非对称签名密钥，改为 JWKS 验证即可（见 README）。
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers["authorization"] || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException("Missing bearer token");

    const secretStr = process.env.SUPABASE_JWT_SECRET;
    if (!secretStr) {
      throw new UnauthorizedException("SUPABASE_JWT_SECRET not configured");
    }

    try {
      const secret = new TextEncoder().encode(secretStr);
      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      req.user = {
        id: payload.sub as string,
        email: payload.email as string | undefined,
        role: payload.role as string | undefined,
      } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }
}
