/**
 * Connector for pi-dish-bridge sockets.
 *
 * Discovers running pi sessions via the registry at ~/.pi/dish/sessions/
 * and connects to their per-session Unix socket on demand.
 *
 * Each registry entry is a JSON file written by the bridge extension on
 * session_start (and updated on turn/model/name changes). The bridge cleans
 * its own files up on session_shutdown; we also discard entries whose socket
 * is unreachable.
 */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createLineSplitter } = require('./line-splitter');
const { PendingRequests } = require('./pending-requests');

const ROOT = path.join(os.homedir(), '.pi', 'dish');
const REGISTRY_DIR = path.join(ROOT, 'sessions');

function ensureDirs() {
  try { fs.mkdirSync(REGISTRY_DIR, { recursive: true }); } catch {}
}

/**
 * List all registered (active) sessions from disk.
 * Returns an array of { sessionId, sessionFile, cwd, pid, socketPath, name, model, turnInProgress }.
 * Stale entries (dead pid or missing socket) are pruned on read.
 *
 * Memoized for a fraction of a second: routes hit this 2-4 times per request
 * (dispatch, live-usage overlay, session-file lookup), and each scan is a
 * readdir + per-entry read/parse + pid liveness check. The TTL is short
 * enough that a new/ended session is still seen within one poll tick.
 */
let registryCache = null; // { at, entries }
const REGISTRY_CACHE_MS = 500;

function listRegisteredSessions() {
  if (registryCache && Date.now() - registryCache.at < REGISTRY_CACHE_MS) {
    return registryCache.entries;
  }
  const entries = scanRegistry();
  registryCache = { at: Date.now(), entries };
  return entries;
}

function scanRegistry() {
  ensureDirs();
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(REGISTRY_DIR);
  } catch {
    return out;
  }

  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(REGISTRY_DIR, name);
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      continue;
    }
    if (!entry || !entry.sessionId || !entry.socketPath) continue;
    if (!fs.existsSync(entry.socketPath)) {
      try { fs.unlinkSync(file); } catch {}
      continue;
    }
    if (entry.pid && !pidAlive(entry.pid)) {
      try { fs.unlinkSync(file); } catch {}
      try { fs.unlinkSync(entry.socketPath); } catch {}
      continue;
    }
    out.push(entry);
  }
  return out;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function getRegisteredSession(sessionId) {
  return listRegisteredSessions().find(e => e.sessionId === sessionId) || null;
}

/**
 * A live connection to a bridge socket. Mirrors the surface that server.js
 * previously expected from RPCSession: on(event, cb), prompt, abort, setModel,
 * setName, plus a few state fields (alive, turnInProgress, sessionFile, cwd).
 */
