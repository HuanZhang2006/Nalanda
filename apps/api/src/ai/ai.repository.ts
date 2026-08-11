import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  AiGenerationJob,
  AiQuotaSummary,
  ExamAnswerInput,
  GeneratedExamAttempt,
  GeneratedExamV1,
  GeneratedNoteDetail,
  GeneratedNoteSummary,
} from "@nalanda/types";
import { SupabaseAdminService, SupabaseRequestError } from "../learning/supabase-admin.service";
import { examWithoutAnswers } from "./exam-grading";

export type DbRow = Record<string, any>;
const query = (values: Record<string, string>) => new URLSearchParams(values);

function dbCode(error: SupabaseRequestError) {
  return typeof error.body === "object" && error.body && "code" in error.body
    ? String((error.body as { code: unknown }).code) : "DATABASE_ERROR";
}

@Injectable()
export class AiRepository {
  constructor(private readonly db: SupabaseAdminService) {}

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (!(error instanceof SupabaseRequestError)) throw error;
      const code = dbCode(error);
      const message = error.message || "Database request failed";
      if (/AI_GENERATION_DAILY_LIMIT|AI_GRADING_QUOTA_EXCEEDED/.test(message)) {
        throw new HttpException({ code: message.includes("GRADING") ? "AI_GRADING_DAILY_LIMIT" : "AI_GENERATION_DAILY_LIMIT", message: "Daily free AI allowance has been used" }, 429);
      }
      if (/AI_JOB_ACTIVE/.test(message)) throw new ConflictException({ code: "AI_JOB_ACTIVE", message: "Finish or cancel the active AI job first" });
      if (/IDEMPOTENCY_CONFLICT/.test(message)) throw new ConflictException({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for another request" });
      if (/REVISION_CONFLICT/.test(message)) throw new ConflictException({ code: "EXAM_REVISION_CONFLICT", message: "This exam was updated elsewhere; refresh before continuing" });
      if (/NOT_FOUND/.test(message) || code === "P0002") throw new NotFoundException({ code: message.match(/[A-Z][A-Z_]+/)?.[0] || "NOT_FOUND", message: "The requested item was not found" });
      if (/CONSENT_REQUIRED/.test(message)) throw new BadRequestException({ code: "AI_PROCESSING_CONSENT_REQUIRED", message: "AI processing consent is required" });
      if (/CLOSED|EXPIRED|NOT_AVAILABLE/.test(message)) throw new ConflictException({ code: message.match(/[A-Z][A-Z_]+/)?.[0] || "EXAM_UNAVAILABLE", message: "This exam action is no longer available" });
      if (code === "42501" || error.status === 403) throw new ForbiddenException({ code: "FORBIDDEN", message: "This action is not allowed" });
      if (code === "22023" || code === "23514") throw new BadRequestException({ code: "INVALID_REQUEST", message });
      if (error.status >= 500) throw new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE", message: "AI records are temporarily unavailable" });
      throw error;
    }
  }

  job(row: DbRow, queuePosition: number | null = null): AiGenerationJob {
    return {
      id: row.id,
      materialId: row.material_id ?? null,
      materialName: row.material_name,
      courseId: row.course_id ?? null,
      kind: "exam",
      status: row.status,
      stage: row.stage,
      progress: Number(row.progress),
      queuePosition,
      settings: row.settings,
      errorCode: row.error_code ?? null,
      errorMessage: row.error_message ?? null,
      noteId: row.note_id ?? null,
      createdAt: row.created_at,
      startedAt: row.started_at ?? null,
      finishedAt: row.finished_at ?? null,
    };
  }

  async quota(userId: string): Promise<AiQuotaSummary> {
    return this.call(() => this.db.rpc<AiQuotaSummary>("ai_get_quota_summary", { p_user_id: userId }));
  }

  async createJob(userId: string, materialId: string, idempotencyKey: string, fingerprint: string,
    settings: unknown, consentVersion: number) {
    const rows = await this.call(() => this.db.rpc<DbRow[]>("ai_create_generation_job", {
      p_user_id: userId,
      p_material_id: materialId,
      p_idempotency_key: idempotencyKey,
      p_request_fingerprint: fingerprint,
      p_settings: settings,
      p_consent_version: consentVersion,
    }));
    if (!rows[0]) throw new ServiceUnavailableException({ code: "AI_JOB_CREATE_FAILED", message: "AI job could not be created" });
    return rows[0];
  }

  async listJobs(userId: string, limit = 30) {
    const [rows, queued] = await Promise.all([
      this.call(() => this.db.select<DbRow>("generation_jobs", query({
        select: "*", user_id: `eq.${userId}`, order: "created_at.desc", limit: String(Math.max(1, Math.min(100, limit))),
      }))),
      this.db.select<DbRow>("generation_jobs", query({ select: "id", status: "eq.queued", order: "created_at.asc", limit: "1000" })),
    ]);
    const positions = new Map(queued.map((row, index) => [row.id, index + 1]));
    return rows.map((row) => this.job(row, positions.get(row.id) || null));
  }

