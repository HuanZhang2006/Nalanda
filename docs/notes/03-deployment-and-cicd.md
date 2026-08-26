# 03 · 部署架构与 CI/CD

> **文档定位**
> - **内容**：记录当前 `nalanda.online` 的仓库部署拓扑、CI 步骤、服务器约束和历史故障。
> - **作用**：作为现有生产部署的实现复盘；可执行发布/回滚以 operations 手册为准。
> - **何时更新**：workflow、服务器、域名/TLS、compose、健康检查、部署身份或回滚方式变化时。
> - **状态基线**：2026-08-25。生产数据库已到 0055；不可变应用仍为此前稳定 release，Materials AI/Luna/Ox flags 保持关闭。PR #77 的 DocumentIR、220 页资源 canary 和 Japan East Azure 通过，但 Courses Ox Alpha 请求因不兼容的 strict JSON Schema 收到 HTTP 404，候选在切流前自动恢复上一 Web/API。当前修复候选改用 JSON Object + 本地严格 schema；数据库 apply、PR 合并和真实门部分通过均不能冒充应用上线。

> 目标：把应用部署到自有服务器、用新域名 `nalanda.online` 访问、不影响服务器上已有的多个项目，并做到「push 到 main 自动部署」。

## 1. 服务器现状（约束来源）

一台共享生产机（Ubuntu 24，**仅约 300MB 空闲内存** / 1.9G 总 + 2G swap），已跑 lobechat、sub2api、teamspeak、多个 postgres/redis，**nginx 持有 80/443**，certbot 管着 `uofa.ink` 等证书。

由此定下三条铁律：
1. **不在服务器上构建**：Vite/Nest 构建吃内存，可能 OOM 连累其他服务 → 构建全部放 GitHub Actions，服务器只「拉取 + 运行」。
2. **复用既有 nginx**：不另起 Caddy 抢 80/443；为 nalanda 新增**独立 server 块**，反代到本机高位端口。
3. **强隔离**：独立 server_name / 独立证书 / 容器只绑 `127.0.0.1` / 独立 compose 项目，绝不改既有站点配置。

## 2. 混合部署模型

```
数据底座（托管，0 占本机内存）：Supabase（Postgres + Auth + Storage + Realtime）
应用层（自托管在服务器）：
  /opt/nalanda/
    ├─ docker compose: api 容器（127.0.0.1:8411 → 容器:3000，mem_limit 256m）
    ├─ Redis（仅 compose 私网、密码、AOF everysec、noeviction、无宿主端口）
    ├─ FastAPI AI（内网、640m RAM/896m memswap、0.75 CPU、128 pids）
    ├─ web/   前端静态产物（宿主机 nginx 直接托管）
    └─ .env   后端密钥（仅服务器持有）
宿主机 nginx: nalanda.online → 静态 + /api 反代 127.0.0.1:8411（certbot 管 TLS）
外部：Azure Speech（生产）、OpenRouter Courses（生产）及 Materials DeepSeek/MiMo（生产）；Luna/OpenAI（候选）、Stripe（规划）
```

> 生产 0043 使用「web 静态 + api + 私有 Redis + 内网 FastAPI AI」。Redis 是注册/写入限流、滥用聚合、扫描锁和只含 durable Postgres job UUID 的 BullMQ 投递依赖；Materials AI 使用独立 env/资源 cgroup，AI 容器没有宿主端口。

## 3. nginx 接入（隔离的关键）

`/etc/nginx/sites-available/nalanda`（软链到 `sites-enabled/`）：

```nginx
server {
    listen 80; listen [::]:80;
    server_name nalanda.online;
    root /opt/nalanda/web; index index.html;
    location /api/ {                       # NestJS 全局前缀 /api
        client_max_body_size 10m;           # 合法的 2,000 词课程 JSON
        proxy_pass http://127.0.0.1:8411;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / { try_files $uri $uri/ /index.html; }  # SPA 回退
}
```

- 只**新增文件**，从不改既有站点；每次 `nginx -t` 通过后 `systemctl reload`（不 restart）。
- API/Nest JSON 与 nginx 都使用 10 MB 上限，避免 nginx 默认 1 MB 提前拒绝合法大词表；朗读 multipart 仍由 API 单独限制为 2 MB。
- TLS：`certbot --nginx -d nalanda.online`（DNS 已指向本机），自动加 443 + 跳转，自动续期。

## 4. CI/CD 流水线

文件：`.github/workflows/deploy.yml`。PR 到 `main` 只跑无生产 secrets 的质量/本地 Supabase 门禁；push `main` 在无新 migration 时发布应用，若含新 migration 则验证后停止。数据库 owner 必须在对应 `main` commit 上先手动运行只读 `plan_database_migrations`，复核 history/dry-run 后再单独运行 `apply_database_migrations`；成功发布数据库后才继续应用发布。两个开关不能同时选择；都不选时只重发应用。纯文档变更由 docs workflow 处理。

步骤逻辑：
1. **质量门**：docs、lint/typecheck、Web/API Vitest、真实 Redis Lua/BullMQ、Python ruff/pytest、workspace build 和 AI Docker build。
2. **数据库/浏览器门**：自动暂存全部 0008+，执行 0007→latest 与空库 latest/lint；运行双用户 RLS/Storage/points/Courses/Materials AI E2E、nginx/compose，并以 fake providers 跑 Courses 与 Materials→Notes→Exam Playwright。
3. **生产迁移（仅新增 migration）**：仅由 owner 手动开启 → environment/branch gate → history/dry-run → 加密恢复点 → `db push` → 远端验证；失败阻断应用。
4. **构建**：Web 注入公开 Supabase 配置；API/AI image 都标为同一 `<git-sha>`，服务器不构建。
5. **磁盘/SSH**：使用预先核验的 known_hosts；上传前删除同 SHA 半成品和超过 24 小时的 abandoned incoming，只清理没有容器引用且不属于当前 `.deploy.env` 的 Nalanda image。可用空间不足 6 GiB 时阻断，再上传到 `/opt/nalanda/incoming/<sha>/`；其它项目镜像不在清理范围。
6. **真实供应商/资源 gate**：既有 Azure/Courses/DeepSeek/MiMo gate之外，Luna 候选以固定 PDF/图片和逐格式样本验证 OpenAI upstream、PDF native parser、原始字节、strict schema、注入拒绝、费用和取消清理；Office canary 继续覆盖旧 pipeline。任一失败保持 Luna 子开关关闭。
7. **激活**：安装 Redis/HMAC/internal token与隔离 `.ai.env`，先保持 `FEATURE_MATERIAL_AI_LUNA=false` 验证 readiness/旧流水线；真实 Luna 与私有登录 smoke 通过后才单独开启子开关，再切 Web并做公网完整链路。
8. **应用回退**：任一激活后 smoke 失败即恢复上一 Web symlink 与不可变 API image；Redis/AI 分开尽力恢复，上一 API 必须以 `--no-deps` 启动并独立验证，不能因可选 AI unhealthy 扩大为公网 502。失败候选由 EXIT trap 与兜底步骤清除；数据库不自动逆向。

