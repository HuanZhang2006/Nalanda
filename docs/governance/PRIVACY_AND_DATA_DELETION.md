# 隐私与数据删除规范

> **本文内容：**定义 Nalanda 收集的数据、用途与访问边界，以及用户访问、导出、更正、删除请求、留存、备份和第三方 AI/支付数据处理流程。  
> **作用：**为产品设计、数据库、客服、安全和运维提供可执行的隐私基线；也是对外隐私政策和数据处理协议的工程输入。  
> **何时更新：**新增/改变数据字段、用途、第三方处理者、目标地区、AI/支付能力、留存期限、备份方式或用户权利流程时；发生隐私事件时。  
> **状态基线：**2026-08-11。本文不是法律意见或已发布隐私政策；生产已到 0040，HMAC 化限流审计和 points 审核/协同信号已启用。0041–0043 Materials AI 只属于候选：它会处理用户明确选择的 Materials 文件，使用私有解析缓存和 Notes，并在任务结束清理过程文件；必须完成同意、真实 ZDR/provider 和受保护发布后才是生产事实。STT 与既有 Speech 均不持久化用户 WAV，录音只在请求内存中转发并立即丢弃。

## 1. 原则与责任

Nalanda 遵循目的限定、最小收集、最小权限、默认私密、可解释、可导出、可删除和可审计。每类数据必须有业务目的、访问者、事实源、留存期限和删除路径；“将来可能有用”不是收集理由。

在任命具体人员前使用角色责任：产品负责人决定必要性与用户告知；数据/后端负责人实现访问与删除；安全负责人处理泄露与密钥；客服负责人验证和跟踪请求；第三方/法律负责人确认地区规则、未成年人、跨境、合同和法定留存。生产发布前必须把角色映射到真实值班人和私密联络渠道。

## 2. 当前数据地图

