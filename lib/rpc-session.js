/**
 * Manages pi sessions spawned via `pi --mode rpc`.
 * All session interaction goes through RPC — no control sockets or file polling.
 * 
 * Pi's RPC protocol uses {"type":"command", ...} on stdin/stdout.
 * Responses: {"type":"response", "command":"...", "success":true, "data":{...}}
 * Events: turn_start, message_start, message_update, message_end, turn_end, etc.
 */
const { spawn } = require('child_process');
const readline = require('readline');

class RPCSession {
  constructor(id, proc) {
    this.id = id;
    this.proc = proc;
    this.alive = true;
    this.pendingCommand = null; // { resolve, reject, command }
    this.listeners = new Map(); // event -> [callback]
    this.state = null;
    this.sessionFile = null;
    this.cwd = null;

    // Parse JSON lines from stdout
    this.rl = readline.createInterface({ input: proc.stdout });
    this.rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch (e) {
        // Ignore non-JSON output
      }
    });

    proc.on('exit', (code) => {
      this.alive = false;
      if (this.pendingCommand) {
        this.pendingCommand.reject(new Error(`Process exited with code ${code}`));
        this.pendingCommand = null;
      }
      this._emit('exit', { code });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) console.error(`[rpc:${id.slice(0, 8)}] ${text}`);
    });
  }

  _handleMessage(msg) {
    // Response to our command
    if (msg.type === 'response' && this.pendingCommand) {
      const { resolve, reject } = this.pendingCommand;
      this.pendingCommand = null;
      if (msg.success) {
        resolve(msg.data);
      } else {
        reject(new Error(msg.error || 'Command failed'));
      }
      return;
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

  send(command, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.alive) return reject(new Error('Session process not running'));
      if (this.pendingCommand) return reject(new Error('Another command is pending'));

      this.pendingCommand = { resolve, reject, command };
      const msg = JSON.stringify({ type: command, ...params });
      this.proc.stdin.write(msg + '\n');
    });
  }

  async prompt(message) { return this.send('prompt', { message }); }
  async steer(message) { return this.send('steer', { message }); }
  async setModel(provider, modelId) { return this.send('set_model', { provider, modelId }); }
  async setName(name) { return this.send('set_session_name', { name }); }
  async getState() { return this.send('get_state'); }
  async getMessages() { return this.send('get_messages'); }
  async compact() { return this.send('compact'); }
  async abort() { return this.send('abort'); }

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
 * Waits for extension events to settle, then queries get_state.
 * @returns {Promise<RPCSession>}
 */
function _initRPCSession(proc, opts = {}) {
  const tempId = `rpc-${Date.now()}`;
  const session = new RPCSession(tempId, proc);
  session.cwd = opts.cwd || null;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('RPC session start timeout')), 15000);

    // Wait for extension_ui_request events to settle, then query state
    setTimeout(async () => {
      clearTimeout(timeout);
      try {
        const state = await session.getState();
        const realId = state?.sessionId || tempId;
        session.id = realId;
        session.state = state;
        session.sessionFile = state?.sessionFile || null;
        if (state?.sessionFile && !session.cwd) {
          // Try to extract cwd from session dir name
          session.cwd = opts.cwd || null;
        }
        rpcSessions.set(realId, session);
        session.on('exit', () => rpcSessions.delete(realId));
        resolve(session);
      } catch (e) {
        rpcSessions.set(tempId, session);
        session.on('exit', () => rpcSessions.delete(tempId));
        resolve(session);
      }
    }, 3000);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Spawn a new pi session in RPC mode.
 * @param {object} opts - { cwd, model }
 * @returns {Promise<RPCSession>}
 */
async function createRPCSession(opts = {}) {
  const args = ['--mode', 'rpc'];
  if (opts.model) args.push('--model', opts.model);

  const cwd = opts.cwd || process.env.HOME;
  const proc = spawn('pi', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  return _initRPCSession(proc, { cwd });
}

/**
 * Resume an existing session by spawning pi --mode rpc --session <path>.
 * @param {string} sessionPath - Full path to the .jsonl session file
 * @param {string} cwd - Working directory to use
 * @returns {Promise<RPCSession>}
 */
async function resumeRPCSession(sessionPath, cwd) {
  const args = ['--mode', 'rpc', '--session', sessionPath];

  const proc = spawn('pi', args, {
    cwd: cwd || process.env.HOME,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  return _initRPCSession(proc, { cwd });
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
  rpcSessions,
};
