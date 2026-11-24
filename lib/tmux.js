// Generated from src/core/tmux.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TmuxServerLostError = void 0;
exports.primeAgentPlacement = primeAgentPlacement;
exports.spawnPrimeAgent = spawnPrimeAgent;
exports.isNoServerError = isNoServerError;
exports.onHeadlessNoServer = onHeadlessNoServer;
exports.onHeadlessSpawn = onHeadlessSpawn;
exports.tmuxServerScopeArgv = tmuxServerScopeArgv;
exports.isTmuxAvailable = isTmuxAvailable;
exports.tmuxTmpdir = tmuxTmpdir;
exports.headlessTmuxSocket = headlessTmuxSocket;
exports.listServers = listServers;
exports.isSocketAllowed = isSocketAllowed;
exports.spawnInTmux = spawnInTmux;
exports.respawnPane = respawnPane;
exports.sendKeys = sendKeys;
exports.sendKey = sendKey;
exports.renameWindow = renameWindow;
exports.hasSession = hasSession;
exports.killPane = killPane;
exports.paneProcessState = paneProcessState;
exports.paneProcessIdentity = paneProcessIdentity;
exports.killPaneAndWait = killPaneAndWait;
exports.paneLocation = paneLocation;
exports.findPaneByPid = findPaneByPid;
exports.paneExists = paneExists;
exports.serverPid = serverPid;
exports.serverIdentity = serverIdentity;
exports.inspectServer = inspectServer;
exports.configureHeadlessServer = configureHeadlessServer;
exports.ensureHeadlessServer = ensureHeadlessServer;
exports.paneAttachedClients = paneAttachedClients;
exports.attachPaneArgv = attachPaneArgv;
exports.getPrefixKey = getPrefixKey;
exports.listSpawns = listSpawns;
exports.recordSpawn = recordSpawn;
exports.getSpawn = getSpawn;
exports.removeSpawn = removeSpawn;
exports.rekeySpawn = rekeySpawn;
exports.pruneSpawns = pruneSpawns;
/**
 * pi sessions in tmux windows survive a server restart (an RPC child would
 * not). Servers are addressed by their $TMUX_TMPDIR socket; every tmux call is
 * execFile with argv and a timeout, never a shell string.
 */
