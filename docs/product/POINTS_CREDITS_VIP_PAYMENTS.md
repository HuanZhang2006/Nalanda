# Points / Credits / VIP / Payments Unified Product Rules

> **About this document**
> - **Contents**: Defines points, credits, VIP, fiat orders, refunds, market purchases, and creator revenue share in one place, and specifies the ledger, idempotency, Stripe, and UI boundaries.
> - **Purpose**: The specification for product, API, database, testing, support, and finance when implementing economic features; when the old prototype or blueprint conflicts with this document, this document is the target rule, and changes are managed through ADRs.
> - **When to update**: When rewards, levels, credits acquisition/spending, exchange rates/packages, VIP entitlements, the Stripe flow, refunds/disputes, revenue share/payouts, taxes, or target markets change; review immediately after any money incident.
> - **Status baseline**: 2026-08-11. Production has verified 0008–0043; the course +20, nine badge tiers, server-authoritative learning facts, and points v2's frozen calendar-day reward decisions, daily count caps, owner receipts, manual suppress/restore, and flag-only coordination detection are all live. Course Market v1 still only offers free clones, Materials AI only uses the two Free allowances, and neither touches credits/payments; commercial ledgers, Stripe, VIP, and creator settlement are still not implemented.

## 1. Normative terms and overall principles

MUST, MUST NOT, SHOULD, and MAY in this document have their normative meanings.

The five domains are always separate:

| Concept | What users see | Purchasable | Spendable | Transferable/withdrawable | Source of truth |
|---|---|---:|---:|---:|---|
| **Points** | Activity points, levels, badges | No | No (no discounts) | No | points event ledger |
| **Credits** | Balance for AI/market spending | Yes, and may be gifted in promotions | Yes | Not transferable between users; ordinary balances are not withdrawable | credit lots + entries + holds |
| **VIP** | Time-limited membership entitlements | Yes | N/A | No | subscription/entitlement ledger |
| **Fiat payment** | Real-currency orders/refunds | Paid by the user | Buys credits/VIP/official products | Refunds go back via the original payment method | Order/Payment + Stripe |
| **Creator payable** | Creator amounts pending settlement/withdrawable | Not a user-purchased balance | Not spendable as credits | Withdrawn through compliant Stripe Connect | Separate payable ledger |

Unbreakable principles: points ≠ credits; credits ≠ cash; VIP ≠ site-wide authorization; creator payable ≠ credits; profile display cache ≠ ledger. Balances/levels/entitlements may be cached on the profile for reading, but the cache must be rebuilt from the ledger and ordinary clients must not write it.

## 2. Current implementation and immediate limits

### 2.1 Currently verifiable facts

- `profiles` has `credits`, `vip_until`, and `level`; migrations 0006/0007 added `points` and `streak`; migration 0008 turned points into a read-only projection of `point_entries`.
- Current production points rewards: like +1, comment +2, ordinary post +10, repost +3, task completed +5, first mastery of a qualifying English word-list course +20; level thresholds are still 0/50/150/350/700/1200.
- All five reward types currently activate/reverse through `point_event_states` and append-style `point_entries`; rebuilding after deleting/un-completing with the same durable business key only restores the original net amount and no longer accumulates.
- Authenticated users can only update the profile allowlist and a valid IANA `timezone`; economy/level/VIP/streak are protected. Courses rewards/badges/progress cannot be written or RPC-called by clients either.
- 0008 saved the pre-migration `profiles.points` as `legacy_opening`; the 2026-07-21 aggregate audit confirmed the only Profile had 11 points, credits/streak of 0, and no VIP, and the owner decided to zero the points. 0009 appended an equal `legacy_opening_reset=-11` in production without deleting `legacy_opening=+11` and without treating it as trustworthy per-entry history; 0010 verified that every opening has exactly one equal reversal and that Profile points/level match the ledger projection.
- The balances, prices, 25 credits, 70% revenue share, and VIP redemption in Create, Market, and Home are currently mock data/prototype interactions.
- Apart from points, there are no tables/services for orders, Payments, a credit ledger, holds, market purchases, subscriptions, refunds, webhooks, creator earnings, or payouts.
- Course Market's publication/clone/report tables are not a commercial market ledger; cards only show "Free" and produce no purchases, sales revenue share, credits debits, or creator payables.
- Production 0039 adds `point_daily_windows/point_daily_award_claims/point_moderation_actions/point_abuse_signals` and extends the event state; internal tables are not open to PostgREST writes, and even service-role can only change facts through controlled SECURITY DEFINER workflows. Ordinary users can only read their own single reward decision through the owner-only receipt.
- Production 0041–0043 Materials AI never reads, freezes, or consumes `profiles.credits`: every user is Free by default, with 10 **successful** test-paper generations and 10 **successful** subjective gradings per local day in the Profile IANA time zone. The reservation is consumed on success and released on injection rejection/format errors/cancellation/resource/model/ZDR/bad JSON/system failures; AI test papers and exams award no points, badges, or VIP.
- In the 0046–0051 candidate, the knowledge graph, node Q&A, and the Luna/old pipelines share the same `generation` Free daily allowance; the pipeline choice doesn't change the price. Each successful artifact/answer consumes 1 run, and resuming the same job within the window adds no new reservation. Deleting while queued releases; Delete and compatible Cancel after the worker has accepted consume one run, preventing users from evading external cost by interrupting; clearing history does not roll back the allowance. They award no points/badges and never read credits; before a protected release, these are only candidate rules, not a live commitment.

