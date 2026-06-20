import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard, type AuthUser } from "../auth/supabase.guard";

// GET /api/me —— 受保护接口；证明后端信任 Supabase 登录态
@Controller("me")
@UseGuards(SupabaseAuthGuard)
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
