# 07 · 原型模块（剩余仍用假数据的）

> **文档定位**
> - **内容**：列出仍为 mock 的 Home、Notes/Create、Note Market 及其接真数据的依赖，并区分已经真实的 Course Market。
> - **作用**：防止把高保真交互误当成已实现业务，并给迁移工作提供入口。
> - **何时更新**：任一 mock 模块接入真实数据、AI 或支付，或迁移优先级变化时。

> 目标：记录**仍跑在假数据上**的模块（Home / Notes 详情 / Create / Note Market）及接真后端要补什么。已接真后端的模块另包括 Materials、社区、Schedule 和 [Courses](11-learning-courses.md)；Course Market 是免费真实快照，不能与 Note Market Demo 混为一谈。

## 1. 现在怎么工作
全部来自 `apps/web/src/legacy/`：
- **数据**：`legacy/data.ts` 的 `DB`（mock：user、courses、notes、knowledge、quiz、graph、exam、market、community、comments、badges、schedule、activity…）。
- **视图**：`legacy/app.ts` 的 `VIEWS` 表，每路由一个返回 HTML 字符串的函数；`go(route)` 塞进 `#content`。
- **交互**：事件委托读 `data-go`（跳路由）/ `data-act`（执行 `ACTIONS[...]`），改前端状态 `S` 后重渲染。
- **本页所列 mock 模块的“写”操作**：购买、导出、生成等只弹 toast，不落后端。发帖已由真实 Community 模块覆盖，不属于此结论。

> 注意：`materials` 在 `DB` 里虽还有 mock，但运行时已被真实模块覆盖（见 [06](06-materials.md)），所以 Materials 是真的；其余仍是 mock。

## 2. 各模块现状
| 模块 | 状态 | 说明 / 接真后端要补 |
|---|---|---|
| **Home 首页** | 🟡 mock | 仪表盘（欢迎语/统计卡/课程进度/最近笔记/动态）；可接真实「今日任务 + 积分 + 最近活动」 |
| **Notes 笔记库 + 详情** | 🟡 混合 | 生产 0041–0043 已有 Materials 试卷、在线考试和历史；旧硬数据保留为 Demo。知识清单/独立测验仍 mock；0046–0051 候选已接 source-ordered React Flow/ELK graph、外置详情、布局保存与 node Q&A，尚未生产发布 |
| **Create 创作流** | 🟡 mock | 选资料 → 勾产物 → 生成；接 Materials 资料 → AI 微服务异步生成 → 落库 |
| **Market / Note Market** | 🟡 mock | 笔记卡片/购买弹窗；未来依赖上架/购买、credits 账本和创作者分成 |
| **Market / Course Market** | ✅ 生产真后端 | 英语词表不可变版本、举报、免费克隆；不接 credits/支付，见 [11](11-learning-courses.md) |
| Courses 英语单词学习 | ✅ 生产真后端 | 文本创建/编辑/学习/复习/分享已上线；文件 AI 导入和其余类别仍禁用 |
| Materials 资料库 | ✅ 真后端 | 见 [06](06-materials.md) |
| Community 社区 | ✅ 真后端 | 见 [09](09-community.md) |
| Schedule 学习计划 | ✅ 真后端 | 见 [10](10-schedule.md) |
| Profile / 通知 / 反馈 | ✅ 真后端 | 见 [08](08-notifications-feedback-profile.md) |

## 3. 数据形状已为接入铺路
Courses 与 `GeneratedExamV1`/job/quota/Notes/Exam 契约已由 `packages/types` 在 Web/API 共用，并与 FastAPI strict camelCase 对齐。`legacy/data.ts` 的 Knowledge/Quiz/Graph mock 仍是独立 Demo 短字段；接真时必须另定契约和布局，不能复用试卷结果冒充完成。

## 4. 升级范式（照 Materials 做）
每个模块从 mock → 真后端走同一套路（详见 [06](06-materials.md) 与 [04](04-frontend-and-prototype-port.md)）：
1. 写迁移：建表 + owner-only RLS（+ 需要的存储/外键归属校验），用本地 Supabase reset/E2E 验证并经 CLI history 发布（[05](05-database-and-rls.md)）。
2. 选择访问边界：普通 owner CRUD 可直连 Supabase；progress、经济、AI 成本、公开传播或审核必须像 Courses 一样走 NestJS + 受限 RPC。
3. 在 `app.ts`：`VIEWS.xxx = () => '<div id="xxx-root"></div>'` + `go()` 钩子挂载 + 透传依赖。
4. 两用户验证 RLS/存储隔离，关键主流程再补真浏览器 E2E。
5. push → 自动部署。

## 5. 剩余优先级
1. **完成 Materials 试卷候选发布与质量观察**；随后开放知识清单/Quiz/知识图谱和 Notes 编辑/导出。当前实现为干净自研，不复制 CC BY-NC 参考代码。
2. **Home 首页**接真数据（今日任务 / 积分 / 最近活动），把各模块串到首屏。
3. **笔记市场 + 钱包/支付**（依赖 Stripe，放最后）。
