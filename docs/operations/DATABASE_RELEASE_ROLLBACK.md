# Database release, failure handling, and recovery

> **Contents:** Defines the process for writing Supabase/PostgreSQL migrations, CI rebuilds, production dry-runs, pre-release recovery points, protected releases, verification, and failure handling.
> **Purpose:** Ensures database failures block application releases, and gives irreversible migrations a real, executable forward-fix or isolated recovery path.
> **When to update:** When the migration tooling, GitHub Actions, Supabase project/plan, backup format, approvers, application deployment topology, or recovery strategy changes; it must be updated after every database incident.

## 1. What can be executed today

The authoritative migration directory is `supabase/migrations/`, and the local Supabase baseline is `supabase/config.toml`. `.github/workflows/deploy.yml` now runs in this order:

1. Docs checks, TypeScript typecheck, default tests, and all workspace builds;
2. Starts a full local Supabase, automatically stages all 0008+ files, first stops at 0007 to build historical points fixtures, then applies up to the latest migration to verify backfills, opening resets, Courses increments, and release assertions; then applies all migrations from an empty database;
3. Runs `db lint`, executes two-user RLS/Storage/points/Courses E2E, then starts the Web/API with Azure/OpenRouter fakes to run the Playwright Courses main flow;
4. If the push added migrations, the quality and local database gates still run, but the production database and application release stay skipped; the database owner must first manually start `workflow_dispatch` on that `main` commit with `plan_database_migrations` selected, check the history/dry-run, and then start another run with `apply_database_migrations` selected;
5. Checks the production Project Ref and shows the remote migration history and `db push --dry-run`;
6. Generates an encrypted roles/schema/data/migration-history recovery point and uploads it successfully;
7. If the remote history is empty, temporarily keeps only the 0001–0007 migrations, and only marks those 7 existing versions as applied after a zero public schema diff and Storage policy/bucket checks; an established remote history must be a contiguous local prefix containing at least 0001–0007;
8. Runs `supabase db push --linked`, then dry-runs again, checks the history, and lints;
9. The application is only built when the manual database job succeeded or this run clearly has no migrations. Before upload, the production host does targeted cleanup of same-SHA/expired incoming items and Nalanda images not referenced by any container or the current `.deploy.env`, and requires at least 6 GiB of free space; otherwise the current application is left untouched.
10. The production host uses its own mode-600 `.env` to first run the real Azure basic TTS/scoring gate and the real OpenRouter structured semantic gate, then on the pending API verifies the durable queue, private Storage, cross-user reuse of duplicate words, scoring on raw WAV bytes with no VAD/silence trimming, and translation judgement idempotency. Since 0037 it must also call real Fish Audio STT with an Azure-synthesized Chinese WAV of the word "apple", verifying owner/revision/word binding and the Chinese transcript before activating the Web release.
11. When any activation gate fails, the EXIT trap clears the failed candidate artifacts; the previous API is restored with `--no-deps` from the immutable image of the previous `.deploy.env`/compose and verified independently, so an unhealthy optional AI can't escalate an application rollback into a public 502.

Production 0039–0040 further require: start Redis with no host port using an independent secret, and verify authenticated PING, AOF `everysec`, `noeviction`, and the private network; API readiness must return both `deps.supabase=ok` and `deps.redis=ok`, and the standard rate-limit headers and unauthenticated points admin 401 must be verified. Redis/nginx can keep running after an application rollback; they don't replace database recovery points or provider gates.

The historical 0037–0038 release plan only showed `20260804000037_learning_translation_voice_input.sql` and `20260804000038_verify_learning_translation_voice_input.sql`. After the recovery point, apply extended `learning_speech_usage.kind` and added a service-role-only reservation RPC; an application rollback can still ignore the new kind/RPC, and the database is forward-fixed only. The release confirmed that ordinary `authenticated` can't execute the RPC/read usage, the pending API's real STT gate passed, and public health showed `deps.supabase=ok`; later releases still must not treat local fake Playwright as real provider evidence.

Modifying, renaming, or deleting an existing migration file fails CI immediately; corrections must add a new forward migration. Changes to migration files or to the database release control workflow/scripts keep ordinary main pushes in a "verify only, don't deploy" state, so fixes to the release tooling can't bypass an unfinished database release. Ordinary pushes never modify the production database directly; `plan_database_migrations` is read-only and doesn't deploy the application, only selecting `apply_database_migrations` on its own creates a recovery point and runs the database release, and selecting both fails.

`scripts/db-push.mjs` is a legacy emergency tool that doesn't maintain migration history, and it now:

- Has the default production Project Ref removed;
- Requires `SUPABASE_PROJECT_REF` to be set explicitly;
- Requires `ALLOW_LEGACY_DB_PUSH=YES`;
- Is no longer part of the normal release path.

## 2. Why the database is never reversed automatically

PostgreSQL schema/data migrations usually have no safe general inverse. An automatic `DROP`, restoring an old dump, or PITR can all overwrite new writes made after the migration, and the database, Auth, Storage metadata, and Storage file bytes are not one recovery surface.

So the current guarantees are:

- Migration fails: don't deploy the new application; keep the old application, assess the partially applied state manually, and forward-fix;
- Migration succeeds but the application fails: automatically roll back to the previous immutable Web/API release, and the database keeps the backward-compatible new schema;
- Data is corrupted: stop writes, first restore the encrypted recovery point into a **new isolated Supabase project** to verify, then decide on a switchover or differential merge with approval;
- CI never automatically restores the production database to an old snapshot.

This requires every migration to follow expand → backfill → switch → contract. Contracts that drop columns, narrow types, or break the old application's contract must be released after a separate maintenance window and observation period.

## 3. Migration file conventions

Naming:

```text
supabase/migrations/<YYYYMMDDHHMMSS>_<short_snake_case_description>.sql
```

Every new migration must state its purpose, dependencies, locks/duration, compatibility window, verification queries, forward-fix, and irreversible points, and must:

- Never edit a migration that has reached a shared environment;
- Separate schema changes from large data backfills; backfills must be batched and re-entrant;
- Enable RLS on new tables with both positive and negative policies;
- Pin `search_path` for `SECURITY DEFINER`, revoke the default EXECUTE from `PUBLIC/anon/authenticated`, and grant only to controlled roles or use only from triggers;
- Give side effects such as points/credits/payments immutable events and unique idempotency keys;
- Review foreign keys, deletion semantics, constraints, and access-path indexes together;
- Never treat `IF NOT EXISTS` as proof against schema drift or of reversibility.

`CREATE INDEX CONCURRENTLY` can't be inside an ordinary transaction block; it must be designed separately, its execution channel verified, and its retry behavior recorded.

## 4. Enabling Supabase CLI migration history for the first time

When production previously had old files applied through the SQL Editor/Management API, CI must not guess the history, and `--include-all` must not be used blindly. The current protected apply runs a one-time baseline automatically through `scripts/prepare-production-migration-baseline.sh`, but only accepts two kinds of remote state: an entirely empty history, or a history that is a contiguous local prefix containing at least the full 0001–0007. A partial baseline, gaps, or unknown remote versions all stop. First enablement must be done in a maintenance window:

