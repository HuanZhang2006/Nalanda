# API 文档

> **本文内容：** 记录当前 NestJS 公网 API、FastAPI 内部桩接口，以及浏览器直接使用的 Supabase Auth/PostgREST/Storage 数据面；同时指出尚未实现的目标 API。  
> **作用：** 为前后端联调、客户端开发、自动化测试、安全评审和接口演进提供明确契约，避免把架构蓝图中的接口误认为已经可用。  
> **何时更新：** 新增/删除/变更路由、请求/响应/状态码、认证授权、数据 schema、Supabase 访问方式、错误码或 API 版本策略时，与实现同一提交更新。

## 1. 当前接口边界

```mermaid
flowchart LR
    Browser["Web 浏览器"] -->|"/api/*"| Nest["NestJS API"]
    Browser -->|"Auth / PostgREST / Storage"| Supabase["Supabase Cloud"]
    Nest -->|"Admin Auth / JWKS / Courses 事务 RPC"| Supabase
    Nest -->|"TTS / pronunciation assessment"| Azure["Azure Speech（可选）"]
    Nest -. "尚未调用" .-> AI["FastAPI AI 桩"]
```

- 生产 Web/API 同源基址：`https://nalanda.online`；本文示例默认本地 `http://localhost:3000`。
- NestJS 全局前缀：`/api`。
- FastAPI 默认本地基址：`http://localhost:8000`，目标上只允许内网访问；当前没有 API→AI 调用代码。
- 当前没有 OpenAPI 文件、API 版本号、请求 ID 或通用分页规范。Nest 全局错误已统一为 `{ code, message, fieldErrors?, currentRevision? }`；`currentRevision` 只用于 409 session 冲突。Courses 语音、发布和举报有专用限流，但注册/其它旧接口仍没有统一限流。
- NestJS 跨域许可来自 `CORS_ALLOWED_ORIGINS`，未设置时复用 `PUBLIC_ORIGIN`；生产两者都缺失时不返回跨域许可，同源 nginx `/api` 不受影响，且当前不启用 credential cookie。

## 2. 认证约定

### 2.1 浏览器登录链路

1. 注册时浏览器调用 `POST /api/auth/register`；API 用 service-role 调 Supabase Admin Auth 创建已确认用户。
2. 浏览器随后直接调用 `supabase.auth.signInWithPassword` 获取 Supabase session。
3. 访问受保护 NestJS 接口时发送：

```http
Authorization: Bearer <supabase-access-token>
```

4. API 优先从 `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` 获取公钥，只接受 ES256/RS256，并校验 issuer、`audience=authenticated`、UUID `sub` 与 `role=authenticated`；旧 HS256 项目可用 `SUPABASE_JWT_SECRET` 回退，声明校验相同。

Courses、会话、复习、Profile 学习聚合、语音、分享克隆、市场发布/克隆/举报都是 bearer 接口；公共分享预览和市场列表除外。Web 的 Materials、社区、普通计划、旧 Profile、反馈和通知仍主要通过 `supabase-js` 直连。

### 2.2 错误格式

NestJS 全局错误格式：

```json
{
  "code": "INVALID_COURSE",
  "message": "课程内容校验失败",
  "fieldErrors": { "units.0.words.1.term": "同一单元内不能重复" }
}
```

`fieldErrors` 可选；未知 4xx 映射为 `INVALID_REQUEST`，413 为 `PAYLOAD_TOO_LARGE`，未知 5xx 为 `INTERNAL_ERROR`。常见状态：400 参数/契约，401 token，403 owner/管理员，404 不存在或功能隐藏，409 冲突，413 multipart 上限，429 配额，502 供应商，503 feature flag/依赖不可用。FastAPI 桩仍使用标准 `422 detail`，不属于这个 envelope。

## 3. NestJS API（当前实现）

### `GET /api/health`

认证：无。  
实现：`apps/api/src/health/health.controller.ts`。

响应 `200`：

```json
{
  "status": "ok",
  "service": "nalanda-api",
  "time": "2026-07-10T00:00:00.000Z",
  "deps": {
    "redis": "unset",
    "ai": "unset",
    "supabase": "ok"
  }
}
```

