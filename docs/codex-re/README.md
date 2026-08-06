# Codex Desktop App — Thread Management Reverse Engineering

RE of the **actual desktop client** (not just the open-source app-server), done for the
pi-dish control-surface proposal (see [proposal.md](./proposal.md)). The previous
analysis in this repo's history stopped at "the desktop app is closed source" — it
is, but it ships as an Electron app whose bundles are trivially extractable.

## Artifact

| Item | Value |
|---|---|
| App | `openai-codex-electron` (productName "Codex"), version **26.730.61639** (2026-08-05) |
| Source | OpenAI's own CDN: `https://persistent.oaistatic.com/codex-app-prod/appcast.xml` → `ChatGPT-darwin-arm64-26.730.61639.zip` (568 MB) |
| App bundle | `ChatGPT.app/Contents/Resources/app.asar` (235 MB extracted) |
| Linux runtime deps | `codex-primary-runtime-linux-x64-26.426.12240.tar.xz` (203 MB, same CDN) |
| Extraction | `npx @electron/asar extract` — no sourcemaps, minified Vite/webpack bundles |
| Working copy | `docs/codex-re/webview-client.js` (14.5 MB, the React app), `docs/codex-re/main-appserver-client.js` (1.4 MB, Electron main: app-server client), `docs/codex-re/main-worker.js`, plus extracted class dumps (`threadstore-class.js`, `request-client-class.js`, `appserver-connection-class.js`) |

Prior art that helped orient: `wikty/codex-accounts` (quota endpoints), `better-slop/codex-app-linux`
(launcher; its asar patches are platform glue only — window transparency, open-in-editor
targets — so their repack is a faithful copy of the core app).

All quotes below are from the actual bundles. Symbols are minified; names are the
human-readable ones I assigned during analysis.

---

## 1. Architecture: three layers, one multiplexed stream

