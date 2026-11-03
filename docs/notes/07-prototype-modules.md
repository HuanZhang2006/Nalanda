# 07 · Prototype modules (those still on mock data)

> **About this document**
> - **Contents**: Lists the Home, Notes/Create, and Note Market modules that are still mocks, their dependencies for real data, and distinguishes the already-real Course Market.
> - **Purpose**: Prevents high-fidelity interactions from being mistaken for implemented business logic, and gives migration work an entry point.
> - **When to update**: When any mock module is wired to real data, AI, or payments, or migration priorities change.

> Goal: record the modules **still running on mock data** (Home / Notes detail / Create / Note Market) and what they need for a real backend. Modules already on a real backend include Materials, Community, Schedule, and [Courses](11-learning-courses.md); Course Market is a free real snapshot and must not be confused with the Note Market demo.

## 1. How it works today
Everything comes from `apps/web/src/legacy/`:
- **Data**: `DB` in `legacy/data.ts` (mock: user, courses, notes, knowledge, quiz, graph, exam, market, community, comments, badges, schedule, activity…).
- **Views**: the `VIEWS` table in `legacy/app.ts`, one function per route returning an HTML string; `go(route)` puts it into `#content`.
- **Interaction**: event delegation reads `data-go` (route change) / `data-act` (runs `ACTIONS[...]`), mutates the frontend state `S`, and re-renders.
- **"Write" operations in the mock modules listed here**: buying, exporting, generating, and so on only show a toast and never reach a backend. Posting is covered by the real Community module and is not part of this statement.

> Note: `materials` still has mock data in `DB`, but at runtime it is replaced by the real module (see [06](06-materials.md)), so Materials is real; the rest are still mocks.

## 2. Module status
| Module | Status | Notes / what a real backend needs |
|---|---|---|
| **Home** | 🟡 mock | Dashboard (greeting/stat cards/course progress/recent notes/activity); could use real "today's tasks + points + recent activity" |
| **Notes library + detail** | 🟡 mixed | Production 0041–0043 has Materials test papers, online exams, and history; the old hard-coded data stays as a demo. The knowledge list and standalone quiz are still mocks; the 0046–0051 candidate wires a source-ordered React Flow/ELK graph, external details, saved layouts, and node Q&A, not yet released to production |
| **Create flow** | 🟡 mock | Choose material → pick outputs → generate; needs Materials material → async AI microservice generation → persistence |
| **Market / Note Market** | 🟡 mock | Note cards/purchase modal; will depend on listing/purchase, a credits ledger, and creator revenue share |
| **Market / Course Market** | ✅ real production backend | Immutable English word-list versions, reporting, free clones; no credits/payments, see [11](11-learning-courses.md) |
| Courses English vocabulary learning | ✅ real production backend | Text create/edit/learn/review/share is live; AI file import and the other categories are still disabled |
| Materials library | ✅ real backend | See [06](06-materials.md) |
| Community | ✅ real backend | See [09](09-community.md) |
| Schedule (study plan) | ✅ real backend | See [10](10-schedule.md) |
| Profile / notifications / feedback | ✅ real backend | See [08](08-notifications-feedback-profile.md) |

## 3. Data shapes already pave the way
The Courses and `GeneratedExamV1`/job/quota/Notes/Exam contracts are shared between Web and API through `packages/types` and aligned with FastAPI's strict camelCase. The Knowledge/Quiz/Graph mocks in `legacy/data.ts` are still separate demo short fields; wiring them up requires a separate contract and layout and must not reuse test-paper results to pretend they are done.

## 4. Upgrade pattern (follow Materials)
Every module goes from mock → real backend the same way (see [06](06-materials.md) and [04](04-frontend-and-prototype-port.md)):
1. Write a migration: tables + owner-only RLS (+ any needed storage/foreign-key ownership checks), verify with a local Supabase reset/E2E, and release through the CLI history ([05](05-database-and-rls.md)).
2. Choose the access boundary: ordinary owner CRUD may talk to Supabase directly; progress, economy, AI cost, public distribution, or moderation must go through NestJS + restricted RPCs like Courses.
3. In `app.ts`: `VIEWS.xxx = () => '<div id="xxx-root"></div>'` + mount in a `go()` hook + pass dependencies through.
4. Verify RLS/storage isolation with two users, and add real-browser E2E for key flows.
5. Push → automatic deployment.

## 5. Remaining priorities
1. **Finish releasing and observing the quality of the Materials test-paper candidate**; then open the knowledge list/quiz/knowledge graph and Notes editing/export. The current implementation is a clean in-house build that copies no CC BY-NC reference code.
2. **Home** on real data (today's tasks / points / recent activity), tying every module into the first screen.
3. **Note market + wallet/payments** (depends on Stripe; last).
