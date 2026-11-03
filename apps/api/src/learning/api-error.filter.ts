import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { SupabaseRequestError } from "./supabase-admin.service";

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const upstreamFailure = error instanceof SupabaseRequestError && error.status >= 500;
    const status = upstreamFailure
      ? HttpStatus.SERVICE_UNAVAILABLE
      : error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = error instanceof HttpException ? error.getResponse() : null;
    const source = typeof raw === "object" && raw ? raw as Record<string, unknown> : {};
    if (status >= 500) {
      const request = typeof http.getRequest === "function"
        ? http.getRequest<{ method?: string; originalUrl?: string }>()
        : null;
      const upstreamCode = error instanceof SupabaseRequestError
        && typeof error.body === "object" && error.body && "code" in error.body
        ? String((error.body as { code: unknown }).code)
        : null;
      // Never log the upstream message/body: PostgreSQL and provider errors
      // can contain user content. Status, stable code, route and error class
      // are sufficient to diagnose release-gate failures safely.
      this.logger.error(JSON.stringify({
        event: "api_request_failed",
        method: request?.method || null,
        path: request?.originalUrl?.split("?", 1)[0] || null,
        errorName: error instanceof Error ? error.name : typeof error,
        upstreamStatus: error instanceof SupabaseRequestError ? error.status : null,
        upstreamCode,
      }));
    }
    // Readiness responses intentionally expose only dependency state (never
    // credentials or provider error details). Preserve that contract so
    // deploy/monitoring probes can distinguish a booted but unhealthy API from
    // an application that did not start. All product API errors continue to
    // use the normalized { code, message, fieldErrors? } envelope below.
    if (
      status === HttpStatus.SERVICE_UNAVAILABLE
      && source.status === "error"
      && (source.service === "nalanda-api" || source.service === "nalanda-materials-ai")
      && typeof source.deps === "object"
      && source.deps !== null
    ) {
      response.status(status).json(source);
      return;
    }
    const nested = typeof source.message === "object" && source.message ? source.message as Record<string, unknown> : {};
    const fallbackCode = upstreamFailure ? "UPSTREAM_UNAVAILABLE"
      : status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN"
      : status === 413 ? "PAYLOAD_TOO_LARGE" : status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST";
    const code = String(source.code || nested.code || fallbackCode);
    const message = upstreamFailure ? "Service temporarily unavailable"
      : typeof source.message === "string" ? source.message
      : typeof nested.message === "string" ? nested.message
      : status >= 500 ? "The service is temporarily unavailable." : error instanceof Error ? error.message : "Request failed.";
    const fieldErrors = source.fieldErrors || nested.fieldErrors;
    const currentRevision = source.currentRevision ?? nested.currentRevision;
    const retryAfterSeconds = upstreamFailure ? 2 : source.retryAfterSeconds ?? nested.retryAfterSeconds;
    response.status(status).json({
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      ...(typeof currentRevision === "number" ? { currentRevision } : {}),
      ...(typeof retryAfterSeconds === "number" ? { retryAfterSeconds } : {}),
    });
  }
}
