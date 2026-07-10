import { describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";

describe("legacy 应用壳", () => {
  it("挂载壳、打开 8 个模块、导航/退出，并在卸载时清理", async () => {
    vi.resetModules();
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { mountNalanda } = await import("./app");
    const resizeListener = addListener.mock.calls.find(([type]) => type === "resize")?.[1];

    const root = document.createElement("div");
    document.body.appendChild(root);
    const onSignOut = vi.fn();
    const supabase = createSupabaseMock();
    const cleanup = mountNalanda(root, {
      user: { id: "u1", email: "alice@example.edu" },
      supabase,
      onSignOut,
    });
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

    click(root.querySelector('[data-act="signOut"]'));
    expect(onSignOut).toHaveBeenCalledOnce();

    cleanup();
    expect(root.innerHTML).toBe("");
    expect(removeListener).toHaveBeenCalledWith("resize", resizeListener);
  });
});

