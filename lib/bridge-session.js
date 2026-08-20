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
const { isDeepStrictEqual } = require('util');
const { createLineSplitter } = require('./line-splitter');
const { PendingRequests } = require('./pending-requests');
const { processIdentity, processIdentityAlive } = require('./process-identity');
const { trackRunningToolCalls } = require('./running-tool-calls');
const { listHarnesses } = require('./harnesses');

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

// For state changes the server itself caused (closing a session): the client
// re-fetches the list immediately after the response, and a memoized scan
// from up to 500ms ago would still show the session as live.
function invalidateRegistryCache() {
  registryCache = null;
}

function hasStartTime(entry) {
  return Object.prototype.hasOwnProperty.call(entry || {}, 'startTime');
}

function hasOwn(entry, key) {
  return Object.prototype.hasOwnProperty.call(entry || {}, key);
}

function registryHarnessId(entry) {
  return entry?.wrapper?.harnessId || entry?.harnessId || 'pi';
}

// A wrapper host (OMP, …) embeds pi's extension API, so the stock
// pi-dish-bridge from the wrapper's user-extension directory also loads in
// the same process and registers the session a second time as a plain pi
// session: one logical session then appears twice in pi-dish (a wrapper row
// plus a pi row), and because the session index is keyed by file path the
// two claims carry different profile ids and invalidate each other's cached
// entries on every poll — a full re-parse of the JSONL per row per refresh.
// The wrapper-specific claim is authoritative for that process; hide the
// duplicate generic-pi claim rather than pruning its file (its bridge is
// alive in the same process and would just rewrite the entry).
// Alternate harnesses' session files can never legitimately belong to a
// generic-pi claim: wrapper hosts embed pi's extension API, so the stock
// pi-dish-bridge from the wrapper's user-extension directory loads in their
// processes and registers the wrapper's session as a plain pi session. Host
// detection in the bridge is the first line of defense; this containment
// check is deterministic and catches whatever slips past it (old bridge
// copies, detection gaps). Config roots (not just the sessions subpath)
// cover wrapper profile trees like ~/.omp/profiles/<p>/agent/sessions.
const FOREIGN_CONFIG_ROOTS = listHarnesses()
  .filter((descriptor) => descriptor.id !== 'pi')
  .map((descriptor) => {
    try {
      // rootPath is <configRoot>/<agent>/sessions; the config root is two
      // levels up.
      return path.dirname(path.dirname(descriptor.rootPath()));
    } catch { return null; }
  })
  .filter((root) => typeof root === 'string' && root !== path.sep);

function underAnyRoot(file, roots) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return false;
  const resolved = path.resolve(file);
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

function withoutWrappedPiClaims(entries) {
  const wrapped = new Set();
  for (const entry of entries) {
    if (registryHarnessId(entry) === 'pi' || !entry.sessionFile) continue;
    wrapped.add(`${Number(entry.pid)}\0${entry.sessionFile}`);
  }
  return entries.filter((entry) => {
    if (registryHarnessId(entry) !== 'pi') return true;
    if (!entry.sessionFile) return true;
    if (wrapped.has(`${Number(entry.pid)}\0${entry.sessionFile}`)) return false;
    // A pi claim pointing into another harness's config tree is the stock
    // bridge riding inside that wrapper host — even with no competing wrapper
    // claim (a manually launched wrapper has none).
    return !underAnyRoot(entry.sessionFile, FOREIGN_CONFIG_ROOTS);
  });
}

