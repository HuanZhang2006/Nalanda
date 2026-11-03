# Production Deployment (nalanda.online)

> **About this document**
> - **Contents**: Records the Web/API/nginx topology on the current production server, deployment dependencies, and maintenance entry points.
> - **Purpose**: Helps understand the live layout; formal releases, database changes, backups, and recovery must follow the operations runbooks.
> - **When to update**: When the domain, server, CI, compose file, nginx/TLS, deployment account, or secret locations change.
> - **Status baseline**: 2026-08-23. The production database is at 0053 and the Web + API + internal AI + private Redis topology is healthy; nginx layered rate limiting and separate secrets are released. The timestamp-column revocation 0052–0053 is in effect; the latest main app candidate was stopped by the real Materials AI gate and `3c095a55ced21cee11a1b3131dd2889ec1f70733` was restored.

The server already runs several projects (sharing nginx + uofa.ink). Nalanda is added in an **isolated, stackable** way that does not affect existing services.

## Topology

```
GitHub push → Actions (builds on the runner, using no server memory)
  ├─ check + Python pytest/ruff + real test Redis + 0007→latest migration fixture + local Supabase rebuild/lint/RLS E2E
  ├─ FastAPI contract/AI image + fake-provider Playwright (automation evidence only)
  ├─ New migrations: dry-run → encrypted recovery point → protected DB push → verification
  ├─ Frontend vite build → Git SHA release/web
  └─ API/AI docker build → nalanda-api:<git-sha> / nalanda-ai:<git-sha> → docker save
        │ scp / ssh
        ▼
Server /opt/nalanda/
  ├─ New images + separate .env/.ai.env/.redis.env → real Azure/OpenRouter gates
  ├─ Courses API → queued first generation/Storage hit/repeated word/trimmed scoring gate
  ├─ docker compose (.deploy.env selects immutable API/AI images + private Redis)
  ├─ releases/<release-id>/web + atomic web symlink
  ├─ .env (API secrets, including the password URL; mode 600)
  ├─ .ai.env (only OpenRouter/internal token/non-secret worker config; mode 600)
  └─ .redis.env (only the Redis password; mode 600)
Host nginx: nalanda.online → static files + /api reverse proxy to 127.0.0.1:8411 (certbot manages TLS)
```

Why not build on the server: the machine has only about 300 MB of free memory, and Vite/Nest builds would OOM and affect other services, so all builds run in GitHub Actions.

## One-time server bootstrap (done)

- `/opt/nalanda/{web,.env,docker-compose.yml}`; `.env` has permission 600.
- nginx site `/etc/nginx/sites-available/nalanda` (+ sites-enabled symlink).
- `certbot --nginx -d nalanda.online` (auto-renewal).
- A CI-only SSH deploy key has been added to the server's `authorized_keys`.

## GitHub Secrets (repository Settings → Secrets → Actions)

| Name | Value |
|---|---|
| `SERVER_HOST` | The production server's public IP or hostname |
| `SERVER_USER` | The deployment SSH user (currently root; see the security to-do below) |
| `SERVER_SSH_KEY` | The CI deployment private key (ed25519) |
| `SERVER_SSH_KNOWN_HOSTS` | The target SSH host key line, verified by an administrator on a trusted network |
| `VITE_SUPABASE_URL` | `https://<active-project-ref>.supabase.co`; must match the current, resolvable, working production project |
| `VITE_SUPABASE_ANON_KEY` | The Supabase anon public key |

