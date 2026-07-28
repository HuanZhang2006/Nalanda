import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards,
} from "@nestjs/common";
import type { AuthUser } from "../auth/supabase.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase.guard";
import { FeatureFlagsService } from "./feature-flags.service";
import {
  CreateCourseReportDto,
  CreateCourseShareDto,
  CreateReviewSchedulesDto,
  LearningAttemptDto,
  LearningCourseDto,
  LearningSpellingTranslationAssessmentDto,
  ModerateCoursePublicationDto,
  PublishLearningCourseDto,
  RenameLearningCourseDto,
  StartLearningSessionDto,
} from "./learning.dto";
import { LearningService } from "./learning.service";
import { LearningAudioService } from "./learning-audio.service";
import { OpenRouterTranslationService } from "./openrouter-translation.service";

@Controller()
@UseGuards(SupabaseAuthGuard)
export class LearningController {
  constructor(
    private readonly learning: LearningService,
    private readonly flags: FeatureFlagsService,
    private readonly learningAudio: LearningAudioService,
    private readonly translationAssessment: OpenRouterTranslationService,
  ) {}

  @Get("learning-courses")
  list(@CurrentUser() user: AuthUser) { this.flags.courses(); return this.learning.listCourses(user.id); }

  @Post("learning-courses")
  create(@CurrentUser() user: AuthUser, @Body() body: LearningCourseDto) { this.flags.courses(); return this.learning.saveCourse(user.id, body); }

  @Get("learning-courses/:id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) { this.flags.courses(); return this.learning.getCourse(user.id, id); }

  @Put("learning-courses/:id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: LearningCourseDto) {
    this.flags.courses(); return this.learning.saveCourse(user.id, { ...body, id });
  }

  @Patch("learning-courses/:id")
  rename(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: RenameLearningCourseDto) {
    this.flags.courses(); return this.learning.renameCourse(user.id, id, body?.title);
  }

  @Delete("learning-courses/:id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) { this.flags.courses(); return this.learning.deleteCourse(user.id, id); }

  @Post("learning-courses/:id/sessions")
  async start(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: StartLearningSessionDto) {
    this.flags.courses();
    if (body?.spellingOptions?.translationFirst) this.flags.spellingTranslation();
    const session = await this.learning.startSession(user.id, id, body);
    if (session.unitId && this.flags.audioPrewarmEnabled()) {
      void this.learningAudio.prepareUnit(user.id, session.unitId, 50).catch(() => undefined);
    }
    return session;
  }

  @Get("learning-sessions/:id")
  async session(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    this.flags.courses();
    const session = await this.learning.getSession(user.id, id);
    if (session.unitId && this.flags.audioPrewarmEnabled()) {
      void this.learningAudio.prepareUnit(user.id, session.unitId, 50).catch(() => undefined);
    }
    return session;
  }

  @Post("learning-sessions/:id/recognition")
  recognition(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body("wordId") wordId: string) {
    this.flags.courses(); return this.learning.markRecognition(user.id, id, wordId);
  }

  @Post("learning-sessions/:id/attempts")
  attempt(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: LearningAttemptDto) {
    this.flags.courses(); return this.learning.recordAttempt(user.id, id, body);
  }

  @Post("learning-sessions/:id/spelling-translation-assessments")
  assessSpellingTranslation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: LearningSpellingTranslationAssessmentDto,
  ) {
    return this.translationAssessment.assess(user.id, id, body);
  }

  @Get("learning-review-schedules")
  schedules(@CurrentUser() user: AuthUser) { this.flags.courses(); return this.learning.listReviewSchedules(user.id); }

  @Post("learning-units/:id/review-schedules")
  schedule(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: CreateReviewSchedulesDto) {
    this.flags.courses(); return this.learning.createReviewSchedules(user.id, id, body?.sourceSessionId, body?.offsets);
  }

  @Post("learning-units/:id/audio-prewarm")
  prewarmAudio(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.learningAudio.prepareUnit(user.id, id, 80);
  }

  @Get("learning-units/:id/audio-manifest")
  audioManifest(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.learningAudio.manifest(user.id, id);
  }

  @Delete("learning-review-schedules/:id")
  cancelSchedule(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    this.flags.courses(); return this.learning.cancelReviewSchedule(user.id, id);
  }

  @Get("profile/learning-summary")
  profile(@CurrentUser() user: AuthUser) { this.flags.courses(); return this.learning.profileSummary(user.id); }

  @Post("course-shares")
  share(@CurrentUser() user: AuthUser, @Body() body: CreateCourseShareDto) {
    this.flags.shares(); return this.learning.createShare(user.id, body?.courseId);
  }

  @Get("course-shares")
  shares(@CurrentUser() user: AuthUser, @Query("courseId") courseId: string) {
    this.flags.shares(); return this.learning.listShares(user.id, courseId);
  }

  @Delete("course-shares/:id")
  revokeShare(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    this.flags.shares(); return this.learning.revokeShare(user.id, id);
  }

  @Post("learning-courses/:id/publications")
  publish(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: PublishLearningCourseDto) {
    this.flags.market(); return this.learning.publish(user.id, id, body);
  }

  @Post("course-publications/:id/clone")
  clonePublication(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    this.flags.market(); return this.learning.clonePublication(user.id, id);
  }

  @Post("course-reports")
  report(@CurrentUser() user: AuthUser, @Body() body: CreateCourseReportDto) {
    this.flags.market(); return this.learning.report(user.id, body);
  }

  @Patch("course-publications/:id/moderation")
  moderate(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: ModerateCoursePublicationDto) {
    this.flags.market(); return this.learning.moderate(user.id, id, body);
  }
}

@Controller()
export class PublicLearningController {
  constructor(private readonly learning: LearningService, private readonly flags: FeatureFlagsService) {}

  @Get("public/course-shares/:token")
  share(@Param("token") token: string) { this.flags.shares(); return this.learning.publicShare(token); }

  @Post("course-shares/:token/clone")
  @UseGuards(SupabaseAuthGuard)
  cloneShare(@CurrentUser() user: AuthUser, @Param("token") token: string) {
    this.flags.shares(); return this.learning.cloneShare(user.id, token);
  }

  @Get("course-market")
  market() { this.flags.market(); return this.learning.market(); }
}
