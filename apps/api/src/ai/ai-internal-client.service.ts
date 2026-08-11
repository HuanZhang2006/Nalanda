import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export class AiWorkerError extends Error {
  constructor(readonly code: string, message: string, readonly usageEvents: unknown[] = []) {
    super(message);
  }
}

@Injectable()
export class AiInternalClientService {
  configured() {
    return Boolean(process.env.AI_SERVICE_URL && process.env.AI_INTERNAL_TOKEN);
  }

  async health() {
    const base = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
    if (!base) return { status: "unconfigured" as const };
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return { status: "unavailable" as const };
      const body = await response.json() as Record<string, unknown>;
      return { status: body.status === "ok" ? "ok" as const : "unavailable" as const, details: body };
    } catch { return { status: "unavailable" as const }; }
  }

  private async post<T>(path: string, payload: unknown, timeoutMs: number): Promise<T> {
    const base = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
    const token = process.env.AI_INTERNAL_TOKEN;
    if (!base || !token) throw new ServiceUnavailableException({ code: "AI_WORKER_UNAVAILABLE", message: "AI worker is not configured" });
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Internal-Token": token },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AiWorkerError("AI_WORKER_UNREACHABLE", "AI worker did not respond");
    }
    const text = await response.text();
    let body: any = {};
    if (text) { try { body = JSON.parse(text); } catch { body = {}; } }
    if (!response.ok) {
      throw new AiWorkerError(
        typeof body.code === "string" ? body.code : response.status === 429 ? "AI_PROVIDER_RATE_LIMIT" : "AI_WORKER_FAILED",
        typeof body.message === "string" ? body.message : "AI processing failed",
        Array.isArray(body.usageEvents) ? body.usageEvents : [],
      );
    }
    return body as T;
  }

  // Parsing, selective Office visual recovery, two safety audits and one
  // structured repair can legitimately approach the worker's 20 minute hard
  // budget. The BullMQ lease is renewed at every durable pipeline stage.
  generate(payload: unknown) { return this.post<Record<string, any>>("/internal/materials/exam", payload, 20 * 60_000); }
  grade(payload: unknown) { return this.post<Record<string, any>>("/internal/exams/grade", payload, 4 * 60_000); }
}