### 2.2 Release limits

The P0s on the Profile/RPC/current points redo paths were closed and verified by production migrations 0008–0010. Daily caps, moderation reversals, and coordination detection were enabled by production 0039–0040, leaving only the 24-hour observation/contract for the compatibility timestamp columns; credits/VIP/payment ledgers and commercial tests are still not implemented. Therefore:

- Do not connect live Stripe keys or accept real payments;
- Do not treat `profiles.credits` as a spendable balance;
- Do not show or open paid entitlements based on `vip_until`;
- Do not allow creators to withdraw or show a "withdrawable" amount;
- Do not do support compensation by calling `_add_points` from a client/editing the profile;
- Prices/balances in the prototype must be labeled demo, or removed before a commercial entry point launches.
- Note Market stays labeled Demo; Course Market can only clone for free. Any change that adds credits/fiat, sales, or revenue share to courses must first go through this document's commercial phases and a new ADR.
- The "Free Plan" AI quota card on Profile is not a wallet and does not mean owning 20 credits; the quota does not roll over and cannot be transferred, purchased, or redeemed. Selling credits is not enabled yet.

## 3. Points: growth reputation rules

### 3.1 Nature

Points only measure rule-compliant learning/community activity on the platform and have no monetary or stored value; they cannot be purchased, gifted, transferred, sold, withdrawn, inherited, or redeemed for credits/VIP/courses/products. Leaderboards and badges must not change RLS, moderation, refunds, recommendation appeals, or support priority.

### 3.2 Reward events and initial values

To keep the current experience, migration 0008 kept the following values and connected them to the event ledger. Business keys are generated by the database and cannot be rewritten by clients; production 0039 enforces the daily "number of reward-earning events" caps in the table below, and course completion rewards are not subject to daily caps:

| Event | Points | Business event ID | Reversal rule | Initial anti-abuse cap |
|---|---:|---|---|---|
| Publish an original post | +10 | `post:{owner}:{normalized-content-sha256}` | -10 when the last same-key post is deleted; rebuilding only restores the net amount | 3 posts scored per day |
| Repost | +3 | `repost:{actor}:{root-post-business-key}` | -3 when the last same-key repost is deleted; rebuilding only restores the net amount | 10 scored per day |
| Post a valid comment | +2 | `comment:{target-post-business-key}:{actor}` | One valid reward claim per actor/target content; -2 once all are deleted | 10 scored per day |
| First like | +1 | `like:{target-post-business-key}:{actor}` | One valid reward claim per actor/target content; -1 after unliking | 20 distinct posts scored per day |
| First task completion | +5 | `task:{owner}:{normalized-task-sha256}:completed:v1` | -5 when the last same-key task is un-completed/deleted; redoing only restores the net amount | 10 tasks scored per day |
| First mastery of a qualifying word list | +20 | `learning-course-completed:{user}:{sha256(sorted distinct normalized terms)}` | A historical achievement not reversed by deleting the course; rebuilding/cloning the same word set never rewards again | Once permanently per user/distinct word set; at least 20 distinct words |

