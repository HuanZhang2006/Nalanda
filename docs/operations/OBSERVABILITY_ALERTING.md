# 可观测性、监控与告警

> **本文内容：** 说明当前可用的健康检查和日志，定义目标 SLI/SLO、告警阈值、日志/指标规范，以及 API、nginx、Supabase、资源和部署故障的排障步骤。  
> **作用：** 让团队能主动发现故障、快速判断故障层、保护用户数据，并用一致证据完成响应和复盘。  
> **何时更新：** 服务拓扑、endpoint、日志/指标平台、SLO、告警阈值、值班/升级路径、第三方依赖、部署或事故模式变化时；每次 P1/P2 事故后复核。

## 1. 当前状态

当前已有信号：

- `GET /api/health`：API 进程存活，并真实探测 Supabase JWKS 与 PostgREST profiles 空查询；Redis/AI 仍只报告 `configured/unset`；
- `GET /health`：AI 进程存活和 Anthropic key 是否存在；AI 当前未部署在生产编排中；
- deploy workflow 同时验证本机与公网 `/api/health` 的 JSON `status/service/deps.supabase`，并检查公网 Web root；失败会回退上一 Web/API release；
- API 用 NestJS/console 写容器 stdout/stderr，可由 `docker compose --env-file .deploy.env logs` 查看；
- nginx access/error log、systemd、Docker 与主机资源命令；
- GitHub Actions deploy 运行结果；
- Supabase 控制台可提供平台侧 Auth/数据库/Storage 日志与指标，具体可用项取决于项目配置。
- Courses 举报达到配置阈值时 API 输出单行 JSON `event=course_report_threshold`；speech 配额/估算成本持久在 `learning_speech_usage`，429 使用稳定 `SPEECH_QUOTA_EXCEEDED`；这些当前仍需日志/SQL 人工查看，不是完整告警链。
- 0015 应用已输出脱敏单行 JSON：`learning_session_snapshot`、`learning_attempt_committed`、`learning_attempt_revision_conflict`、`learning_audio_pending`、`learning_audio_storage_hit/missing`、`learning_audio_generated/cache_recovered/generation_failed/worker_failed`，包含 duration、revision、cache key、queue wait、attempt、bytes/error code 等有限字段；claim/数据库故障会短暂退避，尚未接入集中采集/告警。
- 翻译前测输出脱敏 `learning_spelling_translation_assessed` 事件，只含 provider/model、duration、correct 和 prompt/completion token 计量；规范化完全匹配记录 `nalanda-normalized-exact/normalized-exact-v1` 与零 token，真实 OpenRouter 调用单独统计。0027 后应分别监控 `quota_counted=true` 的实际 provider 请求、分钟/滚动 24 小时 429 和 `retryAfterSeconds`，不能把 exact/replay/仅领取租约计入用量。HTTP 200 缺失合法 boolean 时另输出不含内容的 `learning_spelling_translation_provider_retry`。这些事件都不得写 API key、用户输入、课程翻译、完整 prompt 或供应商响应。

当前缺失：

- 外部持续探测、SLO 仪表盘、集中日志、结构化 request log、trace、metrics endpoint；
- error tracking、pager/值班表、告警路由和告警演练；
- `/api/health` 尚不检查 Storage、注册写入、完整 RLS、Redis 或 AI 的连通性；
- Web 前端异常和浏览器直连 Supabase 失败没有服务端集中信号；
- 日常备份新鲜度、RLS/数据完整性、TLS 到期、成本、AI 质量和支付对账告警；迁移前加密恢复点已有 CI 门禁，但没有持续告警。
- Courses route/阶段/恢复成功率、浏览器 outbox 深度、陈旧 active session、复习日程积压、课程 points/徽章异常、举报队列以及 Azure/OpenRouter latency/error/cost 尚无集中指标；结构化事件只是原始信号，`/api/health` 也不探测 learning schema、音频队列/Storage 或任一供应商。

所以“deploy health ok”已证明 API→Supabase JWKS/PostgREST 基本连通，但仍不证明 Storage、浏览器直连、注册/登录写路径或核心业务全部健康。

