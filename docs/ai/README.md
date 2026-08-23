# AI 治理文档索引

> **本文内容：**汇总 Nalanda 的 AI 契约、质量、安全、评测、成本和发布治理文档。  
> **作用：**把模型能力从原型演示提升为可衡量、可回归、可控成本的产品能力，并避免把配置或桩误报为真实 AI。  
> **何时更新：**新增 AI 文档、模型/解析/评测/供应商/成本体系变化，或索引路径变化时。  
> **状态基线：**2026-08-23；生产数据库已到 0053，当前稳定应用继续提供 0041–0043 Materials 试卷生成与主观题评分。0046–0051 对应候选新增 202 callback、checkpoint/usage、知识图、任务清理、布局与 Luna 原文件；0054–0055 候选再增加 Ox Alpha 原图第三流水线，并把 Courses 非字面翻译从 Gemma 改为 Ox Alpha。PR #75 仍在切流前回退，新的代码、CI、数据库和生产发布证据必须分别补齐。Courses 文件 AI 导入仍未实现。

- [AI 评测与成本治理](EVALUATION_AND_COST.md)：生产 Materials 试卷、候选 graph/Q&A/恢复链、Courses 后续文件导入、Azure Speech 边界、离线/在线质量、安全隐私、usage/cost、预算与发布门禁。
- [AI Prompt 统一目录](PROMPT_CATALOG.md)：全项目唯一的 prompt 人工维护入口，包含生产 Materials/Courses 的完整 system/user 模板、动态字段、schema、语音供应商非 prompt 输入、测试门禁和未实现边界。

任何真实 AI 上线还必须同时满足经济计费、隐私删除、内容审核、安全和第三方许可证要求。
