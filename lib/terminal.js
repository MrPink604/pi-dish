/**
 * Server-side terminal support: one persistent PTY per pi session, shared by
 * every attached WebSocket client. Phones drop sockets constantly (screen
 * lock, app switch), so the PTY outlives its connections — output accumulates
 * in a ring buffer that is replayed on (re)attach, and the PTY is only killed
 * after sitting client-less for an idle window (or when the process exits).
 *
 * The whole feature is opt-in via PI_DISH_TERMINAL=1: a terminal endpoint is
 * a remote shell for anyone who can reach the server, which is a sharper tool
 * than the existing unauthenticated prompt API. See README security notes.
 *
 * node-pty is a native module; like fff, it must degrade gracefully — a
 * missing/unbuildable binary disables the feature instead of crashing the
 * server (isTerminalAvailable()).
 */
const os = require('os');
const fs = require('fs');

let pty = null;
let ptyLoadError = null;
try {
  pty = require('node-pty');
} catch (e) {
  ptyLoadError = e;
}

const RING_BUFFER_MAX = 200 * 1024; // chars of scrollback replayed on attach
const IDLE_KILL_MS = 15 * 60 * 1000; // kill a PTY this long after last detach

function isTerminalEnabled() {
  return process.env.PI_DISH_TERMINAL === '1' && isTerminalAvailable();
}

function isTerminalAvailable() {
  return !!pty;
}

function terminalUnavailableReason() {
  if (!pty) return `node-pty failed to load: ${ptyLoadError?.message}`;
  return null;
}

// sessionId -> { proc, buffer, clients:Set<ws>, idleTimer, cwd }
const terminals = new Map();

function defaultShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
  return process.env.SHELL || '/bin/bash';
}

/**
 * Get or create the PTY for a session. `cwd` is only used on creation; a
 * missing directory falls back to $HOME rather than failing (historical
 * sessions may point at deleted checkouts).
 */
function getOrCreateTerminal(sessionId, cwd, { idleKillMs = IDLE_KILL_MS, bufferMax = RING_BUFFER_MAX } = {}) {
  if (!pty) throw new Error(terminalUnavailableReason());
  let term = terminals.get(sessionId);
  if (term && !term.exited) return term;

  let dir = cwd;
  if (!dir || !fs.existsSync(dir)) dir = os.homedir();

  const proc = pty.spawn(defaultShell(), [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: dir,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

  term = {
    proc,
    cwd: dir,
    buffer: '',
    clients: new Set(),
    idleTimer: null,
    idleKillMs,
    bufferMax,
    exited: false,
  };
  terminals.set(sessionId, term);

  proc.onData((data) => {
    term.buffer += data;
    if (term.buffer.length > term.bufferMax) {
      term.buffer = term.buffer.slice(term.buffer.length - term.bufferMax);
    }
    broadcast(term, { type: 'output', data });
  });

  proc.onExit(({ exitCode }) => {
    term.exited = true;
    clearTimeout(term.idleTimer);
    broadcast(term, { type: 'exit', code: exitCode });
    for (const ws of term.clients) {
      try { ws.close(1000, 'shell exited'); } catch {}
    }
    term.clients.clear();
    // Only forget the session mapping if a newer terminal hasn't replaced it.
    if (terminals.get(sessionId) === term) terminals.delete(sessionId);
  });

  return term;
}

function broadcast(term, msg) {
  const payload = JSON.stringify(msg);
  for (const ws of term.clients) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(payload); } catch {}
    }
  }
}

/**
 * Attach a WebSocket client to a session's terminal. Sends the ring buffer
 * as an `attach` frame first (the client resets its emulator before writing
 * it), then live output. Client frames: {type:'input',data} and
 * {type:'resize',cols,rows}.
 */
function attachClient(sessionId, cwd, ws, opts) {
  const term = getOrCreateTerminal(sessionId, cwd, opts);
  clearTimeout(term.idleTimer);
  term.idleTimer = null;
  term.clients.add(ws);

  ws.send(JSON.stringify({ type: 'attach', replay: term.buffer, cwd: term.cwd }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (term.exited) return;
    if (msg.type === 'input' && typeof msg.data === 'string') {
      term.proc.write(msg.data);
    } else if (msg.type === 'resize') {
      const cols = Math.max(2, Math.min(500, msg.cols | 0));
      const rows = Math.max(2, Math.min(300, msg.rows | 0));
      try { term.proc.resize(cols, rows); } catch {}
    }
  });

  ws.on('close', () => detachClient(sessionId, ws));
  ws.on('error', () => detachClient(sessionId, ws));
  return term;
}

function detachClient(sessionId, ws) {
  const term = terminals.get(sessionId);
  if (!term) return;
  term.clients.delete(ws);
  if (term.clients.size === 0 && !term.exited && !term.idleTimer) {
    term.idleTimer = setTimeout(() => killTerminal(sessionId), term.idleKillMs);
    // Don't let a lingering idle timer hold the process open on shutdown.
    if (term.idleTimer.unref) term.idleTimer.unref();
  }
}

function killTerminal(sessionId) {
  const term = terminals.get(sessionId);
  if (!term) return;
  clearTimeout(term.idleTimer);
  terminals.delete(sessionId);
  term.exited = true;
  try { term.proc.kill(); } catch {}
  for (const ws of term.clients) {
    try { ws.close(1000, 'terminal closed'); } catch {}
  }
  term.clients.clear();
}

function killAllTerminals() {
  for (const id of [...terminals.keys()]) killTerminal(id);
}

module.exports = {
  isTerminalEnabled,
  isTerminalAvailable,
  terminalUnavailableReason,
  getOrCreateTerminal,
  attachClient,
  detachClient,
  killTerminal,
  killAllTerminals,
  _terminals: terminals,
};
