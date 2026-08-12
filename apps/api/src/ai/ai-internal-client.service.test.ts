import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn() }));
vi.mock("undici", () => ({
  Agent: class {
    close = harness.close;
  },
  request: harness.request,
}));

import { AiInternalClientService, AiWorkerError } from "./ai-internal-client.service";

describe("AI internal HTTP transport", () => {
  beforeEach(() => {
    process.env.AI_SERVICE_URL = "http://ai:8000";
    process.env.AI_INTERNAL_TOKEN = "test-internal-token";
    harness.request.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("uses the asynchronous acceptance endpoint and returns its 202 response", async () => {
    harness.request.mockResolvedValue({
      statusCode: 202,
      body: { text: vi.fn().mockResolvedValue('{"accepted":true,"replayed":false}') },
    });
    const client = new AiInternalClientService();
    await expect(client.dispatchGeneration({ jobId: "job-1" })).resolves.toEqual({ accepted: true, replayed: false });
    expect(harness.request).toHaveBeenCalledWith("http://ai:8000/internal/materials/jobs", expect.objectContaining({
      headersTimeout: 20 * 60_000,
      bodyTimeout: 20 * 60_000,
      signal: expect.any(AbortSignal),
    }));
  });

  it("preserves Undici response-header timeout as AI_WORKER_TIMEOUT", async () => {
    const cause = Object.assign(new Error("headers timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" });
    harness.request.mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause }));
    const client = new AiInternalClientService();
    await expect(client.dispatchGeneration({ jobId: "job-1" })).rejects.toMatchObject<Partial<AiWorkerError>>({
      code: "AI_WORKER_TIMEOUT",
      retryable: true,
    });
  });

  it("accepts grading as a background job instead of holding a provider request open", async () => {
    harness.request.mockResolvedValue({
      statusCode: 202,
      body: { text: vi.fn().mockResolvedValue('{"accepted":true,"replayed":false}') },
    });
    const client = new AiInternalClientService();
    await expect(client.dispatchGrading({ attemptId: "attempt-1" })).resolves.toMatchObject({ accepted: true });
    expect(harness.request).toHaveBeenCalledWith(
      "http://ai:8000/internal/exams/jobs",
      expect.objectContaining({ headersTimeout: 4 * 60_000, signal: expect.any(AbortSignal) }),
    );
  });

  it("does not misreport an invalid worker response as unreachable", async () => {
    harness.request.mockResolvedValue({ statusCode: 202, body: { text: vi.fn().mockResolvedValue("not-json") } });
    const client = new AiInternalClientService();
    await expect(client.dispatchGeneration({ jobId: "job-1" })).rejects.toMatchObject({
      code: "AI_WORKER_PROTOCOL_ERROR",
    });
  });
});
