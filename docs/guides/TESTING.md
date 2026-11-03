# Executable testing guide

> **Contents:** Describes the current test layers, exact commands, fixture/environment requirements, safety guardrails for the real Supabase RLS E2E, CI coverage, and how to troubleshoot failures.  
> **Purpose:** Lets developers and release operators rerun the same verification and understand precisely the boundaries between "jsdom integration tests", "real RLS E2E", and "browser end-to-end".  
> **When to update:** In the same commit as the test code, whenever the test runner, scripts, test files, fixtures, environment variables, CI gates, covered modules, external dependencies, or test data cleanup change.

## 1. Current test capabilities

| Layer | Current implementation | Calls external services? | Authoritative command |
|---|---|---:|---|
| Docs contract | `scripts/check-docs.mjs` checks the opening fields and relative links of every Markdown file | No | `node scripts/check-docs.mjs` |
| TypeScript static checks | `tsc` tasks for Web/API/types | No | `pnpm typecheck` |
| Build | Turbo builds types/API/Web | No (Web variables can be empty, but features are incomplete) | `pnpm build` |
| Web jsdom integration | Vitest + jsdom + in-memory Supabase mock, covering the legacy shell and main module interactions | No | `pnpm test` |
| Supabase RLS E2E | Vitest node environment, two real users calling actual Auth/PostgREST/Storage (local stack or hosted test project) | Depends on the URL; always writes/deletes data | `pnpm test:rls` |
| Data migration upgrade fixture | A Node script first creates historical data at 0007, then applies all automatically discovered 0008+ migrations and verifies backfills, reversals, resets, and the latest release assertions; localhost only | Local Docker | See 5.5 |
| Release tooling units | Node's built-in test verifies production migration history/recovery point branches, Storage policies, schema diff, the global audio cache key, the OpenRouter structured smoke request, and the server env install script | No | `pnpm test:release` |
| NestJS/API units | Vitest covers readiness/JWT, Courses validation/owner/distribution transactions, snapshot/attempt patches, the Azure adapter/queue/quotas, translation grading and the Fish Audio STT endpoint/body, Chinese prompts, WAV/revision validation, quota, timeout/invalid responses, and persistence without content | No (fetch/DB fakes) | `pnpm --filter @nalanda/api test` |
| Redis integration | Real Redis 7.4 verifies Lua sliding-window concurrent atomicity, expiry, and token locks; without explicit opt-in only these two are skipped, and it must not be called Redis E2E | Local/CI Redis | `RUN_REDIS_E2E=true REDIS_URL=redis://127.0.0.1:6379/15 RATE_LIMIT_HMAC_SECRET=<32+ bytes> pnpm --filter @nalanda/api test` |
| Azure Speech provider smoke | The basic script uses a fixture with no personal data to verify MP3/PCM TTS and scripted assessment; the production gate additionally verifies, through the real API, the durable queue, private Storage, cross-user duplicate words, and scoring on raw WAV bytes with no VAD/silence trimming; both reject fakes | Yes, a few Azure/Supabase writes | Basic: `node --env-file=apps/api/.env scripts/smoke-azure-speech.mjs`; the full gate only runs in the protected release |
| OpenRouter provider smoke | The text script verifies the free Nemotron's JSON Object semantic grading, Nvidia-only routing, and the strict local schema; the STT direct script uses an Azure-synthesized Chinese WAV of the word "apple" to verify the Fish Audio wire contract; the production gate then verifies the boundary through the real Nalanda owner/session API. All reject fakes and never print content/keys/full responses; non-2xx only prints the status, structured code, and request ID | Yes, a few Azure/OpenRouter requests | Text: `node --env-file=apps/api/.env scripts/smoke-openrouter-translation.mjs`; STT wire: `node --env-file=apps/api/.env scripts/smoke-openrouter-transcription.mjs`; the full gate only runs in the protected release |
| FastAPI automated tests | ruff + pytest cover DocumentIR, Luna/Ox raw bytes, provider locks, reasoning, injection, schema, checkpoint/cancel/purge, and internal auth | No; provider fakes | `cd apps/ai && .venv/bin/ruff check app tests && .venv/bin/pytest -q` |
| Real browser E2E | Playwright Chromium starts real Vite/Nest/FastAPI and runs, against a one-off Supabase + real Redis + provider fakes, Courses plus Materials→three-pipeline capability matrix→250-node graph→job delete/clear history→whole-paper exam | Local Docker; provider fakes | `pnpm --filter @nalanda/web test:playwright` (needs the environment in section 6) |

Important terms: `apps/web/src/**/*.test.ts(x)` are **jsdom module integration tests** and never really enforce RLS; API units use fake DB/fetch; only the two tests enabled by `RUN_REDIS_E2E=true` connect to real Redis; `rls.e2e.test.ts` is **real Supabase data-layer E2E** but doesn't go through Nest; only `courses.spec.ts` goes through the browser, Vite, Nest, local Supabase, and real Redis, but Azure/OpenRouter are both fakes. Real provider smokes prove the current key/model/endpoint/structured response, not the database/RLS/UI. No single layer alone can prove the full product works.

## 2. First-time setup

```bash
corepack enable
corepack prepare pnpm@9.12.3 --activate
pnpm install --frozen-lockfile
```

Requires Node.js `>=20`. Ordinary jsdom tests need no `.env`, Supabase, API, AI, Redis, or Docker. Real Supabase tests on Node 20 explicitly use `ws` as the WebSocket adapter for the test runtime: the Supabase client initializes Realtime even when it only calls Auth/PostgREST; don't remove `apps/web`'s direct `ws` dev dependency or switch to relying on a transitive one.

## 3. Everyday local verification

Minimal pre-commit sequence:

```bash
node scripts/check-docs.mjs
pnpm typecheck
pnpm test:release
pnpm test
pnpm build
```

Run only the Web tests:

```bash
pnpm --filter @nalanda/web test
```

Watch mode:

```bash
pnpm --filter @nalanda/web test:watch
```

Run a single file:

```bash
pnpm --filter @nalanda/web exec vitest run src/legacy/community.test.ts
```

The root `pnpm lint` currently runs strict TypeScript static checks (including unused declarations/parameters and switch fallthrough); it isn't ESLint and doesn't replace the normal typecheck/test. There is currently no coverage threshold/report script.

## 4. jsdom integration tests

Config: `apps/web/vite.config.ts`; global setup: `apps/web/src/test/setup.ts`; Supabase mock: `apps/web/src/test/supabase-mock.ts`.

### 4.1 Current files and coverage

