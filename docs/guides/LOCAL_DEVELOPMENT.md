# 从零开始本地开发

> **本文内容：** 从空白开发机到运行 Web、NestJS API、FastAPI AI 桩服务和连接 Supabase 的完整步骤，并列出常见故障与最小验收方法。  
> **作用：** 让新贡献者不依赖口头信息即可建立可复现的开发环境。  
> **何时更新：** 依赖版本、启动脚本、端口、数据库初始化方式、服务拓扑或新手必经步骤变化时；至少每个里程碑发布前复核一次。

## 1. 状态说明

本文使用以下标记：

- **当前实现**：命令和文件已经存在于仓库，可按本文执行。
- **目标状态**：计划中的工程能力，尚不能作为现有功能使用。

当前可本地运行：React/Vite Web、NestJS Auth/Courses API、FastAPI AI 桩服务。业务数据、认证与文件存储使用 Supabase；仓库已有 `supabase/config.toml`，推荐启动本地 Supabase，也可连接一个**独立的开发项目**。Courses 文件 AI 导入仍未实现；英语词表文本学习不需要 FastAPI、Redis、BullMQ、Stripe 或 Claude。

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

根 `pnpm lint` 会对 API、Web 和共享类型运行带 `noUnusedLocals`、`noUnusedParameters` 与 `noFallthroughCasesInSwitch` 的严格 TypeScript 静态检查；它不是 ESLint，也不替代正常 typecheck/test。

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
PUBLIC_ORIGIN=http://localhost:5173
FEATURE_LEARNING_COURSES_ENABLED=true
FEATURE_COURSE_SHARING_ENABLED=true
FEATURE_COURSE_MARKET_ENABLED=true
FEATURE_PRONUNCIATION_ENABLED=false
FEATURE_LEARNING_AUDIO_PREWARM_ENABLED=false
FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED=false
```

非 production 环境前三个 Courses flags 即使省略也默认开启，但建议显式写出；语音和翻译前测始终默认关闭。要测试持久音频队列，还需打开 `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED`，并使用仓库默认 `AZURE_SPEECH_TTS_REQUESTS_PER_MINUTE=20`、`AZURE_SPEECH_TTS_MONTHLY_CHAR_LIMIT=500000`、`LEARNING_AUDIO_PREWARM_INTERVAL_MS=3100`、`LEARNING_AUDIO_SYNTHESIS_VERSION=1`。要测真实 Azure，再填写开发资源的 `AZURE_SPEECH_KEY/REGION` 并开启 pronunciation；整体朗读通过线默认 70。不要为了普通课程开发复制生产 key。`AZURE_SPEECH_FAKE=true` 只供自动化，不是供应商 smoke，production 进程会拒绝它。

要测试真实语义翻译前测，在已被 Git 忽略的 `apps/api/.env` 中填写开发用 `OPENROUTER_API_KEY`，设置 `FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED=true`，并保留默认 model/base URL/timeout/配额。不要在命令行参数、浏览器 `VITE_*`、截图、issue 或测试 fixture 中放 key；文件权限建议设为 600。普通 UI/API 自动化使用 `OPENROUTER_FAKE=true`，它只做确定性路径测试且 production 会拒绝。真实单请求验证使用：

```bash
chmod 600 apps/api/.env
node --env-file=apps/api/.env scripts/smoke-openrouter-translation.mjs
```

脚本只输出 model、耗时和 token 计量，不打印 key、用户答案或完整供应商响应。

`/api/health` 会探测 JWKS 与 PostgREST profiles 空查询，失败返回 503；`REDIS_URL`/`AI_SERVICE_URL` 仍只影响状态展示。API 的 service-role key 还会调用 Courses 专用 RPC 和 `vocabulary-audio`，因此只能放在 API `.env`。

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
6. 打开 Courses，创建“英语单词学习”；选择逐单元粘贴或整份多单元词表，先制造一行格式错误确认精确标红，再修正并进入 Review Course Content。
7. 完成一个单元四阶段，刷新页面确认从 active session 恢复；建立 3 天复习并在 Schedule 看见独立复习项。
8. 创建分享、撤销后确认旧链接失效；上架免费 Course Market，用第二个开发账号克隆并确认副本进度为 0、不能再次传播。
9. 开启音频预热后选定单元：确认 manifest 从 pending 变 ready，当前题及后四词进入浏览器 Cache Storage；“下载单元音频”可续传、显示失败/配额暂停并可删除本地副本。浏览器即使授予 persistent storage，仍可能在存储压力下回收。
10. 在开发者工具设 Offline 后连续完成至少两题，确认反馈立即出现且完成页显示等待同步；恢复网络后同一 attempt UUID 串行提交，刷新不会重复累计错误。完整 Web app shell/PWA 离线启动不在此功能范围。
11. 开始包含拼写的学习/复习时分别验证：不勾选时行为不变；勾选限时并设 3 秒时，输入出现后倒计时并只自动提交一次；同时勾选翻译前测时，计时必须等语义回答通过后才开始。语义错误直接形成一次 spelling 错误，供应商超时/失败只显示可重试错误，不增加 wrong count。正确和错误结果都要同时显示英文拼写与分开的翻译。

本地当日无法验证“两次不同日期复习即熟练”时，不要手改生产数据；使用一次性本地 Supabase RLS fixture，测试会按 profile 时区生成两个不同 `local_date`。

这些步骤会写入数据；不要对生产项目执行。自动化命令和测试分层见 [可执行测试指南](./TESTING.md)。

### 7.3 Courses 文本导入与长页面回归

有单元课程提供两种互斥输入方式：

- **逐个单元粘贴**：手工新建/重命名单元，再分别粘贴词表；
- **整份多单元词表**：一次粘贴含标题的完整文本，例如：

```text
Starter Unit 1
unit 单元
section 部分
other 另外的/其他的
each 每个/各自
each other 互相/彼此

