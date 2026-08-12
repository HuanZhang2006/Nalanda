# 04 · 前端与原型复现

> **文档定位**
> - **内容**：解释静态原型如何被移植进生产 Web、React/legacy 边界及渐进重构风险。
> - **作用**：帮助维护当前混合前端；不把“页面可打开”解释为业务已真实实现。
> - **何时更新**：入口、路由、挂载生命周期、legacy 模块、设计系统或 React 化边界变化时。

> 目标：把最初用 Claude Design 做出的高保真原型（8 大模块 + 各子页）变成生产前端的真实页面，所有页面都能打开、交互可用；后端没做的部分先用假数据，注册/登录用真后端。

## 1. 技术方案

- **栈**：React 18 + Vite + TypeScript（`apps/web`）。
- **设计系统**：直接复用原型的 `nalanda.css`（搬进 `packages/ui`），CSS 变量驱动明暗主题，保证生产 UI 与设计稿一致。
- **复现策略（关键决策）**：原型是一套**已验证**的原生 JS 应用（`app/` 下 `data.js / icons.js / app.js / views-*.js`，模板字符串 + 事件委托渲染）。把上千行视图逐一改写成 JSX 风险高、收益低；因此选择**「把原型模块封装成 ES module，登录后挂载进 React」**：
  - React 负责**鉴权门**（登录页 + 会话）。
  - 登录后渲染 `<NalandaApp>`，在 `useEffect` 里把原型挂载到一个 `div.app` 容器。
  - 真实身份 + supabase 客户端 + 退出回调作为参数注入原型。
  - 好处：**像素级保真 + 全功能立即可用**；后续可逐模块替换为「真组件 + 真后端」，是平滑迁移路径。

## 2. 原型 → ES module 的改造

源：`app/{data.js, icons.js, app.js, views-core.js, views-more.js}` → `apps/web/src/legacy/{data.ts, icons.ts, app.ts}`。历史上按确定性转换思路处理，但该转换脚本没有保存在仓库，后续同步目前仍有人工漂移风险：

- `data.js`：`const DB = {}` → `const DB: any = {}`；去掉 `window.DB`，改 `export { DB }`。
- `icons.js`：去掉 IIFE 包裹；`window.ICON = function(){}` → `export function ICON(){}`；新增 `logout` 图标。
- `app.js + views-*`：拼成一个 `app.ts`，并：
  - 顶部加 `import { DB } from "./data"`、`import { ICON } from "./icons"`，声明模块作用域的 `VIEWS`、`_root`、`_opts`。
  - `const S = window.S = {…}` → 模块内 `const S`；移除 `window.VIEWS`。
  - 把对 `document.getElementById("app")` 的 innerHTML / 事件委托改为对挂载容器 `_root` 操作。
  - 新增导出 `mountNalanda(container, opts)`：写入真实用户到 `DB.user`、`initTheme()` → `renderShell()` → `go("home")`，返回清理函数（清空容器 + 解绑 resize）。
  - 顶栏加「退出登录」按钮，`ACTIONS.signOut` 调 `opts.onSignOut`。
- 当前 9 个 legacy TS 文件均有 `// @ts-nocheck`。这保证移植代码可构建，但也意味着 `tsc` 无法验证项目大部分业务前端。

## 3. React 侧接线

- `main.tsx`：`import "@nalanda/ui/nalanda.css"`（完整样式）+ `import "./index.css"`。
- `NalandaApp.tsx`：`useEffect` 调 `mountNalanda(ref.current, { user:{id,email}, supabase, onSignOut })`，依赖 `user.id/user.email`；令牌刷新不重挂，但同一 React 树切换账号会先 cleanup 再以新身份挂载。
- `App.tsx`：会话存在 → `<NalandaApp>`；否则登录页（见 [02 笔记](02-auth-and-user-system.md)）。
- `index.html`：加载 Newsreader / Public Sans / IBM Plex Mono 字体；`data-theme` 由 JS 控制明暗。

## 4. 已复现的模块（全部可打开）

