# 变更日志

> **本文内容：**按版本/日期记录面向用户、开发者、数据和运维的重要新增、变更、修复、安全事项与废弃项。  
> **作用：**提供从发布结果回溯代码、迁移和运营影响的入口；它不是 Git 提交列表，也不替代发布说明。  
> **何时更新：**每个可发布 PR 合并时更新 `Unreleased`；正式发布时移动到带日期版本；紧急安全修复公开范围由安全负责人决定。  
> **状态基线：**2026-08-23。历史条目依据 Git 历史和受保护发布记录归纳；尚未发布的工作只列在 `Unreleased`，数据库 apply、应用激活和供应商能力分别记录，不得互相冒充。

格式参考 Keep a Changelog，版本策略在首个稳定 API 发布前保持 `0.x`。分类使用 Added、Changed、Fixed、Security、Deprecated、Removed。

## [Unreleased]

### Added

- 追加候选迁移 0054–0055 与第三条 `ox_alpha_native_file_v1`：固定 `stealth/ox-alpha`、Stealth-only/no-fallback、低档 mandatory reasoning，复用 Luna 的原字节安全审查/生成/repair/checkpoint/清理编排；API 与 worker 双层只允许 PNG/JPEG/WebP，数据库完成事务要求匹配用途的 Stealth usage，全部新签名继续 service-role-only。
- 新增并在生产数据库应用 Stage B 迁移 0052–0053：在 0051 后严格追加，撤销 authenticated 对 `posts.updated_at` 和 `study_tasks.done_at` 的兼容 UPDATE 权限，并失败关闭验证最终内容列、Schedule 列、service-role 与时间维护 trigger。原预留的 0044–0045 保持未使用，没有补插远端 migration history。
- 追加候选迁移 0049–0051：为 job/Note 增加显式 `pipeline`，为成本事件记录实际 upstream provider/endpoint，新增 `deleting` 清理状态、私有 `knowledge_graph_layouts`、任务删除/清空/取消清理事务、Luna 完成路由门和精确权限断言；旧签名继续保留用于数据库先行和应用回滚。
- 新增 `luna_native_file_v1`：固定 `openai/gpt-5.6-luna`、`provider.only=["openai"]`、无 fallback、ZDR/deny collection/require parameters、禁用工具/Web，并以内联 base64 原文件处理已通过门禁 allowlist 的 PDF/图片。它不调用确定性解析、OCR、LibreOffice、DocumentIR 或 parse cache，且不会使用具有远端留存语义的 Files API。
- 知识图改为动态 React Flow + ELK 分层画布，支持平移、缩放、拖动/键盘移动节点、适应视图、自动整理、无重叠碰撞消解、外部 hover/click 详情和带 revision 的跨设备布局保存；fake-provider Chromium 路径加入 250 节点及活动删除夹具。
- AI 队列增加逐条 Delete 与 Clear history 的应用内确认；worker 使用可取消 task registry/Office 进程组并在确认 usage spool 落账后清理 0700 目录。
- Materials 新增 “Organize knowledge points”：固定 DeepSeek 生成按来源顺序、带严格引用的 `GeneratedKnowledgeGraphV1`，My Notes 以交互图谱、hover 解释、点击详情呈现，并可对选定节点发起限定来源的问答。Knowledge list 与独立 Quiz 继续显示 Coming soon。
- 追加候选迁移 0046–0048：`generation_job_checkpoints`、`exam_grading_checkpoints`、`knowledge_node_questions`、单调 usage `event_id`、可恢复 job 字段、知识图谱 artifact 约束、service-role-only 工作流和失败关闭权限断言。
- 真实 provider/public smoke 候选覆盖知识图谱、节点问答、来源顺序、ZDR、增量成本账本和级联删除；fake Playwright 扩展到试卷、评分、图谱和节点问答完整路径。

### Changed

- Courses 拼写前非字面翻译语义判定由 Gemma 4 改为固定 `stealth/ox-alpha`，锁定 Stealth provider、禁止 fallback、拒绝数据收集并使用 strict boolean schema；完全匹配仍由服务端确定性零 token 判定，模型不能直接写进度或奖励。Materials 的 Ox 原图能力使用独立 flag/ZDR 门禁，当前无合规 ZDR endpoint 时保持关闭，不能用文本 smoke 替代。
- 在线考试的选择与草稿保存不再判分或返回任何答案/解析；只有整卷二次确认提交或到期自动交卷后，服务端才在同一提交事务内批改全部客观题，并把主观题合并为一次模型评分。`in_progress` 响应强制 `results=[]`。
- Luna Note 的节点问答会在来源仍存在时重新附原文件；来源删除后只使用持久图谱、选中节点和邻接关系。Luna 试卷主观评分继续使用 Luna/OpenAI，但不重复发送源材料。
- 清理额度规则统一：queued 删除释放 reservation；worker 已接收的 processing 删除/Cancel 消耗一次；历史删除不回退额度、不删除 My Notes，并保留 provider usage 审计。
- API→FastAPI 生成与评分改为 30 秒内返回 202，后续由内部 token 回调 progress/usage/checkpoint/complete/fail；兼容同步路由暂留供旧应用回退和直接 provider gate 使用。
- BullMQ 单并发槽现在持有到 Postgres 终态或 lease 到期，不会因 FastAPI 的 202 提前把 backlog 塞进进程内存；worker 以 1200/240 秒限制生成/评分总执行时间，生成超时可从 durable checkpoint 续跑。
- 可恢复错误在默认 24 小时内复用同一 job。数据库保存阶段 checkpoint，worker 0700 目录另保存已验证结果和 usage spool；成功、非重试终态和过期均清理，重试重新预留、成功才消费 Free quota。
- 恢复调度会先扣除该 job/attempt 已持久化的 provider cost，再把剩余预算交给 worker；worker 同时把上次回调失败留下的 usage spool 计入本地硬门，API 暂时不可用也不能借恢复流程重置单次成本上限。
- Materials 与 My Notes 在本阶段固定全英文并保持既有 class/token/字体/动画；不扩大为全站 React 或视觉迁移。

### Fixed

- 修复试卷生成/语义 repair 偶发返回不存在的 `sourceRef.blockId`，导致题数/总分正确的候选在结构门以 `SOURCE_REFERENCE` 失败的问题。worker 现在只保留 DocumentIR allowlist 内的引用、用服务端 block 元数据规范 locator；只有稳定 question ID 相同且 repair 删除全部有效引用时才恢复该题 repair 前引用，或在整份 DocumentIR 恰好只有一个 block 时选择这个唯一可能的 allowlisted block。多 block、跨题/换 ID 仍不猜测，最终必须重新通过结构校验和语义复核，不能用机械规范化伪造 grounding。
- 修复真实 Materials AI 发布门禁把最终 `AI_EXAM_VALIDATION_FAILED` 压缩成单一 code，导致无法区分题数/总分/引用等结构错误与 grounding/答案/干扰项等语义错误的问题。worker 现在只返回稳定类别、门禁阶段和题数/总分计数，不返回课件、题目、答案、prompt、reviewer 原文或 provider body；真实门禁仍严格失败关闭并只允许一次 repair。
- 固定 PDF/DOCX/PPTX 真实供应商样本由不足以稳定支撑五道题的三条事实扩展为八个独立、无个人数据的学习科学事实，避免把过薄 fixture 自身造成的随机不可出题误判成服务故障；题数、答案、语义、引用和费用门禁没有放宽。
- 修复真实登录生产 smoke 中知识图最低层级从 `1` 开始、通过 worker 校验后却被完成 RPC 以 SQLSTATE `22023` 拒绝，任务随后停在 `saving` 直到 15 分钟门禁超时的问题。`knowledge-graph.v2` 与 `knowledge-graph-native-file.v2` 现在在不改节点内容、引用、顺序或相对层级的前提下，把最小 level 确定性归零；DocumentIR validator 同时补齐 `sourceMode=document_ir` 与 level-0 root 检查，和数据库保存 contract 保持一致。
- 完成回调若仍被数据库以结果结构约束拒绝，会原子写入对应的试卷/图谱/问答/评分 validation failure 并返回成功确认，使 worker 清理 checkpoint/spool，而不是把永久性错误误当 callback outage 无限恢复；provider 路由违规同样终止且保留 usage，过期 lease 映射 409 让 worker 安全退出。
- 修复真实 DocumentIR 发布门禁中试卷模型偶发返回“题数正确、单题分值合法，但合计分值不等于用户设置”的 `AI_EXAM_VALIDATION_FAILED`。`exam-generate.v3` 与 `exam-native-file.v2` 现在先用服务端设置确定性归一化语言、难度、时长、总分、重复 section/question ID，并在可行范围内按原相对权重稳定重分配单题分值；题数、答案、语义和引用仍由原 validator/DeepSeek 复核严格把关。复核结果若 `issues` 非空不再因 `valid=true` 被忽略。
- 修复真实 DocumentIR chart 门禁把“解析器已隔离、尚待视觉恢复的纯图片范围”误判为整份文件 prompt injection，并在 MiMo 恢复前返回 `PROMPT_INJECTION_REJECTED`。`material-safety-audit.v2` 只允许没有确定性注入信号、且所有不确定位置均属于解析器失败范围的首轮 `uncertain` 进入隔离恢复；未知范围、已解析文本/focus 信号和 `malicious` 仍立即拒绝，恢复后的完整 DocumentIR 仍以严格二次审查失败关闭。
- 真实发布 run `31824832947` 暴露出 Luna 的 OpenAI-only 与 ZDR 组合当前无可路由 endpoint；原发布正确自动恢复旧 Web/API，但会阻断已经通过的 DocumentIR/图谱/任务/考试改进。向前修复把真实门禁拆为必须通过的旧流水线和实时 Luna ZDR catalog 决策：只有 first-party OpenAI ZDR endpoint 存在才开启 Luna，否则稳定返回 `OPENROUTER_ZDR_UNAVAILABLE`、保持子开关 false并继续让用户显式使用 DocumentIR，绝不关闭 ZDR、改用 Azure或允许 fallback。
- 修复 OpenRouter adapter 将所有 HTTP 400/404 都误报为 `OPENROUTER_ZDR_UNAVAILABLE` 的过宽分类；现在只有响应明确包含 ZDR/Zero Data Retention 证据才使用该 code，普通坏请求和模型不可用分别为 `OPENROUTER_BAD_REQUEST`、`OPENROUTER_MODEL_UNAVAILABLE`，仍不记录 provider 原始正文。

