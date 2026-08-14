import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { GeneratedExamV1 } from "@nalanda/types";
import { SupabaseRequestError } from "../learning/supabase-admin.service";
import { AiInternalClientService, AiWorkerError } from "./ai-internal-client.service";
import { AiRepository, type DbRow } from "./ai.repository";
import { gradeObjective } from "./exam-grading";

function positiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const RETRYABLE_CODES = new Set([
  "AI_WORKER_TIMEOUT",
  "AI_WORKER_UNREACHABLE",
  "AI_CALLBACK_UNAVAILABLE",
  "AI_TEMP_DISK_PRESSURE",
  "OPENROUTER_UNREACHABLE",
  "OPENROUTER_RATE_LIMIT",
  "OPENROUTER_FAILED",
  "OPENROUTER_ZDR_UNAVAILABLE",
]);

function databaseResultContractRejected(error: unknown) {
  if (!(error instanceof SupabaseRequestError) || !error.body || typeof error.body !== "object") {
    return false;
  }
  const code = "code" in error.body ? String((error.body as { code: unknown }).code) : "";
  return code === "22023" || code === "23514";
}

function databaseErrorMessage(error: unknown) {
  if (!(error instanceof SupabaseRequestError) || !error.body || typeof error.body !== "object") {
    return "";
  }
  return "message" in error.body ? String((error.body as { message: unknown }).message) : "";
}

function databaseLeaseRejected(error: unknown) {
  return /(?:JOB|GRADING)_LEASE_LOST|(?:JOB|EXAM_ATTEMPT)_NOT_FOUND/.test(
    databaseErrorMessage(error),
  );
}

function databaseRoutingRejected(error: unknown) {
  return databaseErrorMessage(error).includes("AI_PROVIDER_ROUTING_VIOLATION");
}

@Injectable()
export class AiProcessorService {
  private readonly logger = new Logger(AiProcessorService.name);

  constructor(private readonly repository: AiRepository, private readonly worker: AiInternalClientService) {}

  private async settleMaterialCompletionRejection(
    jobId: string,
    leaseToken: string,
    kind: unknown,
    error: unknown,
  ) {
    if (databaseLeaseRejected(error)) {
      throw new ConflictException({ code: "JOB_CANCELLED", message: "The AI job lease is no longer active" });
    }
    const code = databaseRoutingRejected(error)
      ? "AI_PROVIDER_ROUTING_VIOLATION"
      : databaseResultContractRejected(error)
        ? kind === "knowledge_graph"
          ? "AI_KNOWLEDGE_GRAPH_VALIDATION_FAILED"
          : kind === "knowledge_question"
            ? "AI_KNOWLEDGE_ANSWER_VALIDATION_FAILED"
            : "AI_EXAM_VALIDATION_FAILED"
        : null;
    if (!code) throw error;
    this.logger.warn(JSON.stringify({ event: "ai_result_contract_rejected", jobId, code }));
    await this.repository.failJob(
      jobId,
      leaseToken,
      code,
      code === "AI_PROVIDER_ROUTING_VIOLATION"
        ? "The provider route did not satisfy the locked AI policy"
        : "The generated result did not pass the storage contract",
      false,
    );
    return { completed: false, failed: true } as const;
  }

  private async budget(kind: "generation" | "grading", alreadySpentMicroUsd = 0) {
    const spent = await this.repository.monthlyProviderCostMicroUsd();
    const limit = positiveNumber("MATERIAL_AI_MONTHLY_BUDGET_USD", 20) * 1_000_000;
    const callLimit = positiveNumber(kind === "generation" ? "MATERIAL_AI_GENERATION_MAX_COST_USD" : "MATERIAL_AI_GRADING_MAX_COST_USD", kind === "generation" ? 0.5 : 0.05) * 1_000_000;
    if (spent >= limit) throw new AiWorkerError("AI_MONTHLY_BUDGET_REACHED", "The monthly AI budget is paused");
    const available = Math.floor(Math.min(limit - spent, callLimit - Math.max(0, alreadySpentMicroUsd)));
    if (available <= 0) {
      throw new AiWorkerError("AI_COST_LIMIT_EXCEEDED", "The configured per-job AI cost limit was reached");
    }
    return available;
  }

  private callbackBase(jobId: string) {
    return `${(process.env.AI_CALLBACK_BASE_URL || "http://api:3000/api").replace(/\/$/, "")}/internal/ai-jobs/${jobId}`;
  }

