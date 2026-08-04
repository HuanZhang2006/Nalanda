# Courses：英语单词学习

> **文档定位**
> - **内容**：说明独立学习课程的数据边界、文本导入与编辑、四阶段学习、复习/考试熟练度、`learned_at` 判定、分享/市场及当前验收状态。
> - **作用**：作为 Courses 首版实现的技术复盘和维护入口；最终产品范围仍以项目蓝图为准。
> - **何时更新**：课程契约、数据库、学习状态机、积分/徽章、Azure Speech/OpenRouter、分享市场或测试边界变化时。
> - **状态基线**：2026-08-04。生产已发布 0011–0038；0037–0038 增加翻译中文语音输入和 service-only STT 配额边界，0035–0036 把 `learned_at` 加固为两个考试时间戳的精确 trigger 投影。文件 AI 导入和其他三类课程仍不得描述为已实现。

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
- 整门课程通过 `learning_upsert_course` 单事务保存。英文变化重置所有学习能力及两项考试事实；翻译变化重置翻译能力和拼写考试事实，IPA 变化重置发音能力和发音考试事实；任何一项考试事实失效都会清空 `learned_at`。排序、移动和改名不重置，也不终止 active session。增删单元/词或修改词内容时，事务会把旧 active session 标为终止并保留已有 attempts，而不是删除答题事实；用户随后从新内容开始新会话。

### 2.1 长内容滚动约定

生产应用壳固定为一屏高，`.main` 与 `.content` 都必须保留 `min-height: 0`，由 `.content { overflow-y: auto; }` 统一负责页面纵向滚动。Courses 创建、Review/Edit、学习和市场页面不得再建立冲突的全屏高度或外层 `overflow: hidden`；页面较长时，底部“添加单词”“批量粘贴单词”“添加单元”和保存操作必须可通过同一滚动容器到达。弹窗仍使用自身受限高度和内部滚动，不能把背景页滚动误当作弹窗滚动。

## 3. 学习与恢复

未完成会话按请求意图独立恢复，而不是按整门课程强制唯一。首次学习以课程+单元为意图；临时复习还包含范围与排序后的测试项；日程复习以 schedule ID 为意图。因而暂停 Unit 1 首次学习后可以开始 Unit 2 复习，两者进度都保留；相同意图的并发开始仍由 advisory lock 与部分唯一索引返回同一个 session。课程卡快捷继续最近活动的一项，完成临时复习后会再次看到仍未完成的首次学习。会话的阶段、位置、候补池、单词项和实际答题都写入数据库，因此刷新或换设备能继续。

进行中页面区分两种退出语义：“暂停并返回”只离开页面，原 active session 继续按意图恢复；“取消学习”需二次确认，经 NestJS/service-role RPC 锁定并终止会话、推进 revision，之后同一意图会创建新 session。已确认 attempts、错误次数和熟练度历史保留，未完成复习日程仍可重新开始；服务器确认取消后，浏览器只清除该账号该 session 尚未同步的 IndexedDB 答案，不能清除其它学习会话。

1. **认单词**：顺序展示英文、IPA、全部翻译和发音；朗读评分可选。整体 `PronScore` 默认 70 分通过，低分会持久进入本阶段候补池；结果页显示真实阈值和候补状态，并可立即“重新朗读并评分”，达标重读会移除该候补项。
2. **发音记忆**：每批最多五词，音频列和词列分别打乱；选中发音对应词后立即提交并在所选项显示结果。答对短暂动画后自动推进；错配记到目标词并进入下一轮候补池，错误状态持续保留，直到用户点击“下一题”。
3. **翻译记忆**：一个翻译时点击选项立即判定；多个翻译时逐个确认正确项，最后一个正确项自动提交，任一错误项立即判错。干扰项来自课程内其他翻译；答对自动推进，答错持续显示错误选项与正确答案并等待手动“下一题”，不恢复 Check/Continue 两步确认。
4. **拼写记忆**：播放发音后输入。Web 即时判定和数据库权威判定都对答案与课程原始 `term` 执行 NFKC、Unicode 空白合并、ASCII 大小写折叠，并用相同标点集合依次比较原文、移除标点后的文本、把标点视为空格后的文本。仅标点遗漏、替换或增加会判对，例如 `You're welcome.` / `Youre welcome!`、`check-in` / `check in` / `checkin`；字母、数字、词序和没有标点参与的词间空格仍必须正确，因此 `ice cream` / `icecream` 判错。Enter 或一次提交确定答案。开始包含 spelling 的 session 时可选择不限时或 3–300 秒限时；限时从拼写输入真正可作答时开始，归零后按当前内容（可为空）只自动提交一次。还可开启翻译前测：用户先输入翻译，0037 起输入框右端提供仅限此处使用的中文语音输入；录音期间显示实时波形，Fish Audio 识别结束后只填入输入框，不自动提交，用户可编辑。最终文本仍由服务端语义评判；正确后才显示拼写输入并开始计时，错误则形成该词一次 spelling 错误。答对自动推进；任何错误的字符差异、正确英文与每项翻译持续显示，用户点击“下一题”后才推进。

所有采集用户音频的课程界面共用同一实时波形，包括认词阶段可选朗读反馈、读音考试和翻译语音输入。波形只由当前浏览器音频帧即时派生，不保存为学习事实；翻译 STT 的音频/文本也不进入 Cache Storage、Supabase Storage 或数据库。语音识别结果本身没有判分权，只有用户编辑并明确提交后的既有 translation assessment 才能形成服务端事实。

每个测试阶段执行“首轮全部词 → 本轮错误池 → 下一轮错误池”，直至全部通过。0027 起，拼写阶段每轮结束且存在错词时不会自动进入候补轮：session 持久保存 `awaitingRetryConfirmation/retrySummaryIds/retryFromRound`，UI 列出本轮全部错词的英文、IPA、逐项翻译和读音。最后几题必须先获服务器确认；用户再点击“打乱顺序并开始下一轮”，service-role RPC 才推进 revision、清除确认标记并按 session/轮次确定性打乱候补词。确认期间普通 attempt 与翻译评判 claim 都由数据库 trigger 拒绝，刷新或换设备仍停留在同一复盘页。

