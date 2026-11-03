# Environment Variable Matrix

> **About this document**
> - **Contents**: Collects the environment variables read by the repository, injected only by deployment configuration, used only by ops scripts, or still part of the blueprint, with their scope, stage, and sensitivity.
> - **Purpose**: Prevents variables from going to the wrong service, server secrets from being compiled into the frontend, and deployments or rotations from failing because configuration is missing.
> - **When to update**: Immediately when variables are added, removed, or renamed, when defaults/consumers/sensitivity change, or when CI, Docker, domains, third-party providers, or the secret rotation process change.

## 1. Reading conventions

- **Currently required**: must be provided for some existing user path to work.
- **Currently optional**: read by the code, but can be omitted or only affects status display.
- **Target placeholder**: reserved in examples or the target deployment, but not used by current business code.
- **Public** does not mean it can be changed freely; it only means the value appears in the browser bundle or in public requests.
- No service-role key, private key, personal access token, or provider secret may use the `VITE_*` prefix.

## 2. Web build-time variables

Template: `apps/web/.env.example`. The local file is `apps/web/.env.local`; production injects them from GitHub Actions Secrets via `.github/workflows/deploy.yml`. Vite compiles these values into the static files, so the Web app must be rebuilt after changes.

| Variable | Status | Sensitivity | Consumer | Purpose and default behavior |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Currently required | Public config | `apps/web/src/lib/supabase.ts` | Supabase project URL; when missing, the client is `null` and the sign-in page shows a not-configured hint. |
| `VITE_SUPABASE_ANON_KEY` | Currently required | Public credential | `apps/web/src/lib/supabase.ts` | Browser anon/publishable key; the security boundary depends on Auth + RLS, and it must never be replaced with the service-role key. |

The Web app currently has no `VITE_API_URL`. The browser uses the relative path `/api`: locally Vite proxies it to `localhost:3000`, and in production nginx reverse-proxies it.

The UI language is not an environment variable: it defaults to English and the user's choice is stored in the browser's `localStorage` under `nalanda-locale`.

## 3. NestJS API runtime variables

Template: `apps/api/.env.example`. The local file is `apps/api/.env`; the current production file is the server's `/opt/nalanda/.env`, loaded through `env_file` in `infra/deploy/docker-compose.yml`.