Markdown 变更仍不触发应用部署；独立 `docs` workflow 会运行文档开头字段和相对链接校验。完整覆盖和 RLS E2E 命令见 [测试指南](../guides/TESTING.md)。

为什么用 `docker save/load` 而非镜像仓库：免去在服务器配 registry 凭据，镜像天然私有；代价是每次传输镜像（可接受）。后续可切 GHCR + 缓存。

### Secrets / 密钥分层
- **repository Actions Secrets（当前实际位置）**：`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY`、`SERVER_SSH_KNOWN_HOSTS`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；`production` environment 会在部署 job 中使用这些仓库级 Secrets。后续如迁移为 environment Secrets，应一次性迁移整组并验证。
- **production-database environment**：`SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD`、`SUPABASE_PROJECT_REF`、`DB_BACKUP_ENCRYPTION_KEY` 和用于 Ref 交叉确认的 `VITE_SUPABASE_URL`。
- **服务器 `/opt/nalanda/.env`**：Supabase secret、Courses/分享/市场/语音 flags、`PUBLIC_ORIGIN` 与供应商 key/region/配额——只在服务器，不进 Web/仓库；当前文件权限 600，Courses、分享、市场、发音、音频预热和翻译前测 flags 已开启，Azure/OpenRouter fake=false；受保护步骤只更新 OpenRouter 域变量。TTS 限制为默认 20 次/分钟、500,000 字符/月、最小 3.1 秒间隔，synthesis version 1。
- **第一阶段 security secrets**：`production` environment 的 `REDIS_PASSWORD` 与 `RATE_LIMIT_HMAC_SECRET` 必须独立随机生成，经 stdin 原子安装到 mode-600 `.redis.env` 与 API `.env`；Redis 容器只拿密码，不拿 Supabase/provider/HMAC。
- **Materials AI secrets**：`OPENROUTER_API_KEY` 与独立 32-byte `AI_INTERNAL_TOKEN` 经 stdin 原子写入 API/AI env；AI env 不含 service-role、Redis、Azure 或 Web key。总开关与 Luna 子开关安装/回滚都默认 false；格式 allowlist 只来自真实 gate。
- CI 用**独立部署密钥**而非 root 密码登录。

`production-database` 已限制为只允许 `main`，所需四个发布 Secrets 已于 2026-07-21 配置。当前私有仓库套餐不支持 required reviewer，因此数据库发布只允许 owner 分两次人工发起 plan/apply 并留存复核记录；升级套餐后应把 reviewer 门禁补回 GitHub Environment。

## 5. 一次性服务器引导（已完成）

- 生成 CI 专用 ed25519 密钥，公钥加入服务器 `authorized_keys`，私钥存 GitHub Secret。
- 建 `/opt/nalanda/{web,.env,docker-compose.yml}`（`.env` 权限 600）。
- 写 nginx server 块 + 软链；`certbot --nginx -d nalanda.online`。
- 设 GitHub Secrets；首推触发流水线完成首部署。

## 6. 踩坑实录（最值得复盘）

### (a) 容器内 DNS 解析失败 → 登录 401
**历史现象**：当时 `/api/health` 只看变量，因此 health 正常但 `/api/me` 对真实令牌一直 401；当前 health 已增加 JWKS/PostgREST 探针。
**定位**：容器内 `getaddrinfo EAI_AGAIN`（DNS 失败），但 raw TCP 出网正常。宿主机用 `systemd-resolved`（`127.0.0.53`），容器内嵌 DNS 转发不到这个回环地址 → JWKS 拉不到 → 验签落到 HS256 回退 → ES256 令牌验不过 → 401。
**修复**：compose 给 api 服务显式 `dns: [1.1.1.1, 8.8.8.8]`，重建容器即恢复。
**教训**：systemd-resolved 主机上的容器常需显式 DNS；「health 正常但依赖外网的校验失败」要先查容器 DNS/出网。

若宿主机、容器和独立公共 resolver 都对同一 Supabase hostname 返回 `NXDOMAIN`，这不是 Docker resolver 配置问题；应先在 Supabase 控制台确认项目是否暂停/删除或 URL 是否已失效。不得为让部署变绿而把 readiness 降级回“变量存在即健康”。

### (b) uofa.ink 证书续期失败（ACMEv1 账户）
**现象**：`certbot renew` 报「Account does not exist」。
**根因**：uofa.ink 的续期配置绑定在**已停用的 ACMEv1 账户**上（Let's Encrypt 早已下线 v1）。
**修复**：把 `renewal/uofa.ink.conf` 的 `account` 改成当前有效的 v2 账户（与 nalanda/lobe 同一个），`certbot renew --force-renewal` 成功；只动它自己的配置。

### (c) 内存红线
服务器空闲内存极少，故所有构建放 CI。API 为 256m；生产 AI 640m/896m memswap、0.75 CPU、128 pids且单并发，Redis 96m/48m maxmemory noeviction。近上限 canary 出现 kernel OOM、邻站失败或持续不可接受换页即关闭 Materials AI 并停止发布。

## 7. 历史上线验证

以下是该部署方案首次落地时的人工实测记录，不等于持续监控或当前可用性证明：

- `https://nalanda.online` HTTPS 200、HTTP→HTTPS 301；既有站点（sub2api/lobe）不受影响。
- 真实登录令牌打 `/api/me` → 200；CI run = success；自检通过。
- 文档类提交（`docs/**`、`*.md`）因 `paths-ignore` 不再触发重新部署。

### 2026-07-22 Courses 生产发布

