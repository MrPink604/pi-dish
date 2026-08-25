/**
 * Spawn pi sessions inside tmux windows instead of as web-server children.
 *
 * A pi-dish-managed RPC session (lib/rpc-session.js) dies when the pi-dish
 * server restarts — it's a child process. A pi TUI running in tmux with the
 * pi-dish-bridge extension survives independently (registry + Unix socket).
 * This module lets pi-dish open a new pi TUI as a tmux window on a chosen tmux
 * server; the bridge registers it and pi-dish drives it over the normal
 * BridgeSession path.
 *
 * The user may run several tmux *servers* (via `tmux -L <name>` / `-S <path>`),
 * each a distinct socket under $TMUX_TMPDIR (default /tmp/tmux-<uid>/). We
 * enumerate those sockets to offer spawn targets.
 *
 * Every tmux invocation goes through execFile with a short timeout and an argv
 * array (never a shell string) — a hung tmux must not hang an HTTP request, and
 * user-supplied paths/session names must not become shell metacharacters.
 *
 * Spawn placements persist in ~/.pi/dish/tmux-spawns.json so remote tree
 * navigation can re-prime a session's command context (send-keys /dish-prime)
 * after a restart. HOME is resolved per call so the tests' temp HOME works.
 */
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { processIdentity, processIdentityAlive } = require('./process-identity');

function runTmux(args, { timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, { timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve(stdout);
    });
  });
}

let tmuxAvailable = null;
function isTmuxAvailable() {
  if (tmuxAvailable !== null) return tmuxAvailable;
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore', timeout: 2000 });
    tmuxAvailable = true;
  } catch {
    tmuxAvailable = false;
  }
  return tmuxAvailable;
}

function tmuxTmpdir() {
  if (process.env.TMUX_TMPDIR) return process.env.TMUX_TMPDIR;
  const uid = typeof process.getuid === 'function' ? process.getuid() : '';
  return `/tmp/tmux-${uid}`;
}

/**
 * Enumerate tmux servers: each socket file under the tmux tmpdir whose
 * list-sessions succeeds. A socket for a dead/stale server (list-sessions
 * fails) is skipped silently.
 * Returns [{ socket, name, sessions: [{ name, windows, attached }] }].
 */
async function listServers() {
  if (!isTmuxAvailable()) return [];
  const dir = tmuxTmpdir();
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const servers = [];
  for (const name of names) {
    const socket = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(socket); } catch { continue; }
    if (!stat.isSocket()) continue;
    let out;
    try {
      // ':' as the field separator: tmux forbids it in session/window names
      // (it's the target-spec separator) and, unlike a tab, doesn't get
      // sanitized to '_' in formatted output.
      out = await runTmux(
        ['-S', socket, 'list-sessions', '-F', '#{session_name}:#{session_windows}:#{session_attached}'],
        { timeout: 2000 },
      );
    } catch {
      continue; // stale socket / dead server
    }
    const sessions = out.split('\n').filter(Boolean).map((line) => {
      const [sname, windows, attached] = line.split(':');
      return { name: sname, windows: Number(windows) || 0, attached: attached === '1' };
    });
    servers.push({ socket, name: path.basename(socket), sessions });
  }
  return servers;
}

// Allow a socket only when it lives directly in the tmux tmpdir — the same
// directory listServers() enumerates. The pi-dish server can be exposed on
// 0.0.0.0 — never let a LAN client pass an arbitrary `-S` path through.
function isSocketAllowed(socket) {
  if (typeof socket !== 'string' || !socket) return false;
  return path.dirname(path.resolve(socket)) === path.resolve(tmuxTmpdir());
}

/**
 * Open a new pi window/session in tmux.
 * - tmuxSession given → new-window in that session.
 * - newTmuxSessionName given → detached new-session with that name.
 * `command` is the child argv (execFile array — no shell), `env` is set with
 * tmux `-e KEY=VALUE` flags (tmux >= 3.0). Returns { paneId }.
 */