| Variable | Status | Sensitivity | Consumer | Purpose and default behavior |
|---|---|---|---|---|
| `PORT` | Currently optional | Public config | `apps/api/src/main.ts` | Listening port; `3000` when invalid or missing. The production compose sets `3000` explicitly. |
| `SUPABASE_URL` | Currently required (auth/sign-up) | Public config | Auth controller, JWT guard, health | Admin Auth base URL and JWKS/issuer base; when missing, sign-up returns `SERVER_MISCONFIG` and protected endpoints cannot verify via JWKS. |
| `SUPABASE_REQUEST_TIMEOUT_MS` | Optional, 20,000 | Restricted config | Timeout for NestJS service-role REST/Storage transport (including reading the response body), limited to 1–60 seconds; a timeout returns a redacted `UPSTREAM_TIMEOUT` and non-idempotent business RPCs are not replayed automatically. Courses audio prepare/manifest have a separate local three-attempt retry because the database is idempotent. |
| `SUPABASE_SERVICE_ROLE_KEY` | Currently required (sign-up/readiness/Courses) | **Top secret** | Auth controller, health, Courses services | Calls Admin Auth/PostgREST/Storage and service-only RPCs; bypasses RLS, may only exist on the backend, and never enters responses/logs. |
| `SUPABASE_JWT_SECRET` | Currently optional | **Top secret** | `apps/api/src/auth/supabase.guard.ts` | Fallback verification for legacy HS256 tokens. The current guard prefers JWKS; projects with asymmetric signing should not copy this value without reason. |
| `REDIS_URL` | Required by production 0039–0040 | **Secret connection string** | Redis service, health, global rate limiting, scanner | The API opens a real connection; production uses `redis://:<64-hex>@redis:6379/0`. Missing/unreachable makes readiness 503 and protected writes fail closed. |
| `RATE_LIMIT_HMAC_SECRET` | Required by production 0039–0040 | **Top secret** | Redis service/health | At least 32 bytes; only used to derive HMACs of IPs/emails, and never reused as the Redis, JWT, backup, or provider secret. |
| `POINT_ABUSE_SCANNER_ENABLED` | Optional, enabled by default (unless explicitly `false`) | Restricted config | points scanner | Whether to periodically scan for coordination signals when Redis is configured; CI Playwright sets it false explicitly to avoid background nondeterminism. |
| `POINT_ABUSE_SCAN_INTERVAL_SECONDS` | Optional, default 300, minimum 60 | Public ops config | points scanner | Scan interval; the current Redis lock TTL is 240 seconds. |
| `AI_SERVICE_URL` | Required by production 0041–0043 | Internal config | AI internal client/health | The FastAPI internal base URL, `http://ai:8000` in production; must never point at the public internet. |
| `AI_CALLBACK_BASE_URL` | Required in production | Internal config | generation/grading processor | The internal API base URL for the worker's progress/usage/checkpoint/complete/fail callbacks, `http://api:3000/api` in production. |
| `AI_INTERNAL_TOKEN` | Required in production | **Top secret** | Nest/FastAPI internal authentication | A separate 32-byte hex value identical on both ends; must not equal the Redis/HMAC/provider key and never enters the Web app/logs. |
| `FEATURE_MATERIAL_AI` | Install default false; currently true in production | Public config | Materials AI API/Web | Master switch; keep it false after deployment install, and turn it on only after readiness/canary/real gates pass. |
| `FEATURE_MATERIAL_AI_LUNA` | Install/rollback default false | Public config | Materials AI API/Web | Separate switch for `luna_native_file_v1`; only turned on after both the live ZDR catalog and the real native-file gate prove GPT-6 Luna's Azure ZDR endpoint is usable; does not affect the explicit old pipeline. |
| `MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS` | Candidate, `pdf,png` | Restricted config | API capabilities/create + AI worker validation | Allowlist of Luna native-file extensions that passed real per-format gates; the API and worker must match, and unverified formats must never be added just "to make them selectable in the UI". |
| `MATERIAL_AI_LUNA_DISABLED_REASON_CODE` | `AI_LUNA_DISABLED`; the production gate may set `OPENROUTER_ZDR_UNAVAILABLE` | Public ops config | Materials AI capabilities/create | The stable reason given to the frontend when the sub-switch is off; only these two values are accepted, clients cannot set it, and it does not replace the feature flag. |
| `FEATURE_MATERIAL_AI_OX_ALPHA` and `MATERIAL_AI_OX_ALPHA_*` | Retired (0056–0057) | — | — | Install, activation, and rollback scripts only strip the old keys and no longer write them; the app no longer reads them. |
| `MATERIAL_AI_MONTHLY_BUDGET_USD` | Optional, 20 | Restricted config | AI processor | Stops new calls once successful provider usage cost reaches the global monthly budget. |
| `MATERIAL_AI_GENERATION_MAX_COST_USD` | Optional, 0.50 | Restricted config | generation processor | Hard cost gate per generation; over the limit, the result is not saved and the user's quota reservation is released. |
| `MATERIAL_AI_GRADING_MAX_COST_USD` | Optional, 0.05 | Restricted config | grading processor | Hard cost gate per subjective grading run. |
| `MATERIAL_AI_RESUME_TTL_SECONDS` | **0046 candidate**, 86400 | Restricted config | API/AI worker | Seconds to keep retries/checkpoints/the local recovery directory; allows 300–604800, and the API and worker must match. |
| `NODE_ENV` | Deployment config | Public config | Node/Nest, Courses flags | With `production`, unset Courses/sharing/market flags default to off; outside production the first three default to on, and speech always defaults to off. |

### 3.1 Courses, market, Azure Speech, and OpenRouter

These variables may only enter the API runtime environment and must not use `VITE_*`. The production `/opt/nalanda/.env` is maintained by operations; the existing Supabase/Azure/Courses values are not rebuilt by the workflow. The deployment step added with the 0019–0020 release only atomically updates OpenRouter-related keys through standard input and keeps the file at mode 600 without printing secrets; on 2026-07-28 this path completed the real gate and production activation.

