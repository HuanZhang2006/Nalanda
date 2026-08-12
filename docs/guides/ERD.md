# ERD 与数据库字典

> **本文内容：** 描述当前 Supabase/PostgreSQL 中全部应用表、字段、关系、删除行为、RLS、Storage 桶、触发器与数据库函数，并单列尚未实现的目标实体。  
> **作用：** 作为数据库结构评审、接口开发、迁移编写、安全审计和数据恢复时的共同事实来源。  
> **何时更新：** 每次新增或修改迁移、表/列/约束/索引/RLS/函数/触发器/Storage 策略时与代码同一个变更提交更新；目标模型转为真实迁移时也要更新状态。

## 1. 权威来源与范围

本页按 `supabase/migrations/20260620000001_profiles.sql` 至生产 0048 验证迁移的最终叠加结果整理。迁移 SQL 是仓库结构权威；生产 migration history 已确认到 0048。时间列撤权 contract 仍保留为未来 0044–0045 的独立工作。

- **生产结构**：生产 0048 包含 0039–0040 安全/限流、0041–0043 Materials AI/Notes/考试，以及 0046–0048 checkpoint/图谱/问答实体、事务和验证，另有 `auth.users`、3 个 Storage bucket 及相关 RLS/函数/触发器。
- **未实现目标**：Courses AI 文件导入、Knowledge list、独立 Quiz、通用市场、credits 钱包账本、订单/支付、订阅/VIP 权益和完整社区审核实体。

## 2. 当前 ERD

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

`auth.users` 由 Supabase Auth 管理；图中只展示应用实际引用的 `id` 和概念性 `email`，不是对 Auth 内部表的完整定义。

### 2.1 Courses 子域 ERD

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

`learning_attempts` 是追加事实，`learning_word_progress` 是受保护投影；市场 publication 是不可变快照，source 课程删除时只把 `source_course_id` 置空。分享读取当前课程，不保存内容副本。`learning_audio_assets` 不外键关联用户或 word：相同规范化词、locale、voice、格式和合成版本通过内容哈希共享一项可重建任务/对象。`learning_spelling_translation_assessments` 只保存用户答案 SHA-256、供应商判定/计量、租约和首次响应；用户键入的翻译正文不落库。

## 3. 表字典

### 3.1 `profiles`

与 `auth.users` 共享主键，注册后的 `handle_new_user` 触发器负责创建。`points`/等级用于活动成长：`points` 是 `point_entries` 的缓存投影，等级由该投影计算；`credits` 仍只是尚无钱包账本的预留数值。普通 authenticated 用户只能更新资料白名单列，不能更新 points、credits、等级、VIP 或 streak。

| 列 | 类型 | 空值/默认 | 关系或说明 |
|---|---|---|---|
| `id` | `uuid` | PK，非空 | → `auth.users.id ON DELETE CASCADE` |
| `username` | `text` | 可空 | 默认建档时取邮箱 `@` 前部分 |
| `email` | `text` | 可空 | Auth 邮箱快照，不是认证权威字段 |
| `university`, `major`, `year` | `text` | 可空 | 用户资料 |
| `language` | `text` | 非空，`'zh'` | 当前无 check constraint |
| `timezone` | `text` | 非空，`'UTC'` | 0011 增加；插入/更新 trigger 必须在 `pg_timezone_names` 中存在，历史 attempt `local_date` 不随修改重写 |
| `credits` | `integer` | 非空，`0` | 尚无钱包账本/支付闭环 |
| `points` | `integer` | 非空，`0` | 迁移 0006 增加；0008 起由 ledger 总和投影并 clamp 到 `0..2147483647` |
| `level` | `integer` | 非空，`1` | `_set_point_event` 根据 points 投影计算 |
| `level_name` | `text` | 非空，`'Novice'` | `_set_point_event` 根据 points 投影计算 |
| `vip_until` | `timestamptz` | 可空 | 尚无订阅/支付写入规则 |
| `streak` | `integer` | 非空，`0` | 迁移 0007 增加 |
| `streak_date` | `date` | 可空 | 最近一次计入连续学习的日期 |
| `created_at`, `updated_at` | `timestamptz` | 非空，`now()` | `profiles_touch` 更新 `updated_at` |

### 3.2 `courses` 与 `materials`

| 表 | 列 | 类型 | 空值/默认 | 关系或说明 |
|---|---|---|---|---|
| `courses` | `id` | `uuid` | PK，`gen_random_uuid()` | — |
|  | `user_id` | `uuid` | 非空，`auth.uid()` | → `auth.users.id CASCADE` |
|  | `code` | `text` | 可空 | 课程代码 |
|  | `name` | `text` | 非空 | — |
|  | `color` | `text` | 非空，`'#9c6a39'` | — |
|  | `term`, `instructor` | `text` | 可空 | — |
|  | `created_at` | `timestamptz` | 非空，`now()` | — |
| `materials` | `id` | `uuid` | PK，`gen_random_uuid()` | — |
|  | `user_id` | `uuid` | 非空，`auth.uid()` | → `auth.users.id CASCADE` |
|  | `course_id` | `uuid` | 非空 | → `courses.id CASCADE`；RLS 还检查课程归属 |
|  | `name` | `text` | 非空 | — |
|  | `type` | `text` | 可空 | 当前无格式枚举约束 |
|  | `size_bytes` | `bigint` | 非空，`0` | — |
|  | `storage_path` | `text` | 非空 | 指向 `materials` bucket 的逻辑路径，无数据库 FK |
|  | `created_at` | `timestamptz` | 非空，`now()` | — |

索引：`materials(course_id)`。

### 3.3 `notifications` 与 `feedback`

| 表 | 列 | 类型 | 空值/默认 | 说明 |
|---|---|---|---|---|
| `notifications` | `id` | `uuid` | PK，`gen_random_uuid()` | — |
|  | `user_id` | `uuid` | 非空，`auth.uid()` | → `auth.users.id CASCADE` |
|  | `type` | `text` | 可空 | 如 `like/comment/favorite/repost/follow/streak`，无 check |
|  | `title` | `text` | 非空 | — |
|  | `body` | `text` | 可空 | — |
|  | `read` | `boolean` | 非空，`false` | — |
|  | `created_at` | `timestamptz` | 非空，`now()` | 索引 `(user_id, created_at DESC)` |
| `feedback` | `id` | `uuid` | PK，`gen_random_uuid()` | — |
|  | `user_id` | `uuid` | 非空，`auth.uid()` | → `auth.users.id CASCADE` |
|  | `category` | `text` | 可空 | — |
|  | `summary` | `text` | 非空 | — |
|  | `body` | `text` | 可空 | — |
|  | `status` | `text` | 非空，`'open'` | 生产 0039 起仅 service-role 支持流程可改；用户只可新增/读取自己的反馈 |
|  | `created_at` | `timestamptz` | 非空，`now()` | 索引 `(user_id, created_at DESC)` |

### 3.4 社区表

#### `posts`

