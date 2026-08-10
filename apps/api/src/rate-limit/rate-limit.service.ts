import { HttpException, Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { SupabaseAdminService } from "../learning/supabase-admin.service";
import { RedisService, type SlidingWindowResult } from "./redis.service";

type RequestWithUser = Request & { user?: { id: string } };

interface Rule {
  id: string;
  limit: number;
  windowMs: number;
  actor: "user" | "ip" | "email";
}

interface RoutePolicy {
  group: string;
  failClosed: boolean;
  rules: Rule[];
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const COURSE_PREFIXES = [
  "/learning-courses", "/learning-sessions", "/learning-units",
  "/learning-review-schedules", "/course-shares", "/course-publications",
  "/course-reports", "/pronunciation", "/learning-spelling",
];
const COST_READ_PREFIXES = ["/pronunciation/audio/", "/learning-sessions/"];

const milestone = (value: number) => value === 1 || value === 5 || value === 10
  || value === 25 || value === 50 || value === 100 || (value > 100 && value % 100 === 0);

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(private readonly redis: RedisService, private readonly db: SupabaseAdminService) {}

  async enforce(request: RequestWithUser, response: Response) {
    const policy = this.policy(request);
    if (!policy) return;
    const values = this.actors(request);
    for (const rule of policy.rules) {
      const actor = values[rule.actor];
      if (!actor) continue;
      let actorHmac = "";
      let result: SlidingWindowResult;
      try {
        actorHmac = this.redis.hmac(`${rule.actor}:${actor}`);
        result = await this.redis.slidingWindow(
          `nalanda:rate:${rule.id}:${actorHmac}`,
          rule.limit,
          rule.windowMs,
        );
      } catch (error) {
        const details = {
          event: "rate_limit_degraded",
          routeGroup: policy.group,
          rule: rule.id,
          failClosed: policy.failClosed,
          error: error instanceof Error ? error.message : "redis unavailable",
        };
        this.logger.warn(JSON.stringify(details));
        if (policy.failClosed) {
          throw new HttpException({
            code: "RATE_LIMIT_UNAVAILABLE",
            message: "Request protection is temporarily unavailable",
          }, 503);
        }
        return;
      }

      response.setHeader("RateLimit-Limit", String(rule.limit));
      response.setHeader("RateLimit-Remaining", String(result.remaining));
      response.setHeader("RateLimit-Reset", String(result.resetAfterSeconds));
      response.setHeader("RateLimit-Policy", `${rule.limit};w=${Math.ceil(rule.windowMs / 1_000)}`);
      if (!result.allowed) {
        response.setHeader("Retry-After", String(result.resetAfterSeconds));
        await this.audit(policy, rule, actorHmac, request.user?.id, result).catch((error) => {
          this.logger.warn(JSON.stringify({
            event: "rate_limit_audit_failed",
            routeGroup: policy.group,
            rule: rule.id,
            error: error instanceof Error ? error.message : "audit unavailable",
          }));
        });
        this.logger.warn(JSON.stringify({
          event: "rate_limited",
          routeGroup: policy.group,
          rule: rule.id,
          actorHmac,
          userId: request.user?.id || null,
          retryAfterSeconds: result.resetAfterSeconds,
        }));
        throw new HttpException({
          code: "RATE_LIMITED",
          message: "Too many requests",
          retryAfterSeconds: result.resetAfterSeconds,
        }, 429);
      }
    }
  }

  private policy(request: RequestWithUser): RoutePolicy | null {
    const method = request.method.toUpperCase();
    const path = this.path(request);
    if (path === "/health" || method === "OPTIONS") return null;
    if (path === "/auth/register") {
      return {
        group: "registration",
        failClosed: true,
        rules: [
          { id: "register_ip_15m", actor: "ip", limit: 5, windowMs: 15 * 60_000 },
          { id: "register_email_1h", actor: "email", limit: 3, windowMs: 60 * 60_000 },
        ],
      };
    }
    if (method === "GET" && (path === "/course-market" || path.startsWith("/public/course-shares/"))) {
      return {
        group: "public_courses_read",
        failClosed: true,
        rules: [{ id: "public_courses_ip_1m", actor: "ip", limit: 120, windowMs: 60_000 }],
      };
    }
    if (!request.user?.id) return null;

    const isCourseWrite = WRITE_METHODS.has(method)
      && COURSE_PREFIXES.some((prefix) => path.startsWith(prefix));
    // These GET routes are not pure reads: they can enqueue paid synthesis for
    // the current unit/word. They therefore use the fail-closed cost boundary
    // even though ordinary private GET routes remain available during Redis
    // degradation.
    const isCostRead = method === "GET"
      && COST_READ_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (isCourseWrite || isCostRead) {
      return {
        group: "courses_write",
        failClosed: true,
        rules: [
          { id: "authenticated_user_1m", actor: "user", limit: 300, windowMs: 60_000 },
          { id: "courses_write_user_1m", actor: "user", limit: 120, windowMs: 60_000 },
          { id: "courses_write_ip_burst_10s", actor: "ip", limit: 60, windowMs: 10_000 },
        ],
      };
    }
    return {
      group: WRITE_METHODS.has(method) ? "authenticated_write" : "private_read",
      failClosed: WRITE_METHODS.has(method),
      rules: [{ id: "authenticated_user_1m", actor: "user", limit: 300, windowMs: 60_000 }],
    };
  }

  private path(request: Request) {
    const raw = (request.originalUrl || request.url || "").split("?")[0];
    return raw.replace(/^\/api(?=\/|$)/, "") || "/";
  }

  private actors(request: RequestWithUser) {
    const forwarded = request.ip || request.socket?.remoteAddress || "unknown";
    const email = typeof request.body?.email === "string"
      ? request.body.email.trim().toLowerCase().slice(0, 320)
      : "";
    return { user: request.user?.id || "", ip: forwarded, email };
  }

  private async audit(
    policy: RoutePolicy,
    rule: Rule,
    actorHmac: string,
    userId: string | undefined,
    result: SlidingWindowResult,
  ) {
    const windowSeconds = Math.ceil(rule.windowMs / 1_000);
    const denied = await this.redis.increment(
      `nalanda:rate:audit:${rule.id}:${actorHmac}:${Math.floor(Date.now() / rule.windowMs)}`,
      windowSeconds + 60,
    );
    if (!milestone(denied)) return;
    const bucketMs = Math.floor(Date.now() / rule.windowMs) * rule.windowMs;
    await this.db.rpc("record_api_abuse_event", {
      p_actor_hmac: actorHmac,
      p_user_id: userId || null,
      p_route_group: policy.group,
      p_rule: rule.id,
      p_bucket_start: new Date(bucketMs).toISOString(),
      p_event_count: denied,
      p_metadata: {
        limit: rule.limit,
        windowSeconds,
        retryAfterSeconds: result.resetAfterSeconds,
      },
    });
  }
}
