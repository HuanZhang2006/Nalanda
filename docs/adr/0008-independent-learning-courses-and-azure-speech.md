# ADR 0008：独立学习课程模型与 Azure Speech 适配层

> **文档定位**
> - **内容**：记录 Courses 不复用 Materials 表、特权学习写入经 API/RPC，以及语音能力通过 Azure 适配层实现的决策。
> - **作用**：固定长期数据、安全、供应商和隐私边界，避免后续把资料目录、学习事实或录音处理重新混在一起。
> - **何时更新**：课程领域边界、公开传播模型、语音供应商、录音留存、安全写入方式、弱网/缓存事实源或替代 ADR 变化时。
> - **状态**：Accepted；2026-07-27。0011–0016 已生产启用；revision/outbox、持久 TTS 队列与浏览器缓存已完成受保护发布。

## 背景

现有 `courses/materials` 表表达用户资料目录，不具备单元、词条、学习会话、append-only 尝试、跨日期熟练度、复习日程和不可变市场版本。直接扩表会把资料所有权与学习状态耦合，并增加旧 Materials 回归风险。发音合成和朗读评分还涉及密钥、配额、录音隐私、供应商故障与成本边界，不能由浏览器直接调用。

## 决策

1. 新建 `learning_*` 课程域，Materials 保持不变；Schedule 与 Profile 只在展示/API 聚合两域。
2. 私有内容只允许 owner 读取。整课保存、答题推进、progress、复习日程、分享、发布、克隆、举报和审核经 NestJS 身份校验与 service-role 专用事务 RPC；RPC 默认撤销客户端执行权。
3. 会话事实与尝试追加保存，progress 是受保护投影。编辑按字段语义精确重置能力，已发积分与徽章作为历史事实不回写。
4. 分享读取当前内容；市场采用不可变版本快照。克隆是进度为零的独立私有副本，克隆课不能再传播。
5. Azure Speech 封装在服务端 adapter。TTS 按规范化 term、locale、voice、format 和 synthesis version 的内容 hash 在 private Supabase Storage 跨课程复用；无 owner 持久队列是生成协调事实源，不增加第二套服务器文件缓存。用户录音只在请求内存中处理，不落库、不缓存。客户端只能提交当前课程的 word/session 标识，不能自定参考文本。
6. Azure 故障时课程继续可用：浏览器朗读替代 TTS，朗读评分关闭。配额、月预算、熔断和 feature flags 是上线门。
7. 文件 AI 导入不属于本决策的已实现范围；入口只能明确标记即将推出。
8. 每个会话使用服务端单调 revision；每个答案使用客户端生成的 UUID 并由 `(user,session,attempt)` 唯一。服务端事务是 retry pool、阶段、进度、成长事实的唯一权威；浏览器即时预测和 IndexedDB outbox 只提供反馈/重试，不能直接完成课程或发奖励。
9. 浏览器 Cache Storage 是可删除、可回收、可重建的音频副本，用于未来五词预取和用户主动下载单元；完整离线 Web/PWA app shell 不在本决策范围。

## 被否决的方案

- **扩展 Materials `courses`**：迁移少，但混淆资料目录与学习状态、删除语义和市场版本。
- **前端直写所有学习表/RPC 或以预测状态发奖励**：响应路径短，但客户端能伪造进度、熟练度、徽章和 points。
- **浏览器直连 Azure**：会泄露密钥，无法可靠执行参考文本约束、全局预算和录音留存政策。
- **保存用户录音供复查**：调试更方便，但显著扩大敏感数据、删除和泄露风险；首版不接受。
- **请求路径同步等待 Azure / 服务器本地第二缓存**：前者放大首播延迟和供应商抖动，后者制造两个服务端事实源；改用持久队列、private Storage 和客户端可重建缓存。

## 后果

正向结果是领域隔离、安全写入、可恢复状态机、可审计成长事实和可替换语音供应商。代价是表/RPC 数量增加，API 需要显式 snake_case↔camelCase 转换，Schedule/Profile 要聚合两域，市场快照需要版本与审核维护，CI 必须运行真实 Supabase 与 Azure fake adapter。

## 发布与验证

0011–0013 只追加对象并包含客户端 EXECUTE 拒绝断言；0014 已补齐评分候补池。0015 追加 revision、attempt 幂等响应和音频队列，保留旧 RPC 签名供应用回滚；0016 验证列、触发器、RLS 和 service-role-only 权限。2026-07-27 已按 migration plan、加密恢复点、apply、lint/dry-run、不可变应用 release 和 Japan East 真实 Azure gate 的顺序发布；gate 证明首次生成、Storage 命中、跨用户重复词不增加生成和裁剪评分。回滚关闭 flags 或恢复应用 release；数据库只做向前修复。

验证入口：解析器/jsdom/API Vitest、双用户 RLS E2E、Playwright 端到端、迁移空库和 0007 升级夹具。普通 mock 测试不能替代数据库或供应商 smoke。
