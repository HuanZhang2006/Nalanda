# Nalanda

> **About this document**
> - **Contents**: The project entry point: current capabilities, the real/mock boundary, quick start, and documentation navigation.
> - **Purpose**: Lets someone new to the repository learn within minutes "what the project is now, how to run it, and where to look next".
> - **When to update**: When module status, startup commands, the live entry point, the tech stack, or documentation navigation change; never describe blueprint features as already implemented.

> Named after the ancient Indian university of Nalanda — one of the world's earliest great seats of learning.

Nalanda's ultimate goal is to turn university course materials into knowledge lists, interactive quizzes, knowledge graphs, and mock exams, and to build study plans, community, growth, and trading around those knowledge assets.

Live environment (as recorded in the repository docs): [https://nalanda.online](https://nalanda.online). This README is not proof of live availability.

The web interface is in English by default, with an EN/中文 toggle in the top bar (and on the sign-in page) that switches every page to Chinese.

## Current status

| Module | Current implementation |
|---|---|
| Sign up / sign in / sign out | ✅ Supabase Auth; sign-up creates a confirmed account through a NestJS service-role endpoint |
| Materials | ✅ Supabase tables + private Storage + RLS; courses, upload, preview, download, delete. Production 0041–0043 launched server-side "Generate test paper" for every supported file, with a durable queue, safe parsing, and live progress |
| Community | ✅ Posts, comments, likes/saves, reposts, follows, tags, images/audio; production 0039–0040 tightened trusted post columns and enabled the points daily cap, manual-review reversals, and flag-only coordination detection |
| Schedule | ✅ Tasks, goals, course/material links, idempotent points, and streaks; production 0039–0040 enabled the linked-owner trigger, database-maintained `done_at`, and the daily task reward cap; "Auto-fill" is rule-based |
| Courses / Course Market | ✅ Live in production: English word-list text import, editing, four-stage learning, review, Schedule/Profile integration, free sharing/market, badges and points, instant feedback, idempotent answering on weak networks, durable audio prewarming, browser offline audio, intent-specific resume, explicit cancel, an optional timed spelling test, an OpenRouter semantic translation pre-test, Chinese translation voice input, a unified recording waveform, end-of-round mistake review, spelling/pronunciation exams with an adjustable threshold defaulting to 90%, arbitrary word selection for reviews/exams, automatic end of practice after a failed exam, exam history details, and learning properties in the editor; the Courses feature migrations reach 0038, and the overall production history is at 0043. A word counts as learned only after both the spelling exam and the pronunciation exam pass, and `learned_at` is derived exactly by a database trigger as the later of the two exam pass times; initial learning, review, a single exam, or manual assignment cannot create mastery. Pronunciation recordings no longer use local VAD/silence trimming and only keep the PCM format conversion Azure requires. |
| Profile / Growth / notifications / feedback | ✅ Profile sensitive columns are server-maintained, and points have a reversible ledger; production 0039–0040 narrowed Feedback to read/insert for users and enabled the reward daily cap, receipts/notifications, and moderation auditing; notifications are currently refreshed by query, not Realtime |
| Home | 🟡 High-fidelity mock; stats/courses/activity are not real aggregates |
| Notes / AI Create | 🟡 The historical demo cards in My Notes stay as a demo; production 0041–0043 wired private generated test papers, online exams, and async subjective grading under Materials courses. The unreleased 0046–0051 candidate also implements the knowledge-point graph/node Q&A, resumable long jobs, React Flow + ELK cross-device layout, job delete/clear, and the Luna native-file pipeline; the standalone AI Create is still a mock |
| Note Market / credits / VIP / payments | 🟡 Note Market is still a demo, and Course Market only supports free clones; no credits ledger, orders, or Stripe |
| Courses file import / other categories | ⬜ PDF/Word/JSON/Markdown/HTML/images only have disabled entry points; AI parsing and knowledge points/reading comprehension/question bank training are not implemented |
| Interface language | ✅ English by default with a Chinese toggle across the shell and every page; bilingual strings live next to the code as `l(english, chinese)` pairs |
| Electron / React Native | ⬜ Not started |

Most legacy modules talk to Supabase directly from the browser; Courses and Materials AI business writes go through NestJS and dedicated service-role transaction RPCs. Production completed security phase one (0039–0040) on 2026-08-10, then on 2026-08-11 enabled Materials AI through a separate read-only plan, an encrypted recovery point, remote verification of 0041–0043, a 2 GB resource canary, real DeepSeek/MiMo/Azure/OpenRouter gates, a full signed-in user path, and an immutable app release. Every user is currently Free, with 10 successful generations and 10 successful subjective gradings per Profile local day; only success consumes, rejection/failure/cancellation releases the reservation, and credits are never read. The timestamp-column Stage B applied the production database to 0053 on 2026-08-22; protected run `32628757656` on 2026-08-23 then applied and verified 0054–0055 after an encrypted recovery point. On 2026-08-26, main run `32931681321` automatically restored the earlier stable release after the real DocumentIR DOCX test-paper gate failed: the old structural repair had no source block text, and five classes of semantic defects only surfaced after the structure turned green. The current Unreleased `exam-generate.v4` gives the repair the full source and adds a strictly bounded follow-up semantic repair; the new real provider and app cutover have not been proven yet, and the Materials AI/Luna flags stay off. Database 0055 going live does not mean the candidate UI/AI capabilities are cut over; the originally reserved 0044–0045 were not back-filled. A full offline PWA and the credits/VIP commercial ledgers are still not implemented. See the [current architecture](docs/ARCHITECTURE.md) and the [deployment notes](docs/notes/03-deployment-and-cicd.md) for other boundaries and release evidence.

The current branch's **Unreleased** candidate includes 0046–0051 and the appended 0054–0057: 0046–0048 change generation/grading to 202 + durable callbacks, fix the misreported Undici five-minute response-header timeout, and add 24-hour two-level checkpoints, knowledge-point organization, and node Q&A; 0049–0051 add `luna_native_file_v1`, actual-upstream auditing, job interruption/delete/clear, private cross-device graph layouts, and permission verification; the Ox Alpha pipeline added in 0054–0055 is fully retired by 0056–0057 (the model was removed from OpenRouter and never enabled in production), while Luna is upgraded to `openai/gpt-6-luna` locked to Azure, the only upstream offering ZDR ([ADR-0016](docs/adr/0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md)). The knowledge graph uses dynamic React Flow + ELK with zoom, pan, drag, keyboard movement, auto-arrange, and details below the canvas on mobile; exam drafts are not graded and return no answers, and grading happens together only after the whole paper is submitted or time runs out. Courses non-literal translation judging moves to OpenRouter's free `nvidia/nemotron-3-super-120b-a12b:free`. This paragraph describes code status, not a production claim; real Supabase, real OpenRouter, a resource canary, and a protected release are still required before launch.

## Current technical structure

- Web: a React 18 + Vite auth shell that mounts the legacy DOM app inside.
- Data/Auth/Storage: Supabase PostgreSQL, Auth, Storage, RLS.
- API: NestJS, providing health/auth/me, Courses, speech/AI adapters, and points admin endpoints; production enables ioredis atomic rate limiting, the coordination scanner, and real Redis readiness.
- AI: production 0041–0043 uses an internal FastAPI, deterministic parsers, fixed OpenRouter ZDR models, and strict schemas; NestJS schedules with Postgres job facts + BullMQ/Redis. The Unreleased candidate switches long jobs to fast acceptance/callbacks and adds resumable graphs/node Q&A; the explicit native-file path Luna (GPT-6 Luna) handles PDFs/images, locked to the Azure ZDR upstream, without entering DocumentIR/parse cache. When the live ZDR catalog has no Azure endpoint it stays off and never silently downgrades.
- Shared: pnpm + Turborepo; `packages/ui` is a CSS package, and the Courses camelCase contract is shared by Web/API through `packages/types`.
- Production: built by GitHub Actions; host nginx serves the Web app, and Docker runs the API, an isolated FastAPI AI worker, and a password-protected, AOF-everysec Redis reachable only on the container network; Supabase stays on the cloud service.

## Repository entry points

- `apps/web`: production Web app.
- `apps/api`: NestJS auth/health checks, plus the server boundary for Courses, learning sessions, speech, sharing, and the course market.
- `apps/ai`: the production Materials AI isolated worker; parses PDF/Office/text/images and only recovers failed visual regions, authenticated with an internal token, not a public service.
- `app/`: standalone static desktop/mobile prototypes and the Showcase, not the production app entry point.
- `supabase/migrations`: append-only migrations; production migration history is at 0053. 0052–0053 only run the security timestamp-column contract; the empty 0044–0045 numbers were not back-filled. The database version and the current immutable app release must be checked separately.
- `infra/deploy`: the current production deployment configuration.
- `infra/hybrid-2g`: a generic deployment template for future AI/BullMQ integration; the current production Redis configuration is in `infra/deploy`, and the two must not be confused.

## Quick start

Requirements: Node 20, pnpm 9.12.3; real sign-in and business data need a Supabase project.

```bash
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env

pnpm --filter @nalanda/api build
pnpm --filter @nalanda/api start
pnpm --filter @nalanda/web dev
```

See the [local development guide](docs/guides/LOCAL_DEVELOPMENT.md) for a from-scratch environment, the AI Python environment, and database setup.

Common checks:

```bash
pnpm check   # docs:check + release-tool tests + code lint + typecheck + test + build
```

The default `pnpm test` runs Web jsdom and API unit tests without connecting to external projects; the real RLS suite only runs behind an explicit safety switch. PR/main CI also starts a real Redis and a throwaway local Supabase to verify the Lua atomic window, 0007→latest, an empty-database rebuild, post/Feedback/Schedule permissions, points concurrent caps/moderation/coordination signals, and Courses, and runs Playwright with provider fakes. Before the production app activates, real Azure/OpenRouter/Fish gates still run, and `deps.supabase=ok` and `deps.redis=ok` are required. Locally skipped Redis/RLS, jsdom, or fake providers cannot be called the corresponding real E2E; see the [testing guide](docs/guides/TESTING.md).

## Static design prototype

You can view the prototype without configuring a backend:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

The root entry redirects to `app/Nalanda Showcase.html`. The static prototype depends on Google Fonts and unpkg React/Babel, so it is not fully offline; all of its business data is mock.

## Documentation

- [Documentation index](docs/README.md)
- [Final project description and development roadmap](docs/PROJECT_BLUEPRINT.md)
- [Current architecture](docs/ARCHITECTURE.md)
- [Implementation notes](docs/notes/README.md)
- [ERD](docs/guides/ERD.md) / [API](docs/guides/API.md)
- [Environment variable matrix](docs/guides/ENVIRONMENT_VARIABLES.md) / [Testing guide](docs/guides/TESTING.md)
- [Database release and rollback](docs/operations/DATABASE_RELEASE_ROLLBACK.md)
- [Security policy](SECURITY.md) / [Contributing guide](CONTRIBUTING.md) / [Changelog](CHANGELOG.md)

## Planned core capabilities

Phase one of Materials file-to-test-paper generation and online exams is live; Knowledge list and standalone Quiz still show Coming soon. The repository candidate implements the knowledge graph/node Q&A, resumable long jobs, Luna native-file processing, and full job cleanup, but these do not count as live features until CI, real provider gates, and a protected production release are complete. Later work covers Courses file AI parsing, other AI artifacts, a real Home, the note market/credits/Stripe, full content governance, Realtime, an admin back office, Electron, and React Native. Dependencies, order, and acceptance criteria are defined only by [PROJECT_BLUEPRINT.md](docs/PROJECT_BLUEPRINT.md).

## License

Nalanda is released under the [MIT License](LICENSE). The ExamPass-Assistant project used as a methodology reference is licensed CC BY-NC 4.0; none of its non-commercial code may be copied into this repository without the author's authorization.
