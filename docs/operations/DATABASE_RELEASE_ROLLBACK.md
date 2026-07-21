# 数据库发布、失败处置与恢复

> **本文内容：** 规定 Supabase/PostgreSQL 迁移的编写、CI 重建、生产 dry-run、发布前恢复点、受保护发布、验证和失败处置流程。
> **作用：** 保证数据库失败时阻断应用发布，并为不可逆迁移提供真实可执行的 forward-fix 或隔离恢复路径。
> **何时更新：** 迁移工具、GitHub Actions、Supabase 项目/方案、备份格式、审批人、应用部署拓扑或恢复策略变化时；每次数据库事故后必须更新。

## 1. 当前可执行能力

权威迁移目录是 `supabase/migrations/`，本地 Supabase 基线是 `supabase/config.toml`。`.github/workflows/deploy.yml` 现在按以下顺序执行：

1. 文档检查、TypeScript typecheck、默认测试和全部 workspace 构建；
2. 启动完整本地 Supabase，先停在 0007 建立历史 points 夹具，再应用 0008–0010 验证回填、opening 归零、冲正与发布断言；随后从空库应用全部迁移；
3. 运行 `db lint`，并用本地 Auth/PostgREST/Storage 实际执行双用户 RLS/Storage/points E2E；
4. 若 push 新增了迁移，质量与本地数据库门禁继续执行，但生产数据库和应用发布保持跳过；数据库 owner 必须先在该 `main` commit 上人工发起 `workflow_dispatch` 并选中 `plan_database_migrations`，核对 history/dry-run 后再另起一次执行选中 `apply_database_migrations`；
5. 核对生产 Project Ref，显示远端 migration history 和 `db push --dry-run`；
6. 生成 roles/schema/data/migration-history 加密恢复点并成功上传；
7. 若远端 history 为空，临时只保留 0001–0007 迁移，通过 public schema 零差异和 Storage policy/bucket 核验后才将这 7 个已存在版本标记为 applied；已建立的远端 history 必须是至少包含 0001–0007 的连续本地前缀；
8. 执行 `supabase db push --linked`，再次 dry-run、检查 history 并 lint；
9. 只有手动数据库 job 成功，或本次执行明确没有迁移时，才构建并部署应用。

已有迁移文件被修改、重命名或删除会在 CI 直接失败；修正必须新增向前迁移。迁移文件或数据库发布控制 workflow/脚本发生变化，都会把普通 main push 保持在“只验证、不部署”状态，避免发布工具修复绕过尚未完成的数据库 release。普通 push 永不直接修改生产数据库；`plan_database_migrations` 只读且不部署应用，只有单独选中 `apply_database_migrations` 才创建恢复点并执行数据库发布，两者同时选中会失败。

`scripts/db-push.mjs` 是不维护 migration history 的旧版应急工具，现已：

- 移除默认生产 Project Ref；
- 强制显式设置 `SUPABASE_PROJECT_REF`；
- 强制设置 `ALLOW_LEGACY_DB_PUSH=YES`；
- 不再属于正常发布路径。

## 2. 为什么不自动逆向数据库

PostgreSQL schema/data 迁移通常没有安全通用的逆操作。自动 `DROP`、恢复旧 dump 或 PITR 都可能覆盖迁移之后的新写入，并且数据库、Auth、Storage metadata 和 Storage 文件字节并不是同一恢复面。

因此当前保证是：

- 迁移失败：不部署新应用；保留旧应用，人工判断部分生效状态并 forward-fix；
- 迁移成功而应用失败：自动回退上一 Web/API 不可变 release，数据库保持向后兼容的新 schema；
- 数据被破坏：停止写入，先用加密恢复点恢复到**新的隔离 Supabase 项目**验证，再经审批决定切换或差异合并；
- CI 永不自动把生产数据库恢复到旧快照。

这要求每个迁移遵循 expand → backfill → switch → contract。删除列、缩窄类型或破坏旧应用契约的 contract 必须在独立维护窗口和观察期之后发布。

## 3. 迁移文件约定

命名：

```text
supabase/migrations/<YYYYMMDDHHMMSS>_<short_snake_case_description>.sql
```

每个新迁移必须说明：目的、依赖、锁/耗时、兼容窗口、验证查询、forward-fix 和不可逆点，并满足：

