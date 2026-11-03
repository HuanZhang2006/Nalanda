# 03 · Deployment architecture and CI/CD

> **About this document**
> - **Contents**: Records the current `nalanda.online` repository deployment topology, CI steps, server constraints, and historical incidents.
> - **Purpose**: The implementation retrospective of the existing production deployment; executable release/rollback procedures are defined by the operations runbooks.
> - **When to update**: When the workflow, server, domain/TLS, compose, health checks, deployment identity, or rollback approach changes.
> - **Status baseline**: 2026-08-26. The production database is at 0055; the immutable application is still the earlier stable release, and the Materials AI/Luna/Ox flags stay off. PR #78's Ox Alpha JSON Object fix is merged, but main run `32931681321` found at the real DocumentIR DOCX gate that the structural repair lacked the source text and that new semantic defects after the structural step had no repair stage, so the candidate automatically restored the previous Web/API before cutover. The current Unreleased `exam-generate.v4` fixes this chain; a database apply, PR merge, local tests, or partially passing real gates must never be presented as the application going live.

> Goal: deploy the app to our own server, serve it at the new domain `nalanda.online` without affecting the many existing projects on the server, and get "push to main deploys automatically".

## 1. Server situation (source of the constraints)

A shared production machine (Ubuntu 24, **only about 300 MB of free memory** / 1.9 GB total + 2 GB swap) already runs lobechat, sub2api, teamspeak, and several postgres/redis instances; **nginx owns 80/443**, and certbot manages certificates such as `uofa.ink`.

This gives three iron rules:
1. **Never build on the server**: Vite/Nest builds eat memory and may OOM and take down other services → all builds run in GitHub Actions, and the server only "pulls + runs".
2. **Reuse the existing nginx**: don't start a separate Caddy competing for 80/443; add an **independent server block** for nalanda that reverse-proxies to a high local port.
3. **Strong isolation**: independent server_name / independent certificate / containers bound only to `127.0.0.1` / an independent compose project, and never change existing sites' configuration.

## 2. Hybrid deployment model

```
Data layer (hosted, 0 local memory): Supabase (Postgres + Auth + Storage + Realtime)
Application layer (self-hosted on the server):
  /opt/nalanda/
    ├─ docker compose: api container (127.0.0.1:8411 → container:3000, mem_limit 256m)
    ├─ Redis (compose private network only, password, AOF everysec, noeviction, no host port)
    ├─ FastAPI AI (internal network, 640m RAM/896m memswap, 0.75 CPU, 128 pids)
    ├─ web/   frontend static build (served directly by the host nginx)
    └─ .env   backend secrets (held only on the server)
Host nginx: nalanda.online → static + /api reverse proxy to 127.0.0.1:8411 (certbot manages TLS)
External: Azure Speech (production), OpenRouter Courses (production) and Materials DeepSeek/MiMo (production); Luna/OpenAI (candidate), Stripe (planned)
```

> Production 0043 uses "web static + api + private Redis + internal FastAPI AI". Redis is the dependency for sign-up/write rate limiting, abuse aggregation, scan locks, and BullMQ delivery containing only durable Postgres job UUIDs; Materials AI uses its own env/resource cgroup, and the AI container has no host port.

## 3. nginx integration (the key to isolation)

`/etc/nginx/sites-available/nalanda` (symlinked into `sites-enabled/`):

```nginx
server {
    listen 80; listen [::]:80;
    server_name nalanda.online;
    root /opt/nalanda/web; index index.html;
    location /api/ {                       # NestJS global prefix /api
        client_max_body_size 10m;           # a valid 2,000-word course JSON
        proxy_pass http://127.0.0.1:8411;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / { try_files $uri $uri/ /index.html; }  # SPA fallback
}
```

- Only **add files** and never change existing sites; after every passing `nginx -t`, `systemctl reload` (not restart).
- The API/Nest JSON and nginx both use a 10 MB limit so nginx's default 1 MB doesn't reject large valid word lists early; read-aloud multipart is still limited separately by the API to 2 MB.
- TLS: `certbot --nginx -d nalanda.online` (DNS already points at this machine) adds 443 + the redirect automatically and renews automatically.

## 4. CI/CD pipeline

File: `.github/workflows/deploy.yml`. PRs to `main` only run quality/local Supabase gates without production secrets; a push to `main` releases the application when there are no new migrations, and stops after verification if there are new migrations. The database owner must first manually run the read-only `plan_database_migrations` on the corresponding `main` commit, review the history/dry-run, and then separately run `apply_database_migrations`; the application release only continues after the database release succeeds. The two switches can't both be selected; selecting neither only re-releases the application. Docs-only changes are handled by the docs workflow.

Step logic:
1. **Quality gate**: docs, lint/typecheck, Web/API Vitest, real Redis Lua/BullMQ, Python ruff/pytest, workspace build, and the AI Docker build.
2. **Database/browser gate**: automatically stages all of 0008+, runs 0007→latest and empty-database latest/lint; runs two-user RLS/Storage/points/Courses/Materials AI E2E and nginx/compose, and runs Courses and Materials→Notes→Exam Playwright with fake providers.
3. **Production migrations (only new migrations)**: only opened manually by the owner → environment/branch gate → history/dry-run → encrypted recovery point → `db push` → remote verification; a failure blocks the application.
4. **Build**: the Web build injects the public Supabase config; the API/AI images are both tagged with the same `<git-sha>`, and the server builds nothing.
5. **Disk/SSH**: uses pre-verified known_hosts; before upload it deletes half-finished artifacts of the same SHA and abandoned incoming items older than 24 hours, and only cleans up Nalanda images not referenced by any container and not part of the current `.deploy.env`. It blocks when free space is under 6 GiB, then uploads to `/opt/nalanda/incoming/<sha>/`; other projects' images are out of cleanup scope.
6. **Real provider/resource gates**: beyond the existing Azure/Courses/DeepSeek/MiMo gates, the Luna candidate uses fixed PDF/image and per-format samples to verify the OpenAI upstream, the PDF native parser, raw bytes, strict schema, injection rejection, cost, and cancellation cleanup; the Office canary continues to cover the old pipeline. Any failure keeps the Luna sub-switch off.
7. **Activation**: installs the Redis/HMAC/internal token and the isolated `.ai.env`, first keeps `FEATURE_MATERIAL_AI_LUNA=false` to verify readiness/the old pipeline; only after real Luna and private signed-in smokes pass is the sub-switch turned on separately, then the Web is switched and the full public chain is checked.
8. **Application rollback**: any post-activation smoke failure restores the previous Web symlink and immutable API image; Redis/AI are restored separately on a best-effort basis, and the previous API must be started with `--no-deps` and verified independently, so an unhealthy optional AI can't escalate into a public 502. Failed candidates are cleaned up by the EXIT trap and a fallback step; the database is never reversed automatically.

