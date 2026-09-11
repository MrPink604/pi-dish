# pi-dish maintenance backlog

Updated 2026-09-11. This is the current work order. The original RPC feature
audit is preserved in [docs/history/2026-07-rpc-gap-audit.md](docs/history/2026-07-rpc-gap-audit.md);
its descriptions of missing features are historical.

## 1. Baseline maintenance (completed 2026-09-09)

- Restored SSH-forward cleanup on process termination, covering SIGTERM and SIGINT.
- Scoped selected-session metadata, transcript caches, family grouping, and row
  close actions to the owning host; preserved request ownership across delayed
  metadata updates.
- Corrected stale capability documentation and added a short contributor entrypoint.

These changes establish the baseline before broader testing or refactoring work.
Each behavior fix includes a focused regression check.

## 2. Testing and coverage (completed 2026-09-09)

- Pinned local Playwright and managed Chromium; 26 independent browser
  regressions cover same-id host collisions and delayed metadata writes.
- Extracted eight independently runnable smoke features while retaining the
  complete desktop/mobile integration flow. Each standalone run owns fresh
  fixtures; shared prompt history and selection-order dependencies were removed.
- Added family regressions and fixes for cross-host pinning, expansion,
  ancestor lookup, and drag ordering.
- Scoped composer drafts/attachments, queued prompts, pending sends/aborts,
  and extension dialogs to their owning hosts, with focused regressions for
  collisions and asynchronous completion after switching sessions. Harness
  discovery also rejects stale responses and failures after newer requests
  or host switches.
- Covered listener startup, bind retry, alias failure, advertised URLs,
  and SIGINT/SIGTERM port release together in an isolated suite. CI exposed
  a race while binding the loopback alias; automatically selected callback
  URLs now use a listening address.
- Made real OMP/Prime canaries independently runnable; verified OMP 18.1.15
  against a local fake provider, including live-tree reads and resume.
  Prime remains an opt-in check requiring its own installation.
- Added CI for the Node 22.19 minimum and current 22/24/26 patches, plus browser
  regressions, independent features, and desktop/mobile smoke on Node 24.
- Introduced correctness lint and strict incremental JavaScript type checking
  for the cron boundary, without formatting churn or a framework migration.

See [docs/testing.md](docs/testing.md) for the tooling matrix, coverage map,
commands, and checks to preserve during refactoring. Structural work can now
proceed in small changes; this baseline does not claim exhaustive coverage.

## 3. Session chrome and composer redesign (completed 2026-09-10)

Three-row mobile header (title · fixed host/harness/model/reasoning · scrolling
chips), a field-only composer with in-field attach/dictate/context/stop and
stacked steer/follow-up glyphs, new context-percentage tiers, and removal of
the message-count and session-spend badges. Spec and mock:
[docs/design/mobile-chrome-composer.md](docs/design/mobile-chrome-composer.md).

## 4. Structural work (after the test baseline)

- First bounded TypeScript foundation: existing identity, harness metadata,
  process proof, request correlation and stream helpers now live in `src/core/`,
  with generated CommonJS/declarations at the original `lib/` paths and CI
  consistency checks. See [docs/typescript.md](docs/typescript.md). Feature modules
  and browser state/transport are outside this first conversion.
- Session capability policy now lives in the typed foundation. Bridge defaults
  and API projection share one policy; lifecycle authorization stays with the
  server callers. Harness/state/flag regressions and Fable review cover this
  extraction.
- Shared RPC/bridge envelope decoding now validates response correlation and
  separates response/event/hello frames, while keeping payloads unknown and
  preserving bridge ownership proofs. Malformed-frame transport regressions
  and Fable review cover the boundary.
- The RPC session class, startup/pool and launch helpers now compile strictly.
  Native ids are validated before registration; startup state and streaming
  deltas are narrowed where consumed. Fable-reviewed regressions preserve
  retry/child cleanup, snapshot reconstruction and recovery ownership.
- The bridge session class, registry and pool now compile strictly. Registry
  basics and adopted identities are validated; v2 connections must prove their
  original claim before events can change session state. Socket regressions
  cover pre-hello claim rewriting, malformed updates and replay ordering.
- Browser list/selection state now lives in `src/browser/session-state.ts`, with
  strict TypeScript checks, host-aware lookup, the four existing writers
  and generation invalidation. DOM rendering stays in `app.js` via callbacks;
  state regressions and the host-collision browser scenarios cover the boundary.
