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
| `REDIS_URL` | 生产 0039–0040 必需 | **机密连接串** | Redis service、health、全局限流、扫描器 | API 建立真实连接；生产为 `redis://:<64-hex>@redis:6379/0`。缺失/不可达使 readiness 503，受保护写入 fail-closed。 |
| `RATE_LIMIT_HMAC_SECRET` | 生产 0039–0040 必需 | **最高机密** | Redis service/health | 至少 32 bytes；只对 IP/email 派生 HMAC，不得与 Redis、JWT、备份或供应商 secret 复用。 |
| `POINT_ABUSE_SCANNER_ENABLED` | 可选，默认启用（除显式 `false`） | 受限配置 | points scanner | Redis 已配置时是否周期扫描协同信号；CI Playwright 显式 false 避免后台不确定性。 |
| `POINT_ABUSE_SCAN_INTERVAL_SECONDS` | 可选，默认 300，最小 60 | 公开运维配置 | points scanner | 扫描周期；当前 Redis lock TTL 为 240 秒。 |
| `AI_SERVICE_URL` | 生产 0041–0043 必需 | 内部配置 | AI internal client/health | FastAPI 内网基址，生产为 `http://ai:8000`；不可指向公网。 |
| `AI_CALLBACK_BASE_URL` | 生产必需 | 内部配置 | generation processor | worker 阶段进度回调的 API 内网基址，生产为 `http://api:3000/api`。 |
| `AI_INTERNAL_TOKEN` | 生产必需 | **最高机密** | Nest/FastAPI 内部认证 | 两端相同的独立 32-byte hex；不得等于 Redis/HMAC/provider key，不进入 Web/日志。 |
| `FEATURE_MATERIAL_AI` | 安装默认 false；当前生产 true | 公开配置 | Materials AI API/Web | 总开关；部署安装后先保持 false，只在 readiness/canary/真实 gate 通过后开启。 |
| `MATERIAL_AI_MONTHLY_BUDGET_USD` | 可选，20 | 受限配置 | AI processor | provider usage 成功费用达到全局月预算后停止新调用。 |
| `MATERIAL_AI_GENERATION_MAX_COST_USD` | 可选，0.50 | 受限配置 | generation processor | 单次生成费用硬门；超限不保存结果并释放用户 quota reservation。 |
| `MATERIAL_AI_GRADING_MAX_COST_USD` | 可选，0.05 | 受限配置 | grading processor | 单次主观题评分费用硬门。 |
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
| `OPENROUTER_API_KEY` | 翻译前测、语音输入或 Materials AI 启用时必需 | **最高机密** | 服务端能力复用同一 secret；Materials AI worker 在隔离 `.ai.env` 获得副本。绝不能进入 Web bundle、数据库、日志或提交。 |
| `OPENROUTER_MODEL` | 可选，`google/gemma-4-26b-a4b-it:free` | 受限配置 | 语义评判模型；生产 gate 固定验证该模型，变更必须经过 ADR、评测与成本复核。 |
| `OPENROUTER_BASE_URL` | 可选，`https://openrouter.ai/api/v1` | 公开配置 | OpenRouter API 基址；只允许 API 读取。 |
| `OPENROUTER_TIMEOUT_MS` | 可选，12,000 | 公开配置 | 单次评判硬超时，实现限制 1,000–30,000 ms；超时释放数据库租约且不记学习错误。 |
| `OPENROUTER_ASSESSMENTS_PER_MINUTE` | 可选，20 | 受限配置 | 每用户一分钟真实 provider 评判上限；确定性完全匹配、UUID 幂等重放和仅领取租约都不计数。 |
| `OPENROUTER_ASSESSMENTS_PER_DAY` | 可选，500 | 受限配置 | 每用户滚动 24 小时真实 provider 评判上限；达到上限时响应包含预计恢复秒数。 |
| `OPENROUTER_STT_MODEL` | 可选，`fish-audio/transcribe-1` | 受限配置 | 只用于拼写前翻译语音输入的 STT 模型；客户端不可覆盖。 |
| `OPENROUTER_STT_LANGUAGE` | 可选，`zh` | 公开产品配置 | STT ISO 语言提示，默认识别中文；当前 UI 不提供语言选择。 |
| `OPENROUTER_STT_TIMEOUT_MS` | 可选，15,000 | 公开配置 | 单次 STT 硬超时，实现限制 1,000–30,000 ms；失败不会提交翻译答案。 |
| `OPENROUTER_STT_REQUESTS_PER_MINUTE` | 可选，20 | 受限配置 | 每用户持久 STT 分钟上限。 |
| `OPENROUTER_STT_REQUESTS_PER_DAY` | 可选，300 | 受限配置 | 按 Profile IANA 时区本地日期计算的用户 STT 日上限。 |
| `OPENROUTER_STT_MONTHLY_BUDGET_MICRO_USD` | 可选，5,000,000 | 受限配置 | 仅 `translation_stt` 的全局月估算预算；不与 Azure 预算混用。 |
| `OPENROUTER_STT_MICRO_USD_PER_SECOND` | 可选，100 | 受限配置 | 按当前 `$0.0001/秒` 折算的预算预留单价；只是保护性估算，供应商价格变化时必须同步复核。 |
| `OPENROUTER_FAKE` | **仅测试**，默认 false | 测试配置 | 自动化用确定性 exact-match adapter；production 进程显式拒绝 true，不能作为真实供应商证据。 |
| `COURSE_MARKET_DAILY_PUBLISH_LIMIT` | 可选，5 | 公开配置 | 每用户本地日期上架次数限制。 |
| `COURSE_REPORT_DAILY_LIMIT` | 可选，20 | 公开配置 | 每用户本地日期举报次数限制。 |
| `COURSE_REPORT_ALERT_THRESHOLD` | 可选，3 | 受限配置 | 同一目标 open 举报达到该值写结构化告警；不会自动下架。 |
| `COURSE_MARKET_ADMIN_USER_IDS` | 默认空 | **敏感授权配置** | 逗号分隔的 Supabase user UUID；授权隐藏/恢复/撤回市场版本，应纳入审批与轮换。 |
| `MODERATION_ADMIN_USER_IDS` | 默认空 | **敏感授权配置** | points signal/reward 审核管理员 UUID；新值优先，兼容期仅在为空时回退 Course Market allowlist。 |