Markdown changes still don't trigger application deployments; the separate `docs` workflow runs the document opening-field and relative-link checks. Full coverage and RLS E2E commands are in the [testing guide](../guides/TESTING.md).

Why `docker save/load` instead of an image registry: no registry credentials need to be configured on the server and images are naturally private; the cost is transferring the image each time (acceptable). We can switch to GHCR + caching later.

### Secrets / key layering
- **Repository Actions Secrets (current actual location)**: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, `SERVER_SSH_KNOWN_HOSTS`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; the `production` environment uses these repository-level secrets in the deploy job. If they are later migrated to environment secrets, migrate the whole group at once and verify.
- **production-database environment**: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `DB_BACKUP_ENCRYPTION_KEY`, and `VITE_SUPABASE_URL` for cross-checking the ref.
- **Server `/opt/nalanda/.env`**: the Supabase secret, Courses/sharing/market/speech flags, `PUBLIC_ORIGIN`, and provider key/region/quota — only on the server, never in the Web build or the repository; the file mode is currently 600, the Courses, sharing, market, pronunciation, audio warm-up, and translation pre-test flags are on, and Azure/OpenRouter fake=false; protected steps only update the OpenRouter domain variables. TTS is limited to a default of 20 per minute, 500,000 characters per month, and a minimum 3.1-second interval, synthesis version 1.
- **Stage-one security secrets**: the `production` environment's `REDIS_PASSWORD` and `RATE_LIMIT_HMAC_SECRET` must be generated independently at random and installed atomically via stdin into the mode-600 `.redis.env` and the API `.env`; the Redis container only gets the password, not Supabase/provider/HMAC.
- **Materials AI secrets**: `OPENROUTER_API_KEY` and an independent 32-byte `AI_INTERNAL_TOKEN` are written atomically via stdin into the API/AI env; the AI env contains no service-role, Redis, Azure, or Web key. The master switch and the Luna sub-switch both default to false on install/rollback; the format allowlist only comes from real gates.
- CI logs in with an **independent deploy key**, not the root password.

`production-database` is restricted to `main` only, and the four required release secrets were configured on 2026-07-21. The current private-repository plan doesn't support required reviewers, so database releases may only be started manually by the owner in two separate plan/apply steps with review records kept; after upgrading the plan, the reviewer gate should be added back to the GitHub Environment.

## 5. One-time server bootstrap (done)

- Generate a CI-only ed25519 key, add the public key to the server's `authorized_keys`, and store the private key as a GitHub Secret.
- Create `/opt/nalanda/{web,.env,docker-compose.yml}` (`.env` mode 600).
- Write the nginx server block + symlink; `certbot --nginx -d nalanda.online`.
- Set the GitHub Secrets; the first push triggers the pipeline and completes the first deployment.

## 6. Incident log (most worth reviewing)

### (a) DNS resolution failure inside the container → sign-in 401
**Historical symptom**: at the time `/api/health` only looked at variables, so health was fine but `/api/me` kept returning 401 for real tokens; health now includes JWKS/PostgREST probes.
**Diagnosis**: `getaddrinfo EAI_AGAIN` inside the container (DNS failure), while raw TCP egress worked. The host uses `systemd-resolved` (`127.0.0.53`), and the container's embedded DNS can't forward to that loopback address → JWKS couldn't be fetched → verification fell back to HS256 → ES256 tokens failed → 401.
**Fix**: compose sets an explicit `dns: [1.1.1.1, 8.8.8.8]` on the api service; rebuilding the container restored it.
**Lesson**: containers on systemd-resolved hosts often need explicit DNS; for "health is fine but verification that depends on the internet fails", check container DNS/egress first.

If the host, the container, and an independent public resolver all return `NXDOMAIN` for the same Supabase hostname, it's not a Docker resolver configuration problem; first check in the Supabase console whether the project is paused/deleted or the URL is no longer valid. Readiness must never be downgraded back to "variables present means healthy" just to make the deploy green.

### (b) uofa.ink certificate renewal failure (ACMEv1 account)
**Symptom**: `certbot renew` reported "Account does not exist".
**Root cause**: uofa.ink's renewal configuration was bound to a **deactivated ACMEv1 account** (Let's Encrypt retired v1 long ago).
**Fix**: changed `account` in `renewal/uofa.ink.conf` to the current valid v2 account (the same one as nalanda/lobe), and `certbot renew --force-renewal` succeeded; only its own configuration was touched.

### (c) Memory red line
The server has very little free memory, so all builds run in CI. The API gets 256m; production AI gets 640m/896m memswap, 0.75 CPU, 128 pids, and single concurrency; Redis gets 96m/48m maxmemory noeviction. If a near-limit canary shows a kernel OOM, a neighboring site failing, or sustained unacceptable paging, turn off Materials AI and stop the release.

## 7. Historical go-live verification

The following are manual measurements from when this deployment approach first landed; they are not continuous monitoring or proof of current availability:

- `https://nalanda.online` HTTPS 200, HTTP→HTTPS 301; existing sites (sub2api/lobe) were unaffected.
- A real sign-in token against `/api/me` → 200; CI run = success; self-checks passed.
- Docs commits (`docs/**`, `*.md`) no longer trigger redeployment thanks to `paths-ignore`.

### 2026-07-22 Courses production release

