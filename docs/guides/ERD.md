# ERD and database dictionary

> **Contents:** Describes every application table, column, relationship, deletion behavior, RLS policy, Storage bucket, trigger, and database function in the current Supabase/PostgreSQL, and lists target entities that aren't implemented yet separately.  
> **Purpose:** The shared source of truth for database structure reviews, API development, writing migrations, security audits, and data recovery.  
> **When to update:** In the same change commit as the code, every time a migration or a table/column/constraint/index/RLS policy/function/trigger/Storage policy is added or changed; also update the status when a target model becomes a real migration.

## 1. Authoritative source and scope

This page is compiled from the final cumulative result of `supabase/migrations/20260620000001_profiles.sql` through the candidate `20261003000057_verify_material_ai_luna_gpt6_retire_ox_alpha.sql`. The migration SQL is the repository's structural authority; the production migration history is still defined by protected release evidence, and when this document was updated production was confirmed at 0055, so 0056–0057 must not yet be written up as applied.

- **Production structure**: production 0043 includes the 0039–0040 security/rate limiting and the 0041–0043 Materials AI/Notes/exam entities, transactions, and verification, plus `auth.users`, 3 Storage buckets, and the related RLS/functions/triggers.
- **Unimplemented targets**: Courses AI file import, Knowledge list, standalone Quiz, a general market, a credits wallet ledger, orders/payments, subscriptions/VIP entitlements, and full community moderation entities. The repository's 0046–0051 candidate adds Materials knowledge graph/node Q&A, long job recovery, the Luna original-file pipeline, the job cleanup lifecycle, and cross-device graph layout, but these must not be described as production facts until the protected release completes.

## 2. Current ERD

```mermaid
erDiagram
    AUTH_USERS {
        uuid id PK
        text email
    }
    PROFILES {
        uuid id PK_FK
        text username
        text email
        text university
        text major
        text year
        text language
        text timezone
        integer credits
        integer points
        integer level
        text level_name
        timestamptz vip_until
        integer streak
        date streak_date
        timestamptz created_at
        timestamptz updated_at
    }
    COURSES {
        uuid id PK
        uuid user_id FK
        text code
        text name
        text color
        text term
        text instructor
        timestamptz created_at
    }
    MATERIALS {
        uuid id PK
        uuid user_id FK
        uuid course_id FK
        text name
        text type
        bigint size_bytes
        text storage_path
        timestamptz created_at
    }
    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        text type
        text title
        text body
        boolean read
        timestamptz created_at
    }
    FEEDBACK {
        uuid id PK
        uuid user_id FK
        text category
        text summary
        text body
        text status
        timestamptz created_at
    }
    POSTS {
        uuid id PK
        uuid user_id FK
        uuid repost_of FK
        text author_name
        text author_university
        text author_major
        text title
        text body
        text kind
        text subject
        text_array tags
        text image_url
        text audio_url
        text points_business_key
        integer like_count
        integer comment_count
        integer favorite_count
        integer repost_count
        timestamptz created_at
        timestamptz updated_at
    }
    COMMENTS {
        uuid id PK
        uuid post_id FK
        uuid user_id FK
        text author_name
        text body
        text points_business_key
        timestamptz created_at
    }
    POST_LIKES {
        uuid post_id PK_FK
        uuid user_id PK_FK
        text points_business_key
        timestamptz created_at
    }
    POST_FAVORITES {
        uuid post_id PK_FK
        uuid user_id PK_FK
        timestamptz created_at
    }
    FOLLOWS {
        uuid follower_id PK_FK
        uuid following_id PK_FK
        timestamptz created_at
    }
    TAGS {
        text kind PK
        text value PK
        timestamptz created_at
    }
    STUDY_GOALS {
        uuid id PK
        uuid user_id FK
        uuid course_id FK
        text title
        date exam_date
        timestamptz created_at
    }
    STUDY_TASKS {
        uuid id PK
        uuid user_id FK
        uuid course_id FK
        uuid material_id FK
        uuid goal_id FK
        text title
        date due_date
        boolean done
        timestamptz done_at
        text points_business_key
        timestamptz created_at
    }
    POINT_ENTRIES {
        bigint id PK
        uuid user_id FK
        text event_type
        text business_key
        integer amount
        text rule_version
        uuid source_id
        integer transition_no
        bigint reversal_of FK
        jsonb metadata
        timestamptz created_at
    }
    POINT_EVENT_STATES {
        text business_key PK
        uuid user_id FK
        text event_type
        integer reward_amount
        boolean is_active
        integer transition_no
        uuid source_id
        bigint last_entry_id FK
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }
    POINT_DAILY_WINDOWS {
        uuid id PK
        uuid user_id FK
        date local_date
        text timezone
        timestamptz starts_at
        timestamptz ends_at
    }
    POINT_DAILY_AWARD_CLAIMS {
        text business_key PK
        uuid user_id FK
        uuid daily_window_id FK
        integer daily_limit
        integer nominal_amount
        integer awarded_amount
        text suppressed_reason
        uuid target_owner_id FK
        text target_root_key
    }
    POINT_MODERATION_ACTIONS {
        bigint id PK
        uuid admin_user_id
        text action
        text target_type
        text target_key
        integer affected_amount
    }
    POINT_ABUSE_SIGNALS {
        uuid id PK
        text signal_type
        text fingerprint UK
        uuid_array account_ids
        text status
    }
    API_ABUSE_EVENTS {
        bigint id PK
        text actor_hmac
        uuid user_id FK
        text route_group
        text rule
        timestamptz bucket_start
        bigint event_count
    }

    AUTH_USERS ||--o| PROFILES : "id"
    AUTH_USERS ||--o{ COURSES : "owns"
    AUTH_USERS ||--o{ MATERIALS : "owns"
    AUTH_USERS ||--o{ NOTIFICATIONS : "receives"
    AUTH_USERS ||--o{ FEEDBACK : "submits"
    AUTH_USERS ||--o{ POSTS : "authors"
    AUTH_USERS ||--o{ COMMENTS : "authors"
    AUTH_USERS ||--o{ POST_LIKES : "likes"
    AUTH_USERS ||--o{ POST_FAVORITES : "favorites"
    AUTH_USERS ||--o{ FOLLOWS : "follower"
    AUTH_USERS ||--o{ FOLLOWS : "following"
    AUTH_USERS ||--o{ STUDY_GOALS : "owns"
    AUTH_USERS ||--o{ STUDY_TASKS : "owns"
    AUTH_USERS ||--o{ POINT_ENTRIES : "owns ledger"
    AUTH_USERS ||--o{ POINT_EVENT_STATES : "owns event state"
    AUTH_USERS ||--o{ POINT_DAILY_WINDOWS : "has frozen reward days"
    AUTH_USERS ||--o{ POINT_DAILY_AWARD_CLAIMS : "receives decisions"
    AUTH_USERS o|--o{ API_ABUSE_EVENTS : "optional internal actor"
    COURSES ||--o{ MATERIALS : "contains"
    COURSES o|--o{ STUDY_GOALS : "optionally groups"
    COURSES o|--o{ STUDY_TASKS : "optionally groups"
    MATERIALS o|--o{ STUDY_TASKS : "optionally links"
    STUDY_GOALS o|--o{ STUDY_TASKS : "optionally contains"
    POSTS o|--o{ POSTS : "reposted by"
    POSTS ||--o{ COMMENTS : "has"
    POSTS ||--o{ POST_LIKES : "has"
    POSTS ||--o{ POST_FAVORITES : "has"
    POINT_ENTRIES o|--o{ POINT_ENTRIES : "previous transition"
    POINT_ENTRIES o|--o| POINT_EVENT_STATES : "last entry"
    POINT_DAILY_WINDOWS o|--o{ POINT_DAILY_AWARD_CLAIMS : "groups capped claims"
    POINT_EVENT_STATES ||--o| POINT_DAILY_AWARD_CLAIMS : "shares business key"
```

`auth.users` is managed by Supabase Auth; the diagram only shows the `id` the application actually references and a conceptual `email`, and isn't a complete definition of Auth's internal table.

### 2.1 Courses subdomain ERD