| Test file | Current coverage |
|---|---|
| `apps/web/src/App.auth.test.ts` | Sign-in session switching, sign-out/sign-in loading reset, authentication error recovery, and the language toggle |
| `apps/web/src/legacy/app.shell.test.ts` | Mounting the app shell, the 9 navigation modules, Create, sign-out, resize listener remounting, cross-account cleanup, and re-rendering shell text on locale change |
| `apps/web/src/legacy/account-modules.test.ts` | Notification unread/read, error handling, feedback submission, Profile load/edit/shell sync |
| `apps/web/src/legacy/materials.test.ts` | Storage/metadata failures, preview/download/delete errors never producing fake success; the Materials AI English menu, capabilities/explicit pipeline, knowledge graph creation, Resume, Delete/Clear double confirmation, cleaning, queue recovery, and the Chinese locale |
| `apps/web/src/features/material-ai/NotesView.test.tsx` | Demo/real Notes grouping, Materials course sync, exam deadline, 500 ms draft-only saving, answers not returned/shown before submission, unified submit-and-grade, and deletion; the knowledge graph inspector, node Q&A, and layout API |
| `apps/web/src/features/material-ai/KnowledgeGraphCanvas.test.ts` | ELK left-to-right levels, sourceOrder, non-overlapping nodes, cycles/isolated/empty graphs, 250 nodes, drag collision, viewport, and revision merge |
| `apps/web/src/features/material-ai/examDraftStore.test.ts` | IndexedDB drafts isolated and cleaned up per user/attempt |
| `apps/web/src/features/material-ai/errorText.test.ts` | Unified English/Chinese display of stable AI/provider/security error codes |
| `apps/web/src/legacy/community.test.ts` | Feed/filters/my tab, composer tags/media, posting, detail comments, and rollback on backend failure |
| `apps/web/src/legacy/schedule.test.ts` | Today/week/all views, course material links, new tasks/goals, completing tasks, and request errors |
| `apps/web/src/features/courses/parser.test.ts` | Last ASCII space, phrases/multiple translations, exact line/column/error codes, duplicates, Unicode/XSS/limits, plus whole multi-unit headings, global line numbers, missing headings, and duplicates of existing words |
| `apps/web/src/features/courses/CoursesApp.test.tsx` | Empty state/disabled categories, text import/edit/sort/errors, per-word error/review/learned attributes, arbitrary word selection for reviews/exams, and both exam types' thresholds and API contract |
| `apps/web/src/features/courses/ExamHistory.test.tsx` | The history label for failed-but-practice-completed, list→detail, word selection, error counts, and redacted pronunciation scores |
| `apps/web/src/features/courses/LearningView.test.tsx` | Instant feedback/server correction/outbox, spelling/pronunciation end-of-round wrong-word lists and manual confirmation, standard audio after pronunciation scoring, the score list, next-round reordering, live first-round exam accuracy/completion results, and audio prefetch/cache/speech degradation |
| `apps/web/src/features/courses/learningSessionState.test.ts` | Client/database-consistent correctness rules, retry pool, stage transitions, completion prediction, and authoritative patch replacement |
| `apps/web/src/features/courses/attemptOutbox.test.ts` | In-memory fallback without IndexedDB, ordering by user/session/revision, retry backoff, and account-level cleanup |
| `apps/web/src/features/courses/audioCache.test.ts` | Cache Storage hits skip the network, 202 pending isn't cached, ready responses are cached, per-resource status callbacks, and at most two concurrent requests |
| `apps/web/src/features/courses/recording.test.ts` | WAV header/PCM boundaries, conversion to the required 16 kHz format, and that silence, low amplitude, leading/trailing frames, and the full duration are never removed by VAD/trimming |

### 4.2 Mock boundaries

`createSupabaseMock` provides chained `select/insert/update/delete`, common filters, and a limited Storage mock. It is used to verify frontend interaction and request shape, and doesn't simulate:

- PostgreSQL FK/check/unique;
- RLS, grants, `SECURITY DEFINER`, triggers;
- Supabase network errors, token refresh, concurrency, transactions;
- Signed URL expiry and real file permissions;
- PostgREST details for every error/return shape.

When adding query operators or Storage methods, extend the mock first and verify with the real RLS E2E/manual integration; never loosen the mock into behavior the real service doesn't allow just to make tests pass.

### 4.3 jsdom stability conventions

- Each test creates its own DOM root and doesn't depend on execution order;
- `afterEach` clears `document.body`, the rail attribute, and localStorage, and restores real timers;
- Asynchronous legacy rendering uses a controlled `flush()` instead of arbitrary long sleeps;
- The click helper sends bubbling/cancellable events;
- Fixtures never contain real emails, course materials, tokens, or user data;
- Assert cleanup of global listeners, modals, timers, and subscriptions to prevent cross-account/cross-test state leaks.

## 5. Real Supabase RLS E2E

Test file: `apps/web/tests/rls.e2e.test.ts`. The default `pnpm test` discovers it, but the whole suite is skipped unless `RUN_SUPABASE_RLS_E2E` is set to `1`; only `pnpm test:rls` enables it explicitly.

### 5.1 Never run against production

This test will:

- Use the service role to create two confirmed Auth users;
- Write profiles, notifications, feedback, courses, materials, posts, comments, likes, favorites, follows, study goals/tasks;
- Upload real `materials` Storage objects;
- Trigger points/level, post counts, notifications, tag sync, and streak;
- Try to delete the Storage objects and Auth users in finally/afterAll.
- Create learning courses/units/20 words, sessions/attempts/progress, review schedules, shares, immutable publications, reports, clones, badges, and course points entries.
- Keep a paused Unit 1 initial learning session and a Unit 2 review active in the same course at once, verifying exact intent resuming, normalized test item order, and same-intent concurrent idempotency.
- Create/clean up global synthetic audio job metadata; it doesn't call real Azure or upload user recordings.

Only use **a one-off or dedicated test Supabase project that can be reset at any time**. Even with the confirmation variable set, never enter the production Project Ref. The test creates unique university/major/subject global `tags`; the current schema has no client delete policy, and the Auth cascade doesn't clean these tags, so the project may keep a few test tags. The safest cleanup is to reset/destroy the test project after the run.

### 5.2 Prerequisites

1. The test project has all of `supabase/migrations/` applied;
2. Get the test project's URL, anon key, service-role key, and Project Ref;
3. The operator double-checks in the console that the project name is clearly marked disposable/test;
4. It isn't shared with developers' manual data, staging acceptance data, or production.

Required variables:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Test project URL |
| `SUPABASE_ANON_KEY` | Client key for the two ordinary users |
| `SUPABASE_SERVICE_ROLE_KEY` | Creating/deleting test users and cleaning up objects; top secret |
| `SUPABASE_RLS_E2E_CONFIRM_REF` | Must exactly equal the Project Ref in the URL hostname, to prevent slips |
| `RUN_SUPABASE_RLS_E2E` | Set to `1` automatically by the `test:rls` script |

The Project Ref confirmation is only a second check against mistakes, not a production protection allowlist.

### 5.3 Injecting variables safely

You can create a machine-only `.env.rls.local` at the repository root; the name matches `.env.*.local` in `.gitignore`, but still check before committing:

```dotenv
SUPABASE_URL=https://<test-project-ref>.supabase.co
SUPABASE_ANON_KEY=<test-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<test-service-role-key>
SUPABASE_RLS_E2E_CONFIRM_REF=<test-project-ref>
```

```bash
chmod 600 .env.rls.local
set -a
. ./.env.rls.local
set +a
pnpm test:rls
unset SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_RLS_E2E_CONFIRM_REF
```

Don't paste the values directly into a shared shell history, CI log, or ticket. Before running:

```bash
git status --short
git check-ignore .env.rls.local
```

`git check-ignore` must show that the file really is ignored.

### 5.4 Current real coverage

