# Content Moderation and Community Safety Standard

> **About this document**
> - **Contents**: Defines the allowed/prohibited boundaries for the community, note market, public materials, and AI-generated content, and the reporting, triage, enforcement, appeal, copyright, and transparency processes.
> - **Purpose**: Unifies how product, moderation, support, security, and engineering handle user-content risk, and provides requirements for the moderation back office/data model.
> - **When to update**: When content types/regions/market features, policy categories, moderation tools, SLAs, appeals, or regulatory obligations change; after a major misjudgement/abuse incident.
> - **Status baseline**: 2026-08-23. The production database is at 0053: trusted post columns, points daily caps/manual reversals, flag-only coordination detection, unified Redis rate limiting, and private Materials AI data are enabled; the community/Note Market still has no general reporting back office, while Course Market's minimal reporting, durable limits, threshold alerts, and audited hide/restore are enabled. 0052–0053 completed the final timestamp-column revocation.

## 1. Scope and principles

Applies to posts, comments, tags, username/profile display, images/audio, shared notes, Course Market word lists/descriptions, official courses, AI-generated content, and moderation attachments. Private courseware/word lists are usually not proactively moderated; public sharing spreads by link possession and is handled through a restricted process when a valid report or legal notice is received.

Principles: safety first, context and proportionality, minimum necessary access, consistent enforcement, explainability, appealability, protecting reporters, and handling urgent risks promptly. AI may assist with ranking and detection but must never be the sole decision-maker for high-impact permanent bans/fund freezes.

## 2. Current capabilities and risks

- Posts and comments are readable by every authenticated user; authors can publish/edit/delete, and interactions go through RLS/triggers.
- Community images/audio live in a public bucket, so outsiders holding a URL may keep accessing cached copies.
- Free-form tags can be inserted by any authenticated user; there are no reserved words, merging, abuse limits, or an admin maintenance process yet.
- The general community/Note Market has no `reports/cases/actions/appeals` or trustworthy RBAC; Courses already has dedicated reports and moderation actions.
- No detection for malicious uploads/CSAM hashes/spam/hate/harassment. Course Market has durable publish/report quotas; production unified rate limiting covers sign-up, authenticated APIs, Courses writes, public shares, and the market, but that does not mean site-wide community governance is complete.
- Deleting a post cascades database interactions but does not guarantee media object cleanup. Community counters are maintained by triggers and points are already a reversible ledger; production 0039 locked down author snapshots, counters, and timestamps with column grants and defensive triggers.
- Course Market v1 only offers free clones of text English word lists: rights confirmation at listing, HTML escaping, daily publish/report limits, threshold alerts, no automatic delisting by count, and auditable hide/restore/withdraw by configured administrators; cloned content cannot be redistributed.
- `learning_audio_assets` and the private `vocabulary-audio` only store owner-less audio synthesized from normalized English and runtime metadata; they are not market publications, user-uploaded attachments, or a public read surface; the IndexedDB weak-network outbox also cannot bypass server-side moderation, growth, or publication transactions.
- Courses' minimal governance still lacks a report workbench, formal on-call/SLA, author notification/appeals, evidence snapshots, community linkage, and strong RBAC; site-wide market moderation must not be claimed as complete.

Until general capabilities launch, community size should be limited if minimum human response and an emergency takedown channel cannot be provided. Course Market may only open in stages after the administrator UUIDs, alert recipients, and kill switch are verified; Courses AI file import is not implemented, and the first version must not accept attachments or list automatically generated content directly. Production Materials AI only saves test papers to the user's private Notes and does not publish to the market.

## 3. Content rules

### 3.1 Strictly prohibited (P0/P1)

- Child sexual abuse material, sexual exploitation, or grooming;
- Credible, imminent suicide/self-harm or threats of violence against others;
- Terrorist propaganda, violent extremist recruitment;
- Non-consensual intimate imagery, sexual violence content, human trafficking;
- High-risk private information such as published passwords, access tokens, ID documents, financial accounts, or home addresses;
- Operational content for malware, phishing, bypassing account/exam systems, or stealing or destroying data;
- Clearly illegal goods/services or content the law requires to be removed immediately.