所有 `*_LIMIT`、`*_BUDGET*`、`*_COST*`、timeout 和预热间隔必须是有限正数，其中次数、字符、毫秒和 micro-USD 预算必须是安全整数；`AZURE_SPEECH_PRONUNCIATION_PASS_SCORE` 还必须在 1–100，合成版本只接受 1–32 位字母数字/点/下划线/连字符。缺失时使用表中默认值；显式填写非法值时 API 以 `503 SERVER_MISCONFIG` 失败关闭，不会把 `NaN/null` 传给数据库后绕过配额或候补规则。

`OPENROUTER_ASSESSMENTS_PER_DAY=500` 是语义判分默认值；STT 独立使用 20/分钟、300/本地日和 5,000,000 micro-USD/月。修改本文或 `.env.example` 不会改写正在运行的服务器；0037–0038 已于 2026-08-04 通过受保护安装脚本原子写入 STT 非密钥配置并复用既有 secret。后续发布/轮换仍须单独核对容器内生效值且不得打印 key。

## 4. FastAPI Materials AI 运行时变量（生产 0041–0043）

来源模板：`apps/ai/.env.example`。本地使用进程私有环境；生产由受保护脚本生成 mode-600 `/opt/nalanda/.ai.env`。worker **不会**收到 service-role、Redis、Azure、JWT 或 Web key。

