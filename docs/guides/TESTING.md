# 可执行测试指南

> **本文内容：** 说明当前测试分层、准确命令、fixture/环境要求、真实 Supabase RLS E2E 的安全护栏、CI 覆盖范围和失败排查方式。  
> **作用：** 让开发者和发布人员能重复运行同一套验证，并准确理解“jsdom 集成测试”“真实 RLS E2E”和“浏览器端到端”的边界。  
> **何时更新：** 测试 runner、脚本、测试文件、fixture、环境变量、CI 门禁、覆盖模块、外部依赖或测试数据清理方式变化时，与测试代码同一提交更新。

## 1. 当前测试能力

| 层 | 当前实现 | 是否访问外部服务 | 权威命令 |
|---|---|---:|---|
| 文档契约 | `scripts/check-docs.mjs` 检查所有 Markdown 开头字段与相对链接 | 否 | `node scripts/check-docs.mjs` |
| TypeScript 静态检查 | Web/API/types 的 `tsc` 任务 | 否 | `pnpm typecheck` |
| 构建 | Turbo 构建 types/API/Web | 否（Web 变量可为空但功能不完整） | `pnpm build` |
| Web jsdom 集成 | Vitest + jsdom + 内存 Supabase mock，覆盖 legacy 壳与主要模块交互 | 否 | `pnpm test` |
| Supabase RLS E2E | Vitest node 环境，两名真实用户访问实际 Auth/PostgREST/Storage（本地栈或托管测试项目） | 取决于 URL；一定会写/删数据 | `pnpm test:rls` |
| 数据迁移升级夹具 | Node 脚本先在 0007 造历史数据，再应用自动发现的全部 0008+ 迁移并验证回填、冲正、归零和最新发布断言；仅允许 localhost | 本地 Docker | 见 5.5 |
| 发布工具单元 | Node 内置 test 验证 production migration history/恢复点分支、Storage policy、schema diff、音频全局缓存键、OpenRouter 结构化 smoke 请求和服务器 env 安装脚本 | 否 | `pnpm test:release` |
| NestJS/API 单元 | Vitest 覆盖 readiness/JWT、Courses 校验/owner/传播事务、snapshot/attempt patch、Azure adapter/队列/配额，以及翻译判分与 Fish Audio STT endpoint/body、中文提示、WAV/revision 校验、quota、timeout/非法响应和无正文持久化 | 否（fetch/DB fake） | `pnpm --filter @nalanda/api test` |
| Redis 集成 | 真实 Redis 7.4 验证 Lua 滑动窗口并发原子性、过期和 token lock；未显式开启时只跳过这两项，不得称为 Redis E2E | 本地/CI Redis | `RUN_REDIS_E2E=true REDIS_URL=redis://127.0.0.1:6379/15 RATE_LIMIT_HMAC_SECRET=<32+ bytes> pnpm --filter @nalanda/api test` |
| Azure Speech 供应商 smoke | 基础脚本用无个人数据 fixture 验证 MP3/PCM TTS、scripted assessment；生产 gate 另经真实 API 验证持久队列、private Storage、跨用户重复词和未经 VAD/静音裁剪的 WAV 原字节评分；两者都拒绝 fake | 是，产生少量 Azure/Supabase 写入 | 基础：`node --env-file=apps/api/.env scripts/smoke-azure-speech.mjs`；完整 gate 仅由受保护发布执行 |
| OpenRouter 供应商 smoke | 文本脚本验证 Ox Alpha JSON Object 语义判分及本地严格 schema；STT 直连脚本用 Azure 合成“苹果”WAV 验证 Fish Audio wire contract；生产 gate 再经真实 Nalanda owner/session API 验证边界。都拒绝 fake，不打印正文/key/完整响应；非 2xx 只输出状态、结构化 code 与 request ID | 是，产生少量 Azure/OpenRouter 请求 | 文本：`node --env-file=apps/api/.env scripts/smoke-openrouter-translation.mjs`；STT wire：`node --env-file=apps/api/.env scripts/smoke-openrouter-transcription.mjs`；完整 gate 仅由受保护发布执行 |
| FastAPI 自动测试 | ruff + pytest 覆盖 DocumentIR、Luna/Ox 原始字节、provider 锁、reasoning、注入、schema、checkpoint/cancel/purge 和 internal auth | 否；provider fake | `cd apps/ai && .venv/bin/ruff check app tests && .venv/bin/pytest -q` |
| 真浏览器 E2E | Playwright Chromium 启动真实 Vite/Nest/FastAPI，对一次性 Supabase + 真 Redis + provider fake 运行 Courses，以及 Materials→三流水线能力矩阵→250 节点图→任务删除/清历史→整卷考试 | 本地 Docker；供应商 fake | `pnpm --filter @nalanda/web test:playwright`（需见第 6 节环境） |

重要术语：`apps/web/src/**/*.test.ts(x)` 是 **jsdom 模块集成测试**，不会真正执行 RLS；API unit 使用 fake DB/fetch；只有启用 `RUN_REDIS_E2E=true` 的两项测试会连接真实 Redis；`rls.e2e.test.ts` 是**真实 Supabase 数据层 E2E**但不经过 Nest；`courses.spec.ts` 才经过浏览器、Vite、Nest、本地 Supabase 和真实 Redis，但 Azure/OpenRouter 都是 fake。真实 provider smoke 证明当前 key/model/endpoint/structured response，不证明数据库/RLS/UI。任何一层都不能单独证明完整产品已经可用。

## 2. 首次准备

```bash
corepack enable
corepack prepare pnpm@9.12.3 --activate
pnpm install --frozen-lockfile
```

要求 Node.js `>=20`。常规 jsdom 测试不需要 `.env`、Supabase、API、AI、Redis 或 Docker。真实 Supabase 测试在 Node 20 下会显式使用 `ws` 作为测试运行时的 WebSocket adapter：Supabase client 即使只访问 Auth/PostgREST 也会初始化 Realtime；不要移除 `apps/web` 的直接 `ws` 开发依赖或改为依赖间接依赖。

## 3. 日常本地验证

最小提交前序列：

```bash
node scripts/check-docs.mjs
pnpm typecheck
pnpm test:release
pnpm test
pnpm build
```

单独运行 Web 测试：

```bash
pnpm --filter @nalanda/web test
```

watch 模式：

```bash
pnpm --filter @nalanda/web test:watch
```

运行单文件：

```bash
pnpm --filter @nalanda/web exec vitest run src/legacy/community.test.ts
```

根 `pnpm lint` 当前执行严格 TypeScript 静态检查（含未使用声明/参数与 switch fallthrough），不是 ESLint，也不能代替正常 typecheck/test。当前没有 coverage threshold/报告脚本。

## 4. jsdom 集成测试

配置：`apps/web/vite.config.ts`；全局 setup：`apps/web/src/test/setup.ts`；Supabase mock：`apps/web/src/test/supabase-mock.ts`。

### 4.1 当前文件与覆盖

