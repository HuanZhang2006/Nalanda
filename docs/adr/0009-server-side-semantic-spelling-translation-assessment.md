# ADR 0009：服务端语义翻译前测与会话级拼写设置

> **文档定位**
> - **内容**：记录拼写测试的限时/翻译前测如何进入学习状态机，以及为何使用 NestJS 服务端 OpenRouter 适配层、hash-only 持久事实和同一 attempt UUID。
> - **作用**：固定安全、隐私、幂等、供应商与回退边界，防止后续把模型判定、计时或奖励权威移到浏览器。
> - **何时更新**：拼写设置语义、模型/供应商、prompt/schema、输入留存、配额、attempt/revision 契约、发布状态或替代 ADR 变化时。
> - **状态**：Accepted；2026-07-28。0019–0020 与应用已完成受保护生产发布。

## 背景

普通拼写已有服务端权威 attempt/revision/retry pool，但没有答题时间限制，也只能检查英文拼写。产品需要让用户可选每词倒计时，并在拼写前键入中文翻译；翻译无需与参考字符串逐字一致，因此不能只做 trim/equality。这个判定会影响错误次数、候补池和进度，不能由客户端或未经约束的供应商响应直接决定。

用户输入翻译具有内容隐私，供应商 key 不能进入浏览器；网络超时和重复点击也不能造成重复模型费用或重复错误。数据库先行发布还必须兼容当前生产应用。

## 决策

1. 限时与翻译前测是 `learning_sessions.spelling_options` 的会话级不可变规则，缺省均关闭、默认时间 20 秒，合法范围 3–300 秒。只有 session revision 仍为 0 时启动请求可以写入设置。
2. 倒计时由 Web 显示和触发，但超时仍通过正常权威 spelling attempt 提交；客户端计时不直接改变 retry pool、progress、points 或徽章。
3. 翻译前测先在 NestJS 特权边界执行确定性规范化完全匹配：用户答案经 NFKC、首尾/重复空白与大小写规范化后若等于任一服务端参考 translation，必须判对并记录 `nalanda-normalized-exact/normalized-exact-v1`，不调用外部供应商。只有非字面同义/改写才由 adapter 调用 OpenRouter；首个锁定模型为 `google/gemma-4-26b-a4b-it:free`，使用 temperature 0 和严格 JSON schema `{correct:boolean}`。模型只决定这些非字面答案的 boolean，API 生成固定安全 feedback；浏览器不能提交参考 translations、model、provider 或 prompt。
4. NestJS 必须先由 owner/session/current-word RPC 领取评判租约与用户配额，再在请求内存中发送英文、参考 translations 与用户答案。数据库只保存答案 SHA-256、provider/model、boolean、短反馈、token usage、租约和首次响应；不保存用户输入正文。
5. 翻译评判和随后的 spelling 使用同一个客户端 UUID 与 expected revision。翻译错误在同一数据库事务中形成一次 spelling 错误；翻译正确不推进 revision，但后续 spelling wrapper 必须确认该 UUID/revision 已有正确评判。相同 UUID/输入重放返回首次响应，不再次调用 provider 或重复推进。
6. 确定性完全匹配不消耗 provider token；非字面答案遇到 provider timeout、网络/5xx/429 或非法 structured output 时释放租约并返回可重试错误，不记学习错误。HTTP 200 缺失合法 boolean 时可在同一 12 秒总预算内重试一次；空/缺失 feedback 不推翻合法 boolean，而使用固定安全文案。revision 冲突继续以服务器快照处理。
7. 新表和所有 claim/complete/release/spelling RPC 对 `public/anon/authenticated` 无表权限/执行权，只授予 service_role；生产显式拒绝 `OPENROUTER_FAKE=true`。
8. UI 在正确/错误结果都显示权威英文拼写与拆分 translations。provider feedback 只是教学说明，不成为参考答案或成长事实。
9. 0019 保留旧 session start/attempt 签名供数据库先行和应用回退；生产异常先关闭最窄 feature flag或恢复上一不可变应用 release，数据库只做 forward-fix。

## 考虑过的方案

### 客户端字符串/模糊匹配

延迟和成本最低，但难以可靠覆盖同义改写、多义词与短语，也会把影响进度的判定权交给可篡改客户端。因此只保留本地计时，不采用客户端语义事实。

### 浏览器直接调用 OpenRouter

实现简单，但会泄露 key、参考 translations 和 prompt，无法统一限额、租约、审计与供应商切换，拒绝采用。

### 把翻译前测作为独立 translation skill attempt

可复用现有表，但产品规则要求翻译错误直接判定本词拼写流程错误；独立 skill 会错误提升/影响翻译熟练度。采用专用评判事实 + spelling attempt。

### 保存原始答案以便质量分析

便于离线评测，但扩大个人内容、导出/删除、日志与供应商风险。首版只保存 hash；质量评测使用授权的合成/专家数据集。

### 复用 FastAPI AI 桩

会把一个可同步、窄结构的学习判定绑到尚未实现的文件解析/生成任务架构。当前放在 NestJS 特权学习边界，未来如迁移供应商仍保持同一 adapter 契约。

## 后果

正面结果是：计时不破坏服务端权威；完全一致答案不受模型波动影响且零供应商延迟/成本；语义近义回答仍可被接受；超时/重放不会重复记错或重复调用；原文留存最小；供应商可由 feature flag 快速隔离。

代价和风险是：每个开启前测的词多一次外部延迟和潜在费用；LLM 仍可能误判；free route 的额度、价格、可用性和隐私条款可能变化；正确评判后 session revision 不变，需要 UUID 把两步可靠关联。必须监控 schema failure、false accept/false reject、provider latency/token、用户配额与 replay 比例，并允许用户关闭该选项。

## 当前实现与目标差距

- **仓库与生产**：0019–0020、共享 TS 契约、NestJS adapter/API、React 设置/计时/结果、jsdom/API/RLS/Playwright 和真实 provider/API smoke 均已实现并发布；0021–0024 后续统一确定性拼写归一化并加入仅标点差异容错；0027–0028 将滚动 24 小时配额改为只在真实 provider 请求发出前原子预留，默认上限 500 次，并把翻译前测复用于考试模式。这些变化不改变本 ADR 的服务端权威与最小正文留存边界，当前生产 history 为 0028。
- **发布证据**：只读 plan `30366334157`、恢复/apply run `30367263486`、最终 main run `30374301472` 与 release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3`。中途失败候选全部自动恢复旧应用，数据库保持向前兼容。
- **后续目标**：建立正式授权语义评测集与 false-accept/false-reject 阈值、持续 cost/latency dashboard、用户告知和供应商条款复审。模型/base URL 变更需重新评测，不作为普通 key 轮换处理。

## 验证与复审

每次相关发布必须证明：计时只提交一次；翻译通过前不启动计时；错误评判等待手动下一题；供应商失败不记错；正确/错误都展示英文和翻译；双用户不能读取表/执行 RPC；同 UUID 并发/重放只产生一个 attempt；数据库没有用户答案正文；真实 provider 对固定同义/无关样本返回有效 structured output。真实 smoke 只证明连通和最小语义，不替代质量评测。

触发复审：模型/路由/价格/隐私条款变化；false accept/false reject 超阈值；provider 5xx/timeout 持续异常；用户输入留存需求变化；或评判扩展到其它课程类别。
