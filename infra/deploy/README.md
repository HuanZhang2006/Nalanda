# 生产部署（nalanda.online）

> **文档定位**
> - **内容**：记录当前生产服务器上的 Web/API/nginx 拓扑、部署依赖和维护入口。
> - **作用**：帮助理解现网布局；正式发布、数据库变更、备份与恢复应按 operations 手册执行。
> - **何时更新**：域名、服务器、CI、compose、nginx/TLS、部署账号或密钥位置变化时。
> - **状态基线**：2026-08-11。生产已运行 0040/Web+API+私有 Redis 拓扑；nginx 分层限流和独立 secret 已受保护发布。本目录另含 0041–0043 Materials AI worker 候选，尚待完整门禁与受保护发布；时间列撤权 contract 顺延为未来 0044–0045。

服务器已运行多个项目（共用 nginx + uofa.ink）。Nalanda 以**隔离、可叠加**的方式接入，不影响既有服务。

## 拓扑

```
GitHub push → Actions（在 runner 上构建，不占服务器内存）
  ├─ check + Python pytest/ruff + 真实测试 Redis + 0007→最新迁移夹具 + 本地 Supabase 重建/lint/RLS E2E
  ├─ FastAPI 契约/AI image + fake provider Playwright（只作自动化证据）
  ├─ 新迁移：dry-run → 加密恢复点 → protected DB push → 验证
  ├─ 前端 vite build → Git SHA release/web
  └─ API/AI docker build → nalanda-api:<git-sha> / nalanda-ai:<git-sha> → docker save
        │ scp / ssh
        ▼
服务器 /opt/nalanda/
  ├─ 新 images + 分离 .env/.ai.env/.redis.env → 真实 Azure/OpenRouter gates
  ├─ 0015+ 候选 API → 队列首次生成/Storage hit/重复词/裁剪评分 gate
  ├─ docker compose（.deploy.env 选择不可变 API/AI images + 私有 Redis）
  ├─ releases/<release-id>/web + web 原子 symlink
  ├─ .env（API secrets，含 password URL；mode 600）
  ├─ .ai.env（仅 OpenRouter/内部 token/非秘密 worker 配置；mode 600）
  └─ .redis.env（仅 Redis password；mode 600）
宿主机 nginx: nalanda.online → 静态 + /api 反代 127.0.0.1:8411（certbot 管 TLS）
```

为什么不在服务器上构建：该机仅约 300MB 空闲内存，Vite/Nest 构建会 OOM 并波及其他服务，故全部构建放在 GitHub Actions。

## 一次性服务器引导（已完成）

- `/opt/nalanda/{web,.env,docker-compose.yml}`；`.env` 权限 600。
- nginx 站点 `/etc/nginx/sites-available/nalanda`（+ sites-enabled 软链）。
- `certbot --nginx -d nalanda.online`（自动续期）。
- CI 专用 SSH deploy key 已加入服务器 `authorized_keys`。

## GitHub Secrets（仓库 Settings → Secrets → Actions）

| 名称 | 值 |
|---|---|
| `SERVER_HOST` | 154.50.110.239 |
| `SERVER_USER` | root |
| `SERVER_SSH_KEY` | CI 部署私钥（ed25519） |
| `SERVER_SSH_KNOWN_HOSTS` | 管理员在可信网络核验的目标 SSH host key 行 |
| `VITE_SUPABASE_URL` | `https://<active-project-ref>.supabase.co`；必须与当前可解析、可用的生产项目一致 |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon 公钥 |

`production-database` environment 还需 `SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD`、`SUPABASE_PROJECT_REF` 和 `DB_BACKUP_ENCRYPTION_KEY`。该 environment 已创建并只允许 `main`；当前私有仓库套餐不支持 required reviewer，升级套餐前必须只通过人工发起的 `workflow_dispatch` 发布数据库，并按[数据库发布手册](../../docs/operations/DATABASE_RELEASE_ROLLBACK.md)保存 owner 复核记录。数据库 migration history 的首次 baseline 不能由 CI 猜测。

0039–0040 第一阶段要求且生产已设置两个彼此独立的随机 secret：`REDIS_PASSWORD`（32-byte hex）与 `RATE_LIMIT_HMAC_SECRET`（至少 32 bytes）。0041–0043 另要求 `AI_INTERNAL_TOKEN`（至少 32 bytes）和 `OPENROUTER_API_KEY`。workflow 通过 stdin 安装脚本原子写入 mode-600 API/AI/Redis env，不打印值；AI 不获得 service-role/Redis/Azure，Redis 不获得 Supabase/provider secrets。Materials AI 的 `OPENROUTER_API_KEY` 与既有 Courses OpenRouter 使用同一生产 secret，但只注入确有需要的 API/AI 消费者。

