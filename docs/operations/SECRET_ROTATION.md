# 密钥与凭据轮换

> **本文内容：** 汇总 Nalanda 当前和目标中的 secrets，给出 Supabase、GitHub/SSH、数据库、Anthropic、Stripe、TLS 等凭据的计划轮换和紧急泄露处置步骤。  
> **作用：** 在不中断或最小化中断的前提下更新凭据、缩短泄露窗口，并确保旧凭据真正撤销且所有消费者一致切换。  
> **何时更新：** 新增/移除供应商或 secret、key 类型/消费者/存储位置改变、轮换周期或人员权限变化时；每次泄露、轮换失败或安全复盘后必须更新。

## 1. 当前原则与边界

- secret 不得进入 Git、Markdown、issue、日志、截图、浏览器包或聊天记录。
- `VITE_*` 会编译进浏览器静态文件，只能放公开配置/anon key，绝不能放 service-role、JWT secret 或供应商 secret。
- 轮换必须包含四步：**创建/启用新凭据 → 更新全部消费者 → 验证 → 撤销旧凭据**。
- 若凭据已确认泄露，优先撤销和控制影响；不能为了“可回退”继续保留旧泄露 key。
- 供应商控制台流程和 key 类型可能变化。操作前在当前控制台确认是否支持双 key/重叠期、对 session/webhook 的影响和审计记录。
- 当前没有 secret manager、自动到期、轮换日历或凭据使用审计的仓库实现；`/opt/nalanda/.env` 是服务器本地文件，CI 不更新它。

## 2. 凭据清单

| 凭据 | 当前存储/注入 | 当前消费者 | 客户端可见 | 状态 |
|---|---|---|---|---|
| `VITE_SUPABASE_ANON_KEY` | Web `.env.local` / GitHub Actions Secret | 浏览器 Supabase client | 是 | 当前使用 |
| `SUPABASE_SERVICE_ROLE_KEY` | API `.env` / `/opt/nalanda/.env` | 注册、readiness、Courses PostgREST/Storage/事务 RPC | **否** | 当前使用，最高权限 |
| `SUPABASE_JWT_SECRET` | API `.env` | 旧 HS256 验签回退 | 否 | 可选；非对称项目通常不需 |
| Supabase JWT signing keys/JWKS | Supabase 管理 | Supabase 签发；API JWKS 验签 | 公钥可见 | 当前使用 |
| `SUPABASE_ACCESS_TOKEN` | `production-database` environment / 安全存储 | Supabase CLI 发布；旧脚本应急 | 否 | 当前 CI 使用 |
| `SUPABASE_DB_PASSWORD` / 恢复连接串 | protected environment / 运维 secret | dry-run、dump、push、lint、隔离恢复 | 否 | 当前 CI/恢复使用；应用未读取 |
| `DB_BACKUP_ENCRYPTION_KEY` | protected environment + 离线恢复保管 | 加密/验证 migration 前 archive | 否 | 当前 CI 使用，必须有离线副本 |
| `SERVER_SSH_KEY` | GitHub Actions Secret | deploy workflow SSH/scp | 否 | 当前使用 |
| `SERVER_SSH_KNOWN_HOSTS` | GitHub Actions Secret | 固定服务器 host identity | 公钥材料 | 当前使用，变更需线下核验 |
| 服务器 SSH authorized key | 服务器 | 接受 CI/管理员连接 | 公钥 | 当前使用 |
| GitHub 账号/token | GitHub | 仓库与 Actions 管理 | 否 | 平台管理，未写入仓库 |
| `ANTHROPIC_API_KEY` | hybrid `.env` 目标 | AI health；未来模型调用 | 否 | 当前业务未使用 |
| `AZURE_SPEECH_KEY` | API `.env` / 生产 `/opt/nalanda/.env` | Courses 持久 TTS worker 与 pronunciation assessment | 否 | 生产当前使用；基础 Japan East gate 已通过，队列增量待独立发布 gate |
| `COURSE_MARKET_ADMIN_USER_IDS` | API `.env` | Course Market 审核授权 | 否 | 敏感授权配置，不是 secret，但变更按权限轮换审计 |
| `STRIPE_SECRET_KEY` | hybrid `.env` 目标 | 未来支付服务 | 否 | 未实现 |
| `STRIPE_WEBHOOK_SECRET` | hybrid `.env` 目标 | 未来 webhook 验签 | 否 | endpoint 未实现 |
| TLS private key / ACME account | 生产 certbot/nginx | HTTPS | 否 | 当前由服务器维护 |

