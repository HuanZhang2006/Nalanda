# Nalanda 安全策略

> **本文内容：**说明 Nalanda 的漏洞报告方式、当前安全边界、已知风险、开发与发布安全基线，以及安全事件响应要求。  
> **作用：**为研究者、贡献者和运维人员提供唯一的安全协作入口，避免把密钥、漏洞细节或用户数据暴露在公开渠道。  
> **何时更新：**认证/授权、RLS、上传、AI、支付、部署拓扑或第三方处理者变化时；发现或修复高风险问题时；至少每季度复核一次。  
> **状态基线：**2026-08-14。生产数据库已受保护应用到 0051；0049–0051 应用候选因 first-party OpenAI 无 ZDR endpoint 自动回退，旧 Web/API 恢复且 Materials AI/Luna 保持关闭，不能据数据库版本声称新 UI 已上线。字段收口、points 上限/审核/协同信号和 Redis 限流仍有效。本文明确区分代码、数据库、应用与供应商上线状态。

> **Unreleased 应用变更：**0046–0051 数据库已应用；对应应用增加 service-role-only checkpoint/usage/知识问答/任务清理/图谱布局工作流、Luna 原文件流水线、真实 upstream 审计和 24 小时恢复 TTL。Luna 只有实时 catalog 与真实 OpenAI gate 均合规后才打开，否则稳定禁用且不放宽 ZDR。

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
| 认证 | Supabase Auth；NestJS 使用 JWKS，旧项目可回退 HS256；两条路径均校验签名、issuer 与 authenticated audience | 并非全部业务都经过 NestJS |
| 注册 | `/api/auth/register` 使用 service-role 创建已确认用户；生产 0039 叠加 nginx + Redis HMAC IP/email 限流与审计 | 仍不提供验证码或邮件所有权验证 |
| 业务数据 | 多数 Web 业务通过 `supabase-js` 直连 PostgREST/Storage | 前端校验不是安全边界，必须依赖 RLS/约束 |
| 私有资料 | `courses`、`materials` 和 `materials` bucket 按 `auth.uid()` 隔离 | 文件元数据删除不保证对象删除事务化 |
| 社区 | 帖子/评论对已认证用户公共可读；生产 0039 把帖子写面限制为内容列并用 trigger 维护 owner/快照/计数/时间；社区媒体 bucket 当前为 public | 公共媒体 URL 不具有撤回、鉴权或防爬保证 |
| Feedback / Schedule | 生产 0039 使 Feedback 仅 owner 新增/读取，并对 goal/task 的 course/material/goal owner 及 `done_at` 做 trigger 校验 | 完整账号删除/Storage 编排仍不存在 |
| Profile / points | 0008 用列级授权保护经济/等级/streak；生产 0039 增加冻结日窗口、永久 claim、审核冲正与只标记协同检测 | 不等于 credits/VIP/支付商业账本或自动内容质量判断 |
| Courses API | NestJS bearer + owner 校验，写入经 service-role 专用事务 RPC；客户端只读私有行，传播公开读取经 API 脱敏；生产总 history 已到 0043 | service-role、feature flag 或 API 缺陷仍可绕过 RLS；provisional UI/倒计时不能作为成长事实 |
| Redis 请求保护 | 生产 0039 为 private/password/AOF/noeviction，Lua 窗口键只用 user UUID 或 HMAC IP/email；Redis 不存 points 事实 | PING 不证明 AOF/容量，HMAC 轮换会重置 actor 窗口，Redis 不能替代 PostgreSQL 审计 |
| 分享/课程市场 | token 只存 SHA-256，publication 快照不可变，免费克隆独立且不能再传播，举报/管理员动作留事实 | 持链接者即可预览；当前只有最小治理，无申诉/通用审核台；Course Market 不代表 Note Market 已真实 |
| Azure Speech | key 仅 API；reference 从 owner word/session 推导；WAV≤2 MB/8秒且格式校验；录音不存储；生产 Japan East 基础 gate 与 0015–0016 队列/重复词/裁剪评分 gate 已通过 | PR/Playwright 自动测试仍为 fake；一次发布 gate 不是持续可用率证明，TTS cache 不是用户录音 |
| OpenRouter 翻译前测 | API 从 owner session/word 推导参考翻译；同 UUID/revision 租约与幂等；用户答案只存 hash；新表/RPC service-role-only；生产真实 gate 已通过 | fake/单次真实 smoke 都不是持续语义质量证明，模型输出不能直接改成长事实 |
| API 其它能力 | health、register、me；旧业务多数直连 Supabase | Courses AI 文件导入、支付、钱包和通用管理后台安全控制尚不存在 |
| Materials AI | 生产 0041–0043 为 owner-only Nest API、service-role 事务、Postgres durable job、BullMQ UUID 投递和内网 token FastAPI；OpenRouter 固定 ZDR 模型与 strict schema | 注入分类、ZDR、结构化输出或单次真实门禁都不能提供数学上的绝对安全保证 |
| Luna 原文件（候选） | inline base64、不使用 Files API；PDF native parser；固定 Luna + OpenAI-only/no fallback；响应 upstream 与 usage ledger 双重验证；独立 flag/格式 allowlist | 模型“支持 file”不等于每种 Office/文本格式已通过真实门禁；不能自动转换或降级 |
| 支付 | 未实现 Stripe、订单、账本、退款和分成 | `profiles.credits`/`vip_until` 不是可信钱包或订阅系统 |

