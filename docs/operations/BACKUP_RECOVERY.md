# Backup and Recovery

> **About this document**
> - **Contents**: Defines the backup scope for the database, Auth, Storage, configuration, and application artifacts, plus release recovery points, verification, isolated recovery, and disaster failover steps.
> - **Purpose**: Distinguishes "some dump exists" from "fully recoverable", and provides a recovery path that never automatically overwrites new production writes.
> - **When to update**: When the data model, Supabase backup capability/plan, Storage, CI artifacts, encryption, retention, RPO/RTO, or recovery owner change; must be updated after every drill and incident.

## 1. Current state

Currently implemented **release-level database recovery points**:

- Before a new migration enters production, CI calls `scripts/create-db-release-backup.sh`;
- It exports `roles.sql`, `schema.sql`, `data.sql`, and the migration history in the Supabase CLI's official recovery format;
- `data.sql` covers business data, Auth users, and Storage metadata, excluding incompatible internal vector bucket tables;
- The archive is encrypted with AES-256-CBC + PBKDF2 (200,000 iterations), and CI immediately decrypts it and checks every SHA-256;
- `db push` only runs after the encrypted artifact is uploaded successfully;
- The artifact is named `db-recovery-<git-sha>` and kept by Actions for 14 days;
- `scripts/restore-db-release.sh` can verify an archive and only allows restoring into a new, blank, isolated Supabase project.
- The latest production recovery point was created by run `31467153739` on 2026-08-11: artifact `9092230348`, 824,125 bytes, artifact zip SHA-256 `6939309024094791bb639112eaf73a1429d588a4800c42703e579185a0aa817f`, covering the pre-release 0043 roles/schema/data/migration history and kept for 14 days. The data-only warning `pg_dump` gives for circular foreign keys must be handled with this document's isolated recovery order of "schema first, then data/disable triggers if needed"; it does not mean a recovery drill has been completed.

This is still not full disaster recovery:

- The dump contains Storage bucket/object **metadata, not file bytes**;
- There is no scheduled daily off-site dump or Storage object replication;
- There are no automatic backup-age/recovery-drill alerts;
- The GitHub artifact's 14-day window is not long-term retention;
- The available window of Supabase's platform daily backup/PITR depends on the production project's plan and the actual dashboard state;
- CI never automatically restores production to an old dump, because that would overwrite writes made after the recovery point.

## 2. Assets and recovery boundaries

| Asset | In the release archive | What else is needed |
|---|---|---|
| `public` schema, functions, RLS, business rows | Yes | Data consistency, grants, trigger verification |
| Points daily windows/permanent claims/moderation actions/coordination signals/API abuse buckets | Yes | Dedicated reconciliation of the ledger/Profile projection, claim immutability, the moderation chain, and 30-day audit retention |
| Courses content/sessions/attempts/progress/schedules/shares/publications/reports/badges/speech usage/audio queue metadata | Yes | Dedicated reconciliation of append-only attempts/points, revisions/idempotent responses, mastery dates, publication immutability, queue leases, and service-only RPCs |
| Materials AI plan/quota/job/events/parse cache/Notes/exam/provider usage (production 0041–0043; candidate 0046–0051 adds checkpoint/graph/Q&A/Luna/layout/delete lifecycle) | Yes | Dedicated reconciliation of reservation/consume, job lease/resume/delete, pipeline, checkpoint expiry, usage event/upstream, graph source refs, layout revision, Q&A owner, ZDR/cost metadata, and RLS; never copy content from the dump into development |
| AI worker local checkpoint/usage spool | No, and it must never be included in regular backups | This is a single-host, 0700, TTL-bounded transport recovery copy, not a long-term source of truth; the database checkpoint/usage ledger is what is recoverable. If the host is lost, model stages not yet saved may be redone from the latest DB checkpoint, but event UUIDs must prevent double billing, and users keep a stable retry state |
| Auth user UUIDs/metadata | Covered by the data dump | Provider, SMTP, URL, and signing configuration; password/session recovery needs a drill |
| Storage bucket/object metadata | Covered by the data dump | **Off-site replication and a manifest of the object file bytes** |
| Migration history | Separate schema/data dump | Reconcile with the repository migration checksums |
| Supabase platform configuration | No | A dashboard configuration inventory/infrastructure record |
| GitHub/server secrets | No | A separate secret manager; backup packages must never contain plaintext secrets |
| Web/API/AI images | Git SHA images + release directory | All three in the same immutable release; off-site image/artifact retention and server rebuild drills |
| nginx/TLS/DNS/compose | The repository has reference configuration | Records of the actual production configuration, certificates, and DNS switching |
| Redis AOF/sliding windows/scanner lock | No (local volume) | Redis only holds rebuildable short-lived protection state; password/HMAC are restored from secret management, and AOF must never be used to restore points facts |
| BullMQ UUID delivery | No (Redis AOF) | `generation_jobs`/`exam_attempts` are the durable facts; after recovery the reconciler re-enqueues from PostgreSQL, never inferring allowances/results from Redis |

