# Making your pi extension's UI show up in pi-dish

The bridge forwards a *subset* of pi's `ctx.ui` surface to web clients. The
TUI renders everything either way, so an incompatible call is **silently
invisible** in pi-dish — nothing errors. This page is the contract; write to
it and your UI appears in the web/phone client with zero extra work.

## What crosses the bridge

| Call | Web rendering | Notes |
|------|---------------|-------|
| `ctx.ui.setWidget(key, lines, opts?)` | collapsible card directly above the prompt composer | **`lines` must be `string[]`** (or `undefined`/`[]` to clear). All placements render in the same spot except `belowEditor` (below the composer). |
| `ctx.ui.setStatus(key, text)` | small monospace chip in the session header | empty/undefined `text` clears it |
| `ctx.ui.notify(message, type?)` | toast (top of screen) | `info` auto-dismisses; `warning`/`error` stay |
| `ctx.ui.setTitle(title)` | browser tab title | |
| `ctx.ui.setEditorText(text)` / `pasteToEditor(text)` | fills the web composer | |
| `ctx.ui.select/confirm/input/editor(...)` | real web modal, raced against the TUI dialog | first answer (terminal or browser) wins; the loser's is discarded |
| a **tool named `set_mood`** | mood indicator above the composer | recognized arg shapes: `{description, kaomoji}` or `{mood, label?}` |

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
   the wire and keeps freshly opened browsers current.
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
reclaimed on the next agent event, with a warning on stderr), but the fix is
to remove the duplicate: keep a single install, ideally a symlink into the
pi-dish checkout so it can't go stale.
