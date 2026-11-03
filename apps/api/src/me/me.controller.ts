import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard, type AuthUser } from "../auth/supabase.guard";

// GET /api/me — protected endpoint; proves the backend trusts the Supabase session
@Controller("me")
@UseGuards(SupabaseAuthGuard)
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