| 列 | 类型 | 空值/默认 | 说明 |
|---|---|---|---|
| `id` | `uuid` | PK，`gen_random_uuid()` | — |
| `user_id` | `uuid` | 非空，`auth.uid()` | → `auth.users.id CASCADE` |
| `author_name`, `author_university`, `author_major` | `text` | 可空 | 插入时由 `_post_author` 从 profile 覆盖为快照 |
| `title`, `body` | `text` | 可空 | 数据库未要求至少一个非空 |
| `kind` | `text` | 非空，`'experience'` | 注释约定 experience/question/tip/note_share，无 check |
| `subject` | `text` | 可空 | 非 FK 的课程/学科文本 |
| `tags` | `text[]` | 非空，`'{}'` | 不与 `tags` 表做 FK |
| `repost_of` | `uuid` | 可空 | → `posts.id CASCADE`；原帖删除会级联删除转发帖 |
| `image_url`, `audio_url` | `text` | 可空 | 通常是公开 bucket URL，无 FK/所有权校验 |
| `points_business_key` | `text` | 非空 | 0008 增加；原创按 owner + 规范化内容生成，转发按 actor + 根原创内容键生成，且与 `repost_of` 一并不可变 |
| `like_count`, `comment_count`, `favorite_count`, `repost_count` | `int` | 非空，`0` | 触发器维护的冗余计数 |
| `created_at`, `updated_at` | `timestamptz` | 非空，`now()` | 生产 0039 trigger 维护：内容变化才更新 `updated_at`，计数变化不刷新；兼容期客户端值会被覆盖 |

索引：`created_at DESC`、`user_id`、`subject`、`points_business_key`。

#### 互动与关系

| 表 | 主键 | 其它列/关系 | 删除行为 |
|---|---|---|---|
| `comments` | `id uuid` | `post_id → posts`、`user_id → auth.users`、`author_name` 快照、`body NOT NULL`、`points_business_key NOT NULL`、`created_at` | post/user 均 CASCADE；points key 锚定目标帖不可变内容键 + actor；索引 `(post_id, created_at)` 与 points key |
| `post_likes` | `(post_id,user_id)` | `points_business_key NOT NULL`、`created_at` | post/user 均 CASCADE；points key 锚定目标帖不可变内容键 + actor；同逻辑内容重复帖共用奖励 claim |
| `post_favorites` | `(post_id,user_id)` | `created_at` | post/user 均 CASCADE；唯一主键防止同时保留重复收藏 |
| `follows` | `(follower_id,following_id)` | 二者均 → `auth.users`，`created_at` | user CASCADE；当前没有 `follower_id <> following_id` check |
| `tags` | `(kind,value)` | `created_at` | 独立全局字典，无 FK；kind 注释约定 university/major/subject/tag，无 check |

### 3.5 学习计划

| 表 | 列 | 类型 | 空值/默认 | 关系或说明 |
|---|---|---|---|---|
| `study_goals` | `id` | `uuid` | PK，`gen_random_uuid()` | — |
|  | `user_id` | `uuid` | 非空，`auth.uid()` | → `auth.users.id CASCADE` |
|  | `title` | `text` | 非空 | — |
|  | `exam_date` | `date` | 可空 | — |
|  | `course_id` | `uuid` | 可空 | → `courses.id ON DELETE SET NULL` |
|  | `created_at` | `timestamptz` | 非空，`now()` | — |
| `study_tasks` | `id` | `uuid` | PK，`gen_random_uuid()` | — |
|  | `user_id` | `uuid` | 非空，`auth.uid()` | → `auth.users.id CASCADE` |
|  | `title` | `text` | 非空 | — |
|  | `due_date` | `date` | 非空，`current_date` | 索引 `(user_id,due_date)` |
|  | `done` | `boolean` | 非空，`false` | 任何 done 更新进入幂等状态机；首次完成激活 points/streak，取消会冲正 points |
|  | `done_at` | `timestamptz` | 可空 | 生产 0039 起由 trigger 随 `done` 设置/清空；兼容期客户端值会被覆盖 |
|  | `points_business_key` | `text` | 非空 | 0008 增加；插入时按 owner、规范化标题、日期和关联实体生成，之后不可变 |
|  | `course_id` | `uuid` | 可空 | → `courses.id SET NULL`；RLS 校验 owner |
|  | `material_id` | `uuid` | 可空 | → `materials.id SET NULL`；RLS 校验 owner |
|  | `goal_id` | `uuid` | 可空 | → `study_goals.id SET NULL`；RLS 校验 owner |
|  | `created_at` | `timestamptz` | 非空，`now()` | — |

生产 0039 为 goal/task 增加防御 trigger：`course_id/material_id/goal_id` 必须属于行 owner，`user_id` 不可修改，service-role 路径也受同一 owner 约束。现有 FK 的 `ON DELETE SET NULL` 语义不变。

### 3.6 Points 账本与事件状态

`point_entries` 是当前 points 的追加式分录，`point_event_states` 是只供数据库内部使用的业务事件状态机。迁移 0008 先把旧 `profiles.points` 写为一条 `legacy_opening`，再把已有帖子、评论关系、点赞和已完成任务登记为 `transition_no=0` 的 active 状态，不重复加分；0009 为每条 opening 追加 `legacy_opening_reset` reversal，并重建 Profile 投影。

| 表 | 列 | 类型/约束 | 说明 |
|---|---|---|---|
| `point_entries` | `id` | `bigint identity` PK | 分录 ID |
|  | `user_id` | `uuid NOT NULL` | → `auth.users.id CASCADE`；authenticated 仅能读取自己的分录 |
|  | `event_type` | `text NOT NULL` | `legacy_opening/legacy_opening_reset/post_created/repost_created/like_created/comment_created/task_completed` 等 |
|  | `business_key` | `text NOT NULL` | 永久业务键；与 `transition_no` 组成唯一约束 |
|  | `amount` | `integer NOT NULL, <> 0` | 激活为正、取消/删除冲正为负 |
|  | `rule_version` | `text NOT NULL` | 生产 0038 新事件为 `points-v1`；0039 首次决策为 `points-v2-daily-caps`，审核 transition 为 `points-v2-moderation`；opening 为 `legacy-import-v1` |
|  | `source_id` | `uuid` 可空 | 触发该 transition 的当前源记录，不做 FK，源删除后分录仍保留 |
|  | `transition_no` | `integer >= 0` | opening 为 0；同一业务键后续严格递增 |
|  | `reversal_of` | `bigint` 可空 | → 前一条 `point_entries.id ON DELETE NO ACTION`，形成 transition 链 |
|  | `metadata` | `jsonb NOT NULL` | 源对象与迁移/active 信息 |
|  | `created_at` | `timestamptz NOT NULL` | 默认 `now()` |
| `point_event_states` | `business_key` | `text` PK | 每个永久业务事件一行 |
|  | `user_id` | `uuid NOT NULL` | → `auth.users.id CASCADE` |
|  | `event_type`, `reward_amount` | 非空 | 键碰撞时类型/用户/奖励必须一致，否则事务失败 |
|  | `is_active`, `transition_no` | 非空 | 当前净状态及最新 transition |
|  | `source_id`, `last_entry_id` | 可空 | 当前源记录；最新分录引用为 `ON DELETE NO ACTION` |
|  | `source_active`, `moderation_suppressed`, `awarded_amount`, `decision_rule_version`, `suppressed_reason` | 生产 0039，非空/受 check | 分离内容存在、审核、首次实际奖励和当前有效账本状态 |
|  | `metadata`, `created_at`, `updated_at` | 非空 | 内部状态与审计时间 |

