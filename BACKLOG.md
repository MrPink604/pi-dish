# pi-dish Backlog

Prioritized list of missing functionality compared to pi's TUI, based on audit of the RPC protocol (`docs/rpc.md`), pi-dish's `lib/rpc-session.js`, `server.js`, and `public/app.js`.

---

## P0 — Tool Execution Streaming

**Problem:** The RPC protocol emits `tool_execution_start`, `tool_execution_update`, and `tool_execution_end` for every tool call during an agent turn. pi-dish ignores all three. While the agent is working, the UI shows only a green "working" badge — no indication of *what* the agent is doing.

**Scope:**
- Forward `tool_execution_start/update/end` events over the SSE `/api/sessions/:id/stream` endpoint
- Render live tool panels in the message view showing:
  - Tool name + arguments (from `tool_execution_start`)
  - Streaming output (from `tool_execution_update`, which sends accumulated output)
  - Final result with error/success state (from `tool_execution_end`)
- Replace or augment the current static post-hoc tool call/result blocks with these live panels
- Auto-scroll during streaming, collapse on completion

**Why P0:** This affects every session, every turn. The single biggest pleasantness gap between the TUI and the web UI is feeling like nothing is happening while the agent works.

**Task file:** `TASKS/tool-streaming.md`

---

## P1 — Extension UI Dialog Protocol

**Problem:** Extensions can call `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, and `ctx.ui.editor()`. In RPC mode these emit `extension_ui_request` events on stdout and the agent **blocks** until the client sends back an `extension_ui_response` on stdin. pi-dish doesn't handle these events, so any extension that prompts the user causes a silent deadlock.

**Scope:**
- Detect `extension_ui_request` events in `rpc-session.js`
- Forward them over SSE to the browser
- Render modal dialogs in the web UI (select list, confirm yes/no, text input, multi-line editor)
- Send `extension_ui_response` back to the RPC process on the user's choice
- Handle the `timeout` field — if the extension specified a timeout, the agent auto-resolves, but the UI should still dismiss the dialog

**Why P1:** Low frequency but catastrophic when it hits. Any extension using `ctx.ui.confirm()` (e.g., to gate dangerous commands) will freeze the session indefinitely.

---

## P2 — Extension Fire-and-Forget UI

**Problem:** Extensions emit `notify`, `setStatus`, `setWidget`, `setTitle`, and `set_editor_text` as fire-and-forget `extension_ui_request` events. pi-dish ignores all of them.

**Scope:**
- **`notify`**: Render toast notifications in the UI (info/warning/error)
- **`setStatus`**: Show extension status indicators in the session header or a status bar
- **`setWidget`**: Render widget text above/below the input area (the RPC mode only supports string arrays, not component factories)
- **`set_editor_text`**: Pre-fill the prompt input when the extension sets editor text
- **`setTitle`**: Update the browser tab title

**Why P2:** Nice-to-have contextual information. Extensions that use `setStatus` (plan-mode, preset) and `setWidget` (todo lists, progress) lose their informational overlay in the web UI.

---

## P3 — Compaction & Retry Events

**Problem:** `compaction_start/end` and `auto_retry_start/end` events are unhandled. When auto-compaction triggers, the agent pauses with no feedback. When a transient error triggers retry, same issue.

**Scope:**
- Show a "Compacting context..." status during compaction
- Show "Retrying (attempt N/M)..." during auto-retry
- Display compaction summary after completion (tokens saved)

**Why P3:** Low frequency but confusing when it happens — the user sees the agent stop responding with no explanation.

---

## P4 — Steering & Follow-Up Queue Visibility

**Problem:** The `queue_update` event exposes pending steering and follow-up messages. Not shown in the UI.

**Scope:**
- Show queued messages in the UI (count or expandable list)
- Indicate which mode is active (`all` vs `one-at-a-time`)
- Allow cancelling queued messages

**Why P4:** Niche feature. Most users don't queue steering messages. Nice for power users who use `/steer` or the follow-up API.

---

## P5 — Streaming Text Deltas

**Problem:** The `message_update` event includes `assistantMessageEvent` with typed deltas (`text_delta`, `thinking_delta`, `toolcall_delta`). pi-dish currently forwards the whole `message` object on each update but doesn't use the delta info for incremental rendering.

**Scope:**
- Use `text_delta` events for true character-by-character streaming instead of replacing the whole message
- Use `thinking_delta` for streaming thinking blocks
- Use `toolcall_delta` for streaming tool call arguments as they're generated

**Why P5:** The current approach (replace entire message on each `message_update`) works but is inefficient and can cause flickering. Incremental deltas would be smoother.

---

## P6 — Additional RPC Commands

**Problem:** Several useful RPC commands are not wired up in `rpc-session.js` or exposed via the API.

**Missing commands:**
- `steer` / `follow_up` — queue messages during streaming (partially in `rpc-session.js` as `rpc.steer()` but not exposed via API)
- `get_session_stats` — accurate token counts and cost (currently estimated from file parsing)
- `get_last_assistant_text` — useful for copy-to-clipboard
- `get_fork_messages` / `fork` — RPC-native alternatives to the SDK-based tree branching
- `export_html` — trigger HTML export from the web UI
- `set_thinking_level` / `cycle_thinking_level` — control thinking from the web UI
- `set_auto_compaction` / `set_auto_retry` — toggle settings
- `switch_session` — load a different session without respawning
- `bash` — execute a bash command and include in next prompt context
- `get_available_models` — get models from the running session (more accurate than `pi --list-models`)
- `cycle_model` — quick model cycling

**Why P6:** Nice incremental improvements. `get_session_stats` is particularly useful for accurate context percentage display.

---

## Not Planned (Terminal-Only)

These TUI features require direct terminal access and have no RPC equivalent:

- **Custom components** (`ctx.ui.custom()`) — Returns `undefined` in RPC mode. Cannot render arbitrary terminal UI components over the web.
- **Custom editor** (`ctx.ui.setEditorComponent()`) — No-op in RPC mode.
- **Custom footer/header** — No-op in RPC mode.
- **Overlays** — No RPC equivalent.
- **Theme sync** — `getTheme()` / `setTheme()` return undefined/error in RPC mode.
- **Image rendering in terminal** — N/A for web (web has its own image support).
