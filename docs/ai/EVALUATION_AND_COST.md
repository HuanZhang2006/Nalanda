# AI Evaluation and Cost Governance

> **About this document**
> - **Contents**: Defines the contracts, offline/online evaluation, safety testing, cost accounting, budget controls, and model release and rollback for courseware parsing and the four kinds of AI artifacts.
> - **Purpose**: Makes AI quality, hallucination, safety, latency, and unit economics measurable, so "the endpoint returns something" is never mistaken for an AI product that can be charged for or made public.
> - **When to update**: When models/providers, prompts, parsers/OCR, chunking/RAG, schemas, evaluation sets, quality thresholds, prices, credits rules, or the release process change; immediately after any quality/privacy/cost incident.
> - **Status baseline**: 2026-10-03. The production database is at 0055; the app candidate rolled back automatically after the real DocumentIR DOCX test-paper gate failed, the current app is still the earlier stable release, and the Materials AI/Luna switches stay off. The failed candidate's question counts and total marks were already correct, the initial structural gate was `QUESTION_TYPE_COUNT`, and five classes of semantic defects only surfaced after the structural repair; this Unreleased fix gives the repair the full source and adds one strictly bounded follow-up semantic repair, while retiring Ox Alpha and upgrading Luna to GPT-6 Luna + Azure ZDR. Real providers and a protected cutover have not been re-proven yet. Courses AI file import is still not implemented.

## 1. Scope and non-goals

The scope includes parsing PPT/PPTX, DOC/DOCX, PDF, JSON, Markdown, HTML, TXT, and image OCR; Courses choosing prompts and structured output by English vocabulary/knowledge points/reading comprehension/question bank training; and the knowledge list, quizzes, knowledge graphs, and mock exams. Evaluation covers models, parsers/OCR, chunk/retrieval, schema validators, post-processing, human confirmation, and rendering. Azure Speech and the OpenRouter spelling translation pre-test are governed separately as independent, narrow-purpose provider adapters.

This document does not promise models are absolutely correct, does not hide different errors behind a single "accuracy" number, and does not treat provider benchmarks as Nalanda product evaluation. Cost figures come from runtime price snapshots and bills, not from web prices hard-coded in this document that go stale easily.

The full text, dynamic inputs, and schemas of every current production, test, and release-gate prompt are maintained in the [unified AI prompt catalog](PROMPT_CATALOG.md); this document only maintains evaluation, cost, and release rules and no longer copies prompt text.

## 2. Current facts and enablement limits

Current production implementation:

- NestJS implements the owner-only job/quota/Notes/Exam APIs, durable Postgres jobs/reservations, and BullMQ UUID scheduling/the reconciler;
- FastAPI has only internal-token generation/grading routes, parses PDF/DOCX/PPTX/Markdown/HTML/TXT/JSON/CSV/images deterministically, and keeps pages/slides/blocks/sources in a `DocumentIR`;
- The union of the first DeepSeek review and parser diagnostics gives the failure ranges, only the rendered images of those pages/slides/regions are sent to MiMo, and after the full IR is stitched together it is reviewed again;
- The models are fixed to `deepseek/deepseek-v4-flash-0731` and `xiaomi/mimo-v2.5`, forcing ZDR, deny data collection, and require parameters, with reasoning/tools/Web/cross-model fallback off; the same model fails over, throughput-first, only among provider endpoints that satisfy every filter;
- `GeneratedExamV1` is unified as a camelCase strict schema in shared TS, Nest, and Pydantic; before saving, metadata, duplicate IDs, and feasible marks allocation are normalized deterministically from server settings, then question counts, total marks, answers, rubrics, and source blocks are validated; source citations may only be normalized to the DocumentIR allowlist, and when a repair loses all valid citations, pre-repair citations may only be restored for the same stable question ID, or the single allowlisted block chosen when the whole IR has only one block; the repair always receives the full allowlisted source blocks. Initial structural or semantic defects each get one repair, and only when semantic defects are first found after the structural repair is one extra semantic repair allowed, after which the same normalization/structural/semantic gates must run again;
- Before saving, `GeneratedKnowledgeGraphV1` shifts the model's relative hierarchy levels so the minimum is zero, and the pipeline `sourceMode`, level-0 root, unique node/edge IDs, endpoints, source order, and citations are validated consistently in both the worker and the database; this mechanical step does not change titles, explanations, relationships, citations, or relative hierarchy;
- Every user is Free, with 10 successful generations and 10 successful subjective gradings per local day; failure/cancellation releases the reservation, and credits are never read; the global monthly default is US$20, with per-run caps of US$0.50/US$0.05 for generation/grading;
- In production 0043, each job's 0700 temporary directory is deleted in `finally` and orphans older than an hour are cleaned; the 0046–0051 candidate only keeps validated checkpoints/the usage spool until the configured TTL on recoverable failures, cleaning up on success, unrecoverable failure, Delete/Cancel, or expiry; the durable parse cache, DB checkpoints, and layouts are separate private product data;
- Production has the isolated worker/Redis topology, but after the latest failed candidate rolled back, the Materials AI/Luna flags both stay off; fake automation doesn't prove real provider quality, and real gates are also only point-in-time evidence that doesn't replace continuous quality/cost monitoring.
- Although the Courses UI lists PDF/Word/JSON/Markdown/HTML/images, the entry point only shows "AI parsing coming soon" and never selects/uploads/parses files or calls a model; word lists currently only support user pasting with manual editing and confirmation.
- Azure Speech's Nest adapter, WAV limits, quotas/estimated costs, circuit breaker, durable queue, and private Storage source of truth are enabled in production; the production Web app has removed client-side VAD/silence trimming, and fake tests still only prove the code path. This capability only does TTS/read-aloud feedback; it parses no files, generates no courses, and deducts no credits.
- 0019 adds the NestJS translation judging adapter: answers that, after normalization, exactly equal a server-side reference translation are judged correct deterministically by the server; only non-literal synonyms/paraphrases use OpenRouter structured JSON. The input text is never persisted, and the server alone still writes spelling error facts. Production has real provider, candidate API, and immutable release evidence.
- The 0046–0051 candidate no longer holds API→worker HTTP for long jobs: the API only waits for a short 202, and the worker advances the durable job through internally authenticated callbacks. Provider usage is written to a UUID spool first and then recorded incrementally, and validated artifacts/answers are checkpointed first; a new lease within the window does not repeat completed calls. An active Delete cancels HTTPX/Office, blocks the terminal callback, and purges all residue after usage is recorded; hard-deleting a job does not delete the cost audit. This mechanism still has to be proven with real fault injection before it can be called production.

