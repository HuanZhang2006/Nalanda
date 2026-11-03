# Nalanda Final Project Description, Product Blueprint, and Development Roadmap

> **About this document**
> - **Contents**: Defines what product Nalanda will ultimately become, the target system boundaries, the full feature scope, technical principles, the phased development path, and the list of work still to implement.
> - **Purpose**: The single authoritative document for the project's "final goal and what to do next"; every future-tense product or architecture plan should be collected here.
> - **When to update**: When product scope, key technical decisions, phase priorities, dependencies, or milestone acceptance criteria change; status must also be synced at the end of every phase.
> - **Status convention**: This document records both the "current baseline" and the "target state". Content marked "target/planned" must never be written as implemented in the README or the current architecture document.

Last checked: 2026-10-03. The production database has a protected application up to 0055; 0052–0055 are live, and the originally reserved 0044–0045 stay unused. main run `32931681321` automatically restored the old Web/API after the real DocumentIR DOCX gate found that "the structural repair had no source text, and semantic defects newly found after the structural pass had no repair stage". The current Unreleased `exam-generate.v4` uses the full source and a strictly bounded follow-up semantic repair, and 0056–0057 retire Ox Alpha and upgrade Luna to GPT-6 Luna + Azure ZDR ([ADR-0016](adr/0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md)); database migrations, local tests, partial real gates passing, or a merged fix must not be written up as the app/Luna being live.

As of 2026-08-14, code and the database occupy 0046–0051: 0046–0048 implement Materials AI long-job async callbacks, 24-hour resumable checkpoints, the knowledge-point graph, and node Q&A; 0049–0051 implement Luna native files, cancellable cleanup, provider provenance, and cross-device graph layouts. The database changes are applied, but the app still needs a successful immutable release, and Luna is also constrained by the live ZDR/OpenAI gate. Stage B uses 0052–0053 to avoid using `--include-all` or rewriting the existing migration history to fill the empty 0044–0045 numbers.

---

## 1. One-sentence definition

Nalanda is a multi-platform AI learning and knowledge platform for university students: it turns course materials into structured knowledge assets that can be studied, tested, connected, and shared, and builds planning, community, growth, and compliant trading around those assets.

The final product must form this loop:

```text
Course materials → parsing/retrieval → AI generation → learning and quizzes → planning and review
    ↑                                                                          ↓
    └──────────────── personal notes, community, market, growth feedback ──────┘
```

## 2. Current baseline (not the final completed state)

As of 2026-08-11, the project is "a high-fidelity Web app + real Supabase business modules + the first live version of English Courses + a minimal Materials AI loop + private Redis request protection/job delivery":