语义：返回 200 前会在 5 秒超时内同时访问 Supabase JWKS 与 `profiles?select=id&limit=0` PostgREST 探针；后者只使用服务端 service-role header 且不读取行。任一配置缺失、URL 非法、网络/HTTP 失败都会返回 503，响应只写 `supabase: "unavailable"`，不泄露上游错误或 key。Redis/AI 仍只显示 `configured/unset`，Storage、注册写入、RLS 和完整用户路径不在本 endpoint 内验证。

失败响应 `503`：

```json
{
  "status": "error",
  "service": "nalanda-api",
  "time": "2026-07-10T00:00:00.000Z",
  "deps": { "redis": "unset", "ai": "unset", "supabase": "unavailable" }
}
```

示例：

```bash
curl -fsS http://localhost:3000/api/health
```

### `POST /api/auth/register`

认证：无。  
Content-Type：`application/json`。  
实现：`apps/api/src/auth/auth.controller.ts`。

请求：

```json
{
  "email": "developer@example.com",
  "password": "at-least-6-characters"
}
```

处理规则：email 去首尾空白并转小写，使用简单邮箱正则；password 最少 6 字符。成功时通过 Supabase Admin API 创建 `email_confirm=true` 的用户。

| HTTP | `code` | 含义 |
|---:|---|---|
| 200 | — | `{ "ok": true }`；只代表创建成功，不返回 session |
| 400 | `INVALID_EMAIL` | 邮箱格式不通过当前正则 |
| 400 | `WEAK_PASSWORD` | 密码少于 6 字符 |
| 400 | `REGISTER_FAILED` | 未归类的 Supabase 注册失败 |
| 409 | `EMAIL_TAKEN` | 邮箱已存在；由状态码或上游文本启发式识别 |
| 500 | `SERVER_MISCONFIG` | API 缺 `SUPABASE_URL` 或 service-role key |
| 502 | `UPSTREAM_UNREACHABLE` | API 无法访问 Supabase Auth |

示例：

```bash
curl -i http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  --data '{"email":"developer@example.com","password":"change-me"}'
```

此接口会创建真实账号，不应作为无清理逻辑的普通 smoke test，也不能对生产反复执行。当前没有验证码、速率限制、反滥用或密码强度扩展规则。

### `GET /api/me`

认证：Supabase bearer token。  
实现：`apps/api/src/me/me.controller.ts` 和 `apps/api/src/auth/supabase.guard.ts`。

成功 `200`：

```json
{
  "user": {
    "id": "00000000-0000-0000-0000-000000000000",
    "email": "developer@example.com",
    "role": "authenticated"
  }
}
```

`id` 来自 JWT `sub`；`email`、`role` 可能不存在，因此客户端必须按可选字段处理。该接口不会查询 `profiles`。

失败 `401`：无 token 时 message 为 `Missing bearer token`；验签失败或没有 `sub` 时为 `Invalid token`。

```bash
curl -fsS http://localhost:3000/api/me \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

此处 `$SUPABASE_ACCESS_TOKEN` 指用户登录 access token，不是数据库迁移使用的 Supabase Personal Access Token；两者不能混用。

## 4. Courses API（0011–0024 生产已启用）

所有请求/响应使用 `@nalanda/types` 的 camelCase；API 内部显式转换 PostgreSQL snake_case。除标记“公开”外都需要 Supabase bearer token。`FEATURE_LEARNING_COURSES_ENABLED` 是总开关，分享、市场和语音另有子开关；生产未显式开启时分别返回 503/404，不应据此回退为前端 mock。

0019–0020 契约增加拼写限时与 OpenRouter 语义翻译前测，已于 2026-07-28 通过生产 migration history、不可变应用 release、真实供应商和候选 API gate。0021–0022 不改变 HTTP 请求/响应结构，只让七参数权威答题 RPC 对用户答案与课程原始 `term` 执行和 Web 相同的 NFKC、Unicode 空白/标点变体及 ASCII case 归一化，并已于 2026-07-31 受保护发布。限时本身由 Web 执行；服务器仍以 immutable attempt 决定 retry pool、revision、进度和奖励。

0023–0024 继续保持 HTTP 契约不变，但把仅有标点遗漏、替换或增加的答案判为正确；字母、数字、词序与无标点参与的词间空格错误仍判错。该行为已于 2026-07-31 通过独立 plan/apply 发布到生产。

### 4.1 课程内容

| 方法 | 路径 | 请求 | 成功响应 |
|---|---|---|---|
| GET | `/api/learning-courses` | — | `LearningCourseSummary[]`，按 `updatedAt` 倒序 |
| POST | `/api/learning-courses` | `LearningCourseInput` | `LearningCourseDetail`，整课单事务创建 |
| GET | `/api/learning-courses/:id` | — | owner 的 `LearningCourseDetail` |
| PUT | `/api/learning-courses/:id` | `LearningCourseInput`；路径 ID 覆盖 body ID | 更新后的 `LearningCourseDetail`；增删单元/词或修改词内容会终止旧队列，改名、排序、移动不终止 |
| PATCH | `/api/learning-courses/:id` | `{ "title": "..." }` | 改名后的 detail；不重置学习能力/会话 |
| DELETE | `/api/learning-courses/:id` | — | `{ "ok": true }` |

创建/整课保存请求：

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "title": "CET-6 词汇",
  "category": "english_vocabulary",
  "hasUnits": true,
  "locale": "en-US",
  "units": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "Unit 1",
      "isSystem": false,
      "words": [
        {
          "id": "33333333-3333-4333-8333-333333333333",
          "term": "take part in",
          "translations": ["参加", "参与"],
          "ipa": null
        }
      ]
    }
  ]
}
```

