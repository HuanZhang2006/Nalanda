# 05 · Database / migrations / RLS

> **About this document**
> - **Contents**: Records the current Supabase/Postgres setup, the RLS pattern, the migration list, and the limits of the migration tooling.
> - **Purpose**: An introduction to the data layer; see the ERD for full relationships and the operations runbook for formal releases/rollbacks.
> - **When to update**: When migrations are added, or the RLS pattern, migration tooling, or database release process changes.
> - **Status baseline**: 2026-08-23. Production migration history is at 0053; the phase-one integrity/points work of 0039–0040 and the final timestamp-column revocation of 0052–0053 are both live.

> Goal: where data lives, how we guarantee "everyone can only touch their own data" (RLS), and the workflow for changing table structure (migrations + one command to apply them). The authentication-related profiles table is in [02 User system and authentication](02-auth-and-user-system.md).

## 1. What the database is
We use **Supabase** = hosted **PostgreSQL** + extras (Auth, Storage, Realtime, auto-generated PostgREST). The frontend reads and writes tables directly with `supabase-js`, and **security is backstopped by RLS in the database**, not by the frontend behaving.

## 2. RLS (row-level security) — the security foundation of the whole project
A table with RLS enabled **denies everything by default**; policies must allow access explicitly. We use a uniform "owner-only" pattern:
```sql
alter table public.X enable row level security;
create policy X_all_own on public.X
  for all to authenticated            -- signed-in users only
  using (user_id = auth.uid())        -- rows that can be read/changed
  with check (user_id = auth.uid());  -- rows that can be written
```
- `auth.uid()` = the user id in the current request's JWT, decoded by Supabase and impossible for the frontend to forge.
- Tables have `user_id uuid not null default auth.uid()`: inserts don't pass user_id, and the database fills in the current user.
- Result: A's queries only ever return A's rows.

> Rule of thumb: **frontend filtering is just UX; real isolation is written in RLS.**

RLS only decides "which rows", not "which columns of the same row". Tables containing balances, roles, statuses, or moderation fields must also use column-level GRANTs, per-command policies, or defensive triggers; `SECURITY DEFINER` functions must pin `search_path` and revoke default client EXECUTE.

