import { describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, flush } from "../test/supabase-mock";
import { initCommunity, mountCommunity, mountPost } from "./community";

describe("社区 jsdom 集成", () => {
  it("覆盖 feed、筛选、我的子标签、composer 标签/媒体和详情评论", async () => {
    const supabase = createSupabaseMock();
    const toast = vi.fn();
    const root = document.createElement("div");
    root.id = "post-root";
    document.body.appendChild(root);
    initCommunity(supabase, { id: "u1", email: "alice@example.edu" }, toast);

    await mountCommunity(root);
    await flush(20);
    expect(root.textContent).toContain("学习社区");
    expect(root.textContent).toContain("我的学习方法");
    expect(root.textContent).toContain("工作记忆是什么");

    click(root.querySelector('[data-cm="filter"][data-f="question"]'));
    await flush(20);
    expect(root.textContent).toContain("工作记忆是什么");
    expect(root.textContent).not.toContain("我的学习方法");

    click(root.querySelector('[data-cm="filter"][data-f="mine"]'));
    await flush(20);
    expect(root.textContent).toContain("我的社区");
    expect(root.querySelectorAll('[data-cm="mtab"]')).toHaveLength(5);

    click(root.querySelector('[data-cm="mtab"][data-t="liked"]'));
    await flush(20);
    expect(root.textContent).toContain("工作记忆是什么");

    click(root.querySelector('[data-cm="compose"]'));
    expect(document.querySelector(".scrim")?.textContent).toContain("发帖");
    expect(document.querySelector(".scrim")?.textContent).toContain("图片");
    expect(document.querySelector(".scrim")?.textContent).toContain("音频");

    click(document.querySelector('[data-tag="复习"]'));
    const customTag = document.querySelector("#ps-tagnew") as HTMLInputElement;
    customTag.value = "记忆";
    customTag.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush(8);
    expect(document.querySelector('[data-tag="记忆"]')?.classList.contains("chip-accent")).toBe(true);

    const file = new File(["image"], "diagram.png", { type: "image/png" });
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      if (this.type !== "file") return;
      Object.defineProperty(this, "files", { configurable: true, value: [file] });
      this.dispatchEvent(new Event("change"));
    });
    click(document.querySelector('[data-x="img"]'));
    await flush(20);
    expect(supabase.upload).toHaveBeenCalledOnce();
    expect(document.querySelector("#ps-media img")?.getAttribute("src")).toContain("cdn.example/u1/");

    (document.querySelector("#ps-title") as HTMLInputElement).value = "新的复习帖子";
    (document.querySelector("#ps-body") as HTMLTextAreaElement).value = "正文";
    click(document.querySelector('[data-x="save"]'));
    await flush(24);

    const created = supabase.tables.posts.find((post) => post.title === "新的复习帖子");
    expect(created?.tags).toEqual(expect.arrayContaining(["复习", "记忆"]));
    expect(created?.image_url).toContain("cdn.example/u1/");

    await mountPost(root, "p1");
    await flush(20);
    expect(root.textContent).toContain("很有帮助");
    expect(root.textContent).toContain("1 条评论");
    (root.querySelector("#cm-input") as HTMLInputElement).value = "补充一个例子";
    click(root.querySelector('[data-cm="addcomment"]'));
    await flush(24);

    expect(supabase.tables.comments.some((comment) => comment.body === "补充一个例子" && comment.post_id === "p1")).toBe(true);
    expect(root.textContent).toContain("补充一个例子");
  });
});
