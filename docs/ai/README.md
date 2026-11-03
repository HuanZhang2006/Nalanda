# AI Governance Documentation Index

> **About this document**
> - **Contents**: Collects Nalanda's documents on AI contracts, quality, safety, evaluation, cost, and release governance.
> - **Purpose**: Turns model capability from a prototype demo into a measurable, regression-tested, cost-controlled product capability, and prevents configuration or stubs from being reported as real AI.
> - **When to update**: When an AI document is added, the model/parsing/evaluation/provider/cost setup changes, or an indexed path changes.
> - **Status baseline**: 2026-10-03; the production database is at 0055 and the current stable application keeps serving the capabilities already switched over. In main run `32931681321`, the real DocumentIR DOCX gate found five classes of semantic defects after the structural repair and rolled back automatically. The current Unreleased `exam-generate.v4` makes the repair carry the full source and adds one bounded fix only for semantic problems newly found after the structural pass; 0056–0057 retire Ox Alpha, switch Luna to GPT-6 Luna + Azure ZDR, and move Courses translation judging to the free Nemotron. Code, CI, database, candidate-gate, and production-cutover evidence must still be recorded separately. AI file import for Courses is still not implemented.

- [AI evaluation and cost governance](EVALUATION_AND_COST.md): Production Materials test papers, the candidate graph/Q&A/recovery chain, future Courses file import, Azure Speech boundaries, offline/online quality, safety and privacy, usage/cost, budgets, and release gates.
- [Unified AI prompt catalog](PROMPT_CATALOG.md): The single human-maintained entry point for prompts across the project, including the complete production Materials/Courses system/user templates, dynamic fields, schemas, non-prompt speech-provider inputs, test gates, and unimplemented boundaries.

Any real AI launch must also satisfy the billing, privacy deletion, content moderation, security, and third-party license requirements.
