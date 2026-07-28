# 数据库发布、失败处置与恢复

> **本文内容：** 规定 Supabase/PostgreSQL 迁移的编写、CI 重建、生产 dry-run、发布前恢复点、受保护发布、验证和失败处置流程。
> **作用：** 保证数据库失败时阻断应用发布，并为不可逆迁移提供真实可执行的 forward-fix 或隔离恢复路径。
> **何时更新：** 迁移工具、GitHub Actions、Supabase 项目/方案、备份格式、审批人、应用部署拓扑或恢复策略变化时；每次数据库事故后必须更新。

## 1. 当前可执行能力

权威迁移目录是 `supabase/migrations/`，本地 Supabase 基线是 `supabase/config.toml`。`.github/workflows/deploy.yml` 现在按以下顺序执行：

1. 文档检查、TypeScript typecheck、默认测试和全部 workspace 构建；
2. 启动完整本地 Supabase，自动暂存全部 0008+ 文件，先停在 0007 建立历史 points 夹具，再应用至最新迁移验证回填、opening 归零、Courses 增量与发布断言；随后从空库应用全部迁移；
3. 运行 `db lint`，执行双用户 RLS/Storage/points/Courses E2E，再以 Azure/OpenRouter fake 启动 Web/API 运行 Playwright Courses 主流程；
4. 若 push 新增了迁移，质量与本地数据库门禁继续执行，但生产数据库和应用发布保持跳过；数据库 owner 必须先在该 `main` commit 上人工发起 `workflow_dispatch` 并选中 `plan_database_migrations`，核对 history/dry-run 后再另起一次执行选中 `apply_database_migrations`；
5. 核对生产 Project Ref，显示远端 migration history 和 `db push --dry-run`；
6. 生成 roles/schema/data/migration-history 加密恢复点并成功上传；
7. 若远端 history 为空，临时只保留 0001–0007 迁移，通过 public schema 零差异和 Storage policy/bucket 核验后才将这 7 个已存在版本标记为 applied；已建立的远端 history 必须是至少包含 0001–0007 的连续本地前缀；
8. 执行 `supabase db push --linked`，再次 dry-run、检查 history 并 lint；
9. 只有手动数据库 job 成功，或本次执行明确没有迁移时，才构建并上传应用；生产主机以自身 mode-600 `.env` 先运行真实 Azure 基础 TTS/评分 gate 与真实 OpenRouter structured semantic gate，再在候选 API 上验证持久队列、private Storage、跨用户重复词复用、裁剪评分以及翻译评判幂等/权威拼写提交，成功后才激活 Web release。

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
- [x] 2026-07-22 Courses 发布：RLS、Storage policy、function EXECUTE、trigger 幂等有双用户测试。
- [x] 0008/0009 首次生产发布审计：2026-07-21 只读聚合确认 1 个 Profile，points=11、credits=0、streak=0、无 VIP；owner 决定 points 归零，0009 以 append-only reversal 实施，credits/VIP/streak 不改。
- [ ] 估算表规模、锁、statement timeout 和 backfill 时间。
- [x] 2026-07-22 Courses 发布：[ERD](../guides/ERD.md)、[API](../guides/API.md)及产品规则已同步。
- [x] 2026-07-22 Courses 发布：owner 核对 Ref、Git SHA、0001–0013 history 和只读 dry-run；人工 plan/apply 分开执行。
- [x] 2026-07-22 Courses 发布：新的加密恢复点创建、验证并保留；解密 key 仍由 Actions 外受控保管。
- [ ] Storage 文件变更另有对象备份；数据库 dump 不含文件字节。
- [x] 2026-07-22 Courses 发布：应用 flags/降级、验证 SQL、上一 release 回退和数据库 forward-fix 边界已准备并经过 workflow。
- [x] Courses 发布：确认 0011–0013 的 15 张新表、`profiles.timezone`、`vocabulary-audio` bucket、全部 service-only RPC 和九个 badge 定义；remote history 已到 0013。
- [x] Courses 大词表入口：生产 nginx `/api/ client_max_body_size 10m` 已同步并通过 `nginx -t`；Nest JSON 10 MB 与评分 multipart 2 MB 分层不变。
- [x] Azure key/region 只在 API 环境，fake=false；月预算、用户限额、熔断和 Japan East 真实合成/评分 smoke 已确认。

