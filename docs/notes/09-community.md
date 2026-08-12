# 09 · 社区（真后端 · 全社交功能）· 详解

> **文档定位**
> - **内容**：记录社区表/RLS/触发器、前端状态、互动流程和已知取舍。
> - **作用**：作为当前社区实现的函数级复盘和后续治理改造入口。
> - **何时更新**：帖子字段、RLS、积分、媒体、审核、前端交互或测试覆盖变化时。
> - **状态基线**：2026-08-12。生产总 history 已到 0048；帖子可信列、日上限、人工 points 冲正和只待审协同检测已上线。

> 目标：能照着复盘/重写。逐表讲数据与 RLS、逐触发器讲服务端逻辑、逐函数讲前端逻辑与数据流。
> 文件：`supabase/migrations/20260625000005_community.sql`（结构）、`...0006_points_tags_notify.sql`（旧积分/通知/标签/媒体）、`...0008_security_points_ledger.sql`（稳定业务键、账本与冲正）、`...0039_security_integrity_rate_limit_points_abuse.sql`（生产可信列/日上限/审核/协同信号）、`apps/web/src/legacy/community.ts`（前端）、`apps/api/src/points/*`（管理边界）。

---

## 一、数据模型（为什么这样设计）

### posts（帖子）
关键列：`id, user_id(作者), author_name/author_university/author_major(展示快照), title, body, kind, subject(遗留,未用), tags text[], repost_of(转发指向原帖), points_business_key(0008 生成且不可变), like_count/comment_count/favorite_count/repost_count(冗余计数), image_url/audio_url, created_at/updated_at`。

设计要点：
- **作者快照字段**：社区要展示「别人」的名字/学校，但 `profiles` 是 owner-only（只能读自己）。两种解法：放开 profiles 读权限，或把作者信息「拍快照」存到帖子上。选后者——更隐私（不暴露 email 等），代价是改名后旧帖不更新（可接受）。
- **冗余计数列**：feed 要显示赞数/评论数。每次 `count(*)` 太慢，所以在帖子行上存计数，由触发器维护（见下）。
- **转发即帖子**：`repost_of` 指向原帖，转发就是一条普通 post。好处：转发自然进入 feed、可被再赞/评论；坏处：要在渲染时把原帖查出来内嵌。

### comments / post_likes / post_favorites / follows / tags
- `comments(post_id, user_id, author_name, body, points_business_key)`；同一用户对同一稳定目标内容的多个评论共享一个 points claim。
- `post_likes(post_id,user_id,points_business_key)` / `post_favorites`：联合主键 `(post_id, user_id)`——天然防同一行重复点赞/收藏；0008 的稳定键还跨同内容重建/重复帖去重奖励。
- `follows(follower_id, following_id)` 联合主键。
- `tags(kind, value)` 联合主键，`kind ∈ university|major|subject|tag`——全局标签池（见 0006）。

---

## 二、RLS：第一个「公共可读」模块

之前所有表都是 owner-only。社区不同：**帖子/评论人人可读，但只有作者能写改删**。

```sql
-- posts
create policy posts_select_all  ... for select to authenticated using (true);          -- 谁都能读
create policy posts_insert_own  ... for insert with check (user_id = auth.uid());       -- 只能以自己身份发
create policy posts_update_own  ... for update using (user_id=auth.uid()) with check(...);-- 只能改自己的
create policy posts_delete_own  ... for delete using (user_id = auth.uid());            -- 只能删自己的
```
- comments 同款（公共读 + 作者写删）。
- **likes/favorites 是 owner-only**（`for all using user_id=auth.uid()`）：你只能看到/改自己的点赞记录。「这帖多少赞」不靠查 likes 表，而靠帖子上的 `like_count`。这样既不泄露「谁赞了谁」，又能显示总数。
- follows：`select using (follower_id=auth.uid() or following_id=auth.uid())`——能看自己关注的人 + 自己的粉丝。
- 生产 0039 在行级 owner policy 之外增加列级白名单：INSERT 只接受内容列和 `repost_of`，UPDATE 只接受 `title/body/kind/subject/tags/image_url/audio_url`。`user_id`、作者快照、四个计数、repost、points key 和时间由数据库维护；兼容期虽保留 `updated_at` UPDATE grant，trigger 会覆盖客户端值。

