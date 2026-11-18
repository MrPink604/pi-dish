#!/usr/bin/env node
// Generated from src/core/agy-relay.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Antigravity bridge relay: one per `agy` session, launched by pi-dish into the
 * session's tmux pane. It owns the `agy acp` stdio child (through AcpSession),
 * keeps the Pi-format mirror and the raw sidecar, publishes the bridge registry
 * claim, and serves pi-dish's bridge socket protocol. Because the pane — not a
 * server child — owns the ACP state, a pi-dish restart reconnects to a turn
 * that is still running instead of losing it.
 *
 * Usage:
 *   agy-relay new --cwd <dir> [--model <id>] [--thinking <level>]
 *   agy-relay resume <mirror.jsonl> [--model <id>] [--thinking <level>]
 *
 * `PI_DISH_AGY_COMMAND` still names the agy binary (a shell-style command line);
 * `PI_DISH_SPAWN_TOKEN` correlates this claim with the launch that started it.
 * Nothing here reads agy tokens or injects prompt text.
 */
const fs = require("fs");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const events_1 = require("events");
const acp_session_1 = require("./acp-session");
const acp_transcript_1 = require("./acp-transcript");
const session_capabilities_1 = require("./session-capabilities");
const dish_store_1 = require("./dish-store");
const harnesses_1 = require("./harnesses");
const process_identity_1 = require("./process-identity");
const extension_ui_state_1 = require("./extension-ui-state");
const wire_protocol_1 = require("./wire-protocol");
const helper_values_1 = require("./helper-values");
const http_boundary_1 = require("./http-boundary");
const REGISTRY_DIR = path.join((0, dish_store_1.dishDir)(), 'sessions');
const MAX_SOCKET_PATH_BYTES = 103;
/** AcpSession events fanned out to every connected pi-dish socket. */
const BRIDGE_EVENTS = [
    'agent_start', 'turn_start', 'message_start', 'message_update', 'message_end',
    'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
    'turn_end', 'agent_end', 'extension_ui_request',
];
/** Boundaries after which the registry claim is refreshed. */
const CLAIM_BOUNDARIES = {
    agent_start: true, turn_start: true, message_end: true, turn_end: true, agent_end: true,
    extension_ui_request: true,
};
function log(line) {
    try {
        process.stdout.write(`[agy-relay] ${line}\n`);
    }
    catch { }
}
function optionValue(args, index, flag) {
    const value = args[index];
    if (value === undefined || value.startsWith('--'))
        throw new Error(`${flag} requires a value`);
    return value;
}
function parseRelayArgs(argv) {
    const [mode, ...rest] = argv;
    let options;
    if (mode === 'new')
        options = { mode };
    else if (mode === 'resume') {
        if (!rest[0] || rest[0].startsWith('--'))
            throw new Error('resume requires a mirror path');
        options = { mode, file: rest[0] };
        rest.shift();
    }
    else {
        throw new Error('usage: agy-relay new --cwd <dir> | agy-relay resume <mirror.jsonl>');
    }
    for (let index = 0; index < rest.length; index++) {
        const flag = rest[index];
        const equals = flag.indexOf('=');
        const name = equals > 0 ? flag.slice(0, equals) : flag;
        const inline = equals > 0 ? flag.slice(equals + 1) : null;
        const read = () => inline ?? optionValue(rest, ++index, name);
        if (name === '--cwd')
            options.cwd = read();
        else if (name === '--model')
            options.model = read();
        else if (name === '--thinking')
            options.thinking = read();
        else
            throw new Error(`unknown relay argument: ${flag}`);
    }
    if (options.mode === 'new' && !options.cwd)
        options.cwd = process.cwd();
    return options;
}
function socketPathFor(sessionId) {
    const dir = process.env.PI_DISH_SOCKET_DIR || path.join((0, dish_store_1.dishDir)(), 'sockets');
    const file = path.join(dir, `${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}.sock`);
    const bytes = Buffer.byteLength(file);
    if (bytes > MAX_SOCKET_PATH_BYTES) {
        throw new Error(`Unix socket path is ${bytes} bytes (maximum ${MAX_SOCKET_PATH_BYTES}): ${file}`);
    }
    return file;
}
function wrapperVersion() {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        const version = (0, helper_values_1.record)(raw) ? raw.version : undefined;
        return typeof version === 'string' && version ? version : '0';
    }
    catch {
        return '0';
    }
}
/** `PI_DISH_AGY_COMMAND` is a command line; AcpSession appends the ACP argv. */
function agyChildLaunch() {
    const parsed = (0, harnesses_1.parseLaunchWords)(process.env.PI_DISH_AGY_COMMAND || 'agy');
    const words = parsed.words.length ? parsed.words : ['agy'];
    return { command: words[0], args: words.slice(1), env: parsed.env };
}
async function main() {
    const options = parseRelayArgs(process.argv.slice(2));
    const child = agyChildLaunch();
    const relayInstanceId = crypto.randomUUID();
    const relayProcess = (0, process_identity_1.processIdentity)(process.pid);
    if (!relayProcess)
        throw new Error('Cannot read this process birth identity; refusing to publish a stale claim');
    let session;
    if (options.mode === 'new') {
        session = await (0, acp_session_1.createAcpSession)({
            cwd: options.cwd || process.cwd(),
            model: options.model ?? null,
            thinking: options.thinking ?? null,
            ...child,
        });
    }
    else {
        session = await (0, acp_session_1.resumeAcpSession)(options.file, {
            model: options.model ?? null,
            thinking: options.thinking ?? null,
            ...child,
        });
    }
    const clients = new Set();
    let server = null;
    let socketPath = '';
    let socketIno = null;
    let socketReady = false;
    let shuttingDown = false;
    const wrapper = Object.freeze({
        harnessId: 'agy', name: 'pi-dish-agy-relay', wrapperVersion: wrapperVersion(),
        eventProfile: 'agy-v1',
    });
    function contextUsageSnapshot() {
        const usage = (0, wire_protocol_1.asRecord)((0, wire_protocol_1.asRecord)(session.lastStats).contextUsage);
        const tokens = typeof usage.tokens === 'number' && Number.isFinite(usage.tokens) ? usage.tokens : null;
        const contextWindow = typeof usage.contextWindow === 'number' && Number.isFinite(usage.contextWindow) ? usage.contextWindow : null;
        const percent = typeof usage.percent === 'number' && Number.isFinite(usage.percent) ? usage.percent : null;
        if (tokens === null && contextWindow === null)
            return null;
        return { tokens, contextWindow, percent };
    }
    function modelSnapshot() {
        const model = (0, wire_protocol_1.asRecord)(session.state.model);
        const id = typeof model.id === 'string' && model.id ? model.id : null;
        const provider = typeof model.provider === 'string' && model.provider ? model.provider : acp_transcript_1.AGY_PROVIDER;
        return id ? `${provider}/${id}` : null;
    }
    /** Registry/hello claim: identity fields are immutable for this relay. */
    function claim() {
        const state = (0, wire_protocol_1.asRecord)(session.state);
        const name = typeof state.name === 'string' && state.name ? state.name : null;
        const thinkingLevel = typeof state.thinkingLevel === 'string' && state.thinkingLevel ? state.thinkingLevel : null;
        return {
            protocolVersion: 2,
            wrapper,
            harnessId: 'agy',
            bridgeInstanceId: relayInstanceId,
            instanceId: relayInstanceId,
            nativeSessionId: session.id,
            sessionId: session.id,
            capabilities: session_capabilities_1.AGY_ACP_CAPABILITIES,
            sessionFile: session.sessionFile,
            cwd: session.cwd,
            pid: process.pid,
            startTime: relayProcess.startTime,
            socketPath,
            name,
            model: modelSnapshot(),
            thinkingLevel,
            contextUsage: contextUsageSnapshot(),
            turnInProgress: session.turnInProgress === true,
            askPending: session.extUIState.dialogs.size > 0,
            compacting: false,
            spawnToken: process.env.PI_DISH_SPAWN_TOKEN || null,
        };
    }
    function lifecycleSnapshot() {
        const pendingDialogs = session.extUIState.dialogs.size;
        return {
            idle: !session.turnInProgress && pendingDialogs === 0,
            pendingMessages: false,
            pendingDialogs,
            backgroundWork: false,
        };
    }
    function writeClaim() {
        if (!socketReady)
            return;
        try {
            fs.mkdirSync(REGISTRY_DIR, { recursive: true });
            fs.writeFileSync(path.join(REGISTRY_DIR, `${session.id}.json`), JSON.stringify({ ...claim(), updatedAt: new Date().toISOString() }, null, 2));
        }
        catch (error) {
            log(`claim write failed: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
    function send(sock, frame) {
        try {
            sock.write(JSON.stringify(frame) + '\n');
        }
        catch { }
    }
    function broadcast(frame) {
        const line = JSON.stringify(frame) + '\n';
        for (const client of clients) {
            try {
                client.write(line);
            }
            catch { }
        }
    }
    function replayExtensionUI(sock) {
        const ui = session.extUIState;
        for (const request of [...ui.widgets.values(), ...ui.statuses.values(), ...ui.dialogs.values()]) {
            send(sock, { type: 'event', event: 'extension_ui_request', data: request });
        }
    }
    function respond(sock, cmd, success, data, error) {
        send(sock, {
            type: 'response', id: cmd.id ?? null, command: cmd.command, success,
            ...(data === undefined ? {} : { data }),
            ...(error ? { error } : {}),
        });
    }
    function splitCommand(message) {
        const space = message.indexOf(' ');
        return {
            name: (space === -1 ? message.slice(1) : message.slice(1, space)).trim(),
            args: space === -1 ? '' : message.slice(space + 1).trim(),
        };
    }
    /** `/model`, `/thinking` and `/abort` are ACP requests; agy's own commands are prompt text. */
    async function runCommand(message) {
        const { name, args } = splitCommand(message);
        if (name === 'abort') {
            await session.abort();
            return { info: 'Aborted' };
        }
        if (name === 'thinking') {
            if (!args)
                throw new Error('usage: /thinking <level>');
            await session.setThinkingLevel(args);
            return { info: `Thinking level: ${args}` };
        }
        if (name === 'model') {
            if (!args)
                throw new Error('usage: /model <provider/model-id>');
            const slash = args.indexOf('/');
            await session.setModel(slash > 0 ? args.slice(0, slash) : acp_transcript_1.AGY_PROVIDER, slash > 0 ? args.slice(slash + 1) : args);
            return { info: `Model set to ${args}` };
        }
        const listed = (0, wire_protocol_1.asRecord)(await session.getCommands());
        const known = Array.isArray(listed.commands)
            ? listed.commands.flatMap(row => (0, helper_values_1.record)(row) && typeof row.name === 'string' ? [row.name] : [])
            : [];
        if (!known.includes(name))
            throw new Error(`unknown or unsupported command: /${name}`);
        await session.prompt(message);
        return {};
    }
    async function handleCommand(cmd, sock) {
        try {
            switch (cmd.command) {
                case 'ping':
                    respond(sock, cmd, true, { pong: true });
                    return;
                case 'get_state':
                    respond(sock, cmd, true, { ...claim(), lifecycle: lifecycleSnapshot() });
                    return;
                case 'prompt':
                case 'steer': {
                    const message = typeof cmd.message === 'string' ? cmd.message : '';
                    if (!message)
                        return respond(sock, cmd, false, undefined, 'message required');
                    const images = Array.isArray(cmd.images) ? cmd.images : undefined;
                    const opts = images ? { images } : {};
                    await (cmd.command === 'steer' ? session.steer(message, opts) : session.prompt(message, opts));
                    writeClaim();
                    respond(sock, cmd, true, { queued: false });
                    return;
                }
                case 'abort':
                    await session.abort();
                    writeClaim();
                    respond(sock, cmd, true);
                    return;
                case 'set_model': {
                    const requested = typeof cmd.model === 'string' && cmd.model ? cmd.model
                        : typeof cmd.provider === 'string' && typeof cmd.modelId === 'string' ? `${cmd.provider}/${cmd.modelId}` : '';
                    if (!requested)
                        return respond(sock, cmd, false, undefined, 'model required');
                    const slash = requested.indexOf('/');
                    await session.setModel(slash > 0 ? requested.slice(0, slash) : acp_transcript_1.AGY_PROVIDER, slash > 0 ? requested.slice(slash + 1) : requested);
                    writeClaim();
                    respond(sock, cmd, true, { model: modelSnapshot() });
                    return;
                }
                case 'set_thinking_level':
                    if (typeof cmd.level !== 'string' || !cmd.level) {
                        return respond(sock, cmd, false, undefined, 'level required');
                    }
                    await session.setThinkingLevel(cmd.level);
                    writeClaim();
                    respond(sock, cmd, true, { level: cmd.level });
                    return;
                case 'get_available_models':
                    respond(sock, cmd, true, await session.getAvailableModels());
                    return;
                case 'get_commands':
                    respond(sock, cmd, true, await session.getCommands());
                    return;
                case 'run_command': {
                    if (typeof cmd.message !== 'string' || !cmd.message.startsWith('/')) {
                        return respond(sock, cmd, false, undefined, 'message must start with /');
                    }
                    const result = (0, wire_protocol_1.asRecord)(await runCommand(cmd.message));
                    writeClaim();
                    respond(sock, cmd, true, Object.keys(result).length ? result : undefined);
                    return;
                }
                case 'extension_ui_response': {
                    const requestId = String(cmd.requestId ?? '');
                    if (!requestId || !session.extUIState.dialogs.has(requestId)) {
                        return respond(sock, cmd, false, undefined, `no pending dialog with id ${requestId}`);
                    }
                    await session.respondExtensionUI(requestId, cmd);
                    (0, extension_ui_state_1.removeExtensionUIDialog)(session.extUIState, requestId);
                    broadcast({ type: 'event', event: 'extension_ui_resolved', data: { id: requestId, source: 'pi-dish' } });
                    writeClaim();
                    respond(sock, cmd, true);
                    return;
                }
                default:
                    respond(sock, cmd, false, undefined, `unsupported command ${String(cmd.command)}`);
            }
        }
        catch (error) {
            respond(sock, cmd, false, undefined, (0, http_boundary_1.errorMessage)(error));
        }
    }
    function handleClient(sock) {
        clients.add(sock);
        sock.on('close', () => clients.delete(sock));
        sock.on('error', () => { });
        let buffer = '';
        sock.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
                if (!line)
                    continue;
                let cmd;
                try {
                    cmd = JSON.parse(line);
                }
                catch {
                    respond(sock, {}, false, undefined, 'invalid JSON frame');
                    continue;
                }
                if (!(0, helper_values_1.record)(cmd)) {
                    respond(sock, {}, false, undefined, 'invalid command frame');
                    continue;
                }
                void handleCommand(cmd, sock);
            }
        });
        send(sock, { type: 'hello', ...claim(), lifecycle: lifecycleSnapshot() });
        replayExtensionUI(sock);
    }
    function unlinkOwnedClaim() {
        const file = path.join(REGISTRY_DIR, `${session.id}.json`);
        try {
            const current = JSON.parse(fs.readFileSync(file, 'utf8'));
            if ((0, helper_values_1.record)(current) && current.instanceId === relayInstanceId)
                fs.unlinkSync(file);
        }
        catch { }
    }
    /** Never unlink a socket a replacement relay already bound at the same path. */
    function unlinkOwnedSocket() {
        if (!socketPath)
            return;
        try {
            if (socketIno !== null && fs.statSync(socketPath).ino !== socketIno)
                return;
            fs.unlinkSync(socketPath);
        }
        catch { }
    }
    async function shutdown(reason, code) {
        if (shuttingDown)
            return;
        shuttingDown = true;
        log(`stopping: ${reason}`);
        for (const client of clients) {
            try {
                client.destroy();
            }
            catch { }
        }
        clients.clear();
        if (server) {
            try {
                server.close();
            }
            catch { }
        }
        socketReady = false;
        // Retire the claim and socket before the possibly slow ACP close, so a
        // restart's replacement relay cannot inherit either path.
        unlinkOwnedClaim();
        unlinkOwnedSocket();
        try {
            await session.close();
        }
        catch { }
        process.exit(code);
    }
    for (const event of BRIDGE_EVENTS) {
        session.on(event, (data) => {
            broadcast({ type: 'event', event, data });
            if (Object.hasOwn(CLAIM_BOUNDARIES, event))
                writeClaim();
        });
    }
    session.on('exit', (data) => {
        void shutdown(`agy exited with code ${String((0, wire_protocol_1.asRecord)(data).code)}`, 1);
    });
    for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
        process.on(signal, () => { void shutdown(signal, 0); });
    }
    socketPath = socketPathFor(session.id);
    fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    try {
        fs.unlinkSync(socketPath);
    }
    catch { }
    server = net.createServer(handleClient);
    // `events.once` also rejects when the listener emits 'error' before binding.
    const listening = (0, events_1.once)(server, 'listening');
    server.listen(socketPath);
    try {
        await listening;
    }
    catch (error) {
        throw new Error(`Cannot bind bridge socket ${socketPath}: ${(0, http_boundary_1.errorMessage)(error)}`);
    }
    fs.chmodSync(socketPath, 0o600);
    socketIno = fs.statSync(socketPath).ino;
    socketReady = true;
    writeClaim();
    log(`Antigravity session ${session.id} relay listening on ${socketPath}`);
}
void main().catch((error) => {
    log(`failed to start: ${(0, http_boundary_1.errorMessage)(error)}`);
    process.exit(1);
});
