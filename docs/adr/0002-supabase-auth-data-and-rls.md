# ADR-0002: Supabase provides Auth, Postgres, and Storage; RLS is the data authorization boundary

> **About this document**
> - **Contents**: Records the decision to use Supabase for authentication, relational data, file storage, and row-level authorization.
> - **Purpose**: Defines the real security boundary when the browser connects directly, and the RLS/Storage constraints every data model must satisfy.
> - **When to update**: When the identity provider, database/Storage, tenancy model, JWT verification, or authorization policy changes, or after a major RLS incident.
> - **Security note**: This document records the target boundary; it does not mean every existing policy is safe. Known gaps are in the root `SECURITY.md`.

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Project maintainer
- **Scope:** Authentication, PostgreSQL, PostgREST, Storage

## Context

The product needs email sign-in, private user courses/courseware, a public community, file uploads, and later real-time notifications. The early-stage team wanted to avoid the cost of running its own authentication, object storage, and database, while letting simple owner CRUD go straight from the browser.

## Decision

- Supabase Auth is the identity source; user IDs are `auth.users.id`.
- Postgres is the business source of truth; Storage holds file objects, and tables store only object references and metadata.
- User requests carry a Supabase JWT; NestJS verifies issuer/audience/signature through the project JWKS first, and the legacy HS256 secret is only a compatibility fallback scheduled for removal.
- Tables and buckets reachable from the browser enable RLS/Storage policies by default; authorization is based on `auth.uid()`, ownership, and explicit public scopes, never on client-side filtering.
- The service role exists only in controlled server environments and is treated as a Restricted secret; it bypasses RLS, so every use needs additional business authorization and auditing.
- Schema changes ship only through traceable migrations and are tested for allow/deny with at least two ordinary users.

## Consequences

Supabase reduces infrastructure work and provides unified identity, but RLS mistakes turn directly into data leaks or tampering, and a leaked service role has a huge blast radius. Deleting an Auth user can cascade through some tables, but does not automatically prove that all Storage, backups, third-party AI, payment, and audit records were handled per policy.

## Gap between current implementation and target

- **Current:** Production has Auth, profiles, Materials, notifications/feedback, community, Schedule, points, plus the Courses private model, idempotent learning sessions, intent-specific resume, a private TTS queue/cache, service-only translation judging and Chinese STT, spelling normalization, punctuation-only tolerance, explicit cancel, end-of-round mistake review, spelling/pronunciation exams, arbitrary word selection, exam history and the dual-exam exact mastery projection, and private Materials AI/Notes/exam facts; migration history is at 0043.
- **Closed:** The Profile/points boundary from 0008–0010 and the Courses boundary from 0011–0018 are released to production. Courses private tables grant owners SELECT only, client writes and workflow RPCs are revoked, and the API uses dedicated service-role transaction entry points; CI automatically runs 0007→latest, empty-database lint, two-user RLS/Storage/Courses, and Playwright.
- **Current risks:** community-media is still public; some server-managed columns on feedback/notifications/posts are not fully locked down per column; sign-up bypasses email confirmation and has no abuse controls; legacy Profile balances can only be kept as an opening balance pending audit and cannot be automatically proven untouched by the old vulnerability.
- **Target:** Finish the per-column permission audit; bring the Storage lifecycle, export/deletion, auditing, Realtime channel authorization, and staging drills into the same model.

## Verification and review

For every resource, verify each CRUD action as anonymous, user A, user B, and the backend service role. Any implementation that treats "hiding a button in the frontend" as security directly violates this ADR.
