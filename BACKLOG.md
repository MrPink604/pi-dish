# pi-dish maintenance backlog

Updated 2026-09-09. This is the current work order. The original RPC feature
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

- Define shared identity, capability, event, and request-ownership contracts.
- Extract frontend state/transport and server application/lifecycle boundaries
  in small changes guarded by the preceding tests.
- Evaluate a contained component-framework pilot. Preserve the current transcript
  renderer and its performance contracts initially; a framework choice does not
  itself fix state ownership.

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
