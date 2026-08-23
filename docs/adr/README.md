# Architecture Decision Records（ADR）索引

> **本文内容：**列出 Nalanda 的架构决策记录、状态、编号约定和维护流程。  
> **作用：**保存“为什么这样选”的上下文，使后续开发能区分已接受决策、待验证提案与已被替代方案。  
> **何时更新：**新增、接受、否决、废弃或替代 ADR 时；ADR 状态或所有者变化时。  
> **状态基线：**2026-08-23；ADR 记录决策，不证明目标能力已经在生产启用，生产状态需同时核对发布证据。

## 决策索引

| ADR | 决策 | 状态 | 实现状态 |
|---|---|---|---|
| [0001](0001-monorepo-and-workspaces.md) | 使用 pnpm + Turborepo monorepo | Accepted | 当前已实现基础工作区 |
| [0002](0002-supabase-auth-data-and-rls.md) | Supabase 承担 Auth/Postgres/Storage，RLS 为数据边界 | Accepted | 当前部分实现，仍有已知权限缺口 |
| [0003](0003-client-direct-crud-and-api-boundary.md) | 普通 owner CRUD 可直连 Supabase，特权流程进入 NestJS | Accepted | 当前部分实现 |
| [0004](0004-core-api-and-ai-service-split.md) | NestJS 核心服务与 FastAPI AI 服务分离 | Accepted | Materials 0041–0043 已生产部署 |
| [0005](0005-economy-domain-separation.md) | points、credits、VIP 与法币/创作者应付分账 | Accepted | 产品规则已定，目标账本与 Stripe 未实现 |
| [0006](0006-production-topology.md) | 当前生产采用 nginx + Web/API/AI 容器 + Redis + Supabase Cloud | Accepted | 当前已实现；`infra/hybrid-2g` 仍是参考模板 |
| [0007](0007-third-party-ai-reference-licensing.md) | 未获商业许可前不复制 NC 许可 AI 代码 | Accepted | 持续约束 |
| [0008](0008-independent-learning-courses-and-azure-speech.md) | 独立学习课程模型 + 服务端 Azure Speech 适配层 | Accepted | 0011–0018 与应用已于 2026-07-27 完成受保护发布 |
| [0009](0009-server-side-semantic-spelling-translation-assessment.md) | 服务端语义翻译前测 + 会话级拼写设置 | Accepted | 0019–0020 与应用已于 2026-07-28 完成受保护发布 |
| [0010](0010-ephemeral-translation-stt-and-shared-waveform.md) | 临时 Fish Audio 翻译 STT + 共享录音波形 | Accepted | 0037–0038 与应用已于 2026-08-04 完成受保护发布；真实口音评测仍待扩充 |
| [0011](0011-private-redis-and-points-abuse-boundary.md) | 私有 Redis 请求保护 + 不可变 Points 决策/审核边界 | Accepted | Stage A/go-no-go 与 0052–0053 Stage B 均已受保护生产发布 |
| [0012](0012-materials-ai-durable-queue-zdr-and-2g-office-rendering.md) | Materials AI durable queue + OpenRouter ZDR + 2G Office 渲染 | Accepted | 0041–0043 已于 2026-08-11 受保护发布 |
| [0013](0013-materials-ai-async-callback-resume-and-knowledge-graph.md) | Materials AI 异步回调、双层断点与知识图谱 | Accepted | 0046–0048 候选，尚未部署 |
| [0014](0014-materials-ai-luna-native-lifecycle-and-graph-layout.md) | Luna 原文件、任务清理、可保存图布局与整卷批改 | Accepted | 0049–0051 候选，尚未部署 |
| [0015](0015-ox-alpha-translation-and-native-image-pipeline.md) | Ox Alpha 翻译判定 + Materials 原始图片第三流水线 | Accepted | 0054–0055 候选，尚未部署 |

## 状态定义

- **Proposed：**正在讨论，不得作为实现前提或发布承诺。
- **Accepted：**团队同意采用；“Accepted”只代表决策成立，是否落地看 ADR 的实现状态和代码证据。
- **Deprecated：**不建议用于新工作，但历史系统可能仍依赖。
- **Superseded：**被新 ADR 替代；原文保留并链接替代者。
- **Rejected：**已评估但不采用。

## 何时需要 ADR

满足任一条件应新增 ADR：跨两个以上服务；引入/移除基础设施或关键供应商；改变认证、数据所有权、账本、隐私或部署边界；形成长期兼容约束；回滚代价高；团队未来很可能追问“为什么”。普通 bug、局部实现细节和可轻易撤销的重构不需要 ADR。

## 编写与变更流程

1. 复制 [模板](TEMPLATE.md)，使用下一个四位编号，文件名用小写连字符。
2. 在同一 PR 写背景、选项、结论、后果、当前/目标实现和验证方式。
3. 涉及安全、隐私、支付、AI 或数据迁移时，由相应负责人参与评审。
4. Accepted 后不改写历史结论；若结论变化，新建 ADR 并把旧 ADR 标为 Superseded。
5. 允许补充勘误、实现链接和状态，但必须保留原决定与日期。