| Variable | Status/default | Sensitivity | Purpose |
|---|---|---|---|
| `PUBLIC_ORIGIN` | Currently required; locally `http://localhost:5173` | Public config | Builds course share URLs; production should be the canonical HTTPS origin with no trailing `/`. |
| `CORS_ALLOWED_ORIGINS` | Optional, defaults to `PUBLIC_ORIGIN` | Public config | Comma-separated browser CORS allowlist; when both are missing in production, no CORS permission is sent, and the same-origin nginx path still works. |
| `FEATURE_LEARNING_COURSES_ENABLED` | Flag; production default false | Public config | Courses master switch; off returns 503. |
| `FEATURE_COURSE_SHARING_ENABLED` | Flag; production default false | Public config | Creating/reading/cloning public shares; off disguises as 404. |
| `FEATURE_COURSE_MARKET_ENABLED` | Flag; production default false | Public config | Course Market, publishing, cloning, reporting/moderation; off disguises as 404. |
| `FEATURE_PRONUNCIATION_ENABLED` | Flag; default false in every environment | Public config | Azure TTS/scoring entry points; callable only when explicitly true. |
| `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED` | Flag; production default false; currently true in production | Public config | Durable audio queue, manifest, next-five-word prefetch, and whole-unit offline audio; requires Courses/Pronunciation to be on too. |
| `FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED` | Flag; production default false; currently true in production | Public config | The optional semantic translation pre-test in the spelling stage; when off, start requests requiring `translationFirst=true` return 503, while ordinary spelling and the time limit are unaffected. |
| `AZURE_SPEECH_CIRCUIT_OPEN` | Optional, default false | Restricted config | Emergency circuit breaker; when true, speech returns 503 everywhere without affecting text learning. |
| `AZURE_SPEECH_KEY` | Required when speech is enabled | **Top secret** | Azure Speech subscription key, only in the API container. |
| `AZURE_SPEECH_REGION` | Required when speech is enabled | Restricted config | Azure region, also forming the TTS/STT endpoint. |
| `AZURE_SPEECH_VOICE` | Optional, `en-US-JennyNeural` | Public config | en-US TTS voice name. |
| `AZURE_SPEECH_TIMEOUT_MS` | Optional, 10,000 | Public config | Hard timeout per Azure TTS/scoring call; limited to 1,000–60,000 ms in the implementation, and a timeout degrades without recording a learning error. |
| `AZURE_SPEECH_PRONUNCIATION_PASS_SCORE` | Optional, 70 | Public product config | The overall `PronScore` pass mark, allowed 1–100; production's recognition stage and, since 0029, the pronunciation exam use it to judge each question, but the overall unit exam pass rate is still decided independently by the user-chosen `examPassPercent` (default 90). The API must return the actual value to the UI. |
| `AZURE_SPEECH_ASSESSMENTS_PER_MINUTE` | Optional, 30 | Public config | Durable per-user scoring limit per minute. |
| `AZURE_SPEECH_ASSESSMENTS_PER_DAY` | Optional, 300 | Public config | Daily scoring limit by the local date in the user's IANA time zone. |
| `AZURE_SPEECH_MONTHLY_BUDGET_MICRO_USD` | Optional, 5,000,000 | Restricted config | Monthly estimated budget shared by all API instances, in micro-USD. |
| `AZURE_SPEECH_TTS_REQUESTS_PER_MINUTE` | Optional, 20 | Restricted config | Global per-minute cap on TTS generation reservations; shared in the database across all API replicas. |
| `AZURE_SPEECH_TTS_MONTHLY_CHAR_LIMIT` | Optional, 500,000 | Restricted config | Global monthly TTS character reservation cap; cache reuse across users does not count characters twice. |
| `AZURE_SPEECH_TTS_MICRO_USD_PER_1000_CHARS` | Optional, 16,000 | Restricted config | Estimated TTS cost per thousand characters, used for budget reservations, not a billing fact. |
| `AZURE_SPEECH_ASSESSMENT_MICRO_USD` | Optional, 2,500 | Restricted config | Estimated cost per scoring call. |
| `LEARNING_AUDIO_PREWARM_INTERVAL_MS` | Optional, 3,100 | Restricted config | Minimum interval between two Azure TTS starts by the worker; the implementation rejects values below 3,100 ms, combined by default with a single global lease. |
| `LEARNING_AUDIO_SYNTHESIS_VERSION` | Optional, `1` | Restricted config | Part of the global SHA-256 cache key; increment it when changing voice/SSML/post-processing semantics to rebuild safely, never overwriting old keys in place. |
| `AZURE_SPEECH_FAKE` | **Tests only**, default false | Test config | Produces fixed WAVs/scores; every shared, staging provider smoke, or production environment must leave it unset/false, and the API explicitly rejects true when `NODE_ENV=production`. |
| `OPENROUTER_API_KEY` | Required when the translation pre-test, voice input, or Materials AI is enabled | **Top secret** | Server capabilities reuse the same secret; the Materials AI worker gets a copy in the isolated `.ai.env`. Must never enter the Web bundle, database, logs, or commits. |
| `OPENROUTER_MODEL` | Optional, `nvidia/nemotron-3-super-120b-a12b:free` | Restricted config | The semantic judging model; requests are fixed to Nvidia-only, no fallback, reasoning off, and the production gate verifies the model, routing, and schema. The free endpoint does not promise deny collection. |
| `OPENROUTER_BASE_URL` | Optional, `https://openrouter.ai/api/v1` | Public config | OpenRouter API base URL; only read by the API. |
| `OPENROUTER_TIMEOUT_MS` | Optional, 12,000 | Public config | Hard timeout per judgement, limited to 1,000–30,000 ms in the implementation; a timeout releases the database lease without recording a learning error. |
| `OPENROUTER_SMOKE_MAX_ATTEMPTS` | Optional, 5 | Restricted release config | Only controls the real translation judging gate of protected releases, limited to 1–6 attempts; does not change user request retries or product quotas. Only network errors and 408/425/429/5xx are retryable, and persistent failure still blocks the release. |
| `OPENROUTER_SMOKE_ATTEMPT_TIMEOUT_MS` | Optional, 30000 | Restricted release config | Timeout per request (including reading the response body) of the real translation judging release gate, limited to 5–60 seconds; separate from the interactive API's `OPENROUTER_TIMEOUT_MS`. |
| `OPENROUTER_SMOKE_TOTAL_BUDGET_MS` | Optional, 180000 | Restricted release config | Hard wall-clock budget shared by every attempt and backoff of the real translation judging release gate, at least the per-attempt timeout and at most 300 seconds; fails closed when exhausted. |
| `OPENROUTER_SMOKE_RETRY_BASE_MS` | Optional, 5,000 | Restricted release config | Starting point of the real translation gate's exponential backoff, limited to 1,000–30,000 ms. |
| `OPENROUTER_SMOKE_RETRY_MAX_MS` | Optional, 60,000 | Restricted release config | Upper limit of a single gate backoff and of an acceptable `Retry-After`, limited to 120,000 ms; fails closed when the provider asks to wait longer. |
| `OPENROUTER_ASSESSMENTS_PER_MINUTE` | Optional, 20 | Restricted config | Per-user one-minute cap on real provider judgements; deterministic exact matches, UUID idempotent replays, and lease-only claims are not counted. |
| `OPENROUTER_ASSESSMENTS_PER_DAY` | Optional, 500 | Restricted config | Per-user rolling 24-hour cap on real provider judgements; when reached, the response includes the estimated seconds until recovery. |
| `OPENROUTER_STT_MODEL` | Optional, `fish-audio/transcribe-1` | Restricted config | The STT model used only for pre-spelling translation voice input; clients cannot override it. |
| `OPENROUTER_STT_LANGUAGE` | Optional, `zh` | Public product config | STT ISO language hint, recognizing Chinese by default; the current UI offers no language choice. |
| `OPENROUTER_STT_TIMEOUT_MS` | Optional, 15,000 | Public config | Hard timeout per STT call, limited to 1,000–30,000 ms in the implementation; a failure never submits a translation answer. |
| `OPENROUTER_STT_REQUESTS_PER_MINUTE` | Optional, 20 | Restricted config | Durable per-user STT per-minute cap. |
| `OPENROUTER_STT_REQUESTS_PER_DAY` | Optional, 300 | Restricted config | Per-user STT daily cap computed by the local date in the Profile IANA time zone. |
| `OPENROUTER_STT_MONTHLY_BUDGET_MICRO_USD` | Optional, 5,000,000 | Restricted config | Global monthly estimated budget for `translation_stt` only; not mixed with the Azure budget. |
| `OPENROUTER_STT_MICRO_USD_PER_SECOND` | Optional, 100 | Restricted config | Budget reservation unit price converted from the current `$0.0001/second`; only a protective estimate that must be re-checked when the provider's price changes. |
| `OPENROUTER_FAKE` | **Tests only**, default false | Test config | A deterministic exact-match adapter for automation; production processes explicitly reject true, and it is not real provider evidence. |
| `COURSE_MARKET_DAILY_PUBLISH_LIMIT` | Optional, 5 | Public config | Per-user publishing limit per local date. |
| `COURSE_REPORT_DAILY_LIMIT` | Optional, 20 | Public config | Per-user reporting limit per local date. |
| `COURSE_REPORT_ALERT_THRESHOLD` | Optional, 3 | Restricted config | Writes a structured alert when open reports on the same target reach this value; never delists automatically. |
| `COURSE_MARKET_ADMIN_USER_IDS` | Default empty | **Sensitive authorization config** | Comma-separated Supabase user UUIDs; authorizes hiding/restoring/withdrawing market versions and should be covered by approval and rotation. |
| `MODERATION_ADMIN_USER_IDS` | Default empty | **Sensitive authorization config** | Administrator UUIDs for points signal/reward moderation; the new value takes precedence, and during the compatibility period it falls back to the Course Market allowlist only when empty. |

