import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { AiProcessorService } from "./ai-processor.service";
import { AiRepository } from "./ai.repository";

type AiQueueData = { kind: "generation" | "grading" | "timeout"; id: string };

function connectionFromUrl(raw: string): ConnectionOptions {
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class AiQueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AiQueueService.name);
  private queue?: Queue<AiQueueData>;
  private worker?: Worker<AiQueueData>;
  private reconcileTimer?: ReturnType<typeof setInterval>;
  private shuttingDown = false;

  constructor(private readonly processor: AiProcessorService, private readonly repository: AiRepository) {}

  configured() { return Boolean(process.env.REDIS_URL); }

  async onApplicationBootstrap() {
    this.shuttingDown = false;
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return;
    const connection = connectionFromUrl(redisUrl);
    this.queue = new Queue<AiQueueData>("materials-ai", { connection, defaultJobOptions: {
      attempts: 1, removeOnComplete: { age: 3_600, count: 1_000 }, removeOnFail: { age: 86_400, count: 1_000 },
    } });
    this.worker = new Worker<AiQueueData>("materials-ai", async (job) => {
      if (job.data.kind === "generation") {
        await this.processor.generation(job.data.id);
        await this.holdExecutionSlot("generation", job.data.id);
      }
      else if (job.data.kind === "grading") {
        await this.processor.grading(job.data.id);
        await this.holdExecutionSlot("grading", job.data.id);
      }
      else await this.processor.timeout(job.data.id);
    }, { connection, concurrency: 1, lockDuration: 15 * 60_000 });
    this.worker.on("error", (error) => this.logger.error(`Materials AI queue error: ${error.message}`));
    await this.reconcile();
    this.reconcileTimer = setInterval(() => void this.reconcile(), 15_000);
    this.reconcileTimer.unref();
  }

  async onApplicationShutdown() {
    this.shuttingDown = true;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    await this.worker?.close();
    await this.queue?.close();
  }

  private async add(kind: AiQueueData["kind"], id: string, delay = 0) {
    if (!this.queue) throw new Error("Materials AI queue is not configured");
    const jobId = `${kind}-${id}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") await existing.remove();
      else return;
    }
    await this.queue.add(kind, { kind, id }, { jobId, delay });
  }

  enqueueGeneration(id: string) { return this.add("generation", id); }
  enqueueGrading(id: string) { return this.add("grading", id); }
  enqueueTimeout(id: string, deadlineAt: string) {
    return this.add("timeout", id, Math.max(0, new Date(deadlineAt).getTime() - Date.now()));
  }

  private async holdExecutionSlot(kind: "generation" | "grading", id: string) {
    // FastAPI acknowledges durable work before the provider call completes.
    // Keep BullMQ's single concurrency slot until Postgres shows the task is
    // terminal or its lease has expired; otherwise a large backlog would be
    // accepted into worker memory and later jobs could expire before starting.
    while (!this.shuttingDown) {
      let row: Record<string, any> | null;
      try {
        row = kind === "generation"
          ? await this.repository.generationExecutionState(id)
          : await this.repository.gradingExecutionState(id);
      } catch (error) {
        this.logger.warn(`Materials AI slot state check failed: ${error instanceof Error ? error.message : "unknown error"}`);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      const activeStatus = kind === "generation" ? "processing" : "grading";
      const leaseValue = kind === "generation" ? row?.lease_expires_at : row?.grading_lease_expires_at;
      if (!row || row.status !== activeStatus) return;
      const remaining = new Date(String(leaseValue || "")).getTime() - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, remaining)));
    }
  }

  async reconcile() {
    if (!this.queue) return;
    try {
      const [jobs, attempts, overdue] = await Promise.all([
        this.repository.dispatchableGenerationJobs(), this.repository.dispatchableGradingAttempts(),
        this.repository.overdueExamAttempts(),
      ]);
      await this.repository.expireGenerationCheckpoints();
      await Promise.all([
        ...jobs.map((id) => this.enqueueGeneration(id)),
        ...attempts.map((id) => this.enqueueGrading(id)),
        ...overdue.map((id) => this.add("timeout", id)),
      ]);
    } catch (error) {
      this.logger.warn(`Materials AI reconciliation failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}
