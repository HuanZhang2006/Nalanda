# 05 · 数据库 / 迁移 / RLS

> **文档定位**
> - **内容**：记录当前 Supabase/Postgres、RLS 范式、迁移清单和迁移工具局限。
> - **作用**：作为数据层实现入门；完整关系看 ERD，正式发布/回滚看 operations 手册。
> - **何时更新**：新增迁移、RLS 模式、迁移工具或数据库发布流程变化时。
> - **状态基线**：2026-08-10。生产 migration history 为 0038；仓库 0039–0040 是待受保护发布的第一阶段完整性/points 扩展与验证，0041–0042 尚未创建且必须等候至少 24 小时生产观察。

> 目标：数据存哪、怎么保证「每个人只能动自己的数据」（RLS），以及改表结构的工作流（迁移 + 一条命令自动应用）。鉴权相关的 profiles 表见 [02 用户系统与认证](02-auth-and-user-system.md)。

## 1. 数据库是什么
用 **Supabase** = 托管 **PostgreSQL** + 周边（Auth、Storage、Realtime、自动生成的 PostgREST）。前端用 `supabase-js` 直接读写表，**安全靠 RLS 在数据库层兜底**，不是靠前端自觉。

## 2. RLS（行级安全）—— 整个项目的安全基石
开了 RLS 的表**默认拒绝一切**，必须写策略放行。统一用「owner-only」模式：
```sql
alter table public.X enable row level security;
create policy X_all_own on public.X
  for all to authenticated            -- 仅登录用户
  using (user_id = auth.uid())        -- 可读/改的行
  with check (user_id = auth.uid());  -- 可写入的行
```
- `auth.uid()` = 当前请求 JWT 里的用户 id，由 Supabase 解出，前端伪造不了。
- 表上 `user_id uuid not null default auth.uid()`：插入不用传 user_id，数据库自动填当前用户。
- 结果：A 的查询永远只返回 A 的行。

> 心法：**前端的过滤只是体验，真正的隔离写在 RLS 里。**

RLS 只判断“哪一行”，不会自动判断“同一行的哪些列”。包含余额、角色、状态或审核字段的表还必须使用列级 GRANT、命令拆分策略或防御触发器；`SECURITY DEFINER` 函数必须固定 `search_path` 并撤销默认客户端 EXECUTE。

