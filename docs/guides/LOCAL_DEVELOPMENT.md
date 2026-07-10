# 从零开始本地开发

> **本文内容：** 从空白开发机到运行 Web、NestJS API、FastAPI AI 桩服务和连接 Supabase 的完整步骤，并列出常见故障与最小验收方法。  
> **作用：** 让新贡献者不依赖口头信息即可建立可复现的开发环境。  
> **何时更新：** 依赖版本、启动脚本、端口、数据库初始化方式、服务拓扑或新手必经步骤变化时；至少每个里程碑发布前复核一次。

## 1. 状态说明

本文使用以下标记：

- **当前实现**：命令和文件已经存在于仓库，可按本文执行。
- **目标状态**：计划中的工程能力，尚不能作为现有功能使用。

当前可本地运行：React/Vite Web、NestJS API、FastAPI AI 桩服务。业务数据、认证与文件存储使用 Supabase；仓库已有 `supabase/config.toml`，推荐启动本地 Supabase，也可连接一个**独立的开发 Supabase 项目**。Redis、BullMQ、Stripe、真实 Claude 生成管线均不是本地基本链路的一部分。

## 2. 前置条件

| 工具 | 版本/要求 | 用途 |
|---|---:|---|
| Git | 近期稳定版 | 获取代码、查看变更 |
| Node.js | `>=20` | Web、API、脚本 |
| pnpm | `9.12.3` | monorepo 依赖与任务；版本见根 `package.json` |
| Python | 推荐 `3.12` | AI 服务；生产 AI 镜像也是 Python 3.12 |
| PostgreSQL 客户端 | 推荐与服务端主版本兼容 | 可选，用于备份、恢复与人工 SQL 检查 |
| Docker | 近期稳定版 | 推荐的本地 Supabase、数据库迁移/RLS E2E |
| Supabase CLI | `2.101.0`（与 CI 一致） | 启动本地栈、reset、lint、migration history |
| Supabase 项目 | 可选的独立开发项目 | 需要验证托管环境时使用，禁止连接生产 |

不用本地数据库时 Docker 可省略；要复现 CI 的数据库/RLS 门禁则必须运行 Docker。当前日常开发不要求启动 Redis。

启用仓库声明的 pnpm 版本：

```bash
corepack enable
corepack prepare pnpm@9.12.3 --activate
node --version
pnpm --version
```

## 3. 获取代码并安装依赖

```bash
git clone <repository-url> Nalanda
cd Nalanda
pnpm install --frozen-lockfile
```

首次安装后先做一次静态验收：

```bash
pnpm typecheck
pnpm build
```

根 `pnpm lint` 目前没有对应的 package lint 实现，不能把“命令退出 0”解释为代码已通过 ESLint。

## 4. 准备 Supabase

### 4.1 推荐：本地 Supabase

从仓库配置启动并重建：

```bash
supabase start
supabase db reset --local --no-seed
supabase db lint --local --schema public --level error --fail-on error
supabase status
```

把 status 给出的 API URL 和 anon/service-role key 分别填入 Web/API 本地环境。完成开发后运行 `supabase stop --no-backup`。

### 4.2 可选：创建隔离托管项目

在 Supabase 创建一个只供开发使用的项目，记录：

- Project URL；
- anon/publishable key；
- service-role key；
- Project Ref；
- 仅在需要兼容旧 HS256 令牌时使用的 JWT secret。

不要把生产 Project Ref 或生产密钥复制到个人开发环境。变量的完整用途与敏感级别见 [环境变量矩阵](./ENVIRONMENT_VARIABLES.md)。

### 4.3 托管开发项目应用迁移

迁移文件位于 `supabase/migrations/`。正常路径使用 CLI history：

```bash
SUPABASE_ACCESS_TOKEN=<personal-access-token> \
SUPABASE_DB_PASSWORD=<development-db-password> \
supabase link --project-ref <development-project-ref>
supabase db push --dry-run
supabase db push
```

旧 Management API 脚本只供应急：

```bash
SUPABASE_ACCESS_TOKEN=<personal-access-token> \
SUPABASE_PROJECT_REF=<development-project-ref> \
ALLOW_LEGACY_DB_PUSH=YES \
node scripts/db-push.mjs
```

注意：

1. 必须显式传 `SUPABASE_PROJECT_REF`；脚本没有默认值并强制应急开关。
2. 该脚本逐文件执行并在首个错误处停止；它不提供仓库级回滚，也不替代发布前备份。
3. 它会重放全部 SQL。现有迁移以可重复执行为目标，但 `create table if not exists` 不会自动修复已经漂移的表结构。
4. 首次接入或任何非开发环境发布前，阅读 [数据库发布与回滚](../operations/DATABASE_RELEASE_ROLLBACK.md)。

也可以在一次性开发项目的 Supabase SQL Editor 中逐个执行文件，但正常本地/CI 基线是仓库的 `config.toml` 与 CLI。生产禁止用 SQL Editor 绕过 migration history 和发布恢复点。