- Profile owner reads/writes and cross-user hiding; only profile columns may be updated, and writes to points/credits/level/VIP/streak are all rejected; profile university/major → tags sync;
- Client RPCs `_add_points`, `_notify`, `_set_point_event` are rejected; neither ordinary users nor the service role can write the points ledger/state directly, and users can only read their own entries;
- Owner isolation for notifications, courses, and materials; Feedback only allows owner SELECT/INSERT, client UPDATE/DELETE/forged status all fail, and service-role-supported updates still work;
- Materials can't be created in another user's course;
- Private `materials` Storage: the owner uploads/downloads/signs URLs/deletes, and another user can't download, sign URLs, or write into the owner's path;
- Authenticated public reads for the community; post INSERT/UPDATE can only use the content allowlist, forging the owner, author snapshot, the four counts, points key, and times fails, valid content edits have `updated_at` refreshed by the database, and count triggers don't change the content edit time;
- The four counts like/favorite/comment/repost, relationship row visibility, follows, and interaction notifications;
- Stable business keys for like/comment/repost/original post, reversal on cancel/delete, restoring the net amount on recreate, concurrent deletion of the last comment, cascading reversal from the original post, the ledger projection, and cross-user hiding;
- points/level/name after post points reach a level threshold;
- Owner isolation for study tasks/goals; cross-owner course/material/goal references by both client and service role are rejected by triggers, `user_id` can't be modified, and `done_at` is only derived from `done`; the task key can't be modified, the net amount across complete/cancel/delete/recreate is correct, and streak only advances the first time;
- 0039 points decisions: the 3/10/10/20/10 daily count caps for original posts/reposts/comments/likes/tasks converge under concurrency; operations over the cap succeed but earn zero forever, changing the time zone or deleting and recreating doesn't reclaim them, and each category window notifies durably only once; the 0007→0038→latest fixture verifies that old business keys keep their grandfather semantics and that only positive transition-1 entries prove the historical actual reward; the fixture also cancels a 0008-backfilled task at 0038 and confirms that 0039 compensates the unsourced debt append-only with `grandfather-zero-reset-v1`, after which deletion, restore, and moderation never produce negative points;
- Root-chain suppress/restore of an original post only reverses the amounts actually awarded, without double reversal or re-awarding daily-cap claims; a repeated restore returns 0 change but keeps the audit, and the shared/exclusive gates of ordinary rewards and moderation keep a consistent lock order; neither ordinary clients nor service-role PostgREST can rewrite claims, moderation actions, or signals, and moderation/scanning can only go through service-only RPCs;
- 8 interactions by the same actor with the same owner produce a pending coordination signal, and the scanner never automatically changes content, freezes accounts, or reverses rewards;
- After deleting the Auth user, `point_entries`/`point_event_states` have no leftovers.
- Courses owner/cross-account isolation; clients can't write content/progress/badges/points/speech usage/translation quota, and can't execute privileged RPCs such as cancellation, exams, round confirmation, or quota reservation; Profile timezone only accepts IANA names;
- Exams cover the whole unit, or since 0031 an owner-validated custom set, with a server-shuffled queue: attempts/pronunciation scoring are rejected during end-of-round confirmation, and after confirmation the wrong-word set is unchanged and reordered; a first round below the threshold with completed practice ends automatically and writes `practiceCompleted` without writing exam facts. Since 0033, a passed single exam only writes its timestamp, cross-day three-skill reviews still don't make a word learned, and it's learned only when both the spelling and pronunciation exam facts exist; 0029 asserts pronunciation wrong-word scores, 0031 asserts the selection scope, redacted history, and client rejection of the new RPCs, and 0034 asserts the dual-exam constraint and single projection;
- Exact translation match claims don't count against provider quota, real provider reservations count exactly once, and the minute/rolling 24-hour limits converge under concurrency through database locks;
- The 0015–0016 snapshot/seven-parameter attempt/unit and word prepare/claim/finish/quota RPCs can't be executed by anon/authenticated, and ordinary users can't read or write `learning_audio_assets`;
- Concurrent requests with the same attempt UUID append only one fact/one wrong_count and replay the first response; different answers at the same revision have only one committed, and the other returns a revision conflict; the old five-parameter RPC still advances the revision, supporting application rollback;
- Two users' identical normalized word sets get the same 20 cache keys without duplicate jobs; the wrong owner can't prepare someone else's word; concurrent claims have only one global lease, and quota pauses don't consume generation retries;
- Materials AI candidate 0046–0051: ordinary clients can't execute the v2 create/usage/checkpoint/complete/delete/clear/layout RPCs or read internal checkpoints/provider usage; two-user job, Note, and layout isolation; queued/processing/delete races settle quota exactly once; the usage ledger is kept after deleting a job; layout revision conflicts and artifact version changes only reuse positions of nodes that still exist;
- The test answer retry pool, adding/removing recognition retry items below/at the read-aloud `PronScore` threshold, only advancing after the recognition retry round completes, plus same-day local date dedupe, three-skill mastery on two different local dates, error/review counts, and schedule completion without creating ordinary tasks;
- Durable awarding of the nine-tier badges on reaching thresholds, the 20-word course +20, and the normalized word set fingerprint preventing repeated rewards via deletion/cloning;
- Share token hashes, transactional clone failure after revocation, anonymous PostgREST rejection, immutable market snapshots, independent zero-progress clones/no re-distribution, and the report transaction.

Important risks not covered or not implemented yet:

- 0008 stores the old `profiles.points` as-is as `legacy_opening`; 0009 appends an equal reversal to reset it to zero per the 2026-07-21 product/security decision. Automated tests prove the migration and reversal semantics, but the production release must still save aggregate audit and handling records;
- Writes/deletes/object cleanup for the `community-media` public bucket;
- All Storage orphans and the privacy deletion process after account deletion;
- 0039–0040 completed the production stage-one release and passed the 2026-08-22 go/no-go; 0052–0053 have verified in CI and production that clients can't write `posts.updated_at`/`study_tasks.done_at`, valid content/`done` writes still succeed, and the service role/triggers are kept;
- Coordination detection only covers the four locked thresholds and only flags; it has no content-semantic spam detection, automatic penalties, full moderation back office, or cross-site device graph; cross-midnight behavior is constrained by the database's frozen window design and migration assertions, and still needs controllable-clock drills on hosted staging;
- Redis integration is explicitly skipped when Redis isn't installed locally; only the real Redis service in CI provides evidence for this layer. Concurrency/timeout replays of ordinary answers are covered, but recognition, legacy module writes, process crash windows, and long-running sessions still need continued expansion;
- Real Azure accounts, the audio provider network, browser microphone permissions, and actual pronunciation quality; automated tests only use adapter fakes/fixed WAVs.

These are priorities for later security migrations, product governance, and negative E2E, and are not within what the current suite has proven safe.

### 5.5 0007 → latest migration upgrade fixture

`apps/web/tests/points-upgrade.e2e.mjs` is a destructive local script that internally requires both `ALLOW_POINTS_UPGRADE_E2E=YES` and a URL hostname of `127.0.0.1`/`localhost`. `supabase start` applies all migrations up front, so CI automatically discovers, in sorted order, **all migrations** with filenames `>=20260710000008` and temporarily moves them out, first building the real 0001–0007 schema; this way future 0014+ never leak into the old fixture stage. A `trap` guarantees they are restored even on failure. Don't copy the move steps verbatim in a personal workspace with uncommitted changes. The core logic is:

