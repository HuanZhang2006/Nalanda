import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { MeController } from "./me/me.controller";

@Module({
  controllers: [HealthController, MeController],
})
export class AppModule {}
