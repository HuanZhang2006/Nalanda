# ADR-0011: Private Redis request protection and immutable Points decisions

> **About this document**
> - **Contents**: Records the architecture decision to add a private Redis sliding window for sign-up/Courses/API, and to put points daily-reward decisions, moderation reversals, and coordination signals into a controlled PostgreSQL workflow.
> - **Purpose**: Fixes the responsibility boundary between real-time traffic control and long-term business auditing, so Redis is never treated as the database of record, client feedback never becomes reward authority, and the service role cannot bypass the moderation workflow.
> - **When to update**: When the Redis topology/algorithm/failure policy, route groups, points caps/ledger, admin authorization, coordination detection, audit retention, or two-phase release approach changes.

- **Status:** Accepted / Stage B deployed; 0039–0040 and the compatible app had a protected production release at `2026-08-10T09:35:34Z`, and the go/no-go passed on 2026-08-22; the final revocation was then applied to production as 0052–0053 in strict append order, without back-filling the originally reserved 0044–0045 into the history.
- **Date:** 2026-08-10
- **Deciders:** Nalanda owner

## Context

Before this ADR, production 0038 already had an append-only points ledger and stable business keys, but no daily reward caps, manual-review reversals, or coordination signals. Sign-up uses the service role to create confirmed users, and Courses includes clone, report, and external-provider cost paths; nginx burst limits alone cannot provide atomic windows per user/email, nor keep privacy-minimized long-term abuse audits. The part of these gaps within this ADR's scope was closed by production 0039.

At the same time, posts, Feedback, and Schedule still had overly broad direct PostgREST write surfaces. The security lockdown had to stay compatible with the existing Web app and could not ship database contract permissions and the app update in a single unobservable release.

## Decision

1. The production compose file adds Redis 7.4 with no host port, password authentication, AOF `everysec`, and `noeviction`. Redis only stores short-lived sliding windows, audit aggregate counters, and scanner distributed locks — never rewards, moderation, or content facts.
2. After authentication, Nest applies an atomic Lua sliding-window rate limit: authenticated routes by user UUID, public/burst routes by HMAC IP, and sign-up additionally by HMAC of the normalized email. The HMAC secret and Redis password rotate independently, and raw values never enter the database or structured application logs.
3. When Redis fails, sign-up, writes, public Courses, clone/report, and reads that incur provider cost fail closed; truly private reads fail open and record `rate_limit_degraded`. Readiness must genuinely verify both Supabase and Redis.
4. PostgreSQL stores first-reward decisions in frozen `point_daily_windows` and permanent `point_daily_award_claims`; Redis plays no part in points correctness. The daily counts for original posts/reposts/comments/likes/tasks are 3/10/10/20/10; course completion keeps using a permanent word-set fingerprint with no daily cap.
5. Moderation only goes through an allowlisted admin API and service-only RPCs; `point_moderation_actions` keeps an append-only trail. The service role has only SELECT on the window/claim/action/signal/API audit tables and cannot rewrite facts through PostgREST. Ordinary rewards take a shared moderation gate; moderation takes an exclusive gate and locks the Profile first, then the state; restore does not re-issue cap=0 claims or restore deleted sources, and repeated actions are recorded as zero-change audits.
6. The coordination scanner only creates deduplicated pending signals and never automatically freezes, reverses, hides, or penalizes. An admin's signal review also writes the database time and reviewer through a narrow RPC.
7. Posts/Feedback/Schedule use column grants, RLS, and defensive triggers. 0039–0040 is the expand phase: the old Web app can still submit `posts.updated_at`/`study_tasks.done_at`, but the database overwrites the values; after observation passes, 0052–0053 only revoke those two authenticated UPDATE grants and verify the final permissions. Materials AI is unrelated to this contract.

## Results and trade-offs

- Losing Redis only affects short-lived windows and locks and cannot change the ledger; AOF reduces window loss on restart but is not treated as a strongly consistent business backup.
- Failing closed sacrifices some write availability when Redis fails; this is a deliberate choice to protect sign-up, provider cost, and duplicate side effects. Purely private reads can still degrade.
- A per-user profile row lock keeps concurrent cap decisions simple and verifiable, but serializes all points events for the same user; monitoring must watch lock waits and attempt/points RPC p95.
- For business keys created before the migration, a reward is acknowledged only when the first transition is positive; where 0008/0009 placeholders left a negative transition, 0039 zeroes it with an explicit append-only compensation. This adds one class of migration entry but prevents hidden debt from eroding future legitimate rewards while keeping a complete audit chain.
- HMAC rotation cuts the cross-rotation link for old actors; database buckets before and after rotation never attempt to reverse or re-identify raw IPs/emails.
- Flag-only coordination thresholds will have false positives/negatives, so signals cannot directly produce penalties; a full moderation UI, appeals, and a content-quality model are left for later.

## Verification and release

- CI uses a real Redis service to verify Lua concurrency/expiry/locks, and a throwaway Supabase to verify exact grants, two-user negative paths, cap concurrency, time zones/rebuilds, root suppress/restore, and pending signals; browser providers are still fakes.
- Phase one is complete: read-only migration plan → encrypted recovery point → apply 0039–0040 → Redis PING/AOF/private network → new API readiness/auth/rate limits/admin denial → real existing-provider gate → activate the compatible app; evidence is in deployment run `31372888441`.
- Observation from `2026-08-10T09:35:34Z` exceeded 24 hours; the 2026-08-22 review of Redis/AOF/noeviction, false rate-limit audits, the points projection, and supported Web timestamp-field dependencies passed the go/no-go. 0052–0053 then shipped through full CI, plan `32581192318`, recovery artifact `9478168126`, and apply `32581805613`; the database is always fixed forward, and the app can still roll back to the previous compatible release.
