# 备份与恢复

> **本文内容：** 定义 Nalanda 数据库、Supabase Auth、Storage 对象、运行配置和部署产物的备份范围、验证方式、恢复决策与演练步骤。  
> **作用：** 在误删、错误迁移、账号/对象丢失、供应商或服务器故障时，提供经过验证的恢复路径，而不是把“有备份”误当成“可恢复”。  
> **何时更新：** 数据模型、Supabase 方案/恢复能力、Storage、部署位置、保留期、加密/密钥、RPO/RTO 或恢复负责人变化时；每次恢复演练和数据事故后必须更新。

## 1. 当前状态

当前仓库没有：

- 自动数据库 dump 任务；
- Storage 文件备份/清单脚本；
- 恢复脚本或恢复测试；
- 备份加密、异地复制、保留/删除策略的代码；
- 记录 RPO、RTO、最近成功备份和最近演练的监控；
- Auth 用户与 Storage 对象的可移植导出流程。

生产业务数据在 Supabase Cloud，Web 静态文件和 API 容器运行于服务器 `/opt/nalanda`。是否具备 Supabase 平台备份/PITR、可恢复时间窗和 Storage 恢复能力取决于**当前项目方案与控制台实际配置**，每次依赖前必须现场确认，不在本文中假定已经启用。

本文的命令是建立人工恢复点的基线；真正达标需要定时自动化、异地存储、告警和季度恢复演练。

## 2. 必须分别保护的资产

| 资产 | 当前位置 | 仅数据库 dump 是否足够 | 恢复重点 |
|---|---|---|---|
| `public` schema/数据 | Supabase Postgres | 可做逻辑副本，但依赖 Auth UUID | 表、函数、触发器、RLS、grants、业务行 |
| Auth 身份/session | Supabase `auth` 管理域 | **否**；不要把 `public` dump 当 Auth 备份 | 保留 user UUID，确认供应商支持的恢复方式 |
| Storage 元数据 | Supabase Postgres `storage` schema | 元数据不等于文件内容 | bucket、object path、metadata |
| Storage 文件字节 | Supabase Storage 对象层 | **否** | `materials` 私有对象、`community-media` 公开对象及校验和 |
| Supabase 项目配置 | Supabase 控制台 | 否 | Auth provider、URL、签名 key、Storage bucket、网络/邮件配置 |
| 服务端环境/Secrets | GitHub Secrets、`/opt/nalanda/.env` | 否 | 必须在 secret manager 中独立托管，不能明文进备份包 |
| Web/API 部署产物 | CI runner、服务器 | 否 | Git SHA、不可变镜像、前端 artifact；当前只保留 `latest`，能力不足 |
| nginx/TLS/compose | 服务器 + 仓库参考副本 | 部分 | 实际 nginx/certbot 状态、compose、恢复后域名切换 |

## 3. RPO/RTO

当前产品尚未批准正式指标。以下是**待业务 owner 确认的初始目标**，不是现有 SLA：

| 等级 | 数据 | 目标 RPO | 目标 RTO | 建议机制 |
|---|---|---:|---:|---|
| 核心 | Auth、课程/资料元数据、未来钱包/支付 | ≤ 15 分钟 | ≤ 4 小时 | 平台 PITR/日志级恢复 + 异地验证 |
| 重要 | 社区、计划、通知、反馈 | ≤ 24 小时 | ≤ 8 小时 | 每日恢复点 + 发布前快照 |
| 对象 | 私有资料、社区媒体 | ≤ 24 小时 | ≤ 24 小时 | 对象版本/每日增量复制 + manifest |
| 部署 | Web/API/config | 每次发布 | ≤ 2 小时 | Git SHA artifact + 配置即代码 + secret manager |

在 points/credits/VIP/支付上线前必须把这些领域提升为不可变事件账本，并把 RPO/RTO、对账和 webhook 重放纳入上线门禁。

## 4. 发布前人工数据库恢复点

### 4.1 准备

使用可读 `public` schema 的 PostgreSQL 连接串临时设置 `DATABASE_URL`。它不是应用运行变量，敏感级别等同数据库密码。优先使用 `.pgpass`/受控 secret 注入，避免把连接串写入 shell history。