async function spawnInTmux({ socket, tmuxSession, newTmuxSessionName, windowName, cwd, command, env }) {
  if (!Array.isArray(command) || !command.length) throw new Error('command argv required');
  const envFlags = [];
  for (const [k, v] of Object.entries(env || {})) envFlags.push('-e', `${k}=${v}`);

  let args;
  if (newTmuxSessionName) {
    args = ['-S', socket, 'new-session', '-d', '-s', newTmuxSessionName];
    if (windowName) args.push('-n', windowName);
  } else if (tmuxSession) {
    // -d: create the window without making it current — the user may be
    // attached to this session, and a remote spawn must not yank their view
    // away from whatever they're working on.
    args = ['-S', socket, 'new-window', '-d', '-t', tmuxSession];
    if (windowName) args.push('-n', windowName);
  } else {
    throw new Error('tmuxSession or newTmuxSessionName required');
  }
  if (cwd) args.push('-c', cwd);
  args.push(...envFlags, '-P', '-F', '#{pane_id}', '--', ...command);

  const out = await runTmux(args, { timeout: 5000 });
  return { paneId: out.trim() };
}

async function sendKeys(socket, paneId, text) {
  await runTmux(['-S', socket, 'send-keys', '-t', paneId, text, 'Enter'], { timeout: 2000 });
}
async function renameWindow(socket, target, name) {
  if (!socket || !target || !name) return;
  const sanitized = String(name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  if (!sanitized) return;
  const sessionSafe = sanitized.replace(/[.:\s]+/g, '-').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 48);
  try {
    await runTmux(['-S', socket, 'rename-window', '-t', target, sanitized], { timeout: 2000 });
    await runTmux(['-S', socket, 'select-pane', '-t', target, '-T', sanitized], { timeout: 2000 });
    if (sessionSafe) {
      await runTmux(['-S', socket, 'rename-session', '-t', target, sessionSafe], { timeout: 2000 }).catch(() => {});
    }
  } catch {}
}