### 3.2 Prohibited (P1/P2)

- Hate, disparagement, or exclusion based on protected attributes;
- Targeted harassment, stalking, threats, impersonation, non-consensual doxxing;
- Sexually explicit content, especially involving people of unclear age;
- Spam advertising, scams, fake transactions, manipulation of ratings/points/credits/recommendations;
- Courseware/notes that infringe copyright, trademarks, exam confidentiality, privacy, or contractual obligations;
- High-risk medical, legal, or financial advice presented as authoritative answers;
- Selling plagiarized content, answer leaks, ghostwriting, or services that circumvent school integrity policies;
- Repeatedly posting clearly wrong AI content that may cause learning/safety harm while refusing correction labels.

### 3.3 Allowed but may be restricted/labeled

Sensitive material in academic discussion, criticism/news/educational context about harmful content, reasonable quotation and derivatives, non-targeted crude language, and low-risk model errors. Options include age/sensitivity notices, reduced recommendation, disabling trading, restricting attachments, and adding source notes, rather than always deleting.

## 4. Academic integrity and AI labeling

Nalanda may help with learning and practice, but must not, in the name of "AI learning", facilitate cheating in ongoing protected exams, ghostwriting, or bypassing school systems. Market publishers must declare that they have distribution rights; Course Market's first version sells nothing and only offers free clones, but copyright/integrity obligations are unchanged. AI-generated content must be visibly labeled and keep its source/model/prompt/parser/quality status; Courses AI file import is not implemented yet, so current text courses must not be labeled as AI-reviewed.

If AI output does not pass the schema/quality/safety gates, it stays a private draft or the generation fails, and it never automatically enters the market/community. Publishing or selling AI content requires additional checks of citations, copyright, personal information, prompt leakage, and factual reliability.

## 5. Report entry points and data minimization

The target is a report option on every visible piece of content and profile; signed-out urgent/copyright/privacy reports get a controlled form. The Course v1 API's current categories are `abuse/copyright/privacy/spam/academic_integrity/other`; it requires sign-in and can report only a publication or a share at a time; community entry points and finer P0 categories are not implemented yet.

Reports only collect the content ID, category, a brief description, and optional evidence; the system keeps a controlled snapshot/hash of the reported content so reporters do not need to re-upload illegal material. By default the reported user does not learn the reporter's identity. Abusive reporting can itself be limited, but good-faith reporters must not be penalized just because a report was not upheld.

Course v1 stores the target ID, category, a description of ≤1000 characters, the reporter, and the status, with no attachment/evidence upload. Reaching `COURSE_REPORT_ALERT_THRESHOLD` only alerts; automatic hiding by report count is forbidden, to prevent malicious reporting. Emergency hiding can only be done through the API by verified users in `COURSE_MARKET_ADMIN_USER_IDS`, recording the action/reason.

### 5.1 Materials AI files and prompt injection (production 0041–0043)

Private courseware does not become public "violating content" because of an AI safety rejection, and accounts are not penalized automatically. The processing chain treats files, images, focus, and user answers all as untrusted evidence: if the deterministic signals or either of DeepSeek's two classifications is `malicious` or `uncertain`, the job is rejected, the allowance released, and only a stable safety error and source location are returned to the user; `benign_educational` content that clearly teaches prompt security may continue.

The MiMo visual prompt only asks for verbatim text, headings, tables, charts, flows, formulas, icon meanings, visual relationships, unreadable regions, and suspected embedded instructions, and forbids following commands in images or making up information. Prompt-injection detection cannot guarantee absolute safety; false positives go to security/AI quality review, and classification must never be temporarily turned off, tools/Web allowed, a non-ZDR endpoint used, or the original file pasted into a ticket.

