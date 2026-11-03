# ADR-0006: Current production uses nginx + Web/API/AI containers + Redis + Supabase Cloud

> **About this document**
> - **Contents**: Records the production topology currently live, and separates it from the undeployed hybrid/target topologies.
> - **Purpose**: Keeps deployment, monitoring, and troubleshooting focused on the system actually running, not the early Vercel/Railway or 2 GB scaffolding assumptions.
> - **When to update**: When the production entry point, host, containers, domain, Supabase, AI/Redis deployment, or release method changes.
> - **Status baseline**: 2026-08-11; production is nginx + Web/API/internal AI + private Redis + Supabase Cloud. Redis shipped with 0039–0040 and AI with 0041–0043; sensitive host details and secrets are not written into ADRs.

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Project maintainer
- **Scope:** Current production deployment

## Context

The original blueprint discussed Vercel + Railway + Supabase and also provided 2 GB hybrid scaffolding with Caddy/API/AI/Redis. The actual production CI uses nginx to serve the static Web build and reverse-proxy `/api` to the NestJS API, while business data stays on Supabase Cloud.

## Decision

- Current production facts come from `.github/workflows/deploy.yml`, `infra/deploy/docker-compose.yml`, and the nginx configuration.
- nginx is the public entry point; it serves the Web static build and reverse-proxies `/api`. The NestJS API runs in a container, and Supabase Cloud provides Auth/Postgres/Storage.
- The FastAPI Materials AI runs in production as an isolated internal container with no host port; Stripe, pgvector, Electron, React Native, and Supabase Realtime are still not deployed to production. The same-host private Redis from ADR-0011 serves request protection, audit aggregation, scan locks, and BullMQ UUID delivery; PostgreSQL remains the source of truth for jobs and allowances.
- `infra/hybrid-2g` stays as generic candidate scaffolding, not the current runbook; the real production nginx/API/AI/Redis configuration is in `infra/deploy`.

## Consequences

The deployment path matches current capability at low cost, but single-host/container releases have limited availability, rollback, observability, and resource isolation. Documentation must not present environment variables or services from candidate configurations as live dependencies.

## Gap between current implementation and target

- **Current:** PRs/main run typecheck, Web jsdom, API readiness unit tests, build, and local Supabase upgrade/rebuild/lint/RLS E2E; new migrations are released through a protected environment after an encrypted recovery point; the app deploys as a Git SHA release and automatically rolls back to the previous Web/API; health probes Supabase JWKS/PostgREST.
- **Current limitations:** Health does not yet prove Storage, real sign-up/sign-in, full RLS, or every business path; the database is not reversed automatically; Storage bytes, off-site artifacts, continuous monitoring, and full recovery drills are still missing.
- **Target:** Keep adding staging/canary, off-site artifact/Storage backups, full recovery drills, centralized logging, and SLO alerts; AI/BullMQ already have independent gates, and Stripe still needs its own design and release.

## Verification and review

Every release records the version, migrations, health/smoke results, and rollback point. When a second host, a managed platform, or an AI worker is added, create/update an ADR and sync the operations docs.
