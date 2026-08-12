# 08 · 通知 / 反馈 / 个人资料 · 详解

> **文档定位**
> - **内容**：记录通知面板、反馈和 Profile/Growth 的当前数据流与前端函数。
> - **作用**：解释三个真实 Supabase 模块及其联动，并标明客户端字段与服务端字段的权限边界。
> - **何时更新**：Profile 字段/权限、通知刷新方式、反馈状态机或徽章/等级规则变化时。
> - **状态基线**：2026-08-12。生产总 history 已到 0048；Feedback 只读/新增和 points 日上限回执/通知已上线。

> 文件：`...0004_notifications_feedback.sql`（表）、`...0006_*`（旧 points）、`...0007_*`（streak）、`...0008_security_points_ledger.sql`（敏感列与 points 账本）、`...0011_learning_courses.sql`（timezone 与课程徽章）、`...0039_security_integrity_rate_limit_points_abuse.sql`（生产 Feedback/points 收口）、`apps/web/src/legacy/{notifications,feedback,profile}.ts`、`apps/api/src/{learning,points}`。

---

## 一、数据模型
- `notifications(user_id, type, title, body, read bool, created_at)` — owner-only RLS。`type` 仅做图标/分类用途，前端目前不强依赖。
- `feedback(user_id, category, summary, body, status default 'open', created_at)` — 生产 0039 起拆成 owner SELECT/INSERT，authenticated 只获准插入 `category/summary/body`，不能 UPDATE/DELETE 或指定 status/owner/time。
- `profiles` 相关列：`points`（活动积分，0008 起由 `point_entries` 重建）、`level/level_name`（由 points 阈值派生）、`streak/streak_date`（0007 增加、0008 锁为服务端维护）、`credits`（**预留给未来充值钱包，与 points 不同**）、`timezone`（0011 增加，必须是 PostgreSQL 可识别的 IANA 时区）。

> 关键概念：**积分 points（做事赚）≠ 钱包 credits（充值/未来）**。Profile 展示 points；credits 暂不展示。

> 当前边界：0008 已撤销 Profile 整表 UPDATE；0011 后 authenticated 只获准更新 `username/university/major/year/language/timezone`，防御触发器同时保护 points、credits、level、VIP 和 streak。points/notification/learning definer helpers 均已撤销客户端 EXECUTE。生产 0039 已收口 feedback `FOR ALL` 缺口，status 只由支持流程维护。

---

## 二、通知（`notifications.ts`）—— 顶栏铃铛面板（非路由）

模块级：`sb, USER, toastFn, items[]`。

**initNotifications(sb,user,toast)** — 注入依赖（在 `mountNalanda` 里调）。

每次 init 都会清空上一账号缓存并递增会话版本；加载、标记已读和发送通知的延迟结果只有版本仍匹配时才更新当前 UI。Supabase 返回的 `{ error }` 会转成可见失败，不再把失败请求当成功。

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

生产 0039 在奖励 business transaction 首次判定某种奖励/自然日超限时，同事务幂等写入一条 `points_daily_cap` 通知；owner-only `get_point_reward_receipt` 只读取该用户的奖励 decision。客户端断网、重复读取回执、删除重建或换时区都不会漏写或重复通知；前端只负责刷新铃铛和显示 toast，不能自行创建“已达上限”的权威事实。

---

## 三、反馈（`feedback.ts`）—— 路由 `#fb-root`

模块级：`state={loading,error,tickets,category:'Bug',saving}`；常量 `CATS`（分类）、`STATUS`（状态→[中文,色]）。init 会重置此 state，异步操作用会话版本丢弃跨账号迟到响应。

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

模块级：`state={loading,error,learningError,profile,counts:{posts,materials,courses,feedback},learning:{courses,learnedWords,reviewDays,badges}}`；常量 `LEVEL_TH=[50,150,350,700,1200]`、`TIER_BG`（铜/银/金渐变）、`tierOf(v,th)`。init 会重置 state，加载/保存/壳同步都校验 Supabase `{ error }` 与会话版本。

