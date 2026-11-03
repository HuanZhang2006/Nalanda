# Local Development from Scratch

> **About this document**
> - **Contents**: The full steps from a blank development machine to running the Web app, the NestJS API, the FastAPI AI worker, and Redis connected to Supabase, plus common problems and a minimal acceptance check.
> - **Purpose**: Lets new contributors set up a reproducible development environment without relying on word of mouth.
> - **When to update**: When dependency versions, startup scripts, ports, the database initialization method, the service topology, or required onboarding steps change; review at least before every milestone release.

## 1. Status conventions

This document uses these labels:

- **Current implementation**: the commands and files already exist in the repository and can be run as described.
- **Target state**: planned engineering capabilities that cannot be used as existing features yet.

What runs locally today: the React/Vite Web app, the NestJS API, the FastAPI AI worker, and Redis. Business data, authentication, and file storage use Supabase; the production API requires Redis to pass readiness and uses it for rate limiting, the points scan lock, and BullMQ delivery of durable Postgres job UUIDs. The production database is at 0055; the new app corresponding to 0046–0055 still rolled back to the earlier stable release after real provider gates failed, so the knowledge graph, recovery, Luna/Ox native files, and job cleanup can only be called production capabilities after the immutable app is cut over successfully. Courses AI file import is still not implemented; English word-list text learning does not depend on this worker.

## 2. Prerequisites

| Tool | Version/requirement | Used for |
|---|---:|---|
| Git | Recent stable | Getting the code, viewing changes |
| Node.js | `>=20` | Web, API, scripts |
| pnpm | `9.12.3` | Monorepo dependencies and tasks; version in the root `package.json` |
| Python | `3.12` recommended | AI service; the production AI image is also Python 3.12 |
| PostgreSQL client | Compatible with the server major version recommended | Optional, for backups, restores, and manual SQL checks |
| Docker | Recent stable | Recommended for local Supabase and database migration/RLS E2E |
| Supabase CLI | `2.101.0` (same as CI) | Starting the local stack, reset, lint, migration history |
| Supabase project | An optional separate development project | When you need to verify a hosted environment; never connect to production |

Without a local database you can connect to an isolated development Supabase; reproducing CI's database/RLS gates requires Docker. Starting the candidate NestJS API also needs a test Redis; you can reuse Docker or a local Redis, but never point it at production.

Enable the pnpm version the repository declares:

```bash
corepack enable
corepack prepare pnpm@9.12.3 --activate
node --version
pnpm --version
```

## 3. Get the code and install dependencies

```bash
git clone <repository-url> Nalanda
cd Nalanda
pnpm install --frozen-lockfile
```

After the first install, run a static acceptance check:

```bash
pnpm typecheck
pnpm build
```

The root `pnpm lint` runs strict TypeScript static checks with `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch` on the API, Web, and shared types; it is not ESLint and does not replace the normal typecheck/test.

## 4. Prepare Supabase

### 4.1 Recommended: local Supabase

Start from the repository configuration and rebuild:

```bash
supabase start
supabase db reset --local --no-seed
supabase db lint --local --schema public --level error --fail-on error
supabase status
```

Put the API URL and anon/service-role keys from status into the Web/API local environments respectively. When you're done, run `supabase stop --no-backup`.

### 4.2 Optional: create an isolated hosted project

Create a development-only project in Supabase and note:

- Project URL;
- anon/publishable key;
- service-role key;
- Project Ref;
- The JWT secret, only if you need compatibility with legacy HS256 tokens.

Never copy the production Project Ref or production keys into a personal development environment. See the [environment variable matrix](./ENVIRONMENT_VARIABLES.md) for each variable's full purpose and sensitivity.

### 4.3 Apply migrations to a hosted development project

Migration files live in `supabase/migrations/`. The normal path uses the CLI history:

```bash
SUPABASE_ACCESS_TOKEN=<personal-access-token> \
SUPABASE_DB_PASSWORD=<development-db-password> \
supabase link --project-ref <development-project-ref>
supabase db push --dry-run
supabase db push
```

The old Management API script is for emergencies only:

```bash
SUPABASE_ACCESS_TOKEN=<personal-access-token> \
SUPABASE_PROJECT_REF=<development-project-ref> \
ALLOW_LEGACY_DB_PUSH=YES \
node scripts/db-push.mjs
```

Notes:

