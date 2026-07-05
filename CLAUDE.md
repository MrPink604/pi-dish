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
npm test           # API + helper unit tests (node:test, test/*.test.js)
npm run test:ui    # browser smoke test (needs Chrome + global playwright)
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

## Theme

Solarized dark. All colors flow from the `:root` tokens at the top of
`public/style.css` — no hardcoded hex in rules (use the tokens or an rgba of
them). The hljs theme is base16 solarized-dark, vendored as
`vendor/hljs-theme.min.css`; `style.css` overrides its `code.hljs` background
so code blocks keep the darker `--bg-darker` panel. The mobile hamburger is
part of the layout (`.header-menu-btn` in the session header,
`.empty-menu-btn` over the empty state) — don't reintroduce a fixed floating
button; it clipped over content.

## File / directory fuzzy search (lib/file-search.js)

Backed by fff (`@ff-labs/fff-node`, ESM-only + native binary, loaded via
lazy dynamic import): one indexed `FileFinder` per project cwd (LRU pool of
4) powers `GET /api/sessions/:id/files?q=` for @-mentions in the prompt.
fff refuses to index `$HOME`, so `GET /api/dirs?q=` (the new-session cwd
picker) uses a cached depth-4 directory walk plus the shared fuzzy scorer
from `public/helpers.js` instead. Everything degrades to the walker when
fff is unavailable — never let a missing native binary break the UI.

Client side: `@token` at the caret opens the file autocomplete (accept
inserts `@relative/path`); the cwd input merges known session cwds
(starred, score-boosted) with live `/api/dirs` results.

## Client session state (public/app.js)

`currentSession` is a **detached copy** of its entry in the `sessions`
lists (selectSession/loadMessages spread new objects). Any local mutation
(rename, model switch, thinking level) must go through `patchSession(id,
patch)`, which writes to both and re-renders sidebar + header — mutating
`currentSession` directly leaves the sidebar stale until the next poll
(the "rename needs F5" bug). `loadSessions()` folds fresh list data back
into `currentSession` after each poll for the same reason.

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

Scroll pinning: streaming only follows while the viewport is near the bottom
(`isPinnedToBottom`, 80px threshold). Sending a prompt or hitting
jump-to-bottom sets `followStream`, which forces following regardless of
scroll position — needed on mobile, where the keyboard resizing the container
silently un-pins. Only a deliberate gesture (wheel/touchmove/mousedown on the
feed) clears it; programmatic or layout-driven scroll shifts must not.

## Tests (test/)

`npm test` runs two node:test suites:
- `test/server.test.js` — boots `server.js` with `HOME` pointed at a temp dir
  containing a fixture JSONL and exercises session listing, message
  pagination (`limit`/`before`/`after`), and `/api/sessions/:id/search`.
- `test/helpers.test.js` — unit tests for `public/helpers.js`, the pure
  frontend helpers (escaping, formatting, filtering, fuzzy match, mood).
  Helpers are plain script globals in the browser and CommonJS exports in
  node; anything DOM-free that app.js needs belongs there, with a test.

Server behavior changes should extend these; UI changes need the smoke test
or manual CDP below.

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

This pattern is codified in `test/ui-smoke.js` (`npm run test:ui`): it boots
the server against a temp HOME, registers a fake bridge session whose socket
answers `get_commands`/`get_available_models`/`prompt` and, on `prompt`,
streams a whole turn (`turn_start`, `message_update` deltas, JSONL append,
`message_end`, `turn_end`) so the real SSE → streaming-renderer → catch-up
path is exercised end to end, plus the mobile hamburger/drawer flows. Extend
it for new UI flows; write one-off CDP scripts in the scratchpad only for
exploratory debugging.

## Sidebar behavior (public/app.js)

The session list defaults to the **Active** filter (live sessions only, count
badge in the tab). The **All** tab merges active + historical sessions, grouped
by workspace cwd; historical ones get the `.session-item.inactive` dimming.
Each item shows one status dot, best signal first: pulsing green
(`.session-item-status.working`, turn in progress), accent blue
(`.session-item-status.unread`, activity since the session was last on
screen — `isUnreadSession()` in helpers.js against the localStorage
`pi-dish-seen` map), or the static green `.live-dot` (All tab only). The tab
title carries the unread count (`(2) pi-dish`). Search in All mode is server-side
(`/api/sessions?q=` — matches metadata and message content); filtering in
Active mode is local.

## Model dropdown / scoped models (public/app.js)

The header model dropdown mirrors pi's scoped-models feature (`/scoped-models`
in the TUI). pi's extension/RPC APIs expose no way to read or set a live
session's scoped set, so pi-dish works off the persisted form: `enabledModels`
patterns in `~/.pi/agent/settings.json`. `GET /api/models` annotates each
model with `enabled` (matcher `isModelEnabled()` in `public/helpers.js` —
exact ids, alias→dated-version prefixes, minimatch-style globs, `:level`
suffixes); the dropdown hides disabled models (the active model always shows)
with an "N hidden" footer. "⚙ Edit models" enters a checkbox switcher that
writes explicit `provider/id` ids back via `PUT /api/models/enabled` (all
enabled → field deleted), like the TUI's Ctrl+S persist. pi merges only its
own modified fields on save, so the external write is safe; running TUI
sessions pick the new scope up on next launch. Gotcha: edit-mode clicks
re-render the dropdown's innerHTML before the click bubbles to the document,
so the outside-click closer must treat detached targets as inside.

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
