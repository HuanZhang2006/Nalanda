# Points / Credits / VIP / 支付统一产品规则

> **本文内容：**统一定义 points、credits、VIP、法币订单、退款、市场购买和创作者分成，并规定账本、幂等、Stripe 与 UI 边界。  
> **作用：**作为产品、API、数据库、测试、客服和财务实现经济功能的规范；旧原型或蓝图与本文冲突时，以本文为目标规则并通过 ADR 管理变更。  
> **何时更新：**奖励、等级、credits 获取/消耗、汇率/套餐、VIP 权益、Stripe 流程、退款/争议、分成/提现、税费或目标市场变化时；任何资金事故后立即复核。  
> **状态基线：**2026-08-10。生产已验证 0008–0040；课程 +20、九级徽章、服务端权威学习事实，以及 points v2 的冻结自然日奖励决策、每日数量上限、owner receipt、人工 suppress/restore 和只标记协同检测均已上线。Course Market v1 继续只免费克隆，不接 credits/支付；商业账本、Stripe、VIP 与创作者结算仍未实现。

## 1. 规范用语和总原则

本文的 MUST/必须、MUST NOT/不得、SHOULD/应该、MAY/可以具有规范含义。

五个域永远分开：

| 概念 | 用户看到什么 | 能否购买 | 能否消费 | 能否转让/提现 | 事实源 |
|---|---|---:|---:|---:|---|
| **Points** | 活跃积分、等级、徽章 | 否 | 否（不抵扣） | 否 | points 事件账本 |
| **Credits** | AI/市场消费余额 | 是，也可促销赠送 | 是 | 用户间不可转让；普通余额不可提现 | credit lots + entries + holds |
| **VIP** | 有时效的会员权益 | 是 | 不适用 | 否 | 订阅/权益账本 |
| **Fiat payment** | 真实币种订单/退款 | 用户支付 | 购买 credits/VIP/官方商品 | 退款走原支付路径 | Order/Payment + Stripe |
| **Creator payable** | 创作者待结算/可提现金额 | 非用户购买余额 | 不作为 credits 消费 | 通过合规 Stripe Connect 提现 | 独立应付账本 |

不可破坏的原则：points ≠ credits；credits ≠ 现金；VIP ≠ 全站授权；creator payable ≠ credits；profile 展示缓存 ≠ 账本。余额/等级/权益可以缓存到 profile 供读取，但缓存必须由账本重建，普通客户端不得写。

## 2. 当前实现与立即限制

### 2.1 当前可验证事实

- `profiles` 有 `credits`、`vip_until`、`level`，迁移 0006/0007 增加 `points`、`streak`；迁移 0008 把 points 改为 `point_entries` 的只读 projection。
- 生产 points 当前奖励：点赞 +1、评论 +2、普通发帖 +10、转发 +3、完成任务 +5、合格英语词表课程首次熟练 +20；等级阈值仍为 0/50/150/350/700/1200。
- 当前五类奖励均通过 `point_event_states` 和 append-style `point_entries` 激活/冲正；相同持久业务键在删除/取消后重建只恢复原净额，不再累计刷分。
- authenticated 只能更新资料白名单和合法 IANA `timezone`；经济/等级/VIP/streak 受保护。Courses 奖励/徽章/progress 也不能由客户端写或 RPC 调用。
- 0008 把迁移前 `profiles.points` 保存为 `legacy_opening`；2026-07-21 聚合审计确认唯一 Profile 有 11 points、credits/streak 为 0 且无 VIP，owner 决定 points 归零。0009 已在生产追加等额 `legacy_opening_reset=-11`，不删除 `legacy_opening=+11`，也不把它当成可信逐笔历史；0010 已验证每条 opening 恰有一条等额反向记录，且 Profile points/level 与账本投影一致。
- Create、Market、Home 中的余额、价格、25 credits、70% 分成和兑换 VIP 目前是假数据/原型交互。
- 除 points 外，没有订单、Payment、credit ledger、hold、市场购买、订阅、退款、Webhook、creator earning 或 payout 表/服务。
- Course Market 的 publication/clone/report 表不是商业市场账本；卡片只显示“免费”，不会产生购买、销量分成、credits debit 或 creator payable。
- 生产 0039 增加 `point_daily_windows/point_daily_award_claims/point_moderation_actions/point_abuse_signals`，并扩展 event state；内部表不开放 PostgREST 写入，service-role 也只能通过受控 SECURITY DEFINER 工作流改变事实。普通用户只能通过 owner-only receipt 读取自己的单次奖励决策。