## 3. 现有迁移（`supabase/migrations/`）
| 文件 | 内容 |
|---|---|
| `0001_profiles.sql` | `profiles`（绑 auth.users）+ 注册自动建档触发器 + owner-only RLS（见 [02](02-auth-and-user-system.md)） |
| `0002_courses_materials.sql` | `courses` / `materials` 表 + RLS；私有 Storage 桶 + 存储策略（见 [06](06-materials.md)） |
| `0003_materials_course_check.sql` | 加固：materials 只能挂到自己拥有的课程（[06](06-materials.md) 的越权修复） |
| `0004_notifications_feedback.sql` | notifications / feedback + owner-only RLS |
| `0005_community.sql` | posts / comments / likes / favorites / follows + 计数触发器 |
| `0006_points_tags_notify.sql` | points、tags、社区媒体、互动通知与等级函数 |
| `0007_schedule.sql` | study_goals / study_tasks、streak 与完成任务触发器 |
| `0008_security_points_ledger.sql` | Profile 敏感列白名单、内部 RPC 撤权、稳定 points 业务键、`point_entries`/`point_event_states` 与冲正触发器 |
| `0009_reset_legacy_points.sql` | 用 append-only reversal 归零不可信 opening，并重建 Profile points/level 投影 |
| `0010_verify_security_points_release.sql` | 只读断言 Profile 写权限、内部 RPC、opening reversal 和账本投影 |
| `0011_learning_courses.sql` | Courses 内容/学习/复习/传播/徽章/speech usage、timezone 与 TTS cache；客户端只读私有数据 |
| `0012_learning_course_workflows.sql` | service-role-only 原子保存/会话/答题/成长/分享/市场/审核 RPC |
| `0013_verify_learning_courses_release.sql` | Courses RLS、写权限/RPC、badge/timezone/owner 链发布断言 |
| `0014_learning_feedback_flow.sql` | 朗读整体分数阈值的 recognition 候补池加入/移除，以及认词候补轮推进；重申评分 RPC 仅 service-role 可执行 |
| `0015_learning_performance_offline_audio.sql` | session revision、幂等 attempt/首次响应、单 RPC snapshot、朗读目标校验、private TTS 生成队列/配额/租约 |
| `0016_verify_learning_performance_release.sql` | 断言 0015 结构、唯一约束、revision 触发器、队列 RLS/客户端撤权及全部新 RPC 仅 service role |
| `0017_learning_session_intent_resume.sql` | 回填非空 `resume_key`，以 course/unit/mode/scope/排序 skills 或 schedule ID 区分 active session 意图，并替换 `learning_start_session` |
| `0018_verify_learning_audio_review_fix.sql` | 断言 0017 列/意图唯一索引/活动排序索引、函数定义及 service-role-only 权限 |
| `0019_learning_spelling_timer_translation.sql` | session 拼写选项、只保存答案 hash 的翻译评判事实、租约/配额/幂等响应，以及 service-only 翻译评判与 spelling wrapper RPC；保留旧签名供应用回退 |
| `0020_verify_learning_spelling_release.sql` | 断言 0019 列、评判表 RLS/客户端撤权、新 RPC 精确签名与 service-role-only grants |
| `0021_learning_spelling_unicode_normalization.sql` | 新增内部 Unicode 拼写归一化 helper，并让七参数权威 attempt RPC 对原始答案和课程 `term` 使用同一规范化契约；保留原始提交文本 |
| `0022_verify_learning_spelling_unicode_normalization.sql` | 断言全角大写、Unicode 空白、撇号/连字符变体和标点保留语义，并验证 helper/七参数 RPC 只允许 service role |
| `0023_learning_spelling_punctuation_tolerance.sql` | 新增内部标点移除/匹配 helper，以原文、移除标点、标点视为空格三路比较替换七参数权威拼写判定；不改变 HTTP/attempt/进度契约 |
| `0024_verify_learning_spelling_punctuation_tolerance.sql` | 断言仅标点差异通过、真实字母/空格错误失败、RPC 确实使用 matcher，以及新 helper/attempt 的精确权限 |
| `0025_learning_session_cancel.sql` | 增加 owner-only、行锁、revision 推进且保留历史事实的幂等取消学习会话 RPC |
| `0026_verify_learning_session_cancel.sql` | 断言取消 RPC 的 owner/并发边界与 service-role-only 精确权限 |
| `0027_learning_exam_retry_quota.sql` | 增加 exam mode/第一轮正确率事实、拼写轮末确认与重排、考试通过后的单元熟练投影，并把语义评判 claim 与真实 provider 配额预留拆开 |
| `0028_verify_learning_exam_retry_quota.sql` | 断言 exam constraints、`quota_counted`、三组 trigger 及考试/轮次/配额 RPC 的 service-role-only 权限 |
| `0029_learning_pronunciation_exam.sql` | 增加 `spelling/pronunciation` 考试类型、当前评分题预校验、读音首轮统计/分数清单/轮末确认和按类型写熟练度；保留 0028 五参数拼写启动与旧轮次 RPC 供应用回退 |
| `0030_verify_learning_pronunciation_exam.sql` | 断言读音考试类型持久化、精确整数通过条件、错词分数、发音熟练投影及新增 RPC 的 service-role-only 权限 |
| `0031_learning_exam_history_selection.sql` | 增加复习/考试自定义词集合、失败考试补练完成事实、私有 `learning_exam_word_snapshots` 与 attempt 词面快照、最近 100 场考试汇总和脱敏答题详情 RPC；选词按 owner/课程/单元/scope 校验 |
| `0032_verify_learning_exam_history_selection.sql` | 断言 selected/history RPC 与快照结构完整存在且仅 service role 可用，并保证 `practiceCompleted` 不绕过 `examPassed` 写熟练度 |
| `0033_learning_exam_only_mastery.sql` | 增加拼写/发音考试通过时间戳和双事实 check constraint；回填可证明的考试事实、清除旧 review/单项考试掌握，重定义 exam trigger 与 review 推进，并按 term/translations/IPA 精确撤销考试事实 |
| `0034_verify_learning_exam_only_mastery.sql` | 断言双考试字段/约束、唯一正向投影、review 无 `learned_at` 写入、编辑撤销、snapshot 字段和 service-role-only 权限 |
| `0035_learning_mastery_projection_guard.sql` | 用 progress trigger 强制 `learned_at` 精确等于两个考试时间中的较晚值，缺少任一事实即为空 |
| `0036_verify_learning_mastery_projection_guard.sql` | 验证现有数据、考试/review 写入路径、精确投影和客户端/helper 权限 |
| `0037_learning_translation_voice_input.sql` | 扩展 `learning_speech_usage.kind=translation_stt`，增加 owner/session/revision/current-word 校验与独立配额预留 RPC |
| `0038_verify_learning_translation_voice_input.sql` | 验证 STT 用量结构、函数定义及 public/anon/authenticated 无执行/表权限 |
| `0039_security_integrity_rate_limit_points_abuse.sql` | 帖子/Feedback/Schedule 直接写边界；冻结 points 日窗口/claim、owner receipt、审核 action、协同 signal 与 HMAC API 滥用聚合；所有内部 mutation 经 service-only 工作流 |
| `0040_verify_security_integrity_rate_limit_points_abuse.sql` | 失败关闭验证 0039 的触发器、约束、列 grant、内部表/sequence 权限与 RPC 精确角色；漂移即中止发布 |

