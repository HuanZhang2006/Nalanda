# ADR-0001: Manage the monorepo with pnpm and Turborepo

> **About this document**
> - **Contents**: Records the decision to keep Web, API, AI, and shared packages in one repository workspace.
> - **Purpose**: Constrains how directories, the package manager, build orchestration, and shared contracts evolve.
> - **When to update**: When workspace tooling, package boundaries, release strategy, or multi-platform code organization changes materially; if the approach is replaced, create a new ADR that supersedes this one.
> - **Implementation note**: Accepted means the choice is accepted; whether a given workspace exists is determined by the current repository.

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Project maintainer
- **Scope:** The whole code repository

## Context

The product blueprint includes React Web, a NestJS API, Python AI, future Electron/React Native apps, and shared types and design tokens. Separate repositories would increase contract drift, cross-platform change, and version coordination costs; however, Python and TypeScript cannot fully share one build tool.

## Decision

- Use a `pnpm` workspace for JavaScript/TypeScript packages and lock `pnpm-lock.yaml`.
- Use Turborepo to orchestrate tasks such as `build`, `dev`, `typecheck`, and `test`.
- Deployable apps go in `apps/*`, reusable code/contracts in `packages/*`, database migrations in `supabase/*`, and deployment configuration in `infra/*`.
- The Python AI service keeps its own dependencies and test tooling but still runs under the same repository CI and contract tests.
- Shared types must not rely on compile-time TypeScript alone; any HTTP/Python boundary needs runtime schemas and contract tests.

## Options considered

- **One repository per service:** Clear permission and release isolation, but higher contract and documentation sync cost for an early-stage team.
- **Monolithic app:** Simple deployment, but AI parsing/model dependencies have a very different lifecycle from the Node core business logic.
- **npm/yarn workspaces:** Workable, but the project already chose pnpm for its strict dependencies and disk reuse.

## Consequences

Atomic commits, unified gates, and shared UI/types become easier. The cost is that CI must handle multi-language caches and affected packages correctly, and a wrong root script can give a false "partially passing" impression; when any workspace lacks a test script, the root gate must fail explicitly or report the gap.

## Gap between current implementation and target

- **Current:** `apps/web`, `apps/api`, `apps/ai`, `packages/types`, and `packages/ui` exist; root build/typecheck are orchestrated by Turbo.
- **Current limitations:** Electron, React Native, api-client, and i18n/config packages do not exist yet; shared TS types are not widely consumed by Web/API, and Python contracts can still drift.
- **Target:** Every workspace provides executable tests; TS/Python/API contracts are generated or validated from a single schema; CI runs along the dependency graph and aggregates coverage.

## Verification and review

After a fresh install at the root, `pnpm typecheck`, `pnpm test`, and `pnpm build` must all run. Review this decision when independent release cycles, access isolation, or significant repository growth are introduced.
