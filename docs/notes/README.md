# Nalanda Implementation Notes (Retrospectives / Learning)

> **About this document**
> - **Contents**: Indexes implementation approaches, historical trade-offs, pitfalls, and runnable verification entry points by module.
> - **Purpose**: Helps review existing implementations; it is not the final product blueprint and does not replace the current architecture, ERD, or API docs.
> - **When to update**: When a module is added or refactored, a historical conclusion is changed by code, or verification commands or module status change.

Each area records the **technical approach, implementation details, logic flow, pitfalls, and verification** of shipped features, for review and learning.
For the current architecture see [../ARCHITECTURE.md](../ARCHITECTURE.md); for the final blueprint and roadmap see [../PROJECT_BLUEPRINT.md](../PROJECT_BLUEPRINT.md).

| Note | Contents |
|---|---|
| [01 – Engineering foundation and monorepo](01-monorepo-foundation.md) | pnpm + Turborepo single repo, directory layout, shared packages (types/ui), build chain |
| [02 – User system and authentication](02-auth-and-user-system.md) | Supabase Auth, JWKS verification, custom sign-up endpoint, profiles + RLS, sign-in frontend |
| [03 – Deployment architecture and CI/CD](03-deployment-and-cicd.md) | Managed + self-hosted hybrid, nginx isolation, GitHub Actions pipeline, field notes on pitfalls |
| [04 – Frontend and prototype port](04-frontend-and-prototype-port.md) | React + Vite, design tokens, moving the Claude Design prototype into the production app |
| [05 – Database / migrations / RLS](05-database-and-rls.md) | Supabase Postgres, owner-only RLS, CLI history, local rebuilds, and the legacy `db-push` boundary |
| [06 – Materials library](06-materials.md) | courses/materials + Storage/RLS; production 0041–0043 test papers, 0046–0051 candidate recovery/graph/Luna/job cleanup |
| [07 – Prototype modules (remaining mocks)](07-prototype-modules.md) | Home/Create/Note Market and the Notes demo; distinguishing real Materials test-paper candidates |
| [08 – Notifications / feedback / profile](08-notifications-feedback-profile.md) | Notification panel, feedback, real Profile data, protected points projection + tiered badges |
| [09 – Community](09-community.md) | Post/comment/like/favorite/repost/follow, media, stable points business keys/reversals, and notification hooks |
| [10 – Study plan](10-schedule.md) | Tasks/goals, idempotent completion rewards + streaks, linked course materials, auto-fill |
| [11 – Courses English vocabulary learning](11-learning-courses.md) | Independent learning courses, text parsing/editing, four-stage learning, review mastery, sharing market, Azure Speech |

> Status: wired to real production data — sign-up/sign-in, **Materials, Community, Study plan, Courses, notifications, feedback, profile (points ledger/levels/badges)**, plus Web/API/AI; production migration history is at 0053 and the 0052–0053 security contract is in effect. The current stable app keeps serving the 0041–0043 Materials test papers/exams/Free quota; the 0046–0051 recovery, graph, job cleanup, layout, and Luna work are unreleased candidates only. Fake Playwright, jsdom, or pytest runs are not proof of real providers or production; candidates still need real DeepSeek/MiMo/Luna, a resource canary, database/RLS checks, a signed-in user smoke test, and independent public verification.
