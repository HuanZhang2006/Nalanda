# 04 · Materials 资料库（第一个真后端模块）

## 这篇讲什么
Materials 是第一个从「假数据」升级到「真后端」的模块，是后续模块的范本。这里讲清楚：数据怎么建、文件怎么存、权限怎么隔离、前端怎么实现各功能、以及发现并修掉的一个越权漏洞。

## 需求
按课程上传、查看、下载学习资料；每份资料归属一个课程；用户只能管理自己的；支持 PDF/PPT/Word/Markdown/HTML/TXT。

## 关键设计选择：supabase-js 直连 + RLS（不加后端接口）
和登录读 profiles 一样，Materials 的增删查**全部前端直连 Supabase**：
- 表数据：`supabase.from('courses'/'materials')`
- 文件：`supabase.storage.from('materials')`
- 安全：**RLS + 存储策略**在数据库/存储层强制隔离

为什么不走 NestJS：这些都是「用户自有数据的 CRUD」，RLS 已能保证安全，加后端接口纯属多余。后端只留给「需要服务端密钥/逻辑」的事（注册、将来 AI、支付）。这条取舍见 [00 总览](00-overview.md)。

## 数据模型（迁移 0002）
```
courses
  id uuid pk
  user_id uuid = auth.uid()        ← 拥有者
  code, name, color, term, instructor
  created_at

materials
  id uuid pk
  user_id uuid = auth.uid()        ← 拥有者
  course_id uuid → courses(id) on delete cascade   ← 归属课程（删课程级联删资料）
  name           原始文件名（展示用）
  type           pdf/ppt/doc/md/html/txt（按扩展名识别）
  size_bytes
  storage_path   文件在存储桶里的路径
  created_at
  index(course_id)
```
两张表都 `enable RLS` + owner-only 策略（见 [03](03-database-and-migrations.md)）。

## 文件存储（Storage）
- 私有桶 `materials`（`public=false`，外部无法直接访问，必须签名 URL）。
- 对象路径约定：**`{user_id}/{随机uuid}.{ext}`**——第一层文件夹是用户 id。
- 存储策略（`storage.objects` 上的 RLS）按「第一层文件夹 = 当前用户」放行：
```sql
create policy materials_obj_select on storage.objects for select to authenticated
  using (bucket_id='materials' and (storage.foldername(name))[1] = auth.uid()::text);
-- insert / delete 同理
```
所以「张三只能读写 `materials/张三id/...` 下的文件」，存储层就隔离了。

## ⚠️ 发现并修复的越权（迁移 0003）
**两用户端到端测试**时发现：B 能插入一条「自己的」materials 行，但 `course_id` 指向 A 的课程 id。
- 为什么能：0002 的 materials 策略 `with check (user_id = auth.uid())` 只校验了**资料的归属**，没校验**被引用的课程是否也属于本人**；外键只检查「课程 id 存在」，不检查归属。
- 影响：B 读不到 A 的课程数据（RLS 仍拦着），但能造出一条指向别人课程的脏数据——不干净、潜在数据完整性问题。
- 修复（0003）：策略追加「课程必须属于本人」：
```sql
with check (
  user_id = auth.uid()
  and exists (select 1 from public.courses c
              where c.id = materials.course_id and c.user_id = auth.uid())
);
```
- 验证：修复后 B 再尝试挂到 A 的课程 → **403 被拒**。
> 教训：**外键不等于权限**。当一张 RLS 表通过外键引用另一张「属于用户」的表时，要在 `with check` 里显式校验被引用行也归本人。

## 前端实现（`apps/web/src/legacy/materials.ts`）
一个**自管容器**的小应用，挂到应用壳给的 `#mat-root`（集成方式见 [01](01-frontend-architecture.md)）。

### 结构
- `initMaterials(supabase, user, toast)`：注入依赖（客户端、当前用户、提示函数）。
- `mountMaterials(el)`：记住容器 → `render()`（先出加载态）→ `load()`。
- 模块内 `state`：`{ loading, error, courses[], materials[], course('all'|课程id) }`。
- `load()`：并发拉 courses + materials（`order created_at`），写入 state，重渲染；出错写 `state.error`（如迁移没应用会显示「出错了」而不是崩）。
- `render()`：用原型同款 class（`.wrap .page-head .mat-row .ftype .chip .card`）拼 HTML 塞进 `#mat-root`；**用户数据逐字段 `esc()` 转义防 XSS**。
- `wire()`：给 `[data-mat]` 元素绑点击；给拖拽区绑 dragover/drop。

### 各功能逻辑
**新建课程** `newCourse()`：弹一个 `.scrim/.modal` 小表单（代码/名称）→ `supabase.from('courses').insert({code,name}).select().single()` → 成功后刷新并切到该课程。`user_id` 由数据库默认填 `auth.uid()`。

**上传** `pickFiles()` → `doUpload(files)`：
- 守卫：没课程先引导建课程；当前选「All」时提示先选具体课程（资料必须落到某课程）。
- 支持**点击选文件**和**拖拽**（拖到虚线区 drop）。
- 每个文件：
  1. 生成路径 `${user.id}/${crypto.randomUUID()}.${ext}`（保证落在自己文件夹、文件名不撞）。
  2. `supabase.storage.from('materials').upload(path, file, {contentType})`。
  3. `supabase.from('materials').insert({course_id, name: 原始名, type, size_bytes, storage_path})`。
  4. **失败回滚**：若入库失败，把刚传的存储对象 `remove([path])` 删掉，避免孤儿文件。
- 全部完成后 `load()` 刷新；用 toast 报进度/结果。

**预览 / 下载** `openMaterial(id, download)`：
- 私有桶不能直链，`createSignedUrl(path, 60[, {download: name}])` 拿 60 秒签名 URL。
- 预览：直接 `window.open` 内联打开；下载：带 `download` 选项触发下载。

**删除** `delMaterial(id)`：`confirm` 后先 `storage.remove([path])` 删文件，再 `from('materials').delete().eq('id', id)` 删记录，最后刷新。

**按课程筛选**：顶部 chips（All + 每个课程）；点了改 `state.course` 重渲染，前端过滤列表（仅体验；安全仍靠 RLS）。

### 与应用壳的集成（3 处）
1. `mountNalanda` 把 `supabase` 和 `user` 透传进来 → `initMaterials(...)`。
2. `VIEWS.materials = () => '<div id="mat-root"></div>'`（覆盖原 mock 视图，只留挂载点）。
3. `go()` 路由钩子：进 `materials` 时 `requestAnimationFrame(() => mountMaterials(#mat-root))`。

## 端到端验证（已做，可复现）
脚本造两个测试用户 A、B，验证：
- A：建课程 ✓、上传到自己文件夹 ✓、入库 ✓、列表 ✓、签名 URL ✓
- B：看不到 A 的课程/资料（表 RLS）✓、打不开 A 的文件（存储 RLS）✓、不能挂到 A 的课程（0003）✓
- 清理：删资料/课程/文件/用户

> 这套「两用户互相验证 RLS」是检验任何 owner-only 模块的标准做法，新模块都该跑一遍。

## 扩展点
- 列表分页 / 搜索 / 排序（数据多了之后）。
- 内嵌预览（PDF.js / Office 转图），而非新开标签。
- 把资料作为 **AI 笔记生成**的输入（下一个大模块）：拿 `storage_path` 让 AI 微服务读取解析。
- 上传大小限制、类型白名单、进度条。
