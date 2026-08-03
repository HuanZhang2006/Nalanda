# 03 · 部署架构与 CI/CD

> **文档定位**
> - **内容**：记录当前 `nalanda.online` 的仓库部署拓扑、CI 步骤、服务器约束和历史故障。
> - **作用**：作为现有生产部署的实现复盘；可执行发布/回滚以 operations 手册为准。
> - **何时更新**：workflow、服务器、域名/TLS、compose、健康检查、部署身份或回滚方式变化时。

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
    ├─ web/   前端静态产物（宿主机 nginx 直接托管）
    └─ .env   后端密钥（仅服务器持有）
宿主机 nginx: nalanda.online → 静态 + /api 反代 127.0.0.1:8411（certbot 管 TLS）
外部：Azure Speech（生产）、OpenRouter 翻译前测（生产）、Stripe/Claude（规划）
```

> 登录版只需「web 静态 + api」，redis/ai 暂不部署以省内存。

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
1. **质量门**：docs check、typecheck、默认 Vitest（Web jsdom + API/Courses unit）、全部 workspace build。
2. **数据库/浏览器门**：自动暂存全部 0008+，执行 0007→latest 历史升级，随后销毁 fixture 栈并从全新空卷启动 latest/lint；Auth/PostgREST 有界 readiness 通过后运行双用户 RLS/Storage/points/Courses E2E，并以 Azure/OpenRouter fake 跑 Playwright Courses。
3. **生产迁移（仅新增 migration）**：仅由 owner 手动开启 → environment/branch gate → history/dry-run → 加密恢复点 → `db push` → 远端验证；失败阻断应用。
4. **构建**：Web 注入公开 Supabase 配置；API image 标为 `nalanda-api:<git-sha>`。
5. **SSH**：使用预先核验的 known_hosts 上传到 `/opt/nalanda/incoming/<sha>/`。
6. **真实供应商 gate**：生产主机从 mode-600 `.env` 向新 image 注入 Azure/OpenRouter keys。Azure gate 验证 MP3/PCM TTS、scripted assessment、队列/private Storage/重复词复用和裁剪评分；0019+ 另验证 OpenRouter structured 同义 true/无关 false，以及真实 Courses API 的同 UUID replay 和权威 spelling attempt。任一失败时尚未切换 Web。
7. **激活**：API 本地 health 的 Supabase JWKS/PostgREST 双探针通过后原子切换 Web symlink，再从公网验证 Web/API。
8. **应用回退**：任一激活后 smoke 失败即恢复上一 Web symlink 与运行中的上一 API image；新 release 始终要求 Supabase 双探针为 `ok`，回退验证只要求旧 API 进程契约可用且 `/api/me` 未认证返回 401，以兼容尚未提供依赖级 health 的旧 image；数据库不自动逆向。

Markdown 变更仍不触发应用部署；独立 `docs` workflow 会运行文档开头字段和相对链接校验。完整覆盖和 RLS E2E 命令见 [测试指南](../guides/TESTING.md)。

为什么用 `docker save/load` 而非镜像仓库：免去在服务器配 registry 凭据，镜像天然私有；代价是每次传输镜像（可接受）。后续可切 GHCR + 缓存。

### Secrets / 密钥分层
- **repository Actions Secrets（当前实际位置）**：`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY`、`SERVER_SSH_KNOWN_HOSTS`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；`production` environment 会在部署 job 中使用这些仓库级 Secrets。后续如迁移为 environment Secrets，应一次性迁移整组并验证。
- **production-database environment**：`SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD`、`SUPABASE_PROJECT_REF`、`DB_BACKUP_ENCRYPTION_KEY` 和用于 Ref 交叉确认的 `VITE_SUPABASE_URL`。
- **服务器 `/opt/nalanda/.env`**：Supabase secret、Courses/分享/市场/语音 flags、`PUBLIC_ORIGIN` 与供应商 key/region/配额——只在服务器，不进 Web/仓库；当前文件权限 600，Courses、分享、市场、发音、音频预热和翻译前测 flags 已开启，Azure/OpenRouter fake=false；受保护步骤只更新 OpenRouter 域变量。TTS 限制为默认 20 次/分钟、500,000 字符/月、最小 3.1 秒间隔，synthesis version 1。
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
服务器空闲内存极少，故所有重构建放 CI；容器设 `mem_limit 256m` 防止 api 失控波及邻居；并建议保留 swap。

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

## 8. 运维速查

```bash
cd /opt/nalanda
docker compose --env-file .deploy.env ps
docker compose --env-file .deploy.env logs --tail=50 api
docker compose --env-file .deploy.env restart api
readlink -f web
# 手动触发部署：GitHub → Actions → deploy → Run workflow
```

## 9. 后续 TODO

- 切 GHCR + 构建缓存，减小每次部署的镜像传输。
- 把不可变 image/release 同步到异地 registry，并制定容量/保留清理；接 Sentry/日志。
- 上线 redis/ai 服务（做 AI 生成时）；Stripe Webhook 入口（做支付时）。
- 将本地 Supabase RLS 门禁扩展为定期托管 staging E2E，并覆盖生产同版本配置漂移。