// '=' prefix: exact-match the session name — bare names prefix-match, so
// 'headless' would otherwise claim a user session named 'headless-foo'.
async function hasSession(socket, name) {
  try {
    await runTmux(['-S', socket, 'has-session', '-t', `=${name}`], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

async function killPane(socket, paneId) {
  await runTmux(['-S', socket, 'kill-pane', '-t', paneId], { timeout: 2000 });
}

async function paneProcessId(socket, paneId) {
  if (!socket || !paneId) return null;
  try {
    const out = await runTmux(
      ['-S', socket, 'display-message', '-p', '-t', paneId, '#{pane_pid}'],
      { timeout: 2000 },
    );
    const pid = Number(out.trim());
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

function processTree(rootPid) {
  const children = new Map();
  try {
    for (const name of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
        const match = status.match(/^PPid:\s*(\d+)/m);
        if (!match) continue;
        const ppid = Number(match[1]);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(Number(name));
      } catch {}
    }
  } catch {
    const root = processIdentity(rootPid);
    return root ? [root] : [];
  }
  const pids = [rootPid];
  for (let i = 0; i < pids.length; i++) {
    pids.push(...(children.get(pids[i]) || []));
  }
  return pids.map(processIdentity).filter(Boolean);
}

/**
 * Snapshot whether a pane still exists and the exact live process identities
 * reachable from it. `knownProcesses` keeps descendants observable after the
 * pane root exits and they are reparented; starttime distinguishes PID reuse.
 * This is read-only so an explicit user-targeted pane can remain open for
 * inspection while resume retries are safely blocked.
 */
async function paneProcessState(socket, paneId, { knownProcesses = [] } = {}) {
  const pid = await paneProcessId(socket, paneId);
  const paneStillExists = pid ? true : await paneExists(socket, paneId);
  const tracked = new Map();
  for (const process of [...knownProcesses, ...(pid ? processTree(pid) : [])]) {
    if (process?.pid && process?.startTime) tracked.set(`${process.pid}:${process.startTime}`, process);
  }
  return {
    paneExists: paneStillExists,
    knownProcesses: [...tracked.values()].filter(processIdentityAlive),
  };
}

/** Exact birth identity of the process currently anchoring a tmux pane. */
async function paneProcessIdentity(socket, paneId) {
  const pid = await paneProcessId(socket, paneId);
  return pid ? processIdentity(pid) : null;
}

/**
 * Kill a pane and wait until both tmux and the pane's captured process tree
 * agree it is gone. Hidden-session callers use this before launching an RPC
 * fallback: a fire-and-forget kill can otherwise leave two pi processes
 * writing one JSONL.
 */
async function killPaneAndWait(socket, paneId, { timeout = 5000, knownProcesses = [] } = {}) {
  const pid = await paneProcessId(socket, paneId);
  const paneStillExists = pid ? true : await paneExists(socket, paneId);
  if (!pid && paneStillExists) {
    const err = new Error(`could not identify process for tmux pane ${paneId}`);
    err.remainingProcesses = knownProcesses.filter(processIdentityAlive);
    throw err;
  }
  // Capture descendants before tmux closes the pane and reparents them. A
  // PI_DISH_PI_COMMAND wrapper can be the pane root while its child is the
  // actual JSONL writer; fallback is unsafe until every exact (pid,starttime)
  // identity has exited. Starttime prevents PID reuse from blocking forever.
  const tracked = new Map();
  for (const process of [...knownProcesses, ...(pid ? processTree(pid) : [])]) {
    if (process?.pid && process?.startTime) tracked.set(`${process.pid}:${process.startTime}`, process);
  }
  const processesStillAlive = () => [...tracked.values()].filter(processIdentityAlive);

  if (pid) {
    try {
      await killPane(socket, paneId);
    } catch (e) {
      // The pane can exit between the pid query and kill-pane. Treat that as a
      // successful cleanup only after the same liveness checks below pass.
      const remainingProcesses = processesStillAlive();
      if (await paneExists(socket, paneId) || remainingProcesses.length) {
        e.remainingProcesses = remainingProcesses;
        throw e;
      }
      return;
    }
  }

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!await paneExists(socket, paneId) && !processesStillAlive().length) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const paneRemains = await paneExists(socket, paneId);
  const liveProcesses = processesStillAlive();
  const ids = liveProcesses.map((process) => `${process.pid}@${process.startTime}`);
  const err = new Error(`tmux pane ${paneId} cleanup did not complete (${paneRemains ? 'pane still exists' : 'pane gone'}, ${ids.length ? `processes still alive: ${ids.join(', ')}` : 'processes gone'})`);
  err.remainingProcesses = liveProcesses;
  throw err;
}

/**
 * Human-facing location of a pane: { tmuxSession, windowIndex, windowName }.
 * Null when the pane (or its server) is gone. ':' separator per listServers —
 * window names *can* contain ':', so only the first two splits are fields.
 */
async function paneLocation(socket, paneId) {
  if (!socket || !paneId) return null;
  try {
    const out = await runTmux(
      ['-S', socket, 'display-message', '-p', '-t', paneId, '#{session_name}:#{window_index}:#{window_name}'],
      { timeout: 2000 },
    );
    const parts = out.trim().split(':');
    // A gone pane doesn't always error: some tmux versions print the format
    // with every field empty and exit 0. Session names can't be empty, so an
    // empty first field means the pane wasn't found.
    if (parts.length < 3 || !parts[0]) return null;
    return {
      tmuxSession: parts[0],
      windowIndex: Number(parts[1]),
      windowName: parts.slice(2).join(':'),
    };
  } catch {
    return null;
  }
}

/**
 * Locate the pane containing `pid`, scanning every live tmux server under
 * the tmpdir. The registered pi process is usually a descendant of the
 * pane's root process (shell → wrapper → pi), so pid's ancestry is walked
 * up (bounded) until it hits a pane_pid. Backstop for registry entries
 * without a tmux stamp — a pi that was registered by an older bridge, or
 * whose stamped pane has since gone stale, still gets located.
 * Returns { socket, paneId, tmuxSession, windowIndex, windowName } or null.
 */
async function findPaneByPid(pid) {
  if (!pid || !isTmuxAvailable()) return null;
  const dir = tmuxTmpdir();
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const byPanePid = new Map();
  for (const name of names) {
    const socket = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(socket); } catch { continue; }
    if (!stat.isSocket()) continue;
    let out;
    try {
      out = await runTmux(
        ['-S', socket, 'list-panes', '-a', '-F', '#{pane_pid}:#{pane_id}:#{session_name}:#{window_index}:#{window_name}'],
        { timeout: 2000 },
      );
    } catch {
      continue; // stale socket / dead server
    }
    for (const line of out.split('\n')) {
      if (!line) continue;
      const parts = line.split(':');
      if (parts.length < 5) continue;
      byPanePid.set(Number(parts[0]), {
        socket,
        paneId: parts[1],
        tmuxSession: parts[2],
        windowIndex: Number(parts[3]),
        windowName: parts.slice(4).join(':'), // window names can contain ':'
      });
    }
  }
  if (!byPanePid.size) return null;
  let p = Number(pid);
  for (let hops = 0; hops < 20 && Number.isFinite(p) && p > 1; hops++) {
    const pane = byPanePid.get(p);
    if (pane) return pane;
    p = parentPid(p);
  }
  return null;
}

// PPid via /proc (instant, and this codebase only targets Linux); ps as the
// just-in-case fallback. 0 = walk ends.
function parentPid(pid) {
  try {
    const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s*(\d+)/m);
    if (m) return Number(m[1]);
  } catch {}
  try {
    return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim()) || 0;
  } catch {
    return 0;
  }
}

