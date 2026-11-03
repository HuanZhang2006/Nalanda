# ADR-0014: Materials AI Luna native files, job cleanup, and savable graph layout

> **About this document**
> - **Contents**: Records the architecture decision to add a Luna native-file pipeline to Materials AI, an interruptible delete lifecycle, React Flow + ELK knowledge-graph layout, and unified grading after the whole paper is submitted.
> - **Purpose**: Fixes the boundaries for provider routing, native-file processing, cost auditing, allowance settlement, process-file cleanup, layout persistence, and exam-answer exposure.
> - **When to update**: When the model/provider, native-file capability matrix, job deletion/allowance rules, graph layout engine/storage contract, exam grading timing, or production release status changes.

- **Status:** Accepted / implemented in unreleased code; the 0049–0051 database changes are released. The model and routing in item 2 have been revised by [ADR-0016](0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md) to `openai/gpt-6-luna` + Azure-only ZDR; the original decision text is kept below.
- **Date:** 2026-08-14
- **Deciders:** Nalanda owner
- **Scope:** Materials, My Notes, NestJS AI, FastAPI worker, Supabase, release gates
- **Related:** [ADR-0012](0012-materials-ai-durable-queue-zdr-and-2g-office-rendering.md), [ADR-0013](0013-materials-ai-async-callback-resume-and-knowledge-graph.md)

## Context

0046–0048 decided to solve the five-minute response-header timeout with fast 202s, durable callbacks, and checkpoints, and established the knowledge-graph contract. But the candidate UI's static absolute positioning overlaps, cannot pan/zoom/drag, and does not keep the layout across devices; the queue also lacks auditable Delete/Clear. The online exam returned grading information during the draft stage, leaking answers early.

A new multimodal model can read the native file directly. It avoids the loss local parsers/OCR suffer on complex visual documents, but hands the full file to a third party and creates new boundaries for format support, provider routing, cost, and retries, so it cannot be an unconditional replacement for the old pipeline.

## Decision

1. Keep `document_ir_v1` and add an explicit `luna_native_file_v1`. The Web app must send the pipeline; capabilities return availability by file extension and real server-side gates, with automatic downgrade or conversion forbidden.
2. Luna is fixed to `openai/gpt-5.6-luna`, with routing fixed to OpenAI-only, no fallback, ZDR, deny data collection, require parameters, strict schema, and no tools/Web. If the actual upstream is not OpenAI, usage is still recorded but the artifact fails as a routing violation.
3. Luna downloads from private Storage, checks MIME, size, and SHA-256, and sends only inline base64; PDFs use the native parser and images use image input. No local extraction/OCR/LibreOffice/DocumentIR/parse cache may run, and the OpenRouter Files API must not be used.
4. Luna checkpoints only store the safety review or validated artifacts, never the prompt/source file content. The source file's source of truth stays in private Storage; success, failure, cancellation, deletion, and TTL all run local cleanup.
5. Delete/compatible Cancel first locks the job and settles the allowance atomically: queued releases the reservation, and once the worker has accepted it consumes one run. It then enters `deleting`; the job is hard-deleted only after the worker confirms it cancelled HTTPX/Office, blocked terminal callbacks, flushed usage, and purged the checkpoint/spool/0700 directory. Clear only handles terminal jobs, does not delete Notes, and does not roll back allowances or usage.
6. Provider usage does not cascade through the job FK; after a job is hard-deleted, the redacted cost and actual provider/endpoint/pipeline audit are kept. Replaying the same event UUID must not duplicate cost.
7. The knowledge graph loads React Flow + ELK dynamically. The initial layout runs left to right by level, ordered by sourceOrder within a level, with collision resolution after layout and after dragging; pan/zoom, node dragging, fit, auto-arrange, and keyboard movement are supported.
8. Nodes only show their type and title; hover/keyboard focus shows details in a temporary inspector outside the canvas, click pins it and opens node Q&A, and Escape cancels. On mobile the inspector sits below the canvas instead of a floating layer that covers nodes.
9. Coordinates and the viewport are saved per user/note/artifact SHA-256/revision. When the content changes, only positions of node IDs that still exist are reused and the rest are laid out again; on a revision conflict the client merges the current facts and retries, and clients cannot write the table directly.
10. Exam selections and input are saved as drafts only; `in_progress` responses must have `results=[]`. After the user confirms Submit or the deadline passes, the server grades every objective question in one transaction and then merges the subjective questions into one AI grading run; answers, explanations, and correctness are never returned before submission.

## Consequences

### Positive

- The native-file and DocumentIR capabilities are each verifiable and reversible, and "the model claims file support" is never mistaken for every format being usable.
- Job deletion, external cost, and temporary data form an auditable closed loop, and users never see ghost jobs that are hidden but still running.
- Large graphs are operable with a clear hierarchy, layouts are restorable across devices, and details no longer cover nodes.
- Drafts do not leak answers, and automatic expiry and manual submission use the same authoritative grading path.

### Negative and risks

- Luna receives the full native file, a wider third-party processing scope than failed-region visual recovery; it needs separate consent, a privacy review, and a kill switch.
- Two pipelines, persistent layouts, and the deleting reconciler add migration, testing, monitoring, and operational complexity.
- ELK auto-layout cannot prove the graph is semantically correct; 250-node interaction tests and real model quality gates must be kept separate.
- Actively deleting after acceptance still consumes a free run; this is a product trade-off against cost evasion, and the UI must state it clearly before confirmation.

## Gap between current implementation and target

- **Current candidate:** The shared contract, 0049–0051, Nest/API/worker, React Flow + ELK, Delete/Clear, whole-paper grading, fakes/unit tests, and real gate scripts are on a repository candidate branch.
- **Production database:** 0049–0051 were applied and verified by run `31824832947` on 2026-08-14; the app candidate in the same run rolled back automatically because Luna/OpenAI had no ZDR endpoint, the old app was restored, and the sub-switch was not enabled.
- **Operating decision:** The release gate reads the official ZDR endpoint catalog; without first-party OpenAI, DocumentIR and the graph/job/exam fixes can still ship, but the Luna capability must return `OPENROUTER_ZDR_UNAVAILABLE`. This is not a pipeline fallback; users still explicitly choose the actually available DocumentIR.
- **Target:** Full CI proves empty-database/upgrade/RLS/Redis/Playwright/Docker, and a protected release is then completed with real per-format OpenAI verification, the 2 GB canary, a signed-in user smoke, and independent public checks.

## Verification and review

- Unit/jsdom tests cover 250 nodes, no overlap, cycles/isolated nodes, drag/keyboard/viewport, revision merge, Delete/Clear confirmation, and pure drafts.
- API/RLS covers two users, v2 RPC default-deny, queued/processing/delete races, usage retention, and layout owner/version/revision; the worker covers raw bytes, the parser ban, the routing lock, checkpoints, and cancel/purge at each stage.
- Playwright uses a fake provider and only proves browser/API/Supabase/Redis orchestration; the real gate must independently prove the actual OpenAI upstream, PDF native input, the raw SHA, strict schema, injection rejection, disabling of unsupported formats, and zero local residue.
- On anomalies, first turn off `FEATURE_MATERIAL_AI_LUNA`, and if needed the Materials AI master switch, and restore the previous immutable app; the database is only fixed forward.
