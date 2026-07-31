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
| 发布工具单元 | 11 个 Node 内置 test 验证 production migration history/恢复点分支、Storage policy、schema diff、音频全局缓存键、6 秒 VAD、OpenRouter 结构化 smoke 请求和服务器 env 安装脚本 | 否 | `pnpm test:release` |
| NestJS/API 单元 | Vitest 覆盖 readiness/JWT、Courses 校验/owner/传播事务、snapshot/attempt patch、Azure adapter、持久队列/配额/Storage miss/格式/超时/隐私，以及翻译规范化完全匹配零供应商调用、OpenRouter boolean-only 结构化判定、安全 feedback 回退、同预算单次重试、幂等/租约释放/非法响应 | 否（fetch/DB fake） | `pnpm --filter @nalanda/api test` |
| Azure Speech 供应商 smoke | 基础脚本用无个人数据 fixture 验证 MP3/PCM TTS、scripted assessment；生产 gate 另经真实 API 验证持久队列、private Storage、跨用户重复词和裁剪评分；两者都拒绝 fake | 是，产生少量 Azure/Supabase 写入 | 基础：`node --env-file=apps/api/.env scripts/smoke-azure-speech.mjs`；完整 gate 仅由受保护发布执行 |
| OpenRouter 供应商 smoke | 固定合成英文/中文样本验证指定模型的 structured JSON：语义近义回答为 true、无关回答为 false；拒绝 fake，不打印正文/key/完整响应 | 是，产生两次小型 provider 请求 | `node --env-file=apps/api/.env scripts/smoke-openrouter-translation.mjs`；生产还通过真实 Courses API 验证幂等与权威 attempt |
| FastAPI 自动测试 | 尚无 pytest/test client 套件 | — | 无 |
| 真浏览器 E2E | Playwright Chromium 启动真实 Vite/Nest，对一次性 Supabase + Azure/OpenRouter fake 运行 Courses、弱网 outbox、Cache Storage、限时拼写和翻译前测流程 | 本地 Docker；供应商 fake | `pnpm --filter @nalanda/web test:playwright`（需见第 6 节环境） |

重要术语：`apps/web/src/**/*.test.ts(x)` 是 **jsdom 模块集成测试**，不会真正执行 RLS；API unit 使用 fake DB/fetch；`rls.e2e.test.ts` 是**真实 Supabase 数据层 E2E**但不经过 Nest；`courses.spec.ts` 才经过浏览器、Vite、Nest 和本地 Supabase，但 Azure/OpenRouter 都是 fake。真实 provider smoke 证明当前 key/model/endpoint/structured response，不证明数据库/RLS/UI。任何一层都不能单独证明完整产品已经可用。

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
| `apps/web/src/legacy/materials.test.ts` | Storage/metadata 失败、预览/下载/删除错误不产生假成功 |
| `apps/web/src/legacy/community.test.ts` | feed/筛选/我的 tab、composer 标签/媒体、发帖、详情评论和后端失败回滚 |
| `apps/web/src/legacy/schedule.test.ts` | 今日/周/全部视图、课程资料关联、新任务/目标、完成任务和请求错误 |
| `apps/web/src/features/courses/parser.test.ts` | 最后 ASCII 空格、短语/多翻译、精确行列/错误码、重复、Unicode/XSS/上限，以及整份多单元标题、全局行号、缺少标题与已有词重复 |
| `apps/web/src/features/courses/CoursesApp.test.tsx` | 空状态/禁用类别、AI 文件占位、逐单元与整份多单元纠错、独立翻译字段、编辑器批量追加/已有词重复、排序、保存失败、进度切换、会话恢复和 API error |
| `apps/web/src/features/courses/LearningView.test.tsx` | Promise 未完成时即时反馈、服务端纠正、翻译/发音匹配/拼写错误手动推进、正确 520 ms 自动推进、慢请求期间后续 outbox 串行续传、朗读阈值/候补/显式重读，以及八词历史冷单元前五词 pending 提权、ready 缓存替换和过期降级提示清除 |
| `apps/web/src/features/courses/learningSessionState.test.ts` | 客户端/数据库一致的正误规则、retry pool、stage transition、完成预测和权威 patch 替换 |
| `apps/web/src/features/courses/attemptOutbox.test.ts` | IndexedDB 缺失时内存降级、按 user/session/revision 排序、重试退避和账号级清理 |
| `apps/web/src/features/courses/audioCache.test.ts` | Cache Storage 命中跳过网络、202 pending 不缓存、ready 响应缓存、逐资源状态回调与最多两个并发 |
| `apps/web/src/features/courses/recording.test.ts` | 20 ms VAD、噪声阈值、250 ms 有效语音拒绝和 6 秒裁剪 |

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
- 通知、反馈、课程、资料 owner 隔离；owner 资料列表与显式删除路径；
- 跨用户课程不能创建 material；
- private `materials` Storage：owner 上传/下载/签 URL/删除，另一用户不能下载、签 URL 或写入 owner 路径；
- 社区 authenticated 公共读，帖子作者权限、作者快照防伪造、`repost_of`/points key 不可修改；
- like/favorite/comment/repost 四类计数、关系行可见性、关注和互动通知；
- like/comment/repost/original post 的稳定业务键、取消/删除冲正、重建恢复净额、并发删除最后评论、原帖级联冲正、ledger projection 与跨用户隐藏；
- 发帖积分达到等级阈值后的 points/level/name；
- study task/goal owner 隔离、关联归属、task key 不可修改、完成/取消/删除/重建净额和 streak 只首次推进；
- 删除 Auth 用户后 `point_entries`/`point_event_states` 无残留。
- Courses owner/跨账号隔离；客户端不能写内容/progress/badge/points/speech usage，也不能执行特权 RPC；Profile timezone 只接受 IANA 名称；
- 0015–0016 的 snapshot/七参数 attempt/单元与单词 prepare/claim/finish/quota RPC 均不能由 anon/authenticated 执行，普通用户不能读写 `learning_audio_assets`；
- 同 attempt UUID 的并发请求只追加一个事实/一次 wrong_count 并重放首次响应；相同 revision 的不同 answer 只有一项提交，另一项返回 revision conflict；旧五参数 RPC 仍会推进 revision，支持应用回滚；
- 两个用户相同规范化词集合得到相同 20 个 cache key 且不重复建任务；错误 owner 不能 prepare 他人 word；并发 claim 只有一个全局租约，配额暂停不会消耗生成重试次数；
- 测试答题候补池、低于/达到朗读 `PronScore` 阈值时 recognition 候补项的加入/移除、认词候补轮完成后才能推进，以及同日本地日期去重、两次不同本地日期三能力熟练、错误/复习次数、schedule 完成且不创建普通 task；
- 九级徽章的达标持久发放、20 词课程 +20、规范化词集合指纹防删除/克隆重复奖励；
- 分享 token hash、撤销后事务克隆失败、匿名 PostgREST 拒绝、市场快照不可变、独立零进度克隆/禁止再传播、举报事务。

