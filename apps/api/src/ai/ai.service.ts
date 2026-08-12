import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { GeneratedExamV1 } from "@nalanda/types";
import { FeatureFlagsService } from "../learning/feature-flags.service";
import { AiQueueService } from "./ai-queue.service";
import { AiRepository } from "./ai.repository";
import {
  assertUuid,
  knowledgeQuestionFingerprint,
  parseJobRequest,
  parseKnowledgeQuestion,
  parseSaveAnswers,
  parseSubmit,
  requestFingerprint,
} from "./ai.dto";
import { gradeObjective } from "./exam-grading";

const SUPPORTED = new Set(["pdf", "docx", "pptx", "md", "markdown", "html", "htm", "txt", "json", "csv", "png", "jpg", "jpeg", "webp"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "webp"]);
const extension = (name: string) => name.split(".").pop()?.toLowerCase() || "";

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly repository: AiRepository,
    private readonly queue: AiQueueService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private enabled() { this.flags.materialAi(); }

  async quota(userId: string) { return this.repository.quota(userId); }

  async createJob(userId: string, materialIdValue: string, input: unknown) {
    this.enabled();
    const materialId = assertUuid(materialIdValue, "materialId");
    const request = parseJobRequest(input);
    const material = await this.repository.ownedMaterial(userId, materialId);
    const ext = extension(material.name);
    if (!SUPPORTED.has(ext)) {
      throw new BadRequestException({
        code: "AI_FILE_TYPE_UNSUPPORTED",
        message: ["doc", "ppt", "xls", "xlsx"].includes(ext)
          ? "Convert legacy Office files to DOCX or PPTX before using AI"
          : "This file type is not supported for AI processing",
      });
    }
    const size = Number(material.size_bytes || 0);
    const max = IMAGE.has(ext) ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
    if (size <= 0 || size > max) {
      throw new BadRequestException({ code: "AI_FILE_SIZE_UNSUPPORTED", message: `This file must be no larger than ${IMAGE.has(ext) ? 10 : 25} MB` });
    }
    const row = await this.repository.createJob(
      userId, materialId, request.idempotencyKey, requestFingerprint(materialId, request),
      request.kind, request.settings, request.consentVersion,
    );
    await this.queue.enqueueGeneration(row.id).catch((error) => {
      this.logger.warn(`AI job ${row.id} persisted but immediate Redis dispatch failed: ${error instanceof Error ? error.message : "unknown"}`);
    });
    return this.repository.job(row, row.status === "queued" ? 1 : null);
  }

  listJobs(userId: string, limit?: string) {
    this.enabled();
    return this.repository.listJobs(userId, Number(limit || 30));
  }

  async job(userId: string, idValue: string) {
    this.enabled();
    return this.repository.job(await this.repository.getJob(userId, assertUuid(idValue)));
  }

  async cancel(userId: string, idValue: string) {
    this.enabled();
    const row = await this.repository.cancelJob(userId, assertUuid(idValue));
    return this.repository.job(row);
  }

  async retry(userId: string, idValue: string) {
    this.enabled();
    const row = await this.repository.retryJob(userId, assertUuid(idValue));
    await this.queue.enqueueGeneration(row.id).catch((error) => {
      this.logger.warn(`Resumable AI job ${row.id} persisted but immediate Redis dispatch failed: ${error instanceof Error ? error.message : "unknown"}`);
    });
    return this.repository.job(row, row.status === "queued" ? 1 : null);
  }

  listNotes(userId: string) { return this.repository.listNotes(userId); }
  note(userId: string, idValue: string) { return this.repository.note(userId, assertUuid(idValue)); }

  async createKnowledgeQuestion(userId: string, noteIdValue: string, nodeIdValue: string, input: unknown) {
    this.enabled();
    const noteId = assertUuid(noteIdValue, "noteId");
    const nodeId = String(nodeIdValue || "").trim();
    if (!nodeId || Array.from(nodeId).length > 80) {
      throw new BadRequestException({ code: "INVALID_KNOWLEDGE_NODE", message: "Invalid knowledge point" });
    }
    const request = parseKnowledgeQuestion(input);
    const row = await this.repository.createKnowledgeQuestion(
      userId, noteId, nodeId, request.question, request.idempotencyKey,
      knowledgeQuestionFingerprint(noteId, nodeId, request),
    );
    await this.queue.enqueueGeneration(row.id).catch((error) => {
      this.logger.warn(`Knowledge question ${row.id} persisted but immediate Redis dispatch failed: ${error instanceof Error ? error.message : "unknown"}`);
    });
    return this.repository.knowledgeQuestion(userId, row.id);
  }

  knowledgeQuestion(userId: string, idValue: string) {
    this.enabled();
    return this.repository.knowledgeQuestion(userId, assertUuid(idValue));
  }
  async deleteNote(userId: string, idValue: string) {
    await this.repository.deleteNote(userId, assertUuid(idValue));
    return { deleted: true };
  }

  async deleteMaterial(userId: string, idValue: string, results: string | undefined) {
    if (results !== "keep" && results !== "delete") throw new BadRequestException({ code: "INVALID_DELETE_MODE", message: "Choose whether to keep or delete AI results" });
    const path = await this.repository.deleteMaterialRecord(userId, assertUuid(idValue), results === "delete");
    await this.repository.deleteStorage([path]).catch((error) => {
      this.logger.warn(`Deleted material row but Storage cleanup must be retried: ${error instanceof Error ? error.message : "unknown"}`);
    });
    return { deleted: true, aiResults: results === "delete" ? "deleted" : "unfiled" };
  }

  async deleteMaterialCourse(userId: string, idValue: string, results: string | undefined) {
    if (results !== "keep" && results !== "delete") throw new BadRequestException({ code: "INVALID_DELETE_MODE", message: "Choose whether to keep or delete AI results" });
    const paths = await this.repository.deleteCourseRecord(userId, assertUuid(idValue), results === "delete");
    await this.repository.deleteStorage(paths).catch((error) => {
      this.logger.warn(`Deleted Materials course but Storage cleanup must be retried: ${error instanceof Error ? error.message : "unknown"}`);
    });
    return { deleted: true, aiResults: results === "delete" ? "deleted" : "unfiled" };
  }

  async createAttempt(userId: string, noteIdValue: string) {
    const attempt = await this.repository.createAttempt(userId, assertUuid(noteIdValue, "noteId"));
    await this.queue.enqueueTimeout(attempt.id, attempt.deadline_at).catch(() => undefined);
    return this.repository.attemptResponse(await this.repository.attemptContext(attempt.id, userId));
  }

  private async submitContext(userId: string, context: Awaited<ReturnType<AiRepository["attemptContext"]>>,
    operationId: string, expectedRevision: number) {
    const exam = context.artifact.content as GeneratedExamV1;
    const answers = context.answers.map((row) => ({ questionId: row.question_id, value: row.answer }));
    const objective = gradeObjective(exam, answers);
    const result = await this.repository.submitAttempt(
      userId, context.attempt.id, operationId, expectedRevision,
      objective.results, objective.score, objective.marks, objective.needsGrading,
    );
    if (result.status === "grading") await this.queue.enqueueGrading(context.attempt.id).catch(() => undefined);
    return result;
  }

  private async forceExpired(userId: string, context: Awaited<ReturnType<AiRepository["attemptContext"]>>) {
    if (context.attempt.status !== "in_progress" || new Date(context.attempt.deadline_at).getTime() > Date.now()) return context;
    try {
      await this.submitContext(userId, context, randomUUID(), Number(context.attempt.revision));
    } catch (error) {
      const response = error && typeof (error as { getResponse?: () => unknown }).getResponse === "function"
        ? (error as { getResponse: () => unknown }).getResponse()
        : null;
      const code = response && typeof response === "object" ? (response as { code?: unknown }).code : null;
      if (code !== "EXAM_REVISION_CONFLICT") throw error;

      // A final autosave may win the race with the deadline request. Reload the
      // authoritative answers/revision and retry once; a second conflict is
      // surfaced instead of risking repeated or stale submission.
      const latest = await this.repository.attemptContext(context.attempt.id, userId);
      if (latest.attempt.status !== "in_progress") return latest;
      await this.submitContext(userId, latest, randomUUID(), Number(latest.attempt.revision));
    }
    return this.repository.attemptContext(context.attempt.id, userId);
  }

  async attempt(userId: string, idValue: string) {
    const id = assertUuid(idValue);
    const current = await this.repository.attemptContext(id, userId);
    return this.repository.attemptResponse(await this.forceExpired(userId, current));
  }

  attempts(userId: string, noteIdValue: string) {
    return this.repository.listAttempts(userId, assertUuid(noteIdValue, "noteId"));
  }

  async saveAnswers(userId: string, idValue: string, input: unknown) {
    const id = assertUuid(idValue);
    const request = parseSaveAnswers(input);
    const current = await this.repository.attemptContext(id, userId);
    if (new Date(current.attempt.deadline_at).getTime() <= Date.now()) {
      const closed = await this.forceExpired(userId, current);
      return this.repository.attemptResponse(closed);
    }
    await this.repository.saveAnswers(userId, id, request.operationId, request.expectedRevision, request.answers);
    return this.repository.attemptResponse(await this.repository.attemptContext(id, userId));
  }

  async submit(userId: string, idValue: string, input: unknown) {
    const id = assertUuid(idValue);
    const request = parseSubmit(input);
    const context = await this.repository.attemptContext(id, userId);
    await this.submitContext(userId, context, request.operationId, request.expectedRevision);
    return this.repository.attemptResponse(await this.repository.attemptContext(id, userId));
  }

  async requestGrading(userId: string, idValue: string, input: unknown) {
    this.enabled();
    const id = assertUuid(idValue);
    const request = parseSubmit(input);
    const result = await this.repository.requestGrading(userId, id, request.operationId, request.expectedRevision);
    if (result.status !== "grading") throw new ServiceUnavailableException({ code: "AI_GRADING_UNAVAILABLE", message: "Grading was not queued" });
    await this.queue.enqueueGrading(id).catch(() => undefined);
    return this.repository.attemptResponse(await this.repository.attemptContext(id, userId));
  }
}
