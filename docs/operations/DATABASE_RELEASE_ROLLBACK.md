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
9. 只有手动数据库 job 成功，或本次执行明确没有迁移时，才构建应用。上传前生产主机定向清理同 SHA/过期 incoming 与未被容器或当前 `.deploy.env` 引用的 Nalanda image，并要求至少 6 GiB 可用空间；不满足时保持当前应用不动。
10. 生产主机以自身 mode-600 `.env` 先运行真实 Azure 基础 TTS/评分 gate 与真实 OpenRouter structured semantic gate，再在待激活 API 上验证持久队列、private Storage、跨用户重复词复用、未经 VAD/静音裁剪的 WAV 原字节评分和翻译评判幂等。0037 起还必须以 Azure 合成“苹果”中文 WAV 调用真实 Fish Audio STT，验证 owner/revision/word 绑定和中文 transcript 后才激活 Web release。
11. 任一激活门禁失败时，EXIT trap 清除失败候选制品；上一 API 使用上一 `.deploy.env`/compose 的不可变镜像以 `--no-deps` 恢复并独立验证，不能因可选 AI unhealthy 把应用回滚扩大为公网 502。

生产 0039–0040 进一步要求：用独立 secret 启动无宿主机端口的 Redis，验证认证 PING、AOF `everysec`、`noeviction` 和 private network；API readiness 必须同时返回 `deps.supabase=ok`、`deps.redis=ok`，并验证标准限流 headers 与未认证 points admin 401。Redis/nginx 可在应用回退后继续运行；它们不能代替数据库恢复点或 provider gates。

0037–0038 的历史发布 plan 只出现 `20260804000037_learning_translation_voice_input.sql` 与 `20260804000038_verify_learning_translation_voice_input.sql`。恢复点之后 apply 扩展 `learning_speech_usage.kind` 并增加 service-role-only reservation RPC；应用回滚仍可忽略新增 kind/RPC，数据库只 forward-fix。发布已确认普通 `authenticated` 不能执行 RPC/读取 usage、待激活 API 的 STT 真实 gate 通过且公网 health `deps.supabase=ok`；后续发布仍不得把本地 fake Playwright 当真实供应商证据。

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

应用 environment 的 SSH/Web secrets 见[环境变量矩阵](../guides/ENVIRONMENT_VARIABLES.md)。0039 第一阶段还必须有彼此独立的 64 位 hex `REDIS_PASSWORD` 和 `RATE_LIMIT_HMAC_SECRET`；workflow 只通过 SSH 标准输入安装，前者只进入服务器 `.redis.env`/API Redis URL，后者只进入 API `.env`。Actions 中只保留加密的数据库 artifact 14 天；artifact 权限不替代密码学加密，也不替代异地长期备份。

## 6. 发布前门禁

- [ ] 新迁移文件名晚于仓库现有版本，旧文件无变化。
- [ ] 老应用在新 schema 上仍能读写；contract 不在本次执行。
- [x] 2026-07-22 Courses 发布：RLS、Storage policy、function EXECUTE、trigger 幂等有双用户测试。
- [x] 0008/0009 首次生产发布审计：2026-07-21 只读聚合确认 1 个 Profile，points=11、credits=0、streak=0、无 VIP；owner 决定 points 归零，0009 以 append-only reversal 实施，credits/VIP/streak 不改。
- [ ] 估算表规模、锁、statement timeout 和 backfill 时间。
- [x] 0039 第一阶段 PR/plan 只包含 0039–0040；Stage B 随后以顺序追加的 0052–0053 把生产 history 推进到 0053，原预留 0044–0045 没有补插历史。
- [x] Redis/HMAC secrets 已安装；compose/nginx config、真实 Redis Lua、PING/AOF/no-port、429 JSON/headers 与 fail-open/closed 已验证。
- [x] 0039 应用于 `2026-08-10T09:35:34Z` 激活；24 小时观察截止不早于 `2026-08-11T09:35:34Z`，contract go/no-go 已于 2026-08-22 完成。
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

