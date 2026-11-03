# 08 · Notifications / feedback / profile · in depth

> **About this document**
> - **Contents**: Records the current data flow and frontend functions of the notification panel, feedback, and Profile/Growth.
> - **Purpose**: Explains three real Supabase modules and how they connect, and marks the permission boundary between client-writable and server-managed fields.
> - **When to update**: When Profile fields/permissions, the notification refresh method, the feedback state machine, or badge/level rules change.
> - **Status baseline**: 2026-08-11. The overall production history is at 0043; read-only/insert-only Feedback and the points daily-cap receipt/notification are live.

> Files: `...0004_notifications_feedback.sql` (tables), `...0006_*` (old points), `...0007_*` (streak), `...0008_security_points_ledger.sql` (sensitive columns and points ledger), `...0011_learning_courses.sql` (timezone and course badges), `...0039_security_integrity_rate_limit_points_abuse.sql` (production Feedback/points lockdown), `apps/web/src/legacy/{notifications,feedback,profile}.ts`, `apps/api/src/{learning,points}`.

---

## 1. Data model
- `notifications(user_id, type, title, body, read bool, created_at)` — owner-only RLS. `type` is only used for icons/categorization; the frontend uses it to translate known trigger-generated notifications (like/comment/favorite/repost/follow/streak) into the current UI language.
- `feedback(user_id, category, summary, body, status default 'open', created_at)` — since production 0039 split into owner SELECT/INSERT; authenticated users may only insert `category/summary/body` and cannot UPDATE/DELETE or set status/owner/time.
- Related `profiles` columns: `points` (activity points, rebuilt from `point_entries` since 0008), `level/level_name` (derived from points thresholds), `streak/streak_date` (added in 0007, locked as server-managed in 0008), `credits` (**reserved for a future top-up wallet, distinct from points**), `timezone` (added in 0011; must be an IANA time zone PostgreSQL recognizes).

> Key concept: **points (earned by doing things) ≠ wallet credits (top-ups/future)**. Profile shows points; credits are not shown yet.

> Current boundary: 0008 revoked table-wide UPDATE on Profile; after 0011 authenticated users may only update `username/university/major/year/language/timezone`, and a defensive trigger also protects points, credits, level, VIP, and streak. Client EXECUTE has been revoked from the points/notification/learning definer helpers. Production 0039 closed the feedback `FOR ALL` gap; status is maintained only by the support workflow.

---

## 2. Notifications (`notifications.ts`) — the top-bar bell panel (not a route)

Module-level: `sb, USER, toastFn, items[]`.

**initNotifications(sb,user,toast)** — injects dependencies (called in `mountNalanda`).

Every init clears the previous account's cache and increments the session version; late results from loading, marking as read, and sending notifications only update the current UI if the version still matches. A Supabase `{ error }` becomes a visible failure, and failed requests are no longer treated as successes.

**refreshNotifBadge()** — only queries the count, not the data:
```
const { count } = await sb.from("notifications").select("id",{count:"exact",head:true}).eq("read",false);
```
`head:true` means "count only, no rows" (HTTP HEAD, saves bandwidth). With unread items → show the bell badge `#notif-badge`, otherwise hide it. Called once after the app mounts.

**openNotifications()** — triggered by the bell (`ACTIONS.notifications` in the shell):
- **Click again to close**: if `#notif-pop` already exists, remove it and return (toggle).
- Builds the overlay: a full-screen transparent `#notif-backdrop` (click to close) + a top-right panel (title + "Mark all read" + list).
- Inner `reload()`: fetches the latest 40 (`order created_at desc limit 40`) → `draw()`.
- `draw()`: empty state / list items (unread items get a highlighted background + dot); clicking one → `update read=true` + redraw + `refreshNotifBadge()`. Known trigger-generated texts go through `notificationText(n)` so they render in the current language.
- "Mark all read" → `update({read:true}).eq("read",false)` in bulk.

**notify(title, body, type)** — exported so other modules can "notify yourself" (for example after submitting feedback). Note: **interaction notifications from Community/Schedule do not use it**; database triggers write them (see [09](09-community.md)/[10](10-schedule.md)) — the frontend only reads and displays.

> Design: notifications are "produced" in two ways. ① You trigger your own (submitting feedback) through the frontend `notify()`; ② others trigger yours (likes/comments/follows, streak milestones) through `security definer` triggers, because inserting a notification for "someone else" requires an RLS permission the frontend doesn't have.

When the reward business transaction in production 0039 first determines that a reward type/calendar day is over the cap, it idempotently writes one `points_daily_cap` notification in the same transaction; the owner-only `get_point_reward_receipt` only reads that user's reward decision. Client disconnects, repeated receipt reads, delete/recreate, or time zone changes never miss or duplicate the notification; the frontend only refreshes the bell and shows a toast, and cannot create the authoritative "cap reached" fact itself.

---

## 3. Feedback (`feedback.ts`) — route `#fb-root`

Module-level: `state={loading,error,tickets,category:'Bug',saving}`; constants `CATS` (categories, stored as English values) and `STATUS` (status → [[English, Chinese], color]). Init resets this state, and async operations use the session version to discard late responses across accounts.

