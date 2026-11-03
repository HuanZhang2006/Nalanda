# Architecture Decision Records (ADR) Index

> **About this document**
> - **Contents**: Lists Nalanda's architecture decision records, their status, numbering conventions, and maintenance process.
> - **Purpose**: Preserves the context of "why we chose this", so later development can tell accepted decisions apart from proposals awaiting validation and superseded options.
> - **When to update**: When an ADR is added, accepted, rejected, deprecated, or superseded, or an ADR's status or owner changes.
> - **Status baseline**: 2026-10-03; ADRs record decisions and do not prove that the target capability is enabled in production; production status must also be checked against release evidence.

## Decision index

| ADR | Decision | Status | Implementation status |
|---|---|---|---|
| [0001](0001-monorepo-and-workspaces.md) | Use a pnpm + Turborepo monorepo | Accepted | Base workspaces implemented |
| [0002](0002-supabase-auth-data-and-rls.md) | Supabase provides Auth/Postgres/Storage; RLS is the data boundary | Accepted | Partly implemented; known permission gaps remain |
| [0003](0003-client-direct-crud-and-api-boundary.md) | Ordinary owner CRUD may talk to Supabase directly; privileged flows go through NestJS | Accepted | Partly implemented |
| [0004](0004-core-api-and-ai-service-split.md) | Separate the NestJS core service from the FastAPI AI service | Accepted | Materials 0041–0043 deployed to production |
| [0005](0005-economy-domain-separation.md) | Separate ledgers for points, credits, VIP, and fiat/creator payables | Accepted | Product rules set; target ledgers and Stripe not implemented |
| [0006](0006-production-topology.md) | Current production uses nginx + Web/API/AI containers + Redis + Supabase Cloud | Accepted | Implemented; `infra/hybrid-2g` is still a reference template |
| [0007](0007-third-party-ai-reference-licensing.md) | Do not copy NC-licensed AI code without a commercial license | Accepted | Ongoing constraint |
| [0008](0008-independent-learning-courses-and-azure-speech.md) | Independent learning-course model + server-side Azure Speech adapter | Accepted | 0011–0018 and the app completed a protected release on 2026-07-27 |
| [0009](0009-server-side-semantic-spelling-translation-assessment.md) | Server-side semantic translation pre-test + session-level spelling settings | Accepted | 0019–0020 and the app completed a protected release on 2026-07-28 |
| [0010](0010-ephemeral-translation-stt-and-shared-waveform.md) | Ephemeral Fish Audio translation STT + shared recording waveform | Accepted | 0037–0038 and the app completed a protected release on 2026-08-04; real accent evaluation still needs expanding |
| [0011](0011-private-redis-and-points-abuse-boundary.md) | Private Redis request protection + immutable Points decision/review boundary | Accepted | Stage A/go-no-go and 0052–0053 Stage B both released to production under protection |
| [0012](0012-materials-ai-durable-queue-zdr-and-2g-office-rendering.md) | Materials AI durable queue + OpenRouter ZDR + 2 GB Office rendering | Accepted | 0041–0043 released under protection on 2026-08-11 |
| [0013](0013-materials-ai-async-callback-resume-and-knowledge-graph.md) | Materials AI async callbacks, two-level checkpoints, and knowledge graph | Accepted | 0046–0048 candidate, not yet deployed |
| [0014](0014-materials-ai-luna-native-lifecycle-and-graph-layout.md) | Luna native files, job cleanup, savable graph layout, and whole-paper grading | Accepted | 0049–0051 candidate, not yet deployed |
| [0015](0015-ox-alpha-translation-and-native-image-pipeline.md) | Ox Alpha translation judging + a third Materials pipeline for native images | Superseded | 0054–0055 deployed to the database but never enabled by the app; superseded by 0016 |
| [0016](0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md) | Retire Ox Alpha; move Luna to GPT-6 Luna + Azure ZDR; move translation judging to the free Nemotron | Accepted | 0056–0057 candidate, not yet deployed |

## Status definitions

- **Proposed:** Under discussion; must not be used as an implementation premise or release commitment.
- **Accepted:** The team agrees to adopt it; "Accepted" only means the decision stands, and whether it is implemented depends on the ADR's implementation status and code evidence.
- **Deprecated:** Not recommended for new work, though historical systems may still depend on it.
- **Superseded:** Replaced by a newer ADR; the original text stays and links to its replacement.
- **Rejected:** Evaluated but not adopted.

## When an ADR is needed

Add an ADR when any of these holds: the change spans two or more services; it introduces/removes infrastructure or a key vendor; it changes authentication, data ownership, ledgers, privacy, or deployment boundaries; it creates a long-term compatibility constraint; rollback is expensive; or the team is likely to ask "why" later. Ordinary bugs, local implementation details, and easily reversible refactors do not need an ADR.

## Writing and change process

1. Copy the [template](TEMPLATE.md), use the next four-digit number, and name the file in lowercase with hyphens.
2. In the same PR, write the context, options, conclusion, consequences, current/target implementation, and verification approach.
3. When security, privacy, payments, AI, or data migration are involved, the corresponding owners join the review.
4. Never rewrite the historical conclusion after Accepted; if the conclusion changes, create a new ADR and mark the old one Superseded.
5. Errata, implementation links, and status updates may be added, but the original decision and date must be kept.