A database dump cannot restore Storage files, application artifacts cannot restore the database, and Supabase daily backups cannot replace server and secret backups. The Redis volume currently has no off-site copy; losing it clears short-lived rate-limit windows and the scanner lock, but daily claims, moderation, signals, and API audits stay in PostgreSQL and must never be inferred from or rewritten based on Redis.

## 3. RPO/RTO targets

The following are targets awaiting approval by the business owner, not an existing SLA:

| Tier | Data | Target RPO | Target RTO | Target mechanism |
|---|---|---:|---:|---|
| Core | Auth, courses/materials, future wallets/payments | ≤ 15 minutes | ≤ 4 hours | PITR/log recovery + event ledger + off-site copy |
| Important | Community, schedule, notifications, feedback | ≤ 24 hours | ≤ 8 hours | Daily backups + a recovery point per migration |
| Objects | Private materials, community media | ≤ 24 hours | ≤ 24 hours | S3/incremental object replication + checksum manifest |
| Learning | Private word lists, progress, review schedules, badges | ≤ 24 hours | ≤ 8 hours | Daily DB backups + a recovery point per migration; attempt/points reconciliation |
| Deployment | Web/API/config | Every release | ≤ 2 hours | Git SHA artifacts + config-as-code + secret manager |
| AI learning results | Notes, test papers, answer sheets, private parse cache | ≤ 24 hours | ≤ 8 hours | DB backup + job/operation reconciliation; process temporary directories are not restored |

Before points/credits/VIP/payments go live, there must be an immutable event ledger, reconciliation, and webhook replay; otherwise economic events after the recovery point cannot be replayed reliably.

## 4. Release recovery points

