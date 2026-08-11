# Nalanda 当前实现架构

> **文档定位**
> - **内容**：记录仓库和生产配置中已经存在的系统结构、运行时数据流、模块边界、数据模型与部署方式。
> - **作用**：回答“系统现在实际上怎样工作”，用于开发、排障、评审和新人理解；不承载尚未实现的最终蓝图。
> - **何时更新**：入口、服务边界、表结构、RLS、部署拓扑、模块真/mock 状态或关键依赖发生变化时。
> - **未来规划**：最终产品范围、目标架构和开发路径统一见 [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md)。

最后核对：2026-08-11。生产数据库与兼容应用已受保护发布到 0040：帖子/Feedback/Schedule 完整性、points 日上限/审核/协同信号、Redis 限流和滥用审计均已启用。仓库的 0041–0043 Materials AI 候选尚待完整 CI、真实供应商及受保护发布；时间列撤权 contract 顺延为未来 0044–0045，必须等兼容应用从 `2026-08-10T09:35:34Z` 起在线观察至少 24 小时并通过 go/no-go。完整离线 PWA、支付与 credits/VIP 商业账本仍未实现。

---

## 1. 当前系统结论

Nalanda 是一个 pnpm/Turborepo 单仓：生产 Web 由 React 鉴权壳、legacy DOM 模块和 React Courses 功能组成；认证与旧业务 CRUD 直接使用 Supabase；NestJS 提供注册、JWT、健康检查以及 Courses/学习/语音/传播接口。0041–0043 候选把 Materials AI 接到 NestJS、BullMQ/Redis 和隔离 FastAPI，但在受保护发布前不属于生产运行时。

“真后端”在旧模块中主要表示“真实写入 Supabase 并由 RLS 保护”；Courses 的内容与学习事实写入必须经 NestJS + service-role 专用事务 RPC。当前两条路径均已部署，但这仍不把 Home/Notes/AI Create 等 mock 变成真实能力。

## 2. 运行时拓扑

```text
浏览器
  ├─ GET /                 → 宿主 nginx → apps/web 构建产物
  ├─ /api/auth/register    → nginx → NestJS → Supabase Admin API
  ├─ /api/me               → nginx → NestJS → Supabase JWKS 验签
  ├─ /api/learning-*       → nginx → NestJS → owner 校验 + 事务 RPC
  │                          └─ 可选翻译前测 → OpenRouter（服务端密钥、结构化判定）
  ├─ /api/pronunciation/*  → nginx → NestJS → Azure Speech（可降级/熔断）
  ├─ /api/course-*         → nginx → NestJS → 分享/市场脱敏快照
  ├─ /api/admin/points/*   → nginx → NestJS 管理员 allowlist → service-only RPC/表
  └─ Auth / PostgREST / Storage
                           → Supabase Cloud

NestJS → private Docker network → Redis（滑动窗口、审计聚合、扫描器分布式锁）

候选 Materials AI：NestJS → Postgres durable job → BullMQ/Redis（只存 UUID）→ 内网 FastAPI → OpenRouter ZDR；当前生产未部署。
```

Supabase Cloud 当前承担：

- Auth：邮箱密码会话与 JWT。
- PostgreSQL/PostgREST：资料课程、学习课程、会话/尝试/复习、社区、计划、Profile、成长、传播、通知和反馈。
- Storage：私有资料桶、公开社区媒体桶、跨用户内容哈希去重的**私有**合成语音缓存桶；不保存用户录音。
- RLS：主要的数据隔离边界。

生产 migration history 已于 2026-08-10 同步到 0040：0039 增加直接 PostgREST 写入的防御 trigger/列 grant、冻结奖励窗口与 claim、审核和协同/滥用审计表；0040 逐项断言 trigger、列权限、RLS 与 RPC grant。独立 plan、加密恢复 artifact `9057062920`、远端 history/lint/空 dry-run、真实 Redis/Azure/OpenRouter/Fish/Courses gates、API readiness 和公网 smoke 均有记录。0041–0043 是未发布的 additive Materials AI 候选；时间列撤权 contract 顺延为未来 0044–0045。

