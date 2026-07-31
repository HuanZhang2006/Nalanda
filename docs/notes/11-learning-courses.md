# Courses：英语单词学习

> **文档定位**
> - **内容**：说明独立学习课程的数据边界、文本导入与编辑、四阶段学习、复习熟练度、分享/市场及当前验收状态。
> - **作用**：作为 Courses 首版实现的技术复盘和维护入口；最终产品范围仍以项目蓝图为准。
> - **何时更新**：课程契约、数据库、学习状态机、积分/徽章、Azure Speech/OpenRouter、分享市场或测试边界变化时。
> - **状态基线**：2026-07-31。生产已发布 0011–0022；会话意图恢复、历史冷单元未来五词排队/缓存替换、可选限时拼写、语义翻译前测及 Web/数据库一致的 Unicode 拼写归一化均已完成受保护发布。文件 AI 导入和其他三类课程仍不得描述为已实现。

## 1. 边界与入口

Courses 使用 `learning_*` 独立模型，不复用 Materials 的 `courses/materials`。侧栏 Courses 默认显示空状态和“创建课程”；类别选择器保留英语单词、知识点、阅读理解、题库训练四类，首版仅英语单词可创建。Market 包含仍为 Demo 的 Note Market 与读取真实快照的 Course Market。

Courses、学习/复习、公开分享与 Course Market 共用 Web 的 `nalanda-locale` 状态：未保存偏好时默认英文，可在顶栏切换中文并持久化到浏览器。课程专属 CSS 只定义编辑器、卡片网格和学习状态机布局；字体、色彩、基础按钮/表单/卡片/弹窗、深浅主题和交互状态均复用 `@nalanda/ui/nalanda.css` 的设计 token，不能另建品牌主题。

文件入口列出 PDF、DOC/DOCX、JSON、Markdown、HTML 与图片，但只显示“AI 解析即将推出”，不会上传、解析或调用模型。当前可靠输入只有**手工粘贴文本**，可以逐单元粘贴，也可以一次粘贴整份多单元词表。

## 2. 文本解析与结构化编辑

- 规则：忽略空行，用每行最后一个 ASCII 空格切分英文与翻译，翻译再以 `/` 分隔；`take part in 参加/参与` 是合法短语。
- 解析器返回行、列、错误码和消息，覆盖缺少分隔符、空翻译、连续 `/`、重复翻译、非法英文、超长、单元内规范化重复及 XSS/Unicode 边界；任一错误都会阻止保存并标红原位置。
- 有单元课程可选择“逐个单元粘贴”或“整份多单元词表”。整份模式自动识别末尾带编号、字母或罗马数字的 `Unit`、`Lesson`、`Chapter`、`Module`、`Section` 标题（例如 `Starter Unit 1`），以及带编号的“单元/课时/章节”；任意自定义名称必须写成 `[Custom name]` 或 Markdown 标题 `# Custom name`，否则会被当作词条。该显式规则用于消除“任意一行究竟是标题还是词条”的歧义。
- 整份模式要求第一条词汇前已有单元标题，并校验空单元、1–80 字符单元名和最多 100 个单元；词条错误的行列仍指向整份原文，不会重置为单元内相对位置。
- 课程名必填；每课 4–2,000 个不同规范化词/短语、最多 100 单元、每词最多 10 个翻译。无单元模式仍保存一个隐藏默认单元。
- 编辑器可改课程名、单元名、英文、独立翻译文本块和手工 IPA，可删除、跨单元移动，并用 dnd-kit 鼠标/触摸/键盘排序；同时提供显式上移/下移按钮。每个翻译都有独立输入框和删除按钮，并可逐项新增到最多 10 个，不再把 `东西/事情` 当成一个不可拆分字段显示。
- Review/Edit Course 的每个单元既可逐个添加词，也可打开“批量粘贴单词”面板追加整段词表。追加时使用同一解析规则，若与该单元已有规范化英文重复则返回 `DUPLICATE_EXISTING_TERM`，存在任一错误或会超过全课 2,000 词时不会部分写入编辑状态。
- CMUdict 在 API 内完成美式 ARPAbet→IPA；短语逐词组合。无法解析时保存 `null` 并显示“音标待补充”。
- 整门课程通过 `learning_upsert_course` 单事务保存。英文变化重置三项能力，翻译变化只重置翻译，IPA 变化只重置发音；排序、移动和改名不重置，也不终止 active session。增删单元/词或修改词内容时，事务会把旧 active session 标为终止并保留已有 attempts，而不是删除答题事实；用户随后从新内容开始新会话。

