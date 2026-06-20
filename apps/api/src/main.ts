import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api"); // 匹配 Caddy 的 /api/* 路由
  app.enableCors();
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, "0.0.0.0");
  console.log(`Nalanda API listening on :${port} (prefix /api)`);
}

bootstrap();
