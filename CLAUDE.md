# pi-dish

Web/phone remote control for pi coding-agent sessions. Express server (`server.js`)
+ vanilla JS frontend (`public/`), plus an Electron shell (`electron/`) that loads
the same server. Sessions are discovered two ways: live sessions via the
pi-dish-bridge extension registry (`~/.pi/dish/sessions/*.json`, one Unix socket
per session), historical sessions by scanning JSONL files under
`~/.pi/agent/sessions/`.

## Run

```bash
npm start          # server on http://127.0.0.1:3333 (PORT/HOST env to override;
                   # localhost-only by default — HOST=0.0.0.0 to expose on LAN)
npm test           # API + helper unit tests (node:test, test/*.test.js)
npm run test:ui    # browser smoke test (needs Chrome + global playwright)
npm run build:vendor  # regenerate public/vendor/ from node_modules
```

## Committing

Once you've verified your changes work (tests pass; UI changes validated via
the smoke test or CDP), commit and push them — don't leave verified work
sitting uncommitted.

## Frontend libraries (public/vendor/)

`marked` and `highlight.js` are vendored — **no CDN scripts**. Phones on the
LAN may have no internet, and a silently missing CDN `marked` used to degrade
markdown to a crude regex fallback. `scripts/build-vendor.js` copies marked's
UMD build and wraps highlight.js's CJS `lib/common` into a browser bundle
(the npm package ships no browser build). Re-run it after bumping either
dependency. Note marked v12 removed the `highlight` option — code blocks are
highlighted post-render via `applyHighlight()` (final renders only, never
during streaming). The same pass wraps each fenced block in `.code-block` and
injects its copy button; copying goes through `copyTextToClipboard()`, which
falls back to `execCommand('copy')` because `navigator.clipboard` doesn't
exist on insecure origins (phones hit the server over plain LAN http — a
clipboard-only button silently no-ops there).

## Theme

Solarized dark. All colors flow from the `:root` tokens at the top of
`public/style.css` — no hardcoded hex in rules (use the tokens or an rgba of
them). The hljs theme is base16 solarized-dark, vendored as
`vendor/hljs-theme.min.css`; `style.css` overrides its `code.hljs` background
so code blocks keep the darker `--bg-darker` panel. The mobile hamburger is
part of the layout (`.header-menu-btn` in the session header,
`.empty-menu-btn` over the empty state) — don't reintroduce a fixed floating
button; it clipped over content.

## Session JSONL parsing (lib/session-files.js)

All server-side reads of `~/.pi/agent/sessions/*.jsonl` go through this
module: `getSessionInfo` (list metadata), `readSessionMessages` (the
paginated message stream), `getSessionSearchText` (list search),
`getSessionStats` (token/cost aggregates for `/stats`), and `readSessionCwd`
(bounded first-line read — never load a whole file just for its header). The
readers share one `statCached` implementation keyed on (mtimeMs, size) — the
sidebar polls `/api/sessions` every 10s, so nothing may re-parse unchanged
files per request. `getSessionInfo` returns a copy (callers overlay live
usage onto it); the other readers return the cached value itself — never
mutate it. Context window/percent are derived in server.js (`withContext`)
at read time, not inside the cache — the models cache warms asynchronously
and would bake in stale windows.

Server-side session dispatch: `getLiveSession(id)` in server.js is the one
place bridge-vs-RPC resolution lives (bridge registry entry → connected
BridgeSession, else alive RPCSession, else null). Don't re-roll the
`getRegisteredSession ? getBridgeSession : getRPCSession` dance in routes;
branch on `instanceof BridgeSession` only for genuinely backend-specific
calls (setModel arg shapes, runCommand vs the RPC slash emulation).

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
   live mid-stream. `message_end` swaps the placeholder for the finalized
   render **in place and un-indexed**; the `turn_end` JSONL catch-up then
   replaces it with the indexed version (never gate that insert on other
   messages' indexes — an old check did, and streamed text vanished until
   catch-up).

Working indicator: `setTurnInProgress` drives an elapsed-turn ticker
(`updateWorkingIndicator`); the header badge reads "Working 1:42 · Bash"
(current tool tracked via `tool_execution_start/end` in `runningTools`; the
mobile badge shows the timer only). Timing is client-side by design — opening
a session mid-turn counts from connect.

Extension UI (`extension_ui_request`: widgets, status badges, dialogs) is
per-session state: the server remembers each live session's current set
(`trackExtUIState` in server.js) and replays it into every new SSE
connection; the client wipes the DOM on session switch (`clearExtensionUI`).
Widget collapse state is remembered per session+key across switches.