- 不编辑任何已进入共享环境的迁移；
- schema 变更和大数据回填分开；回填必须分批、可重入；
- 新表启用 RLS 并补齐正反策略；
- `SECURITY DEFINER` 固定 `search_path`，撤销 `PUBLIC/anon/authenticated` 的默认 EXECUTE，只授权受控角色或仅供 trigger；
- points/credits/支付等副作用必须有不可变事件和唯一幂等键；
- 外键、删除语义、约束和访问路径索引一起评审；
- 不把 `IF NOT EXISTS` 当作 schema 漂移或可回滚证明。

`CREATE INDEX CONCURRENTLY` 不能放在普通事务块内，必须独立设计、验证执行通道并记录重试行为。

## 4. 首次启用 Supabase CLI migration history

生产曾通过 SQL Editor/Management API 应用过旧文件时，不能直接让 CI 猜测历史，也不能盲目 `--include-all`。当前受保护 apply 通过 `scripts/prepare-production-migration-baseline.sh` 自动执行一次性 baseline，但只接受两类远端状态：history 完全为空，或 history 是至少包含完整 0001–0007 的连续本地前缀。partial baseline、gap、远端未知版本一律停止。首次启用必须在维护窗口完成：

1. 创建生产恢复点，并记录 Git SHA、所有现有迁移 checksum 和生产 Ref；
2. 在 disposable/staging 从空库应用仓库全部迁移并运行 RLS E2E；
3. 对空 history，脚本临时移出 0008 及之后文件，用 `db diff --linked --schema public` 要求生产 public schema 与 0001–0007 **零差异**；由于 CLI schema diff 不可靠比较 Storage bucket，另行 dump 并核对 5 条 Storage policy、`materials` 私有桶和 `community-media` 公开桶；
4. 链接生产并查看差异：

   ```bash
   SUPABASE_ACCESS_TOKEN=... \
   SUPABASE_DB_PASSWORD=... \
   supabase link --project-ref <production-ref>
   supabase migration list --linked
   supabase db push --linked --dry-run
   ```

5. 只有上述检查全通过且加密恢复点 artifact 已成功上传，脚本才将 0001–0007 一次标记 applied；人工故障处置时的单条命令示例为：

   ```bash
   supabase migration repair 20260620000001 --status applied
   ```

6. 再次运行 `migration list` 和 `db push --dry-run`，预期只显示真正尚未发布的新迁移；
7. 保存 baseline 的 history、零差异、Storage 检查、artifact、operator 和 Git SHA 记录；套餐支持 required reviewer 时再要求两人复核。

若 CLI 提示 local/remote history 不一致，停止发布并审计；不要为了让 job 变绿而批量 repair。

## 5. GitHub 环境与 Secrets

仓库必须建立两个 environment：

- `production-database`：只允许 `main`；支持 environment reviewer 的套餐还必须配置至少一名数据库 owner 审批；
- `production`：应用发布审批可按团队风险级别设置。

当前私有仓库套餐不支持 required reviewer。现有 `production-database` 已启用 `main` 分支限制；在套餐升级前，数据库发布不得由普通 push 自动授权，必须由数据库 owner 先运行 plan、复核结果，再人工发起带 `apply_database_migrations=true` 的独立 `workflow_dispatch`，并在发布记录中保存 Ref、Git SHA、迁移列表、dry-run 与复核人。GitHub Environment 的存在不是审批证据。

数据库 environment 需要：

| Secret | 用途 |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | CLI 链接项目；使用专用最小权限发布身份 |
| `SUPABASE_DB_PASSWORD` | 生产数据库连接；禁止输出到日志 |
| `SUPABASE_PROJECT_REF` | 明确目标项目；CI 会与 Web 生产 URL 交叉核对 |
| `VITE_SUPABASE_URL` | 仅用来确认 Ref 与当前 Web 生产项目一致 |
| `DB_BACKUP_ENCRYPTION_KEY` | AES-256/PBKDF2 加密发布恢复点；必须离线另存恢复副本 |

应用 environment 的 SSH/Web secrets 见[环境变量矩阵](../guides/ENVIRONMENT_VARIABLES.md)。Actions 中只保留加密的数据库 artifact 14 天；artifact 权限不替代密码学加密，也不替代异地长期备份。

## 6. 发布前门禁

