# Contributing to Nalanda

> **About this document**
> - **Contents**: Defines the development environment, branches and commits, the code/database/documentation change process, testing requirements, and the definition of done.
> - **Purpose**: Lets contributors deliver changes reproducibly and keeps code, migrations, tests, documentation, and operations notes in sync.
> - **When to update**: When the toolchain, directory layout, CI gates, branch strategy, database process, or review responsibilities change; update immediately if a command here turns out not to run.
> - **Status baseline**: 2026-08-14; the production database has a protected release up to 0043; the 0046–0051 recovery, knowledge graph, job lifecycle, and Luna native-file work are still candidates. Commit descriptions must distinguish code implementation, local or fake automation, real Redis/Supabase/provider gates, and actual launch.

Any change to an AI system/user prompt, model input template, schema, or provider instruction parameter must, in the same PR, update the [unified AI prompt catalog](docs/ai/PROMPT_CATALOG.md), the corresponding runtime code, the version, and the evaluation; never change only the documentation or only a string hidden in code.

Long-job changes must also prove: fast acceptance over internal HTTP, idempotency for every provider usage UUID, a ledger flush before completion/failure, checkpoint expiry cleanup, no repeated calls to completed stages when the lease changes, and separately reported fake/real provider evidence. Merely extending an `AbortSignal` or passing jsdom does not meet the definition of done.

## 1. Before you start

- The Node.js version is defined by `.nvmrc` and root `package.json#engines` (currently Node 20+).
- The package manager is pinned to `pnpm@9.12.3`; do not mix in npm/yarn or commit other lock files.
- The Python AI service uses its own virtual environment; do not commit `.venv`, caches, or local model files.
- Copy local configuration from each app's `.env.example`; real secrets must never enter Git, issues, PRs, chat, or test snapshots.
- The architecture blueprint is not proof of implementation. Before changing anything, check the code, migrations, and "current status" docs.

Basic install and static verification:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

Full local services, Supabase, and test commands are defined by the local development and testing guides under `docs/`. If a guide disagrees with a script, treat the runnable script as the evidence and fix the documentation in the same PR.

## 2. Choosing where to change

| Scope | Main directories | Additional requirements |
|---|---|---|
| Web | `apps/web`, `packages/ui` | Cover desktop/narrow screens, light/dark themes, English/Chinese, signed-in state, and account switching |
| API | `apps/api` | DTO validation, auth/ownership, error contract, API docs, and integration tests |
| Courses | `apps/web/src/features/courses`, `apps/api/src/learning`, `packages/types`, 0011+ | Parsing/state machine/cross-day review, service-only RPCs, Schedule/Profile, sharing/market, Speech privacy, and layered E2E |
| Materials AI | `apps/ai`, `apps/api/src/ai`, `apps/web/src/features/material-ai`, `packages/types` | Durable job/quota, two pipelines, strict schema, parsing/native-file safety, cost/privacy, cancel/purge, graph layout, and resource gates |
| Database | `supabase/migrations` | Only add migrations; two-user RLS negative tests; release/rollback notes |
| Deployment | `infra`, `.github/workflows` | Staged verification, health checks, rollback, and secret/alerting impact |
| Documentation | `README.md`, `docs`, root governance files | Every document opens with Contents/Purpose/When to update; label current/target and the verification date |

The high-fidelity prototype in `app/` is a design reference, not the production runtime. The production Web app still contains legacy DOM modules; when changing them, do not accidentally break existing interactions or keep expanding untyped global state.

## 3. Branches, commits, and PRs

Create short-lived branches from the latest `main`, preferably `feat/...`, `fix/...`, `docs/...`, `test/...`, or `chore/...`. One PR solves one reviewable problem; avoid mixing formatting, refactoring, and features in one batch.

Commit titles use the imperative mood and state the scope, for example:

```text
fix(db): prevent clients from updating wallet fields
test(web): cover authenticated account switching
docs(ai): define evaluation release gates
```

A PR description must include at least:

- The problem, user impact, and non-goals;
- Current behavior vs. behavior after the change, with screenshots/recordings when needed;
- Data, permission, privacy, cost, and compatibility impact;
- The exact commands run and their results;
- Migration, deployment, observability, and rollback steps;
- The documentation, API contracts, and CHANGELOG entries updated alongside.

