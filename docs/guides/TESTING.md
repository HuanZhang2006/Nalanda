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
| Supabase RLS E2E | Vitest node 环境，两名真实用户访问 Auth/PostgREST/Storage | **是，且会写/删数据** | `pnpm test:rls` |
| NestJS HTTP 自动测试 | 尚无 | — | 无 |
| FastAPI 自动测试 | 尚无 pytest/test client 套件 | — | 无 |
| 真浏览器 E2E | 尚无 Playwright/Cypress | — | 无 |

重要术语：当前 `src/**/*.test.ts` 是 **jsdom 模块集成测试**，不会启动 Vite、NestJS 或浏览器，也不会真正执行数据库 RLS。`tests/rls.e2e.test.ts` 是**真实 Supabase 数据层 E2E**，但不会打开浏览器或经过 Nalanda API。文档不得把任一层单独称为“完整产品 E2E”。

## 2. 首次准备

```bash
corepack enable
corepack prepare pnpm@9.12.3 --activate
pnpm install --frozen-lockfile
```

要求 Node.js `>=20`。常规 jsdom 测试不需要 `.env`、Supabase、API、AI、Redis 或 Docker。

## 3. 日常本地验证

最小提交前序列：

```bash
node scripts/check-docs.mjs
pnpm typecheck
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

当前根 `pnpm lint` 没有实际 ESLint 任务，退出成功不能代替 typecheck/test。当前也没有 coverage threshold/报告脚本。

## 4. jsdom 集成测试

配置：`apps/web/vite.config.ts`；全局 setup：`apps/web/src/test/setup.ts`；Supabase mock：`apps/web/src/test/supabase-mock.ts`。

### 4.1 当前文件与覆盖

| 测试文件 | 当前覆盖 |
|---|---|
| `apps/web/src/legacy/app.shell.test.ts` | 挂载应用壳、8 个导航模块、Create、退出、resize listener 清理 |
| `apps/web/src/legacy/account-modules.test.ts` | 通知未读/已读、反馈提交和通知、Profile 加载/编辑/壳同步 |
| `apps/web/src/legacy/community.test.ts` | feed/筛选/我的 tab、composer 标签和模拟媒体上传、发帖、详情评论 |
| `apps/web/src/legacy/schedule.test.ts` | 今日/周/全部视图、课程资料关联、新任务/目标、完成任务交互 |

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

- Profile owner 读写与跨用户隐藏；profile university/major → tags 同步；
- 通知、反馈、课程、资料 owner 隔离；owner 资料列表与显式删除路径；
- 跨用户课程不能创建 material；
- private `materials` Storage：owner 上传/下载/签 URL/删除，另一用户不能下载、签 URL 或写入 owner 路径；
- 社区 authenticated 公共读，帖子作者权限、作者快照防伪造；
- like/favorite/comment/repost 四类计数、关系行可见性、关注和互动通知；
- 发帖积分达到等级阈值后的 points/level/name；
- study task/goal owner 隔离、关联归属、完成积分和同日 streak。

当前未覆盖的重要风险：

- `profiles` owner 可直接改 points/credits/VIP/等级/streak；
- `_add_points`/`_notify` 等高权限 RPC 的 EXECUTE 暴露；
- 帖子作者可在 UPDATE 时篡改 author 快照、冗余计数、时间和 `repost_of`；现有套件只验证 INSERT 防伪造和非作者更新被拒；
- 删除重建互动/任务导致重复获分的幂等问题；
- `study_goals.course_id` 跨 owner 归属；
- `community-media` public bucket 的写/删/对象清理；
- 账号删除后的全部 Storage 孤儿与隐私删除流程；
- 并发写、网络中断和长时间 session。

这些是应新增安全迁移与负向 E2E 的优先项，而不是当前套件已证明安全。

### 5.5 失败与清理

1. 保留脱敏 Vitest 错误和 Supabase request ID，不复制 key/JWT/用户正文。
2. 先判断是迁移缺失、RLS 预期变化、平台故障还是测试 cleanup 失败。
3. 在 Supabase Auth 检查 `nalanda-e2e-*` 用户；在 Storage 检查测试用户 UUID 路径。
4. 测试项目无保留价值时直接重置/销毁，避免人工漏清触发器产生的多表数据。
5. 如果必须清理，使用 service-role 的受控管理员工具，按 Storage 对象 → Auth 用户 → 残留 tags 顺序核对；保留操作记录。
6. 任何时候发现命令指向生产，立即终止测试、轮换已暴露的 service-role（如有）、审计已产生数据并按事故流程处理。

## 6. API 与 AI 当前可执行 smoke

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

## 7. 文档测试

```bash
node scripts/check-docs.mjs
```

脚本递归检查仓库内所有 Markdown：

- 前 24 行包含“内容”“作用”“何时更新”；
- 本地相对链接不能逃出仓库且目标必须存在。

它不验证事实是否与代码一致、不验证 anchor、不执行代码块，也不检查外部 URL。修改 API/schema/脚本后仍需人工核对对应文档。

## 8. CI 当前门禁

`.github/workflows/deploy.yml` 当前在构建/部署前执行：

```bash
pnpm typecheck
pnpm test
```

随后构建 Web 和 API 镜像。真实 RLS E2E 默认 skip，不在 deploy CI 中运行，因为它需要高权限 secret 且会修改外部项目。独立的 `.github/workflows/docs.yml` 会在 Markdown、文档检查脚本或该 workflow 变化的 PR/main push 上执行 `node scripts/check-docs.mjs`；本地提交前仍应先运行一次。

目标 CI 分层：

- PR 必跑：docs check、typecheck、jsdom、API/FastAPI unit/contract、build；
- 受保护 staging：完整 migrations + 双用户 RLS/Storage E2E；
- 发布前：真浏览器主路径、恢复点、迁移/回滚演练；
- 定时：RLS 安全回归、依赖/secret scan、备份恢复、AI 评测/成本（接入后）。

高权限 E2E runner 必须使用独立 test project、受保护 environment approval 和短期/可轮换 secret，不能把 service-role 暴露给不受信任 fork PR。

## 9. 发布验证矩阵

| 变更 | 最低必跑 |
|---|---|
| Markdown | docs check |
| Web/legacy UI | typecheck + 相关 jsdom + 全部 `pnpm test` + build |
| Supabase query shape | jsdom + disposable project RLS E2E |
| Migration/RLS/trigger/function | 空项目全迁移 + 重放 + RLS E2E + 发布前备份 |
| NestJS auth/API | typecheck/build + 当前 smoke；补相应自动 HTTP test 后纳入 CI |
| AI schema/route | compileall + smoke；真实生成接入后补 pytest/契约/评测 |
| nginx/compose/CI | build image + staging deploy + 外部 health/login |
| points/credits/VIP/支付（未来） | 账本幂等/并发/对账/退款/webhook 重放 + E2E，不允许只做 UI 测试 |

## 10. 新增测试约定

1. 测试名描述用户行为/安全属性，不只写函数名。
2. 每个 bug 修复先写能复现的失败测试；安全问题同时加负向用例。
3. fixture 无真实个人数据，时间/UUID/网络可控。
4. 测试相互隔离、可重复、可并行；若必须串行需说明共享状态。
5. 外部 E2E 有显式 opt-in、项目 Ref 确认、唯一前缀和 finally cleanup。
6. 任何高权限 key 只在 node/server 环境，严禁导入 Web 测试 bundle。
7. 文档中的“已验证”必须给出当前可执行命令、测试路径和边界；人工测试写明日期/环境，不能永久替代自动化。
8. 不通过增加 sleep、忽略 error 或放宽 mock 来隐藏竞态/真实权限错误。
