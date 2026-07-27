import { afterEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { LearningService } from "./learning.service";
import { SupabaseRequestError } from "./supabase-admin.service";

const courseId = "11111111-1111-4111-8111-111111111111";
const publicationId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const token = "abcdefghijklmnopqrstuvwxyzABCDE_0123456789-xy";

function service() {
  const db = { select: vi.fn(), rpc: vi.fn(), update: vi.fn(), delete: vi.fn(), insert: vi.fn() };
  const value = new LearningService(db as any, { lookup: vi.fn(() => null) } as any);
  return { value, db };
}

afterEach(() => {
  delete process.env.COURSE_MARKET_ADMIN_USER_IDS;
  delete process.env.AZURE_SPEECH_ASSESSMENTS_PER_DAY;
});

describe("LearningService ownership and public boundaries", () => {
  it("treats another user's course as not found", async () => {
    const { value, db } = service(); db.select.mockResolvedValue([]);
    await expect(value.getCourse("user-a", courseId)).rejects.toBeInstanceOf(NotFoundException);
    expect(String(db.select.mock.calls[0][1])).toContain("user_id=eq.user-a");
  });

  it("returns a de-identified live share and rejects a revoked token", async () => {
    const { value, db } = service();
    db.select.mockResolvedValueOnce([{ id: publicationId, course_id: courseId, author_name: "Alice" }]);
    db.rpc.mockResolvedValueOnce({ id: courseId, title: "Shared", hasUnits: false, units: [{ id: "private-unit", name: "词表", position: 0,
      words: [{ id: "private-word", term: "apple", translations: ["苹果"], ipa: null, progress: { wrongCount: 4 } }] }] });
    const preview = await value.publicShare(token);
    expect(preview.authorName).toBe("Alice"); expect(preview.hasUnits).toBe(false);
    expect(preview.units[0].words[0]).toEqual({ term: "apple", translations: ["苹果"], ipa: null });
    db.select.mockReset(); db.select.mockResolvedValue([]);
    await expect(value.publicShare(token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("removes private course, unit, word, and progress fields from the public market response", async () => {
    const { value, db } = service();
    db.select.mockResolvedValue([{ id: publicationId, title: "Market", author_name: "Alice", description: "Free", version: 1,
      clone_count: 0, created_at: new Date(0).toISOString(), snapshot: { id: courseId, title: "Market", hasUnits: false,
        units: [{ id: "private-unit", name: "默认单元", position: 0, isSystem: true, words: [{ id: "private-word", term: "apple",
          normalizedTerm: "apple", translations: ["苹果"], ipa: null, progress: { wrongCount: 7 } }] }] } }]);
    const [preview] = await value.market();
    expect(preview.units[0].words[0]).toEqual({ term: "apple", translations: ["苹果"], ipa: null });
    expect(preview.units[0]).not.toHaveProperty("id");
    expect(preview).not.toHaveProperty("courseId");
  });

  it("clones a snapshot through one transaction with new ids and republishing disabled", async () => {
    const { value, db } = service();
    vi.spyOn(value, "publicShare").mockResolvedValue({ id: publicationId, shareId: publicationId, title: "Shared", description: "", authorName: "Alice",
      category: "english_vocabulary", hasUnits: false, locale: "en-US", version: 1, unitCount: 1, wordCount: 4, cloneCount: 0,
      createdAt: new Date(0).toISOString(), units: [{ name: "词表", position: 0, isSystem: true, words: ["apple", "pear", "orange", "banana"].map((term) => ({ term, translations: [term], ipa: null })) }] });
    db.rpc.mockResolvedValue(courseId); vi.spyOn(value, "getCourse").mockResolvedValue({ id: courseId } as any);
    await value.cloneShare("user-a", token);
    const [name, payload] = db.rpc.mock.calls[0];
    expect(name).toBe("learning_clone_share"); expect(payload.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.p_payload.id).not.toBe(publicationId); expect(payload.p_payload.units[0].words[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses transactional RPCs for share rotation, publication, reports, and audited moderation", async () => {
    const { value, db } = service();
    vi.spyOn(value as any, "requireCourse").mockResolvedValue({ id: courseId, title: "Course", can_republish: true });
    vi.spyOn(value as any, "profileName").mockResolvedValue("Alice");
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "learning_create_share") return publicationId;
      if (name === "learning_publish_course") return { id: publicationId, version: 1, authorName: "Alice", description: "Free",
        createdAt: new Date(0).toISOString(), snapshot: { title: "Course", hasUnits: false, units: [] } };
      if (name === "learning_create_report") return { id: publicationId, status: "open", openCount: 1, thresholdReached: false };
      if (name === "learning_moderate_publication") return { ok: true, status: "hidden" };
      return null;
    });
    await value.createShare("user-a", courseId);
    await value.publish("user-a", courseId, { description: "Free", rightsDeclared: true });
    await value.report("user-a", { publicationId, category: "spam", details: "spam" });
    process.env.COURSE_MARKET_ADMIN_USER_IDS = "user-a";
    await value.moderate("user-a", publicationId, { action: "hide", reason: "confirmed" });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
      "learning_create_share", "learning_publish_course", "learning_create_report", "learning_moderate_publication",
    ]));
    expect(db.insert).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
  });

  it("clones a published market snapshot with attribution and no reused content ids", async () => {
    const { value, db } = service();
    db.select.mockResolvedValueOnce([{ id: publicationId, title: "Market course", author_name: "Alice", status: "published",
      snapshot: { title: "Market course", hasUnits: false, units: [{ name: "默认单元", isSystem: true,
        words: ["apple", "pear", "orange", "banana"].map((term) => ({ term, translations: [term], ipa: null })) }] } }]);
    db.rpc.mockResolvedValueOnce(courseId);
    vi.spyOn(value, "getCourse").mockResolvedValue({ id: courseId } as any);
    await value.clonePublication("user-b", publicationId);
    expect(db.rpc).toHaveBeenCalledWith("learning_clone_course", expect.objectContaining({
      p_user_id: "user-b", p_origin_publication_id: publicationId, p_origin_author_name: "Alice",
    }));
    const payload = db.rpc.mock.calls[0][1].p_payload;
    expect(payload.id).not.toBe(publicationId);
    expect(new Set(payload.units[0].words.map((word: any) => word.id)).size).toBe(4);
  });

  it("maps persistent publish and speech quota failures to stable 429 errors", async () => {
    const { value, db } = service();
    vi.spyOn(value as any, "requireCourse").mockResolvedValue({ id: courseId, can_republish: true });
    vi.spyOn(value as any, "profileName").mockResolvedValue("Alice");
    db.rpc.mockRejectedValueOnce(new SupabaseRequestError("course publication daily quota exceeded", 400, { code: "P0001" }));
    await expect(value.publish("user-a", courseId, { rightsDeclared: true })).rejects.toMatchObject({
      status: 429, response: { code: "PUBLISH_LIMIT" },
    } satisfies Partial<HttpException>);
    db.rpc.mockRejectedValueOnce(new SupabaseRequestError("speech monthly budget exceeded", 400, { code: "P0001" }));
    await expect(value.reserveSpeechQuota("user-a", "assessment", 1)).rejects.toMatchObject({
      status: 429, response: { code: "SPEECH_QUOTA_EXCEEDED" },
    } satisfies Partial<HttpException>);
  });

  it("rejects ambiguous session, schedule, and report inputs before any database write", async () => {
    const { value, db } = service();
    await expect(value.startSession("user-a", courseId, { unitId: publicationId, mode: "quiz", scope: "all" }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(value.startSession("user-a", courseId, { unitId: publicationId, mode: "review", scope: "future", skills: ["spelling"] }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(value.startSession("user-a", courseId, { unitId: publicationId, mode: "review", scope: "all", skills: ["spelling", "spelling"] }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(value.createReviewSchedules("user-a", publicationId, courseId, [3, 3]))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(value.report("user-a", { publicationId, category: "other", details: "x".repeat(1001) }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects pronunciation assessment lookup outside an active owned session before provider work", async () => {
    const { value, db } = service();
    db.rpc.mockRejectedValue(new SupabaseRequestError(
      "active assessment target not found", 403, { code: "42501" },
    ));
    await expect(value.ownedWordInSession("user-a", publicationId, courseId))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(db.rpc).toHaveBeenCalledWith("learning_get_assessment_target", {
      p_user_id: "user-a", p_session_id: publicationId, p_word_id: courseId,
    });
  });

  it("fails closed when a persistent quota environment value is invalid", async () => {
    const { value, db } = service();
    process.env.AZURE_SPEECH_ASSESSMENTS_PER_DAY = "not-a-number";
    await expect(value.reserveSpeechQuota("user-a", "assessment", 1))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("loads a complete learning session through one snapshot RPC", async () => {
    const { value, db } = service();
    db.rpc.mockResolvedValue({
      id: publicationId,
      course_id: courseId,
      unit_id: publicationId,
      mode: "initial",
      scope: "all",
      selected_skills: ["pronunciation", "translation", "spelling"],
      stage: "translation",
      active: true,
      revision: 7,
      state: { queue: [attemptId], cursor: 0, nextQueue: [], round: 1 },
      items: [{
        position: 0,
        recognition_seen: true,
        pronunciation_passed: true,
        translation_passed: false,
        spelling_passed: false,
        wrong_count: 1,
        word: {
          id: attemptId, term: "apple", normalized_term: "apple",
          translations: ["苹果"], ipa: "ˈæpəl", position: 0,
          progress: {
            initial_recognition_seen: true,
            initial_pronunciation_passed: true,
            initial_translation_passed: false,
            initial_spelling_passed: false,
            pronunciation_review_dates: [],
            translation_review_dates: [],
            spelling_review_dates: [],
            wrong_count: 1,
            review_count: 0,
            learned_at: null,
          },
        },
      }],
    });
    await expect(value.getSession("user-a", publicationId)).resolves.toMatchObject({
      id: publicationId,
      revision: 7,
      items: [{
        word: {
          term: "apple",
          progress: {
            recognitionSeen: true,
            initialPronunciationPassed: true,
            wrongCount: 1,
          },
        },
        wrongCount: 1,
      }],
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("maps an idempotent attempt patch and surfaces revision conflicts as 409", async () => {
    const { value, db } = service();
    const request = {
      attemptId,
      expectedRevision: 4,
      wordId: publicationId,
      skill: "spelling" as const,
      answer: { text: "apple" },
    };
    db.rpc.mockResolvedValueOnce({
      attempt_id: attemptId,
      correct: true,
      expected: "apple",
      revision: 5,
      replayed: false,
      session_patch: {
        stage: "completed", active: false, state: {},
        changed_item: {
          word_id: publicationId, recognition_seen: true,
          pronunciation_passed: true, translation_passed: true,
          spelling_passed: true, wrong_count: 0,
        },
        next_word_id: null,
      },
    });
    await expect(value.recordAttempt("user-a", courseId, request)).resolves.toMatchObject({
      attemptId,
      revision: 5,
      sessionPatch: { stage: "completed", active: false },
    });
    expect(db.rpc).toHaveBeenCalledWith("learning_record_attempt", expect.objectContaining({
      p_attempt_id: attemptId,
      p_expected_revision: 4,
    }));

    db.rpc.mockResolvedValueOnce({ conflict: true, current_revision: 8 });
    await expect(value.recordAttempt("user-a", courseId, request)).rejects.toMatchObject({
      status: 409,
      response: { code: "SESSION_REVISION_CONFLICT", currentRevision: 8 },
    });
  });

  it("keeps complete legacy attempts working during the immutable Web/API switchover", async () => {
    const { value, db } = service();
    db.rpc.mockResolvedValue({
      correct: true,
      expected: ["苹果"],
      stage: "translation",
      completed: false,
    });
    await expect(value.recordAttempt("user-a", courseId, {
      wordId: publicationId,
      skill: "translation",
      answer: { translations: ["苹果"] },
    })).resolves.toMatchObject({ correct: true, stage: "translation" });
    expect(db.rpc).toHaveBeenCalledWith("learning_record_attempt", {
      p_user_id: "user-a",
      p_session_id: courseId,
      p_word_id: publicationId,
      p_skill: "translation",
      p_answer: { translations: ["苹果"] },
    });
  });
});
