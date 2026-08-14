# 06 · Materials 资料库（第一个真后端模块）

> **文档定位**
> - **内容**：记录 Materials 的表、Storage、RLS、上传/预览/删除流程和外键权限复盘。
> - **作用**：作为 Supabase owner-only 文件模块的实现案例。
> - **何时更新**：课程/资料字段、Storage 策略、支持格式、预览、配额或清理流程变化时。

> 目标：Materials 是第一个从「假数据」升级到「真后端」的业务模块，是后续模块的范本。讲清楚数据怎么建、文件怎么存、权限怎么隔离、前端各功能怎么实现，以及发现并修掉的一个越权漏洞。前置：[05 数据库/RLS](05-database-and-rls.md)、[04 前端与原型复现](04-frontend-and-prototype-port.md)。

## 1. 需求
按课程上传 / 查看 / 下载学习资料；每份归属一个课程；用户只能管理自己的；支持 PDF/PPT/Word/Markdown/HTML/TXT。

## 2. 关键设计：基础 CRUD 直连 Supabase，AI 经服务端
和登录读 profiles 一样，Materials 的基础增删查**前端直连 Supabase**：表数据走 `supabase.from(...)`，文件走 `supabase.storage`，安全靠 **RLS + 存储策略**在数据层强制。0041–0043 新增的 AI 生成不沿用这条写路径，必须经过 NestJS owner 校验、service-role 事务、durable queue 和隔离 worker。

为什么基础 CRUD 不走 NestJS：这些是「用户自有数据 CRUD」，RLS 已保证安全。后端留给需要服务端密钥/特权事务的注册、已上线 Materials AI，以及未来支付。

## 3. 数据模型（迁移 0002）
```
courses(id, user_id=auth.uid(), code, name, color, term, instructor, created_at)
materials(id, user_id=auth.uid(),
          course_id → courses(id) on delete cascade,   -- 删课程级联删资料
          name 原始文件名, type 扩展名识别, size_bytes,
          storage_path 文件在桶里的路径, created_at, index(course_id))
```
两表都 `enable RLS` + owner-only（见 [05](05-database-and-rls.md)）。

## 4. 文件存储（Storage）
- 私有桶 `materials`（`public=false`，外部不能直链，必须签名 URL）。
- 对象路径约定 **`{user_id}/{随机uuid}.{ext}`**——第一层文件夹是用户 id。
- `storage.objects` 上三条策略按「第一层文件夹 = 当前用户」放行：
```sql
using (bucket_id='materials' and (storage.foldername(name))[1] = auth.uid()::text)
```
于是「张三只能读写 `materials/张三id/...`」，存储层就隔离了。

## 5. ⚠️ 发现并修复的越权（迁移 0003）
两用户端到端测试时发现：**B 能插入一条「自己的」materials 行，但 `course_id` 指向 A 的课程**。
- 为什么：0002 的策略只校验资料的 `user_id`，没校验被引用课程的归属；外键只查「课程存在」不查归属。
- 影响：B 读不到 A 的课程数据（RLS 仍拦），但能造指向别人课程的脏数据——不干净、潜在完整性问题。
- 修复（0003）：`with check` 追加「课程必须属于本人」：
```sql
and exists (select 1 from public.courses c
            where c.id = materials.course_id and c.user_id = auth.uid())
```
- 验证：修复后 B 再挂到 A 的课程 → **403 被拒**。

> 教训：**外键不等于权限**。RLS 表通过外键引用另一张「属于用户」的表时，要在 `with check` 里显式校验被引用行也归本人。

## 6. 前端实现（`apps/web/src/legacy/materials.ts`）
一个**自管容器**的小应用，挂到应用壳给的 `#mat-root`（集成方式见 [04](04-frontend-and-prototype-port.md)）。

### 结构
- `initMaterials(supabase, user, toast)`：注入依赖。
- `mountMaterials(el)`：记容器 → `render()`（先出加载态）→ `load()`。
- `state = { loading, error, courses[], materials[], course }`。
- `load()`：并发拉 courses + materials → 写 state → 重渲染；出错写 `state.error`（迁移没应用时显示「出错了」而非崩溃）。
- `render()`：用原型同款 class 拼 HTML 塞进 `#mat-root`；**用户数据逐字段 `esc()` 转义防 XSS**。
- `wire()`：给 `[data-mat]` 绑点击；拖拽区绑 dragover/drop。

### 各功能逻辑
- **新建课程** `newCourse()`：弹 `.scrim/.modal` 小表单 → `insert(...).select().single()` → 刷新并切到该课程。`user_id` 由数据库默认填。
- **上传** `pickFiles()`→`doUpload()`：守卫（没课程先建、选 All 时提示先选课程）；支持点选 + 拖拽；每个文件 → 路径 `${user.id}/${crypto.randomUUID()}.${ext}` → `storage.upload` → `materials.insert`；**入库失败回滚**已传对象（删孤儿文件）；完成后刷新 + toast。
- **预览 / 下载**：下载签名 URL 当前 120 秒；应用内预览签名 URL 600 秒。PDF/图片/HTML/Markdown/文本在应用内展示，Office 可选择交给 Microsoft 在线预览，其他格式下载查看。
- **删除** `delMaterial()`：`confirm` → `storage.remove` 删文件 → `delete().eq('id')` 删记录 → 刷新。
- **筛选**：顶部 chips 改 `state.course` 重渲染（前端过滤仅体验；安全仍靠 RLS）。

