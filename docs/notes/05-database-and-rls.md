# 05 · 数据库 / 迁移 / RLS

> **文档定位**
> - **内容**：记录当前 Supabase/Postgres、RLS 范式、迁移清单和迁移工具局限。
> - **作用**：作为数据层实现入门；完整关系看 ERD，正式发布/回滚看 operations 手册。
> - **何时更新**：新增迁移、RLS 模式、迁移工具或数据库发布流程变化时。

> 目标：数据存哪、怎么保证「每个人只能动自己的数据」（RLS），以及改表结构的工作流（迁移 + 一条命令自动应用）。鉴权相关的 profiles 表见 [02 用户系统与认证](02-auth-and-user-system.md)。

## 1. 数据库是什么
用 **Supabase** = 托管 **PostgreSQL** + 周边（Auth、Storage、Realtime、自动生成的 PostgREST）。前端用 `supabase-js` 直接读写表，**安全靠 RLS 在数据库层兜底**，不是靠前端自觉。

## 2. RLS（行级安全）—— 整个项目的安全基石
开了 RLS 的表**默认拒绝一切**，必须写策略放行。统一用「owner-only」模式：
```sql
alter table public.X enable row level security;
create policy X_all_own on public.X
  for all to authenticated            -- 仅登录用户
  using (user_id = auth.uid())        -- 可读/改的行
  with check (user_id = auth.uid());  -- 可写入的行
```
- `auth.uid()` = 当前请求 JWT 里的用户 id，由 Supabase 解出，前端伪造不了。
- 表上 `user_id uuid not null default auth.uid()`：插入不用传 user_id，数据库自动填当前用户。
- 结果：A 的查询永远只返回 A 的行。

> 心法：**前端的过滤只是体验，真正的隔离写在 RLS 里。**

RLS 只判断“哪一行”，不会自动判断“同一行的哪些列”。包含余额、角色、状态或审核字段的表还必须使用列级 GRANT、命令拆分策略或防御触发器；`SECURITY DEFINER` 函数必须固定 `search_path` 并撤销默认客户端 EXECUTE。

## 3. 现有迁移（`supabase/migrations/`）
| 文件 | 内容 |
|---|---|
| `0001_profiles.sql` | `profiles`（绑 auth.users）+ 注册自动建档触发器 + owner-only RLS（见 [02](02-auth-and-user-system.md)） |
| `0002_courses_materials.sql` | `courses` / `materials` 表 + RLS；私有 Storage 桶 + 存储策略（见 [06](06-materials.md)） |
| `0003_materials_course_check.sql` | 加固：materials 只能挂到自己拥有的课程（[06](06-materials.md) 的越权修复） |
| `0004_notifications_feedback.sql` | notifications / feedback + owner-only RLS |
| `0005_community.sql` | posts / comments / likes / favorites / follows + 计数触发器 |
| `0006_points_tags_notify.sql` | points、tags、社区媒体、互动通知与等级函数 |
| `0007_schedule.sql` | study_goals / study_tasks、streak 与完成任务触发器 |
| `0008_security_points_ledger.sql` | Profile 敏感列白名单、内部 RPC 撤权、稳定 points 业务键、`point_entries`/`point_event_states` 与冲正触发器 |
| `0009_reset_legacy_points.sql` | 用 append-only reversal 归零不可信 opening，并重建 Profile points/level 投影 |
| `0010_verify_security_points_release.sql` | 只读断言 Profile 写权限、内部 RPC、opening reversal 和账本投影 |
| `0011_learning_courses.sql` | Courses 内容/学习/复习/传播/徽章/speech usage、timezone 与 TTS cache；客户端只读私有数据 |
| `0012_learning_course_workflows.sql` | service-role-only 原子保存/会话/答题/成长/分享/市场/审核 RPC |
| `0013_verify_learning_courses_release.sql` | Courses RLS、写权限/RPC、badge/timezone/owner 链发布断言 |
| `0014_learning_feedback_flow.sql` | 朗读整体分数阈值的 recognition 候补池加入/移除，以及认词候补轮推进；重申评分 RPC 仅 service-role 可执行 |
| `0015_learning_performance_offline_audio.sql` | session revision、幂等 attempt/首次响应、单 RPC snapshot、朗读目标校验、private TTS 生成队列/配额/租约 |
| `0016_verify_learning_performance_release.sql` | 断言 0015 结构、唯一约束、revision 触发器、队列 RLS/客户端撤权及全部新 RPC 仅 service role |
| `0017_learning_session_intent_resume.sql` | 回填非空 `resume_key`，以 course/unit/mode/scope/排序 skills 或 schedule ID 区分 active session 意图，并替换 `learning_start_session` |
| `0018_verify_learning_audio_review_fix.sql` | 断言 0017 列/意图唯一索引/活动排序索引、函数定义及 service-role-only 权限 |
| `0019_learning_spelling_timer_translation.sql` | session 拼写选项、只保存答案 hash 的翻译评判事实、租约/配额/幂等响应，以及 service-only 翻译评判与 spelling wrapper RPC；保留旧签名供应用回退 |
| `0020_verify_learning_spelling_release.sql` | 断言 0019 列、评判表 RLS/客户端撤权、新 RPC 精确签名与 service-role-only grants |
| `0021_learning_spelling_unicode_normalization.sql` | 新增内部 Unicode 拼写归一化 helper，并让七参数权威 attempt RPC 对原始答案和课程 `term` 使用同一规范化契约；保留原始提交文本 |
| `0022_verify_learning_spelling_unicode_normalization.sql` | 断言全角大写、Unicode 空白、撇号/连字符变体和标点保留语义，并验证 helper/七参数 RPC 只允许 service role |