识别推进和每次答案都由 owner 校验后的 service-role RPC 原子更新，客户端不能直接伪造会话、尝试或 progress。

### 3.1 考试模式

课程卡提供独立考试入口。用户选择一个单元、任意 1–2,000 个词、考试类型和 1–100% 的第一轮正确率要求，默认 90%；0031 起由数据库验证选中 ID 均属于 owner/课程/单元并固化到 session，未自选时使用整单元。两类考试都会持久打乱首轮，页面实时显示服务器 state 中的 `examCorrect/examAnswered/examAccuracyPercent`，刷新后可恢复。

- **拼写考试（生产）：**固定 `skills=["spelling"]` 且开启翻译前测，仍可选择拼写限时。翻译错误会直接形成该词一次权威 spelling 错误；翻译正确后继续拼写，所以每个词在第一轮恰好形成一个决定考试分数的 spelling attempt。
- **读音考试（生产 0029+）：**固定 `skills=["pronunciation"]`。页面只先给英文词和 IPA，用户朗读后由现有 Azure Pronunciation Assessment 返回 `PronScore`；单词分数达到服务端 `AZURE_SPEECH_PRONUNCIATION_PASS_SCORE`（默认 70）才记为该题正确。评分后无论正误都保留单词、总分、音素反馈、翻译和标准 TTS 按钮，用户点击下一词后才推进本地画面。供应商/麦克风失败不形成 attempt，也不计错。

是否通过只看完整第一轮的正确率；后续错题轮用于补练，不能把未通过的考试改成通过。即使第一轮已达标，仍须完成轮末复盘和全部错题重考。每轮错词页显示英文、IPA、独立翻译和标准读音；读音考试另显示该轮评分。用户确认后，通用 service-role 候补轮 RPC 才按 session/轮次打乱并推进 revision。最后一个候补词答对后，无论首轮是否达标，session 都自动进入 `completed`；0031 起另写 `practiceCompleted=true`，让历史记录明确表达“考试未通过但错题已全部修正”。

session 进入 `completed` 且首轮 `examPassed=true` 后，数据库 trigger 才按 `examKind` 给本次选中的 session items 写对应考试事实：拼写考试写 `spelling_exam_passed_at` 并保留初次翻译/拼写标志；读音考试写 `pronunciation_exam_passed_at` 并保留初次发音标志。单独通过任一考试都不会写 `learned_at`；只有同一词的两个考试时间戳都非空时，0033 才把较晚的通过时间投影为 `learned_at`，随后运行既有成长/课程完成投影。未达线时完成错题补练只会结束会话并写 `practiceCompleted`，不会写考试事实或 `learned_at`；用户可重新开始一场新考试。考试不会伪造任何复习日期，也不改变 points、徽章或合格课程的既有幂等规则。

### 3.2 自定义选词与考试历史（生产 0031–0034）

临时复习、Schedule 进入的复习和两类考试都在单元内显示可滚动词表，默认选择当前 `all/unlearned` 范围内全部词，用户可全选、清空或任意勾选。Web 提交 `wordIds`，NestJS 只做 UUID/数量/去重前置校验；数据库 selected-session RPC 再验证 user、course、unit、scope 和每个 word ID。临时复习/考试把排序后集合的 SHA-256 纳入 `resume_key`，不同选词意图不会错误恢复；Schedule 仍以唯一 schedule ID 恢复，首次启动时的 selection 固化在 session items 与 state，不能在续学时偷偷替换。之后编辑课程仍按既有规则终止受影响的活动会话。

Courses 顶部“考试历史”读取最近 100 场 owner exam session。列表区分进行中、取消、通过和未通过但补练完成，详情显示考试类型、首轮/要求正确率、选中词最终状态、session 错误次数，以及按时间排序的拼写原始答案或脱敏读音分数。0031 在考试创建时把词面、翻译和 IPA 写入 service-only `learning_exam_word_snapshots`，并为 attempt 保存原始 word/term；完成时固化最终错误次数与是否纠正，因此之后编辑或删除词不会改写旧详情。历史接口不会返回 Azure 原始音频、用户 WAV、provider 密钥或完整 provider payload。课程删除仍按既有级联规则删除其 session/attempt/snapshot 历史；本功能不是不可删除的审计仓库。

## 4. 复习、熟练度和 Schedule

首次完成单元可选 3、7、15、30 天复习，默认都不选；记录进入 `learning_review_schedules`，不会创建 `study_tasks`，因此不会获得任务 +5。Schedule 的今天/本周/全部把普通任务与复习日程聚合展示，进入对应复习后可在日程 `all/unlearned` 范围内进一步选择任意词，完成所选词后才标记日程完成；临时复习不影响日程。

### 4.1 “已学习”的唯一事实和唯一投影条件

`learning_word_progress.learned_at` 是词汇是否“已学习”的唯一数据库事实。课程卡、Profile 熟练词数、课程 100%、课程完成积分和课程徽章都读取该字段或读取由它派生的服务端聚合；`initial_*_passed`、三组 `*_review_dates`、会话内 passed、前端动画、考试实时正确率和 IndexedDB provisional 状态均不能替代它。0033 起，产品运行时只有一个条件能把空值投影为时间：**同一个词的 `spelling_exam_passed_at` 与 `pronunciation_exam_passed_at` 必须都非空**。

| 考试事实 | 服务端必须满足的条件 | 对 `learned_at` 的影响 |
|---|---|---|
| `spelling_exam_passed_at` | 拼写考试完整第一轮达到配置阈值，并完成轮末复盘及全部候补词，使 session 真正进入 `completed` | 单独存在时仍为未学习；与发音考试事实同时存在后才投影 `learned_at` |
| `pronunciation_exam_passed_at` | 发音考试完整第一轮达到配置阈值，并完成轮末复盘及全部候补词，使 session 真正进入 `completed` | 单独存在时仍为未学习；与拼写考试事实同时存在后才投影 `learned_at` |

