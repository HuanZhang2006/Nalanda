# Nalanda Current Architecture

> **About this document**
> - **Contents**: Records the system structure, runtime data flows, module boundaries, data model, and deployment method that already exist in the repository and production configuration.
> - **Purpose**: Answers "how does the system actually work right now", for development, troubleshooting, reviews, and onboarding; it does not carry the not-yet-implemented final blueprint.
> - **When to update**: When entry points, service boundaries, table structures, RLS, the deployment topology, a module's real/mock status, or key dependencies change.
> - **Future plans**: The final product scope, target architecture, and development path are in [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md).

Last checked: 2026-08-26. The production database has a protected application up to 0055; 0052–0055 completed the timestamp-column Stage B and the Ox pipeline contract, and the originally reserved 0044–0045 were not back-filled. PR #78 fixed the Courses Ox output to the model-supported JSON Object and was merged, but the immutable app candidate of main run `32931681321` automatically restored the earlier stable release after the real DocumentIR DOCX gate failed, and API/AI/Web, Supabase, and Redis were independently confirmed healthy. The failed candidate's initial structural problem was question-type counts; the old repair did not receive the source block text, and comprehensive semantic defects only surfaced after the structure turned green. The current Unreleased fix makes the repair use the full source and adds one bounded semantic repair only when semantic problems are first found after the structural repair; Luna/Ox Materials stay off because ZDR is unavailable. No local pass, single gate, or database launch equals a candidate app cutover. A full offline PWA, payments, and the credits/VIP commercial ledgers are still not implemented.

The 2026-08-14 candidate code (not yet deployed) includes 0046–0051: 0046–0048 switch generation/grading to 202 acceptance + durable callbacks and add two-level checkpoints, incremental usage, the knowledge-point graph, and node Q&A; 0049–0051 add the Luna native-file pipeline, provider provenance, job deletion/clearing with confirmed cleanup, and private cross-device graph layouts. Paragraphs marked "candidate" below describe the current branch and do not change the production facts above.

---

## 1. Summary of the current system

Nalanda is a pnpm/Turborepo single repository: the production Web app consists of a React auth shell, legacy DOM modules, and React Courses/Notes features; authentication and legacy business CRUD use Supabase directly; NestJS provides sign-up, JWT, health checks, Courses/learning/speech/distribution, and the Materials AI/Notes/exam endpoints. 0041–0043 connected Materials AI to NestJS, BullMQ/Redis, and an isolated FastAPI, and it entered the production runtime on 2026-08-11.

In legacy modules, "real backend" mainly means "really writes to Supabase, protected by RLS"; Courses content and learning facts must be written through NestJS + dedicated service-role transaction RPCs. Both paths are deployed, but that still does not make mocks such as Home/Notes/AI Create real capabilities.

## 2. Runtime topology

```text
Browser
  ├─ GET /                 → host nginx → apps/web build output
  ├─ /api/auth/register    → nginx → NestJS → Supabase Admin API
  ├─ /api/me               → nginx → NestJS → Supabase JWKS verification
  ├─ /api/learning-*       → nginx → NestJS → owner check + transaction RPC
  │                          └─ optional translation pre-test → OpenRouter (server-side key, structured judgement)
  ├─ /api/pronunciation/*  → nginx → NestJS → Azure Speech (degradable/circuit-breakable)
  ├─ /api/course-*         → nginx → NestJS → redacted share/market snapshots
  ├─ /api/materials/*/ai-* → nginx → NestJS → durable job / Free quota
  ├─ /api/ai-jobs|notes|exam-attempts/*
  │                        → nginx → NestJS → owner-only transaction RPCs
  ├─ /api/admin/points/*   → nginx → NestJS admin allowlist → service-only RPCs/tables
  └─ Auth / PostgREST / Storage
                           → Supabase Cloud

NestJS → private Docker network → Redis (sliding windows, audit aggregates, scanner distributed lock, BullMQ UUID delivery)

Materials AI: NestJS → durable Postgres job → BullMQ/Redis (UUIDs only) → internal FastAPI → OpenRouter ZDR; enabled in production.
```

Supabase Cloud currently provides:

