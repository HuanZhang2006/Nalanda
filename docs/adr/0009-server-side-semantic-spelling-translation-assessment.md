# ADR 0009: Server-side semantic translation pre-test and session-level spelling settings

> **About this document**
> - **Contents**: Records how the spelling test's time limit/translation pre-test enter the learning state machine, and why we use a server-side NestJS OpenRouter adapter, hash-only persisted facts, and a single attempt UUID.
> - **Purpose**: Fixes the security, privacy, idempotency, provider, and fallback boundaries, so model judgements, timing, or reward authority are never moved into the browser later.
> - **When to update**: When the spelling settings semantics, model/provider, prompt/schema, input retention, quotas, attempt/revision contract, release status, or a superseding ADR changes.
> - **Status**: Accepted; 2026-07-28. 0019–0020 and the app completed a protected production release.

> **2026-08-23 / 2026-10-03 addendum:** Server authority, deterministic exact matching, idempotency, and privacy boundaries remain in effect; the first Gemma model choice was replaced by Ox Alpha in [ADR-0015](0015-ox-alpha-translation-and-native-image-pipeline.md), and then by the free `nvidia/nemotron-3-super-120b-a12b:free` in [ADR-0016](0016-retire-ox-alpha-and-gpt6-luna-on-azure-zdr.md). The original historical decision text is kept.

## Context

Ordinary spelling already has a server-authoritative attempt/revision/retry pool, but no time limit per answer, and it can only check English spelling. The product needs an optional per-word countdown and a Chinese translation typed before spelling; the translation does not need to match the reference string character by character, so trim/equality alone is not enough. This judgement affects error counts, the retry pool, and progress, so it cannot be decided directly by the client or by an unconstrained provider response.

The user's typed translation is private content, the provider key must not enter the browser, and network timeouts and repeated clicks must not cause duplicate model charges or duplicate errors. The database must also ship first and stay compatible with the current production app.

## Decision

1. The time limit and translation pre-test are immutable session-level rules in `learning_sessions.spelling_options`, both off by default, with a default time of 20 seconds and a valid range of 3–300 seconds. Only a start request while the session revision is still 0 may write the settings.
2. The countdown is displayed and triggered by the Web app, but a timeout is still submitted through a normal authoritative spelling attempt; client timing never directly changes the retry pool, progress, points, or badges.
3. The translation pre-test first runs a deterministic normalized exact match inside the NestJS privileged boundary: if the user's answer, after NFKC, trimming/collapsing whitespace, and case normalization, equals any server-side reference translation, it must be judged correct and recorded as `nalanda-normalized-exact/normalized-exact-v1` without calling an external provider. Only non-literal synonyms/paraphrases go through the adapter to OpenRouter; the first locked model was `google/gemma-4-26b-a4b-it:free`, with temperature 0 and a strict JSON schema `{correct:boolean}`. The model only decides the boolean for those non-literal answers, and the API generates fixed safe feedback; the browser cannot submit reference translations, model, provider, or prompt.
4. NestJS must first take a judging lease and the user's quota through an owner/session/current-word RPC, and only then send the English term, reference translations, and the user's answer from request memory. The database stores only the answer's SHA-256, provider/model, the boolean, short feedback, token usage, the lease, and the first response; the user's input text is never stored.
5. Translation judging and the following spelling use the same client UUID and expected revision. A wrong translation creates one spelling error in the same database transaction; a correct translation does not advance the revision, but the following spelling wrapper must confirm that the UUID/revision already has a correct judgement. Replaying the same UUID/input returns the first response without calling the provider again or advancing twice.
6. A deterministic exact match consumes no provider tokens; for non-literal answers, a provider timeout, network/5xx/429, or invalid structured output releases the lease and returns a retryable error without recording a learning error. An HTTP 200 without a valid boolean may be retried once within the same 12-second total budget; empty/missing feedback does not override a valid boolean and is replaced with fixed safe copy. Revision conflicts are still handled with the server snapshot.
7. The new tables and every claim/complete/release/spelling RPC have no table privileges/execute permission for `public/anon/authenticated` and are granted only to service_role; production explicitly rejects `OPENROUTER_FAKE=true`.
8. The UI shows the authoritative English spelling and split translations for both correct and wrong results. Provider feedback is only an explanation and never becomes a reference answer or growth fact.
9. 0019 keeps the old session start/attempt signatures so the database can ship first and the app can roll back; production anomalies first turn off the narrowest feature flag or restore the previous immutable app release, and the database is only fixed forward.