// Legacy registry compatibility belongs to upstream Pi only. Alternative
// harness identity is trusted only when the thin wrapper publishes the full
// protocol-v2 claim that its socket must prove again in hello.
function validRegistryClaimShape(entry) {
  const harnessId = registryHarnessId(entry);
  if (harnessId === 'pi') return true;
  return Number(entry?.protocolVersion) >= 2
    && entry?.wrapper?.harnessId === harnessId
    && entry?.harnessId === harnessId
    && typeof entry.wrapper.name === 'string'
    && entry.wrapper.name.length > 0
    && typeof entry.wrapper.wrapperVersion === 'string'
    && entry.wrapper.wrapperVersion.length > 0
    && typeof entry?.nativeSessionId === 'string'
    && entry.nativeSessionId.length > 0
    && entry.nativeSessionId === entry.sessionId
    && typeof entry?.bridgeInstanceId === 'string'
    && entry.bridgeInstanceId.length > 0
    && entry.bridgeInstanceId === entry.instanceId
    && typeof entry?.sessionFile === 'string'
    && entry.sessionFile.length > 0
    && typeof entry?.socketPath === 'string'
    && entry.socketPath.length > 0
    && Number.isInteger(entry?.pid)
    && entry.pid > 1
    && hasStartTime(entry)
    && !!entry.capabilities
    && typeof entry.capabilities === 'object'
    && !Array.isArray(entry.capabilities)
    && hasOwn(entry, 'spawnToken')
    && (entry.spawnToken === null
      || (typeof entry.spawnToken === 'string' && entry.spawnToken.length > 0));
}

function sameRegistryClaim(left, right) {
  if (!left || !right) return false;
  const leftBridgeId = left.bridgeInstanceId || left.instanceId || null;
  const rightBridgeId = right.bridgeInstanceId || right.instanceId || null;
  return left.sessionId === right.sessionId
    && left.socketPath === right.socketPath
    && Number(left.pid) === Number(right.pid)
    && hasStartTime(left) === hasStartTime(right)
    && (!hasStartTime(left) || String(left.startTime) === String(right.startTime))
    && leftBridgeId === rightBridgeId
    && registryHarnessId(left) === registryHarnessId(right)
    && (left.nativeSessionId || left.sessionId) === (right.nativeSessionId || right.sessionId)
    && Number(left.protocolVersion || 1) === Number(right.protocolVersion || 1)
    && left.sessionFile === right.sessionFile
    && isDeepStrictEqual(left.wrapper || null, right.wrapper || null)
    && isDeepStrictEqual(left.capabilities || null, right.capabilities || null)
    && hasOwn(left, 'spawnToken') === hasOwn(right, 'spawnToken')
    && (!hasOwn(left, 'spawnToken') || left.spawnToken === right.spawnToken);
}

/**
 * Remove only the registry claim that was actually inspected. Re-read before
 * unlinking so a new bridge for the same session cannot be erased by a stale
 * scan or failed connection from the old bridge. The socket itself is left
 * alone: unlinking a path after a replacement bridge binds it would sever a
 * healthy listener from future clients.
 */