```
┌─────────────────────── webview (React, app-initial-*.js) ───────────────────────┐
│  ThreadStore (client state)  ·  AppServerRequestClient (queue)  ·  UI           │
└──────────────┬───────────────────────────────────────────────────────────────────┘
               │  IPC envelopes: mcp-request / mcp-response / mcp-notification
               │  (preload.js → ipcRenderer.invoke('codex_desktop:message-from-view'))
┌──────────────▼───────────────────────────────────────────────────────────────────┐
│  Electron main (src-Bn_6ASpg.js: AppServerConnection, ClientRequestQueue,        │
│  PrewarmedThreads, request tracing, per-window notification routing)             │
└──────────────┬───────────────────────────────────────────────────────────────────┘
               │  transport: JSONL-over-stdio  |  WebSocket  |  local daemon socket
┌──────────────▼───────────────────────────────────────────────────────────────────┐
│  app-server (Rust, open source — codex-rs) — canonical store, execution          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**All threads share one connection.** Every app-server event (`thread/started`,
`thread/status/changed`, `turn/started`, `turn/completed`, `item/*`) is multiplexed
over the single transport; the main process broadcasts it to every window as an
`mcp-notification` and the webview routes by `threadId`. There is no per-thread
stream anywhere.

### Transport selection (main process)

- **Embedded stdio** (default): spawns the bundled `codex` binary —
  `-c features.code_mode_host=true [-c chatgpt_base_url=…] [-c openai_base_url=…] app-server --analytics-default-enabled`.
  Binary resolution: `hostConfig.codex_cli_command` → `CODEX_CLI_PATH` → Electron
  resources `bin/codex`. JSONL frames over stdin/stdout; stdout dispatch is
  time-sliced (≤200 msgs / ≤8 ms per slice) with queue-depth thresholds
  `[100,250,500,1000,2500,5000]`.
- **WebSocket**: when `hostConfig.websocket_url` (or `CODEX_APP_SERVER_WS_URL`) is
  set — used for remote/VS-Code-style hosts. Only WS `supportsReconnect()`;
  reconnect backoff `[100,250,500,1000,2500,5000]` ms.
- **Local daemon socket**: `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1` →
  `~/.codex/app-server-control/app-server-control.sock` (a second IPC protocol with
  `initialize`/`request`/`response`/`broadcast` frames and client registration —
  the app-server-control channel, distinct from the app-server protocol).

### Handshake & version gate

`initialize {clientInfo, capabilities: {experimentalApi: true, extensions,
mcpServerOpenaiFormElicitation, requestAttestation, optOutNotificationMethods}}`.
Connection states: `connecting → (initialize) → confirming-connection → connected`
with a min supported app-server version `0.141.0` (`codex-app-server-version-unsupported:`
→ update-required; `restart-available:` → restart-required). Non-retryable fatal
errors stop the reconnect loop.

### Request/notification framing

- Client→server request: `{id, method, params}`; server replies `{id, result|error}`
  (JSON-RPC-style; unknown-method responses use `-32000`/`-32603` error codes).
- Server→client: notifications `{method, params}`; server→client requests
  (`app/list` etc.) are answered by the main process or broadcast to windows.
- The main process correlates responses back to the originating window
  (`pendingRequests` map), and **traces**: `thread/start`/`thread/fork` with a trace
  are remembered as `pendingThreadStarts` (60 s); `thread/resume`/`turn/start` open a
  thread-scoped trace (60 s) so `turn/completed` notifications are linked to the
  originating window; `thread/unsubscribe` and `thread/delete` tear the trace down.

---

## 2. The thread vocabulary

Server protocol (`codex-rs`, `app-server-protocol/src/protocol/v2/`):

```rust
pub struct Thread {
    id: String,                    // UUIDv7
    session_id: String,            // session tree; several threads can share one
    forked_from_id: Option<String>,
    parent_thread_id: Option<String>, // set for subagent threads
    preview: String,               // usually first user message
    ephemeral: bool,               // not materialized on disk
    history_mode: ThreadHistoryMode, // full | paginated
    model_provider: String,
    created_at / updated_at: i64,  // unix seconds
    recency_at: Option<i64>,       // recency ordering key
    status: ThreadStatus,
    path: Option<PathBuf>,         // rollout JSONL on disk
    cwd: AbsolutePathBuf,
    cli_version: String,
    source: SessionSource,
    can_accept_direct_input: Option<bool>,
    git_info, name, …
}

pub enum ThreadStatus {
    NotLoaded,                     // cold (stored only)
    Idle,                          // loaded, nothing running
    SystemError,
    Active { active_flags: Vec<ThreadActiveFlag> },
}
pub enum ThreadActiveFlag { WaitingOnApproval, WaitingOnUserInput }

pub enum TurnStatus { Completed, Interrupted, Failed, InProgress }

pub struct Turn { id, items, items_view, status, error, started_at, duration_ms, usage, diff }
```

Server lifecycle (`thread_lifecycle.rs`):

- **Auto-subscribe**: `thread/start`, `thread/resume`, `thread/fork` each call
  `ensure_conversation_listener` → the requesting connection is subscribed and a
  per-thread listener task starts.
- **Unload**: `THREAD_UNLOADING_DELAY = 30 min` measured from when the thread has
  *both* no subscribers *and* is inactive (`max(no_subscribers_since, inactive_since) + delay`).
- `thread/unsubscribe` returns `notLoaded | notSubscribed | unsubscribed`.
- `thread/status/changed {threadId, status}` is pushed on transitions.

---

## 3. Client-side thread management (the part nobody had RE'd)

### 3.1 ThreadStore (webview) — the client is a *projection*, not a manager

The webview keeps four tiers of thread knowledge:

1. **`threadSummaries`** — compact sidebar entries
   `{conversationId, title, cwd, updatedAt, recencyAt, threadRuntimeStatus,
   hasUnreadTurn, modelProvider, historyMode, …}` fed by `thread/list`.
2. **`threadsById`** — full `Thread` metadata for anything seen (list rows,
   notifications, reads).
3. **`conversations`** — the *hydrated* per-thread UI state (turn list, params,
   `threadRuntimeStatus`, `resumeState: needs_resume|resumed`, pending requests,
   workspace info). Only threads the UI actually shows are hydrated.
4. **`runtimeThreadStatusEvidenceByThreadId`** — status overrides for threads that
   are **not** hydrated: `thread/status/changed` for a cold thread is stashed here
   (and if the status turns `active`, the client eagerly hydrates pinned threads).

Plus: `subscribers` (field-level reactive subscriptions — `thread.title`,
`thread.status`, `turn.status` per entity), `threadReadStates` (in-flight
`thread/read` dedupe, capped at 500), `recentConversationIds` (recency-sorted
sidebar, default limit 50, sort keys `recency_at | updated_at | created_at`).

### 3.2 Sidebar list: background, cursor-paginated, state-DB-backed

```js
thread/list {limit, cursor, sortKey, modelProviders, archived:false,
             sourceKinds, useStateDbOnly:true}
// priority: background, source: recent_threads
```

Pagination cursors; `thread/search {searchTerm, cursor, limit, sortKey, archived}`
for search. Refreshes are on-demand + event-driven, never a hot poll. `useStateDbOnly`
means the app-server answers from its SQLite projection without touching thread
state — the exact analog of pi-dish's session index.

### 3.3 Request discipline: priorities, sources, timeouts, coalescing

`AppServerRequestClient`:

- Queue caps per priority: `critical:16, interactive:64, background:128`; max 6
  in flight; background yields after every 4 interactive dispatches.
- Every request carries a **source tag** (`thread_hydration`, `recent_threads`,
  `thread_list`, `collab_hydration`, `tail_history`, `filesystem`,
  `fuzzy_file_search`, `remote_control`, …) and a priority; timeout per request
  (thread/turn ops: 30 s — `ev=3e4`).
- `config/read` coalesces concurrent callers (memoized with a `coalescedRequestCount`).
- Critical set: `thread/start, thread/resume, turn/start, turn/steer, turn/interrupt,
  thread/approveGuardianDeniedAction` — user-visible actions jump the queue.

### 3.4 New thread = *prewarm* (create before the user types)

This is the single most interesting mechanism for pi-dish:

1. Opening the new-thread composer (or booting to it) fires
   `prewarmThreadStart(threadStartParams, {priority:'critical'})` — a real
   `thread/start` **before any input exists**. Client-side
   `PrewarmedThreadManager` dedupes per cwd (`hasPrewarmedThread(cwd, workspaceRoots,
   serviceName, historyMode)`) and considers a prewarm fresh for **4.75 minutes**.
2. The main process marks it `prewarmThread:true`; on success it registers the
   thread in `PrewarmedThreads` with a **10-minute TTL**. The app-server's
   `thread/started` notification for it is **suppressed** (`suppressThreadStarted`)
   so windows don't see a ghost thread.
3. When the user hits send, the client **consumes** the prewarmed thread (validating
   permissions/instruction-overrides still match) and issues `turn/start` on it;
   the main process `publishThreadStarted` broadcasts the deferred `thread/started`.
4. If the composer is abandoned, the TTL fires → `thread/delete` for the orphan
   (client `discardPrewarmedThread` does it immediately on switch).

So the durable record is created cheaply up front, and the expensive part (a turn)
only starts on real input — with a server-side garbage-collection guarantee.

### 3.5 Submitting a turn: optimistic state, bind on response

- Client sets the conversation `threadRuntimeStatus={type:'active'}` and creates an
  optimistic turn `{status:'inProgress', turnId:null, turnStartedAtMs:now}` with a
  `clientUserMessageId`, **before** the request leaves.
- `turn/start {threadId, clientUserMessageId, input, additionalContext, cwd, model,
  serviceTier, effort, approvalPolicy, approvalsReviewer, sandboxPolicy,
  permissions, runtimeWorkspaceRoots, attachments, …}` (critical, 30 s).
- The response's `turn.id` is bound to the optimistic state; `turn/started` and
  `turn/completed` notifications reconcile/finalize it (status, durationMs, error,
  plan extraction, follow-up queue, unread marking).

### 3.6 Steer and interrupt are *guarded* controls

```js
turn/steer   {threadId, clientUserMessageId, input, expectedTurnId, additionalContext, …}
turn/interrupt {threadId, turnId}
```

- Steer requires the *current* turn id (`expectedTurnId`); the client waits for an
  active turn if none exists (with a timeout → "Cannot steer conversation … without
  an active turn id"). Steered messages appear in the transcript with `targetTurnId`.
- Interrupt optimistically sets `status:'interrupted'` and **retries on race** —
  if the interrupt fails because the turn id is stale, it re-reads the current
  turn and re-issues. A separate `thread/stop` exists for "durable" threads.
- Subagent descendants of a stopped thread are interrupted via a
  descendant-walk (`discoverSubagentDescendantSnapshot` → `turn/interrupt` each).

### 3.7 Switching threads: rich resume + two-tier unload

- Opening a historical thread: `thread/resume {threadId, path, model, modelProvider,
  serviceTier, cwd, approvalPolicy, permissions, config, baseInstructions,
  developerInstructions, personality, excludeTurns, initialTurnsPage:{limit:5,
  itemsView:'full', sortDirection:'desc'}}` + `thread/goal/get`. `thread/read`
  (`includeTurns`) is the light path for already-loaded threads. Paginated history
  uses `thread/turns/list {cursor, limit, sortDirection, itemsView}`.
- The previous thread **stays loaded**. The `InactiveThreadUnsubscriber` tracks
  owner streams that are not the active view: after **1 hour** of inactivity
  (owner + resumed + not visible + no followers), the client sends
  `thread/unsubscribe`; the server then unloads **30 minutes** later.
  Ephemeral side-conversations (collab agents) are kept loaded deliberately.
- Cache eviction (archive / delete / discard / empty-thread) removes all per-thread
  state from the ThreadStore.
- **Ephemeral and subagent threads are noise-filtered**: the main process drops
  nearly all notifications for ephemeral threads and background-subagent deltas,
  so a fleet of subagents can't swamp the UI.

### 3.8 Notification → state mapping (selected)

| Event | Client action |
|---|---|
| `thread/started {thread}` | upsert conversation state, unread tracking, realtime registry |
| `thread/status/changed {threadId, status}` | hydrated → set `threadRuntimeStatus`; cold → stash evidence; `active` on a cold pinned thread → hydrate it; `idle` → maybe-continue-thread-goal |
| `thread/name/updated`, `thread/settings/updated` | title / settings patch |
| `thread/goal/updated|cleared`, `thread/archived|unarchived|deleted` | lifecycle patches |
| `turn/started {threadId, turn}` | bind/complete optimistic turn state |
| `turn/completed {threadId, turn}` | finalize (status, durationMs, error, plan stats), follow-up queue, unread |
| `item/started` etc. | streamed item deltas into the active turn |

### 3.9 Boot

`getInitialSidebarBootstrap` (sync IPC) + `thread/list` recent-50 (background) +
pinned-thread hydration; only the open thread gets turns. This is the same shape as
pi-dish's cold-load baseline + sidebar scan.

---

## 4. What this means for a pi-dish control surface

The desktop client's thread management is, in one sentence:

> **A single multiplexed event stream, a summary-level list projection, a
> request queue with priority classes, optimistic turn state bound by id on
> response, prewarmed creation with server-side GC, and a two-tier
> subscribe/unload discipline — with the client never touching the canonical
> store directly.**

The concrete transferable mechanisms are mapped onto pi-dish in
[proposal.md](./proposal.md). The headline items:

1. **Status vocabulary** — replace `turnInProgress` with
   `idle | active{waitingOnApproval, waitingOnUserInput} | notLoaded | systemError`
   (Codex's exact `ThreadStatus`), driven by `agent_start`/`agent_settled` +
   dialog/approval state.
2. **One global control feed** instead of per-row polling or per-session SSE —
   the app-server pushes everything on one connection; pi-dish should do the same
   with a `/api/control/events` SSE (the previous proposal's item 5, now confirmed
   by the client architecture).
3. **Prewarm-style two-step creation** — create the durable session record first
   (cheap), spawn the runtime asynchronously, deliver the prompt only after
   registration with a run-id guard. Codex proves the pattern with its composer
   prewarm + TTL GC.
4. **Guarded controls** — `expectedTurnId`-style `expectedRunId` on steer/interrupt
   (the previous proposal's item 4).
5. **Priority/source tags on every request** — cheap to add to pi-dish routes, and
   the client can already express it (sidebar refresh = background).
6. **Unload discipline** — pi-dish's per-session SSE should close when a session is
   not selected and inactive (mirrors 1 h unsubscribe + 30 min server unload), and
   the terminal's existing idle-kill is the runtime-level analog.

Extraction artifacts and this analysis live in `docs/codex-re/`.
