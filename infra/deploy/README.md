# 生产部署（nalanda.online）

> **文档定位**
> - **内容**：记录当前生产服务器上的 Web/API/nginx 拓扑、部署依赖和维护入口。
> - **作用**：帮助理解现网布局；正式发布、数据库变更、备份与恢复应按 operations 手册执行。
> - **何时更新**：域名、服务器、CI、compose、nginx/TLS、部署账号或密钥位置变化时。

服务器已运行多个项目（共用 nginx + uofa.ink）。Nalanda 以**隔离、可叠加**的方式接入，不影响既有服务。

## 拓扑

```
GitHub push → Actions（在 runner 上构建，不占服务器内存）
  ├─ 前端 vite build → web.tgz
  └─ 后端 docker build → nalanda-api 镜像 → docker save
        │ scp / ssh
        ▼
服务器 /opt/nalanda/
  ├─ docker compose（api，仅 127.0.0.1:8411）
  ├─ web/（静态产物，宿主机 nginx 托管）
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
| `VITE_SUPABASE_URL` | https://xsjlmyarvyloktoclvwn.supabase.co |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon 公钥 |

## 流程

推送非纯文档变更到 `main` 即触发 [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)：安装 → typecheck → 默认 jsdom 测试 → 构建 → 上传 → 服务器 `docker load` + `docker compose up -d` + 健康自检。需要真实 Supabase 的 RLS E2E 不在默认部署 job 中。也可在 Actions 页手动 `workflow_dispatch`。

纯 Markdown 变更由 [docs workflow](../../.github/workflows/docs.yml) 校验文档定位字段和相对链接，不重新部署应用。

> 安全待办：当前记录的部署用户是 root。应迁移为最小权限 deploy 用户，只授予 `/opt/nalanda`、受控 Docker/服务操作和 nginx reload 能力，并轮换现有部署密钥。

## 服务器维护速查

```bash
cd /opt/nalanda
docker compose ps
docker compose logs --tail=50 api
docker compose restart api
```
