# ADR-0002：Supabase 承担 Auth、Postgres 与 Storage，RLS 是数据授权边界

> **本文内容：**记录认证、关系数据、文件存储和行级授权采用 Supabase 的决策。  
> **作用：**明确浏览器直连场景下真正的安全边界，以及所有数据模型必须满足的 RLS/Storage 约束。  
> **何时更新：**身份提供商、数据库/Storage、租户模型、JWT 验证或授权策略改变时；出现重大 RLS 事件时。  
> **安全说明：**本文记录目标边界，不代表现有每条策略都安全；已知缺口见根 `SECURITY.md`。

- **状态：**Accepted
- **日期：**2026-06-20
- **决策者：**项目维护者
- **范围：**认证、PostgreSQL、PostgREST、Storage

## 背景

产品需要邮箱登录、用户私有课程/课件、公共社区、文件上传和后续实时通知。早期团队希望降低自建认证、对象存储和数据库运维成本，同时允许简单 owner CRUD 直接从浏览器访问。

## 决策

- Supabase Auth 是用户身份源，用户 ID 使用 `auth.users.id`。
- Postgres 是业务事实源；Storage 保存文件对象，表中只存对象引用和元数据。
- 用户请求携带 Supabase JWT；NestJS 优先通过项目 JWKS 校验 issuer/audience/签名，旧 HS256 secret 只作兼容回退并计划淘汰。
- 对浏览器可访问的表和 bucket 默认启用 RLS/Storage policy；授权依据 `auth.uid()`、所有权和明确公共范围，而不是客户端过滤。
- service-role 只存在于服务端受控环境，并视为 Restricted secret；它绕过 RLS，所有使用点需额外业务授权和审计。
- schema 变更只通过可追踪迁移发布，并用至少两个普通用户做允许/拒绝测试。

## 后果

Supabase 减少基础设施工作并提供统一身份，但 RLS 错误会直接成为数据泄露/篡改；service-role 泄露影响极大。Auth 用户删除可以级联部分表，却不会自动证明所有 Storage、备份、第三方 AI、支付和审计记录已按政策处理。

## 当前实现与目标差距

- **当前：**生产已有 Auth、profiles、Materials、通知/反馈、社区、Schedule、points，以及 0011–0013 新建的 Courses 15 表与私有 TTS cache；migration history 已到 0013。
- **已收口：**0008–0010 的 Profile/points 与 0011–0013 的 Courses 边界均已生产发布。Courses 私有表只给 owner SELECT，客户端写与工作流 RPC 被撤销，API 用 service-role 专用事务入口；CI 自动执行 0007→latest、空库 lint、双用户 RLS/Storage/Courses 和 Playwright。
- **当前风险：**community-media 仍是 public；feedback/notifications/帖子部分服务端字段尚未全面列级收口；注册绕过邮箱确认且无滥用控制；旧 Profile 余额只能保留为待审计 opening，无法自动证明未被旧漏洞篡改。
- **目标：**继续完成逐字段权限审计；把 Storage 生命周期、导出/删除、审计、Realtime channel 授权和 staging 演练纳入同一模型。

## 验证与复审

每个资源验证匿名、用户 A、用户 B、后端服务角色的每个 CRUD 动作。任何“前端隐藏按钮即可安全”的实现直接违反本 ADR。