- Live: email/password sign-up/sign-in, Materials, Community, the ordinary study plan, Profile, activity points/levels, notifications, feedback, and the Web/API/AI production deployment; production migration history is at 0053, but after the latest app candidate failed, the earlier stable release still serves traffic.
- Live: Courses English word-list text import/editing, four-stage learning, review mastery, Schedule/Profile, badges/+20 points, public sharing, the free course market, and Azure Speech; production flags are on, and fakes have not entered production.
- Live increment: 0015–0016 changed ordinary answering to client-side predicted feedback within one frame, an idempotent serial `attemptId + expectedRevision` outbox, and a single-RPC session snapshot, and use a durable Supabase Storage queue plus browser Cache Storage to prefetch/download unit audio; the server alone still decides progress and growth facts.
- Live increment: 0017–0018 immediately cache or raise the generation priority of the current word and the next four words whether ready or pending, keep polling the manifest, and replace browser speech once ready; active sessions now resume by the exact intent of initial learning, ad-hoc review, or scheduled review, so pausing learning no longer hijacks another unit's review.
- Live increment: 0019–0020 add an optional 3–300 second time limit and an optional OpenRouter semantic translation pre-test to the spelling test; the server manages leases, judgements, and the authoritative spelling attempt with the same UUID/revision, and the database does not store the user's input text. Normalized exact matches take the zero-token deterministic path, and only non-literal synonyms/paraphrases call the fixed OpenRouter model.
- Live increment: 0021–0022 unify spelling text normalization between the Web app's instant judgement and the database's authoritative judgement; full-width/half-width uppercase, Unicode whitespace, curly/straight apostrophes, and common hyphen variants are consistent, punctuation still cannot be omitted, and the client no longer judges correct only for the server to reverse it and add the word to the retry pool.
- Live increment: 0023–0024 judge spelling answers correct when they only omit, replace, or add punctuation, without changing the server authority boundary; real letter, digit, word-order, and non-punctuation inter-word spacing errors are still wrong.
- Live increment: 0025–0026 add an explicit cancel transaction for active learning/review; 0027–0028 add the end-of-round spelling mistake list with manual confirmation, unit exams with an adjustable threshold defaulting to 90%, and per-user quotas of 20/minute and a rolling 500/24 hours counted only for real OpenRouter requests.
- Live increment: 0037–0038 add Fish Audio STT, defaulting to Chinese, for pre-spelling translation input, and a live waveform for every user recording entry point. Recognition only fills editable text and never auto-submits; NestJS reuses the same server-side OpenRouter key, and the database validates owner/session/revision/current word and reserves a separate quota before the call. On 2026-08-04 this passed a protected database release, the real Fish Audio gate, and immutable production activation.
- Partially landed: the main app still has many `legacy` DOM modules, while Courses is a React feature. Supabase is the main backend for the older business logic, and NestJS owns Courses privileged writes and redacted public reads.
- Still mock/not implemented: Home aggregation, the standalone AI Create, the knowledge list, the standalone Quiz, and Note Market; the historical hard-coded data in My Notes stays in a Demo group.
- Live: phase one of Materials AI — Generate test paper, private Notes, online exams, and subjective grading. The unreleased candidate also completes knowledge-point organization, the interactive graph/node Q&A, and resumable long jobs; these must not be marked live until the protected release completes.
- Interface language: the Web UI defaults to English with an EN/中文 toggle that switches the shell and every page, including Materials and My Notes; AI output language is still chosen per job.
- Not implemented: AI import of PDF/Word/JSON/Markdown/HTML/images into Courses and the other three course categories; pgvector/RAG, Stripe, a credits ledger, VIP settlement, Realtime, Electron, React Native, and a general admin back office. Production Redis is used for API rate limiting, audit aggregation, the coordination scan lock, and BullMQ UUID delivery.
- Security baseline progress: production has applied 0008–0053, and trusted fields on Profile/posts/Feedback/Schedule and internal `SECURITY DEFINER` RPCs are locked down; points use frozen daily caps, a reversible idempotent ledger, manual moderation, and pending-review-only coordination signals; the old `legacy_opening=11` was zeroed by `legacy_opening_reset=-11`. Courses and Materials AI private writes/RPCs/distribution, idempotent operations, quotas, layouts, and job cleanup facts all pass two-user RLS and release assertions; new apps are still judged by separate release evidence.
- Live: 0039–0040 and the compatible app were observed for more than 24 hours from `2026-08-10T09:35:34Z` and passed the go/no-go on 2026-08-22; 0052–0053 then revoked the two authenticated compatibility UPDATE grants, and the remote 0053 self-verification passed.

The authoritative description of current facts is in the [current architecture](ARCHITECTURE.md); commercial values and state machines are in the [points, wallet, VIP, and payment rules](product/POINTS_CREDITS_VIP_PAYMENTS.md).

## 3. Final product scope

### 3.1 Identity, profiles, and permissions

Target capabilities:

- Email verification, sign-in, sign-out, password recovery, OAuth.
- User Profile, language, school, major, year, and learning preferences.
- `user / creator / moderator / admin` roles with least privilege.
- User data export, account deletion, statutory retention, and auditing.

Current gap: email ownership is not verified; password recovery, OAuth, general admin roles, data export/deletion workflows, and CAPTCHA are missing. Dual Redis/HMAC rate limiting on sign-up by IP + normalized email is live.

### 3.2 Courses and material library

Target capabilities:

- Courses, terms, instructors, material categories, search, pagination, and bulk management.
- PDF, PPTX, DOCX, Markdown, HTML, TXT, and controlled image input.
- Upload size/MIME allowlists, malicious-file detection, parse status, versions, and deduplication.
- Private Storage, short-lived signed URLs, orphan-file reclamation, quotas, and lifecycle rules.

Current gap: basic CRUD/preview is complete; server-side upload constraints, quotas, parse status, versions, scanning, and automatic cleanup are missing.

