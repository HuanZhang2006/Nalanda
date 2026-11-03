# ADR-0005: Separate points, credits, VIP, fiat payments, and creator payables

> **About this document**
> - **Contents**: Records the decision that five concepts in Nalanda's economy must be kept in separate ledgers.
> - **Purpose**: Removes the mixing of "points/credits/earnings" in the old blueprint and prototype, and establishes unbreakable boundaries for implementing wallets, subscriptions, refunds, and revenue share.
> - **When to update**: When redemption, pricing, VIP entitlements, payment methods, refunds, revenue share, or creator settlement policies change; material changes require a new ADR.
> - **Implementation note**: The decision is accepted; points now have a protected event ledger, but credits/VIP/payments/creator payables still have no commercial ledger, so real transactions must not be enabled.

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** Project maintainer
- **Scope:** Growth, AI consumption, market, subscriptions, Stripe, creator settlement
- **Specification:** [POINTS_CREDITS_VIP_PAYMENTS.md](../product/POINTS_CREDITS_VIP_PAYMENTS.md)

## Context

The existing profile holds `points`, `credits`, level, and `vip_until` together; the prototype uses credits for AI and the note market and shows creators earning credits; the architecture blueprint also proposes Stripe top-ups, VIP, and Connect payouts. Reusing one mutable balance would let behavior rewards gain cash value, make refunds/disputes impossible to reverse precisely, and allow VIP to be forged by the client.

## Decision

- **Points** are non-transferable, non-purchasable, non-withdrawable growth reputation with no cash value; they only drive levels/badges and must never convert into credits or VIP.
- **Credits** are the platform's closed-loop spending unit for AI and digital content; balances must be derived from an immutable credit ledger/lots, and ordinary clients cannot write them.
- **VIP** is a time-bound entitlement derived from trusted subscription/order state; it is not a balance, does not change data permissions or moderation rules, and does not automatically include third-party market content.
- **Fiat payments** use orders, Payments, and Stripe webhooks as the chain of record; internal credits are not Stripe amount records.
- **Creator payables** use a separate payable ledger, settle in the smallest currency unit, and pay out through Stripe Connect; the market UI may price in credits, but withdrawable earnings must never be mixed into the ordinary credits wallet.
- Every change needs a business idempotency key, immutable records, and reversals; directly updating profile numbers as the completion state is forbidden.

## Options considered

- **Merge points and credits:** Simple experience, but turns farmable behavior into economic value; not safely acceptable.
- **Creators receive withdrawable credits directly:** Simple UI, but mixes consumer stored value with platform payables, with high refund, compliance, and reconciliation risk.
- **Pay for everything directly in fiat:** Straightforward accounting, but does not match the chosen AI/note credits experience, and microtransaction fees are high.

## Consequences

Boundaries are clear, reconcilable, and reversible; the cost is multiple ledgers, lot allocation, order state machines, and clear UI copy. Any request such as "let gifted points offset cash", "VIP sees all creator content", or "compensate by editing the profile balance" must first change the rules and the ADR.

## Gap between current implementation and target

- **Current:** 0008 protects Profile server fields and creates `point_entries`, stable business keys, net idempotency, and reversals for posts/reposts/comments/likes/tasks; `credits` and `vip_until` are still read-only caches, and payments are still fake data. Production 0041–0043 Materials AI only uses daily Free runs and explicitly never reads or consumes credits.
- **Current risks:** Historical openings were zeroed by reversals appended in production 0009; production 0039 enabled daily caps, manual-review reversals, and pending-review-only coordination detection, but the thresholds are not content-quality judgements or automatic penalties. Credits/VIP still have no ledger, orders, webhooks, or settlement.
- **Target:** Release and observe points anti-abuse under protection, complete moderation/appeals, then implement order/credits/subscription/payable ledgers, and only then enable Stripe and the commercial UI; no phase may connect fake balances to real payments.

## Verification and review

Property tests should prove ledger conservation, no side effects from duplicate events, refunds via reversals, points never entering the economic ledger, consistent VIP expiry, and daily reconciliation between Stripe and internal orders. Tax, stored value, payouts, or target-market changes require legal/finance review.
