# Supabase：数据库、鉴权、Storage 与迁移

> **文档定位**
> - **内容**：说明本目录当前包含的迁移、数据库应用方式、认证现状和已知安全缺口。
> - **作用**：作为 Supabase 目录入口；完整关系看 ERD，正式发布/回滚看数据库操作手册。
> - **何时更新**：新增/修改迁移、bucket、RLS、认证设置或数据库发布方式时。

最后核对：2026-07-22。生产 history 当前到 0010；0011–0013 是仓库待发布增量。

## 当前内容

| 迁移 | 内容 |
|---|---|
| `20260620000001_profiles.sql` | profiles、自动建档、updated_at、owner RLS |
| `20260624000002_courses_materials.sql` | courses、materials、私有 materials bucket |
| `20260624000003_materials_course_check.sql` | materials 外键课程归属加固 |
| `20260624000004_notifications_feedback.sql` | notifications、feedback |
| `20260625000005_community.sql` | posts、comments、likes、favorites、follows、计数/作者触发器 |
| `20260625000006_points_tags_notify.sql` | points、tags、公开社区媒体、互动通知和等级 |
| `20260625000007_schedule.sql` | study_goals、study_tasks、streak、任务完成奖励 |
| `20260710000008_security_points_ledger.sql` | Profile 列级写保护、内部 RPC 撤权、`point_entries`/`point_event_states`、稳定业务键、冲正与幂等奖励 |
| `20260721000009_reset_legacy_points.sql` | 以追加式 reversal 将不可信 `legacy_opening` 归零，并重建 Profile points/level 投影 |
| `20260721000010_verify_security_points_release.sql` | 只读断言 Profile 权限、内部 RPC、opening reversal 和账本投影，失败即阻断发布 |
| `20260722000011_learning_courses.sql` | 独立学习课程/会话/attempt/progress/复习、分享/市场/举报、徽章、speech usage、timezone 与私有 TTS cache |
| `20260722000012_learning_course_workflows.sql` | service-role-only 原子保存/答题/成长/+20/日程/语音配额/分享/发布/克隆/举报/审核 RPC |
| `20260722000013_verify_learning_courses_release.sql` | 只读断言 Courses RLS、客户端写/RPC 拒绝、徽章、timezone 和 owner 链 |

仓库最终结构共 30 张 public 业务/配置表和三个 Storage bucket；生产到 0010 时仍是 15 表/两 bucket。关系、删除行为和策略见 [ERD](../docs/guides/ERD.md)。

## 应用迁移

正式环境请遵循 [数据库发布与回滚](../docs/operations/DATABASE_RELEASE_ROLLBACK.md)。CI 自动暂存全部 0008+ 先验证真实 0007→latest 升级，再空库重建/lint、运行 RLS/Storage/points/Courses E2E 和 Playwright。生产先只读 plan，再由 owner apply/加密恢复点。旧 baseline 流程已于 2026-07-21 完成，remote history 当前同步至 0010；0011–0013 必须另走受保护发布，不得因仓库文件存在就视为远端已应用。

本地基线：

```bash
supabase start
supabase db reset --local --no-seed
supabase db lint --local --schema public --level error --fail-on error
```

远端正常方案是 Supabase CLI migration history：

```bash
supabase link --project-ref <明确的项目 ref>
supabase db push --dry-run
supabase db push
```

仓库还保留 Management API 脚本：

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx \
SUPABASE_PROJECT_REF=<明确的非生产或已确认项目 ref> \
ALLOW_LEGACY_DB_PUSH=YES \
node scripts/db-push.mjs
```

警告：该脚本已移除默认 Ref 并强制应急开关，但仍不维护 history、没有跨文件事务，不属于正常发布。旧生产若曾人工应用迁移，首次 CLI 发布必须先按操作手册逐项核对并 baseline/repair history，禁止盲目 `--include-all`。

SQL Editor 只作为紧急/初始化兜底。手动执行后必须记录执行人、时间、目标项目、SQL hash 和验证结果，避免数据库状态脱离版本控制。

## 当前认证设置

- Web 登录直接使用 Supabase Auth。
- 注册先调用 `POST /api/auth/register`，NestJS 使用 service-role 创建 `email_confirm:true` 的用户。
- 因此当前流程没有验证邮箱所有权；不能再把“切换 Confirm email”当作当前注册方案。
- 正式增长前需接 SMTP、邮箱验证、找回密码、限流/CAPTCHA 和滥用监控。

## 当前 RLS 原则

- owner-only 表以 `auth.uid()` 限制行所有者。
- 关联到另一张 owner 表时，外键存在不等于有权限，必须在 `with check` 验证归属。
- 社区帖子/评论对 authenticated 公共读，写仍限作者。
- Storage 私有资料按对象路径第一段 user id 隔离。
- Courses 私有表只给 owner SELECT；authenticated 无写表权限，所有保存/答题/成长/传播通过 API service-role RPC。公开分享/市场不开放匿名 PostgREST。

RLS 只限制行，不能自动保护同一行中的敏感列。0008 因此撤销 Profile 整表 UPDATE，只向 authenticated 授予 `username/university/major/year/language` 列更新，并用防御触发器保护 `credits/points/level/vip/streak`；`_add_points` 已对所有客户端及 service-role 撤权，`_notify`、`_set_point_event` 和 trigger helpers 也不再是客户端 RPC surface。

当前 points 已由 append-only `point_entries`、内部 `point_event_states` 和 Profile projection 维护；点赞、评论、原创/转发和任务取消/删除会冲正，重做只恢复同一业务事件净额。0008 导入的迁移前余额会由 0009 追加等额 reversal 归零，不删除审计记录；仍缺每日奖励上限和内容质量反滥用。`credits`/`vip_until` 虽不可由客户端修改，但还没有订单、credits/VIP 事实账本，不能作为商业能力启用。

## 验证

任何 RLS/授权变更至少用用户 A/B 验证：本人允许字段成功、敏感列/RPC/ledger/progress 写入失败、他人不可读写、外键不能指向他人对象。当前四组 RLS E2E、发布工具单元、0007→latest 升级和 Playwright 会在 PR/main 运行；本机无显式环境时 RLS suite 安全跳过。命令见[测试指南](../docs/guides/TESTING.md)。