  async getJob(userId: string, id: string) {
    const rows = await this.call(() => this.db.select<DbRow>("generation_jobs", query({ select: "*", id: `eq.${id}`, user_id: `eq.${userId}`, limit: "1" })));
    if (!rows[0]) throw new NotFoundException({ code: "AI_JOB_NOT_FOUND", message: "AI job not found" });
    return rows[0];
  }

  async ownedMaterial(userId: string, id: string) {
    const rows = await this.call(() => this.db.select<DbRow>("materials", query({
      select: "id,user_id,course_id,name,type,size_bytes,storage_path", id: `eq.${id}`, user_id: `eq.${userId}`, limit: "1",
    })));
    if (!rows[0]) throw new NotFoundException({ code: "MATERIAL_NOT_FOUND", message: "Material not found" });
    return rows[0];
  }

  async cancelJob(userId: string, id: string) {
    const rows = await this.call(() => this.db.rpc<DbRow[]>("ai_cancel_generation_job", { p_user_id: userId, p_job_id: id }));
    return rows[0];
  }

  async dispatchableGenerationJobs() {
    const now = new Date().toISOString();
    const [queued, expired] = await Promise.all([
      this.db.select<DbRow>("generation_jobs", query({ select: "id", status: "eq.queued", order: "created_at.asc", limit: "100" })),
      this.db.select<DbRow>("generation_jobs", query({ select: "id", status: "eq.processing", lease_expires_at: `lt.${now}`, order: "created_at.asc", limit: "100" })),
    ]);
    return [...queued, ...expired].map((row) => String(row.id));
  }

  async dispatchableGradingAttempts() {
    const now = new Date().toISOString();
    const rows = await this.db.select<DbRow>("exam_attempts", query({
      select: "id", status: "eq.grading", or: `(grading_lease_expires_at.is.null,grading_lease_expires_at.lt.${now})`, limit: "100",
    }));
    return rows.map((row) => String(row.id));
  }

  async overdueExamAttempts() {
    const rows = await this.db.select<DbRow>("exam_attempts", query({
      select: "id,deadline_at", status: "eq.in_progress", deadline_at: `lte.${new Date().toISOString()}`, limit: "100",
    }));
    return rows.map((row) => String(row.id));
  }

  async claimJob(id: string, leaseToken: string) {
    const rows = await this.db.rpc<DbRow[]>("ai_claim_generation_job", { p_job_id: id, p_lease_token: leaseToken, p_lease_seconds: 900 });
    return rows[0] || null;
  }

  updateJob(id: string, leaseToken: string, stage: string, progress: number, eventCode?: string) {
    return this.db.rpc<void>("ai_update_generation_job", {
      p_job_id: id, p_lease_token: leaseToken, p_stage: stage, p_progress: progress, p_event_code: eventCode || null,
    });
  }

  async materialForJob(job: DbRow) {
    const rows = await this.db.select<DbRow>("materials", query({ select: "id,user_id,course_id,name,type,size_bytes,storage_path", id: `eq.${job.material_id}`, user_id: `eq.${job.user_id}`, limit: "1" }));
    return rows[0] || null;
  }

  async cachedDocument(materialId: string) {
    const rows = await this.db.select<DbRow>("ai_material_parse_cache", query({
      select: "source_sha256,parser_version,audit_version,vision_model,canonical_document,block_count,visual_region_count",
      material_id: `eq.${materialId}`, order: "updated_at.desc", limit: "1",
    }));
    return rows[0] || null;
  }

  signMaterial(path: string) { return this.db.storageCreateSignedUrl("materials", path, 1_200); }

  completeJob(jobId: string, leaseToken: string, result: DbRow) {
    return this.db.rpc<string>("ai_complete_generation_job", {
      p_job_id: jobId,
      p_lease_token: leaseToken,
      p_source_sha256: result.sourceSha256,
      p_parser_version: result.parserVersion,
      p_audit_version: result.auditVersion,
      p_canonical_document: result.document,
      p_block_count: result.blockCount,
      p_visual_region_count: result.visualRegionCount,
      p_title: result.exam.title,
      p_exam: result.exam,
      p_question_count: result.questionCount,
      p_total_marks: result.totalMarks,
      p_usage_events: result.usageEvents || [],
    });
  }

  failJob(jobId: string, leaseToken: string | null, code: string, message: string, usageEvents: unknown[] = []) {
    return this.db.rpc<void>("ai_fail_generation_job", {
      p_job_id: jobId, p_lease_token: leaseToken, p_error_code: code, p_error_message: message, p_usage_events: usageEvents,
    });
  }