### 2.2 发布限制

Profile/RPC/当前 points 重做路径的 P0 已由生产迁移 0008–0010 封堵并验证。日上限、审核冲正和协同检测已由生产 0039–0040 启用，当前只剩兼容时间列的 24 小时观察/contract；credits/VIP/支付账本及商业测试仍未实现。因此：

- 不接入 live Stripe key，不接受真实付款；
- 不把 `profiles.credits` 当可消费余额；
- 不因 `vip_until` 展示或开放付费权益；
- 不允许创作者提现或显示“可提现”金额；
- 不用客户端调用 `_add_points`/改 profile 进行客服补偿；
- 原型中的价格/余额必须标注 demo，或在商业入口上线前移除。
- Note Market 继续标注 Demo；Course Market 只能免费克隆。任何给课程加 credits/法币、销量或分成的改动都必须先走本文商业阶段和新 ADR。

## 3. Points：成长信誉规则

### 3.1 性质

Points 只衡量平台内符合规则的学习/社区活动，无货币或储值价值，不可购买、赠送、转让、出售、提现、继承、兑换 credits/VIP/课程/商品。排行榜和徽章不得改变 RLS、审核、退款、推荐申诉或客服优先级。

### 3.2 奖励事件与初始值

为保持当前体验，迁移 0008 沿用以下数值并接入事件账本。业务键由数据库生成且不可由客户端改写；生产 0039 按下表的每日“可获得奖励事件数量”执行上限，课程完成奖励不进入日上限：

| 事件 | Points | 业务事件 ID | 撤销规则 | 初始防滥用上限 |
|---|---:|---|---|---|
| 发布原创帖子 | +10 | `post:{owner}:{normalized-content-sha256}` | 最后一个同键帖子删除时 -10；重建只恢复净额 | 每日计分 3 篇 |
| 转发帖子 | +3 | `repost:{actor}:{root-post-business-key}` | 最后一个同键转发删除时 -3；重建只恢复净额 | 每日计分 10 次 |
| 发布有效评论 | +2 | `comment:{target-post-business-key}:{actor}` | 同一 actor/目标内容只有一个有效奖励 claim；删尽时 -2 | 每日计分 10 条 |
| 首次点赞 | +1 | `like:{target-post-business-key}:{actor}` | 同一 actor/目标内容只有一个有效奖励 claim；取消后 -1 | 每日计分 20 个不同帖子 |
| 首次完成任务 | +5 | `task:{owner}:{normalized-task-sha256}:completed:v1` | 最后一个同键任务取消/删除时 -5；重做只恢复净额 | 每日计分 10 个任务 |
| 首次熟练合格词表 | +20 | `learning-course-completed:{user}:{sha256(sorted distinct normalized terms)}` | 历史成就不因删课程冲正；相同词集合的重建/克隆永不重复奖励 | 每个用户/不同词集合永久一次；至少 20 个不同词 |

自赞、自评、自关注、同一内容重复关系仍由既有业务规则处理。协同行为检测只生成待审信号，未经过人工 `suppress` 不能自动拒奖或冲正。达到上限不阻止发帖、转发、评论、点赞或完成任务，只把该稳定 business key 的首次奖励 decision 永久记录为 0；删除、取消、换时区或重建都不能补领。Web 在业务写成功后读取 receipt 并提示，receipt 失败不得回滚已经成功的业务操作。