完整变量消费者见 [环境变量矩阵](../guides/ENVIRONMENT_VARIABLES.md)。项目 URL、Project Ref、域名、`SERVER_HOST`/`SERVER_USER` 不是密码，但仍应限制修改权限并纳入配置变更审计。

## 3. 计划轮换通用步骤

### 3.1 变更前

- 建立 ticket：凭据、环境、原因、owner/reviewer、窗口、消费者、验证与旧 key 撤销时间。
- 从代码、GitHub、服务器、供应商和运维脚本确认所有消费者；不要只查 `.env.example`。
- 确认供应商是否允许双 key；若不允许，安排维护窗口和明确影响。
- 创建发布前数据库恢复点；密钥轮换不应改变业务数据，但错误项目/权限可能导致写入故障。
- 准备外部 health、登录、`/api/me`、注册/Storage 等最小验证。
- 通知值班人，冻结无关部署。

### 3.2 切换

1. 创建或启用新 key，记录 key ID/末尾指纹和 UTC 时间，绝不记录完整值。
2. 先更新后端/内部消费者，再更新需要重建的 Web；或按供应商兼容窗口调整顺序。
3. 重启/重建消费者，确认进程实际加载新值。
4. 运行功能验证和供应商侧 usage/audit 检查。
5. 在重叠窗口内观察错误率。
6. 撤销旧 key，并再验证一次；记录撤销证据。

### 3.3 失败处理

- 计划轮换且旧 key 未泄露：在旧 key 仍有效的短重叠窗口内可恢复旧消费者，修正后再切换。
- 已泄露：不得恢复旧 key；回退应用配置也必须继续使用新 key，必要时暂停受影响功能。
- 如果误把 secret 打进 Web/Git/日志，单纯删除文件无效：立即轮换，清理可访问 artifact/log，评估 Git 历史和访问范围。

## 4. Supabase anon/publishable key

当前变量名是 anon key，值会进入 Web artifact；它不是 service-role，但仍需配合正确 RLS。供应商若迁移到新的 publishable/secret key 类型，应先确认 SDK 兼容并更新变量命名文档。

轮换步骤：

1. 在 Supabase 当前控制台创建/轮换客户端可用 key，确认对旧 key 的重叠支持。
2. 更新开发环境 `apps/web/.env.local`（个人环境由各开发者自行更新）。
3. 更新 GitHub Actions Secret `VITE_SUPABASE_ANON_KEY`。
4. 手动触发 `.github/workflows/deploy.yml` 或发布含相同变更的 commit，重建 Web；只改 GitHub Secret 不会改变已部署静态 JS。
5. 验证站点加载、登录、各 RLS 数据读取、资料 signed URL 和写入。
6. 搜索 nginx 访问错误和 Supabase Auth/PostgREST/Storage 错误。
7. 撤销旧客户端 key；清浏览器 cache/旧 artifact 后再次验证。

若 anon key 与旧式 JWT secret/service-role key 由同一 signing secret 派生，不能按普通独立 API key 假设轮换；必须遵循 Supabase 当前项目的协调轮换流程，并评估 session 失效。

## 5. Supabase service-role key

这是当前风险最高的应用 secret，可绕过 RLS。任何疑似泄露都按 P1。

计划轮换：

1. 确认 key 类型、双 key 能力及是否会联动 anon/JWT signing key。
2. 生成/启用新 service-role/secret key。
3. 在服务器安全编辑 `/opt/nalanda/.env` 的 `SUPABASE_SERVICE_ROLE_KEY`，保持 `chmod 600 /opt/nalanda/.env`。
4. 重建 API 容器环境：

   ```bash
   cd /opt/nalanda
   docker compose --env-file .deploy.env up -d --force-recreate api
   docker compose --env-file .deploy.env ps
   docker compose --env-file .deploy.env logs --since=5m --tail=100 api
   ```

