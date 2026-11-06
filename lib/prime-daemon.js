// Generated from src/core/prime-daemon.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrimeDaemon = exports.PrimeDaemonSession = exports.PrimeDaemonConnection = exports.PRIME_DAEMON_PROTOCOL = void 0;
exports.primeDaemonSocket = primeDaemonSocket;
exports.primeRootSummary = primeRootSummary;
exports.getPrimeDaemon = getPrimeDaemon;
exports.resetPrimeDaemon = resetPrimeDaemon;
/**
 * Prime Agent (Rust, 0.10+) transport: pi-dish is one more client of Prime's
 * resident daemon, exactly like `prime-agent attach`. Prime no longer loads
 * TypeScript extensions, so there is no in-process bridge; every live Prime
 * root agent is read from the daemon roster and controlled over the daemon's
 * Unix socket.
 *
 * Wire format (protocol `prime-agent.daemon` v7, LF-delimited JSON):
 *   server → `{type:'daemon_hello', protocol:{name,version}, …}` on connect
 *   client → `{type:'command', id, protocol, clientId, command:{type, id, …}}`
 *   server → `{type:'response', id, command, success, data?, error?}`
 *   server → `{type:'session_event', activeSessionId, event:{type,…}, meta}`
 *            for agents this connection has `attach`ed to.
 * Supervisor commands: list, attach, detach, kill. Session commands carry an
 * `activeSessionId` and use Pi-RPC names (prompt, steer, follow_up, abort,
 * get_state, compact, set_model, get_queue, mutate_queued_message, …).
 * Events are Pi-shaped agent events plus `session_action_update` (queue) and
 * `session_info_changed` (name).
 */
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const promises_1 = require("timers/promises");
const line_splitter_1 = require("./line-splitter");
const pending_requests_1 = require("./pending-requests");
const wire_protocol_1 = require("./wire-protocol");
const running_tool_calls_1 = require("./running-tool-calls");
const session_key_1 = require("./session-key");
const harnesses_1 = require("./harnesses");
const transport_session_1 = require("./transport-session");
exports.PRIME_DAEMON_PROTOCOL = Object.freeze({ name: 'prime-agent.daemon', version: 7 });
function text(value) { return typeof value === 'string' && value ? value : null; }
function strings(value) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []; }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
/**
 * The daemon socket Prime itself would use for this launch configuration:
 * an explicit `--daemon-socket` in PI_DISH_PRIME_COMMAND, then
 * PRIME_AGENT_DAEMON_SOCKET (command assignment, then server env), then the
 * per-user default the Rust launcher pins. Managed launches pass the result
 * explicitly so pi-dish always watches the daemon its own clients use.
 */