1. `SUPABASE_PROJECT_REF` must be passed explicitly; the script has no default and requires the emergency switch.
2. The script runs file by file and stops at the first error; it provides no repository-level rollback and does not replace a pre-release backup.
3. It replays every SQL file. The existing migrations aim to be repeatable, but `create table if not exists` will not automatically fix a table whose structure has drifted.
4. Before first onboarding or any non-development release, read [database release and rollback](../operations/DATABASE_RELEASE_ROLLBACK.md).

You can also run the files one by one in the Supabase SQL Editor of a throwaway development project, but the normal local/CI baseline is the repository's `config.toml` and the CLI. In production, never use the SQL Editor to bypass migration history and release recovery points.

## 5. Configure environment variables

Create the Web local configuration:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill in at least:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<development-anon-key>
```

Create the API local configuration:

```bash
cp apps/api/.env.example apps/api/.env
```

The current sign-in/sign-up path needs at least:

```dotenv
PORT=3000
REDIS_URL=redis://localhost:6379/15
RATE_LIMIT_HMAC_SECRET=<at-least-32-random-local-bytes>
POINT_ABUSE_SCANNER_ENABLED=false
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<development-service-role-key>
# Only needed by legacy HS256 projects; leave empty for projects using JWKS
SUPABASE_JWT_SECRET=
PUBLIC_ORIGIN=http://localhost:5173
FEATURE_LEARNING_COURSES_ENABLED=true
FEATURE_COURSE_SHARING_ENABLED=true
FEATURE_COURSE_MARKET_ENABLED=true
FEATURE_PRONUNCIATION_ENABLED=false
FEATURE_LEARNING_AUDIO_PREWARM_ENABLED=false
FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED=false
FEATURE_MATERIAL_AI=false
FEATURE_MATERIAL_AI_LUNA=false
MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS=pdf,png
MATERIAL_AI_LUNA_DISABLED_REASON_CODE=AI_LUNA_DISABLED
AI_SERVICE_URL=http://localhost:8000
AI_CALLBACK_BASE_URL=http://localhost:3000/api
AI_INTERNAL_TOKEN=<same-local-32-byte-secret-as-worker>
MATERIAL_AI_MONTHLY_BUDGET_USD=20
MATERIAL_AI_GENERATION_MAX_COST_USD=0.50
MATERIAL_AI_GRADING_MAX_COST_USD=0.05
MATERIAL_AI_RESUME_TTL_SECONDS=86400
```

Outside production, the first three Courses flags default to on even if omitted, but writing them explicitly is recommended; speech and the translation pre-test always default to off. To test the durable audio queue, also turn on `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED` and use the repository defaults `AZURE_SPEECH_TTS_REQUESTS_PER_MINUTE=20`, `AZURE_SPEECH_TTS_MONTHLY_CHAR_LIMIT=500000`, `LEARNING_AUDIO_PREWARM_INTERVAL_MS=3100`, and `LEARNING_AUDIO_SYNTHESIS_VERSION=1`. To test real Azure, also fill in a development resource's `AZURE_SPEECH_KEY/REGION` and turn on pronunciation; the overall read-aloud pass mark defaults to 70. Do not copy the production key for ordinary course development. `AZURE_SPEECH_FAKE=true` is only for automation, is not a provider smoke test, and is rejected by production processes.

To test the real semantic translation pre-test or 0037's Chinese voice input, fill in a development `OPENROUTER_API_KEY` in the Git-ignored `apps/api/.env`, set `FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED=true`, and keep the default model/base URL/timeout/quotas plus `OPENROUTER_STT_MODEL=fish-audio/transcribe-1` and `OPENROUTER_STT_LANGUAGE=zh`. Never put the key in command-line arguments, browser `VITE_*` variables, screenshots, issues, or test fixtures; file permission 600 is recommended. Ordinary UI/API automation uses `OPENROUTER_FAKE=true`, which returns fixed Chinese text for STT and is rejected in production; it cannot serve as provider evidence. Verify a single real text-grading request with:

```bash
chmod 600 apps/api/.env
node --env-file=apps/api/.env scripts/smoke-openrouter-translation.mjs
```

The script only prints the model, duration, and token metering, never the key, user answers, or the full provider response.

STT must be called through an active translation-first spelling session; never send a WAV to OpenRouter from the browser. The protected-release `smoke-learning-audio-production.mjs` uses Azure to generate a Chinese WAV of the word "apple" (苹果) with no personal data, calls real Fish Audio through the candidate Nalanda API, and only asserts the language, revision/word binding, and the required keyword; local manual verification should reuse the same path. WAVs/transcripts must never be saved to fixtures, logs, or the database.

To verify only the current Azure/OpenRouter keys and the provider wire contract, run `node --env-file=apps/api/.env scripts/smoke-openrouter-transcription.mjs`; by default it synthesizes the fixed "apple" WAV in memory with Azure. Without a local Azure key, put the absolute path of an authorized temporary 16 kHz mono PCM Chinese WAV in `OPENROUTER_STT_FIXTURE_WAV`; the file must not be committed. The script only prints the model, metering, byte count, duration, and a keyword boolean, never the key or transcript. This direct smoke test does not go through Nalanda Auth/RPCs and cannot replace the protected candidate API gate.

`/api/health` probes JWKS/PostgREST, validates the HMAC secret, and runs a real Redis PING; if either Supabase or Redis fails, it returns 503. The API's service-role key also calls the dedicated Courses/points RPCs and `vocabulary-audio`, so it may only live in the API `.env`.

Every `.env`/`.env.local` is excluded by `.gitignore`. Still run `git status --short` before committing to confirm no secret file is staged.

## 6. Start the services

Open four terminals for Redis, the FastAPI worker, the API, and the Web app. If you're only developing non-AI pages, you can skip the worker and keep `FEATURE_MATERIAL_AI=false`.

### 6.0 Redis (local testing)

Without a local Redis, start a temporary container that is not published to the LAN:

```bash
docker run --rm --name nalanda-redis-dev -p 127.0.0.1:6379:6379 redis:7.4-alpine
```

This password-less command is only suitable for one-off local development. Production must use the private network, a separate password, AOF, and `noeviction` from `infra/deploy/docker-compose.yml`; never copy the production Redis URL to your machine.

### 6.1 NestJS API (port 3000)

The API currently has no watch/dev script; rebuild and restart after changing source:

```bash
pnpm --filter @nalanda/api build
pnpm --filter @nalanda/api start
```

Verify:

```bash
curl -fsS http://localhost:3000/api/health
```

The health response must contain both `deps.supabase=ok` and `deps.redis=ok`. If you're only debugging static Web pages that don't use the API, you can skip the API/Redis, but sign-up, Courses, and real business writes won't fully work.

### 6.2 React/Vite Web (default port 5173)

```bash
pnpm --filter @nalanda/web dev
```

Open `http://localhost:5173`. Vite proxies `/api/*` to `http://localhost:3000`, so sign-up requests need no URL changes. The interface opens in English; use the EN/中文 button on the sign-in page or in the top bar to switch languages (the choice is remembered in `localStorage` under `nalanda-locale`).