### 3.3 Courses (learning courses)

The first version of English vocabulary learning is live: per-unit/whole multi-unit text paste, exact error positions, structured editing, CMUdict IPA, resumable four-stage learning, cross-day review facts, review Schedule, Profile aggregation, persistent badges, fingerprint-idempotent +20 points, read-only sharing, and the free course market. It uses an independent `learning_*` model and does not change Materials' `courses` table; the Courses feature migrations are released up to 0038, overall production migration history is at 0043, and the corresponding flags are on. 0025–0028 further shipped explicit cancel, end-of-round spelling mistake review/confirmation, unit exams with an adjustable threshold defaulting to 90%, and a rolling 500/24-hour quota counted only for real OpenRouter requests.

0029–0034 had a protected release on 2026-08-03, adding, without changing the points/payment boundaries, the pronunciation exam, arbitrary word selection within a unit for review/exams, automatic end after completing practice for a failed exam, exam history details, per-word learning properties in the editor, and the single mastery rule "a word is marked learned only after passing both the spelling exam and the pronunciation exam"; cross-day review keeps only practice dates/counts and no longer creates mastery.

0035–0036 had a protected release on 2026-08-04; they add no new path to mastery but turn the rule above into an enforced exact projection on the progress table: `learned_at` can only equal the later of the spelling/pronunciation exam pass times, and is null when either fact is missing; initial learning, review, a single exam, or direct assignment cannot bypass it. In the same release, the Web app removed local VAD/silence trimming that wrongly rejected quiet speech, and the full recording only gets the PCM format conversion the Azure contract requires before Azure judges it.

0037–0038 had a protected release on 2026-08-04: the translation input in translation-first spelling can record speech, Chinese by default, recognized by the server-fixed OpenRouter `fish-audio/transcribe-1`, which only fills editable text without auto-submitting or grading; word read-aloud, the pronunciation exam, and translation voice input share a live waveform. WAVs/transcripts are not persisted to the database or Storage, and clients cannot choose the model/language/key or bypass owner/session/revision/current-word and quota checks.

Live performance/weak-network increments: the answering UI decides correctness locally, while the server alone still decides the retry pool, cursor/stage, error counts, completion, points, and badges; the IndexedDB outbox is serialized by revision and replayed with the same attempt UUIDs, and on conflict it pulls a single snapshot and replays the still-compatible answers. Audio uses a global SHA-256 of the normalized word, locale, voice, format, and synthesis version; private Storage is the only server-side source of truth, and the browser only keeps rebuildable Cache Storage copies that users can delete; this is not a full offline PWA.

In current production, users starting learning/review that includes spelling can choose no time limit or a 3–300 second limit, and can type the translation first. The time limit only controls when the answer auto-submits and does not change server authority; the translation is first checked by NestJS for a normalized exact match, and non-literal answers are judged by OpenRouter with a fixed structured schema; a wrong answer directly creates one spelling error, and spelling timing starts only after a correct one. Provider failures don't count as errors, the answer text is not persisted, and results show the correct English and split translations whether correct or not. This is a narrow judging capability within word practice and does not mean AI file import or a general generation chain is complete.

Explicitly not implemented: PDF, DOC/DOCX, JSON, Markdown, HTML, image OCR/parsing; choosing prompts by English vocabulary/knowledge points/reading comprehension/question bank training; structured model output and human confirmation; an import evaluation set, tokens/cost, and privacy retention. The entry point must keep saying "AI parsing coming soon" and must not accept files or imply a model was called.

Next steps, in order: keep observing error rates and cost for Courses/sharing/market/Azure → build a file isolation/scanning/parsing pipeline with human confirmation → open other course categories behind evaluation, cost, and privacy gates.

### 3.4 AI creation and personal notes (highest priority)

Production 0041–0043 implement test-paper generation from Materials files: every user is Free by default, with 10 successful generations and 10 successful subjective gradings per local day in the Profile IANA time zone; the reservation is consumed only on success and released on rejection, failure, or cancellation, and credits are never read. Real test papers appear under the corresponding Materials `courses.id`, the historical hard-coded My Notes data stays in a separate Demo group, and deleting the source can either move the results to Unfiled or delete them too. Online exams support an absolute deadline, 500 ms/blur saving, IndexedDB weak-network drafts, unlimited retakes, deterministic grading of objective questions, and one AI grading run for all subjective questions of a paper.

