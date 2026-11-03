# 06 · Materials library (the first real-backend module)

> **About this document**
> - **Contents**: Records the Materials tables, Storage, RLS, the upload/preview/delete flows, and a retrospective on a foreign-key permission issue.
> - **Purpose**: Serves as the reference implementation of a Supabase owner-only file module.
> - **When to update**: When course/material fields, Storage policies, supported formats, preview, quotas, or the cleanup flow change.

> Goal: Materials is the first business module upgraded from "mock data" to "real backend" and the template for later modules. This note explains how the data is modeled, how files are stored, how permissions are isolated, how each frontend feature works, and an authorization bug that was found and fixed. Prerequisites: [05 Database/RLS](05-database-and-rls.md), [04 Frontend and prototype port](04-frontend-and-prototype-port.md).

## 1. Requirements
Upload / view / download study materials per course; each material belongs to one course; users can only manage their own; supports PDF/PPT/Word/Markdown/HTML/TXT.

## 2. Key design: basic CRUD talks to Supabase directly, AI goes through the server
Like reading profiles at sign-in, basic Materials create/read/delete **talks to Supabase directly from the frontend**: table data uses `supabase.from(...)` and files use `supabase.storage`, with security enforced in the data layer by **RLS + storage policies**. The AI generation added in 0041–0043 does not reuse this write path; it must go through NestJS owner checks, service-role transactions, a durable queue, and an isolated worker.

Why basic CRUD does not go through NestJS: these are "user-owned data CRUD" operations, already secured by RLS. The backend is reserved for things that need server secrets/privileged transactions: sign-up, the live Materials AI, and future payments.

## 3. Data model (migration 0002)
```
courses(id, user_id=auth.uid(), code, name, color, term, instructor, created_at)
materials(id, user_id=auth.uid(),
          course_id → courses(id) on delete cascade,   -- deleting a course cascades to its materials
          name original file name, type detected from the extension, size_bytes,
          storage_path the file's path in the bucket, created_at, index(course_id))
```
Both tables `enable RLS` + owner-only (see [05](05-database-and-rls.md)).

## 4. File storage (Storage)
- Private bucket `materials` (`public=false`; no direct external links, signed URLs required).
- Object path convention **`{user_id}/{random uuid}.{ext}`** — the first folder level is the user id.
- Three policies on `storage.objects` allow access when "first folder = current user":
```sql
using (bucket_id='materials' and (storage.foldername(name))[1] = auth.uid()::text)
```
So "Alice can only read and write `materials/<alice id>/...`", and the storage layer is isolated.

## 5. ⚠️ Authorization bug found and fixed (migration 0003)
A two-user end-to-end test found that **B could insert a materials row "of their own" whose `course_id` pointed at A's course**.
- Why: 0002's policy only checked the material's `user_id`, not the ownership of the referenced course; the foreign key only checks that "the course exists", not who owns it.
- Impact: B still cannot read A's course data (RLS still blocks it), but can create dirty data pointing at someone else's course — unclean, and a potential integrity problem.
- Fix (0003): add "the course must belong to me" to `with check`:
```sql
and exists (select 1 from public.courses c
            where c.id = materials.course_id and c.user_id = auth.uid())
```
- Verification: after the fix, B attaching a material to A's course → **403 rejected**.

> Lesson: **a foreign key is not a permission**. When an RLS table references another "user-owned" table through a foreign key, explicitly check in `with check` that the referenced row also belongs to the current user.

## 6. Frontend implementation (`apps/web/src/legacy/materials.ts`)
A small app that **manages its own container**, mounted into the `#mat-root` provided by the app shell (integration described in [04](04-frontend-and-prototype-port.md)).