| 测试文件 | 当前覆盖 |
|---|---|
| `apps/web/src/App.auth.test.ts` | 登录会话切换、登出/登录 loading 复位与认证错误恢复 |
| `apps/web/src/legacy/app.shell.test.ts` | 挂载应用壳、9 个导航模块、Create、退出、resize listener 重挂与跨账号清理 |
| `apps/web/src/legacy/account-modules.test.ts` | 通知未读/已读、错误处理、反馈提交、Profile 加载/编辑/壳同步 |
| `apps/web/src/legacy/materials.test.ts` | Storage/metadata 失败、预览/下载/删除错误不产生假成功；Materials AI 全英文菜单、capabilities/显式 pipeline、知识图谱创建、Resume、Delete/Clear 二次确认、cleaning 与队列恢复 |
| `apps/web/src/features/material-ai/NotesView.test.tsx` | Demo/真实 Notes 分组、Materials course 同步、考试 deadline、500ms 纯草稿、交卷前不返回/显示答案、统一交卷评分与删除；知识图 inspector、节点问答与布局 API |
| `apps/web/src/features/material-ai/KnowledgeGraphCanvas.test.ts` | ELK 左到右层级、sourceOrder、节点不重叠、循环/孤立/空图、250 节点、拖动碰撞、viewport 与 revision merge |
| `apps/web/src/features/material-ai/examDraftStore.test.ts` | IndexedDB 草稿按 user/attempt 隔离与清理 |
| `apps/web/src/features/material-ai/errorText.test.ts` | 稳定 AI/provider/security error code 的统一中英文显示 |
| `apps/web/src/legacy/community.test.ts` | feed/筛选/我的 tab、composer 标签/媒体、发帖、详情评论和后端失败回滚 |
| `apps/web/src/legacy/schedule.test.ts` | 今日/周/全部视图、课程资料关联、新任务/目标、完成任务和请求错误 |
| `apps/web/src/features/courses/parser.test.ts` | 最后 ASCII 空格、短语/多翻译、精确行列/错误码、重复、Unicode/XSS/上限，以及整份多单元标题、全局行号、缺少标题与已有词重复 |
| `apps/web/src/features/courses/CoursesApp.test.tsx` | 空状态/禁用类别、文本导入/编辑/排序/错误、逐词错误/复习/已学习属性、复习/考试任意选词，以及两类考试阈值和 API 契约 |
| `apps/web/src/features/courses/ExamHistory.test.tsx` | 失败但补练完成的历史标签、列表→详情、选词、错误次数和脱敏发音评分 |
| `apps/web/src/features/courses/LearningView.test.tsx` | 即时反馈/服务端纠正/outbox、拼写/读音轮末错词清单与手动确认、读音评分后标准音、分数清单、下一轮重排、考试实时第一轮正确率/完成结果，以及音频预取/缓存/朗读降级 |
| `apps/web/src/features/courses/learningSessionState.test.ts` | 客户端/数据库一致的正误规则、retry pool、stage transition、完成预测和权威 patch 替换 |
| `apps/web/src/features/courses/attemptOutbox.test.ts` | IndexedDB 缺失时内存降级、按 user/session/revision 排序、重试退避和账号级清理 |
| `apps/web/src/features/courses/audioCache.test.ts` | Cache Storage 命中跳过网络、202 pending 不缓存、ready 响应缓存、逐资源状态回调与最多两个并发 |
| `apps/web/src/features/courses/recording.test.ts` | WAV 头/PCM 边界、16 kHz 必需格式转换，以及静音、低幅度、首尾帧和完整时长均不被 VAD/裁剪删除 |

### 4.2 mock 的边界

`createSupabaseMock` 提供链式 `select/insert/update/delete`、常用 filter 和有限 Storage mock。它用于验证前端交互与请求形状，不会模拟：

- PostgreSQL FK/check/unique；
- RLS、grants、`SECURITY DEFINER`、触发器；
- Supabase 网络错误、token 刷新、并发、事务；
- signed URL 过期和真实文件权限；
- PostgREST 对所有错误/返回形状的细节。

新增查询操作符或 Storage 方法时，必须先扩展 mock，并用真实 RLS E2E/人工联调验证，不应为让测试通过而把 mock 放宽到真实服务不允许的行为。

### 4.3 jsdom 稳定性约定

- 每个测试自行建立 DOM root，不依赖执行顺序；
- `afterEach` 会清空 `document.body`、rail attribute、localStorage 并恢复 real timers；
- 异步 legacy 渲染用受控 `flush()`，避免任意长 sleep；
- click helper 发送可冒泡/可取消事件；
- 不在 fixture 中放真实邮箱、课件、token 或用户数据；
- 对全局 listener、modal、timer 和订阅断言 cleanup，防止跨账号/跨测试状态泄漏。

## 5. 真实 Supabase RLS E2E

测试文件：`apps/web/tests/rls.e2e.test.ts`。默认 `pnpm test` 会发现它，但在 `RUN_SUPABASE_RLS_E2E` 未设为 `1` 时整套 skip；只有 `pnpm test:rls` 会显式启用。

### 5.1 严禁对生产运行

此测试会：

- 用 service-role 创建两名已确认 Auth 用户；
- 写 profiles、notifications、feedback、courses、materials、posts、comments、likes、favorites、follows、study goals/tasks；
- 上传真实 `materials` Storage 对象；
- 触发 points/level、帖子计数、通知、标签同步和 streak；
- finally/afterAll 尝试删除 Storage 对象与 Auth 用户。
- 创建学习课程/单元/20 个词、会话/attempt/progress、复习日程、分享、不可变 publication、举报、克隆、徽章和课程 points 分录。
- 同一课程同时保留暂停的 Unit 1 首次学习与 Unit 2 复习，验证精确意图恢复、测试项顺序规范化和相同意图并发幂等。
- 创建/清理全局合成音频任务 metadata；不调用真实 Azure，也不上传用户录音。

只允许使用**可随时重置的一次性或专用测试 Supabase 项目**。即使设置了确认变量，也不得输入生产 Project Ref。测试会产生唯一 university/major/subject 全局 `tags`；当前 schema 没有客户端删除 policy，Auth 级联不会清理这些标签，因此项目可能残留少量测试 tag。最安全的清理方式是运行后重置/销毁该测试项目。

### 5.2 前置条件

1. 测试项目已按 `supabase/migrations/` 全量迁移；
2. 获取该测试项目的 URL、anon key、service-role key 和 Project Ref；
3. 操作人再次从控制台确认项目名称明确标为 disposable/test；
4. 不与开发者手工数据、staging 验收数据或生产共享项目。

所需变量：

| 变量 | 作用 |
|---|---|
| `SUPABASE_URL` | 测试项目 URL |
| `SUPABASE_ANON_KEY` | 两名普通用户的客户端 key |
| `SUPABASE_SERVICE_ROLE_KEY` | 创建/删除测试用户与清理对象；最高机密 |
| `SUPABASE_RLS_E2E_CONFIRM_REF` | 必须与 URL hostname 中的 Project Ref 完全相等，防止手滑 |
| `RUN_SUPABASE_RLS_E2E` | `test:rls` 脚本自动设置为 `1` |

Project Ref 确认只是防误操作的第二道检查，不是生产保护白名单。

### 5.3 安全注入变量

可以在仓库根创建本机专用 `.env.rls.local`；该命名匹配 `.gitignore` 的 `.env.*.local`，仍需提交前检查：

```dotenv
SUPABASE_URL=https://<test-project-ref>.supabase.co
SUPABASE_ANON_KEY=<test-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<test-service-role-key>
SUPABASE_RLS_E2E_CONFIRM_REF=<test-project-ref>
```

```bash
chmod 600 .env.rls.local
set -a
. ./.env.rls.local
set +a
pnpm test:rls
unset SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_RLS_E2E_CONFIRM_REF
```

不要把值直接粘进共享 shell history、CI log 或工单。运行前：

```bash
git status --short
git check-ignore .env.rls.local
```

`git check-ignore` 必须显示该文件确实被忽略。

