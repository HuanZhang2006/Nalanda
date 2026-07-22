# Nalanda 最终项目说明、产品蓝图与开发路线图

> **文档定位**
> - **内容**：定义 Nalanda 最终要成为怎样的产品、目标系统边界、完整功能范围、技术原则、分阶段开发路径与待实现清单。
> - **作用**：这是项目“最终目标与接下来做什么”的唯一权威文档；所有带未来时态的产品或架构规划都应汇总到这里。
> - **何时更新**：产品范围、关键技术决策、阶段优先级、依赖关系或里程碑验收标准发生变化时；每完成一个阶段也必须同步状态。
> - **状态口径**：本文同时写“当前基线”和“目标状态”。标记为“目标/规划”的内容不得在 README 或当前架构文档中写成已实现。

最后核对：2026-07-23。

---

## 1. 一句话定义

Nalanda 是面向大学生的多平台 AI 学习与知识平台：把课程资料转化为可学习、可检验、可关联、可分享的结构化知识资产，并围绕这些资产提供计划、社区、成长和合规的交易能力。

最终产品必须形成以下闭环：

```text
课程资料 → 解析/检索 → AI 生成 → 学习与测验 → 计划与复习
    ↑                                      ↓
    └──────── 个人笔记、社区、市场、成长反馈 ────────┘
```

## 2. 当前基线（不是最终完成状态）

截至 2026-07-23，项目是“高保真 Web 应用 + 真实 Supabase 业务模块 + 已上线的首版英语 Courses”：

- 已上线：邮箱密码注册/登录、Materials、社区、普通学习计划、Profile、活动积分/等级、通知、反馈和 Web/API 生产部署；生产 migration history 已到 0014。
- 已上线：Courses 英语词表文本导入/编辑、四阶段学习、复习熟练度、Schedule/Profile、徽章/+20 points、公开分享、免费课程市场和 Azure Speech；生产 flags 已开启，fake 未进入生产。
- 部分落地：主应用仍有大量 `legacy` DOM 模块，Courses 是 React 功能。Supabase 是旧业务主要后端，NestJS 已承担 Courses 特权写入与公开脱敏读取。
- 仍为 mock：Home 聚合、个人 Notes、AI Create、知识清单/测验/图谱/试卷的真实生成与持久化、Note Market。
- 仅有骨架：FastAPI AI 服务；解析和生成均为占位结果，未被 NestJS 调用。
- 未实现：Courses 的 PDF/Word/JSON/Markdown/HTML/图片 AI 导入和其他三类课程；BullMQ/Redis 任务链、pgvector、Stripe、credits 账本、VIP 结算、Realtime、Electron、React Native、完整 i18n 和通用管理后台。
- 安全基线进展：生产已应用 0008–0014，Profile 敏感列与内部 `SECURITY DEFINER` RPC 已收口，当前 points 奖励使用可冲正幂等账本，旧 `legacy_opening=11` 已由 `legacy_opening_reset=-11` 归零；Courses 私有写入/RPC/传播边界与 0014 替换后的评分/认词函数也通过双用户 RLS 与发布断言。
- 仍需优先完成：帖子 UPDATE 可信字段、feedback 状态和部分关联归属；points 每日上限、审核撤销和协同行为检测；AI 数据契约统一与文件导入闭环。

当前事实的权威说明见 [当前架构](ARCHITECTURE.md)；商业数值与状态机见 [积分、钱包、VIP 与支付规则](product/POINTS_CREDITS_VIP_PAYMENTS.md)。

## 3. 最终产品范围

### 3.1 身份、资料与权限

目标能力：

- 邮箱验证、登录、退出、找回密码、OAuth。
- 用户 Profile、语言、学校、专业、年级和学习偏好。
- `user / creator / moderator / admin` 角色与最小权限。
- 用户数据导出、账户删除、法定保留与审计。

当前差距：邮箱所有权未验证；缺找回密码、OAuth、管理角色、数据导出/删除工作流；注册接口缺限流/CAPTCHA。

### 3.2 课程与资料库

目标能力：

- 课程、学期、教师、资料分类、搜索、分页与批量管理。
- PDF、PPTX、DOCX、Markdown、HTML、TXT 以及受控图片输入。
- 上传大小/MIME 白名单、恶意文件检测、解析状态、版本与去重。
- 私有 Storage、短期签名 URL、孤儿文件回收、配额和生命周期规则。