## 4. 迁移怎么写（力求可重放）
当前 SQL 使用以下模式降低重复执行失败的概率：
- `create table if not exists` / `create index if not exists`
- `drop policy if exists … ; create policy …`
- `create or replace function` / `drop trigger if exists … ; create trigger …`
- `create extension if not exists pgcrypto;`（`gen_random_uuid()` 需要）

## 5. 怎么应用迁移
### 旧应急脚本（不属于正常发布）
`scripts/db-push.mjs` 按文件名顺序，把每个 `.sql` 经 **Supabase Management API** 应用；必须显式确认目标项目：
```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx \
SUPABASE_PROJECT_REF=<明确的开发/staging/已审批生产 ref> \
ALLOW_LEGACY_DB_PUSH=YES \
node scripts/db-push.mjs
```
- 令牌来自 Supabase 控制台 → Account → Access Tokens（权限很大，**当密码看待**）。
- 现有迁移力求可重放，但 `create table if not exists` 不会修复已漂移结构，重复执行也不等于无风险、事务化或可回滚。

> ⚠️ 坑：直接用默认 UA 调 `api.supabase.com/.../database/query` 会被 Cloudflare 拦（403 / `error code: 1010`）。脚本里**带浏览器 UA** 才放行。

> ⚠️ `db-push.mjs` 已移除默认 Ref 并强制 `ALLOW_LEGACY_DB_PUSH=YES`，但仍无 history；正式流程使用仓库 `config.toml` 与 Supabase CLI，并按 [数据库发布与回滚](../operations/DATABASE_RELEASE_ROLLBACK.md) 执行。

### 手动（兜底）：SQL Editor
没令牌时：控制台 → SQL Editor → 粘贴迁移 → Run。第一版 profiles 即这样应用。

## 6. 加一张新表的模板
```sql
create table if not exists public.things (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- 业务字段
  created_at timestamptz not null default now()
);
alter table public.things enable row level security;
drop policy if exists things_all_own on public.things;
create policy things_all_own on public.things for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```
若新表用外键引用了另一张「属于用户」的表，要在 `with check` 里**额外校验被引用行也归本人**（否则会出现 [06](06-materials.md) 里 0003 修复的那种越权）。

Courses 展示了另一种范式：客户端可 owner SELECT，但表级 INSERT/UPDATE/DELETE 全撤销；API 从已验证 JWT 派生 user ID 后调用只授予 service_role 的事务 RPC。涉及 progress、points、跨用户传播、供应商配额或审核的表应优先采用这类服务端边界，而不是复制 `for all` owner policy。

## 7. 待改进
- CI 已通过 CLI migration history 发布，并在生产 migration 前完成本地重建/RLS E2E、dry-run 和加密恢复点；首次生产启用仍须人工 baseline 旧历史。
- 仍需定期 staging 演练、Storage 文件异地备份、数据库恢复演练和 schema drift 告警。
- 0011–0013 已于 2026-07-22、0014 已于 2026-07-23、0015–0018 已于 2026-07-27 通过受保护 plan/apply 发布。队列表不授予客户端任何读写，旧答题 RPC 在稳定窗口内保留供应用回滚，数据库仍只做 forward-fix；详细 run/artifact/真实 Azure 证据见发布手册第 8 节。
- 0019–0020 已于 2026-07-28 取得只读 plan `30366334157`、加密恢复点/apply `30367263486` 与最终应用发布 `30374301472` 证据。评判表不授予客户端任何权限，所有新 RPC 已由双用户 RLS 负向测试和 0020 精确断言同时证明；生产已到 0020。
- 0021–0022 已于 2026-07-31 取得只读 plan `30616030488`、加密恢复 artifact `8787805291`、受保护 apply/deploy `30616540480` 和 release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` 证据。真实一次性 Supabase E2E 验证全角/半角全大写不增加错误或候补，0022 断言 helper/RPC 对客户端不可执行；生产已到 0022。
- 0008 已保护 `profiles` 的 points/credits/VIP/level/streak 并撤销 points/notification helpers 的客户端 EXECUTE；`feedback.status`、通知服务端字段和帖子冗余计数等其它表仍需逐表做列级边界审计。
- 0008 将旧 `profiles.points` 导入 `legacy_opening` 留痕；2026-07-21 生产聚合审计发现唯一 Profile 有 11 points，owner 决定归零，0009 追加等额 reversal，既不把旧余额当成可信历史，也不删除审计轨迹。
