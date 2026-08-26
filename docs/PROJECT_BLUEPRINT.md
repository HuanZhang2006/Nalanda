# Nalanda 最终项目说明、产品蓝图与开发路线图

> **文档定位**
> - **内容**：定义 Nalanda 最终要成为怎样的产品、目标系统边界、完整功能范围、技术原则、分阶段开发路径与待实现清单。
> - **作用**：这是项目“最终目标与接下来做什么”的唯一权威文档；所有带未来时态的产品或架构规划都应汇总到这里。
> - **何时更新**：产品范围、关键技术决策、阶段优先级、依赖关系或里程碑验收标准发生变化时；每完成一个阶段也必须同步状态。
> - **状态口径**：本文同时写“当前基线”和“目标状态”。标记为“目标/规划”的内容不得在 README 或当前架构文档中写成已实现。

最后核对：2026-08-25。生产数据库已受保护应用到 0055；0052–0055 已上线，原预留 0044–0045 保持未使用。PR #77 候选因 Courses Ox Alpha strict JSON Schema 与模型能力不匹配而在真实门返回 HTTP 404，旧 Web/API 已恢复；当前修复候选改为 JSON Object + 本地严格校验。不能把数据库迁移、部分真实门通过或修复合并写成应用/Luna/Ox 已上线。

2026-08-14 代码与数据库已占用 0046–0051：0046–0048 实现 Materials AI 长任务异步回调、24 小时可恢复断点、知识点图谱和节点问答；0049–0051 实现 Luna 原文件、可取消清理、provider provenance 和跨设备图布局。数据库已应用，应用仍需成功的不可变 release；Luna 另受实时 ZDR/OpenAI 门禁约束。Stage B 采用 0052–0053，避免为填补 0044–0045 空号引入 `--include-all` 或改写既有 migration history。

---

## 1. 一句话定义

Nalanda 是面向大学生的多平台 AI 学习与知识平台：把课程资料转化为可学习、可检验、可关联、可分享的结构化知识资产，并围绕这些资产提供计划、社区、成长和合规的交易能力。

最终产品必须形成以下闭环：

```text
课程资料 → 解析/检索 → AI 生成 → 学习与测验 → 计划与复习
    ↑                                      ↓
    └──────── 个人笔记、社区、市场、成长反馈 ────────┘
```

## 2. 当前基线（不是最终完成状态）

截至 2026-08-11，项目是“高保真 Web 应用 + 真实 Supabase 业务模块 + 已上线的首版英语 Courses + Materials AI 最小闭环 + 私有 Redis 请求保护/任务投递”：

