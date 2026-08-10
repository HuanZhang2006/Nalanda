# 为 Nalanda 做贡献

> **本文内容：**规定开发环境、分支与提交、代码/数据库/文档变更流程、测试要求和完成定义。  
> **作用：**让贡献者用可复现方式交付变更，并确保代码、迁移、测试、文档和运维说明同步。  
> **何时更新：**工具链、目录、CI 门禁、分支策略、数据库流程或评审责任变化时；发现本文命令无法执行时应立即更新。  
> **状态基线：**2026-08-10；生产数据库已受保护发布到 0038，0039–0040 安全/限流候选尚未发布。提交说明必须区分代码实现、本地或 fake 自动化、真实 Redis/Supabase/provider gate 与实际上线。

## 1. 开始之前

- Node.js 版本以 `.nvmrc` 和根 `package.json#engines` 为准（当前 Node 20+）。
- 包管理器固定为 `pnpm@9.12.3`；不要混用 npm/yarn 或提交其他锁文件。
- Python AI 服务使用独立虚拟环境；不要把 `.venv`、缓存或本地模型文件提交到仓库。
- 本地配置从各应用的 `.env.example` 复制，真实密钥不得进入 Git、Issue、PR、聊天或测试快照。
- 架构蓝图不是实现证明。开始改动前，先检查代码、迁移和“当前状态”文档。

基础安装与静态验证：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

完整本地服务、Supabase 和测试命令以 `docs/` 下的本地开发与测试指南为准。若指南与脚本不一致，以可执行脚本为证据，并在同一 PR 修正文档。

## 2. 选择改动入口

| 范围 | 主要目录 | 额外要求 |
|---|---|---|
| Web | `apps/web`、`packages/ui` | 覆盖桌面/窄屏、明暗主题、登录态与跨账户切换 |
| API | `apps/api` | DTO 校验、鉴权/归属、错误契约、API 文档和集成测试 |
| Courses | `apps/web/src/features/courses`、`apps/api/src/learning`、`packages/types`、0011+ | 解析/状态机/跨日复习、service-only RPC、Schedule/Profile、分享/市场、Speech 隐私和分层 E2E |
| AI | `apps/ai`、`packages/types` | schema 契约、离线评测、成本/延迟预算、隐私与模型版本 |
| 数据库 | `supabase/migrations` | 只新增迁移；RLS 双用户负向测试；发布/回滚说明 |
| 部署 | `infra`、`.github/workflows` | 分阶段验证、健康检查、回滚、密钥/告警影响 |
| 文档 | `README.md`、`docs`、根治理文件 | 每篇开头写内容/作用/何时更新；标注当前/目标和验证日期 |

高保真原型 `app/` 是设计参考，不是生产运行时。生产 Web 当前仍含 legacy DOM 模块；修改时不得无意破坏既有交互，也不要继续扩大无类型全局状态。

## 3. 分支、提交与 PR

从最新 `main` 创建短生命周期分支，推荐：`feat/...`、`fix/...`、`docs/...`、`test/...`、`chore/...`。一个 PR 解决一个可审查问题，避免把格式化、重构和功能混成一批。

提交标题使用祈使句并说明范围，例如：

```text
fix(db): prevent clients from updating wallet fields
test(web): cover authenticated account switching
docs(ai): define evaluation release gates
```

PR 描述至少包含：

- 问题、用户影响和非目标；
- 当前行为与改后行为，必要时给截图/录屏；
- 数据、权限、隐私、成本和兼容性影响；
- 执行过的精确命令及结果；
- 迁移、部署、观测和回滚步骤；
- 同步更新的文档、API 契约和 CHANGELOG 条目。

不得提交生成目录（`dist`、`.turbo`）、本地环境文件、真实用户样本、生产导出或包含 secret 的日志。

## 4. 代码约定

- TypeScript 新代码不得使用 `@ts-nocheck`、无理由 `any` 或隐式全局；共享契约优先放在 `packages/types` 并由运行时校验配套。
- 不信任浏览器、模型和数据库返回值；所有服务边界做校验并显式处理 `{ data, error }`。
- UI 写操作要有 loading、成功、空、错误、重试和重复点击保护；登出/换账号必须清空用户级缓存与订阅。
- API 只返回稳定错误码，不把上游细节暴露给客户端；使用关联 ID 支持排障。
- Python 输出必须通过 Pydantic schema；模型/prompt/parser 版本随结果记录，禁止用静态桩冒充真实生成。
- 无障碍至少覆盖键盘操作、焦点、表单 label、状态提示、对比度和 reduced motion。
- 用户可见文字默认考虑中英双语目标；当前未完成 i18n 时，不得声称已经支持双语界面。
- Courses 文本 parser 和 API validator 都是边界：变更规则时同时更新精确错误位置、共享契约、数据库约束和测试；文件入口在真实隔离/OCR/人工确认完成前必须保持禁用。
- 学习事实逐次持久化；不得用前端内存替代 session/attempt/progress，不得让排序/改名误清能力，也不得让供应商失败累计用户错误。
- Courses 的即时反馈只能是 provisional UI。每次测试答题必须使用 UUID `attemptId` 和单调 `expectedRevision`，按 revision 串行重放；服务端确认前不得展示完成、points 或徽章，跨账号时必须清除该账号未同步 outbox。
- 合成音频只能以 private Supabase Storage 为服务端事实源；浏览器 Cache Storage 是可删除、可回收、可重建副本。新增供应商或缓存键输入时必须同步版本、配额、隐私、真实供应商 gate 和离线删除测试。
- 拼写限时由客户端负责体验，但超时答案仍必须走普通幂等 attempt；可选翻译前测只能由 API 使用服务端参考答案判定，规范化完全匹配走确定性零 token 路径，其他答案才进入受限 OpenRouter adapter。不得把 key、参考答案或判定权威下放 Web。