运营若调整数值/上限，只影响新事件，不重写历史；大规模补算必须创建带活动/规则版本的批次和可冲正记录。

### 3.3 冻结日窗口、回执与审核

- `point_daily_windows` 在首次受限奖励时冻结用户当时的合法 IANA 时区、local date 和对应 UTC 起止。同一活动窗口结束前修改 Profile 时区不会提前开启第二个窗口；跨午夜后的下一窗口由数据库重新计算。
- `point_daily_award_claims` 对每个稳定 business key 保存规则版本、名义金额、实际金额、上限、owner/root 和唯一 decision。迁移前已有 business key 以 `grandfather-v1` 固化，不追溯套用新上限；实际金额只采信该 business key 的首条正向 transition。0008 只有 active 占位、但没有逐业务正向分录且已由 0009 归零的旧事实永久固化为 0，删除、重建或审核不得制造负分或重新领奖。若旧占位在 0039 前已被取消并留下无正向来源的负账，0039 不改旧分录，而是追加一条 `grandfather-zero-reset-v1` 等额补偿并重新投影 Profile，使其净额可审计地回到 0。
- `get_point_reward_receipt(eventType,sourceId)` 只从 `auth.uid()` 推导 owner，返回实际金额、当日已用数量/上限、local date 与 `daily_cap/moderation` 原因。每类每天首次超限由数据库写一条持久通知；重复读取不重复通知。
- `suppress/restore` 只允许配置 allowlist 中的管理员经 NestJS API 执行，必须携带理由和可选 case reference。原创帖 suppress 处理锚定同一 root 的原创、转发、评论和点赞奖励；只撤回历史实际得到的金额，不制造额外负分，删除内容不重复冲正。restore 只恢复原本实际获奖且仍存在的事实，不补发 daily-cap decision 为 0 的奖励。审核使用独占 gate，并在锁状态前按 UUID 顺序锁定相关 Profile；普通奖励使用共享 gate，避免两条事务路径形成 Profile/状态行反向锁死。重复 suppress/restore 仍追加 0 变化审计，不能伪装成目标不存在。
- `point_moderation_actions` 只追加；信号 review 和奖励 moderation 均经受控数据库函数写入。直接客户端调用、客户端/匿名读取内部表、service-role 直接 INSERT/UPDATE/DELETE 都必须失败。

### 3.4 协同检测不是自动处罚

生产扫描器每五分钟用 Redis 分布式锁确保单实例，检测四类线索：单 actor 对单 owner 24 小时 ≥8 且集中度 ≥70%；双方合计 ≥12 且双向各 ≥4；3–8 个账户七天内部互动 ≥30 且集中度 ≥70%；至少 8 个注册不足七天的账户在十分钟内集中到同一 root/owner。信号按类型、排序账户集合和对齐窗口去重，只能处于 `pending`、`reviewing`、`dismissed` 或 `escalated` 审核状态。

命中阈值不自动扣分、冻结、隐藏、封禁或改变后续奖励。审核员应结合内容、关系和误报情形人工判断；确认信号后若要冲正，仍需单独提交带理由的 moderation action。首版没有管理 UI，也没有 webhook/pager，只有受控管理 API、数据库审计和脱敏结构化日志。

课程奖励的“100%”只看服务端 `learning_word_progress.learned_at`，不看首次四阶段完成度。该字段只由双考试事实派生，相关事实分为：

1. **复习事实不再形成掌握：**发音、翻译、拼写在不同本地日期的已完成 review session 中最终答对，仍记录三组去重日期和 `review_count`，但无论日期数量多少都不写考试事实或 `learned_at`。
2. **双考试共同掌握：**完整拼写考试第一轮达到阈值并完成全部候补轮时，对选中词写 `spelling_exam_passed_at`；完整发音考试以同样条件写 `pronunciation_exam_passed_at`。只有两个字段都存在才投影 `learned_at`。0031 允许选择单元子集；任一考试未达阈值时，即使所有错题已修正并自动结束，也只写 `practiceCompleted`，不会反转失败或写该项考试事实。两类考试都不伪造复习日期。该规则已随 0029–0034 于 2026-08-03 生产启用。

