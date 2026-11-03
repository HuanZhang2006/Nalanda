# Privacy and Data Deletion Standard

> **About this document**
> - **Contents**: Defines the data Nalanda collects, its purposes and access boundaries, and the processes for user access, export, correction, deletion requests, retention, backups, and third-party AI/payment data processing.
> - **Purpose**: Provides an executable privacy baseline for product design, the database, support, security, and operations; it is also the engineering input for the public privacy policy and data processing agreements.
> - **When to update**: When data fields, purposes, third-party processors, target regions, AI/payment capabilities, retention periods, backup methods, or user-rights processes are added or changed; when a privacy incident occurs.
> - **Status baseline**: 2026-08-23. This document is not legal advice or a published privacy policy; the production database is at 0053, but the app candidate for 0046–0051 has still not passed real gates, so Luna, the graph, or the job lifecycle must not be described as enabled. DocumentIR's user consent, private parse cache/Notes, and process-file cleanup boundaries are unchanged; neither STT nor the existing Speech persist user WAVs, and recordings are only forwarded in request memory and discarded immediately.

## 1. Principles and responsibilities

Nalanda follows purpose limitation, minimal collection, least privilege, private by default, explainability, exportability, deletability, and auditability. Every data category must have a business purpose, accessors, a source of truth, a retention period, and a deletion path; "might be useful someday" is not a reason to collect.

Until specific people are appointed, responsibilities are assigned by role: the product owner decides necessity and user notices; the data/backend owner implements access and deletion; the security owner handles leaks and secrets; the support owner verifies and tracks requests; the third-party/legal owner confirms regional rules, minors, cross-border transfers, contracts, and statutory retention. Before production release, roles must be mapped to real on-call people and private contact channels.

## 2. Current data map