### 2.1 长内容滚动约定

生产应用壳固定为一屏高，`.main` 与 `.content` 都必须保留 `min-height: 0`，由 `.content { overflow-y: auto; }` 统一负责页面纵向滚动。Courses 创建、Review/Edit、学习和市场页面不得再建立冲突的全屏高度或外层 `overflow: hidden`；页面较长时，底部“添加单词”“批量粘贴单词”“添加单元”和保存操作必须可通过同一滚动容器到达。弹窗仍使用自身受限高度和内部滚动，不能把背景页滚动误当作弹窗滚动。

## 3. 学习与恢复

未完成会话按请求意图独立恢复，而不是按整门课程强制唯一。首次学习以课程+单元为意图；临时复习还包含范围与排序后的测试项；日程复习以 schedule ID 为意图。因而暂停 Unit 1 首次学习后可以开始 Unit 2 复习，两者进度都保留；相同意图的并发开始仍由 advisory lock 与部分唯一索引返回同一个 session。课程卡快捷继续最近活动的一项，完成临时复习后会再次看到仍未完成的首次学习。会话的阶段、位置、候补池、单词项和实际答题都写入数据库，因此刷新或换设备能继续。

1. **认单词**：顺序展示英文、IPA、全部翻译和发音；朗读评分可选。整体 `PronScore` 默认 70 分通过，低分会持久进入本阶段候补池；结果页显示真实阈值和候补状态，并可立即“重新朗读并评分”，达标重读会移除该候补项。
2. **发音记忆**：每批最多五词，音频列和词列分别打乱；选中发音对应词后立即提交并在所选项显示结果。答对短暂动画后自动推进；错配记到目标词并进入下一轮候补池，错误状态持续保留，直到用户点击“下一题”。
3. **翻译记忆**：一个翻译时点击选项立即判定；多个翻译时逐个确认正确项，最后一个正确项自动提交，任一错误项立即判错。干扰项来自课程内其他翻译；答对自动推进，答错持续显示错误选项与正确答案并等待手动“下一题”，不恢复 Check/Continue 两步确认。
4. **拼写记忆**：播放发音后输入。Web 即时判定和数据库权威判定都对答案与课程原始 `term` 执行 NFKC、Unicode 空白合并、ASCII 大小写折叠，并把弯/直撇号及常见连字符变体统一；因此全角/半角大写和输入法标点不会造成服务器反转，但连字符、撇号和句点本身仍不可省略。Enter 或一次提交确定答案。开始包含 spelling 的 session 时可选择不限时或 3–300 秒限时；限时从拼写输入真正可作答时开始，归零后按当前内容（可为空）只自动提交一次。还可开启翻译前测：用户先键入翻译，由服务端 OpenRouter 语义评判；正确后才显示拼写输入并开始计时，错误则直接形成该词一次 spelling 错误。答对自动推进；任何错误的字符差异、正确英文与每项翻译持续显示，用户点击“下一题”后才推进。

每个测试阶段执行“首轮全部词 → 本轮错误池 → 下一轮错误池”，直至全部通过。识别推进和每次答案都由 owner 校验后的 service-role RPC 原子更新，客户端不能直接伪造会话、尝试或 progress。

## 4. 复习、熟练度和 Schedule

首次完成单元可选 3、7、15、30 天复习，默认都不选；记录进入 `learning_review_schedules`，不会创建 `study_tasks`，因此不会获得任务 +5。Schedule 的今天/本周/全部把普通任务与复习日程聚合展示，进入对应复习并完成后才标记日程完成；临时复习不影响日程。

复习可组合发音、翻译、拼写并选择全部词或未熟练词。同一能力必须在至少两个不同的、尝试发生时按 Profile IANA 时区计算的本地日期中，于**已完成复习会话**最终答对才达标；同日重复不增加日期。三项均达标才写 `learned_at`。错误次数只累计真实错误，复习次数只累计包含该词且完成的复习会话。

课程卡的百分比是 `learned_at` 词数/总词数，初始 0%；悬停、点击或聚焦进度区域切换为“已学习/总数”。首次四阶段完成度只在会话内显示，不冒充熟练度。

## 5. 成长事实

Profile 聚合学习课程数、规范化去重后的熟练英文词数、不同复习日期数和已持久发放的课程徽章。徽章阈值为：词汇行者 20/200/1000，课程毕业生 1/5/20，复习坚持者 3/15/50。

