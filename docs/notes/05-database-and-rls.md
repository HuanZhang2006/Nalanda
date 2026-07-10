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

## 7. 待改进
- CI 已通过 CLI migration history 发布，并在生产 migration 前完成本地重建/RLS E2E、dry-run 和加密恢复点；首次生产启用仍须人工 baseline 旧历史。
- 仍需定期 staging 演练、Storage 文件异地备份、数据库恢复演练和 schema drift 告警。
- 0008 已保护 `profiles` 的 points/credits/VIP/level/streak 并撤销 points/notification helpers 的客户端 EXECUTE；`feedback.status`、通知服务端字段和帖子冗余计数等其它表仍需逐表做列级边界审计。
- 0008 将旧 `profiles.points` 导入 `legacy_opening`，只能锁住未来写入，不能证明旧余额未被漏洞篡改；生产发布必须先完成人工/业务数据审计并保存记录。