Starter Unit 2
bottle 瓶子
You're welcome. 不客气。
key 钥匙/关键
thing 东西/事情
need 需要
eraser 橡皮
```

编号标题可以使用 `Starter Unit 1`、`Lesson 2`、`Chapter 3`、`Module A`、`Section IV` 或对应的中文编号形式。任意自定义标题使用 `[Travel phrases]` 或 `# Travel phrases`；没有显式标记的普通文本行会按词条解析。词条仍是“每行一个英文词/短语 + 一个 ASCII 空格 + 翻译”，多个翻译以 `/` 分隔。

开发验收时确认：

1. 整份文本拆成正确的单元，解析错误显示整份原文的行/列而非单元内相对位置。
2. Review/Edit Course 把 `东西/事情` 显示为两个独立可编辑翻译输入；可分别删除并新增翻译。
3. 每个现有单元的“批量粘贴单词”可追加多行，若包含已有词会显示 `DUPLICATE_EXISTING_TERM` 且不部分追加。
4. 在至少足以超出一屏的词表中，`.content` 能滚到最底部，“添加单词”“批量粘贴单词”“添加单元”和保存按钮均可到达。
5. 无单元模式仍使用隐藏默认单元，不把第一条词误识别为单元标题。

文件入口只展示 AI 解析占位；不要选择真实材料或期待 PDF、Word、JSON、Markdown、HTML、图片上传/解析。

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

### Courses 返回 `COURSES_DISABLED` 或 404

- 检查 API 进程实际读取的是 `apps/api/.env`，修改后重启；
- production 模式必须显式设总开关，分享/市场还需各自子开关；
- sharing/market 关闭故意返回 404，不能通过开放 PostgREST 绕过；
- 确认本地数据库已 reset 到仓库最新迁移（当前仓库与生产均为 0028），而不是停在旧 migration history；是否已经应用仍以 `migration list` 和发布记录为准，不能只看文件存在。

### 翻译前测返回禁用、超时或配额错误

- `FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED` 关闭时，要求 `translationFirst=true` 的 session 启动会失败；关闭该选项的拼写仍可用。
- 确认 `OPENROUTER_API_KEY` 只在 API `.env`，model 为仓库锁定值，且没有在 production 设置 `OPENROUTER_FAKE=true`。
- 供应商超时、5xx 或结构化响应非法不会记错，用户可用同一 attempt UUID 重试；425 表示同 UUID 的租约仍在处理，409 表示另一设备已推进 revision，429 表示持久用户配额已达到。
- 不要把 provider 失败改成客户端“猜测判分”；服务端必须继续是错误事实、候补池和进度的权威。

### 发音按钮降级或评分不可用

这是允许的降级：没有 Azure 配置时浏览器 Web Speech 可朗读，文本学习继续。音频 GET 首次可能快速返回 `202 AUDIO_PENDING`，worker 生成后 manifest 才变 ready；不要把 202 当 500。评分要求 feature flag、key/region、当前 active session/当前认词卡片和 16 kHz/16-bit/单声道 PCM WAV；浏览器先做 20 ms VAD 并裁剪到 6 秒，供应商/麦克风失败不应记为学习错误。私有 TTS 对象缺失可能表现为 Storage HTTP 400 + JSON 404，应正常重建；Storage 网络/权限错误必须保持可见，不能误判为 cache miss 后重复消耗 Azure。

### Courses 创建/编辑页看不到底部操作

当前应用壳要求共享 `.main` 与 `.content` 都有 `min-height: 0`，并由 `.content` 的 `overflow-y: auto` 承担纵向滚动。先在浏览器开发工具中确认 `.content` 的 `scrollHeight > clientHeight` 且能改变 `scrollTop`；若不能，检查 `@nalanda/ui/nalanda.css` 是否实际加载，以及上层 flex/grid 子项是否覆盖了这些属性。不要用 Courses 专属固定高度、`100vh` 或额外 `overflow: hidden` 绕过共享滚动模型；弹窗内部滚动才是独立例外。

### `pnpm --filter @nalanda/api start` 找不到 `dist/main.js`

先执行 `pnpm --filter @nalanda/api build`。当前 start 脚本只运行编译产物。

## 9. 当前缺口与目标状态

- **当前**：已有 Supabase CLI 配置和可重复空库迁移；仍缺无敏感 seed/fixture 与一键业务测试数据。
- **目标**：为 API 增加 watch 模式和统一的 `pnpm dev` 编排。
- **当前**：CI 已强制 docs、TypeScript code lint/typecheck、Web jsdom、API/Courses unit、build、0007→最新迁移升级、空库数据库 lint/reset、双用户 RLS/Storage/Courses E2E 和 Playwright Courses 主流程；浏览器流程覆盖文本导入、弱网 outbox、Cache Storage、限时拼写和翻译前测，Azure/OpenRouter 使用 fake。生产发布另有真实 Azure gates 与真实 OpenRouter 结构化判定 gate；真实供应商不在 PR 上消耗共享额度，仍缺 FastAPI contract 和 ESLint/格式化规则。
- **目标**：接入 Redis/BullMQ、API→AI 内部调用、真实解析/Claude 生成。
- **目标**：提供一键清理测试数据和隔离测试账号的脚本。

在这些能力落地前，以仓库实际脚本和本文“当前实现”描述为准。
