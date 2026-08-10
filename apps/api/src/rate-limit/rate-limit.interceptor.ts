import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { RateLimitService } from "./rate-limit.service";

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  constructor(private readonly limits: RateLimitService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    await this.limits.enforce(http.getRequest(), http.getResponse());
    return next.handle();
  }
}
