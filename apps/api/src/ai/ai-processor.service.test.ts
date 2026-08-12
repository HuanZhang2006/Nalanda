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
    claimJob: vi.fn().mockResolvedValue({ id: "job-1", kind: "exam", user_id: "user-1", material_id: "material-1", settings: {} }),
    monthlyProviderCostMicroUsd: vi.fn().mockResolvedValue(0),
    jobProviderCostMicroUsd: vi.fn().mockResolvedValue(10_000),
    attemptProviderCostMicroUsd: vi.fn().mockResolvedValue(2_000),
    materialForJob: vi.fn().mockResolvedValue({ id: "material-1", name: "source.pdf", type: "pdf", size_bytes: 100, storage_path: "user/source.pdf" }),
    signMaterial: vi.fn().mockResolvedValue("https://storage.example/source.pdf?token=private"),
    cachedDocument: vi.fn().mockResolvedValue(null), checkpointForJob: vi.fn().mockResolvedValue(null),
    markJobAccepted: vi.fn().mockResolvedValue(undefined), failJob: vi.fn().mockResolvedValue(undefined),
    recordJobUsage: vi.fn().mockResolvedValue(undefined), checkpointJob: vi.fn().mockResolvedValue(undefined),
    completeMaterialJob: vi.fn().mockResolvedValue("note-1"), completeKnowledgeQuestion: vi.fn(),
    claimGrading: vi.fn().mockResolvedValue({ id: "attempt-1" }),
    gradingCheckpointForAttempt: vi.fn().mockResolvedValue(null),
    attemptContext: vi.fn().mockResolvedValue({
      artifact: { content: exam }, attempt: { id: "attempt-1", user_id: "user-1", status: "grading", revision: 1, deadline_at: new Date(0).toISOString() },
      answers: [{ question_id: "q1", answer: "Learner answer" }], note: {},
    }),
    completeGrading: vi.fn().mockResolvedValue(undefined), failGrading: vi.fn().mockResolvedValue(undefined),
    recordGradingUsage: vi.fn().mockResolvedValue(undefined),
    checkpointGrading: vi.fn().mockResolvedValue(undefined),
    submitAttempt: vi.fn().mockResolvedValue({ status: "completed" }), updateJob: vi.fn(),
  };
  const worker = {
    dispatchGeneration: vi.fn().mockResolvedValue({ accepted: true, replayed: false }),
    dispatchGrading: vi.fn().mockResolvedValue({ accepted: true, replayed: false }),
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

  it("returns after durable worker acceptance instead of waiting for the generated artifact", async () => {
    const { service, repository, worker } = harness();
    await service.generation("job-1");
    expect(worker.dispatchGeneration).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1", kind: "exam", material: expect.objectContaining({ id: "material-1", signedUrl: expect.stringContaining("token=private") }),
      callbacks: expect.objectContaining({ leaseToken: expect.any(String) }),
      budgetMicroUsd: 490_000,
    }));
    expect(repository.markJobAccepted).toHaveBeenCalledWith("job-1", expect.any(String));
    expect(repository.completeMaterialJob).not.toHaveBeenCalled();
  });

  it("classifies an internal transport timeout as retryable and retains the same job", async () => {
    const { service, repository, worker } = harness();
    worker.dispatchGeneration.mockRejectedValue(new AiWorkerError("AI_WORKER_TIMEOUT", "Response headers timed out", [], true));
    await service.generation("job-1");
    expect(repository.failJob).toHaveBeenCalledWith(
      "job-1", expect.any(String), "AI_WORKER_TIMEOUT", "Response headers timed out", true, 86_400,
    );
  });

  it("persists each provider usage event before accepting the final callback", async () => {
    const { service, repository } = harness();
    const event = { eventId: "11111111-1111-4111-8111-111111111111", purpose: "exam_generation", costMicroUsd: 10_000 };
    await expect(service.usage("job-1", "lease-1", event)).resolves.toEqual({ persisted: true });
    expect(repository.recordJobUsage).toHaveBeenCalledWith("job-1", "lease-1", event);
    await expect(service.complete("job-1", "lease-1", {
      kind: "exam", sourceSha256: "a".repeat(64), parserVersion: "v1", auditVersion: "v1", promptVersion: "v2",
      document: {}, blockCount: 1, visualRegionCount: 0, exam, questionCount: 1, totalMarks: 20,
    })).resolves.toEqual({ completed: true });
    expect(repository.completeMaterialJob).toHaveBeenCalled();
  });

  it("opens the monthly budget circuit before dispatching to the worker", async () => {
    const { service, repository, worker } = harness();
    repository.monthlyProviderCostMicroUsd.mockResolvedValue(20_000_000);
    await service.generation("job-1");
    expect(worker.dispatchGeneration).not.toHaveBeenCalled();
    expect(repository.failJob).toHaveBeenCalledWith(
      "job-1", expect.any(String), "AI_MONTHLY_BUDGET_REACHED", expect.any(String), false, 86_400,
    );
  });

  it("subtracts persisted job cost and stops a resume whose per-job budget is exhausted", async () => {
    const { service, repository, worker } = harness();
    repository.jobProviderCostMicroUsd.mockResolvedValue(500_000);
    await service.generation("job-1");
    expect(worker.dispatchGeneration).not.toHaveBeenCalled();
    expect(repository.failJob).toHaveBeenCalledWith(
      "job-1", expect.any(String), "AI_COST_LIMIT_EXCEEDED", expect.any(String), false, 86_400,
    );
  });

  it("dispatches subjective grading asynchronously and releases a failed dispatch reservation", async () => {
    const first = harness();
    await first.service.grading("attempt-1");
    expect(first.worker.dispatchGrading).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-1", callbacks: expect.objectContaining({ leaseToken: expect.any(String) }),
      budgetMicroUsd: 48_000,
    }));
    expect(first.repository.completeGrading).not.toHaveBeenCalled();

    const second = harness();
    second.worker.dispatchGrading.mockRejectedValue(new AiWorkerError("OPENROUTER_ZDR_UNAVAILABLE", "No compliant endpoint", [{
      purpose: "exam_grading", status: "failed", costMicroUsd: 0,
    }]));
    await second.service.grading("attempt-1");
    expect(second.repository.failGrading).toHaveBeenCalledWith("attempt-1", expect.any(String), [
      expect.objectContaining({ purpose: "exam_grading" }),
    ]);
  });

  it("dispatches a durable grading checkpoint and accepts a validated result checkpoint callback", async () => {
    const { service, repository, worker } = harness();
    const result = { subjectiveScore: 20, results: [{
      questionId: "q1", awardedMarks: 20, correct: true, feedback: "Supported",
    }] };
    repository.gradingCheckpointForAttempt.mockResolvedValue({ payload: { result } });

    await service.grading("attempt-1");
    expect(worker.dispatchGrading).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: { result },
    }));
    await expect(service.gradingCheckpoint("attempt-1", "lease-1", { result }))
      .resolves.toEqual({ persisted: true });
    expect(repository.checkpointGrading).toHaveBeenCalledWith(
      "attempt-1", "lease-1", { result }, 86_400,
    );
  });

  it("persists grading usage before the completion callback and enforces its own cost ceiling", async () => {
    const first = harness();
    const event = { eventId: "11111111-1111-4111-8111-111111111111", purpose: "exam_grading", costMicroUsd: 2_000 };
    await expect(first.service.gradingUsage("attempt-1", "lease-1", event)).resolves.toEqual({ persisted: true });
    expect(first.repository.recordGradingUsage).toHaveBeenCalledWith("attempt-1", "lease-1", event);

    first.repository.attemptProviderCostMicroUsd.mockResolvedValue(50_001);
    await expect(first.service.gradingUsage("attempt-1", "lease-1", event)).rejects.toMatchObject({ status: 503 });
    expect(first.repository.failGrading).toHaveBeenCalledWith("attempt-1", "lease-1", []);
  });
});