首页 Dashboard、My Notes（笔记库）、**笔记详情**（知识清单 / 交互测验 / 知识图谱 / 模拟试卷 4 个 Tab）、AI 创作流程、资料库 Materials、笔记市场（+ 购买弹窗）、社区 Feed + 帖子详情、个人成长 Profile、学习计划 Schedule、反馈 Feedback。

交互：明暗主题切换、侧栏折叠、测验作答与判分、点赞/收藏、任务勾选、Toast/Modal 等均可用。后端未做的动作（购买、导出、生成等）按原型设计弹 Toast 占位。

## 5. 渲染与路由逻辑

- **状态路由**：模块内 `S.route` + `go(route, params)`；`go` 重渲染内容区并更新导航高亮（与原型一致，未引入 react-router）。
- **事件委托**：容器上单一 `click` 监听，读 `data-go`（路由）/`data-act`（动作）+ `data-*` 参数派发，避免给每个元素绑事件。
- **知识图谱**：节点用百分比定位，连线用 SVG，在进入 note/create 路由后 `requestAnimationFrame(drawEdges)` 计算坐标。

## 6. 数据形状对齐（接真后端的红利）

0041 试卷链已经统一 `GeneratedExamV1`、job/quota/Notes/attempt 的 Web/Nest camelCase 契约与 FastAPI strict Pydantic；数据库 snake_case 只在 API adapter 内转换。考试 session 显式剔除答案/rubric。Knowledge list/独立 Quiz 的历史原型仍保持 Demo/Coming soon。0046–0048 候选没有复用旧 `x/y/cls` mock，而是新增 source-ordered `GeneratedKnowledgeGraphV1`、自适应 SVG 布局、hover/click detail 与 node Q&A；生产发布前仍不得称线上实现。

## 7. 踩坑

- **挂载在哪**：原型用 `document.getElementById("app")`；改为对 React 提供的容器 `_root` 操作，避免与 React 渲染冲突。
- **`window.addEventListener` 生命周期**：resize 的 add/remove 已对称放进 `mountNalanda`/cleanup；StrictMode 或登出再登录会重新挂载监听器，jsdom shell 回归对此有断言。
- **跨账号模块单例**：legacy 模块仍是单例，但每次 `init*` 都会清空用户态缓存并递增 `sessionVersion`；异步响应只有版本仍匹配时才可写 UI，防止 A 的延迟响应落到 B 的页面。新增模块必须沿用这一约束，或改成实例化 React state。
- **body 布局**：登录页需要居中、应用需要 `.app` 占满视口；把全局居中从 `index.css` 移除，分别由登录页自身和 `.app`（`height:100vh` 网格）负责。

## 8. 验证

- `vite build` 通过（完整 `nalanda.css` 约 19.6KB 进包）。
- 可执行 jsdom 回归已纳入仓库测试基线；覆盖矩阵和命令见 [测试指南](../guides/TESTING.md)。历史的临时脚本结果不再作为唯一证据。
- 线上包内含全部视图文案；`https://nalanda.online` 登录后可浏览所有页面。

## 9. 后续 TODO（迁移方向）

生产 0041–0043 在不扩大 React 收敛范围的前提下增加 Materials “Use AI” 菜单/设置/任务面板，以及 React `NotesView` 的真实试卷/在线考试。0046–0048 候选只在同一边界增加图谱/节点问答并修复文案漂移：Materials 与 My Notes 始终显示英文，复用原 class/token/字体/焦点与响应式规则，不跟随全局中文 locale。历史 My Notes 数据继续保留为明确 Demo 分组；账号变化会清理用户级 consent、job polling 和 IndexedDB 草稿。

这不是全站 React 迁移：Home、Create、Note Market 等 legacy/mock 边界仍存在。不得因为 Notes 局部真实化就删除其它原型数据或改变原设计。

逐模块把「innerHTML 视图」重构为类型安全 React 组件。legacy 生命周期、跨账号清理、登录 loading 和主要 Supabase `{ error }` 检查已补齐；当前优先级是：**完成 Materials 试卷发布 → 开放其它 AI 产物/Notes 编辑 → Home 真数据 → Market/credits/支付**。更大的 React 收敛仍不是本功能范围。
