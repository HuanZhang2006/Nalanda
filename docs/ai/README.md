# AI 治理文档索引

> **本文内容：**汇总 Nalanda 的 AI 契约、质量、安全、评测、成本和发布治理文档。  
> **作用：**把模型能力从原型演示提升为可衡量、可回归、可控成本的产品能力，并避免把配置或桩误报为真实 AI。  
> **何时更新：**新增 AI 文档、模型/解析/评测/供应商/成本体系变化，或索引路径变化时。  
> **状态基线：**2026-08-26；生产数据库已到 0055，当前稳定应用继续提供此前已切流能力。PR #78 已合并 Courses Ox Alpha JSON Object 修复，但 main run `32931681321` 的真实 DocumentIR DOCX 门禁在结构 repair 后发现五类语义缺陷并自动回滚；Luna/Ox Materials 因 ZDR 不可用保持关闭。当前 Unreleased `exam-generate.v4` 让 repair 携带完整来源，并只为结构后新发现的语义问题增加一次有界修复。代码、CI、数据库、候选门和生产切流证据仍必须分别记录。Courses 文件 AI 导入仍未实现。

- [AI 评测与成本治理](EVALUATION_AND_COST.md)：生产 Materials 试卷、候选 graph/Q&A/恢复链、Courses 后续文件导入、Azure Speech 边界、离线/在线质量、安全隐私、usage/cost、预算与发布门禁。
- [AI Prompt 统一目录](PROMPT_CATALOG.md)：全项目唯一的 prompt 人工维护入口，包含生产 Materials/Courses 的完整 system/user 模板、动态字段、schema、语音供应商非 prompt 输入、测试门禁和未实现边界。

任何真实 AI 上线还必须同时满足经济计费、隐私删除、内容审核、安全和第三方许可证要求。
