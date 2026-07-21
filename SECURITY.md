# Nalanda 安全策略

> **本文内容：**说明 Nalanda 的漏洞报告方式、当前安全边界、已知风险、开发与发布安全基线，以及安全事件响应要求。  
> **作用：**为研究者、贡献者和运维人员提供唯一的安全协作入口，避免把密钥、漏洞细节或用户数据暴露在公开渠道。  
> **何时更新：**认证/授权、RLS、上传、AI、支付、部署拓扑或第三方处理者变化时；发现或修复高风险问题时；至少每季度复核一次。  
> **状态基线：**2026-07-10。本文明确区分“当前已实现”和“目标/发布门禁”；目标控制不得被理解为已经上线。

## 1. 支持范围

当前仅维护 `main` 分支的最新提交以及生产站点 `nalanda.online` 对应版本。原型目录 `app/` 仅作为设计基线，不接受其作为生产安全边界。历史提交、个人 fork、本地修改版和未部署的 `infra/hybrid-2g` 脚手架不在支持范围内，但其中可复现到当前代码的问题仍欢迎报告。

## 2. 私密报告漏洞

请优先使用仓库的 [GitHub Private Vulnerability Reporting](https://github.com/1590703336/Nalanda/security/advisories/new)。如果该入口不可用，请通过仓库所有者提供的私密联系方式报告，**不要创建公开 Issue、PR 或社区帖子**。

报告至少包含：

- 受影响的提交、URL、表、Storage bucket 或接口；
- 前置权限、复现步骤、预期与实际结果；
- 影响判断（越权读取/写入、账户接管、密钥泄露、资金或 AI 配额损失等）；
- 最小化的验证证据；请删除真实用户 PII、访问令牌和密钥；
- 如已知，提供缓解建议，但不要在生产环境扩大验证范围。

维护者目标是在 3 个工作日内确认收到、7 个工作日内给出初步分级。修复时间取决于严重度和第三方依赖。未经双方约定，请勿在修复发布前披露细节。

### 安全研究边界

允许对自己拥有的测试账户和数据进行善意、低影响验证。禁止：访问或修改他人数据、持久化控制、拒绝服务、批量注册/垃圾内容、社工、扫描第三方基础设施、下载真实用户文件、触发真实支付或让第三方承担显著费用。若验证可能越过这些边界，应先取得书面许可。

## 3. 当前安全边界（已实现）

| 区域 | 当前事实 | 不应作出的假设 |
|---|---|---|
| 认证 | Supabase Auth；NestJS 对 `/api/me` 使用 JWKS，旧项目可回退 HS256 | 并非全部业务都经过 NestJS |
| 注册 | `/api/auth/register` 使用 service-role 创建已确认用户 | 当前没有速率限制、验证码或邮件所有权验证 |
| 业务数据 | 多数 Web 业务通过 `supabase-js` 直连 PostgREST/Storage | 前端校验不是安全边界，必须依赖 RLS/约束 |
| 私有资料 | `courses`、`materials` 和 `materials` bucket 按 `auth.uid()` 隔离 | 文件元数据删除不保证对象删除事务化 |
| 社区 | 帖子/评论对已认证用户公共可读；社区媒体 bucket 当前为 public | 公共媒体 URL 不具有撤回、鉴权或防爬保证 |
| Profile / points | 0008 用列级授权保护经济/等级/streak 字段；points 由只读账本、内部状态机和稳定业务键投影 | 这不等于 credits/VIP/支付已具备商业账本，也不等于有内容质量/每日上限防滥用 |
| API | NestJS 目前仅 health、register、me | AI、支付、钱包、管理后台安全控制尚不存在 |
| AI | FastAPI 为固定桩；当前生产编排未部署 AI 服务 | 配置文件中的 Claude/Redis 变量不代表能力已启用 |
| 支付 | 未实现 Stripe、订单、账本、退款和分成 | `profiles.credits`/`vip_until` 不是可信钱包或订阅系统 |

## 4. 已修复控制与开放风险

仓库的 0008 migration 已关闭最初三项 P0：

1. authenticated 只能更新 Profile 的 `username/university/major/year/language`；`credits/points/level/level_name/vip_until/streak/streak_date` 由列级授权和防御触发器保护。
2. `_add_points` 已对客户端和 service-role 撤权；`_notify`、`_set_point_event` 及 trigger helpers 已撤销客户端 EXECUTE，并固定 `search_path`。
3. 点赞、评论、原创/转发和任务奖励写入 append-only `point_entries`，以持久业务键和 `point_event_states` 串行化；取消/删除冲正，重做只恢复同一净额。客户端不能写账本/状态表。

这些控制由双用户 RLS 回归和 0007→0010 历史数据升级/旧 opening 归零/发布断言夹具覆盖。生产环境只有在 migration history 确认 0008–0010 已应用后才具备同等保护，不能只凭仓库文件推断线上状态；首次发布还必须保存旧 Profile opening/credits/VIP/streak 的聚合审计和处置决定。

仍开放的高优先级风险：

1. 注册接口持有 service-role 并直接确认邮箱，缺少来源限制、速率限制、反自动化和滥用监控。
2. NestJS 当前 `enableCors()` 未限制 Origin；上线新增敏感接口前必须改为显式 allowlist。
3. 帖子作者 UPDATE 仍可能修改作者快照、冗余计数和时间等可信字段；0008 只额外锁定 `repost_of` 与 points business key。
4. `feedback` owner-all 策略仍允许用户更新自己的 `status`；`study_goals.course_id` 等剩余关联完整性也要继续收紧。
5. 社区媒体为公开 bucket；删除帖子不会自动证明附件已删除，上传类型、大小、恶意文件和孤儿对象治理不完整。
6. 0008 只能把迁移前 points 缓存登记为 `legacy_opening`，无法证明旧分值来源；当前也没有每日计分上限、内容有效性/审核撤销和协同行为检测。因此 points 可作为技术上幂等的成长值，但还不是抗滥用信誉系统。
7. `credits`/`vip_until` 已锁为服务端字段，却仍无订单、credit/VIP 账本或 Stripe 事实链，不能启用真实商业权益。
8. 仓库曾存在本地环境文件；任何密钥一旦被提交、进入日志或共享终端输出，都必须按泄露处理，删除文件不能替代轮换。

## 5. 数据与密钥分级

| 级别 | 示例 | 基线要求 |
|---|---|---|
| Public | 已发布社区内容、公开文档、前端 anon key | 可公开，但仍需完整性、审核与速率限制 |
| Internal | 架构、非敏感日志、聚合指标 | 仅团队/受控系统访问 |
| Confidential | 邮箱、学校/专业、私有课件、笔记、反馈、IP/设备信息 | 最小权限、传输/静态加密、留存和删除规则 |
| Restricted | service-role、JWT secret、Stripe/Anthropic secret、Webhook secret、备份、支付/身份数据 | 仅服务端密钥库；禁止浏览器、仓库、聊天、截图和普通日志 |

`VITE_*` 变量会进入浏览器产物，只允许放 Supabase URL 和 anon key 等公开配置。`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_JWT_SECRET`、`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`ANTHROPIC_API_KEY` 永远不得使用 `VITE_*` 前缀。

## 6. 开发安全基线

- 所有表默认启用 RLS；分别验证 `SELECT/INSERT/UPDATE/DELETE`，并用两个真实权限测试用户做跨用户负向测试。
- 用户可编辑字段与服务端字段分开：通过列级授权、受限 RPC 或后端 DTO 更新，不允许 profile 整行写入。
- `SECURITY DEFINER` 函数必须固定安全 `search_path`，撤销默认执行权，仅授予所需角色，并在函数内部绑定 `auth.uid()`；禁止让调用方指定任意受益用户。
- 所有金额、余额、points 和权益变更采用不可变账本、唯一业务事件键和冲正记录；禁止直接改余额作为正常流程。
- 服务端接口做结构校验、对象归属校验、速率限制和审计；错误不得返回密钥、上游正文、SQL 或堆栈。
- 上传同时校验扩展名、MIME、magic bytes、大小和页数；对象名由服务端生成；目标阶段增加恶意文件扫描与隔离区。
- HTML/Markdown/AI 输出渲染必须净化；社区正文、文件名和模型文本一律视为不可信输入，防 XSS、公式/URL 注入和提示词注入。
- AI 服务只接收完成授权的资料，服务间鉴权，不记录原始课件或完整 prompt；供应商训练/留存条款须经过审批。
- 日志使用请求/事件 ID，不记录 Authorization、cookie、密码、签名 URL、密钥、完整文档、支付方法或用户删除导出包。
- 新依赖需核对维护状态和许可证；商业使用 ExamPass-Assistant 代码前必须取得商业许可，否则仅可参考方法并干净重写。

## 7. 合并与发布安全门禁

涉及认证、RLS、`SECURITY DEFINER`、Storage、用户删除、AI 调用、credits、VIP、Stripe 或后台权限的 PR，至少需要：

1. 第二位审阅者批准，并在 PR 中说明威胁、回滚和数据迁移影响；
2. 类型检查、单元/集成、RLS 双用户和相关 E2E 全部通过；
3. 数据库变更使用前向迁移，包含可执行验证和回滚/补偿步骤；
4. 新环境变量进入环境变量矩阵，并说明密级、所有者和轮换方式；
5. 新日志、指标和告警不含 PII/secret；
6. 生产变更先在隔离环境验证，支付使用 Stripe test mode；
7. 高风险已知问题关闭后，才能启用相应功能 flag。

当前 PR/main workflow 已执行 docs check、3 个发布工具测试、typecheck、9 个 Web jsdom、2 个 API readiness 单元测试和 build，并在一次性本地 Supabase 先验证 0007→0010 升级，再重建全部 migration、lint 后显式运行 3 个 RLS/Storage/points E2E。生产 migration 先走只读 plan，再经受保护 environment、加密恢复点、基线状态/结构核验、apply 和远端验证；这些门禁不替代托管 staging、持续监控或人工安全评审。

## 8. 安全事件响应

发现疑似事件时：先指定事件负责人和严重度；保全最小必要审计证据；隔离入口/关闭功能 flag；轮换疑似密钥并撤销会话；评估数据、资金与第三方影响；执行修复与验证；按适用法律、合同和隐私政策决定通知；最后形成无敏感信息的复盘和防复发事项。

资金类事件还需暂停提现与高风险订单、对账 Stripe Webhook 和内部账本，使用冲正而非删除记录。数据删除请求与事件证据冲突时，由隐私/安全负责人限定保存范围和期限。

## 9. 相关文档

- [贡献指南](CONTRIBUTING.md)
- [隐私与数据删除](docs/governance/PRIVACY_AND_DATA_DELETION.md)
- [内容审核](docs/governance/CONTENT_MODERATION.md)
- [统一经济与支付规则](docs/product/POINTS_CREDITS_VIP_PAYMENTS.md)
- [AI 评测与成本治理](docs/ai/EVALUATION_AND_COST.md)