The knowledge graph in the 0046–0051 candidate is still a user's private Note and does not enter the community or market; the Ox Alpha native-image path added in 0054–0055 is retired by 0056–0057. DocumentIR graphs keep using two safety reviews; Luna graphs run a separate injection review directly on the native file, fixed to GPT-6 Luna + Azure-only with no tools/Web. Both validate node order, explanations, relationships, and sources; when a user asks a question on a node, the question is again isolated as untrusted data, and only the owner Note's selected node, adjacent relationships, and allowed sources are permitted. For a native-file Note whose source file still exists, the allowed-format original file is re-attached; once deleted, only the saved graph can be used, with sources clearly marked unavailable. `malicious/uncertain` is rejected and the undispatched reservation released; after the worker has accepted the job, it is settled under the job delete/cancel rules, and users are not penalized automatically for a rejection. Answers are educational feedback, not moderation conclusions, authoritative facts, or automatically publishable content.

Production 0039–0040 also establishes a points abuse moderation boundary. The coordination scan runs every five minutes under a Redis distributed lock and only creates `point_abuse_signals(status=pending)`: highly concentrated interactions from one actor toward one owner, mutual farming, small groups of 3–8 people, and concentrated bursts from new accounts are all just investigative leads, not violation findings. The system never automatically freezes, deducts points, hides, or bans; administrators in `MODERATION_ADMIN_USER_IDS` (during the compatibility period falling back to the Course Market allowlist only when empty) use a controlled API to mark signals and submit `suppress/restore` with a reason and an optional case reference. Suppressing an original post covers the original, reposts, comments, and like rewards anchored to the same root, and every change is recorded with immutable reversals and moderation actions; restore does not re-issue rewards that were originally zero because of the daily cap.

If a valid legal/policy request requires removing a synthesized pronunciation, locate it by normalized term, locale, voice, format, and synthesis version, delete the corresponding private Storage object, stop/re-queue it, and keep a minimal audit that contains no user recordings. Never wrongly attribute a shared synthesized object to the user who requested it first, and never treat an ordinary course deletion as a global audio takedown.

## 6. Severity and response targets

| Level | Examples | First-action target | Default action |
|---|---|---|---|
| P0 urgent | Child safety, credible imminent physical risk, actively leaked secrets | Escalate to on-call within 15 minutes; restrict the related features until 24×7 capability exists | Immediately restrict distribution/access, notify security/the designated owner, preserve minimal evidence per legal and safety processes |
| P1 high | Specific threats, doxxing, scams, malicious files, severe hate/sexual exploitation | Within 4 hours | Temporarily hide/freeze trading, human review, suspend the account if needed |
| P2 medium | Harassment, spam, copyright, cheating, repeated misleading content | Within 24 hours | Reduce distribution or temporarily hide, evidence review and notification |
| P3 low | Wrong tags, mildly inappropriate content, quality disputes | Within 3 business days | Queue for handling, prompt editing/labeling, or take no action |

These are target service levels and should not be promised publicly while there is no on-call staff. When P0/P1 coverage cannot be met, content capabilities must be narrowed or an emergency kill switch deployed.

## 7. Moderation lifecycle

1. **Intake and dedupe:** generate an ID for each report and merge by content/rule/reporter while keeping every submission.
2. **Automatic triage:** rate, hash, and text/media detection only provide confidence and rule hits; never send original content to unapproved third parties.
3. **Interim measures:** when severe and credible, restrict visibility, downloads, recommendation, sales, or payouts; avoid widening evidence access.
4. **Human decision:** moderators see the minimum necessary context, policy version, history, and region; record the rule, reasoning, evidence references, and duration.
5. **Enforcement:** no action, label, edit request, reduced recommendation, age/scope restriction, takedown, deletion, warning, feature/account/trading restriction, urgent escalation.
6. **Notification:** tell the content author the affected content, rule, action, duration, and appeal entry; record the reason when the law forbids disclosure.
7. **Appeal:** reviewed by someone other than the original moderator; restoring content also restores counters/entitlements, and economic reversals follow the ledger rules.
8. **Closure and learning:** record the conclusion and misjudgements; update detection/training/policy, without copying sensitive content into ordinary logs.

`confirm/dismiss` on coordination signals only records the human investigation conclusion; a confirmed signal is not itself an executed points reversal. Moderators must separately choose a specific content root or business key, state the applicable rule, and submit a moderation action, so statistical correlation is never used directly as grounds for a penalty.

