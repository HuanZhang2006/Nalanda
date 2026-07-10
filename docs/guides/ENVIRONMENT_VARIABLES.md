# 环境变量矩阵

> **本文内容：** 汇总仓库中已读取、仅由部署配置注入、只供运维脚本使用以及仍属蓝图的环境变量，并标明作用域、阶段和敏感级别。  
> **作用：** 防止变量放错服务、把服务端密钥打进前端、因遗漏配置导致部署或轮换失败。  
> **何时更新：** 新增、删除、重命名变量，改变默认值/消费者/敏感级别，修改 CI、Docker、域名、第三方供应商或密钥轮换流程时立即更新。

## 1. 阅读约定

- **当前必需**：现有某条用户链路要正常工作时必须提供。
- **当前可选**：代码已读取，但可省略或仅影响状态展示。
- **目标占位**：示例或目标部署已经预留，当前业务代码尚未使用。
- **公开**不等于可以随意修改；它仅表示值会出现在浏览器包或公开请求中。
- 任何 service-role、私钥、个人访问令牌和供应商 secret 都不能使用 `VITE_*` 前缀。

## 2. Web 构建期变量

来源模板：`apps/web/.env.example`。本地文件是 `apps/web/.env.local`；生产由 `.github/workflows/deploy.yml` 从 GitHub Actions Secrets 注入。Vite 会把这些值编译进静态文件，修改后必须重建 Web。

| 变量 | 状态 | 敏感级别 | 消费者 | 用途与缺省行为 |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | 当前必需 | 公开配置 | `apps/web/src/lib/supabase.ts` | Supabase 项目 URL；缺失时客户端为 `null`，登录页显示未配置提示。 |
| `VITE_SUPABASE_ANON_KEY` | 当前必需 | 公开凭据 | `apps/web/src/lib/supabase.ts` | 浏览器 anon/publishable key；安全边界依赖 Auth + RLS，绝不能换成 service-role key。 |

当前 Web 没有 `VITE_API_URL`。浏览器使用相对路径 `/api`：本地由 Vite 代理到 `localhost:3000`，生产由 nginx 反代。

## 3. NestJS API 运行时变量

来源模板：`apps/api/.env.example`。本地文件是 `apps/api/.env`；当前生产文件是服务器 `/opt/nalanda/.env`，由 `infra/deploy/docker-compose.yml` 的 `env_file` 载入。

| 变量 | 状态 | 敏感级别 | 消费者 | 用途与缺省行为 |
|---|---|---|---|---|
| `PORT` | 当前可选 | 公开配置 | `apps/api/src/main.ts` | 监听端口；无效或缺失时为 `3000`。生产 compose 显式设置 `3000`。 |
| `SUPABASE_URL` | 当前必需（认证/注册） | 公开配置 | Auth controller、JWT guard、health | Admin Auth 基址、JWKS/issuer 基址；缺失时注册报 `SERVER_MISCONFIG`，受保护接口无法通过 JWKS 验签。 |
| `SUPABASE_SERVICE_ROLE_KEY` | 当前必需（注册） | **最高机密** | `apps/api/src/auth/auth.controller.ts` | 调用 Supabase Admin API 创建已确认用户，绕过 RLS；缺失时注册报 `SERVER_MISCONFIG`。只能存在于后端。 |
| `SUPABASE_JWT_SECRET` | 当前可选 | **最高机密** | `apps/api/src/auth/supabase.guard.ts` | 旧 HS256 令牌的回退验签。当前守卫优先使用 JWKS；非对称签名项目不应无理由复制此值。 |
| `REDIS_URL` | 当前仅状态标记 | 内部配置；若含密码则机密 | health | 当前 API 不建立 Redis 连接，只在 `/api/health` 显示 `configured/unset`。目标用于 BullMQ/缓存。 |
| `AI_SERVICE_URL` | 当前仅状态标记 | 内部配置 | health | 当前 API 不调用 AI，只在健康响应显示是否设置。目标值为 AI 内网地址。 |
| `NODE_ENV` | 部署配置 | 公开配置 | Node/Nest 运行时生态 | `infra/hybrid-2g/docker-compose.yml` 设置 `production`；当前应用代码没有条件读取。 |