function pruneRegisteredSession(entry) {
  invalidateRegistryCache();
  if (!entry?.sessionId || path.basename(entry.sessionId) !== entry.sessionId) return false;
  const file = entry._registryPath || path.join(REGISTRY_DIR, `${entry.sessionId}.json`);
  let current;
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (!sameRegistryClaim(entry, current)) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// These errors prove that the registry's socket path has no connectable bridge
// listener. A timeout is deliberately excluded: the bridge may still be live
// but wedged, and deleting its claim would let a lower-priority transport hide
// it permanently.
function pruneUnreachableRegisteredSession(entry, error) {
  if (!['ENOENT', 'ECONNREFUSED', 'ENOTSOCK'].includes(error?.code)) return false;
  return pruneRegisteredSession(entry);
}

function pruneMalformedRegistryEntry(file, inspected) {
  try {
    const current = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!isDeepStrictEqual(current, inspected)) return false;
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
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
    if (!entry || !entry.sessionId || !entry.socketPath || !validRegistryClaimShape(entry)) {
      pruneMalformedRegistryEntry(file, entry);
      continue;
    }
    Object.defineProperty(entry, '_registryPath', { value: file });
    if (!fs.existsSync(entry.socketPath)) {
      pruneRegisteredSession(entry);
      continue;
    }
    if (hasStartTime(entry)) {
      const identity = processIdentity(entry.pid);
      if (!identity || identity.startTime !== String(entry.startTime)) {
        pruneRegisteredSession(entry);
        continue;
      }
    } else if (entry.pid && !pidAlive(entry.pid)) {
      // Legacy bridges did not publish a birth marker. Keep live legacy
      // entries visible, but dead ones are still safe to discard. Destructive
      // use of a legacy PID requires a bridge handshake in server.js.
      pruneRegisteredSession(entry);
      continue;
    }
    out.push(entry);
  }
  return withoutWrappedPiClaims(out);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function getRegisteredSession(sessionId) {
  const matches = listRegisteredSessions().filter(e => e.sessionId === sessionId);
  const pi = matches.filter(e => !e.protocolVersion || (e.wrapper?.harnessId || e.harnessId) === 'pi');
  // This legacy raw-id lookup belongs to upstream Pi only. Alternate callers
  // must select the canonical (harnessId, nativeSessionId) tuple or an exact
  // registry claim, so a colliding native ID can never hijack a Pi route.
  return pi.length === 1 ? pi[0] : null;
}

function getRegisteredSessionByNativeId(harnessId, nativeSessionId) {
  const matches = listRegisteredSessions().filter(e =>
    (e.wrapper?.harnessId || e.harnessId || 'pi') === harnessId
    && (e.nativeSessionId || e.sessionId) === nativeSessionId);
  return matches.length === 1 ? matches[0] : null;
}

function getRegisteredSessionByClaim(claim) {
  return listRegisteredSessions().find(e => sameRegistryClaim(e, claim)) || null;
}

function refreshRegisteredSession(sessionId) {
  invalidateRegistryCache();
  return getRegisteredSession(sessionId);
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
    this.protocolVersion = registryEntry.protocolVersion || 1;
    this.wrapper = registryEntry.wrapper || null;
    this.harnessId = registryEntry.wrapper?.harnessId || registryEntry.harnessId || 'pi';
    this.nativeSessionId = registryEntry.nativeSessionId || registryEntry.sessionId;
    this.bridgeInstanceId = registryEntry.bridgeInstanceId || registryEntry.instanceId || null;
    this.capabilities = registryEntry.capabilities || {};
    this.registryClaim = registryEntry;
    this.sessionFile = registryEntry.sessionFile;
    this.cwd = registryEntry.cwd;
    this.pid = registryEntry.pid;
    this.startTime = registryEntry.startTime;
    this.socketPath = registryEntry.socketPath;
    this.name = registryEntry.name || null;
    this.model = registryEntry.model || null;
    this.turnInProgress = !!registryEntry.turnInProgress;
    this.compacting = !!registryEntry.compacting;
    this.queueState = null; // populated from the bridge hello / queue_update
    this.runningToolCalls = new Map();

    this.alive = false;
    this.sock = null;
    this._nextId = 1;
    this._pending = new PendingRequests();
    this.hello = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      this.sock = sock;
      let settled = false;
      const requiresHelloProof = Number(this.registryClaim?.protocolVersion) >= 2;

      const cleanupConnectListeners = () => {
        clearTimeout(connectTimer);
        this.off('hello', onHello);
        this.off('protocol_error', onProtocolError);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanupConnectListeners();
        resolve(this);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanupConnectListeners();
        reject(error);
      };
      const onHello = () => succeed();
      const onProtocolError = (error) => fail(error);
      if (requiresHelloProof) {
        this.once('hello', onHello);
        this.once('protocol_error', onProtocolError);
      }

      // A socket that exists but never accepts (wedged pi) would otherwise
      // hang every route that resolves this session. Protocol-v2 sessions must
      // also prove that the socket belongs to the exact selected registry
      // claim before callers can send a command.
      const connectTimer = setTimeout(() => {
        if (!settled) { fail(new Error('bridge connect timeout')); sock.destroy(); }
      }, 5000);

      sock.on('connect', () => {
        this.alive = true;
        if (!requiresHelloProof) succeed();
      });
      sock.on('error', (err) => {
        this.alive = false;
        fail(err);
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

  _validateV2Hello(msg) {
    if (Number(this.registryClaim?.protocolVersion || 1) < 2) return null;
    const claim = this.registryClaim;
    const mismatch = !validRegistryClaimShape(claim)
      || !validRegistryClaimShape(msg)
      || !sameRegistryClaim(msg, claim);
    if (!mismatch) return null;
    const error = new Error('bridge hello does not match the selected registry claim');
    error.code = 'EPROTO';
    return error;
  }

  _handle(msg) {
    if (msg.type === 'hello') {
      const protocolError = this._validateV2Hello(msg);
      if (protocolError) {
        this.emit('protocol_error', protocolError);
        try { this.sock?.destroy(); } catch {}
        return;
      }
      this.hello = msg;
      // Legacy Pi bridges predate claim-bound identity and retain their
      // compatibility handshake. Protocol-v2 identity always remains the
      // selected registry claim; only mutable state is refreshed from hello.
      if (Number(this.registryClaim?.protocolVersion || 1) < 2) {
        this.protocolVersion = msg.protocolVersion || this.protocolVersion;
        this.wrapper = msg.wrapper || this.wrapper;
        this.harnessId = msg.wrapper?.harnessId || msg.harnessId || this.harnessId;
        this.nativeSessionId = msg.nativeSessionId || msg.sessionId || this.nativeSessionId;
        this.bridgeInstanceId = msg.bridgeInstanceId || msg.instanceId || this.bridgeInstanceId;
      }
      if (Number(this.registryClaim?.protocolVersion || 1) < 2) {
        this.capabilities = msg.capabilities || this.capabilities;
      }
      this.turnInProgress = !!msg.turnInProgress;
      this.compacting = !!msg.compacting;
      if (msg.model) this.model = msg.model;
      if (msg.name) this.name = msg.name;
      if (msg.contextUsage) this.contextUsage = msg.contextUsage;
      // Remembered so the SSE stream route can replay it into a client that
      // just (re)connected — the bridge only pushes hello when our socket
      // connects, which is once per session.
      this.queueState = msg.queue || null;
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
      trackRunningToolCalls(this.runningToolCalls, ev, data);
      if (ev === 'turn_start') this.turnInProgress = true;
      else if (ev === 'turn_end' || ev === 'agent_end') this.turnInProgress = false;
      else if (ev === 'compaction_start') this.compacting = true;
      else if (ev === 'compaction_end') this.compacting = false;
      else if (ev === 'queue_update') this.queueState = data;
      else if (ev === 'session_switch') {
        // The preserved socket now controls a different logical session.
        // Clear session-owned live state before listeners re-key server state;
        // identity fields are updated after emit so listeners can still use
        // the previous native id as a fallback with older event producers.
        this.turnInProgress = false;
        this.compacting = false;
        this.queueState = null;
        this.runningToolCalls.clear();
      }
      this.emit(ev, data);
      if (ev === 'session_switch' && data?.sessionId) {
        this.id = data.sessionId;
        this.nativeSessionId = data.sessionId;
        if (data.sessionFile) this.sessionFile = data.sessionFile;
        if (data.cwd) this.cwd = data.cwd;
        // The pool is instance-keyed, but validates a reused connection
        // against the registry claim selected for the requested route. Adopt
        // the rewritten identity here too, or the first new-route request
        // sees the old claim, closes this healthy socket, and disconnects
        // clients that were meant to survive the in-pane switch.
        if (this.registryClaim) {
          this.registryClaim.sessionId = data.sessionId;
          this.registryClaim.nativeSessionId = data.sessionId;
          if (data.sessionFile) this.registryClaim.sessionFile = data.sessionFile;
          if (data.cwd) this.registryClaim.cwd = data.cwd;
        }
      }
    }
  }

  waitForHello({ timeout = 2000 } = {}) {
    if (this.hello) return Promise.resolve(this.hello);
    if (!this.alive) return Promise.reject(new Error('bridge disconnected before hello'));
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        this.off('hello', onHello);
        this.off('close', onClose);
      };
      const onHello = (hello) => { cleanup(); resolve(hello); };
      const onClose = () => { cleanup(); reject(new Error('bridge disconnected before hello')); };
      this.once('hello', onHello);
      this.once('close', onClose);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`bridge hello timed out after ${timeout}ms`));
      }, timeout);
    });
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
    // Internal request correlation for protocols that need an explicit
    // queued barrier before an out-of-band host action (OMP tree commands).
    promise.requestId = id;
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
  compact(instructions) { return this.send('compact', { instructions }); }
  cancelQueued(kind, index, text) { return this.send('cancel_queued', { kind, index, text }); }
  setModel(model) { return this.send('set_model', { model }); }
  setName(name) { return this.send('set_session_name', { name }); }
  getCommands() { return this.send('get_commands'); }
  getAvailableModels() { return this.send('get_available_models'); }
  getShareSnapshot() { return this.send('share_snapshot'); }
  setThinkingLevel(level) { return this.send('set_thinking_level', { level }); }
  runCommand(message, deliverAs) { return this.send('run_command', { message, deliverAs }); }
  readTree() { return this.send('tree_read', {}, { timeout: 10000 }); }
  // Leaf id only — the transcript route needs just the live leaf, and
  // tree_read serializes the whole session tree per call. Older running
  // bridge extensions answer "unknown command"; callers fall back to
  // readTree() (see server.js liveTreeLeafId).
  readTreeLeaf() { return this.send('tree_leaf', {}, { timeout: 10000 }); }
  // Branch-summary generation is a full LLM call over the abandoned branch —
  // give it the long prompt-style allowance, not the 30s default.
  navigateTree(targetId, opts = {}) {
    const params = { targetId };
    if (opts.summarize) params.summarize = true;
    if (opts.customInstructions) params.customInstructions = opts.customInstructions;
    if (opts.label) params.label = opts.label;
    return this.send('navigate_tree', params, { timeout: 180000 });
  }
  treeNavigate(targetId, opts = {}) {
    const params = { targetId };
    if (opts.summarize) params.summarize = true;
    return this.send('tree_navigate', params, { timeout: 180000 });
  }
  branchTree(targetId) {
    return this.send('branch', { targetId }, { timeout: 180000 });
  }
  respondExtensionUI(requestId, response) { return this.send('extension_ui_response', { requestId, ...response }); }

  close() {
    this.alive = false;
    if (this.sock) { try { this.sock.end(); } catch {} this.sock = null; }
  }
}