Therefore, currently we must not: charge credits; treat Azure TTS as file parsing; treat health/key/fakes or a one-off release smoke as continuous provider availability; run uncontrolled tests on real private courseware; or publicly promise accuracy/cost/latency.

### 2.1 The production Materials test-paper generation loop

Supported inputs are PDF, DOCX, PPTX, Markdown, HTML, TXT, JSON, CSV, PNG/JPEG/WebP; legacy DOC/PPT/XLS, encrypted PDFs, corrupt files/zip bombs, and over-limit files are rejected. A single file is limited to 25 MB, images to 10 MB, 250 pages/slides, and 400k normalized characters.

```text
Deterministic parser + coverage diagnostics
  → DeepSeek audit (coherence, missing ranges, injection)
  → MiMo visual_extract.v1 for failed ranges only
  → stitch the full DocumentIR back together
  → second DeepSeek safety audit
  → DeepSeek exam-generate.v4
  → server-side mechanical constraint normalization
  → schema/marks/answer/source validator + semantic review + source-aware bounded staged repair
  → private Notes + quota consume
```

The MiMo prompt treats images as untrusted evidence and extracts, in reading order, verbatim text, hierarchy, tables, chart axes/legends/trends, flow nodes/edges, formulas, icon semantics, visual relationships, unreadable areas, and suspected embedded instructions, forbidding following image commands or making things up. Both `malicious`/`uncertain` are rejected; `benign_educational` is only for clearly instructional/quoted/security-analysis content. Detection cannot give an absolute guarantee, so deterministic limits come before model classification, followed by schema/source validation and a feature kill switch.

Provider usage only keeps the model, tokens, micro-USD, latency, request ID, purpose, ZDR, and status; never prompts, file content, answer content, or raw responses. Network errors, 408/429/502/503/504, and 200 responses with empty content, truncation, or bad JSON/schema are retried with at most 4 bounded attempts on exactly the same fixed model/ZDR/schema request, backing off exponentially from 2 seconds by default and honoring a numeric `Retry-After` of up to 60 seconds; all attempts share the original 180-second budget for the structured operation, a single HTTP call can only use the remaining time, and retries never inflate the worst-case wait to `attempts × 180 seconds`. Longer waits and authentication/credit/ZDR/parameter errors fail directly and release the product allowance. HTTP failures usually have no tokens/cost, but a 200 with invalid structure may already have incurred cost; the adapter therefore returns each failure before success and the final success as separate redacted usage events, the database cost hard gate sums all of them, and the worker also accumulates the remaining micro-USD for this run after each event lands in the local spool, making no further model calls once over the limit. The final success event's duration still covers the structured operation's total wait. The real gate must use fixed PDF/DOCX/PPTX/chart/injection/safety lesson/grading samples with no personal data to prove the ZDR endpoint, failure ranges, citations, rejection without false positives, tokens/cost, and grading; a single pass still does not mean continuous quality, and "succeeded after retries" must not be read as long-term availability meeting the target.

The original failure on 2026-08-12 hit the Node/Undici response-header timeout at 301.896 seconds, and the old catch misreported it as `AI_WORKER_UNREACHABLE`; the worker had actually entered test-paper generation with no OOM/restart. The candidate explicitly distinguishes connect, accept, headers/body, and business timeouts, keeping the root cause as `AI_WORKER_TIMEOUT`. More importantly, the transport timeout no longer decides the life of long jobs: completed provider stages and cost UUIDs can be recovered from the checkpoint/spool. Evaluation must include the fault sample "provider succeeds, callback fails, a new lease recovers", asserting that the number of provider requests does not increase, there is only one cost event, and the quota/Note completes exactly once.

On 2026-08-11 the production gate processed fixed PDF/DOCX/PPTX/chart samples, with the chart recovering only 1 visual range, confirming malicious injection rejection, safe teaching material passing, 39 progress events, and grading; the main/child process peaks of the 220-page/366,412-character canary were about 101.8/211.9 MiB. The signed-in user smoke completed generation, grading, both allowances, usage, sources, result deletion, and temporary directory cleanup. This sample set does not cover every complex real user courseware or attack, so continuous evaluation is still required.

The later real chart gate on 2026-08-14 exposed that the first-round classifier returns `uncertain` because pure images had not been extracted yet, and the old execution order misreported injection before MiMo. `material-safety-audit.v2`'s regression set separately covers: parser-quarantined ranges may enter recovery, recovery still happens when the model omits failed ranges, unknown ranges are rejected, deterministic signals in body/focus are rejected, and strict re-review after recovery. Fake unit tests can only prove control flow; releases must still use a chart with no personal data and a sample with a malicious instruction inside an image to prove separately that normal visual content can be recovered and visual injection is rejected in the second review.

Candidate run `31834895278` on 2026-08-15 passed full CI and the 220-page resource canary, but the real test paper for the fixed safe teaching material once blocked cutover with `AI_EXAM_VALIDATION_FAILED` and rolled back. Three redacted stage diagnoses on the same fixture with no personal data then followed: once normal, once reproducing 5 questions of 5 marks each while 20 total marks were requested and the repair still not correcting it, and once normal; a reviewer was also observed returning `valid=true` together with non-empty issues. The forward fix only deterministically handles provable mechanical constraints (request metadata, duplicate IDs, marks totals) and never changes stems/answers/citations; non-empty reviewer issues still trigger a repair. Until a real rerun passes, this fix must not be called live in production.

