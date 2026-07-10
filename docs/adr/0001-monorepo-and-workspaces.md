# ADR-0001：使用 pnpm 与 Turborepo 管理 monorepo

> **本文内容：**记录 Web、API、AI 与共享包采用单仓库工作区的决策。  
> **作用：**约束目录、包管理器、构建编排和共享契约的演进方式。  
> **何时更新：**工作区工具、包边界、发布策略或多端代码组织发生实质变化时；若更换方案应新建 ADR 并替代本文。  
> **实现提示：**Accepted 表示选型已接受；具体工作区是否存在以当前仓库为准。

- **状态：**Accepted
- **日期：**2026-06-20
- **决策者：**项目维护者
- **范围：**整个代码仓库

## 背景

产品蓝图包含 React Web、NestJS API、Python AI、未来 Electron/React Native 以及共享类型和设计令牌。独立仓库会增加契约漂移、跨端变更和版本协调成本；但 Python 与 TypeScript 无法完全共享同一构建工具。

## 决策

- 使用 `pnpm` workspace 管理 JavaScript/TypeScript 包，锁定 `pnpm-lock.yaml`。
- 使用 Turborepo 编排 `build`、`dev`、`typecheck`、`test` 等任务。
- 可部署应用放入 `apps/*`，可复用代码/契约放入 `packages/*`，数据库迁移放入 `supabase/*`，部署配置放入 `infra/*`。
- Python AI 服务保留自己的依赖和测试工具，但仍在同一仓库接受统一 CI 与契约测试。
- 共享类型不能只依赖编译期 TypeScript；跨 HTTP/Python 边界必须有运行时 schema 和契约测试。

## 考虑过的方案

- **每个服务独立仓库：**权限和发布隔离清晰，但早期团队的契约与文档同步成本更高。
- **单体应用：**部署简单，但 AI 解析/模型依赖与 Node 核心业务生命周期差异明显。
- **npm/yarn workspace：**可行，但项目已选择 pnpm 的严格依赖和磁盘复用能力。

## 后果

优点是原子提交、统一门禁和共享 UI/类型更容易。代价是 CI 必须正确处理多语言缓存和受影响包，错误的根脚本可能给出“部分通过”的假象；任一工作区缺测试脚本时，根门禁必须显式失败或报告未覆盖。

## 当前实现与目标差距

- **当前：**已有 `apps/web`、`apps/api`、`apps/ai`、`packages/types`、`packages/ui`，根构建/类型检查由 Turbo 编排。
- **当前限制：**Electron、React Native、api-client、i18n/config 包尚不存在；共享 TS 类型没有被 Web/API 广泛消费，Python 契约仍可能漂移。
- **目标：**每个工作区提供可执行测试；从单一 schema 生成或校验 TS/Python/API 契约；CI 按依赖图运行且汇总覆盖结果。

## 验证与复审

根目录全新安装后必须可执行 `pnpm typecheck`、`pnpm test` 和 `pnpm build`。引入独立发布周期、访问隔离或仓库规模显著增加时复审。

