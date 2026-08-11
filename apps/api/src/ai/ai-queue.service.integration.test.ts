import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AiQueueService } from "./ai-queue.service";

const redisDescribe = process.env.RUN_REDIS_E2E === "true" ? describe : describe.skip;

redisDescribe("Materials AI BullMQ with real Redis", () => {
  const id = randomUUID();
  const processor = { generation: vi.fn().mockResolvedValue(undefined), grading: vi.fn(), timeout: vi.fn() };
  const repository = {
    dispatchableGenerationJobs: vi.fn().mockResolvedValue([]),
    dispatchableGradingAttempts: vi.fn().mockResolvedValue([]),
    overdueExamAttempts: vi.fn().mockResolvedValue([]),
  };
  const service = new AiQueueService(processor as any, repository as any);

  beforeAll(async () => {
    process.env.REDIS_URL ||= "redis://127.0.0.1:6379/15";
    await service.onApplicationBootstrap();
  });

  afterAll(async () => { await service.onApplicationShutdown(); });

  it("stores only the durable UUID and executes the generation through one worker", async () => {
    await service.enqueueGeneration(id);
    for (let attempt = 0; attempt < 50 && !processor.generation.mock.calls.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(processor.generation).toHaveBeenCalledTimes(1);
    expect(processor.generation).toHaveBeenCalledWith(id);
  });

  it("reconciles missing Postgres jobs without changing their durable identity", async () => {
    const missing = randomUUID();
    repository.dispatchableGenerationJobs.mockResolvedValueOnce([missing]);
    await service.reconcile();
    for (let attempt = 0; attempt < 50 && !processor.generation.mock.calls.some(([value]) => value === missing); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(processor.generation).toHaveBeenCalledWith(missing);
  });
});