## 2. 服务与信号地图

| 层 | 当前运行 | 可用信号 | 主要盲区 |
|---|---|---|---|
| DNS/TLS/nginx | 是 | 外部 curl、nginx logs、证书工具 | 无持续 probe/到期告警 |
| Web 静态站 | 是 | nginx status/access、浏览器人工检查 | 无 RUM/JS error/performance |
| NestJS API | 是 | `/api/health`、container logs | 无 latency/status metrics/request ID |
| Supabase Auth | 是 | API health 的 JWKS 探针、平台日志、注册错误 | 登录由浏览器直连；health 不执行真实登录 |
| Supabase Postgres/PostgREST | 是 | API health 的 profiles 空查询、平台指标/日志 | 无应用级业务 query/error dashboard |
| Supabase Storage | 是 | 平台日志、业务人工检查 | 无对象完整性/孤儿/容量告警 |
| FastAPI AI | 仅桩；生产未启用 | `/health`、uvicorn log | 真实模型、质量、成本均未接入 |
| Courses API | 生产已启用至 0028 | 稳定 API error code、DB facts、attempt/snapshot duration JSON event | 无集中 route/阶段/outbox/恢复/考试/熟练度/拼写归一化或标点容错分支指标；health 不查 learning schema |
| Azure Speech | 生产已启用（Japan East），持久队列已开放 | provider error code、speech usage reservation、queue wait/generate/storage-hit JSON event、熔断 flag、发布前真实 gate | 无持续 latency/可用率/队列/账单对账告警；录音不得进日志 |
| OpenRouter 翻译前测 | 生产已启用 | structured provider error、assessment duration/decision/token JSON event、数据库租约/配额、发布真实 gate | 无持续准确率/延迟/额度/价格对账；用户输入不得进日志 |
| Course Market | 生产已启用（免费） | publication/report/action 表、阈值 JSON log | 无审核工作台、pager 或举报 SLA |
| Redis/BullMQ | 未接入当前业务 | hybrid compose 有目标配置 | 无队列/worker 指标 |
| Stripe/支付 | 未实现 | 无 | 上线前必须补 webhook/对账告警 |
| 备份 | 迁移前加密恢复点 | Actions artifact/manifest | 无每日备份、Storage bytes、年龄/可恢复性告警 |

## 3. 目标 SLI/SLO（待批准）

以下是启动监控工作的**建议基线**，不是当前 SLA。产品和工程 owner 必须根据真实流量、支持能力和成本确认。

| 用户能力 | SLI | 建议目标/窗口 |
|---|---|---|
| 站点可访问 | 外部 HTTPS 请求成功率 | 99.9% / 30 天 |
| API 可用 | `/api/health` 外部 2xx | 99.9% / 30 天 |
| API 响应 | API p95 latency | < 500 ms / 5 分钟（health < 300 ms） |
| 注册 | 有效注册请求成功率 | ≥ 99% / 1 小时；排除明确用户输入错误 |
| 登录/鉴权 | Supabase 登录 + `/api/me` 合成路径成功率 | ≥ 99% / 15 分钟 |
| 数据读写 | 隔离 smoke 账号 PostgREST 读写成功率 | ≥ 99.5% / 15 分钟 |
| 私有资料 | upload + signed URL + download 合成成功率 | ≥ 99% / 1 小时，使用小型无敏感 fixture |
| 备份 | 最近一次已验证恢复点年龄 | 数据库 < 24 小时；目标 PITR 指标按 RPO |
| 数据保护 | 跨用户 RLS 拒绝率 | 测试应 100% 拒绝；任何成功为 P1 |
| Courses 持久化 | 创建/答题/恢复成功率（排除合法 4xx） | ≥99% / 15 分钟；相同意图必须恢复同一 active session，不同单元/模式不得串线 |
| 发音合成 | Azure worker 成功率/生成延迟、Storage/browser cache hit | ≥98% / 1 小时；ready 缓存播放 p95<300 ms，队列等待按 3.1 秒限流可解释；失败可降级，不计文本课程不可用 |
| 弱网答题 | provisional→服务器确认时延、outbox 年龄/冲突率 | 即时反馈 p95<一帧；在线确认 p95<1 秒；最旧 outbox >5 分钟或冲突率异常需调查 |
| 朗读评分 | 有效 WAV provider 成功率 | ≥97% / 1 小时；供应商失败不写错误次数 |
| 翻译语义前测 | 有效请求 provider 成功率、结构化输出率、用户重试率 | provider 成功率 ≥97% / 1 小时、schema 有效率 100%；p95 <3 秒为观测目标；供应商失败不得写错误次数 |
| 复习日程 | 到期 pending 项进入/完成成功率 | ≥99%；不允许误建 `study_tasks` 或 +5 |

