import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "./supabase.guard";

// 从已通过 SupabaseAuthGuard 的请求中取出当前用户
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