两项考试先后顺序不受限制；第二项考试通过时以两个时间戳中较晚者作为首次 `learned_at`，重复通过不会改写。0035 已把该关系从单向 check 加固为双向精确投影 trigger：缺少任一时间戳时 `learned_at` 强制为空；两个都存在时强制等于较晚值，直接赋任意 `learned_at` 也会被覆盖。客户端没有直接更新 progress 的端点或表权限。

### 4.2 复习只记录练习事实，不再形成掌握

1. Web 从课程卡或 Schedule 以 `mode="review"` 启动会话。临时复习可选择发音、翻译、拼写中的 1–3 项以及全部词/尚未熟练词，再在该范围内勾选任意词；日程复习由服务端采用日程保存的 skills/scope，忽略客户端重报值，但允许在该范围内缩小选词。
2. 每次真实答题由 append-only attempt 保存当时的 `local_date`。日期在尝试发生时按 Profile 的合法 IANA timezone 计算；后来修改时区不会重写历史。
3. 错题进入候补池。某词在当前所选能力最终答对、且整个 review session 完成后，`_learning_advance_session` 才从正确 attempts 取得该词/能力的日期，并仅在数组中尚不存在时追加到对应 `*_review_dates`。
4. 同一天完成多场复习会增加 `review_count`，但不会产生第二个熟练日期。三种能力可以分散在不同会话、不同日期完成，不要求同一场同时选择三项；未选择的能力不会被顺带推进。
5. 每次 review 完成后，数据库只保留去重日期、增加 `review_count` 并完成关联 Schedule；即使三组日期都达到两个或更多，也不会写考试时间戳或 `learned_at`。

暂停、取消或遗弃的 review session 可以保留已经发生的 attempt/错误事实，但不会把本场日期加入复习数组；供应商超时、麦克风失败也不构成正确 attempt。只创建 3/7/15/30 天日程、同日重复、跨日完成三项能力或完成首次四阶段学习都不会标为已学习。

### 4.3 两项考试共同完成掌握

1. Web 以 `mode="exam"` 提交单元、`examKind` 和 `examPassPercent`。NestJS 只接受 `spelling/pronunciation` 与 1–100 的整数（缺省 90），禁止关联 Schedule，并强制 `scope="all"`。拼写考试固定翻译前测；读音考试固定 Azure 发音评分。用户不能把考试缩小为错词范围。
2. 数据库按考试类型打乱本次 session items；0031 起可以是 owner-validated 子集，未选择时为整单元。拼写第一轮以一次权威 spelling 结果计分；读音第一轮以一次持久 `speech_assessment` 结果计分，正确条件是 `PronScore >=` 服务端单词通过线。
3. 服务端持续写 `examAnswered`、`examCorrect` 和仅供显示的 `examAccuracyPercent`。第一轮全部答完时，用精确整数条件 `examCorrect * 100 >= examRequiredPercent * examTotal` 固化 `examPassed`；之后的候补轮不能把失败考试改成通过，也不能改变第一轮分数。
4. 第一轮有错词时，session 进入持久的轮末复盘状态。即使 `examPassed=true`，也必须由用户确认并把所有候补词最终答对；最后一个候补词答对后 session 自动结束。trigger 对所有考试写补练完成事实，但只有 `examPassed=true` 才一次性给本次选中词写对应的考试时间戳。
5. 第一轮未达阈值时，即使候补池后来全部答对、session 正常完成，trigger 也不会写考试时间戳；用户只能开始一场新考试。
6. 同一词可先通过任一考试。第一项只改变编辑器中的对应“考试已通过”状态；第二项通过后，数据库在同一事务中看到两个时间戳都存在，才写 `learned_at`。自定义子集考试只影响该 session 实际包含的词。

通过的拼写考试会补写初次翻译/拼写标志，通过的读音考试会补写初次发音标志；两者都不补写 `initial_recognition_seen` 或任一 `*_review_dates`。这些 initial 标志只用于学习状态展示，不参与 0033 的掌握判定。考试本身不新增积分事件类型；只有两项考试共同让一门至少含 20 个不同规范化词的课程首次达到 100% 时，才由现有 `_refresh_learning_growth` 指纹规则幂等发放课程 +20 和相应徽章。

### 4.4 不会标记、清除与保留规则

| 操作或状态 | `learned_at` 结果 |
|---|---|
| 完成首次认词/发音/翻译/拼写四阶段 | 不写入；首次完成度只属于 initial session |
| 点击“我认识”、一次正确答案或前端即时正确动画 | 不写入 |
| 创建或完成复习、跨多个日期完成三种能力 | 保留 attempts、去重日期和次数，但永远不写入 |
| 暂停、取消、离线待同步、revision 冲突或未完成会话 | 不以本地预测写入；只认服务器已确认并完成的事实 |
| 只通过拼写考试 | 写 `spelling_exam_passed_at`，但 `learned_at` 仍为空 |
| 只通过发音考试 | 写 `pronunciation_exam_passed_at`，但 `learned_at` 仍为空 |
| 任一考试第一轮未达阈值 | 后续补练完成也不写该项考试事实或 `learned_at` |
| 两项考试均通过且各自完整结束 | 写 `learned_at`；第二项通过的完成时间是掌握时间 |
| 克隆课程 | 副本 progress 从零开始，所有词 `learned_at=null` |
| 删除课程/单词 | progress 随私有内容级联删除；已经发放的不可变 points/徽章历史按既有规则保留 |

编辑现有词汇时，0012 保留原学习能力重置，0033 的 `learning_word_exam_mastery_reset` trigger 另外按考试语义撤销可能已经失效的考试事实：

| 编辑内容 | 被重置的字段 |
|---|---|
| 英文 `term` 改变 | 四个 initial 标志、三组复习日期、两个考试时间戳和 `learned_at` 全部重置 |
| translations 改变 | 原翻译能力事实清空；`spelling_exam_passed_at=null`、`learned_at=null`，保留发音考试事实 |
| IPA 改变 | 原发音能力事实清空；`pronunciation_exam_passed_at=null`、`learned_at=null`，保留拼写考试事实 |
| 仅课程/单元改名、排序或跨单元移动 | 不重置考试时间戳、`learned_at` 或能力事实 |

### 4.5 展示、成长投影和安全边界

