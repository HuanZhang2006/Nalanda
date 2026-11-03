# Secret and Credential Rotation

> **About this document**
> - **Contents**: Inventories Nalanda's current and target secrets, and gives planned rotation and emergency leak-handling steps for Supabase, GitHub/SSH, the database, OpenRouter, internal services, Stripe, TLS, and other credentials.
> - **Purpose**: Updates credentials with no or minimal downtime, shortens the exposure window, and ensures old credentials are truly revoked and every consumer switches consistently.
> - **When to update**: When providers or secrets are added/removed, key types/consumers/storage locations change, or rotation periods or personnel permissions change; must be updated after every leak, failed rotation, or security retrospective.

## 1. Current principles and boundaries

- Secrets must never enter Git, Markdown, issues, logs, screenshots, browser bundles, or chat history.
- `VITE_*` values are compiled into the browser's static files; they may only hold public configuration/the anon key, and never service-role, the JWT secret, or provider secrets.
- Rotation always has four steps: **create/enable the new credential → update every consumer → verify → revoke the old credential**.
- If a credential is confirmed leaked, revoking it and containing the impact come first; never keep the leaked old key around "so we can roll back".
- Provider console flows and key types can change. Before acting, confirm in the current console whether dual keys/an overlap period are supported, the impact on sessions/webhooks, and the audit records.
- There is currently no secret manager, automatic expiry, or rotation calendar; the protected deploy atomically updates the corresponding sections of the API `.env`, the isolated `.redis.env`, and the Materials AI `.ai.env` through standard input, without downloading or printing the whole file.

## 2. Credential inventory

| Credential | Current storage/injection | Current consumers | Client-visible | Status |
|---|---|---|---|---|
| `VITE_SUPABASE_ANON_KEY` | Web `.env.local` / GitHub Actions Secret | Browser Supabase client | Yes | In use |
| `SUPABASE_SERVICE_ROLE_KEY` | API `.env` / `/opt/nalanda/.env` | Sign-up, readiness, Courses PostgREST/Storage/transaction RPCs | **No** | In use, highest privilege |
| `SUPABASE_JWT_SECRET` | API `.env` | Legacy HS256 verification fallback | No | Optional; asymmetric projects usually don't need it |
| Supabase JWT signing keys/JWKS | Managed by Supabase | Issued by Supabase; API JWKS verification | Public key visible | In use |
| `SUPABASE_ACCESS_TOKEN` | `production-database` environment / secure storage | Supabase CLI releases; emergency legacy script | No | Used by CI |
| `SUPABASE_DB_PASSWORD` / recovery connection string | Protected environment / ops secret | dry-run, dump, push, lint, isolated recovery | No | Used by CI/recovery; not read by the app |
| `DB_BACKUP_ENCRYPTION_KEY` | Protected environment + offline recovery custody | Encrypting/verifying the pre-migration archive | No | Used by CI; must have an offline copy |
| `SERVER_SSH_KEY` | GitHub Actions Secret | deploy workflow SSH/scp | No | In use |
| `SERVER_SSH_KNOWN_HOSTS` | GitHub Actions Secret | Pins the server host identity | Public key material | In use; changes need offline verification |
| Server SSH authorized key | Server | Accepts CI/administrator connections | Public key | In use |
| GitHub account/token | GitHub | Repository and Actions management | No | Platform-managed, not written to the repository |
| `AZURE_SPEECH_KEY` | API `.env` / production `/opt/nalanda/.env` | Courses durable TTS worker and pronunciation assessment | No | In production use; the Japan East base, durable queue, repeated-word reuse, and trimmed-scoring gates have all passed |
| `OPENROUTER_API_KEY` | GitHub `production` → API `.env` and the isolated `.ai.env` | Courses free Nemotron semantic judging/STT; Materials DeepSeek/MiMo; candidate GPT-6 Luna/Azure | No | One source secret, several server-side capabilities; each runs its own real gate, and fakes must never reach production |
| `AI_INTERNAL_TOKEN` | GitHub `production` → API `.env` and the isolated `.ai.env` | NestJS↔FastAPI acceptance, callbacks, cancel/purge | No | Production 0041–0043; the 0046–0051 candidate extends cleanup; a separate 32-byte hex value, and both ends must switch atomically |
| `COURSE_MARKET_ADMIN_USER_IDS` | API `.env` | Course Market moderation authorization | No | Sensitive authorization config, not a secret, but changes are audited like permission rotation |
| `MODERATION_ADMIN_USER_IDS` | API `.env` | Points signal/reward moderation allowlist | No | Sensitive authorization config; during the 0039 compatibility period it falls back to the Course Market allowlist only when empty |
| `REDIS_PASSWORD` | GitHub `production` secret → `/opt/nalanda/.redis.env`; the API `.env` only holds the `REDIS_URL` containing the password | Private Redis and Nest ioredis | No | Production 0039; a separate 32-byte hex value, and the Redis container receives no other API secrets |
| `RATE_LIMIT_HMAC_SECRET` | GitHub `production` secret → API `.env` | IP/email actor HMAC and readiness | No | Production 0039; a separate 32-byte hex value, never reused as the Redis password |
| `STRIPE_SECRET_KEY` | Hybrid `.env` target | Future payment service | No | Not implemented |
| `STRIPE_WEBHOOK_SECRET` | Hybrid `.env` target | Future webhook verification | No | Endpoint not implemented |
| TLS private key / ACME account | Production certbot/nginx | HTTPS | No | Currently maintained on the server |