当前未覆盖或尚未实现的重要风险：

- 0008 会把旧 `profiles.points` 原样保存为 `legacy_opening`；0009 根据 2026-07-21 产品/安全决定追加等额 reversal 归零。自动测试证明迁移与冲正语义，但生产发布仍须保存聚合审计和处置记录；
- 帖子作者仍可在 UPDATE 时篡改 author 快照、冗余计数和时间；0008 只锁住 `repost_of` 与 points key；
- `study_goals.course_id` 跨 owner 归属；
- `community-media` public bucket 的写/删/对象清理；
- 账号删除后的全部 Storage 孤儿与隐私删除流程；
- 每日 points 上限、垃圾/重复内容和协同作弊；普通 answer 的并发/超时重放已覆盖，但 recognition、旧模块写入、进程崩溃窗口和长时间 session 仍需持续扩展。
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
AZURE_SPEECH_FAKE=true \
PUBLIC_ORIGIN=http://127.0.0.1:5173 \
pnpm --filter @nalanda/web test:playwright
```

确保 3000/5173 没有遗留进程，结束后 `supabase stop --no-backup`。流程覆盖：注册→空 Courses→粘贴整份多单元文本→格式纠错/滚动/排序→保存→四阶段→刷新恢复→3 天复习日程→免费发布→第二账号市场克隆/0%；并额外验证整单元音频进入 Cache Storage、两次 answer 请求断网进入 outbox、恢复网络后同步，以及 session picker 传入 20 秒限时 + 翻译前测、语义通过后才进入拼写并显示英文/翻译结果。这里的音频和翻译语义由 API fake provider 产生，仅证明浏览器/API/本地 Supabase 协作，不证明 Azure 或 OpenRouter。它是真 Chromium 布局与 offline/cache 行为，不是截图视觉回归。

同一修复的 jsdom 层分别断言：整份导入生成预期单元、多个翻译渲染为独立输入、编辑器批量追加成功，以及与已有词重复时出现 `DUPLICATE_EXISTING_TERM` 且不追加。jsdom 不计算真实尺寸，所以“底部操作是否可达”必须保留在 Playwright 层。

当前不覆盖真实麦克风/Azure/OpenRouter、两个真实日期的复习、分享撤销 UI 或全部治理操作；这些由 API/RLS/供应商 smoke 分层验证。jsdom 另覆盖 timer 只自动提交一次、翻译通过前不计时、同 UUID 串联两步、语义错误手动推进、provider 失败不记错，以及正确/错误都渲染英文和翻译。

失败时保留 Playwright trace/screenshot/video artifact，先区分 UI selector、API envelope、migration/RLS 和 webServer 启动问题。CI 会自动安装带系统依赖的 Chromium；本地只需当前平台浏览器包。

## 7. API 与 AI 当前可执行测试/smoke

API readiness 单元测试已包含在根 `pnpm test`，也可单独运行：

```bash
pnpm --filter @nalanda/api test
```

启动 API 后：

```bash
curl -fsS http://localhost:3000/api/health
curl -i http://localhost:3000/api/me
```

第二条应返回 `401`，验证 endpoint 没有匿名放行。带真实开发用户 token 的 `/api/me` 验证见 [API 文档](./API.md)，token 不得写入日志/脚本。

AI 语法和本地 smoke：

```bash
python3 -m compileall -q apps/ai/app
```

启动 `uvicorn` 后：

```bash
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/generate/quiz \
  -H 'Content-Type: application/json' \
  --data '{"material_id":"test","text":"fixture","lang":"zh"}'