状态转换通过 `_set_point_event` 的共享 moderation gate、business-key advisory lock、profile 行锁、状态行锁和唯一键串行化；审核取得同一 gate 的独占锁并按 UUID 顺序先锁 Profile、再锁状态，避免锁顺序反转。生产 0039 把第一次奖励决策永久写入 claim：原创/转发/评论/点赞/任务的每日可奖励数量分别为 3/10/10/20/10，课程完成不设日上限。超额 claim 为 0 且删除、重建、换时区都不能补领；审核 suppress 只撤回实际已获金额，restore 不恢复已删除来源或 cap=0 的奖励。`grandfather-v1` 的实际金额由该 business key 的 transition 1 正向分录证明；0008/0009 只有状态占位、没有逐业务正向分录的历史键其 `awarded_amount=0,is_active=false`，因此无法产生无来源的负向冲正。旧占位若已留下负 transition，0039 追加 `grandfather-zero-reset-v1` 等额补偿并推进 transition 链，绝不删除或改写原分录。

#### 生产 0039：points 与 API 反滥用表

| 表 | 关键列 | 生命周期与权限 |
|---|---|---|
| `point_daily_windows` | `user_id,local_date,timezone,starts_at,ends_at` | 冻结当前奖励自然日和 IANA 时区；Auth 删除 CASCADE；service-role 只读，写入仅经 definer workflow |
| `point_daily_award_claims` | `business_key,user_id,event_type,rule_version,daily_window_id,daily_limit,nominal_amount,awarded_amount,suppressed_reason,source_id,target_owner_id,target_root_key,metadata,decided_at` | 每个稳定业务键一次不可变决策；grandfather 零金额不创建日窗口且不伪装成 `daily_cap`；Auth 删除 CASCADE；service-role 只读，不能直写 |
| `point_daily_cap_notifications` | `(user_id,event_type,window_id),notification_id` | 同用户/事件/窗口只生成一次持久通知；仅 service-role |
| `point_moderation_actions` | `id,admin_user_id,action,target_type,target_key,reason,case_reference,affected_event_count,affected_amount,metadata,created_at` | append-only 审核事实；管理员 UUID/理由保留，不因账号删除丢失；service-role 只读，新增仅经 moderation RPC |
| `point_abuse_signals` | `id,signal_type,fingerprint,account_ids,target_owner_id,target_root_key,window,metrics,status,reviewer*,timestamps` | 按信号/排序账户集合/小时、日或十分钟窗口去重，只待审不处罚；service-role 只读，review 经窄 RPC |
| `api_abuse_events` | `actor_hmac,user_id,route_group,rule,bucket_start,event_count,timestamps,metadata` | 不存原始 IP/email/正文；按桶聚合并保留 30 天；仅 service-role |

历史边界：0008 无法判断旧宽松权限期间的 `profiles.points/credits/vip/streak` 是否曾被人为篡改。opening 只保存迁移事实，不代表余额可信；0009 根据已记录的产品/安全决定追加 reversal 归零，不删除原记录。credits/VIP 仍没有可重建账本。

### 3.7 Courses 内容、学习、传播与成长

以下列清单覆盖 0011 的全部新增表。`uuid` 默认均为 `gen_random_uuid()`（复合键/identity 除外），时间列未特别注明时默认 `now()`。

