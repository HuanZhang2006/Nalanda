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
| `SUPABASE_SERVICE_ROLE_KEY` | 当前必需（注册/readiness/Courses） | **最高机密** | Auth controller、health、Courses services | 调用 Admin Auth/PostgREST/Storage 与 service-only RPC；绕过 RLS，只能存在于后端且绝不进入响应/日志。 |
| `SUPABASE_JWT_SECRET` | 当前可选 | **最高机密** | `apps/api/src/auth/supabase.guard.ts` | 旧 HS256 令牌的回退验签。当前守卫优先使用 JWKS；非对称签名项目不应无理由复制此值。 |
| `REDIS_URL` | 当前仅状态标记 | 内部配置；若含密码则机密 | health | 当前 API 不建立 Redis 连接，只在 `/api/health` 显示 `configured/unset`。目标用于 BullMQ/缓存。 |
| `AI_SERVICE_URL` | 当前仅状态标记 | 内部配置 | health | 当前 API 不调用 AI，只在健康响应显示是否设置。目标值为 AI 内网地址。 |
| `NODE_ENV` | 部署配置 | 公开配置 | Node/Nest、Courses flags | `production` 时未设置的 Courses/分享/市场 flag 默认关闭；非生产时前三者默认开，语音始终默认关。 |

### 3.1 Courses、市场、Azure Speech 与 OpenRouter

这些变量只允许进入 API 运行环境，不得使用 `VITE_*`。生产 `/opt/nalanda/.env` 由运维维护；既有 Supabase/Azure/Courses 值不由 workflow 重建。0019–0020 发布新增的部署步骤只通过标准输入原子更新 OpenRouter 相关键并保持文件 mode 600，不打印 secret；2026-07-28 已用该路径完成真实 gate 和生产激活。