## 3. Existing migrations (`supabase/migrations/`)
| File | Contents |
|---|---|
| `0001_profiles.sql` | `profiles` (bound to auth.users) + automatic profile trigger on sign-up + owner-only RLS (see [02](02-auth-and-user-system.md)) |
| `0002_courses_materials.sql` | `courses` / `materials` tables + RLS; private Storage bucket + storage policies (see [06](06-materials.md)) |
| `0003_materials_course_check.sql` | Hardening: materials can only attach to courses you own (the authorization fix in [06](06-materials.md)) |
| `0004_notifications_feedback.sql` | notifications / feedback + owner-only RLS |
| `0005_community.sql` | posts / comments / likes / favorites / follows + counter triggers |
| `0006_points_tags_notify.sql` | points, tags, community media, interaction notifications, and level functions |
| `0007_schedule.sql` | study_goals / study_tasks, streaks, and task-completion triggers |
| `0008_security_points_ledger.sql` | Profile sensitive-column allowlist, internal RPC revocation, stable points business keys, `point_entries`/`point_event_states`, and reversal triggers |
| `0009_reset_legacy_points.sql` | Zeroes the untrusted opening with append-only reversals and rebuilds the Profile points/level projection |
| `0010_verify_security_points_release.sql` | Read-only assertions on Profile write permissions, internal RPCs, opening reversals, and the ledger projection |
| `0011_learning_courses.sql` | Courses content/learning/review/distribution/badges/speech usage, timezone, and TTS cache; clients get read-only access to private data |
| `0012_learning_course_workflows.sql` | Service-role-only atomic save/session/answer/growth/share/market/moderation RPCs |
| `0013_verify_learning_courses_release.sql` | Release assertions on Courses RLS, write permissions/RPCs, and the badge/timezone/owner chain |
| `0014_learning_feedback_flow.sql` | Adding/removing words to the recognition retry pool by the overall read-aloud score threshold, and advancing recognition retry rounds; reaffirms that the scoring RPC is executable only by service-role |
| `0015_learning_performance_offline_audio.sql` | Session revisions, idempotent attempts/first responses, a single-RPC snapshot, read-aloud target validation, and a private TTS generation queue/quota/lease |
| `0016_verify_learning_performance_release.sql` | Asserts 0015's structure, unique constraints, revision trigger, queue RLS/client revocation, and that every new RPC is service-role only |
| `0017_learning_session_intent_resume.sql` | Back-fills a non-null `resume_key`, distinguishes active session intents by course/unit/mode/scope/sorted skills or schedule ID, and replaces `learning_start_session` |
| `0018_verify_learning_audio_review_fix.sql` | Asserts 0017's column/intent unique index/active ordering index, function definitions, and service-role-only permissions |
| `0019_learning_spelling_timer_translation.sql` | Session spelling options, translation judgement facts that store only the answer hash, leases/quotas/idempotent responses, and service-only translation judging and spelling wrapper RPCs; keeps the old signatures for app rollback |
| `0020_verify_learning_spelling_release.sql` | Asserts 0019's columns, judgement-table RLS/client revocation, exact new RPC signatures, and service-role-only grants |
| `0021_learning_spelling_unicode_normalization.sql` | Adds an internal Unicode spelling normalization helper and makes the seven-parameter authoritative attempt RPC apply the same normalization contract to the raw answer and the course `term`; keeps the originally submitted text |
| `0022_verify_learning_spelling_unicode_normalization.sql` | Asserts the semantics for full-width uppercase, Unicode whitespace, apostrophe/hyphen variants, and preserved punctuation, and verifies the helper/seven-parameter RPC allow only the service role |
| `0023_learning_spelling_punctuation_tolerance.sql` | Adds internal punctuation removal/matching helpers and replaces the seven-parameter authoritative spelling judgement with a three-way comparison (original, punctuation removed, punctuation as spaces); does not change the HTTP/attempt/progress contract |
| `0024_verify_learning_spelling_punctuation_tolerance.sql` | Asserts that punctuation-only differences pass, real letter/space errors fail, the RPC really uses the matcher, and the exact permissions of the new helper/attempt |
| `0025_learning_session_cancel.sql` | Adds an owner-only, row-locked, revision-advancing, idempotent cancel-learning-session RPC that keeps historical facts |
| `0026_verify_learning_session_cancel.sql` | Asserts the cancel RPC's owner/concurrency boundaries and exact service-role-only permissions |
| `0027_learning_exam_retry_quota.sql` | Adds exam mode/first-round accuracy facts, end-of-round spelling confirmation and reshuffling, the unit mastery projection after passing an exam, and splits the semantic judgement claim from the real provider quota reservation |
| `0028_verify_learning_exam_retry_quota.sql` | Asserts the exam constraints, `quota_counted`, three groups of triggers, and service-role-only permissions on the exam/round/quota RPCs |
| `0029_learning_pronunciation_exam.sql` | Adds the `spelling/pronunciation` exam types, pre-validation of the current scored question, pronunciation first-round stats/score list/end-of-round confirmation, and per-type mastery writes; keeps 0028's five-parameter spelling start and old round RPCs for app rollback |
| `0030_verify_learning_pronunciation_exam.sql` | Asserts pronunciation exam type persistence, exact integer pass conditions, wrong-word scores, the pronunciation mastery projection, and service-role-only permissions on the new RPCs |
| `0031_learning_exam_history_selection.sql` | Adds custom word sets for reviews/exams, a practice-completed fact for failed exams, private `learning_exam_word_snapshots` and attempt term snapshots, a summary of the latest 100 exams, and a redacted answer-detail RPC; word selection is validated by owner/course/unit/scope |
| `0032_verify_learning_exam_history_selection.sql` | Asserts the selected/history RPCs and snapshot structure exist completely and are service-role only, and that `practiceCompleted` cannot bypass `examPassed` to write mastery |
| `0033_learning_exam_only_mastery.sql` | Adds spelling/pronunciation exam pass timestamps and a dual-fact check constraint; back-fills provable exam facts, clears old review/single-exam mastery, redefines the exam trigger and review progression, and revokes exam facts exactly by term/translations/IPA |
| `0034_verify_learning_exam_only_mastery.sql` | Asserts the dual-exam fields/constraint, the single positive projection, no `learned_at` writes from reviews, edit revocation, snapshot fields, and service-role-only permissions |
| `0035_learning_mastery_projection_guard.sql` | Uses a progress trigger to force `learned_at` to equal exactly the later of the two exam times, and to be null when either fact is missing |
| `0036_verify_learning_mastery_projection_guard.sql` | Verifies existing data, exam/review write paths, the exact projection, and client/helper permissions |
| `0037_learning_translation_voice_input.sql` | Extends `learning_speech_usage.kind=translation_stt` and adds an owner/session/revision/current-word validated, separate quota reservation RPC |
| `0038_verify_learning_translation_voice_input.sql` | Verifies the STT usage structure, function definitions, and that public/anon/authenticated have no execute/table permissions |
| `0039_security_integrity_rate_limit_points_abuse.sql` | Direct-write boundaries for posts/Feedback/Schedule; frozen points daily windows/claims, owner receipts, moderation actions, coordination signals, and HMAC API abuse aggregates; every internal mutation goes through service-only workflows |
| `0040_verify_security_integrity_rate_limit_points_abuse.sql` | Fail-closed verification of 0039's triggers, constraints, column grants, internal table/sequence permissions, and exact RPC roles; any drift aborts the release |