- 修复旧知识图卡片和详情互相覆盖、节点不可移动/缩放、详情常驻遮挡、同类字段重复显示，以及 artifact 更新后全部布局坐标丢失的问题；旧节点坐标按 ID 复用，新节点重新布局，revision 冲突会合并后重试。
- 修复已成功/失败任务无法清除、活动任务删除只改 UI 不真正中断、清理前记录提前消失的问题；记录只有在 worker 确认取消请求、usage spool 与临时目录均处理后才最终删除。
- 修复答题草稿响应可能提前携带判分结果的问题；服务端序列化现在对所有 `in_progress` 尝试剥离答案字段并强制空结果。
- Courses 音频预热、manifest 与单词音频准备现在只对可安全重放的 Supabase 408/425/429/5xx、连接失败和响应体超时做三次有限重试；最终失败统一返回带重试提示的 503，而不是无信息 500。Supabase REST/Storage 的响应正文读取也纳入 20 秒 transport 边界，发布失败会输出仅含 route、错误类别、上游 HTTP/稳定 code 的脱敏 API 日志，不记录数据库正文或用户内容。
- 真实 Courses 音频发布 gate 对幂等 prewarm/manifest 增加三次有限瞬时重试，并在同一超时边界内消费 JSON/音频正文；401/403/契约错误仍立即失败。这样一次可重试的上游 500 不再直接回滚已通过 DeepSeek/MiMo、Azure 和 Gemma 的候选，同时持续失败仍阻断切流并保留诊断日志。
- 真实 Gemma 发布门禁不再把交互 API 的 12 秒 SLA 当作整次 release smoke 的预算：每次尝试使用独立 30 秒上限、全部尝试共享 180 秒硬预算，并在同一重试边界内读取完整响应体。这样即使 2xx 响应头已到但正文流超时，也会以同一固定模型有限重试，而不会让 `DOMException TimeoutError` 逃逸并误触发无诊断回滚；坏 JSON/坏语义、永久 HTTP 状态和预算耗尽仍失败关闭。
- 受保护应用发布现在会在上传前删除同 SHA 的半成品、清理超过 24 小时的 abandoned incoming 目录，并只回收未被容器或当前 `.deploy.env` 引用的 Nalanda 镜像；可用空间不足 6 GiB 时在切流前失败。失败候选通过 EXIT trap 删除自身 Web 目录、incoming 包和镜像，避免连续失败把共享主机磁盘填满。
- 应用回滚不再让上一 API 等待可选 AI 容器达到 healthy：Redis/AI 分开尽力恢复，上一 API 使用 `--no-deps` 从已审计镜像强制重建并独立验证进程、鉴权和公网契约。AI 因磁盘水位等原因 unhealthy 时不再把一次受保护发布失败扩大成 nginx 502；readiness 失败日志同时输出脱敏 `/health` 依赖状态。
- 受保护发布的真实 Gemma 翻译 gate 现在只对网络错误及 408/425/429/5xx 做有限指数退避并遵守 `Retry-After`；401/402/403、坏契约、持续限流或超过等待预算仍失败关闭，避免一次瞬时 OpenRouter 429 在其他真实 AI/Azure 门禁已通过后无条件回滚候选 release。
- 修复 Node/Undici 默认约 300 秒 response headers timeout 把正常长任务误报为 `AI_WORKER_UNREACHABLE`；显式 dispatcher 现区分 `AI_WORKER_TIMEOUT`、不可达和协议错误。
- 修复 provider 已返回但 API 回调断开时成本事件或已验证产物可能丢失、重试可能再次付费的问题；生成和评分在完成/失败前先幂等 flush usage，评分结果与生成阶段均可恢复。
- 修复传给 FastAPI 的 `budgetMicroUsd` 过去只作为未使用元数据的问题；每个增量 usage event 现在会在继续下一次模型调用前更新 worker 预算，超限事实仍先写 spool/账本再失败关闭。
- Materials AI 队列现在标明每项是 Test paper、Knowledge map 或 Knowledge question；同一文件存在多个历史任务时，用户与浏览器测试不会再把旧试卷误认成最新知识图。
- 修复过期/耗尽 retry RPC 在抛异常后回滚自身清理的问题；终态现在持久保存稳定错误并由 API 映射 409。

### Testing

- PR #75 合并为 main `ad4b98b041ccb38954ac3bba705b26a92b70cca2` 后，run [`32587844503`](https://github.com/1590703336/Nalanda/actions/runs/32587844503) 通过 quality、0007→0053、空库/database lint、双用户 RLS/Storage、fake Chromium和生产镜像，且没有 migration 变更。application attempt 1 的 220 页 canary 通过，但固定 PDF 在一次 repair 后仍为 6 题而设置要求 5 题，以 `QUESTION_TYPE_COUNT` 失败并回退；唯一一次失败 job 重跑的 attempt 2 通过完整 DeepSeek/MiMo Materials suite、注入/安全教材、评分、9-node graph 与 Japan East Azure（accuracy 98、pronunciation 98.8），Luna 因 OpenAI-only ZDR 不可用保持 false，随后 Gemma 免费模型连续五次 HTTP 429并再次回退。两次均未切流；独立核对确认旧 Web/API/AI、false flags、公网 health/auth 和候选清理正常，因此 PR #75 已合并但未部署到生产。
- PR #74 合并为 main `5b4cad883b628fd21cc1d104227be6dfb746834f` 后，run [`32585659792`](https://github.com/1590703336/Nalanda/actions/runs/32585659792) 通过 quality、0007→0053、空库/lint、双用户 RLS/Storage 和 fake Chromium。生产 attempt 1 的真实 Materials suite、220 页 canary和 Japan East Azure均通过，但 Gemma 翻译 smoke 在 5 次有界退避后仍为 HTTP 429并回退；同 SHA 仅重跑失败 job 的 attempt 2 又在单 block PDF 首次生成及 repair 都返回无效引用时失败为 `SOURCE_REFERENCE`。两次候选均未切流且生产独立 health 正常。唯一 block 回归修复本地通过 ruff 与 78 个 Python 测试；真实 provider、Gemma、Azure、登录 smoke、切流和公网独立验证仍须由新 PR/main run 证明。
- PR #71 合并后的 main run [`32543270581`](https://github.com/1590703336/Nalanda/actions/runs/32543270581) 首次执行通过完整 fake/local 门禁和真实 Materials provider suite，但 Japan East Azure TTS 返回 HTTP 401，候选在切流前自动回退。用户要求重试后的 attempt 2 通过 220 页资源 canary（主/子进程峰值 107,868,160/221,601,792 bytes），随后固定 DOCX 试卷初次语义复核失败、一次 repair 后只剩最终结构 code `SOURCE_REFERENCE`，再次在切流前回退。新回归本地通过 ruff 与 77 个 Python 测试，覆盖引用去重/规范化、同题恢复、换题 ID 失败关闭及恢复后第二次语义复核；真实 provider、Azure、候选激活和公网独立验证仍须由新的 main run 证明。
- PR #70 的完整门禁 run [`32499521666`](https://github.com/1590703336/Nalanda/actions/runs/32499521666) 通过后合并为 main `e6fa854dd6517a2a2ccd4152b60ca37078f6af4e`。main run [`32540131549`](https://github.com/1590703336/Nalanda/actions/runs/32540131549) 再次通过 lint/typecheck、131 个 API、113 个 Web、72 个 Python测试、0007→0051、空库/lint/RLS/Storage、fake Chromium、镜像构建和 220 页 canary，但真实 DOCX 试卷返回 `AI_EXAM_VALIDATION_FAILED`；候选在 API/Web 切流前回退并清除，因此该 run 不是生产上线证据。
- validation 诊断/fixture 向前修复本地通过 74 个 Python 测试、ruff、26 个 release tooling 测试与 `git diff --check`；真实供应商、完整 CI 和生产激活仍须由新的 PR/main run 证明。
- PR #69 与 main run [`31838779292`](https://github.com/1590703336/Nalanda/actions/runs/31838779292) 的 fake/local 门禁、真实 provider fixture、220 页 canary、Azure/Courses gate均通过；登录生产 smoke 的固定知识图返回 3 nodes/2 edges 但没有 level-0 root，数据库拒绝完成回调，候选 `669f3f423e712fe561496dae6b0ab9b16c799025-31838779292-1` 未切 Web 且自动恢复旧 API/AI。该 run 是发现并隔离发布缺陷的证据，不是上线证据。
- 根节点/完成回调向前修复本地通过 72 个 Python、131 个 API、113 个 Web/jsdom 测试，以及 ruff、docs 55、release tooling 26、lint、typecheck 和 Web/API build；真实 Supabase、Chromium 与真实 provider仍须由新 PR/main/protected run 再证明。

### Security