### 5.4 当前真实覆盖

- Profile owner 读写与跨用户隐藏；只允许资料列更新，points/credits/level/VIP/streak 写入均被拒；profile university/major → tags 同步；
- `_add_points`、`_notify`、`_set_point_event` 客户端 RPC 被拒；普通用户和 service-role 都不能直接写 points ledger/state，用户只能读自己的 entries；
- 通知、课程、资料 owner 隔离；Feedback 只允许 owner SELECT/INSERT，客户端 UPDATE/DELETE/伪造 status 均失败，service-role 支持更新仍可执行；
- 跨用户课程不能创建 material；
- private `materials` Storage：owner 上传/下载/签 URL/删除，另一用户不能下载、签 URL 或写入 owner 路径；
- 社区 authenticated 公共读；帖子 INSERT/UPDATE 只能使用内容白名单，伪造 owner、作者快照、四个计数、points key 与时间失败，合法内容编辑由数据库刷新 `updated_at`，计数 trigger 不改变内容编辑时间；
- like/favorite/comment/repost 四类计数、关系行可见性、关注和互动通知；
- like/comment/repost/original post 的稳定业务键、取消/删除冲正、重建恢复净额、并发删除最后评论、原帖级联冲正、ledger projection 与跨用户隐藏；
- 发帖积分达到等级阈值后的 points/level/name；
- study task/goal owner 隔离；客户端和 service-role 的跨 owner course/material/goal 引用都由 trigger 拒绝，`user_id` 不可修改，`done_at` 只由 `done` 派生；task key 不可修改，完成/取消/删除/重建净额和 streak 只首次推进；
- 0039 points 决策：原创/转发/评论/点赞/任务的 3/10/10/20/10 每日数量上限在并发下收敛；超限操作成功但永久零奖励，改时区、删除重建不会补领，每类窗口只持久通知一次；0007→0038→latest 夹具验证旧 business key 保持 grandfather 语义，只有 transition 1 的正向分录可证明历史实际奖励；夹具还会在 0038 取消一个 0008 回填任务，确认 0039 以 append-only `grandfather-zero-reset-v1` 补偿无来源负债，之后删除、恢复和审核始终不产生负分；
- 原帖根链 suppress/restore 只冲正实际获得金额，不重复冲正、不补发日上限 claim；重复 restore 返回 0 变化但保留审计，普通奖励与审核的共享/独占 gate 维持一致锁序；普通客户端及 service-role PostgREST 都不能改写 claim、审核 action 或 signal，审核/扫描只能走 service-only RPC；
- 同一 actor 对同一 owner 的 8 次互动产生 pending 协同 signal，scanner 不自动改内容、冻结账号或冲正；
- 删除 Auth 用户后 `point_entries`/`point_event_states` 无残留。
- Courses owner/跨账号隔离；客户端不能写内容/progress/badge/points/speech usage/翻译配额，也不能执行取消、考试、轮次确认、配额预留等特权 RPC；Profile timezone 只接受 IANA 名称；
- 考试以服务端乱序队列覆盖整单元或 0031 起的 owner-validated 自定义集合：轮末确认期间 attempt/读音评分被拒绝，确认后错词集合不变且重排；第一轮未达线但补练完成会自动结束并写 `practiceCompleted`、不写考试事实。0033 起，达线的单项考试只写对应时间戳，跨日三能力复习仍不 learned，只有拼写/发音考试事实都存在时才 learned；0029 断言读音错词分数，0031 断言选词 scope、历史脱敏和新增 RPC 客户端拒绝，0034 断言双考试约束和唯一投影；
- 翻译完全匹配 claim 不计 provider 配额，真实 provider reservation 只计一次，分钟/滚动 24 小时限制通过数据库锁并发收敛；
- 0015–0016 的 snapshot/七参数 attempt/单元与单词 prepare/claim/finish/quota RPC 均不能由 anon/authenticated 执行，普通用户不能读写 `learning_audio_assets`；
- 同 attempt UUID 的并发请求只追加一个事实/一次 wrong_count 并重放首次响应；相同 revision 的不同 answer 只有一项提交，另一项返回 revision conflict；旧五参数 RPC 仍会推进 revision，支持应用回滚；
- 两个用户相同规范化词集合得到相同 20 个 cache key 且不重复建任务；错误 owner 不能 prepare 他人 word；并发 claim 只有一个全局租约，配额暂停不会消耗生成重试次数；
- Materials AI 候选 0046–0051：普通客户端不能执行 v2 create/usage/checkpoint/complete/delete/clear/layout RPC，不能读取内部 checkpoint/provider usage；双用户 job、Note、布局隔离；queued/processing/delete 竞争只结算一次额度；删除 job 后 usage ledger 保留；layout revision 冲突与 artifact 版本变化只复用仍存在 node 位置；
- 测试答题候补池、低于/达到朗读 `PronScore` 阈值时 recognition 候补项的加入/移除、认词候补轮完成后才能推进，以及同日本地日期去重、两次不同本地日期三能力熟练、错误/复习次数、schedule 完成且不创建普通 task；
- 九级徽章的达标持久发放、20 词课程 +20、规范化词集合指纹防删除/克隆重复奖励；
- 分享 token hash、撤销后事务克隆失败、匿名 PostgREST 拒绝、市场快照不可变、独立零进度克隆/禁止再传播、举报事务。

当前未覆盖或尚未实现的重要风险：

- 0008 会把旧 `profiles.points` 原样保存为 `legacy_opening`；0009 根据 2026-07-21 产品/安全决定追加等额 reversal 归零。自动测试证明迁移与冲正语义，但生产发布仍须保存聚合审计和处置记录；
- `community-media` public bucket 的写/删/对象清理；
- 账号删除后的全部 Storage 孤儿与隐私删除流程；
- 0039–0040 已完成生产第一阶段发布且 2026-08-22 go/no-go 通过；0052–0053 已在 CI 和生产验证客户端不能写 `posts.updated_at`/`study_tasks.done_at`、合法内容/`done` 写入仍成功，以及 service-role/trigger 保持；
- 协同检测只覆盖已锁定的四类阈值并且只标记，不包含内容语义垃圾识别、自动处罚、完整审核后台或跨站设备图谱；跨午夜行为由数据库冻结窗口设计和迁移断言约束，仍需托管 staging 的可控时钟演练；
- Redis 集成在本机未安装 Redis 时会明确 skip；只有 CI 中的真实 Redis service 能提供该层证据。普通 answer 的并发/超时重放已覆盖，但 recognition、旧模块写入、进程崩溃窗口和长时间 session 仍需持续扩展；
- 真实 Azure 账号、音频供应商网络、浏览器麦克风权限与实际发音质量；自动测试只使用 adapter fake/固定 WAV。

这些是后续安全迁移、产品治理与负向 E2E 的优先项，不属于当前套件已证明安全的范围。

### 5.5 0007 → 最新迁移升级夹具

`apps/web/tests/points-upgrade.e2e.mjs` 是破坏性本地脚本，内部同时要求 `ALLOW_POINTS_UPGRADE_E2E=YES` 且 URL hostname 为 `127.0.0.1`/`localhost`。`supabase start` 会提前应用全部迁移，所以 CI 按排序自动发现文件名 `>=20260710000008` 的**所有迁移**并临时移出，先建立真实 0001–0007 schema；这样未来 0014+ 不会在旧 fixture 阶段泄漏。`trap` 保证失败也恢复。不要在有未提交修改的个人工作区照抄移动步骤。核心逻辑是：

