# ADR-0015: Ox Alpha translation judging and a native-image Materials pipeline

> **About this document**
> - **Contents**: Records the architecture decision to switch the Courses non-literal translation model to Ox Alpha and add a third Ox Alpha native-image pipeline to Materials AI.
> - **Purpose**: Fixes the model, provider, reasoning, capability matrix, ZDR, privacy, completion transactions, and release gates, so text availability is never misrepresented as native-file capability.
> - **When to update**: When Ox Alpha's model identity/capabilities/price, Stealth routing, reasoning, ZDR catalog, allowed formats, translation data boundary, or production release status changes.

- **Status:** Superseded by [ADR-0016](0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md) (2026-10-03); 0054–0055 were applied to the production database but the app never enabled Ox, and 0056–0057 retire it completely. The text below is the original historical decision.
- **Date:** 2026-08-23
- **Deciders:** Nalanda owner
- **Scope:** Courses, Materials, My Notes, NestJS, FastAPI, Supabase, release gates
- **Related:** [ADR-0009](0009-server-side-semantic-spelling-translation-assessment.md), [ADR-0014](0014-materials-ai-luna-native-lifecycle-and-graph-layout.md)

## Context

Courses non-literal translation judging originally used the free Gemma 4 model, and recent protected candidates repeatedly hit sustained HTTP 429s in real smoke tests and rolled back before cutover. The user explicitly decided to switch to OpenRouter `stealth/ox-alpha` and asked Materials AI to add a multimodal path on the same model alongside the existing DocumentIR and Luna.

Live model metadata declares that Ox Alpha accepts text/image/video but has no file modality; the endpoint's provider is Stealth. The live ZDR catalog currently has no endpoint for this model. The model also requires reasoning, so Luna's reasoning-disabled envelope cannot be reused. "Text translation is callable" and "ZDR native-file processing can be opened" must therefore be two independent gates.

## Decision

1. Courses non-literal translation is fixed to `stealth/ox-alpha`. Requests force `provider.only=["stealth"]`, `allow_fallbacks=false`, `data_collection=deny`, strict `{correct:boolean}`, and no tools, and use `{effort:"low",exclude:true}` reasoning. Clients cannot choose the model, provider, prompt, or reference translations.
2. Normalized exact matches are still judged correct deterministically by NestJS at zero tokens; Ox only judges non-literal synonyms/paraphrases. Provider results cannot directly grant points or badges or change progress.
3. Materials adds an explicit `ox_alpha_native_file_v1`, reusing Luna's raw-byte download validation, safety review, generation, single repair, checkpoints, cancellation, and cleanup orchestration, but fixed to Ox Alpha/Stealth.
4. The Ox Materials pipeline only accepts native PNG, JPG/JPEG, and WebP images. Both the API and worker intersect the ops allowlist with the in-code image set; PDF, Office, Markdown/HTML/TXT/JSON/CSV are never converted or extracted to pose as native files, and never silently downgraded.
5. Materials Ox still requires ZDR, deny collection, strict schema, no tools/Web, and no fallback. When the live catalog has no compliant endpoint, `FEATURE_MATERIAL_AI_OX_ALPHA=false` and the capability returns `OPENROUTER_ZDR_UNAVAILABLE`; a Courses text smoke cannot substitute for this.
6. `ai_provider_usage_events` records the actual provider/endpoint/pipeline; the service-role transactions that complete test papers, graphs, node Q&A, and subjective grading require Stealth usage for the matching purpose. Costs already incurred by routing violations are kept, but the artifact must not be saved.
7. 0054–0055 only add pipeline constraints, workflow mappings, completion constraints, and permission verification; the old RPC signatures and DocumentIR/Luna behavior stay compatible with the previous immutable app. Database rollback is forward-fix only.

## Consequences

### Positive

- Removes the release hard gate of sustained rate limiting on the free Gemma route while keeping server authority and idempotent quota boundaries.
- Materials gets a third truly explicit, auditable multimodal image path without stretching a model marketing label into unproven file-format support.
- Provider, reasoning, ZDR, and completion transactions form two layers of fail-closed checks; fake tests cannot pose as real Stealth/ZDR evidence.

### Risks and costs

- The "Stealth" provider and the model's identity, price, or availability may change; even though the current catalog price is zero, it cannot be promised to stay free.
- Ox native images are expected to stay off because there is no ZDR endpoint; code being complete does not mean the product is available.
- Three pipelines add complexity to the UI, environment variables, migrations, RLS, real provider gates, and monitoring.
- Mandatory reasoning adds latency/tokens; this release uses low effort and excludes the output, but real latency and quality baselines are still needed.

## Verification and release

- Unit/API/jsdom tests verify capability/default, native image bytes, non-image rejection, Stealth-only, reasoning, schema, injection, checkpoints, and translation judging.
- Local Supabase two-user E2E verifies that clients cannot create/complete Ox jobs or forge provider usage, and that service-role completion succeeds only with matching Stealth usage.
- The real text gate uses a fixed pair of synonym/unrelated samples; the Materials gate first reads the live ZDR catalog, and only when compliant uses an image with no personal data to verify the actual Stealth provider, raw SHA-256, injection rejection, and zero residue.
- Production follows a read-only 0054–0055 plan, encrypted recovery point, apply, immutable candidate, real gates, private smoke, cutover, and independent public verification. Any hard-gate failure keeps the Ox Materials flag off and restores the previous app release.

## 2026-08-25 output-contract revision

PR #77 applied 0054–0055 to the production database, but the candidate app's Courses translation gate received HTTP 404 and rolled back automatically, because the Ox Alpha endpoint does not declare `structured_outputs` while the request used strict `json_schema` + `require_parameters=true`. PR #78 implemented the decision with `response_format:{type:"json_object"}`, which the endpoint explicitly declares; the system prompt fixes the single object shape, and NestJS and the real release smoke locally and strictly check the field set, boolean type, case IDs/count, and expected semantics. Its main candidate was stopped by the separate DocumentIR DOCX quality gate before the Ox smoke ran, so this contract has no real production calls or cutover evidence yet. Stealth-only, no fallback, data collection deny, actual provider checks, server-side idempotent facts, and fail-closed behavior are unchanged. Provider HTTP errors only log stable status/code/request ID, never bodies or user content.