第一阶段应用把同机 Redis 纳入生产依赖：Redis 只连接默认 compose 私网、无宿主端口、密码认证、AOF `everysec`、`noeviction`；API 使用原子 Lua 滑动窗口和 HMAC(IP/email)键，不保存原始 IP/email。写入/注册/克隆/举报/成本接口在 Redis 故障时 fail-closed，私有只读 fail-open 并输出 `rate_limit_degraded`；readiness 只有 Supabase 与 Redis PING 均成功才为 200。协同扫描器每五分钟以 Redis token lock 单实例执行，只写待审 signal，不自动冻结或冲正。

当前前端没有 Realtime `.channel()` 订阅；通知是查询和手动刷新。

## 3. 仓库结构（实际存在）

```text
Nalanda/
├─ apps/
│  ├─ web/                 React/Vite 鉴权壳 + legacy 应用
│  ├─ api/                 NestJS Auth/health + Courses/语音/市场 API
│  └─ ai/                  隔离的 Materials 解析/生成/评分 worker（Python）
├─ packages/
│  ├─ ui/                  CSS，不是 React 组件库
│  └─ types/               Courses 共享 camelCase 契约 + 尚未接通的 AI 目标类型
├─ app/                    独立静态桌面/移动高保真原型
├─ supabase/
│  ├─ config.toml          本地/CI Supabase 基线
│  └─ migrations/          顺序 SQL migration
├─ infra/
│  ├─ deploy/              当前生产 nginx + API-only 部署
│  └─ hybrid-2g/           Caddy + API + AI + Redis 通用模板
├─ scripts/
│  ├─ db-push.mjs          旧 Management API 应急脚本
│  └─ *db-release*.sh      加密发布恢复点与隔离恢复工具
└─ docs/                   架构、蓝图、实现笔记和操作手册
```

仓库中不存在目标蓝图曾经列出的 `apps/desktop`、`apps/mobile`、`packages/api-client`、`packages/i18n`、`packages/config`。

## 4. Web 前端

### 4.1 三类入口

1. 仓库根 `index.html`：跳转到静态 Showcase，只用于浏览设计原型。
2. `app/`：独立桌面和手机原型，全部使用 mock 数据；Showcase 用 iframe 并排展示。
3. `apps/web`：生产应用。`index.html → main.tsx → App.tsx → NalandaApp.tsx → legacy/app.ts`。

部署使用 `apps/web/dist`，不是仓库根入口。

### 4.2 React 与 legacy 的边界

- React 负责 Supabase session 恢复、登录/注册界面、主题和挂载容器。
- `NalandaApp` 在 `useEffect` 中调用 `mountNalanda()`；依赖用户 ID/邮箱，切换账号会先清理旧挂载再创建新会话。
- legacy 应用仍使用模块单例、HTML 字符串、容器级事件委托和内存路由，但挂载时会重置路由/用户/模块状态，并以 session version 丢弃旧账号迟到的异步响应。
- 没有 react-router；URL、浏览器历史、刷新恢复和深链接尚未实现。
- `packages/ui` 只导出 CSS；Web 导入 `nalanda.css`，没有共享 React 组件。
- 9 个 legacy TypeScript 文件使用 `@ts-nocheck`，因此普通 `tsc` 不覆盖其内部类型。

### 4.3 当前模块状态

| 模块 | 数据来源 | 状态 |
|---|---|---|
| 登录/注册/退出 | Supabase Auth + Nest 注册接口 | 真实 |
| Materials | Supabase tables + 私有 Storage | 真实 |
| Community/Post | Supabase tables + 公开媒体 Storage | 真实 |
| Schedule | Supabase tables + DB 触发器 | 真实 |
| Courses | NestJS + Supabase `learning_*` + React | 真实；生产 history 为 0040，Courses 功能迁移为 0011–0038，含显式取消、拼写/读音考试、任意选词、历史、双考试精确掌握投影、翻译中文 STT 及真实 provider 配额预留 |
| Profile/Growth | Supabase Profile + `point_entries` projection | 真实；0008 已保护敏感列并实现幂等冲正账本 |
| Notifications | Supabase table，查询刷新 | 真实，非 Realtime |
| Feedback | Supabase table | 生产 0039 起用户只可新增/读取，status/time/owner 由支持流程维护 |
| Home | `legacy/data.ts` | mock |
| Notes/详情四 Tab | `legacy/data.ts` | mock |
| Create | mock Materials + timeout/toast | mock |
| Market / Note Market | `legacy/data.ts` + toast | Note Market 仍为 mock |
| Market / Course Market | NestJS 脱敏不可变快照 | 真实；只支持免费克隆，生产已启用 |
| Courses 文件 AI 导入、其余类别 | 禁用入口 | 未实现 |