function primeDaemonSocket(env = process.env) {
    const descriptor = (0, harnesses_1.getHarness)('prime');
    const spec = descriptor ? (0, harnesses_1.resolveLaunchSpec)(descriptor, env) : { env: {}, argv: [] };
    const flag = spec.argv.indexOf('--daemon-socket');
    const explicit = flag >= 0 ? spec.argv[flag + 1] : spec.argv.find(word => word.startsWith('--daemon-socket='))?.slice('--daemon-socket='.length);
    const configured = explicit || spec.env.PRIME_AGENT_DAEMON_SOCKET || env.PRIME_AGENT_DAEMON_SOCKET;
    if (configured)
        return path.resolve(configured);
    const uid = typeof process.getuid === 'function' ? process.getuid() : os.userInfo().uid;
    return path.join(env.TMPDIR || '/tmp', `prime-agent-rust-${uid}`, 'daemon.sock');
}
function queueFrom(actions) {
    const value = (0, wire_protocol_1.asRecord)(actions);
    return { steering: strings(value.steering), followUp: strings(value.followUps ?? value.followUp) };
}
/** Root agents only: RLM children are discovered from their artifacts. */
function primeRootSummary(row) {
    if (!(0, wire_protocol_1.isRecord)(row))
        return null;
    const activeSessionId = text(row.activeSessionId);
    const nativeSessionId = row.sessionId;
    const sessionFile = text(row.sessionFile);
    if (!activeSessionId || !(0, session_key_1.validSessionId)(nativeSessionId) || !sessionFile || !path.isAbsolute(sessionFile))
        return null;
    if (row.runtimeKind === 'subagent' || row.parentActiveSessionId || row.parentSessionId || Number(row.rlmDepth) > 0)
        return null;
    const model = (0, wire_protocol_1.asRecord)(row.model);
    return {
        activeSessionId, nativeSessionId, sessionFile,
        cwd: text(row.cwd),
        lifecycle: text(row.lifecycle),
        isStreaming: row.isStreaming === true,
        isCompacting: row.isCompacting === true,
        workerPid: typeof row.workerPid === 'number' ? row.workerPid : null,
        workerInstanceId: text(row.workerInstanceId),
        attachedClients: typeof row.attachedClients === 'number' ? row.attachedClients : 0,
        sessionName: text(row.sessionName) ?? text(row.name),
        thinkingLevel: text(row.thinkingLevel),
        model: text(model.provider) && text(model.id) ? { provider: model.provider, id: model.id } : null,
        queue: queueFrom(row.sessionActions),
        lastActivityAt: text(row.lastActivityAt),
        created: text(row.created),
    };
}
class PrimeDaemonConnection {
    constructor(socketPath) {
        this.socketPath = socketPath;
        this.clientId = `pi-dish:${crypto.randomUUID()}`;
        this.hello = null;
        this.alive = false;
        this.sock = null;
        this.pending = new pending_requests_1.PendingRequests();
        this.eventHandlers = new Map();
        this.closeHandlers = new Set();
    }
    connect({ timeout = 5000 } = {}) {
        const hello = this.pending.track('__hello', { timeout, label: 'Prime daemon hello' });
        const sock = net.createConnection(this.socketPath);
        this.sock = sock;
        sock.on('error', error => this._closed(error));
        sock.on('close', () => this._closed(new Error('Prime daemon connection closed')));
        sock.on('data', (0, line_splitter_1.createJsonLineSplitter)(message => {
            if (message.type === 'daemon_hello') {
                const protocol = (0, wire_protocol_1.asRecord)(message.protocol);
                if (protocol.name !== exports.PRIME_DAEMON_PROTOCOL.name || protocol.version !== exports.PRIME_DAEMON_PROTOCOL.version) {
                    this.pending.settle('__hello', false, undefined, `Unsupported Prime daemon protocol ${String(protocol.name)} v${String(protocol.version)}; pi-dish speaks ${exports.PRIME_DAEMON_PROTOCOL.name} v${exports.PRIME_DAEMON_PROTOCOL.version}`);
                    this.close();
                    return;
                }
                this.hello = message;
                this.alive = true;
                this.pending.settle('__hello', true, message);
            }
            else if (message.type === 'response' && (typeof message.id === 'string' || typeof message.id === 'number')) {
                this.pending.settle(message.id, message.success === true, message.data, message.error ? String(message.error) : undefined, `Prime ${String(message.command || 'command')} failed`);
            }
            else if (message.type === 'session_event' && typeof message.activeSessionId === 'string' && (0, wire_protocol_1.isRecord)(message.event)) {
                this.eventHandlers.get(message.activeSessionId)?.(message.event);
            }
        }));
        return hello;
    }
    request(command, { timeout = 30000 } = {}) {
        if (!this.alive || !this.sock)
            return Promise.reject(new Error('Prime daemon is not connected'));
        const id = crypto.randomUUID();
        const result = this.pending.track(id, { timeout, label: `Prime ${command.type}` });
        try {
            this.sock.write(JSON.stringify({ type: 'command', id, protocol: exports.PRIME_DAEMON_PROTOCOL, clientId: this.clientId, command: { ...command, id } }) + '\n');
        }
        catch (error) {
            this.pending.fail(id, error);
        }
        return result;
    }
    onEvents(activeSessionId, handler) { this.eventHandlers.set(activeSessionId, handler); }
    offEvents(activeSessionId) { this.eventHandlers.delete(activeSessionId); }
    onClose(handler) { this.closeHandlers.add(handler); }
    _closed(error) {
        if (!this.sock)
            return;
        this.sock = null;
        this.alive = false;
        this.pending.failAll(error);
        for (const handler of this.closeHandlers)
            handler(error);
    }
    close() {
        const sock = this.sock;
        if (!sock)
            return;
        this._closed(new Error('Prime daemon connection closed'));
        try {
            sock.destroy();
        }
        catch { }
    }
}
exports.PrimeDaemonConnection = PrimeDaemonConnection;
/** A live Prime root agent, as consumed by the session routes (LiveSession). */
class PrimeDaemonSession extends transport_session_1.TransportSession {
    constructor(daemon, summary) {
        super();
        this.harnessId = 'prime';
        this.daemon = daemon;
        this.daemonSocket = daemon.socketPath;
        this.activeSessionId = summary.activeSessionId;
        this.alive = true;
        this.attached = false;
        this.turnInProgress = summary.isStreaming;
        this.compacting = summary.isCompacting;
        this.queueState = summary.queue;
        this.lastActivityAt = summary.lastActivityAt ? new Date(summary.lastActivityAt) : new Date();
        this.state = {};
        this.applySummary(summary);
    }
    /** Roster rows are authoritative for identity and the fields Prime emits no event for. */
    applySummary(summary) {
        const previousSessionId = this.summary?.nativeSessionId ?? null;
        const switched = previousSessionId !== null && previousSessionId !== summary.nativeSessionId;
        this.summary = summary;
        this.id = summary.nativeSessionId;
        this.nativeSessionId = summary.nativeSessionId;
        this.sessionFile = summary.sessionFile;
        this.cwd = summary.cwd;
        this.state = {
            ...this.state,
            sessionFile: summary.sessionFile,
            sessionName: summary.sessionName,
            name: summary.sessionName,
            thinkingLevel: summary.thinkingLevel,
            ...(summary.model ? { model: summary.model } : {}),
        };
        if (!this.attached) {
            this.turnInProgress = summary.isStreaming;
            this.compacting = summary.isCompacting;
            this.queueState = summary.queue;
        }
        // The route contract needs both sides: listeners re-key the spawn record and
        // retire the old route while still holding the previous native id.
        if (switched)
            this.emitEvent('session_switch', { sessionId: summary.nativeSessionId, previousSessionId });
    }
    _event(event) {
        const type = typeof event.type === 'string' ? event.type : null;
        if (!type)
            return;
        const msg = this.assistantFrame(event);
        (0, running_tool_calls_1.trackRunningToolCalls)(this.runningToolCalls, type, msg);
        if (type === 'agent_start' || type === 'turn_start') {
            this.turnInProgress = true;
            this.lastActivityAt = new Date();
        }
        else if (type === 'turn_end' || type === 'agent_end') {
            // Prime reports the end of a turn before the agent stops streaming.
            if (type === 'agent_end') {
                this.turnInProgress = false;
                this._refreshStats();
            }
            this.lastActivityAt = new Date();
        }
        else if (type === 'message_end') {
            this.lastActivityAt = new Date();
        }
        else if (type === 'compaction_start' || type === 'auto_compaction_start') {
            this.compacting = true;
        }
        else if (type === 'compaction_end' || type === 'auto_compaction_end') {
            this.compacting = false;
        }
        else if (type === 'session_action_update') {
            this.queueState = queueFrom(msg.actions);
            this.emitEvent('queue_update', this.queueState);
            return;
        }
        else if (type === 'session_info_changed') {
            if (typeof msg.name === 'string')
                this.state = { ...this.state, sessionName: msg.name, name: msg.name };
        }
        this.emitEvent(type, msg);
        this.endAssistantMessage(msg);
    }
    _retire() {
        if (!this.alive)
            return;
        this.alive = false;
        this.attached = false;
        this.turnInProgress = false;
        this.emitEvent('exit', { code: null });
        this.emitEvent('close', {});
    }
    send(command, params = {}, { timeout = 30000 } = {}) {
        if (!this.alive)
            return Promise.reject(new Error('Prime agent is no longer running'));
        return this.daemon.request({ ...params, type: command, activeSessionId: this.activeSessionId }, { timeout });
    }
    async prompt(message, opts = {}) {
        try {
            return await this.send('prompt', (0, transport_session_1.promptParams)(message, opts, this.turnInProgress), { timeout: 120000 });
        }
        catch (error) {
            // An abort with queued messages restores them and pauses delivery until
            // the queue is edited (as in Prime's TUI); a plain prompt is refused.
            if (!/queued session input is suspended/i.test(errorMessage(error)))
                throw error;
            throw new Error('Prime paused its queued messages after the abort. Cancel one from the queue to resume delivery, then send again.', { cause: error });
        }
    }
    steer(message, opts = {}) {
        return this.send('steer', { message, ...(opts.images?.length ? { images: opts.images } : {}) });
    }
    abort() { return this.send('abort'); }
    compact(customInstructions) {
        return this.send('compact', customInstructions ? { customInstructions } : {}, { timeout: 300000 });
    }
    async setModel(provider, modelId) {
        const model = await this.send('set_model', { provider, modelId });
        if ((0, wire_protocol_1.isRecord)(model))
            this.state = { ...this.state, model };
        return model;
    }
    async setName(name) {
        const result = await this.send('set_session_name', { name });
        this.state = { ...this.state, sessionName: name, name };
        return result;
    }
    async setThinkingLevel(level) {
        const result = await this.send('set_thinking_level', { level });
        this.state = { ...this.state, thinkingLevel: level };
        return result;
    }
    getState() { return this.send('get_state'); }
    getCommands() { return this.send('get_commands'); }
    getAvailableModels() { return this.send('get_available_models'); }
    getSessionStats() { return this.send('get_session_stats'); }
    getQueue() { return this.send('get_queue'); }
    exportHtml(outputPath) { return this.send('export_html', outputPath ? { outputPath } : {}, { timeout: 60000 }); }
    readTree() { return this.send('get_session_tree', {}, { timeout: 10000 }); }
    navigateTree(targetId, opts = {}) {
        const params = { targetId };
        if (opts.summarize)
            params.summarize = true;
        if (opts.customInstructions)
            params.customInstructions = opts.customInstructions;
        if (opts.label)
            params.label = opts.label;
        return this.send('navigate_tree', params, { timeout: 180000 });
    }
    /** Prime refuses the mutation unless `text` still names that queued entry. */
    async cancelQueued(kind, index, text) {
        const result = await this.send('mutate_queued_message', { lane: kind, index, expectedText: text, mutation: { type: 'delete' } });
        if (!(0, wire_protocol_1.isRecord)(result) || result.status !== 'applied') {
            throw new Error('That queued message was already delivered or changed; refresh the queue and try again.');
        }
        return result;
    }
    respondExtensionUI() {
        return Promise.reject(new Error('Prime Agent has no extension UI'));
    }
}
exports.PrimeDaemonSession = PrimeDaemonSession;
/**
 * The roster cache and connection for one daemon socket. Refreshes poll the
 * public `list` command; each root agent gets one PrimeDaemonSession that
 * attaches for events. An unreachable socket means no live Prime agents.
 */