- Auth: email/password sessions and JWTs.
- PostgreSQL/PostgREST: material courses, learning courses, sessions/attempts/reviews, community, schedule, Profile, growth, distribution, notifications, and feedback.
- Storage: the private materials bucket, the public community media bucket, and a **private** synthesized speech cache bucket deduplicated by content hash across users; no user recordings are stored.
- RLS: the main data isolation boundary.

Production migration history is at 0053: 0039–0040 add and verify direct-PostgREST defenses, frozen reward windows, moderation, and coordination/abuse auditing; 0041–0051 add Materials AI/Notes/online exams, resumable jobs, graphs, and lifecycle facts; 0052–0053 only narrow authenticated UPDATE permission on two derived timestamp columns and verify the final contract. It does not change Materials AI, Courses, points, triggers, RLS, or service-role, and the originally reserved 0044–0045 were not back-filled.

The same-host Redis is a production dependency: Redis only connects to the default compose private network, has no host port, uses password authentication, AOF `everysec`, and `noeviction`; the API uses atomic Lua sliding windows and HMAC(IP/email) keys without storing raw IPs/emails, and uses BullMQ only to deliver durable Postgres job UUIDs. Write/sign-up/clone/report/cost endpoints fail closed when Redis fails, private reads fail open and emit `rate_limit_degraded`; readiness is 200 only when both the Supabase check and the Redis PING succeed, and AI readiness also requires the worker/queue to be ready. The coordination scanner runs every five minutes as a single instance under a Redis token lock, only writes pending signals, and never automatically freezes or reverses.

The frontend currently has no Realtime `.channel()` subscriptions; notifications use queries and manual refresh.

## 3. Repository structure (as it actually exists)

```text
Nalanda/
├─ apps/
│  ├─ web/                 React/Vite auth shell + legacy app
│  ├─ api/                 NestJS Auth/health + Courses/speech/market API
│  └─ ai/                  Isolated Materials parsing/generation/grading worker (Python)
├─ packages/
│  ├─ ui/                  CSS, not a React component library
│  └─ types/               Shared camelCase production contracts for Courses and Materials AI
├─ app/                    Standalone static desktop/mobile high-fidelity prototypes
├─ supabase/
│  ├─ config.toml          Local/CI Supabase baseline
│  └─ migrations/          Sequential SQL migrations
├─ infra/
│  ├─ deploy/              Current production nginx + API + AI + Redis deployment
│  └─ hybrid-2g/           Generic Caddy + API + AI + Redis template
├─ scripts/
│  ├─ db-push.mjs          Legacy Management API emergency script
│  └─ *db-release*.sh      Encrypted release recovery-point and isolated restore tools
└─ docs/                   Architecture, blueprint, implementation notes, and runbooks
```

The repository does not contain `apps/desktop`, `apps/mobile`, `packages/api-client`, `packages/i18n`, or `packages/config`, which the target blueprint once listed.

## 4. Web frontend

### 4.1 Three kinds of entry points

1. The repository root `index.html`: redirects to the static Showcase, only for browsing the design prototype.
2. `app/`: standalone desktop and mobile prototypes, all on mock data; the Showcase shows them side by side in iframes.
3. `apps/web`: the production app. `index.html → main.tsx → App.tsx → NalandaApp.tsx → legacy/app.ts`.

Deployment uses `apps/web/dist`, not the repository root entry point.

### 4.2 The React/legacy boundary

- React owns Supabase session restoration, the sign-in/sign-up UI, the theme, and the mount container.
- `NalandaApp` calls `mountNalanda()` in `useEffect`; it depends on the user ID/email, so switching accounts cleans up the old mount before creating the new session.
- The legacy app still uses module singletons, HTML strings, container-level event delegation, and in-memory routing, but mounting resets the route/user/module state, and a session version discards late async responses from the previous account.
- There is no react-router; URLs, browser history, refresh restoration, and deep links are not implemented yet.
- `packages/ui` only exports CSS; the Web app imports `nalanda.css`, and there are no shared React components.
- 9 legacy TypeScript files use `@ts-nocheck`, so ordinary `tsc` does not cover their internal types.
- **Interface language**: `apps/web/src/i18n.ts` holds the locale (`en` by default, `zh` optional, persisted in `localStorage`). UI copy is written next to the code as `l(english, chinese)`/`localize(english, chinese)` pairs; React components read it through `useI18n()`. The shell's top bar and the sign-in page have an EN/中文 toggle; on change the shell re-renders its own text and legacy views, while React islands (Courses, My Notes) re-render reactively and keep in-progress state. Known Chinese texts generated by database triggers (social notifications, course badge names) are translated for display on the client.