const child_process_1 = require("child_process");
const fs = require("fs");
const path = require("path");
const promises_1 = require("timers/promises");
const dish_store_1 = require("./dish-store");
const process_identity_1 = require("./process-identity");
const helper_values_1 = require("./helper-values");
/** Raised when a launch bound to a specific tmux server finds that server dead or replaced. */
class TmuxServerLostError extends Error {
    beforeSpawn;
    constructor(message, beforeSpawn = false) {
        super(message);
        this.beforeSpawn = beforeSpawn;
        this.name = 'TmuxServerLostError';
    }
}
exports.TmuxServerLostError = TmuxServerLostError;
/** Persisted evidence only: callers re-read the live roster before acting on it. */
function primeAgentPlacement(value) {
    if (!(0, helper_values_1.record)(value))
        return null;
    const { daemonSocket, activeSessionId, sessionFile, workerInstanceId } = value;
    if (typeof daemonSocket !== 'string' || !daemonSocket)
        return null;
    if (typeof activeSessionId !== 'string' || !activeSessionId)
        return null;
    if (typeof sessionFile !== 'string' || !path.isAbsolute(sessionFile))
        return null;
    if (workerInstanceId != null && typeof workerInstanceId !== 'string')
        return null;
    return { daemonSocket, activeSessionId, workerInstanceId: workerInstanceId || null, sessionFile };
}
function spawnPrimeAgent(spawn) {
    return spawn ? primeAgentPlacement(spawn.primeAgent) : null;
}
function cleanupError(error, remainingProcesses) {
    return Object.assign(error instanceof Error ? error : new Error(String(error)), { remainingProcesses });
}
function runFile(file, args, timeout, cwd) {
    return new Promise((resolve, reject) => {
        // No shell quoting: execFile owns argv coercion/rejection.
        (0, child_process_1.execFile)(file, args, { cwd, timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr;
                return reject(err);
            }
            resolve(stdout);
        });
    });
}
const NO_SERVER_RE = /no server running|no such file or directory|connection refused|error connecting to/i;
const noServerListeners = new Set();
const headlessSpawnListeners = new Set();
/** True when tmux rejected a command because no server listens on the target socket. */
function isNoServerError(error) {
    if (!(0, helper_values_1.record)(error))
        return false;
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    const message = typeof error.message === 'string' ? error.message : '';
    return NO_SERVER_RE.test(stderr) || NO_SERVER_RE.test(message);
}
function isHeadlessSocket(socket) {
    return path.resolve(socket) === path.resolve(headlessTmuxSocket());
}
function notifyHeadlessNoServer(socket) {
    if (!noServerListeners.size || !isHeadlessSocket(socket))
        return;
    queueMicrotask(() => {
        for (const listener of [...noServerListeners]) {
            try {
                listener(socket);
            }
            catch { }
        }
    });
}
function notifyHeadlessSpawn(sessionId, socket) {
    if (!headlessSpawnListeners.size || !isHeadlessSocket(socket))
        return;
    queueMicrotask(() => {
        for (const listener of [...headlessSpawnListeners]) {
            try {
                listener(sessionId, socket);
            }
            catch { }
        }
    });
}
/** Fires when a tmux command against pi-dish's headless socket fails with no server running. */
function onHeadlessNoServer(listener) {
    noServerListeners.add(listener);
    return () => { noServerListeners.delete(listener); };
}
/** Fires after a spawn placement is recorded on pi-dish's headless socket. */
function onHeadlessSpawn(listener) {
    headlessSpawnListeners.add(listener);
    return () => { headlessSpawnListeners.delete(listener); };
}
function runTmux(args, { timeout = 3000 } = {}) {
    return runFile('tmux', args, timeout);
}
/** Every command names one server socket; the format/query calls share one timeout. */
async function runTmuxOn(socket, args, { notifyNoServer = true } = {}) {
    try {
        return await runTmux(['-S', socket, ...args], { timeout: 2000 });
    }
    catch (error) {
        if (notifyNoServer && isNoServerError(error))
            notifyHeadlessNoServer(socket);
        throw error;
    }
}
async function tmuxServerRunning(socket) {
    return (await serverPid(socket)) !== null;
}
function executableOnPath(name, searchPath) {
    for (const dir of (searchPath || '').split(path.delimiter)) {
        if (!dir)
            continue;
        const candidate = path.join(dir, name);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        }
        catch { }
    }
    return null;
}
/**
 * Argv prefix that starts the tmux server for `socket` in its own transient
 * user scope. A tmux server stays in the cgroup of whatever started it, and
 * tmux puts each pane in a scope PartOf= that unit; started from a pi-dish
 * pane, agent panes would stop whenever pi-dish.service stops. Null - start
 * tmux directly - without a reachable user systemd manager, without
 * systemd-run, or with PI_DISH_TMUX_SCOPE=0.
 */
function tmuxServerScopeArgv(socket, env = process.env) {
    if (env.PI_DISH_TMUX_SCOPE === '0' || !env.XDG_RUNTIME_DIR)
        return null;
    try {
        if (!fs.statSync(path.join(env.XDG_RUNTIME_DIR, 'systemd', 'private')).isSocket())
            return null;
    }
    catch {
        return null;
    }
    const systemdRun = executableOnPath('systemd-run', env.PATH);
    if (!systemdRun)
        return null;
    const label = path.basename(socket).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'server';
    const unit = `pi-dish-tmux-${label}-${process.pid}-${Date.now().toString(36)}.scope`;
    return [systemdRun, '--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', 'tmux'];
}
/**
 * pi-dish's own agent server reads no tmux.conf: plugins such as
 * tmux-resurrect/continuum would restore the user's layout into it and can
 * overwrite the first agent pane. Instead it sets what agent panes and the
 * terminal viewer rely on; -q skips options an older tmux lacks.
 */
const HEADLESS_SERVER_OPTIONS = [
    // Viewer scrollback; a pane takes the limit in force when it is created.
    ['set-option', '-gq', 'history-limit', '50000'],
    // The wheel scrolls tmux instead of reaching the TUI as arrow keys.
    ['set-option', '-gq', 'mouse', 'on'],
    ['set-option', '-gq', 'status', 'on'],
    // Esc reaches the TUI promptly; tmux before 3.5 waits 500 ms.
    ['set-option', '-sq', 'escape-time', '10'],
    ['set-option', '-gq', 'default-terminal', 'tmux-256color'],
    // Truecolor and modified keys (Shift+Enter) through xterm-like viewers.
    ['set-option', '-saq', 'terminal-features', 'xterm*:RGB:extkeys'],
    ['set-option', '-sq', 'extended-keys', 'on'],
    ['set-option', '-sq', 'extended-keys-format', 'csi-u'],
    ['set-option', '-gq', 'focus-events', 'on'],
    // Keep pi-dish's server alive when its last session exits on its own so a
    // single exited session is never confused with the whole server dying.
    ['set-option', '-sq', 'exit-empty', 'off'],
];
/**
 * Run tmux `command` on `socket`, which may start its server. Only the cold
 * path below creates a server: in its own scope, and for pi-dish's server
 * without the user's tmux.conf.
 */