> 心法：**读权限按「这数据该不该公开」定**，不是一刀切 owner-only。写权限永远卡 `auth.uid()`。

---

## 三、触发器（服务端逻辑，全部 `security definer`）

为什么都要 `security definer`：触发器要改「别人的」行（点赞者去加帖主的计数、给帖主发通知），而调用者按 RLS 没权限改别人的行；`security definer` 让函数以属主（高权限）身份执行，绕过 RLS。

### 1) 计数维护（0005 `_bump_counts`）
`after insert or delete on post_likes/post_favorites/comments`：
```
d := (插入 ? +1 : -1); pid := coalesce(new.post_id, old.post_id);
update posts set like_count = greatest(0, like_count + d) where id = pid;  -- 按表名选列
```
`greatest(0, …)` 防止并发/异常把计数压成负数。

### 2) 作者快照 + 防伪造（0005 `_post_author` / `_comment_author`）
`before insert on posts`：
```
select username, university, major into new.author_name, new.author_university, new.author_major
from profiles where id = auth.uid();
```
INSERT 时会无视客户端传的 author_*，强制用 profiles 真值。生产 0039 用列 grant + `_protect_post_trusted_fields` trigger 同时保护 UPDATE：内容变化才刷新 `updated_at`，纯计数 trigger 变化不伪造“刚编辑”。

### 3) 转发计数（0005 `_bump_repost`）
`after insert/delete on posts`：若 `repost_of` 非空，给原帖 `repost_count ±1`。

### 4) 积分 + 互动通知（0006，points 在 0008 替换）
- `_add_points(uid, d)` 已停用并对客户端/service-role 撤权；`profiles.points` 由 append-style `point_entries` 总和重建。
- `_set_point_event(...)` 是唯一 points 状态转换入口：按稳定业务键串行化，激活写正 entry，删除/取消写负 entry，同状态重试为 no-op；客户端无 EXECUTE。
- `_notify(uid, type, title, body)` 仍由受信 trigger/service-role 写通知，但客户端 EXECUTE 已撤销。
- 触发器：
  - `_on_like`（insert/delete）：非自赞首次有效 claim **+1**，删尽同键关系 **-1**；通知帖主。
  - `_on_comment`（insert/delete）：非自评首次有效 claim **+2**，删尽同键评论 **-2**；通知帖主。
  - `_on_fav`：通知帖主（不加分）。
  - `_on_post`（insert/delete）：原创有效 claim **+10**、转发 **+3**；删尽同键帖子时冲正，转发时通知原作者。
  - `_on_follow`：通知被关注者。

原创键由作者 + 规范化 title/body/kind/subject/排序 tags 的 SHA-256 生成；转发锚定根原创键；点赞/评论锚定目标帖的不可变键 + actor。数据库在 before insert 生成这些字段，并拒绝修改 `repost_of` 或已生成的 key。

### 5) 全局标签自动收集（0006）
- `profiles` 改 university/major、`courses` 新建 → upsert 进 `tags`（`on conflict do nothing`）。
- 迁移里一次性回填历史数据。
- 媒体：建公开桶 `community-media`（仅本人文件夹可写，公开可读）。

---

## 四、前端模块结构（`community.ts`）

### 模块级状态
```
let sb, USER, toastFn;                 // 注入：客户端、当前用户、toast
const me = {id,name,university,major};  // 我的资料（ensureMe 填）
const followingIds = new Set();         // 我关注的人 id
const globalTags = {university:[],major:[],subject:[],tag:[]}; // 全局标签
const state = { loading, error, filter, mineTab, counts, posts, liked:Set, faved:Set, originals:{} };
let feedEl;                             // 当前挂载容器
```
- `filter`：`all | following | mine | question | tip | note_share | t:<标签值>`。
- `liked/faved`：当前列表里我点过赞/收藏的帖子 id 集合（用于高亮；写库成功后才更新）。
- `originals`：转发帖的原帖 map（id→原帖），渲染内嵌用。

