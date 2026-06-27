# 10 · 学习计划 Schedule（真后端 + 跨模块联动）

> 目标：今天/本周/全部三视图的任务管理 + 目标倒计时；完成任务接入积分/连续学习；任务关联课程与资料（联动 Materials）；从课程一键智能填充。

## 1. 数据层（迁移 0007）
- `study_goals(title, exam_date, course_id?)` — owner-only RLS。
- `study_tasks(title, due_date, done, done_at, course_id?, material_id?, goal_id?)` — owner-only；**写入校验关联归属**：`course_id/material_id/goal_id` 若非空必须属于本人（`with check ... exists(...)`，沿用 [06](06-materials.md) 0003 的「外键≠权限」教训）。
- `profiles.streak/streak_date`（连续学习天数 + 最近计入日）。

## 2. 完成任务的联动（触发器 `_on_task_done`，迁移 0007）
`done` 由 false→true 时（`after update of done`，`security definer`）：
- **+5 积分**（调 0006 的 `_add_points`，顺带可能升级）。
- **连续学习 streak**：`streak_date = 今天` 不重复计；`= 昨天` 则 +1；否则重置为 1。
- **里程碑通知**：streak 命中 3/7/14/30/100 天，`_notify()` 发一条祝贺通知。

## 3. 前端（`legacy/schedule.ts`，路由 `#sched-root`）
- **三视图**：今天（逾期 + 今日）/ 本周（今天起 7 天网格，每列可加任务）/ 全部（按日期分组）。
- **任务 CRUD**：标题、日期、关联课程（选自我的 courses）、关联资料（按所选课程过滤 materials）；勾选完成 / 取消；编辑 / 删除。
- **目标倒计时**：新建考试/DDL，顶部 chip 显示 `D-x`。
- **统计**：本周完成数/总数、连续学习天数、逾期数。
- **智能填充** `autoplan()`：取我的课程（≤6 门）生成「复习 {课程}」任务，按天铺到本周（落地原型「Re-plan」，纯启发式，无需 AI）。

## 4. 跨模块联动一览
| 联动 | 实现 |
|---|---|
| 完成 → 积分/等级 | 触发器 +5 分；调 `_add_points` 重算等级（[08](08-notifications-feedback-profile.md)） |
| 完成 → 连续学习 + 通知 | streak 计算 + 里程碑 `_notify`（通知模块展示） |
| 任务 ↔ 课程/资料 | 选自 Materials 的课程/资料；任务上的 chip `data-go="materials"` 跳转 |
| 智能填充 ← 课程 | 读 courses 生成复习任务 |
| 完成 → 侧栏积分刷新 | `toggleTask` 后调 `syncShellUser()`（[08](08-notifications-feedback-profile.md)） |

## 5. 验证
后端 e2e：完成任务 +5 分、streak=1、同日不重复计、RLS 隔离、关联课程归属校验被拦；jsdom 冒烟：三视图、目标倒计时、任务课程/资料链接、本周 7 列、加任务弹窗、勾选完成。

## 6. 待办 / 可扩展
- **到期提醒**需服务端定时（Supabase cron / pg_cron）；当前是进应用时在界面高亮逾期/今日，不自动推送。
- Home 首页接「今日待办 + streak」即可把计划串到首屏（Home 仍为 mock）。
- AI 联动：任务「从资料生成笔记」直达 AI 笔记生成（待 AI 模块）。