See the [environment variable matrix](../guides/ENVIRONMENT_VARIABLES.md) for every variable's consumers. The project URL, Project Ref, domain, and `SERVER_HOST`/`SERVER_USER` are not passwords, but modification rights should still be restricted and covered by configuration change auditing.

## 3. General steps for planned rotation

### 3.1 Before the change

- Open a ticket: credential, environment, reason, owner/reviewer, window, consumers, verification, and the old key's revocation time.
- Confirm every consumer from the code, GitHub, the server, the provider, and ops scripts; don't only check `.env.example`.
- Confirm whether the provider allows dual keys; if not, schedule a maintenance window with a clear impact statement.
- Create a pre-release database recovery point; secret rotation shouldn't change business data, but a wrong project/permission can cause write failures.
- Prepare minimal verification: external health, sign-in, `/api/me`, sign-up/Storage, and so on.
- Notify the on-call person and freeze unrelated deployments.

### 3.2 Switching

1. Create or enable the new key, recording the key ID/last-characters fingerprint and the UTC time, never the full value.
2. Update backend/internal consumers first, then the Web app that needs rebuilding; or adjust the order per the provider's compatibility window.
3. Restart/rebuild consumers and confirm the process actually loaded the new value.
4. Run functional verification and provider-side usage/audit checks.
5. Watch the error rate during the overlap window.
6. Revoke the old key and verify again; record the revocation evidence.

### 3.3 Failure handling

- Planned rotation where the old key is not leaked: within the brief overlap window while the old key is still valid, you can restore the old consumers, fix the problem, and switch again.
- Leaked: never restore the old key; rolling back application configuration must also keep using the new key, pausing affected features if needed.
- If a secret was accidentally put into the Web app/Git/logs, deleting the file alone is useless: rotate immediately, clean up accessible artifacts/logs, and assess Git history and access scope.

## 4. Supabase anon/publishable key

The current variable name is anon key, and the value enters the Web artifact; it is not service-role but still relies on correct RLS. If the provider migrates to the new publishable/secret key types, first confirm SDK compatibility and update the variable naming docs.

Rotation steps:

1. In the current Supabase console, create/rotate a client-usable key and confirm overlap support for the old key.
2. Update the development `apps/web/.env.local` (each developer updates their own environment).
3. Update the GitHub Actions Secret `VITE_SUPABASE_ANON_KEY`.
4. Manually trigger `.github/workflows/deploy.yml` or release a commit containing the same change to rebuild the Web app; changing only the GitHub Secret does not change the already deployed static JS.
5. Verify site loading, sign-in, every RLS data read, material signed URLs, and writes.
6. Search for nginx access errors and Supabase Auth/PostgREST/Storage errors.
7. Revoke the old client key; clear browser caches/old artifacts and verify again.

If the anon key and the old-style JWT secret/service-role key derive from the same signing secret, they cannot be rotated as ordinary independent API keys; follow the current Supabase project's coordinated rotation flow and assess session invalidation.

## 5. Supabase service-role key

This is currently the highest-risk application secret and can bypass RLS. Treat any suspected leak as P1.

Planned rotation:

1. Confirm the key type, dual-key capability, and whether it is linked to the anon/JWT signing key.
2. Generate/enable the new service-role/secret key.
3. Securely edit `SUPABASE_SERVICE_ROLE_KEY` in `/opt/nalanda/.env` on the server, keeping `chmod 600 /opt/nalanda/.env`.
4. Rebuild the API container environment:

   ```bash
   cd /opt/nalanda
   docker compose --env-file .deploy.env up -d --force-recreate api
   docker compose --env-file .deploy.env ps
   docker compose --env-file .deploy.env logs --since=5m --tail=100 api
   ```