- `LearningService.listCourses/getCourse` 只把 `learned_at` 非空的词计入 `learnedCount`，`progressPercent=learnedCount/wordCount`；课程卡悬停、点击或键盘聚焦时在百分比与“已学习/全部”之间切换。
- `learning_profile_summary` 按规范化英文去重统计 `learnedWords`；同一个英文存在于多门课只计一次。
- `_refresh_learning_growth` 在会话完成后重新计算课程 100%、九级徽章与课程 +20；只有 `learned_at` 非空的词参与。课程至少要有 20 个不同规范化词，积分业务键仍为用户与排序后词集合的 SHA-256，同一词集合不能靠删除、重建或克隆重复领取。
- `learning_word_progress` 对普通客户端只允许 owner SELECT；INSERT/UPDATE/DELETE 和内部 `SECURITY DEFINER` 函数/RPC 均未授予 public/anon/authenticated。Web 的正确率、候补池和完成画面是展示，服务端事务才是权威。

### 4.6 实现代码索引

全库 SQL 审计可用 `rg -n "learned_at\\s*=" supabase/migrations` 复核。历史迁移中的复习/单项考试写入会被追加式 0033 重新定义的函数覆盖；当前有效正向投影只位于 0033 `_learning_apply_passed_exam_progress`，并在 SQL 中同时检查两个考试时间戳。新增或改变正向写入条件时，必须同一 PR 更新本节、产品规则、ERD/API、权限断言和真实 Supabase E2E。

| 层 | 文件与关键符号 | 对“已学习”负责的部分 |
|---|---|---|
| 共享契约 | `packages/types/src/index.ts`：`LearningSessionMode`、`LearningExamKind`、`VocabularyWord.progress.spellingExamPassedAt/pronunciationExamPassedAt/learnedAt`、`StartLearningSessionRequest.wordIds`、`LearningExamHistory*` | 固定 `initial/review/exam`、两类考试事实、选词、progress 与历史的前后端类型 |
| Web 课程入口/进度 | `apps/web/src/features/courses/CoursesApp.tsx`：`CourseCard`、`openReview`、`openExam`、`selectableWordIds`、`startPicked`；`CourseEditor.tsx` | 展示课程/逐词熟练度和错误/复习次数；收集复习/考试选词、类型和阈值，但不自行写熟练度 |
| Web 考试历史 | `apps/web/src/features/courses/ExamHistory.tsx` | 展示 owner-scoped 最近考试、补练完成状态、选词和脱敏 attempt 详情，不读取 Storage 或 provider payload |
| Web 会话状态机 | `apps/web/src/features/courses/LearningView.tsx`：`continueRetryRound`、`assessBlob`、`continueAfterPronunciationAssessment`、completed/exam result、retry summary | 显示服务端考试分数；读音评分后保留标准音频；等待用户确认再应用 patch/进入错词轮 |
| Web HTTP 客户端 | `apps/web/src/features/courses/api.ts`：`startSession`、`attempt`、`assessSpellingTranslation`、`continueExamRetryRound`、`profile` | 只调用 Nest API，不直接调用 Courses RPC 或写 progress |
| Nest 路由 | `apps/api/src/learning/learning.controller.ts` 与 `pronunciation.controller.ts`：`start`、`attempt`、`continueExamRetryRound`、`assess`、`profile` | bearer/feature-flag 边界、owner 身份传递和公开 HTTP 契约 |
| Nest 服务 | `apps/api/src/learning/learning.service.ts`、`pronunciation.service.ts`：`startSession`、`recordAttempt`、`recordSpeechAssessment`、`continueExamRetryRound` | 校验考试类型/阈值，调用 Azure adapter 并映射 service-role RPC，依据 `learned_at` 汇总列表和详情 |
| 基础表 | `supabase/migrations/20260722000011_learning_courses.sql`：`learning_word_progress` | 定义四个 initial 标志、三组日期、错误/复习次数和唯一权威 `learned_at` |
| 历史复习/编辑/成长基础 | `supabase/migrations/20260722000012_learning_course_workflows.sql`：`learning_upsert_course`、`_learning_advance_session`、`_refresh_learning_growth`、`learning_profile_summary` | 定义复习日期和旧掌握规则；0033 重新定义 `_learning_advance_session`，保留日期/次数/日程但移除 review→`learned_at` 路径 |
| 当前普通答题与考试基础 | `supabase/migrations/20260801000027_learning_exam_retry_quota.sql`：`learning_start_exam_session`、`learning_record_attempt`、`learning_continue_spelling_retry_round`、`_learning_apply_passed_exam_progress`、`learning_session_passed_exam_progress` | 固化第一轮分数、阻断未确认候补轮；其单项考试掌握投影由 0033 覆盖 |
| 读音考试 | `supabase/migrations/20260803000029_learning_pronunciation_exam.sql`：六参数 `learning_start_exam_session`、`learning_record_speech_assessment`、`learning_continue_exam_retry_round`、`learning_get_assessment_target`、`_learning_apply_passed_exam_progress` | 0028 向后兼容地增加读音首轮统计、评分清单/候补轮、评分前当前词校验和通过后的发音熟练投影 |
| 选词/历史 | `supabase/migrations/20260803000031_learning_exam_history_selection.sql`：`learning_exam_word_snapshots`、attempt snapshot trigger、`learning_start_selected_review_session`、`learning_start_selected_exam_session`、`learning_list/get_exam_history*`、`_learning_apply_passed_exam_progress` | owner/scope 校验后固化选词；失败考试补练完成后自动结束但不写 learned；内容编辑后仍返回原考试快照 |
| 唯一掌握投影 | `supabase/migrations/20260803000033_learning_exam_only_mastery.sql`：两个 `*_exam_passed_at` 字段、check constraint、`_learning_apply_passed_exam_progress`、`_learning_advance_session`、`learning_word_exam_mastery_reset`、`learning_get_session_snapshot` | 回填可证明的考试事实并清除旧 review/单项考试掌握；只在双考试通过时写 learned；编辑按语义撤销；snapshot 返回两个事实 |
| 精确投影加固（生产 0035） | `supabase/migrations/20260803000035_learning_mastery_projection_guard.sql`：`_learning_project_exam_only_mastery`、`learning_word_exam_only_mastery_projection` 和双向 check | 所有 insert/update 都由两个考试事实重新派生 `learned_at`；禁止其它工作流或直接赋值形成掌握 |
| Schedule | `apps/api/src/learning/learning.controller.ts`：`schedule/schedules`；`apps/api/src/learning/learning.service.ts`：`createReviewSchedules/listReviewSchedules`；0012 的 `learning_schedule_reviews` | 只创建/读取日程，不直接写熟练度；完成关联 review 后由 `_learning_advance_session` 同时结算日期并完成日程 |
| 权限/结构发布断言 | `supabase/migrations/20260722000013_verify_learning_courses_release.sql`、`20260801000028_verify_learning_exam_retry_quota.sql`、`20260803000030_verify_learning_pronunciation_exam.sql`、`20260803000032_verify_learning_exam_history_selection.sql`、`20260803000034_verify_learning_exam_only_mastery.sql`、`20260803000036_verify_learning_mastery_projection_guard.sql`、`20260804000038_verify_learning_translation_voice_input.sql` | 验证 progress/RPC/trigger/历史结构、双考试精确约束、review 无写入、客户端无 progress/STT 用量写权限和 service-role-only 执行边界 |
| Profile 页面 | `apps/web/src/legacy/profile.ts` 与 `GET /api/profile/learning-summary` | 展示服务端去重后的熟练词数、课程数、复习日期和课程徽章 |

