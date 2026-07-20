// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

// Supabase constructs its Realtime client for every createClient call. The
// RLS suite itself uses Auth/PostgREST/Storage, but Node 20 needs this explicit
// adapter to construct the client without a native WebSocket implementation.
if (!globalThis.WebSocket) {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: WebSocket,
  });
}

const enabled = process.env.RUN_SUPABASE_RLS_E2E === "1";
const url = process.env.SUPABASE_URL || "";
const anonKey = process.env.SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const confirmedProjectRef = process.env.SUPABASE_RLS_E2E_CONFIRM_REF || "";

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

describe.runIf(enabled).sequential("Supabase 双用户 RLS E2E", () => {
  let admin: SupabaseClient;
  let a: SupabaseClient;
  let b: SupabaseClient;
  let aId = "";
  let bId = "";
  let aName = "";
  const storagePaths: string[] = [];

  beforeAll(async () => {
    if (!url || !anonKey || !serviceRoleKey || !confirmedProjectRef) {
      throw new Error("RUN_SUPABASE_RLS_E2E=1 时必须设置 SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、SUPABASE_RLS_E2E_CONFIRM_REF");
    }
    const actualProjectRef = new URL(url).hostname.split(".")[0];
    if (!actualProjectRef || confirmedProjectRef !== actualProjectRef) {
      throw new Error(`SUPABASE_RLS_E2E_CONFIRM_REF 与 SUPABASE_URL 的 project ref 不匹配（实际为 ${actualProjectRef || "无法识别"}）`);
    }

    admin = createClient(url, serviceRoleKey, clientOptions);
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const password = `Nalanda-E2E-${nonce}!`;
    const emailA = `nalanda-e2e-a-${nonce}@example.com`;
    const emailB = `nalanda-e2e-b-${nonce}@example.com`;
    const [createdA, createdB] = await Promise.all([
      admin.auth.admin.createUser({ email: emailA, password, email_confirm: true }),
      admin.auth.admin.createUser({ email: emailB, password, email_confirm: true }),
    ]);
    aId = createdA.data.user?.id || "";
    bId = createdB.data.user?.id || "";
    if (createdA.error || !createdA.data.user) throw createdA.error || new Error("无法创建测试用户 A");
    if (createdB.error || !createdB.data.user) throw createdB.error || new Error("无法创建测试用户 B");
    aName = emailA.split("@")[0];

    a = createClient(url, anonKey, clientOptions);
    b = createClient(url, anonKey, clientOptions);
    const [signedA, signedB] = await Promise.all([
      a.auth.signInWithPassword({ email: emailA, password }),
      b.auth.signInWithPassword({ email: emailB, password }),
    ]);
    if (signedA.error) throw signedA.error;
    if (signedB.error) throw signedB.error;
  }, 30_000);

  afterAll(async () => {
    const cleanupErrors: string[] = [];
    // auth 级联不保证清理 Storage，因此先用 service role 删除测试对象。
    if (admin && storagePaths.length) {
      const removed = await admin.storage.from("materials").remove(storagePaths);
      if (removed.error) cleanupErrors.push(`Storage cleanup: ${removed.error.message}`);
    }
    // 删除 auth 用户会通过外键级联删除本套件产生的业务表数据。
    if (admin && aId) {
      const deleted = await admin.auth.admin.deleteUser(aId);
      if (deleted.error) cleanupErrors.push(`User A cleanup: ${deleted.error.message}`);
    }
    if (admin && bId) {
      const deleted = await admin.auth.admin.deleteUser(bId);
      if (deleted.error) cleanupErrors.push(`User B cleanup: ${deleted.error.message}`);
    }
    if (admin && aId && bId) {
      const [entryRemnants, stateRemnants] = await Promise.all([
        admin.from("point_entries").select("id").in("user_id", [aId, bId]),
        admin.from("point_event_states").select("business_key").in("user_id", [aId, bId]),
      ]);
      if (entryRemnants.error) cleanupErrors.push(`Ledger cleanup check: ${entryRemnants.error.message}`);
      else if (entryRemnants.data.length) cleanupErrors.push(`Ledger cleanup check: ${entryRemnants.data.length} rows remain`);
      if (stateRemnants.error) cleanupErrors.push(`Point state cleanup check: ${stateRemnants.error.message}`);
      else if (stateRemnants.data.length) cleanupErrors.push(`Point state cleanup check: ${stateRemnants.data.length} rows remain`);
    }
    if (cleanupErrors.length) throw new Error(cleanupErrors.join("; "));
  }, 30_000);

  it("隔离 profile、通知、反馈、课程、资料和存储归属", async () => {
    const ownProfile = await a.from("profiles").select("id,username").eq("id", aId).single();
    expect(ownProfile.error).toBeNull();
    expect(ownProfile.data?.id).toBe(aId);
    const hiddenProfile = await b.from("profiles").select("id").eq("id", aId);
    expect(hiddenProfile.error).toBeNull();
    expect(hiddenProfile.data).toEqual([]);
    const forbiddenProfileUpdate = await b.from("profiles").update({ username: "spoofed" }).eq("id", aId).select("id");
    expect(forbiddenProfileUpdate.error).toBeNull();
    expect(forbiddenProfileUpdate.data).toEqual([]);

    const protectedBefore = await a.from("profiles")
      .select("points,credits,level,level_name,vip_until,streak,streak_date")
      .eq("id", aId)
      .single();
    expect(protectedBefore.error).toBeNull();
    const protectedPatches = [
      { points: 99_999 },
      { credits: 99_999 },
      { level: 6 },
      { level_name: "FORGED" },
      { vip_until: "2099-01-01T00:00:00.000Z" },
      { streak: 99_999 },
      { streak_date: "2099-01-01" },
    ];
    for (const patch of protectedPatches) {
      const result = await a.from("profiles").update(patch).eq("id", aId);
      expect(result.error, `profile 受保护字段不应允许客户端更新：${Object.keys(patch)[0]}`).not.toBeNull();
    }
    const protectedAfter = await a.from("profiles")
      .select("points,credits,level,level_name,vip_until,streak,streak_date")
      .eq("id", aId)
      .single();
    expect(protectedAfter.data).toEqual(protectedBefore.data);

    const rpcBefore = await a.from("profiles").select("points").eq("id", aId).single();
    expect((await a.rpc("_add_points", { uid: aId, d: 9_999 })).error).not.toBeNull();
    expect((await a.rpc("_notify", {
      uid: bId,
      ntype: "forged",
      ntitle: "forged",
      nbody: "forged",
    })).error).not.toBeNull();
    expect((await a.rpc("_set_point_event", {
      p_user_id: aId,
      p_event_type: "forged",
      p_business_key: `forged:${aId}`,
      p_reward_amount: 9_999,
      p_active: true,
      p_source_id: aId,
      p_metadata: {},
    })).error).not.toBeNull();
    expect((await a.rpc("_points_normalize_text", { p_value: "client helper call" })).error).not.toBeNull();
    expect((await a.rpc("_post_points_key", {
      p_user_id: aId,
      p_title: "forged",
      p_body: "forged",
      p_kind: "forged",
      p_subject: "forged",
      p_tags: [],
    })).error).not.toBeNull();
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data).toEqual(rpcBefore.data);
    expect((await b.from("notifications").select("id").eq("type", "forged")).data).toEqual([]);

    const forgedLedgerWrite = await a.from("point_entries").insert({
      user_id: aId,
      event_type: "forged",
      business_key: `forged:${aId}`,
      amount: 9_999,
      transition_no: 1,
    });
    expect(forgedLedgerWrite.error).not.toBeNull();
    expect((await a.from("point_event_states").select("business_key").limit(1)).error).not.toBeNull();
    expect((await admin.from("point_entries").insert({
      user_id: aId,
      event_type: "service-forged",
      business_key: `service-forged:${aId}`,
      amount: 9_999,
      transition_no: 1,
    })).error).not.toBeNull();
    expect((await admin.from("point_event_states").insert({
      business_key: `service-forged:${aId}`,
      user_id: aId,
      event_type: "service-forged",
      reward_amount: 9_999,
    })).error).not.toBeNull();

    const uniqueUniversity = `E2E University ${aId.slice(0, 8)}`;
    const uniqueMajor = `E2E Major ${aId.slice(0, 8)}`;
    expect((await a.from("profiles").update({ university: uniqueUniversity, major: uniqueMajor }).eq("id", aId)).error).toBeNull();
    const syncedTags = await b.from("tags").select("kind,value").in("value", [uniqueUniversity, uniqueMajor]);
    expect(syncedTags.error).toBeNull();
    expect(syncedTags.data).toEqual(expect.arrayContaining([
      { kind: "university", value: uniqueUniversity },
      { kind: "major", value: uniqueMajor },
    ]));

    const notification = await a.from("notifications").insert({ title: "RLS notification" }).select("id").single();
    expect(notification.error).toBeNull();
    const hiddenNotification = await b.from("notifications").select("id").eq("id", notification.data!.id);
    expect(hiddenNotification.data).toEqual([]);

    const feedback = await a.from("feedback").insert({ category: "Bug", summary: "RLS feedback" }).select("id").single();
    expect(feedback.error).toBeNull();
    const hiddenFeedback = await b.from("feedback").select("id").eq("id", feedback.data!.id);
    expect(hiddenFeedback.data).toEqual([]);

    const course = await a.from("courses").insert({ code: "E2E 101", name: "RLS Course" }).select("id").single();
    expect(course.error).toBeNull();
    const material = await a.from("materials").insert({
      course_id: course.data!.id,
      name: "rls.txt",
      type: "txt",
      storage_path: `${aId}/rls.txt`,
    }).select("id").single();
    expect(material.error).toBeNull();
    const ownMaterialList = await a.from("materials").select("id,name,storage_path").eq("course_id", course.data!.id);
    expect(ownMaterialList.error).toBeNull();
    expect(ownMaterialList.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: material.data!.id, name: "rls.txt" }),
    ]));
    expect((await b.from("courses").select("id").eq("id", course.data!.id)).data).toEqual([]);
    expect((await b.from("materials").select("id").eq("id", material.data!.id)).data).toEqual([]);
    expect((await b.from("tags").select("value").eq("kind", "subject").eq("value", "E2E 101")).data).toHaveLength(1);

    const crossOwnerMaterial = await b.from("materials").insert({
      course_id: course.data!.id,
      name: "cross-owner.txt",
      type: "txt",
      storage_path: `${bId}/cross-owner.txt`,
    });
    expect(crossOwnerMaterial.error).not.toBeNull();

    const storagePath = `${aId}/rls-${Date.now()}.txt`;
    storagePaths.push(storagePath);
    const upload = await a.storage.from("materials").upload(storagePath, new Blob(["rls"]), { contentType: "text/plain" });
    expect(upload.error).toBeNull();
    expect((await a.storage.from("materials").download(storagePath)).error).toBeNull();
    expect((await a.storage.from("materials").createSignedUrl(storagePath, 60)).error).toBeNull();
    expect((await b.storage.from("materials").download(storagePath)).error).not.toBeNull();
    expect((await b.storage.from("materials").createSignedUrl(storagePath, 60)).error).not.toBeNull();
    const forbiddenStoragePath = `${aId}/forbidden-${Date.now()}.txt`;
    storagePaths.push(forbiddenStoragePath);
    expect((await b.storage.from("materials").upload(forbiddenStoragePath, new Blob(["forbidden"]))).error).not.toBeNull();

    // 验证正常的显式清理路径；afterAll 仍为测试中途失败提供兜底。
    expect((await a.storage.from("materials").remove([storagePath])).error).toBeNull();
    expect((await a.from("materials").delete().eq("id", material.data!.id)).error).toBeNull();
    expect((await a.from("courses").delete().eq("id", course.data!.id)).error).toBeNull();
  }, 30_000);

  it("验证社区公共读、四类计数、作者防伪造、关注和作者权限", async () => {
    const post = await a.from("posts").insert({
      title: "RLS community post",
      body: "body",
      kind: "question",
      tags: ["e2e"],
      author_name: "HACKER",
      author_university: "FAKE",
    }).select("*").single();
    expect(post.error).toBeNull();
    expect(post.data?.author_name).toBe(aName);

    const publicRead = await b.from("posts").select("id").eq("id", post.data!.id).single();
    expect(publicRead.error).toBeNull();
    const originalPostKey = post.data!.points_business_key;
    expect(originalPostKey).toMatch(/^post:/);
    const forgedPostKey = await a.from("posts")
      .update({ points_business_key: `forged:${aId}` })
      .eq("id", post.data!.id);
    expect(forgedPostKey.error).not.toBeNull();
    const forgedRepostIdentity = await a.from("posts")
      .update({ repost_of: post.data!.id })
      .eq("id", post.data!.id);
    expect(forgedRepostIdentity.error).not.toBeNull();

    await expect(b.from("post_likes").insert({ post_id: post.data!.id })).resolves.toMatchObject({ error: null });
    await expect(b.from("post_favorites").insert({ post_id: post.data!.id })).resolves.toMatchObject({ error: null });
    const comment = await b.from("comments").insert({ post_id: post.data!.id, body: "comment", author_name: "HACKER" }).select("*").single();
    expect(comment.error).toBeNull();
    expect(comment.data?.author_name).not.toBe("HACKER");
    const repost = await b.from("posts")
      .insert({ repost_of: post.data!.id, kind: "experience", tags: [] })
      .select("id,points_business_key")
      .single();
    expect(repost.error).toBeNull();
    await expect(b.from("follows").insert({ following_id: aId })).resolves.toMatchObject({ error: null });

    const counted = await a.from("posts").select("like_count,favorite_count,comment_count,repost_count").eq("id", post.data!.id).single();
    expect(counted.data).toMatchObject({ like_count: 1, favorite_count: 1, comment_count: 1, repost_count: 1 });
    expect((await a.from("post_likes").select("post_id").eq("post_id", post.data!.id)).data).toEqual([]);
    expect((await b.from("post_likes").select("post_id").eq("post_id", post.data!.id)).data).toHaveLength(1);

    const forbiddenUpdate = await b.from("posts").update({ title: "hijacked" }).eq("id", post.data!.id).select("id");
    expect(forbiddenUpdate.data).toEqual([]);
    const forbiddenDelete = await b.from("posts").delete().eq("id", post.data!.id).select("id");
    expect(forbiddenDelete.data).toEqual([]);
    expect((await a.from("notifications").select("id").in("type", ["like", "comment", "favorite", "repost", "follow"])).data!.length).toBeGreaterThanOrEqual(5);

    // like：actor + 原帖不可变内容键为永久业务键；取消会冲正，重赞只恢复同一净额。
    const bPointsAfterInteractions = await b.from("profiles").select("points").eq("id", bId).single();
    expect((await b.from("post_likes").delete().eq("post_id", post.data!.id)).error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points - 1);
    expect((await b.from("post_likes").insert({ post_id: post.data!.id })).error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points);

    // comment：同一用户在同一逻辑帖子只有一个净奖励；仍有另一条时删除不冲正。
    const secondComment = await b.from("comments")
      .insert({ post_id: post.data!.id, body: "second comment" })
      .select("id")
      .single();
    expect(secondComment.error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points);
    expect((await b.from("comments").delete().eq("id", comment.data!.id)).error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points);
    expect((await b.from("comments").delete().eq("id", secondComment.data!.id)).error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points - 2);
    const recreatedComment = await b.from("comments")
      .insert({ post_id: post.data!.id, body: "comment recreated" })
      .select("id")
      .single();
    expect(recreatedComment.error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points);

    // 并发删除同一 actor/post 的最后两条评论也只能做一次冲正，不能遗留 active。
    const concurrentComment = await b.from("comments")
      .insert({ post_id: post.data!.id, body: "concurrent delete" })
      .select("id")
      .single();
    expect(concurrentComment.error).toBeNull();
    const concurrentDeletes = await Promise.all([
      b.from("comments").delete().eq("id", recreatedComment.data!.id),
      b.from("comments").delete().eq("id", concurrentComment.data!.id),
    ]);
    expect(concurrentDeletes.map((result) => result.error)).toEqual([null, null]);
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points - 2);
    const concurrentCommentState = await admin.from("point_event_states")
      .select("is_active,transition_no")
      .eq("business_key", `comment:${originalPostKey}:${bId}`)
      .single();
    expect(concurrentCommentState.data).toEqual({ is_active: false, transition_no: 4 });
    expect((await b.from("comments").insert({ post_id: post.data!.id, body: "restored after concurrent delete" })).error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points);

    // repost：actor + original 为永久业务键；重复转发不加分，最后一个删除才冲正。
    const duplicateRepost = await b.from("posts")
      .insert({ repost_of: post.data!.id, kind: "experience", tags: [], body: "another caption" })
      .select("id")
      .single();
    expect(duplicateRepost.error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points);
    expect((await b.from("posts").delete().eq("id", repost.data!.id)).error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points);
    expect((await b.from("posts").delete().eq("id", duplicateRepost.data!.id)).error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points - 3);
    const recreatedRepost = await b.from("posts")
      .insert({ repost_of: post.data!.id, kind: "experience", tags: [] })
      .select("id")
      .single();
    expect(recreatedRepost.error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bPointsAfterInteractions.data!.points);

    // 原创帖使用规范化内容指纹；删除/重建反复执行后净 points 回到原值。
    const beforeDisposablePost = bPointsAfterInteractions.data!.points;
    const disposablePost = await b.from("posts").insert({
      title: "Stable fingerprint post",
      body: "same normalized body",
      kind: "tip",
      subject: "E2E",
      tags: ["ledger", "idempotency"],
    }).select("id,points_business_key").single();
    expect(disposablePost.error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(beforeDisposablePost + 10);
    expect((await b.from("posts").delete().eq("id", disposablePost.data!.id)).error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(beforeDisposablePost);
    const recreatedPost = await b.from("posts").insert({
      title: "  stable   fingerprint POST ",
      body: " same normalized   body ",
      kind: "TIP",
      subject: "e2e",
      tags: ["idempotency", "ledger"],
    }).select("id,points_business_key").single();
    expect(recreatedPost.error).toBeNull();
    expect(recreatedPost.data!.points_business_key).toBe(disposablePost.data!.points_business_key);
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(beforeDisposablePost + 10);
    expect((await b.from("posts").delete().eq("id", recreatedPost.data!.id)).error).toBeNull();
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(beforeDisposablePost);

    const likeKey = `like:${originalPostKey}:${bId}`;
    const commentKey = `comment:${originalPostKey}:${bId}`;
    const repostKey = `repost:${bId}:${originalPostKey}`;
    const ownLedger = await b.from("point_entries")
      .select("event_type,business_key,amount,transition_no")
      .in("business_key", [likeKey, commentKey, repostKey, disposablePost.data!.points_business_key]);
    expect(ownLedger.error).toBeNull();
    expect(ownLedger.data!.filter((entry) => entry.business_key === likeKey).map((entry) => entry.amount).sort((x, y) => x - y))
      .toEqual([-1, 1, 1]);
    expect(ownLedger.data!.filter((entry) => entry.business_key === commentKey).map((entry) => entry.amount).sort((x, y) => x - y))
      .toEqual([-2, -2, 2, 2, 2]);
    expect(ownLedger.data!.filter((entry) => entry.business_key === repostKey).map((entry) => entry.amount).sort((x, y) => x - y))
      .toEqual([-3, 3, 3]);
    expect(ownLedger.data!.filter((entry) => entry.business_key === disposablePost.data!.points_business_key).map((entry) => entry.amount))
      .toHaveLength(4);
    expect((await a.from("point_entries").select("id").in("business_key", [likeKey, commentKey, repostKey])).data).toEqual([]);

    const states = await admin.from("point_event_states")
      .select("business_key,is_active,transition_no")
      .in("business_key", [likeKey, commentKey, repostKey, disposablePost.data!.points_business_key]);
    expect(states.error).toBeNull();
    expect(states.data).toEqual(expect.arrayContaining([
      { business_key: likeKey, is_active: true, transition_no: 3 },
      { business_key: commentKey, is_active: true, transition_no: 5 },
      { business_key: repostKey, is_active: true, transition_no: 3 },
      { business_key: disposablePost.data!.points_business_key, is_active: false, transition_no: 4 },
    ]));

    // 删除原帖会级联删除 like/comment/repost；每个 actor 的净奖励都必须各冲正一次。
    const aBeforeCascade = await a.from("profiles").select("points").eq("id", aId).single();
    const bBeforeCascade = await b.from("profiles").select("points").eq("id", bId).single();
    expect((await a.from("posts").delete().eq("id", post.data!.id)).error).toBeNull();
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points)
      .toBe(aBeforeCascade.data!.points - 10);
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(bBeforeCascade.data!.points - 6);
    const cascadedStates = await admin.from("point_event_states")
      .select("business_key,is_active,transition_no")
      .in("business_key", [likeKey, commentKey, repostKey]);
    expect(cascadedStates.data).toEqual(expect.arrayContaining([
      { business_key: likeKey, is_active: false, transition_no: 4 },
      { business_key: commentKey, is_active: false, transition_no: 6 },
      { business_key: repostKey, is_active: false, transition_no: 4 },
    ]));
    const bLedgerAfterCascade = await b.from("point_entries").select("amount");
    expect(bLedgerAfterCascade.error).toBeNull();
    expect(bLedgerAfterCascade.data!.reduce((sum, entry) => sum + entry.amount, 0))
      .toBe((await b.from("profiles").select("points").eq("id", bId).single()).data!.points);

    // 相同原创内容重建只恢复原来的 +10，不增加历史净额。
    const restoredOriginal = await a.from("posts").insert({
      title: "RLS community post",
      body: "body",
      kind: "question",
      tags: ["e2e"],
    }).select("points_business_key").single();
    expect(restoredOriginal.error).toBeNull();
    expect(restoredOriginal.data!.points_business_key).toBe(originalPostKey);
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points)
      .toBe(aBeforeCascade.data!.points);

    // 发帖触发器每篇 +10；达到 50 后等级应同步提升为 Learner。
    const extraPosts = Array.from({ length: 4 }, (_, index) => ({ title: `Level post ${index}`, kind: "experience", tags: [] }));
    expect((await a.from("posts").insert(extraPosts)).error).toBeNull();
    const leveled = await a.from("profiles").select("points,level,level_name").eq("id", aId).single();
    expect(leveled.data!.points).toBeGreaterThanOrEqual(50);
    expect(leveled.data).toMatchObject({ level: 2, level_name: "Learner" });
  }, 60_000);

  it("验证计划 RLS、跨用户课程校验、完成积分和同日 streak 去重", async () => {
    const course = await a.from("courses").insert({ code: "PLAN 101", name: "Plan Course" }).select("id").single();
    expect(course.error).toBeNull();
    const material = await a.from("materials").insert({
      course_id: course.data!.id,
      name: "plan.pdf",
      type: "pdf",
      storage_path: `${aId}/plan.pdf`,
    }).select("id").single();
    const goal = await a.from("study_goals").insert({ title: "Plan exam", course_id: course.data!.id }).select("id").single();
    expect(material.error).toBeNull();
    expect(goal.error).toBeNull();

    const tasks = await a.from("study_tasks").insert([
      { title: "Plan task one", course_id: course.data!.id, material_id: material.data!.id, goal_id: goal.data!.id },
      { title: "Plan task two", course_id: course.data!.id },
    ]).select("id,points_business_key");
    expect(tasks.error).toBeNull();
    expect(tasks.data).toHaveLength(2);
    expect((await b.from("study_tasks").select("id").in("id", tasks.data!.map((task) => task.id))).data).toEqual([]);

    const crossOwnerTask = await b.from("study_tasks").insert({ title: "Cross owner", course_id: course.data!.id });
    expect(crossOwnerTask.error).not.toBeNull();
    const forgedTaskKey = await a.from("study_tasks")
      .update({ points_business_key: `forged:${aId}` })
      .eq("id", tasks.data![0].id);
    expect(forgedTaskKey.error).not.toBeNull();

    const before = await a.from("profiles").select("points,streak").eq("id", aId).single();
    expect((await a.from("study_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", tasks.data![0].id)).error).toBeNull();
    const afterFirst = await a.from("profiles").select("points,streak").eq("id", aId).single();
    expect((await a.from("study_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", tasks.data![1].id)).error).toBeNull();
    const afterSecond = await a.from("profiles").select("points,streak").eq("id", aId).single();

    expect(afterFirst.data!.points).toBe(before.data!.points + 5);
    expect(afterSecond.data!.points).toBe(before.data!.points + 10);
    expect(afterFirst.data!.streak).toBeGreaterThanOrEqual(1);
    expect(afterSecond.data!.streak).toBe(afterFirst.data!.streak);

    // 同一任务反复取消/完成只在 +5/-5 间切换，且不会再次推进 streak。
    expect((await a.from("study_tasks").update({ done: false, done_at: null }).eq("id", tasks.data![0].id)).error).toBeNull();
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points).toBe(before.data!.points + 5);
    expect((await a.from("study_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", tasks.data![0].id)).error).toBeNull();
    expect((await a.from("study_tasks").update({ done: false, done_at: null }).eq("id", tasks.data![0].id)).error).toBeNull();
    expect((await a.from("study_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", tasks.data![0].id)).error).toBeNull();
    const afterRedo = await a.from("profiles").select("points,streak").eq("id", aId).single();
    expect(afterRedo.data!.points).toBe(before.data!.points + 10);
    expect(afterRedo.data!.streak).toBe(afterFirst.data!.streak);

    // 删除已完成任务会冲正；相同业务指纹的重建仅恢复净 +5。
    expect((await a.from("study_tasks").delete().eq("id", tasks.data![0].id)).error).toBeNull();
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points).toBe(before.data!.points + 5);
    const recreatedTask = await a.from("study_tasks").insert({
      title: "  plan   TASK one ",
      course_id: course.data!.id,
      material_id: material.data!.id,
      goal_id: goal.data!.id,
    }).select("id,points_business_key").single();
    expect(recreatedTask.error).toBeNull();
    expect(recreatedTask.data!.points_business_key).toBe(tasks.data![0].points_business_key);
    expect((await a.from("study_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", recreatedTask.data!.id)).error).toBeNull();
    const afterRecreate = await a.from("profiles").select("points,streak").eq("id", aId).single();
    expect(afterRecreate.data!.points).toBe(before.data!.points + 10);
    expect(afterRecreate.data!.streak).toBe(afterFirst.data!.streak);

    const taskLedger = await a.from("point_entries")
      .select("amount,transition_no")
      .eq("business_key", tasks.data![0].points_business_key)
      .order("transition_no", { ascending: true });
    expect(taskLedger.error).toBeNull();
    expect(taskLedger.data!.map((entry) => entry.amount)).toEqual([5, -5, 5, -5, 5, -5, 5]);
    const taskState = await admin.from("point_event_states")
      .select("is_active,transition_no")
      .eq("business_key", tasks.data![0].points_business_key)
      .single();
    expect(taskState.data).toEqual({ is_active: true, transition_no: 7 });

    const [allEntries, projectedProfile] = await Promise.all([
      a.from("point_entries").select("amount"),
      a.from("profiles").select("points").eq("id", aId).single(),
    ]);
    expect(allEntries.error).toBeNull();
    expect(allEntries.data!.reduce((sum, entry) => sum + entry.amount, 0)).toBe(projectedProfile.data!.points);
  }, 60_000);
});
