# 生产部署（nalanda.online）

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

推送到 `main` 即触发 [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)：构建 → 上传 → 服务器 `docker load` + `docker compose up -d` + 健康自检。也可在 Actions 页手动 `workflow_dispatch`。

## 服务器维护速查

```bash
cd /opt/nalanda
docker compose ps
docker compose logs --tail=50 api
docker compose restart api
```
