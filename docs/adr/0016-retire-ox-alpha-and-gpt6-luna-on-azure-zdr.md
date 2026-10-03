# ADR-0016：退役 Ox Alpha，Luna 升级为 GPT-6 Luna（Azure ZDR），翻译判定改用免费 Nemotron

> **本文内容：**记录移除 Ox Alpha 全部用途、把 Materials Luna 原文件流水线升级为 `openai/gpt-6-luna` 并锁定 Azure ZDR 上游，以及 Courses 非字面翻译判定改用 OpenRouter 免费 Nemotron 的架构决定。
> **作用：**固定模型、provider、ZDR、数据库完成约束和发布门禁，替代 ADR-0015，并修订 ADR-0014 的 OpenAI-only 路由。
> **何时更新：**GPT-6 Luna 的 ZDR endpoint/provider、免费翻译模型可用性或数据策略、0056–0057 发布状态变化时。

- **状态：**Accepted / implemented in unreleased code；0056–0057 尚未完成受保护发布
- **日期：**2026-10-03
- **决策者：**Nalanda owner
- **范围：**Courses、Materials、My Notes、NestJS、FastAPI、Supabase、发布门禁
- **关联：**[ADR-0009](0009-server-side-semantic-spelling-translation-assessment.md)、[ADR-0014](0014-materials-ai-luna-native-lifecycle-and-graph-layout.md)、替代 [ADR-0015](0015-ox-alpha-translation-and-native-image-pipeline.md)

## 背景

- Ox Alpha（`stealth/ox-alpha`）已从 OpenRouter 实时模型目录下线，且 0054–0055 期间从未在生产启用（Materials 无 ZDR endpoint；Courses 翻译因输出契约 HTTP 404 回滚）。生产数据库中没有任何 `ox_alpha_native_file_v1` job、Note 或 usage 行。
- ADR-0014 把 Luna 固定为 `openai/gpt-5.6-luna` + `provider.only=["openai"]` + ZDR。实时 ZDR catalog 从未包含 first-party OpenAI endpoint，所以 Luna 每次发布都只能保持关闭。
- 2026-10-03 实时目录：`openai/gpt-6-luna` 接受 file/image/text，支持 structured outputs 与 reasoning；它的 ZDR endpoint 只有 Azure（`azure`、`azure/us`、`azure/eu`），OpenAI first-party endpoint 仍不在 ZDR catalog 中。
- Courses 翻译判定需要一个替代 Ox Alpha 的模型。owner 决定使用 OpenRouter 免费模型。

## 决策

1. **完全移除 Ox Alpha。**代码、类型、UI、环境变量、发布门禁与 smoke 不再出现 `ox_alpha_native_file_v1`/`stealth/ox-alpha`。0056 把三张 pipeline constraint 和全部 service-role RPC 收敛回 `document_ir_v1`/`luna_native_file_v1`；旧 `FEATURE_MATERIAL_AI_OX_ALPHA*` 键在安装/激活/回滚时被剥离而不再写入。
2. **Luna 固定 `openai/gpt-6-luna` 与 Azure。**worker 请求 `provider.only=["azure"]`、`allow_fallbacks=false`、ZDR、deny data collection、require parameters、strict schema、reasoning off、no tools/Web；usage 把上游规范化为 `Azure`。0056 的完成 RPC 要求 Luna 的 safety/generation/question/grading usage 都是同模型且 `upstream_provider='Azure'`，first-party `OpenAI` 上游视为路由违规（费用保留、产物拒绝）。
3. **原文件边界不变。**PDF 继续 inline `type:file` + `file-parser.native`，图片 inline `image_url`；不运行 parser/OCR/LibreOffice/DocumentIR/parse cache，不使用 Files API；格式 allowlist 默认仍为 `pdf,png`。
4. **发布门禁改读 Azure。**真实 provider gate 读取 ZDR catalog，只有存在 `openai/gpt-6-luna` + `provider_name=Azure` 时才跑 Luna 原文件 fixture 并允许 `FEATURE_MATERIAL_AI_LUNA=true`；否则保持关闭并返回 `OPENROUTER_ZDR_UNAVAILABLE`。DocumentIR 发布与 Luna 开关相互独立。
5. **翻译判定改用 `nvidia/nemotron-3-super-120b-a12b:free`。**请求锁定 `provider.only=["nvidia"]`、`allow_fallbacks=false`、`require_parameters=true`、JSON Object + 本地严格 `{correct:boolean}` 校验、`reasoning.enabled=false`、no tools；响应 provider 必须是 Nvidia。确定性完全匹配、服务端权威、幂等配额和不持久化原答案保持 ADR-0009 不变。
6. **翻译请求不再声明 `data_collection=deny`。**免费 endpoint 可能记录提示词；请求只含英文词、参考译文和学习者答案，不含账号标识。若 owner 需要拒绝数据收集，必须改用付费模型并更新本 ADR。
7. 0056–0057 只替换函数体与约束，不改 RPC 签名，保持对上一不可变应用兼容；数据库回滚仍只 forward-fix。

## 后果

### 正面

- Luna 在保持 ZDR 的前提下第一次具备真实可用的 endpoint；GPT-6 Luna 单价约为 GPT-5.6 Luna 的一半。
- 移除一个已下线模型和一整条从未启用的流水线，减少 flag、门禁与监控面。
- 翻译判定零 token 成本，且使用声明 structured outputs 的单一 endpoint。

### 风险与代价

- Azure 是唯一 Luna ZDR 上游；它若下线或不再声明 ZDR，Luna 自动保持关闭，DocumentIR 不受影响。
- Azure 托管下 PDF native file 输入需由真实门禁证明；门禁失败会阻断整次应用发布并自动回滚，需要缩小 `MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS` 或修复后重试。
- 免费模型可能限流、下线或改变数据策略；持续 429 会让翻译前测返回“繁忙”，发布 smoke 失败会阻断切流。
- 免费 endpoint 的数据策略弱于此前 Ox 请求声明的 deny collection。

## 验证与发布

- Python/API/jsdom 单元测试覆盖 Azure 路由锁、OpenAI 上游违规、Ox pipeline 拒绝、Nemotron 请求体与 provider 校验。
- 本地 Supabase RLS E2E 证明 Ox pipeline 无法创建 job/usage、Luna job 使用 `openai/gpt-6-luna`，且 OpenAI 上游 usage 会阻断完成。
- 生产按只读 plan → 加密恢复点 → 0056–0057 apply/验证 → 不可变 candidate → 真实 DocumentIR/Luna/翻译门禁 → 私有 smoke → 切流 执行；任一硬门失败都恢复上一应用 release。
