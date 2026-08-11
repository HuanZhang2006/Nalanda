import {
  Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UnauthorizedException, UseGuards,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { AuthUser } from "../auth/supabase.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase.guard";
import { AiProcessorService } from "./ai-processor.service";
import { AiService } from "./ai.service";

function internalToken(provided: string | undefined) {
  const expected = process.env.AI_INTERNAL_TOKEN || "";
  const actual = provided || "";
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (!expected || left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new UnauthorizedException({ code: "INVALID_INTERNAL_TOKEN", message: "Invalid AI worker token" });
  }
}

@Controller()
@UseGuards(SupabaseAuthGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post("materials/:id/ai-jobs")
  createJob(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.ai.createJob(user.id, id, body);
  }

  @Get("ai-jobs")
  jobs(@CurrentUser() user: AuthUser, @Query("limit") limit?: string) { return this.ai.listJobs(user.id, limit); }

  @Get("ai-jobs/:id")
  job(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ai.job(user.id, id); }

  @Post("ai-jobs/:id/cancel")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ai.cancel(user.id, id); }

  @Get("profile/ai-quota")
  quota(@CurrentUser() user: AuthUser) { return this.ai.quota(user.id); }

  @Get("notes")
  notes(@CurrentUser() user: AuthUser) { return this.ai.listNotes(user.id); }

  @Get("notes/:id")
  note(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ai.note(user.id, id); }

  @Delete("notes/:id")
  deleteNote(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ai.deleteNote(user.id, id); }

  @Delete("materials/:id")
  deleteMaterial(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("aiResults") results?: string) {
    return this.ai.deleteMaterial(user.id, id, results);
  }

  @Delete("material-courses/:id")
  deleteMaterialCourse(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("aiResults") results?: string) {
    return this.ai.deleteMaterialCourse(user.id, id, results);
  }

  @Post("notes/:id/exam-attempts")
  createAttempt(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ai.createAttempt(user.id, id); }

  @Get("notes/:id/exam-attempts")
  attempts(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ai.attempts(user.id, id); }

  @Get("exam-attempts/:id")
  attempt(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ai.attempt(user.id, id); }

  @Patch("exam-attempts/:id/answers")
  saveAnswers(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.ai.saveAnswers(user.id, id, body);
  }

  @Post("exam-attempts/:id/submit")
  submit(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.ai.submit(user.id, id, body);
  }

  @Post("exam-attempts/:id/grade")
  grade(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.ai.requestGrading(user.id, id, body);
  }
}

@Controller("internal/ai-jobs")
export class AiInternalController {
  constructor(private readonly processor: AiProcessorService) {}

  @Post(":id/progress")
  progress(
    @Headers("x-ai-internal-token") token: string | undefined,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    internalToken(token);
    const leaseToken = String(body.leaseToken || "");
    const stage = String(body.stage || "");
    const progress = Number(body.progress);
    if (!leaseToken || !Number.isInteger(progress)) throw new UnauthorizedException({ code: "INVALID_PROGRESS", message: "Invalid progress update" });
    return this.processor.progress(id, leaseToken, stage, progress, typeof body.eventCode === "string" ? body.eventCode : undefined);
  }
}