5. `/api/health` 只能验证 key/基础连通。继续用受控临时账号测试注册、登录、`/api/me`，并在 Courses beta 环境创建/读取/删除一门四词课程，确认 service-only RPC 和 `vocabulary-audio`（若语音已开）正常；随后删除账号和级联数据。
6. 确认 Supabase audit/usage 显示新 key，撤销旧 key，再重复注册链路最小验证。

当前 CI 不传这个 key，也不更新服务器 `.env`；不要把它新增为 Docker build arg 或 `VITE_*`。

## 6. Supabase JWT signing keys / `SUPABASE_JWT_SECRET`

当前 guard 优先使用项目 JWKS 校验 ES256/RS256，并缓存 remote JWK set；旧 HS256 才回退 `SUPABASE_JWT_SECRET`。

1. 先检查真实用户 token header 的 `alg`/`kid`（不记录完整 token），确认项目使用哪条路径。
2. 按 Supabase 当前 signing key 轮换功能创建新 key；若支持 staged activation，先确保 JWKS 同时包含验证所需公钥。
3. 激活后重启 API 以清空进程内 JWKS 状态，并用**新登录获取的 token**验证 `/api/me`。
4. 验证仍在供应商声明兼容期内的旧 session；记录何时预期失效。
5. 旧 HS256 项目若改变 JWT secret，同步更新 `/opt/nalanda/.env` 的 `SUPABASE_JWT_SECRET`，重建 API，并评估 anon/service-role key 和所有现有 session 是否同时失效。
6. 确认 Web/API 指向同一 Supabase URL，撤销旧 signing key 后再验证。

不要通过跳过 issuer/audience、接受任意算法或关闭 guard 来缓解轮换问题。

## 7. Supabase Personal Access Token

`SUPABASE_ACCESS_TOKEN` 供受保护 CI 的 Supabase CLI 发布以及旧脚本应急使用，不是用户 access token，也不应放在 `/opt/nalanda/.env`。

1. 使用专用、最小权限的运维身份创建新 token。
2. 更新 `production-database` environment Secret；`main` branch restriction 不得取消。若套餐支持 required reviewer，该门禁也不得取消；当前套餐不支持时，必须保存数据库 owner 的人工复核记录后才能手动发布。
3. 用**开发或 staging Project Ref**运行 `migration list`/dry-run，确认 token 权限；不得把生产作为试验目标。
4. 撤销旧 token，检查近期 Management API 活动。
5. 若持有人离职、设备丢失或 token 进日志，立即撤销并审计其可访问的全部 Supabase 项目。

旧脚本已移除默认 Project Ref；轮换测试和每次执行仍必须显式设置 `SUPABASE_PROJECT_REF`。生产 Ref 还会与 `VITE_SUPABASE_URL` 交叉核对。

## 8. PostgreSQL 密码/连接串

当前应用不读取数据库密码；它由受保护 CI 用于 dry-run、加密恢复点、push/lint，也用于隔离恢复。

1. 确认所有 dump、BI、管理员和自动化消费者。
2. 在 Supabase 当前控制台轮换数据库密码/创建新最小权限角色。
3. 更新 `SUPABASE_DB_PASSWORD`、恢复工具/secret manager；不要写进 shell history。
4. 在 staging 执行 dry-run、完整加密 dump 和 `restore-db-release.sh verify`，并至少完成一次隔离恢复。
5. 撤销旧角色/密码并检查连接失败与异常来源。

未来 API 若直连 Postgres，应使用独立最小权限应用角色和连接池配置，不能复用 owner/备份凭据。

## 9. GitHub Actions 部署 SSH key

安全顺序是“先加公钥，再切 Secret，最后删旧公钥”：

