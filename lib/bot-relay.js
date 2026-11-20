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
const bot_supervisor_1 = require("./bot-supervisor");
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
    return args => new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(process.execPath, [SESSIONS_CLI, ...args], {
            env: { ...process.env, PI_DISH_SESSION_ID: routeId }, maxBuffer: 8 << 20, timeout: 120_000,
        }, (error, stdout, stderr) => {
            if (!error)
                return resolve(stdout);
            const detail = String(stderr).trim().replace(/^pi-dish-sessions: /, '');
            reject(new Error(`pi-dish-sessions ${args[0]} failed: ${detail || error.message}`));
        });
    });
}
async function main() {
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
    // One relay per bot: a second would run the same durable work twice.
    const lock = (0, bot_supervisor_1.claimBotRelay)(path.join((0, dish_store_1.dishDir)(), 'bots', bot.id));
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
    if (header.name !== bot.name)
        mirror.appendName(mirror.lastEntryId, bot.name);
    const clients = new Set();
    let server = null;
    let socketPath = '';
    let socketIno = null;
    let socketReady = false;
    let shuttingDown = false;
    let runtime = null;
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
            name: bot.name,
            model: bot.model,
            thinkingLevel: bot.thinking,
            contextUsage: runtime?.contextUsage() ?? null,
            turnInProgress: runtime?.busy === true,
            askPending: false,
            compacting: false,
            spawnToken: process.env.PI_DISH_SPAWN_TOKEN || null,
        };
    }
    function lifecycle() {
        const busy = runtime?.busy === true;
        return { idle: !busy, pendingMessages: false, pendingDialogs: 0, backgroundWork: false };
    }
    function writeClaim() {
        if (!socketReady)
            return;
        try {
            fs.mkdirSync(REGISTRY_DIR, { recursive: true });
            fs.writeFileSync(path.join(REGISTRY_DIR, `bot-${bot.id}.json`), JSON.stringify({ ...claim(), updatedAt: new Date().toISOString() }, null, 2));
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
                    return respond(sock, cmd, true, { ...claim(), lifecycle: lifecycle() });
                case 'get_commands':
                    return respond(sock, cmd, true, { commands: [] });
                case 'prompt':
                case 'steer': {
                    const message = typeof cmd.message === 'string' ? cmd.message : '';
                    if (!message)
                        return respond(sock, cmd, false, undefined, 'message required');
                    const queued = bot.busy;
                    await bot.prompt(message, cmd.command === 'steer' || cmd.deliverAs === 'steer' ? 'steer' : 'followUp');
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
        send(sock, { type: 'hello', ...claim(), lifecycle: lifecycle() });
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
        mirror,
        models: models.models,
        sessions: sessionsPort(routeId),
        loadBot,
        emit: broadcast,
        changed: writeClaim,
        log,
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
    log(`bot ${bot.name} (${bot.id}) on ${bot.model}, relay listening on ${socketPath}`);
}
void main().catch((error) => {
    log(`failed to start: ${(0, http_boundary_1.errorMessage)(error)}`);
    process.exit(1);
});