- 已上线：邮箱密码注册/登录、Materials、社区、普通学习计划、Profile、活动积分/等级、通知、反馈和 Web/API/AI 生产部署；生产 migration history 已到 0053，但最新应用候选失败后仍由此前稳定 release 提供服务。
- 已上线：Courses 英语词表文本导入/编辑、四阶段学习、复习熟练度、Schedule/Profile、徽章/+20 points、公开分享、免费课程市场和 Azure Speech；生产 flags 已开启，fake 未进入生产。
- 已上线增量：0015–0016 把普通答题改成客户端一帧内预测反馈、`attemptId + expectedRevision` 幂等串行 outbox、单 RPC session snapshot，并用 Supabase Storage 持久队列与浏览器 Cache Storage 预取/下载单元音频；服务端仍唯一决定进度与成长事实。
- 已上线增量：0017–0018 让当前词和未来四词不论 ready/pending 都立即缓存或提升生成优先级，持续轮询 manifest 并在 ready 后替换浏览器朗读；active session 改为按首次学习、临时复习或日程复习的精确意图恢复，暂停学习不会再劫持另一单元复习。
- 已上线增量：0019–0020 为拼写测试增加可选 3–300 秒限时与可选 OpenRouter 语义翻译前测；服务端用同一 UUID/revision 管理租约、评判和权威 spelling attempt，数据库不保存用户输入正文。规范化完全匹配走零 token 确定性路径，非字面同义/改写才调用固定 OpenRouter 模型。
- 已上线增量：0021–0022 统一 Web 即时判定与数据库权威判定的拼写文本归一化；全角/半角大写、Unicode 空白、弯/直撇号及常见连字符变体一致，标点仍不可省略，避免客户端先判对后被服务端反转并加入候补池。
- 已上线增量：0023–0024 在不改变服务端权威边界的前提下，把仅有标点遗漏、替换或增加的拼写答案判为正确；真实字母、数字、词序及不涉及标点的词间空格错误仍判错。
- 已上线增量：0025–0026 为 active 学习/复习增加显式取消事务；0027–0028 增加拼写轮末错题清单与手动确认、默认 90% 可调阈值的单元考试，以及仅对真实 OpenRouter 请求计数的每用户 20 次/分钟、滚动 500 次/24 小时配额。
- 已上线增量：0037–0038 为拼写前翻译输入增加默认中文的 Fish Audio STT 和所有用户录音入口的实时波形。识别只回填可编辑文本、不自动提交；同一服务端 OpenRouter key 由 NestJS 复用，数据库在调用前验证 owner/session/revision/current word 并预留独立配额。2026-08-04 已通过受保护数据库发布、真实 Fish Audio gate 和不可变生产激活。
- 部分落地：主应用仍有大量 `legacy` DOM 模块，Courses 是 React 功能。Supabase 是旧业务主要后端，NestJS 已承担 Courses 特权写入与公开脱敏读取。
- 仍为 mock/未实现：Home 聚合、独立 AI Create、知识清单、独立 Quiz、Note Market；My Notes 历史硬数据保留在 Demo 分组。
- 已上线：Materials AI 第一阶段的 Generate test paper、私有 Notes、在线考试和主观题评分。未发布候选另完成知识点梳理、交互图谱/节点问答以及长任务断点续跑；在受保护发布完成前不得标为上线。
- 未实现：Courses 的 PDF/Word/JSON/Markdown/HTML/图片 AI 导入和其他三类课程；pgvector/RAG、Stripe、credits 账本、VIP 结算、Realtime、Electron、React Native、完整 i18n 和通用管理后台。生产 Redis 同时用于 API 限流、审计聚合、协同扫描锁和 BullMQ UUID 投递。
- 安全基线进展：生产已应用 0008–0053，Profile/帖子/Feedback/Schedule 可信字段与内部 `SECURITY DEFINER` RPC 已收口；points 使用冻结日上限、可冲正幂等账本、人工审核和只待审协同信号；旧 `legacy_opening=11` 已由 `legacy_opening_reset=-11` 归零。Courses 与 Materials AI 私有写入/RPC/传播、幂等 operation、配额、布局和任务清理事实均通过双用户 RLS 与发布断言；新应用仍以独立 release 证据判定。
- 已上线：0039–0040 与兼容应用从 `2026-08-10T09:35:34Z` 起观察超过 24 小时并于 2026-08-22 通过 go/no-go；0052–0053 随后撤销两个 authenticated 兼容 UPDATE grant，远端 0053 自验证通过。

当前事实的权威说明见 [当前架构](ARCHITECTURE.md)；商业数值与状态机见 [积分、钱包、VIP 与支付规则](product/POINTS_CREDITS_VIP_PAYMENTS.md)。

## 3. 最终产品范围

### 3.1 身份、资料与权限

目标能力：

- 邮箱验证、登录、退出、找回密码、OAuth。
- 用户 Profile、语言、学校、专业、年级和学习偏好。
- `user / creator / moderator / admin` 角色与最小权限。
- 用户数据导出、账户删除、法定保留与审计。

当前差距：邮箱所有权未验证；缺找回密码、OAuth、通用管理角色、数据导出/删除工作流和 CAPTCHA。注册 IP+规范化邮箱双层 Redis/HMAC 限流已上线。

### 3.2 课程与资料库

目标能力：

- 课程、学期、教师、资料分类、搜索、分页与批量管理。
- PDF、PPTX、DOCX、Markdown、HTML、TXT 以及受控图片输入。
- 上传大小/MIME 白名单、恶意文件检测、解析状态、版本与去重。
- 私有 Storage、短期签名 URL、孤儿文件回收、配额和生命周期规则。

当前差距：基础 CRUD/预览已完成；缺服务端上传约束、配额、解析状态、版本、扫描和自动清理。

### 3.3 Courses 学习课程