**fetchProfile()** — 一次并发执行 5 个 Supabase 查询和 1 个受鉴权 API 请求：
```
profiles(本人 *), posts(count, repost_of=null), materials(count), courses(count), feedback(count)
/api/profile/learning-summary → learning_courses 数、熟练词去重数、不同复习日期数、已持久发放课程徽章
```
Supabase 计数用 `count:"exact", head:true`；学习统计由 NestJS/service-role 聚合，前端不直接读取徽章或学习事实表。学习统计 API 暂时失败时基础 Profile 继续展示，同时显示 `learningError` 降级提示；不会把服务故障静默冒充成零课程/零徽章。

**nextLevelInfo(points)** — 在 `LEVEL_TH` 里找下一个阈值，算「距下一级的百分比」给等级环 `--p`。

**render()** —
- 头部卡：头像（首字母）、用户名、邮箱、学校·专业·年级、VIP（`vip_until>now` 才显示）；**等级环**（`--p` = nextLevelInfo 百分比，显示 level + level_name + 「还差 X 积分升级」）；**积分 Points** 大数字。
- 「你的数据」四格：发帖 / 资料 / **学习课程** / 积分；其下另列学习课程数、熟练的不同英文词数和不同复习日期数。
- **原有展示型分级徽章**：5 类（发帖手/创作者/Materials 学科建课人/学者/反馈者），每类 `tierOf(真实值, 阈值数组)` 得 0–3 级；奖牌 `background=TIER_BG[tier]`（铜→银→金渐变，越高越亮）+ 进度条到下一级。
  ```
  发帖手: posts,[1,10,50]   创作者: materials,[1,10,30]   建课人: courses,[1,3,8]
  学者:  points,[50,350,1200]   反馈者: feedback,[1,3,10]
  ```
- **持久课程徽章**：服务端按事实一次性写入 `user_badge_awards`，Profile 展示获得日期：
  - 词汇行者：20 / 200 / 1000 个不同规范化熟练英文词；
  - 课程毕业生：1 / 5 / 20 门达到奖励资格且 100% 熟练的课程；
  - 复习坚持者：3 / 15 / 50 个不同本地复习日期。

展示型旧徽章可随当前计数回退；课程徽章是历史奖励事实，不会因删除课程或统计回退而被伪造重发。

**editModal()** — 改用户名/学校/专业/年级/语言/**IANA 时区** → `update profiles`（RLS 仅本人）；保存后 `load()` + `syncShellUser()`。非法时区由数据库触发器拒绝。改学校/专业会触发 0006 的 `profiles_tags` 触发器进全局标签池（联动社区）。时区只影响未来复习尝试保存的本地日期，不重写历史日期。

**syncShellUser()**（导出）— 把真实 profile 同步到**应用外壳**：拉 profile → 写 `DB.user`（name/initials/points/level/levelName）→ 直接改 DOM：左下角 `.uchip-name`、`.uchip-sub`（`Lv x · 名 · 积分`）、头像首字母。挂载时调一次；**任何改变积分的模块**（社区互动、完成任务）也调它即时刷新侧栏。

> 这是「vanilla 子应用」之间共享用户态的方式：`DB.user` 作为共享对象 + 直接 patch 壳的 DOM 节点，而不是搞全局状态库。

---

## 五、接线（`app.ts`）
- 铃铛按钮：`id="bellBtn" data-act="notifications"` + 角标 `#notif-badge`；`ACTIONS.notifications → openNotifications()`。
- `VIEWS.feedback/profile` 覆盖为挂载点 `#fb-root`/`#profile-root`；`go()` 路由钩子 `requestAnimationFrame` 后挂载对应模块。
- `mountNalanda` 注入 supabase 给三个 `init*`，并在启动后调 `refreshNotifBadge()` + `syncShellUser()`。

## 六、验证
两用户 RLS E2E 覆盖 profiles 隔离、timezone 校验、notifications 私有、Feedback 只读/新增及 status/update/delete 拒绝、回执 owner 边界、学习统计与徽章表不可由客户端伪造；jsdom 覆盖铃铛、错误提示、feedback、即时上限 toast、Profile 学习统计/徽章、侧栏同步与跨账号清理。PR/main 会在一次性本地 Supabase 运行 RLS 套件；实际文件和命令见[测试指南](../guides/TESTING.md)。

## 七、可扩展
- 通知做实时（Supabase Realtime 订阅 `notifications` 表 → 来新通知即时跳角标）。
- 通知点击跳转到来源（帖子/任务）——目前只标已读。
- 反馈管理端（经受控 API 改 status，而不是恢复客户端 UPDATE）；feedback 关联订单/笔记（多态）。