### 6.3 FastAPI Materials AI worker (port 8000)

```bash
cd apps/ai
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
chmod 600 .env
.venv/bin/uvicorn app.main:app --env-file .env --reload --host 127.0.0.1 --port 8000
```

In `apps/ai/.env`, fill in the same `AI_INTERNAL_TOKEN` as the API. Ordinary automation can set `MATERIAL_AI_FAKE_PROVIDER=true`; only manual real testing fills in a development `OPENROUTER_API_KEY` and keeps it false. The machine also needs LibreOffice, Poppler, and system fonts; the dependencies closest to production are provided by `apps/ai/Dockerfile`.

Verify:

```bash
curl -fsS http://localhost:8000/health
```

Health reports `status=ok` only when OpenRouter, LibreOffice, temporary disk, and the internal token are all ready; a production fake fails. The worker `.env` should also keep `MATERIAL_AI_KNOWLEDGE_MAX_TOKENS=30000`, the same `MATERIAL_AI_RESUME_TTL_SECONDS=86400` as the API, and the two native-file allowlists. The generate/grade/cancel-purge endpoints only accept Nest's internal token; never leave signed URLs or tokens in shell history manually. After the API master switch is on, upload a fixture with no personal data from Materials and verify both "Generate test paper" and "Organize knowledge points". Luna/Ox also need their sub-switches turned on, and the allowlist may only include extensions that passed real format gates.

Local Luna verification must explicitly choose `luna_native_file_v1`: the worker validates the raw bytes downloaded from Storage, MIME, size, and SHA-256, then sends them as inline base64 without running parsers/OCR/DocumentIR and without the OpenRouter Files API. PDF requests must carry `file-parser.native`, and the provider must actually be OpenAI; if the response routing doesn't match, usage is still recorded but the artifact is rejected. A fake provider can only prove orchestration and UI, not these provider facts.