### 与应用壳的集成（3 处，见 [04](04-frontend-and-prototype-port.md)）
1. `mountNalanda` 把 `supabase` / `user` 透传 → `initMaterials(...)`。
2. `VIEWS.materials = () => '<div id="mat-root"></div>'`（覆盖原 mock 视图）。
3. `go()` 钩子：进 `materials` 路由时 `mountMaterials(#mat-root)`。

## 7. 端到端验证
两用户 RLS 套件包含以下真实 Supabase 断言：
- A：建课程、资料入库/列表、上传并下载自己的文件、创建签名 URL、显式删除文件/资料/课程。
- B：看不到 A 的课程/资料、不能下载或签名 A 的文件、不能写入 A 的路径、不能把资料挂到 A 的课程。
- 清理：用 owner 验证正常删除路径；`afterAll` 再由 service-role 清 Storage 并删除测试用户兜底。

默认 `pnpm test` 会跳过外部用例；PR/main deploy workflow 会启动一次性本地 Supabase 并显式执行 `pnpm test:rls`，证明仓库迁移在本地基线的实际策略。它仍不能替代托管 staging/生产配置漂移检查。

> 这套「两用户互相验证 RLS」是检验任何 owner-only 模块的标准做法。可执行命令、环境保护和清理逻辑见 [测试指南](../guides/TESTING.md)，禁止默认对生产项目运行。

## 8. 扩展点
- 列表分页 / 搜索 / 排序；更稳定的 PDF.js / Office 服务端转图。
- 上传大小限制、类型白名单、进度条。

### 8.1 Materials AI 试卷（生产 0041–0043）

每行新增 “Use AI” 二级菜单；生产 Generate test paper 可配置语言、难度、15–240 分钟、20–200 分、六类题型、答案详略和 focus；生产 Knowledge list/Quiz/Knowledge graph 仍显示 Coming soon。0046–0051 候选已把 “Organize knowledge points” 接为真实知识图谱入口并增加 Luna pipeline，受保护发布完成后才可更新本段生产状态。首次按用户记录第三方/ZDR/私有 parse cache 同意。

API 不把永久 Storage 权限交给 worker：先校验 owner、格式和 25MB/图片10MB，再创建短期 signed URL与 Postgres job/quota reservation；BullMQ 只投 UUID，FastAPI 解析并回调进度。页面每2秒轮询，后台退避到10秒，离开/刷新不取消。成功试卷落在同一 `courses.id` 的 My Notes；删除材料/科目可保留到 Unfiled 或同时删除 AI 结果，两者都取消任务、清 parse cache和过程文件。

生产数据库与应用当前已到 0043。2026-08-11 的受保护发布通过真实 DeepSeek/MiMo、220 页 Office canary、登录用户生成/评分/删除、临时目录清理和独立公网 readiness 后开启 `FEATURE_MATERIAL_AI`。Storage 文件删除仍是 immediate best effort，完整孤儿重试/账号 DSAR 仍属运维缺口。

### 8.2 可恢复长任务、知识图谱与 Luna（0046–0051 候选，尚未上线）

候选 API 只等待 worker 202 接收，后续由内部认证 callback 持久化 progress、usage、checkpoint 与 terminal result，避免单个生成占用五分钟以上 HTTP。显式 Undici Agent 将 connect/accept/headers/body timeout 分开，响应头超时映射 `AI_WORKER_TIMEOUT`；用户可在 `resumeUntil` 前点击 Resume 继续同一 job。数据库 checkpoint 与 worker 0700 local checkpoint/usage spool 合并最高有效阶段，已完成 provider 阶段不重复调用，usage event UUID 不重复计费；终态或默认 24 小时 TTL 清理残留。

“Organize knowledge points” 的旧 pipeline 与试卷共用解析/审查/失败范围视觉恢复；Luna pipeline 直接校验并 inline 发送原始文件，不运行 parser/OCR/DocumentIR、不使用 Files API，固定 OpenAI-only/no fallback。两者都生成 `GeneratedKnowledgeGraphV1`，节点按 sourceOrder 与 level 排列并包含详细解释、关键点、例子、公式、误区、自测和来源。

My Notes 动态加载 React Flow + ELK：支持画布 pan/zoom、节点拖动、fit/auto arrange、键盘移动、250 节点与移动端；初始布局和拖动保存都做碰撞消解。图中只显示类型/标题，hover/聚焦临时在画布外 inspector 显示详情，点击固定并允许 node Q&A，`Esc` 取消；坐标/viewport 按 user/note/artifact version/revision 跨设备保存。整个 Materials/My Notes 候选 UI 固定英文并复用原有字体/token。

队列每行可 Delete，标题区可 Clear history；两者应用内二次确认。queued 删除释放额度，worker accepted 后删除/兼容 Cancel 消费一次；活动行保持 “Cleaning up…” 到 worker 确认 HTTPX/Office/checkpoint/spool/0700 目录均清理。Clear 只删 terminal，不删 active、既有 Notes 或 provider usage。在线考试选择/输入只保存草稿且 `results=[]`，整卷 Submit 二次确认后统一批改，主观题合并一次 AI 评分；到期交卷走相同路径。
