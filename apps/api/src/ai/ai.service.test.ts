import { describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import { AiService } from "./ai.service";

const USER = "11111111-1111-4111-8111-111111111111";
const MATERIAL = "22222222-2222-4222-8222-222222222222";
const NOTE = "33333333-3333-4333-8333-333333333333";
const ATTEMPT = "44444444-4444-4444-8444-444444444444";

function harness() {
  const attempt = {
    id: ATTEMPT, user_id: USER, note_id: NOTE, status: "in_progress", revision: 2,
    deadline_at: new Date(Date.now() + 60_000).toISOString(), objective_score: 0,
    objective_marks: 0, total_score: null, total_marks: 20,
  };
  const exam = {
    schemaVersion: "generated-exam.v1", title: "Exam", language: "en", difficulty: "mixed",
    durationMinutes: 60, totalMarks: 20, instructions: [], sections: [{ id: "s", title: "S", instructions: "", questions: [{
      id: "q1", type: "single_choice", prompt: "Question", marks: 20, options: ["A", "B"],
      correctOptionIndexes: [0], acceptedAnswers: [], modelAnswer: "A", explanation: "", rubric: [], sourceRefs: [],
    }] }],
  };
  const context = { attempt, note: {}, answers: [], artifact: { content: exam } };
  const repository = {
    ownedMaterial: vi.fn().mockResolvedValue({ id: MATERIAL, user_id: USER, name: "lesson.pdf", size_bytes: 100 }),
    createJob: vi.fn().mockResolvedValue({ id: "job-1", material_id: MATERIAL, material_name: "lesson.pdf", status: "queued", stage: "queued", progress: 0, settings: {} }),
    job: vi.fn((row) => row), quota: vi.fn(), listJobs: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(),
    listNotes: vi.fn(), note: vi.fn(), deleteNote: vi.fn(), deleteMaterialRecord: vi.fn(),
    deleteCourseRecord: vi.fn(), deleteStorage: vi.fn(), createAttempt: vi.fn(), listAttempts: vi.fn(),
    attemptContext: vi.fn().mockResolvedValue(context),
    attemptResponse: vi.fn((context) => context.attempt), saveAnswers: vi.fn(), submitAttempt: vi.fn().mockResolvedValue({ status: "completed" }),
    requestGrading: vi.fn(),
  };
  const queue = { enqueueGeneration: vi.fn().mockResolvedValue(undefined), enqueueTimeout: vi.fn(), enqueueGrading: vi.fn() };
  const flags = { materialAi: vi.fn() };
  return { repository, queue, flags, service: new AiService(repository as any, queue as any, flags as any), attempt, context };
}

const request = () => ({
  idempotencyKey: "55555555-5555-4555-8555-555555555555", kind: "exam", consentVersion: 1,
  settings: { language: "auto", difficulty: "mixed", durationMinutes: 60, totalMarks: 20,
    questionCounts: { singleChoice: 5, multipleChoice: 0, trueFalse: 0, fillBlank: 0, shortAnswer: 0, essay: 0 },
    answerDetail: "detailed", focus: "" },
});

describe("Materials AI public service boundary", () => {
  it("checks owner metadata, persists an idempotent job, and tolerates immediate Redis dispatch loss", async () => {
    const { service, repository, queue } = harness();
    queue.enqueueGeneration.mockRejectedValueOnce(new Error("redis offline"));
    await expect(service.createJob(USER, MATERIAL, request())).resolves.toMatchObject({ id: "job-1" });
    expect(repository.ownedMaterial).toHaveBeenCalledWith(USER, MATERIAL);
    expect(repository.createJob).toHaveBeenCalledWith(USER, MATERIAL, request().idempotencyKey, expect.stringMatching(/^[0-9a-f]{64}$/), "exam", request().settings, 1);
  });

  it("rejects legacy Office formats before reserving quota", async () => {
    const { service, repository } = harness();
    repository.ownedMaterial.mockResolvedValue({ id: MATERIAL, user_id: USER, name: "legacy.doc", size_bytes: 100 });
    await expect(service.createJob(USER, MATERIAL, request())).rejects.toMatchObject({ response: expect.objectContaining({ code: "AI_FILE_TYPE_UNSUPPORTED" }) });
    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it("uses the server deadline to force submission even when the delayed queue is unavailable", async () => {
    const { service, repository, attempt, context } = harness();
    attempt.deadline_at = new Date(Date.now() - 1).toISOString();
    repository.attemptContext
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce({ ...context, attempt: { ...attempt, status: "completed", revision: 3 } });
    repository.attemptResponse.mockImplementation((context) => context.attempt);

    await expect(service.attempt(USER, ATTEMPT)).resolves.toMatchObject({ status: "completed", revision: 3 });
    expect(repository.submitAttempt).toHaveBeenCalledWith(
      USER, ATTEMPT, expect.any(String), 2, expect.any(Array), 0, 20, false,
    );
  });

  it("reloads the authoritative revision once when an autosave races deadline submission", async () => {
    const { service, repository, attempt, context } = harness();
    attempt.deadline_at = new Date(Date.now() - 1).toISOString();
    const revisionThree = { ...context, attempt: { ...attempt, revision: 3 } };
    const completed = { ...context, attempt: { ...attempt, status: "completed", revision: 4 } };
    repository.attemptContext
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce(revisionThree)
      .mockResolvedValueOnce(completed);
    repository.submitAttempt
      .mockRejectedValueOnce(new ConflictException({
        code: "EXAM_REVISION_CONFLICT",
        message: "This exam was updated elsewhere",
      }))
      .mockResolvedValueOnce({ status: "completed" });
    repository.attemptResponse.mockImplementation((value) => value.attempt);

    await expect(service.attempt(USER, ATTEMPT)).resolves.toMatchObject({ status: "completed", revision: 4 });
    expect(repository.submitAttempt).toHaveBeenNthCalledWith(
      1, USER, ATTEMPT, expect.any(String), 2, expect.any(Array), 0, 20, false,
    );
    expect(repository.submitAttempt).toHaveBeenNthCalledWith(
      2, USER, ATTEMPT, expect.any(String), 3, expect.any(Array), 0, 20, false,
    );
  });
});