Never commit generated directories (`dist`, `.turbo`), local environment files, real user samples, production exports, or logs containing secrets.

## 4. Code conventions

- New TypeScript code must not use `@ts-nocheck`, unjustified `any`, or implicit globals; shared contracts belong in `packages/types` with matching runtime validation.
- Do not trust values returned by the browser, models, or the database; validate at every service boundary and handle `{ data, error }` explicitly.
- UI write operations need loading, success, empty, error, retry, and duplicate-click protection; sign-out/account switching must clear user-level caches and subscriptions.
- The API only returns stable error codes and never exposes upstream details to clients; use correlation IDs for troubleshooting.
- Python output must pass Pydantic schemas; model/prompt/parser versions are recorded with results, and static stubs must never pose as real generation.
- Materials AI files/focus/answers are all untrusted data. DocumentIR only runs visual recovery on failed regions; Luna forbids parser/OCR/conversion/Files API, is fixed to GPT-6 Luna + Azure ZDR/no fallback, and verifies the real upstream. Safety/structure/provider failures settle the Free reservation based on whether the job was dispatched; clients cannot downgrade or consume credits.
- AI job Delete/Cancel must go through database allowance settlement and worker cancel/purge confirmation; never just delete the UI row, skip the usage flush, or refund a processing job as if it were queued. Exam drafts must not be graded or return answers; only the unified submission transaction can produce results.
- Accessibility covers at least keyboard operation, focus, form labels, status announcements, contrast, and reduced motion.
- User-visible text is bilingual: add it as an `l(english, chinese)` / `localize(english, chinese)` pair (React components use `useI18n()`); English is the default locale, and both halves must be filled in.
- The Courses text parser and the API validator are both boundaries: when changing rules, update exact error positions, the shared contract, database constraints, and tests together; file entry points must stay disabled until real isolation/OCR/human confirmation is complete.
- Learning facts are persisted on every step; never replace session/attempt/progress with frontend memory, never let reordering/renaming accidentally clear abilities, and never let provider failures accumulate user errors.
- Courses instant feedback can only be provisional UI. Every test answer must use a UUID `attemptId` and a monotonically increasing `expectedRevision`, replayed serially by revision; completion, points, or badges must not be shown before the server confirms, and an account switch must clear that account's unsynced outbox.
- Synthesized audio's only server-side source of truth is private Supabase Storage; browser Cache Storage is a deletable, evictable, rebuildable copy. When adding a provider or cache-key input, update the version, quotas, privacy, real provider gate, and offline deletion tests together.
- The spelling time limit is a client-side experience, but timed-out answers must still go through the normal idempotent attempt; the optional translation pre-test can only be judged by the API with server-side reference answers, normalized exact matches take the deterministic zero-token path, and only other answers go to the restricted OpenRouter adapter. Never hand the key, reference answers, or judging authority to the Web app.

## 5. Database changes

1. Always add a new migration with a UTC timestamp; never rewrite a released migration.
2. Write a compatible migration first, then release code that depends on the new structure; destructive removals follow expand → migrate/backfill → contract.
3. For every new table, define ownership, foreign keys, unique constraints, indexes, and RLS first; deny by default and allow each operation explicitly.
4. For `SECURITY DEFINER`, pin `search_path`, revoke `PUBLIC` execute, restrict roles, and verify it cannot act on behalf of arbitrary users.
5. Test allow and deny paths as user A, user B, anonymous, and service-role. Verifying only "it works for me" does not complete RLS.
6. Money, credits, points, entitlements, and moderation state use immutable events/ledgers and idempotency keys; corrections use compensating records and never delete history.
7. The PR includes the forward release, verification SQL, stop conditions on failure, and a rollback or forward-fix plan; a recoverable backup must exist before a production migration.
8. Expand/contract must be split into truly independent releases. The compatible app and the expand migration ship first and are observed for the agreed window; the contract migration can only be created, reviewed, and released separately after the observation evidence is complete, and a "future contract file" must never be applied early by the current CI's latest.
9. Append-only moderation/ledger tables grant no direct mutation even to service-role; admin APIs call controlled transaction functions. Scan signals can only be input to human review and must never quietly become automatic penalties through test thresholds.

## 6. Testing and quality gates

Run every gate the repository provides before submitting. The minimum is:

```bash
pnpm typecheck
pnpm test
pnpm build
```

