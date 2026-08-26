# ADR-0015：Ox Alpha 翻译判定与 Materials 原始图片流水线

> **本文内容：**记录 Courses 非字面翻译模型切换为 Ox Alpha，以及 Materials AI 增加第三条 Ox Alpha 原始图片流水线的架构决定。
> **作用：**固定模型、provider、reasoning、能力矩阵、ZDR、隐私、完成事务和发布门禁，避免把文本可用性误写成原文件能力。
> **何时更新：**Ox Alpha 模型身份/能力/价格、Stealth 路由、reasoning、ZDR catalog、允许格式、翻译数据边界或生产发布状态变化时。

- **状态：**Accepted / implemented in unreleased code；0054–0055 尚未完成受保护发布
- **日期：**2026-08-23
- **决策者：**Nalanda owner
- **范围：**Courses、Materials、My Notes、NestJS、FastAPI、Supabase、发布门禁
- **关联：**[ADR-0009](0009-server-side-semantic-spelling-translation-assessment.md)、[ADR-0014](0014-materials-ai-luna-native-lifecycle-and-graph-layout.md)

## 背景

Courses 的非字面翻译判定原先固定使用 Gemma 4 免费模型，最近受保护候选多次在真实 smoke 中持续 HTTP 429 并在切流前回退。用户明确决定将它更换为 OpenRouter `stealth/ox-alpha`，并要求 Materials AI 在既有 DocumentIR 与 Luna 之外增加同模型的多模态路径。

实时模型元数据声明 Ox Alpha 接受 text/image/video，但没有 file modality；endpoint 的 provider 为 Stealth。实时 ZDR catalog 当前没有该模型 endpoint。模型还要求 reasoning，不能沿用 Luna 的 reasoning-disabled envelope。因此必须把“文本翻译可调用”和“ZDR 原文件处理可开放”作为两个独立门禁。

## 决策

1. Courses 非字面翻译固定使用 `stealth/ox-alpha`。请求强制 `provider.only=["stealth"]`、`allow_fallbacks=false`、`data_collection=deny`、strict `{correct:boolean}`、no tools，并使用 `{effort:"low",exclude:true}` reasoning。客户端不能选择模型、provider、prompt 或参考翻译。
2. 规范化完全匹配仍由 NestJS 零 token 确定性判对；Ox 只判断非字面同义/改写。供应商结果不能直接授予 points、徽章或改 progress。
3. Materials 增加显式 `ox_alpha_native_file_v1`，复用 Luna 的原字节下载校验、安全审查、生成、一次修复、checkpoint、取消和清理编排，但固定 Ox Alpha/Stealth。
4. Ox Materials pipeline 只接受 PNG、JPG/JPEG、WebP 原始图片。API 与 worker 都把运维 allowlist 和代码内图片集合取交集；PDF、Office、Markdown/HTML/TXT/JSON/CSV 不转换、不提取后冒充原文件，也不静默降级。
5. Materials Ox 继续要求 ZDR、deny collection、strict schema、no tools/Web 和 no fallback。实时 catalog 没有合规 endpoint 时 `FEATURE_MATERIAL_AI_OX_ALPHA=false`，capability 返回 `OPENROUTER_ZDR_UNAVAILABLE`；不能以 Courses 文本 smoke 代替。
6. `ai_provider_usage_events` 记录实际 provider/endpoint/pipeline；完成试卷、图谱、节点问答和主观评分的 service-role 事务要求匹配用途的 Stealth usage。路由违规已发生的成本保留，但产物不得保存。
7. 0054–0055 只追加 pipeline constraint、工作流映射、完成约束与权限验证；旧 RPC 签名及 DocumentIR/Luna 行为继续兼容上一不可变应用。数据库回滚只 forward-fix。

## 后果

### 正面

- 移除 Gemma 免费路由持续限流这一发布硬门，同时保留服务端权威和幂等配额边界。
- Materials 得到第三条真正显式、可审计的多模态图片路径，不把模型营销标签扩张成未证明的文件格式支持。
- provider、reasoning、ZDR 和完成事务形成两层失败关闭；fake 测试无法冒充真实 Stealth/ZDR 证据。

### 风险与代价

- “Stealth” provider 与模型身份、价格或可用性可能变化；即使当前目录价格为零也不能承诺永久免费。
- Ox 原图当前因无 ZDR endpoint 预计保持关闭；代码完成不等于产品可用。
- 三流水线增加 UI、环境变量、迁移、RLS、真实供应商 gate 和监控复杂度。
- mandatory reasoning 会增加延迟/token；本次使用 low 且排除输出，仍需真实延迟与质量基线。

## 验证与发布

- 单元/API/jsdom 验证 capability/default、原始图片字节、非图片拒绝、Stealth-only、reasoning、schema、注入、checkpoint 和翻译判定。
- 本地 Supabase 双用户 E2E 验证客户端不能创建/完成 Ox 任务或伪造 provider usage，service-role 完成只有匹配 Stealth usage 才成功。
- 真实文本 gate 使用固定同义/无关双样本；Materials gate 先读取实时 ZDR catalog，合规后才用无个人数据图片验证实际 Stealth、原始 SHA-256、注入拒绝和零残留。
- 生产遵循只读 0054–0055 plan、加密恢复点、apply、不可变 candidate、真实门禁、私有 smoke、切流和独立公网验证。任一硬门失败都保持 Ox Materials flag 关闭并恢复上一应用 release。

## 2026-08-25 输出契约修订

PR #77 已把 0054–0055 应用到生产数据库，但应用候选的 Courses 翻译门因 Ox Alpha endpoint 不声明 `structured_outputs`、而请求又使用 strict `json_schema` + `require_parameters=true`，收到 HTTP 404并自动回滚。决策修订为使用 endpoint 明确声明支持的 `response_format:{type:"json_object"}`；system prompt 固定唯一对象形状，NestJS 与真实 release smoke 本地严格检查字段集合、boolean 类型、case ID/数量和预期语义。Stealth-only、禁止 fallback、data collection deny、实际 provider 校验、服务端幂等事实与失败关闭不变。供应商 HTTP 错误只记录稳定状态/code/request ID，不记录正文或用户内容。
