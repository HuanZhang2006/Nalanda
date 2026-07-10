# Nalanda 当前实现架构

> **文档定位**
> - **内容**：记录仓库和生产配置中已经存在的系统结构、运行时数据流、模块边界、数据模型与部署方式。
> - **作用**：回答“系统现在实际上怎样工作”，用于开发、排障、评审和新人理解；不承载尚未实现的最终蓝图。
> - **何时更新**：入口、服务边界、表结构、RLS、部署拓扑、模块真/mock 状态或关键依赖发生变化时。
> - **未来规划**：最终产品范围、目标架构和开发路径统一见 [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md)。

最后核对：2026-07-10。

---

## 1. 当前系统结论

Nalanda 当前是一个 pnpm/Turborepo 单仓：生产 Web 由 React 鉴权壳和移植的 legacy DOM 应用组成；认证与大部分真实业务 CRUD 直接使用 Supabase；NestJS 只提供注册、JWT 身份验证样例和健康检查；FastAPI AI 服务是未接入的桩。

“真后端”在当前项目中主要表示“真实写入 Supabase 并由 RLS 保护”，不表示所有业务都已经经过 NestJS API。

## 2. 运行时拓扑

```text
浏览器
  ├─ GET /                 → 宿主 nginx → apps/web 构建产物
  ├─ /api/auth/register    → nginx → NestJS → Supabase Admin API
  ├─ /api/me               → nginx → NestJS → Supabase JWKS 验签
  └─ Auth / PostgREST / Storage
                           → Supabase Cloud

FastAPI AI：有独立代码和通用 Docker 模板，但当前生产未部署，NestJS 也未调用。
```

Supabase Cloud 当前承担：

- Auth：邮箱密码会话与 JWT。
- PostgreSQL/PostgREST：课程、资料、社区、计划、Profile、通知和反馈。
- Storage：私有资料桶、公开社区媒体桶。
- RLS：主要的数据隔离边界。

当前前端没有 Realtime `.channel()` 订阅；通知是查询和手动刷新。

## 3. 仓库结构（实际存在）

