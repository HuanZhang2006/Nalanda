import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { LearningTranslationTranscriptionResult } from "@nalanda/types";
import { boundedEnvironmentNumber, positiveEnvironmentNumber } from "./environment";
import { FeatureFlagsService } from "./feature-flags.service";
import { LearningService } from "./learning.service";
import { validateAssessmentWav } from "./pronunciation.service";
import { assertUuid } from "./learning.util";

const DEFAULT_MODEL = "fish-audio/transcribe-1";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

function safeUsageNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

@Injectable()
export class OpenRouterTranscriptionService {
  private readonly logger = new Logger(OpenRouterTranscriptionService.name);

  constructor(
    private readonly learning: LearningService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private configuration() {
    const fake = process.env.OPENROUTER_FAKE === "true";
    const key = process.env.OPENROUTER_API_KEY;
    const model = String(process.env.OPENROUTER_STT_MODEL || DEFAULT_MODEL).trim();
    const language = String(process.env.OPENROUTER_STT_LANGUAGE || "zh").trim().toLowerCase();
    const baseUrl = String(process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    let endpoint: URL;
    try { endpoint = new URL(`${baseUrl}/audio/transcriptions`); }
    catch {
      throw new ServiceUnavailableException({
        code: "SERVER_MISCONFIG",
        message: "OpenRouter transcription endpoint is invalid",
      });
    }
    if (endpoint.protocol !== "https:"
        || !model
        || model.length > 160
        || !/^[a-z]{2}(?:-[a-z]{2})?$/.test(language)
        || (!fake && !key)) {
      throw new ServiceUnavailableException({
        code: "SERVER_MISCONFIG",
        message: "OpenRouter translation transcription is not configured",
      });
    }
    return {
      fake,
      key,
      model,
      language,
      endpoint,
      timeoutMs: boundedEnvironmentNumber("OPENROUTER_STT_TIMEOUT_MS", 15_000, 1_000, 30_000),
      minuteLimit: positiveEnvironmentNumber("OPENROUTER_STT_REQUESTS_PER_MINUTE", 20, true),
      dayLimit: positiveEnvironmentNumber("OPENROUTER_STT_REQUESTS_PER_DAY", 300, true),
      monthBudgetMicrousd: positiveEnvironmentNumber(
        "OPENROUTER_STT_MONTHLY_BUDGET_MICRO_USD",
        5_000_000,
        true,
      ),
      microUsdPerSecond: positiveEnvironmentNumber(
        "OPENROUTER_STT_MICRO_USD_PER_SECOND",
        100,
      ),
    };
  }

  private async provider(
    bytes: Buffer,
    config: ReturnType<OpenRouterTranscriptionService["configuration"]>,
  ) {
    if (config.fake) return { text: "语音输入", usageSeconds: 0, costUsd: 0 };
    const origin = process.env.PUBLIC_ORIGIN;
    let response: Response;
    try {
      response = await fetch(config.endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: {
          Authorization: `Bearer ${config.key}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "Nalanda translation voice input",
          ...(origin ? { "HTTP-Referer": origin } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          language: config.language,
          input_audio: {
            data: bytes.toString("base64"),
            format: "wav",
          },
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new GatewayTimeoutException({
          code: "TRANSLATION_STT_PROVIDER_TIMEOUT",
          message: "语音识别服务连接超时",
        });
      }
      throw new BadGatewayException({
        code: "TRANSLATION_STT_PROVIDER_ERROR",
        message: "语音识别服务暂不可用",
      });
    }
    if (response.status === 429) {
      throw new HttpException({
        code: "TRANSLATION_STT_PROVIDER_RATE_LIMIT",
        message: "语音识别服务繁忙，请稍后重试",
      }, 503);
    }
    if (response.status === 402) {
      throw new ServiceUnavailableException({
        code: "TRANSLATION_STT_PROVIDER_CREDIT_REQUIRED",
        message: "语音识别供应商额度不可用",
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: "TRANSLATION_STT_PROVIDER_ERROR",
        message: "语音识别服务暂不可用",
      });
    }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const text = typeof payload?.text === "string"
      ? payload.text.normalize("NFKC").trim()
      : "";
    if (!text || text.length > 500) {
      throw new BadGatewayException({
        code: "TRANSLATION_STT_PROVIDER_INVALID",
        message: "语音识别服务返回了无效结果",
      });
    }
    const usage = payload?.usage && typeof payload.usage === "object"
      ? payload.usage as Record<string, unknown>
      : {};
    return {
      text,
      usageSeconds: safeUsageNumber(usage.seconds),
      costUsd: safeUsageNumber(usage.cost),
    };
  }

  async transcribe(
    userId: string,
    sessionIdInput: string,
    wordIdInput: string,
    expectedRevisionInput: string,
    file?: Express.Multer.File,
  ): Promise<LearningTranslationTranscriptionResult> {
    this.flags.spellingTranslation();
    const sessionId = assertUuid(sessionIdInput, "sessionId");
    const wordId = assertUuid(wordIdInput, "wordId");
    const expectedRevision = Number(expectedRevisionInput);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new BadRequestException({ code: "INVALID_REVISION", message: "会话版本无效" });
    }
    if (!file?.buffer) {
      throw new BadRequestException({ code: "AUDIO_REQUIRED", message: "请上传录音" });
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new BadRequestException({ code: "AUDIO_TOO_LARGE", message: "录音不能超过 2 MB" });
    }
    const { durationSeconds } = validateAssessmentWav(file.buffer);
    const config = this.configuration();
    const reservation = await this.learning.reserveTranslationStt(
      userId,
      sessionId,
      wordId,
      expectedRevision,
      Math.max(1, Math.ceil(durationSeconds * config.microUsdPerSecond)),
      config.minuteLimit,
      config.dayLimit,
      config.monthBudgetMicrousd,
    );
    if (reservation.conflict) {
      throw new HttpException({
        code: "SESSION_REVISION_CONFLICT",
        message: "学习进度已在其它位置更新",
        currentRevision: Number(reservation.current_revision),
      }, 409);
    }
    const startedAt = Date.now();
    const transcription = await this.provider(file.buffer, config);
    this.logger.log(JSON.stringify({
      event: "learning_translation_voice_transcribed",
      durationMs: Date.now() - startedAt,
      audioSeconds: Number(durationSeconds.toFixed(3)),
      provider: config.fake ? "openrouter-fake" : "openrouter",
      model: config.model,
      language: config.language,
      providerSeconds: transcription.usageSeconds,
      providerCostUsd: transcription.costUsd,
    }));
    return {
      text: transcription.text,
      wordId,
      revision: Number(reservation.revision),
      language: config.language,
    };
  }
}
