# 10 · Schedule (study plan) · in depth

> **About this document**
> - **Contents**: Records study goals/regular tasks, independent course review schedules, RLS, completion rewards, streaks, and the current rule-based auto-fill.
> - **Purpose**: Explains how Schedule merges two data sources while keeping regular-task points isolated from Courses review facts.
> - **When to update**: When task/goal fields, reward idempotency, reminders, the scheduling algorithm, time zones, or linked permissions change.
> - **Status baseline**: 2026-08-23. The overall production history is at 0053; the linked-owner trigger, database-derived `done_at`, the daily task cap, and the final revocation of authenticated `done_at` updates are all live.

> Files: `supabase/migrations/20260625000007_schedule.sql` (structure/old triggers), `...0008_security_points_ledger.sql` (stable task keys, points reversals, and sensitive-column protection), `...0011_learning_courses.sql`/`...0012_learning_course_workflows.sql` (review schedules and server workflows), `...0039_security_integrity_rate_limit_points_abuse.sql` (production owner/done_at/daily cap), `apps/web/src/legacy/schedule.ts`, `apps/api/src/learning/*`.

---

## 1. Data model

### study_goals (goals/exams)
`id, user_id (default auth.uid()), title, exam_date date, course_id (nullable, → courses on delete set null), created_at`. Owner-only RLS. Production 0039 adds a defensive trigger that verifies course ownership on both client and RLS-bypassing service-role paths and rejects changes to `user_id`.

### study_tasks (tasks)
`id, user_id, title, due_date date (default current_date), done bool, done_at, course_id?, material_id?, goal_id?, points_business_key, created_at`.
- **Three nullable foreign keys** let a task attach to a course / material / goal — the basis for linking with Materials.
- `on delete set null`: deleting a course/material keeps the task and only drops the link (no cascading task deletion).
- On INSERT, 0008 generates an immutable `task:{owner}:{sha256}:completed:v1` from owner + normalized title/due_date/course/material/goal; logically identical tasks share one reward claim, and clients cannot set or change the key.
- The production 0039 trigger re-verifies that course/material/goal all belong to `new.user_id`, including on service-role paths; `done_at` is automatically set to the server's `now()` or cleared based on `done`. The Web app no longer submits that value; production 0052–0053 finally reject authenticated UPDATE on it.

### Added profiles columns
`streak int` (consecutive study days), `streak_date date` (the last day counted toward the streak), and Courses 0011's valid IANA `timezone`. Review attempts and schedule offsets use that time zone; historical dates are not rewritten when the time zone changes later.

### learning_review_schedules (Courses review schedules)
`user_id, course_id, unit_id, source_session_id, due_date, skills[], scope, status, completed_session_id, completed_at`. It only carries the 3/7/15/30-day review choices of English vocabulary courses and **never writes to `study_tasks`**, so completing a review never mistakenly triggers the regular-task +5 points. Creation must reference the user's own completed initial session for that unit; when a schedule starts, the skills/scope stored in the database are authoritative, and completing the review session atomically back-fills the completed session. Create, cancel, and complete all go through NestJS + service-role RPCs; clients only read their own schedules through the aggregation API.

### RLS (with "linked ownership checks")
```sql
create policy study_tasks_own ... for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (course_id   is null or exists(select 1 from courses     c where c.id=course_id   and c.user_id=auth.uid()))
    and (material_id is null or exists(select 1 from materials   m where m.id=material_id and m.user_id=auth.uid()))
    and (goal_id     is null or exists(select 1 from study_goals g where g.id=goal_id     and g.user_id=auth.uid()))
  );
```
**Why**: owner-only only guarantees "the task is mine", but a foreign key does not guarantee "the course I reference is also mine". Without this layer, a task could in theory point at someone else's course id (dirty data). This reuses the lesson from [06 Materials](06-materials.md) 0003 — **foreign key ≠ permission**. The e2e test "B cannot attach to A's course" verifies this.

