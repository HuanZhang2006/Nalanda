# AI 评测与成本治理

> **本文内容：**定义课件解析与四类 AI 产物的契约、离线/在线评测、安全测试、成本核算、预算控制、模型发布与回滚。  
> **作用：**让 AI 质量、幻觉、安全、延迟和单位经济性可量化，防止“接口能返回”被误认为可收费、可公开的 AI 产品。  
> **何时更新：**模型/供应商、prompt、parser/OCR、分块/RAG、schema、评测集、质量阈值、价格、credits 规则或发布流程变化时；发生质量/隐私/费用事故后立即更新。  
> **状态基线：**2026-08-04。FastAPI 生成仍是固定桩；Courses 文件 AI 导入也未实现。Azure Speech、OpenRouter 语义翻译前测和 Fish Audio 中文 STT 已随 0038 生产启用。生产 Web/API 已移除客户端 VAD/静音裁剪并保持 WAV 字节原样转发 Azure；STT 复用同一未裁剪 16 kHz PCM WAV 采集器。翻译前测、读音评分和 STT 都是窄能力，不能冒充生成式 AI/文件解析闭环。

## 1. 范围和非目标

范围包括 PPT/PPTX、DOC/DOCX、PDF、JSON、Markdown、HTML、TXT、图片 OCR 的解析；Courses 按英语单词/知识点/阅读理解/题库训练选择 prompt 和结构化输出；以及知识清单、测验、知识图谱、模拟试卷。评测覆盖模型、parser/OCR、chunk/retrieval、schema validator、post-processing、人工确认和渲染。Azure Speech 与 OpenRouter 拼写翻译前测作为独立、窄用途的供应商适配层单列治理。

本文不承诺模型绝对正确，不用单一“准确率”掩盖不同错误，也不把供应商基准当 Nalanda 产品评测。费用数字来自运行时价格快照与账单，而不是写死在本文的易过期网页价格。

## 2. 当前事实与启用限制

当前代码可验证：

- FastAPI 有 `/health`、`/parse`、`/generate/knowledge-list|quiz|graph|exam`；
- `requirements.txt` 列出 Anthropic 和解析依赖，但依赖存在不代表已调用；
- `ANTHROPIC_API_KEY` 只影响 health 中的 `configured/unset` 字段；
- generation 函数忽略资料正文并返回固定 Pydantic 对象；
- TypeScript 与 Python 的请求字段命名存在 camelCase/snake_case 差异，Web 也没有真实消费该契约；
- 当前生产 compose 不包含 AI 服务，NestJS 没有 AI 模块、job 或服务间调用。
- Courses UI 虽列出 PDF/Word/JSON/Markdown/HTML/图片，但入口只显示“AI 解析即将推出”，不会选择/上传/解析文件或调用模型；当前词表只支持用户粘贴并人工编辑确认。
- Azure Speech 的 Nest adapter、WAV 限制、配额/估算成本、熔断、持久队列和 private Storage 事实源已经在生产启用；生产 Web 已移除客户端 VAD/静音裁剪，fake tests 仍只证明代码路径。该能力只做 TTS/朗读反馈，不解析文件、不生成课程、不扣 credits。
- 0019 增加 NestJS 翻译评判 adapter：规范化后完全等于服务端参考 translation 的答案由服务端确定性判对；非字面同义/改写才使用 OpenRouter structured JSON。输入正文不落库，服务端仍唯一写 spelling 错误事实。生产已取得真实 provider、候选 API 与不可变 release 证据。

因此当前不得：收费扣 credits；把 placeholder 或文件入口标为已生成/已解析；把 Azure TTS 当成课程 AI 导入；把 health/key/fake 当真实供应商可用；用真实私有课件/录音做非受控测试；公开承诺准确率/成本/延迟。

### 2.1 Courses 文件导入的目标闭环（未实现）

目标输入：PDF、DOC/DOCX、JSON、Markdown、HTML 和受控图片。文件先进入按用户隔离的 quarantine，服务端检查扩展名、MIME、magic bytes、大小/页数/像素、压缩炸弹和恶意内容，再解析/OCR；浏览器不能把原文直接送供应商，也不能让模型使用 service-role 或任意网络工具。

类别路由必须显式版本化，不能用一个含糊 prompt 兼容四类：