async function runTmuxStartingServer(socket, command, timeout) {
    const own = path.resolve(socket) === path.resolve(headlessTmuxSocket());
    const target = ['-S', socket, ...(own ? ['-f', '/dev/null'] : [])];
    if (await tmuxServerRunning(socket)) {
        // -N: a server that died since the check must not be replaced here.
        try {
            return await runFile('tmux', ['-N', ...target, ...command], timeout, '/');
        }
        catch (error) {
            if (isNoServerError(error))
                notifyHeadlessNoServer(socket);
            if (await tmuxServerRunning(socket))
                throw error;
        }
    }
    const args = [...target, ...(own ? HEADLESS_SERVER_OPTIONS.flatMap(option => [...option, ';']) : []), ...command];
    const scope = tmuxServerScopeArgv(socket);
    // tmux keeps its launching client's cwd for the lifetime of the server.
    // A staged update can unlink pi-dish's cwd; -c sets the pane cwd, not the server's.
    if (scope) {
        try {
            return await runFile(scope[0], [...scope.slice(1), ...args], timeout, '/');
        }
        catch (error) {
            // A running server means tmux itself ran and failed. Otherwise the scope
            // could not be created (bus refused, policy): start tmux unscoped.
            if (await tmuxServerRunning(socket))
                throw error;
            console.error(`tmux: no systemd scope for ${socket}, starting the server unscoped:`, error instanceof Error ? error.message : error);
        }
    }
    return runFile('tmux', args, timeout, '/');
}
let tmuxAvailable = null;
function isTmuxAvailable() {
    if (tmuxAvailable !== null)
        return tmuxAvailable;
    try {
        (0, child_process_1.execFileSync)('tmux', ['-V'], { stdio: 'ignore', timeout: 2000 });
        tmuxAvailable = true;
    }
    catch {
        tmuxAvailable = false;
    }
    return tmuxAvailable;
}
function tmuxTmpdir() {
    if (process.env.TMUX_TMPDIR)
        return process.env.TMUX_TMPDIR;
    const uid = typeof process.getuid === 'function' ? process.getuid() : '';
    return `/tmp/tmux-${uid}`;
}
/** pi-dish's own server for agents launched without a target. */
function headlessTmuxSocket() {
    return path.join(tmuxTmpdir(), 'pi-dish');
}
/** Candidate tmux server sockets under the tmpdir; stale socket files are left for tmux to reject. */
function socketPaths() {
    const dir = tmuxTmpdir();
    let names;
    try {
        names = fs.readdirSync(dir);
    }
    catch {
        return [];
    }
    return names.flatMap((name) => {
        const socket = path.join(dir, name);
        try {
            return fs.statSync(socket).isSocket() ? [{ socket, name }] : [];
        }
        catch {
            return [];
        }
    });
}
async function listServers() {
    if (!isTmuxAvailable())
        return [];
    const servers = [];
    for (const { socket, name } of socketPaths()) {
        let out;
        try {
            // ':' is the target-spec separator; unlike a tab, tmux does not sanitize it.
            out = await runTmuxOn(socket, ['list-sessions', '-F', '#{session_name}:#{session_windows}:#{session_attached}']);
        }
        catch {
            continue; // stale socket / dead server
        }
        const sessions = out.split('\n').filter(Boolean).map((line) => {
            const [sname, windows, attached] = line.split(':');
            return { name: sname, windows: Number(windows) || 0, attached: attached === '1' };
        });
        servers.push({ socket, name, sessions });
    }
    return servers;
}
// A LAN client must not pass an arbitrary -S path: allow only the directory
// listServers enumerates. The caller checks this before launching.
function isSocketAllowed(socket) {
    if (typeof socket !== 'string' || !socket)
        return false;
    return path.dirname(path.resolve(socket)) === path.resolve(tmuxTmpdir());
}
function sameServerIdentity(left, right) {
    return !!left && left.pid === right.pid && String(left.startTime) === String(right.startTime);
}
/** Open a detached window or session with child argv and tmux -e KEY=VALUE flags. */
async function spawnInTmux({ socket, tmuxSession, newTmuxSessionName, windowName, cwd, command, env, expectedServer = null }) {
    if (!Array.isArray(command) || !command.length)
        throw new Error('command argv required');
    const envFlags = [];
    for (const [k, v] of Object.entries(env || {}))
        envFlags.push('-e', `${k}=${v}`);
    let args;
    if (newTmuxSessionName) {
        args = ['new-session', '-d', '-s', newTmuxSessionName];
        if (windowName)
            args.push('-n', windowName);
    }
    else if (tmuxSession) {
        // Do not steal the current window from an attached user.
        args = ['new-window', '-d', '-t', tmuxSession];
        if (windowName)
            args.push('-n', windowName);
    }
    else {
        throw new Error('tmuxSession or newTmuxSessionName required');
    }
    if (newTmuxSessionName)
        args.push('-c', path.resolve(String(cwd || '.')));
    else if (cwd)
        args.push('-c', cwd);
    args.push(...envFlags, '-P', '-F', '#{pane_id}', '--', ...command);
    if (expectedServer) {
        const current = await serverIdentity(socket);
        if (!sameServerIdentity(current, expectedServer)) {
            if (!current)
                notifyHeadlessNoServer(socket);
            throw new TmuxServerLostError(`expected tmux server pid ${expectedServer.pid} is no longer running`, true);
        }
        let out;
        try {
            // -N: a launch bound to one replacement server must never start a third server.
            out = await runFile('tmux', ['-N', '-S', socket, ...args], 5000, '/');
        }
        catch (error) {
            if (isNoServerError(error)) {
                notifyHeadlessNoServer(socket);
                throw new TmuxServerLostError(`expected tmux server pid ${expectedServer.pid} died before launch`, true);
            }
            if (!sameServerIdentity(await serverIdentity(socket), expectedServer)) {
                throw new TmuxServerLostError(`expected tmux server pid ${expectedServer.pid} died during launch`, true);
            }
            throw error;
        }
        const paneId = out.trim();
        const after = await serverIdentity(socket);
        if (!sameServerIdentity(after, expectedServer)) {
            if (after && paneId)
                await killPane(socket, paneId).catch(() => { });
            if (!after)
                notifyHeadlessNoServer(socket);
            throw new TmuxServerLostError(`expected tmux server pid ${expectedServer.pid} was lost during launch`, false);
        }
        return { paneId };
    }
    const out = newTmuxSessionName
        ? await runTmuxStartingServer(socket, args, 5000)
        : await runTmux(['-S', socket, ...args], { timeout: 5000 }).catch(error => {
            if (isNoServerError(error))
                notifyHeadlessNoServer(socket);
            throw error;
        });
    return { paneId: out.trim() };
}
/** Replace only the exact pane-root birth authorized by the caller. */
async function respawnPane({ socket, paneId, cwd, command, env, expectedProcess, beforeAction = null }) {
    if (!Array.isArray(command) || !command.length)
        throw new Error('command argv required');
    const current = await paneProcessIdentity(socket, paneId);
    if (!current || !expectedProcess
        || current.pid !== expectedProcess.pid
        || String(current.startTime) !== String(expectedProcess.startTime)) {
        throw new Error(`tmux pane ${paneId} process changed before restart`);
    }
    const args = ['-S', socket, 'respawn-pane', '-k', '-t', paneId];
    if (cwd)
        args.push('-c', cwd);
    for (const [key, value] of Object.entries(env || {}))
        args.push('-e', `${key}=${value}`);
    args.push('--', ...command);
    if (beforeAction) {
        const finalCheck = await beforeAction();
        finalCheck();
    }
    try {
        await runTmux(args, { timeout: 5000 });
    }
    catch (error) {
        if (isNoServerError(error))
            notifyHeadlessNoServer(socket);
        throw error;
    }
    return { paneId };
}
async function sendKeys(socket, paneId, text) {
    await runTmuxOn(socket, ['send-keys', '-t', paneId, text, 'Enter']);
}
// One chord, no Enter/literal flag: cannot land in a TUI's unsent composer draft.
async function sendKey(socket, paneId, key) {
    await runTmuxOn(socket, ['send-keys', '-t', paneId, key]);
}
async function renameWindow(socket, target, name) {
    if (!socket || !target || !name)
        return;
    const sanitized = String(name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
    if (!sanitized)
        return;
    const sessionSafe = sanitized.replace(/[.:\s]+/g, '-').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 48);
    try {
        await runTmuxOn(socket, ['rename-window', '-t', target, sanitized]);
        await runTmuxOn(socket, ['select-pane', '-t', target, '-T', sanitized]);
        if (sessionSafe) {
            await runTmuxOn(socket, ['rename-session', '-t', target, sessionSafe]).catch(() => { });
        }
    }
    catch { }
}
// '=' means exact session-name match, not tmux's ordinary prefix match.
async function hasSession(socket, name) {
    try {
        await runTmuxOn(socket, ['has-session', '-t', `=${name}`]);
        return true;
    }
    catch {
        return false;
    }
}
async function killPane(socket, paneId) {
    await runTmuxOn(socket, ['kill-pane', '-t', paneId]);
}
/** One formatted field of a pane; null when tmux cannot answer (missing pane, dead socket). */
async function paneField(socket, paneId, format) {
    if (!socket || !paneId)
        return null;
    try {
        const out = await runTmuxOn(socket, ['display-message', '-p', '-t', paneId, format]);
        return out.trim();
    }
    catch {
        return null;
    }
}
async function paneProcessId(socket, paneId) {
    const pid = Number(await paneField(socket, paneId, '#{pane_pid}'));
    return Number.isInteger(pid) && pid > 1 ? pid : null;
}
/** Pane anchor process (null when unreadable) and whether any pane answers at all. */
async function paneAnchor(socket, paneId) {
    const pid = await paneProcessId(socket, paneId);
    return { pid, exists: pid !== null || await paneExists(socket, paneId) };
}
/** The pane's process tree plus caller-known descendants, keyed by exact birth identity. */
function captureProcesses(pid, knownProcesses) {
    const tracked = new Map();
    for (const process of [...knownProcesses, ...(pid ? processTree(pid) : [])]) {
        if (process?.pid && process?.startTime)
            tracked.set(`${process.pid}:${process.startTime}`, process);
    }
    return tracked;
}
function processTree(rootPid) {
    const children = new Map();
    try {
        for (const name of fs.readdirSync('/proc')) {
            if (!/^\d+$/.test(name))
                continue;
            try {
                const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
                const match = status.match(/^PPid:\s*(\d+)/m);
                if (!match)
                    continue;
                const ppid = Number(match[1]);
                if (!children.has(ppid))
                    children.set(ppid, []);
                children.get(ppid).push(Number(name));
            }
            catch { }
        }
    }
    catch {
        const root = (0, process_identity_1.processIdentity)(rootPid);
        return root ? [root] : [];
    }
    const pids = [rootPid];
    for (let i = 0; i < pids.length; i++) {
        pids.push(...(children.get(pids[i]) || []));
    }
    return pids.map(process_identity_1.processIdentity).filter((identity) => identity !== null);
}
/**
 * Read-only snapshot. Keep known exact descendants observable after the root
 * exits and they are reparented; never mistake PID reuse for the old writer.
 */
