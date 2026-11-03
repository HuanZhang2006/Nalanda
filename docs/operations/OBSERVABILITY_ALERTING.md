# Observability, Monitoring, and Alerting

> **About this document**
> - **Contents**: Describes the health checks and logs available today, defines target SLIs/SLOs, alert thresholds, and logging/metrics conventions, and gives troubleshooting steps for API, nginx, Supabase, resource, and deployment failures.
> - **Purpose**: Lets the team detect failures proactively, identify the failing layer quickly, protect user data, and complete response and retrospectives with consistent evidence.
> - **When to update**: When the service topology, endpoints, logging/metrics platform, SLOs, alert thresholds, on-call/escalation path, third-party dependencies, deployment, or incident patterns change; review after every P1/P2 incident.

## 1. Current state

Signals available today:

- `GET /api/health`: production 0043 really probes Supabase, validates the HMAC configuration, and runs a Redis PING; if either Supabase or Redis fails, readiness is 503. `GET /api/health/ai` checks the worker, queue, and internal dependencies, never passing off "the variable exists" as readiness;
- FastAPI `GET /health`: actually checks the OpenRouter configuration, LibreOffice, temporary disk, and internal authentication; a production fake fails explicitly. The latest app candidate rolled back after real gates failed, and the Materials AI/Luna flags currently stay off; health itself does not call real models each time;
- The deploy workflow verifies the JSON `status/service/deps.supabase/deps.redis` of both the local and public `/api/health`, and checks the public Web root; on failure it rolls back to the previous Web/API release;
- The API writes to container stdout/stderr via NestJS/console, viewable with `docker compose --env-file .deploy.env logs`;
- nginx access/error logs, systemd, Docker, and host resource commands;
- GitHub Actions deploy run results;
- The current production stable release `3c095a55ced21cee11a1b3131dd2889ec1f70733-31574116130-1` had its API/Web, Supabase/Redis/AI health, and anonymous authentication independently checked after the latest candidate rolled back, with the Materials AI/Luna flags both false; the earlier false green of workflow `31463661987` proves that an Actions success cannot replace these independent signals;
- The Supabase dashboard provides platform-side Auth/database/Storage logs and metrics, with availability depending on the project configuration.
- When Courses reports reach the configured threshold, the API emits a single-line JSON `event=course_report_threshold`; speech quotas/estimated costs persist in `learning_speech_usage`, and 429s use the stable `SPEECH_QUOTA_EXCEEDED`; these still need manual log/SQL inspection and are not a full alerting chain.
- The 0015 app emits redacted single-line JSON: `learning_session_snapshot`, `learning_attempt_committed`, `learning_attempt_revision_conflict`, `learning_audio_pending`, `learning_audio_storage_hit/missing`, `learning_audio_generated/cache_recovered/generation_failed/worker_failed`, with limited fields such as duration, revision, cache key, queue wait, attempt, and bytes/error code; claim/database failures back off briefly, and none of this is wired into centralized collection/alerting yet.
- The translation pre-test emits a redacted `learning_spelling_translation_assessed` event containing only provider/model, duration, correct, and prompt/completion token metering; normalized exact matches record `nalanda-normalized-exact/normalized-exact-v1` with zero tokens, and real OpenRouter calls are counted separately. After 0027, monitor separately the actual provider requests with `quota_counted=true`, the per-minute/rolling 24-hour 429s, and `retryAfterSeconds`, and never count exact matches/replays/lease-only claims as usage. When an HTTP 200 lacks a valid boolean, a content-free `learning_spelling_translation_provider_retry` is also emitted. None of these events may contain the API key, user input, course translations, the full prompt, or provider responses.
- 0037 STT emits `learning_translation_voice_transcribed`, containing only provider/model/language, audio seconds, provider/API duration, and usage/cost numbers; it must not contain base64/WAV, transcripts, words, course translations, user IDs, or keys. The database provides per-minute/local-day/monthly budget facts via `learning_speech_usage.kind=translation_stt`; the Web app should also count recording starts/permission denials, empty results, discarded late transcripts, and the actual submission rate after fill-in, but must never collect the recognized text.
- Production 0039 emits `rate_limited`, `rate_limit_degraded`, `rate_limit_audit_failed`, `redis_error`, and `point_abuse_scan_completed/failed`; they contain only the route group/rule, HMAC actor, an optional internal user UUID, retry seconds, or aggregate counts, never raw IPs/emails/content. Coordination signals and API abuse buckets persist in PostgreSQL, and the first version explicitly only has structured logs, with no webhook/pager.
- 0041–0043 provide queue age, stage duration, lease retries, parse/visual recovery, schema repair, DeepSeek/MiMo duration/token/cost/ZDR, Notes save, grading, and temp cleanup signals through DB events/provider usage; bounded provider retries return each HTTP/empty/truncated/bad JSON/schema failure before success and the final success as separate redacted usage events counted against the budget, and the final success's duration includes the total wait. Logs and release smoke tests may only contain job/attempt UUIDs, file type/size, range counts, and stable worker/provider purpose/error codes, never signed URLs, content beyond file names, prompts, answers, or raw responses.
- The 0046–0051 candidate switches API→worker to fast 202 acceptance and durable callbacks, and adds pipeline, real upstream, delete cleanup, and layout revision signals; 0056–0057 retire Ox and fix the Luna upstream to Azure. Monitor separately: `AI_WORKER_TIMEOUT`/unreachable, callback failures, checkpoint/resume, usage spool replay, event UUIDs, Luna native mode, the real upstream/endpoint (Azure), provider routing violations, ZDR capability decisions, deleting age/cleanup attempts, graph layout conflicts/250-node layouts, and whole-paper grading. The 301.896-second Undici response-header timeout sample from 2026-08-12 was not a worker OOM/crash; that classification must be kept.