首版英语单词学习已经上线：文本逐单元/整份多单元粘贴、精确错误定位、结构化编辑、CMUdict IPA、四阶段可恢复学习、跨日期复习事实、复习 Schedule、Profile 聚合、持久徽章、指纹幂等 +20 points、只读分享与免费课程市场。它采用独立 `learning_*` 模型，不改变 Materials 的 `courses` 表；Courses 功能迁移已发布到 0038，生产总 migration history 已到 0043，并开启对应 flags。0025–0028 进一步上线显式取消、拼写轮末错词复盘/确认、默认 90% 可调阈值的单元考试，以及只对真实 OpenRouter 请求计数的滚动 500 次/24 小时配额。

0029–0034 已于 2026-08-03 受保护发布，在不改变积分/支付边界的前提下增加读音考试、单元内任意选词复习/考试、失败考试补练完成后自动结束、考试历史详情、编辑器逐词学习属性，以及“同一词必须同时通过拼写考试和发音考试才标为已学习”的唯一掌握规则；跨日期复习只保留练习日期/次数，不再形成掌握。

0035–0036 已于 2026-08-04 受保护发布，不新增掌握方式，而是把上述规则变成 progress 表的强制精确投影：`learned_at` 只可能等于拼写/发音考试通过时间的较晚值，缺少任一事实即为空；首次学习、复习、单项考试或直接赋值都不能绕过。同期 Web 已移除会误拒轻声的本地 VAD/静音裁剪，完整录音只做 Azure 契约必需的 PCM 格式转换后交由 Azure 评判。

0037–0038 已于 2026-08-04 受保护发布：translation-first spelling 的翻译输入框可录制默认中文语音，经服务端固定的 OpenRouter `fish-audio/transcribe-1` 识别后只回填可编辑文本，不自动提交或判分；认词朗读、读音考试和翻译语音输入共用实时波形。WAV/transcript 不落库或 Storage，客户端不能选择 model/language/key，也不能绕过 owner/session/revision/current-word 与配额校验。

已上线的性能/弱网增量：答题 UI 在本地确定正误，服务端仍唯一决定 retry pool、cursor/stage、错误次数、完成、points 与徽章；IndexedDB outbox 按 revision 串行、用相同 attempt UUID 重放，冲突时拉单一 snapshot 并重放仍兼容的答案。音频按规范化词、locale、voice、格式和合成版本做全局 SHA-256，private Storage 是服务端唯一事实源，浏览器只保存可重建 Cache Storage 副本并允许用户删除；这不等于完整离线 PWA。

当前生产允许用户在包含 spelling 的学习/复习启动时选择不限时或 3–300 秒限时，并可先键入翻译。限时仅控制何时自动提交，不改变服务端权威；翻译由 NestJS 先做规范化完全匹配，再对非字面答案使用 OpenRouter 固定结构化 schema 评判，错误直接形成一次 spelling 错误，正确后才开始拼写计时。供应商故障不记错，答案正文不落库，结果无论正误都显示正确英文和拆分翻译。这是单词练习内的窄评判能力，不代表文件 AI 导入或通用生成链路完成。

当前明确未实现：PDF、DOC/DOCX、JSON、Markdown、HTML、图片 OCR/解析；按英语单词/知识点/阅读理解/题库训练选择 prompt；模型结构化输出与人工确认；导入评测集、token/成本和隐私留存。入口必须保持“AI 解析即将推出”，不能接受文件或暗示已调用模型。

后续顺序：持续观察 Courses/分享/市场/Azure 的错误率与成本 → 建文件隔离/扫描/解析管线与人工确认 → 以评测、成本和隐私门开放其他课程类别。

### 3.4 AI 创作与个人笔记（最高优先级）

生产 0041–0043 已实现 Materials 文件生成试卷：所有用户默认 Free，以 Profile IANA 时区的本地日期分别享有 10 次成功生成和 10 次成功主观题评分；reservation 只在成功时消费，拒绝、失败、取消会释放，不读取 credits。真实试卷出现在对应 Materials `courses.id` 下，历史 My Notes 硬编码数据保留在独立 Demo 分组，删除来源可选择移入 Unfiled 或同时删除结果。在线考试支持绝对 deadline、500ms/失焦保存、IndexedDB 弱网草稿、无限重考、客观题确定性判分和整卷一次主观题 AI 评分。

