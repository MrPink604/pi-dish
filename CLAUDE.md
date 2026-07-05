# pi-dish

Web/phone remote control for pi coding-agent sessions. Express server (`server.js`)
+ vanilla JS frontend (`public/`), plus an Electron shell (`electron/`) that loads
the same server. Sessions are discovered two ways: live sessions via the
pi-dish-bridge extension registry (`~/.pi/dish/sessions/*.json`, one Unix socket
per session), historical sessions by scanning JSONL files under
`~/.pi/agent/sessions/`.

## Run

```bash
npm start          # server on http://localhost:3333 (PORT env to override)
npm test           # API tests (node:test, test/*.test.js, fixture HOME)
npm run build:vendor  # regenerate public/vendor/ from node_modules
```

## Frontend libraries (public/vendor/)

`marked` and `highlight.js` are vendored — **no CDN scripts**. Phones on the
LAN may have no internet, and a silently missing CDN `marked` used to degrade
markdown to a crude regex fallback. `scripts/build-vendor.js` copies marked's
UMD build and wraps highlight.js's CJS `lib/common` into a browser bundle
(the npm package ships no browser build). Re-run it after bumping either
dependency. Note marked v12 removed the `highlight` option — code blocks are
highlighted post-render via `applyHighlight()` (final renders only, never
during streaming).

## Streaming pipeline

pi emits `message_update` on every delta, each carrying the **full message so
far** — intermediates are droppable. The path is:

1. Bridge extension broadcasts events over the session's Unix socket.
2. `server.js` SSE (`/api/sessions/:id/stream`) forwards them, coalescing
   `message_update` per connection (~50ms window, latest wins). The legacy
   split events (`thinking`/`tool_call`/`tool_result`) are gone — everything
   streams through `message_update`.
3. `public/app.js` queues the latest message and renders through
   `renderStreamingMessage()` — a throttled (~80ms) **incremental block-level
   renderer**: one streaming DOM element, one child per content block
   (`data-block-index`), and only changed blocks are touched. No
   outerHTML swaps, so `<details>` open state survives and markdown renders
   live mid-stream. `message_end`/`turn_end` finalize (cancel pending render,
   swap in the authoritative render, apply highlighting).

## API tests (test/)

`npm test` boots `server.js` with `HOME` pointed at a temp dir containing a
fixture JSONL (see `test/server.test.js`) and exercises session listing,
message pagination (`limit`/`before`/`after`), and `/api/sessions/:id/search`.
Server behavior changes should extend these; UI changes still need CDP.

## UI testing (browser, CDP)

UI changes are validated by driving real Chrome over CDP
with the globally installed playwright (`NODE_PATH=/usr/lib/node_modules`):

- Launch via `chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true })`.
  Note: spawning `google-chrome-stable --remote-debugging-port=...` by hand does
  not work on this machine (the CachyOS wrapper never opens the debug port) —
  let playwright launch the binary itself.
- To get a live session in the list without a real pi session, register a fake
  bridge entry: create a Unix socket server plus a JSON file in
  `~/.pi/dish/sessions/` with `{ sessionId, socketPath, pid, cwd, name, model,
  contextUsage }`. The registry prunes entries whose pid is dead or socket is
  missing, so keep the fake process running for the duration of the test and
  delete the JSON on exit.
- Assert against the DOM (`.session-item`, `.workspace-group-header`, tab state)
  and capture screenshots; also watch `pageerror`/console errors. Chrome
  occasionally logs a flaky favicon 404 — ignore it.

Example scripts: fake session registration and a full CDP walkthrough lived in
the session scratchpad as `fake-session.js` / `cdp-test.js` — recreate that
pattern for future UI validation. The streaming-work versions had the fake
socket answer `get_commands`/`get_available_models`/`prompt` and, on `prompt`,
stream a whole turn (`turn_start`, `message_update` deltas with thinking +
markdown text, `tool_execution_*`, JSONL append, `message_end`, `turn_end`) so
the real SSE → renderer path is exercised end-to-end.

## Sidebar behavior (public/app.js)

The session list defaults to the **Active** filter (live sessions only, count
badge in the tab). The **All** tab merges active + historical sessions, grouped
by workspace cwd; live sessions get a green `.live-dot` and historical ones the
`.session-item.inactive` dimming. Search in All mode is server-side
(`/api/sessions?q=` — matches metadata and message content); filtering in
Active mode is local.

## Message view (public/app.js)

- **Focus mode** hides tool results, tool-call details, live tool panels, and
  `.message.assistant.no-text` (tool-only turns — without that class their
  empty header rows linger as stray markers). Both the static renderer and the
  streaming renderer maintain `no-text`.
- **In-session search**: 🔍 header button / Ctrl+F. `GET
  /api/sessions/:id/search?q=` returns `{ matches: [{index, role}] }` over the
  whole session; the client walks matches (Enter = backwards, Shift+Enter =
  forwards), auto-paging older messages in via `loadOlderMessages()` until the
  match index is in the DOM, then marks hits (`mark.search-mark`) and outlines
  the message (`.search-current`). In focus mode, `toolResult` matches are
  skipped.