当前差距：基础 CRUD/预览已完成；缺服务端上传约束、配额、解析状态、版本、扫描和自动清理。

### 3.3 Courses 学习课程

首版英语单词学习已经上线：文本逐单元/整份多单元粘贴、精确错误定位、结构化编辑、CMUdict IPA、四阶段可恢复学习、跨日期复习熟练度、复习 Schedule、Profile 聚合、持久徽章、指纹幂等 +20 points、只读分享与免费课程市场。它采用独立 `learning_*` 模型，不改变 Materials 的 `courses` 表；生产已发布 0011–0014 并开启对应 flags，0014 增加朗读分数阈值候补池和认词候补轮推进。

当前明确未实现：PDF、DOC/DOCX、JSON、Markdown、HTML、图片 OCR/解析；按英语单词/知识点/阅读理解/题库训练选择 prompt；模型结构化输出与人工确认；导入评测集、token/成本和隐私留存。入口必须保持“AI 解析即将推出”，不能接受文件或暗示已调用模型。

后续顺序：持续观察 Courses/分享/市场/Azure 的错误率与成本 → 建文件隔离/扫描/解析管线与人工确认 → 以评测、成本和隐私门开放其他课程类别。

### 3.4 AI 创作与个人笔记（最高优先级）

一份生成任务可选择一种或多种产物：

1. 知识清单：概念、定义、来源引用、依赖顺序。
2. 交互式测验：题型、答案、解析、难度和来源证据。
3. 知识图谱：节点、关系、布局信息和来源。
4. 模拟试卷：章节、题目、分值、答案与评分标准。

目标流水线：

```text
用户选择资料和生成配置
  → NestJS 鉴权、配额/credits 预留、创建 job
  → BullMQ 排队与限流
  → FastAPI 下载私有资料、解析、分块、嵌入
  → pgvector 检索 + Claude 结构化生成 + Reviewer 质量门
  → 契约校验、结果落库、credits 结算
  → Notification 持久化 + Realtime 推送
  → Notes 页面阅读、编辑、练习、重新生成与导出
```

必须先完成：

- 统一 TypeScript/Python/前端渲染契约，废除当前 mock 的短字段形状或提供显式适配层。
- 定义 `materialId/material_id` 的序列化规范和 OpenAPI。
- 建立 `generation_jobs / notes / note_materials / knowledge_points / quizzes / graphs / exams / embeddings` 等数据模型。
- 为每个生成片段保存材料来源与页码，避免无引用答案。
- 建立幂等键、重试、取消、超时、预算上限、失败退款和质量评测。

### 3.5 Home 与学习闭环

最终 Home 聚合真实的今日任务、连续学习、近期课程、待处理资料、最近笔记、生成任务和活动；不能继续混用 mock credits 与真实 points。

学习闭环应记录：测验作答、薄弱知识点、复习间隔、任务完成和生成质量反馈，并用于后续计划推荐。推荐初期采用可解释规则，数据足够后再引入模型。

### 3.6 社区与内容治理

目标能力：帖子、评论、赞、收藏、转发、关注、标签、媒体、举报、屏蔽、审核队列、申诉、频率限制和反垃圾。

当前社交功能基本可用，points 删除/取消/重做已按稳定业务事件冲正去重；扩展推荐前仍须收紧作者可更新的服务端可信字段，增加奖励上限/内容质量反滥用，并治理孤儿媒体。详细规则见[内容审核](governance/CONTENT_MODERATION.md)。

### 3.7 学习计划

目标能力：任务/目标、资料关联、考试倒计时、提醒、重复任务、时区、日历同步、基于薄弱点的可解释排程。

当前有基础任务、目标、连续学习、启发式填充和幂等任务奖励；取消/删除会冲正，同一永久业务事件重做不会再次推进 streak。后续需完成到期提醒、历史任务分页、目标外键归属校验和真正的 AI/规则推荐。

### 3.8 市场、钱包、VIP 与支付

目标能力：

- 笔记以 credits 定价和购买；余额由不可变账本派生。
- 法币充值、VIP、官方课程通过 Stripe Checkout/Webhook。
- 创作者收益、平台分成、退款、争议和 Stripe Connect 提现。
- 订单、支付、账本三层分离，全部状态变更幂等、可审计。