契约限制：课程名 1–80；1–100 个单元；每单元至少一词；整课 4–2,000 个不同规范化英文词/短语；term 1–120 且只接受英文、数字、空格、点、连字符和直/弯撇号并至少含一个字母；每词 1–10 个不重复非空翻译，每项≤120；IPA≤120。无单元模式必须是一项 `isSystem=true` 的隐藏单元。首版拒绝其它 category/locale。缺省 IPA 由服务端 CMUdict 尝试补全，查不到保持 null。

API JSON body 上限为 10 MB，以覆盖 2,000 词与多翻译的合法最坏情况；超出后返回统一的 413。朗读评分是独立 multipart 边界，仍严格限制为 2 MB。

`LearningCourseSummary` 字段：`id,title,category,hasUnits,locale,unitCount,wordCount,learnedCount,progressPercent,activeSessionId,canRepublish,originPublicationId,originShareId,originAuthorName,updatedAt`。两个 origin ID 只出现在克隆者自己的私有响应中，公共预览不会暴露；Detail 另含按 position 排序的 units/words 和每词 `progress`：初次四阶段、三组复习日期、累计错误、复习次数与 `learnedAt`。

### 4.2 学习会话、答题和复习

| 方法 | 路径 | 请求 | 成功响应 |
|---|---|---|---|
| POST | `/api/learning-courses/:id/sessions` | `{ unitId, mode: "initial"|"review", skills?, scope?, scheduleId?, spellingOptions? }` | 新建或恢复与请求意图完全匹配的 active `LearningSession` |
| GET | `/api/learning-sessions/:id` | — | 当前 owner 的完整 session/items/state/revision；API 内部由一个 `learning_get_session_snapshot` RPC 读取 |
| POST | `/api/learning-sessions/:id/recognition` | `{ wordId }` | `{ revision, sessionPatch }` |
| POST | `/api/learning-sessions/:id/attempts` | `LearningAttemptRequest` | `LearningAttemptResult`；只返回本次事实与 session 增量 |
| POST | `/api/learning-sessions/:id/spelling-translation-assessments` | `{ attemptId,expectedRevision,wordId,answer }` | `LearningSpellingTranslationAssessmentResult`；语义错误时已包含权威的 spelling `attemptResult` |
| GET | `/api/learning-review-schedules` | — | `ReviewSchedule[]`，含课程/单元名、source/completed session ID |
| POST | `/api/learning-units/:id/review-schedules` | `{ sourceSessionId, offsets: number[] }`，source 必须是本人该单元已完成的 initial session；offset 仅 3/7/15/30 | 当前用户全部 schedule |
| DELETE | `/api/learning-review-schedules/:id` | — | `{ "ok": true }`，状态改 cancelled |
| GET | `/api/profile/learning-summary` | — | `{ courses, learnedWords, reviewDays, badges }` |

复习 `skills` 是 `pronunciation/translation/spelling` 的 1–3 项，`scope` 是 `all/unlearned`。带 `scheduleId` 启动时，服务端忽略客户端自报的 skills/scope，改用日程保存值；完成后原子写入 `completedSessionId/completedAt`。attempt 形状：

