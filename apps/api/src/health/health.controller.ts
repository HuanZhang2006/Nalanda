import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

const dependencyState = () => ({
  redis: process.env.REDIS_URL ? "configured" : "unset",
  ai: process.env.AI_SERVICE_URL ? "configured" : "unset",
});

// GET /api/health —— 部署 readiness：配置存在且 Supabase Auth/PostgREST 可访问。
@Controller("health")
export class HealthController {
  @Get()
  async check() {
    const time = new Date().toISOString();
    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
      if (!jwks.ok || !postgrest.ok) throw new Error("Supabase readiness probe failed");

      return {
        status: "ok",
        service: "nalanda-api",
        time,
        deps: { ...dependencyState(), supabase: "ok" },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        service: "nalanda-api",
        time,
        deps: { ...dependencyState(), supabase: "unavailable" },
      });
    }
  }
}
