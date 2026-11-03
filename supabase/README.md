# Supabase: Database, Auth, Storage, and Migrations

> **About this document**
> - **Contents**: Describes the migrations currently in this directory, how the database is applied, the current authentication setup, and known security gaps.
> - **Purpose**: The entry point to the Supabase directory; see the ERD for full relationships and the database runbook for formal releases/rollbacks.
> - **When to update**: When migrations, buckets, RLS, authentication settings, or the database release method are added or changed.

Last checked: 2026-07-22. Production history is currently at 0010; 0011–0013 are repository increments awaiting release.

## Current contents

| Migration | Contents |
|---|---|
| `20260620000001_profiles.sql` | profiles, automatic profile creation, updated_at, owner RLS |
| `20260624000002_courses_materials.sql` | courses, materials, private materials bucket |
| `20260624000003_materials_course_check.sql` | Hardening of the materials foreign-key course ownership |
| `20260624000004_notifications_feedback.sql` | notifications, feedback |
| `20260625000005_community.sql` | posts, comments, likes, favorites, follows, counter/author triggers |
| `20260625000006_points_tags_notify.sql` | points, tags, public community media, interaction notifications and levels |
| `20260625000007_schedule.sql` | study_goals, study_tasks, streak, task completion rewards |
| `20260710000008_security_points_ledger.sql` | Profile column-level write protection, internal RPC revocation, `point_entries`/`point_event_states`, stable business keys, reversals, and idempotent rewards |
| `20260721000009_reset_legacy_points.sql` | Zeroes the untrusted `legacy_opening` with append-only reversals and rebuilds the Profile points/level projection |
| `20260721000010_verify_security_points_release.sql` | Read-only assertions on Profile permissions, internal RPCs, opening reversals, and the ledger projection; any failure blocks the release |
| `20260722000011_learning_courses.sql` | Independent learning courses/sessions/attempts/progress/review, sharing/market/reports, badges, speech usage, timezone, and private TTS cache |
| `20260722000012_learning_course_workflows.sql` | Service-role-only atomic save/answer/growth/+20/schedule/speech quota/share/publish/clone/report/moderation RPCs |
| `20260722000013_verify_learning_courses_release.sql` | Read-only assertions on Courses RLS, client write/RPC denial, badges, timezone, and the owner chain |

The final repository structure has 30 public business/configuration tables and three Storage buckets; production at 0010 still had 15 tables and two buckets. See the [ERD](../docs/guides/ERD.md) for relationships, delete behavior, and policies.

## Applying migrations

Formal environments must follow [database release and rollback](../docs/operations/DATABASE_RELEASE_ROLLBACK.md). CI automatically stages every 0008+ migration to first verify a real 0007→latest upgrade, then rebuilds/lints an empty database and runs the RLS/Storage/points/Courses E2E and Playwright. Production first runs a read-only plan, then the owner applies with an encrypted recovery point. The old baseline process was completed on 2026-07-21, and the remote history is currently synced to 0010; 0011–0013 must go through a separate protected release and must not be considered applied remotely just because the files exist in the repository.

Local baseline:

```bash
supabase start
supabase db reset --local --no-seed
supabase db lint --local --schema public --level error --fail-on error
```

The normal remote approach is the Supabase CLI migration history:

```bash
supabase link --project-ref <explicit project ref>
supabase db push --dry-run
supabase db push
```

The repository also keeps a Management API script:

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx \
SUPABASE_PROJECT_REF=<explicit non-production or confirmed project ref> \
ALLOW_LEGACY_DB_PUSH=YES \
node scripts/db-push.mjs
```

Warning: this script no longer has a default ref and requires an emergency switch, but it still does not maintain history and has no cross-file transactions, so it is not part of normal releases. If migrations were ever applied manually to the old production, the first CLI release must check each item and baseline/repair the history per the runbook; never blindly use `--include-all`.

The SQL Editor is only an emergency/bootstrap fallback. After any manual execution, record who ran it, when, the target project, the SQL hash, and the verification result, so the database state never drifts away from version control.

## Current authentication setup

- Web sign-in uses Supabase Auth directly.
- Sign-up first calls `POST /api/auth/register`, where NestJS uses the service role to create a user with `email_confirm:true`.
- The current flow therefore does not verify email ownership; "toggle Confirm email" is no longer the current sign-up approach.
- Before real growth, add SMTP, email verification, password recovery, rate limiting/CAPTCHA, and abuse monitoring.

## Current RLS principles

- Owner-only tables restrict rows to their owner with `auth.uid()`.
- When referencing another owner table, an existing foreign key does not imply permission; ownership must be checked in `with check`.
- Community posts/comments are publicly readable by authenticated users, and writes are still limited to the author.
- Private Storage materials are isolated by the user id in the first path segment of the object.
- Courses private tables grant owners SELECT only; authenticated users have no table write permissions, and every save/answer/growth/distribution goes through API service-role RPCs. Public shares/market are not exposed to anonymous PostgREST.

RLS only restricts rows; it cannot automatically protect sensitive columns in the same row. 0008 therefore revokes table-wide UPDATE on Profile, grants authenticated users only column updates on `username/university/major/year/language`, and protects `credits/points/level/vip/streak` with a defensive trigger; `_add_points` is revoked from every client and the service role, and `_notify`, `_set_point_event`, and the trigger helpers are no longer a client RPC surface.

Points are now maintained by the append-only `point_entries`, the internal `point_event_states`, and the Profile projection; likes, comments, original posts/reposts, and task un-completion/deletion are reversed, and redoing them only restores the same business event's net amount. Pre-migration balances imported by 0008 are zeroed by equal reversals appended in 0009 without deleting audit records; daily reward caps and content-quality anti-abuse are still missing. `credits`/`vip_until` cannot be changed by clients, but there are still no orders or credits/VIP ledgers of record, so they must not be enabled as commercial features.

## Verification

Every RLS/authorization change must be verified with at least users A/B: allowed own fields succeed, sensitive column/RPC/ledger/progress writes fail, other users' rows cannot be read or written, and foreign keys cannot point at other users' objects. The four RLS E2E groups, release-tool unit tests, the 0007→latest upgrade, and Playwright run on PR/main; locally, without explicit environment variables, the RLS suite skips safely. See the [testing guide](../docs/guides/TESTING.md) for commands.
