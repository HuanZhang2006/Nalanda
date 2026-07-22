import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = error instanceof HttpException ? error.getResponse() : null;
    const source = typeof raw === "object" && raw ? raw as Record<string, unknown> : {};
    const nested = typeof source.message === "object" && source.message ? source.message as Record<string, unknown> : {};
    const fallbackCode = status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN"
      : status === 413 ? "PAYLOAD_TOO_LARGE" : status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST";
    const code = String(source.code || nested.code || fallbackCode);
    const message = typeof source.message === "string" ? source.message
      : typeof nested.message === "string" ? nested.message
      : status >= 500 ? "服务暂时不可用" : error instanceof Error ? error.message : "请求失败";
    const fieldErrors = source.fieldErrors || nested.fieldErrors;
    response.status(status).json({ code, message, ...(fieldErrors ? { fieldErrors } : {}) });
  }
}