Ox Alpha was retired in 0056–0057; the pipeline and its environment variables no longer exist locally. Real local Luna verification needs an OpenRouter key and confirmation that the actual upstream is Azure; when the catalog has no Azure ZDR endpoint for GPT-6 Luna, the expected capability is disabled, rather than switching to non-ZDR or passing DocumentIR off as success.

Run the Python gates:

```bash
cd apps/ai
.venv/bin/ruff check app tests
.venv/bin/pytest -q
```

## 7. Minimal functional acceptance

### 7.1 Checks without account writes

```bash
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:8000/health
curl -I http://localhost:5173
```

### 7.2 Checks that need a development account

1. Sign up in the Web app with an email used only for development.
2. Confirm that creating the `auth.users` row triggers the corresponding `public.profiles` row.
3. Create a course and upload a small material, and confirm the `materials` private bucket path starts with the user UUID.
4. Create a study task and toggle its completion, and confirm the task and profile reload.
5. Publish a test post with no sensitive content, then delete the test data.
6. Open Courses and create "English vocabulary"; choose per-unit paste or a whole multi-unit word list, first create a line with a format error to confirm the exact highlight, then fix it and enter Review Course Content.
7. Complete all four stages of one unit, refresh to confirm it resumes from the active session; create a 3-day review and see the separate review item in Schedule.
8. Create a share, revoke it, and confirm the old link no longer works; list it on the free Course Market, clone it with a second development account, and confirm the copy has 0 progress and cannot be redistributed.
9. Select a unit after enabling audio prewarming: confirm the manifest changes from pending to ready and the current question plus the next four words enter browser Cache Storage; "Download unit audio" can resume, shows failures/quota pauses, and can delete the local copy. Even if the browser grants persistent storage, it may still evict under storage pressure.
10. Set Offline in developer tools and complete at least two questions in a row, confirming feedback appears immediately and the completion page shows pending sync; after the network returns, the same attempt UUIDs submit serially, and refreshing does not double-count errors. Offline startup of a full Web app shell/PWA is outside this feature's scope.
11. When starting learning/review that includes spelling, verify each case: unchecked behaves as before; with the time limit checked and set to 3 seconds, the countdown starts after the input appears and auto-submits only once; with the translation pre-test also checked, timing must wait until the semantic answer passes. A semantically wrong answer directly creates one spelling error, while provider timeouts/failures only show a retryable error without increasing the wrong count. Both correct and wrong results must show the English spelling together with the separate translations.
12. Materials candidate path: upload a file with no personal data, create a test paper, and confirm the internal `/jobs` returned before the provider finished; after generating a knowledge graph, confirm nodes are in source order, hover/detail is readable, and node questions only cite that node's sources. When simulating a retryable failure, Resume must use the same job ID; past the TTL it returns a stable expiry error, and the checkpoint/worker directory is eventually cleaned up.

If you can't verify "mastery after reviews on two different dates" locally on the same day, don't hand-edit production data; use a throwaway local Supabase RLS fixture, which generates two different `local_date`s in the profile time zone.

These steps write data; never run them against the production project. See the [runnable testing guide](./TESTING.md) for automated commands and test layers.

### 7.3 Courses text import and long-page regressions

Courses with units offer two mutually exclusive input methods:

- **Paste unit by unit**: create/rename units by hand, then paste each word list separately;
- **Whole multi-unit word list**: paste the complete text with headings at once. The translations in this example are Chinese, the language the translation features currently target:

```text
Starter Unit 1
unit 单元
section 部分
other 另外的/其他的
each 每个/各自
each other 互相/彼此

Starter Unit 2
bottle 瓶子
You're welcome. 不客气。
key 钥匙/关键
thing 东西/事情
need 需要
eraser 橡皮
```

Numbered headings can use `Starter Unit 1`, `Lesson 2`, `Chapter 3`, `Module A`, `Section IV`, or the equivalent Chinese numbered forms. Arbitrary custom headings use `[Travel phrases]` or `# Travel phrases`; ordinary text lines without an explicit marker are parsed as entries. An entry is still "one English word/phrase per line + one ASCII space + the translation", with multiple translations separated by `/`.

During development acceptance, confirm:

