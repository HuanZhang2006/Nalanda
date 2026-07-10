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

当前共 13 张 public 业务表和两个 Storage bucket。关系、删除行为和策略见 [ERD](../docs/guides/ERD.md)。

## 应用迁移

正式环境请遵循 [数据库发布与回滚](../docs/operations/DATABASE_RELEASE_ROLLBACK.md)，先备份、在 staging 验证，再显式指定目标项目。

推荐长期方案是 Supabase CLI 的迁移历史：

```bash
supabase link --project-ref <明确的项目 ref>
supabase db push --dry-run
supabase db push
```

仓库还保留 Management API 脚本：

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx \
SUPABASE_PROJECT_REF=<明确的非生产或已确认项目 ref> \
node scripts/db-push.mjs
```

警告：脚本当前带历史默认 project ref。不要省略 `SUPABASE_PROJECT_REF`；后续应修改脚本为缺失即失败，并迁移到带历史表的 CLI 流程。

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

RLS 只限制行，不能保护同一行中的敏感列。当前 Profile 的 points、credits、level、VIP、streak 仍可由本人整行更新；`_add_points`、`_notify` 也需显式撤销客户端 execute。修复前不能把成长或钱包当作可信账本。

## 验证

任何 RLS 变更至少用用户 A/B 验证：本人成功、他人不可读/写、外键不能指向他人对象、service-role 仅出现在受控后端。可执行套件和环境保护见 [测试指南](../docs/guides/TESTING.md)。