  async monthlyProviderCostMicroUsd() {
    return Number(await this.db.rpc<number>("ai_get_monthly_provider_cost", {}));
  }

  private async courseMap(ids: Array<string | null>) {
    const values = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!values.length) return new Map<string, DbRow>();
    const rows = await this.db.select<DbRow>("courses", query({ select: "id,name,code", id: `in.(${values.join(",")})` }));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async listNotes(userId: string): Promise<GeneratedNoteSummary[]> {
    const notes = await this.call(() => this.db.select<DbRow>("notes", query({ select: "*", user_id: `eq.${userId}`, order: "updated_at.desc" })));
    const ids = notes.map((note) => note.id);
    const [artifacts, sources, courses] = await Promise.all([
      ids.length ? this.db.select<DbRow>("note_artifacts", query({ select: "note_id,question_count,total_marks", note_id: `in.(${ids.join(",")})` })) : [],
      ids.length ? this.db.select<DbRow>("note_materials", query({ select: "note_id,material_id", note_id: `in.(${ids.join(",")})` })) : [],
      this.courseMap(notes.map((note) => note.course_id)),
    ]);
    const artifactMap = new Map(artifacts.map((row) => [row.note_id, row]));
    const sourceMap = new Map(sources.map((row) => [row.note_id, row]));
    return notes.map((note) => this.noteSummary(note, artifactMap.get(note.id), sourceMap.get(note.id), courses.get(note.course_id)));
  }

  private noteSummary(note: DbRow, artifact?: DbRow, source?: DbRow, course?: DbRow): GeneratedNoteSummary {
    return {
      id: note.id,
      courseId: note.course_id ?? null,
      courseName: course?.name || "Unfiled",
      courseCode: course?.code || null,
      title: note.title,
      kind: "ai_exam",
      materialName: note.material_name,
      sourceDeleted: !source?.material_id,
      questionCount: Number(artifact?.question_count || 0),
      totalMarks: Number(artifact?.total_marks || 0),
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    };
  }

  async note(userId: string, noteId: string): Promise<GeneratedNoteDetail> {
    const notes = await this.call(() => this.db.select<DbRow>("notes", query({ select: "*", id: `eq.${noteId}`, user_id: `eq.${userId}`, limit: "1" })));
    if (!notes[0]) throw new NotFoundException({ code: "NOTE_NOT_FOUND", message: "Note not found" });
    const note = notes[0];
    const [artifacts, sources, courses] = await Promise.all([
      this.db.select<DbRow>("note_artifacts", query({ select: "*", note_id: `eq.${noteId}`, limit: "1" })),
      this.db.select<DbRow>("note_materials", query({ select: "note_id,material_id", note_id: `eq.${noteId}`, limit: "1" })),
      this.courseMap([note.course_id]),
    ]);
    if (!artifacts[0]) throw new NotFoundException({ code: "NOTE_ARTIFACT_NOT_FOUND", message: "Generated note content is missing" });
    return { ...this.noteSummary(note, artifacts[0], sources[0], courses.get(note.course_id)), exam: artifacts[0].content as GeneratedExamV1 };
  }

  deleteNote(userId: string, noteId: string) {
    return this.call(() => this.db.rpc<void>("ai_delete_note", { p_user_id: userId, p_note_id: noteId }));
  }

  deleteMaterialRecord(userId: string, materialId: string, deleteResults: boolean) {
    return this.call(() => this.db.rpc<string>("ai_delete_material", {
      p_user_id: userId, p_material_id: materialId, p_delete_results: deleteResults,
    }));
  }

  deleteCourseRecord(userId: string, courseId: string, deleteResults: boolean) {
    return this.call(() => this.db.rpc<string[]>("ai_delete_material_course", {
      p_user_id: userId, p_course_id: courseId, p_delete_results: deleteResults,
    }));
  }

  deleteStorage(paths: string[]) { return this.db.storageDelete("materials", paths); }

  async createAttempt(userId: string, noteId: string) {
    const rows = await this.call(() => this.db.rpc<DbRow[]>("ai_create_exam_attempt", { p_user_id: userId, p_note_id: noteId }));
    if (!rows[0]) throw new ServiceUnavailableException({ code: "EXAM_ATTEMPT_CREATE_FAILED", message: "Exam attempt could not be created" });
    return rows[0];
  }

  saveAnswers(userId: string, attemptId: string, operationId: string, expectedRevision: number, answers: ExamAnswerInput[]) {
    return this.call(() => this.db.rpc<DbRow>("ai_save_exam_answers", {
      p_user_id: userId, p_attempt_id: attemptId, p_operation_id: operationId,
      p_expected_revision: expectedRevision, p_answers: answers,
    }));
  }