- [ ] 新迁移文件名晚于仓库现有版本，旧文件无变化。
- [ ] 老应用在新 schema 上仍能读写；contract 不在本次执行。
- [ ] RLS、Storage policy、function EXECUTE、trigger 幂等有双用户测试。
- [x] 0008/0009 首次生产发布审计：2026-07-21 只读聚合确认 1 个 Profile，points=11、credits=0、streak=0、无 VIP；owner 决定 points 归零，0009 以 append-only reversal 实施，credits/VIP/streak 不改。
- [ ] 估算表规模、锁、statement timeout 和 backfill 时间。
- [ ] [ERD](../guides/ERD.md)、[API](../guides/API.md)及产品规则已同步。
- [ ] `production-database` owner 核对 Ref、Git SHA、迁移列表和 dry-run；若套餐无 reviewer 门禁，另存可审计的人工复核记录。
- [ ] 加密 artifact 上传成功；解密 key 在 Actions 之外可取回。
- [ ] Storage 文件变更另有对象备份；数据库 dump 不含文件字节。
- [ ] 准备应用 feature flag/降级、验证 SQL 和 forward-fix 草案。

## 7. 本地与 staging 验证

本地和 CI 使用同一基线：

```bash
supabase start
# 先按测试指南执行 0007→0010 seed / migration up / assert
supabase db reset --local --no-seed
supabase db lint --local --schema public --level error --fail-on error
```

取得 `supabase status -o env` 的本地 `API_URL`、`ANON_KEY` 和 `SERVICE_ROLE_KEY` 后，按 CI 方式运行升级夹具与 `pnpm test:rls`。完整命令见[测试指南](../guides/TESTING.md)。完成后：

```bash
supabase stop --no-backup
```

除空库重建外，还必须在含近似生产规模数据的 staging 演练锁、耗时、回填、旧应用兼容和失败重试。

### 7.1 0008 首次生产发布的历史值门禁

0001–0007 曾允许 owner 改写 Profile 的 points、credits、level、VIP 和 streak；仓库没有逐笔旧账，0008 无法自动区分合法值与伪造值。首次生产应用 0008–0010 前必须：

1. 在变更窗口冻结相关写入，保存加密恢复点，并导出 `id,points,credits,level,level_name,vip_until,streak,streak_date,updated_at` 到受限审计位置；
2. 用可用的产品规则、发布时间、访问/安全日志和异常分布审查非零余额、未来 VIP、极端 streak/level；不要把原始用户数据贴入 PR/Actions 日志；
3. 对每类无法证明来源的值作出“保留、归零、限制权益或通知用户”的书面产品/安全决定；若需改值，使用独立、评审过、可记录影响行数的维护 SQL/前向迁移，并在 0008 创建 opening 前完成；
4. 保存审批人、时间、聚合结果、修正脚本 checksum、影响行数与复核查询。无法完成时不得批准 `production-database` environment。

本次生产审计与决定记录：2026-07-21，1 个 Profile；points=11、credits=0、streak=0、无 VIP。owner 决定旧 points 全部归零。0008 仍保留 `legacy_opening=11` 的审计事实，0009 追加 `legacy_opening_reset=-11` 并重建 Profile 投影；不删除或改写 opening。credits/VIP/streak 被锁写但仍没有商业事实账本。后续纠错必须设计显式调整事件/审批流程，不能重新开放 Profile 客户端写权限。

## 8. 生产发布与验证

正常操作是合并只新增迁移的 PR 并由 `deploy.yml` 执行。不要同时在 SQL Editor 手工执行。数据库 job 应留下：

- Git SHA、migration list、dry-run 和实际 push 结果；
- 加密恢复 artifact 名和 checksum 验证结果；
- remote lint 和第二次 dry-run；
- environment 审批记录。

迁移后至少核对：

- 新表/列/约束/索引存在；
- RLS、Storage policies 和 function grants 与预期一致；
- 数据行数、NULL、唯一性、FK orphan 和 backfill 进度；
- trigger 重试不重复积分/通知/计数；
- Supabase Auth/PostgREST/Storage 错误率；
- 应用登录、`/api/me` 和本次变更的最小业务路径。

### 8.1 2026-07-21 安全与积分发布记录