- main SHA: `53d0eabf767725b6e9ca83367c0e17c47a479eca`.
- [Read-only migration plan](https://github.com/1590703336/Nalanda/actions/runs/29889201210): local/remote history matched item by item from 0001 to 0013, and `db push --dry-run` reported `Remote database is up to date`.
- [Protected apply/deploy](https://github.com/1590703336/Nalanda/actions/runs/29889669272): created and kept a new encrypted recovery point, verified remote history/functions, built and started the final slimmed API image, then activated the immutable Web/API release.
- Real Azure Speech gate: production host mode-600 `.env`, region `japaneast`, voice `en-US-JennyNeural`, fake=false; a fixture with no personal data produced an MP3 of 10,656 bytes, an assessment WAV of 55,084 bytes, successful recognition, accuracy 98, pronunciation 98.8, and 4 phonemes.
- Activation result: `/opt/nalanda/releases/53d0eabf767725b6e9ca83367c0e17c47a479eca-29889669272-1/web` and `nalanda-api:53d0eabf767725b6e9ca83367c0e17c47a479eca`; the API container was running.
- Independent public re-check: `/api/health` returned `status=ok`, `deps.supabase=ok`; `/api/me` and unauthenticated private Courses were both 401; the public Course Market was 200; the home page contained the React root.
- The production nginx site has `client_max_body_size 10m` set and passed `nginx -t`. Temporary environment copies and smoke scripts produced during manual troubleshooting were securely erased.
- Capabilities explicitly not shipped in this release: PDF/DOC/DOCX/JSON/Markdown/HTML/image OCR/AI import, the other three course categories, the FastAPI generation loop, credits/VIP/payments.

### 2026-07-22 Courses visuals, text import, and scrolling fix

- main SHA: `d31af905b44ca4df39c70e271a7c7a51612916e3`; includes the earlier convergence of Courses/Course Market onto shared design tokens and the Chinese/English locale, plus this change's whole multi-unit import, bulk append per unit in the editor, separate translation fields, and the shared scrolling fix.
- [PR #14 quality/database/browser run](https://github.com/1590703336/Nalanda/actions/runs/29932310309) passed docs/lint/typecheck, Web/API tests, build, 0007→latest, latest empty-database rebuild/database lint, two-user RLS/Storage/Courses E2E on a one-off local Supabase, and Chromium Playwright; the browser flow used the Azure fake.
- [main apply/deploy run](https://github.com/1590703336/Nalanda/actions/runs/29932840103) repeated every gate, skipped production database changes since there were no new migrations, and released immutable release `d31af905b44ca4df39c70e271a7c7a51612916e3-29932840103-1`. This change did not modify the API, environment variables, business rules, or security boundaries.
- The main release still ran the server-`.env`-driven real Azure Speech gate before activating the new image; this proves the existing provider path worked at the time, but doesn't change the boundaries "PR Playwright uses fakes" and "this UI feature didn't change speech".
- Independent public smoke: Web `/` was 200, `/api/health` returned `status=ok`, `service=nalanda-api`, `deps.supabase=ok`, and unauthenticated `/api/me` was 401. Production Chromium used the user's full text to successfully generate `Starter Unit 1` and `Starter Unit 2`, and Review/Edit showed separate translation inputs and supported bulk append.
- Scroll measurement: the app's `.content` is `overflow-y:auto`, `clientHeight=1127`, `scrollHeight=1632`, and it can scroll to the bottom to use "Add word/Bulk paste words/Add unit"; the fix is in the shared `.main/.content` flex height chain, so it also covers other long pages using the same app shell.
- Later Markdown-only sync commits go through the separate docs workflow and produce no new Web/API release; merging docs must never be described as redeploying the application.

### 2026-07-23 Courses learning feedback and Azure cache fix

- main SHA: `02ba1b682c104947aa0b80707c143b8e921870f0`; PR #16's quality, 0007→0014, empty-database rebuild/database lint, real RLS/Storage, and Courses Playwright all passed.
- The [read-only migration plan](https://github.com/1590703336/Nalanda/actions/runs/29939798432) showed the remote at 0013 with `20260723000014_learning_feedback_flow.sql` as the only pending item; all write steps were skipped.
- [Protected apply/deploy](https://github.com/1590703336/Nalanda/actions/runs/29940292716) created and kept the 14-day encrypted recovery point artifact `8538123165`, applied 0014, then confirmed local/remote history matched, dry-run had nothing pending, and remote lint passed.
- Before activation, the real Azure gate with `japaneast`/`en-US-JennyNeural` successfully returned an MP3 of 10,656 bytes, accuracy 98, pronunciation 98.8, and 4 phonemes; immutable release `02ba1b682c104947aa0b80707c143b8e921870f0-29940292716-1` activated healthily.
- Independent public re-check: `/api/health` was `status=ok`, `deps.supabase=ok`, unauthenticated `/api/me` was 401, the home page loaded the new assets, and the production API image was at the same SHA; a random missing-TTS-cache probe inside the container returned `null`, confirming the first pronunciation no longer fails early because of Storage's HTTP 400/JSON-404.

### 2026-07-27 Courses instant feedback, weak-network answering, and offline audio

- main SHA: `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2`; PR #21 run `30243998633` and main run `30244402278` completed docs/lint/typecheck, Web/API tests, build, 0007→0016, empty-database rebuild/database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright. Playwright's Azure is a fake.
- The [read-only migration plan](https://github.com/1590703336/Nalanda/actions/runs/30244967669) confirmed the remote stopped at 0014 with 0015–0016 as the only pending items, and no recovery point, write, or application deployment ran.
- [Protected apply/deploy](https://github.com/1590703336/Nalanda/actions/runs/30245430630) kept artifact `8644999285`, applied 0015–0016, confirmed remote history, permission assertions, lint, and an empty dry-run, then built the isolated immutable Web/API release.
- Before cutover, the base Japan East real Azure smoke returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; the new queue gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, `trimmedAssessmentBytes=65324`, proving first generation, private Storage hits, no extra Azure generation for a second user's duplicate words, and trimmed scoring.
- Release `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2-30245430630-1` activated healthily. Independent public re-check: Web 200, `/api/health` returned `deps.supabase=ok`, and anonymous `/api/me` returned 401. This gate is release-time evidence and doesn't replace continuous monitoring.

### 2026-07-27 Courses historical cold audio and cross-unit session resuming

- main SHA: `99313bd3763ce5bf1f7ffb252f821f7b21a67eec`; PR #24 run `30263277807` and main run `30263794368` completed docs/lint/typecheck, Web/API tests, build, 0007→0018, empty-database rebuild/database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright. The new browser scenarios use the Azure fake and can't serve as provider evidence.
- The [read-only migration plan](https://github.com/1590703336/Nalanda/actions/runs/30264327821) confirmed the remote stopped at 0016 with 0017–0018 as the only pending items, and no recovery point, write, or application deployment ran.
- [Protected apply/deploy](https://github.com/1590703336/Nalanda/actions/runs/30264979509) created and kept encrypted recovery point artifact `8652623403`, digest `sha256:22861e8f8ccba2d87fc673f468c75677d6df3a0e9d424111c66dc67d009d5ac3`, applied 0017–0018, confirmed remote history, permission assertions, lint, and an empty dry-run, then built the isolated immutable Web/API release.
- Before cutover, the base Japan East real Azure smoke returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; the queue gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, `trimmedAssessmentBytes=65324`. These are real provider/Storage evidence, kept clearly separate from the Playwright fakes.
- Release `99313bd3763ce5bf1f7ffb252f821f7b21a67eec-30264979509-1` activated healthily. The independent public re-check showed Web 200, `deps.supabase=ok`, anonymous `/api/me` 401; on the server, the Web symlink points to that release and the API image is `nalanda-api:99313bd3763ce5bf1f7ffb252f821f7b21a67eec`.

### 2026-07-28 · 0019–0020 timed spelling and OpenRouter translation pre-test

- PR #26 merged session spelling options, the hash-only judgement table, service-role-only transactional RPCs, the NestJS OpenRouter adapter, the timed/translation pre-test UI, and layered tests; PRs #27–#29 fixed, respectively, the boolean-only provider contract, the zero-token fast path for exact normalized matches, and the idempotent replay response mapping. The final main SHA is `a4c230e1aa6f29abbd4fbe944a1b76c625107003`.
- [Read-only plan run `30366334157`](https://github.com/1590703336/Nalanda/actions/runs/30366334157) listed only 0019–0020; [protected run `30367263486`](https://github.com/1590703336/Nalanda/actions/runs/30367263486) created encrypted recovery artifact `8691620673` (`db-recovery-7c8b516ec4fc9086a6bae816966cb7f688c19746`) and then applied the migrations; remote history reached 0020, and lint and an empty dry-run passed.
- The candidate applications of `30367263486`, `30370419397`, and `30372651419` were stopped by the gate because of, respectively, the provider return contract, the model misjudging a synthetic exact-match answer, and the lost mapping of the outer replay flag of the claim; each time the previous Web/API was restored automatically, and the database stayed at 0020 per the forward-fix rule. The first execution of `30374301472` also hit a temporary local PostgREST upstream response, and the RLS job passed after a rerun at 4/4; a real 12-second OpenRouter timeout likewise didn't activate the candidate.
- The third deploy attempt of final main run [`30374301472`](https://github.com/1590703336/Nalanda/actions/runs/30374301472) passed: real Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; the real OpenRouter pinned model returned 1,365 ms and 253/27/280 tokens; the candidate Courses API returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, and durably proved `nalanda-normalized-exact/normalized-exact-v1`, 0 tokens, same-UUID `replayed=true`, revision 1.
- Release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3` activated healthily. Independent public re-check: `/api/health` was `status=ok`, `deps.supabase=ok`, anonymous `/api/me` was 401, and the Web returned the React root. Real release gates are point-in-time evidence and don't replace continuous OpenRouter quality/latency/cost monitoring.

### 2026-07-31 · 0021–0022 Unicode spelling judgement consistency

- PR [#35](https://github.com/1590703336/Nalanda/pull/35) merged into main SHA `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad`. PR run `30615023445`, main run `30615555388`, and protected run `30616540480` all passed quality, 0007→0022, empty-database rebuild/database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright; browser providers were still fakes.
- [Read-only plan run `30616030488`](https://github.com/1590703336/Nalanda/actions/runs/30616030488) confirmed the remote stopped at 0020 with `20260731000021_learning_spelling_unicode_normalization.sql` and `20260731000022_verify_learning_spelling_unicode_normalization.sql` as the only pending items; no recovery point, write, or deployment ran.
- [Protected apply/deploy run `30616540480`](https://github.com/1590703336/Nalanda/actions/runs/30616540480) kept encrypted recovery artifact `8787805291` (digest `sha256:fd553ea9c4898d72928db64bcbd979e13dff50f6b50a2138ec7113958709c199`) before apply, then confirmed remote history at 0022, function verification, database lint, and an empty dry-run.
- Before cutover, real Japan East Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; the real OpenRouter pinned model returned 10,597 ms and 253/27/280 tokens; the candidate Courses API/Storage gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, `trimmedAssessmentBytes=65324`.
- Release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` activated healthily. Independent public re-check: `/api/health` was `status=ok`, `deps.supabase=ok`, anonymous `/api/me` was 401, and the Web returned the React root and new build assets. No real user account was used to submit answers in production; production migration self-verification and the one-off real Supabase E2E are the evidence for this spelling judgement change.

### 2026-07-31 · 0023–0024 spelling tolerance for punctuation-only differences

- PR [#37](https://github.com/1590703336/Nalanda/pull/37) merged into main SHA `9b62951a8895aa6cf3ff0f9dce8395df239e6089`. PR run `30620350644`, main run `30620879282`, and protected run `30624104943` all passed quality, 0007→0024, empty-database rebuild/database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright; browser providers were still fakes.
- [Read-only plan run `30623522232`](https://github.com/1590703336/Nalanda/actions/runs/30623522232) confirmed the remote stopped at 0022 with `20260731000023_learning_spelling_punctuation_tolerance.sql` and `20260731000024_verify_learning_spelling_punctuation_tolerance.sql` as the only pending items; the recovery, apply, and deploy steps were all skipped.
- [Protected apply/deploy run `30624104943`](https://github.com/1590703336/Nalanda/actions/runs/30624104943) kept `db-recovery-9b62951a8895aa6cf3ff0f9dce8395df239e6089` before apply: artifact `8790816378`, 366,417 bytes, digest `sha256:887b1ac42c267ca7bb1cde810920702dde64f8d74112b3b39def6254d5bf0fca`, retained until 2026-08-14. After apply, remote history reached 0024, and the function/permission assertions, database lint, and an empty dry-run all passed.
- Before cutover, real Japan East Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; the real OpenRouter pinned model returned 2,790 ms and 253/27/280 tokens; the candidate Courses API/Storage gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, `trimmedAssessmentBytes=65324`.
- Release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1` activated healthily. Independent public re-check: Web 200 returning the React root, `/api/health` `status=ok`, `deps.supabase=ok`, and anonymous `/api/me` 401. No real user session was used to submit spelling answers in production; production migration self-verification and the one-off real Supabase E2E are the evidence for this judgement behavior.

### 2026-08-01 · 0025–0028 cancellation, end-of-round review, exams, and rolling quotas

- PR [#40](https://github.com/1590703336/Nalanda/pull/40) merged into main SHA `93354a56044470fb5d2b1fd6aeabcf82f459bb52`. PR run `30705662543` and main run `30705946921` passed docs/lint/typecheck, Web/API tests, build, 0007→0028, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright; Playwright's Azure/OpenRouter were still fakes.
- [Read-only plan run `30706279006`](https://github.com/1590703336/Nalanda/actions/runs/30706279006) confirmed the production remote was complete through 0024 with 0025–0028 as the only pending items; recovery, apply, and application deployment were all skipped.
- [Protected apply/deploy run `30706731292`](https://github.com/1590703336/Nalanda/actions/runs/30706731292) kept `db-recovery-93354a56044470fb5d2b1fd6aeabcf82f459bb52` before apply: artifact `8820657507`, about 418 KB, digest `sha256:02ea6fef5481756b17f79fbbd82c023d9c9ba085accfc1e28f9a268d24645ad9`, retained for 14 days. After apply, remote history reached 0028, and the structure/permission assertions, remote database lint, and an empty dry-run all passed; the database continues to use forward-fix only.
- Before cutover, real Japan East Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8, and 4 phonemes; the real OpenRouter pinned model returned 9,364 ms and 253/27/280 tokens; the candidate Courses API/Storage gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, `trimmedAssessmentBytes=65324`, and verified exact translation replay and revision 1.
- Immutable release `93354a56044470fb5d2b1fd6aeabcf82f459bb52-30706731292-1` activated healthily. The independent public re-check confirmed the Web returned the React root and new build assets, `/api/health` was `status=ok` with `deps.supabase=ok`, and anonymous `/api/me` was 401; an authenticated read-only Chromium check confirmed the existing course cards and the 90% default exam configuration were visible, but no exam was started and no real user answers were submitted, so this is not production user-answering E2E.

### 2026-08-03 · 0029–0034 pronunciation exam, word selection, exam history, and dual-exam mastery

- PR [#45](https://github.com/1590703336/Nalanda/pull/45) merged into main SHA `1a58d2164f6d58feea4d3a2c8925211b8cc60dde`. Final PR run `30811283164` and main run `30811817461` passed docs/lint/typecheck, Web/API tests, build, 0007→0034, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright; Playwright's Azure/OpenRouter were still fakes.
- [Read-only plan run `30812467085`](https://github.com/1590703336/Nalanda/actions/runs/30812467085) confirmed the production remote was complete through 0028 with 0029–0034 as the only pending items; recovery, apply, and application deployment were all skipped.
- [Protected apply/deploy run `30813047562`](https://github.com/1590703336/Nalanda/actions/runs/30813047562) kept `db-recovery-1a58d2164f6d58feea4d3a2c8925211b8cc60dde` before apply: artifact `8855819351`, 593,399 bytes, digest `sha256:5f36f770aab133f24e12d461e66b0c4b744303ca1dbfd1600215163e4ad14796`, retained for 14 days. After apply, remote history reached 0034, and the 0030/0032/0034 structure/permission assertions, remote database lint, and an empty dry-run all passed; the database continues to use forward-fix only.
- Before cutover, real Japan East Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8, and 4 phonemes; the real OpenRouter pinned model returned 1,604 ms and 253/27/280 tokens; the Courses API/Storage gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, `trimmedAssessmentBytes=65324`, and verified duplicate audio reuse and exact translation replay.
- Immutable release `1a58d2164f6d58feea4d3a2c8925211b8cc60dde-30813047562-1` activated healthily. The independent public re-check confirmed Web 200 returning the React root, `/api/health` `status=ok` with `deps.supabase=ok`, anonymous `/api/me` 401, and Course Market 200. No real user account was used to submit a full exam in production, so the migration/RLS/release gates are server and provider evidence, not production user exam-flow E2E.

### 2026-08-04 · 0035–0036 exact mastery projection and untrimmed recordings

- PR [#47](https://github.com/1590703336/Nalanda/pull/47) merged into main SHA `51252527645d9438df0414f056c8a3b088b360d8`. Final PR run `30831319634` and main run `30831964846` passed docs/lint/typecheck, Web/API tests, build, 0007→0036, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright; Playwright's Azure/OpenRouter were still fakes.
- [Read-only plan run `30832581552`](https://github.com/1590703336/Nalanda/actions/runs/30832581552) confirmed the production remote was complete through 0034 with 0035–0036 as the only pending items; recovery, apply, and application deployment were all skipped.
- [Protected apply/deploy run `30833228406`](https://github.com/1590703336/Nalanda/actions/runs/30833228406) kept `db-recovery-51252527645d9438df0414f056c8a3b088b360d8` before apply: artifact `8864033351`, 657,467 bytes, digest `sha256:36a9ec08516dff5cb198511d71b69bb63533727cad9826db050dff4a33025625`, retained until 2026-08-17. After apply, remote history reached 0036, and the 0036 structure/permission/write-path assertions, remote database lint, and an empty dry-run all passed; the database continues to use forward-fix only.
- Before cutover, real Japan East Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8, and 4 phonemes; the real OpenRouter pinned model returned 10,252 ms and 253/27/280 tokens; the Courses API/Storage gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=96.4`, untrimmed `assessmentBytes=88444`, and verified duplicate audio reuse and exact translation replay.
- Immutable release `51252527645d9438df0414f056c8a3b088b360d8-30833228406-1` activated healthily. The independent public re-check confirmed Web 200 returning new React assets, `/api/health` `status=ok` with `deps.supabase=ok`, anonymous `/api/me` 401, and Course Market 200. No real user account was used to submit a full exam in production, so the migration/RLS/release gates are server and provider evidence, not production user exam-flow E2E.

### 2026-08-04 · 0037–0038 Chinese translation voice input and shared waveform

- PR [#49](https://github.com/1590703336/Nalanda/pull/49) merged into main SHA `66c919833693971ba1bda4ea33a3fdf6717ef1ca`. PR run `30904901828` passed docs/lint/typecheck, 72 API tests, 85 Web/jsdom tests, build, 0007→0038, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright; Playwright's Azure/OpenRouter/Fish Audio were still fakes.
- [Read-only plan run `30906629924`](https://github.com/1590703336/Nalanda/actions/runs/30906629924) first hit a one-off transient Supabase upstream error; rerunning only the failed job on the same SHA passed, and the final dry-run listed exactly 0037–0038, without creating a recovery point, writing to the database, or deploying.
- [Protected apply/deploy run `30907716733`](https://github.com/1590703336/Nalanda/actions/runs/30907716733) kept encrypted recovery artifact `8892006761` (730,159 bytes) before apply, then synced remote history to 0038 and passed the 0038 structure/permission assertions, remote database lint, and an empty dry-run.
- Before cutover, real Japan East Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; real OpenRouter structured grading passed; the pending-activation production Courses API's Azure Chinese WAV→Fish Audio gate returned `transcriptionMatched=true`, and the audio/scoring gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=96.4`.
- Immutable release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1` activated healthily. The independent public re-check confirmed Web 200, new React assets, `deps.supabase=ok` from `/api/health`, and anonymous `/api/me=401`; a read-only check on the production host confirmed the Web symlink and the running API image are at the same SHA. The real STT used a fixed synthetic Chinese WAV, not physical-microphone or multi-accent quality E2E.

### 2026-08-10 · 0039–0040 security/rate-limit Stage A release

- PR [#51](https://github.com/1590703336/Nalanda/pull/51) implemented post/Feedback/Schedule integrity, points frozen daily caps/review/coordination signals, private Redis/HMAC rate limiting, layered nginx protection, and the two-phase workflow; PR run `31367746106` and main run `31368361777` passed quality, real Redis, 0007→0040, empty database/lint, two-user RLS/Storage, and Chromium Playwright. PR [#52](https://github.com/1590703336/Nalanda/pull/52) fixed the Redis check consuming the remote heredoc stdin and added a release-script regression; PR run `31370961413` and main run `31371608883` were all green.
- The first [read-only plan `31368447660`](https://github.com/1590703336/Nalanda/actions/runs/31368447660) listed only 0039–0040. [Protected run `31369657292`](https://github.com/1590703336/Nalanda/actions/runs/31369657292) kept artifact `9055783205` (777,902 bytes, digest `6c06bc011b3d0dc436b9722b66206e6f7a12bd2ecf083f2266cbb6b529c4112f`) before apply and synced the remote to 0040; but the workflow wrongly ended as success because of the stdin bug, and public health still showed the old API's `deps.redis=unset`, so that run doesn't count as an application release.
- After the fix was merged, [read-only plan `31372198037`](https://github.com/1590703336/Nalanda/actions/runs/31372198037) confirmed local/remote were both at 0040 with an empty dry-run. Final [protected run `31372888441`](https://github.com/1590703336/Nalanda/actions/runs/31372888441) kept another artifact `9057062920` (800,819 bytes, zip digest `81820da75dc4f0591ffd6f73ba3ac175a5b04f6995af8f8c508f60e56379a2f4`) and passed remote history, lint, and an empty dry-run.
- Before cutover, Redis PING/AOF/private-port/noeviction, nginx `-t`, real Japan East Azure (10,656-byte MP3, accuracy 98, pronunciation 98.8), real OpenRouter Gemma (5,524 ms, 253/27/280 tokens), and the real Courses API/Storage/Fish gate (`generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=98.2`, `transcriptionMatched=true`) all passed. An earlier 12-second timeout and three 429s were all blocked before cutover; the rerun only succeeded after the same key's quota was normal and the production host returned HTTP 200 again, without switching to fakes or bypassing gates.
- Immutable release `56100e6bc2a4c70aa289aaad4b43efa1267428bd-31372888441-5` was activated at `2026-08-10T09:35:34Z`. The public re-check confirmed Web/Course Market 200, anonymous `/api/me` and points admin 401, sign-up 400 with `RateLimit-Limit: 5`, and health `deps.supabase=ok/deps.redis=ok`; the host re-check confirmed the Web symlink and API image point to that release, and Redis is healthy with no host port.
- The 24-hour compatibility observation is counted from activation, so the earliest contract eligibility time was `2026-08-11T09:35:34Z`. On 2026-08-22, Redis, the points projection, coordination signals, and supported-client time-column dependencies were re-checked and passed go/no-go; the final contract was then appended sequentially as 0052–0053 after production 0051 and released through the protected flow.

### 2026-08-11 · 0041–0043 Materials AI production activation

- PR [#56](https://github.com/1590703336/Nalanda/pull/56) added OpenRouter bounded retries, a shared wall clock, `Retry-After`, same-model ZDR provider failover, reasoning off, and cost auditing for all failed attempts; PR run `31462982923` was all green. Main run `31463661987` then showed success, but independent verification found the Web/API still on the old commit, flag=false, and the AI endpoint 404, so it didn't count as going live.
- The root cause was that the new remote `docker compose exec -T ai` again inherited and consumed the SSH heredoc stdin; the later script never ran, but the remote shell exited with status zero. PR [#57](https://github.com/1590703336/Nalanda/pull/57) routed every remote compose exec through a helper with an explicit `</dev/null`, and added a release-tool regression for "no bare calls/must cover exactly five call sites"; PR run `31465041901` and main run `31465776658` passed.
- [Read-only plan `31465816321`](https://github.com/1590703336/Nalanda/actions/runs/31465816321) confirmed local/remote were both at 0043 with an empty dry-run. [Final protected run `31467153739`](https://github.com/1590703336/Nalanda/actions/runs/31467153739) created the 14-day encrypted recovery artifact `9092230348` (824,125 bytes, zip SHA-256 `6939309024094791bb639112eaf73a1429d588a4800c42703e579185a0aa817f`) and verified remote history/lint/an empty dry-run again.
- The resource canary processed 220 pages and 366,412 characters: main process peak 106,778,624 bytes, Office subprocess 222,203,904 bytes, 6.923 seconds, with no OOM/neighbor-site failure. The real OpenRouter pinned DeepSeek/MiMo suite covered PDF/DOCX/PPTX/chart, the scope of a single vision failure, prompt-injection rejection, safe-material acceptance, 39 progress events, and subjective-question grading; the process directory was cleaned before and after.
- The existing real Japan East Azure, Gemma translation, and Courses API/Storage gates continued to pass. The signed-in Materials gate produced `generationJob=succeeded`, `grading=completed`, one generation/grading quota each, 5 provider usage rows, `sourceAndResultsDeleted=true`, and `deps.supabase=ok/deps.ai=ok`.
- Immutable release `e6ce0cb246d9fc1ecc1c4869b6e63d09d3256bd4-31467153739-1` was activated at `2026-08-11T07:20:02Z`. A read-only server check confirmed the API/AI images, `.deploy.env`, and the Web symlink are at the same commit, AI/Redis are healthy, and `FEATURE_MATERIAL_AI=true`; the independent public re-check showed the home page 200, Supabase/Redis health ok, AI worker/queue ok, and anonymous me/quota 401.

### 2026-08-14 to 2026-08-22 · 0046–0051 database released, application candidate still not activated

- The candidate switches long jobs to a fast 202 + callback/checkpoint/usage spool and adds the ELK/React Flow graph, cross-device layout, job Delete/Clear, unified submit-and-grade, and `luna_native_file_v1`. The production database was forward-applied to 0051 through the protected flow; 0044–0045 remain unused, and the time-column contract was appended strictly as 0052–0053. A database apply is not application activation.
- PR #70 run `32499521666` completed the full fake/local gates and was merged as main `e6fa854dd6517a2a2ccd4152b60ca37078f6af4e`. Main run [`32540131549`](https://github.com/1590703336/Nalanda/actions/runs/32540131549) again passed lint/typecheck, API/Web/Python, real Redis, 0007→0051, empty database/lint/RLS/Storage, fake Chromium, image builds, and the 220-page resource canary; there was no new migration this time, and the database release job was correctly skipped.
- After the same run's real PDF gate passed, the fixed DOCX exam returned `AI_EXAM_VALIDATION_FAILED` at final validation. Candidate `e6fa854dd6517a2a2ccd4152b60ca37078f6af4e-32540131549-1` failed before the API/Web cutover, and the EXIT trap cleared the candidate and restored the old API/AI/Web; an independent check confirmed `.deploy.env` and the Web symlink still point to the old stable `3c095a55ced21cee11a1b3131dd2889ec1f70733` release, public Supabase/Redis/AI health is normal, and anonymous `/api/me` is 401. So #70 is merged but was not deployed successfully.
- The forward fix only adds content-free validation categories/counts and expands the fixed material into eight independent facts, enough to support five questions; it still keeps one repair and the strict schema/answer/citation/semantic gates. Until new PR/main real gates pass, the candidate is cut over, and independent server and public re-checks are done, 0046–0051 must not be called live as an application; Luna still needs a first-party OpenAI ZDR endpoint, and the sub-switch must be false when that capability doesn't exist.

### 2026-08-22 · 0052–0053 security Stage B database release, application gate rollback

- PR #71's main run [`32543270581`](https://github.com/1590703336/Nalanda/actions/runs/32543270581) passed the first real Materials suite and was then blocked by Japan East Azure HTTP 401 and rolled back; attempt 2, retried at the user's request, passed the 220-page resource canary, then the fixed DOCX failed initial semantic review, and after repair the final structural gate returned `SOURCE_REFERENCE`, likewise with no cutover.
- PR [#72](https://github.com/1590703336/Nalanda/pull/72) used main `1ef0bc8d333a9ff841176d91acb4c977c0e64bed` as its only baseline and was merged as `4d1bc97888799417641fefdd507c026b274a2bab`; PR run [`32579985463`](https://github.com/1590703336/Nalanda/actions/runs/32579985463) and main run [`32580594918`](https://github.com/1590703336/Nalanda/actions/runs/32580594918) passed docs/lint/typecheck, API/Web/Python, real CI Redis, 0007→0053, empty database/lint, two-user RLS/Storage, fake-provider Chromium, production image startup, and nginx/compose. The ordinary main push correctly skipped the production database and application deployment.
- [Read-only plan `32581192318`](https://github.com/1590703336/Nalanda/actions/runs/32581192318) showed the remote complete through 0051, and the dry-run listed exactly 0052–0053 without writing to the database or deploying. [Protected run `32581805613`](https://github.com/1590703336/Nalanda/actions/runs/32581805613) uploaded the 14-day encrypted recovery artifact [`9478168126`](https://github.com/1590703336/Nalanda/actions/runs/32581805613/artifacts/9478168126) (885,857 bytes, zip SHA-256 `0e4425b7098b4b352b5a7f6e81e87861d9c98b535970f9f20592641653a41274`) before apply, then applied 0052–0053. Remote history aligned to 0053, the dry-run was empty, and the public schema lint succeeded; 0053 also fail-closed asserts the valid columns, service-role, triggers, and the final revocations.
- Application attempt 1's 220-page resource canary passed, but the real PPTX exam was missing `SOURCE_REFERENCE` after repair; in attempt 2 the same sample, repaired from the missing citations, still failed the five semantic gates, and both returned `AI_EXAM_VALIDATION_FAILED`. We did not switch to fakes, relax the gate, or keep trying our luck; the real Materials AI gate failure happened before the later Azure/OpenRouter/Courses smokes, so those later gates cannot be written up as passed for this run.
- Both candidates called rollback before the Web/API cutover. The independent public re-check showed Web 200, `/api/health` 200 with `deps.supabase=ok/deps.redis=ok`, `/api/health/ai` 200, and anonymous `/api/me` 401; the host re-check confirmed the Web symlink and API/AI images are still `3c095a55ced21cee11a1b3131dd2889ec1f70733`, AI/Redis are healthy, and `FEATURE_MATERIAL_AI=false`, `FEATURE_MATERIAL_AI_LUNA=false`. Conclusion: the 0052–0053 database permissions are live, the latest main application was not deployed successfully, and Materials AI stays off until an independent fix passes every gate again.
- The source-citation forward fix only allows restoring pre-repair citations within the DocumentIR allowlist, server-side locators, and the same stable question ID, and forces another semantic review. It can only be recorded as a successful deployment after full CI on a new PR/main, real providers, Azure, signed-in user smoke, candidate cutover, and independent server/public verification; if the real semantic gate fails again, it must still roll back.

### 2026-08-23 · PR #74 source-citation fix candidate still rolled back

- PR [#74](https://github.com/1590703336/Nalanda/pull/74) was merged as main `5b4cad883b628fd21cc1d104227be6dfb746834f`; PR run `32585020750` and main run [`32585659792`](https://github.com/1590703336/Nalanda/actions/runs/32585659792) passed docs, quality, 0007→0053, empty database/database lint, two-user RLS/Storage, fake Chromium, and production-shaped images. There were no migration changes, and the production database job was correctly skipped.
- Application attempt 1 passed the 220-page canary, real DeepSeek/MiMo PDF/DOCX/PPTX/chart, injection/safe material, grading, the 9-node graph, and Japan East Azure (accuracy 98, pronunciation 98.8); Luna stayed false because the OpenAI-only ZDR was unavailable. The independent Gemma translation smoke then returned HTTP 429 five times in a row, and the candidate rolled back automatically.
- Attempt 2, rerunning only the failed job on the same SHA, was stopped after the canary by the fixed PDF: DocumentIR had only one block, but the first generation and one repair both cited invalid IDs, and the initial/final gates were both `SOURCE_REFERENCE`. Neither candidate switched the Web; independent server and public re-checks still point to `3c095a55ced21cee11a1b3131dd2889ec1f70733-31574116130-1`, with Supabase/Redis/AI health ok and anonymous `/api/me` 401.
- The new forward fix only normalizes to the single source when the allowlist has exactly one block, and forces semantic review; multiple blocks still fail closed. It cannot bypass the independent Gemma 429 or the later signed-in smoke, and still needs full protected release evidence from a new PR/main.

### 2026-08-23 · PR #75 single-block fix passes, Gemma hard gate still rolls back

- PR [#75](https://github.com/1590703336/Nalanda/pull/75) was merged as main `ad4b98b041ccb38954ac3bba705b26a92b70cca2`. PR run [`32587211309`](https://github.com/1590703336/Nalanda/actions/runs/32587211309) and main run [`32587844503`](https://github.com/1590703336/Nalanda/actions/runs/32587844503) passed docs, quality, 0007→0053, empty database/database lint, two-user RLS/Storage, fake Chromium, and production-shaped images; there were no migration changes, and the production database job was correctly skipped.
- Application attempt 1 passed the 220-page resource canary, but the fixed single-block PDF had 6 questions both initially and after one repair while the settings required 5; the final structural gate failed with `QUESTION_TYPE_COUNT` and rolled back automatically. This failure was not swallowed by the source-compensation logic.
- Only the failed job was rerun once on the same SHA. Attempt 2's canary passed again, and the real DeepSeek/MiMo gate completed PDF/DOCX/PPTX/chart, injection rejection, safe material, grading, and the 9-node graph; Luna stayed false because the OpenAI-only ZDR was unavailable, and Japan East Azure returned accuracy 98, pronunciation 98.8. The free Gemma model then still returned HTTP 429 after five bounded attempts, the candidate rolled back a second time, and the Courses and signed-in user smokes had not yet run because of the sequential gating.
- Neither attempt switched the Web/API. Independent host and public checks confirmed the Web symlink and API/AI images are still release `3c095a55ced21cee11a1b3131dd2889ec1f70733-31574116130-1`, both Materials flags are false, Supabase/Redis/AI health ok, anonymous `/api/me` 401, home page 200, and attempt 2's candidate directory and `web.next` were both cleared. So PR #75 is merged but not deployed; don't blindly rerun a third time or weaken the Gemma hard gate.

### 2026-08-23 · Ox Alpha three-pipeline candidate (never released; retired 2026-10-03)

- The current branch switches Courses non-literal translation from Gemma to the pinned `stealth/ox-alpha` and adds 0054–0055 and `ox_alpha_native_file_v1`. The Materials capability matrix becomes three explicit pipelines: DocumentIR, Luna original file, and Ox Alpha original image; Ox pins Stealth-only/no-fallback/mandatory reasoning, and the API/worker only allow PNG/JPEG/WebP.
- The live model metadata has no file modality, and the live ZDR catalog has no Ox endpoint either. So the protected release must separate the "Ox text translation real smoke" from the "Materials Ox original-image ZDR gate": a failure of the former blocks the application cutover; the latter should currently keep the sub-switch stably false and record `OPENROUTER_ZDR_UNAVAILABLE`, and must not relax ZDR or use the text smoke to pretend original images work.
- This section only records the candidate design and the verified provider capabilities; it is not evidence of CI, database apply, application cutover, or public verification. Once done, it must be completed with the PR/main runs, the 0054–0055 read-only plan, the recovery artifact, the protected apply, the real gates, the release/image/Web symlink, and the independent public results.

### 2026-10-03 · 0056–0057 retire Ox Alpha, GPT-6 Luna (candidate)

- Ox Alpha has been removed from the OpenRouter live catalog, and a read-only production query confirmed there are no Ox job/Note/usage rows. 0056–0057 retire that pipeline; the deploy workflow, env install script, and smokes no longer write or check Ox, and only strip the old keys during activation/rollback.
- Luna switches to `openai/gpt-6-luna` pinned to Azure: in the live ZDR catalog, GPT-6 Luna only has the three ZDR endpoints `azure`, `azure/us`, and `azure/eu`. The provider gate only runs the Luna original-file fixture and allows turning on the sub-switch when it finds an Azure ZDR endpoint.
- The Courses translation smoke now verifies the free `nvidia/nemotron-3-super-120b-a12b:free` Nvidia-only JSON Object judgement.
- The same candidate includes the `exam-generate.v4` DocumentIR repair fix. Release order: PR CI → merge → workflow_dispatch `apply_database_migrations=true` (recovery point, 0056–0057 apply/verify, application candidate, and all real gates). Until the protected run completes, this section is not production evidence.

## 8. Operations cheat sheet

```bash
cd /opt/nalanda
docker compose --env-file .deploy.env ps
docker compose --env-file .deploy.env logs --tail=50 api
docker compose --env-file .deploy.env restart api
readlink -f web
df -h /opt/nalanda
docker system df
# Manually trigger a deploy: GitHub → Actions → deploy → Run workflow
```

## 9. Follow-up TODO

- Switch to GHCR + build caching to reduce the image transfer on each deployment.
- Sync immutable images/releases to an off-site registry and define capacity/retention cleanup; hook up Sentry/logging.
- The 0046–0055 databases are all forward-applied. Gemma was replaced in code by Ox Alpha per a separate product decision; the PR #78 fix is merged, but the application candidate was again stopped by the independent DocumentIR semantic quality gate. A new SHA containing `exam-generate.v4` must go through the full immutable release again, and going live must not be inferred from database or code changes. The Stripe webhook remains a later capability.

### 8.16 PR #77 / 0054–0055 and the Ox Alpha output contract rollback (2026-08-23)

- PR #77 was merged as `85beab02d84d2b7b42948a0ab4a923ea13646109`, main CI `32627507536` passed; read-only plan `32628178552` listed only 0054–0055.
- Apply/deploy run `32628757656` kept a recovery point and advanced remote history to 0055, after which the dry-run showed nothing pending and the public schema lint passed.
- The candidate's 220-page canary, the DocumentIR DeepSeek/MiMo suite, and Japan East Azure passed; Luna and Materials Ox correctly stayed false because of `OPENROUTER_ZDR_UNAVAILABLE`.
- The Courses Ox Alpha translation smoke requested `response_format.type=json_schema` with `require_parameters=true`, but the live endpoint only declares the generic `response_format`, so OpenRouter returned HTTP 404. The protection script restored the previous Web/API and confirmed the public root/health were 200, Supabase/Redis ok, and anonymous `/api/me` 401; the candidate was not cut over.
- The fix candidate uses `response_format.type=json_object`, still pinned to Stealth-only/no fallback/deny collection/required parameters, and the API and release smoke strictly verify the single field, type, and semantic cases locally. Non-2xx logs may only contain the status, structured code, and request ID.
- Extend the local Supabase RLS gate into periodic hosted staging E2E, covering configuration drift against the same production version.

### 8.17 PR #78 and the DocumentIR DOCX semantic gate rollback (2026-08-26)

- PR #78 was merged as `1281510c94b4da5a765211df8467f9a26be393f0`; main run [`32931681321`](https://github.com/1590703336/Nalanda/actions/runs/32931681321) passed quality, the 0007→0055 upgrade, empty database/lint, two-user RLS/Storage, fake Chromium, the Web/API/AI images, and the 220-page canary. There was no new migration, and the database steps were correctly skipped.
- After the fixed PDF passed, the initial DOCX exam entered repair with `QUESTION_TYPE_COUNT`. After repair, actual/expected were both 5 questions and 20 points and the final structural code was empty, but the final semantic gate reported defects in all five categories — answerability, answer correctness, distractors, explanations, and source grounding — so the candidate stopped before the real Ox translation smoke.
- Automatic rollback restored the previous Web/API and the failed incoming was cleared; the independent public check showed root 200, API health 200 (Supabase/Redis ok), AI health 200, anonymous `/api/me` 401, and the old frontend assets still being served.
- The root cause was that the old repair payload only had `allowedBlockIds` and no source block text, so the structural repair couldn't reliably ground added questions in the material, and the workflow had no repair stage left when it first found semantic defects after repair. `exam-generate.v4` now carries the full source and an explicit repair gate; only semantic issues newly found after the structural repair get one extra repair, after which the structural and semantic gates continue to be enforced strictly. Until new real release evidence exists, the feature stays off.
