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
module: `getSessionInfo` (single-file list metadata), `readSessionMessages`
(the paginated message stream), `getSessionStats` (token/cost aggregates for
`/stats`), and `readSessionCwd` (bounded first-line read — never load a whole
file just for its header). The readers share one `statCached` implementation
keyed on (mtimeMs, size). These in-memory LRUs are sized for the *viewed*
sessions only — anything that iterates the whole corpus (the sidebar scan,
list search) must go through `lib/session-index.js` instead, or thousands of
sessions turn a capped LRU into a 0%-hit-rate full re-parse per request. The
content-based cores (`parseSessionContent`, `buildSearchTextFromContent`) are
exported so the index derives both from one read. `getSessionInfo` returns a
copy (callers overlay live usage onto it); the other readers return the
cached value itself — never mutate it. Context window/percent are derived in
server.js (`withContext`) at read time, not inside the cache — the models
cache warms asynchronously and would bake in stale windows.

## Session index (lib/session-index.js)

Persistent (mtimeMs, size)-keyed index of list metadata + lowercased search
text for **every** session JSONL, backing the historical scan
(`getPreviousSessions`) and list search — built because the user's work
machine has thousands of sessions (GBs of JSONL), where per-request re-parsing
means multi-second event-loop stalls per sidebar poll/search keystroke.
Storage is `~/.pi/dish/session-index/{meta,text}.ndjson`: append-only NDJSON
(later lines win, `del:1` tombstones, torn tails skipped on load), buffered
appends (~500ms, unref'd timer), compacted temp-file+rename when dead bytes
exceed live. Deliberately no node:sqlite / native modules — must run on a
hand-built Node 22 on old glibc (see work-machine memory). `scanSessions`
re-indexes at most `PI_DISH_INDEX_SYNC_BUDGET` (default 20) stale files
synchronously and drains the rest via a setImmediate builder, reporting
`indexing: true` while the served list is partial (`/api/sessions` forwards
the flag; the client shows "Indexing sessions…" and re-polls at 1s until it
settles). `getSearchText` extends a grown file's text from the appended byte
range only (in memory, not logged — streaming sessions churn too fast to
persist per delta), so searching while a turn streams never re-reads a
multi-MB file. Search results matched on content (not name/cwd/model/id)
carry a `searchSnippet` (`buildSnippet`/`highlightTokens` in helpers.js) so
the client can show *why* a row matched. Tests prove persistence structurally:
scans with `PI_DISH_INDEX_SYNC_BUDGET=0` can't parse, so whatever they serve
came from disk.

Server-side session dispatch: `getLiveSession(id)` in server.js is the one
place bridge-vs-RPC resolution lives (bridge registry entry → connected
BridgeSession, else alive RPCSession, else null). Don't re-roll the
`getRegisteredSession ? getBridgeSession : getRPCSession` dance in routes;
branch on `instanceof BridgeSession` only for genuinely backend-specific
calls (setModel arg shapes, runCommand vs the RPC slash emulation).

## tmux spawning (lib/tmux.js)

`POST /api/sessions/new` and `/resume` default to a `pi --mode rpc` child of
the server (dies on restart). An optional `target: { type:'tmux', socket,
tmuxSession }` (or `{ ..., newTmuxSession }`) instead opens a real pi **TUI** as
a tmux window — no `--mode rpc` — that survives restarts; the pi-dish-bridge
extension registers it and pi-dish drives it over the normal BridgeSession
path. `lib/tmux.js` wraps tmux via execFile (argv arrays, short timeouts, never
a shell string): `listServers()` scans sockets under `$TMUX_TMPDIR ||
/tmp/tmux-$UID/` (`:` field separator in `-F`, since tmux sanitizes a tab to
`_` and forbids `:` in session names), `spawnInTmux()` new-window/new-session
with `-e KEY=VALUE` env and `-P -F '#{pane_id}'`, plus `sendKeys`/`paneExists`.

Correlation: the server generates a token, passes `PI_DISH_SPAWN_TOKEN` into
the spawned pi's env (via tmux `-e`), and the bridge stamps it as `spawnToken`
on its registry entry. `spawnPiInTmux` (server.js) builds the child from
`getPiLaunchSpec()` (exported from rpc-session.js — same wrapper/alias env as
RPC), then polls `REGISTRY_DIR` directly for the entry carrying the token (up
to 30s, `PI_DISH_SPAWN_TIMEOUT_MS` override for tests). On timeout the window is
left open (don't kill it) and the error hints the bridge must be installed.

`isSocketAllowed()` rejects any socket not directly under the tmux tmpdir (the
same directory `listServers()` enumerates) — the server can be on 0.0.0.0, so
an arbitrary `-S` path from the LAN must not get through. Placements persist in
`~/.pi/dish/tmux-spawns.json` (`{ [sessionId]: { socket, paneId, createdAt } }`,
temp-file+rename, HOME per call like shares.js). After registration the server
records the placement and send-keys `/dish-prime` to prime the command context;
the `/branch` route's "no command context" handling adds a middle path between
RPC-prime and the 409: if the session has a live spawn pane, send-keys
`/dish-prime`, wait ~1.5s, retry. `pruneSpawns()` drops entries whose pane is
gone and session isn't registered (called opportunistically from `GET
/api/tmux/targets`). Client: the "Run in" `<select>` in the sidebar footer
(hidden when `/api/config` reports `tmux:false`) lists headless + one option per
tmux session + a "new session…" per server (reveals a name input); the choice
persists in `localStorage['pi-dish-spawn-target']` and is reused for resume when
still valid.

## Share links (lib/shares.js, /share/:token)

Public read-only session traces. `lib/shares.js` persists
`{ token: { sessionId, createdAt } }` in `~/.pi/dish/shares.json` (base64url
tokens, temp-file + rename write, HOME resolved per call so tests' temp HOME
works). Authed management API on the main app: `POST/GET/DELETE
/api/sessions/:id/share` (POST is idempotent per session; GET 404s when none).
Public `GET /share/:token` → `piSDK.exportSessionHtml` served **inline**
(not a download); one shared handler (`serveSharedSession`), export cached per
token on the JSONL's (mtimeMs, size). An unknown token is a bare 404 — never
reveal whether a session exists. The route is always on the main app;
`PI_DISH_SHARE_PORT` additionally mounts a second app that serves *only*
`/share/:token` (host `PI_DISH_SHARE_HOST`, else the main HOST default), closed
with the main server. `PI_DISH_SHARE_BASE_URL` (trailing slash trimmed) makes
the API return an absolute `url`; else `url` is null and the client builds it
from `location.origin`. UI is a section in the stats modal (create / copy /
revoke; copy goes through `copyTextToClipboard`).

## File / directory fuzzy search (lib/file-search.js)

Backed by fff (`@ff-labs/fff-node`, ESM-only + native binary, loaded via
lazy dynamic import): one indexed `FileFinder` per project cwd (LRU pool of
4) powers `GET /api/sessions/:id/files?q=` for @-mentions in the prompt.
fff refuses to index `$HOME`, so `GET /api/dirs?q=` (the new-session cwd
picker) uses a cached depth-4 directory walk plus the shared fuzzy scorer
from `public/helpers.js` instead. Everything degrades to the walker when
fff is unavailable — never let a missing native binary break the UI.

Tokens that name a location (`/abs`, `~/x`, `./x`, `../x` — relative forms
resolve against the session cwd) skip fff entirely: `completePath()` does
shell-style completion (readdir the parent, fuzzy-match the partial
basename, dotfiles only when the partial starts with `.`), so @-mentions
reach anywhere on the filesystem without pretending it's indexable.
Suggestions keep the typed form (`~/` stays `~`-relative).

Client side: `@token` at the caret opens the file autocomplete (accept
inserts `@relative/path`; accepting a directory appends `/` and re-fires
the completion to drill deeper); the cwd input merges known session cwds
(starred, score-boosted) with live `/api/dirs` results.

## Client session state (public/app.js)

`sessions` (sidebar lists) and `currentSession` (a **detached copy** of the
selected entry) are written only by the four functions in the "Session state
writes" section: `setSessionLists` (poll/search results; folds the fresh
entry into `currentSession`), `setCurrentSession` (selection),
`patchSession` (local mutations — rename, model switch, thinking level), and
`mergeCurrentSession` (the `session` payload on /messages responses —
current-session/header only, never the lists, whose name/model come from the
registry-aware poll). Each write re-renders the views it affects, so a
mutation can't leave sidebar and header disagreeing (the old "rename needs
F5" bug class). Never assign to `sessions`/`currentSession` elsewhere.

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

Steering/follow-up queue (`queue_update`): pi does **not** route this event
through the extension runner (verified pi 0.80.3), so the bridge can't observe
it via `pi.on`. Instead the bridge patches `AgentSession.prototype`
(`subscribe`/`prompt`, guarded by a `Symbol.for` flag) to stash the live
instance into a global holder — global, not module-local, because pi's
`/reload` re-evaluates the extension but keeps the same AgentSession. From
there it `subscribe()`s for `queue_update` and broadcasts a merged queue (pi's
steering + follow-up arrays, plus any messages held during compaction). `POST
/api/sessions/:id/queue/cancel` (bridge `cancel_queued`) removes a
not-yet-delivered message by splicing pi's private `_steeringMessages` /
`_followUpMessages` **and** the agent-core `steeringQueue`/`followUpQueue`
arrays, then calling `_emitQueueUpdate()`. All of this is feature-detected and
version-sensitive: a patch/shape mismatch disables queue editing (clear error)
rather than breaking the bridge. The server replays `sess.queueState` (from the
bridge hello / last `queue_update`) into every new SSE connection, and forwards
delivered `role:'user'` `message_end`s mid-turn so a steer shows in the
transcript before the `turn_end` JSONL catch-up.

Scroll pinning: streaming only follows while the viewport is near the bottom
(`isPinnedToBottom`, 80px threshold). Sending a prompt or hitting
jump-to-bottom sets `followStream`, which forces following regardless of
scroll position — needed on mobile, where the keyboard resizing the container
silently un-pins. Only a deliberate gesture (wheel/touchmove/mousedown on the
feed) clears it; programmatic or layout-driven scroll shifts must not.

## Tests (test/)

`npm test` runs the node:test suites (`test/*.test.js`):
- `test/server.test.js` — boots `server.js` with `HOME` pointed at a temp dir
  containing a fixture JSONL and exercises session listing, message
  pagination (`limit`/`before`/`after`), `/search`, `/stats`, request
  validation, cache revalidation after JSONL appends, share links, and SSE
  extension-UI replay (fake bridge socket).
- `test/rpc-session.test.js` — the headless RPC backend end to end:
  `PI_DISH_PI_COMMAND` points at `test/fixtures/fake-rpc-pi.js`, which speaks
  pi's real `--mode rpc` stdio protocol and logs every command it receives,
  so tests assert both HTTP outcomes and what pi was asked (spawn/resume,
  prompt→SSE→JSONL round-trip, mid-turn auto-steer, abort via `agent_end`,
  slash-command emulation, dead-child pruning). Teardown must kill spawned
  RPC children or the test process never exits.
- `test/tmux.test.js` — real tmux on a throwaway socket; `fake-pi.js`
  performs the registry handshake. `test/terminal.test.js` — real PTY + WS.
  `test/bridge-session.test.js` — socket protocol guards.
- `test/pi-bridge.integration.test.js` — **the pi-upgrade canary**: spawns the
  real `pi` binary (skip-if-absent) with the real `extensions/pi-dish-bridge`
  in a temp HOME whose `models.json` routes `fakeprov/fake-model` to an
  in-test fake Anthropic `/v1/messages` SSE server (a HOLD marker in the
  prompt pins a turn open). Covers the seams every other suite fakes: bridge
  registration, a real agent turn end to end, `queue_update` via the
  AgentSession prototype capture, `cancel_queued`'s private-array splice, and
  `navigate_tree` after priming a command context (`/dish-prime` over the pi
  child's own RPC stdin). **Run this after bumping pi** — a green run means
  the version-sensitive bridge internals still hold.
- `test/helpers.test.js` — unit tests for `public/helpers.js`, the pure
  frontend helpers (escaping, formatting, filtering, fuzzy match, mood).
  Helpers are plain script globals in the browser and CommonJS exports in
  node; anything DOM-free that app.js needs belongs there, with a test.
- `test/session-files.test.js` — unit tests for the JSONL parsers and their
  mtime/size caches in `lib/session-files.js`.
- `test/file-mention.test.js` — unit tests for `lib/file-mention.js`
  (mention → path resolution through tool calls, containment, viewer reads).

Shared test helpers that aren't suites (e.g. `test/sse-reader.js`) live
outside the `*.test.js` glob.

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

## Terminal (lib/terminal.js, PI_DISH_TERMINAL=1)

Opt-in feature (flag + node-pty must load — degrade gracefully like fff,
never let the native module break the server). One persistent PTY per pi
session, spawned at the session cwd, shared by all WebSocket clients on
`/api/sessions/:id/terminal` (upgrade handler registered only when enabled;
`GET /api/config` tells the client). The PTY outlives sockets on purpose —
phones drop the connection on every screen lock — with a ~200KB ring buffer
replayed in the `attach` frame (client resets the emulator before writing
it) and a 15-min idle kill that needs *both* no clients and no output for
the full window (a detached shell still printing is a running build — the
timer re-arms for the remaining silence). A `restart` WS frame kills and
respawns the shell carrying attached sockets over (⟳ in the panel header;
frame handlers look the terminal up per message, never close over it, so
input follows the new PTY). Client side:
xterm.js + fit addon (vendored, UMD globals), theme built from the `:root`
tokens in `terminalTheme()`, mobile extra-keys bar with a ctrl latch that
rewrites the next key in `term.onData`. The panel's top edge is a drag
handle (`initTerminalResize`; pointer capture, so no document listeners;
`touch-action: none` or mobile browsers claim the gesture for scrolling) —
the height persists as a % of the session view in
`localStorage['pi-dish-terminal-size']`, applied as inline `flex-basis` in
`openTerminal()` over the 45%/52% stylesheet defaults.
`vendor/nerd-symbols.woff2` (+
LICENSE) is committed directly, not generated by build-vendor: a
symbols-only Nerd Font appended to xterm's fontFamily so p10k/lsd prompt
glyphs don't render as tofu on phones; `openTerminal()` preloads it via
`document.fonts.load` before first paint, and it's deliberately not in
`--font-mono` (only the terminal justifies the 1.2MB download). Keys typed in the panel must not
trigger app-level shortcuts — the document keydown handlers bail on targets
inside `.terminal-panel`. Test gotcha: a configless `$HOME` makes zsh run
`zsh-newuser-install` inside the PTY, which eats the first line of input —
fixtures write an empty `.zshrc`; test markers use arithmetic
(`$((40+2))`) so the echoed input can't satisfy output assertions.

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
(`/api/sessions?q=` — matches metadata and message content via the session
index; content matches render their `searchSnippet` under the row with the
tokens marked); filtering in Active mode is local and metadata-only. The
filter row shows a spinner from first keystroke until results land
(`setSearchBusy`), and `loadSessions` carries a sequence guard so a slow
stale response can't clobber a newer one.

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
- **Queue strip**: `renderQueueStatus(data)` renders `queue_update` into
  `#queuePanel` as an always-visible-when-non-empty strip above the composer —
  one row per pending steering/follow-up message (including ones typed in the
  TUI), each ellipsized (click to expand) with an `↩ Edit` button.
  `editQueuedMessage()` POSTs `/api/sessions/:id/queue/cancel` (kind + array
  index + text) to pull the message out of pi's queue and back into the
  composer (appended with a blank line if the composer already holds different
  text); the follow-up `queue_update` reconciles the strip. See the queue
  paragraph under the streaming pipeline for the bridge-side mechanics.

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
- **Clickable file mentions / viewer** (`lib/file-mention.js`, `GET
  /api/sessions/:id/file?path=`): agents write findings.md deep in the tree
  and refer to it by bare filename — `linkifyFilePaths()` (runs inside
  `applyHighlight`) marks path-looking inline code, tool-call summaries, and
  plain-prose tokens (`looksLikeFilePath`/`findPathTokens` in helpers.js) as
  `.file-link`; a delegated click opens `#fileModal` (markdown rendered, code
  highlighted, images inline, copy button; the viewer body goes through
  `applyHighlight` too, so a markdown file's own mentions are clickable in
  turn). The server resolves the mention against the session: qualified
  mentions prefer the exact cwd-relative file, bare basenames prefer the
  paths mined from the session's tool calls (read/write/edit `path`/`cwd`
  args + absolute tokens in bash commands — most recent reference wins), then
  fff fuzzy search under the cwd. Reads are gated to the cwd subtree +
  tool-touched paths (lexical containment — `..` normalizes away before the
  check; a LAN client must not read arbitrary files).
- **In-session search**: 🔍 header button / Ctrl+F. `GET
  /api/sessions/:id/search?q=` returns `{ matches: [{index, role}] }` over the
  whole session; the client walks matches (Enter = backwards, Shift+Enter =
  forwards), auto-paging older messages in via `loadOlderMessages()` until the
  match index is in the DOM, then marks hits (`mark.search-mark`) and outlines
  the message (`.search-current`). In focus mode, `toolResult` matches are
  skipped.

## Tree navigation / branch summaries (tree modal, POST /branch)

`POST /api/sessions/:id/branch` drives pi's `/tree` remotely: move the leaf
to `entryId`, optionally (`summarize: true`) generating an LLM summary of the
abandoned branch that pi injects as context at the return point. Selecting a
user message means *re-edit*: the leaf moves to its parent and the message
text comes back as `editorText`, which the client stows in the per-session
draft (the composer is hidden on inactive sessions; the draft surfaces on
select/resume). Two backends:

- **Live sessions** must navigate *inside* the pi process (an external
  SessionManager write diverges from the agent's in-memory messages): bridge
  `navigate_tree` → `ctx.navigateTree`. Gotcha: only pi **command contexts**
  carry session-control methods, and events get plain contexts — so the
  bridge stashes the ctx from every `/dish-*` command it executes
  (`commandCtx` in the bridge; contexts stay valid until reload/session
  switch). RPC-backed sessions are primed automatically: the server sends
  `/dish-prime` through `rpc.prompt()` (pi's command executor) on the first
  "no command context" error and retries. TUI-only sessions have no remote
  path to a command context — the route 409s with a "run /dish-push once in
  the TUI" hint.
- **Inactive sessions** go through the SDK (`branchSession` in pi-sdk.js).
  The summary bills to the session's own model (last `model_change`, else
  the last assistant message's provider/model) with auth from
  `ModelRegistry.getApiKeyAndHeaders`. Persistence gotcha: `sm.branch()`
  only moves an in-memory pointer and a reopened JSONL re-derives its leaf
  from the *last entry* — `branchWithSummary` persists by appending, and the
  summary-less path appends a no-op `label` entry purely to anchor the leaf
  (the pre-2026-07 `/branch` endpoint persisted nothing, silently).

`branch_summary` entries render in the feed as collapsed
`.message.branch-summary` blocks (`role: 'branchSummary'` from
`parseMessages`) and stay visible in focus mode — they're conversation
context, not tool noise.
