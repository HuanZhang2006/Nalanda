# 02 · User system and authentication

> **About this document**
> - **Contents**: Records the current Supabase Auth, NestJS JWT guard, Profile creation, and sign-up flow.
> - **Purpose**: Explains the authentication data flow and security boundaries, for troubleshooting sign-in issues and as a reference for future email/OAuth work.
> - **When to update**: When the authentication provider, token verification, sign-up/password recovery, roles, Profile permissions, or secrets change.
> - **Status baseline**: 2026-08-11. The overall production history is at 0043; the dual Redis/HMAC sign-up rate limit has a protected release and passed a public RateLimit header smoke test.

> Goal: users can sign up / sign in / sign out (real backend), the backend can trust the session, and every user has their own profile and can only access their own data.

## 1. Technical approach overview

- **Identity and tokens**: Supabase Auth (GoTrue). Handles sign-up, sign-in, JWT issuance, and session refresh.
- **Token verification**: NestJS verifies Supabase-issued access tokens with the project's **JWKS** (asymmetric ES256 public keys).
- **User profiles**: the PostgreSQL `public.profiles` table, one-to-one with `auth.users`; a trigger creates the profile at sign-up; RLS ensures users can only access their own row, and 0008's column grants ensure only public profile fields can be changed.
- **Sign-up strategy**: a custom `POST /api/auth/register` that uses service_role to create an already-confirmed account, bypassing the unreliable confirmation email (see section 6).

```
Browser (supabase-js) ──sign in──> Supabase issues an ES256 JWT (stored in localStorage)
   │ calls /api/* with Authorization: Bearer <jwt>
   ▼
NestJS gateway ── SupabaseAuthGuard verifies with the project JWKS ──> req.user = {id,email,role}
   │
   └─ /api/me returns the identity; other protected endpoints can read the user with @CurrentUser
```

## 2. Data layer: profiles + RLS + triggers

Migration files: `supabase/migrations/20260620000001_profiles.sql` (table/RLS), `20260710000008_security_points_ledger.sql` (sensitive-column lockdown), and `20260722000011_learning_courses.sql` (IANA time zone).

- Table `public.profiles`: `id uuid PK → auth.users(id) ON DELETE CASCADE`, plus `username/email/university/major/year/language/timezone/credits/points/level/level_name/vip_until/streak/streak_date/created_at/updated_at`; `timezone` is validated as a legal IANA name by a database trigger.
- **RLS** (enforced in the database, cannot be bypassed):
  - `profiles_select_own`: select only when `auth.uid() = id`.
  - `profiles_update_own`: update the row only when `auth.uid() = id` (`using` + `with check`); table-level UPDATE has been revoked from authenticated, only the six columns `username/university/major/year/language/timezone` are granted, and a defensive trigger additionally protects points/credits/level/VIP/streak.
- **Automatic profile on sign-up**: the `handle_new_user()` function (`security definer`) inserts a row into `profiles` after an insert into `auth.users` (`username` is the part of the email before `@`); trigger `on_auth_user_created`.
- **Maintaining `updated_at`**: `touch_updated_at()` + a before-update trigger.

> Key logic: business tables use `auth.uid()` (the sub from the verified JWT) for RLS isolation; service_role is used by the backend, bypasses RLS, and is only for administrative operations (such as creating users).

## 3. Backend: verification guard + endpoints

Files: `apps/api/src/auth/supabase.guard.ts`, `current-user.decorator.ts`, `me/me.controller.ts`, `auth/auth.controller.ts`

### SupabaseAuthGuard (verification)
- Takes the token from `Authorization: Bearer`.
- **JWKS first**: `createRemoteJWKSet(<SUPABASE_URL>/auth/v1/.well-known/jwks.json)`, `jwtVerify(token, jwks, { issuer, audience:"authenticated" })`, supporting ES256/RS256.
- **HS256 fallback**: if JWKS verification fails and `SUPABASE_JWT_SECRET` is configured, only HS256 is allowed, with the same `issuer=<SUPABASE_URL>/auth/v1` and `audience=authenticated` checks as the JWKS path.
- **User claims required**: `sub` must be a UUID and `role=authenticated`, otherwise 401 (anon/service_role keys are never treated as users).
- On success it sets `req.user = { id: sub, email, role }`.

### Endpoints
- `GET /api/me` (`@UseGuards(SupabaseAuthGuard)`): returns the current user, used to "prove the backend trusts the session".
- `POST /api/auth/register`: see section 6.

> **Key insight**: this project's Supabase signs user tokens with **asymmetric keys (ES256)** (token header `alg:ES256, kid:...`). The guard originally only did HS256 + the JWT secret, so real user tokens failed verification and `/api/me` returned 401. Switching to JWKS fixed it. Lesson: check the token header's `alg` before deciding how to verify.

The HS256 fallback has unit regressions for wrong issuer/audience; real JWKS fetching, key rotation, and the full sign-in chain are still verified by one-off Supabase/production smoke tests.

## 4. Frontend: client + authenticated requests + sign-in UI

Files: `apps/web/src/lib/supabase.ts`, `lib/api.ts`, `App.tsx`, `NalandaApp.tsx`

