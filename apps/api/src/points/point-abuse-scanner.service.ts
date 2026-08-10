import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SupabaseAdminService } from "../learning/supabase-admin.service";
import { RedisService } from "../rate-limit/redis.service";

@Injectable()
export class PointAbuseScannerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PointAbuseScannerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly redis: RedisService, private readonly db: SupabaseAdminService) {}

  onModuleInit() {
    if (!this.redis.configured() || process.env.POINT_ABUSE_SCANNER_ENABLED === "false") return;
    const configured = Number(process.env.POINT_ABUSE_SCAN_INTERVAL_SECONDS || 300);
    const intervalMs = Math.max(60, Number.isFinite(configured) ? configured : 300) * 1_000;
    this.timer = setInterval(() => void this.scan(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scan() {
    const lockKey = "nalanda:locks:point-abuse-scanner";
    let token: string | null = null;
    try {
      token = await this.redis.acquireLock(lockKey, 240);
      if (!token) return { skipped: true };
      const result = await this.db.rpc<Record<string, unknown>>("scan_point_abuse_signals", {});
      await this.db.rpc("prune_api_abuse_events", {});
      this.logger.log(JSON.stringify({ event: "point_abuse_scan_completed", ...result }));
      return result;
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: "point_abuse_scan_failed",
        error: error instanceof Error ? error.message : "unknown scanner failure",
      }));
      return { error: true };
    } finally {
      if (token) await this.redis.releaseLock(lockKey, token).catch(() => undefined);
    }
  }
}
