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

## 2. Testing and coverage (in progress)

- Completed: pinned local Playwright, managed Chromium setup, and independent
  browser scenarios for same-id transcript selection and delayed metadata writes.
- Split the long browser smoke into independently runnable feature scenarios
  while retaining desktop/mobile end-to-end coverage.
- Completed: independent family regressions and fixes for cross-host pinning,
  expansion, ancestor lookup, and drag ordering.
- Extend cross-host collision coverage to composer drafts/attachments, queued
  prompts, and extension dialogs. Audit their remaining bare-id state at the
  same time; the maintenance passes do not yet migrate all UI state.
- Cover listener startup failure, retry, loopback aliases, and shutdown together.
- Make a real OMP canary independently runnable from Prime, alongside the existing
  real Pi checks. Keep model traffic on local fake providers.
- Establish automated checks and an explicit supported Node/tooling matrix.
  Introduce lint/type checking incrementally, with formatting churn kept separate.

## 3. Structural work (after the test baseline)

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
