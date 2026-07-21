import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller";
import { HealthController } from "./health/health.controller";
import { MeController } from "./me/me.controller";
import { ApiErrorFilter } from "./learning/api-error.filter";
import { FeatureFlagsService } from "./learning/feature-flags.service";
import { IpaService } from "./learning/ipa.service";
import { LearningController, PublicLearningController } from "./learning/learning.controller";
import { LearningService } from "./learning/learning.service";
import { PronunciationController } from "./learning/pronunciation.controller";
import { PronunciationService } from "./learning/pronunciation.service";
import { SupabaseAdminService } from "./learning/supabase-admin.service";

@Module({
  controllers: [HealthController, MeController, AuthController, LearningController, PublicLearningController, PronunciationController],
  providers: [
    SupabaseAdminService, IpaService, LearningService, PronunciationService, FeatureFlagsService,
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule {}
