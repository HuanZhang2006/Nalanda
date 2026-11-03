# 01 · Engineering foundation and monorepo

> **About this document**
> - **Contents**: Records the current pnpm/Turborepo single-repo structure, shared packages, and build boundaries.
> - **Purpose**: Explains the engineering skeleton and historical trade-offs without describing not-yet-created desktop/mobile packages as current.
> - **When to update**: When workspaces, package dependencies, build scripts, Node/pnpm versions, or directory responsibilities change.

> Goal: host "Web frontend + desktop (Electron) + mobile (RN) + backend (NestJS) + AI microservice (Python)" in one repository, sharing types and design tokens between frontend and backend so a change in one place stays consistent everywhere.

## 1. Technical approach

- **Package management + task orchestration**: `pnpm` (workspace) + `Turborepo`. pnpm workspaces let local packages reference each other with `workspace:*` via symlinks; Turborepo runs `build/dev/lint/typecheck` in dependency order and caches them.
- **Language**: TypeScript across the stack. Frontend, backend, and shared packages are all TS, so types can be reused across packages.
- **Why a monorepo**: Nalanda is multi-platform and multi-service; one repository can share `types` (end-to-end types), `ui` (design tokens/components), and `api-client` (an SDK generated from the backend OpenAPI, planned), avoiding "frontend and backend each writing their own version that doesn't match".

## 2. Directory layout

```
nalanda/
├─ apps/
│  ├─ web/      React + Vite (production frontend, shipped)
│  ├─ api/      NestJS core backend (shipped: health/me/auth)
│  ├─ ai/       Python FastAPI Materials AI worker (production 0041–0043)
│  ├─ desktop/  Electron (target; directory does not exist yet)
│  └─ mobile/   React Native (target; directory does not exist yet)
├─ packages/
│  ├─ types/    Shared TS types (aligned with AI artifact schemas and prototype data)
│  └─ ui/       Design tokens (tokens.css) + full styles (nalanda.css)
├─ infra/
│  ├─ hybrid-2g/  Generic 2 GB hybrid deployment template (Caddy version, reference)
│  └─ deploy/     Actual production deployment (nginx version, used by CI)
├─ supabase/    Database migrations + RLS + notes
├─ docs/        Architecture and notes
└─ app/         The original Claude Design prototype (design baseline, not part of the production build)
```

## 3. Key configuration files

- `pnpm-workspace.yaml`: `packages: [apps/*, packages/*]`.
- `turbo.json`: defines `build` (`dependsOn: ["^build"]` builds dependencies first; `outputs: dist/**`), `dev`, `lint`, `typecheck`.
- Root `package.json`: `packageManager: pnpm@9.x`, scripts `turbo run <task>`.
- `tsconfig.base.json`: shared compiler options (ES2022 / Bundler resolution / strict); each package overrides as needed (for example `api` uses CommonJS + decorator metadata).
- `.dockerignore`: excludes `node_modules/dist/.git/.env` from image builds so images stay small and leak no secrets.

## 4. Shared packages

### packages/types
Types only, no runtime. Courses and Materials AI share camelCase contracts between Web and API; Nest converts database snake_case explicitly, and FastAPI Pydantic uses strict camelCase JSON. The 0046–0051 candidate further shares `GeneratedKnowledgeGraphV1`, node answers, resumable/deleting jobs, `AiPipeline`, capabilities, and layout revisions; the knowledge list/standalone quiz are still future contracts, and a type existing does not mean the feature is live.

### packages/ui
The "style foundation" of the design system:
- `tokens.css`: design tokens only (fonts, density, accent colors, CSS variables for light and dark themes).
- `nalanda.css`: the **complete component styles** extracted from the prototype (cards, buttons, navigation, quizzes, graphs, test papers, and so on); the production frontend imports `"@nalanda/ui/nalanda.css"` directly.
- Exposed through `exports` in `package.json`: `./tokens.css`, `./nalanda.css`.

## 5. Build chain and logic

```
pnpm install                 # install + symlink workspace packages, produce pnpm-lock.yaml
pnpm build                   # turbo: run the build script in each workspace that has one
  ├─ @nalanda/types: tsc → dist (.js + .d.ts)
  ├─ @nalanda/api:   tsc → dist/main.js (NestJS)
  └─ @nalanda/web:   vite build → dist/ (static output)
```

The Python worker is not compiled by Turborepo; CI separately runs `ruff check`, `pytest`, and `docker build -f apps/ai/Dockerfile apps/ai`. All three passing still does not mean real OpenRouter calls or production enablement.

Key points:
- **Vite transpiles with esbuild and does not type-check** — so `vite build` does not replace a separate `typecheck`. Nine legacy TS files currently use `// @ts-nocheck`, so a passing typecheck does not prove type safety inside the legacy code.
- `pnpm-lock.yaml` **must be committed**: CI and Docker builds use `--frozen-lockfile` for reproducibility.
- The backend image uses `pnpm deploy --prod` to extract a self-contained directory with "production dependencies only" from the workspace, keeping the runtime image small.

## 6. Pitfalls

- **Local Node version**: the dev machine runs Node 25, but `.nvmrc`/CI/Docker all use Node 20 to avoid "works locally, differs in CI/production".
- **Docker builds of workspace packages**: early Dockerfiles only `COPY`ed some `package.json` files, so `--frozen-lockfile` failed on an incomplete workspace manifest; switching to "`COPY .` the whole repo + `pnpm install` + `pnpm deploy`" made it stable.

## 7. Verification

The current runnable verification is defined by the [testing guide](../guides/TESTING.md). Historically all three packages built successfully; an old record alone cannot show that the current commit builds.