| 数据类别 | 当前位置 | 当前目的/可见范围 | 当前删除特性与缺口 |
|---|---|---|---|
| 账户 | Supabase `auth.users` | 登录身份；API JWT | 删除 auth 用户会级联多张表，但无用户自助流程 |
| Profile | `profiles` | 用户名、邮箱、学校、专业、年级、语言、成长展示 | owner-only 读取；用户只可更新资料列，points/credits/level/VIP/streak 由 0008 保护 |
| Points 记录 | `point_entries`、内部 `point_event_states`；生产 0039 的 `point_daily_*`、`point_moderation_actions`、`point_abuse_signals` | 成长事件、冻结日窗口/奖励决策、冲正、人工审核与仅待审协同线索 | 用户只读自己的 entries/owner receipt，不可见内部表；主成长事实随 Auth 删除级联，append-only 审核记录按安全/法律留存策略去标识而不是静默改写 |
| 课程/资料元数据 | `courses`、`materials` | 私有学习资料组织 | 表按用户级联；Storage 对象需单独确认删除 |
| 资料文件 | 私有 `materials` bucket | 预览、下载，未来 AI 输入 | 用户路径隔离；无统一导出/孤儿清理/备份删除证明 |
| 社区 | `posts`、`comments`、互动、关注、`tags` | 已认证用户公共交流 | 账户删除级联内容；公共作者快照/全局标签需单独评估 |
| 社区附件 | public `community-media` bucket | 图片/音频展示 | URL 可被外部持有；删帖不保证对象同步删除 |
| 学习计划 | `study_goals`、`study_tasks` | 私有目标、任务、完成时间 | owner-only；账户删除级联 |
| 学习课程内容 | `learning_courses/units/words` | 私有课程名、单元、英文/翻译/IPA；克隆来源署名 | owner 只读、API 写；删课程级联私有内容，但已发 points/徽章历史不因删课回退 |
| 学习行为 | `learning_sessions/items/attempts/word_progress`、`learning_exam_word_snapshots` | 阶段/队列、选中词集合、答案、正确性、错误次数、不同本地日期熟练度、单调 revision、客户端 attempt UUID、首次响应快照、取消时间/原因、考试类型/阈值/首轮统计、补练完成、读音分数和轮末确认；考试快照另保存当时词面/翻译/IPA及最终结果，避免内容编辑篡改历史 | owner 只能经脱敏 API 读取考试历史，快照表无客户端权限；Auth/课程/session 删除级联；不返回 WAV、密钥、音素完整 provider payload；考试通过只投影既有学习进度 |
| 复习 | `learning_review_schedules`、Profile `timezone` | 到期日期、技能/范围、完成时间与本地日期解释 | owner 私有；日程可取消，时区变化不重写历史 attempt local_date |
| 分享/课程市场 | `learning_course_shares/publications` | bearer-link 当前课程、不可变公开版本、作者显示名/来源、clone count | token 明文只返回一次且 DB 只存 hash；撤销分享；出版物公开读取经 API；Auth 删除按 FK 删除作者版本 |
| 举报/审核 | `learning_course_reports/moderation_actions` | 类别/说明、举报人、状态、管理员理由 | 举报人只能读自己的报告；动作客户端不可见；管理员/举报人删除后按 FK 删除或去标识 |
| 课程徽章/成长 | `badge_definitions/user_badge_awards` + points | 熟练词/课程/复习日期成就和 +20 事实 | award 持久防重；删课程不回退，删 Auth 用户级联；不是商业权益 |
| Speech | 请求内 WAV、`learning_attempts.provider_details`、`learning_speech_usage`、`learning_audio_assets`、private `vocabulary-audio` | Azure 朗读评分、分数/音素教学反馈、配额/估算成本、跨用户共享的合成 TTS 对象与生成队列 | 用户 WAV 仅内存转发后丢弃，不进 DB/Storage/log/backup；合成对象/队列不含 owner、翻译或录音；评分/用量随规则删除/去标识 |
| 拼写翻译前测 | 请求内用户译文、`learning_spelling_translation_assessments` | 规范化完全匹配由 Nalanda 零 token 判定；OpenRouter 只判断非字面答案是否语义覆盖服务端参考翻译；服务端保存幂等/配额/教学反馈 | 用户译文正文仅在 API 请求内存中转发，不进 DB/log/backup；DB 只存 SHA-256、boolean、短反馈、provider/model/token 计量和首次响应，session/word/user 删除级联 |
| 翻译语音输入（0037 已启用） | 浏览器短 WAV、请求内 transcript、`learning_speech_usage` | 用户在拼写前翻译输入框主动录音；OpenRouter Fish Audio 默认按中文识别并把文本回填供用户编辑，不自动提交或判分 | WAV 和 transcript 只在浏览器/单次 NestJS/OpenRouter 请求内存中存在，不进 DB/Storage/Cache/log/backup；数据库只保留 `translation_stt` 配额/估算成本，Auth 删除后 user link SET NULL；正式隐私政策、Fish Audio/OpenRouter 数据留存、训练使用、地区、DPA 与用户告知仍需产品/法律 owner 持续完成和复核 |
| 浏览器弱网副本 | IndexedDB attempt outbox、Cache Storage 音频 | 断网重试、未来五词预取和用户选择的单元音频离线副本 | 登出清除该账号待同步 outbox；音频按全局内容键存可重建副本，用户可删除，浏览器也可能在存储压力下回收 |
| 通知/反馈 | `notifications`、`feedback` | 互动通知、用户工单 | 生产 0039 起用户对 feedback 只读/新增，status 仅支持流程维护；无正式工单留存/删除编排 |
| 原型/假数据 | 前端 bundle/内存 | 演示 Home、Notes、Market、AI | 不是用户事实源，不应进入用户导出 |
| Materials AI 任务与额度（0041 候选） | `ai_user_plans/ai_daily_usage/generation_jobs/events` | 每账号同意、Free 双额度、持久任务/阶段 | Auth 删除 CASCADE；job 不保存正文/prompt/raw response；失败/取消释放 reservation |
| Materials AI 解析/产物（0041 候选） | 私有 `ai_material_parse_cache`、`notes/note_materials/note_artifacts` | 同文件复用 DocumentIR；保存用户请求的完整试卷/答案/来源 | cache 随 material CASCADE；删除来源可保留到 Unfiled 或连结果删除；用户可删除 Notes |
| 在线考试（0041 候选） | `exam_attempts/answers/operations`、浏览器 IndexedDB draft | deadline、草稿、成绩、AI feedback 和幂等重放 | note/Auth 删除 CASCADE；登出不让草稿跨账号提交；完整 DSAR/一键删除仍未实现 |
| AI provider 计量（0041 候选） | `ai_provider_usage_events` | model/token/micro-USD/latency/request ID/ZDR/status | 不含 prompt/正文/答案/raw response；随用户删除 CASCADE |
| 支付数据 | 当前无 Stripe/订单表 | 未实现 | 未来仅保存必要 Stripe ID/状态，不保存卡号/CVC |
| 限流/滥用审计（生产 0039） | 私有 Redis、`api_abuse_events` | 短时滑动窗口、分布式扫描锁、路由组/规则/桶级聚合 | IP/规范化邮箱只保存独立 secret 派生 HMAC；不保存原 IP、邮箱、正文或课程数据；DB 聚合默认 30 天，Redis key/AOF 是可重建运行副本 |
| 运维数据 | 主机/容器/GitHub/Supabase 日志 | 部署和排障 | 普通日志不得记录原 IP/邮箱/正文/secret；当前仍缺统一导出和删除编排 |