async function paneProcessState(socket, paneId, { knownProcesses = [] } = {}) {
    const { pid, exists } = await paneAnchor(socket, paneId);
    return {
        paneExists: exists,
        knownProcesses: [...captureProcesses(pid, knownProcesses).values()].filter(process_identity_1.processIdentityAlive),
    };
}
async function paneProcessIdentity(socket, paneId) {
    const pid = await paneProcessId(socket, paneId);
    return pid ? (0, process_identity_1.processIdentity)(pid) : null;
}
/**
 * Kill the pane, then wait for both tmux and its captured process tree to exit.
 * Hidden-session fallback cannot leave two processes writing the same JSONL.
 */
async function killPaneAndWait(socket, paneId, { timeout = 5000, knownProcesses = [] } = {}) {
    const { pid, exists } = await paneAnchor(socket, paneId);
    if (!pid && exists) {
        throw cleanupError(new Error(`could not identify process for tmux pane ${paneId}`), knownProcesses.filter(process_identity_1.processIdentityAlive));
    }
    // Capture descendants before tmux closes the pane and reparents them. A
    // wrapper may be the root while its child is the actual JSONL writer.
    const tracked = captureProcesses(pid, knownProcesses);
    const processesStillAlive = () => [...tracked.values()].filter(process_identity_1.processIdentityAlive);
    if (pid) {
        try {
            await killPane(socket, paneId);
        }
        catch (error) {
            // A pane can exit between the query and kill; only the same liveness
            // checks below can establish successful cleanup after that error.
            const remainingProcesses = processesStillAlive();
            if (await paneExists(socket, paneId) || remainingProcesses.length) {
                throw cleanupError(error, remainingProcesses);
            }
            return;
        }
    }
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (!await paneExists(socket, paneId) && !processesStillAlive().length)
            return;
        await (0, promises_1.setTimeout)(100);
    }
    const paneRemains = await paneExists(socket, paneId);
    const liveProcesses = processesStillAlive();
    const ids = liveProcesses.map((process) => `${process.pid}@${process.startTime}`);
    const err = new Error(`tmux pane ${paneId} cleanup did not complete (${paneRemains ? 'pane still exists' : 'pane gone'}, ${ids.length ? `processes still alive: ${ids.join(', ')}` : 'processes gone'})`);
    throw cleanupError(err, liveProcesses);
}
/** Human-facing location, not process ownership. Window names can contain ':'. */
async function paneLocation(socket, paneId) {
    // Missing panes sometimes succeed with empty formatted fields.
    const out = await paneField(socket, paneId, '#{session_name}:#{window_index}:#{window_name}');
    if (out === null)
        return null;
    const parts = out.split(':');
    if (parts.length < 3 || !parts[0])
        return null;
    return {
        tmuxSession: parts[0],
        windowIndex: Number(parts[1]),
        windowName: parts.slice(2).join(':'),
    };
}
/**
 * Weak location backstop for old/stale registry stamps, not ownership proof.
 * Scan allowed sockets and walk at most 20 parents to find the containing pane.
 */
