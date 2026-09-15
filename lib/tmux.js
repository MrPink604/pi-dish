// Generated from src/core/tmux.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTmuxAvailable = isTmuxAvailable;
exports.tmuxTmpdir = tmuxTmpdir;
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
exports.attachPaneArgv = attachPaneArgv;
exports.getPrefixKey = getPrefixKey;
exports.recordSpawn = recordSpawn;
exports.getSpawn = getSpawn;
exports.removeSpawn = removeSpawn;
exports.rekeySpawn = rekeySpawn;
exports.pruneSpawns = pruneSpawns;
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
 * The user may run several tmux servers, each a distinct socket under
 * $TMUX_TMPDIR (default /tmp/tmux-<uid>/). Every invocation uses execFile with
 * a short timeout and argv, never a shell string. Spawn placements persist
 * in ~/.pi/dish/tmux-spawns.json; HOME is resolved per call.
 */
const child_process_1 = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const promises_1 = require("timers/promises");
const process_identity_1 = require("./process-identity");
const helper_values_1 = require("./helper-values");
function cleanupError(error, remainingProcesses) {
    return Object.assign(error instanceof Error ? error : new Error(String(error)), { remainingProcesses });
}
function runTmux(args, { timeout = 3000 } = {}) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)('tmux', args, { timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr;
                return reject(err);
            }
            resolve(stdout);
        });
    });
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
/** Enumerate live socket servers under the tmux tmpdir, skipping stale sockets. */
async function listServers() {
    if (!isTmuxAvailable())
        return [];
    const dir = tmuxTmpdir();
    let names;
    try {
        names = fs.readdirSync(dir);
    }
    catch {
        return [];
    }
    const servers = [];
    for (const name of names) {
        const socket = path.join(dir, name);
        let stat;
        try {
            stat = fs.statSync(socket);
        }
        catch {
            continue;
        }
        if (!stat.isSocket())
            continue;
        let out;
        try {
            // ':' is the target-spec separator; unlike a tab, tmux does not sanitize it.
            out = await runTmux(['-S', socket, 'list-sessions', '-F', '#{session_name}:#{session_windows}:#{session_attached}'], { timeout: 2000 });
        }
        catch {
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
// A LAN client must not pass an arbitrary -S path: allow only the directory
// listServers enumerates. The caller checks this before launching.
function isSocketAllowed(socket) {
    if (typeof socket !== 'string' || !socket)
        return false;
    return path.dirname(path.resolve(socket)) === path.resolve(tmuxTmpdir());
}
/** Open a detached window or session with child argv and tmux -e KEY=VALUE flags. */
async function spawnInTmux({ socket, tmuxSession, newTmuxSessionName, windowName, cwd, command, env }) {
    if (!Array.isArray(command) || !command.length)
        throw new Error('command argv required');
    const envFlags = [];
    for (const [k, v] of Object.entries(env || {}))
        envFlags.push('-e', `${k}=${v}`);
    let args;
    if (newTmuxSessionName) {
        args = ['-S', socket, 'new-session', '-d', '-s', newTmuxSessionName];
        if (windowName)
            args.push('-n', windowName);
    }
    else if (tmuxSession) {
        // Do not steal the current window from an attached user.
        args = ['-S', socket, 'new-window', '-d', '-t', tmuxSession];
        if (windowName)
            args.push('-n', windowName);
    }
    else {
        throw new Error('tmuxSession or newTmuxSessionName required');
    }
    if (cwd)
        args.push('-c', cwd);
    args.push(...envFlags, '-P', '-F', '#{pane_id}', '--', ...command);
    const out = await runTmux(args, { timeout: 5000 });
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
    await runTmux(args, { timeout: 5000 });
    return { paneId };
}
async function sendKeys(socket, paneId, text) {
    await runTmux(['-S', socket, 'send-keys', '-t', paneId, text, 'Enter'], { timeout: 2000 });
}
// One chord, no Enter/literal flag: cannot land in a TUI's unsent composer draft.
async function sendKey(socket, paneId, key) {
    await runTmux(['-S', socket, 'send-keys', '-t', paneId, key], { timeout: 2000 });
}
async function renameWindow(socket, target, name) {
    if (!socket || !target || !name)
        return;
    const sanitized = String(name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
    if (!sanitized)
        return;
    const sessionSafe = sanitized.replace(/[.:\s]+/g, '-').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 48);
    try {
        await runTmux(['-S', socket, 'rename-window', '-t', target, sanitized], { timeout: 2000 });
        await runTmux(['-S', socket, 'select-pane', '-t', target, '-T', sanitized], { timeout: 2000 });
        if (sessionSafe) {
            await runTmux(['-S', socket, 'rename-session', '-t', target, sessionSafe], { timeout: 2000 }).catch(() => { });
        }
    }
    catch { }
}
// '=' means exact session-name match, not tmux's ordinary prefix match.
async function hasSession(socket, name) {
    try {
        await runTmux(['-S', socket, 'has-session', '-t', `=${name}`], { timeout: 2000 });
        return true;
    }
    catch {
        return false;
    }
}
async function killPane(socket, paneId) {
    await runTmux(['-S', socket, 'kill-pane', '-t', paneId], { timeout: 2000 });
}
async function paneProcessId(socket, paneId) {
    if (!socket || !paneId)
        return null;
    try {
        const out = await runTmux(['-S', socket, 'display-message', '-p', '-t', paneId, '#{pane_pid}'], { timeout: 2000 });
        const pid = Number(out.trim());
        return Number.isInteger(pid) && pid > 1 ? pid : null;
    }
    catch {
        return null;
    }
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
    const pid = await paneProcessId(socket, paneId);
    const paneStillExists = pid ? true : await paneExists(socket, paneId);
    const tracked = new Map();
    for (const process of [...knownProcesses, ...(pid ? processTree(pid) : [])]) {
        if (process?.pid && process?.startTime)
            tracked.set(`${process.pid}:${process.startTime}`, process);
    }
    return {
        paneExists: paneStillExists,
        knownProcesses: [...tracked.values()].filter(process_identity_1.processIdentityAlive),
    };
}
/** Exact birth identity of the process currently anchoring a tmux pane. */
async function paneProcessIdentity(socket, paneId) {
    const pid = await paneProcessId(socket, paneId);
    return pid ? (0, process_identity_1.processIdentity)(pid) : null;
}
/**
 * Kill the pane, then wait for both tmux and its captured process tree to exit.
 * Hidden-session fallback cannot leave two processes writing the same JSONL.
 */
async function killPaneAndWait(socket, paneId, { timeout = 5000, knownProcesses = [] } = {}) {
    const pid = await paneProcessId(socket, paneId);
    const paneStillExists = pid ? true : await paneExists(socket, paneId);
    if (!pid && paneStillExists) {
        throw cleanupError(new Error(`could not identify process for tmux pane ${paneId}`), knownProcesses.filter(process_identity_1.processIdentityAlive));
    }
    // Capture descendants before tmux closes the pane and reparents them. A
    // wrapper may be the root while its child is the actual JSONL writer.
    const tracked = new Map();
    for (const process of [...knownProcesses, ...(pid ? processTree(pid) : [])]) {
        if (process?.pid && process?.startTime)
            tracked.set(`${process.pid}:${process.startTime}`, process);
    }
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
    if (!socket || !paneId)
        return null;
    try {
        const out = await runTmux(['-S', socket, 'display-message', '-p', '-t', paneId, '#{session_name}:#{window_index}:#{window_name}'], { timeout: 2000 });
        const parts = out.trim().split(':');
        // Missing panes sometimes succeed with empty formatted fields.
        if (parts.length < 3 || !parts[0])
            return null;
        return {
            tmuxSession: parts[0],
            windowIndex: Number(parts[1]),
            windowName: parts.slice(2).join(':'),
        };
    }
    catch {
        return null;
    }
}
/**
 * Weak location backstop for old/stale registry stamps, not ownership proof.
 * Scan allowed sockets and walk at most 20 parents to find the containing pane.
 */
async function findPaneByPid(pid) {
    if (!pid || !isTmuxAvailable())
        return null;
    const dir = tmuxTmpdir();
    let names;
    try {
        names = fs.readdirSync(dir);
    }
    catch {
        return null;
    }
    const byPanePid = new Map();
    for (const name of names) {
        const socket = path.join(dir, name);
        let stat;
        try {
            stat = fs.statSync(socket);
        }
        catch {
            continue;
        }
        if (!stat.isSocket())
            continue;
        let out;
        try {
            out = await runTmux(['-S', socket, 'list-panes', '-a', '-F', '#{pane_pid}:#{pane_id}:#{session_name}:#{window_index}:#{window_name}'], { timeout: 2000 });
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
    if (!socket || !paneId)
        return false;
    try {
        const out = await runTmux(['-S', socket, 'display-message', '-p', '-t', paneId, '#{pane_id}'], { timeout: 2000 });
        // Some tmux versions return success but empty fields for missing panes.
        return !!out.trim();
    }
    catch {
        return false;
    }
}
/**
 * A viewer gets a throwaway grouped session: independent current window, same
 * windows, destroyed on detach, without stealing the desktop client's focus.
 */
async function attachPaneArgv(socket, paneId) {
    const loc = await paneLocation(socket, paneId);
    if (!loc)
        return null;
    const view = `dish-view-${Math.random().toString(36).slice(2, 8)}`;
    return [
        'tmux', '-S', socket, 'new-session', '-t', `=${loc.tmuxSession}`, '-s', view, ';',
        'set-option', 'destroy-unattached', 'on', ';',
        'select-window', '-t', paneId, ';',
        'select-pane', '-t', paneId,
    ];
}
/** Server prefix key, or null when unavailable. */
async function getPrefixKey(socket) {
    try {
        const out = await runTmux(['-S', socket, 'show-options', '-g', 'prefix'], { timeout: 2000 });
        const m = out.trim().match(/^prefix\s+(\S+)/);
        return m ? m[1] : null;
    }
    catch {
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
        return (0, helper_values_1.record)(data) ? data : {};
    }
    catch {
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
function isPlacement(value) {
    return (0, helper_values_1.record)(value) && typeof value.socket === 'string' && typeof value.paneId === 'string';
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
    const value = readSpawns()[sessionId];
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
        && (leftProcess?.startTime || null) === (rightProcess?.startTime || null);
}
function removeSpawn(sessionId, expected = null) {
    const spawns = readSpawns();
    if (!Object.prototype.hasOwnProperty.call(spawns, sessionId))
        return false;
    if (expected && !sameSpawnRecord(spawns[sessionId], expected))
        return false;
    delete spawns[sessionId];
    writeSpawns(spawns);
    return true;
}
/** Move one exact placement when its live bridge adopts a new session. */
function rekeySpawn(previousSessionId, sessionId, expected = null) {
    if (!previousSessionId || !sessionId)
        return false;
    if (previousSessionId === sessionId)
        return !!getSpawn(sessionId);
    const spawns = readSpawns();
    const current = spawns[previousSessionId];
    if (!current || (expected && !sameSpawnRecord(current, expected)))
        return false;
    spawns[sessionId] = current;
    delete spawns[previousSessionId];
    writeSpawns(spawns);
    return true;
}
/** Drop unregistered placements whose panes are gone, preserving concurrent writes. */
async function pruneSpawns(registeredIds = new Set()) {
    const dead = [];
    for (const [id, entry] of Object.entries(readSpawns())) {
        if (registeredIds.has(id))
            continue;
        if (!isPlacement(entry) || await paneExists(entry.socket, entry.paneId))
            continue;
        dead.push([id, entry]);
    }
    // Probes yield: re-read, then remove only the same inspected record.
    const spawns = readSpawns();
    if (dead.length) {
        for (const [id, inspected] of dead) {
            if (sameSpawnRecord(spawns[id], inspected))
                delete spawns[id];
        }
        writeSpawns(spawns);
    }
    return spawns;
}