```bash
mapfile -t upgrade_migrations < <(
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print \
    | LC_ALL=C sort \
    | awk -F/ '$NF >= "20260710000008"'
)
staged_upgrade_dir=/tmp/nalanda-points-upgrade
mkdir -p "$staged_upgrade_dir"
restore_upgrade_migrations() {
  local migration staged
  for migration in "${upgrade_migrations[@]}"; do
    staged="$staged_upgrade_dir/$(basename "$migration")"
    test -f "$staged" && mv "$staged" "$migration"
  done
}
trap restore_upgrade_migrations EXIT
for migration in "${upgrade_migrations[@]}"; do
  mv "$migration" "$staged_upgrade_dir/$(basename "$migration")"
done

supabase start
supabase status -o env > /tmp/supabase-status.env
set -a; . /tmp/supabase-status.env; set +a

fixture=/tmp/nalanda-points-upgrade.json
# 目录中仅有 0001–0007，因此这是一个真实的旧 schema。
supabase db reset --local --no-seed
ALLOW_POINTS_UPGRADE_E2E=YES POINTS_UPGRADE_FIXTURE="$fixture" \
  SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  node apps/web/tests/points-upgrade.e2e.mjs seed

restore_upgrade_migrations
supabase migration up --local
ALLOW_POINTS_UPGRADE_E2E=YES POINTS_UPGRADE_FIXTURE="$fixture" \
  SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  node apps/web/tests/points-upgrade.e2e.mjs assert
```

夹具验证：credits/VIP/streak 等受漏洞影响的 Profile 值被保留但未来不可由客户端写；points 先生成 `legacy_opening`，再生成引用 opening 的 `legacy_opening_reset` 等额 reversal 并归零投影；历史 duplicate post/like/comment/repost/task 获得稳定 key 和 active/transition 0 状态而不重复加分；删尽/恢复只产生一次负向/恢复分录，Profile 保持非负；历史 task 重做不推进 streak；最终 projection 等于 ledger 并可随 Auth 删除清理。随后 CI 会 `stop --no-backup` 销毁升级 fixture 的容器/卷，再用完整迁移从全新空卷 `start`，避免连续 `db reset` 留下 Auth 502；最长 60 秒的 Auth/PostgREST 有界 readiness 探针确认服务完成后才运行常规 RLS E2E。探针超时会失败，不会无限重试掩盖故障。

### 5.6 失败与清理

1. 保留脱敏 Vitest 错误和 Supabase request ID，不复制 key/JWT/用户正文。
2. 先判断是迁移缺失、RLS 预期变化、平台故障还是测试 cleanup 失败。
3. 在 Supabase Auth 检查 `nalanda-e2e-*` 用户；在 Storage 检查测试用户 UUID 路径。
4. 测试项目无保留价值时直接重置/销毁，避免人工漏清触发器产生的多表数据。
5. 如果必须清理，使用 service-role 的受控管理员工具，按 Storage 对象 → Auth 用户 → 残留 tags 顺序核对；保留操作记录。
6. 任何时候发现命令指向生产，立即终止测试、轮换已暴露的 service-role（如有）、审计已产生数据并按事故流程处理。

## 6. Playwright Courses 浏览器流程

测试文件：`apps/web/e2e/courses.spec.ts`；配置会自行构建/启动 API 和 Vite，端口为 3000/5173。它会注册两个真实本地用户并写数据库，只允许对一次性本地 Supabase 运行。

```bash
pnpm --filter @nalanda/web exec playwright install chromium
docker run --rm -d --name nalanda-test-redis -p 127.0.0.1:6379:6379 redis:7.4-alpine
supabase start
supabase db reset --local --no-seed
supabase status -o env > /tmp/nalanda-supabase.env
set -a
. /tmp/nalanda-supabase.env
set +a

SUPABASE_URL="$API_URL" \
SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
SUPABASE_JWT_SECRET="$JWT_SECRET" \
VITE_SUPABASE_URL="$API_URL" \
VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
FEATURE_LEARNING_COURSES_ENABLED=true \
FEATURE_COURSE_SHARING_ENABLED=true \
FEATURE_COURSE_MARKET_ENABLED=true \
FEATURE_PRONUNCIATION_ENABLED=true \
FEATURE_LEARNING_AUDIO_PREWARM_ENABLED=true \
FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED=true \
FEATURE_MATERIAL_AI=true \
FEATURE_MATERIAL_AI_LUNA=true \
FEATURE_MATERIAL_AI_OX_ALPHA=true \
MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS=pdf,png \
MATERIAL_AI_OX_ALPHA_ALLOWED_EXTENSIONS=png,jpg,jpeg,webp \
AZURE_SPEECH_FAKE=true \
OPENROUTER_FAKE=true \
REDIS_URL=redis://127.0.0.1:6379/14 \
RATE_LIMIT_HMAC_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
POINT_ABUSE_SCANNER_ENABLED=false \
PUBLIC_ORIGIN=http://127.0.0.1:5173 \
pnpm --filter @nalanda/web test:playwright
```

确保 3000/5173/6379 没有遗留进程，结束后执行 `supabase stop --no-backup` 与 `docker rm -f nalanda-test-redis`。流程覆盖：注册→空 Courses→多单元导入/纠错/滚动/排序→保存→四阶段→刷新续学→复习/考试→发布/克隆；并验证 Cache Storage、弱网 outbox、限时/翻译前测、翻译麦克风回填不自动提交，以及翻译/认词/读音考试录音时的波形。Redis 是真实容器；音频、语义和 STT 供应商均为 API fake，因此该层只证明浏览器/API/本地 Supabase/Redis 协作，不证明 Azure 或 OpenRouter。它是真 Chromium 布局与交互 E2E，不是供应商或截图视觉回归。

同一修复的 jsdom 层分别断言：整份导入生成预期单元、多个翻译渲染为独立输入、编辑器批量追加成功，以及与已有词重复时出现 `DUPLICATE_EXISTING_TERM` 且不追加。jsdom 不计算真实尺寸，所以“底部操作是否可达”必须保留在 Playwright 层。

浏览器套件的麦克风由固定 AudioContext fixture 提供，不是物理麦克风质量测试。jsdom 另覆盖 waveform frame、录音中 UI、STT 完成只填入且允许编辑、无自动判分，以及认词/读音录音共用波形；API unit 覆盖真实 wire contract 的 fake fetch，RLS E2E 覆盖普通客户端不能执行 STT reservation、owner/revision/current-word 和持久 quota。只有受保护真实 gate 才能证明当时 Fish Audio endpoint/key 可用，仍不代表真实口音准确率。

失败时保留 Playwright trace/screenshot/video artifact，先区分 UI selector、API envelope、migration/RLS 和 webServer 启动问题。CI 会自动安装带系统依赖的 Chromium；本地只需当前平台浏览器包。

## 7. API 与 AI 当前可执行测试/smoke

API readiness 单元测试已包含在根 `pnpm test`，也可单独运行：

```bash
pnpm --filter @nalanda/api test
```

Redis 集成默认显式 skip；要取得真实 Lua 原子性/过期/lock 证据，先启动一次性 Redis，再运行：

```bash
docker run --rm -d --name nalanda-test-redis -p 127.0.0.1:6379:6379 redis:7.4-alpine
RUN_REDIS_E2E=true \
REDIS_URL=redis://127.0.0.1:6379/15 \
RATE_LIMIT_HMAC_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
pnpm --filter @nalanda/api test
docker rm -f nalanda-test-redis
```

