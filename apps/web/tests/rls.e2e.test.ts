// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
    // auth 级联不保证清理 Storage，因此先用 service role 删除测试对象。
    if (admin && storagePaths.length) await admin.storage.from("materials").remove(storagePaths);
    // 删除 auth 用户会通过外键级联删除本套件产生的业务表数据。
    if (admin && aId) await admin.auth.admin.deleteUser(aId);
    if (admin && bId) await admin.auth.admin.deleteUser(bId);
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
    await expect(b.from("post_likes").insert({ post_id: post.data!.id })).resolves.toMatchObject({ error: null });
    await expect(b.from("post_favorites").insert({ post_id: post.data!.id })).resolves.toMatchObject({ error: null });
    const comment = await b.from("comments").insert({ post_id: post.data!.id, body: "comment", author_name: "HACKER" }).select("*").single();
    expect(comment.error).toBeNull();
    expect(comment.data?.author_name).not.toBe("HACKER");
    await expect(b.from("posts").insert({ repost_of: post.data!.id, kind: "experience", tags: [] })).resolves.toMatchObject({ error: null });
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

    // 发帖触发器每篇 +10；达到 50 后等级应同步提升为 Learner。
    const extraPosts = Array.from({ length: 4 }, (_, index) => ({ title: `Level post ${index}`, kind: "experience", tags: [] }));
    expect((await a.from("posts").insert(extraPosts)).error).toBeNull();
    const leveled = await a.from("profiles").select("points,level,level_name").eq("id", aId).single();
    expect(leveled.data!.points).toBeGreaterThanOrEqual(50);
    expect(leveled.data).toMatchObject({ level: 2, level_name: "Learner" });
  }, 30_000);

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
    ]).select("id");
    expect(tasks.error).toBeNull();
    expect(tasks.data).toHaveLength(2);
    expect((await b.from("study_tasks").select("id").in("id", tasks.data!.map((task) => task.id))).data).toEqual([]);

    const crossOwnerTask = await b.from("study_tasks").insert({ title: "Cross owner", course_id: course.data!.id });
    expect(crossOwnerTask.error).not.toBeNull();

    const before = await a.from("profiles").select("points,streak").eq("id", aId).single();
    await a.from("study_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", tasks.data![0].id);
    const afterFirst = await a.from("profiles").select("points,streak").eq("id", aId).single();
    await a.from("study_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", tasks.data![1].id);
    const afterSecond = await a.from("profiles").select("points,streak").eq("id", aId).single();

    expect(afterFirst.data!.points).toBe(before.data!.points + 5);
    expect(afterSecond.data!.points).toBe(before.data!.points + 10);
    expect(afterFirst.data!.streak).toBeGreaterThanOrEqual(1);
    expect(afterSecond.data!.streak).toBe(afterFirst.data!.streak);
  }, 30_000);
});