```

当前固定桩响应只能证明 schema/route 可调用，不证明解析、Claude、质量或成本。

API 测试覆盖受保护路由缺 bearer 拒绝、HS256 issuer/audience、readiness、Courses public 脱敏/owner、单 snapshot 映射、attempt 幂等响应/409 envelope、音频队列 claim/生成/Storage 恢复、输入指纹、CMUdict、WAV 格式/2 MB/8 秒、Azure phoneme 映射和 provider timeout 不记 attempt。真实 JWKS 网络拉取与轮换仍由一次性 Supabase/线上登录 smoke 承担。该层使用 fake DB/fetch，不证明 Nest HTTP multipart、真实 PostgREST、数据库锁或 Azure endpoint。

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
pnpm test
pnpm build
supabase start
# 先运行上文 0007→latest seed / migration up / assert
supabase db reset --local --no-seed  # 再验证完整空库重建
supabase db lint --local --schema public --level error --fail-on error
# 从 supabase status -o env 注入本地 URL/keys 后：
pnpm test:rls
pnpm --filter @nalanda/web exec playwright install --with-deps chromium
pnpm --filter @nalanda/web test:playwright  # 本地 Supabase + Azure/OpenRouter fake env
```

真实供应商 smoke 必须显式加载只含后端配置、已被 Git 忽略且权限为 600 的文件；脚本拒绝 `AZURE_SPEECH_FAKE=true`，不会打印 key 或完整供应商响应：

```bash
node --env-file=apps/api/.env scripts/smoke-azure-speech.mjs
node --env-file=apps/api/.env scripts/smoke-openrouter-translation.mjs
```

`pull_request` 只运行质量和一次性本地 Supabase/浏览器 job，不读取生产 secrets；Azure/OpenRouter 都是 fake。push `main` 新增 migration 时在验证后停止。owner 必须先手动 plan，再单独 apply 生成加密恢复点、CLI push 和验证，之后才部署应用。默认 `pnpm test` 的外部 RLS suite 仍 skip，但 workflow 显式运行升级、RLS 和浏览器套件。生产发布先运行基础真实 Azure 和真实 OpenRouter structured smoke；新 API readiness/auth 通过后，再由 `scripts/smoke-learning-audio-production.mjs` 创建临时用户，验证首次队列生成、private Storage、第二用户重复词零新增 claim、6 秒内裁剪 WAV 评分，以及真实 Courses API 的规范化完全匹配、同 UUID 重放和权威拼写提交，清理成功后才切 Web symlink。非字面语义由前一个真实 OpenRouter smoke 单独验证；CI fake 不能代替该结果，真实 provider gate 也不能代替 RLS/Playwright。

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
| NestJS auth/Courses API | typecheck/build + API unit + RLS E2E + Playwright；attempt 变更另测 UUID 重放/revision conflict/outbox；multipart/真实 Azure 与真实 OpenRouter 另做受控 smoke |
| Courses parser/UI | parser/jsdom + API unit + RLS E2E + Playwright；不能只测 mock |
| Courses 音频/离线 | cache key/VAD unit + API queue/Storage fake + RLS grants/lease + Playwright Cache Storage/outbox + 发布前真实 Azure 队列复用 gate |
| Courses 限时拼写/翻译前测 | fake-clock jsdom + API structured response/timeout unit + 双用户 RLS/幂等/配额 + fake-provider Playwright + 发布前真实 OpenRouter structured/API gate；不得把模型输出直接当客户端事实 |
| Courses 拼写规范化 | Web 单元/jsdom 覆盖 NFKC/Unicode 空白/全角大小写、标点遗漏/替换/增加及真实字母/空格错误 + 一次性真实 Supabase E2E 验证 raw answer、revision、`wrong_count`、retry pool 和客户端 helper 拒绝 |
| AI schema/route | compileall + smoke；真实生成接入后补 pytest/契约/评测 |
| nginx/compose/CI | build image + staging deploy + 外部 health/login |
| points/credits/VIP/支付（未来） | 账本幂等/并发/对账/退款/webhook 重放 + E2E，不允许只做 UI 测试 |

