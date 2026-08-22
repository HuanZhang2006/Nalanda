# Nalanda 文档中心

> **文档定位**
> - **内容**：索引项目全部长期文档，说明每类文档的权威范围、阅读顺序和维护责任。
> - **作用**：避免“当前实现、最终蓝图、历史复盘、操作手册”相互覆盖或产生状态冲突。
> - **何时更新**：新增、删除、重命名文档，或某类文档的负责人/权威范围变化时。

最后核对：2026-08-23。生产数据库已到 0053，0052–0053 安全时间列 contract 已生效；当前不可变应用仍为此前稳定 release。仓库 0046–0051 对应的可恢复长任务、知识图谱/节点问答、任务清理、跨设备布局与 Luna 原文件流水线尚未通过真实 provider gate 并切流。

## 1. 事实来源优先级

同一内容出现冲突时，按下列规则处理：

1. **当前代码、迁移和部署配置**是运行事实。
2. [当前实现架构](ARCHITECTURE.md)、[ERD](guides/ERD.md)、[API](guides/API.md)解释当前事实。
3. [最终项目蓝图](PROJECT_BLUEPRINT.md)定义目标和开发顺序，不证明功能已经实现。
4. `notes/` 是历史实现复盘；内容过时应修正或明确标注，不覆盖当前架构。
5. `operations/` 是执行发布、恢复、告警和密钥工作的操作手册。
6. ADR 记录“为什么这样决定”，CHANGELOG 记录“什么发生了变化”。

只有同时有代码、测试和部署证据的能力才能写成“已验证/已上线”。

## 2. 建议阅读顺序

首次加入项目：

1. 仓库根 [README](../README.md)
2. [最终项目蓝图](PROJECT_BLUEPRINT.md)
3. [当前实现架构](ARCHITECTURE.md)
4. [从零本地开发](guides/LOCAL_DEVELOPMENT.md)
5. [测试指南](guides/TESTING.md)
6. 按任务阅读 ERD/API、实现笔记和 operations 手册

## 3. 核心说明

| 文档 | 权威范围 | 主要维护者 | 更新触发 |
|---|---|---|---|
| [项目蓝图](PROJECT_BLUEPRINT.md) | 最终产品、目标架构、路线图、待实现功能 | 产品/技术负责人 | 范围、阶段、关键决策变化 |
| [当前架构](ARCHITECTURE.md) | 真实运行架构和模块边界 | 技术负责人 | 服务/数据/部署边界变化 |
| [ERD](guides/ERD.md) | 表、关系、删除行为、RLS | 数据库变更作者 | 每个 schema/RLS 迁移 |
| [API](guides/API.md) | 当前 Nest/FastAPI/直接 Supabase 接口 | API 作者 | 接口、鉴权、错误变化 |
| [环境变量](guides/ENVIRONMENT_VARIABLES.md) | 变量来源、消费者、机密级别 | 服务/运维作者 | 新增、删除、轮换变量 |

## 4. 开发与测试

- [从零本地开发](guides/LOCAL_DEVELOPMENT.md)
- [环境变量矩阵](guides/ENVIRONMENT_VARIABLES.md)
- [可执行测试指南](guides/TESTING.md)
- [贡献指南](../CONTRIBUTING.md)
- [变更记录](../CHANGELOG.md)

## 5. 数据与运行

- [数据库发布与回滚](operations/DATABASE_RELEASE_ROLLBACK.md)
- [备份与恢复](operations/BACKUP_RECOVERY.md)
- [监控与告警](operations/OBSERVABILITY_ALERTING.md)
- [密钥轮换](operations/SECRET_ROTATION.md)
- [当前生产部署](../infra/deploy/README.md)
- [2G 混合部署模板](../infra/hybrid-2g/README.md)

## 6. 安全、隐私与治理

- [安全政策](../SECURITY.md)
- [隐私与数据删除](governance/PRIVACY_AND_DATA_DELETION.md)
- [内容审核](governance/CONTENT_MODERATION.md)
- [AI 评测与成本](ai/EVALUATION_AND_COST.md)
- [AI Prompt 统一目录](ai/PROMPT_CATALOG.md)
- [points / credits / VIP / 支付规则](product/POINTS_CREDITS_VIP_PAYMENTS.md)

## 7. 决策记录

- [ADR 索引](adr/README.md)

ADR 只记录已经做出的、影响多个模块或难以逆转的决策。开放问题保留在项目蓝图；决定后新增 ADR 并更新相关当前文档。

最新已采用候选决策：[ADR-0013 Materials AI 异步回调、可恢复执行与知识图谱](adr/0013-materials-ai-async-callback-resume-and-knowledge-graph.md)；生产基线仍由 [ADR-0012](adr/0012-materials-ai-durable-queue-zdr-and-2g-office-rendering.md) 对应的 0041–0043 release 提供。Accepted 表示架构决定已采用，不自动证明候选已部署；生产证据仍以架构、测试和发布记录为准。

## 8. 实现笔记

[实现笔记索引](notes/README.md)包含：

- 01 monorepo
- 02 认证
- 03 部署/CI
- 04 原型移植
- 05 数据库/RLS
- 06 Materials
- 07 剩余 mock
- 08 通知/反馈/Profile
- 09 Community
- 10 Schedule
- 11 Courses 英语单词学习

实现笔记适合学习函数级逻辑和历史踩坑，但测试命令、当前接口和生产操作必须跳转到相应权威文档。

## 9. 文档写作契约

每份长期 Markdown 必须在标题后说明：

- **内容**：文档覆盖什么、不覆盖什么。
- **作用**：读者何时使用它、它是否是权威来源。
- **何时更新**：哪些代码、产品或运维变化必须同步。

正文必须：

- 区分 `当前`、`目标`、`历史`。
- 对命令、路径、变量和状态机给出可验证依据。
- 不记录真实 secret；示例统一使用占位值。
- 不把一次人工测试写成永久“已验证”；链接到可执行测试。
- 变更功能时同步 README/架构/ERD/API/测试/CHANGELOG 中适用的部分。

仓库使用 `node scripts/check-docs.mjs` 校验上述开头字段和相对链接。