对应回归证据：

- `apps/web/src/features/courses/CoursesApp.test.tsx`：两类考试选择、复习/考试任意选词、阈值和 start payload、课程卡及编辑器逐词熟练度显示。
- `apps/web/src/features/courses/ExamHistory.test.tsx`：失败但补练完成的历史状态、列表到详情、选词和脱敏评分明细。
- `apps/web/src/features/courses/LearningView.test.tsx`：读音评分后停留/标准音、实时正确率、轮末分数清单、确认重考，以及通过/失败结果。
- `apps/api/src/learning/learning.service.test.ts`：review/exam 参数校验、RPC 路由和轮次继续映射。
- `apps/web/tests/rls.e2e.test.ts`：真实本地 Supabase 下跨日 2×3 复习仍不熟练、单项考试不熟练、两项考试按任意顺序共同投影 learned、选词 owner/scope、失败考试自动完成但不写考试事实、历史脱敏、编辑撤销、轮次锁和客户端 RPC 拒绝。
- `apps/web/e2e/courses.spec.ts`：浏览器覆盖两类考试配置、复习选词、考试历史详情、固定录音、读音结果/标准音按钮，以及拼写错题完整候补流程；外部 Azure/OpenRouter 在该套件中仍为 fake。
- `supabase/migrations/20260801000028_verify_learning_exam_retry_quota.sql`：空库/升级时检查考试字段、函数、trigger 和客户端 EXECUTE 撤销；它是结构/权限自验证，不代替浏览器流程。
- `supabase/migrations/20260803000030_verify_learning_pronunciation_exam.sql`：生产发布断言检查读音考试类型、精确计数、持久分数清单、熟练投影和 service-role-only 权限。
- `supabase/migrations/20260803000032_verify_learning_exam_history_selection.sql`：生产发布断言检查 selected/history RPC、私有快照表/触发器权限，以及 `practiceCompleted` 不绕过 `examPassed` 的熟练度边界。
- `supabase/migrations/20260803000034_verify_learning_exam_only_mastery.sql`：生产发布断言检查两个考试事实、`learned_at` check constraint、唯一正向投影、review 无正向写入、编辑撤销、snapshot 字段和 service-role-only 权限。

## 5. 成长事实

Profile 聚合学习课程数、规范化去重后的熟练英文词数、不同复习日期数和已持久发放的课程徽章。徽章阈值为：词汇行者 20/200/1000，课程毕业生 1/5/20，复习坚持者 3/15/50。

至少包含 20 个不同规范化英文词且熟练度 100% 的课程，首次奖励 +20 points。业务键由用户 ID 与排序后的去重词集合 SHA-256 构成，经现有 `point_entries/point_event_states` 发放；删除、重建或克隆同一词表不能重复领取。**删除课程**不改写已经发生的积分分录与徽章历史；删除账号按隐私流程级联账号相关账本和 badge award。

## 6. 分享、市场和治理

- 分享 token 为 32 字节随机值，只保存 SHA-256；公共 JSON 删除私有 course/unit/word ID、进度和内部字段，React 展示层再统一转义文本。作者可列出、撤销或创建新 token，持链接且已登录用户可免费克隆。
- 市场发布保存不可变版本快照，更新源课程后必须显式发新版。所有克隆是独立私有快照、进度从零开始，并保留来源/作者署名；克隆课不可再次分享或上架。
- 首版只有“免费”，不读写 credits、订单或支付。发布/举报有服务端日限额；举报达到阈值仅告警，不自动下架。配置的管理员可通过带审计记录的 RPC 隐藏/恢复出版物。
- HTML 在展示层转义；作者发布前确认内容权利。分享与市场表不向匿名 PostgREST 开放，公共读取只经过 NestJS。

## 7. Azure Speech、隐私与降级

TTS 与 en-US scripted pronunciation assessment 位于服务端适配层，参考文本只能由当前用户课程中的 `wordId/sessionId` 推导。评分输入服务端限制为最长 8 秒、2 MB、16 kHz 单声道 WAV；浏览器最多录制 6 秒并关闭 echo cancellation、noise suppression、auto gain control，不再做 VAD、音量阈值、最短“清晰语音”判断、首尾静音裁剪或内容截断。Web 只做 Azure 格式必需的 16 kHz/16-bit/单声道 PCM 封装，Nest 验证后将相同字节转发 Azure。录音只在请求内存中转发，响应后丢弃，数据库仅保存分数、错误类型与音素反馈。合成音频按规范化内容键在 private Storage 跨课程共享，用户录音永不缓存。