`redis.service.integration.test.ts` 只使用随机、短 TTL 的测试 key；不得把它指向生产 Redis。API unit 另覆盖路由分类、HMAC actor、标准 429/503、fail-open/closed 与审计里程碑，但 fake Redis unit 不能替代上述真实服务测试。

启动 API 后：

```bash
curl -fsS http://localhost:3000/api/health
curl -i http://localhost:3000/api/me
```

第二条应返回 `401`，验证 endpoint 没有匿名放行。带真实开发用户 token 的 `/api/me` 验证见 [API 文档](./API.md)，token 不得写入日志/脚本。

Materials AI Python 门禁：

```bash
cd apps/ai
.venv/bin/ruff check app tests
.venv/bin/pytest -q
```

当前 Python 测试覆盖 PDF/DOCX/PPTX/Markdown/HTML/TXT/JSON/CSV/PNG 的 DocumentIR 路径，包括纯视觉文件在解析器隔离范围内先恢复再严格复审、未知范围/正文/focus 注入失败关闭，以及 Luna PDF/图片的原始字节 inline payload、禁止 parser/OCR/cache、`file-parser.native`、OpenAI-only/no-fallback/ZDR、路由违规、注入拒绝、严格 schema/repair、250 节点图、节点问答与 Luna 评分。试卷回归另覆盖请求元数据、重复 section/question ID、错误 marks 合计的确定性归一化，确认不改题目内容；source refs 回归覆盖移除 allowlist 外引用、采用服务端 block locator、同一稳定 question ID 的 repair 前引用恢复、单 block 全无效引用选择唯一来源并实际运行语义复核，以及多 block/换题 ID 继续失败关闭。reviewer 的非空 issues 不会被矛盾的 `valid=true` 掩盖；最终失败诊断只能包含稳定结构 code、语义 category 与题数/总分计数，不能包含课件、题目、答案、prompt、reviewer 原文或 provider body。还覆盖 202 快速接收、20 分钟预算、可取消 task registry/Office 进程组、下载/模型/回调/checkpoint 各阶段 purge、finally/TTL 清理，以及 callback 断线后 validated checkpoint/usage spool 重放且不重复调用 provider。它使用 fake OpenRouter，不证明真实模型、端点或格式能力；真实门禁必须同时跑正常 chart 与图片内恶意指令样本。

启动带开发配置的 `uvicorn` 后：

```bash
curl -fsS http://localhost:8000/health
```

内部生成/评分路由需要 token、短期 Storage URL 和回调，不提供无认证 curl 示例，避免泄漏。真实固定 fixture gate 使用 `python3 scripts/smoke-material-ai-provider.py`，必须由受保护环境提供 OpenRouter 与临时 Supabase fixture；它不等于浏览器/RLS E2E。

API 测试另覆盖 AI 鉴权/owner/格式、pipeline capabilities、idempotency、quota reserve/consume/release、Redis 重投、预算/ZDR/坏响应、纯草稿与统一交卷、deadline/revision/operation replay。0046–0051 候选覆盖显式 Undici timeout 分类与短 202、增量 usage、checkpoint stage、同 job 恢复、queued/processing/delete/callback 竞态、cleanup reconciler、Clear 只删终态、provider 审计保留，以及布局 owner/version/revision/坐标验证。`RUN_REDIS_E2E=true` 时 BullMQ 测试使用真实 Redis；默认 skip 不算真实 Redis 证据，fake DB/fetch 仍不证明真实 PostgREST 锁、RLS、迁移事务或 provider。

## 8. 文档测试

```bash
node scripts/check-docs.mjs
```

脚本递归检查仓库内所有 Markdown：

- 前 24 行包含“内容”“作用”“何时更新”；
- 本地相对链接不能逃出仓库且目标必须存在。

它不验证事实是否与代码一致、不验证 anchor、不执行代码块，也不检查外部 URL。修改 API/schema/脚本后仍需人工核对对应文档。

## 9. CI 当前门禁

`.github/workflows/deploy.yml` 当前在构建/部署前执行：

```bash
pnpm docs:check
pnpm test:release
pnpm lint
pnpm typecheck
RUN_REDIS_E2E=true REDIS_URL=redis://127.0.0.1:6379/15 \
  RATE_LIMIT_HMAC_SECRET=<CI fixture secret> pnpm test
pnpm build
cd apps/ai && .venv/bin/ruff check app tests && .venv/bin/pytest -q
docker build -f apps/ai/Dockerfile apps/ai
supabase start
# 先运行上文 0007→latest seed / migration up / assert
supabase db reset --local --no-seed  # 再验证完整空库重建
supabase db lint --local --schema public --level error --fail-on error
# 从 supabase status -o env 注入本地 URL/keys 后：
pnpm test:rls
pnpm --filter @nalanda/web exec playwright install --with-deps chromium
pnpm --filter @nalanda/web test:playwright  # 本地 Supabase + 真实 CI Redis + provider fake env
```

质量与数据库 job 都使用独立 Redis 7.4 service。质量 job 执行真实 Lua 集成；浏览器 job 把真实 Redis URL 注入测试 Nest API。compose/nginx 校验还会确认 Redis 无宿主机端口、密码/AOF/noeviction 配置可解析，并执行 `nginx -t`；实际 PING/AOF/私有网络检查属于受保护生产激活门禁。

真实供应商 smoke 必须显式加载只含后端配置、已被 Git 忽略且权限为 600 的文件；脚本拒绝 fake，不会打印 key、文件正文、prompt、答案或完整响应：

```bash
node --env-file=apps/api/.env scripts/smoke-azure-speech.mjs
node --env-file=apps/api/.env scripts/smoke-openrouter-translation.mjs
python3 scripts/smoke-material-ai-provider.py
```

`pull_request` 只运行质量和一次性本地 Supabase/浏览器 job，不读取生产 secrets；Azure/OpenRouter 都是 fake。push `main` 新增 migration 时在验证后停止。owner 必须先手动 plan，再单独 apply 生成加密恢复点、CLI push 和验证，之后才部署应用。Luna 发布还必须在子开关关闭时先读取 OpenRouter 官方 ZDR endpoint catalog；catalog 没有 Luna + first-party OpenAI 时，门禁只能产生 `OPENROUTER_ZDR_UNAVAILABLE` 并保持子开关 false。只有 catalog 合规后，才继续用固定无个人数据 PDF/图片逐格式证明实际 provider=OpenAI、PDF native parser、原始 SHA-256、不转换、严格 schema、注入拒绝和取消无残留；不支持格式继续留在 allowlist 外。fake CI、旧 DeepSeek/MiMo gate、真实 Luna gate、登录用户 smoke 与公网 health 是互不替代的证据。

独立的 `.github/workflows/docs.yml` 会在 Markdown、文档检查脚本或该 workflow 变化的 PR/main push 上执行 `node scripts/check-docs.mjs`。

### 9.1 2026-07-22 Courses 导入/滚动修复证据