0017 起，会话恢复键按服务端验证后的意图生成：首次学习使用 `course+unit+initial`，临时复习使用 `course+unit+scope+排序后的 skills`，日程复习使用 schedule ID。暂停的首次学习和另一单元复习可以同时保持 active；相同意图的并发请求仍由 advisory lock 与部分唯一索引收敛到同一 session。`activeSessionId` 是课程卡快捷入口，API 按 `lastActivityAt` 选择最近活动的一项，不代表课程只能存在一项未完成会话。

active session 的 `unitId` 一定指向现存单元；若课程编辑删除了该单元，历史 session 会被终止并保留，其 `unitId` 可为 `null`，客户端应把它渲染为不可继续的历史记录。

`spellingOptions` 只在选择了 spelling 时生效，缺省为：

```json
{
  "timeLimitEnabled": false,
  "timeLimitSeconds": 20,
  "translationFirst": false
}
```

`timeLimitSeconds` 必须是 3–300 的整数。恢复 revision 已经大于 0 的同意图会话时，服务器保留该会话原设置，避免另一个设备在中途改变规则；还没有 immutable fact 的 revision 0 会话可以由启动请求设置。开启计时后，每道拼写题进入可作答状态才开始倒计时；翻译前测开启时，倒计时从语义判定通过、拼写输入出现之后开始。超时按当前输入（允许空字符串）只提交一次，错误反馈仍等待用户手动进入下一题。

```json
{
  "attemptId": "44444444-4444-4444-8444-444444444444",
  "expectedRevision": 12,
  "wordId": "33333333-3333-4333-8333-333333333333",
  "skill": "translation",
  "answer": { "translations": ["参加", "参与"] }
}
```

发音匹配使用 `answer.wordId`，拼写使用 `answer.text`。拼写的 Web provisional 判定和 PostgreSQL 权威判定使用同一算法：先做 NFKC，再把弯/直撇号及常见连字符变体规范成 ASCII，合并首尾/重复 Unicode 空白，最后只对英语 `A–Z` 做确定性小写转换；答案和课程原始 `term` 两侧都执行，不能信任客户端携带的 `normalizedTerm`。因此 `APPLE`、`ＡＰＰＬＥ` 与 `apple` 等价，`YOU’RE` 与 `YOU'RE` 等价，但遗漏撇号、连字符或句点仍是错误。

`attemptId` 必须是 UUID；`expectedRevision` 必须等于当前 session revision。服务端先按 `(user_id,session_id,attempt_id)` 查首次响应，再锁定 session、校验 revision，原子记录 append-only attempt、更新候补池/cursor/stage/progress/revision 并保存响应快照。相同 attempt UUID 的超时重放返回第一次结果且 `replayed=true`，不重复推进或加错；过期 revision 返回 `409 { code:"SESSION_REVISION_CONFLICT", message, currentRevision }`。

开启翻译前测时，Web 先用同一个 `attemptId` 调用语义接口：

```json
{
  "attemptId": "44444444-4444-4444-8444-444444444444",
  "expectedRevision": 12,
  "wordId": "33333333-3333-4333-8333-333333333333",
  "answer": "参与某个活动"
}
```

NestJS 从当前 owner/session/word 读取英文和权威 translations。用户答案经服务端 NFKC、空白和大小写规范化后若完全等于任一参考项，以 `nalanda-normalized-exact/normalized-exact-v1` 确定性判对且不调用供应商；非字面答案才在请求内存中交给 OpenRouter 的 `{correct:boolean}` 结构化判定。浏览器不能提交参考答案或模型名；服务端用固定安全文案补齐 feedback，不把 provider 自由文本当权威词义。数据库只持久化用户答案 SHA-256、provider/model、boolean、简短反馈、token usage、租约和首次响应，不保存输入原文。回答正确时 revision 不推进，随后必须用**同一 UUID**提交 spelling attempt；回答错误时服务端立即用该 UUID 原子记录一次 spelling 错误并返回：

```json
{
  "attemptId": "44444444-4444-4444-8444-444444444444",
  "correct": false,
  "expected": ["参加", "参与"],
  "feedback": "The answer does not express the expected meaning.",
  "revision": 13,
  "replayed": false,
  "attemptResult": {
    "attemptId": "44444444-4444-4444-8444-444444444444",
    "correct": false,
    "expected": "take part in",
    "revision": 13,
    "replayed": false,
    "sessionPatch": {}
  }
}
```

