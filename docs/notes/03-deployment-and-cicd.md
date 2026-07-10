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
外部：Stripe（规划）、Claude（规划）
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
        proxy_pass http://127.0.0.1:8411;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / { try_files $uri $uri/ /index.html; }  # SPA 回退
}
```

- 只**新增文件**，从不改既有站点；每次 `nginx -t` 通过后 `systemctl reload`（不 restart）。
- TLS：`certbot --nginx -d nalanda.online`（DNS 已指向本机），自动加 443 + 跳转，自动续期。

## 4. CI/CD 流水线

文件：`.github/workflows/deploy.yml`，触发：push 到 `main`（`paths-ignore: docs/**, **/*.md`）或手动 `workflow_dispatch`。

步骤逻辑：
1. checkout + pnpm/setup-node + `pnpm install --frozen-lockfile`。
2. **质量门**：`pnpm typecheck`，然后运行默认 `pnpm test`（jsdom；需要真实 Supabase 的 RLS E2E 默认安全跳过）。
3. **构建前端**：`pnpm --filter @nalanda/web build`，注入 `VITE_SUPABASE_URL/ANON`（来自 GitHub Secrets）。
4. **构建后端镜像（在 runner 上）**：`docker build -f infra/hybrid-2g/api.Dockerfile -t nalanda-api:latest .`。
5. **打包产物**：`docker save | gzip` 成 tar；前端 dist 打成 `web.tgz`。
6. **SSH 上传**：用部署私钥 `scp` 镜像 tar + web.tgz + compose 文件到 `/opt/nalanda/`。
7. **服务器部署**：`docker load` 镜像 → 替换 `web/` 静态 → `docker compose up -d` → 轮询 `http://127.0.0.1:8411/api/health` 自检（失败则打印日志并退出非零）。

Markdown 变更仍不触发应用部署；独立 `docs` workflow 会运行文档开头字段和相对链接校验。完整覆盖和 RLS E2E 命令见 [测试指南](../guides/TESTING.md)。

为什么用 `docker save/load` 而非镜像仓库：免去在服务器配 registry 凭据，镜像天然私有；代价是每次传输镜像（可接受）。后续可切 GHCR + 缓存。

### Secrets / 密钥分层
- **GitHub Secrets**：`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY`（专用 ed25519 部署私钥，可吊销）、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。
- **服务器 `/opt/nalanda/.env`**：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_JWT_SECRET`——只在服务器，不进 CI、不入库。
- CI 用**独立部署密钥**而非 root 密码登录。

## 5. 一次性服务器引导（已完成）

- 生成 CI 专用 ed25519 密钥，公钥加入服务器 `authorized_keys`，私钥存 GitHub Secret。
- 建 `/opt/nalanda/{web,.env,docker-compose.yml}`（`.env` 权限 600）。
- 写 nginx server 块 + 软链；`certbot --nginx -d nalanda.online`。
- 设 GitHub Secrets；首推触发流水线完成首部署。

## 6. 踩坑实录（最值得复盘）

### (a) 容器内 DNS 解析失败 → 登录 401
**现象**：`/api/health` 正常，但 `/api/me` 对真实令牌一直 401。
**定位**：容器内 `getaddrinfo EAI_AGAIN`（DNS 失败），但 raw TCP 出网正常。宿主机用 `systemd-resolved`（`127.0.0.53`），容器内嵌 DNS 转发不到这个回环地址 → JWKS 拉不到 → 验签落到 HS256 回退 → ES256 令牌验不过 → 401。
**修复**：compose 给 api 服务显式 `dns: [1.1.1.1, 8.8.8.8]`，重建容器即恢复。
**教训**：systemd-resolved 主机上的容器常需显式 DNS；「health 正常但依赖外网的校验失败」要先查容器 DNS/出网。

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

## 8. 运维速查

```bash
cd /opt/nalanda
docker compose ps
docker compose logs --tail=50 api
docker compose restart api
# 手动触发部署：GitHub → Actions → deploy → Run workflow
```

## 9. 后续 TODO

- 切 GHCR + 构建缓存，减小每次部署的镜像传输。
- 部署增加版本标签/回滚；接 Sentry/日志。
- 上线 redis/ai 服务（做 AI 生成时）；Stripe Webhook 入口（做支付时）。
- 为隔离 Supabase 测试项目配置受控 CI，运行真实双用户 RLS/Storage E2E；当前默认 CI 只跑无凭据 jsdom 套件。
