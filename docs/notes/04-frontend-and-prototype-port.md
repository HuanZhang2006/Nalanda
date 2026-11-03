# 04 · Frontend and prototype port

> **About this document**
> - **Contents**: Explains how the static prototype was ported into the production Web app, the React/legacy boundary, and the risks of incremental refactoring.
> - **Purpose**: Helps maintain the current hybrid frontend; "the page opens" is never interpreted as "the business logic is really implemented".
> - **When to update**: When the entry point, routing, mount lifecycle, legacy modules, design system, or React migration boundary change.

> Goal: turn the high-fidelity prototype originally made with Claude Design (8 major modules + sub-pages) into real pages of the production frontend, with every page openable and interactive; parts without a backend yet use mock data first, and sign-up/sign-in use the real backend.

## 1. Technical approach

- **Stack**: React 18 + Vite + TypeScript (`apps/web`).
- **Design system**: reuses the prototype's `nalanda.css` directly (moved into `packages/ui`), with CSS variables driving light/dark themes so the production UI matches the design.
- **Port strategy (key decision)**: the prototype is a **proven** vanilla JS app (`data.js / icons.js / app.js / views-*.js` under `app/`, rendered with template strings + event delegation). Rewriting thousands of lines of views into JSX one by one is high-risk and low-value, so we chose to **"wrap the prototype modules as ES modules and mount them into React after sign-in"**:
  - React owns the **auth gate** (sign-in page + session).
  - After sign-in it renders `<NalandaApp>`, which mounts the prototype into a `div.app` container in `useEffect`.
  - The real identity + Supabase client + sign-out callback are injected into the prototype as parameters.
  - Benefit: **pixel-level fidelity + every feature usable immediately**; modules can later be replaced one by one with "real components + real backend", a smooth migration path.

## 2. Turning the prototype into ES modules

Source: `app/{data.js, icons.js, app.js, views-core.js, views-more.js}` → `apps/web/src/legacy/{data.ts, icons.ts, app.ts}`. Historically this followed a deterministic conversion approach, but the conversion script was not kept in the repository, so later syncs still risk manual drift:

- `data.js`: `const DB = {}` → `const DB: any = {}`; remove `window.DB` and use `export { DB }`.
- `icons.js`: remove the IIFE wrapper; `window.ICON = function(){}` → `export function ICON(){}`; add a `logout` icon.
- `app.js + views-*`: concatenated into one `app.ts`, and:
  - Add `import { DB } from "./data"` and `import { ICON } from "./icons"` at the top, and declare module-scoped `VIEWS`, `_root`, `_opts`.
  - `const S = window.S = {…}` → a module-level `const S`; remove `window.VIEWS`.
  - Change innerHTML/event delegation on `document.getElementById("app")` to operate on the mount container `_root`.
  - Add an exported `mountNalanda(container, opts)`: writes the real user into `DB.user`, runs `initTheme()` → `renderShell()` → `go("home")`, and returns a cleanup function (clear the container + unbind resize).
  - Add a "Sign out" button to the top bar; `ACTIONS.signOut` calls `opts.onSignOut`.
- All 9 legacy TS files currently have `// @ts-nocheck`. This keeps the ported code buildable, but also means `tsc` cannot verify most of the project's business frontend.

## 3. React-side wiring

- `main.tsx`: `import "@nalanda/ui/nalanda.css"` (full styles) + `import "./index.css"`.
- `NalandaApp.tsx`: `useEffect` calls `mountNalanda(ref.current, { user:{id,email}, supabase, onSignOut })` with `user.id/user.email` as dependencies; token refreshes do not remount, but switching accounts in the same React tree cleans up first and then mounts with the new identity.
- `App.tsx`: session present → `<NalandaApp>`; otherwise the sign-in page (see [note 02](02-auth-and-user-system.md)).
- `index.html`: loads the Newsreader / Public Sans / IBM Plex Mono fonts; `data-theme` is controlled by JS for light/dark.

## 4. Ported modules (all openable)