旧的 Materials/Community/Profile/Schedule/Feedback mock 视图仍保留在 `legacy/app.ts`，运行时被文件末尾的真实挂载点覆盖，属于待清理的双实现。

### 4.4 Supabase 访问方式

`apps/web/src/lib/supabase.ts` 用构建期 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 创建客户端。真实模块直接调用：

- `sb.from(...)` 访问 PostgREST。
- `sb.storage.from(...)` 上传、删除或签名访问文件。
- 用户隔离依赖数据库 RLS，而不是前端 `.eq(user_id)`。

`authedFetch()` 给 NestJS 请求加 Bearer token，并由 Courses Web API 客户端使用；Supabase `{ error }` 会转换为统一可见错误，跨账号挂载会清空 Courses 单例状态。

## 5. NestJS API

全局前缀：`/api`。基础接口为：

| 方法 | 路径 | 认证 | 行为 |
|---|---|---|---|
| GET | `/api/health` | 无 | 探测 Supabase JWKS/PostgREST、校验 HMAC secret 并真实 Redis PING；两项依赖都正常才 200，否则 503 |
| POST | `/api/auth/register` | 无 | 用 service-role 创建 `email_confirm:true` 用户 |
| GET | `/api/me` | Bearer | JWKS/HS256 守卫验签后回显 claims |

JWT 守卫优先使用 Supabase JWKS 并验证 issuer/audience；HS256 回退验证配置的签名与声明边界。Courses 控制器另提供课程 CRUD、会话恢复/答题、复习日程、Profile 聚合、语音、分享、市场、克隆、举报、受配置管理员约束的审核接口和服务端 OpenRouter 语义翻译前测。完整表见 [API 文档](guides/API.md)。

新接口共用 `@nalanda/types` camelCase 契约，API 显式转换数据库 snake_case，并由全局异常过滤器统一返回 `{ code, message, fieldErrors? }`。语音有 per-user/全局预算限流；市场有发布/举报限流；翻译前测有数据库租约、UUID/answer-hash 幂等与用户配额。0037 在同一 OpenRouter server adapter 边界增加 Fish Audio 中文 STT：浏览器只上传当前题的短 WAV，数据库先验证 owner/session/revision/word 并预留独立配额，供应商结果只回填可编辑输入，不推进学习。OpenRouter key/model 只存在于 API 环境，浏览器不能提交参考答案或 provider 参数；用户答案、录音和 STT transcript 只在请求内存中处理，持久层只保留必要的 hash/判定/计量事实。当前仍没有通用队列、支付模块或自动 OpenAPI 生成。

## 6. FastAPI AI 服务

0041–0043 候选已替换原固定桩：FastAPI 只接受 `X-AI-Internal-Token` 的内网请求，并在 0700 独立临时目录中执行确定性解析、两次安全审查、失败范围视觉恢复、严格结构化试卷生成和批量主观题评分。固定模型为 DeepSeek V4 Flash 0731 与 MiMo V2.5；provider 请求强制 ZDR、拒绝数据收集、参数支持和关闭 fallback/tool/Web。所有任务路径在 `finally` 清理，启动/定时清理一小时以上孤儿目录，磁盘水位与每任务 1GB 上限均失败关闭。

完整生成链路是：

```text
用户 Materials 文件
  → NestJS owner/格式/额度/同意校验
  → Postgres 原子 reservation + generation_job
  → BullMQ 仅调度 job UUID；reconciler 补投
  → FastAPI DocumentIR 确定性解析
  → DeepSeek 文本完整性/注入审查
  → 只把诊断与审查失败范围交给 MiMo
  → 拼接完整 DocumentIR 并再次安全审查
  → DeepSeek 按版本化 prompt 生成 GeneratedExamV1
  → schema/题数/总分/答案/来源验证（最多一次修复）
  → 单事务保存 Notes 并 consume；失败/cancel 则 release
```