- PR run `29932310309` 通过 quality、0007→latest upgrade、latest clean rebuild/database lint、一次性本地 Supabase 双用户 RLS/Storage/Courses E2E，以及 Chromium Playwright Courses workflow。
- main run `29932840103` 重复同一套门禁后完成不可变应用发布 `d31af905b44ca4df39c70e271a7c7a51612916e3-29932840103-1`。
- 当次本地全量 `pnpm check` 通过；Web Vitest 为 32 passed、4 个外部 RLS suite 在默认模式正确 skip，API Vitest 为 28 passed。计数是该提交的执行快照，不是永久测试清单。
- PR/Playwright 的 Azure 是 fake，真实数据库边界只来自一次性本地 Supabase job。main 发布在激活前另执行既有真实 Azure gate，但本次 UI 修复没有改变语音代码；不得把任一 fake/jsdom 结果描述为真实供应商或真实数据库 E2E。
- 发布后独立 smoke 得到 Web 200、`/api/health` 的 `deps.supabase=ok` 和未认证 `/api/me` 401；真浏览器另验证用户示例拆为两个 Starter Unit、多个翻译独立显示、编辑器批量追加及底部操作可达。

目标 CI 分层：

- PR 已跑：docs check、TypeScript code lint/typecheck、Web jsdom、API/Courses unit、build、升级/空库 migrations/database lint、双用户 RLS/Storage/Courses E2E、Playwright Courses；FastAPI contract 待补；
- 受保护 staging 目标：近生产数据规模与配置漂移 E2E；
- 发布前：恢复点、迁移/回滚演练；应用激活前由生产主机强制运行真实 Azure 基础 smoke 与队列/Storage/重复词/评分 smoke；
- 定时：RLS 安全回归、依赖/secret scan、备份恢复、AI 评测/成本（接入后）。

高权限 E2E runner 必须使用独立 test project、受保护 environment approval 和短期/可轮换 secret，不能把 service-role 暴露给不受信任 fork PR。

## 10. 发布验证矩阵

| 变更 | 最低必跑 |
|---|---|
| Markdown | docs check |
| Web/legacy UI | typecheck + 相关 jsdom + 全部 `pnpm test` + build |
| Supabase query shape | jsdom + disposable project RLS E2E |
| Migration/RLS/trigger/function | 空项目全迁移 + 相关旧版本→新版本升级夹具 + lint + RLS E2E + 发布前备份 |
| 帖子/Feedback/Schedule/points 安全 | 0007→0053 + 空库 + exact grants + 双用户 RLS/service-role 负向测试 + cap 并发/时区/重建 + root suppress/restore + pending scanner signal + ledger/Profile projection；0052/0053 另验证两个时间列拒绝与合法写入 |
| NestJS auth/Courses API | typecheck/build + API unit + RLS E2E + Playwright；attempt 变更另测 UUID 重放/revision conflict/outbox；multipart/真实 Azure 与真实 OpenRouter 另做受控 smoke |
| Courses parser/UI | parser/jsdom + API unit + RLS E2E + Playwright；不能只测 mock |
| Courses 音频/离线 | cache key/不裁剪录音 unit + API 原字节转发/queue/Storage fake + RLS grants/lease + Playwright Cache Storage/outbox + 发布前真实 Azure 队列复用 gate |
| Courses 限时拼写/翻译前测 | fake-clock jsdom + API structured response/timeout unit + 双用户 RLS/幂等/配额 + fake-provider Playwright + 发布前真实 OpenRouter structured/API gate；不得把模型输出直接当客户端事实 |
| Courses 翻译语音输入/波形 | recording/WAV/waveform unit + jsdom 回填不提交/可编辑/迟到响应保护 + API multipart/中文 STT/错误映射 + 真实 Supabase RPC 权限/配额 + fake-provider Playwright 三处波形 + 发布前 Azure 中文 WAV→真实 Fish Audio 候选 API gate；合成样本不等于真实口音评测 |
| Courses 拼写规范化 | Web 单元/jsdom 覆盖 NFKC/Unicode 空白/全角大小写、标点遗漏/替换/增加及真实字母/空格错误 + 一次性真实 Supabase E2E 验证 raw answer、revision、`wrong_count`、retry pool 和客户端 helper 拒绝 |
| Courses 拼写轮末复盘/考试 | state 单元 + jsdom 验证持久错词清单/确认门/实时正确率；API unit 验证固定 exam 规则；真实 Supabase E2E 验证 trigger、重排、通过/未通过熟练投影与权限；fake-provider Playwright 验证浏览器完整流程 |
| Courses 读音考试/任意选词/考试历史 | jsdom 验证逐题评分反馈、轮末分数、选择器和历史详情；API unit 验证 Azure target/owner/映射；真实 Supabase E2E 验证选词 scope、不可变快照、客户端 RPC 拒绝、失败补练不伪造通过；fake-provider Playwright 验证浏览器流程，发布前另跑真实 Japan East Azure gate |
| Courses 双考试掌握 | 真实 Supabase E2E 验证跨日复习与单项考试均不 learned、两项考试任意顺序共同 learned、失败考试不写事实、term/translations/IPA 编辑精确撤销；0034 空库/升级断言字段、check constraint、review 无正向写入和 service-role-only 权限 |
| OpenRouter 实际调用配额 | API unit 验证 exact/replay 不 reservation、provider 调用才 reservation；真实 Supabase E2E 验证 `quota_counted`、用户锁和客户端拒绝；受保护发布前另核对生产 env=500，不用真实用户答案探测 500 次上限 |
| 其它 AI 产物（未来） | 新 schema、parser/prompt/eval + API/RLS/jsdom/Playwright + 真实 provider gate；不得复用试卷 gate 推断质量 |
| Materials AI 生成/考试 | Python ruff/pytest + API durable queue/quota/revision unit + 真实 Redis BullMQ + 0041–0043 空库/升级/双用户 RLS + jsdom + fake-provider Playwright + AI Docker；每次关键发布另跑真实 DeepSeek/MiMo 固定 PDF/DOCX/PPTX/chart/injection/grading gate和2G资源 canary |
| Materials AI 图谱/生命周期/Luna（0046–0051 候选） | ELK/React Flow unit + Materials/My Notes jsdom + Python 原始字节/provider lock/cancel/checkpoint + API delete/clear/202/layout/整卷批改 + 真实 Redis + 0007→latest/空库/lint/RLS + fake Chromium 250 节点/移动端/任务清理；发布前另跑真实 DeepSeek/MiMo 和 Luna OpenAI-only PDF/图片/逐格式/注入/取消/usage gate、2G canary与登录用户 smoke |
| nginx/compose/Redis/CI | API image依赖检查 + 真实 Redis Lua 集成 + compose config + nginx `-t`/标准 429 + staging deploy + `deps.supabase=ok`/`deps.redis=ok` + auth/admin 拒绝/限流 headers |
| points/credits/VIP/支付（未来） | 账本幂等/并发/对账/退款/webhook 重放 + E2E，不允许只做 UI 测试 |

2026-07-27 的可核验发布样本：PR #21 run `30243998633` 与 main run `30244402278` 完成自动化矩阵；只读 plan `30244967669` 只列 0015–0016；apply/deploy `30245430630` 创建恢复 artifact `8644999285`，并在切流前用 Japan East 真实 Azure 验证首次生成、private Storage 命中、跨用户重复词复用和 VAD 裁剪评分。Playwright 在这些 run 中仍使用 fake provider，真实供应商证据只来自独立生产 gate。

同日后续样本：PR #24 run `30263277807` 与 main run `30263794368` 完成 0007→0018、空库重建/lint、真实本地 Supabase RLS/Storage、jsdom 与 Chromium Playwright；历史八词冷单元和暂停 Unit 1→复习 Unit 2→恢复 Unit 1 的浏览器测试使用 Azure fake。只读 plan `30264327821` 只列 0017–0018；apply/deploy `30264979509` 创建恢复 artifact `8652623403`，并在切流前用真实 Japan East 账号验证 `generatedAssets=4`、`duplicateAssetsReused=4` 和评分 97。公网/服务器健康检查是发布证据，不把 fake Playwright 描述为真实供应商 E2E。