  private callbacks(jobId: string, leaseToken: string) {
    return {
      baseUrl: this.callbackBase(jobId),
      token: process.env.AI_INTERNAL_TOKEN,
      leaseToken,
    };
  }

  async generation(jobId: string) {
    const leaseToken = randomUUID();
    const job = await this.repository.claimJob(jobId, leaseToken);
    if (!job) return;
    try {
      const alreadySpent = await this.repository.jobProviderCostMicroUsd(jobId);
      const budgetMicroUsd = await this.budget("generation", alreadySpent);
      const checkpoint = await this.repository.checkpointForJob(jobId);
      let payload: Record<string, unknown>;
      if (job.kind === "knowledge_question") {
        const context = await this.repository.knowledgeQuestionContext(job);
        const sourceMaterial = job.pipeline === "luna_native_file_v1" && context.source.material_id
          ? await this.repository.materialById(job.user_id, context.source.material_id)
          : null;
        payload = {
          jobId,
          kind: job.kind,
          pipeline: job.pipeline || "document_ir_v1",
          userId: job.user_id,
          question: context.question.question,
          nodeId: context.question.node_id,
          graph: context.artifact.content,
          document: job.pipeline === "document_ir_v1" ? context.cache?.canonical_document || null : null,
          material: sourceMaterial ? {
            id: sourceMaterial.id,
            name: sourceMaterial.name,
            type: sourceMaterial.type,
            sizeBytes: Number(sourceMaterial.size_bytes || 0),
            signedUrl: await this.repository.signMaterial(sourceMaterial.storage_path),
          } : null,
          callbacks: this.callbacks(jobId, leaseToken),
          checkpoint: checkpoint ? { checkpointStage: checkpoint.stage, ...checkpoint.payload } : null,
          budgetMicroUsd,
        };
      } else {
        const material = await this.repository.materialForJob(job);
        if (!material) throw new AiWorkerError("MATERIAL_NOT_FOUND", "The source material was deleted");
        const signedUrl = await this.repository.signMaterial(material.storage_path);
        const cached = await this.repository.cachedDocument(material.id);
        payload = {
          jobId,
          kind: job.kind,
          pipeline: job.pipeline || "document_ir_v1",
          userId: job.user_id,
          material: {
            id: material.id,
            name: material.name,
            type: material.type,
            sizeBytes: Number(material.size_bytes || 0),
            signedUrl,
          },
          settings: job.settings,
          cache: job.pipeline === "document_ir_v1" && cached ? {
            sourceSha256: cached.source_sha256,
            parserVersion: cached.parser_version,
            auditVersion: cached.audit_version,
            visionModel: cached.vision_model,
            document: cached.canonical_document,
          } : null,
          callbacks: this.callbacks(jobId, leaseToken),
          checkpoint: checkpoint ? { checkpointStage: checkpoint.stage, ...checkpoint.payload } : null,
          budgetMicroUsd,
        };
      }
      const accepted = await this.worker.dispatchGeneration(payload);
      if (!accepted.accepted) {
        throw new AiWorkerError("AI_WORKER_PROTOCOL_ERROR", "AI worker did not accept the durable job", [], true);
      }
      await this.repository.markJobAccepted(jobId, leaseToken);
    } catch (error) {
      const code = error instanceof AiWorkerError ? error.code : "AI_SYSTEM_FAILURE";
      const message = error instanceof Error ? error.message : "AI processing failed";
      const retryable = error instanceof AiWorkerError && error.retryable || RETRYABLE_CODES.has(code);
      this.logger.warn(`Materials AI job ${jobId} dispatch failed with ${code}`);
      await this.repository.failJob(
        jobId, leaseToken, code, message, retryable,
        positiveNumber("MATERIAL_AI_RESUME_TTL_SECONDS", 86_400),
      ).catch(() => undefined);
    }
  }

