# Task: Tool-Call Visibility — Reconnect Replay + OMP Event Tolerance (WS-D)

**Priority:** P0
**Status:** Planned — spiked with live evidence 2026-08-13
**Affects:** `server.js` (SSE stream route), `lib/bridge-session.js`,
`lib/rpc-session.js`, `public/app.js`
**Parent:** `TASKS/omp-full-support.md`

## Problem

Users report not seeing all tool calls in OMP sessions. Spike evidence
(real OMP 17.2.15 session, `zai/glm-4.7-flash`, through pi-dish HTTP/tmux):

1. **No mid-turn catch-up on SSE connect.** The stream's `init` event carries
   only `{"turnInProgress":true,"compacting":false}`. A client that connects
   or reconnects while a tool is executing never learns about in-flight tool
   calls; the happy path only works if the client held the stream open when
   `tool_execution_start` fired. Phone screen-lock / tab-switch mid-turn —
   pi-dish's headline use case — hits this constantly.
2. **The frontend silently drops start-less frames.** `updateLiveToolPanel`
   and `finalizeLiveToolPanel` in `public/app.js` both bail
   (`if (!entry || !entry.el) return`) when no panel exists for the
   `toolCallId`. Combined with (1), every reconnect mid-execution loses the
   running tool's panel entirely until the next full transcript refresh.
3. **OMP legitimately emits completion-only events.** Verified upstream
   (can1357/oh-my-pi source): provider-resolved Cursor server tools may
   arrive as completion-only (no start); background jobs can emit further
   update/end frames for the same `toolCallId` *after* its initial
   `tool_execution_end` and after `turn_end` (the client clears
   `liveToolPanels` on turn_end); final background delivery arrives as a
   custom message `role: "custom", customType: "async-result"`, not a tool
   event.
4. **Nested executions are outer-only by OMP design.** Tools invoked inside
   `eval` (JS tool bridge calls `tool.execute()` directly) and subagent
   (`task`) internals do not emit parent-session `tool_execution_*` events.
   Child activity is aggregated into the outer `task` call's
   `tool_execution_update.partialResult.details` and internal
   `task:subagent:*` channels.

What already works (verified live, do not regress): parallel tool calls
interleave correctly and pair by `toolCallId` (2× read + 2× bash + OMP's
`hub` streamed 5/5 start/end pairs); the historical transcript path renders
all toolCall/toolResult pairs including OMP's `custom`
(`customType: "tool_execution_start"`) diagnostic entries being skipped
harmlessly; `omp` JSONL parses via the existing profile.

## Fix plan

### 1. Server: track and replay in-flight tool executions

Both `BridgeSession` and `RpcSession` should maintain a
`runningToolCalls: Map<toolCallId, { toolName, args, startedAt, lastPartialResult }>`
updated from `tool_execution_start/update/end`. On SSE connect, after `init`,
replay a synthetic `tool_execution_start` (and the latest
`tool_execution_update` if any) for each in-flight call so a fresh client
reconstructs live panels. Clear the map on `turn_end`/`agent_end`, but
tolerate late frames (see 3).

Keep the identity-encoded SSE assertion and flush behavior (CLAUDE.md).

### 2. Client: upsert panels by toolCallId, never drop frames

- `updateLiveToolPanel` and `finalizeLiveToolPanel`: when no panel exists,
  create it (reuse `appendLiveToolPanel`'s path) instead of returning —
  completion-only calls render as an already-finished panel.
- Late frames for a finalized/cleared `toolCallId` (background jobs after
  turn_end) must re-open or re-create the panel rather than being dropped;
  don't let `turn_end` cleanup make later frames invisible.
- Keep dedupe semantics: cumulative `message_update` snapshots repeat
  `toolCall` blocks — never create a second panel for a known id.

### 3. Render OMP's background/async completion

Handle `custom`/`custom_message` with `customType: "async-result"` as a
visible "background job finished" row in both live (SSE `message_update`/
`message_end` carrying role `custom`) and historical paths. Today it renders
as nothing.

### 4. Historical entry tolerance (small)

`lib/session-files.js` transcript decoding: explicitly skip-but-tolerate
OMP entry types `custom` (`tool_execution_start`, `session_exit`),
`session_init`, `reset_boundary`, `mode_change`, `ttsr_injection`,
`credential_pin`, `label`, `service_tier_change` — none should break
parsing or counters. `reset_boundary` may render as a divider like
compaction does if cheap.

### 5. Optional stretch (separate commit, only if time allows)

Surface outer `task` subagent progress from
`tool_execution_update.partialResult.details` inside the task panel
(text-only). Do NOT subscribe to `task:subagent:*` channels or child
sessions in this slice.

## Verification

- Unit: server replay tests (connect mid-execution sees synthetic start +
  latest update; end after replay finalizes one panel), client-path tests
  where feasible, session-files tolerance fixtures.
- Real canary (omp + ZAI key, cheap `zai/glm-4.7-flash --thinking minimal`):
  (a) prompt forcing a `sleep 12` bash tool, connect a fresh SSE stream
  mid-execution, assert the running tool appears and finalizes; (b) a
  background `sleep && echo` job via OMP's async bash/hub, assert the late
  completion is visible; (c) parallel reads + bash still render 100% of
  calls. UI smoke via the existing harness.
- `npm test` green; no regression to Pi RPC sessions (same replay benefits
  apply there — keep behavior identical for both transports).