| 表 | 全部列 | 关键约束与关系 |
|---|---|---|
| `learning_courses` | `id`, `user_id`, `title`, `category`, `has_units`, `locale`, `origin_publication_id`, `origin_share_id`, `origin_author_name`, `can_republish`, `points_claimed_at`, `created_at`, `updated_at` | owner → Auth CASCADE；标题 1–80；四类 category 但 v1 API 只接受英语词表；locale=`en-US`；`(id,user_id)` 唯一；克隆来源 → publication/share SET NULL，来源记录消失后仍保留作者署名 |
| `learning_course_units` | `id`, `course_id`, `user_id`, `name`, `position`, `is_system`, `created_at`, `updated_at` | course/Auth CASCADE；复合 FK `(course_id,user_id)` 防跨 owner；名 1–80；position≥0；`(course_id,position)` 延迟唯一 |
| `learning_course_words` | `id`, `course_id`, `unit_id`, `user_id`, `term`, `normalized_term`, `translations`, `ipa`, `position`, `content_version`, `created_at`, `updated_at` | `normalized_term` 为 `_points_normalize_text(term)` stored generated；term 1–120；1–10 translations；IPA≤120；复合 unit/course/owner FK；单元内 normalized term 与 position 延迟唯一 |
| `learning_sessions` | `id`, `user_id`, `course_id`, `unit_id`, `mode`, `scope`, `selected_skills`, `stage`, `active`, `state`, `revision`, `resume_key`, `spelling_options`, `started_at`, `last_activity_at`, `completed_at` | course CASCADE、unit 删除 SET NULL；mode=`initial/review/exam`；scope=`all/unlearned`；skill 为 pronunciation/translation/spelling 的 1–3 项；stage 为 recognition/pronunciation/translation/spelling/completed；0015 的 `revision bigint≥0` 在每个 immutable attempt 后单调递增；0017 的 `resume_key` 按学习意图生成；0019 的 `spelling_options` 固化计时/翻译前测；0027 的 exam 保存第一轮阈值/正确率/通过事实及拼写轮末字段；0029 增加 `examKind=pronunciation`、`roundAssessmentScores/retrySummaryScores`；0031 的自定义范围仍落在 session items，并在 state 保存 `selectionMode/selectedWordIds/practiceCompleted`，不增加客户端可写列 |
| `learning_session_items` | `session_id`, `word_id`, `position`, `recognition_seen`, `pronunciation_passed`, `translation_passed`, `spelling_passed`, `wrong_count` | `(session_id,word_id)` PK；会话/词删除 CASCADE；position 每会话延迟唯一；pass 字段是当前会话投影 |
| `learning_attempts` | `id`, `user_id`, `course_id`, `session_id`, `word_id`, `mode`, `skill`, `is_correct`, `answer`, `error_kind`, `provider_details`, `local_date`, `attempt_id`, `response_payload`, `word_id_snapshot`, `term_snapshot`, `created_at` | bigint identity；course/session/user CASCADE，word 删除 SET NULL；0031 trigger 为 exam attempt 保存当时 word/term，删词后详情仍可关联；skill 另含 recognition 和 speech_assessment；允许 `is_correct=null` 表达非判分事实；普通测试 attempt 以 `(user_id,session_id,attempt_id)` 唯一并保存首次完整响应供超时重放；旧 RPC/recognition/评分允许 `attempt_id=NULL`；不保存录音；service_role 也无直接 UPDATE/DELETE |
| `learning_exam_word_snapshots` | `session_id`, `word_id`, `position`, `term`, `ipa`, `translations`, `wrong_count`, `passed` | 0031 已生产启用；session CASCADE，但不引用可编辑/可删除的 word；创建 exam item 时固化词面，完成时固化最终结果；RLS 开启且客户端无表权限，只能经 owner-scoped 历史 API 获取脱敏结果 |
| `learning_word_progress` | `user_id`, `word_id`, `initial_recognition_seen`, `initial_pronunciation_passed`, `initial_translation_passed`, `initial_spelling_passed`, `pronunciation_review_dates`, `translation_review_dates`, `spelling_review_dates`, `wrong_count`, `review_count`, `spelling_exam_passed_at`, `pronunciation_exam_passed_at`, `learned_at`, `updated_at` | `(user_id,word_id)` PK；三组 date[] 去重由工作流保证但只表达练习。0033 起，通过并完成拼写/发音考试分别写对应时间戳，只有两个时间戳都非空才逐词投影 `learned_at`。生产 0035 的 before trigger 与双向 check 强制 `learned_at` 精确等于两个考试时间戳的较晚值，否则为空，直接赋值也不能绕过。0031 起 session items 可为 owner-validated 单元子集；内容编辑按 term/translations/IPA 语义清空相应考试事实与 `learned_at` |
| `learning_review_schedules` | `id`, `user_id`, `course_id`, `unit_id`, `source_session_id`, `due_date`, `skills`, `scope`, `status`, `completed_session_id`, `completed_at`, `created_at` | user/course/unit/source initial session CASCADE，completed review session SET NULL；只有本人该单元已完成 initial session 才能创建 3/7/15/30 偏移；status=`pending/completed/cancelled`；`(user_id,unit_id,due_date)` 唯一 |
| `learning_speech_usage` | `id`, `user_id`, `kind`, `cost_microusd`, `character_count`, `local_date`, `created_at` | bigint identity；user 删除 SET NULL 以保留预算事实；0037 起 kind=`tts/assessment/translation_stt`，已生产启用；成本必须 >0；TTS reservation 记录字符数并可使用 NULL user 表达全局共享生成；STT 只记估算成本和配额日期，没有音频、transcript 或参考文本 |
| `learning_audio_assets` | `cache_key`, `normalized_term`, `synthesis_text`, `locale`, `voice`, `output_format`, `synthesis_version`, `storage_path`, `status`, `priority`, `attempt_count`, `next_attempt_at`, `lease_token`, `lease_until`, `last_error_code`, `last_error_message`, `ready_at`, `created_at`, `updated_at` | 64 位 hex SHA-256 PK；storage path 唯一；status=`pending/processing/ready/failed`；租约、指数退避和优先级驱动持久 worker；RLS 开启且表权限从 public/anon/authenticated 全撤销，只有 service_role；不含用户录音、翻译或 owner ID |
| `learning_spelling_translation_assessments` | `assessment_id`, `user_id`, `session_id`, `word_id`, `expected_revision`, `answer_hash`, `status`, `correct`, `response_payload`, `provider`, `model`, token usage, `provider_attempts`, `quota_counted`, `quota_counted_at`, lease/error/timestamps | assessment UUID 为 PK/幂等键；answer 只存 SHA-256；`quota_counted=false/quota_counted_at=null` 表示未消耗 provider-backed 评判额度，service-only reservation 在真实请求前原子写入 true/当前时间；分钟和滚动 24 小时窗口按该时间计算；租约避免并发重复判题，RLS 开启且客户端无表权限 |
| `learning_course_shares` | `id`, `user_id`, `course_id`, `token_hash`, `active`, `author_name`, `created_at`, `revoked_at` | owner/course CASCADE；只存 token SHA-256；token hash 唯一，每课程最多一个 active 分享 |
| `learning_course_publications` | `id`, `author_id`, `source_course_id`, `title`, `description`, `author_name`, `category`, `locale`, `version`, `snapshot`, `content_fingerprint`, `status`, `rights_declared_at`, `clone_count`, `created_at`, `updated_at` | author CASCADE、source SET NULL；英语/en-US；status=`published/hidden/withdrawn`；同 author/source/version 唯一；trigger 禁止内容快照/署名/指纹/权利声明变更，只允许生命周期、clone_count、source 置空和 updated_at |
| `learning_course_reports` | `id`, `reporter_id`, `publication_id`, `share_id`, `category`, `details`, `status`, `created_at` | reporter CASCADE，目标 CASCADE；publication/share 必须且只能有一个；六类举报；details≤1000；status=`open/reviewing/resolved/dismissed` |
| `learning_course_moderation_actions` | `id`, `publication_id`, `actor_id`, `action`, `reason`, `created_at` | bigint identity；publication/actor 删除 SET NULL，审计行保留；action=`hide/restore/withdraw`；reason 1–1000 |
| `badge_definitions` | `code`, `family`, `tier`, `name`, `description`, `threshold`, `icon` | code PK；family+tier 唯一；tier 1–3；0011 固定种入 vocab_words/vocab_courses/vocab_review_days 共九级 |
| `user_badge_awards` | `user_id`, `badge_code`, `awarded_at`, `metadata` | 复合 PK；user CASCADE；badge definition DELETE RESTRICT；`ON CONFLICT DO NOTHING` 保证历史只发一次 |

内容保存约束由单个 `learning_upsert_course` 事务补充：课程 4–2,000 个不同规范化词/短语、最多 100 单元、每词翻译非空且去重。数据库可存四类 category 是为兼容未来，但当前 API/UI 明确拒绝非 `english_vocabulary`。

`learned_at` 的唯一双考试投影条件、不会写入的事件、编辑撤销矩阵和代码/测试位置统一由 [Courses 英语单词学习文档](../notes/11-learning-courses.md) 第 4 节维护；ERD 只记录最终结构语义，不能把 `initial_*_passed`、复习日期、单项考试或前端正确状态解释为已学习。

### 3.8 Materials AI、Notes、知识图谱与在线考试（生产 0041–0048）