| Data category | Current location | Current purpose/visibility | Current deletion characteristics and gaps |
|---|---|---|---|
| Account | Supabase `auth.users` | Sign-in identity; API JWT | Deleting the auth user cascades to many tables, but there is no self-service flow |
| Profile | `profiles` | Username, email, school, major, year, language, growth display | Owner-only reads; users can only update profile columns, and points/credits/level/VIP/streak are protected by 0008 |
| Points records | `point_entries`, internal `point_event_states`; production 0039's `point_daily_*`, `point_moderation_actions`, `point_abuse_signals` | Growth events, frozen daily windows/reward decisions, reversals, manual moderation, and pending-review-only coordination leads | Users only read their own entries/owner receipts and cannot see internal tables; the main growth facts cascade with Auth deletion, and append-only moderation records are de-identified per the security/legal retention policy rather than silently rewritten |
| Course/material metadata | `courses`, `materials` | Organizing private study materials | Tables cascade per user; Storage objects need separate deletion confirmation |
| Material files | Private `materials` bucket | Preview, download, future AI input | User-path isolation; no unified export/orphan cleanup/proof of backup deletion |
| Community | `posts`, `comments`, interactions, follows, `tags` | Public exchange among authenticated users | Account deletion cascades content; public author snapshots/global tags need separate assessment |
| Community attachments | Public `community-media` bucket | Image/audio display | URLs can be held externally; deleting a post does not guarantee the object is deleted in sync |
| Study plan | `study_goals`, `study_tasks` | Private goals, tasks, completion times | Owner-only; cascades with account deletion |
| Learning course content | `learning_courses/units/words` | Private course names, units, English/translation/IPA; clone source attribution | Owner read-only, API writes; deleting a course cascades private content, but awarded points/badge history is not rolled back by deleting the course |
| Learning behavior | `learning_sessions/items/attempts/word_progress`, `learning_exam_word_snapshots` | Stages/queues, selected word sets, answers, correctness, error counts, mastery across distinct local dates, a monotonic revision, client attempt UUIDs, first-response snapshots, cancel time/reason, exam type/threshold/first-round stats, practice completion, pronunciation scores, and end-of-round confirmation; exam snapshots also keep the term/translation/IPA at the time and the final result, so content edits cannot tamper with history | Owners can only read exam history through a redacted API, and the snapshot table has no client permissions; cascades with Auth/course/session deletion; never returns WAVs, secrets, or full phoneme provider payloads; passing an exam only projects existing learning progress |
| Review | `learning_review_schedules`, Profile `timezone` | Due dates, skills/scope, completion time, and local-date interpretation | Owner-private; schedules can be cancelled, and time zone changes do not rewrite historical attempt local_date |
| Sharing/course market | `learning_course_shares/publications` | Bearer-link current course, immutable public versions, author display name/source, clone count | Plaintext tokens are returned only once and the DB stores only hashes; shares can be revoked; publications are read publicly through the API; Auth deletion removes the author's versions per FK |
| Reports/moderation | `learning_course_reports/moderation_actions` | Category/description, reporter, status, admin reason | Reporters can only read their own reports; actions are invisible to clients; after an admin/reporter is deleted, rows are deleted or de-identified per FK |
| Course badges/growth | `badge_definitions/user_badge_awards` + points | Achievements for mastered words/courses/review dates and the +20 fact | Awards persist to prevent duplicates; not rolled back when a course is deleted, cascade when the Auth user is deleted; not a commercial entitlement |
| Speech | In-request WAV, `learning_attempts.provider_details`, `learning_speech_usage`, `learning_audio_assets`, private `vocabulary-audio` | Azure read-aloud scoring, score/phoneme teaching feedback, quotas/estimated cost, synthesized TTS objects shared across users, and the generation queue | User WAVs are only forwarded in memory and then discarded, never entering DB/Storage/logs/backups; synthesized objects/queue contain no owner, translation, or recording; scores/usage are deleted/de-identified per the rules |
| Spelling translation pre-test | In-request user translation, `learning_spelling_translation_assessments` | Normalized exact matches are judged by Nalanda at zero tokens; OpenRouter only judges whether non-literal answers semantically cover the server-side reference translations; the server stores idempotency/quota/teaching feedback | The user's translation text is only forwarded in API request memory, never entering DB/logs/backups; the DB stores only SHA-256, the boolean, short feedback, provider/model/token metering, and the first response, cascading on session/word/user deletion |
| Translation voice input (enabled in 0037) | Short browser WAV, in-request transcript, `learning_speech_usage` | The user records voluntarily in the pre-spelling translation input; OpenRouter Fish Audio recognizes it as Chinese by default and fills the text back for the user to edit, without automatic submission or grading | The WAV and transcript exist only in browser memory and a single NestJS/OpenRouter request, never entering DB/Storage/Cache/logs/backups; the database only keeps the `translation_stt` quota/estimated cost, with the user link SET NULL after Auth deletion; the formal privacy policy, Fish Audio/OpenRouter data retention, training use, region, DPA, and user notice still need ongoing completion and review by the product/legal owner |
| Browser weak-network copies | IndexedDB attempt outbox, Cache Storage audio | Weak-network retries, prefetching the next five words, and user-chosen offline unit audio copies | Signing out clears that account's pending outbox; audio is stored as rebuildable copies under global content keys, which users can delete and browsers may evict under storage pressure |
| Notifications/feedback | `notifications`, `feedback` | Interaction notifications, user tickets | Since production 0039 users can only read/insert feedback, and status is only maintained by the support workflow; no formal ticket retention/deletion orchestration |
| Prototype/mock data | Frontend bundle/memory | Demo Home, Notes, Market, AI | Not a user source of truth and should not appear in user exports |
| Materials AI jobs and allowances (production 0041) | `ai_user_plans/ai_daily_usage/generation_jobs/events` | Per-account consent, the two Free allowances, durable jobs/stages | Auth deletion CASCADE; jobs store no content/prompt/raw response; failure/cancellation releases the reservation |
| Materials AI parsing/artifacts (production 0041) | Private `ai_material_parse_cache`, `notes/note_materials/note_artifacts` | Reusing DocumentIR for the same file; storing the full test paper/answers/sources the user requested | The cache CASCADEs with the material; deleting the source can keep results under Unfiled or delete them too; users can delete Notes |
| Online exams (production 0041) | `exam_attempts/answers/operations`, browser IndexedDB drafts | Deadlines, drafts, scores, AI feedback, and idempotent replay | Note/Auth deletion CASCADE; signing out prevents drafts from being submitted across accounts; full DSAR/one-click deletion is still not implemented |
| AI provider metering (production 0041) | `ai_provider_usage_events` | Model/tokens/micro-USD/latency/request ID/ZDR/status | Contains no prompt/content/answers/raw response; after a Note/answer sheet is deleted, the immutable subject UUID and cost facts are kept so deleting content cannot bypass the budget; CASCADEs with Auth user deletion |
| AI recovery, knowledge graph, and native-file pipeline (0046–0051, 0056–0057 candidate) | DB checkpoints/node Q&A/cross-device layouts, worker 0700 checkpoint/usage spool, graph artifacts; in-request native files for Luna | Recovering validated stages, storing private graphs/Q&A/layouts; Luna sends allowed full PDFs/images inline to GPT-6 Luna hosted by OpenRouter/Azure (ZDR) | DB checkpoints have an owner/expiry; local copies are not backed up and are cleared at terminal states/Delete/TTL; layouts/Q&A CASCADE with the note/user; no Files API; usage keeps metering/the real upstream but no prompt/content/reasoning/raw response |
| Payment data | No Stripe/order tables yet | Not implemented | In the future, only necessary Stripe IDs/status are stored, never card numbers/CVC |
| Rate-limit/abuse auditing (production 0039) | Private Redis, `api_abuse_events` | Short sliding windows, distributed scan locks, route group/rule/bucket aggregates | IPs/normalized emails are stored only as HMACs derived with a separate secret; no raw IP, email, content, or course data; DB aggregates default to 30 days, and Redis keys/AOF are rebuildable runtime copies |
| Operations data | Host/container/GitHub/Supabase logs | Deployment and troubleshooting | Ordinary logs must not record raw IPs/emails/content/secrets; unified export and deletion orchestration are still missing |