### 4.3 Current module status

| Module | Data source | Status |
|---|---|---|
| Sign in/sign up/sign out | Supabase Auth + Nest sign-up endpoint | Real |
| Materials | Supabase tables + private Storage | Real |
| Community/Post | Supabase tables + public media Storage | Real |
| Schedule | Supabase tables + DB triggers | Real |
| Courses | NestJS + Supabase `learning_*` + React | Real; overall production history is 0043, and the Courses feature migrations are 0011–0038, including explicit cancel, spelling/pronunciation exams, arbitrary word selection, history, the dual-exam exact mastery projection, Chinese STT for translations, and real provider quota reservations |
| Profile/Growth | Supabase Profile + `point_entries` projection | Real; 0008 protects sensitive columns and implements an idempotent reversible ledger |
| Notifications | Supabase table, query refresh | Real, not Realtime |
| Feedback | Supabase table | Since production 0039 users can only insert/read; status/time/owner are maintained by the support workflow |
| Home | `legacy/data.ts` | Mock |
| Notes/four-tab detail | `legacy/data.ts` | Mock |
| Create | Mock Materials + timeout/toast | Mock |
| Market / Note Market | `legacy/data.ts` + toast | Note Market is still a mock |
| Market / Course Market | NestJS redacted immutable snapshots | Real; free clones only, enabled in production |
| Courses AI file import, other categories | Disabled entry points | Not implemented |

The old Materials/Community/Profile/Schedule/Feedback mock views remain in `legacy/app.ts` but are overridden at runtime by the real mount points at the end of the file; they are a duplicate implementation waiting to be cleaned up.

### 4.4 Supabase access

`apps/web/src/lib/supabase.ts` creates the client from the build-time `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Real modules call directly:

- `sb.from(...)` for PostgREST.
- `sb.storage.from(...)` to upload, delete, or sign access to files.
- User isolation relies on database RLS, not frontend `.eq(user_id)`.

`authedFetch()` adds the Bearer token to NestJS requests and is used by the Courses Web API client; Supabase `{ error }` is converted into a uniform visible error, and a cross-account mount clears the Courses singleton state.

## 5. NestJS API

Global prefix: `/api`. The base endpoints are:

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/api/health` | None | Probes Supabase JWKS/PostgREST, validates the HMAC secret, and runs a real Redis PING; 200 only when both dependencies are healthy, otherwise 503 |
| POST | `/api/auth/register` | None | Creates an `email_confirm:true` user with service-role |
| GET | `/api/me` | Bearer | Echoes the claims after the JWKS/HS256 guard verifies |

The JWT guard prefers the Supabase JWKS and verifies issuer/audience; the HS256 fallback verifies the configured signature and claim boundaries. The Courses controllers also provide course CRUD, session resume/answering, review schedules, Profile aggregation, speech, sharing, the market, cloning, reporting, moderation endpoints constrained by configured administrators, and the server-side OpenRouter semantic translation pre-test. See the [API docs](guides/API.md) for the full table.

New endpoints share the `@nalanda/types` camelCase contract, the API explicitly converts database snake_case, and a global exception filter returns `{ code, message, fieldErrors? }` uniformly. Speech has per-user/global budget rate limits; the market has publish/report rate limits; the translation pre-test has database leases, UUID/answer-hash idempotency, and user quotas. 0037 adds Fish Audio Chinese STT within the same OpenRouter server adapter boundary: the browser only uploads a short WAV for the current question, the database first validates owner/session/revision/word and reserves a separate quota, and the provider result only fills an editable input without advancing learning. The OpenRouter key/model exist only in the API/AI environments, and the browser cannot submit reference answers or provider parameters; user answers, recordings, and STT transcripts are only processed in request memory, and the persistence layer keeps only the necessary hash/judgement/metering facts. There is a dedicated Materials durable queue, but still no general generation queue, payment module, or automatic OpenAPI generation.

