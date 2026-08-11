# ADR-0012：Materials AI 持久队列、OpenRouter ZDR 与 2G Office 渲染

> **本文内容：**记录 Materials 文件生成试卷采用 PostgreSQL 持久任务、BullMQ 调度、隔离 FastAPI、OpenRouter ZDR 和受限 LibreOffice 全量渲染的决定。
>
> **作用：**固定任务事实、模型/隐私、安全解析、资源故障和 Free quota 的服务边界，避免把 Redis、客户端进度或临时文件当权威。
>
> **何时更新：**队列/worker 拓扑、parser、模型/provider/ZDR、资源上限、配额/收费、临时或持久数据生命周期、发布门禁变化时。

- **状态：**Accepted；0041–0043 已进入生产数据库，2G canary 已通过；应用因真实 provider gate 失败仍回滚关闭。
- **日期：**2026-08-10
- **修订：**2026-08-11 明确启用同一固定模型的合规 provider failover；不增加跨模型 fallback。
- **决策者：**Nalanda owner

## 背景

Materials 已保存用户私有课程文件，但历史 FastAPI 只返回固定 mock。第一阶段只需“Generate test paper”，同时要求多格式确定性解析、仅失败范围视觉恢复、prompt injection 拒绝、任务进度、在线考试、成功才消耗的每日免费额度，以及 2G 同机服务器上严格清理和资源隔离。

Redis 可能重启或丢队列项；模型可能超时、返回坏 JSON或没有满足 ZDR 的端点；LibreOffice 全量渲染可能接近主机内存上限。因此这些依赖都不能直接成为任务、额度或结果事实源。

## 决策

1. PostgreSQL 保存 `generation_jobs/events`、quota reservation、Notes、答卷、幂等 operation 和 provider usage；BullMQ 只保存 job UUID。reconciler 重投 DB 中缺失的 queued/过期 lease，同一个 idempotency key 不重复预留、生成或保存。
2. NestJS 从已验证 JWT 派生 user ID、校验 material owner/格式/大小、创建短期 private Storage signed URL，并只通过独立 internal token 调用 FastAPI。所有状态写入经 service-role-only事务 RPC；浏览器不能调用内部 RPC、决定分数或提供模型/key。
3. FastAPI 先生成 `DocumentIR`。DeepSeek 审查文本完整性与注入，解析器失败与审查失败范围取并集；只把这些渲染区域交给 MiMo。拼接后再次安全审查，再由 DeepSeek 生成/最多修复一次严格 `GeneratedExamV1`。
4. 固定 `deepseek/deepseek-v4-flash-0731` 与 `xiaomi/mimo-v2.5`。所有请求要求 ZDR、deny data collection、require parameters，关闭 reasoning/tool/Web 且不提供跨模型 `models` fallback；禁用可选 reasoning 确保 completion 预算用于 strict JSON，而非返回/隐藏思维链。同一固定模型按吞吐量优先在仍满足所有隐私与参数过滤器的 provider endpoint 间故障转移；没有合规 endpoint 即失败，不静默路由到留存 provider或不同模型。
5. `malicious` 或 `uncertain` 注入都拒绝；`benign_educational` 仅用于明确教学/引用/安全分析。模型分类不是唯一边界，前后仍有格式/资源、strict schema、source refs 和产品约束。
6. DOCX/PPTX 全量低优先级渲染，以保留任意失败范围恢复能力；MiMo 仍只接收失败范围。生产 worker 单并发、640MiB RAM/896MiB mem+swap、0.75 CPU、128 pids，LibreOffice 120秒硬超时；触发 OOM/邻站影响时保持 flag 关闭。
7. 每任务使用 0700 临时目录，成功、失败、取消、超时均在 `finally` 删除；启动/定时清理超过一小时 orphan，并设置单 job 1GiB 与最小空闲 512MiB。私有版本化 `ai_material_parse_cache` 是明确的持久产品数据，不混入临时目录。
8. 第一阶段所有用户 Free，每个 Profile 本地日分别 10 次成功生成和评分。reservation 只在成功时 consume；失败/拒绝/取消 release。全局默认 US$20/月，单生成 US$0.50、评分 US$0.05；不使用 credits、points、VIP 或支付。

## 结果与取舍

- Redis 故障不会丢任务/额度，但恢复可能增加队列等待；PostgreSQL lease 与 reconciler 增加实现复杂度。
- 只视觉恢复失败范围降低隐私、成本和延迟；Office 全量渲染仍是用户接受的 2G 高风险选择，必须以 canary 而非配置文件宣称可用。
- ZDR/strict schema/双审查显著收窄风险，却不能保证绝对消除注入、幻觉或供应商行为变化；必须保留 kill switch、固定 eval 和人工问题反馈。
- 同模型 provider failover 避免单一 endpoint 的 429/5xx 直接阻断任务；量化方式、延迟和价格仍可能因 endpoint 不同而变化，因此每次都受 strict schema、ZDR、参数过滤及单 job/月成本硬门约束。
- owner 可以在自己的 Notes detail 查看完整答案。考试 session 隐藏 answer key 只防止正常 UI 提前泄题，不是对资料所有者的防作弊安全系统。

## 验证与发布

- CI：Python ruff/pytest、Nest API/真实 Redis BullMQ、0041–0043 空库/升级/lint/双用户 RLS、Web jsdom、fake-provider Playwright、AI Docker 与发布脚本测试。
- 真实 gate：无个人数据 PDF/DOCX/PPTX/chart/injection/safe lesson/grading，验证失败范围、ZDR、strict JSON、source refs、token/cost和注入拒绝/正常教材不误杀。
- 资源 gate：近上限 Office fixture 记录 RSS、swap、队列、临时盘及邻站健康；kernel OOM、邻站失败或持续不可接受 swap 即 no-go。
- 生产：只读 plan → 加密恢复点 → apply 0041–0043 → `FEATURE_MATERIAL_AI=false` 启动 Redis/AI/API → readiness/清理/canary/真实 provider → 开 flag → 登录用户公网 smoke。应用异常恢复不可变 release并关 flag；数据库只 forward-fix。