- Ox Alpha 的模型/provider/reasoning/格式能力均由服务端固定；客户端不能选择模型或直接执行 0054–0055 工作流。Materials Ox 在实时 ZDR catalog 不合规时失败关闭，非图片即使被运维误加 allowlist 也会由 API/worker 拒绝。
- 2026-08-22 go/no-go 复核确认兼容观察已超过 24 小时；现网与最新 Web 均不提交两个时间字段，Redis PING/AOF/noeviction 正常、无 error/eviction，points ledger/Profile projection 差异为 0。只读 plan run `32581192318` 仅列 0052–0053；protected run `32581805613` 在 artifact `9478168126` 后应用并验证到 0053。该 run 的最新应用候选两次均被真实 Materials AI PPTX gate 拦截并自动恢复 `3c095a55ced21cee11a1b3131dd2889ec1f70733`，因此数据库权限已上线，但最新 main 应用没有切流。
- 新 checkpoint 表不开放客户端读取；知识问答仅 owner 可读且不能由客户端写。所有新 RPC 撤销 `public/anon/authenticated` EXECUTE，问题和来源内容继续按不可信数据处理，不能改变模型、工具或 system prompt。

## [0.11.1] - 2026-08-11

### Fixed

- Materials AI 固定 OpenRouter 路由增加网络错误与 408/429/502/503/504 的共享 wall-clock 预算内指数退避，遵守数值型 `Retry-After`；不提供跨模型 fallback，并让同一固定模型按吞吐量优先、只在满足 ZDR、拒绝数据收集与参数支持过滤器的 provider endpoint 间故障转移。固定关闭可选 reasoning，避免 completion 预算耗尽后 `message.content=null`；401/402/403、ZDR/参数错误立即失败，真实门禁失败只输出稳定 worker/provider purpose/error code，不回显响应正文。
- 修复受保护部署远端 heredoc 被 `docker compose exec -T` 继承 stdin 后提前吃掉后续脚本、却以零状态退出的假绿缺陷；所有远端 compose exec 统一显式读取 `/dev/null`，发布工具测试会拒绝重新引入裸调用。

### Testing