```bash
mapfile -t upgrade_migrations < <(
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print \
    | LC_ALL=C sort \
    | awk -F/ '$NF >= "20260710000008"'
)
staged_upgrade_dir=/tmp/nalanda-points-upgrade
mkdir -p "$staged_upgrade_dir"
restore_upgrade_migrations() {
  local migration staged
  for migration in "${upgrade_migrations[@]}"; do
    staged="$staged_upgrade_dir/$(basename "$migration")"
    test -f "$staged" && mv "$staged" "$migration"
  done
}
trap restore_upgrade_migrations EXIT
for migration in "${upgrade_migrations[@]}"; do
  mv "$migration" "$staged_upgrade_dir/$(basename "$migration")"
done

supabase start
supabase status -o env > /tmp/supabase-status.env
set -a; . /tmp/supabase-status.env; set +a

fixture=/tmp/nalanda-points-upgrade.json
# Only 0001–0007 are in the directory, so this is a real old schema.
supabase db reset --local --no-seed
ALLOW_POINTS_UPGRADE_E2E=YES POINTS_UPGRADE_FIXTURE="$fixture" \
  SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  node apps/web/tests/points-upgrade.e2e.mjs seed

restore_upgrade_migrations
supabase migration up --local
ALLOW_POINTS_UPGRADE_E2E=YES POINTS_UPGRADE_FIXTURE="$fixture" \
  SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  node apps/web/tests/points-upgrade.e2e.mjs assert
```

The fixture verifies: Profile values affected by the vulnerability, such as credits/VIP/streak, are kept but can no longer be written by clients; points first generate `legacy_opening`, then an equal `legacy_opening_reset` reversal referencing the opening, resetting the projection to zero; historical duplicate post/like/comment/repost/task rows get stable keys and active/transition 0 states without awarding points again; deleting everything/restoring only produces one negative/restore entry, and Profile stays non-negative; redoing historical tasks doesn't advance streak; the final projection equals the ledger and can be cleaned up with Auth deletion. CI then runs `stop --no-backup` to destroy the upgrade fixture's containers/volumes, and `start`s again from a brand-new empty volume with all migrations, avoiding the Auth 502 left by consecutive `db reset`s; a bounded Auth/PostgREST readiness probe of at most 60 seconds confirms the services are up before running the regular RLS E2E. A probe timeout fails rather than retrying forever to hide the problem.

### 5.6 Failures and cleanup

1. Keep the redacted Vitest error and Supabase request ID; don't copy keys/JWTs/user content.
2. First decide whether it's a missing migration, an RLS expectation change, a platform outage, or a test cleanup failure.
3. Check Supabase Auth for `nalanda-e2e-*` users; check Storage for the test users' UUID paths.
4. If the test project has no value worth keeping, reset/destroy it directly to avoid missing trigger-generated data across tables during manual cleanup.
5. If you must clean up, use a controlled service-role admin tool and check in the order Storage objects → Auth users → leftover tags; keep a record of the operations.
6. Whenever a command is found to point at production, stop the test immediately, rotate any exposed service role, audit the data produced, and follow the incident process.

## 6. Playwright Courses browser flow

Test file: `apps/web/e2e/courses.spec.ts`; the config builds/starts the API and Vite itself on ports 3000/5173. It registers two real local users and writes to the database, so it may only run against a one-off local Supabase.

```bash
pnpm --filter @nalanda/web exec playwright install chromium
docker run --rm -d --name nalanda-test-redis -p 127.0.0.1:6379:6379 redis:7.4-alpine
supabase start
supabase db reset --local --no-seed
supabase status -o env > /tmp/nalanda-supabase.env
set -a
. /tmp/nalanda-supabase.env
set +a

SUPABASE_URL="$API_URL" \
SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
SUPABASE_JWT_SECRET="$JWT_SECRET" \
VITE_SUPABASE_URL="$API_URL" \
VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
FEATURE_LEARNING_COURSES_ENABLED=true \
FEATURE_COURSE_SHARING_ENABLED=true \
FEATURE_COURSE_MARKET_ENABLED=true \
FEATURE_PRONUNCIATION_ENABLED=true \
FEATURE_LEARNING_AUDIO_PREWARM_ENABLED=true \
FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED=true \
FEATURE_MATERIAL_AI=true \
FEATURE_MATERIAL_AI_LUNA=true \
MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS=pdf,png \
AZURE_SPEECH_FAKE=true \
OPENROUTER_FAKE=true \
REDIS_URL=redis://127.0.0.1:6379/14 \
RATE_LIMIT_HMAC_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
POINT_ABUSE_SCANNER_ENABLED=false \
PUBLIC_ORIGIN=http://127.0.0.1:5173 \
pnpm --filter @nalanda/web test:playwright
```

Make sure no processes are left on 3000/5173/6379, and run `supabase stop --no-backup` and `docker rm -f nalanda-test-redis` afterwards. The flow covers: sign-up→empty Courses→multi-unit import/corrections/scrolling/sorting→save→four stages→refresh and resume→review/exam→publish/clone; and verifies Cache Storage, the weak-network outbox, timing/translation pre-test, that translation microphone fill doesn't auto-submit, and the waveform while recording in the translation/recognition/pronunciation exam. The Courses spec switches the app to the Chinese locale, so it also exercises the Chinese UI. Redis is a real container; the audio, semantic, and STT providers are all API fakes, so this layer only proves browser/API/local Supabase/Redis collaboration, not Azure or OpenRouter. It's real Chromium layout and interaction E2E, not provider or screenshot visual regression.

The jsdom layer for the same fix asserts separately that whole import produces the expected units, multiple translations render as separate inputs, bulk append in the editor succeeds, and that duplicating an existing word shows `DUPLICATE_EXISTING_TERM` without appending. jsdom doesn't compute real sizes, so "are the bottom actions reachable" must stay at the Playwright layer.

The browser suite's microphone is provided by a fixed AudioContext fixture, not a physical-microphone quality test. jsdom additionally covers waveform frames, the recording UI, STT completion only filling and allowing edits, no automatic grading, and the waveform shared by recognition/pronunciation recording; API units cover the real wire contract with fake fetch, and the RLS E2E covers that ordinary clients can't execute the STT reservation, owner/revision/current-word, and durable quota. Only the protected real gate can prove the Fish Audio endpoint/key worked at the time, and it still doesn't represent real accent accuracy.

On failure, keep the Playwright trace/screenshot/video artifacts and first distinguish UI selector, API envelope, migration/RLS, and webServer startup problems. CI automatically installs Chromium with system dependencies; locally you only need the browser package for your platform.

## 7. Currently executable API and AI tests/smokes

API readiness unit tests are included in the root `pnpm test`, and can also run alone:

```bash
pnpm --filter @nalanda/api test
```

Redis integration is explicitly skipped by default; to get real Lua atomicity/expiry/lock evidence, start a one-off Redis first, then run:

```bash
docker run --rm -d --name nalanda-test-redis -p 127.0.0.1:6379:6379 redis:7.4-alpine
RUN_REDIS_E2E=true \
REDIS_URL=redis://127.0.0.1:6379/15 \
RATE_LIMIT_HMAC_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
pnpm --filter @nalanda/api test
docker rm -f nalanda-test-redis
```

`redis.service.integration.test.ts` only uses random, short-TTL test keys; never point it at production Redis. API units additionally cover route classification, the HMAC actor, standard 429/503, fail-open/closed, and audit milestones, but fake-Redis units can't replace the real service test above.

After starting the API:

```bash
curl -fsS http://localhost:3000/api/health
curl -i http://localhost:3000/api/me
```

The second should return `401`, verifying the endpoint doesn't let anonymous requests through. Verifying `/api/me` with a real development user token is covered in the [API documentation](./API.md); tokens must never be written to logs/scripts.

Materials AI Python gate:

```bash
cd apps/ai
.venv/bin/ruff check app tests
.venv/bin/pytest -q
```

The current Python tests cover the DocumentIR path for PDF/DOCX/PPTX/Markdown/HTML/TXT/JSON/CSV/PNG, including purely visual files first being recovered within the parser's isolated range and then strictly re-reviewed, unknown ranges/content/focus injection failing closed, and Luna PDF/image raw-byte inline payloads, no parser/OCR/cache, `file-parser.native`, Azure-only/no-fallback/ZDR, an OpenAI upstream treated as a routing violation, routing violations, injection rejection, strict schema/repair, the 250-node graph, node Q&A, and Luna grading. Exam paper regressions additionally cover deterministic normalization of request metadata, duplicate section/question IDs, and wrong marks totals, confirming question content isn't changed; source-ref regressions cover removing citations outside the allowlist, using server block locators, restoring pre-repair citations for the same stable question ID, choosing the single source when a single block has all-invalid citations and actually running the semantic review, and multiple blocks/changed question IDs still failing closed. DocumentIR repair regressions must also simulate "correct total question count but wrong per-type counts": assert that the structural repair receives the full `sourceBlocks` and `repairGate=structural`; if the first semantic review then fails, only one `semantic_after_structural` repair is allowed, returning after the second review passes. Persistent semantic failure must stop after exactly two repairs, with no loops or gate bypass. A reviewer's non-empty issues are never masked by a contradictory `valid=true`; final failure diagnostics may only contain stable structural codes, semantic categories, and question/total-point counts, never course material, questions, answers, prompts, reviewer text, or provider bodies. They also cover fast 202 acceptance, the 20-minute budget, the cancellable task registry/Office process group, purge at the download/model/callback/checkpoint stages, finally/TTL cleanup, and replaying validated checkpoints/usage spool after a callback disconnect without calling the provider again. They use a fake OpenRouter and don't prove real model, endpoint, or format capabilities; real gates must run both a normal chart and a sample with malicious instructions inside an image.

After starting `uvicorn` with a development configuration:

```bash
curl -fsS http://localhost:8000/health
```

The internal generation/grading routes need a token, short-lived Storage URLs, and callbacks, so no unauthenticated curl example is provided, to avoid leaks. The real fixed-fixture gate uses `python3 scripts/smoke-material-ai-provider.py`, which must be given OpenRouter and a temporary Supabase fixture by a protected environment; it doesn't equal browser/RLS E2E.

API tests additionally cover AI auth/owner/format, pipeline capabilities, idempotency, quota reserve/consume/release, Redis requeueing, budget/ZDR/bad responses, draft-only saving and unified submission, and deadline/revision/operation replay. The 0046–0051 candidate covers explicit Undici timeout classification and short 202s, incremental usage, checkpoint stages, same-job recovery, queued/processing/delete/callback races, the cleanup reconciler, Clear only deleting terminal jobs, provider audit retention, and layout owner/version/revision/coordinate validation. With `RUN_REDIS_E2E=true` the BullMQ tests use real Redis; the default skip doesn't count as real Redis evidence, and fake DB/fetch still doesn't prove real PostgREST locks, RLS, migration transactions, or providers.

## 8. Docs tests

```bash
node scripts/check-docs.mjs
```

The script recursively checks every Markdown file in the repository:

- The first 24 lines contain "Contents", "Purpose", and "When to update";
- Local relative links can't escape the repository, and their targets must exist.

It doesn't verify that the facts match the code, doesn't verify anchors, doesn't execute code blocks, and doesn't check external URLs. After changing APIs/schemas/scripts, the corresponding docs still need a manual check.

## 9. Current CI gates

`.github/workflows/deploy.yml` currently runs before build/deploy:

```bash
pnpm docs:check
pnpm test:release
pnpm lint
pnpm typecheck
RUN_REDIS_E2E=true REDIS_URL=redis://127.0.0.1:6379/15 \
  RATE_LIMIT_HMAC_SECRET=<CI fixture secret> pnpm test
pnpm build
cd apps/ai && .venv/bin/ruff check app tests && .venv/bin/pytest -q
docker build -f apps/ai/Dockerfile apps/ai
supabase start
# First run the 0007→latest seed / migration up / assert above
supabase db reset --local --no-seed  # then verify the full empty-database rebuild
supabase db lint --local --schema public --level error --fail-on error
# After injecting the local URL/keys from supabase status -o env:
pnpm test:rls
pnpm --filter @nalanda/web exec playwright install --with-deps chromium
pnpm --filter @nalanda/web test:playwright  # local Supabase + real CI Redis + provider fake env
```

Both the quality and database jobs use a separate Redis 7.4 service. The quality job runs the real Lua integration; the browser job injects the real Redis URL into the test Nest API. The compose/nginx checks also confirm Redis has no host port and the password/AOF/noeviction configuration parses, and run `nginx -t`; the actual PING/AOF/private network checks belong to the protected production activation gate.

Real provider smokes must explicitly load a Git-ignored, mode-600 file containing only backend configuration; the scripts reject fakes and never print keys, file content, prompts, answers, or full responses:

```bash
node --env-file=apps/api/.env scripts/smoke-azure-speech.mjs
node --env-file=apps/api/.env scripts/smoke-openrouter-translation.mjs
python3 scripts/smoke-material-ai-provider.py
```

`pull_request` only runs the quality and one-off local Supabase/browser jobs and doesn't read production secrets; Azure/OpenRouter are both fakes. A push to `main` that adds migrations stops after verification. The owner must first plan manually, then separately apply to create the encrypted recovery point, CLI push, and verify, and only then deploy the application. A Luna release must also first read OpenRouter's official ZDR endpoint catalog with the sub-switch off; when the catalog has no `openai/gpt-6-luna` + Azure, the gate can only produce `OPENROUTER_ZDR_UNAVAILABLE` and keep the sub-switch false. Only after the catalog is compliant does it continue, using fixed PDFs/images with no personal data, to prove format by format that the actual provider is Azure, the PDF native parser, the raw SHA-256, no conversion, strict schema, injection rejection, and no leftovers after cancellation; unsupported formats stay outside the allowlist. Fake CI, the old DeepSeek/MiMo gate, the real Luna gate, the signed-in user smoke, and public health are evidence that doesn't substitute for one another.

The separate `.github/workflows/docs.yml` runs `node scripts/check-docs.mjs` on PRs/main pushes that change Markdown, the docs check script, or that workflow.

### 9.1 2026-07-22 Courses import/scrolling fix evidence

- PR run `29932310309` passed quality, the 0007→latest upgrade, latest clean rebuild/database lint, one-off local Supabase two-user RLS/Storage/Courses E2E, and the Chromium Playwright Courses workflow.
- Main run `29932840103` repeated the same gates, then completed immutable application release `d31af905b44ca4df39c70e271a7c7a51612916e3-29932840103-1`.
- The full local `pnpm check` passed at the time; Web Vitest had 32 passed with the 4 external RLS suites correctly skipped in default mode, and API Vitest had 28 passed. The counts are an execution snapshot of that commit, not a permanent test inventory.
- PR/Playwright's Azure is a fake, and the real database boundary only comes from the one-off local Supabase job. The main release additionally ran the existing real Azure gate before activation, but this UI fix didn't change speech code; no fake/jsdom result may be described as real provider or real database E2E.
- The independent post-release smoke got Web 200, `deps.supabase=ok` from `/api/health`, and unauthenticated `/api/me` 401; a real browser additionally verified that the user's sample was split into two Starter Units, multiple translations show separately, bulk append works in the editor, and the bottom actions are reachable.