```bash
export BACKUP_DIR="backups/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$BACKUP_DIR"
```

`backups/` 应位于受控、加密、非仓库目录；示例相对路径只为说明。绝不能在项目目录内 `git add` 备份。

### 4.2 导出 `public` schema 与数据

```bash
pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_DIR/public.dump"
```

生成可审阅目录和校验和：

```bash
pg_restore --list "$BACKUP_DIR/public.dump" > "$BACKUP_DIR/public.dump.list"
shasum -a 256 "$BACKUP_DIR/public.dump" > "$BACKUP_DIR/SHA256SUMS"
```

记录行数基线：

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "select relname || ',' || n_live_tup from pg_stat_user_tables order by relname" \
  > "$BACKUP_DIR/public-row-estimates.csv"
```

`n_live_tup` 是估算值，只用于快速比较；关键表应另做精确 `count(*)`。备份成功的最低条件是：`pg_dump` 退出 0、文件非空、`pg_restore --list` 可读、校验和已写入、关键表数量合理。

### 4.3 记录 Storage 清单

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --csv \
  -c "select bucket_id, name from storage.objects order by bucket_id, name" \
  > "$BACKUP_DIR/storage-objects.csv"
```

此 CSV **不包含文件字节**。当前仓库没有对象下载/复制工具，因而 Storage 还没有合格备份。目标实现必须使用 service-role 在受控 worker 中逐对象复制到不同故障域，记录 bucket/path/size/content-type/checksum/version/backup time，并定期抽样下载校验。日志不得打印签名 URL 或 service-role key。

### 4.4 记录发布元数据

备份记录至少包括：

```text
Environment / masked project ref:
Git SHA / migration set:
UTC start and finish:
Operator / reviewer:
pg_dump and pg_restore versions:
Dump checksum:
Key table exact counts:
Storage manifest object counts by bucket:
Supabase platform restore-point ID/time (if available):
Encryption key ID and backup location:
Verification result:
```

记录不包含连接串、数据库密码、service-role key 或用户 token。

## 5. 平台级恢复点

在每次数据库生产发布前，操作人还应在 Supabase 控制台确认：

1. 当前项目实际启用的备份/PITR 能力；
2. 最近一个可恢复点的 UTC 时间和状态；
3. 恢复是原地、创建新项目还是需要支持工单；
4. 是否包含 Auth、数据库平台 schema 和 Storage 文件字节；
5. 恢复对项目 URL、keys、连接串和停机时间的影响。

只有写入发布记录且最近演练成功的能力才能算恢复依赖。控制台显示“备份成功”但从未恢复验证，不算完整保障。

## 6. 保留、加密和访问基线

以下是**目标策略**，自动化尚未实现：

- 数据库：每日 30 份、每月 12 份；每次生产迁移前额外保留一份直至发布稳定至少 30 天。
- Storage：每日增量 + 定期全量 manifest；删除对象进入与隐私政策一致的保留窗口。
- 备份至少一份位于 Supabase/生产服务器之外的独立账号或存储域。
- 传输使用 TLS，静态使用 KMS/等价 envelope encryption；加密 key 与备份分开保存。
- 读取/恢复权限只给指定运维角色，启用 MFA，所有下载/恢复有审计日志。
- 备份中包含个人数据；隐私删除、法定保留和备份自然过期必须在隐私文档中一致定义。
- 到期删除必须可审计；不得因“长期留档”无限期保存用户数据。

## 7. 恢复决策

| 事故 | 首选路径 | 不应做的事 |
|---|---|---|
| 单行/小批误删 | 从隔离恢复副本核对后选择性回填 | 直接把整个生产回到旧时间点 |
| 错误 migration/大面积数据破坏 | 停止相关写入；平台恢复点恢复到隔离项目；验证后切换或审计回填 | 未验证就原地 `pg_restore --clean` |
| Supabase 项目不可用 | 按平台灾难恢复流程恢复/克隆；更新 URL/keys 后逐层验证 | 假定 `public.dump` 可独立恢复 Auth 和 Storage |
| Storage 文件删除 | 从异地对象副本按原 bucket/path 恢复，再核对表引用 | 只恢复 `storage.objects` 元数据 |
| 应用服务器丢失 | 新机恢复 nginx/compose、从不可变 artifact 部署、从 secret manager 注入配置 | 从数据库备份寻找服务器 secret |
| 密钥泄露 | 先轮换/撤销，再恢复服务和审计 | 把旧 secret 从备份复制回生产 |

