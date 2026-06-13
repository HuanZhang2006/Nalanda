# Nalanda 架构与开发路线图

> 状态：v1 草案 · 最后更新 2026-06-13
> 本文是 Nalanda 平台的总体架构与开发流程的权威参考。核心选型已锁定（见第 2 节），少量子决策待定（见第 13 节）。

---

## 1. 产品概述

Nalanda 是一个面向大学生的多平台 AI 学习与知识平台。核心目标：把零散的课程资料（PPT / Word / PDF / Markdown / HTML / TXT）转化为结构化知识，并通过 AI 生成**知识清单、交互式测验、知识图谱、模拟期末试卷**；同时支持笔记的分享与交易、社区交流、学习计划、用户成长与支付。

八大功能模块：用户数据系统、资料模块、个人笔记与 AI 创作（最高优先级）、笔记市场、社区平台、学习计划、反馈、支付系统。

UI 基于已落库的高保真原型（`app/` 目录，warm-editorial 风格、衬线标题 + 无衬线正文、明暗双主题、四维 Tweaks）。

---

## 2. 技术栈总览（已锁定）

| 层 | 选型 | 说明 |
|---|---|---|
| Web 前端 | React 18 + TypeScript + Vite | 复用原型 `nalanda.css` 设计令牌，重建为组件 |
| 桌面端 | Electron + electron-builder | 加载同一份 React 产物，加原生能力 |
| 移动端 | React Native / Expo | **现在即在 monorepo 预留架构**，与 Web 共享类型/逻辑 |
| 核心后端 | Node.js + NestJS + TypeScript | 全部业务 API，monorepo 内共享类型 |
| AI 微服务 | Python + FastAPI | 文档解析、知识提取、生成、检索、推荐 |
| 数据库 | Supabase PostgreSQL + pgvector | 关系数据 + 资料向量检索（RAG） |
| 鉴权 | **Supabase Auth** | 邮箱/密码 + OAuth，签发 JWT；NestJS 验签 |
| 文件存储 | Supabase Storage | S3 兼容，签名 URL |
| 实时通知 | **Supabase Realtime** | 任务完成、社区互动、通知推送 |
| 队列/缓存 | Redis + BullMQ | AI 生成异步任务、限流 |
| 支付 | Stripe（Checkout + Connect + Webhook） | 法币支付 + 创作者分成打款 |
| AI 模型 | Anthropic Claude API | 多智能体结构化生成 + 多模态解析 |
| 文档/AI 实现路径 | 基于 [ExamPass-Assistant](https://github.com/WUBING2023/ExamPass-Assistant) | 复用其解析管线与多智能体 skills（见第 8 节，注意授权） |
| 部署 | Vercel（Web）+ Railway（NestJS/Python/Redis）+ Supabase | PaaS 起步 |
| 代码组织 | pnpm + Turborepo monorepo | 端到端类型安全 |
| i18n | **界面与 AI 生成均中英双语** | react-i18next + 生成请求带语言参数 |

---

## 3. 关键决策记录（含本轮澄清）

| # | 决策 | 结论 |
|---|---|---|
| 前端 | 生产版前端框架 | React + TypeScript（Vite） |
| 后端 | 主服务语言 | Node(NestJS) 核心 + Python(FastAPI) AI 微服务 |
| 地区/支付 | 目标市场与支付渠道 | 海外为主 → Stripe |
| 部署 | 基础设施 | 托管 PaaS（Supabase + Vercel/Railway） |
| 鉴权 | 认证方案 | Supabase Auth |
| 移动端 | 时机 | 现在即预留 React Native 架构 |
| 定价 | 笔记定价模型 | **一律用 credits 计价；汇率 1 USD = 10 credits**（1 credit ≈ $0.10） |
| 实时 | 通知机制 | Supabase Realtime |
| 官方课程 | 内容形态 | **图文 / 视频 / 直播** 三种 |
| i18n | 多语言范围 | **界面与 AI 生成都要中英双语** |
| 文档/AI | PDF 处理与 AI 处理实现 | **大量基于 ExamPass-Assistant 的实现路径与 skills 二次开发** |
| AI 模型 | LLM 服务商 | Anthropic Claude |
| 数据库 | 关系库 + 向量 | PostgreSQL + pgvector |

---

## 4. 系统架构与数据流

### 4.1 分层

```
客户端：Web (React) · 桌面 (Electron) · 移动 (React Native)
            │  HTTPS / Supabase JWT
            ▼
NestJS API 网关（核心业务）
  用户 · 课程 · 资料 · 笔记 · 市场 · 社区 · 计划 · 积分 · 支付 · 反馈 · 管理
            │
   ┌────────┼─────────────┬─────────────────┐
   ▼        ▼             ▼                 ▼
BullMQ → Python AI 微服务   Stripe          Supabase
(Redis)   (FastAPI)        (支付/分成)      (Postgres+pgvector
            │                                · Auth · Storage · Realtime)
            ▼
        Claude API（多智能体生成 + 多模态解析）
```

### 4.2 AI 笔记生成流水线（核心，异步）

1. 用户上传资料 → 前端凭后端签名 URL 直传 Supabase Storage → 落 `Material` 元数据。
2. 用户发起创建：选资料 + 勾选产物（清单/测验/图谱/试卷）+ 深度 + 语言（中/英）。
3. NestJS 校验课程范围与积分 → **预扣 credits（reserve）** → 入 BullMQ 队列 → 返回 `jobId`。
4. Worker 调用 Python AI 微服务：解析 → 分块 → 嵌入存 pgvector → 检索 → Claude 多智能体生成结构化 JSON。
5. 结果落库（`GeneratedNote` + `KnowledgePoint`/`Quiz`/`MockExam`/`KnowledgeMap`）→ 任务完成 → 经 Supabase Realtime 通知前端。
6. **credits 结算**：成功扣除、失败回滚预扣。

---

## 5. Monorepo 结构

```
nalanda/
├─ apps/
│  ├─ web/                 # React + Vite（Web 主应用）
│  ├─ desktop/             # Electron 壳（main / preload，加载 web 产物）
│  ├─ mobile/              # React Native / Expo（与 Web 共享逻辑）
│  ├─ api/                 # NestJS 核心后端
│  └─ ai/                  # Python FastAPI AI 微服务（含 ExamPass 派生模块）
├─ packages/
│  ├─ ui/                  # 设计系统：从 nalanda.css 抽取的 token + 组件
│  ├─ types/               # 共享 TS 类型 / zod schema（前后端 + AI 契约）
│  ├─ api-client/          # 由后端 OpenAPI 生成的前端 SDK
│  ├─ i18n/                # 中英文案资源（界面）
│  └─ config/              # eslint / tsconfig 等共享配置
├─ supabase/               # migrations、RLS 策略、seed
├─ infra/                  # Docker、Railway/Vercel 配置、CI 脚本
├─ docs/                   # 本文档等
└─ app/                    # 既有高保真原型（设计基线，不直接进生产）
```

> `packages/ui` 直接继承 `nalanda.css` 的 CSS 变量体系（明暗主题、强调色、密度、字体配对），保证生产 UI 与设计稿一致。移动端复用 `types` / `api-client` / `i18n`，UI 用 RN 原生组件但共享设计令牌取值。

---

## 6. 数据模型

PostgreSQL，核心表与关系（对应需求中的 25 个模型）：

```
User ──1:1── UserProfile（university, major, language, prefs, 行为统计）
User ──1:N── Course ──1:N── (Subject) ──1:N── Material
Material（type, storage_path, course_id, owner_id, pages, size）
Material ──N:M── GeneratedNote（生成来源）
Note（个人笔记，可手动编辑）── 可关联 ── GeneratedNote
GeneratedNote ──1:N── KnowledgePoint / Quiz / MockExam / KnowledgeMap
MarketplaceItem ──N:1── Note（tags=知识点/课程, price_credits, rating, sales）
Order（type ∈ credits_topup | note_purchase | vip | official_course | payout）
Order ──1:N── Payment（Stripe 支付意图/状态）
CreditTransaction（账本：+赚取 / -消费）；Badge；CreatorEarning
CommunityPost ──1:N── Comment；Like / Favorite（多态：post/note/material）
StudySchedule ──1:N── StudyTask（关联 course/material，含完成状态、来源）
OfficialCourse ──1:N── Lesson（type ∈ article | video | live）
Feedback（多态关联 user/course/note/order/material，含状态机）
Notification
```

### 6.1 行级安全（RLS，在数据库层强制）
- 资料只能由所属 `course` 的成员/拥有者读写（“用户只能在对应课程下管理资料”）。
- 个人笔记、订单、积分账本按 `user_id` 隔离。
- 市场上架笔记对所有人可读；购买后在购买者名下复制一条 `Note`。
- 管理后台用 service-role 绕过 RLS，单独鉴权（角色：user / creator / admin）。

### 6.2 积分与定价
- **笔记一律以 credits 计价**（不支持法币直购单篇笔记）。
- **汇率固定 1 USD = 10 credits**（1 credit ≈ $0.10）；充值时按此换算生成 `credits_topup` 订单。
- 创作者分成默认 **70%**（与原型一致），以 credits 记入 `CreatorEarning`。
- VIP 订阅、官方课程：走法币（Stripe）；积分可作为可选支付方式（待定，见第 13 节）。

### 6.3 官方课程（图文 / 视频 / 直播）
- `OfficialCourse` 下挂 `Lesson`，`type` 区分三种形态：
  - 图文（article）：富文本 + 资料附件，存 Postgres/Storage。
  - 视频（video）：上传后转码点播；建议用视频服务（Mux / Cloudflare Stream）而非自管。
  - 直播（live）：需第三方实时音视频/直播服务（如 Agora/声网、LiveKit），含开播、观看、回放。**provider 待定（第 13 节）**。

### 6.4 i18n（中英双语）
- 界面：`packages/i18n` + react-i18next（Web/桌面）、对应 RN 方案（移动端）。
- AI 生成：生成请求带 `lang ∈ {zh, en}`；生成产物按语言存储，可按需补生成另一语言；默认取用户 `UserProfile.language`。

---

## 7. 后端实现

### 7.1 NestJS 模块 ↔ 需求中的 13 个 Service

| Service | NestJS Module | 职责 |
|---|---|---|
| Auth | `auth` | 验 Supabase JWT、角色守卫 |
| User | `users` | 资料、偏好、行为统计、成长 |
| Material | `materials` | 上传签名 URL、元数据、课程范围校验 |
| AI Note | `notes-ai` | 触发生成、任务编排、落库（调 ai 微服务） |
| Course/Subject | `courses` | 课程/学科结构 |
| Note | `notes` | 个人笔记 CRUD、手动编辑、从市场入库 |
| Marketplace | `market` | 上架、定价、购买、评分、收藏 |
| Community | `community` | 帖子、评论、点赞、收藏 |
| Schedule | `schedule` | 计划、任务、自动排程 |
| Credit | `credits` | 积分账本、等级、徽章、VIP |
| Payment | `payments` | Stripe 订单、Webhook、分成结算 |
| Feedback | `feedback` | 工单、状态机、多态关联 |
| Admin | `admin` | 后台聚合、审核、处理 |

通用基建：`@nestjs/bullmq`（队列）、`class-validator`/zod（校验）、`@nestjs/swagger`（OpenAPI → 生成前端 SDK）、全局异常/日志/限流拦截器。

### 7.2 Python AI 微服务接口（FastAPI，内网调用）

```
POST /parse                      # PPTX/DOCX/PDF/MD/HTML/TXT → 归一文本+结构（+多模态 OCR）
POST /embed                      # 分块向量化 → 写入 pgvector
POST /generate/knowledge-list    # → [{title, definition, tags[], order}]
POST /generate/quiz              # → [{question, options[], answerIndex, explanation, type}]
POST /generate/graph             # → {nodes:[{id,label,level}], edges:[[a,b]]}
POST /generate/exam              # → {title, meta, sections:[{name, questions:[{prompt, marks}]}]}
POST /recommend/tasks            # 据学习数据推荐复习任务
POST /recommend/content          # 据课程推荐市场笔记/社区内容
```

---

## 8. AI 实现（基于 ExamPass-Assistant）

PDF 处理与各类 AI 生成将**大量复用 [ExamPass-Assistant](https://github.com/WUBING2023/ExamPass-Assistant) 的实现路径与 skills**，在其之上二次开发。该项目与 Nalanda 的 AI 模块高度同构。

### 8.1 文档解析管线（对应其 `scripts/extract_*`）
- PPTX：文本、表格、图片提取（`extract_pptx`）。
- DOCX：原生文档解析（`extract_docx`）。
- PDF：文本 + 图像内容，**对图像/扫描页用 Claude 多模态做 OCR/理解**（`extract_pdf`）——因此默认不需要独立 Tesseract。
- MD/HTML/TXT：补充纯文本解析，统一归一为「带层级结构的文本块」。

### 8.2 多智能体生成流水线（对应其 `agents/` skills）
采用其五个专职子智能体，映射到我们的 `/generate/*`：
1. Skeleton Agent — 构建知识依赖结构（→ 知识图谱骨架、清单排序）。
2. Notes Agent — 叙事式结构化笔记（→ 知识清单）。
3. Item Agent — 学科感知的题目生成（→ 交互式测验，支持多题型）。
4. Reviewer Agent — 校验内容准确性（质量门）。
5. Solver Agent — 两遍验证模拟试卷（→ 模拟试卷 + 答案）。

生成时用 Claude 工具调用强制输出固定 JSON schema；RAG：分块 → 向量化 → 按产物类型检索相关块控制上下文。其 `SKILL.md` 的命令路由可改造为 AI 微服务的 agent 编排入口；`templates/` 的渲染（含 D3 图谱 `graph.js`）可作为前端图谱组件的参考（原型已有自带 SVG 图谱，二选一）。

### 8.3 数据形状三方对齐
原型 `app/data.js` 的 `DB.knowledge / DB.quiz / DB.graph / DB.exam`、ExamPass 的四类产物、Nalanda 的 AI schema **三者一一对应**——前端组件几乎无需改数据契约，AI 真接上即可渲染。

### 8.4 ⚠️ 授权注意（重要）
ExamPass-Assistant 以 **CC BY-NC 4.0（署名-非商业）** 发布。Nalanda 含笔记市场、VIP、支付等**商业化**功能，直接复用其代码可能与该许可冲突。落地前需三选一：
1. 取得作者的**商业授权 / 单独许可**；
2. 仅将其作为**方法论参考**（思路、prompt 设计、流水线结构），自行干净重写实现；
3. 将派生部分约束在**非商业边界**内。

> 建议：在阶段 0 先就授权与作者确认，再决定复用粒度。

---

## 9. 支付与积分体系（Stripe，双层账本）

- **法币层（Stripe）**：买 credits（1 USD = 10 cr）、订阅 VIP、买官方课程 → Stripe Checkout → Webhook 确认 → 落 `Order` + `Payment`。
- **积分层（内部）**：买笔记一律用 credits，走 `CreditTransaction`。
- **创作者结算**：收益以 credits 记 `CreatorEarning`（默认 70%）；提现经 **Stripe Connect**（Express 账户）把 credits 兑回法币打款。
- **退款/争议**：Webhook 监听 `charge.refunded` / `charge.dispute.*`，回滚积分与入库记录。
- 安全：Webhook 验签、幂等键、订单状态机。

---

## 10. 前端与三端

- **React 应用**：路由覆盖 15 个页面；服务端数据用 TanStack Query，UI 态用 Zustand，表单用 react-hook-form + zod。
- **设计系统**：`packages/ui` 承接 `nalanda.css` 的 CSS 变量；把原型的卡片/标签/测验/图谱/创建流等做成组件；Tweaks 四维（强调色/字体/密度/侧栏）变为真实用户设置。
- **Electron**：`main` + `preload`（`contextIsolation:true`、禁 `nodeIntegration`）加载 Web 产物；原生能力：文件选择/拖拽上传、离线缓存（后期）、`electron-updater` 自动更新；`electron-builder` 出 mac/win 安装包 + 代码签名。
- **React Native（现在预留）**：`apps/mobile` 与 Web 共享 `types`/`api-client`/`i18n`/业务逻辑；UI 用 RN 组件，复用设计令牌取值。
- 三端共用由后端 OpenAPI 生成的 `packages/api-client`，契约统一。

---

## 11. 实时与通知（Supabase Realtime）

- AI 生成任务完成、社区点赞/评论、订单状态、计划提醒等通过 Supabase Realtime 频道推送。
- 前端订阅用户专属频道；`Notification` 表持久化 + Realtime 实时下发。

---

## 12. 开发流程

### 12.1 分阶段路线图

| 阶段 | 内容 | 产出 |
|---|---|---|
| 0 基建 | monorepo、Supabase 建库+RLS、CI/CD、`packages/ui` 抽取、Supabase Auth、Electron 壳、RN 骨架、ExamPass 授权确认 | 可登录的三端空壳 |
| 1 MVP（核心） | 用户/课程/资料上传 + **AI 笔记四件套** + 个人笔记库（中英双语） | 最高优先级，闭环可用 |
| 2 变现 | 笔记市场 + Stripe 支付 + credits（1USD=10cr）+ Connect 分成 + 成长系统 | 可交易 |
| 3 生态 | 社区 + 学习计划 + 推荐 | 留存/活跃 |
| 4 扩展 | 反馈 + 管理后台 + 官方课程（图文/视频/直播）+ React Native 上线 | 完整平台 |

### 12.2 工程实践
- **环境**：local（Supabase CLI 本地栈）/ staging / prod；迁移用 Supabase migration。
- **CI/CD**：GitHub Actions（lint + typecheck + test → build）；Vercel 自动部署 Web；Railway 部署 NestJS/Python/Redis；打 tag 触发 Electron 发版。
- **测试**：Vitest/Jest（前后端单测）、pytest（AI 服务）、Playwright（E2E）、AI 输出 JSON schema 契约测试、Stripe CLI 跑 Webhook 测试。
- **可观测性**：Sentry（前后端）、结构化日志、Bull Board（队列面板）、Stripe Dashboard。
- **安全**：RLS + JWT 验签、文件签名 URL、接口限流、输入校验、社区/市场内容审核（Claude moderation）、上传可选杀毒扫描。

---

## 13. 待确认 / 后续子决策

| # | 议题 | 当前建议（待定） |
|---|---|---|
| A | 笔记富文本编辑器 | Tiptap/ProseMirror（结构化、协作友好） |
| B | 直播服务商 | Agora/声网 或 LiveKit（海外用 LiveKit/Mux 更顺） |
| C | 点播视频服务 | Mux 或 Cloudflare Stream |
| D | VIP / 官方课程是否也支持 credits 支付 | 默认法币，credits 可选 |
| E | ExamPass-Assistant 复用粒度与授权 | 阶段 0 与作者确认商业授权（见 8.4） |
| F | AI 生成双语策略 | 按需补生成 vs 双语同时生成（成本权衡） |
| G | 邮件/通知渠道 | Resend / Postmark（事务邮件） |

---

## 14. 附录：参考

- 设计原型：`app/`（`Nalanda Showcase.html` 为入口，桌面 + 移动）。
- 文档/AI 实现参考：https://github.com/WUBING2023/ExamPass-Assistant （CC BY-NC 4.0）。
- 设计令牌：`app/nalanda.css`（明暗主题、强调色、密度、字体配对）。