Target CI layering:

- PRs already run: docs check, TypeScript code lint/typecheck, Web jsdom, API/Courses units, build, upgrade/empty-database migrations/database lint, two-user RLS/Storage/Courses E2E, and Playwright Courses; FastAPI contract tests are still to be added;
- Protected staging target: near-production data scale and configuration drift E2E;
- Before release: recovery points and migration/rollback drills; before application activation, the production host enforces the real Azure basic smoke and the queue/Storage/duplicate word/scoring smoke;
- Scheduled: RLS security regression, dependency/secret scanning, backup restore, AI evaluation/cost (once wired up).

High-privilege E2E runners must use a separate test project, protected environment approval, and short-lived/rotatable secrets, and must never expose the service role to untrusted fork PRs.

## 10. Release verification matrix

| Change | Minimum required |
|---|---|
| Markdown | docs check |
| Web/legacy UI | typecheck + relevant jsdom + full `pnpm test` + build |
| Supabase query shape | jsdom + disposable project RLS E2E |
| Migration/RLS/trigger/function | Full migrations on an empty project + relevant old→new upgrade fixture + lint + RLS E2E + pre-release backup |
| Post/Feedback/Schedule/points security | 0007→0053 + empty database + exact grants + two-user RLS/service-role negative tests + cap concurrency/time zone/recreate + root suppress/restore + pending scanner signal + ledger/Profile projection; 0052/0053 additionally verify rejection of the two time columns and valid writes |
| NestJS auth/Courses API | typecheck/build + API units + RLS E2E + Playwright; attempt changes also test UUID replay/revision conflict/outbox; multipart/real Azure and real OpenRouter get separate controlled smokes |
| Courses parser/UI | parser/jsdom + API units + RLS E2E + Playwright; testing only mocks isn't enough |
| Courses audio/offline | cache key/untrimmed recording units + API raw-byte forwarding/queue/Storage fakes + RLS grants/lease + Playwright Cache Storage/outbox + the pre-release real Azure queue reuse gate |
| Courses timed spelling/translation pre-test | fake-clock jsdom + API structured response/timeout units + two-user RLS/idempotency/quota + fake-provider Playwright + the pre-release real OpenRouter structured/API gate; model output must never be taken directly as a client fact |
| Courses translation voice input/waveform | recording/WAV/waveform units + jsdom fill-without-submit/editable/late-response guards + API multipart/Chinese STT/error mapping + real Supabase RPC permissions/quota + fake-provider Playwright waveform in three places + the pre-release Azure Chinese WAV→real Fish Audio candidate API gate; synthetic samples aren't a real accent evaluation |
| Courses spelling normalization | Web units/jsdom cover NFKC/Unicode whitespace/full-width case, punctuation omission/substitution/addition, and real letter/space errors + one-off real Supabase E2E verifying the raw answer, revision, `wrong_count`, retry pool, and client helper rejection |
| Courses spelling end-of-round review/exam | state units + jsdom verifying the durable wrong-word list/confirmation gate/live accuracy; API units verifying the fixed exam rules; real Supabase E2E verifying triggers, reordering, pass/fail mastery projection, and permissions; fake-provider Playwright verifying the full browser flow |
| Courses pronunciation exam/arbitrary word selection/exam history | jsdom verifying per-question scoring feedback, end-of-round scores, the selector, and history details; API units verifying Azure target/owner/mapping; real Supabase E2E verifying the selection scope, immutable snapshots, client RPC rejection, and that failed practice doesn't fake a pass; fake-provider Playwright verifying the browser flow, plus the real Japan East Azure gate before release |
| Courses dual-exam mastery | Real Supabase E2E verifying that cross-day reviews and single exams don't make words learned, both exams in either order jointly do, failed exams don't write facts, and term/translations/IPA edits revoke precisely; 0034 empty-database/upgrade assertions for fields, check constraint, no forward writes from reviews, and service-role-only permissions |
| OpenRouter actual call quota | API units verifying that exact/replay don't reserve and only provider calls reserve; real Supabase E2E verifying `quota_counted`, the user lock, and client rejection; before the protected release, check that production env=500, without probing the 500 limit with real user answers |
| Other AI artifacts (future) | New schema, parser/prompt/eval + API/RLS/jsdom/Playwright + real provider gate; never infer quality by reusing the exam paper gate |
| Materials AI generation/exams | Python ruff/pytest + API durable queue/quota/revision units + real Redis BullMQ + 0041–0043 empty database/upgrade/two-user RLS + jsdom + fake-provider Playwright + AI Docker; every key release additionally runs the real DeepSeek/MiMo fixed PDF/DOCX/PPTX/chart/injection/grading gate and the 2G resource canary |
| Materials AI graph/lifecycle/Luna (0046–0051, 0056–0057 candidates) | ELK/React Flow units + Materials/My Notes jsdom + Python raw bytes/provider lock/cancel/checkpoint + API delete/clear/202/layout/whole-paper grading + real Redis + 0007→latest/empty database/lint/RLS + fake Chromium 250 nodes/mobile/job cleanup; before release additionally run real DeepSeek/MiMo and the Luna Azure-only PDF/image/per-format/injection/cancel/usage gate, the 2G canary, and the signed-in user smoke |
| nginx/compose/Redis/CI | API image dependency check + real Redis Lua integration + compose config + nginx `-t`/standard 429 + staging deploy + `deps.supabase=ok`/`deps.redis=ok` + auth/admin rejection/rate-limit headers |
| points/credits/VIP/payments (future) | Ledger idempotency/concurrency/reconciliation/refunds/webhook replay + E2E; UI-only tests aren't allowed |

A verifiable release sample from 2026-07-27: PR #21 run `30243998633` and main run `30244402278` completed the automation matrix; read-only plan `30244967669` listed only 0015–0016; apply/deploy `30245430630` created recovery artifact `8644999285`, and before cutover used real Japan East Azure to verify first generation, private Storage hits, cross-user duplicate word reuse, and VAD-trimmed scoring. Playwright still used fake providers in these runs, and real provider evidence only came from the separate production gate.

A later sample the same day: PR #24 run `30263277807` and main run `30263794368` completed 0007→0018, empty-database rebuild/lint, real local Supabase RLS/Storage, jsdom, and Chromium Playwright; the browser tests for the historical eight-word cold unit and pause Unit 1→review Unit 2→resume Unit 1 used the Azure fake. Read-only plan `30264327821` listed only 0017–0018; apply/deploy `30264979509` created recovery artifact `8652623403`, and before cutover used the real Japan East account to verify `generatedAssets=4`, `duplicateAssetsReused=4`, and a score of 97. Public/server health checks are release evidence, and fake Playwright is never described as real provider E2E.

The timed spelling/translation pre-test sample from 2026-07-28: PRs #26–#29 and final main run `30374301472` passed 0007→0020, empty-database rebuild/lint, real local Supabase RLS/Storage, jsdom, API, and Chromium Playwright; Playwright's Azure/OpenRouter were both fakes. Read-only plan `30366334157` listed only 0019–0020, and protected run `30367263486` created artifact `8691620673` and applied up to 0020. The final production deployment verified MP3/scoring with real Azure, structured synonym/unrelated judgements with real OpenRouter, and then, through the real Courses API/database, that an exact match costs 0 tokens, same-UUID `replayed=true`, and the authoritative spelling attempt; the release is `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3`. The provider contract, model misjudgement, replay mapping, and a single 12-second timeout in the release chain were all blocked by gates, and failed candidates can't be counted as going live.

