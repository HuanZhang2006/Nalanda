import { describe, expect, it, vi } from "vitest";
import { click, createSupabaseMock, defaultSeed, flush } from "../test/supabase-mock";
import { initCommunity, mountCommunity, mountPost } from "./community";
import { showPointRewardReceipt } from "./point-receipt";

describe("community jsdom integration", () => {
  it("covers the feed, filters, Mine sub-tabs, composer tags/media, and detail comments", async () => {
    const supabase = createSupabaseMock();
    const toast = vi.fn();
    const root = document.createElement("div");
    root.id = "post-root";
    document.body.appendChild(root);
    initCommunity(supabase, { id: "u1", email: "alice@example.edu" }, toast);

    await mountCommunity(root);
    await flush(20);
    expect(root.textContent).toContain("Learning community");
    expect(root.textContent).toContain("My study method");
    expect(root.textContent).toContain("What is working memory");

    click(root.querySelector('[data-cm="filter"][data-f="question"]'));
    await flush(20);
    expect(root.textContent).toContain("What is working memory");
    expect(root.textContent).not.toContain("My study method");

    click(root.querySelector('[data-cm="filter"][data-f="mine"]'));
    await flush(20);
    expect(root.textContent).toContain("My community");
    expect(root.querySelectorAll('[data-cm="mtab"]')).toHaveLength(5);

    click(root.querySelector('[data-cm="mtab"][data-t="liked"]'));
    await flush(20);
    expect(root.textContent).toContain("What is working memory");

    click(root.querySelector('[data-cm="compose"]'));
    expect(document.querySelector(".scrim")?.textContent).toContain("New post");
    expect(document.querySelector(".scrim")?.textContent).toContain("Image");
    expect(document.querySelector(".scrim")?.textContent).toContain("Audio");

    click(document.querySelector('[data-tag="review"]'));
    const customTag = document.querySelector("#ps-tagnew") as HTMLInputElement;
    customTag.value = "memory";
    customTag.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush(8);
    expect(document.querySelector('[data-tag="memory"]')?.classList.contains("chip-accent")).toBe(true);

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

    (document.querySelector("#ps-title") as HTMLInputElement).value = "A new review post";
    (document.querySelector("#ps-body") as HTMLTextAreaElement).value = "Body";
    click(document.querySelector('[data-x="save"]'));
    await flush(24);

    const created = supabase.tables.posts.find((post) => post.title === "A new review post");
    expect(created?.tags).toEqual(expect.arrayContaining(["review", "memory"]));
    expect(created?.image_url).toContain("cdn.example/u1/");

    click(root.querySelector(`[data-cm="edit"][data-id="${created?.id}"]`));
    (document.querySelector("#ps-body") as HTMLTextAreaElement).value = "Edited body";
    click(document.querySelector('[data-x="save"]'));
    await flush(20);
    const postUpdate = [...supabase.operations].reverse().find((operation) =>
      operation.table === "posts" && operation.action === "update");
    expect(postUpdate?.payload).not.toHaveProperty("updated_at");

    await mountPost(root, "p1");
    await flush(20);
    expect(root.textContent).toContain("Very helpful");
    expect(root.textContent).toContain("1 comments");
    (root.querySelector("#cm-input") as HTMLInputElement).value = "Adding an example";
    click(root.querySelector('[data-cm="addcomment"]'));
    await flush(24);

    expect(supabase.tables.comments.some((comment) => comment.body === "Adding an example" && comment.post_id === "p1")).toBe(true);
    expect(root.textContent).toContain("Adding an example");
  });

  it("clears filter/interaction caches on account switch, and failed writes never show optimistic success", async () => {
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
      id: "bp1", user_id: "u2", author_name: "Bob", title: "Bob's new session", body: "isolated",
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
    expect(secondRoot.textContent).toContain("Bob's new session");
    expect(secondRoot.textContent).not.toContain("What is working memory");

    click(secondRoot.querySelector('[data-cm="like"][data-id="bp1"]'));
    await flush(12);
    expect(second.tables.post_likes).toHaveLength(0);
    expect(secondRoot.querySelector('[data-cm="like"][data-id="bp1"]')?.textContent).toContain("0");
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("like denied"));
  });

  it("reads the points receipt after success and warns at the daily cap without undoing the like", async () => {
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
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/points limit/i));
  });

  it("discards the previous account's late points receipt after an account switch", async () => {
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
