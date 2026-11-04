# Changelog

> **Contents:** Records, by version/date, significant additions, changes, fixes, security items, and deprecations for users, developers, data, and operations.  
> **Purpose:** An entry point for tracing release outcomes back to code, migrations, and operational impact; it isn't a list of Git commits and doesn't replace release notes.  
> **When to update:** Update `Unreleased` whenever a releasable PR merges; move it into a dated version on a formal release; the public scope of urgent security fixes is decided by the security owner.  
> **Status baseline:** 2026-10-03. Historical entries are summarized from Git history and protected release records; unreleased work is only listed under `Unreleased`, and database applies, application activation, and provider capabilities are recorded separately and must never stand in for one another.

The format follows Keep a Changelog, and versioning stays at `0.x` until the first stable API release. Categories are Added, Changed, Fixed, Security, Deprecated, and Removed.

## [Unreleased]

### Added

- Added an MIT `LICENSE` in preparation for making the repository public.
- Appended candidate migrations 0056–0057: retire `ox_alpha_native_file_v1` introduced in 0054–0055 (the three pipeline constraints and all service-role RPCs converge back to DocumentIR/Luna), Luna jobs now write `openai/gpt-6-luna`, and the three completion RPCs now require Azure usage; signatures are unchanged, and 0057 fail-closed verifies the constraints, model mapping, routing gate, and permissions. See [ADR-0016](docs/adr/0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md).
- Added and applied to the production database Stage B migrations 0052–0053: appended strictly after 0051, they revoke authenticated's compatibility UPDATE permission on `posts.updated_at` and `study_tasks.done_at`, and fail-closed verify the final content columns, Schedule columns, service role, and time-maintenance triggers. The originally reserved 0044–0045 stay unused, and the remote migration history was not back-filled.
- Appended candidate migrations 0049–0051: an explicit `pipeline` on jobs/Notes, recording the actual upstream provider/endpoint on cost events, a new `deleting` cleanup state, private `knowledge_graph_layouts`, job delete/clear/cancel cleanup transactions, the Luna completion routing gate, and exact permission assertions; old signatures are kept for database-first rollout and application rollback.
- Added `luna_native_file_v1`: pins `openai/gpt-6-luna`, `provider.only=["azure"]` (GPT-6 Luna's only ZDR upstream), no fallback, ZDR/deny collection/require parameters, tools/Web disabled, and processes PDFs/images on the gate-approved allowlist as inline base64 original files. It doesn't call deterministic parsing, OCR, LibreOffice, DocumentIR, or the parse cache, and never uses the Files API with its remote retention semantics.
- The knowledge graph is now a dynamic React Flow + ELK layered canvas, supporting panning, zooming, dragging/keyboard-moving nodes, fit view, auto layout, non-overlapping collision resolution, external hover/click details, and revisioned cross-device layout saving; the fake-provider Chromium path adds a 250-node fixture and an active deletion fixture.
- The AI queue adds in-app confirmation for per-item Delete and Clear history; the worker uses a cancellable task registry/Office process group and cleans the 0700 directory after confirming the usage spool has been recorded.
- Materials adds "Organize knowledge points": the pinned DeepSeek generates a source-ordered `GeneratedKnowledgeGraphV1` with strict citations, My Notes presents it as an interactive graph with hover explanations and click-through details, and users can ask source-restricted questions about a selected node. Knowledge list and standalone Quiz still show Coming soon.
- Appended candidate migrations 0046–0048: `generation_job_checkpoints`, `exam_grading_checkpoints`, `knowledge_node_questions`, a monotonic usage `event_id`, resumable job fields, knowledge graph artifact constraints, service-role-only workflows, and fail-closed permission assertions.
- Real provider/public smoke candidates cover the knowledge graph, node Q&A, source order, ZDR, the incremental cost ledger, and cascading deletion; fake Playwright extends to the full exam paper, grading, graph, and node Q&A paths.

### Changed

- The protected release no longer rolls back the whole application when only the optional Luna gate fails: the real provider gate reports `AI_LUNA_GATE_FAILED`, Luna stays closed (`FEATURE_MATERIAL_AI_LUNA=false`), and Document IR, Courses, and the rest of the release continue; any other closed Luna reason still rolls back. The Courses audio smoke only checks translation-first spelling when that feature flag is on. Production run `41739437671` attempt 2 was rolled back by a Luna-only `OPENROUTER_BAD_REQUEST` after Document IR had passed.
- The whole Web app — documentation, code comments, and every page and dialog — is now English by default. The top bar keeps a persistent English/Chinese toggle (stored as `nalanda-locale`) that switches every legacy module and React island, including Courses, My Notes, Materials, Community, Schedule, Profile, Feedback, notifications, and sign-in. Server-written notification texts and seeded course badge names are translated for display on the client, so no migration was needed; API error messages are now English.
- Semantic judgement of non-literal translations before spelling in Courses switched from Gemma 4 to the pinned free `nvidia/nemotron-3-super-120b-a12b:free`, locked to the Nvidia provider, with fallback forbidden, reasoning off, and JSON Object mode; Nalanda performs strict local field/type validation of `{correct:boolean}`. The free endpoint doesn't promise deny collection, so requests only contain minimal meaning context. Exact matches are still judged deterministically by the server with zero tokens, and the model can't write progress or rewards directly. (An intermediate candidate used `stealth/ox-alpha`, which never went live and has been removed.)
- Choosing answers and saving drafts in online exams no longer grades or returns any answers/explanations; only after a double-confirmed whole-paper submission or automatic submission at the deadline does the server grade all objective questions in the same submit transaction and combine the subjective questions into one model grading call. `in_progress` responses force `results=[]`.
- Node Q&A on a Luna Note re-attaches the original file when the source still exists; after the source is deleted it only uses the durable graph, the selected node, and adjacency. Subjective grading of Luna exams continues to use GPT-6 Luna/Azure, without resending the source material.
- The cleanup quota rules are unified: deleting while queued releases the reservation; deleting/cancelling while processing after the worker has accepted consumes once; deleting history doesn't refund quota or delete My Notes, and keeps the provider usage audit.
- API→FastAPI generation and grading now return 202 within 30 seconds, followed by internal-token callbacks for progress/usage/checkpoint/complete/fail; the compatibility synchronous routes remain temporarily for old application rollback and direct provider gates.
- The BullMQ single concurrency slot is now held until the Postgres terminal state or lease expiry, so FastAPI's 202 no longer pushes the backlog into process memory early; the worker limits total execution time for generation/grading to 1200/240 seconds, and generation timeouts can resume from the durable checkpoint.
- Recoverable errors reuse the same job within a default 24 hours. The database stores stage checkpoints, and the worker's 0700 directory additionally stores validated results and the usage spool; success, non-retry terminal states, and expiry all clean up, and retries reserve again and only consume Free quota on success.
- Resume scheduling first deducts the provider cost already persisted for that job/attempt before handing the remaining budget to the worker; the worker also counts the usage spool left over from a previous failed callback against its local hard gate, so even when the API is temporarily unavailable the recovery flow can't reset the per-job cost cap.
- Materials and My Notes keep their existing classes/tokens/fonts/animations in this phase; this doesn't expand into a site-wide React or visual migration.

### Removed

- Removed all code, types, UI, environment variables (`FEATURE_MATERIAL_AI_OX_ALPHA`, `MATERIAL_AI_OX_ALPHA_*`), release gates, and smokes for Ox Alpha (`stealth/ox-alpha`, removed from OpenRouter and never enabled in production); the install/activate/rollback scripts only strip the old keys.

### Fixed

- The real provider gate's fixed chart fixture now uses a 28px font: Pillow's default ~10px bitmap font made MiMo reasonably report an unreadable region (`AI_VISUAL_UNREADABLE`) in run `37158999212`, and the product rule fails closed on any unreadable region. The product rule is unchanged.
- Fixed protected release run `37156943711`: throughput sorting repeatedly routed DeepSeek exam generation to the same Wafer endpoint with runaway output (truncated at 10.5k tokens all four times). Unlocked routes now add that upstream to `provider.ignore` after a structured output failure and retry; locked routes such as Luna are unaffected.
- Fixed GPT-6 Luna requests being rejected by OpenRouter with HTTP 404 (`OPENROUTER_MODEL_UNAVAILABLE`) under `require_parameters=true`: the Azure endpoints only support `max_completion_tokens`, and no GPT-6 Luna endpoint supports `temperature`; Luna requests now use `max_completion_tokens` and omit `temperature`, and the original-file gate prints per-attempt upstream metadata on failure. (All DocumentIR fixtures had passed in protected release run `37154031417`.)
- Fixed DocumentIR exam generation in protected release runs `37150425945`/`37151943226` repeatedly failing with `AI_OUTPUT_TRUNCATED` (30k token cap) followed by `OPENROUTER_UNREACHABLE`: the exam output cap now scales with the question count, routing excludes fp4-quantized endpoints, the "recount before returning" prompt sentence that tended to trigger runaway output was removed, and the real provider gate prints per-attempt upstream/endpoint/tokens/duration (without content).
- Fixed the gap where, when the initial DocumentIR exam only had wrong per-type counts, repair only received source block IDs and couldn't read the source text, so answers/distractors/explanations/citations completely lost grounding after the structure turned green. Both the structural and semantic repairs in `exam-generate.v4` carry the full allowlisted `sourceBlocks` and an explicit `repairGate`, requiring minimal changes and per-question source support; if semantic defects are first found only after the structural repair, only one extra semantic repair is allowed, after which both the structural and semantic gates run again and fail closed, with no infinite retries or lowered quality bar.
- Fixed the PR #77 candidate sending the `json_schema` structured output that Ox Alpha doesn't support together with `require_parameters=true`, which made OpenRouter reject the real Courses translation gate with HTTP 404 and roll back automatically. The interactive API and the real release smoke now both use the `response_format:{type:"json_object"}` that the model metadata declares as supported, and strictly reject extra fields, missing fields, wrong types, and duplicate/unknown smoke cases locally; the Stealth-only, no fallback, provider checks, idempotent database facts, and fail-closed boundaries are unchanged. Non-2xx diagnostics only record the HTTP status, structured upstream code, and request ID, never answers, reference translations, prompts, provider messages, or API keys.

- Fixed exam generation/semantic repair occasionally returning a nonexistent `sourceRef.blockId`, causing candidates with the correct question count/total points to fail the structural gate with `SOURCE_REFERENCE`. The worker now keeps only citations within the DocumentIR allowlist and normalizes locators from server block metadata; it only restores a question's pre-repair citations when the stable question ID is the same and the repair removed all valid citations, or picks the only possible allowlisted block when the whole DocumentIR has exactly one block. Multiple blocks and cross-question/changed IDs are still never guessed, and the result must pass structural validation and semantic review again, so mechanical normalization can't fake grounding.
- Fixed the real Materials AI release gate collapsing the final `AI_EXAM_VALIDATION_FAILED` into a single code, which made it impossible to tell structural errors such as question count/total points/citations from semantic errors such as grounding/answers/distractors. The worker now only returns stable categories, the gate stage, and question/total-point counts, never course material, questions, answers, prompts, reviewer text, or provider bodies; the diagnostics don't change the current source-aware, bounded, and ultimately fail-closed repair strategy.
- The fixed PDF/DOCX/PPTX real provider samples were expanded from three facts, not enough to reliably support five questions, to eight independent learning-science facts with no personal data, so random failures to generate questions caused by an overly thin fixture aren't mistaken for a service fault; the question count, answer, semantic, citation, and cost gates were not relaxed.
- Fixed the real signed-in production smoke where the knowledge graph's lowest level started at `1`, passed worker validation, but was rejected by the completion RPC with SQLSTATE `22023`, after which the job stayed in `saving` until the 15-minute gate timed out. `knowledge-graph.v2` and `knowledge-graph-native-file.v2` now deterministically reset the minimum level to zero without changing node content, citations, order, or relative levels; the DocumentIR validator also adds `sourceMode=document_ir` and level-0 root checks to stay consistent with the database save contract.
- If a completion callback is still rejected by the database's result structure constraints, it atomically writes the corresponding exam/graph/Q&A/grading validation failure and returns a successful acknowledgement, letting the worker clean up its checkpoint/spool instead of treating a permanent error as a callback outage and recovering forever; provider routing violations likewise terminate while keeping usage, and expired leases map to 409 so the worker exits safely.
- Fixed the exam model in the real DocumentIR release gate occasionally returning `AI_EXAM_VALIDATION_FAILED` with "correct question count and valid per-question marks, but a total that doesn't equal the user's setting". `exam-generate.v3` and `exam-native-file.v2` now first deterministically normalize the language, difficulty, duration, total points, and duplicate section/question IDs from server-side settings, and where feasible stably redistribute per-question marks by their original relative weights; question count, answers, semantics, and citations are still strictly checked by the original validator/DeepSeek review. Review results with non-empty `issues` are no longer ignored because of `valid=true`.
- Fixed the real DocumentIR chart gate misjudging "pure image ranges the parser had isolated and were pending vision recovery" as a whole-file prompt injection and returning `PROMPT_INJECTION_REJECTED` before MiMo recovery. `material-safety-audit.v2` only lets a first-round `uncertain` with no deterministic injection signals, and whose uncertain positions all belong to the parser's failed ranges, enter isolated recovery; unknown ranges, parsed text/focus signals, and `malicious` are still rejected immediately, and the recovered full DocumentIR still fails closed under a strict second review.
- Real release run `31824832947` exposed that Luna's OpenAI-only + ZDR combination currently has no routable endpoint; the release correctly restored the old Web/API automatically, but this would block the DocumentIR/graph/job/exam improvements that had already passed. The forward fix splits the real gate into the old pipeline, which must pass, and a live Luna ZDR catalog decision: Luna is only turned on when a first-party OpenAI ZDR endpoint exists; otherwise it stably returns `OPENROUTER_ZDR_UNAVAILABLE`, keeps the sub-switch false, and lets users keep explicitly using DocumentIR, never turning off ZDR, switching to Azure, or allowing fallback.
- Fixed the OpenRouter adapter's overly broad classification that reported every HTTP 400/404 as `OPENROUTER_ZDR_UNAVAILABLE`; that code is now only used when the response explicitly contains ZDR/Zero Data Retention evidence, ordinary bad requests and unavailable models are `OPENROUTER_BAD_REQUEST` and `OPENROUTER_MODEL_UNAVAILABLE` respectively, and the raw provider body is still never recorded.

- Fixed old knowledge graph cards and details overlapping each other, nodes that couldn't be moved/zoomed, details permanently covering the graph, duplicated fields of the same kind, and all layout coordinates being lost after an artifact update; old node coordinates are reused by ID, new nodes are laid out again, and revision conflicts merge and retry.
- Fixed succeeded/failed jobs that couldn't be cleared, deleting active jobs only changing the UI without really interrupting them, and records disappearing before cleanup; a record is only finally deleted after the worker confirms the cancellation request and the usage spool and temporary directory have all been handled.
- Fixed answer draft responses possibly carrying grading results early; server serialization now strips answer fields from every `in_progress` attempt and forces empty results.
- Courses audio prewarm, manifest, and word audio preparation now only retry three times, with limits, on safely replayable Supabase 408/425/429/5xx, connection failures, and response body timeouts; final failures uniformly return a 503 with a retry hint instead of an uninformative 500. Reading Supabase REST/Storage response bodies is also included in the 20-second transport boundary, and release failures print redacted API logs containing only the route, error category, and upstream HTTP/stable code, never database bodies or user content.
- The real Courses audio release gate adds three bounded transient retries for idempotent prewarm/manifest and consumes JSON/audio bodies within the same timeout boundary; 401/403/contract errors still fail immediately. This way a single retryable upstream 500 no longer directly rolls back a candidate that already passed DeepSeek/MiMo, Azure, and Gemma, while persistent failures still block the cutover and keep diagnostic logs.
- The real Gemma release gate no longer treats the interactive API's 12-second SLA as the budget for the whole release smoke: each attempt has its own 30-second cap, all attempts share a 180-second hard budget, and the full response body is read within the same retry boundary. This way, even when 2xx response headers arrive but the body stream times out, it retries with the same pinned model within limits, instead of letting `DOMException TimeoutError` escape and falsely trigger a rollback without diagnostics; bad JSON/bad semantics, permanent HTTP statuses, and budget exhaustion still fail closed.
- Protected application releases now delete half-finished artifacts of the same SHA before upload, clean up abandoned incoming directories older than 24 hours, and only reclaim Nalanda images not referenced by any container or the current `.deploy.env`; they fail before cutover when free space is under 6 GiB. Failed candidates delete their own Web directory, incoming package, and images through the EXIT trap, so consecutive failures can't fill up the shared host's disk.
- Application rollback no longer makes the previous API wait for the optional AI container to become healthy: Redis/AI are restored separately on a best-effort basis, and the previous API is force-recreated with `--no-deps` from the audited image and independently verified for the process, authentication, and public contract. An AI container that is unhealthy because of disk watermarks or similar no longer escalates a failed protected release into an nginx 502; readiness failure logs also print the redacted `/health` dependency status.
- The protected release's real Gemma translation gate now only applies bounded exponential backoff for network errors and 408/425/429/5xx and honors `Retry-After`; 401/402/403, bad contracts, persistent rate limiting, or exceeding the wait budget still fail closed, so a single transient OpenRouter 429 no longer unconditionally rolls back a candidate release after the other real AI/Azure gates have passed.
- Fixed Node/Undici's default response headers timeout of about 300 seconds reporting normal long jobs as `AI_WORKER_UNREACHABLE`; the explicit dispatcher now distinguishes `AI_WORKER_TIMEOUT`, unreachability, and protocol errors.
- Fixed cost events or validated artifacts possibly being lost, and retries possibly paying again, when the provider had returned but the API callback disconnected; generation and grading now idempotently flush usage before complete/fail, and both grading results and generation stages are recoverable.
- Fixed `budgetMicroUsd` passed to FastAPI previously being only unused metadata; each incremental usage event now updates the worker budget before the next model call, and over-budget facts are still written to the spool/ledger first before failing closed.
- The Materials AI queue now labels each item as Test paper, Knowledge map, or Knowledge question; when the same file has several historical jobs, users and browser tests no longer mistake an old exam paper for the latest knowledge map.
- Fixed expired/exhausted retry RPCs rolling back their own cleanup after throwing; the terminal state now durably stores a stable error, which the API maps to 409.

### Testing

- After PR #78 merged as main `1281510c94b4da5a765211df8467f9a26be393f0`, run [`32931681321`](https://github.com/1590703336/Nalanda/actions/runs/32931681321) passed quality, 0007→0055, empty database/database lint, two-user RLS/Storage, fake Chromium, and production images, with no migration changes. The application candidate's 220-page canary passed, but the real DOCX's initial output entered repair with `QUESTION_TYPE_COUNT`; after repair the structure satisfied 5 questions/20 points, but the final semantic gate still reported quality defects in five categories, and the candidate rolled back automatically before running the Ox translation gate. The forward fix's local Python suite now covers the structural repair getting the full source blocks, one bounded repair for new semantic issues after the structural step, and strict termination when it keeps failing; new real provider/candidate/cutover evidence hasn't been produced yet.
- After PR #75 merged as main `ad4b98b041ccb38954ac3bba705b26a92b70cca2`, run [`32587844503`](https://github.com/1590703336/Nalanda/actions/runs/32587844503) passed quality, 0007→0053, empty database/database lint, two-user RLS/Storage, fake Chromium, and production images, with no migration changes. Application attempt 1's 220-page canary passed, but the fixed PDF still had 6 questions after one repair while the settings required 5, failed with `QUESTION_TYPE_COUNT`, and rolled back; attempt 2, the only rerun of the failed job, passed the full DeepSeek/MiMo Materials suite, injection/safe material, grading, the 9-node graph, and Japan East Azure (accuracy 98, pronunciation 98.8), Luna stayed false because the OpenAI-only ZDR was unavailable, and then the free Gemma model returned HTTP 429 five times in a row and it rolled back again. Neither attempt cut over; independent checks confirmed the old Web/API/AI, false flags, public health/auth, and candidate cleanup were normal, so PR #75 is merged but not deployed to production.
- After PR #74 merged as main `5b4cad883b628fd21cc1d104227be6dfb746834f`, run [`32585659792`](https://github.com/1590703336/Nalanda/actions/runs/32585659792) passed quality, 0007→0053, empty database/lint, two-user RLS/Storage, and fake Chromium. Production attempt 1's real Materials suite, 220-page canary, and Japan East Azure all passed, but the Gemma translation smoke still returned HTTP 429 after 5 bounded backoffs and rolled back; attempt 2, rerunning only the failed job on the same SHA, then failed with `SOURCE_REFERENCE` when both the first generation and the repair for a single-block PDF returned invalid citations. Neither candidate cut over, and independent production health was normal. The single-block regression fix passed ruff and 78 Python tests locally; real providers, Gemma, Azure, the signed-in smoke, cutover, and independent public verification still have to be proven by a new PR/main run.
- After PR #71 merged, the first execution of main run [`32543270581`](https://github.com/1590703336/Nalanda/actions/runs/32543270581) passed the full fake/local gates and the real Materials provider suite, but Japan East Azure TTS returned HTTP 401 and the candidate rolled back automatically before cutover. Attempt 2, retried at the user's request, passed the 220-page resource canary (main/child process peaks 107,868,160/221,601,792 bytes), then the fixed DOCX exam failed the initial semantic review, and after one repair only the final structural code `SOURCE_REFERENCE` remained, rolling back again before cutover. New regressions passed ruff and 77 Python tests locally, covering citation dedupe/normalization, same-question restoration, changed question IDs failing closed, and the second semantic review after restoration; real providers, Azure, candidate activation, and independent public verification still have to be proven by a new main run.
- PR #70's full gate run [`32499521666`](https://github.com/1590703336/Nalanda/actions/runs/32499521666) passed and it was merged as main `e6fa854dd6517a2a2ccd4152b60ca37078f6af4e`. Main run [`32540131549`](https://github.com/1590703336/Nalanda/actions/runs/32540131549) again passed lint/typecheck, 131 API, 113 Web, and 72 Python tests, 0007→0051, empty database/lint/RLS/Storage, fake Chromium, image builds, and the 220-page canary, but the real DOCX exam returned `AI_EXAM_VALIDATION_FAILED`; the candidate rolled back and was cleaned up before the API/Web cutover, so this run isn't evidence of going live in production.
- The validation diagnostics/fixture forward fix passed 74 Python tests, ruff, 26 release tooling tests, and `git diff --check` locally; real providers, full CI, and production activation still have to be proven by a new PR/main run.
- PR #69 and main run [`31838779292`](https://github.com/1590703336/Nalanda/actions/runs/31838779292) passed the fake/local gates, real provider fixtures, the 220-page canary, and the Azure/Courses gates; the signed-in production smoke's fixed knowledge graph returned 3 nodes/2 edges but no level-0 root, the database rejected the completion callback, and candidate `669f3f423e712fe561496dae6b0ab9b16c799025-31838779292-1` didn't switch the Web and automatically restored the old API/AI. This run is evidence of finding and isolating a release defect, not of going live.
- The root node/completion callback forward fix passed 72 Python, 131 API, and 113 Web/jsdom tests locally, plus ruff, docs 55, release tooling 26, lint, typecheck, and the Web/API build; real Supabase, Chromium, and real providers still have to be proven again by a new PR/main/protected run.

### Security

- Luna's model/provider/reasoning/format capabilities are all pinned by the server; clients can't choose models or execute Materials AI workflows directly. Luna fails closed when the live ZDR catalog has no Azure endpoint; usage from a first-party OpenAI upstream is treated as a routing violation by the database completion transaction.
- The 2026-08-22 go/no-go review confirmed the compatibility observation had exceeded 24 hours; neither the live nor the latest Web submits the two time fields, Redis PING/AOF/noeviction are normal with no errors/evictions, and the points ledger/Profile projection difference is 0. Read-only plan run `32581192318` listed only 0052–0053; protected run `32581805613` applied and verified up to 0053 after artifact `9478168126`. The latest application candidate of that run was stopped twice by the real Materials AI PPTX gate and automatically restored `3c095a55ced21cee11a1b3131dd2889ec1f70733`, so the database permissions are live, but the latest main application didn't cut over.
- The new checkpoint tables aren't readable by clients; knowledge Q&A is readable only by the owner and can't be written by clients. All new RPCs revoke EXECUTE from `public/anon/authenticated`, and questions and source content continue to be treated as untrusted data that can't change the model, tools, or system prompt.

## [0.11.1] - 2026-08-11

### Fixed

- The pinned Materials AI OpenRouter route adds exponential backoff within a shared wall-clock budget for network errors and 408/429/502/503/504, honoring numeric `Retry-After`; it provides no cross-model fallback, and lets the same pinned model prioritize throughput and fail over only between provider endpoints that satisfy the ZDR, deny data collection, and parameter support filters. Optional reasoning is pinned off to avoid `message.content=null` after the completion budget is exhausted; 401/402/403 and ZDR/parameter errors fail immediately, and real gate failures only print stable worker/provider purpose/error codes without echoing response bodies.
- Fixed the false green in protected deploys where the remote heredoc was inherited as stdin by `docker compose exec -T`, which swallowed the rest of the script early but exited with status zero; every remote compose exec now explicitly reads `/dev/null`, and release tooling tests reject reintroducing bare calls.

### Testing

- PR [#56](https://github.com/1590703336/Nalanda/pull/56) run [`31462982923`](https://github.com/1590703336/Nalanda/actions/runs/31462982923) and PR [#57](https://github.com/1590703336/Nalanda/pull/57) run [`31465041901`](https://github.com/1590703336/Nalanda/actions/runs/31465041901) both passed docs/lint/typecheck, 104 API, 105 Web/jsdom, and 25 Python AI tests, the AI/API/Web build, real Redis, 0007→0043, empty-database rebuild/lint, two-user RLS/Storage, and fake-provider Chromium Playwright. Fake Playwright isn't proof of real models.
- Main verification run [`31465776658`](https://github.com/1590703336/Nalanda/actions/runs/31465776658) passed; a separate read-only plan [`31465816321`](https://github.com/1590703336/Nalanda/actions/runs/31465816321) confirmed local/remote were both at 0043 with an empty dry-run, and nothing was written to the database or deployed.

### Release

- Final protected run [`31467153739`](https://github.com/1590703336/Nalanda/actions/runs/31467153739) created and uploaded the 14-day encrypted recovery artifact [`9092230348`](https://github.com/1590703336/Nalanda/actions/runs/31467153739/artifacts/9092230348) (824,125 bytes, artifact zip SHA-256 `6939309024094791bb639112eaf73a1429d588a4800c42703e579185a0aa817f`), and confirmed the 0041–0043 history, an empty dry-run, and remote database lint.
- The near-limit Office canary processed 220 pages/366,412 characters, with main process peak about 101.8 MiB and child process about 211.9 MiB, and no OOM or neighbor-site failure. The real OpenRouter gate used the pinned DeepSeek/MiMo to complete PDF/DOCX/PPTX/chart, partial vision recovery, injection rejection, safe material acceptance, and subjective grading; real Japan East Azure, Gemma translation, and queue/private Storage/duplicate word reuse/scoring all passed too.
- The signed-in production smoke completed `queued → succeeded` generation, asynchronous grading, one consumption each of the two Free quotas, 5 provider usage rows, source and result cleanup, and returned `deps.supabase=ok/deps.ai=ok`; the temporary directory cleanup gates before and after the job passed.
- Immutable release `e6ce0cb246d9fc1ecc1c4869b6e63d09d3256bd4-31467153739-1` activated healthily at `2026-08-11T07:20:02Z`, with the API/AI images and Web symlink all pointing at that commit and `FEATURE_MATERIAL_AI=true`. Independent public re-check: home page 200, `/api/health` `deps.supabase=ok/deps.redis=ok`, `/api/health/ai` worker/queue ok, and anonymous `/api/me` and `/api/profile/ai-quota` both 401.
- The earlier main run [`31463661987`](https://github.com/1590703336/Nalanda/actions/runs/31463661987) showed green, but independent checks found production was still on the old image/Web with flag=false and the AI endpoint returning 404; the root cause was exactly the first remote `compose exec` consuming the heredoc stdin. That run wasn't counted as going live, and the release only happened after the fix went through the full protected gates again.

## [0.11.0] - 2026-08-10

### Added

- Added the 0041–0043 Materials AI release candidate: the Free plan, dual generation/grading quotas that reset by Profile time zone, durable generation jobs/events, a private parse cache, real Notes/source snapshots, online answer sheets/idempotent drafts/grading facts, redacted provider usage, and full structure/RLS/RPC assertions.
- Each Materials file gets a "Use AI" menu that reuses the existing visuals and bilingual locale; only "Generate test paper" is open, and the other three show Coming soon. My Notes groups real Materials courses/exam papers separately from the historical Demo; Profile shows the Free plan's two quotas.
- NestJS adds owner-only AI/Notes/Exam APIs, reservation transactions consumed on success, Postgres durable jobs, BullMQ UUID scheduling/reconciler/delayed submission, and internal callbacks; FastAPI adds PDF/DOCX/PPTX/Markdown/HTML/TXT/JSON/CSV/image parsing, selective MiMo vision recovery, two injection reviews, strict DeepSeek exam generation, and batched subjective grading.
- Added the protected deploy's AI image, private Redis/worker readiness, the real model fixed-sample gate, the 2G resource canary, temporary directory orphan cleanup, and automatic rollback on failure.

- Added and released stage one, 0039–0040: points daily windows frozen to the user's time zone, stable business-key reward decisions, the owner-only reward receipt, daily cap notifications, append-only moderation reversals, and four kinds of pending-review-only coordination signals.
- NestJS adds same-host private Redis atomic Lua sliding windows, IP+email dual rate limiting for sign-up, layered rate limiting for authenticated/Courses/public market, HMAC abuse aggregation, real Redis readiness, and the points admin API; coordination scanning uses a distributed lock and never penalizes automatically.
- Production compose adds a private-network Redis with password authentication, AOF `everysec`, and `noeviction`, plus atomic secret installation, nginx standard JSON 429s, configuration validation, and the two-phase release scripts/gates.

### Changed

- Direct Supabase writes to posts are narrowed to a content column allowlist, with owner/author snapshot/counts/repost/key/times maintained by the database; Feedback users can only add/read; Schedule references are validated by an owner trigger, and `done_at` is derived by the database.
- After community and task business writes succeed, the Web app reads the server points receipt, and the over-cap notice doesn't roll back the content action; the Courses outbox keeps the same attempt UUID on 429 and resumes serially per `Retry-After`, and audio manifest polling backs off without falsely reporting a permanent failure.

### Security

- Materials AI always uses the server-side OpenRouter key, `deepseek/deepseek-v4-flash-0731`, and `xiaomi/mimo-v2.5`, and requests require ZDR, deny data collection, and forbid tools/Web and provider parameter downgrades; malicious or uncertain prompt injection is always rejected and the quota released.
- Every AI transactional RPC revokes `public/anon/authenticated` EXECUTE; users can only read their own jobs/quota/Notes/answer sheets and can't write caches, provider usage, results, scores, or quotas. Each job's 0700 temporary directory is cleaned up in `finally` on success, failure, cancellation, and timeout.
- Deleting a Note/subject that has graded answer sheets in Materials AI no longer rolls back because of the provider usage foreign key being set to null; job/attempt UUIDs are kept as immutable cost audit references, content deletion can't erase monthly budget facts, and deleting the Auth owner still cascades the cleanup.
- The Materials AI near-limit Office resource canary now explicitly runs the script mounted at `/tmp` with `PYTHONPATH=/app`, and runs the same full rendering with 640MB/896MB, 0.75 CPU, and 128 pids as production in the ordinary CI image gate, so module path drift in the image isn't first discovered at production activation.

- The new internal points/audit tables are completely hidden from clients; the service role also only has SELECT, and every reward, signal review, moderation, and audit change runs through controlled functions with a pinned `search_path`. New functions revoke `public/anon/authenticated` EXECUTE by default.
- Historical points grandfathering only treats business keys with a positive transition-1 entry as actually rewarded; 0008/0009 zero-amount placeholders can never be reversed/reclaimed, and existing unsourced negative transitions are zeroed by an equal append-only `grandfather-zero-reset-v1`, so they can't swallow future legitimate points.
- Ordinary rewards and manual moderation take a shared/exclusive advisory gate respectively, with a unified Profile→state row lock order; repeated moderation leaves a 0-change audit and is no longer confused with "target doesn't exist".
- When Redis fails, sign-up, writes, cloning, reporting, and cost paths fail closed, while private reads fail open and record a redacted degradation event; logs and the database never store raw IPs, emails, content, or course content.

### Testing

- Added Python parsing/security/vision range/cleanup/schema tests, Nest quota/idempotency/queue/revision/deadline/grading tests, Web queue/Demo/real Notes/drafts/timer/account isolation jsdom, two-user AI RLS, fake-provider Playwright, real provider smokes, and the near-limit Office resource canary. Fake automation isn't real model or production evidence.

- Added two-user negative RLS for posts/Feedback/Schedule, points concurrent caps/time zones/delete-recreate/suppress-restore/coordination signals, Redis Lua/route classification, Web cap notices and 429 fallback, and nginx/secret install script regressions. Real Redis, a one-off Supabase, the nginx container, and Playwright must still produce evidence through PR/main CI; local skips don't count as passing.

### Release

- 0041–0043 haven't reached production yet; `FEATURE_MATERIAL_AI` may only be turned on after full CI, a read-only migration plan, an encrypted recovery point, real OpenRouter/ZDR fixed samples, the 2G canary, `deps.supabase=ok`/Redis/AI readiness, and the public signed-in user smoke all pass.
- PR [#51](https://github.com/1590703336/Nalanda/pull/51) and PR [#52](https://github.com/1590703336/Nalanda/pull/52), which fixes the remote SSH heredoc stdin, are merged into main; PR/main CI both passed quality, real Redis, 0007→0040, empty database/lint, two-user RLS/Storage, and Chromium Playwright.
- [Read-only plan `31372198037`](https://github.com/1590703336/Nalanda/actions/runs/31372198037) confirmed local/remote are both at 0040 with an empty dry-run; [protected run `31372888441`](https://github.com/1590703336/Nalanda/actions/runs/31372888441) kept encrypted recovery artifact `9057062920` (800,819 bytes, zip SHA-256 `81820da75dc4f0591ffd6f73ba3ac175a5b04f6995af8f8c508f60e56379a2f4`) and verified remote history, database lint, and an empty dry-run.
- Immutable release `56100e6bc2a4c70aa289aaad4b43efa1267428bd-31372888441-5` was activated at `2026-08-10T09:35:34Z`. Redis PING/AOF/private-port/noeviction and the nginx config passed; real Japan East Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8, real OpenRouter Gemma returned 253/27/280 tokens, and the candidate API/Storage gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=98.2`, `transcriptionMatched=true`. The public re-check confirmed `deps.supabase=ok/deps.redis=ok`, anonymous me/admin 401, sign-up `RateLimit-*`, and Web and Course Market 200.
- The first apply run had already applied 0039–0040 safely, but the Redis `docker compose exec` consumed the remote heredoc stdin, so the workflow falsely reported a successful deployment while the application hadn't switched; PR #52 fixed it by detaching stdin and adding regression tests. Afterwards, one timeout and three transient 429s on the OpenRouter free route were all blocked before cutover; after the same credential's quota was confirmed normal and real diagnostics from the local machine/production host returned 200 again, the fifth attempt passed completely. No failed candidate was counted as going live.
- 0039–0040 are now under production compatibility observation; only at the earliest `2026-08-11T09:35:34Z` and after the go/no-go passes may 0044–0045 be created separately to revoke the compatibility time-column grants. 0041–0043 are pure Materials AI additions and don't revoke anything.

## [0.10.2] - 2026-08-04

### Added

- Added OpenRouter `fish-audio/transcribe-1` Chinese speech recognition, only for the translation input before spelling: record at the right end of the input, and after recognition the text is only filled in without auto-submitting, so the user can keep editing.
- Translation voice input, recognition read-aloud feedback, and the pronunciation exam share a live waveform component; recordings are still only handled in request memory, and user audio is never persisted.
- Added 0037–0038: service-role-only STT active session/revision/word validation, per-user minute/local-day quotas, an independent monthly budget reservation, and structure/permission release assertions.

### Security

- The STT model, language, and reference learning state are all pinned by the server; clients can't choose the provider, read the OpenRouter key, bypass the current-question check, or advance progress/rewards directly through recognition results.

### Testing

- PR [#49](https://github.com/1590703336/Nalanda/pull/49) run `30904901828` passed docs/lint/typecheck, 72 API tests, 85 Web/jsdom tests, build, 0007→0038, empty-database rebuild/database lint, one-off real local Supabase two-user RLS/Storage E2E, and Chromium Playwright; Playwright's Azure/OpenRouter were still fakes.
- After topping up, an independent real OpenRouter smoke successfully called `fish-audio/transcribe-1` with a 0.526-second, 16 kHz mono synthetic Chinese WAV; the recognition result contained the expected keyword and recorded about `$0.0001` of provider cost; a real `google/gemma-4-26b-a4b-it:free` structured smoke succeeded at the same time. This evidence proves the endpoint/key/quota and the fixed Chinese sample worked at the time, and doesn't represent real users' accents, physical microphones, or sustained accuracy.

### Release

- PR #49 merged into main SHA `66c919833693971ba1bda4ea33a3fdf6717ef1ca`; main run `30905971129` completed verification and skipped production writes per the migration protection rule. The read-only [plan run `30906629924`](https://github.com/1590703336/Nalanda/actions/runs/30906629924) first hit a transient upstream error from the one-off Supabase; after rerunning only the failed job on the same SHA, real RLS/Storage and Playwright passed, and the final dry-run listed exactly 0037–0038, without creating a recovery point, writing to the database, or deploying.
- [Protected apply/deploy run `30907716733`](https://github.com/1590703336/Nalanda/actions/runs/30907716733) kept encrypted artifact `8892006761` (`db-recovery-66c919833693971ba1bda4ea33a3fdf6717ef1ca`, 730,159 bytes) before apply, then applied 0037–0038 and passed the structure/permission assertions, remote database lint, and an empty dry-run.
- Before activation, immutable release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1` passed real Japan East Azure (10,656-byte MP3, accuracy 98, pronunciation 98.8), real OpenRouter structured grading, and the production candidate API's Azure Chinese WAV→Fish Audio STT gate; the latter returned `transcriptionMatched=true`, while the Courses API/Storage gate verified `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=96.4`. The independent public re-check confirmed `/api/health` `status=ok` with `deps.supabase=ok`, anonymous `/api/me` 401, and the Web returning new React assets; a read-only check on the production host confirmed the Web symlink and API image both point to the same main SHA.

## [0.10.1] - 2026-08-04

### Added

- Added 0035–0036: converge `learned_at` into an exact derived value maintained by a database trigger, and verify at release the current data, constraints, triggers, exam writes, no writes from reviews, and no client table permissions.

### Changed

- Pronunciation scoring recordings remove the browser-side 20 ms VAD, noise threshold, 250 ms minimum clear-speech check, leading/trailing silence trimming, and 6-second content truncation; during recording the browser's echo cancellation, noise suppression, and auto gain control are explicitly off, and every frame the user actually recorded is kept. The client only performs the 16 kHz mono PCM WAV conversion required by the Azure REST contract and records at most 6 seconds; the server still limits 2 MB/8 seconds and forwards the unmodified WAV to Azure.
- `learning_word_progress.learned_at` now always equals the later of the two exam pass times; it is forced to null when either exam fact is missing. Initial learning, reviews, single exams, client state, and direct assignment can't create mastery.

### Fixed

- Fixed the local adaptive threshold falsely reporting "no clear speech detected" and preventing recordings from reaching Azure with quiet speech, low-gain microphones, fast onsets, or speech already under way when recording started.

### Testing

- Added WAV regressions that silence, low-amplitude audio, leading/trailing frames, and the full duration are never removed by the client; API unit tests assert uploaded bytes are forwarded to Azure unchanged; real Supabase E2E asserts that manually writing `learned_at` or having only one exam fact still means not learned.

### Release

- PR [#47](https://github.com/1590703336/Nalanda/pull/47) merged into main SHA `51252527645d9438df0414f056c8a3b088b360d8`; final PR run `30831319634` and main run `30831964846` passed docs/lint/typecheck, Web/API tests, build, 0007→0036, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Playwright's Azure/OpenRouter were still fakes.
- [Read-only plan run `30832581552`](https://github.com/1590703336/Nalanda/actions/runs/30832581552) confirmed the production remote was complete through 0034 with 0035–0036 as the only pending items; the recovery, apply, and application deploy steps were all skipped.
- [Protected apply/deploy run `30833228406`](https://github.com/1590703336/Nalanda/actions/runs/30833228406) kept encrypted artifact `8864033351` (`db-recovery-51252527645d9438df0414f056c8a3b088b360d8`, 657,467 bytes, digest `sha256:36a9ec08516dff5cb198511d71b69bb63533727cad9826db050dff4a33025625`, retained until 2026-08-17) before apply, then synced remote history to 0036 and passed the 0036 structure/permission assertions, remote database lint, and an empty dry-run.
- Before activation, immutable release `51252527645d9438df0414f056c8a3b088b360d8-30833228406-1` passed direct real Japan East Azure (10,656-byte MP3, accuracy 98, pronunciation 98.8), real OpenRouter (253/27/280 tokens), and the Courses API/Storage gate (`generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=96.4`, untrimmed `assessmentBytes=88444`). The independent public re-check confirmed `/api/health` `status=ok` with `deps.supabase=ok`, anonymous `/api/me` 401, the Web returning new React assets, and Course Market returning 200. No real user account was used to submit full spelling/pronunciation exams in production, so the release gates can't be described as production user exam-flow E2E.

## [0.10.0] - 2026-08-03

### Added

- The Courses exam entry adds a "Pronunciation exam": by default it requires 90% accuracy on the full first round (configurable 1–100%), shows words shuffled one per question, and judges them with the existing Azure pronunciation scoring; after each scoring, right or wrong, it stays on the score, phoneme feedback, translations, and "Hear the correct pronunciation" until the user moves to the next word.
- At the end of each pronunciation exam round, all wrong words, that round's scores, IPA, translations, and standard audio are shown durably; only after the user confirms does the server shuffle the wrong words and start the next round. Once the first round meets the threshold and all retry rounds are complete, only the pronunciation exam pass facts of the words selected this time are recorded.
- Added 0029–0030: the exam kind contract, the pronunciation exam workflow, the general retry round confirmation RPC, current-question validation before pronunciation scoring, and structure/permission self-verification.
- Reviews and both exam types can now tick any 1–2,000 words within the selected unit; the server validates dedupe, owner, course/unit membership, and the `unlearned` scope, and pins the selected set into a separate session.
- Courses adds exam history and details: lists at most the latest 100, distinguishing in progress, cancelled, passed, and "first round failed but every wrong answer has been corrected", and shows the word selection, error counts, per-attempt spelling/pronunciation results, and times. Exam word forms, translations, IPA, and final results use owner-private snapshots, so later editing or deleting words never rewrites existing exams; deleting a whole course still cascades the history per the existing rules.
- The course editor shows cumulative error counts, review counts, and whether each existing word is learned; these read-only attributes are never written back with the course content payload.
- Added 0031–0032: custom review/exam scopes, the `practiceCompleted` fact, private immutable exam word snapshots, owner-scoped history RPCs, and exact permission/structure self-verification.
- Added 0033–0034: `spelling_exam_passed_at`, `pronunciation_exam_passed_at`, the dual-exam check constraint, the single `learned_at` projection, the content edit revocation trigger, single-RPC snapshot fields, and structure/permission self-verification. The migration back-fills both facts from provably passed exams and clears `learned_at` that was formed only by old reviews or single exams.

### Changed

- The vocabulary mastery rule converges on a single condition: the same word must separately pass and fully complete both a spelling exam and a pronunciation exam, and is only marked learned once both exam facts exist. The initial four stages and reviews of any count/date only keep practice facts and no longer create mastery; passing either exam alone doesn't raise course mastery either.
- The course editor shows per word whether each of the two exams has been passed. Changing the English revokes both exams, changing translations only revokes the spelling exam, and changing IPA only revokes the pronunciation exam; any exam fact becoming invalid clears that word's `learned_at`.

### Security

- The pronunciation exam's per-word 70-point pass mark (adjustable through the existing server environment variable), first-round accuracy, wrong-word pool, rounds, error counts, and `learned_at` are all decided by service-role transactions; the Web app only displays responses. The pre-scoring RPC also validates the owner, active session, and current word, so forged `wordId`s can't consume Azure quota.
- Custom `wordIds` can't change the owner/scope security boundary; browsers can't call the selection or exam history RPCs directly. An exam that missed the first-round threshold, even after automatically completing every wrong-answer correction, only writes `practiceCompleted=true` and never `learned_at`.
- `learning_word_progress` adds a database constraint forbidding `learned_at` when either exam pass fact is missing; the review advancement function no longer contains forward mastery writes, and the internal mastery/edit functions and the snapshot RPC remain service-role only.

### Testing

- Added API parameter/RPC mapping, exam kind UI, standard audio after scoring, live accuracy, end-of-round wrong-word scores, manual confirmation/shuffled retakes, pronunciation mastery projection after passing, two-user RPC rejection, and a fixed-recording Chromium flow; automated Azure is still a fake and can't serve as real provider or production release evidence.
- Added API/jsdom for arbitrary word selection in reviews/exams, automatic completion of failed exams, exam history list/detail, and read-only editor learning attributes, plus RLS/Playwright coverage of selected RPC owner/scope, redacted history, client rejection, unchanged history snapshots after course edits, and failed exams not writing mastery.
- Added regressions that cross-day three-skill reviews still don't make words learned, single exams still don't, both exams in either order jointly do, failed exams don't write exam facts, content edits revoke precisely, and the snapshot mapping; 0034 verifies the single projection and permission boundary on empty databases/upgrades.

### Documentation

- Unified the Courses `learned_at` documentation on the single server projection of "spelling exam fact + pronunciation exam fact"; added that reviews only record practice, single exams don't create mastery, edit revocation, course progress/growth projection, the security boundary, and a layer-by-layer code index across Web/shared types/NestJS/migrations/tests. Updated the points product rules, ERD, API, testing, privacy, monitoring, and project status accordingly.

### Release

- PR [#45](https://github.com/1590703336/Nalanda/pull/45) merged into main SHA `1a58d2164f6d58feea4d3a2c8925211b8cc60dde`; final PR run `30811283164`, main run `30811817461`, and protected run `30813047562` passed docs/lint/typecheck, Web/API tests, build, 0007→0034, empty-database rebuild/database lint, real local Supabase two-user RLS/Storage E2E, and Chromium Playwright. Playwright's Azure/OpenRouter were still fakes.
- [Read-only plan run `30812467085`](https://github.com/1590703336/Nalanda/actions/runs/30812467085) confirmed the production remote was complete through 0028 with 0029–0034 as the only pending items; the recovery, apply, and application deploy steps were all skipped.
- [Protected apply/deploy run `30813047562`](https://github.com/1590703336/Nalanda/actions/runs/30813047562) kept encrypted artifact `8855819351` (`db-recovery-1a58d2164f6d58feea4d3a2c8925211b8cc60dde`, 593,399 bytes, digest `sha256:5f36f770aab133f24e12d461e66b0c4b744303ca1dbfd1600215163e4ad14796`, retained 14 days by the workflow) before apply, then synced remote history to 0034 and passed the 0030/0032/0034 structure/permission assertions, remote database lint, and an empty dry-run.
- Before activation, immutable release `1a58d2164f6d58feea4d3a2c8925211b8cc60dde-30813047562-1` passed real Japan East Azure (10,656-byte MP3, accuracy 98, pronunciation 98.8), real OpenRouter (1,604 ms, 253/27/280 tokens), and the Courses API/Storage gate (`generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`). The independent public re-check confirmed `/api/health` `status=ok` with `deps.supabase=ok`, anonymous `/api/me` 401, the Web returning the React root, and Course Market returning 200. No real user account was used to submit full spelling/pronunciation exams in production, so the release gates can't be described as production user exam-flow E2E.

## [0.9.0] - 2026-08-01

### Added

- In-progress Courses learning/review pages add a bilingual "Cancel learning" next to "Pause and return". After confirmation, the session is explicitly terminated by a server transaction and can't be resumed; confirmed attempts, error counts, and mastery history are kept, linked review schedules aren't cancelled, and a new session can be started afterwards.
- Added 0025–0026: `learning_cancel_session` with owner validation, row locks, and revision advancement, plus exact function definition and service-role-only permission assertions.
- When a spelling round ends with wrong words, a durable end-of-round review page shows each one's English, IPA, separate translations, and pronunciation; only after the user confirms does the server shuffle the wrong words and start the next round.
- Added a separate exam mode: by default it requires 90% first-round accuracy, supports a custom 1–100%, shows live first-round accuracy, and shuffles every word in the selected unit to test only "translation pre-test + spelling". Only after the first round passes and all wrong-answer practice is complete does the server mark the unit's words learned.
- Added 0027–0028: the `exam` session, first-round exam facts, the spelling retry round confirmation boundary, actual provider quota reservation for semantic judgement, and the corresponding structure/permission assertions.

### Changed

- OpenRouter quota is no longer consumed by deterministic exact matches, idempotent replays, or merely claiming a judgement lease; only an imminent real model judgement reserves quota. The default is still 20 per minute per user, and the rolling 24-hour limit rises to 500; 429 responses carry the number of seconds to wait before recovering.

### Security

- Cancellation only runs through NestJS and a service-role RPC; browsers can't call the RPC directly. After the server confirms cancellation, the Web app only clears the current account's and current session's not-yet-synced IndexedDB answers and can't affect other sessions or accounts.
- The retry pool, exam scores, pass status, `learned_at`, points, and badges continue to be decided only by database transactions; the exam UI's live accuracy isn't a client-writable growth fact. The new exam, round confirmation, and quota RPCs all reject public/anon/authenticated execution.

### Testing

- Added Web, API, and real Supabase regression coverage for the cancel button/confirmation/return, session-scoped outbox cleanup, API mapping/cross-owner hiding, RPC idempotent cancellation/revision, and client execution rejection.
- Added API, jsdom, RLS, and Playwright coverage for the end-of-round wrong-word list/audio/manual confirmation, retry reordering, default/custom exam thresholds, live accuracy, unit mastery after passing, zero quota for deterministic matches, real provider reservation, rolling limits, and permission boundaries.

### Release

- PR [#40](https://github.com/1590703336/Nalanda/pull/40) merged into main SHA `93354a56044470fb5d2b1fd6aeabcf82f459bb52`; PR run `30705662543` and main run `30705946921` both passed quality, 0007→0028, empty-database rebuild/database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright. Playwright's Azure/OpenRouter were still fakes.
- [Read-only plan run `30706279006`](https://github.com/1590703336/Nalanda/actions/runs/30706279006) confirmed the production remote was complete through 0024 with 0025–0028 as the only pending items; the recovery, apply, and application deploy steps were all skipped.
- [Protected apply/deploy run `30706731292`](https://github.com/1590703336/Nalanda/actions/runs/30706731292) kept encrypted artifact `8820657507` (`db-recovery-93354a56044470fb5d2b1fd6aeabcf82f459bb52`, 418 KB, digest `sha256:02ea6fef5481756b17f79fbbd82c023d9c9ba085accfc1e28f9a268d24645ad9`, retained 14 days by the workflow) before apply, then synced remote history to 0028 and passed the structure/permission assertions, remote database lint, and an empty dry-run.
- Before activation, immutable release `93354a56044470fb5d2b1fd6aeabcf82f459bb52-30706731292-1` passed real Japan East Azure (10,656-byte MP3, accuracy 98, pronunciation 98.8), real OpenRouter (9,364 ms, 253/27/280 tokens), and the candidate Courses API/Storage gate (`generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`). The independent public re-check confirmed `/api/health` `status=ok` with `deps.supabase=ok`, anonymous `/api/me` 401, and the Web returning the React root; a signed-in read-only check confirmed existing courses/progress were still readable and the exam configuration showed the 90% default. No real user exam answers were submitted in production, so this read-only UI check can't be described as production exam-flow E2E.

## [0.8.2] - 2026-07-31

### Changed

- Spelling questions now judge "only punctuation differs" as correct: omitting, replacing, or adding punctuation doesn't enter the retry pool, so for example `You're welcome.` / `Youre welcome!` and `check-in` / `check in` / `checkin` all pass. Letters, digits, word order, and inter-word spaces with no punctuation involved must still be correct, so `ice cream` / `icecream` is still wrong.
- The Web app's instant feedback and the seven-parameter authoritative database attempt RPC share the same three-way comparison: "punctuation kept, punctuation removed, punctuation treated as spaces"; the raw answer is still written to the append-only attempt, and the retry pool, error counts, progress, and rewards are still decided only by the server.

### Testing

- Added Web units/jsdom for punctuation omission/substitution/addition, full-width caps, real letter errors, and space errors without punctuation; appended the 0023–0024 database migrations, self-verification, and two-user RLS cases, verifying that punctuation tolerance doesn't increase `wrong_count`/the retry pool and that internal helpers still reject client execution.
- PR #37, main, and the protected release run all passed docs/lint/typecheck, Web/API tests, build, the 0007→0024 upgrade, empty-database rebuild, database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright. Playwright's Azure/OpenRouter are still fakes, and real provider evidence only comes from the production activation gate.

### Release

- PR [#37](https://github.com/1590703336/Nalanda/pull/37) merged into main SHA `9b62951a8895aa6cf3ff0f9dce8395df239e6089`; PR run `30620350644` and main run `30620879282` passed fully. [Read-only plan run `30623522232`](https://github.com/1590703336/Nalanda/actions/runs/30623522232) confirmed the remote stopped at 0022 with 0023–0024 as the only pending items, without creating a recovery point, writing to the database, or deploying the application.
- [Protected apply/deploy run `30624104943`](https://github.com/1590703336/Nalanda/actions/runs/30624104943) kept encrypted recovery artifact `8790816378` (`db-recovery-9b62951a8895aa6cf3ff0f9dce8395df239e6089`, 366,417 bytes, digest `sha256:887b1ac42c267ca7bb1cde810920702dde64f8d74112b3b39def6254d5bf0fca`, retained until 2026-08-14) before apply, then synced remote history to 0024 and passed the function/permission assertions, database lint, and an empty dry-run.
- Before activation, immutable release `9b62951a8895aa6cf3ff0f9dce8395df239e6089-30624104943-1` passed real Japan East Azure (10,656-byte MP3, accuracy 98, pronunciation 98.8), real OpenRouter (2,790 ms, 253/27/280 tokens), and the candidate Courses API/Storage gate (`generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`). The independent public re-check confirmed `/api/health` `status=ok` with `deps.supabase=ok`, anonymous `/api/me` 401, and Web 200 returning the React root. No real user account was used to submit spelling answers in production; migration self-verification and the one-off real Supabase E2E are the evidence for this judgement behavior.

## [0.8.1] - 2026-07-31

### Fixed

- Instant spelling judgement and the authoritative database judgement now use the same English normalization contract: NFKC compatibility characters, ASCII case, leading/trailing/repeated Unicode whitespace, curly/straight apostrophes, and common hyphen variants produce consistent results; punctuation itself must still be present. Fixes all-caps or IME-produced full-width caps being accepted by the frontend first and then judged wrong by the server and added to the retry pool.
- The Courses weak-network answer notice now has separate waiting/success states: once all pending answers are confirmed by the server it shows "Answers synced" for two seconds and disappears automatically, and a later timeout brings back the saved-locally notice; normal online answering doesn't show a sync success per question.
- After a correct spelling answer, the feedback with the correct spelling and translation now stays for 1.5 seconds instead of about 520 ms; translation multiple choice and pronunciation matching keep their original fast pace. The spelling card always shows the current timer state: during the translation pre-test it shows the configured seconds and "Timer starts after the translation passes", once spelling input begins it shows the live countdown, and untimed sessions are labeled explicitly.
- Translation multiple-choice questions reset the previous round's local options when a word enters a new retry round; even when the retry pool only contains that one word, old wrong options aren't carried over and don't block the correct answer from advancing to the next stage.

### Testing

- Web units/jsdom cover full-width all caps, curly apostrophes, hyphen variants, mandatory punctuation, and submitting the raw answer; the one-off real Supabase RLS E2E verifies with `ＷＯＲＤ－０１` and `WORD-02` that the server judges both correct, the revision advances monotonically, `wrong_count=0`, and the retry pool is empty, and that clients can't execute the internal normalization helper.
- PR #35 and the main/protected release runs all passed docs/lint/typecheck, Web/API tests, build, the 0007→0022 upgrade, empty-database rebuild, database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright. Playwright's Azure/OpenRouter are still fakes, and real provider evidence only comes from the production activation gate.

### Release

- PR [#35](https://github.com/1590703336/Nalanda/pull/35) merged into main SHA `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad`; [read-only plan run `30616030488`](https://github.com/1590703336/Nalanda/actions/runs/30616030488) listed only 0021–0022, without creating a recovery point, writing to the database, or deploying the application.
- [Protected apply/deploy run `30616540480`](https://github.com/1590703336/Nalanda/actions/runs/30616540480) kept encrypted recovery artifact `8787805291` (`db-recovery-fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad`, digest `sha256:fd553ea9c4898d72928db64bcbd979e13dff50f6b50a2138ec7113958709c199`) before apply, synced remote history to 0022, and passed remote function verification, lint, and an empty dry-run.
- Before activation, immutable release `fc1e106c53ea2e5222d6c2e4a6cbe9dabb3ab2ad-30616540480-1` passed real Japan East Azure, real OpenRouter, and the candidate Courses API/Storage gates; the independent public re-check confirmed `/api/health` `status=ok` with `deps.supabase=ok`, anonymous `/api/me` 401, and the Web returning the React root.

## [0.8.0] - 2026-07-28

### Added

- Added 0019–0020: `learning_sessions.spelling_options`, `learning_spelling_translation_assessments` that only stores the SHA-256 of the user's translation, the judgement lease/quota/idempotent response, and exact RLS/grant release assertions.
- Spelling tests can optionally be timed at 3–300 seconds; the countdown only starts once the spelling input is answerable, and on timeout the current content is auto-submitted once. The optional translation pre-test first has the server judge the meaning with OpenRouter structured output; only when correct does it continue to spelling, and a wrong answer directly creates one authoritative spelling error.
- Spelling results show the correct English and each translation whether right or wrong; translation judgement failures can be retried and aren't recorded as errors.

### Fixed

- The OpenRouter free route occasionally returned a valid boolean with empty feedback, or a 200 response temporarily missing structured content. The server contract is narrowed so the model only decides `{correct:boolean}`, with fixed safe teaching copy filling in feedback; an invalid 200 is retried only once within the original 12-second total budget, and if it still fails the lease is released without recording an error. This fix doesn't allow client self-judgement and doesn't change the database's authority.
- The OpenRouter free route occasionally misjudged synthetic placeholder answers identical to the server reference translation. NestJS now first performs server-side NFKC/whitespace/case normalization; when it exactly matches any reference translation it is judged correct deterministically with `nalanda-normalized-exact/normalized-exact-v1` without calling the provider, and only non-literal synonyms/paraphrases go to OpenRouter. This fast path still goes through the owner, lease, quota, idempotency, and authoritative database transaction.
- Fixed the API mapping losing the outer `replayed=true` when the translation assessment's idempotent claim hit an already completed first fact; same-UUID/answer replays now explicitly return `true`, without calling the provider again, advancing the session, or accumulating errors.

### Security

- The OpenRouter key only goes into the local/server mode-600 API env and the GitHub protected environment, never into the Web app, database, logs, or repository. Production explicitly rejects `OPENROUTER_FAKE=true`; the new tables and RPCs are fully closed to public/anon/authenticated.
- The translation the user types is only forwarded in API request memory; the database stores the answer hash, boolean, short feedback, model/token metering, lease, and first response. A correct translation and the following spelling reuse the same UUID, and duplicate/timeout replays never call the provider again or advance the session.

### Testing

- Added fake-clock jsdom for single timeout submission, no timing before the translation passes, manual advancing after semantic errors, provider failures not counting as errors, and bilingual result rendering; API coverage of zero provider calls for exact normalized matches, the boolean-only structured schema, safe feedback fallback, a single bounded retry for missing content, idempotent replay, lease release, and timeout/invalid responses; two-user RLS covering client rejection, hash-only persistence, revision, and cascades; Playwright uses the OpenRouter fake and isn't real provider evidence.
- Release tooling adds an OpenRouter structured smoke and production env install script tests. Before enabling in production, real OpenRouter synonym/unrelated judgements and real Courses API idempotency evidence must be obtained separately.

### Release

- PRs #26, #27, #28, and #29 merged the feature and three production gate forward fixes in turn; run `30374301472` on final main SHA `a4c230e1aa6f29abbd4fbe944a1b76c625107003` passed docs/lint/typecheck, Web/API tests, build, 0007→0020, empty-database rebuild, database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright. Playwright's Azure/OpenRouter were still fakes and can't serve as real provider evidence.
- Read-only plan run `30366334157` listed only 0019–0020; protected run `30367263486` created encrypted recovery artifact `8691620673` (`db-recovery-7c8b516ec4fc9086a6bae816966cb7f688c19746`) and synced the production database to 0020. The candidate applications of that run and the later `30370419397` and `30372651419` were stopped by gates for the provider contract, the model misjudging synthetic answers, and the idempotent replay mapping respectively, each automatically restoring the previous application; the database stayed at 0020 per the rules.
- Before activating final release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3`, real Japan East Azure returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; the real OpenRouter pinned model returned 1,365 ms and 253/27/280 tokens; the candidate Courses API returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`, and durably proved `nalanda-normalized-exact/normalized-exact-v1`, 0 tokens, `replayed=true`, revision 1. The independent public re-check confirmed `deps.supabase=ok`, anonymous `/api/me` 401, and the React root.

## [0.7.1] - 2026-07-27

### Added

- Added 0017–0018: learning sessions resume by request intent with a protected `resume_key`, with verification of the new index and the service-role-only `learning_start_session` permission. Initial learning, ad-hoc reviews, and scheduled reviews can each keep their own progress, and concurrent starts with the same intent still create only one active session.

### Fixed

- Fixed starting learning or a review on historical/cold courses where the browser only prefetched future audio that was already ready, so words waiting to be generated never got a priority boost and fell back to long-term browser speech when clicked. The current word and the next four are now proactively queued with at most two concurrent requests; once the manifest turns ready, audio is written to Cache Storage immediately, the matching stale degradation notice is cleared, and later playback uses the cached audio.
- Fixed an explicit review of another unit still returning the original learning session when the same course had a paused initial learning session. The server now only resumes sessions whose course, unit, mode, scope, normalized test items, or schedule all match; the course card's quick continue entry stably picks the most recently active unfinished session.

### Testing

- Added regression coverage for an eight-word historical cold unit pending→ready→Cache Storage in jsdom, the five-word two-concurrency cap, cross-unit learning/review intent RLS, and Playwright for reviews without pre-download, cache replacement, and resuming the original learning cursor.

### Release

- PR #24 run `30263277807` and main run `30263794368` passed docs/lint/typecheck, Web/API tests, build, 0007→0018, empty-database rebuild, database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright; Playwright used the Azure fake and only proves browser/API/one-off database collaboration.
- Read-only plan run `30264327821` on main SHA `99313bd3763ce5bf1f7ffb252f821f7b21a67eec` listed only 0017–0018; apply/deploy run `30264979509` kept encrypted recovery point artifact `8652623403`, synced the remote to 0018, and activated release `99313bd3763ce5bf1f7ffb252f821f7b21a67eec-30264979509-1`.
- Before cutover, the Japan East real basic smoke returned a 10,656-byte MP3, accuracy 98, pronunciation 98.8; the queue/Storage/scoring gate returned `generatedAssets=4`, `duplicateAssetsReused=4`, `assessmentScore=97`. Independent public and server re-checks confirmed Web 200, `deps.supabase=ok`, anonymous `/api/me` 401, and the Web symlink and API image both pointing to the same release SHA.

## [0.7.0] - 2026-07-27

### Added

- Added 0015–0016: `learning_sessions.revision`, attempt UUIDs/first-response snapshots with a composite unique constraint, a single-RPC session snapshot, the service-only `learning_audio_assets` durable job table, a global single lease/quota reservation, and structure/permission assertions; the old answer RPC is kept for database-first rollout and application rollback.
- Added the IndexedDB answer outbox, same-attempt-UUID timeout replay, revision conflict recovery, account isolation, and offline completion pending server confirmation; client Cache Storage supports prefetching the next five words with two concurrent requests, resumable whole-unit downloads, persistent storage requests, and local deletion.
- Added the unit audio prewarm/manifest API, asynchronous `202 AUDIO_PENDING` audio reads, 20 ms VAD trimming, and a real production gate script verifying Japan East queue generation, private Storage hits, cross-user duplicate word reuse, and trimmed read-aloud scoring.

### Changed

- After a wrong answer in the test stages, the app no longer moves to the next question automatically after about 1.15 seconds; the wrong option, correct answer, or spelling differences stay visible and lock the current question until the user clicks the bilingual "Next question". Correct answers still keep the brief success animation and advance automatically.
- Translation, spelling, and pronunciation matching show provisional correctness in the current render frame; ordinary success responses return an incremental `sessionPatch` instead of refetching the full session and Courses list per question. The server is still the only authority on the retry pool, stage, progress, rewards, and completion state.
- Synthesized audio misses no longer wait synchronously for Azure in the user's request; background jobs generate with at least 3.1 seconds between requests and defaults of 20 per minute and 500,000 characters per month, and private Supabase Storage remains the only server-side cache.

### Security

- Every new RPC revokes `public/anon/authenticated` EXECUTE; the audio job table isn't exposed to PostgREST. Clients can't use provisional state to award points/badges, and duplicate or timed-out answers submit only one fact.
- The production runtime explicitly rejects `AZURE_SPEECH_FAKE=true`; Storage network failures aren't downgraded to cache misses that trigger unnecessary Azure generation.

### Testing

- Added coverage for prediction/authoritative correction, consecutive weak-network outbox, Cache Storage, VAD, queue lease/quota, concurrent idempotency/revision conflicts, and client RPC rejection; the Playwright fake only proves the browser flow and isn't real Azure evidence.

### Release

- PR #21, the main push, and the protected release all passed docs/lint/typecheck, Web/API tests, build, 0007→0016, empty-database rebuild, database lint, real local Supabase RLS/Storage E2E, and Chromium Playwright; Playwright used the Azure fake and isn't provider proof.
- Read-only plan run `30244967669` on main SHA `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2` listed only 0015–0016; apply/deploy run `30245430630` kept encrypted recovery point artifact `8644999285`, synced the remote to 0016, and activated release `6b6de0e985ad8b34c977f1bce3ba985b84eb82f2-30245430630-1`.
- Before cutover, the Japan East real gate verified Azure TTS/scoring, 4 first-generated objects, private Storage hits, a second user reusing the same 4 objects without extra Azure generation, and VAD-trimmed scoring; the independent public re-check showed Web 200, `deps.supabase=ok`, and anonymous `/api/me` 401.

## [0.6.2] - 2026-07-23

### Added

- Read-aloud scoring responses now explicitly return the overall `PronScore` pass mark (default 70), whether it passed, and whether it entered the retry pool; low scores are durably added to the word recognition retry pool, and a passing re-read removes that retry item before continuing.
- Scoring results add an explicit "Read again and score" action, and the bilingual UI explains the pass score and retry pool status.

### Changed

- Pronunciation matching and translation tests now judge immediately on selection: correct/wrong plays a noticeable animation directly on the chosen item, the server immediately runs the pass or retry pool logic, and after brief feedback it advances to the next question automatically, no longer showing `Check answer` or `Continue`.
- Multi-translation questions confirm each correct choice in turn, and the last correct translation submits automatically; any wrong choice immediately records an error for the question. Spelling still needs Enter or one submit to set the input boundary, but advances automatically after the result, with no second confirmation.

### Fixed

- Fixed Supabase Storage representing a TTS cache miss as HTTP 400 + JSON `statusCode=404` being misjudged as a server error, which made every first Azure audio request return 500; cache read/write failures no longer block Azure audio that can already be generated/returned.

### Release

- Main SHA `02ba1b682c104947aa0b80707c143b8e921870f0` was released through read-only plan run `29939798432` and protected apply/deploy run `29940292716`; the production migration history reached 0014, and encrypted recovery point artifact `8538123165` is kept for 14 days.
- Before activation, the real Azure Speech gate with `japaneast`/`en-US-JennyNeural` successfully returned a 10,656-byte MP3, 98 accuracy, 98.8 pronunciation, and 4 phonemes; final release `02ba1b682c104947aa0b80707c143b8e921870f0-29940292716-1` passed the public readiness/auth/Web smoke.

## [0.6.1] - 2026-07-22

### Added

- The Courses creation flow adds "Whole multi-unit word list" import: it directly recognizes `Starter Unit 1`, `Unit 2`, `Lesson 3`, `Chapter`, `Module`, `Section`, and the corresponding numbered Chinese headings; any custom heading is marked explicitly with `[Name]` or `# Name`, avoiding confusion with entries.
- Each unit in Edit/Review Course adds "Bulk paste words", which appends a multi-line word list to an existing unit; it also validates duplicates of existing words, the 2,000-word course limit, and the existing format rules.

### Changed

- Courses, the learning/review flows, public sharing, and Course Market uniformly use a frontend locale that defaults to English and can be switched to Chinese persistently; the course API's stable error codes are displayed in the current language on the Web.
- `courses.css` only keeps course-specific layout, and aligns fonts, font sizes, colors, buttons, inputs, cards, modals, borders, radii, shadows, focus/disabled states, and responsive breakpoints with the existing Nalanda design tokens.
- The whole multi-unit parser keeps the "the last ASCII space on each line separates the English from the translation" contract and maps every error back to the exact line number, column number, and error code in the whole original text.
- The Chromium Playwright main flow now creates a course from a whole multi-unit text, first triggers and fixes a duplicate error, then verifies the real scroll area, reachable bottom buttons, and the rest of the full learning/review/market clone flow.
- The changes above were released through the protected pipeline with main SHA `d31af905b44ca4df39c70e271a7c7a51612916e3` as immutable release `d31af905b44ca4df39c70e271a7c7a51612916e3-29932840103-1`; the database, API, environment variables, and security boundaries were not modified.

### Fixed

- Fixed visual inconsistencies between Courses/Course Market and the existing main UI in form backgrounds, card density, empty states, interaction focus, and mobile layout; switching language doesn't change course business behavior or the API contract.
- Fixed the app's main column flex children missing `min-height: 0`, which kept long Courses create, edit, and Review content from scrolling to the bottom; the shared `.content` remains the only vertical scroll container, and other long pages benefit too.
- Multiple translations in Review/Edit Course are no longer shown as a merged string like `thing/matter`; they render as text blocks that can be edited, deleted, and added independently, still with at most 10 translations per word.

### Not included

- PDF, DOC/DOCX, JSON, Markdown, HTML, and image OCR/AI import are still only disabled placeholders; this text import extension didn't upload files, call models, or change the AI contract.

## [0.6.0] - 2026-07-22

### Added

- Added Courses English vocabulary learning: empty state/category selection, per-unit text parsing with exact error positions, structured editing, dnd-kit/keyboard sorting, CMUdict IPA, course card mastery, and the resumable four stages of word recognition/pronunciation matching/translation/spelling.
- Added the separate `learning_*` 0011–0013: private courses/units/words, sessions/items/append-only attempts/progress, review schedules, sharing, immutable market versions, reports/moderation actions, speech quotas, nine-tier badges, and release assertions; Materials `courses` is unchanged.
- Schedule aggregates 3/7/15/30-day course reviews, and Profile aggregates the course count, distinct mastered words, review dates, and course badges; a word set of 20 distinct words at 100% mastery awards a fingerprint-idempotent +20 points the first time.
- Added NestJS Courses, session/answer, review, learning Profile, share/revoke/clone, free Course Market, and report/moderation endpoints, plus the unified `{ code,message,fieldErrors? }` error.
- Added the Azure Speech server adapter: a private TTS cache, a 16 kHz mono WAV limit, ≤8 seconds/2 MB scoring, phoneme feedback, durable per-user limits/monthly budget, a circuit breaker, and browser speech fallback; user recordings aren't persisted.
- Added Courses parser/jsdom/API/CMUdict/Azure tests, two-user Courses RLS E2E, and the Playwright two-account main flow; the upgrade fixture automatically stages all 0008+ migrations so future files don't leak into the 0007 schema early.
- Added an executable real Azure Speech smoke: verifies MP3 TTS, 16 kHz PCM TTS, scripted pronunciation assessment, and phoneme results; the production host runs this gate before activating the new API image, with credentials that only exist in the server `.env`.
- Added the Courses implementation notes and ADR 0008, and updated the README, architecture, blueprint, ERD/API, environment, local development, testing, database/recovery/monitoring/rotation, security, privacy, moderation, AI cost, and economy rules accordingly.

### Changed

- Market now has two tabs: Note Market (still a Demo) and Course Market (real free snapshots); Course Market doesn't use credits, payments, or revenue share.
- The Courses camelCase contract in `packages/types` is shared by the Web app and API; the database stays snake_case, converted explicitly by the API.
- The Courses request contract now constrains the shared types, Nest DTOs, and Web client together; share/market clones keep private origin references and author attribution, and after the origin is deleted only the reference is cleared, without faking attribution.
- The root `pnpm lint` changed from an empty Turbo task to strict TypeScript static checks that actually run for the API, Web, and shared types, and joined the PR quality gate.
- The Azure pronunciation adapter supports both the nested `PronunciationAssessment` from the official docs and the flat score/error/phoneme fields actually returned by the Japan East REST API, with regression tests for both response shapes.
- Production released 0011–0013, Courses/sharing/free market, and Azure Speech through a separate plan/apply on main SHA `53d0eabf767725b6e9ca83367c0e17c47a479eca`; database rollback still uses only forward-fix, and the application/features roll back through releases and flags.

### Security

- Courses private tables forbid client writes, and progress, badge, points, distribution, and moderation writes all go through service-role-only transactional RPCs after owner validation; RPCs revoke `public/anon/authenticated` EXECUTE by default.
- Shares only store the SHA-256 of a 32-byte token, and revocation and cloning re-check within a transaction; public responses are redacted, publication content is kept immutable by a trigger, and cloned courses can't be shared or listed again.
- `profiles.timezone` only allows valid IANA names; reviews store the local date at the time they happen. User read-aloud audio never enters the database, Storage, logs, or backups.
- The HS256 JWT fallback validates issuer/audience the same way as JWKS; Azure TTS/scoring adds a 1–60 second hard timeout; Course Market responses remove private unit/word IDs and progress fields.
- Review schedules can only be created from completed initial sessions, with their skills/scope pinned on the server; concurrent session starts stably resume the same active session.
- Read-aloud scoring checks that the session is still active before calling Azure, so ended sessions can't consume provider quota or send recordings.
- NestJS CORS changed from any Origin to a `CORS_ALLOWED_ORIGINS`/`PUBLIC_ORIGIN` allowlist; when the configuration is missing in production, only same-origin use remains.

### Not included

- PDF, DOC/DOCX, JSON, Markdown, HTML, image OCR/AI import, and knowledge points, reading comprehension, and question bank training are still not implemented; the existing entry only shows "AI parsing coming soon".

## [0.5.0] - 2026-07-21

### Added

- Established the documentation system: the project blueprint/final specification, ERD/API, local development, environment variables, testing, database release/rollback, backup and recovery, monitoring and alerting, and secret rotation.
- Established SECURITY, CONTRIBUTING, ADRs, privacy and data deletion, content moderation, AI evaluation/cost, and unified points/credits/VIP/payment rules.
- Added 9 jsdom regressions for the Web app and 2 unit tests for API readiness, and extended 3 Supabase two-user RLS/Storage E2E suites; API HTTP, FastAPI, and real browser E2E are still explicitly listed as to-do.
- Added the local Supabase CLI baseline, the PR/main 0007→0010 historical data upgrade, the legacy opening reset and release assertion fixtures, empty-database migration rebuild, database lint, and real local RLS/Storage/points CI gates.
- Added the 0009 append-only legacy opening reversal, and split production database releases into two manual runs: a read-only plan and a separate apply.
- Added the write-free 0010 security/points release assertions; for existing projects with an empty production migration history, the baseline is established automatically after an encrypted backup, on the condition of a zero 0001–0007 public schema diff and Storage policy/bucket checks, rejecting partial, gap, and unknown remote versions.
- Encrypted recovery points can explicitly record a not-yet-existing `supabase_migrations` schema; only that exact state can be downgraded to `migration_history_state=absent`, and other dump errors still fail. Changes to database release control files also trigger main's release gate.
- Fixed the empty-history baseline script misusing the global `--output` format argument when calling `supabase db diff`, and covered the whole path of diff capture, Storage checks, and history repair with an executable CLI fixture.
- Added the production migration dry-run, encrypted release recovery points, the isolated recovery script, and the migration history release flow.

### Changed

- Old documents were relabeled as "current, partially implemented, target" according to the current code and migrations, and blueprint capabilities are no longer described as live.
- Production Web/API now use Git SHA immutable releases; when the local or public smoke fails, the previous application release is restored automatically, and the database still uses forward migrations.
- `/api/health` was upgraded from a variable presence check to dual Supabase JWKS + PostgREST probes; failures return a sanitized 503, and the deploy smoke only accepts real readiness.
- Production released 0008–0010 through a separate plan/apply: established the 0001–0007 history baseline, appended the reversal of the legacy 11 points, verified permissions/the ledger projection, and activated the corresponding immutable Web/API release.

### Fixed

- Reset legacy module-level session state and discard late responses for the old account, fixing leftover profile/community/notification data across accounts; an account change remounts the app.
- Changed the resize listener to a symmetric mount/cleanup lifecycle, fixing the inability to remount after signing out and back in.
- Sign-in state reads, sign-out, Materials, notifications, feedback, Profile, Community, and Schedule now check the Supabase/Storage `{ error }`; community relationship actions only update the UI after the backend succeeds, avoiding fake success.
- Session changes reset the sign-in button loading state, and sign-out failures are visible in the signed-in UI.

### Security

- Added the 0008 migration: Profile only allows clients to update public profile columns, and defensive triggers protect credits, points, level, VIP, and streak.
- Revoked client EXECUTE on `_add_points`, `_notify`, `_set_point_event`, and the new and old trigger helpers; the old `_add_points` can't be called by the service role either.
- Added append-only `point_entries`, internal `point_event_states`, stable business keys, reversals, and concurrency serialization; likes, comments, original posts/reposts, and redoing tasks after cancelling no longer accumulate farmed points.
- Remaining open items include trusted fields on post UPDATE, feedback status, sign-up abuse, public media governance, and the credits/VIP/payment commercial ledger.

## [0.4.0] - 2026-06-27

### Added

- Real backend for study goals and tasks, course/material links, task completion points, streak, and milestone notifications.
- Function-level implementation notes for notifications, feedback, Profile, Community, and Schedule.

## [0.3.0] - 2026-06-25

### Added

- The notification panel, real Feedback, and Profile data.
- Real Community backend: posts, comments, likes, favorites, reposts, follows, tags, media, points, levels, and interaction notifications.

### Security

- Community author display fields are generated by the database from a profile snapshot, reducing the risk of clients forging author information.

## [0.2.0] - 2026-06-24

### Added

- The GitHub Actions production deployment flow to `nalanda.online`.
- The React Web sign-in shell wired up to the full high-fidelity prototype UI.
- Real Materials backend: courses, materials, Supabase Storage, preview, download, and deletion.
- The database migration push script and the first implementation notes.

### Changed

- Sign-up now has the NestJS backend call Supabase Admin to create a confirmed user.
- Supabase JWT verification prefers JWKS and keeps the old HS256 fallback.

### Security

- Materials RLS adds the check that "a material must belong to the current user's own course", fixing a cross-user course foreign key integrity issue.

## [0.1.0] - 2026-06-20

### Added

- pnpm + Turborepo monorepo, including Web, NestJS API, the FastAPI AI skeleton, and shared types/UI packages.
- Supabase Auth, the profiles sign-up trigger, and the first owner-only RLS.
- The 2G hybrid deployment scaffold with Caddy + API + AI + Redis and notes on deployment variants.

## [0.0.2] - 2026-06-13

### Added

- A runnable desktop/mobile high-fidelity Showcase prototype.
- The first architecture and development roadmap.

## [0.0.1] - 2026-06-12

### Added

- Initialized the repository and the product README.