## 6. FastAPI AI service

Production 0041–0043 replaced the original fixed stubs: FastAPI only accepts internal requests with `X-AI-Internal-Token`, and in a separate 0700 temporary directory runs deterministic parsing, two safety reviews, failed-region visual recovery, strictly structured test-paper generation, and batch subjective grading. The fixed models are DeepSeek V4 Flash 0731 and MiMo V2.5; provider requests force ZDR, deny data collection, require parameter support, and disable reasoning/tools/Web/cross-model fallback, so reasoning tokens don't swallow the strict JSON completion. The same fixed model fails over, throughput-first, among provider endpoints that still satisfy every privacy/parameter filter.

The 0046–0048 candidate turns API→worker into short requests: Nest uses an explicit Undici Agent, gets a 202 within 30 seconds, and the worker later calls back progress, usage, checkpoints, and complete/fail. Business jobs are thus no longer controlled by the built-in roughly 300-second response headers timeout, and transport timeouts map accurately to `AI_WORKER_TIMEOUT`. Postgres remains authoritative; Redis only schedules UUIDs. BullMQ's single concurrency slot is not released immediately after the 202, but polls Postgres until the job leaves processing/grading or the lease expires, preventing long jobs from piling up in FastAPI memory and letting not-yet-started job leases expire. The worker also has a 1200-second total generation budget and a 240-second total grading budget to prevent occupying the slot forever; a generation timeout keeps the durable checkpoint and allows resuming within the window.

The full generation path is:

```text
User Materials file
  → NestJS owner/format/allowance/consent checks
  → Postgres atomic reservation + generation_job
  → BullMQ schedules only the job UUID; the reconciler re-enqueues
  → FastAPI DocumentIR deterministic parsing
  → DeepSeek text completeness/injection review
  → Only first-round uncertainty confined to parser failure regions may enter isolated recovery
  → Only diagnosed and review-failed regions go to MiMo
  → Stitch the full DocumentIR and run the safety review again
  → DeepSeek generates GeneratedExamV1 or GeneratedKnowledgeGraphV1 from a versioned prompt
  → Test papers deterministically normalize metadata, duplicate IDs, and feasible marks allocation from server settings
  → schema/question count or nodes/edges, answers/explanations, sources, and semantic validation
  → Source-aware bounded repair: once each for initial structure/semantics; semantic defects newly found after the structural repair may be repaired once more
  → Save Notes and consume in a single transaction; failure/cancel releases
```

The first-round review is not a safety exemption: `material-safety-audit.v2` only defers handling of `uncertain` and enters visual recovery when there are no deterministic body/focus injection signals and every reported location belongs to a parser-declared failure region. Parser failure regions always trigger recovery, even if the model omits `failedRanges`; a missing renderable region fails. After the recovered result is stitched back, it must pass a strict second review, and any `uncertain/malicious` still ends with `PROMPT_INJECTION_REJECTED`.

DocumentIR's `exam-generate.v4` treats source blocks as untrusted evidence, not instructions, in both generation and repair. The repair payload must carry the full allowlisted `sourceBlocks`, `allowedBlockIds`, `repairGate`, and the current candidate together; giving only IDs leaves the model without the factual source when filling in questions. After each repair, deterministic structural validation runs first, and after the structure passes, the semantic review runs again. The second repair may only handle semantic defects "newly found after the first-round structural repair"; if the second semantic review still fails, the job ends, so the grounding, answer, distractor, and explanation quality bars are never lowered and no unbounded provider retries occur.

Postgres is the source of truth for jobs, allowances, results, and exams; Redis/BullMQ only deliver. The candidate implementation saves `parsed/audited/document_ready/artifact_ready/answer_ready` to private database checkpoints with a TTL; the worker keeps a short-lived recovery copy of a higher stage and the usage spool in the same 0700 directory. When API callbacks are briefly interrupted, the next lease first back-fills cost and recovers validated results without repeating paid stages. Success/non-retryable terminal states clear the directory immediately, and the default 24-hour expiry is cleaned up from both sides by the database reconciler and the worker sweeper.

