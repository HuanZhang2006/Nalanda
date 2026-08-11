# 10 · 学习计划 Schedule · 详解

> **文档定位**
> - **内容**：记录学习目标/普通任务、独立课程复习日程、RLS、完成奖励、连续学习和当前规则式填充。
> - **作用**：解释 Schedule 如何合并两套数据源，同时保持普通任务积分与 Courses 复习事实隔离。
> - **何时更新**：任务/目标字段、奖励幂等、提醒、排程算法、时区或关联权限变化时。
> - **状态基线**：2026-08-11。生产总 history 已到 0043；关联 owner trigger、数据库派生 `done_at` 和任务日上限已上线。

> 文件：`supabase/migrations/20260625000007_schedule.sql`（结构/旧触发器）、`...0008_security_points_ledger.sql`（稳定任务键、points 冲正与敏感列保护）、`...0011_learning_courses.sql`/`...0012_learning_course_workflows.sql`（复习日程及服务端工作流）、`...0039_security_integrity_rate_limit_points_abuse.sql`（生产 owner/done_at/日上限）、`apps/web/src/legacy/schedule.ts`、`apps/api/src/learning/*`。

---

## 一、数据模型

### study_goals（目标/考试）
`id, user_id(默认 auth.uid()), title, exam_date date, course_id(可空,→courses on delete set null), created_at`。owner-only RLS。生产 0039 增加防御 trigger，在客户端和绕过 RLS 的 service-role 路径都验证 course owner，并拒绝修改 `user_id`。

### study_tasks（任务）
`id, user_id, title, due_date date(默认 current_date), done bool, done_at, course_id?, material_id?, goal_id?, points_business_key, created_at`。
- **三个可空外键**让任务能挂到 课程 / 资料 / 目标——这是和 Materials 的联动基础。
- `on delete set null`：删了课程/资料，任务还在，只是断开关联（不级联删任务）。
- 0008 在 INSERT 时用 owner + 规范化 title/due_date/course/material/goal 生成不可变 `task:{owner}:{sha256}:completed:v1`；相同逻辑任务共享一个奖励 claim，客户端不能指定或修改 key。
- 生产 0039 trigger 重新验证 course/material/goal 全部属于 `new.user_id`，包括 service-role 路径；`done_at` 根据 `done` 自动设为服务器 `now()` 或清空。兼容期列 grant 保留但客户端值总被覆盖，Web 不再提交该字段。

### profiles 增列
`streak int`（连续学习天数）、`streak_date date`（最近计入连续的那天），以及 Courses 0011 的合法 IANA `timezone`。复习尝试与日程偏移使用该时区；历史日期不会因后续改时区而重写。

### learning_review_schedules（Courses 复习日程）
`user_id, course_id, unit_id, source_session_id, due_date, skills[], scope, status, completed_session_id, completed_at`。它只承载英语单词课程的 3/7/15/30 天复习选择，**不会写入 `study_tasks`**，因此完成复习不会误触发普通任务 +5 points。创建时必须引用本人该单元已完成的 initial session；日程启动时以数据库保存的 skills/scope 为准，完成 review session 后原子回填 completed session。创建、取消和完成均经 NestJS + service-role RPC；客户端只通过聚合 API 读取自己的日程。

### RLS（带「关联归属校验」）
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
**为什么**：owner-only 只保证「任务是我的」，但外键不保证「我引用的课程也是我的」。不加这层，理论上能把任务挂到别人的课程 id 上（脏数据）。这是 [06 Materials](06-materials.md) 0003 那条教训的复用——**外键 ≠ 权限**。e2e 里「B 不能挂 A 的课程」验证此点。

---

## 二、完成任务触发器（0008 `_on_task_done`，`security definer`）

0008 替换 0007 的直接加分触发器，监听 `done` 更新和任务删除：

```text
done=true  → _set_point_event(stable_task_key, +5, active=true)
done=false → 若没有其它同键已完成任务，写 -5 冲正
DELETE     → 若删除的是最后一个同键已完成任务，写 -5 冲正
```

