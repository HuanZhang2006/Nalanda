import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// @supabase/realtime-js initializes a Realtime client with every createClient
// call, even though this fixture only uses Auth/PostgREST. Node 20 has no
// native WebSocket, while the deployed runtime and CI intentionally target it.
// Keep the test-only adapter explicit rather than depending on a transitive
// package or silently running this important migration test on a newer Node.
if (!globalThis.WebSocket) {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: WebSocket,
  });
}

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
if (!["seed", "mutate", "assert"].includes(phase)) {
  throw new Error("Usage: node points-upgrade.e2e.mjs <seed|mutate|assert>");
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

async function ledgerTotal(client) {
  const entries = await must(client.from("point_entries").select("amount"), "read ledger total");
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
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

  // Fixed historical values make the opening-balance and derived-level
  // assertions deterministic after 0008/0009 are applied. Seed them through the
  // service role: the fixture models data that already exists before the
  // security migration, and local Supabase CLI grant defaults for 0001-0007
  // do not reliably grant an authenticated client UPDATE on public tables.
  // The post-upgrade assertion below separately verifies that a normal user
  // cannot alter any managed profile fields.
  await must(admin.from("profiles").update({
    points: 77,
    credits: 700,
    level: 6,
    level_name: "FORGED",
    vip_until: "2099-01-01T00:00:00.000Z",
    streak: 41,
    streak_date: "2099-01-01",
  }).eq("id", aId), "set legacy profile A baseline");
  await must(admin.from("profiles").update({
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

async function mutateLegacyFixture() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const b = await signedIn(fixture.emailB, fixture.password);
  await must(
    b.from("study_tasks").update({ done: false, done_at: null }).eq("id", fixture.taskId),
    "cancel a 0008-backfilled task before 0039",
  );
  assert.equal(await ledgerTotal(b), -5, "the old state machine exposes the unearned legacy negative debt");
  assert.equal((await profile(b, fixture.bId)).points, 0, "the pre-0039 Profile projection clamps that debt to zero");
  await writeFile(fixturePath, JSON.stringify({ ...fixture, legacyNegativeTaskCreated: true }), { mode: 0o600 });
  process.stdout.write("Legacy negative transition created on the 0038 schema.\n");
}

async function assertUpgradeFixture() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.equal(fixture.legacyNegativeTaskCreated, true, "fixture must exercise the 0038 negative-debt boundary");
  const a = await signedIn(fixture.emailA, fixture.password);
  const b = await signedIn(fixture.emailB, fixture.password);

  const profileA = await profile(a, fixture.aId);
  const profileB = await profile(b, fixture.bId);
  assert.deepEqual({ points: profileA.points, level: profileA.level, level_name: profileA.level_name }, { points: 0, level: 1, level_name: "Novice" });
  assert.deepEqual({ points: profileB.points, level: profileB.level, level_name: profileB.level_name }, { points: 0, level: 1, level_name: "Novice" });
  assert.equal(profileA.credits, 700, "legacy credits are preserved for explicit production audit");
  assert.equal(profileB.streak, 17, "legacy streak is preserved but locked from future client writes");

  const protectedWrite = await b.from("profiles").update({ points: 9999, credits: 9999, vip_until: null, streak: 9999 }).eq("id", fixture.bId);
  assert(protectedWrite.error, "0008 must reject protected profile updates after upgrade");

  const opening = await must(admin.from("point_entries").select("id,user_id,amount,rule_version").in("user_id", [fixture.aId, fixture.bId]).eq("event_type", "legacy_opening"), "read opening entries");
  assert.deepEqual(new Map(opening.map((entry) => [entry.user_id, entry.amount])), new Map([[fixture.aId, 77], [fixture.bId, 23]]));
  assert(opening.every((entry) => entry.rule_version === "legacy-import-v1"));
  const resets = await must(admin.from("point_entries").select("user_id,amount,rule_version,reversal_of").in("user_id", [fixture.aId, fixture.bId]).eq("event_type", "legacy_opening_reset"), "read opening reset entries");
  assert.deepEqual(new Map(resets.map((entry) => [entry.user_id, entry.amount])), new Map([[fixture.aId, -77], [fixture.bId, -23]]));
  assert(resets.every((entry) => entry.rule_version === "legacy-reset-v1"));
  assert.deepEqual(
    new Map(resets.map((entry) => [entry.user_id, entry.reversal_of])),
    new Map(opening.map((entry) => [entry.user_id, entry.id])),
    "each reset entry must reference its append-only legacy opening",
  );

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
  const states = await must(admin.from("point_event_states").select("business_key,is_active,source_active,awarded_amount,decision_rule_version,transition_no").in("business_key", expectedStates), "read backfilled event states");
  assert.equal(states.length, expectedStates.length);
  for (const state of states) {
    expectGrandfatherState(state, state.business_key === task.points_business_key);
  }
  const claims = await must(admin.from("point_daily_award_claims").select("business_key,rule_version,daily_window_id,daily_limit,awarded_amount,suppressed_reason").in("business_key", expectedStates), "read grandfather claims");
  assert.equal(claims.length, expectedStates.length);
  assert(claims.every((claim) => (
    claim.rule_version === "grandfather-v1"
    && claim.daily_window_id === null
    && claim.daily_limit === null
    && claim.awarded_amount === 0
    && claim.suppressed_reason === null
  )), "grandfather claims must freeze the provable historical award amount at zero");
  const taskCorrections = await must(admin.from("point_entries")
    .select("amount,rule_version,transition_no,reversal_of")
    .eq("business_key", task.points_business_key)
    .eq("rule_version", "grandfather-zero-reset-v1"), "read grandfather debt correction");
  assert.equal(taskCorrections.length, 1);
  assert.deepEqual({
    amount: taskCorrections[0].amount,
    transition_no: taskCorrections[0].transition_no,
  }, { amount: 5, transition_no: 2 });
  assert(taskCorrections[0].reversal_of, "the correction must link to the historical negative transition");

  // Each duplicate relation shares one claim. These 0008 placeholders never had
  // an individual positive ledger entry, so deleting/restoring them remains a
  // zero-value idempotent transition instead of manufacturing a negative award.
  await must(b.from("post_likes").delete().eq("post_id", fixture.postIds[0]), "delete first legacy like");
  assert.equal(await ledgerTotal(b), 0);
  await must(b.from("post_likes").delete().eq("post_id", fixture.postIds[1]), "delete last legacy like");
  assert.equal(await ledgerTotal(b), 0);
  assert.equal((await profile(b, fixture.bId)).points, 0);
  await must(b.from("post_likes").insert({ post_id: fixture.postIds[1] }), "restore legacy like claim");
  assert.equal(await ledgerTotal(b), 0);

  await must(b.from("comments").delete().eq("id", fixture.commentIds[0]), "delete first legacy comment");
  assert.equal(await ledgerTotal(b), 0);
  await must(b.from("comments").delete().eq("id", fixture.commentIds[1]), "delete last legacy comment");
  assert.equal(await ledgerTotal(b), 0);
  assert.equal((await profile(b, fixture.bId)).points, 0);
  await must(b.from("comments").insert({ post_id: fixture.postIds[1], body: "restored legacy comment" }), "restore legacy comment claim");
  assert.equal(await ledgerTotal(b), 0);

  await must(b.from("posts").delete().eq("id", fixture.repostIds[0]), "delete first legacy repost");
  assert.equal(await ledgerTotal(b), 0);
  await must(b.from("posts").delete().eq("id", fixture.repostIds[1]), "delete last legacy repost");
  assert.equal(await ledgerTotal(b), 0);
  assert.equal((await profile(b, fixture.bId)).points, 0);
  await must(b.from("posts").insert({ repost_of: fixture.postIds[1], kind: "experience", tags: [] }), "restore legacy repost claim");
  assert.equal(await ledgerTotal(b), 0);

  await must(b.from("study_tasks").update({ done: false }).eq("id", fixture.taskId), "undo legacy task");
  assert.equal(await ledgerTotal(b), 0);
  assert.equal((await profile(b, fixture.bId)).points, 0);
  await must(b.from("study_tasks").update({ done: true }).eq("id", fixture.taskId), "redo legacy task");
  const afterTaskRedo = await profile(b, fixture.bId);
  assert.equal(afterTaskRedo.points, 0);
  assert.equal(await ledgerTotal(b), 0);
  assert.equal(afterTaskRedo.streak, 17, "backfilled task redo must not advance streak");

  const entries = await must(b.from("point_entries").select("amount"), "read upgraded ledger");
  assert.equal(entries.reduce((sum, entry) => sum + entry.amount, 0), 0, "profile projection must equal ledger sum");

  const deletedA = await admin.auth.admin.deleteUser(fixture.aId);
  const deletedB = await admin.auth.admin.deleteUser(fixture.bId);
  if (deletedA.error || deletedB.error) throw deletedA.error || deletedB.error;
  const [entryRemnants, stateRemnants, claimRemnants] = await Promise.all([
    must(admin.from("point_entries").select("id").in("user_id", [fixture.aId, fixture.bId]), "check ledger cleanup"),
    must(admin.from("point_event_states").select("business_key").in("user_id", [fixture.aId, fixture.bId]), "check state cleanup"),
    must(admin.from("point_daily_award_claims").select("business_key").in("user_id", [fixture.aId, fixture.bId]), "check claim cleanup"),
  ]);
  assert.equal(entryRemnants.length, 0, "Auth deletion must cascade upgraded ledger rows");
  assert.equal(stateRemnants.length, 0, "Auth deletion must cascade upgraded event state rows");
  assert.equal(claimRemnants.length, 0, "Auth deletion must cascade upgraded award claims");
  await unlink(fixturePath);
  process.stdout.write("0007 -> latest points upgrade fixture passed.\n");
}

function expectGrandfatherState(state, wasInactiveBefore0039) {
  assert.equal(state.is_active, false);
  assert.equal(state.source_active, !wasInactiveBefore0039);
  assert.equal(state.awarded_amount, 0);
  assert.equal(state.decision_rule_version, "grandfather-v1");
  assert.equal(state.transition_no, wasInactiveBefore0039 ? 2 : 0);
}

if (phase === "seed") await seedLegacyFixture();
else if (phase === "mutate") await mutateLegacyFixture();
else await assertUpgradeFixture();
