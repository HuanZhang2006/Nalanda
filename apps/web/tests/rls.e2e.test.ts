// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
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
  const audioCacheKeys: string[] = [];

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
    if (admin && audioCacheKeys.length) {
      const removed = await admin.from("learning_audio_assets").delete().in("cache_key", audioCacheKeys);
      if (removed.error) cleanupErrors.push(`Audio queue cleanup: ${removed.error.message}`);
    }
    // Moderation actions and abuse signals intentionally reject direct
    // service-role DELETE. This disposable Supabase stack is destroyed after
    // the suite, so test audit facts deliberately remain append-only here.
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
      const [
        entryRemnants, stateRemnants, claimRemnants, windowRemnants,
        courseRemnants, attemptRemnants, badgeRemnants, usageRemnants,
        aiJobRemnants, noteRemnants, examRemnants, aiUsageRemnants,
      ] = await Promise.all([
        admin.from("point_entries").select("id").in("user_id", [aId, bId]),
        admin.from("point_event_states").select("business_key").in("user_id", [aId, bId]),
        admin.from("point_daily_award_claims").select("business_key").in("user_id", [aId, bId]),
        admin.from("point_daily_windows").select("id").in("user_id", [aId, bId]),
        admin.from("learning_courses").select("id").in("user_id", [aId, bId]),
        admin.from("learning_attempts").select("id").in("user_id", [aId, bId]),
        admin.from("user_badge_awards").select("badge_code").in("user_id", [aId, bId]),
        admin.from("learning_speech_usage").select("id").in("user_id", [aId, bId]),
        admin.from("generation_jobs").select("id").in("user_id", [aId, bId]),
        admin.from("notes").select("id").in("user_id", [aId, bId]),
        admin.from("exam_attempts").select("id").in("user_id", [aId, bId]),
        admin.from("ai_provider_usage_events").select("id").in("user_id", [aId, bId]),
      ]);
      if (entryRemnants.error) cleanupErrors.push(`Ledger cleanup check: ${entryRemnants.error.message}`);
      else if (entryRemnants.data.length) cleanupErrors.push(`Ledger cleanup check: ${entryRemnants.data.length} rows remain`);
      if (stateRemnants.error) cleanupErrors.push(`Point state cleanup check: ${stateRemnants.error.message}`);
      else if (stateRemnants.data.length) cleanupErrors.push(`Point state cleanup check: ${stateRemnants.data.length} rows remain`);
      if (claimRemnants.error) cleanupErrors.push(`Point claim cleanup check: ${claimRemnants.error.message}`);
      else if (claimRemnants.data.length) cleanupErrors.push(`Point claim cleanup check: ${claimRemnants.data.length} rows remain`);
      if (windowRemnants.error) cleanupErrors.push(`Point window cleanup check: ${windowRemnants.error.message}`);
      else if (windowRemnants.data.length) cleanupErrors.push(`Point window cleanup check: ${windowRemnants.data.length} rows remain`);
      for (const [label, result] of [["Learning courses", courseRemnants], ["Learning attempts", attemptRemnants], ["Badge awards", badgeRemnants], ["Speech user links", usageRemnants]] as const) {
        if (result.error) cleanupErrors.push(`${label} cleanup check: ${result.error.message}`);
        else if (result.data.length) cleanupErrors.push(`${label} cleanup check: ${result.data.length} rows remain`);
      }
      for (const [label, result] of [["AI jobs", aiJobRemnants], ["AI notes", noteRemnants], ["Exam attempts", examRemnants], ["AI provider usage", aiUsageRemnants]] as const) {
        if (result.error) cleanupErrors.push(`${label} cleanup check: ${result.error.message}`);
        else if (result.data.length) cleanupErrors.push(`${label} cleanup check: ${result.data.length} rows remain`);
      }
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
    expect((await a.from("feedback").insert({
      category: "Bug", summary: "forged status", status: "resolved",
    })).error).not.toBeNull();
    expect((await a.from("feedback").update({ summary: "mutated" }).eq("id", feedback.data!.id)).error).not.toBeNull();
    expect((await a.from("feedback").update({ status: "resolved" }).eq("id", feedback.data!.id)).error).not.toBeNull();
    expect((await a.from("feedback").delete().eq("id", feedback.data!.id)).error).not.toBeNull();
    expect((await admin.from("feedback").update({ status: "resolved" }).eq("id", feedback.data!.id)).error).toBeNull();
    expect((await a.from("feedback").select("status").eq("id", feedback.data!.id).single()).data?.status).toBe("resolved");

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
    expect((await a.from("materials").delete().eq("id", material.data!.id)).error).not.toBeNull();
    expect((await a.from("courses").delete().eq("id", course.data!.id)).error).not.toBeNull();
    const deletedCourse = await admin.rpc("ai_delete_material_course", {
      p_user_id: aId, p_course_id: course.data!.id, p_delete_results: true,
    });
    expect(deletedCourse.error).toBeNull();
  }, 30_000);

  it("验证社区公共读、四类计数、作者防伪造、关注和作者权限", async () => {
    const forgedPostInserts = [
      { title: "forged owner", user_id: bId },
      { title: "forged author", author_name: "HACKER", author_university: "FAKE" },
      { title: "forged counters", like_count: 999, comment_count: 999 },
      { title: "forged key", points_business_key: `forged:${aId}` },
      { title: "forged creation", created_at: "2099-01-01T00:00:00.000Z" },
      { title: "forged update", updated_at: "2099-01-01T00:00:00.000Z" },
    ];
    for (const payload of forgedPostInserts) {
      expect((await a.from("posts").insert(payload)).error).not.toBeNull();
    }
    const post = await a.from("posts").insert({
      title: "RLS community post",
      body: "body",
      kind: "question",
      tags: ["e2e"],
    }).select("*").single();
    expect(post.error).toBeNull();
    expect(post.data?.author_name).toBe(aName);

    const createdAt = post.data!.created_at;
    const originalUpdatedAt = post.data!.updated_at;
    const edited = await a.from("posts")
      .update({ title: "RLS community post edited", updated_at: "2099-01-01T00:00:00.000Z" })
      .eq("id", post.data!.id)
      .select("title,created_at,updated_at")
      .single();
    expect(edited.error).toBeNull();
    expect(edited.data?.title).toBe("RLS community post edited");
    expect(edited.data?.created_at).toBe(createdAt);
    expect(edited.data?.updated_at).not.toBe("2099-01-01T00:00:00.000Z");
    expect(edited.data?.updated_at).not.toBe(originalUpdatedAt);

    for (const patch of [
      { user_id: bId },
      { author_name: "HACKER" },
      { like_count: 999 },
      { created_at: "2099-01-01T00:00:00.000Z" },
    ]) {
      expect((await a.from("posts").update(patch).eq("id", post.data!.id)).error).not.toBeNull();
    }

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
    expect((await a.from("posts").select("updated_at").eq("id", post.data!.id).single()).data?.updated_at)
      .toBe(edited.data?.updated_at);
    expect((await a.from("post_likes").select("post_id").eq("post_id", post.data!.id)).data).toEqual([]);
    expect((await b.from("post_likes").select("post_id").eq("post_id", post.data!.id)).data).toHaveLength(1);

    const forbiddenUpdate = await b.from("posts").update({ title: "hijacked" }).eq("id", post.data!.id).select("id");
    expect(forbiddenUpdate.data).toEqual([]);
    const forbiddenDelete = await b.from("posts").delete().eq("id", post.data!.id).select("id");
    expect(forbiddenDelete.data).toEqual([]);
    expect((await a.from("notifications").select("id").in("type", ["like", "comment", "favorite", "repost", "follow"])).data!.length).toBeGreaterThanOrEqual(5);
    const ownReceipt = await a.rpc("get_point_reward_receipt", {
      p_event_type: "post_created", p_source_id: post.data!.id,
    });
    expect(ownReceipt.error).toBeNull();
    expect(ownReceipt.data).toMatchObject({ awardedAmount: 10, dailyUsed: 1, dailyLimit: 3, suppressedReason: null });
    expect((await b.rpc("get_point_reward_receipt", {
      p_event_type: "post_created", p_source_id: post.data!.id,
    })).error).not.toBeNull();
    for (const table of [
      "point_daily_windows", "point_daily_award_claims", "point_daily_cap_notifications",
      "point_moderation_actions", "point_abuse_signals", "api_abuse_events",
    ]) {
      expect((await a.from(table).select("*").limit(1)).error, `${table} must remain service-only`).not.toBeNull();
    }
    expect((await a.rpc("scan_point_abuse_signals")).error).not.toBeNull();
    expect((await a.rpc("review_point_abuse_signal", {
      p_reviewer_user_id: aId,
      p_signal_id: randomUUID(),
      p_status: "dismissed",
      p_review_note: "client forgery",
      p_case_reference: null,
    })).error).not.toBeNull();
    expect((await a.rpc("moderate_point_rewards", {
      p_admin_user_id: aId, p_action: "suppress", p_target_type: "post",
      p_target_key: post.data!.id, p_reason: "client forgery", p_case_reference: null,
    })).error).not.toBeNull();
    expect((await admin.from("point_daily_award_claims")
      .update({ awarded_amount: 999 }).eq("business_key", "not-present")).error).not.toBeNull();
    expect((await admin.from("point_moderation_actions")
      .delete().eq("id", -1)).error).not.toBeNull();
    expect((await admin.from("point_abuse_signals")
      .update({ status: "dismissed" }).eq("id", randomUUID())).error).not.toBeNull();

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

    // Admin moderation covers the entire root content chain. The operation is
    // reversible, audited and inaccessible through an authenticated client.
    const beforeSuppressionA = (await a.from("profiles").select("points").eq("id", aId).single()).data!.points;
    const beforeSuppressionB = (await b.from("profiles").select("points").eq("id", bId).single()).data!.points;
    const suppressed = await admin.rpc("moderate_point_rewards", {
      p_admin_user_id: aId,
      p_action: "suppress",
      p_target_type: "post",
      p_target_key: post.data!.id,
      p_reason: "RLS root-chain test",
      p_case_reference: "E2E-ROOT-1",
    });
    expect(suppressed.error).toBeNull();
    expect(suppressed.data).toMatchObject({
      action: "suppress", targetType: "post_root", targetKey: originalPostKey,
      affectedEventCount: 4, affectedAmount: 16,
    });
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points)
      .toBe(beforeSuppressionA - 10);
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(beforeSuppressionB - 6);

    const restored = await admin.rpc("moderate_point_rewards", {
      p_admin_user_id: aId,
      p_action: "restore",
      p_target_type: "post_root",
      p_target_key: originalPostKey,
      p_reason: "RLS root-chain restored",
      p_case_reference: "E2E-ROOT-1",
    });
    expect(restored.error).toBeNull();
    expect(restored.data).toMatchObject({ affectedEventCount: 4, affectedAmount: 16 });
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points)
      .toBe(beforeSuppressionA);
    expect((await b.from("profiles").select("points").eq("id", bId).single()).data!.points)
      .toBe(beforeSuppressionB);
    const repeatedRestore = await admin.rpc("moderate_point_rewards", {
      p_admin_user_id: aId,
      p_action: "restore",
      p_target_type: "post_root",
      p_target_key: originalPostKey,
      p_reason: "RLS idempotent restore audit",
      p_case_reference: "E2E-ROOT-1-REPLAY",
    });
    expect(repeatedRestore.error).toBeNull();
    expect(repeatedRestore.data).toMatchObject({ affectedEventCount: 0, affectedAmount: 0 });
    expect((await admin.from("point_moderation_actions").select("id").eq("admin_user_id", aId)).data).toHaveLength(3);

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
      { business_key: likeKey, is_active: false, transition_no: 6 },
      { business_key: commentKey, is_active: false, transition_no: 8 },
      { business_key: repostKey, is_active: false, transition_no: 6 },
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
    }).select("id,points_business_key").single();
    expect(restoredOriginal.error).toBeNull();
    expect(restoredOriginal.data!.points_business_key).toBe(originalPostKey);
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points)
      .toBe(aBeforeCascade.data!.points);

    // 原创每日只有前 3 个不同 business key 领奖；超额帖子仍然发布。
    // 本日已有 originalPostKey，因此以下四帖只有两帖加分。
    const beforeCap = (await a.from("profiles").select("points").eq("id", aId).single()).data!.points;
    const capPosts: Array<{ id: string; points_business_key: string; title: string }> = [];
    for (let index = 0; index < 4; index += 1) {
      const inserted = await a.from("posts").insert({
        title: `Daily cap post ${index}`, kind: "experience", tags: ["daily-cap"],
      }).select("id,points_business_key,title").single();
      expect(inserted.error).toBeNull();
      capPosts.push(inserted.data!);
    }
    const afterCap = (await a.from("profiles").select("points").eq("id", aId).single()).data!.points;
    expect(afterCap).toBe(beforeCap + 20);
    const capClaims = await admin.from("point_daily_award_claims")
      .select("business_key,awarded_amount,suppressed_reason,source_id")
      .in("business_key", capPosts.map((item) => item.points_business_key));
    expect(capClaims.error).toBeNull();
    expect(capClaims.data!.filter((claim) => claim.awarded_amount === 10)).toHaveLength(2);
    expect(capClaims.data!.filter((claim) => claim.awarded_amount === 0)).toHaveLength(2);
    const cappedClaim = capClaims.data!.find((claim) => claim.awarded_amount === 0)!;
    const cappedPost = capPosts.find((item) => item.points_business_key === cappedClaim.business_key)!;
    // The authoritative transaction writes the first cap notification even if
    // the client is offline and never performs the optional receipt read.
    expect((await admin.from("notifications").select("id")
      .eq("user_id", aId).eq("type", "points_daily_cap")).data).toHaveLength(1);
    const cappedReceipt = await a.rpc("get_point_reward_receipt", {
      p_event_type: "post_created", p_source_id: cappedPost.id,
    });
    expect(cappedReceipt.error).toBeNull();
    expect(cappedReceipt.data).toMatchObject({
      awardedAmount: 0, dailyUsed: 3, dailyLimit: 3, suppressedReason: "daily_cap",
    });
    expect((await a.rpc("get_point_reward_receipt", {
      p_event_type: "post_created", p_source_id: cappedPost.id,
    })).error).toBeNull();
    expect((await admin.from("notifications").select("id")
      .eq("user_id", aId).eq("type", "points_daily_cap")).data).toHaveLength(1);

    const timezoneBefore = (await a.from("profiles").select("timezone").eq("id", aId).single()).data!.timezone;
    expect((await a.from("profiles").update({ timezone: "Asia/Shanghai" }).eq("id", aId)).error).toBeNull();
    const postAfterTimezoneChange = await a.from("posts").insert({
      title: "Timezone cannot reset cap", kind: "tip", tags: [],
    }).select("id,points_business_key").single();
    expect(postAfterTimezoneChange.error).toBeNull();
    expect((await admin.from("point_daily_award_claims").select("awarded_amount")
      .eq("business_key", postAfterTimezoneChange.data!.points_business_key).single()).data?.awarded_amount).toBe(0);
    expect((await a.from("profiles").update({ timezone: timezoneBefore }).eq("id", aId)).error).toBeNull();

    expect((await a.from("posts").delete().eq("id", cappedPost.id)).error).toBeNull();
    const recreatedCappedPost = await a.from("posts").insert({
      title: cappedPost.title, kind: "experience", tags: ["daily-cap"],
    }).select("id,points_business_key").single();
    expect(recreatedCappedPost.error).toBeNull();
    expect(recreatedCappedPost.data!.points_business_key).toBe(cappedPost.points_business_key);
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points).toBe(afterCap);

    // Eight same-owner interactions are only flagged for review. The scanner
    // does not freeze points or mutate business content.
    const scanTargets = [
      restoredOriginal.data!.id,
      ...capPosts.filter((item) => item.id !== cappedPost.id).map((item) => item.id),
      recreatedCappedPost.data!.id,
      postAfterTimezoneChange.data!.id,
    ];
    for (let index = scanTargets.length; index < 8; index += 1) {
      const extra = await a.from("posts").insert({
        title: `Collaboration scan target ${index}`, kind: "question", tags: ["abuse-scan"],
      }).select("id").single();
      expect(extra.error).toBeNull();
      scanTargets.push(extra.data!.id);
    }
    expect(scanTargets).toHaveLength(8);
    for (const postId of scanTargets) {
      expect((await b.from("post_likes").insert({ post_id: postId })).error).toBeNull();
    }
    const scanResult = await admin.rpc("scan_point_abuse_signals");
    expect(scanResult.error).toBeNull();
    const concentration = await admin.from("point_abuse_signals")
      .select("id,status,account_ids,target_owner_id,metrics")
      .eq("signal_type", "owner_concentration")
      .eq("target_owner_id", aId)
      .contains("account_ids", [bId])
      .single();
    expect(concentration.error).toBeNull();
    expect(concentration.data).toMatchObject({ status: "pending", target_owner_id: aId });
    expect(Number(concentration.data!.metrics.interactionCount)).toBeGreaterThanOrEqual(8);
    const reviewedSignal = await admin.rpc("review_point_abuse_signal", {
      p_reviewer_user_id: aId,
      p_signal_id: concentration.data!.id,
      p_status: "reviewing",
      p_review_note: "RLS workflow review",
      p_case_reference: "E2E-SIGNAL-1",
    });
    expect(reviewedSignal.error).toBeNull();
    expect(reviewedSignal.data).toMatchObject({
      id: concentration.data!.id,
      status: "reviewing",
      reviewer_user_id: aId,
      review_note: "RLS workflow review",
    });

    const [finalLedger, finalProfile] = await Promise.all([
      a.from("point_entries").select("amount"),
      a.from("profiles").select("points").eq("id", aId).single(),
    ]);
    expect(finalLedger.data!.reduce((sum, entry) => sum + entry.amount, 0)).toBe(finalProfile.data!.points);
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
    expect((await b.from("study_goals").insert({
      title: "Cross-owner goal", course_id: course.data!.id,
    })).error).not.toBeNull();
    expect((await admin.from("study_goals").insert({
      user_id: bId, title: "Service cross-owner goal", course_id: course.data!.id,
    })).error).not.toBeNull();

    const tasks = await a.from("study_tasks").insert([
      { title: "Plan task one", course_id: course.data!.id, material_id: material.data!.id, goal_id: goal.data!.id },
      { title: "Plan task two", course_id: course.data!.id },
    ]).select("id,points_business_key");
    expect(tasks.error).toBeNull();
    expect(tasks.data).toHaveLength(2);
    expect((await b.from("study_tasks").select("id").in("id", tasks.data!.map((task) => task.id))).data).toEqual([]);

    const crossOwnerTask = await b.from("study_tasks").insert({ title: "Cross owner", course_id: course.data!.id });
    expect(crossOwnerTask.error).not.toBeNull();
    expect((await admin.from("study_tasks").insert({
      user_id: bId,
      title: "Service cross owner",
      course_id: course.data!.id,
      material_id: material.data!.id,
      goal_id: goal.data!.id,
    })).error).not.toBeNull();
    expect((await a.from("study_goals").update({ user_id: bId }).eq("id", goal.data!.id)).error).not.toBeNull();
    expect((await a.from("study_tasks").update({ user_id: bId }).eq("id", tasks.data![0].id)).error).not.toBeNull();
    const forgedTaskKey = await a.from("study_tasks")
      .update({ points_business_key: `forged:${aId}` })
      .eq("id", tasks.data![0].id);
    expect(forgedTaskKey.error).not.toBeNull();

    const before = await a.from("profiles").select("points,streak").eq("id", aId).single();
    expect((await a.from("study_tasks").update({
      done: true, done_at: "2099-01-01T00:00:00.000Z",
    }).eq("id", tasks.data![0].id)).error).toBeNull();
    const databaseDoneAt = (await a.from("study_tasks").select("done_at").eq("id", tasks.data![0].id).single()).data!.done_at;
    expect(databaseDoneAt).toBeTruthy();
    expect(databaseDoneAt).not.toBe("2099-01-01T00:00:00.000Z");
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

    // Two task claims already received rewards. Completing twelve new tasks in
    // parallel therefore awards only eight and records four permanent zero
    // decisions; all twelve business operations still succeed.
    const beforeTaskCap = (await a.from("profiles").select("points").eq("id", aId).single()).data!.points;
    const capTasks = await a.from("study_tasks").insert(Array.from({ length: 12 }, (_, index) => ({
      title: `Daily task cap ${index}`,
      course_id: course.data!.id,
    }))).select("id,title,points_business_key");
    expect(capTasks.error).toBeNull();
    expect(capTasks.data).toHaveLength(12);
    const completions = await Promise.all(capTasks.data!.map((task) => (
      a.from("study_tasks").update({ done: true }).eq("id", task.id)
    )));
    expect(completions.every((result) => result.error === null)).toBe(true);
    const afterTaskCap = (await a.from("profiles").select("points").eq("id", aId).single()).data!.points;
    expect(afterTaskCap).toBe(beforeTaskCap + 40);
    const taskCapClaims = await admin.from("point_daily_award_claims")
      .select("business_key,awarded_amount,source_id")
      .in("business_key", capTasks.data!.map((task) => task.points_business_key));
    expect(taskCapClaims.error).toBeNull();
    expect(taskCapClaims.data!.filter((claim) => claim.awarded_amount === 5)).toHaveLength(8);
    expect(taskCapClaims.data!.filter((claim) => claim.awarded_amount === 0)).toHaveLength(4);
    const cappedTaskClaim = taskCapClaims.data!.find((claim) => claim.awarded_amount === 0)!;
    const cappedTask = capTasks.data!.find((task) => task.points_business_key === cappedTaskClaim.business_key)!;
    const cappedTaskReceipt = await a.rpc("get_point_reward_receipt", {
      p_event_type: "task_completed", p_source_id: cappedTask.id,
    });
    expect(cappedTaskReceipt.error).toBeNull();
    expect(cappedTaskReceipt.data).toMatchObject({
      awardedAmount: 0, dailyUsed: 10, dailyLimit: 10, suppressedReason: "daily_cap",
    });

    const taskTimezoneBefore = (await a.from("profiles").select("timezone").eq("id", aId).single()).data!.timezone;
    expect((await a.from("profiles").update({ timezone: "Pacific/Auckland" }).eq("id", aId)).error).toBeNull();
    const timezoneTask = await a.from("study_tasks").insert({
      title: "Timezone cannot reset task cap", course_id: course.data!.id,
    }).select("id,points_business_key").single();
    expect(timezoneTask.error).toBeNull();
    expect((await a.from("study_tasks").update({ done: true }).eq("id", timezoneTask.data!.id)).error).toBeNull();
    expect((await admin.from("point_daily_award_claims").select("awarded_amount")
      .eq("business_key", timezoneTask.data!.points_business_key).single()).data?.awarded_amount).toBe(0);
    expect((await a.from("profiles").update({ timezone: taskTimezoneBefore }).eq("id", aId)).error).toBeNull();

    expect((await a.from("study_tasks").delete().eq("id", cappedTask.id)).error).toBeNull();
    const recreatedCappedTask = await a.from("study_tasks").insert({
      title: cappedTask.title, course_id: course.data!.id,
    }).select("id,points_business_key").single();
    expect(recreatedCappedTask.error).toBeNull();
    expect(recreatedCappedTask.data!.points_business_key).toBe(cappedTask.points_business_key);
    expect((await a.from("study_tasks").update({ done: true }).eq("id", recreatedCappedTask.data!.id)).error).toBeNull();
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points).toBe(afterTaskCap);

    const [allEntries, projectedProfile] = await Promise.all([
      a.from("point_entries").select("amount"),
      a.from("profiles").select("points").eq("id", aId).single(),
    ]);
    expect(allEntries.error).toBeNull();
    expect(allEntries.data!.reduce((sum, entry) => sum + entry.amount, 0)).toBe(projectedProfile.data!.points);
  }, 60_000);

  it("验证 Materials AI 额度、任务幂等、私有结果和考试 revision", async () => {
    const rpc = async <T = any>(name: string, args: Record<string, unknown>) => {
      const result = await admin.rpc(name, args);
      expect(result.error, `${name}: ${result.error?.message || "unknown"}`).toBeNull();
      return result.data as T;
    };
    const settings = {
      language: "en", difficulty: "mixed", durationMinutes: 60, totalMarks: 20,
      questionCounts: {
        singleChoice: 5, multipleChoice: 0, trueFalse: 0,
        fillBlank: 0, shortAnswer: 0, essay: 0,
      },
      answerDetail: "detailed", focus: "",
    };
    const course = await a.from("courses").insert({ code: "AI 101", name: "Materials AI RLS" }).select("id").single();
    expect(course.error).toBeNull();
    const material = await a.from("materials").insert({
      course_id: course.data!.id,
      name: "ai-security-fixture.txt",
      type: "txt",
      size_bytes: 128,
      storage_path: `${aId}/ai-security-fixture.txt`,
    }).select("id").single();
    expect(material.error).toBeNull();

    // Every existing and future user is assigned Free 10/10. Only the API's
    // service-role RPC can materialize daily usage and reserve allowance.
    expect((await a.from("ai_user_plans").select("plan_code,consent_version").eq("user_id", aId).single()).data)
      .toEqual({ plan_code: "free", consent_version: 0 });
    expect((await b.from("ai_user_plans").select("user_id").eq("user_id", aId)).data).toEqual([]);
    expect((await a.rpc("ai_get_quota_summary", { p_user_id: aId })).error).not.toBeNull();
    const initialQuota = await rpc<any>("ai_get_quota_summary", { p_user_id: aId });
    expect(initialQuota).toMatchObject({
      plan: "free",
      generation: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
      grading: { limit: 10, consumed: 0, reserved: 0, remaining: 10 },
    });

    for (const [table, payload] of [
      ["generation_jobs", { user_id: aId, material_id: material.data!.id, material_name: "forged", settings }],
      ["ai_daily_usage", { user_id: aId, local_date: initialQuota.localDate, kind: "generation", plan_code: "free", limit_count: 999, timezone: "UTC" }],
      ["ai_material_parse_cache", { user_id: aId, material_id: material.data!.id, source_sha256: "a".repeat(64), parser_version: "forged", audit_version: "forged", vision_model: "forged", canonical_document: {}, block_count: 0 }],
      ["notes", { user_id: aId, title: "forged", material_name: "forged" }],
      ["exam_attempts", { user_id: aId, note_id: randomUUID(), deadline_at: new Date().toISOString(), total_marks: 100 }],
      ["ai_provider_usage_events", { user_id: aId, job_id: randomUUID(), purpose: "exam_generation", model: "forged", duration_ms: 0, zdr_enforced: false, status: "succeeded" }],
    ] as const) {
      expect((await a.from(table).insert(payload as any)).error, `${table} must be service-only`).not.toBeNull();
    }
    expect((await a.from("ai_material_parse_cache").select("id").limit(1)).error).not.toBeNull();
    expect((await a.from("ai_provider_usage_events").select("id").limit(1)).error).not.toBeNull();
    expect((await a.from("exam_attempt_operations").select("operation_id").limit(1)).error).not.toBeNull();
    expect((await a.rpc("ai_create_generation_job", {
      p_user_id: aId, p_material_id: material.data!.id, p_idempotency_key: randomUUID(),
      p_request_fingerprint: "1".repeat(64), p_settings: settings, p_consent_version: 1,
    })).error).not.toBeNull();

    const idempotencyKey = randomUUID();
    const createArgs = {
      p_user_id: aId,
      p_material_id: material.data!.id,
      p_idempotency_key: idempotencyKey,
      p_request_fingerprint: "2".repeat(64),
      p_settings: settings,
      p_consent_version: 1,
    };
    const concurrentCreates = await Promise.all([
      admin.rpc("ai_create_generation_job", createArgs),
      admin.rpc("ai_create_generation_job", createArgs),
    ]);
    expect(concurrentCreates.map((result) => result.error)).toEqual([null, null]);
    const jobIds = concurrentCreates.map((result) => result.data![0].id);
    expect(new Set(jobIds).size).toBe(1);
    const firstJobId = jobIds[0];
    expect((await a.from("generation_jobs").select("id,status").eq("id", firstJobId)).data)
      .toEqual([{ id: firstJobId, status: "queued" }]);
    expect((await b.from("generation_jobs").select("id").eq("id", firstJobId)).data).toEqual([]);
    expect((await rpc<any>("ai_get_quota_summary", { p_user_id: aId })).generation)
      .toMatchObject({ consumed: 0, reserved: 1, remaining: 9 });
    const activeConflict = await admin.rpc("ai_create_generation_job", {
      ...createArgs, p_idempotency_key: randomUUID(), p_request_fingerprint: "3".repeat(64),
    });
    expect(activeConflict.error?.message).toContain("AI_JOB_ACTIVE");

    await rpc("ai_fail_generation_job", {
      p_job_id: firstJobId, p_lease_token: null, p_error_code: "SAFE_TEST_FAILURE",
      p_error_message: "Fixture failure", p_usage_events: [],
    });
    expect((await rpc<any>("ai_get_quota_summary", { p_user_id: aId })).generation)
      .toMatchObject({ consumed: 0, reserved: 0, remaining: 10 });

    const completedJobRows = await rpc<any[]>("ai_create_generation_job", {
      ...createArgs, p_idempotency_key: randomUUID(), p_request_fingerprint: "4".repeat(64),
    });
    const completedJobId = completedJobRows[0].id;
    const generationLease = randomUUID();
    expect((await rpc<any[]>("ai_claim_generation_job", {
      p_job_id: completedJobId, p_lease_token: generationLease, p_lease_seconds: 900,
    }))[0]).toMatchObject({ id: completedJobId, status: "processing" });
    const exam = {
      schemaVersion: "generated-exam.v1",
      title: "AI Security Fixture Exam",
      language: "en",
      difficulty: "mixed",
      durationMinutes: 60,
      totalMarks: 20,
      instructions: [],
      sections: [{
        id: "section-1", title: "Objective", instructions: "",
        questions: [{
          id: "q1", type: "single_choice", prompt: "Choose A.", marks: 20,
          options: ["A", "B"], correctOptionIndexes: [0], acceptedAnswers: [],
          modelAnswer: "A", explanation: "A is correct.", rubric: [],
          sourceRefs: [{ blockId: "block-1", page: 1, slide: null, label: "Page 1" }],
        }],
      }],
    };
    const document = {
      version: "document-ir.v1", title: "Fixture", sourceType: "txt", pageCount: 1,
      slideCount: 0,
      blocks: [{ id: "block-1", order: 1, kind: "paragraph", text: "A is correct.", page: 1, slide: null, label: "Page 1", source: "parser" }],
      diagnostics: [],
    };
    const noteId = await rpc<string>("ai_complete_generation_job", {
      p_job_id: completedJobId,
      p_lease_token: generationLease,
      p_source_sha256: "5".repeat(64),
      p_parser_version: "parser-v1",
      p_audit_version: "audit-v1",
      p_canonical_document: document,
      p_block_count: 1,
      p_visual_region_count: 0,
      p_title: exam.title,
      p_exam: exam,
      p_question_count: 1,
      p_total_marks: 20,
      p_usage_events: [],
    });
    expect((await rpc<any>("ai_get_quota_summary", { p_user_id: aId })).generation)
      .toMatchObject({ consumed: 1, reserved: 0, remaining: 9 });
    expect((await a.from("notes").select("id,course_id").eq("id", noteId)).data)
      .toEqual([{ id: noteId, course_id: course.data!.id }]);
    expect((await b.from("notes").select("id").eq("id", noteId)).data).toEqual([]);
    expect((await b.from("note_artifacts").select("note_id").eq("note_id", noteId)).data).toEqual([]);

    const firstAttempt = (await rpc<any[]>("ai_create_exam_attempt", {
      p_user_id: aId, p_note_id: noteId,
    }))[0];
    expect((await b.from("exam_attempts").select("id").eq("id", firstAttempt.id)).data).toEqual([]);
    expect((await a.from("exam_attempts").update({ total_score: 20, status: "completed" }).eq("id", firstAttempt.id)).error)
      .not.toBeNull();
    expect((await a.rpc("ai_save_exam_answers", {
      p_user_id: aId, p_attempt_id: firstAttempt.id, p_operation_id: randomUUID(),
      p_expected_revision: 0, p_answers: [{ questionId: "q1", value: 0 }],
    })).error).not.toBeNull();
    const saveOperation = randomUUID();
    const saveArgs = {
      p_user_id: aId, p_attempt_id: firstAttempt.id, p_operation_id: saveOperation,
      p_expected_revision: 0, p_answers: [{ questionId: "q1", value: 0 }],
    };
    const concurrentSaves = await Promise.all([
      admin.rpc("ai_save_exam_answers", saveArgs),
      admin.rpc("ai_save_exam_answers", saveArgs),
    ]);
    expect(concurrentSaves.map((result) => result.error)).toEqual([null, null]);
    expect(concurrentSaves.map((result) => result.data.revision)).toEqual([1, 1]);
    expect((await admin.from("exam_attempt_answers").select("question_id")
      .eq("attempt_id", firstAttempt.id)).data).toEqual([{ question_id: "q1" }]);
    expect((await admin.from("exam_attempt_operations").select("operation_id")
      .eq("attempt_id", firstAttempt.id).eq("operation_id", saveOperation)).data).toHaveLength(1);
    const submitResult = await rpc<any>("ai_submit_exam_attempt", {
      p_user_id: aId, p_attempt_id: firstAttempt.id, p_operation_id: randomUUID(),
      p_expected_revision: 1,
      p_results: [{ questionId: "q1", awardedMarks: 20, correct: true, feedback: "Correct" }],
      p_objective_score: 20, p_objective_marks: 20, p_needs_grading: false,
    });
    expect(submitResult).toMatchObject({ revision: 2, status: "completed", gradingReserved: false });

    const gradingAttempt = (await rpc<any[]>("ai_create_exam_attempt", {
      p_user_id: aId, p_note_id: noteId,
    }))[0];
    const gradingSubmit = await rpc<any>("ai_submit_exam_attempt", {
      p_user_id: aId, p_attempt_id: gradingAttempt.id, p_operation_id: randomUUID(),
      p_expected_revision: 0, p_results: [], p_objective_score: 0,
      p_objective_marks: 0, p_needs_grading: true,
    });
    expect(gradingSubmit).toMatchObject({ status: "grading", gradingReserved: true });
    expect((await rpc<any>("ai_get_quota_summary", { p_user_id: aId })).grading)
      .toMatchObject({ consumed: 0, reserved: 1, remaining: 9 });
    const gradingLease = randomUUID();
    expect((await rpc<any[]>("ai_claim_exam_grading", {
      p_attempt_id: gradingAttempt.id, p_lease_token: gradingLease, p_lease_seconds: 300,
    }))[0]).toMatchObject({ id: gradingAttempt.id, status: "grading" });
    const gradingUsage = {
      purpose: "exam_grading", model: "deepseek/deepseek-v4-flash-0731",
      requestId: "rls-delete-audit", promptTokens: 10, completionTokens: 5,
      totalTokens: 15, costMicroUsd: 7, durationMs: 12,
      zdrEnforced: true, status: "failed", errorCode: "SAFE_TEST_FAILURE",
    };
    await rpc("ai_fail_exam_grading", {
      p_attempt_id: gradingAttempt.id, p_lease_token: gradingLease, p_usage_events: [gradingUsage],
    });
    expect((await admin.from("exam_attempts").select("status,grading_quota_reserved")
      .eq("id", gradingAttempt.id).single()).data)
      .toEqual({ status: "submitted_ungraded", grading_quota_reserved: false });
    expect((await rpc<any>("ai_get_quota_summary", { p_user_id: aId })).grading)
      .toMatchObject({ consumed: 0, reserved: 0, remaining: 10 });

    // AI exams are feedback only and never write the points or badge systems.
    expect((await admin.from("point_entries").select("id").in("source_id", [completedJobId, firstAttempt.id, gradingAttempt.id])).data)
      .toEqual([]);
    expect((await admin.from("user_badge_awards").select("badge_code").eq("user_id", aId)
      .ilike("badge_code", "%exam%")).data).toEqual([]);

    // Deleting a source through the service transaction releases a queued
    // reservation, removes parse cache, and preserves results as Unfiled.
    const pendingJob = (await rpc<any[]>("ai_create_generation_job", {
      ...createArgs, p_idempotency_key: randomUUID(), p_request_fingerprint: "6".repeat(64),
    }))[0];
    expect((await a.from("materials").delete().eq("id", material.data!.id)).error).not.toBeNull();
    expect(await rpc<string>("ai_delete_material", {
      p_user_id: aId, p_material_id: material.data!.id, p_delete_results: false,
    })).toBe(`${aId}/ai-security-fixture.txt`);
    expect((await admin.from("generation_jobs").select("status,quota_reserved")
      .eq("id", pendingJob.id).single()).data).toEqual({ status: "cancelled", quota_reserved: false });
    expect((await admin.from("ai_material_parse_cache").select("id").eq("material_id", material.data!.id)).data).toEqual([]);
    expect((await a.from("note_materials").select("material_id").eq("note_id", noteId)).data)
      .toEqual([{ material_id: null }]);
    expect((await a.from("notes").select("course_id").eq("id", noteId).single()).data)
      .toEqual({ course_id: null });
    expect((await rpc<any>("ai_get_quota_summary", { p_user_id: aId })).generation)
      .toMatchObject({ consumed: 1, reserved: 0, remaining: 9 });

    // Provider cost events are immutable budget/audit facts. Deleting the
    // generated Note must remove its attempts without nulling or deleting the
    // historical attempt UUID (which previously rolled the transaction back).
    expect((await admin.from("ai_provider_usage_events").select("attempt_id,cost_micro_usd")
      .eq("attempt_id", gradingAttempt.id).single()).data)
      .toEqual({ attempt_id: gradingAttempt.id, cost_micro_usd: 7 });
    await rpc("ai_delete_note", { p_user_id: aId, p_note_id: noteId });
    expect((await admin.from("exam_attempts").select("id").eq("note_id", noteId)).data).toEqual([]);
    expect((await admin.from("ai_provider_usage_events").select("attempt_id,cost_micro_usd")
      .eq("attempt_id", gradingAttempt.id).single()).data)
      .toEqual({ attempt_id: gradingAttempt.id, cost_micro_usd: 7 });
    expect((await rpc<string[]>("ai_delete_material_course", {
      p_user_id: aId, p_course_id: course.data!.id, p_delete_results: true,
    }))).toEqual([]);
  }, 60_000);

  it("验证学习课程隔离、候补池、跨日熟练、复习日程、徽章和 +20 指纹幂等", async () => {
    const courseId = randomUUID();
    const unitId = randomUUID();
    const terms = Array.from({ length: 20 }, (_, index) => ({
      id: randomUUID(), term: `word-${String(index + 1).padStart(2, "0")}`, translations: [`翻译${index + 1}`], ipa: null,
    }));
    const payload = {
      id: courseId, title: "RLS Vocabulary", category: "english_vocabulary", hasUnits: false, locale: "en-US",
      units: [{ id: unitId, name: "默认单元", isSystem: true, words: terms }],
    };
    const rpc = async <T = any>(name: string, args: Record<string, unknown>) => {
      const result = await admin.rpc(name, args);
      expect(result.error, `${name}: ${result.error?.message || "unknown"}`).toBeNull();
      return result.data as T;
    };
    const startReview = (targetCourseId: string, targetUnitId: string, skills: string[], scheduleId: string | null = null) => rpc<string>("learning_start_session", {
      p_user_id: aId, p_course_id: targetCourseId, p_unit_id: targetUnitId, p_mode: "review",
      p_skills: skills, p_scope: "all", p_schedule_id: scheduleId,
    });
    const answer = (sessionId: string, word: { id: string; term: string; translations: string[] }, skill: string, correct = true) => rpc("learning_record_attempt", {
      p_user_id: aId, p_session_id: sessionId, p_word_id: word.id, p_skill: skill,
      p_answer: skill === "pronunciation" ? { wordId: correct ? word.id : terms.find((entry) => entry.id !== word.id)!.id }
        : skill === "translation" ? { translations: correct ? word.translations : ["错误"] }
          : { text: correct ? word.term : "wrong" },
    });
    const finishReview = async (sessionId: string, words: typeof terms, skills: string[], firstWrong = false) => {
      for (const skill of skills) {
        if (skill === "pronunciation" && firstWrong) {
          await answer(sessionId, words[0], skill, false);
          for (const word of words.slice(1)) await answer(sessionId, word, skill);
          const queued = await admin.from("learning_sessions").select("state,stage").eq("id", sessionId).single();
          expect(queued.error).toBeNull(); expect(queued.data!.stage).toBe("pronunciation");
          expect(queued.data!.state).toMatchObject({ queue: [words[0].id], cursor: 0, nextQueue: [], round: 2 });
          await answer(sessionId, words[0], skill);
        } else {
          for (const word of words) await answer(sessionId, word, skill);
        }
      }
      const completed = await admin.from("learning_sessions").select("stage,active,completed_at").eq("id", sessionId).single();
      expect(completed.data).toMatchObject({ stage: "completed", active: false });
      expect(completed.data!.completed_at).toBeTruthy();
    };

    expect(await rpc<string>("learning_upsert_course", { p_user_id: aId, p_payload: payload })).toBe(courseId);
    expect((await a.from("learning_courses").select("id,title").eq("id", courseId)).data).toEqual([{ id: courseId, title: "RLS Vocabulary" }]);
    expect((await b.from("learning_courses").select("id").eq("id", courseId)).data).toEqual([]);
    expect((await b.from("learning_course_words").select("id").eq("course_id", courseId)).data).toEqual([]);

    // Every mutation and transactional helper remains server-only.
    expect((await a.from("learning_courses").insert({ title: "forged", category: "english_vocabulary" })).error).not.toBeNull();
    expect((await a.from("learning_word_progress").update({ learned_at: new Date().toISOString() }).eq("user_id", aId)).error).not.toBeNull();
    expect((await a.from("user_badge_awards").insert({ user_id: aId, badge_code: "vocab_words_gold" })).error).not.toBeNull();
    expect((await a.from("learning_speech_usage").select("id").limit(1)).error).not.toBeNull();
    expect((await a.from("learning_audio_assets").select("cache_key").limit(1)).error).not.toBeNull();
    expect((await a.from("learning_spelling_translation_assessments").select("assessment_id").limit(1)).error).not.toBeNull();
    expect((await a.rpc("learning_upsert_course", { p_user_id: aId, p_payload: payload })).error).not.toBeNull();
    expect((await a.rpc("learning_record_attempt", { p_user_id: aId, p_session_id: randomUUID(), p_word_id: terms[0].id, p_skill: "spelling", p_answer: { text: terms[0].term } })).error).not.toBeNull();
    expect((await a.rpc("learning_record_attempt", {
      p_user_id: aId, p_session_id: randomUUID(), p_word_id: terms[0].id,
      p_skill: "spelling", p_answer: { text: terms[0].term },
      p_attempt_id: randomUUID(), p_expected_revision: 0,
    })).error).not.toBeNull();
    expect((await a.rpc("_learning_normalize_spelling_text", {
      p_value: "WORD-01",
    })).error).not.toBeNull();
    expect((await a.rpc("_learning_spelling_without_punctuation", {
      p_value: "WORD-01", p_punctuation_as_space: false,
    })).error).not.toBeNull();
    expect((await a.rpc("_learning_spelling_text_matches", {
      p_answer: "WORD 01", p_expected: "word-01",
    })).error).not.toBeNull();
    expect((await a.rpc("learning_get_session_snapshot", {
      p_user_id: aId, p_session_id: randomUUID(),
    })).error).not.toBeNull();
    expect((await a.rpc("learning_cancel_session", {
      p_user_id: aId, p_session_id: randomUUID(),
    })).error).not.toBeNull();
    expect((await a.rpc("learning_start_session", {
      p_user_id: aId, p_course_id: courseId, p_unit_id: unitId, p_mode: "review",
      p_skills: ["spelling"], p_scope: "all", p_schedule_id: null,
      p_spelling_options: { timeLimitEnabled: true, timeLimitSeconds: 10, translationFirst: true },
    })).error).not.toBeNull();
    expect((await a.rpc("learning_claim_spelling_translation_assessment", {
      p_user_id: aId, p_session_id: randomUUID(), p_word_id: terms[0].id,
      p_assessment_id: randomUUID(), p_expected_revision: 0,
      p_answer_hash: "a".repeat(64), p_lease_token: randomUUID(),
      p_lease_seconds: 30, p_minute_limit: 20, p_day_limit: 200,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_claim_spelling_translation_assessment_v2", {
      p_user_id: aId, p_session_id: randomUUID(), p_word_id: terms[0].id,
      p_assessment_id: randomUUID(), p_expected_revision: 0,
      p_answer_hash: "a".repeat(64), p_lease_token: randomUUID(),
      p_lease_seconds: 30,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_reserve_spelling_translation_quota", {
      p_user_id: aId, p_assessment_id: randomUUID(), p_lease_token: randomUUID(),
      p_minute_limit: 20, p_day_limit: 500,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_reserve_translation_stt", {
      p_user_id: aId, p_session_id: randomUUID(), p_word_id: terms[0].id,
      p_expected_revision: 0, p_cost_microusd: 10,
      p_minute_limit: 20, p_day_limit: 300,
      p_month_budget_microusd: 5_000_000,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_start_exam_session", {
      p_user_id: aId, p_course_id: courseId, p_unit_id: unitId,
      p_spelling_options: { timeLimitEnabled: false, timeLimitSeconds: 20, translationFirst: true },
      p_pass_percent: 90,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_start_exam_session", {
      p_user_id: aId, p_course_id: courseId, p_unit_id: unitId,
      p_spelling_options: { timeLimitEnabled: false, timeLimitSeconds: 20, translationFirst: false },
      p_pass_percent: 90, p_exam_kind: "pronunciation",
    })).error).not.toBeNull();
    expect((await a.rpc("learning_continue_spelling_retry_round", {
      p_user_id: aId, p_session_id: randomUUID(),
    })).error).not.toBeNull();
    expect((await a.rpc("learning_continue_exam_retry_round", {
      p_user_id: aId, p_session_id: randomUUID(),
    })).error).not.toBeNull();
    expect((await a.rpc("learning_start_selected_review_session", {
      p_user_id: aId, p_course_id: courseId, p_unit_id: unitId,
      p_skills: ["spelling"], p_scope: "all", p_schedule_id: null,
      p_spelling_options: { timeLimitEnabled: false, timeLimitSeconds: 20, translationFirst: false },
      p_word_ids: [terms[0].id],
    })).error).not.toBeNull();
    expect((await a.rpc("learning_start_selected_exam_session", {
      p_user_id: aId, p_course_id: courseId, p_unit_id: unitId,
      p_spelling_options: { timeLimitEnabled: false, timeLimitSeconds: 20, translationFirst: true },
      p_pass_percent: 90, p_exam_kind: "spelling", p_word_ids: [terms[0].id],
    })).error).not.toBeNull();
    expect((await a.rpc("learning_list_exam_history", {
      p_user_id: aId, p_course_id: courseId,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_get_exam_history_detail", {
      p_user_id: aId, p_session_id: randomUUID(),
    })).error).not.toBeNull();
    expect((await a.from("learning_exam_word_snapshots").select("*")).error).not.toBeNull();
    expect((await a.rpc("learning_record_spelling_attempt", {
      p_user_id: aId, p_session_id: randomUUID(), p_word_id: terms[0].id,
      p_answer: { text: terms[0].term }, p_attempt_id: randomUUID(),
      p_expected_revision: 0,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_complete_spelling_translation_assessment", {
      p_user_id: aId, p_session_id: randomUUID(), p_word_id: terms[0].id,
      p_assessment_id: randomUUID(), p_expected_revision: 0,
      p_answer_hash: "a".repeat(64), p_lease_token: randomUUID(),
      p_correct: true, p_feedback: "forged", p_provider: "forged",
      p_model: "forged", p_usage: {},
    })).error).not.toBeNull();
    expect((await a.rpc("learning_release_spelling_translation_assessment", {
      p_user_id: aId, p_assessment_id: randomUUID(),
      p_lease_token: randomUUID(), p_error_code: "forged",
    })).error).not.toBeNull();
    expect((await a.rpc("learning_prepare_unit_audio", {
      p_user_id: aId, p_unit_id: unitId, p_locale: "en-US",
      p_voice: "en-US-JennyNeural",
      p_output_format: "audio-24khz-48kbitrate-mono-mp3",
      p_synthesis_version: "1", p_priority: 50,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_prepare_word_audio", {
      p_user_id: aId, p_word_id: terms[0].id, p_locale: "en-US",
      p_voice: "en-US-JennyNeural",
      p_output_format: "audio-24khz-48kbitrate-mono-mp3",
      p_synthesis_version: "1", p_priority: 100,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_claim_audio_asset", {
      p_lease_token: randomUUID(), p_lease_seconds: 60,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_finish_audio_asset", {
      p_lease_token: randomUUID(), p_cache_key: "a".repeat(64),
      p_success: false, p_error_code: "forged", p_error_message: "forged",
      p_retry_after_seconds: 60,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_reserve_tts_quota", {
      p_character_count: 1, p_cost_microusd: 1, p_minute_limit: 20,
      p_month_character_limit: 500_000, p_month_budget_microusd: 5_000_000,
    })).error).not.toBeNull();
    expect((await a.rpc("learning_record_speech_assessment", { p_user_id: aId, p_session_id: randomUUID(), p_word_id: terms[0].id,
      p_assessment: { accuracyScore: 100, pronunciationScore: 100, passThreshold: 70 } })).error).not.toBeNull();
    expect((await a.rpc("learning_profile_summary", { p_user_id: aId })).error).not.toBeNull();
    expect((await a.rpc("learning_publish_course", { p_user_id: aId, p_course_id: courseId, p_description: "forged",
      p_author_name: aName, p_rights_declared: true, p_daily_limit: 5 })).error).not.toBeNull();

    const validTimezone = await a.from("profiles").update({ timezone: "Pacific/Kiritimati" }).eq("id", aId);
    expect(validTimezone.error).toBeNull();
    expect((await a.from("profiles").update({ timezone: "Not/A_Timezone" }).eq("id", aId)).error).not.toBeNull();

    const concurrentStartArgs = { p_user_id: aId, p_course_id: courseId, p_unit_id: unitId, p_mode: "review",
      p_skills: ["spelling"], p_scope: "all", p_schedule_id: null };
    const concurrentStarts = await Promise.all([
      admin.rpc("learning_start_session", concurrentStartArgs),
      admin.rpc("learning_start_session", concurrentStartArgs),
    ]);
    expect(concurrentStarts.every((result) => result.error == null)).toBe(true);
    expect(concurrentStarts[0].data).toBe(concurrentStarts[1].data);
    expect((await admin.from("learning_sessions").delete().eq("id", concurrentStarts[0].data)).error).toBeNull();

    // A paused first-learning session must not hijack an explicit review of a
    // different unit. Each exact intent remains resumable, while reordered
    // review skills still resolve to the same normalized review session.
    const parallelCourseId = randomUUID();
    const initialUnitId = randomUUID();
    const reviewUnitId = randomUUID();
    const parallelPayload = {
      id: parallelCourseId,
      title: "Parallel learning and review",
      category: "english_vocabulary",
      hasUnits: true,
      locale: "en-US",
      units: [
        {
          id: initialUnitId,
          name: "Initial unit",
          isSystem: false,
          words: ["alpha", "bravo", "charlie", "delta"].map((term) => ({
            id: randomUUID(), term, translations: [term], ipa: null,
          })),
        },
        {
          id: reviewUnitId,
          name: "Review unit",
          isSystem: false,
          words: ["echo", "foxtrot", "golf", "hotel"].map((term) => ({
            id: randomUUID(), term, translations: [term], ipa: null,
          })),
        },
      ],
    };
    await rpc("learning_upsert_course", {
      p_user_id: aId,
      p_payload: parallelPayload,
    });
    const initialSession = await rpc<string>("learning_start_session", {
      p_user_id: aId,
      p_course_id: parallelCourseId,
      p_unit_id: initialUnitId,
      p_mode: "initial",
      p_skills: ["pronunciation", "translation", "spelling"],
      p_scope: "all",
      p_schedule_id: null,
    });
    const reviewSession = await rpc<string>("learning_start_session", {
      p_user_id: aId,
      p_course_id: parallelCourseId,
      p_unit_id: reviewUnitId,
      p_mode: "review",
      p_skills: ["translation", "pronunciation"],
      p_scope: "all",
      p_schedule_id: null,
    });
    expect(reviewSession).not.toBe(initialSession);
    expect(await rpc<string>("learning_start_session", {
      p_user_id: aId,
      p_course_id: parallelCourseId,
      p_unit_id: initialUnitId,
      p_mode: "initial",
      p_skills: ["pronunciation", "translation", "spelling"],
      p_scope: "all",
      p_schedule_id: null,
    })).toBe(initialSession);
    expect(await rpc<string>("learning_start_session", {
      p_user_id: aId,
      p_course_id: parallelCourseId,
      p_unit_id: reviewUnitId,
      p_mode: "review",
      p_skills: ["pronunciation", "translation"],
      p_scope: "all",
      p_schedule_id: null,
    })).toBe(reviewSession);
    const parallelSessions = await admin.from("learning_sessions")
      .select("id,unit_id,mode,active,resume_key")
      .eq("course_id", parallelCourseId)
      .eq("active", true)
      .order("mode");
    expect(parallelSessions.error).toBeNull();
    expect(parallelSessions.data).toHaveLength(2);
    expect(parallelSessions.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: initialSession,
        unit_id: initialUnitId,
        mode: "initial",
        active: true,
      }),
      expect.objectContaining({
        id: reviewSession,
        unit_id: reviewUnitId,
        mode: "review",
        active: true,
      }),
    ]));
    const foreignCancellation = await admin.rpc("learning_cancel_session", {
      p_user_id: bId,
      p_session_id: initialSession,
    });
    expect(foreignCancellation.error).not.toBeNull();
    const cancelled = await rpc<any>("learning_cancel_session", {
      p_user_id: aId,
      p_session_id: initialSession,
    });
    expect(cancelled).toMatchObject({
      session_id: initialSession,
      active: false,
      revision: 1,
      cancelled: true,
    });
    expect(await rpc<any>("learning_cancel_session", {
      p_user_id: aId,
      p_session_id: initialSession,
    })).toMatchObject({
      session_id: initialSession,
      active: false,
      revision: 1,
      cancelled: false,
    });
    const restartedInitialSession = await rpc<string>("learning_start_session", {
      p_user_id: aId,
      p_course_id: parallelCourseId,
      p_unit_id: initialUnitId,
      p_mode: "initial",
      p_skills: ["pronunciation", "translation", "spelling"],
      p_scope: "all",
      p_schedule_id: null,
    });
    expect(restartedInitialSession).not.toBe(initialSession);
    await rpc("learning_delete_course", {
      p_user_id: aId,
      p_course_id: parallelCourseId,
    });

    // The retained v1 signature remains usable by an immutable application
    // rollback and still advances the shared revision clock.
    const rollbackSession = await startReview(courseId, unitId, ["spelling"]);
    await answer(rollbackSession, terms[0], "spelling");
    expect((await admin.from("learning_sessions").select("revision")
      .eq("id", rollbackSession).single()).data).toEqual({ revision: 1 });
    expect((await admin.from("learning_sessions").delete().eq("id", rollbackSession)).error).toBeNull();

    // Current spelling attempts use one deterministic normalization contract
    // in Web and PostgreSQL. Case, compatibility characters, and
    // punctuation-only differences are accepted without hiding letter or
    // word-boundary errors.
    const normalizedSpellingSession = await startReview(courseId, unitId, ["spelling"]);
    const fullWidthUppercase = await rpc<any>("learning_record_spelling_attempt", {
      p_user_id: aId,
      p_session_id: normalizedSpellingSession,
      p_word_id: terms[0].id,
      p_answer: { text: "ＷＯＲＤ ０１" },
      p_attempt_id: randomUUID(),
      p_expected_revision: 0,
    });
    expect(fullWidthUppercase).toMatchObject({ correct: true, revision: 1 });
    const asciiUppercase = await rpc<any>("learning_record_spelling_attempt", {
      p_user_id: aId,
      p_session_id: normalizedSpellingSession,
      p_word_id: terms[1].id,
      p_answer: { text: "WORD02!" },
      p_attempt_id: randomUUID(),
      p_expected_revision: 1,
    });
    expect(asciiUppercase).toMatchObject({ correct: true, revision: 2 });
    expect((await admin.from("learning_session_items").select("word_id,wrong_count")
      .eq("session_id", normalizedSpellingSession)
      .in("word_id", [terms[0].id, terms[1].id])
      .order("position")).data).toEqual([
      { word_id: terms[0].id, wrong_count: 0 },
      { word_id: terms[1].id, wrong_count: 0 },
    ]);
    expect((await admin.from("learning_sessions").select("state")
      .eq("id", normalizedSpellingSession).single()).data?.state)
      .toMatchObject({ cursor: 2, nextQueue: [] });
    expect((await admin.from("learning_sessions").delete()
      .eq("id", normalizedSpellingSession)).error).toBeNull();

    // The v2 attempt path is idempotent even when the same request races on
    // two API instances. A stale revision returns a conflict payload without
    // adding another attempt or error.
    const idempotentSession = await startReview(courseId, unitId, ["spelling"]);
    const idempotentSnapshot = await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId, p_session_id: idempotentSession,
    });
    expect(idempotentSnapshot).toMatchObject({
      id: idempotentSession, revision: 0, stage: "spelling",
    });
    expect(idempotentSnapshot.items).toHaveLength(20);
    const clientAttemptId = randomUUID();
    const idempotentArgs = {
      p_user_id: aId,
      p_session_id: idempotentSession,
      p_word_id: terms[0].id,
      p_skill: "spelling",
      p_answer: { text: "wrong" },
      p_attempt_id: clientAttemptId,
      p_expected_revision: 0,
    };
    const duplicateResults = await Promise.all([
      admin.rpc("learning_record_attempt", idempotentArgs),
      admin.rpc("learning_record_attempt", idempotentArgs),
    ]);
    expect(duplicateResults.map((result) => result.error)).toEqual([null, null]);
    expect(duplicateResults.map((result) => result.data.correct)).toEqual([false, false]);
    expect(duplicateResults.map((result) => result.data.replayed).sort()).toEqual([false, true]);
    expect((await admin.from("learning_attempts").select("id").eq("attempt_id", clientAttemptId)).data).toHaveLength(1);
    expect((await admin.from("learning_session_items").select("wrong_count")
      .eq("session_id", idempotentSession).eq("word_id", terms[0].id).single()).data)
      .toEqual({ wrong_count: 1 });
    expect((await admin.from("learning_sessions").select("revision")
      .eq("id", idempotentSession).single()).data).toEqual({ revision: 1 });
    const conflict = await rpc<any>("learning_record_attempt", {
      ...idempotentArgs,
      p_attempt_id: randomUUID(),
      p_word_id: terms[1].id,
    });
    expect(conflict).toEqual({ conflict: true, current_revision: 1 });
    expect((await admin.from("learning_attempts").select("id")
      .eq("session_id", idempotentSession)).data).toHaveLength(1);
    expect((await admin.from("learning_sessions").delete().eq("id", idempotentSession)).error).toBeNull();

    // Timed/translation-first spelling settings survive snapshots. Translation
    // decisions are idempotent, store no raw typed answer, and only the
    // service-role wrapper may turn them into authoritative attempts.
    const semanticSession = await rpc<string>("learning_start_session", {
      p_user_id: aId,
      p_course_id: courseId,
      p_unit_id: unitId,
      p_mode: "review",
      p_skills: ["spelling"],
      p_scope: "all",
      p_schedule_id: null,
      p_spelling_options: {
        timeLimitEnabled: true,
        timeLimitSeconds: 11,
        translationFirst: true,
      },
    });
    const semanticSnapshot = await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId,
      p_session_id: semanticSession,
    });
    expect(semanticSnapshot).toMatchObject({
      revision: 0,
      stage: "spelling",
      spelling_options: {
        timeLimitEnabled: true,
        timeLimitSeconds: 11,
        translationFirst: true,
      },
      spelling_translation_assessment: null,
    });

    const sttReservation = await rpc<any>("learning_reserve_translation_stt", {
      p_user_id: aId,
      p_session_id: semanticSession,
      p_word_id: terms[0].id,
      p_expected_revision: 0,
      p_cost_microusd: 10,
      p_minute_limit: 20,
      p_day_limit: 300,
      p_month_budget_microusd: 5_000_000,
    });
    expect(sttReservation).toMatchObject({ reserved: true, revision: 0 });
    expect((await admin.from("learning_speech_usage")
      .select("kind,cost_microusd,user_id")
      .eq("user_id", aId)
      .eq("kind", "translation_stt")
      .order("created_at", { ascending: false })
      .limit(1)).data).toEqual([{
      kind: "translation_stt", cost_microusd: 10, user_id: aId,
    }]);
    const staleStt = await admin.rpc("learning_reserve_translation_stt", {
      p_user_id: aId,
      p_session_id: semanticSession,
      p_word_id: terms[0].id,
      p_expected_revision: 1,
      p_cost_microusd: 10,
      p_minute_limit: 20,
      p_day_limit: 300,
      p_month_budget_microusd: 5_000_000,
    });
    expect(staleStt.error).toBeNull();
    expect(staleStt.data).toMatchObject({ conflict: true, current_revision: 0 });
    expect((await admin.rpc("learning_reserve_translation_stt", {
      p_user_id: bId,
      p_session_id: semanticSession,
      p_word_id: terms[0].id,
      p_expected_revision: 0,
      p_cost_microusd: 10,
      p_minute_limit: 20,
      p_day_limit: 300,
      p_month_budget_microusd: 5_000_000,
    })).error).not.toBeNull();

    const semanticAttemptId = randomUUID();
    const semanticLease = randomUUID();
    const semanticAnswerHash = createHash("sha256").update("一种水果").digest("hex");
    const semanticClaimArgs = {
      p_user_id: aId,
      p_session_id: semanticSession,
      p_word_id: terms[0].id,
      p_assessment_id: semanticAttemptId,
      p_expected_revision: 0,
      p_answer_hash: semanticAnswerHash,
      p_lease_token: semanticLease,
      p_lease_seconds: 30,
    };
    expect(await rpc<any>("learning_claim_spelling_translation_assessment_v2", semanticClaimArgs))
      .toMatchObject({ claimed: true, term: terms[0].term, translations: terms[0].translations });
    expect(await rpc<any>("learning_claim_spelling_translation_assessment_v2", {
      ...semanticClaimArgs,
      p_lease_token: randomUUID(),
    })).toMatchObject({ pending: true });
    const acceptedTranslation = await rpc<any>("learning_complete_spelling_translation_assessment", {
      p_user_id: aId,
      p_session_id: semanticSession,
      p_word_id: terms[0].id,
      p_assessment_id: semanticAttemptId,
      p_expected_revision: 0,
      p_answer_hash: semanticAnswerHash,
      p_lease_token: semanticLease,
      p_correct: true,
      p_feedback: "Equivalent meaning accepted.",
      p_provider: "nalanda-normalized-exact",
      p_model: "normalized-exact-v1",
      p_usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    expect(acceptedTranslation).toMatchObject({
      attempt_id: semanticAttemptId,
      correct: true,
      revision: 0,
      attempt_result: null,
    });
    expect(await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId,
      p_session_id: semanticSession,
    })).toMatchObject({
      spelling_translation_assessment: {
        attempt_id: semanticAttemptId,
        word_id: terms[0].id,
        revision: 0,
        correct: true,
      },
    });
    const acceptedSpelling = await rpc<any>("learning_record_spelling_attempt", {
      p_user_id: aId,
      p_session_id: semanticSession,
      p_word_id: terms[0].id,
      p_answer: { text: terms[0].term },
      p_attempt_id: semanticAttemptId,
      p_expected_revision: 0,
    });
    expect(acceptedSpelling).toMatchObject({
      attempt_id: semanticAttemptId,
      correct: true,
      revision: 1,
      replayed: false,
    });
    expect(await rpc<any>("learning_record_spelling_attempt", {
      p_user_id: aId,
      p_session_id: semanticSession,
      p_word_id: terms[0].id,
      p_answer: { text: terms[0].term },
      p_attempt_id: semanticAttemptId,
      p_expected_revision: 0,
    })).toMatchObject({ attempt_id: semanticAttemptId, replayed: true });

    const wrongTranslationId = randomUUID();
    const wrongLease = randomUUID();
    const wrongHash = createHash("sha256").update("完全错误").digest("hex");
    await rpc("learning_claim_spelling_translation_assessment_v2", {
      ...semanticClaimArgs,
      p_word_id: terms[1].id,
      p_assessment_id: wrongTranslationId,
      p_expected_revision: 1,
      p_answer_hash: wrongHash,
      p_lease_token: wrongLease,
    });
    expect(await rpc<any>("learning_reserve_spelling_translation_quota", {
      p_user_id: aId,
      p_assessment_id: wrongTranslationId,
      p_lease_token: wrongLease,
      p_minute_limit: 20,
      p_day_limit: 500,
    })).toMatchObject({ reserved: true, replayed: false });
    expect(await rpc<any>("learning_reserve_spelling_translation_quota", {
      p_user_id: aId,
      p_assessment_id: wrongTranslationId,
      p_lease_token: wrongLease,
      p_minute_limit: 20,
      p_day_limit: 500,
    })).toMatchObject({ reserved: true, replayed: true });
    const rejectedTranslation = await rpc<any>("learning_complete_spelling_translation_assessment", {
      p_user_id: aId,
      p_session_id: semanticSession,
      p_word_id: terms[1].id,
      p_assessment_id: wrongTranslationId,
      p_expected_revision: 1,
      p_answer_hash: wrongHash,
      p_lease_token: wrongLease,
      p_correct: false,
      p_feedback: "The meaning does not match.",
      p_provider: "openrouter",
      p_model: "google/gemma-4-26b-a4b-it:free",
      p_usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    });
    expect(rejectedTranslation).toMatchObject({
      attempt_id: wrongTranslationId,
      correct: false,
      revision: 2,
      attempt_result: {
        attempt_id: wrongTranslationId,
        correct: false,
        revision: 2,
      },
    });
    expect(await rpc<any>("learning_complete_spelling_translation_assessment", {
      p_user_id: aId,
      p_session_id: semanticSession,
      p_word_id: terms[1].id,
      p_assessment_id: wrongTranslationId,
      p_expected_revision: 1,
      p_answer_hash: wrongHash,
      p_lease_token: wrongLease,
      p_correct: false,
      p_feedback: "The meaning does not match.",
      p_provider: "openrouter",
      p_model: "google/gemma-4-26b-a4b-it:free",
      p_usage: {},
    })).toMatchObject({ attempt_id: wrongTranslationId, replayed: true });
    expect((await admin.from("learning_attempts").select("id")
      .in("attempt_id", [semanticAttemptId, wrongTranslationId])).data).toHaveLength(2);
    const storedSemantic = await admin.from("learning_spelling_translation_assessments")
      .select("assessment_id,answer_hash,status,correct,provider,model,prompt_tokens,total_tokens,quota_counted,quota_counted_at")
      .in("assessment_id", [semanticAttemptId, wrongTranslationId])
      .order("created_at");
    expect(storedSemantic.error).toBeNull();
    expect(storedSemantic.data).toHaveLength(2);
    expect(new Set(storedSemantic.data!.map((entry) => entry.answer_hash)))
      .toEqual(new Set([semanticAnswerHash, wrongHash]));
    expect(storedSemantic.data!.every((entry) => entry.status === "completed")).toBe(true);
    expect(storedSemantic.data!.find((entry) => entry.assessment_id === semanticAttemptId)?.quota_counted).toBe(false);
    expect(storedSemantic.data!.find((entry) => entry.assessment_id === semanticAttemptId)?.quota_counted_at).toBeNull();
    expect(storedSemantic.data!.find((entry) => entry.assessment_id === wrongTranslationId))
      .toMatchObject({ quota_counted: true, quota_counted_at: expect.any(String) });

    const limitedAssessmentId = randomUUID();
    const limitedLease = randomUUID();
    const limitedHash = createHash("sha256").update("需要模型评判的另一个回答").digest("hex");
    await rpc("learning_claim_spelling_translation_assessment_v2", {
      ...semanticClaimArgs,
      p_word_id: terms[2].id,
      p_assessment_id: limitedAssessmentId,
      p_expected_revision: 2,
      p_answer_hash: limitedHash,
      p_lease_token: limitedLease,
    });
    const minuteLimited = await admin.rpc("learning_reserve_spelling_translation_quota", {
      p_user_id: aId,
      p_assessment_id: limitedAssessmentId,
      p_lease_token: limitedLease,
      p_minute_limit: 1,
      p_day_limit: 500,
    });
    expect(minuteLimited.error?.message).toMatch(/minute quota exceeded/i);
    expect(minuteLimited.error?.hint).toMatch(/^retry_after_seconds=\d+$/);
    const dayLimited = await admin.rpc("learning_reserve_spelling_translation_quota", {
      p_user_id: aId,
      p_assessment_id: limitedAssessmentId,
      p_lease_token: limitedLease,
      p_minute_limit: 20,
      p_day_limit: 1,
    });
    expect(dayLimited.error?.message).toMatch(/daily quota exceeded/i);
    expect(dayLimited.error?.hint).toMatch(/^retry_after_seconds=\d+$/);
    expect((await admin.from("learning_spelling_translation_assessments")
      .select("quota_counted,quota_counted_at").eq("assessment_id", limitedAssessmentId).single()).data)
      .toEqual({ quota_counted: false, quota_counted_at: null });
    expect((await b.from("learning_spelling_translation_assessments")
      .select("assessment_id").in("assessment_id", [semanticAttemptId, wrongTranslationId, limitedAssessmentId])).error)
      .not.toBeNull();
    expect((await admin.from("learning_sessions").delete().eq("id", semanticSession)).error).toBeNull();
    expect((await admin.from("learning_spelling_translation_assessments")
      .select("assessment_id").in("assessment_id", [semanticAttemptId, wrongTranslationId, limitedAssessmentId])).data)
      .toEqual([]);

    const preparedAudio = await rpc<any>("learning_prepare_unit_audio", {
      p_user_id: aId,
      p_unit_id: unitId,
      p_locale: "en-US",
      p_voice: "en-US-JennyNeural",
      p_output_format: "audio-24khz-48kbitrate-mono-mp3",
      p_synthesis_version: "1",
      p_priority: 50,
    });
    expect(preparedAudio).toMatchObject({ unit_id: unitId, total: 20, ready: 0, pending: 20, failed: 0 });
    audioCacheKeys.push(...preparedAudio.assets.map((asset: any) => asset.cache_key));
    expect(new Set(audioCacheKeys).size).toBe(20);
    expect((await admin.rpc("learning_prepare_unit_audio", {
      p_user_id: bId, p_unit_id: unitId, p_locale: "en-US",
      p_voice: "en-US-JennyNeural",
      p_output_format: "audio-24khz-48kbitrate-mono-mp3",
      p_synthesis_version: "1", p_priority: 50,
    })).error).not.toBeNull();

    const audioCloneId = randomUUID();
    const audioCloneUnitId = randomUUID();
    const audioClonePayload = {
      ...payload,
      id: audioCloneId,
      title: "Cross-user audio cache clone",
      units: [{
        ...payload.units[0],
        id: audioCloneUnitId,
        words: terms.map((word) => ({ ...word, id: randomUUID() })),
      }],
    };
    expect(await rpc<string>("learning_upsert_course", {
      p_user_id: bId, p_payload: audioClonePayload,
    })).toBe(audioCloneId);
    const preparedCloneAudio = await rpc<any>("learning_prepare_unit_audio", {
      p_user_id: bId,
      p_unit_id: audioCloneUnitId,
      p_locale: "en-US",
      p_voice: "en-US-JennyNeural",
      p_output_format: "audio-24khz-48kbitrate-mono-mp3",
      p_synthesis_version: "1",
      p_priority: 50,
    });
    expect(preparedCloneAudio.assets.map((asset: any) => asset.cache_key))
      .toEqual(preparedAudio.assets.map((asset: any) => asset.cache_key));
    expect((await admin.from("learning_audio_assets").select("cache_key")).data)
      .toHaveLength(20);

    const leases = [randomUUID(), randomUUID()];
    const claims = await Promise.all(leases.map((lease) => admin.rpc(
      "learning_claim_audio_asset",
      {
        p_lease_token: lease,
        p_lease_seconds: 60,
        p_min_interval_milliseconds: 3100,
      },
    )));
    expect(claims.map((result) => result.error)).toEqual([null, null]);
    const claimedIndex = claims.findIndex((result) => result.data);
    expect(claimedIndex).toBeGreaterThanOrEqual(0);
    expect(claims.filter((result) => result.data)).toHaveLength(1);
    const claimed = claims[claimedIndex].data;
    await rpc("learning_finish_audio_asset", {
      p_lease_token: leases[claimedIndex],
      p_cache_key: claimed.cache_key,
      p_success: false,
      p_error_code: "SPEECH_TTS_RATE_LIMIT",
      p_error_message: "quota pause",
      p_retry_after_seconds: 60,
    });
    expect((await admin.from("learning_audio_assets")
      .select("status,attempt_count,last_error_code")
      .eq("cache_key", claimed.cache_key).single()).data).toEqual({
      status: "pending",
      attempt_count: 0,
      last_error_code: "SPEECH_TTS_RATE_LIMIT",
    });

    // Optional speech scoring uses the visible overall PronScore threshold.
    // A low score is persisted in recognition's retry pool, a successful
    // reread removes it, and the pool must be consumed before stage advance.
    const recognitionSession = await rpc<string>("learning_start_session", {
      p_user_id: aId, p_course_id: courseId, p_unit_id: unitId, p_mode: "initial",
      p_skills: ["pronunciation", "translation", "spelling"], p_scope: "all", p_schedule_id: null,
    });
    const assess = (pronunciationScore: number) => rpc<any>("learning_record_speech_assessment", {
      p_user_id: aId, p_session_id: recognitionSession, p_word_id: terms[0].id,
      p_assessment: { accuracyScore: pronunciationScore, pronunciationScore, passThreshold: 70, phonemes: [] },
    });
    expect(await assess(69)).toMatchObject({ correct: false, retry_queued: true, pass_threshold: 70, revision: 1 });
    expect((await admin.from("learning_sessions").select("state").eq("id", recognitionSession).single()).data!.state)
      .toMatchObject({ nextQueue: [terms[0].id] });
    expect(await assess(70)).toMatchObject({ correct: true, retry_queued: false, pass_threshold: 70, revision: 2 });
    expect((await admin.from("learning_sessions").select("state").eq("id", recognitionSession).single()).data!.state)
      .toMatchObject({ nextQueue: [] });
    await assess(40);
    for (const term of terms) await rpc("learning_mark_recognition", {
      p_user_id: aId, p_session_id: recognitionSession, p_word_id: term.id,
    });
    const recognitionRetry = await admin.from("learning_sessions").select("stage,state").eq("id", recognitionSession).single();
    expect(recognitionRetry.data).toMatchObject({ stage: "recognition", state: {
      queue: [terms[0].id], cursor: 0, nextQueue: [], round: 2,
    } });
    await rpc("learning_mark_recognition", { p_user_id: aId, p_session_id: recognitionSession, p_word_id: terms[0].id });
    expect((await admin.from("learning_sessions").select("stage").eq("id", recognitionSession).single()).data!.stage).toBe("pronunciation");
    expect((await admin.from("learning_sessions").delete().eq("id", recognitionSession)).error).toBeNull();

    const tasksBefore = await a.from("study_tasks").select("id", { count: "exact", head: true });
    const sourceSessionId = randomUUID();
    expect((await admin.from("learning_sessions").insert({ id: sourceSessionId, user_id: aId, course_id: courseId, unit_id: unitId,
      mode: "initial", scope: "all", selected_skills: ["pronunciation", "translation", "spelling"], stage: "completed",
      active: false, resume_key: `initial:${courseId}:${unitId}`, completed_at: new Date().toISOString() })).error).toBeNull();
    const schedules = await rpc<any[]>("learning_schedule_reviews", { p_user_id: aId, p_unit_id: unitId,
      p_source_session_id: sourceSessionId, p_offsets: [3, 7] });
    expect(schedules).toHaveLength(2);
    expect(schedules.every((schedule) => schedule.source_session_id === sourceSessionId)).toBe(true);
    expect((await a.from("learning_review_schedules").select("id").eq("unit_id", unitId)).data).toHaveLength(2);
    expect((await b.from("learning_review_schedules").select("id").eq("unit_id", unitId)).data).toEqual([]);
    expect((await a.from("learning_review_schedules").insert({ user_id: aId, course_id: courseId, unit_id: unitId, due_date: "2030-01-01" })).error).not.toBeNull();

    const beforePoints = await a.from("profiles").select("points").eq("id", aId).single();
    const first = await startReview(courseId, unitId, ["pronunciation", "translation", "spelling"], schedules[0].id);
    await finishReview(first, terms, ["pronunciation", "translation", "spelling"], true);
    expect((await a.from("learning_review_schedules").select("status,completed_session_id").eq("id", schedules[0].id).single()).data)
      .toEqual({ status: "completed", completed_session_id: first });
    let dates = await a.from("learning_word_progress").select("pronunciation_review_dates,translation_review_dates,spelling_review_dates,learned_at,review_count").eq("word_id", terms[0].id).single();
    expect(dates.data?.pronunciation_review_dates).toHaveLength(1); expect(dates.data?.learned_at).toBeNull();

    // Completing another review on the same local date raises review_count but
    // never adds a second mastery date.
    const sameDay = await startReview(courseId, unitId, ["pronunciation", "translation", "spelling"]);
    await finishReview(sameDay, terms, ["pronunciation", "translation", "spelling"]);
    dates = await a.from("learning_word_progress").select("pronunciation_review_dates,translation_review_dates,spelling_review_dates,learned_at,review_count").eq("word_id", terms[0].id).single();
    expect(dates.data?.pronunciation_review_dates).toHaveLength(1); expect(dates.data?.review_count).toBe(2); expect(dates.data?.learned_at).toBeNull();

    // UTC+14 and UTC-11 are one calendar day apart at the same instant. The
    // second review therefore proves local-date persistence without waiting.
    expect((await a.from("profiles").update({ timezone: "Pacific/Pago_Pago" }).eq("id", aId)).error).toBeNull();
    const secondDate = await startReview(courseId, unitId, ["pronunciation", "translation", "spelling"]);
    await finishReview(secondDate, terms, ["pronunciation", "translation", "spelling"]);
    dates = await a.from("learning_word_progress").select("pronunciation_review_dates,translation_review_dates,spelling_review_dates,learned_at,review_count").eq("word_id", terms[0].id).single();
    expect(new Set(dates.data?.pronunciation_review_dates)).toHaveProperty("size", 2);
    expect(dates.data?.translation_review_dates).toHaveLength(2); expect(dates.data?.spelling_review_dates).toHaveLength(2);
    // Reviews retain distinct-date practice facts, but exam-only mastery means
    // they can never project learned_at, even after all three skills reach two days.
    expect(dates.data?.learned_at).toBeNull(); expect(dates.data?.review_count).toBe(3);

    const profileAfter = await a.from("profiles").select("points").eq("id", aId).single();
    expect(profileAfter.data!.points).toBe(beforePoints.data!.points);
    const learningSummary = await rpc<any>("learning_profile_summary", { p_user_id: aId });
    expect(learningSummary).toMatchObject({ courses: expect.any(Number), learnedWords: expect.any(Number), reviewDays: 2 });
    expect(learningSummary.learnedWords).toBe(0);
    expect(learningSummary.badges.map((badge: any) => badge.code)).not.toEqual(expect.arrayContaining(["vocab_words_bronze", "vocab_courses_bronze"]));
    expect((await b.from("user_badge_awards").select("badge_code").eq("user_id", aId)).data).toEqual([]);
    expect((await a.from("study_tasks").select("id", { count: "exact", head: true })).count).toBe(tasksBefore.count);

    // Exam pass/fail is fixed by first-round accuracy. Missed words pause at a
    // durable summary and require explicit confirmation. A passed exam records
    // only its own requirement; learned_at needs both exam kinds for the word.
    const examCourseId = randomUUID();
    const examUnitId = randomUUID();
    const examTerms = Array.from({ length: 4 }, (_, index) => ({
      id: randomUUID(),
      term: `exam-${index + 1}`,
      translations: [`考试翻译${index + 1}`],
      ipa: null,
    }));
    await rpc("learning_upsert_course", {
      p_user_id: aId,
      p_payload: {
        id: examCourseId,
        title: "Exam state machine",
        category: "english_vocabulary",
        hasUnits: false,
        locale: "en-US",
        units: [{ id: examUnitId, name: "默认单元", isSystem: true, words: examTerms }],
      },
    });
    const examById = new Map(examTerms.map((entry) => [entry.id, entry]));
    const startExam = (passPercent: number) => rpc<string>("learning_start_exam_session", {
      p_user_id: aId,
      p_course_id: examCourseId,
      p_unit_id: examUnitId,
      p_spelling_options: {
        timeLimitEnabled: false,
        timeLimitSeconds: 20,
        translationFirst: true,
      },
      p_pass_percent: passPercent,
    });
    const answerExam = async (sessionId: string, correct: boolean) => {
      const snapshot = await rpc<any>("learning_get_session_snapshot", {
        p_user_id: aId,
        p_session_id: sessionId,
      });
      const wordId = snapshot.state.queue[snapshot.state.cursor];
      const examWord = examById.get(wordId)!;
      const assessmentId = randomUUID();
      const lease = randomUUID();
      const hash = createHash("sha256").update(correct ? examWord.translations[0] : "错误翻译").digest("hex");
      await rpc("learning_claim_spelling_translation_assessment_v2", {
        p_user_id: aId,
        p_session_id: sessionId,
        p_word_id: wordId,
        p_assessment_id: assessmentId,
        p_expected_revision: snapshot.revision,
        p_answer_hash: hash,
        p_lease_token: lease,
        p_lease_seconds: 30,
      });
      const translation = await rpc<any>("learning_complete_spelling_translation_assessment", {
        p_user_id: aId,
        p_session_id: sessionId,
        p_word_id: wordId,
        p_assessment_id: assessmentId,
        p_expected_revision: snapshot.revision,
        p_answer_hash: hash,
        p_lease_token: lease,
        p_correct: correct,
        p_feedback: correct ? "Exact meaning accepted." : "Meaning rejected.",
        p_provider: "nalanda-normalized-exact",
        p_model: "normalized-exact-v1",
        p_usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
      if (correct) {
        await rpc("learning_record_spelling_attempt", {
          p_user_id: aId,
          p_session_id: sessionId,
          p_word_id: wordId,
          p_answer: { text: examWord.term },
          p_attempt_id: assessmentId,
          p_expected_revision: snapshot.revision,
        });
      } else {
        expect(translation.attempt_result).toMatchObject({ correct: false });
      }
      return wordId as string;
    };

    const failedExamSession = await startExam(75);
    await answerExam(failedExamSession, false);
    await answerExam(failedExamSession, false);
    await answerExam(failedExamSession, true);
    await answerExam(failedExamSession, true);
    const failedSummary = await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId,
      p_session_id: failedExamSession,
    });
    expect(failedSummary).toMatchObject({ active: true, state: {
      examRequiredPercent: 75,
      examAccuracyPercent: 50,
      examPassed: false,
      awaitingRetryConfirmation: true,
    } });
    await rpc("learning_continue_spelling_retry_round", {
      p_user_id: aId,
      p_session_id: failedExamSession,
    });
    await answerExam(failedExamSession, true);
    await answerExam(failedExamSession, true);
    expect(await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId,
      p_session_id: failedExamSession,
    })).toMatchObject({ stage: "completed", active: false, state: { examPassed: false } });
    const progressAfterFailedExam = await admin.from("learning_word_progress")
      .select("learned_at").eq("user_id", aId)
      .in("word_id", examTerms.map((entry) => entry.id));
    expect(progressAfterFailedExam.error).toBeNull();
    expect(progressAfterFailedExam.data?.every((entry) => entry.learned_at == null)).toBe(true);

    const examSession = await startExam(50);
    await answerExam(examSession, false);
    await answerExam(examSession, false);
    await answerExam(examSession, true);
    await answerExam(examSession, true);
    const examSummary = await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId,
      p_session_id: examSession,
    });
    expect(examSummary).toMatchObject({ mode: "exam", stage: "spelling", active: true, state: {
      examRequiredPercent: 50,
      examAnswered: 4,
      examCorrect: 2,
      examAccuracyPercent: 50,
      examFirstRoundComplete: true,
      examPassed: true,
      awaitingRetryConfirmation: true,
      retryFromRound: 1,
    } });
    expect(examSummary.state.retrySummaryIds).toHaveLength(2);
    const blockedAtSummary = await admin.rpc("learning_record_attempt", {
      p_user_id: aId,
      p_session_id: examSession,
      p_word_id: examSummary.state.queue[0],
      p_skill: "spelling",
      p_answer: { text: examById.get(examSummary.state.queue[0])!.term },
      p_attempt_id: randomUUID(),
      p_expected_revision: examSummary.revision,
    });
    expect(blockedAtSummary.error).not.toBeNull();
    const continuedExam = await rpc<any>("learning_continue_spelling_retry_round", {
      p_user_id: aId,
      p_session_id: examSession,
    });
    expect(continuedExam).toMatchObject({ revision: examSummary.revision + 1, session_patch: {
      stage: "spelling", active: true, state: { cursor: 0, nextQueue: [], round: 2 },
    } });
    expect(new Set(continuedExam.session_patch.state.queue)).toEqual(new Set(examSummary.state.retrySummaryIds));
    expect(continuedExam.session_patch.state.awaitingRetryConfirmation).toBeUndefined();
    expect(await rpc<any>("learning_continue_spelling_retry_round", {
      p_user_id: aId,
      p_session_id: examSession,
    })).toMatchObject({
      revision: continuedExam.revision,
      session_patch: { state: { round: 2, cursor: 0 } },
    });
    await answerExam(examSession, true);
    await answerExam(examSession, true);
    const completedExam = await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId,
      p_session_id: examSession,
    });
    expect(completedExam).toMatchObject({ mode: "exam", stage: "completed", active: false, state: {
      examAccuracyPercent: 50,
      examPassed: true,
    } });
    const examProgress = await admin.from("learning_word_progress")
      .select("word_id,initial_translation_passed,initial_spelling_passed,spelling_exam_passed_at,pronunciation_exam_passed_at,learned_at")
      .eq("user_id", aId)
      .in("word_id", examTerms.map((entry) => entry.id));
    expect(examProgress.error).toBeNull();
    expect(examProgress.data).toHaveLength(4);
    expect(examProgress.data!.every((entry) => entry.initial_translation_passed
      && entry.initial_spelling_passed && entry.spelling_exam_passed_at
      && !entry.pronunciation_exam_passed_at && !entry.learned_at)).toBe(true);

    // Passing the other exam later completes the conjunction, regardless of
    // exam order. Only then may learned_at be projected for these words.
    const matchingPronunciationExam = await rpc<string>("learning_start_exam_session", {
      p_user_id: aId,
      p_course_id: examCourseId,
      p_unit_id: examUnitId,
      p_spelling_options: {
        timeLimitEnabled: false,
        timeLimitSeconds: 20,
        translationFirst: false,
      },
      p_pass_percent: 90,
      p_exam_kind: "pronunciation",
    });
    for (let index = 0; index < examTerms.length; index += 1) {
      const snapshot = await rpc<any>("learning_get_session_snapshot", {
        p_user_id: aId,
        p_session_id: matchingPronunciationExam,
      });
      await rpc("learning_record_speech_assessment", {
        p_user_id: aId,
        p_session_id: matchingPronunciationExam,
        p_word_id: snapshot.state.queue[snapshot.state.cursor],
        p_assessment: {
          accuracyScore: 90,
          pronunciationScore: 90,
          passThreshold: 70,
          phonemes: [],
        },
      });
    }
    expect(await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId,
      p_session_id: matchingPronunciationExam,
    })).toMatchObject({ stage: "completed", active: false, state: {
      examKind: "pronunciation", examPassed: true,
    } });
    const masteredExamProgress = await admin.from("learning_word_progress")
      .select("spelling_exam_passed_at,pronunciation_exam_passed_at,learned_at")
      .eq("user_id", aId)
      .in("word_id", examTerms.map((entry) => entry.id));
    expect(masteredExamProgress.error).toBeNull();
    expect(masteredExamProgress.data).toHaveLength(4);
    expect(masteredExamProgress.data!.every((entry) => entry.spelling_exam_passed_at
      && entry.pronunciation_exam_passed_at && entry.learned_at)).toBe(true);

    const pronunciationCourseId = randomUUID();
    const pronunciationUnitId = randomUUID();
    const pronunciationTerms = [
      { id: randomUUID(), term: "pronunciation-alpha", translations: ["发音甲"], ipa: null },
      { id: randomUUID(), term: "pronunciation-beta", translations: ["发音乙"], ipa: null },
      { id: randomUUID(), term: "pronunciation-gamma", translations: ["发音丙"], ipa: null },
      { id: randomUUID(), term: "pronunciation-delta", translations: ["发音丁"], ipa: null },
    ];
    await rpc("learning_upsert_course", {
      p_user_id: aId,
      p_payload: {
        id: pronunciationCourseId,
        title: "Pronunciation exam state machine",
        category: "english_vocabulary",
        hasUnits: false,
        locale: "en-US",
        units: [{
          id: pronunciationUnitId,
          name: "默认单元",
          isSystem: true,
          words: pronunciationTerms,
        }],
      },
    });
    const pronunciationExam = await rpc<string>("learning_start_exam_session", {
      p_user_id: aId,
      p_course_id: pronunciationCourseId,
      p_unit_id: pronunciationUnitId,
      p_spelling_options: {
        timeLimitEnabled: false,
        timeLimitSeconds: 20,
        translationFirst: false,
      },
      p_pass_percent: 50,
      p_exam_kind: "pronunciation",
    });
    const assessExamWord = async (score: number) => {
      const snapshot = await rpc<any>("learning_get_session_snapshot", {
        p_user_id: aId,
        p_session_id: pronunciationExam,
      });
      const wordId = snapshot.state.queue[snapshot.state.cursor];
      return rpc<any>("learning_record_speech_assessment", {
        p_user_id: aId,
        p_session_id: pronunciationExam,
        p_word_id: wordId,
        p_assessment: {
          accuracyScore: score,
          pronunciationScore: score,
          passThreshold: 70,
          phonemes: [],
        },
      });
    };
    expect(await assessExamWord(60)).toMatchObject({ correct: false, retry_queued: true });
    expect(await assessExamWord(90)).toMatchObject({ correct: true, retry_queued: false });
    expect(await assessExamWord(90)).toMatchObject({ correct: true, retry_queued: false });
    expect(await assessExamWord(90)).toMatchObject({ correct: true, retry_queued: false });
    const pronunciationSummary = await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId,
      p_session_id: pronunciationExam,
    });
    expect(pronunciationSummary).toMatchObject({ mode: "exam", stage: "pronunciation", active: true, state: {
      examKind: "pronunciation",
      examRequiredPercent: 50,
      examAnswered: 4,
      examCorrect: 3,
      examAccuracyPercent: 75,
      examPassed: true,
      awaitingRetryConfirmation: true,
      retryFromRound: 1,
    } });
    expect(pronunciationSummary.state.retrySummaryIds).toHaveLength(1);
    expect(pronunciationSummary.state.retrySummaryScores[
      pronunciationSummary.state.retrySummaryIds[0]
    ]).toBe(60);
    expect((await admin.rpc("learning_record_speech_assessment", {
      p_user_id: aId,
      p_session_id: pronunciationExam,
      p_word_id: pronunciationSummary.state.retrySummaryIds[0],
      p_assessment: {
        accuracyScore: 90,
        pronunciationScore: 90,
        passThreshold: 70,
        phonemes: [],
      },
    })).error).not.toBeNull();
    const pronunciationRetry = await rpc<any>("learning_continue_exam_retry_round", {
      p_user_id: aId,
      p_session_id: pronunciationExam,
    });
    expect(pronunciationRetry).toMatchObject({ session_patch: {
      stage: "pronunciation",
      active: true,
      state: { cursor: 0, nextQueue: [], round: 2 },
    } });
    expect(pronunciationRetry.session_patch.state.awaitingRetryConfirmation).toBeUndefined();
    expect(await assessExamWord(90)).toMatchObject({ correct: true, retry_queued: false });
    expect(await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId,
      p_session_id: pronunciationExam,
    })).toMatchObject({ stage: "completed", active: false, state: {
      examKind: "pronunciation",
      examPassed: true,
      examAccuracyPercent: 75,
    } });
    const pronunciationProgress = await admin.from("learning_word_progress")
      .select("initial_pronunciation_passed,initial_translation_passed,initial_spelling_passed,spelling_exam_passed_at,pronunciation_exam_passed_at,learned_at")
      .eq("user_id", aId)
      .in("word_id", pronunciationTerms.map((entry) => entry.id));
    expect(pronunciationProgress.error).toBeNull();
    expect(pronunciationProgress.data).toHaveLength(4);
    expect(pronunciationProgress.data!.every((entry) =>
      entry.initial_pronunciation_passed
      && !entry.initial_translation_passed
      && !entry.initial_spelling_passed
      && !entry.spelling_exam_passed_at
      && entry.pronunciation_exam_passed_at
      && !entry.learned_at)).toBe(true);

    const remediationCourseId = randomUUID();
    const remediationUnitId = randomUUID();
    const remediationTerms = ["remediation-alpha", "remediation-beta", "remediation-gamma", "remediation-delta", "remediation-epsilon"]
      .map((term) => ({ id: randomUUID(), term, translations: [`${term}-translation`], ipa: null }));
    await rpc("learning_upsert_course", {
      p_user_id: aId,
      p_payload: {
        id: remediationCourseId,
        title: "Failed exam remediation history",
        category: "english_vocabulary",
        hasUnits: false,
        locale: "en-US",
        units: [{ id: remediationUnitId, name: "默认单元", isSystem: true, words: remediationTerms }],
      },
    });
    const selectedExamTerms = remediationTerms.slice(0, 2);
    const failedPronunciationExam = await rpc<string>("learning_start_selected_exam_session", {
      p_user_id: aId,
      p_course_id: remediationCourseId,
      p_unit_id: remediationUnitId,
      p_spelling_options: { timeLimitEnabled: false, timeLimitSeconds: 20, translationFirst: false },
      p_pass_percent: 90,
      p_exam_kind: "pronunciation",
      p_word_ids: selectedExamTerms.map((entry) => entry.id),
    });
    const assessFailedExamWord = async (score: number) => {
      const snapshot = await rpc<any>("learning_get_session_snapshot", {
        p_user_id: aId, p_session_id: failedPronunciationExam,
      });
      return rpc<any>("learning_record_speech_assessment", {
        p_user_id: aId,
        p_session_id: failedPronunciationExam,
        p_word_id: snapshot.state.queue[snapshot.state.cursor],
        p_assessment: { accuracyScore: score, pronunciationScore: score, passThreshold: 70, phonemes: [] },
      });
    };
    await assessFailedExamWord(60);
    await assessFailedExamWord(90);
    const failedPronunciationSummary = await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId, p_session_id: failedPronunciationExam,
    });
    expect(failedPronunciationSummary).toMatchObject({ active: true, state: {
      examTotal: 2, examAccuracyPercent: 50, examPassed: false,
      awaitingRetryConfirmation: true,
    } });
    await rpc("learning_continue_exam_retry_round", {
      p_user_id: aId, p_session_id: failedPronunciationExam,
    });
    await assessFailedExamWord(90);
    const remediated = await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId, p_session_id: failedPronunciationExam,
    });
    expect(remediated).toMatchObject({ stage: "completed", active: false, state: {
      examPassed: false, practiceCompleted: true,
    } });
    const failedProgress = await admin.from("learning_word_progress")
      .select("word_id,learned_at")
      .eq("user_id", aId)
      .in("word_id", selectedExamTerms.map((entry) => entry.id));
    expect(failedProgress.error).toBeNull();
    expect(failedProgress.data).toHaveLength(2);
    expect(failedProgress.data!.every((entry) => entry.learned_at === null)).toBe(true);

    const history = await rpc<any[]>("learning_list_exam_history", {
      p_user_id: aId, p_course_id: remediationCourseId,
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: failedPronunciationExam,
      exam_kind: "pronunciation",
      word_count: 2,
      passed: false,
      practice_completed: true,
      status: "completed",
    });
    const historyDetail = await rpc<any>("learning_get_exam_history_detail", {
      p_user_id: aId, p_session_id: failedPronunciationExam,
    });
    expect(historyDetail.words).toHaveLength(2);
    expect(historyDetail.attempts).toHaveLength(3);
    expect(historyDetail.attempts.some((entry: any) => entry.pronunciation_score === 60)).toBe(true);

    await rpc("learning_upsert_course", {
      p_user_id: aId,
      p_payload: {
        id: remediationCourseId,
        title: "Failed exam remediation history",
        category: "english_vocabulary",
        hasUnits: false,
        locale: "en-US",
        units: [{
          id: remediationUnitId,
          name: "默认单元",
          isSystem: true,
          words: remediationTerms.filter((_, index) => index !== 1).map((entry, index) => ({
            ...entry,
            term: index === 0 ? "edited-remediation-alpha" : entry.term,
          })),
        }],
      },
    });
    const preservedHistory = await rpc<any>("learning_get_exam_history_detail", {
      p_user_id: aId, p_session_id: failedPronunciationExam,
    });
    expect(preservedHistory.words.map((entry: any) => entry.term)).toEqual(
      selectedExamTerms.map((entry) => entry.term),
    );
    expect(preservedHistory.attempts.every((entry: any) =>
      entry.term?.startsWith("remediation-"))).toBe(true);

    const selectedReview = await rpc<string>("learning_start_selected_review_session", {
      p_user_id: aId,
      p_course_id: remediationCourseId,
      p_unit_id: remediationUnitId,
      p_skills: ["translation"],
      p_scope: "unlearned",
      p_schedule_id: null,
      p_spelling_options: { timeLimitEnabled: false, timeLimitSeconds: 20, translationFirst: false },
      p_word_ids: [remediationTerms[2].id],
    });
    expect(await rpc<any>("learning_get_session_snapshot", {
      p_user_id: aId, p_session_id: selectedReview,
    })).toMatchObject({ mode: "review", state: { selectionMode: "custom" }, items: [{
      word: { id: remediationTerms[2].id },
    }] });
    expect((await admin.rpc("learning_start_selected_review_session", {
      p_user_id: aId,
      p_course_id: remediationCourseId,
      p_unit_id: remediationUnitId,
      p_skills: ["translation"],
      p_scope: "all",
      p_schedule_id: null,
      p_spelling_options: { timeLimitEnabled: false, timeLimitSeconds: 20, translationFirst: false },
      p_word_ids: [pronunciationTerms[0].id],
    })).error).not.toBeNull();
    await rpc("learning_cancel_session", { p_user_id: aId, p_session_id: selectedReview });

    expect((await admin.from("learning_courses").delete().eq("id", remediationCourseId)).error).toBeNull();
    expect((await admin.from("learning_courses").delete()
      .eq("id", pronunciationCourseId)).error).toBeNull();
    expect((await admin.from("learning_courses").delete().eq("id", examCourseId)).error).toBeNull();

    // Sharing/market records are not anonymous PostgREST surfaces.
    const shareToken = "active-share-token-for-rls-e2e";
    const shareHash = createHash("sha256").update(shareToken).digest("hex");
    const shareId = await rpc<string>("learning_create_share", { p_user_id: aId, p_course_id: courseId,
      p_token_hash: shareHash, p_author_name: aName });
    expect((await b.from("learning_course_shares").select("id").eq("id", shareId)).data).toEqual([]);
    const guest = createClient(url, anonKey, clientOptions);
    expect((await guest.from("learning_course_shares").select("id").eq("id", shareId)).error).not.toBeNull();
    const publication = await rpc<any>("learning_publish_course", { p_user_id: aId, p_course_id: courseId,
      p_description: "A free RLS course", p_author_name: aName, p_rights_declared: true, p_daily_limit: 5 });
    expect((await guest.from("learning_course_publications").select("id").eq("id", publication.id)).error).not.toBeNull();
    expect((await admin.from("learning_course_publications").update({ title: "mutable?" }).eq("id", publication.id)).error).not.toBeNull();
    expect((await a.from("learning_course_reports").insert({ reporter_id: aId, publication_id: publication.id, category: "spam" })).error).not.toBeNull();
    const report = await rpc<any>("learning_create_report", { p_user_id: aId, p_publication_id: publication.id,
      p_share_id: null, p_category: "spam", p_details: "test report", p_daily_limit: 20, p_alert_threshold: 3 });
    expect(report).toMatchObject({ status: "open", openCount: 1, thresholdReached: false });

    const shareCloneId = randomUUID(); const shareCloneUnitId = randomUUID();
    const shareClonePayload = { ...payload, id: shareCloneId, title: "Shared clone", units: [{ ...payload.units[0],
      id: shareCloneUnitId, words: terms.map((word) => ({ ...word, id: randomUUID() })) }] };
    expect(await rpc<string>("learning_clone_share", { p_user_id: aId, p_payload: shareClonePayload, p_token_hash: shareHash })).toBe(shareCloneId);
    expect((await a.from("learning_courses").select("can_republish,origin_share_id,origin_author_name").eq("id", shareCloneId).single()).data)
      .toMatchObject({ can_republish: false, origin_share_id: shareId, origin_author_name: aName });
    await rpc("learning_revoke_share", { p_user_id: aId, p_share_id: shareId });
    const revokedClone = await admin.rpc("learning_clone_share", { p_user_id: aId,
      p_payload: { ...shareClonePayload, id: randomUUID() }, p_token_hash: shareHash });
    expect(revokedClone.error).not.toBeNull();

    // A marketplace clone is an independent private snapshot with zero
    // progress and no right to republish. Its same vocabulary fingerprint can
    // never create a second +20 ledger entry.
    const cloneId = randomUUID(); const cloneUnitId = randomUUID();
    const cloneTerms = terms.map((word) => ({ ...word, id: randomUUID() }));
    const clonePayload = { ...payload, id: cloneId, title: "RLS Vocabulary clone",
      units: [{ ...payload.units[0], id: cloneUnitId, words: cloneTerms }] };
    expect(await rpc<string>("learning_clone_course", { p_user_id: aId, p_payload: clonePayload,
      p_origin_publication_id: publication.id, p_origin_author_name: aName })).toBe(cloneId);
    const cloned = await a.from("learning_courses").select("can_republish,origin_publication_id,origin_author_name").eq("id", cloneId).single();
    expect(cloned.data).toMatchObject({ can_republish: false, origin_publication_id: publication.id, origin_author_name: aName });
    expect((await admin.from("learning_course_publications").select("clone_count").eq("id", publication.id).single()).data?.clone_count).toBe(1);
    const cloneProgress = await a.from("learning_word_progress").select("word_id,learned_at,wrong_count,review_count").in("word_id", cloneTerms.map((word) => word.id));
    expect(cloneProgress.data).toHaveLength(20); expect(cloneProgress.data!.every((row) => row.learned_at == null && row.wrong_count === 0 && row.review_count === 0)).toBe(true);

    const cloneMasteredAt = new Date().toISOString();
    expect((await admin.from("learning_word_progress")
      .update({ learned_at: cloneMasteredAt })
      .eq("user_id", aId).eq("word_id", cloneTerms[0].id)).error).toBeNull();
    let projectionProbe = await admin.from("learning_word_progress")
      .select("spelling_exam_passed_at,pronunciation_exam_passed_at,learned_at")
      .eq("user_id", aId).eq("word_id", cloneTerms[0].id).single();
    expect(projectionProbe.data).toMatchObject({
      spelling_exam_passed_at: null,
      pronunciation_exam_passed_at: null,
      learned_at: null,
    });

    expect((await admin.from("learning_word_progress")
      .update({ spelling_exam_passed_at: cloneMasteredAt, learned_at: cloneMasteredAt })
      .eq("user_id", aId).eq("word_id", cloneTerms[0].id)).error).toBeNull();
    projectionProbe = await admin.from("learning_word_progress")
      .select("spelling_exam_passed_at,pronunciation_exam_passed_at,learned_at")
      .eq("user_id", aId).eq("word_id", cloneTerms[0].id).single();
    expect(projectionProbe.data).toMatchObject({
      spelling_exam_passed_at: expect.any(String),
      pronunciation_exam_passed_at: null,
      learned_at: null,
    });
    expect(new Date(projectionProbe.data!.spelling_exam_passed_at).toISOString())
      .toBe(cloneMasteredAt);

    expect((await admin.from("learning_word_progress").update({ pronunciation_review_dates: ["2026-01-01", "2026-01-02"],
      translation_review_dates: ["2026-01-01", "2026-01-02"], spelling_review_dates: ["2026-01-01", "2026-01-02"],
      spelling_exam_passed_at: cloneMasteredAt, pronunciation_exam_passed_at: cloneMasteredAt,
      learned_at: cloneMasteredAt }).eq("user_id", aId).in("word_id", cloneTerms.map((word) => word.id))).error).toBeNull();
    const cloneSession = await startReview(cloneId, cloneUnitId, ["pronunciation"]);
    await finishReview(cloneSession, cloneTerms, ["pronunciation"]);
    expect((await a.from("profiles").select("points").eq("id", aId).single()).data!.points).toBe(beforePoints.data!.points + 20);
    const completionEntries = await a.from("point_entries").select("id,source_id,amount").eq("event_type", "learning_course_completed");
    expect(completionEntries.data).toHaveLength(1); expect(completionEntries.data![0].amount).toBe(20);

    const masterySeed = { initial_recognition_seen: true, initial_pronunciation_passed: true,
      initial_translation_passed: true, initial_spelling_passed: true,
      pronunciation_review_dates: ["2026-01-01", "2026-01-02"], translation_review_dates: ["2026-01-01", "2026-01-02"],
      spelling_review_dates: ["2026-01-01", "2026-01-02"],
      spelling_exam_passed_at: cloneMasteredAt, pronunciation_exam_passed_at: cloneMasteredAt,
      learned_at: cloneMasteredAt };
    const progressForFirst = () => a.from("learning_word_progress")
      .select("initial_recognition_seen,initial_pronunciation_passed,initial_translation_passed,initial_spelling_passed,pronunciation_review_dates,translation_review_dates,spelling_review_dates,spelling_exam_passed_at,pronunciation_exam_passed_at,learned_at,review_count")
      .eq("word_id", terms[0].id).single();

    // Editing resets exactly the affected learning abilities while preserving
    // historical error/review counters. Rename and reordering reset nothing.
    expect((await admin.from("learning_word_progress").update(masterySeed).eq("word_id", terms[0].id)).error).toBeNull();
    const activeForEdit = await startReview(courseId, unitId, ["spelling"]);
    await answer(activeForEdit, terms[0], "spelling");
    const translationEdited: any = structuredClone(payload);
    translationEdited.units[0].words[0].translations = ["新翻译"];
    await rpc("learning_upsert_course", { p_user_id: aId, p_payload: translationEdited });
    expect((await admin.from("learning_sessions").select("active,state").eq("id", activeForEdit).single()).data)
      .toMatchObject({ active: false, state: { abortedReason: "course_content_updated" } });
    expect((await admin.from("learning_attempts").select("id", { count: "exact", head: true }).eq("session_id", activeForEdit)).count).toBe(1);
    let editedProgress = await progressForFirst();
    expect(editedProgress.data).toMatchObject({ initial_recognition_seen: true, initial_pronunciation_passed: true,
      initial_translation_passed: false, initial_spelling_passed: true, pronunciation_review_dates: ["2026-01-01", "2026-01-02"],
      translation_review_dates: [], spelling_review_dates: ["2026-01-01", "2026-01-02"],
      spelling_exam_passed_at: null, pronunciation_exam_passed_at: expect.any(String), learned_at: null, review_count: 3 });

    expect((await admin.from("learning_word_progress").update(masterySeed).eq("word_id", terms[0].id)).error).toBeNull();
    const stableSession = await startReview(courseId, unitId, ["spelling"]);
    await rpc("learning_rename_course", { p_user_id: aId, p_course_id: courseId, p_title: "Renamed vocabulary" });
    const reordered = structuredClone(translationEdited); reordered.units[0].words.reverse();
    await rpc("learning_upsert_course", { p_user_id: aId, p_payload: reordered });
    expect((await admin.from("learning_sessions").select("active").eq("id", stableSession).single()).data?.active).toBe(true);
    editedProgress = await progressForFirst();
    expect(editedProgress.data).toMatchObject({ initial_pronunciation_passed: true, initial_translation_passed: true,
      initial_spelling_passed: true, pronunciation_review_dates: ["2026-01-01", "2026-01-02"],
      translation_review_dates: ["2026-01-01", "2026-01-02"], spelling_review_dates: ["2026-01-01", "2026-01-02"],
      spelling_exam_passed_at: expect.any(String), pronunciation_exam_passed_at: expect.any(String),
      learned_at: expect.any(String), review_count: 3 });

    const ipaEdited = structuredClone(translationEdited); ipaEdited.units[0].words[0].ipa = "/wɝd/";
    await rpc("learning_upsert_course", { p_user_id: aId, p_payload: ipaEdited });
    expect((await admin.from("learning_sessions").select("active").eq("id", stableSession).single()).data?.active).toBe(false);
    editedProgress = await progressForFirst();
    expect(editedProgress.data).toMatchObject({ initial_pronunciation_passed: false, initial_translation_passed: true,
      initial_spelling_passed: true, pronunciation_review_dates: [], translation_review_dates: ["2026-01-01", "2026-01-02"],
      spelling_review_dates: ["2026-01-01", "2026-01-02"], spelling_exam_passed_at: expect.any(String),
      pronunciation_exam_passed_at: null, learned_at: null, review_count: 3 });

    expect((await admin.from("learning_word_progress").update(masterySeed).eq("word_id", terms[0].id)).error).toBeNull();
    const termEdited = structuredClone(ipaEdited); termEdited.units[0].words[0].term = "changed-word";
    await rpc("learning_upsert_course", { p_user_id: aId, p_payload: termEdited });
    editedProgress = await progressForFirst();
    expect(editedProgress.data).toMatchObject({ initial_recognition_seen: false, initial_pronunciation_passed: false,
      initial_translation_passed: false, initial_spelling_passed: false, pronunciation_review_dates: [],
      translation_review_dates: [], spelling_review_dates: [], spelling_exam_passed_at: null,
      pronunciation_exam_passed_at: null, learned_at: null, review_count: 3 });

    // The already-cloned snapshot is independent from every source edit.
    expect((await a.from("learning_course_words").select("term").eq("course_id", cloneId).eq("position", 0).single()).data?.term).toBe(terms[0].term);
    expect((await admin.from("learning_courses").delete().eq("id", courseId)).error).toBeNull();
    expect((await a.from("point_entries").select("id").eq("event_type", "learning_course_completed")).data).toHaveLength(1);
    expect((await a.from("user_badge_awards").select("badge_code").in("badge_code", ["vocab_words_bronze", "vocab_courses_bronze"])).data).toHaveLength(2);
  }, 120_000);
});