This phase completed real OpenRouter/ZDR, the 2 GB canary, full CI, an encrypted recovery point, a signed-in user production smoke test, and an immutable release on 2026-08-11. Phase one explicitly does not open the knowledge list, standalone Quiz, knowledge graph, Notes editing/PDF export, selling credits, or payments.

A generation job can choose one or more artifacts:

1. Knowledge list: concepts, definitions, source citations, dependency order.
2. Interactive quiz: question types, answers, explanations, difficulty, and source evidence.
3. Knowledge graph: nodes, relationships, layout information, and sources.
4. Mock exam: sections, questions, marks, answers, and grading rubrics.

Target pipeline:

```text
User chooses materials and generation settings
  → NestJS authentication, quota/credits reservation, job creation
  → BullMQ queueing and rate limiting
  → FastAPI downloads the private material, parses, chunks; calls visual recovery when needed
  → Provider adapter structured generation + citation/schema reviewer quality gates
  → Contract validation, result persistence, credits settlement
  → Notification persistence + Realtime push
  → Notes page reading, editing, practice, regeneration, and export
```

Must be done first:

- Unify the TypeScript/Python/frontend rendering contracts, replacing the current mock short-field shapes or providing an explicit adapter layer.
- Define the serialization convention for `materialId/material_id` and the OpenAPI.
- Production has `generation_jobs / notes / note_materials / exams`; the 0046–0048 candidate adds the graph artifact, checkpoints, and node questions. The knowledge list, standalone quizzes, and embeddings/RAG still need a future data model.
- Save the material source and page number for every generated fragment to avoid uncited answers.
- Build idempotency keys, retries, cancellation, timeouts, budget caps, failure refunds, and quality evaluation.

### 3.5 Home and the learning loop

The final Home aggregates real today's tasks, streaks, recent courses, materials to process, recent notes, generation jobs, and activity; it must stop mixing mock credits with real points.

The learning loop should record quiz answers, weak knowledge points, review intervals, task completion, and generation quality feedback, and use them for later planning recommendations. Recommendations start with explainable rules and only introduce models once there is enough data.

### 3.6 Community and content governance

Target capabilities: posts, comments, likes, saves, reposts, follows, tags, media, reporting, blocking, moderation queues, appeals, rate limiting, and anti-spam.

Social features currently work for the most part; production 0039 tightened trusted author fields with a column allowlist and defensive triggers, and added frozen daily caps, moderation suppress/restore, and pending-review coordination signals. It does not penalize automatically and does not replace reporting/appeals/a moderation back office, and orphan media governance is still incomplete. See [content moderation](governance/CONTENT_MODERATION.md) for detailed rules.

### 3.7 Study plan

Target capabilities: tasks/goals, material links, exam countdowns, reminders, recurring tasks, time zones, calendar sync, and explainable scheduling based on weak points.

There are currently basic tasks, goals, streaks, heuristic auto-fill, and idempotent task rewards; production 0039 added owner triggers for goal/task referenced objects, database-maintained `done_at`, and a daily task reward cap. Due-date reminders, history pagination, and real AI/rule-based recommendations are still needed.

### 3.8 Market, wallet, VIP, and payments

Target capabilities:

- Notes priced and purchased in credits; balances derived from an immutable ledger.
- Fiat top-ups, VIP, and official courses through Stripe Checkout/webhooks.
- Creator earnings, platform revenue share, refunds, disputes, and Stripe Connect payouts.
- Orders, payments, and the ledger in three separate layers, with every state change idempotent and auditable.

`points` are non-withdrawable activity growth values, and `credits` are an internal spending balance; the two must never convert into each other or share fields. See the [points, wallet, VIP, and payment rules](product/POINTS_CREDITS_VIP_PAYMENTS.md) for the full rules.

### 3.9 Notifications, feedback, and admin

Target capabilities:

- Persistent notifications + Realtime; source navigation, preferences, email, and plan reminders.
- Feedback can only be created/viewed by users, with status handled by support staff.
- The admin console covers users, content, reports, feedback, orders, AI jobs, cost, and audit logs.

### 3.10 Multi-platform and internationalization

