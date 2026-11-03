# ADR-0013: Materials AI async callbacks, two-level checkpoints, and the knowledge graph

> **About this document**
> - **Contents**: Records the decision to move Materials AI from long-lived internal HTTP to fast acceptance with durable callbacks, two-level checkpoints in the database and the worker's local disk, and the knowledge-graph and node Q&A contracts.
> - **Purpose**: Fixes the safety boundaries for long jobs, cost auditing, resumable execution, temporary files, knowledge-graph rendering, and node questions, so we never again depend on a single HTTP response lasting more than five minutes.
> - **When to update**: When the internal job protocol, lease/TTL, checkpoint location, provider usage, graph schema/layout, node Q&A allowance, or temporary-data lifecycle changes.

- **Status:** Accepted / implemented in unreleased code; production is still at 0043, and 0046–0048 plus the new app must complete a protected release before this can change to deployed.
- **Date:** 2026-08-12
- **Deciders:** Nalanda owner

## Context

In 0041–0043, the API waits for FastAPI to finish the whole file. One real job exceeded about 300 seconds after MiMo visual recovery, and Node 20's built-in Undici hit its default headers timeout before the worker returned response headers; the 20-minute `AbortSignal` set in code did not cover that transport timeout, and the error was misreported as worker unreachable. The broken connection also meant provider usage that had already happened could not enter the ledger.

Meanwhile, knowledge-point organization needs to turn a whole material into a graph in source order that can be rendered directly and where every node can be questioned in depth, rather than reusing historical demo data or the test-paper schema.

## Decision

1. NestJS uses an explicit Undici `Agent` with separate connect, headers, and body timeouts, and keeps the stable `AI_WORKER_TIMEOUT` and `AI_WORKER_UNREACHABLE`. Compatible synchronous routes remain during the observation window, but production jobs only submit to `/internal/materials/jobs` and `/internal/exams/jobs` and get a 202 within 30 seconds.
2. PostgreSQL remains the only server-side source of truth for job, quota, lease, progress, result, and usage. FastAPI calls back progress, usage, checkpoints, and complete/fail with the internal token; every usage event has a UUID and repeated replays are counted once.
3. Database checkpoints store `parsed → audited → document_ready → artifact_ready/answer_ready`, for 24 hours by default. Recoverable errors release the original reservation; when the user resumes the same job within the window, the allowance is reserved again and execution continues from the last validated stage without creating a replacement job. Only success consumes.
4. The worker also keeps a short-lived `resume-checkpoint.json` and a usage spool in the same 0700 job directory. It writes the local result first and then calls the API; if the callback is interrupted, the files are kept, and the next lease prefers the higher stage. Terminal states delete them immediately, and orphans past their TTL are removed by a sweeper. This is rebuildable process data and is not backed up.
5. Usage after a provider call goes to the local spool first and must be flushed before the completion or failure callback. Validated subjective-grading results are stored both locally on the worker and in a private DB TTL checkpoint, so a broken callback or container replacement does not pay for grading again.
6. The knowledge graph uses `GeneratedKnowledgeGraphV1`: 1–250 detailed nodes ordered by `sourceOrder`, 0–1000 typed edges, strict source refs, and explanations/examples/formulas/misconceptions/self-checks. The graph is saved in the My Notes entry for the Materials file; the old demo plays no part in real results.
7. BullMQ's single concurrency slot must be held until Postgres shows a terminal job state or the lease expires; FastAPI's fast 202 must not be mistaken for job completion, or the backlog would wait in process memory and exhaust leases early. Generation and grading have total execution budgets of 1200/240 seconds respectively; an exhausted generation budget is a recoverable error.
8. Node Q&A only receives the server-read node, its neighbors, and the source blocks those nodes cite together; the user's question is untrusted data and cannot change the model, tools, schema, or safety policy. Answers may only cite that union of sources. Each successful answer counts toward the same daily Free generation allowance.
9. In this phase, Materials and My Notes keep the existing English visuals and copy and do not inject Chinese strings for the global Chinese locale; this is not used as a reason for a larger React/visual rewrite.

## Results and trade-offs

- Internal HTTP no longer carries a 20-minute business lifecycle, and the five-minute response-header timeout no longer kills normal generation.
- Two-level checkpoints allow cross-worker recovery when database callbacks work, and keep already-paid results when the API is briefly unreachable; the cost is that the temporary directory briefly holds private DocumentIR/artifacts within the TTL, so 0700 permissions, disk watermarks, and cleanup alerts must be maintained.
- Checkpoints only store stage results that passed the current schema/safety validation. Version incompatibility, an expired window, non-retryable errors, or a safety rejection clean up and require a new job.
- The first graph layout uses source order and hierarchical placement for readability and determinism; automatic layout, cross-material merging, and general RAG are outside this decision.

## Verification and release

- Python covers fast 202 acceptance, total execution timeouts, callback outages, usage/result replay, lease changes, short-TTL cleanup, partial visual recovery, graph validation, and neighbor-source node Q&A; the API covers Undici error classification, cost/callbacks, queue slot holding, and retry; jsdom covers the English menu, Resume, and graph hover/click/Q&A.
- 0046–0048 must pass 0007→latest, an empty-database rebuild, lint, and two-user RLS: clients cannot execute internal RPCs, read checkpoints, or write Q&A, repeated usage is not billed twice, and expired retries really clean up.
- Fake Playwright covers file → test paper → grading → graph → node Q&A → delete; a real gate separately verifies the fixed DeepSeek/MiMo, ZDR, source order, usage ledger, and the public signed-in user path.
- Release still follows: start with flags off, read-only plan, encrypted recovery point, migration apply, resource canary, real providers, turn on flags, and an independent public smoke test; the database is only fixed forward, and the app rolls back to an immutable release.

> **Note (later change):** Decision 9 has since been reversed: Materials and My Notes now follow the global English/Chinese locale like the rest of the app.