---

## 2. Task-completion trigger (0008 `_on_task_done`, `security definer`)

0008 replaces 0007's direct-points trigger and listens to `done` updates and task deletion:

```text
done=true  → _set_point_event(stable_task_key, +5, active=true)
done=false → if no other completed task shares the key, write a -5 reversal
DELETE     → if the deleted task was the last completed one with that key, write a -5 reversal
```

`_set_point_event` serializes with a business-key advisory lock + a state row lock. Retrying the same state returns a no-op; redoing after un-completing only writes a restore entry, so the key's net amount is at most +5. `profiles.points/level` are rebuilt from the full ledger sum every time, instead of blindly adding/subtracting on a clamped cache.

Streak rules are separate from points:

- Only the first successful activation of the permanent task key (`transition=1`) advances the streak based on `streak_date`; same day keeps it, yesterday +1, a gap/first time resets to 1;
- Un-completing, deleting, or redoing never rolls back or re-advances the streak; the streak represents historical activity "a valid task was completed on that day", not the current done count;
- Tasks completed before the migration are back-filled as active/transition 0, so later redos never fake a new streak;
- Reaching 3/7/14/30/100 days for the first time writes a milestone notification through `_notify`.

Ordinary clients can no longer update Profile's points/level/streak columns; `_set_point_event`, `_notify`, and the trigger helpers have no client EXECUTE either, and triggers write with controlled definer privileges.

---

## 3. Frontend (`schedule.ts`)

### State + date helpers
```
state = { loading, error, reviewError, tab:'today'|'week'|'all', tasks, reviews, goals, courses, materials, streak, timezone };
dstr(d) → 'YYYY-MM-DD'; todayStr() computes today in the Profile IANA timezone; addDays(d,n); WK[weekday] as [English, Chinese] pairs.
```
> `due_date` is a timezone-less date, compared as `YYYY-MM-DD` in the time zone chosen in Profile; the browser's device time zone is only a brief fallback before Profile returns. This keeps the dates Courses generates on the server and Schedule's "today" in the same user time zone, without reinterpreting historical dates as UTC timestamps.

### Lifecycle
`mountSchedule(el)` → `render()` (skeleton) → `load()`. Every init resets the previous account's tasks/goals/filters/streak and increments `sessionVersion`; late queries or writes may only update the UI if the version still matches.

**load()** — fetches 5 groups of Supabase data and `/api/learning-review-schedules` concurrently: tasks (`due_date >= today-14`, recent + future only), goals, Materials courses, materials, my streak/timezone, and Courses review schedules. Everything goes into state at once, then render; when the learning API fails temporarily, regular tasks still work, but the page clearly shows `reviewError` instead of pretending there are "no reviews".

**stats()** — computed purely on the frontend: this week's window = `[today, today+6]`; regular tasks and course reviews both count toward `wkTotal/wkDone`; `overdue` counts both incomplete tasks and pending, overdue review schedules.

### Views (body() branches by tab)
- **Today**: an `Overdue` section + a `Today` section, merging regular tasks and course reviews by date.
- **This week**: a 7-column grid, columns = the 7 days starting today; each column holds both regular tasks and review cards, and the "+" at the bottom still only creates regular tasks.
- **All**: incomplete or future regular tasks and course reviews rendered grouped by date.

**taskRow(t)** — a checkbox button (`data-sc="toggle"`; completed shows a green check + strikethrough) + title + course chip + material chip (`matChip`) + an overdue badge. Course/material chips carry `data-go="materials"` — clicking routes to Materials through the shell (linking).

**reviewRow(review)** — title, course/unit, selected skills, scope, and status. "Start review" on pending items carries `courseId/unitId/scheduleId` into Courses; only after the corresponding review session completes does the server mark the schedule completed. Schedule itself cannot fake completion with a checkbox.

**goalsBar()** — each goal computes `D-x = exam_date - today`, highlighted at ≤7 days; with a "✕" to delete.

