import { describe, expect, it, vi } from "vitest";
import { PointsAdminService } from "./points-admin.service";

describe("PointsAdminService", () => {
  const adminId = "11111111-1111-4111-8111-111111111111";

  it("uses the new allowlist and maps service rows without exposing fingerprints", async () => {
    process.env.MODERATION_ADMIN_USER_IDS = adminId;
    const db = { select: vi.fn().mockResolvedValue([{
      id: "22222222-2222-4222-8222-222222222222",
      signal_type: "reciprocal_pair",
      fingerprint: "internal",
      account_ids: [adminId],
      status: "pending",
      metrics: { interactionCount: 12 },
      detected_at: "2026-08-10T00:00:00Z",
    }]) };
    const service = new PointsAdminService(db as any);
    const result = await service.listSignals(adminId);
    expect(result[0]).toMatchObject({ signalType: "reciprocal_pair", status: "pending" });
    expect(result[0]).not.toHaveProperty("fingerprint");
    const query = db.select.mock.calls[0][1] as URLSearchParams;
    expect(query.get("select")).not.toContain("fingerprint");
    expect(query.get("select")).not.toBe("*");
  });

  it("falls back to the existing course moderation allowlist during rollout", async () => {
    delete process.env.MODERATION_ADMIN_USER_IDS;
    process.env.COURSE_MARKET_ADMIN_USER_IDS = adminId;
    const db = { rpc: vi.fn().mockResolvedValue({ id: 1, affectedAmount: 10 }) };
    const service = new PointsAdminService(db as any);
    await expect(service.moderate(adminId, {
      action: "suppress",
      targetType: "post",
      targetKey: "22222222-2222-4222-8222-222222222222",
      reason: "confirmed coordinated engagement",
    })).resolves.toMatchObject({ affectedAmount: 10 });
    expect(db.rpc).toHaveBeenCalledWith("moderate_point_rewards", expect.objectContaining({
      p_admin_user_id: adminId,
      p_target_type: "post",
    }));
  });

  it("rejects ordinary users before touching service-role data", async () => {
    process.env.MODERATION_ADMIN_USER_IDS = adminId;
    const db = { select: vi.fn() };
    const service = new PointsAdminService(db as any);
    await expect(service.listSignals("33333333-3333-4333-8333-333333333333"))
      .rejects.toMatchObject({ status: 403 });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects oversized moderation keys before calling the database", async () => {
    process.env.MODERATION_ADMIN_USER_IDS = adminId;
    const db = { rpc: vi.fn() };
    const service = new PointsAdminService(db as any);
    await expect(service.moderate(adminId, {
      action: "suppress",
      targetType: "business_key",
      targetKey: `post:${"x".repeat(508)}`,
      reason: "confirmed abuse",
    })).rejects.toMatchObject({ status: 400 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("reviews signals only through the database-controlled workflow", async () => {
    process.env.MODERATION_ADMIN_USER_IDS = adminId;
    const signalId = "22222222-2222-4222-8222-222222222222";
    const db = { rpc: vi.fn().mockResolvedValue({
      id: signalId,
      signal_type: "owner_concentration",
      account_ids: [adminId],
      window_start: "2026-08-09T00:00:00Z",
      window_end: "2026-08-10T00:00:00Z",
      metrics: { interactionCount: 8 },
      status: "reviewing",
      reviewer_user_id: adminId,
      review_note: "manual review started",
      case_reference: "CASE-1",
      detected_at: "2026-08-10T00:00:00Z",
      updated_at: "2026-08-10T00:01:00Z",
      reviewed_at: "2026-08-10T00:01:00Z",
    }) };
    const service = new PointsAdminService(db as any);
    await expect(service.reviewSignal(adminId, signalId, {
      status: "reviewing", reviewNote: "manual review started", caseReference: "CASE-1",
    })).resolves.toMatchObject({ status: "reviewing", reviewerUserId: adminId });
    expect(db.rpc).toHaveBeenCalledWith("review_point_abuse_signal", {
      p_reviewer_user_id: adminId,
      p_signal_id: signalId,
      p_status: "reviewing",
      p_review_note: "manual review started",
      p_case_reference: "CASE-1",
    });
  });
});