1. 在受控机器生成新的专用 ed25519 keypair，设置清晰 comment；私钥只进 GitHub Secret。
2. 把新公钥加入当前部署账号 `~/.ssh/authorized_keys`，尽可能限制来源/命令/权限。
3. 更新 GitHub Actions Secret `SERVER_SSH_KEY`。
4. 若服务器 host key 也发生变化，必须通过控制台/可信网络核对新 fingerprint 后更新 `SERVER_SSH_KNOWN_HOSTS`；禁止用 workflow 内 `ssh-keyscan` 接受未知 key。
5. 手动运行 deploy workflow，验证上传、不可变 release、外部 health 和失败回退。
6. 从 `authorized_keys` 删除旧公钥，再运行一次只读连接/下次部署验证。
7. 记录 GitHub audit log、服务器 auth log 和 key fingerprint。

当前部署账号为高权限账号。目标是专用最小权限 deploy user，只允许写 `/opt/nalanda` 和执行所需 compose 操作。

GitHub 管理员/Actions 权限也应启用 MFA、最小化可写角色，并定期清理离职人员、PAT、deploy key 和第三方 Actions 权限。

## 10. Anthropic key（目标）

当前 Python 代码只用 key 是否存在来显示 health，生成函数仍为桩。真实接入前：

1. 为环境分别创建 key，设置供应商侧额度/告警；
2. 更新 AI 服务的 secret store/`infra/hybrid-2g/.env`；
3. 重建 AI 容器，先验证 health，再用无敏感 fixture 做最小生成和成本记录；
4. 确认新 key 有 usage 后撤销旧 key；
5. 泄露时立即撤销、查 usage/费用并更换所有环境。

禁止把 key 送入 Web 或记录模型请求中的原始课件正文。轮换不应改变模型/提示词版本；若同时改变，评测无法隔离原因。

## 11. Azure Speech key（生产当前使用）

`AZURE_SPEECH_KEY` 只在 Nest API。region/voice 不是秘密，但必须与 key 所属 resource 一致。自动测试的 `AZURE_SPEECH_FAKE=true` 绝不能作为轮换验证。

当前生产 region 为 `japaneast`、voice 为 `en-US-JennyNeural`，fake=false；密钥值不得写入本文或日志。计划轮换：

1. 记录 Azure resource/region、key ID（不记值）、月预算和当前错误率；确认 Azure 当前是否提供两把可交替 key。
2. 若无安全重叠，先关闭 `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED` 停止新队列，再按需关闭 `FEATURE_PRONUNCIATION_ENABLED` 或打开 `AZURE_SPEECH_CIRCUIT_OPEN`；文本课程、进度、已缓存 private Storage 音频和浏览器朗读继续。
3. 生成/重置非当前 key，安全更新 `/opt/nalanda/.env` 的 key/region，`chmod 600`，force-recreate API 容器。
4. 以专用账号和无个人数据 fixture 验证一个未缓存词从 pending→ready、private Storage bytes/ETag 可读；第二账号创建相同词时必须立即 ready 且 `attempt_count` 不增加。再提交经客户端规则裁剪、≤6 秒（服务端上限仍 8 秒）的 16 kHz 单声道固定 WAV，确认 phoneme、revision/session patch、speech usage reservation 和用户录音未进入 DB/Storage/log。
5. 观察 `learning_audio_generation_failed`、queue wait、Storage hit/miss、Azure usage 与 API `SPEECH_PROVIDER_*`/429；关闭 circuit 或恢复 flags。
6. 重置/撤销旧 key，并再次验证。若供应商只支持 Key1/Key2 reset，记录哪一个现为 active，避免下次误重置正在使用的 key。

泄露时立即熔断语音、重置受影响 key、检查 Azure usage/账单和 API 日志；不要删除 learning attempts 或把供应商失败记成用户错误。TTS 是可跨用户复用的合成结果，但对象所在 bucket 仍是 private；它可清空后由持久队列重建，不需要随 key 搬迁。仅轮换 key 不改变缓存键；若同时更换 voice、SSML 或后处理语义，必须递增 `LEARNING_AUDIO_SYNTHESIS_VERSION`，保留旧对象到新版本命中稳定后再按生命周期清理。

`COURSE_MARKET_ADMIN_USER_IDS` 变更需双人复核 Supabase UUID：先添加新管理员并验证受审计 hide/restore，再移除旧 UUID、重启 API，并确认旧账号返回 `ADMIN_REQUIRED`。不得用共享 service-role 或开放 RPC 替代管理员列表。