Postgres 是任务、额度、结果和考试事实源；Redis/BullMQ 只负责投递。worker 崩溃或 Redis 丢项不会丢任务，租约超过三次才稳定失败并返还额度。用户浏览器不能选择模型、提供 key、调用内部回调或决定成绩。

候选 worker 路由只有 `GET /health`、`POST /internal/materials/exam` 和 `POST /internal/exams/grade`。后两者需要常量时间比较的内部 token；FastAPI 默认 422 处理器不会回显包含 Storage signed URL 或 callback token 的请求正文。旧 `/parse` 与四个固定生成桩已删除。

### 6.1 契约边界

公开 Web/Nest 契约统一来自 `@nalanda/types` 的 camelCase `GeneratedExamV1`；Nest 显式转换数据库 snake_case，Python Pydantic 使用同一 camelCase JSON 与 `extra="forbid"`。考试 session 会删除答案、解析、rubric 和 accepted answer，只给作答所需字段；生成者自己的 Notes detail 仍可查看完整答案，这是自学产品而不是防作弊考试系统。

Knowledge list、Quiz 和 Knowledge graph 的历史 Demo 形状没有冒充真实契约；对应入口为 Coming soon。当前候选不含 embeddings、pgvector、编辑、导出、credits 或支付。

## 7. 数据库与 Storage

### 7.1 当前表

| 数据域 | 表 |
|---|---|
| 用户 | `profiles` |
| 课程资料 | `courses`, `materials` |
| 通知反馈 | `notifications`, `feedback` |
| 社区 | `posts`, `comments`, `post_likes`, `post_favorites`, `follows`, `tags` |
| 计划 | `study_goals`, `study_tasks` |
| 成长积分/反滥用（0039 生产） | `point_entries`, `point_event_states`, `point_daily_windows`, `point_daily_award_claims`, `point_moderation_actions`, `point_abuse_signals` |
| 学习内容 | `learning_courses`, `learning_course_units`, `learning_course_words` |
| 学习事实 | `learning_sessions`, `learning_session_items`, `learning_attempts`, `learning_word_progress`, `learning_spelling_translation_assessments` |
| 复习 | `learning_review_schedules` |
| 分享市场 | `learning_course_shares`, `learning_course_publications`, `learning_course_reports`, `learning_course_moderation_actions` |
| 课程徽章/语音配额 | `badge_definitions`, `user_badge_awards`, `learning_speech_usage` |
| Materials AI 计划/额度 | `ai_plans`, `ai_user_plans`, `ai_daily_usage` |
| Materials AI 任务/缓存 | `generation_jobs`, `generation_job_events`, `ai_material_parse_cache`, `ai_provider_usage_events` |
| 私有 Notes/来源 | `notes`, `note_materials`, `note_artifacts` |
| 在线考试 | `exam_attempts`, `exam_attempt_answers`, `exam_attempt_operations` |

完整关系、字段和策略见 [ERD](guides/ERD.md)。

### 7.2 RLS 概览

