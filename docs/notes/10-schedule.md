# 10 · 学习计划 Schedule · 详解

> 文件：`supabase/migrations/20260625000007_schedule.sql`、`apps/web/src/legacy/schedule.ts`。依赖 0006 的 `_add_points / _notify`。

---

## 一、数据模型

### study_goals（目标/考试）
`id, user_id(默认 auth.uid()), title, exam_date date, course_id(可空,→courses on delete set null), created_at`。owner-only RLS。

### study_tasks（任务）
`id, user_id, title, due_date date(默认 current_date), done bool, done_at, course_id?, material_id?, goal_id?, created_at`。
- **三个可空外键**让任务能挂到 课程 / 资料 / 目标——这是和 Materials 的联动基础。
- `on delete set null`：删了课程/资料，任务还在，只是断开关联（不级联删任务）。

### profiles 增列
`streak int`（连续学习天数）、`streak_date date`（最近计入连续的那天）。

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

## 二、完成任务触发器（0007 `_on_task_done`，`security definer`）

`after update of done on study_tasks`：仅当 `done` 由 false→true 时执行（取消勾选不回滚）：
```
if new.done and not coalesce(old.done,false) then
  perform _add_points(new.user_id, 5);              -- 1) +5 积分（顺带可能升级，见 0006）
  select streak, streak_date into s, sd from profiles where id=new.user_id;
  if sd = today          then ns := s;              -- 2) 今天已计过 → streak 不变
  elsif sd = today - 1   then ns := s + 1;          --    昨天计过 → +1（连续）
  else                        ns := 1; end if;      --    断了/首次 → 重置为 1
  update profiles set streak=ns, streak_date=today where id=new.user_id;
  if ns in (3,7,14,30,100) and sd is distinct from today then
    perform _notify(new.user_id, 'streak', '🔥 连续学习 N 天', '...');   -- 3) 里程碑通知
  end if;
end if;
```
要点：
- **幂等防刷**：`streak_date=today` 时再完成任务不重复 +streak（但仍 +5 分——可按需改）。
- `is distinct from` 处理 NULL（首次 streak_date 为空）。
- definer：要改 profiles.points/streak + 写 notifications，普通用户对自己 profiles 有 update 权，但 points/streak 不该客户端可写，统一走触发器更稳。

---

## 三、前端（`schedule.ts`）

### 状态 + 日期工具
```
state = { loading, error, tab:'today'|'week'|'all', tasks, goals, courses, materials, streak };
dstr(d) → 'YYYY-MM-DD'（本地时区，避免 UTC 偏移）；todayStr()；addDays(d,n)；WK[周几]。
```
> 日期都用本地 `YYYY-MM-DD` 字符串比较（`due_date` 是 date 类型），不碰时间/时区，避免「今天的任务跑到昨天」。

### 生命周期
`mountSchedule(el)` → `render()`（骨架）→ `load()`。

**load()** — 一次并发拉 5 样：任务（`due_date >= 今天-14`，只取近期+未来）、目标、课程、资料、我的 streak。一把填进 state 再 render。

**stats()** — 纯前端计算：本周窗口 = `[今天, 今天+6]`；`wkTotal/wkDone`；`overdue` = 未完成且 `due_date < 今天`。

### 视图（body() 按 tab 分支）
- **今天**：`逾期`（`!done && due<today`）区 + `今天`（`due==today`）区；空态。
- **本周**：7 列网格，列 = 今天起 7 天；每列放 `due_date==该天` 的任务（紧凑 `.task` 样式，点一下即切换完成），底部「+」按该天日期加任务。
- **全部**：未完成或未来的任务，按 `due_date` 分组渲染。

**taskRow(t)** — 复选钮（`data-sc="toggle"`，完成则绿勾+删除线）+ 标题 + 课程 chip + 资料 chip（`matChip`）+ 逾期标。课程/资料 chip 带 `data-go="materials"`——点了由壳路由跳到 Materials（联动）。

**goalsBar()** — 每个目标算 `D-x = exam_date - 今天`，≤7 天高亮；带「✕」删除。

### 事件 + 动作
```
wire(): 给 [data-sc] 绑 onclick（preventDefault + stopPropagation + handle）
handle: settab / toggle / edit / del / addtask(带 data-date) / addgoal / delgoal / autoplan
```
- **toggleTask(id)**：`update study_tasks set done=!done, done_at` → `await load()`（刷新 streak/积分/统计）→ `syncShellUser()`（刷新左下角侧栏积分，跨模块调 [08](08-notifications-feedback-profile.md) 的导出函数）。完成时 toast「完成 +5 积分」。
- **taskModal(existing, presetDate)**：新建/编辑同一弹窗。日期默认 `presetDate`（本周列点「+」带过来）或今天。课程下拉来自我的 courses；**资料下拉随所选课程联动**（`drawMats()` 在 course `onchange` 时按 `course_id` 过滤 materials）。`saving` 锁防重复。
- **goalModal()**：标题 + 日期 → insert study_goals。
- **autoplan()**（智能填充）：取我的课程（≤6）生成 `复习 {课程}` 任务，`due_date` 用 `addDays(今天, i)` 铺到本周，带 `course_id`；一次性 `insert(rows)`。落地原型的「Re-plan」——纯启发式、不依赖 AI，但真的写库。

### 一次完成任务的完整数据流
```
点复选钮(data-sc=toggle) → handle("toggle") → toggleTask
  → update study_tasks.done=true
  → 触发器 _on_task_done：+5 分、streak 计算、可能里程碑通知、可能升级
  → await load() 重新拉（streak/统计为权威值）→ render()
  → syncShellUser() 刷新侧栏「Lv x · 名 · 积分」
```

---

## 四、跨模块联动一览
| 联动 | 实现位置 |
|---|---|
| 完成 → 积分/等级 | 触发器 `_add_points`（[08](08-notifications-feedback-profile.md) 的积分体系） |
| 完成 → 连续学习 + 里程碑通知 | 触发器 streak + `_notify`（通知模块展示） |
| 任务 ↔ 课程/资料 | taskModal 选自 Materials；chip `data-go="materials"` 跳转 |
| 智能填充 ← 课程 | autoplan 读 courses 生成任务 |
| 完成 → 侧栏积分即时刷新 | toggleTask 调 `syncShellUser()` |

## 五、验证
后端 e2e：完成 +5 分、streak=1、同日不重复计、RLS 隔离、关联课程归属校验被拦；jsdom 冒烟：三视图、目标倒计时、任务课程/资料链接、本周 7 列、加任务弹窗、勾选完成。

## 六、待扩展
- **到期提醒**需服务端定时（Supabase `pg_cron`）；现在是进应用时界面高亮逾期/今日，不主动推送。
- 取消完成是否回滚积分/streak（目前不回滚，防刷分简单）。
- Home 首页接「今日待办 + streak」串到首屏。