## Options considered

### Client-side string/fuzzy matching

Lowest latency and cost, but hard to cover synonyms, polysemous words, and phrases reliably, and it would hand progress-affecting judgements to a tamperable client. Only local timing is kept; client-side semantic facts are not adopted.

### Browser calls OpenRouter directly

Simple to implement, but leaks the key, reference translations, and prompt, and cannot unify limits, leases, auditing, and provider switching. Rejected.

### Treat the translation pre-test as a separate translation skill attempt

Could reuse existing tables, but the product rule requires a wrong translation to fail this word's spelling flow directly; a separate skill would wrongly raise/affect translation mastery. We use a dedicated judgement fact + the spelling attempt.

### Store raw answers for quality analysis

Convenient for offline evaluation, but widens personal content, export/deletion, logging, and provider risk. The first version stores only hashes; quality evaluation uses authorized synthetic/expert datasets.

### Reuse the then-unimplemented FastAPI file generation chain

At the time this would have tied a synchronous, narrowly structured learning judgement to a not-yet-implemented file parsing/generation job architecture, so it stays inside the NestJS privileged learning boundary. Although an independent Materials worker candidate exists after 0041, the conclusion is unchanged: per-word course judgements should not depend on a heavyweight document queue, and future provider changes keep the same adapter contract.

## Consequences

The positive results are: timing does not break server authority; exactly matching answers are unaffected by model variance with zero provider latency/cost; near-synonym answers can still be accepted; timeouts/replays never record duplicate errors or duplicate calls; raw text retention is minimal; and the provider can be isolated quickly with a feature flag.

The costs and risks are: each word with the pre-test enabled adds one external latency and potential cost; the LLM can still misjudge; the free route's quota, price, availability, and privacy terms may change; and after a correct judgement the session revision does not change, so the UUID is needed to link the two steps reliably. Schema failures, false accepts/false rejects, provider latency/tokens, user quotas, and replay ratios must be monitored, and users can turn the option off.

## Gap between current implementation and target

- **Repository and production**: 0019–0020, the shared TS contract, the NestJS adapter/API, React settings/timing/results, jsdom/API/RLS/Playwright, and real provider/API smoke are all implemented and released; 0021–0024 later unified deterministic spelling normalization and added punctuation-only tolerance; 0027–0028 changed the rolling 24-hour quota to an atomic reservation made only right before a real provider request, with a default cap of 500, and reused the translation pre-test for exam mode; 0029–0036 added the pronunciation exam, arbitrary word selection, history, the dual-exam exact mastery projection, and an untrimmed WAV scoring path; 0037–0038 added Chinese STT fill-in with a separate quota boundary. None of these change this ADR's server authority and minimal text retention boundaries; the related features reach migration 0038, and the overall production history is at 0043.
- **Release evidence**: read-only plan `30366334157`, recovery/apply run `30367263486`, final main run `30374301472`, and release `a4c230e1aa6f29abbd4fbe944a1b76c625107003-30374301472-3`. Every candidate that failed midway automatically restored the old app, and the database stayed forward-compatible.
- **Next targets**: Build a formally authorized semantic evaluation set with false-accept/false-reject thresholds, a continuous cost/latency dashboard, user notices, and provider terms review. Model/base URL changes need re-evaluation and are not handled as ordinary key rotation.

## Verification and review

Every related release must prove: timing submits only once; timing does not start before the translation passes; a wrong judgement waits for a manual next question; provider failures do not record errors; both correct and wrong results show the English and translations; neither of two users can read the tables or execute the RPCs; concurrency/replay of the same UUID produces only one attempt; the database contains no user answer text; and the real provider returns valid structured output for fixed synonym/unrelated samples. Real smoke only proves connectivity and minimal semantics and does not replace quality evaluation.

Review triggers: changes to the model/routing/price/privacy terms; false accepts/false rejects over threshold; sustained provider 5xx/timeout anomalies; changes in user-input retention needs; or extending judgement to other course categories.
