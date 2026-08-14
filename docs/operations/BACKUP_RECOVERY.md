# 备份与恢复

> **本文内容：** 定义数据库、Auth、Storage、配置和应用产物的备份范围、发布恢复点、验证、隔离恢复及灾难切换步骤。
> **作用：** 区分“存在某个 dump”和“完整可恢复”，并提供不会自动覆盖生产新写入的恢复路径。
> **何时更新：** 数据模型、Supabase 备份能力/方案、Storage、CI artifact、加密、保留期、RPO/RTO 或恢复负责人变化时；每次演练和事故后必须更新。

## 1. 当前状态

当前已实现的**发布级数据库恢复点**：

- 新迁移进入生产前，CI 调用 `scripts/create-db-release-backup.sh`；
- 使用 Supabase CLI 官方恢复格式导出 `roles.sql`、`schema.sql`、`data.sql` 和 migration history；
- `data.sql` 覆盖业务数据、Auth 用户和 Storage metadata，并排除不兼容的 vector bucket 内部表；
- archive 用 AES-256-CBC + PBKDF2（200,000 iterations）加密，CI 会立即解密并核对全部 SHA-256；
- 只有加密 artifact 成功上传，`db push` 才会执行；
- artifact 名为 `db-recovery-<git-sha>`，Actions 保留 14 天；
- `scripts/restore-db-release.sh` 可验证 archive，且只允许恢复到新的空白隔离 Supabase 项目。
- 最新生产恢复点由 run `31467153739` 在 2026-08-11 创建：artifact `9092230348`，824,125 bytes，artifact zip SHA-256 `6939309024094791bb639112eaf73a1429d588a4800c42703e579185a0aa817f`，覆盖发布前 0043 roles/schema/data/migration history并保留 14 天。`pg_dump` 对循环外键给出的 data-only warning 需按本文“先 schema、再数据/必要时禁用 trigger”的隔离恢复顺序处理，不代表已完成恢复演练。

这仍不是完整灾难恢复：

- dump 包含 Storage bucket/object **metadata，不包含文件字节**；
- 没有每日定时异地 dump 和 Storage 对象复制；
- 没有自动备份年龄/恢复演练告警；
- GitHub artifact 的 14 天窗口不是长期保留；
- Supabase 平台 daily backup/PITR 的可用窗口取决于生产项目方案和控制台实际状态；
- CI 不会自动把生产恢复到旧 dump，因为那会覆盖恢复点之后的新写入。

## 2. 资产与恢复边界

| 资产 | 发布 archive | 还需要什么 |
|---|---|---|
| `public` schema、函数、RLS、业务行 | 是 | 数据一致性、grants、trigger 验证 |
| Points 日窗口/永久 claim/审核 action/协同 signal/API 滥用桶 | 是 | ledger/Profile 投影、claim 不可变、审核链和 30 天审计保留专项对账 |
| Courses 内容/会话/attempt/progress/日程/分享/出版/举报/徽章/语音用量/音频队列 metadata | 是 | append-only attempt/points、revision/幂等响应、熟练日期、publication 不可变性、queue lease 与 service-only RPC 专项对账 |
| Materials AI plan/quota/job/events/parse cache/Notes/exam/provider usage（生产 0041–0043；候选 0046–0051 增加 checkpoint/graph/Q&A/Luna/layout/delete lifecycle） | 是 | reservation/consume、job lease/resume/delete、pipeline、checkpoint expiry、usage event/upstream、graph source refs、layout revision、Q&A owner、ZDR/cost metadata 和 RLS 专项对账；不得把 dump 中正文复制进开发 |
| AI worker 本地 checkpoint/usage spool | 否，且禁止纳入常规备份 | 这是单机 0700、TTL 有界的传输恢复副本，不是长期事实源；数据库 checkpoint/usage ledger 才可恢复。主机丢失时允许从最近 DB checkpoint 重做尚未保存的模型阶段，但必须用 event UUID 防重复记费，并向用户保留稳定 retry 状态 |
| Auth 用户 UUID/metadata | data dump 覆盖 | Provider、SMTP、URL、签名配置；密码/会话恢复能力需演练 |
| Storage bucket/object metadata | data dump 覆盖 | **对象文件字节的异地复制和 manifest** |
| migration history | 独立 schema/data dump | 与仓库 migration checksum 对账 |
| Supabase 平台配置 | 否 | 控制台配置清单/基础设施记录 |
| GitHub/服务器 secrets | 否 | 独立 secret manager；备份包禁止包含明文 secret |
| Web/API/AI image | Git SHA image + release 目录 | 三者同一不可变 release；异地镜像/artifact 保留和服务器重建演练 |
| nginx/TLS/DNS/compose | 仓库有参考配置 | 生产实际配置、证书和 DNS 切换记录 |
| Redis AOF/滑动窗口/scanner lock | 否（本机 volume） | Redis 只承载可重建的短期保护状态；password/HMAC 由 secret 管理恢复，不能用 AOF 恢复 points 事实 |
| BullMQ UUID 投递 | 否（Redis AOF） | `generation_jobs`/`exam_attempts` 是 durable 事实；恢复后 reconciler 从 PostgreSQL 重投，不从 Redis 推断额度/结果 |