上例的 `sessionPatch` 省略了与普通 attempt 相同的字段。相同 UUID + 相同 answer hash 重放不会再次调用供应商或推进会话；复用 UUID 但改变 session/word/revision/answer 会拒绝。供应商超时、网络错误或两次都缺失合法 boolean 会释放租约并返回可重试错误，不记错；第一次 HTTP 200 结构无效只在原总超时预算内重试一次。空 feedback 使用固定安全文案，不把有效 boolean 误当失败。同一未过期租约返回 425，revision 冲突返回 409，用户限额返回 429。`expected` 和 UI 结果始终同时显示正确拼写与分开的翻译文本块。

数据库先行和不可变 Web/API 切换期间，0014 页面可能仍发送同时缺少 `attemptId` 与 `expectedRevision` 的旧完整请求；API 暂时只对这种“两者都缺失”的形状调用保留的五参数 service-role RPC，revision trigger 仍推进。任一字段单独缺失都会拒绝。正式 0015 Web、弱网重试与所有新集成必须使用上面的幂等契约；兼容分支与旧 RPC 在稳定窗口后通过新的向前迁移/应用版本一起删除。

成功响应：

```json
{
  "attemptId": "44444444-4444-4444-8444-444444444444",
  "correct": false,
  "expected": ["参加", "参与"],
  "revision": 13,
  "replayed": false,
  "sessionPatch": {
    "stage": "translation",
    "active": true,
    "state": {
      "queue": ["33333333-3333-4333-8333-333333333333"],
      "cursor": 0,
      "nextQueue": [],
      "round": 2
    },
    "changedItem": {
      "wordId": "33333333-3333-4333-8333-333333333333",
      "recognitionSeen": true,
      "pronunciationPassed": true,
      "translationPassed": false,
      "spellingPassed": false,
      "wrongCount": 2
    },
    "nextWordId": "33333333-3333-4333-8333-333333333333"
  }
}
```

客户端从已加载 session 在同一渲染帧计算 provisional 正误：答对约 520 ms 自动进入下一题，答错一直保留并等用户点“下一题”。这个预测不授予完成、points 或徽章；IndexedDB outbox 按 revision 串行提交，服务器增量替换预测。只在冷启动/退出、服务端确认完成或 revision 冲突时重拉完整 snapshot，普通每题不刷新 Courses 列表。

### 4.3 发音合成与朗读评分

| 方法 | 路径 | 请求 | 成功响应 |
|---|---|---|---|
| POST | `/api/learning-units/:id/audio-prewarm` | owner unit；空 JSON body | 将整单元幂等写入持久生成队列并返回 `LearningAudioManifest` |
| GET | `/api/learning-units/:id/audio-manifest` | owner unit | `{ unitId,total,ready,pending,failed,synthesisVersion,assets[] }`；asset 只给 API audio URL，不给 Storage URL |
| GET | `/api/pronunciation/audio/:wordId` | owner 课程中的 word ID | ready 时 `audio/mpeg`（fake 为 WAV）、ETag 与 `private,max-age=31536000,immutable`；未 ready 时快速 `202 AUDIO_PENDING` + `Retry-After: 3` |
| POST | `/api/pronunciation/assess` | `multipart/form-data`：`audio`, `sessionId`, `wordId` | `PronunciationAssessment` |

评分只接受当前用户 active session 中的词；认单词阶段还要求 `wordId` 是当前卡片，避免迟到/伪造请求改变其它词的候补池。浏览器以 20 ms 帧做 VAD，阈值是 `max(0.015, 前 200 ms 噪声 RMS×3)`，前后保留 150 ms，有效语音少于 250 ms 要求重录，客户端裁剪到最多 6 秒；服务端继续兼容并强制 ≤2 MB、≤8 秒、16 kHz/16-bit/单声道 PCM WAV。参考文本始终由 wordId 在服务端获取。响应字段为 `accuracyScore,fluencyScore,completenessScore,pronunciationScore,passThreshold,passed,queuedForRetry,revision,sessionPatch,errorType,phonemes[]`，无需再拉完整 session。整体 `pronunciationScore` 默认达到 70 才通过：低分原子加入 recognition `nextQueue`，对同一当前词重新评分达标会移除；阈值由 API 受控配置并由数据库再次校验为 1–100。每个 phoneme 含 `accuracyScore` 和 `<70` 派生的 `needsPractice`。

