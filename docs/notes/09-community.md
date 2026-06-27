# 09 · 社区（真后端 · 全社交功能）

> 目标：发帖/编辑/删除、点赞、评论、收藏、转发、关注；按 关注/类型/全局标签/我的 分类；图片音频附件；积分与通知联动。这是第一个**公共可读**模块（与之前 owner-only 相反）。

## 1. 数据层（迁移 0005 + 0006）
| 表 | RLS |
|---|---|
| `posts` | **公共可读**（认证用户 `using(true)`），**作者可写改删** |
| `comments` | 同上 |
| `post_likes` / `post_favorites` | owner-only（只看/改自己的）；总数走帖子上的计数列 |
| `follows` | 自己相关可读（`follower=me or following=me`），本人可增删 |
| `tags` | 公共可读 + 认证可插；全局标签池 |

- 帖子上有 `like_count/comment_count/favorite_count/repost_count`，由 **触发器** 维护（点赞者≠作者也要能改帖子计数 → `security definer`）。
- **作者展示字段防伪造**：`author_name/university/major` 由 `before insert` 触发器从 `profiles` 快照，忽略客户端传值。评论同理。
- **转发**就是一条 `repost_of` 指向原帖的普通帖；触发器维护原帖 `repost_count`。
- `image_url/audio_url` + 公共桶 `community-media`（仅本人文件夹可写，公开可读）。

## 2. 积分 + 通知联动（迁移 0006，全在触发器里）
- **积分**（活动积分，见 [08](08-notifications-feedback-profile.md)）：发帖 +10 / 转发 +3 / 评论 +2 / 点赞 +1；`_add_points()` 顺带按阈值重算 level/level_name。
- **互动通知**：被赞/评论/转发/收藏 通知帖主；被关注通知被关注者（`_notify()` 写入 notifications，`security definer` 绕过 owner-only 写入他人）。都判断 `actor ≠ owner` 避免自我通知。
- **全局标签**：`profiles.university/major` 改动、`courses` 新建 → 触发器 upsert 进 `tags`；迁移里一次性回填历史数据。

## 3. 前端（`legacy/community.ts`）
两块：`mountCommunity(#comm-root)` 帖子流 + `mountPost(#post-root, id)` 详情。
- **发帖/编辑**（composer）：类型、标题、正文；**标签多选**取自全局 `tags`（🏫大学/🎓专业/📚学科/#自定义），帖子只进所选分区；**图片/音频**上传到 community-media 取公开 URL。
- **互动**：点赞/收藏乐观更新（本地 ±1 + toggle set 再渲染）；转发弹窗（可带评语）；评论在详情页增/删（本人）；关注/取关。
- **筛选**：推荐 / 关注（取 followingIds 再 `in`）/ 我的 / 类型 / 全局标签（`tags=cs.{value}` 数组包含）。
- **「我的」**：子标签 发帖/转发/回复/赞过/收藏 + 顶部 关注数/粉丝数/发帖数（`count head` 查询）。
- **推荐关注**：从当前帖子流里取未关注的作者。

## 4. 关键设计 / 坑
- **导航复用 legacy 委托**：帖子卡片用 `data-go="post"`，由壳的全局点击委托跳转；卡内动作按钮用自己的 `onclick + stopPropagation`，避免冒泡触发跳转。
- **公共可读 vs owner-only**：社区是第一个 `using(true)` 的表；写操作仍严格作者校验。展示他人信息靠**快照字段**，不放开 profiles 的读权限。
- 点赞积分目前 `insert` 即 +1、`delete` 不扣 → 反复赞/取消可刷分，量小可接受；要严格可改为「被赞才给帖主加分」或去重。

## 5. 验证
两用户 e2e（13 项）：公共读、四种计数触发器、作者防伪造、关注、RLS（非作者不能改/删、点赞记录私有）；积分/等级/通知/标签触发器单测；jsdom 集成冒烟（feed、筛选、我的+子标签、composer 标签/媒体、详情评论）。
