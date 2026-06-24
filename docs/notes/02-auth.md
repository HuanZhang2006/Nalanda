# 02 · 注册 / 登录 / 退出（Auth）

## 这篇讲什么
用户体系是怎么用 Supabase Auth 做的：注册即可用、登录拿令牌、后端如何信任这个令牌、以及踩过的两个关键坑（ES256 验签、容器 DNS）。

## 设计目标
- 注册后**立即能用**，不卡在「去邮箱点确认链接」。
- 后端（NestJS）能**安全地信任**前端带来的登录态，用于受保护接口。
- 每个用户自动有一份应用层资料（profiles），且只能看自己的。

## 三个角色
- **supabase-js（前端）**：管会话、登录、令牌刷新。
- **NestJS（后端）**：注册端点（需要 service_role 这种服务端密钥）、受保护接口、验签守卫。
- **Supabase Auth（云）**：真正签发令牌、存用户。

## 注册流程（为什么要后端介入）
默认 `supabase.auth.signUp` 会要求邮箱确认，体验差。所以注册走自建端点，用管理员权限直接建「已确认」账号：

```
前端 App.tsx
  POST /api/auth/register {email, password}
        │
        ▼
后端 apps/api/src/auth/auth.controller.ts
  用 service_role 调 Supabase Admin API:
  POST {SUPABASE_URL}/auth/v1/admin/users { email, password, email_confirm: true }
  ├─ 成功 → { ok: true }
  ├─ 422/已存在 → 409 { code: "EMAIL_TAKEN" }
  └─ 校验失败 → { code: "INVALID_EMAIL" | "WEAK_PASSWORD" }
        │
        ▼
前端拿到成功后，再 supabase.auth.signInWithPassword(...) 直接登录
```

要点：
- `service_role` 是「绕过一切 RLS 的管理员钥匙」，**只能在后端用**，存服务器 `.env`（见 [05](05-deployment-and-ci.md)），绝不进前端/仓库。
- 端点返回**结构化错误码**（`EMAIL_TAKEN` 等），前端映射成中文提示。

## 登录流程
- 前端 `supabase.auth.signInWithPassword({email, password})` → 拿到 **access_token（JWT）** 存在 supabase-js 的会话里。
- `onAuthStateChange` 监听会话变化：登录成功 → `App.tsx` 切换到 `<NalandaApp>`。
- 之后所有「带身份」的请求：
  - 走 NestJS 的：`apps/web/src/lib/api.ts` 的 `authedFetch` 自动加 `Authorization: Bearer <token>`。
  - 走 Supabase 直连的：supabase-js 自动带令牌，RLS 用 `auth.uid()` 识别用户。

## 后端验签（SupabaseAuthGuard）
后端要确认「这个令牌确实是 Supabase 签发、没被伪造」。`apps/api/src/auth/supabase.guard.ts`：
1. 从 `Authorization: Bearer` 取 token。
2. **优先用 JWKS 验签**：从 `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` 取项目公钥，验 ES256/RS256 非对称签名（校验 issuer、audience=authenticated）。
3. 回退：若 JWKS 验不过且配了 `SUPABASE_JWT_SECRET`，再试 HS256（旧版对称密钥）。
4. 要求 payload 有 `sub`（真实用户才有；anon/service_role 这种没有 sub 的会被拒）。
5. 通过后把 `{ id, email, role }` 挂到请求上，`@CurrentUser()` 取用，`GET /api/me` 返回它。

```
GET /api/me  (无令牌/伪造 → 401；合法用户令牌 → {id,email,role})
```

### ⚠️ 坑 1：真实令牌是 ES256，不是 HS256
最初守卫只用「项目 JWT secret + HS256」验签，本地造的 HS256 token 能过，但**真实 Supabase 用户令牌验不过**。原因：该项目用的是**新版非对称签名（ES256）**——令牌头是 `{"alg":"ES256","kid":...}`。所以必须走 **JWKS**（用项目公钥验非对称签名）。HS256 仅作旧项目回退。
> 教训：验 Supabase JWT，默认按 JWKS 做；别假设是 HS256。

### ⚠️ 坑 2：容器内拉不到 JWKS → 全部 401
上线后 `/api/me` 又 401。排查发现**后端容器内 DNS 解析失败**（`EAI_AGAIN`），导致拉不到 `.well-known/jwks.json`。宿主机用 systemd-resolved（127.0.0.53），容器内嵌 DNS 转发不到。修复：给容器显式配 `dns: 1.1.1.1 / 8.8.8.8`（详见 [05](05-deployment-and-ci.md)）。
> 教训：验签依赖外网拉公钥；容器必须能 DNS 解析外网。

## profiles：每个用户的应用资料
迁移 `0001`（见 [03](03-database-and-migrations.md)）建了：
- `public.profiles`（1:1 对应 `auth.users`：username、university、major、language、credits、level…）。
- **触发器**：`auth.users` 插入新用户 → 自动建一条 profile（username 取邮箱前缀）。
- **RLS**：每人只能 select/update 自己的 profile。

所以注册后，前端能用登录态直接 `supabase.from('profiles').select()` 读到（且只读到）自己的资料。

## 前端登录页要点（App.tsx）
- 分段控件「登录 / 注册」；邮箱正则 + 密码 ≥6 的前端校验；显示/隐藏密码；加载态；错误码→中文。
- 主题切换按钮（写 `data-theme` + localStorage）。
- 这层是真正的 React 组件（与移植的 vanilla 应用解耦）。

## 怎么验证（已做过，可复现）
- 用 service_role 的 Admin API 建一个「已确认」测试用户 → 用 anon + 密码登录拿真实 token → 打 `/api/me`：无令牌/伪造 401，合法 200 返回用户；用完删除测试用户。
- 线上同样验证过 `https://nalanda.online/api/me`。

## 扩展点
- OAuth（Google 等）：Supabase 配 provider + 前端 `signInWithOAuth`；记得在 Auth → URL Configuration 加 `https://nalanda.online`。
- 角色/权限：令牌里有 `role`；将来 admin 后台用单独校验。
- 把 profile 的成长字段（credits/level）接上真实积分系统（未来模块）。