The candidate worker routes are `GET /health`, the fast-accepting `POST /internal/materials/jobs` and `POST /internal/exams/jobs`, plus the synchronous `POST /internal/materials/exam` and `POST /internal/exams/grade` kept for the compatibility observation period. Every internal write route requires a constant-time token comparison; FastAPI's default 422 does not echo signed URLs/callback tokens. The synchronous routes are only for rolling back to the previous immutable app and for direct provider quality gates, and must not become the production long-job path again.

### 6.1 Contract boundaries

The public Web/Nest contract comes uniformly from the camelCase `GeneratedExamV1` in `@nalanda/types`; Nest converts database snake_case explicitly, and Python Pydantic uses the same camelCase JSON with `extra="forbid"`. After generation, test papers overwrite mechanical metadata with the server request settings, normalize duplicate IDs, and stably adjust marks by the model's relative weights when the question count and the 1–100 marks-per-question bounds allow it; this step never changes stems, answers, explanations, rubrics, or sources, and full structural and semantic gates still follow. Exam sessions remove answers, explanations, rubrics, and accepted answers, giving only the fields needed to answer; the generator's own Notes detail can still show the full answers — this is a self-study product, not an anti-cheating exam system.

The historical demo shapes of the knowledge list and standalone quiz do not pose as real contracts and still show Coming soon. The candidate `GeneratedKnowledgeGraphV1` is a new real contract: nodes are in source order, with levels, detailed explanations, examples/formulas/misconceptions/self-checks, and strict citations; edges have restricted relationship types. Node Q&A only uses the selected node, its neighbors, and the source blocks those two kinds of nodes cite, and answers cannot go beyond that union of sources. The candidate still has no embeddings, pgvector, Notes editing, export, credits, or payments.

### 6.2 Luna native files and job cleanup candidate (0049–0051, 0056–0057)

When creating a job, the Web app must explicitly send `pipeline`. `GET /api/materials/:id/ai-capabilities` only marks Luna as available for formats that passed real per-format gates and are allowed by `MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS`; the default candidate allowlist is PDF/PNG. `luna_native_file_v1` downloads the raw bytes from private Storage, validates the declared size, MIME, and SHA-256, and sends them as inline base64 to the fixed `openai/gpt-6-luna`: PDFs use `type:file` + `file-parser.native`, and images use `image_url`. This path does not call parsers, OCR, LibreOffice, DocumentIR, or the parse cache, and does not use the Files API, which would create remote workspace retention. Every request forces `provider.only=["azure"]`, `allow_fallbacks=false`, ZDR, deny data collection, require parameters, strict schema, and no tools/Web; usage is recorded first, and if the actual upstream is not Azure, the completion transaction rejects the artifact while keeping the cost evidence.

0054–0055 added a third `ox_alpha_native_file_v1`; that model has been removed from OpenRouter and was never enabled in production, and 0056–0057 narrow the pipeline constraint and every service-role RPC back to DocumentIR/Luna, with the app, gates, and environment variables no longer containing Ox ([ADR-0016](adr/0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md)).

The protected release also reads OpenRouter's live ZDR endpoint catalog. Only when the catalog contains `openai/gpt-6-luna` with `provider_name=Azure` and the endpoint is available does it run the Luna native-file gate and allow changing `FEATURE_MATERIAL_AI_LUNA` from false to true; otherwise the native-file capability stays off, `OPENROUTER_ZDR_UNAVAILABLE` is returned as the reason, and users explicitly use DocumentIR. The 2026-10-03 catalog showed GPT-6 Luna's ZDR endpoints are only Azure (`azure`, `azure/us`, `azure/eu`), and first-party OpenAI still does not meet ZDR; a release must never turn off ZDR, allow fallback, or automatically pick the old pipeline to fake Luna success.

Courses non-literal translation judging is independent of Materials: it is fixed to `nvidia/nemotron-3-super-120b-a12b:free` + Nvidia-only and only sends minimal server-side word-meaning context; its real text gate cannot replace the ZDR gate for Materials native files.