1. The whole text is split into the right units, and parse errors show the line/column in the whole original text rather than a position relative to the unit.
2. Review/Edit Course shows a two-meaning translation such as `东西/事情` as two separately editable translation inputs; each can be deleted and new translations added.
3. Each existing unit's "Bulk paste words" can append multiple lines, and if they include an existing word it shows `DUPLICATE_EXISTING_TERM` without a partial append.
4. In a word list long enough to exceed one screen, `.content` scrolls to the very bottom, and "Add word", "Bulk paste words", "Add unit", and the save button are all reachable.
5. Unit-less mode still uses a hidden default unit and never mistakes the first entry for a unit heading.

The file entry point only shows an AI parsing placeholder; do not select real materials or expect PDF, Word, JSON, Markdown, HTML, or image upload/parsing.

## 8. Common problems

### The Web app shows "Supabase is not configured"

- The file must be `apps/web/.env.local`;
- Variable names must start with `VITE_`;
- Vite only reads environment variables when the process starts; restart the Web app after changes;
- Never put the service-role key in any `VITE_*` variable.

### Sign-up returns `SERVER_MISCONFIG`

The API didn't read `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`. Make sure it starts in the `apps/api` package context and the file is named `apps/api/.env`.

### Health returns `deps.redis=unavailable`

- Make sure Redis is listening on the local address/DB that `REDIS_URL` points at;
- `RATE_LIMIT_HMAC_SECRET` must be at least 32 bytes;
- Never write the production password into command history; use a separate random value locally;
- When Redis fails, private GETs can degrade and continue, but sign-up and writes return `RATE_LIMIT_UNAVAILABLE` by design; you cannot "fix" this by removing the protection layer.

### `/api/me` returns 401

- The request must carry `Authorization: Bearer <Supabase access token>`;
- `SUPABASE_URL` must point to the same project that issued the token;
- Asymmetrically signed tokens are verified through the project JWKS; only legacy HS256 projects depend on `SUPABASE_JWT_SECRET`;
- Check the system time; significant clock drift makes token time checks fail.

### The Web app signs in but table queries fail

Confirm in order that all migrations are applied, the user has a matching `profiles` row, requests carry a valid session, and the `user_id`/linked course ownership written satisfies RLS. See the [ERD and data dictionary](./ERD.md) for full relationships and policies.

### Courses returns `COURSES_DISABLED` or 404

- Check that the API process actually reads `apps/api/.env`, and restart after changes;
- In production mode the master switch must be set explicitly, and sharing/market also need their own sub-switches;
- sharing/market return 404 on purpose when off; they cannot be bypassed by opening PostgREST;
- Make sure the local database has been reset to the repository's latest migration 0043 rather than stuck on an old migration history; production has evidence up to 0043, and whether any environment has applied it is still determined by `migration list` and release records, not by the files existing.

### Materials AI stays queued or deleting, readiness fails, or it returns a safety error

- The production database baseline is confirmed at 0055, and the current stable app still only exposes the capabilities that were cut over successfully earlier; when verifying Luna/Ox/the graph/the delete lifecycle or the security contract, reset locally to the repository's latest 0055. Redis should be running, the API/worker use the same `AI_INTERNAL_TOKEN`, and the API callback is `http://localhost:3000/api`.
- `FEATURE_MATERIAL_AI=false` is the safe default; only turn it on locally after the fake/real worker health is ready. `MATERIAL_AI_FAKE_PROVIDER=true` may only be used for non-production automation.
- The worker health's `openrouter/libreoffice/tempDisk/internalAuth` point to the dependency; less than 512 MiB of space, a job over 1 GiB, or Office over 120 seconds all fail and release the allowance.
- `PROMPT_INJECTION_REJECTED` covers both malicious and uncertain; never bypass it by changing the prompt or ignoring the result in the frontend. Security teaching material continues only when clearly classified as `benign_educational`.
- When Redis loses messages, the Postgres job is still there and the reconciler re-enqueues it; if the user already has an active job, `AI_JOB_ACTIVE` is returned. Never hand-edit database status or quota.
- `deleting` means the database has settled the allowance but the worker hasn't yet confirmed that the cancel request, Office subprocesses, the 0700 directory, checkpoints, and usage spool are all cleaned up; the reconciler retries. Never hide it from the UI early or fake success by deleting table rows directly.
- When Luna can't be selected, first check the disabled reason from `/api/materials/:id/ai-capabilities`; the master switch, the Luna sub-switch, and the extension allowlist must all allow it. The system must never automatically switch to the old pipeline, and the allowlist must never be widened for formats that haven't passed real gates.

