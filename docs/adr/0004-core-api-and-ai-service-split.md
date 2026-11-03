# ADR-0004: Separate the NestJS core API from the FastAPI AI service

> **About this document**
> - **Contents**: Records the decision to split core business logic and document parsing/model generation into a Node service and a Python service.
> - **Purpose**: Defines service responsibilities, trust boundaries, and the target shape of asynchronous AI orchestration, and prevents browsers from calling the model service directly.
> - **When to update**: When the AI runtime, queue, inter-service contract, model providers, or deployment boundary change; if the services are merged, create a superseding ADR.
> - **Implementation note**: Production 0041–0043 implemented Materials AI per this ADR; on 2026-08-11 it passed real providers, a resource canary, a protected release, and a signed-in user smoke test.

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Project maintainer
- **Scope:** NestJS, FastAPI, future Redis/BullMQ, model providers

## Context

Core business logic needs TypeScript to share contracts with the frontend; courseware parsing, OCR, RAG, and model evaluation fit the Python ecosystem better. AI jobs are slow, failure-prone, and expensive, so they should not occupy synchronous web requests or expose provider keys.

## Decision

- NestJS is the external business API and the orchestrator of authorization, billing, and idempotency.
- FastAPI is an internal AI execution service that accepts only authorized, minimal inputs; it must never be called from the public internet or the browser.
- The general target flow is: the API validates the material and request → reserves quota or a future credits hold → creates a durable job/queue entry → AI parses/generates → schema/quality validation → atomic persistence → consume/commit or release → notify the user. The first Materials version uses only the daily Free quota and never reads credits.
- Cross-service contracts must have versions, runtime schemas, request/result IDs, timeouts, cancellation, and retry semantics; repeated execution must not double-charge or create untraceable duplicates.
- Model providers are replaceable; business tables never use a provider's model or prompt-specific fields as core identifiers.

## Consequences

We gain the Python AI ecosystem and independent scaling, but take on network failures, contract drift, queue operations, distributed tracing, and cost reconciliation. Synchronous HTTP endpoints may be used for controlled internal unit operations, but must not be mistaken for a complete, reliable, billed user flow.

## Gap between current implementation and target

- **Production implementation:** 0041–0043 added NestJS authentication/quota/idempotency orchestration, durable Postgres jobs, a BullMQ UUID queue, an internal token, FastAPI DocumentIR/safety review/targeted visual recovery/generation, a usage ledger, cancellation, and atomic Notes persistence; the old fixed stubs were removed.
- **Release facts:** Real DeepSeek/MiMo ZDR, a near-limit 2 GB resource canary, full CI, a protected migration, and a signed-in user generate/grade/delete smoke test all passed on 2026-08-11; a one-off gate does not replace continuous quality and cost monitoring.
- **Next targets:** Courses import, RAG, credit sales/payments, more AI artifacts, and a general admin back office continue under [AI evaluation and cost governance](../ai/EVALUATION_AND_COST.md) and the [unified rules](../product/POINTS_CREDITS_VIP_PAYMENTS.md).

## Verification and review

Contract tests cover TS/Python shapes; fault injection covers timeouts, duplicates, reordering, service restarts, and models returning bad JSON; usage, credits, and results are reconciled per job. Review this decision if the model/parsing runtime no longer needs independent scaling.