Every `*_LIMIT`, `*_BUDGET*`, `*_COST*`, timeout, and prewarm interval must be a finite positive number, and counts, characters, milliseconds, and micro-USD budgets must be safe integers; `AZURE_SPEECH_PRONUNCIATION_PASS_SCORE` must also be within 1–100, and the synthesis version only accepts 1–32 alphanumeric/dot/underscore/hyphen characters. When missing, the table's default applies; an explicitly invalid value makes the API fail closed with `503 SERVER_MISCONFIG`, rather than passing `NaN/null` to the database and bypassing quotas or retry rules.

`OPENROUTER_ASSESSMENTS_PER_DAY=500` is the semantic grading default; STT separately uses 20/minute, 300/local day, and 5,000,000 micro-USD/month. Changing this document or `.env.example` does not rewrite a running server; on 2026-08-04, 0037–0038 atomically wrote the STT non-secret configuration through the protected install script and reused the existing secret. Later releases/rotations must still separately check the effective values in the container without printing the key.

## 4. FastAPI Materials AI runtime variables (production 0041–0043 + the 0046–0051 candidate)

Template: `apps/ai/.env.example`. Locally, use a process-private environment; production generates a mode-600 `/opt/nalanda/.ai.env` with a protected script. The worker **never** receives service-role, Redis, Azure, JWT, or Web keys.

