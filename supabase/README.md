# Supabase：数据库、鉴权、Storage 与迁移

> **文档定位**
> - **内容**：说明本目录当前包含的迁移、数据库应用方式、认证现状和已知安全缺口。
> - **作用**：作为 Supabase 目录入口；完整关系看 ERD，正式发布/回滚看数据库操作手册。
> - **何时更新**：新增/修改迁移、bucket、RLS、认证设置或数据库发布方式时。

最后核对：2026-07-10。

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

当前共 15 张 public 业务表和两个 Storage bucket。关系、删除行为和策略见 [ERD](../docs/guides/ERD.md)。

## 应用迁移

正式环境请遵循 [数据库发布与回滚](../docs/operations/DATABASE_RELEASE_ROLLBACK.md)。仓库已提交 `config.toml`；CI 会先验证 0007→0010 历史数据升级、opening reversal 和发布断言，再从空库重建、lint、运行本地真实 RLS/Storage/points E2E。生产先用 `plan_database_migrations` 只读核对 history/dry-run，再由 owner 使用 `apply_database_migrations` 创建加密恢复点；若旧项目 history 为空，只有 public schema 与 0001–0007 零差异且 Storage policy/bucket 匹配时才记录 baseline 并继续发布。

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

RLS 只限制行，不能自动保护同一行中的敏感列。0008 因此撤销 Profile 整表 UPDATE，只向 authenticated 授予 `username/university/major/year/language` 列更新，并用防御触发器保护 `credits/points/level/vip/streak`；`_add_points` 已对所有客户端及 service-role 撤权，`_notify`、`_set_point_event` 和 trigger helpers 也不再是客户端 RPC surface。

当前 points 已由 append-only `point_entries`、内部 `point_event_states` 和 Profile projection 维护；点赞、评论、原创/转发和任务取消/删除会冲正，重做只恢复同一业务事件净额。0008 导入的迁移前余额会由 0009 追加等额 reversal 归零，不删除审计记录；仍缺每日奖励上限和内容质量反滥用。`credits`/`vip_until` 虽不可由客户端修改，但还没有订单、credits/VIP 事实账本，不能作为商业能力启用。

## 验证

任何 RLS/授权变更至少用用户 A/B 验证：本人允许字段成功、敏感列/RPC/ledger 写入失败、他人不可读写、外键不能指向他人对象。当前 3 组 RLS E2E、5 个发布工具单元测试与独立 0007→0010 升级夹具会在 PR/main 运行；本机无显式环境时 RLS suite 安全跳过。命令见[测试指南](../docs/guides/TESTING.md)。