| 变量 | 状态/默认 | 敏感级别 | 用途 |
|---|---|---|---|
| `PUBLIC_ORIGIN` | 当前必需；本地 `http://localhost:5173` | 公开配置 | 生成课程分享 URL；生产应为规范 HTTPS origin，无结尾 `/`。 |
| `CORS_ALLOWED_ORIGINS` | 可选，默认复用 `PUBLIC_ORIGIN` | 公开配置 | 逗号分隔的浏览器跨域 allowlist；生产两者都缺失时不发 CORS 许可，同源 nginx 路径仍可用。 |
| `FEATURE_LEARNING_COURSES_ENABLED` | flag；production 默认 false | 公开配置 | Courses 总开关；关闭返回 503。 |
| `FEATURE_COURSE_SHARING_ENABLED` | flag；production 默认 false | 公开配置 | 公开分享创建/读取/克隆；关闭伪装 404。 |
| `FEATURE_COURSE_MARKET_ENABLED` | flag；production 默认 false | 公开配置 | Course Market、发布、克隆、举报/审核；关闭伪装 404。 |
| `FEATURE_PRONUNCIATION_ENABLED` | flag；任何环境默认 false | 公开配置 | Azure TTS/评分入口；只有显式 true 才可调用。 |
| `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED` | flag；production 默认 false；当前生产 true | 公开配置 | 持久音频队列、manifest、未来五词预取与整单元离线音频；依赖 Courses/Pronunciation 同时开启。 |
| `FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED` | flag；production 默认 false；当前生产 true | 公开配置 | 拼写阶段的可选语义翻译前测；关闭时启动请求若要求 `translationFirst=true` 返回 503，普通拼写和限时功能不受影响。 |
| `AZURE_SPEECH_CIRCUIT_OPEN` | 可选，默认 false | 受限配置 | 紧急熔断；true 时语音统一 503，不影响文本学习。 |
| `AZURE_SPEECH_KEY` | 语音启用时必需 | **最高机密** | Azure Speech subscription key，只在 API 容器。 |
| `AZURE_SPEECH_REGION` | 语音启用时必需 | 受限配置 | Azure region，同时组成 TTS/STT endpoint。 |
| `AZURE_SPEECH_VOICE` | 可选，`en-US-JennyNeural` | 公开配置 | en-US TTS voice 名称。 |
| `AZURE_SPEECH_TIMEOUT_MS` | 可选，10,000 | 公开配置 | 单次 Azure TTS/评分硬超时；实现限制在 1,000–60,000 ms，超时降级且不记学习错误。 |
| `AZURE_SPEECH_PRONUNCIATION_PASS_SCORE` | 可选，70 | 公开产品配置 | 整体 `PronScore` 达标线，允许 1–100；生产认词阶段和 0029 起的读音考试都用它判定每道题正误，但单元考试总通过率仍由用户选择的 `examPassPercent`（默认 90）独立决定。API 必须把实际值返回给 UI。 |
| `AZURE_SPEECH_ASSESSMENTS_PER_MINUTE` | 可选，30 | 公开配置 | 单用户评分每分钟持久限额。 |
| `AZURE_SPEECH_ASSESSMENTS_PER_DAY` | 可选，300 | 公开配置 | 按用户 IANA 时区本地日期的每日评分限额。 |
| `AZURE_SPEECH_MONTHLY_BUDGET_MICRO_USD` | 可选，5,000,000 | 受限配置 | 所有 API 实例共享的月度估算预算，单位 micro-USD。 |
| `AZURE_SPEECH_TTS_REQUESTS_PER_MINUTE` | 可选，20 | 受限配置 | 全局 TTS 生成 reservation 每分钟上限；数据库在所有 API 副本间共享。 |
| `AZURE_SPEECH_TTS_MONTHLY_CHAR_LIMIT` | 可选，500,000 | 受限配置 | 全局 TTS 每月字符 reservation 上限；跨用户复用缓存不重复计字符。 |
| `AZURE_SPEECH_TTS_MICRO_USD_PER_1000_CHARS` | 可选，16,000 | 受限配置 | TTS 每千字符估算成本，用于预算预留，不是账单事实。 |
| `AZURE_SPEECH_ASSESSMENT_MICRO_USD` | 可选，2,500 | 受限配置 | 每次评分估算成本。 |
| `LEARNING_AUDIO_PREWARM_INTERVAL_MS` | 可选，3,100 | 受限配置 | worker 启动两次 Azure TTS 的最小间隔；实现拒绝小于 3,100 ms，默认配合全局单租约。 |
| `LEARNING_AUDIO_SYNTHESIS_VERSION` | 可选，`1` | 受限配置 | 进入全局 SHA-256 缓存键；更换 voice/SSML/后处理语义时递增以安全重建，不原地覆盖旧键。 |
| `AZURE_SPEECH_FAKE` | **仅测试**，默认 false | 测试配置 | 生成固定 WAV/评分；任何共享、staging 供应商 smoke 或生产必须未设置/false，API 在 `NODE_ENV=production` 时显式拒绝 true。 |
| `OPENROUTER_API_KEY` | 翻译前测启用时必需 | **最高机密** | 只存在于 NestJS/受保护发布环境；以 Bearer token 调用 OpenRouter，绝不能进入 Web bundle、数据库、日志或提交。 |
| `OPENROUTER_MODEL` | 可选，`google/gemma-4-26b-a4b-it:free` | 受限配置 | 语义评判模型；生产 gate 固定验证该模型，变更必须经过 ADR、评测与成本复核。 |
| `OPENROUTER_BASE_URL` | 可选，`https://openrouter.ai/api/v1` | 公开配置 | OpenRouter API 基址；只允许 API 读取。 |
| `OPENROUTER_TIMEOUT_MS` | 可选，12,000 | 公开配置 | 单次评判硬超时，实现限制 1,000–30,000 ms；超时释放数据库租约且不记学习错误。 |
| `OPENROUTER_ASSESSMENTS_PER_MINUTE` | 可选，20 | 受限配置 | 每用户一分钟真实 provider 评判上限；确定性完全匹配、UUID 幂等重放和仅领取租约都不计数。 |
| `OPENROUTER_ASSESSMENTS_PER_DAY` | 可选，500 | 受限配置 | 每用户滚动 24 小时真实 provider 评判上限；达到上限时响应包含预计恢复秒数。 |
| `OPENROUTER_FAKE` | **仅测试**，默认 false | 测试配置 | 自动化用确定性 exact-match adapter；production 进程显式拒绝 true，不能作为真实供应商证据。 |
| `COURSE_MARKET_DAILY_PUBLISH_LIMIT` | 可选，5 | 公开配置 | 每用户本地日期上架次数限制。 |
| `COURSE_REPORT_DAILY_LIMIT` | 可选，20 | 公开配置 | 每用户本地日期举报次数限制。 |
| `COURSE_REPORT_ALERT_THRESHOLD` | 可选，3 | 受限配置 | 同一目标 open 举报达到该值写结构化告警；不会自动下架。 |
| `COURSE_MARKET_ADMIN_USER_IDS` | 默认空 | **敏感授权配置** | 逗号分隔的 Supabase user UUID；授权隐藏/恢复/撤回市场版本，应纳入审批与轮换。 |

