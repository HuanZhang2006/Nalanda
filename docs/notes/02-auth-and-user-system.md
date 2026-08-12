# 02 · 用户系统与认证

> **文档定位**
> - **内容**：记录当前 Supabase Auth、NestJS JWT 守卫、Profile 建档和注册流程。
> - **作用**：说明认证数据流与安全边界，供登录故障排查和后续邮箱/OAuth 改造参考。
> - **何时更新**：认证提供商、令牌校验、注册/找回密码、角色、Profile 权限或密钥变化时。
> - **状态基线**：2026-08-12。生产总 history 已到 0048；注册 Redis/HMAC 双限流已受保护发布并通过公网 RateLimit header smoke。

> 目标：用户能注册 / 登录 / 退出（真实后端），后端能信任登录态，每个用户有自己的资料档案且只能访问自己的数据。

## 1. 技术方案总览

- **身份与令牌**：Supabase Auth（GoTrue）。负责注册、登录、签发 JWT、会话刷新。
- **令牌验证**：NestJS 用项目的 **JWKS**（非对称 ES256 公钥）验证 Supabase 签发的访问令牌。
- **用户资料**：PostgreSQL `public.profiles` 表，与 `auth.users` 一一对应；注册时触发器自动建档；RLS 保证只能访问自己的行，0008 的列级授权保证只能改公开资料字段。
- **注册策略**：自建 `POST /api/auth/register`，用 service_role 直接创建「已确认」账号，绕开不可靠的确认邮件（详见第 6 节）。

```
浏览器 (supabase-js) ──登录──> Supabase 签发 ES256 JWT（存 localStorage）
   │ 调 /api/* 带 Authorization: Bearer <jwt>
   ▼
NestJS 网关 ── SupabaseAuthGuard 用项目 JWKS 验签 ──> req.user = {id,email,role}
   │
   └─ /api/me 返回身份；其余受保护接口可用 @CurrentUser 取用户
```

## 2. 数据层：profiles + RLS + 触发器

迁移文件：`supabase/migrations/20260620000001_profiles.sql`（建表/RLS）、`20260710000008_security_points_ledger.sql`（敏感列收口）与 `20260722000011_learning_courses.sql`（IANA 时区）。

- 表 `public.profiles`：`id uuid PK → auth.users(id) ON DELETE CASCADE`，外加 `username/email/university/major/year/language/timezone/credits/points/level/level_name/vip_until/streak/streak_date/created_at/updated_at`；`timezone` 由数据库触发器校验为合法 IANA 名称。
- **RLS**（数据库层强制，绕不过去）：
  - `profiles_select_own`：`auth.uid() = id` 才能 select。
  - `profiles_update_own`：`auth.uid() = id` 才能 update 该行（`using` + `with check`）；表级 UPDATE 已从 authenticated 撤销，只授予 `username/university/major/year/language/timezone` 六列，防御触发器再次保护 points/credits/level/VIP/streak。
- **注册自动建档**：函数 `handle_new_user()`（`security definer`）在 `auth.users` 插入后，向 `profiles` 插一行（`username` 取邮箱 `@` 前缀）；触发器 `on_auth_user_created`。
- **维护 `updated_at`**：`touch_updated_at()` + before-update 触发器。

> 逻辑要点：业务表用 `auth.uid()`（来自已验证 JWT 的 sub）做 RLS 隔离；service_role 走后端、绕过 RLS，仅用于管理操作（如建用户）。

## 3. 后端：验签守卫 + 接口

文件：`apps/api/src/auth/supabase.guard.ts`、`current-user.decorator.ts`、`me/me.controller.ts`、`auth/auth.controller.ts`

### SupabaseAuthGuard（验签）
- 从 `Authorization: Bearer` 取令牌。
- **首选 JWKS**：`createRemoteJWKSet(<SUPABASE_URL>/auth/v1/.well-known/jwks.json)`，`jwtVerify(token, jwks, { issuer, audience:"authenticated" })`，支持 ES256/RS256。
- **回退 HS256**：若 JWKS 验不过且配了 `SUPABASE_JWT_SECRET`，只允许 HS256，并与 JWKS 路径一致校验 `issuer=<SUPABASE_URL>/auth/v1` 和 `audience=authenticated`。
- **要求用户 claims**：`sub` 必须是 UUID 且 `role=authenticated`，否则一律 401（anon/service_role key 不会被当成用户）。
- 通过后写入 `req.user = { id: sub, email, role }`。

### 接口
- `GET /api/me`（`@UseGuards(SupabaseAuthGuard)`）：返回当前用户，用于「证明后端信任登录态」。
- `POST /api/auth/register`：见第 6 节。

> **关键认知**：本项目 Supabase 用**非对称密钥（ES256）**签发用户令牌（令牌头 `alg:ES256, kid:...`）。最初守卫只做 HS256 + JWT secret，导致真实用户令牌验不过、`/api/me` 401。改用 JWKS 后通过。教训：先看令牌头的 `alg` 再决定验签方式。

HS256 回退已有错误 issuer/audience 的单元回归；真实 JWKS 拉取、密钥轮换与完整登录链路仍由一次性 Supabase/线上 smoke 验证。

## 4. 前端：客户端 + 带令牌请求 + 登录界面

文件：`apps/web/src/lib/supabase.ts`、`lib/api.ts`、`App.tsx`、`NalandaApp.tsx`