`_set_point_event` 用业务键 advisory lock + 状态行锁串行化。相同状态重试返回 no-op；取消后重做只写恢复 entry，因此该键的净额最多 +5。`profiles.points/level` 每次从完整账本总和重建，而不是在已 clamp 的缓存上盲目加减。

streak 规则与 points 分开：

- 只有该永久任务键第一次成功激活（`transition=1`）才按 `streak_date` 推进 streak；同日保持、昨日 +1、断档/首次重置为 1；
- 取消、删除或重做不会回退或再次推进 streak；streak 表示“曾在某日完成有效任务”的历史活动，不是当前 done 数；
- 迁移前已完成任务以 active/transition 0 回填，后续重做不会伪造新 streak；
- 3/7/14/30/100 天首次到达时由 `_notify` 写里程碑通知。

Profile 的 points/level/streak 列已禁止普通客户端更新；`_set_point_event`、`_notify` 和 trigger helpers 也没有客户端 EXECUTE，触发器以受控 definer 权限完成写入。

---

## 三、前端（`schedule.ts`）

### 状态 + 日期工具
```
state = { loading, error, reviewError, tab:'today'|'week'|'all', tasks, reviews, goals, courses, materials, streak, timezone };
dstr(d) → 'YYYY-MM-DD'；todayStr() 用 Profile IANA timezone 计算今天；addDays(d,n)；WK[周几]。
```
> `due_date` 是无时区 date，比较时使用 Profile 所选时区的 `YYYY-MM-DD`；浏览器设备时区只在 Profile 尚未返回时作短暂兜底。这样 Courses 服务端生成的日期与 Schedule “今天”保持同一用户时区，同时不把历史 date 重新解释成 UTC 时间戳。

### 生命周期
`mountSchedule(el)` → `render()`（骨架）→ `load()`。每次 init 会重置上一账号的任务/目标/筛选/streak，并递增 `sessionVersion`；延迟查询或写入只有版本仍匹配时才允许更新 UI。

**load()** — 一次并发拉 5 组 Supabase 数据和 `/api/learning-review-schedules`：任务（`due_date >= 今天-14`，只取近期+未来）、目标、Materials 课程、资料、我的 streak/timezone、Courses 复习日程。一把填进 state 再 render；学习 API 暂时失败时普通任务仍可使用，但页面明确显示 `reviewError`，不会把故障伪装成“没有复习”。

**stats()** — 纯前端计算：本周窗口 = `[今天, 今天+6]`；普通任务和课程复习共同计入 `wkTotal/wkDone`；`overdue` 同时统计未完成任务与 pending 且过期的复习日程。

### 视图（body() 按 tab 分支）
- **今天**：`逾期`区 + `今天`区，按日期合并普通任务和课程复习。
- **本周**：7 列网格，列 = 今天起 7 天；每列同时放普通任务和复习卡，底部「+」仍只创建普通任务。
- **全部**：未完成或未来的普通任务与课程复习按日期分组渲染。

**taskRow(t)** — 复选钮（`data-sc="toggle"`，完成则绿勾+删除线）+ 标题 + 课程 chip + 资料 chip（`matChip`）+ 逾期标。课程/资料 chip 带 `data-go="materials"`——点了由壳路由跳到 Materials（联动）。

**reviewRow(review)** — 标题、课程/单元、所选能力、范围和状态。pending 项的“开始复习”带 `courseId/unitId/scheduleId` 跳入 Courses；只有对应复习 session 完成后，服务端才将日程标记 completed。Schedule 本身不能勾选伪造完成。

**goalsBar()** — 每个目标算 `D-x = exam_date - 今天`，≤7 天高亮；带「✕」删除。