- Transcript loads, stream connections/retries, relations and metadata mutations
  now capture immutable host/id/generation owners. The store guards transcript
  merges and pins identity; stale entrypoints cannot replace the current view.
  Composer, queue, file/diff, terminal, dialog and bounce guards use the same
  tokens, retiring the old id-plus-counter interface. Resume, search, stats,
  shares/pages and comments also retain their originating owner through later
  requests and view updates; feature counters still distinguish work inside a
  selection. Delayed-response browser regressions cover the boundary.
- Tree/branch operations and model/thinking menus now retain selection ownership;
  stale branch replies preserve only the originating draft and cannot reselect.
- Extend the typed foundation into application event and request-ownership contracts.
- Extract frontend state/transport and server application/lifecycle boundaries
  in small changes guarded by the preceding tests.
- Continue vanilla TypeScript migration through `src/browser/`. The typed API
  adapter, session store and model selector establish the current pattern:
  explicit owner-bearing actions, ordinary DOM rendering and cleanup.
  Move remaining state/controllers and leaf UI out of `app.js` in separately
  reviewed changes. Preserve imperative transcript and terminal ownership.
- Framework work is deferred. [The assessment](docs/browser-framework-assessment.md)
  retains a possible future leaf-component experiment and comparison criteria;
  neither Preact nor Svelte is an intended migration destination.

## Product limitations to revisit separately

- OMP/Prime do not expose the bridge queue-list/cancellation capabilities.
  Avoid promising Pi's queue controls for these harnesses.
- General terminal component factories and custom tool/message renderers have no
  browser serialization path. See [EXTENSION_WEB_UI_SCOPING.md](EXTENSION_WEB_UI_SCOPING.md)
  for the historical design discussion.
- Re-evaluate additional OMP host commands individually; a command that opens a
  TUI-only interaction must not strand a web user.

Current capabilities are defined by the harness wrappers and the server's
capability projection; README summarizes supported behavior. `TASKS/` records
design history and may include work that has already shipped.

## Framework evaluation preparation (completed 2026-09-10)

1. Session/model API contracts: complete after Fable review and full checks;
   invalid history rows are isolated and optional capability flags stay optional.
2. Typed browser request adapter and local browser build: complete after Fable
   review and full checks, including malformed/unauthorized peer responses.
3. Extracted model-selector baseline with explicit actions and cleanup: complete
   after Fable review and full checks.
4. [Readiness checkpoint and baseline evidence](docs/model-selector-baseline.md):
   complete; retained as evidence for any later framework experiment.
   The current next work is vanilla TypeScript migration.

## Vanilla TypeScript continuation

- Session store migration: completed 2026-09-10 after Fable review, strict type
  checks, 825 backend tests, 55 browser regressions, all independent UI scenarios,
  desktop/mobile smoke and OMP/Prime fake-provider canaries.
  Moved the existing writers and immutable selection owners into `src/browser/`,
  removed the standalone JavaScript script, and routed production and unit-test
  consumers through the existing browser bundle. No state behavior changes.
- Host connection policy/controller: completed 2026-09-11 after Fable review
  and full verification (828 backend tests, 55 browser regressions, all UI
  scenarios/smoke and OMP/Prime canaries). Moves retry/backoff, fleet seeding,
  poll eligibility and observation storage into `src/browser/host-connections.ts`.
- Per-host session loader: completed 2026-09-11 after Fable review and full
  verification (835 backend tests, 56 browser regressions, all UI scenarios/smoke
  and OMP/Prime canaries).
  Moves shared requests, cached rows, indexing state and active-only family/child
  merging into TypeScript. Unique request owners also prevent retired replies
  from restoring pruned caches or replacing newer connection outcomes.
- Thinking-level selector: completed 2026-09-11 after Fable review and full
  verification (835 backend tests, 60 browser regressions, all UI scenarios/smoke
  and OMP/Prime canaries).
  Moves DOM/listeners behind typed owner-bearing actions and cleanup. Uses native
  buttons and literal level text; an unsupported current level stays local to
  its view instead of changing the shared Pi vocabulary.
- Next: remaining host/request controllers and leaf UI. Keep each extraction
  independently reviewable; preserve selection guards, streaming coalescing,
  pagination and retained DOM.
