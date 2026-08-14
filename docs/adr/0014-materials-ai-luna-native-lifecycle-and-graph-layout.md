# ADR-0014：Materials AI Luna 原文件、任务清理与可保存图布局

> **本文内容：**记录 Materials AI 引入 Luna 原文件流水线、可中断删除生命周期、React Flow + ELK 知识图布局，以及整卷交卷后统一批改的架构决定。
> **作用：**固定供应商路由、原文件处理、费用审计、额度结算、过程文件清理、布局持久化和考试答案暴露边界。
> **何时更新：**模型/provider、原文件能力矩阵、任务删除/额度规则、图布局引擎/存储契约、考试批改时机或生产发布状态变化时。

- **状态：**Accepted / implemented in unreleased code；0049–0051 尚未完成受保护发布
- **日期：**2026-08-14
- **决策者：**Nalanda owner
- **范围：**Materials、My Notes、NestJS AI、FastAPI worker、Supabase、发布门禁
- **关联：**[ADR-0012](0012-materials-ai-durable-queue-zdr-and-2g-office-rendering.md)、[ADR-0013](0013-materials-ai-async-callback-resume-and-knowledge-graph.md)

## 背景

0046–0048 已决定用快速 202、持久 callback 和 checkpoint 解决五分钟响应头 timeout，并建立知识图谱契约。但候选 UI 的静态绝对定位会重叠，无法 pan/zoom/拖动或跨设备保留布局；队列也缺少可审计的 Delete/Clear。在线考试在草稿阶段返回批改信息，会提前泄露答案。

新的多模态模型允许直接读取原文件。它可以避开本地 parser/OCR 对复杂视觉文档的损失，但会把完整文件交给第三方，也产生格式支持、provider 路由、成本与重试的新边界，不能作为旧流水线的无条件替代。

## 决策

1. 保留 `document_ir_v1`，新增显式 `luna_native_file_v1`。Web 必须发送 pipeline；capabilities 按文件扩展名和服务端真实门禁返回可用性，禁止自动降级或转换。
2. Luna 固定 `openai/gpt-5.6-luna`，路由固定 OpenAI-only、no fallback、ZDR、拒绝数据收集、require parameters、strict schema、no tools/Web。实际 upstream 不是 OpenAI 时，usage 仍落账但产物失败为路由违规。
3. Luna 从 private Storage 下载并核对 MIME、大小和 SHA-256，只以内联 base64 发送；PDF 使用 native parser，图片使用 image input。不得运行本地提取/OCR/LibreOffice/DocumentIR/parse cache，也不得使用 OpenRouter Files API。
4. Luna checkpoint 只保存安全审查或已验证 artifact，不保存 prompt/源文件正文。源文件仍以 private Storage 为事实源；成功、失败、取消、删除和 TTL 都执行本地清理。
5. Delete/兼容 Cancel 先锁 job 并原子结算额度：queued 释放 reservation，worker accepted 后消费一次。随后进入 `deleting`；只有 worker 确认取消 HTTPX/Office、阻止 terminal callback、flush usage 并 purge checkpoint/spool/0700 目录后才硬删。Clear 只处理 terminal，不删 Notes，不回退额度或 usage。
6. provider usage 不通过 job FK 级联，任务硬删后继续保留脱敏成本与实际 provider/endpoint/pipeline 审计。相同 event UUID 重放不得重复成本。
7. 知识图动态加载 React Flow + ELK。初始布局按 level 左到右、sourceOrder 同层排序，布局和拖动后都做碰撞消解；支持 pan/zoom、节点拖动、fit、自动整理和键盘移动。
8. 节点只显示类型和标题；hover/键盘聚焦在画布外临时 inspector 显示详情，click 固定并开放 node Q&A，Escape 取消。移动端 inspector 在画布下方，不用遮挡节点的浮层。
9. 坐标和 viewport 按 user/note/artifact SHA-256/revision 保存。内容变化时只复用仍存在 node ID 的位置，其余重新布局；revision 冲突由客户端合并当前事实后重试，客户端不能直接写表。
10. 考试选择和输入只保存草稿；`in_progress` 响应必须 `results=[]`。用户确认 Submit 或 deadline 到期后，服务端一次事务批改全部客观题，再把主观题合并为一次 AI 评分；交卷前不返回答案、解析或正确性。

## 后果

### 正面

- 原文件和 DocumentIR 两条能力各自可验证、可回退，不把“模型声明支持文件”误作所有格式可用。
- task 删除、外部成本和临时数据之间形成可审计闭环，用户不会看到已经隐藏但仍运行的幽灵任务。
- 大图可操作、层次清楚、布局可跨设备恢复，详情不再覆盖节点。
- 草稿不泄露答案，自动到期与手工交卷使用同一权威评分路径。

### 负面与风险

- Luna 会接收完整原文件，第三方处理范围大于失败区域视觉补全；必须单独同意、隐私复核与 kill switch。
- 双 pipeline、持久布局和 deleting reconciler 增加迁移、测试、监控和运维复杂度。
- ELK 自动布局不能证明图谱语义正确；250 节点交互测试与真实模型质量门必须分开。
- accepted 后的主动删除仍消费免费次数，这是防成本规避的产品取舍，UI 必须在确认前明确说明。

## 当前实现与目标差距

- **当前候选：**共享契约、0049–0051、Nest/API/worker、React Flow + ELK、Delete/Clear、整卷批改、fake/单元与真实 gate 脚本已进入仓库候选分支。
- **生产：**仍到 0043；Luna 子开关未启用，PDF/PNG 之外的格式也不得声称支持。
- **目标：**完整 CI 证明空库/升级/RLS/Redis/Playwright/Docker，再以真实 OpenAI 逐格式验证、2G canary、登录用户 smoke 和独立公网检查完成受保护发布。

## 验证与复审

- 单元/jsdom 覆盖 250 节点、无重叠、循环/孤立、拖动/键盘/viewport、revision merge、Delete/Clear 确认与纯草稿。
- API/RLS 覆盖双用户、v2 RPC default-deny、queued/processing/delete 竞态、usage 保留、layout owner/version/revision；worker 覆盖原字节、禁止 parser、路由锁、checkpoint 与各阶段 cancel/purge。
- Playwright 使用 fake provider，只证明浏览器/API/Supabase/Redis 编排；真实门禁必须独立证明实际 OpenAI upstream、PDF native、原始 SHA、严格 schema、注入拒绝、不支持格式禁用和零本地残留。
- 异常先关闭 `FEATURE_MATERIAL_AI_LUNA`，必要时关闭 Materials AI 总开关并恢复上一不可变应用；数据库只向前修复。
