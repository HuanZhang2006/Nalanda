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
| Auth 用户 UUID/metadata | data dump 覆盖 | Provider、SMTP、URL、签名配置；密码/会话恢复能力需演练 |
| Storage bucket/object metadata | data dump 覆盖 | **对象文件字节的异地复制和 manifest** |
| migration history | 独立 schema/data dump | 与仓库 migration checksum 对账 |
| Supabase 平台配置 | 否 | 控制台配置清单/基础设施记录 |
| GitHub/服务器 secrets | 否 | 独立 secret manager；备份包禁止包含明文 secret |
| Web/API | Git SHA image + release 目录 | 异地镜像/artifact 保留和服务器重建演练 |
| nginx/TLS/DNS/compose | 仓库有参考配置 | 生产实际配置、证书和 DNS 切换记录 |

数据库 dump 不能恢复 Storage 文件，应用 artifact 不能恢复数据库，Supabase daily backup 也不能替代服务器和 secret 备份。

## 3. RPO/RTO 目标

以下是待业务 owner 批准的目标，不是现有 SLA：

| 等级 | 数据 | 目标 RPO | 目标 RTO | 目标机制 |
|---|---|---:|---:|---|
| 核心 | Auth、课程/资料、未来钱包/支付 | ≤ 15 分钟 | ≤ 4 小时 | PITR/日志恢复 + 事件账本 + 异地副本 |
| 重要 | 社区、计划、通知、反馈 | ≤ 24 小时 | ≤ 8 小时 | 每日备份 + 每次迁移恢复点 |
| 对象 | 私有资料、社区媒体 | ≤ 24 小时 | ≤ 24 小时 | S3/对象增量复制 + checksum manifest |
| 部署 | Web/API/config | 每次发布 | ≤ 2 小时 | Git SHA artifact + config-as-code + secret manager |

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

脚本会：链接明确 Ref；按 Supabase 官方顺序导出 roles/schema/data/history；写入 manifest 和 SHA-256；加密；再解密核对全部文件。临时明文位于权限 `0700` 的临时目录，并由 `trap` 清理。

最低成功标准：

- 脚本退出 0；
- ciphertext 非空且能用离线保存的 key 验证；
- manifest 的 source Ref、Git SHA、创建时间正确；
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
- function owner/search_path/EXECUTE grants 正确。

Auth/Storage：

- 隔离用户可登录；UUID 与业务 FK 对齐；
- Provider/SMTP/redirect URL 和签名配置已重建；
- bucket 属性、RLS 和 object manifest 正确；
- 文件字节从独立副本恢复，随机样本 checksum 一致；
- 私有资料只能由 owner 签名读取。

应用：

- `/api/health`、登录、`/api/me`；
- owner-only 课程/资料/任务/反馈；
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
- points/credits/支付事件账本和可重放 webhook。