2026-07-27 的可核验发布样本：PR #21 run `30243998633` 与 main run `30244402278` 完成自动化矩阵；只读 plan `30244967669` 只列 0015–0016；apply/deploy `30245430630` 创建恢复 artifact `8644999285`，并在切流前用 Japan East 真实 Azure 验证首次生成、private Storage 命中、跨用户重复词复用和 VAD 裁剪评分。Playwright 在这些 run 中仍使用 fake provider，真实供应商证据只来自独立生产 gate。

同日后续样本：PR #24 run `30263277807` 与 main run `30263794368` 完成 0007→0018、空库重建/lint、真实本地 Supabase RLS/Storage、jsdom 与 Chromium Playwright；历史八词冷单元和暂停 Unit 1→复习 Unit 2→恢复 Unit 1 的浏览器测试使用 Azure fake。只读 plan `30264327821` 只列 0017–0018；apply/deploy `30264979509` 创建恢复 artifact `8652623403`，并在切流前用真实 Japan East 账号验证 `generatedAssets=4`、`duplicateAssetsReused=4` 和评分 97。公网/服务器健康检查是发布证据，不把 fake Playwright 描述为真实供应商 E2E。

2026-07-28 的限时拼写/翻译前测样本：PR #26–#29 与最终 main run `30374301472` 通过 0007→0020、空库重建/lint、真实本地 Supabase RLS/Storage、jsdom、API 和 Chromium Playwright；Playwright 的 Azure/OpenRouter 都是 fake。只读 plan `30366334157` 仅列 0019–0020，受保护 run `30367263486` 创建 artifact `8691620673` 并应用到 0020。最终生产部署以真实 Azure 验证 MP3/评分，以真实 OpenRouter 验证 structured 同义/无关判定，再通过真实 Courses API/数据库验证完全匹配 0 token、同 UUID `replayed=true` 和权威 spelling attempt；release 为 `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3`。发布链中的 provider 契约、模型误判、replay 映射和单次 12 秒 timeout 都被 gate 阻断，不能把失败候选计作上线。

2026-07-31 的 Unicode 拼写规范化样本：PR #35、main 和受保护 run `30616540480` 通过 0007→0022、空库重建/lint、真实本地 Supabase RLS/Storage、Web/API tests 与 Chromium Playwright。真实数据库断言 `ＷＯＲＤ－０１` 和 ASCII `WORD-02` 都判对、revision 递增、`wrong_count=0`、retry pool 为空，并拒绝普通客户端执行 helper；只读 plan `30616030488` 仅列 0021–0022，受保护 run 保留 artifact `8787805291` 后应用并激活 release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1`。发布中的真实 Azure/OpenRouter gate 证明依赖未回归，但与拼写大小写行为无直接因果；没有真实用户生产答题 E2E。

同日的标点容错样本：PR #37 run `30620350644`、main run `30620879282` 和受保护 run `30624104943` 通过 0007→0024、空库重建/lint、真实本地 Supabase RLS/Storage、Web/API tests 与 Chromium Playwright。Web 与真实数据库分别断言 `You're welcome.` / `Youre welcome!`、`check-in` / `check in` / `checkin` 通过，真实字母错误与无标点参与的词间空格错误失败，正确样本的 revision 递增、`wrong_count=0`、retry pool 为空，客户端不能执行内部 matcher；只读 plan `30623522232` 仅列 0023–0024，受保护 run 保留 artifact `8790816378` 后应用并激活 release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1`。Playwright 供应商仍为 fake；真实 Azure/OpenRouter 仅证明生产依赖 gate，且没有真实用户生产答题 E2E。

## 11. 新增测试约定

1. 测试名描述用户行为/安全属性，不只写函数名。
2. 每个 bug 修复先写能复现的失败测试；安全问题同时加负向用例。
3. fixture 无真实个人数据，时间/UUID/网络可控。
4. 测试相互隔离、可重复、可并行；若必须串行需说明共享状态。
5. 外部 E2E 有显式 opt-in、项目 Ref 确认、唯一前缀和 finally cleanup。
6. 任何高权限 key 只在 node/server 环境，严禁导入 Web 测试 bundle。
7. 文档中的“已验证”必须给出当前可执行命令、测试路径和边界；人工测试写明日期/环境，不能永久替代自动化。
8. 不通过增加 sleep、忽略 error 或放宽 mock 来隐藏竞态/真实权限错误。
