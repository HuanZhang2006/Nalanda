# Nalanda 实现笔记 · 总览

这套笔记记录**每个板块到底是怎么实现的、为什么这么做、踩过哪些坑、以后怎么扩展**，用于复盘与边开发边学习。架构层面的总规划见 [../ARCHITECTURE.md](../ARCHITECTURE.md)；这里讲的是**已经落地的代码**。

> 阅读顺序建议：先看本篇 → [01 前端架构](01-frontend-architecture.md)（理解整体怎么跑起来）→ 关心哪块看哪块。

## 当前实现状态

| 板块 | 状态 | 笔记 |
|---|---|---|
| 注册 / 登录 / 退出（Auth） | ✅ 真后端 | [02-auth.md](02-auth.md) |
| 数据库 / 迁移 / RLS | ✅ 真后端 | [03-database-and-migrations.md](03-database-and-migrations.md) |
| Materials 资料库 | ✅ 真后端 | [04-materials.md](04-materials.md) |
| 部署 / CI / 域名 | ✅ 已上线 | [05-deployment-and-ci.md](05-deployment-and-ci.md) |
| 前端架构 / 原型移植 | ✅ | [01-frontend-architecture.md](01-frontend-architecture.md) |
| Home / Notes / Market / Community / Schedule / Profile / Feedback | 🟡 原型 + 假数据 | [06-prototype-modules.md](06-prototype-modules.md) |
| AI 笔记生成 | ⬜ 未做 | — |
| 支付 / 积分 | ⬜ 未做 | — |

✅ 真后端　🟡 仅前端原型（mock）　⬜ 未开始

## 一张图看懂运行时

```
浏览器 (nalanda.online)
   │  HTTPS
   ▼
宿主机 nginx ── 静态前端 (React 产物)            ← 页面、JS、CSS
   │            └─ /api/* 反代 → 127.0.0.1:8411  → NestJS 后端 (注册、/api/me…)
   │
   └─ 前端用 supabase-js 直连 Supabase（带用户 JWT）：
         · Auth（登录/会话）
         · 数据库表（profiles / courses / materials，RLS 隔离）
         · Storage（私有桶 materials）
后端 NestJS 也连 Supabase（service_role）做需要服务端权限的事（如注册建号）。
```

**两条数据通道**，是理解全栈的关键：
1. **前端 → NestJS（/api）**：需要服务端逻辑/密钥的操作（注册用 service_role 建号、将来 AI 生成、支付）。
2. **前端 → Supabase（supabase-js 直连）**：用户自有数据的增删查（登录态、profiles、courses、materials、文件），靠 **RLS（行级安全）** 在数据库层保证「只能动自己的」。

这套「能直连就直连 + 需要服务端才走后端」的取舍贯穿全项目，每篇笔记都会再提到。

## 仓库里和实现相关的关键位置

```
apps/web/        前端（React + 移植自原型的应用）
  src/App.tsx        鉴权门（登录页 ↔ 应用）
  src/NalandaApp.tsx  把移植的应用挂进 React
  src/lib/            supabase 客户端 + 带令牌的 fetch
  src/legacy/         移植自原型的 vanilla 应用（app/data/icons/materials）
apps/api/        后端 NestJS（auth 注册、/api/me、健康检查、JWKS 验签守卫）
packages/ui/     设计令牌 nalanda.css
supabase/migrations/  数据库迁移（SQL）
scripts/db-push.mjs   一条命令应用所有迁移
infra/           部署配置（hybrid-2g 通用版 + deploy 生产版）
.github/workflows/deploy.yml  push 到 main 自动部署
```