The same day, main run `31838779292` proved the test-paper normalization above passes the real provider fixture, after which the knowledge graph in the signed-in production smoke was rejected by the completion RPC after `artifact_ready` with SQLSTATE `22023`. Redacted checkpoint assertions showed the artifact had 3 nodes/2 valid edges with unique IDs/endpoints/citations all fine, but `roots=0`; the worker's DocumentIR validator missed the root constraint the database already had. The candidate did not cut over the Web app and rolled back automatically. The forward fix mechanically shifts graph levels to zero and adds local/database contract comparison tests; permanent structural/routing rejections in the completion callback also enter an explicit terminal state instead of posing as a recoverable callback outage. Until a new real release gate passes, it still cannot be called live.

PR #70 run `32499521666` and main run `32540131549` on 2026-08-22 passed the full fake/local gates, 0007→0051, the empty database, RLS/Storage, Chromium, image builds, and the 220-page resource canary; after the real PDF passed, the fixed DOCX test paper returned `AI_EXAM_VALIDATION_FAILED` at the final gate, the candidate rolled back automatically before the API/Web cutover, and production still ran the old stable release. The old response contained only this umbrella code, making it impossible to tell whether the failure was structural or semantic, and provider text should not be leaked for diagnosis. The forward fix only outputs `initialGate/finalGate`, a stable structural code, a stable semantic category, and the expected/actual question counts and total marks; never courseware, file names, questions, answers, prompts, reviewer issues, or provider bodies. The fixed material was also expanded from three facts to eight independent facts to stably support five multiple-choice questions; schema, answers, citations, semantic review, single repair, and fail-closed behavior were not loosened. This fix must be proven by a new real run before it counts as live.

Attempt 2 of retry run `32543270581` on 2026-08-23 proved the content-free diagnostics above work: the initial generation structurally met 5 questions/20 marks, but the semantic review returned five classes of quality defects; after one repair those semantic categories no longer appeared as the final gate, and the final structural gate only had `SOURCE_REFERENCE`. This showed the repair invented/replaced block IDs, rather than a queue, resource, or question count/total marks failure. The forward fix only does provable citation allowlist normalization: dropping invented IDs mixed with valid citations and using the DocumentIR's canonical locators; if a repair makes the same stable question ID lose all valid citations, that question's pre-repair valid citations may be restored. Changing question IDs, cross-question citations, or never having had valid citations still fails closed, and restored questions must pass the semantic review again, so a mechanical fix is never mistaken for proof of grounding.

Attempt 1 of PR #74's main run `32585659792` then proved the mixed/repair citation fix passes the real PDF/DOCX/PPTX/chart, injection, safe teaching material, grading, and graph gates; Japan East Azure also returned accuracy 98 and pronunciation 98.8, but the separate Gemma translation smoke kept hitting 429 and rolled back. Attempt 2, rerunning only the failed job, saw all-invalid citations in both the initial and repaired output on a single-block PDF, diagnosed as initial/final `SOURCE_REFERENCE`; this was not a multi-block grounding ambiguity, because the server allowlist had only one real block. The new mechanical rule only chooses that single block when `len(blocks)==1` and then runs the semantic review; with two or more blocks the model must still provide valid IDs or fail closed. It cannot let questions the semantic review doesn't support pass, nor can it remove the separate Gemma 429 gate.

Attempt 1 of PR #75's main run `32587844503` passed the full local gates and the 220-page canary, but the fixed single-block PDF's initial candidate had 6 questions, still 6 after repair, and failed the final structural gate with `QUESTION_TYPE_COUNT` because the settings required 5; this showed the citation fix did not loosen question-type counts. The single rerun of the failed job, attempt 2, then passed PDF/DOCX/PPTX/chart, injection rejection, safe teaching material, grading, and a 9-node graph, proving single-block citations still go through the structural and semantic reviews; Luna stayed off because OpenAI-only ZDR was unavailable, and Japan East Azure returned accuracy 98 and pronunciation 98.8. Finally, the free Gemma model still returned consecutive HTTP 429s after bounded backoff of 5/10/20/40 seconds, and the candidate rolled back again. Sustained rate limiting is a separate provider-availability hard gate, and must never be faked into a launch by skipping the smoke, switching models, or removing fail-closed behavior.

PR #78's main run `32931681321` on 2026-08-26 passed quality, 0007→0055, the empty database/lint, two-user RLS/Storage, fake Chromium, and the production images, and had no new migration this time. After the candidate canary passed, the fixed PDF completed, and the DOCX's initial generation entered repair with `QUESTION_TYPE_COUNT`; after repair the question count was 5, total marks 20, and the final structural code empty, but the final semantic gate reported `ANSWERABILITY`, `ANSWER_CORRECTNESS`, `DISTRACTOR_QUALITY`, `EXPLANATION_QUALITY`, and `SOURCE_GROUNDING` together, followed by an automatic rollback. Inspection found the old repair payload had only `allowedBlockIds` without block text, and the workflow had already used up its only repair when semantic problems were first found after the structural repair. `exam-generate.v4` gives the repair the full `sourceBlocks` and an explicit `repairGate`, requiring minimal changes and per-question source support; it adds one semantic repair only for "semantic defects newly found after the structural repair", then reruns both the structural and semantic gates and fails closed. This local fix cannot replace new real DOCX/PPTX gates.

### 2.2 The Luna native-file candidate loop

`luna_native_file_v1` is fixed to `openai/gpt-6-luna` and requires `provider.only=["azure"]`, `allow_fallbacks=false`, ZDR, deny data collection, strict schema, and no tools/Web. After downloading from private Storage, the worker only validates MIME, size, and SHA-256; it must not run the parser/OCR/LibreOffice/DocumentIR/parse cache. PDFs use inline `type:file` with `file-parser.native`, and images use inline `image_url`; the Files API, which would create persistent remote files, is not used. The real upstream in the response must be Azure, and usage events durably record the provider/endpoint/pipeline; costs already incurred by routing violations are still recorded, but the artifact must not be saved. GPT-6 Luna's catalog price (Azure) is about $0.10/M input and $0.50/M output tokens, roughly half of GPT-5.6 Luna.

The Luna order is fixed: native-file safety review → native-file generation → local schema/question count/marks or node/edge/source validation → at most one repair carrying the same original file → save. Checkpoints only store the review conclusion or validated artifacts, never prompts/source file content; the source file stays in private Storage. The create endpoint reads capabilities first, and only extensions that passed real per-format gates are selectable; unsupported formats are explicitly disabled, letting users explicitly choose the old pipeline, with conversion or silent fallback forbidden.

