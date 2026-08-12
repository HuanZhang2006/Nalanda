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
| Materials | ✅ Supabase 表 + 私有 Storage + RLS；课程、上传、预览、下载、删除。生产 0041–0043 已为每个受支持文件上线服务端 “Generate test paper”、持久队列、安全解析和实时进度 |
| Community | ✅ 发帖、评论、赞藏、转发、关注、标签、图片/音频；生产 0039–0040 已收紧帖子可信列并启用 points 日上限、人工审核冲正与只标记协同检测 |
| Schedule | ✅ 任务、目标、课程/资料关联、幂等积分和 streak；生产 0039–0040 已启用关联 owner trigger、数据库维护 `done_at` 和任务奖励日上限；“智能填充”为规则式生成 |
| Courses / Course Market | ✅ 生产已上线英语词表文本导入、编辑、四阶段学习、复习、Schedule/Profile、免费分享/市场、徽章与积分、即时反馈、幂等弱网答题、持久音频预热、浏览器离线音频、按意图独立续学、显式取消、可选限时拼写、OpenRouter 语义翻译前测、中文翻译语音输入、统一录音波形、轮末错题复盘、默认 90% 可调阈值的拼写/读音考试、复习/考试任意选词、失败考试补练自动结束、考试历史详情和编辑器学习属性；Courses 功能迁移到 0038，生产总 history 已到 0043。词汇只有拼写考试和发音考试均通过才算已学习，`learned_at` 由数据库 trigger 精确派生为两个考试通过时间的较晚值；首次学习、复习、单项考试或手工赋值都不能形成掌握。发音录音已移除本地 VAD/静音裁剪，只保留 Azure 要求的 PCM 格式转换。 |
| Profile / Growth / 通知 / 反馈 | ✅ Profile 敏感列由服务端维护，points 有冲正账本；生产 0039–0040 已把 Feedback 收敛为用户只读/新增，并启用奖励日上限、回执/通知与审核审计；通知当前是查询刷新，不是 Realtime |
| Home | 🟡 高保真 mock，统计/课程/活动不是真实聚合 |
| Notes / AI Create | 🟡 My Notes 的历史演示卡片继续保留为 Demo；生产 0041–0043 已接入 Materials 课程下的私有生成试卷、在线考试与主观题异步评分。未发布候选代码另实现知识点图谱、节点问答和可恢复长任务；独立 AI Create 仍为 mock |
| Note Market / credits / VIP / 支付 | 🟡 Note Market 仍为 Demo，Course Market 只支持免费克隆；无 credits 账本、订单或 Stripe |
| Courses 文件导入 / 其他类别 | ⬜ PDF/Word/JSON/Markdown/HTML/图片仅有禁用入口；AI 解析、知识点/阅读理解/题库训练未实现 |
| Electron / React Native / 完整 i18n | ⬜ 未开始 |

旧模块大多由浏览器直连 Supabase；Courses 和 Materials AI 的业务写入都经过 NestJS 与 service-role 专用事务 RPC。生产已于 2026-08-10 完成 0039–0040 安全第一阶段，随后于 2026-08-11 通过独立只读 plan、加密恢复点、0041–0043 远端验证、2G 资源 canary、真实 DeepSeek/MiMo/Azure/OpenRouter 门禁、登录用户完整链路和不可变应用发布启用 Materials AI。当前所有用户 Free，每个 Profile 本地日期分别有 10 次成功生成和 10 次成功主观题评分；只有成功才消耗，拒绝/失败/取消释放预留，不读取 credits。时间列撤权第二阶段仍须等 0039–0040 兼容观察通过后另行追加为未来 0044–0045。完整离线 PWA、销售 credits/VIP 商业账本仍未实现。其余边界与发布证据见[当前架构](docs/ARCHITECTURE.md)和[部署记录](docs/notes/03-deployment-and-cicd.md)。

