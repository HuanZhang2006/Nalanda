import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { GeneratedExamV1 } from "@nalanda/types";
import { AiInternalClientService, AiWorkerError } from "./ai-internal-client.service";
import { AiRepository } from "./ai.repository";
import { gradeObjective } from "./exam-grading";

function positiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function usageCost(events: unknown) {
  return Array.isArray(events) ? events.reduce((sum, event) => {
    const cost = event && typeof event === "object" ? Number((event as Record<string, unknown>).costMicroUsd || 0) : 0;
    return sum + (Number.isFinite(cost) && cost > 0 ? cost : 0);
  }, 0) : 0;
}

@Injectable()
export class AiProcessorService {
  private readonly logger = new Logger(AiProcessorService.name);

  constructor(private readonly repository: AiRepository, private readonly worker: AiInternalClientService) {}

  private async budget(kind: "generation" | "grading") {
    const spent = await this.repository.monthlyProviderCostMicroUsd();
    const limit = positiveNumber("MATERIAL_AI_MONTHLY_BUDGET_USD", 20) * 1_000_000;
    const callLimit = positiveNumber(kind === "generation" ? "MATERIAL_AI_GENERATION_MAX_COST_USD" : "MATERIAL_AI_GRADING_MAX_COST_USD", kind === "generation" ? 0.5 : 0.05) * 1_000_000;
    if (spent >= limit) throw new AiWorkerError("AI_MONTHLY_BUDGET_REACHED", "The monthly AI budget is paused");
    return { remaining: limit - spent, callLimit };
  }

  async generation(jobId: string) {
    const leaseToken = randomUUID();
    const job = await this.repository.claimJob(jobId, leaseToken);
    if (!job) return;
    try {
      const budget = await this.budget("generation");
      const material = await this.repository.materialForJob(job);
      if (!material) throw new AiWorkerError("MATERIAL_NOT_FOUND", "The source material was deleted");
      const signedUrl = await this.repository.signMaterial(material.storage_path);
      const cached = await this.repository.cachedDocument(material.id);
      const callbackBase = (process.env.AI_CALLBACK_BASE_URL || "http://api:3000/api").replace(/\/$/, "");
      const result = await this.worker.generate({
        jobId,
        leaseToken,
        userId: job.user_id,
        material: {
          id: material.id,
          name: material.name,
          type: material.type,
          sizeBytes: Number(material.size_bytes || 0),
          signedUrl,
        },
        settings: job.settings,
        cache: cached ? {
          sourceSha256: cached.source_sha256,
          parserVersion: cached.parser_version,
          auditVersion: cached.audit_version,
          visionModel: cached.vision_model,
          document: cached.canonical_document,
        } : null,
        callbackUrl: `${callbackBase}/internal/ai-jobs/${jobId}/progress`,
        callbackToken: process.env.AI_INTERNAL_TOKEN,
      });
      const cost = usageCost(result.usageEvents);
      if (cost > budget.callLimit || cost > budget.remaining) {
        throw new AiWorkerError("AI_COST_LIMIT_EXCEEDED", "The provider cost exceeded the configured safety limit", result.usageEvents || []);
      }
      await this.repository.completeJob(jobId, leaseToken, result);
    } catch (error) {
      const code = error instanceof AiWorkerError ? error.code : "AI_SYSTEM_FAILURE";
      const message = error instanceof Error ? error.message : "AI processing failed";
      const usage = error instanceof AiWorkerError ? error.usageEvents : [];
      this.logger.warn(`Materials AI job ${jobId} failed with ${code}`);
      await this.repository.failJob(jobId, leaseToken, code, message, usage).catch(() => undefined);
    }
  }

  async grading(attemptId: string) {
    const leaseToken = randomUUID();
    const claimed = await this.repository.claimGrading(attemptId, leaseToken);
    if (!claimed) return;
    try {
      const budget = await this.budget("grading");
      const context = await this.repository.attemptContext(attemptId);
      const exam = context.artifact.content as GeneratedExamV1;
      const answerMap = new Map(context.answers.map((answer) => [answer.question_id, answer.answer]));
      const questions = exam.sections.flatMap((section) => section.questions)
        .filter((question) => question.type === "short_answer" || question.type === "essay")
        .map((question) => ({
          id: question.id,
          prompt: question.prompt,
          marks: question.marks,
          modelAnswer: question.modelAnswer,
          rubric: question.rubric,
          learnerAnswer: answerMap.get(question.id) ?? null,
        }));
      const result = await this.worker.grade({ attemptId, questions, language: exam.language });
      const cost = usageCost(result.usageEvents);
      if (cost > budget.callLimit || cost > budget.remaining) {
        throw new AiWorkerError("AI_COST_LIMIT_EXCEEDED", "The grading cost exceeded the configured safety limit", result.usageEvents || []);
      }
      await this.repository.completeGrading(
        attemptId, leaseToken, Number(result.subjectiveScore || 0),
        Array.isArray(result.results) ? result.results : [], Array.isArray(result.usageEvents) ? result.usageEvents : [],
      );
    } catch (error) {
      const code = error instanceof AiWorkerError ? error.code : "AI_GRADING_FAILED";
      this.logger.warn(`Exam grading ${attemptId} failed with ${code}`);
      const usage = error instanceof AiWorkerError ? error.usageEvents : [];
      await this.repository.failGrading(attemptId, leaseToken, usage).catch(() => undefined);
    }
  }

  async timeout(attemptId: string) {
    const context = await this.repository.attemptContext(attemptId).catch(() => null);
    if (!context || context.attempt.status !== "in_progress") return;
    if (new Date(context.attempt.deadline_at).getTime() > Date.now()) return;
    const exam = context.artifact.content as GeneratedExamV1;
    const answers = context.answers.map((row) => ({ questionId: row.question_id, value: row.answer }));
    const objective = gradeObjective(exam, answers);
    const result = await this.repository.submitAttempt(
      context.attempt.user_id, attemptId, randomUUID(), Number(context.attempt.revision),
      objective.results, objective.score, objective.marks, objective.needsGrading,
    ).catch(() => null);
    if (result?.status === "grading") await this.grading(attemptId);
  }

  async progress(jobId: string, leaseToken: string, stage: string, progress: number, eventCode?: string) {
    return this.repository.updateJob(jobId, leaseToken, stage, progress, eventCode);
  }
}