## 7. 本地与 staging 验证

本地和 CI 使用同一基线：

```bash
supabase start
# 先按测试指南执行 0007→latest seed / migration up / assert
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

Courses 0011–0013 还必须核对：owner 读/客户端写拒绝、匿名分享/市场只能经 API、publication 快照更新被拒、四阶段会话恢复、两次不同本地日期熟练、Schedule 不生成 `study_tasks`、同词集合只出现一条 +20 分录、课程删除保留分录/徽章历史，以及 `learning_speech_usage` 不含音频或参考文本。

0015–0016 还必须核对：生产 plan 只列这两个新增文件；旧五参数 attempt RPC 在数据库先行后仍可用且会推进 revision；七参数 attempt 的重复 UUID 只记一次、并发旧 revision 返回 409；`learning_audio_assets` 对客户端无表/RPC 权限；全局 queue lease 同时只发一个 Azure 请求；Storage 对象缺失可重建、网络错误不伪装 miss；应用回退到旧 release 仍能运行。应用 gate 必须用 Japan East 真实账号证明首个词生成、Storage 命中、另一用户相同词不增加 attempt_count、VAD 裁剪评分与最终 `deps.supabase=ok`。

### 8.1 2026-07-21 安全与积分发布记录

- 发布提交：`271137279aacb42454018d9e1b401ed41f2380b7`；只读 plan：GitHub Actions run `29832166947`；受保护 apply：run `29832551375`。
- apply 前远端 migration history 为空。脚本确认 public schema 与 0001–0007 **No schema changes found**，5 条 Storage policy 及 `materials` 私有/`community-media` 公开 bucket 均匹配后，仅将 0001–0007 标记为 applied。
- 加密恢复点 `db-recovery-271137279aacb42454018d9e1b401ed41f2380b7` 已上传为 artifact `8496067281`，GitHub artifact digest 为 `c13e40ecec4270cc31c1b87bccc0b69ec52107bef60a71ad7d3bc8aacc042ff1`，保留 14 天；manifest 记录发布前 `supabase_migrations` schema 不存在。该逻辑恢复点不含 Storage 对象字节。
- 0008、0009、0010 随后成功应用。0009 保留 `legacy_opening=11` 并追加 `legacy_opening_reset=-11`；0010 强制验证该 opening 恰有一条等额冲正、所有 Profile points/level 投影等于账本，以及 Profile 敏感列和内部 RPC 不可由客户端写/执行。
- 发布后 local/remote history 从 0001 到 0010 全部一致，第二次 dry-run 返回 **Remote database is up to date**，remote public lint 返回 **No schema errors found**。
- 应用 release `271137279aacb42454018d9e1b401ed41f2380b7-29832551375-1` 已激活。流水线和独立公网复核均确认 Web root 正常、`/api/health` 的 `status=ok`、`service=nalanda-api`、`deps.supabase=ok`，`/api/me` 未认证返回 401，Supabase JWKS 可用。

该记录证明本次安全迁移和旧 11 points 冲正已上线；它不等于 Storage bytes 已备份、托管 staging/恢复演练已完成，或 points 已具备每日上限与内容反滥用。

### 8.2 2026-07-22 Courses 0011–0013 发布记录

- 发布提交：`53d0eabf767725b6e9ca83367c0e17c47a479eca`。
- [只读 plan run `29889201210`](https://github.com/1590703336/Nalanda/actions/runs/29889201210) 显示 local/remote 0001–0013 逐项一致，最终 dry-run 为 **Remote database is up to date**。
- [受保护 apply/deploy run `29889669272`](https://github.com/1590703336/Nalanda/actions/runs/29889669272) 重新通过生产镜像启动、0007→0013 升级、空库重建、双用户 RLS/Storage/Courses E2E 和 Playwright，随后创建并保留加密恢复点、验证 remote history/functions，并发布不可变应用。
- 生产主机从 mode-600 `.env` 向候选 image 注入 Azure 配置；`japaneast`、`en-US-JennyNeural`、fake=false 的真实 TTS/固定 WAV scripted assessment 成功，accuracy 98、pronunciation 98.8、4 个音素。密钥未进入仓库、Actions Secret 或日志。
- 激活 release 为 `53d0eabf767725b6e9ca83367c0e17c47a479eca-29889669272-1`，API image 为同 SHA；本机和公网 `/api/health` 均要求 `deps.supabase=ok`，未认证 `/api/me` 与私有 Courses 返回 401，公开 Course Market 返回 200。
- Courses、分享、免费市场与发音 flags 已开启；生产 nginx 10 MB 课程 JSON 上限已验证。文件 AI 导入和其他三类课程仍禁用。

后续发布仍沿用相同失败边界：关闭最窄 flag；应用恢复上一 release；数据库不执行 down/drop，只新增 forward-fix。

### 8.3 2026-07-23 Courses 0014 发布记录

- 发布提交：`02ba1b682c104947aa0b80707c143b8e921870f0`。
- [只读 plan run `29939798432`](https://github.com/1590703336/Nalanda/actions/runs/29939798432) 显示远端 0001–0013 与本地一致，唯一待应用迁移为 `20260723000014_learning_feedback_flow.sql`；所有恢复点、apply 和 deploy 步骤均跳过。
- [受保护 apply/deploy run `29940292716`](https://github.com/1590703336/Nalanda/actions/runs/29940292716) 先重复通过 0007→0014、空库重建、database lint、真实 RLS/Storage 与 Courses Playwright，再创建 14 天加密恢复点 artifact `8538123165` 并应用 0014。
- 迁移后 local/remote history 均到 0014，远端 dry-run 与 lint 通过；真实 Azure gate、API Supabase readiness、鉴权守卫和公网 Web/API smoke 通过，release `02ba1b682c104947aa0b80707c143b8e921870f0-29940292716-1` 健康激活。
- 数据库回退继续只允许 forward-fix；应用问题恢复上一不可变 release，语音问题优先关闭 `FEATURE_PRONUNCIATION_ENABLED`。

### 8.4 2026-07-27 Courses 0015–0016 发布记录

- 发布提交：`6b6de0e985ad8b34c977f1bce3ba985b84eb82f2`；PR #21 run `30243998633` 与 main run `30244402278` 通过 quality、0007→0016、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 和 Chromium Playwright。Playwright 使用 Azure fake，只证明浏览器/API/一次性数据库协作。
- [只读 plan run `30244967669`](https://github.com/1590703336/Nalanda/actions/runs/30244967669) 显示远端 0001–0014 与本地一致，dry-run 只列 `20260727000015_learning_performance_offline_audio.sql` 和 `20260727000016_verify_learning_performance_release.sql`；恢复、apply 与 deploy 步骤全部跳过。
- [受保护 apply/deploy run `30245430630`](https://github.com/1590703336/Nalanda/actions/runs/30245430630) 在 apply 前创建并保留加密恢复点 `db-recovery-6b6de0e985ad8b34c977f1bce3ba985b84eb82f2`，artifact `8644999285`，digest `sha256:09c37ba8755b1ffd95bea061fa5da49d961a85f3dd2d2694253cf16c4a6a10a7`，保留至 2026-08-10。
- apply 后 local/remote history 均到 0016，新增结构/函数权限断言、远端 lint 与空 dry-run 通过。数据库继续只允许 forward-fix；旧答题签名暂时保留供应用兼容回退。
- 切流前基础真实 Azure gate 在 `japaneast`/`en-US-JennyNeural` 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8 和 4 个音素。新 API 真实 gate 随后验证 4 个首次生成对象、private Storage 读取、第二用户复用同 4 个对象且不增加 Azure 生成、VAD 裁剪后评分 97；用户录音未落库或进入 Storage。
- 不可变 release `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2-30245430630-1` 健康激活。独立公网复核确认 Web `200`、`/api/health` 为 `status=ok` 且 `deps.supabase=ok`，匿名 `/api/me` 为 `401 UNAUTHENTICATED`。
- `FEATURE_LEARNING_AUDIO_PREWARM_ENABLED` 与默认 20 次/分钟、500,000 字符/月、3.1 秒间隔、synthesis version 1 已在 mode-600 生产 `.env` 启用。若后续队列或供应商异常，先关闭最窄 flag/熔断语音或恢复上一不可变应用 release；0015–0016 schema 不逆向。

### 8.5 2026-07-27 Courses 0017–0018 发布记录

- 发布提交：`99313bd3763ce5bf1f7ffb252f821f7b21a67eec`；PR #24 run `30263277807` 与 main run `30263794368` 通过 quality、0007→0018、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 和 Chromium Playwright。浏览器回归验证历史八词冷单元、前五词 pending 提权/ready 缓存替换，以及暂停首次学习与其他单元复习不会互相劫持；Azure 为 fake。
- [只读 plan run `30264327821`](https://github.com/1590703336/Nalanda/actions/runs/30264327821) 显示远端 0001–0016 与本地一致，dry-run 只列 `20260727000017_learning_session_intent_resume.sql` 和 `20260727000018_verify_learning_audio_review_fix.sql`；恢复、apply 与 deploy 步骤全部跳过。
- [受保护 apply/deploy run `30264979509`](https://github.com/1590703336/Nalanda/actions/runs/30264979509) 在 apply 前创建并保留加密恢复点 `db-recovery-99313bd3763ce5bf1f7ffb252f821f7b21a67eec`，artifact `8652623403`，digest `sha256:22861e8f8ccba2d87fc673f468c75677d6df3a0e9d424111c66dc67d009d5ac3`。
- apply 后 local/remote history 均到 0018，远端 dry-run 为空、database lint 无 error，`learning_start_session` 的客户端执行权和新意图唯一索引断言通过。数据库仍只做 forward-fix；0017 与旧应用兼容，不以 down migration 回退。
- 切流前基础真实 Azure gate 在 `japaneast`/`en-US-JennyNeural` 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；真实队列/Storage/评分 gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`、`trimmedAssessmentBytes=65324`。
- 不可变 release `99313bd3763ce5bf1f7ffb252f821f7b21a67eec-30264979509-1` 健康激活。独立公网与服务器复核确认 Web `200`、`/api/health` 为 `status=ok` 且 `deps.supabase=ok`、匿名 `/api/me` 为 `401`，Web symlink 与 API image 都指向同一 release SHA。