class PrimeDaemon {
    constructor(socketPath) {
        this.socketPath = socketPath;
        this.connection = null;
        this.connecting = null;
        this.sessions = new Map();
        this.refreshing = null;
        this.timer = null;
        this.lastError = null;
    }
    async connected() {
        if (this.connection?.alive)
            return this.connection;
        if (this.connecting)
            return this.connecting;
        const connection = new PrimeDaemonConnection(this.socketPath);
        this.connecting = connection.connect().then(() => {
            connection.onClose(() => {
                if (this.connection !== connection)
                    return;
                this.connection = null;
                for (const session of this.sessions.values())
                    session.attached = false;
            });
            this.connection = connection;
            return connection;
        }).finally(() => { this.connecting = null; });
        return this.connecting;
    }
    request(command, options = {}) {
        return this.connected().then(connection => connection.request(command, options));
    }
    /** Current live roots from the last refresh (synchronous, for list assembly). */
    list() { return [...this.sessions.values()].filter(session => session.alive); }
    byNativeId(nativeSessionId) {
        for (const session of this.sessions.values())
            if (session.alive && session.nativeSessionId === nativeSessionId)
                return session;
        return null;
    }
    byActiveSessionId(activeSessionId) {
        const session = typeof activeSessionId === 'string' ? this.sessions.get(activeSessionId) : null;
        return session?.alive ? session : null;
    }
    refresh() {
        if (this.refreshing)
            return this.refreshing;
        this.refreshing = this._refresh().finally(() => { this.refreshing = null; });
        return this.refreshing;
    }
    async _refresh() {
        if (!fs.existsSync(this.socketPath)) {
            this.connection?.close();
            this.retireAll();
            this.lastError = null;
            return [];
        }
        let rows;
        let connection;
        try {
            connection = await this.connected();
            const roster = (0, wire_protocol_1.asRecord)(await connection.request({ type: 'list' }, { timeout: 5000 }));
            rows = Array.isArray(roster.sessions) ? roster.sessions : [];
            this.lastError = null;
        }
        catch (error) {
            this.lastError = errorMessage(error);
            this.retireAll();
            return [];
        }
        const seen = new Set();
        for (const row of rows) {
            const summary = primeRootSummary(row);
            if (!summary)
                continue;
            seen.add(summary.activeSessionId);
            let session = this.sessions.get(summary.activeSessionId);
            if (session && !session.alive) {
                this.sessions.delete(summary.activeSessionId);
                session = undefined;
            }
            if (session)
                session.applySummary(summary);
            else {
                session = new PrimeDaemonSession(this, summary);
                this.sessions.set(summary.activeSessionId, session);
            }
            if (!session.attached)
                await this.attach(connection, session);
        }
        for (const [id, session] of this.sessions) {
            if (seen.has(id))
                continue;
            this.sessions.delete(id);
            connection.offEvents(id);
            session._retire();
        }
        return this.list();
    }
    async attach(connection, session) {
        connection.onEvents(session.activeSessionId, event => session._event(event));
        try {
            const attached = (0, wire_protocol_1.asRecord)(await connection.request({ type: 'attach', activeSessionId: session.activeSessionId }, { timeout: 10000 }));
            const snapshot = (0, wire_protocol_1.asRecord)(attached.snapshot);
            const state = (0, wire_protocol_1.asRecord)(snapshot.state);
            session.attached = true;
            session.turnInProgress = state.isStreaming === true || session.summary.isStreaming;
            session.compacting = state.isCompacting === true || session.summary.isCompacting;
            if ((0, wire_protocol_1.isRecord)(state.sessionActions))
                session.queueState = queueFrom(state.sessionActions);
        }
        catch {
            // A worker that is still starting refuses attach; the next refresh retries.
            connection.offEvents(session.activeSessionId);
        }
    }
    retireAll() {
        for (const session of this.sessions.values())
            session._retire();
        this.sessions.clear();
    }
    /** Wait for a root agent matching `predicate` to appear in the roster. */
    async waitFor(predicate, { timeout = 30000, interval = 250 } = {}) {
        const deadline = Date.now() + timeout;
        for (;;) {
            const matches = (await this.refresh()).filter(session => predicate(session.summary));
            if (matches.length || Date.now() >= deadline)
                return matches;
            await (0, promises_1.setTimeout)(Math.min(interval, Math.max(1, deadline - Date.now())));
        }
    }
    /**
     * Stop one root through the supervisor after re-reading the roster: the
     * agent id, worker instance and transcript must still match what the
     * caller authorized. No retry; a lost reply is indeterminate.
     */
    async stop(expected, beforeStop, { timeout = 10000 } = {}) {
        let stopRequested = false;
        try {
            const roster = (0, wire_protocol_1.asRecord)(await this.request({ type: 'list' }, { timeout }));
            const rows = Array.isArray(roster.sessions) ? roster.sessions : [];
            const matches = rows.filter(row => (0, wire_protocol_1.isRecord)(row) && row.activeSessionId === expected.activeSessionId);
            const current = matches.length === 1 ? primeRootSummary(matches[0]) : null;
            if (!current || current.workerInstanceId !== expected.workerInstanceId || current.sessionFile !== expected.sessionFile) {
                throw new Error('Prime daemon roster does not match the owned root agent');
            }
            await beforeStop();
            stopRequested = true;
            await this.request({ type: 'kill', activeSessionId: expected.activeSessionId }, { timeout });
            const deadline = Date.now() + timeout;
            for (;;) {
                const live = (await this.refresh()).some(session => session.activeSessionId === expected.activeSessionId);
                if (!live)
                    return;
                if (Date.now() >= deadline)
                    throw new Error('Prime agent did not leave the daemon roster after stop');
                await (0, promises_1.setTimeout)(100);
            }
        }
        catch (error) {
            throw Object.assign(error instanceof Error ? error : new Error(String(error)), { stopRequested });
        }
    }
    start(intervalMs = 1500) {
        if (this.timer)
            return;
        this.refresh().catch(() => { });
        this.timer = setInterval(() => { this.refresh().catch(() => { }); }, intervalMs);
        this.timer.unref();
    }
    shutdown() {
        clearInterval(this.timer ?? undefined);
        this.timer = null;
        this.connection?.close();
        this.connection = null;
        this.retireAll();
    }
}
exports.PrimeDaemon = PrimeDaemon;
let current = null;
/** The daemon for the configured Prime launch; replaced when the socket changes. */
function getPrimeDaemon(env = process.env) {
    const socketPath = primeDaemonSocket(env);
    if (current?.socketPath !== socketPath) {
        current?.shutdown();
        current = new PrimeDaemon(socketPath);
    }
    return current;
}
/** Test seam: drop the cached daemon (and its connection). */
function resetPrimeDaemon() {
    current?.shutdown();
    current = null;
}
