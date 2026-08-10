# ADR-0011：私有 Redis 请求保护与不可变 Points 决策

> **本文内容：** 记录 Nalanda 为注册/Courses/API 增加私有 Redis 滑动窗口，并把 points 每日奖励决策、审核冲正和协同信号放入 PostgreSQL 受控工作流的架构决定。
>
> **作用：** 固定实时流量控制与长期业务审计的职责边界，避免把 Redis 当事实库、把客户端反馈当奖励权威，或让 service-role 绕过审核流程。
> **何时更新：** Redis 拓扑/算法/故障策略、路由分组、points 上限/账本、管理员授权、协同检测、审计保留或两阶段发布方式变化时。

- **状态：** Accepted / Stage A deployed；0039–0040 与兼容应用已于 `2026-08-10T09:35:34Z` 受保护生产发布，正在至少 24 小时观察；0041–0042 contract 尚未创建。
- **日期：** 2026-08-10
- **决策者：** Nalanda owner

## 背景

本 ADR 通过前，生产 0038 已有 append-only points 账本和稳定业务键，但没有每日奖励上限、人工审核冲正或协同行为信号。注册使用 service-role 创建已确认用户，Courses 包含克隆、举报和外部供应商成本路径；仅靠 nginx 突发限制不能形成 user/email 维度的原子窗口，也不能保存隐私最小化的长期滥用审计。上述缺口中的本 ADR 范围已由生产 0039 收口。

同时，帖子、Feedback 和 Schedule 仍有过宽的直接 PostgREST 写面。安全收口必须保持现有 Web 兼容，不能把数据库 contract 权限与应用更新放在同一次不可观察发布中。

## 决策

1. 生产 compose 增加无宿主机端口、密码认证、AOF `everysec`、`noeviction` 的 Redis 7.4。Redis 只保存短期滑动窗口、审计聚合计数和 scanner 分布式锁，不保存奖励、审核或内容事实。
2. Nest 鉴权后以 Lua 原子滑动窗口限流：认证路由按 user UUID，公开/突发按 HMAC IP，注册另按 HMAC 规范化 email。HMAC secret 与 Redis password 独立轮换，原值不进入数据库或结构化应用日志。
3. Redis 故障时注册、写入、公开 Courses、克隆/举报和会产生供应商成本的读取 fail-closed；真正的私有只读 fail-open并记录 `rate_limit_degraded`。readiness 必须同时真实验证 Supabase 与 Redis。
4. PostgreSQL 以冻结的 `point_daily_windows` 和永久 `point_daily_award_claims` 保存首次奖励决定；Redis 不参与 points 正确性。原创/转发/评论/点赞/任务每日数量为 3/10/10/20/10，课程完成继续使用永久词集合指纹且不设日上限。
5. 审核只经 allowlist 管理 API 和 service-only RPC；`point_moderation_actions` 追加留痕。service-role 对 window/claim/action/signal/API audit 表只有 SELECT，不能通过 PostgREST 改写事实。普通奖励取得共享 moderation gate，审核取得独占 gate 并先锁 Profile、再锁状态；restore 不补发 cap=0 claim，不恢复已删除来源，重复动作记录为 0 变化审计。
6. 协同 scanner 只生成去重的 pending signal，不自动冻结、冲正、隐藏或处罚。管理员的 signal review 同样经窄 RPC 写数据库时间与 reviewer。
7. 帖子/Feedback/Schedule 使用列级 grant、RLS 与防御 trigger。0039–0040 为 expand：旧 Web 可继续提交 `posts.updated_at`/`study_tasks.done_at`，但值被数据库覆盖；兼容应用生产观察至少 24 小时后才另增 0041–0042 撤销这两个列 grant。

## 结果与取舍

- Redis 丢失只影响短期窗口和锁，不能改变 ledger；AOF 降低重启窗口丢失，但不被当成强一致业务备份。
- fail-closed 会在 Redis 故障时牺牲部分写入可用性，这是保护注册、供应商成本和重复副作用的有意选择；私有纯读取仍可降级。
- 每用户 profile 行锁让 cap 并发决策简单且可验证，但会串行化同一用户的所有 points 事件；监控必须观察锁等待和 attempt/points RPC p95。
- 迁移前业务键只在首条 transition 为正时承认实际发奖；0008/0009 占位若已留下负 transition，0039 以显式 append-only 补偿归零。这增加一类迁移分录，但避免隐藏负债侵蚀未来合法奖励并保留完整审计链。
- HMAC 轮换会切断旧 actor 的跨轮换关联；轮换前后的数据库桶不尝试反推或重新识别原始 IP/email。
- 仅标记的协同阈值会有误报/漏报，因此信号不能直接形成处罚，完整审核 UI、申诉与内容质量模型留待后续。

## 验证与发布

- CI 使用真实 Redis service 验证 Lua 并发/过期/lock，使用一次性 Supabase 验证精确 grants、双用户负向路径、cap 并发、时区/重建、root suppress/restore 和 pending signal；浏览器供应商仍为 fake。
- 第一阶段已完成：只读 migration plan → 加密恢复点 → apply 0039–0040 → Redis PING/AOF/private network → 新 API readiness/auth/限流/admin 拒绝 → 真实既有供应商 gate → 激活兼容应用；证据见部署记录 run `31372888441`。
- 从 `2026-08-10T09:35:34Z` 起至少观察 24 小时 Redis 错误、误限流、points projection 和旧客户端时间字段依赖。通过后才编写、验证和发布 0041–0042；数据库始终 forward-fix，应用可回退上一兼容 release。