### Events + actions
```
wire(): binds onclick on [data-sc] (preventDefault + stopPropagation + handle)
handle: settab / toggle / edit / del / addtask (with data-date) / addgoal / delgoal / autoplan
```
- **toggleTask(id)**: only `update study_tasks set done=!done`, no longer submitting a server time; checks Supabase `{ error }` → reads the owner's points receipt → `await load()` (refresh streak/stats) → `syncShellUser()` (refresh the bottom-left sidebar points). On completion it first shows "Task completed"; if the stable key's first decision is 0 because of the daily cap of 10, it then shows a non-blocking cap toast. A receipt failure does not roll back the task.
- **taskModal(existing, presetDate)**: one modal for create/edit. The date defaults to `presetDate` (carried from a week column's "+") or today. The course dropdown comes from my courses; **the material dropdown follows the selected course** (`drawMats()` filters materials by `course_id` on the course `onchange`). A `saving` lock prevents duplicates.
- **goalModal()**: title + date → insert study_goals.
- **autoplan()** (auto-fill): takes my courses (≤6) and creates `Review {course}` tasks, spreading `due_date` across this week with `addDays(today, i)` and setting `course_id`; one `insert(rows)`. This implements the prototype's "Re-plan" — purely heuristic, no AI, but it really writes to the database.

### Full data flow for completing one task
```
Click the checkbox (data-sc=toggle) → handle("toggle") → toggleTask
  → update study_tasks.done=true
  → trigger _on_task_done: activates the same-key +5 claim; computes streak only on first activation; may notify/level up
  → await load() refetches (streak/stats are authoritative) → render()
  → syncShellUser() refreshes the sidebar "Lv x · name · points"
```

---

## 4. Cross-module links
| Link | Where it is implemented |
|---|---|
| Complete/un-complete/delete → points/level | `_on_task_done` → `_set_point_event` → `point_entries` projection (see [08](08-notifications-feedback-profile.md)) |
| Complete → streak + milestone notification | Trigger streak + `_notify` (shown by the notifications module) |
| Task ↔ course/material | taskModal picks from Materials; chips `data-go="materials"` navigate |
| Auto-fill ← courses | autoplan reads courses to create tasks |
| Complete → instant sidebar points refresh | toggleTask calls `syncShellUser()` |
| Courses unit completed → review schedule | Choosing 3/7/15/30 days → learning API/RPC writes `learning_review_schedules` |
| Schedule review card → Courses | `data-go="courses"` carries course/unit/schedule ids to resume or create a review session |
| Courses review completed → Schedule | The transaction RPC that completes the session automatically completes the linked schedule; it shows as completed after reload |

## 5. Verification
See the [testing guide](../guides/TESTING.md) for runnable commands for the database E2E and jsdom Schedule regressions. Regular tasks cover first completion, un-completion reversal, redo net amount, deleting/recreating same-key tasks, unforgeable key/`done_at`, cross-owner course/material/goal failing on both client and service-role paths, no duplicate streaks, concurrent daily caps, and Supabase/receipt failures; Courses covers private schedule isolation, clients being unable to fake completion, automatic completion after the linked review session completes, merged display in Schedule, and click-through navigation. Cross-account cleanup/late responses keep using the session-version pattern.

## 6. To extend
- **Due-date reminders** need a server-side scheduler (Supabase `pg_cron`); today the UI highlights overdue/today items when you open the app, with no push.
- Net idempotency for points un-complete/redo, the daily task reward cap, frozen time zone windows, coordination pending-review signals, and rule versions are enabled by production 0039. Spam detection, a full moderation UI/appeals, and automatic operating rules are out of scope for this phase.
- Courses reviews store the attempt's local date in the user's time zone; ordinary `study_tasks.due_date` is still a timezone-less date, and the two must not be mixed into one reward fact.
- Wire "today's to-dos + streak" into the Home page.
