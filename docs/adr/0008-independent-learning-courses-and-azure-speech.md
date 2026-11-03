# ADR 0008: Independent learning-course model and an Azure Speech adapter

> **About this document**
> - **Contents**: Records the decisions that Courses does not reuse Materials tables, that privileged learning writes go through the API/RPCs, and that speech capabilities are implemented through an Azure adapter.
> - **Purpose**: Fixes long-term data, security, provider, and privacy boundaries so material catalogs, learning facts, and recording processing are never mixed together again.
> - **When to update**: When the course domain boundary, public distribution model, speech provider, recording retention, secure write approach, weak-network/cache source of truth, or a superseding ADR changes.
> - **Status**: Accepted; 2026-07-27. 0011–0018 are enabled in production; revision/outbox, the durable TTS queue, browser cache, and intent-specific resume completed a protected release.

## Context

The existing `courses/materials` tables represent a user's material catalog and have no units, entries, learning sessions, append-only attempts, cross-day mastery, review schedules, or immutable market versions. Extending them directly would couple material ownership with learning state and add regression risk to the old Materials module. Speech synthesis and read-aloud scoring also involve secrets, quotas, recording privacy, provider failures, and cost boundaries, so the browser must not call them directly.

## Decision

1. Create a new `learning_*` course domain and leave Materials unchanged; Schedule and Profile only aggregate the two domains for display/API.
2. Private content is readable only by its owner. Whole-course saves, answer progression, progress, review schedules, sharing, publishing, cloning, reporting, and moderation go through NestJS identity checks and dedicated service-role transaction RPCs; client execute permission on the RPCs is revoked by default.
3. Session facts and attempts are append-only, and progress is a protected projection. Edits reset exactly the abilities affected by each field's semantics; points and badges already awarded are historical facts and are not written back.
4. Shares read the current content; the market uses immutable version snapshots. A clone is an independent private copy with zero progress, and cloned courses cannot be redistributed.
5. Azure Speech is wrapped in a server-side adapter. TTS is reused across courses in private Supabase Storage by a content hash of the normalized term, locale, voice, format, and synthesis version; an owner-less durable queue is the source of truth for generation coordination, without a second server-side file cache. User recordings are processed only in request memory and are never persisted or cached. Clients may only submit word/session identifiers of the current course and cannot choose the reference text.
6. Courses keep working when Azure fails: browser speech replaces TTS and read-aloud scoring is turned off. Quotas, monthly budgets, circuit breakers, and feature flags are launch gates.
7. AI file import is not part of the implemented scope of this decision; the entry point may only be marked clearly as coming soon.
8. Each session uses a monotonically increasing server revision; each answer uses a client-generated UUID that is unique per `(user,session,attempt)`. The server transaction is the only authority over the retry pool, stage, progress, and growth facts; the browser's instant prediction and IndexedDB outbox only provide feedback/retries and can never complete a course or grant rewards directly.
9. Browser Cache Storage is a deletable, evictable, rebuildable copy of audio, used to prefetch the next five words and for user-initiated unit downloads; a full offline Web/PWA app shell is out of scope for this decision.
10. Unfinished sessions are unique per server-generated learning-intent key rather than globally per course. Initial learning, ad-hoc review, and scheduled review can coexist; the intent key contains the owner/enum-validated course, unit, mode, scope, sorted skills, or schedule ID, and concurrent requests for the same intent still converge through database locks and a unique index.

## Rejected options

- **Extend Materials `courses`**: fewer migrations, but confuses the material catalog with learning state, deletion semantics, and market versions.
- **Frontend writes all learning tables/RPCs directly, or rewards based on predicted state**: shorter response path, but clients could forge progress, mastery, badges, and points.
- **Browser calls Azure directly**: leaks the key and cannot reliably enforce reference-text constraints, global budgets, or the recording retention policy.
- **Store user recordings for review**: easier debugging, but substantially widens sensitive data, deletion, and leak risk; not acceptable for the first version.
- **Wait for Azure synchronously in the request path / a second local server cache**: the former amplifies first-play latency and provider jitter, and the latter creates two server-side sources of truth; we use a durable queue, private Storage, and a rebuildable client cache instead.

## Consequences

The positive results are domain isolation, secure writes, a recoverable state machine, auditable growth facts, and a replaceable speech provider. The costs are more tables/RPCs, explicit snake_case↔camelCase conversion in the API, Schedule/Profile aggregating two domains, version and moderation maintenance for market snapshots, and CI that must run real Supabase and the Azure fake adapter.

## Release and verification

0011–0013 only add objects and include assertions that client EXECUTE is denied; 0014 completed the scored retry pool. 0015 adds revisions, idempotent attempt responses, and the audio queue, keeping the old RPC signatures for app rollback; 0016 verifies columns, triggers, RLS, and service-role-only permissions; 0017 adds `resume_key` and narrows active-session uniqueness to server-validated learning/review intents, and 0018 verifies the index, functions, and permissions. On 2026-07-27, the release reached 0018 in this order: separate migration plan, encrypted recovery point, apply, lint/dry-run, immutable app release, and the real Azure gate in Japan East; the gate proved first-time generation, Storage hits, no extra generation for the same word across users, and trimmed scoring. Rollback turns off flags or restores the app release; the database is only fixed forward.

Verification entry points: parser/jsdom/API Vitest, two-user RLS E2E, Playwright end-to-end, empty-database migrations, and the 0007 upgrade fixture. Ordinary mock tests cannot replace database or provider smoke tests.