- 发布提交：`271137279aacb42454018d9e1b401ed41f2380b7`；只读 plan：GitHub Actions run `29832166947`；受保护 apply：run `29832551375`。
- apply 前远端 migration history 为空。脚本确认 public schema 与 0001–0007 **No schema changes found**，5 条 Storage policy 及 `materials` 私有/`community-media` 公开 bucket 均匹配后，仅将 0001–0007 标记为 applied。
- 加密恢复点 `db-recovery-271137279aacb42454018d9e1b401ed41f2380b7` 已上传为 artifact `8496067281`，GitHub artifact digest 为 `c13e40ecec4270cc31c1b87bccc0b69ec52107bef60a71ad7d3bc8aacc042ff1`，保留 14 天；manifest 记录发布前 `supabase_migrations` schema 不存在。该逻辑恢复点不含 Storage 对象字节。
- 0008、0009、0010 随后成功应用。0009 保留 `legacy_opening=11` 并追加 `legacy_opening_reset=-11`；0010 强制验证该 opening 恰有一条等额冲正、所有 Profile points/level 投影等于账本，以及 Profile 敏感列和内部 RPC 不可由客户端写/执行。
- 发布后 local/remote history 从 0001 到 0010 全部一致，第二次 dry-run 返回 **Remote database is up to date**，remote public lint 返回 **No schema errors found**。
- 应用 release `271137279aacb42454018d9e1b401ed41f2380b7-29832551375-1` 已激活。流水线和独立公网复核均确认 Web root 正常、`/api/health` 的 `status=ok`、`service=nalanda-api`、`deps.supabase=ok`，`/api/me` 未认证返回 401，Supabase JWKS 可用。

该记录证明本次安全迁移和旧 11 points 冲正已上线；它不等于 Storage bytes 已备份、托管 staging/恢复演练已完成，或 points 已具备每日上限与内容反滥用。

## 9. 失败处置

### 9.1 本地重建、lint 或 RLS E2E 失败

生产数据库和应用均不变。修复新迁移或测试；禁止跳过 job。

### 9.2 dry-run 或发布前备份失败

生产数据库尚未改变，应用不部署。解决 history、连接、dump 或加密问题后重新审批。禁止通过删除备份步骤绕过。

### 9.3 `db push` 中途失败

1. 不自动重跑、不执行猜测的 down SQL；
2. 保存最后成功版本、失败 SQL 和脱敏错误；
3. 用 `migration list` 和只读查询确认实际部分生效状态；
4. 保持旧应用，必要时关闭相关新写入口；
5. 在 staging 重现并新增 forward-fix migration；
6. 只有确认数据已破坏且 forward-fix 不足时，进入隔离恢复流程。

单个迁移通常在事务中执行，但并发索引、外部副作用或多迁移批次不能据此假定整体原子。

### 9.4 数据库成功、应用失败

服务器会使用上一运行容器的镜像 tag 和上一 Web symlink 自动回退，并重新验证旧 API。数据库保持新 schema，所以新迁移必须向后兼容。workflow 失败后仍需人工确认外部站点、旧业务路径和数据库指标。

### 9.5 数据损坏

停止受影响写入，下载对应 `db-recovery-<git-sha>` artifact，在安全终端先验证：

```bash
BACKUP_ARCHIVE=/secure/path/nalanda-db-<sha>.tar.gz.enc \
BACKUP_ENCRYPTION_KEY=... \
bash scripts/restore-db-release.sh verify
```

随后按[备份与恢复](./BACKUP_RECOVERY.md)恢复到新的隔离项目。脚本拒绝源项目 Ref 与目标 Ref 相同，也拒绝已有 public 表/Auth 用户/Storage 对象的目标。验证完成前不得切流量。

## 10. 恢复与切换原则

优先级：保持旧应用 → feature flag/停止新写 → forward-fix → 隔离恢复与差异重放 → 经审批切换。只有已演练、无数据损失、锁可控的 down migration 才允许对生产执行；当前 CI 不提供自动 down。

逻辑恢复点包含 roles、应用 schema、Auth/Storage metadata/业务数据和 migration history，但**不包含 Storage 对象字节**。完整恢复必须同时满足对象 manifest/备份、Auth、邮件/Provider 配置、URL/keys、RLS 和应用验证。恢复点之后的新写入需要审计后重放；不能用旧快照静默覆盖。

## 11. 发布记录最低字段

- PR/ticket、Git SHA、新迁移文件与 checksum；
- 环境、脱敏 Project Ref、operator/reviewer；
- baseline/history 状态、dry-run；
- 恢复 artifact、Storage 恢复点和验证结果；
- 开始/结束时间、每个 migration 状态；
- 数据/RLS/API/E2E 验证；
- application rollback、forward-fix、恢复或事故链接。

记录中不得包含 access token、数据库密码、service-role key、备份加密 key 或用户 token。