Self-likes, self-comments, self-follows, and duplicate relationships to the same content are still handled by the existing business rules. Coordination detection only produces pending signals and cannot automatically deny or reverse rewards without a manual `suppress`. Reaching a cap never blocks posting, reposting, commenting, liking, or completing tasks; it only permanently records that stable business key's first reward decision as 0, and deleting, un-completing, changing time zones, or rebuilding cannot claim it later. The Web app reads the receipt after the business write succeeds and shows a notice, and a receipt failure must never roll back a successful business operation.

If operations adjust values/caps, only new events are affected and history is never rewritten; large-scale recalculation must create batches with activity/rule versions and reversible records.

### 3.3 Frozen daily windows, receipts, and moderation

- `point_daily_windows` freezes the user's valid IANA time zone at that moment, the local date, and the corresponding UTC start/end on the first capped reward. Changing the Profile time zone before the current window ends does not open a second window early; the next window after midnight is recomputed by the database.
- `point_daily_award_claims` stores, per stable business key, the rule version, nominal amount, actual amount, cap, owner/root, and a unique decision. Business keys existing before the migration are fixed as `grandfather-v1` and not retroactively subjected to the new caps; the actual amount only trusts that business key's first positive transition. Old facts that 0008 only had as active placeholders, with no per-business positive entry and already zeroed by 0009, are permanently fixed at 0, and deletion, rebuilding, or moderation must not create negative points or re-award. If an old placeholder was un-completed before 0039 and left a negative balance with no positive source, 0039 does not change the old entries but appends an equal `grandfather-zero-reset-v1` compensation and re-projects the Profile, so its net amount auditably returns to 0.
- `get_point_reward_receipt(eventType,sourceId)` derives the owner only from `auth.uid()` and returns the actual amount, the day's used count/cap, the local date, and the `daily_cap/moderation` reason. The first time a type goes over the cap each day, the database writes one persistent notification; repeated reads don't duplicate it.
- `suppress/restore` may only be run by administrators in the configured allowlist through the NestJS API, and must carry a reason and an optional case reference. Suppressing an original post handles the original, reposts, comments, and like rewards anchored to the same root; it only withdraws amounts actually received historically, creates no extra negative points, and deleted content is not reversed twice. Restore only restores facts that actually earned rewards and still exist, and does not re-issue rewards whose daily-cap decision was 0. Moderation uses an exclusive gate and locks the related Profiles in UUID order before locking state; ordinary rewards use a shared gate, preventing the two transaction paths from deadlocking on Profile/state rows in opposite orders. Repeated suppress/restore still appends a zero-change audit and cannot pretend the target doesn't exist.
- `point_moderation_actions` is append-only; signal reviews and reward moderation are both written through controlled database functions. Direct client calls, client/anonymous reads of internal tables, and direct service-role INSERT/UPDATE/DELETE must all fail.

### 3.4 Coordination detection is not automatic punishment

The production scanner runs every five minutes, using a Redis distributed lock to ensure a single instance, and detects four kinds of leads: a single actor toward a single owner with ≥8 in 24 hours and concentration ≥70%; a pair with ≥12 combined and ≥4 in each direction; 3–8 accounts with ≥30 internal interactions within seven days and concentration ≥70%; and at least 8 accounts registered less than seven days ago concentrating on the same root/owner within ten minutes. Signals are deduplicated by type, sorted account set, and aligned window, and can only be in the `pending`, `reviewing`, `dismissed`, or `escalated` review states.

Hitting a threshold never automatically deducts points, freezes, hides, bans, or changes later rewards. Moderators should judge manually with the content, relationships, and possible false positives; after confirming a signal, any reversal still requires a separately submitted moderation action with a reason. The first version has no admin UI and no webhook/pager, only a controlled admin API, database auditing, and redacted structured logs.

A course reward's "100%" only looks at the server-side `learning_word_progress.learned_at`, not the completion of the initial four stages. That field is derived only from the dual-exam facts, and the related facts are:

