# ERD 与数据库字典

> **本文内容：** 描述当前 Supabase/PostgreSQL 中全部应用表、字段、关系、删除行为、RLS、Storage 桶、触发器与数据库函数，并单列尚未实现的目标实体。  
> **作用：** 作为数据库结构评审、接口开发、迁移编写、安全审计和数据恢复时的共同事实来源。  
> **何时更新：** 每次新增或修改迁移、表/列/约束/索引/RLS/函数/触发器/Storage 策略时与代码同一个变更提交更新；目标模型转为真实迁移时也要更新状态。

## 1. 权威来源与范围

本页按 `supabase/migrations/20260620000001_profiles.sql` 至 `20260625000007_schedule.sql` 的最终叠加结果整理。迁移 SQL 是结构的最终权威来源；本文用于阅读和评审。

- **当前实现**：13 张 `public` 业务表、`auth.users` 外部身份表、2 个 Storage bucket，以及相关 RLS/函数/触发器。
- **未实现目标**：AI 笔记产物、生成任务、市场、钱包账本、订单/支付、订阅/VIP 权益、审核、审计等实体。它们可能出现在架构蓝图中，但当前数据库不存在。

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
        timestamptz created_at
    }
    POST_LIKES {
        uuid post_id PK_FK
        uuid user_id PK_FK
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
        timestamptz created_at
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
    COURSES ||--o{ MATERIALS : "contains"
    COURSES o|--o{ STUDY_GOALS : "optionally groups"
    COURSES o|--o{ STUDY_TASKS : "optionally groups"
    MATERIALS o|--o{ STUDY_TASKS : "optionally links"
    STUDY_GOALS o|--o{ STUDY_TASKS : "optionally contains"
    POSTS o|--o{ POSTS : "reposted by"
    POSTS ||--o{ COMMENTS : "has"
    POSTS ||--o{ POST_LIKES : "has"
    POSTS ||--o{ POST_FAVORITES : "has"
```

`auth.users` 由 Supabase Auth 管理；图中只展示应用实际引用的 `id` 和概念性 `email`，不是对 Auth 内部表的完整定义。

## 3. 表字典

### 3.1 `profiles`

与 `auth.users` 共享主键，注册后的 `handle_new_user` 触发器负责创建。`points`/等级用于活动成长，`credits` 是预留钱包数值；两者当前都直接存于此表，不存在账本。

| 列 | 类型 | 空值/默认 | 关系或说明 |
|---|---|---|---|
| `id` | `uuid` | PK，非空 | → `auth.users.id ON DELETE CASCADE` |
| `username` | `text` | 可空 | 默认建档时取邮箱 `@` 前部分 |
| `email` | `text` | 可空 | Auth 邮箱快照，不是认证权威字段 |
| `university`, `major`, `year` | `text` | 可空 | 用户资料 |
| `language` | `text` | 非空，`'zh'` | 当前无 check constraint |
| `credits` | `integer` | 非空，`0` | 尚无钱包账本/支付闭环 |
| `points` | `integer` | 非空，`0` | 迁移 0006 增加 |
| `level` | `integer` | 非空，`1` | `_add_points` 计算 |
| `level_name` | `text` | 非空，`'Novice'` | `_add_points` 计算 |
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
|  | `status` | `text` | 非空，`'open'` | 当前用户可通过 own policy 更新，尚无服务端状态机 |
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
| `like_count`, `comment_count`, `favorite_count`, `repost_count` | `int` | 非空，`0` | 触发器维护的冗余计数 |
| `created_at`, `updated_at` | `timestamptz` | 非空，`now()` | posts 没有自动 touch trigger，前端编辑时自行写 `updated_at` |

索引：`created_at DESC`、`user_id`、`subject`。

#### 互动与关系

| 表 | 主键 | 其它列/关系 | 删除行为 |
|---|---|---|---|
| `comments` | `id uuid` | `post_id → posts`、`user_id → auth.users`、`author_name` 快照、`body NOT NULL`、`created_at` | post/user 均 CASCADE；索引 `(post_id, created_at)` |
| `post_likes` | `(post_id,user_id)` | `created_at` | post/user 均 CASCADE；唯一主键防止同用户同时保留重复点赞 |
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
|  | `done` | `boolean` | 非空，`false` | false→true 触发积分/streak |
|  | `done_at` | `timestamptz` | 可空 | 当前数据库不强制与 `done` 一致 |
|  | `course_id` | `uuid` | 可空 | → `courses.id SET NULL`；RLS 校验 owner |
|  | `material_id` | `uuid` | 可空 | → `materials.id SET NULL`；RLS 校验 owner |
|  | `goal_id` | `uuid` | 可空 | → `study_goals.id SET NULL`；RLS 校验 owner |
|  | `created_at` | `timestamptz` | 非空，`now()` | — |

`study_goals` 的当前 RLS 只校验 goal 的 `user_id`，没有像 `study_tasks` 一样检查可选 `course_id` 的归属；这是应在后续安全迁移中收紧的边界。

## 4. 删除与生命周期规则

| 父实体删除 | 当前结果 |
|---|---|
| `auth.users` | 级联删除 profile、课程、资料、通知、反馈、帖子、评论、点赞、收藏、关注关系、目标、任务；Storage 文件是否删除不由这些 FK 保证。 |
| `courses` | 资料 CASCADE；目标/任务的 `course_id` SET NULL。 |
| `materials` | 任务的 `material_id` SET NULL；Storage 对象不会由表 FK 自动删除。 |
| `study_goals` | 任务的 `goal_id` SET NULL。 |
| `posts` | 评论/点赞/收藏 CASCADE；引用它的转发帖也 CASCADE。媒体对象不会自动删除。 |

删除账号尚无仓库内编排来清理 Storage 孤儿对象或验证级联完整性；隐私删除流程必须单独实现并测试。

## 5. RLS 矩阵

所有当前业务表都启用了 RLS。

| 表 | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | 本人 | 无客户端 policy（由 Auth trigger 建档） | 本人整行 | 无客户端 policy |
| `courses` | owner | owner | owner | owner |
| `materials` | owner | owner + 关联课程 owner | owner + 关联课程 owner | owner |
| `notifications` | owner | owner | owner | owner |
| `feedback` | owner | owner | owner | owner |
| `posts` | 所有 authenticated | 作者 | 作者 | 作者 |
| `comments` | 所有 authenticated | 作者 | 无 policy | 作者 |
| `post_likes`, `post_favorites` | 仅自己的关系行 | 自己 | 自己 | 自己 |
| `follows` | follower 或 following 是自己 | follower 是自己 | 无 policy | follower 是自己 |
| `tags` | 所有 authenticated | 任意 authenticated | 无 policy | 无 policy |
| `study_goals` | owner | owner | owner | owner |
| `study_tasks` | owner | owner + 所有关联实体 owner | 同左 | owner |

重要现状：`profiles_update_own` 允许本人更新整行，因此 `points`、`credits`、`level`、`level_name`、`vip_until`、`streak` 等服务端控制字段尚未被列级权限或安全 RPC 保护。`notifications`/`feedback` 的 `for all` policy 也允许 owner 改写本应由服务端管理的字段。安全加固应通过新迁移完成，不能只依赖前端隐藏控件。

## 6. Storage 模型

| Bucket | 可见性 | 当前对象策略 | 路径约定 | 关系边界 |
|---|---|---|---|---|
| `materials` | private | authenticated 仅可 SELECT/INSERT/DELETE 自己 UUID 首段路径 | `{auth.uid()}/...` | `materials.storage_path` 是文本引用；表和对象间无 FK/事务 |
| `community-media` | public | authenticated 仅可 INSERT/DELETE 自己 UUID 首段路径；公共读取由 public bucket 提供 | `{auth.uid()}/...` | `posts.image_url/audio_url` 是 URL 文本；删除帖子不会自动删对象 |

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
| `_add_points` | 被其它函数调用 | 调整 points，并按阈值写 level/name |
| `_notify` | 被其它函数调用 | 插入通知 |
| `_on_like` / `likes_award` | like AFTER INSERT | 点赞者 +1，通知帖主 |
| `_on_comment` / `comments_award` | comment AFTER INSERT | 评论者 +2，通知帖主 |
| `_on_fav` / `favs_notify` | favorite AFTER INSERT | 通知帖主 |
| `_on_post` / `posts_award` | post AFTER INSERT | 原创 +10 / 转发 +3，并按需通知 |
| `_on_follow` / `follows_notify` | follow AFTER INSERT | 通知被关注者 |
| `_on_task_done` / `task_done` | task `done` AFTER UPDATE | false→true +5，更新 streak，发送里程碑通知 |

这些辅助函数多为 `SECURITY DEFINER SET search_path=public`。迁移当前没有显式撤销 `_add_points`、`_notify` 等函数对默认角色的 EXECUTE；发布前应审计 PostgREST RPC 暴露面并在安全迁移中只授权必要调用方。

当前积分触发器没有事件账本或幂等键。删除后重新点赞/评论/发帖、任务 done→false→true 等操作可能重复获分；这也是统一 points/credits 规则落库前必须解决的模型问题。

## 8. 索引清单

- `materials_course_idx(course_id)`
- `notifications_user_idx(user_id, created_at DESC)`
- `feedback_user_idx(user_id, created_at DESC)`
- `posts_created_idx(created_at DESC)`
- `posts_user_idx(user_id)`
- `posts_subject_idx(subject)`
- `comments_post_idx(post_id, created_at)`
- `study_tasks_user_due_idx(user_id, due_date)`
- 主键/唯一约束自动提供的索引：所有单列主键及 likes、favorites、follows、tags 的复合主键。

## 9. 目标模型（尚不存在）

最终产品至少还需要通过新迁移明确设计以下领域，不能根据蓝图假设已经存在：

- `notes`、结构化知识点、题库、知识图谱、模拟考试与版本；
- `generation_jobs`、解析结果、AI 模型/提示词版本、失败与重试状态；
- 市场商品、授权/购买关系、创作者分成；
- 不可变 points 事件账本、credits 钱包账本、余额投影；
- VIP entitlement/订阅、订单、支付 intent、webhook 幂等记录、退款；
- 内容举报、审核队列、处置与申诉；
- 用户同意、数据导出/删除任务、保留期限；
- 管理员角色、审计日志、系统配置。

目标实体落地时应同时补：FK 删除语义、唯一/检查约束、索引、RLS、服务角色权限、审计、迁移/回滚与自动化测试。