The `production-database` environment also needs `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, and `DB_BACKUP_ENCRYPTION_KEY`. That environment exists and only allows `main`; the current private-repository plan does not support required reviewers, so until the plan is upgraded, databases must only be released through a manually triggered `workflow_dispatch`, keeping an owner review record per the [database release runbook](../../docs/operations/DATABASE_RELEASE_ROLLBACK.md). The first baseline of the database migration history must not be guessed by CI.

Phase one of 0039–0040 requires, and production has set, two independent random secrets: `REDIS_PASSWORD` (32-byte hex) and `RATE_LIMIT_HMAC_SECRET` (at least 32 bytes). 0041–0043 additionally require `AI_INTERNAL_TOKEN` (at least 32 bytes) and `OPENROUTER_API_KEY`. The workflow atomically writes mode-600 API/AI/Redis env files through stdin install scripts without printing values; AI gets no service-role/Redis/Azure secrets, and Redis gets no Supabase/provider secrets. Materials AI's `OPENROUTER_API_KEY` is the same production secret as the existing Courses OpenRouter key, but is injected only into the API/AI consumers that actually need it.

> **2026-07-21 Supabase pause incident and recovery:** While the project was paused, the production ref returned `NXDOMAIN` on public DNS, and the strict readiness check correctly prevented the new version from activating; after recovery, DNS, JWKS, and the server's service-role PostgREST probe recovered. 0008–0010 were then released, and 0011–0013 followed on 2026-07-22 through the protected process. Never weaken the health gate because a dependency is paused.

When first adding `SERVER_SSH_KNOWN_HOSTS`, obtain the host key on a trusted network, view the fingerprint with `ssh-keygen -lf`, and cross-check it through a second channel (the server console/cloud provider records) before writing the full known_hosts line into the secret. Never treat unverified `ssh-keyscan` output as a root of trust. `DB_BACKUP_ENCRYPTION_KEY` should be generated from cryptographically random values, with a copy kept in controlled recovery custody outside GitHub.

## Flow

Pushing a non-docs-only change to `main` triggers [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml): check + Python/AI image + real Redis/BullMQ → automatically stage migrations 0008 and later and verify the 0007→latest upgrade → empty-database rebuild → db lint → local real RLS/Storage/points/Courses/AI E2E → nginx `-t` → fake-provider Playwright. Without new migrations it continues to the immutable app deployment; with new migrations, an ordinary push stops after verification. The owner first manually runs a read-only plan, then applies separately; the app continues only after the database release succeeds. The server first installs secrets with `FEATURE_MATERIAL_AI=false` and starts Redis/FastAPI, verifies `deps.supabase=ok`, `deps.redis=ok`, and AI readiness/cleaner/resource canary, then runs fixed real DeepSeek/MiMo ZDR generation and grading smoke tests with no personal data. If any gate fails, the feature is not enabled and the Web is not switched; an app smoke failure restores the previous Web symlink/API/AI images, and the database is only fixed forward.

A manual `workflow_dispatch` only redeploys the app by default; `plan_database_migrations` only shows the remote plan without changing the database or deploying, and only `apply_database_migrations` creates a recovery point, migrates, and continues to the app deployment; the two cannot be selected together. Deployment requires the real provider gates to succeed, the API JSON to report `status/service/deps.supabase=ok/deps.redis=ok`, the AI-specific readiness to be ok, and public checks of sign-up/ordinary API RateLimit headers, admin denial, the Web/API root, and the signed-in user's full Materials → Notes → exam chain. Playwright fakes, mock Redis, fixed fake providers, or local builds cannot replace production evidence.

The repository's reference nginx configuration sets `client_max_body_size 10m` for `/api/`, matching Nest's course JSON limit. Production 0039 uses a restricted install script to add, in the same Nalanda server block, API 20 r/s burst 40, sign-up 1 r/s burst 3, plus standard JSON 429s and `Retry-After`/RateLimit headers; it reloads only after `nginx -t` passes and does not modify other sites. Read-aloud WAV uploads are still capped by the API's 2 MB multipart limit.

Pure Markdown changes are validated by the [docs workflow](../../.github/workflows/docs.yml) for the document opening fields and relative links, and do not redeploy the app.

> Security to-do: the recorded deployment user is root. It should be migrated to a least-privilege deploy user granted only `/opt/nalanda`, controlled Docker/service operations, and nginx reload, and the existing deployment key should be rotated.

## Server maintenance cheat sheet

```bash
cd /opt/nalanda
docker compose --env-file .deploy.env ps
docker compose --env-file .deploy.env logs --tail=50 api
docker compose --env-file .deploy.env logs --tail=50 ai
docker compose --env-file .deploy.env logs --tail=50 redis
docker compose --env-file .deploy.env restart api
docker compose --env-file .deploy.env restart ai
docker compose --env-file .deploy.env exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" ping'
readlink -f web
cat .deploy.env
```

Do not manually overwrite `nalanda-api:latest` with a new version; current releases use Git SHA tags. A manual rollback should use the previous image/web release saved by the failed workflow, with two-person review, after confirming the new database schema is still compatible with the old app. Redis is a rebuildable runtime dependency for rate limiting/locks, not the source of truth for points or courses; the app can keep running after a rollback, and deleting the AOF must never be used in place of a database recovery.