- `lib/supabase.ts`: creates the client with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (injected at build time); when not configured it is `null` and the UI shows a hint instead of crashing.
- `lib/api.ts`: `authedFetch(path)` takes the current session's `access_token` and calls the backend with `Authorization: Bearer`.
- `App.tsx` (auth gate + sign-in page):
  - Subscribes to the session with `onAuthStateChange`; with a session it renders `<NalandaApp>`, otherwise the sign-in page.
  - Sign-in page: **sign-in/sign-up segmented switch**, email **trim + lowercase normalization**, live validation (email format + password ≥ 6), password show/hide, loading/red error box, theme toggle, and an EN/中文 language toggle (English by default).
  - Sign-up: first `POST /api/auth/register`, then on success **automatic sign-in** with `signInWithPassword`; error codes map to explicit messages.
  - Sign-in: `signInWithPassword` (normalized email).
  - Session initialization, sign-in, and sign-out all check Supabase `{ error }`; an account switch resets the submit loading state, and sign-out failures are shown in the signed-in UI.

## 5. End-to-end token flow (logic)

1. The user submits on the sign-in page → `supabase.auth.signInWithPassword({email,password})`.
2. Supabase validates → returns a session (with an ES256 `access_token`); supabase-js stores it in localStorage and broadcasts `onAuthStateChange`.
3. The frontend enters the app; every `/api/*` request carries the Bearer token through `authedFetch`.
4. NestJS `SupabaseAuthGuard` verifies with the project JWKS → `req.user`.
5. `/api/me` echoes the identity; business endpoints fetch data using `req.user.id` + RLS.
6. Sign-out: `supabase.auth.signOut()` clears the session → `onAuthStateChange` → back to the sign-in page.

## 6. The email confirmation problem and "custom sign-up"

**Symptoms**: signing in after sign-up returned `Invalid login credentials`; the same email could "sign up successfully" repeatedly; no verification code ever arrived.

**Root cause**: the project had `mailer_autoconfirm=false` (email confirmation on), but Supabase's default email is unreliable/rate-limited:
- Web sign-up created an "unconfirmed" account → unconfirmed accounts cannot sign in.
- Supabase **anti-enumeration**: returns a "fake success" for an existing email → it looks like you can sign up repeatedly.
- It sends a confirmation **link**, not a code, and the default email was never delivered and the Site URL was not configured.

**Solution**: a custom `POST /api/auth/register` (`apps/api/src/auth/auth.controller.ts`)
- Validates the email format and password ≥ 6 (otherwise 400 `INVALID_EMAIL`/`WEAK_PASSWORD`).
- Uses **service_role** to call `POST <URL>/auth/v1/admin/users` with `{ email, password, email_confirm:true }` → creates an **already-confirmed** account directly.
- Duplicate email → `409 EMAIL_TAKEN` (the frontend says "This email is already registered", eliminating fake successes).
- After a successful sign-up the frontend immediately calls `signInWithPassword` → enters the app.

**Trade-off**: there is currently **no email verification** (any email can sign up). This is an MVP trade-off to keep things usable. To verify for real later: connect an SMTP provider that can send (such as Resend) + configure the Site URL (`https://nalanda.online`) + turn on email confirmation.

Security boundary: this public sign-up endpoint holds service-role capability. Production 0039 uses private Redis to limit each IP to 5 attempts per 15 minutes and each normalized email to 3 per hour, with keys built only from HMACs under a separate secret; when Redis is unavailable, sign-up returns `503 RATE_LIMIT_UNAVAILABLE` and never bypasses the protection to keep creating users. nginx adds 1 request/second with burst 3, but email verification, CAPTCHA, and anti-enumeration product changes are still future work.

## 7. Configuration and secrets (who uses which)

| Variable | Used for | Secret |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Frontend (injected at build time; safe to be public) | No |
| `SUPABASE_URL` | Backend JWKS / admin base URL | No |
| `SUPABASE_JWT_SECRET` | Backend HS256 fallback verification | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend admin user creation (bypasses RLS) | **Top secret** |
| `REDIS_URL` | Production backend sliding windows and readiness; the URL contains a separate Redis password | **Top secret** |
| `RATE_LIMIT_HMAC_SECRET` | Derives irreversible rate-limit actors from IP/normalized email | **Top secret** |

- Frontend keys are injected at CI build time from GitHub Secrets; backend secrets live only in the server's `/opt/nalanda/.env` (never committed, never in CI logs).
- **Never ship service_role to the frontend**: it bypasses every RLS policy and can read and write the whole database.

## 8. Verification

Real CI Redis covers 0039's atomic windows, 429 headers, tiered failure handling, and HMAC redaction; the 2026-08-10 public smoke test also confirmed that an empty sign-up returns 400 with `RateLimit-Limit: 5`. Mock unit tests still do not count as dependency evidence. The reproducible tests, the isolated Supabase project they need, and the commands are defined by the [testing guide](../guides/TESTING.md); never run E2E that creates/deletes users against the production project.

## 9. Follow-up TODO

- Upgrade `/api/me` from "echo JWT claims" to "read `profiles` with service_role and return the full profile".
- Role/permission (user/creator/admin) guards; points already have a ledger, and credits/VIP/payments next need separate ledgers of record and a read-only Profile projection.
- Real email verification (SMTP), OAuth, password recovery.
- CAPTCHA, public anti-enumeration copy, and an operating process for sign-up security events; the dual Redis rate limit only addresses request frequency and does not prove email ownership.