1. **Review facts no longer create mastery:** pronunciation, translation, and spelling answered correctly in the end in completed review sessions on different local dates still record the three deduplicated date groups and `review_count`, but no matter how many dates there are, they never write exam facts or `learned_at`.
2. **Mastery requires both exams:** when a full spelling exam's first round reaches the threshold and all retry rounds are completed, `spelling_exam_passed_at` is written for the selected words; a full pronunciation exam writes `pronunciation_exam_passed_at` under the same conditions. Only when both fields exist is `learned_at` projected. 0031 allows selecting a unit subset; when either exam is below the threshold, even if every wrong answer has been corrected and the exam ends automatically, only `practiceCompleted` is written — the failure is not reversed and that exam's fact is not written. Neither exam fakes review dates. This rule was enabled in production with 0029–0034 on 2026-08-03.

Both exam facts and the `learned_at` projection can only be produced by service-role database transactions/triggers. Production 0035–0036 force `learned_at` to equal exactly the later of the two exam times, and a missing fact or a direct write of an arbitrary value is projected back to the correct result. See the [Courses English vocabulary learning notes](../notes/11-learning-courses.md) for detailed conditions, the edit reset matrix, and a layer-by-layer code index. A course must also have at least 20 distinct normalized English words/phrases, all with non-null `learned_at`, before the server calls the existing points state machine inside `_refresh_learning_growth` with the word-set fingerprint and writes `points_claimed_at`; the same user/word set is rewarded only once ever, and clients cannot self-report completion.

In the weak-network flow, frontend correctness, the cursor, and "pending sync" are only provisional UI. Each answer is idempotent by `(user_id,session_id,attempt_id)`, and the server rejects revision conflicts; growth facts can only be shown or awarded after the server transaction confirms the attempt, stage completion, progress, badges, and course fingerprint. Offline predicted completion, timeout retries, repeated replays, Cache Storage hits, and audio generation can never directly produce points, badges, credits, or VIP.

### 3.5 Courses badges (not economic entitlements)

Badges are a historical growth display; they cannot be purchased, spent, transferred, redeemed, or withdrawn, and grant no VIP/market/moderation privileges. Thresholds:

| Family | Bronze / Silver / Gold | Counting semantics |
|---|---|---|
| Vocabulary Voyager `vocab_words` | 20 / 200 / 1000 | Normalized, deduplicated English words/phrases with non-null `learned_at` across all private courses |
| Course Graduate `vocab_courses` | 1 / 5 / 20 | English word-list courses with at least 20 distinct words, all mastered |
| Review Keeper `vocab_review_days` | 3 / 15 / 50 | Distinct attempt `local_date`s of completed review sessions |

`(user_id,badge_code)` is unique and awards are append-only; deleting a course or later edits that lower the stats neither revoke nor re-award the same badge. Deleting the whole Auth account cascades the user's awards per the privacy process. Profile only shows aggregates/medals and cannot modify the facts. The badge names and descriptions are seeded in the database in Chinese; the Web client renders them by family and threshold in the current UI language.

### 3.6 Ledger and levels

`point_entries` contains at least `id,user_id,event_type,business_key,amount,rule_version,source_id,reversal_of,created_at,metadata`. `business_key` + effective direction has a unique constraint; amounts are signed integers; UPDATE/DELETE of recorded entries is forbidden, and corrections add reversals.

Levels are derived from the total of valid points:

| Level | Name | Minimum points |
|---:|---|---:|
| 1 | Novice | 0 |
| 2 | Learner | 50 |
| 3 | Scholar | 150 |
| 4 | Mentor | 350 |
| 5 | Sage | 700 |
| 6 | Luminary | 1200 |

A level can drop when reversals push the total below a threshold; if badges are historical achievements, the badge rules must state explicitly whether they are "kept" or "expire with the level", rather than letting the UI guess. The points balance must not go below 0; if a reversal exceeds the balance, record the full negative event but display/level with `max(0,sum)`, and raise an audit alert to investigate the anomaly.

## 4. Credits: a closed-loop spending balance

### 4.1 Nature and display

Credits are used for AI generation and note-market digital content within Nalanda. They are not bank deposits, fiat, crypto assets, or a peer-to-peer payment tool; ordinary wallet credits cannot be sold, gifted, transferred, or withdrawn. Statutory consumer rights and refund obligations take precedence over the "not withdrawable" product rule.

