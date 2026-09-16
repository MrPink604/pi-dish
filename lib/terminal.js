// Generated from src/core/terminal.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports._terminals = void 0;
exports.isTerminalEnabled = isTerminalEnabled;
exports.isTerminalAvailable = isTerminalAvailable;
exports.terminalUnavailableReason = terminalUnavailableReason;
exports.getOrCreateTerminal = getOrCreateTerminal;
exports.attachClient = attachClient;
exports.restartTerminal = restartTerminal;
exports.detachClient = detachClient;
exports.killTerminal = killTerminal;
exports.killAllTerminals = killAllTerminals;
/**
 * One persistent PTY per session, shared by attached WebSocket clients. Phone
 * disconnects leave bounded replay behind; idle cleanup requires both no clients
 * and no output. A missing native node-pty binary disables the opt-in feature.
 */
const os = __importStar(require("node:os"));
const fs = __importStar(require("node:fs"));
const helper_values_1 = require("./helper-values");
let pty = null;
let ptyLoadError = null;
try {
    pty = require('node-pty');
}
catch (error) {
    ptyLoadError = error;
}
const RING_BUFFER_MAX = 200 * 1024;
const IDLE_KILL_MS = 15 * 60 * 1000;
const terminals = new Map();
exports._terminals = terminals;
function isTerminalEnabled() {
    return process.env.PI_DISH_TERMINAL === '1' && isTerminalAvailable();
}
function isTerminalAvailable() {
    return !!pty;
}
function terminalUnavailableReason() {
    if (!pty)
        return `node-pty failed to load: ${(0, helper_values_1.record)(ptyLoadError) ? ptyLoadError.message : undefined}`;
    return null;
}
function defaultShell() {
    if (process.platform === 'win32')
        return process.env.COMSPEC || 'cmd.exe';
    return process.env.SHELL || '/bin/bash';
}
/**
 * Cwd only applies on creation; missing directories fall back to HOME. Command
 * argv replaces the default shell, undefined environment overlays delete keys,
 * and metadata rides on each attach frame (including restarted terminals).
 */
function getOrCreateTerminal(sessionId, cwd, { idleKillMs = IDLE_KILL_MS, bufferMax = RING_BUFFER_MAX, command = null, env = null, meta = null } = {}) {
    if (!pty)
        throw new Error(terminalUnavailableReason() ?? undefined);
    const existing = terminals.get(sessionId);
    if (existing && !existing.exited)
        return existing;
    let dir = cwd;
    if (!dir || !fs.existsSync(dir))
        dir = os.homedir();
    const procEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...(env || {}) };
    for (const [key, value] of Object.entries(procEnv)) {
        if (value === undefined)
            delete procEnv[key];
    }
    const argv = Array.isArray(command) && command.length ? command : [defaultShell()];
    const proc = pty.spawn(argv[0], argv.slice(1), {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: dir,
        env: procEnv,
    });
    const term = {
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
            try {
                ws.close(1000, 'shell exited');
            }
            catch { }
        }
        term.clients.clear();
        // An old process exiting after restart must not remove its replacement.
        if (terminals.get(sessionId) === term)
            terminals.delete(sessionId);
    });
    return term;
}
function broadcast(term, msg) {
    const payload = JSON.stringify(msg);
    for (const ws of term.clients) {
        if (ws.readyState === 1 /* OPEN */) {
            try {
                ws.send(payload);
            }
            catch { }
        }
    }
}
/** Frame callbacks follow the current PTY after restart, not the original one. */
function attachClient(sessionId, cwd, ws, opts) {
    const term = getOrCreateTerminal(sessionId, cwd, opts);
    clearTimeout(term.idleTimer ?? undefined);
    term.idleTimer = null;
    term.clients.add(ws);
    const frame = { type: 'attach', replay: term.buffer, cwd: term.cwd, ...(term.meta || {}) };
    ws.send(JSON.stringify(frame));
    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        }
        catch {
            return;
        }
        // Preserve the legacy null-frame failure; other non-object JSON has no type.
        if (msg === null)
            throw new TypeError("Cannot read properties of null (reading 'type')");
        if (!(0, helper_values_1.record)(msg))
            return;
        if (msg.type === 'restart')
            return void restartTerminal(sessionId, cwd, opts);
        const t = terminals.get(sessionId);
        if (!t || t.exited)
            return;
        if (msg.type === 'input' && typeof msg.data === 'string') {
            t.proc.write(msg.data);
        }
        else if (msg.type === 'resize') {
            // JSON strings, booleans, arrays, null and absent dimensions retain the
            // original bitwise ToInt32 coercion before the size bounds are applied.
            const cols = Math.max(2, Math.min(500, Number(msg.cols) | 0));
            const rows = Math.max(2, Math.min(300, Number(msg.rows) | 0));
            try {
                t.proc.resize(cols, rows);
            }
            catch { }
        }
    });
    ws.on('close', () => detachClient(sessionId, ws));
    ws.on('error', () => detachClient(sessionId, ws));
    return term;
}
/** Move clients off the old entry before kill so its exit cannot close them. */
function restartTerminal(sessionId, cwd, opts) {
    const old = terminals.get(sessionId);
    const clients = old ? old.clients : new Set();
    if (old) {
        old.clients = new Set();
        clearTimeout(old.idleTimer ?? undefined);
        terminals.delete(sessionId);
        old.exited = true;
        try {
            old.proc.kill();
        }
        catch { }
    }
    const term = getOrCreateTerminal(sessionId, cwd, opts);
    for (const ws of clients)
        term.clients.add(ws);
    const frame = { type: 'attach', replay: '', cwd: term.cwd, ...(term.meta || {}) };
    const payload = JSON.stringify(frame);
    for (const ws of clients) {
        if (ws.readyState === 1) {
            try {
                ws.send(payload);
            }
            catch { }
        }
    }
    return term;
}
function detachClient(sessionId, ws) {
    const term = terminals.get(sessionId);
    if (!term)
        return;
    term.clients.delete(ws);
    if (term.clients.size === 0 && !term.exited && !term.idleTimer) {
        scheduleIdleKill(sessionId, term.idleKillMs);
    }
}
// Detached shells still producing output are live work, not idle terminals.
function scheduleIdleKill(sessionId, delay) {
    const term = terminals.get(sessionId);
    if (!term || term.exited)
        return;
    clearTimeout(term.idleTimer ?? undefined);
    term.idleTimer = setTimeout(() => {
        term.idleTimer = null;
        const t = terminals.get(sessionId);
        if (!t || t.exited || t.clients.size > 0)
            return;
        const silence = Date.now() - t.lastOutputAt;
        if (silence < t.idleKillMs)
            scheduleIdleKill(sessionId, t.idleKillMs - silence);
        else
            killTerminal(sessionId);
    }, delay);
    // Idle cleanup must not hold the server open during shutdown.
    if (term.idleTimer.unref)
        term.idleTimer.unref();
}
function killTerminal(sessionId) {
    const term = terminals.get(sessionId);
    if (!term)
        return;
    clearTimeout(term.idleTimer ?? undefined);
    terminals.delete(sessionId);
    term.exited = true;
    try {
        term.proc.kill();
    }
    catch { }
    for (const ws of term.clients) {
        try {
            ws.close(1000, 'terminal closed');
        }
        catch { }
    }
    term.clients.clear();
}
function killAllTerminals() {
    for (const id of [...terminals.keys()])
        killTerminal(id);
}