该阶段已于 2026-08-11 完成真实 OpenRouter/ZDR、2G canary、完整 CI、加密恢复点、登录用户生产 smoke 和不可变发布。第一阶段明确不开放知识清单、独立 Quiz、知识图谱、Notes 编辑/PDF 导出、销售 credits 或支付。

一份生成任务可选择一种或多种产物：

1. 知识清单：概念、定义、来源引用、依赖顺序。
2. 交互式测验：题型、答案、解析、难度和来源证据。
3. 知识图谱：节点、关系、布局信息和来源。
4. 模拟试卷：章节、题目、分值、答案与评分标准。

目标流水线：

```text
用户选择资料和生成配置
  → NestJS 鉴权、配额/credits 预留、创建 job
  → BullMQ 排队与限流
  → FastAPI 下载私有资料、解析、分块；必要时调用视觉恢复
  → provider adapter 结构化生成 + 引用/schema Reviewer 质量门
  → 契约校验、结果落库、credits 结算
  → Notification 持久化 + Realtime 推送
  → Notes 页面阅读、编辑、练习、重新生成与导出
```

必须先完成：

- 统一 TypeScript/Python/前端渲染契约，废除当前 mock 的短字段形状或提供显式适配层。
- 定义 `materialId/material_id` 的序列化规范和 OpenAPI。
- 生产已建立 `generation_jobs / notes / note_materials / exams`；0046–0048 候选增加 graph artifact、checkpoint 与 node questions。Knowledge list、独立 quizzes、embeddings/RAG 仍需未来数据模型。
- 为每个生成片段保存材料来源与页码，避免无引用答案。
- 建立幂等键、重试、取消、超时、预算上限、失败退款和质量评测。

### 3.5 Home 与学习闭环

最终 Home 聚合真实的今日任务、连续学习、近期课程、待处理资料、最近笔记、生成任务和活动；不能继续混用 mock credits 与真实 points。

学习闭环应记录：测验作答、薄弱知识点、复习间隔、任务完成和生成质量反馈，并用于后续计划推荐。推荐初期采用可解释规则，数据足够后再引入模型。

### 3.6 社区与内容治理

目标能力：帖子、评论、赞、收藏、转发、关注、标签、媒体、举报、屏蔽、审核队列、申诉、频率限制和反垃圾。

当前社交功能基本可用；生产 0039 已用列级白名单和防御 trigger 收紧作者可信字段，并加入冻结日上限、审核 suppress/restore 和协同待审信号。它不自动处罚、不替代举报/申诉/审核后台，孤儿媒体治理仍未完成。详细规则见[内容审核](governance/CONTENT_MODERATION.md)。

### 3.7 学习计划

目标能力：任务/目标、资料关联、考试倒计时、提醒、重复任务、时区、日历同步、基于薄弱点的可解释排程。

当前有基础任务、目标、连续学习、启发式填充和幂等任务奖励；生产 0039 已增加 goal/task 引用对象 owner trigger、数据库维护 `done_at` 与任务每日奖励上限。后续仍需到期提醒、历史分页和真正的 AI/规则推荐。

### 3.8 市场、钱包、VIP 与支付

目标能力：

- 笔记以 credits 定价和购买；余额由不可变账本派生。
- 法币充值、VIP、官方课程通过 Stripe Checkout/Webhook。
- 创作者收益、平台分成、退款、争议和 Stripe Connect 提现。
- 订单、支付、账本三层分离，全部状态变更幂等、可审计。

`points` 是不可提现的活动成长值，`credits` 是内部消费余额，两者不得互转或共用字段。完整规则见 [积分、钱包、VIP 与支付规则](product/POINTS_CREDITS_VIP_PAYMENTS.md)。

### 3.9 通知、反馈与管理端

目标能力：

- 通知持久化 + Realtime；支持来源跳转、偏好、邮件和计划提醒。
- 反馈只允许用户创建/查看，状态由支持人员处理。
- 管理端覆盖用户、内容、举报、反馈、订单、AI 任务、成本与审计日志。

### 3.10 多平台与国际化

- Web 是首要交付面。
- Electron 在 Web 核心闭环稳定后接入，提供文件选择、系统通知和安全更新。
- React Native/Expo 在 API 与共享业务契约稳定后接入，不直接复用 DOM UI。
- 界面和 AI 输出均支持中文/英文；数据库保存稳定代码值，不保存翻译后的枚举。

## 4. 目标技术架构