Internally only integer credits are used, never displayed with decimals. The target base pricing reference is **1 USD = 10 credits** (the standard reference value of 1 credit is USD 0.10, before tax); this is used for product quotes and creator payable snapshots and is not a buy-back promise. Each region's top-up packages store the actual `amount_minor/currency/credits/tax` per currency, and historical orders always use the snapshot at order time, never back-calculated with the current exchange rate.

### 4.2 Credit lots

Each acquisition of credits creates a lot:

- **purchased:** issued by a verified webhook after a Stripe payment; does not expire proactively by default, unless law/regional terms require something stricter;
- **promotional:** promotion gifts, which may have an explicit expiry; the expiry is shown before the user receives them;
- **service_recovery:** support compensation for failures, with no short expiry by default; must be linked to a case and approval;
- **refund_credit:** credits returned by a digital-content refund, inheriting the source/expiry attributes of the originally consumed lot, and never usable to launder value into something withdrawable.

Spending order: earliest-expiring promotional → other promotional → earliest-created purchased/service recovery; exact allocations are recorded in `credit_allocations`. The balance is unexpired lot credits minus committed allocations; holds affect available, not the settled balance.

### 4.3 AI billing

This section is a future charging rule. The production 0041–0043 Materials AI beta only uses the free daily allowance and the operator's global USD budget; it creates no credit hold/commit/release tables and never deducts user balances because model costs change.

Before the user confirms, AI requests show the credits price/estimate, the artifacts, the material, and the adjustable factors. The request flow must be:

1. The client submits an idempotency key; the API validates material ownership, quota, and the price version;
2. Create the job and the credit hold in a single transaction and return a stable job ID;
3. On success, and only after the result passes the schema/quality gates, commit the actual price;
4. Release the full hold on user-available cancellation, validation failure, service errors, or timeouts;
5. If the product allows range estimates, the actual charge must not exceed the user-confirmed ceiling; above it, the user must confirm again, and below it only the actual value is committed;
6. Retries with the same idempotency key/business job must never hold, charge, or produce multiple charged results more than once.

Model provider token cost is separate from the user's credits price: the product price covers parsing, models, storage, failure rates, and operations, and the user's confirmed price is never altered after the fact because of the provider's bill. VIP may provide monthly included credits/discounts, but these should create clear lots/price adjustments rather than bypass the ledger.

### 4.4 Market purchases

This section only applies to the future Note Market/paid digital content and **does not apply to Course Market v1**. Course Market publications are always priced "Free", and cloning only creates independent private content/zero progress, with no credit hold/debit, purchase/license, creator earning, sales revenue share, order, or payment facts; cloned courses keep source attribution and cannot be shared/listed again. If courses ever charge, separate version licensing/refunds/copyright/revenue share must be designed, and clone_count must never be treated as a sales ledger.

Market items are priced in integer credits. The published version, preview, license scope, AI labeling, author, and content hash are snapshotted at purchase. A purchase must, within a database transaction: lock/validate the listing → check buyer vs. author/duplicate purchase → hold/commit credits → create a unique purchase/license → create a pending creator payable → return the user's library reference.

The unique key includes at least `(buyer_id, listing_id, listing_version or license semantics)`; double clicks/network retries can only return the original purchase. Authors are forbidden from buying their own items to create sales/revenue share. Whether an item update requires re-purchase is decided by the listing's version policy, and purchased content must never silently disappear.

## 5. VIP: a subscription entitlement, not a balance

### 5.1 Source of truth and states

VIP is derived from `subscriptions`/`entitlements` and the Stripe subscription/invoice state, and never takes a client-written `profiles.vip_until` as the source of truth. Suggested states: `incomplete → trialing/active → past_due → paused/canceled → expired`; out-of-order webhooks are handled by the Stripe object version/event time and the state machine, not simply "last received wins".

`vip_until` MAY be a read-only cache rebuilt by the server; clients can only read it. Cancellation takes effect at the end of the paid period by default; the grace period after payment failure, pausing, and resuming must have explicit configuration and user copy.

### 5.2 Entitlement boundaries

The first version may choose from the following candidates and lock them in a plan version: monthly included AI credits, higher non-paid rate/concurrency limits, AI credits discounts, premium export/themes, and official Nalanda content entitlements. Each entitlement must specify its quantity, reset time zone, rollover, downgrade, and refund behavior.