## 4. 已修复控制与开放风险

- 候选代码已移除 API 对长时间 worker response headers 的依赖：202 接收后只允许持有内部 token 的 worker 回调。provider usage 先写 0600/0700 本地 spool，再幂等写账本；已验证断点可能在 TTL 内包含私有 DocumentIR/产物，禁止备份、日志输出或跨 job 复用。
- 知识节点提问只由 API 从 owner 的 Note 读取 graph/DocumentIR；浏览器不能提交模型、key、source blocks 或回调地址。问题、focus、文件文本与图片一律是不可信数据，确定性信号和两次安全审查继续失败关闭。
- 候选 Delete/Cancel 先在数据库原子结算额度并进入 `deleting`，再由带内部 token 的 worker cancel/purge 清 HTTPX、Office 进程组、checkpoint、usage spool 和 0700 目录；usage 未持久落账或清理未确认时不得硬删/从 UI 隐藏。

仓库的 0008 migration 已关闭最初三项 P0：

1. authenticated 只能更新 Profile 的 `username/university/major/year/language/timezone`，且 timezone 必须合法；`credits/points/level/level_name/vip_until/streak/streak_date` 由列级授权和防御触发器保护。
2. `_add_points` 已对客户端和 service-role 撤权；`_notify`、`_set_point_event` 及 trigger helpers 已撤销客户端 EXECUTE，并固定 `search_path`。
3. 点赞、评论、原创/转发和任务奖励写入 append-only `point_entries`，以持久业务键和 `point_event_states` 串行化；取消/删除冲正，重做只恢复同一净额。客户端不能写账本/状态表。

这些控制由双用户 RLS 回归和 0007→最新历史升级覆盖。0011–0038 已按受保护流程进入生产：Courses 服务端工作流撤销客户端 EXECUTE，禁止客户端写内容/progress/badges/points，限制公开传播面；answer attempt 绑定 owner/session/revision 和 UUID 幂等键，持久音频队列、翻译评判与 STT 配额表不向客户端开放，新增 RPC 仅 service-role 可执行。发布事实见[数据库发布记录](docs/operations/DATABASE_RELEASE_ROLLBACK.md)。

仍开放的高优先级风险：