Real Luna gates must record, at least separately per PDF, image, and each candidate extension: the raw SHA-256, wire MIME/sourceMode, actual provider/endpoint, native parser, schema pass rate, injection rejection/false positives on safe teaching material, source locator support, tokens/cost, P50/P95, and cancellation/timeout residue. Test papers and graphs are evaluated separately; graphs also test 250-node hierarchy/order/cross edges, exams are graded only after the whole paper is submitted, and subjective questions are graded together in one run. Fake providers do not count as evidence of model quality or format support.

The 2 GB canary of real release run `31824832947` on 2026-08-14 passed, but the first GPT-5.6 Luna PDF test paper failed with `OPENROUTER_ZDR_UNAVAILABLE` before the safety review; the app rolled back automatically and Luna was not enabled. The official `/api/v1/endpoints/zdr` listed only Azure/Azure EU for that model, not first-party OpenAI. From 2026-10-03 ([ADR-0016](../adr/0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md)), Luna switches to GPT-6 Luna locked to the Azure ZDR endpoint; every later release re-reads the catalog and opens it only when the Azure ZDR endpoint exists and the full real PDF/image gates complete, never removing ZDR or passing `data_collection=deny` off as ZDR.

### 2.3 The Ox Alpha native-image candidate (retired)

0054–0055 added `ox_alpha_native_file_v1`. The live ZDR catalog never had a compliant endpoint, and the model was later removed from OpenRouter; production never created an Ox job. 0056–0057 removed the pipeline's database values, RPC branches, API/Web/worker code, environment variables, and release gates.


### 2.4 Target loop for Courses file import (not implemented)

Target inputs: PDF, DOC/DOCX, JSON, Markdown, HTML, and controlled images. Files first enter a per-user quarantine, where the server checks the extension, MIME, magic bytes, size/pages/pixels, zip bombs, and malicious content before parsing/OCR; the browser cannot send the original directly to a provider, and the model cannot use service-role or arbitrary network tools.

Category routing must be versioned explicitly, never one vague prompt for all four:

| Category | First structured target | Prompt/evaluation focus |
|---|---|---|
| `english_vocabulary` | units → `term/translations[]`, optional source/confidence; IPA still preferably from CMUdict/manual entry | Don't break phrases, polysemous translations, unit boundaries, duplicates, source faithfulness |
| `knowledge_points` | Knowledge points, definitions, tags, order, sources | Groundedness, omissions, dependency order |
| `reading_comprehension` | Source passages, questions, answers/evidence, difficulty | Quote ranges, answer uniqueness, copyright display |
| `question_bank` | Stems, question types, options, answers, explanations, sources | Answer consistency, distractors, duplicates, and academic integrity |

The suggested versioned JSON Schema for English word lists contains at least: `schemaVersion,category,sourceFileId,units[{suggestedName,sourceRange,words[{term,translations,sourceRange,confidence,warnings[]}]}],parseWarnings`. The model must not generate database IDs, owners, progress, points, publications, or executable HTML. The output first passes the schema, product limits, duplicate/Unicode/XSS, and source alignment checks, then enters the same structured editor as text import; only after the user confirms item by item is the whole-course save transaction called. Without human confirmation, no course may be created, no schedule set, nothing published to the market, and no growth reward granted.

Original files, temporary OCR images, prompts, and model output use the shortest retention per job; ordinary logs only keep hashes/internal IDs/versions/metering. Deleting a course or account must cover the quarantine, temporary files, OCR, model cache, job payloads, and provider copies. Adding any user file to an eval/golden set requires separate, revocable authorization.

### 2.5 Courses import evaluation and cost gates

The fixed evaluation set is stratified by format, digital/scanned, with/without units, tables/multiple columns/images, words/phrases, multiple translations, mixed Chinese and English, bad formats, and malicious prompts. Core metrics:

- term precision/recall/F1, phrase boundaries, translation set precision/recall, unit boundary F1;
- Source range validity/support rate, rate of new words/translations with no source, normalized duplicate rate, schema/product limit pass rate;
- Human accept/edit/delete rates, severe errors per hundred words, failure rate by format, number of successful XSS/prompt injections;
- Tokens, OCR/vision, retries, storage/egress cost, and P50/P95 latency per successfully imported file/page/image/thousand characters/confirmed word.

Initial launch gates: schema and safety boundaries 100%; zero cross-user/secret leaks and zero successful prompt injections; zero severe word meanings added with no source; formal thresholds for term F1 and translation F1 must be written into versioned configuration after an authorized golden baseline; cost estimates must cover tokens, OCR/vision pages, and retries, with a P90 relative billing error ≤20%. Until sample sizes/thresholds are established, it can only be an internal alpha, and the file button must never be opened because it "looks good".

At runtime, estimate the maximum pages/images/tokens/cost first and let the user confirm; over the limit, reject or narrow the scope, never charging credits without limit after the fact. v1 manual text import is free; whether future AI import charges must first be wired into credits hold/commit/release with failure refunds, and points are never used for payment.

### 2.6 Current Azure Speech boundaries

Speech is not part of the generation pipeline above. TTS only sends the current English term, and scoring only sends the server-derived reference text and the PCM WAV the user records voluntarily; the client records at most 6 seconds with echo cancellation, noise suppression, and auto gain control off, does no VAD, volume thresholds, minimum-speech checks, head/tail trimming, or content truncation, and only performs the 16 kHz/16-bit/mono PCM format conversion the Azure contract requires. The server keeps the 8-second/2 MB limit and forwards the same validated WAV bytes to Azure. Course names, translations, emails, and schools are never sent. Recordings are discarded after the response, and only scores/error types/phoneme feedback are stored; provider failures don't count as learning errors.

