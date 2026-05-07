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
const fs = require('fs');
const os = require('os');
const path = require('path');

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
    this.turnInProgress = false;
    this.lastAssistantMessage = null; // cache last message_end for late joiners

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

    // Track turn state
    if (msg.type === 'turn_start') {
      this.turnInProgress = true;
      this.lastAssistantMessage = null;
    } else if (msg.type === 'turn_end') {
      this.turnInProgress = false;
    } else if (msg.type === 'message_end' && msg.message?.role === 'assistant') {
      this.lastAssistantMessage = msg.message;
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
  async getAvailableModels() { return this.send('get_available_models'); }
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

function getPiLaunchSpec() {
  // Explicit config wins. Example:
  //   PI_DISH_PI_COMMAND="pi-aws --profile work"
  if (process.env.PI_DISH_PI_COMMAND) return parseLaunchSpec(process.env.PI_DISH_PI_COMMAND);

  // Otherwise mirror simple aliases without sourcing interactive rc files:
  //   alias pi='AWS_PROFILE=work AWS_REGION=us-east-1 pi'
  //   alias pi='pi-aws --profile work'
  const alias = getPiAliasSpec();
  if (alias) return parseLaunchSpec(alias);

  return { env: {}, argv: ['pi'] };
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
    const command = ['pi', ...args].map(shellQuote).join(' ');
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
async function resumeRPCSession(sessionPath, cwd) {
  const args = ['--mode', 'rpc', '--session', sessionPath];
  const procCwd = cwd || process.env.HOME;
  const proc = spawnPi(args, procCwd);

  return _initRPCSession(proc, { cwd: procCwd });
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
