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
});