至少包含 20 个不同规范化英文词且熟练度 100% 的课程，首次奖励 +20 points。业务键由用户 ID 与排序后的去重词集合 SHA-256 构成，经现有 `point_entries/point_event_states` 发放；删除、重建或克隆同一词表不能重复领取。**删除课程**不改写已经发生的积分分录与徽章历史；删除账号按隐私流程级联账号相关账本和 badge award。

## 6. 分享、市场和治理

- 分享 token 为 32 字节随机值，只保存 SHA-256；公共 JSON 删除私有 course/unit/word ID、进度和内部字段，React 展示层再统一转义文本。作者可列出、撤销或创建新 token，持链接且已登录用户可免费克隆。
- 市场发布保存不可变版本快照，更新源课程后必须显式发新版。所有克隆是独立私有快照、进度从零开始，并保留来源/作者署名；克隆课不可再次分享或上架。
- 首版只有“免费”，不读写 credits、订单或支付。发布/举报有服务端日限额；举报达到阈值仅告警，不自动下架。配置的管理员可通过带审计记录的 RPC 隐藏/恢复出版物。
- HTML 在展示层转义；作者发布前确认内容权利。分享与市场表不向匿名 PostgREST 开放，公共读取只经过 NestJS。

## 7. Azure Speech、隐私与降级

TTS 与 en-US scripted pronunciation assessment 位于服务端适配层，参考文本只能由当前用户课程中的 `wordId/sessionId` 推导。评分输入服务端限制为最长 8 秒、2 MB、16 kHz 单声道 WAV；浏览器先做噪声自适应 VAD、保留首尾 150ms 并裁剪到最多 6 秒。录音只在请求内存中转发，响应后丢弃，数据库仅保存分数、错误类型与音素反馈。合成音频按规范化内容键在 private Storage 跨课程共享，用户录音永不缓存。

评分采用 HundredMark、Phoneme、IPA 和 miscue；低于 70 的音素在 UI 标红。整体通过线由 `AZURE_SPEECH_PRONUNCIATION_PASS_SCORE` 控制，默认 70 且必须为 1–100；API 返回 `passThreshold/passed/queuedForRetry`，0014 事务按整体 `PronScore` 更新认词候补池，客户端不能自报通过。评分仍是可选入口：未评分不会阻断学习，主动评分后产生的低分会要求在本阶段候补轮再次看到该词。每用户默认 30 次/分钟、300 次/日，另有月预算和熔断开关。Azure 不可用时 TTS 降级浏览器朗读、评分入口关闭，不把供应商/麦克风失败计为学习错误。

0015 将 Session 增加单调 `revision`，attempt 增加客户端 UUID、唯一约束和首次响应快照。Web 先用 Session 中已有答案在当前渲染帧反馈：正确约 520ms 自动推进，错误一直保留到手动“下一题”；后台按 revision 串行提交 IndexedDB outbox。API 返回 `sessionPatch`，普通答案不再重拉完整 Session/Courses；重复 attempt 幂等 replay，冲突 409 后拉一次 `learning_get_session_snapshot`。离线预测到完成只显示“等待同步”，服务端仍唯一决定 retry pool、cursor/stage、progress、错误次数、points 和徽章；登出清除本账号 outbox，不能跨账号提交。

0015 还把 `vocabulary-audio` 保持为 private Storage 唯一服务端事实源，新增无客户端权限的 `learning_audio_assets` 持久队列。全局键为 `SHA-256(normalizedTerm + locale + voice + format + synthesisVersion)`；Session 启动排整个单元，音频 miss 只提升优先级并快速返回 `202 AUDIO_PENDING`，不会在请求中等待 Azure。worker 默认单并发、请求间隔至少 3.1 秒、20 次/分钟和 500,000 字符/月。Web 优先读 Cache Storage；0017 应用修复后，当前词和未来四词无论 ready/pending 都以最多两个并发请求主动缓存或提升队列优先级，manifest 每三秒轮询，ready 后立即落 Cache Storage 并清除该词的过期浏览器朗读提示。用户仍可下载/续传/删除指定单元；这不包含完整离线 app shell。Storage 网络故障必须显式失败，只有 HTTP 404 或 Storage HTTP 400 + JSON `statusCode=404` 可当正常 miss，以免故障时重复调用 Azure。

### 7.1 OpenRouter 翻译前测边界

翻译前测不是 Courses 文件 AI 导入，也不是客户端模糊匹配。浏览器只发送当前 session/word、revision、UUID 和用户输入；NestJS 从 owner 可见的课程中取得英文与 translations。规范化后完全等于任一参考翻译时由版本化服务端规则确定性判对且不调用供应商；只有非字面同义/改写才使用固定 `{correct:boolean}` JSON schema 调用 `google/gemma-4-26b-a4b-it:free`。模型只决定非字面语义 boolean，API 使用固定安全教学文案作为 feedback；两条路径都不能自行推进会话、授予积分或改写参考答案。