| 表 | 关键列 | 约束、关系与事实边界 |
|---|---|---|
| `ai_plans` | `code,generation_daily_limit,grading_daily_limit,active,timestamps` | 当前只种子 `free=10/10`；产品计划定义，不是 credits |
| `ai_user_plans` | `user_id PK→auth.users CASCADE,plan_code,consent_version,consented_at,timestamps` | 现有/新用户都回填 Free；同意按用户和版本持久化 |
| `ai_daily_usage` | `user_id,local_date,kind,plan_code,limit_count,reserved_count,consumed_count,timezone` | PK `(user_id,local_date,kind)`；`reserved+consumed<=limit`；本地日/时区在 reservation 时冻结 |
| `generation_jobs` | owner/material/course/name/kind/status/stage/progress/settings/idempotency/fingerprint/consent/quota/lease/models/note/error/timestamps；含 retryable/resume_until/checkpoint_stage/resume_count/accepted_at | `(user_id,idempotency_key)` 唯一；每用户至多一个 active；来源删除 SET NULL 但名称保留；kind=`exam/knowledge_graph/knowledge_question`，短 HTTP 只确认 202 接收，checkpoint/reconciler 支持在期限内恢复同一 job |
| `generation_job_events` | `id,job_id,stage,progress,event_code,created_at` | job CASCADE；只保存阶段事实，不保存文件正文或 prompt |
| `generation_job_checkpoints` | `job_id PK,user_id,stage,checkpoint_version,payload,expires_at,timestamps` | job/Auth CASCADE；stage 只允许 parsed/audited/document_ready/artifact_ready/answer_ready；完全 service-only，终态或 TTL 清理 |
| `exam_grading_checkpoints` | `attempt_id PK,user_id,checkpoint_version,payload,expires_at,timestamps` | attempt/Auth CASCADE；只保存已验证评分结果用于 callback/容器故障恢复；完全 service-only，离开 grading 或 TTL 后清理 |
| `ai_material_parse_cache` | owner/material/source hash/parser/audit/vision versions/`canonical_document`/counts | material CASCADE；同文件+所有策略版本唯一；这是私有持久缓存，不是临时目录 |
| `notes` | owner/course/job/title/kind/material_name/timestamps | course/job 删除 SET NULL；用户删除 CASCADE；kind=`ai_exam|ai_knowledge_graph` |
| `note_materials` | note/material/name/source hash | note CASCADE、material SET NULL；来源删除后仍保留快照名/hash |
| `note_artifacts` | `note_id PK,schema_version,content,question_count,total_marks,node_count,edge_count,timestamps` | note CASCADE；schema=`generated-exam.v1|generated-knowledge-graph.v1`；kind-shape check 禁止把考试与图谱计数混写，owner 可见 |
| `exam_attempts` | owner/note/number/status/revision/deadline/scores/grading reservation+lease/timestamps | `(user,note,attempt_number)` 唯一；note/user CASCADE；绝对期限、无限重考、主观评分可延期 |
| `exam_attempt_answers` | `attempt_id,question_id,answer,awarded_marks,correct,feedback,updated_at` | PK `(attempt,question)`；attempt CASCADE；只由事务 RPC 写 |
| `exam_attempt_operations` | `attempt_id,operation_id,operation_kind,response_payload,created_at` | PK 保证保存/提交/评分相同 UUID 重放返回第一次响应 |
| `ai_provider_usage_events` | owner、不可变 job XOR attempt 审计 ID、purpose/provider/model/request ID/tokens/cost/duration/ZDR/status/error、`event_id` | 只存计量元数据；event UUID 唯一，断线重放不重复记账；job/attempt ID 故意不设内容生命周期 FK，使删除 Note/答卷不能抹掉成本或破坏预算；Auth owner 删除仍 CASCADE；不得保存 prompt、正文、答案或原始响应 |
| `knowledge_node_questions` | `id PK→generation_jobs,user_id,note_id,node_id,question,answer,timestamps` | job/note/Auth CASCADE；问题 1–2000 字；owner 只读，创建/回答只经服务端工作流；答案必须引用该节点允许的 source blocks |

Postgres 是额度、任务、Notes、答卷和成绩的唯一事实源；BullMQ 只持有 UUID，不形成第二套状态。客户端不能直接写任何上述表，也不能执行工作流 RPC。

## 4. 删除与生命周期规则

| 父实体删除 | 当前结果 |
|---|---|
| `auth.users` | 级联删除 profile、资料课程、私有学习课程/会话/尝试/progress/日程/分享、拼写翻译评判事实、本人出版物/举报、badge awards、points 分录/状态/日窗口/claim。speech usage/Courses moderation actor 改为 NULL；points moderation action 保留管理员 UUID，signal owner/reviewer FK 置 NULL 但账户 UUID 数组保留用于安全审计。Storage 文件是否删除不由 FK 保证。 |
| `courses` | 资料 CASCADE；目标/任务和 AI Notes 的 `course_id` SET NULL。0041 应用删除入口先取消 job/清 cache，并按选择将 Notes 移入 Unfiled 或级联删结果。 |
| `materials` | 任务与 generation job 的 `material_id` SET NULL，解析缓存 CASCADE，note source SET NULL；0041 应用先按 keep/delete 选择编排。Storage 对象不会由 FK 自动删除。 |
| `notes` | 来源快照、artifact、答卷、答案和 operation CASCADE；generation job 的 note FK SET NULL。 |
| `study_goals` | 任务的 `goal_id` SET NULL。 |
| `posts` | 评论/点赞/收藏 CASCADE；引用它的转发帖也 CASCADE；相关 active points 事件会按 trigger 冲正。媒体对象不会自动删除。 |
| `learning_courses` | 单元、词、会话、尝试、progress、复习日程和源课分享级联；publication 的 source SET NULL，克隆课的 `origin_share_id` 随被删分享 SET NULL。已发 points 分录没有 source FK，不删除；用户徽章也不因删课程回退。 |
| `learning_course_shares` | 来源克隆课的 `origin_share_id` SET NULL；针对该分享的举报 CASCADE。 |
| `learning_course_units/words/sessions` | 下游词、session items、attempts/progress 按 FK 级联；删除只能通过课程事务 API，客户端不能直接执行。 |
| `learning_course_publications` | 来源克隆课的 `origin_publication_id` SET NULL；举报 CASCADE；审核动作 publication_id SET NULL 保留。 |
| `learning_course_shares` | 关联举报 CASCADE；撤销通常只写 `active=false/revoked_at` 而不删除。 |

双用户 RLS E2E 在清理阶段验证 Auth 删除后的关系表级联；仓库仍没有生产级账号删除编排来先清理 Storage 对象、导出/冷却或生成删除凭证，因此完整隐私删除流程仍须单独实现。

## 5. RLS 矩阵

所有当前业务表都启用了 RLS。