0015–0016 还必须核对：生产 plan 只列这两个新增文件；旧五参数 attempt RPC 在数据库先行后仍可用且会推进 revision；七参数 attempt 的重复 UUID 只记一次、并发旧 revision 返回 409；`learning_audio_assets` 对客户端无表/RPC 权限；全局 queue lease 同时只发一个 Azure 请求；Storage 对象缺失可重建、网络错误不伪装 miss；应用回退到旧 release 仍能运行。当前应用 gate 必须用 Japan East 真实账号证明首个词生成、Storage 命中、另一用户相同词不增加 attempt_count、未经 VAD/静音裁剪的固定 WAV 评分与最终 `deps.supabase=ok`。

### 0039–0040 Stage A、后续 Materials AI 与 0052–0053 撤权门禁

兼容应用必须继续适配 0039–0040；0041–0043 已作为独立 additive Materials AI 发布，但不改变时间列 grant：

1. Stage A 已通过 0007→0040、空库、lint、精确 column/table/function grants、双用户 RLS、真实 Redis Lua、nginx/compose、jsdom/Playwright/build；fake provider 没有被描述为真实 Azure/OpenRouter/Fish 证据。
2. 独立 plan 已证明生产原先停在 0038且唯一待办为 0039–0040。创建恢复点后 apply，并检查 posts/Feedback/Schedule trigger、历史 claim grandfather、ledger/Profile projection 和客户端/service-role 负向权限；grandfather 实际金额必须能由该 business key 的 transition 1 正向分录证明，0008/0009 零金额占位不得因删除、restore 或审核产生负分。若数据中已有这类占位负 transition，0039 只以 `grandfather-zero-reset-v1` append-only 补偿，不能删除历史分录。
3. Stage A 已先安装 Redis/HMAC，再启动 Redis，并确认 password PING、AOF、noeviction、持久 volume、无 host port；nginx rate zones 通过 `nginx -t`，429 使用标准 JSON/headers。
4. 候选 API 已验证 `deps.supabase=ok/deps.redis=ok`、匿名 `/api/me` 与 points admin 401、注册限流 headers、Redis 分级 fail-open/closed，并通过既有三类真实供应商 gates 后原子切换 Web/API。
5. 当前从 `2026-08-10T09:35:34Z` 起观察至少 24 小时：Redis error/restart/AOF/memory、`rate_limit_degraded`、合法请求误 429/503、cap claim/ledger/Profile 差异、signal 只待审，以及任何旧客户端仍提交 `posts.updated_at`/`study_tasks.done_at` 的证据。任一异常均 no-go，应用恢复上一兼容 release，数据库/Redis/nginx保持并 forward-fix。

2026-08-22 go/no-go 记录：兼容期已超过 24 小时；部署 release `3c095a55ced21cee11a1b3131dd2889ec1f70733` 与最新 main 的 Community/Schedule 均不提交两个时间字段；生产 Redis PING/AOF/noeviction 正常、`evicted_keys=0`、`total_error_replies=0`；脱敏数据库汇总显示 2 个 Profile、2 条 ledger entry 且 projection 差异为 0，没有 signal 或 API abuse bucket。样本量很小，不把“无命中”写成反滥用效果证明，但足以和代码审计共同关闭旧客户端 contract 门禁。

最终撤权已在新的 PR 中按严格追加顺序实现，并将生产数据库应用到 0053：0052 只撤销 authenticated 对 `posts.updated_at`、`study_tasks.done_at` 的 UPDATE 列权限；0053 断言最终精确 grant、合法内容/Schedule 写入、service-role 与时间 trigger。0044–0045 保持历史空号，没有使用 `--include-all` 补插已经越过 0051 的生产 history。独立 plan、恢复点、apply、RLS/权限和公网 smoke 证据见 8.14。

#### 0041–0043 Materials AI 专项顺序