## 8. Proportionate enforcement and account measures

A single low-risk violation is handled first with education/editing; repeated, evasive, coordinated abuse or severe harm may escalate. Account penalties must not be implemented by editing vague profile fields; the target is an entitlement/restriction with a reason, scope, start/end time, executor, case, and revocation record.

VIP, paid, creator, or high-points status grants no policy exemption. Fund freezes restrict only what the risk requires and must never swallow legitimate balances; refunds, earnings holds, and unfreezing follow the economic rules. Deleting violating content must not physically delete financial/moderation audit records; the two are linked by restricted references or hashes.

## 9. Copyright, privacy, and legal requests

Copyright/trademark notices record the rights holder, the work, the specific URL/ID, a good-faith statement, a signature, and regional requirements; counter-notices/appeals follow the applicable process. Do not automatically forward received identity documents to the content author. For suspected courseware/exam confidentiality issues, verify the requester's authorization and avoid becoming the school's disciplinary arbiter.

Privacy/doxxing content can be restricted first and verified afterwards; this also triggers [privacy and data deletion](PRIVACY_AND_DATA_DELETION.md). Government/law enforcement requests go to a designated owner who verifies legality, scope, and urgency, follows minimum disclosure, and keeps a restricted audit.

## 10. Target data model and permissions

Course v1 already has `learning_course_reports` (either publication or share, category/description/status) and `learning_course_moderation_actions` (publication, actor, hide/restore/withdraw, reason/time), with publication status handling visibility. Production 0039 also adds the service-only `point_moderation_actions` and `point_abuse_signals`; service-role only has read access to these append-only tables, moderation transitions can only run through SECURITY DEFINER workflows, and ordinary clients can neither read nor write them. There is currently only an admin API, no moderation UI. The rest of the site-wide target model still includes:

- `content_reports`: reported object, category, description, reporter (nullable), status, priority;
- `moderation_cases`: aggregated reports, policy version, owner, severity, status/SLA;
- `moderation_evidence`: restricted snapshots/hashes, source, expiry time;
- `moderation_actions`: action, scope, reasoning, execution/expiry, executor, reversal links;
- `moderation_appeals`: appeal text, independent reviewer, decision;
- `user_restrictions`: fine-grained restrictions on posting/uploading/trading/payouts/accounts;
- `trusted_flags`/detection events: model/rule version, score, never treated as the final decision;
- `legal_requests`: isolated from ordinary moderation and strictly authorized.

Ordinary users can only create reports and see limited status of their own reports; they cannot see moderation evidence, reporters, or internal rules. Moderation roles have least privilege and strong MFA, and every view/export/action is audited; service-role must never be exposed directly to a back-office browser.

## 11. Launch gates and metrics

Before the community/Note Market expands, the full checklist must be in place. The minimum gate for the Course Market private beta is: a report entry point, publish/report rate limits, a separate feature flag, verified administrators and alert recipients, audited actions, emergency hiding, no file/HTML execution, and free clones/no redistribution; before widening public scope, a queue, strong roles, author notification/appeals, policy versions, and handling SLAs must still be added. The production points moderation boundary has verified that ordinary users and direct service-role table writes are rejected, the admin allowlist rejects non-admins, suppress/restore keeps the ledger projection consistent, and the scan only produces pending signals with no automatic penalties.

Weekly metrics: reports per thousand active users, response/resolution time per level, confirmed violation rate, recidivism rate, appeal rate and overturn rate, sampled precision/recall of automatic detection, minor/privacy/copyright categories, the number of orphan attachments, and moderators' exposure to sensitive content. "Deleting more" must never be the only success metric.

## 12. Related documents

- [Security policy](../../SECURITY.md)
- [Privacy and data deletion](PRIVACY_AND_DATA_DELETION.md)
- [AI evaluation and cost governance](../ai/EVALUATION_AND_COST.md)
- [Points/credits/VIP/payment rules](../product/POINTS_CREDITS_VIP_PAYMENTS.md)