避免合成监控污染真实指标：使用专用账号/课程/文件前缀，测试后清理，并防止触发积分、通知和社区公开内容。生产合成写测试在具备幂等清理前不得自动开启。

## 4. 告警分级与建议阈值

| 级别 | 条件（建议初始值） | 响应目标 | 示例 |
|---|---|---|---|
| P1 | 全站/API 外部连续 3 次失败；疑似跨用户数据访问；数据破坏；支付重复扣款（未来） | 5 分钟确认，立即处置 | nginx/API 宕机、RLS 绕过、生产密钥泄露 |
| P2 | API 5xx > 5% 持续 10 分钟；注册/登录失败率 > 10%；磁盘 > 90%；备份超过 2×RPO | 30 分钟确认 | Supabase 部分故障、容器重启循环、备份中断 |
| P3 | p95 超阈值 30 分钟；磁盘 > 80%；TLS < 21 天；错误趋势异常 | 1 个工作日处理 | 性能退化、证书或容量预警 |
| 信息 | deploy 成功/失败、密钥轮换、恢复演练结果 | 记录/按失败升级 | 发布审计 |

建议告警规则：

- 外部站点 `/` 与 `/api/health` 每分钟探测，失败从两个网络位置复核；
- API container restart count 增加或 10 分钟内重启 ≥ 3 次：P2；
- nginx 5xx > 2% 持续 10 分钟：P2，>20% 持续 5 分钟：P1；
- 主机可用内存 < 100 MiB 持续 10 分钟：P2；磁盘 > 80% P3，> 90% P2；
- TLS 剩余 < 21 天 P3，< 7 天 P2，< 48 小时 P1；
- Supabase 数据库容量/连接/CPU 达平台警戒阈值：P2；阈值需按实际套餐配置；
- 最近数据库备份/恢复点 > 24 小时：P2；季度恢复演练逾期：P3；
- CI deploy 失败：P2；发布后外部 probe 失败：P1/P2 视影响；
- 任意安全回归测试发现 RLS 越权、service-role 泄露或高权限 RPC 可由普通用户执行：P1。
- Courses progress/badge/points 可由客户端写、匿名 PostgREST 读到分享/市场私有表、已撤销 token 仍可克隆或 publication 内容可改：P1；
- Azure 估算月预算 ≥80%：P3，≥95%：P2 并评估熔断，超预算/持续 429：P2；provider 5xx/timeout >10% 持续 10 分钟：P2 并打开语音 circuit，文本学习保持；
- OpenRouter provider 5xx/timeout/invalid-structure 合计 >10% 持续 10 分钟或 token/请求量异常超过 2 倍基线：P2，关闭 `FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED`，普通/限时拼写保持；语义错误率突然偏离固定 eval baseline：P2/P3，先停 feature 而不是放宽模型判定。429 若来自产品用户配额按信息/滥用调查，若来自供应商账户额度按 P2；
- `learning_audio_assets` 最旧 pending 超过 15 分钟、processing lease 过期持续 5 分钟、generation failure >10% 或 ready metadata 对象 miss >1%：P2；minute/month quota 暂停按预算阈值分级，不通过提高并发绕过；
- `learning_attempt_revision_conflict` 突增、同 session outbox 最旧项 >5 分钟或 replay 比例异常升高：P2/P3；先查网络/API/多设备，不手工推进 cursor；
- 同一课程完成指纹出现多条正向 +20、复习 schedule 产生 task +5、badge 重复 PK/事实不一致：P1/P2 按经济影响；
- Course 举报达到 `COURSE_REPORT_ALERT_THRESHOLD`：信息/审核队列；24 小时无人处理升级 P3。数量本身不自动下架。