1. plan 必须只列生产尚未应用的 0041–0043；0043 逐表/RLS/grant/RPC/FK 断言必须在空库与 0007 升级两条路径通过。
2. 恢复点成功上传并离线保存后才能 apply；检查 Free plan 回填数量等于 Auth 用户数、`reserved+consumed<=limit`、单用户 active job 唯一和所有 AI RPC 无 authenticated EXECUTE。
3. 部署不可变 API/AI/Web image，安装隔离 `.ai.env`，保持 `FEATURE_MATERIAL_AI=false`。验证 Redis password/AOF/noeviction/私网、FastAPI OpenRouter/LibreOffice/temp disk/internal auth 与 API `/api/health/ai`。
4. 运行近上限 Office canary及固定真实 DeepSeek/MiMo suite；任一 ZDR、schema、引用、注入/安全教材、费用、OOM、swap 或邻站门失败，都调用应用 rollback 并保持 flag false。
5. gate 通过后才原子开启 flag、重建 API，并用公网真实登录临时用户完成 upload→job progress→Notes→exam→主观评分→删除；确认 quota、provider usage、临时目录和测试用户/对象清理。
6. 数据库失败只 forward-fix。应用回退不会删除 0041–0043 表；旧应用忽略新增表，rollback 显式关闭 flag。不得回滚到会把 job/额度重放成二次消费的构建。

2026-08-11 实际记录：只读 plan `31465816321` 确认生产已到 0043且 dry-run 为空；受保护 run `31467153739` 仍先创建 artifact `9092230348`，再验证 history/lint/空 dry-run。220 页 canary、真实 DeepSeek/MiMo、两次临时目录清理和登录用户生成/评分/删除均通过后，release `e6ce0cb246d9fc1ecc1c4869b6e63d09d3256bd4-31467153739-1` 才启用 flag。此前 `31463661987` 的绿色状态因 SSH heredoc stdin 被 `compose exec` 消耗而未真正切流，独立服务器/公网核验识别出假绿；当前 workflow 用显式 `</dev/null` helper 和回归测试防止复发。

#### 0046–0051 可恢复任务、知识图谱、生命周期与 Luna 候选顺序

本节是尚未发布候选的门禁，不是生产记录：

1. 该历史发布的独立 plan 必须证明远端仍停在 0043，唯一待应用迁移为 0046–0051；当时的 0044–0045 空号不是漂移。Stage B 后续改用 0052–0053，不改写这段既有发布历史。0048 与 0051 必须在 0007→latest 和空库两条路径断言表、constraint、RLS、trigger、精确 RPC signature/grant。
2. 恢复点成功上传并完成解密/SHA 校验后才 apply。应用后核对旧 0041–0043 同步 worker RPC 仍存在，新应用可用 202 回调协议，上一不可变应用 release 仍可忽略新增表运行。
3. 先保持 `FEATURE_MATERIAL_AI=false` 启动候选 API/AI；验证 explicit Undici transport timeout、内部 callback token、数据库 checkpoint、worker 本地 checkpoint/usage spool、TTL sweep 和 terminal cleanup。不得通过把所有错误统一延长到 20 分钟来掩盖不可达、响应头 timeout 或无 callback。
4. 人工注入 API callback 断线：provider 已返回后终止 callback，确认同一 job/新 lease 从 `artifact_ready` 或 `answer_ready` 恢复、不再次调用 provider、event UUID 只写一条费用记录，完成后 DB/local checkpoint 均清除。再验证超过 TTL 的 Resume 返回稳定终态、释放 reservation 且不复活旧产物。
5. 真实 DeepSeek/MiMo gate 分开验证旧流水线试卷与知识图谱；Luna 子开关保持 false，先读取 OpenRouter 官方 ZDR catalog。若没有 Luna + first-party OpenAI endpoint，则记录 `OPENROUTER_ZDR_UNAVAILABLE`、继续保持 Luna false，并只允许已经通过的 DocumentIR 发布；不得关闭 ZDR、改用 Azure 或静默降级。只有 catalog 合规后，才逐格式用无个人数据原文件证明实际 upstream 为 OpenAI、PDF `file-parser.native`、inline 原始 SHA-256 未转换、严格 schema、注入拒绝、取消后无残留。未过门禁格式不得加入 `MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS`。
6. 验证任务生命周期：queued 删除释放 reservation；worker accepted 后 Delete/旧 Cancel 都消费一次；Clear 只删除 terminal；deleting 在 task、HTTPX/Office、checkpoint、spool 与 0700 目录全部 purge 前持续可见。usage ledger 在硬删 job 后仍存在且路由违规也计成本。
7. 最后先开启 `FEATURE_MATERIAL_AI`，再仅对私有 gate 用户开启/验证 Luna，完成双 pipeline 的 exam/knowledge graph、250 节点桌面与移动图、布局保存、node Q&A、整卷交卷后统一批改、delete/clear 和同 job Resume。全部通过后才把 `FEATURE_MATERIAL_AI_LUNA=true` 设为默认，并独立核对公网 Web、health、401、release/image/Web symlink。
8. 数据库仍只 forward-fix。应用异常先关闭 `FEATURE_MATERIAL_AI_LUNA`，必要时再关闭总开关并恢复上一不可变 release；0046–0051 表保留。不得 drop checkpoint/layout/usage rows，也不得手工修改额度或任务状态来“回滚”。

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