`learning_spelling_translation_assessments` 只保存用户答案 SHA-256、provider/model、判定、token usage、租约与首次响应；输入正文仅在 API 请求内存中存在。相同 UUID/答案 hash 重放直接返回首次响应，错误翻译用同 UUID 原子写一次 spelling 错误；正确翻译要求后续 spelling attempt 复用该 UUID。超时、网络故障或两次都缺失合法 boolean 会释放租约且不记错；第一次 HTTP 200 结构无效可在同一 12 秒总预算内重试一次，空 feedback 则安全回退而不丢弃 boolean。默认每用户 20 次/分钟、滚动 24 小时 200 次，生产 fake 明确禁止。

UI 的倒计时和即时状态不是服务端事实：超时仍经权威 attempt RPC；结果页面无论正确或错误都显示正确英文与拆分后的 translations。生产启用必须同时有一次性数据库 RLS/幂等门禁、fake-provider Chromium 流程和独立真实 OpenRouter structured/API gate。

## 8. 数据与安全证据

0011–0013 建立私有课程、会话/尝试/progress、复习、分享/市场/举报/审核、徽章及 speech 配额；0014 补齐朗读候补池；0015 增加 revision、幂等 attempt 响应、snapshot 与私有音频队列，0016 对结构、RLS 和权限做发布断言；0017 追加并回填 `resume_key`，把 active session 唯一性从整门课程收窄到首次学习、临时复习或日程复习的具体请求意图，0018 验证新索引、函数定义和 service-role-only 权限；0019 增加 session spelling options、答案 hash 评判事实与 service-only claim/complete/release/spelling RPC，0020 验证结构、RLS 与精确 grants；0021 新增内部 `_learning_normalize_spelling_text` 并替换七参数权威答题 RPC，0022 验证规范化结果及 helper/RPC 权限。私有表只允许 owner 读；音频队列和翻译评判表连 SELECT 都不授予客户端；所有新 RPC 仅 service role 可执行。公开接口只暴露必要署名和课程快照。

删除课程级联私有学习数据和日程，但保留同账号下已发 points/badge facts；用户删除遵循 Auth 外键级联，出版物、points 与 badge awards 随账号删除，只有 speech 成本行和 moderation action 以 `user_id/actor_id=NULL` 留下非账号化运营事实。Storage 清理仍须删除编排。细节见 ERD、API、安全、隐私、内容审核和积分产品规则。

## 9. 验收边界

仓库测试覆盖逐单元/整份多单元解析、全局错误行列、编辑器批量追加与已有词重复、独立翻译字段、排序、状态恢复、候补池、跨日熟练度、编辑重置、积分指纹、API 鉴权/限流/Azure fake/公开脱敏、双用户 RLS、Playwright 主流程及 0007 升级夹具。0019–0020 另覆盖 fake timer 单次超时提交、翻译通过前不计时、同 UUID 两步提交、语义错误手动推进、provider 失败不记错、答案 hash 不留正文、租约/配额/重放/跨用户拒绝，以及正确/错误结果同时显示英文和翻译。0021–0022 覆盖全角/半角全大写、弯/直撇号、连字符变体、不可省略标点、raw answer 保留、零 `wrong_count`/空候补池和客户端 helper 拒绝。Chromium 流程会实际断言 `.content` 可滚动、滚到底后“添加单元”进入 viewport，再继续保存和完整学习流程；这项布局验证不能由 jsdom 的零布局模型替代。

2026-07-22 的 PR run `29932310309` 与 main run `29932840103` 均通过 quality、0007→latest、空库重建、数据库 lint、一次性本地 Supabase 的双用户 RLS/Storage/Courses E2E 和 Chromium Playwright。Playwright 使用 Azure fake；main 发布另在激活前运行生产主机的真实 Azure gate，但本次 UI/文本导入变更没有修改语音行为。最终不可变 release 为 `d31af905b44ca4df39c70e271a7c7a51612916e3-29932840103-1`，公网复核包含 Web 200、`deps.supabase=ok`、未认证 `/api/me` 401，以及用户示例成功拆成 `Starter Unit 1`/`Starter Unit 2`、独立翻译输入和底部操作可达。