VIP never: changes data ownership/RLS; exempts from content moderation/anti-abuse; automatically grants third-party creators' paid market notes; allows unlimited-cost AI; turns points into credits; guarantees AI correctness; or prioritizes statutory rights handling. The old prototype's "redeem VIP with points/credits" is not part of the first version's rules unless it passes a new economic/legal review and ADR.

## 6. Stripe and the order state machine

### 6.1 Boundaries

Stripe handles real payments, subscriptions, and Connect payouts. The browser may only use the publishable key/Checkout Session; the secret key, webhook secret, and Connect control live in NestJS/controlled workers. Nalanda never stores full card numbers/CVC.

### 6.2 Placing an order

The API creates `orders` from the server-side price catalog, ignoring any client-sent amount, credits quantity, discount, or user ID. The order records the type, user, currency, amount_minor, tax, product/plan/price version, credits/entitlements, status, idempotency key, and Stripe ID.

Suggested states:

```text
draft -> pending_payment -> paid -> fulfilled
                        \-> failed / expired
fulfilled -> partially_refunded / refunded / disputed
```

`paid` only means a trusted payment event, and `fulfilled` means internal credits/entitlements have been issued idempotently. Keeping them separate makes compensation and retries auditable.

### 6.3 Webhooks

Webhooks must: verify the signature over the raw body; check live/test mode and the account; persist `event.id` under a unique constraint before processing; return quickly and retry asynchronously; tolerate duplicates/reordering/delays; have an explicit state transition per event type; and safely record unknown events without granting entitlements. Success redirects or client polling must never serve as proof of payment.

Coverage is needed for Checkout completed/expired, PaymentIntent succeeded/failed, invoice paid/payment_failed, subscription created/updated/deleted, charge/refund/dispute, and Connect account/payout events. The actual list is pinned to the Stripe API version and written into the API docs.

## 7. Refunds, reversals, and disputes

### 7.1 General rules

Statutory rights take precedence. Every refund creates a `refund` and ledger reversals referencing the original order/payment/lot/purchase/earning; history must never be hidden with UPDATE/DELETE. Amounts, tax, credits, entitlements, creator payables, and platform revenue must be reconciled within the same business case.

### 7.2 Credits top-ups

- Duplicate/erroneous charges: once confirmed, refund via the original method and revoke the corresponding unused credits.
- User-initiated refunds: by default, a full-order refund is supported within 7 days of purchase if the corresponding purchased lot is completely unused; where applicable law is broader, follow it.
- Partially/fully used: no automatic promise of a cash refund; if law or a failure requires a refund, reverse downstream entitlements per the original lot allocation, allowing the wallet to go temporarily negative while freezing new spending, and never faking a zero balance to wipe the books.
- Stripe disputes/chargebacks: mark the order disputed, freeze the related purchased lot and any necessary payouts, and reverse after investigation; never automatically ban all account data because of a dispute.

### 7.3 AI jobs

Platform errors, timeouts, successful cancellation, and bad schema/quality-gate failures: release/return all credits. When results were delivered successfully but the user is subjectively dissatisfied, judge by the published quality commitment and a support case; if the content is substantially empty, unrelated to the material, or charged twice, refund and keep a de-identified event for the evaluation sample (without keeping the original material unless separately consented).

### 7.4 Market notes

Duplicate purchases are merged automatically and the duplicate charge returned. When content is inaccessible, substantially differs from its description, or is taken down for infringement/moderation, credits are returned by default within 7 days of purchase; statutory requirements or platform fault can override the window. The refund also revokes/restricts the license and creates reverse records against the creator's pending/available earnings; negative amounts for already paid-out earnings go into deductions from future creator payables/the risk process, never tampering with historical payouts.

### 7.5 VIP

Cancellation stops renewal at the end of the period by default, and the paid period stays usable. Duplicate charges, unauthorized payments, long service outages, or statutory refunds are handled by unused proportion/law, with included credits/entitlements adjusted to match. Merely cancelling does not automatically refund the current period, which must be shown clearly before purchase.

## 8. Creator revenue share and Stripe Connect

### 8.1 Revenue share baseline

