# 04 · 前端与原型复现

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

源：`app/{data.js, icons.js, app.js, views-core.js, views-more.js}` → `apps/web/src/legacy/{data.ts, icons.ts, app.ts}`（用一个确定性脚本批量转换，避免手改易错）：

- `data.js`：`const DB = {}` → `const DB: any = {}`；去掉 `window.DB`，改 `export { DB }`。
- `icons.js`：去掉 IIFE 包裹；`window.ICON = function(){}` → `export function ICON(){}`；新增 `logout` 图标。
- `app.js + views-*`：拼成一个 `app.ts`，并：
  - 顶部加 `import { DB } from "./data"`、`import { ICON } from "./icons"`，声明模块作用域的 `VIEWS`、`_root`、`_opts`。
  - `const S = window.S = {…}` → 模块内 `const S`；移除 `window.VIEWS`。
  - 把对 `document.getElementById("app")` 的 innerHTML / 事件委托改为对挂载容器 `_root` 操作。
  - 新增导出 `mountNalanda(container, opts)`：写入真实用户到 `DB.user`、`initTheme()` → `renderShell()` → `go("home")`，返回清理函数（清空容器 + 解绑 resize）。
  - 顶栏加「退出登录」按钮，`ACTIONS.signOut` 调 `opts.onSignOut`。
- 三个文件加 `// @ts-nocheck`（移植 JS，类型不强求；Vite 用 esbuild 转译不做类型检查，构建不受影响）。

## 3. React 侧接线

- `main.tsx`：`import "@nalanda/ui/nalanda.css"`（完整样式）+ `import "./index.css"`。
- `NalandaApp.tsx`：`useEffect` 调 `mountNalanda(ref.current, { user:{id,email}, supabase, onSignOut })`，依赖 `[]` 只挂载一次（令牌刷新不重挂），返回 `cleanup`。
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

原型 `DB.knowledge/quiz/graph/exam` 与 `packages/types`、未来 Python AI 的 JSON schema **三方一致**。意味着接 AI 时，后端产出的结构可直接喂给现有视图渲染，几乎不改数据契约。

## 7. 踩坑

- **挂载在哪**：原型用 `document.getElementById("app")`；改为对 React 提供的容器 `_root` 操作，避免与 React 渲染冲突。
- **顶层 `window.addEventListener`**：原型在模块顶层注册 resize；保留但用变量持有以便 `cleanup` 解绑（StrictMode/重挂时不泄漏）。
- **body 布局**：登录页需要居中、应用需要 `.app` 占满视口；把全局居中从 `index.css` 移除，分别由登录页自身和 `.app`（`height:100vh` 网格）负责。

## 8. 验证

- `vite build` 通过（完整 `nalanda.css` 约 19.6KB 进包）。
- **无头 DOM 冒烟测试**（jsdom + esbuild 打包后注入 `<script>` 执行）：壳渲染、8 个模块逐一打开、导航切换、退出回调、卸载清理**全部 PASS**。
- 线上包内含全部视图文案；`https://nalanda.online` 登录后可浏览所有页面。

## 9. 后续 TODO（迁移方向）

逐模块把「innerHTML 视图」重构为真正的 React 组件，并接真后端：优先级建议 **资料库（上传到 Supabase Storage）→ AI 笔记生成（接 Python/Claude）→ 市场/支付 → 社区/计划**。迁移期可让「已 React 化的模块」与「仍走原型的模块」共存。