The Supabase anon key is public client configuration, but the service-role/JWT secrets are Restricted; secrets are not part of user exports but need independent rotation and incident handling.

## 3. Data uses and prohibited uses

Allowed target uses: providing authentication and learning features; storing materials users upload themselves; generating AI content users request; providing community, planning, notifications, and support; executing user purchases/VIP/creator settlement; protecting security, preventing fraud, and meeting legal obligations; improving the product with de-identified aggregate metrics.

Without separate review and clear consent, the following are prohibited: selling personal data; training Nalanda/third-party general models on private courseware, prompts, or generated content; using school/major for sensitive profiling or advertising; mixing payment/identity data into the community; reusing data for new purposes incompatible with the original purpose.

## 4. Current rights capabilities and honest disclosure

- **Access:** users can view part of their profile, courses, materials, community, and plans in the UI; this is not a complete data access package.
- **Correction:** Profile already separates user profile data from internal growth/economy fields with column-level permissions; production 0039 locked down feedback status and trusted post fields.
- **Deletion:** users can delete some of their own materials/posts/comments/tasks; there is no "delete my account in one click" and no orchestration or proof of completion across Storage/AI/backups/payments.
- **Courses:** users can edit/delete private courses, cancel schedules, and revoke shares; deleting a course does not delete points/badge history that already happened. There is currently no unified process for complete data export, one-click account deletion, or authors withdrawing all publication/report history themselves.
- **Materials AI:** users can Cancel/Delete individual jobs, clear terminal history, and delete test papers/knowledge graphs; deleting an active job interrupts the provider/Office work and disappears after the worker confirms cleanup. Clearing history does not delete Notes or provider usage. When deleting Materials/courses, results can be kept under Unfiled or deleted too; layouts are deleted with the Note, and the parse cache with the source. This is still not a one-click permanent deletion across backups/third parties.
- **Export:** there is currently no complete machine-readable export.
- **Restriction/objection/withdrawal:** there is currently no unified ticket status or automated execution.