The Unicode spelling normalization sample from 2026-07-31: PR #35, main, and protected run `30616540480` passed 0007→0022, empty-database rebuild/lint, real local Supabase RLS/Storage, Web/API tests, and Chromium Playwright. The real database asserted that `ＷＯＲＤ－０１` and ASCII `WORD-02` are both correct, the revision increments, `wrong_count=0`, the retry pool is empty, and ordinary clients are refused when executing the helper; read-only plan `30616030488` listed only 0021–0022, and the protected run kept artifact `8787805291`, then applied and activated release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1`. The real Azure/OpenRouter gates in the release prove the dependencies didn't regress, but have no direct causal link to the spelling case behavior; there is no real-user production answering E2E.

The punctuation tolerance sample the same day: PR #37 run `30620350644`, main run `30620879282`, and protected run `30624104943` passed 0007→0024, empty-database rebuild/lint, real local Supabase RLS/Storage, Web/API tests, and Chromium Playwright. The Web app and the real database each asserted that `You're welcome.` / `Youre welcome!` and `check-in` / `check in` / `checkin` pass, real letter errors and inter-word space errors with no punctuation involved fail, correct samples increment the revision with `wrong_count=0` and an empty retry pool, and clients can't execute the internal matcher; read-only plan `30623522232` listed only 0023–0024, and the protected run kept artifact `8790816378`, then applied and activated release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1`. Playwright providers were still fakes; real Azure/OpenRouter only prove the production dependency gates, and there is no real-user production answering E2E.

The cancellation, end-of-round review, exam, and rolling quota sample from 2026-08-01: PR #40 run `30705662543`, main run `30705946921`, and protected run `30706731292` passed 0007→0028, empty-database rebuild/lint, real local Supabase RLS/Storage, Web/API tests, and Chromium Playwright. Automation covers owner-only cancellation, resume isolation after cancellation, per-round wrong-answer confirmation and shuffled retakes, exam thresholds/live accuracy/pass projection, and that only real provider requests use the rolling 24-hour 500 quota; read-only plan `30706279006` listed only 0025–0028, and the protected run kept artifact `8820657507`, then applied and activated release `93354a56044470fb5d2b1fd6aeabcf82f459bb52-30706731292-1`. Playwright's Azure/OpenRouter were still fakes; real Japan East Azure, real OpenRouter, and the candidate Courses API/Storage gates are separate release evidence. The read-only production UI check submitted no real user answers, so it can't be described as production exam E2E.

The pronunciation exam, arbitrary word selection, history, and dual-exam mastery sample from 2026-08-03: PR #45 final run `30811283164`, main run `30811817461`, and protected run `30813047562` passed 0007→0034, empty-database rebuild/lint, real local Supabase RLS/Storage, Web/API tests, and Chromium Playwright. Automation covers pronunciation scores/retries, owner-validated word selection, automatic ending after failed practice, immutable history snapshots, reviews/single exams not making words learned, both exams jointly making them learned, and edit revocation; read-only plan `30812467085` listed only 0029–0034, and the protected run kept artifact `8855819351`, then applied and activated release `1a58d2164f6d58feea4d3a2c8925211b8cc60dde-30813047562-1`. Playwright's Azure/OpenRouter were still fakes; real Japan East Azure, real OpenRouter, and the Courses API/Storage gates are separate release evidence. No real production user exams were submitted, so it can't be described as production user-flow E2E.

The untrimmed recording and exact mastery projection sample from 2026-08-04: PR #47 run `30831319634`, main run `30831964846`, and protected run `30833228406` passed 0007→0036, empty-database rebuild/lint, real local Supabase RLS/Storage, Web/API tests, and Chromium Playwright. Automation covers that silent/quiet/full leading-and-trailing WAVs aren't trimmed by the client, Nest forwards the bytes unchanged, and manual `learned_at` and single exams can't bypass the trigger projection; read-only plan `30832581552` listed only 0035–0036, and the protected run kept artifact `8864033351`, then applied and activated release `51252527645d9438df0414f056c8a3b088b360d8-30833228406-1`. Playwright's Azure/OpenRouter were still fakes; separate real Japan East Azure, real OpenRouter, and Courses API/Storage gates prove the real dependencies, and the gate reported untrimmed `assessmentBytes=88444`. No real production user exams were submitted, so it can't be described as production user-flow E2E.

The translation voice input and shared waveform sample the same day: PR #49 run `30904901828` passed 0007→0038, empty-database rebuild/lint, real local Supabase RLS/Storage, 72 API tests, 85 Web/jsdom tests, and Chromium Playwright; main run `30905971129` only verified without deploying per the migration protection rule. Read-only plan `30906629924` first failed because of a transient upstream response from the one-off Supabase, then passed after rerunning the failed job on the same SHA and listed exactly 0037–0038. Protected run `30907716733` kept artifact `8892006761`, applied up to 0038, and activated release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1`. Playwright STT was still a fake; the separate real direct and production pending-activation API gates used a synthetic Chinese WAV, and the latter returned `transcriptionMatched=true`. This proves the endpoint/key/quota and the fixed sample at the time, not physical-microphone or multi-accent quality.

The security/rate-limit Stage A sample from 2026-08-10: PR #51 run `31367746106`, PR #52 run `31370961413`, and main run `31371608883` passed docs/lint/typecheck, Web/API tests, build, real Redis Lua, 0007→0040, empty database/database lint, two-user RLS/Storage, and Chromium Playwright; Playwright's providers were still fakes. Plan `31368447660` listed only 0039–0040, and protected run `31369657292` kept artifact `9055783205`, then applied up to 0040. The remote stdin false success exposed by that run was fixed with a regression in #52; final plan `31372198037` was empty, and protected run `31372888441` re-verified the remote with artifact `9057062920` and activated release `56100e6bc2a4c70aa289aaad4b43efa1267428bd-31372888441-5`. The real Redis/nginx/Azure/OpenRouter/Fish/Courses gates and public `deps.redis=ok`, auth/admin 401, and sign-up RateLimit headers are separate production evidence; OpenRouter's transient timeouts/429s were all blocked before cutover and can't count as successful tests. The Stage B observation passed on 2026-08-22; PR #72 run `32579985463`, main run `32580594918`, plan `32581192318`, and protected run `32581805613` covered 0007→0053, empty database, DB lint, two-user RLS/Storage, Playwright, and the exact remote history. 0052–0053 are applied; the same run's application candidate was stopped twice by the real Materials AI PPTX gate and rolled back, so the database success can't be written up as the latest application going live.

The Materials AI sample from 2026-08-11: PR #56 run `31462982923`, PR #57 run `31465041901`, and main run `31465776658` all passed docs/lint/typecheck, 104 API, 105 Web/jsdom, and 25 Python AI tests, real Redis, 0007→0043, empty database/lint, two-user RLS/Storage, AI Docker, and fake-provider Chromium Playwright. Read-only plan `31465816321` confirmed 0043/an empty dry-run; protected run `31467153739` created artifact `9092230348`, then ran the 220-page resource canary, the real DeepSeek/MiMo fixed format/vision/injection/grading suite, the real Azure/OpenRouter/Courses gates, and the signed-in user Materials→Notes→Exam→grading→delete, finally activating release `e6ce0cb246d9fc1ecc1c4869b6e63d09d3256bd4-31467153739-1`. The earlier workflow false green of `31463661987` was caught by independent checks of the server image/Web/flag and the public 404, and it was only rereleased after fixing the bare `compose exec` heredoc stdin; so Actions success can't replace an independent production smoke.