2026-07-23 的 PR run `29938780461`、main run `29939301081`、只读 plan `29939798432` 与 apply/deploy `29940292716` 逐层通过相同 quality、0007→0014、空库重建、database lint、真实 RLS/Storage 和 Chromium Playwright。生产只计划并应用 0014，保留加密恢复点 artifact `8538123165`；真实 Azure gate 得到 10,656-byte MP3 与 pronunciation 98.8，最终 release 为 `02ba1b682c104947aa0b80707c143b8e921870f0-29940292716-1`。独立复核确认公网 `deps.supabase=ok`、未认证 `/api/me` 401、运行 image 为同 SHA，且生产容器对不存在的 `vocabulary-audio` 对象返回正常 cache miss 而非错误。

2026-07-27 的 PR #21 run `30243998633`、main run `30244402278`、只读 plan `30244967669` 与 apply/deploy `30245430630` 通过 quality、0007→0016、空库重建/database lint、真实本地 Supabase RLS/Storage E2E 和 Chromium Playwright；Playwright 的 Azure 是 fake。plan 只列 0015–0016，apply 前保留 artifact `8644999285`，远端 history 到 0016。切流前 Japan East 真实 gate 验证 4 个首次生成对象、private Storage 命中、第二用户复用同 4 个对象、VAD 裁剪评分 97；release `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2-30245430630-1` 激活后，独立公网复核为 Web 200、`deps.supabase=ok`、未认证 `/api/me` 401。

同日后续 PR #24 run `30263277807` 与 main run `30263794368` 通过 0007→0018、空库重建/lint、真实本地双用户 RLS/Storage E2E、jsdom 和 Chromium Playwright；新增场景使用八词历史冷单元验证前五个 pending 立即提权、最多两个浏览器并发、manifest ready 后落 Cache Storage 并清除旧降级提示，也验证暂停 Unit 1 首次学习后可复习 Unit 2，完成后仍能恢复 Unit 1 原 cursor。只读 plan `30264327821` 仅列 0017–0018；apply/deploy `30264979509` 保留 artifact `8652623403`，远端 history 到 0018，激活 release `99313bd3763ce5bf1f7ffb252f821f7b21a67eec-30264979509-1`。Playwright 仍使用 fake provider；切流前独立真实 Japan East gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`，公网和服务器复核为 Web 200、匿名 `/api/me` 401、`deps.supabase=ok`，运行 Web/API 均为同一 SHA。

2026-07-28 的 PR #26–#29 完成功能与生产 gate 前向修复；只读 plan `30366334157` 仅列 0019–0020，受保护 run `30367263486` 创建 artifact `8691620673` 并把远端同步到 0020。前三个候选应用在 provider 契约、合成答案模型误判和 replay 映射处被 gate 拦截且自动恢复旧应用；最终 main run `30374301472` 激活 release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3`。真实 Japan East gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`；真实 OpenRouter 为 1,365 ms、280 tokens；候选 API 持久证明规范化完全匹配为 0 token 且相同 UUID `replayed=true`。独立公网复核为 `deps.supabase=ok`、匿名 `/api/me` 401 和 React root。

2026-07-31 的 PR #35 把 Web 与数据库拼写判定收敛到同一 Unicode 契约；PR/main CI 和受保护 run `30616540480` 均通过 0007→0022、空库重建/lint、真实本地双用户 RLS/Storage E2E、jsdom/API 与 Chromium Playwright。只读 plan `30616030488` 仅列 0021–0022；apply 前保留 artifact `8787805291`，远端 history 到 0022。不可变 release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` 激活前通过真实 Japan East Azure、真实 OpenRouter 和候选 Courses API gate；独立公网复核为 `deps.supabase=ok`、匿名 `/api/me` 401 和 React root。自动化没有借用真实用户会话在生产提交拼写答案；生产 SQL 自验证和一次性真实 Supabase E2E 分别证明迁移结果与答题行为。

复习日程必须引用本人该单元已完成的 initial session；由日程启动时服务端固定使用其 skills/scope，并在 review session 完成事务里写回 completed session。普通 Vitest/jsdom 不等于真实数据库 E2E；本地无 Supabase CLI/Docker 时 RLS 和 Playwright 会跳过或无法启动，只有一次性 Supabase CI 成功后才能称真实 E2E 已通过。

## 10. 明确未实现

PDF、DOC/DOCX、JSON、Markdown、HTML、图片 OCR/解析，多类别 prompt，结构化词表生成、人工确认、评测集、token/成本与隐私留存都属于后续 AI 导入阶段；本版不得在 UI、文档或发布说明中标为已实现。知识点学习、阅读理解和题库训练同样只是禁用的类别占位。