```text
Web / Electron / React Native
        │ HTTPS + Supabase JWT
        ▼
NestJS API（业务边界、配额、订单、任务、管理）
        ├── Supabase Auth / Postgres / Storage / Realtime
        ├── Redis + BullMQ
        ├── FastAPI AI Worker ── OpenRouter / future provider adapters
        └── Stripe API / Webhook / Connect
```

原则：

- 简单 owner-only CRUD 可以继续直连 Supabase，但涉及钱、积分、服务端可信字段、跨用户写入、AI 成本和管理权限的操作必须经过受控 API/RPC。
- RLS 是最后一道数据隔离，不替代列级权限、业务校验、幂等账本和速率限制。
- 所有跨语言接口以 OpenAPI/JSON Schema 为源，生成客户端或做契约测试。
- 异步任务必须可观察、可重试、可取消、可去重，且失败不会吞掉 credits。
- 当前生产继续使用 Supabase 云 + 自托管应用；是否迁移 PaaS 或完整自托管由容量和运维成本决定，不再把某一托管商写成已锁定事实。

## 5. 数据域与所有权

最终数据域：

- Identity：`profiles`、roles、preferences、consents。
- Learning source：courses、materials、material_versions、parse_results。
- Knowledge：notes、generated artifacts、citations、embeddings、attempts。
- Learning courses：learning courses/units/words、sessions/items/attempts/progress、review schedules、shares/publications/reports、badge awards、speech usage。
- Planning：goals、tasks、reminders、streak events。
- Community：posts、comments、reactions、follows、reports、moderation actions。
- Commerce：products、orders、payments、credit ledger、creator earnings、payouts、subscriptions。
- Operations：generation jobs、notifications、feedback、audit logs、usage/cost events。

当前 ERD、字段和 RLS 见 [ERD](guides/ERD.md)。任何新表必须明确：数据所有者、读写角色、保留期限、删除行为、审计要求和 RLS 测试。

## 6. 不可妥协的质量门

每个功能只有同时满足以下条件才可标记为“已完成”：

- 有数据库迁移与回滚/前滚说明；RLS 至少用两个用户验证。
- 有 API/契约说明，错误与状态机稳定。
- 有单元或 jsdom 测试；关键用户路径有 E2E。
- CI 运行 code/database lint、typecheck、测试和构建。
- 有日志、指标和告警；涉及外部服务时有超时、重试和降级。
- 涉及个人数据时更新隐私/删除规则；涉及内容时更新审核规则。
- 涉及 AI 时有固定评测集、成本预算、引用和失败策略。
- 涉及 points/credits/支付时使用幂等事件与不可变账本。
- 当前状态文档、API/ERD、CHANGELOG 同步更新。

## 7. 分阶段开发路径

### 阶段 A：安全与可验证基线（立即进行）

目标：在继续加功能前，先让现有真实数据可信、测试可复现、发布可回滚。

- **已实现：**限制 Profile 敏感列、撤销内部 definer 客户端执行权、points append-only 账本/冲正/幂等，以及对应双用户 RLS 回归。
- **已实现：**修复跨账号 legacy 状态、迟到异步响应、resize 重挂、登录/退出 loading 和 Supabase/Storage error 处理；现有 Web jsdom、API 单元测试、双用户 Supabase E2E 与 Courses Playwright 流程共同覆盖新旧边界。
- **已上线：**0039–0040 修复帖子 UPDATE 可信字段、Feedback 状态、goal/task owner 关联与数据库时间字段；兼容期仍接受两个旧时间列但总由 trigger 覆盖。
- **已上线：**0008–0010 已完成受保护生产发布；旧 opening 以追加式等额冲正归零，生产 history、发布断言和最终 dry-run 均通过。
- **已上线：**points 首次决策冻结、每日数量上限、owner 回执、审核 suppress/restore、协同行为待审信号、Redis 滑动窗口、HMAC 滥用审计和管理 API；自动处罚、完整审核 UI 与 webhook 告警不在本阶段。
- **当前发布中止点：**0052–0053 数据库 contract 已通过完整 CI、独立 plan、恢复点、apply 和远端验证上线；最新 main 应用仍因真实 Materials AI PPTX gate 失败而未切流。修复该独立 AI 问题时不得改回时间列 grant，也不得放宽 provider gate。
- 持续维护已落地的 migration 空库重建/RLS E2E、typecheck、jsdom、Courses 浏览器主流程、构建、加密恢复点与应用回退门禁；继续补全旧模块 API HTTP/浏览器 E2E 与 FastAPI 测试。
- 建立数据库发布、备份恢复、密钥轮换、监控告警和安全响应基线。