async function paneExists(socket, paneId) {
  if (!socket || !paneId) return false;
  try {
    const out = await runTmux(
      ['-S', socket, 'display-message', '-p', '-t', paneId, '#{pane_id}'],
      { timeout: 2000 },
    );
    // Some tmux versions exit 0 for a missing target but expand fields tied to
    // that target to an empty string. A constant format (formerly "ok")
    // therefore reported stale panes as live and blocked fallback/pruning.
    return !!out.trim();
  } catch {
    return false;
  }
}

/**
 * Argv for a PTY client that views `paneId` in its own *grouped* tmux
 * session. A plain `attach` would share window focus with the user's real
 * client — switching windows on the phone would flip the desktop too — so
 * the viewer gets a throwaway session in the target session's group
 * (independent current window, same windows), destroyed when it detaches,
 * with the pi window/pane selected. Null when the pane is gone.
 */
async function attachPaneArgv(socket, paneId) {
  const loc = await paneLocation(socket, paneId);
  if (!loc) return null;
  const view = `dish-view-${Math.random().toString(36).slice(2, 8)}`;
  return [
    'tmux', '-S', socket, 'new-session', '-t', `=${loc.tmuxSession}`, '-s', view, ';',
    'set-option', 'destroy-unattached', 'on', ';',
    'select-window', '-t', paneId, ';',
    'select-pane', '-t', paneId,
  ];
}