数据库 dump 不能恢复 Storage 文件，应用 artifact 不能恢复数据库，Supabase daily backup 也不能替代服务器和 secret 备份。Redis volume 当前没有异地副本；丢失会清空短期限流窗口和 scanner lock，但 daily claim、审核、signal 与 API 审计仍在 PostgreSQL，绝不能从 Redis 反推或改写。

## 3. RPO/RTO 目标

以下是待业务 owner 批准的目标，不是现有 SLA：

| 等级 | 数据 | 目标 RPO | 目标 RTO | 目标机制 |
|---|---|---:|---:|---|
| 核心 | Auth、课程/资料、未来钱包/支付 | ≤ 15 分钟 | ≤ 4 小时 | PITR/日志恢复 + 事件账本 + 异地副本 |
| 重要 | 社区、计划、通知、反馈 | ≤ 24 小时 | ≤ 8 小时 | 每日备份 + 每次迁移恢复点 |
| 对象 | 私有资料、社区媒体 | ≤ 24 小时 | ≤ 24 小时 | S3/对象增量复制 + checksum manifest |
| 学习 | 私有词表、进度、复习日程、徽章 | ≤ 24 小时 | ≤ 8 小时 | 每日 DB 备份 + 每次迁移恢复点；attempt/points 对账 |
| 部署 | Web/API/config | 每次发布 | ≤ 2 小时 | Git SHA artifact + config-as-code + secret manager |
| AI 学习结果 | Notes、试卷、答卷、私有解析 cache | ≤ 24 小时 | ≤ 8 小时 | DB backup + job/operation 对账；过程临时目录不恢复 |

points/credits/VIP/支付上线前必须有不可变事件账本、对账和 webhook 重放；否则恢复点之后的经济事件无法可靠重放。

## 4. 发布恢复点