验收：仓库 P0 回归关闭且 production migration history 可证明已应用；默认 CI 全绿；两用户 RLS E2E 在一次性本地 Supabase 可重复执行；剩余权限项关闭；发布和恢复完成演练。

### 阶段 A+：Courses 受保护发布（2026-08-04 已完成）

- 解析器、jsdom/API、0007 升级、空库迁移、双用户 RLS 和 Playwright 主流程已在 CI 全绿。
- 已完成只读 migration plan、加密恢复点、0011–0038 apply、remote history/lint/dry-run 和不可变应用发布。
- 已开启私有 Courses，并验证跨账号、会话恢复、复习跨日与 points 指纹；真实 Japan East Azure 合成/评分 smoke 成功。
- 分享和免费 Course Market 已开放。后续继续观察错误率、举报阈值、语音配额/成本与数据库增长；回退只关 flags/恢复应用 release，数据库向前修复。

验收结果：Courses 功能迁移发布到 0038，当前生产总 history 已到 0043；Courses 私有路径、幂等弱网答题、音频队列/Storage 去重、历史冷音频 ready 后缓存替换、按意图独立续学与显式取消、限时拼写、翻译前测、中文翻译语音输入/共享波形、轮末错题复盘、拼写/读音考试、任意选词、考试历史、双考试精确掌握投影、Unicode 拼写归一化、仅标点差异容错、未裁剪 WAV 的真实 Azure/OpenRouter/Fish Audio smoke、分享/市场、评分候补池和公网 readiness 均有发布记录；Courses 文件导入仍保持禁用。

### 阶段 B：Materials AI 最小闭环（2026-08-11 已上线）

目标：一份真实 Materials 资料可以生成可引用、可持久化的试卷并在线考试。生产 0041–0043 已实现统一契约、任务/Notes/引用/答卷表、多格式解析、持久队列、DeepSeek/MiMo ZDR、结果校验、队列 UI、真实 My Notes 和 Free quota；不接 credits。

验收结果：PR/main 完整 CI、真实固定 provider suite、220 页近上限资源 canary、只读 plan/加密恢复点/远端验证、flag 关闭 readiness、登录生产用户完整链路和独立公网复核均通过；同一幂等键/operation 不重复额度/结果，失败释放 reservation，任务前后临时目录清理。持续质量、成本、真实复杂文件和 prompt injection 误报率仍需监控。

### 阶段 B+：可恢复长任务、知识点图谱与 Luna 原文件（数据库已发布，应用向前修复中）

- API/worker 采用 202 接收与持久回调，显式 Undici timeout 只保护 transport，不再持有最长 20 分钟 HTTP 响应。
- provider usage 按 UUID 增量持久；数据库 checkpoint 与 worker 0700 本地结果共同支持默认 24 小时 Resume，同一 job、重新预留、成功才 consume。
- Materials 开放 Organize knowledge points；My Notes 渲染 source-ordered graph、hover/detail、节点来源约束问答。Knowledge list 和独立 Quiz 继续禁用。
- Materials/My Notes 保持英文和原有视觉；不把本阶段扩大成全站 React/i18n 重写。
- 图谱使用 React Flow + ELK，提供无重叠分层、pan/zoom、拖动/键盘、外部详情和 revision 跨设备保存；考试只有整卷提交/超时后才统一批改。
- job 支持应用内二次确认的 Delete/Clear history；活动清理必须等 worker 取消网络/Office、落账 usage 并删除临时目录后才消失，已接收任务按规则 consume 一次。
- 能力矩阵允许用户显式选择 DocumentIR、`luna_native_file_v1` 或 `ox_alpha_native_file_v1`。Luna 只对真实门禁的 PDF/图片 allowlist 开放；Ox Alpha 只对其能力元数据声明支持的原始图片开放。两者均 inline 原字节、固定模型、锁定实际上游、要求 ZDR 且禁止 fallback，不静默转换或降级。