所有 `*_LIMIT`、`*_BUDGET*`、`*_COST*`、timeout 和预热间隔必须是有限正数，其中次数、字符、毫秒和 micro-USD 预算必须是安全整数；`AZURE_SPEECH_PRONUNCIATION_PASS_SCORE` 还必须在 1–100，合成版本只接受 1–32 位字母数字/点/下划线/连字符。缺失时使用表中默认值；显式填写非法值时 API 以 `503 SERVER_MISCONFIG` 失败关闭，不会把 `NaN/null` 传给数据库后绕过配额或候补规则。

`OPENROUTER_ASSESSMENTS_PER_DAY=500` 是仓库默认值和生产环境安装脚本目标值；修改本文或 `.env.example` 不会改写正在运行的服务器。生产已随应用/0027–0028 受保护发布原子更新 `/opt/nalanda/.env`，后续发布报告仍必须单独核对容器内生效值且不得打印 key。

## 4. FastAPI AI 运行时变量

AI 没有独立 `.env.example`；通用目标部署变量集中在 `infra/hybrid-2g/.env.example`。

| 变量 | 状态 | 敏感级别 | 消费者 | 用途与缺省行为 |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | 当前仅状态标记 | **最高机密** | `apps/ai/app/main.py` health | 当前仅决定 `/health` 的 `claude` 是 `configured` 或 `unset`；生成仍是固定桩。目标用于真实 Claude 调用。 |
| `PORT` | compose 中设置但应用命令未读取 | 公开配置 | `infra/hybrid-2g/docker-compose.yml` | AI Dockerfile 的 uvicorn 命令固定监听 `8000`；仅设置变量不会改变监听端口。 |
| `REDIS_URL` | 目标占位 | 内部配置；若含密码则机密 | hybrid compose 注入 | 当前 Python 代码未读取。目标用于任务状态/队列协作。 |

## 5. 数据库迁移运维变量

消费者：Supabase CLI、发布恢复点脚本，以及仅供应急的 `scripts/db-push.mjs`。只应临时注入受控终端或 GitHub protected environment，不应写进应用 `.env`。

| 变量 | 状态 | 敏感级别 | 用途与注意事项 |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | 执行脚本必需 | **最高机密** | Supabase 账号 Personal Access Token，可访问 Management API；使用最小权限账号并在离职/泄露时立即撤销。 |
| `SUPABASE_PROJECT_REF` | 必需 | 项目标识 | 目标项目 Ref。脚本已移除默认值；CI 还会与 `VITE_SUPABASE_URL` 交叉核对。 |
| `SUPABASE_DB_PASSWORD` | CLI 远端操作必需 | **最高机密** | `supabase link/db dump/db push/db lint` 的数据库密码；仅放 `production-database` environment。 |
| `ALLOW_LEGACY_DB_PUSH` | 旧脚本显式开关 | 公开配置 | 只有值为 `YES` 才允许不维护 history 的 `db-push.mjs`；正常 CI 禁止使用。 |
| `BACKUP_ENCRYPTION_KEY` | 本地备份/恢复脚本必需 | **最高机密** | 加密/验证 release archive；CI 对应 secret 名为 `DB_BACKUP_ENCRYPTION_KEY`。 |
| `BACKUP_OUTPUT` | 创建恢复点必需 | 受限路径 | 加密输出路径，必须以 `.tar.gz.enc` 结尾。 |
| `BACKUP_ARCHIVE` | 验证/恢复必需 | 受限路径 | 已下载的加密数据库 archive。 |
| `RESTORE_DATABASE_URL` | 隔离恢复必需 | **最高机密** | 只能指向新建空白项目；恢复脚本拒绝源项目。 |
| `RESTORE_TARGET_PROJECT_REF` / `RESTORE_CONFIRM_PROJECT_REF` | 隔离恢复必需 | 项目标识 | 两次 Ref 必须相同且连接串包含该 Ref。 |
| `ALLOW_ISOLATED_RESTORE` | 隔离恢复开关 | 公开配置 | 必须显式为 `YES`；不允许原地生产恢复。 |
| `DATABASE_URL` | 运维约定，应用未读取 | **最高机密** | 本文档体系在备份/恢复示例中使用的临时 PostgreSQL 连接串；不是当前应用运行变量。优先通过密码文件或 secret 注入，避免进入 shell history。 |

## 6. 当前生产 CI/CD 变量

消费者：`.github/workflows/deploy.yml`。它们保存在 GitHub Actions Secrets，不在仓库文件中。

