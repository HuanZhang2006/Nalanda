# Nalanda 实现笔记（复盘 / 学习）

> **文档定位**
> - **内容**：按模块索引实现方案、历史取舍、踩坑和可执行验证入口。
> - **作用**：帮助复盘现有实现；它不是最终产品蓝图，也不替代当前架构、ERD 或 API 文档。
> - **何时更新**：新增/重构模块、历史结论被代码改变、验证命令或模块状态变化时。

按板块记录已落地功能的**技术方案、实现细节、逻辑流程、踩坑与验证**，便于复盘与学习。
当前架构见 [../ARCHITECTURE.md](../ARCHITECTURE.md)，最终蓝图与路线图见 [../PROJECT_BLUEPRINT.md](../PROJECT_BLUEPRINT.md)。

| 笔记 | 内容 |
|---|---|
| [01-工程基建与 monorepo](01-monorepo-foundation.md) | pnpm + Turborepo 单仓、目录结构、共享包（types/ui）、构建链路 |
| [02-用户系统与认证](02-auth-and-user-system.md) | Supabase Auth、JWKS 验签、自建注册接口、profiles + RLS、登录前端 |
| [03-部署架构与 CI/CD](03-deployment-and-cicd.md) | 托管 + 自托管混合、nginx 隔离、GitHub Actions 流水线、踩坑实录 |
| [04-前端与原型复现](04-frontend-and-prototype-port.md) | React + Vite、设计令牌、把 Claude Design 原型搬进生产应用 |
| [05-数据库 / 迁移 / RLS](05-database-and-rls.md) | Supabase Postgres、owner-only RLS、CLI history、本地重建与旧 `db-push` 边界 |
| [06-Materials 资料库](06-materials.md) | 第一个真后端模块：courses/materials + Storage + RLS、上传/下载/预览/删除 |
| [07-原型模块（剩余 mock）](07-prototype-modules.md) | 仍用假数据的模块（Home / Notes / Create / Market）+ 升级范式 |
| [08-通知 / 反馈 / 个人资料](08-notifications-feedback-profile.md) | 通知面板、反馈、Profile 真数据、受保护 points projection + 分级徽章 |
| [09-社区](09-community.md) | 发帖/评论/点赞/收藏/转发/关注、媒体、points 稳定业务键/冲正和通知联动 |
| [10-学习计划](10-schedule.md) | 任务/目标、幂等完成奖励 + 连续学习、关联课程资料、智能填充 |

> 状态：已接 Supabase 真数据 —— 注册/登录、**Materials、社区、学习计划、通知、反馈、个人资料（points 账本/等级/徽章）**，以及 Web/API 生产部署。剩余 mock：Home / AI 笔记生成（Create + Notes）/ 笔记市场 / 支付。PR/main 已有本地升级/空库迁移/RLS 门禁，生产新增迁移经受保护 environment、加密恢复点和 CLI history 发布；数据库失败采用阻断/forward-fix/隔离恢复，应用 smoke 失败自动回退上一 release。
