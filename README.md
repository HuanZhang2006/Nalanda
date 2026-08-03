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
| Schedule | ✅ 任务、目标、课程/资料关联、幂等积分和 streak；“智能填充”为规则式生成 |
| Courses / Course Market | ✅ 生产已上线英语词表文本导入、编辑、四阶段学习、复习、Schedule/Profile、免费分享/市场、徽章与积分、即时反馈、幂等弱网答题、持久音频预热、浏览器离线音频、按意图独立续学、显式取消、可选限时拼写、OpenRouter 语义翻译前测、轮末错题复盘、默认 90% 可调阈值的拼写/读音考试、复习/考试任意选词、失败考试补练自动结束、考试历史详情和编辑器学习属性；生产迁移已到 0036。词汇只有拼写考试和发音考试均通过才算已学习，`learned_at` 由数据库 trigger 精确派生为两个考试通过时间的较晚值；首次学习、复习、单项考试或手工赋值都不能形成掌握。发音录音已移除本地 VAD/静音裁剪，只保留 Azure 要求的 PCM 格式转换。 |
| Profile / Growth / 通知 / 反馈 | ✅ Profile 敏感列由服务端维护，points 有冲正账本；通知当前是查询刷新，不是 Realtime |
| Home | 🟡 高保真 mock，统计/课程/活动不是真实聚合 |
| Notes / AI Create | 🟡 高保真 mock；FastAPI 只是桩，未形成解析/生成/落库链路 |
| Note Market / credits / VIP / 支付 | 🟡 Note Market 仍为 Demo，Course Market 只支持免费克隆；无 credits 账本、订单或 Stripe |
| Courses 文件导入 / 其他类别 | ⬜ PDF/Word/JSON/Markdown/HTML/图片仅有禁用入口；AI 解析、知识点/阅读理解/题库训练未实现 |
| Electron / React Native / 完整 i18n | ⬜ 未开始 |

旧模块大多由浏览器直连 Supabase；Courses 的所有业务写入都经过 NestJS 与 service-role 专用事务 RPC。生产已于 2026-07-22 发布 0011–0013、2026-07-23 发布 0014，2026-07-27 发布 0015–0018，2026-07-28 发布 0019–0020，2026-07-31 同步到 0024，2026-08-01 同步到 0028，并于 2026-08-04 经独立只读 plan、加密恢复点、apply、远端验证和不可变应用发布同步到 0036。限时拼写、翻译前测、显式取消、轮末错题复盘、拼写/读音考试、任意选词和考试历史均已在线：客户端只负责计时与即时显示，语义判定、错误事实、retry pool、考试分数、双考试掌握、熟练度和奖励继续由服务端决定；规范化完全匹配由服务端零 token 判定，非字面同义/改写才调用 OpenRouter，默认每用户 20 次/分钟、滚动 24 小时仅真实 provider 请求 500 次。拼写答案与原始词条在 Web 和数据库两侧执行同一 NFKC、Unicode 空白和 ASCII 大小写规则，并以“保留标点、移除标点、把标点视为空格”三路比较，因此仅标点遗漏、替换或增加不会记错，真实字母、数字、词序和无标点参与的词间空格错误仍会进入候补池。用户输入正文只在请求内存中转发，数据库仅留 SHA-256、判定和计量。文件 AI 导入仍是禁用入口；完整离线 PWA app shell 不在本次范围；credits/VIP 仍只是客户端不可写的预留缓存，不是商业账本。其余边界与发布证据见[当前架构](docs/ARCHITECTURE.md)和[部署记录](docs/notes/03-deployment-and-cicd.md)。

## 当前技术结构

- Web：React 18 + Vite 鉴权壳，内部挂载 legacy DOM 应用。
- 数据/Auth/Storage：Supabase PostgreSQL、Auth、Storage、RLS。
- API：NestJS，提供 health/auth/me 与 Courses、会话/复习、语音、分享、课程市场、学习 Profile 聚合和可选 OpenRouter 语义翻译评判接口。
- AI：FastAPI 骨架和固定桩输出，未接入生产。
- 共享：pnpm + Turborepo；`packages/ui` 是 CSS 包，Courses 的 camelCase 契约由 `packages/types` 在 Web/API 共用。
- 生产：GitHub Actions 构建，宿主 nginx 托管 Web，Docker 运行 API，Supabase 使用云服务。

## 仓库入口

- `apps/web`：生产 Web。
- `apps/api`：NestJS 鉴权/健康检查，以及 Courses、学习会话、语音、分享和课程市场的服务端边界。
- `apps/ai`：AI 桩。
- `app/`：独立静态桌面/移动原型和 Showcase，不是生产应用入口。
- `supabase/migrations`：仓库当前 36 个追加式迁移；0008–0010 完成安全/points 修复，0011–0013 建立 Courses 数据、事务工作流和发布断言，0014 补齐朗读阈值候补池与认词候补轮推进；0015–0016 增加会话 revision、幂等 attempt、单 RPC snapshot、服务端音频队列和结构/权限断言；0017–0018 增加按意图恢复及发布断言；0019–0020 增加限时拼写与翻译语义判定；0021–0022 统一 Unicode 拼写归一化；0023–0024 增加仅标点差异容错；0025–0026 增加显式取消会话；0027–0028 增加拼写轮末复盘、考试模式和仅真实模型调用计数的滚动配额；0029–0030 增加读音考试，0031–0032 增加自定义选词、失败补练完成事实与考试历史，0033–0034 增加双考试掌握事实、唯一 `learned_at` 投影及发布断言；0035–0036 把 `learned_at` 强制成两个考试事实的精确数据库派生值并验证结构/权限。生产已于 2026-08-04 受保护同步到 0036。
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
pnpm check   # docs:check + release-tool tests + code lint + typecheck + test + build
```

默认 `pnpm test` 运行 Web jsdom、API 单元测试和发布工具测试，不连接外部项目；真实 RLS 套件只有在显式安全开关下运行。PR/main CI 会启动一次性本地 Supabase，自动暂存 0008 及之后迁移来验证 0007 历史升级，再从空库重建、运行双用户 RLS/Storage/points/Courses E2E，并以 Azure/OpenRouter fake + 固定 WAV 运行 Playwright Courses 主流程。0015–0016 还要求验证 attempt 幂等/冲突、队列私有性与跨用户缓存键；0017–0018 覆盖历史冷音频与独立恢复；0019–0020 覆盖限时/翻译前测；0021–0022 覆盖 Unicode 大小写/兼容字符；0023–0024 覆盖标点遗漏/替换/增加、真实字母/空格错误、零错误次数/空候补池及内部 helper 客户端拒绝。生产应用激活前则由服务器 mode-600 `.env` 执行真实 Azure gates 和真实 OpenRouter 结构化语义判定 gate。普通 jsdom/mock 结果不能称为真实数据库 E2E，fake 也不能称为供应商验证；手工连接托管项目时禁止指向生产，见[测试指南](docs/guides/TESTING.md)。

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

下一阶段会覆盖 Courses 文件 AI 解析与其余三类学习资产、个人笔记、真实 Home、笔记市场/credits/Stripe、完整内容治理、Realtime、管理端、双语、Electron 和 React Native。它们的依赖、顺序和验收标准只以 [PROJECT_BLUEPRINT.md](docs/PROJECT_BLUEPRINT.md) 为准。

## 许可证状态

仓库历史 README 声明 MIT，但当前没有独立 `LICENSE` 文件；在正式对外发布前必须补齐准确许可证。计划参考的 ExamPass-Assistant 使用 CC BY-NC 4.0，商业项目不得在未获授权时直接复用其非商业代码。