CI 使用以下 secrets：

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF`
- `DB_BACKUP_ENCRYPTION_KEY`

等价的受控人工命令：

```bash
SUPABASE_ACCESS_TOKEN=... \
SUPABASE_DB_PASSWORD=... \
SUPABASE_PROJECT_REF=<明确的项目-ref> \
BACKUP_ENCRYPTION_KEY=... \
BACKUP_OUTPUT=/secure/offsite/nalanda-db-<git-sha>.tar.gz.enc \
bash scripts/create-db-release-backup.sh
```

脚本会：链接明确 Ref；按 Supabase 官方顺序导出 roles/schema/data/history；写入 manifest 和 SHA-256；加密；再解密核对全部文件。若尚未采用 CLI migration history、远端连 `supabase_migrations` schema 都不存在，只有 `pg_dump` 的精确 `no matching schemas were found` 结果会被记录为 `migration_history_state=absent`；其他 history dump 错误仍立即失败。临时明文位于权限 `0700` 的临时目录，并由 `trap` 清理。

最低成功标准：

- 脚本退出 0；
- ciphertext 非空且能用离线保存的 key 验证；
- manifest 的 source Ref、Git SHA、创建时间正确；
- manifest 的 `migration_history_state` 与远端实际为 `present` 或 `absent` 一致；
- artifact 已复制到不同故障域且访问受限；
- Storage object manifest/副本有独立记录。

`DB_BACKUP_ENCRYPTION_KEY` 至少 32 个字符，应由密码学安全随机源生成。它和 archive 不能只保存在同一个 GitHub 仓库/账号；否则账号故障时无法恢复。

## 5. Storage 对象备份

Supabase 数据库备份只含 Storage metadata。正式方案应通过 S3-compatible API、Supabase Storage CLI 或受控 worker 把 `materials` 和 `community-media` 复制到不同故障域，并生成：

```text
bucket,path,size,content_type,etag_or_sha256,version,backed_up_at
```

要求：

- 私有资料在传输和静态状态均加密；
- 备份 worker 使用独立、可轮换的最小权限凭据；
- 增量复制后抽样下载校验；
- 监控对象数、总字节和最近成功时间；
- 恢复时先对齐数据库引用和 object path，不静默删除孤儿；
- 隐私删除到期后同步清理备份，保留合规审计记录但不保留内容。

`vocabulary-audio` 只含由规范化英文生成、可跨用户复用但仍保持 private 的 Azure TTS 缓存，可由 `learning_audio_assets.synthesis_text` 重新生成；它归类为**可丢失缓存**，不要求满足对象 RPO。若为了成本选择备份，也必须进入 manifest、保持 private 且不能混入用户录音。恢复时对 metadata=`ready` 但对象缺失的记录调用受控 requeue/懒生成，不能冒充完整；租约 token/过期 processing 状态可安全重领。用户朗读录音从不落库/Storage，因此不存在录音备份或恢复步骤。

浏览器 IndexedDB answer outbox 与 Cache Storage 不属于服务端备份：outbox 在登出时按账号清除，尚未同步的 provisional 答案不能由数据库恢复；本地音频是可回收副本，用户可删除。灾难恢复后客户端通过 session revision/snapshot 解决冲突，服务器确认前不得补发完成、points 或徽章。

Materials AI 的 `/tmp/nalanda-material-ai/job-*` 是短期过程/恢复目录，**不得进入长期备份或跨环境复制**。worker 可在其中短期保留已验证 checkpoint 与 usage spool，以承受 API callback 断线；成功、不可恢复失败、取消、Delete 完成或 `MATERIAL_AI_RESUME_TTL_SECONDS` 到期后清除。`ai_material_parse_cache`、`generation_job_checkpoints/exam_grading_checkpoints` 与 `knowledge_graph_layouts` 是私有持久数据，随数据库 archive 受同级加密/访问/删除规则约束。Luna checkpoint 不含 prompt 或源文件正文，原始材料仍以 private Storage 对象为事实源；没有 Storage 字节备份时不能仅靠 DB dump恢复原文件问答。恢复后由 reconciler 处理过期 lease/deleting，先重放唯一 usage event，再完成结果或 purge；相同 idempotency/operation/event UUID 必须返回既有事实，不能重复消耗 Free quota、重复记成本或重复生成 Notes。

## 6. Supabase 平台恢复点

每次生产数据库发布前，审批人还要在 Dashboard 的 Database → Backups 确认：

- 最近 daily backup/PITR 状态；
- 可恢复最早/最晚时间；
- 当前方案、Postgres 版本和恢复限制；
- 恢复是原地、克隆还是新项目；
- Storage 文件不随数据库恢复的影响。

若没有满足 RPO 的平台恢复点，发布必须依赖已验证的加密逻辑备份和 Storage 副本；两者都没有则停止发布。

## 7. 验证 archive

下载 GitHub artifact 后在安全终端执行：

```bash
BACKUP_ARCHIVE=/secure/path/nalanda-db-<sha>.tar.gz.enc \
BACKUP_ENCRYPTION_KEY=... \
bash scripts/restore-db-release.sh verify
```

脚本会解密到私有临时目录、验证全部 SHA-256，并打印非秘密 manifest 字段。只有“verify 通过”不算恢复演练。

## 8. 隔离恢复

必须创建**新的空白 Supabase 项目**。脚本安全条件：

- `RESTORE_TARGET_PROJECT_REF` 必须与二次确认值完全相同；
- 连接串必须包含该 Ref；
- 目标 Ref 不得等于 archive 的源 Ref；
- 目标必须没有 public 表、Auth 用户和 Storage objects；
- 必须显式设置 `ALLOW_ISOLATED_RESTORE=YES`；
- 全部 roles/schema/data/history 在 `ON_ERROR_STOP` 的单事务内恢复；
- data 导入期间设置 `session_replication_role=replica`，避免积分、通知、计数和 streak trigger 二次触发。

命令：

```bash
BACKUP_ARCHIVE=/secure/path/nalanda-db-<sha>.tar.gz.enc \
BACKUP_ENCRYPTION_KEY=... \
RESTORE_DATABASE_URL='<new-project-session-pooler-url>' \
RESTORE_TARGET_PROJECT_REF='<new-project-ref>' \
RESTORE_CONFIRM_PROJECT_REF='<new-project-ref>' \
ALLOW_ISOLATED_RESTORE=YES \
bash scripts/restore-db-release.sh restore-isolated
```

若托管权限、扩展或平台 schema 令官方 SQL 恢复失败，停止并保存日志；不要添加超级权限绕过。改用 Supabase Dashboard 支持的恢复/克隆流程，并在事故记录中说明差异。

## 9. 恢复后验证

数据库：

- migration history 与仓库版本一致；
- 表、RLS、policies、functions、triggers、indexes 存在；
- 关键行数、FK orphan、unique/NULL 约束正常；
- posts 冗余计数与关系聚合一致；
- points/credits/VIP/streak 没有因恢复 trigger 改变；
- 0039+ 的每个 `point_event_states.business_key` 都有唯一 claim；cap=0 只对应 `daily_cap`，moderation transition 总和与 append-only action 一致，Profile points/level 等于 ledger projection；
- function owner/search_path/EXECUTE grants 正确。
- learning course/unit/word owner 链无 orphan；active session 只在 `(user_id,resume_key)` 意图内唯一，同一课程允许不同单元/模式的未完成会话；revision 非负且与新增 attempt 时钟一致，非空 attempt UUID 在 user/session 内唯一且响应快照可重放，attempt 仍为追加事实；progress 若由正常复习熟练，则三组日期各至少两个，若由考试熟练，则存在已完成且 `examPassed=true` 的对应 exam session，不能错误地要求考试路径伪造复习日期；
- `learning_audio_assets` 无客户端 grant、无过期 processing 永久卡住；ready metadata 对应 private Storage bytes，缺失项回到 pending 后可重建，相同缓存键不重复生成；
- review schedule 未被复制成 `study_tasks`；publication snapshot/版本/指纹未改变，撤销 share 不会重新 active；
- 课程完成 points 业务键按用户+词集合唯一、badge award PK 唯一，Profile 学习聚合可从事实重算；speech usage 不含音频/参考文本。

Auth/Storage：

- 隔离用户可登录；UUID 与业务 FK 对齐；
- Provider/SMTP/redirect URL 和签名配置已重建；
- bucket 属性、RLS 和 object manifest 正确；
- 文件字节从独立副本恢复，随机样本 checksum 一致；
- 私有资料只能由 owner 签名读取。

Redis/应用：

- 以新的独立 32-byte password/HMAC secret 启动 private Redis，确认无宿主机端口、PING、AOF `everysec`、`noeviction` 和持久 volume；不要把旧 HMAC actor 与新值强行关联；
- `/api/health` 同时为 `deps.supabase=ok`、`deps.redis=ok`，再验证登录、`/api/me`；
- 验证注册/IP/email、认证 user、Courses write/public read 的 429 headers，以及 Redis 停止时 private read fail-open、注册/写入/成本路径 fail-closed；
- owner-only 课程/资料/任务/反馈；
- Courses 列表/恢复会话/复习日程/Profile 聚合；分享撤销、市场免费克隆和客户端伪造 progress/points 失败；
- 社区读写、计数、通知和幂等积分；
- smoke 数据可完整清理；
- 记录恢复耗时和实际 RPO/RTO。

## 10. 真实事故和切换

1. 宣布事故，保存日志/审计证据，确定最后正常时间和受影响写入；
2. 关闭受影响写入口；涉及泄露先轮换密钥；
3. 选择满足 RPO 的平台点或加密 archive，并列出恢复点之后的新事件；
4. 恢复到隔离项目并完成第 9 节；
5. 对 Storage bytes、Supabase 配置和 secrets 分别恢复；
6. 制定差异重放/对账方案，双人复核；
7. 准备新 URL/keys、Web 重建、API `.env`、DNS/反代和回退窗口；
   Redis 若从空状态启动，先限制公网写入并观察一个最长保护窗口，避免灾难切换瞬间把“所有窗口清空”误当作正常容量；数据库 points cap 不受此影响。
8. 经事故负责人和数据库 owner 批准后切换；
9. 监控 Auth、5xx、RLS、关键写入、对象读取和用户反馈；
10. 保留旧环境只读证据至合规窗口结束，完成事故报告。

严禁未经验证直接对生产运行 `pg_restore --clean`，也严禁因为应用发布失败而自动恢复数据库。

## 11. 后续自动化

- 每日加密数据库备份、异地复制、备份年龄/大小异常告警和保留清理；
- Storage 增量复制、checksum manifest 和季度抽样恢复；
- Auth/平台配置的可恢复清单；
- 定期自动创建隔离项目并执行完整 RLS/应用恢复演练；
- 不可变镜像/artifact 的异地 registry 与保留策略；
- 恢复演练面板，记录最近成功时间和实际 RPO/RTO；
- credits/支付事件账本和可重放 webhook；points 已有账本/claim，但仍需自动化审核对账与跨恢复点差异报告。
- Redis AOF 恢复演练、空窗口启动的受控流量方案和 volume 容量/损坏告警；AOF 不升级为业务事实备份。
- Courses 数据/成长事实/revision/attempt snapshot 恢复对账脚本，以及 `vocabulary-audio` metadata/object 不一致、过期租约、缓存清空与持久队列重建演练。