`points` 是不可提现的活动成长值，`credits` 是内部消费余额，两者不得互转或共用字段。完整规则见 [积分、钱包、VIP 与支付规则](product/POINTS_CREDITS_VIP_PAYMENTS.md)。

### 3.9 通知、反馈与管理端

目标能力：

- 通知持久化 + Realtime；支持来源跳转、偏好、邮件和计划提醒。
- 反馈只允许用户创建/查看，状态由支持人员处理。
- 管理端覆盖用户、内容、举报、反馈、订单、AI 任务、成本与审计日志。

### 3.10 多平台与国际化

- Web 是首要交付面。
- Electron 在 Web 核心闭环稳定后接入，提供文件选择、系统通知和安全更新。
- React Native/Expo 在 API 与共享业务契约稳定后接入，不直接复用 DOM UI。
- 界面和 AI 输出均支持中文/英文；数据库保存稳定代码值，不保存翻译后的枚举。

## 4. 目标技术架构

```text
Web / Electron / React Native
        │ HTTPS + Supabase JWT
        ▼
NestJS API（业务边界、配额、订单、任务、管理）
        ├── Supabase Auth / Postgres / Storage / Realtime
        ├── Redis + BullMQ
        ├── FastAPI AI Worker ── Claude / Embedding Provider
        └── Stripe API / Webhook / Connect
```

原则：

- 简单 owner-only CRUD 可以继续直连 Supabase，但涉及钱、积分、服务端可信字段、跨用户写入、AI 成本和管理权限的操作必须经过受控 API/RPC。
- RLS 是最后一道数据隔离，不替代列级权限、业务校验、幂等账本和速率限制。
- 所有跨语言接口以 OpenAPI/JSON Schema 为源，生成客户端或做契约测试。
- 异步任务必须可观察、可重试、可取消、可去重，且失败不会吞掉 credits。
- 当前生产继续使用 Supabase 云 + 自托管应用；是否迁移 PaaS 或完整自托管由容量和运维成本决定，不再把某一托管商写成已锁定事实。

## 5. 数据域与所有权

最终数据域：

- Identity：`profiles`、roles、preferences、consents。
- Learning source：courses、materials、material_versions、parse_results。
- Knowledge：notes、generated artifacts、citations、embeddings、attempts。
- Learning courses：learning courses/units/words、sessions/items/attempts/progress、review schedules、shares/publications/reports、badge awards、speech usage。
- Planning：goals、tasks、reminders、streak events。
- Community：posts、comments、reactions、follows、reports、moderation actions。
- Commerce：products、orders、payments、credit ledger、creator earnings、payouts、subscriptions。
- Operations：generation jobs、notifications、feedback、audit logs、usage/cost events。

当前 ERD、字段和 RLS 见 [ERD](guides/ERD.md)。任何新表必须明确：数据所有者、读写角色、保留期限、删除行为、审计要求和 RLS 测试。

## 6. 不可妥协的质量门

每个功能只有同时满足以下条件才可标记为“已完成”：

- 有数据库迁移与回滚/前滚说明；RLS 至少用两个用户验证。
- 有 API/契约说明，错误与状态机稳定。
- 有单元或 jsdom 测试；关键用户路径有 E2E。
- CI 运行 code/database lint、typecheck、测试和构建。
- 有日志、指标和告警；涉及外部服务时有超时、重试和降级。
- 涉及个人数据时更新隐私/删除规则；涉及内容时更新审核规则。
- 涉及 AI 时有固定评测集、成本预算、引用和失败策略。
- 涉及 points/credits/支付时使用幂等事件与不可变账本。
- 当前状态文档、API/ERD、CHANGELOG 同步更新。

## 7. 分阶段开发路径

### 阶段 A：安全与可验证基线（立即进行）

目标：在继续加功能前，先让现有真实数据可信、测试可复现、发布可回滚。

