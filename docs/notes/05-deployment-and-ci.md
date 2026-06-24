# 05 · 部署 / CI / 域名

## 这篇讲什么
应用是怎么上到 `nalanda.online` 的、怎么和服务器上**已有的一堆服务**和平共处、push 代码后怎么自动部署、以及部署过程踩的坑。

## 服务器现状（约束来自这里）
一台 Ubuntu 服务器，**已经跑了很多服务**（lobechat、sub2api、teamspeak、多个 postgres/redis），统一用 **nginx** 对外，绑了域名 `uofa.ink`，**内存很紧**（约 300MB 空闲）。两条铁律：
1. 不能影响既有服务。
2. 不能在这台机器上做重构建（内存不够，会 OOM 连累别人）。

## 隔离方案（怎么做到不打架）
- **独立域名**：`nalanda.online`（DNS 已指向同一台机），nginx 加**一个新的 server 块**，绝不动既有站点配置。
- **端口隔离**：后端容器只绑 `127.0.0.1:8411`（外部不可达），由 nginx 反代；不占任何公共端口。
- **独立证书**：`certbot --nginx -d nalanda.online`，独立于 uofa.ink 的证书。
- **静态前端**：前端构建产物由宿主机 nginx 直接托管，`/api/*` 反代到后端容器。

nginx 站点（`/etc/nginx/sites-available/nalanda`）核心：
```
server {
  server_name nalanda.online;
  root /opt/nalanda/web;                  # 前端静态产物
  location /api/ { proxy_pass http://127.0.0.1:8411; ... }   # 后端
  location /     { try_files $uri $uri/ /index.html; }       # SPA 回退
}
```
> 安全做法：改 nginx 前 `nginx -t` 校验，只 `systemctl reload`（平滑重载，不 restart），确保不中断其它站。

## 为什么构建放在 GitHub Actions
服务器内存不够做 Vite/Nest 构建。所以 **构建在 GitHub runner 上做**，服务器只负责**运行**：
```
push 到 main
  → GitHub Actions:
      pnpm build 前端 → web.tgz
      docker build 后端镜像 → docker save → nalanda-api.tar.gz
      scp 两个产物 + compose 文件到服务器
      ssh 上去: docker load 镜像 + 解包前端 + docker compose up -d + 健康自检
```
后端镜像走 `docker save | gzip | scp | docker load`，**不依赖镜像仓库**，简单可靠。

服务器上 `/opt/nalanda/`：
```
docker-compose.yml   只跑 api（image: nalanda-api:latest，绑 127.0.0.1:8411，mem_limit 256m）
.env                 后端密钥（SUPABASE_URL / SERVICE_ROLE / JWT_SECRET）——只在服务器，不进仓库/CI
web/                 前端静态产物（nginx 托管）
```

## CI 配置（`.github/workflows/deploy.yml`）
- 触发：push 到 `main`（忽略 `docs/**` 和 `*.md`，纯文档不触发部署）；也可手动 `workflow_dispatch`。
- 需要的 **GitHub Secrets**：`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY`（专用部署私钥）、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（前端构建时注入）。
- 部署用**专用 SSH 部署密钥**（不是 root 密码），公钥在服务器 `authorized_keys`，私钥存 GitHub Secret，可随时吊销。

## ⚠️ 踩过的坑
### 坑 1：容器内 DNS 解析失败 → 验签 401
后端容器内 `getaddrinfo EAI_AGAIN`，拉不到 Supabase JWKS（验登录令牌要用），导致 `/api/me` 全 401。根因：宿主机用 systemd-resolved（`127.0.0.53`），容器内嵌 DNS 转发不到。
**修复**：compose 给 api 服务显式配 `dns: [1.1.1.1, 8.8.8.8]`，重建容器。（这条已写进 `infra/deploy/docker-compose.yml`，CI 会同步。）

### 坑 2：uofa.ink 证书过期、`certbot renew` 报「账户不存在」
既有 `uofa.ink` 证书过期；续期报错指向一个**已停用的 ACMEv1 账户**。根因：该证书的续期配置绑在老账户上，Let's Encrypt 早已下线 v1。
**修复**：把 `uofa.ink` 的续期配置 `account` 改成当前有效的 v2 账户（和 nalanda/lobe 同一个），再 `certbot renew --force-renewal`。

## 部署变体（按场景选）
`infra/hybrid-2g/` 是一份通用的「托管数据库 + 自建应用」2G 方案（用 Caddy）；本服务器因为已有 nginx，用的是 `infra/deploy/` 这套（融入既有 nginx）。三种变体（全托管 / 混合 / 全自建）的对比见 [../ARCHITECTURE.md](../ARCHITECTURE.md) 第 12.3 节。

## 运维速查
```bash
# 服务器上
cd /opt/nalanda && docker compose ps
docker compose logs --tail=50 api
docker compose restart api
# 看部署
gh run list --workflow=deploy.yml --limit 3
```

## 验证手段
- CI run 成功 + `https://nalanda.online` 首页是真实产物（含 `/assets/index-*.js`）。
- 线上 `/api/health` 200；线上 `/api/me` 用真实令牌返回用户（端到端打通 nginx→容器→Supabase）。
- 既有站点（sub2api/lobe）不受影响（部署前后各测一次）。

## 待改进
- 后端镜像走 `save/load`，每次传几十 MB；要更省可改用镜像仓库（ghcr）+ 缓存。
- redis / AI 微服务尚未纳入生产部署（登录 + Materials 用不到），做 AI 时再加。
