# Nalanda 安全策略

> **本文内容：**说明 Nalanda 的漏洞报告方式、当前安全边界、已知风险、开发与发布安全基线，以及安全事件响应要求。  
> **作用：**为研究者、贡献者和运维人员提供唯一的安全协作入口，避免把密钥、漏洞细节或用户数据暴露在公开渠道。  
> **何时更新：**认证/授权、RLS、上传、AI、支付、部署拓扑或第三方处理者变化时；发现或修复高风险问题时；至少每季度复核一次。  
> **状态基线：**2026-07-28。生产已有受保护发布证据到 Courses 0020；幂等弱网答题、service-only 音频队列与翻译评判、private Storage/浏览器缓存、按意图恢复、限时拼写和 OpenRouter 翻译前测均已启用。本文明确区分代码、测试与上线状态。

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
| 注册 | `/api/auth/register` 使用 service-role 创建已确认用户 | 当前没有速率限制、验证码或邮件所有权验证 |
| 业务数据 | 多数 Web 业务通过 `supabase-js` 直连 PostgREST/Storage | 前端校验不是安全边界，必须依赖 RLS/约束 |
| 私有资料 | `courses`、`materials` 和 `materials` bucket 按 `auth.uid()` 隔离 | 文件元数据删除不保证对象删除事务化 |
| 社区 | 帖子/评论对已认证用户公共可读；社区媒体 bucket 当前为 public | 公共媒体 URL 不具有撤回、鉴权或防爬保证 |
| Profile / points | 0008 用列级授权保护经济/等级/streak 字段；points 由只读账本、内部状态机和稳定业务键投影 | 这不等于 credits/VIP/支付已具备商业账本，也不等于有内容质量/每日上限防滥用 |
| Courses API | NestJS bearer + owner 校验，写入经 service-role 专用事务 RPC；客户端只读私有行，传播公开读取经 API 脱敏；生产已到 0020 | service-role、feature flag 或 API 缺陷仍可绕过 RLS；provisional UI/倒计时不能作为成长事实 |
| 分享/课程市场 | token 只存 SHA-256，publication 快照不可变，免费克隆独立且不能再传播，举报/管理员动作留事实 | 持链接者即可预览；当前只有最小治理，无申诉/通用审核台；Course Market 不代表 Note Market 已真实 |
| Azure Speech | key 仅 API；reference 从 owner word/session 推导；WAV≤2 MB/8秒且格式校验；录音不存储；生产 Japan East 基础 gate 与 0015–0016 队列/重复词/裁剪评分 gate 已通过 | PR/Playwright 自动测试仍为 fake；一次发布 gate 不是持续可用率证明，TTS cache 不是用户录音 |
| OpenRouter 翻译前测 | API 从 owner session/word 推导参考翻译；同 UUID/revision 租约与幂等；用户答案只存 hash；新表/RPC service-role-only；生产真实 gate 已通过 | fake/单次真实 smoke 都不是持续语义质量证明，模型输出不能直接改成长事实 |
| API 其它能力 | health、register、me；旧业务多数直连 Supabase | AI 文件导入、支付、钱包和通用管理后台安全控制尚不存在 |
| AI | FastAPI 为固定桩；当前生产编排未部署 AI 服务 | 配置文件中的 Claude/Redis 变量不代表能力已启用 |
| 支付 | 未实现 Stripe、订单、账本、退款和分成 | `profiles.credits`/`vip_until` 不是可信钱包或订阅系统 |

## 4. 已修复控制与开放风险

仓库的 0008 migration 已关闭最初三项 P0：

1. authenticated 只能更新 Profile 的 `username/university/major/year/language/timezone`，且 timezone 必须合法；`credits/points/level/level_name/vip_until/streak/streak_date` 由列级授权和防御触发器保护。
2. `_add_points` 已对客户端和 service-role 撤权；`_notify`、`_set_point_event` 及 trigger helpers 已撤销客户端 EXECUTE，并固定 `search_path`。
3. 点赞、评论、原创/转发和任务奖励写入 append-only `point_entries`，以持久业务键和 `point_event_states` 串行化；取消/删除冲正，重做只恢复同一净额。客户端不能写账本/状态表。

这些控制由双用户 RLS 回归和 0007→最新历史升级覆盖。0011–0020 已按受保护流程进入生产：Courses 服务端工作流撤销客户端 EXECUTE，禁止客户端写内容/progress/badges/points，限制公开传播面；answer attempt 绑定 owner/session/revision 和 UUID 幂等键，持久音频队列表与翻译评判表不向客户端开放，新增 RPC 仅 service-role 可执行。0019–0020 只授权 API claim/complete/release/spelling RPC，并由 0020 对结构、RLS 和精确 grant 失败关闭。发布事实见[数据库发布记录](docs/operations/DATABASE_RELEASE_ROLLBACK.md)。

仍开放的高优先级风险：