- The Web app is the primary delivery surface.
- Electron joins after the Web core loop is stable, providing file selection, system notifications, and secure updates.
- React Native/Expo joins after the API and shared business contracts are stable, without directly reusing the DOM UI.
- The interface and AI output both support English/Chinese; the database stores stable code values, never translated enum values. The Web interface already ships English (default) and Chinese; AI output language selection per job is the remaining part.

## 4. Target technical architecture

```text
Web / Electron / React Native
        │ HTTPS + Supabase JWT
        ▼
NestJS API (business boundary, quotas, orders, jobs, admin)
        ├── Supabase Auth / Postgres / Storage / Realtime
        ├── Redis + BullMQ
        ├── FastAPI AI Worker ── OpenRouter / future provider adapters
        └── Stripe API / Webhook / Connect
```

Principles:

- Simple owner-only CRUD may keep talking to Supabase directly, but operations involving money, points, server-trusted fields, cross-user writes, AI cost, and admin permissions must go through controlled APIs/RPCs.
- RLS is the last line of data isolation and does not replace column permissions, business validation, idempotent ledgers, and rate limiting.
- Every cross-language interface takes OpenAPI/JSON Schema as its source, generating clients or running contract tests.
- Async jobs must be observable, retryable, cancellable, and deduplicated, and failures must never swallow credits.
- Current production keeps using hosted Supabase + self-hosted apps; whether to move to a PaaS or fully self-host is decided by capacity and operating cost, and no hosting provider is written as a locked-in fact anymore.

## 5. Data domains and ownership

Final data domains:

- Identity: `profiles`, roles, preferences, consents.
- Learning source: courses, materials, material_versions, parse_results.
- Knowledge: notes, generated artifacts, citations, embeddings, attempts.
- Learning courses: learning courses/units/words, sessions/items/attempts/progress, review schedules, shares/publications/reports, badge awards, speech usage.
- Planning: goals, tasks, reminders, streak events.
- Community: posts, comments, reactions, follows, reports, moderation actions.
- Commerce: products, orders, payments, credit ledger, creator earnings, payouts, subscriptions.
- Operations: generation jobs, notifications, feedback, audit logs, usage/cost events.

See the [ERD](guides/ERD.md) for the current tables, fields, and RLS. Every new table must specify: data owner, read/write roles, retention period, delete behavior, audit requirements, and RLS tests.

## 6. Non-negotiable quality gates

A feature can only be marked "done" when all of these hold:

- Database migrations with rollback/roll-forward notes; RLS verified with at least two users.
- API/contract documentation, with stable errors and state machines.
- Unit or jsdom tests; E2E for key user paths.
- CI runs code/database lint, typecheck, tests, and the build.
- Logs, metrics, and alerts; timeouts, retries, and degradation when external services are involved.
- Privacy/deletion rules updated when personal data is involved; moderation rules updated when content is involved.
- A fixed evaluation set, cost budget, citations, and failure strategy when AI is involved.
- Idempotent events and immutable ledgers when points/credits/payments are involved.
- The current-status docs, API/ERD, and CHANGELOG updated together.

## 7. Phased development path

### Phase A: security and verifiable baseline (now)

Goal: before adding more features, make existing real data trustworthy, tests reproducible, and releases reversible.

- **Implemented:** restricting Profile sensitive columns, revoking client execute on internal definers, an append-only points ledger with reversals/idempotency, and the corresponding two-user RLS regressions.
- **Implemented:** fixed cross-account legacy state, late async responses, resize remounting, sign-in/sign-out loading, and Supabase/Storage error handling; the existing Web jsdom, API unit tests, two-user Supabase E2E, and the Courses Playwright flow together cover the old and new boundaries.
- **Live:** 0039–0040 fixed trusted fields on post UPDATE, Feedback status, goal/task owner links, and database time fields; the compatibility period still accepts the two old time columns but triggers always overwrite them.
- **Live:** 0008–0010 completed a protected production release; the old opening was zeroed with an appended equal reversal, and production history, release assertions, and the final dry-run all passed.
- **Live:** frozen first decisions for points, daily count caps, owner receipts, moderation suppress/restore, pending-review coordination signals, Redis sliding windows, HMAC abuse auditing, and the admin API; automatic penalties, a full moderation UI, and webhook alerts are out of scope for this phase.
- **Current release stop point:** the 0052–0053 database contract went live through full CI, a separate plan, a recovery point, apply, and remote verification; the latest main app still has not been cut over because the real Materials AI PPTX gate failed. When fixing that separate AI issue, do not revert the timestamp-column grants and do not loosen the provider gate.
- Keep maintaining the landed gates: empty-database migration rebuild/RLS E2E, typecheck, jsdom, the Courses browser main flow, build, encrypted recovery points, and app rollback; keep adding API HTTP/browser E2E and FastAPI tests for the legacy modules.
- Establish baselines for database releases, backup/recovery, secret rotation, monitoring/alerting, and security response.

