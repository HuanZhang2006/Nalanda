import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller";
import { HealthController } from "./health/health.controller";
import { MeController } from "./me/me.controller";

@Module({
  controllers: [HealthController, MeController, AuthController],
})
export class AppModule {}
