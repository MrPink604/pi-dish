/**
 * Manages pi sessions spawned via `pi --mode rpc`.
 * Pi's RPC protocol uses {"type":"command", ...} on stdin/stdout.
 * Responses come as {"type":"response", "command":"...", "success":true, "data":{...}}
 * Events come as {"type":"extension_ui_request", ...} and others.
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

    // Stream all agent events (these come during prompt execution)
    // Events: agent_start, turn_start, message_start, message_update, message_end, turn_end, agent_end
    this._emit(msg.type, msg);

    // Extension UI requests (ignore for now)
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

  async prompt(message) {
    return this.send('prompt', { message });
  }

  async steer(message) {
    return this.send('steer', { message });
  }

  async setModel(provider, modelId) {
    return this.send('set_model', { provider, modelId });
  }

  async setName(name) {
    return this.send('set_session_name', { name });
  }

  async getState() {
    return this.send('get_state');
  }

  async getMessages() {
    return this.send('get_messages');
  }

  async compact() {
    return this.send('compact');
  }

  async abort() {
    return this.send('abort');
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
 * Spawn a new pi session in RPC mode.
 * @param {object} opts - { cwd, model }
 * @returns {{ session: RPCSession, ready: Promise<RPCSession> }}
 */
function createRPCSession(opts = {}) {
  const args = ['--mode', 'rpc'];
  if (opts.model) args.push('--model', opts.model);

  const proc = spawn('pi', args, {
    cwd: opts.cwd || process.env.HOME,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const tempId = `rpc-${Date.now()}`;
  const session = new RPCSession(tempId, proc);

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('RPC session start timeout')), 15000);

    // Wait for extension_ui_request events to finish, then query state
    let lineCount = 0;
    const onLine = async (line) => {
      lineCount++;
      try {
        const msg = JSON.parse(line);
        // Wait for the initial flurry of extension_ui_request events to pass,
        // then query get_state to get the session ID
        if (msg.type === 'extension_ui_request') return;

        // Not an extension event - remove listener and proceed
        session.rl.removeListener('line', onLine);
      } catch (e) {}
    };

    // After a short delay, query state (extensions emit their events first)
    setTimeout(async () => {
      session.rl.removeListener('line', onLine);
      clearTimeout(timeout);
      try {
        const state = await session.getState();
        const realId = state?.sessionId || tempId;
        session.id = realId;
        session.state = state;
        rpcSessions.set(realId, session);
        session.on('exit', () => rpcSessions.delete(realId));
        resolve(session);
      } catch (e) {
        // Fallback
        rpcSessions.set(tempId, session);
        session.on('exit', () => rpcSessions.delete(tempId));
        resolve(session);
      }
    }, 3000);

    session.rl.on('line', onLine);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return { session, ready };
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
  getRPCSession,
  getAllRPCSessions,
  rpcSessions,
};
