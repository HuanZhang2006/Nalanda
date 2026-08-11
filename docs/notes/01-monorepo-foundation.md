# 01 · 工程基建与 monorepo

> **文档定位**
> - **内容**：记录当前 pnpm/Turborepo 单仓结构、共享包和构建边界。
> - **作用**：解释工程骨架及历史取舍，不把尚未创建的桌面/移动包写成现状。
> - **何时更新**：workspace、包依赖、构建脚本、Node/pnpm 版本或目录职责变化时。

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
│  ├─ ai/       Python FastAPI Materials AI worker（生产 0041–0043）
│  ├─ desktop/  Electron（目标；目录尚不存在）
│  └─ mobile/   React Native（目标；目录尚不存在）
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
纯类型，无运行时。Courses 与 0041 Materials AI 已由 Web/API 共用 camelCase 契约；`GeneratedExamV1`、job/quota/Notes/Exam attempt 不复用历史原型短字段，Nest 显式处理数据库 snake_case，FastAPI Pydantic 以 strict camelCase JSON 对齐。Knowledge list/Quiz/Graph 仍是未来契约，不能从试卷实现推断已接通。

### packages/ui
设计系统的「样式底座」：
- `tokens.css`：仅设计令牌（字体、密度、强调色、明暗双主题的 CSS 变量）。
- `nalanda.css`：从原型抽取的**完整组件样式**（卡片、按钮、导航、测验、图谱、试卷等），生产前端直接 `import "@nalanda/ui/nalanda.css"`。
- 通过 `package.json` 的 `exports` 暴露：`./tokens.css`、`./nalanda.css`。

## 5. 构建链路与逻辑

```
pnpm install                 # 安装 + 软链 workspace 包，生成 pnpm-lock.yaml
pnpm build                   # turbo：运行各 workspace 中存在的 build 脚本
  ├─ @nalanda/types: tsc → dist（.js + .d.ts）
  ├─ @nalanda/api:   tsc → dist/main.js（NestJS）
  └─ @nalanda/web:   vite build → dist/（静态产物）
```

Python worker不由 Turborepo 编译；CI 另执行 `ruff check`、`pytest` 和 `docker build -f apps/ai/Dockerfile apps/ai`。这三项都通过仍不等于真实 OpenRouter 或生产启用。

要点：
- **Vite 用 esbuild 转译，不做类型检查**——所以 `vite build` 不会替代独立的 `typecheck`。目前 9 个 legacy TS 文件使用 `// @ts-nocheck`，即使 typecheck 通过也不能证明 legacy 内部类型安全。
- `pnpm-lock.yaml` **必须入库**：CI 与 Docker 构建用 `--frozen-lockfile` 保证可复现。
- 后端镜像用 `pnpm deploy --prod` 从 workspace 抽出「仅含生产依赖」的自包含目录，使运行镜像精简。

## 6. 踩坑

- **本机 Node 版本**：开发机是 Node 25，但 `.nvmrc`/CI/Docker 统一用 Node 20，避免「本地能跑、CI/线上不一致」。
- **workspace 包的 Docker 构建**：早期 Dockerfile 只 `COPY` 了部分 `package.json`，`--frozen-lockfile` 会因 workspace 清单不全而失败；改为「整仓 `COPY .` + `pnpm install` + `pnpm deploy`」后稳定。

## 7. 验证

当前可执行验证以 [测试指南](../guides/TESTING.md) 为准。历史上三个包构建成功；不能仅凭旧记录判断当前提交可构建。