  async usage(jobId: string, leaseToken: string, event: unknown) {
    if (!leaseToken || !event || typeof event !== "object" || Array.isArray(event)) {
      throw new BadRequestException({ code: "INVALID_USAGE_EVENT", message: "Invalid provider usage event" });
    }
    await this.repository.recordJobUsage(jobId, leaseToken, event);
    const [jobCost, totalCost] = await Promise.all([
      this.repository.jobProviderCostMicroUsd(jobId),
      this.repository.monthlyProviderCostMicroUsd(),
    ]);
    const jobLimit = positiveNumber("MATERIAL_AI_GENERATION_MAX_COST_USD", 0.5) * 1_000_000;
    const monthlyLimit = positiveNumber("MATERIAL_AI_MONTHLY_BUDGET_USD", 20) * 1_000_000;
    if (jobCost > jobLimit || totalCost > monthlyLimit) {
      await this.repository.failJob(jobId, leaseToken, "AI_COST_LIMIT_EXCEEDED", "The configured AI cost limit was reached", false)
        .catch(() => undefined);
      throw new ServiceUnavailableException({ code: "AI_COST_LIMIT_EXCEEDED", message: "The configured AI cost limit was reached" });
    }
    return { persisted: true };
  }

  checkpoint(jobId: string, leaseToken: string, stage: string, payload: unknown) {
    if (!leaseToken || !["parsed", "audited", "document_ready", "artifact_ready", "answer_ready", "native_audited", "native_artifact_ready"].includes(stage)
        || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadRequestException({ code: "INVALID_CHECKPOINT", message: "Invalid AI checkpoint" });
    }
    return this.repository.checkpointJob(
      jobId,
      leaseToken,
      stage,
      payload,
      positiveNumber("MATERIAL_AI_RESUME_TTL_SECONDS", 86_400),
    ).then(() => ({ persisted: true }));
  }

  async complete(jobId: string, leaseToken: string, result: unknown) {
    if (!leaseToken || !result || typeof result !== "object" || Array.isArray(result)) {
      throw new BadRequestException({ code: "INVALID_AI_RESULT", message: "Invalid AI result" });
    }
    const cost = await this.repository.jobProviderCostMicroUsd(jobId);
    const limit = positiveNumber("MATERIAL_AI_GENERATION_MAX_COST_USD", 0.5) * 1_000_000;
    if (cost > limit) {
      await this.repository.failJob(jobId, leaseToken, "AI_COST_LIMIT_EXCEEDED", "The configured per-job AI cost limit was reached", false);
      throw new ServiceUnavailableException({ code: "AI_COST_LIMIT_EXCEEDED", message: "The configured per-job AI cost limit was reached" });
    }
    const value = result as DbRow;
    if (value.kind === "knowledge_question") {
      try {
        await this.repository.completeKnowledgeQuestion(jobId, leaseToken, value.answer);
      } catch (error) {
        return this.settleMaterialCompletionRejection(
          jobId,
          leaseToken,
          value.kind,
          error,
        );
      }
      return { completed: true };
    }
    try {
      await this.repository.completeMaterialJob(jobId, leaseToken, value);
    } catch (error) {
      return this.settleMaterialCompletionRejection(jobId, leaseToken, value.kind, error);
    }
    return { completed: true };
  }

  fail(jobId: string, leaseToken: string, code: string, message: string, requestedRetryable: boolean) {
    const retryable = requestedRetryable && RETRYABLE_CODES.has(code);
    return this.repository.failJob(
      jobId,
      leaseToken || null,
      code,
      message,
      retryable,
      positiveNumber("MATERIAL_AI_RESUME_TTL_SECONDS", 86_400),
    ).then(() => ({ failed: true, retryable }));
  }

  async grading(attemptId: string) {
    const leaseToken = randomUUID();
    const claimed = await this.repository.claimGrading(attemptId, leaseToken);
    if (!claimed) return;
    try {
      const alreadySpent = await this.repository.attemptProviderCostMicroUsd(attemptId);
      const budgetMicroUsd = await this.budget("grading", alreadySpent);
      const context = await this.repository.attemptContext(attemptId);
      const checkpoint = await this.repository.gradingCheckpointForAttempt(attemptId);
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
      const accepted = await this.worker.dispatchGrading({
        attemptId, questions, language: exam.language,
        pipeline: context.note.pipeline || "document_ir_v1",
        callbacks: {
          baseUrl: `${(process.env.AI_CALLBACK_BASE_URL || "http://api:3000/api").replace(/\/$/, "")}/internal/exam-attempts/${attemptId}`,
          token: process.env.AI_INTERNAL_TOKEN,
          leaseToken,
        },
        budgetMicroUsd,
        checkpoint: checkpoint?.payload || null,
      });
      if (!accepted.accepted) {
        throw new AiWorkerError("AI_WORKER_PROTOCOL_ERROR", "AI worker did not accept the grading job", [], true);
      }
    } catch (error) {
      const code = error instanceof AiWorkerError ? error.code : "AI_GRADING_FAILED";
      this.logger.warn(`Exam grading ${attemptId} failed with ${code}`);
      const usage = error instanceof AiWorkerError ? error.usageEvents : [];
      await this.repository.failGrading(attemptId, leaseToken, usage).catch(() => undefined);
    }
  }

