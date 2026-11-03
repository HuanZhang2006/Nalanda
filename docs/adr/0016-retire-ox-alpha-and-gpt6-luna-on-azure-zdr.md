# ADR-0016: Retire Ox Alpha, upgrade Luna to GPT-6 Luna (Azure ZDR), and move translation judging to the free Nemotron

> **About this document**
> - **Contents**: Records the architecture decision to remove every use of Ox Alpha, upgrade the Materials Luna native-file pipeline to `openai/gpt-6-luna` locked to the Azure ZDR upstream, and move Courses non-literal translation judging to OpenRouter's free Nemotron.
> - **Purpose**: Fixes the model, provider, ZDR, database completion constraints, and release gates; supersedes ADR-0015 and revises ADR-0014's OpenAI-only routing.
> - **When to update**: When GPT-6 Luna's ZDR endpoint/provider, the availability or data policy of the free translation model, or the 0056–0057 release status changes.

- **Status:** Accepted / implemented in unreleased code; 0056–0057 have not completed a protected release yet
- **Date:** 2026-10-03
- **Deciders:** Nalanda owner
- **Scope:** Courses, Materials, My Notes, NestJS, FastAPI, Supabase, release gates
- **Related:** [ADR-0009](0009-server-side-semantic-spelling-translation-assessment.md), [ADR-0014](0014-materials-ai-luna-native-lifecycle-and-graph-layout.md), supersedes [ADR-0015](0015-ox-alpha-translation-and-native-image-pipeline.md)

## Context

- Ox Alpha (`stealth/ox-alpha`) has been removed from OpenRouter's live model catalog and was never enabled in production during 0054–0055 (Materials had no ZDR endpoint; Courses translation rolled back on an output-contract HTTP 404). The production database contains no `ox_alpha_native_file_v1` job, Note, or usage rows.
- ADR-0014 fixed Luna to `openai/gpt-5.6-luna` + `provider.only=["openai"]` + ZDR. The live ZDR catalog never contained a first-party OpenAI endpoint, so Luna had to stay off at every release.
- Live catalog as of 2026-10-03: `openai/gpt-6-luna` accepts file/image/text and supports structured outputs and reasoning; its only ZDR endpoints are Azure (`azure`, `azure/us`, `azure/eu`), and the OpenAI first-party endpoint is still not in the ZDR catalog.
- Courses translation judging needs a model to replace Ox Alpha. The owner decided to use an OpenRouter free model.

## Decision

1. **Remove Ox Alpha completely.** `ox_alpha_native_file_v1`/`stealth/ox-alpha` no longer appear in code, types, UI, environment variables, release gates, or smoke tests. 0056 narrows the three pipeline constraints and every service-role RPC back to `document_ir_v1`/`luna_native_file_v1`; the old `FEATURE_MATERIAL_AI_OX_ALPHA*` keys are stripped during install/activation/rollback instead of being written.
2. **Luna is fixed to `openai/gpt-6-luna` on Azure.** The worker requests `provider.only=["azure"]`, `allow_fallbacks=false`, ZDR, deny data collection, require parameters, strict schema, reasoning off, and no tools/Web; usage normalizes the upstream to `Azure`. 0056's completion RPC requires Luna's safety/generation/question/grading usage to all be the same model with `upstream_provider='Azure'`; a first-party `OpenAI` upstream is treated as a routing violation (cost kept, artifact rejected).
3. **The native-file boundary is unchanged.** PDFs still go inline as `type:file` + `file-parser.native` and images inline as `image_url`; no parser/OCR/LibreOffice/DocumentIR/parse cache runs and the Files API is not used; the format allowlist still defaults to `pdf,png`.
4. **Release gates read Azure.** The real provider gate reads the ZDR catalog and only runs the Luna native-file fixture and allows `FEATURE_MATERIAL_AI_LUNA=true` when `openai/gpt-6-luna` + `provider_name=Azure` exists; otherwise it stays off and returns `OPENROUTER_ZDR_UNAVAILABLE`. The DocumentIR release and the Luna switch are independent.
5. **Translation judging moves to `nvidia/nemotron-3-super-120b-a12b:free`.** Requests lock `provider.only=["nvidia"]`, `allow_fallbacks=false`, `require_parameters=true`, JSON Object + local strict `{correct:boolean}` validation, `reasoning.enabled=false`, and no tools; the response provider must be Nvidia. Deterministic exact matching, server authority, idempotent quotas, and not persisting raw answers stay as in ADR-0009.
6. **Translation requests no longer declare `data_collection=deny`.** The free endpoint may log prompts; requests contain only the English term, reference translations, and the learner's answer, with no account identifiers. If the owner needs to refuse data collection, a paid model must be used and this ADR updated.
7. 0056–0057 only replace function bodies and constraints without changing RPC signatures, staying compatible with the previous immutable app; database rollback is still forward-fix only.

## Consequences

### Positive

- Luna has a genuinely usable endpoint for the first time while keeping ZDR; GPT-6 Luna costs about half as much as GPT-5.6 Luna.
- Removing a retired model and an entire never-enabled pipeline shrinks flags, gates, and monitoring surface.
- Translation judging costs zero tokens and uses a single endpoint that declares structured outputs.

### Risks and costs

- Azure is the only Luna ZDR upstream; if it disappears or stops declaring ZDR, Luna stays off automatically and DocumentIR is unaffected.
- PDF native-file input on Azure hosting must be proven by the real gate; a gate failure blocks the whole app release and rolls back automatically, requiring `MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS` to be narrowed or a fix before retrying.
- The free model may be rate-limited, retired, or change its data policy; sustained 429s make the translation pre-test return "busy", and a failed release smoke blocks cutover.
- The free endpoint's data policy is weaker than the deny-collection the earlier Ox requests declared.

## Verification and release

- Python/API/jsdom unit tests cover the Azure routing lock, the OpenAI upstream violation, Ox pipeline rejection, and the Nemotron request body and provider check.
- Local Supabase RLS E2E proves the Ox pipeline cannot create jobs/usage, Luna jobs use `openai/gpt-6-luna`, and OpenAI-upstream usage blocks completion.
- Production runs: read-only plan → encrypted recovery point → 0056–0057 apply/verification → immutable candidate → real DocumentIR/Luna/translation gates → private smoke → cutover; any hard-gate failure restores the previous app release.
