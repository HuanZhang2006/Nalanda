# ADR 0010: Ephemeral translation STT and a shared recording waveform

> **About this document**
> - **Contents**: Records why translation voice input uses server-side OpenRouter Fish Audio, why it only fills in the answer instead of submitting it, and how every recording entry point shares a local live waveform.
> - **Purpose**: Fixes the boundaries for secrets, owner/session, privacy, grading authority, and provider releases, so STT is never treated as an answer fact and audio is never stored long-term.
> - **When to update**: When the STT provider/model/language, audio format/retention, quotas, fill-in interaction, recording UI, real evaluation, or release status changes; supersede with a new ADR if the conclusion changes.
> - **Status**: Accepted; 2026-08-04. 0037–0038 and the app completed a protected production release; the real provider evidence uses a synthetic Chinese WAV and is not a real accent-quality evaluation.

## Context

Translation-first spelling already lets users type a Chinese translation, which the existing server-side semantic grading uses to decide whether they move on to spelling. The product needs voice input in that field, and both word-recognition read-aloud feedback and the pronunciation exam need consistent, immediate waveform feedback while capturing audio.

STT results can be affected by accents, noise, and homophones, so they must not be submitted automatically, let alone directly affect the retry pool, error counts, progress, or rewards. The OpenRouter key is already used in NestJS for semantic grading and must not be sent to the browser. Recordings are user content, so processing purpose and retention must be limited.

## Decision

1. The voice entry point exists only at the right end of the translation input in translation-first spelling; ordinary translation multiple-choice, English spelling input, and other text fields do not get it.
2. NestJS reuses the existing `OPENROUTER_API_KEY` and always calls `fish-audio/transcribe-1` through OpenRouter's dedicated `/audio/transcriptions` endpoint, with `language=zh` by default. Text grading and STT have separate model, timeout, and quota configuration; the browser cannot override these parameters.
3. Before calling the provider, the service-role-only `learning_reserve_translation_stt` verifies owner, active spelling session, `translationFirst=true`, current word, and expected revision in one transaction, and writes a reservation against separate per-minute/local-day/monthly budgets. Ordinary clients have no execute permission on the function and cannot read the usage table.
4. The browser records at most 6 seconds of 16 kHz, 16-bit, mono PCM WAV; the API keeps its 2 MB/8 second limit. The WAV exists only in browser memory and the memory of a single NestJS/OpenRouter request; it never enters PostgreSQL, Supabase Storage, Cache Storage, backups, or logs. The transcript is not persisted either.
5. A successful transcript only fills the original input and does not trigger semantic grading automatically. Users can edit it and submit explicitly; only the existing translation assessment/spelling transaction can create learning facts. If the revision or current word has changed when the response arrives, the Web app discards the transcript.
6. `beginWavRecording` derives a bounded amplitude bar from the same PCM frames; the React `AudioWaveform` only provides live visual feedback and never alters or trims the samples sent to the provider. Word read-aloud, the pronunciation exam, and translation voice input use the same component, theme tokens, accessibility labels, and English/Chinese strings.
7. Automation uses `OPENROUTER_FAKE=true` to verify the contract and browser flow, and production explicitly rejects fakes. Before production activation, the real structured text grading and an independent gate sending an Azure-synthesized fixed Chinese WAV through the candidate API to Fish Audio must pass; fakes/unit tests are not provider evidence. The protected release on 2026-08-04 passed this real gate.

## Options considered

### Browser Web Speech Recognition

Quick to adopt and avoids uploading to a server, but browser/platform support, privacy terms, language models, and result consistency are out of our control, and unified quotas and release gates are hard. It may be re-evaluated later as an explicit fallback; not adopted now.

### Browser calls OpenRouter directly

Leaks the key, lets clients change model/language, and bypasses owner/session/cost controls. Rejected.

### Submit automatically when recognition ends

Fewer steps, but turns an uncertain transcript directly into a user answer that may affect error counts and exam results. We adopt "fill in, editable, explicit user submit".

### Store audio or transcripts for model evaluation

Convenient for offline debugging, but widens privacy, export/deletion, and cross-border processing scope. Only authorized synthetic/expert evaluation sets are used; production user content is not stored.

## Consequences and verification

- Pros: the key never leaves the backend; STT gets no answering authority; late responses are discarded when the page has moved to another question or session, and stale text cannot pass the revision check after progress on another device; the three recording experiences are consistent; usage can be rate-limited across API instances.
- Costs: every recognition needs the network and provider latency, and on provider failure only keyboard input remains; the reservation still conservatively counts against the budget when the provider fails; without raw audio, production issues cannot be replayed afterwards.
- Minimum verification: types/API/Web typecheck; WAV/waveform, adapter/error, jsdom fill-in and editability tests; two-user real Supabase RPC/RLS/quotas; fake-provider Chromium; the protected real Fish Audio gate, database plan/recovery point/apply, and public readiness.
- Release evidence: PR #49 run `30904901828`, read-only plan `30906629924`, apply/deploy `30907716733`, recovery artifact `8892006761`, and immutable release `66c919833693971ba1bda4ea33a3fdf6717ef1ca-30907716733-1`. An independent production host check confirmed Web/API are on the same SHA; the real Fish gate's `transcriptionMatched=true` only proves that the fixed synthetic sample and the provider worked at that time.