Acceptance: the repository P0 regressions are closed and the production migration history provably applied; the default CI is all green; two-user RLS E2E is repeatable on a throwaway local Supabase; the remaining permission items are closed; releases and recovery have been drilled.

### Phase A+: Courses protected release (completed 2026-08-04)

- The parser, jsdom/API, the 0007 upgrade, empty-database migrations, two-user RLS, and the Playwright main flow are all green in CI.
- Completed the read-only migration plan, encrypted recovery point, 0011–0038 apply, remote history/lint/dry-run, and the immutable app release.
- Private Courses are enabled, with cross-account, session resume, cross-day review, and points fingerprints verified; the real Japan East Azure synthesis/scoring smoke succeeded.
- Sharing and the free Course Market are open. Keep observing error rates, report thresholds, speech quotas/cost, and database growth; rollback only turns off flags/restores the app release, and the database is fixed forward.

Acceptance results: the Courses feature migrations are released up to 0038, and the current overall production history is at 0043; the Courses private path, idempotent weak-network answering, the audio queue/Storage dedup, replacing cached cold audio after it becomes ready, intent-specific resume and explicit cancel, the timed spelling test, the translation pre-test, Chinese translation voice input/shared waveform, end-of-round mistake review, spelling/pronunciation exams, arbitrary word selection, exam history, the dual-exam exact mastery projection, Unicode spelling normalization, punctuation-only tolerance, real Azure/OpenRouter/Fish Audio smoke with untrimmed WAVs, sharing/market, the scored retry pool, and public readiness all have release records; Courses file import stays disabled.

### Phase B: Materials AI minimal loop (live 2026-08-11)

Goal: a real Materials file can generate a citable, persistent test paper for an online exam. Production 0041–0043 implement the unified contract, job/Notes/citation/answer-sheet tables, multi-format parsing, the durable queue, DeepSeek/MiMo ZDR, result validation, the queue UI, real My Notes, and the Free quota; credits are not connected.

Acceptance results: full PR/main CI, the real fixed provider suite, a 220-page near-limit resource canary, the read-only plan/encrypted recovery point/remote verification, readiness with the flag off, the full signed-in production user path, and independent public review all passed; the same idempotency key/operation never duplicates allowances/results, failures release the reservation, and temporary directories are cleaned before and after jobs. Ongoing quality, cost, real complex files, and the prompt-injection false-positive rate still need monitoring.

### Phase B+: resumable long jobs, the knowledge-point graph, and Luna native files (database released, app being fixed forward)

- API/worker use 202 acceptance and durable callbacks, and explicit Undici timeouts only protect the transport instead of holding an HTTP response for up to 20 minutes.
- Provider usage is persisted incrementally by UUID; database checkpoints and the worker's 0700 local results together support Resume within a default 24 hours, on the same job, with a fresh reservation, consumed only on success.
- Materials opens Organize knowledge points; My Notes renders a source-ordered graph, hover/detail, and node Q&A constrained to the node's sources. The knowledge list and standalone Quiz stay disabled.
- Materials/My Notes keep their original visuals; this phase is not expanded into a site-wide React rewrite. (They were originally pinned to English for this phase; they now follow the global English/Chinese toggle.)
- The graph uses React Flow + ELK, providing overlap-free layering, pan/zoom, drag/keyboard, external details, and revision-based cross-device saving; exams are graded together only after the whole paper is submitted or time runs out.
- Jobs support Delete/Clear history with in-app confirmation; active cleanup must wait until the worker cancels the network/Office work, records usage, and deletes the temporary directory before the job disappears, and accepted jobs consume one run per the rules.
- The capability matrix lets users explicitly choose DocumentIR or `luna_native_file_v1`. Luna is only open for the PDF/image allowlist that passed real gates, with inline raw bytes, fixed GPT-6 Luna, a locked Azure ZDR upstream, and no fallback, never converting or downgrading silently.