Supabase anon key 是公开客户端配置，但 service-role/JWT secret 属 Restricted；密钥不属于用户导出，却需独立轮换和事件处理。

## 3. 数据用途与禁止用途

允许的目标用途：提供认证和学习功能；保存用户主动上传的资料；生成用户请求的 AI 内容；提供社区、计划、通知和支持；执行用户购买/VIP/创作者结算；保护安全、反欺诈和满足法定义务；以去标识化聚合指标改进产品。

未经单独评审和清晰同意，禁止：出售个人数据；用私有课件、prompt 或生成内容训练 Nalanda/第三方通用模型；将学校/专业用于敏感画像或广告；把支付/身份数据混入社区；为与原始目的不相容的新用途复用数据。

## 4. 当前权利能力与诚实告知

- **访问：**用户可在 UI 查看部分 profile、课程、资料、社区和计划；这不是完整数据访问包。
- **更正：**Profile 已以列级权限区分用户资料与内部成长/经济字段；生产 0039 已收口 feedback status 和帖子可信字段。
- **删除：**可删除自己的部分资料/帖子/评论/任务；没有“一键删除账户”、跨 Storage/AI/备份/支付的编排和完成证明。
- **Courses：**用户可编辑/删除私有课程、取消日程和撤销分享；删除课程不删除已经发生的 points/徽章历史。当前无完整数据导出、一键账号删除、作者自助撤回全部 publication/举报历史的统一流程。
- **Materials AI 候选：**用户可取消任务、删除试卷；删除 Materials/科目时可选择保留到 Unfiled 或同时删除结果。过程目录立即清理，持久解析缓存只在删除来源/账号时清理；这仍不等于跨备份/第三方的一键永久删除。
- **导出：**当前没有机器可读的完整导出。
- **限制/反对/撤回：**当前没有统一工单状态与自动化执行。

因此，在目标流程完成前，对外不得声称“应用内可完整导出/永久删除全部数据”。客服收到请求时只能走经授权的人工流程，并明确范围、预计时间和备份例外。

## 5. 目标数据主体请求（DSAR）流程

