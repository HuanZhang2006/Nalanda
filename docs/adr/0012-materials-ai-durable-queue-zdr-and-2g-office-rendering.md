# ADR-0012: Materials AI durable queue, OpenRouter ZDR, and 2 GB Office rendering

> **About this document**
> - **Contents**: Records the decision that Materials file-to-test-paper generation uses durable PostgreSQL jobs, BullMQ scheduling, an isolated FastAPI, OpenRouter ZDR, and restricted full LibreOffice rendering.
> - **Purpose**: Fixes the service boundaries for job facts, models/privacy, safe parsing, resource failures, and the Free quota, so Redis, client progress, or temporary files are never treated as authoritative.
> - **When to update**: When the queue/worker topology, parser, model/provider/ZDR, resource limits, quotas/charging, temporary or durable data lifecycle, or release gates change.

- **Status:** Accepted / deployed; 0041–0043 and the immutable app went to production on 2026-08-11, and real providers, the 2 GB canary, the signed-in user smoke, and independent public verification all passed.
- **Date:** 2026-08-10
- **Revision:** 2026-08-11 explicitly enables compliant provider failover for the same fixed model, adds no cross-model fallback, and records the protected production activation.
- **Deciders:** Nalanda owner

## Context

Materials already stores users' private course files, but the historical FastAPI only returned fixed mocks. Phase one only needs "Generate test paper", while requiring deterministic multi-format parsing, visual recovery only for failed regions, prompt-injection rejection, job progress, online exams, a daily free allowance consumed only on success, and strict cleanup and resource isolation on a shared 2 GB server.

Redis may restart or lose queue entries; models may time out, return bad JSON, or have no endpoint that satisfies ZDR; full LibreOffice rendering may approach the host's memory limit. None of these dependencies can therefore be the source of truth for jobs, allowances, or results.

## Decision

1. PostgreSQL stores `generation_jobs/events`, quota reservations, Notes, answer sheets, idempotent operations, and provider usage; BullMQ only stores job UUIDs. A reconciler re-enqueues queued jobs/expired leases missing from the queue, and the same idempotency key never reserves, generates, or saves twice.
2. NestJS derives the user ID from the verified JWT, checks material owner/format/size, creates a short-lived private Storage signed URL, and calls FastAPI only with a separate internal token. All state writes go through service-role-only transaction RPCs; the browser cannot call internal RPCs, decide scores, or supply models/keys.
3. FastAPI first produces a `DocumentIR`. DeepSeek reviews text completeness and injection, and the union of parser-failed and review-failed regions is taken; only those rendered regions go to MiMo. After stitching, safety review runs again, then DeepSeek generates/repairs at most once a strict `GeneratedExamV1`.
4. `deepseek/deepseek-v4-flash-0731` and `xiaomi/mimo-v2.5` are fixed. Every request requires ZDR, deny data collection, and require parameters, disables reasoning/tools/Web, and provides no cross-model `models` fallback; disabling optional reasoning ensures the completion budget goes to strict JSON rather than returning/hiding chain-of-thought. The same fixed model fails over, throughput-first, among provider endpoints that still satisfy every privacy and parameter filter; if no compliant endpoint exists, it fails rather than silently routing to a retaining provider or a different model.
5. Both `malicious` and `uncertain` injection classifications are rejected; `benign_educational` is only for clearly instructional/quoted/security-analysis content. Model classification is not the only boundary; format/resource checks, strict schema, source refs, and product constraints apply before and after.
6. DOCX/PPTX are fully rendered at low priority to keep the ability to recover any failed region; MiMo still only receives failed regions. The production worker has single concurrency, 640 MiB RAM/896 MiB mem+swap, 0.75 CPU, 128 pids, and a 120-second LibreOffice hard timeout; if OOM or impact on neighboring sites occurs, the flag stays off.
7. Each job uses a 0700 temporary directory deleted in `finally` on success, failure, cancellation, and timeout; startup/periodic cleanup removes orphans older than an hour, with a 1 GiB per-job limit and a 512 MiB minimum free space. The private versioned `ai_material_parse_cache` is explicit durable product data and is not mixed into temporary directories.
8. In phase one every user is Free, with 10 successful generations and 10 gradings per Profile local day. Reservations are consumed only on success; failure/rejection/cancellation releases them. The global default is US$20/month, US$0.50 per generation, and US$0.05 per grading; credits, points, VIP, and payments are not used.

## Results and trade-offs

- A Redis failure does not lose jobs/allowances, but recovery may add queue wait; PostgreSQL leases and the reconciler add implementation complexity.
- Visual recovery of failed regions only lowers privacy exposure, cost, and latency; full Office rendering remains a high-risk choice the user accepted for 2 GB, and must be proven by a canary rather than claimed by a config file.
- ZDR/strict schema/double review greatly narrow the risk but cannot guarantee eliminating injection, hallucination, or provider behavior changes; a kill switch, fixed evals, and human issue feedback must be kept.
- Same-model provider failover keeps a single endpoint's 429/5xx from blocking jobs; quantization, latency, and price may still differ across endpoints, so every call stays bound by strict schema, ZDR, parameter filters, and per-job/monthly cost hard gates.
- Owners can see the full answers in their own Notes detail. Hiding the answer key during an exam session only prevents the normal UI from leaking questions early; it is not an anti-cheating security system against the material's owner.

## Verification and release

- CI: Python ruff/pytest, Nest API/real Redis BullMQ, 0041–0043 empty-database/upgrade/lint/two-user RLS, Web jsdom, fake-provider Playwright, AI Docker, and release-script tests.
- Real gate: PDF/DOCX/PPTX/chart/injection/safe lesson/grading with no personal data, verifying failed regions, ZDR, strict JSON, source refs, tokens/cost, and injection rejection without false positives on normal teaching material.
- Resource gate: a near-limit Office fixture records RSS, swap, queue, temporary disk, and neighboring-site health; kernel OOM, neighboring-site failures, or sustained unacceptable swap is a no-go.
- Production: read-only plan → encrypted recovery point → apply 0041–0043 → start Redis/AI/API with `FEATURE_MATERIAL_AI=false` → readiness/cleanup/canary/real providers → turn on the flag → public signed-in user smoke. On app anomalies, restore the immutable release and turn the flag off; the database is only fixed forward.

Actual release evidence: plan `31465816321`; apply/deploy `31467153739`; encrypted recovery artifact `9092230348`; release `e6ce0cb246d9fc1ecc1c4869b6e63d09d3256bd4-31467153739-1`. Earlier real-provider 429s and a false green from remote heredoc stdin were not counted as the launch; the status was changed to deployed only after the final workflow and independent server/public verification agreed.
