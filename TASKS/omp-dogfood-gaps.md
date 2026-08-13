# Task: OMP Dogfood Gaps — Fresh-Session Routes, Interruption Rendering, Pricing, Command Menu

**Priority:** P1
**Status:** Planned — every gap below reproduced live on 2026-08-13 by piloting
a real OMP 17.2.15 session (zai/glm-4.7-flash / glm-4.5-flash) through the
pi-dish HTTP API end to end.
**Parent:** `TASKS/omp-full-support.md`
**Not covered by:** WS-A (compact), WS-B (tree), WS-C (web pilot), WS-D
(tool visibility) — except where noted.

## Verified working — do not touch, do not regress

Steer mid-turn (OMP injects and skips in-flight tools with a "Skipped due to
queued user message" toolResult), abort, rename, thinking switch, model switch
(`POST /model` with `modelId`), `/name` and `/model` via `POST /command`,
precise rejection of unsupported commands (`/tree`, `/hotkeys`) and of close,
git diff, session file browser, in-session search, related sessions, SSE
event pairing, terminal shell WebSocket AND the `?mode=tmux` TUI pane swap
(attaches to the hidden headless spawn, sends prefix `C-b`).

## Gap 1 (P1): Fresh sessions are invisible to stats/export/share/tree routes

`GET /stats`, `GET /export`, `POST /share` (and `GET /tree`) resolve the
session through the historical discovery index. A freshly launched session —
JSONL on disk, live in the registry, fully prompt-able — returns
`{"error":"Session not found"}` / 404 until the index picks it up (it needs
message entries and a rescan). Reproduced: new OMP session responded to
rename/thinking/diff/messages but 404'd on stats/export/share; an older
session from the same server boot worked on all of them.

Fix: those routes should fall back to the live session's `sessionFile` (the
`/api/sessions` aggregate already carries it) when the index lookup misses.
Keep the OMP pi-sdk export gate exactly as is — this is a lookup fix, not an
export-path change.

## Gap 2 (P1): Aborts/interruptions render as nothing — transcript silently stops

Aborting mid-thinking produced, in the JSONL: an assistant message with empty
content, then `custom_message` with `customType: "interrupted-thinking"`.
The messages API returns neither, so the web transcript just stops after the
user's steer with zero indication the turn was interrupted. Additionally the
queued follow-up (sent while the turn ran) vanished without trace — with
`queueRead` unsupported for OMP the user cannot even see it was dropped.

Fix:
- `lib/session-files.js` + `public/app.js`: render an "interrupted" marker
  (divider row like compaction) for `interrupted-thinking` and tolerate
  empty-content assistant messages; generic `custom_message` types must never
  be silently dropped — unknown ones get a subdued generic row or an explicit
  skip list.
- Investigate (bounded): whether an abort discards queued follow-ups in OMP;
  if so, surface a one-line notice in the transcript when an abort coincides
  with a non-empty queue snapshot (`queue_update` preceding it).
- Coordinate with WS-D (`omp-tool-visibility` branch) which already touches
  custom-message rendering for `async-result` — same code area, one style.

## Gap 3 (P1): OMP/Z.ai spend is entirely unpriced — Usage view shows nothing

All OMP calls report `costUnavailable`; `usage-summary` totals show
`cost: null, unpricedCalls: 8`. pi-dish prices exclusively from the bundled
Pi catalog, but OMP's own catalog carries pricing: `omp models --json`
returns per-model `cost: { input, output, cacheRead, cacheWrite }` (per
MTok — e.g. glm-4.7-flash input 0.6 / output 2.2). "Watch estimated spend
from the couch" is a headline feature and is dead for OMP.

Fix: a harness-scoped pricing source. For OMP sessions, price usage from a
cached `omp models --json` snapshot (refresh opportunistically, persist the
last-known catalog so historical indexing prices offline); keep Pi sessions
on the Pi catalog, keep the "estimated, not provider billing" caveat, and
keep genuinely unknown models reported as unpriced rather than free. Update
the README sentence that says pricing comes from the Pi catalog.

## Gap 4 (P2): Slash-command menu advertises commands the server rejects

`GET /api/commands` for an OMP session returns Pi/TUI builtins —
`tree`, `fork`, `new`, `resume`, `session`, `settings`, `export`, `share`,
`copy`, `login`, `logout`, `scoped-models`, `hotkeys`, `quit` — while
`POST /command` correctly rejects them (`unknown or unsupported command`).
The composer's slash menu therefore offers dead entries for OMP.

Fix: filter the advertised list to what the command route will actually
execute for that session's harness/capabilities (post-WS-A that includes
compact; keep the bridge's extension commands). Where pi-dish has its own
web-native equivalent (export/share), either map the command to it or omit.

## Gap 5 (P3): Cosmetic API inconsistencies

- `POST /queue/cancel` for OMP returns a parameter-validation error before
  the capability check; it should return the precise "not supported for this
  session" error a capability-gated route uses.
- `POST /model` requires `modelId` where other routes take `model`; tolerate
  both or document one.

## Suggested split

- **WS-E** (`omp-fresh-session-routes`): Gaps 1, 4, 5 — server-side lookup
  fallback + command-list filtering + error consistency. Unit tests for each
  route with a live-but-unindexed session fixture; real canary: launch OMP
  session, immediately stats/export/share it.
- **WS-F** (`omp-usage-pricing`): Gap 3 — harness pricing source, catalog
  cache/persistence, usage-summary + per-response spend integration, README
  caveat. Unit tests with a fake `omp models --json` fixture; real canary:
  a cheap zai turn shows a non-null estimated cost in `usage-summary`.
- **Gap 2** extends WS-D's scope (same rendering seam) — messaged to that
  thread rather than spawned separately.