Scroll pinning: streaming only follows while the viewport is near the bottom
(`isPinnedToBottom`, 80px threshold). Sending a prompt or hitting
jump-to-bottom sets `followStream`, which forces following regardless of
scroll position — needed on mobile, where the keyboard resizing the container
silently un-pins. Only a deliberate gesture (wheel/touchmove/mousedown on the
feed) clears it; programmatic or layout-driven scroll shifts must not.

## Tests (test/)

`npm test` runs three node:test suites:
- `test/server.test.js` — boots `server.js` with `HOME` pointed at a temp dir
  containing a fixture JSONL and exercises session listing, message
  pagination (`limit`/`before`/`after`), `/search`, `/stats`, request
  validation, and cache revalidation after JSONL appends.
- `test/helpers.test.js` — unit tests for `public/helpers.js`, the pure
  frontend helpers (escaping, formatting, filtering, fuzzy match, mood).
  Helpers are plain script globals in the browser and CommonJS exports in
  node; anything DOM-free that app.js needs belongs there, with a test.
- `test/session-files.test.js` — unit tests for the JSONL parsers and their
  mtime/size caches in `lib/session-files.js`.

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
- Gotcha: playwright's rAF-polled waits (`waitForSelector`/`waitForFunction`)
  on this real-Chrome headless can miss elements that exist only ~200ms if
  they appear a while *after* the wait starts (bisected: the smoke turn's
  streaming placeholder is caught with the fake tool phase at 150ms but
  missed at 450ms, with identical DOM timelines). Don't stretch fake-bridge
  delays to widen assertion windows; make assertions event-driven instead —
  emit bridge events and let the *test* decide when the state ends, like the
  working-indicator section does.

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
Polls on the Active tab request `?active=1` — the server skips the historical
session-tree scan and the client keeps its previously fetched `previous` list
(the initial load always fetches both, so restoring a saved historical session
still works).
Clicking a workspace group header collapses it — sessions hidden, group sunk
below all expanded groups (ordering in `groupByWorkspace`, helpers.js). The 📌
on a session row pins it into a "Pinned" section at the top with a manual
order: pointer-based drag handles (works on touch), with move/up listeners on
`document` because reinserting the dragged row releases pointer capture. Both
persist in localStorage (`pi-dish-collapsed-groups`, `pi-dish-pinned-sessions`);
`renderSessions` bails while a drag is live so the 10s poll can't rebuild the
list mid-drag.
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

## Prompt composer (public/app.js)

- **Image attachments**: paste or 📎-pick images; `prepareImageAttachment()`
  downscales to a 1568px long edge / JPEG re-encode before base64ing (phone
  photos are huge). Images ride the `images` field on `/prompt` and `/steer`
  (pi ImageContent: `{type:'image', data, mimeType}`); the bridge extension
  builds a content array for `pi.sendUserMessage`. A prompt may be
  images-only (empty message allowed when images present, server + bridge
  both handle it). `express.json` limit is raised to 30mb for this. User
  messages render image blocks as thumbnails with a tap-to-zoom lightbox
  (`img.msg-image`, delegation on document).
- **Drafts**: the in-progress prompt persists per session
  (`pi-dish-draft-<id>` in localStorage, debounced from the input listener),
  restored by `restorePromptState()` on session select, cleared on send.
- **History**: sent prompts (incl. slash commands, steer, follow-up) append
  to `pi-dish-history-<id>` via `pushPromptHistory()` (helpers.js — trims,
  dedupes consecutive, caps at 50). ArrowUp with the caret at position 0
  walks back; ArrowDown at the end walks forward and finally restores the
  stashed draft. Typing exits browsing (`historyIndex = -1` on input).
- **Queue panel**: `queue_update` chips are buttons toggling `#queuePanel`,
  which lists queued steering/follow-up texts. View-only — pi has no API to
  cancel a queued message (upstream PR candidate).

## Message view (public/app.js)

- **Desktop reading column**: `.messages` and `.input-area` center content via
  `padding: 16px max(24px, calc((100% - var(--content-max)) / 2))` — don't put
  max-widths back on individual `.message` elements.
- **Tool-activity accordion**: `groupToolActivity()` folds each turn's indexed
  tool-only assistant messages + tool results into one closed
  `details.tool-group` ("⚡ N tool uses"). It's a DOM post-pass run after every
  JSONL render (full, incremental append, older-page prepend); it's idempotent
  and merges adjacent groups so pagination can't fragment a turn. Streaming
  elements (no `data-msg-index`) are never grouped; live tool panels are
  removed once the authoritative JSONL messages land
  (`removeDuplicatedLiveContent`). Gotchas: the older-messages scroll anchor
  must be a *top-level* child (elements inside a closed group have no box),
  and in-session search opens the enclosing group before scrolling to a match.
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