## 12. Stripe secret/webhook secret（尚未实现）

当前没有支付 controller、webhook endpoint、订单/账本表或 Stripe SDK。`infra/hybrid-2g/.env.example` 和 Caddy 注释只是目标占位。

未来上线后分别轮换：

- API secret key：创建新 restricted/live key → 更新服务 → 做测试/小额受控交易 → 查 usage → 撤销旧 key。
- webhook secret：供应商若支持并行 endpoint/signing secrets，重叠验证新旧签名 → 更新服务 → 重放 fixture/事件 → 停用旧 endpoint/secret。

必须保留 webhook event ID 幂等、事件重放、订单/credits 账本对账与退款告警。任何 key 轮换都不能通过直接改余额来“修复”。

## 13. TLS/ACME

当前 nginx TLS 由服务器 certbot 管理。证书续期通常不需要应用 `.env` 变更，但 private key/ACME 账号泄露必须重新签发/撤销。

计划验证：

```bash
certbot renew --dry-run
nginx -t
systemctl reload nginx
```

轮换/续期后从外部检查证书 subject、issuer、有效期和完整链。监控阈值见 [可观测性与告警](./OBSERVABILITY_ALERTING.md)。

## 14. 紧急泄露处置

1. 宣布安全事件，记录发现时间、凭据类型、环境、可能暴露位置和 incident commander。
2. 立即撤销/禁用受影响 key；若无法无损切换，暂停对应入口。
3. 生成新 key 并按消费者顺序部署；不要复用相同值到多个环境。
4. 搜索供应商 audit/usage、GitHub Actions/artifact、服务器 auth/nginx/API log 和异常数据写入。
5. service-role/数据库泄露时重点审计 RLS 绕过、Auth 用户、Storage、functions/RPC、数据导出和删除。
6. 若可能涉及个人数据，启动隐私/法务通知评估；保存证据但限制访问。
7. 清理泄露载体。若进入 Git 历史，轮换后再按批准流程重写历史；不能只删除最新文件。
8. 验证旧 key 已失效、新 key 路径正常，持续提高监控等级。
9. 复盘根因、实际影响、轮换耗时和永久修复。

## 15. 建议轮换周期（待批准）

| 凭据 | 建议最长周期 | 立即轮换条件 |
|---|---:|---|
| service-role/数据库高权限凭据 | 90 天 | 任何疑似泄露、人员离职、环境误用 |
| CI SSH deploy key | 180 天 | 私钥泄露、runner/账号失陷、人员变化 |
| Supabase Personal Access Token | 90 天或按任务短期 | 设备/日志泄露、权限变化 |
| Anthropic/Stripe secret | 90 天 | usage 异常、泄露、供应商建议 |
| Azure Speech key | 90 天 | usage/账单异常、泄露、人员/环境变化 |
| webhook signing secret | 180 天 | 签名异常、endpoint 泄露 |
| JWT signing key | 按供应商能力和 session 策略 | key 泄露/算法变更/供应商通知 |
| TLS 证书 | 自动续期；21/7/2 天告警 | private key 泄露 |
| 备份加密 key | 180 天，使用 key version | key 泄露、访问策略变化 |

周期是目标上限，不代表当前已经自动执行。每个 secret 必须有 owner、创建日、到期日、消费者、最近验证日和撤销证据。

## 16. 轮换完成检查清单

- [ ] 新凭据只存在于批准的 secret store/目标进程；
- [ ] Web 中没有任何服务器 secret，静态 artifact 已按需重建；
- [ ] 所有环境和消费者完成验证，无旧实例继续使用旧 key；
- [ ] 旧凭据已撤销并经负向验证失效；
- [ ] 日志、CI、artifact、备份元数据没有完整 secret；
- [ ] 监控无新增 Auth/5xx/供应商错误，usage 指向新 key；
- [ ] ticket 记录 key fingerprint/ID、时间、operator/reviewer 和验证证据；
- [ ] 环境变量矩阵、runbook 和资产清单已同步。
