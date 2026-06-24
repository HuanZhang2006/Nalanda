# 01 · 工程基建与 monorepo

> 目标：用一个仓库承载「Web 前端 + 桌面(Electron) + 移动(RN) + 后端(NestJS) + AI 微服务(Python)」，并在前后端之间共享类型与设计令牌，做到一处改、处处一致。

## 1. 技术方案

- **包管理 + 任务编排**：`pnpm`（workspace）+ `Turborepo`。pnpm 的 workspace 让本地包用 `workspace:*` 互相引用并软链；Turborepo 负责按依赖拓扑跑 `build/dev/lint/typecheck` 并缓存。
- **语言**：TypeScript 全栈。前端/后端/共享包都是 TS，类型可跨包复用。
- **为什么用 monorepo**：Nalanda 是多端 + 多服务，单仓能共享 `types`（端到端类型）、`ui`（设计令牌/组件）、`api-client`（后端 OpenAPI 生成的 SDK，规划中），避免「前后端各写一套对不上」。

## 2. 目录结构

```
nalanda/
├─ apps/
│  ├─ web/      React + Vite（生产前端，已落地）
│  ├─ api/      NestJS 核心后端（已落地：health/me/auth）
│  ├─ ai/       Python FastAPI AI 微服务（骨架 + 桩）
│  ├─ desktop/  Electron（规划）
│  └─ mobile/   React Native（规划）
├─ packages/
│  ├─ types/    共享 TS 类型（与 AI 产物 schema、原型数据对齐）
│  └─ ui/       设计令牌（tokens.css）+ 完整样式（nalanda.css）
├─ infra/
│  ├─ hybrid-2g/  通用 2G 混合部署模板（Caddy 版，参考）
│  └─ deploy/     实际生产部署（nginx 版，CI 使用）
├─ supabase/    数据库迁移 + RLS + 说明
├─ docs/        架构与笔记
└─ app/         原 Claude Design 原型（设计基线，不进生产构建）
```

## 3. 关键配置文件

- `pnpm-workspace.yaml`：`packages: [apps/*, packages/*]`。
- `turbo.json`：定义 `build`（`dependsOn: ["^build"]`，先建依赖包；`outputs: dist/**`）、`dev`、`lint`、`typecheck`。
- 根 `package.json`：`packageManager: pnpm@9.x`、脚本 `turbo run <task>`。
- `tsconfig.base.json`：共享编译选项（ES2022 / Bundler 解析 / strict）；各包按需覆盖（如 `api` 用 CommonJS + 装饰器元数据）。
- `.dockerignore`：构建镜像时排除 `node_modules/dist/.git/.env`，保证镜像精简、不泄密。

## 4. 共享包

### packages/types
纯类型，无运行时。导出与「AI 产物」「原型 `app/data.js`」一致的结构：`KnowledgePoint / QuizQuestion / KnowledgeGraph / MockExam / Language / MaterialType` 等。三方（原型数据 / Python schema / 前端类型）形状对齐，是后续接 AI 时「真数据直接渲染」的红利。

### packages/ui
设计系统的「样式底座」：
- `tokens.css`：仅设计令牌（字体、密度、强调色、明暗双主题的 CSS 变量）。
- `nalanda.css`：从原型抽取的**完整组件样式**（卡片、按钮、导航、测验、图谱、试卷等），生产前端直接 `import "@nalanda/ui/nalanda.css"`。
- 通过 `package.json` 的 `exports` 暴露：`./tokens.css`、`./nalanda.css`。

## 5. 构建链路与逻辑

```
pnpm install                 # 安装 + 软链 workspace 包，生成 pnpm-lock.yaml
pnpm build                   # turbo：按拓扑构建 types → (api/web)
  ├─ @nalanda/types: tsc → dist（.js + .d.ts）
  ├─ @nalanda/api:   tsc → dist/main.js（NestJS）
  └─ @nalanda/web:   vite build → dist/（静态产物）
```

要点：
- **Vite 用 esbuild 转译，不做类型检查**——所以 `vite build` 不会被 TS 严格模式卡住；类型检查走独立的 `typecheck` 脚本（`tsc --noEmit`）。这也是「移植的原型 JS 用 `// @ts-nocheck` 也能顺利构建」的原因。
- `pnpm-lock.yaml` **必须入库**：CI 与 Docker 构建用 `--frozen-lockfile` 保证可复现。
- 后端镜像用 `pnpm deploy --prod` 从 workspace 抽出「仅含生产依赖」的自包含目录，使运行镜像精简。

## 6. 踩坑

- **本机 Node 版本**：开发机是 Node 25，但 `.nvmrc`/CI/Docker 统一用 Node 20，避免「本地能跑、CI/线上不一致」。
- **workspace 包的 Docker 构建**：早期 Dockerfile 只 `COPY` 了部分 `package.json`，`--frozen-lockfile` 会因 workspace 清单不全而失败；改为「整仓 `COPY .` + `pnpm install` + `pnpm deploy`」后稳定。

## 7. 验证

`pnpm install` + `pnpm build` 三个包全部成功；产物：`web/dist`（含编译后的设计令牌 CSS）、`api/dist/main.js`、`types/dist`。