用户录音不落库；只有评分 JSON 写 append-only attempt。TTS GET 不再同步调用 Azure：owner 校验后只提升单词任务优先级，worker 全局单并发并以至少 3.1 秒间隔、默认 20 次/分钟和 500,000 字符/月处理。private Supabase Storage 是服务端唯一音频事实源；HTTP 400 + JSON 404 只表示正常对象缺失并触发重建，网络/权限/其它 Storage 失败保持可见，不会冒充 miss 浪费 Azure。浏览器 Cache Storage 是可删除、可回收的副本，不产生匿名 Storage URL。常见错误：`AUDIO_PENDING`、`AUDIO_REQUIRED`、`INVALID_AUDIO(_FORMAT)`、`AUDIO_TOO_LONG/LARGE`、`WORD_NOT_IN_SESSION`、`SPEECH_TTS_RATE_LIMIT`、`SPEECH_TTS_MONTHLY_LIMIT`、`SPEECH_QUOTA_EXCEEDED`、`SPEECH_PROVIDER_*`。

### 4.4 分享、免费课程市场和举报

| 方法 | 路径 | 认证 | 请求/响应 |
|---|---|---|---|
| POST | `/api/course-shares` | bearer | `{ courseId }` → `{ id, token, url }`；token 只在创建响应出现 |
| GET | `/api/course-shares?courseId=:id` | bearer | 当前课程 active 分享元数据，不返回 token/hash |
| DELETE | `/api/course-shares/:id` | bearer | `{ ok:true }`，立即撤销 |
| GET | `/api/public/course-shares/:token` | 公开 | 当前课程的 `PublicCoursePreview` 脱敏快照 |
| POST | `/api/course-shares/:token/clone` | bearer | 免费克隆后的私有 `LearningCourseDetail` |
| POST | `/api/learning-courses/:id/publications` | bearer | `{ description, rightsDeclared:true }` → publication preview |
| GET | `/api/course-market` | 公开 | 最多 100 个 published `PublicCoursePreview`，按新到旧 |
| POST | `/api/course-publications/:id/clone` | bearer | 免费克隆后的私有 detail |
| POST | `/api/course-reports` | bearer | `{ publicationId|shareId, category, details }` → `{ id,status }` |
| PATCH | `/api/course-publications/:id/moderation` | bearer + 配置管理员 | `{ action:"hide"|"restore"|"withdraw", reason }` → 审核结果 |

公共 preview 只包含 publication/share ID、标题、简介、作者显示名、英语类别/locale、版本、单元/词数、cloneCount、创建时间，以及 `units[{name,position,isSystem,words[{term,translations,ipa}]}]`；不含 owner ID、进度、尝试、日程、token hash 或经济字段。分享读取源课当前内容；publication 是不可变快照。克隆随机生成所有 course/unit/word ID、进度归零并设 `canRepublish=false`。

举报 category：`abuse/copyright/privacy/spam/academic_integrity/other`，details≤1000；publicationId/shareId 必须恰好一个。举报达到阈值只写结构化告警，不自动下架。发布/举报超过日限额分别返回 429 `PUBLISH_LIMIT`/`REPORT_LIMIT`。

### 4.5 功能开关错误

| 条件 | HTTP/code |
|---|---|
| Courses 总开关关闭 | 503 `COURSES_DISABLED` |
| 分享关闭 | 404 `SHARING_DISABLED` |
| 市场关闭 | 404 `MARKET_DISABLED` |
| 语音关闭、熔断或缺配置 | 503 `PRONUNCIATION_UNAVAILABLE` |
| 音频预热子开关关闭 | 503 `AUDIO_PREWARM_DISABLED` |
| session revision 过期 | 409 `SESSION_REVISION_CONFLICT` + `currentRevision` |
| Courses 配额/成本变量不是有限正数 | 503 `SERVER_MISCONFIG` |

## 5. FastAPI AI（当前桩接口）

实现入口：`apps/ai/app/main.py`；请求模型：`apps/ai/app/schemas.py`。当前所有路由无认证、无限流，所以部署时必须保持内网可达，不能直接暴露公网。

### `GET /health`

响应 `200`：

```json
{
  "status": "ok",
  "service": "nalanda-ai",
  "claude": "unset"
}
```

`claude` 只表示是否设置 `ANTHROPIC_API_KEY`，不验证 key，也不表示生成已接入。