### The translation pre-test returns disabled, timeout, or quota errors

- When `FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED` is off, starting a session that requires `translationFirst=true` fails; spelling with that option off still works.
- Confirm `OPENROUTER_API_KEY` is only in the API `.env`, the model is the repository-locked value, and `OPENROUTER_FAKE=true` is not set in production.
- Provider timeouts, 5xx, or invalid structured responses do not record errors, and users can retry with the same attempt UUID; 425 means the same UUID's lease is still being processed, 409 means another device has advanced the revision, and 429 means the durable user quota has been reached.
- Never replace provider failures with client-side "guess grading"; the server must stay the authority for error facts, the retry pool, and progress.

### Translation voice input doesn't appear, is slow, or fills in an old question

- The entry point only exists at the right end of the spelling translation input with `translationFirst` on; ordinary translation multiple-choice, spelling input, and other text fields deliberately have no microphone.
- Confirm the latest migrations include 0037–0038, the API reads the same `OPENROUTER_API_KEY`, the STT model is `fish-audio/transcribe-1` with language `zh`, and production doesn't enable `OPENROUTER_FAKE`.
- Recording should show a live waveform; after stopping or the automatic stop at 6 seconds it enters a separate "Recognizing" state. Success only fills in the text and never auto-submits; empty/invalid results, timeouts, and provider 5xx/429 do not create answer errors.
- If another device has already advanced the revision/word, the database returns 409 before the call; if the question changes while the provider responds, the Web app discards the late transcript. Don't remove these two layers of protection to "improve the success rate".

### The pronunciation button degrades or scoring is unavailable

This is an allowed degradation: without Azure configuration, browser Web Speech can read aloud and text learning continues. The first audio GET may quickly return `202 AUDIO_PENDING`, and the manifest only becomes ready after the worker generates it; don't treat 202 as a 500. Scoring requires the feature flag, key/region, the current active session/current recognition card, and 16 kHz/16-bit/mono PCM WAV. The browser records at most 6 seconds with echo cancellation/noise suppression/auto gain control off, and does no VAD, volume thresholds, silence trimming, or local "clear speech" rejection; it only does the sample-rate/PCM wrapping Azure requires. Provider/microphone failures should not count as learning errors. A missing private TTS object may show up as Storage HTTP 400 + JSON 404 and should be rebuilt normally; Storage network/permission errors must stay visible and must not be misread as cache misses that consume Azure repeatedly.

### The bottom actions on the Courses create/edit page can't be reached

The current app shell requires the shared `.main` and `.content` to both have `min-height: 0`, with `.content`'s `overflow-y: auto` handling vertical scrolling. First confirm in browser developer tools that `.content` has `scrollHeight > clientHeight` and that `scrollTop` can change; if not, check that `@nalanda/ui/nalanda.css` is actually loaded and that parent flex/grid children don't override these properties. Don't work around the shared scrolling model with Courses-specific fixed heights, `100vh`, or extra `overflow: hidden`; scrolling inside modals is the only separate exception.

### `pnpm --filter @nalanda/api start` can't find `dist/main.js`

Run `pnpm --filter @nalanda/api build` first. The current start script only runs the compiled output.

## 9. Current gaps and target state

- **Current**: there is a Supabase CLI configuration and repeatable empty-database migrations; non-sensitive seeds/fixtures and one-click business test data are still missing.
- **Target**: add a watch mode for the API and a unified `pnpm dev` orchestration.
- **Current production path**: CI has added Python ruff/pytest, AI Docker, BullMQ/Redis, Materials AI fake-provider Playwright, 0041–0043 RLS, and real OpenRouter/2 GB canary release gates; these gates were used for the 2026-08-11 release. The 0046–0051 candidate also covers the 250-node graph, job delete/clear, whole-paper grading, and Luna native files; passing local fakes/unit tests still cannot replace the real OpenAI/production gates still to be run.
- **Target**: complete the protected release of 0046–0051, then open the knowledge list/quiz and Notes editing/export, and build continuous real quality evaluation.
- **Target**: provide scripts for one-click test-data cleanup and isolated test accounts.

Until these capabilities land, the repository's actual scripts and this document's "current implementation" descriptions are authoritative.