1. Create a production recovery point and record the Git SHA, the checksums of all existing migrations, and the production Ref;
2. On a disposable/staging project, apply all of the repository's migrations from an empty database and run the RLS E2E;
3. For an empty history, the script temporarily moves out 0008 and later files and uses `db diff --linked --schema public` to require **zero diff** between the production public schema and 0001–0007; since the CLI schema diff doesn't reliably compare Storage buckets, it separately dumps and checks the 5 Storage policies, the private `materials` bucket, and the public `community-media` bucket;
4. Link production and review the diff:

   ```bash
   SUPABASE_ACCESS_TOKEN=... \
   SUPABASE_DB_PASSWORD=... \
   supabase link --project-ref <production-ref>
   supabase migration list --linked
   supabase db push --linked --dry-run
   ```

5. Only when all of the checks above pass and the encrypted recovery point artifact has been uploaded successfully does the script mark 0001–0007 applied in one go; a single-command example for manual incident handling is:

   ```bash
   supabase migration repair 20260620000001 --status applied
   ```

6. Run `migration list` and `db push --dry-run` again, expecting only the genuinely unreleased new migrations;
7. Save the baseline's history, zero diff, Storage checks, artifact, operator, and Git SHA records; when the plan supports required reviewers, require two-person review.

If the CLI reports a local/remote history mismatch, stop the release and audit; don't bulk repair just to make the job green.

## 5. GitHub environments and Secrets

The repository must have two environments:

- `production-database`: `main` only; plans that support environment reviewers must also require approval from at least one database owner;
- `production`: application release approval can be set according to the team's risk level.

The current private-repository plan doesn't support required reviewers. The existing `production-database` has the `main` branch restriction enabled; until the plan is upgraded, database releases must not be authorized automatically by ordinary pushes; the database owner must first run plan, review the result, then manually start a separate `workflow_dispatch` with `apply_database_migrations=true`, and save the Ref, Git SHA, migration list, dry-run, and reviewer in the release record. The existence of a GitHub Environment is not evidence of approval.

The database environment needs:

| Secret | Purpose |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | CLI project linking; use a dedicated least-privilege release identity |
| `SUPABASE_DB_PASSWORD` | Production database connection; must never be printed to logs |
| `SUPABASE_PROJECT_REF` | Explicit target project; CI cross-checks it against the Web production URL |
| `VITE_SUPABASE_URL` | Only used to confirm the Ref matches the current Web production project |
| `DB_BACKUP_ENCRYPTION_KEY` | AES-256/PBKDF2 encryption of release recovery points; a recovery copy must be stored separately offline |

The application environment's SSH/Web secrets are in the [environment variable matrix](../guides/ENVIRONMENT_VARIABLES.md). Stage one of 0039 also requires independent 64-character hex `REDIS_PASSWORD` and `RATE_LIMIT_HMAC_SECRET`; the workflow only installs them over SSH standard input, the former only goes into the server's `.redis.env`/API Redis URL, and the latter only into the API `.env`. Actions only keeps the encrypted database artifact for 14 days; artifact permissions replace neither cryptographic encryption nor long-term off-site backups.

## 6. Pre-release gates

- [ ] New migration filenames are later than the repository's existing versions, and old files are unchanged.
- [ ] The old application can still read and write on the new schema; contracts are not executed in this release.
- [x] 2026-07-22 Courses release: RLS, Storage policies, function EXECUTE, and trigger idempotency have two-user tests.
- [x] 0008/0009 first production release audit: on 2026-07-21 a read-only aggregate confirmed 1 Profile, points=11, credits=0, streak=0, no VIP; the owner decided to reset points to zero, which 0009 implements as an append-only reversal, leaving credits/VIP/streak unchanged.
- [ ] Estimate table size, locks, statement timeout, and backfill time.
- [x] The 0039 stage-one PR/plan only contains 0039–0040; Stage B later advanced production history to 0053 with the sequentially appended 0052–0053, and the originally reserved 0044–0045 were not back-filled into history.
- [x] Redis/HMAC secrets are installed; compose/nginx config, real Redis Lua, PING/AOF/no-port, 429 JSON/headers, and fail-open/closed are verified.
- [x] The 0039 application was activated at `2026-08-10T09:35:34Z`; the 24-hour observation ended no earlier than `2026-08-11T09:35:34Z`, and the contract go/no-go was completed on 2026-08-22.
- [x] 2026-07-22 Courses release: the [ERD](../guides/ERD.md), [API](../guides/API.md), and product rules are in sync.
- [x] 2026-07-22 Courses release: the owner checked the Ref, Git SHA, 0001–0013 history, and the read-only dry-run; manual plan/apply ran separately.
- [x] 2026-07-22 Courses release: a new encrypted recovery point was created, verified, and kept; the decryption key is still held under control outside Actions.
- [ ] Storage file changes have a separate object backup; database dumps don't contain file bytes.
- [x] 2026-07-22 Courses release: application flags/degradation, verification SQL, rollback to the previous release, and the database forward-fix boundary were prepared and exercised through the workflow.
- [x] Courses release: confirmed the 15 new tables of 0011–0013, `profiles.timezone`, the `vocabulary-audio` bucket, all service-only RPCs, and the nine badge definitions; remote history reached 0013.
- [x] Courses large word list entry: production nginx `/api/ client_max_body_size 10m` is in sync and passed `nginx -t`; the layering of Nest JSON 10 MB and scoring multipart 2 MB is unchanged.
- [x] The Azure key/region are only in the API environment, fake=false; the monthly budget, per-user limits, circuit breaker, and Japan East real synthesis/scoring smoke are confirmed.

## 7. Local and staging verification

Local and CI use the same baseline:

```bash
supabase start
# First run the 0007→latest seed / migration up / assert per the testing guide
supabase db reset --local --no-seed
supabase db lint --local --schema public --level error --fail-on error
```

After getting the local `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY` from `supabase status -o env`, run the upgrade fixtures and `pnpm test:rls` the same way as CI. Full commands are in the [testing guide](../guides/TESTING.md). When done:

```bash
supabase stop --no-backup
```

Beyond empty-database rebuilds, locks, duration, backfills, old-application compatibility, and failure retries must also be rehearsed on staging with near-production-scale data.

### 7.1 Historical value gate for the first 0008 production release

0001–0007 allowed owners to rewrite Profile points, credits, level, VIP, and streak; the repository had no per-entry legacy ledger, so 0008 couldn't automatically tell legitimate values from forged ones. Before applying 0008–0010 to production for the first time, you must:

1. Freeze related writes in the change window, save an encrypted recovery point, and export `id,points,credits,level,level_name,vip_until,streak,streak_date,updated_at` to a restricted audit location;
2. Review non-zero balances, future VIP, and extreme streak/level using the available product rules, release times, access/security logs, and anomaly distributions; don't paste raw user data into PRs/Actions logs;
3. Make a written product/security decision of "keep, reset to zero, restrict entitlement, or notify the user" for each class of values whose origin can't be proven; if values need changing, use separate, reviewed maintenance SQL/forward migrations that record the affected row count, completed before 0008 creates the opening;
4. Save the approver, time, aggregate results, correction script checksum, affected row count, and verification query. If this can't be completed, the `production-database` environment must not be approved.