## 8. 隔离恢复演练

至少每季度、重大 schema 变更后和任何真实事故后执行。不得把练习直接指向生产数据库。

### 8.1 选择恢复目标

优先使用 Supabase 平台提供的**新项目/隔离恢复副本**，因为 `public` 表通过 UUID FK 依赖 `auth.users`，Storage 还依赖平台管理 schema 和实际对象层。单独把 `public.dump` 恢复进空 PostgreSQL 不能证明完整应用可恢复。

### 8.2 校验 dump 可读性

```bash
shasum -a 256 -c SHA256SUMS
pg_restore --list public.dump > /dev/null
```

### 8.3 在一次性目标尝试逻辑恢复

只有目标已隔离、允许清空 `public`、且 Auth UUID 已通过平台恢复保留时，才可演练：

```bash
pg_restore \
  --dbname="$RESTORE_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --schema=public \
  --exit-on-error \
  public.dump
```

`--clean` 会删除目标对象，**严禁对生产执行**。若 Supabase 托管权限、扩展或平台对象导致失败，应停止并记录，不要用高权限手工绕过；改用平台支持的恢复路径。不要在已建触发器的 schema 上简单 data-only 导入：当前点赞/评论/任务触发器会改变计数、points、streak 和通知，可能造成二次副作用。

### 8.4 恢复后验证

数据库：

- dump checksum 和恢复日志无错误；
- 13 张当前业务表、RLS、policies、函数、触发器、索引存在；
- 关键表精确行数与恢复点记录一致；
- FK orphan、唯一约束、NULL/枚举约定无异常；
- posts 冗余计数与关系表聚合抽样一致；
- profiles 的 points/credits/VIP/streak 没有因恢复触发器改变。

应用：

- 隔离账号登录和 `/api/me`；
- owner 只能读取自己的课程/资料/任务/反馈；
- authenticated 社区可读、非作者不可改；
- private material 可签名预览/下载；
- community media 可按 manifest 读取；
- 新建/修改/删除 smoke 数据后能完整清理。

Storage：

- bucket 属性和 policy 正确；
- manifest 数量、总字节数、随机样本 checksum 一致；
- 数据库引用到的路径存在，孤儿对象另行统计而不是静默删除。

演练成功标准必须包括完整应用验证和耗时；只运行 `pg_restore --list` 不算恢复演练。

## 9. 真实事故恢复步骤

1. 宣布事故，记录发现时间、最后确认正常时间、受影响数据和当班负责人。
2. 保存日志和审计证据；必要时停止相关写入口，避免覆盖可恢复数据。
3. 若涉及泄露，先按[密钥轮换](./SECRET_ROTATION.md)撤销凭据。
4. 依据数据写入时间选择满足 RPO 的恢复点，记录预计丢失窗口。
5. 优先恢复到隔离项目，执行第 8 节全部验证。
6. 制定差异/重放清单；当前没有统一事件账本时，任何人工合并都要双人复核和保留 SQL。
7. 切换前准备新的 URL/keys、Web 重建、API `.env`、DNS/反代和回退窗口。
8. 切换后监控登录、5xx、RLS、关键表写入、对象读取和用户反馈。
9. 关闭旧环境前保留只读证据副本至事故/合规窗口结束。
10. 完成事故报告：实际 RPO/RTO、丢失数据、恢复证据、改进 owner/截止日。

## 10. 自动化待办

- 建立每日加密 dump、异地上传、checksum 和过期清理任务；
- 建立 Storage 增量复制与可验证 manifest；
- 监控备份年龄、大小异常、对象漏备和季度演练；
- 使用不可变 Git SHA 镜像和前端 artifact，保留最近稳定版本；
- 标准化 Supabase CLI/迁移历史与 staging；
- 为 Auth/Storage/数据库建立经过供应商支持的完整灾难恢复方案；
- 在 points/credits/支付上线前实现不可变事件账本和可重放 webhook；
- 在隐私与数据删除规则中明确活跃数据、备份和日志的删除时限。
