# Nalanda Security Policy

> **About this document**
> - **Contents**: Describes how to report vulnerabilities to Nalanda, the current security boundaries, known risks, the development and release security baseline, and security incident response requirements.
> - **Purpose**: Gives researchers, contributors, and operators a single entry point for security collaboration, so secrets, vulnerability details, or user data are never exposed in public channels.
> - **When to update**: When authentication/authorization, RLS, uploads, AI, payments, the deployment topology, or third-party processors change; when a high-risk issue is found or fixed; and at least once a quarter.
> - **Status baseline**: 2026-08-22. The production database has a protected application up to 0053; 0052–0053 completed the timestamp-column Stage B, so authenticated users can no longer UPDATE `posts.updated_at` or `study_tasks.done_at`. In the same run, the latest app candidate automatically restored the stable release after the real Materials AI PPTX gate failed twice, so the database version cannot be used to claim the candidate UI or provider capabilities are live. Field lockdowns, points caps/moderation/coordination signals, and Redis rate limiting remain in effect. This document clearly separates code, database, app, and provider launch status.

> **Unreleased app changes:** the 0046–0055 database changes are applied; the 0056–0057 candidate retires Ox Alpha and changes Luna's completion constraint to GPT-6 Luna + Azure usage. The corresponding app includes service-role-only checkpoint/usage/knowledge Q&A/job cleanup/graph layout, the Luna native-file path, and a 24-hour recovery TTL. Luna is only turned on when both the live catalog and the actual provider gate are compliant; otherwise it stays disabled and ZDR is never relaxed.

## 1. Supported scope

Only the latest commit on `main` and the version behind the production site `nalanda.online` are maintained. The prototype directory `app/` is only a design baseline and is not accepted as a production security boundary. Historical commits, personal forks, locally modified versions, and the undeployed `infra/hybrid-2g` scaffolding are out of scope, but issues in them that reproduce against the current code are still welcome.

## 2. Report vulnerabilities privately

Please use the repository's [GitHub Private Vulnerability Reporting](https://github.com/1590703336/Nalanda/security/advisories/new) first. If that is unavailable, report through a private contact method provided by the repository owner — **do not open a public issue, PR, or community post**.

A report should include at least:

- The affected commit, URL, table, Storage bucket, or endpoint;
- Required privileges, reproduction steps, and expected vs. actual results;
- An impact assessment (unauthorized read/write, account takeover, secret leakage, loss of money or AI quota, and so on);
- Minimal verification evidence, with real user PII, access tokens, and secrets removed;
- Mitigation suggestions if known — but do not widen the scope of verification on production.

Maintainers aim to acknowledge receipt within 3 business days and give an initial triage within 7 business days. Fix times depend on severity and third-party dependencies. Unless both sides agree, please do not disclose details before the fix is released.

### Security research boundaries

Good-faith, low-impact verification against test accounts and data you own is allowed. Forbidden: accessing or modifying other people's data, persistent control, denial of service, mass registration/spam, social engineering, scanning third-party infrastructure, downloading real user files, triggering real payments, or causing third parties significant cost. If verification might cross these boundaries, get written permission first.

## 3. Current security boundaries (implemented)