### `POST /parse`

请求：

```json
{
  "storage_path": "<user-id>/example.pdf",
  "material_type": "pdf"
}
```

当前固定响应：

```json
{
  "material_type": "pdf",
  "blocks": [],
  "text": ""
}
```

它不会读取 Storage、下载文件、校验路径所有权或解析文档。

### 生成接口通用请求

以下四个 endpoint 使用相同请求：

```json
{
  "material_id": "00000000-0000-0000-0000-000000000000",
  "text": "source text",
  "lang": "zh"
}
```

| 字段 | 类型 | 必需 | 当前规则 |
|---|---|---|---|
| `material_id` | string | 是 | Pydantic 仅要求字符串，不验证 UUID/存在性/归属 |
| `text` | string | 否 | 默认 `""`；桩实现忽略内容 |
| `lang` | `"zh" | "en"` | 否 | 默认 `"zh"` |

注意：共享 TypeScript `GenerateRequest` 当前使用 `materialId`，Python 请求使用 `material_id`，没有自动转换层；这是接线前必须统一的契约差异。

### `POST /generate/knowledge-list`

响应为数组：

```json
[
  {
    "title": "示例概念",
    "definition": "占位定义，待接入 Claude 生成。",
    "tags": ["stub"],
    "order": 1
  }
]
```

### `POST /generate/quiz`

响应为数组：

```json
[
  {
    "question": "占位题目？",
    "options": ["A", "B", "C", "D"],
    "answerIndex": 1,
    "explanation": "占位解析。",
    "type": "single"
  }
]
```

### `POST /generate/graph`

响应为对象：

```json
{
  "nodes": [
    { "id": "r", "label": "Root", "level": 0 },
    { "id": "a", "label": "A", "level": 1 }
  ],
  "edges": [["r", "a"]]
}
```

### `POST /generate/exam`

响应为对象：

```json
{
  "title": "Mock Exam",
  "meta": "Stub · 100 marks",
  "sections": [
    {
      "name": "Section A",
      "questions": [{ "prompt": "...", "marks": 10 }]
    }
  ]
}
```

本地调用示例：

```bash
curl -fsS http://localhost:8000/generate/quiz \
  -H 'Content-Type: application/json' \
  --data '{"material_id":"demo","text":"hello","lang":"zh"}'
```

## 6. Supabase 数据面（当前实现）

Web 使用 `@supabase/supabase-js`，并由 Supabase 自动映射到 Auth/PostgREST/Storage。这里记录应用实际依赖的能力，而不是承诺固定的原始 REST URL。

### 6.1 Auth

| 客户端操作 | 当前用途 |
|---|---|
| `auth.getSession()` | 初始化登录态、给后端请求获取 access token |
| `auth.onAuthStateChange()` | session 切换后进入/退出应用 |
| `auth.signInWithPassword()` | 注册完成后的自动登录和普通登录 |
| `auth.signOut()` | 退出 |

当前没有 OAuth、重置密码、MFA、账号导出/删除的应用接口。

### 6.2 PostgREST 表能力

| 领域 | 表 | Web 当前使用的主要操作 | 授权边界摘要 |
|---|---|---|---|
| 个人资料 | `profiles` | 本人 select；只更新 username/university/major/year/language/timezone | 0008/0011 的列级 GRANT、IANA 校验与防御触发器保护 points/credits/level/VIP/streak |
| Points | `point_entries` | 本人只读账本 | 客户端不可 insert/update/delete；`point_event_states` 对客户端完全隐藏 |
| 资料库 | `courses`, `materials` | owner CRUD | materials 写入额外校验课程 owner |
| 通知 | `notifications` | owner select/insert/update | 用户可标已读；当前 policy 也允许改其它 own 字段 |
| 反馈 | `feedback` | owner select/insert | policy 实际允许 owner 全 CRUD |
| 社区 | `posts`, `comments` | 公共读取；作者写/删 | “公共”指 authenticated 用户，不是匿名互联网 |
| 社区关系 | `post_likes`, `post_favorites`, `follows` | 当前用户增删/查询关系 | 复合主键防同时重复关系 |
| 标签 | `tags` | authenticated 读/插入 | 无更新/删除；无 kind 白名单约束 |
| 计划 | `study_goals`, `study_tasks` | owner CRUD | task 关联实体由 RLS 检查 owner |
| Courses 私有读取 | `learning_courses/units/words/sessions/items/attempts/progress/review_schedules/shares` | Web 当前经 Nest API 读取；数据库允许 owner SELECT | authenticated 无写权限；API service-role 写事务 RPC |
| Courses 传播/成长 | publications/reports/badges | 作者/举报人/本人只读；公共读取经 API | 匿名 PostgREST 不开放；speech usage/审核动作对客户端隐藏 |
| Courses 音频任务 | `learning_audio_assets` | 客户端无表/API 原始读取；只经 owner unit/word API 获取脱敏 manifest/audio | RLS + 表 grant 默认拒绝；仅 service-role worker |

