# 07 · 原型模块（仍用假数据，待接后端）

> 目标：除了 Auth 和 Materials，其余模块目前都是移植自原型、跑在假数据上的。这篇记录它们「实现到什么程度、数据怎么来、接真后端要补什么」，作为后续开发的起点清单。移植机制见 [04 前端与原型复现](04-frontend-and-prototype-port.md)。

## 1. 现在怎么工作
全部来自 `apps/web/src/legacy/`：
- **数据**：`legacy/data.ts` 的 `DB`（mock：user、courses、notes、knowledge、quiz、graph、exam、market、community、comments、badges、schedule、activity…）。
- **视图**：`legacy/app.ts` 的 `VIEWS` 表，每路由一个返回 HTML 字符串的函数；`go(route)` 塞进 `#content`。
- **交互**：事件委托读 `data-go`（跳路由）/ `data-act`（执行 `ACTIONS[...]`），改前端状态 `S` 后重渲染。
- **「写」类操作**：都只弹 toast 假装成功（购买、导出、生成、发帖），**不落后端**。

> 注意：`materials` 在 `DB` 里虽还有 mock，但运行时已被真实模块覆盖（见 [06](06-materials.md)），所以 Materials 是真的；其余仍是 mock。

## 2. 各模块现状 + 接真后端要补什么
| 模块 | 现在（mock 做了什么） | 接真后端要补 |
|---|---|---|
| **Home 首页** | 仪表盘：欢迎语、统计卡、课程进度、最近笔记、动态流 | 聚合真实数据；统计来自 profile/行为表 |
| **Notes 笔记库 + 详情** | 列表 + 详情 4 Tab：知识清单 / 交互测验（可作答判分）/ 知识图谱（SVG 连线）/ 模拟试卷 | 核心，依赖 **AI 生成**：建 notes/generated_note/knowledge_point/quiz/... 表 + AI 微服务产出落库后渲染 |
| **Create 创作流** | 选资料 → 勾产物 → 「生成」弹 toast | 接 Materials 真资料作输入 → 调 AI 微服务 → 异步任务 + 落库 |
| **Market 市场 + 购买弹窗** | 市场卡片、筛选、购买弹窗 | 上架/购买表、积分扣减、创作者分成（依赖支付/积分） |
| **Community 社区 + 帖子详情** | 帖子流、详情、点赞/收藏（前端 toggle 不持久） | posts/comments/likes/favorites 表 + RLS；多态关联 |
| **Schedule 学习计划** | 周视图、任务勾选（不持久） | study_schedule/study_task 表；按课程/进度自动排程 |
| **Profile 成长** | 资料、等级环、徽章、收益 | 接 `profiles` 真数据 + 积分/徽章/收益表 |
| **Feedback 反馈** | 提交表单、工单列表 | feedback 表 + 状态机 + 多态关联 |

## 3. 数据形状已为接入铺路
`legacy/data.ts` 里 AI 相关的 mock（`DB.knowledge / quiz / graph / exam`）**形状刻意对齐**未来 AI 产物（也对齐 `packages/types` 与计划中的 AI 微服务 schema）。接真后端时前端渲染基本不用改数据契约，把 mock 换成真实拉取即可。

## 4. 升级范式（照 Materials 做）
每个模块从 mock → 真后端走同一套路（详见 [06](06-materials.md) 与 [04](04-frontend-and-prototype-port.md)）：
1. 写迁移：建表 + owner-only RLS（+ 需要的存储/外键归属校验），用 `db-push` 应用（[05](05-database-and-rls.md)）。
2. 写自管容器的真实模块（`legacy/xxx.ts`，导出 `mountXxx(el)`，用 `supabase` 直连）。
3. 在 `app.ts`：`VIEWS.xxx = () => '<div id="xxx-root"></div>'` + `go()` 钩子挂载 + 透传依赖。
4. 两用户端到端验证 RLS/存储隔离。
5. push → 自动部署。

## 5. 优先级建议
1. **Materials → AI 笔记生成**：Materials 已能作输入，下一步把 Create + Notes 接上 AI 微服务（需先处理上游 [ExamPass-Assistant](https://github.com/WUBING2023/ExamPass-Assistant) 的 CC BY-NC 授权）。
2. 之后是社区 / 计划这类「自有数据 CRUD」（同 Materials 模式，较直接）。
3. 市场 / 积分 / 支付放最后（依赖 Stripe，复杂度最高）。
