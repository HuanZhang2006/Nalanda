# Nalanda · 2G 混合部署

> **文档定位**
> - **内容**：说明 Caddy + NestJS + FastAPI + Redis 的通用小内存部署模板。
> - **作用**：用于未来接入 AI/队列或独立新环境；它不是当前 `nalanda.online` 的生产拓扑。
> - **何时更新**：compose、镜像、内存预算、服务依赖、端口、环境变量或安全基线变化时。

目标拓扑与开发阶段见 [项目蓝图](../../docs/PROJECT_BLUEPRINT.md)。**数据底座（数据库 / 登录 / 存储 / 实时）用 Supabase 云；2G 服务器只用 Docker 跑项目自己的代码**：Caddy + NestJS + Python AI + Redis。Materials AI 候选通过 OpenRouter 调用固定 DeepSeek/MiMo 模型；Stripe 仍是未实现的未来外部依赖。

```
你的服务器（2G · Docker Compose）
  Caddy（80/443，入口 + 自动 HTTPS）
    ├─ 前端静态文件  ./web-dist
    ├─ NestJS 后端   api:3000   （内网）
    ├─ Python AI     ai:8000    （内网，仅 NestJS 调用）
    └─ Redis         redis:6379 （内网）
        │ 联网
        ▼
  Supabase 云  ·  OpenRouter API  ·  未来 Stripe
```

> ⚠️ 这是**参考模板**，不是 `nalanda.online` 的实际发布入口。0041–0043 已实现 API→BullMQ→FastAPI 候选，但只有通过真实 ZDR、资源 canary、受保护迁移和公网 smoke 后才可启用。四容器能启动不等于核心业务链可发布。

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
4. 启用 Materials AI 时需要 OpenRouter key 与独立内部服务 token；首版不需要 Stripe。

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
# 编辑 .env，填 DOMAIN / ACME_EMAIL / Supabase / Redis / OpenRouter / 内部 token
```

模板 `.env.example` 中的 `SUPABASE_ANON_KEY` 不能直接供 Vite 构建使用；构建 Web 时必须提供 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。同时不要让 Caddy 读取 service-role、OpenRouter 等无关秘密；API、AI、Redis 必须使用各自的最小权限 env 文件。

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

- 生成模型走 OpenRouter，**不要在本机跑本地大模型 / 向量模型**；AI 容器只执行确定性解析、LibreOffice 渲染与 provider adapter。
- 解析 PDF/DOCX/PPTX 可能出现内存峰值：严格执行 25MB/250 页/40 万字符限制、单并发、640MB 内存/896MB 含 swap、0.75 CPU、128 pids、硬超时和磁盘水位熔断。
- 仅适合早期 / 小流量。流量上来：升 4–8G，或把数据库也自托管（变体 C），或迁回全托管（变体 A）。

---

## 备份与安全

- **数据库**：由 Supabase 托管；仍须按项目恢复手册验证可恢复性，不能只依赖“有备份”。
- **本机**：备份加密 secret；Redis 不是任务事实源，Postgres reconciler 可重投。AI 临时目录不得备份并应在 `finally`/孤儿清理器中删除。
- **端口**：只有 Caddy 对外（80/443）；api / ai / redis 全在内网，不发布端口。
- **密钥**：`.env` 与 `web-dist/` 已在 `.gitignore`，不会进仓库。
- **最小权限**：正式环境必须拆分 API/AI/Redis secrets；AI 不得获得 service-role/Redis/Azure，Redis 不得获得 Supabase/provider key，FastAPI 必须验证 `X-AI-Internal-Token`。
