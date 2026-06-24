# Nalanda 实现笔记（复盘 / 学习）

按板块记录已落地功能的**技术方案、实现细节、逻辑流程、踩坑与验证**，便于复盘与学习。
总体架构与路线图见 [../ARCHITECTURE.md](../ARCHITECTURE.md)。

| 笔记 | 内容 |
|---|---|
| [01-工程基建与 monorepo](01-monorepo-foundation.md) | pnpm + Turborepo 单仓、目录结构、共享包（types/ui）、构建链路 |
| [02-用户系统与认证](02-auth-and-user-system.md) | Supabase Auth、JWKS 验签、自建注册接口、profiles + RLS、登录前端 |
| [03-部署架构与 CI/CD](03-deployment-and-cicd.md) | 托管 + 自托管混合、nginx 隔离、GitHub Actions 流水线、踩坑实录 |
| [04-前端与原型复现](04-frontend-and-prototype-port.md) | React + Vite、设计令牌、把 Claude Design 原型搬进生产应用 |
| [05-数据库 / 迁移 / RLS](05-database-and-rls.md) | Supabase Postgres、owner-only RLS 模式、迁移幂等写法、`db-push` 自动化 |
| [06-Materials 资料库](06-materials.md) | 第一个真后端模块：courses/materials + Storage + RLS、上传/下载/删除、越权修复 |
| [07-原型模块（待接后端）](07-prototype-modules.md) | 仍用假数据的模块现状 + 各自接真后端要补什么 + 升级范式 |

> 状态：截至当前，已实现「注册 / 登录 + **Materials 资料库**（真后端）+ 其余前端模块（假数据）+ nalanda.online 生产部署 + CI/CD + 迁移自动化」。其余模块接真后端的工作待续。
