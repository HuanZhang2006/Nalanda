# 07 · 原型模块（剩余仍用假数据的）

> 目标：记录**仍跑在假数据上**的模块（Home / Notes 详情 / Create / Market）及接真后端要补什么。已接真后端的模块见各自笔记：Materials [06](06-materials.md)、通知/反馈/资料 [08](08-notifications-feedback-profile.md)、社区 [09](09-community.md)、学习计划 [10](10-schedule.md)。移植机制见 [04](04-frontend-and-prototype-port.md)。

## 1. 现在怎么工作
全部来自 `apps/web/src/legacy/`：
- **数据**：`legacy/data.ts` 的 `DB`（mock：user、courses、notes、knowledge、quiz、graph、exam、market、community、comments、badges、schedule、activity…）。
- **视图**：`legacy/app.ts` 的 `VIEWS` 表，每路由一个返回 HTML 字符串的函数；`go(route)` 塞进 `#content`。
- **交互**：事件委托读 `data-go`（跳路由）/ `data-act`（执行 `ACTIONS[...]`），改前端状态 `S` 后重渲染。
- **「写」类操作**：都只弹 toast 假装成功（购买、导出、生成、发帖），**不落后端**。

> 注意：`materials` 在 `DB` 里虽还有 mock，但运行时已被真实模块覆盖（见 [06](06-materials.md)），所以 Materials 是真的；其余仍是 mock。

## 2. 各模块现状
| 模块 | 状态 | 说明 / 接真后端要补 |
|---|---|---|
| **Home 首页** | 🟡 mock | 仪表盘（欢迎语/统计卡/课程进度/最近笔记/动态）；可接真实「今日任务 + 积分 + 最近活动」 |
| **Notes 笔记库 + 详情** | 🟡 mock | 4 Tab（知识清单/测验/图谱/试卷）；依赖 **AI 生成**：notes/generated_note/knowledge_point/quiz… 表 + AI 微服务 |
| **Create 创作流** | 🟡 mock | 选资料 → 勾产物 → 生成；接 Materials 资料 → AI 微服务异步生成 → 落库 |
| **Market 笔记市场** | 🟡 mock | 市场卡片/购买弹窗；上架/购买表、积分扣减、创作者分成（依赖支付） |
| Materials 资料库 | ✅ 真后端 | 见 [06](06-materials.md) |
| Community 社区 | ✅ 真后端 | 见 [09](09-community.md) |
| Schedule 学习计划 | ✅ 真后端 | 见 [10](10-schedule.md) |
| Profile / 通知 / 反馈 | ✅ 真后端 | 见 [08](08-notifications-feedback-profile.md) |

## 3. 数据形状已为接入铺路
`legacy/data.ts` 里 AI 相关的 mock（`DB.knowledge / quiz / graph / exam`）**形状刻意对齐**未来 AI 产物（也对齐 `packages/types` 与计划中的 AI 微服务 schema）。接真后端时前端渲染基本不用改数据契约，把 mock 换成真实拉取即可。

## 4. 升级范式（照 Materials 做）
每个模块从 mock → 真后端走同一套路（详见 [06](06-materials.md) 与 [04](04-frontend-and-prototype-port.md)）：
1. 写迁移：建表 + owner-only RLS（+ 需要的存储/外键归属校验），用 `db-push` 应用（[05](05-database-and-rls.md)）。
2. 写自管容器的真实模块（`legacy/xxx.ts`，导出 `mountXxx(el)`，用 `supabase` 直连）。
3. 在 `app.ts`：`VIEWS.xxx = () => '<div id="xxx-root"></div>'` + `go()` 钩子挂载 + 透传依赖。
4. 两用户端到端验证 RLS/存储隔离。
5. push → 自动部署。

## 5. 剩余优先级
1. **AI 笔记生成**（Create + Notes）：核心，接 AI 微服务产出知识清单/测验/图谱/试卷（先处理上游 [ExamPass-Assistant](https://github.com/WUBING2023/ExamPass-Assistant) 的 CC BY-NC 授权）。
2. **Home 首页**接真数据（今日任务 / 积分 / 最近活动），把各模块串到首屏。
3. **笔记市场 + 钱包/支付**（依赖 Stripe，放最后）。