The equivalent repository-wide gate is `pnpm check`. Changes touching migrations/Courses must also run `pnpm test:rls` on a throwaway local Supabase; Redis/rate-limit changes must run `RUN_REDIS_E2E=true pnpm --filter @nalanda/api test` against a real test Redis; full user paths need `pnpm --filter @nalanda/web test:playwright` configured per the testing guide. A Redis/RLS skip in ordinary `pnpm test` is not evidence that the dependency passed.

If a workspace lacks the relevant script, "the command doesn't exist" must not be recorded as a pass; add the script or state clearly in the PR that the gate is not implemented yet. Add the following by change type:

- Pure functions/state machines: unit tests and boundary values;
- Web DOM behavior: Vitest/jsdom, verifying failure paths and unmount cleanup;
- Main user flows: browser E2E, never with production accounts/data;
- API: unauthenticated, bad token, unauthorized access, duplicate requests, and upstream failures;
- Supabase: migration replay, two-user RLS, Storage, function permissions, and trigger idempotency;
- Redis/rate limiting: real Redis verifies Lua atomicity, window expiry, tiered fail-open/closed, 429/`Retry-After`/RateLimit headers, and HMAC logging; mocks are only for pure classification unit tests;
- nginx/deployment: run `nginx -t` in a container with the same major version as production, and verify secret install scripts for mode 600, idempotent replacement, and no stdout leaks;
- AI: contracts, fixed fixtures, offline evaluation, safety sets, and cost regressions;
- Materials AI additionally needs Python ruff/pytest, real Redis BullMQ, two-user RLS, fake-provider Playwright, and AI Docker; Luna/graph changes also need 250-node desktop/mobile graphs, layout revisions, delete races, and the protected real OpenAI upstream/native-file/per-format/cancel residue gate. Fakes cannot replace real DeepSeek/MiMo/Luna or production smoke.
- Speech: fixed WAV/fake adapters cover format, size, VAD trimming, timeouts, rate limits, queue leases, Storage misses, and not persisting recordings; before release, also run a real Azure queue/cache reuse/scoring smoke, and never use personal recordings in a PR;
- Payments: only Stripe test mode/CLI fixtures, covering duplicate, out-of-order, refund, and dispute webhooks.

When fixing a bug, first add a failing test that reproduces it. Never "fix" tests by loosening assertions, permanent skips, sharing production keys, or depending on test order.

## 7. Documentation rules

Every long-lived document must state at the top:

1. What the document contains;
2. Its role in the documentation system;
3. What changes trigger an update.

Use consistent status labels when describing capabilities:

- **Current/implemented:** provable from code, migrations, and runnable tests;
- **Partially implemented:** state clearly which paths work and which are still mock data/stubs;
- **Target/to do:** designs or release gates; never say "supported" or "done";
- **Deprecated:** give the replacement document and a cutoff date.

Changes to behavior, APIs, tables, environment variables, operations processes, or product rules must update the corresponding docs in the same PR. Major, cross-service, or hard-to-reverse choices get a new ADR; never quietly rewrite the historical conclusion of an Accepted ADR.

## 8. Security, privacy, and content

- Follow [SECURITY.md](SECURITY.md); suspected vulnerabilities go through the private channel.
- Test data uses synthetic content; courseware, emails, payments, and community exports are treated as confidential.
- New data fields must explain their purpose, legal basis/user expectation, retention, who can access them, and export and deletion behavior.
- New community or market content types must be integrated into the report, moderation, appeal, and attachment deletion design.
- Course Market v1 only allows free clones; do not add credits/purchase/revenue-share copy or let cloned courses be redistributed. Changes to share tokens, publication snapshots, or moderation must add revocation race, redaction, and audit tests.
- New AI capabilities must state whether material is sent to third parties, how long it is kept, whether it is used for training, and how hallucination and prompt injection are evaluated.
- New credits/VIP/payment logic must follow the [unified economy and payment rules](docs/product/POINTS_CREDITS_VIP_PAYMENTS.md).

## 9. Definition of done

A change is done only when all of these hold: the implementation matches the scope; the relevant tests pass repeatably; failure/unauthorized paths are verified; migrations and rollback are executable; monitoring can detect failures; user and operations docs are in sync; there are no secrets/real PII; known limitations are clearly recorded; and the necessary product, security, and data owners have approved.