- PR [#56](https://github.com/1590703336/Nalanda/pull/56) run [`31462982923`](https://github.com/1590703336/Nalanda/actions/runs/31462982923) 与 PR [#57](https://github.com/1590703336/Nalanda/pull/57) run [`31465041901`](https://github.com/1590703336/Nalanda/actions/runs/31465041901) 均通过 docs/lint/typecheck、104 个 API、105 个 Web/jsdom、25 个 Python AI 测试、AI/API/Web build、真实 Redis、0007→0043、空库重建/lint、双用户 RLS/Storage 和 fake-provider Chromium Playwright。fake Playwright 不构成真实模型证明。
- main 验证 run [`31465776658`](https://github.com/1590703336/Nalanda/actions/runs/31465776658) 通过；独立只读 plan [`31465816321`](https://github.com/1590703336/Nalanda/actions/runs/31465816321) 确认本地/远端均到 0043、dry-run 为空且未执行写库或部署。

### Release

- 最终受保护 run [`31467153739`](https://github.com/1590703336/Nalanda/actions/runs/31467153739) 创建并上传 14 天加密恢复 artifact [`9092230348`](https://github.com/1590703336/Nalanda/actions/runs/31467153739/artifacts/9092230348)（824,125 bytes，artifact zip SHA-256 `6939309024094791bb639112eaf73a1429d588a4800c42703e579185a0aa817f`），确认 0041–0043 history、空 dry-run 和远端 database lint。
- 近上限 Office canary 处理 220 页/366,412 字符，主进程峰值约 101.8 MiB、子进程约 211.9 MiB，无 OOM 或邻站故障。真实 OpenRouter gate 使用固定 DeepSeek/MiMo 完成 PDF/DOCX/PPTX/chart、局部视觉恢复、注入拒绝、安全教材放行和主观题评分；真实 Japan East Azure、Gemma 翻译、队列/private Storage/重复词复用/评分也全部通过。
- 登录生产 smoke 完成 `queued → succeeded` 生成、异步评分、Free 双额度各消费一次、5 条 provider usage、来源与结果清理，并返回 `deps.supabase=ok/deps.ai=ok`；任务前后临时目录清理门禁通过。
- 不可变 release `e6ce0cb246d9fc1ecc1c4869b6e63d09d3256bd4-31467153739-1` 于 `2026-08-11T07:20:02Z` 健康激活，API/AI image 与 Web symlink 均指向该 commit，`FEATURE_MATERIAL_AI=true`。独立公网复核：首页 200，`/api/health` 为 `deps.supabase=ok/deps.redis=ok`，`/api/health/ai` 为 worker/queue ok，匿名 `/api/me` 和 `/api/profile/ai-quota` 均为 401。
- 更早的 main run [`31463661987`](https://github.com/1590703336/Nalanda/actions/runs/31463661987) 虽显示绿色，独立检查发现生产仍是旧 image/Web、flag=false 且 AI endpoint 404；根因正是首个远端 `compose exec` 消耗 heredoc stdin。该 run 没有被计作上线，修复并重新走完整受保护门禁后才发布。

## [0.11.0] - 2026-08-10

### Added

- 新增 0041–0043 Materials AI 发布候选：Free plan、按 Profile 时区重置的生成/评分双额度、持久 generation job/events、私有解析缓存、真实 Notes/来源快照、在线答卷/幂等草稿/评分事实、脱敏 provider usage 及完整结构/RLS/RPC 断言。
- Materials 每个文件增加复用现有视觉与双语 locale 的 “Use AI” 菜单；仅 “Generate test paper” 开放，其余三项显示 Coming soon。My Notes 将真实 Materials 课程/试卷与历史 Demo 分组；Profile 显示 Free plan 双额度。
- NestJS 增加 owner-only AI/Notes/Exam API、成功后消费的 reservation 事务、Postgres durable job、BullMQ UUID 调度/reconciler/延迟交卷和内部回调；FastAPI 增加 PDF/DOCX/PPTX/Markdown/HTML/TXT/JSON/CSV/图片解析、选择性 MiMo 视觉恢复、两次注入审查、DeepSeek 严格试卷生成与批量主观题评分。
- 新增受保护部署的 AI image、私有 Redis/worker readiness、真实模型固定样本 gate、2G 资源 canary、临时目录孤儿清理与失败自动回滚。

- 新增并发布第一阶段 0039–0040：冻结用户时区的 points 日窗口、稳定 business-key 奖励 decision、owner-only reward receipt、每日上限通知、append-only 审核冲正和四类只待审协同信号。
- NestJS 增加同机私有 Redis 原子 Lua 滑动窗口、注册 IP+邮箱双限流、认证/Courses/公开市场分层限流、HMAC 滥用聚合、真实 Redis readiness 和 points 管理 API；协同扫描使用分布式锁且不自动处罚。
- 生产 compose 增加密码认证、AOF `everysec`、`noeviction`、私有网络 Redis，以及 secret 原子安装、nginx 标准 JSON 429、配置验证和两阶段发布脚本/门禁。

### Changed

- 帖子直接 Supabase 写入收敛为内容列白名单，owner/作者快照/计数/repost/key/时间由数据库维护；Feedback 用户仅可新增/读取；Schedule 引用由 owner trigger 校验，`done_at` 由数据库派生。
- Web 在社区与任务业务写成功后读取服务端 points receipt，超限提示不回滚内容操作；Courses outbox 对 429 保持相同 attempt UUID 并按 `Retry-After` 串行恢复，音频 manifest 轮询退避而不误报永久失败。

### Security

- Materials AI 固定使用服务端 OpenRouter key、`deepseek/deepseek-v4-flash-0731` 和 `xiaomi/mimo-v2.5`，请求要求 ZDR、拒绝数据收集、禁止工具/Web 与 provider 参数降级；恶意或不确定 prompt injection 均拒绝并释放额度。
- AI 事务 RPC 全部撤销 `public/anon/authenticated` EXECUTE；用户只能读取自身任务/额度/Notes/答卷，不能写缓存、provider usage、结果、分数或配额。每任务 0700 临时目录在成功、失败、取消、超时的 `finally` 清理。
- Materials AI 删除含已评分答卷的 Note/科目时不再因 provider usage 外键置空而回滚；job/attempt UUID 作为不可变成本审计引用保留，内容删除不能抹掉月度预算事实，Auth owner 删除仍级联清理。
- Materials AI 近上限 Office 资源 canary 现在显式以 `PYTHONPATH=/app` 运行挂载到 `/tmp` 的脚本，并在普通 CI 镜像门禁中执行与生产相同的 640MB/896MB、0.75 CPU、128 pids 全量渲染，避免到生产激活时才发现镜像模块路径漂移。

- 新内部 points/audit 表对客户端完全隐藏；service-role 也只有 SELECT，所有奖励、signal review、moderation 和审计变更均经固定 `search_path` 的受控函数执行。新增函数默认撤销 `public/anon/authenticated` EXECUTE。
- 历史 points grandfather 只把存在 transition 1 正向分录的业务键视为实际获奖；0008/0009 零金额占位永久不可冲正/补领，既有无来源负 transition 通过 append-only `grandfather-zero-reset-v1` 等额归零，避免吞掉未来合法积分。
- 普通奖励与人工审核分别取得共享/独占 advisory gate，并统一 Profile→状态行锁序；重复审核留下 0 变化审计，不再与“目标不存在”混淆。
- Redis 故障时注册、写入、克隆、举报及成本路径 fail-closed，私有只读 fail-open 并记录脱敏降级事件；日志和数据库不保存原始 IP、邮箱、正文或课程内容。

### Testing

- 增加 Python 解析/安全/视觉范围/清理/schema 测试、Nest 配额/幂等/队列/revision/期限/评分测试、Web 队列/Demo/真实 Notes/草稿/计时/账号隔离 jsdom、双用户 AI RLS、fake-provider Playwright、真实 provider smoke 和近上限 Office 资源 canary。fake 自动化不构成真实模型或生产证据。

- 增加帖子/Feedback/Schedule 双用户负向 RLS、points 并发上限/时区/删除重建/suppress-restore/协同信号、Redis Lua/路由分类、Web 上限通知与 429 回退、nginx/secret 安装脚本回归。真实 Redis、一次性 Supabase、nginx 容器和 Playwright 仍须由 PR/main CI 形成证据，本地跳过不算通过。

### Release

- 0041–0043 尚未进入生产；只有完整 CI、只读迁移计划、加密恢复点、真实 OpenRouter/ZDR 固定样本、2G canary、`deps.supabase=ok`/Redis/AI readiness、公网登录用户 smoke 全部通过后才可开启 `FEATURE_MATERIAL_AI`。
- PR [#51](https://github.com/1590703336/Nalanda/pull/51) 与修复远端 SSH heredoc stdin 的 PR [#52](https://github.com/1590703336/Nalanda/pull/52) 已合入 main；PR/main CI 均通过 quality、真实 Redis、0007→0040、空库/lint、双用户 RLS/Storage 与 Chromium Playwright。
- [只读 plan `31372198037`](https://github.com/1590703336/Nalanda/actions/runs/31372198037) 确认本地/远端都到 0040 且 dry-run 为空；[受保护 run `31372888441`](https://github.com/1590703336/Nalanda/actions/runs/31372888441) 保留加密恢复 artifact `9057062920`（800,819 bytes，zip SHA-256 `81820da75dc4f0591ffd6f73ba3ac175a5b04f6995af8f8c508f60e56379a2f4`），并验证远端 history、database lint 与空 dry-run。
- 不可变 release `56100e6bc2a4c70aa289aaad4b43efa1267428bd-31372888441-5` 于 `2026-08-10T09:35:34Z` 激活。Redis PING/AOF/private-port/noeviction 与 nginx 配置通过；真实 Japan East Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8，真实 OpenRouter Gemma 返回 253/27/280 tokens，候选 API/Storage gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=98.2`、`transcriptionMatched=true`。公网复核确认 `deps.supabase=ok/deps.redis=ok`、匿名 me/admin 401、注册 `RateLimit-*`、Web 与 Course Market 200。
- 首个 apply run 虽已安全应用 0039–0040，但 Redis `docker compose exec` 消耗远端 heredoc stdin，导致 workflow 错报部署成功而应用未切换；PR #52 加入 stdin 分离和回归测试后修复。随后 OpenRouter free route 的一次超时和三次瞬时 429 均在切流前阻断；同凭据额度正常且本机/生产主机真实诊断恢复 200 后，第五次尝试完整通过。没有把失败候选计作上线。
- 0039–0040 现已进入生产兼容观察；最早在 `2026-08-11T09:35:34Z` 且 go/no-go 通过后，才允许另行创建 0044–0045 撤销兼容时间列 grant。0041–0043 是纯新增 Materials AI，不执行撤权。

## [0.10.2] - 2026-08-04

### Added

- 新增仅用于拼写前翻译输入的 OpenRouter `fish-audio/transcribe-1` 中文语音识别：输入框右端录音、识别后只填入文本且不自动提交，用户可继续编辑。
- 翻译语音输入、认词朗读反馈和读音考试共用实时波形组件；录音仍只在请求内存中处理，不持久化用户音频。
- 新增 0037–0038：service-role-only STT active session/revision/word 校验、每用户分钟/本地日配额、独立月预算预留及结构/权限发布断言。

### Security

- STT model、语言和参考学习状态均由服务端固定；客户端不能选择 provider、读取 OpenRouter key、绕过当前题校验或通过识别结果直接推进进度/奖励。

### Testing

- PR [#49](https://github.com/1590703336/Nalanda/pull/49) run `30904901828` 通过 docs/lint/typecheck、72 个 API 测试、85 个 Web/jsdom 测试、build、0007→0038、空库重建/database lint、一次性真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright；Playwright 的 Azure/OpenRouter 仍为 fake。
- 充值后独立真实 OpenRouter smoke 使用 0.526 秒、16 kHz 单声道合成中文 WAV 成功调用 `fish-audio/transcribe-1`，识别结果包含预期关键词并记录约 `$0.0001` provider cost；真实 `google/gemma-4-26b-a4b-it:free` structured smoke 同时成功。该证据证明当时的 endpoint/key/额度与固定中文样本可用，不代表真实用户口音、物理麦克风或持续准确率。

### Release

- PR #49 合入 main SHA `66c919833693971ba1bda4ea33a3fdf6717ef1ca`；main run `30905971129` 完成验证并按迁移保护规则跳过生产写入。只读 [plan run `30906629924`](https://github.com/1590703336/Nalanda/actions/runs/30906629924) 首次遇到一次性 Supabase 上游瞬时错误；同 SHA 仅重跑失败 job 后真实 RLS/Storage 与 Playwright 通过，最终 dry-run 唯一列出 0037–0038，未创建恢复点、写库或部署。
- [受保护 apply/deploy run `30907716733`](https://github.com/1590703336/Nalanda/actions/runs/30907716733) 在 apply 前保留加密 artifact `8892006761`（`db-recovery-66c919833693971ba1bda4ea33a3fdf6717ef1ca`，730,159 bytes），随后应用 0037–0038，并通过结构/权限断言、remote database lint 与空 dry-run。
- 不可变 release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1` 激活前通过真实 Japan East Azure（10,656-byte MP3、accuracy 98、pronunciation 98.8）、真实 OpenRouter structured 判分和生产候选 API 的 Azure 中文 WAV→Fish Audio STT gate；后者返回 `transcriptionMatched=true`，同时 Courses API/Storage gate 验证 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=96.4`。独立公网复核确认 `/api/health` 为 `status=ok` 且 `deps.supabase=ok`、匿名 `/api/me` 为 401、Web 返回新 React 资产；生产主机只读复核确认 Web 软链和 API image 都指向同一 main SHA。

## [0.10.1] - 2026-08-04

### Added

- 新增 0035–0036：把 `learned_at` 收敛为数据库触发器维护的精确派生值，并在发布时验证当前数据、约束、触发器、考试写入、review 无写入和客户端无表权限。

### Changed

- 发音评分录音移除浏览器端 20ms VAD、噪声阈值、250ms 最短清晰语音判断、首尾静音裁剪和 6 秒内容截断；录音期间明确关闭浏览器 echo cancellation、noise suppression 与 auto gain control，完整保留用户实际录到的帧。客户端只执行 Azure REST 契约必需的 16kHz 单声道 PCM WAV 格式转换，最多录制 6 秒，服务端仍限制 2MB/8 秒并把未修改的 WAV 转发 Azure。
- `learning_word_progress.learned_at` 现在总是等于两个考试通过时间中的较晚值；缺少任一考试事实时强制为空。首次学习、复习、单项考试、客户端状态和直接赋值都不能形成掌握。

### Fixed

- 修复轻声、低增益麦克风、快速起音或录音开头已经说话时，本地自适应阈值误报“没有检测到清晰语音”并阻止录音送达 Azure 的问题。

### Testing

- 增加静音、低幅度音频、首尾帧和完整时长均不被客户端删除的 WAV 回归；API 单元测试断言上传字节原样转发 Azure；真实 Supabase E2E 断言手工写 `learned_at` 或只有一个考试事实都仍为未学习。

### Release

- PR [#47](https://github.com/1590703336/Nalanda/pull/47) 合入 main SHA `51252527645d9438df0414f056c8a3b088b360d8`；最终 PR run `30831319634` 与 main run `30831964846` 通过 docs/lint/typecheck、Web/API tests、build、0007→0036、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright。Playwright 的 Azure/OpenRouter 仍为 fake。
- [只读 plan run `30832581552`](https://github.com/1590703336/Nalanda/actions/runs/30832581552) 确认生产远端完整到 0034，唯一待办为 0035–0036；恢复、apply 和应用部署步骤全部跳过。
- [受保护 apply/deploy run `30833228406`](https://github.com/1590703336/Nalanda/actions/runs/30833228406) 在 apply 前保留加密 artifact `8864033351`（`db-recovery-51252527645d9438df0414f056c8a3b088b360d8`，657,467 bytes，digest `sha256:36a9ec08516dff5cb198511d71b69bb63533727cad9826db050dff4a33025625`，保留至 2026-08-17），随后把远端 history 同步到 0036，并通过 0036 结构/权限断言、remote database lint 与空 dry-run。
- 不可变 release `51252527645d9438df0414f056c8a3b088b360d8-30833228406-1` 激活前通过真实 Japan East Azure 直连（10,656-byte MP3、accuracy 98、pronunciation 98.8）、真实 OpenRouter（253/27/280 tokens）和 Courses API/Storage gate（`generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=96.4`、未裁剪 `assessmentBytes=88444`）。独立公网复核确认 `/api/health` 为 `status=ok` 且 `deps.supabase=ok`、匿名 `/api/me` 为 401、Web 返回新 React 资产、Course Market 返回 200。未使用真实用户账号在生产提交完整拼写/读音考试，因此不能把发布 gate 描述为生产用户考试流程 E2E。

## [0.10.0] - 2026-08-03

### Added

- Courses 考试入口新增“读音考试”：默认要求完整第一轮 90% 正确率（可设 1–100%），单词逐题打乱展示并通过现有 Azure 发音评分判定；每次评分后无论正确或错误都停留显示分数、音素反馈、翻译和“听正确读音”，用户再进入下一词。
- 发音考试每轮结束会持久展示全部错词、该轮分数、IPA、翻译和标准音频；用户确认后，服务端才打乱错词并开始下一轮。第一轮达线且全部候补轮完成后，只记录本次选中词的发音考试通过事实。
- 新增 0029–0030：考试类型契约、发音考试工作流、通用候补轮确认 RPC、发音评分前当前题校验，以及结构/权限自验证。
- 复习和两类考试现在都可在所选单元内任意勾选 1–2,000 个词；服务端验证去重、owner、课程/单元归属和 `unlearned` 范围，并把选中集合固化到独立 session。
- Courses 新增考试历史和详情：最多列出最近 100 场，区分进行中、取消、通过及“首轮未通过但错题已全部修正”，并展示选词、错误次数、逐次拼写/读音结果和时间。考试词面、翻译、音标和最终结果使用 owner 私有快照，之后编辑或删除单词不会改写既有考试；删除整门课程仍按原规则级联删除历史。
- 课程编辑器在每个既有词旁显示累计错误次数、复习次数及是否已学习；这些只读属性不会随课程内容 payload 回写。
- 新增 0031–0032：自定义复习/考试范围、`practiceCompleted` 补练完成事实、私有不可变考试词快照、owner-scoped 历史 RPC，以及精确权限/结构自验证。
- 新增 0033–0034：`spelling_exam_passed_at`、`pronunciation_exam_passed_at`、双考试 check constraint、唯一 `learned_at` 投影、内容编辑撤销 trigger、单 RPC snapshot 字段，以及结构/权限自验证。迁移会从可证明的已通过考试回填两个事实，并清除仅由旧复习或单项考试形成的 `learned_at`。

### Changed

- 词汇掌握规则收敛为唯一条件：同一词必须分别通过并完整结束拼写考试与发音考试，两个考试事实都存在后才标为已学习。首次四阶段与任何次数/日期的复习都只保留练习事实，不再形成掌握；单独通过任一考试也不会提升课程熟练度。
- 课程编辑器逐词展示两项考试是否通过。修改英文会撤销两项考试，修改翻译只撤销拼写考试，修改 IPA 只撤销发音考试；任一考试事实失效都会清空该词的 `learned_at`。

### Security

- 发音考试的单词 70 分线（可由现有服务端环境变量调整）、第一轮正确率、错词池、轮次、错误次数和 `learned_at` 均由 service-role 事务决定；Web 只显示响应。评分前 RPC 还会验证 owner、活动会话和当前词，避免伪造 `wordId` 消耗 Azure 配额。
- 自定义 `wordIds` 不能改变 owner/scope 安全边界；浏览器不能直接调用选词或考试历史 RPC。未达首轮阈值的考试即使自动完成全部错题修正，也只写 `practiceCompleted=true`，不会写 `learned_at`。
- `learning_word_progress` 新增数据库约束，禁止缺少任一考试通过事实时存在 `learned_at`；复习推进函数不再包含正向掌握写入，内部掌握/编辑函数与 snapshot RPC 继续只允许 service role。

### Testing

- 增加 API 参数/RPC 映射、考试类型 UI、评分后标准音频、实时正确率、轮末错词分数、手动确认/打乱重考、通过后发音熟练投影、双用户 RPC 拒绝和固定录音 Chromium 流程；自动化 Azure 仍为 fake，不能作为真实供应商或生产发布证据。
- 增加复习/考试任意选词、失败考试自动完成、考试历史列表/详情、编辑器只读学习属性的 API/jsdom，以及 selected RPC owner/scope、历史脱敏、客户端拒绝、课程编辑后历史快照不变和失败考试不写熟练度的 RLS/Playwright 覆盖。
- 增加跨日三能力复习仍不 learned、单项考试仍不 learned、两项考试任意顺序共同 learned、失败考试不写考试事实、内容编辑精确撤销和 snapshot 映射的回归；0034 在空库/升级时验证唯一投影与权限边界。

### Documentation

- 将 Courses `learned_at` 文档统一为“拼写考试事实 + 发音考试事实”唯一服务端投影；补充复习只记录练习、单项考试不掌握、编辑撤销、课程进度/成长投影、安全边界，以及 Web/共享类型/NestJS/迁移/测试的逐层代码索引。同步更新积分产品规则、ERD、API、测试、隐私、监控和项目状态。

### Release

- PR [#45](https://github.com/1590703336/Nalanda/pull/45) 合入 main SHA `1a58d2164f6d58feea4d3a2c8925211b8cc60dde`；最终 PR run `30811283164`、main run `30811817461` 与受保护 run `30813047562` 通过 docs/lint/typecheck、Web/API tests、build、0007→0034、空库重建/database lint、真实本地 Supabase 双用户 RLS/Storage E2E 与 Chromium Playwright。Playwright 的 Azure/OpenRouter 仍为 fake。
- [只读 plan run `30812467085`](https://github.com/1590703336/Nalanda/actions/runs/30812467085) 确认生产远端完整到 0028，唯一待办为 0029–0034；恢复、apply 和应用部署步骤均跳过。
- [受保护 apply/deploy run `30813047562`](https://github.com/1590703336/Nalanda/actions/runs/30813047562) 在 apply 前保留加密 artifact `8855819351`（`db-recovery-1a58d2164f6d58feea4d3a2c8925211b8cc60dde`，593,399 bytes，digest `sha256:5f36f770aab133f24e12d461e66b0c4b744303ca1dbfd1600215163e4ad14796`，工作流保留 14 天），随后把远端 history 同步到 0034，并通过 0030/0032/0034 结构/权限断言、remote database lint 与空 dry-run。
- 不可变 release `1a58d2164f6d58feea4d3a2c8925211b8cc60dde-30813047562-1` 激活前通过真实 Japan East Azure（10,656-byte MP3、accuracy 98、pronunciation 98.8）、真实 OpenRouter（1,604 ms、253/27/280 tokens）和 Courses API/Storage gate（`generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`）。独立公网复核确认 `/api/health` 为 `status=ok` 且 `deps.supabase=ok`、匿名 `/api/me` 为 401、Web 返回 React root、Course Market 返回 200。未使用真实用户账号在生产提交完整拼写/读音考试，因此不能把发布 gate 描述为生产用户考试流程 E2E。

## [0.9.0] - 2026-08-01

### Added

- 进行中的 Courses 学习/复习页在“暂停并返回”旁新增中英文“取消学习”。确认后会话以服务端事务显式终止且不能恢复；已确认的 attempts、错误次数和熟练度历史保留，关联复习日程不被取消，之后可以开始一条新会话。
- 新增 0025–0026：owner 校验、行锁和 revision 推进的 `learning_cancel_session`，以及精确函数定义与 service-role-only 权限断言。
- 每一轮拼写结束且存在错词时，新增持久化轮末复盘页，逐项显示英文、IPA、独立翻译和读音；用户确认后，服务器才打乱错词顺序并开始下一轮。
- 新增独立考试模式：默认要求第一轮正确率 90%，支持 1–100% 自定义、实时显示第一轮正确率，并把所选单元全部词打乱后只考“翻译前测 + 拼写”。第一轮通过且所有错题补练完成后，服务端才把该单元词汇标为已学习。
- 新增 0027–0028：`exam` 会话、第一轮考试事实、拼写候补轮确认边界、语义评判实际供应商配额预留和对应结构/权限断言。

### Changed

- OpenRouter 配额不再被确定性完全匹配、幂等重放或仅领取评判租约消耗；只有即将发生的真实模型评判才预留额度。默认仍为每用户 20 次/分钟，滚动 24 小时上限提高到 500 次；429 响应携带可恢复等待秒数。

### Security

- 取消动作只经 NestJS 与 service-role RPC 执行；浏览器不能直接调用 RPC。服务端确认取消后，Web 仅清除当前账号、当前会话尚未同步的 IndexedDB 答案，不能影响其它会话或账号。
- retry pool、考试分数、通过状态、`learned_at`、积分与徽章继续只由数据库事务决定；考试 UI 的实时正确率不是客户端可写的成长事实。新考试、轮次确认与配额 RPC 均拒绝 public/anon/authenticated 执行。

### Testing

- 增加取消按钮/确认/返回、session-scoped outbox 清理、API 映射/跨 owner 隐藏、RPC 幂等取消/revision 和客户端拒绝执行的 Web、API 与真实 Supabase 回归覆盖。
- 增加轮末错词清单/音频/手动确认、候补顺序重排、考试默认/自定义阈值、实时正确率、通过后单元熟练度，以及确定性匹配零配额、真实 provider 预留、滚动限额与权限边界的 API、jsdom、RLS 和 Playwright 覆盖。

### Release

- PR [#40](https://github.com/1590703336/Nalanda/pull/40) 合入 main SHA `93354a56044470fb5d2b1fd6aeabcf82f459bb52`；PR run `30705662543` 与 main run `30705946921` 均通过 quality、0007→0028、空库重建/database lint、真实本地 Supabase RLS/Storage E2E 与 Chromium Playwright。Playwright 的 Azure/OpenRouter 仍为 fake。
- [只读 plan run `30706279006`](https://github.com/1590703336/Nalanda/actions/runs/30706279006) 确认生产远端完整到 0024，唯一待办为 0025–0028；恢复、apply 和应用部署步骤均跳过。
- [受保护 apply/deploy run `30706731292`](https://github.com/1590703336/Nalanda/actions/runs/30706731292) 在 apply 前保留加密 artifact `8820657507`（`db-recovery-93354a56044470fb5d2b1fd6aeabcf82f459bb52`，418 KB，digest `sha256:02ea6fef5481756b17f79fbbd82c023d9c9ba085accfc1e28f9a268d24645ad9`，工作流保留 14 天），随后把远端 history 同步到 0028，并通过结构/权限断言、remote database lint 与空 dry-run。
- 不可变 release `93354a56044470fb5d2b1fd6aeabcf82f459bb52-30706731292-1` 激活前通过真实 Japan East Azure（10,656-byte MP3、accuracy 98、pronunciation 98.8）、真实 OpenRouter（9,364 ms、253/27/280 tokens）和候选 Courses API/Storage gate（`generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`）。独立公网复核确认 `/api/health` 为 `status=ok` 且 `deps.supabase=ok`、匿名 `/api/me` 为 401、Web 返回 React root；已登录只读检查确认既有课程/进度仍可读取，并显示默认 90% 的考试配置。未在生产提交真实用户考试答案，因此不能把该只读 UI 检查描述为生产考试流程 E2E。

## [0.8.2] - 2026-07-31

### Changed

- 拼写题现在把“仅标点不同”判为正确：标点遗漏、替换或增加不会进入候补池，例如 `You're welcome.` / `Youre welcome!`、`check-in` / `check in` / `checkin` 均可通过。字母、数字、词序和没有标点参与的词间空格仍必须正确，`ice cream` / `icecream` 仍判错。
- Web 即时反馈与七参数数据库权威 attempt RPC 共用相同的“保留标点、移除标点、把标点视为空格”三路比较；原始答案继续写入 append-only attempt，retry pool、错误次数、进度和奖励仍只由服务器决定。

### Testing

- 增加标点遗漏/替换/增加、全角大写、真实字母错误和无标点空格错误的 Web 单元/jsdom；追加 0023–0024 数据库迁移、自验证及双用户 RLS 用例，验证标点容错不增加 `wrong_count`/候补池且内部 helper 仍拒绝客户端执行。
- PR #37、main 与受保护发布 run 均通过 docs/lint/typecheck、Web/API tests、build、0007→0024 升级、空库重建、database lint、真实本地 Supabase RLS/Storage E2E 与 Chromium Playwright。Playwright 的 Azure/OpenRouter 仍是 fake，真实供应商证据只来自生产激活 gate。

### Release

- PR [#37](https://github.com/1590703336/Nalanda/pull/37) 合入 main SHA `9b62951a8895aa6cf3ff0f9dce8395df239e6089`；PR run `30620350644` 和 main run `30620879282` 完整通过。[只读 plan run `30623522232`](https://github.com/1590703336/Nalanda/actions/runs/30623522232) 确认远端停在 0022 且唯一待办为 0023–0024，没有创建恢复点、写入数据库或部署应用。
- [受保护 apply/deploy run `30624104943`](https://github.com/1590703336/Nalanda/actions/runs/30624104943) 在 apply 前保留加密恢复 artifact `8790816378`（`db-recovery-9b62951a8895aa6cf3ff0f9dce8395df239e6089`，366,417 bytes，digest `sha256:887b1ac42c267ca7bb1cde810920702dde64f8d74112b3b39def6254d5bf0fca`，保留至 2026-08-14），随后把远端 history 同步到 0024，并通过函数/权限断言、database lint 与空 dry-run。
- 不可变 release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1` 激活前通过真实 Japan East Azure（10,656-byte MP3、accuracy 98、pronunciation 98.8）、真实 OpenRouter（2,790 ms、253/27/280 tokens）和候选 Courses API/Storage gate（`generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`）。独立公网复核确认 `/api/health` 为 `status=ok` 且 `deps.supabase=ok`、匿名 `/api/me` 为 401、Web 200 并返回 React root。没有使用真实用户账号在生产提交拼写答案；迁移自验证与一次性真实 Supabase E2E 是本次判定行为证据。

## [0.8.1] - 2026-07-31

### Fixed

- 拼写即时判定与数据库权威判定改用同一份英语规范化契约：NFKC 兼容字符、ASCII 大小写、首尾/重复 Unicode 空白、弯/直撇号及常见连字符变体会得到一致结果；标点本身仍必须存在。修复全大写或输入法产生的全角大写先被前端接受、随后又被服务器判错并加入候补池的问题。
- Courses 弱网答题提示改为独立的等待/成功状态：待同步答案全部获得服务器确认后显示“答案同步成功”两秒并自动消失，后续再次超时会恢复本地保存提示；正常在线答题不会逐题显示同步成功。
- 拼写测试答对后，正确拼写与翻译的反馈停留时间由约 520 ms 延长到 1.5 秒；翻译选择题和发音匹配仍保持原有快速推进节奏。拼写题卡会固定显示当前计时状态：翻译前测期间显示配置秒数及“翻译通过后开始计时”，进入拼写输入后显示实时倒计时，不限时会话也会明确标注。
- 翻译多选题在单词进入新一轮候补池时会重置上一轮的本地选项；即使候补池只剩同一个词，也不会携带旧的错误选项或阻止正确答案进入下一阶段。

### Testing

- Web 单元/jsdom 覆盖全角全大写、弯撇号、连字符变体、不可省略标点及原始答案提交；真实一次性 Supabase RLS E2E 以 `ＷＯＲＤ－０１` 和 `WORD-02` 验证服务器均判对、revision 单调推进、`wrong_count=0` 且候补池为空，同时验证客户端不能执行内部规范化 helper。
- PR #35 和 main/受保护发布 run 均通过 docs/lint/typecheck、Web/API tests、build、0007→0022 升级、空库重建、database lint、真实本地 Supabase RLS/Storage E2E 与 Chromium Playwright。Playwright 的 Azure/OpenRouter 仍是 fake，真实供应商证据只来自生产激活 gate。

### Release

- PR [#35](https://github.com/1590703336/Nalanda/pull/35) 合入 main SHA `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad`；[只读 plan run `30616030488`](https://github.com/1590703336/Nalanda/actions/runs/30616030488) 只列 0021–0022，没有创建恢复点、写入数据库或部署应用。
- [受保护 apply/deploy run `30616540480`](https://github.com/1590703336/Nalanda/actions/runs/30616540480) 在 apply 前保留加密恢复 artifact `8787805291`（`db-recovery-fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad`，digest `sha256:fd553ea9c4898d72928db64bcbd979e13dff50f6b50a2138ec7113958709c199`），把远端 history 同步到 0022，并通过远端函数验证、lint 和空 dry-run。
- 不可变 release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` 激活前通过真实 Japan East Azure、真实 OpenRouter 和候选 Courses API/Storage gate；独立公网复核确认 `/api/health` 为 `status=ok` 且 `deps.supabase=ok`、匿名 `/api/me` 为 401、Web 返回 React root。

## [0.8.0] - 2026-07-28

### Added

- 新增 0019–0020：`learning_sessions.spelling_options`、只保存用户译文 SHA-256 的 `learning_spelling_translation_assessments`、评判租约/配额/幂等响应，以及精确 RLS/grant 发布断言。
- 拼写测试可选 3–300 秒限时；倒计时只在拼写输入可作答后开始，超时按当前内容自动提交一次。可选翻译前测先由服务端 OpenRouter structured output 判断语义，正确后才进入拼写，错误直接形成一次权威 spelling 错误。
- 拼写结果无论正确或错误都显示正确英文与逐项翻译；翻译评判失败可重试且不记错。

### Fixed

- OpenRouter free route 偶发返回有效 boolean 但空 feedback，或 200 响应暂时缺少结构化 content。服务端契约收窄为只让模型决定 `{correct:boolean}`，用固定安全教学文案补齐 feedback；非法 200 在原 12 秒总预算内只重试一次，仍失败时释放租约且不记错。该修复不允许客户端自判，也不改变数据库权威。
- OpenRouter free route 会把与服务端参考翻译逐字相同的合成占位答案偶发判错。NestJS 现先执行服务端 NFKC/空白/大小写规范化；与任一参考翻译完全一致时以 `nalanda-normalized-exact/normalized-exact-v1` 确定性判对且不调用供应商，只有非字面同义/改写才交给 OpenRouter。该快速路径仍经过 owner、租约、配额、幂等和数据库权威事务。
- 修复翻译评测的幂等 claim 已命中首次完成事实时，API 映射丢失外层 `replayed=true` 的问题；现在相同 UUID/答案重放明确返回 `true`，且不会重复调用供应商、推进会话或累计错误。

### Security

- OpenRouter key 仅进入本地/服务器 mode-600 API env 和 GitHub protected environment，不进入 Web、数据库、日志或仓库。生产显式拒绝 `OPENROUTER_FAKE=true`；新表与 RPC 对 public/anon/authenticated 全部关闭。
- 用户键入的翻译只在 API 请求内存中转发；数据库保存 answer hash、boolean、短反馈、model/token 计量、租约和首次响应。正确翻译与后续拼写复用同一 UUID，重复/超时重放不重复调用供应商或推进会话。

### Testing

- 增加 fake-clock jsdom 的单次超时提交、翻译通过前不计时、语义错误手动推进、provider 失败不记错和双语结果渲染；API 覆盖规范化完全匹配零供应商调用、boolean-only structured schema、安全 feedback 回退、缺失 content 的单次有界重试、幂等 replay、租约释放、超时/非法响应；双用户 RLS 覆盖客户端拒绝、hash-only 持久化、revision 与级联；Playwright 使用 OpenRouter fake，不作为真实供应商证据。
- 发布工具新增 OpenRouter structured smoke 和生产 env 安装脚本测试。生产启用前必须另取得真实 OpenRouter 同义/无关判定及真实 Courses API 幂等证据。

### Release

- PR #26、#27、#28、#29 依次合入功能及三项生产 gate 前向修复；最终 main SHA `a4c230e1aa6f29abbd4fbe944a1b76c625107003` 的 run `30374301472` 通过 docs/lint/typecheck、Web/API tests、build、0007→0020、空库重建、database lint、真实本地 Supabase RLS/Storage E2E 和 Chromium Playwright。Playwright 的 Azure/OpenRouter 仍为 fake，不能作为真实供应商证据。
- 只读 plan run `30366334157` 只列 0019–0020；受保护 run `30367263486` 创建加密恢复 artifact `8691620673`（`db-recovery-7c8b516ec4fc9086a6bae816966cb7f688c19746`）并把生产数据库同步到 0020。该 run 与随后 `30370419397`、`30372651419` 的候选应用分别因 provider 契约、合成答案模型误判和幂等 replay 映射被 gate 拦截，均自动恢复上一应用；数据库按规则保持 0020。
- 最终 release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3` 激活前，真实 Japan East Azure 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；真实 OpenRouter 固定模型返回 1,365 ms、253/27/280 tokens；候选 Courses API 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`，并持久证明 `nalanda-normalized-exact/normalized-exact-v1`、0 token、`replayed=true`、revision 1。独立公网复核确认 `deps.supabase=ok`、匿名 `/api/me` 401 和 React root。

## [0.7.1] - 2026-07-27

### Added

- 新增 0017–0018：学习会话以受保护 `resume_key` 按请求意图恢复，并验证新索引与 service-role-only `learning_start_session` 权限。首次学习、临时复习和日程复习可分别保留进度，相同意图的并发开始仍只创建一个 active session。

### Fixed

- 修复历史/冷课程开始学习或复习时，浏览器只预取已经 ready 的未来音频，导致待生成词没有提升优先级并在点击时直接长期降级浏览器朗读。当前词和后四词现会以最多两个并发请求主动排队；manifest 变 ready 后立即写入 Cache Storage，清除对应的过期降级提示，后续播放改用缓存音频。
- 修复同一课程存在暂停的首次学习时，显式复习另一单元仍返回原学习 session。服务端现在只恢复课程、单元、模式、范围、规范化测试项或日程均匹配的会话；课程卡的快捷继续入口稳定选择最近活动的未完成会话。

### Testing

- 增加八词历史冷单元 pending→ready→Cache Storage jsdom、五词双并发上限、跨单元学习/复习意图 RLS，以及无预下载复习、缓存替换与原学习 cursor 恢复的 Playwright 回归覆盖。

### Release

- PR #24 run `30263277807` 与 main run `30263794368` 通过 docs/lint/typecheck、Web/API tests、build、0007→0018、空库重建、database lint、真实本地 Supabase RLS/Storage E2E 和 Chromium Playwright；Playwright 使用 Azure fake，只证明浏览器/API/一次性数据库协作。
- main SHA `99313bd3763ce5bf1f7ffb252f821f7b21a67eec` 的只读 plan run `30264327821` 只列 0017–0018；apply/deploy run `30264979509` 保留加密恢复点 artifact `8652623403`、同步远端到 0018，并激活 release `99313bd3763ce5bf1f7ffb252f821f7b21a67eec-30264979509-1`。
- 切流前 Japan East 真实基础 smoke 返回 10,656-byte MP3、accuracy 98、pronunciation 98.8；队列/Storage/评分 gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`。独立公网与服务器复核确认 Web 200、`deps.supabase=ok`、匿名 `/api/me` 401、Web symlink 和 API image 均指向同一 release SHA。

## [0.7.0] - 2026-07-27

### Added

- 新增 0015–0016：`learning_sessions.revision`、attempt UUID/首次响应快照与复合唯一约束、单 RPC session snapshot、service-only `learning_audio_assets` 持久任务表、全局单租约/配额预留和结构/权限断言；保留旧答题 RPC 供数据库先行与应用回滚。
- 新增 IndexedDB 答题 outbox、同 attempt UUID 超时重放、revision 冲突恢复、账号隔离与离线完成待服务器确认；客户端 Cache Storage 支持未来五词双并发预取、整单元续传下载、持久存储申请和本地删除。
- 新增单元音频预热/manifest API、异步 `202 AUDIO_PENDING` 音频读取、20 ms VAD 裁剪，以及真实生产 gate 脚本验证 Japan East 队列生成、private Storage 命中、跨用户重复词复用和裁剪后朗读评分。

### Changed

- 测试阶段答错后不再在约 1.15 秒后自动进入下一题；错误选项、正确答案或拼写差异会持续显示并锁定当前题，直到用户点击中英文“下一题”。答对仍保留短暂正确动画并自动推进。
- 翻译、拼写和发音匹配会在当前渲染帧显示 provisional 正误；普通成功响应返回增量 `sessionPatch`，不再每题重拉完整会话和 Courses 列表。服务端仍是 retry pool、阶段、进度、奖励和完成状态的唯一权威。
- 合成音频未命中不再在用户请求中同步等待 Azure；后台任务以至少 3.1 秒间隔和默认 20 次/分钟、500,000 字符/月生成，private Supabase Storage 继续是唯一服务端缓存。

### Security

- 所有新增 RPC 均撤销 `public/anon/authenticated` EXECUTE；音频任务表不开放 PostgREST。客户端不能用 provisional 状态发放积分/徽章，重复或超时答题只提交一次事实。
- 生产运行时显式拒绝 `AZURE_SPEECH_FAKE=true`；Storage 网络故障不会被降格成缓存未命中而触发不必要的 Azure 生成。

### Testing

- 增加预测/权威修正、连续弱网 outbox、Cache Storage、VAD、queue lease/quota、并发幂等/revision 冲突和客户端 RPC 拒绝覆盖；Playwright fake 仅证明浏览器流程，不作为真实 Azure 证据。

### Release

- PR #21、main push 与受保护发布均通过 docs/lint/typecheck、Web/API tests、build、0007→0016、空库重建、database lint、真实本地 Supabase RLS/Storage E2E 和 Chromium Playwright；Playwright 使用 Azure fake，不作为供应商证明。
- main SHA `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2` 的只读 plan run `30244967669` 只列 0015–0016；apply/deploy run `30245430630` 保留加密恢复点 artifact `8644999285`、同步远端到 0016，并激活 release `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2-30245430630-1`。
- 切流前 Japan East 真实 gate 验证 Azure TTS/评分、4 个首次生成对象、private Storage 命中、第二用户复用同 4 个对象且不增加 Azure 生成、VAD 裁剪后评分；独立公网复核 Web 200、`deps.supabase=ok` 和匿名 `/api/me` 401。

## [0.6.2] - 2026-07-23

### Added

- 朗读评分响应明确返回整体 `PronScore` 通过线（默认 70）、是否通过及是否已进入候补池；低分持久加入认单词候补池，重新朗读达标会在继续前移除该候补项。
- 评分结果增加显式“重新朗读并评分”操作，并在中英文 UI 中说明通过分数和候补池状态。

### Changed

- 发音匹配和翻译测试改为选择后立即判定：正确/错误直接在所选项播放可感知动画，服务端立即执行通过或候补池逻辑，短暂反馈后自动进入下一题，不再显示 `Check answer` 或 `Continue`。
- 多翻译题会逐个确认正确选择，最后一个正确翻译自动提交；任何错误选择立即记录本题错误。拼写仍需 Enter 或一次提交来确定输入边界，但结果后自动推进，不再二次确认。

### Fixed

- 修复 Supabase Storage 把 TTS 缓存未命中表示成 HTTP 400 + JSON `statusCode=404` 时被误判为服务器错误，导致所有首次 Azure 音频请求返回 500；缓存读写失败现在不会阻断已经可以生成/返回的 Azure 音频。

### Release

- main SHA `02ba1b682c104947aa0b80707c143b8e921870f0` 已通过只读 plan run `29939798432` 与受保护 apply/deploy run `29940292716` 发布；生产 migration history 已到 0014，加密恢复点 artifact `8538123165` 保留 14 天。
- 激活前真实 Azure Speech gate 使用 `japaneast`/`en-US-JennyNeural` 成功返回 10,656-byte MP3、98 accuracy、98.8 pronunciation 和 4 个音素；最终 release `02ba1b682c104947aa0b80707c143b8e921870f0-29940292716-1` 通过公网 readiness/auth/Web smoke。

## [0.6.1] - 2026-07-22

### Added

- Courses 创建流程新增“整份多单元词表”导入：可直接识别 `Starter Unit 1`、`Unit 2`、`Lesson 3`、`Chapter`、`Module`、`Section` 及对应中文编号标题；任意自定义标题使用 `[名称]` 或 `# 名称` 显式标记，避免与词条混淆。
- Edit/Review Course 的每个单元新增“批量粘贴单词”，可把多行词表追加到已有单元；会同时校验已有词重复、课程 2,000 词上限和原有格式规则。

### Changed

- Courses、学习/复习流程、公开分享与 Course Market 统一使用默认英文、可持久切换中文的前端 locale；课程 API 稳定错误码在 Web 端按当前语言显示。
- `courses.css` 只保留课程专属布局，并把字体、字号、颜色、按钮、输入框、卡片、弹窗、边框、圆角、阴影、focus/disabled 状态和响应式断点对齐现有 Nalanda 设计 token。
- 整份多单元解析器沿用“每行最后一个 ASCII 空格分隔英文与翻译”的契约，并把所有错误映射回整份原文的精确行号、列号和错误码。
- Chromium Playwright 主流程改为从整份多单元文本创建课程，先触发并修正重复错误，再验证真实滚动区域、底部按钮可达及后续完整学习/复习/市场克隆流程。
- 以上变更已随 main SHA `d31af905b44ca4df39c70e271a7c7a51612916e3` 通过受保护流水线发布为不可变 release `d31af905b44ca4df39c70e271a7c7a51612916e3-29932840103-1`；未修改数据库、API、环境变量或安全边界。

### Fixed

- 修复 Courses/Course Market 与现有主界面在表单底色、卡片密度、空状态、交互焦点和移动端布局上的视觉不一致；语言切换不会改变课程业务行为或 API 契约。
- 修复应用主列 flex 子项缺少 `min-height: 0` 导致 Courses 创建、编辑和 Review 长内容无法滚动到底部的问题；共享 `.content` 继续作为唯一纵向滚动容器，其他长页面同时受益。
- Review/Edit Course 的多个翻译不再以 `东西/事情` 这样的合并字符串显示，而是渲染为可独立修改、删除和新增的文本块，每词仍最多 10 个翻译。

### Not included

- PDF、DOC/DOCX、JSON、Markdown、HTML、图片 OCR/AI 导入仍只是禁用占位；本次文本导入扩展没有上传文件、调用模型或改变 AI 契约。

## [0.6.0] - 2026-07-22

### Added

- 新增 Courses 英语单词学习：空状态/类别选择、逐单元文本解析与精确错误位置、结构化编辑、dnd-kit/键盘排序、CMUdict IPA、课程卡熟练度，以及可恢复的认词/发音匹配/翻译/拼写四阶段。
- 新增独立 `learning_*` 0011–0013：私有课程/单元/词、会话/items/append-only attempts/progress、复习日程、分享、不可变市场版本、举报/审核动作、语音配额、九级徽章和发布断言；Materials `courses` 不变。
- Schedule 聚合 3/7/15/30 天课程复习，Profile 聚合课程数、不同熟练词、复习日期和课程徽章；20 个不同词且 100% 熟练的词集合首次发放指纹幂等 +20 points。
- 新增 NestJS Courses、会话/答题、复习、学习 Profile、分享/撤销/克隆、免费 Course Market、举报/审核接口，以及统一 `{ code,message,fieldErrors? }` 错误。
- 新增 Azure Speech 服务端适配：私有 TTS cache、16 kHz 单声道 WAV 限制、≤8 秒/2 MB 评分、音素反馈、持久用户限额/月预算、熔断和浏览器朗读降级；用户录音不持久化。
- 新增 Courses parser/jsdom/API/CMUdict/Azure tests、双用户 Courses RLS E2E 和 Playwright 双账号主流程；升级夹具自动暂存全部 0008+ migration，避免未来文件提前进入 0007 schema。
- 新增可执行真实 Azure Speech smoke：验证 MP3 TTS、16 kHz PCM TTS、scripted pronunciation assessment 和音素结果；生产主机在新 API image 激活前使用仅存在服务器 `.env` 的凭据执行该 gate。
- 新增 Courses 实现笔记和 ADR 0008，并同步 README、架构、蓝图、ERD/API、环境、本地开发、测试、数据库/恢复/监控/轮换、安全、隐私、审核、AI 成本和经济规则。

### Changed

- Market 现在有 Note Market（仍为 Demo）和 Course Market（真实免费快照）两个 Tab；Course Market 不使用 credits、支付或分成。
- `packages/types` 的 Courses camelCase 契约由 Web/API 共用；数据库继续 snake_case，由 API 显式转换。
- Courses 请求契约现在同时约束共享类型、Nest DTO 与 Web client；分享/市场克隆保留私有来源引用和作者署名，来源删除后只清空引用、不伪造署名。
- 根 `pnpm lint` 从空 Turbo 任务改为 API、Web 和共享类型都实际执行的严格 TypeScript 静态检查，并进入 PR quality gate。
- Azure pronunciation adapter 同时兼容官方文档的嵌套 `PronunciationAssessment` 与 Japan East REST 实际返回的扁平 score/error/phoneme 字段，并有两种响应形状的回归测试。
- 生产通过 main SHA `53d0eabf767725b6e9ca83367c0e17c47a479eca` 的独立 plan/apply 发布 0011–0013、Courses/分享/免费市场与 Azure Speech；数据库回退仍只使用 forward-fix，应用/功能通过 release 与 flags 回退。

### Security

- Courses 私有表禁止客户端写入，progress、badge、points、传播和审核写操作全部经 owner 校验后的 service-role 专用事务 RPC；RPC 默认撤销 `public/anon/authenticated` EXECUTE。
- 分享只存 32 字节 token 的 SHA-256，撤销与克隆在事务中复查；公开响应脱敏，publication 内容由 trigger 保持不可变，克隆课禁止再次分享/上架。
- `profiles.timezone` 只允许合法 IANA 名称；复习保存发生时本地日期。用户朗读音频不进数据库、Storage、日志或备份。
- HS256 JWT 回退与 JWKS 一致校验 issuer/audience；Azure TTS/评分增加 1–60 秒硬超时；Course Market 响应移除私有 unit/word ID 与进度字段。
- 复习日程只能由已完成 initial session 创建，并在服务端固定其 skills/scope；并发 session start 稳定恢复同一个 active session。
- 朗读评分在调用 Azure 前校验会话仍为 active，避免已结束会话消耗供应商配额或发送录音。
- NestJS CORS 从任意 Origin 改为 `CORS_ALLOWED_ORIGINS`/`PUBLIC_ORIGIN` allowlist；生产缺配置时只保留同源使用。

### Not included

- PDF、DOC/DOCX、JSON、Markdown、HTML、图片 OCR/AI 导入及知识点、阅读理解、题库训练仍未实现；现有入口只显示“AI 解析即将推出”。

## [0.5.0] - 2026-07-21

### Added

- 建立项目蓝图/最终说明、ERD/API、本地开发、环境变量、测试、数据库发布/回滚、备份恢复、监控告警和密钥轮换等文档体系。
- 建立 SECURITY、CONTRIBUTING、ADR、隐私与数据删除、内容审核、AI 评测/成本以及 points/credits/VIP/支付统一规则。
- 为 Web 补齐 9 个 jsdom 回归、为 API readiness 增加 2 个单元测试，并扩展 3 个 Supabase 双用户 RLS/Storage E2E；API HTTP、FastAPI 和真浏览器 E2E 仍明确列为待补。
- 增加本地 Supabase CLI 基线、PR/main 的 0007→0010 历史数据升级、旧 opening 归零与发布断言夹具、空库迁移重建、数据库 lint 与真实本地 RLS/Storage/points CI 门禁。
- 增加 0009 append-only legacy opening reversal，并将生产数据库发布拆分为只读 plan 与独立 apply 两次人工执行。
- 增加 0010 无写入的安全/积分发布断言；针对生产 migration history 为空的既有项目，在加密备份后以 0001–0007 public schema 零差异及 Storage policy/bucket 核验为前提自动建立 baseline，拒绝 partial、gap 和未知远端版本。
- 加密恢复点可显式记录尚不存在的 `supabase_migrations` schema；只有该精确状态可降级为 `migration_history_state=absent`，其他 dump 错误继续失败。数据库发布控制文件变更也会触发 main 的发布门禁。
- 修正空 history 基线脚本调用 `supabase db diff` 时误用全局 `--output` 格式参数的问题，并以可执行 CLI 夹具覆盖 diff 捕获、Storage 核验和 history repair 全路径。
- 增加生产 migration dry-run、加密发布恢复点、隔离恢复脚本和 migration history 发布流程。

### Changed

- 旧文档按当前代码与迁移重新标注“当前、部分实现、目标”，不再把蓝图能力描述为已经上线。
- 生产 Web/API 改用 Git SHA 不可变 release；本机或公网 smoke 失败时自动恢复上一应用 release，数据库仍采用向前迁移。
- `/api/health` 从变量存在检查升级为 Supabase JWKS + PostgREST 双探针；失败返回 sanitized 503，部署 smoke 只接受真实 readiness。
- 生产已通过独立 plan/apply 发布 0008–0010：建立 0001–0007 history baseline、追加冲正旧 11 points、验证权限/账本投影，并激活对应不可变 Web/API release。

### Fixed

- 重置 legacy 模块级会话状态并丢弃旧账号迟到响应，修复跨账号资料/社区/通知残留；账号变化会重新挂载应用。
- 把 resize 监听改为挂载/清理对称生命周期，修复退出再登录后无法重挂。
- 登录态读取、退出、Materials、通知、反馈、Profile、Community 和 Schedule 现在检查 Supabase/Storage `{ error }`；社区关系动作只在后端成功后更新界面，避免假成功。
- 会话变化会复位登录按钮 loading，退出失败在已登录界面可见。

### Security

- 新增 0008 migration：Profile 只允许客户端更新公开资料列，并以防御触发器保护 credits、points、等级、VIP 和 streak。
- 撤销 `_add_points`、`_notify`、`_set_point_event` 与新旧 trigger helpers 的客户端 EXECUTE；旧 `_add_points` 对 service-role 也不可调用。
- 新增 append-only `point_entries`、内部 `point_event_states`、稳定业务键、冲正和并发串行化；点赞、评论、原创/转发和任务取消后重做不再累计刷分。
- 剩余开放项包括帖子 UPDATE 可信字段、feedback 状态、注册滥用、公开媒体治理，以及 credits/VIP/支付商业账本。

## [0.4.0] - 2026-06-27

### Added

- 学习目标与任务真后端、课程/资料关联、任务完成 points、streak 和里程碑通知。
- 通知、反馈、Profile、Community 和 Schedule 的函数级实现说明。

## [0.3.0] - 2026-06-25

### Added

- 通知面板、真实 Feedback 和 Profile 数据。
- Community 真后端：帖子、评论、点赞、收藏、转发、关注、标签、媒体、points、等级和互动通知。

### Security

- 社区作者展示字段由数据库从 profile 快照生成，降低客户端伪造作者信息的风险。

## [0.2.0] - 2026-06-24

### Added

- GitHub Actions 到 `nalanda.online` 的生产部署流程。
- React Web 登录壳接入完整高保真原型界面。
- Materials 真后端：课程、资料、Supabase Storage、预览、下载和删除。
- 数据库迁移推送脚本与首批实现说明。

### Changed

- 注册改为 NestJS 后端调用 Supabase Admin 创建已确认用户。
- Supabase JWT 验证优先使用 JWKS，并保留旧 HS256 回退。

### Security

- Materials RLS 增加“资料必须属于当前用户自己的课程”校验，修复跨用户课程外键完整性问题。

## [0.1.0] - 2026-06-20

### Added

- pnpm + Turborepo monorepo，包含 Web、NestJS API、FastAPI AI 骨架和共享类型/UI 包。
- Supabase Auth、profiles 注册触发器和首版 owner-only RLS。
- Caddy + API + AI + Redis 的 2G 混合部署脚手架与部署变体说明。

## [0.0.2] - 2026-06-13

### Added

- 可运行的桌面/移动高保真 Showcase 原型。
- 首版架构与开发路线图。

## [0.0.1] - 2026-06-12

### Added

- 初始化仓库与产品 README。