Production audit and decision record: 2026-07-21, 1 Profile; points=11, credits=0, streak=0, no VIP. The owner decided to reset all legacy points to zero. 0008 still keeps the audit fact `legacy_opening=11`, and 0009 appends `legacy_opening_reset=-11` and rebuilds the Profile projection; the opening is never deleted or rewritten. Credits/VIP/streak are write-locked but still have no commercial fact ledger. Later corrections must design explicit adjustment events/an approval process and must never reopen client write access to Profile.

## 8. Production release and verification

The normal operation is to merge a PR that only adds migrations and let `deploy.yml` run it. Don't run anything manually in the SQL Editor at the same time. The database job should leave:

- The Git SHA, migration list, dry-run, and actual push result;
- The encrypted recovery artifact name and checksum verification result;
- Remote lint and a second dry-run;
- The environment approval record.

After migrating, check at least:

- New tables/columns/constraints/indexes exist;
- RLS, Storage policies, and function grants match expectations;
- Data row counts, NULLs, uniqueness, FK orphans, and backfill progress;
- Trigger retries don't duplicate points/notifications/counts;
- Supabase Auth/PostgREST/Storage error rates;
- Application sign-in, `/api/me`, and the minimal business path of this change.

Courses 0011–0013 must also check: owner reads/client write rejection, anonymous share/market only through the API, publication snapshot updates rejected, four-stage session resuming, mastery on two different local dates, Schedule not creating `study_tasks`, only one +20 entry per word set, course deletion keeping entries/badge history, and `learning_speech_usage` containing no audio or reference text.

0015–0016 must also check: the production plan only lists these two new files; the old five-parameter attempt RPC still works after the database goes first and advances the revision; duplicate UUIDs of the seven-parameter attempt are recorded only once, and concurrent stale revisions return 409; `learning_audio_assets` has no table/RPC permissions for clients; the global queue lease only sends one Azure request at a time; missing Storage objects can be rebuilt and network errors don't masquerade as misses; rolling the application back to the old release still works. The current application gate must use the Japan East real account to prove first-word generation, Storage hits, no increase in attempt_count for another user's identical word, scoring of a fixed WAV with no VAD/silence trimming, and a final `deps.supabase=ok`.

### 0039–0040 Stage A, later Materials AI, and the 0052–0053 revocation gate

Compatible applications must continue to support 0039–0040; 0041–0043 were released as a separate additive Materials AI release, but don't change the time-column grants:

1. Stage A passed 0007→0040, empty database, lint, exact column/table/function grants, two-user RLS, real Redis Lua, nginx/compose, and jsdom/Playwright/build; fake providers were never described as real Azure/OpenRouter/Fish evidence.
2. A separate plan proved production was previously at 0038 with 0039–0040 as the only pending items. Apply ran after creating a recovery point, and checked the posts/Feedback/Schedule triggers, historical claim grandfathering, the ledger/Profile projection, and client/service-role negative permissions; the grandfathered actual amount must be provable from the positive transition-1 entry of that business key, and 0008/0009 zero-amount placeholders must not go negative because of deletion, restore, or moderation. If the data already has such placeholder negative transitions, 0039 only compensates append-only with `grandfather-zero-reset-v1` and must not delete historical entries.
3. Stage A first installed Redis/HMAC, then started Redis and confirmed password PING, AOF, noeviction, a persistent volume, and no host port; the nginx rate zones passed `nginx -t`, and 429s use the standard JSON/headers.
4. The candidate API verified `deps.supabase=ok/deps.redis=ok`, anonymous `/api/me` and points admin 401, sign-up rate-limit headers, and Redis tiered fail-open/closed, and passed the existing three kinds of real provider gates before atomically switching the Web/API.
5. Observe for at least 24 hours from `2026-08-10T09:35:34Z`: Redis errors/restarts/AOF/memory, `rate_limit_degraded`, legitimate requests wrongly getting 429/503, cap claim/ledger/Profile differences, signals only pending review, and any evidence of old clients still submitting `posts.updated_at`/`study_tasks.done_at`. Any anomaly is a no-go: the application restores the previous compatible release, and the database/Redis/nginx stay and are forward-fixed.

2026-08-22 go/no-go record: the compatibility period exceeded 24 hours; neither the deployed release `3c095a55ced21cee11a1b3131dd2889ec1f70733` nor the latest main's Community/Schedule submit the two time fields; production Redis PING/AOF/noeviction are normal, `evicted_keys=0`, `total_error_replies=0`; a redacted database summary showed 2 Profiles, 2 ledger entries, a projection difference of 0, and no signals or API abuse buckets. The sample is very small, so "no hits" is not written up as proof of anti-abuse effectiveness, but together with the code audit it was enough to close the old-client contract gate.

The final revocation was implemented in a new PR in strict append order, and the production database was applied to 0053: 0052 only revokes authenticated's UPDATE column permission on `posts.updated_at` and `study_tasks.done_at`; 0053 asserts the final exact grants, valid content/Schedule writes, the service role, and the time triggers. 0044–0045 remain historically empty numbers, and `--include-all` was not used to back-fill into production history that had already passed 0051. The separate plan, recovery point, apply, RLS/permission, and public smoke evidence are in 8.14.

On 2026-08-23, run `32628757656` first kept an encrypted recovery point, then only applied 0054–0055; remote history, local/remote consistency, a dry-run with nothing pending, and the public schema lint all passed. The application candidate then received OpenRouter HTTP 404 because of the Courses Ox Alpha output contract and automatically restored the previous Web/API; the database didn't go backwards and continues with the 0055 forward-compatible contract. The fix only involves the application/real gates and adds no pointless rollback migration.

#### 0041–0043 Materials AI specific order

1. The plan must only list 0041–0043, not yet applied in production; the 0043 per-table/RLS/grant/RPC/FK assertions must pass on both the empty-database and the 0007-upgrade paths.
2. Apply only after the recovery point is uploaded successfully and stored offline; check that the Free plan backfill count equals the number of Auth users, `reserved+consumed<=limit`, one unique active job per user, and no authenticated EXECUTE on any AI RPC.
3. Deploy the immutable API/AI/Web images, install the isolated `.ai.env`, and keep `FEATURE_MATERIAL_AI=false`. Verify Redis password/AOF/noeviction/private network, FastAPI OpenRouter/LibreOffice/temp disk/internal auth, and the API `/api/health/ai`.
4. Run the near-limit Office canary and the fixed real DeepSeek/MiMo suite; if any ZDR, schema, citation, injection/safe material, cost, OOM, swap, or neighbor-site gate fails, call the application rollback and keep the flag false.
5. Only after the gates pass, atomically turn the flag on, rebuild the API, and use a temporary real signed-in public user to complete upload→job progress→Notes→exam→subjective grading→deletion; confirm quota, provider usage, temporary directories, and cleanup of test users/objects.
6. Database failures are forward-fixed only. An application rollback doesn't delete the 0041–0043 tables; the old application ignores the new tables, and rollback explicitly turns the flag off. Never roll back to a build that would replay jobs/quota as a second consumption.