1. 注册接口持有 service-role 并直接确认邮箱；生产 0039 已增加来源/邮箱限流和滥用审计，但仍缺验证码、邮箱所有权证明和更完整反自动化。
2. NestJS 已按 `CORS_ALLOWED_ORIGINS`/`PUBLIC_ORIGIN` 返回跨域许可；仍需在每次新增正式域名、preview 域名或 cookie 鉴权前复核 allowlist 与凭据策略。
3. 帖子、Feedback、Schedule 和 points 的 0039–0040 修复已完成受保护第一阶段发布与真实 RLS/权限验证。0041–0043 只新增 Materials AI，不撤销兼容列；未来 0044–0045 最终撤权仍必须等待兼容应用从 `2026-08-10T09:35:34Z` 起观察满 24 小时并通过 go/no-go。
4. 社区媒体为公开 bucket；删除帖子不会自动证明附件已删除，上传类型、大小、恶意文件和孤儿对象治理不完整。
5. 迁移前 points 缓存无法证明来源；`legacy_opening=11` 已由 0009 append-only reversal 归零。生产 0039 只承认存在首条正向业务 transition 的 grandfather 奖励；0008 回填占位造成的历史负账以单独 append-only 补偿归零，不能改写旧分录。协同阈值只按交互结构标记、不会自动处罚，也没有语义垃圾判断、完整审核后台或申诉；points 仍不是商业货币或抗作弊信誉凭证。
6. `credits`/`vip_until` 已锁为服务端字段，却仍无订单、credit/VIP 账本或 Stripe 事实链，不能启用真实商业权益。
7. 仓库曾存在本地环境文件；任何密钥一旦被提交、进入日志或共享终端输出，都必须按泄露处理，删除文件不能替代轮换。
8. NestJS 使用 service-role 访问 Courses。生产 0039 的通用 request limit 在 Redis 故障时对注册、写入、公开 Courses 和成本路径 fail-closed、私有纯读取 fail-open；路由分类、trust proxy、HMAC 日志和合法流量误限流必须持续观察，不能通过关闭 interceptor 恢复。
9. 课程分享是 bearer-link 模型，持链接者可读取当前词表；作者必须能撤销/轮换。市场 v1 的管理员来自环境 UUID 列表，尚无通用 RBAC/申诉；变更必须审计。
10. Azure 录音虽然不持久化，但会在请求内转发第三方；供应商条款、区域、DPA/留存与真实成本告警必须在 production flag 前确认。供应商失败不得累计用户错误。
11. OpenRouter 翻译前测会在用户显式开启后转发当前英文、参考翻译与用户键入译文；仍须完成并持续复核其留存/训练/跨境/子处理者条款。模型误判是教学风险；供应商失败或非法结构化输出不得累计错误，语义基线失败应关闭最窄 flag。
12. Materials AI 会将解析后的完整文件内容送 DeepSeek，并把失败页/区域图像送 MiMo；只有用户逐账号接受版本化第三方处理说明后才能创建任务。`malicious/uncertain` 注入必须拒绝，主题/文件/答案均作为不可信数据隔离；不能把模型分类当唯一防线或通过 fallback 路由绕过 ZDR。
13. FastAPI 每任务 0700 临时目录和 `finally`/orphan 清理只处理过程文件；`ai_material_parse_cache` 与生成 Notes 是经告知的持久私有数据。Storage 对象删除是 best effort，失败必须告警/重试，不能只依赖数据库级联声明完全删除。
14. Luna 会把用户选择的原文件直接发给 OpenRouter/OpenAI；不运行本地文本提取并不减少第三方看到完整文件的隐私影响。必须保持逐账号同意、ZDR/deny collection、OpenAI-only 与 no tools/Web；不支持格式保持禁用。

## 5. 数据与密钥分级

| 级别 | 示例 | 基线要求 |
|---|---|---|
| Public | 已发布社区内容、公开文档、前端 anon key | 可公开，但仍需完整性、审核与速率限制 |
| Internal | 架构、非敏感日志、聚合指标 | 仅团队/受控系统访问 |
| Confidential | 邮箱、学校/专业、私有课件/词表、学习 attempt/progress/复习、朗读评分、笔记、反馈、IP/设备信息 | 最小权限、传输/静态加密、留存和删除规则 |
| Restricted | service-role、JWT secret、Redis password、RateLimit HMAC、Azure/OpenRouter/Stripe/Anthropic secret、Webhook secret、分享明文 token、备份、支付/身份数据 | 仅服务端密钥库/一次性响应；禁止浏览器 bundle、仓库、聊天、截图和普通日志 |

`VITE_*` 会进入浏览器产物，只允许 Supabase URL/anon key。service-role、JWT、Azure、OpenRouter、Stripe、Anthropic 和 webhook secrets 永远不得使用 `VITE_*`。

