# Nalanda

> 以古印度那烂陀大学命名——世界上最早的知识殿堂。

**Nalanda** 是一款多平台 AI 学习辅助工具，专为大学生设计。一键将 PPT、Word、PDF 课件转化为结构化学习资产，从预习到期末一站式覆盖。

> 🌐 在线体验：**https://nalanda.online** （注册即用）

---

## 实现状态

| 模块 | 状态 |
|---|---|
| 注册 / 登录 / 退出 | ✅ **真后端**：Supabase Auth + JWKS 验签 + 自建注册接口 |
| 资料库 Materials | ✅ **真后端**：按课程上传/预览/下载/删除；Storage + RLS；PDF/图片/文本/Markdown(渲染↔源码) 软件内预览 |
| 社区 Community | ✅ **真后端**：发帖(图片/音频/标签)/编辑/删除、点赞/评论/收藏/转发/关注、按大学/专业/学科分区、「我的」、互动通知 |
| 学习计划 Schedule | ✅ **真后端**：今天/本周/全部、任务关联课程资料、目标倒计时、完成得积分+连续学习、智能填充 |
| 个人成长 Profile | ✅ **真后端**：真实资料+实时计数、活动积分与等级、分级徽章、可编辑 |
| 通知 / 反馈 | ✅ **真后端**：通知面板(未读/已读)、反馈提交与工单 |
| 生产部署 + CI/CD | ✅ **已上线** `nalanda.online`：push 到 `main` 自动构建并部署 |
| AI 笔记与创作 · 笔记市场 · Home 首页 | 🟡 前端原型 + 假数据，后端待接 |
| 桌面端（Electron）· 移动端（RN） | ⬜ 未开始（monorepo 已预留位置） |

✅ 真后端　🟡 仅前端原型（mock）　⬜ 未开始　｜　各部分实现细节与踩坑见 [`docs/notes/`](docs/notes/)

---

## 核心功能（AI 笔记与创作）

平台的核心，把课件一键转化为四类学习资产，全部归在同一篇「笔记」里：

| 功能 | 说明 |
|------|------|
| **知识清单** | 自动提取课件核心概念，按依赖关系排序，生成结构化知识点列表 |
| **交互式测试题** | 根据课件内容生成自动评分的练习题，答错即时给出解析 |
| **知识图谱** | 可视化概念关联，帮助建立知识体系，理清脉络 |
| **仿真期末试卷** | 按课程难度分布生成全长仿真试卷，模拟真实考试场景 |

## 其它模块

围绕核心创作流，Nalanda 还提供完整的学习生态：

- **资料库（Materials）** ✅ — 按课程上传、预览、下载、删除，Storage + RLS，作为 AI 生成的输入
- **社区（Community）** ✅ — 发帖（图文/音频/标签）、点赞/评论/收藏/转发/关注，按大学/专业/学科分区，积分与通知联动
- **学习计划（Schedule）** ✅ — 任务/目标、完成得积分与连续学习、关联课程资料、智能填充复习任务
- **个人成长（Profile & Growth）** ✅ — 真实资料、活动积分/等级、分级徽章（积分 ≠ 未来充值钱包）
- **反馈（Feedback）** ✅ — 提交反馈与工单追踪
- **笔记市场（Note Market）** 🟡 原型 — 买卖、分享笔记，创作者分成（待支付/钱包）

## 使用场景

- **课前预习**：上传课件，快速掌握本节重点，带着问题去听课
- **课后复习**：知识清单 + 测试题，检验理解程度，查漏补缺
- **备考冲刺**：仿真试卷模拟期末，知识图谱串联整个学期内容

## 支持格式

- **PPT / PPTX** — 课堂讲义、教学幻灯片
- **Word / DOCX** — 讲义、学习指导
- **PDF** — 教材章节、扫描讲义
- 以及 **Markdown / HTML / TXT** 文本资料

## 平台支持

- Web（浏览器）
- iOS / Android（移动端）
- macOS / Windows（桌面端）

---

## 界面原型

仓库内已实现一套高保真、可点击的交互原型，桌面端与移动端共用一套设计令牌（warm-editorial 风格、衬线标题 + 无衬线正文、明暗双主题）。

- [`app/Nalanda Showcase.html`](app/Nalanda%20Showcase.html) — 桌面端 + 移动端并排展示画布（可拖拽缩放，点击聚焦按钮可全屏查看任一端）
- [`app/Nalanda.html`](app/Nalanda.html) — 完整桌面应用：8 个模块的真实导航、明暗切换、Tweaks 调参面板（强调色 / 字体 / 密度 / 侧栏）
- [`app/Nalanda Mobile.html`](app/Nalanda%20Mobile.html) — 移动端伴侣应用：底部标签导航 + 中央创建按钮

> Tweaks 调参面板依赖 Claude Design 编辑器的宿主环境，独立打开时不可交互，但默认样式会正常应用——其余功能（导航、测试题、主题切换、双端）均完整可用。

## 快速开始

原型是纯静态文件（HTML / CSS / JS，仅 Showcase 画布与 Tweaks 用到 CDN 引入的 React + Babel）。需要通过本地静态服务器访问（直接用 `file://` 打开会因 iframe 与 fetch 受同源策略限制而无法正常加载）：

```bash
# 在仓库根目录启动任意静态服务器
python3 -m http.server 8000

# 浏览器打开 http://localhost:8000/
# 根路径会自动跳转到 Showcase
```

## 本地开发（应用骨架）

仓库已搭好 pnpm + Turborepo monorepo（`apps/` + `packages/`）。需要 Node ≥ 20 与 pnpm 9。

```bash
pnpm install                       # 安装依赖
pnpm build                         # 构建 types / api / web
pnpm --filter @nalanda/web dev     # 前端开发服务器
pnpm --filter @nalanda/api start   # 后端；GET /api/health 自检
```

- `apps/web` — React + Vite（前端）｜ `apps/api` — NestJS（`/api/*`）
- `apps/ai` — Python FastAPI AI 微服务（`uvicorn app.main:app`，骨架）
- `packages/ui` — 设计令牌（从原型抽取）｜ `packages/types` — 共享类型

> 登录与 Materials 需要 Supabase：复制 `apps/web/.env.example` → `.env.local`、`apps/api/.env.example` → `.env` 填上你的 Supabase 密钥；数据库迁移用 `node scripts/db-push.mjs`（见 [`supabase/`](supabase/)）。

部署见 [`infra/deploy/`](infra/deploy/README.md)（生产 · nginx 版）与 [`infra/hybrid-2g/`](infra/hybrid-2g/README.md)（通用 2G 版）。

## 技术栈

**已接入（生产运行中）**
- 前端：React + TypeScript（Vite），移植自原型 → `apps/web`
- 后端：NestJS（注册 / 验签 / 健康检查）→ `apps/api`
- 数据 / 鉴权 / 存储：Supabase（PostgreSQL + 行级安全 RLS、Auth、Storage）
- 部署：服务器 nginx + Docker + GitHub Actions（`nalanda.online`）

**规划中**
- AI：Anthropic Claude + Python FastAPI 微服务（基于 ExamPass-Assistant 路径）｜ 检索 pgvector
- 队列 Redis + BullMQ ｜ 支付 Stripe ｜ 桌面 Electron ｜ 移动 React Native
- 原型：原生 HTML / CSS / JS（`app/`），设计令牌已抽入 `packages/ui`

完整架构与路线图见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)；分模块实现笔记见 [`docs/notes/`](docs/notes/)。

## License

MIT
