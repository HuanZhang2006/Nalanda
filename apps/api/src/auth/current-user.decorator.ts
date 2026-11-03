import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "./supabase.guard";

// Extract the current user from a request that passed SupabaseAuthGuard
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
