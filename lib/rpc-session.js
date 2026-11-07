// Generated from src/core/rpc-session.ts; edit that source and run npm run build:core.
"use strict";
/** `pi --mode rpc` sessions. Framing is LF-only, never readline's. */
const child_process_1 = require("child_process");
const events_1 = require("events");
const url_1 = require("url");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dish_store_1 = require("./dish-store");
const line_splitter_1 = require("./line-splitter");
const pending_requests_1 = require("./pending-requests");
const wire_protocol_1 = require("./wire-protocol");
const helper_values_1 = require("./helper-values");
const http_boundary_1 = require("./http-boundary");
const running_tool_calls_1 = require("./running-tool-calls");
const extension_ui_state_1 = require("./extension-ui-state");
const session_discovery_1 = require("./session-discovery");
const process_identity_1 = require("./process-identity");
const session_recovery_1 = require("./session-recovery");
const transport_session_1 = require("./transport-session");
const session_key_1 = require("./session-key");
const harness_launch_spec_1 = require("./harness-launch-spec");
class RPCIdentityError extends TypeError {
}
function validatedNativeId(value) {
    if (!(0, session_key_1.validSessionId)(value))
        throw new RPCIdentityError('Invalid RPC session identity');
    return value;
}
function errorCode(error) { return (0, helper_values_1.record)(error) ? error.code : undefined; }
class RPCSession extends transport_session_1.TransportSession {
    constructor(id, proc) {
        super();
        this.id = id;
        this.proc = proc;
        this.alive = true;
        this.pending = new pending_requests_1.PendingRequests();
        this.nextRequestId = 1;
        this.state = null;
        this.sessionFile = null;
        this.cwd = null;
        this.stderrTail = [];
        this.recoveryBridgeOwned = false;
        this.recoveryInstanceId = crypto.randomUUID();
        this.recoveryStartTime = (0, process_identity_1.processIdentity)(proc.pid)?.startTime ?? null;
        this.recoveryObserver = (0, session_recovery_1.createSessionObserver)({
            waitsForSettled: true,
            canWrite: () => this._canObserveRecovery(),
            snapshot: () => {
                const model = (0, wire_protocol_1.asRecord)(this.state?.model);
                return this.sessionFile && this.cwd ? {
                    harnessId: 'pi', nativeSessionId: this.id, sessionFile: this.sessionFile, cwd: this.cwd,
                    name: this.state?.sessionName ?? this.state?.name ?? null,
                    model: typeof model.provider === 'string' && model.provider && typeof model.id === 'string' && model.id
                        ? `${model.provider}/${model.id}` : null,
                    thinkingLevel: this.state?.thinkingLevel ?? null,
                    pid: this.proc.pid, startTime: this.recoveryStartTime, instanceId: this.recoveryInstanceId,
                } : null;
            },
        });
        // pi can die before 'exit' flips this.alive; swallow broken-pipe errors so
        // they don't crash the server. The 'exit' handler rejects pending requests.
        proc.stdin.on('error', () => { });
        proc.stdout.on('error', () => { });
        proc.stderr.on('error', () => { });
        // A throwing event listener must not escape the stdout emit and crash the server.
        proc.stdout.on('data', (0, line_splitter_1.createJsonLineSplitter)((message) => {
            try {
                this._handleMessage(message);
            }
            catch (error) {
                console.error(`[rpc] event handler failed: ${(0, http_boundary_1.errorMessage)(error)}`);
            }
        }));
        proc.on('exit', (code) => {
            this.recoveryObserver.event('shutdown');
            this.recoveryObserver.dispose();
            this.alive = false;
            const err = new Error(`pi exited with code ${code}${this.stderrTail.length ? ': ' + this.stderrTail.join(' | ') : ''}`);
            this.pending.failAll(err);
            this.emitEvent('exit', { code });
        });
        proc.stderr.on('data', (data) => {
            const text = data.toString().trim();
            if (!text)
                return;
            for (const line of text.split('\n')) {
                this.stderrTail.push(line);
                if (this.stderrTail.length > 5)
                    this.stderrTail.shift();
            }
            console.error(`[rpc:${String(this.id).slice(0, 8)}] ${text}`);
        });
    }
    _canObserveRecovery() {
        if (this.recoveryBridgeOwned || !this.sessionFile)
            return false;
        const dir = path.join((0, dish_store_1.dishDir)(), 'sessions');
        let entries;
        try {
            entries = fs.readdirSync(dir);
        }
        catch (error) {
            if (errorCode(error) === 'ENOENT')
                return true;
            throw error; // unreadable ownership evidence is not permission to write
        }
        for (const name of entries) {
            if (!name.endsWith('.json'))
                continue;
            let claim;
            try {
                claim = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
            }
            catch {
                continue;
            }
            // A null ownership record stays fail-closed.
            if (claim === null)
                throw new TypeError('Invalid bridge recovery claim');
            if ((0, helper_values_1.record)(claim) && claim.recoveryObservation === true && claim.harnessId === 'pi'
                && claim.sessionFile === this.sessionFile && (0, process_identity_1.processIdentityAlive)({
                pid: Number(claim.pid), startTime: String(claim.startTime),
            })) {
                // Sticky for this process: bridge cleanup removes its registry before
                // child exit, which must not silently transfer ownership back to RPC.
                this.recoveryBridgeOwned = true;
                return false;
            }
        }
        return true;
    }
    _handleMessage(input) {
        const frame = (0, wire_protocol_1.decodeRPCFrame)(input);
        if (!frame)
            return;
        if (frame.kind === 'response') {
            const msg = frame.response;
            this.pending.settle(msg.id, msg.success, msg.data, msg.error ?? undefined, 'Command failed');
            return;
        }
        const msg = this.assistantFrame(frame.data);
        (0, running_tool_calls_1.trackRunningToolCalls)(this.runningToolCalls, frame.event, msg);
        this.recoveryObserver.event(frame.event, msg);
        if (msg.type === 'turn_start') {
            this.turnInProgress = true;
            this.lastActivityAt = new Date();
        }
        else if (msg.type === 'turn_end' || msg.type === 'agent_end') {
            this.turnInProgress = false;
            this.lastActivityAt = new Date();
            this._refreshStats();
        }
        else if (msg.type === 'message_end') {
            this.lastActivityAt = new Date();
        }
        else if (msg.type === 'compaction_start') {
            this.compacting = true;
        }
        else if (msg.type === 'compaction_end') {
            this.compacting = false;
        }
        (0, extension_ui_state_1.reduceExtensionUIState)(this.extUIState, frame.event, msg);
        this.emitEvent(frame.event, msg);
        this.endAssistantMessage(msg);
    }
    send(command, params = {}, { timeout = 30000 } = {}) {
        if (this.bounceExecuting && !command.startsWith('get_')) {
            return Promise.reject(new Error('A safe bulk operation is executing; wait for its result.'));
        }
        if (!this.alive)
            return Promise.reject(new Error('Session process not running'));
        const id = `req-${this.nextRequestId++}`;
        const promise = this.pending.track(id, { timeout, label: `RPC ${command}` });
        this.proc.stdin.write(JSON.stringify({ id, type: command, ...params }) + '\n');
        return promise;
    }
    /** Fire-and-forget write (extension_ui_response has no response). */
    write(obj) {
        if (!this.alive)
            throw new Error('Session process not running');
        this.proc.stdin.write(JSON.stringify(obj) + '\n');
    }
    async prompt(message, opts = {}) {
        return this.send('prompt', (0, transport_session_1.promptParams)(message, opts, this.turnInProgress), { timeout: 120000 });
    }
    async steer(message, opts = {}) {
        const params = { message };
        if (opts.images?.length)
            params.images = opts.images;
        return this.send('steer', params);
    }
    // The session list reads state.model/state.sessionName, so setters patch it too.
    async setModel(provider, modelId) {
        const model = await this.send('set_model', { provider, modelId });
        if (model)
            this.state = { ...(this.state || {}), model };
        this.recoveryObserver.event('metadata');
        return model;
    }
    async setName(name) {
        const result = await this.send('set_session_name', { name });
        this.state = { ...(this.state || {}), sessionName: name, name };
        this.recoveryObserver.event('metadata');
        return result;
    }
    async getAvailableModels() { return this.send('get_available_models'); }
    async getSessionStats() { return this.send('get_session_stats'); }
    async getCommands() { return this.send('get_commands'); }
    async compact(customInstructions) {
        return this.send('compact', customInstructions ? { customInstructions } : {}, { timeout: 300000 });
    }
    async abort() { return this.send('abort'); }
    async setThinkingLevel(level) {
        const result = await this.send('set_thinking_level', { level });
        this.state = { ...(this.state || {}), thinkingLevel: level };
        this.recoveryObserver.event('metadata');
        return result;
    }
    async newSession() { return this.send('new_session'); }
    async exportHtml(outputPath) { return this.send('export_html', outputPath ? { outputPath } : {}); }
    respondExtensionUI(requestId, response) {
        this.write({ type: 'extension_ui_response', id: requestId, ...response });
    }
    kill() {
        if (this.alive) {
            this.proc.kill('SIGTERM');
        }
    }
}
const rpcSessions = new Map();
/** Poll get_state until pi answers rather than sleeping for a fixed guess. */
async function _initRPCSession(proc, opts = {}) {
    const tempId = validatedNativeId(`rpc-${Date.now()}`);
    const session = new RPCSession(tempId, proc);
    session.cwd = opts.cwd || null;
    const spawnError = new Promise((_, reject) => {
        proc.on('error', reject); // e.g. ENOENT: pi not on PATH
    });
    // The 'error' listener stays attached for the process lifetime, so this can
    // reject after startup; an unhandled late rejection would kill the server.
    spawnError.catch(() => { });
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
            if (!(0, helper_values_1.record)(state))
                throw new TypeError('Invalid RPC get_state response');
            if (state.sessionFile != null && typeof state.sessionFile !== 'string') {
                throw new TypeError('Invalid RPC session file');
            }
            const sessionFile = state.sessionFile || null;
            // Id = session file basename, matching the bridge registry so a bridged
            // pi isn't listed twice; generic session.jsonl uses the Pi header id.
            const basenameId = sessionFile ? path.basename(sessionFile, '.jsonl') : null;
            const headerId = (0, session_discovery_1.safeHeaderSessionId)(state?.sessionId);
            const realId = validatedNativeId(basenameId === 'session' && headerId
                ? headerId : (basenameId || headerId || tempId));
            session.id = realId;
            session.state = state;
            session.sessionFile = sessionFile || null;
            session.compacting = !!state?.isCompacting;
            session.recoveryObserver.initialize();
            rpcSessions.set(realId, session);
            // Only evict if still ours: duplicates share the basename id.
            session.on('exit', () => { if (rpcSessions.get(realId) === session)
                rpcSessions.delete(realId); });
            session._refreshStats();
            return session;
        }
        catch (e) {
            lastError = e;
            // A route-id failure is permanent; break to the common kill path.
            if (e instanceof RPCIdentityError)
                break;
            if (errorCode(e) === 'ENOENT')
                throw new Error(`failed to spawn pi: ${(0, http_boundary_1.errorMessage)(e)}`);
            await new Promise(r => setTimeout(r, 500));
        }
    }
    session.kill();
    throw new Error(`pi RPC session did not become ready: ${lastError ? (0, http_boundary_1.errorMessage)(lastError) : 'timeout'}`);
}
function shellQuote(s) {
    return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
function spawnPi(args, cwd) {
    const spec = (0, harness_launch_spec_1.getPiLaunchSpec)();
    const env = { ...process.env, ...spec.env };
    const argv = spec.argv.length ? spec.argv : ['pi'];
    const shell = env.PI_DISH_PI_SHELL || env.SHELL;
    const shellName = shell ? path.basename(shell) : '';
    // Escape hatch for complex aliases/functions. Off by default because
    // interactive shell startup files often assume a TTY.
    if (env.PI_DISH_USE_PI_ALIAS === '1' && shell && ['zsh', 'bash'].includes(shellName)) {
        // Command word unquoted so the shell expands the `pi` alias; args stay quoted.
        const command = ['pi', ...args.map(shellQuote)].join(' ');
        // Native spawn owns cwd validation; no first-party coercion before it.
        return (0, child_process_1.spawn)(shell, ['-ic', command], { cwd: cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
    }
    // Native spawn does the argument coercion/rejection; saved selections are not validated here.
    return (0, child_process_1.spawn)(argv[0], [...argv.slice(1), ...args], {
        cwd: cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
    });
}
async function createRPCSession(opts = {}) {
    const args = ['--mode', 'rpc'];
    if (opts.model)
        args.push('--model', opts.model);
    if (opts.thinking)
        args.push('--thinking', opts.thinking);
    if (opts.sessionDir)
        args.push('--session-dir', opts.sessionDir);
    const cwd = opts.cwd || process.env.HOME;
    const proc = spawnPi(args, cwd);
    if (typeof cwd === 'string' || cwd === undefined)
        return _initRPCSession(proc, { cwd });
    // A failed native spawn has no pid; keep the initializer's native error path.
    if (proc.pid === undefined)
        return _initRPCSession(proc);
    let metadataCwd;
    try {
        // Byte-buffer cwd has no faithful decoding; never guess its metadata.
        if (!(cwd instanceof URL))
            throw new TypeError('Cannot faithfully represent native RPC cwd metadata');
        metadataCwd = (0, url_1.fileURLToPath)(cwd);
    }
    catch (error) {
        // No RPCSession owns this child yet; await its close so native errors take precedence.
        const closed = (0, events_1.once)(proc, 'close');
        proc.kill('SIGKILL');
        await closed;
        throw error;
    }
    return _initRPCSession(proc, { cwd: metadataCwd });
}
// Resume takes up to 20s before registering; dedupe so two resumes don't spawn two pis on one JSONL.
const resumingByPath = new Map();
async function resumeRPCSession(sessionPath, cwd) {
    const inFlight = resumingByPath.get(sessionPath);
    if (inFlight)
        return inFlight;
    const procCwd = cwd || process.env.HOME;
    const promise = _initRPCSession(spawnPi(['--mode', 'rpc', '--session', sessionPath], procCwd), { cwd: procCwd });
    resumingByPath.set(sessionPath, promise);
    try {
        return await promise;
    }
    finally {
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
    rpcSessions,
};