所有访问、导出、更正、删除、限制和反对请求进入唯一 case，记录 `request_id`、类型、地区、接收/截止时间、验证方式、范围、执行步骤、例外、审批与完成证据；case 不保存不必要的证件副本。

### 5.1 请求与身份验证

1. 优先由已登录用户在设置中发起并近期重新认证。
2. 无法登录时，通过账户已验证邮箱和额外低风险信号验证；不得仅凭公开 profile 信息。
3. 高风险资料不通过普通邮件附件发送；使用短时、单次、可撤销下载链接。
4. 在适用法规要求的期限内回应；系统默认内部目标为 30 天内完成，地区要求更短时取更短者。
5. 明显重复/过度请求、法定保留或安全调查例外由负责人书面记录，不能由工程师口头拒绝。

### 5.2 导出包

目标导出包括：账户/profile JSON；Materials；学习课程/单元/词、session/attempt/progress/复习日程、自己的分享/publication/report/徽章和评分反馈；原始资料文件；笔记/AI 结果；社区、计划、通知/反馈；经济账单。分享 token/hash、内部队列/审核证据、他人 PII、secret、完整安全日志和第三方专有数据应剔除或脱敏；用户 WAV 从未保存，导出中不存在。

导出包须加密存储、短时有效、下载审计，到期自动删除。创建导出不能绕过 RLS：由后端逐资源授权并记录清单和行数。

### 5.3 删除编排

目标删除使用可恢复、可重试、幂等的 server-side job：

1. 重新认证，创建 case 和删除快照清单，立即冻结新上传/购买/生成；
2. 提供明确撤销窗口；高风险事件、法律保全或未结清资金存在时仅冻结必要范围；
3. 取消 Stripe 订阅/未来续费，处理退款、争议、创作者应付和法定财务保留；不直接删除不可变账本；
4. 删除/匿名化社区正文、评论、互动、关注、通知、反馈、课程、任务、个人笔记与 AI 产物；
5. 枚举并删除 `materials/{user_id}/...`、`community-media/{user_id}/...` 及未来导出/AI bucket 对象，处理孤儿和历史版本；
6. 删除学习课程、会话/attempt/progress/日程、拼写翻译评判 hash/响应、shares、本人 publication/report/badges；核对 moderation actor 和 speech usage 按 FK 去标识。0039 启用后还要删除用户可归属的 daily windows/claims/notifications，并按已批准的安全留存期限将 abuse signal 账户集合、reviewer/actor 和 moderation action 引用去标识；不能删除不可变审计来掩盖已经发生的审核。`vocabulary-audio` 是 private bucket 中按规范化内容共享的合成 cache，不含 owner 且不因单个用户删除而清空；
7. 清除该账号浏览器 IndexedDB outbox；Cache Storage 音频无账号标识且可由用户单独清除，账号删除 UI 应提供同步清理；
8. 删除解析块、embedding、prompt/cache、用户关联队列 payload、搜索索引和第三方供应商保存副本；全局 TTS 生成队列只保留无 owner 的内容键和运行元数据；
9. 删除 Supabase Auth 用户，让受约束表级联；随后反向验证学习/private/public/成长事实和对象，不能只看 job 状态；
10. 保留不含直接 PII 的最小删除凭证，并通知用户完成和备份限制。

删除失败必须进入重试和告警；部分成功时不得发送“已全部删除”。

## 6. 目标留存矩阵

以下是工程默认上限，正式上线前需按目标地区、合同和实际备份能力审批。用户主动删除优先于默认期限，法定保留除外。

