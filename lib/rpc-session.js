/**
 * Manages pi sessions spawned via `pi --mode rpc`.
 * All session interaction goes through RPC — no control sockets or file polling.
 *
 * Pi's RPC protocol uses {"type":"command", ...} on stdin/stdout.
 * Responses: {"type":"response", "id":..., "command":"...", "success":true, "data":{...}}
 * Events: turn_start, message_start, message_update, message_end, turn_end, etc.
 *
 * Framing note: pi's docs require splitting on LF only — Node's readline also
 * splits on U+2028/U+2029 which are valid inside JSON strings, so we do our
 * own buffering.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLineSplitter } = require('./line-splitter');
const { PendingRequests } = require('./pending-requests');

class RPCSession {
  constructor(id, proc) {
    this.id = id;
    this.proc = proc;
    this.alive = true;
    this.pending = new PendingRequests();
    this.nextRequestId = 1;
    this.listeners = new Map(); // event -> [callback]
    this.state = null;
    this.sessionFile = null;
    this.cwd = null;
    this.turnInProgress = false;
    // Mirrors pi's compaction_start/compaction_end events (RPC mode forwards
    // every AgentSession event, auto-compaction included); the /compact
    // emulation also holds it for the in-flight request. Gates double-compact
    // and feeds the SSE init frame + session list.
    this.compacting = false;
    this.stderrTail = []; // last few stderr lines for error reporting
    // Stable activity timestamp for the session list — bumped on turn/message
    // boundaries, never minted per poll (that made sessions look forever-unread).
    this.lastActivityAt = new Date();

    // pi can die (crash/OOM) before the 'exit' event flips this.alive, so a
    // stdin.write() can hit a broken pipe and emit an async 'error'. Without
    // a listener that throws and crashes the server; swallow it — the 'exit'
    // handler below rejects any pending requests with the real cause.
    proc.stdin.on('error', () => {});
    proc.stdout.on('error', () => {});
    proc.stderr.on('error', () => {});

    // Strict JSONL framing (LF only)
    proc.stdout.on('data', createLineSplitter((line) => {
      try {
        this._handleMessage(JSON.parse(line));
      } catch (e) {
        // Ignore non-JSON output
      }
    }));

    proc.on('exit', (code) => {
      this.alive = false;
      const err = new Error(`pi exited with code ${code}${this.stderrTail.length ? ': ' + this.stderrTail.join(' | ') : ''}`);
      this.pending.failAll(err);
      this._emit('exit', { code });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (!text) return;
      for (const line of text.split('\n')) {
        this.stderrTail.push(line);
        if (this.stderrTail.length > 5) this.stderrTail.shift();
      }
      console.error(`[rpc:${String(this.id).slice(0, 8)}] ${text}`);
    });
  }

  _handleMessage(msg) {
    // Response to a command — correlate by id.
    if (msg.type === 'response') {
      this.pending.settle(msg.id, msg.success, msg.data, msg.error, 'Command failed');
      return;
    }

    // Track turn state
    if (msg.type === 'turn_start') {
      this.turnInProgress = true;
      this.lastActivityAt = new Date();
    } else if (msg.type === 'turn_end' || msg.type === 'agent_end') {
      this.turnInProgress = false;
      this.lastActivityAt = new Date();
      this._refreshStats();
    } else if (msg.type === 'message_end') {
      this.lastActivityAt = new Date();
    } else if (msg.type === 'compaction_start') {
      this.compacting = true;
    } else if (msg.type === 'compaction_end') {
      this.compacting = false;
    }

    // Stream all agent events
    this._emit(msg.type, msg);
  }

  _emit(event, data) {
    const cbs = this.listeners.get(event) || [];
    for (const cb of cbs) cb(data);
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(cb);
    return () => {
      const arr = this.listeners.get(event);
      const idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  off(event, cb) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(cb);
    if (idx >= 0) arr.splice(idx, 1);
  }

  send(command, params = {}, { timeout = 30000 } = {}) {
    if (!this.alive) return Promise.reject(new Error('Session process not running'));
    const id = `req-${this.nextRequestId++}`;
    const promise = this.pending.track(id, { timeout, label: `RPC ${command}` });
    this.proc.stdin.write(JSON.stringify({ id, type: command, ...params }) + '\n');
    return promise;
  }

  /** Fire-and-forget write (extension_ui_response has no response). */
  write(obj) {
    if (!this.alive) throw new Error('Session process not running');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  async prompt(message, opts = {}) {
    const params = { message };
    // Queue instead of erroring when the agent is mid-turn.
    if (opts.deliverAs) params.streamingBehavior = opts.deliverAs;
    else if (this.turnInProgress) params.streamingBehavior = 'steer';
    if (opts.images?.length) params.images = opts.images;
    // Prompts can legitimately take a moment to be accepted (extension
    // commands execute inline) but should not hang forever.
    return this.send('prompt', params, { timeout: 120000 });
  }
  async steer(message, opts = {}) {
    const params = { message };
    if (opts.images?.length) params.images = opts.images;
    return this.send('steer', params);
  }
  // setModel/setName keep this.state in sync themselves — getActiveSessions
  // reads state.model/state.sessionName, and every caller used to have to
  // remember the patch.
  async setModel(provider, modelId) {
    const model = await this.send('set_model', { provider, modelId });
    if (model) this.state = { ...(this.state || {}), model };
    return model;
  }
  async setName(name) {
    const result = await this.send('set_session_name', { name });
    this.state = { ...(this.state || {}), sessionName: name, name };
    return result;
  }
  async getAvailableModels() { return this.send('get_available_models'); }
  async getSessionStats() { return this.send('get_session_stats'); }
  async getCommands() { return this.send('get_commands'); }
  async compact(customInstructions) {
    return this.send('compact', customInstructions ? { customInstructions } : {}, { timeout: 300000 });
  }
  async abort() { return this.send('abort'); }
  async setThinkingLevel(level) { return this.send('set_thinking_level', { level }); }
  async newSession() { return this.send('new_session'); }
  async exportHtml(outputPath) { return this.send('export_html', outputPath ? { outputPath } : {}); }

  _refreshStats() {
    this.getSessionStats()
      .then(stats => { this.lastStats = stats; })
      .catch(() => {});
  }

  respondExtensionUI(requestId, response) {
    this.write({ type: 'extension_ui_response', id: requestId, ...response });
  }

  kill() {
    if (this.alive) {
      this.proc.kill('SIGTERM');
    }
  }
}