The 2026-08-14 release of 0049–0051 first completed the full fake/local gates with PR #66 run `31821614332` and main run `31822630770`, and read-only plan `31822702349` listed only 0049–0051. Apply run `31824832947` successfully created a recovery point and applied and verified these three migrations, and then the 220-page canary passed; the real Luna PDF gate returned `OPENROUTER_ZDR_UNAVAILABLE`, the old Web/API were restored automatically, and Luna/Materials AI stayed off. This run is evidence of "database release succeeded, application release failed and rolled back", and can't be written up as Luna going live. The public ZDR catalog also proved that at the time there were only Azure/Azure EU endpoints; the forward fix must ship the DocumentIR features while keeping Luna false when compliance is unavailable.

The 2026-08-15 forward fix PR #68 run `31834010315` and main run `31834895278` passed 63 Python, 127 API, and 113 Web tests, plus real Redis, 0007→0051, empty database/lint, two-user RLS/Storage, fake Chromium, and the 220-page canary. The real chart passed vision recovery under `material-safety-audit.v2`, but the fixed safe material's exam once returned `AI_EXAM_VALIDATION_FAILED` because of marks total drift, and the candidate release rolled back automatically; three redacted diagnostics on the same fixture confirmed the result has provider randomness and that repair may repeat the error. New regressions normalize mechanical metadata/IDs/marks from server-side settings and let review issues take precedence over a contradictory valid flag; a new real provider run and independent production checks must still prove the fix works.

On 2026-08-22, PR #70 run `32499521666` passed the full gates and was merged; main run `32540131549` passed 131 API, 113 Web, and 72 Python tests, real Redis, 0007→0051, empty database/lint, two-user RLS/Storage, fake Chromium, images, and the 220-page canary, but the real fixed DOCX returned `AI_EXAM_VALIDATION_FAILED` at final exam validation. The candidate rolled back automatically before the API/Web cutover and had no new migration, so this run isn't evidence of going live. The forward fix's local gates were 74 Python, ruff, and 26 release tooling tests; the next real gate must prove the eight-fact fixture reliably generates five questions, and if it still fails, only output content-free validation categories/counts.

After PR #71 merged on 2026-08-23, the first execution of main run `32543270581` passed the full fake/local and real Materials provider gates, but Japan East Azure TTS HTTP 401 blocked the cutover and it rolled back automatically. Attempt 2, retried at the user's request, passed the 220-page canary; the fixed DOCX's initial semantic gate returned `ANSWERABILITY/ANSWER_CORRECTNESS/DISTRACTOR_QUALITY/EXPLANATION_QUALITY/SOURCE_GROUNDING`, and after repair the 5 questions and 20 total points were both correct but the final structural gate still had `SOURCE_REFERENCE`, so it correctly failed closed. The citation forward fix passed ruff and 77 Python tests locally; the new real gate must prove repair no longer fails because of fabricated block IDs, while the structural and second semantic reviews stay strict. If the Azure 401 appears again, it is still an independent hard gate and can't be bypassed with this AI fix.

The same day, PR #74 run `32585020750` and main run `32585659792` passed docs, quality, 0007→0053, empty database/lint, two-user RLS/Storage, and fake Chromium. Production attempt 1's real Materials suite, canary, and Azure all passed, but Gemma translation still returned 429 after five bounded retries and rolled back; attempt 2 then failed with initial/final `SOURCE_REFERENCE` on a PDF with only one DocumentIR block and rolled back. The single-block fix's local gates were ruff and 78 Python tests; the next real run must simultaneously prove that single-block citations pass the structural + semantic gates, multiple blocks still aren't guessed, and Gemma, the later Courses checks, the signed-in smoke, and cutover all complete.

PR #75 run `32587211309` passed docs, quality (3m52s), and 0007→0053/empty database/lint/RLS/Storage/fake Chromium (8m12s), and main run `32587844503` again passed quality (4m6s) and the local database/browser (7m26s), with no migration changes. Production attempt 1's fixed PDF still had one extra question after repair and failed closed with `QUESTION_TYPE_COUNT`; attempt 2, the only rerun of the failed job, passed the 220-page canary, all real Materials samples and semantic gates, and Japan East Azure, but the free Gemma model returned 429 five times in a row and it rolled back. This evidence proves the single-block citation regression got past the real gate, and also that the real provider hard gate wasn't bypassed by fake tests, structural normalization, or reruns; the Courses/signed-in smokes, cutover, and public new-version verification still haven't happened.

On 2026-08-26, PR #78 passed the full PR checks and was merged as `1281510c94b4da5a765211df8467f9a26be393f0`. Main run [`32931681321`](https://github.com/1590703336/Nalanda/actions/runs/32931681321)'s quality (4m19s) and 0007→0055/empty database/lint/RLS/Storage/fake Chromium (7m43s) passed with no new migration; the 220-page canary passed. The real DocumentIR DOCX's initial structural code was `QUESTION_TYPE_COUNT`; after the old repair it had 5 questions, 20 total points, and an empty final structural code, but the final semantic categories included answerability, answers, distractors, explanations, and source grounding all at once, so the candidate rolled back automatically, and the real Ox translation smoke hadn't run yet. The check confirmed the old repair request only contained allowlisted block IDs without text, and that semantic issues newly appearing after the structural repair had no repair stage. `exam-generate.v4` regressions cover the full source, minimal structural changes, one bounded follow-up semantic repair, and persistent failure closing; real DOCX/PPTX, the later provider gates, and the production cutover must still be proven independently by a new main run.

Afterwards, PR #69's full CI and main run `31838779292`'s local database/RLS/fake Chromium, real provider fixtures, 220-page canary, and Azure/Courses gates passed, but the signed-in production smoke's knowledge graph produced 3 nodes/2 valid edges and no level-0 root. The database completion RPC rejected it with `22023`, the job stopped at `saving`, and after the 15-minute smoke timeout candidate `669f3f423e712fe561496dae6b0ab9b16c799025-31838779292-1` rolled back automatically without switching the Web. Regressions now cover mechanically resetting DocumentIR/native graph levels to zero, aligning root/sourceMode with the DB contract, normalization still applying after checkpoint recovery, permanent result/routing rejections entering a terminal state, and lost leases returning 409; until a new real run, the application must still not be reported as live.

## 11. Conventions for new tests

1. Test names describe user behavior/security properties, not just function names.
2. Every bug fix first gets a failing test that reproduces it; security issues also get negative cases.
3. Fixtures contain no real personal data, and time/UUIDs/network are controllable.
4. Tests are isolated from each other, repeatable, and parallelizable; if they must be serial, explain the shared state.
5. External E2E has explicit opt-in, project Ref confirmation, a unique prefix, and finally cleanup.
6. Any high-privilege key only lives in node/server environments and must never be imported into the Web test bundle.
7. "Verified" in docs must give the currently executable command, test path, and boundary; manual tests record the date/environment and can never permanently replace automation.
8. Never hide races/real permission errors by adding sleeps, ignoring errors, or loosening mocks.
