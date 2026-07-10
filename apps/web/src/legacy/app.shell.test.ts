import { describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";

describe("legacy 应用壳", () => {
  it("挂载壳、打开 8 个模块、导航/退出，并在卸载时清理", async () => {
    vi.resetModules();
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
    expect(root.querySelectorAll("#nav .nav-item")).toHaveLength(8);
    expect(root.textContent).toContain("Good morning");

    const routes = [
      ["home", "Good morning"],
      ["notes", "My Notes"],
      ["materials", "Materials"],
      ["schedule", "学习计划"],
      ["market", "Note Market"],
      ["community", "学习社区"],
      ["profile", "徽章"],
      ["feedback", "Feedback"],
    ] as const;

    for (const [route, expectedText] of routes) {
      click(root.querySelector(`#nav [data-go="${route}"]`));
      await flush(20);
      expect(root.querySelector(`#nav [data-go="${route}"]`)?.classList.contains("active")).toBe(true);
      expect(root.textContent).toContain(expectedText);
    }

    click(root.querySelector('[data-go="create"]'));
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
  });
});