The knowledge-graph canvas loads React Flow and ELK dynamically, building left-to-right lanes by level with sourceOrder constraining order within a level; association edges are de-emphasized as dashed lines. Collision resolution runs after node drags and after auto-layout, and positions/viewport are saved to the owner-private `knowledge_graph_layouts`. When an artifact is revised, only positions of node IDs that still exist are reused, and on a revision conflict the Web app fetches the latest layout, merges non-overlapping nodes, and retries. Details always sit outside the canvas: on the right on desktop, below on mobile; hover/focus previews temporarily, click pins, and Esc releases.

Deleting a job first has a service-role transaction lock the row and enter `deleting/cleaning`: queued releases the reservation, a processing job already accepted by the worker consumes one run, and terminal states do not roll back historical allowances. BullMQ removes the pending delivery item and then calls the worker cancel/purge; the worker cancels the HTTPX await and the Office process group, replays the usage spool first, and then deletes the 0700 directory/checkpoint. The job/events/checkpoint are hard-deleted only after the worker returns `purged=true`; when the worker is unreachable the reconciler retries, and the UI stays on Cleaning up. Provider usage's job UUID is a non-FK audit reference and is kept after the job is deleted.

## 7. Database and Storage

### 7.1 Current tables

| Domain | Tables |
|---|---|
| Users | `profiles` |
| Course materials | `courses`, `materials` |
| Notifications/feedback | `notifications`, `feedback` |
| Community | `posts`, `comments`, `post_likes`, `post_favorites`, `follows`, `tags` |
| Schedule | `study_goals`, `study_tasks` |
| Growth points/anti-abuse (production 0039) | `point_entries`, `point_event_states`, `point_daily_windows`, `point_daily_award_claims`, `point_moderation_actions`, `point_abuse_signals` |
| Learning content | `learning_courses`, `learning_course_units`, `learning_course_words` |
| Learning facts | `learning_sessions`, `learning_session_items`, `learning_attempts`, `learning_word_progress`, `learning_spelling_translation_assessments` |
| Review | `learning_review_schedules` |
| Sharing/market | `learning_course_shares`, `learning_course_publications`, `learning_course_reports`, `learning_course_moderation_actions` |
| Course badges/speech quotas | `badge_definitions`, `user_badge_awards`, `learning_speech_usage` |
| Materials AI plans/allowances | `ai_plans`, `ai_user_plans`, `ai_daily_usage` |
| Materials AI jobs/caches | Production: `generation_jobs`, `generation_job_events`, `ai_material_parse_cache`, `ai_provider_usage_events`; the 0046–0051 candidate adds checkpoints, `knowledge_node_questions`, usage `event_id`/upstream/pipeline, job cleanup states, and `knowledge_graph_layouts` |
| Private Notes/sources | `notes`, `note_materials`, `note_artifacts` |
| Online exams | `exam_attempts`, `exam_attempt_answers`, `exam_attempt_operations` |

See the [ERD](guides/ERD.md) for full relationships, fields, and policies.

### 7.2 RLS overview

- `profiles/courses/materials/notifications/study_*` use owner-only row policies; Profile also protects server fields with column-level UPDATE grants and triggers. 0039 split Feedback into owner SELECT/INSERT, with no UPDATE/DELETE for users.
- `posts/comments` are publicly readable by authenticated users, with author write/delete; 0039 narrowed post INSERT/UPDATE to a content-column allowlist, with triggers maintaining owner, author snapshot, counters, business key, and time.
- likes/favorites only allow users to read and write their own records.
- follows can be read by both parties, and created/deleted by the follower.
- tags are publicly readable by authenticated users and currently also allow arbitrary inserts.
- The private `materials` bucket is isolated by the `user_id` in the first segment of the object path.
- `community-media` is a public bucket, with writes/deletes restricted to the user's folder.
- `point_entries` only lets users read their own entries; clients cannot write directly, and `point_event_states` plus the claim/moderation/signal/audit tables added in 0039 are completely hidden from clients. service-role only forms reward and moderation transitions through controlled functions.
- `learning_*` private tables only allow owner reads; clients cannot write content, sessions, attempts, progress, schedules, badges, or rewards, and the judgement fact table does not even grant owner SELECT. Writes go through the API calling service-role RPCs with `public/anon/authenticated` permissions revoked.
- Share/publication/report/moderation tables are not open to anonymous PostgREST. Anonymous share and market reads can only go through the API, which returns escaped, redacted snapshots; publication snapshots are kept immutable by a trigger.
- The production 0041–0043 AI private tables allow authenticated users to SELECT their own plan/allowances/jobs/events/Notes/answer sheets; the parse cache, provider usage, and operation idempotency tables have no client access. The 0046–0051 candidate further makes checkpoints completely server-private, knowledge Q&A owner-SELECT only, and graph layouts owner-SELECT only with no direct writes; every create/delete/cleanup/layout/usage/completion RPC is granted only to the service role. Provider usage's job/attempt UUIDs are immutable audit references, and the new event UUID prevents disconnect replays from double billing.