  async gradingUsage(attemptId: string, leaseToken: string, event: unknown) {
    if (!leaseToken || !event || typeof event !== "object" || Array.isArray(event)) {
      throw new BadRequestException({ code: "INVALID_USAGE_EVENT", message: "Invalid provider usage event" });
    }
    await this.repository.recordGradingUsage(attemptId, leaseToken, event);
    const [attemptCost, totalCost] = await Promise.all([
      this.repository.attemptProviderCostMicroUsd(attemptId),
      this.repository.monthlyProviderCostMicroUsd(),
    ]);
    const attemptLimit = positiveNumber("MATERIAL_AI_GRADING_MAX_COST_USD", 0.05) * 1_000_000;
    const monthlyLimit = positiveNumber("MATERIAL_AI_MONTHLY_BUDGET_USD", 20) * 1_000_000;
    if (attemptCost > attemptLimit || totalCost > monthlyLimit) {
      await this.repository.failGrading(attemptId, leaseToken, []).catch(() => undefined);
      throw new ServiceUnavailableException({ code: "AI_COST_LIMIT_EXCEEDED", message: "The configured AI cost limit was reached" });
    }
    return { persisted: true };
  }

  gradingCheckpoint(attemptId: string, leaseToken: string, payload: unknown) {
    if (!leaseToken || !payload || typeof payload !== "object" || Array.isArray(payload)
        || !("result" in payload)) {
      throw new BadRequestException({ code: "INVALID_GRADING_CHECKPOINT", message: "Invalid grading checkpoint" });
    }
    return this.repository.checkpointGrading(
      attemptId, leaseToken, payload,
      positiveNumber("MATERIAL_AI_RESUME_TTL_SECONDS", 86_400),
    ).then(() => ({ persisted: true }));
  }

  async gradingComplete(attemptId: string, leaseToken: string, result: unknown) {
    if (!leaseToken || !result || typeof result !== "object" || Array.isArray(result)) {
      throw new BadRequestException({ code: "INVALID_AI_RESULT", message: "Invalid grading result" });
    }
    const value = result as DbRow;
    try {
      await this.repository.completeGrading(
        attemptId, leaseToken, Number(value.subjectiveScore || 0),
        Array.isArray(value.results) ? value.results : [], [],
      );
    } catch (error) {
      if (databaseLeaseRejected(error)) {
        throw new ConflictException({ code: "JOB_CANCELLED", message: "The grading lease is no longer active" });
      }
      if (!databaseResultContractRejected(error) && !databaseRoutingRejected(error)) throw error;
      const code = databaseRoutingRejected(error)
        ? "AI_PROVIDER_ROUTING_VIOLATION"
        : "AI_GRADING_VALIDATION_FAILED";
      this.logger.warn(JSON.stringify({
        event: "ai_grading_result_contract_rejected",
        attemptId,
        code,
      }));
      await this.repository.failGrading(attemptId, leaseToken, []);
      return { completed: false, failed: true };
    }
    return { completed: true };
  }

  async gradingFail(attemptId: string, leaseToken: string) {
    await this.repository.failGrading(attemptId, leaseToken, []);
    return { failed: true };
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

  async cleanup(jobId: string) {
    const row = await this.repository.generationCleanupState(jobId);
    if (!row || row.status !== "deleting") return;
    try {
      const response = await this.worker.cancelGeneration(jobId, row.lease_token || null);
      if (!response.accepted || !response.purged) {
        throw new AiWorkerError("AI_WORKER_CLEANUP_PENDING", "AI worker has not confirmed cleanup", [], true);
      }
      await this.repository.finalizeCleanup(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI worker cleanup failed";
      this.logger.warn(`Materials AI cleanup ${jobId} remains pending: ${message}`);
      await this.repository.recordCleanupFailure(jobId, message).catch(() => undefined);
      throw error;
    }
  }

  async progress(jobId: string, leaseToken: string, stage: string, progress: number, eventCode?: string) {
    return this.repository.updateJob(jobId, leaseToken, stage, progress, eventCode);
  }
}
