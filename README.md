# Nalanda

> **文档定位**
> - **内容**：项目入口、当前可用能力、真实/mock 边界、快速开始和文档导航。
> - **作用**：让首次进入仓库的人在几分钟内知道“项目现在是什么、如何运行、下一步去哪里看”。
> - **何时更新**：模块状态、启动命令、线上入口、技术栈或文档导航变化时；不得把蓝图功能提前写成已实现。

> 以古印度那烂陀大学命名——世界上最早的知识殿堂。

Nalanda 的最终目标是把大学课程资料转化为知识清单、交互测验、知识图谱和模拟试卷，并围绕这些知识资产提供学习计划、社区、成长和交易能力。

在线环境（仓库文档所记录）：[https://nalanda.online](https://nalanda.online)。本 README 不承担线上可用性监控证明。

## 当前状态

| 模块 | 当前实现 |
|---|---|
| 注册 / 登录 / 退出 | ✅ Supabase Auth；注册经 NestJS service-role 接口创建已确认账号 |
| Materials | ✅ Supabase 表 + 私有 Storage + RLS；课程、上传、预览、下载、删除 |
| Community | ✅ 发帖、评论、赞藏、转发、关注、标签、图片/音频；数据在 Supabase |
| Schedule | ✅ 任务、目标、课程/资料关联、积分和 streak；“智能填充”为规则式生成 |
| Profile / 通知 / 反馈 | ✅ 真实数据；通知当前是查询刷新，不是 Realtime |
| Home | 🟡 高保真 mock，统计/课程/活动不是真实聚合 |
| Notes / AI Create | 🟡 高保真 mock；FastAPI 只是桩，未形成解析/生成/落库链路 |
| Note Market / credits / VIP / 支付 | 🟡 UI mock 或预留字段；无账本、订单或 Stripe |
| Electron / React Native / 完整 i18n | ⬜ 未开始 |

这里的“真实”主要表示浏览器真实读写 Supabase 并受 RLS 保护；目前并非所有业务都经过 NestJS。已知权限和积分完整性问题见 [当前架构](docs/ARCHITECTURE.md)。

## 当前技术结构

- Web：React 18 + Vite 鉴权壳，内部挂载 legacy DOM 应用。
- 数据/Auth/Storage：Supabase PostgreSQL、Auth、Storage、RLS。
- API：NestJS，目前只有 health、register、me。
- AI：FastAPI 骨架和固定桩输出，未接入生产。
- 共享：pnpm + Turborepo；`packages/ui` 是 CSS 包，`packages/types` 尚未被应用消费。
- 生产：GitHub Actions 构建，宿主 nginx 托管 Web，Docker 运行 API，Supabase 使用云服务。

## 仓库入口

- `apps/web`：生产 Web。
- `apps/api`：当前 NestJS 薄 API。
- `apps/ai`：AI 桩。
- `app/`：独立静态桌面/移动原型和 Showcase，不是生产应用入口。
- `supabase/migrations`：当前 7 个数据库迁移。
- `infra/deploy`：当前生产部署配置。
- `infra/hybrid-2g`：未来 AI/Redis 接入时的通用部署模板。

## 快速开始

要求：Node 20、pnpm 9.12.3；真实登录和业务数据需要 Supabase 项目。

```bash
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env

pnpm --filter @nalanda/api build
pnpm --filter @nalanda/api start
pnpm --filter @nalanda/web dev
```

完整的从零环境、AI Python 环境和数据库准备见 [本地开发手册](docs/guides/LOCAL_DEVELOPMENT.md)。

常用校验：

```bash
pnpm check   # docs:check + typecheck + test + build
```

需要真实 Supabase 凭据的两用户 RLS E2E 不应默认打生产；具体命令和安全开关见 [测试指南](docs/guides/TESTING.md)。

## 静态设计原型

不配置后端也可查看原型：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000/
```

根入口会跳转到 `app/Nalanda Showcase.html`。静态原型依赖 Google Fonts、unpkg React/Babel，并不完全离线；其中所有业务数据都是 mock。

## 文档导航

- [文档总索引](docs/README.md)
- [最终项目说明与开发路线图](docs/PROJECT_BLUEPRINT.md)
- [当前实现架构](docs/ARCHITECTURE.md)
- [实现笔记](docs/notes/README.md)
- [ERD](docs/guides/ERD.md) / [API](docs/guides/API.md)
- [环境变量矩阵](docs/guides/ENVIRONMENT_VARIABLES.md) / [测试指南](docs/guides/TESTING.md)
- [数据库发布与回滚](docs/operations/DATABASE_RELEASE_ROLLBACK.md)
- [安全政策](SECURITY.md) / [贡献指南](CONTRIBUTING.md) / [变更记录](CHANGELOG.md)

## 规划中的核心能力

最终产品会覆盖真实 AI 解析与四类学习资产、个人笔记、真实 Home、市场/credits/Stripe、内容治理、Realtime、管理端、双语、Electron 和 React Native。它们的依赖、顺序和验收标准只以 [PROJECT_BLUEPRINT.md](docs/PROJECT_BLUEPRINT.md) 为准。

## 许可证状态

仓库历史 README 声明 MIT，但当前没有独立 `LICENSE` 文件；在正式对外发布前必须补齐准确许可证。计划参考的 ExamPass-Assistant 使用 CC BY-NC 4.0，商业项目不得在未获授权时直接复用其非商业代码。