// Active RPC sessions managed by pi-dish
const rpcSessions = new Map(); // sessionId -> RPCSession

/**
 * Initialize an RPC session from a spawned process.
 * Polls get_state until pi responds (instead of a blind fixed sleep).
 * @returns {Promise<RPCSession>}
 */
async function _initRPCSession(proc, opts = {}) {
  const tempId = `rpc-${Date.now()}`;
  const session = new RPCSession(tempId, proc);
  session.cwd = opts.cwd || null;

  const spawnError = new Promise((_, reject) => {
    proc.on('error', reject); // e.g. ENOENT: pi not on PATH
  });
  // The 'error' listener stays attached for the process's lifetime (removing
  // it would turn a late 'error' event into an uncaught exception), so this
  // promise can reject long after the startup race stopped listening — give
  // it a permanent handler or that late rejection kills the whole server
  // under Node's default unhandled-rejection policy.
  spawnError.catch(() => {});

  const deadline = Date.now() + 20000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (!session.alive) {
      throw new Error(`pi exited during startup${session.stderrTail.length ? ': ' + session.stderrTail.join(' | ') : ''}`);
    }
    try {
      const state = await Promise.race([
        session.send('get_state', {}, { timeout: 2500 }),
        spawnError,
      ]);
      // Use the session file basename as the id — same convention as the
      // bridge registry, so a spawned pi that also loads the bridge extension
      // doesn't show up twice under two different ids.
      const realId = state?.sessionFile
        ? path.basename(state.sessionFile, '.jsonl')
        : (state?.sessionId || tempId);
      session.id = realId;
      session.state = state;
      session.sessionFile = state?.sessionFile || null;
      rpcSessions.set(realId, session);
      // Only clear the map if it still points at *this* session — otherwise a
      // stale duplicate's exit would evict a newer live session under the same
      // id (they share the session-file basename).
      session.on('exit', () => { if (rpcSessions.get(realId) === session) rpcSessions.delete(realId); });
      session._refreshStats();
      return session;
    } catch (e) {
      lastError = e;
      if (e && e.code === 'ENOENT') throw new Error(`failed to spawn pi: ${e.message}`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  session.kill();
  throw new Error(`pi RPC session did not become ready: ${lastError?.message || 'timeout'}`);
}

/**
 * Spawn a new pi session in RPC mode.
 * @param {object} opts - { cwd, model }
 * @returns {Promise<RPCSession>}
 */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function splitShellWords(input) {
  const words = [];
  let cur = '';
  let quote = null;
  let escape = false;
  for (const ch of String(input)) {
    if (escape) { cur += ch; escape = false; continue; }
    if (ch === '\\' && quote !== "'") { escape = true; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (cur) { words.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words;
}

function parseLaunchSpec(spec) {
  const env = {};
  let words = splitShellWords(spec);
  if (words[0] === 'env') words = words.slice(1);
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const [key, ...rest] = words.shift().split('=');
    env[key] = rest.join('=');
  }
  return { env, argv: words };
}

function getPiAliasSpec() {
  const files = [path.join(os.homedir(), '.zshrc'), path.join(os.homedir(), '.bashrc')];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const match = text.match(/^\s*alias\s+pi=(['"])([\s\S]*?)\1\s*$/m)
      || text.match(/^\s*alias\s+pi=([^\n#]+)\s*$/m);
    if (match) return (match[2] || match[1] || '').trim();
  }
  return null;
}

// A bare `pi` must mean the HOST installation. Under `npm start`/`npm test`,
// npm prepends every ancestor node_modules/.bin to PATH — and pi-dish depends
// on the pi package, so its own shim (the vendored, usually older copy) would
// silently shadow the real one: sessions and --list-models ran pi 0.80.3
// while the host had 0.80.6 (new models missing, bridge testing the wrong
// version). Resolve against PATH minus node_modules dirs.
function resolveHostPi() {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir || dir.split(path.sep).includes('node_modules')) continue;
    const candidate = path.join(dir, 'pi');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return 'pi';
}

function getPiLaunchSpec() {
  let spec;
  if (process.env.PI_DISH_PI_COMMAND) {
    // Explicit config wins. Example:
    //   PI_DISH_PI_COMMAND="my-pi-wrapper --profile work"
    spec = parseLaunchSpec(process.env.PI_DISH_PI_COMMAND);
  } else {
    // Otherwise mirror simple aliases without sourcing interactive rc files:
    //   alias pi='AWS_PROFILE=work AWS_REGION=us-east-1 pi'
    //   alias pi='my-pi-wrapper --profile work'
    const alias = getPiAliasSpec();
    spec = alias ? parseLaunchSpec(alias) : { env: {}, argv: ['pi'] };
  }
  if (spec.argv[0] === 'pi') spec.argv[0] = resolveHostPi();
  return spec;
}

function spawnPi(args, cwd) {
  const spec = getPiLaunchSpec();
  const env = { ...process.env, ...spec.env };
  const argv = spec.argv.length ? spec.argv : ['pi'];
  const shell = env.PI_DISH_PI_SHELL || env.SHELL;
  const shellName = shell ? path.basename(shell) : '';

  // Escape hatch for complex aliases/functions. Off by default because
  // interactive shell startup files often assume a TTY.
  if (env.PI_DISH_USE_PI_ALIAS === '1' && shell && ['zsh', 'bash'].includes(shellName)) {
    // Leave the command word unquoted so the interactive shell expands the
    // `pi` alias — quoting it (`'pi'`) suppresses alias expansion, defeating
    // the whole point of this escape hatch. Args are still quoted.
    const command = ['pi', ...args.map(shellQuote)].join(' ');
    return spawn(shell, ['-ic', command], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
  }

  return spawn(argv[0], [...argv.slice(1), ...args], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
}

async function createRPCSession(opts = {}) {
  const args = ['--mode', 'rpc'];
  if (opts.model) args.push('--model', opts.model);

  const cwd = opts.cwd || process.env.HOME;
  const proc = spawnPi(args, cwd);

  return _initRPCSession(proc, { cwd });
}

/**
 * Resume an existing session by spawning pi --mode rpc --session <path>.
 * @param {string} sessionPath - Full path to the .jsonl session file
 * @param {string} cwd - Working directory to use
 * @returns {Promise<RPCSession>}
 */
// Dedupe concurrent resumes of the same session file. Resuming takes up to
// 20s (get_state polling) and the rpcSessions map isn't populated until it
// finishes, so without this two rapid resume requests each spawn their own pi
// against the same JSONL.
const resumingByPath = new Map(); // sessionPath -> Promise<RPCSession>

async function resumeRPCSession(sessionPath, cwd) {
  const inFlight = resumingByPath.get(sessionPath);
  if (inFlight) return inFlight;

  const procCwd = cwd || process.env.HOME;
  const promise = _initRPCSession(spawnPi(['--mode', 'rpc', '--session', sessionPath], procCwd), { cwd: procCwd });
  resumingByPath.set(sessionPath, promise);
  try {
    return await promise;
  } finally {
    resumingByPath.delete(sessionPath);
  }
}

function getRPCSession(id) {
  return rpcSessions.get(id);
}

function getAllRPCSessions() {
  return [...rpcSessions.values()];
}

module.exports = {
  RPCSession,
  createRPCSession,
  resumeRPCSession,
  getRPCSession,
  getAllRPCSessions,
  getPiLaunchSpec,
  rpcSessions,
};