## 4. FastAPI AI 运行时变量

AI 没有独立 `.env.example`；通用目标部署变量集中在 `infra/hybrid-2g/.env.example`。

| 变量 | 状态 | 敏感级别 | 消费者 | 用途与缺省行为 |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | 当前仅状态标记 | **最高机密** | `apps/ai/app/main.py` health | 当前仅决定 `/health` 的 `claude` 是 `configured` 或 `unset`；生成仍是固定桩。目标用于真实 Claude 调用。 |
| `PORT` | compose 中设置但应用命令未读取 | 公开配置 | `infra/hybrid-2g/docker-compose.yml` | AI Dockerfile 的 uvicorn 命令固定监听 `8000`；仅设置变量不会改变监听端口。 |
| `REDIS_URL` | 目标占位 | 内部配置；若含密码则机密 | hybrid compose 注入 | 当前 Python 代码未读取。目标用于任务状态/队列协作。 |

## 5. 数据库迁移运维变量

消费者：`scripts/db-push.mjs`。只应临时注入受控终端或 CI secret，不应写进应用 `.env`。

| 变量 | 状态 | 敏感级别 | 用途与注意事项 |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | 执行脚本必需 | **最高机密** | Supabase 账号 Personal Access Token，可访问 Management API；使用最小权限账号并在离职/泄露时立即撤销。 |
| `SUPABASE_PROJECT_REF` | 强烈要求显式提供 | 项目标识 | 目标项目 Ref。脚本存在默认 Ref；为避免误发到错误项目，所有人工和自动化调用都必须显式设置。 |
| `DATABASE_URL` | 运维约定，应用未读取 | **最高机密** | 本文档体系在备份/恢复示例中使用的临时 PostgreSQL 连接串；不是当前应用运行变量。优先通过密码文件或 secret 注入，避免进入 shell history。 |

## 6. 当前生产 CI/CD 变量

消费者：`.github/workflows/deploy.yml`。它们保存在 GitHub Actions Secrets，不在仓库文件中。

| 变量 | 状态 | 敏感级别 | 用途 |
|---|---|---|---|
| `SERVER_HOST` | 当前必需 | 受限配置 | SSH/scp 目标主机。 |
| `SERVER_USER` | 当前必需 | 受限配置 | 部署账号。当前文档描述为 `root`；目标应迁移到最小权限部署用户。 |
| `SERVER_SSH_KEY` | 当前必需 | **最高机密** | CI 专用 SSH 私钥；公钥位于服务器 `authorized_keys`。 |
| `VITE_SUPABASE_URL` | 当前必需 | 公开配置 | Web 构建期注入。 |
| `VITE_SUPABASE_ANON_KEY` | 当前必需 | 公开凭据 | Web 构建期注入。 |

服务器 `/opt/nalanda/.env` 至少需要 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 才能支持注册；`SUPABASE_JWT_SECRET` 仅作为旧 HS256 回退。当前 CI**不会**创建或更新这个文件。

## 7. Supabase RLS E2E 变量

消费者：`apps/web/tests/rls.e2e.test.ts`。这些变量只允许指向可销毁的专用测试项目；默认 `pnpm test` 不启用外部 E2E。

| 变量 | 状态 | 敏感级别 | 用途与保护 |
|---|---|---|---|
| `RUN_SUPABASE_RLS_E2E` | 显式开关 | 公开配置 | 必须为 `1` 才运行；`pnpm test:rls` 会设置。 |
| `SUPABASE_URL` | E2E 必需 | 公开配置 | 专用测试项目 URL，不得为生产。 |
| `SUPABASE_ANON_KEY` | E2E 必需 | 公开凭据 | 以用户 A/B 登录并验证 RLS。 |
| `SUPABASE_SERVICE_ROLE_KEY` | E2E 必需 | **最高机密** | 创建/删除测试用户和清理 Storage；只注入 Node 测试进程。 |
| `SUPABASE_RLS_E2E_CONFIRM_REF` | E2E 必需 | 项目标识 | 必须与 URL hostname 的 project ref 精确相等，作为防误操作二次确认。 |