| Area | Current facts | Assumptions not to make |
|---|---|---|
| Authentication | Supabase Auth; NestJS uses JWKS, with an HS256 fallback for older projects; both paths check signature, issuer, and the authenticated audience | Not every business path goes through NestJS |
| Sign-up | `/api/auth/register` uses service-role to create confirmed users; production 0039 adds nginx + Redis HMAC IP/email rate limiting and auditing | Still no CAPTCHA or email ownership verification |
| Business data | Most Web business logic talks to PostgREST/Storage directly through `supabase-js` | Frontend validation is not a security boundary; RLS/constraints must be relied on |
| Private materials | `courses`, `materials`, and the `materials` bucket are isolated by `auth.uid()` | Deleting file metadata does not guarantee transactional object deletion |
| Community | Posts/comments are publicly readable by authenticated users; production 0039 limits post writes to content columns and maintains owner/snapshot/counters/time with triggers; the community media bucket is currently public | Public media URLs offer no revocation, authorization, or anti-scraping guarantees |
| Feedback / Schedule | Production 0039 makes Feedback owner insert/read only and validates goal/task course/material/goal ownership and `done_at` with triggers | Full account deletion/Storage orchestration still does not exist |
| Profile / points | 0008 protects economy/level/streak with column grants; production 0039 adds frozen daily windows, permanent claims, moderation reversals, and flag-only coordination detection | This is not a credits/VIP/payment commercial ledger or automatic content-quality judgement |
| Courses API | NestJS bearer + owner checks, writes through dedicated service-role transaction RPCs; clients only read private rows, and public distribution reads are redacted by the API; the overall production history is at 0043 | Service-role, feature flag, or API bugs can still bypass RLS; provisional UI/countdowns are not growth facts |
| Redis request protection | Production 0039 runs private/password/AOF/noeviction, and Lua window keys only use user UUIDs or HMAC IP/email; Redis stores no points facts | PING does not prove AOF/capacity, HMAC rotation resets actor windows, and Redis cannot replace PostgreSQL auditing |
| Sharing/course market | Tokens are stored only as SHA-256, publication snapshots are immutable, free clones are independent and cannot be redistributed, and reports/admin actions are recorded as facts | Anyone with the link can preview; there is only minimal governance, with no appeals/general moderation console; Course Market does not mean Note Market is real |
| Azure Speech | The key stays in the API; the reference is derived from the owner's word/session; WAV ≤ 2 MB/8 seconds with format validation; recordings are not stored; the production Japan East base gate and the 0015–0016 queue/repeated-word/trimmed-scoring gate have passed | PR/Playwright automation is still fake; a one-off release gate is not proof of ongoing availability, and the TTS cache is not user recordings |
| OpenRouter translation pre-test | The API derives reference translations from the owner's session/word; leases and idempotency by UUID/revision; user answers are stored only as hashes; new tables/RPCs are service-role-only; the real production gate has passed | Neither fakes nor a single real smoke prove ongoing semantic quality, and model output cannot directly become a growth fact |
| Other API capabilities | health, register, me; most older business logic talks to Supabase directly | Security controls for Courses AI file import, payments, wallets, and a general admin back office do not exist yet |
| Materials AI | Production 0041–0043: an owner-only Nest API, service-role transactions, durable Postgres jobs, BullMQ UUID delivery, and an internal-token FastAPI; OpenRouter with fixed ZDR models and strict schemas | Injection classification, ZDR, structured output, or a single real gate cannot provide an absolute mathematical safety guarantee |
| Luna native files (candidate) | Inline base64, no Files API; PDF native parser; fixed GPT-6 Luna + Azure-only/no fallback; response upstream and usage ledger double-checked; separate flag/format allowlist | A model "supporting files" does not mean every Office/text format passed real gates; no automatic conversion or downgrade |
| Payments | Stripe, orders, ledgers, refunds, and revenue share are not implemented | `profiles.credits`/`vip_until` are not a trustworthy wallet or subscription system |

## 4. Fixed controls and open risks

- Candidate code removes the API's dependence on long worker response headers: after the 202 acceptance, only workers holding the internal token may call back. Provider usage is written to a 0600/0700 local spool first, then idempotently to the ledger; validated checkpoints may contain private DocumentIR/artifacts within the TTL and must never be backed up, logged, or reused across jobs.
- Knowledge-node questions are read only by the API from the owner's Note graph/DocumentIR; the browser cannot submit models, keys, source blocks, or callback URLs. Questions, focus, file text, and images are all untrusted data, and deterministic signals and the two safety reviews keep failing closed.
- In DocumentIR's first review, only `uncertain` results confined to regions the parser declared as failures may be sent to isolated visual recovery; deterministic signals in parsed text/focus, unknown locations, or `malicious` are rejected immediately. Visual content must be strictly reviewed again after being stitched back, and a final `uncertain/malicious` never enters graph or test-paper generation. This rule avoids treating "not yet read" as "confirmed malicious", without marking invisible content safe in advance.
- Candidate Delete/Cancel first settles the allowance atomically in the database and enters `deleting`, then the internal-token worker cancel/purge cleans up HTTPX, the Office process group, checkpoints, the usage spool, and the 0700 directory; a job must not be hard-deleted or hidden from the UI before its usage is durably recorded and cleanup is confirmed.