5. `/api/health` can only verify the key/basic connectivity. Continue with a controlled temporary account to test sign-up, sign-in, and `/api/me`, and in a Courses beta environment create/read/delete a four-word course, confirming the service-only RPCs and `vocabulary-audio` (if speech is on) work; then delete the account and its cascaded data.
6. Confirm Supabase audit/usage shows the new key, revoke the old key, and repeat the minimal sign-up verification.

CI currently does not pass this key or update the server `.env`; never add it as a Docker build arg or a `VITE_*` variable.

## 6. Supabase JWT signing keys / `SUPABASE_JWT_SECRET`

The current guard prefers verifying ES256/RS256 with the project JWKS and caches the remote JWK set; only legacy HS256 falls back to `SUPABASE_JWT_SECRET`.

1. First check the `alg`/`kid` in a real user token header (without recording the full token) to confirm which path the project uses.
2. Create a new key with Supabase's current signing-key rotation feature; if staged activation is supported, first make sure the JWKS contains both public keys needed for verification.
3. After activation, restart the API to clear the in-process JWKS state, and verify `/api/me` with a **token obtained by a fresh sign-in**.
4. Verify old sessions still within the provider's declared compatibility window; record when they are expected to expire.
5. For legacy HS256 projects that change the JWT secret, also update `SUPABASE_JWT_SECRET` in `/opt/nalanda/.env`, rebuild the API, and assess whether the anon/service-role keys and every existing session become invalid at the same time.
6. Confirm Web/API point at the same Supabase URL, revoke the old signing key, and verify again.

Never mitigate rotation problems by skipping issuer/audience checks, accepting arbitrary algorithms, or turning off the guard.

## 7. Supabase Personal Access Token

`SUPABASE_ACCESS_TOKEN` is used by the protected CI's Supabase CLI releases and the emergency legacy script; it is not a user access token and must not be in `/opt/nalanda/.env`.

1. Create the new token with a dedicated, least-privilege operations identity.
2. Update the `production-database` environment Secret; the `main` branch restriction must not be removed. If the plan supports required reviewers, that gate must not be removed either; while the current plan doesn't support it, a manual release may only happen after the database owner's manual review record is saved.
3. Run `migration list`/dry-run against a **development or staging Project Ref** to confirm the token's permissions; never use production as the test target.
4. Revoke the old token and check recent Management API activity.
5. If the holder leaves, a device is lost, or the token appears in logs, revoke it immediately and audit every Supabase project it could access.

The legacy script no longer has a default Project Ref; rotation tests and every run must still set `SUPABASE_PROJECT_REF` explicitly. The production ref is also cross-checked against `VITE_SUPABASE_URL`.

## 8. PostgreSQL password/connection string

The app currently does not read the database password; the protected CI uses it for dry-runs, encrypted recovery points, push/lint, and isolated recovery.

1. Confirm every dump, BI, administrator, and automation consumer.
2. Rotate the database password/create a new least-privilege role in the current Supabase console.
3. Update `SUPABASE_DB_PASSWORD` and the recovery tools/secret manager; never write it into shell history.
4. In staging, run a dry-run, a full encrypted dump, and `restore-db-release.sh verify`, and complete at least one isolated restore.
5. Revoke the old role/password and check for connection failures and unusual sources.

If the API ever connects to Postgres directly, it should use a separate least-privilege application role and connection pool configuration, never reusing the owner/backup credentials.

## 9. GitHub Actions deploy SSH key

The safe order is "add the public key first, switch the Secret, delete the old public key last":

1. Generate a new dedicated ed25519 keypair on a controlled machine with a clear comment; the private key only goes into the GitHub Secret.
2. Add the new public key to the current deployment account's `~/.ssh/authorized_keys`, restricting source/command/permissions as much as possible.
3. Update the GitHub Actions Secret `SERVER_SSH_KEY`.
4. If the server host key also changed, verify the new fingerprint through the console/a trusted network before updating `SERVER_SSH_KNOWN_HOSTS`; never accept an unknown key with `ssh-keyscan` inside the workflow.
5. Run the deploy workflow manually, verifying upload, the immutable release, external health, and failure rollback.
6. Delete the old public key from `authorized_keys`, then run a read-only connection/the next deployment to verify.
7. Record the GitHub audit log, server auth log, and key fingerprint.