## 4. How migrations are written (aiming to be replayable)
Current SQL uses these patterns to reduce the chance of failure on repeated execution:
- `create table if not exists` / `create index if not exists`
- `drop policy if exists … ; create policy …`
- `create or replace function` / `drop trigger if exists … ; create trigger …`
- `create extension if not exists pgcrypto;` (needed by `gen_random_uuid()`)

## 5. How migrations are applied
### The legacy emergency script (not part of normal releases)
`scripts/db-push.mjs` applies each `.sql` in filename order through the **Supabase Management API**; the target project must be confirmed explicitly:
```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx \
SUPABASE_PROJECT_REF=<explicit dev/staging/approved production ref> \
ALLOW_LEGACY_DB_PUSH=YES \
node scripts/db-push.mjs
```
- The token comes from the Supabase dashboard → Account → Access Tokens (very powerful; **treat it like a password**).
- The existing migrations aim to be replayable, but `create table if not exists` does not fix drifted structures, and repeated execution is not risk-free, transactional, or reversible.

> ⚠️ Pitfall: calling `api.supabase.com/.../database/query` with the default UA gets blocked by Cloudflare (403 / `error code: 1010`). The script **sends a browser UA** to get through.

> ⚠️ `db-push.mjs` has no default ref and requires `ALLOW_LEGACY_DB_PUSH=YES`, but still has no history; the formal process uses the repository `config.toml` and the Supabase CLI, following [database release and rollback](../operations/DATABASE_RELEASE_ROLLBACK.md).

### Manual (fallback): SQL Editor
Without a token: dashboard → SQL Editor → paste the migration → Run. The first version of profiles was applied this way.

## 6. Template for a new table
```sql
create table if not exists public.things (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- business fields
  created_at timestamptz not null default now()
);
alter table public.things enable row level security;
drop policy if exists things_all_own on public.things;
create policy things_all_own on public.things for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```
If the new table references another "user-owned" table through a foreign key, `with check` must **additionally verify that the referenced row also belongs to the user** (otherwise you get the kind of authorization bug fixed by 0003 in [06](06-materials.md)).

Courses shows another pattern: clients may owner-SELECT, but table-level INSERT/UPDATE/DELETE are all revoked; the API derives the user ID from the verified JWT and calls transaction RPCs granted only to service_role. Tables involving progress, points, cross-user distribution, provider quotas, or moderation should prefer this kind of server boundary over copying a `for all` owner policy.

