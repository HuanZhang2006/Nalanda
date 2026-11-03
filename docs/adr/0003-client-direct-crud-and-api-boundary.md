# ADR-0003: Ordinary owner CRUD may talk to Supabase directly; privileged and cross-resource flows go through NestJS

> **About this document**
> - **Contents**: Defines which business operations the browser may perform directly against Supabase, and which operations the core API must own.
> - **Purpose**: Prevents "everything direct" from losing control of server secrets or ledgers, and avoids adding a pointless proxy layer for simple private CRUD.
> - **When to update**: When any module changes its data access path, introduces admin/payment/AI/moderation flows, or RLS cannot express a required rule.
> - **Status note**: The boundary is accepted and went live with 0039–0040 on 2026-08-10: posts/Feedback/Schedule stay direct but are defended by column grants/triggers, while points administration and Redis rate limiting live in NestJS.

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Project maintainer
- **Scope:** Web, NestJS API, Supabase

## Context

The Materials implementation showed that a user's own course/material CRUD can be done from the browser with strict RLS; on the other hand, sign-up, AI, wallets, and payments need server secrets, idempotent transactions, third-party calls, or cross-user writes and cannot trust the client.

## Decision

### Operations the browser may perform directly

Direct access MAY be used only when all of these hold: it touches only the current user's own data, or a clearly defined authenticated public read; RLS/constraints fully express the permissions and integrity; no server secret is involved; there is no money, irreversible side effect, or cross-user entitlement; failures can be retried safely; and two-user negative tests exist.

Areas that currently fit or nearly fit this pattern include course/material metadata, private material Storage, personal tasks/goals, and ordinary community content CRUD/interactions. Community cross-user counters and notifications are produced by database triggers, but definer privileges and idempotent behavior must still be restricted.

### Operations that must go through NestJS

The following MUST run on the server: admin/service-role work; sign-up and sensitive account flows; AI job creation/charging/provider calls; credits hold/commit/refund; VIP/Stripe/creator revenue share; content moderation and admin actions; issuing high-privilege or long-lived signatures; cross-user writes; complex rate limiting; privacy export/deletion orchestration; and any field that, if forged by a client, would have economic or security impact.

NestJS must re-verify the JWT, object ownership, DTOs, and idempotency keys; it must never skip these because the frontend already validated them.

## Consequences

Simple paths have low latency and little code; the cost is that RLS and migrations become part of the application API and must be tested and versioned like code. When a feature grows from ordinary CRUD into a paid/moderated flow, its access path must be migrated explicitly instead of continuing to let the browser write internal state.

## Gap between current implementation and target

- **Current:** Legacy modules still talk to Supabase from the Web; besides health/register/me, NestJS owns and runs in production the Courses content writes, sessions/growth, Speech, sharing/market, and redacted public reads.
- **Closed:** Profile only allows profile-column updates; points/credits/level/VIP/streak and internal RPCs are locked down. The main requests in Materials, Community, Schedule, Notifications, Feedback, and Profile check Supabase `{ error }` and use session versions to block late responses across accounts; CI has a two-user RLS permission matrix.
- **Current violation risks:** 0039 locked down the planned trusted fields on Feedback and posts; notification server fields are out of scope for this phase and still need ongoing audits. Commercial/AI/general moderation/deletion flows must not reuse ordinary direct CRUD.
- **Target:** Keep locking down legacy tables per column; move AI, payments, general moderation, and deletion orchestration into the API; generate OpenAPI/SDKs for the existing Courses contract and extend HTTP/permission tests.

## Verification and review

Every new field must answer "who can write it, through which path, how it is retried, and how it is audited". When RLS complexity, client coupling, or compliance needs rise significantly, review whether more CRUD should move into the API.