| 数据 | 活跃期 | 删除/过期后的目标 | 说明 |
|---|---|---|---|
| 账户/profile/私有学习内容 | 账户存续期 | 主系统 30 天内清除 | 可先短期软删除支持误操作恢复 |
| 社区内容 | 发布至用户删除/审核移除 | 主系统 30 天内删除或匿名化 | 违规证据只保存最小必要内容与期限 |
| 社区/资料孤儿对象 | 无有效元数据引用 | 7 天内清理 | public URL 可能被外部缓存，需向用户说明 |
| AI 临时输入/渲染/OCR/原始响应 | 单任务执行期间 | 成功/失败/取消/超时 `finally` 立即删除；启动/定时清理 >1h orphan | 每任务 0700 目录；与持久解析 cache 明确分开 |
| Materials AI 私有解析 cache | 来源 material 存续期或用户删除 | material/Auth 删除时 CASCADE | 绑定 source hash + parser/audit/vision version；只用于同一用户文件后续处理 |
| Materials AI Notes/答卷 | 用户保留结果期间 | 用户删除 Note 或账号时 CASCADE；删除来源按 keep/delete 选择 | provider usage 正文从未保存；备份按滚动期限自然淘汰 |
| 用户朗读 WAV | 单次评分请求 | Azure 响应/失败后立即从内存丢弃 | 浏览器最多录制 6 秒且不做 VAD/静音裁剪；只转换为 Azure 所需 PCM WAV，服务端上限 8 秒/2 MB；不落盘、DB、Storage、日志或备份 |
| 朗读评分/学习 attempts | 账户存续期/学习反馈 | 随课程或账户删除；必要安全证据另审批 | 只存分数、错误类型、音素反馈和本地日期 |
| 翻译前测输入/判定 | 输入正文仅单请求；hash/判定随 session 存续 | 正文响应结束即丢弃；assessment 行随 session/word/user 级联 | OpenRouter 接收英文、参考 translations 与用户答案；数据库/普通日志不保存输入正文 |
| 翻译语音输入 | WAV 与 transcript 仅单次请求；配额事实按运维成本留存 | 响应后立即丢弃 WAV/transcript；删除用户后 usage 只保留去标识预算事实 | OpenRouter Fish Audio 接收用户主动录制的短 WAV 和固定 `language=zh`，不接收课程名、参考答案、邮箱、user ID、进度或奖励状态 |
| TTS private 共享 cache/队列 | 性能/成本 | 可随时清空并重新排队生成 | 只有规范化英文的 hash/voice/格式/版本、合成对象和运行元数据，不含 user ID/录音 |
| 浏览器 attempt outbox | 弱网同步 | 服务端确认后删除；登出立即清除该账号未同步项 | 包含本次答案、session/word/revision/attemptId；不得跨账号提交 |
| 浏览器离线音频 | 用户选择的单元离线播放 | 用户可随时清除；浏览器可能主动回收 | Cache Storage 中的可重建合成副本，不包含用户录音或课程私有文本 |
| Course publication/report/action | 公开传播与治理 | 作者/账户删除按当前 FK 删除或去标识；目标政策可要求受限证据保留 | v1 无法承诺法定长期审核保留，需上线地区审批 |
| API 滥用事件（生产 0039） | 安全与容量保护 | 30 天后由受控 prune 删除 | 仅 HMAC actor、可选内部 user ID、路由组、规则、桶和聚合次数；无原 IP/邮箱/正文 |
| Points 审核/协同信号（生产 0039） | 奖励完整性与申诉审计 | 账户删除时去标识直接账户引用；case/动作按获批安全或法律期限保留 | 信号仅是待审线索；不得为建模无限期保留账户图谱 |
| AI 产物与来源映射 | 账户存续期 | 随内容/账户删除 | usage 指标去标识化后可聚合保留 |
| 应用/安全日志 | 运行与安全 | 默认 30 天；安全审计最多 90 天 | 不记录原文/令牌；延长需审批 |
| 支持工单 | 处理与复盘 | 关闭后 24 个月或法定更短期限 | 删除非必要附件和敏感正文 |
| 支付、税务、应付账本 | 法定/合同目的 | 按经营地区法定期限后删除/匿名化 | 与可直接使用的账户资料分离 |
| 加密备份 | 灾难恢复 | 35 天内自然淘汰 | 删除请求完成后不为单个用户重写不可变备份 |
| 导出包 | 用户下载 | 7 天内自动删除 | 链接单次/短时有效 |

