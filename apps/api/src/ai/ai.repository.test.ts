import { describe, expect, it, vi } from "vitest";
import { AiRepository } from "./ai.repository";

const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

describe("Materials AI repository resume boundary", () => {
  it.each([
    ["AI_RESUME_EXPIRED", "expired"],
    ["AI_WORKER_RETRY_EXHAUSTED", "cannot be resumed"],
  ])("maps persisted terminal resume state %s to a public conflict", async (errorCode, message) => {
    const db = { rpc: vi.fn().mockResolvedValue([{
      id: JOB, status: "failed", retryable: false, error_code: errorCode,
    }]) };
    const repository = new AiRepository(db as any);

    await expect(repository.retryJob(USER, JOB)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: errorCode, message: expect.stringContaining(message) }),
    });
  });

  it("returns the same queued job after a resumable retry", async () => {
    const row = { id: JOB, status: "queued", retryable: false, error_code: null };
    const db = { rpc: vi.fn().mockResolvedValue([row]) };
    const repository = new AiRepository(db as any);

    await expect(repository.retryJob(USER, JOB)).resolves.toBe(row);
    expect(db.rpc).toHaveBeenCalledWith("ai_retry_generation_job", {
      p_user_id: USER,
      p_job_id: JOB,
    });
  });

  it("never returns provisional grading facts while an exam is in progress", () => {
    const repository = new AiRepository({} as any);
    const exam = {
      schemaVersion: "generated-exam.v1", sourceMode: "native_file", title: "Private key",
      language: "en", difficulty: "mixed", durationMinutes: 30, totalMarks: 20, instructions: [],
      sections: [{ id: "s1", title: "Section", instructions: "", questions: [{
        id: "q1", type: "single_choice", prompt: "Choose one", marks: 20, options: ["A", "B"],
        correctOptionIndexes: [1], acceptedAnswers: [], modelAnswer: "B", explanation: "Because B.",
        rubric: ["Choose B"], sourceRefs: [{ blockId: "", page: 1, slide: null, label: "Page 1" }],
      }] }],
    };
    const base = {
      attempt: {
        id: "attempt", note_id: "note", status: "in_progress", revision: 1,
        deadline_at: new Date(Date.now() + 60_000).toISOString(), submitted_at: null,
        completed_at: null, objective_score: 0, objective_marks: 0, total_score: null, total_marks: 20,
      },
      note: {}, artifact: { content: exam },
      answers: [{ question_id: "q1", answer: 1, awarded_marks: 20, correct: true, feedback: "Correct" }],
    };

    const drafting = repository.attemptResponse(base as any);
    expect(drafting.results).toEqual([]);
    expect(JSON.stringify(drafting.exam)).not.toMatch(/correctOptionIndexes|acceptedAnswers|modelAnswer|explanation|rubric/);
    const completed = repository.attemptResponse({
      ...base, attempt: { ...base.attempt, status: "completed", submitted_at: new Date().toISOString() },
    } as any);
    expect(completed.results).toEqual([{ questionId: "q1", awardedMarks: 20, correct: true, feedback: "Correct" }]);
  });
});