| 类别 | 首个结构化目标 | prompt/评测重点 |
|---|---|---|
| `english_vocabulary` | units → `term/translations[]`，可选 source/confidence；IPA 仍优先由 CMUdict/人工补 | 不拆坏短语、多义翻译、单元边界、重复、来源忠实 |
| `knowledge_points` | 知识点、定义、标签、顺序、来源 | groundedness、遗漏、依赖顺序 |
| `reading_comprehension` | 原文段落、问题、答案/证据、难度 | 引文范围、答案唯一性、版权展示 |
| `question_bank` | 题干、题型、选项、答案、解析、来源 | 答案一致、干扰项、重复与学术诚信 |

英语词表建议的版本化 JSON Schema 至少包含：`schemaVersion,category,sourceFileId,units[{suggestedName,sourceRange,words[{term,translations,sourceRange,confidence,warnings[]}]}],parseWarnings`。模型不得生成数据库 ID、owner、progress、points、publication 或可执行 HTML。输出先通过 schema、产品上限、重复/Unicode/XSS、来源对齐检查，再进入与文本导入相同的结构化编辑器；用户逐项确认后才调用整课保存事务。无人工确认不得创建课程、排日程、发布市场或发成长奖励。

文件原文、OCR 临时图、prompt 和模型输出按 job 使用最短留存；普通日志只留 hash/内部 ID/版本/计量。删除课程或账号时必须覆盖 quarantine、临时文件、OCR、模型 cache、job payload 和供应商副本。任何把用户文件加入 eval/golden set 的行为都需要单独、可撤回授权。

### 2.2 Courses 导入评测与成本门

固定评测集按格式、数字/扫描、单元有无、表格/多栏/图片、词/短语、多翻译、中英混排、坏格式和恶意提示词分层。核心指标：

- term 精确率/召回率/F1、phrase 边界、translation 集合精确/召回、unit boundary F1；
- source range 有效/支持率、无来源新增词/翻译率、规范化重复率、schema/产品上限通过率；
- 人工接受/编辑/删除率、每百词严重错误、按格式失败率、XSS/提示词注入成功数；
- 每成功导入文件/页/图片/千字/确认词的 token、OCR/vision、重试、存储/egress 成本和 P50/P95 延迟。

初版上线门：schema 与安全边界 100%；跨用户/secret 泄露和成功 prompt injection 为 0；无来源新增严重词义为 0；term F1 与 translation F1 的正式阈值必须由授权 golden baseline 后写入版本化配置；成本估算需覆盖 token、OCR/vision 页和重试，P90 相对账单误差≤20%。未建立样本量/阈值前只能内部 alpha，不能通过“看起来不错”开放文件按钮。

运行时先估算最大页/图片/token/费用，让用户确认；超限拒绝或缩小范围，不事后无限扣 credits。v1 文本手工导入免费，未来 AI 导入是否收费须先接 credits hold/commit/release 和失败退款，points 绝不用于支付。

### 2.3 Azure Speech 当前边界

Speech 不是上述生成管线。TTS 仅发送当前英文 term，评分仅发送 server-derived reference text 与用户主动录制的 PCM WAV；客户端最多录制 6 秒，关闭 echo cancellation、noise suppression、auto gain control，不做 VAD、音量阈值、最短语音判断、首尾裁剪或内容截断，只执行 Azure 契约所需的 16 kHz/16-bit/单声道 PCM 格式转换。服务端继续限制 8 秒/2 MB，并把验证后的同一 WAV 字节转发 Azure。不发送课程名、翻译、邮箱或学校。录音在响应后丢弃，只有分数/错误类型/音素反馈保存；供应商失败不计学习错误。

评分的持久控制是每用户默认 30 次/分钟、300 次/本地日、全局月估算 budget 和 circuit flag；读音考试不会获得独立免费额度，每个实际提交的考试词都会占用同一 assessment 额度和预算，因此开放前必须用“活跃考生 × 单元词数 × 候补率”重新核算容量。`learning_speech_usage` 的 micro-USD 是配置价格乘用量的预算预留，不是 Azure 账单事实。TTS 队列按 `SHA-256(normalizedTerm + locale + voice + format + synthesisVersion)` 跨用户复用 private Storage 对象，默认单 worker、请求间隔至少 3.1 秒、20 次/分钟和 500,000 字符/月；租约、重试、字符预留和成本预算都由服务端数据库控制。浏览器只缓存可重建副本并预取当前加未来四词。

