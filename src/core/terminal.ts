/**
 * One persistent PTY per session, shared by attached WebSocket clients. Phone
 * disconnects leave bounded replay behind; idle cleanup requires both no clients
 * and no output. A missing native node-pty binary disables the opt-in feature.
 */
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { IPty } from 'node-pty';
import type * as NodePty from 'node-pty';
import type WebSocket from 'ws';
import { record } from './helper-values';

let pty: typeof NodePty | null = null;
let ptyLoadError: unknown = null;
try {
  pty = require('node-pty') as typeof NodePty;
} catch (error) {
  ptyLoadError = error;
}

const RING_BUFFER_MAX = 200 * 1024;
const IDLE_KILL_MS = 15 * 60 * 1000;

export interface TerminalMetadata extends Record<string, unknown> {
  tmuxPrefix?: string | null;
}

export interface TerminalOptions {
  idleKillMs?: number;
  bufferMax?: number;
  command?: string[] | null;
  env?: NodeJS.ProcessEnv | null;
  meta?: TerminalMetadata | null;
}

export interface TerminalAttachFrame extends Record<string, unknown> {
  type: 'attach';
  replay: string;
  cwd: string;
  tmuxPrefix?: string | null;
}

export interface TerminalOutputFrame {
  type: 'output';
  data: string;
}

export interface TerminalExitFrame {
  type: 'exit';
  code: number;
}

export interface TerminalErrorFrame {
  type: 'error';
  error: unknown;
}

export type TerminalServerFrame = TerminalAttachFrame | TerminalOutputFrame | TerminalExitFrame | TerminalErrorFrame;

export type TerminalClientFrame =
  | { type: 'input'; data: unknown }
  | { type: 'resize'; cols?: unknown; rows?: unknown }
  | { type: 'restart' };

export interface TerminalState {
  proc: IPty;
  cwd: string;
  buffer: string;
  clients: Set<WebSocket>;
  idleTimer: NodeJS.Timeout | null;
  idleKillMs: number;
  bufferMax: number;
  meta: TerminalMetadata | null;
  lastOutputAt: number;
  exited: boolean;
}

const terminals = new Map<string, TerminalState>();
export { terminals as _terminals };

export function isTerminalEnabled(): boolean {
  return process.env.PI_DISH_TERMINAL === '1' && isTerminalAvailable();
}

export function isTerminalAvailable(): boolean {
  return !!pty;
}

export function terminalUnavailableReason(): string | null {
  if (!pty) return `node-pty failed to load: ${record(ptyLoadError) ? ptyLoadError.message : undefined}`;
  return null;
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
  return process.env.SHELL || '/bin/bash';
}

/**
 * Cwd only applies on creation; missing directories fall back to HOME. Command
 * argv replaces the default shell, undefined environment overlays delete keys,
 * and metadata rides on each attach frame (including restarted terminals).
 */
export function getOrCreateTerminal(
  sessionId: string,
  cwd: string | null | undefined,
  { idleKillMs = IDLE_KILL_MS, bufferMax = RING_BUFFER_MAX, command = null, env = null, meta = null }: TerminalOptions = {},
): TerminalState {
  if (!pty) throw new Error(terminalUnavailableReason() ?? undefined);
  const existing = terminals.get(sessionId);
  if (existing && !existing.exited) return existing;

  let dir = cwd;
  if (!dir || !fs.existsSync(dir)) dir = os.homedir();

  const procEnv: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...(env || {}) };
  for (const [key, value] of Object.entries(procEnv)) {
    if (value === undefined) delete procEnv[key];
  }
  const argv = Array.isArray(command) && command.length ? command : [defaultShell()];
  const proc = pty.spawn(argv[0], argv.slice(1), {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: dir,
    env: procEnv,
  });

  const term: TerminalState = {
    proc,
    cwd: dir,
    buffer: '',
    clients: new Set(),
    idleTimer: null,
    idleKillMs,
    bufferMax,
    meta: meta || null,
    lastOutputAt: Date.now(),
    exited: false,
  };
  terminals.set(sessionId, term);

  proc.onData((data) => {
    term.lastOutputAt = Date.now();
    term.buffer += data;
    if (term.buffer.length > term.bufferMax) {
      term.buffer = term.buffer.slice(term.buffer.length - term.bufferMax);
    }
    broadcast(term, { type: 'output', data });
  });

  proc.onExit(({ exitCode }) => {
    term.exited = true;
    clearTimeout(term.idleTimer ?? undefined);
    broadcast(term, { type: 'exit', code: exitCode });
    for (const ws of term.clients) {
      try { ws.close(1000, 'shell exited'); } catch {}
    }
    term.clients.clear();
    // An old process exiting after restart must not remove its replacement.
    if (terminals.get(sessionId) === term) terminals.delete(sessionId);
  });

  return term;
}