Currently missing:

- External continuous probes, SLO dashboards, centralized logging, structured request logs, traces, a metrics endpoint;
- Error tracking, a pager/on-call schedule, alert routing, and alert drills;
- `/api/health` does not yet check Storage, sign-up writes, full RLS, Redis memory/AOF disk state, or AI connectivity; production 0039 only added a real Redis PING;
- Web frontend exceptions and failures of direct browser-to-Supabase calls have no centralized server-side signal;
- Alerts for daily backup freshness, RLS/data integrity, TLS expiry, cost, AI quality, and payment reconciliation; pre-migration encrypted recovery points have a CI gate but no continuous alert.
- There are no centralized metrics yet for Courses route/stage/resume success rates, browser outbox depth, stale active sessions, review schedule backlog, course points/badge anomalies, the report queue, or Azure/OpenRouter latency/error/cost; structured events are only raw signals, and `/api/health` does not probe the learning schema, the audio queue/Storage, or any provider.

So "deploy health ok" proves basic API→Supabase JWKS/PostgREST connectivity, but still does not prove Storage, direct browser access, the sign-up/sign-in write paths, or all core business is healthy.

## 2. Service and signal map

| Layer | Running now | Available signals | Main blind spots |
|---|---|---|---|
| DNS/TLS/nginx | Yes | External curl, nginx logs, certificate tools | No continuous probe/expiry alerts |
| Web static site | Yes | nginx status/access, manual browser checks | No RUM/JS errors/performance |
| NestJS API | Yes | `/api/health`, container logs | No latency/status metrics/request IDs |
| Supabase Auth | Yes | API health's JWKS probe, platform logs, sign-up errors | Sign-in goes directly from the browser; health doesn't perform a real sign-in |
| Supabase Postgres/PostgREST | Yes | API health's empty profiles query, platform metrics/logs | No application-level business query/error dashboard |
| Supabase Storage | Yes | Platform logs, manual business checks | No object integrity/orphan/capacity alerts |
| FastAPI Materials AI | Production 0041–0043, worker and flag enabled | Real-dependency `/health`, stage callbacks, provider usage, uvicorn logs | No continuous real quality/cost dashboard; content must never be logged |
| Courses API | Feature migrations enabled up to 0038, overall production history at 0043 | Stable API error codes, DB facts, attempt/snapshot duration JSON events | No centralized route/stage/outbox/resume/exam/mastery/spelling normalization or punctuation tolerance branch metrics; health doesn't check the learning schema |
| Azure Speech | Enabled in production (Japan East), durable queue open | Provider error codes, speech usage reservations, queue wait/generate/storage-hit JSON events, circuit flag, pre-release real gate | No continuous latency/availability/queue/billing reconciliation alerts; recordings must never enter logs |
| OpenRouter translation pre-test / Fish Audio STT | Both feature migrations enabled up to 0038, overall production history at 0043 | Structured grading and STT duration/usage JSON events, database leases/separate quotas, real release gates | No continuous accuracy/latency/credit/price reconciliation; answers, recordings, and transcripts must never enter logs |
| Course Market | Enabled in production (free) | publication/report/action tables, threshold JSON logs | No moderation workbench, pager, or report SLA |
| Redis request protection/BullMQ | Request protection enabled by production 0039; BullMQ by production 0041 | PING readiness, `rate_*`/`redis_error`, BullMQ execution/reconcile, real CI Redis tests | No centralized memory/AOF/eviction/queue depth alerts; Redis is not the points/job/allowance store of record |
| Stripe/payments | Not implemented | None | Webhook/reconciliation alerts must be added before launch |
| Backups | Pre-migration encrypted recovery points | Actions artifacts/manifest | No daily backups, Storage bytes, age/recoverability alerts |