| Variable | Status/default | Sensitivity | Purpose |
|---|---|---|---|
| `NODE_ENV` | Required in production | Public config | Production explicitly rejects fake-provider readiness. |
| `AI_INTERNAL_TOKEN` | Required | **Top secret** | The same internal request/callback authentication token as the API. |
| `OPENROUTER_API_KEY` | Required | **Top secret** | Server-side DeepSeek/MiMo/Luna calls; never written to the database, logs, responses, or the Web app. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Public config | Fixed provider base URL. |
| `SUPABASE_URL` | Required | Public config | Only used to restrict allowed signed-URL download hosts to this project; the worker has no service-role. |
| `MATERIAL_AI_ALLOWED_STORAGE_HOSTS` | Optional addition | Restricted config | Comma-separated extra allowed hosts; usually empty in production, and broad wildcards are forbidden. |
| `PUBLIC_APP_URL` | `https://nalanda.online` | Public config | The OpenRouter `HTTP-Referer` identifier. |
| `MATERIAL_AI_FAKE_PROVIDER` | false | Test config | A deterministic adapter for pytest/Playwright; true in production makes readiness fail. |
| `MATERIAL_AI_TEMP_ROOT` | `/tmp/nalanda-material-ai` | Restricted path | Root of the 0700 job temporary directories; briefly stores the usage spool and validated resume checkpoints; cleared on success/failure/cancellation/deletion or TTL, and the spool must not be deleted early while usage is not yet recorded. |
| `MATERIAL_AI_TEMP_MIN_FREE_BYTES` | 536870912 | Restricted config | Fails closed when free space drops below 512 MiB during creation and parsing. |
| `MATERIAL_AI_JOB_TEMP_LIMIT_BYTES` | 1073741824 | Restricted config | 1 GiB hard cap on temporary space per job. |
| `MATERIAL_AI_MAX_CHARACTERS` | 400000 | Restricted config | Text limit for the normalized DocumentIR. |
| `MATERIAL_AI_LIBREOFFICE_TIMEOUT_SECONDS` | 120 | Restricted config | Hard timeout for full low-priority DOCX/PPTX rendering. |
| `MATERIAL_AI_PROVIDER_TIMEOUT_SECONDS` | 180 | Restricted config | Shared wall-clock limit for one structured OpenRouter operation (including every retry and backoff); Nest only waits for the short 202 acceptance, not the whole job. |
| `MATERIAL_AI_JOB_TIMEOUT_SECONDS` | **Candidate**, 1200 | Restricted config | Total execution budget for one Materials generation/knowledge graph job; on expiry it saves the existing durable checkpoint, releases the run slot, and allows resuming within the window. |
| `MATERIAL_AI_GRADING_TIMEOUT_SECONDS` | **Candidate**, 240 | Restricted config | Total execution budget for one batch of subjective grading; keeps background jobs from occupying the single-concurrency worker indefinitely. |
| `MATERIAL_AI_PROVIDER_MAX_ATTEMPTS` | 4 | Restricted config | Maximum bounded attempts for a request to the same fixed model, limited to 1–10; only network errors and 408/429/502/503/504 are retryable. |
| `MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS` | 2 | Restricted config | Starting point of the exponential backoff, limited to 0–60 seconds; does not change the model, ZDR, or the same-model provider failover policy. |
| `MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS` | 60 | Restricted config | Upper limit of a single backoff, limited to 0–300 seconds; a numeric `Retry-After` takes precedence and requests are never sent early; beyond the limit the job fails and releases its allowance. |
| `MATERIAL_AI_GENERATION_MAX_TOKENS` | 30000 | Cost config | Maximum completion tokens for test-paper generation/one repair. |
| `MATERIAL_AI_KNOWLEDGE_MAX_TOKENS` | **Candidate**, 30000 | Cost config | Maximum completion tokens for knowledge-graph generation/repair, a cap shared by the pipelines. |
| `MATERIAL_AI_RESUME_TTL_SECONDS` | **Candidate**, 86400 | Restricted config | Retention period for worker orphans and the local checkpoint/spool; must match the API. |