function broadcast(term: TerminalState, msg: TerminalServerFrame): void {
  const payload = JSON.stringify(msg);
  for (const ws of term.clients) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(payload); } catch {}
    }
  }
}

/** Frame callbacks follow the current PTY after restart, not the original one. */
export function attachClient(sessionId: string, cwd: string | null | undefined, ws: WebSocket, opts?: TerminalOptions): TerminalState {
  const term = getOrCreateTerminal(sessionId, cwd, opts);
  clearTimeout(term.idleTimer ?? undefined);
  term.idleTimer = null;
  term.clients.add(ws);

  const frame: TerminalAttachFrame = { type: 'attach', replay: term.buffer, cwd: term.cwd, ...(term.meta || {}) };
  ws.send(JSON.stringify(frame));

  ws.on('message', (raw) => {
    let msg: unknown;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    // Preserve the legacy null-frame failure; other non-object JSON has no type.
    if (msg === null) throw new TypeError("Cannot read properties of null (reading 'type')");
    if (!record(msg)) return;
    if (msg.type === 'restart') return void restartTerminal(sessionId, cwd, opts);
    const t = terminals.get(sessionId);
    if (!t || t.exited) return;
    if (msg.type === 'input' && typeof msg.data === 'string') {
      t.proc.write(msg.data);
    } else if (msg.type === 'resize') {
      // JSON strings, booleans, arrays, null and absent dimensions retain the
      // original bitwise ToInt32 coercion before the size bounds are applied.
      const cols = Math.max(2, Math.min(500, Number(msg.cols) | 0));
      const rows = Math.max(2, Math.min(300, Number(msg.rows) | 0));
      try { t.proc.resize(cols, rows); } catch {}
    }
  });

  ws.on('close', () => detachClient(sessionId, ws));
  ws.on('error', () => detachClient(sessionId, ws));
  return term;
}

/** Move clients off the old entry before kill so its exit cannot close them. */
export function restartTerminal(sessionId: string, cwd: string | null | undefined, opts?: TerminalOptions): TerminalState {
  const old = terminals.get(sessionId);
  const clients = old ? old.clients : new Set<WebSocket>();
  if (old) {
    old.clients = new Set();
    clearTimeout(old.idleTimer ?? undefined);
    terminals.delete(sessionId);
    old.exited = true;
    try { old.proc.kill(); } catch {}
  }
  const term = getOrCreateTerminal(sessionId, cwd, opts);
  for (const ws of clients) term.clients.add(ws);
  const frame: TerminalAttachFrame = { type: 'attach', replay: '', cwd: term.cwd, ...(term.meta || {}) };
  const payload = JSON.stringify(frame);
  for (const ws of clients) {
    if (ws.readyState === 1) { try { ws.send(payload); } catch {} }
  }
  return term;
}

export function detachClient(sessionId: string, ws: WebSocket): void {
  const term = terminals.get(sessionId);
  if (!term) return;
  term.clients.delete(ws);
  if (term.clients.size === 0 && !term.exited && !term.idleTimer) {
    scheduleIdleKill(sessionId, term.idleKillMs);
  }
}

// Detached shells still producing output are live work, not idle terminals.
function scheduleIdleKill(sessionId: string, delay: number): void {
  const term = terminals.get(sessionId);
  if (!term || term.exited) return;
  clearTimeout(term.idleTimer ?? undefined);
  term.idleTimer = setTimeout(() => {
    term.idleTimer = null;
    const t = terminals.get(sessionId);
    if (!t || t.exited || t.clients.size > 0) return;
    const silence = Date.now() - t.lastOutputAt;
    if (silence < t.idleKillMs) scheduleIdleKill(sessionId, t.idleKillMs - silence);
    else killTerminal(sessionId);
  }, delay);
  // Idle cleanup must not hold the server open during shutdown.
  if (term.idleTimer.unref) term.idleTimer.unref();
}

export function killTerminal(sessionId: string): void {
  const term = terminals.get(sessionId);
  if (!term) return;
  clearTimeout(term.idleTimer ?? undefined);
  terminals.delete(sessionId);
  term.exited = true;
  try { term.proc.kill(); } catch {}
  for (const ws of term.clients) {
    try { ws.close(1000, 'terminal closed'); } catch {}
  }
  term.clients.clear();
}

export function killAllTerminals(): void {
  for (const id of [...terminals.keys()]) killTerminal(id);
}
