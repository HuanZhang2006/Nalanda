import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import type {
  ModeratePointRewardsRequest,
  PointAbuseSignal,
  PointModerationResult,
  ReviewPointAbuseSignalRequest,
} from "@nalanda/types";
import { SupabaseAdminService, SupabaseRequestError } from "../learning/supabase-admin.service";

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNAL_STATUSES = new Set(["pending", "reviewing", "dismissed", "escalated"]);
const MODERATION_ACTIONS = new Set(["suppress", "restore"]);
const TARGET_TYPES = new Set(["post", "post_root", "business_key"]);

@Injectable()
export class PointsAdminService {
  constructor(private readonly db: SupabaseAdminService) {}

  assertAdmin(userId: string) {
    const configured = process.env.MODERATION_ADMIN_USER_IDS
      || process.env.COURSE_MARKET_ADMIN_USER_IDS
      || "";
    const admins = new Set(configured.split(",").map((value) => value.trim()).filter(Boolean));
    if (!admins.has(userId)) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "Moderation admin access required" });
    }
  }

  async listSignals(userId: string, statusValue?: string, limitValue?: string) {
    this.assertAdmin(userId);
    const status = statusValue?.trim() || "pending";
    if (!SIGNAL_STATUSES.has(status)) {
      throw new BadRequestException({ code: "INVALID_STATUS", message: "Invalid abuse signal status" });
    }
    const limit = Math.min(100, Math.max(1, Number.parseInt(limitValue || "50", 10) || 50));
    const query = new URLSearchParams({
      select: [
        "id", "signal_type", "account_ids", "target_owner_id", "target_root_key",
        "window_start", "window_end", "metrics", "status", "reviewer_user_id",
        "review_note", "case_reference", "detected_at", "updated_at", "reviewed_at",
      ].join(","),
      status: `eq.${status}`,
      order: "detected_at.desc",
      limit: String(limit),
    });
    const rows = await this.db.select<Row>("point_abuse_signals", query);
    return rows.map((row) => this.signal(row));
  }

  async reviewSignal(userId: string, id: string, body: ReviewPointAbuseSignalRequest) {
    this.assertAdmin(userId);
    if (!UUID.test(id)) throw new BadRequestException({ code: "INVALID_ID", message: "Invalid signal id" });
    const status = String(body?.status || "").trim();
    const reviewNote = body?.reviewNote == null ? null : String(body.reviewNote).trim();
    const caseReference = body?.caseReference == null ? null : String(body.caseReference).trim();
    if (!SIGNAL_STATUSES.has(status) || status === "pending") {
      throw new BadRequestException({ code: "INVALID_STATUS", message: "Choose reviewing, dismissed or escalated" });
    }
    if ((reviewNote?.length || 0) > 2_000 || (caseReference?.length || 0) > 200) {
      throw new BadRequestException({ code: "INVALID_REVIEW", message: "Review metadata is too long" });
    }
    let row: Row;
    try {
      row = await this.db.rpc<Row>("review_point_abuse_signal", {
        p_reviewer_user_id: userId,
        p_signal_id: id,
        p_status: status,
        p_review_note: reviewNote || null,
        p_case_reference: caseReference || null,
      });
    } catch (error) {
      if (this.notFound(error)) {
        throw new NotFoundException({ code: "NOT_FOUND", message: "Abuse signal not found" });
      }
      throw error;
    }
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "Abuse signal not found" });
    return this.signal(row);
  }

  async moderate(userId: string, body: ModeratePointRewardsRequest) {
    this.assertAdmin(userId);
    const action = String(body?.action || "").trim();
    const targetType = String(body?.targetType || "").trim();
    const targetKey = String(body?.targetKey || "").trim();
    const reason = String(body?.reason || "").trim();
    const caseReference = body?.caseReference == null ? null : String(body.caseReference).trim();
    if (!MODERATION_ACTIONS.has(action)
        || !TARGET_TYPES.has(targetType)
        || targetKey.length < 3
        || targetKey.length > 512
        || reason.length < 3
        || reason.length > 1_000
        || (caseReference?.length || 0) > 200) {
      throw new BadRequestException({ code: "INVALID_MODERATION_ACTION", message: "Invalid moderation action" });
    }
    if (targetType === "post" && !UUID.test(targetKey)) {
      throw new BadRequestException({ code: "INVALID_ID", message: "Invalid post id" });
    }
    try {
      return await this.db.rpc<PointModerationResult>("moderate_point_rewards", {
        p_admin_user_id: userId,
        p_action: action,
        p_target_type: targetType,
        p_target_key: targetKey,
        p_reason: reason,
        p_case_reference: caseReference || null,
      });
    } catch (error) {
      if (this.notFound(error)) {
        throw new NotFoundException({ code: "NOT_FOUND", message: "Point moderation target not found" });
      }
      throw error;
    }
  }

  private notFound(error: unknown) {
    if (!(error instanceof SupabaseRequestError)) return false;
    const body = typeof error.body === "object" && error.body
      ? error.body as Record<string, unknown> : {};
    return error.status === 404 || body.code === "P0002";
  }

  private signal(row: Row): PointAbuseSignal {
    return {
      id: String(row.id),
      signalType: row.signal_type as PointAbuseSignal["signalType"],
      accountIds: row.account_ids as string[],
      targetOwnerId: row.target_owner_id == null ? null : String(row.target_owner_id),
      targetRootKey: row.target_root_key == null ? null : String(row.target_root_key),
      windowStart: String(row.window_start),
      windowEnd: String(row.window_end),
      metrics: row.metrics as Record<string, unknown>,
      status: row.status as PointAbuseSignal["status"],
      reviewerUserId: row.reviewer_user_id == null ? null : String(row.reviewer_user_id),
      reviewNote: row.review_note == null ? null : String(row.review_note),
      caseReference: row.case_reference == null ? null : String(row.case_reference),
      detectedAt: String(row.detected_at),
      updatedAt: String(row.updated_at),
      reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at),
    };
  }
}
