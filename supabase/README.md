# Supabase（数据库 / 鉴权 / 存储 / 实时）

## 应用迁移（二选一）

**A. 最简单：SQL Editor 粘贴**
1. Supabase 控制台 → SQL Editor → New query。
2. 把 `migrations/` 下的 SQL 按文件名顺序复制进去，点 Run。

**B. 用 Supabase CLI（可重复、可版本化，推荐长期用）**
```bash
npm i -g supabase
supabase link --project-ref <你的项目 ref>   # ref 在项目 URL 里
supabase db push                              # 应用 migrations/ 下所有迁移
```

## 鉴权设置（开发期建议）

- Authentication → Providers → Email：默认开启。
- 开发联调时可临时关闭 **Confirm email**（Email provider 设置里），这样注册后能直接登录、无需收确认邮件。上线前再开回来。

## 当前迁移

| 文件 | 内容 |
|---|---|
| `20260620000001_profiles.sql` | `profiles` 表（绑定 auth.users）+ 注册自动建档触发器 + RLS（仅本人可读/改） |

后续模块（课程 / 资料 / 笔记 / 市场 …）的表将作为新迁移逐步加入。