  submitAttempt(userId: string, attemptId: string, operationId: string, expectedRevision: number,
    results: unknown[], objectiveScore: number, objectiveMarks: number, needsGrading: boolean) {
    return this.call(() => this.db.rpc<DbRow>("ai_submit_exam_attempt", {
      p_user_id: userId, p_attempt_id: attemptId, p_operation_id: operationId,
      p_expected_revision: expectedRevision, p_results: results,
      p_objective_score: objectiveScore, p_objective_marks: objectiveMarks, p_needs_grading: needsGrading,
    }));
  }

  requestGrading(userId: string, attemptId: string, operationId: string, expectedRevision: number) {
    return this.call(() => this.db.rpc<DbRow>("ai_request_exam_grading", {
      p_user_id: userId, p_attempt_id: attemptId, p_operation_id: operationId, p_expected_revision: expectedRevision,
    }));
  }

  async attemptContext(attemptId: string, userId?: string) {
    const filters: Record<string, string> = { select: "*", id: `eq.${attemptId}`, limit: "1" };
    if (userId) filters.user_id = `eq.${userId}`;
    const attempts = await this.call(() => this.db.select<DbRow>("exam_attempts", query(filters)));
    if (!attempts[0]) throw new NotFoundException({ code: "EXAM_ATTEMPT_NOT_FOUND", message: "Exam attempt not found" });
    const attempt = attempts[0];
    const [notes, artifacts, answers] = await Promise.all([
      this.db.select<DbRow>("notes", query({ select: "*", id: `eq.${attempt.note_id}`, limit: "1" })),
      this.db.select<DbRow>("note_artifacts", query({ select: "*", note_id: `eq.${attempt.note_id}`, limit: "1" })),
      this.db.select<DbRow>("exam_attempt_answers", query({ select: "*", attempt_id: `eq.${attemptId}`, order: "question_id.asc" })),
    ]);
    if (!notes[0] || !artifacts[0]) throw new NotFoundException({ code: "NOTE_NOT_FOUND", message: "Exam source is missing" });
    return { attempt, note: notes[0], artifact: artifacts[0], answers };
  }

  attemptResponse(context: Awaited<ReturnType<AiRepository["attemptContext"]>>): GeneratedExamAttempt {
    const { attempt, artifact, answers } = context;
    return {
      id: attempt.id,
      noteId: attempt.note_id,
      status: attempt.status,
      revision: Number(attempt.revision),
      deadlineAt: attempt.deadline_at,
      submittedAt: attempt.submitted_at ?? null,
      completedAt: attempt.completed_at ?? null,
      objectiveScore: Number(attempt.objective_score),
      objectiveMarks: Number(attempt.objective_marks),
      totalScore: attempt.total_score == null ? null : Number(attempt.total_score),
      totalMarks: Number(attempt.total_marks),
      answers: answers.map((row) => ({ questionId: row.question_id, value: row.answer })),
      results: answers.map((row) => ({
        questionId: row.question_id,
        awardedMarks: row.awarded_marks == null ? null : Number(row.awarded_marks),
        correct: row.correct ?? null,
        feedback: row.feedback ?? null,
      })),
      exam: examWithoutAnswers(artifact.content as GeneratedExamV1),
      serverNow: new Date().toISOString(),
    };
  }

  async listAttempts(userId: string, noteId: string) {
    const note = await this.note(userId, noteId);
    void note;
    const rows = await this.db.select<DbRow>("exam_attempts", query({ select: "*", user_id: `eq.${userId}`, note_id: `eq.${noteId}`, order: "attempt_number.desc" }));
    return Promise.all(rows.map(async (row) => this.attemptResponse(await this.attemptContext(row.id, userId))));
  }

  async claimGrading(attemptId: string, leaseToken: string) {
    const rows = await this.db.rpc<DbRow[]>("ai_claim_exam_grading", { p_attempt_id: attemptId, p_lease_token: leaseToken, p_lease_seconds: 300 });
    return rows[0] || null;
  }

  completeGrading(attemptId: string, leaseToken: string, subjectiveScore: number, results: unknown[], usageEvents: unknown[]) {
    return this.db.rpc<void>("ai_complete_exam_grading", {
      p_attempt_id: attemptId, p_lease_token: leaseToken, p_subjective_score: subjectiveScore,
      p_results: results, p_usage_events: usageEvents,
    });
  }

  failGrading(attemptId: string, leaseToken: string, usageEvents: unknown[]) {
    return this.db.rpc<void>("ai_fail_exam_grading", { p_attempt_id: attemptId, p_lease_token: leaseToken, p_usage_events: usageEvents });
  }
}