```mermaid
erDiagram
    AUTH_USERS ||--o{ LEARNING_COURSES : owns
    LEARNING_COURSES ||--o{ LEARNING_UNITS : contains
    LEARNING_UNITS ||--o{ LEARNING_WORDS : contains
    AUTH_USERS ||--o{ LEARNING_SESSIONS : studies
    LEARNING_COURSES ||--o{ LEARNING_SESSIONS : resumes
    LEARNING_UNITS ||--o{ LEARNING_SESSIONS : scopes
    LEARNING_SESSIONS ||--o{ LEARNING_SESSION_ITEMS : snapshots
    LEARNING_WORDS ||--o{ LEARNING_SESSION_ITEMS : includes
    LEARNING_SESSIONS ||--o{ LEARNING_EXAM_WORD_SNAPSHOTS : preserves
    LEARNING_SESSIONS ||--o{ LEARNING_ATTEMPTS : records
    LEARNING_WORDS ||--o{ LEARNING_ATTEMPTS : answers
    AUTH_USERS ||--o{ LEARNING_SPELLING_TRANSLATION_ASSESSMENTS : requests
    LEARNING_SESSIONS ||--o{ LEARNING_SPELLING_TRANSLATION_ASSESSMENTS : evaluates
    LEARNING_WORDS ||--o{ LEARNING_SPELLING_TRANSLATION_ASSESSMENTS : references
    AUTH_USERS ||--o{ LEARNING_WORD_PROGRESS : owns
    LEARNING_WORDS ||--o| LEARNING_WORD_PROGRESS : projects
    LEARNING_UNITS ||--o{ LEARNING_REVIEW_SCHEDULES : schedules
    LEARNING_COURSES ||--o{ LEARNING_SHARES : shares
    LEARNING_COURSES o|--o{ LEARNING_PUBLICATIONS : versions
    LEARNING_PUBLICATIONS o|--o{ LEARNING_COURSES : cloned_origin
    LEARNING_PUBLICATIONS ||--o{ LEARNING_REPORTS : reported
    LEARNING_SHARES ||--o{ LEARNING_REPORTS : reported
    LEARNING_PUBLICATIONS o|--o{ LEARNING_MODERATION_ACTIONS : audited
    BADGE_DEFINITIONS ||--o{ USER_BADGE_AWARDS : awards
    AUTH_USERS ||--o{ USER_BADGE_AWARDS : earns
    AUTH_USERS o|--o{ LEARNING_SPEECH_USAGE : reserves
    LEARNING_AUDIO_ASSETS {
        text cache_key PK
        text status
        text storage_path
    }
    LEARNING_SPELLING_TRANSLATION_ASSESSMENTS {
        uuid assessment_id PK
        text answer_hash
        text status
        boolean correct
        jsonb response_payload
    }
    LEARNING_EXAM_WORD_SNAPSHOTS {
        uuid session_id PK_FK
        uuid word_id PK
        text term
        text_array translations
        integer wrong_count
        boolean passed
    }
```

`learning_attempts` are appended facts and `learning_word_progress` is a protected projection; market publications are immutable snapshots, and deleting the source course only sets `source_course_id` to null. Shares read the current course and store no content copy. `learning_audio_assets` has no foreign key to users or words: identical normalized words, locale, voice, format, and synthesis version share one rebuildable job/object through a content hash. `learning_spelling_translation_assessments` only stores the SHA-256 of the user's answer, the provider verdict/metering, the lease, and the first response; the translation text the user typed is never stored.

## 3. Table dictionary

### 3.1 `profiles`

Shares its primary key with `auth.users` and is created by the `handle_new_user` trigger after sign-up. `points`/level are for activity growth: `points` is a cached projection of `point_entries`, and the level is computed from that projection; `credits` is still only a reserved number with no wallet ledger yet. Ordinary authenticated users can only update the allowlisted profile columns and can't update points, credits, level, VIP, or streak.

| Column | Type | Null/default | Relationship or notes |
|---|---|---|---|
| `id` | `uuid` | PK, not null | → `auth.users.id ON DELETE CASCADE` |
| `username` | `text` | nullable | Defaults at profile creation to the part of the email before `@` |
| `email` | `text` | nullable | Snapshot of the Auth email, not the authoritative authentication field |
| `university`, `major`, `year` | `text` | nullable | User profile |
| `language` | `text` | not null, `'zh'` | No check constraint currently |
| `timezone` | `text` | not null, `'UTC'` | Added in 0011; the insert/update trigger requires it to exist in `pg_timezone_names`, and historical attempt `local_date` values aren't rewritten when it changes |
| `credits` | `integer` | not null, `0` | No wallet ledger/payment loop yet |
| `points` | `integer` | not null, `0` | Added in migration 0006; since 0008 projected from the ledger sum and clamped to `0..2147483647` |
| `level` | `integer` | not null, `1` | Computed by `_set_point_event` from the points projection |
| `level_name` | `text` | not null, `'Novice'` | Computed by `_set_point_event` from the points projection |
| `vip_until` | `timestamptz` | nullable | No subscription/payment write rules yet |
| `streak` | `integer` | not null, `0` | Added in migration 0007 |
| `streak_date` | `date` | nullable | The most recent date counted towards the study streak |
| `created_at`, `updated_at` | `timestamptz` | not null, `now()` | `profiles_touch` updates `updated_at` |

### 3.2 `courses` and `materials`

| Table | Column | Type | Null/default | Relationship or notes |
|---|---|---|---|---|
| `courses` | `id` | `uuid` | PK, `gen_random_uuid()` | — |
|  | `user_id` | `uuid` | not null, `auth.uid()` | → `auth.users.id CASCADE` |
|  | `code` | `text` | nullable | Course code |
|  | `name` | `text` | not null | — |
|  | `color` | `text` | not null, `'#9c6a39'` | — |
|  | `term`, `instructor` | `text` | nullable | — |
|  | `created_at` | `timestamptz` | not null, `now()` | — |
| `materials` | `id` | `uuid` | PK, `gen_random_uuid()` | — |
|  | `user_id` | `uuid` | not null, `auth.uid()` | → `auth.users.id CASCADE` |
|  | `course_id` | `uuid` | not null | → `courses.id CASCADE`; RLS also checks course ownership |
|  | `name` | `text` | not null | — |
|  | `type` | `text` | nullable | No format enum constraint currently |
|  | `size_bytes` | `bigint` | not null, `0` | — |
|  | `storage_path` | `text` | not null | Logical path into the `materials` bucket, no database FK |
|  | `created_at` | `timestamptz` | not null, `now()` | — |

Index: `materials(course_id)`.

### 3.3 `notifications` and `feedback`

| Table | Column | Type | Null/default | Notes |
|---|---|---|---|---|
| `notifications` | `id` | `uuid` | PK, `gen_random_uuid()` | — |
|  | `user_id` | `uuid` | not null, `auth.uid()` | → `auth.users.id CASCADE` |
|  | `type` | `text` | nullable | Such as `like/comment/favorite/repost/follow/streak`, no check |
|  | `title` | `text` | not null | — |
|  | `body` | `text` | nullable | — |
|  | `read` | `boolean` | not null, `false` | — |
|  | `created_at` | `timestamptz` | not null, `now()` | Index `(user_id, created_at DESC)` |
| `feedback` | `id` | `uuid` | PK, `gen_random_uuid()` | — |
|  | `user_id` | `uuid` | not null, `auth.uid()` | → `auth.users.id CASCADE` |
|  | `category` | `text` | nullable | — |
|  | `summary` | `text` | not null | — |
|  | `body` | `text` | nullable | — |
|  | `status` | `text` | not null, `'open'` | Since production 0039 only service-role support workflows can change it; users can only add/read their own feedback |
|  | `created_at` | `timestamptz` | not null, `now()` | Index `(user_id, created_at DESC)` |

### 3.4 Community tables

#### `posts`

