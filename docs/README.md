# Nalanda Documentation Hub

> **About this document**
> - **Contents**: Indexes every long-lived document in the project and explains each category's scope of authority, reading order, and maintenance responsibility.
> - **Purpose**: Prevents "current implementation, final blueprint, historical retrospective, and runbook" from overriding each other or contradicting each other's status.
> - **When to update**: When a document is added, deleted, or renamed, or a category's owner/scope of authority changes.

Last checked: 2026-10-03. The production database is at 0055 and the 0052–0055 contract is in effect; the current immutable app is still the earlier stable release. main run `32931681321` rolled back automatically after the real DocumentIR DOCX test-paper semantic gate failed. The current Unreleased `exam-generate.v4` fixes the structural repair lacking the source text and the absence of a semantic repair stage after it, and 0056–0057 retire Ox Alpha and upgrade Luna to GPT-6 Luna + Azure ZDR; full CI, real provider, cutover, and independent public evidence still have to be obtained again.

## 1. Source-of-truth priority

When the same content conflicts, resolve it as follows:

1. **Current code, migrations, and deployment configuration** are the runtime facts.
2. The [current architecture](ARCHITECTURE.md), [ERD](guides/ERD.md), and [API](guides/API.md) explain the current facts.
3. The [final project blueprint](PROJECT_BLUEPRINT.md) defines goals and development order and does not prove a feature is implemented.
4. `notes/` are historical implementation retrospectives; outdated content should be corrected or clearly labeled, and never overrides the current architecture.
5. `operations/` are runbooks for releases, recovery, alerting, and secret work.
6. ADRs record "why we decided this", and the CHANGELOG records "what changed".

Only capabilities with code, test, and deployment evidence together may be described as "verified/live".

## 2. Suggested reading order

When you first join the project:

1. The repository root [README](../README.md)
2. The [final project blueprint](PROJECT_BLUEPRINT.md)
3. The [current architecture](ARCHITECTURE.md)
4. [Local development from scratch](guides/LOCAL_DEVELOPMENT.md)
5. The [testing guide](guides/TESTING.md)
6. Then the ERD/API, implementation notes, and operations runbooks as your task requires

## 3. Core references

| Document | Scope of authority | Main maintainer | Update trigger |
|---|---|---|---|
| [Project blueprint](PROJECT_BLUEPRINT.md) | Final product, target architecture, roadmap, features to implement | Product/tech lead | Scope, phases, or key decisions change |
| [Current architecture](ARCHITECTURE.md) | The real runtime architecture and module boundaries | Tech lead | Service/data/deployment boundaries change |
| [ERD](guides/ERD.md) | Tables, relationships, delete behavior, RLS | Author of the database change | Every schema/RLS migration |
| [API](guides/API.md) | Current Nest/FastAPI/direct Supabase interfaces | API author | Endpoints, auth, or errors change |
| [Environment variables](guides/ENVIRONMENT_VARIABLES.md) | Variable sources, consumers, secrecy level | Service/ops author | Variables added, removed, or rotated |

## 4. Development and testing

- [Local development from scratch](guides/LOCAL_DEVELOPMENT.md)
- [Environment variable matrix](guides/ENVIRONMENT_VARIABLES.md)
- [Runnable testing guide](guides/TESTING.md)
- [Contributing guide](../CONTRIBUTING.md)
- [Changelog](../CHANGELOG.md)

## 5. Data and operations

- [Database release and rollback](operations/DATABASE_RELEASE_ROLLBACK.md)
- [Backup and recovery](operations/BACKUP_RECOVERY.md)
- [Monitoring and alerting](operations/OBSERVABILITY_ALERTING.md)
- [Secret rotation](operations/SECRET_ROTATION.md)
- [Current production deployment](../infra/deploy/README.md)
- [2 GB hybrid deployment template](../infra/hybrid-2g/README.md)

## 6. Security, privacy, and governance

- [Security policy](../SECURITY.md)
- [Privacy and data deletion](governance/PRIVACY_AND_DATA_DELETION.md)
- [Content moderation](governance/CONTENT_MODERATION.md)
- [AI evaluation and cost](ai/EVALUATION_AND_COST.md)
- [Unified AI prompt catalog](ai/PROMPT_CATALOG.md)
- [Points / credits / VIP / payment rules](product/POINTS_CREDITS_VIP_PAYMENTS.md)

## 7. Decision records

- [ADR index](adr/README.md)

ADRs only record decisions already made that affect multiple modules or are hard to reverse. Open questions stay in the project blueprint; once decided, add an ADR and update the relevant current documents.

Latest adopted candidate decision: [ADR-0016 Retire Ox Alpha and GPT-6 Luna (Azure ZDR)](adr/0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md), which supersedes [ADR-0015](adr/0015-ox-alpha-translation-and-native-image-pipeline.md); the production baseline is still the 0041–0043 release that corresponds to [ADR-0012](adr/0012-materials-ai-durable-queue-zdr-and-2g-office-rendering.md). Accepted means the architecture decision is adopted and does not automatically prove the candidate is deployed; production evidence still comes from the architecture, tests, and release records.

## 8. Implementation notes

The [implementation notes index](notes/README.md) covers:

- 01 monorepo
- 02 authentication
- 03 deployment/CI
- 04 prototype port
- 05 database/RLS
- 06 Materials
- 07 remaining mocks
- 08 notifications/feedback/Profile
- 09 Community
- 10 Schedule
- 11 Courses English vocabulary learning

Implementation notes are good for learning function-level logic and historical pitfalls, but test commands, current interfaces, and production operations must point to the corresponding authoritative documents.

## 9. Documentation writing contract

Every long-lived Markdown file must state, right after the title:

- **Contents**: What the document covers and what it does not.
- **Purpose**: When readers use it and whether it is an authoritative source.
- **When to update**: Which code, product, or operations changes must be reflected in it.

The body must:

- Distinguish `current`, `target`, and `historical`.
- Provide verifiable evidence for commands, paths, variables, and state machines.
- Never record real secrets; examples always use placeholder values.
- Never write a one-off manual test as permanently "verified"; link to runnable tests.
- When changing a feature, update the applicable parts of README/architecture/ERD/API/tests/CHANGELOG.

The repository uses `node scripts/check-docs.mjs` to validate the opening fields above and relative links.
