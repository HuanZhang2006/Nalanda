import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const phase = process.argv[2];
const url = process.env.SUPABASE_URL || "";
const anonKey = process.env.SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const fixturePath = process.env.POINTS_UPGRADE_FIXTURE || "";

if (process.env.ALLOW_POINTS_UPGRADE_E2E !== "YES") {
  throw new Error("Set ALLOW_POINTS_UPGRADE_E2E=YES to run the destructive local upgrade fixture");
}
if (!url || !anonKey || !serviceRoleKey || !fixturePath) {
  throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and POINTS_UPGRADE_FIXTURE are required");
}

const hostname = new URL(url).hostname;
if (hostname !== "127.0.0.1" && hostname !== "localhost") {
  throw new Error(`Upgrade fixture refuses non-local Supabase URL: ${hostname}`);
}
if (phase !== "seed" && phase !== "assert") {
  throw new Error("Usage: node points-upgrade.e2e.mjs <seed|assert>");
}

const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin = createClient(url, serviceRoleKey, options);

async function must(resultPromise, label) {
  const result = await resultPromise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function signedIn(email, password) {
  const client = createClient(url, anonKey, options);
  await must(client.auth.signInWithPassword({ email, password }), `sign in ${email}`);
  return client;
}

async function profile(client, userId) {
  return must(client.from("profiles").select("points,credits,level,level_name,vip_until,streak,streak_date").eq("id", userId).single(), "read profile");
}

async function seedLegacyFixture() {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = `Nalanda-Upgrade-${nonce}!`;
  const emailA = `nalanda-upgrade-a-${nonce}@example.com`;
  const emailB = `nalanda-upgrade-b-${nonce}@example.com`;

  const createdA = await must(admin.auth.admin.createUser({ email: emailA, password, email_confirm: true }), "create legacy user A");
  const createdB = await must(admin.auth.admin.createUser({ email: emailB, password, email_confirm: true }), "create legacy user B");
  assert(createdA.user?.id && createdB.user?.id, "Auth users must have IDs");
  const aId = createdA.user.id;
  const bId = createdB.user.id;
  const a = await signedIn(emailA, password);
  const b = await signedIn(emailB, password);

  const postPayload = {
    title: "Legacy stable post",
    body: "same content before ledger migration",
    kind: "question",
    subject: "UPGRADE",
    tags: ["legacy", "points"],
  };
  const posts = await must(a.from("posts").insert([postPayload, postPayload]).select("id"), "create duplicate legacy posts");
  assert.equal(posts.length, 2);
  const postIds = posts.map((row) => row.id);

  await must(b.from("post_likes").insert(postIds.map((postId) => ({ post_id: postId }))), "create legacy likes");
  const comments = await must(b.from("comments").insert(postIds.map((postId, index) => ({ post_id: postId, body: `legacy comment ${index}` }))).select("id,post_id"), "create legacy comments");
  const reposts = await must(b.from("posts").insert(postIds.map((postId) => ({ repost_of: postId, kind: "experience", tags: [] }))).select("id"), "create legacy reposts");

  const task = await must(b.from("study_tasks").insert({ title: "Legacy completed task", due_date: "2030-01-02" }).select("id").single(), "create legacy task");
  await must(b.from("study_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", task.id), "complete legacy task");

  // 0001-0007 allowed these forged updates. Fixed values make the opening-balance
  // and derived-level assertions deterministic after 0008 is applied.
  await must(a.from("profiles").update({
    points: 77,
    credits: 700,
    level: 6,
    level_name: "FORGED",
    vip_until: "2099-01-01T00:00:00.000Z",
    streak: 41,
    streak_date: "2099-01-01",
  }).eq("id", aId), "set legacy profile A baseline");
  await must(b.from("profiles").update({
    points: 23,
    credits: 230,
    level: 6,
    level_name: "FORGED",
    vip_until: "2099-01-01T00:00:00.000Z",
    streak: 17,
    streak_date: "2099-01-01",
  }).eq("id", bId), "set legacy profile B baseline");

  await writeFile(fixturePath, JSON.stringify({
    emailA, emailB, password, aId, bId, postPayload, postIds,
    commentIds: comments.map((row) => row.id),
    repostIds: reposts.map((row) => row.id),
    taskId: task.id,
  }), { mode: 0o600 });
  process.stdout.write("Legacy 0007 points fixture seeded.\n");
}

async function assertUpgradeFixture() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const a = await signedIn(fixture.emailA, fixture.password);
  const b = await signedIn(fixture.emailB, fixture.password);

  const profileA = await profile(a, fixture.aId);
  const profileB = await profile(b, fixture.bId);
  assert.deepEqual({ points: profileA.points, level: profileA.level, level_name: profileA.level_name }, { points: 77, level: 2, level_name: "Learner" });
  assert.deepEqual({ points: profileB.points, level: profileB.level, level_name: profileB.level_name }, { points: 23, level: 1, level_name: "Novice" });
  assert.equal(profileA.credits, 700, "legacy credits are preserved for explicit production audit");
  assert.equal(profileB.streak, 17, "legacy streak is preserved but locked from future client writes");

  const protectedWrite = await b.from("profiles").update({ points: 9999, credits: 9999, vip_until: null, streak: 9999 }).eq("id", fixture.bId);
  assert(protectedWrite.error, "0008 must reject protected profile updates after upgrade");

  const opening = await must(admin.from("point_entries").select("user_id,amount,rule_version").in("user_id", [fixture.aId, fixture.bId]).eq("event_type", "legacy_opening"), "read opening entries");
  assert.deepEqual(new Map(opening.map((entry) => [entry.user_id, entry.amount])), new Map([[fixture.aId, 77], [fixture.bId, 23]]));
  assert(opening.every((entry) => entry.rule_version === "legacy-import-v1"));

  const migratedPosts = await must(admin.from("posts").select("id,repost_of,points_business_key").in("id", [...fixture.postIds, ...fixture.repostIds]), "read migrated post keys");
  const originals = migratedPosts.filter((row) => !row.repost_of);
  const reposts = migratedPosts.filter((row) => row.repost_of);
  assert.equal(new Set(originals.map((row) => row.points_business_key)).size, 1, "duplicate logical originals share one key");
  assert.equal(new Set(reposts.map((row) => row.points_business_key)).size, 1, "duplicate reposts share one root-anchored key");
  const originalKey = originals[0].points_business_key;
  const repostKey = reposts[0].points_business_key;

  const likes = await must(admin.from("post_likes").select("post_id,points_business_key").in("post_id", fixture.postIds), "read migrated like keys");
  const comments = await must(admin.from("comments").select("id,points_business_key").in("id", fixture.commentIds), "read migrated comment keys");
  assert.equal(new Set(likes.map((row) => row.points_business_key)).size, 1);
  assert.equal(new Set(comments.map((row) => row.points_business_key)).size, 1);
  const likeKey = likes[0].points_business_key;
  const commentKey = comments[0].points_business_key;

  const task = await must(admin.from("study_tasks").select("points_business_key").eq("id", fixture.taskId).single(), "read migrated task key");
  const expectedStates = [originalKey, repostKey, likeKey, commentKey, task.points_business_key];
  const states = await must(admin.from("point_event_states").select("business_key,is_active,transition_no").in("business_key", expectedStates), "read backfilled event states");
  assert.equal(states.length, expectedStates.length);
  assert(states.every((state) => state.is_active && state.transition_no === 0), "legacy active states must be backfilled without duplicate rewards");

  // Each duplicate relation shares one claim: only deleting the last row reverses,
  // and recreating it restores the same net amount.
  await must(b.from("post_likes").delete().eq("post_id", fixture.postIds[0]), "delete first legacy like");
  assert.equal((await profile(b, fixture.bId)).points, 23);
  await must(b.from("post_likes").delete().eq("post_id", fixture.postIds[1]), "delete last legacy like");
  assert.equal((await profile(b, fixture.bId)).points, 22);
  await must(b.from("post_likes").insert({ post_id: fixture.postIds[1] }), "restore legacy like claim");
  assert.equal((await profile(b, fixture.bId)).points, 23);

  await must(b.from("comments").delete().eq("id", fixture.commentIds[0]), "delete first legacy comment");
  assert.equal((await profile(b, fixture.bId)).points, 23);
  await must(b.from("comments").delete().eq("id", fixture.commentIds[1]), "delete last legacy comment");
  assert.equal((await profile(b, fixture.bId)).points, 21);
  await must(b.from("comments").insert({ post_id: fixture.postIds[1], body: "restored legacy comment" }), "restore legacy comment claim");
  assert.equal((await profile(b, fixture.bId)).points, 23);

  await must(b.from("posts").delete().eq("id", fixture.repostIds[0]), "delete first legacy repost");
  assert.equal((await profile(b, fixture.bId)).points, 23);
  await must(b.from("posts").delete().eq("id", fixture.repostIds[1]), "delete last legacy repost");
  assert.equal((await profile(b, fixture.bId)).points, 20);
  await must(b.from("posts").insert({ repost_of: fixture.postIds[1], kind: "experience", tags: [] }), "restore legacy repost claim");
  assert.equal((await profile(b, fixture.bId)).points, 23);

  await must(b.from("study_tasks").update({ done: false, done_at: null }).eq("id", fixture.taskId), "undo legacy task");
  assert.equal((await profile(b, fixture.bId)).points, 18);
  await must(b.from("study_tasks").update({ done: true, done_at: new Date().toISOString() }).eq("id", fixture.taskId), "redo legacy task");
  const afterTaskRedo = await profile(b, fixture.bId);
  assert.equal(afterTaskRedo.points, 23);
  assert.equal(afterTaskRedo.streak, 17, "backfilled task redo must not advance streak");

  const entries = await must(b.from("point_entries").select("amount"), "read upgraded ledger");
  assert.equal(entries.reduce((sum, entry) => sum + entry.amount, 0), 23, "profile projection must equal ledger sum");

  const deletedA = await admin.auth.admin.deleteUser(fixture.aId);
  const deletedB = await admin.auth.admin.deleteUser(fixture.bId);
  if (deletedA.error || deletedB.error) throw deletedA.error || deletedB.error;
  const [entryRemnants, stateRemnants] = await Promise.all([
    must(admin.from("point_entries").select("id").in("user_id", [fixture.aId, fixture.bId]), "check ledger cleanup"),
    must(admin.from("point_event_states").select("business_key").in("user_id", [fixture.aId, fixture.bId]), "check state cleanup"),
  ]);
  assert.equal(entryRemnants.length, 0, "Auth deletion must cascade upgraded ledger rows");
  assert.equal(stateRemnants.length, 0, "Auth deletion must cascade upgraded event state rows");
  await unlink(fixturePath);
  process.stdout.write("0007 -> 0008 points upgrade fixture passed.\n");
}

if (phase === "seed") await seedLegacyFixture();
else await assertUpgradeFixture();