The first version's default creator share is **70% (7000 bps)** and the platform share 30%, with a `share_bps` snapshot saved at purchase. The revenue share base is the listing credits converted at the purchase-time `settlement_rate_snapshot` into the pre-tax standard content value, minus refunds/allowances; who bears payment processing costs and taxes must be explicit in the seller terms/regional pricing and can never be changed secretly for old orders.

Example (illustrating the algorithm only): 100 credits with a snapshot of 1 credit = USD 0.10 gives a standard content value of USD 10.00; the creator payable is `floor(1000 cents × 7000 / 10000) = 700 cents`. Currency conversion and rounding happen in the smallest currency unit, and the remainder goes to the platform rounding account. For purchases with promotional credits, the platform funds the creator per the promotion rules and by default does not reduce the creator's displayed share.

### 8.2 Payable states

`pending` (after purchase) → 14-day risk/refund hold → `available` → `payout_pending` → `paid`; refunds/moderation/disputes can move to `reversed` or create negative adjustments for already paid items. Only creators who pass identity/KYC, tax, regional eligibility, content moderation, and the minimum payout threshold may initiate Connect payouts.

The ordinary credits wallet never directly becomes a withdrawable balance. The UI may show "market price: credits" alongside "estimated creator earnings: currency", but must label estimates, holds, taxes, and the final settlement status.

### 8.3 Refunds and takedowns

A refund before available first reverses pending; when available but not paid, it reduces available; after payout it creates a negative payable, offset against future earnings or recovered per the seller agreement. Moderation takedowns do not automatically confiscate legitimate, unrelated earnings; only amounts tied to the violation/fraudulent purchase are frozen, with reasons and appeals provided.

## 9. Target data model and ledger invariants

### 9.1 Minimal entities

- `point_entries`, `point_rule_versions`;
- `credit_accounts`, `credit_lots`, `credit_entries`, `credit_holds`, `credit_allocations`;
- `orders`, `payments`, `refunds`, `stripe_events`;
- `subscriptions`, `entitlements`, `plan_versions`;
- `market_listings`, `market_purchases`/licenses;
- `creator_accounts`, `creator_earnings`, `payouts`, `adjustments`;
- `economic_audit_events`, storing only necessary metadata and never copying secrets/card information.

### 9.2 Invariants

1. Every external/business event has a globally or domain-unique idempotency key.
2. Recorded entries are never updated/deleted; corrections go through `reversal_of`/adjustments.
3. settled credits = valid lot credits − committed allocations; available = settled − active holds.
4. Each hold is committed or released exactly once; expired holds are reclaimed safely by a worker.
5. Each Stripe event produces exactly one state transition/fulfillment, even when it arrives duplicated or out of order.
6. Each market purchase's credits debit, license, and creator earning are atomically consistent; any failure rolls all of them back.
7. Points entries never enter the credit/creator ledgers.
8. VIP entitlements are not decided by client-side profile fields.
9. Creator earnings and payouts are traceable entry by entry in currency, amount, exchange rate, and revenue-share version.
10. Administrators/support cannot change balances directly; adjustments need a case, reason, approval, idempotency key, and a record reversible in the opposite direction.

## 10. Idempotency, concurrency, and failure semantics

For every create/spend request, the client generates a stable `Idempotency-Key`; the server binds the key to the user, operation, normalized payload hash, and result. The same key with a different payload returns a conflict and cannot be reused. The database's unique constraints and transactions are the last line of defense; Redis locks alone are never enough.

Concurrent spending uses row locks or provably atomic updates on accounts/lots, and negative available is forbidden. When the third party succeeds but internal fulfillment fails, the order stays at `paid` and fulfillment is retried; the user is never charged again. When internal processing succeeds but the response is lost, retries return the same resource. Dead letters and manual fixes only issue compensating events.

## 11. Reconciliation, monitoring, and permissions

- Reconcile Stripe balance transactions ↔ Payment/Refund/Payout ↔ Order/ledger daily; the difference is 0 or has a case with an owner/deadline.
- Check hourly for stuck pending/paid-not-fulfilled, expired holds, negative balances, duplicate business keys, ledger/cached balance differences, webhook delays/failures, and payout anomalies.
- Use two-person approval for large adjustments, refunds, and payouts; thresholds are set in controlled configuration and never hard-coded in the frontend.
- RLS lets users read only their own statements; all writes go through restricted NestJS/worker roles. The operations back office never holds a browser service-role.
- Logs contain no card information, secrets, full webhook bodies, or user courseware; event IDs/order IDs are enough for correlation.

