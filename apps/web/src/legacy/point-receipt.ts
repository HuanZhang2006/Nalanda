import type { PointRewardReceipt } from "@nalanda/types";
import { getLocale, localize } from "../i18n";

export async function showPointRewardReceipt(
  supabase: any,
  eventType: string,
  sourceId: string,
  toast: (message: string, icon?: string) => void,
  isCurrent: () => boolean = () => true,
) {
  if (!supabase?.rpc || !sourceId) return null;
  const { data, error } = await supabase.rpc("get_point_reward_receipt", {
    p_event_type: eventType,
    p_source_id: sourceId,
  });
  // The captured Supabase client may finish after logout/account replacement.
  // Never surface the previous account's reward state in the new shell.
  if (!isCurrent()) return null;
  // The business write has already committed. Receipt failures are deliberately
  // non-transactional and must never make the UI claim that publication failed.
  if (error || !data) {
    console.warn(JSON.stringify({
      event: "point_reward_receipt_failed",
      eventType,
      message: error?.message || "missing receipt",
    }));
    return null;
  }
  const receipt = data as PointRewardReceipt;
  if (receipt.suppressedReason === "daily_cap") {
    toast(localize(
      `Published successfully. Today's ${eventType.replaceAll("_", " ")} points limit (${receipt.dailyLimit}) has been reached.`,
      `操作已成功，但今日该类积分奖励已达上限（${receipt.dailyLimit} 次）。`,
      getLocale(),
    ));
  } else if (receipt.suppressedReason === "moderation") {
    toast(localize(
      "The action succeeded, but its points are currently withheld for review.",
      "操作已成功，但相关积分正在审核中。",
      getLocale(),
    ));
  }
  return receipt;
}