字段、FK、级联和完整 RLS 矩阵见 [ERD 与数据库字典](./ERD.md)。Web 不应使用 service-role key；所有直连请求都必须在 anon key + 用户 session + RLS 下运行。

### 6.3 Storage

| Bucket | 当前调用 | URL/时效 |
|---|---|---|
| `materials`（private） | upload、remove、createSignedUrl | 下载签名 URL 120 秒；预览签名 URL 600 秒；路径首段为用户 UUID |
| `community-media`（public） | upload、getPublicUrl | 公开长期 URL；路径首段为用户 UUID |
| `vocabulary-audio`（private） | 仅 API get/put | 规范化英文 SHA-256 缓存；不开放客户端策略，不保存用户录音 |

表行与 Storage 对象不是同一事务。资料上传在表插入失败时尝试删除对象，但进程/网络中断仍可能产生孤儿；删除帖子也不会自动删除社区媒体。

### 6.4 数据库函数/RPC 暴露面

前端没有直接调用 Courses `rpc()`。迁移 0008 已收口 points helper；0012 的保存、会话、答题、日程、成长、语音配额、分享、发布、克隆、举报和审核 RPC 也全部撤销 PUBLIC/anon/authenticated EXECUTE，只授予 API service-role。0013–0024 持续以精确签名、RLS、双用户负向 E2E 和发布断言收口这些边界；0023 新增的 `_learning_spelling_without_punctuation`、`_learning_spelling_text_matches` 与替换后的七参数 attempt RPC 同样撤销 public/anon/authenticated EXECUTE，0024 验证结果、函数定义和精确权限。

未来确需客户端调用的 RPC 必须另建窄参数入口，绑定 `auth.uid()`、校验资源归属、使用稳定幂等键并补负向测试；不得重新授权内部 helper。

## 7. 尚未实现的目标 API

以下能力属于最终产品路线，不是当前可调用接口：

- 资料解析、AI 生成任务提交/排队/状态/取消/重试；
- 笔记与四类生成产物的版本化 CRUD；
- 笔记市场购买、credits 授权、搜索和创作者结算；Courses 只有免费发布/克隆，不提供购买或分成；
- points 规则版本/每日上限/反滥用与管理调整 API；credits 不可变账本、余额、VIP entitlement；
- Stripe checkout/payment intent/webhook/refund；
- 社区/笔记的内容举报、审核、管理员处置与申诉；Courses 已有最小举报和隐藏/恢复接口但无通用队列/申诉；
- Courses 文件上传解析：PDF、DOC/DOCX、JSON、Markdown、HTML、图片 OCR、类别 prompt、结构化词表与人工确认；当前无可调用 endpoint；
- 用户数据导出、删除请求与进度；
- Realtime 通知、设备推送；
- 管理、审计、监控和内部运维 API。

目标 API 落地前必须先确定版本策略、鉴权/角色、幂等键、分页、统一错误码、审计、限流、OpenAPI 与契约测试；不能仅按蓝图路由名直接上线。

## 8. 接口变更检查清单

1. 更新实现、共享类型与本文，避免 snake_case/camelCase 漂移。
2. 为新增 endpoint 明确认证、授权、输入上限、错误码和日志脱敏。
3. 增加单元/契约/E2E 测试，命令见 [测试指南](./TESTING.md)。
4. 数据结构变化先走向后兼容迁移，见 [数据库发布与回滚](../operations/DATABASE_RELEASE_ROLLBACK.md)。
5. 公网接口进行速率限制和滥用评审；内部接口也需网络隔离与服务认证。
6. 涉及 key 或新供应商时同步更新[环境变量矩阵](./ENVIRONMENT_VARIABLES.md)和[密钥轮换](../operations/SECRET_ROTATION.md)。
