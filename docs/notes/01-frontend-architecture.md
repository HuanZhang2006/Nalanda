# 01 · 前端架构与原型移植

## 这篇讲什么
前端是怎么从「一份 Claude Design 的 HTML/JS 原型」变成「真实可登录的 React 应用」的，以及一个模块如何从假数据升级到真后端（Materials 就是第一个范例）。

## monorepo 结构
用 pnpm workspace + Turborepo 把多端/多服务放一个仓库，共享类型与配置：
```
apps/web   前端（Vite + React + TS）
apps/api   后端（NestJS）
apps/ai    AI 微服务（FastAPI，骨架）
packages/ui     设计令牌 nalanda.css
packages/types  共享 TS 类型
```
好处：前后端类型一致、一处 `pnpm build` 全量构建、CI 简单。

## 设计令牌（明暗主题的根基）
`packages/ui/src/nalanda.css` 是整套视觉的**单一来源**：
- 一组 CSS 自定义属性（`--bg / --ink / --accent / --card / --border …`）定义颜色、字体、间距倍率。
- 浅色写在 `:root, [data-theme="light"]`，深色写在 `[data-theme="dark"]`，**切主题就是改 `<html data-theme>` 一个属性**，所有组件颜色用 `var(--x)` 自动跟随。
- 组件类（`.btn .card .chip .nav-item .mat-row …`）也都在这里，移植过来的视图直接复用。

```
切换主题的本质：
document.documentElement.setAttribute("data-theme", "dark")  → 所有 var(--*) 重新取值
并存进 localStorage("nalanda-theme")，下次启动按保存值/系统偏好初始化
```

## 为什么「移植原型」而不是「重写成 React 组件」
原型（`/app/` 目录）已经是一套**完整、跑通、像素级**的应用（vanilla JS + nalanda.css），8 个模块、交互齐全。要快速让「所有页面都能打开」，重写成 React 组件成本高、易丢细节。所以策略是：

> **把原型的 vanilla 逻辑原样搬进 `apps/web/src/legacy/`，用一段 React 外壳在登录后挂载它**，需要接真后端的模块再逐个替换。

这是一种务实的迁移路线：先有「全功能（假数据）」，再按优先级把每块换成真后端。

### 移植做了哪些机械改造
原型靠 `window.DB / window.ICON / window.VIEWS / window.boot` 这种全局 + `<script>` 加载顺序工作。移植时用一个 Node 脚本把它改成 ES 模块：
- `window.DB = DB` → `export { DB }`；`window.ICON = …` → `export function ICON`。
- `const S = window.S = {…}` → `const S = {…}`（模块作用域单例）。
- `document.getElementById("app")` → 传入的容器 `_root`。
- `window.boot = boot` → `export function mountNalanda(container, opts)`。
- 顶部加 `// @ts-nocheck`（这是移植的 vanilla，不参与类型检查；Vite 用 esbuild 转译不做类型检查，所以能编进产物）。

## 运行时怎么跑起来（mountNalanda 机制）
`apps/web/src/legacy/app.ts` 暴露 `mountNalanda(container, opts)`：
1. 把真实登录用户写进 `DB.user`（邮箱、首字母），让界面显示真实身份。
2. `initTheme()` 读主题。
3. `renderShell()`：把侧栏 + 顶栏 + `#content` 的 HTML 塞进容器 `innerHTML`，并在容器上挂**一个**点击委托监听。
4. `go("home")` 渲染首页。
5. 返回 `cleanup`（清空容器 + 摘 resize 监听），供 React 卸载时调用。

**渲染与路由模型**（很 jQuery 时代，但简单可靠）：
- `VIEWS` 是「路由名 → 返回 HTML 字符串的函数」的表。
- `go(route)` 把 `VIEWS[route]()` 的字符串塞进 `#content.innerHTML`，并刷新侧栏高亮。
- 交互靠**事件委托**：点击冒泡到容器，读 `data-go`（跳路由）/ `data-act`（执行 ACTIONS[act]），改状态 `S` 后再 `go()` 重渲染。

## React 这层做什么（鉴权门）
`apps/web/src/App.tsx`：
- 维护 Supabase 会话（`getSession` + `onAuthStateChange`）。
- 没登录 → 渲染登录/注册卡片（见 [02-auth](02-auth.md)）。
- 已登录 → `<NalandaApp user=… onSignOut=… />`。

`apps/web/src/NalandaApp.tsx`：一个 `useEffect`（依赖空数组，**只挂一次**）里调用 `mountNalanda(ref.current, { user, supabase, onSignOut })`，返回的 cleanup 在卸载时执行。用 `signOutRef` 持有最新回调，避免令牌刷新导致重挂。

> 关键点：React 只负责「登录态」和「挂载/卸载」，挂载后由 vanilla 应用自管 DOM。两者边界清晰。

## 一个模块怎么从「假数据」升级为「真后端」
以 Materials 为范式（细节见 [04-materials](04-materials.md)）：
1. 写后端：建表 + RLS（+ 需要的存储桶），见 [03](03-database-and-migrations.md)。
2. 写一个**自管容器**的真实模块 `legacy/materials.ts`：导出 `mountMaterials(el)`，自己 `innerHTML` 渲染 `el`、自己绑事件、用 `supabase` 直连读写。
3. 在 `app.ts` 里：
   - `VIEWS.materials = () => '<div id="mat-root"></div>'`（占位挂载点，覆盖原 mock 视图）。
   - `go()` 里加钩子：进 `materials` 路由时 `mountMaterials(#mat-root)`。
   - `mountNalanda` 把 `supabase` 透传给模块。

这样新模块**不走全局委托、不被 mock 渲染覆盖**，是一块干净的「真实子应用」，与其它仍是 mock 的页面共存。

## 构建与产物
- `pnpm --filter @nalanda/web build` → Vite（esbuild）打包到 `apps/web/dist`。
- esbuild **只转译不做类型检查**，所以 `@ts-nocheck` 的 legacy 能顺利编进去；类型检查另跑 `tsc --noEmit`（可选）。
- 产物是纯静态文件，部署时由宿主机 nginx 托管（见 [05](05-deployment-and-ci.md)）。

## 验证手段（学习用）
- **构建**：`pnpm --filter @nalanda/web build` 必须过。
- **无头冒烟**：用 esbuild 把 `legacy/app.ts` 打成 IIFE，在 jsdom 里 `mountNalanda`，断言壳渲染、各路由可切、退出回调触发、cleanup 清空。这套方法对「移植有没有跑通」最敏感，开发新模块时可照做。

## 已知取舍 / 待改进
- legacy 用 `innerHTML` 字符串渲染，**没有 XSS 转义**——目前数据是自有 mock，安全；接真后端的模块（如 materials）渲染用户数据时已逐字段 `esc()` 转义，新模块务必照做。
- 长期可把高频迭代的模块逐步重写为真正的 React 组件；当前「vanilla 子应用 + 真后端」是过渡形态。