## 12. UI and support copy

The interface must always use distinct names and icons for `Points`, `Credits`, `VIP`, and `Creator earnings`, and the Chinese interface must likewise use distinct terms for points and credits. Never use one generic word for both points and credits. Purchase pages show the currency/total including tax, the credits received, a refund summary, and the package version; spending pages show the credits required/available; the VIP page states clearly that market content is not included; and the creator page distinguishes pending/available/paid.

Support compensation goes through a service recovery lot or a ledger adjustment, never asking users to refresh or edit their profile; replies to users include the order/case ID, the affected entries, and the expected arrival time, without exposing internal risk controls.

## 13. Phased development path and release gates

### Phase 0: close current risks

- [x] Column-level ban on clients changing credits, points, level, VIP, and streak;
- [x] Revoke default client execute on the points/notification definers and retire `_add_points`;
- [x] Build the current points event ledger, stable business keys, net idempotency/reversals, and empty-database plus 0007→0010 upgrade/release assertion tests;
- [x] Audit opening points/credits/VIP/streak during the old vulnerability, and record the 2026-07-21 decision to zero points and 0009's append-only reversal;
- [ ] Tighten server fields still exposed by owner whole-row policies, such as feedback `status`;
- [x] Keep prototype commercial entry points demo/behind feature flags, with no real payments connected.
- [x] Isolate Course Market v1 from the commercial domain: free clones only, never reading or writing credits/orders/payables; cloned courses cannot be redistributed.
- [x] Courses +20 uses a permanent SHA-256 key of the user + sorted, deduplicated word set, and badges are unique per user + code; 0011–0013 were released to production on 2026-07-22.
- [x] 0015–0016 were proven by real local Supabase E2E — a repeated `attemptId` lands only once, revision conflicts do not advance, and offline completion waits for server confirmation without duplicate rewards — and completed a protected production release on 2026-07-27.

### Phase 1: ledgers without real payments

- Implement credit account/lot/entry/hold, a test catalog, and AI/market transaction fixtures;
- Property/concurrency tests verify the invariants; balances can be rebuilt from the ledger;
- Only administrator test grants, still no live Stripe.

### Phase 2: Stripe test mode

- Full Order/Payment/Webhook/Refund/Subscription state machines;
- Fixed Stripe CLI fixtures covering duplicates, reordering, failures, refunds, and disputes;
- Daily reconciliation, alerts, secret rotation, and database recovery drills pass.

### Phase 3: restricted live credits/VIP

- Complete legal/tax/terms/privacy reviews for the target regions;
- Low traffic, amount limits, human on-call, and a kill switch;
- Expand only after at least one full billing period reconciles with no unexplained differences.

### Phase 4: market and creator payouts

- Content moderation/copyright/appeals, seller onboarding, KYC/tax, the 14-day hold, refund reversals, Connect payouts, and financial reconciliation all pass;
- The first payouts get two-person approval and per-item verification;
- Until then, only non-withdrawable demo sales may be shown.

## 14. Change control

The following changes need product + engineering + security + finance/legal (where applicable) approval and a new/superseding ADR: points becoming redeemable; credits becoming transferable/withdrawable; changing the 1 USD = 10 credits baseline; VIP including third-party market content; changing the 70% revenue share; materially changing hold/refund windows; adding currencies/regions/payment methods; allowing continued spending with a negative balance; merging creator payables into the wallet.

Every rule change uses versioned configuration and only affects a clearly defined range of orders/events; history is never silently recalculated.

## 15. Related documents

- [ADR-0005: Economy domain separation](../adr/0005-economy-domain-separation.md)
- [Security policy](../../SECURITY.md)
- [Privacy and data deletion](../governance/PRIVACY_AND_DATA_DELETION.md)
- [Content moderation](../governance/CONTENT_MODERATION.md)
- [AI evaluation and cost governance](../ai/EVALUATION_AND_COST.md)