两个考试事实和 `learned_at` 投影都只能由 service-role 数据库事务/trigger 执行。生产 0035–0036 强制 `learned_at` 精确等于两个考试时间中的较晚值，缺少任一事实或直接写入任意值都会被投影回正确结果。详细条件、编辑重置矩阵和逐层代码索引见 [Courses 英语单词学习文档](../notes/11-learning-courses.md)。课程还须至少 20 个不同规范化英文词/短语且全部 `learned_at` 非空，服务端才在 `_refresh_learning_growth` 内用词集合 fingerprint 调现有 points 状态机并写 `points_claimed_at`；相同用户/词集合永久只奖励一次，客户端不能自报完成。

弱网流程中的前端正误、cursor 和“等待同步”都只是 provisional UI。每个答案用 `(user_id,session_id,attempt_id)` 幂等，revision 冲突由服务端拒绝；只有服务端事务确认 attempt、阶段完成、progress、徽章和课程 fingerprint 后才能显示或发放成长事实。离线预测完成、超时重试、重复 replay、Cache Storage 命中和音频生成都不能直接产生 points、徽章、credits 或 VIP。

### 3.5 Courses 徽章（非经济权益）

徽章是历史成长展示，不可购买、消费、转让、兑换或提现，也不赋予 VIP/市场/审核特权。阈值：

| 家族 | 铜 / 银 / 金 | 计数语义 |
|---|---|---|
| 词汇行者 `vocab_words` | 20 / 200 / 1000 | 所有私有课程中规范化去重且 `learned_at` 非空的英文词/短语 |
| 课程毕业生 `vocab_courses` | 1 / 5 / 20 | 至少 20 个不同词且全部熟练的英语词表课程 |
| 复习坚持者 `vocab_review_days` | 3 / 15 / 50 | 已完成 review session 的不同 attempt `local_date` |

`(user_id,badge_code)` 唯一且只追加发放；删课或后来编辑导致统计回落不撤销、不重新发同一枚。删除整个 Auth 账户按隐私流程级联用户 award。Profile 只显示聚合/奖章，不能修改事实。

### 3.6 账本与等级

`point_entries` 至少包含 `id,user_id,event_type,business_key,amount,rule_version,source_id,reversal_of,created_at,metadata`。`business_key` + 生效方向有唯一约束；金额为有符号整数；禁止 UPDATE/DELETE 已入账记录，纠错新增冲正。

等级按有效 points 总额派生：

| Level | 名称 | 最低 points |
|---:|---|---:|
| 1 | Novice | 0 |
| 2 | Learner | 50 |
| 3 | Scholar | 150 |
| 4 | Mentor | 350 |
| 5 | Sage | 700 |
| 6 | Luminary | 1200 |

冲正导致低于阈值时等级可以下降；徽章若是历史成就，需在徽章规则中明确“保留”或“随等级失效”，不能由 UI 猜测。points 余额不得低于 0；若冲正超出余额，记录全额负向事件但展示/等级使用 `max(0,sum)`，同时产生审计告警以便查明异常。

## 4. Credits：封闭消费余额

### 4.1 性质与展示

Credits 用于 Nalanda 内的 AI 生成和笔记市场数字内容。它不是银行存款、法币、加密资产或用户间支付工具；普通 wallet credits 不可出售、赠送、转账或提现。法定消费者权利和退款义务优先于“不可提现”产品规则。

内部只使用整数 credits，不显示小数。目标基础定价参考为 **1 USD = 10 credits**（1 credit 的标准参考价值为 USD 0.10，税前）；这用于产品报价和创作者应付快照，不代表兑回承诺。各地区 top-up 套餐按币种保存实际 `amount_minor/currency/credits/tax`，历史订单永远使用下单快照，不能用当前汇率反算。