## 5. 配置环境变量

创建 Web 本地配置：

```bash
cp apps/web/.env.example apps/web/.env.local
```

至少填写：

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<development-anon-key>
```

创建 API 本地配置：

```bash
cp apps/api/.env.example apps/api/.env
```

当前登录/注册链路至少需要：

```dotenv
PORT=3000
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<development-service-role-key>
# 仅旧 HS256 项目需要；使用 JWKS 的项目可以留空
SUPABASE_JWT_SECRET=
```

`/api/health` 会用以上 Supabase 配置探测 JWKS 与 PostgREST profiles 空查询，配置/连通失败时返回 503；`REDIS_URL` 和 `AI_SERVICE_URL` 当前仍只影响 `configured/unset` 展示，API 不会连接这两个依赖。

所有 `.env`/`.env.local` 已被 `.gitignore` 排除。提交前仍应运行 `git status --short`，确认没有密钥文件进入暂存区。

## 6. 启动服务

建议分别打开三个终端。

### 6.1 NestJS API（端口 3000）

当前 API 没有 watch/dev 脚本，修改源码后需要重新构建并重启：

```bash
pnpm --filter @nalanda/api build
pnpm --filter @nalanda/api start
```

验证：

```bash
curl -fsS http://localhost:3000/api/health
```

### 6.2 React/Vite Web（默认端口 5173）

```bash
pnpm --filter @nalanda/web dev
```

打开 `http://localhost:5173`。Vite 会把 `/api/*` 代理到 `http://localhost:3000`，因此注册请求不需要额外修改 URL。

### 6.3 FastAPI AI 桩服务（端口 8000，可选）

```bash
cd apps/ai
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

验证：

```bash
curl -fsS http://localhost:8000/health
```

当前生成接口只返回固定占位结构，`/parse` 也不会读取或解析文件。`ANTHROPIC_API_KEY` 只改变健康响应中的配置标记，并不会让桩逻辑变成真实生成。

## 7. 最小功能验收

### 7.1 无账号写入的检查

```bash
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:8000/health
curl -I http://localhost:5173
```

### 7.2 需要开发账号的检查

1. 在 Web 注册一个仅用于开发的邮箱账号。
2. 确认 `auth.users` 创建后触发生成对应 `public.profiles`。
3. 创建课程并上传一个小型资料，确认 `materials` 私有桶路径以用户 UUID 开头。
4. 创建学习任务并切换完成状态，确认任务与个人资料可重新加载。
5. 发布一条无敏感内容的测试帖，再删除测试数据。

这些步骤会写入数据；不要对生产项目执行。自动化命令和测试分层见 [可执行测试指南](./TESTING.md)。

## 8. 常见问题

### Web 显示“未配置 Supabase”

- 文件必须是 `apps/web/.env.local`；
- 变量名必须带 `VITE_`；
- Vite 只在进程启动时读取环境变量，修改后要重启 Web；
- 不要把 service-role key 放进任何 `VITE_*` 变量。

### 注册返回 `SERVER_MISCONFIG`

API 没读到 `SUPABASE_URL` 或 `SUPABASE_SERVICE_ROLE_KEY`。确认从 `apps/api` package 上下文启动，且文件名为 `apps/api/.env`。

### `/api/me` 返回 401

- 请求必须带 `Authorization: Bearer <Supabase access token>`；
- `SUPABASE_URL` 必须指向签发该令牌的同一项目；
- 非对称签名令牌通过项目 JWKS 验证；只有旧 HS256 项目才依赖 `SUPABASE_JWT_SECRET`；
- 检查系统时间，明显时钟漂移会导致令牌时间校验失败。

### Web 能登录但表查询失败

依次确认迁移已全部应用、用户有对应 `profiles`、请求携带有效会话，以及写入的 `user_id`/关联课程归属符合 RLS。完整关系和策略见 [ERD 与数据库字典](./ERD.md)。

### `pnpm --filter @nalanda/api start` 找不到 `dist/main.js`

先执行 `pnpm --filter @nalanda/api build`。当前 start 脚本只运行编译产物。

## 9. 当前缺口与目标状态

- **当前**：已有 Supabase CLI 配置和可重复空库迁移；仍缺无敏感 seed/fixture 与一键业务测试数据。
- **目标**：为 API 增加 watch 模式和统一的 `pnpm dev` 编排。
- **当前**：CI 已强制 docs/typecheck、Web jsdom、API readiness unit、build、数据库升级/lint/重建和本地 RLS/Storage E2E；仍缺 API HTTP/FastAPI unit/contract、浏览器 E2E 和通用代码 lint。
- **目标**：接入 Redis/BullMQ、API→AI 内部调用、真实解析/Claude 生成。
- **目标**：提供一键清理测试数据和隔离测试账号的脚本。

在这些能力落地前，以仓库实际脚本和本文“当前实现”描述为准。