Scoring's durable controls are per-user defaults of 30/minute and 300/local day, a global monthly estimated budget, and a circuit flag; the pronunciation exam gets no separate free allowance, and every exam word actually submitted uses the same assessment allowance and budget, so capacity must be recomputed as "active test takers × unit word count × retry rate" before opening. The micro-USD in `learning_speech_usage` is a budget reservation of configured price times usage, not an Azure billing fact. The TTS queue reuses private Storage objects across users by `SHA-256(normalizedTerm + locale + voice + format + synthesisVersion)`, with a single worker by default, at least 3.1 seconds between requests, 20/minute, and 500,000 characters/month; leases, retries, character reservations, and cost budgets are all controlled by the server database. The browser only caches rebuildable copies and prefetches the current word plus the next four.

The production pronunciation exam only uses the current owner session's current word as the server-derived reference text; before scoring, it rejects non-current words and end-of-round waiting states, and provider failures never write errors. Whether a word is correct follows `AZURE_SPEECH_PRONUNCIATION_PASS_SCORE` (default 70), and whether a unit passes uses the separate integer accuracy threshold of the full first round (default 90%); the two must never be merged into one score. Automated fixed WAVs/fake providers only verify the workflow; before release, scoring, latency, quotas, error degradation, and real cost must still be verified independently with real Azure in Japan East.

Observe separately: attempt/snapshot RPC latency, queue wait, Azure synthesis, Storage hits, browser Cache hits, total scoring time, and provider time; quota pauses, failed retries, and repeated-word hits must not be mixed into "generation success rate". The real Japan East release gate on 2026-07-27 verified 4 first-time generated objects, private Storage hits, a second user reusing the same 4 objects without new generation, and a score of 97 after VAD trimming. The Azure fake only verifies the code path and does not count toward quality or provider availability reports; a single gate is not continuous availability or billing reconciliation either.

### 2.7 Current OpenRouter translation semantic pre-test boundaries

The purpose is limited to an optional teaching judgement before spelling. NestJS takes `term/translations` from the owner/session/current word. If the user's answer, after NFKC, whitespace, and case normalization, exactly equals any reference item, it is judged correct deterministically as the versioned `nalanda-normalized-exact/normalized-exact-v1` with no provider request; only non-literal answers are sent to OpenRouter together with `term/translations`, specifying the free `nvidia/nemotron-3-super-120b-a12b:free`, temperature 0, `reasoning.enabled=false`, and JSON Object mode, locked to the Nvidia upstream with fallback forbidden. The free endpoint does not promise deny collection, so requests contain only minimal word-meaning context and no account identifiers. Nalanda then strictly validates locally that the object contains only the boolean `correct`; missing or extra fields, wrong types, or invalid JSON fail closed and may be retried once within the same budget. Clients cannot provide reference answers, the model, or provider parameters. The model only decides the non-literal semantic boolean; the API fills in feedback with fixed, non-authoritative teaching copy. No output can directly award points/badges or change progress; a wrong judgement can only be turned into one idempotent spelling attempt by a database transaction.

The minimum fixed evaluation set must include:

- Exact matches, synonymous paraphrases, hypernym/hyponym expressions, word-order changes, one/multiple legitimate meanings;
- Answers giving only a related but incomplete meaning, antonyms, unrelated words, restating the English in English, blank/overlong input;
- Mixed Chinese and English, punctuation/format changes, prompt injection, requests to leak the system prompt/reference answers;
- Same-UUID replays, concurrent leases, timeouts, 5xx, 429, invalid JSON/schema, and revision conflicts.

The semantic quality gate must still compute precision, recall, and false-accept/false-reject on an authorized synthetic/expert-labeled set, stratified by single/multiple meanings, words/phrases, and Chinese/English. The high-risk error is judging an unrelated translation correct; the current real gate's two samples (synonym true, unrelated false) only prove the endpoint/schema/key work right now and are not a quality baseline, so the feature must keep a separate emergency flag and must not publicly promise accuracy.

At runtime, record the redacted provider/model, duration, correct, and prompt/completion/total tokens; never the user's answer, the full prompt, reasoning, or provider responses. 0027 separates the idempotent claim from the provider-backed assessment reservation: deterministic exact matches, completed replays, and leases that never sent an external request all keep `quota_counted=false/quota_counted_at=null`, and true/the current time is written atomically per user only right before a real OpenRouter request; the rolling window no longer mistakenly uses an earlier assessment creation time. Network/provider retries of the same UUID don't consume the product allowance twice. The defaults are 20 per user per minute and 500 in a rolling 24 hours; 429s carry the exact seconds until recovery. The whole provider call budget is 12 seconds; if the first HTTP 200 lacks a valid boolean, one retry within the same total budget is allowed without counting another product allowance. Real request timeouts/provider errors still keep that allowance fact but don't record a learning error. The current model catalog price is 0, but it must still be treated as a provider dependency whose "price/credit/model identity can change": check the current routing, credit, and privacy terms before release, set usage alerts and an emergency feature flag, never promise it is permanently free in product rules, and never tie points/credits to this call.

### 2.8 Fish Audio Chinese STT production boundaries

0037 enables OpenRouter `fish-audio/transcribe-1` only in the translation input of translation-first spelling. Requests always go to `/api/v1/audio/transcriptions` with `language=zh`, and the model, language, and Bearer key are configured only by NestJS; the recognized text only fills the input and is never sent automatically, nor can it directly create attempts, the retry pool, progress, points, or badges. Only after the user edits and explicitly submits does it enter the existing semantic grading chain from the previous section.