### 7.3 Closed items and remaining data-integrity boundaries

- 0008 closed Profile sensitive-column writes, client EXECUTE on internal RPCs, and points accumulation through like/comment/original/repost/task delete-and-redo.
- Points use append-only entries, durable event state, stable business keys, and reversals; Profile's points/level are just ledger projections. The pre-migration cache was first recorded as `legacy_opening`, then zeroed by a reversal appended in 0009, and cannot be traced as trustworthy per-entry history.
- Courses attempts are append-only and progress is a protected projection; reviews only write distinct local dates and accumulate review counts when the session completes. The +20 course reward uses a SHA-256 business key of the user and the normalized distinct word set, so deleting/recreating/cloning cannot claim it twice.
- 0039 completed the post owner/snapshot/counter/time boundary with a content-column allowlist and defensive triggers; the compatibility period only kept the `updated_at` grant, whose values the server overwrites.
- 0039 verifies that `study_goals.course_id` and a task's course/material/goal all belong to the record owner; it does not force the material to be in the same course as task.course_id, which remains a product-level consistency improvement.
- 0039 removed Feedback UPDATE/DELETE; status is only maintained by the service-role support workflow.
- Deleting Storage files and metadata is not transactional; community media has orphan files.
- Production 0039 implements frozen points decisions, daily scoring caps, manual root-chain suppress/restore, and pending-review-only coordination signals. Content-quality detection, automatic penalties, and a moderation UI/appeals are still not implemented; credits/VIP are write-locked but have no commercial ledger of record.

The remaining authorization/integrity items still belong to stage A; commercial ledgers, anti-abuse, and Storage governance must be completed before the corresponding features open.

## 8. Current deployment

### 8.1 Production approach

On the runner, GitHub Actions:

1. Runs the docs check, workspace typecheck, Vitest/jsdom/API tests, and build.
2. Automatically stages every migration from 0008 on, first verifying the 0007 historical data upgrade, opening reversals, and the latest release assertions, then rebuilds a local Supabase from an empty database, lints, and runs real RLS/Storage/points/Courses E2E.
3. Starts Web/API with Azure/OpenRouter fakes and runs Playwright with fixed WAVs: sign in → multi-unit creation → error correction/reordering → four stages (including the timed spelling test, translation pre-test, voice fill-in, and three live waveforms) → refresh to resume → schedule a review → publish/clone as another user.
4. When there are new migrations, completes dry-run, an encrypted recovery point, CLI push, and verification through the protected environment; failures block the app.
5. Builds the Web app and same-Git-SHA API/AI images, and uploads them via SSH/SCP with a pre-verified host key; the server does not build.
6. The production host first starts the isolated AI/candidate API with `FEATURE_MATERIAL_AI=false` and runs the 2 GB Office canary, fixed real DeepSeek/MiMo samples, temporary directory cleanup, and the existing Azure/OpenRouter/Courses gates; on failure the release is not activated.
7. After Supabase/Redis/AI readiness and authentication pass, it turns on the flag, runs the full signed-in user Materials → queue → Notes → exam → grading → delete smoke, and finally atomically switches the Web release and verifies the public Web/API.
8. If app verification fails, it automatically restores the previous immutable Web/API release; the database keeps backward-compatible forward migrations.

On the server, host nginx serves `/opt/nalanda/web` and reverse-proxies `/api/` to the API container bound only to `127.0.0.1:8411`. The current production compose also runs Redis and FastAPI AI, open only on the private network; AI publishes no host port and only accepts the API's separate internal token.
The worst case of a legitimate whole-course Courses JSON exceeds nginx's default 1 MB: the repository's reference server block and the Nest body parser are both set to 10 MB; scoring multipart is still 2 MB. CI does not automatically change the certbot-managed live site, so before first enabling it, nginx must be synced and reloaded per the release runbook.