### 生命周期
`mountCommunity(el)` → `renderFeed()`（先出骨架）→ `await ensureMe()`（拉当前账号资料/关注/标签）→ `load()`（按 filter 拉帖子）。每次 init 会清空上一账号的 `me/followingIds/globalTags/state`；异步操作以 `sessionVersion` 丢弃账号切换后的迟到响应。

### 关键函数逐个讲

**ensureMe()** — 一次并发拉三样：我的 profile、我的关注列表、全局 tags；填 `me / followingIds / globalTags`。`meLoaded` 保证在本次账号会话只拉一次，下一次 init 会清空。

**load()** — feed 主查询。按 `filter` 拼 supabase 查询：
- `question/tip/note_share` → `.eq("kind", f)`
- `t:xxx`（标签）→ `.contains("tags", [值])`（Postgres 数组包含，PostgREST `tags=cs.{值}`）
- `following` → 取 `followingIds`，空则直接空列表，否则 `.in("user_id", ids)`
- `mine` → 转 `loadMine()`
拉到后 `hydrate()` 补充互动状态，再 `renderFeed()`。

**loadMine()** — 「我的」页。先并发查三个 `count`（发帖/关注/粉丝，用 `head:true` 只要数量）；再按 `mineTab` 取列表：
- `posts`：我的、非转发（`.eq(user_id).is(repost_of,null)`）
- `reposts`：我的、是转发（`.not("repost_of","is",null)`）
- `replies`：我的评论 → 取 distinct `post_id` → 再查这些帖子
- `liked/faved`：查我的 post_likes/post_favorites（RLS 只返回我的）→ 取 post_id → 查帖子

**hydrate(posts)** — 给一批帖子补：①我对它们的赞/藏（查 post_likes/post_favorites `in(ids)`，因 RLS 只返回我的 → 得到 `liked/faved` 集合）；②转发原帖（收集 `repost_of` 去重 → 查 → 填 `originals`）。

**renderFeed()** — 两套布局：`filter==="mine"` 渲染「我的」（统计 + 子标签 + 卡片）；否则常规 feed（筛选 chips + 卡片 + 右侧推荐关注）。末尾 `wire(feedEl)` 绑事件。

**渲染辅助**：`feedChips()`（固定筛选 + `tagChips()` 全局标签）、`suggestions()`（从当前 feed 里挑未关注的作者）、`postCard(p,big)`（作者行 + 转发内嵌 + 标题/正文 + `mediaBlock` + 标签 + `actionBar`）、`authorRow`（含「关注/已关注」「编辑/删除(本人)」）、`actionBar`（赞/评/转/藏 + 计数 + 高亮）。

### 事件模型（关键设计）
```
function wire(scope){ scope.querySelectorAll("[data-cm]").forEach(el =>
  el.onclick = e => { e.preventDefault(); e.stopPropagation(); handle(el.dataset.cm, el); }); }
```
- 我的动作按钮带 `data-cm="like|fav|repost|follow|edit|del|..."`，由本模块处理，且 **`stopPropagation`**。
- 帖子卡片本身带 `data-go="post"`，由**应用壳的全局点击委托**（legacy `app.ts`）跳转到详情。
- 二者配合：点卡片空白 → 冒泡到壳 → 进详情；点赞按钮 → `stopPropagation` 拦住 → 只点赞不跳转。这就是「复用壳路由 + 自己处理动作」。