## 7. 备份与删除的关系

主系统删除完成后，用户数据可能暂时存在于加密、访问受限的滚动备份中，直到备份过期。备份不得用于日常查询或重新营销；恢复备份后必须重放删除 tombstone/case，防止已删除数据复活。恢复演练要验证该重放步骤。

备份保留超过矩阵、建立长期快照、复制到新地区或把生产数据复制到开发环境，均需隐私与安全审批。开发/测试默认只用合成数据。

## 8. 第三方与跨境处理

当前运行依赖 GitHub、部署主机、Supabase、Azure Speech、OpenRouter 和同机私有 Redis；Speech 已在 `japaneast` 启用，用户 WAV 只在请求内存中转发且响应后丢弃。OpenRouter 当前是窄范围翻译语义与中文翻译录音处理者；0041 候选把它扩为 Materials AI 处理者：完整规范化 DocumentIR 发送给 DeepSeek，只有失败范围图像 base64 发送给 MiMo；不发送邮箱、学校、service-role、Redis key、credits 或用户可选模型。2026-08-04 的真实发布 gate 已证明固定合成中文 WAV 经生产候选 API 可由 Fish Audio 识别，不代表真实用户口音质量。Materials AI 请求强制 ZDR/deny data collection/no fallback，但技术参数不替代对留存、训练、子处理者、跨境、删除、事件 SLA 和用户告知的正式审查。生产私有 Redis 不是新的外部数据处理者，只保存短时 HMAC 限流键、审计聚合和分布式锁；AOF 也不得写原始 IP、邮箱、正文、课程或供应商 secret。Anthropic 不再是该候选依赖；Stripe/邮件/监控仍是未来处理者。

AI 请求默认只传完成任务所需的片段和随机内部 ID，不发送 service-role、支付信息或不必要 profile。支付通过 Stripe 托管页面/令牌化；Nalanda 不收集或存储完整卡号/CVC。

Speech 只向 Azure 发送当前词的 reference text 和用户主动录制的短 WAV；不得发送课程标题、翻译、邮箱、学校、user ID 或分享 token。TTS 只发送英文 term。供应商失败后内存 buffer 仍必须释放，且不写用户错误次数。

OpenRouter 失败、超时或结构化响应非法时必须释放请求正文和租约，不创建错误 attempt；生产日志只保留 model、耗时、boolean 与 token 数。模型反馈不是新的参考答案，也不得用于训练、市场发布、profile 推断或其它目的。

## 9. 未成年人和敏感资料

大学生产品仍可能被未成年人使用。正式开放地区前必须确定最低年龄、监护同意和学校资料处理规则；在完成评审前不得主动面向低于当地数字同意年龄的用户营销。健康、身份文件、考试保密材料、受版权保护课件和他人 PII 不因“学习用途”自动获得处理授权；上传 UI 和条款需提示用户只上传有权处理的内容。

## 10. 工程验收与审计

隐私功能发布门禁：数据清单/所有者完整；导出 schema 和样例通过；删除 job 在包含表、Storage、AI、搜索、队列和第三方的测试账户上成功；重复请求幂等；故障可恢复并告警；恢复备份后删除仍生效；日志无原文/密钥；客服可查 case 但不能任意下载资料；用户通知和例外文本经过审批。

每季度抽样一条导出和删除请求（合成账户），记录耗时、漏项和纠正措施。新增表/bucket/供应商若未进入此数据地图，不得上线。

## 11. 相关文档

- [安全策略](../../SECURITY.md)
- [内容审核](CONTENT_MODERATION.md)
- [AI 评测与成本治理](../ai/EVALUATION_AND_COST.md)
- [points/credits/VIP/支付规则](../product/POINTS_CREDITS_VIP_PAYMENTS.md)
