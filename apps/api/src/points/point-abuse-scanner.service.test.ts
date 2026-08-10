import { afterEach, describe, expect, it, vi } from "vitest";
import { PointAbuseScannerService } from "./point-abuse-scanner.service";

describe("PointAbuseScannerService", () => {
  afterEach(() => {
    delete process.env.POINT_ABUSE_SCANNER_ENABLED;
    delete process.env.POINT_ABUSE_SCAN_INTERVAL_SECONDS;
  });

  it("runs a single scanner under a token-protected Redis lock", async () => {
    const redis = {
      configured: vi.fn(() => true),
      acquireLock: vi.fn().mockResolvedValue("lock-token"),
      releaseLock: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ upserted: 3, scannedAt: "2026-08-10T00:00:00Z" })
        .mockResolvedValueOnce(5),
    };
    const scanner = new PointAbuseScannerService(redis as any, db as any);
    await expect(scanner.scan()).resolves.toMatchObject({ upserted: 3 });
    expect(db.rpc.mock.calls).toEqual([
      ["scan_point_abuse_signals", {}],
      ["prune_api_abuse_events", {}],
    ]);
    expect(redis.releaseLock).toHaveBeenCalledWith("nalanda:locks:point-abuse-scanner", "lock-token");
  });

  it("does not scan or release another process' lock", async () => {
    const redis = {
      configured: vi.fn(() => true),
      acquireLock: vi.fn().mockResolvedValue(null),
      releaseLock: vi.fn(),
    };
    const db = { rpc: vi.fn() };
    const scanner = new PointAbuseScannerService(redis as any, db as any);
    await expect(scanner.scan()).resolves.toEqual({ skipped: true });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  it("keeps detection advisory-only when the database scan fails", async () => {
    const redis = {
      configured: vi.fn(() => true),
      acquireLock: vi.fn().mockResolvedValue("lock-token"),
      releaseLock: vi.fn().mockResolvedValue(undefined),
    };
    const db = { rpc: vi.fn().mockRejectedValue(new Error("database unavailable")) };
    const scanner = new PointAbuseScannerService(redis as any, db as any);
    await expect(scanner.scan()).resolves.toEqual({ error: true });
    expect(redis.releaseLock).toHaveBeenCalledWith("nalanda:locks:point-abuse-scanner", "lock-token");
  });
});