| 表 | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | 本人 | 无客户端 policy（由 Auth trigger 建档） | 本人仅 `username/university/major/year/language/timezone`；受保护列由 grant + trigger 双重禁止 | 无客户端 policy |
| `courses` | owner | owner | owner | owner |
| `materials` | owner | owner + 关联课程 owner | owner + 关联课程 owner | owner |
| `notifications` | owner | owner | owner | owner |
| `feedback` | owner | owner，仅 `category/summary/body` | 无 | 无 |
| `posts` | 所有 authenticated | 作者 | 作者 | 作者 |
| `comments` | 所有 authenticated | 作者 | 无 policy | 作者 |
| `post_likes`, `post_favorites` | 仅自己的关系行 | 自己 | 自己 | 自己 |
| `follows` | follower 或 following 是自己 | follower 是自己 | 无 policy | follower 是自己 |
| `tags` | 所有 authenticated | 任意 authenticated | 无 policy | 无 policy |
| `study_goals` | owner | owner | owner | owner |
| `study_tasks` | owner | owner + 所有关联实体 owner | 同左 | owner |
| `point_entries` | 本人 | 无客户端权限/policy | 无客户端权限/policy | 无客户端权限/policy |
| `point_event_states` | 无客户端权限/policy | 无 | 无 | 无 |
| `point_daily_*`, `point_moderation_actions`, `point_abuse_signals`, `api_abuse_events` | 无客户端权限/policy | 无 | 无 | 无 |
| `learning_courses/units/words` | owner | 无 | 无 | 无 |
| `learning_sessions/items/attempts/progress/review_schedules` | owner（items 经 session） | 无 | 无 | 无 |
| `learning_exam_word_snapshots` | 无客户端读取 | 无 | 无 | 无 |
| `learning_spelling_translation_assessments` | 无客户端读取 | 无 | 无 | 无 |
| `learning_course_shares` | owner | 无 | 无 | 无 |
| `learning_course_publications` | 仅 author 自己 | 无 | 无 | 无 |
| `learning_course_reports` | 仅 reporter 自己 | 无 | 无 | 无 |
| `learning_speech_usage`, `learning_course_moderation_actions` | 无客户端读取 | 无 | 无 | 无 |
| `badge_definitions` | 所有 authenticated | 无 | 无 | 无 |
| `user_badge_awards` | 本人 | 无 | 无 | 无 |
| `ai_plans`, `ai_user_plans`, `ai_daily_usage` | active plan / 本人 | 无 | 无 | 无 |
| `generation_jobs`, `generation_job_events` | 本人（event 经 job） | 无 | 无 | 无 |
| `ai_material_parse_cache`, `ai_provider_usage_events`, `exam_attempt_operations` | 无客户端读取 | 无 | 无 | 无 |
| `notes`, `note_materials`, `note_artifacts`, `exam_attempts`, `exam_attempt_answers` | 本人（子表经 owner parent） | 无 | 无 | 无 |
| `generation_job_checkpoints` | 无客户端读取 | 无 | 无 | 无 |
| `exam_grading_checkpoints` | 无客户端读取 | 无 | 无 | 无 |
| `knowledge_node_questions` | 本人 | 无 | 无 | 无 |

迁移 0008 已修复 Profile 整行更新缺口。生产 0039 进一步拆分 Feedback policy、限制帖子列 grant 并增加 Schedule owner trigger；0040 对精确列权限、trigger 与内部表/RPC grant 失败关闭。第一阶段仍保留 `posts.updated_at` 和 `study_tasks.done_at` 的兼容 UPDATE grant，但值由 trigger 覆盖；观察至少 24 小时后的未来 0044–0045 才最终撤权。0041–0043 只新增 Materials AI。

## 6. Storage 模型

| Bucket | 可见性 | 当前对象策略 | 路径约定 | 关系边界 |
|---|---|---|---|---|
| `materials` | private | authenticated 仅可 SELECT/INSERT/DELETE 自己 UUID 首段路径 | `{auth.uid()}/...` | `materials.storage_path` 是文本引用；表和对象间无 FK/事务 |
| `community-media` | public | authenticated 仅可 INSERT/DELETE 自己 UUID 首段路径；公共读取由 public bucket 提供 | `{auth.uid()}/...` | `posts.image_url/audio_url` 是 URL 文本；删除帖子不会自动删对象 |
| `vocabulary-audio` | private | 没有客户端 Storage policy；仅 API service-role 读写 | `SHA-256(normalizedTerm␟locale␟voice␟format␟synthesisVersion).mp3` | 只允许可跨用户复用的 Azure 合成语音；不存用户录音，也不与 word 行做 FK |

Storage 策略没有对象 UPDATE policy。涉及替换文件时应使用新路径或显式设计安全策略。

## 7. 函数与触发器