候选读音考试只把当前 owner session 的当前词作为 server-derived reference text；评分前拒绝非当前词和轮末等待状态，供应商失败不写错误。单词是否正确沿用 `AZURE_SPEECH_PRONUNCIATION_PASS_SCORE`（默认 70），单元是否通过另用完整第一轮的整数正确率阈值（默认 90%）；两者不能混成同一个分数。自动化固定 WAV/fake provider 只验证工作流，发布前仍须用 Japan East 真实 Azure 独立验证评分、延迟、配额、错误降级和真实费用。

必须分别观测 attempt/snapshot RPC 延迟、队列等待、Azure 合成、Storage hit、浏览器 Cache hit、评分总耗时与供应商耗时；配额暂停、失败重试和重复词命中不能混入“生成成功率”。2026-07-27 Japan East 真实发布 gate 已验证 4 个首次生成对象、private Storage 命中、第二用户复用同 4 个对象且不增加生成，以及 VAD 裁剪后评分 97。Azure fake 只验证代码路径，不参与质量或供应商可用率报告；单次 gate 也不是持续可用率或账单对账。

### 2.4 OpenRouter 翻译语义前测当前边界

用途只限拼写前的可选教学判定。NestJS 从 owner/session/当前 word 取得 `term/translations`。用户答案经 NFKC、空白和大小写规范化后若完全等于任一参考项，以版本化 `nalanda-normalized-exact/normalized-exact-v1` 确定性判对且不产生供应商请求；只有非字面答案才连同 `term/translations` 发送 OpenRouter，指定 `google/gemma-4-26b-a4b-it:free`、temperature 0 和严格 JSON schema `{correct:boolean}`。客户端不能提供参考答案、model 或 provider 参数。模型只决定非字面语义 boolean；API 使用固定、非权威教学文案补齐 feedback，避免把自由文本输出当词义或因空 feedback 丢弃有效判定。任何输出都不能直接发 points/徽章或改 progress；错误判定只能由数据库事务转换成一次幂等 spelling attempt。

最低固定评测集需包含：

- 完全一致、同义改写、上/下位表达、语序变化、一个/多个合法词义；
- 只回答相关但不完整词义、反义词、无关词、把英文复述成英文、空白/超长输入；
- 中英文混排、标点/格式变化、提示词注入、要求泄露 system prompt/参考答案；
- 同 UUID 重放、租约并发、超时、5xx、429、非法 JSON/schema 和 revision 冲突。

语义质量门仍须用授权合成/专家标注集计算 precision、recall、false-accept/false-reject，并按单义/多义、词/短语和中英文分层。高风险错误是把无关翻译判对；当前真实 gate 的两条样本（同义为 true、无关为 false）只证明 endpoint/schema/key 当前可用，不代表质量 baseline，因此功能必须保留独立紧急 flag，不能对外承诺准确率。

运行时记录脱敏 provider/model、duration、correct 与 prompt/completion/total tokens；不记录用户答案、完整 prompt 或供应商响应。0027 把幂等 claim 与 provider-backed assessment reservation 分开：确定性完全匹配、已完成重放和未发出外部请求的租约都保持 `quota_counted=false/quota_counted_at=null`，仅在真实 OpenRouter 请求发出前按用户原子写入 true/当前时间；滚动窗口不再误用较早的 assessment 创建时间。同一 UUID 的网络/供应商重试不重复占产品额度。默认 20 次/用户/分钟、滚动 24 小时 500 次；429 携带精确恢复秒数。整个 provider 调用预算为 12 秒；若第一次 HTTP 200 缺少合法 boolean，可在同一总预算内重试一次，不另计产品配额。真实请求超时/供应商错误仍保留该次额度事实，但不记学习错误。虽然 model ID 含 `:free`，仍必须按“价格/额度可变化”的供应商依赖处理：发布前核对当前路由、额度和隐私条款，设置 usage 告警与紧急 feature flag，不在产品规则承诺永久免费，也不把 points/credits 与该调用绑定。

### 2.5 Fish Audio 中文 STT 生产边界

