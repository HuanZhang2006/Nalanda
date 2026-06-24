# 03 · 数据库 / 迁移 / RLS

## 这篇讲什么
数据存哪、怎么保证「每个人只能动自己的数据」（RLS），以及改表结构的工作流（迁移 + 一条命令自动应用）。

## 数据库是什么
用 **Supabase**，本质是托管的 **PostgreSQL** + 一圈周边（Auth、Storage、Realtime、自动生成的 REST/PostgREST）。前端用 `supabase-js` 直接读写表，**安全靠 RLS 在数据库层兜底**，不是靠前端自觉。

## RLS（行级安全）—— 整个项目的安全基石
开了 RLS 的表，**默认拒绝一切访问**，必须写「策略（policy）」放行。我们的统一模式是「**owner-only**」：

```sql
alter table public.X enable row level security;

create policy X_all_own on public.X
  for all to authenticated            -- 仅登录用户
  using (user_id = auth.uid())        -- 能读/改的行：user_id = 当前登录用户
  with check (user_id = auth.uid());  -- 能写入的行：同上
```
- `auth.uid()` 是「当前请求令牌里的用户 id」，由 Supabase 从 JWT 解出，前端伪造不了。
- 表上 `user_id uuid not null default auth.uid()`：插入时不用前端传 user_id，数据库自动填成当前用户。
- 结果：A 的查询永远只返回 A 的行，连「别人有没有这条」都看不到。

> 心法：**不要在前端做权限判断当安全**。前端的过滤只是体验；真正的隔离写在 RLS 里。

## 现有迁移清单（`supabase/migrations/`）
| 文件 | 内容 |
|---|---|
| `0001_profiles.sql` | `profiles` 表（绑 auth.users）+ 注册自动建档触发器 + owner-only RLS + `updated_at` 维护触发器 |
| `0002_courses_materials.sql` | `courses`、`materials` 表 + owner-only RLS；私有 Storage 桶 `materials` + 按用户文件夹的存储策略 |
| `0003_materials_course_check.sql` | 加固：materials 只能挂到「自己拥有的课程」（见 [04](04-materials.md) 的越权修复） |

## 迁移怎么写（幂等是关键）
所有迁移都写成**可重复执行**的，这样自动化工具反复跑也不出错：
- 建表：`create table if not exists …`
- 策略：`drop policy if exists … ; create policy …`
- 函数：`create or replace function …`
- 触发器：`drop trigger if exists … ; create trigger …`
- 扩展：`create extension if not exists pgcrypto;`（`gen_random_uuid()` 要用）

## 怎么应用迁移（两种方式）
### 自动（推荐）—— 一条命令
`scripts/db-push.mjs` 按文件名顺序，把每个 `.sql` 通过 **Supabase Management API** 应用到项目：
```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/db-push.mjs
```
- 令牌来自 Supabase 控制台 → Account → Access Tokens（权限很大，**当密码看待**）。
- 因为迁移幂等，重复跑安全。

#### ⚠️ 坑：Management API 会按 User-Agent 拦截
直接用脚本默认 UA 调 `https://api.supabase.com/.../database/query` 会被 Cloudflare 拦（返回 403 / `error code: 1010`）。脚本里**带了浏览器 UA** 才放行。

### 手动（兜底）—— SQL Editor
没有访问令牌时：Supabase 控制台 → SQL Editor → 粘贴迁移 SQL → Run。第一版 profiles 就是这么应用的。

## 加一张新表的模板
```sql
create table if not exists public.things (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- ...业务字段...
  created_at timestamptz not null default now()
);
alter table public.things enable row level security;
drop policy if exists things_all_own on public.things;
create policy things_all_own on public.things for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```
若新表通过外键引用了别的「属于用户」的表，记得在 `with check` 里**额外校验被引用行也属于本人**（否则会出现 0003 修的那种越权，见 [04](04-materials.md)）。

## 数据流速记
```
前端 supabase.from('courses').select()
  → 带用户 JWT → PostgREST → Postgres
  → RLS 用 auth.uid() 过滤 → 只回当前用户的行
```

## 待改进
- 目前迁移靠本地跑 `db-push`（用访问令牌）。要更规范可把令牌存成 GitHub Secret，在 CI 里自动 `db-push`，让「schema 变更随代码一起上」。
- 还没有「迁移已应用」追踪表（靠幂等兜底）；规模大了可引入 Supabase CLI 的迁移版本管理。
