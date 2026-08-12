import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller";
import { HealthController } from "./health/health.controller";
import { MeController } from "./me/me.controller";
import { ApiErrorFilter } from "./learning/api-error.filter";
import { FeatureFlagsService } from "./learning/feature-flags.service";
import { IpaService } from "./learning/ipa.service";
import { LearningController, PublicLearningController } from "./learning/learning.controller";
import { LearningAudioService } from "./learning/learning-audio.service";
import { LearningService } from "./learning/learning.service";
import { PronunciationController } from "./learning/pronunciation.controller";
import { PronunciationService } from "./learning/pronunciation.service";
import { SupabaseAdminService } from "./learning/supabase-admin.service";
import { OpenRouterTranslationService } from "./learning/openrouter-translation.service";
import { OpenRouterTranscriptionController } from "./learning/openrouter-transcription.controller";
import { OpenRouterTranscriptionService } from "./learning/openrouter-transcription.service";
import { PointsAdminController } from "./points/points-admin.controller";
import { PointAbuseScannerService } from "./points/point-abuse-scanner.service";
import { PointsAdminService } from "./points/points-admin.service";
import { RateLimitInterceptor } from "./rate-limit/rate-limit.interceptor";
import { RateLimitService } from "./rate-limit/rate-limit.service";
import { RedisService } from "./rate-limit/redis.service";
import { AiController, AiGradingInternalController, AiInternalController } from "./ai/ai.controller";
import { AiInternalClientService } from "./ai/ai-internal-client.service";
import { AiProcessorService } from "./ai/ai-processor.service";
import { AiQueueService } from "./ai/ai-queue.service";
import { AiRepository } from "./ai/ai.repository";
import { AiService } from "./ai/ai.service";
import { AiHealthController } from "./ai/ai-health.controller";

@Module({
  controllers: [
    HealthController, MeController, AuthController, LearningController,
    PublicLearningController, PronunciationController, OpenRouterTranscriptionController,
    PointsAdminController, AiController, AiInternalController, AiGradingInternalController, AiHealthController,
  ],
  providers: [
    SupabaseAdminService, IpaService, LearningService, LearningAudioService, PronunciationService,
    OpenRouterTranslationService, OpenRouterTranscriptionService, FeatureFlagsService,
    RedisService, RateLimitService, PointsAdminService, PointAbuseScannerService,
    AiInternalClientService, AiRepository, AiProcessorService, AiQueueService, AiService,
    { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule {}