### 8.2 Generic 2 GB template

`infra/hybrid-2g` can start Caddy, API, AI, and Redis; it remains a generic reference template. The current production nginx, API, AI, and Redis configuration is all in `infra/deploy`, which does not use this template's Caddy topology.

### 8.3 Release limitations

- API health really verifies Supabase JWKS/PostgREST and the Redis PING/HMAC configuration, and AI health verifies worker/queue/internal dependencies are ready; they still don't call real models continuously, and don't cover Storage, sign-up writes, full RLS, or the browser sign-in path.
- Azure Speech and OpenRouter regression/Playwright automation use fake providers; before production activation, real provider gates run separately with the server keys. 0037–0038 shipped on 2026-08-04 after passing the gate Azure-synthesized Chinese WAV → Nalanda API awaiting activation → real Fish Audio; `transcriptionMatched=true` proves the fixed sample and the endpoint/key/credit worked at that time. That single synthetic sample still does not represent real accents, physical microphones, continuous availability, accuracy, or cost reconciliation.
- The database release archive still does not contain Storage file bytes, and CI does not automatically reverse production data.
- Immutable images/releases are still mainly kept on a single server, with no off-site registry or automatic capacity policy.
- The SSH deployment user is root in the current docs.
- The repository nginx file does not contain the full TLS state certbot actually generated.

See [database release and rollback](operations/DATABASE_RELEASE_ROLLBACK.md), [backup and recovery](operations/BACKUP_RECOVERY.md), and [monitoring and alerting](operations/OBSERVABILITY_ALERTING.md) for operational procedures.

## 9. Build, test, and quality boundaries

- Node 20, pnpm 9.12.3, Turborepo.
- The Web app uses Vite; `vite build` is not the same as TypeScript type checking.
- The Python AI is not part of the pnpm workspace and needs to be installed and started separately.
- See the [testing guide](guides/TESTING.md) for runnable test commands and environment requirements.
- The default `pnpm test` runs Web jsdom, API/Courses/Materials AI unit tests, and release-tool tests; without the explicit local switch, the real RLS suite skips safely. The PR/main workflow starts a throwaway local Supabase and runs the 0007→latest migration upgrade fixture, an empty-database rebuild, two-user RLS/Storage/points/Courses/Materials AI E2E, and the Courses and Materials → Notes → Exam Playwright; manual hosted runs still need an isolated project and a second ref confirmation.
- "Verified" in historical implementation notes must map to repository tests; old verifications that can't be reproduced are historical records only.

## 10. Current top risks

- 0046–0051 have not been applied to real Supabase/the production app, so long-job recovery, the graph, and Luna can only be called candidate implementations; the gates must be closed by CI migration/RLS, real OpenRouter/OpenAI, and a public smoke test.
- Within the TTL, worker checkpoints contain private DocumentIR/validated artifacts. Directory permissions, disk watermarks, the sweeper, and "never back up/log the content" are security controls; it is still sensitive data if the host is compromised.
- Prompt-injection detection cannot be mathematically guaranteed correct; node questions are untrusted data too. Every model output must pass the schema, citations, and product constraints, and models never get tools/Web.

1. Independently fix and re-verify the latest main's real Materials AI PPTX provider gate; the 0052–0053 database contract is complete in production, and an app release must not be faked by loosening the provider gate or retrying for luck.
2. During phase-one production observation, check points cap/moderation/coordination signal false positives, projection differences, and Redis degradation; then add a full moderation UI/appeals and content-quality detection. Build a separate commercial ledger for credits/VIP.
3. Before implementing Courses AI file import, unify the model contract, human confirmation, evaluation set, cost, and privacy retention; the current disabled entry point does not count as a capability.
4. Build continuous metrics, cost reconciliation, and a moderation workbench for the live Courses/Azure/market; run database/Storage/TTS cache recovery and alert drills.
5. Gradually remove `@ts-nocheck`/the legacy duplicate implementations, add URL deep links, and complete API HTTP/browser E2E for the legacy modules.

See [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md) for processing order and acceptance gates.
