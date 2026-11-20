// Generated from src/core/acp-session.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcpSession = exports.AGY_STALE_TOLERANCE_MS = exports.AGY_VERIFIED_VERSIONS = void 0;
exports.parseAgyConversationList = parseAgyConversationList;
exports.agyMirrorRoot = agyMirrorRoot;
exports.recordAgySideChatId = recordAgySideChatId;
exports.readAgySideChatIds = readAgySideChatIds;
exports.recordAgyPlanTier = recordAgyPlanTier;
exports.readAgyPlanTier = readAgyPlanTier;
exports.createAcpSession = createAcpSession;
exports.createAcpImportAgent = createAcpImportAgent;
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
const agy_brain_1 = require("./agy-brain");
/** Versions the fake agent and the captures were verified against. */
exports.AGY_VERIFIED_VERSIONS = Object.freeze(['1.5.10', '1.5.13']);
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
/**
 * agy persists a conversation slightly after pi-dish closes the mirror entry;
 * a comparison this loose still catches TUI turns, which are minutes apart.
 */
exports.AGY_STALE_TOLERANCE_MS = 5000;
function conversationTime(value) {
    if ((0, helper_values_1.finite)(value))
        return value > 1e11 ? value : value * 1000;
    if (typeof value !== 'string' || !value)
        return null;
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
}
/** Defensive read of `session/list`; unknown rows drop instead of breaking an import run. */
function parseAgyConversationList(value) {
    const result = (0, wire_protocol_1.asRecord)(value);
    const rows = Array.isArray(result.sessions) ? result.sessions : Array.isArray(value) ? value : [];
    return rows.flatMap((row) => {
        const record = (0, wire_protocol_1.asRecord)(row);
        const sessionId = (0, helper_values_1.text)(record.sessionId) || (0, helper_values_1.text)(record.session_id);
        if (!(0, session_key_1.validSessionId)(sessionId))
            return [];
        return [{
                sessionId: sessionId,
                cwd: (0, helper_values_1.text)(record.cwd) || null,
                title: (0, helper_values_1.text)(record.title) || (0, helper_values_1.text)(record.name) || null,
                updatedAt: conversationTime(record.updatedAt ?? record.updated_at),
            }];
    });
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
/**
 * Tools that intentionally remain `in_progress` in ACP while the agent sleeps
 * after `end_turn` (e.g. timers/crons): holding `turnInProgress = true` for
 * them makes an idle sleeping session appear permanently stuck working.
 */
const NON_BLOCKING_TURN_TOOLS = {
    schedule: true,
};
function isTerminalToolStatus(status) {
    return status === 'completed' || status === 'failed' || status === 'cancelled'
        || status === 'canceled' || status === 'aborted' || status === 'error';
}
function agyMirrorRoot() {
    return path.join((0, dish_store_1.dishDir)(), 'agy', 'sessions');
}
function agyTierFile() {
    return path.join((0, dish_store_1.dishDir)(), 'agy', 'tier.json');
}
function agySideChatsFile() {
    return path.join((0, dish_store_1.dishDir)(), 'agy', 'side-chats.json');
}
const MAX_RECORDED_SIDE_CHATS = 500;
/** Record an ephemeral side-chat ACP session id so `agy-import` never imports it into the sidebar. */
function recordAgySideChatId(sessionId) {
    if (!(0, session_key_1.validSessionId)(sessionId))
        return;
    try {
        const existing = [...readAgySideChatIds()].filter(id => id !== sessionId);
        existing.push(sessionId);
        const trimmed = existing.slice(-MAX_RECORDED_SIDE_CHATS);
        (0, dish_store_1.replaceFile)(agySideChatsFile(), JSON.stringify({ ids: trimmed, updatedAt: Date.now() }) + '\n', 0o600);
    }
    catch { /* Advisory filter only; never fail a side chat. */ }
}
function readAgySideChatIds() {
    try {
        const raw = JSON.parse(fs.readFileSync(agySideChatsFile(), 'utf8'));
        const ids = (0, helper_values_1.record)(raw) && Array.isArray(raw.ids) ? raw.ids : [];
        return new Set(ids.filter((id) => typeof id === 'string' && (0, session_key_1.validSessionId)(id)));
    }
    catch {
        return new Set();
    }
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
        this.replaying = false;
        this.initialized = false;
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
        this.nextStepStartedAt = null;
        this.sawStepSignal = false;
        this.turnGenMs = 0;
        this.segmentFirstOutputAt = null;
        this.turnTtftSumMs = 0;
        this.planEntries = [];
        this.taskLogTimer = null;
        this.sideSessionIds = new Set();
        this.sideListeners = new Map();
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
            this._clearTaskLogTimer();
            // Keep whatever the agent already said: an open segment would be lost otherwise.
            if (this.segment)
                this._closeSegment('error', this._takeHandoverUsage(), `agy exited with code ${code}`, true);
            this.alive = false;
            this.turnInProgress = false;
            this.segment = null;
            this.turnGenMs = 0;
            this.segmentFirstOutputAt = null;
            this.turnTtftSumMs = 0;
            this.nextStepStartedAt = null;
            this.sawStepSignal = false;
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
    /** True while a blocking (non-daemon, non-schedule) tool call has started and not yet terminated. */
    get hasActiveToolWork() {
        for (const tracked of this.toolCalls.values()) {
            if (!tracked.nonBlocking)
                return true;
        }
        return false;
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
                    this.toolCalls.clear();
                    this._closeSegment('error', this._takeHandoverUsage(), message, true);
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
            this._closeSegment((0, acp_transcript_1.acpStopReason)(stop), this._takeHandoverUsage((0, acp_transcript_1.acpUsage)(result.usage)), stop === 'refusal' ? 'Antigravity refused this request.' : null, true);
            // agy answers session/prompt with end_turn when a background command or
            // subagent yields the turn, before its tool_call_update(completed) arrives.
            // Keep the turn active and the running tool card live until it finishes.
            if (stop !== 'cancelled' && stop !== 'refusal' && this.hasActiveToolWork) {
                this._armAutonomousTimer();
                return;
            }
            if (stop === 'cancelled' || stop === 'refusal')
                this.toolCalls.clear();
            this._endTurn();
            return;
        }
        const error = (0, helper_values_1.record)(frame.error) ? (0, helper_values_1.text)(frame.error.message) || 'Antigravity request failed' : '';
        this.pending.settle(id, frame.error === undefined, frame.result, error, 'Antigravity request failed');
    }
    _handleNotification(method, params) {
        if (method !== 'session/update')
            return;
        const payload = (0, wire_protocol_1.asRecord)(params);
        const sid = (0, helper_values_1.text)(payload.sessionId);
        if (sid && this.sideSessionIds.has(sid)) {
            const listener = this.sideListeners.get(sid);
            if (listener)
                listener((0, wire_protocol_1.asRecord)(payload.update));
            return;
        }
        this._sessionUpdate(payload.update);
    }
    _handleRequest(frame) {
        const id = frame.id;
        const method = (0, helper_values_1.text)(frame.method);
        const params = (0, wire_protocol_1.asRecord)(frame.params);
        const sid = (0, helper_values_1.text)(params.sessionId);
        if (sid && this.sideSessionIds.has(sid)) {
            if (method === 'elicitation/create')
                this._respond(id, { action: 'cancel' });
            else if (method === 'session/request_permission')
                this._respond(id, { outcome: { outcome: 'cancelled' } });
            else
                this._respondError(id, -32601, `Unsupported side-session ACP method: ${method}`);
            return;
        }
        const key = String(id);
        if (method === 'session/request_permission' || method === 'elicitation/create') {
            this._noteActivity();
            this.nextStepStartedAt = null;
        }
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
    _isPassiveToolCompletion(kind, update) {
        if (this.turnInProgress || kind !== 'tool_call_update')
            return false;
        if (!isTerminalToolStatus((0, helper_values_1.text)(update.status)))
            return false;
        const tracked = this.toolCalls.get((0, helper_values_1.text)(update.toolCallId));
        return tracked?.nonBlocking === true;
    }
    _sessionUpdate(raw) {
        const update = (0, helper_values_1.record)(raw) ? raw : {};
        const kind = (0, helper_values_1.text)(update.sessionUpdate);
        if (this.replaying) {
            this.transcript?.applyReplayUpdate(update);
            return;
        }
        if (Object.hasOwn(ACTIVITY_UPDATES, kind) && !this._isPassiveToolCompletion(kind, update))
            this._noteActivity();
        switch (kind) {
            case 'agent_message_chunk': {
                const content = (0, wire_protocol_1.asRecord)(update.content);
                if (content.type === 'text')
                    this._pushChunk('text', (0, helper_values_1.text)(content.text));
                else {
                    const img = (0, acp_transcript_1.extractAcpImageBlock)(content, this._allowedImageRoots());
                    if (img)
                        this._pushImage(img);
                }
                return;
            }
            case 'agent_thought_chunk': {
                const content = (0, wire_protocol_1.asRecord)(update.content);
                if (content.type === 'text')
                    this._pushChunk('thinking', (0, helper_values_1.text)(content.text));
                return;
            }
            case 'user_message_chunk':
                // Only `session/load` replay emits these; live prompts are mirrored outbound.
                return;
            case 'tool_call':
                this._toolCall(update);
                return;
            case 'tool_call_update':
                this._toolUpdate(update);
                return;
            case 'plan': {
                this.planEntries = (0, acp_transcript_1.normalizeAcpPlan)(update.entries);
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
                if (this.turnInProgress)
                    this.sawStepSignal = true;
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
    _allowedImageRoots() {
        const roots = [];
        if (this.cwd)
            roots.push(this.cwd);
        const brain = (0, agy_brain_1.agyBrainDir)(this.nativeSessionId);
        if (brain)
            roots.push(brain);
        return roots;
    }
    _pushImage(img) {
        this.sawStepSignal = true;
        this._ensureSegment();
        this.segmentFirstOutputAt ??= Date.now();
        const message = this.segment;
        message.content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
        this.lastActivityAt = new Date();
        this.emitEvent('message_update', { type: 'message_update', message: structuredClone(message) });
    }
    _pushChunk(type, chunk) {
        this.sawStepSignal = true;
        this._ensureSegment();
        this.segmentFirstOutputAt ??= Date.now();
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
    _ensureSegment(consumeStepStart = true) {
        if (this.segment)
            return;
        const now = Date.now();
        const startedAt = consumeStepStart && this.nextStepStartedAt !== null && this.nextStepStartedAt <= now
            ? this.nextStepStartedAt
            : now;
        if (consumeStepStart)
            this.nextStepStartedAt = null;
        const message = {
            role: 'assistant',
            content: [],
            timestamp: startedAt,
            api: 'acp',
            provider: acp_transcript_1.AGY_PROVIDER,
        };
        const model = this._currentModelId();
        if (model)
            message.model = model;
        this.segment = message;
        this.emitEvent('message_start', { type: 'message_start', message: structuredClone(message) });
    }
    _closeSegment(stopReason, usage, errorMessage, resetTurn = false) {
        // A turn that ends right after a tool call, cancels early, or fails/refuses
        // before streaming any chunk has no open segment; open a shell so usage,
        // abort state and errors reach the mirror and SSE.
        if (!this.segment && (errorMessage || usage || stopReason === 'aborted' || stopReason === 'error')) {
            this._ensureSegment(true);
        }
        const message = this.segment;
        const closedAt = Date.now();
        const firstOutputAt = this.segmentFirstOutputAt;
        this.segmentFirstOutputAt = null;
        if (!message) {
            if (resetTurn) {
                this.turnGenMs = 0;
                this.turnTtftSumMs = 0;
                this.nextStepStartedAt = null;
                this.sawStepSignal = false;
            }
            return;
        }
        this.segment = null;
        const startedAt = (0, helper_values_1.finite)(message.timestamp) ? message.timestamp : closedAt;
        const stepMs = Math.max(0, closedAt - startedAt);
        const stepTtftMs = stepMs > 0 && firstOutputAt !== null
            ? Math.min(stepMs, Math.max(0, firstOutputAt - startedAt))
            : null;
        if (stepTtftMs !== null)
            message.ttft = stepTtftMs;
        message.stopReason = stopReason;
        if (usage) {
            const priorGenMs = this.turnGenMs;
            const totalGenMs = priorGenMs + stepMs;
            const totalTtftMs = this.turnTtftSumMs + (stepTtftMs ?? 0);
            if (totalGenMs > 0)
                message.turnDurationMs = totalGenMs;
            if (priorGenMs > 0 && totalTtftMs > 0)
                message.turnTtftMs = totalTtftMs;
            this.turnGenMs = 0;
            this.turnTtftSumMs = 0;
            message.usage = usage;
        }
        else if (resetTurn) {
            this.turnGenMs = 0;
            this.turnTtftSumMs = 0;
        }
        else {
            this.turnGenMs += stepMs;
            this.turnTtftSumMs += stepTtftMs ?? 0;
        }
        if (resetTurn) {
            this.nextStepStartedAt = null;
            this.sawStepSignal = false;
        }
        if (errorMessage)
            message.errorMessage = errorMessage;
        const event = { type: 'message_end', message };
        // The mirror must be on disk before `message_end`: the browser re-reads it on turn_end.
        this.transcript?.appendAssistant(message, closedAt);
        this.lastActivityAt = new Date();
        this.emitEvent('message_end', event);
        this.endAssistantMessage(event);
    }
    _toolCall(update) {
        const call = (0, acp_transcript_1.normalizeAcpTool)(update);
        const toolCallId = (0, helper_values_1.text)(update.toolCallId) || `call-${++this.counter}`;
        const consumeStep = this.sawStepSignal;
        this.sawStepSignal = false;
        if (this.segment || this.turnInProgress) {
            this._ensureSegment(consumeStep);
            if (consumeStep)
                this.segmentFirstOutputAt ??= Date.now();
            this.segment.content.push({ type: 'toolCall', id: toolCallId, name: call.toolName, arguments: call.args });
            // Pi needs the assistant message before its tool results; ACP interleaves them.
            this._closeSegment('toolUse', null, null);
        }
        const startedAt = Date.now();
        const rawArgs = {
            ...((0, helper_values_1.record)(update.rawInput) ? update.rawInput : {}),
            ...((0, helper_values_1.record)(update.args) ? update.args : {}),
        };
        const waitMs = (0, helper_values_1.finite)(rawArgs.WaitMsBeforeAsync) && rawArgs.WaitMsBeforeAsync > 0 ? rawArgs.WaitMsBeforeAsync : null;
        const isDaemon = rawArgs.IsDaemon === true || rawArgs.isDaemon === true || rawArgs.IsDaemon === 'true' || rawArgs.isDaemon === 'true';
        const nonBlocking = isDaemon || Object.hasOwn(NON_BLOCKING_TURN_TOOLS, call.nativeName);
        const status = (0, helper_values_1.text)(update.status);
        const terminal = isTerminalToolStatus(status);
        this.nextStepStartedAt = status === 'pending' ? null : (waitMs !== null ? startedAt + waitMs : null);
        if (!terminal) {
            this.toolCalls.set(toolCallId, { call, startedAt, waitMsBeforeAsync: waitMs, isDaemon, nonBlocking, lastStreamedLog: '' });
            this._syncTaskLogTimer();
        }
        if (call.nativeName === 'ask_question' && !terminal) {
            const args = (0, helper_values_1.record)(update.args) ? update.args : {};
            this.askQuestions.set(toolCallId, Array.isArray(args.questions) ? args.questions : []);
        }
        if (!terminal) {
            this._emitTool('tool_execution_start', { toolCallId, toolName: call.toolName, args: call.args, startedAt });
        }
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
        const result = (0, acp_transcript_1.acpToolResult)(update, tracked.call, { allowedRoots: this._allowedImageRoots() });
        if (isTerminalToolStatus(status)) {
            // If the agent spoke while a background tool ran, close that interim
            // segment before recording the toolResult so transcript order stays chronological.
            if (this.segment)
                this._closeSegment('stop', null, null);
            const isError = status !== 'completed';
            this.toolCalls.delete(toolCallId);
            this.askQuestions.delete(toolCallId);
            this._syncTaskLogTimer();
            this.nextStepStartedAt = Date.now();
            this.sawStepSignal = false;
            // agy ACP omits output on non-filesystem tools (`swarm`, `read_board`,
            // `invoke_subagent`, `manage_task`, ...); enrich from brain step output when empty.
            const resultText = result.text || (0, agy_brain_1.findLatestToolStepOutput)(this.nativeSessionId, tracked.call.nativeName) || '';
            const resultContent = [];
            if (resultText || !result.images?.length)
                resultContent.push({ type: 'text', text: resultText });
            for (const img of result.images ?? []) {
                resultContent.push({ type: 'image', data: img.data, mimeType: img.mimeType });
            }
            this.transcript?.appendToolResult({
                toolCallId,
                toolName: tracked.call.toolName,
                content: resultText,
                ...(result.images?.length ? { images: result.images } : {}),
                isError,
                ...(result.details ? { details: result.details } : {}),
            });
            this._emitTool('tool_execution_end', {
                toolCallId,
                toolName: tracked.call.toolName,
                args: tracked.call.args,
                startedAt: tracked.startedAt,
                isError,
                result: { content: resultContent, ...(result.details ? { details: result.details } : {}) },
            });
            return;
        }
        if (status === 'pending') {
            this.nextStepStartedAt = null;
        }
        else if (status === 'in_progress') {
            this.nextStepStartedAt = tracked.waitMsBeforeAsync !== null ? Date.now() + tracked.waitMsBeforeAsync : null;
        }
        const progress = result.text || (status === 'pending' ? 'Waiting for approval' : 'Running…');
        const partialContent = [{ type: 'text', text: progress }];
        for (const img of result.images ?? []) {
            partialContent.push({ type: 'image', data: img.data, mimeType: img.mimeType });
        }
        this._emitTool('tool_execution_update', {
            toolCallId,
            toolName: tracked.call.toolName,
            args: tracked.call.args,
            startedAt: tracked.startedAt,
            partialResult: { content: partialContent },
        });
    }
    _emitTool(event, data) {
        (0, running_tool_calls_1.trackRunningToolCalls)(this.runningToolCalls, event, data);
        this.emitEvent(event, data);
    }
    _endTurn() {
        this._clearAutonomousTimer();
        this._syncTaskLogTimer();
        this.turnInProgress = false;
        this.lastActivityAt = new Date();
        (0, running_tool_calls_1.trackRunningToolCalls)(this.runningToolCalls, 'turn_end', { type: 'turn_end' });
        this.emitEvent('turn_end', { type: 'turn_end' });
        this.emitEvent('agent_end', { type: 'agent_end' });
        this._refreshStats();
    }
    /**
     * agy keeps working without an open prompt when a background command or
     * subagent runs past `session/prompt`'s `end_turn` response (or wakes the
     * agent later). Keep the turn alive while non-daemon tool calls or dialogs
     * are open, and end it once frames go quiet with nothing pending.
     */
    _noteActivity() {
        if (!this.turnInProgress) {
            this.turnInProgress = true;
            if (this.newestPromptId === null) {
                this.nextStepStartedAt ??= Date.now();
                this.sawStepSignal = true;
            }
            this.emitEvent('agent_start', { type: 'agent_start' });
            this.emitEvent('turn_start', { type: 'turn_start' });
        }
        if (this.newestPromptId !== null)
            return;
        this._armAutonomousTimer();
    }
    _armAutonomousTimer() {
        this._clearAutonomousTimer();
        this.autonomousTimer = setTimeout(() => this._autonomousIdle(), autonomousIdleMs());
        this.autonomousTimer.unref();
    }
    /**
     * Reconcile open background shell/workflow tool calls against brain
     * transcripts when ACP misses a terminal `tool_call_update` (e.g. task
     * cancellation or internal server restart). Only acts when a brain
     * transcript explicitly records the matching task as finished/killed.
     */
    _reconcileFinishedBrainTools() {
        if (!this.hasActiveToolWork)
            return;
        const transcriptFile = (0, agy_brain_1.agyBrainTranscriptPath)(this.nativeSessionId);
        if (!transcriptFile || !fs.existsSync(transcriptFile))
            return;
        const tasks = (0, agy_brain_1.readAgyBackgroundTasks)(this.nativeSessionId, true);
        if (!tasks.length)
            return;
        for (const [toolCallId, tracked] of [...this.toolCalls]) {
            if (tracked.nonBlocking)
                continue;
            if (tracked.call.nativeName !== 'run_command' && tracked.call.nativeName !== 'run_workflow')
                continue;
            const expectedKind = tracked.call.nativeName === 'run_command' ? 'shell' : 'workflow';
            const expectedCmd = expectedKind === 'shell' ? (0, helper_values_1.text)(tracked.call.args.command).trim() : '';
            const matched = tasks.find((task) => {
                if (task.kind !== expectedKind)
                    return false;
                if (expectedKind === 'shell') {
                    if (!expectedCmd || !task.command || task.command.trim() !== expectedCmd)
                        return false;
                }
                const startedMs = task.startedAt ? Date.parse(task.startedAt) : NaN;
                return !Number.isFinite(startedMs) || Math.abs(startedMs - tracked.startedAt) <= 60_000;
            });
            if (!matched || (matched.status !== 'completed' && matched.status !== 'failed' && matched.status !== 'killed'))
                continue;
            this.toolCalls.delete(toolCallId);
            this.askQuestions.delete(toolCallId);
            const isError = matched.status !== 'completed';
            const summaryText = matched.status === 'killed'
                ? 'Background task stopped.'
                : matched.exitCode !== null ? `Command exited with code ${matched.exitCode}.` : 'Background task finished.';
            this.transcript?.appendToolResult({
                toolCallId,
                toolName: tracked.call.toolName,
                content: summaryText,
                isError,
            });
            this._emitTool('tool_execution_end', {
                toolCallId,
                toolName: tracked.call.toolName,
                args: tracked.call.args,
                startedAt: tracked.startedAt,
                isError,
                result: { content: [{ type: 'text', text: summaryText }] },
            });
        }
        this._syncTaskLogTimer();
    }
    _autonomousIdle() {
        this.autonomousTimer = null;
        if (!this.alive || this.newestPromptId !== null || !this.turnInProgress)
            return;
        if (this.hasActiveToolWork)
            this._reconcileFinishedBrainTools();
        if (this.inbound.size > 0 || this.hasActiveToolWork) {
            // Flush any interim assistant status text while waiting on a long
            // background tool so reconnects see it and post-tool output starts fresh.
            if (this.hasActiveToolWork && this.segment)
                this._closeSegment('stop', null, null, true);
            this._armAutonomousTimer();
            return;
        }
        let usage = this._takeHandoverUsage();
        if (!usage && this.segment) {
            const segStart = (0, helper_values_1.finite)(this.segment.timestamp) ? this.segment.timestamp - 5000 : undefined;
            usage = (0, agy_brain_1.readLatestAgyBrainStepUsage)(this.nativeSessionId, segStart);
        }
        this._closeSegment('stop', usage, null, true);
        this._endTurn();
    }
    _clearAutonomousTimer() {
        if (this.autonomousTimer)
            clearTimeout(this.autonomousTimer);
        this.autonomousTimer = null;
    }
    _hasRunningShellTools() {
        for (const tracked of this.toolCalls.values()) {
            if (tracked.call.nativeName === 'run_command' && !tracked.isDaemon)
                return true;
        }
        return false;
    }
    _syncTaskLogTimer() {
        if (!this.alive || !this._hasRunningShellTools()) {
            this._clearTaskLogTimer();
            return;
        }
        if (this.taskLogTimer)
            return;
        this.taskLogTimer = setInterval(() => this._pollRunningTaskLogs(), 1500);
        this.taskLogTimer.unref();
    }
    _clearTaskLogTimer() {
        if (this.taskLogTimer)
            clearInterval(this.taskLogTimer);
        this.taskLogTimer = null;
    }
    /** Stream live `.system_generated/tasks/task-*.log` tails onto backgrounded bash cards. */
    _pollRunningTaskLogs() {
        if (!this.alive || !this._hasRunningShellTools()) {
            this._clearTaskLogTimer();
            return;
        }
        const now = Date.now();
        for (const [toolCallId, tracked] of this.toolCalls) {
            if (tracked.call.nativeName !== 'run_command' || tracked.isDaemon)
                continue;
            const asyncAfter = tracked.waitMsBeforeAsync ?? 5000;
            if (now - tracked.startedAt < asyncAfter)
                continue;
            const tail = (0, agy_brain_1.readRunningTaskLogTail)(this.nativeSessionId, (0, helper_values_1.text)(tracked.call.args.command));
            if (!tail || tail === tracked.lastStreamedLog)
                continue;
            tracked.lastStreamedLog = tail;
            this._emitTool('tool_execution_update', {
                toolCallId,
                toolName: tracked.call.toolName,
                args: tracked.call.args,
                startedAt: tracked.startedAt,
                partialResult: { content: [{ type: 'text', text: tail }] },
            });
        }
    }
    getPlan() {
        return this.planEntries.map(entry => ({ ...entry }));
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
    _adoptSession(result, sessionId, sessionFile, options = {}) {
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
        this.transcript = options.transcript ?? new acp_transcript_1.AcpTranscript({
            file: sessionFile,
            sessionId,
            cwd: this.cwd,
            agentVersion: this.agentVersion,
        });
        for (const frame of this.earlyFrames)
            this.transcript.appendRaw(frame.dir, frame.msg);
        this.earlyFrames = [];
        if (options.register !== false)
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
        if (this.initialized)
            return;
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
        this.initialized = true;
        this._warnUnverifiedVersion();
    }
    async _setConfigOption(configId, value) {
        const result = await this._request('session/set_config_option', { sessionId: this.nativeSessionId, configId, value }, { timeout: 15000 });
        // agy 1.5.10 returns the refreshed options (e.g. Hydrogen's xhigh ladder) in the
        // result rather than as a config_option_update notification.
        const options = (0, wire_protocol_1.asRecord)(result).configOptions;
        if (Array.isArray(options))
            this._applyConfigUpdate({ configOptions: options });
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
    /**
     * Open an ephemeral sibling ACP session on the same `agy acp` process for
     * pi-dish's `/btw` Side Chat. Never creates a mirror or touches main session state.
     */
    async openSideSession() {
        if (!this.alive)
            throw new Error('Antigravity session is not running');
        const result = (0, wire_protocol_1.asRecord)(await this._request('session/new', { cwd: this.cwd, mcpServers: [] }, { timeout: 30000 }));
        const sideId = (0, helper_values_1.text)(result.sessionId);
        if (!sideId)
            throw new Error('Antigravity did not return a side-chat session id');
        this.sideSessionIds.add(sideId);
        recordAgySideChatId(sideId);
        const model = this._currentModelId();
        const level = this._configValue('thought_level');
        if (model) {
            await this._request('session/set_config_option', { sessionId: sideId, configId: 'model', value: model }, { timeout: 10000 }).catch(() => { });
        }
        if (level) {
            await this._request('session/set_config_option', { sessionId: sideId, configId: 'thought_level', value: level }, { timeout: 10000 }).catch(() => { });
        }
        return sideId;
    }
    async promptSideSession(sideId, question, opts) {
        if (!this.alive)
            throw new Error('Antigravity session is not running');
        if (opts.signal.aborted)
            throw new Error('Cancelled');
        this.sideSessionIds.add(sideId);
        let answer = '';
        this.sideListeners.set(sideId, (update) => {
            if ((0, helper_values_1.text)(update.sessionUpdate) !== 'agent_message_chunk')
                return;
            const content = (0, wire_protocol_1.asRecord)(update.content);
            if (content.type !== 'text')
                return;
            const chunk = (0, helper_values_1.text)(content.text);
            if (!chunk)
                return;
            answer += chunk;
            opts.onTextDelta(chunk);
        });
        const onAbort = () => {
            try {
                this._notify('session/cancel', { sessionId: sideId });
            }
            catch { }
        };
        opts.signal.addEventListener('abort', onAbort, { once: true });
        try {
            const result = (0, wire_protocol_1.asRecord)(await this._request('session/prompt', { sessionId: sideId, prompt: [{ type: 'text', text: question }] }, { timeout: 600_000 }));
            if (opts.signal.aborted || (0, helper_values_1.text)(result.stopReason) === 'cancelled') {
                throw new Error('Cancelled');
            }
            if ((0, helper_values_1.text)(result.stopReason) === 'refusal') {
                throw new Error('Antigravity refused this request.');
            }
            return answer;
        }
        finally {
            opts.signal.removeEventListener('abort', onAbort);
            this.sideListeners.delete(sideId);
        }
    }
    async closeSideSession(sideId) {
        this.sideListeners.delete(sideId);
        this.sideSessionIds.delete(sideId);
        if (!this.alive)
            return;
        await this._request('session/close', { sessionId: sideId }, { timeout: 5000 }).catch(() => { });
    }
    /**
     * Rebuild a conversation's mirror from `session/load` replay. The previous
     * mirror and sidecar are kept as `.bak`; a failed replay restores them.
     */
    async _replayInto(sessionId, sessionFile, cwd, options) {
        const backup = (0, acp_transcript_1.backupAcpMirror)(sessionFile);
        try {
            const transcript = new acp_transcript_1.AcpTranscript({
                file: sessionFile,
                sessionId,
                cwd,
                agentVersion: this.agentVersion,
                imported: { at: Date.now(), source: 'session/load' },
            });
            this.transcript = transcript;
            for (const frame of this.earlyFrames)
                transcript.appendRaw(frame.dir, frame.msg);
            this.earlyFrames = [];
            this.replaying = true;
            let result;
            try {
                result = (0, wire_protocol_1.asRecord)(await this._request('session/load', { sessionId, cwd, mcpServers: [] }, { timeout: 120000 }));
            }
            finally {
                this.replaying = false;
            }
            transcript.flushReplay();
            if (!(0, helper_values_1.text)(result.title) && options.title)
                result.title = options.title;
            this._adoptSession(result, sessionId, sessionFile, { transcript, register: options.register });
            const model = this._currentModelId();
            if (model)
                transcript.appendModelChange(model);
            const level = this._configValue('thought_level');
            if (level)
                transcript.appendThinkingLevel(level);
            const title = (0, helper_values_1.text)(result.title) || options.title;
            if (title)
                transcript.appendSessionInfo(title);
            return { result, backup };
        }
        catch (error) {
            this.transcript = null;
            (0, acp_transcript_1.restoreAcpMirror)(sessionFile, backup);
            throw error;
        }
    }
    /** `session/list` newer than the mirror's tail means turns happened outside pi-dish. */
    async _agyHasNewerTurns(sessionId, sessionFile) {
        const conversations = await this.listConversations();
        const conversation = conversations.find(entry => entry.sessionId === sessionId);
        if (!conversation || conversation.updatedAt === null)
            return false;
        const last = (0, acp_transcript_1.readAcpMirrorLastTimestamp)(sessionFile);
        return last === null || conversation.updatedAt > last + exports.AGY_STALE_TOLERANCE_MS;
    }
    /**
     * Resume: compare `session/list` with the mirror. A newer conversation is
     * rebuilt with `session/load` so the live session continues with complete
     * history; otherwise `session/resume` keeps the existing mirror and replays
     * nothing.
     */
    async _startResume(sessionId, sessionFile, opts) {
        await this._initialize();
        let stale = false;
        try {
            stale = await this._agyHasNewerTurns(sessionId, sessionFile);
        }
        catch (error) {
            console.error(`[agy] session/list failed while checking ${sessionId}: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
        if (stale) {
            try {
                await this._replayInto(sessionId, sessionFile, this.cwd, { register: true });
                if (opts.model)
                    await this.setModel(acp_transcript_1.AGY_PROVIDER, opts.model);
                if (opts.thinking)
                    await this.setThinkingLevel(opts.thinking);
                return;
            }
            catch (error) {
                console.error(`[agy] re-import failed; keeping the existing mirror: ${(0, http_boundary_1.errorMessage)(error)}`);
            }
        }
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
    /** Every conversation agy knows about, across workspaces (`session/list`). */
    async listConversations(timeout = 20000) {
        await this._initialize();
        return parseAgyConversationList(await this._request('session/list', { cwd: this.cwd }, { timeout }));
    }
    /**
     * Import one conversation started outside pi-dish into a fresh mirror. The
     * caller owns the short-lived child (see `createAcpImportAgent`).
     */
    async importConversation(conversation, sessionFile) {
        await this._initialize();
        const { backup } = await this._replayInto(conversation.sessionId, sessionFile, conversation.cwd || this.cwd, {
            register: false,
            title: conversation.title,
        });
        return { file: sessionFile, backup: backup.mirror };
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
        const steering = this.newestPromptId !== null;
        if (this.segment)
            this._closeSegment('stop', null, null, !steering);
        else if (!steering) {
            this.turnGenMs = 0;
            this.turnTtftSumMs = 0;
        }
        const timestamp = Date.now();
        this.nextStepStartedAt = timestamp;
        this.sawStepSignal = true;
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
        if (!waiter) {
            if (this.turnInProgress) {
                this.toolCalls.clear();
                this._closeSegment('aborted', this._takeHandoverUsage(), null, true);
                this._endTurn();
            }
            return { ok: true };
        }
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
/**
 * A short-lived ACP child for `session/list` + `session/load` import work. It
 * is not registered as a live session; the caller closes it when the batch ends.
 */
async function createAcpImportAgent(opts) {
    const session = new AcpSession(spawnAcp(opts.cwd, opts), opts.cwd);
    try {
        await session._initialize();
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