Home dashboard, My Notes (note library), **note detail** (4 tabs: knowledge list / interactive quiz / knowledge graph / mock exam), the AI creation flow, the Materials library, the note market (+ purchase modal), the community feed + post detail, Profile & growth, the Schedule study plan, and Feedback.

Interactions: light/dark theme switching, sidebar collapse, quiz answering and grading, likes/saves, task checkboxes, toasts/modals, and so on all work. Actions without a backend (purchase, export, generate, and so on) show a placeholder toast as in the prototype design.

## 5. Rendering and routing logic

- **State routing**: module-level `S.route` + `go(route, params)`; `go` re-renders the content area and updates the navigation highlight (same as the prototype; no react-router).
- **Event delegation**: a single `click` listener on the container reads `data-go` (route) / `data-act` (action) + `data-*` parameters and dispatches, avoiding a listener per element.
- **Knowledge graph**: nodes are positioned in percentages and edges drawn in SVG; after entering the note/create route, `requestAnimationFrame(drawEdges)` computes the coordinates.
- **Language**: the shell's top bar has an EN/中文 toggle (English by default, stored in `localStorage`); legacy views re-render on change, while React islands (Courses, My Notes) follow the locale reactively and keep their in-progress state.

## 6. Data-shape alignment (the payoff for a real backend)

The 0041 test-paper chain has unified the `GeneratedExamV1`, job/quota/Notes/attempt contracts; exam sessions explicitly strip answers/rubrics. The knowledge list/standalone quiz are still demo/coming soon. The 0046–0051 candidate adds a source-ordered `GeneratedKnowledgeGraphV1`, and dynamic React Flow + ELK provide pan/zoom/drag/auto-layout, an off-canvas inspector, details below the canvas on mobile, layout revisions, and node Q&A; until it is released to production it must not be called a live implementation.

## 7. Pitfalls

- **Where to mount**: the prototype used `document.getElementById("app")`; it now operates on the React-provided container `_root` to avoid conflicts with React rendering.
- **`window.addEventListener` lifecycle**: resize add/remove are symmetric in `mountNalanda`/cleanup; StrictMode or sign-out/sign-in remounts the listener, and the jsdom shell regression asserts this.
- **Cross-account module singletons**: legacy modules are still singletons, but every `init*` clears user-state caches and increments `sessionVersion`; async responses may only write to the UI if the version still matches, preventing A's late response from landing on B's page. New modules must keep this constraint or move to instantiated React state.
- **Body layout**: the sign-in page needs centering and the app needs `.app` to fill the viewport; global centering was removed from `index.css`, and the sign-in page and `.app` (a `height:100vh` grid) each handle their own.

## 8. Verification

- `vite build` passes (the full `nalanda.css`, about 19.6 KB, is bundled).
- Runnable jsdom regressions are part of the repository test baseline; see the [testing guide](../guides/TESTING.md) for the coverage matrix and commands. Historical one-off script results are no longer the only evidence.
- The production bundle contains every view's copy; after signing in at `https://nalanda.online` you can browse every page.

## 9. Follow-up TODO (migration direction)

Production 0041–0043 added Materials AI and the React `NotesView` without widening the React migration scope. The 0046–0051 candidate adds DocumentIR/Luna, the graph, job Delete/Clear, and whole-paper grading within the same boundary; the third Ox Alpha pipeline added in 0054–0055 was retired by 0056–0057, so the capability matrix is back to two explicit pipelines, DocumentIR/Luna (Luna being GPT-6 Luna + Azure ZDR). Materials/My Notes reuse the original classes/tokens/fonts/focus/responsive rules and now follow the global English/Chinese toggle like the rest of the app. Historical demos stay grouped, and an account change clears consent, polling, and IndexedDB drafts.

This is not a site-wide React migration: legacy/mock boundaries such as Home, Create, and Note Market still exist. Making Notes partly real is no reason to delete other prototype data or change the original design.

Refactor the "innerHTML views" module by module into type-safe React components. Legacy lifecycle, cross-account cleanup, sign-in loading, and the main Supabase `{ error }` checks are in place; the current priorities are: **finish the Materials test-paper release → open other AI artifacts/Notes editing → real Home data → Market/credits/payments**. A larger React migration is still out of scope for this feature.
