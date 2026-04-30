# pi-dish

A minimal web interface for pi's sessions.

## Features

- **Session List**: View all active pi sessions in the sidebar
- **Session Status**: See if sessions are working (green pulse), current context usage %, model, and session name
- **Message View**: Browse full session history with formatted messages
- **Prompt Input**: Send prompts to sessions

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
- **Live streaming**: tool execution, message updates, turn lifecycle, and
  errors are forwarded over SSE from the bridge socket to the browser.
- **Spawning**: "New session" and "Resume" still spawn `pi --mode rpc`; those
  processes auto-load the bridge extension and register themselves the same
  way as sessions you start in tmux.