The current deployment account is high-privilege. The target is a dedicated least-privilege deploy user that can only write `/opt/nalanda` and run the required compose operations.

GitHub administrator/Actions permissions should also enable MFA, minimize writable roles, and periodically remove departed people, PATs, deploy keys, and third-party Actions permissions.

## 10. Redis password and RateLimit HMAC (production 0039)

Each value must be 32 cryptographically random bytes (deploy input is 64 hex characters). `REDIS_PASSWORD` is passed to Redis only through the separate `.redis.env`; the API only receives the `REDIS_URL` containing the password. `RATE_LIMIT_HMAC_SECRET` only goes into the API. `scripts/install-production-security-env.sh` reads from standard input and replaces atomically, rejecting invalid lengths and never printing values.

Planned rotation:

1. Generate two new values in a controlled terminal and update the GitHub `production` environment; never paste them into command arguments, tickets, or Actions output.
2. In a low-traffic window, keep nginx rate limiting, back up the permissions and non-secret checksums of `.env/.redis.env`, and run the installer through standard input.
3. When the Redis password changes, rebuild Redis first, then immediately rebuild the API; during this short window writes/sign-up/cost paths should return 503 by design and must never temporarily fail open. If only rotating the HMAC, reuse the current Redis password and rebuild only the API.
4. Verify that Redis has no host port, authenticated PING, AOF `everysec`, `noeviction`, API `deps.redis=ok`, the standard headers on sign-up/authenticated/Courses routes, and the failure tiering of private reads vs. protected writes.
5. An HMAC change produces brand-new actor keys; old windows cannot be linked across secrets and request allowances start over; record an explicit audit breakpoint with the UTC time, keep the nginx burst layer, and never try to reverse old IPs/emails.
6. Verify the old Redis password can no longer authenticate; delete old plaintext from temporary backups and confirm logs/artifacts contain no secrets.

On a leak, immediately replace whichever of the two values is affected and audit `api_abuse_events`, 429/503, sign-ups, and provider usage. Redis AOF is not the points fact store; never "sync" the new windows by deleting claims/the ledger.

## 11. Materials AI internal token (production 0041–0043; two-way callbacks and cleanup in the 0046–0051 candidate)

`AI_INTERNAL_TOKEN` is a separate 32-byte hex value for two-way internal calls between the API and FastAPI; under the candidate 202 protocol it protects not only API→worker acceptance but also the worker→API progress, usage, checkpoint, and complete/fail callbacks. It must not equal the Redis password, HMAC, JWT, provider, or backup key. The GitHub `production` environment stores the input, and the protected install script atomically writes it over SSH stdin into both `/opt/nalanda/.env` and the isolated `.ai.env`, both mode 600, without printing the value; the 0700 checkpoint/usage spool only stores result/metering payloads and must never store the token/headers.

1. Keep `FEATURE_MATERIAL_AI=false`, generate a new token, and update the GitHub secret;
2. Write both env files through the protected installer and force-recreate `ai` and `api` in the same maintenance window, avoiding half new and half old;
3. Verify FastAPI health `internalAuth=ok`, `/api/health/ai`, a 401 for a wrong token, and legitimate internal accept/progress/usage/checkpoint/complete/fail/cancel/purge; use a fault fixture with no personal data to prove that after a callback interruption the old token is not stored in the local spool, and that under the new token replay by unique event UUID completes;
4. Check that Actions/container logs, shell history, and artifacts contain no token; record the UTC time/owner/new secret fingerprint rather than the value;
5. On a leak, immediately turn off Materials AI, rotate, cancel active leases, and let the reconciler re-enqueue safely, checking for unusual callback/job states. Never remove internal authentication to restore availability.

## 12. Azure Speech key (in production use)

`AZURE_SPEECH_KEY` lives only in the Nest API. Region/voice are not secret but must match the resource the key belongs to. Automated tests' `AZURE_SPEECH_FAKE=true` must never be used as rotation verification.

The current production region is `japaneast`, the voice is `en-US-JennyNeural`, and fake=false; key values must never be written in this document or logs. Planned rotation:

1. Record the Azure resource/region, key ID (not the value), monthly budget, and current error rate; confirm whether Azure currently offers two alternating keys.
2. Without a safe overlap, first turn off `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED` to stop new queue work, then as needed turn off `FEATURE_PRONUNCIATION_ENABLED` or turn on `AZURE_SPEECH_CIRCUIT_OPEN`; text courses, progress, already cached private Storage audio, and browser speech continue.
3. Generate/reset the non-current key, securely update the key/region in `/opt/nalanda/.env`, `chmod 600`, and force-recreate the API container.
4. With a dedicated account and a fixture with no personal data, verify that an uncached word goes from pending→ready and the private Storage bytes/ETag are readable; when a second account creates the same word it must be ready immediately with `attempt_count` unchanged. Then submit a fixed 16 kHz mono WAV of ≤6 seconds (the server limit is still 8 seconds) with no VAD, silence trimming, or content truncation, and confirm the API forwards the raw bytes, phonemes, the revision/session patch, the speech usage reservation, and that the user recording did not enter the DB/Storage/logs.
5. Watch `learning_audio_generation_failed`, queue wait, Storage hit/miss, Azure usage, and API `SPEECH_PROVIDER_*`/429; close the circuit or restore the flags.
6. Reset/revoke the old key and verify again. If the provider only supports Key1/Key2 reset, record which one is now active to avoid resetting the key in use next time.

On a leak, immediately trip the speech circuit, reset the affected key, and check Azure usage/billing and API logs; never delete learning attempts or record provider failures as user errors. TTS is a synthesized result reusable across users, but its bucket is still private; it can be cleared and rebuilt by the durable queue and does not need to move with the key. Rotating only the key does not change cache keys; if the voice, SSML, or post-processing semantics change at the same time, `LEARNING_AUDIO_SYNTHESIS_VERSION` must be incremented, keeping old objects until the new version's hit rate is stable, then cleaning up per the lifecycle.

Changes to `COURSE_MARKET_ADMIN_USER_IDS` need two-person review of the Supabase UUIDs: first add the new administrator and verify audited hide/restore, then remove the old UUID, restart the API, and confirm the old account gets `ADMIN_REQUIRED`. Never replace the administrator list with a shared service-role or an open RPC.

## 13. OpenRouter key (in production use)

`OPENROUTER_API_KEY` is reused by NestJS's Courses capabilities and the isolated Materials AI worker; Courses non-literal translation is fixed to the free Nemotron/Nvidia, and the candidate worker also uses it to call the fixed GPT-6 Luna/Azure, but the key and provider/model choice never reach the browser. Production keeps the source secret in the GitHub `production` environment, and both the server API `.env` and the worker `.ai.env` are mode 600; the worker gets no service-role/Redis/Azure. The repository scripts reject invalid shapes and atomically preserve other variables.

Planned rotation:

1. Create a new key in the OpenRouter console, recording the key ID/fingerprint, credit, and UTC time, without copying the full value into the ticket.
2. Temporarily turn off `FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED`, `FEATURE_MATERIAL_AI_LUNA`, and `FEATURE_MATERIAL_AI`; ordinary spelling, existing Notes, and objective exams still work.
3. Securely update the GitHub `production` secret; through a controlled deployment, atomically update the API and Materials AI env files separately, confirming `OPENROUTER_FAKE=false` and `MATERIAL_AI_FAKE_PROVIDER=false`. Never put the key in arguments or logs.
4. With fixtures containing no personal data, run the structured text-grading gate and the "Azure-synthesized 'apple' WAV → Nalanda STT API awaiting activation" gate separately; only record model/duration/usage/boolean assertions, never printing input, transcripts, or response bodies. If either fails, do not activate the pending release.
5. In the image awaiting activation, run `smoke-openrouter-translation.mjs` to verify the specified model's JSON Object + local strict schema with fixed synthetic samples: a near-synonym answer is true, an unrelated answer is false, and the actual provider is Nvidia. Then, through the real Courses API, verify that replaying the same UUID does not call the provider again, the authoritative spelling attempt after a correct translation, and temporary user cleanup.
6. Use the fixed PDF/DOCX/PPTX/chart/injection/safe-course/grading suite to verify DeepSeek/MiMo strict schema, ZDR, sending only failed regions, citations, and cost; then use the Luna PDF/image gates to verify inline raw bytes, the PDF native parser, and the actual Azure upstream. Separately run the two-sample translation and Fish STT gates. Restore the master switch first, and restore the Luna sub-switch last per the live ZDR catalog; watch provider error/latency/tokens/STT/AI usage one by one.
7. Revoke the old key and repeat both kinds of real smoke tests. On failure, keep the features off; never ship the key to the Web app or switch to client-side grading/recognition.