### 8.6 0019–0020 限时拼写与 OpenRouter 翻译前测发布清单（待执行）

- 只读 plan 必须确认生产停在 0018，唯一待办是 `20260728000019_learning_spelling_timer_translation.sql` 与 `20260728000020_verify_learning_spelling_release.sql`；plan run 不得创建恢复点、写数据库或部署应用。
- apply 前保留加密恢复 artifact；升级夹具、空库 lint/reset 和双用户 RLS 必须验证 `spelling_options`、评判表无客户端权限、普通用户不能执行任何新 RPC、同 UUID 只产生一次 attempt、并发 revision 冲突、答案只存 SHA-256 和 Auth 删除级联。
- 0019 保留七参数 `learning_start_session` 与原答题 RPC 供旧应用回退；新应用调用八参数 start 和受保护 spelling wrapper。数据库失败只能 forward-fix，不能 drop 新列/表；应用失败恢复上一不可变 release。
- 部署在候选 image 启动前，通过标准输入把 GitHub `production` environment 的 OpenRouter key 安装到服务器 mode-600 `.env`，强制 `OPENROUTER_FAKE=false`。真实 smoke 用固定合成样本验证同义 true/无关 false；真实 API gate 验证 session 设置、同 UUID replay 和权威 spelling attempt。任一失败保持最窄 feature flag 关闭并不切流。
- 完成后再补实际 commit、PR/main/plan/apply run、恢复 artifact/digest、远端 history、provider metrics、release ID、`deps.supabase=ok` 和匿名 `/api/me=401`。未取得这些证据时本节不得改成“已发布”。

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

若失败只影响 Courses/Azure/分享/市场，优先关闭最窄子 flag；不得为了恢复入口而把客户端表写权限或内部 RPC EXECUTE 重新开放。

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
