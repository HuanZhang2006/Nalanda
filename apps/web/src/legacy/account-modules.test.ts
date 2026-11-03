import { afterEach, describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";
import { initNotifications, openNotifications, refreshNotifBadge } from "./notifications";
import { initFeedback, mountFeedback } from "./feedback";
import { initProfile, mountProfile } from "./profile";

const user = { id: "u1", email: "alice@example.edu" };

afterEach(() => vi.unstubAllGlobals());

describe("notifications, feedback, and profile", () => {
  it("handles notification unread state, feedback submission, and profile sync", async () => {
    const supabase = createSupabaseMock();
    const toast = vi.fn();

    document.body.innerHTML = `<span id="notif-badge"></span>`;
    initNotifications(supabase, user, toast);
    await refreshNotifBadge();
    expect(document.querySelector("#notif-badge")?.textContent).toBe("1");

    await openNotifications();
    await flush(12);
    expect(document.querySelector("#notif-pop")?.textContent).toContain("Welcome back");
    click(document.querySelector(".notif-item"));
    await flush(12);
    expect(supabase.tables.notifications[0].read).toBe(true);
    expect((document.querySelector("#notif-badge") as HTMLElement).style.display).toBe("none");

    // Activating the bell entry again closes the open panel.
    await openNotifications();
    expect(document.querySelector("#notif-pop")).toBeNull();

    const feedbackRoot = document.createElement("div");
    document.body.appendChild(feedbackRoot);
    initFeedback(supabase, user, toast);
    mountFeedback(feedbackRoot);
    await flush(12);
    expect(feedbackRoot.textContent).toContain("Existing feedback");

    click(feedbackRoot.querySelector('[data-fb="cat"][data-c="Feature request"]'));
    (feedbackRoot.querySelector("#fb-summary") as HTMLInputElement).value = "Please add an export feature";
    (feedbackRoot.querySelector("#fb-body") as HTMLTextAreaElement).value = "Export Markdown";
    click(feedbackRoot.querySelector('[data-fb="submit"]'));
    await flush(24);

    expect(supabase.tables.feedback.some((row) => row.summary === "Please add an export feature" && row.category === "Feature request")).toBe(true);
    expect(supabase.tables.notifications.some((row) => row.title === "Feedback received")).toBe(true);
    expect(feedbackRoot.textContent).toContain("Please add an export feature");
    expect(toast).toHaveBeenCalledWith("Feedback submitted. Thank you!", "check");

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
    expect(profileRoot.textContent).toContain("Badges");
    click(profileRoot.querySelector('[data-pf="edit"]'));
    const username = document.querySelector("#pf-username") as HTMLInputElement;
    username.value = "Alice Updated";
    click(document.querySelector('[data-ed="save"]'));
    await flush(24);

    expect(supabase.tables.profiles[0].username).toBe("Alice Updated");
    expect(profileRoot.textContent).toContain("Alice Updated");
    expect(shell.querySelector(".uchip-name")?.textContent).toBe("Alice Updated");
  });

  it("does not pretend a notification is read locally when the update returns an error", async () => {
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

  it("aggregates learning stats and persistent course badges, and saves an IANA time zone", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      courses: 3, learnedWords: 25, reviewDays: 4, badges: [{ code: "vocab_words_bronze", family: "vocab_words",
        tier: 1, name: "词汇行者", description: "熟练掌握 20 个不同英文词或短语", threshold: 20, icon: "🧭",
        awardedAt: "2026-07-22T00:00:00.000Z" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));
    const supabase = createSupabaseMock(); const root = document.createElement("div"); document.body.appendChild(root);
    initProfile(supabase, user, vi.fn()); mountProfile(root); await flush(20);
    expect(root.textContent).toContain("Learning courses"); expect(root.textContent).toContain("25");
    expect(root.textContent).toContain("Vocabulary Voyager · Bronze");

    click(root.querySelector('[data-pf="edit"]'));
    const timezone = document.querySelector("#pf-timezone") as HTMLInputElement; timezone.value = "Asia/Shanghai";
    click(document.querySelector('[data-ed="save"]')); await flush(24);
    expect(supabase.tables.profiles[0].timezone).toBe("Asia/Shanghai");
  });

  it("keeps the basic profile and shows a degraded state when the learning stats API fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      code: "COURSES_DISABLED", message: "Course stats service unavailable",
    }), { status: 503, headers: { "Content-Type": "application/json" } }))));
    const supabase = createSupabaseMock(); const root = document.createElement("div"); document.body.appendChild(root);
    initProfile(supabase, user, vi.fn()); mountProfile(root); await flush(20);
    expect(root.textContent).toContain("Alice");
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Course stats service unavailable");
  });

  it("displays the Free Plan generation and grading allowance without credits", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const body = String(input).includes("/api/profile/ai-quota") ? {
        plan: "free", localDate: "2026-08-10", timezone: "Asia/Shanghai", resetsAt: "2026-08-10T16:00:00.000Z",
        generation: { limit: 10, consumed: 3, reserved: 1, remaining: 6 },
        grading: { limit: 10, consumed: 2, reserved: 0, remaining: 8 },
      } : { courses: 2, learnedWords: 12, reviewDays: 3, badges: [] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    const root = document.createElement("div"); document.body.appendChild(root);
    initProfile(createSupabaseMock(), user, vi.fn()); mountProfile(root); await flush(24);

    expect(root.textContent).toContain("Free Plan");
    expect(root.textContent).toContain("Asia/Shanghai");
    expect(root.textContent).toContain("6/10");
    expect(root.textContent).toContain("8/10");
    expect(root.textContent).toContain("Credits are not used");
  });
});