- `profiles/courses/materials/notifications/study_*` 采用 owner-only 行策略；Profile 另以列级 UPDATE grant 和触发器保护服务端字段。0039 已把 Feedback 拆为 owner SELECT/INSERT，用户无 UPDATE/DELETE。
- `posts/comments` 对认证用户公共读，作者写删；0039 已把帖子 INSERT/UPDATE 收敛为内容列白名单，并由 trigger 维护 owner、作者快照、计数、业务键和时间。
- likes/favorites 只允许用户读写自己的记录。
- follows 允许关注双方读取，关注者创建/删除。
- tags 对认证用户公共读，当前也允许任意插入。
- 私有 `materials` bucket 按对象路径第一段 `user_id` 隔离。
- `community-media` 是公开桶，写删按用户文件夹限制。
- `point_entries` 只允许用户读取自己的条目；客户端不能直接写，`point_event_states` 及 0039 新增的 claim/moderation/signal/audit 表对客户端完全隐藏。service-role 只经受控函数形成奖励和审核转换。
- `learning_*` 私有表只允许 owner 读，客户端不能写内容、会话、尝试、progress、日程、徽章或奖励；评判事实表甚至不授予 owner SELECT。写入经 API 调用撤销了 `public/anon/authenticated` 权限的 service-role RPC。
- 分享/出版物/举报/审核表不向匿名 PostgREST 开放。匿名分享和市场读取只能经过 API 返回转义、脱敏快照；出版快照由 trigger 保持不可变。
- 0041–0043 AI 私有表允许 authenticated 用户 SELECT 自己的 plan/额度/job/events/Notes/答卷；解析缓存、provider usage 与 operation 幂等表无客户端访问。所有 reservation、任务推进、结果、成绩和删除编排仅允许 service-role RPC，且迁移 0043 失败关闭验证 grant/RLS/FK。

### 7.3 已关闭项与剩余数据完整性边界

- 0008 已关闭 Profile 敏感列写入、内部 RPC 客户端 EXECUTE，以及赞/评论/原创/转发/任务删除重做累计获分问题。
- points 使用 append-only entries、持久 event state、稳定业务键和冲正；Profile 的 points/level 只是账本投影。迁移前缓存先作为 `legacy_opening` 留痕，再由 0009 追加 reversal 归零，无法追溯为逐笔可信历史。
- Courses 的尝试 append-only、progress 是保护投影；复习只有在会话完成时才写入不同本地日期并累计复习次数。+20 课程奖励使用用户与规范化不同词集合的 SHA-256 业务键，删除/重建/克隆不能重复领取。
- 0039 已用内容列白名单与防御 trigger 补齐帖子 owner/快照/计数/时间边界；兼容期只保留会被服务器覆盖的 `updated_at` grant。
- 0039 已验证 `study_goals.course_id` 以及 task 的 course/material/goal 均属于记录 owner；它不强制 material 必须与 task.course_id 是同一课程，这仍是产品级一致性改进项。
- 0039 已移除 Feedback UPDATE/DELETE，状态只由 service-role 支持流程维护。
- Storage 文件和 metadata 删除不是事务；社区媒体存在孤儿文件。
- 生产 0039 已实现 points 冻结 decision、每日计分上限、人工 root-chain suppress/restore 和只待审协同信号。内容质量检测、自动处罚、审核 UI/申诉仍未实现；credits/VIP 虽已锁写，但没有商业事实账本。

剩余授权/完整性项仍属于阶段 A；商业账本、反滥用和 Storage 治理必须在相应功能开放前完成。

## 8. 当前部署

### 8.1 生产方案

GitHub Actions 在 runner 上：

1. 运行 docs check、workspace typecheck、Vitest/jsdom/API 测试和 build。
2. 自动暂存所有 0008 及之后迁移，先验证 0007 历史数据升级、opening reversal 与最新发布断言，再从空库重建本地 Supabase、lint，并执行真实 RLS/Storage/points/Courses E2E。
3. 启动 Web/API 与 Azure/OpenRouter fake，以固定 WAV 执行 Playwright 登录→多单元创建→纠错/排序→四阶段（含限时拼写、翻译前测、语音回填和三处实时波形）→刷新续学→复习安排→发布/另一用户克隆。
4. 新增 migration 时经受保护 environment 完成 dry-run、加密恢复点、CLI push 和验证；失败阻断应用。
5. 构建 Web 与 Git SHA API image，经预先核验 host key 的 SSH/SCP 上传。
6. 生产主机以仅存服务器 mode-600 `.env` 的 Azure/OpenRouter keys，在新 image 中执行真实 MP3/PCM TTS、pronunciation assessment、OpenRouter structured semantic/API idempotency，以及“Azure 中文 WAV → Nalanda STT API → Fish Audio 中文 transcript” gate；失败不激活 release。
7. API 本地 health 通过后原子切换 Web release，再验证公网 Web/API。
8. 应用验证失败自动恢复上一 Web/API 不可变 release；数据库保持向后兼容的 forward migration。