Acceptance progress: 0046–0051 empty-database/upgrade/RLS, fake Chromium, the read-only plan, the recovery point, production apply, and the 2 GB canary are complete. The Ox Alpha extension in 0054–0055 is retired by 0056–0057 (Unreleased). The real GPT-5.6 Luna gate confirmed there is no first-party OpenAI ZDR endpoint; GPT-6 Luna is locked to the Azure ZDR endpoint instead. Still needed: new full CI, real DeepSeek/MiMo, the free Nemotron translation, the Luna Azure native-file gate, the DocumentIR app release, a production signed-in smoke, and independent public verification. Until the Azure catalog is compliant and the per-format gates pass, Luna can only be "implemented but unavailable".

### Phase C: four artifacts and the learning loop

- Finish production observation of the candidate knowledge-point graph; keep extending the knowledge list and standalone Quiz, with test papers keeping the existing loop.
- Quiz answering/explanations, graph layout, test-paper answers, and grading rubrics.
- Switch Home entirely to real data; generate plans based on weak points.
- Replace legacy views with type-safe React components in stages.

### Phase D: market, credits, VIP, and Stripe

- Listing, purchase, ratings, licensed copies.
- Top-up orders, Stripe webhooks, an immutable credits ledger.
- VIP entitlements, the default 70% creator share, refunds/disputes, and payouts.
- Real payments are only enabled after tax, terms, privacy, risk control, and audit requirements are met.

### Phase E: real-time, governance, and operations

- Realtime notifications, reminder jobs, email preferences.
- Reporting/moderation/appeals/blocking, anti-spam, and an admin workbench.
- SLOs, cost dashboards, AI quality regression, capacity, and disaster recovery drills.

### Phase F: multi-platform and content expansion

- Bilingual AI output end to end (the Web UI is already bilingual).
- Electron, React Native/Expo.
- Official text/video/live courses and a recommendation system.
- Whether to bring in a third-party video/live service is decided by a separate ADR.

## 8. Full list of features to implement

