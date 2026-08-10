import { describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, defaultSeed, flush } from "../test/supabase-mock";
import { initCommunity, mountCommunity, mountPost } from "./community";
import { showPointRewardReceipt } from "./point-receipt";

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

    click(root.querySelector(`[data-cm="edit"][data-id="${created?.id}"]`));
    (document.querySelector("#ps-body") as HTMLTextAreaElement).value = "编辑后的正文";
    click(document.querySelector('[data-x="save"]'));
    await flush(20);
    const postUpdate = [...supabase.operations].reverse().find((operation) =>
      operation.table === "posts" && operation.action === "update");
    expect(postUpdate?.payload).not.toHaveProperty("updated_at");

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

  it("切换账号会清空筛选/互动缓存，写入失败不会产生乐观假成功", async () => {
    const firstRoot = document.createElement("div");
    document.body.appendChild(firstRoot);
    initCommunity(createSupabaseMock(), { id: "u1", email: "alice@example.edu" }, vi.fn());
    await mountCommunity(firstRoot);
    await flush(16);
    click(firstRoot.querySelector('[data-cm="filter"][data-f="question"]'));
    await flush(12);

    const seed = defaultSeed();
    seed.profiles = [{ id: "u2", username: "Bob", email: "bob@example.edu" }];
    seed.posts = [{
      id: "bp1", user_id: "u2", author_name: "Bob", title: "Bob 的新会话", body: "isolated",
      kind: "experience", tags: ["OnlyBob"], repost_of: null, like_count: 0, favorite_count: 0,
      comment_count: 0, repost_count: 0, created_at: new Date().toISOString(),
    }];
    seed.post_likes = [];
    seed.post_favorites = [];
    seed.follows = [];
    seed.tags = [{ kind: "tag", value: "OnlyBob" }];
    const toast = vi.fn();
    const second = createSupabaseMock(seed, "u2", { errors: { post_likes: { insert: "like denied" } } });
    const secondRoot = document.createElement("div");
    document.body.appendChild(secondRoot);
    initCommunity(second, { id: "u2", email: "bob@example.edu" }, toast);
    await mountCommunity(secondRoot);
    await flush(16);

    expect(secondRoot.querySelector('[data-cm="filter"][data-f="all"]')?.classList.contains("chip-accent")).toBe(true);
    expect(secondRoot.textContent).toContain("Bob 的新会话");
    expect(secondRoot.textContent).not.toContain("工作记忆是什么");

    click(secondRoot.querySelector('[data-cm="like"][data-id="bp1"]'));
    await flush(12);
    expect(second.tables.post_likes).toHaveLength(0);
    expect(secondRoot.querySelector('[data-cm="like"][data-id="bp1"]')?.textContent).toContain("0");
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("like denied"));
  });

  it("业务成功后读取积分回执，并在每日上限时立即提示但不撤销点赞", async () => {
    const seed = defaultSeed();
    seed.post_likes = [];
    const supabase = createSupabaseMock(seed, "u1", { rpcResults: {
      get_point_reward_receipt: { data: {
        awardedAmount: 0, dailyUsed: 20, dailyLimit: 20,
        localDate: "2026-08-10", suppressedReason: "daily_cap",
      } },
    } });
    const toast = vi.fn();
    const root = document.createElement("div"); document.body.appendChild(root);
    initCommunity(supabase, { id: "u1", email: "alice@example.edu" }, toast);
    await mountCommunity(root); await flush(16);

    click(root.querySelector('[data-cm="like"][data-id="p2"]'));
    await flush(16);
    expect(supabase.tables.post_likes.some((like) => like.post_id === "p2")).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("get_point_reward_receipt", {
      p_event_type: "like_created", p_source_id: "p2",
    });
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/积分奖励已达上限|points limit/i));
  });

  it("账号切换后丢弃旧账号延迟返回的积分回执", async () => {
    let resolveReceipt!: (value: unknown) => void;
    const supabase = {
      rpc: vi.fn(() => new Promise((resolve) => { resolveReceipt = resolve; })),
    };
    const toast = vi.fn();
    let current = true;
    const pending = showPointRewardReceipt(
      supabase,
      "post_created",
      "old-account-post",
      toast,
      () => current,
    );
    current = false;
    resolveReceipt({
      data: {
        awardedAmount: 0, dailyUsed: 3, dailyLimit: 3,
        localDate: "2026-08-10", suppressedReason: "daily_cap",
      },
      error: null,
    });
    await expect(pending).resolves.toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });
});
