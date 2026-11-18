// Generated from src/core/acp-session.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcpSession = exports.AGY_VERIFIED_VERSIONS = void 0;
exports.agyMirrorRoot = agyMirrorRoot;
exports.recordAgyPlanTier = recordAgyPlanTier;
exports.readAgyPlanTier = readAgyPlanTier;
exports.createAcpSession = createAcpSession;
exports.resumeAcpSession = resumeAcpSession;
exports.getAcpSession = getAcpSession;
exports.getAllAcpSessions = getAllAcpSessions;
exports.shutdownAcpSessions = shutdownAcpSessions;
/**
 * Antigravity CLI (`agy acp`) sessions: one owned stdio child per live session,
 * spoken to as an ACP v1 client. This is the fourth sibling of the bridge, Pi
 * RPC and Prime daemon transports; `TransportSession` supplies the replay maps
 * and the EventEmitter shape its consumers already expect.
 *
 * Pi-dish never injects prompt text or history (no `_meta` system prompt),
 * never reads `agy` token files and never sets GEMINI_HOME: the agent keeps its
 * own sign-in, tools and transcript store. The Pi-format mirror written here is
 * the only history surface pi-dish reads.
 */
const child_process_1 = require("child_process");
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
const transport_session_1 = require("./transport-session");
const session_key_1 = require("./session-key");
const harnesses_1 = require("./harnesses");
const harness_launch_spec_1 = require("./harness-launch-spec");
const acp_transcript_1 = require("./acp-transcript");
/** Versions the fake agent and the captures were verified against. */
exports.AGY_VERIFIED_VERSIONS = Object.freeze(['1.5.10']);
/** The child inherits the user's normal `agy` profile; ambient API keys would pick another auth method. */
const STRIPPED_ENV = [
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
    'GOOGLE_GENAI_USE_VERTEXAI',
];
const ACP_ARGS = ['acp', '--dangerously-skip-permissions', '--disable-telemetry'];
/** Quiet period that ends a turn agy started on its own (no prompt response will). */
const AUTONOMOUS_IDLE_DEFAULT_MS = 15000;
function autonomousIdleMs() {
    const override = Number(process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS);
    return Number.isFinite(override) && override > 0 ? override : AUTONOMOUS_IDLE_DEFAULT_MS;
}
function sumUsage(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;
    const total = { ...a };
    for (const [key, value] of Object.entries(b)) {
        const prior = total[key];
        if ((0, helper_values_1.finite)(value))
            total[key] = ((0, helper_values_1.finite)(prior) ? prior : 0) + value;
    }
    return total;
}
/** Updates that mean the agent is working (config/usage/title updates are not). */
const ACTIVITY_UPDATES = {
    agent_message_chunk: true, agent_thought_chunk: true, tool_call: true, tool_call_update: true, plan: true,
};
function agyMirrorRoot() {
    return path.join((0, dish_store_1.dishDir)(), 'agy', 'sessions');
}
function agyTierFile() {
    return path.join((0, dish_store_1.dishDir)(), 'agy', 'tier.json');
}
/** Persist the tier name (`Google AI Ultra`, `Google AI Pro`) observed on ACP session open. */
function recordAgyPlanTier(planType) {
    if (!planType)
        return;
    try {
        (0, dish_store_1.replaceFile)(agyTierFile(), JSON.stringify({ planType, updatedAt: Date.now() }) + '\n', 0o600);
    }
    catch { /* Advisory display metadata for `/api/usage-limits`; never fail a session. */ }
}
function readAgyPlanTier() {
    try {
        const raw = JSON.parse(fs.readFileSync(agyTierFile(), 'utf8'));
        const planType = (0, helper_values_1.record)(raw) && typeof raw.planType === 'string' ? raw.planType.trim() : '';
        return planType ? planType.slice(0, 40) : null;
    }
    catch {
        return null;
    }
}
let cachedPackageVersion = null;
function packageVersion() {
    if (cachedPackageVersion)
        return cachedPackageVersion;
    let version = '0.0.0';
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        const found = (0, helper_values_1.record)(raw) ? raw.version : undefined;
        if (typeof found === 'string' && found)
            version = found;
    }
    catch { /* A missing package.json only weakens the client metadata. */ }
    cachedPackageVersion = version;
    return version;
}
const MAX_AGY_LOG_FILES = 50;
function pruneLogFiles(dir) {
    try {
        const entries = fs.readdirSync(dir).filter(name => name.endsWith('.log'));
        if (entries.length <= MAX_AGY_LOG_FILES)
            return;
        const dated = entries.flatMap((name) => {
            const full = path.join(dir, name);
            try {
                return [{ full, mtimeMs: fs.statSync(full).mtimeMs }];
            }
            catch {
                return [];
            }
        }).sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const entry of dated.slice(0, Math.max(0, dated.length - MAX_AGY_LOG_FILES))) {
            try {
                fs.unlinkSync(entry.full);
            }
            catch { }
        }
    }
    catch { }
}
function logFileFor(sessionId) {
    const dir = path.join((0, dish_store_1.dishDir)(), 'agy', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    pruneLogFiles(dir);
    const stem = sessionId && (0, session_key_1.validSessionId)(sessionId) ? sessionId : crypto.randomUUID();
    return path.join(dir, `${stem}.log`);
}
/** -32000 is generic; only this agent message means the host has no usable sign-in. */
function authInstruction(error) {
    if (error instanceof Error && /Authentication required/i.test(error.message)) {
        return new Error('Antigravity is not signed in on this host; run `agy` or `agy acp --login` there');
    }
    return error;
}
/**
 * `PI_DISH_AGY_COMMAND`/descriptor argv name the binary; the ACP argv is ours
 * unless the configured command already carries it (as tests do).
 */
function launchAgy(opts) {
    let argv;
    let launchEnv = {};
    if (opts.command) {
        argv = [opts.command, ...(opts.args ?? [])];
    }
    else {
        const descriptor = (0, harnesses_1.getHarness)('agy');
        if (descriptor) {
            const spec = (0, harness_launch_spec_1.harnessLaunchSpec)(descriptor);
            argv = [...spec.argv];
            launchEnv = spec.env;
        }
        else {
            const parsed = (0, harnesses_1.parseLaunchWords)(process.env.PI_DISH_AGY_COMMAND || 'agy');
            argv = parsed.words.length ? [...parsed.words] : ['agy'];
            launchEnv = parsed.env;
        }
    }
    // The relay passes the configured agy binary explicitly; the ACP argv is
    // still ours unless that command already carries it.
    if (!argv.includes('acp'))
        argv.push(...ACP_ARGS, '--log-file', logFileFor(opts.sessionId));
    const env = { ...process.env, ...launchEnv, ...opts.env };
    for (const key of STRIPPED_ENV)
        delete env[key];
    return { argv, env };
}
class AcpSession extends transport_session_1.TransportSession {
    constructor(proc, cwd) {
        super();
        this.harnessId = 'agy';
        this.proc = proc;
        this.cwd = cwd;
        this.id = crypto.randomUUID();
        this.nativeSessionId = this.id;
        this.sessionFile = '';
        this.alive = true;
        this.agentVersion = null;
        this.state = {};
        this.pending = new pending_requests_1.PendingRequests();
        this.nextRequestId = 1;
        this.transcript = null;
        this.configOptions = [];
        this.modes = null;
        this.currentMode = null;
        this.commandRows = [];
        this.stderrTail = [];
        this.segment = null;
        this.toolCalls = new Map();
        this.askQuestions = new Map();
        this.promptResponses = new Map();
        this.newestPromptId = null;
        this.inbound = new Map();
        this.counter = 0;
        this.earlyFrames = [];
        this.autonomousTimer = null;
        this.handoverUsage = null;
        // A failed spawn (ENOENT) emits only 'error': settle startup and drop timers.
        this.spawnFailure = new Promise((_, reject) => {
            proc.on('error', (error) => {
                this.alive = false;
                this.pending.failAll(error);
                for (const waiter of this.promptResponses.values())
                    waiter.reject(error);
                this.promptResponses.clear();
                reject(error);
            });
        });
        this.spawnFailure.catch(() => { });
        proc.stdin.on('error', () => { });
        proc.stdout.on('error', () => { });
        proc.stderr.on('error', () => { });
        proc.stdout.on('data', (0, line_splitter_1.createJsonLineSplitter)((message) => {
            try {
                this._handleFrame(message);
            }
            catch (error) {
                console.error(`[agy] event handler failed: ${(0, http_boundary_1.errorMessage)(error)}`);
            }
        }));
        proc.stderr.on('data', (data) => {
            const output = data.toString().trim();
            if (!output)
                return;
            for (const line of output.split('\n')) {
                this.stderrTail.push(line);
                if (this.stderrTail.length > 5)
                    this.stderrTail.shift();
            }
            console.error(`[agy:${this.id.slice(0, 8)}] ${output}`);
        });
        proc.on('exit', (code) => {
            this._clearAutonomousTimer();
            // Keep whatever the agent already said: an open segment would be lost otherwise.
            if (this.segment)
                this._closeSegment('error', this._takeHandoverUsage(), `agy exited with code ${code}`);
            this.alive = false;
            this.turnInProgress = false;
            this.segment = null;
            const error = new Error(`agy exited with code ${code}${this.stderrTail.length ? ': ' + this.stderrTail.join(' | ') : ''}`);
            this.pending.failAll(error);
            for (const waiter of this.promptResponses.values())
                waiter.reject(error);
            this.promptResponses.clear();
            this.inbound.clear();
            this.toolCalls.clear();
            this.askQuestions.clear();
            this.emitEvent('exit', { code });
            this.emitEvent('close', {});
            if (acpSessions.get(this.id) === this)
                acpSessions.delete(this.id);
        });
    }
    get pid() {
        return this.proc.pid ?? null;
    }
    // ---- wire ----------------------------------------------------------------
    _writeFrame(frame) {
        if (!this.alive)
            throw new Error('Antigravity session is not running');
        if (this.transcript)
            this.transcript.appendRaw('out', frame);
        else
            this._bufferFrame('out', frame);
        this.proc.stdin.write(JSON.stringify(frame) + '\n');
    }
    /** The sidecar is named by the agy session id, which startup frames precede; flush on adopt. */
    _bufferFrame(dir, msg) {
        this.earlyFrames.push({ dir, msg });
        if (this.earlyFrames.length > 128)
            this.earlyFrames.shift();
    }
    _request(method, params, { timeout = 30000 } = {}) {
        const id = this.nextRequestId++;
        const result = this.pending.track(id, { timeout, label: `Antigravity ${method}` });
        try {
            this._writeFrame({ jsonrpc: '2.0', id, method, params });
        }
        catch (error) {
            this.pending.fail(id, error);
        }
        return result.catch((error) => { throw authInstruction(error); });
    }
    _notify(method, params) {
        this._writeFrame({ jsonrpc: '2.0', method, params });
    }
    _respond(id, result) {
        try {
            this._writeFrame({ jsonrpc: '2.0', id, result });
        }
        catch { /* A dead child needs no answer. */ }
    }
    _respondError(id, code, message) {
        try {
            this._writeFrame({ jsonrpc: '2.0', id, error: { code, message } });
        }
        catch { /* A dead child needs no answer. */ }
    }
    _handleFrame(frame) {
        if (this.transcript)
            this.transcript.appendRaw('in', frame);
        else
            this._bufferFrame('in', frame);
        if (typeof frame.method === 'string' && frame.method) {
            if (frame.id !== undefined && frame.id !== null)
                this._handleRequest(frame);
            else
                this._handleNotification(frame.method, frame.params);
            return;
        }
        this._handleResponse(frame);
    }
    _handleResponse(frame) {
        const id = frame.id;
        if (typeof id === 'number' && this.promptResponses.has(id)) {
            const waiter = this.promptResponses.get(id);
            this.promptResponses.delete(id);
            if (frame.error !== undefined) {
                const message = (0, helper_values_1.record)(frame.error) ? (0, helper_values_1.text)(frame.error.message) || 'Antigravity prompt failed' : 'Antigravity prompt failed';
                waiter.reject(new Error(message));
                if (id === this.newestPromptId) {
                    this.newestPromptId = null;
                    this._closeSegment('error', this._takeHandoverUsage(), message);
                    this._endTurn();
                }
                return;
            }
            waiter.resolve(frame.result);
            const result = (0, wire_protocol_1.asRecord)(frame.result);
            // An earlier prompt answered while a newer one runs is a steer handover, not the
            // turn end. agy may report that prompt's own usage then; it is not repeated later.
            if (id !== this.newestPromptId) {
                this.handoverUsage = sumUsage(this.handoverUsage, (0, acp_transcript_1.acpUsage)(result.usage));
                return;
            }
            this.newestPromptId = null;
            const stop = (0, helper_values_1.text)(result.stopReason);
            this._closeSegment((0, acp_transcript_1.acpStopReason)(stop), this._takeHandoverUsage((0, acp_transcript_1.acpUsage)(result.usage)), stop === 'refusal' ? 'Antigravity refused this request.' : null);
            this._endTurn();
            return;
        }
        const error = (0, helper_values_1.record)(frame.error) ? (0, helper_values_1.text)(frame.error.message) || 'Antigravity request failed' : '';
        this.pending.settle(id, frame.error === undefined, frame.result, error, 'Antigravity request failed');
    }
    _handleNotification(method, params) {
        if (method !== 'session/update')
            return;
        this._sessionUpdate((0, wire_protocol_1.asRecord)(params).update);
    }
    _handleRequest(frame) {
        const id = frame.id;
        const method = (0, helper_values_1.text)(frame.method);
        const params = (0, wire_protocol_1.asRecord)(frame.params);
        const key = String(id);
        if (method === 'session/request_permission' || method === 'elicitation/create')
            this._noteActivity();
        if (method === 'session/request_permission') {
            const dialog = (0, acp_transcript_1.permissionDialog)(key, params);
            if (!dialog) {
                this._respondError(id, -32602, 'Invalid permission request');
                return;
            }
            this.inbound.set(key, { id, kind: 'permission', options: dialog.options });
            this._emitUI(dialog.request);
            return;
        }
        if (method === 'elicitation/create') {
            const toolCallId = (0, helper_values_1.text)(params.toolCallId);
            const ask = (0, acp_transcript_1.askFromElicitation)(key, params, this.askQuestions.get(toolCallId) ?? []);
            if (!ask) {
                // Declining keeps the turn alive; an error would fail the tool outright.
                this._respond(id, { action: 'cancel' });
                return;
            }
            this.inbound.set(key, { id, kind: 'elicitation', questions: ask.questions });
            this._emitUI(ask.request);
            return;
        }
        this._respondError(id, -32601, `Unsupported ACP method: ${method}`);
    }
    // ---- ACP → Pi events -----------------------------------------------------
    _sessionUpdate(raw) {
        const update = (0, helper_values_1.record)(raw) ? raw : {};
        const kind = (0, helper_values_1.text)(update.sessionUpdate);
        if (Object.hasOwn(ACTIVITY_UPDATES, kind))
            this._noteActivity();
        switch (kind) {
            case 'agent_message_chunk': {
                const content = (0, wire_protocol_1.asRecord)(update.content);
                if (content.type === 'text')
                    this._pushChunk('text', (0, helper_values_1.text)(content.text));
                return;
            }
            case 'agent_thought_chunk': {
                const content = (0, wire_protocol_1.asRecord)(update.content);
                if (content.type === 'text')
                    this._pushChunk('thinking', (0, helper_values_1.text)(content.text));
                return;
            }
            case 'user_message_chunk':
                // Live sessions never emit these; import via `session/load` is a later phase.
                return;
            case 'tool_call':
                this._toolCall(update);
                return;
            case 'tool_call_update':
                this._toolUpdate(update);
                return;
            case 'plan': {
                const request = (0, acp_transcript_1.planWidgetRequest)(`agy-plan-${++this.counter}`, update.entries);
                if (request)
                    this._emitUI(request);
                return;
            }
            case 'available_commands_update':
                this.commandRows = Array.isArray(update.availableCommands) ? update.availableCommands : [];
                return;
            case 'current_mode_update':
                if (typeof update.currentModeId === 'string' && update.currentModeId) {
                    this.currentMode = update.currentModeId;
                    this._refreshStateFromConfig();
                }
                return;
            case 'config_option_update':
                this._applyConfigUpdate(update);
                return;
            case 'usage_update': {
                const used = update.used;
                if (!(0, helper_values_1.finite)(used))
                    return;
                const size = (0, helper_values_1.finite)(update.size) ? update.size : null;
                this.lastStats = {
                    contextUsage: {
                        tokens: used,
                        contextWindow: size,
                        percent: size && size > 0 ? (used / size) * 100 : null,
                    },
                };
                return;
            }
            case 'session_info_update':
                this._applyTitle(update.title);
                return;
            default:
                return;
        }
    }
    _emitUI(request) {
        (0, extension_ui_state_1.reduceExtensionUIState)(this.extUIState, 'extension_ui_request', request);
        this.emitEvent('extension_ui_request', request);
    }
    _applyTitle(title) {
        if (typeof title !== 'string' || !title)
            return;
        if (this.state.sessionName === title && this.state.name === title)
            return;
        this.state = { ...this.state, sessionName: title, name: title };
        this.transcript?.appendSessionInfo(title);
    }
    _applyConfigUpdate(update) {
        if (Array.isArray(update.configOptions)) {
            this.configOptions = update.configOptions.filter(helper_values_1.record);
            this._refreshStateFromConfig();
            return;
        }
        const id = typeof update.id === 'string' && update.id ? update.id
            : typeof update.configId === 'string' && update.configId ? update.configId : null;
        if (!id)
            return;
        const option = this._configOption(id);
        if (!option)
            return;
        const value = update.currentValue ?? update.value;
        if (typeof value !== 'string')
            return;
        option.currentValue = value;
        this._refreshStateFromConfig();
    }
    _pushChunk(type, chunk) {
        this._ensureSegment();
        const message = this.segment;
        const content = message.content;
        const last = content[content.length - 1];
        if ((0, helper_values_1.record)(last) && last.type === type) {
            const key = type === 'text' ? 'text' : 'thinking';
            last[key] = (0, helper_values_1.text)(last[key]) + chunk;
        }
        else {
            content.push(type === 'text' ? { type: 'text', text: chunk } : { type: 'thinking', thinking: chunk });
        }
        this.lastActivityAt = new Date();
        this.emitEvent('message_update', { type: 'message_update', message: structuredClone(message) });
    }
    _ensureSegment() {
        if (this.segment)
            return;
        const message = {
            role: 'assistant',
            content: [],
            timestamp: Date.now(),
            provider: acp_transcript_1.AGY_PROVIDER,
        };
        const model = this._currentModelId();
        if (model)
            message.model = model;
        this.segment = message;
        this.emitEvent('message_start', { type: 'message_start', message: structuredClone(message) });
    }
    _closeSegment(stopReason, usage, errorMessage) {
        // A turn that ends right after a tool call, cancels early, or fails/refuses
        // before streaming any chunk has no open segment; open a shell so usage,
        // abort state and errors reach the mirror and SSE.
        if (!this.segment && (errorMessage || usage || stopReason === 'aborted' || stopReason === 'error')) {
            this._ensureSegment();
        }
        const message = this.segment;
        if (!message)
            return;
        this.segment = null;
        message.stopReason = stopReason;
        if (usage)
            message.usage = usage;
        if (errorMessage)
            message.errorMessage = errorMessage;
        const event = { type: 'message_end', message };
        // The mirror must be on disk before `message_end`: the browser re-reads it on turn_end.
        this.transcript?.appendAssistant(message);
        this.lastActivityAt = new Date();
        this.emitEvent('message_end', event);
        this.endAssistantMessage(event);
    }
    _toolCall(update) {
        const call = (0, acp_transcript_1.normalizeAcpTool)(update);
        const toolCallId = (0, helper_values_1.text)(update.toolCallId) || `call-${++this.counter}`;
        if (this.segment || this.turnInProgress) {
            this._ensureSegment();
            this.segment.content.push({ type: 'toolCall', id: toolCallId, name: call.toolName, arguments: call.args });
            // Pi needs the assistant message before its tool results; ACP interleaves them.
            this._closeSegment('toolUse', null, null);
        }
        const startedAt = Date.now();
        this.toolCalls.set(toolCallId, { call, startedAt });
        if (call.nativeName === 'ask_question') {
            const args = (0, helper_values_1.record)(update.args) ? update.args : {};
            this.askQuestions.set(toolCallId, Array.isArray(args.questions) ? args.questions : []);
        }
        this._emitTool('tool_execution_start', { toolCallId, toolName: call.toolName, args: call.args, startedAt });
    }
    _toolUpdate(update) {
        const toolCallId = (0, helper_values_1.text)(update.toolCallId);
        if (!toolCallId)
            return;
        let tracked = this.toolCalls.get(toolCallId);
        if (!tracked) {
            // A replay or a lost start frame: synthesise the start from this update.
            this._toolCall(update);
            tracked = this.toolCalls.get(toolCallId);
            if (!tracked)
                return;
        }
        const status = (0, helper_values_1.text)(update.status);
        const result = (0, acp_transcript_1.acpToolResult)(update, tracked.call);
        if (status === 'completed' || status === 'failed') {
            const isError = status === 'failed';
            this.toolCalls.delete(toolCallId);
            this.askQuestions.delete(toolCallId);
            this.transcript?.appendToolResult({
                toolCallId,
                toolName: tracked.call.toolName,
                content: result.text,
                isError,
                ...(result.details ? { details: result.details } : {}),
            });
            this._emitTool('tool_execution_end', {
                toolCallId,
                toolName: tracked.call.toolName,
                args: tracked.call.args,
                startedAt: tracked.startedAt,
                isError,
                result: { content: [{ type: 'text', text: result.text }], ...(result.details ? { details: result.details } : {}) },
            });
            return;
        }
        const progress = result.text || (status === 'pending' ? 'Waiting for approval' : 'Running…');
        this._emitTool('tool_execution_update', {
            toolCallId,
            toolName: tracked.call.toolName,
            args: tracked.call.args,
            startedAt: tracked.startedAt,
            partialResult: { content: [{ type: 'text', text: progress }] },
        });
    }
    _emitTool(event, data) {
        (0, running_tool_calls_1.trackRunningToolCalls)(this.runningToolCalls, event, data);
        this.emitEvent(event, data);
    }
    _endTurn() {
        this._clearAutonomousTimer();
        this.turnInProgress = false;
        this.lastActivityAt = new Date();
        (0, running_tool_calls_1.trackRunningToolCalls)(this.runningToolCalls, 'turn_end', { type: 'turn_end' });
        this.emitEvent('turn_end', { type: 'turn_end' });
        this.emitEvent('agent_end', { type: 'agent_end' });
        this._refreshStats();
    }
    /**
     * agy keeps working without a prompt when a background command it started
     * finishes after its turn was answered. That work is a turn of its own: open
     * one on the first frame, and end it once frames stop and no dialog awaits an
     * answer, since no prompt response will arrive to end it.
     */
    _noteActivity() {
        if (!this.turnInProgress) {
            this.turnInProgress = true;
            this.emitEvent('agent_start', { type: 'agent_start' });
            this.emitEvent('turn_start', { type: 'turn_start' });
        }
        if (this.newestPromptId !== null)
            return;
        this._clearAutonomousTimer();
        this.autonomousTimer = setTimeout(() => this._autonomousIdle(), autonomousIdleMs());
        this.autonomousTimer.unref();
    }
    _autonomousIdle() {
        this.autonomousTimer = null;
        if (!this.alive || this.newestPromptId !== null || !this.turnInProgress)
            return;
        if (this.inbound.size > 0) {
            this.autonomousTimer = setTimeout(() => this._autonomousIdle(), autonomousIdleMs());
            this.autonomousTimer.unref();
            return;
        }
        this._closeSegment('stop', this._takeHandoverUsage(), null);
        this._endTurn();
    }
    _clearAutonomousTimer() {
        if (this.autonomousTimer)
            clearTimeout(this.autonomousTimer);
        this.autonomousTimer = null;
    }
    _takeHandoverUsage(final = null) {
        const usage = sumUsage(this.handoverUsage, final);
        this.handoverUsage = null;
        return usage;
    }
    // ---- state ---------------------------------------------------------------
    _configOption(id) {
        for (const option of this.configOptions)
            if (option.id === id)
                return option;
        return null;
    }
    _configValues(id) {
        const option = this._configOption(id);
        const rows = option && Array.isArray(option.options) ? option.options : [];
        return rows.flatMap((row) => (0, helper_values_1.record)(row) && typeof row.value === 'string' && row.value ? [row.value] : []);
    }
    _configValue(id) {
        const option = this._configOption(id);
        return option && typeof option.currentValue === 'string' && option.currentValue ? option.currentValue : null;
    }
    _currentModelId() {
        return this._configValue('model');
    }
    _modelName(id) {
        const option = this._configOption('model');
        const rows = option && Array.isArray(option.options) ? option.options : [];
        for (const row of rows) {
            if ((0, helper_values_1.record)(row) && row.value === id && typeof row.name === 'string' && row.name)
                return row.name;
        }
        return null;
    }
    _modeId() {
        const configured = this._configValue('mode');
        if (configured)
            return configured;
        const modes = this.modes;
        if (modes && typeof modes.currentModeId === 'string' && modes.currentModeId)
            return modes.currentModeId;
        return this.currentMode;
    }
    _refreshStateFromConfig() {
        const modelId = this._currentModelId();
        const state = {
            ...this.state,
            sessionFile: this.sessionFile,
            thinkingLevel: this._configValue('thought_level'),
            mode: this._modeId(),
        };
        if (modelId) {
            state.model = { provider: acp_transcript_1.AGY_PROVIDER, id: modelId, name: this._modelName(modelId) ?? modelId };
        }
        this.state = state;
    }
    _adoptSession(result, sessionId, sessionFile) {
        if (!(0, session_key_1.validSessionId)(sessionId))
            throw new TypeError('Invalid Antigravity session id');
        this.id = sessionId;
        this.nativeSessionId = this.id;
        this.sessionFile = sessionFile;
        this.configOptions = Array.isArray(result.configOptions) ? result.configOptions.filter(helper_values_1.record) : [];
        this.modes = (0, helper_values_1.record)(result.modes) ? result.modes : null;
        this.currentMode = this._modeId();
        this.state = {
            sessionFile,
            sessionName: typeof result.title === 'string' && result.title ? result.title : null,
            name: typeof result.title === 'string' && result.title ? result.title : null,
            model: null,
            thinkingLevel: null,
            mode: null,
        };
        this._refreshStateFromConfig();
        recordAgyPlanTier((0, acp_transcript_1.extractAcpPlanTier)(result));
        this.transcript = new acp_transcript_1.AcpTranscript({ file: sessionFile, sessionId, cwd: this.cwd, agentVersion: this.agentVersion });
        for (const frame of this.earlyFrames)
            this.transcript.appendRaw(frame.dir, frame.msg);
        this.earlyFrames = [];
        registerAcpSession(this);
    }
    // ---- startup -------------------------------------------------------------
    _warnUnverifiedVersion() {
        if (!this.agentVersion || exports.AGY_VERIFIED_VERSIONS.includes(this.agentVersion))
            return;
        this._emitUI({
            type: 'extension_ui_request',
            id: `agy-version-${this.id}`,
            method: 'setStatus',
            statusKey: 'agy-version',
            statusText: `Antigravity ${this.agentVersion} is unverified (tested with ${exports.AGY_VERIFIED_VERSIONS.join(', ')})`,
        });
    }
    async _initialize() {
        // A spawn failure (ENOENT) never yields a frame; race it so startup fails fast.
        const result = await Promise.race([
            this._request('initialize', {
                protocolVersion: 1,
                clientInfo: { name: 'pi-dish', title: 'pi-dish', version: packageVersion() },
                clientCapabilities: {
                    fs: { readTextFile: false, writeTextFile: false },
                    terminal: false,
                    elicitation: { form: {} },
                },
            }, { timeout: 20000 }),
            this.spawnFailure,
        ]);
        const handshake = (0, wire_protocol_1.asRecord)(result);
        const info = (0, wire_protocol_1.asRecord)(handshake.agentInfo);
        const capabilities = (0, wire_protocol_1.asRecord)(handshake.agentCapabilities);
        if (handshake.protocolVersion !== 1)
            throw new Error(`Unsupported ACP protocol version: ${String(handshake.protocolVersion)}`);
        if (info.name !== 'Antigravity ACP Server')
            throw new Error(`Unexpected ACP agent: ${String(info.name)}`);
        if (capabilities.loadSession !== true)
            throw new Error('Antigravity ACP does not support session loading');
        if (!(0, helper_values_1.record)(capabilities.sessionCapabilities) || !Object.hasOwn(capabilities.sessionCapabilities, 'resume')) {
            throw new Error('Antigravity ACP does not support session resume');
        }
        this.agentVersion = typeof info.version === 'string' && info.version ? info.version : null;
        this._warnUnverifiedVersion();
    }
    async _setConfigOption(configId, value) {
        const result = await this._request('session/set_config_option', { sessionId: this.nativeSessionId, configId, value }, { timeout: 15000 });
        const option = this._configOption(configId);
        if (option)
            option.currentValue = value;
        this._refreshStateFromConfig();
        return result;
    }
    /** New session: spawn → initialize → `session/new` → mirror header → initial options. */
    async _start(opts) {
        await this._initialize();
        const result = (0, wire_protocol_1.asRecord)(await this._request('session/new', { cwd: this.cwd, mcpServers: [] }, { timeout: 30000 }));
        const sessionId = (0, helper_values_1.text)(result.sessionId);
        if (!sessionId)
            throw new Error('Antigravity did not return a session id');
        const sessionFile = path.join(agyMirrorRoot(), `${sessionId}.jsonl`);
        this._adoptSession(result, sessionId, sessionFile);
        if (opts.model)
            await this.setModel(acp_transcript_1.AGY_PROVIDER, opts.model);
        if (opts.thinking)
            await this.setThinkingLevel(opts.thinking);
        // The mirror's first model/thinking entries make the transcript self-describing.
        if (!opts.model) {
            const model = this._currentModelId();
            if (model)
                this.transcript?.appendModelChange(model);
        }
        if (!opts.thinking) {
            const level = this._configValue('thought_level');
            if (level)
                this.transcript?.appendThinkingLevel(level);
        }
    }
    /** Resume: initialize → `session/resume` (no history replay) → keep the existing mirror. */
    async _startResume(sessionId, sessionFile, opts) {
        await this._initialize();
        const result = (0, wire_protocol_1.asRecord)(await this._request('session/resume', { sessionId, cwd: this.cwd, mcpServers: [] }, { timeout: 30000 }));
        const returned = (0, helper_values_1.text)(result.sessionId);
        if (returned && returned !== sessionId)
            throw new Error(`Antigravity resumed a different session: ${returned}`);
        this._adoptSession(result, sessionId, sessionFile);
        if (opts.model)
            await this.setModel(acp_transcript_1.AGY_PROVIDER, opts.model);
        if (opts.thinking)
            await this.setThinkingLevel(opts.thinking);
    }
    // ---- public transport surface -------------------------------------------
    _bareModelId(value) {
        const prefix = `${acp_transcript_1.AGY_PROVIDER}/`;
        return value.startsWith(prefix) ? value.slice(prefix.length) : value;
    }
    _promptContent(message, opts) {
        const images = [];
        for (const image of opts.images ?? []) {
            if (!(0, helper_values_1.record)(image) || typeof image.data !== 'string' || !image.data)
                continue;
            images.push({ type: 'image', data: image.data, mimeType: (0, helper_values_1.text)(image.mimeType) || 'image/png' });
        }
        const content = [];
        if (message || !images.length)
            content.push({ type: 'text', text: message });
        content.push(...images);
        return content;
    }
    _sendPrompt(message, opts) {
        if (!this.alive)
            return Promise.reject(new Error('Antigravity session is not running'));
        const content = this._promptContent(message, opts);
        const id = this.nextRequestId++;
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        promise.catch(() => { });
        this.promptResponses.set(id, { promise, resolve, reject });
        try {
            this._writeFrame({ jsonrpc: '2.0', id, method: 'session/prompt', params: { sessionId: this.nativeSessionId, prompt: content } });
        }
        catch (error) {
            this.promptResponses.delete(id);
            return Promise.reject(error);
        }
        // What agy said before this prompt stays before it in the transcript.
        if (this.segment)
            this._closeSegment('stop', null, null);
        const timestamp = Date.now();
        this.transcript?.appendUser(content, timestamp);
        if (!this.turnInProgress) {
            this.turnInProgress = true;
            this.emitEvent('agent_start', { type: 'agent_start' });
            this.emitEvent('turn_start', { type: 'turn_start' });
        }
        this.emitEvent('message_end', {
            type: 'message_end',
            message: { role: 'user', content, timestamp },
        });
        // A prompt sent while agy works on its own takes the turn over; its response ends it.
        this._clearAutonomousTimer();
        this.newestPromptId = id;
        this.lastActivityAt = new Date();
        // The ACP answer arrives at turn end (20–60 s); callers track completion by events.
        return Promise.resolve({ ok: true });
    }
    prompt(message, opts = {}) {
        return this._sendPrompt(message, opts);
    }
    steer(message, opts = {}) {
        return this._sendPrompt(message, opts);
    }
    async abort() {
        if (!this.alive)
            throw new Error('Antigravity session is not running');
        const newest = this.newestPromptId;
        const waiter = newest === null ? undefined : this.promptResponses.get(newest);
        this._notify('session/cancel', { sessionId: this.nativeSessionId });
        if (!waiter)
            return { ok: true };
        const deadline = new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error('Antigravity did not acknowledge the cancel')), 20000);
            timer.unref();
        });
        try {
            await Promise.race([waiter.promise, deadline]);
        }
        catch { /* Turn end/exit already ended the turn. */ }
        return { ok: true };
    }
    async setModel(provider, modelId) {
        if (provider && provider !== acp_transcript_1.AGY_PROVIDER) {
            throw new Error(`Antigravity sessions serve Gemini models only (provider ${acp_transcript_1.AGY_PROVIDER})`);
        }
        const id = this._bareModelId(modelId);
        if (!id.startsWith('gemini-'))
            throw new Error(`Antigravity serves Gemini models only: ${modelId}`);
        const offered = this._configValues('model');
        if (offered.length && !offered.includes(id))
            throw new Error(`Antigravity did not offer model ${id}`);
        const result = await this._setConfigOption('model', id);
        this.transcript?.appendModelChange(id);
        return result;
    }
    async setThinkingLevel(level) {
        const offered = this._configValues('thought_level');
        if (offered.length && !offered.includes(level))
            throw new Error(`Antigravity did not offer thinking level ${level}`);
        const result = await this._setConfigOption('thought_level', level);
        this.transcript?.appendThinkingLevel(level);
        return result;
    }
    async setMode(modeId) {
        if (!modeId)
            throw new Error('modeId required');
        const result = await this._request('session/set_mode', { sessionId: this.nativeSessionId, modeId }, { timeout: 15000 });
        this.currentMode = modeId;
        const option = this._configOption('mode');
        if (option)
            option.currentValue = modeId;
        this._refreshStateFromConfig();
        return result;
    }
    /** agy has no rename ACP method; the title is read-only from `session_info_update`. */
    setName(_name) {
        return Promise.reject(new Error('Antigravity session titles come from the agent; renaming is not supported.'));
    }
    getState() {
        return Promise.resolve(this.state);
    }
    /** Gemini-only; same payload shape the Pi RPC `get_available_models` returns. */
    getAvailableModels() {
        const option = this._configOption('model');
        const rows = option && Array.isArray(option.options) ? option.options : [];
        const thinking = this._configValues('thought_level');
        const usage = (0, wire_protocol_1.asRecord)((0, wire_protocol_1.asRecord)(this.lastStats).contextUsage);
        const contextWindow = (0, helper_values_1.finite)(usage.contextWindow) ? usage.contextWindow : 0;
        const models = rows.flatMap((row) => {
            if (!(0, helper_values_1.record)(row) || typeof row.value !== 'string' || !row.value.startsWith('gemini-'))
                return [];
            return [{
                    id: row.value,
                    provider: acp_transcript_1.AGY_PROVIDER,
                    name: typeof row.name === 'string' && row.name ? row.name : row.value,
                    selector: `${acp_transcript_1.AGY_PROVIDER}/${row.value}`,
                    contextWindow,
                    thinking: thinking.length ? thinking : null,
                    pricing: null,
                    free: false,
                }];
        });
        return Promise.resolve({ models });
    }
    /** `available_commands_update` rows for the slash picker. */
    getCommands() {
        return Promise.resolve({ commands: this.commandRows });
    }
    getSessionStats() {
        const usage = (0, wire_protocol_1.asRecord)((0, wire_protocol_1.asRecord)(this.lastStats).contextUsage);
        return Promise.resolve(Object.keys(usage).length ? { contextUsage: usage } : {});
    }
    respondExtensionUI(requestId, response) {
        const dialog = this.inbound.get(requestId);
        if (!dialog)
            return Promise.resolve();
        this.inbound.delete(requestId);
        if (dialog.kind === 'permission' && dialog.options) {
            this._respond(dialog.id, (0, acp_transcript_1.permissionResult)(response, dialog.options));
        }
        else if (dialog.kind === 'elicitation' && dialog.questions) {
            this._respond(dialog.id, (0, acp_transcript_1.askElicitationResult)(response, dialog.questions));
        }
        return Promise.resolve();
    }
    async close() {
        if (!this.alive)
            return;
        const exited = new Promise((resolve) => { this.once('exit', () => resolve()); });
        try {
            await this._request('session/close', { sessionId: this.nativeSessionId }, { timeout: 5000 });
        }
        catch { /* Closing is best effort; the signal below is authoritative. */ }
        if (!this.alive)
            return;
        this.proc.kill('SIGTERM');
        const force = setTimeout(() => { if (this.alive)
            this.proc.kill('SIGKILL'); }, 2000);
        force.unref();
        const deadline = new Promise((resolve) => { const timer = setTimeout(resolve, 5000); timer.unref(); });
        await Promise.race([exited, deadline]);
        clearTimeout(force);
    }
    kill() {
        if (!this.alive)
            return;
        try {
            this.proc.kill('SIGTERM');
        }
        catch { /* Already gone. */ }
    }
}
exports.AcpSession = AcpSession;
const acpSessions = new Map();
/** Registered as soon as the ACP session id exists, so `getAcpSession` works during startup. */
function registerAcpSession(session) {
    acpSessions.set(session.id, session);
    session.on('exit', () => {
        if (acpSessions.get(session.id) === session)
            acpSessions.delete(session.id);
    });
}
function spawnAcp(cwd, opts) {
    const { argv, env } = launchAgy(opts);
    return (0, child_process_1.spawn)(argv[0], argv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
}
async function createAcpSession(opts) {
    const session = new AcpSession(spawnAcp(opts.cwd, opts), opts.cwd);
    try {
        await session._start(opts);
        return session;
    }
    catch (error) {
        session.kill();
        throw error;
    }
}
const resumingByFile = new Map();
async function _resumeAcpSession(sessionFile, opts) {
    const header = (0, acp_transcript_1.readAcpMirrorHeader)(sessionFile);
    const live = acpSessions.get(header.id);
    if (live?.alive)
        return live;
    const cwd = opts.cwd || header.cwd || process.cwd();
    const session = new AcpSession(spawnAcp(cwd, { ...opts, sessionId: header.id }), cwd);
    try {
        await session._startResume(header.id, sessionFile, opts);
        return session;
    }
    catch (error) {
        session.kill();
        throw error;
    }
}
/** Resume one mirror; concurrent resumes of the same file share a single child. */
async function resumeAcpSession(sessionFile, opts = {}) {
    const inFlight = resumingByFile.get(sessionFile);
    if (inFlight)
        return inFlight;
    const promise = _resumeAcpSession(sessionFile, opts);
    resumingByFile.set(sessionFile, promise);
    try {
        return await promise;
    }
    finally {
        resumingByFile.delete(sessionFile);
    }
}
function getAcpSession(nativeId) {
    return typeof nativeId === 'string' ? acpSessions.get(nativeId) : undefined;
}
function getAllAcpSessions() {
    return [...acpSessions.values()];
}
async function shutdownAcpSessions() {
    await Promise.all(getAllAcpSessions().map(async (session) => {
        try {
            await session.close();
        }
        catch {
            session.kill();
        }
    }));
}