验收进度：0046–0051 空库/升级/RLS、fake Chromium、只读 plan、恢复点、生产 apply 和 2G canary已完成。0054–0055 的 Ox Alpha 三流水线扩展仍属 Unreleased。真实 Luna/OpenAI 原文件门禁确认当前无 first-party OpenAI ZDR endpoint；2026-08-23 Ox Alpha ZDR catalog 同样没有合规 endpoint，因此两个原文件子开关都必须保持 false，DocumentIR 仍可独立发布。仍需新的完整 CI、真实 DeepSeek/MiMo、Ox 文本翻译、DocumentIR 应用 release、生产登录 smoke 和独立公网核验。未来只有对应 catalog 合规并跑完逐格式真实门禁后，原文件 pipeline 才能从“已实现但不可用”改为上线。

### 阶段 C：四类产物与学习闭环

- 将候选知识点图谱完成生产观察；继续扩展知识清单和独立 Quiz，试卷保持现有闭环。
- 测验作答/解析、图谱布局、试卷答案与评分标准。
- Home 全部换真数据；基于薄弱点生成计划。
- 分阶段把 legacy 视图替换为类型安全 React 组件。

### 阶段 D：市场、credits、VIP 与 Stripe

- 上架、购买、评分、授权副本。
- 充值订单、Stripe Webhook、不可变 credits 账本。
- VIP entitlement、创作者 70% 默认分成、退款/争议和提现。
- 完成税务、条款、隐私、风控和审计要求后才能启用真实支付。

### 阶段 E：实时、治理与运营

- Realtime 通知、提醒任务、邮件偏好。
- 举报/审核/申诉/屏蔽、反垃圾和管理员工作台。
- SLO、成本看板、AI 质量回归、容量和灾备演练。

### 阶段 F：多平台与内容扩展

- 完整中英双语。
- Electron、React Native/Expo。
- 官方图文/视频/直播课程和推荐系统。
- 是否引入第三方视频/直播服务以独立 ADR 决策。

## 8. 待实现功能总表

