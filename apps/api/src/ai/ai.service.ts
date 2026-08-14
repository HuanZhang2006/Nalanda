import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { GeneratedExamV1, SaveKnowledgeGraphLayoutRequest } from "@nalanda/types";
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
const LUNA_MODEL = "openai/gpt-5.6-luna";
const MAX_GRAPH_LAYOUT_COORDINATE = 100_000;
const MAX_GRAPH_LAYOUT_NODES = 250;
const MAX_GRAPH_NODE_ID_LENGTH = 80;
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

  private nativeExtensions() {
    // Only formats proven by the protected real-provider gate belong here.
    // Additional raw formats remain available through Document IR until an
    // operator explicitly extends this allowlist after a format-specific gate.
    const configured = process.env.MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS || "pdf,png";
    return new Set(configured.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  }

  private nativeDisabledReason() {
    return process.env.MATERIAL_AI_LUNA_DISABLED_REASON_CODE === "OPENROUTER_ZDR_UNAVAILABLE"
      ? "OPENROUTER_ZDR_UNAVAILABLE"
      : "AI_LUNA_DISABLED";
  }

  private capabilityRows(material: Record<string, any>) {
    const ext = extension(String(material.name || ""));
    const nativeEnabled = this.flags.materialAiLunaEnabled();
    const nativeAvailable = nativeEnabled && this.nativeExtensions().has(ext);
    return [
      {
        pipeline: "luna_native_file_v1" as const,
        available: nativeAvailable,
        default: nativeAvailable,
        model: LUNA_MODEL,
        provider: "OpenAI",
        reasonCode: nativeAvailable
          ? null
          : nativeEnabled
            ? "AI_LUNA_FORMAT_NOT_VERIFIED"
            : this.nativeDisabledReason(),
      },
      {
        pipeline: "document_ir_v1" as const,
        available: true,
        default: !nativeAvailable,
        model: "deepseek/deepseek-v4-flash-0731",
        provider: "OpenRouter routed ZDR provider",
        reasonCode: null,
      },
    ];
  }

  async capabilities(userId: string, materialIdValue: string) {
    this.enabled();
    const materialId = assertUuid(materialIdValue, "materialId");
    const material = await this.repository.ownedMaterial(userId, materialId);
    return { materialId, capabilities: this.capabilityRows(material) };
  }

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
    const selected = this.capabilityRows(material).find((row) => row.pipeline === request.pipeline);
    if (!selected?.available) {
      throw new BadRequestException({
        code: selected?.reasonCode || "AI_PIPELINE_UNAVAILABLE",
        message: request.pipeline === "luna_native_file_v1"
          ? selected?.reasonCode === "OPENROUTER_ZDR_UNAVAILABLE"
            ? "No compliant OpenAI Zero Data Retention endpoint is currently available"
            : "Luna native-file processing is not available for this format"
          : "The selected AI pipeline is unavailable",
      });
    }
    const row = await this.repository.createJob(
      userId, materialId, request.idempotencyKey, requestFingerprint(materialId, request),
      request.kind, request.settings, request.consentVersion, request.pipeline,
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
    await this.queue.removeGeneration(row.id).catch(() => undefined);
    await this.queue.enqueueCleanup(row.id).catch((error) => {
      this.logger.warn(`AI cleanup ${row.id} persisted but immediate Redis dispatch failed: ${error instanceof Error ? error.message : "unknown"}`);
    });
    return this.repository.job(row);
  }

  async deleteJob(userId: string, idValue: string) {
    this.enabled();
    const row = await this.repository.deleteJob(userId, assertUuid(idValue));
    await this.queue.removeGeneration(row.id).catch(() => undefined);
    await this.queue.enqueueCleanup(row.id).catch((error) => {
      this.logger.warn(`AI delete ${row.id} persisted but immediate cleanup dispatch failed: ${error instanceof Error ? error.message : "unknown"}`);
    });
    return { jobId: row.id, status: "cleaning" as const, quotaConsumed: Boolean(row.deletion_quota_consumed) };
  }

  async clearJobHistory(userId: string) {
    this.enabled();
    const rows = await this.repository.clearJobHistory(userId);
    await Promise.all(rows.map(async (row) => {
      await this.queue.removeGeneration(row.id).catch(() => undefined);
      await this.queue.enqueueCleanup(row.id).catch(() => undefined);
    }));
    return { requested: rows.length, deleted: 0, cleaning: rows.length };
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

  knowledgeGraphLayout(userId: string, noteIdValue: string) {
    this.enabled();
    return this.repository.getKnowledgeGraphLayout(userId, assertUuid(noteIdValue, "noteId"));
  }

  saveKnowledgeGraphLayout(userId: string, noteIdValue: string, input: unknown) {
    this.enabled();
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BadRequestException({ code: "INVALID_GRAPH_LAYOUT", message: "Invalid graph layout" });
    }
    const body = input as Record<string, unknown>;
    const positions = Array.isArray(body.positions) ? body.positions : [];
    const viewport = body.viewport as Record<string, unknown> | undefined;
    if (typeof body.artifactVersion !== "string" || !/^[0-9a-f]{64}$/.test(body.artifactVersion)
        || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0
        || positions.length > MAX_GRAPH_LAYOUT_NODES || !viewport
        || ![viewport.x, viewport.y, viewport.zoom].every((value) => typeof value === "number" && Number.isFinite(value))
        || Math.abs(Number(viewport.x)) > MAX_GRAPH_LAYOUT_COORDINATE
        || Math.abs(Number(viewport.y)) > MAX_GRAPH_LAYOUT_COORDINATE
        || Number(viewport.zoom) < 0.1 || Number(viewport.zoom) > 4) {
      throw new BadRequestException({ code: "INVALID_GRAPH_LAYOUT", message: "Invalid graph layout" });
    }
    const nodeIds = new Set<string>();
    const value: SaveKnowledgeGraphLayoutRequest = {
      artifactVersion: body.artifactVersion,
      expectedRevision: Number(body.expectedRevision),
      positions: positions.map((position) => {
        if (!position || typeof position !== "object" || Array.isArray(position)) {
          throw new BadRequestException({ code: "INVALID_GRAPH_LAYOUT", message: "Invalid node position" });
        }
        const row = position as Record<string, unknown>;
        if (typeof row.nodeId !== "string" || !row.nodeId || Array.from(row.nodeId).length > MAX_GRAPH_NODE_ID_LENGTH
            || nodeIds.has(row.nodeId)
            || typeof row.x !== "number" || typeof row.y !== "number"
            || !Number.isFinite(row.x) || !Number.isFinite(row.y)
            || Math.abs(row.x) > MAX_GRAPH_LAYOUT_COORDINATE
            || Math.abs(row.y) > MAX_GRAPH_LAYOUT_COORDINATE) {
          throw new BadRequestException({ code: "INVALID_GRAPH_LAYOUT", message: "Invalid node position" });
        }
        nodeIds.add(row.nodeId);
        return { nodeId: row.nodeId, x: row.x, y: row.y };
      }),
      viewport: { x: Number(viewport.x), y: Number(viewport.y), zoom: Number(viewport.zoom) },
    };
    return this.repository.saveKnowledgeGraphLayout(userId, assertUuid(noteIdValue, "noteId"), value);
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