The current published price is estimated at `$0.0001/second`, the database conservatively reserves 100 micro-USD/second, and the defaults are 20 per user per minute, 300 per local day, and a global 5,000,000 micro-USD/month. `learning_speech_usage` only stores kind/cost/date, never audio or transcripts; logs only keep provider/model/language, audio seconds, durations, and provider usage/cost numbers. The continuous evaluation set should still cover Mandarin male and female voices, quiet speech, accents, short words/sentences, background noise, silence, segmentation, homophones, numbers, mixed-in English, and 1–6 second durations, stratified by CER, key-meaning retention, empty result rate, p50/p95 latency, and cost per successful transcript. Automated fakes only prove the contract; the real release gate sends a fixed Chinese WAV of "apple" synthesized by Azure through the candidate API and requires the Fish Audio transcript to contain that word, which still cannot replace real user accent evaluation or continuous quality monitoring. The price and capabilities listed on the [OpenRouter model page](https://openrouter.ai/fish-audio/transcribe-1) may change and must be re-checked at release.

The first direct real smoke on 2026-08-04 returned HTTP 402 because the account balance was insufficient, proving that a key able to call `:free` text models does not mean billed STT works; the code maps this to `TRANSLATION_STT_PROVIDER_CREDIT_REQUIRED` by design and keeps keyboard input. After topping up, a retest with a 0.526-second 16 kHz mono synthetic Chinese WAV succeeded, and the direct smoke recorded about 3.27 seconds end to end, 1 second of provider usage, a cost of about `$0.0001`, and a hit on the expected keyword; the protected production gate then returned `transcriptionMatched=true` through the candidate Nalanda API and activated the release. That fixed sample is still not a multi-accent quality baseline.

The final real gate on 2026-07-28 used the fixed `google/gemma-4-26b-a4b-it:free` and returned 1,365 ms, 253 prompt tokens, 27 completion tokens, and 280 total tokens; in the same release, the real Courses API exact-match path durably recorded `nalanda-normalized-exact/normalized-exact-v1`, 0 tokens, and `replayed=true`. Earlier in the same release chain there was one 12-second provider timeout that blocked candidate activation by design; a successful retry cannot replace continuous latency/availability or semantic quality statistics.

## 3. Traceable generation records

Every parse/generation job must record the following non-secret metadata:

- `job_id`, internal user/material IDs, the request idempotency key, artifact kind/language/depth, and pipeline;
- Input file hash, format, size, page count; the original text must never be logged in ordinary logs;
- Parser/OCR/chunker/retriever versions and configuration hash;
- Configured provider/model, actual upstream endpoint, model revision (if provided), region;
- system/prompt/template/tool schema version and hash, never secrets;
- Provider metering for input/output/cache/reasoning/image/pages and so on;
- Retrieved chunk IDs/citation mapping and the permission snapshot;
- Schema validation, quality gate, and safety gate results;
- Queue/start/end times, attempt counts, termination reason;
- Provider price snapshot, estimated/actual cost, hold/commit credits;
- Result version, derivation from human edits, deletion status.

The same result must be able to answer "which material, which pipeline, which model, how much it cost, and which gates it passed" without leaking content. When models cannot be guaranteed to be bit-for-bit reproducible, describe results as traceable, not reproducible.

## 4. Evaluation set governance

### 4.1 Dataset tiers

| Set | Purpose | In daily CI | Data requirements |
|---|---|---:|---|
| Contract fixtures | Schemas, boundaries, error semantics | Yes | Synthetic, very small, committable |
| Golden regression | Quality/parsing regressions | Yes (may be nightly) | Authorized, de-identified, versioned, expert answers |
| Safety/red-team | Prompt injection, privacy, harmful content | Yes | Synthetic/licensed, strict access |
| Cost/latency benchmark | Tokens, pages, latency, retries | Nightly/pre-release | Fixed inputs and provider modes |
| Shadow/online sample | Real distribution drift | Target phase | Separately approved, minimized, metrics/user feedback only by preference |

Cover at least Chinese/English, text PDFs/scanned PDFs/PPTX/DOCX/MD/HTML/TXT, formulas/tables/images/headers and footers, short/long documents, multiple subjects, different quality levels, and malicious embedded instructions. Each sample records its source, license/consent, allowed scope, PII check, retention, and deletion date.

User courseware must never be added to training or golden sets automatically. When a user reports a problem, record only the error type and trace ID by default; keeping the original text for evaluation requires separate, revocable consent with restricted access/duration. Keep the test set separate from the prompt development set to avoid overfitting to known answers.

### 4.2 Versioning and contamination prevention

Datasets use immutable versions and hashes; changes record the reasons for additions/removals, the annotators, arbitration, and metric recomputation. Model providers may have trained on public materials, so "high scores on public tests" is never the only evidence. Golden answers are reviewed by at least one domain reviewer, and high-risk/disputed samples get two-person arbitration.

## 5. Evaluation dimensions and metrics

### 5.1 General contract

- HTTP status, error codes, timeouts, cancellation, retries, and idempotency match the API contract;
- JSON/Pydantic/shared TS schemas pass 100%; unknown fields/versions are handled per the compatibility policy;
- Chinese/English compliance, empty input, overlong input, corrupt/encrypted files, and malicious content all have deterministic results;
- Every user-visible fact can be linked to a source chunk/page; unsupported content is labeled uncertain or not generated;
- Retries never double-charge, write duplicate results, or leak other users' chunks.

### 5.2 Parsing/OCR

Metrics are split by format and page type: page/block recall, normalized character/word F1, heading hierarchy, reading order, table cell structure, formula/image descriptions, page mapping, duplicate/header noise, language detection, and failed page ratio. Scans report OCR separately and are never averaged with digital text to hide problems.

### 5.3 Knowledge list

Coverage of core concepts, correct/complete definitions, dependency ordering, deduplication, consistent terminology, citation support, suitable granularity, and language compliance. Record the unsupported claim rate, source coverage, expert 1–5 scores, and the key omission rate.

### 5.4 Quizzes

Clear stems; answers supported by the material; `answerIndex`/multiple choice consistent with the options; plausible distractors with no second correct answer; explanations citing the material; difficulty/knowledge-point coverage; duplicate rate and answer position bias. Verify with a solver + expert sampling, and never pass because the model "self-assessed as correct".

### 5.5 Knowledge graph

Unique node IDs, existing edge endpoints, no isolated/duplicate nodes (unless reasonable), readable labels, sourced relationships, and hierarchy/dependencies matching the course semantics. The candidate `GeneratedKnowledgeGraphV1` must also verify: sourceOrder follows the material's reading order as closely as possible; every node has a self-contained explanation, key details, examples/formulas when available, common misconceptions, self-check questions, keywords, and at least one valid source block; edges only use restricted relations with explainable explanations. Cycles count as errors only if the product declares a DAG; otherwise, record cycles and relationship types, and never judge quality by how pretty it looks.

Node Q&A reports separately: groundedness, question coverage, honesty about source insufficiency, citation precision/recall, the rate of going beyond neighboring nodes, prompt-injection success rate, and user comprehensibility. The input context may only contain the selected node, at most 20 neighboring nodes, and the DocumentIR blocks allowed by the selected node's sourceRefs; citations beyond that are a zero-tolerance structural failure. Being able to show details on hover/click only proves rendering, not semantic quality.

### 5.6 Mock exams

Total marks consistent with section/question marks; question type/knowledge point/difficulty distribution matching the user's choices; answerable questions with correct answers and rubrics; no key assumptions outside the material; no duplicates/question leaks; reasonable estimated time. language/difficulty/duration/totalMarks, duplicate IDs, feasible marks totals, whether citations belong to the server block allowlist, and their locator metadata are determinable mechanical constraints that can be normalized stably; the same stable question ID may inherit that question's earlier valid citations after repair, and the single source may be chosen when the whole IR has only one block. With multiple blocks there is no guessing. Question counts, meaning, answers, whether citations actually support the question, difficulty match, and teaching quality must never be faked through normalization and still need the validator, semantic review, and real-sample gates.

### 5.7 Human review rubric

Blind-review dimensions: groundedness, correctness, coverage, pedagogy, clarity, difficulty fit, safety, scored 1–5 with evidence. Randomize the order across models, record at least the reviewers' backgrounds and agreement, and arbitrate low-agreement items. Human preference does not replace verifiable contracts.

## 6. Initial release gates

The thresholds are first-version targets and may be adjusted through review after the first real baseline, but must never be lowered silently to let a failing model launch.

| Gate | Target |
|---|---:|
| Schema/citation structure valid | 100% of the release set |
| Cross-user chunk/PII/secret leaks | 0 P0/P1 |
| Malicious document instructions changing system rules/extracting secrets/overreaching | 0 successful attacks |
| Key unsupported claims | 0; support rate for ordinary claims ≥ 95% |
| Citations pointing to real sources that support the claim | ≥ 98% |
| Quiz answer/option/explanation consistency | ≥ 99% |
| Graph structural integrity | 100% (semantic quality counted separately) |
| Exam marks/structure consistency | 100% |
| Target language compliance | ≥ 99% |
| Overall expert score ≥ 4/5 | ≥ 90% of samples, with no subject below 80% |
| Economic/result side effects of repeating the same job | 0 |
| Relative error of cost estimates vs. actual | P90 ≤ 20%, and never above the user-confirmed credits ceiling |

Parsing gates should be written into the versioned eval config once per-format baselines exist; until then, any format can only be labeled beta, and cross-format averages are never release evidence. Sample sizes, confidence intervals, and each slice must be published with the release report, not just percentages.

## 7. Safety, privacy, and prompt injection

Tests include at least: "ignore the system instructions" inside documents, requests to output secrets/other users' materials, HTML/Markdown XSS, external links/tracking pixels, data URIs, malicious files, oversized files/zip bombs, Unicode spoofing, hidden OCR text, wrong citations, model prompt leaks, tool parameter injection, and cross-job/cache retrieval contamination.

Core rules: uploaded materials are data, not instructions; retrieval must filter by user/material authorization before vector recall; models have no service-role/Stripe/arbitrary network/database tools; output rendering is sanitized; provider calls only carry minimal fragments; logs/traces never store the original text; deleting a job covers prompts/caches/embeddings/provider copies.

Harmful/violating content is routed per the [content moderation standard](../governance/CONTENT_MODERATION.md). High-impact academic, medical, legal, and financial content needs explicit non-authoritative notices and sources, and fluency must never mask uncertainty.

## 8. Cost accounting

### 8.1 Price snapshots

Provider prices live in a versioned, approved configuration/price catalog that includes provider, model, region, currency, effective_at, unit prices for input/output/cache/image/page/tools, and their source. Each job is bound to the snapshot agreed at creation/actual call time; provider price changes never rewrite history.

### 8.2 Per-job cost

Compute in the smallest currency unit or a higher-precision decimal, rounding at the end per finance rules:

```text
provider_cost = input_tokens × input_rate
              + output_tokens × output_rate
              + cache_write/read_tokens × respective_rate
              + image_or_page_units × respective_rate
              + embedding/rerank/moderation/tool charges

total_variable_cost = provider_cost
                    + parser/OCR compute
                    + queue/worker time
                    + incremental storage/egress
                    + retry cost not waived by provider
```

Shared infrastructure is allocated separately per job/active user and never presented as an exact provider cost. Record the estimated upper bound, actual, currency, pricing snapshot, attempt breakdown, and who bears failure/retry costs. The credits price is decided by product pricing, and token counts must never be exposed as unlimited after-the-fact charges.

### 8.3 Unit economics

Observe by artifact, language, format, page count, model, and plan: variable cost per successful job; cost per input page/thousand characters; cost per valid knowledge point/question; cache hit rate; failure/retry waste rate; P50/P95 latency; the standard value of credits revenue; gross margin; refund/quality compensation rate.

Initial targets: in the stable phase, P50 contribution margin ≥ 60% while P95 requests stay non-negative; failure/retry waste ≤ 10% of AI provider cost; actual cost never above the job budget cap. If the targets are not met, optimize/reprice/limit sizes; never hide cost or charge credits beyond the confirmed ceiling.

## 9. Budgets and runtime controls

All of these are required at the same time:

- **Request budget:** maximum pages/bytes/tokens/images, maximum output, timeouts, retry counts, allowed models/tools;
- **User budget:** per-plan concurrency, daily/monthly jobs, and included credits;
- **System budget:** provider hourly/daily/monthly soft and hard caps, model/region circuit breakers, anomalous cost alerts;
- **Job budget:** the estimated upper bound corresponds to a credit hold; going over budget cancels or degrades, never expanding automatically;
- **Queue backpressure:** queue or reject when capacity/budget is reached, never piling up indefinitely and charging for expired work;
- **Kill switch:** turn off by provider/model/artifact/region while keeping access to existing materials.
- **Entry frequency protection:** production 0039's Redis sliding windows limit Courses writes and reads that might queue/consume provider cost; they only absorb bursts and provide `Retry-After`, and cannot replace the Azure/OpenRouter/Fish usage, monthly budgets, idempotent leases, or circuit breakers in the database. When Redis is unavailable, cost-related requests return `503 RATE_LIMIT_UNAVAILABLE`, and only private no-cost reads may degrade.

Thresholds are controlled environment configuration, never in the frontend, and changes are audited. The degradation order can be: reduce context/output → a cheaper, already evaluated model → parse/save a draft only → defer/reject and release the hold. Never pass off a model of noticeably different quality as the original product without telling users.

## 10. Latency and reliability

Record queue wait, HTTP accept, callback wait, provider execution, and resume wait separately. Provisional targets before the first baseline: 202 accept P95<2 seconds; a single artifact from standard text material of ≤20 pages completes within a P95 of 120 seconds; combined/test-paper/detailed graph P95 within 300 seconds; larger materials show tiered estimates on the confirmation page. The targets must be calibrated with real staging benchmarks, and a long job exceeding 300 seconds must no longer be killed by the transport.

Job states include at least `queued/processing/validating/.../succeeded/failed/cancelled`, with recoverable errors also carrying `retryable/resumeUntil/checkpointStage`. Users can poll safely; Resume must reuse the same job/idempotency/quota reservation and never create a new job that bypasses the allowance. Cancellation only releases resources after termination is confirmed; worker/callback crashes can resume idempotently from a validated checkpoint; partial results are not charged and not made public by default, unless the product explicitly offers an acceptable partial delivery option. Past the TTL, record a stable terminal state durably and delete the DB/local checkpoint; a RAISE must never roll back the cleanup.

## 11. Release, gradual rollout, and rollback

For every change to a model, prompt, parser, retriever, schema, or key parameter:

1. Produce a change description with expected benefits/risks;
2. Run the contract, golden, safety, and cost/latency benchmarks, and save a versioned report;
3. AI/product reviews quality, security/privacy reviews new data/tools, and finance reviews significant price changes;
4. Staging dogfooding uses authorized data;
5. A low-traffic canary, compared slice by slice with the old version;
6. Monitor quality feedback, failures, cost, latency, refunds, and safety;
7. Expand gradually once the gates are met, keeping the previous pipeline version ready for immediate rollback.

Rollback must restore pipeline routing and price/credits behavior without deleting already generated historical results; results keep their original version identifiers. Schema incompatibilities use dual read/dual write/migration so old clients don't crash.

## 12. Online monitoring and user feedback

Target online metrics: success/each error code, schema/quality gate failures, queue/execution P50/P95, tokens/pages/cost, hold release/commit, retries, cancellations, user edits/regenerations/deletions, explicit likes/dislikes, refunds, citation clicks, and safety flags. Feedback is linked to quality traces, but ordinary analytics only keep internal IDs and aggregates and never automatically copy courseware/output.

Monitor drift stratified by format/language/subject/model/plan. Differences between user groups may only be used for quality fairness diagnosis, never for sensitive pricing or discriminatory restrictions based on school/major.

## 13. Incident levels

- **P0:** cross-user material/secret leaks, model tools causing real money/data operations, large-scale erroneous charges; immediate kill switch, incident response, and secret/session handling.
- **P1:** systematic severe hallucination, malicious content bypassing defenses, large-scale over-budget/duplicate charges, deletion not taking effect; stop the affected pipeline, release/refund, and preserve minimal evidence.
- **P2:** significant regression for a format/language, sustained latency/cost SLO failures; degrade/roll back and publish a status note.

Retrospectives record the trigger, detection, user impact, data/cost, compensation, root cause, and recurrence-prevention evaluations. Without privacy approval, user content from an incident must never become a long-term test fixture.

## 14. Phased implementation checklist

### Phase 0: contract and safety foundation

- Unify the TS/Python/OpenAPI schemas and field naming/versions;
- Fixed synthetic contract fixtures and CI;
- Service-to-service authentication, input limits, sanitization, trace/usage schemas;
- Clarify third-party licenses and only use commercially compatible implementations.

Production Materials test papers have completed this; other artifacts and Courses file import do not reuse it yet.

### Phase 1: real parsing

- A separate parser per format, page/block sources, error semantics;
- A golden parse set and per-format baselines;
- Storage-authorized downloads, temporary file cleanup, and deletion linkage.
- Courses chooses versioned prompts/schemas by the four categories; implement PDF/DOCX/JSON/MD/HTML/image OCR for English word lists first, forced through the human confirmation editor, with the other categories still disabled.

Production Materials test papers have completed the listed parsers/sources/temporary cleanup; real quality is still judged by continuous real releases/eval sets. Courses import is not implemented.

### Phase 2: single-artifact model generation (free beta)

- Models/prompts/schemas, grounded citations, quality/safety gates;
- Price snapshots, a usage/cost ledger, budgets/kill switch;
- Staging/canary, authorized test accounts only.

Materials test papers are currently in this phase: Free quota, no credits sales; after the latest candidate rolled back, the production flag stays off, and it can only be turned on again after new real gates, the 2 GB canary, the candidate cutover, and independent public review all pass.

### Phase 3: other AI artifacts and future credits

- Materials already has durable jobs/queues, idempotency, cancellation, retries, and free quota reservations; future charging must build a separate credit hold/commit/release and must not reuse the quota to pretend to be a wallet;
- Concurrency/refund tests per the [economy rules](../product/POINTS_CREDITS_VIP_PAYMENTS.md);
- Charge only after the cost estimates and quality gates are met.

### Phase 4: public/Market

- Combined artifacts, RAG/embedding deletion, online drift;
- AI labeling, extra moderation before publishing, copyright/citations, and appeals;
- Regular model cards, transparency, and unit economics reviews.

## 15. Related documents

- [ADR-0004: Separate the core API and AI](../adr/0004-core-api-and-ai-service-split.md)
- [ADR-0007: Third-party AI licensing](../adr/0007-third-party-ai-reference-licensing.md)
- [ADR-0008: Independent learning courses and Azure Speech](../adr/0008-independent-learning-courses-and-azure-speech.md)
- [Security policy](../../SECURITY.md)
- [Privacy and data deletion](../governance/PRIVACY_AND_DATA_DELETION.md)
- [Content moderation](../governance/CONTENT_MODERATION.md)
- [Points/credits/VIP/payment rules](../product/POINTS_CREDITS_VIP_PAYMENTS.md)