### Structure
- `initMaterials(supabase, user, toast)`: inject dependencies.
- `mountMaterials(el)`: remember the container → `render()` (loading state first) → `load()`.
- `state = { loading, error, courses[], materials[], course }`.
- `load()`: fetch courses + materials concurrently → write state → re-render; on error write `state.error` (shows "Error" instead of crashing when a migration hasn't been applied).
- `render()`: builds HTML with the same classes as the prototype and puts it into `#mat-root`; **every user-data field is escaped with `esc()` to prevent XSS**.
- `wire()`: binds clicks on `[data-mat]`; binds dragover/drop on the drop zone.

### Feature logic
- **New course** `newCourse()`: opens a small `.scrim/.modal` form → `insert(...).select().single()` → refresh and switch to that course. `user_id` is filled in by the database default.
- **Upload** `pickFiles()`→`doUpload()`: guards (create a course first if none; prompt to choose a course when All is selected); supports click-to-pick + drag-and-drop; each file → path `${user.id}/${crypto.randomUUID()}.${ext}` → `storage.upload` → `materials.insert`; **if the insert fails, the uploaded object is rolled back** (orphan file deleted); refresh + toast when done.
- **Preview / download**: download signed URLs currently last 120 seconds; in-app preview signed URLs last 600 seconds. PDF/images/HTML/Markdown/text are shown in the app, Office files can optionally go to Microsoft's online viewer, and other formats are downloaded.
- **Delete** `delMaterial()`: `confirm` → `storage.remove` deletes the file → `delete().eq('id')` deletes the record → refresh.
- **Filter**: the top chips change `state.course` and re-render (frontend filtering is only for UX; security still relies on RLS).
- **Language**: copy goes through `l(english, chinese)` and follows the global EN/中文 toggle.

### Integration with the app shell (3 places, see [04](04-frontend-and-prototype-port.md))
1. `mountNalanda` passes `supabase` / `user` through → `initMaterials(...)`.
2. `VIEWS.materials = () => '<div id="mat-root"></div>'` (replaces the original mock view).
3. `go()` hook: on the `materials` route, `mountMaterials(#mat-root)`.

## 7. End-to-end verification
The two-user RLS suite includes these real Supabase assertions:
- A: create a course, insert/list materials, upload and download their own file, create a signed URL, explicitly delete the file/material/course.
- B: cannot see A's courses/materials, cannot download or sign A's files, cannot write into A's path, cannot attach a material to A's course.
- Cleanup: the owner verifies the normal delete path; `afterAll` then uses the service role to clean Storage and delete the test users as a fallback.

The default `pnpm test` skips external cases; the PR/main deploy workflow starts a throwaway local Supabase and explicitly runs `pnpm test:rls`, proving the actual policies of the repository migrations on the local baseline. It still cannot replace configuration-drift checks on hosted staging/production.

> This "two users verify RLS against each other" suite is the standard way to check any owner-only module. See the [testing guide](../guides/TESTING.md) for runnable commands, environment protection, and cleanup logic; never run it against the production project by default.

## 8. Extension points
- List pagination / search / sorting; more robust PDF.js / server-side Office-to-image conversion.
- Upload size limits, a type allowlist, progress bars.

### 8.1 Materials AI test papers (production 0041–0043)

Each row gains a "Use AI" submenu; production Generate test paper can configure language, difficulty, 15–240 minutes, 20–200 marks, six question types, answer detail, and focus; production Knowledge list/Quiz/Knowledge graph still show Coming soon. The 0046–0051 candidate has wired "Organize knowledge points" as a real knowledge-graph entry and added the Luna pipeline; this section's production status can only be updated after the protected release completes. Consent to third-party/ZDR/private parse cache is recorded per user the first time.

The API never gives the worker permanent Storage access: it first checks owner, format, and 25 MB/10 MB for images, then creates a short-lived signed URL and a Postgres job/quota reservation; BullMQ only enqueues the UUID, and FastAPI parses and calls back progress. The page polls every 2 seconds and backs off to 10 seconds in the background; leaving/refreshing does not cancel. A successful test paper lands in My Notes under the same `courses.id`; deleting a material/course can either keep the AI results under Unfiled or delete them too, and both cancel jobs and clear the parse cache and process files.

The production database is at 0053, but a later candidate app rolled back to the earlier stable release after real provider gates failed. The 2026-08-11 protected release of 0041–0043 turned on `FEATURE_MATERIAL_AI` after passing real DeepSeek/MiMo, a 220-page Office canary, a signed-in user generate/grade/delete, temporary directory cleanup, and independent public readiness; the latest candidate on 2026-08-22 then twice returned `AI_EXAM_VALIDATION_FAILED` on the real PPTX test-paper gate and was not cut over. Database version and app capability must still be checked separately. Storage file deletion is still immediate best effort; full orphan retries/account DSAR remain an operations gap.

### 8.2 Resumable long jobs, knowledge graph, and Luna (0046–0051 candidate, not yet live)

The candidate API only waits for the worker's 202 acceptance; afterwards internally authenticated callbacks persist progress, usage, checkpoints, and the terminal result, so a single generation never holds an HTTP request for more than five minutes. An explicit Undici Agent separates connect/accept/headers/body timeouts, and a response-header timeout maps to `AI_WORKER_TIMEOUT`; users can click Resume before `resumeUntil` to continue the same job. The database checkpoint and the worker's 0700 local checkpoint/usage spool merge to the highest valid stage, completed provider stages are not called again, and usage event UUIDs are never billed twice; terminal states or the default 24-hour TTL clean up leftovers.

The old pipeline for "Organize knowledge points" shares parsing/review/failed-region visual recovery with test papers; the Luna pipeline validates the native file and sends it inline directly, without running parser/OCR/DocumentIR or using the Files API, fixed to GPT-6 Luna + Azure-only ZDR/no fallback. Both produce `GeneratedKnowledgeGraphV1`, with nodes ordered by sourceOrder and level, each including a detailed explanation, key points, examples, formulas, misconceptions, self-checks, and sources.

My Notes loads React Flow + ELK dynamically: it supports canvas pan/zoom, node dragging, fit/auto arrange, keyboard movement, 250 nodes, and mobile; the initial layout and saved drags both run collision resolution. The graph only shows type/title; hover/focus temporarily shows details in an off-canvas inspector, clicking pins it and allows node Q&A, and `Esc` cancels; coordinates/viewport are saved across devices per user/note/artifact version/revision. The Materials/My Notes candidate UI reuses the existing fonts/tokens and follows the global language toggle.

Each queue row can be deleted, and the header has Clear history; both use an in-app confirmation. Deleting a queued job releases its allowance, while deleting/compatible Cancel after the worker accepted consumes one run; an active row stays "Cleaning up…" until the worker confirms HTTPX/Office/checkpoint/spool/0700 directory are all cleaned. Clear only removes terminal jobs, never active jobs, existing Notes, or provider usage. In online exams, selections/input are saved as drafts only with `results=[]`; after a confirmed whole-paper Submit everything is graded together, with subjective questions merged into one AI grading run; submission at the deadline uses the same path.