### 事件 + 动作
```
wire(): 给 [data-sc] 绑 onclick（preventDefault + stopPropagation + handle）
handle: settab / toggle / edit / del / addtask(带 data-date) / addgoal / delgoal / autoplan
```
- **toggleTask(id)**：只 `update study_tasks set done=!done`，不再提交服务端时间；检查 Supabase `{ error }` → 读取 owner points receipt → `await load()`（刷新 streak/统计）→ `syncShellUser()`（刷新左下角侧栏积分）。完成时先提示「任务已完成」；若稳定 key 的首次 decision 因每日 10 个上限为 0，再显示不阻断的上限 toast。receipt 失败不回滚任务。
- **taskModal(existing, presetDate)**：新建/编辑同一弹窗。日期默认 `presetDate`（本周列点「+」带过来）或今天。课程下拉来自我的 courses；**资料下拉随所选课程联动**（`drawMats()` 在 course `onchange` 时按 `course_id` 过滤 materials）。`saving` 锁防重复。
- **goalModal()**：标题 + 日期 → insert study_goals。
- **autoplan()**（智能填充）：取我的课程（≤6）生成 `复习 {课程}` 任务，`due_date` 用 `addDays(今天, i)` 铺到本周，带 `course_id`；一次性 `insert(rows)`。落地原型的「Re-plan」——纯启发式、不依赖 AI，但真的写库。

### 一次完成任务的完整数据流
```
点复选钮(data-sc=toggle) → handle("toggle") → toggleTask
  → update study_tasks.done=true
  → 触发器 _on_task_done：激活同键 +5 claim；仅首次激活计算 streak；可能通知/升级
  → await load() 重新拉（streak/统计为权威值）→ render()
  → syncShellUser() 刷新侧栏「Lv x · 名 · 积分」
```

---

## 四、跨模块联动一览
| 联动 | 实现位置 |
|---|---|
| 完成/取消/删除 → 积分/等级 | `_on_task_done` → `_set_point_event` → `point_entries` projection（见 [08](08-notifications-feedback-profile.md)） |
| 完成 → 连续学习 + 里程碑通知 | 触发器 streak + `_notify`（通知模块展示） |
| 任务 ↔ 课程/资料 | taskModal 选自 Materials；chip `data-go="materials"` 跳转 |
| 智能填充 ← 课程 | autoplan 读 courses 生成任务 |
| 完成 → 侧栏积分即时刷新 | toggleTask 调 `syncShellUser()` |
| Courses 单元完成 → 复习日程 | 选择 3/7/15/30 天 → learning API/RPC 写 `learning_review_schedules` |
| Schedule 复习卡 → Courses | `data-go="courses"` 携带 course/unit/schedule id，恢复或创建 review session |
| Courses 复习完成 → Schedule | 完成 session 的事务 RPC 自动完成关联日程；重新加载后显示已完成 |

## 五、验证
数据库 E2E 与 jsdom Schedule 回归的可执行命令见 [测试指南](../guides/TESTING.md)。普通任务覆盖首次完成、取消冲正、重做净额、删除/重建同键任务、key/`done_at` 不可伪造、跨 owner course/material/goal 在客户端和 service-role 都失败、streak 不重复、每日并发上限和 Supabase/receipt 失败；Courses 覆盖日程私有隔离、客户端不能伪造完成、完成关联复习 session 后自动完成、Schedule 合并显示和点击跳转。跨账号清理/迟到响应继续使用 session-version 模式。

## 六、待扩展
- **到期提醒**需服务端定时（Supabase `pg_cron`）；现在是进应用时界面高亮逾期/今日，不主动推送。
- points 取消/重做的净额幂等、每日任务奖励上限、冻结时区窗口、协同待审信号和规则版本已由生产 0039 启用。垃圾内容识别、完整审核 UI/申诉和自动运营规则不在本阶段。
- Courses 复习按用户时区保存尝试的本地日期；普通 `study_tasks.due_date` 仍是无时区 date，两者不要混用为同一奖励事实。
- Home 首页接「今日待办 + streak」串到首屏。
