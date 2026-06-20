import { Controller, Get } from "@nestjs/common";

// GET /api/health —— 用于验证部署连通性与各依赖是否已配置
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      status: "ok",
      service: "nalanda-api",
      time: new Date().toISOString(),
      deps: {
        redis: process.env.REDIS_URL ? "configured" : "unset",
        ai: process.env.AI_SERVICE_URL ? "configured" : "unset",
        supabase: process.env.SUPABASE_URL ? "configured" : "unset",
      },
    };
  }
}
