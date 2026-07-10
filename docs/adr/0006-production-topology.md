# ADR-0006：当前生产采用 nginx + Web/API 容器 + Supabase Cloud

> **本文内容：**记录当前已上线生产拓扑，并把它与未部署的混合/目标拓扑分开。  
> **作用：**让部署、监控和故障排查围绕真实运行系统，而不是早期 Vercel/Railway 或 2G 脚手架假设。  
> **何时更新：**生产入口、主机、容器、域名、Supabase、AI/Redis 部署或发布方式变化时。  
> **状态基线：**2026-07-10；敏感主机信息和密钥不写入 ADR。

- **状态：**Accepted
- **日期：**2026-06-24
- **决策者：**项目维护者
- **范围：**当前生产部署

## 背景

最初蓝图讨论 Vercel + Railway + Supabase，也提供 Caddy/API/AI/Redis 的 2G 混合脚手架。实际生产 CI 使用 nginx 提供静态 Web 并把 `/api` 反代给 NestJS API，业务数据继续使用 Supabase Cloud。

## 决策

- 当前生产事实以 `.github/workflows/deploy.yml`、`infra/deploy/docker-compose.yml` 和 nginx 配置为准。
- nginx 是公网入口，提供 Web 静态产物并反代 `/api`；NestJS API 运行于容器；Supabase Cloud 承担 Auth/Postgres/Storage。
- 当前不把 FastAPI AI、Redis、Stripe、pgvector、Electron、React Native 或 Supabase Realtime 声称为已生产部署。
- `infra/hybrid-2g` 保留为候选脚手架，不是当前运行手册；启用前需新的容量、安全、备份、监控和回滚评审。

## 后果

部署路径与当前能力匹配，成本低；但单机/容器发布的可用性、回滚、观测和资源隔离有限。文档必须避免将候选配置中的环境变量或服务误报为线上依赖。

## 当前实现与目标差距

- **当前：**PR/main 会执行 typecheck、Web jsdom、API readiness unit、build、本地 Supabase 升级/重建/lint/RLS E2E；新增 migration 在加密恢复点后通过受保护 environment 发布；应用以 Git SHA release 部署并自动回退上一 Web/API；health 会探测 Supabase JWKS/PostgREST。
- **当前限制：**health 尚不证明 Storage、真实注册/登录、完整 RLS 或全部业务路径；数据库不自动逆向；Storage bytes、异地 artifact、持续监控和完整恢复演练仍缺失。
- **目标：**增加 staging/canary、异地 artifact/Storage 备份、完整恢复演练、结构化日志和 SLO 告警；AI/Redis/Stripe 只有达到各自门禁后才加入拓扑。

## 验证与复审

每次发布记录版本、迁移、健康/冒烟结果和回滚点。增加第二台主机、托管平台或 AI worker 时新建/更新 ADR，并同步运维文档。
