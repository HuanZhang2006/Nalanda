import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { LearningAudioManifest } from "@nalanda/types";
import { positiveEnvironmentNumber } from "./environment";
import { FeatureFlagsService } from "./feature-flags.service";
import { LearningService } from "./learning.service";
import { assertUuid } from "./learning.util";
import { SupabaseAdminService, SupabaseRequestError } from "./supabase-admin.service";

type Row = Record<string, any>;

const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

const xml = (value: string) => value.replace(/[<>&"']/g, (char) => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
})[char]!);

function providerTimeoutSignal() {
  const configured = Number(process.env.AZURE_SPEECH_TIMEOUT_MS || 10_000);
  const milliseconds = Number.isFinite(configured)
    ? Math.max(1_000, Math.min(60_000, Math.round(configured)))
    : 10_000;
  return AbortSignal.timeout(milliseconds);
}

function fakeToneWav() {
  const samples = 3_200;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    bytes.writeInt16LE(Math.round(Math.sin(index / 9) * 2_000), 44 + index * 2);
  }
  return new Uint8Array(bytes);
}

function exceptionCode(error: unknown) {
  if (!(error instanceof HttpException)) return "";
  const response = error.getResponse();
  return typeof response === "object" && response && "code" in response
    ? String((response as { code: unknown }).code)
    : "";
}

function retryableAudioManifestError(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  return error instanceof HttpException
    && error.getStatus() >= 500
    && ["UPSTREAM_TIMEOUT", "UPSTREAM_UNREACHABLE"].includes(exceptionCode(error));
}