## 4. 迁移怎么写（力求可重放）
当前 SQL 使用以下模式降低重复执行失败的概率：
- `create table if not exists` / `create index if not exists`
- `drop policy if exists … ; create policy …`
- `create or replace function` / `drop trigger if exists … ; create trigger …`
- `create extension if not exists pgcrypto;`（`gen_random_uuid()` 需要）

## 5. 怎么应用迁移
### 旧应急脚本（不属于正常发布）
`scripts/db-push.mjs` 按文件名顺序，把每个 `.sql` 经 **Supabase Management API** 应用；必须显式确认目标项目：
```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx \
SUPABASE_PROJECT_REF=<明确的开发/staging/已审批生产 ref> \
ALLOW_LEGACY_DB_PUSH=YES \
node scripts/db-push.mjs
```
- 令牌来自 Supabase 控制台 → Account → Access Tokens（权限很大，**当密码看待**）。
- 现有迁移力求可重放，但 `create table if not exists` 不会修复已漂移结构，重复执行也不等于无风险、事务化或可回滚。

> ⚠️ 坑：直接用默认 UA 调 `api.supabase.com/.../database/query` 会被 Cloudflare 拦（403 / `error code: 1010`）。脚本里**带浏览器 UA** 才放行。

> ⚠️ `db-push.mjs` 已移除默认 Ref 并强制 `ALLOW_LEGACY_DB_PUSH=YES`，但仍无 history；正式流程使用仓库 `config.toml` 与 Supabase CLI，并按 [数据库发布与回滚](../operations/DATABASE_RELEASE_ROLLBACK.md) 执行。

### 手动（兜底）：SQL Editor
没令牌时：控制台 → SQL Editor → 粘贴迁移 → Run。第一版 profiles 即这样应用。

## 6. 加一张新表的模板
```sql
create table if not exists public.things (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- 业务字段
  created_at timestamptz not null default now()
);
alter table public.things enable row level security;
drop policy if exists things_all_own on public.things;
create policy things_all_own on public.things for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```
若新表用外键引用了另一张「属于用户」的表，要在 `with check` 里**额外校验被引用行也归本人**（否则会出现 [06](06-materials.md) 里 0003 修复的那种越权）。

Courses 展示了另一种范式：客户端可 owner SELECT，但表级 INSERT/UPDATE/DELETE 全撤销；API 从已验证 JWT 派生 user ID 后调用只授予 service_role 的事务 RPC。涉及 progress、points、跨用户传播、供应商配额或审核的表应优先采用这类服务端边界，而不是复制 `for all` owner policy。