Therefore, until the target processes are complete, Nalanda must not publicly claim "you can fully export/permanently delete all data in the app". When support receives a request, it can only use an authorized manual process, stating the scope, the expected time, and backup exceptions.

## 5. Target data subject request (DSAR) process

Every access, export, correction, deletion, restriction, and objection request enters a single case recording `request_id`, type, region, received/due time, verification method, scope, execution steps, exceptions, approvals, and completion evidence; cases do not keep unnecessary copies of ID documents.

### 5.1 Requests and identity verification

1. Prefer requests initiated by signed-in users in settings, with recent re-authentication.
2. When the user cannot sign in, verify through the account's verified email plus additional low-risk signals; never rely on public profile information alone.
3. High-risk data is not sent as ordinary email attachments; use short-lived, single-use, revocable download links.
4. Respond within the period applicable regulations require; the internal default target is completion within 30 days, or the shorter regional requirement.
5. Exceptions for clearly repetitive/excessive requests, statutory retention, or security investigations are recorded in writing by the owner and cannot be refused verbally by an engineer.

### 5.2 Export package

The target export includes: account/profile JSON; Materials; learning courses/units/words, sessions/attempts/progress/review schedules, your own shares/publications/reports/badges, and scoring feedback; original material files; notes/AI results; community, plans, notifications/feedback; and economic statements. Share tokens/hashes, internal queues/moderation evidence, other people's PII, secrets, full security logs, and third-party proprietary data should be removed or redacted; user WAVs were never stored and do not appear in exports.

Export packages must be stored encrypted, valid briefly, with audited downloads, and deleted automatically on expiry. Creating an export must not bypass RLS: the backend authorizes each resource and records the manifest and row counts.

### 5.3 Deletion orchestration

The target deletion uses a resumable, retryable, idempotent server-side job:

1. Re-authenticate, create the case and a deletion snapshot manifest, and immediately freeze new uploads/purchases/generations;
2. Provide a clear undo window; when a high-risk incident, legal hold, or unsettled funds exist, freeze only the necessary scope;
3. Cancel the Stripe subscription/future renewals, and handle refunds, disputes, creator payables, and statutory financial retention; never directly delete immutable ledgers;
4. Delete/anonymize community content, comments, interactions, follows, notifications, feedback, courses, tasks, personal notes, and AI artifacts;
5. Enumerate and delete objects under `materials/{user_id}/...`, `community-media/{user_id}/...`, and future export/AI buckets, handling orphans and historical versions;
6. Delete learning courses, sessions/attempts/progress/schedules, spelling translation judgement hashes/responses, shares, and your own publications/reports/badges; verify that moderation actors and speech usage are de-identified per FK. Once 0039 is enabled, also delete the user's attributable daily windows/claims/notifications, and de-identify abuse signal account sets, reviewers/actors, and moderation action references per the approved security retention period; immutable audits must never be deleted to cover up moderation that already happened. `vocabulary-audio` is a synthesized cache in a private bucket shared by normalized content; it contains no owner and is not cleared because a single user is deleted;
7. Clear that account's browser IndexedDB outbox; Cache Storage audio has no account identifier and can be cleared separately by the user, and the account deletion UI should offer a matching cleanup;
8. Delete parse blocks, embeddings, prompts/caches, user-linked queue payloads, search indexes, and copies kept by third-party providers; the global TTS generation queue keeps only owner-less content keys and runtime metadata;
9. Delete the Supabase Auth user so constrained tables cascade; then verify in reverse that learning/private/public/growth facts and objects are gone, rather than only checking the job status;
10. Keep a minimal deletion receipt without direct PII, and notify the user of completion and backup limitations.

Deletion failures must enter retries and alerts; with partial success, "everything is deleted" must not be sent.

## 6. Target retention matrix

The following are engineering default upper limits that must be approved for the target regions, contracts, and actual backup capability before launch. User-initiated deletion takes precedence over default periods, except for statutory retention.