class BridgeSession extends EventEmitter {
  constructor(registryEntry) {
    super();
    this.id = registryEntry.sessionId;
    this.sessionFile = registryEntry.sessionFile;
    this.cwd = registryEntry.cwd;
    this.pid = registryEntry.pid;
    this.socketPath = registryEntry.socketPath;
    this.name = registryEntry.name || null;
    this.model = registryEntry.model || null;
    this.turnInProgress = !!registryEntry.turnInProgress;

    this.alive = false;
    this.sock = null;
    this._nextId = 1;
    this._pending = new PendingRequests();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      this.sock = sock;
      let settled = false;

      // A socket that exists but never accepts (wedged pi) would otherwise
      // hang every route that resolves this session. destroy() fires 'close',
      // which cleans the connection pool up as usual.
      const connectTimer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('bridge connect timeout')); sock.destroy(); }
      }, 5000);

      sock.on('connect', () => {
        clearTimeout(connectTimer);
        this.alive = true;
        if (!settled) { settled = true; resolve(this); }
      });
      sock.on('error', (err) => {
        clearTimeout(connectTimer);
        this.alive = false;
        if (!settled) { settled = true; reject(err); }
        // Only re-emit when something is listening — an unlistened 'error'
        // on an EventEmitter throws and would crash the whole server. The
        // 'close' that always follows a socket error drives cleanup anyway.
        if (this.listenerCount('error')) this.emit('error', err);
      });
      sock.on('close', () => {
        this.alive = false;
        this._pending.failAll(new Error('socket closed'));
        this.emit('close');
      });
      sock.on('data', createLineSplitter((line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        this._handle(msg);
      }));
    });
  }

  _handle(msg) {
    if (msg.type === 'hello') {
      this.turnInProgress = !!msg.turnInProgress;
      if (msg.model) this.model = msg.model;
      if (msg.name) this.name = msg.name;
      if (msg.contextUsage) this.contextUsage = msg.contextUsage;
      this.emit('hello', msg);
      return;
    }
    if (msg.type === 'response') {
      this._pending.settle(msg.id, msg.success, msg.data, msg.error);
      return;
    }
    if (msg.type === 'event') {
      const ev = msg.event;
      const data = msg.data;
      if (ev === 'turn_start') this.turnInProgress = true;
      else if (ev === 'turn_end' || ev === 'agent_end') this.turnInProgress = false;
      this.emit(ev, data);
    }
  }

  // Timeout mirrors RPCSession.send — without it a command the bridge never
  // answers (wedged extension host) leaves the awaiting HTTP request hanging
  // until the socket happens to close.
  send(command, params = {}, { timeout = 30000 } = {}) {
    if (!this.alive || !this.sock) return Promise.reject(new Error('not connected'));
    const id = this._nextId++;
    const promise = this._pending.track(id, { timeout, label: `bridge ${command}` });
    try {
      this.sock.write(JSON.stringify({ id, command, ...params }) + '\n');
    } catch (e) {
      this._pending.fail(id, e);
    }
    return promise;
  }

  prompt(message, opts = {}) {
    const params = { message };
    if (opts.deliverAs) params.deliverAs = opts.deliverAs;
    if (opts.images?.length) params.images = opts.images;
    // Prompts can legitimately take a moment to be accepted (same allowance
    // as RPCSession.prompt).
    return this.send('prompt', params, { timeout: 120000 });
  }
  steer(message, opts = {}) {
    const params = { message };
    if (opts.images?.length) params.images = opts.images;
    return this.send('steer', params);
  }
  abort() { return this.send('abort'); }
  setModel(model) { return this.send('set_model', { model }); }
  setName(name) { return this.send('set_session_name', { name }); }
  getCommands() { return this.send('get_commands'); }
  getAvailableModels() { return this.send('get_available_models'); }
  setThinkingLevel(level) { return this.send('set_thinking_level', { level }); }
  runCommand(message, deliverAs) { return this.send('run_command', { message, deliverAs }); }
  respondExtensionUI(requestId, response) { return this.send('extension_ui_response', { requestId, ...response }); }

  close() {
    if (this.sock) { try { this.sock.end(); } catch {} this.sock = null; }
  }
}

// Pool — reuse a single connection per session for the lifetime of any subscriber.
const connections = new Map(); // sessionId -> Promise<BridgeSession>

async function getBridgeSession(sessionId) {
  let promise = connections.get(sessionId);
  if (promise) {
    const sess = await promise;
    if (sess.alive) return sess;
    connections.delete(sessionId);
  }

  const entry = getRegisteredSession(sessionId);
  if (!entry) throw new Error(`session ${sessionId} not registered`);

  const sess = new BridgeSession(entry);
  promise = sess.connect().then(() => sess);
  connections.set(sessionId, promise);
  sess.on('close', () => {
    if (connections.get(sessionId) === promise) connections.delete(sessionId);
  });
  return promise;
}

module.exports = {
  ROOT,
  REGISTRY_DIR,
  listRegisteredSessions,
  getRegisteredSession,
  getBridgeSession,
  BridgeSession,
};