## 3. Target SLIs/SLOs (pending approval)

The following are a **suggested baseline** for starting monitoring work, not a current SLA. Product and engineering owners must confirm them based on real traffic, support capacity, and cost.

| User capability | SLI | Suggested target/window |
|---|---|---|
| Site reachable | External HTTPS request success rate | 99.9% / 30 days |
| API available | External 2xx on `/api/health` | 99.9% / 30 days |
| API responsiveness | API p95 latency | < 500 ms / 5 minutes (health < 300 ms) |
| Sign-up | Success rate of valid sign-up requests | ≥ 99% / 1 hour; excluding clear user input errors |
| Sign-in/auth | Success rate of the synthetic Supabase sign-in + `/api/me` path | ≥ 99% / 15 minutes |
| Data reads/writes | PostgREST read/write success rate for an isolated smoke account | ≥ 99.5% / 15 minutes |
| Private materials | Synthetic upload + signed URL + download success rate | ≥ 99% / 1 hour, using a small non-sensitive fixture |
| Backups | Age of the latest verified recovery point | Database < 24 hours; target PITR metrics per RPO |
| Data protection | Cross-user RLS denial rate | Tests should deny 100%; any success is P1 |
| Courses persistence | Create/answer/resume success rate (excluding legitimate 4xx) | ≥99% / 15 minutes; the same intent must resume the same active session, and different units/modes must never cross over |
| Pronunciation synthesis | Azure worker success rate/generation latency, Storage/browser cache hit | ≥98% / 1 hour; ready cache playback p95<300 ms, queue wait explainable by the 3.1-second rate limit; failures may degrade and don't count as text courses being unavailable |
| Weak-network answering | Provisional→server-confirmed latency, outbox age/conflict rate | Instant feedback p95<one frame; online confirmation p95<1 second; oldest outbox >5 minutes or an abnormal conflict rate needs investigation |
| Read-aloud scoring | Provider success rate for valid WAVs | ≥97% / 1 hour; provider failures never write error counts |
| Translation semantic pre-test | Provider success rate, structured output rate, user retry rate for valid requests | Provider success ≥97% / 1 hour, schema validity 100%; p95 <3 seconds as an observation target; provider failures must never write error counts |
| Review schedules | Success rate of due pending items being entered/completed | ≥99%; never mistakenly create `study_tasks` or +5 |
| Request protection | Rate-limit decision latency, 429/503, Redis availability/memory | Redis PING ≥99.9%; false 429s on legitimate traffic close to 0; noeviction/AOF configuration drift blocks releases |
| Points integrity | ledger/Profile projection, cap/moderation transitions | Projection difference must be 0; only one first decision per business key; coordination signals only change the pending-review queue |
| Materials AI generation | Success rate, queue wait/stage/provider/total latency, citations/schema, stable validation category, cost | Legitimate job success ≥95%; oldest queued <5 minutes; schema/source 100%; per-run budget hard gates never exceeded; logs never contain reviewer/source/answer text |
| Materials AI recovery/graph/Luna/Ox | accept/callback, checkpoint/usage, delete cleanup, pipeline/upstream, graph/layout/Q&A schema/source, ZDR catalog decision | accept p95<2 seconds; callback backlog<1 minute; recovery within the window repeats no provider calls/costs; deleting p95<30 seconds with zero residue; with Luna on, upstream 100% OpenAI/PDF native 100%, with Ox on, upstream 100% Stealth/input 100% images; with no matching ZDR endpoint, sub-flags stay false 100% with a stable reason; zero duplicate side effects per usage UUID; graph schema/source order/citations 100% |
| Online exams | Draft revision, deadline submit, grading queue/allowance | Confirmed saves p95<1 second; expired attempts are always submitted eventually; zero side effects for the same operation UUID |

Keep synthetic monitoring from polluting real metrics: use dedicated accounts/courses/file prefixes, clean up after tests, and prevent triggering points, notifications, and public community content. Synthetic write tests in production must not be turned on automatically until idempotent cleanup exists.

## 4. Alert severity and suggested thresholds

| Level | Condition (suggested initial values) | Response target | Examples |
|---|---|---|---|
| P1 | Site/API fails 3 times in a row externally; suspected cross-user data access; data corruption; duplicate payment charges (future) | Acknowledge within 5 minutes, act immediately | nginx/API down, RLS bypass, production secret leak |
| P2 | API 5xx > 5% for 10 minutes; sign-up/sign-in failure rate > 10%; disk > 90%; backup older than 2×RPO | Acknowledge within 30 minutes | Partial Supabase outage, container restart loop, backups interrupted |
| P3 | p95 over threshold for 30 minutes; disk > 80%; TLS < 21 days; abnormal error trends | Handle within 1 business day | Performance degradation, certificate or capacity warnings |
| Info | Deploy success/failure, secret rotation, recovery drill results | Record/escalate on failure | Release auditing |