### 4.2 Credit lot

每次获得 credits 创建 lot：

- **purchased：**Stripe 付款后由已验证 Webhook 发放；默认不主动过期，法律/地区条款另有要求时从严；
- **promotional：**活动赠送，可设明确到期时间；用户获得前展示期限；
- **service_recovery：**客服对故障补偿，默认不设短期到期；必须关联 case 和审批；
- **refund_credit：**数字内容退款返回的 credits，继承原消耗 lot 的来源/到期属性，不能借退款洗成可提现价值。

消费顺序：最早到期 promotional → 其他 promotional → 最早创建 purchased/service recovery；精确分配记录到 `credit_allocations`。余额是未过期 lot 的 credits minus committed allocations；hold 影响 available，不改变 settled balance。

### 4.3 AI 计费

AI 请求在用户确认前展示 credits 价格/估算、产物、资料和可调整因素。请求流程必须是：

1. 客户端提交幂等键；API 校验资料所有权、配额、价格版本；
2. 在单事务创建 job 与 credit hold，返回稳定 job ID；
3. 成功且结果通过 schema/质量门后 commit 实际价格；
4. 用户可用的取消、验证失败、服务错误或超时 release 全部 hold；
5. 若产品允许区间估价，实际扣费不得超过用户确认上限；超出须重新确认，低于上限只 commit 实际值；
6. 同一幂等键/业务 job 的重试不得重复 hold、扣费或生成多份收费结果。

模型供应商 token 成本与用户 credits 价格分开：产品价格包含解析、模型、存储、失败率和运营，不随着供应商账单事后篡改用户已确认价格。VIP 可提供月度 included credits/折扣，但应创建清晰 lot/price adjustment，而非绕过账本。

### 4.4 市场购买

本节只适用于未来 Note Market/付费数字内容，**不适用于 Course Market v1**。Course Market publication 标价恒为“免费”，克隆只创建独立私有内容/零进度，不创建 credit hold/debit、purchase/license、creator earning、销量分成、订单或支付事实；克隆课保留来源署名且不能再次分享/上架。未来若课程收费，必须设计独立版本授权/退款/版权/分成，不得把 clone_count 当销量账本。

市场商品使用整数 credits 定价。发布版本、预览、许可范围、AI 标识、作者和内容 hash 在购买时快照。购买必须在数据库事务内：锁定/验证 listing → 检查买家与作者/重复购买 → hold/commit credits → 创建唯一 purchase/license → 创建 creator payable pending → 返回用户库引用。

唯一键至少包含 `(buyer_id, listing_id, listing_version 或许可语义)`；双击/网络重试只能返回原 purchase。禁止作者购买自己的商品以制造销量/分成。商品更新是否需要重新购买由 listing 的版本政策决定，不能静默让已购内容消失。

## 5. VIP：订阅权益，不是余额

### 5.1 事实源和状态

VIP 由 `subscriptions`/`entitlements` 和 Stripe subscription/invoice 状态派生，不以客户端写 `profiles.vip_until` 为事实源。建议状态：`incomplete → trialing/active → past_due → paused/canceled → expired`；Webhook 乱序时按 Stripe 对象版本/事件时间和状态机处理，不能简单“最后收到覆盖”。

`vip_until` MAY 作为只读缓存，由服务端重建；客户端只能读取。取消默认在已付款周期末生效；支付失败的宽限期、暂停和恢复必须有明确配置和用户文案。

### 5.2 权益边界

首版可从以下候选中选择并在 plan version 中锁定：每月 included AI credits、更高非付费速率/并发、AI credits 折扣、高级导出/主题、官方 Nalanda 内容权益。每项权益需指定数量、重置时区、结转、降级和退款行为。

VIP 永远不：改变数据所有权/RLS；免除内容审核/反滥用；自动获取第三方创作者的付费市场笔记；允许无限成本 AI；把 points 变 credits；保证 AI 正确；优先处理法定权利。旧原型“用 points/credits 兑换 VIP”不属于首版规则，除非经过新的经济/法律评审和 ADR。