当前分支的 **Unreleased** 候选追加 0046–0048：内部生成/评分改为 202 + 持久回调，修复 Undici 五分钟响应头超时误报；provider usage 和已验证产物支持 24 小时双层断点恢复；Materials 增加真实知识点梳理、交互图谱与节点问答。此段是代码状态，不是生产声明；上线前仍须通过真实 Supabase、真实 OpenRouter、资源 canary 和受保护发布。

## 当前技术结构

- Web：React 18 + Vite 鉴权壳，内部挂载 legacy DOM 应用。
- 数据/Auth/Storage：Supabase PostgreSQL、Auth、Storage、RLS。
- API：NestJS，提供 health/auth/me、Courses、语音/AI 适配和 points 管理接口；生产已启用 ioredis 原子限流、协同扫描器和真实 Redis readiness。
- AI：生产 0041–0043 使用内网 FastAPI、确定性解析器、固定 OpenRouter ZDR 模型和严格 schema；NestJS 以 Postgres 任务事实 + BullMQ/Redis 调度。Unreleased 候选把长任务改为快速接收/回调，并增加可恢复图谱与节点问答。
- 共享：pnpm + Turborepo；`packages/ui` 是 CSS 包，Courses 的 camelCase 契约由 `packages/types` 在 Web/API 共用。
- 生产：GitHub Actions 构建，宿主 nginx 托管 Web，Docker 运行 API、隔离 FastAPI AI worker 与仅容器内网可达、密码认证、AOF everysec 的 Redis；Supabase 继续使用云服务。

## 仓库入口

- `apps/web`：生产 Web。
- `apps/api`：NestJS 鉴权/健康检查，以及 Courses、学习会话、语音、分享和课程市场的服务端边界。
- `apps/ai`：生产 Materials AI 隔离 worker；解析 PDF/Office/文本/图片并只恢复失败视觉范围，内部 token 认证，不是公网服务。
- `app/`：独立静态桌面/移动原型和 Showcase，不是生产应用入口。
- `supabase/migrations`：追加式迁移；生产 migration history 已到 0043。仓库候选 0046–0048 是尚未部署的 Materials AI 恢复/图谱迁移；时间列撤权 contract 仍另行顺延，不能与候选编号混称。
- `infra/deploy`：当前生产部署配置。
- `infra/hybrid-2g`：未来 AI/BullMQ 接入时的通用部署模板；当前生产 Redis 配置在 `infra/deploy`，两者不可混称。

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
pnpm check   # docs:check + release-tool tests + code lint + typecheck + test + build
```

默认 `pnpm test` 运行 Web jsdom 与 API 单元测试，不连接外部项目；真实 RLS 套件只有在显式安全开关下运行。PR/main CI 还启动真实 Redis 与一次性本地 Supabase，验证 Lua 原子窗口、0007→最新、空库重建、帖子/Feedback/Schedule 权限、points 并发上限/审核/协同信号及 Courses，并以供应商 fake 运行 Playwright。生产应用激活前仍执行真实 Azure/OpenRouter/Fish gates，同时要求 `deps.supabase=ok` 和 `deps.redis=ok`。本地跳过的 Redis/RLS、jsdom 或 fake provider 都不能称为对应真实 E2E，见[测试指南](docs/guides/TESTING.md)。

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

Materials 文件生成试卷与在线考试第一阶段已经上线；Knowledge list、独立 Quiz 仍显示 Coming soon。仓库候选已实现 Knowledge graph/节点问答和可恢复长任务，但在 CI、真实供应商门禁和受保护生产发布完成前不计为线上功能。后续还会覆盖 Courses 文件 AI 解析、其它 AI 产物、真实 Home、笔记市场/credits/Stripe、完整内容治理、Realtime、管理端、双语、Electron 和 React Native。依赖、顺序和验收标准只以 [PROJECT_BLUEPRINT.md](docs/PROJECT_BLUEPRINT.md) 为准。

## 许可证状态

仓库历史 README 声明 MIT，但当前没有独立 `LICENSE` 文件；在正式对外发布前必须补齐准确许可证。计划参考的 ExamPass-Assistant 使用 CC BY-NC 4.0，商业项目不得在未获授权时直接复用其非商业代码。
