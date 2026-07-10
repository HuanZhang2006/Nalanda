# 生产部署（nalanda.online）

> **文档定位**
> - **内容**：记录当前生产服务器上的 Web/API/nginx 拓扑、部署依赖和维护入口。
> - **作用**：帮助理解现网布局；正式发布、数据库变更、备份与恢复应按 operations 手册执行。
> - **何时更新**：域名、服务器、CI、compose、nginx/TLS、部署账号或密钥位置变化时。

服务器已运行多个项目（共用 nginx + uofa.ink）。Nalanda 以**隔离、可叠加**的方式接入，不影响既有服务。

## 拓扑

```
GitHub push → Actions（在 runner 上构建，不占服务器内存）
  ├─ check + 0007→0008 升级夹具 + 本地 Supabase 重建/lint/RLS E2E
  ├─ 新迁移：dry-run → 加密恢复点 → protected DB push → 验证
  ├─ 前端 vite build → Git SHA release/web
  └─ 后端 docker build → nalanda-api:<git-sha> → docker save
        │ scp / ssh
        ▼
服务器 /opt/nalanda/
  ├─ docker compose（.deploy.env 选择不可变 API image）
  ├─ releases/<release-id>/web + web 原子 symlink
  └─ .env（Supabase 密钥，仅服务器持有，不入库/不进 CI）
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
| `VITE_SUPABASE_URL` | https://xsjlmyarvyloktoclvwn.supabase.co |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon 公钥 |

`production-database` environment 还需 `SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD`、`SUPABASE_PROJECT_REF` 和 `DB_BACKUP_ENCRYPTION_KEY`，并应设置 required reviewer。数据库 migration history 的首次 baseline 不能由 CI 猜测，步骤见[数据库发布手册](../../docs/operations/DATABASE_RELEASE_ROLLBACK.md)。

首次增加 `SERVER_SSH_KNOWN_HOSTS` 时，在可信网络取得 host key，用 `ssh-keygen -lf` 查看 fingerprint，并通过服务器控制台/云厂商记录进行第二通道核对后，才把完整 known_hosts 行写入 Secret。不要直接把未经核验的 `ssh-keyscan` 输出当作信任根。`DB_BACKUP_ENCRYPTION_KEY` 应使用密码学随机值生成，并在 GitHub 之外的受控恢复保管中保存副本。

## 流程

推送非纯文档变更到 `main` 即触发 [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)：check → 0007→0008 升级夹具 → 从空库重建本地 Supabase → db lint → 本地真实 RLS/Storage/points E2E → 可选生产 DB 发布 → 不可变应用部署。新增 migration 时，数据库失败会阻断应用；应用本地或外部 smoke 失败会恢复上一 Web symlink/API image，但不会危险地自动逆向数据库。

手动 `workflow_dispatch` 默认只重发应用；只有显式选中 `apply_database_migrations` 才进入受保护数据库 job。部署要求 API JSON 的 `status/service/deps.supabase=ok`（内部已探测 JWKS/PostgREST），并从公网检查 API 和 Web root，不再只判断任意 HTTP 200。

纯 Markdown 变更由 [docs workflow](../../.github/workflows/docs.yml) 校验文档定位字段和相对链接，不重新部署应用。

> 安全待办：当前记录的部署用户是 root。应迁移为最小权限 deploy 用户，只授予 `/opt/nalanda`、受控 Docker/服务操作和 nginx reload 能力，并轮换现有部署密钥。

## 服务器维护速查

```bash
cd /opt/nalanda
docker compose --env-file .deploy.env ps
docker compose --env-file .deploy.env logs --tail=50 api
docker compose --env-file .deploy.env restart api
readlink -f web
cat .deploy.env
```

不要手工把 `nalanda-api:latest` 覆盖成新版本；当前 release 使用 Git SHA tag。手动回退时应按失败 workflow 保存的上一 image/web release 双人复核，并确认新数据库 schema 仍兼容旧应用。