- **已实现：**限制 Profile 敏感列、撤销内部 definer 客户端执行权、points append-only 账本/冲正/幂等，以及对应双用户 RLS 回归。
- **已实现：**修复跨账号 legacy 状态、迟到异步响应、resize 重挂、登录/退出 loading 和 Supabase/Storage error 处理；现有 Web jsdom、API 单元测试、双用户 Supabase E2E 与 Courses Playwright 流程共同覆盖新旧边界。
- **剩余：**修复帖子 UPDATE 可信字段、feedback 状态、goal/task 关联等权限/完整性问题。
- **已上线：**0008–0010 已完成受保护生产发布；旧 opening 以追加式等额冲正归零，生产 history、发布断言和最终 dry-run 均通过。
- **剩余：**给 points 增加产品级每日上限、内容审核撤销和协同行为检测；继续收紧帖子/feedback/关联归属权限。
- 持续维护已落地的 migration 空库重建/RLS E2E、typecheck、jsdom、Courses 浏览器主流程、构建、加密恢复点与应用回退门禁；继续补全旧模块 API HTTP/浏览器 E2E 与 FastAPI 测试。
- 建立数据库发布、备份恢复、密钥轮换、监控告警和安全响应基线。

验收：仓库 P0 回归关闭且 production migration history 可证明已应用；默认 CI 全绿；两用户 RLS E2E 在一次性本地 Supabase 可重复执行；剩余权限项关闭；发布和恢复完成演练。

### 阶段 A+：Courses 受保护发布（2026-07-22 已完成）

- 解析器、jsdom/API、0007 升级、空库迁移、双用户 RLS 和 Playwright 主流程已在 CI 全绿。
- 已完成只读 migration plan、加密恢复点、0011–0014 apply、remote history/lint/dry-run 和不可变应用发布。
- 已开启私有 Courses，并验证跨账号、会话恢复、复习跨日与 points 指纹；真实 Japan East Azure 合成/评分 smoke 成功。
- 分享和免费 Course Market 已开放。后续继续观察错误率、举报阈值、语音配额/成本与数据库增长；回退只关 flags/恢复应用 release，数据库向前修复。

验收结果：生产 migration history 到 0014；Courses 私有路径、真实 Azure smoke、分享/市场、评分候补池和公网 readiness 均有发布记录；文件导入仍保持禁用。

### 阶段 B：AI 最小闭环

目标：一份真实资料可以生成一种可引用、可持久化的知识清单。

- 统一契约、建任务/笔记/引用表。
- PDF/Markdown 解析、分块、受控模型调用和结果校验。
- NestJS → 队列 → FastAPI → 数据库完整链路。
- Create 使用真实 Materials；Notes 展示真实结果、状态和错误。
- 建立质量/成本基线和失败退款。

验收：同一幂等键不重复扣费；结果引用可追溯；超时/失败可重试；评测集达标。

### 阶段 C：四类产物与学习闭环

- 扩展测验、知识图谱、模拟试卷。
- 测验作答/解析、图谱布局、试卷答案与评分标准。
- Home 全部换真数据；基于薄弱点生成计划。
- 分阶段把 legacy 视图替换为类型安全 React 组件。

### 阶段 D：市场、credits、VIP 与 Stripe

- 上架、购买、评分、授权副本。
- 充值订单、Stripe Webhook、不可变 credits 账本。
- VIP entitlement、创作者 70% 默认分成、退款/争议和提现。
- 完成税务、条款、隐私、风控和审计要求后才能启用真实支付。

### 阶段 E：实时、治理与运营

- Realtime 通知、提醒任务、邮件偏好。
- 举报/审核/申诉/屏蔽、反垃圾和管理员工作台。
- SLO、成本看板、AI 质量回归、容量和灾备演练。

### 阶段 F：多平台与内容扩展

- 完整中英双语。
- Electron、React Native/Expo。
- 官方图文/视频/直播课程和推荐系统。
- 是否引入第三方视频/直播服务以独立 ADR 决策。

## 8. 待实现功能总表

