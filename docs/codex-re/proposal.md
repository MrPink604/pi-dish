# Proposal: a Codex-style Session Control surface for pi-dish

*Written to fulfill the request from the 2026-08-06 session: pull the Codex desktop
client, RE its thread management, and propose how pi-dish could offer something
similar without eroding the webui/server/harness separation.*

The RE report is [README.md](./README.md) — the desktop client itself (Electron
app 26.730.61639) was pulled from OpenAI's CDN and analyzed. This proposal uses
its mechanisms as the reference, not just the open-source app-server.

## 0. What Codex actually does (client-verified)

The desktop client is a **projection layer over one multiplexed app-server
connection**:

- A summary list (`thread/list`, background priority, cursor-paginated, served
  from the state DB) + runtime status evidence (`thread/status/changed`:
  `idle | active{waitingOnApproval, waitingOnUserInput} | notLoaded | systemError`)
  for everything that isn't on screen.
- Full hydration (`thread/read`, `thread/resume`) only for the thread you're
  looking at plus pinned/active ones.
- Optimistic turns: `turn/start` returns the turn id, which binds the client's
  provisional `inProgress` state; `turn/steer`/`turn/interrupt` carry the current
  turn id as a race guard.
- **Prewarm**: opening the composer creates the durable thread up front
  (server-side TTL GC 10 min; client freshness 4.75 min); sending consumes it.
- Two-tier unload: client unsubscribes after 1 h inactive → server unloads after
  30 min more.

Everything the webui shows is a projection; the app-server owns execution and the
canonical store.

## 1. The pi-dish model

Pi's process model differs (one `AgentSessionRuntime` per pi process; sessions
parallel via multiple processes), so keep pi-dish's vocabulary, extended:

| Resource | Meaning | Backed by |
|---|---|---|
| **Session** | durable JSONL conversation tree (unchanged) | pi harness |
| **Runtime** | a live pi process attached to a session (unchanged) | bridge registry / RPC / tmux |
| **Launch operation** | in-flight create/resume/terminate work | server supervision (`/api/session-spawns`) |
| **Agent run** | prompt acceptance → `agent_settled`, id `runId` | bridge events |
| **Activity** | status `idle \| active{waitingOnApproval, waitingOnUserInput} \| starting \| error`, current tool, compaction, dialogs | bridge events |

The additions vs. today: a **runId epoch**, an **activity status** (replacing
`turnInProgress`), and a **global control feed** (replacing per-row polling).

## 2. The changes

### 2.1 Capability handshake + internal adapters (from the earlier proposal — keep)

Bridge `hello` gains an additive `capabilities` block; old bridges get a
conservative inferred set and controls degrade to disabled rather than failing.
Extract `getLiveSession()`'s duck typing into `SessionDriver` /
`RuntimeHandle` adapters (bridge vs RPC vs tmux). The browser never learns bridge
command names, RPC shapes, PIDs, tmux socket paths, or private pi queue
structures. Existing routes stay as shims during migration.

### 2.2 Rich activity snapshot instead of `turnInProgress`

The bridge's `turnInProgress` boolean is replaced by Codex's exact status shape:

```jsonc
// registry entry + control-feed events
"activity": {
  "status": "idle" | "active" | "starting" | "error",
  "flags": ["waitingOnApproval", "waitingOnUserInput"],  // active only
  "runId": "…",              // epoch per agent_start; null when idle
  "tool": "bash",            // current tool_execution, null when idle
  "compacting": false,
  "elapsedMs": 12345
}
```

Derivation, all from events the bridge already forwards: `agent_start` begins a
run (assign `runId`), `agent_settled` ends it; extension dialogs pending →
`waitingOnUserInput`; tool events → `tool`. The sidebar dot, header badge, and
fleet rows all read this one field. `runId` is the guard for every control
(below). Compaction stays an orthogonal flag as today.

### 2.3 One global control feed

Codex multiplexes every thread's events over one connection; pi-dish's current
per-session SSE is per-row. Add:

```
GET /api/control/events        (SSE, one per browser tab)
```

Events: `session.updated`, `runtime.started|updated|ended`,
`operation.updated`, `run.started|settled|failed`,
`interaction.requested|resolved`, `activity.updated` (2.2 snapshots).
The server derives them from registry rescans (already memoized) and the bridge
stream; the existing `/api/sessions` poll stays as the reconciliation path, so a
dropped event can't corrupt UI state. Keep detailed per-session SSE for the
selected session's transcript only.

### 2.4 Prewarm-style two-step creation (the Codex lesson applied)

Codex creates the durable thread before the user types, with GC. Pi's analog:

- `POST /api/sessions/new` (existing, `async:true`) splits into an explicit
  **operation state machine**:
  `accepted → validating → launching → awaiting_registration → connecting → ready`,
  terminal `failed | cancelled | uncertain` (unchanged from the earlier proposal —
  `uncertain` preserves the no-second-writer quarantine).
- **Create** = run the machine, stop at `ready`. **Create and send** = run the
  machine, then prompt with `expectedRunId` once registered; the draft stays in
  the browser until the prompt is accepted.
- The Codex addition: the *operation* is registered server-side the moment the
  POST lands (persisted `~/.pi/dish/` launch metadata only — no prompt text), so
  a server restart reconciles through the registry instead of orphaning the
  operation. This is the cheap-early-create half of Codex's prewarm; the GC half
  maps to the existing `uncertain` quarantine (a timed-out spawn whose pane is
  still alive must not get a second writer).

### 2.5 Guarded controls

Steer, follow-up, and interrupt carry `expectedRunId` (and where meaningful,
`expectedTurnId`-style message ids): stale controls get `409` instead of acting
on a newer run. This is Codex's `turn/steer expectedTurnId` retry pattern,
server-side.

### 2.6 Priority and source tags on server work

Codex classifies every request (`critical` for thread open/start/steer/interrupt,
`background` for list refresh). Cheap to mirror: the server gives prompt/steer/
interrupt/close `critical` handling (already effectively true — they're
synchronous user actions), and marks poll-generated work (`/api/sessions`,
`/api/usage-summary`, `/search`) `background` so a slow index read can't stall a
user action. No new machinery needed — it's an explicit ordering policy over the
existing routes, plus a `source` tag for metrics.

### 2.7 Stream discipline (the unload analog)

- Close a session's detailed SSE when it's not selected and has been inactive
  (idle, no unread activity) for a grace period — mirrors Codex's 1 h unsubscribe
  + 30 min server unload, but the *stream* is the pi-dish resource, not a loaded
  thread. Reopen on select (catch-up via the existing `after=` mechanism).
- The terminal's existing 15-min idle kill is the runtime-level analog and stays.

## 3. UI: the Session Control takeover

A `<main>`-level takeover (usage/search/new-session pattern; mutually exclusive
with the others; Escape/✕/session-switch close).

**Launch section** (reuses the new-session takeover's controls): cwd picker,
model select, "Run in" target (headless/selected tmux/RPC), optional name,
prompt composer, **Create** and **Create and send** (two protocol operations,
per 2.4).

**Fleet section**: one row per active or starting session — name/workspace/model,
runtime kind, `activity` status (2.2) with elapsed time and current tool, queued
steer/follow-up count, controls gated by capability (2.1): Open, Steer, Follow up,
Interrupt, Terminate. Historical sessions resume into the fleet from the sidebar
as today. The fleet is driven by `/api/control/events` (2.3) with the poll as
reconciliation — no per-row sockets.

## 4. Responsibility boundaries (unchanged, restated)

| Layer | Owns |
|---|---|
| Web UI | presentation, drafts, navigation, optimistic display, the fleet |
| pi-dish server | HTTP/SSE projection, capability policy, operations, process/tmux supervision, run-id issuance |
| Bridge/RPC adapter | semantic actions → current pi runtime |
| Pi harness | session lifecycle, JSONL, models, queues, runs, compaction, branching |

The browser never writes JSONL; the server never mutates a live session
externally; terminating a runtime retains the session; PID signaling keeps the
current process-birth checks and no-SIGKILL policy; resume keeps
canonical-realpath single-flight and the uncertain-writer quarantine.

## 5. Scope

**MVP**: 2.1 adapters+capabilities, 2.2 activity snapshot, 2.3 control feed,
2.5 run-id guards, 3 fleet + Create/Create-and-send/Steer/Follow-up/Interrupt/
Terminate.

**Defer**: Codex-style fork (pi's `/tree`, `/fork`, `/clone` semantics differ —
live forks replace the runtime rather than coexist), archive (no native pi
contract; a pi-dish "hide" shouldn't masquerade as harness archival), permanent
bulk delete, a separate broker daemon (hidden tmux already provides durability),
and the 2.4 persisted-operation recovery if the reconciliation path proves
sufficient.

## 6. Decisions to settle

1. First release: fleet dashboard only, or also the launch form (I recommend
   both — they share the takeover and the operation state machine)?
2. "Create and send": auto-submit after registration (recommend yes, draft
   retained until acceptance)?
3. Is registry-based reconciliation enough for pending launches after a server
   restart (recommend yes for v1)?
4. Steer and Follow up as separate visible actions (recommend yes, with ordinary
   Send keeping today's behavior)?
5. Archive/fork in v1 (recommend deferring both)?