2026-07-28 的限时拼写/翻译前测样本：PR #26–#29 与最终 main run `30374301472` 通过 0007→0020、空库重建/lint、真实本地 Supabase RLS/Storage、jsdom、API 和 Chromium Playwright；Playwright 的 Azure/OpenRouter 都是 fake。只读 plan `30366334157` 仅列 0019–0020，受保护 run `30367263486` 创建 artifact `8691620673` 并应用到 0020。最终生产部署以真实 Azure 验证 MP3/评分，以真实 OpenRouter 验证 structured 同义/无关判定，再通过真实 Courses API/数据库验证完全匹配 0 token、同 UUID `replayed=true` 和权威 spelling attempt；release 为 `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3`。发布链中的 provider 契约、模型误判、replay 映射和单次 12 秒 timeout 都被 gate 阻断，不能把失败候选计作上线。

2026-07-31 的 Unicode 拼写规范化样本：PR #35、main 和受保护 run `30616540480` 通过 0007→0022、空库重建/lint、真实本地 Supabase RLS/Storage、Web/API tests 与 Chromium Playwright。真实数据库断言 `ＷＯＲＤ－０１` 和 ASCII `WORD-02` 都判对、revision 递增、`wrong_count=0`、retry pool 为空，并拒绝普通客户端执行 helper；只读 plan `30616030488` 仅列 0021–0022，受保护 run 保留 artifact `8787805291` 后应用并激活 release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1`。发布中的真实 Azure/OpenRouter gate 证明依赖未回归，但与拼写大小写行为无直接因果；没有真实用户生产答题 E2E。

同日的标点容错样本：PR #37 run `30620350644`、main run `30620879282` 和受保护 run `30624104943` 通过 0007→0024、空库重建/lint、真实本地 Supabase RLS/Storage、Web/API tests 与 Chromium Playwright。Web 与真实数据库分别断言 `You're welcome.` / `Youre welcome!`、`check-in` / `check in` / `checkin` 通过，真实字母错误与无标点参与的词间空格错误失败，正确样本的 revision 递增、`wrong_count=0`、retry pool 为空，客户端不能执行内部 matcher；只读 plan `30623522232` 仅列 0023–0024，受保护 run 保留 artifact `8790816378` 后应用并激活 release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1`。Playwright 供应商仍为 fake；真实 Azure/OpenRouter 仅证明生产依赖 gate，且没有真实用户生产答题 E2E。

2026-08-01 的取消、轮末复盘、考试和滚动配额样本：PR #40 run `30705662543`、main run `30705946921` 与受保护 run `30706731292` 通过 0007→0028、空库重建/lint、真实本地 Supabase RLS/Storage、Web/API tests 与 Chromium Playwright。自动化覆盖 owner-only 取消、取消后恢复隔离、每轮错题确认与打乱重考、考试阈值/实时正确率/通过投影，以及只有真实 provider 请求才占用滚动 24 小时 500 次额度；只读 plan `30706279006` 仅列 0025–0028，受保护 run 保留 artifact `8820657507` 后应用并激活 release `93354a56044470fb5d2b1fd6aeabcf82f459bb52-30706731292-1`。Playwright 的 Azure/OpenRouter 仍为 fake；真实 Japan East Azure、真实 OpenRouter 与候选 Courses API/Storage gate 是独立发布证据。生产 UI 只读检查未提交真实用户答案，因此不能描述为生产考试 E2E。

2026-08-03 的读音考试、任意选词、历史和双考试掌握样本：PR #45 最终 run `30811283164`、main run `30811817461` 与受保护 run `30813047562` 通过 0007→0034、空库重建/lint、真实本地 Supabase RLS/Storage、Web/API tests 与 Chromium Playwright。自动化覆盖读音分数/retry、owner-validated 选词、失败补练自动结束、不可变历史快照、复习/单项考试不 learned、双考试共同 learned 和编辑撤销；只读 plan `30812467085` 仅列 0029–0034，受保护 run 保留 artifact `8855819351` 后应用并激活 release `1a58d2164f6d58feea4d3a2c8925211b8cc60dde-30813047562-1`。Playwright 的 Azure/OpenRouter 仍为 fake；真实 Japan East Azure、真实 OpenRouter 与 Courses API/Storage gate 是独立发布证据。没有提交真实生产用户考试，不能描述为生产用户流程 E2E。

2026-08-04 的未裁剪录音与精确掌握投影样本：PR #47 run `30831319634`、main run `30831964846` 与受保护 run `30833228406` 通过 0007→0036、空库重建/lint、真实本地 Supabase RLS/Storage、Web/API tests 与 Chromium Playwright。自动化覆盖静音/轻声/首尾完整 WAV 不被客户端删除、Nest 原样转发字节、手工 `learned_at` 和单项考试不能绕过 trigger 投影；只读 plan `30832581552` 仅列 0035–0036，受保护 run 保留 artifact `8864033351` 后应用并激活 release `51252527645d9438df0414f056c8a3b088b360d8-30833228406-1`。Playwright 的 Azure/OpenRouter 仍为 fake；独立真实 Japan East Azure、真实 OpenRouter 与 Courses API/Storage gate 证明真实依赖，gate 报告未裁剪 `assessmentBytes=88444`。没有提交真实生产用户考试，不能描述为生产用户流程 E2E。

同日的翻译语音输入与共享波形样本：PR #49 run `30904901828` 通过 0007→0038、空库重建/lint、真实本地 Supabase RLS/Storage、72 个 API 测试、85 个 Web/jsdom 测试与 Chromium Playwright；main run `30905971129` 按迁移保护规则只验证不部署。只读 plan `30906629924` 首次因一次性 Supabase 上游瞬时响应失败，同 SHA 重跑失败 job 后通过且唯一列出 0037–0038。受保护 run `30907716733` 保留 artifact `8892006761`、应用到 0038 并激活 release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1`。Playwright STT 仍为 fake；独立真实直连和生产待激活 API gate 使用合成中文 WAV，后者返回 `transcriptionMatched=true`。这证明当时 endpoint/key/额度与固定样本，不证明物理麦克风或多口音质量。

2026-08-10 的安全/限流 Stage A 样本：PR #51 run `31367746106`、PR #52 run `31370961413` 与 main run `31371608883` 通过 docs/lint/typecheck、Web/API tests、build、真实 Redis Lua、0007→0040、空库/database lint、双用户 RLS/Storage 和 Chromium Playwright；Playwright 的供应商仍为 fake。plan `31368447660` 只列 0039–0040，protected run `31369657292` 保留 artifact `9055783205` 后应用到 0040。该 run 暴露的远端 stdin 假成功由 #52 回归修复；最终 plan `31372198037` 为空，protected run `31372888441` 以 artifact `9057062920` 再验证远端并激活 release `56100e6bc2a4c70aa289aaad4b43efa1267428bd-31372888441-5`。真实 Redis/nginx/Azure/OpenRouter/Fish/Courses gates 与公网 `deps.redis=ok`、auth/admin 401、注册 RateLimit headers 是独立生产证据；OpenRouter 的瞬时超时/429 均在切流前阻断，不能算成功测试。Stage B 观察于 2026-08-22 通过；PR #72 run `32579985463`、main run `32580594918`、plan `32581192318` 与 protected run `32581805613` 覆盖 0007→0053、空库、DB lint、双用户 RLS/Storage、Playwright 和精确远端 history。0052–0053 已应用；同一 run 的应用候选两次被真实 Materials AI PPTX gate 拦截并回退，不能把数据库成功写成最新应用上线。