## 6. Stripe 与订单状态机

### 6.1 边界

Stripe 处理真实支付、订阅和 Connect payout。浏览器只能使用 publishable key/Checkout Session；secret key、Webhook secret 和 Connect 控制在 NestJS/受控 worker。Nalanda 不保存完整卡号/CVC。

### 6.2 下单

API 根据服务端 price catalog 创建 `orders`，忽略客户端传入的金额、credits 数量、折扣或用户 ID。订单记录类型、user、currency、amount_minor、tax、product/plan/price version、credits/权益、状态、幂等键和 Stripe ID。

建议状态：

```text
draft -> pending_payment -> paid -> fulfilled
                        \-> failed / expired
fulfilled -> partially_refunded / refunded / disputed
```

`paid` 只表示可信支付事件，`fulfilled` 表示内部 credits/权益已幂等发放。二者分开使补偿和重试可审计。

### 6.3 Webhook

Webhook 必须：使用原始 body 验签；检查 live/test mode 和账户；把 `event.id` 以唯一约束持久化后再处理；快速返回并异步重试；允许重复/乱序/延迟；每种事件有明确状态转换；未知事件安全记录但不发权益。不能以 success redirect 或客户端轮询作为付款证明。

需要覆盖 Checkout 完成/过期、PaymentIntent 成功/失败、invoice paid/payment_failed、subscription created/updated/deleted、charge/refund/dispute 和 Connect account/payout 事件。实际列表随 Stripe API version 固定并写入 API 文档。

## 7. 退款、撤销与争议

### 7.1 通用规则

法定权利优先。所有退款创建 `refund` 和账本冲正，引用原订单/支付/lot/purchase/earning；不得 UPDATE/DELETE 掩盖历史。金额、税、credits、权益、创作者应付和平台收入必须在同一业务 case 对账。

### 7.2 Credits top-up

- 重复/错误扣款：确认后原路退款，并撤销对应未使用 credits。
- 用户主动退款：默认支持购买后 7 天内且对应 purchased lot 完全未使用的整单退款；适用法律要求更宽时从其规定。
- 已部分/全部使用：不自动承诺现金退款；若法律或故障必须退款，按原 lot allocation 冲正下游权益，允许 wallet 暂时为负并冻结新增消费，不能伪造 0 余额抹账。
- Stripe 争议/chargeback：把订单标为 disputed，冻结关联 purchased lot 和必要的提现，调查后冲正；不因争议自动封禁全部账户数据。

### 7.3 AI 任务

平台错误、超时、取消成功、坏 schema/质量门失败：release/退回全部 credits。结果已成功交付但用户主观不满意时，按已公开质量承诺和客服 case 判断；若内容实质为空、与资料无关或重复扣费，应退款并保留评测样本的去标识化事件（不保留原资料，除非另获同意）。

### 7.4 市场笔记

重复购买自动合并并退回重复扣费。内容无法访问、与描述实质不符、侵权/审核下架时，默认在购买后 7 天内退回 credits；法定要求或平台过错可突破窗口。退款同时撤销/限制 license，并对 creator pending/available earning 创建反向记录；已 payout 的负额进入创作者后续应付抵扣/风险流程，不直接篡改历史 payout。

### 7.5 VIP

取消默认在周期末停止续费；已付周期继续可用。重复扣款、未授权支付、服务长期不可用或法定退款按未使用比例/法律处理，并同步调整 included credits/权益。单纯取消不自动退当期款，购买前必须明确展示。

## 8. 创作者分成与 Stripe Connect

### 8.1 分成基线

首版默认创作者份额 **70%（7000 bps）**、平台份额 30%，在 purchase 时保存 `share_bps` 快照。分成基数是 listing credits 按购买时 `settlement_rate_snapshot` 换算的税前标准内容价值，扣除退款/折让；支付处理成本和税的承担需在卖家条款/地区定价中明确，不能事后秘密改变旧订单。