评分采用 HundredMark、Phoneme、IPA 和 miscue；低于 70 的音素在 UI 标红。整体通过线由 `AZURE_SPEECH_PRONUNCIATION_PASS_SCORE` 控制，默认 70 且必须为 1–100；API 返回 `passThreshold/passed/queuedForRetry`，0014 事务按整体 `PronScore` 更新认词候补池，客户端不能自报通过。评分仍是可选入口：未评分不会阻断学习，主动评分后产生的低分会要求在本阶段候补轮再次看到该词。每用户默认 30 次/分钟、300 次/日，另有月预算和熔断开关。Azure 不可用时 TTS 降级浏览器朗读、评分入口关闭，不把供应商/麦克风失败计为学习错误。

0015 将 Session 增加单调 `revision`，attempt 增加客户端 UUID、唯一约束和首次响应快照。Web 先用 Session 中已有答案在当前渲染帧反馈：正确约 520ms 自动推进，错误一直保留到手动“下一题”；后台按 revision 串行提交 IndexedDB outbox。API 返回 `sessionPatch`，普通答案不再重拉完整 Session/Courses；重复 attempt 幂等 replay，冲突 409 后拉一次 `learning_get_session_snapshot`。离线预测到完成只显示“等待同步”，服务端仍唯一决定 retry pool、cursor/stage、progress、错误次数、points 和徽章；登出清除本账号 outbox，不能跨账号提交。

0015 还把 `vocabulary-audio` 保持为 private Storage 唯一服务端事实源，新增无客户端权限的 `learning_audio_assets` 持久队列。全局键为 `SHA-256(normalizedTerm + locale + voice + format + synthesisVersion)`；Session 启动排整个单元，音频 miss 只提升优先级并快速返回 `202 AUDIO_PENDING`，不会在请求中等待 Azure。worker 默认单并发、请求间隔至少 3.1 秒、20 次/分钟和 500,000 字符/月。Web 优先读 Cache Storage；0017 应用修复后，当前词和未来四词无论 ready/pending 都以最多两个并发请求主动缓存或提升队列优先级，manifest 每三秒轮询，ready 后立即落 Cache Storage 并清除该词的过期浏览器朗读提示。用户仍可下载/续传/删除指定单元；这不包含完整离线 app shell。Storage 网络故障必须显式失败，只有 HTTP 404 或 Storage HTTP 400 + JSON `statusCode=404` 可当正常 miss，以免故障时重复调用 Azure。

### 7.1 OpenRouter 翻译前测边界

翻译前测不是 Courses 文件 AI 导入，也不是客户端模糊匹配。浏览器只发送当前 session/word、revision、UUID 和用户输入；NestJS 从 owner 可见的课程中取得英文与 translations。规范化后完全等于任一参考翻译时由版本化服务端规则确定性判对且不调用供应商；只有非字面同义/改写才使用固定 `{correct:boolean}` JSON schema 调用 `google/gemma-4-26b-a4b-it:free`。模型只决定非字面语义 boolean，API 使用固定安全教学文案作为 feedback；两条路径都不能自行推进会话、授予积分或改写参考答案。

`learning_spelling_translation_assessments` 只保存用户答案 SHA-256、provider/model、判定、token usage、租约、`quota_counted/quota_counted_at` 与首次响应；输入正文仅在 API 请求内存中存在。相同 UUID/答案 hash 重放直接返回首次响应，错误翻译用同 UUID 原子写一次 spelling 错误；正确翻译要求后续 spelling attempt 复用该 UUID。超时、网络故障或两次都缺失合法 boolean 会释放租约且不记错；第一次 HTTP 200 结构无效可在同一 12 秒总预算内重试一次，空 feedback 则安全回退而不丢弃 boolean。

0027 将“领取幂等租约”和“消耗供应商配额”拆开：规范化完全匹配、已完成重放以及仅创建 pending/processing 行都不占配额；只有 NestJS 即将调用真实 OpenRouter 时，才通过用户级 advisory lock 原子写入 `quota_counted=true/quota_counted_at=now()`。分钟和 24 小时窗口都从这个真实预留时刻计算，而不是从可能更早的 assessment 创建时间计算。同一 UUID 的供应商/网络重试不重复消耗产品额度。默认每用户 20 次/分钟、滚动 24 小时 500 次；达到任一限制返回独立稳定错误码及精确 `retryAfterSeconds`，Web 显示预计恢复时间。真实供应商失败已经产生外部请求，因此保留该次配额事实，但释放评判租约且不记学习错误；生产 fake 明确禁止。

UI 的倒计时和即时状态不是服务端事实：超时仍经权威 attempt RPC；结果页面无论正确或错误都显示正确英文与拆分后的 translations。生产启用必须同时有一次性数据库 RLS/幂等门禁、fake-provider Chromium 流程和独立真实 OpenRouter structured/API gate。

### 7.2 Fish Audio 翻译语音输入边界

0037–0038 已在生产启用：只有 translation-first spelling 的翻译输入框提供麦克风，NestJS 固定 `fish-audio/transcribe-1` 与 `language=zh`；service-role-only RPC 在供应商调用前验证 owner、active session、spelling stage、`translationFirst`、revision/current word，并独立预留分钟/本地日/月预算。识别结果只回填可编辑文本，不自动提交或判分；迟到结果若不再匹配当前题会被 Web 丢弃。WAV/transcript 不进 PostgreSQL、Storage、Cache、备份或业务日志，只有 `translation_stt` 配额事实持久化。

## 8. 数据与安全证据

0011–0013 建立私有课程、会话/尝试/progress、复习、分享/市场/举报/审核、徽章及 speech 配额；0014 补齐朗读候补池；0015 增加 revision、幂等 attempt 响应、snapshot 与私有音频队列，0016 对结构、RLS 和权限做发布断言；0017–0018 增加按意图恢复及验证；0019–0020 增加限时拼写、翻译评判及发布断言；0021–0022 统一 Unicode 拼写归一化；0023–0024 增加标点容错；0025–0026 增加显式取消会话及断言；0027–0028 增加 `exam` mode、轮末确认、考试进度 trigger、真实 provider 配额预留及验证；0029–0030 增加读音考试及验证；0031–0032 增加任意选词、失败补练完成事实、考试快照/历史及验证；0033–0034 增加双考试唯一掌握投影、编辑撤销和验证；0035–0036 增加精确派生 trigger 和发布断言；0037–0038 增加 `translation_stt` 用量、当前题/配额 RPC 与权限/结构断言。私有表只允许 owner 读；音频队列和翻译评判表连 SELECT 都不授予客户端；所有新 RPC 仅 service role 可执行。公开接口只暴露必要署名和课程快照。

