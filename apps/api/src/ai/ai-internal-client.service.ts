import {
  Injectable,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Agent, request } from "undici";

export class AiWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly usageEvents: unknown[] = [],
    readonly retryable = false,
  ) {
    super(message);
  }
}

const GENERATION_BUDGET_MS = 20 * 60_000;
const GRADING_BUDGET_MS = 4 * 60_000;
const ACCEPT_BUDGET_MS = 30_000;

function errorCodes(error: unknown) {
  const codes = new Set<string>();
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (typeof current === "object") {
      const value = current as { code?: unknown; name?: unknown; cause?: unknown };
      if (typeof value.code === "string") codes.add(value.code);
      if (typeof value.name === "string") codes.add(value.name);
      current = value.cause;
    } else break;
  }
  return codes;
}

function transportError(error: unknown) {
  const codes = errorCodes(error);
  if ([
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_ABORTED",
    "AbortError",
    "TimeoutError",
  ].some((code) => codes.has(code))) {
    return new AiWorkerError("AI_WORKER_TIMEOUT", "AI worker exceeded the internal request time budget", [], true);
  }
  return new AiWorkerError("AI_WORKER_UNREACHABLE", "AI worker could not be reached", [], true);
}

@Injectable()
export class AiInternalClientService implements OnApplicationShutdown {
  // Node's bundled fetch dispatcher defaults headers/body parsing to roughly
  // 300 seconds. Keep an explicit dispatcher so that every internal request
  // has transport limits aligned with the documented business budget.
  private readonly dispatcher = new Agent({
    connectTimeout: 10_000,
    headersTimeout: GENERATION_BUDGET_MS,
    bodyTimeout: GENERATION_BUDGET_MS,
    connections: 2,
    pipelining: 1,
  });

  configured() {
    return Boolean(process.env.AI_SERVICE_URL && process.env.AI_INTERNAL_TOKEN);
  }

  async onApplicationShutdown() {
    await this.dispatcher.close();
  }

  async health() {
    const base = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
    if (!base) return { status: "unconfigured" as const };
    try {
      const response = await request(`${base}/health`, {
        method: "GET",
        dispatcher: this.dispatcher,
        headersTimeout: 5_000,
        bodyTimeout: 5_000,
        signal: AbortSignal.timeout(5_000),
      });
      const text = await response.body.text();
      if (response.statusCode < 200 || response.statusCode >= 300) return { status: "unavailable" as const };
      const body = JSON.parse(text) as Record<string, unknown>;
      return { status: body.status === "ok" ? "ok" as const : "unavailable" as const, details: body };
    } catch { return { status: "unavailable" as const }; }
  }

  private async post<T>(
    path: string,
    payload: unknown,
    transportBudgetMs: number,
    responseBudgetMs = transportBudgetMs,
  ): Promise<T> {
    const base = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
    const token = process.env.AI_INTERNAL_TOKEN;
    if (!base || !token) {
      throw new ServiceUnavailableException({
        code: "AI_WORKER_UNAVAILABLE",
        message: "AI worker is not configured",
      });
    }

    let statusCode: number;
    let text: string;
    try {
      const response = await request(`${base}${path}`, {
        method: "POST",
        dispatcher: this.dispatcher,
        headers: { "Content-Type": "application/json", "X-AI-Internal-Token": token },
        body: JSON.stringify(payload),
        headersTimeout: transportBudgetMs,
        bodyTimeout: transportBudgetMs,
        signal: AbortSignal.timeout(responseBudgetMs),
      });
      statusCode = response.statusCode;
      text = await response.body.text();
    } catch (error) {
      throw transportError(error);
    }

    let body: Record<string, any> = {};
    if (text) {
      try { body = JSON.parse(text) as Record<string, any>; }
      catch {
        throw new AiWorkerError("AI_WORKER_PROTOCOL_ERROR", "AI worker returned an invalid response", [], true);
      }
    }
    if (statusCode < 200 || statusCode >= 300) {
      throw new AiWorkerError(
        typeof body.code === "string"
          ? body.code
          : statusCode === 429 ? "AI_PROVIDER_RATE_LIMIT" : "AI_WORKER_FAILED",
        typeof body.message === "string" ? body.message : "AI processing failed",
        Array.isArray(body.usageEvents) ? body.usageEvents : [],
        statusCode >= 500 || statusCode === 408 || statusCode === 429,
      );
    }
    return body as T;
  }

  dispatchGeneration(payload: unknown) {
    return this.post<{ accepted: boolean; replayed: boolean }>(
      "/internal/materials/jobs",
      payload,
      GENERATION_BUDGET_MS,
      ACCEPT_BUDGET_MS,
    );
  }

  dispatchGrading(payload: unknown) {
    return this.post<{ accepted: boolean; replayed: boolean }>(
      "/internal/exams/jobs",
      payload,
      GRADING_BUDGET_MS,
      ACCEPT_BUDGET_MS,
    );
  }

  cancelGeneration(jobId: string, leaseToken?: string | null) {
    const callbackBaseUrl = `${(process.env.AI_CALLBACK_BASE_URL || "http://api:3000/api").replace(/\/$/, "")}/internal/ai-jobs/${jobId}`;
    return this.post<{ accepted: boolean; purged: boolean }>(
      `/internal/materials/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        leaseToken: leaseToken || null,
        callbackBaseUrl,
        callbackToken: process.env.AI_INTERNAL_TOKEN,
      },
      30_000,
      30_000,
    );
  }
}