> **2026-07-21 Supabase 暂停事故与恢复：** 项目暂停期间，生产 Ref 在公共 DNS 返回 `NXDOMAIN`，严格 readiness 正确阻止了新版本激活；恢复后 DNS、JWKS 和服务器 service-role PostgREST 探针恢复。0008–0010 随后发布，0011–0013 又于 2026-07-22 按受保护流程发布。不得因依赖暂停而降低 health 门禁。

首次增加 `SERVER_SSH_KNOWN_HOSTS` 时，在可信网络取得 host key，用 `ssh-keygen -lf` 查看 fingerprint，并通过服务器控制台/云厂商记录进行第二通道核对后，才把完整 known_hosts 行写入 Secret。不要直接把未经核验的 `ssh-keyscan` 输出当作信任根。`DB_BACKUP_ENCRYPTION_KEY` 应使用密码学随机值生成，并在 GitHub 之外的受控恢复保管中保存副本。

## 流程

推送非纯文档变更到 `main` 即触发 [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)：check + Python/AI image + 真实 Redis/BullMQ → 自动暂存 0008 及以后迁移并验证 0007→最新升级 → 空库重建 → db lint → 本地真实 RLS/Storage/points/Courses/AI E2E → nginx `-t` → fake-provider Playwright。无新 migration 时继续不可变应用部署；有新 migration 时普通 push 在验证后停止。owner 先手动执行只读 plan，再单独 apply；数据库发布成功后才继续。服务器先以 `FEATURE_MATERIAL_AI=false` 安装 secrets 并启动 Redis/FastAPI，验证 `deps.supabase=ok`、`deps.redis=ok` 和 AI readiness/清理器/资源 canary，再执行固定无个人数据的真实 DeepSeek/MiMo ZDR 生成与评分 smoke。任一 gate 失败都不启用功能或切换 Web；应用 smoke 失败恢复上一 Web symlink/API/AI images，数据库只向前修复。

手动 `workflow_dispatch` 默认只重发应用；`plan_database_migrations` 只展示远端计划且不改库/不部署，`apply_database_migrations` 才创建恢复点、迁移并继续应用部署，两者不能同时选择。部署要求真实供应商 gates 成功、API JSON 的 `status/service/deps.supabase=ok/deps.redis=ok`、AI 专用 readiness 为 ok，并从公网检查注册/普通 API RateLimit headers、管理拒绝、Web/API root 与登录用户完整 Materials→Notes→考试链。Playwright fake、mock Redis、固定假 provider 或本地构建不能替代生产证据。

仓库 nginx 参考配置为 `/api/` 设置 `client_max_body_size 10m`，与 Nest 的课程 JSON 上限一致。生产 0039 由受限安装脚本在同一 Nalanda server block 叠加 API 20 r/s burst 40、注册 1 r/s burst 3，以及标准 JSON 429、`Retry-After`/RateLimit headers；只在 `nginx -t` 通过后 reload，不修改其它站点。朗读 WAV 仍由 API 的 2 MB multipart 限制收口。

纯 Markdown 变更由 [docs workflow](../../.github/workflows/docs.yml) 校验文档定位字段和相对链接，不重新部署应用。

> 安全待办：当前记录的部署用户是 root。应迁移为最小权限 deploy 用户，只授予 `/opt/nalanda`、受控 Docker/服务操作和 nginx reload 能力，并轮换现有部署密钥。

## 服务器维护速查

```bash
cd /opt/nalanda
docker compose --env-file .deploy.env ps
docker compose --env-file .deploy.env logs --tail=50 api
docker compose --env-file .deploy.env logs --tail=50 ai
docker compose --env-file .deploy.env logs --tail=50 redis
docker compose --env-file .deploy.env restart api
docker compose --env-file .deploy.env restart ai
docker compose --env-file .deploy.env exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" ping'
readlink -f web
cat .deploy.env
```

不要手工把 `nalanda-api:latest` 覆盖成新版本；当前 release 使用 Git SHA tag。手动回退时应按失败 workflow 保存的上一 image/web release 双人复核，并确认新数据库 schema 仍兼容旧应用。Redis 是限流/锁的可重建运行依赖，不是 points 或课程事实源；应用回退后可继续运行，不能用删除 AOF 代替数据库恢复。