CI uses these secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF`
- `DB_BACKUP_ENCRYPTION_KEY`

The equivalent controlled manual command:

```bash
SUPABASE_ACCESS_TOKEN=... \
SUPABASE_DB_PASSWORD=... \
SUPABASE_PROJECT_REF=<explicit-project-ref> \
BACKUP_ENCRYPTION_KEY=... \
BACKUP_OUTPUT=/secure/offsite/nalanda-db-<git-sha>.tar.gz.enc \
bash scripts/create-db-release-backup.sh
```

The script: links the explicit ref; exports roles/schema/data/history in Supabase's official order; writes a manifest and SHA-256s; encrypts; then decrypts and checks every file. If the CLI migration history has not been adopted and the remote doesn't even have a `supabase_migrations` schema, only `pg_dump`'s exact `no matching schemas were found` result is recorded as `migration_history_state=absent`; any other history dump error still fails immediately. Temporary plaintext lives in a `0700` temporary directory and is cleaned up by `trap`.

Minimum success criteria:

- The script exits 0;
- The ciphertext is non-empty and can be verified with the key kept offline;
- The manifest's source ref, Git SHA, and creation time are correct;
- The manifest's `migration_history_state` matches the remote's actual `present` or `absent`;
- The artifact has been copied to a different failure domain with restricted access;
- The Storage object manifest/copies have a separate record.

`DB_BACKUP_ENCRYPTION_KEY` must be at least 32 characters and generated from a cryptographically secure random source. It and the archive must not be kept only in the same GitHub repository/account; otherwise recovery is impossible if that account fails.

## 5. Storage object backups

Supabase database backups only contain Storage metadata. The formal approach should copy `materials` and `community-media` to a different failure domain through the S3-compatible API, the Supabase Storage CLI, or a controlled worker, and produce:

```text
bucket,path,size,content_type,etag_or_sha256,version,backed_up_at
```

Requirements:

- Private materials are encrypted in transit and at rest;
- The backup worker uses separate, rotatable, least-privilege credentials;
- Spot-check downloads after incremental replication;
- Monitor object count, total bytes, and the last success time;
- On recovery, align database references and object paths first, and never silently delete orphans;
- When a privacy deletion comes due, clean up the backups too, keeping compliance audit records but not the content.

`vocabulary-audio` only contains private Azure TTS caches generated from normalized English and reusable across users, and can be regenerated from `learning_audio_assets.synthesis_text`; it is classified as a **losable cache** and does not need to meet the object RPO. If you choose to back it up for cost reasons, it must also enter the manifest, stay private, and never mix with user recordings. On recovery, records with metadata=`ready` but a missing object should go through a controlled requeue/lazy generation rather than being presented as complete; lease tokens/expired processing states can safely be reclaimed. User read-aloud recordings are never written to the database/Storage, so there is no recording backup or recovery step.

The browser IndexedDB answer outbox and Cache Storage are not part of server backups: the outbox is cleared per account at sign-out, and provisional answers not yet synced cannot be restored from the database; local audio is an evictable copy the user can delete. After disaster recovery, clients resolve conflicts through session revisions/snapshots, and completions, points, or badges must not be re-issued before the server confirms.

Materials AI's `/tmp/nalanda-material-ai/job-*` is a short-lived process/recovery directory and **must never enter long-term backups or be copied across environments**. The worker may briefly keep validated checkpoints and the usage spool there to survive API callback outages; they are cleared on success, unrecoverable failure, cancellation, Delete completion, or when `MATERIAL_AI_RESUME_TTL_SECONDS` expires. `ai_material_parse_cache`, `generation_job_checkpoints/exam_grading_checkpoints`, and `knowledge_graph_layouts` are private durable data, subject to the same encryption/access/deletion rules as the database archive. Luna checkpoints contain no prompt or source file content, and the original material's source of truth is still the private Storage object; without a backup of the Storage bytes, native-file Q&A cannot be restored from a DB dump alone. After recovery, the reconciler handles expired leases/deleting, first replaying unique usage events and then completing results or purging; the same idempotency/operation/event UUID must return the existing fact and never consume Free quota twice, record cost twice, or generate Notes twice.

## 6. Supabase platform recovery points

Before every production database release, the approver must also confirm in the Dashboard under Database → Backups:

- The latest daily backup/PITR status;
- The earliest/latest recoverable time;
- The current plan, Postgres version, and recovery limitations;
- Whether recovery is in place, a clone, or a new project;
- The impact of Storage files not being restored along with the database.

If no platform recovery point meets the RPO, the release must rely on a verified encrypted logical backup and Storage copies; if neither exists, stop the release.

## 7. Verifying an archive

After downloading the GitHub artifact, run in a secure terminal:

```bash
BACKUP_ARCHIVE=/secure/path/nalanda-db-<sha>.tar.gz.enc \
BACKUP_ENCRYPTION_KEY=... \
bash scripts/restore-db-release.sh verify
```

The script decrypts into a private temporary directory, verifies every SHA-256, and prints the non-secret manifest fields. A passing "verify" alone does not count as a recovery drill.

## 8. Isolated recovery

You must create a **new blank Supabase project**. The script's safety conditions:

- `RESTORE_TARGET_PROJECT_REF` must exactly equal the confirmation value;
- The connection string must contain that ref;
- The target ref must not equal the archive's source ref;
- The target must have no public tables, Auth users, or Storage objects;
- `ALLOW_ISOLATED_RESTORE=YES` must be set explicitly;
- All roles/schema/data/history are restored in a single `ON_ERROR_STOP` transaction;
- During the data import, `session_replication_role=replica` is set so points, notification, counter, and streak triggers do not fire again.

Command:

```bash
BACKUP_ARCHIVE=/secure/path/nalanda-db-<sha>.tar.gz.enc \
BACKUP_ENCRYPTION_KEY=... \
RESTORE_DATABASE_URL='<new-project-session-pooler-url>' \
RESTORE_TARGET_PROJECT_REF='<new-project-ref>' \
RESTORE_CONFIRM_PROJECT_REF='<new-project-ref>' \
ALLOW_ISOLATED_RESTORE=YES \
bash scripts/restore-db-release.sh restore-isolated
```

If managed permissions, extensions, or platform schemas make the official SQL restore fail, stop and keep the logs; do not add superuser privileges to work around it. Use a recovery/clone flow the Supabase Dashboard supports instead, and record the differences in the incident record.

## 9. Post-recovery verification

Database:

- The migration history matches the repository version;
- Tables, RLS, policies, functions, triggers, and indexes exist;
- Key row counts, FK orphans, and unique/NULL constraints are normal;
- Denormalized post counters match relationship aggregates;
- points/credits/VIP/streak were not changed by triggers during recovery;
- Every `point_event_states.business_key` from 0039+ has a unique claim; cap=0 only corresponds to `daily_cap`, moderation transition sums match the append-only actions, and Profile points/level equal the ledger projection;
- Function owner/search_path/EXECUTE grants are correct.
- The learning course/unit/word owner chain has no orphans; active sessions are unique only within the `(user_id,resume_key)` intent, and the same course allows unfinished sessions for different units/modes; revisions are non-negative and consistent with the added-attempt clock, non-null attempt UUIDs are unique within user/session with replayable response snapshots, and attempts are still append-only facts; for progress mastered through normal review, each of the three date groups has at least two entries, while for exam mastery there is a corresponding completed exam session with `examPassed=true`, and the exam path must not be wrongly required to fake review dates;
- `learning_audio_assets` has no client grants and no expired processing stuck forever; ready metadata corresponds to private Storage bytes, missing items go back to pending and can be rebuilt, and the same cache key is not generated twice;
- Review schedules were not copied into `study_tasks`; publication snapshots/versions/fingerprints are unchanged, and revoked shares do not become active again;
- Course-completion points business keys are unique per user + word set, badge award PKs are unique, and Profile learning aggregates can be recomputed from facts; speech usage contains no audio/reference text.

Auth/Storage:

- Isolated users can sign in; UUIDs align with business FKs;
- Provider/SMTP/redirect URLs and signing configuration have been rebuilt;
- Bucket properties, RLS, and the object manifest are correct;
- File bytes are restored from an independent copy, and random-sample checksums match;
- Private materials can only be signed and read by their owner.

Redis/application:

- Start a private Redis with a new, separate 32-byte password/HMAC secret, and confirm no host port, PING, AOF `everysec`, `noeviction`, and a persistent volume; do not force a link between old HMAC actors and new values;
- `/api/health` reports both `deps.supabase=ok` and `deps.redis=ok`, then verify sign-in and `/api/me`;
- Verify 429 headers for sign-up/IP/email, authenticated users, and Courses write/public read, and that with Redis stopped, private reads fail open while sign-up/writes/cost paths fail closed;
- Owner-only courses/materials/tasks/feedback;
- Courses list/session resume/review schedules/Profile aggregates; share revocation, free market clones, and failed client attempts to forge progress/points;
- Community reads/writes, counters, notifications, and idempotent points;
- Smoke data can be fully cleaned up;
- Record recovery time and the actual RPO/RTO.

## 10. Real incidents and failover

1. Declare the incident, preserve logs/audit evidence, and determine the last good time and affected writes;
2. Close the affected write entry points; if a leak is involved, rotate secrets first;
3. Choose a platform point or encrypted archive that meets the RPO, and list the new events after the recovery point;
4. Restore into an isolated project and complete section 9;
5. Restore Storage bytes, Supabase configuration, and secrets separately;
6. Plan the difference replay/reconciliation, with two-person review;
7. Prepare the new URL/keys, a Web rebuild, the API `.env`, DNS/reverse proxy, and a rollback window;
   If Redis starts from an empty state, limit public writes first and observe for one longest protection window, so "all windows cleared" at the moment of failover is not mistaken for normal capacity; the database points cap is unaffected.
8. Fail over after approval by the incident owner and the database owner;
9. Monitor Auth, 5xx, RLS, key writes, object reads, and user feedback;
10. Keep the old environment as read-only evidence until the compliance window ends, and complete the incident report.

Never run `pg_restore --clean` directly against production without verification, and never automatically restore the database because an application release failed.

## 11. Future automation

- Daily encrypted database backups, off-site replication, backup age/size anomaly alerts, and retention cleanup;
- Incremental Storage replication, a checksum manifest, and quarterly spot recovery;
- A recoverable inventory of Auth/platform configuration;
- Periodically creating an isolated project automatically and running full RLS/application recovery drills;
- An off-site registry and retention policy for immutable images/artifacts;
- A recovery drill dashboard recording the last success time and actual RPO/RTO;
- A credits/payment event ledger and replayable webhooks; points already have a ledger/claims but still need automated moderation reconciliation and difference reports across recovery points.
- Redis AOF recovery drills, a controlled traffic plan for starting with empty windows, and volume capacity/corruption alerts; AOF is not promoted to a business fact backup.
- Courses data/growth fact/revision/attempt snapshot recovery reconciliation scripts, plus drills for `vocabulary-audio` metadata/object inconsistency, expired leases, cache clearing, and durable queue rebuilds.