## 6. 开发安全基线

- 所有表默认启用 RLS；分别验证 `SELECT/INSERT/UPDATE/DELETE`，并用两个真实权限测试用户做跨用户负向测试。
- 用户可编辑字段与服务端字段分开：通过列级授权、受限 RPC 或后端 DTO 更新，不允许 profile 整行写入。
- `SECURITY DEFINER` 必须固定 `search_path` 并撤销默认执行权。客户端入口绑定 `auth.uid()`；service-role-only 入口的 user ID 只能由 API 从已验证 JWT 派生并做 owner 校验，不能从请求体信任。
- 所有金额、余额、points 和权益变更采用不可变账本、唯一业务事件键和冲正记录；禁止直接改余额作为正常流程。
- 服务端接口做结构校验、对象归属校验、速率限制和审计；错误不得返回密钥、上游正文、SQL 或堆栈。
- Redis 仅存可过期保护状态；user UUID/IP/email actor 先按独立 secret HMAC，原值不写 Redis/Postgres/应用日志。成本/写入路径不可因 Redis 故障静默 fail-open；points 决策只在 PostgreSQL。
- 上传同时校验扩展名、MIME、magic bytes、大小和页数；对象名由服务端生成；目标阶段增加恶意文件扫描与隔离区。
- HTML/Markdown/AI 输出渲染必须净化；社区正文、文件名和模型文本一律视为不可信输入，防 XSS、公式/URL 注入和提示词注入。
- AI 服务只接收完成授权的资料，服务间鉴权，不记录原始课件或完整 prompt；供应商训练/留存条款须经过审批。
- Materials AI worker 只允许 project signed Storage host，禁止工具/Web，固定 provider/model/schema。DocumentIR 路径限制 Office zip expansion/页数/字符/图像/资源；Luna 路径只校验并发送原始字节，禁止调用提取器、OCR、转换器或 Files API，并验证实际 upstream。FastAPI 422 也不得回显 signed URL/token/payload。
- 语义翻译评判的 reference 只能从当前 owner session/word 推导；答案正文仅内存转发，数据库/日志只留 hash 与非正文计量；provider 输出必须过结构校验并经权威事务转换，不能直接信任。
- Speech reference 只能由当前 owner 的 word/session 得到；限制 WAV magic/codec/采样率/声道/位深/大小/时长，录音仅内存转发且不得进入 DB、Storage、日志或备份。
- 公开分享/市场只返回脱敏、转义快照；token 只存哈希；撤销/克隆在同一事务重查 active。举报数量不得自动下架，管理员处置必须写审计事实。
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

当前 workflow 执行 Python ruff/pytest、AI Docker、BullMQ/Redis、Materials AI RLS 与 fake-provider Playwright。生产迁移仍先只读 plan，再受保护 apply/加密恢复点/远端验证；0046–0051 还必须真实验证 Luna 的 OpenAI upstream、PDF native parser、原始字节、逐格式能力、注入拒绝、取消残留和费用审计，且先保持子开关关闭。这些单次门禁不替代持续质量、供应商条款、监控或人工评审。

## 8. 安全事件响应

发现疑似事件时：先指定事件负责人和严重度；保全最小必要审计证据；隔离入口/关闭功能 flag；轮换疑似密钥并撤销会话；评估数据、资金与第三方影响；执行修复与验证；按适用法律、合同和隐私政策决定通知；最后形成无敏感信息的复盘和防复发事项。

资金类事件还需暂停提现与高风险订单、对账 Stripe Webhook 和内部账本，使用冲正而非删除记录。数据删除请求与事件证据冲突时，由隐私/安全负责人限定保存范围和期限。

## 9. 相关文档

- [贡献指南](CONTRIBUTING.md)
- [隐私与数据删除](docs/governance/PRIVACY_AND_DATA_DELETION.md)
- [内容审核](docs/governance/CONTENT_MODERATION.md)
- [统一经济与支付规则](docs/product/POINTS_CREDITS_VIP_PAYMENTS.md)
- [AI 评测与成本治理](docs/ai/EVALUATION_AND_COST.md)
