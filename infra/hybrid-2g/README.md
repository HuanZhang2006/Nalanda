# Nalanda · 2 GB Hybrid Deployment

> **About this document**
> - **Contents**: Describes a generic small-memory deployment template with Caddy + NestJS + FastAPI + Redis.
> - **Purpose**: For future AI/queue integration or a separate new environment; it is not the current production topology of `nalanda.online`.
> - **When to update**: When the compose file, images, memory budget, service dependencies, ports, environment variables, or security baseline change.

See the [project blueprint](../../docs/PROJECT_BLUEPRINT.md) for the target topology and development stages. **The data foundation (database / sign-in / storage / realtime) uses hosted Supabase; the 2 GB server only runs the project's own code in Docker**: Caddy + NestJS + Python AI + Redis. The production Materials AI implementation calls fixed DeepSeek/MiMo models through OpenRouter; Stripe is still an unimplemented future external dependency.

```
Your server (2 GB · Docker Compose)
  Caddy (80/443, entry point + automatic HTTPS)
    ├─ Static frontend  ./web-dist
    ├─ NestJS backend   api:3000   (internal)
    ├─ Python AI        ai:8000    (internal, called only by NestJS)
    └─ Redis            redis:6379 (internal)
        │ over the network
        ▼
  Supabase Cloud  ·  OpenRouter API  ·  future Stripe
```

> ⚠️ This is a **reference template**, not the actual release entry point for `nalanda.online`. Real production, through `infra/deploy`, completed 0041–0043, real ZDR/providers, a resource canary, and a public signed-in user smoke test on 2026-08-11; starting this template's four containers on their own does not replicate that release evidence.

---

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | Orchestrates the four services + 2 GB memory limits |
| `Caddyfile` | Entry routing + automatic HTTPS |
| `.env.example` | Environment variable template (copy to `.env` and fill in) |
| `api.Dockerfile` | NestJS multi-stage build (context = monorepo root) |
| `ai.Dockerfile` | FastAPI build (context = `apps/ai`) |
| `web-dist/` | Holds the frontend build output (served by Caddy) |

---

## Prerequisites

1. A Linux server with 2 GB of memory (a supported Ubuntu LTS or Debian stable is recommended).
2. A domain whose A record points at the server's public IP, with ports 80 / 443 open.
3. A hosted Supabase project (free tier).
4. Enabling Materials AI requires an OpenRouter key and a separate internal service token; the first version does not need Stripe.

---

## Deployment steps

**1) Install Docker**
```bash
curl -fsSL https://get.docker.com | sh
```

**2) Enable 2 GB of swap (strongly recommended as a buffer for memory peaks)**
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**3) Fill in environment variables**
```bash
cp .env.example .env
# Edit .env: DOMAIN / ACME_EMAIL / Supabase / Redis / OpenRouter / internal token
```

`SUPABASE_ANON_KEY` in the `.env.example` template cannot be used directly by the Vite build; building the Web app requires `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Also, never let Caddy read unrelated secrets such as the service role or OpenRouter key; API, AI, and Redis must each use their own least-privilege env file.

**4) Add the frontend build** (build locally or in CI; do not build Vite on the 2 GB machine)
```bash
# Locally: pnpm --filter @nalanda/web build  → produces apps/web/dist
# Copy the contents of dist to infra/hybrid-2g/web-dist/ on the server
```

**5) Start**
```bash
docker compose up -d --build
```
Caddy automatically requests an HTTPS certificate for `DOMAIN` (make sure the domain resolves and 80/443 are open).

**6) Check status**
```bash
docker compose ps
docker compose logs -f api
```

---

## Two build modes

- **Simple (build on the host)**: the `up -d --build` above. Building on a 2 GB machine is heavy — **stop other services before building** or make sure swap is on.
- **Recommended (CI builds images → server pulls)**: build `nalanda-api` / `nalanda-ai` in GitHub Actions and push them to a registry; replace `build:` with `image:` in the compose file so the server only runs `docker compose pull && up -d`. Zero build pressure on the 2 GB machine.

---

## Hard constraints for 2 GB

- Generation models go through OpenRouter; **do not run local LLMs / embedding models on the host**. The AI container only does deterministic parsing, LibreOffice rendering, and provider adapters.
- Parsing PDF/DOCX/PPTX can spike memory: strictly enforce the 25 MB/250 page/400,000 character limits, single concurrency, 640 MB memory / 896 MB including swap, 0.75 CPU, 128 pids, hard timeouts, and disk-watermark circuit breakers.
- Only suitable for early stage / low traffic. As traffic grows: upgrade to 4–8 GB, self-host the database too (variant C), or move back to fully managed (variant A).

---

## Backups and security

- **Database**: Managed by Supabase; recoverability must still be verified with the project recovery runbook, not just assumed from "there are backups".
- **Host**: Back up encrypted secrets; Redis is not the job source of truth, and the Postgres reconciler can re-enqueue. AI temporary directories must not be backed up and should be deleted in `finally`/the orphan cleaner.
- **Ports**: Only Caddy is public (80/443); api / ai / redis are all internal with no published ports.
- **Secrets**: `.env` and `web-dist/` are in `.gitignore` and never enter the repository.
- **Least privilege**: Real environments must split API/AI/Redis secrets; AI must not get the service role/Redis/Azure, Redis must not get Supabase/provider keys, and FastAPI must verify `X-AI-Internal-Token`.
