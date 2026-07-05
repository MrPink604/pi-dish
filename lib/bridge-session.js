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

const ROOT = path.join(os.homedir(), '.pi', 'dish');
const REGISTRY_DIR = path.join(ROOT, 'sessions');

function ensureDirs() {
  try { fs.mkdirSync(REGISTRY_DIR, { recursive: true }); } catch {}
}

/**
 * List all registered (active) sessions from disk.
 * Returns an array of { sessionId, sessionFile, cwd, pid, socketPath, name, model, turnInProgress }.
 * Stale entries (dead pid or missing socket) are pruned on read.
 */
function listRegisteredSessions() {
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
    this._buf = '';
    this._nextId = 1;
    this._pending = new Map(); // id -> { resolve, reject }
    this._refs = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      this.sock = sock;
      let settled = false;

      sock.on('connect', () => {
        this.alive = true;
        if (!settled) { settled = true; resolve(this); }
      });
      sock.on('error', (err) => {
        this.alive = false;
        if (!settled) { settled = true; reject(err); }
        this.emit('error', err);
      });
      sock.on('close', () => {
        this.alive = false;
        for (const { reject } of this._pending.values()) {
          reject(new Error('socket closed'));
        }
        this._pending.clear();
        this.emit('close');
      });
      sock.on('data', (chunk) => this._onData(chunk));
    });
  }

  _onData(chunk) {
    this._buf += chunk.toString('utf-8');
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this._handle(msg);
    }
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
      const id = msg.id;
      const pending = id != null ? this._pending.get(id) : null;
      if (pending) {
        this._pending.delete(id);
        if (msg.success) pending.resolve(msg.data);
        else pending.reject(new Error(msg.error || 'command failed'));
      }
      return;
    }
    if (msg.type === 'event') {
      const ev = msg.event;
      const data = msg.data;
      if (ev === 'turn_start') this.turnInProgress = true;
      else if (ev === 'turn_end' || ev === 'agent_end') this.turnInProgress = false;
      this.emit(ev, data);
      this.emit('*', ev, data);
    }
  }

  send(command, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.alive || !this.sock) return reject(new Error('not connected'));
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });
      const payload = JSON.stringify({ id, command, ...params }) + '\n';
      try {
        this.sock.write(payload);
      } catch (e) {
        this._pending.delete(id);
        reject(e);
      }
    });
  }

  prompt(message, opts = {}) {
    const params = { message };
    if (opts.deliverAs) params.deliverAs = opts.deliverAs;
    if (opts.images?.length) params.images = opts.images;
    return this.send('prompt', params);
  }
  steer(message, opts = {}) {
    const params = { message };
    if (opts.images?.length) params.images = opts.images;
    return this.send('steer', params);
  }
  followUp(message) { return this.send('follow_up', { message }); }
  abort() { return this.send('abort'); }
  setModel(model) { return this.send('set_model', { model }); }
  setName(name) { return this.send('set_session_name', { name }); }
  getState() { return this.send('get_state'); }
  getCommands() { return this.send('get_commands'); }
  setThinkingLevel(level) { return this.send('set_thinking_level', { level }); }
  runCommand(message, deliverAs) { return this.send('run_command', { message, deliverAs }); }
  respondExtensionUI(requestId, response) { return this.send('extension_ui_response', { requestId, ...response }); }

  ref() { this._refs++; }
  unref() {
    this._refs = Math.max(0, this._refs - 1);
    if (this._refs === 0) this.close();
  }
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