| 变量 | 状态 | 敏感级别 | 用途 |
|---|---|---|---|
| `SERVER_HOST` | 当前必需 | 受限配置 | SSH/scp 目标主机。 |
| `SERVER_USER` | 当前必需 | 受限配置 | 部署账号。当前文档描述为 `root`；目标应迁移到最小权限部署用户。 |
| `SERVER_SSH_KEY` | 当前必需 | **最高机密** | CI 专用 SSH 私钥；公钥位于服务器 `authorized_keys`。 |
| `SERVER_SSH_KNOWN_HOSTS` | 当前必需 | 受限配置 | 预先核验的服务器 SSH host key；CI 禁止运行时 `ssh-keyscan` 建立首次信任。 |
| `VITE_SUPABASE_URL` | 当前必需 | 公开配置 | Web 构建期注入。 |
| `VITE_SUPABASE_ANON_KEY` | 当前必需 | 公开凭据 | Web 构建期注入。 |
| `SUPABASE_ACCESS_TOKEN` | 有新迁移时必需 | **最高机密** | Supabase CLI 发布身份，只放 `production-database` environment。 |
| `SUPABASE_DB_PASSWORD` | 有新迁移时必需 | **最高机密** | 远端 dry-run/dump/push/lint。 |
| `SUPABASE_PROJECT_REF` | 有新迁移时必需 | 项目标识 | 与生产 Web URL 交叉确认。 |
| `DB_BACKUP_ENCRYPTION_KEY` | 有新迁移时必需 | **最高机密** | 加密 14 天保留的 release recovery artifact；副本须离线保存。 |
| `OPENROUTER_API_KEY` | 启用翻译前测时必需 | **最高机密** | GitHub `production` environment secret；部署 job 只经 SSH 标准输入交给服务器安装脚本，随后执行真实 provider gate。不得作为普通 repository variable。 |
| `PUBLIC_ORIGIN` | workflow 非秘密 env | 公开配置 | 公网 smoke 的规范 origin；API 分享 URL 仍从服务器 `.env` 读取，二者必须一致。 |

服务器 `/opt/nalanda/.env` 至少需要 Supabase 两项才能支持注册；启用 Courses 还必须写总/子 flags 和 `PUBLIC_ORIGIN`，启用语音/离线音频再写 Azure key/region、预热 flag、TTS 配额、间隔和 synthesis version；启用语义翻译前测还需 OpenRouter flag/key/model/配额并强制 fake=false。`SUPABASE_JWT_SECRET` 仅作旧 HS256 回退。CI 不下载该文件；OpenRouter 安装脚本在服务器本地保留其它行、原子替换本域变量并恢复 mode 600。CI 随后用该 `.env` 和新 API image 执行真实 Azure gates 与真实 OpenRouter 结构化判定 gate。API image Git SHA 位于非秘密 `.deploy.env` 并由 CI 原子更新。

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

Playwright CI 同时从本地 `supabase status -o env` 注入 `SUPABASE_JWT_SECRET`、两项 `VITE_SUPABASE_*`，显式打开 Courses/分享/市场/发音/音频预热/翻译前测 flags，并设置 `AZURE_SPEECH_FAKE=true`、`OPENROUTER_FAKE=true` 与本地 `PUBLIC_ORIGIN`。这些都是一次性 job 环境，不能复制成生产供应商验证配置。

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
| `PUBLIC_ORIGIN`、`CORS_ALLOWED_ORIGINS`、`FEATURE_*` | API 已读取 | 公开配置 | Courses 分享 URL、浏览器跨域 allowlist 和分阶段开关；hybrid 示例默认全部 production flag 为 false。 |
| `AZURE_SPEECH_KEY` | 语音启用时 API 读取 | **最高机密** | 只注入 API；不得注入 Web/AI。 |
| `AZURE_SPEECH_REGION/VOICE/TIMEOUT_MS/PRONUNCIATION_PASS_SCORE/CIRCUIT_OPEN` | API 已读取 | 受限配置 | Azure endpoint、voice、单次硬超时、整体评分通过线与紧急熔断。 |
| `AZURE_SPEECH_*LIMIT/BUDGET/COST*` | API 已读取 | 受限配置 | 持久配额与成本估算，实际变量名见 3.1。 |
| `COURSE_MARKET_*`、`COURSE_REPORT_*` | API 已读取 | 管理 ID 为敏感授权，其余受限 | 市场发布、举报和管理员控制。 |

## 9. 配置落点矩阵

| 环境 | Web 公开配置 | API/AI 服务端秘密 | 运维临时秘密 |
|---|---|---|---|
| 本地 | `apps/web/.env.local` | `apps/api/.env`；AI 进程环境 | 当前 shell/安全密码文件 |
| GitHub Actions | Actions Secrets 注入 Web 构建 | API 运行密钥仍只在服务器；DB 发布密钥在 protected environment | `SERVER_SSH_KEY`、已核验 host key、Supabase CLI 密钥、备份加密 key |
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