async function findPaneByPid(pid) {
    if (!pid || !isTmuxAvailable())
        return null;
    const byPanePid = new Map();
    for (const { socket } of socketPaths()) {
        let out;
        try {
            out = await runTmuxOn(socket, ['list-panes', '-a', '-F', '#{pane_pid}:#{pane_id}:#{session_name}:#{window_index}:#{window_name}']);
        }
        catch {
            continue; // stale socket / dead server
        }
        for (const line of out.split('\n')) {
            if (!line)
                continue;
            const parts = line.split(':');
            if (parts.length < 5)
                continue;
            byPanePid.set(Number(parts[0]), {
                socket,
                paneId: parts[1],
                tmuxSession: parts[2],
                windowIndex: Number(parts[3]),
                windowName: parts.slice(4).join(':'),
            });
        }
    }
    if (!byPanePid.size)
        return null;
    let p = Number(pid);
    for (let hops = 0; hops < 20 && Number.isFinite(p) && p > 1; hops++) {
        const pane = byPanePid.get(p);
        if (pane)
            return pane;
        p = parentPid(p);
    }
    return null;
}
// Linux /proc first, ps fallback. 0 ends the ancestry walk.
function parentPid(pid) {
    try {
        const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s*(\d+)/m);
        if (m)
            return Number(m[1]);
    }
    catch { }
    try {
        return Number((0, child_process_1.execFileSync)('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim()) || 0;
    }
    catch {
        return 0;
    }
}
async function paneExists(socket, paneId) {
    // Some tmux versions return success but empty fields for missing panes.
    return !!(await paneField(socket, paneId, '#{pane_id}'));
}
/** PID of the server answering on `socket`; null when none answers. Never starts a server. */
async function serverPid(socket) {
    try {
        const pid = Number((await runTmux(['-N', '-S', socket, 'display-message', '-p', '#{pid}'], { timeout: 2000 })).trim());
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
    catch {
        return null;
    }
}
/** Process identity of the server answering on `socket`; null when none answers. Never starts a server. */
async function serverIdentity(socket) {
    const pid = await serverPid(socket);
    return pid !== null ? (0, process_identity_1.processIdentity)(pid) : null;
}
/**
 * Single-command snapshot of a running tmux server and its panes. Uses -N so
 * it never starts a server; handles an empty server (exit-empty off) by
 * falling back to serverPid when list-panes reports "no current target".
 */
async function inspectServer(socket) {
    try {
        const out = await runTmux(['-N', '-S', socket, 'list-panes', '-a', '-F', '#{pid}\t#{pane_id}\t#{pane_pid}\t#{pane_dead}'], { timeout: 2000 });
        let pid = null;
        const panes = new Map();
        for (const line of out.split('\n')) {
            if (!line)
                continue;
            const [rawServerPid, paneId, rawPanePid, rawDead] = line.split('\t');
            const parsedServerPid = Number(rawServerPid);
            if (pid === null && Number.isInteger(parsedServerPid) && parsedServerPid > 0)
                pid = parsedServerPid;
            if (!paneId)
                continue;
            const parsedPanePid = Number(rawPanePid);
            const validPanePid = Number.isInteger(parsedPanePid) && parsedPanePid > 1 ? parsedPanePid : null;
            const dead = rawDead === '1';
            panes.set(paneId, {
                paneId,
                panePid: validPanePid,
                dead,
                paneProcess: !dead && validPanePid ? (0, process_identity_1.processIdentity)(validPanePid) : null,
            });
        }
        if (pid === null)
            pid = await serverPid(socket);
        const server = pid !== null ? (0, process_identity_1.processIdentity)(pid) : null;
        return server ? { pid: server.pid, server, panes } : null;
    }
    catch (error) {
        const stderr = (0, helper_values_1.record)(error) && typeof error.stderr === 'string' ? error.stderr : '';
        if (/no current target|no sessions/i.test(stderr)) {
            const pid = await serverPid(socket);
            const server = pid !== null ? (0, process_identity_1.processIdentity)(pid) : null;
            return server ? { pid: server.pid, server, panes: new Map() } : null;
        }
        return null;
    }
}
/** Applies exit-empty off to an already-running headless server without ever starting one. */
async function configureHeadlessServer(socket = headlessTmuxSocket()) {
    if (!isHeadlessSocket(socket))
        return false;
    try {
        await runTmux(['-N', '-S', socket, 'set-option', '-sq', 'exit-empty', 'off'], { timeout: 2000 });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Ensures pi-dish's headless tmux server is running using the same flags
 * (-f /dev/null, HEADLESS_SERVER_OPTIONS, transient systemd scope) as
 * spawnInTmux, and -N when a server is already running.
 */
async function ensureHeadlessServer(socket = headlessTmuxSocket()) {
    fs.mkdirSync(path.dirname(socket), { recursive: true, mode: 0o700 });
    await runTmuxStartingServer(socket, ['start-server'], 5000);
    return serverIdentity(socket);
}
/**
 * Clients attached to the pane's session, including grouped viewer sessions.
 * Null (unreadable) means "possibly watched", never "nobody is looking".
 */
async function paneAttachedClients(socket, paneId) {
    const out = await paneField(socket, paneId, '#{session_attached} #{session_group_attached}');
    if (out === null)
        return null;
    const counts = out.split(/\s+/).filter(Boolean).map(Number);
    if (!counts.length || counts.some(count => !Number.isInteger(count) || count < 0))
        return null;
    return Math.max(...counts);
}
/**
 * Viewers get a throwaway grouped session (own current window, destroyed on
 * detach) so the desktop client's focus is not stolen. -N: a viewer arriving
 * after the server died must not start a replacement that reads tmux.conf.
 */
async function attachPaneArgv(socket, paneId) {
    const loc = await paneLocation(socket, paneId);
    if (!loc)
        return null;
    const view = `dish-view-${Math.random().toString(36).slice(2, 8)}`;
    return [
        'tmux', '-N', '-S', socket, 'new-session', '-t', `=${loc.tmuxSession}`, '-s', view, ';',
        'set-option', 'destroy-unattached', 'on', ';',
        'select-window', '-t', paneId, ';',
        'select-pane', '-t', paneId,
    ];
}
async function getPrefixKey(socket) {
    try {
        const out = await runTmuxOn(socket, ['show-options', '-g', 'prefix']);
        const m = out.trim().match(/^prefix\s+(\S+)/);
        return m ? m[1] : null;
    }
    catch {
        return null;
    }
}
const SPAWNS_STORE = 'tmux-spawns.json';
function isPlacement(value) {
    return (0, helper_values_1.record)(value) && typeof value.socket === 'string' && typeof value.paneId === 'string';
}
/** Persisted placements by route id. Evidence only: callers re-read live state before acting. */
function listSpawns() {
    const out = {};
    for (const [sessionId, value] of Object.entries((0, dish_store_1.readStore)(SPAWNS_STORE))) {
        if (isPlacement(value))
            out[sessionId] = value;
    }
    return out;
}
function samePrimeAgentEvidence(left, right) {
    if (left == null && right == null)
        return true;
    const a = primeAgentPlacement(left), b = primeAgentPlacement(right);
    return !!a && !!b
        && a.daemonSocket === b.daemonSocket
        && a.activeSessionId === b.activeSessionId
        && a.workerInstanceId === b.workerInstanceId
        && a.sessionFile === b.sessionFile;
}
function recordSpawn(sessionId, { socket, paneId, spawnToken, bridgeInstanceId, paneProcess, wrapperPath, primeAgent }) {
    const spawns = (0, dish_store_1.readStore)(SPAWNS_STORE);
    spawns[sessionId] = {
        socket,
        paneId,
        createdAt: Date.now(),
        ...(spawnToken ? { spawnToken } : {}),
        ...(bridgeInstanceId ? { bridgeInstanceId } : {}),
        ...(paneProcess?.pid && paneProcess?.startTime ? { paneProcess } : {}),
        ...(wrapperPath ? { wrapperPath } : {}),
        ...(primeAgent ? { primeAgent } : {}),
    };
    (0, dish_store_1.writeStore)(SPAWNS_STORE, spawns);
    notifyHeadlessSpawn(sessionId, socket);
}
function getSpawn(sessionId) {
    const value = (0, dish_store_1.readStore)(SPAWNS_STORE)[sessionId];
    return isPlacement(value) ? value : null;
}
function sameSpawnRecord(left, right) {
    if (!(0, helper_values_1.record)(left) || !(0, helper_values_1.record)(right))
        return false;
    const leftProcess = (0, helper_values_1.record)(left.paneProcess) ? left.paneProcess : null;
    const rightProcess = (0, helper_values_1.record)(right.paneProcess) ? right.paneProcess : null;
    return left.socket === right.socket
        && left.paneId === right.paneId
        && left.createdAt === right.createdAt
        && (left.spawnToken || null) === (right.spawnToken || null)
        && (left.bridgeInstanceId || null) === (right.bridgeInstanceId || null)
        && (leftProcess?.pid || null) === (rightProcess?.pid || null)
        && (leftProcess?.startTime || null) === (rightProcess?.startTime || null)
        && samePrimeAgentEvidence(left.primeAgent, right.primeAgent);
}
function removeSpawn(sessionId, expected = null) {
    const spawns = (0, dish_store_1.readStore)(SPAWNS_STORE);
    if (!Object.prototype.hasOwnProperty.call(spawns, sessionId))
        return false;
    if (expected && !sameSpawnRecord(spawns[sessionId], expected))
        return false;
    delete spawns[sessionId];
    (0, dish_store_1.writeStore)(SPAWNS_STORE, spawns);
    return true;
}
/** Move one exact placement when its live bridge adopts a new session. */
function rekeySpawn(previousSessionId, sessionId, expected = null) {
    if (!previousSessionId || !sessionId)
        return false;
    if (previousSessionId === sessionId)
        return !!getSpawn(sessionId);
    const spawns = (0, dish_store_1.readStore)(SPAWNS_STORE);
    const current = spawns[previousSessionId];
    if (!current || (expected && !sameSpawnRecord(current, expected)))
        return false;
    spawns[sessionId] = current;
    delete spawns[previousSessionId];
    (0, dish_store_1.writeStore)(SPAWNS_STORE, spawns);
    return true;
}
/** Drop unregistered placements whose panes are gone, preserving concurrent writes. */
async function pruneSpawns(registeredIds = new Set()) {
    const dead = [];
    for (const [id, entry] of Object.entries((0, dish_store_1.readStore)(SPAWNS_STORE))) {
        if (registeredIds.has(id) || !(0, helper_values_1.record)(entry))
            continue;
        // Malformed placement fields cannot name a live pane; the record still
        // participates in the same compare-before-prune check after other probes.
        if (isPlacement(entry) && await paneExists(entry.socket, entry.paneId))
            continue;
        dead.push([id, entry]);
    }
    // Probes yield: re-read, then remove only the same inspected record.
    const spawns = (0, dish_store_1.readStore)(SPAWNS_STORE);
    if (dead.length) {
        for (const [id, inspected] of dead) {
            if (sameSpawnRecord(spawns[id], inspected))
                delete spawns[id];
        }
        (0, dish_store_1.writeStore)(SPAWNS_STORE, spawns);
    }
    return spawns;
}
