# Nalanda · 2G 混合部署

> **文档定位**
> - **内容**：说明 Caddy + NestJS + FastAPI + Redis 的通用小内存部署模板。
> - **作用**：用于未来接入 AI/队列或独立新环境；它不是当前 `nalanda.online` 的生产拓扑。
> - **何时更新**：compose、镜像、内存预算、服务依赖、端口、环境变量或安全基线变化时。

目标拓扑与开发阶段见 [项目蓝图](../../docs/PROJECT_BLUEPRINT.md)。**数据底座（数据库 / 登录 / 存储 / 实时）用 Supabase 云；2G 服务器只用 Docker 跑项目自己的代码**：Caddy + NestJS + Python AI + Redis。Stripe、Claude 走外部联网调用。

```
你的服务器（2G · Docker Compose）
  Caddy（80/443，入口 + 自动 HTTPS）
    ├─ 前端静态文件  ./web-dist
    ├─ NestJS 后端   api:3000   （内网）
    ├─ Python AI     ai:8000    （内网，仅 NestJS 调用）
    └─ Redis         redis:6379 （内网）
        │ 联网
        ▼
  Supabase 云  ·  Stripe  ·  Claude API
```

> ⚠️ 这是**部署模板**：`apps/api`、`apps/ai`、`apps/web` 已存在且可构建，但 API 尚未调用 AI/Redis，AI 仍为固定桩。四容器能启动不等于核心业务链已实现。

---

## 文件一览

| 文件 | 作用 |
|---|---|
| `docker-compose.yml` | 四个服务的编排 + 2G 内存上限 |
| `Caddyfile` | 入口路由 + 自动 HTTPS |
| `.env.example` | 环境变量模板（复制为 `.env` 填写） |
| `api.Dockerfile` | NestJS 多阶段构建（上下文 = monorepo 根） |
| `ai.Dockerfile` | FastAPI 构建（上下文 = `apps/ai`） |
| `web-dist/` | 放前端构建产物（Caddy 托管） |

---

## 前置准备

1. 一台 2G 内存的 Linux 服务器（推荐受支持的 Ubuntu LTS 或 Debian stable）。
2. 一个域名，A 记录解析到服务器公网 IP；放行 80 / 443 端口。
3. 一个 Supabase 云项目（免费档）。
4. Claude（Anthropic）与 Stripe 的密钥。

---

## 部署步骤

**1) 装 Docker**
```bash
curl -fsSL https://get.docker.com | sh
```

**2) 开 2G swap（强烈建议，给内存峰值兜底）**
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**3) 填环境变量**
```bash
cp .env.example .env
# 编辑 .env，填 DOMAIN / ACME_EMAIL / Supabase / Claude / Stripe
```

模板 `.env.example` 中的 `SUPABASE_ANON_KEY` 不能直接供 Vite 构建使用；构建 Web 时必须提供 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。同时不要让 Caddy 读取 service-role、Anthropic、Stripe 等无关秘密，正式部署应按服务拆分 env 文件。

**4) 放入前端产物**（在本地或 CI 构建，别在 2G 机器上构建 Vite）
```bash
# 本地：pnpm --filter @nalanda/web build  → 得到 apps/web/dist
# 把 dist 的内容拷到服务器的 infra/hybrid-2g/web-dist/
```

**5) 启动**
```bash
docker compose up -d --build
```
Caddy 会自动为 `DOMAIN` 申请 HTTPS 证书（确保域名已解析、80/443 已开）。

**6) 看状态**
```bash
docker compose ps
docker compose logs -f api
```

---

## 两种构建模式

- **简单（本机 build）**：上面的 `up -d --build`。2G 机器上构建较吃力——**构建时建议先停其他服务**或确保 swap 已开。
- **推荐（CI 构建镜像 → 服务器 pull）**：在 GitHub Actions 构建 `nalanda-api` / `nalanda-ai` 推到镜像仓库；把 compose 里的 `build:` 换成 `image:`，服务器只 `docker compose pull && up -d`。2G 机器零构建压力。

---

## 2G 必守约束

- AI 全部走 Claude API（含向量化），**不要在本机跑本地大模型 / 向量模型**。
- 解析超大 PDF/PPT 内存会瞬时飙高 → 限制上传大小、把解析也放队列**串行**处理。
- 仅适合早期 / 小流量。流量上来：升 4–8G，或把数据库也自托管（变体 C），或迁回全托管（变体 A）。

---

## 备份与安全

- **数据库**：由 Supabase 托管（含自动备份），本机无需操心。
- **本机**：备份 `.env`；`redis_data` 仅队列状态，可选备份。
- **端口**：只有 Caddy 对外（80/443）；api / ai / redis 全在内网，不发布端口。
- **密钥**：`.env` 与 `web-dist/` 已在 `.gitignore`，不会进仓库。
- **最小权限**：当前 compose 让 Caddy/API/AI 共享同一个 `.env`，且容器默认 root；用于正式环境前必须拆分秘密、增加非 root 用户、healthcheck 和内部服务认证。