```text
Nalanda/
├─ apps/
│  ├─ web/                 React/Vite 鉴权壳 + legacy 应用
│  ├─ api/                 NestJS 薄 API
│  └─ ai/                  FastAPI 桩；不在 pnpm workspace 任务中
├─ packages/
│  ├─ ui/                  CSS，不是 React 组件库
│  └─ types/               AI 目标类型；当前未被 Web/API 消费
├─ app/                    独立静态桌面/移动高保真原型
├─ supabase/migrations/    0001–0007
├─ infra/
│  ├─ deploy/              当前生产 nginx + API-only 部署
│  └─ hybrid-2g/           Caddy + API + AI + Redis 通用模板
├─ scripts/db-push.mjs     Management API 迁移脚本
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
- `NalandaApp` 在 `useEffect` 中调用 `mountNalanda()`。
- legacy 应用使用模块单例状态、HTML 字符串、容器级事件委托和内存路由。
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
| Profile/Growth | Supabase Profile + count 查询 | 真实，但敏感列权限待修 |
| Notifications | Supabase table，查询刷新 | 真实，非 Realtime |
| Feedback | Supabase table | 真实，状态权限待修 |
| Home | `legacy/data.ts` | mock |
| Notes/详情四 Tab | `legacy/data.ts` | mock |
| Create | mock Materials + timeout/toast | mock |
| Note Market | `legacy/data.ts` + toast | mock |

旧的 Materials/Community/Profile/Schedule/Feedback mock 视图仍保留在 `legacy/app.ts`，运行时被文件末尾的真实挂载点覆盖，属于待清理的双实现。

### 4.4 Supabase 访问方式

`apps/web/src/lib/supabase.ts` 用构建期 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 创建客户端。真实模块直接调用：

- `sb.from(...)` 访问 PostgREST。
- `sb.storage.from(...)` 上传、删除或签名访问文件。
- 用户隔离依赖数据库 RLS，而不是前端 `.eq(user_id)`。

`authedFetch()` 已能给 NestJS 请求加 Bearer token，但当前业务模块没有使用它。

## 5. NestJS API

全局前缀：`/api`。当前只有三个 Controller：

| 方法 | 路径 | 认证 | 行为 |
|---|---|---|---|
| GET | `/api/health` | 无 | 返回服务时间和环境变量是否存在；不验证依赖连通性 |
| POST | `/api/auth/register` | 无 | 用 service-role 创建 `email_confirm:true` 用户 |
| GET | `/api/me` | Bearer | JWKS/HS256 守卫验签后回显 claims |

JWT 守卫优先使用 Supabase JWKS 并验证 issuer/audience；HS256 回退目前只限制算法、没有同步验证 issuer/audience。

当前 API 没有业务 Service、DTO/ValidationPipe、限流、队列、AI 客户端、支付、管理模块或 OpenAPI 生成。

## 6. FastAPI AI 服务

当前路由：

| 路径 | 当前行为 |
|---|---|
| `GET /health` | 报告服务和 Anthropic key 是否配置 |
| `POST /parse` | 返回空文本与空 blocks |
| `POST /generate/knowledge-list` | 返回固定示例概念 |
| `POST /generate/quiz` | 返回固定占位题 |
| `POST /generate/graph` | 返回固定 Root → A |
| `POST /generate/exam` | 返回固定试卷 |

解析依赖和 Anthropic SDK 已列入 requirements，但尚未在实现中使用。没有 `/embed`、推荐接口、pgvector、队列、结果落库、重试、成本控制或内部认证。

### 6.1 当前契约不一致

文档早期所称“三方一致”不成立：

- Knowledge：前端 mock 为 `t/d/tags`，目标类型为 `title/definition/tags/order`。
- Quiz：mock 为 `q/opts/ans/why`，目标类型为 `question/options/answerIndex/explanation`。
- Graph：当前渲染要求 `x/y/cls`，Python/TS 只有 `level`。
- Exam：mock 为 `qs: string[]`，目标类型为 `questions: {prompt, marks}[]`。
- TS 请求是 `materialId`，Python 请求是 `material_id`。

`@nalanda/types` 当前没有被 Web 或 API 导入。接 AI 前必须选定规范、增加适配层并做契约测试。

## 7. 数据库与 Storage

### 7.1 当前表

| 数据域 | 表 |
|---|---|
| 用户 | `profiles` |
| 课程资料 | `courses`, `materials` |
| 通知反馈 | `notifications`, `feedback` |
| 社区 | `posts`, `comments`, `post_likes`, `post_favorites`, `follows`, `tags` |
| 计划 | `study_goals`, `study_tasks` |

完整关系、字段和策略见 [ERD](guides/ERD.md)。

### 7.2 RLS 概览

- `profiles/courses/materials/notifications/feedback/study_*` 采用 owner-only 行策略。
- `posts/comments` 对认证用户公共读，作者写删。
- likes/favorites 只允许用户读写自己的记录。
- follows 允许关注双方读取，关注者创建/删除。
- tags 对认证用户公共读，当前也允许任意插入。
- 私有 `materials` bucket 按对象路径第一段 `user_id` 隔离。
- `community-media` 是公开桶，写删按用户文件夹限制。

### 7.3 已知数据完整性问题

- Profile owner update 没有限制列，用户可修改自己的 points、credits、等级、VIP 和 streak。
- `_add_points(uid,d)`、`_notify(uid,...)` 是普通 `SECURITY DEFINER` 函数，迁移未显式撤销客户端执行权。
- 帖子作者可在 UPDATE 时修改作者快照和冗余计数；防伪造触发器只覆盖 INSERT。
- points 奖励没有不可变事件账本，赞/评论/帖子/任务可通过重复状态转换刷取。
- `study_goals.course_id` 缺少课程归属校验；task 没校验 material 与 course 相互匹配。
- feedback owner policy 允许用户自行修改 `status`。
- Storage 文件和 metadata 删除不是事务；社区媒体存在孤儿文件。

这些属于开发路线图阶段 A 的前置修复，不能等到支付上线再处理。

## 8. 当前部署

### 8.1 生产方案

GitHub Actions 在 runner 上：

1. 安装 pnpm/Node 依赖。
2. 运行 workspace typecheck 和默认 Vitest/jsdom 测试。
3. 构建 Web。
4. 构建 API Docker 镜像。
5. 打包 Web 和镜像，经 SSH/SCP 上传。
6. 服务器 `docker load`、替换静态目录、`docker compose up -d`。
7. 轮询 `/api/health`。

服务器上宿主 nginx 托管 `/opt/nalanda/web`，把 `/api/` 反代到仅绑定 `127.0.0.1:8411` 的 API 容器。生产 compose 不启动 AI/Redis。

### 8.2 通用 2G 模板

`infra/hybrid-2g` 可启动 Caddy、API、AI、Redis；它是未来接 AI 时的部署模板，不代表当前生产。模板需要按最小权限拆分 `.env`，增加 healthcheck、非 root 用户和服务认证后再用于正式环境。

### 8.3 发布局限

- SQL 迁移未与应用部署形成受追踪的一体化发布。
- `/health` 只看变量存在，不验证 Supabase/JWKS 依赖。
- 使用 `latest`，失败无自动回滚，并可能 prune 旧镜像。
- SSH 部署用户在当前文档中为 root。
- 仓库 nginx 文件不含 certbot 实际生成的完整 TLS 状态。

操作流程见 [数据库发布与回滚](operations/DATABASE_RELEASE_ROLLBACK.md)、[备份恢复](operations/BACKUP_RECOVERY.md) 和 [监控告警](operations/OBSERVABILITY_ALERTING.md)。

## 9. 构建、测试与质量边界

- Node 20、pnpm 9.12.3、Turborepo。
- Web 使用 Vite；`vite build` 不等同于 TypeScript 类型检查。
- Python AI 不属于 pnpm workspace，需要独立安装和启动。
- 可执行测试命令和环境要求见 [测试指南](guides/TESTING.md)。
- 默认 `pnpm test` 运行 4 组 jsdom 集成测试；3 组真实 Supabase RLS/Storage E2E 需要隔离项目凭据和 project-ref 二次确认，默认跳过。
- 历史实现笔记中的“已验证”必须能映射到仓库测试；不能复现的旧验证只能作为历史记录。

## 10. 当前优先风险

1. 收紧 Profile、definer RPC、帖子可信字段和反馈状态权限。
2. 将 points 奖励改为幂等事件/账本。
3. 修复 legacy 跨会话单例、resize 生命周期、详情动作刷新和错误处理。
4. 统一 AI/前端/TS 契约，再实现真实生成链路。
5. 建立可追踪迁移、恢复演练、监控告警和密钥轮换。

处理顺序和验收门见 [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md)。
