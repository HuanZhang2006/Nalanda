import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";

describe("legacy 应用壳", () => {
  it("挂载壳、打开 9 个模块、导航/退出，并在卸载时清理", async () => {
    vi.resetModules();
    const learningDetail = { id: "11111111-1111-4111-8111-111111111111", title: "Deep linked course",
      category: "english_vocabulary", hasUnits: false, locale: "en-US", unitCount: 1, wordCount: 4,
      learnedCount: 0, progressPercent: 0, activeSessionId: null, canRepublish: true, originAuthorName: null,
      updatedAt: new Date().toISOString(), units: [{ id: "22222222-2222-4222-8222-222222222222", name: "默认单元",
        position: 0, isSystem: true, words: [] }] };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(new Response(
      String(input).includes(`/learning-courses/${learningDetail.id}`) ? JSON.stringify(learningDetail) : "[]",
      { status: 200, headers: { "Content-Type": "application/json" } },
    ))));
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { mountNalanda } = await import("./app");

    const root = document.createElement("div");
    document.body.appendChild(root);
    const onSignOut = vi.fn();
    const supabase = createSupabaseMock();
    const cleanup = mountNalanda(root, {
      user: { id: "u1", email: "alice@example.edu" },
      supabase,
      onSignOut,
    });
    const resizeListener = addListener.mock.calls.find(([type]) => type === "resize")?.[1];
    await flush(16);

    expect(root.querySelector(".brand-name")?.textContent).toBe("Nalanda");
    expect(root.querySelectorAll("#nav .nav-item")).toHaveLength(9);
    expect(root.textContent).toContain("Good morning");

    const routes = [
      ["home", "Good morning"],
      ["notes", "My Notes"],
      ["materials", "Materials"],
      ["courses", "Learning courses"],
      ["schedule", "学习计划"],
      ["market", "Note Market"],
      ["community", "学习社区"],
      ["profile", "徽章"],
      ["feedback", "Feedback"],
    ] as const;

    for (const [route, expectedText] of routes) {
      await act(async () => { click(root.querySelector(`#nav [data-go="${route}"]`)); await flush(20); });
      expect(root.querySelector(`#nav [data-go="${route}"]`)?.classList.contains("active")).toBe(true);
      expect(root.textContent).toContain(expectedText);
    }

    // Schedule's course/unit/schedule deep-link is consumed once; normal later
    // navigation must not reopen a stale review picker.
    const deepLink = document.createElement("button");
    deepLink.dataset.go = "courses"; deepLink.dataset.courseId = learningDetail.id;
    deepLink.dataset.unitId = learningDetail.units[0].id; deepLink.dataset.scheduleId = "33333333-3333-4333-8333-333333333333";
    root.appendChild(deepLink);
    await act(async () => { click(deepLink); await flush(20); });
    expect(root.textContent).toContain("Start review");
    await act(async () => { click(root.querySelector('#nav [data-go="home"]')); await flush(8); click(root.querySelector('#nav [data-go="courses"]')); await flush(20); });
    expect(root.textContent).toContain("No learning courses yet");
    expect(root.querySelector(".modal")?.textContent || "").not.toContain("Start review");

    await act(async () => { click(root.querySelector('[data-go="create"]')); await flush(4); });
    expect(root.textContent).toContain("Create a note");
    vi.useFakeTimers();
    click(root.querySelector('[data-act="runGen"]'));
    expect(document.body.textContent).toContain("Generating from your material");

    click(root.querySelector('[data-act="signOut"]'));
    expect(onSignOut).toHaveBeenCalledOnce();

    cleanup();
    expect(root.innerHTML).toBe("");
    expect(removeListener).toHaveBeenCalledWith("resize", resizeListener);

    // 退出后再次登录会重新挂载 resize，不能只在模块 import 时注册一次。
    const secondRoot = document.createElement("div");
    document.body.appendChild(secondRoot);
    const secondCleanup = mountNalanda(secondRoot, {
      user: { id: "u2", email: "bob@example.edu" },
      supabase: createSupabaseMock(undefined, "u2"),
      onSignOut,
    });
    await flush(12);
    expect(addListener.mock.calls.filter(([type]) => type === "resize")).toHaveLength(2);
    expect(secondRoot.textContent).toContain("Good morning, bob");
    // 上一账号的 mock generation timer 不能在新账号中跳转或显示成功。
    vi.advanceTimersByTime(1_000);
    await flush(4);
    expect(secondRoot.textContent).toContain("Good morning, bob");
    expect(document.body.textContent).not.toContain("Note created — added to My Notes");
    secondCleanup();
    expect(removeListener.mock.calls.filter(([type]) => type === "resize")).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
