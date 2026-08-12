# ADR-0013：Materials AI 异步回调、双层断点与知识图谱

> **本文内容：**记录 Materials AI 从长连接内部 HTTP 改为快速接收/持久回调、数据库与 worker 本地双层断点，以及知识点图谱和节点问答契约的决定。
>
> **作用：**固定长任务、成本审计、可恢复执行、临时文件、知识图谱渲染和节点提问的安全边界，避免再次依赖单个五分钟以上的 HTTP 响应。
>
> **何时更新：**内部任务协议、lease/TTL、checkpoint 位置、provider usage、图谱 schema/布局、节点问答额度或临时数据生命周期变化时。

- **状态：**Accepted / deployed；0046–0048 与不可变应用已于 2026-08-12 完成受保护生产发布。
- **日期：**2026-08-12
- **决策者：**Nalanda owner

## 背景

0041–0043 的 API 会等待 FastAPI 完成整份文件。一次真实任务在 MiMo 视觉恢复后超过约 300 秒，Node 20 内置 Undici 在 worker 返回响应头前触发默认 headers timeout；代码设置的 20 分钟 `AbortSignal` 没有覆盖该 transport timeout，错误又被统一误报为 worker unreachable。连接断开还会使已发生的 provider usage 无法进入账本。

同时，知识点梳理需要把完整材料转成按来源顺序、可直接渲染且每个节点可深入提问的图，而不是复用历史 Demo 数据或试卷 schema。

## 决策

1. NestJS 使用显式 Undici `Agent`，分别设置 connect、headers 和 body timeout，并保留稳定的 `AI_WORKER_TIMEOUT` 与 `AI_WORKER_UNREACHABLE`。兼容同步路由继续存在于观察窗口，但生产任务只向 `/internal/materials/jobs`、`/internal/exams/jobs` 提交并在 30 秒内取得 202。
2. PostgreSQL 继续是 job、quota、lease、progress、result 与 usage 的唯一服务端事实源。FastAPI 通过内部 token 回调 progress、usage、checkpoint、complete/fail；每个 usage event 有 UUID，重复回放只记一次。
3. 数据库 checkpoint 保存 `parsed → audited → document_ready → artifact_ready/answer_ready`，默认 24 小时。可恢复错误释放原 reservation；用户在期限内对同一 job Resume 时重新预留额度并从最后验证阶段继续，不创建替代 job。成功才 consume。
4. worker 在同一 0700 job 目录另保存短期 `resume-checkpoint.json` 与 usage spool。先写本地结果，再调用 API；回调中断时保留，下一 lease 优先选择更高阶段。终态立即删除，orphan 超过 TTL 由 sweeper 删除。它是可重建过程数据，不进入备份。
5. 供应商调用后的 usage 先落本地 spool；任务完成或失败回调前必须 flush。主观题评分的已验证结果同时保存到 worker 本地和私有 DB TTL checkpoint，避免回调中断或容器替换后再次付费评分。
6. 知识图谱使用 `GeneratedKnowledgeGraphV1`：1–250 个按 `sourceOrder` 排序的详细节点、0–1000 条 typed edge、严格 source refs、解释/例子/公式/误区/自测。图谱保存在 Materials 对应 My Notes；旧 Demo 不参与真实结果。
7. BullMQ 的单并发槽必须持有到 Postgres 显示任务终态或 lease 到期；FastAPI 的快速 202 不能被误解为任务完成，否则 backlog 会进入进程内存等待并提前耗尽租约。生成和评分分别有 1200/240 秒总执行预算；生成总预算到期是可恢复错误。
8. 节点问答只接收服务器读取的节点、相邻节点与这些节点共同引用的 source blocks；用户问题是不可信数据，不能改模型、工具、schema 或安全策略。答案只能引用该来源并集。每次成功答案计入同一 Free generation 日额度。
9. Materials 与 My Notes 在本阶段固定使用现有英文视觉和文案，不随全局中文 locale 注入中文字符串；不借此进行更大的 React/视觉重写。

## 结果与取舍

- 内部 HTTP 不再承载 20 分钟业务生命周期，五分钟响应头超时不再终止正常生成。
- 双层断点让数据库回调正常时可跨 worker 恢复，API 短时不可达时也不会立即丢失已付费结果；代价是 TTL 内临时目录会短期包含私有 DocumentIR/产物，必须保持 0700、磁盘水位和清理告警。
- 断点只保存通过当前 schema/安全校验的阶段结果。版本不兼容、期限届满、非重试错误或安全拒绝会清理并要求新任务。
- 图谱布局首版使用来源顺序和层级定位，保证可读与确定性；自动布局、跨材料合并和通用 RAG 不在本决策内。

## 发布记录

独立只读 plan `31573329799` 证明远端已到 0048且 dry-run 为空；受保护 run `31574116130` 创建加密恢复点并通过完整 CI、本地真实 Supabase/RLS、fake-provider Chromium、2G canary、真实 DeepSeek/MiMo/Azure/OpenRouter/Courses、登录用户 Materials AI 完整链路及独立公网/服务器核验。release `3c095a55ced21cee11a1b3131dd2889ec1f70733-31574116130-1` 已启用 `FEATURE_MATERIAL_AI=true`。fake Chromium 不构成真实模型证据，单次供应商 smoke 也不替代持续质量与成本监控。

## 验证与发布

- Python 覆盖 202 快速接收、总执行超时、callback outage、usage/result replay、换 lease、短 TTL 清理、部分视觉恢复、图谱验证和相邻节点来源问答；API 覆盖 Undici 错误分类、成本/回调、队列槽保持和 retry；jsdom 覆盖英文菜单、Resume、图谱 hover/click/Q&A。
- 0046–0048 必须通过 0007→latest、空库重建、lint、双用户 RLS：客户端不能执行内部 RPC/读取 checkpoint/写问答，重复 usage 不重复计费，过期重试真实清理。
- fake Playwright 覆盖文件→试卷→评分→图谱→节点问答→删除；真实 gate 另外验证固定 DeepSeek/MiMo、ZDR、source order、usage ledger 与公网登录用户链路。
- 发布仍遵循 flag 关闭启动、只读 plan、加密恢复点、迁移 apply、资源 canary、真实 provider、开启 flag 和独立公网 smoke；数据库只 forward-fix，应用回退不可变 release。
