# 08 · 通知 / 反馈 / 个人资料 · 详解

> 文件：`...0004_notifications_feedback.sql`（表）、`...0006_*`（profiles.points）、`...0007_*`（profiles.streak）、`apps/web/src/legacy/{notifications,feedback,profile}.ts`。

---

## 一、数据模型
- `notifications(user_id, type, title, body, read bool, created_at)` — owner-only RLS。`type` 仅做图标/分类用途，前端目前不强依赖。
- `feedback(user_id, category, summary, body, status default 'open', created_at)` — owner-only RLS。
- `profiles` 相关列：`points`（活动积分，0006）、`level/level_name`（由 points 推导，0006 的 `_add_points` 维护）、`streak/streak_date`（0007）、`credits`（**预留给未来充值钱包，与 points 不同**）。

> 关键概念：**积分 points（做事赚）≠ 钱包 credits（充值/未来）**。Profile 展示 points；credits 暂不展示。

---

## 二、通知（`notifications.ts`）—— 顶栏铃铛面板（非路由）

模块级：`sb, USER, toastFn, items[]`。

**initNotifications(sb,user,toast)** — 注入依赖（在 `mountNalanda` 里调）。

**refreshNotifBadge()** — 只查数量不取数据：
```
const { count } = await sb.from("notifications").select("id",{count:"exact",head:true}).eq("read",false);
```
`head:true` 表示「只要 count、不要行」（HTTP HEAD，省流量）。有未读 → 显示铃铛角标 `#notif-badge`，否则隐藏。应用挂载后调一次。

**openNotifications()** — 点铃铛触发（`ACTIONS.notifications` 在壳里）：
- **再点收起**：若 `#notif-pop` 已存在则移除返回（toggle）。
- 造浮层：全屏透明 `#notif-backdrop`（点它关闭）+ 右上角面板（标题 + 「全部已读」+ 列表）。
- 内部 `reload()`：拉最近 40 条（`order created_at desc limit 40`）→ `draw()`。
- `draw()`：空态 / 列表项（未读项背景高亮 + 圆点）；点单条 → `update read=true` + 重绘 + `refreshNotifBadge()`。
- 「全部已读」→ `update({read:true}).eq("read",false)` 批量。

**notify(title, body, type)** — 导出给别的模块「给自己发通知」（如 feedback 提交后）。注意：**社区/计划的互动通知不走它**，而是数据库触发器写入（见 [09](09-community.md)/[10](10-schedule.md)）——前端只负责读和展示。

> 设计：通知的「产生」分两类。①自己触发自己（提交反馈）走前端 `notify()`；②别人触发你（被赞/评论/关注、streak 里程碑）走 `security definer` 触发器，因为要给「别人」插通知，前端没那个 RLS 权限。

---

## 三、反馈（`feedback.ts`）—— 路由 `#fb-root`

模块级：`state={loading,error,tickets,category:'Bug',saving}`；常量 `CATS`（分类）、`STATUS`（状态→[中文,色]）。

- **mountFeedback(el)** → `render()`（骨架）→ `load()`。
- **load()** → `sb.from("feedback").select("*").order("created_at",desc)`（RLS 只返回自己的）→ 填 `tickets`。
- **render()** — 左侧表单（分类 chips + 概括 input + 详情 textarea + 提交），右侧「我的反馈」列表（`ticketHtml`：分类 chip + 状态色块 + 概括 + 时间）。
- **wire()/handle()** — `[data-fb]` 绑定：`cat`（切分类，重渲染高亮）/ `submit`。
- **submit(btn)** — `saving` 锁 + 按钮变「提交中…」；校验概括非空 →
  ```
  await sb.from("feedback").insert({category, summary, body});
  await notify("反馈已收到", summary, "feedback");   // 顺带给通知模块一个真实来源
  toast("已提交"); await load();
  ```
  失败回滚按钮态。

---

## 四、个人资料（`profile.ts`）—— 路由 `#profile-root`

模块级：`state={loading,error,profile,counts:{posts,materials,courses,feedback}}`；常量 `LEVEL_TH=[50,150,350,700,1200]`、`TIER_BG`（铜/银/金渐变）、`tierOf(v,th)`。

**fetchProfile()** — 一次并发 5 个查询：
```
profiles(本人 *), posts(count, repost_of=null), materials(count), courses(count), feedback(count)
```
全用 `count:"exact", head:true` 取数量。

**nextLevelInfo(points)** — 在 `LEVEL_TH` 里找下一个阈值，算「距下一级的百分比」给等级环 `--p`。

**render()** —
- 头部卡：头像（首字母）、用户名、邮箱、学校·专业·年级、VIP（`vip_until>now` 才显示）；**等级环**（`--p` = nextLevelInfo 百分比，显示 level + level_name + 「还差 X 积分升级」）；**积分 Points** 大数字。
- 「你的数据」四格：发帖 / 资料 / 课程 / 积分（真实计数）。
- **分级徽章**：5 类（发帖手/创作者/建课人/学者/反馈者），每类 `tierOf(真实值, 阈值数组)` 得 0–3 级；奖牌 `background=TIER_BG[tier]`（铜→银→金渐变，越高越亮）+ 进度条到下一级。
  ```
  发帖手: posts,[1,10,50]   创作者: materials,[1,10,30]   建课人: courses,[1,3,8]
  学者:  points,[50,350,1200]   反馈者: feedback,[1,3,10]
  ```

**editModal()** — 改 用户名/学校/专业/年级/语言 → `update profiles`（RLS 仅本人）；保存后 `load()` + `syncShellUser()`。改学校/专业会触发 0006 的 `profiles_tags` 触发器进全局标签池（联动社区）。

**syncShellUser()**（导出）— 把真实 profile 同步到**应用外壳**：拉 profile → 写 `DB.user`（name/initials/points/level/levelName）→ 直接改 DOM：左下角 `.uchip-name`、`.uchip-sub`（`Lv x · 名 · 积分`）、头像首字母。挂载时调一次；**任何改变积分的模块**（社区互动、完成任务）也调它即时刷新侧栏。

> 这是「vanilla 子应用」之间共享用户态的方式：`DB.user` 作为共享对象 + 直接 patch 壳的 DOM 节点，而不是搞全局状态库。

---

## 五、接线（`app.ts`）
- 铃铛按钮：`id="bellBtn" data-act="notifications"` + 角标 `#notif-badge`；`ACTIONS.notifications → openNotifications()`。
- `VIEWS.feedback/profile` 覆盖为挂载点 `#fb-root`/`#profile-root`；`go()` 路由钩子 `requestAnimationFrame` 后挂载对应模块。
- `mountNalanda` 注入 supabase 给三个 `init*`，并在启动后调 `refreshNotifBadge()` + `syncShellUser()`。

## 六、验证
两用户后端 e2e：profiles 读/改本人、他人不可改；notifications 未读计数/标记已读/RLS 私有；feedback 提交/本人可见/他人 0 条。jsdom 集成冒烟：铃铛弹面板、feedback 路由、profile 真数据 + 侧栏同步。

## 七、可扩展
- 通知做实时（Supabase Realtime 订阅 `notifications` 表 → 来新通知即时跳角标）。
- 通知点击跳转到来源（帖子/任务）——目前只标已读。
- 反馈管理端（admin 改 status）；feedback 关联订单/笔记（多态）。