| ID | Capability | Current | Target phase | Key dependencies |
|---|---|---|---|---|
| SEC-01 | Profile sensitive columns and internal RPC lockdown | Live | A | 0008–0010, RLS E2E, 2026-07-21 production release record |
| SEC-02 | Sign-up rate limiting, email verification, password recovery | Partial | A/B | 0039–0040 shipped Redis IP + email rate limiting; email verification/recovery/CAPTCHA still not done |
| SEC-03 | Posts/Feedback/Schedule integrity and points anti-abuse | Live | A | 0039–0040, real Redis/two-user RLS/go-no-go, plus plan `32581192318`, apply `32581805613`, and 0052–0053 remote verification |
| QA-01 | jsdom, API, Python, two-user RLS/Storage, and key browser flows | Partial | A/A+ | Web/API/Python unit + CI local Supabase + Courses/Materials AI Playwright; staging and legacy-module API HTTP/browser coverage still to add |
| OPS-01 | DB release/rollback, backups, monitoring, secret rotation | Partial | A | CLI/recovery points/app rollback implemented; Storage bytes, continuous monitoring, and drills still to add |
| FE-01 | Legacy cross-session and error-handling fixes | Implemented | A | Account switching/resize/error/loading jsdom regressions |
| LEARN-01 | English word-list text create/edit, four-stage learning, explicit cancel, end-of-round review, spelling/pronunciation exams, arbitrary word selection, and history | Live | A+ | React, NestJS, 0011–0036; verified in CI/production |
| LEARN-02 | Review mastery, Schedule/Profile, badges/+20 points | Live | A+ | Cross-day local dates, fingerprint idempotency; released to production |
| LEARN-03 | Sharing, free course market, reporting, and moderation | Live | A+ | Immutable snapshots, flags; free market open |
| LEARN-04 | Azure TTS/read-aloud scoring adapter | Live | A+ | Fake automation + real Japan East provider gate |
| LEARN-05 | Timed spelling and the semantic translation pre-test | Live | A+ | 0019–0020, OpenRouter structured output, real provider/production gate |
| LEARN-AI-01 | File import, category prompts, structured output, and human confirmation | Not started | B | Scanning/OCR/parsing, evaluation, cost, privacy |
| AI-01 | Unified test-paper generation contract, jobs/allowances/Notes/answer sheets | Live | B | 0041–0043; real provider/canary/production gates complete |
| AI-02 | Materials deterministic parsing, visual recovery, and citations | Live | B | FastAPI DocumentIR/DeepSeek/MiMo; embedding/pgvector not in the first version |
| AI-03 | Materials knowledge graph and node Q&A | Candidate implemented, not live | B | 0046–0051 + AI-01/02; awaiting CI, real providers, protected release |
| AI-04 | Knowledge list / standalone Quiz | Mock | C | AI-01/02; still Coming soon |
| AI-05 | Long-job incremental usage and checkpoint resume | Candidate implemented, not live | B+ | Local unit tests pass; real Supabase/provider/production gates pending |
| AI-06 | Luna native files, job delete/clear, cross-device graph layout | Candidate implemented, not live | B+ | 0049–0051; needs per-format real OpenAI gates, RLS, 250-node Playwright, and a protected release |
| NOTE-01 | Notes CRUD, editing, versions, and export | Partial | B/C | Private test-paper viewing/deletion/exams implemented; editing/versions/PDF export pending |
| HOME-01 | Real Home aggregation | Mock | C | Notes/Tasks/Usage |
| PLAN-01 | Due-date reminders and weak-point scheduling | Partial | C/E | Realtime/cron |
| COM-01 | Reporting, moderation, blocking, anti-spam | Partial | E | Points coordination signals/moderation API live; content reporting, appeals, blocking, and a full admin console not done |
| PAY-01 | Credits ledger and orders | Fields only | D | Product rules, API |
| PAY-02 | Stripe/VIP/refunds/Connect | Not done | D | PAY-01, compliance |
| RT-01 | Realtime notifications | Not done | E | Notification source fields |
| ADMIN-01 | Admin back office and auditing | Not done | E | Roles, audit logs |
| I18N-01 | Bilingual UI and AI | Partial | F | Web UI English/Chinese toggle implemented (English default); per-job AI output language and a shared i18n package for other platforms pending |
| DESKTOP-01 | Electron | Not started | F | Stable Web/API |
| MOBILE-01 | React Native/Expo | Not started | F | Stable shared contracts |
| COURSE-01 | Official courses | Not started | F | Payments, media provider |

Only these statuses are allowed: `Not started / Stub / Mock / Partial / Implemented / Verified / Live`. "Verified" must link to runnable tests, and "Live" must have deployment and monitoring evidence.

## 9. Open decisions

The following must not be assumed locked in before implementation:

- Commercial authorization for ExamPass-Assistant; without it, only method references with a clean rewrite are allowed.
- Embedding model and provider, graph layout approach, rich-text editor.
- Video/live provider.
- VIP entitlement details and whether official courses may be paid with credits.
- Offline scope for Electron/RN.
- The long-term choice between a PaaS, self-hosting, or a hybrid deployment.

Once each is decided, add an ADR and remove the "open" marker from this file.

## 10. Companion documents and update responsibilities

- Current implementation: [ARCHITECTURE.md](ARCHITECTURE.md)
- Data: [ERD](guides/ERD.md), [database release and rollback](operations/DATABASE_RELEASE_ROLLBACK.md)
- Interfaces: [API](guides/API.md)
- Development and testing: [local development](guides/LOCAL_DEVELOPMENT.md), [testing guide](guides/TESTING.md)
- Security and privacy: [SECURITY](../SECURITY.md), [privacy and data deletion](governance/PRIVACY_AND_DATA_DELETION.md)
- AI: [evaluation and cost](ai/EVALUATION_AND_COST.md)
- Commercial rules: [points/credits/VIP/payments](product/POINTS_CREDITS_VIP_PAYMENTS.md)
- Change records: [CHANGELOG](../CHANGELOG.md), [ADR](adr/README.md)

The product owner maintains scope and priorities; the tech lead maintains the architecture and quality gates; module authors sync the ERD/API/tests/CHANGELOG when merging features; and the operations owner updates the runbooks when infrastructure, secrets, alerts, or recovery processes change.