## 7. 待改进
- CI 已通过 CLI migration history 发布，并在生产 migration 前完成本地重建/RLS E2E、dry-run 和加密恢复点；首次生产启用仍须人工 baseline 旧历史。
- 仍需定期 staging 演练、Storage 文件异地备份、数据库恢复演练和 schema drift 告警。
- 0011–0013 已于 2026-07-22、0014 已于 2026-07-23、0015–0018 已于 2026-07-27 通过受保护 plan/apply 发布。队列表不授予客户端任何读写，旧答题 RPC 在稳定窗口内保留供应用回滚，数据库仍只做 forward-fix；详细 run/artifact/真实 Azure 证据见发布手册第 8 节。
- 0019–0020 已于 2026-07-28 取得只读 plan `30366334157`、加密恢复点/apply `30367263486` 与最终应用发布 `30374301472` 证据。评判表不授予客户端任何权限，所有新 RPC 已由双用户 RLS 负向测试和 0020 精确断言同时证明；生产已到 0020。
- 0021–0022 已于 2026-07-31 取得只读 plan `30616030488`、加密恢复 artifact `8787805291`、受保护 apply/deploy `30616540480` 和 release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` 证据。真实一次性 Supabase E2E 验证全角/半角全大写不增加错误或候补，0022 断言 helper/RPC 对客户端不可执行；生产已到 0022。
- 0023–0024 已于 2026-07-31 通过 PR run `30620350644`、main run `30620879282`、只读 plan `30623522232` 和受保护 apply/deploy `30624104943` 发布。apply 前保留恢复 artifact `8790816378`；远端 history、0024 自验证、database lint 与空 dry-run 均通过，生产已到 0024。
- 0025–0028 已于 2026-08-01 通过 PR run `30705662543`、main run `30705946921`、只读 plan `30706279006` 和受保护 apply/deploy `30706731292` 发布。apply 前保留恢复 artifact `8820657507`；远端 history、0026/0028 自验证、database lint 与空 dry-run 均通过，生产已到 0028。
- 0029–0034 已于 2026-08-03 通过 PR #45 run `30811283164`、main run `30811817461`、只读 plan `30812467085` 和受保护 apply/deploy `30813047562` 发布。apply 前保留恢复 artifact `8855819351`；远端 history、0030/0032/0034 自验证、database lint 与空 dry-run 均通过，生产已到 0034。
- 0035–0036 已于 2026-08-04 通过 PR #47 run `30831319634`、main run `30831964846`、只读 plan `30832581552` 和受保护 apply/deploy `30833228406` 发布。apply 前保留恢复 artifact `8864033351`；远端 history、0036 自验证、database lint 与空 dry-run 均通过，生产已到 0036。
- 0037–0038 已于 2026-08-04 通过 PR #49 run `30904901828`、只读 plan `30906629924` 和受保护 apply/deploy `30907716733` 发布。apply 前保留恢复 artifact `8892006761`；远端 history、0038 自验证、database lint 与空 dry-run 均通过，生产已到 0038。
- 0008 已保护 `profiles` 的 points/credits/VIP/level/streak 并撤销 points/notification helpers 的客户端 EXECUTE。0039–0040 候选已收口 `feedback.status`、帖子 owner/作者快照/计数/业务键/时间及 Schedule 关联归属；生产 apply 前这些仍按 0038 缺口处理。通知服务端字段和其它直接 PostgREST 表仍需持续逐表审计。
- 0041–0042 contract 不在当前仓库：只有兼容应用与 0039–0040 生产运行至少 24 小时、确认无客户端提交 `posts.updated_at`/`study_tasks.done_at` 依赖后，才能另建迁移撤销这两列的兼容 UPDATE grant。
- 0008 将旧 `profiles.points` 导入 `legacy_opening` 留痕；2026-07-21 生产聚合审计发现唯一 Profile 有 11 points，owner 决定归零，0009 追加等额 reversal，既不把旧余额当成可信历史，也不删除审计轨迹。