// Pool — reuse a single connection per session for the lifetime of any subscriber.
const connections = new Map(); // exact registry claim -> Promise<BridgeSession>

function connectionKey(entry) {
  return entry.bridgeInstanceId || entry.instanceId
    ? `${entry.wrapper?.harnessId || entry.harnessId || 'pi'}:${entry.bridgeInstanceId || entry.instanceId}`
    : `v1:${entry.sessionId}:${entry.socketPath}`;
}

async function getBridgeSession(sessionId) {
  const entry = typeof sessionId === 'object' ? getRegisteredSessionByClaim(sessionId) : getRegisteredSession(sessionId);
  if (!entry) throw new Error(`session ${typeof sessionId === 'string' ? sessionId : 'claim'} not registered or ambiguous`);
  const key = connectionKey(entry);
  let promise = connections.get(key);
  if (promise) {
    const sess = await promise;
    if (sess.alive && sameRegistryClaim(sess.registryClaim, entry)) return sess;
    if (sess.alive) sess.close();
    connections.delete(key);
  }

  const sess = new BridgeSession(entry);
  promise = sess.connect().then(() => sess);
  connections.set(key, promise);
  promise.catch(() => {
    if (connections.get(key) === promise) connections.delete(key);
  });
  sess.on('close', () => {
    if (connections.get(key) === promise) connections.delete(key);
  });
  return promise;
}

module.exports = {
  ROOT,
  REGISTRY_DIR,
  listRegisteredSessions,
  invalidateRegistryCache,
  getRegisteredSession,
  getRegisteredSessionByNativeId,
  getRegisteredSessionByClaim,
  refreshRegisteredSession,
  validRegistryClaimShape,
  sameRegistryClaim,
  pruneRegisteredSession,
  pruneUnreachableRegisteredSession,
  getBridgeSession,
  BridgeSession,
  pidAlive,
  processIdentity,
  processIdentityAlive,
};