- `lib/supabase.ts`：用 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（构建期注入）创建客户端；未配置时为 `null` 并在界面提示，不崩。
- `lib/api.ts`：`authedFetch(path)` 取当前 session 的 `access_token`，加 `Authorization: Bearer` 调后端。
- `App.tsx`（鉴权门 + 登录页）：
  - `onAuthStateChange` 订阅会话；有 session → 渲染 `<NalandaApp>`，否则渲染登录页。
  - 登录页：**登录/注册分段切换**、邮箱**trim+小写规范化**、实时校验（邮箱格式 + 密码≥6）、密码显示/隐藏、loading/错误红框、主题切换。
  - 注册：先 `POST /api/auth/register`，成功后 `signInWithPassword` **自动登录**；错误码映射明确文案。
  - 登录：`signInWithPassword`（规范化邮箱）。
  - 初始化 session、登录和退出都会检查 Supabase `{ error }`；账号切换会复位提交 loading，退出失败显示在已登录界面。

## 5. 端到端令牌流程（逻辑）

1. 用户在登录页提交 → `supabase.auth.signInWithPassword({email,password})`。
2. Supabase 校验 → 返回 session（含 ES256 `access_token`），supabase-js 存 localStorage 并广播 `onAuthStateChange`。
3. 前端进入应用；任何 `/api/*` 请求经 `authedFetch` 带上 Bearer。
4. NestJS `SupabaseAuthGuard` 用项目 JWKS 验签 → `req.user`。
5. `/api/me` 回显身份；业务接口可据 `req.user.id` + RLS 取数据。
6. 退出：`supabase.auth.signOut()` 清会话 → `onAuthStateChange` → 回到登录页。

## 6. 邮箱确认问题与「自建注册」

**现象**：注册后登录报 `Invalid login credentials`；同邮箱可重复「注册成功」；收不到验证码。

**根因**：项目 `mailer_autoconfirm=false`（邮箱确认开启），但 Supabase 默认邮件不可靠/被限流：
- 网页注册建的是「未确认」账号 → 未确认不让登录。
- Supabase **防枚举**：对已存在邮箱返回「假成功」→ 看起来能重复注册。
- 它发的是确认**链接**不是验证码，且默认邮件发不出、Site URL 也没配。

**解决**：自建 `POST /api/auth/register`（`apps/api/src/auth/auth.controller.ts`）
- 校验邮箱格式、密码≥6（否则 400 `INVALID_EMAIL`/`WEAK_PASSWORD`）。
- 用 **service_role** 调 `POST <URL>/auth/v1/admin/users`，`{ email, password, email_confirm:true }` → 直接创建**已确认**账号。
- 重复邮箱 → `409 EMAIL_TAKEN`（前端提示「该邮箱已注册」，杜绝假成功）。
- 前端注册成功后立即 `signInWithPassword` → 进入应用。

**权衡**：当前**不做邮箱验证**（任意邮箱可注册）。这是 MVP 取舍，保证可用。将来要真验证：接可发信的 SMTP（如 Resend）+ 配 Site URL（`https://nalanda.online`）+ 打开邮箱确认即可。

安全边界：该公开注册接口持有 service-role 能力。生产 0039 通过私有 Redis 同时限制每 IP 5 次/15 分钟、每个规范化邮箱 3 次/小时，key 只使用独立 secret 生成的 HMAC；Redis 不可用时注册返回 `503 RATE_LIMIT_UNAVAILABLE`，不会绕过保护继续创建用户。nginx 另叠加 1 次/秒、burst 3，但邮箱验证、CAPTCHA 和防枚举产品调整仍是后续工作。

## 7. 配置与密钥（谁用哪把）

| 变量 | 用处 | 机密 |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 前端（构建期注入，公开无碍） | 否 |
| `SUPABASE_URL` | 后端 JWKS / admin 基址 | 否 |
| `SUPABASE_JWT_SECRET` | 后端 HS256 回退验签 | 是 |
| `SUPABASE_SERVICE_ROLE_KEY` | 后端 admin 建用户（绕 RLS） | **绝密** |
| `REDIS_URL` | 生产后端滑动窗口与 readiness；URL 内含独立 Redis 密码 | **绝密** |
| `RATE_LIMIT_HMAC_SECRET` | 对 IP/规范化邮箱派生不可逆限流 actor | **绝密** |

- 前端密钥经 GitHub Secrets 在 CI 构建期注入；后端密钥只存服务器 `/opt/nalanda/.env`（不入库、不进 CI 日志）。
- **service_role 切勿进前端**：它能绕过所有 RLS 读写整库。

## 8. 验证

真实 CI Redis 已覆盖 0039 的原子窗口、429 headers、分级故障和 HMAC 脱敏；2026-08-10 公网 smoke 还确认空注册返回 400 并带 `RateLimit-Limit: 5`。mock 单测仍不算依赖证据。当前可复现测试、所需隔离 Supabase 项目和命令以 [测试指南](../guides/TESTING.md) 为准；不要用生产项目运行会创建/删除用户的 E2E。

## 9. 后续 TODO

- `/api/me` 由「回显 JWT claims」升级为「用 service_role 读 `profiles` 返回完整档案」。
- 角色/权限（user/creator/admin）守卫；points 已有账本，后续为 credits/VIP/支付建立独立事实账本和只读 Profile projection。
- 真邮箱验证（SMTP）、OAuth、找回密码。
- CAPTCHA、对外防枚举文案与注册安全事件运营流程；Redis 双限流只解决请求频率，不证明邮箱所有权。