| ID | 能力 | 当前 | 目标阶段 | 关键依赖 |
|---|---|---|---|---|
| SEC-01 | Profile 敏感列与内部 RPC 收口 | 已上线 | A | 0008–0010、RLS E2E、2026-07-21 生产发布记录 |
| SEC-02 | 注册限流、邮箱验证、找回密码 | 未完成 | A/B | SMTP、Throttler |
| QA-01 | jsdom、API、双用户 RLS/Storage 与关键浏览器流程 | 部分 | A/A+ | Web/API unit + CI 本地 Supabase + Courses Playwright；staging、旧模块 API HTTP/浏览器与 FastAPI 待补 |
| OPS-01 | DB 发布/回滚、备份、监控、密钥轮换 | 部分 | A | CLI/恢复点/app 回退已实现；Storage bytes、持续监控与演练待补 |
| FE-01 | legacy 跨会话与错误处理修复 | 已实现 | A | 账号切换/resize/error/loading jsdom 回归 |
| LEARN-01 | 英语词表文本创建/编辑与四阶段学习 | 已上线 | A+ | React、NestJS、0011–0014；CI/生产已验证 |
| LEARN-02 | 复习熟练度、Schedule/Profile、徽章/+20 points | 已上线 | A+ | 跨日本地日期、指纹幂等；生产已发布 |
| LEARN-03 | 分享、免费课程市场、举报与审核 | 已上线 | A+ | 不可变快照、flags；免费市场已开放 |
| LEARN-04 | Azure TTS/朗读评分适配层 | 已上线 | A+ | fake 自动化 + Japan East 真实供应商 gate |
| LEARN-AI-01 | 文件导入、类别 prompt、结构化输出和人工确认 | 未开始 | B | 扫描/OCR/解析、评测、成本、隐私 |
| AI-01 | 统一生成契约与任务模型 | 未完成 | B | OpenAPI、迁移 |
| AI-02 | 解析、分块、引用、embedding | 桩 | B | FastAPI、pgvector |
| AI-03 | 知识清单真实生成 | mock | B | AI-01/02 |
| AI-04 | 测验、图谱、试卷 | mock | C | 评测集、渲染适配 |
| NOTE-01 | Notes CRUD、编辑、版本和导出 | mock | B/C | AI 结果表 |
| HOME-01 | 首页真实聚合 | mock | C | Notes/Tasks/Usage |
| PLAN-01 | 到期提醒与薄弱点排程 | 部分 | C/E | Realtime/cron |
| COM-01 | 举报、审核、屏蔽、反垃圾 | 未完成 | E | 管理端、策略 |
| PAY-01 | credits 账本与订单 | 仅字段 | D | 产品规则、API |
| PAY-02 | Stripe/VIP/退款/Connect | 未完成 | D | PAY-01、合规 |
| RT-01 | Realtime 通知 | 未完成 | E | 通知来源字段 |
| ADMIN-01 | 管理后台与审计 | 未完成 | E | roles、audit logs |
| I18N-01 | UI 与 AI 双语 | 未完成 | F | i18n 包、契约 |
| DESKTOP-01 | Electron | 未开始 | F | 稳定 Web/API |
| MOBILE-01 | React Native/Expo | 未开始 | F | 稳定共享契约 |
| COURSE-01 | 官方课程 | 未开始 | F | 支付、媒体供应商 |

状态只允许使用：`未开始 / 桩 / mock / 部分 / 已实现 / 已验证 / 已上线`。其中“已验证”必须链接到可执行测试，“已上线”必须有部署和监控证据。

## 9. 开放决策

以下事项不得在实现前默认为已锁定：

- ExamPass-Assistant 的商业授权；未取得授权只能方法论参考并干净重写。
- embedding 模型与供应商、图谱布局方案、富文本编辑器。
- 视频/直播供应商。
- VIP 权益细目和官方课程是否允许 credits 支付。
- Electron/RN 的离线范围。
- PaaS、自托管或混合部署的长期选择。

每项落定后新增 ADR，并在本文件删除“开放”标记。

## 10. 配套文档与更新责任

- 当前实现：[ARCHITECTURE.md](ARCHITECTURE.md)
- 数据：[ERD](guides/ERD.md)、[数据库发布与回滚](operations/DATABASE_RELEASE_ROLLBACK.md)
- 接口：[API](guides/API.md)
- 开发与测试：[本地开发](guides/LOCAL_DEVELOPMENT.md)、[测试指南](guides/TESTING.md)
- 安全与隐私：[SECURITY](../SECURITY.md)、[隐私与数据删除](governance/PRIVACY_AND_DATA_DELETION.md)
- AI：[评测与成本](ai/EVALUATION_AND_COST.md)
- 商业规则：[points/credits/VIP/支付](product/POINTS_CREDITS_VIP_PAYMENTS.md)
- 变更记录：[CHANGELOG](../CHANGELOG.md)、[ADR](adr/README.md)

产品负责人维护范围和优先级；技术负责人维护架构与质量门；模块作者在合并功能时同步 ERD/API/测试/CHANGELOG；运维负责人在基础设施、密钥、告警或恢复流程变化时更新操作手册。