2026-08-11 的 Materials AI 样本：PR #56 run `31462982923`、PR #57 run `31465041901`、main run `31465776658` 均通过 docs/lint/typecheck、104 个 API、105 个 Web/jsdom、25 个 Python AI 测试、真实 Redis、0007→0043、空库/lint、双用户 RLS/Storage、AI Docker 和 fake-provider Chromium Playwright。只读 plan `31465816321` 确认 0043/空 dry-run；protected run `31467153739` 创建 artifact `9092230348`，再跑 220 页资源 canary、真实 DeepSeek/MiMo 固定格式/视觉/注入/评分 suite、真实 Azure/OpenRouter/Courses gate和登录用户 Materials→Notes→Exam→grading→delete，最终激活 release `e6ce0cb246d9fc1ecc1c4869b6e63d09d3256bd4-31467153739-1`。更早 `31463661987` 的 workflow 假绿被服务器 image/Web/flag 和公网 404 独立检查识别，修复裸 `compose exec` heredoc stdin 后才重发；因此 Actions success 不能代替独立生产 smoke。

2026-08-14 的 0049–0051发布先由 PR #66 run `31821614332` 和 main run `31822630770` 完成完整 fake/local 门禁，只读 plan `31822702349` 仅列 0049–0051。apply run `31824832947` 成功创建恢复点、应用并验证这三条迁移，随后 220 页 canary 通过；真实 Luna PDF gate 返回 `OPENROUTER_ZDR_UNAVAILABLE`，旧 Web/API 自动恢复且 Luna/Materials AI 保持关闭。该 run 是“数据库发布成功、应用发布失败并回退”的证据，不能写成 Luna 上线。公开 ZDR catalog 同时证明当时只有 Azure/Azure EU endpoint；向前修复必须在合规不可用时发布 DocumentIR 功能但保持 Luna false。

2026-08-15 的向前修复 PR #68 run `31834010315` 与 main run `31834895278` 通过 63 个 Python、127 个 API、113 个 Web 测试，以及真实 Redis、0007→0051、空库/lint、双用户 RLS/Storage、fake Chromium 和 220 页 canary。真实 chart 在 `material-safety-audit.v2` 下通过视觉恢复，但固定安全教材的试卷一次因 marks 合计漂移返回 `AI_EXAM_VALIDATION_FAILED`，候选 release 自动回退；三次同 fixture 脱敏诊断确认该结果具有供应商随机性且 repair 可能重复错误。新增回归以服务端设置规范机械元数据/ID/marks，并让复核 issues 优先于矛盾 valid 标记；仍必须由新的真实 provider run 和独立生产检查证明修复生效。

2026-08-22 的 PR #70 run `32499521666` 通过完整门禁并合并；main run `32540131549` 通过 131 个 API、113 个 Web、72 个 Python 测试、真实 Redis、0007→0051、空库/lint、双用户 RLS/Storage、fake Chromium、镜像和 220 页 canary，但真实固定 DOCX 在最终试卷校验返回 `AI_EXAM_VALIDATION_FAILED`。候选在 API/Web 切流前自动回退且没有新迁移，因此该 run 不是上线证据。向前修复的本地门禁为 74 个 Python、ruff 和 26 个 release tooling 测试；下一次真实门禁必须证明八事实 fixture 能稳定生成五道题，并在仍失败时只输出 content-free validation categories/counts。

2026-08-23 的 PR #71 合并后 main run `32543270581` 首次执行通过完整 fake/local 与真实 Materials provider 门禁，但 Japan East Azure TTS HTTP 401 阻断切流并自动回退。按用户要求重试的 attempt 2 通过 220 页 canary，固定 DOCX 初次语义门返回 `ANSWERABILITY/ANSWER_CORRECTNESS/DISTRACTOR_QUALITY/EXPLANATION_QUALITY/SOURCE_GROUNDING`，repair 后题数 5、总分 20 均正确但最终结构门只剩 `SOURCE_REFERENCE`，因此仍正确失败关闭。引用向前修复本地通过 ruff 与 77 个 Python 测试；新的真实门禁必须证明 repair 不再因虚构 block ID 失败，同时结构和第二次语义复核保持严格。Azure 401 若再次出现仍是独立硬门，不能用本次 AI 修复绕过。

同日 PR #74 run `32585020750` 和 main run `32585659792` 通过 docs、quality、0007→0053、空库/lint、双用户 RLS/Storage 与 fake Chromium。生产 attempt 1 的真实 Materials suite、canary 和 Azure 均通过，Gemma 翻译在五次有界重试后仍 429并回退；attempt 2 又在只有一个 DocumentIR block 的 PDF 上以 initial/final `SOURCE_REFERENCE` 失败并回退。唯一 block 修复的本地门禁为 ruff 和 78 个 Python 测试；下一真实 run 必须同时证明单 block 引用通过结构+语义门、多个 block 仍不猜测，以及 Gemma、后续 Courses、登录 smoke 和切流全部完成。

PR #75 run `32587211309` 通过 docs、quality（3m52s）和 0007→0053/空库/lint/RLS/Storage/fake Chromium（8m12s），main run `32587844503` 再次通过 quality（4m6s）和本地数据库/浏览器（7m26s），且没有 migration 变更。production attempt 1 的固定 PDF 在 repair 后仍多出一道题，以 `QUESTION_TYPE_COUNT` 失败关闭；唯一一次失败 job 重跑的 attempt 2 通过 220 页 canary、全部真实 Materials 样本与语义门、Japan East Azure，但 Gemma 免费模型连续五次 429后回退。该证据证明唯一 block 引用回归已越过真实门，同时也证明真实供应商硬门没有被 fake 测试、结构规范化或重跑绕过；Courses/登录 smoke、切流和公网新版本验证仍未发生。

随后 PR #69 完整 CI 与 main run `31838779292` 的本地数据库/RLS/fake Chromium、真实 provider fixture、220 页 canary和 Azure/Courses gate通过，但登录生产 smoke 的知识图产生 3 nodes/2 valid edges 且没有 level-0 root。数据库完成 RPC 以 `22023` 拒绝，job 停在 `saving`，15 分钟 smoke 超时后候选 `669f3f423e712fe561496dae6b0ab9b16c799025-31838779292-1` 自动回退且未切 Web。回归现在覆盖：DocumentIR/native graph level 机械归零、root/sourceMode 与 DB contract 对齐、checkpoint 恢复后仍归一化、永久 result/routing 拒绝进入终态，以及 lost lease 返回 409；新真实 run 前仍不得报告应用上线。

## 11. 新增测试约定

1. 测试名描述用户行为/安全属性，不只写函数名。
2. 每个 bug 修复先写能复现的失败测试；安全问题同时加负向用例。
3. fixture 无真实个人数据，时间/UUID/网络可控。
4. 测试相互隔离、可重复、可并行；若必须串行需说明共享状态。
5. 外部 E2E 有显式 opt-in、项目 Ref 确认、唯一前缀和 finally cleanup。
6. 任何高权限 key 只在 node/server 环境，严禁导入 Web 测试 bundle。
7. 文档中的“已验证”必须给出当前可执行命令、测试路径和边界；人工测试写明日期/环境，不能永久替代自动化。
8. 不通过增加 sleep、忽略 error 或放宽 mock 来隐藏竞态/真实权限错误。
