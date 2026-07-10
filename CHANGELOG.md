# 变更日志

> **本文内容：**按版本/日期记录面向用户、开发者、数据和运维的重要新增、变更、修复、安全事项与废弃项。  
> **作用：**提供从发布结果回溯代码、迁移和运营影响的入口；它不是 Git 提交列表，也不替代发布说明。  
> **何时更新：**每个可发布 PR 合并时更新 `Unreleased`；正式发布时移动到带日期版本；紧急安全修复公开范围由安全负责人决定。  
> **状态基线：**2026-07-10。历史条目依据 Git 历史归纳；尚未发布的工作只列在 `Unreleased`。

格式参考 Keep a Changelog，版本策略在首个稳定 API 发布前保持 `0.x`。分类使用 Added、Changed、Fixed、Security、Deprecated、Removed。

## [Unreleased]

### Added

- 建立项目蓝图/最终说明、ERD/API、本地开发、环境变量、测试、数据库发布/回滚、备份恢复、监控告警和密钥轮换等文档体系。
- 建立 SECURITY、CONTRIBUTING、ADR、隐私与数据删除、内容审核、AI 评测/成本以及 points/credits/VIP/支付统一规则。
- 为文档宣称的 Web jsdom 与 Supabase 双用户 RLS/Storage E2E 补充可执行测试基线；API HTTP、FastAPI 和真浏览器 E2E 仍明确列为待补。

### Changed

- 旧文档按当前代码与迁移重新标注“当前、部分实现、目标”，不再把蓝图能力描述为已经上线。

### Security

- 文档化当前 profile 服务端字段可写、definer 函数执行授权和 points 非幂等等高优先级风险；对应代码修复完成前仍属于开放事项。

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