Model IDs are not user variables: the old pipeline is fixed to `deepseek/deepseek-v4-flash-0731` and `xiaomi/mimo-v2.5`; Luna is fixed to `openai/gpt-6-luna` locked to `provider.only=["azure"]`, with fallback forbidden, ZDR/deny data collection/strict schema/no tools required, and the response's real upstream checked; on a routing mismatch the artifact is rejected even though usage was recorded. Courses translation judging is fixed to the free `nvidia/nemotron-3-super-120b-a12b:free` + Nvidia-only. The old pipeline's same-model provider failover semantics are unchanged. Any model or routing change needs an ADR, evaluation, and cost and privacy review.

## 5. Database migration ops variables

Consumers: the Supabase CLI, the release recovery-point scripts, and the emergency-only `scripts/db-push.mjs`. They should only be injected temporarily into a controlled terminal or a GitHub protected environment, never written into an application `.env`.

| Variable | Status | Sensitivity | Purpose and notes |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Required to run the scripts | **Top secret** | A Supabase account Personal Access Token with Management API access; use a least-privilege account and revoke immediately on departure/leak. |
| `SUPABASE_PROJECT_REF` | Required | Project identifier | The target project ref. The scripts no longer have a default; CI also cross-checks it against `VITE_SUPABASE_URL`. |
| `SUPABASE_DB_PASSWORD` | Required for remote CLI operations | **Top secret** | The database password for `supabase link/db dump/db push/db lint`; only kept in the `production-database` environment. |
| `ALLOW_LEGACY_DB_PUSH` | Explicit switch for the legacy script | Public config | Only the value `YES` allows `db-push.mjs`, which does not maintain history; normal CI must never use it. |
| `BACKUP_ENCRYPTION_KEY` | Required by local backup/restore scripts | **Top secret** | Encrypts/verifies release archives; the corresponding CI secret is named `DB_BACKUP_ENCRYPTION_KEY`. |
| `BACKUP_OUTPUT` | Required to create a recovery point | Restricted path | Encrypted output path; must end with `.tar.gz.enc`. |
| `BACKUP_ARCHIVE` | Required to verify/restore | Restricted path | The downloaded encrypted database archive. |
| `RESTORE_DATABASE_URL` | Required for isolated restore | **Top secret** | May only point to a newly created blank project; the restore script rejects the source project. |
| `RESTORE_TARGET_PROJECT_REF` / `RESTORE_CONFIRM_PROJECT_REF` | Required for isolated restore | Project identifier | The two refs must be identical, and the connection string must contain that ref. |
| `ALLOW_ISOLATED_RESTORE` | Isolated restore switch | Public config | Must be explicitly `YES`; in-place production restores are not allowed. |
| `DATABASE_URL` | Ops convention, not read by the app | **Top secret** | A temporary PostgreSQL connection string used in this documentation's backup/restore examples; not a current application runtime variable. Prefer injecting it through a password file or secret to keep it out of shell history. |

## 6. Current production CI/CD variables

Consumer: `.github/workflows/deploy.yml`. They are stored in GitHub Actions Secrets, not in repository files.