完整运行与清理流程见 [测试指南](./TESTING.md)。确认 ref 只防手滑，不授权在生产运行。

## 8. `infra/hybrid-2g` 目标部署变量

来源模板：`infra/hybrid-2g/.env.example`。该目录是目标拓扑，不是 `nalanda.online` 当前实际编排。

| 变量 | 当前使用情况 | 敏感级别 | 说明 |
|---|---|---|---|
| `DOMAIN` | Caddyfile 已使用 | 公开配置 | Caddy 站点域名。 |
| `ACME_EMAIL` | Caddyfile 已使用 | 个人/受限配置 | ACME 账户联系邮箱。 |
| `SUPABASE_URL` | API 已使用 | 公开配置 | 同上。 |
| `SUPABASE_ANON_KEY` | 当前服务代码未读取 | 公开凭据 | 名称不带 `VITE_`，不会自动进入 Web 静态包；若 hybrid Web 需使用，仍须在构建阶段注入对应 `VITE_*`。 |
| `SUPABASE_SERVICE_ROLE_KEY` | API 已使用 | **最高机密** | 同上。 |
| `SUPABASE_JWT_SECRET` | API 可选读取 | **最高机密** | 同上。 |
| `ANTHROPIC_API_KEY` | AI health 读取；业务未使用 | **最高机密** | 真实 AI 接入后才成为生成必需项。 |
| `STRIPE_SECRET_KEY` | 目标占位 | **最高机密** | 当前无支付模块、无消费者。 |
| `STRIPE_WEBHOOK_SECRET` | 目标占位 | **最高机密** | 当前无 webhook endpoint、无消费者；Caddy 注释不是接口实现。 |
| `REDIS_URL` | API health 读取，业务未连接 | 内部配置 | compose 中覆盖为 `redis://redis:6379`。 |
| `AI_SERVICE_URL` | API health 读取，业务未连接 | 内部配置 | compose 中覆盖为 `http://ai:8000`。 |

## 9. 配置落点矩阵

| 环境 | Web 公开配置 | API/AI 服务端秘密 | 运维临时秘密 |
|---|---|---|---|
| 本地 | `apps/web/.env.local` | `apps/api/.env`；AI 进程环境 | 当前 shell/安全密码文件 |
| GitHub Actions | Actions Secrets 注入 Web 构建 | 当前工作流不注入 API 运行密钥 | `SERVER_SSH_KEY` 等 Actions Secrets |
| 当前生产 | 已编译在 `/opt/nalanda/web` 静态包 | `/opt/nalanda/.env`，权限应为 `0600` | 仅维护窗口临时注入，不落日志 |
| hybrid 目标 | 构建 Web 时另行注入 `VITE_*` | `infra/hybrid-2g/.env` | 仅维护窗口临时注入 |

## 10. 新增变量检查清单

1. 明确消费者、阶段（build/runtime/operation）、默认行为和是否必需。
2. 判断是否会进入浏览器；任何高权限凭据都禁止进入客户端。
3. 更新对应 `.env.example`，只写占位值。
4. 更新本矩阵、[本地开发手册](./LOCAL_DEVELOPMENT.md)和[密钥轮换](../operations/SECRET_ROTATION.md)。
5. 为缺失/无效配置增加启动校验或明确错误；当前 health 的 `configured` 不代表连接成功。
6. 更新 CI/compose 后验证变量确实被目标进程读取，避免“配置存在但代码未使用”。
7. 若变量被移除，先确认生产、GitHub、个人环境和历史部署均不再依赖，再撤销对应秘密。