@Injectable()
export class LearningAudioService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LearningAudioService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private nextProviderAt = 0;

  constructor(
    private readonly db: SupabaseAdminService,
    private readonly learning: LearningService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.work(); }, 1_000);
    this.timer.unref?.();
    void this.work();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private config() {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    const fake = process.env.AZURE_SPEECH_FAKE === "true"
      && process.env.NODE_ENV !== "production";
    if ((!key || !region) && !fake) {
      throw new ServiceUnavailableException({
        code: "PRONUNCIATION_UNAVAILABLE",
        message: "Pronunciation services are temporarily unavailable.",
      });
    }
    return {
      key: key || "test-only-fake-key",
      region: region || "test-only-fake-region",
      locale: "en-US",
      voice: process.env.AZURE_SPEECH_VOICE || "en-US-JennyNeural",
      outputFormat: OUTPUT_FORMAT,
      synthesisVersion: process.env.LEARNING_AUDIO_SYNTHESIS_VERSION || "1",
    };
  }

  async prepareUnit(userId: string, unitId: string, priority = 50) {
    this.flags.audioPrewarm();
    assertUuid(unitId, "unitId");
    const config = this.config();
    const raw = await this.audioRpc("learning_prepare_unit_audio", {
      p_user_id: userId,
      p_unit_id: unitId,
      p_locale: config.locale,
      p_voice: config.voice,
      p_output_format: config.outputFormat,
      p_synthesis_version: config.synthesisVersion,
      p_priority: priority,
    });
    void this.work();
    return this.mapManifest(raw, config.synthesisVersion);
  }

  async manifest(userId: string, unitId: string) {
    this.flags.audioPrewarm();
    assertUuid(unitId, "unitId");
    const config = this.config();
    const raw = await this.audioRpc("learning_get_unit_audio_manifest", {
      p_user_id: userId,
      p_unit_id: unitId,
      p_locale: config.locale,
      p_voice: config.voice,
      p_output_format: config.outputFormat,
      p_synthesis_version: config.synthesisVersion,
    });
    return this.mapManifest(raw, config.synthesisVersion);
  }

  private async audioRpc(name: string, payload: Record<string, unknown>): Promise<Row> {
    const delays = [200, 600];
    for (let attempt = 1; attempt <= delays.length + 1; attempt += 1) {
      try { return await this.db.rpc<Row>(name, payload); }
      catch (error) {
        const retryable = retryableAudioManifestError(error);
        const status = error instanceof SupabaseRequestError
          ? error.status
          : error instanceof HttpException ? error.getStatus() : null;
        const code = error instanceof SupabaseRequestError
          && typeof error.body === "object" && error.body && "code" in error.body
          ? String((error.body as { code: unknown }).code)
          : exceptionCode(error) || null;
        if (!retryable) throw error;
        this.logger.warn(JSON.stringify({
          event: "learning_audio_rpc_upstream_failure",
          operation: name,
          attempt,
          status,
          code,
        }));
        if (attempt > delays.length) {
          throw new ServiceUnavailableException({
            code: "AUDIO_MANIFEST_UNAVAILABLE",
            message: "Audio preparation is temporarily unavailable",
            retryAfterSeconds: 2,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
      }
    }
    throw new Error("unreachable");
  }

  async audio(userId: string, wordId: string): Promise<{
    bytes: Uint8Array | null;
    cacheKey: string;
    status: string;
  }> {
    const startedAt = Date.now();
    this.flags.audioPrewarm();
    assertUuid(wordId, "wordId");
    const config = this.config();
    const row = await this.audioRpc("learning_prepare_word_audio", {
      p_user_id: userId,
      p_word_id: wordId,
      p_locale: config.locale,
      p_voice: config.voice,
      p_output_format: config.outputFormat,
      p_synthesis_version: config.synthesisVersion,
      p_priority: 100,
    }).catch((error) => {
      if (error instanceof Error && /learning word not found/i.test(error.message)) {
        throw new NotFoundException({ code: "WORD_NOT_FOUND", message: "The word was not found." });
      }
      throw error;
    });
    const asset = {
      cacheKey: String(row.cache_key),
      status: String(row.status),
    };
    void this.work();
    if (asset.status !== "ready") {
      this.logger.log(JSON.stringify({
        event: "learning_audio_pending",
        cacheKey: asset.cacheKey,
        status: asset.status,
        durationMs: Date.now() - startedAt,
      }));
      return { bytes: null, cacheKey: asset.cacheKey, status: asset.status };
    }
    const bytes = await this.db.storageGet("vocabulary-audio", `${asset.cacheKey}.mp3`);
    if (bytes) {
      this.logger.log(JSON.stringify({
        event: "learning_audio_storage_hit",
        cacheKey: asset.cacheKey,
        bytes: bytes.length,
        durationMs: Date.now() - startedAt,
      }));
      return { bytes, cacheKey: asset.cacheKey, status: "ready" };
    }
    await this.db.rpc("learning_requeue_audio_asset", { p_cache_key: asset.cacheKey });
    void this.work();
    this.logger.warn(JSON.stringify({
      event: "learning_audio_storage_missing",
      cacheKey: asset.cacheKey,
      durationMs: Date.now() - startedAt,
    }));
    return { bytes: null, cacheKey: asset.cacheKey, status: "pending" };
  }

  private mapManifest(row: Row, synthesisVersion: string): LearningAudioManifest {
    return {
      unitId: String(row.unit_id),
      total: Number(row.total || 0),
      ready: Number(row.ready || 0),
      pending: Number(row.pending || 0),
      failed: Number(row.failed || 0),
      synthesisVersion,
      assets: (row.assets || []).map((asset: Row) => ({
        wordId: String(asset.word_id),
        cacheKey: String(asset.cache_key),
        status: asset.status,
        audioUrl: `/api/pronunciation/audio/${encodeURIComponent(String(asset.word_id))}?v=${encodeURIComponent(String(asset.cache_key))}`,
        lastErrorCode: asset.last_error_code || null,
      })),
    };
  }

  private async work() {
    if (this.running || !this.flags.audioPrewarmEnabled() || Date.now() < this.nextProviderAt) return;
    this.running = true;
    const leaseToken = randomUUID();
    let job: Row | null = null;
    const startedAt = Date.now();
    try {
      job = await this.db.rpc<Row | null>("learning_claim_audio_asset", {
        p_lease_token: leaseToken,
        p_lease_seconds: 90,
        p_min_interval_milliseconds: Math.max(
          3_100,
          positiveEnvironmentNumber("LEARNING_AUDIO_PREWARM_INTERVAL_MS", 3_100, true),
        ),
      });
      if (!job) return;

      const existing = await this.db.storageGet("vocabulary-audio", job.storage_path);
      if (existing) {
        await this.finish(leaseToken, job.cache_key, true);
        this.log("learning_audio_cache_recovered", job, startedAt);
        return;
      }
      if (!job.text) throw new Error("Audio synthesis text is missing");

      const perThousand = positiveEnvironmentNumber(
        "AZURE_SPEECH_TTS_MICRO_USD_PER_1000_CHARS",
        16_000,
      );
      await this.learning.reserveTtsQuota(
        String(job.text).length,
        Math.max(1, String(job.text).length * perThousand / 1_000),
      );

      const fake = process.env.AZURE_SPEECH_FAKE === "true"
        && process.env.NODE_ENV !== "production";
      if (!fake) {
        this.nextProviderAt = Date.now() + Math.max(
          3_100,
          positiveEnvironmentNumber("LEARNING_AUDIO_PREWARM_INTERVAL_MS", 3_100, true),
        );
      }
      const bytes = fake ? fakeToneWav() : await this.synthesize(job);
      const contentType = Buffer.from(bytes).subarray(0, 4).toString("ascii") === "RIFF"
        ? "audio/wav"
        : "audio/mpeg";
      await this.db.storagePut("vocabulary-audio", job.storage_path, bytes, contentType);
      await this.finish(leaseToken, job.cache_key, true);
      this.log("learning_audio_generated", job, startedAt, { bytes: bytes.length });
    } catch (error) {
      if (job) {
        const response = error instanceof HttpException ? error.getResponse() : null;
        const responseCode = typeof response === "object" && response && "code" in response
          ? String((response as { code: unknown }).code)
          : "";
        const quota = error instanceof HttpException && error.getStatus() === 429;
        const retryAfter = responseCode === "SPEECH_TTS_MONTHLY_LIMIT"
          ? 86_400
          : quota ? 65 : Math.min(43_200, 30 * (2 ** Math.min(10, Number(job.attempt_count || 1))));
        if (quota) this.nextProviderAt = Date.now() + retryAfter * 1_000;
        await this.finish(
          leaseToken,
          job.cache_key,
          false,
          responseCode || (error instanceof Error ? error.name : "AUDIO_GENERATION_FAILED"),
          error instanceof Error ? error.message : "Audio generation failed",
          retryAfter,
        ).catch(() => undefined);
        this.log("learning_audio_generation_failed", job, startedAt, {
          errorCode: responseCode || (error instanceof Error ? error.name : "unknown"),
          retryAfter,
        });
      } else {
        this.nextProviderAt = Date.now() + 5_000;
        this.logger.error(JSON.stringify({
          event: "learning_audio_worker_failed",
          durationMs: Date.now() - startedAt,
          errorCode: error instanceof Error ? error.name : "unknown",
        }));
      }
    } finally {
      this.running = false;
    }
  }

  private async synthesize(job: Row) {
    const config = this.config();
    const body = `<speak version="1.0" xml:lang="${xml(job.locale)}"><voice name="${xml(job.voice)}">${xml(job.text)}</voice></speak>`;
    const response = await fetch(
      `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        signal: providerTimeoutSignal(),
        headers: {
          "Ocp-Apim-Subscription-Key": config.key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": job.output_format,
          "User-Agent": "Nalanda",
        },
        body,
      },
    ).catch(() => null);
    if (!response) {
      throw new BadGatewayException({
        code: "SPEECH_PROVIDER_TIMEOUT",
        message: "The pronunciation service timed out.",
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: "SPEECH_PROVIDER_ERROR",
        message: "Pronunciation services are temporarily unavailable.",
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) {
      throw new BadGatewayException({
        code: "SPEECH_PROVIDER_ERROR",
        message: "The pronunciation service returned empty audio.",
      });
    }
    return bytes;
  }

  private finish(
    leaseToken: string,
    cacheKey: string,
    success: boolean,
    errorCode: string | null = null,
    errorMessage: string | null = null,
    retryAfterSeconds = 60,
  ) {
    return this.db.rpc("learning_finish_audio_asset", {
      p_lease_token: leaseToken,
      p_cache_key: cacheKey,
      p_success: success,
      p_error_code: errorCode,
      p_error_message: errorMessage,
      p_retry_after_seconds: retryAfterSeconds,
    });
  }

  private log(event: string, job: Row, startedAt: number, extra: Record<string, unknown> = {}) {
    this.logger.log(JSON.stringify({
      event,
      cacheKey: job.cache_key,
      durationMs: Date.now() - startedAt,
      queueWaitMs: job.created_at
        ? Math.max(0, startedAt - new Date(job.created_at).getTime())
        : undefined,
      attempt: Number(job.attempt_count || 0),
      ...extra,
    }));
  }
}
