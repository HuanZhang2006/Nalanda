# 08 · 通知 / 反馈 / 个人资料（真后端）

> 目标：三个用户向的小模块接真后端。通知=顶栏铃铛面板；反馈=提交+工单列表；个人资料=真实数据 + 活动积分 + 分级徽章。模式同 [06 Materials](06-materials.md)：supabase-js 直连 + owner-only RLS。

## 1. 数据层（迁移 0004 + 0006/0007 扩展）
- `notifications(user_id, type, title, body, read, created_at)` — owner-only RLS。
- `feedback(user_id, category, summary, body, status, created_at)` — owner-only RLS。
- `profiles` 增列：`points`（活动积分，见 0006）、`streak`/`streak_date`（连续学习，见 [10 Schedule](10-schedule.md) 0007）。

## 2. 通知（`legacy/notifications.ts`）
- **不是路由**，是顶栏铃铛（`#bellBtn`，`data-act="notifications"`）点开的浮层面板。
- `refreshNotifBadge()`：查 `read=false` 的 count → 铃铛红色角标；挂载后调用一次。
- `openNotifications()`：浮层（背景遮罩点击关闭、再点铃铛收起）→ 拉最近 40 条 → 渲染；单条点击 `update read=true`、「全部已读」批量更新；空态。
- `notify(title, body, type)`：导出给别的模块「自己给自己发通知」（如提交反馈后）。
- **真正的互动通知**（被赞/评论/转发/收藏/关注、streak 里程碑）不在前端发，而是数据库触发器写入（见 [09](09-community.md)/[10](10-schedule.md)）——前端只负责展示。

## 3. 反馈（`legacy/feedback.ts`，路由 `#fb-root`）
- 左侧表单（分类 chips + 概括 + 详情，带加载态/防重复）→ `insert feedback`；右侧「我的反馈」列出本人工单 + 状态色块。
- 提交后调用 `notify("反馈已收到", …)` 生成一条通知（给通知模块一个真实来源）。

## 4. 个人资料（`legacy/profile.ts`，路由 `#profile-root`）
- 读 `profiles` 自己的行 + 并发统计 `posts/materials/courses/feedback` 计数（`select id, {count:'exact', head:true}`）。
- **积分 points**（活动积分）展示为主，**与钱包 credits 区分**（credits 留给未来充值，见路线图）；等级由积分阈值决定（50/150/350/700/1200），带「还差 X 积分升级」进度环。
- **分级徽章**：发帖手/创作者/建课人/学者/反馈者，每类按真实计数分 **铜/银/金** 三级（`tierOf(val, thresholds)`），奖牌渐变随级别变亮 + 进度条。
- **编辑资料**弹窗（用户名/学校/专业/年级/语言）→ `update profiles`（RLS 仅本人）。改学校/专业会进 [09](09-community.md) 的全局标签池。
- `syncShellUser()`（导出）：拉 profile 写回 `DB.user` 并刷新左下角侧栏（用户名/等级/积分）与头像首字母。挂载时调用一次；积分变化的模块（如完成任务）也会调它即时刷新侧栏。

## 5. 接线（在 `legacy/app.ts`）
- 铃铛按钮加 `id=bellBtn data-act="notifications"` + 角标 `#notif-badge`；`ACTIONS.notifications` → `openNotifications()`。
- `VIEWS.feedback/profile` 覆盖为挂载点；`go()` 路由钩子挂载对应模块；`mountNalanda` 注入 supabase 并调 `refreshNotifBadge()` + `syncShellUser()`。

## 6. 验证
两用户后端 e2e：profiles 读/改本人、他人不可改；notifications 未读计数/标记已读/RLS 私有；feedback 提交/本人可见/他人 0 条。jsdom 集成冒烟：铃铛弹面板、feedback 路由、profile 真数据 + 侧栏同步。