- main SHA：`53d0eabf767725b6e9ca83367c0e17c47a479eca`。
- [只读 migration plan](https://github.com/1590703336/Nalanda/actions/runs/29889201210)：本地/远端 history 从 0001 到 0013 逐项一致，`db push --dry-run` 为 `Remote database is up to date`。
- [受保护 apply/deploy](https://github.com/1590703336/Nalanda/actions/runs/29889669272)：创建并保留新的加密恢复点，验证远端 history/functions，构建并启动最终精简 API image，再激活不可变 Web/API release。
- 真实 Azure Speech gate：生产主机 mode-600 `.env`，region `japaneast`、voice `en-US-JennyNeural`、fake=false；无个人数据 fixture 得到 MP3 10,656 bytes、assessment WAV 55,084 bytes、识别成功、accuracy 98、pronunciation 98.8、4 个音素。
- 激活结果：`/opt/nalanda/releases/53d0eabf767725b6e9ca83367c0e17c47a479eca-29889669272-1/web` 与 `nalanda-api:53d0eabf767725b6e9ca83367c0e17c47a479eca`；API 容器 running。
- 独立公网复核：`/api/health` 返回 `status=ok`、`deps.supabase=ok`；`/api/me` 与未认证私有 Courses 均为 401；公开 Course Market 为 200；首页包含 React root。
- Nginx 生产站点已设置 `client_max_body_size 10m` 并通过 `nginx -t`。人工排障产生的临时环境副本和 smoke 脚本已安全擦除。
- 明确未随本次上线的能力：PDF/DOC/DOCX/JSON/Markdown/HTML/图片 OCR/AI 导入、其他三类课程、FastAPI 生成闭环、credits/VIP/支付。

### 2026-07-22 Courses 视觉、文本导入与滚动修复

- main SHA：`d31af905b44ca4df39c70e271a7c7a51612916e3`；包含此前 Courses/Course Market 的共享设计 token 与中英文 locale 收敛，以及本次整份多单元导入、编辑器单元批量追加、独立翻译字段和共享滚动修复。
- [PR #14 quality/database/browser run](https://github.com/1590703336/Nalanda/actions/runs/29932310309) 通过 docs/lint/typecheck、Web/API tests、build、0007→latest、latest 空库重建/database lint、一次性本地 Supabase 双用户 RLS/Storage/Courses E2E 和 Chromium Playwright；浏览器流程使用 Azure fake。
- [main apply/deploy run](https://github.com/1590703336/Nalanda/actions/runs/29932840103) 重复全部门禁，在无新增 migration 的情况下跳过生产数据库变更，并发布不可变 release `d31af905b44ca4df39c70e271a7c7a51612916e3-29932840103-1`。本次没有修改 API、环境变量、业务规则或安全边界。
- main 发布仍在新 image 激活前执行服务器 `.env` 驱动的真实 Azure Speech gate；这证明当次既有供应商路径可用，但不改变“PR Playwright 使用 fake”以及“本次 UI 功能未修改语音”的边界。
- 独立公网 smoke：Web `/` 为 200，`/api/health` 返回 `status=ok`、`service=nalanda-api`、`deps.supabase=ok`，未认证 `/api/me` 为 401。生产 Chromium 用用户给出的完整文本成功生成 `Starter Unit 1` 与 `Starter Unit 2`，Review/Edit 显示独立翻译输入并可批量追加。
- 滚动实测：应用 `.content` 为 `overflow-y:auto`，`clientHeight=1127`、`scrollHeight=1632`，可滚到底并操作“添加单词/批量粘贴单词/添加单元”；修复位于共享 `.main/.content` flex 高度链，因此也覆盖其他使用同一应用壳的长页面。
- 后续只修改 Markdown 的同步提交走独立 docs workflow，不产生新的 Web/API release；不得把文档合并本身描述为再次部署应用。

### 2026-07-23 Courses 学习反馈与 Azure 缓存修复

- main SHA：`02ba1b682c104947aa0b80707c143b8e921870f0`；PR #16 的 quality、0007→0014、空库重建/database lint、真实 RLS/Storage 和 Courses Playwright 均通过。
- [只读 migration plan](https://github.com/1590703336/Nalanda/actions/runs/29939798432) 显示远端已到 0013，唯一待应用项为 `20260723000014_learning_feedback_flow.sql`；写入步骤全部跳过。
- [受保护 apply/deploy](https://github.com/1590703336/Nalanda/actions/runs/29940292716) 创建并保留 14 天加密恢复点 artifact `8538123165`，应用 0014 后确认 local/remote history 一致、dry-run 无待办且 remote lint 通过。
- 激活前真实 Azure gate 使用 `japaneast`/`en-US-JennyNeural` 成功返回 MP3 10,656 bytes、accuracy 98、pronunciation 98.8 和 4 个音素；不可变 release `02ba1b682c104947aa0b80707c143b8e921870f0-29940292716-1` 健康激活。
- 独立公网复核：`/api/health` 为 `status=ok`、`deps.supabase=ok`，未认证 `/api/me` 为 401，首页加载新资产，生产 API image 为同 SHA；容器内随机缺失 TTS 缓存探针返回 `null`，确认首次发音不再因 Storage 的 HTTP 400/JSON-404 提前失败。

### 2026-07-27 Courses 即时反馈、弱网答题与离线音频

- main SHA：`6b6de0e985ad8b34c977f1bce3ba985b84eb82f2`；PR #21 run `30243998633` 与 main run `30244402278` 完成 docs/lint/typecheck、Web/API tests、build、0007→0016、空库重建/database lint、真实本地 Supabase RLS/Storage E2E 和 Chromium Playwright。Playwright 的 Azure 为 fake。
- [只读 migration plan](https://github.com/1590703336/Nalanda/actions/runs/30244967669) 确认远端停在 0014，唯一待办为 0015–0016，且没有执行恢复点、写入或应用部署。
- [受保护 apply/deploy](https://github.com/1590703336/Nalanda/actions/runs/30245430630) 保留 artifact `8644999285` 后应用 0015–0016，确认远端 history、权限断言、lint 与空 dry-run，再构建隔离的不可变 Web/API release。
- 切流前基础 Japan East 真实 Azure smoke 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；新队列 gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`、`trimmedAssessmentBytes=65324`，证明首次生成、private Storage 命中、第二用户重复词不增加 Azure 生成及裁剪评分。
- release `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2-30245430630-1` 已健康激活。独立公网复核：Web 200，`/api/health` 返回 `deps.supabase=ok`，匿名 `/api/me` 返回 401。该 gate 是发布时证据，不替代持续监控。

### 2026-07-27 Courses 历史冷音频与跨单元会话恢复

- main SHA：`99313bd3763ce5bf1f7ffb252f821f7b21a67eec`；PR #24 run `30263277807` 与 main run `30263794368` 完成 docs/lint/typecheck、Web/API tests、build、0007→0018、空库重建/database lint、真实本地 Supabase RLS/Storage E2E 和 Chromium Playwright。新增浏览器场景使用 Azure fake，不能作为供应商证据。
- [只读 migration plan](https://github.com/1590703336/Nalanda/actions/runs/30264327821) 确认远端停在 0016，唯一待办为 0017–0018，且没有执行恢复点、写入或应用部署。
- [受保护 apply/deploy](https://github.com/1590703336/Nalanda/actions/runs/30264979509) 创建并保留加密恢复点 artifact `8652623403`，digest `sha256:22861e8f8ccba2d87fc673f468c75677d6df3a0e9d424111c66dc67d009d5ac3`，应用 0017–0018 后确认远端 history、权限断言、lint 与空 dry-run，再构建隔离的不可变 Web/API release。
- 切流前基础 Japan East 真实 Azure smoke 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；队列 gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`、`trimmedAssessmentBytes=65324`。这些是真实供应商/Storage 证据，与 Playwright fake 明确分开。
- release `99313bd3763ce5bf1f7ffb252f821f7b21a67eec-30264979509-1` 已健康激活。独立公网复核为 Web 200、`deps.supabase=ok`、匿名 `/api/me` 401；服务器本机 Web symlink 指向该 release，API image 为 `nalanda-api:99313bd3763ce5bf1f7ffb252f821f7b21a67eec`。

### 2026-07-28 · 0019–0020 限时拼写与 OpenRouter 翻译前测

- PR #26 合入 session spelling options、hash-only 评判表、service-role-only 事务 RPC、NestJS OpenRouter adapter、限时/翻译前测 UI 和分层测试；PR #27–#29 分别修复 boolean-only provider 契约、规范化完全匹配零 token 快速路径和幂等 replay 响应映射。最终 main SHA 为 `a4c230e1aa6f29abbd4fbe944a1b76c625107003`。
- [只读 plan run `30366334157`](https://github.com/1590703336/Nalanda/actions/runs/30366334157) 只列 0019–0020；[受保护 run `30367263486`](https://github.com/1590703336/Nalanda/actions/runs/30367263486) 创建加密恢复 artifact `8691620673`（`db-recovery-7c8b516ec4fc9086a6bae816966cb7f688c19746`）后应用迁移，远端 history 到 0020，lint 与空 dry-run 通过。
- `30367263486`、`30370419397` 和 `30372651419` 的候选应用分别因 provider 返回契约、合成完全匹配答案被模型误判、以及 claim 外层 replay 标志映射丢失而被 gate 拦截；每次都自动恢复上一 Web/API，数据库按 forward-fix 规则保持 0020。`30374301472` 首次执行还遇到一次本地 PostgREST 上游临时响应，RLS job 重跑 4/4 后通过；一次真实 OpenRouter 12 秒超时同样未激活候选。
- 最终 main run [`30374301472`](https://github.com/1590703336/Nalanda/actions/runs/30374301472) 的第三次部署尝试通过：真实 Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；真实 OpenRouter 固定模型返回 1,365 ms、253/27/280 tokens；候选 Courses API 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`，并持久证明 `nalanda-normalized-exact/normalized-exact-v1`、0 token、同 UUID `replayed=true`、revision 1。
- release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3` 健康激活。独立公网复核：`/api/health` 为 `status=ok`、`deps.supabase=ok`，匿名 `/api/me` 为 401，Web 返回 React root。真实发布 gate 是时点证据，不替代持续 OpenRouter 质量/延迟/费用监控。

### 2026-07-31 · 0021–0022 Unicode 拼写判定一致性

- PR [#35](https://github.com/1590703336/Nalanda/pull/35) 合入 main SHA `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad`。PR run `30615023445`、main run `30615555388` 和受保护 run `30616540480` 均通过 quality、0007→0022、空库重建/database lint、真实本地 Supabase RLS/Storage E2E 与 Chromium Playwright；浏览器供应商仍为 fake。
- [只读 plan run `30616030488`](https://github.com/1590703336/Nalanda/actions/runs/30616030488) 确认远端停在 0020，唯一待办为 `20260731000021_learning_spelling_unicode_normalization.sql` 和 `20260731000022_verify_learning_spelling_unicode_normalization.sql`；没有执行恢复点、写入或部署。
- [受保护 apply/deploy run `30616540480`](https://github.com/1590703336/Nalanda/actions/runs/30616540480) 在 apply 前保留加密恢复 artifact `8787805291`（digest `sha256:fd553ea9c4898d72928db64bcbd979e13dff50f6b50a2138ec7113958709c199`），随后确认远端 history 到 0022、函数验证、database lint 与空 dry-run。
- 切流前真实 Japan East Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；真实 OpenRouter 固定模型返回 10,597 ms、253/27/280 tokens；候选 Courses API/Storage gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`、`trimmedAssessmentBytes=65324`。
- release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` 健康激活。独立公网复核：`/api/health` 为 `status=ok`、`deps.supabase=ok`，匿名 `/api/me` 为 401，Web 返回 React root 和新构建资源。没有使用真实用户账号在生产提交答案；生产迁移自验证与一次性真实 Supabase E2E 是本次拼写判定证据。

### 2026-07-31 · 0023–0024 拼写仅标点差异容错

- PR [#37](https://github.com/1590703336/Nalanda/pull/37) 合入 main SHA `9b62951a8895aa6cf3ff0f9dce8395df239e6089`。PR run `30620350644`、main run `30620879282` 和受保护 run `30624104943` 均通过 quality、0007→0024、空库重建/database lint、真实本地 Supabase RLS/Storage E2E 与 Chromium Playwright；浏览器供应商仍为 fake。
- [只读 plan run `30623522232`](https://github.com/1590703336/Nalanda/actions/runs/30623522232) 确认远端停在 0022，唯一待办为 `20260731000023_learning_spelling_punctuation_tolerance.sql` 和 `20260731000024_verify_learning_spelling_punctuation_tolerance.sql`；恢复、apply 和 deploy 步骤全部跳过。
- [受保护 apply/deploy run `30624104943`](https://github.com/1590703336/Nalanda/actions/runs/30624104943) 在 apply 前保留 `db-recovery-9b62951a8895aa6cf3ff0f9dce8395df239e6089`，artifact `8790816378`、366,417 bytes、digest `sha256:887b1ac42c267ca7bb1cde810920702dde64f8d74112b3b39def6254d5bf0fca`，保留至 2026-08-14。apply 后远端 history 到 0024，函数/权限断言、database lint 与空 dry-run 均通过。
- 切流前真实 Japan East Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；真实 OpenRouter 固定模型返回 2,790 ms、253/27/280 tokens；候选 Courses API/Storage gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`、`trimmedAssessmentBytes=65324`。
- release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1` 健康激活。独立公网复核：Web 200 且返回 React root，`/api/health` 为 `status=ok`、`deps.supabase=ok`，匿名 `/api/me` 为 401。没有使用真实用户会话在生产提交拼写答案；生产迁移自验证与一次性真实 Supabase E2E 是本次判定行为证据。

### 2026-08-01 · 0025–0028 取消、轮末复盘、考试与滚动配额

- PR [#40](https://github.com/1590703336/Nalanda/pull/40) 合入 main SHA `93354a56044470fb5d2b1fd6aeabcf82f459bb52`。PR run `30705662543` 与 main run `30705946921` 通过 docs/lint/typecheck、Web/API tests、build、0007→0028、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright；Playwright 的 Azure/OpenRouter 仍为 fake。
- [只读 plan run `30706279006`](https://github.com/1590703336/Nalanda/actions/runs/30706279006) 确认生产远端完整到 0024，唯一待办为 0025–0028；恢复、apply 和应用部署全部跳过。
- [受保护 apply/deploy run `30706731292`](https://github.com/1590703336/Nalanda/actions/runs/30706731292) 在 apply 前保留 `db-recovery-93354a56044470fb5d2b1fd6aeabcf82f459bb52`，artifact `8820657507`、约 418 KB、digest `sha256:02ea6fef5481756b17f79fbbd82c023d9c9ba085accfc1e28f9a268d24645ad9`，保留 14 天。apply 后远端 history 到 0028，结构/权限断言、remote database lint 与空 dry-run 均通过；数据库继续只采用 forward-fix。
- 切流前真实 Japan East Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8 和 4 个音素；真实 OpenRouter 固定模型返回 9,364 ms、253/27/280 tokens；候选 Courses API/Storage gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`、`trimmedAssessmentBytes=65324`，并验证 exact translation replay、revision 1。
- 不可变 release `93354a56044470fb5d2b1fd6aeabcf82f459bb52-30706731292-1` 健康激活。独立公网复核确认 Web 返回 React root 和新构建资源，`/api/health` 为 `status=ok` 且 `deps.supabase=ok`，匿名 `/api/me` 为 401；认证 Chromium 只读检查确认现有课程卡和 90% 默认考试配置可见，未开始考试、未提交真实用户答案，因此这不是生产用户答题 E2E。

### 2026-08-03 · 0029–0034 读音考试、自选词、考试历史与双考试掌握

- PR [#45](https://github.com/1590703336/Nalanda/pull/45) 合入 main SHA `1a58d2164f6d58feea4d3a2c8925211b8cc60dde`。最终 PR run `30811283164` 与 main run `30811817461` 通过 docs/lint/typecheck、Web/API tests、build、0007→0034、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright；Playwright 的 Azure/OpenRouter 仍为 fake。
- [只读 plan run `30812467085`](https://github.com/1590703336/Nalanda/actions/runs/30812467085) 确认生产远端完整到 0028，唯一待办为 0029–0034；恢复、apply 和应用部署全部跳过。
- [受保护 apply/deploy run `30813047562`](https://github.com/1590703336/Nalanda/actions/runs/30813047562) 在 apply 前保留 `db-recovery-1a58d2164f6d58feea4d3a2c8925211b8cc60dde`，artifact `8855819351`、593,399 bytes、digest `sha256:5f36f770aab133f24e12d461e66b0c4b744303ca1dbfd1600215163e4ad14796`，保留 14 天。apply 后远端 history 到 0034，0030/0032/0034 结构/权限断言、remote database lint 与空 dry-run 均通过；数据库继续只采用 forward-fix。
- 切流前真实 Japan East Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8 和 4 个音素；真实 OpenRouter 固定模型返回 1,604 ms、253/27/280 tokens；Courses API/Storage gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`、`trimmedAssessmentBytes=65324`，并验证重复音频复用和 exact translation replay。
- 不可变 release `1a58d2164f6d58feea4d3a2c8925211b8cc60dde-30813047562-1` 健康激活。独立公网复核确认 Web 200 且返回 React root、`/api/health` 为 `status=ok` 且 `deps.supabase=ok`、匿名 `/api/me` 为 401、Course Market 为 200。没有使用真实用户账号在生产提交完整考试，因此迁移/RLS/发布 gate 是服务端与供应商证据，不是生产用户考试流程 E2E。

### 2026-08-04 · 0035–0036 精确掌握投影与未裁剪录音

- PR [#47](https://github.com/1590703336/Nalanda/pull/47) 合入 main SHA `51252527645d9438df0414f056c8a3b088b360d8`。最终 PR run `30831319634` 与 main run `30831964846` 通过 docs/lint/typecheck、Web/API tests、build、0007→0036、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright；Playwright 的 Azure/OpenRouter 仍为 fake。
- [只读 plan run `30832581552`](https://github.com/1590703336/Nalanda/actions/runs/30832581552) 确认生产远端完整到 0034，唯一待办为 0035–0036；恢复、apply 和应用部署全部跳过。
- [受保护 apply/deploy run `30833228406`](https://github.com/1590703336/Nalanda/actions/runs/30833228406) 在 apply 前保留 `db-recovery-51252527645d9438df0414f056c8a3b088b360d8`，artifact `8864033351`、657,467 bytes、digest `sha256:36a9ec08516dff5cb198511d71b69bb63533727cad9826db050dff4a33025625`，保留至 2026-08-17。apply 后远端 history 到 0036，0036 结构/权限/写入路径断言、remote database lint 与空 dry-run 均通过；数据库继续只采用 forward-fix。
- 切流前真实 Japan East Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8 和 4 个音素；真实 OpenRouter 固定模型返回 10,252 ms、253/27/280 tokens；Courses API/Storage gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=96.4`、未裁剪 `assessmentBytes=88444`，并验证重复音频复用和 exact translation replay。
- 不可变 release `51252527645d9438df0414f056c8a3b088b360d8-30833228406-1` 健康激活。独立公网复核确认 Web 200 且返回新 React 资产、`/api/health` 为 `status=ok` 且 `deps.supabase=ok`、匿名 `/api/me` 为 401、Course Market 为 200。没有使用真实用户账号在生产提交完整考试，因此迁移/RLS/发布 gate 是服务端与供应商证据，不是生产用户考试流程 E2E。

### 2026-08-04 · 0037–0038 中文翻译语音输入与共享波形

- PR [#49](https://github.com/1590703336/Nalanda/pull/49) 合入 main SHA `66c919833693971ba1bda4ea33a3fdf6717ef1ca`。PR run `30904901828` 通过 docs/lint/typecheck、72 个 API 测试、85 个 Web/jsdom 测试、build、0007→0038、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright；Playwright 的 Azure/OpenRouter/Fish Audio 仍为 fake。
- [只读 plan run `30906629924`](https://github.com/1590703336/Nalanda/actions/runs/30906629924) 首次遇到一次性 Supabase 上游瞬时错误；同 SHA 仅重跑失败 job 后通过，最终 dry-run 唯一列出 0037–0038，未创建恢复点、写库或部署。
- [受保护 apply/deploy run `30907716733`](https://github.com/1590703336/Nalanda/actions/runs/30907716733) 在 apply 前保留加密恢复 artifact `8892006761`（730,159 bytes），随后把远端 history 同步到 0038，并通过 0038 结构/权限断言、remote database lint 与空 dry-run。
- 切流前真实 Japan East Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；真实 OpenRouter structured 判分通过；生产待激活 Courses API 的 Azure 中文 WAV→Fish Audio gate 返回 `transcriptionMatched=true`，同时音频/评分 gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=96.4`。
- 不可变 release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1` 健康激活。独立公网复核确认 Web 200、新 React 资产、`/api/health` 的 `deps.supabase=ok` 与匿名 `/api/me=401`；生产主机只读复核确认 Web 软链与运行 API image 均为同一 SHA。真实 STT 使用固定合成中文 WAV，不是物理麦克风或多口音质量 E2E。

### 2026-08-10 · 0039–0040 安全/限流 Stage A 发布

- PR [#51](https://github.com/1590703336/Nalanda/pull/51) 实现帖子/Feedback/Schedule 完整性、points 冻结日上限/审核/协同信号、私有 Redis/HMAC 限流、nginx 分层保护和两阶段 workflow；PR run `31367746106`、main run `31368361777` 通过 quality、真实 Redis、0007→0040、空库/lint、双用户 RLS/Storage 与 Chromium Playwright。PR [#52](https://github.com/1590703336/Nalanda/pull/52) 修复 Redis 检查消耗远端 heredoc stdin，并新增发布脚本回归；PR run `31370961413`、main run `31371608883` 全绿。
- 首次 [只读 plan `31368447660`](https://github.com/1590703336/Nalanda/actions/runs/31368447660) 只列 0039–0040。[受保护 run `31369657292`](https://github.com/1590703336/Nalanda/actions/runs/31369657292) 在 apply 前保留 artifact `9055783205`（777,902 bytes，digest `6c06bc011b3d0dc436b9722b66206e6f7a12bd2ecf083f2266cbb6b529c4112f`）并把远端同步到 0040；但 workflow 因 stdin 缺陷错误结束为 success，公网 health 仍为旧 API 的 `deps.redis=unset`，因此该次不计作应用发布。
- 修复合入后，[只读 plan `31372198037`](https://github.com/1590703336/Nalanda/actions/runs/31372198037) 确认本地/远端均到 0040且 dry-run 为空。最终 [受保护 run `31372888441`](https://github.com/1590703336/Nalanda/actions/runs/31372888441) 再保留 artifact `9057062920`（800,819 bytes，zip digest `81820da75dc4f0591ffd6f73ba3ac175a5b04f6995af8f8c508f60e56379a2f4`），并通过远端 history、lint 与空 dry-run。
- 切流前 Redis PING/AOF/private-port/noeviction、nginx `-t`、真实 Japan East Azure（10,656-byte MP3、accuracy 98、pronunciation 98.8）、真实 OpenRouter Gemma（5,524 ms、253/27/280 tokens）和真实 Courses API/Storage/Fish gate（`generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=98.2`、`transcriptionMatched=true`）全部通过。此前一次 12 秒超时和三次 429 均在切流前阻断；同密钥额度正常且生产主机恢复 HTTP 200 后才重跑成功，未改用 fake 或绕过门禁。
- 不可变 release `56100e6bc2a4c70aa289aaad4b43efa1267428bd-31372888441-5` 于 `2026-08-10T09:35:34Z` 激活。公网复核确认 Web/Course Market 200、匿名 `/api/me` 与 points admin 401、注册 400 且带 `RateLimit-Limit: 5`，health 为 `deps.supabase=ok/deps.redis=ok`；主机复核确认 Web 软链与 API image 指向该 release，Redis healthy 且无宿主端口。
- 24 小时兼容观察从激活时刻计算，最早 contract 资格时间为 `2026-08-11T09:35:34Z`。2026-08-22 已复核 Redis、points projection、协同 signal 与受支持客户端时间列依赖并通过 go/no-go；最终 contract 随后在生产 0051 后顺序追加为 0052–0053 并完成受保护发布。

### 2026-08-11 · 0041–0043 Materials AI 生产激活

- PR [#56](https://github.com/1590703336/Nalanda/pull/56) 加入 OpenRouter 有界重试、共享 wall-clock、`Retry-After`、同模型 ZDR provider failover、reasoning 关闭和全部失败尝试成本审计；PR run `31462982923` 全绿。随后 main run `31463661987` 虽显示 success，独立核验却发现 Web/API 仍为旧 commit、flag=false、AI endpoint 404，因此没有计作上线。
- 根因是新增的远端 `docker compose exec -T ai` 再次继承并消耗 SSH heredoc stdin，后续脚本未执行但远端 shell 零状态退出。PR [#57](https://github.com/1590703336/Nalanda/pull/57) 把所有远端 compose exec 收口到显式 `</dev/null` 的 helper，并增加“不得出现裸调用/必须恰好覆盖五处”的发布工具回归；PR run `31465041901` 和 main run `31465776658` 通过。
- [只读 plan `31465816321`](https://github.com/1590703336/Nalanda/actions/runs/31465816321) 确认本地/远端均到 0043且 dry-run 为空。[最终受保护 run `31467153739`](https://github.com/1590703336/Nalanda/actions/runs/31467153739) 创建 14 天加密恢复 artifact `9092230348`（824,125 bytes，zip SHA-256 `6939309024094791bb639112eaf73a1429d588a4800c42703e579185a0aa817f`），再次验证远端 history/lint/空 dry-run。
- 资源 canary 处理 220 页、366,412 字符：主进程峰值 106,778,624 bytes、Office 子进程 222,203,904 bytes、6.923 秒，无 OOM/邻站故障。真实 OpenRouter 固定 DeepSeek/MiMo suite 覆盖 PDF/DOCX/PPTX/chart、单个视觉失败范围、prompt injection 拒绝、安全教材放行、39 个进度事件和主观题评分；过程目录前后清理通过。
- 既有真实 Japan East Azure、Gemma 翻译与 Courses API/Storage gate 继续通过。登录用户 Materials gate 得到 `generationJob=succeeded`、`grading=completed`、生成/评分 quota 各 1、5 条 provider usage、`sourceAndResultsDeleted=true` 和 `deps.supabase=ok/deps.ai=ok`。
- 不可变 release `e6ce0cb246d9fc1ecc1c4869b6e63d09d3256bd4-31467153739-1` 于 `2026-08-11T07:20:02Z` 激活。服务器只读复核确认 API/AI image、`.deploy.env` 和 Web symlink 同一 commit，AI/Redis healthy，`FEATURE_MATERIAL_AI=true`；独立公网复核为首页 200、Supabase/Redis health ok、AI worker/queue ok、匿名 me/quota 401。

### 2026-08-14 至 2026-08-22 · 0046–0051 数据库已发布、应用候选仍未激活

- 候选把长任务改为快速 202 + callback/checkpoint/usage spool，新增 ELK/React Flow 图谱、跨设备布局、任务 Delete/Clear、统一交卷批改和 `luna_native_file_v1`。生产数据库已通过受保护流程前向应用到 0051；0044–0045 保持未使用，时间列 contract 另以 0052–0053 严格追加。数据库 apply 不等于应用激活。
- PR #70 run `32499521666` 完成完整 fake/local 门禁并合并为 main `e6fa854dd6517a2a2ccd4152b60ca37078f6af4e`。main run [`32540131549`](https://github.com/1590703336/Nalanda/actions/runs/32540131549) 再次通过 lint/typecheck、API/Web/Python、真实 Redis、0007→0051、空库/lint/RLS/Storage、fake Chromium、镜像构建及 220 页资源 canary；本次无新 migration，数据库发布 job 正确跳过。
- 同一 run 的真实 PDF gate 通过后，固定 DOCX 试卷在最终校验返回 `AI_EXAM_VALIDATION_FAILED`。候选 `e6fa854dd6517a2a2ccd4152b60ca37078f6af4e-32540131549-1` 在 API/Web 切流前失败，EXIT trap 清除候选并恢复旧 API/AI/Web；独立检查确认 `.deploy.env` 与 Web symlink 仍指向旧稳定 `3c095a55ced21cee11a1b3131dd2889ec1f70733` release，公网 Supabase/Redis/AI health 正常且匿名 `/api/me` 为 401。因此 #70 已合并但没有部署成功。
- 向前修复只增加 content-free validation categories/counts，并将固定材料扩展为足够支持五道题的八个独立事实；仍保持一次 repair、严格 schema/答案/引用/语义门。新的 PR/main 真实门禁通过、候选切流并完成服务器与公网独立复核之前，不得称 0046–0051 应用已上线；Luna 仍需 first-party OpenAI ZDR endpoint，能力不存在时子开关必须 false。

### 2026-08-22 · 0052–0053 安全 Stage B 数据库发布、应用 gate 回退

- PR #71 的 main run [`32543270581`](https://github.com/1590703336/Nalanda/actions/runs/32543270581) 首次真实 Materials suite 通过后被 Japan East Azure HTTP 401 阻断并回退；用户要求重试后的 attempt 2 通过 220 页资源 canary，随后固定 DOCX 初次语义复核失败、repair 后最终结构门返回 `SOURCE_REFERENCE`，同样未切流。
- PR [#72](https://github.com/1590703336/Nalanda/pull/72) 以 main `1ef0bc8d333a9ff841176d91acb4c977c0e64bed` 为唯一基线，合并为 `4d1bc97888799417641fefdd507c026b274a2bab`；PR run [`32579985463`](https://github.com/1590703336/Nalanda/actions/runs/32579985463) 与 main run [`32580594918`](https://github.com/1590703336/Nalanda/actions/runs/32580594918) 通过 docs/lint/typecheck、API/Web/Python、真实 CI Redis、0007→0053、空库/lint、双用户 RLS/Storage、fake-provider Chromium、生产镜像启动和 nginx/compose。普通 main push 正确跳过生产数据库和应用部署。
- [只读 plan `32581192318`](https://github.com/1590703336/Nalanda/actions/runs/32581192318) 显示远端完整到 0051，dry-run 唯一列出 0052–0053且没有写库或部署。[protected run `32581805613`](https://github.com/1590703336/Nalanda/actions/runs/32581805613) 在 apply 前上传 14 天加密恢复 artifact [`9478168126`](https://github.com/1590703336/Nalanda/actions/runs/32581805613/artifacts/9478168126)（885,857 bytes，zip SHA-256 `0e4425b7098b4b352b5a7f6e81e87861d9c98b535970f9f20592641653a41274`），随后应用 0052–0053。远端 history 对齐到 0053、dry-run 为空、public schema lint 成功；0053 同时失败关闭断言合法列、service-role、trigger 与最终撤权。
- 应用 attempt 1 的 220 页资源 canary 通过，但真实 PPTX 试卷在 repair 后缺 `SOURCE_REFERENCE`；attempt 2 的同一样本从缺引用修复后仍未通过五类语义门，两次均返回 `AI_EXAM_VALIDATION_FAILED`。没有改用 fake、放宽 gate 或继续碰运气；真实 Materials AI gate 失败发生在 Azure/OpenRouter/Courses 后续 smoke 之前，因此本次不能把那些后续门写成通过。
- 两次候选均在 Web/API 切流前调用 rollback。独立公网复核为 Web 200、`/api/health` 200 且 `deps.supabase=ok/deps.redis=ok`、`/api/health/ai` 200、匿名 `/api/me` 401；主机复核确认 Web 软链与 API/AI image 仍为 `3c095a55ced21cee11a1b3131dd2889ec1f70733`，AI/Redis healthy，`FEATURE_MATERIAL_AI=false`、`FEATURE_MATERIAL_AI_LUNA=false`。结论：0052–0053 数据库权限已上线，最新 main 应用没有部署成功，Materials AI 保持关闭直至独立修复重新通过全部门禁。
- 来源引用向前修复只允许 DocumentIR allowlist、服务端 locator 和同一稳定 question ID 的 repair 前引用恢复，并强制再次语义复核。它必须经新 PR/main 的完整 CI、真实 provider、Azure、登录用户 smoke、候选切流及服务器/公网独立核验后，才可记录为部署成功；真实语义门再次失败时仍必须回退。

### 2026-08-23 · PR #74 来源引用修复候选仍回退

- PR [#74](https://github.com/1590703336/Nalanda/pull/74) 合并为 main `5b4cad883b628fd21cc1d104227be6dfb746834f`；PR run `32585020750` 和 main run [`32585659792`](https://github.com/1590703336/Nalanda/actions/runs/32585659792) 通过 docs、quality、0007→0053、空库/database lint、双用户 RLS/Storage、fake Chromium与生产形态镜像。没有 migration 变更，production database job 正确跳过。
- application attempt 1 通过 220 页 canary、真实 DeepSeek/MiMo PDF/DOCX/PPTX/chart、注入/安全教材、评分、9-node graph 和 Japan East Azure（accuracy 98、pronunciation 98.8）；Luna 因 OpenAI-only ZDR 不可用保持 false。随后独立 Gemma 翻译 smoke 连续五次 HTTP 429，候选自动回退。
- 同 SHA 仅重跑失败 job 的 attempt 2 在 canary 后被固定 PDF 拦截：DocumentIR 只有一个 block，但首次生成和一次 repair 都引用无效 ID，initial/final gate 均为 `SOURCE_REFERENCE`。两次候选均未切 Web；服务器与公网独立复核继续指向 `3c095a55ced21cee11a1b3131dd2889ec1f70733-31574116130-1`，Supabase/Redis/AI health ok、匿名 `/api/me` 401。
- 新向前修复仅在 allowlist 恰好一个 block 时规范到唯一来源并强制语义复核；多 block 继续失败关闭。它不能绕过独立 Gemma 429 或后续登录 smoke，仍需新 PR/main 完整受保护发布证据。

### 2026-08-23 · PR #75 单 block 修复通过，Gemma 硬门仍回退

- PR [#75](https://github.com/1590703336/Nalanda/pull/75) 合并为 main `ad4b98b041ccb38954ac3bba705b26a92b70cca2`。PR run [`32587211309`](https://github.com/1590703336/Nalanda/actions/runs/32587211309) 与 main run [`32587844503`](https://github.com/1590703336/Nalanda/actions/runs/32587844503) 通过 docs、quality、0007→0053、空库/database lint、双用户 RLS/Storage、fake Chromium与生产形态镜像；没有 migration 变更，production database job 正确跳过。
- application attempt 1 通过 220 页资源 canary，但固定单 block PDF 初次与一次 repair 后均为 6 题，而设置要求 5 题；最终结构门以 `QUESTION_TYPE_COUNT` 失败并自动回退。该失败没有被来源补偿逻辑吞掉。
- 同一 SHA 仅重跑一次失败 job。attempt 2 的 canary 再次通过，真实 DeepSeek/MiMo gate 完成 PDF/DOCX/PPTX/chart、注入拒绝、安全教材、评分和 9-node graph；Luna 因 OpenAI-only ZDR 不可用保持 false，Japan East Azure 返回 accuracy 98、pronunciation 98.8。随后 Gemma 免费模型在五次有界尝试后仍为 HTTP 429，候选第二次回退，Courses 与登录用户 smoke 因顺序门禁尚未执行。
- 两次均未切 Web/API。独立主机与公网核对确认 Web 软链和 API/AI image 仍为 release `3c095a55ced21cee11a1b3131dd2889ec1f70733-31574116130-1`，两个 Materials flag 为 false，Supabase/Redis/AI health ok，匿名 `/api/me` 401、首页 200，attempt 2 候选目录与 `web.next` 均已清除。因此 PR #75 已合并但未部署；不得第三次盲目重跑或弱化 Gemma 硬门。

### 2026-08-23 · Ox Alpha 三流水线候选（尚未发布）

- 当前分支把 Courses 非字面翻译从 Gemma 改为固定 `stealth/ox-alpha`，并增加 0054–0055 与 `ox_alpha_native_file_v1`。Materials 能力矩阵成为 DocumentIR、Luna 原文件、Ox Alpha 原图三条显式 pipeline；Ox 固定 Stealth-only/no-fallback/mandatory reasoning，且 API/worker 只允许 PNG/JPEG/WebP。
- 实时模型元数据没有 file modality，实时 ZDR catalog 也没有 Ox endpoint。因此受保护发布必须把“Ox 文本翻译真实 smoke”和“Materials Ox 原图 ZDR gate”分开：前者失败会阻断应用切流；后者当前应稳定保持子开关 false 并记录 `OPENROUTER_ZDR_UNAVAILABLE`，不能放宽 ZDR 或用文本 smoke 冒充原图可用。
- 本段只记录候选设计和已核对的供应商能力，不是 CI、数据库 apply、应用切流或公网验证证据。完成后必须补充 PR/main run、0054–0055 只读 plan、恢复 artifact、protected apply、真实门禁、release/image/Web symlink 和独立公网结果。

## 8. 运维速查

```bash
cd /opt/nalanda
docker compose --env-file .deploy.env ps
docker compose --env-file .deploy.env logs --tail=50 api
docker compose --env-file .deploy.env restart api
readlink -f web
df -h /opt/nalanda
docker system df
# 手动触发部署：GitHub → Actions → deploy → Run workflow
```

## 9. 后续 TODO

- 切 GHCR + 构建缓存，减小每次部署的镜像传输。
- 把不可变 image/release 同步到异地 registry，并制定容量/保留清理；接 Sentry/日志。
- 0046–0055 数据库均已前向应用。Gemma 已按独立产品决策在代码中替换为 Ox Alpha，但 PR #77 应用候选已因输出参数不兼容回滚，必须由新的修复 SHA 重新走完整不可变 release，不能据数据库或代码变更推断已上线。Stripe Webhook 仍属于后续能力。

### 8.16 PR #77 / 0054–0055 与 Ox Alpha 输出契约回滚（2026-08-23）

- PR #77 合并为 `85beab02d84d2b7b42948a0ab4a923ea13646109`，main CI `32627507536` 通过；只读 plan `32628178552` 只列 0054–0055。
- apply/deploy run `32628757656` 保留恢复点并把远端 history 推进到 0055，随后 dry-run 显示无待迁移且 public schema lint 通过。
- 候选 220 页 canary、DocumentIR DeepSeek/MiMo suite 和 Japan East Azure 通过；Luna 与 Materials Ox 因 `OPENROUTER_ZDR_UNAVAILABLE` 正确保持 false。
- Courses Ox Alpha 翻译 smoke 以 `response_format.type=json_schema`、`require_parameters=true` 请求，但实时 endpoint 只声明通用 `response_format`，OpenRouter 返回 HTTP 404。保护脚本恢复上一 Web/API，并确认公网 root/health 为 200、Supabase/Redis ok、匿名 `/api/me` 为 401；候选没有切流。
- 修复候选使用 `response_format.type=json_object`，仍固定 Stealth-only/no fallback/deny collection/required parameters，并由 API 与发布 smoke 在本地严格验证唯一字段、类型和语义 case。非 2xx 日志只允许状态、结构化 code 和 request ID。
- 将本地 Supabase RLS 门禁扩展为定期托管 staging E2E，并覆盖生产同版本配置漂移。