服务器上宿主 nginx 托管 `/opt/nalanda/web`，把 `/api/` 反代到仅绑定 `127.0.0.1:8411` 的 API 容器。当前生产 compose 同时运行仅私网开放的 Redis；FastAPI AI 仍未部署。
Courses 的合法整课 JSON 最坏情况超过 nginx 默认 1 MB：仓库参考 server block 与 Nest body parser 都设为 10 MB；评分 multipart 仍为 2 MB。CI 不自动改 certbot 管理的现网站点，所以首次启用前必须按发布手册同步并 reload nginx。

### 8.2 通用 2G 模板

`infra/hybrid-2g` 可启动 Caddy、API、AI、Redis；它仍是未来 AI/BullMQ 模板。第一阶段实际 Redis 配置位于 `infra/deploy`，不采用该模板的 Caddy/AI 拓扑。

### 8.3 发布局限

- 第一阶段 API health 会真实验证 Supabase JWKS/PostgREST 与 Redis PING/HMAC 配置，但仍不覆盖 Storage、注册写入、完整 RLS 或浏览器登录路径；AI 仍只报告变量状态。
- Azure Speech 与 OpenRouter 的回归/Playwright 自动化使用 fake provider；生产激活前另以服务器密钥执行真实 provider gate。0037–0038 已于 2026-08-04 通过 Azure 合成中文 WAV→待激活 Nalanda API→真实 Fish Audio 的 gate 后发布；`transcriptionMatched=true` 证明固定样本与当时 endpoint/key/额度可用。该单次合成样本仍不代表真实口音、物理麦克风、持续可用率、准确率或费用对账。
- 数据库 release archive 仍不含 Storage 文件字节，且 CI 不自动逆向生产数据。
- 不可变 image/release 目前仍主要保留在单台服务器，缺少异地 registry 和自动容量策略。
- SSH 部署用户在当前文档中为 root。
- 仓库 nginx 文件不含 certbot 实际生成的完整 TLS 状态。

操作流程见 [数据库发布与回滚](operations/DATABASE_RELEASE_ROLLBACK.md)、[备份恢复](operations/BACKUP_RECOVERY.md) 和 [监控告警](operations/OBSERVABILITY_ALERTING.md)。

## 9. 构建、测试与质量边界

- Node 20、pnpm 9.12.3、Turborepo。
- Web 使用 Vite；`vite build` 不等同于 TypeScript 类型检查。
- Python AI 不属于 pnpm workspace，需要独立安装和启动。
- 可执行测试命令和环境要求见 [测试指南](guides/TESTING.md)。
- 默认 `pnpm test` 运行 Web jsdom、API/Courses 单元测试和发布工具测试；本机未设置显式开关时真实 RLS 套件安全跳过。PR/main workflow 启动一次性本地 Supabase，运行 0007→最新迁移升级夹具、空库重建、四组双用户 RLS/Storage/points/Courses E2E 和 Playwright Courses 流程；手工托管运行仍需隔离项目和 Ref 二次确认。
- 历史实现笔记中的“已验证”必须能映射到仓库测试；不能复现的旧验证只能作为历史记录。

## 10. 当前优先风险

1. 持续观察已上线 0039–0040 的 Redis 错误、误限流、points projection 和旧时间列依赖；最早于 `2026-08-11T09:35:34Z` 通过 go/no-go 后再追加未来 0044–0045 撤销兼容权限。0041–0043 Materials AI 不执行该撤权。
2. 在第一阶段生产观察中核对 points cap/审核/协同信号的误报、投影差异和 Redis 降级；再补完整审核 UI/申诉与内容质量检测。credits/VIP 另建商业账本。
3. 实现 Courses 文件 AI 导入前先统一模型契约、人工确认、评测集、成本和隐私留存；当前禁用入口不能算能力。
4. 为已上线 Courses/Azure/市场建立持续指标、成本对账和审核工作台；执行数据库/Storage/TTS 缓存恢复与告警演练。
5. 逐步移除 `@ts-nocheck`/legacy 双实现并增加 URL 深链接，补全旧模块 API HTTP/浏览器 E2E。

处理顺序和验收门见 [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md)。