Suggested alert rules:

- Probe the external site `/` and `/api/health` every minute, re-checking failures from two network locations;
- API container restart count increasing, or ≥ 3 restarts within 10 minutes: P2;
- nginx 5xx > 2% for 10 minutes: P2; >20% for 5 minutes: P1;
- `deps.redis=unavailable` 3 times in a row, a Redis restart loop, AOF write failures, or `noeviction` drift: P2; escalate by user impact when this causes sign-up/write 503s for >5 minutes. Memory ≥80% P3, ≥90% P2, and never temporarily switch to eviction;
- `rate_limit_degraded` appearing during normal operation, an abnormal 429 ratio for legitimate accounts, or a sudden rise in rejection milestones for a single HMAC actor: P2/P3 investigation; never reverse or record raw IPs/emails in alerts;
- Host available memory < 100 MiB for 10 minutes: P2; disk > 80% P3, > 90% P2;
- TLS remaining < 21 days P3, < 7 days P2, < 48 hours P1;
- Supabase database capacity/connections/CPU reaching platform warning thresholds: P2; thresholds must be configured per the actual plan;
- Latest database backup/recovery point > 24 hours: P2; quarterly recovery drill overdue: P3;
- CI deploy failure: P2; external probe failing after a release: P1/P2 depending on impact;
- Any security regression test finding RLS overreach, a service-role leak, or a high-privilege RPC executable by ordinary users: P1.
- Courses progress/badges/points writable by clients, anonymous PostgREST reading share/market private tables, revoked tokens still able to clone, or publication content being modifiable: P1;
- Azure estimated monthly budget ≥80%: P3, ≥95%: P2 and consider tripping the circuit; over budget/sustained 429: P2; provider 5xx/timeout >10% for 10 minutes: P2 and open the speech circuit, keeping text learning;
- OpenRouter provider 5xx/timeout/invalid-structure combined >10% for 10 minutes, or token/request volume more than 2× baseline: P2, turn off `FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED` and keep ordinary/timed spelling; a sudden deviation of the semantic error rate from the fixed eval baseline: P2/P3, stop the feature first rather than loosening the model's judgement. 429s from the product's user quota are handled as info/abuse investigations, and 429s from the provider account credit as P2;
- Fish Audio STT timeout/5xx/invalid/empty transcript >10% for 10 minutes, p95 >8 seconds, or the monthly budget ≥80%: P2/P3; first turn off the translation voice entry that depends on it and keep keyboard input, never bypassing owner/revision checks, switching to direct browser calls, or auto-submitting recognized text. When real users' CER/key-meaning retention falls below the evaluation baseline, pause the entry and review the model/language hint.
- Materials AI oldest queued >5 minutes, a lease recovered three times in a row, worker restarts ≥3/10min, temp orphans older than the configured resume TTL, the single concurrency slot released while FastAPI still has several active jobs, temporary disk below 512 MiB, RSS/swap/cgroup OOM, or provider/ZDR/schema/injection false-positive anomalies: P2; the same real gate still showing persistent `OPENROUTER_RATE_LIMIT` after bounded retries is also P2 and keeps the feature off. Cross-user access/content in logs/ZDR bypass or duplicate quota/results is P1. Turn off `FEATURE_MATERIAL_AI` first, keeping existing Notes/exams read-only, and never recover by loosening ZDR, fallback, resource limits, or editing jobs/quota directly.
- In callback mode, accept >30 seconds, consecutive callback failures, checkpoint stage regressions, usage spool >5 minutes, multiple cost facts for the same event UUID, or Resume calling an already completed provider stage again are all P2; deleting >5 minutes, growing cleanup retries, or directory/checkpoint/spool residue after purge are also P2. Turning on the Luna/Ox flag while the OpenRouter catalog has no matching ZDR endpoint is P1; Luna's actual upstream not being OpenAI, Ox's actual upstream not being Stealth, automatic fallback/conversion occurring, Ox accepting non-images, routing-violation results being saved, or duplicate allowance charges/cross-user layouts/Q&A are likewise P1. Turn off the corresponding sub-switch first, never recovering by loosening routing.
- AI monthly cost ≥80% of US$20 is P3, ≥95% P2; a single generation >US$0.50 or grading >US$0.05 must be blocked by the hard gate with the user's reservation released. Token/cost billing differences and unknown request IDs trigger an investigation.
- `learning_audio_assets` oldest pending over 15 minutes, processing leases expired for 5 minutes, generation failure >10%, or ready-metadata object misses >1%: P2; minute/month quota pauses are graded by budget thresholds, never bypassed by raising concurrency;
- A sudden rise in `learning_attempt_revision_conflict`, the oldest outbox item in a session >5 minutes, or an abnormally rising replay ratio: P2/P3; check the network/API/multiple devices first, never advance the cursor by hand;
- Multiple positive +20 entries for the same course completion fingerprint, a review schedule producing task +5, or duplicate badge PKs/inconsistent facts: P1/P2 by economic impact;
- Any difference between Profile points/level and the ledger projection, multiple claims for the same business key, cap counts out of bounds, or suppress producing negative points beyond the historically received amount: P1; a sudden rise in the number/age of pending coordination signals is information for manual review and never an automatic penalty;
- A course report reaching `COURSE_REPORT_ALERT_THRESHOLD`: info/moderation queue; escalate to P3 if unhandled for 24 hours. The count alone never delists.