| 变量 | 状态/默认 | 敏感级别 | 用途 |
|---|---|---|---|
| `NODE_ENV` | production 必需 | 公开配置 | production 明确拒绝 fake provider readiness。 |
| `AI_INTERNAL_TOKEN` | 必需 | **最高机密** | 与 API 相同的内部请求/回调认证 token。 |
| `OPENROUTER_API_KEY` | 必需 | **最高机密** | DeepSeek/MiMo 服务端调用；不写数据库、日志、响应或 Web。 |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | 公开配置 | 固定 provider 基址。 |
| `SUPABASE_URL` | 必需 | 公开配置 | 只用于把允许下载的 signed URL host 限制到本项目；worker没有 service-role。 |
| `MATERIAL_AI_ALLOWED_STORAGE_HOSTS` | 可选补充 | 受限配置 | 逗号分隔额外允许 host；生产通常为空，禁止宽泛通配。 |
| `PUBLIC_APP_URL` | `https://nalanda.online` | 公开配置 | OpenRouter `HTTP-Referer` 标识。 |
| `MATERIAL_AI_FAKE_PROVIDER` | false | 测试配置 | pytest/Playwright 的确定性 adapter；production true 会使 readiness 失败。 |
| `MATERIAL_AI_TEMP_ROOT` | `/tmp/nalanda-material-ai` | 受限路径 | 0700 job 临时目录根；启动/定时清除 >1h orphan。 |
| `MATERIAL_AI_TEMP_MIN_FREE_BYTES` | 536870912 | 受限配置 | 创建和解析过程中低于 512MiB 失败关闭。 |
| `MATERIAL_AI_JOB_TEMP_LIMIT_BYTES` | 1073741824 | 受限配置 | 单任务临时空间 1GiB 硬上限。 |
| `MATERIAL_AI_MAX_CHARACTERS` | 400000 | 受限配置 | 规范化 DocumentIR 文本上限。 |
| `MATERIAL_AI_LIBREOFFICE_TIMEOUT_SECONDS` | 120 | 受限配置 | DOCX/PPTX 全量低优先级渲染硬超时。 |
| `MATERIAL_AI_PROVIDER_TIMEOUT_SECONDS` | 180 | 受限配置 | 一次结构化 OpenRouter 操作（包括全部重试与退避）的共享总时间上限；每次 HTTP 尝试只能使用剩余预算，完整 Nest 请求另有 20 分钟上限。 |
| `MATERIAL_AI_PROVIDER_MAX_ATTEMPTS` | 4 | 受限配置 | 同一固定模型请求的最大有界尝试次数，限制 1–10；仅网络错误及 408/429/502/503/504 可重试。 |
| `MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS` | 2 | 受限配置 | 指数退避起点，限制 0–60 秒；不会改变 model、ZDR 或同模型 provider failover 策略。 |
| `MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS` | 60 | 受限配置 | 单次退避上限，限制 0–300 秒；数值型 `Retry-After` 优先且不得提前请求，超过上限则该任务失败并释放额度。 |
| `MATERIAL_AI_GENERATION_MAX_TOKENS` | 30000 | 成本配置 | 试卷生成/一次 repair 最大 completion tokens。 |

模型 ID不是用户变量：代码固定 `deepseek/deepseek-v4-flash-0731` 与 `xiaomi/mimo-v2.5`，变更需 ADR、评测、成本和隐私复审。有界重试始终复用完全相同的模型与严格 schema；请求不提供其它 `models`，所以不存在跨模型 fallback。`sort="throughput"` 与 `allow_fallbacks=true` 只让该模型按吞吐量优先在仍满足 ZDR、拒绝数据收集与参数支持过滤器的 provider endpoint 间故障转移；401/402/403、ZDR 不可用和坏请求不会由应用重试。重试上限耗尽后返回稳定供应商错误，生成/评分额度 reservation 释放，用户可稍后重新提交。

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
| `AI_INTERNAL_TOKEN` | 0041–0043 发布必需 | **最高机密** | 独立 32-byte hex；部署只经 SSH stdin 原子写入 API/AI 两个 mode-600 env，不回显。 |
| `REDIS_PASSWORD` | 0039–0040 第一阶段发布必需 | **最高机密** | GitHub `production` environment secret；独立 32-byte hex，经 SSH stdin 写入服务器 mode-600 `.redis.env` 和 API `REDIS_URL`，不打印。 |
| `RATE_LIMIT_HMAC_SECRET` | 0039–0040 第一阶段发布必需 | **最高机密** | GitHub `production` environment secret；独立 32-byte hex，经 SSH stdin 原子安装；不得等于 Redis password。 |
| `PUBLIC_ORIGIN` | workflow 非秘密 env | 公开配置 | 公网 smoke 的规范 origin；API 分享 URL 仍从服务器 `.env` 读取，二者必须一致。 |