示例（仅说明算法）：100 credits，快照 1 credit = USD 0.10，则标准内容价值 USD 10.00；创作者应付 `floor(1000 cents × 7000 / 10000) = 700 cents`。货币换算与取整在货币最小单位完成，余数进入平台 rounding account。促销 credits 购买时，平台按活动规则为创作者出资，默认不降低创作者已展示的份额。

### 8.2 应付状态

`pending`（购买后）→ 14 天风险/退款 hold → `available` → `payout_pending` → `paid`；退款/审核/争议可进入 `reversed` 或对已支付项创建负向 adjustment。只有通过身份/KYC、税务、地区资格、内容审核和最低付款门槛的创作者可发起 Connect payout。

普通 credits 钱包永远不直接变成可提现余额。UI 可以并列展示“市场标价：credits”和“预计创作者收益：货币”，但必须标注估算、hold、税费和最终结算状态。

### 8.3 退款与下架

退款在 available 前优先冲正 pending；available 未支付则减少 available；已 payout 生成负应付，在未来收益抵扣或按卖家协议追回。审核下架不自动没收合法、无关收益；只有与违规/欺诈购买关联的金额被冻结，并且提供理由与申诉。

## 9. 目标数据模型与账本不变量

### 9.1 最小实体

- `point_entries`、`point_rule_versions`；
- `credit_accounts`、`credit_lots`、`credit_entries`、`credit_holds`、`credit_allocations`；
- `orders`、`payments`、`refunds`、`stripe_events`；
- `subscriptions`、`entitlements`、`plan_versions`；
- `market_listings`、`market_purchases`/licenses；
- `creator_accounts`、`creator_earnings`、`payouts`、`adjustments`；
- `economic_audit_events`，只保存必要元数据，不复制 secret/卡信息。

### 9.2 不变量

1. 每个外部/业务事件有全局或域内唯一幂等键。
2. 已入账 entry 不更新/删除；纠错通过 `reversal_of`/adjustment。
3. settled credits = 有效 lot 入账 − committed allocations；available = settled − active holds。
4. 每个 hold 只会 commit 或 release 一次；过期 hold 由 worker 安全回收。
5. 每个 Stripe event 只产生一次状态转换/履约，即使重复或乱序到达。
6. 每个市场 purchase 的 credits debit、license 和 creator earning 原子一致；失败全部回滚。
7. points entry 永不进入 credit/creator ledger。
8. VIP entitlement 不由 profile 客户端字段决定。
9. creator earning 与 payout 的货币、金额、汇率、分成版本可逐笔追溯。
10. 管理员/客服不能直接改余额；调整需要 case、原因、审批、幂等键和相反方向可冲正记录。

## 10. 幂等、并发和失败语义

客户端每个创建/消费请求生成稳定 `Idempotency-Key`；服务端将 key 绑定用户、操作、规范化 payload hash 和结果。相同 key + 不同 payload 返回冲突，不能复用。数据库使用唯一约束和事务作为最终防线，不能只靠 Redis 锁。

并发消费对账户/lot 使用行锁或可证明的原子更新，禁止负 available。第三方成功、内部履约失败时订单停在 `paid` 并重试 fulfillment；不得再次向用户收费。内部成功、响应丢失时重试返回同一资源。死信和人工修复只发补偿事件。

## 11. 对账、监控与权限

- 每日对账 Stripe balance transaction ↔ Payment/Refund/Payout ↔ Order/账本；差异为 0 或有带 owner/截止时间的 case。
- 每小时检查 stuck pending/paid-not-fulfilled、过期 hold、负余额、重复业务键、ledger/cached balance 差异、Webhook 延迟/失败和 payout 异常。
- 使用双人审批处理大额调整、退款和提现；阈值在受控配置中设置，不能硬编码在前端。
- RLS 让用户只读自己的账单；所有写入通过 NestJS/worker 受限角色。运营后台不持有浏览器 service-role。
- 日志不包含卡信息、secret、完整 Webhook body 或用户课件；事件 ID/订单 ID 足以关联。

