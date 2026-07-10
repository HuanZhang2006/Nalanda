# ADR-0004：NestJS 核心 API 与 FastAPI AI 服务分离

> **本文内容：**记录核心业务与文档解析/模型生成分为 Node 和 Python 两个服务的决策。  
> **作用：**明确服务职责、信任边界和 AI 异步编排的目标形态，防止浏览器直接调用模型服务。  
> **何时更新：**AI 运行时、队列、服务间契约、模型供应商或部署边界变化时；若合并服务应新建替代 ADR。  
> **实现提示：**当前 FastAPI 仅返回桩结果，本 ADR 的异步流水线属于目标状态。

- **状态：**Accepted
- **日期：**2026-06-20
- **决策者：**项目维护者
- **范围：**NestJS、FastAPI、未来 Redis/BullMQ、模型供应商

## 背景

核心业务需要 TypeScript 与前端共享契约；课件解析、OCR、RAG、模型评测生态更适合 Python。AI 任务耗时、易失败且成本显著，不应占用同步 Web 请求，也不能暴露供应商密钥。

## 决策

- NestJS 是外部业务 API 和授权/计费/幂等编排者。
- FastAPI 是内部 AI 执行服务，只接受经过授权的最小输入；不得直接对公网或由浏览器调用。
- 目标流程为：API 验证资料与请求 → 估价并 hold credits → 创建持久化 job/队列 → AI 解析/生成 → schema/质量校验 → 原子落库 → commit 或 release hold → 通知用户。
- 跨服务契约必须有版本、运行时 schema、请求/结果 ID、超时、取消和可重试语义；重复执行不能重复扣费或生成不可追踪副本。
- 模型供应商可替换；业务表不以某个 Claude 版本或 prompt 的私有字段为核心标识。

## 后果

获得 Python AI 生态和独立扩缩容，但引入网络失败、契约漂移、队列运维、分布式追踪与成本对账。同步 HTTP 端点可用于受控内部单元操作，不得被误当成完整、可靠、已计费的用户流程。

## 当前实现与目标差距

- **当前：**NestJS 和 FastAPI 骨架存在；FastAPI 有 `/parse` 与四个 `/generate/*` 路由，返回固定内容；生产 compose 仅部署 Web/API，API 未调用 AI。
- **当前限制：**无真实解析、模型、RAG、队列、服务间鉴权、持久 job、取消、幂等、usage ledger、质量门或 credits 结算。
- **目标：**按 [AI 评测与成本治理](../ai/EVALUATION_AND_COST.md) 实现，并达到其中发布门禁；经济流程遵循 [统一规则](../product/POINTS_CREDITS_VIP_PAYMENTS.md)。

## 验证与复审

契约测试覆盖 TS/Python 形状；故障注入覆盖超时、重复、乱序、服务重启和模型返回坏 JSON；逐 job 对账 usage、credits 和结果。模型/解析运行时不再需要独立扩缩容时可复审。
