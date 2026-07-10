import { describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";
import { initNotifications, openNotifications, refreshNotifBadge } from "./notifications";
import { initFeedback, mountFeedback } from "./feedback";
import { initProfile, mountProfile } from "./profile";

const user = { id: "u1", email: "alice@example.edu" };

describe("通知、反馈与个人资料", () => {
  it("处理通知未读状态、反馈提交和个人资料同步", async () => {
    const supabase = createSupabaseMock();
    const toast = vi.fn();

    document.body.innerHTML = `<span id="notif-badge"></span>`;
    initNotifications(supabase, user, toast);
    await refreshNotifBadge();
    expect(document.querySelector("#notif-badge")?.textContent).toBe("1");

    await openNotifications();
    await flush(12);
    expect(document.querySelector("#notif-pop")?.textContent).toContain("欢迎回来");
    click(document.querySelector(".notif-item"));
    await flush(12);
    expect(supabase.tables.notifications[0].read).toBe(true);
    expect((document.querySelector("#notif-badge") as HTMLElement).style.display).toBe("none");

    // 再点铃铛语义对应的入口会收起已打开的面板。
    await openNotifications();
    expect(document.querySelector("#notif-pop")).toBeNull();

    const feedbackRoot = document.createElement("div");
    document.body.appendChild(feedbackRoot);
    initFeedback(supabase, user, toast);
    mountFeedback(feedbackRoot);
    await flush(12);
    expect(feedbackRoot.textContent).toContain("已有反馈");

    click(feedbackRoot.querySelector('[data-fb="cat"][data-c="功能建议"]'));
    (feedbackRoot.querySelector("#fb-summary") as HTMLInputElement).value = "希望增加导出功能";
    (feedbackRoot.querySelector("#fb-body") as HTMLTextAreaElement).value = "导出 Markdown";
    click(feedbackRoot.querySelector('[data-fb="submit"]'));
    await flush(24);

    expect(supabase.tables.feedback.some((row) => row.summary === "希望增加导出功能" && row.category === "功能建议")).toBe(true);
    expect(supabase.tables.notifications.some((row) => row.title === "反馈已收到")).toBe(true);
    expect(feedbackRoot.textContent).toContain("希望增加导出功能");
    expect(toast).toHaveBeenCalledWith("反馈已提交，谢谢！", "check");

    const shell = document.createElement("div");
    shell.innerHTML = `<div class="uchip"><span class="avatar" data-go="profile"></span><span class="uchip-name"></span><span class="uchip-sub"></span></div>`;
    document.body.appendChild(shell);
    const profileRoot = document.createElement("div");
    document.body.appendChild(profileRoot);
    initProfile(supabase, user, toast);
    mountProfile(profileRoot);
    await flush(20);

    expect(profileRoot.textContent).toContain("Alice");
    expect(profileRoot.textContent).toContain("160");
    expect(profileRoot.textContent).toContain("徽章");
    click(profileRoot.querySelector('[data-pf="edit"]'));
    const username = document.querySelector("#pf-username") as HTMLInputElement;
    username.value = "Alice Updated";
    click(document.querySelector('[data-ed="save"]'));
    await flush(24);

    expect(supabase.tables.profiles[0].username).toBe("Alice Updated");
    expect(profileRoot.textContent).toContain("Alice Updated");
    expect(shell.querySelector(".uchip-name")?.textContent).toBe("Alice Updated");
  });

  it("通知更新返回 error 时不在本地假装已读", async () => {
    const supabase = createSupabaseMock(undefined, "u1", { errors: { notifications: { update: "notification denied" } } });
    const toast = vi.fn();
    document.body.innerHTML = `<span id="notif-badge"></span>`;
    initNotifications(supabase, user, toast);
    await openNotifications();
    await flush(12);

    click(document.querySelector(".notif-item"));
    await flush(12);
    expect(supabase.tables.notifications[0].read).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("notification denied"));
  });
});
