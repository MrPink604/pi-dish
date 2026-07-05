# pi-dish

A minimal web interface for pi's sessions.

## Features

- **Session List**: View all active pi sessions in the sidebar
- **Session Status**: See if sessions are working (green pulse), current context usage %, model, and session name — context numbers come straight from the running session (`ctx.getContextUsage()`), so 1M-context models report correctly
- **Message View**: Browse full session history with formatted messages; streaming only auto-scrolls while you're at the bottom (scroll up to read, hit ↓ to jump back)
- **Prompt Input**: Send prompts to sessions
- **Slash Commands**: `/`-prefixed input is routed to a command endpoint, never to the model as text
- **Extension UI**: dialogs (`select`/`confirm`/`input`/`editor`) render as real modals you can answer from the browser; widgets, statuses, and notifications render natively
- **Thinking Level**: 🧠 badge next to the model selector (a panel row on mobile) switches thinking/effort (off → xhigh); pi clamps to what the model supports
- **Steer & Follow-up**: while the agent is working, send steering messages (delivered mid-run) or queue follow-ups (delivered after it finishes); pending queues show as chips above the input on pi-dish-spawned sessions (pi doesn't expose queue events to extensions, so TUI sessions can't show them)
- **Session Stats**: tap the context % badge (Context / stats row on mobile) for tokens in/out, cache usage, cost, message counts, cwd, and session file
- **Export**: download any session (active or not) as standalone HTML, using pi's own exporter
- **Focus Mode**: toggle that hides tool calls/results so you can read just the user/assistant conversation (persisted per browser)
- **Session Tree**: header button opens the tree to branch from any point; full-screen with touch-sized rows on phones
- **Copy**: per-message button copies an assistant reply's text (always visible on touch devices)
- **Mobile Control Panel**: on phones the header badges collapse into a single ⚙ button next to Send, which opens a slide-up panel with model, thinking level, context/stats, focus mode, session tree, and HTML export; the input row itself only shows status text (truncated, never pushing buttons) and a working spinner

## Slash command support

| Command type | TUI session (bridge) | pi-dish-spawned session (RPC) |
|---|---|---|
| `/compact`, `/model`, `/name`, `/thinking`, `/abort` | ✅ emulated via extension API | ✅ mapped to RPC commands |
| `/new`, `/export` | ❌ (needs command context) | ✅ |
| Skills (`/skill:x`) and prompt templates | ✅ expanded by the bridge, sent as user message | ✅ native via RPC `prompt` |
| Extension commands (`/mood`, `/todos`, …) | ❌ pi's extension API cannot invoke another extension's command — run them in the TUI | ✅ native via RPC `prompt` |
| Other TUI built-ins (`/settings`, `/tree`*, `/resume`, …) | ❌ TUI-only | ❌ (`/tree` has a web modal) |

Unknown/unsupported commands return a clear error instead of being sent to the model.

**Dialog caveat**: when a TUI session's dialog is answered from the web, the
terminal keeps showing the (already-resolved) dialog until you press Escape —
pi has no API to dismiss it programmatically. The late TUI answer is discarded.

## Setup

pi-dish discovers running pi sessions through a small extension that registers
each session and exposes a control socket. Install it once into your global
pi extensions dir:

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/extensions/pi-dish-bridge" ~/.pi/agent/extensions/pi-dish-bridge
```

After symlinking, any `pi` you launch (TUI in tmux, headless via pi-dish, etc.)
will register itself at `~/.pi/dish/sessions/<id>.json` and open a Unix socket
at `~/.pi/dish/sockets/<id>.sock`. pi-dish reads the registry to list active
sessions and opens the socket on demand to stream events / send prompts —
sessions you aren't viewing cost nothing.

Reload existing pi sessions with `/reload` to pick up the extension.

### Upgrading

After pulling changes, run `npm install` (the SDK dependency is
`@earendil-works/pi-coding-agent`, pi's current package name), restart the
server, and `/reload` each running pi session so it picks up the new bridge.

## Running

### Web (browser)

```bash
cd ~/workspace/pi-dish
npm install
npm start
```

Then open http://localhost:3333 in your browser.

### Desktop (Electron)

```bash
npm run electron:dev
```

This starts the Express server and opens the app in a native window.

### Build distributable

```bash
npm run electron:build
```

Output goes to `dist/` (AppImage + deb on Linux, dmg on macOS).

## How It Works

- **Active sessions**: discovered via the `pi-dish-bridge` extension's registry
  files in `~/.pi/dish/sessions/`. The web server connects to each session's
  Unix socket only when a client opens it — listing the sidebar costs nothing
  beyond reading registry files.
- **Inactive sessions**: scanned from `~/.pi/agent/sessions/` (pi's own JSONL
  store) for the "previous sessions" list and full message history.
- **Live streaming**: tool execution, message updates, turn lifecycle,
  compaction/retry status, extension UI, and errors are forwarded over SSE
  from the bridge socket to the browser.
- **Slash commands**: the frontend posts `/`-prefixed input to
  `/api/sessions/:id/command`. Bridge sessions emulate built-ins through the
  extension API and expand skills/prompt templates; RPC sessions use the
  native RPC commands. See the support matrix above.
- **Context usage**: the bridge writes `ctx.getContextUsage()` (tokens,
  window, percent) into its registry entry on every turn/message/model
  change, so the UI never guesses window sizes from model listings.
- **Session ids**: the session-file basename (newer pi prefixes a timestamp
  to the UUID). The bridge registry and RPC client use the same convention so
  a session never appears twice.
- **Spawning**: "New session" and "Resume" still spawn `pi --mode rpc`; those
  processes auto-load the bridge extension and register themselves the same
  way as sessions you start in tmux. Set `PI_DISH_PI_COMMAND` to customize the
  launch command (e.g. `"pi-aws --profile work"`).