1. 注册接口持有 service-role 并直接确认邮箱，缺少来源限制、速率限制、反自动化和滥用监控。
2. NestJS 已按 `CORS_ALLOWED_ORIGINS`/`PUBLIC_ORIGIN` 返回跨域许可；仍需在每次新增正式域名、preview 域名或 cookie 鉴权前复核 allowlist 与凭据策略。
3. 帖子作者 UPDATE 仍可能修改作者快照、冗余计数和时间等可信字段；0008 只额外锁定 `repost_of` 与 points business key。
4. `feedback` owner-all 策略仍允许用户更新自己的 `status`；`study_goals.course_id` 等剩余关联完整性也要继续收紧。
5. 社区媒体为公开 bucket；删除帖子不会自动证明附件已删除，上传类型、大小、恶意文件和孤儿对象治理不完整。
6. 迁移前 points 缓存无法证明来源；本次已把 `legacy_opening=11` 以 `legacy_opening_reset=-11` 追加冲正归零，但当前仍没有每日计分上限、内容有效性/审核撤销和协同行为检测。因此 points 可作为技术上幂等的成长值，但还不是抗滥用信誉系统。
7. `credits`/`vip_until` 已锁为服务端字段，却仍无订单、credit/VIP 账本或 Stripe 事实链，不能启用真实商业权益。
8. 仓库曾存在本地环境文件；任何密钥一旦被提交、进入日志或共享终端输出，都必须按泄露处理，删除文件不能替代轮换。
9. NestJS 使用 service-role 访问 Courses，虽已限制 CORS 且语音/翻译评判/发布/举报有持久限额，但注册与普通 Courses API 仍没有通用 request rate limit；总/子 flags 必须默认关闭到生产迁移、监控和真实 Azure/OpenRouter smoke 完成。
10. 课程分享是 bearer-link 模型，持链接者可读取当前词表；作者必须能撤销/轮换。市场 v1 的管理员来自环境 UUID 列表，尚无通用 RBAC/申诉；变更必须审计。
11. Azure 录音虽然不持久化，但会在请求内转发第三方；供应商条款、区域、DPA/留存与真实成本告警必须在 production flag 前确认。供应商失败不得累计用户错误。
12. OpenRouter 翻译前测会在用户显式开启后转发当前英文、参考翻译与用户键入译文；仍须完成并持续复核其留存/训练/跨境/子处理者条款。模型误判是教学风险；供应商失败或非法结构化输出不得累计错误，语义基线失败应关闭最窄 flag。

## 5. 数据与密钥分级

| 级别 | 示例 | 基线要求 |
|---|---|---|
| Public | 已发布社区内容、公开文档、前端 anon key | 可公开，但仍需完整性、审核与速率限制 |
| Internal | 架构、非敏感日志、聚合指标 | 仅团队/受控系统访问 |
| Confidential | 邮箱、学校/专业、私有课件/词表、学习 attempt/progress/复习、朗读评分、笔记、反馈、IP/设备信息 | 最小权限、传输/静态加密、留存和删除规则 |
| Restricted | service-role、JWT secret、Azure/OpenRouter/Stripe/Anthropic secret、Webhook secret、分享明文 token、备份、支付/身份数据 | 仅服务端密钥库/一次性响应；禁止浏览器 bundle、仓库、聊天、截图和普通日志 |

`VITE_*` 会进入浏览器产物，只允许 Supabase URL/anon key。service-role、JWT、Azure、OpenRouter、Stripe、Anthropic 和 webhook secrets 永远不得使用 `VITE_*`。

## 6. 开发安全基线

- 所有表默认启用 RLS；分别验证 `SELECT/INSERT/UPDATE/DELETE`，并用两个真实权限测试用户做跨用户负向测试。
- 用户可编辑字段与服务端字段分开：通过列级授权、受限 RPC 或后端 DTO 更新，不允许 profile 整行写入。
- `SECURITY DEFINER` 必须固定 `search_path` 并撤销默认执行权。客户端入口绑定 `auth.uid()`；service-role-only 入口的 user ID 只能由 API 从已验证 JWT 派生并做 owner 校验，不能从请求体信任。
- 所有金额、余额、points 和权益变更采用不可变账本、唯一业务事件键和冲正记录；禁止直接改余额作为正常流程。
- 服务端接口做结构校验、对象归属校验、速率限制和审计；错误不得返回密钥、上游正文、SQL 或堆栈。
- 上传同时校验扩展名、MIME、magic bytes、大小和页数；对象名由服务端生成；目标阶段增加恶意文件扫描与隔离区。
- HTML/Markdown/AI 输出渲染必须净化；社区正文、文件名和模型文本一律视为不可信输入，防 XSS、公式/URL 注入和提示词注入。
- AI 服务只接收完成授权的资料，服务间鉴权，不记录原始课件或完整 prompt；供应商训练/留存条款须经过审批。
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

当前 PR/main workflow 执行 docs、typecheck、Web jsdom、API/Courses unit、build；在一次性 Supabase 自动验证 0007→全部 0008+ 升级、空库重建/lint、四组双用户 RLS/Storage/points/Courses E2E，并以 Azure/OpenRouter fake 跑 Playwright Courses。生产迁移仍先只读 plan，再受保护 apply/加密恢复点/远端验证；这些门禁不替代真实 Azure/OpenRouter、托管 staging、监控或人工评审。

## 8. 安全事件响应

发现疑似事件时：先指定事件负责人和严重度；保全最小必要审计证据；隔离入口/关闭功能 flag；轮换疑似密钥并撤销会话；评估数据、资金与第三方影响；执行修复与验证；按适用法律、合同和隐私政策决定通知；最后形成无敏感信息的复盘和防复发事项。

资金类事件还需暂停提现与高风险订单、对账 Stripe Webhook 和内部账本，使用冲正而非删除记录。数据删除请求与事件证据冲突时，由隐私/安全负责人限定保存范围和期限。

## 9. 相关文档

- [贡献指南](CONTRIBUTING.md)
- [隐私与数据删除](docs/governance/PRIVACY_AND_DATA_DELETION.md)
- [内容审核](docs/governance/CONTENT_MODERATION.md)
- [统一经济与支付规则](docs/product/POINTS_CREDITS_VIP_PAYMENTS.md)
- [AI 评测与成本治理](docs/ai/EVALUATION_AND_COST.md)