| Data | Active period | Target after deletion/expiry | Notes |
|---|---|---|---|
| Account/profile/private learning content | Lifetime of the account | Cleared from the main system within 30 days | A short soft delete may be used first to support recovering mistakes |
| Community content | From publication until user deletion/moderation removal | Deleted or anonymized in the main system within 30 days | Violation evidence keeps only the minimum necessary content and duration |
| Orphan community/material objects | No valid metadata reference | Cleaned up within 7 days | Public URLs may be cached externally; users need to be told |
| AI temporary input/rendering/OCR/raw responses | During a single job's execution | Deleted immediately on success/unrecoverable failure/cancellation; recoverable callback/provider failures only keep validated checkpoints/usage spool, cleared after a default 24h TTL | 0700 per job; no signed URLs or tokens/headers kept; clearly separated from the private DB checkpoint/parse cache |
| Materials AI private parse cache | While the source material exists or until the user deletes it | CASCADE when the material/Auth user is deleted | Bound to the source hash + parser/audit/vision version; only used for later processing of the same user's file |
| Materials AI Notes/graphs/layouts/node Q&A/answer sheets | While the user keeps the results | CASCADE when the user deletes the Note or account; deleting the source follows the keep/delete choice | Provider usage never stored content and is kept for cost auditing after job deletion; node questions/answers/layouts are private learning content; backups expire on a rolling basis |
| User read-aloud WAV | A single scoring request | Discarded from memory immediately after the Azure response/failure | The browser records at most 6 seconds with no VAD/silence trimming; it is only converted to the PCM WAV Azure needs, with a server limit of 8 seconds/2 MB; never written to disk, DB, Storage, logs, or backups |
| Read-aloud scores/learning attempts | Lifetime of the account/learning feedback | Deleted with the course or account; necessary security evidence needs separate approval | Only scores, error types, phoneme feedback, and local dates are stored |
| Translation pre-test input/judgement | Input text only for a single request; hash/judgement for the life of the session | Text discarded as soon as the response ends; assessment rows cascade with session/word/user | OpenRouter receives the English term, reference translations, and the user's answer; the database/ordinary logs never store the input text |
| Translation voice input | WAV and transcript only for a single request; quota facts kept per operational cost needs | WAV/transcript discarded immediately after the response; after the user is deleted, usage keeps only de-identified budget facts | OpenRouter Fish Audio receives the short WAV the user records voluntarily and the fixed `language=zh`, never the course name, reference answers, email, user ID, progress, or reward state |
| TTS private shared cache/queue | Performance/cost | Can be cleared at any time and regenerated through the queue | Only hashes of normalized English/voice/format/version, synthesized objects, and runtime metadata; no user ID/recordings |
| Browser attempt outbox | Weak-network sync | Deleted after server confirmation; signing out immediately clears that account's unsynced items | Contains this answer and session/word/revision/attemptId; must never be submitted across accounts |
| Browser offline audio | User-chosen offline unit playback | Users can clear it at any time; browsers may evict it | Rebuildable synthesized copies in Cache Storage, containing no user recordings or private course text |
| Course publications/reports/actions | Public distribution and governance | Deleted or de-identified per the current FKs when the author/account is deleted; the target policy may require restricted evidence retention | v1 cannot promise statutory long-term moderation retention; requires approval per launch region |
| API abuse events (production 0039) | Security and capacity protection | Deleted by a controlled prune after 30 days | Only HMAC actors, an optional internal user ID, route group, rule, bucket, and aggregate counts; no raw IP/email/content |
| Points moderation/coordination signals (production 0039) | Reward integrity and appeal auditing | Direct account references are de-identified when the account is deleted; cases/actions are kept for the approved security or legal period | Signals are only leads awaiting review; account graphs must not be kept indefinitely for modeling |
| AI artifacts and source mappings | Lifetime of the account | Deleted with the content/account | Usage metrics may be kept in aggregate after de-identification |
| Application/security logs | Operations and security | 30 days by default; security audits at most 90 days | No raw text/tokens recorded; extending needs approval |
| Support tickets | Handling and retrospectives | 24 months after closure or a shorter statutory period | Delete unnecessary attachments and sensitive content |
| Payment, tax, payable ledgers | Statutory/contractual purposes | Deleted/anonymized after the statutory period of the operating region | Separated from directly usable account data |
| Encrypted backups | Disaster recovery | Expire naturally within 35 days | Immutable backups are not rewritten for a single user after a deletion request completes |
| Export packages | User download | Deleted automatically within 7 days | Links are single-use/short-lived |

