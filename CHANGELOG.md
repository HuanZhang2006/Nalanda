# 变更日志

> **本文内容：**按版本/日期记录面向用户、开发者、数据和运维的重要新增、变更、修复、安全事项与废弃项。  
> **作用：**提供从发布结果回溯代码、迁移和运营影响的入口；它不是 Git 提交列表，也不替代发布说明。  
> **何时更新：**每个可发布 PR 合并时更新 `Unreleased`；正式发布时移动到带日期版本；紧急安全修复公开范围由安全负责人决定。  
> **状态基线：**2026-07-22。历史条目依据 Git 历史和受保护发布记录归纳；尚未发布的工作只列在 `Unreleased`，不得据此声称生产已启用。

格式参考 Keep a Changelog，版本策略在首个稳定 API 发布前保持 `0.x`。分类使用 Added、Changed、Fixed、Security、Deprecated、Removed。

## [Unreleased]

### Changed

- Courses、学习/复习流程、公开分享与 Course Market 统一使用默认英文、可持久切换中文的前端 locale；课程 API 稳定错误码在 Web 端按当前语言显示。
- `courses.css` 只保留课程专属布局，并把字体、字号、颜色、按钮、输入框、卡片、弹窗、边框、圆角、阴影、focus/disabled 状态和响应式断点对齐现有 Nalanda 设计 token。

### Fixed

- 修复 Courses/Course Market 与现有主界面在表单底色、卡片密度、空状态、交互焦点和移动端布局上的视觉不一致；语言切换不会改变课程业务行为或 API 契约。

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
