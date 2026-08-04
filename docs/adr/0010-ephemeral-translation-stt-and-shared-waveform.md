# ADR 0010：临时翻译 STT 与共享录音波形

> **文档定位**
> - **内容**：记录为何翻译语音输入使用服务端 OpenRouter Fish Audio、为何只回填不提交，以及所有录音入口如何共享本地实时波形。
> - **作用**：固定密钥、owner/session、隐私、判分权威和供应商发布边界，防止把 STT 误作答题事实或把音频长期保存。
> - **何时更新**：STT 供应商/model/language、音频格式/留存、配额、回填交互、录音 UI、真实评测或发布状态变化时；结论改变时用新 ADR 替代。
> - **状态**：Accepted；2026-08-04。0037–0038 与应用已完成受保护生产发布；真实供应商证据使用合成中文 WAV，不等同于真实口音质量评测。

## 背景

translation-first spelling 已允许用户键入中文翻译，再由既有服务端语义判分决定是否进入拼写。产品需要在该输入框提供语音输入，同时认词朗读反馈和读音考试也需要在采集音频时给出一致、即时的波形反馈。

STT 结果可能受口音、噪声和同音词影响，因此不能自动提交，更不能直接影响 retry pool、错误次数、进度或奖励。OpenRouter key 现已在 NestJS 用于语义判分，不能再发给浏览器。录音属于用户内容，还需要限制处理目的和留存。

## 决策

1. 语音入口只存在于 translation-first spelling 的翻译输入框右端；普通翻译选择题、英文拼写输入和其它文本框不开放。
2. NestJS 复用既有 `OPENROUTER_API_KEY`，通过 OpenRouter 专用 `/audio/transcriptions` endpoint 固定调用 `fish-audio/transcribe-1`，默认 `language=zh`。文本判分和 STT 分别配置 model、timeout 与配额；浏览器不能覆盖这些参数。
3. 供应商调用前，service-role-only `learning_reserve_translation_stt` 在一个事务内验证 owner、active spelling session、`translationFirst=true`、当前 word 和 expected revision，并写独立分钟/本地日/月预算 reservation。普通客户端无函数执行权，也不能读 usage 表。
4. 浏览器录制最多 6 秒的 16 kHz、16-bit、单声道 PCM WAV；API 保持 2 MB/8 秒上限。WAV 只在浏览器与单次 NestJS/OpenRouter 请求内存中存在，不进入 PostgreSQL、Supabase Storage、Cache Storage、备份或日志。transcript 同样不落库。
5. 成功 transcript 只回填原输入框，不自动调用语义判分。用户可修改后明确提交；只有既有 translation assessment/spelling transaction 才能形成学习事实。若响应到达时 revision 或当前 word 已变化，Web 丢弃 transcript。
6. `beginWavRecording` 从同一 PCM frame 派生有限幅值条；React `AudioWaveform` 只做实时视觉反馈，不改变或裁剪送给供应商的样本。认词朗读、读音考试和翻译语音输入使用同一组件、主题 token、无障碍标签和中英文词条。
7. 自动化使用 `OPENROUTER_FAKE=true` 验证契约和浏览器流程，production 显式拒绝 fake。生产激活前必须通过真实 structured 文本判分，以及 Azure 合成固定中文 WAV 经候选 API 到 Fish Audio 的独立 gate；fake/单元测试不构成供应商证据。2026-08-04 的受保护发布已通过该真实 gate。

## 考虑过的方案

### 浏览器 Web Speech Recognition

接入快且可免服务器上传，但浏览器/平台支持、隐私条款、语言模型和结果一致性不可控，也难以统一配额与发布 gate。可作为未来显式降级方案重新评估，当前不采用。

### 浏览器直连 OpenRouter

会泄露 key，允许客户端更换 model/language，并绕过 owner/session/cost 控制，拒绝采用。

### 识别结束自动提交

步骤更少，但会把不确定 transcript 直接变成可能影响错误次数和考试结果的用户答案。采用“回填、可编辑、用户明确提交”。

### 保存音频或 transcript 用于模型评测

便于离线调试，却扩大隐私、导出/删除和跨境处理范围。当前只使用授权的合成/专家评测集，不保存生产用户正文。

## 后果与验证

- 优点：密钥不出后端；STT 不获得答题权威；同一页面已切题或换会话时会丢弃迟到响应，跨设备推进后的旧文本也无法通过 revision 校验提交；三处录音体验一致；用量可跨 API 实例限流。
- 代价：每次识别需要网络与供应商延迟，provider 失败时只能保留键盘输入；reservation 在供应商失败时仍会保守计入预算；没有原始音频意味着不能事后重放生产问题。
- 最低验证：types/API/Web typecheck；WAV/waveform、adapter/error、jsdom 回填与可编辑测试；双用户真实 Supabase RPC/RLS/配额；fake-provider Chromium；受保护真实 Fish Audio gate、数据库 plan/恢复点/apply 和公网 readiness。
- 发布证据：PR #49 run `30904901828`、只读 plan `30906629924`、apply/deploy `30907716733`、恢复 artifact `8892006761` 与不可变 release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1`。独立生产主机复核确认 Web/API 同 SHA；真实 Fish gate 的 `transcriptionMatched=true` 只证明固定合成样本与当时供应商可用。