## 12. UI 与客服文案

界面必须始终使用不同名称和图标：`Points / 活跃积分`、`Credits / 创作额度`、`VIP`、`Creator earnings / 创作者收益`。禁止笼统写“积分”同时指 points 和 credits。购买页展示币种/含税总价、获得 credits、退款摘要和套餐版本；消费页展示所需/可用 credits；VIP 页明确不包含市场内容；创作者页区分 pending/available/paid。

客服补偿通过 service recovery lot 或账本 adjustment，不要求用户刷新/改 profile；给用户的答复包含订单/case ID、影响条目和预计到账时间，不暴露内部风控。

## 13. 分阶段开发路径与发布门禁

### Phase 0：封堵当前风险

- [x] 列级禁止客户端修改 credits、points、level、VIP、streak；
- [x] 撤销 points/notification definer 的客户端默认执行权，停用 `_add_points`；
- [x] 建立当前 points 事件账本、稳定业务键、净额幂等/冲正、空库与 0007→0010 升级/发布断言测试；
- [x] 审计旧漏洞期间的 opening points/credits/VIP/streak，并记录 2026-07-21 points 归零决定与 0009 append-only reversal；
- [ ] 收紧 feedback `status` 等仍由 owner 整行策略暴露的服务端字段；
- [x] 原型商业入口保持 demo/feature flag，不接真实支付。
- [x] Course Market v1 与商业域隔离：只免费克隆，不读写 credits/订单/应付；克隆课禁止再次传播。
- [x] Courses +20 使用用户+排序去重词集合 SHA-256 永久键，徽章以用户+code 唯一；0011–0013 已于 2026-07-22 生产发布。
- [x] 0015–0016 已由真实本地 Supabase E2E 证明重复 `attemptId` 只落一条、revision 冲突不推进、离线完成待服务端确认且不重复奖励，并于 2026-07-27 完成受保护生产发布。

### Phase 1：无真实支付的账本

- 实现 credit account/lot/entry/hold、测试 catalog 和 AI/市场事务夹具；
- 属性/并发测试验证不变量；余额可从账本重建；
- 仅管理员测试 grant，仍不接 live Stripe。

### Phase 2：Stripe test mode

- Order/Payment/Webhook/Refund/Subscription 全状态机；
- Stripe CLI 固定夹具覆盖重复、乱序、失败、退款、争议；
- 每日对账、告警、密钥轮换和数据库恢复演练通过。

### Phase 3：受限 live credits/VIP

- 完成目标地区法律/税务/条款/隐私评审；
- 小流量、额度限制、人工值班和 kill switch；
- 至少一个完整账期对账无未解释差异后扩大。

### Phase 4：市场与创作者 payout

- 内容审核/版权/申诉、seller onboarding、KYC/税务、14 天 hold、退款冲正、Connect payout 和财务对账全部通过；
- 首批 payout 双人审批并逐笔核验；
- 未完成前只可展示非提现 demo 销量。

## 14. 变更控制

以下变化必须产品 + 工程 + 安全 + 财务/法律（适用时）审批，并新增/替代 ADR：points 可兑换；credits 可转让/提现；1 USD = 10 credits 基准变化；VIP 包含第三方市场内容；分成 70% 变化；hold/退款窗口实质变化；新增币种/地区/支付方式；允许负余额继续消费；把 creator payable 合并进 wallet。

所有规则变化采用 versioned configuration，只影响清楚定义的订单/事件范围；不得静默重算历史。

## 15. 相关文档

- [ADR-0005：经济域分离](../adr/0005-economy-domain-separation.md)
- [安全策略](../../SECURITY.md)
- [隐私与数据删除](../governance/PRIVACY_AND_DATA_DELETION.md)
- [内容审核](../governance/CONTENT_MODERATION.md)
- [AI 评测与成本治理](../ai/EVALUATION_AND_COST.md)