## 5. 数据库变更

1. 永远新增带 UTC 时间戳的迁移，不重写已发布迁移。
2. 先写兼容性迁移，再发布依赖新结构的代码；破坏性删除采用 expand → migrate/backfill → contract。
3. 每张新表先定义所有权、外键、唯一约束、索引和 RLS；默认拒绝，按操作逐项放行。
4. 对 `SECURITY DEFINER` 固定 `search_path`、撤销 `PUBLIC` 执行权、限定角色并验证不能替任意用户操作。
5. 用用户 A、用户 B、匿名、service-role 分别测试允许与拒绝路径。只验证“自己能用”不算 RLS 完成。
6. 金额、credits、points、权益和审核状态采用不可变事件/账本与幂等键；修正使用补偿记录，不删除历史。
7. PR 附前向发布、验证 SQL、失败停止条件、回滚或前向修复方案；生产迁移前必须有可恢复备份。
8. expand/contract 必须拆成真正独立的发布。兼容应用与 expand migration 先上线并观察约定窗口；contract migration 只能在观测证据完成后另建、另审、另发，不能让“未来 contract 文件”被当前 CI 的 latest 自动提前应用。
9. append-only 审核/账本表即使对 service-role 也不授予直接 mutation；管理 API 调用受控事务函数。扫描信号只能作为人工审核输入，不得用测试阈值偷偷变成自动处罚。

## 6. 测试与质量门禁

提交前运行仓库提供的全部门禁。最低要求是：

```bash
pnpm typecheck
pnpm test
pnpm build
```

等价的全仓门禁是 `pnpm check`。涉及 migration/Courses 还必须在一次性本地 Supabase 运行 `pnpm test:rls`；涉及 Redis/限流必须用真实测试 Redis 运行 `RUN_REDIS_E2E=true pnpm --filter @nalanda/api test`；涉及完整用户路径需按测试指南配置并运行 `pnpm --filter @nalanda/web test:playwright`。普通 `pnpm test` 中 Redis/RLS skip 不是对应依赖通过证据。

若某工作区没有相应脚本，不能把“命令不存在”记录为通过；应补齐脚本或在 PR 中明确该门禁尚未实现。按变更类型追加：

- 纯函数/状态机：单元测试和边界值；
- Web DOM 行为：Vitest/jsdom，验证失败路径与卸载清理；
- 用户主流程：浏览器 E2E，不使用生产账号/数据；
- API：未认证、坏 token、越权、重复请求和上游失败；
- Supabase：迁移重放、RLS 双用户、Storage、函数权限和触发器幂等；
- Redis/限流：真实 Redis 验证 Lua 原子性、窗口过期、分层 fail-open/closed、429/`Retry-After`/RateLimit headers 与 HMAC 日志；mock 只用于纯分类单元测试；
- nginx/部署：在与生产同 major 的容器中执行 `nginx -t`，并对 secret 安装脚本验证 mode 600、幂等替换和 stdout 不泄露；
- AI：契约、固定夹具、离线评测、安全集和成本回归；
- Speech：固定 WAV/fake adapter 覆盖格式、大小、VAD 裁剪、超时、限流、队列租约、Storage miss 和不落录音；发布前另做真实 Azure 队列/缓存复用/评分 smoke，不能在 PR 使用个人录音；
- 支付：只用 Stripe test mode/CLI 夹具，覆盖重复、乱序、退款和争议 Webhook。

修复 bug 时先添加能复现问题的失败测试。不得用放宽断言、永久 skip、共享生产密钥或依赖测试顺序来“修复”测试。

## 7. 文档规则

每篇长期文档开头必须明确：

1. 本文包含什么；
2. 它在体系中的作用；
3. 什么变化会触发更新。

描述能力时使用统一状态：

- **当前/已实现：**可从代码、迁移和可执行测试证明；
- **部分实现：**明确哪些路径可用、哪些仍是假数据/桩；
- **目标/待实现：**设计或发布门禁，不使用“已支持”“已完成”；
- **废弃：**给替代文档和截止日期。

行为、API、表、环境变量、运维流程或产品规则变化必须在同一 PR 更新对应文档。重大、跨服务或难以逆转的选择新增 ADR；不要悄悄改写已 Accepted ADR 的历史结论。

## 8. 安全、隐私与内容

- 遵循 [SECURITY.md](SECURITY.md)，疑似漏洞走私密通道。
- 测试数据使用合成内容；课件、邮箱、支付和社区导出视为机密。
- 新数据字段需说明目的、合法基础/用户预期、留存、访问者、导出与删除行为。
- 新社区或市场内容类型必须接入举报、审核、申诉和附件删除设计。
- Course Market v1 只允许免费克隆；不得加入 credits/购买/分成文案或让克隆课再次传播。修改分享 token、publication 快照或审核时必须补撤销竞态、脱敏与审计测试。
- 新 AI 能力必须说明资料是否发往第三方、保存多久、是否用于训练，以及怎样评测幻觉和提示词注入。
- 新 credits/VIP/支付逻辑必须符合 [统一经济与支付规则](docs/product/POINTS_CREDITS_VIP_PAYMENTS.md)。

## 9. 完成定义

一项变更只有同时满足以下条件才算完成：实现与范围一致；相关测试可重复通过；失败/越权路径被验证；迁移和回滚可执行；监控能够发现故障；用户和运维文档同步；无 secret/真实 PII；已知限制清楚记录；必要的产品、安全和数据负责人已审批。