所有阈值先观察两周基线再调优，保留变更记录。告警必须指向本页具体 runbook，且需要定期发送测试告警验证路由。

## 5. 当前可执行检查

### 5.1 外部检查

```bash
curl -fsS --max-time 10 https://nalanda.online/api/health
curl -fsSI --max-time 10 https://nalanda.online/
```

API health 中 `deps.supabase = ok` 表示 JWKS 与 PostgREST 空查询在超时内成功；`redis/ai = configured` 仍只表示变量非空。不能把该 endpoint 当作 Storage、RLS、登录或 AI 完整 readiness。

TLS 检查：

```bash
echo | openssl s_client -servername nalanda.online -connect nalanda.online:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

### 5.2 服务器检查

```bash
cd /opt/nalanda
docker compose --env-file .deploy.env ps
docker compose --env-file .deploy.env logs --since=30m --tail=300 api
curl -fsS --max-time 5 http://127.0.0.1:8411/api/health
docker stats --no-stream
df -h
free -m
```

nginx：

```bash
nginx -t
systemctl status nginx --no-pager
tail -n 200 /var/log/nginx/error.log
```

这些命令可能需要服务器管理员权限。不要把 `.env`、完整 request header、JWT 或密钥输出到协作频道/工单。

### 5.3 快速分层判断

| 现象 | 最可能层 | 下一步 |
|---|---|---|
| 外部 `/` 和 `/api/health` 都失败；服务器不可 SSH | 主机/网络/DNS | 主机供应商、DNS、端口和资源状态 |
| 外部失败；本机 `127.0.0.1:8411` 正常 | nginx/TLS/DNS | `nginx -t`、error log、证书、server_name/反代 |
| 外部和本机 API 都失败 | container/API | compose ps/logs、restart count、内存、镜像/`.env` |
| API health 200，但注册失败 | Supabase Auth、service-role、DNS | API logs、变量是否为同一项目、Supabase Auth 日志 |
| API health 200，但登录/业务查询失败 | 浏览器→Supabase、JWT、RLS、迁移 | Supabase logs、项目 URL、JWKS、RLS/表结构、前端 console |
| 只上传/预览失败 | Storage policy/对象/签名 URL | bucket、路径首段、对象 policy、过期时间、浏览器错误 |
| 发布后静态页面旧、API 新 | artifact/nginx cache/上传 | `/opt/nalanda/web` mtime、workflow artifact、浏览器 cache |
| Courses 统一 disabled/404 | flag/circuit 配置漂移或 release 回退 | 先查 production history、当前 image 与服务器 `.env`；不要开放客户端 RPC/表写 |
| 课程可学但无发音/评分 | Azure flag/key/region/circuit/预算 | 按 error code 和 speech usage 判断；保持浏览器朗读降级 |
| 翻译前测统一失败/很慢 | OpenRouter flag/key/model/timeout/额度或结构化输出 | 按稳定 error code 与脱敏 duration/token event 分层；供应商失败不记错，可先关闭翻译前测，不能把 key 下发浏览器或改为客户端自判 |
| 刷新后会话丢失/重复 | active unique/session RPC/API | 查同 user/course active 行、state queue/cursor、API 5xx；禁止前端造 progress |
| 课程进度或 +20 异常 | progress/growth/fingerprint | 分路径对账：review 检查 attempts/三组日期，exam 检查第一轮分数、`examPassed`、轮末确认和 completed session；再核对 `learned_at`、point business_key 与 source，必要时暂停 Courses 奖励写入 |
| Course Market 课程消失 | publication status/审核 | 查 moderation actions 和管理员配置；不要仅凭举报数恢复/下架 |

## 6. 事故 runbook

### 6.1 API 不可用

1. 从外部复现并记录 UTC 时间/状态码，不发送真实用户 token。
2. 在服务器检查 compose 状态、最近日志、资源和本地 health。
3. 若容器停止，先保存日志和退出原因，再执行 `docker compose --env-file .deploy.env up -d`；不要无限重启掩盖 OOM/配置错误或绕过 Git SHA image。
4. 若最近刚部署，核对 workflow、镜像 build 和环境文件；当前没有可靠上一镜像，谨慎声明“回滚”。
5. 恢复后从外部验证 health、登录和本次影响路径，持续观察。

### 6.2 注册/鉴权大面积失败

1. 区分注册 endpoint、浏览器 Supabase 登录和 `/api/me` 三段。
2. 检查 Supabase 项目状态、Auth 日志与 JWKS 可达性。
3. 核对 Web 的 `VITE_*` 与 API `SUPABASE_URL` 是否指向同一项目。
4. 检查最近 signing key/service-role/anon key 轮换，按[密钥轮换](./SECRET_ROTATION.md)验证双端更新。
5. 不要通过关闭 RLS、使用 service-role 进浏览器或跳过 JWT 验签来恢复服务。

### 6.3 数据异常/疑似越权

1. 立即按 P1 处理，限制相关写入口，保留 Supabase/应用/部署日志。
2. 确定表、用户、时间窗和是否涉及 service-role/RPC；不要在日志中传播个人数据。
3. 验证 migrations、RLS、grants 与函数 EXECUTE 是否漂移。
4. 若已造成破坏，按[备份与恢复](./BACKUP_RECOVERY.md)先恢复到隔离项目评估。
5. 轮换可能泄露的秘密并完成通知/合规评估。

### 6.4 主机资源紧张

1. `docker stats --no-stream`、`free -m`、`df -h` 定位内存/磁盘。
2. 检查日志、上传 artifact、Docker layers 占用；保留事故证据后再清理。
3. 不要删除 `/opt/nalanda/.env`、有效 Web artifact、未知数据库备份或证书。
4. 当前生产只有 API 容器，Redis/AI 不应被误判为当前生产资源来源。

### 6.5 Courses / Azure / Course Market

1. 先按总开关→分享/市场/音频预热/语音子开关缩小影响面；优先关闭 `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED` 停止新预热，必要时再开 speech circuit。关闭语音不会阻断文本学习，关闭市场不会删除私有课程。
2. 使用 request 时间、稳定 `code`、脱敏 user ID hash、course/session ID 定位；不得记录 token、词表正文、翻译、WAV、音素原始响应或 Azure key。
3. Azure 异常先比较 queue wait、quota reservation、provider duration、Storage hit/miss。确认 provider/预算问题后打开 `AZURE_SPEECH_CIRCUIT_OPEN=true` 并重启 API；验证浏览器朗读降级和 attempt/wrong_count 未因供应商失败增加。不要把 Storage 网络错误当对象 miss 触发重复生成。
4. 成长异常先关闭 Courses 总开关或相关 release，查询同一 `learning-course-completed:<user>:<fingerprint>` 的 entries/state；不得删除账本或手改 Profile 投影。
5. 举报只触发人工核查。紧急隐藏必须由配置管理员走 API，填写原因并确认 moderation action；恢复同样留痕。
6. answer 同步异常按 `sessionId + revision + attemptId` 对账 append-only fact/response snapshot；重复 UUID 不应增加 wrong_count，409 后客户端只能用最新 snapshot 重放仍匹配题目。不得直接改 session state。
7. 修复后依次验证 owner、会话 snapshot、outbox 重放、音频 manifest/Storage hit、日程、points 幂等、撤销分享和市场克隆；记录 flags 变更、影响窗口和补偿决定。

## 7. 日志规范（目标）

API/AI 后续应输出单行结构化 JSON：

| 字段 | 说明 |
|---|---|
| `timestamp`, `level`, `service`, `environment`, `version` | 基本上下文 |
| `request_id`, `trace_id` | 跨 nginx/API/AI 关联；由入口生成/透传 |
| `method`, `route_template`, `status_code`, `duration_ms` | HTTP 指标来源，route 使用模板避免高基数 |
| `user_id_hash` | 必要时用不可逆/按环境盐化标识，不记录邮箱 |
| `error_code`, `exception_type` | 稳定错误分类，不直接记录输入正文 |
| `dependency`, `dependency_status`, `retry_count` | Supabase/AI/Redis/Stripe（未来） |

禁止记录：password、Authorization/cookie、Supabase access/refresh token、service-role/JWT secret、Anthropic/Stripe key、数据库连接串、签名 URL、完整课件/笔记/反馈正文、支付卡数据。对 email、文件名、IP 和 user agent 设定用途、采样与保留期。

Courses 另禁止记录：分享明文 token/token hash、完整词表/翻译、用户 WAV、Azure 原始识别 payload。可记录 route template、稳定 error code、哈希用户、course/session UUID、stage、字节/时长、provider latency、聚合 score 和估算 micro-USD；音素内容只有用户请求内返回和受限学习事实需要时才保存。

## 8. 目标仪表盘

最低应有：

1. **用户入口**：站点/API availability、latency、HTTP status、地域探测、TLS/DNS。
2. **API**：RPS、p50/p95/p99、5xx、route/error code、restarts、CPU/memory。
3. **Supabase**：Auth 成败、PostgREST 错误/延迟、DB 连接/CPU/storage、慢查询、Storage 错误/容量。
4. **业务**：注册/活跃用户、资料上传成功率、任务完成、社区写入；只用聚合数据。
5. **Courses**：创建/保存、snapshot p50/p95、attempt commit p50/p95、revision conflict/replay、浏览器 outbox 年龄、候补轮次、复习/熟练/错误、+20 指纹与徽章；避免 term 高基数标签。
6. **Speech/Market**：queue depth/oldest wait/lease retry、Azure generation p95、Storage/browser cache hit、ready-object miss、429/熔断、字符/估算/实际账单差异、评分 p95；publication/clone/report/action 与处理年龄。
7. **数据保护**：备份年龄/大小/校验、恢复演练、RLS 安全测试、异常函数权限。
8. **发布**：Git SHA、deploy 时间、失败、变更前后错误率。
9. **AI（启用后）**：队列深度/等待、任务成功/重试/超时、token/费用、模型/提示词版本、schema 合格率与质量评测。
10. **支付（启用后）**：webhook 延迟/失败/重放、订单与 Stripe 对账差异、退款、账本不平。

## 9. 值班与升级路径

当前仓库没有指定 owner 或 pager。上线持续告警前必须在团队系统中填写：

```text
Primary engineering on-call:
Secondary / incident commander:
Supabase owner:
Server/nginx owner:
Security/privacy contact:
Product/customer communication owner:
Status page / incident channel:
Supplier support contacts:
```

P1 必须指定 incident commander、固定更新节奏并保留时间线；P2 要有 owner 和截止时间；P3 进入可追踪 backlog。恢复后 2 个工作日内完成 P1/P2 复盘，动作必须有 owner/期限/验证方式。

## 10. 上线门禁

- 外部探测和至少一个通知渠道已验证；
- API 结构化日志/错误追踪不泄密；
- 关键告警有 runbook、owner、去重和恢复通知；
- staging 人工触发过测试告警；
- `/api/health` 拆分 liveness/readiness，readiness 真正检查必要依赖且有超时；
- 备份年龄与恢复演练已告警；
- 新 AI/支付/审核模块的质量、成本、队列、账本告警在生产流量前完成。
- Courses 私有 beta 前至少有 route/error、DB 容量、成长幂等和复习积压信号；真实 Azure 前有成本/429/provider 告警与一键 circuit；分享/市场前有举报阈值路由和管理员动作审计。