服务器 `/opt/nalanda/.env` 至少需要 Supabase、`REDIS_URL` 与 HMAC secret；`/opt/nalanda/.redis.env` 只含 Redis password，不能得到 Supabase/Azure/OpenRouter/HMAC。两文件均 mode 600。CI 不下载它们；安装脚本保留其它 API 行、原子替换本域变量且 stdout 不含 secret。API image Git SHA 位于非秘密 `.deploy.env`。

## 7. Supabase RLS E2E 变量

消费者：`apps/web/tests/rls.e2e.test.ts`。这些变量只允许指向可销毁的专用测试项目；默认 `pnpm test` 不启用外部 E2E。

| 变量 | 状态 | 敏感级别 | 用途与保护 |
|---|---|---|---|
| `RUN_SUPABASE_RLS_E2E` | 显式开关 | 公开配置 | 必须为 `1` 才运行；`pnpm test:rls` 会设置。 |
| `SUPABASE_URL` | E2E 必需 | 公开配置 | 专用测试项目 URL，不得为生产。 |
| `SUPABASE_ANON_KEY` | E2E 必需 | 公开凭据 | 以用户 A/B 登录并验证 RLS。 |
| `SUPABASE_SERVICE_ROLE_KEY` | E2E 必需 | **最高机密** | 创建/删除测试用户和清理 Storage；只注入 Node 测试进程。 |
| `SUPABASE_RLS_E2E_CONFIRM_REF` | E2E 必需 | 项目标识 | 必须与 URL hostname 的 project ref 精确相等，作为防误操作二次确认。 |
| `RUN_REDIS_E2E` | 真实 Redis 集成开关 | 公开配置 | 必须为 `true` 才运行 Lua 原子窗口/过期/token lock 测试；普通本地 `pnpm test` 可跳过，CI 必须启用。 |
| `REDIS_URL`, `RATE_LIMIT_HMAC_SECRET` | Redis E2E 必需 | 本地测试 secret | 只能指向测试 Redis DB；CI 使用 localhost 独立 DB 与固定非生产 HMAC。 |

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
| `ANTHROPIC_API_KEY` | 历史变量；当前业务不读取 | **最高机密** | 不应再配置；迁移完成后删除旧 secret。 |
| `STRIPE_SECRET_KEY` | 目标占位 | **最高机密** | 当前无支付模块、无消费者。 |
| `STRIPE_WEBHOOK_SECRET` | 目标占位 | **最高机密** | 当前无 webhook endpoint、无消费者；Caddy 注释不是接口实现。 |
| `REDIS_URL` | API 限流/health/scanner 已读取 | 内部配置 | hybrid 示例无密码且不满足生产基线；若复用必须补密码与独立 HMAC。BullMQ 仍未接入。 |
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
| 当前生产/Materials AI | 已编译在 `/opt/nalanda/web` 静态包 | `/opt/nalanda/.env` + 隔离的 `/opt/nalanda/.redis.env` + `/opt/nalanda/.ai.env`。均 `0600`，AI env 无 service-role/Redis | 仅维护窗口临时注入，不落日志 |
| hybrid 目标 | 构建 Web 时另行注入 `VITE_*` | `infra/hybrid-2g/.env` | 仅维护窗口临时注入 |

## 10. 新增变量检查清单

1. 明确消费者、阶段（build/runtime/operation）、默认行为和是否必需。
2. 判断是否会进入浏览器；任何高权限凭据都禁止进入客户端。
3. 更新对应 `.env.example`，只写占位值。
4. 更新本矩阵、[本地开发手册](./LOCAL_DEVELOPMENT.md)和[密钥轮换](../operations/SECRET_ROTATION.md)。
5. 为缺失/无效配置增加启动校验或明确错误；Supabase 与 Redis health 必须实际探测，不能把变量存在当 readiness。
6. 更新 CI/compose 后验证变量确实被目标进程读取，避免“配置存在但代码未使用”。
7. 若变量被移除，先确认生产、GitHub、个人环境和历史部署均不再依赖，再撤销对应秘密。