| 函数/触发器 | 事件 | 当前作用 |
|---|---|---|
| `handle_new_user` / `on_auth_user_created` | `auth.users AFTER INSERT` | 创建 profile |
| `touch_updated_at` / `profiles_touch` | `profiles BEFORE UPDATE` | 更新时间戳 |
| `_post_author` / `posts_author` | post BEFORE INSERT | 从 profile 覆盖作者快照 |
| `_comment_author` / `comments_author` | comment BEFORE INSERT | 从 profile 覆盖作者名 |
| `_bump_counts` / `likes_cnt`,`favs_cnt`,`comments_cnt` | 互动 INSERT/DELETE | 维护帖子冗余计数 |
| `_bump_repost` / `repost_cnt` | post INSERT/DELETE | 维护原帖转发计数 |
| `_sync_profile_tags` / `profiles_tags` | profile INSERT/相关 UPDATE | 收集大学/专业全局标签 |
| `_sync_course_tags` / `courses_tags` | course INSERT | 收集 subject 标签 |
| `_add_points` | 已停用的旧 helper | 不再被业务触发器使用，PUBLIC/anon/authenticated/service_role EXECUTE 均已撤销 |
| `_notify` | 被其它函数调用 | 插入通知 |
| `_set_point_event` | 内部状态转换 | 以业务键写分录/状态、重算 points/等级；客户端无 EXECUTE，service_role 可通过受信 RPC 调用 |
| `_point_daily_bounds`, `_point_daily_window`, `_point_daily_limit` | 生产 0039 内部 helper | 计算并冻结奖励自然日/时区边界、避免换时区产生重叠窗口，并返回事件数量上限；客户端无 EXECUTE |
| `get_point_reward_receipt` | 生产 0039 owner RPC | 从 `auth.uid()` 查本人的 source/event 决策并返回金额/用量/上限/抑制原因；超限通知已与奖励 decision 在原业务事务中幂等创建 |
| `moderate_point_rewards` | 生产 0039 service-only RPC | 按 business key 或帖子根链 suppress/restore 实际奖励并追加审核事实 |
| `scan_point_abuse_signals`, `record_api_abuse_event`, `prune_api_abuse_events` | 生产 0039 service-only RPC | 生成待审协同信号、聚合 HMAC API 拒绝事件并清理 30 天旧桶 |
| `_guard_post_integrity`, `_guard_feedback_insert`, `_guard_study_goal_integrity`, `_guard_study_task_integrity` | 生产 0039 BEFORE triggers | 覆盖或拒绝可信字段、时间和跨 owner 引用；普通角色无 EXECUTE |
| `_post_points_key`、`_root_post_points_key`、`_task_points_key` 与 assign/preserve triggers | post/like/comment/task INSERT 与受保护 UPDATE | 生成并冻结内容锚定业务键；post 的 `repost_of` 与互动 identity 同时冻结 |
| `_guard_profile_managed_fields` | profile BEFORE UPDATE | 防止普通 JWT 角色修改经济、等级、VIP、streak 字段 |
| `_on_like` / `likes_award` | like AFTER INSERT/DELETE | 非自赞首次激活 +1；删除冲正；通知帖主 |
| `_on_comment` / `comments_award` | comment AFTER INSERT/DELETE | 非自评 actor/post 关系 +2；最后一条删除冲正；通知帖主 |
| `_on_fav` / `favs_notify` | favorite AFTER INSERT | 通知帖主 |
| `_on_post` / `posts_award` | post AFTER INSERT/DELETE | 原创 +10 / 转发 +3；最后一个同业务键删除时冲正，并按需通知 |
| `_on_follow` / `follows_notify` | follow AFTER INSERT | 通知被关注者 |
| `_on_task_done` / `task_points_update`,`task_points_delete` | task `done` AFTER UPDATE 或 DELETE | 首次完成 +5；取消/最后一个同键任务删除冲正；仅首次激活更新 streak |
| `_guard_profile_timezone` / `profiles_guard_timezone`、`profiles_guard_timezone_insert` | profile BEFORE INSERT / timezone BEFORE UPDATE | 只接受 PostgreSQL `pg_timezone_names` 中的 IANA 名称 |
| `_guard_learning_publication_snapshot` / `learning_publications_preserve_snapshot` | publication BEFORE UPDATE | 阻止已发布版本内容、署名、指纹和权利声明被改写 |
| `_learning_local_date`, `_learning_course_fingerprint`, `_learning_course_snapshot` | Courses helper | 固化尝试本地日期、词集合 SHA-256 与服务端内部课程快照；公开 API 另经 `publicSnapshot` 删除私有 ID/进度 |
| `_refresh_learning_growth` | 完成学习/复习 | 发放课程 +20 points 和九级徽章；持久业务键/award PK 防重复 |
| `learning_upsert_course`, `learning_rename_course`, `learning_delete_course` | API RPC | owner 校验下原子保存、精确能力重置、改名和级联删除 |
| `learning_start_session`, `learning_mark_recognition`, `learning_record_attempt` | API RPC | 创建/恢复队列、逐步持久化、测试候补池循环；0015 保留旧五参数答题签名并新增七参数 UUID/revision 重载；0017 按请求意图恢复；0021 统一 Unicode 规范化，0023 的七参数权威拼写路径改为调用 `_learning_spelling_text_matches` |
| `learning_get_session_snapshot`, `_learning_session_patch`, `_learning_increment_session_revision` | API/内部 RPC 与 trigger helper | 一次返回 session/items/words/progress；写事务返回小增量；`learning_attempts AFTER INSERT` 推进 revision，保证旧应用回滚写入也不会绕过版本时钟 |
| `learning_cancel_session` | API RPC | owner 校验并锁定 session，幂等设为 inactive、推进 revision；保留 attempts/progress 与复习日程，只允许 service role 执行 |
| `learning_start_exam_session`, `learning_continue_spelling_retry_round` | 兼容 API RPC | 0028 启动/恢复拼写单元考试并持久打乱首轮；旧拼写轮末签名保留供兼容，0034 生产应用使用通用考试 RPC |
| 六参数 `learning_start_exam_session(...,p_exam_kind)`、`learning_continue_exam_retry_round` | API RPC | 0029 向后兼容增加 `spelling/pronunciation` 考试类型；通用确认 RPC 保存错词集合、清除复盘状态并按轮次重排，均只授予 service role |
| `learning_start_selected_review_session`、`learning_start_selected_exam_session` | API RPC | 0031 校验 1–2,000 个唯一 word ID 的 owner/course/unit/scope，固化 session items，并以排序后集合哈希隔离恢复意图；只授予 service role |
| `learning_list_exam_history`、`learning_get_exam_history_detail` | API RPC | 0031 从私有不可变词/attempt 快照返回最近 100 场 owner 考试汇总和单场脱敏详情；不返回录音、密钥或完整 provider payload，只授予 service role |
| `learning_claim_spelling_translation_assessment_v2`, `learning_reserve_spelling_translation_quota` | API RPC | 先创建不计配额的幂等评判租约；仅真实 OpenRouter 调用前按用户 advisory lock 检查分钟/滚动 24 小时限制并预留配额 |
| `_learning_apply_passed_exam_progress` | exam session 完成 | 0031 对所有完成考试写 `practiceCompleted=true`；只有第一轮达到阈值时才把该 session 选中的词标为 learned，再由既有成长投影处理课程完成/奖励 |
| `_learning_normalize_spelling_options`, `_learning_normalize_spelling_text`, `_learning_spelling_without_punctuation`, `_learning_spelling_text_matches`, `learning_claim/complete/release_spelling_translation_assessment`, `learning_record_spelling_attempt` | API/内部 RPC | 固化限时/翻译前测选项；拼写先做 NFKC/空白/ASCII case fold，再以保留标点、移除标点、标点视为空格三路比较，仅放宽标点差异；按 UUID/revision/answer hash 领取供应商租约与配额、保存判定并原子形成权威 attempt |
| `learning_schedule_reviews`, `learning_cancel_review_schedule`, `learning_profile_summary` | API RPC | 以已完成 initial session 创建复习日程、取消及 Schedule/Profile 聚合事实 |
| `learning_record_speech_assessment`, `learning_reserve_speech_quota` | API RPC | 保存非音频评分事实；生产认词阶段按受控分数线更新候补项；0029 起还原子推进读音考试首轮计数、分数清单/候补轮和熟练投影；持久化用户频率和全局预算预留 |
| `learning_reserve_translation_stt` | API RPC；0037 已生产启用 | 在供应商调用前锁定并验证 owner active spelling session、`translationFirst`、revision 和当前 word，原子执行分钟/本地日/月预算 reservation；只返回 reservation/revision，不读写 transcript、answer、attempt、cursor 或 progress |
| `_learning_audio_cache_key`, `learning_prepare_unit_audio`, `learning_prepare_word_audio`, `learning_get_unit_audio_manifest` | 服务端音频 RPC | 计算全局内容哈希、owner 校验后按单元/单词幂等入队、返回不暴露 Storage 的用户级 manifest |
| `learning_claim_audio_asset`, `learning_finish_audio_asset`, `learning_requeue_audio_asset`, `learning_reserve_tts_quota` | 服务端 worker RPC | 数据库 advisory lock + 单活动租约保证全局单并发，最小 3.1 秒启动间隔、失败退避、Storage 丢失重建和每分钟/月字符/预算 reservation |
| `learning_create_share`, `learning_revoke_share`, `learning_clone_share` | API RPC | token hash 生命周期和撤销竞态内的事务克隆 |
| `learning_publish_course`, `learning_clone_course`, `learning_create_report`, `learning_moderate_publication` | API RPC | 不可变发布版本、免费独立克隆、限频举报与受审计隐藏/恢复 |
| `_ai_create_user_plan` | Auth user AFTER INSERT | 为新用户幂等建立 Free plan；普通角色无 EXECUTE |
| `ai_get_quota_summary`, `ai_create/claim/update/complete/fail/cancel_generation_job` | Materials AI service-only RPC | 原子 reservation、lease、stage/event、结果/缓存/usage、consume/release；崩溃租约三次后失败并退款 |
| `ai_mark_generation_job_accepted`, `ai_record_generation_usage`, `ai_checkpoint_generation_job`, `ai_checkpoint_exam_grading`, `ai_retry_generation_job`, `ai_expire_generation_checkpoints` | Materials AI service-only RPC | 202 接收后续租、按 UUID 增量记费用、保存验证过的生成/评分阶段快照、同一 job 期限内重新排队，以及过期 checkpoint/残留清理；过期/重试耗尽必须持久终态并释放 reservation，不能先写后 RAISE 回滚清理 |
| `ai_create_knowledge_question_job` | Knowledge Q&A service-only RPC | 校验 graph/note/node owner、原子预留 Free generation quota、建立幂等 job 与只读问答事实 |
| `ai_create_exam_attempt`, `ai_save_exam_answers`, `ai_submit_exam_attempt` | Exam service-only RPC | owner/deadline/revision/operation UUID 校验，服务端确定性客观判分与强制到期交卷 |
| `ai_request/claim/complete/fail_exam_grading` | Grading service-only RPC | 主观题每日 reservation、lease、幂等评分、成功消费/失败释放；三次崩溃恢复为 `submitted_ungraded` |
| `ai_delete_note`, `ai_delete_material`, `ai_delete_material_course` | 删除编排 service-only RPC | owner 校验、取消任务、清 cache，并按 keep/delete 保留到 Unfiled 或删 AI 结果 |

