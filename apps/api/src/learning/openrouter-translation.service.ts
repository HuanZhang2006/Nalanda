import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type {
  LearningSpellingTranslationAssessmentRequest,
  LearningSpellingTranslationAssessmentResult,
} from "@nalanda/types";
import { boundedEnvironmentNumber, positiveEnvironmentNumber } from "./environment";
import { FeatureFlagsService } from "./feature-flags.service";
import { LearningService } from "./learning.service";
import { assertUuid } from "./learning.util";

const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

type ProviderDecision = {
  correct: boolean;
  feedback: string;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
};

function normalized(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}
function safeTokenCount(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parseDecision(payload: unknown): ProviderDecision {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const content = root.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : "";
  let decision: unknown;
  try { decision = JSON.parse(text); }
  catch {
    throw new BadGatewayException({
      code: "TRANSLATION_PROVIDER_INVALID",
      message: "翻译判分服务返回了无效结果",
    });
  }
  const value = decision && typeof decision === "object"
    ? decision as Record<string, unknown>
    : {};
  if (typeof value.correct !== "boolean"
      || typeof value.feedback !== "string"
      || !value.feedback.trim()
      || value.feedback.trim().length > 240) {
    throw new BadGatewayException({
      code: "TRANSLATION_PROVIDER_INVALID",
      message: "翻译判分服务返回了无效结果",
    });
  }
  return {
    correct: value.correct,
    feedback: value.feedback.trim(),
    usage: {
      promptTokens: safeTokenCount(root.usage?.prompt_tokens),
      completionTokens: safeTokenCount(root.usage?.completion_tokens),
      totalTokens: safeTokenCount(root.usage?.total_tokens),
    },
  };
}

@Injectable()
export class OpenRouterTranslationService {
  private readonly logger = new Logger(OpenRouterTranslationService.name);

  constructor(
    private readonly learning: LearningService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private configuration() {
    const fake = process.env.OPENROUTER_FAKE === "true";
    const key = process.env.OPENROUTER_API_KEY;
    const model = String(process.env.OPENROUTER_MODEL || DEFAULT_MODEL).trim();
    const baseUrl = String(process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    let endpoint: URL;
    try { endpoint = new URL(`${baseUrl}/chat/completions`); }
    catch {
      throw new ServiceUnavailableException({
        code: "SERVER_MISCONFIG",
        message: "OpenRouter endpoint is invalid",
      });
    }
    if (endpoint.protocol !== "https:" || !model || model.length > 160 || (!fake && !key)) {
      throw new ServiceUnavailableException({
        code: "SERVER_MISCONFIG",
        message: "OpenRouter translation assessment is not configured",
      });
    }
    return {
      fake,
      key,
      model,
      endpoint,
      timeoutMs: boundedEnvironmentNumber("OPENROUTER_TIMEOUT_MS", 12_000, 1_000, 30_000),
      minuteLimit: positiveEnvironmentNumber("OPENROUTER_ASSESSMENTS_PER_MINUTE", 20, true),
      dayLimit: positiveEnvironmentNumber("OPENROUTER_ASSESSMENTS_PER_DAY", 200, true),
    };
  }

  private async provider(
    term: string,
    translations: string[],
    answer: string,
    config: ReturnType<OpenRouterTranslationService["configuration"]>,
  ): Promise<ProviderDecision> {
    if (config.fake) {
      const correct = translations.some((translation) => normalized(translation) === normalized(answer));
      return {
        correct,
        feedback: correct ? "The meaning matches an accepted translation." : "The meaning does not match the accepted translations.",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    const origin = process.env.PUBLIC_ORIGIN;
    let response: Response;
    try {
      response = await fetch(config.endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: {
          Authorization: `Bearer ${config.key}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "Nalanda spelling translation assessment",
          ...(origin ? { "HTTP-Referer": origin } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          max_tokens: 120,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "translation_judgment",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  correct: { type: "boolean" },
                  feedback: { type: "string", maxLength: 240 },
                },
                required: ["correct", "feedback"],
              },
            },
          },
          messages: [
            {
              role: "system",
              content: [
                "Judge whether a learner's translation expresses at least one accepted meaning of the English term.",
                "Accept synonyms, paraphrases, different word order, and harmless grammatical variation.",
                "Reject unrelated, opposite, materially incomplete, or empty meanings.",
                "Use only the supplied term and accepted translations.",
                "Return concise JSON feedback without repeating the learner's full answer.",
              ].join(" "),
            },
            {
              role: "user",
              content: JSON.stringify({
                englishTerm: term,
                acceptedTranslations: translations,
                learnerTranslation: answer,
              }),
            },
          ],
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new GatewayTimeoutException({
          code: "TRANSLATION_PROVIDER_TIMEOUT",
          message: "翻译判分服务连接超时",
        });
      }
      throw new BadGatewayException({
        code: "TRANSLATION_PROVIDER_ERROR",
        message: "翻译判分服务暂不可用",
      });
    }
    if (response.status === 429) {
      throw new HttpException({
        code: "TRANSLATION_PROVIDER_RATE_LIMIT",
        message: "翻译判分服务繁忙，请稍后重试",
      }, 503);
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: "TRANSLATION_PROVIDER_ERROR",
        message: "翻译判分服务暂不可用",
      });
    }
    return parseDecision(await response.json().catch(() => null));
  }

  async assess(
    userId: string,
    sessionId: string,
    body: LearningSpellingTranslationAssessmentRequest,
  ): Promise<LearningSpellingTranslationAssessmentResult> {
    this.flags.spellingTranslation();
    assertUuid(sessionId, "sessionId");
    const wordId = assertUuid(String(body?.wordId || ""), "wordId");
    const attemptId = assertUuid(String(body?.attemptId || ""), "attemptId");
    if (!Number.isSafeInteger(body?.expectedRevision) || body.expectedRevision < 0) {
      throw new BadRequestException({ code: "INVALID_REVISION", message: "会话版本无效" });
    }
    const answer = typeof body?.answer === "string" ? body.answer.normalize("NFKC").trim() : "";
    if (!answer || answer.length > 500) {
      throw new BadRequestException({
        code: "INVALID_TRANSLATION_ANSWER",
        message: "翻译答案需为 1–500 个字符",
      });
    }
    const config = this.configuration();
    const answerHash = createHash("sha256").update(answer).digest("hex");
    const leaseToken = randomUUID();
    const claim = await this.learning.claimSpellingTranslationAssessment(
      userId,
      sessionId,
      wordId,
      attemptId,
      body.expectedRevision,
      answerHash,
      leaseToken,
      Math.ceil(config.timeoutMs / 1_000) + 10,
      config.minuteLimit,
      config.dayLimit,
    );
    if (claim.conflict) {
      throw new HttpException({
        code: "SESSION_REVISION_CONFLICT",
        message: "学习进度已在其它位置更新",
        currentRevision: Number(claim.current_revision),
      }, 409);
    }
    if (claim.replayed) {
      return this.learning.spellingTranslationAssessmentResult(claim.response_payload);
    }
    if (claim.pending) {
      throw new HttpException({
        code: "TRANSLATION_ASSESSMENT_PENDING",
        message: "翻译判分仍在处理中，请稍后重试",
      }, 425);
    }
    const startedAt = Date.now();
    let decision: ProviderDecision;
    try {
      decision = await this.provider(
        String(claim.term),
        Array.isArray(claim.translations) ? claim.translations.map(String) : [],
        answer,
        config,
      );
    } catch (error) {
      const code = error instanceof HttpException
        ? String((error.getResponse() as Record<string, unknown>)?.code || "TRANSLATION_PROVIDER_ERROR")
        : "TRANSLATION_PROVIDER_ERROR";
      await this.learning.releaseSpellingTranslationAssessment(
        userId,
        attemptId,
        leaseToken,
        code,
      ).catch(() => false);
      throw error;
    }
    const result = await this.learning.completeSpellingTranslationAssessment(
      userId,
      sessionId,
      wordId,
      attemptId,
      body.expectedRevision,
      answerHash,
      leaseToken,
      {
        ...decision,
        provider: config.fake ? "openrouter-fake" : "openrouter",
        model: config.model,
      },
    );
    this.logger.log(JSON.stringify({
      event: "learning_spelling_translation_assessed",
      durationMs: Date.now() - startedAt,
      provider: config.fake ? "openrouter-fake" : "openrouter",
      model: config.model,
      correct: result.correct,
      replayed: result.replayed,
      promptTokens: decision.usage.promptTokens,
      completionTokens: decision.usage.completionTokens,
    }));
    return result;
  }
}