- **mountFeedback(el)** → `render()` (skeleton) → `load()`.
- **load()** → `sb.from("feedback").select("*").order("created_at",desc)` (RLS only returns your own) → fills `tickets`.
- **render()** — the form on the left (category chips + summary input + details textarea + submit), and the "My feedback" list on the right (`ticketHtml`: category chip + status color + summary + time). Older tickets stored with Chinese category values still display in the current language.
- **wire()/handle()** — `[data-fb]` bindings: `cat` (switch category, re-render the highlight) / `submit`.
- **submit(btn)** — `saving` lock + the button changes to "Submitting…"; validates that the summary is not empty →
  ```
  await sb.from("feedback").insert({category, summary, body});
  await notify(localize("Feedback received", "反馈已收到"), summary, "feedback");   // also gives the notification module a real source
  toast(...); await load();
  ```
  On failure the button state is rolled back.

---

## 4. Profile (`profile.ts`) — route `#profile-root`

Module-level: `state={loading,error,learningError,profile,counts:{posts,materials,courses,feedback},learning:{courses,learnedWords,reviewDays,badges}}`; constants `LEVEL_TH=[50,150,350,700,1200]`, `TIER_BG` (bronze/silver/gold gradients), `tierOf(v,th)`. Init resets the state, and loading/saving/shell sync all check Supabase `{ error }` and the session version.

**fetchProfile()** — runs 5 Supabase queries and 1 authenticated API request concurrently:
```
profiles(own *), posts(count, repost_of=null), materials(count), courses(count), feedback(count)
/api/profile/learning-summary → number of learning_courses, distinct mastered words, distinct review dates, persistently awarded course badges
```
Supabase counts use `count:"exact", head:true`; learning stats are aggregated by NestJS/service-role, and the frontend never reads badge or learning-fact tables directly. When the learning stats API fails temporarily, the basic Profile still shows, with a `learningError` degraded-state notice; a service failure is never silently passed off as zero courses/zero badges.

**nextLevelInfo(points)** — finds the next threshold in `LEVEL_TH` and computes "percentage to the next level" for the level ring's `--p`.

**render()** —
- Header card: avatar (initials), username, email, school · major · year, VIP (only when `vip_until>now`); **level ring** (`--p` = the nextLevelInfo percentage, showing level + level_name + "X points to next level"); **Points** as a big number.
- "Your stats" four tiles: posts / materials / **learning courses** / points; below them, the number of learning courses, distinct mastered English words, and distinct review dates.
- **Existing display-only tiered badges**: 5 kinds (Poster/Creator/Course Builder/Scholar/Contributor), each `tierOf(real value, thresholds)` giving tier 0–3; the medal `background=TIER_BG[tier]` (bronze → silver → gold gradient, brighter at higher tiers) + a progress bar to the next tier.
  ```
  Poster: posts,[1,10,50]   Creator: materials,[1,10,30]   Course Builder: courses,[1,3,8]
  Scholar: points,[50,350,1200]   Contributor: feedback,[1,3,10]
  ```
- **Persistent course badges**: the server writes `user_badge_awards` once from facts, and Profile shows the date earned:
  - Vocabulary Voyager: 20 / 200 / 1000 distinct normalized mastered English words;
  - Course Graduate: 1 / 5 / 20 reward-eligible courses at 100% mastery;
  - Review Keeper: 3 / 15 / 50 distinct local review dates.
  Badge names and descriptions are seeded in Chinese in the database; the client renders them by badge family and threshold so they follow the UI language.

Old display-only badges can go down with current counts; course badges are historical reward facts and are never faked or re-awarded because a course is deleted or stats go down.

**editModal()** — edit username/school/major/year/language/**IANA time zone** → `update profiles` (RLS: own row only); after saving, `load()` + `syncShellUser()`. Invalid time zones are rejected by a database trigger. Changing school/major triggers 0006's `profiles_tags` trigger to add them to the global tag pool (shared with Community). The time zone only affects the local date stored for future review attempts and never rewrites historical dates.

**syncShellUser()** (exported) — syncs the real profile into the **app shell**: fetch the profile → write `DB.user` (name/initials/points/level/levelName) → patch the DOM directly: the bottom-left `.uchip-name`, `.uchip-sub` (`Lv x · name · points`), and avatar initials. Called once at mount; **every module that changes points** (community interactions, completing tasks) also calls it to refresh the sidebar immediately.

> This is how the "vanilla sub-apps" share user state: `DB.user` as a shared object + directly patching shell DOM nodes, instead of a global state library.

---

## 5. Wiring (`app.ts`)
- Bell button: `id="bellBtn" data-act="notifications"` + badge `#notif-badge`; `ACTIONS.notifications → openNotifications()`.
- `VIEWS.feedback/profile` are replaced with the mount points `#fb-root`/`#profile-root`; the `go()` route hook mounts the corresponding module after `requestAnimationFrame`.
- `mountNalanda` injects supabase into the three `init*` calls and calls `refreshNotifBadge()` + `syncShellUser()` after starting.

## 6. Verification
Two-user RLS E2E covers profiles isolation, timezone validation, private notifications, read-only/insert-only Feedback with status/update/delete denial, the receipt owner boundary, and that learning stats and badge tables cannot be forged by clients; jsdom covers the bell, error messages, feedback, the instant cap toast, Profile learning stats/badges, sidebar sync, and cross-account cleanup. PR/main run the RLS suite on a throwaway local Supabase; see the [testing guide](../guides/TESTING.md) for the actual files and commands.

## 7. Extensions
- Real-time notifications (subscribe to the `notifications` table with Supabase Realtime → bump the badge as soon as a new notification arrives).
- Clicking a notification jumps to its source (post/task) — currently it only marks it read.
- A feedback admin (change status through a controlled API rather than restoring client UPDATE); linking feedback to orders/notes (polymorphic).
