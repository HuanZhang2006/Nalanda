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

const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
// The free model is served by a single first-party endpoint. Pin it so a
// response can never come from an unreviewed provider.
const PROVIDER_SLUG = "nvidia";
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

const DEFAULT_FEEDBACK = {
  correct: "The meaning matches an accepted translation.",
  incorrect: "The meaning does not match the accepted translations.",
} as const;
const EXACT_MATCH_PROVIDER = "nalanda-normalized-exact";
const EXACT_MATCH_MODEL = "normalized-exact-v1";

function normalized(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}
function safeTokenCount(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parseDecision(payload: unknown): ProviderDecision {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  if (typeof root.provider !== "string" || root.provider.toLocaleLowerCase() !== PROVIDER_SLUG) {
    throw new BadGatewayException({
      code: "TRANSLATION_PROVIDER_INVALID",
      message: "The translation checker did not use the required provider.",
    });
  }
  const message = root.choices?.[0]?.message;
  const content = message?.content;
  const parsedMessage = message?.parsed;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => typeof part?.text === "string" ? part.text : "").join("")
      : "";
  let decision: unknown;
  if (parsedMessage && typeof parsedMessage === "object") {
    decision = parsedMessage;
  } else if (content && typeof content === "object" && !Array.isArray(content)) {
    decision = content;
  } else {
    try {
      decision = JSON.parse(
        text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
      );
    } catch {
      throw new BadGatewayException({
        code: "TRANSLATION_PROVIDER_INVALID",
        message: "The translation checker returned an invalid result.",
      });
    }
  }
  const value = decision && typeof decision === "object"
    ? decision as Record<string, unknown>
    : {};
  if (
    typeof value.correct !== "boolean"
    || Object.keys(value).length !== 1
    || !("correct" in value)
  ) {
    throw new BadGatewayException({
      code: "TRANSLATION_PROVIDER_INVALID",
      message: "The translation checker returned an invalid result.",
    });
  }
  const fallbackFeedback = value.correct ? DEFAULT_FEEDBACK.correct : DEFAULT_FEEDBACK.incorrect;
  const providerFeedback = typeof value.feedback === "string" ? value.feedback.trim() : "";
  const feedback = (providerFeedback || fallbackFeedback).slice(0, 240).trim()
    || fallbackFeedback;
  return {
    correct: value.correct,
    feedback,
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
      dayLimit: positiveEnvironmentNumber("OPENROUTER_ASSESSMENTS_PER_DAY", 500, true),
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
    const requestBody = JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 512,
      // A one-field boolean judgment needs no chain of thought; disabling it
      // keeps latency inside the interactive timeout.
      reasoning: { enabled: false },
      tool_choice: "none",
      provider: {
        only: [PROVIDER_SLUG],
        allow_fallbacks: false,
        require_parameters: true,
      },
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: [
            "Judge whether a learner's translation expresses at least one accepted meaning of the English term.",
            "Accept synonyms, paraphrases, different word order, and harmless grammatical variation.",
            "Reject unrelated, opposite, materially incomplete, or empty meanings.",
            "Use only the supplied term and accepted translations.",
            "Return exactly one JSON object with no markdown and no additional fields: {\"correct\":boolean}.",
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
    });
    const deadline = Date.now() + config.timeoutMs;
    let firstInvalid: HttpException | null = null;
    for (let providerAttempt = 1; providerAttempt <= 2; providerAttempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < 1_000 && firstInvalid) throw firstInvalid;
      let response: Response;
      try {
        response = await fetch(config.endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(Math.max(1, remainingMs)),
          headers: {
            Authorization: `Bearer ${config.key}`,
            "Content-Type": "application/json",
            "X-OpenRouter-Title": "Nalanda spelling translation assessment",
            ...(origin ? { "HTTP-Referer": origin } : {}),
          },
          body: requestBody,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new GatewayTimeoutException({
            code: "TRANSLATION_PROVIDER_TIMEOUT",
            message: "The translation checker timed out.",
          });
        }
        throw new BadGatewayException({
          code: "TRANSLATION_PROVIDER_ERROR",
          message: "The translation checker is temporarily unavailable.",
        });
      }
      if (response.status === 429) {
        throw new HttpException({
          code: "TRANSLATION_PROVIDER_RATE_LIMIT",
          message: "The translation checker is busy. Please try again shortly.",
        }, 503);
      }
      if (!response.ok) {
        const requestId = response.headers.get("request-id")
          || response.headers.get("x-request-id")
          || null;
        const upstreamCode = await response.text().then((raw) => {
          try {
            const parsed = JSON.parse(raw) as Record<string, any>;
            const candidate = parsed?.error?.code ?? parsed?.code;
            return typeof candidate === "string" || typeof candidate === "number"
              ? String(candidate).slice(0, 80)
              : null;
          } catch {
            return null;
          }
        }).catch(() => null);
        this.logger.warn(JSON.stringify({
          event: "learning_spelling_translation_provider_http_error",
          provider: "openrouter",
          model: config.model,
          status: response.status,
          upstreamCode,
          requestId,
        }));
        throw new BadGatewayException({
          code: "TRANSLATION_PROVIDER_ERROR",
          message: "The translation checker is temporarily unavailable.",
        });
      }
      try {
        return parseDecision(await response.json().catch(() => null));
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const code = String(
          (error.getResponse() as Record<string, unknown>)?.code || "",
        );
        if (code !== "TRANSLATION_PROVIDER_INVALID" || providerAttempt === 2) throw error;
        firstInvalid = error;
        this.logger.warn(JSON.stringify({
          event: "learning_spelling_translation_provider_retry",
          provider: "openrouter",
          model: config.model,
          reason: code,
        }));
      }
    }
    throw firstInvalid ?? new BadGatewayException({
      code: "TRANSLATION_PROVIDER_INVALID",
      message: "The translation checker returned an invalid result.",
    });
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
      throw new BadRequestException({ code: "INVALID_REVISION", message: "The learning-session version is invalid." });
    }
    const answer = typeof body?.answer === "string" ? body.answer.normalize("NFKC").trim() : "";
    if (!answer || answer.length > 500) {
      throw new BadRequestException({
        code: "INVALID_TRANSLATION_ANSWER",
        message: "Enter a translation between 1 and 500 characters.",
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
    );
    if (claim.conflict) {
      throw new HttpException({
        code: "SESSION_REVISION_CONFLICT",
        message: "Learning progress was updated elsewhere.",
        currentRevision: Number(claim.current_revision),
      }, 409);
    }
    if (claim.replayed) {
      return {
        ...this.learning.spellingTranslationAssessmentResult(claim.response_payload),
        replayed: true,
      };
    }
    if (claim.pending) {
      throw new HttpException({
        code: "TRANSLATION_ASSESSMENT_PENDING",
        message: "The translation is still being checked. Please retry in a moment.",
      }, 425);
    }
    const startedAt = Date.now();
    const translations = Array.isArray(claim.translations)
      ? claim.translations.map(String)
      : [];
    const exactMatch = translations.some(
      (translation) => normalized(translation) === normalized(answer),
    );
    let decision: ProviderDecision;
    if (exactMatch) {
      decision = {
        correct: true,
        feedback: DEFAULT_FEEDBACK.correct,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    } else {
      try {
        if (!config.fake) {
          await this.learning.reserveSpellingTranslationQuota(
            userId,
            attemptId,
            leaseToken,
            config.minuteLimit,
            config.dayLimit,
          );
        }
        decision = await this.provider(
          String(claim.term),
          translations,
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
    }
    const provider = exactMatch
      ? EXACT_MATCH_PROVIDER
      : config.fake ? "openrouter-fake" : "openrouter";
    const model = exactMatch ? EXACT_MATCH_MODEL : config.model;
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
        provider,
        model,
      },
    );
    this.logger.log(JSON.stringify({
      event: "learning_spelling_translation_assessed",
      durationMs: Date.now() - startedAt,
      provider,
      model,
      correct: result.correct,
      replayed: result.replayed,
      promptTokens: decision.usage.promptTokens,
      completionTokens: decision.usage.completionTokens,
    }));
    return result;
  }
}
