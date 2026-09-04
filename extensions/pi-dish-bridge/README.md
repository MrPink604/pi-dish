# Making your pi extension's UI show up in pi-dish

## Loading a wrapper

Load exactly one wrapper in the host's extension configuration:

* Pi: `--extension /path/to/pi-dish/extensions/pi-dish-bridge/index.ts`
* OMP: `--extension /path/to/pi-dish/extensions/pi-dish-bridge-omp/index.ts`
* Prime: `--extension /path/to/pi-dish/extensions/pi-dish-bridge-prime/index.ts`

The OMP and Prime wrappers use only the public extension API and require no
pi-dish RPC process. They intentionally do not expose queue inspection or
queue cancellation. Pi retains its private, feature-detected queue integration.

For a managed OMP/Prime launch, pi-dish generates a tiny per-launch module in
`~/.pi/dish/launch-wrappers/`. It imports the wrapper above and embeds the
correlation token instead of relying on inherited environment variables. The
file is retained because Prime's resident worker can reload or recover the
extension after its original tmux client is gone.

The bridge forwards a *subset* of pi's `ctx.ui` surface to web clients. The
TUI renders everything either way, so an incompatible call is **silently
invisible** in pi-dish — nothing errors. This page is the contract; write to
it and your UI appears in the web/phone client with zero extra work.

## Socket directory

The bridge normally creates its hashed control sockets under
`~/.pi/dish/sockets/`. It rejects any full UTF-8 socket path longer than 103
bytes before binding or writing a session registry entry. On systems with a
long home path, set `PI_DISH_SOCKET_DIR` to a short absolute directory in the
environment of every `pi` process, for example
`/run/user/$(id -u)/pi-dish`. There is deliberately no automatic `/tmp` or
XDG fallback. The override directory is created with mode `0700`, and an
override that is still too long is rejected with the same startup error. An
existing directory must be owned by the current user with mode `0700`; the
bridge validates it without changing its permissions. The bridge-owned default
`~/.pi/dish/sockets/` is different: if an older release created it as `0755`,
the bridge automatically tightens that owned directory to `0700`.

## Recovery observations

The bridge also maintains private, durable lifecycle observations under
`~/.pi/dish/recovery/observations/`, independently of server availability.
These are separate from the disposable live registry. Stream deltas do not
write checkpoints; persisted message/run boundaries do. Pi's `agent_settled`
is the whole-run completion boundary, not individual `turn_end` events.
Unverifiable completion, compaction and generic shutdown retain uncertainty.

The server owns recovery policy, exclusions and delivery attempts in separate
control files. Loading a session alone preserves its previous observation so
restoration cannot erase evidence of interrupted work. A new run or shutdown
updates it. RPC fallback yields observation ownership to a recording bridge;
parent-owned OMP subagents never become independent recovery candidates.
See [Session recovery](../../README.md#session-recovery) for configuration and
the manual-review boundaries. Recovery does not configure host autostart.

## What crosses the bridge

| Call | Web rendering | Notes |
|------|---------------|-------|
| `ctx.ui.setWidget(key, lines, opts?)` | collapsible card directly above the prompt composer | **`lines` must be `string[]`** (or `undefined`/`[]` to clear). All placements render in the same spot except `belowEditor` (below the composer). |
| `ctx.ui.setStatus(key, text)` | small monospace chip in the session header | empty/undefined `text` clears it |
| `ctx.ui.notify(message, type?)` | toast (top of screen) | `info` auto-dismisses; `warning`/`error` stay |
| `ctx.ui.setTitle(title)` | browser tab title | |
| `ctx.ui.setEditorText(text)` / `pasteToEditor(text)` | fills the web composer | |
| `ctx.ui.select/confirm/input/editor(...)` | real web modal, raced against the TUI dialog | first answer (terminal or browser) wins; the loser's is discarded |
| a **tool named `set_mood`** | mood indicator above the composer | recognized arg shapes: `{description, kaomoji}` or `{mood, label?}`; a reference implementation ships at [`extensions/mood.ts`](../mood.ts) |

## What does NOT cross (TUI-only)

- **Component-factory widgets** — `setWidget(key, (tui) => Component)`. The
  bridge forwards only line arrays; a factory renders fine in the terminal
  and never reaches the web. This is the #1 silent failure: if your widget
  shows in the TUI but not in pi-dish, check this first. Render your state
  to `string[]` yourself and pass that.
- `ctx.ui.custom()` (interactive components, custom editors)
- `ctx.ui.setFooter()` / `setHeader()` — use `setStatus` for a compact
  always-visible signal, or a `set_mood` tool for mood-style footers.
- Overlays, `setEditorComponent()`, `setWorkingIndicator()`,
  `setWorkingMessage()`, `setToolsExpanded()`
- Tool renderers (`renderCall`/`renderResult`) and
  `registerMessageRenderer` — the web client uses its own built-in
  renderers for messages and tool output.

## Rules that keep you compatible

1. **Call through `ctx.ui` by property access, every time**
   (`ctx.ui.setWidget(...)`). The bridge works by wrapping the methods on the
   shared ui object at load time; a function reference you captured earlier
   (`const sw = ctx.ui.setWidget`, destructuring, `.bind`) can point at the
   unwrapped original and bypass the bridge while the TUI keeps working.
   Holding on to `ctx` itself is fine.
2. **Re-emitting unchanged content is safe and encouraged.** The bridge
   dedupes identical `setWidget`/`setStatus` re-emissions and replays current
   state to late-joining clients, so a 1-second render tick costs nothing on
   the wire and keeps freshly opened browsers current. The pi-dish server
   additionally remembers each session's widgets/statuses/pending dialogs
   (`trackExtUIState` in server.js) and replays them to every new SSE
   connection — switching sessions in the web UI restores this session's
   elements without the bridge re-emitting.
3. **ANSI styling is stripped for the web.** `theme.fg(...)` output renders
   as plain text in pi-dish — fine to use for the TUI, but don't let color
   be the only carrier of meaning.
4. **Widgets are keyed.** One card per `key`, updated in place; collapse
   state survives updates. Clear with `setWidget(key, [])` or `undefined`.

## One bridge install only

Two copies of this extension in one pi process race to bind the session's
Unix socket, and the loser's protocol wins or loses nondeterministically —
the classic symptom is a socket that answers `hello` but never emits
`extension_ui_request`. Current bridges guard against this (duplicate loads
stay inactive; a socket stolen by an older guardless copy is detected and
reclaimed on the next agent event or widget emission, with a warning on
stderr), but the fix is to remove the duplicate: keep a single install,
ideally a symlink into the pi-dish checkout so it can't go stale.

## `/dish-push` — force a UI re-broadcast

If a web client looks stale, `/dish-push` (works in the TUI and in the
pi-dish composer) re-checks socket ownership and re-broadcasts the current
widget/status/title state to connected clients, bypassing the
unchanged-content dedup. It reports how many widgets/statuses went to how
many clients — a count of 0 widgets on a session whose TUI shows one means
the emissions never reached the bridge (see the compatibility rules above).