On a leak, immediately turn off every OpenRouter feature, revoke the key, and check usage/billing, GitHub/server/Actions access, and API/AI logs. The database has no provider prompts/raw responses, but the private parse cache/Notes are still handled as user data. Model or base URL changes are not ordinary key rotations; they need separate evaluation and updates to the ADR/cost docs.

## 14. Stripe secret/webhook secret (not yet implemented)

There is currently no payment controller, webhook endpoint, order/ledger tables, or Stripe SDK. `infra/hybrid-2g/.env.example` and the Caddy comment are only target placeholders.

After launch, rotate them separately:

- API secret key: create a new restricted/live key → update the service → run a test/small controlled transaction → check usage → revoke the old key.
- Webhook secret: if the provider supports parallel endpoints/signing secrets, verify old and new signatures in overlap → update the service → replay fixtures/events → disable the old endpoint/secret.

Webhook event ID idempotency, event replay, order/credits ledger reconciliation, and refund alerts must be kept. No key rotation may "fix" anything by editing balances directly.

## 15. TLS/ACME

nginx TLS is currently managed by certbot on the server. Certificate renewal usually needs no application `.env` change, but a leaked private key/ACME account requires reissuance/revocation.

Planned verification:

```bash
certbot renew --dry-run
nginx -t
systemctl reload nginx
```

After rotation/renewal, check the certificate subject, issuer, validity period, and full chain from outside. See [observability and alerting](./OBSERVABILITY_ALERTING.md) for monitoring thresholds.

## 16. Emergency leak handling

1. Declare a security incident, recording the discovery time, credential type, environment, possible exposure locations, and incident commander.
2. Immediately revoke/disable the affected key; if it can't be switched without loss, pause the corresponding entry point.
3. Generate a new key and deploy in consumer order; never reuse the same value across environments.
4. Search provider audit/usage, GitHub Actions/artifacts, server auth/nginx/API logs, and unusual data writes.
5. For service-role/database leaks, focus the audit on RLS bypass, Auth users, Storage, functions/RPCs, data exports, and deletions.
6. If personal data may be involved, start a privacy/legal notification assessment; preserve evidence but restrict access.
7. Clean up the leak vector. If it entered Git history, rewrite history through an approved process after rotating; deleting only the latest file is not enough.
8. Verify the old key is invalid and the new key path works, and raise the monitoring level for a while.
9. Run a retrospective on the root cause, actual impact, rotation time, and permanent fix.

## 17. Suggested rotation periods (pending approval)

| Credential | Suggested maximum period | Rotate immediately when |
|---|---:|---|
| service-role/high-privilege database credentials | 90 days | Any suspected leak, personnel departure, environment misuse |
| CI SSH deploy key | 180 days | Private key leak, runner/account compromise, personnel change |
| Supabase Personal Access Token | 90 days or short-lived per task | Device/log leak, permission change |
| AI internal token | 90 days | Any consumer leak, server/image compromise, authentication anomalies |
| Stripe secret (future) | 90 days | Usage anomalies, leak, provider recommendation |
| Azure Speech key | 90 days | Usage/billing anomalies, leak, personnel/environment change |
| OpenRouter key | 90 days | Usage/billing anomalies, leak, model/provider access policy change |
| Redis password / RateLimit HMAC | 90 days | Either value leaked, server/runner compromise, actor audit boundary change |
| Webhook signing secret | 180 days | Signature anomalies, endpoint leak |
| JWT signing key | Per provider capability and session policy | Key leak/algorithm change/provider notice |
| TLS certificate | Auto-renewal; alerts at 21/7/2 days | Private key leak |
| Backup encryption key | 180 days, using key versions | Key leak, access policy change |

Periods are target upper limits and do not mean rotation is already automated. Every secret must have an owner, creation date, expiry date, consumers, last verification date, and revocation evidence.

## 18. Rotation completion checklist

- [ ] The new credential exists only in the approved secret store/target processes;
- [ ] The Web app contains no server secrets, and static artifacts have been rebuilt as needed;
- [ ] Every environment and consumer has been verified, and no old instance still uses the old key;
- [ ] The old credential has been revoked and negatively verified as invalid;
- [ ] Logs, CI, artifacts, and backup metadata contain no full secrets;
- [ ] Monitoring shows no new Auth/5xx/provider errors, and usage points at the new key;
- [ ] The ticket records the key fingerprint/ID, time, operator/reviewer, and verification evidence;
- [ ] The environment variable matrix, runbooks, and asset inventory are in sync.