### 8.6 2026-07-28 Courses 0019–0020 发布记录

- PR #26–#29 完成功能与生产 gate 前向修复；最终发布提交为 `a4c230e1aa6f29abbd4fbe944a1b76c625107003`。PR/main CI 覆盖 quality、0007→0020、空库重建/database lint、真实本地双用户 RLS/Storage E2E 和 Chromium Playwright；浏览器供应商为 fake。
- [只读 plan run `30366334157`](https://github.com/1590703336/Nalanda/actions/runs/30366334157) 显示生产 0001–0018 与本地一致，唯一待办是 `20260728000019_learning_spelling_timer_translation.sql` 和 `20260728000020_verify_learning_spelling_release.sql`；没有创建恢复点、写入数据库或部署应用。
- [受保护 run `30367263486`](https://github.com/1590703336/Nalanda/actions/runs/30367263486) 在 apply 前创建并保留加密恢复点 `db-recovery-7c8b516ec4fc9086a6bae816966cb7f688c19746`，artifact `8691620673`、大小 318,626 bytes；apply 后远端 history 到 0020，lint 与 dry-run 通过。0019 保留旧签名供应用回退；数据库只 forward-fix。
- 同一 run 的首个候选、随后 runs `30370419397` 和 `30372651419` 分别被真实 provider 契约、模型误判完全匹配合成答案和 replay 映射 gate 拦截，均自动恢复上一 Web/API，未逆向数据库。最终 main run `30374301472` 的一次真实 OpenRouter 12 秒超时也未激活候选，之后只重跑失败部署 job。
- 最终真实 Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；真实 OpenRouter 返回 1,365 ms、253/27/280 tokens；候选 API 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`，并查询评判事实确认 provider/model 为 `nalanda-normalized-exact/normalized-exact-v1`、0 token、同 UUID replay true、revision 1。
- 不可变 release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3` 健康激活。独立公网复核确认 `/api/health` 的 `deps.supabase=ok`、匿名 `/api/me=401` 和 React root；生产 migration history 保持 0020。

### 8.7 2026-07-31 Courses 0021–0022 发布记录

- 发布提交：`fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad`；PR #35 run `30615023445`、main run `30615555388` 和受保护 run `30616540480` 通过 quality、0007→0022、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright。真实数据库用例验证全角/半角全大写均不增加错误或候补；Playwright 的外部供应商仍为 fake。
- [只读 plan run `30616030488`](https://github.com/1590703336/Nalanda/actions/runs/30616030488) 显示生产 0001–0020 与本地一致，唯一待办为 0021–0022；恢复、apply 与 deploy 步骤全部跳过。
- [受保护 apply/deploy run `30616540480`](https://github.com/1590703336/Nalanda/actions/runs/30616540480) 在 apply 前创建并保留 `db-recovery-fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad`，artifact `8787805291`、大小 362,385 bytes、digest `sha256:fd553ea9c4898d72928db64bcbd979e13dff50f6b50a2138ec7113958709c199`，保留至 2026-08-14。
- apply 后远端 history 到 0022，0022 函数结果/权限断言、remote database lint 和空 dry-run 均通过。0021 保留旧五参数答题签名及 HTTP 契约供应用回退；数据库仍只采用 forward-fix。
- 激活前真实 Japan East Azure、真实 OpenRouter 和候选 Courses API/Storage gate 均通过。不可变 release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` 健康激活；独立公网复核确认 `/api/health` 的 `deps.supabase=ok`、匿名 `/api/me=401` 和 React root。未使用真实用户会话在生产提交答案，因此不能把本次记录描述为生产用户流程 E2E。

### 8.8 2026-07-31 Courses 0023–0024 发布记录

- 发布提交：`9b62951a8895aa6cf3ff0f9dce8395df239e6089`；PR #37 run `30620350644`、main run `30620879282` 和受保护 run `30624104943` 通过 quality、0007→0024、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright。真实数据库用例验证仅标点差异不增加错误或候补；Playwright 的外部供应商仍为 fake。
- [只读 plan run `30623522232`](https://github.com/1590703336/Nalanda/actions/runs/30623522232) 显示生产 0001–0022 与本地一致，唯一待办为 0023–0024；恢复、apply 与 deploy 步骤全部跳过。
- [受保护 apply/deploy run `30624104943`](https://github.com/1590703336/Nalanda/actions/runs/30624104943) 在 apply 前创建并保留 `db-recovery-9b62951a8895aa6cf3ff0f9dce8395df239e6089`，artifact `8790816378`、大小 366,417 bytes、digest `sha256:887b1ac42c267ca7bb1cde810920702dde64f8d74112b3b39def6254d5bf0fca`，保留至 2026-08-14。
- apply 后远端 history 到 0024，0024 结果/函数定义/权限断言、remote database lint 和空 dry-run 均通过。0023 保留旧五参数答题签名及 HTTP 契约供应用回退；数据库仍只采用 forward-fix。
- 激活前真实 Japan East Azure、真实 OpenRouter 和候选 Courses API/Storage gate 均通过。不可变 release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1` 健康激活；独立公网复核确认 `/api/health` 的 `deps.supabase=ok`、匿名 `/api/me=401` 和 React root。未使用真实用户会话在生产提交答案，因此不能把本次记录描述为生产用户流程 E2E。

### 8.9 2026-08-01 Courses 0025–0028 发布记录

- 发布提交：`93354a56044470fb5d2b1fd6aeabcf82f459bb52`；PR #40 run `30705662543`、main run `30705946921` 和受保护 run `30706731292` 通过 quality、0007→0028、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright。浏览器外部供应商仍为 fake。
- [只读 plan run `30706279006`](https://github.com/1590703336/Nalanda/actions/runs/30706279006) 显示生产 0001–0024 与本地一致，唯一待办为 `20260801000025_learning_session_cancel.sql`、`20260801000026_verify_learning_session_cancel.sql`、`20260801000027_learning_exam_retry_quota.sql` 和 `20260801000028_verify_learning_exam_retry_quota.sql`；恢复、apply 与 deploy 步骤全部跳过。
- [受保护 apply/deploy run `30706731292`](https://github.com/1590703336/Nalanda/actions/runs/30706731292) 在 apply 前创建并保留 `db-recovery-93354a56044470fb5d2b1fd6aeabcf82f459bb52`，artifact `8820657507`、约 418 KB、digest `sha256:02ea6fef5481756b17f79fbbd82c023d9c9ba085accfc1e28f9a268d24645ad9`，保留 14 天。
- apply 后远端 history 到 0028，0026/0028 的结构、函数定义和 service-role-only 权限断言、remote database lint 与空 dry-run 均通过。0025–0028 向后兼容已发布应用；数据库仍只采用 forward-fix，不执行 down migration。
- 激活前真实 Japan East Azure、真实 OpenRouter 和候选 Courses API/Storage gate 均通过。不可变 release `93354a56044470fb5d2b1fd6aeabcf82f459bb52-30706731292-1` 健康激活；独立公网复核确认 `/api/health` 的 `deps.supabase=ok`、匿名 `/api/me=401` 和 React root。认证 UI 检查只打开考试配置而未提交答案，不能据此声称真实生产考试 E2E。

### 8.10 2026-08-03 Courses 0029–0034 发布记录

- 发布提交：`1a58d2164f6d58feea4d3a2c8925211b8cc60dde`；PR [#45](https://github.com/1590703336/Nalanda/pull/45) run `30811283164`、main run `30811817461` 和受保护 run `30813047562` 通过 quality、0007→0034、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright。真实数据库用例验证复习与单项考试均不 learned，只有拼写/发音考试事实都存在时才 learned；Playwright 的外部供应商仍为 fake。
- [只读 plan run `30812467085`](https://github.com/1590703336/Nalanda/actions/runs/30812467085) 显示生产 0001–0028 与本地一致，唯一待办为 `20260803000029_learning_pronunciation_exam.sql` 至 `20260803000034_verify_learning_exam_only_mastery.sql`；恢复、apply 与 deploy 步骤全部跳过。
- [受保护 apply/deploy run `30813047562`](https://github.com/1590703336/Nalanda/actions/runs/30813047562) 在 apply 前创建并保留 `db-recovery-1a58d2164f6d58feea4d3a2c8925211b8cc60dde`，artifact `8855819351`、593,399 bytes、digest `sha256:5f36f770aab133f24e12d461e66b0c4b744303ca1dbfd1600215163e4ad14796`，保留 14 天。
- apply 后远端 history 到 0034，0030/0032/0034 的字段、约束、函数定义和 service-role-only 权限断言、remote database lint 与空 dry-run 均通过。0029–0034 保留必要旧签名供应用回退；数据库仍只采用 forward-fix，不执行 down migration。
- 激活前真实 Japan East Azure、真实 OpenRouter 和 Courses API/Storage gate 均通过。不可变 release `1a58d2164f6d58feea4d3a2c8925211b8cc60dde-30813047562-1` 健康激活；独立公网复核确认 `/api/health` 的 `deps.supabase=ok`、匿名 `/api/me=401`、React root 和 Course Market 200。未使用真实用户会话在生产提交完整拼写/读音考试，不能据此声称生产用户考试流程 E2E。

### 8.11 2026-08-04 Courses 0035–0036 发布记录

- 发布提交：`51252527645d9438df0414f056c8a3b088b360d8`；PR [#47](https://github.com/1590703336/Nalanda/pull/47) run `30831319634`、main run `30831964846` 和受保护 run `30833228406` 通过 quality、0007→0036、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright。真实数据库用例验证手工赋值、复习和单项考试都不能绕过精确投影；Playwright 的外部供应商仍为 fake。
- [只读 plan run `30832581552`](https://github.com/1590703336/Nalanda/actions/runs/30832581552) 显示生产 0001–0034 与本地一致，唯一待办为 `20260803000035_learning_mastery_projection_guard.sql` 和 `20260803000036_verify_learning_mastery_projection_guard.sql`；恢复、apply 与 deploy 步骤全部跳过。
- [受保护 apply/deploy run `30833228406`](https://github.com/1590703336/Nalanda/actions/runs/30833228406) 在 apply 前创建并保留 `db-recovery-51252527645d9438df0414f056c8a3b088b360d8`，artifact `8864033351`、657,467 bytes、digest `sha256:36a9ec08516dff5cb198511d71b69bb63533727cad9826db050dff4a33025625`，保留至 2026-08-17。
- apply 后远端 history 到 0036，0036 的当前数据、约束、trigger、考试/review 写入路径、客户端 progress 权限与 service-role helper 断言、remote database lint 和空 dry-run 均通过。数据库仍只采用 forward-fix，不执行 down migration。
- 激活前真实 Japan East Azure、真实 OpenRouter 和 Courses API/Storage gate 均通过；后者验证未裁剪 WAV `assessmentBytes=88444`。不可变 release `51252527645d9438df0414f056c8a3b088b360d8-30833228406-1` 健康激活；独立公网复核确认 `/api/health` 的 `deps.supabase=ok`、匿名 `/api/me=401`、新 React 资产和 Course Market 200。未使用真实用户会话在生产提交完整拼写/读音考试，不能据此声称生产用户考试流程 E2E。

### 8.12 2026-08-04 Courses 0037–0038 发布记录

- 发布提交：`66c919833693971ba1bda4ea33a3fdf6717ef1ca`；PR [#49](https://github.com/1590703336/Nalanda/pull/49) run `30904901828` 通过 quality、0007→0038、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright。Playwright 的 Azure/OpenRouter/Fish Audio 仍为 fake。
- [只读 plan run `30906629924`](https://github.com/1590703336/Nalanda/actions/runs/30906629924) 首次在一次性 Supabase 的首个课程 RPC 收到瞬时上游错误；同 SHA 仅重跑失败 job 后真实 RLS/Storage 和依赖 plan 均通过。最终远端 0001–0036 与本地一致，dry-run 唯一列出 0037–0038；恢复、apply 与 deploy 步骤全部跳过。
- [受保护 apply/deploy run `30907716733`](https://github.com/1590703336/Nalanda/actions/runs/30907716733) 在 apply 前创建并保留 `db-recovery-66c919833693971ba1bda4ea33a3fdf6717ef1ca`，artifact `8892006761`、730,159 bytes。apply 后远端 history 到 0038，结构/权限断言、remote database lint 与空 dry-run 均通过；数据库仍只采用 forward-fix。
- 激活前真实 Japan East Azure、真实 OpenRouter structured、Courses API/Storage 和 Azure 中文 WAV→Fish Audio gate 均通过；STT gate 返回 `transcriptionMatched=true`。不可变 release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1` 健康激活。独立公网复核确认 `/api/health` 的 `deps.supabase=ok`、匿名 `/api/me=401` 和新 React 资产；生产主机只读复核确认 `/opt/nalanda/web` 与 API image 均指向同一 SHA。合成中文 WAV 只证明固定样本和当时供应商可用，不是物理麦克风或多口音 E2E。

### 8.13 2026-08-10 安全/限流 0039–0040 Stage A 发布记录

- 发布代码：PR [#51](https://github.com/1590703336/Nalanda/pull/51)，main merge `eb3c5a909a523f59d748a6ce01d4bd4f3abf909d`；部署 stdin 修复：PR [#52](https://github.com/1590703336/Nalanda/pull/52)，main merge `56100e6bc2a4c70aa289aaad4b43efa1267428bd`。对应 PR/main jobs 均通过 quality、真实 Redis、0007→0040、空库/lint、双用户 RLS/Storage 和 Chromium Playwright。
- [plan run `31368447660`](https://github.com/1590703336/Nalanda/actions/runs/31368447660) 唯一列出 0039–0040。[apply run `31369657292`](https://github.com/1590703336/Nalanda/actions/runs/31369657292) 在写库前保留加密恢复 artifact `9055783205`（777,902 bytes，digest `6c06bc011b3d0dc436b9722b66206e6f7a12bd2ecf083f2266cbb6b529c4112f`），随后远端 history 到 0040，0040 结构/权限断言、lint 和空 dry-run 通过。
- 该 apply run 的 Redis `docker compose exec` 未分离 stdin，消耗了剩余 SSH heredoc；job 错误标绿但未运行供应商、API 或公网激活步骤。独立公网 health 显示旧 API `deps.redis=unset`，因此没有把该 run 计作应用发布。PR #52 增加 `</dev/null`、明确成功标记和 workflow 回归测试，main CI `31371608883` 通过后才继续。
- 修复后的 [plan run `31372198037`](https://github.com/1590703336/Nalanda/actions/runs/31372198037) 确认本地/远端均到 0040且无待办。[最终 protected run `31372888441`](https://github.com/1590703336/Nalanda/actions/runs/31372888441) 再保留 artifact `9057062920`（800,819 bytes，zip digest `81820da75dc4f0591ffd6f73ba3ac175a5b04f6995af8f8c508f60e56379a2f4`），并再次验证 history/lint/空 dry-run。
- 应用切流前依次通过 Redis password PING、AOF、noeviction、无 host port，nginx `-t`，真实 Japan East Azure（10,656-byte MP3、accuracy 98、pronunciation 98.8），真实 OpenRouter Gemma（5,524 ms、253/27/280 tokens）和 Courses API/Storage/Fish gate（`generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=98.2`、`assessmentBytes=88444`、`transcriptionMatched=true`）。一次 OpenRouter 12 秒超时与三次 free-route 429 均在切流前阻断；同凭据额度状态正常且本机/生产主机相同请求恢复 HTTP 200 后才成功，未切换模型或绕过真实 gate。
- 不可变 release `56100e6bc2a4c70aa289aaad4b43efa1267428bd-31372888441-5` 于 `2026-08-10T09:35:34Z` 健康激活。公网复核：health `deps.supabase=ok/deps.redis=ok`，匿名 `/api/me` 与 `/api/admin/points/abuse-signals` 为 401，空注册为 400 且带 `RateLimit-Limit: 5`，Web/Course Market 为 200；主机 Web 软链和 API image 指向同一 release，Redis healthy 且只暴露容器内 `6379/tcp`。
- Stage B 观察最早截止为 `2026-08-11T09:35:34Z`，实际 go/no-go 于 2026-08-22 完成。0052–0053 随后在完整 CI、只读 plan 精确列出两个文件且恢复点上传成功后 apply；生产 history、空 dry-run 与 lint 已验证到 0053。

### 8.14 2026-08-22 安全 Stage B 0052–0053 发布记录

- PR [#72](https://github.com/1590703336/Nalanda/pull/72) 合并为 `4d1bc97888799417641fefdd507c026b274a2bab`。PR run `32579985463` 和 main run `32580594918` 均通过 quality、真实 CI Redis、0007→0053、空库/lint、双用户 RLS/Storage、Chromium Playwright与生产镜像启动；main push 因 migration 变化正确保持数据库/应用跳过。
- [plan run `32581192318`](https://github.com/1590703336/Nalanda/actions/runs/32581192318) 只读确认远端到 0051，唯一待办为 0052–0053。[protected run `32581805613`](https://github.com/1590703336/Nalanda/actions/runs/32581805613) 在写库前上传 artifact [`9478168126`](https://github.com/1590703336/Nalanda/actions/runs/32581805613/artifacts/9478168126)：885,857 bytes、digest `0e4425b7098b4b352b5a7f6e81e87861d9c98b535970f9f20592641653a41274`、14 天保留；数据库 dump 不包含 Storage object bytes。
- apply 仅执行 `20260822000052_security_integrity_time_column_contract.sql` 与 `20260822000053_verify_security_integrity_time_column_contract.sql`。最终远端 migration list 本地/远端均到 0053，dry-run 返回 `Remote database is up to date`，public schema lint job 成功；0053 的失败关闭断言保证 authenticated 已失去两个派生列 UPDATE、合法业务列与 service-role/trigger 保持。
- 同一 run 的不可变应用 attempt 1/2 均在真实 Materials AI PPTX gate 返回 `AI_EXAM_VALIDATION_FAILED`，分别停在 repair 后引用门和语义门；两次都在公开切流前恢复 `3c095a55ced21cee11a1b3131dd2889ec1f70733`。独立公网 health 为 Supabase/Redis ok、AI worker/queue ok、匿名 me 401，服务器 Web 软链/API/AI image 也指向旧稳定 release。数据库按 forward-fix 保持 0053；应用失败不能回退或伪装数据库 contract，也不能被记录为最新 main 已部署。

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
