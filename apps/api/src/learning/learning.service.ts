import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type {
  LearningAttemptRequest,
  LearningAttemptResult,
  LearningCourseDetail,
  LearningCourseInput,
  LearningCourseSummary,
  LearningProfileSummary,
  LearningScope,
  LearningSession,
  LearningSessionMutationResult,
  LearningSessionPatch,
  LearningSkill,
  PublicCoursePreview,
  ReviewSchedule,
} from "@nalanda/types";
import { IpaService } from "./ipa.service";
import { positiveEnvironmentNumber } from "./environment";
import { SupabaseAdminService, SupabaseRequestError } from "./supabase-admin.service";
import { assertUuid, cloneSnapshot, publicSnapshot, validateCourseInput } from "./learning.util";

type Row = Record<string, any>;
type CompatibleLearningAttemptRequest = Pick<
  LearningAttemptRequest,
  "wordId" | "skill" | "answer"
> & Partial<Pick<LearningAttemptRequest, "attemptId" | "expectedRevision">>;
const q = (values: Record<string, string>) => new URLSearchParams(values);

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(private readonly db: SupabaseAdminService, private readonly ipa: IpaService) {}

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (!(error instanceof SupabaseRequestError)) throw error;
      const code = typeof error.body === "object" && error.body && "code" in error.body
        ? String((error.body as { code: unknown }).code) : "DATABASE_ERROR";
      if (/course publication daily quota exceeded/i.test(error.message)) {
        throw new HttpException({ code: "PUBLISH_LIMIT", message: "今日上架次数已达上限" }, 429);
      }
      if (/course report daily quota exceeded/i.test(error.message)) {
        throw new HttpException({ code: "REPORT_LIMIT", message: "今日举报次数已达上限" }, 429);
      }
      if (/speech tts minute quota exceeded/i.test(error.message)) {
        throw new HttpException({ code: "SPEECH_TTS_RATE_LIMIT", message: "发音生成速率已达上限" }, 429);
      }
      if (/speech tts monthly character quota exceeded/i.test(error.message)) {
        throw new HttpException({ code: "SPEECH_TTS_MONTHLY_LIMIT", message: "本月发音生成字符额度已用完" }, 429);
      }
      if (/speech .*quota exceeded|speech monthly budget exceeded/i.test(error.message)) {
        throw new HttpException({ code: "SPEECH_QUOTA_EXCEEDED", message: "发音服务配额已用完，请稍后再试" }, 429);
      }
      if (code === "23505") throw new ConflictException({ code: "CONFLICT", message: error.message });
      if (code === "42501" || error.status === 403) throw new ForbiddenException({ code: "FORBIDDEN", message: error.message });
      if (code === "22023" || code === "23514" || error.status === 400) throw new BadRequestException({ code: "INVALID_REQUEST", message: error.message });
      throw error;
    }
  }

  private enrich(input: LearningCourseInput) {
    return {
      ...input,
      units: input.units.map((unit) => ({
        ...unit,
        words: unit.words.map((word) => ({ ...word, ipa: word.ipa?.trim() || this.ipa.lookup(word.term) })),
      })),
    };
  }

  async saveCourse(userId: string, raw: unknown) {
    const input = this.enrich(validateCourseInput(raw));
    const id = await this.call(() => this.db.rpc<string>("learning_upsert_course", { p_user_id: userId, p_payload: input }));
    return this.getCourse(userId, id);
  }

  async renameCourse(userId: string, courseId: string, title: unknown) {
    assertUuid(courseId, "courseId");
    const value = String(title || "").trim();
    if (!value || value.length > 80) throw new BadRequestException({ code: "INVALID_TITLE", message: "课程名称需为 1–80 个字符" });
    await this.call(() => this.db.rpc("learning_rename_course", {
      p_user_id: userId, p_course_id: courseId, p_title: value,
    }));
    return this.getCourse(userId, courseId);
  }

  async deleteCourse(userId: string, courseId: string) {
    assertUuid(courseId, "courseId");
    await this.call(() => this.db.rpc("learning_delete_course", {
      p_user_id: userId, p_course_id: courseId,
    }));
    return { ok: true };
  }

  async listCourses(userId: string): Promise<LearningCourseSummary[]> {
    const [courses, units, words, progress, sessions] = await Promise.all([
      this.db.select<Row>("learning_courses", q({ select: "*", user_id: `eq.${userId}`, order: "updated_at.desc" })),
      this.db.select<Row>("learning_course_units", q({ select: "id,course_id", user_id: `eq.${userId}` })),
      this.db.select<Row>("learning_course_words", q({ select: "id,course_id", user_id: `eq.${userId}` })),
      this.db.select<Row>("learning_word_progress", q({ select: "word_id,learned_at", user_id: `eq.${userId}` })),
      this.db.select<Row>("learning_sessions", q({ select: "id,course_id", user_id: `eq.${userId}`, active: "eq.true" })),
    ]);
    const learned = new Set(progress.filter((row) => row.learned_at).map((row) => row.word_id));
    return courses.map((course) => {
      const courseWords = words.filter((word) => word.course_id === course.id);
      const learnedCount = courseWords.filter((word) => learned.has(word.id)).length;
      return this.summary(course, units.filter((unit) => unit.course_id === course.id).length, courseWords.length, learnedCount,
        sessions.find((session) => session.course_id === course.id)?.id || null);
    });
  }

  async getCourse(userId: string, courseId: string): Promise<LearningCourseDetail> {
    assertUuid(courseId, "courseId");
    const course = await this.requireCourse(userId, courseId);
    const [units, words, progress, sessions] = await Promise.all([
      this.db.select<Row>("learning_course_units", q({ select: "*", user_id: `eq.${userId}`, course_id: `eq.${courseId}`, order: "position.asc" })),
      this.db.select<Row>("learning_course_words", q({ select: "*", user_id: `eq.${userId}`, course_id: `eq.${courseId}`, order: "position.asc" })),
      this.db.select<Row>("learning_word_progress", q({ select: "*", user_id: `eq.${userId}` })),
      this.db.select<Row>("learning_sessions", q({ select: "id", user_id: `eq.${userId}`, course_id: `eq.${courseId}`, active: "eq.true", limit: "1" })),
    ]);
    const progressByWord = new Map(progress.map((row) => [row.word_id, row]));
    const mappedUnits = units.map((unit) => ({
      id: unit.id, name: unit.name, position: unit.position, isSystem: unit.is_system,
      words: words.filter((word) => word.unit_id === unit.id).map((word) => this.word(word, progressByWord.get(word.id))),
    }));
    const learnedCount = mappedUnits.flatMap((unit) => unit.words).filter((word) => word.progress.learnedAt).length;
    return {
      ...this.summary(course, units.length, words.length, learnedCount, sessions[0]?.id || null),
      units: mappedUnits,
    };
  }

  async startSession(userId: string, courseId: string, body: any): Promise<LearningSession> {
    assertUuid(courseId, "courseId");
    const unitId = assertUuid(String(body?.unitId || ""), "unitId");
    const mode = body?.mode == null ? "initial" : String(body.mode);
    if (mode !== "initial" && mode !== "review") {
      throw new BadRequestException({ code: "INVALID_MODE", message: "学习模式无效" });
    }
    const scope = body?.scope == null ? "all" : String(body.scope);
    if (scope !== "all" && scope !== "unlearned") {
      throw new BadRequestException({ code: "INVALID_SCOPE", message: "复习范围无效" });
    }
    const scheduleId = body?.scheduleId ? assertUuid(String(body.scheduleId), "scheduleId") : null;
    const requestedSkills: string[] = Array.isArray(body?.skills) ? body.skills.map(String) : [];
    const allowedSkills = new Set<LearningSkill>(["pronunciation", "translation", "spelling"]);
    if (mode === "review" && !scheduleId && (
      requestedSkills.length < 1 || requestedSkills.length > 3
      || new Set(requestedSkills).size !== requestedSkills.length
      || requestedSkills.some((skill) => !allowedSkills.has(skill as LearningSkill))
    )) {
      throw new BadRequestException({ code: "INVALID_SKILLS", message: "请选择 1–3 个不重复的复习项目" });
    }
    const skills: LearningSkill[] = mode === "initial"
      ? ["pronunciation", "translation", "spelling"]
      : requestedSkills as LearningSkill[];
    const id = await this.call(() => this.db.rpc<string>("learning_start_session", {
      p_user_id: userId, p_course_id: courseId, p_unit_id: unitId,
      p_mode: mode, p_skills: skills, p_scope: scope as LearningScope, p_schedule_id: scheduleId,
    }));
    return this.getSession(userId, id);
  }

  async getSession(userId: string, sessionId: string): Promise<LearningSession> {
    assertUuid(sessionId, "sessionId");
    const startedAt = Date.now();
    let session: Row;
    try {
      session = await this.call(() => this.db.rpc<Row>("learning_get_session_snapshot", {
        p_user_id: userId,
        p_session_id: sessionId,
      }));
    } catch (error) {
      if (error instanceof SupabaseRequestError && (
        String(error.body && typeof error.body === "object" && "code" in error.body
          ? (error.body as { code: unknown }).code : "") === "P0002"
        || /learning session not found/i.test(error.message)
      )) {
        throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "学习会话不存在" });
      }
      throw error;
    }
    const result: LearningSession = {
      id: session.id, courseId: session.course_id, unitId: session.unit_id,
      mode: session.mode, scope: session.scope, selectedSkills: session.selected_skills,
      stage: session.stage, active: session.active, revision: Number(session.revision || 0),
      state: session.state || {},
      items: (session.items || []).map((item: Row) => ({
        word: this.word(item.word, item.word?.progress),
        position: item.position, recognitionSeen: item.recognition_seen,
        pronunciationPassed: item.pronunciation_passed, translationPassed: item.translation_passed,
        spellingPassed: item.spelling_passed, wrongCount: item.wrong_count,
      })),
    };
    this.logger.log(JSON.stringify({
      event: "learning_session_snapshot",
      durationMs: Date.now() - startedAt,
      itemCount: result.items.length,
      stage: result.stage,
      revision: result.revision,
    }));
    return result;
  }

  async markRecognition(userId: string, sessionId: string, wordId: string): Promise<LearningSessionMutationResult> {
    assertUuid(sessionId, "sessionId"); assertUuid(wordId, "wordId");
    const row = await this.call(() => this.db.rpc<Row>("learning_mark_recognition", {
      p_user_id: userId, p_session_id: sessionId, p_word_id: wordId,
    }));
    return { revision: Number(row.revision), sessionPatch: this.sessionPatch(row.session_patch) };
  }

  async recordAttempt(
    userId: string,
    sessionId: string,
    body: CompatibleLearningAttemptRequest,
  ): Promise<LearningAttemptResult | Row> {
    assertUuid(sessionId, "sessionId");
    assertUuid(body?.wordId || "", "wordId");
    if (!["pronunciation", "translation", "spelling"].includes(body?.skill)) throw new BadRequestException({ code: "INVALID_SKILL", message: "测试类型无效" });
    const legacy = body?.attemptId == null && body?.expectedRevision == null;
    if (legacy) {
      // Keep already-open 0014 browser tabs functional while the immutable
      // API/Web release switches over. This calls the retained service-only
      // five-argument RPC; the database trigger still advances revision.
      return this.call(() => this.db.rpc<Row>("learning_record_attempt", {
        p_user_id: userId, p_session_id: sessionId, p_word_id: body.wordId,
        p_skill: body.skill, p_answer: body.answer || {},
      }));
    }
    assertUuid(body?.attemptId || "", "attemptId");
    if (!Number.isSafeInteger(body?.expectedRevision) || body.expectedRevision! < 0) {
      throw new BadRequestException({ code: "INVALID_REVISION", message: "会话版本无效" });
    }
    const startedAt = Date.now();
    const row = await this.call(() => this.db.rpc<Row>("learning_record_attempt", {
      p_user_id: userId, p_session_id: sessionId, p_word_id: body.wordId,
      p_skill: body.skill, p_answer: body.answer || {},
      p_attempt_id: body.attemptId,
      p_expected_revision: body.expectedRevision,
    }));
    if (row.conflict) {
      this.logger.warn(JSON.stringify({
        event: "learning_attempt_revision_conflict",
        durationMs: Date.now() - startedAt,
        expectedRevision: body.expectedRevision,
        currentRevision: Number(row.current_revision),
      }));
      throw new ConflictException({
        code: "SESSION_REVISION_CONFLICT",
        message: "学习进度已在其它位置更新",
        currentRevision: Number(row.current_revision),
      });
    }
    const result: LearningAttemptResult = {
      attemptId: String(row.attempt_id),
      correct: Boolean(row.correct),
      expected: row.expected as string | string[],
      revision: Number(row.revision),
      replayed: Boolean(row.replayed),
      sessionPatch: this.sessionPatch(row.session_patch),
    };
    this.logger.log(JSON.stringify({
      event: "learning_attempt_committed",
      durationMs: Date.now() - startedAt,
      skill: body.skill,
      correct: result.correct,
      replayed: result.replayed,
      revision: result.revision,
    }));
    return result;
  }

  async createReviewSchedules(userId: string, unitId: string, sourceSessionId: unknown, offsets: unknown): Promise<ReviewSchedule[]> {
    assertUuid(unitId, "unitId");
    const sessionId = assertUuid(String(sourceSessionId || ""), "sourceSessionId");
    const normalized = Array.isArray(offsets) ? offsets.map(Number) : [];
    if (!Array.isArray(offsets) || normalized.length > 4 || new Set(normalized).size !== normalized.length
        || normalized.some((value) => ![3, 7, 15, 30].includes(value))) {
      throw new BadRequestException({ code: "INVALID_OFFSETS", message: "复习日期只能选择 3、7、15、30 天" });
    }
    await this.call(() => this.db.rpc("learning_schedule_reviews", {
      p_user_id: userId, p_unit_id: unitId, p_source_session_id: sessionId, p_offsets: normalized,
    }));
    return this.listReviewSchedules(userId);
  }

  async listReviewSchedules(userId: string): Promise<ReviewSchedule[]> {
    const [rows, courses, units] = await Promise.all([
      this.db.select<Row>("learning_review_schedules", q({ select: "*", user_id: `eq.${userId}`, order: "due_date.asc" })),
      this.db.select<Row>("learning_courses", q({ select: "id,title", user_id: `eq.${userId}` })),
      this.db.select<Row>("learning_course_units", q({ select: "id,name", user_id: `eq.${userId}` })),
    ]);
    const courseMap = new Map(courses.map((row) => [row.id, row.title]));
    const unitMap = new Map(units.map((row) => [row.id, row.name]));
    return rows.map((row) => ({ id: row.id, courseId: row.course_id, unitId: row.unit_id, sourceSessionId: row.source_session_id,
      courseTitle: courseMap.get(row.course_id), unitName: unitMap.get(row.unit_id), dueDate: row.due_date,
      skills: row.skills, scope: row.scope, status: row.status,
      completedSessionId: row.completed_session_id || null, completedAt: row.completed_at }));
  }

  async cancelReviewSchedule(userId: string, id: string) {
    assertUuid(id);
    await this.call(() => this.db.rpc("learning_cancel_review_schedule", {
      p_user_id: userId, p_schedule_id: id,
    }));
    return { ok: true };
  }

  profileSummary(userId: string): Promise<LearningProfileSummary> {
    return this.call(() => this.db.rpc<LearningProfileSummary>("learning_profile_summary", { p_user_id: userId }));
  }

  async createShare(userId: string, courseId: string) {
    const course = await this.requireCourse(userId, assertUuid(courseId, "courseId"));
    if (!course.can_republish) throw new ForbiddenException({ code: "REPUBLISH_FORBIDDEN", message: "克隆课程不能再次分享或上架" });
    const profile = await this.profileName(userId);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const id = await this.call(() => this.db.rpc<string>("learning_create_share", {
      p_user_id: userId, p_course_id: courseId, p_token_hash: tokenHash, p_author_name: profile,
    }));
    const origin = (process.env.PUBLIC_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
    return { id, token, url: `${origin}/shared/courses/${token}` };
  }

  async listShares(userId: string, courseId: string) {
    await this.requireCourse(userId, assertUuid(courseId, "courseId"));
    const rows = await this.db.select<Row>("learning_course_shares", q({
      select: "id,course_id,created_at", user_id: `eq.${userId}`, course_id: `eq.${courseId}`,
      active: "eq.true", order: "created_at.desc",
    }));
    return rows.map((row) => ({ id: row.id, courseId: row.course_id, createdAt: row.created_at }));
  }

  async revokeShare(userId: string, id: string) {
    assertUuid(id);
    await this.call(() => this.db.rpc("learning_revoke_share", {
      p_user_id: userId, p_share_id: id,
    }));
    return { ok: true };
  }

  async publicShare(token: string): Promise<PublicCoursePreview> {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new NotFoundException({ code: "SHARE_NOT_FOUND", message: "分享链接不存在" });
    const hash = createHash("sha256").update(token).digest("hex");
    const rows = await this.db.select<Row>("learning_course_shares", q({ select: "*", token_hash: `eq.${hash}`, active: "eq.true", limit: "1" }));
    const share = rows[0];
    if (!share) throw new NotFoundException({ code: "SHARE_NOT_FOUND", message: "分享链接不存在或已撤销" });
    const snapshot = await this.db.rpc<any>("_learning_course_snapshot", { p_course_id: share.course_id });
    if (!snapshot) throw new NotFoundException({ code: "COURSE_NOT_FOUND", message: "课程不存在" });
    return this.preview(publicSnapshot(snapshot), { shareId: share.id, authorName: share.author_name });
  }

  async cloneShare(userId: string, token: string) {
    const preview = await this.publicShare(token);
    const input = cloneSnapshot(preview, `${preview.title}（副本）`);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const id = await this.call(() => this.db.rpc<string>("learning_clone_share", {
      p_user_id: userId, p_payload: this.enrich(input), p_token_hash: tokenHash,
    }));
    return this.getCourse(userId, id);
  }

  async publish(userId: string, courseId: string, body: any) {
    const course = await this.requireCourse(userId, assertUuid(courseId, "courseId"));
    if (!course.can_republish) throw new ForbiddenException({ code: "REPUBLISH_FORBIDDEN", message: "克隆课程不能再次分享或上架" });
    if (body?.rightsDeclared !== true) throw new BadRequestException({ code: "RIGHTS_REQUIRED", message: "上架前必须确认拥有内容权利" });
    const description = String(body?.description || "").trim();
    if (description.length > 500) throw new BadRequestException({ code: "DESCRIPTION_TOO_LONG", message: "课程简介不能超过 500 字" });
    const authorName = await this.profileName(userId);
    const publication = await this.call(() => this.db.rpc<Row>("learning_publish_course", {
      p_user_id: userId, p_course_id: courseId, p_description: description,
      p_author_name: authorName, p_rights_declared: true,
      p_daily_limit: positiveEnvironmentNumber("COURSE_MARKET_DAILY_PUBLISH_LIMIT", 5, true),
    }));
    return this.preview(publicSnapshot(publication.snapshot), {
      publicationId: publication.id, authorName: publication.authorName,
      description: publication.description, version: publication.version,
      cloneCount: 0, createdAt: publication.createdAt,
    });
  }

  async market(): Promise<PublicCoursePreview[]> {
    const rows = await this.db.select<Row>("learning_course_publications", q({ select: "*", status: "eq.published", order: "created_at.desc", limit: "100" }));
    return rows.map((row) => this.preview(publicSnapshot(row.snapshot), { publicationId: row.id, authorName: row.author_name,
      description: row.description, version: row.version, cloneCount: row.clone_count, createdAt: row.created_at }));
  }

  async clonePublication(userId: string, id: string) {
    assertUuid(id);
    const rows = await this.db.select<Row>("learning_course_publications", q({ select: "*", id: `eq.${id}`, status: "eq.published", limit: "1" }));
    const publication = rows[0];
    if (!publication) throw new NotFoundException({ code: "PUBLICATION_NOT_FOUND", message: "市场课程不存在" });
    const input = cloneSnapshot(publication.snapshot, `${publication.title}（副本）`);
    const courseId = await this.call(() => this.db.rpc<string>("learning_clone_course", {
      p_user_id: userId, p_payload: this.enrich(input), p_origin_publication_id: id,
      p_origin_author_name: publication.author_name,
    }));
    return this.getCourse(userId, courseId);
  }

  async report(userId: string, body: any) {
    const publicationId = body?.publicationId ? assertUuid(String(body.publicationId), "publicationId") : null;
    const shareId = body?.shareId ? assertUuid(String(body.shareId), "shareId") : null;
    if (Boolean(publicationId) === Boolean(shareId)) throw new BadRequestException({ code: "INVALID_REPORT_TARGET", message: "请选择一个举报对象" });
    const category = String(body?.category || "other");
    if (!["abuse", "copyright", "privacy", "spam", "academic_integrity", "other"].includes(category)) throw new BadRequestException({ code: "INVALID_REPORT_CATEGORY", message: "举报类别无效" });
    const details = String(body?.details || "").trim();
    if (details.length > 1000) throw new BadRequestException({ code: "REPORT_DETAILS_TOO_LONG", message: "举报说明不能超过 1000 个字符" });
    const row = await this.call(() => this.db.rpc<Row>("learning_create_report", {
      p_user_id: userId, p_publication_id: publicationId, p_share_id: shareId,
      p_category: category, p_details: details,
      p_daily_limit: positiveEnvironmentNumber("COURSE_REPORT_DAILY_LIMIT", 20, true),
      p_alert_threshold: positiveEnvironmentNumber("COURSE_REPORT_ALERT_THRESHOLD", 3, true),
    }));
    if (row.thresholdReached) {
      console.warn(JSON.stringify({ event: "course_report_threshold", publicationId, shareId, openCount: row.openCount }));
    }
    return { id: row.id, status: row.status };
  }

  async moderate(userId: string, id: string, body: any) {
    const admins = new Set((process.env.COURSE_MARKET_ADMIN_USER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
    if (!admins.has(userId)) throw new ForbiddenException({ code: "ADMIN_REQUIRED", message: "需要课程市场管理员权限" });
    assertUuid(id);
    const action = String(body?.action || "");
    const reason = String(body?.reason || "").trim();
    if (!['hide', 'restore', 'withdraw'].includes(action) || !reason || reason.length > 1000) throw new BadRequestException({ code: "INVALID_MODERATION", message: "审核动作或原因无效" });
    return this.call(() => this.db.rpc("learning_moderate_publication", {
      p_actor_id: userId, p_publication_id: id, p_action: action, p_reason: reason,
    }));
  }

  async ownedWordInSession(userId: string, sessionId: string, wordId: string) {
    assertUuid(sessionId, "sessionId"); assertUuid(wordId, "wordId");
    try {
      return await this.call(() => this.db.rpc<Row>("learning_get_assessment_target", {
        p_user_id: userId,
        p_session_id: sessionId,
        p_word_id: wordId,
      }));
    } catch (error) {
      if (error instanceof SupabaseRequestError && (
        String(error.body && typeof error.body === "object" && "code" in error.body
          ? (error.body as { code: unknown }).code : "") === "42501"
      )) {
        throw new ForbiddenException({ code: "WORD_NOT_IN_SESSION", message: "该词不属于当前活动学习会话" });
      }
      throw error;
    }
  }

  async recordSpeechAssessment(userId: string, sessionId: string, wordId: string, assessment: unknown) {
    assertUuid(sessionId, "sessionId"); assertUuid(wordId, "wordId");
    const row = await this.call(() => this.db.rpc<Row>("learning_record_speech_assessment", {
      p_user_id: userId, p_session_id: sessionId, p_word_id: wordId,
      p_assessment: assessment,
    }));
    return {
      recorded: Boolean(row.recorded),
      correct: Boolean(row.correct),
      retryQueued: Boolean(row.retry_queued),
      passThreshold: Number(row.pass_threshold),
      revision: Number(row.revision),
      sessionPatch: this.sessionPatch(row.session_patch),
    };
  }

  async reserveSpeechQuota(userId: string | null, kind: "tts" | "assessment", costMicrousd: number) {
    if (!Number.isFinite(costMicrousd) || costMicrousd <= 0) {
      throw new ServiceUnavailableException({ code: "SERVER_MISCONFIG", message: "Invalid speech cost reservation" });
    }
    return this.call(() => this.db.rpc("learning_reserve_speech_quota", {
      p_user_id: userId,
      p_kind: kind,
      p_cost_microusd: Math.max(1, Math.round(costMicrousd)),
      p_minute_limit: positiveEnvironmentNumber("AZURE_SPEECH_ASSESSMENTS_PER_MINUTE", 30, true),
      p_day_limit: positiveEnvironmentNumber("AZURE_SPEECH_ASSESSMENTS_PER_DAY", 300, true),
      p_month_budget_microusd: positiveEnvironmentNumber("AZURE_SPEECH_MONTHLY_BUDGET_MICRO_USD", 5_000_000, true),
    }));
  }

  async reserveTtsQuota(characterCount: number, costMicrousd: number) {
    if (!Number.isSafeInteger(characterCount) || characterCount <= 0
        || !Number.isFinite(costMicrousd) || costMicrousd <= 0) {
      throw new ServiceUnavailableException({ code: "SERVER_MISCONFIG", message: "Invalid TTS quota reservation" });
    }
    return this.call(() => this.db.rpc("learning_reserve_tts_quota", {
      p_character_count: characterCount,
      p_cost_microusd: Math.max(1, Math.round(costMicrousd)),
      p_minute_limit: positiveEnvironmentNumber("AZURE_SPEECH_TTS_REQUESTS_PER_MINUTE", 20, true),
      p_month_character_limit: positiveEnvironmentNumber("AZURE_SPEECH_TTS_MONTHLY_CHAR_LIMIT", 500_000, true),
      p_month_budget_microusd: positiveEnvironmentNumber("AZURE_SPEECH_MONTHLY_BUDGET_MICRO_USD", 5_000_000, true),
    }));
  }

  private sessionPatch(row: Row | null | undefined): LearningSessionPatch {
    if (!row) throw new ServiceUnavailableException({ code: "DATABASE_ERROR", message: "Session patch is missing" });
    const changed = row.changed_item;
    return {
      stage: row.stage,
      active: Boolean(row.active),
      state: row.state || {},
      changedItem: changed ? {
        wordId: changed.word_id,
        recognitionSeen: Boolean(changed.recognition_seen),
        pronunciationPassed: Boolean(changed.pronunciation_passed),
        translationPassed: Boolean(changed.translation_passed),
        spellingPassed: Boolean(changed.spelling_passed),
        wrongCount: Number(changed.wrong_count || 0),
      } : null,
      nextWordId: row.next_word_id || null,
    };
  }

  private summary(course: Row, unitCount: number, wordCount: number, learnedCount: number, activeSessionId: string | null): LearningCourseSummary {
    return { id: course.id, title: course.title, category: course.category, hasUnits: course.has_units,
      locale: course.locale, unitCount, wordCount, learnedCount,
      progressPercent: wordCount ? Math.round(learnedCount / wordCount * 100) : 0,
      activeSessionId, canRepublish: course.can_republish,
      originPublicationId: course.origin_publication_id || null,
      originShareId: course.origin_share_id || null,
      originAuthorName: course.origin_author_name || null, updatedAt: course.updated_at };
  }

  private word(word: Row | undefined, progress?: Row) {
    if (!word) throw new NotFoundException({ code: "WORD_NOT_FOUND", message: "单词不存在" });
    return { id: word.id, term: word.term, normalizedTerm: word.normalized_term,
      translations: word.translations || [], ipa: word.ipa || null, position: word.position,
      progress: { recognitionSeen: Boolean(progress?.initial_recognition_seen),
        initialPronunciationPassed: Boolean(progress?.initial_pronunciation_passed),
        initialTranslationPassed: Boolean(progress?.initial_translation_passed),
        initialSpellingPassed: Boolean(progress?.initial_spelling_passed),
        pronunciationReviewDates: progress?.pronunciation_review_dates || [],
        translationReviewDates: progress?.translation_review_dates || [],
        spellingReviewDates: progress?.spelling_review_dates || [], wrongCount: Number(progress?.wrong_count || 0),
        reviewCount: Number(progress?.review_count || 0), learnedAt: progress?.learned_at || null } };
  }

  private async requireCourse(userId: string, courseId: string): Promise<Row> {
    const rows = await this.db.select<Row>("learning_courses", q({ select: "*", id: `eq.${courseId}`, user_id: `eq.${userId}`, limit: "1" }));
    if (!rows[0]) throw new NotFoundException({ code: "COURSE_NOT_FOUND", message: "课程不存在" });
    return rows[0];
  }

  private async profileName(userId: string) {
    const rows = await this.db.select<Row>("profiles", q({ select: "username,email", id: `eq.${userId}`, limit: "1" }));
    return rows[0]?.username || String(rows[0]?.email || "Nalanda learner").split("@")[0];
  }

  private preview(snapshot: any, meta: any): PublicCoursePreview {
    const units = snapshot.units || [];
    const wordCount = units.reduce((sum: number, unit: any) => sum + (unit.words || []).length, 0);
    return { id: meta.publicationId || meta.shareId, title: snapshot.title, description: meta.description || "",
      authorName: meta.authorName, category: "english_vocabulary", hasUnits: Boolean(snapshot.hasUnits), locale: "en-US",
      version: Number(meta.version || 1), unitCount: units.length, wordCount,
      cloneCount: Number(meta.cloneCount || 0), createdAt: meta.createdAt || new Date(0).toISOString(),
      units, shareId: meta.shareId, publicationId: meta.publicationId };
  }
}