| Column | Type | Null/default | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` | — |
| `user_id` | `uuid` | not null, `auth.uid()` | → `auth.users.id CASCADE` |
| `author_name`, `author_university`, `author_major` | `text` | nullable | Overwritten at insert by `_post_author` with a snapshot from the profile |
| `title`, `body` | `text` | nullable | The database doesn't require at least one to be non-empty |
| `kind` | `text` | not null, `'experience'` | Comments define experience/question/tip/note_share by convention, no check |
| `subject` | `text` | nullable | Non-FK course/subject text |
| `tags` | `text[]` | not null, `'{}'` | No FK to the `tags` table |
| `repost_of` | `uuid` | nullable | → `posts.id CASCADE`; deleting the original post cascades to its reposts |
| `image_url`, `audio_url` | `text` | nullable | Usually a public bucket URL, no FK/ownership check |
| `points_business_key` | `text` | not null | Added in 0008; original posts are keyed by owner + normalized content, reposts by actor + root original content key, and it is immutable together with `repost_of` |
| `like_count`, `comment_count`, `favorite_count`, `repost_count` | `int` | not null, `0` | Redundant counts maintained by triggers |
| `created_at`, `updated_at` | `timestamptz` | not null, `now()` | Maintained by the production 0039 trigger: `updated_at` only changes when content changes, not when counts change; client values are overwritten during the compatibility period |

Indexes: `created_at DESC`, `user_id`, `subject`, `points_business_key`.

#### Interactions and relationships

| Table | Primary key | Other columns/relationships | Deletion behavior |
|---|---|---|---|
| `comments` | `id uuid` | `post_id → posts`, `user_id → auth.users`, `author_name` snapshot, `body NOT NULL`, `points_business_key NOT NULL`, `created_at` | Both post/user CASCADE; the points key is anchored on the target post's immutable content key + actor; indexes `(post_id, created_at)` and the points key |
| `post_likes` | `(post_id,user_id)` | `points_business_key NOT NULL`, `created_at` | Both post/user CASCADE; the points key is anchored on the target post's immutable content key + actor; duplicate posts with the same logical content share one reward claim |
| `post_favorites` | `(post_id,user_id)` | `created_at` | Both post/user CASCADE; the unique primary key prevents keeping duplicate favorites at once |
| `follows` | `(follower_id,following_id)` | Both → `auth.users`, `created_at` | user CASCADE; there is currently no `follower_id <> following_id` check |
| `tags` | `(kind,value)` | `created_at` | Independent global dictionary, no FK; comments define kind as university/major/subject/tag by convention, no check |

### 3.5 Study plans

| Table | Column | Type | Null/default | Relationship or notes |
|---|---|---|---|---|
| `study_goals` | `id` | `uuid` | PK, `gen_random_uuid()` | — |
|  | `user_id` | `uuid` | not null, `auth.uid()` | → `auth.users.id CASCADE` |
|  | `title` | `text` | not null | — |
|  | `exam_date` | `date` | nullable | — |
|  | `course_id` | `uuid` | nullable | → `courses.id ON DELETE SET NULL` |
|  | `created_at` | `timestamptz` | not null, `now()` | — |
| `study_tasks` | `id` | `uuid` | PK, `gen_random_uuid()` | — |
|  | `user_id` | `uuid` | not null, `auth.uid()` | → `auth.users.id CASCADE` |
|  | `title` | `text` | not null | — |
|  | `due_date` | `date` | not null, `current_date` | Index `(user_id,due_date)` |
|  | `done` | `boolean` | not null, `false` | Every done update enters an idempotent state machine; the first completion activates points/streak, and un-completing reverses points |
|  | `done_at` | `timestamptz` | nullable | Since production 0039 set/cleared by a trigger along with `done`; client values are overwritten during the compatibility period |
|  | `points_business_key` | `text` | not null | Added in 0008; generated at insert from the owner, normalized title, date, and linked entities, immutable afterwards |
|  | `course_id` | `uuid` | nullable | → `courses.id SET NULL`; RLS checks the owner |
|  | `material_id` | `uuid` | nullable | → `materials.id SET NULL`; RLS checks the owner |
|  | `goal_id` | `uuid` | nullable | → `study_goals.id SET NULL`; RLS checks the owner |
|  | `created_at` | `timestamptz` | not null, `now()` | — |

Production 0039 adds defensive triggers to goals/tasks: `course_id/material_id/goal_id` must belong to the row owner, `user_id` can't be modified, and service-role paths are bound by the same owner constraint. The existing FKs' `ON DELETE SET NULL` semantics are unchanged.

### 3.6 Points ledger and event state

`point_entries` are append-only entries for current points, and `point_event_states` is a business event state machine for internal database use only. Migration 0008 first writes the old `profiles.points` as one `legacy_opening`, then registers existing posts, comment relationships, likes, and completed tasks as active states with `transition_no=0` without awarding points again; 0009 appends a `legacy_opening_reset` reversal for every opening and rebuilds the Profile projection.

| Table | Column | Type/constraint | Notes |
|---|---|---|---|
| `point_entries` | `id` | `bigint identity` PK | Entry ID |
|  | `user_id` | `uuid NOT NULL` | → `auth.users.id CASCADE`; authenticated can only read its own entries |
|  | `event_type` | `text NOT NULL` | `legacy_opening/legacy_opening_reset/post_created/repost_created/like_created/comment_created/task_completed`, etc. |
|  | `business_key` | `text NOT NULL` | Permanent business key; forms a unique constraint with `transition_no` |
|  | `amount` | `integer NOT NULL, <> 0` | Positive on activation, negative for cancel/delete reversals |
|  | `rule_version` | `text NOT NULL` | New events in production 0038 are `points-v1`; first decisions in 0039 are `points-v2-daily-caps` and moderation transitions are `points-v2-moderation`; openings are `legacy-import-v1` |
|  | `source_id` | `uuid` nullable | The current source record that triggered this transition, no FK; entries are kept after the source is deleted |
|  | `transition_no` | `integer >= 0` | 0 for openings; strictly increasing afterwards for the same business key |
|  | `reversal_of` | `bigint` nullable | → the previous `point_entries.id ON DELETE NO ACTION`, forming the transition chain |
|  | `metadata` | `jsonb NOT NULL` | Source object and migration/active info |
|  | `created_at` | `timestamptz NOT NULL` | Defaults to `now()` |
| `point_event_states` | `business_key` | `text` PK | One row per permanent business event |
|  | `user_id` | `uuid NOT NULL` | → `auth.users.id CASCADE` |
|  | `event_type`, `reward_amount` | not null | On key collisions the type/user/reward must match, otherwise the transaction fails |
|  | `is_active`, `transition_no` | not null | Current net state and latest transition |
|  | `source_id`, `last_entry_id` | nullable | The current source record; the latest entry reference is `ON DELETE NO ACTION` |
|  | `source_active`, `moderation_suppressed`, `awarded_amount`, `decision_rule_version`, `suppressed_reason` | production 0039, not null/checked | Separates content existence, moderation, the first actual reward, and the current effective ledger state |
|  | `metadata`, `created_at`, `updated_at` | not null | Internal state and audit times |

State transitions are serialized through `_set_point_event`'s shared moderation gate, a business-key advisory lock, the profile row lock, the state row lock, and the unique key; moderation takes the exclusive lock on the same gate and locks Profiles first and then states in UUID order, avoiding lock-order inversion. Production 0039 permanently writes the first reward decision into a claim: the daily rewardable counts for original posts/reposts/comments/likes/tasks are 3/10/10/20/10 respectively, and course completion has no daily cap. Over-cap claims are 0, and deletion, recreation, or changing time zone can't reclaim them; moderation suppress only withdraws the amount actually awarded, and restore doesn't revive deleted sources or cap=0 rewards. The actual amount of `grandfather-v1` is proven by the positive transition-1 entry of that business key; historical 0008/0009 keys that only have a state placeholder with no per-business positive entry have `awarded_amount=0,is_active=false`, so they can't produce unsourced negative reversals. If an old placeholder already left a negative transition, 0039 appends an equal `grandfather-zero-reset-v1` compensation and advances the transition chain, never deleting or rewriting the original entries.

#### Production 0039: points and API anti-abuse tables

| Table | Key columns | Lifecycle and permissions |
|---|---|---|
| `point_daily_windows` | `user_id,local_date,timezone,starts_at,ends_at` | Freezes the current reward calendar day and IANA time zone; Auth deletion CASCADE; service-role read-only, writes only through the definer workflow |
| `point_daily_award_claims` | `business_key,user_id,event_type,rule_version,daily_window_id,daily_limit,nominal_amount,awarded_amount,suppressed_reason,source_id,target_owner_id,target_root_key,metadata,decided_at` | One immutable decision per stable business key; grandfathered zero amounts create no daily window and don't masquerade as `daily_cap`; Auth deletion CASCADE; service-role read-only, can't write directly |
| `point_daily_cap_notifications` | `(user_id,event_type,window_id),notification_id` | Only one durable notification per user/event/window; service-role only |
| `point_moderation_actions` | `id,admin_user_id,action,target_type,target_key,reason,case_reference,affected_event_count,affected_amount,metadata,created_at` | Append-only moderation facts; the admin UUID/reason are kept and not lost on account deletion; service-role read-only, inserts only through the moderation RPC |
| `point_abuse_signals` | `id,signal_type,fingerprint,account_ids,target_owner_id,target_root_key,window,metrics,status,reviewer*,timestamps` | Deduplicated by signal/sorted account set/hour, day, or ten-minute window; pending review only, no penalties; service-role read-only, review through a narrow RPC |
| `api_abuse_events` | `actor_hmac,user_id,route_group,rule,bucket_start,event_count,timestamps,metadata` | Stores no raw IP/email/content; aggregated by bucket and kept for 30 days; service-role only |

Historical boundary: 0008 can't tell whether `profiles.points/credits/vip/streak` were tampered with during the old loose-permission period. The opening only stores the migration fact and doesn't mean the balance is trustworthy; 0009 appends a reversal to reset it to zero per the recorded product/security decision, without deleting the original record. Credits/VIP still have no rebuildable ledger.

### 3.7 Courses content, learning, distribution, and growth

The column lists below cover every table added in 0011. `uuid` defaults are all `gen_random_uuid()` (except composite keys/identity), and time columns default to `now()` unless noted.

| Table | All columns | Key constraints and relationships |
|---|---|---|
| `learning_courses` | `id`, `user_id`, `title`, `category`, `has_units`, `locale`, `origin_publication_id`, `origin_share_id`, `origin_author_name`, `can_republish`, `points_claimed_at`, `created_at`, `updated_at` | owner → Auth CASCADE; title 1–80; four categories but the v1 API only accepts English word lists; locale=`en-US`; `(id,user_id)` unique; clone origin → publication/share SET NULL, and the author attribution is kept after the origin record disappears |
| `learning_course_units` | `id`, `course_id`, `user_id`, `name`, `position`, `is_system`, `created_at`, `updated_at` | course/Auth CASCADE; composite FK `(course_id,user_id)` prevents cross-owner rows; name 1–80; position≥0; `(course_id,position)` deferred unique |
| `learning_course_words` | `id`, `course_id`, `unit_id`, `user_id`, `term`, `normalized_term`, `translations`, `ipa`, `position`, `content_version`, `created_at`, `updated_at` | `normalized_term` is a stored generated `_points_normalize_text(term)`; term 1–120; 1–10 translations; IPA≤120; composite unit/course/owner FK; normalized term and position deferred unique within the unit |
| `learning_sessions` | `id`, `user_id`, `course_id`, `unit_id`, `mode`, `scope`, `selected_skills`, `stage`, `active`, `state`, `revision`, `resume_key`, `spelling_options`, `started_at`, `last_activity_at`, `completed_at` | course CASCADE, unit deletion SET NULL; mode=`initial/review/exam`; scope=`all/unlearned`; skills are 1–3 of pronunciation/translation/spelling; stage is recognition/pronunciation/translation/spelling/completed; 0015's `revision bigint≥0` increases monotonically after each immutable attempt; 0017's `resume_key` is generated from the learning intent; 0019's `spelling_options` pins the timer/translation pre-test; 0027's exam stores the first-round threshold/accuracy/pass facts and the spelling end-of-round fields; 0029 adds `examKind=pronunciation` and `roundAssessmentScores/retrySummaryScores`; 0031's custom scope still lands in session items, with `selectionMode/selectedWordIds/practiceCompleted` stored in state, adding no client-writable columns |
| `learning_session_items` | `session_id`, `word_id`, `position`, `recognition_seen`, `pronunciation_passed`, `translation_passed`, `spelling_passed`, `wrong_count` | `(session_id,word_id)` PK; session/word deletion CASCADE; position deferred unique per session; the pass fields are projections for the current session |
| `learning_attempts` | `id`, `user_id`, `course_id`, `session_id`, `word_id`, `mode`, `skill`, `is_correct`, `answer`, `error_kind`, `provider_details`, `local_date`, `attempt_id`, `response_payload`, `word_id_snapshot`, `term_snapshot`, `created_at` | bigint identity; course/session/user CASCADE, word deletion SET NULL; 0031's trigger stores the word/term at the time for exam attempts, so details can still be linked after a word is deleted; skill also includes recognition and speech_assessment; `is_correct=null` is allowed for non-graded facts; ordinary test attempts are unique by `(user_id,session_id,attempt_id)` and store the full first response for timeout replays; old RPCs/recognition/scoring allow `attempt_id=NULL`; no recordings are stored; even service_role has no direct UPDATE/DELETE |
| `learning_exam_word_snapshots` | `session_id`, `word_id`, `position`, `term`, `ipa`, `translations`, `wrong_count`, `passed` | Enabled in production with 0031; session CASCADE, but doesn't reference the editable/deletable word; pins the word when the exam item is created and the final result on completion; RLS on and no client table permissions, redacted results only through the owner-scoped history API |
| `learning_word_progress` | `user_id`, `word_id`, `initial_recognition_seen`, `initial_pronunciation_passed`, `initial_translation_passed`, `initial_spelling_passed`, `pronunciation_review_dates`, `translation_review_dates`, `spelling_review_dates`, `wrong_count`, `review_count`, `spelling_exam_passed_at`, `pronunciation_exam_passed_at`, `learned_at`, `updated_at` | `(user_id,word_id)` PK; dedupe of the three date[] groups is guaranteed by the workflow, but they only express practice. Since 0033, passing and completing the spelling/pronunciation exams writes the corresponding timestamps, and `learned_at` is projected per word only when both timestamps are non-null. Production 0035's before trigger and two-way check force `learned_at` to exactly equal the later of the two exam timestamps, or null otherwise, and direct assignment can't bypass it. Since 0031 session items can be an owner-validated subset of the unit; content edits clear the corresponding exam facts and `learned_at` by term/translations/IPA semantics |
| `learning_review_schedules` | `id`, `user_id`, `course_id`, `unit_id`, `source_session_id`, `due_date`, `skills`, `scope`, `status`, `completed_session_id`, `completed_at`, `created_at` | user/course/unit/source initial session CASCADE, completed review session SET NULL; 3/7/15/30 offsets can only be created from the user's own completed initial session for that unit; status=`pending/completed/cancelled`; `(user_id,unit_id,due_date)` unique |
| `learning_speech_usage` | `id`, `user_id`, `kind`, `cost_microusd`, `character_count`, `local_date`, `created_at` | bigint identity; user deletion SET NULL to keep budget facts; since 0037 kind=`tts/assessment/translation_stt`, enabled in production; cost must be >0; TTS reservations record the character count and can use a NULL user for globally shared generation; STT only records the estimated cost and quota date, with no audio, transcript, or reference text |
| `learning_audio_assets` | `cache_key`, `normalized_term`, `synthesis_text`, `locale`, `voice`, `output_format`, `synthesis_version`, `storage_path`, `status`, `priority`, `attempt_count`, `next_attempt_at`, `lease_token`, `lease_until`, `last_error_code`, `last_error_message`, `ready_at`, `created_at`, `updated_at` | 64-character hex SHA-256 PK; storage path unique; status=`pending/processing/ready/failed`; leases, exponential backoff, and priority drive the durable worker; RLS on and table permissions fully revoked from public/anon/authenticated, service_role only; contains no user recordings, translations, or owner IDs |
| `learning_spelling_translation_assessments` | `assessment_id`, `user_id`, `session_id`, `word_id`, `expected_revision`, `answer_hash`, `status`, `correct`, `response_payload`, `provider`, `model`, token usage, `provider_attempts`, `quota_counted`, `quota_counted_at`, lease/error/timestamps | The assessment UUID is the PK/idempotency key; the answer is only stored as SHA-256; `quota_counted=false/quota_counted_at=null` means no provider-backed judgement quota was consumed, and the service-only reservation atomically writes true/the current time before the real request; the minute and rolling 24-hour windows are computed from that time; the lease prevents concurrent duplicate judging; RLS on and no client table permissions |
| `learning_course_shares` | `id`, `user_id`, `course_id`, `token_hash`, `active`, `author_name`, `created_at`, `revoked_at` | owner/course CASCADE; only the token SHA-256 is stored; token hash unique, at most one active share per course |
| `learning_course_publications` | `id`, `author_id`, `source_course_id`, `title`, `description`, `author_name`, `category`, `locale`, `version`, `snapshot`, `content_fingerprint`, `status`, `rights_declared_at`, `clone_count`, `created_at`, `updated_at` | author CASCADE, source SET NULL; English/en-US; status=`published/hidden/withdrawn`; unique per author/source/version; a trigger forbids changing the content snapshot/attribution/fingerprint/rights declaration, only allowing lifecycle, clone_count, nulling the source, and updated_at |
| `learning_course_reports` | `id`, `reporter_id`, `publication_id`, `share_id`, `category`, `details`, `status`, `created_at` | reporter CASCADE, target CASCADE; exactly one of publication/share; six report categories; details≤1000; status=`open/reviewing/resolved/dismissed` |
| `learning_course_moderation_actions` | `id`, `publication_id`, `actor_id`, `action`, `reason`, `created_at` | bigint identity; publication/actor deletion SET NULL, audit rows kept; action=`hide/restore/withdraw`; reason 1–1000 |
| `badge_definitions` | `code`, `family`, `tier`, `name`, `description`, `threshold`, `icon` | code PK; family+tier unique; tier 1–3; 0011 seeds a fixed nine tiers across vocab_words/vocab_courses/vocab_review_days |
| `user_badge_awards` | `user_id`, `badge_code`, `awarded_at`, `metadata` | composite PK; user CASCADE; badge definition DELETE RESTRICT; `ON CONFLICT DO NOTHING` guarantees each is awarded only once in history |

Content save constraints are supplemented by the single `learning_upsert_course` transaction: 4–2,000 distinct normalized words/phrases per course, at most 100 units, and non-empty, deduplicated translations per word. The database can store four categories for future compatibility, but the current API/UI explicitly rejects anything other than `english_vocabulary`.

The single dual-exam projection condition for `learned_at`, the events that never write it, the edit revocation matrix, and the code/test locations are maintained in one place in section 4 of the [Courses English vocabulary learning document](../notes/11-learning-courses.md); the ERD only records the final structural semantics, and `initial_*_passed`, review dates, single exams, or frontend correctness states must never be interpreted as learned.

### 3.8 Materials AI, Notes, and online exams (production 0041–0043; 0046–0051 candidate)

| Table | Key columns | Constraints, relationships, and fact boundaries |
|---|---|---|
| `ai_plans` | `code,generation_daily_limit,grading_daily_limit,active,timestamps` | Currently only seeds `free=10/10`; a product plan definition, not credits |
| `ai_user_plans` | `user_id PK→auth.users CASCADE,plan_code,consent_version,consented_at,timestamps` | Existing/new users are all back-filled with Free; consent is persisted per user and version |
| `ai_daily_usage` | `user_id,local_date,kind,plan_code,limit_count,reserved_count,consumed_count,timezone` | PK `(user_id,local_date,kind)`; `reserved+consumed<=limit`; the local day/time zone are frozen at reservation |
| `generation_jobs` | owner/material/course/name/kind/status/stage/progress/settings/idempotency/fingerprint/consent/quota/lease/models/note/error/timestamps; the candidate adds retryable/resume_until/checkpoint_stage/resume_count/accepted_at, `pipeline`, and deletion/cleanup fields | `(user_id,idempotency_key)` unique; at most one queued/processing/deleting per user; source deletion SET NULL but the name is kept; candidate kind=`exam/knowledge_graph/knowledge_question`, and short HTTP only acknowledges 202; deleting while queued releases quota, deleting after the worker has accepted consumes once, and it stays `deleting` until cleanup is confirmed |
| `generation_job_events` | `id,job_id,stage,progress,event_code,created_at` | job CASCADE; only stores stage facts, never file content or prompts |
| `generation_job_checkpoints` (candidate) | `job_id PK,user_id,stage,checkpoint_version,payload,expires_at,timestamps` | job/Auth CASCADE; DocumentIR stores parsed/audited/document_ready/artifact_ready/answer_ready, and Luna stores native_audited/native_artifact_ready/answer_ready; fully service-only, cleaned up on terminal state, deletion, or TTL |
| `exam_grading_checkpoints` (candidate) | `attempt_id PK,user_id,checkpoint_version,payload,expires_at,timestamps` | attempt/Auth CASCADE; only stores validated grading results for callback/container failure recovery; fully service-only, cleaned up after leaving grading or on TTL |
| `ai_material_parse_cache` | owner/material/source hash/parser/audit/vision versions/`canonical_document`/counts | material CASCADE; unique per file + all policy versions; this is a private durable cache, not a temporary directory |
| `notes` | owner/course/job/title/kind/material_name/`pipeline`/`generation_model`/timestamps | course/job deletion SET NULL; user deletion CASCADE; production kind=`ai_exam`, and the candidate adds `ai_knowledge_graph`; old rows are back-filled with `document_ir_v1` |
| `note_materials` | note/material/name/source hash | note CASCADE, material SET NULL; the snapshot name/hash are kept after the source is deleted |
| `note_artifacts` | `note_id PK,schema_version,content,question_count,total_marks,node_count,edge_count,timestamps` | note CASCADE; production schema=`generated-exam.v1`, and the candidate adds `generated-knowledge-graph.v1`; artifact content carries `sourceMode` and compatible page/slide/section/image locators, and DocumentIR `blockId` still renders; a kind-shape check forbids mixing exam and graph counts |
| `exam_attempts` | owner/note/number/status/revision/deadline/scores/grading reservation+lease/timestamps | `(user,note,attempt_number)` unique; note/user CASCADE; absolute deadline, unlimited retakes, subjective grading can be deferred; `in_progress` only stores drafts and responds with `results=[]`, and grading/showing answers only happens after unified submission |
| `exam_attempt_answers` | `attempt_id,question_id,answer,awarded_marks,correct,feedback,updated_at` | PK `(attempt,question)`; attempt CASCADE; written only by transactional RPCs |
| `exam_attempt_operations` | `attempt_id,operation_id,operation_kind,response_payload,created_at` | The PK guarantees save/submit/grade replays with the same UUID return the first response |
| `ai_provider_usage_events` | owner, immutable job XOR attempt audit ID, purpose/provider/model/request ID/tokens/cost/duration/ZDR/status/error; the candidate adds `event_id`, `pipeline`, `upstream_provider`, `upstream_endpoint` | Only stores metering metadata; the event UUID is unique, so disconnect replays never double-bill; the job/attempt IDs deliberately have no content lifecycle FK, so cost and real routing audits are kept after a job is deleted; deleting the Auth owner still CASCADEs; prompts, content, answers, or raw responses must never be stored |
| `knowledge_node_questions` (candidate) | `id PK→generation_jobs,user_id,note_id,node_id,question,answer,timestamps` | job/note/Auth CASCADE; questions 1–2000 characters; owner read-only, creation/answering only through the server workflow; answers must cite the source blocks allowed for that node |
| `knowledge_graph_layouts` (candidate) | `note_id PK,user_id,artifact_version,revision,positions,viewport,timestamps` | note/Auth CASCADE; owner read-only, writes only through the revision RPC; when the graph content changes, only positions of nodes that still exist are reused and the rest are laid out again; coordinates, zoom, and JSON shape are all validated by the server |

Postgres is the single source of truth for quota, jobs, Notes, answer sheets, and scores; BullMQ only holds UUIDs and never forms a second set of state. Clients can't write any of the tables above directly or execute workflow RPCs.

## 4. Deletion and lifecycle rules

| Parent entity deleted | Current result |
|---|---|
| `auth.users` | Cascades to delete the profile, Materials courses, private learning courses/sessions/attempts/progress/schedules/shares, spelling translation judgement facts, the user's own publications/reports, badge awards, and points entries/states/daily windows/claims. Speech usage/Courses moderation actor become NULL; points moderation actions keep the admin UUID, and signal owner/reviewer FKs are set to NULL while the account UUID arrays are kept for security audits. Whether Storage files are deleted is not guaranteed by FKs. |
| `courses` | Materials CASCADE; `course_id` on goals/tasks and AI Notes SET NULL. The 0041 application deletion entry first cancels jobs/clears caches, and per the user's choice moves Notes to Unfiled or cascades to delete results. |
| `materials` | `material_id` on tasks and generation jobs SET NULL, parse caches CASCADE, note sources SET NULL; the 0041 application orchestrates by the keep/delete choice first. Storage objects are not deleted automatically by FKs. |
| `notes` | Source snapshots, artifacts, answer sheets, answers, and operations CASCADE; the generation job's note FK SET NULL. |
| `study_goals` | Tasks' `goal_id` SET NULL. |
| `posts` | Comments/likes/favorites CASCADE; reposts referencing it also CASCADE; the related active points events are reversed by triggers. Media objects aren't deleted automatically. |
| `learning_courses` | Units, words, sessions, attempts, progress, review schedules, and shares of the source course cascade; the publication's source SET NULL, and clones' `origin_share_id` SET NULL along with the deleted share. Already awarded points entries have no source FK and aren't deleted; user badges aren't rolled back by course deletion either. |
| `learning_course_shares` | Clones' `origin_share_id` SET NULL; reports against that share CASCADE. |
| `learning_course_units/words/sessions` | Downstream words, session items, attempts/progress cascade via FKs; deletion can only go through the course transaction API, and clients can't execute it directly. |
| `learning_course_publications` | Clones' `origin_publication_id` SET NULL; reports CASCADE; moderation actions' publication_id SET NULL and kept. |
| `learning_course_shares` | Linked reports CASCADE; revocation usually only writes `active=false/revoked_at` without deleting. |

The two-user RLS E2E verifies the relationship table cascades after Auth deletion in its cleanup phase; the repository still has no production-grade account deletion orchestration that first cleans up Storage objects, exports/cools down, or issues a deletion receipt, so the full privacy deletion process still needs to be implemented separately.

## 5. RLS matrix

Every current business table has RLS enabled.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | self | no client policy (created by the Auth trigger) | self, only `username/university/major/year/language/timezone`; protected columns are forbidden by both grants + triggers | no client policy |
| `courses` | owner | owner | owner | owner |
| `materials` | owner | owner + linked course owner | owner + linked course owner | owner |
| `notifications` | owner | owner | owner | owner |
| `feedback` | owner | owner, only `category/summary/body` | none | none |
| `posts` | all authenticated | author | author | author |
| `comments` | all authenticated | author | no policy | author |
| `post_likes`, `post_favorites` | own relationship rows only | self | self | self |
| `follows` | follower or following is self | follower is self | no policy | follower is self |
| `tags` | all authenticated | any authenticated | no policy | no policy |
| `study_goals` | owner | owner | owner | owner |
| `study_tasks` | owner | owner + owner of all linked entities | same as left | owner |
| `point_entries` | self | no client permission/policy | no client permission/policy | no client permission/policy |
| `point_event_states` | no client permission/policy | none | none | none |
| `point_daily_*`, `point_moderation_actions`, `point_abuse_signals`, `api_abuse_events` | no client permission/policy | none | none | none |
| `learning_courses/units/words` | owner | none | none | none |
| `learning_sessions/items/attempts/progress/review_schedules` | owner (items via session) | none | none | none |
| `learning_exam_word_snapshots` | no client reads | none | none | none |
| `learning_spelling_translation_assessments` | no client reads | none | none | none |
| `learning_course_shares` | owner | none | none | none |
| `learning_course_publications` | author only | none | none | none |
| `learning_course_reports` | reporter only | none | none | none |
| `learning_speech_usage`, `learning_course_moderation_actions` | no client reads | none | none | none |
| `badge_definitions` | all authenticated | none | none | none |
| `user_badge_awards` | self | none | none | none |
| `ai_plans`, `ai_user_plans`, `ai_daily_usage` | active plan / self | none | none | none |
| `generation_jobs`, `generation_job_events` | self (events via job) | none | none | none |
| `ai_material_parse_cache`, `ai_provider_usage_events`, `exam_attempt_operations` | no client reads | none | none | none |
| `notes`, `note_materials`, `note_artifacts`, `exam_attempts`, `exam_attempt_answers` | self (child tables via the owner parent) | none | none | none |
| `generation_job_checkpoints` (candidate) | no client reads | none | none | none |
| `exam_grading_checkpoints` (candidate) | no client reads | none | none | none |
| `knowledge_node_questions` (candidate) | self | none | none | none |
| `knowledge_graph_layouts` (candidate) | self | none | none | none |

Migration 0008 fixed the whole-row Profile update gap. Production 0039 further split the Feedback policy, restricted post column grants, and added the Schedule owner trigger; 0040 fails closed on exact column permissions, triggers, and internal table/RPC grants. Production 0052–0053 revoked authenticated's compatibility UPDATE grant on `posts.updated_at` and `study_tasks.done_at` after the observation passed, and verified that valid content/Schedule columns, the service role, and the time triggers are unaffected.

## 6. Storage model

| Bucket | Visibility | Current object policies | Path convention | Relationship boundary |
|---|---|---|---|---|
| `materials` | private | authenticated can only SELECT/INSERT/DELETE paths whose first segment is its own UUID | `{auth.uid()}/...` | `materials.storage_path` is a text reference; there is no FK/transaction between the table and objects |
| `community-media` | public | authenticated can only INSERT/DELETE paths whose first segment is its own UUID; public reads are provided by the public bucket | `{auth.uid()}/...` | `posts.image_url/audio_url` are URL text; deleting a post doesn't delete the object automatically |
| `vocabulary-audio` | private | No client Storage policy; only the API service role reads/writes | `SHA-256(normalizedTerm␟locale␟voice␟format␟synthesisVersion).mp3` | Only Azure-synthesized speech reusable across users is allowed; no user recordings are stored, and there is no FK to word rows |

The Storage policies have no object UPDATE policy. When replacing a file, use a new path or explicitly design a safe policy.

## 7. Functions and triggers

| Function/trigger | Event | Current role |
|---|---|---|
| `handle_new_user` / `on_auth_user_created` | `auth.users AFTER INSERT` | Creates the profile |
| `touch_updated_at` / `profiles_touch` | `profiles BEFORE UPDATE` | Updates the timestamp |
| `_post_author` / `posts_author` | post BEFORE INSERT | Overwrites the author snapshot from the profile |
| `_comment_author` / `comments_author` | comment BEFORE INSERT | Overwrites the author name from the profile |
| `_bump_counts` / `likes_cnt`,`favs_cnt`,`comments_cnt` | interaction INSERT/DELETE | Maintains redundant post counts |
| `_bump_repost` / `repost_cnt` | post INSERT/DELETE | Maintains the original post's repost count |
| `_sync_profile_tags` / `profiles_tags` | profile INSERT/related UPDATE | Collects global university/major tags |
| `_sync_course_tags` / `courses_tags` | course INSERT | Collects subject tags |
| `_add_points` | Retired legacy helper | No longer used by business triggers; PUBLIC/anon/authenticated/service_role EXECUTE all revoked |
| `_notify` | Called by other functions | Inserts notifications |
| `_set_point_event` | Internal state transition | Writes entries/state by business key and recomputes points/level; no client EXECUTE, service_role can call it through trusted RPCs |
| `_point_daily_bounds`, `_point_daily_window`, `_point_daily_limit` | Production 0039 internal helpers | Compute and freeze the reward calendar day/time zone bounds, avoid overlapping windows from time zone changes, and return the event count cap; no client EXECUTE |
| `get_point_reward_receipt` | Production 0039 owner RPC | Looks up the user's own source/event decision from `auth.uid()` and returns the amount/usage/cap/suppression reason; the over-cap notification is created idempotently together with the reward decision in the original business transaction |
| `moderate_point_rewards` | Production 0039 service-only RPC | Suppresses/restores actual rewards by business key or post root chain and appends moderation facts |
| `scan_point_abuse_signals`, `record_api_abuse_event`, `prune_api_abuse_events` | Production 0039 service-only RPCs | Generate pending coordination signals, aggregate HMAC API rejection events, and prune 30-day-old buckets |
| `_guard_post_integrity`, `_guard_feedback_insert`, `_guard_study_goal_integrity`, `_guard_study_task_integrity` | Production 0039 BEFORE triggers | Overwrite or reject trusted fields, times, and cross-owner references; ordinary roles have no EXECUTE |
| `_post_points_key`, `_root_post_points_key`, `_task_points_key` and the assign/preserve triggers | post/like/comment/task INSERT and protected UPDATE | Generate and freeze content-anchored business keys; a post's `repost_of` and the interaction identity are frozen together |
| `_guard_profile_managed_fields` | profile BEFORE UPDATE | Prevents ordinary JWT roles from modifying the economy, level, VIP, and streak fields |
| `_on_like` / `likes_award` | like AFTER INSERT/DELETE | +1 on the first activation of a non-self like; reversed on delete; notifies the post owner |
| `_on_comment` / `comments_award` | comment AFTER INSERT/DELETE | +2 per non-self actor/post relationship; reversed when the last one is deleted; notifies the post owner |
| `_on_fav` / `favs_notify` | favorite AFTER INSERT | Notifies the post owner |
| `_on_post` / `posts_award` | post AFTER INSERT/DELETE | +10 for original posts / +3 for reposts; reversed when the last post with the same business key is deleted, and notifies as needed |
| `_on_follow` / `follows_notify` | follow AFTER INSERT | Notifies the followed user |
| `_on_task_done` / `task_points_update`,`task_points_delete` | task `done` AFTER UPDATE or DELETE | +5 on first completion; reversed on un-completing/deleting the last task with the same key; streak only updates on first activation |
| `_guard_profile_timezone` / `profiles_guard_timezone`, `profiles_guard_timezone_insert` | profile BEFORE INSERT / timezone BEFORE UPDATE | Only accepts IANA names in PostgreSQL's `pg_timezone_names` |
| `_guard_learning_publication_snapshot` / `learning_publications_preserve_snapshot` | publication BEFORE UPDATE | Prevents rewriting the content, attribution, fingerprint, and rights declaration of a published version |
| `_learning_local_date`, `_learning_course_fingerprint`, `_learning_course_snapshot` | Courses helpers | Pin the attempt's local date, the word set SHA-256, and the server-internal course snapshot; the public API additionally removes private IDs/progress through `publicSnapshot` |
| `_refresh_learning_growth` | Learning/review completion | Awards the course +20 points and the nine-tier badges; durable business keys/award PK prevent duplicates |
| `learning_upsert_course`, `learning_rename_course`, `learning_delete_course` | API RPCs | Atomic save, precise ability resets, renaming, and cascading deletion under owner validation |
| `learning_start_session`, `learning_mark_recognition`, `learning_record_attempt` | API RPCs | Create/resume queues, persist step by step, and loop the test retry pool; 0015 keeps the old five-parameter answer signature and adds a seven-parameter UUID/revision overload; 0017 resumes by request intent; 0021 unifies Unicode normalization, and 0023's seven-parameter authoritative spelling path now calls `_learning_spelling_text_matches` |
| `learning_get_session_snapshot`, `_learning_session_patch`, `_learning_increment_session_revision` | API/internal RPC and trigger helper | Return session/items/words/progress in one call; write transactions return small deltas; `learning_attempts AFTER INSERT` advances the revision, so writes from a rolled-back old application can't bypass the version clock |
| `learning_cancel_session` | API RPC | Validates the owner and locks the session, idempotently sets it inactive and advances the revision; keeps attempts/progress and review schedules; only the service role may execute it |
| `learning_start_exam_session`, `learning_continue_spelling_retry_round` | Compatibility API RPCs | 0028 starts/resumes spelling unit exams and durably shuffles the first round; the old spelling end-of-round signature is kept for compatibility, and the 0034 production application uses the general exam RPC |
| Six-parameter `learning_start_exam_session(...,p_exam_kind)`, `learning_continue_exam_retry_round` | API RPCs | 0029 backward-compatibly adds the `spelling/pronunciation` exam kinds; the general confirmation RPC saves the wrong-word set, clears the review state, and reorders by round; both are granted only to the service role |
| `learning_start_selected_review_session`, `learning_start_selected_exam_session` | API RPCs | 0031 validates the owner/course/unit/scope of 1–2,000 unique word IDs, pins the session items, and isolates resume intent with a hash of the sorted set; granted only to the service role |
| `learning_list_exam_history`, `learning_get_exam_history_detail` | API RPCs | 0031 returns, from private immutable word/attempt snapshots, summaries of the owner's latest 100 exams and redacted single-exam details; returns no recordings, keys, or full provider payloads; granted only to the service role |
| `learning_claim_spelling_translation_assessment_v2`, `learning_reserve_spelling_translation_quota` | API RPCs | First create an idempotent judgement lease that doesn't count against quota; only right before a real OpenRouter call check the minute/rolling 24-hour limits under a per-user advisory lock and reserve quota |
| `_learning_apply_passed_exam_progress` | exam session completion | 0031 writes `practiceCompleted=true` for every completed exam; only when the first round meets the threshold are the session's selected words marked learned, after which the existing growth projection handles course completion/rewards |
| `_learning_normalize_spelling_options`, `_learning_normalize_spelling_text`, `_learning_spelling_without_punctuation`, `_learning_spelling_text_matches`, `learning_claim/complete/release_spelling_translation_assessment`, `learning_record_spelling_attempt` | API/internal RPCs | Pin the timer/translation pre-test options; spelling first applies NFKC/whitespace/ASCII case folding, then compares three ways — punctuation kept, punctuation removed, punctuation treated as spaces — relaxing only punctuation differences; claim the provider lease and quota by UUID/revision/answer hash, save the verdict, and atomically form the authoritative attempt |
| `learning_schedule_reviews`, `learning_cancel_review_schedule`, `learning_profile_summary` | API RPCs | Create review schedules from completed initial sessions, cancel them, and aggregate Schedule/Profile facts |
| `learning_record_speech_assessment`, `learning_reserve_speech_quota` | API RPCs | Store non-audio scoring facts; in production the recognition stage updates retry items by the controlled pass mark; since 0029 also atomically advances the pronunciation exam's first-round counts, score list/retry round, and mastery projection; persist per-user rate and global budget reservations |
| `learning_reserve_translation_stt` | API RPC; enabled in production with 0037 | Before the provider call, locks and validates the owner's active spelling session, `translationFirst`, revision, and current word, and atomically performs the minute/local-day/month budget reservation; only returns reservation/revision, and never reads or writes transcripts, answers, attempts, cursors, or progress |
| `_learning_audio_cache_key`, `learning_prepare_unit_audio`, `learning_prepare_word_audio`, `learning_get_unit_audio_manifest` | Server audio RPCs | Compute the global content hash, enqueue idempotently by unit/word after owner validation, and return a per-user manifest that doesn't expose Storage |
| `learning_claim_audio_asset`, `learning_finish_audio_asset`, `learning_requeue_audio_asset`, `learning_reserve_tts_quota` | Server worker RPCs | A database advisory lock + a single active lease guarantee global single concurrency, a minimum 3.1-second start interval, failure backoff, rebuilding lost Storage objects, and per-minute/monthly character/budget reservations |
| `learning_create_share`, `learning_revoke_share`, `learning_clone_share` | API RPCs | The token hash lifecycle and transactional cloning within the revocation race |
| `learning_publish_course`, `learning_clone_course`, `learning_create_report`, `learning_moderate_publication` | API RPCs | Immutable published versions, free independent clones, rate-limited reports, and audited hide/restore |
| `_ai_create_user_plan` | Auth user AFTER INSERT | Idempotently creates a Free plan for new users; ordinary roles have no EXECUTE |
| `ai_get_quota_summary`, `ai_create/claim/update/complete/fail/cancel_generation_job` | Materials AI service-only RPCs | Atomic reservation, lease, stage/event, result/cache/usage, consume/release; a crashed lease fails and refunds after three attempts |
| `ai_mark_generation_job_accepted`, `ai_record_generation_usage_v2`, `ai_checkpoint_generation_job_v2`, `ai_checkpoint_exam_grading`, `ai_retry_generation_job`, `ai_expire_generation_checkpoints` (candidate) | Materials AI service-only RPCs | Renew the lease after 202 acceptance, record cost and the real upstream/pipeline incrementally by UUID, save DocumentIR/Luna's own validated checkpoints, resume the same job within its deadline, and clean up expired checkpoints/leftovers; expiry/exhausted retries must reach a durable terminal state and release the reservation |
| `ai_create_generation_job(...,pipeline)`, `ai_complete_material_generation_job_v2`, `ai_complete_knowledge_question_job_v2`, `ai_complete_exam_grading_v2` (candidate) | Materials AI service-only RPCs | Pin the DocumentIR/Luna dual-pipeline contract (Ox retired in 0056); Luna pins `openai/gpt-6-luna` at creation, and Azure upstream usage matching the purpose must exist before a successful commit, so routing-violating results never enter Notes/scores |
| `ai_delete_generation_job`, `ai_clear_generation_history`, `ai_record_generation_cleanup_failure`, `ai_finalize_generation_job_cleanup` (candidate) | Materials AI service-only RPCs | Atomically settle quota, enter deleting, durably retry cleanup, and hard-delete after the worker confirms the purge; clearing history never touches active jobs or generated Notes, and the usage ledger is kept |
| `ai_get_knowledge_graph_layout`, `ai_save_knowledge_graph_layout` (candidate) | Knowledge graph service-only RPCs | Validate the owner, artifact SHA-256, and revision; conflicts return the current layout, and on content version changes the mergeable node coordinates are kept and the revision is reset |
| `ai_create_knowledge_question_job` (candidate) | Knowledge Q&A service-only RPC | Validates the graph/note/node owner, atomically reserves Free generation quota, and creates an idempotent job and read-only Q&A fact |
| `ai_create_exam_attempt`, `ai_save_exam_answers`, `ai_submit_exam_attempt` | Exam service-only RPCs | Owner/deadline/revision/operation UUID validation, deterministic server-side objective grading, and forced submission at the deadline |
| `ai_request/claim/complete/fail_exam_grading` | Grading service-only RPCs | Daily reservation for subjective questions, lease, idempotent grading, consume on success/release on failure; recovers to `submitted_ungraded` after three crashes |
| `ai_delete_note`, `ai_delete_material`, `ai_delete_material_course` | Deletion orchestration service-only RPCs | Validate the owner, cancel jobs, clear caches, and per keep/delete either keep results in Unfiled or delete the AI results |

Migration 0008 explicitly revoked client execute permission on internal helpers. Production 0039–0040 keep default-deny and only grant the owner receipt to authenticated; `review_point_abuse_signal`, `moderate_point_rewards`, scanning, and the API audit RPCs are granted only to the service role, and the service role only has SELECT on the corresponding internal fact tables, so it can't bypass the workflows through PostgREST. It still doesn't include automated content quality judgement, automatic penalties, an appeals UI, or general RBAC.

All of 0012's `learning_*` workflows and sensitive helpers likewise revoke EXECUTE from `public/anon/authenticated` and grant only to service_role; `learning_attempts` also revokes direct UPDATE/DELETE from service_role. 0013–0036 keep checking append-only, RLS, exact function signatures, and service-role grants; 0023–0024 verify the punctuation matcher, 0025–0026 verify cancellation, 0027–0028 verify the exam/round confirmation/quota reservation RPCs, 0029–0034 verify the pronunciation exam, word selection, history, the dual-exam constraint, triggers, and client rejection; 0035–0036 verify the exact mastery projection, no writes from reviews, and no client permission to change progress. The user ID, revision, judgement input, and quota passed by the API come from a validated/controlled context, and browsers must never execute RPCs directly.

## 8. Index list

- `materials_course_idx(course_id)`
- `notifications_user_idx(user_id, created_at DESC)`
- `feedback_user_idx(user_id, created_at DESC)`
- `posts_created_idx(created_at DESC)`
- `posts_user_idx(user_id)`
- `posts_subject_idx(subject)`
- `posts_points_business_key_idx(points_business_key)`
- `comments_post_idx(post_id, created_at)`
- `comments_points_business_key_idx(points_business_key)`
- `post_likes_points_business_key_idx(points_business_key)`
- `study_tasks_user_due_idx(user_id, due_date)`
- `study_tasks_points_business_key_idx(points_business_key)`
- `point_entries_user_created_idx(user_id, created_at DESC)`
- `point_event_states_user_idx(user_id, updated_at DESC)`
- `point_entries UNIQUE(business_key, transition_no)`
- Production 0039: `point_daily_windows(user_id,ends_at DESC)`, the claims' window/event, target owner, and root indexes; `point_moderation_actions(target_type,target_key,created_at DESC)`; `point_abuse_signals(status,detected_at DESC)`; `api_abuse_events(last_seen_at)`, plus their own primary keys/unique fingerprint or time bucket constraints.
- `learning_courses_user_updated_idx(user_id, updated_at DESC)`
- `learning_course_units_owner_idx(user_id, course_id, position)`
- `learning_course_words_course_idx(course_id, unit_id, position)`, `learning_course_words_owner_term_idx(user_id, normalized_term)`
- `learning_sessions_one_active_intent_idx UNIQUE(user_id,resume_key) WHERE active`, `learning_sessions_active_course_activity_idx(user_id,course_id,last_activity_at DESC) WHERE active`, `learning_sessions_owner_activity_idx(user_id,last_activity_at DESC)`
- `learning_attempts_owner_created_idx(user_id, created_at DESC)`, `learning_attempts_course_idx(course_id, created_at DESC)`, `learning_attempts_word_idx(word_id, created_at DESC)`
- `learning_attempts_idempotency_idx UNIQUE(user_id,session_id,attempt_id)` (NULL only for compatibility with old/non-ordinary answer facts)
- `learning_speech_usage_user_rate_idx(user_id, kind, created_at DESC)`, `learning_speech_usage_budget_idx(created_at DESC)`, `learning_speech_usage_kind_rate_idx(kind,created_at DESC)`
- `learning_audio_assets_queue_idx(priority DESC,next_attempt_at,created_at) WHERE status IN ('pending','processing')`
- Candidate 0046–0051: `generation_jobs_resume_expiry_idx(resume_until) WHERE retryable`, `generation_job_checkpoints(expires_at)`, `exam_grading_checkpoints(expires_at)`, `ai_provider_usage_events UNIQUE(event_id)`, `knowledge_node_questions(note_id,created_at DESC)`, `knowledge_graph_layouts_user_idx(user_id,updated_at DESC)`.
- `learning_spelling_translation_owner_created_idx(user_id,created_at DESC)`, `learning_spelling_translation_session_idx(session_id,word_id,expected_revision,completed_at DESC)`, `learning_spelling_translation_counted_quota_idx(user_id,quota_counted_at DESC) WHERE quota_counted`
- `learning_word_progress_learned_idx(user_id, learned_at) WHERE learned_at IS NOT NULL`
- `learning_review_schedules_owner_due_idx(user_id, due_date, status)`
- `learning_course_shares_one_active_idx(course_id) WHERE active`
- `learning_course_publications_market_idx(status, created_at DESC)`, `learning_course_publications_author_idx(author_id, created_at DESC)`, the conditional unique index on author/source/version
- `learning_course_reports_target_idx(publication_id, share_id, status, created_at DESC)`
- `generation_jobs_user_created_idx(user_id,created_at DESC)`, the per-user active conditional unique index, `generation_jobs_dispatch_idx(status,created_at)`; `generation_job_events_job_idx(job_id,id)`
- `notes_user_updated_idx(user_id,updated_at DESC)`, `notes_course_idx(course_id,updated_at DESC)`
- `exam_attempts_user_idx(user_id,created_at DESC)`, the conditional index on unfinished deadlines; `ai_provider_usage_month_idx(created_at,status)`
- Indexes provided automatically by primary keys/unique constraints: all single-column primary keys and the composite primary keys of likes, favorites, follows, and tags.

## 9. Target model (doesn't exist yet)

The final product still needs at least the following domains designed explicitly through new migrations; they must not be assumed to exist based on the blueprint:

- Structured knowledge lists, standalone Quiz, and a general version of the knowledge graph; the first versions of `notes/generation_jobs/mock exams` are in production 0041–0043, and the knowledge graph candidate is in 0046–0051;
- General note market products, credits licensing/purchase relationships, and creator revenue share; Courses free sharing/market snapshots already exist;
- A credits wallet ledger, balance projection, and approved admin adjustments; the points ledger exists but still needs anti-abuse caps, reconciliation, and operations tools;
- VIP entitlements/subscriptions, orders, payment intents, idempotent webhook records, refunds;
- Community/note content reports, moderation queue, handling, and appeals; Courses has reports and admin actions, but no general queue/appeals;
- User consent, data export/deletion jobs, retention periods;
- Admin roles, audit logs, system configuration.

When target entities land, also add: FK deletion semantics, unique/check constraints, indexes, RLS, service-role permissions, auditing, migration/rollback, and automated tests.