| ID | 能力 | 当前 | 目标阶段 | 关键依赖 |
|---|---|---|---|---|
| SEC-01 | Profile 敏感列与内部 RPC 收口 | 已上线 | A | 0008–0010、RLS E2E、2026-07-21 生产发布记录 |
| SEC-02 | 注册限流、邮箱验证、找回密码 | 部分 | A/B | 0039–0040 已上线 Redis IP+email 限流；邮箱验证/找回/CAPTCHA 仍未完成 |
| SEC-03 | 帖子/Feedback/Schedule 完整性与 points 反滥用 | 已上线 | A | 0039–0040、真实 Redis/双用户 RLS/go-no-go，以及 plan `32581192318`、apply `32581805613`、0052–0053 远端验证 |
| QA-01 | jsdom、API、Python、双用户 RLS/Storage 与关键浏览器流程 | 部分 | A/A+ | Web/API/Python unit + CI 本地 Supabase + Courses/Materials AI Playwright；staging 与旧模块 API HTTP/浏览器待补 |
| OPS-01 | DB 发布/回滚、备份、监控、密钥轮换 | 部分 | A | CLI/恢复点/app 回退已实现；Storage bytes、持续监控与演练待补 |
| FE-01 | legacy 跨会话与错误处理修复 | 已实现 | A | 账号切换/resize/error/loading jsdom 回归 |
| LEARN-01 | 英语词表文本创建/编辑、四阶段学习、显式取消、轮末复盘、拼写/读音考试、任意选词与历史 | 已上线 | A+ | React、NestJS、0011–0036；CI/生产已验证 |
| LEARN-02 | 复习熟练度、Schedule/Profile、徽章/+20 points | 已上线 | A+ | 跨日本地日期、指纹幂等；生产已发布 |
| LEARN-03 | 分享、免费课程市场、举报与审核 | 已上线 | A+ | 不可变快照、flags；免费市场已开放 |
| LEARN-04 | Azure TTS/朗读评分适配层 | 已上线 | A+ | fake 自动化 + Japan East 真实供应商 gate |
| LEARN-05 | 限时拼写与语义翻译前测 | 已上线 | A+ | 0019–0020、OpenRouter structured output、真实 provider/生产 gate |
| LEARN-AI-01 | 文件导入、类别 prompt、结构化输出和人工确认 | 未开始 | B | 扫描/OCR/解析、评测、成本、隐私 |
| AI-01 | 试卷统一生成契约、任务/额度/Notes/答卷 | 已上线 | B | 0041–0043；真实 provider/canary/生产门禁已完成 |
| AI-02 | Materials 确定性解析、视觉恢复和引用 | 已上线 | B | FastAPI DocumentIR/DeepSeek/MiMo；embedding/pgvector 不在首版 |
| AI-03 | Materials 知识图谱与节点问答 | 候选已实现，未上线 | B | 0046–0051 + AI-01/02；待 CI、真实 provider、受保护发布 |
| AI-04 | Knowledge list / 独立 Quiz | mock | C | AI-01/02；仍 Coming soon |
| AI-05 | 长任务增量 usage 与断点续跑 | 候选已实现，未上线 | B+ | 本地单元已通过；真实 Supabase/provider/生产门禁待完成 |
| AI-06 | Luna 原文件、任务删除/清空、跨设备图布局 | 候选已实现，未上线 | B+ | 0049–0051；需逐格式真实 OpenAI gate、RLS、250 节点 Playwright 与受保护发布 |
| NOTE-01 | Notes CRUD、编辑、版本和导出 | 部分 | B/C | 私有试卷查看/删除/考试已实现；编辑/版本/PDF导出待完成 |
| HOME-01 | 首页真实聚合 | mock | C | Notes/Tasks/Usage |
| PLAN-01 | 到期提醒与薄弱点排程 | 部分 | C/E | Realtime/cron |
| COM-01 | 举报、审核、屏蔽、反垃圾 | 部分 | E | points 协同信号/审核 API 已上线；内容举报、申诉、屏蔽和完整管理端仍未完成 |
| PAY-01 | credits 账本与订单 | 仅字段 | D | 产品规则、API |
| PAY-02 | Stripe/VIP/退款/Connect | 未完成 | D | PAY-01、合规 |
| RT-01 | Realtime 通知 | 未完成 | E | 通知来源字段 |
| ADMIN-01 | 管理后台与审计 | 未完成 | E | roles、audit logs |
| I18N-01 | UI 与 AI 双语 | 未完成 | F | i18n 包、契约 |
| DESKTOP-01 | Electron | 未开始 | F | 稳定 Web/API |
| MOBILE-01 | React Native/Expo | 未开始 | F | 稳定共享契约 |
| COURSE-01 | 官方课程 | 未开始 | F | 支付、媒体供应商 |

状态只允许使用：`未开始 / 桩 / mock / 部分 / 已实现 / 已验证 / 已上线`。其中“已验证”必须链接到可执行测试，“已上线”必须有部署和监控证据。

## 9. 开放决策

以下事项不得在实现前默认为已锁定：

- ExamPass-Assistant 的商业授权；未取得授权只能方法论参考并干净重写。
- embedding 模型与供应商、图谱布局方案、富文本编辑器。
- 视频/直播供应商。
- VIP 权益细目和官方课程是否允许 credits 支付。
- Electron/RN 的离线范围。
- PaaS、自托管或混合部署的长期选择。

每项落定后新增 ADR，并在本文件删除“开放”标记。

## 10. 配套文档与更新责任

- 当前实现：[ARCHITECTURE.md](ARCHITECTURE.md)
- 数据：[ERD](guides/ERD.md)、[数据库发布与回滚](operations/DATABASE_RELEASE_ROLLBACK.md)
- 接口：[API](guides/API.md)
- 开发与测试：[本地开发](guides/LOCAL_DEVELOPMENT.md)、[测试指南](guides/TESTING.md)
- 安全与隐私：[SECURITY](../SECURITY.md)、[隐私与数据删除](governance/PRIVACY_AND_DATA_DELETION.md)
- AI：[评测与成本](ai/EVALUATION_AND_COST.md)
- 商业规则：[points/credits/VIP/支付](product/POINTS_CREDITS_VIP_PAYMENTS.md)
- 变更记录：[CHANGELOG](../CHANGELOG.md)、[ADR](adr/README.md)

产品负责人维护范围和优先级；技术负责人维护架构与质量门；模块作者在合并功能时同步 ERD/API/测试/CHANGELOG；运维负责人在基础设施、密钥、告警或恢复流程变化时更新操作手册。