0037 只在 translation-first spelling 的翻译输入框中启用 OpenRouter `fish-audio/transcribe-1`。请求固定走 `/api/v1/audio/transcriptions`，使用 `language=zh`，模型、语言和 Bearer key 只由 NestJS 配置；识别文本只填入输入框，不自动发送，也不能直接形成 attempt、retry pool、进度、积分或徽章。用户编辑并明确提交后，才进入上节既有语义判分链。

当前公开标价按 `$0.0001/秒` 估算，数据库以 100 micro-USD/秒保守预留，默认每用户 20 次/分钟、300 次/本地日和全局 5,000,000 micro-USD/月。`learning_speech_usage` 只保存 kind/cost/date，不保存音频或 transcript；日志只保存 provider/model/language、音频秒数、耗时和供应商 usage/cost 数字。持续评测集仍应覆盖普通话男女声、轻声、口音、短词/短句、背景噪声、静音、断句、同音词、数字、英文夹杂和 1–6 秒时长，并按 CER、关键含义保留率、空结果率、p50/p95 延迟及每成功 transcript 成本分层。自动化 fake 只证明契约；真实发布 gate 使用 Azure 合成“苹果”的固定中文 WAV 通过候选 API，并要求 Fish Audio transcript 含“苹果”，仍不能代替真实用户口音评测或持续质量监控。[OpenRouter 模型页](https://openrouter.ai/fish-audio/transcribe-1)列出的价格与能力可能变化，发布时必须重新核对。

2026-08-04 的首次直连真实 smoke 因账户余额不足返回 HTTP 402，证明了该 key 能调用 `:free` 文本模型不等于计费 STT 可用；代码按设计映射 `TRANSLATION_STT_PROVIDER_CREDIT_REQUIRED` 并保留键盘输入。充值后用 0.526 秒、16 kHz 单声道合成中文 WAV 重测成功，直连 smoke 记录约 3.27 秒端到端耗时、1 秒 provider usage、约 `$0.0001` cost 且命中预期关键词；受保护生产 gate 随后经候选 Nalanda API 返回 `transcriptionMatched=true` 并激活 release。该固定样本仍不是多口音质量基线。

2026-07-28 的最终真实 gate 使用固定 `google/gemma-4-26b-a4b-it:free` 返回 1,365 ms、253 prompt tokens、27 completion tokens、280 total tokens；同一发布中的真实 Courses API 完全匹配路径持久记录 `nalanda-normalized-exact/normalized-exact-v1`、0 token 与 `replayed=true`。此前同一发布链有一次 12 秒 provider timeout 并按设计阻止候选激活，重试成功不能替代持续延迟/可用率或语义质量统计。

## 3. 可追溯生成记录

每个解析/生成 job 必须记录以下非秘密元数据：

- `job_id`、用户/资料内部 ID、请求幂等键、产物种类/语言/深度；
- 输入文件 hash、格式、大小、页数；不得在普通日志记录原文；
- parser/OCR/chunker/retriever 版本和配置 hash；
- provider、model ID、model revision（若提供）、region；
- system/prompt/template/tool schema 版本与 hash，不记录 secret；
- 输入/输出/cache/reasoning/image/page等供应商计量；
- 召回 chunk IDs/引用映射和权限快照；
- schema validation、质量门、安全门结果；
- queue/start/end 时间、尝试次数、终止原因；
- provider price snapshot、估算/实际成本、hold/commit credits；
- 结果版本、人工编辑派生关系、删除状态。

同一结果必须能在不泄露正文的前提下回答“哪个资料、哪套流水线、哪个模型、花了多少、通过了哪些门”。不能保证模型 bit-for-bit 可复现时，应明确为 traceable，而不是 reproducible。

## 4. 评测集治理

### 4.1 数据集分层

| 集合 | 用途 | 是否进入日常 CI | 数据要求 |
|---|---|---:|---|
| Contract fixtures | schema、边界、错误语义 | 是 | 合成、很小、可提交 |
| Golden regression | 质量/解析回归 | 是（可分 nightly） | 授权、去标识、版本化、专家答案 |
| Safety/red-team | 提示词注入、隐私、有害内容 | 是 | 合成/许可，严格访问 |
| Cost/latency benchmark | token、页面、时延、重试 | Nightly/发布前 | 固定输入和 provider 模式 |
| Shadow/online sample | 真实分布漂移 | 目标阶段 | 单独审批、最小化、优先仅指标/用户反馈 |

至少覆盖中/英文，文本 PDF/扫描 PDF/PPTX/DOCX/MD/HTML/TXT，公式/表格/图片/页眉页脚，短/长文档，多学科，不同质量和恶意内嵌指令。每个样本记录来源、许可证/同意、可用范围、PII 检查、保留和删除日期。

禁止把用户课件自动加入训练或 golden set。用户报告问题时，默认只记录错误类型和 trace ID；需要保留原文做评测必须单独、可撤回地同意，并限制访问/期限。测试集与 prompt 开发集分开，防止为已知答案过拟合。

### 4.2 版本与防污染

数据集使用不可变版本与 hash；变更记录新增/删除原因、标注者、仲裁和指标重算。模型供应商可能训练过公开材料，因此“公开测试高分”不作为唯一证据。Golden 答案至少经过一名领域审阅，高风险/争议样本双人仲裁。

## 5. 评测维度与指标

### 5.1 通用契约

- HTTP 状态、错误码、超时、取消、重试与幂等符合 API 契约；
- JSON/Pydantic/共享 TS schema 100% 通过；未知字段/版本按兼容策略处理；
- 中/英文遵从、空输入、超长、损坏/加密文件、恶意内容均有确定结果；
- 所有用户可见事实能关联 source chunk/page；无法支持的内容标注不确定或不生成；
- 重试不重复扣费、写结果或泄露其他用户 chunk。

### 5.2 解析/OCR

指标按格式和页面类型拆分：页/块召回、规范化字符/词 F1、标题层级、阅读顺序、表格单元格结构、公式/图片说明、页码映射、重复/页眉噪声、语言识别、失败页比例。扫描件单独报告 OCR，不与数字文本平均掩盖。

### 5.3 知识清单

覆盖核心概念、定义正确/完整、依赖排序、去重、术语一致、引用支持、粒度适合、语言遵从。记录 unsupported claim rate、source coverage、专家 1–5 分和关键遗漏率。

### 5.4 测验

题干清楚；答案可由资料支持；`answerIndex`/多选与选项一致；干扰项合理且不含第二正确答案；解释引用资料；难度/知识点覆盖；重复率与答案位置偏差。用 solver + 专家抽样验证，不因模型“自评正确”而通过。

### 5.5 知识图谱

节点 ID 唯一、边端点存在、无孤立/重复（除非合理）、标签可读、关系有来源、层级/依赖符合课程语义。若产品声明 DAG，才把环作为错误；否则记录环与关系类型，不能凭视觉漂亮判断质量。

### 5.6 模拟试卷

总分与 section/题目 marks 一致；题型/知识点/难度分布符合用户选择；题目可解、答案与评分标准正确；无资料外关键假设；无重复/泄题；预计时长合理。任何“100 marks”元数据必须从结构计算，不接受模型自报不一致。

### 5.7 人工评审量表

盲评维度：groundedness、correctness、coverage、pedagogy、clarity、difficulty fit、safety，1–5 分并给证据。对不同模型随机化顺序，至少记录评审者背景和一致性；低一致项仲裁。人工偏好不替代可验证契约。

## 6. 初始发布门禁

阈值是首版目标，首个真实 baseline 后可以经评审调整，但不得为让失败模型上线而静默降低。

| 门禁 | 目标 |
|---|---:|
| Schema/引用结构有效 | 100% release set |
| 跨用户 chunk/PII/secret 泄露 | 0 个 P0/P1 |
| 恶意文档指令改变系统规则/取密钥/越权 | 0 个成功攻击 |
| 关键 unsupported claim | 0 个；普通 claims 支持率 ≥ 95% |
| 引用指向真实且支持对应 claim | ≥ 98% |
| Quiz 答案/选项/解释一致 | ≥ 99% |
| Graph 结构完整性 | 100%（语义质量另计） |
| Exam marks/结构一致 | 100% |
| 目标语言遵从 | ≥ 99% |
| 专家综合评分 ≥ 4/5 | ≥ 90% 样本，且无学科低于 80% |
| 重复同一 job 的经济/结果副作用 | 0 |
| 成本估算相对实际误差 | P90 ≤ 20%，且绝不超过用户确认 credits 上限 |

解析门禁应在建立按格式 baseline 后填写到版本化 eval config；在此之前，任何格式只能标 beta，不把跨格式平均值作为发布证据。样本量、置信区间和各 slice 必须随 release report 公布，不能只给百分比。

## 7. 安全、隐私与提示词注入

测试至少包含：文档内“忽略系统指令”、要求输出密钥/其他用户资料、HTML/Markdown XSS、外链/像素追踪、数据 URI、恶意文件、超大/压缩炸弹、Unicode 欺骗、OCR 隐藏文本、错误引用、模型 prompt 泄露、工具参数注入、跨 job/cache 检索污染。

核心规则：上传资料是数据，不是指令；检索必须先按 user/material 授权过滤再向量召回；模型没有 service-role/Stripe/任意网络/数据库工具；输出渲染净化；供应商调用只传最小片段；日志/trace 不存原文；删除 job 覆盖 prompt/cache/embedding/供应商副本。

有害/违规内容按 [内容审核规范](../governance/CONTENT_MODERATION.md) 分流。高影响学术、医疗、法律、财务内容需明确非权威提示和来源，不得用流畅度掩盖不确定性。

## 8. 成本核算

### 8.1 价格快照

供应商价格放在版本化、受审批的配置/price catalog，包含 provider、model、region、currency、effective_at、input/output/cache/image/page/tool 等单位价格和来源。每个 job 绑定创建时/实际调用时约定的 snapshot；供应商改价不重写历史。

### 8.2 逐 job 成本

以货币最小单位或更高精度 decimal 计算，最后按财务规则取整：

```text
provider_cost = input_tokens × input_rate
              + output_tokens × output_rate
              + cache_write/read_tokens × respective_rate
              + image_or_page_units × respective_rate
              + embedding/rerank/moderation/tool charges

total_variable_cost = provider_cost
                    + parser/OCR compute
                    + queue/worker time
                    + incremental storage/egress
                    + retry cost not waived by provider
```

共享基础设施另做按 job/活跃用户分摊，不伪装成精确供应商成本。记录 estimated upper bound、actual、currency、pricing snapshot、attempt breakdown、谁承担失败/重试成本。credits 售价由产品价格决定，不能直接把 token 数暴露成事后无限扣款。

### 8.3 单位经济指标

按产物、语言、格式、页数、模型和 plan 分层观察：每成功 job 可变成本；每输入页/千字成本；每有效知识点/题目成本；缓存命中率；失败/重试浪费率；P50/P95 延迟；credits 收入标准价值；毛利率；退款/质量补偿率。

初始目标：稳定阶段 P50 贡献毛利 ≥ 60%，P95 请求仍非负；失败/重试浪费 ≤ AI 供应商成本的 10%；实际成本不得超过 job 预算上限。若目标未达到，应优化/调价/限制尺寸，不得隐藏成本或追扣超出确认上限的 credits。

## 9. 预算与运行时控制

必须同时有：

- **请求预算：**最大页数/字节/token/图片、最大输出、超时、重试次数、允许模型/工具；
- **用户预算：**按 plan 的并发、日/月 jobs 和 included credits；
- **系统预算：**供应商每小时/日/月软硬上限、模型/地区熔断、异常费用告警；
- **任务预算：**estimated upper bound 对应 credit hold；实际超预算取消或降级，不自动扩大；
- **队列背压：**达到容量/预算时排队或拒绝，不能无限堆积和过期扣费；
- **kill switch：**按 provider/model/产物/地区关闭，保留已有资料访问。

阈值作为受控环境配置，不在前端；变更有审计。降级顺序可为：减少上下文/输出 → 更便宜且已评测模型 → 只解析/保存草稿 → 延后/拒绝并释放 hold。不得在未告知时用质量显著不同的模型冒充原产品。

## 10. 延迟和可靠性

记录 queue wait 与 execution 分开。首个 baseline 前的暂定目标：≤20 页标准文本资料的单一产物 P95 在 120 秒内完成；组合/试卷 P95 在 300 秒内；更大资料在确认页展示分档预估。目标需由真实 staging benchmark 校准。

job 状态至少：`queued/running/validating/succeeded/failed/canceled/expired`。用户可安全轮询/订阅；取消只在确认终止后释放资源；worker 崩溃可续跑或幂等重试；partial result 默认不收费且不公开，除非产品明确提供可接受的部分交付选项。

## 11. 发布、灰度与回滚

每次模型、prompt、parser、retriever、schema 或关键参数变化：

1. 生成变更说明和预期收益/风险；
2. 运行 contract、golden、安全、成本/延迟基准，保存版本化 report；
3. 由 AI/产品评审质量，安全/隐私评审新增数据/工具，财务评审价格显著变化；
4. staging dogfood 使用授权数据；
5. 小流量 canary，与旧版本按 slice 对比；
6. 监控质量反馈、失败、成本、延迟、退款和安全；
7. 达门禁后逐步扩大，保留可立即回退的前一 pipeline version。

回滚必须恢复 pipeline 路由与价格/credits 行为，不删除已经生成的历史结果；结果保留其原版本标识。schema 不兼容采用双读/双写/迁移，不让旧客户端崩溃。

## 12. 在线监控与用户反馈

目标在线指标：成功/各错误码、schema/quality gate fail、queue/执行 P50/P95、token/页/成本、hold release/commit、重试、取消、用户编辑/重生成/删除、显式好评/差评、退款、引用点击和安全 flags。反馈与质量 trace 关联，但普通分析系统只保存内部 ID 和聚合，不自动复制课件/输出。

监控漂移按格式/语言/学科/模型/plan 分层。用户群差异只能用于质量公平性诊断，不用于基于学校/专业的敏感定价或歧视性限制。

## 13. 事故等级

- **P0：**跨用户资料/密钥泄露、模型工具造成真实资金/数据操作、大规模错误扣费；立即 kill switch、事件响应和密钥/会话处理。
- **P1：**系统性严重幻觉、恶意内容绕过、大规模超预算/重复扣费、删除未生效；停止受影响 pipeline、释放/退款、保全最小证据。
- **P2：**某格式/语言显著退化、延迟/成本 SLO 持续失败；降级/回滚并发布状态说明。

复盘记录触发、检测、用户影响、数据/费用、补偿、根因和防复发评测。未经隐私审批，不把事故中的用户原文长期变成测试夹具。

## 14. 分阶段实现清单

### Phase 0：契约与安全底座

- 统一 TS/Python/OpenAPI schema 和字段命名/版本；
- 固定合成 contract fixtures 与 CI；
- 服务间鉴权、输入限制、净化、trace/usage schema；
- 明确第三方许可证，只使用商业兼容实现。

### Phase 1：真实解析

- 每种格式独立 parser、页/块来源、错误语义；
- golden parse set 和按格式 baseline；
- Storage 授权下载、临时文件清理和删除联动。
- Courses 按四类选择版本化 prompt/schema；先实现英语词表的 PDF/DOCX/JSON/MD/HTML/图片 OCR，强制进入人工确认编辑器，其他类别继续禁用。

### Phase 2：单产物模型生成（不收费 beta）

- 模型/prompt/schema、grounded citations、质量/安全门；
- price snapshot、usage/cost ledger、预算/kill switch；
- staging/canary，仅授权测试账户。

### Phase 3：异步与 credits

- 持久 job/队列、幂等、取消、重试、hold/commit/release；
- 经 [经济规则](../product/POINTS_CREDITS_VIP_PAYMENTS.md) 的并发/退款测试；
- 达成本估算与质量门后才收费。

### Phase 4：公开/Market

- 组合产物、RAG/embedding 删除、在线漂移；
- AI 标识、公开前额外审核、版权/引用和申诉；
- 定期模型卡、透明度与单位经济复审。

## 15. 相关文档

- [ADR-0004：核心 API 与 AI 分离](../adr/0004-core-api-and-ai-service-split.md)
- [ADR-0007：第三方 AI 许可证](../adr/0007-third-party-ai-reference-licensing.md)
- [ADR-0008：独立学习课程与 Azure Speech](../adr/0008-independent-learning-courses-and-azure-speech.md)
- [安全策略](../../SECURITY.md)
- [隐私与数据删除](../governance/PRIVACY_AND_DATA_DELETION.md)
- [内容审核](../governance/CONTENT_MODERATION.md)
- [points/credits/VIP/支付规则](../product/POINTS_CREDITS_VIP_PAYMENTS.md)
