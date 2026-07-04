# Task: Tool Execution Streaming

**Priority:** P0
**Status:** Done — live tool panels stream start/update/end over SSE (see `appendLiveToolPanel` / `updateLiveToolPanel` / `finalizeLiveToolPanel` in `public/app.js`)
**Affects:** `lib/rpc-session.js`, `server.js`, `public/app.js`, `public/style.css`

## Goal

Show live tool execution progress during an agent turn so the user can see what the agent is doing in real-time, instead of staring at a "working" badge.

## Background

The pi RPC protocol emits three events per tool call:

1. **`tool_execution_start`** — emitted when a tool begins executing
   ```json
   {
     "type": "tool_execution_start",
     "toolCallId": "call_abc123",
     "toolName": "bash",
     "args": {"command": "ls -la"}
   }
   ```

2. **`tool_execution_update`** — emitted during execution with accumulated output (not a delta — the full output so far)
   ```json
   {
     "type": "tool_execution_update",
     "toolCallId": "call_abc123",
     "toolName": "bash",
     "args": {"command": "ls -la"},
     "partialResult": {
       "content": [{"type": "text", "text": "total 48\ndrwxr-xr-x ..."}],
       "details": {"truncation": null, "fullOutputPath": null}
     }
   }
   ```

3. **`tool_execution_end`** — emitted when the tool finishes
   ```json
   {
     "type": "tool_execution_end",
     "toolCallId": "call_abc123",
     "toolName": "bash",
     "result": {
       "content": [{"type": "text", "text": "total 48\n..."}],
       "details": {}
     },
     "isError": false
   }
   ```

Use `toolCallId` to correlate all three events for the same tool call.

## Implementation Steps

### 1. Forward events over SSE (`server.js`)

In the `/api/sessions/:id/stream` SSE handler, subscribe to the three events on the RPC session and forward them:

```
event: tool_execution_start
data: {"toolCallId":"call_abc123","toolName":"bash","args":{"command":"ls -la"}}

event: tool_execution_update
data: {"toolCallId":"call_abc123","toolName":"bash","partialResult":{...}}

event: tool_execution_end
data: {"toolCallId":"call_abc123","toolName":"bash","result":{...},"isError":false}
```

Add these subscriptions alongside the existing `turn_start`, `message_start`, etc. subscriptions in the SSE handler.

### 2. Track active tool panels in the browser (`public/app.js`)

Add a `Map<string, HTMLElement>` keyed by `toolCallId` to track live tool panels currently rendered in the message view.

### 3. Render live tool panels (`public/app.js`)

Create a `renderLiveToolPanel(toolCallId, toolName, args, output?, isError?, isComplete?)` function that returns an HTML string for a tool panel in various states:

**Running state** (after `tool_execution_start`):
```
┌─ ⚡ bash ──────────────────────────────── ● running
│ $ ls -la
│ total 48
│ drwxr-xr-x ...
│ ▊  (scrolling output, auto-scroll to bottom)
└──────────────────────────────────────────
```

**Complete state** (after `tool_execution_end`):
```
┌─ ⚡ bash ──────────────────────── ✓ 1.2s ─┐
│ $ ls -la                                   │  ← collapsible
│ total 48                                    │
└─────────────────────────────────────────────┘
```

**Error state** (when `isError: true`):
Same layout but with red error styling and error icon.

### 4. Handle SSE events in the browser (`public/app.js`)

In `startMessageStream()`, add event listeners:

```javascript
evtSource.addEventListener('tool_execution_start', (e) => {
  const data = JSON.parse(e.data);
  appendLiveToolPanel(data);
});

evtSource.addEventListener('tool_execution_update', (e) => {
  const data = JSON.parse(e.data);
  updateLiveToolPanel(data);
});

evtSource.addEventListener('tool_execution_end', (e) => {
  const data = JSON.parse(e.data);
  finalizeLiveToolPanel(data);
});
```

- `appendLiveToolPanel` — insert a new tool panel into the messages container, add to the tracking map
- `updateLiveToolPanel` — update the output area of the panel with `partialResult.content`, auto-scroll
- `finalizeLiveToolPanel` — mark panel as complete, show success/error state, make collapsible, remove from tracking map

### 5. Integrate with existing tool call/result rendering

Currently, tool calls are rendered from the `message` content blocks (`type: "toolCall"`, `type: "toolResult"`). With live streaming, we have two rendering paths:

**Preferred approach:** When `tool_execution_start` arrives, render the live panel immediately. When `tool_execution_end` arrives, finalize it. When the full `message_end` event arrives, skip re-rendering tool calls/results that already have live panels (deduplicate by `toolCallId`). Only render tool calls/results that didn't have execution events (edge case: resuming mid-turn).

### 6. Styling (`public/style.css`)

Add styles for:

- `.live-tool-panel` — container with border, monospace font, background
- `.live-tool-header` — tool name, args summary, running/complete/error indicator
- `.live-tool-output` — scrollable output area, max-height during streaming
- `.live-tool-panel.running` — pulsing border or dot indicator
- `.live-tool-panel.complete` — static, collapsible
- `.live-tool-panel.error` — red accent

### 7. Cleanup on turn end

When `turn_end` fires, clean up any orphaned live tool panels (panels still in "running" state — shouldn't happen normally, but defensive). Then reload messages from JSONL as currently done.

## Testing

1. Start a pi session via pi-dish
2. Send a prompt that triggers multiple tool calls (e.g., "list the files in this directory and read README.md")
3. Verify:
   - Tool panels appear immediately as each tool starts
   - Output streams in real-time for bash commands
   - Panels transition from "running" to "complete" when tools finish
   - Error tool results show red styling
   - No duplicate panels after `turn_end` reloads messages
   - Auto-scroll works during streaming
   - Works on mobile layout

## Out of Scope

- `tool_execution_update` `partialResult.details` handling (truncation, fullOutputPath) — can be added later
- Collapsing long output during streaming — just show it live, collapse on completion
- Tool execution duration tracking — would require tracking start time, nice-to-have