删除课程级联私有学习数据和日程，但保留同账号下已发 points/badge facts；用户删除遵循 Auth 外键级联，出版物、points 与 badge awards 随账号删除，只有 speech 成本行和 moderation action 以 `user_id/actor_id=NULL` 留下非账号化运营事实。Storage 清理仍须删除编排。细节见 ERD、API、安全、隐私、内容审核和积分产品规则。

## 9. 验收边界

仓库测试覆盖逐单元/整份多单元解析、全局错误行列、编辑器批量追加与已有词重复、独立翻译字段、排序、状态恢复、候补池、跨日复习事实、编辑重置、积分指纹、API 鉴权/限流/Azure fake/公开脱敏、双用户 RLS、Playwright 主流程及 0007 升级夹具。0019–0020 另覆盖限时/翻译前测；0021–0022 覆盖全角/半角全大写及原始答案；0023–0024 覆盖标点容错；0025–0026 覆盖显式取消；0027–0028 覆盖考试和配额；0029–0030 覆盖读音考试；0031–0032 进一步覆盖任意选词、失败考试自动完成但不写熟练度、考试历史脱敏和客户端 RPC 拒绝；0033–0034 覆盖跨日复习不掌握、单项考试不掌握、双考试共同掌握、编辑撤销和唯一投影断言；0035–0036 覆盖手工 `learned_at`/单项事实不能绕过精确投影。录音单元/API 测试另断言静音、轻声、首尾和完整时长不被本地删除，Nest 向 Azure 转发相同 WAV 字节。Chromium 流程会实际断言 `.content` 可滚动、滚到底后“添加单元”进入 viewport，再继续保存和完整学习流程；这项布局验证不能由 jsdom 的零布局模型替代。

2026-07-22 的 PR run `29932310309` 与 main run `29932840103` 均通过 quality、0007→latest、空库重建、数据库 lint、一次性本地 Supabase 的双用户 RLS/Storage/Courses E2E 和 Chromium Playwright。Playwright 使用 Azure fake；main 发布另在激活前运行生产主机的真实 Azure gate，但本次 UI/文本导入变更没有修改语音行为。最终不可变 release 为 `d31af905b44ca4df39c70e271a7c7a51612916e3-29932840103-1`，公网复核包含 Web 200、`deps.supabase=ok`、未认证 `/api/me` 401，以及用户示例成功拆成 `Starter Unit 1`/`Starter Unit 2`、独立翻译输入和底部操作可达。

2026-07-23 的 PR run `29938780461`、main run `29939301081`、只读 plan `29939798432` 与 apply/deploy `29940292716` 逐层通过相同 quality、0007→0014、空库重建、database lint、真实 RLS/Storage 和 Chromium Playwright。生产只计划并应用 0014，保留加密恢复点 artifact `8538123165`；真实 Azure gate 得到 10,656-byte MP3 与 pronunciation 98.8，最终 release 为 `02ba1b682c104947aa0b80707c143b8e921870f0-29940292716-1`。独立复核确认公网 `deps.supabase=ok`、未认证 `/api/me` 401、运行 image 为同 SHA，且生产容器对不存在的 `vocabulary-audio` 对象返回正常 cache miss 而非错误。

2026-07-27 的 PR #21 run `30243998633`、main run `30244402278`、只读 plan `30244967669` 与 apply/deploy `30245430630` 通过 quality、0007→0016、空库重建/database lint、真实本地 Supabase RLS/Storage E2E 和 Chromium Playwright；Playwright 的 Azure 是 fake。plan 只列 0015–0016，apply 前保留 artifact `8644999285`，远端 history 到 0016。切流前 Japan East 真实 gate 验证 4 个首次生成对象、private Storage 命中、第二用户复用同 4 个对象、VAD 裁剪评分 97；release `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2-30245430630-1` 激活后，独立公网复核为 Web 200、`deps.supabase=ok`、未认证 `/api/me` 401。

同日后续 PR #24 run `30263277807` 与 main run `30263794368` 通过 0007→0018、空库重建/lint、真实本地双用户 RLS/Storage E2E、jsdom 和 Chromium Playwright；新增场景使用八词历史冷单元验证前五个 pending 立即提权、最多两个浏览器并发、manifest ready 后落 Cache Storage 并清除旧降级提示，也验证暂停 Unit 1 首次学习后可复习 Unit 2，完成后仍能恢复 Unit 1 原 cursor。只读 plan `30264327821` 仅列 0017–0018；apply/deploy `30264979509` 保留 artifact `8652623403`，远端 history 到 0018，激活 release `99313bd3763ce5bf1f7ffb252f821f7b21a67eec-30264979509-1`。Playwright 仍使用 fake provider；切流前独立真实 Japan East gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`，公网和服务器复核为 Web 200、匿名 `/api/me` 401、`deps.supabase=ok`，运行 Web/API 均为同一 SHA。

2026-07-28 的 PR #26–#29 完成功能与生产 gate 前向修复；只读 plan `30366334157` 仅列 0019–0020，受保护 run `30367263486` 创建 artifact `8691620673` 并把远端同步到 0020。前三个候选应用在 provider 契约、合成答案模型误判和 replay 映射处被 gate 拦截且自动恢复旧应用；最终 main run `30374301472` 激活 release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3`。真实 Japan East gate 返回 `generatedAssets=4`、`duplicateAssetsReused=4`、`assessmentScore=97`；真实 OpenRouter 为 1,365 ms、280 tokens；候选 API 持久证明规范化完全匹配为 0 token 且相同 UUID `replayed=true`。独立公网复核为 `deps.supabase=ok`、匿名 `/api/me` 401 和 React root。

