import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // The documented 2,000-word / 10-translations boundary can exceed Express's
  // 100 kB default. Ten MB covers the theoretical validated payload while the
  // pronunciation multipart route keeps its independent 2 MB hard limit.
  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ extended: true, limit: "10mb" }));
  // The production API is reachable only through the host nginx proxy. Trust
  // exactly that hop so IP rate limits cannot be replaced by a client-supplied
  // X-Forwarded-For chain.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.setGlobalPrefix("api"); // Matches the Caddy /api/* route
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.PUBLIC_ORIGIN || "")
    .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : process.env.NODE_ENV === "production" ? false : true,
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, "0.0.0.0");
  console.log(`Nalanda API listening on :${port} (prefix /api)`);
}

bootstrap();