2026-08-11 actual record: read-only plan `31465816321` confirmed production was at 0043 with an empty dry-run; protected run `31467153739` still first created artifact `9092230348`, then verified history/lint/an empty dry-run. Only after the 220-page canary, real DeepSeek/MiMo, two temporary-directory cleanups, and signed-in user generation/grading/deletion all passed did release `e6ce0cb246d9fc1ecc1c4869b6e63d09d3256bd4-31467153739-1` enable the flag. The earlier green status of `31463661987` never really cut over because the SSH heredoc stdin was consumed by `compose exec`, and independent server/public verification caught the false green; the current workflow prevents recurrence with an explicit `</dev/null` helper and regression tests.

#### 0046–0051 resumable jobs, knowledge graph, lifecycle, and Luna candidate order

This section is the gate for an unreleased candidate, not a production record:

1. That historical release's separate plan must prove the remote was still at 0043 with 0046–0051 as the only pending migrations; the empty 0044–0045 numbers at the time are not drift. Stage B later used 0052–0053 instead and doesn't rewrite this existing release history. 0048 and 0051 must assert tables, constraints, RLS, triggers, and exact RPC signatures/grants on both the 0007→latest and empty-database paths.
2. Apply only after the recovery point is uploaded successfully and decryption/SHA verification is complete. After apply, check that the old 0041–0043 synchronous worker RPCs still exist, the new application can use the 202 callback protocol, and the previous immutable application release can still run while ignoring the new tables.
3. First start the candidate API/AI with `FEATURE_MATERIAL_AI=false`; verify the explicit Undici transport timeout, the internal callback token, the database checkpoint, the worker local checkpoint/usage spool, the TTL sweep, and terminal cleanup. Don't mask unreachability, response-header timeouts, or missing callbacks by uniformly extending every error to 20 minutes.
4. Manually inject an API callback disconnect: terminate the callback after the provider has returned, and confirm the same job/new lease resumes from `artifact_ready` or `answer_ready` without calling the provider again, the event UUID writes only one cost record, and both the DB/local checkpoints are cleared on completion. Then verify that Resume beyond the TTL returns a stable terminal state, releases the reservation, and doesn't revive old artifacts.
5. The real DeepSeek/MiMo gate separately verifies old-pipeline exams and knowledge graphs; keep the Luna sub-switch false and first read OpenRouter's official ZDR catalog. If there is no `openai/gpt-6-luna` + Azure endpoint, record `OPENROUTER_ZDR_UNAVAILABLE`, keep Luna false, and only allow the DocumentIR release that already passed; never turn off ZDR, switch to a non-ZDR provider, or silently degrade. Only once the catalog is compliant, prove format by format with original files containing no personal data that the actual upstream is Azure, PDF `file-parser.native`, inline raw SHA-256 unconverted, strict schema, injection rejection, and no leftovers after cancellation. Formats that haven't passed the gate must not be added to `MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS`. (The rules from the GPT-5.6 Luna/OpenAI-only period are in ADR-0014, revised by ADR-0016.)
6. Verify the job lifecycle: deleting while queued releases the reservation; after the worker accepts, Delete/the old Cancel both consume once; Clear only deletes terminal jobs; deleting stays visible until the task, HTTPX/Office, checkpoint, spool, and 0700 directory are all purged. The usage ledger still exists after the job is hard-deleted, and routing violations are also counted as cost.
7. Finally turn on `FEATURE_MATERIAL_AI` first, then enable/verify Luna only for the private gate user, completing exam/knowledge graph on both pipelines, the 250-node desktop and mobile graph, layout saving, node Q&A, unified grading after whole-paper submission, delete/clear, and same-job Resume. Only after everything passes is `FEATURE_MATERIAL_AI_LUNA=true` made the default, followed by independent checks of the public Web, health, 401, and release/image/Web symlink.
8. The database is still forward-fixed only. On application anomalies, first turn off `FEATURE_MATERIAL_AI_LUNA`, then if necessary turn off the master switch and restore the previous immutable release; the 0046–0051 tables are kept. Never drop checkpoint/layout/usage rows, and never manually change quotas or job states to "roll back".

#### 0054–0055 Ox Alpha appended release (historical; retired by 0056–0057)

1. The read-only plan must show exactly 0054–0055; any other pending migration is a stop rule. Apply is only allowed after recovery point encryption, upload, decryption, and SHA verification are complete.
2. Empty database and 0007→latest must prove that the three pipeline constraints accept `ox_alpha_native_file_v1`, that the create/complete/checkpoint RPCs pin `stealth/ox-alpha` and Stealth usage, and that public/anon/authenticated can't execute the new signatures.
3. Start the candidate with `FEATURE_MATERIAL_AI_OX_ALPHA=false`. When the live ZDR catalog has no Ox/Stealth endpoint, record `OPENROUTER_ZDR_UNAVAILABLE` and keep it off; never turn off ZDR, allow fallback, or treat the Courses text smoke as Materials original-image evidence.
4. If the catalog becomes compliant in the future, only verify format by format with PNG/JPEG/WebP containing no personal data: raw SHA-256, Stealth upstream, mandatory reasoning, strict schema, injection rejection, and checkpoint/cancel/purge. PDF/Office must stay unselectable.
5. The separate Ox translation smoke must prove the pinned `stealth/ox-alpha`'s two-sample judgement, Stealth-only routing, and structured output. When this hard gate fails, don't cut over; an application rollback doesn't undo the already applied 0054–0055, and the database is forward-fixed only.

#### 0056–0057 Ox Alpha retirement and GPT-6 Luna appended release

1. The read-only plan must show exactly 0056–0057; any other pending migration is a stop rule. Apply is only allowed after recovery point encryption, upload, decryption, and SHA verification are complete.
2. 0056 tightens the three pipeline constraints; before apply it was confirmed that production has no `ox_alpha_native_file_v1` job/Note/usage rows (2026-10-03 read-only query: 3 DocumentIR jobs, 2 DocumentIR Notes, 11 DocumentIR usage rows). If Ox rows appear before the plan, stop and forward-fix the data first.
3. Empty database and 0007→latest must prove that the constraints reject Ox, that `ai_create_generation_job` writes `openai/gpt-6-luna` for Luna, that the three completion RPCs require Azure usage and reject OpenAI/Stealth, and that public/anon/authenticated can't execute them. If 0057 fails, the whole apply fails.
4. The RPC signatures are unchanged, so the previous immutable application stays compatible; on application anomalies, only turn off `FEATURE_MATERIAL_AI_LUNA`/the master switch and restore the previous release, and the database is forward-fixed only.

### 8.1 2026-07-21 security and points release record

- Release commit: `271137279aacb42454018d9e1b401ed41f2380b7`; read-only plan: GitHub Actions run `29832166947`; protected apply: run `29832551375`.
- Before apply, the remote migration history was empty. The script confirmed **No schema changes found** between the public schema and 0001–0007, and that the 5 Storage policies and the private `materials`/public `community-media` buckets matched, before marking only 0001–0007 as applied.
- Encrypted recovery point `db-recovery-271137279aacb42454018d9e1b401ed41f2380b7` was uploaded as artifact `8496067281` with GitHub artifact digest `c13e40ecec4270cc31c1b87bccc0b69ec52107bef60a71ad7d3bc8aacc042ff1`, retained for 14 days; the manifest records that the `supabase_migrations` schema didn't exist before the release. This logical recovery point doesn't contain Storage object bytes.
- 0008, 0009, and 0010 were then applied successfully. 0009 keeps `legacy_opening=11` and appends `legacy_opening_reset=-11`; 0010 enforces that the opening has exactly one equal reversal, that all Profile points/level projections equal the ledger, and that sensitive Profile columns and internal RPCs can't be written/executed by clients.
- After the release, local/remote history matched entirely from 0001 to 0010, the second dry-run returned **Remote database is up to date**, and the remote public lint returned **No schema errors found**.
- Application release `271137279aacb42454018d9e1b401ed41f2380b7-29832551375-1` is activated. Both the pipeline and an independent public re-check confirmed the Web root works, `/api/health` has `status=ok`, `service=nalanda-api`, `deps.supabase=ok`, unauthenticated `/api/me` returns 401, and Supabase JWKS is available.