| Variable | Status | Sensitivity | Purpose |
|---|---|---|---|
| `SERVER_HOST` | Currently required | Restricted config | SSH/scp target host. |
| `SERVER_USER` | Currently required | Restricted config | Deployment account. The docs currently describe it as `root`; the target is to migrate to a least-privilege deploy user. |
| `SERVER_SSH_KEY` | Currently required | **Top secret** | The CI-only SSH private key; its public key is in the server's `authorized_keys`. |
| `SERVER_SSH_KNOWN_HOSTS` | Currently required | Restricted config | The pre-verified server SSH host key; CI must never use runtime `ssh-keyscan` to establish first trust. |
| `VITE_SUPABASE_URL` | Currently required | Public config | Injected at Web build time. |
| `VITE_SUPABASE_ANON_KEY` | Currently required | Public credential | Injected at Web build time. |
| `SUPABASE_ACCESS_TOKEN` | Required when there are new migrations | **Top secret** | The Supabase CLI release identity, only kept in the `production-database` environment. |
| `SUPABASE_DB_PASSWORD` | Required when there are new migrations | **Top secret** | Remote dry-run/dump/push/lint. |
| `SUPABASE_PROJECT_REF` | Required when there are new migrations | Project identifier | Cross-checked against the production Web URL. |
| `DB_BACKUP_ENCRYPTION_KEY` | Required when there are new migrations | **Top secret** | Encrypts the release recovery artifact kept for 14 days; a copy must be stored offline. |
| `OPENROUTER_API_KEY` | Required when the translation pre-test is enabled | **Top secret** | A GitHub `production` environment secret; the deploy job only hands it to the server install script through SSH standard input, then runs the real provider gate. Must not be an ordinary repository variable. |
| `AI_INTERNAL_TOKEN` | Required for the 0041–0043 release | **Top secret** | A separate 32-byte hex value; the deploy only writes it atomically through SSH stdin into the two mode-600 API/AI env files, never echoing it. |
| `REDIS_PASSWORD` | Required for the 0039–0040 phase-one release | **Top secret** | A GitHub `production` environment secret; a separate 32-byte hex value written through SSH stdin into the server's mode-600 `.redis.env` and the API `REDIS_URL`, never printed. |
| `RATE_LIMIT_HMAC_SECRET` | Required for the 0039–0040 phase-one release | **Top secret** | A GitHub `production` environment secret; a separate 32-byte hex value installed atomically through SSH stdin; must not equal the Redis password. |
| `PUBLIC_ORIGIN` | Non-secret workflow env | Public config | The canonical origin for the public smoke test; the API's share URLs are still read from the server `.env`, and the two must match. |

The server's `/opt/nalanda/.env` needs at least Supabase, `REDIS_URL`, and the HMAC secret; `/opt/nalanda/.redis.env` contains only the Redis password and must not get Supabase/Azure/OpenRouter/HMAC. Both files are mode 600. CI does not download them; the install scripts keep other API lines, atomically replace their own variables, and print no secrets to stdout. The API image Git SHA lives in the non-secret `.deploy.env`.

## 7. Supabase RLS E2E variables

Consumer: `apps/web/tests/rls.e2e.test.ts`. These variables may only point to a disposable dedicated test project; the default `pnpm test` does not enable external E2E.

| Variable | Status | Sensitivity | Purpose and protection |
|---|---|---|---|
| `RUN_SUPABASE_RLS_E2E` | Explicit switch | Public config | Must be `1` to run; `pnpm test:rls` sets it. |
| `SUPABASE_URL` | Required for E2E | Public config | The dedicated test project URL; never production. |
| `SUPABASE_ANON_KEY` | Required for E2E | Public credential | Signs in as users A/B to verify RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required for E2E | **Top secret** | Creates/deletes test users and cleans up Storage; only injected into the Node test process. |
| `SUPABASE_RLS_E2E_CONFIRM_REF` | Required for E2E | Project identifier | Must exactly equal the project ref in the URL hostname, as a second confirmation against mistakes. |
| `RUN_REDIS_E2E` | Real Redis integration switch | Public config | Must be `true` to run the Lua atomic window/expiry/token lock tests; ordinary local `pnpm test` may skip them, and CI must enable them. |
| `REDIS_URL`, `RATE_LIMIT_HMAC_SECRET` | Required for Redis E2E | Local test secrets | May only point to a test Redis DB; CI uses a separate localhost DB and a fixed non-production HMAC. |

See the [testing guide](./TESTING.md) for the full run and cleanup flow. The confirmation ref only guards against slips and does not authorize running against production.

Playwright CI also injects `SUPABASE_JWT_SECRET` and the two `VITE_SUPABASE_*` values from local `supabase status -o env`, explicitly turns on the Courses/sharing/market/pronunciation/audio prewarm/translation pre-test flags, and sets `AZURE_SPEECH_FAKE=true`, `OPENROUTER_FAKE=true`, and a local `PUBLIC_ORIGIN`. These are all one-off job environments and must not be copied into a production provider verification configuration.

## 8. `infra/hybrid-2g` target deployment variables