Observe a two-week baseline before tuning any threshold, and keep a change record. Alerts must point to a specific runbook on this page, and test alerts must be sent regularly to verify routing.

## 5. Checks you can run now

### 5.1 External checks

```bash
curl -fsS --max-time 10 https://nalanda.online/api/health
curl -fsSI --max-time 10 https://nalanda.online/
```

In API health, `deps.supabase=ok` means JWKS and an empty PostgREST query succeeded within the timeout; with the 0039 app, `deps.redis=ok` means the HMAC configuration is valid and a real PING succeeded; `ai=configured` still only means the variables are non-empty. This endpoint must not be treated as complete readiness for Storage, RLS, sign-in, Redis AOF/capacity, or AI.

TLS check:

```bash
echo | openssl s_client -servername nalanda.online -connect nalanda.online:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

### 5.2 Server checks

```bash
cd /opt/nalanda
docker compose --env-file .deploy.env ps
docker compose --env-file .deploy.env logs --since=30m --tail=300 api ai redis
docker compose --env-file .deploy.env exec -T redis sh -ec \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping; REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli INFO memory | sed -n "1,12p"'
curl -fsS --max-time 5 http://127.0.0.1:8411/api/health
docker stats --no-stream
df -h
free -m
```

nginx:

```bash
nginx -t
systemctl status nginx --no-pager
tail -n 200 /var/log/nginx/error.log
```

These commands may need server administrator privileges. Never paste `.env`, full request headers, JWTs, or secrets into collaboration channels/tickets.

### 5.3 Quick layer diagnosis

| Symptom | Most likely layer | Next step |
|---|---|---|
| External `/` and `/api/health` both fail; the server can't be reached over SSH | Host/network/DNS | Host provider, DNS, ports, and resource status |
| External fails; local `127.0.0.1:8411` is fine | nginx/TLS/DNS | `nginx -t`, error log, certificate, server_name/reverse proxy |
| Both external and local API fail | Container/API | compose ps/logs, restart count, memory, image/`.env` |
| Only health shows `deps.redis=unavailable`; private GETs still work while sign-up/writes return 503 | Redis/password/HMAC/AOF/network | Redis health/log/volume/memory, the API `REDIS_URL` and `.redis.env`; never switch writes to fail-open |
| API health 200, but sign-up fails | Supabase Auth, service-role, DNS | API logs, whether the variables point at the same project, Supabase Auth logs |
| API health 200, but sign-in/business queries fail | Browser→Supabase, JWT, RLS, migrations | Supabase logs, project URL, JWKS, RLS/table structure, frontend console |
| AI `/health` shows `tempDisk=pressure`, then the API returns 502 | Low root disk watermark + the compose AI-healthy dependency | First recover the API independently with the current `.deploy.env`; check `df`, `docker system df`, incoming, and the current image, then do targeted cleanup per the resource runbook below |
| Only upload/preview fails | Storage policy/object/signed URL | Bucket, first path segment, object policy, expiry, browser errors |
| Old static pages but a new API after release | Artifact/nginx cache/upload | `/opt/nalanda/web` mtime, workflow artifact, browser cache |
| Courses uniformly disabled/404 | Flag/circuit configuration drift or a release rollback | First check the production history, the current image, and the server `.env`; never open client RPC/table writes |
| Courses work but no pronunciation/scoring | Azure flag/key/region/circuit/budget | Judge by error code and speech usage; keep the browser speech degradation |
| The translation pre-test fails uniformly/is slow | OpenRouter flag/key/model/timeout/credit or structured output | Layer by the stable error code and redacted duration/token events; provider failures don't count as errors, and you can turn off the translation pre-test first, but never ship the key to the browser or switch to client-side grading |
| AI jobs fail uniformly at about 300 seconds as unreachable | The old API→worker long HTTP hitting the Undici headers timeout | Check the error cause/duration, worker restarts/OOM, and stage; the candidate should return 202 and progress through callbacks, mapping timeouts to `AI_WORKER_TIMEOUT`. Don't blindly rerun and pay providers twice |
| An AI job shows Resume | A recoverable provider/worker/callback failure | Check `retryable/resumeUntil/checkpointStage/resumeCount` and the local spool age; within the window only call Resume on the same job, and after expiry it fails stably and cleans up; never create a duplicate job to bypass quota |
| Sessions lost/duplicated after refresh | Active unique/session RPC/API | Query active rows for the same user/course, the state queue/cursor, API 5xx; never fabricate progress in the frontend |
| Course progress or +20 anomalies | progress/growth/fingerprint | First confirm the production migration version; from 0033 on, reconcile both `*_exam_passed_at`, both exam types' first-round score/`examPassed`/end-of-round confirmation/completed, and confirm reviews only change attempts/the three date groups without writing learned; then check the `learned_at` check constraint and the point business_key and source, pausing Courses reward writes if needed |
| A Course Market course disappeared | Publication status/moderation | Check moderation actions and the administrator configuration; never restore/delist based on report counts alone |

## 6. Incident runbooks

### 6.1 API unavailable

1. Reproduce from outside and record the UTC time/status code, without sending a real user token.
2. On the server, check compose status, recent logs, resources, and local health.
3. If the container stopped, save the logs and exit reason first, then run `docker compose --env-file .deploy.env up -d`; don't restart endlessly to hide OOM/configuration errors or bypass the Git SHA image.
4. If a deployment just happened, check the workflow, image build, and environment files; there is currently no reliable previous image, so be careful about claiming a "rollback".
5. After recovery, verify health, sign-in, and the affected path from outside, and keep watching.

### 6.2 Widespread sign-up/authentication failures

1. Separate the three segments: the sign-up endpoint, browser Supabase sign-in, and `/api/me`.
2. Check the Supabase project status, Auth logs, and JWKS reachability.
3. Check that the Web `VITE_*` and the API `SUPABASE_URL` point at the same project.
4. Check recent signing key/service-role/anon key rotations and verify both sides were updated per [secret rotation](./SECRET_ROTATION.md).
5. Never restore service by turning off RLS, shipping service-role to the browser, or skipping JWT verification.

### 6.3 Data anomalies/suspected unauthorized access

1. Treat it as P1 immediately, restrict the related write entry points, and keep Supabase/application/deployment logs.
2. Determine the table, users, time window, and whether service-role/RPCs are involved; never spread personal data in logs.
3. Verify whether migrations, RLS, grants, and function EXECUTE have drifted.
4. If damage has occurred, first restore into an isolated project to assess, per [backup and recovery](./BACKUP_RECOVERY.md).
5. Rotate possibly leaked secrets and complete the notification/compliance assessment.

### 6.4 Host resource pressure

1. Locate memory/disk with `docker stats --no-stream`, `free -m`, and `df -h`.
2. Check usage by logs, `/opt/nalanda/incoming`, `docker system df`, and Docker layers; preserve incident evidence before cleaning. The pre-release gate cleans same-SHA partial uploads, abandoned incoming older than 24 hours, and Nalanda images that no container references and that are not in the current `.deploy.env`, and requires at least 6 GiB free; never broaden this into indiscriminate deletion across the server.
3. Never delete `/opt/nalanda/.env`, valid Web artifacts, unknown database backups, or certificates.
4. If AI is unhealthy because of the disk watermark and the Compose dependency prevents the API from recovering, save the state and logs first, then run `docker compose --env-file .deploy.env up -d --no-deps api` with the current audited configuration and verify local and public health/auth; this only recovers the API and does not mean AI is recovered. After freeing space, separately verify AI `/health` shows `tempDisk=ok`.
5. Production 0043 has the API, a 128 MiB Redis container/persistent volume, and a single-concurrency AI container with 640 MiB/896 MiB swap limits, 0.75 CPU, and 128 pids. Check the current release/compose first; when kernel OOM occurs or neighboring sites are affected, turn off the Materials AI flag and keep the existing Notes/exam read-only paths.

### 6.7 Materials AI / online exams

1. First check the Supabase/Redis status in `/api/health` and `/api/health/ai`, then look at `generation_jobs` queued/stage/lease/attempt/error and BullMQ/the reconciler; the Postgres job is the fact, and never patch state by hand in Redis.
2. Layer provider problems by purpose/model/request ID/duration/token/cost/ZDR; never read or copy file content, prompts, answers, or signed URLs. ZDR unavailable, bad schemas, or safety uncertain all keep failing closed and release the reservation.
   For `OPENROUTER_RATE_LIMIT`, first check the bounded attempt count, backoff configuration, the provider's `Retry-After`, and same-model provider failover; never add cross-model fallback, switch models, or remove ZDR/deny/require-parameters to make the gate green. If the same fixed sample still fails after bounded retries, keep the feature off and rerun the real gate after the provider window recovers.
   For `AI_EXAM_VALIDATION_FAILED`, only inspect `initialGate/finalGate`, the structural code, semantic category, and expected/actual question counts/total marks; never log reviewer issues, questions, answers, courseware, or provider bodies for troubleshooting. `ANSWERABILITY`/grounding failures on a thin fixture should be fixed by correcting the fixed sample with no personal data and rerunning the gate, and do not equal a worker outage; the user reservation should still be released. If only `SOURCE_REFERENCE` remains after the initial pass or the repair, check whether the output citations fall within the DocumentIR block allowlist, whether the locators come from the server, and whether question IDs are stable; when the allowlist has a single block, it may be normalized to that single source and must still pass the semantic review, and with several blocks it must not be guessed. Never turn off citation validation or skip the second semantic review after repair.
3. For disk/Office problems, check container RSS/swap, cgroup OOM, orphans under `/tmp/nalanda-material-ai`, and the watermark; after turning off the flag, only clean directories confirmed to be older than an hour and not belonging to an active job.
4. Reconcile exam problems by attempt/revision/operation UUID/deadline; when Redis loses a delayed task, the next API request must force the expiry submission. When the grading allowance is used up, keep `submitted_ungraded` and never fake completed.
5. After the fix, use a fixture with no personal data to verify one full generation, Notes, objective/subjective grading, deletion, and temporary directory cleanup; record the real provider smoke and the fake Playwright separately.
6. Troubleshoot candidate callback/recovery incidents across five segments: transport → accept → callback → DB checkpoint → local checkpoint/usage spool. First confirm whether the provider usage event UUID has been persisted before deciding whether to rerun a stage; only redo a provider call when the checkpoint is clearly missing. After a successful recovery, reconcile the provider request ID, the unique event UUID, the same job ID, quota consumed exactly once, and terminal cleanup.

### 6.5 Courses / Azure / Course Market

1. Narrow the impact first via the master switch → sharing/market/audio prewarm/speech sub-switches; prefer turning off `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED` to stop new prewarming, and open the speech circuit if needed. Turning off speech doesn't block text learning, and turning off the market doesn't delete private courses.
2. Locate with the request time, the stable `code`, a redacted user ID hash, and course/session IDs; never log tokens, word lists, translations, WAVs, raw phoneme responses, or the Azure key.
3. For Azure anomalies, first compare queue wait, quota reservations, provider duration, and Storage hit/miss. Once a provider/budget problem is confirmed, set `AZURE_SPEECH_CIRCUIT_OPEN=true` and restart the API; verify the browser speech degradation and that attempt/wrong_count did not increase because of provider failures. Don't treat Storage network errors as object misses that trigger duplicate generation.
4. For growth anomalies, first turn off the Courses master switch or the related release, and query the entries/state for the same `learning-course-completed:<user>:<fingerprint>`; never delete the ledger or hand-edit the Profile projection.
5. Reports only trigger manual review. Emergency hiding must be done by a configured administrator through the API with a reason and a confirmed moderation action; restoring is recorded the same way.
6. Reconcile answer sync anomalies by `sessionId + revision + attemptId` against the append-only facts/response snapshots; a duplicate UUID should not increase wrong_count, and after a 409 the client may only replay still-matching questions with the latest snapshot. Never edit the session state directly.
7. After the fix, verify in order: owner, session snapshot, outbox replay, audio manifest/Storage hit, schedules, points idempotency, share revocation, and market cloning; record flag changes, the impact window, and compensation decisions.

### 6.6 Redis, rate limiting, and points moderation

1. First distinguish nginx 429, Nest 429, `RATE_LIMIT_UNAVAILABLE`, and the `/api/health` Redis 503; keep the route group/rule/time bucket, and never collect raw emails, IPs, or content.
2. Check Redis container health, PING, AOF errors, memory, and `noeviction`. Passwords/HMAC must never appear in command output; handle credential mismatches per [secret rotation](./SECRET_ROTATION.md).
3. During a Redis outage, keep write/sign-up/cost paths failing closed; only the private pure reads the code already classifies may fail open. Never temporarily turn off the interceptor, widen trust proxy, or put service-role in the client.
4. Reconcile points anomalies per business key: claim → state → entries → Profile projection; never edit the Profile, claims, or historical entries. When action is needed, only use the admin API, with the reason/case reference required.
5. A coordination scanner failure only affects new signals and should never freeze users or reverse rewards. Rerun after the lock/database recovers; pending signals are reviewed manually, and a threshold hit is not a violation finding.
6. After recovery, verify the standard 429 headers, concurrent windows for the same user, private read degradation, the scanner's single lock, and the ledger projection, and record false limiting and the affected window.

## 7. Logging conventions (target)

The API/AI should emit single-line structured JSON:

| Field | Description |
|---|---|
| `timestamp`, `level`, `service`, `environment`, `version` | Basic context |
| `request_id`, `trace_id` | Correlation across nginx/API/AI; generated/propagated at the entry point |
| `method`, `route_template`, `status_code`, `duration_ms` | Source of HTTP metrics; routes use templates to avoid high cardinality |
| `user_id_hash` | When needed, an irreversible/per-environment salted identifier; never the email |
| `error_code`, `exception_type` | Stable error classification, never the input content directly |
| `dependency`, `dependency_status`, `retry_count` | Supabase/AI/Redis/Stripe |
| `route_group`, `rule`, `actor_hmac`, `retry_after_seconds` | Rate-limit aggregation; the actor may only be an HMAC generated with a separate secret, never a raw IP/email |

Never log: passwords, Authorization/cookies, Supabase access/refresh tokens, service-role/JWT/OpenRouter/internal tokens, database connection strings, signed URLs, full courseware/prompts/raw model responses/answers/notes/feedback content, or payment card data. Define the purpose, sampling, and retention period for emails, file names, IPs, and user agents.

Courses additionally forbids logging: plaintext share tokens/token hashes, full word lists/translations, user WAVs, and raw Azure recognition payloads. It may log route templates, stable error codes, hashed users, course/session UUIDs, stage, bytes/duration, provider latency, aggregate scores, and estimated micro-USD; phoneme content is only kept where it is returned within the user's request and where restricted learning facts need it.

## 8. Target dashboards

At minimum:

1. **User entry**: site/API availability, latency, HTTP status, regional probes, TLS/DNS.
2. **API**: RPS, p50/p95/p99, 5xx, route/error code, restarts, CPU/memory.
3. **Supabase**: Auth success/failure, PostgREST errors/latency, DB connections/CPU/storage, slow queries, Storage errors/capacity.
4. **Business**: sign-ups/active users, material upload success rate, task completion, community writes; aggregate data only.
5. **Courses**: create/save, snapshot p50/p95, attempt commit p50/p95, revision conflicts/replays, browser outbox age, retry rounds, review/mastery/errors, +20 fingerprints and badges; avoid high-cardinality term labels.
6. **Speech/Market**: queue depth/oldest wait/lease retries, Azure generation p95, Storage/browser cache hit, ready-object misses, 429/circuit, characters/estimated vs. actual billing differences, scoring p95; publications/clones/reports/actions and their handling age.
7. **Data protection**: backup age/size/verification, recovery drills, RLS security tests, abnormal function permissions.
8. **Request protection/points**: Redis health/memory/AOF, decision latency, 429/503/degraded, audit buckets, pending signal age, cap claims, and ledger/Profile projection differences.
9. **Releases**: Git SHA, deploy time, failures, error rate before and after changes.
10. **AI**: queue depth/wait, 202 accept, callback backlog, job success/retry/timeout classification, checkpoint stage/age, resume expiry, usage spool/replay, unique event UUIDs, tokens/cost, model/prompt version, exam/graph/Q&A schema/citations, and quality evaluation.
11. **Payments (once enabled)**: webhook latency/failures/replays, order vs. Stripe reconciliation differences, refunds, unbalanced ledgers.

## 9. On-call and escalation path

The repository currently names no owner or pager. Before turning on continuous alerting, fill in the following in the team's system:

```text
Primary engineering on-call:
Secondary / incident commander:
Supabase owner:
Server/nginx owner:
Security/privacy contact:
Product/customer communication owner:
Status page / incident channel:
Supplier support contacts:
```

A P1 must have an incident commander, a fixed update cadence, and a kept timeline; a P2 needs an owner and a deadline; a P3 goes into a trackable backlog. Complete P1/P2 retrospectives within 2 business days of recovery, with every action having an owner/deadline/verification method.

## 10. Launch gates

- External probes and at least one notification channel are verified;
- API structured logs/error tracking leak no secrets;
- Key alerts have runbooks, owners, deduplication, and recovery notifications;
- Test alerts have been triggered manually in staging;
- `/api/health` is split into liveness/readiness, and readiness really checks the required dependencies with timeouts;
- Backup age and recovery drills are alerted on;
- Quality, cost, queue, and ledger alerts for new AI/payment/moderation modules are complete before production traffic.
- Before the Courses private beta, there are at least route/error, DB capacity, growth idempotency, and review backlog signals; before real Azure, cost/429/provider alerts and a one-click circuit; before sharing/market, report threshold routing and admin action auditing.