This record proves the security migrations and the reversal of the legacy 11 points are live; it doesn't mean Storage bytes are backed up, hosted staging/recovery drills are done, or points have daily caps and content anti-abuse.

### 8.2 2026-07-22 Courses 0011–0013 release record

- Release commit: `53d0eabf767725b6e9ca83367c0e17c47a479eca`.
- [Read-only plan run `29889201210`](https://github.com/1590703336/Nalanda/actions/runs/29889201210) showed local/remote 0001–0013 matching item by item, and the final dry-run was **Remote database is up to date**.
- [Protected apply/deploy run `29889669272`](https://github.com/1590703336/Nalanda/actions/runs/29889669272) re-passed production image startup, the 0007→0013 upgrade, empty-database rebuild, two-user RLS/Storage/Courses E2E, and Playwright, then created and kept an encrypted recovery point, verified remote history/functions, and released the immutable application.
- The production host injected the Azure configuration from its mode-600 `.env` into the candidate image; real TTS/fixed-WAV scripted assessment with `japaneast`, `en-US-JennyNeural`, fake=false succeeded with accuracy 98, pronunciation 98.8, and 4 phonemes. The key never entered the repository, Actions Secrets, or logs.
- The activated release is `53d0eabf767725b6e9ca83367c0e17c47a479eca-29889669272-1`, with the API image at the same SHA; both local and public `/api/health` require `deps.supabase=ok`, unauthenticated `/api/me` and private Courses return 401, and the public Course Market returns 200.
- The Courses, sharing, free market, and pronunciation flags are on; the production nginx 10 MB course JSON limit is verified. File AI import and the other three course categories are still disabled.

Later releases keep the same failure boundary: turn off the narrowest flag; restore the previous application release; never run down/drop on the database, only add forward-fixes.

### 8.3 2026-07-23 Courses 0014 release record

- Release commit: `02ba1b682c104947aa0b80707c143b8e921870f0`.
- [Read-only plan run `29939798432`](https://github.com/1590703336/Nalanda/actions/runs/29939798432) showed remote 0001–0013 matching local, with `20260723000014_learning_feedback_flow.sql` as the only pending migration; all recovery point, apply, and deploy steps were skipped.
- [Protected apply/deploy run `29940292716`](https://github.com/1590703336/Nalanda/actions/runs/29940292716) first re-passed 0007→0014, empty-database rebuild, database lint, real RLS/Storage, and Courses Playwright, then created the 14-day encrypted recovery point artifact `8538123165` and applied 0014.
- After migrating, local/remote history were both at 0014, and the remote dry-run and lint passed; the real Azure gate, API Supabase readiness, the auth guard, and public Web/API smoke passed, and release `02ba1b682c104947aa0b80707c143b8e921870f0-29940292716-1` activated healthily.
- Database rollback continues to allow forward-fix only; application problems restore the previous immutable release, and speech problems first turn off `FEATURE_PRONUNCIATION_ENABLED`.

### 8.4 2026-07-27 Courses 0015–0016 release record

- Release commit: `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2`; PR #21 run `30243998633` and main run `30244402278` passed quality, 0007→0016, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Playwright uses the Azure fake and only proves browser/API/one-off database collaboration.
- [Read-only plan run `30244967669`](https://github.com/1590703336/Nalanda/actions/runs/30244967669) showed remote 0001–0014 matching local, and the dry-run only listed `20260727000015_learning_performance_offline_audio.sql` and `20260727000016_verify_learning_performance_release.sql`; the recovery, apply, and deploy steps were all skipped.
- [Protected apply/deploy run `30245430630`](https://github.com/1590703336/Nalanda/actions/runs/30245430630) created and kept encrypted recovery point `db-recovery-6b6de0e985ad8b34c977f1bce3ba985b84eb82f2` before apply: artifact `8644999285`, digest `sha256:09c37ba8755b1ffd95bea061fa5da49d961a85f3dd2d2694253cf16c4a6a10a7`, retained until 2026-08-10.
- After apply, local/remote history were both at 0016, and the new structure/function permission assertions, remote lint, and an empty dry-run passed. The database continues to allow forward-fix only; the old answer signature is kept temporarily for compatible application rollback.
- Before cutover, the basic real Azure gate with `japaneast`/`en-US-JennyNeural` returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8, and 4 phonemes. The new API's real gate then verified 4 first-generated objects, private Storage reads, a second user reusing the same 4 objects without extra Azure generation, and a VAD-trimmed score of 97; user recordings were never stored or put in Storage.
- Immutable release `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2-30245430630-1` activated healthily. An independent public re-check confirmed Web `200`, `/api/health` `status=ok` with `deps.supabase=ok`, and anonymous `/api/me` `401 UNAUTHENTICATED`.
- `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED` and the defaults of 20 per minute, 500,000 characters per month, a 3.1-second interval, and synthesis version 1 are enabled in the mode-600 production `.env`. If the queue or provider misbehaves later, first turn off the narrowest flag/trip the speech circuit breaker or restore the previous immutable application release; the 0015–0016 schema is not reversed.

### 8.5 2026-07-27 Courses 0017–0018 release record

- Release commit: `99313bd3763ce5bf1f7ffb252f821f7b21a67eec`; PR #24 run `30263277807` and main run `30263794368` passed quality, 0007→0018, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Browser regressions verified the historical eight-word cold unit, pending priority boosts/ready cache replacement for the first five words, and that pausing initial learning and reviewing other units don't hijack each other; Azure is a fake.
- [Read-only plan run `30264327821`](https://github.com/1590703336/Nalanda/actions/runs/30264327821) showed remote 0001–0016 matching local, and the dry-run only listed `20260727000017_learning_session_intent_resume.sql` and `20260727000018_verify_learning_audio_review_fix.sql`; the recovery, apply, and deploy steps were all skipped.
- [Protected apply/deploy run `30264979509`](https://github.com/1590703336/Nalanda/actions/runs/30264979509) created and kept encrypted recovery point `db-recovery-99313bd3763ce5bf1f7ffb252f821f7b21a67eec` before apply: artifact `8652623403`, digest `sha256:22861e8f8ccba2d87fc673f468c75677d6df3a0e9d424111c66dc67d009d5ac3`.
- After apply, local/remote history were both at 0018, the remote dry-run was empty, database lint had no errors, and the assertions on `learning_start_session`'s client execute permission and the new intent unique index passed. The database is still forward-fixed only; 0017 is compatible with the old application and is not rolled back with a down migration.
- Before cutover, the basic real Azure gate with `japaneast`/`en-US-JennyNeural` returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; the real queue/Storage/scoring gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, `trimmedAssessmentBytes=65324`.
- Immutable release `99313bd3763ce5bf1f7ffb252f821f7b21a67eec-30264979509-1` activated healthily. Independent public and server re-checks confirmed Web `200`, `/api/health` `status=ok` with `deps.supabase=ok`, anonymous `/api/me` `401`, and that the Web symlink and API image both point to the same release SHA.

### 8.6 2026-07-28 Courses 0019–0020 release record

- PRs #26–#29 completed the feature and forward fixes for the production gate; the final release commit is `a4c230e1aa6f29abbd4fbe944a1b76c625107003`. PR/main CI covered quality, 0007→0020, empty-database rebuild/database lint, real local two-user RLS/Storage E2E, and Chromium Playwright; browser providers are fakes.
- [Read-only plan run `30366334157`](https://github.com/1590703336/Nalanda/actions/runs/30366334157) showed production 0001–0018 matching local, with `20260728000019_learning_spelling_timer_translation.sql` and `20260728000020_verify_learning_spelling_release.sql` as the only pending items; no recovery point was created, the database wasn't written, and the application wasn't deployed.
- [Protected run `30367263486`](https://github.com/1590703336/Nalanda/actions/runs/30367263486) created and kept encrypted recovery point `db-recovery-7c8b516ec4fc9086a6bae816966cb7f688c19746` before apply: artifact `8691620673`, 318,626 bytes; after apply, remote history reached 0020, and lint and the dry-run passed. 0019 keeps the old signature for application rollback; the database is forward-fixed only.
- The first candidate of the same run, and later runs `30370419397` and `30372651419`, were stopped by gates for the real provider contract, the model misjudging an exact-match synthetic answer, and the replay mapping respectively, and each automatically restored the previous Web/API without reversing the database. A real 12-second OpenRouter timeout in final main run `30374301472` also didn't activate the candidate, after which only the failed deploy job was rerun.
- Finally, real Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; real OpenRouter returned 1,365 ms and 253/27/280 tokens; the candidate API returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, and a query of the judgement facts confirmed provider/model `nalanda-normalized-exact/normalized-exact-v1`, 0 tokens, same-UUID replay true, revision 1.
- Immutable release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3` activated healthily. An independent public re-check confirmed `deps.supabase=ok` from `/api/health`, anonymous `/api/me=401`, and the React root; the production migration history stays at 0020.

### 8.7 2026-07-31 Courses 0021–0022 release record

- Release commit: `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad`; PR #35 run `30615023445`, main run `30615555388`, and protected run `30616540480` passed quality, 0007→0022, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Real database cases verified that full-width/half-width all caps add no errors or retries; Playwright's external providers are still fakes.
- [Read-only plan run `30616030488`](https://github.com/1590703336/Nalanda/actions/runs/30616030488) showed production 0001–0020 matching local, with 0021–0022 as the only pending items; the recovery, apply, and deploy steps were all skipped.
- [Protected apply/deploy run `30616540480`](https://github.com/1590703336/Nalanda/actions/runs/30616540480) created and kept `db-recovery-fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad` before apply: artifact `8787805291`, 362,385 bytes, digest `sha256:fd553ea9c4898d72928db64bcbd979e13dff50f6b50a2138ec7113958709c199`, retained until 2026-08-14.
- After apply, remote history reached 0022, and the 0022 function result/permission assertions, remote database lint, and an empty dry-run all passed. 0021 keeps the old five-parameter answer signature and HTTP contract for application rollback; the database still uses forward-fix only.
- Before activation, real Japan East Azure, real OpenRouter, and the candidate Courses API/Storage gates all passed. Immutable release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` activated healthily; an independent public re-check confirmed `deps.supabase=ok` from `/api/health`, anonymous `/api/me=401`, and the React root. No real user session was used to submit answers in production, so this record can't be described as production user-flow E2E.

### 8.8 2026-07-31 Courses 0023–0024 release record

- Release commit: `9b62951a8895aa6cf3ff0f9dce8395df239e6089`; PR #37 run `30620350644`, main run `30620879282`, and protected run `30624104943` passed quality, 0007→0024, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Real database cases verified that punctuation-only differences add no errors or retries; Playwright's external providers are still fakes.
- [Read-only plan run `30623522232`](https://github.com/1590703336/Nalanda/actions/runs/30623522232) showed production 0001–0022 matching local, with 0023–0024 as the only pending items; the recovery, apply, and deploy steps were all skipped.
- [Protected apply/deploy run `30624104943`](https://github.com/1590703336/Nalanda/actions/runs/30624104943) created and kept `db-recovery-9b62951a8895aa6cf3ff0f9dce8395df239e6089` before apply: artifact `8790816378`, 366,417 bytes, digest `sha256:887b1ac42c267ca7bb1cde810920702dde64f8d74112b3b39def6254d5bf0fca`, retained until 2026-08-14.
- After apply, remote history reached 0024, and the 0024 result/function definition/permission assertions, remote database lint, and an empty dry-run all passed. 0023 keeps the old five-parameter answer signature and HTTP contract for application rollback; the database still uses forward-fix only.
- Before activation, real Japan East Azure, real OpenRouter, and the candidate Courses API/Storage gates all passed. Immutable release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1` activated healthily; an independent public re-check confirmed `deps.supabase=ok` from `/api/health`, anonymous `/api/me=401`, and the React root. No real user session was used to submit answers in production, so this record can't be described as production user-flow E2E.

### 8.9 2026-08-01 Courses 0025–0028 release record

- Release commit: `93354a56044470fb5d2b1fd6aeabcf82f459bb52`; PR #40 run `30705662543`, main run `30705946921`, and protected run `30706731292` passed quality, 0007→0028, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Browser external providers are still fakes.
- [Read-only plan run `30706279006`](https://github.com/1590703336/Nalanda/actions/runs/30706279006) showed production 0001–0024 matching local, with `20260801000025_learning_session_cancel.sql`, `20260801000026_verify_learning_session_cancel.sql`, `20260801000027_learning_exam_retry_quota.sql`, and `20260801000028_verify_learning_exam_retry_quota.sql` as the only pending items; the recovery, apply, and deploy steps were all skipped.
- [Protected apply/deploy run `30706731292`](https://github.com/1590703336/Nalanda/actions/runs/30706731292) created and kept `db-recovery-93354a56044470fb5d2b1fd6aeabcf82f459bb52` before apply: artifact `8820657507`, about 418 KB, digest `sha256:02ea6fef5481756b17f79fbbd82c023d9c9ba085accfc1e28f9a268d24645ad9`, retained for 14 days.
- After apply, remote history reached 0028, and the 0026/0028 structure, function definition, and service-role-only permission assertions, remote database lint, and an empty dry-run all passed. 0025–0028 are backward compatible with the released application; the database still uses forward-fix only and never runs down migrations.
- Before activation, real Japan East Azure, real OpenRouter, and the candidate Courses API/Storage gates all passed. Immutable release `93354a56044470fb5d2b1fd6aeabcf82f459bb52-30706731292-1` activated healthily; an independent public re-check confirmed `deps.supabase=ok` from `/api/health`, anonymous `/api/me=401`, and the React root. The authenticated UI check only opened the exam configuration without submitting answers, so it can't be claimed as real production exam E2E.

### 8.10 2026-08-03 Courses 0029–0034 release record

- Release commit: `1a58d2164f6d58feea4d3a2c8925211b8cc60dde`; PR [#45](https://github.com/1590703336/Nalanda/pull/45) run `30811283164`, main run `30811817461`, and protected run `30813047562` passed quality, 0007→0034, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Real database cases verified that neither reviews nor a single exam make a word learned, and that it's learned only when both the spelling and pronunciation exam facts exist; Playwright's external providers are still fakes.
- [Read-only plan run `30812467085`](https://github.com/1590703336/Nalanda/actions/runs/30812467085) showed production 0001–0028 matching local, with `20260803000029_learning_pronunciation_exam.sql` through `20260803000034_verify_learning_exam_only_mastery.sql` as the only pending items; the recovery, apply, and deploy steps were all skipped.
- [Protected apply/deploy run `30813047562`](https://github.com/1590703336/Nalanda/actions/runs/30813047562) created and kept `db-recovery-1a58d2164f6d58feea4d3a2c8925211b8cc60dde` before apply: artifact `8855819351`, 593,399 bytes, digest `sha256:5f36f770aab133f24e12d461e66b0c4b744303ca1dbfd1600215163e4ad14796`, retained for 14 days.
- After apply, remote history reached 0034, and the 0030/0032/0034 field, constraint, function definition, and service-role-only permission assertions, remote database lint, and an empty dry-run all passed. 0029–0034 keep the necessary old signatures for application rollback; the database still uses forward-fix only and never runs down migrations.
- Before activation, real Japan East Azure, real OpenRouter, and the Courses API/Storage gates all passed. Immutable release `1a58d2164f6d58feea4d3a2c8925211b8cc60dde-30813047562-1` activated healthily; an independent public re-check confirmed `deps.supabase=ok` from `/api/health`, anonymous `/api/me=401`, the React root, and Course Market 200. No real user session was used to submit full spelling/pronunciation exams in production, so it can't be claimed as production user exam-flow E2E.

### 8.11 2026-08-04 Courses 0035–0036 release record

- Release commit: `51252527645d9438df0414f056c8a3b088b360d8`; PR [#47](https://github.com/1590703336/Nalanda/pull/47) run `30831319634`, main run `30831964846`, and protected run `30833228406` passed quality, 0007→0036, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Real database cases verified that manual assignment, reviews, and a single exam can't bypass the exact projection; Playwright's external providers are still fakes.
- [Read-only plan run `30832581552`](https://github.com/1590703336/Nalanda/actions/runs/30832581552) showed production 0001–0034 matching local, with `20260803000035_learning_mastery_projection_guard.sql` and `20260803000036_verify_learning_mastery_projection_guard.sql` as the only pending items; the recovery, apply, and deploy steps were all skipped.
- [Protected apply/deploy run `30833228406`](https://github.com/1590703336/Nalanda/actions/runs/30833228406) created and kept `db-recovery-51252527645d9438df0414f056c8a3b088b360d8` before apply: artifact `8864033351`, 657,467 bytes, digest `sha256:36a9ec08516dff5cb198511d71b69bb63533727cad9826db050dff4a33025625`, retained until 2026-08-17.
- After apply, remote history reached 0036, and the 0036 assertions on current data, constraints, triggers, exam/review write paths, client progress permissions, and service-role helpers, plus remote database lint and an empty dry-run, all passed. The database still uses forward-fix only and never runs down migrations.
- Before activation, real Japan East Azure, real OpenRouter, and the Courses API/Storage gates all passed; the latter verified the untrimmed WAV `assessmentBytes=88444`. Immutable release `51252527645d9438df0414f056c8a3b088b360d8-30833228406-1` activated healthily; an independent public re-check confirmed `deps.supabase=ok` from `/api/health`, anonymous `/api/me=401`, the new React assets, and Course Market 200. No real user session was used to submit full spelling/pronunciation exams in production, so it can't be claimed as production user exam-flow E2E.

### 8.12 2026-08-04 Courses 0037–0038 release record

- Release commit: `66c919833693971ba1bda4ea33a3fdf6717ef1ca`; PR [#49](https://github.com/1590703336/Nalanda/pull/49) run `30904901828` passed quality, 0007→0038, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Playwright's Azure/OpenRouter/Fish Audio are still fakes.
- [Read-only plan run `30906629924`](https://github.com/1590703336/Nalanda/actions/runs/30906629924) first received a transient upstream error at the first course RPC of the one-off Supabase; after rerunning only the failed job on the same SHA, real RLS/Storage and the dependent plan all passed. In the end remote 0001–0036 matched local, and the dry-run listed exactly 0037–0038; the recovery, apply, and deploy steps were all skipped.
- [Protected apply/deploy run `30907716733`](https://github.com/1590703336/Nalanda/actions/runs/30907716733) created and kept `db-recovery-66c919833693971ba1bda4ea33a3fdf6717ef1ca` before apply: artifact `8892006761`, 730,159 bytes. After apply, remote history reached 0038, and the structure/permission assertions, remote database lint, and an empty dry-run all passed; the database still uses forward-fix only.
- Before activation, real Japan East Azure, real OpenRouter structured, the Courses API/Storage, and Azure Chinese WAV→Fish Audio gates all passed; the STT gate returned `transcriptionMatched=true`. Immutable release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1` activated healthily. An independent public re-check confirmed `deps.supabase=ok` from `/api/health`, anonymous `/api/me=401`, and the new React assets; a read-only check on the production host confirmed `/opt/nalanda/web` and the API image both point to the same SHA. The synthetic Chinese WAV only proves the fixed sample and that the provider worked at the time; it isn't physical-microphone or multi-accent E2E.

### 8.13 2026-08-10 security/rate-limit 0039–0040 Stage A release record

- Release code: PR [#51](https://github.com/1590703336/Nalanda/pull/51), main merge `eb3c5a909a523f59d748a6ce01d4bd4f3abf909d`; deploy stdin fix: PR [#52](https://github.com/1590703336/Nalanda/pull/52), main merge `56100e6bc2a4c70aa289aaad4b43efa1267428bd`. The corresponding PR/main jobs all passed quality, real Redis, 0007→0040, empty database/lint, two-user RLS/Storage, and Chromium Playwright.
- [Plan run `31368447660`](https://github.com/1590703336/Nalanda/actions/runs/31368447660) listed exactly 0039–0040. [Apply run `31369657292`](https://github.com/1590703336/Nalanda/actions/runs/31369657292) kept encrypted recovery artifact `9055783205` (777,902 bytes, digest `6c06bc011b3d0dc436b9722b66206e6f7a12bd2ecf083f2266cbb6b529c4112f`) before writing to the database, after which remote history reached 0040, and the 0040 structure/permission assertions, lint, and an empty dry-run passed.
- That apply run's Redis `docker compose exec` didn't detach stdin and consumed the remaining SSH heredoc; the job was wrongly marked green without running the provider, API, or public activation steps. Independent public health showed the old API's `deps.redis=unset`, so the run was not counted as an application release. PR #52 added `</dev/null`, an explicit success marker, and workflow regression tests, and work only continued after main CI `31371608883` passed.
- The post-fix [plan run `31372198037`](https://github.com/1590703336/Nalanda/actions/runs/31372198037) confirmed local/remote were both at 0040 with nothing pending. [Final protected run `31372888441`](https://github.com/1590703336/Nalanda/actions/runs/31372888441) kept another artifact `9057062920` (800,819 bytes, zip digest `81820da75dc4f0591ffd6f73ba3ac175a5b04f6995af8f8c508f60e56379a2f4`) and verified history/lint/an empty dry-run again.
- Before the application cutover it passed, in order, Redis password PING, AOF, noeviction, no host port, nginx `-t`, real Japan East Azure (10,656-byte MP3, accuracy 98, pronunciation 98.8), real OpenRouter Gemma (5,524 ms, 253/27/280 tokens), and the Courses API/Storage/Fish gate (`generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=98.2`, `assessmentBytes=88444`, `transcriptionMatched=true`). One 12-second OpenRouter timeout and three free-route 429s were all blocked before cutover; it only succeeded after the same credential's quota status was normal and the same request from the local machine/production host returned HTTP 200 again, without switching models or bypassing real gates.
- Immutable release `56100e6bc2a4c70aa289aaad4b43efa1267428bd-31372888441-5` activated healthily at `2026-08-10T09:35:34Z`. Public re-check: health `deps.supabase=ok/deps.redis=ok`, anonymous `/api/me` and `/api/admin/points/abuse-signals` are 401, an empty sign-up is 400 with `RateLimit-Limit: 5`, and Web/Course Market are 200; the host's Web symlink and API image point to the same release, and Redis is healthy and only exposes the in-container `6379/tcp`.
- The earliest end of the Stage B observation was `2026-08-11T09:35:34Z`, and the actual go/no-go was completed on 2026-08-22. 0052–0053 were then applied after full CI, a read-only plan listing exactly the two files, and a successful recovery point upload; production history, an empty dry-run, and lint were verified at 0053.

### 8.14 2026-08-22 security Stage B 0052–0053 release record

- PR [#72](https://github.com/1590703336/Nalanda/pull/72) was merged as `4d1bc97888799417641fefdd507c026b274a2bab`. PR run `32579985463` and main run `32580594918` both passed quality, real CI Redis, 0007→0053, empty database/lint, two-user RLS/Storage, Chromium Playwright, and production image startup; the main push correctly kept the database/application skipped because of the migration change.
- [Plan run `32581192318`](https://github.com/1590703336/Nalanda/actions/runs/32581192318) confirmed read-only that the remote was at 0051 with 0052–0053 as the only pending items. [Protected run `32581805613`](https://github.com/1590703336/Nalanda/actions/runs/32581805613) uploaded artifact [`9478168126`](https://github.com/1590703336/Nalanda/actions/runs/32581805613/artifacts/9478168126) before writing to the database: 885,857 bytes, digest `0e4425b7098b4b352b5a7f6e81e87861d9c98b535970f9f20592641653a41274`, 14-day retention; the database dump doesn't contain Storage object bytes.
- Apply only ran `20260822000052_security_integrity_time_column_contract.sql` and `20260822000053_verify_security_integrity_time_column_contract.sql`. The final remote migration list had local/remote both at 0053, the dry-run returned `Remote database is up to date`, and the public schema lint job succeeded; 0053's fail-closed assertions guarantee authenticated has lost UPDATE on the two derived columns while the valid business columns and service-role/triggers are kept.
- The same run's immutable application attempts 1/2 both returned `AI_EXAM_VALIDATION_FAILED` at the real Materials AI PPTX gate, stopping at the post-repair citation gate and the semantic gate respectively; both restored `3c095a55ced21cee11a1b3131dd2889ec1f70733` before the public cutover. Independent public health showed Supabase/Redis ok, AI worker/queue ok, and anonymous me 401, and the server's Web symlink/API/AI images also pointed to the old stable release. The database stays at 0053 per forward-fix; an application failure can't roll back or fake the database contract, and can't be recorded as the latest main being deployed.

## 9. Failure handling

### 9.1 Local rebuild, lint, or RLS E2E fails

The production database and application are unchanged. Fix the new migration or tests; skipping the job is forbidden.

### 9.2 Dry-run or pre-release backup fails

The production database hasn't changed yet, and the application isn't deployed. Resolve the history, connection, dump, or encryption problem and get approval again. Bypassing by removing the backup step is forbidden.

### 9.3 `db push` fails partway

1. Don't rerun automatically, and don't run guessed down SQL;
2. Save the last successful version, the failing SQL, and the redacted error;
3. Use `migration list` and read-only queries to confirm the actual partially applied state;
4. Keep the old application and, if necessary, close the related new write entry points;
5. Reproduce on staging and add a forward-fix migration;
6. Only enter the isolated recovery process when data is confirmed corrupted and a forward-fix isn't enough.

Individual migrations usually run in a transaction, but concurrent indexes, external side effects, or multi-migration batches mean the whole can't be assumed atomic.

### 9.4 Database succeeds, application fails

The server automatically rolls back using the previous running container's image tag and the previous Web symlink, and re-verifies the old API. The database keeps the new schema, so new migrations must be backward compatible. After a workflow failure, external sites, old business paths, and database metrics still need manual confirmation.

If the failure only affects Courses/Azure/sharing/market, first turn off the narrowest sub-flag; never reopen client table write permissions or internal RPC EXECUTE just to restore an entry point.

### 9.5 Data corruption

Stop the affected writes, download the corresponding `db-recovery-<git-sha>` artifact, and first verify it in a secure terminal:

```bash
BACKUP_ARCHIVE=/secure/path/nalanda-db-<sha>.tar.gz.enc \
BACKUP_ENCRYPTION_KEY=... \
bash scripts/restore-db-release.sh verify
```

Then restore into a new isolated project per [Backup and recovery](./BACKUP_RECOVERY.md). The script refuses a target Ref equal to the source project Ref, and refuses targets that already have public tables/Auth users/Storage objects. Don't switch traffic until verification is complete.

## 10. Recovery and switchover principles

Priority: keep the old application → feature flags/stop new writes → forward-fix → isolated recovery and differential replay → approved switchover. Only rehearsed down migrations with no data loss and controllable locks may run against production; CI currently provides no automatic down.

The logical recovery point contains roles, the application schema, Auth/Storage metadata/business data, and migration history, but **not Storage object bytes**. A full recovery must also cover the object manifest/backups, Auth, email/provider configuration, URLs/keys, RLS, and application verification. New writes after the recovery point need to be audited and replayed; they must never be silently overwritten by an old snapshot.

## 11. Minimum fields of a release record

- PR/ticket, Git SHA, new migration files and checksums;
- Environment, redacted Project Ref, operator/reviewer;
- Baseline/history state, dry-run;
- Recovery artifact, Storage recovery point, and verification results;
- Start/end times and each migration's status;
- Data/RLS/API/E2E verification;
- Links to application rollback, forward-fix, recovery, or incidents.

Records must never contain access tokens, database passwords, service-role keys, backup encryption keys, or user tokens.