Template: `infra/hybrid-2g/.env.example`. This directory is a target topology, not the current actual orchestration of `nalanda.online`.

| Variable | Current usage | Sensitivity | Notes |
|---|---|---|---|
| `DOMAIN` | Used by the Caddyfile | Public config | Caddy site domain. |
| `ACME_EMAIL` | Used by the Caddyfile | Personal/restricted config | ACME account contact email. |
| `SUPABASE_URL` | Used by the API | Public config | Same as above. |
| `SUPABASE_ANON_KEY` | Not read by current service code | Public credential | Without a `VITE_` prefix it does not enter the Web static bundle automatically; if the hybrid Web needs it, the corresponding `VITE_*` must still be injected at build time. |
| `SUPABASE_SERVICE_ROLE_KEY` | Used by the API | **Top secret** | Same as above. |
| `SUPABASE_JWT_SECRET` | Optionally read by the API | **Top secret** | Same as above. |
| `ANTHROPIC_API_KEY` | Historical variable; not read by current business code | **Top secret** | Should no longer be configured; delete the old secret once migration is complete. |
| `STRIPE_SECRET_KEY` | Target placeholder | **Top secret** | No payment module and no consumer today. |
| `STRIPE_WEBHOOK_SECRET` | Target placeholder | **Top secret** | No webhook endpoint and no consumer today; the Caddy comment is not an endpoint implementation. |
| `REDIS_URL` | Read by API rate limiting/health/scanner | Internal config | The hybrid example has no password and does not meet the production baseline; if reused, a password and a separate HMAC must be added. BullMQ is still not wired in there. |
| `AI_SERVICE_URL` | Read by API health, not connected for business | Internal config | Overridden to `http://ai:8000` in the compose file. |
| `PUBLIC_ORIGIN`, `CORS_ALLOWED_ORIGINS`, `FEATURE_*` | Read by the API | Public config | Courses share URLs, the browser CORS allowlist, and staged switches; the hybrid example defaults every production flag to false. |
| `AZURE_SPEECH_KEY` | Read by the API when speech is enabled | **Top secret** | Only injected into the API; must not be injected into the Web app/AI. |
| `AZURE_SPEECH_REGION/VOICE/TIMEOUT_MS/PRONUNCIATION_PASS_SCORE/CIRCUIT_OPEN` | Read by the API | Restricted config | Azure endpoint, voice, per-call hard timeout, overall score pass mark, and emergency circuit breaker. |
| `AZURE_SPEECH_*LIMIT/BUDGET/COST*` | Read by the API | Restricted config | Durable quotas and cost estimates; see 3.1 for the actual variable names. |
| `COURSE_MARKET_*`, `COURSE_REPORT_*` | Read by the API | Admin IDs are sensitive authorization; the rest are restricted | Market publishing, reporting, and administrator controls. |

## 9. Where configuration lives

| Environment | Web public config | API/AI server secrets | Temporary ops secrets |
|---|---|---|---|
| Local | `apps/web/.env.local` | `apps/api/.env`; the AI process environment | The current shell/a secure password file |
| GitHub Actions | Actions Secrets injected into the Web build | API runtime keys stay only on the server; DB release keys live in the protected environment | `SERVER_SSH_KEY`, the verified host key, Supabase CLI keys, the backup encryption key |
| Current production/Materials AI | Compiled into the `/opt/nalanda/web` static bundle | `/opt/nalanda/.env` + the isolated `/opt/nalanda/.redis.env` + `/opt/nalanda/.ai.env`. All `0600`, and the AI env has no service-role/Redis | Injected temporarily only during maintenance windows, never logged |
| Hybrid target | Inject `VITE_*` separately when building the Web app | `infra/hybrid-2g/.env` | Injected temporarily only during maintenance windows |

## 10. Checklist for a new variable

1. Define the consumer, stage (build/runtime/operation), default behavior, and whether it is required.
2. Decide whether it enters the browser; no high-privilege credential may ever enter the client.
3. Update the corresponding `.env.example` with placeholder values only.
4. Update this matrix, the [local development guide](./LOCAL_DEVELOPMENT.md), and [secret rotation](../operations/SECRET_ROTATION.md).
5. Add startup validation or an explicit error for missing/invalid configuration; Supabase and Redis health must actually probe and never treat "the variable exists" as readiness.
6. After updating CI/compose, verify the variable is actually read by the target process, avoiding "the configuration exists but the code doesn't use it".
7. When removing a variable, first confirm production, GitHub, personal environments, and historical deployments no longer depend on it, then revoke the corresponding secret.