/** The server's prefix key ("C-b", "C-a", …), null when it can't be read. */
async function getPrefixKey(socket) {
  try {
    const out = await runTmux(['-S', socket, 'show-options', '-g', 'prefix'], { timeout: 2000 });
    const m = out.trim().match(/^prefix\s+(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// --- Persisted spawn placements (~/.pi/dish/tmux-spawns.json) --------------

function spawnsFile() {
  return path.join(os.homedir(), '.pi', 'dish', 'tmux-spawns.json');
}

function readSpawns() {
  try {
    const data = JSON.parse(fs.readFileSync(spawnsFile(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeSpawns(spawns) {
  const file = spawnsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(spawns, null, 2));
  fs.renameSync(tmp, file);
}

function recordSpawn(sessionId, { socket, paneId, spawnToken, bridgeInstanceId, paneProcess, wrapperPath }) {
  const spawns = readSpawns();
  spawns[sessionId] = {
    socket,
    paneId,
    createdAt: Date.now(),
    ...(spawnToken ? { spawnToken } : {}),
    ...(bridgeInstanceId ? { bridgeInstanceId } : {}),
    ...(paneProcess?.pid && paneProcess?.startTime ? { paneProcess } : {}),
    ...(wrapperPath ? { wrapperPath } : {}),
  };
  writeSpawns(spawns);
}

function getSpawn(sessionId) {
  return readSpawns()[sessionId] || null;
}

function sameSpawnRecord(left, right) {
  return !!left && !!right
    && left.socket === right.socket
    && left.paneId === right.paneId
    && left.createdAt === right.createdAt
    && (left.spawnToken || null) === (right.spawnToken || null)
    && (left.bridgeInstanceId || null) === (right.bridgeInstanceId || null)
    && (left.paneProcess?.pid || null) === (right.paneProcess?.pid || null)
    && (left.paneProcess?.startTime || null) === (right.paneProcess?.startTime || null);
}

function removeSpawn(sessionId, expected = null) {
  const spawns = readSpawns();
  if (!Object.prototype.hasOwnProperty.call(spawns, sessionId)) return false;
  if (expected && !sameSpawnRecord(spawns[sessionId], expected)) return false;
  delete spawns[sessionId];
  writeSpawns(spawns);
  return true;
}

/** Move one exact owned-pane placement when its live bridge adopts a new session. */
function rekeySpawn(previousSessionId, sessionId, expected = null) {
  if (!previousSessionId || !sessionId) return false;
  if (previousSessionId === sessionId) return !!getSpawn(sessionId);
  const spawns = readSpawns();
  const current = spawns[previousSessionId];
  if (!current || (expected && !sameSpawnRecord(current, expected))) return false;
  spawns[sessionId] = current;
  delete spawns[previousSessionId];
  writeSpawns(spawns);
  return true;
}

/**
 * Drop mappings whose pane is gone AND whose session isn't registered.
 * `registeredIds` is a Set of currently-registered session ids. Async because
 * it probes tmux for pane liveness. Returns the pruned map.
 */
async function pruneSpawns(registeredIds = new Set()) {
  const dead = [];
  for (const [id, entry] of Object.entries(readSpawns())) {
    if (registeredIds.has(id)) continue;
    if (await paneExists(entry.socket, entry.paneId)) continue;
    dead.push([id, entry]);
  }
  // Re-read before writing: the pane probes above yield the event loop, and a
  // concurrent recordSpawn must not be clobbered by a stale map.
  const spawns = readSpawns();
  if (dead.length) {
    for (const [id, inspected] of dead) {
      if (sameSpawnRecord(spawns[id], inspected)) delete spawns[id];
    }
    writeSpawns(spawns);
  }
  return spawns;
}

module.exports = {
  isTmuxAvailable,
  tmuxTmpdir,
  listServers,
  isSocketAllowed,
  spawnInTmux,
  renameWindow,
  sendKeys,
  hasSession,
  killPane,
  killPaneAndWait,
  paneProcessState,
  paneProcessIdentity,
  paneExists,
  paneLocation,
  findPaneByPid,
  attachPaneArgv,
  getPrefixKey,
  recordSpawn,
  getSpawn,
  rekeySpawn,
  removeSpawn,
  pruneSpawns,
};
