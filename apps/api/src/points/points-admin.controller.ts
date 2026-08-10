import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { ModeratePointRewardsRequest, ReviewPointAbuseSignalRequest } from "@nalanda/types";
import type { AuthUser } from "../auth/supabase.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase.guard";
import { PointsAdminService } from "./points-admin.service";

@Controller("admin/points")
@UseGuards(SupabaseAuthGuard)
export class PointsAdminController {
  constructor(private readonly points: PointsAdminService) {}

  @Get("abuse-signals")
  list(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.points.listSignals(user.id, status, limit);
  }

  @Patch("abuse-signals/:id")
  review(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: ReviewPointAbuseSignalRequest,
  ) {
    return this.points.reviewSignal(user.id, id, body);
  }

  @Post("moderation-actions")
  moderate(@CurrentUser() user: AuthUser, @Body() body: ModeratePointRewardsRequest) {
    return this.points.moderate(user.id, body);
  }
}
