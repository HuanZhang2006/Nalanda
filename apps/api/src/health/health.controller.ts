import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { RedisService } from "../rate-limit/redis.service";

const dependencyState = () => ({
  ai: process.env.AI_SERVICE_URL ? "configured" : "unset",
});

// GET /api/health — deployment readiness: configuration is present and Supabase Auth/PostgREST are reachable.
@Controller("health")
export class HealthController {
  constructor(private readonly redis: RedisService) {}

  @Get()
  async check() {
    const time = new Date().toISOString();
    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    let supabase: "ok" | "unavailable" = "unavailable";
    let redis: "ok" | "unavailable" = "unavailable";

    try {
      if (!supabaseUrl || !serviceRoleKey) throw new Error("missing Supabase readiness configuration");
      // Parse once so malformed or non-HTTP configuration fails without making a request.
      const base = new URL(supabaseUrl);
      if (base.protocol !== "https:" && base.hostname !== "127.0.0.1" && base.hostname !== "localhost") {
        throw new Error("Supabase readiness URL must use HTTPS outside localhost");
      }

      const signal = AbortSignal.timeout(5_000);
      const headers = {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      };
      const [jwks, postgrest] = await Promise.all([
        fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, { signal }),
        fetch(`${supabaseUrl}/rest/v1/profiles?select=id&limit=0`, { headers, signal }),
      ]);
      if (jwks.ok && postgrest.ok) supabase = "ok";
    } catch { /* reported below */ }

    try {
      this.redis.hmac("readiness");
      if (this.redis.configured() && await this.redis.ping() === "PONG") redis = "ok";
    } catch { /* reported below */ }

    const body = {
      status: supabase === "ok" && redis === "ok" ? "ok" : "error",
      service: "nalanda-api",
      time,
      deps: { ...dependencyState(), supabase, redis },
    };
    if (body.status !== "ok") throw new ServiceUnavailableException(body);
    return body;
  }
}