迁移 0008 已显式撤销内部 helper 的客户端执行权。生产 0039–0040 延续 default-deny，只把 owner receipt 授予 authenticated；`review_point_abuse_signal`、`moderate_point_rewards`、扫描和 API 审计 RPC 只授予 service-role，而 service-role 对相应内部事实表只有 SELECT，不能通过 PostgREST 绕过 workflow。它仍不包含内容质量自动判定、自动处罚、申诉 UI 或通用 RBAC。

0012 的全部 `learning_*` 工作流与敏感 helper 同样撤销 `public/anon/authenticated` EXECUTE，只授予 service_role；`learning_attempts` 对 service_role 也撤销直接 UPDATE/DELETE。0013–0036 持续检查 append-only、RLS、精确函数签名与 service-role grant；0023–0024 验证标点 matcher，0025–0026 验证取消，0027–0028 验证考试/轮次确认/配额预留 RPC，0029–0034 验证读音考试、自选词、历史、双考试约束、trigger 与客户端拒绝；0035–0036 验证精确 mastery 投影、review 无写入与客户端无 progress 变更权限。API 传入的用户 ID、revision、评判输入和配额来自已验证/受控上下文，不能接受浏览器直接执行 RPC。

## 8. 索引清单

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
- 生产 0039：`point_daily_windows(user_id,ends_at DESC)`、claim 的 window/event、target owner 与 root 索引；`point_moderation_actions(target_type,target_key,created_at DESC)`；`point_abuse_signals(status,detected_at DESC)`；`api_abuse_events(last_seen_at)`，以及各自主键/唯一 fingerprint 或时间桶约束。
- `learning_courses_user_updated_idx(user_id, updated_at DESC)`
- `learning_course_units_owner_idx(user_id, course_id, position)`
- `learning_course_words_course_idx(course_id, unit_id, position)`、`learning_course_words_owner_term_idx(user_id, normalized_term)`
- `learning_sessions_one_active_intent_idx UNIQUE(user_id,resume_key) WHERE active`、`learning_sessions_active_course_activity_idx(user_id,course_id,last_activity_at DESC) WHERE active`、`learning_sessions_owner_activity_idx(user_id,last_activity_at DESC)`
- `learning_attempts_owner_created_idx(user_id, created_at DESC)`、`learning_attempts_course_idx(course_id, created_at DESC)`、`learning_attempts_word_idx(word_id, created_at DESC)`
- `learning_attempts_idempotency_idx UNIQUE(user_id,session_id,attempt_id)`（NULL 仅用于兼容旧/非普通答题事实）
- `learning_speech_usage_user_rate_idx(user_id, kind, created_at DESC)`、`learning_speech_usage_budget_idx(created_at DESC)`、`learning_speech_usage_kind_rate_idx(kind,created_at DESC)`
- `learning_audio_assets_queue_idx(priority DESC,next_attempt_at,created_at) WHERE status IN ('pending','processing')`
- 0046：`generation_jobs_resume_expiry_idx(resume_until) WHERE retryable`、`generation_job_checkpoints(expires_at)`、`exam_grading_checkpoints(expires_at)`、`ai_provider_usage_events UNIQUE(event_id)`、`knowledge_node_questions(note_id,created_at DESC)`。
- `learning_spelling_translation_owner_created_idx(user_id,created_at DESC)`、`learning_spelling_translation_session_idx(session_id,word_id,expected_revision,completed_at DESC)`、`learning_spelling_translation_counted_quota_idx(user_id,quota_counted_at DESC) WHERE quota_counted`
- `learning_word_progress_learned_idx(user_id, learned_at) WHERE learned_at IS NOT NULL`
- `learning_review_schedules_owner_due_idx(user_id, due_date, status)`
- `learning_course_shares_one_active_idx(course_id) WHERE active`
- `learning_course_publications_market_idx(status, created_at DESC)`、`learning_course_publications_author_idx(author_id, created_at DESC)`、author/source/version 条件唯一索引
- `learning_course_reports_target_idx(publication_id, share_id, status, created_at DESC)`
- `generation_jobs_user_created_idx(user_id,created_at DESC)`、单用户 active 条件唯一、`generation_jobs_dispatch_idx(status,created_at)`；`generation_job_events_job_idx(job_id,id)`
- `notes_user_updated_idx(user_id,updated_at DESC)`、`notes_course_idx(course_id,updated_at DESC)`
- `exam_attempts_user_idx(user_id,created_at DESC)`、未完成 deadline 条件索引；`ai_provider_usage_month_idx(created_at,status)`
- 主键/唯一约束自动提供的索引：所有单列主键及 likes、favorites、follows、tags 的复合主键。

## 9. 目标模型（尚不存在）

最终产品至少还需要通过新迁移明确设计以下领域，不能根据蓝图假设已经存在：

- 结构化知识清单、独立 Quiz 及通用图谱版本；首版 `notes/generation_jobs/模拟试卷/知识图谱` 已在生产 0041–0048 实现；
- 通用笔记市场商品、credits 授权/购买关系、创作者分成；Courses 免费分享/市场快照已存在；
- credits 钱包账本、余额投影和经过审批的管理员调整；points 账本已存在，但仍需反滥用上限、对账与运营工具；
- VIP entitlement/订阅、订单、支付 intent、webhook 幂等记录、退款；
- 社区/笔记内容举报、审核队列、处置与申诉；Courses 已有举报与管理员动作，但没有通用队列/申诉；
- 用户同意、数据导出/删除任务、保留期限；
- 管理员角色、审计日志、系统配置。

目标实体落地时应同时补：FK 删除语义、唯一/检查约束、索引、RLS、服务角色权限、审计、迁移/回滚与自动化测试。