2026-07-31 的 PR #35 把 Web 与数据库拼写判定收敛到同一 Unicode 契约；PR/main CI 和受保护 run `30616540480` 均通过 0007→0022、空库重建/lint、真实本地双用户 RLS/Storage E2E、jsdom/API 与 Chromium Playwright。只读 plan `30616030488` 仅列 0021–0022；apply 前保留 artifact `8787805291`，远端 history 到 0022。不可变 release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` 激活前通过真实 Japan East Azure、真实 OpenRouter 和候选 Courses API gate；独立公网复核为 `deps.supabase=ok`、匿名 `/api/me` 401 和 React root。自动化没有借用真实用户会话在生产提交拼写答案；生产 SQL 自验证和一次性真实 Supabase E2E 分别证明迁移结果与答题行为。

同日 PR #37 把仅标点遗漏、替换或增加纳入相同 Web/数据库判定契约。PR run `30620350644`、main run `30620879282` 与受保护 run `30624104943` 均通过 0007→0024、空库重建/lint、真实本地双用户 RLS/Storage E2E、jsdom/API 与 Chromium Playwright；只读 plan `30623522232` 唯一列出 0023–0024。apply 前保留 artifact `8790816378`，远端 history 到 0024；release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1` 激活前通过真实 Japan East Azure、真实 OpenRouter 和候选 Courses API/Storage gate。独立公网复核为 `deps.supabase=ok`、匿名 `/api/me` 401 和 React root。仍未借用真实用户会话在生产提交答案，因此不得把这些 gate 描述为生产用户流程 E2E。

2026-08-01 的 PR #40 将显式取消、轮末错题复盘/确认、考试模式和真实 provider 配额预留合入 main SHA `93354a56044470fb5d2b1fd6aeabcf82f459bb52`。PR run `30705662543` 与 main run `30705946921` 通过 0007→0028、空库重建/lint、真实本地双用户 RLS/Storage E2E、jsdom/API 与 Chromium Playwright；只读 plan `30706279006` 唯一列出 0025–0028。受保护 run `30706731292` 在 apply 前保留 artifact `8820657507`，远端 history 到 0028；release `93354a56044470fb5d2b1fd6aeabcf82f459bb52-30706731292-1` 激活前通过真实 Japan East Azure、真实 OpenRouter 和候选 Courses API/Storage gate。独立公网复核为 `deps.supabase=ok`、匿名 `/api/me` 401 和 React root；已登录只读检查确认既有课程/进度仍可读取，考试弹窗默认 90%，但没有在生产提交真实考试答案。

2026-08-03 的 PR #45 将读音考试、任意选词、失败补练完成事实、考试历史和双考试唯一掌握规则合入 main SHA `1a58d2164f6d58feea4d3a2c8925211b8cc60dde`。最终 PR run `30811283164` 与 main run `30811817461` 通过 0007→0034、空库重建/lint、真实本地双用户 RLS/Storage E2E、jsdom/API 与 Chromium Playwright；只读 plan `30812467085` 唯一列出 0029–0034。受保护 run `30813047562` 在 apply 前保留 artifact `8855819351`，远端 history 到 0034；release `1a58d2164f6d58feea4d3a2c8925211b8cc60dde-30813047562-1` 激活前通过真实 Japan East Azure、真实 OpenRouter 和 Courses API/Storage gate。独立公网复核为 `deps.supabase=ok`、匿名 `/api/me` 401、React root 和 Course Market 200；没有在生产提交真实用户考试，因此不能描述为生产用户流程 E2E。

2026-08-04 的 PR #47 将客户端 VAD/静音裁剪移除并把双考试掌握收敛为精确数据库 trigger 投影，合入 main SHA `51252527645d9438df0414f056c8a3b088b360d8`。PR run `30831319634` 与 main run `30831964846` 通过 0007→0036、空库重建/lint、真实本地双用户 RLS/Storage E2E、jsdom/API 与 Chromium Playwright；只读 plan `30832581552` 唯一列出 0035–0036。受保护 run `30833228406` 在 apply 前保留 artifact `8864033351`，远端 history 到 0036；release `51252527645d9438df0414f056c8a3b088b360d8-30833228406-1` 激活前通过真实 Japan East Azure、真实 OpenRouter 和 Courses API/Storage gate，后者报告未裁剪 `assessmentBytes=88444`。独立公网复核为 `deps.supabase=ok`、匿名 `/api/me` 401、新 React 资产和 Course Market 200；仍未在生产提交真实用户考试，因此不能描述为生产用户流程 E2E。

同日 PR #49 将中文翻译语音输入和三处共享实时波形合入 main SHA `66c919833693971ba1bda4ea33a3fdf6717ef1ca`。PR run `30904901828` 通过 0007→0038、空库重建/lint、真实本地双用户 RLS/Storage E2E、API/jsdom 和 Chromium Playwright；只读 plan `30906629924` 在一次瞬时 Supabase 上游错误后仅重跑失败 job 并通过，唯一列出 0037–0038。受保护 run `30907716733` 保留 artifact `8892006761` 后把远端同步到 0038，并激活 release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1`。真实 Japan East Azure、OpenRouter structured 和合成中文 WAV→真实 Fish Audio gate 均通过，生产待激活 API 返回 `transcriptionMatched=true`；独立公网与主机复核确认 `deps.supabase=ok`、匿名 `/api/me` 401、Web/API 同 SHA。合成 WAV 不代表真实用户口音或物理麦克风质量。

复习日程必须引用本人该单元已完成的 initial session；由日程启动时服务端固定使用其 skills/scope，并在 review session 完成事务里写回 completed session。普通 Vitest/jsdom 不等于真实数据库 E2E；本地无 Supabase CLI/Docker 时 RLS 和 Playwright 会跳过或无法启动，只有一次性 Supabase CI 成功后才能称真实 E2E 已通过。

## 10. 明确未实现

PDF、DOC/DOCX、JSON、Markdown、HTML、图片 OCR/解析，多类别 prompt，结构化词表生成、人工确认、评测集、token/成本与隐私留存都属于后续 AI 导入阶段；本版不得在 UI、文档或发布说明中标为已实现。知识点学习、阅读理解和题库训练同样只是禁用的类别占位。
