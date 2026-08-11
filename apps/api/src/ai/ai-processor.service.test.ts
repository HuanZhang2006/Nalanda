import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedExamV1 } from "@nalanda/types";
import { AiInternalClientService, AiWorkerError } from "./ai-internal-client.service";
import { AiProcessorService } from "./ai-processor.service";

const exam: GeneratedExamV1 = {
  schemaVersion: "generated-exam.v1", title: "Test", language: "en", difficulty: "mixed",
  durationMinutes: 60, totalMarks: 20, instructions: [], sections: [{ id: "s", title: "Section", instructions: "", questions: [{
    id: "q1", type: "short_answer", prompt: "Explain", marks: 20, options: [], correctOptionIndexes: [], acceptedAnswers: [],
    modelAnswer: "Answer", explanation: "Explanation", rubric: ["Concept"], sourceRefs: [{ blockId: "b1", page: 1, slide: null, label: "Page 1" }],
  }] }],
};

function harness() {
  const repository = {
    claimJob: vi.fn().mockResolvedValue({ id: "job-1", user_id: "user-1", material_id: "material-1", settings: {} }),
    monthlyProviderCostMicroUsd: vi.fn().mockResolvedValue(0),
    materialForJob: vi.fn().mockResolvedValue({ id: "material-1", name: "source.pdf", type: "pdf", size_bytes: 100, storage_path: "user/source.pdf" }),
    signMaterial: vi.fn().mockResolvedValue("https://storage.example/source.pdf?token=private"),
    cachedDocument: vi.fn().mockResolvedValue(null), completeJob: vi.fn().mockResolvedValue("note-1"), failJob: vi.fn().mockResolvedValue(undefined),
    claimGrading: vi.fn().mockResolvedValue({ id: "attempt-1" }),
    attemptContext: vi.fn().mockResolvedValue({
      artifact: { content: exam }, attempt: { id: "attempt-1", user_id: "user-1", status: "grading", revision: 1, deadline_at: new Date(0).toISOString() },
      answers: [{ question_id: "q1", answer: "Learner answer" }], note: {},
    }),
    completeGrading: vi.fn().mockResolvedValue(undefined), failGrading: vi.fn().mockResolvedValue(undefined),
    submitAttempt: vi.fn().mockResolvedValue({ status: "completed" }), updateJob: vi.fn(),
  };
  const worker = {
    generate: vi.fn().mockResolvedValue({
      sourceSha256: "a".repeat(64), parserVersion: "parser-v1", auditVersion: "audit-v1", document: {}, blockCount: 1,
      visualRegionCount: 0, exam, questionCount: 1, totalMarks: 20,
      usageEvents: [{ purpose: "exam_generation", costMicroUsd: 10_000 }],
    }),
    grade: vi.fn().mockResolvedValue({
      subjectiveScore: 15, results: [{ questionId: "q1", awardedMarks: 15, correct: true, feedback: "Good" }],
      usageEvents: [{ purpose: "exam_grading", costMicroUsd: 2_000 }],
    }),
  };
  return { repository, worker, service: new AiProcessorService(repository as any, worker as unknown as AiInternalClientService) };
}

describe("Materials AI durable processor", () => {
  beforeEach(() => {
    process.env.MATERIAL_AI_MONTHLY_BUDGET_USD = "20";
    process.env.MATERIAL_AI_GENERATION_MAX_COST_USD = "0.50";
    process.env.MATERIAL_AI_GRADING_MAX_COST_USD = "0.05";
    process.env.AI_INTERNAL_TOKEN = "test-internal-token";
  });
  afterEach(() => vi.restoreAllMocks());

  it("completes a claimed generation only after the worker returns a bounded result", async () => {
    const { service, repository, worker } = harness();
    await service.generation("job-1");
    expect(worker.generate).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1", material: expect.objectContaining({ id: "material-1", signedUrl: expect.stringContaining("token=private") }),
    }));
    expect(repository.completeJob).toHaveBeenCalledWith("job-1", expect.any(String), expect.objectContaining({ questionCount: 1 }));
    expect(repository.failJob).not.toHaveBeenCalled();
  });

  it("records the stable failure and provider usage so the database can release the reserved allowance", async () => {
    const { service, repository, worker } = harness();
    worker.generate.mockRejectedValue(new AiWorkerError("PROMPT_INJECTION_REJECTED", "Unsafe source", [{
      purpose: "parse_audit", status: "succeeded", costMicroUsd: 2_000,
    }]));
    await service.generation("job-1");
    expect(repository.completeJob).not.toHaveBeenCalled();
    expect(repository.failJob).toHaveBeenCalledWith("job-1", expect.any(String), "PROMPT_INJECTION_REJECTED", "Unsafe source", [
      expect.objectContaining({ costMicroUsd: 2_000 }),
    ]);
  });

  it("opens the monthly budget circuit before contacting the provider", async () => {
    const { service, repository, worker } = harness();
    repository.monthlyProviderCostMicroUsd.mockResolvedValue(20_000_000);
    await service.generation("job-1");
    expect(worker.generate).not.toHaveBeenCalled();
    expect(repository.failJob).toHaveBeenCalledWith("job-1", expect.any(String), "AI_MONTHLY_BUDGET_REACHED", expect.any(String), []);
  });

  it("commits successful subjective grading and releases a failed grading reservation", async () => {
    const first = harness();
    await first.service.grading("attempt-1");
    expect(first.repository.completeGrading).toHaveBeenCalledWith(
      "attempt-1", expect.any(String), 15, expect.any(Array), expect.any(Array),
    );

    const second = harness();
    second.worker.grade.mockRejectedValue(new AiWorkerError("OPENROUTER_ZDR_UNAVAILABLE", "No compliant endpoint", [{
      purpose: "exam_grading", status: "failed", costMicroUsd: 0,
    }]));
    await second.service.grading("attempt-1");
    expect(second.repository.failGrading).toHaveBeenCalledWith("attempt-1", expect.any(String), [
      expect.objectContaining({ purpose: "exam_grading" }),
    ]);
  });
});