### 动作的数据流（以点赞为例）
```
点赞 span(data-cm=like) → wire 的 onclick → handle("like") → toggleLike(id)
toggleLike：await post_likes insert/delete → 检查 { error } 与 sessionVersion
           → 成功后才更新 liked 集合和本地 like_count → renderFeed()
DB 触发器：likes_cnt 改 like_count(权威值)；_on_like 激活/冲正同一 points claim，并在非自赞时通知帖主
```
`toggleFav/toggleFollow` 同样只在后端成功后更新 UI。`addComment/delComment` 走「写库成功后整页重挂 `mountPost`」（评论量小，简单可靠）。`delPost` 用应用内 `confirmDialog` 二次确认。所有路径都会展示 Supabase 失败，不再把 `{ error }` 当成功。

生产 0039 应用在发帖、转发、点赞和评论写成功后额外调用 owner receipt。实际奖励为 0 且原因为 `daily_cap` 时立即 toast，并由数据库保证每类每天最多一条持久通知；receipt 网络失败只显示非阻断提示，不回滚已经成功的社区操作。前端显示的 +N 不是事实源，Profile 仍由账本 projection 刷新。

### 发帖/编辑（composer）
- 一个弹窗同时干 新建 与 编辑（`existing` 有无）。
- **标签多选**：`drawTags()` 把 `globalTags`（🏫大学/🎓专业/📚学科/#自定义）渲染成可切换 chips，点击进/出 `selected` 集合；自定义输入回车 → 加入 `globalTags.tag` + `selected` + `insert tags`。
- **附件**：`pick(accept,set)` 造隐藏 `<input type=file>` → `uploadMedia(file)` 传 `community-media` 取公开 URL → 存 `imageUrl/audioUrl`；`drawMedia()` 显示预览 + 移除。
- 保存：组 `row={kind,title,body,tags:[...selected],image_url,audio_url}` → 编辑 `update().eq(id)` / 新建 `insert(row)`；`saving` 锁防重复提交。作者字段由触发器补，不在前端传。

### 转发（repostModal）
弹窗填可选评语 → `insert({repost_of:id, body, tags:原帖标签})`。它本身是一条 post，触发器给原帖 +转发数、给原作者发通知、给我 +3 分。

### mountPost(el, postId)（详情）
查帖子（`.eq(id).single()`）+ `hydrate([post])` + 查评论（`.eq(post_id).order`）→ 渲染大卡 + 评论框 + 列表。评论提交/删除后**重挂自身**刷新。

---

## 五、坑 / 取舍
- **公共读 vs owner-only**：社区第一次用 `using(true)`；写仍严格。展示他人信息靠快照，不放开 profiles 读权限。
- **当前 points 完整性**：0008 已修复点赞取消/重赞、评论/帖子删除重建、转发和任务取消重做的净额刷分；相同业务键只有一个 active claim，删除/取消写冲正。生产 0039 增加原创 3、转发 10、评论 10、点赞 20 的每日获奖数量上限，冻结首次 decision；协同扫描只写 pending 信号，人工 suppress/restore 才能冲正同一 root 内容链。points 仍绝非货币或商业权益。
- **旧余额边界**：迁移前 points 由 0008 作为 `legacy_opening` 留痕，无法从旧表证明来源；2026-07-21 owner 已决定由 0009 追加等额 reversal 全部归零。
- **UI 与权威值**：互动 UI 只在数据库成功后变更；冗余计数仍以触发器维护的列为权威，下次加载会覆盖本地显示。
- **导航靠壳委托**：动作按钮必须 `stopPropagation`，否则会连带触发卡片的 `data-go` 跳转。

## 六、验证
两用户 RLS E2E、0007→最新迁移的数据升级/旧 opening 归零/发布断言夹具、points 重做/并发/日上限/原帖链审核和 jsdom 社区失败/回执回归的可执行覆盖矩阵见 [测试指南](../guides/TESTING.md)。套件覆盖伪造 owner/作者快照/计数/时间/key 全部失败、合法内容编辑由服务器更新时间、客户端不能读取内部 claims/signals/actions 或调用管理 RPC；真实 CI Supabase 已执行，mock 仍不构成数据库证据。