## 7. To improve
- CI already releases through the CLI migration history, completing local rebuild/RLS E2E, dry-run, and an encrypted recovery point before production migrations; the first production enablement still required a manual baseline of the old history.
- Regular staging drills, off-site Storage file backups, database recovery drills, and schema drift alerts are still needed.
- 0011–0013 were released on 2026-07-22, 0014 on 2026-07-23, and 0015–0018 on 2026-07-27 through protected plan/apply. The queue table grants clients no read/write at all, the old answer RPCs are kept during the stability window for app rollback, and the database is still only fixed forward; detailed runs/artifacts/real Azure evidence are in section 8 of the release runbook.
- 0019–0020 obtained read-only plan `30366334157`, encrypted recovery point/apply `30367263486`, and final app release `30374301472` evidence on 2026-07-28. The judgement table grants clients no permissions, and every new RPC is proven both by two-user RLS negative tests and by 0020's exact assertions; production is at 0020.
- 0021–0022 obtained read-only plan `30616030488`, encrypted recovery artifact `8787805291`, protected apply/deploy `30616540480`, and release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` evidence on 2026-07-31. Real throwaway Supabase E2E verified that full-width/half-width all-caps adds no errors or retries, and 0022 asserts the helper/RPC are not client-executable; production is at 0022.
- 0023–0024 were released on 2026-07-31 through PR run `30620350644`, main run `30620879282`, read-only plan `30623522232`, and protected apply/deploy `30624104943`. Recovery artifact `8790816378` was kept before apply; remote history, 0024 self-verification, database lint, and an empty dry-run all passed; production is at 0024.
- 0025–0028 were released on 2026-08-01 through PR run `30705662543`, main run `30705946921`, read-only plan `30706279006`, and protected apply/deploy `30706731292`. Recovery artifact `8820657507` was kept before apply; remote history, 0026/0028 self-verification, database lint, and an empty dry-run all passed; production is at 0028.
- 0029–0034 were released on 2026-08-03 through PR #45 run `30811283164`, main run `30811817461`, read-only plan `30812467085`, and protected apply/deploy `30813047562`. Recovery artifact `8855819351` was kept before apply; remote history, 0030/0032/0034 self-verification, database lint, and an empty dry-run all passed; production is at 0034.
- 0035–0036 were released on 2026-08-04 through PR #47 run `30831319634`, main run `30831964846`, read-only plan `30832581552`, and protected apply/deploy `30833228406`. Recovery artifact `8864033351` was kept before apply; remote history, 0036 self-verification, database lint, and an empty dry-run all passed; production is at 0036.
- 0037–0038 were released on 2026-08-04 through PR #49 run `30904901828`, read-only plan `30906629924`, and protected apply/deploy `30907716733`. Recovery artifact `8892006761` was kept before apply; remote history, 0038 self-verification, database lint, and an empty dry-run all passed; production is at 0038.
- 0039–0040 were released on 2026-08-10 through PR #51/#52, read-only plans `31368447660`/`31372198037`, and protected runs `31369657292`/`31372888441`. The first artifact `9055783205` predates apply, and the final artifact `9057062920` was used for the post-fix review; remote history, self-verification, database lint, an empty dry-run, real Redis, and public readiness all passed; production is at 0040.
- 0008 protects `profiles` points/credits/VIP/level/streak and revokes client EXECUTE on the points/notification helpers. Production 0039–0040 locked down `feedback.status`, post owner/author snapshot/counters/business key/time, and Schedule linked ownership. Notification server fields and other direct PostgREST tables still need ongoing per-table audits.
- The 0052–0053 contract took effect in the production database after observation/go-no-go: 0052 only revokes the compatibility authenticated UPDATE grants on `posts.updated_at`/`study_tasks.done_at`, and 0053 asserts the legitimate columns, service role, and timestamp triggers. The originally reserved 0044–0045 stay unused and were not back-filled into a remote history that had already passed 0051.
- 0008 imported the old `profiles.points` as a recorded `legacy_opening`; on 2026-07-21 a production aggregate audit found a single Profile with 11 points, the owner decided to zero it, and 0009 appended an equal reversal, neither treating the old balance as trustworthy history nor deleting the audit trail.