The repository's 0008 migration closed the original three P0s:

1. Authenticated users can only update Profile's `username/university/major/year/language/timezone`, and timezone must be valid; `credits/points/level/level_name/vip_until/streak/streak_date` are protected by column grants and a defensive trigger.
2. `_add_points` is revoked from clients and service-role; `_notify`, `_set_point_event`, and the trigger helpers have client EXECUTE revoked and a pinned `search_path`.
3. Like, comment, original post/repost, and task rewards are written to the append-only `point_entries`, serialized with durable business keys and `point_event_states`; un-completion/deletion is reversed, and redoing only restores the same net amount. Clients cannot write the ledger/state tables.

These controls are covered by two-user RLS regressions and the 0007→latest history upgrade. 0011–0038 entered production through the protected process: Courses server workflows revoke client EXECUTE, forbid clients from writing content/progress/badges/points, and limit the public distribution surface; answer attempts are bound to owner/session/revision with UUID idempotency keys, the durable audio queue, translation judgement, and STT quota tables are not exposed to clients, and new RPCs are executable only by service-role. Release facts are in the [database release records](docs/operations/DATABASE_RELEASE_ROLLBACK.md).

Open high-priority risks:

1. The sign-up endpoint holds service-role and confirms emails directly; production 0039 added source/email rate limits and abuse auditing, but CAPTCHA, email ownership proof, and fuller anti-automation are still missing.
2. NestJS returns CORS permissions based on `CORS_ALLOWED_ORIGINS`/`PUBLIC_ORIGIN`; the allowlist and credential policy must still be reviewed whenever a production domain or preview domain is added, or before cookie-based authentication.
3. The 0039–0040 fixes for posts, Feedback, Schedule, and points completed the protected phase-one release and real RLS/permission verification. The 2026-08-22 go/no-go confirmed that the compatibility period exceeded 24 hours and the supported Web app no longer submits the two timestamp columns; the final revocation was applied to production by 0052–0053 and verified fail-closed by 0053, and the originally reserved 0044–0045 were not back-filled into the history.
4. Community media is a public bucket; deleting a post does not automatically prove the attachment is deleted, and governance of upload types, sizes, malicious files, and orphan objects is incomplete.
5. The pre-migration points cache cannot prove its origin; `legacy_opening=11` was zeroed by 0009's append-only reversal. Production 0039 only acknowledges grandfathered rewards whose first business transition is positive; historical negative balances caused by 0008's back-filled placeholders are zeroed with separate append-only compensations, and old entries cannot be rewritten. Coordination thresholds only flag by interaction structure and never penalize automatically, and there is no semantic spam judgement, full moderation back office, or appeals; points are still not a commercial currency or an anti-cheat reputation credential.
6. `credits`/`vip_until` are locked as server fields but still have no orders, credit/VIP ledgers, or a Stripe chain of record, so real commercial entitlements cannot be enabled.
7. Local environment files once existed in the repository; any secret that was ever committed, logged, or shared in terminal output must be treated as leaked, and deleting the file is no substitute for rotation.
8. NestJS uses service-role to access Courses. Production 0039's general request limit fails closed for sign-up, writes, public Courses, and cost paths when Redis fails, and fails open for private pure reads; route classification, trust proxy, HMAC logging, and false limiting of legitimate traffic must be watched continuously and cannot be "fixed" by turning off the interceptor.
9. Course sharing is a bearer-link model: anyone with the link can read the current word list; authors must be able to revoke/rotate. Market v1 administrators come from an environment UUID list, with no general RBAC/appeals yet; changes must be audited.
10. Azure recordings are not persisted but are forwarded to a third party within the request; provider terms, region, DPA/retention, and real cost alerts must be confirmed before the production flag. Provider failures must not accumulate user errors.
11. The OpenRouter translation pre-test, after the user explicitly turns it on, forwards the current English term, reference translations, and the user's typed translation; its retention/training/cross-border/sub-processor terms still need to be completed and reviewed continuously. Model misjudgement is an educational risk; provider failures or invalid structured output must not accumulate errors, and a failed semantic baseline should turn off the narrowest flag.
12. Materials AI sends the parsed full file content to DeepSeek and failed page/region images to MiMo; jobs can only be created after each account accepts the versioned third-party processing notice. `malicious/uncertain` injection must be rejected, and topics/files/answers are isolated as untrusted data; model classification cannot be the only defense, and fallback routing must never bypass ZDR.
13. FastAPI's per-job 0700 temporary directory and `finally`/orphan cleanup only handle process files; `ai_material_parse_cache` and generated Notes are disclosed, durable private data. Storage object deletion is best effort, and failures must alert/retry rather than relying on a database cascade to claim complete deletion.
14. Luna sends the user's selected native file directly to GPT-6 Luna hosted by OpenRouter/Azure; not running local text extraction does not reduce the privacy impact of a third party seeing the full file. Per-account consent, ZDR/deny collection, Azure-only, and no tools/Web must be kept; unsupported formats stay disabled.
15. Courses translation judging only sends minimal word-meaning context (the English term, reference translations, and the learner's answer, with no account identifiers) to the free Nemotron; the free endpoint may log prompts, so requests do not declare deny collection, and separate privacy and quality reviews are needed.

## 5. Data and secret classification

| Level | Examples | Baseline requirements |
|---|---|---|
| Public | Published community content, public docs, the frontend anon key | May be public, but still needs integrity, moderation, and rate limiting |
| Internal | Architecture, non-sensitive logs, aggregate metrics | Team/controlled systems only |
| Confidential | Email, school/major, private courseware/word lists, learning attempts/progress/reviews, read-aloud scores, notes, feedback, IP/device information | Least privilege, encryption in transit/at rest, retention and deletion rules |
| Restricted | service-role, JWT secret, Redis password, RateLimit HMAC, Azure/OpenRouter/Stripe/Anthropic secrets, webhook secrets, plaintext share tokens, backups, payment/identity data | Server-side secret store/one-time responses only; never in browser bundles, the repository, chat, screenshots, or ordinary logs |

`VITE_*` variables end up in the browser bundle and may only hold the Supabase URL/anon key. service-role, JWT, Azure, OpenRouter, Stripe, Anthropic, and webhook secrets must never use `VITE_*`.

## 6. Development security baseline

- Every table enables RLS by default; verify `SELECT/INSERT/UPDATE/DELETE` separately, with cross-user negative tests using two real-permission test users.
- Separate user-editable fields from server fields: update them through column grants, restricted RPCs, or backend DTOs, and never allow whole-row profile writes.
- `SECURITY DEFINER` must pin `search_path` and revoke default execute. Client entry points bind `auth.uid()`; for service-role-only entry points, the user ID can only be derived by the API from a verified JWT with an owner check, never trusted from the request body.
- Every change to amounts, balances, points, and entitlements uses an immutable ledger, unique business event keys, and reversal records; directly editing balances is forbidden as a normal flow.
- Server endpoints do structural validation, object ownership checks, rate limiting, and auditing; errors must not return secrets, upstream bodies, SQL, or stack traces.
- Redis only stores expiring protection state; user UUID/IP/email actors are HMACed with a separate secret first, and raw values are never written to Redis/Postgres/application logs. Cost/write paths must not silently fail open when Redis fails; points decisions live only in PostgreSQL.
- Uploads check extension, MIME, magic bytes, size, and page count; object names are generated by the server; the target phase adds malicious-file scanning and a quarantine area.
- HTML/Markdown/AI output rendering must be sanitized; community bodies, file names, and model text are all untrusted input, defended against XSS, formula/URL injection, and prompt injection.
- The AI service only receives authorized materials, uses service-to-service authentication, and does not log raw courseware or full prompts; provider training/retention terms must be approved.
- The Materials AI worker only allows the project's signed Storage host, forbids tools/Web, and fixes provider/model/schema. The DocumentIR path limits Office zip expansion/pages/characters/images/resources; the Luna/Ox paths only validate and send allowed raw bytes, forbid calling extractors, OCR, converters, or the Files API, and verify the actual upstream. Ox's allowlist must also be intersected with the image set. FastAPI 422s must not echo signed URLs/tokens/payloads either.
- The reference for semantic translation judgement can only be derived from the current owner's session/word; the answer text is only forwarded in memory, and the database/logs only keep the hash and non-text metering; provider output must pass structural validation and be converted by an authoritative transaction, never trusted directly.
- The Speech reference can only come from the current owner's word/session; limit WAV magic/codec/sample rate/channels/bit depth/size/duration, and recordings are only forwarded in memory and must never enter the DB, Storage, logs, or backups.
- Public shares/market only return redacted, escaped snapshots; tokens are stored only as hashes; revocation/cloning recheck active in the same transaction. Report counts must not automatically delist, and admin actions must write audit facts.
- Logs use request/event IDs and never record Authorization, cookies, passwords, signed URLs, secrets, full documents, payment methods, or user deletion export packages.
- New dependencies need their maintenance status and license checked; commercial use of ExamPass-Assistant code requires a commercial license, otherwise only its methods may be referenced with a clean rewrite.

## 7. Merge and release security gates

PRs touching authentication, RLS, `SECURITY DEFINER`, Storage, user deletion, AI calls, credits, VIP, Stripe, or admin permissions need at least:

1. Approval from a second reviewer, with the threat, rollback, and data migration impact explained in the PR;
2. Typecheck, unit/integration, two-user RLS, and relevant E2E all passing;
3. Forward migrations for database changes, with runnable verification and rollback/compensation steps;
4. New environment variables added to the environment variable matrix with their secrecy level, owner, and rotation method;
5. New logs, metrics, and alerts free of PII/secrets;
6. Production changes verified in an isolated environment first, with payments using Stripe test mode;
7. The corresponding feature flag enabled only after known high-risk issues are closed.

The current workflow runs Python ruff/pytest, AI Docker, BullMQ/Redis, Materials AI RLS, and fake-provider Playwright. Production migrations still start with a read-only plan, then a protected apply/encrypted recovery point/remote verification; 0046–0051 must also truly verify Luna's OpenAI upstream, PDF native parser, raw bytes, per-format capability, injection rejection, cancellation residue, and cost auditing, with the sub-switch kept off first. These one-off gates do not replace continuous quality, provider terms, monitoring, or human review.

## 8. Security incident response

When an incident is suspected: first assign an incident owner and severity; preserve the minimum necessary audit evidence; isolate the entry point/turn off the feature flag; rotate suspected secrets and revoke sessions; assess data, money, and third-party impact; fix and verify; decide on notifications per applicable law, contracts, and the privacy policy; and finally write a retrospective free of sensitive information, with prevention items.

Money-related incidents also require pausing payouts and high-risk orders, reconciling Stripe webhooks with the internal ledger, and using reversals rather than deleting records. When a data deletion request conflicts with incident evidence, the privacy/security owner limits the scope and duration of what is kept.

## 9. Related documents

- [Contributing guide](CONTRIBUTING.md)
- [Privacy and data deletion](docs/governance/PRIVACY_AND_DATA_DELETION.md)
- [Content moderation](docs/governance/CONTENT_MODERATION.md)
- [Unified economy and payment rules](docs/product/POINTS_CREDITS_VIP_PAYMENTS.md)
- [AI evaluation and cost governance](docs/ai/EVALUATION_AND_COST.md)
