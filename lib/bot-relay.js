#!/usr/bin/env node
// Generated from src/core/bot-relay.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Bot relay: one per bot, launched by pi-dish into a tmux pane it owns. It runs
 * the bot's durable conversation (bot-runtime), keeps its Pi-format mirror,
 * publishes the bridge registry claim and serves pi-dish's bridge socket
 * protocol, so a bot lists, streams, takes prompts and is searched like any
 * session. Its state lives in `~/.pi/dish/bots/<id>/durable.sqlite`, apart
 * from this process: a killed relay resumes there, and unfinished work with it.
 *
 * Usage: bot-relay resume <mirror.jsonl>
 *
 * The mirror's header names the bot; the relay reads the bot's row from the
 * registry. pi-dish creates the mirror before the first launch.
 */
const fs = require("fs");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const child_process_1 = require("child_process");
const events_1 = require("events");
const bot_registry_1 = require("./bot-registry");
const bot_mirror_1 = require("./bot-mirror");
const bot_runtime_1 = require("./bot-runtime");
const bot_idle_rollover_1 = require("./bot-idle-rollover");
const routines_1 = require("./routines");
const routine_runner_1 = require("./routine-runner");
const bot_supervisor_1 = require("./bot-supervisor");
const code_build_1 = require("./code-build");
const session_capabilities_1 = require("./session-capabilities");
const dish_store_1 = require("./dish-store");
const process_identity_1 = require("./process-identity");
const relay_socket_1 = require("./relay-socket");
const runtime_resources_1 = require("./runtime-resources");
const session_key_1 = require("./session-key");
const helper_values_1 = require("./helper-values");
const http_boundary_1 = require("./http-boundary");
const REGISTRY_DIR = path.join((0, dish_store_1.dishDir)(), 'sessions');
const SESSIONS_CLI = (0, runtime_resources_1.runtimeResourcePath)(path.resolve(__dirname, '..'), 'skills/pi-dish-sessions/scripts/pi-dish-sessions.js');
/** Boundaries after which the registry claim is refreshed. */
const CLAIM_BOUNDARIES = {
    agent_start: true, turn_start: true, message_end: true, turn_end: true, agent_end: true,
};
process.stdout.on('error', () => { });
process.stderr.on('error', () => { });
function log(line) {
    try {
        process.stdout.write(`[bot-relay ${new Date().toISOString()}] ${line}\n`);
    }
    catch { }
}
/** The pi-dish-sessions CLI, run as the bot: its spawns are attributed to it. */
function sessionsPort(routeId) {
    return (args, signal) => new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(process.execPath, [SESSIONS_CLI, ...args], {
            // `wait` has its own --timeout.
            env: { ...process.env, PI_DISH_SESSION_ID: routeId }, maxBuffer: 8 << 20, timeout: args[0] === 'wait' ? 0 : 120_000, signal,
        }, (error, stdout, stderr) => {
            if (!error)
                return resolve(stdout);
            const detail = String(stderr).trim().replace(/^pi-dish-sessions: /, '');
            reject(new Error(`pi-dish-sessions ${args[0]} failed: ${detail || error.message}`));
        });
    });
}
/** pi-dish's own HTTP API, for routes the sessions CLI does not cover: GET, or POST with a body. */
const hubApi = async (pathname, body) => {
    const base = process.env.PI_DISH_URL || 'http://127.0.0.1:3333';
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (process.env.PI_DISH_TOKEN)
        headers.Authorization = `Bearer ${process.env.PI_DISH_TOKEN}`;
    const response = await fetch(new URL(pathname, base), {
        method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
        throw new Error((0, helper_values_1.record)(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status} from ${pathname}`);
    return data;
};
/**
 * The bot's next scheduled routine run from `from` on, read from pi-dish's routine store on this host as its scheduler
 * reads it: a run owed this minute, a catch-up included, is due now. Null when none is.
 */
function nextRoutineRun(botId, from) {
    let next = null;
    for (const routine of (0, routines_1.listRoutines)()) {
        if (routine.bot !== botId)
            continue;
        const at = (0, routine_runner_1.nextScheduledRun)(routine, from);
        if (at !== null && (next === null || at < next))
            next = at;
    }
    return next;
}
/** What a change of `~/.pi/dish/settings.json` shows: its modification time and size. */
function settingsStamp() {
    try {
        const stats = fs.statSync(path.join((0, dish_store_1.dishDir)(), 'settings.json'));
        return `${stats.mtimeMs}:${stats.size}`;
    }
    catch {
        return 'missing';
    }
}
async function main() {
    // The code this process loaded, read before a deploy can change it further.
    const build = (0, code_build_1.codeBuild)();
    const [mode, mirrorFile] = process.argv.slice(2);
    if (mode !== 'resume' || !mirrorFile)
        throw new Error('usage: bot-relay resume <mirror.jsonl> (pi-dish starts bots itself)');
    const header = (0, bot_mirror_1.readBotMirrorHeader)(mirrorFile);
    const registry = (0, bot_registry_1.openBotRegistry)(undefined, { readOnly: true });
    const loadBot = () => {
        const row = registry.get(header.id);
        if (!row)
            throw new Error(`bot ${header.id} is not in the registry`);
        return row;
    };
    const bot = loadBot();
    const relayInstanceId = crypto.randomUUID();
    const botDir = path.join((0, dish_store_1.dishDir)(), 'bots', bot.id);
    // One relay per bot: a second would run the same durable work twice. A restart starts this relay while the one
    // it replaces is still stopping.
    const lock = await (0, bot_supervisor_1.claimBotRelayWhenFree)(botDir, build);
    if (!lock.claimed)
        throw new Error(`bot ${bot.name} already has a relay (pid ${lock.holder})`);
    process.on('exit', () => lock.release());
    const relayProcess = (0, process_identity_1.processIdentity)(process.pid);
    if (!relayProcess)
        throw new Error('Cannot read this process birth identity; refusing to publish a stale claim');
    if (!(0, session_key_1.validSessionId)(bot.id))
        throw new Error(`invalid bot id ${bot.id}`);
    const routeId = (0, session_key_1.encodeSessionKey)('bot', bot.id);
    const mirror = new bot_mirror_1.BotMirror(mirrorFile, { id: bot.id, cwd: header.cwd, name: bot.name });
    if (mirror.name !== bot.name)
        mirror.appendName(mirror.lastEntryId, bot.name);
    // A bot back on other code than its last relay ran says so in its chat; the mirror is not the model's context.
    const buildFile = path.join(botDir, 'relay-build');
    let previousBuild = null;
    try {
        previousBuild = fs.readFileSync(buildFile, 'utf8').trim() || null;
    }
    catch { }
    if (previousBuild !== build && (previousBuild !== null || mirror.lastEntryId > 0)) {
        mirror.appendCustom(mirror.lastEntryId, 'bot-restart', `Restarted onto new pi-dish code (build ${previousBuild ? `${previousBuild} → ` : ''}${build}).`, { from: previousBuild, to: build }, `restart-${Date.now().toString(36)}`);
    }
    fs.writeFileSync(buildFile, `${build}\n`);
    const clients = new Set();
    let server = null;
    let socketPath = '';
    let socketIno = null;
    let socketReady = false;
    let shuttingDown = false;
    let runtime = null;
    /** Prompts and deliveries received and not yet stored: a restart now would lose them. */
    let taking = 0;
    const wrapper = Object.freeze({
        harnessId: 'bot', name: 'pi-dish-bot-relay', wrapperVersion: (0, relay_socket_1.relayWrapperVersion)(), eventProfile: 'bot-v1',
    });
    function claim() {
        return {
            protocolVersion: 2,
            wrapper,
            harnessId: 'bot',
            bridgeInstanceId: relayInstanceId,
            instanceId: relayInstanceId,
            nativeSessionId: bot.id,
            sessionId: bot.id,
            capabilities: session_capabilities_1.BOT_CAPABILITIES,
            sessionFile: mirror.file,
            cwd: header.cwd,
            pid: process.pid,
            startTime: relayProcess.startTime,
            socketPath,
            name: mirror.name,
            model: bot.model,
            thinkingLevel: bot.thinking,
            contextUsage: runtime?.contextUsage() ?? null,
            turnInProgress: runtime?.busy === true,
            askPending: false,
            compacting: false,
            spawnToken: process.env.PI_DISH_SPAWN_TOKEN || null,
        };
    }
    /** Snapshot for the hello frame; `get_state` reads the durable store. */
    function lifecycleSnapshot() {
        return { idle: runtime?.busy !== true, pendingMessages: taking > 0, pendingDialogs: 0, backgroundWork: false };
    }
    /**
     * What a restart waits for: a run in progress, input queued for the next run, or input this relay is still
     * taking. A worker watch is not background work here: it resumes after a restart.
     */
    async function lifecycle() {
        const activity = await runtime.activity();
        return { idle: !activity.running, pendingMessages: activity.queued || taking > 0, pendingDialogs: 0, backgroundWork: false };
    }
    let lastClaimBody = '';
    function writeClaim() {
        if (!socketReady)
            return;
        try {
            const next = claim();
            const body = JSON.stringify(next);
            if (body === lastClaimBody)
                return;
            fs.mkdirSync(REGISTRY_DIR, { recursive: true });
            // Replace atomically so concurrent scanRegistry() reads never observe a
            // truncated claim file and cache the live bot as absent for 500ms.
            (0, dish_store_1.replaceFile)(path.join(REGISTRY_DIR, `bot-${bot.id}.json`), JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2));
            lastClaimBody = body;
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
    function broadcast(event, data) {
        const line = JSON.stringify({ type: 'event', event, data: { type: event, ...data } }) + '\n';
        for (const client of clients) {
            try {
                client.write(line);
            }
            catch { }
        }
        if (Object.hasOwn(CLAIM_BOUNDARIES, event))
            writeClaim();
    }
    function respond(sock, cmd, success, data, error) {
        send(sock, {
            type: 'response', id: cmd.id ?? null, command: cmd.command, success,
            ...(data === undefined ? {} : { data }),
            ...(error ? { error } : {}),
        });
    }
    async function handleCommand(cmd, sock) {
        try {
            const bot = runtime;
            if (!bot)
                return respond(sock, cmd, false, undefined, 'the bot is still starting');
            switch (cmd.command) {
                case 'ping':
                    return respond(sock, cmd, true, { pong: true });
                case 'get_state':
                    return respond(sock, cmd, true, { ...claim(), lifecycle: await lifecycle() });
                case 'get_commands':
                    return respond(sock, cmd, true, { commands: [] });
                case 'prompt':
                case 'steer': {
                    const message = typeof cmd.message === 'string' ? cmd.message : '';
                    // Images reach the model after the text; a message of images alone is a message.
                    const images = (0, bot_runtime_1.botImages)(cmd.images);
                    if (!message && !images.length)
                        return respond(sock, cmd, false, undefined, 'message required');
                    const queued = bot.busy;
                    taking++;
                    try {
                        await bot.prompt(message, cmd.command === 'steer' || cmd.deliverAs === 'steer' ? 'steer' : 'followUp', images);
                    }
                    finally {
                        taking--;
                    }
                    writeClaim();
                    return respond(sock, cmd, true, { queued });
                }
                case 'deliver': {
                    // Durable input from pi-dish (room, cross-family conversation, routine, or CI).
                    const { kind, requestId, text, data } = cmd;
                    if ((kind !== 'room' && kind !== 'ask' && kind !== 'answer' && kind !== 'routine' && kind !== 'ci') || typeof requestId !== 'string' || typeof text !== 'string' || !(0, helper_values_1.record)(data)) {
                        return respond(sock, cmd, false, undefined, 'deliver needs kind, requestId, text and data');
                    }
                    const queued = bot.busy;
                    taking++;
                    try {
                        await bot.deliver({ kind, requestId, text, data: data });
                    }
                    finally {
                        taking--;
                    }
                    writeClaim();
                    return respond(sock, cmd, true, { queued });
                }
                case 'abort':
                    await bot.abort();
                    writeClaim();
                    return respond(sock, cmd, true);
                default:
                    return respond(sock, cmd, false, undefined, `unsupported command ${String(cmd.command)}`);
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
    }
    function unlinkOwnedClaim() {
        const file = path.join(REGISTRY_DIR, `bot-${bot.id}.json`);
        try {
            const current = JSON.parse(fs.readFileSync(file, 'utf8'));
            if ((0, helper_values_1.record)(current) && current.instanceId === relayInstanceId)
                fs.unlinkSync(file);
        }
        catch { }
    }
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
    const models = await (0, bot_runtime_1.openBotModels)(bot.model);
    async function shutdown(reason, code) {
        if (shuttingDown)
            return;
        shuttingDown = true;
        // A model request that will not stop must not keep a dead pane's relay alive.
        setTimeout(() => { process.exit(code); }, 10_000).unref();
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
        unlinkOwnedClaim();
        unlinkOwnedSocket();
        // Unfinished work stays in durable storage; the next relay resumes it.
        try {
            await runtime?.close();
        }
        catch (error) {
            log(`close failed: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
        // pi-claude-code's warm Claude Code process keeps Node alive until closed.
        try {
            await models.close();
        }
        catch { }
        registry.close();
        process.exit(code);
    }
    for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
        process.on(signal, () => { void shutdown(signal, 0); });
    }
    for (const failure of ['uncaughtException', 'unhandledRejection']) {
        process.on(failure, (error) => {
            log(`${failure}: ${(0, http_boundary_1.errorMessage)(error)}`);
            void shutdown(failure, 1);
        });
    }
    runtime = await (0, bot_runtime_1.openBotRuntime)({
        bot,
        storageFile: path.join((0, dish_store_1.dishDir)(), 'bots', bot.id, 'durable.sqlite'),
        botsDir: path.join((0, dish_store_1.dishDir)(), 'bots'),
        mirror,
        models: models.models,
        sessions: sessionsPort(routeId),
        api: hubApi,
        loadBot,
        emit: broadcast,
        changed: writeClaim,
        log,
        // Settings and cache TTL overrides are read from ~/.pi/dish/settings.json at each decision (the defaults).
        idleRollover: {
            nextRoutineAt: from => nextRoutineRun(bot.id, from),
            record: entry => (0, bot_idle_rollover_1.appendDecisionLog)(path.join(botDir, bot_idle_rollover_1.IDLE_ROLLOVER_LOG), entry),
        },
    });
    socketPath = (0, relay_socket_1.relaySocketPath)(bot.id);
    fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    try {
        fs.unlinkSync(socketPath);
    }
    catch { }
    server = net.createServer(handleClient);
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
    log(`bot ${bot.name} (${bot.id}) on ${bot.model}, build ${build}, relay listening on ${socketPath}`);
    // A rename by the user, by a bot or by an undo shows in the session list and the transcript. A change of settings,
    // or of the bot's status, model or name (per-bot settings may name it), plans the idle rollover again: a skip
    // disarms its timer, and a pause or model change ends a draft in flight.
    let settings = settingsStamp();
    let row = `${bot.status}:${bot.model}:${bot.name}`;
    setInterval(() => {
        let current;
        try {
            current = loadBot();
        }
        catch {
            return;
        }
        const nextSettings = settingsStamp();
        const nextRow = `${current.status}:${current.model}:${current.name}`;
        if (nextSettings !== settings || nextRow !== row) {
            settings = nextSettings;
            row = nextRow;
            runtime?.reconsiderIdle();
        }
        if (current.name === mirror.name)
            return;
        mirror.appendName(mirror.lastEntryId, current.name);
        writeClaim();
    }, 3_000).unref();
}
void main().catch((error) => {
    log(`failed to start: ${(0, http_boundary_1.errorMessage)(error)}`);
    process.exit(1);
});
