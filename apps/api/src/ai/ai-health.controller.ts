import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { AiInternalClientService } from "./ai-internal-client.service";
import { AiQueueService } from "./ai-queue.service";

@Controller("health/ai")
export class AiHealthController {
  constructor(private readonly worker: AiInternalClientService, private readonly queue: AiQueueService) {}

  @Get()
  async check() {
    const worker = await this.worker.health();
    const body = {
      status: worker.status === "ok" && this.queue.configured() ? "ok" : "error",
      service: "nalanda-materials-ai",
      deps: { worker: worker.status, queue: this.queue.configured() ? "configured" : "unset" },
    };
    if (body.status !== "ok") throw new ServiceUnavailableException(body);
    return body;
  }
}