## 7. How backups relate to deletion

After deletion completes in the main system, user data may temporarily remain in encrypted, access-restricted rolling backups until those backups expire. Backups must not be used for routine queries or re-marketing; after restoring a backup, deletion tombstones/cases must be replayed so deleted data is not resurrected. Recovery drills must verify this replay step.

Keeping backups longer than the matrix, creating long-term snapshots, copying to a new region, or copying production data into development all require privacy and security approval. Development/testing uses only synthetic data by default.

## 8. Third parties and cross-border processing

The current runtime depends on GitHub, the deployment host, Supabase, Azure Speech, OpenRouter, and a same-host private Redis; Speech is enabled in `japaneast`, and user WAVs are only forwarded in request memory and discarded after the response. The DocumentIR path sends the full normalized DocumentIR to DeepSeek and only failed-region images to MiMo. Once enabled, the Luna path sends the user's selected full PDF/image inline to OpenRouter and forces the actual Azure upstream (GPT-6 Luna's only ZDR endpoint); it does not use the Files API, and "skipping parsing" does not reduce the third-party data scope. When the live catalog offers no Azure ZDR endpoint, the Luna sub-switch stays off. Courses translation judging sends the English term, reference translations, and the learner's answer to the free Nemotron (Nvidia), and that free endpoint does not promise deny collection. No path sends email, school, service-role, Redis keys, credits, or a user-chosen model. ZDR/deny collection/strict routing are technical controls and do not replace formal review of retention, training, sub-processors, cross-border transfers, deletion, and user notices.

AI requests by default only carry the fragments needed for the job and random internal IDs, never service-role, payment information, or unnecessary profile data. Payments go through Stripe-hosted pages/tokenization; Nalanda never collects or stores full card numbers/CVC.

Speech only sends Azure the current word's reference text and the short WAV the user records voluntarily; course titles, translations, email, school, user ID, or share tokens must never be sent. TTS only sends the English term. After a provider failure, the in-memory buffer must still be released, and the user's error count must not be incremented.

When OpenRouter fails, times out, or returns invalid structured output, the request text and lease must be released without creating an error attempt; production logs only keep the model, duration, boolean, and token counts. Model feedback is not a new reference answer and must not be used for training, market publication, profile inference, or any other purpose.

## 9. Minors and sensitive materials

A university-student product may still be used by minors. Before formally opening a region, the minimum age, guardian consent, and rules for handling school materials must be decided; until that review is complete, do not actively market to users below the local digital age of consent. Health information, identity documents, confidential exam materials, copyrighted courseware, and other people's PII do not automatically gain processing authorization because of "learning purposes"; the upload UI and terms must remind users to upload only content they have the right to process.

## 10. Engineering acceptance and auditing

Release gates for privacy features: a complete data inventory/owners; export schema and samples pass; the deletion job succeeds on a test account that includes tables, Storage, AI, search, queues, and third parties; repeated requests are idempotent; failures are recoverable and alert; deletions still hold after a backup restore; logs contain no raw text/secrets; support can look up cases but cannot arbitrarily download materials; user notices and exception text are approved.

Each quarter, sample one export and one deletion request (synthetic accounts), recording the time taken, omissions, and corrective actions. New tables/buckets/providers that are not in this data map must not go live.

## 11. Related documents

- [Security policy](../../SECURITY.md)
- [Content moderation](CONTENT_MODERATION.md)
- [AI evaluation and cost governance](../ai/EVALUATION_AND_COST.md)
- [Points/credits/VIP/payment rules](../product/POINTS_CREDITS_VIP_PAYMENTS.md)
