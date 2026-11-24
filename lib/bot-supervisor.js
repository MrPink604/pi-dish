// Generated from src/core/bot-supervisor.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverToBot = deliverToBot;
exports.deliverStartingBot = deliverStartingBot;
exports.claimBotRelay = claimBotRelay;
exports.claimBotRelayWhenFree = claimBotRelayWhenFree;
exports.liveBotRelay = liveBotRelay;
exports.startBots = startBots;
exports.botRoute = botRoute;
exports.startBot = startBot;
/**
 * Starts every active bot when pi-dish starts: a bot's relay is resumed from
 * its mirror, and pi-dish writes the mirror's header first for a bot that has
 * never run. A bot already running is left alone (the resume reports it live).
 */
const crypto = require("crypto");
const fs = require("fs");
const promises_1 = require("node:timers/promises");
const net = require("net");
const os = require("os");
const path = require("path");
const string_decoder_1 = require("string_decoder");
const bot_mirror_1 = require("./bot-mirror");
const harnesses_1 = require("./harnesses");
const session_key_1 = require("./session-key");
const http_boundary_1 = require("./http-boundary");
const process_identity_1 = require("./process-identity");
const dish_store_1 = require("./dish-store");
const relay_socket_1 = require("./relay-socket");
const helper_values_1 = require("./helper-values");
/**
 * Hands one `deliver` command to a bot's relay over its bridge socket. Resolves once the relay has taken it, saying
 * whether it queued behind a run, and null when no relay listens or it refuses; the delivery carries a request id,
 * so sending it again is harmless.
 */
function deliverToBot(botId, delivery, timeoutMs = 15_000) {
    return new Promise((resolve) => {
        const id = crypto.randomUUID();
        const decoder = new string_decoder_1.StringDecoder('utf8');
        let buffer = '';
        let settled = false;
        const sock = net.connect((0, relay_socket_1.relaySocketPath)(botId));
        const done = (taken) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            sock.destroy();
            resolve(taken);
        };
        const timer = setTimeout(() => done(null), timeoutMs);
        sock.on('error', () => done(null));
        sock.on('close', () => done(null));
        sock.on('connect', () => sock.write(JSON.stringify({ ...delivery, id, command: 'deliver' }) + '\n'));
        sock.on('data', (chunk) => {
            buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
            for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                let frame;
                try {
                    frame = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (!(0, helper_values_1.record)(frame) || frame.type !== 'response' || frame.id !== id)
                    continue;
                done(frame.success === true ? { queued: (0, helper_values_1.record)(frame.data) && frame.data.queued === true } : null);
            }
        });
    });
}
/**
 * Delivers to a bot that may not be running, such as a routine's run just after the hub came back or a message that
 * arrives while its relay restarts: when no relay takes it, the bot is started and the delivery tried again until a
 * relay takes it or `waitMs` passes. A start that fails (refused while a restart is under way) is tried again.
 */
async function deliverStartingBot(botId, delivery, start, { waitMs = 60_000, everyMs = 1000, deliver = deliverToBot } = {}) {
    const deadline = Date.now() + waitMs;
    let started = false;
    let failure = '';
    for (;;) {
        const taken = await deliver(botId, delivery);
        if (taken)
            return taken;
        if (!started) {
            try {
                const launched = await start();
                if (launched !== false)
                    started = true;
            }
            catch (error) {
                failure = (0, http_boundary_1.errorMessage)(error);
            }
        }
        if (Date.now() >= deadline) {
            throw new Error(`the bot's relay did not take the message within ${Math.round(waitMs / 1000)}s${failure && !started ? ` (start: ${failure})` : ''}`);
        }
        await (0, promises_1.setTimeout)(everyMs);
    }
}
/**
 * Makes this process the bot's only relay: two relays on one durable store
 * would both run its work. The lock file names the holder's pid, start time
 * and build; a holder that is gone (killed, crashed, or a reused pid) is
 * replaced. Returns false while another live relay holds it; `release` removes
 * only our own lock.
 */
function claimBotRelay(botDir, build) {
    const file = path.join(botDir, 'relay.lock');
    const self = (0, process_identity_1.processIdentity)(process.pid);
    if (!self)
        throw new Error('Cannot read this process birth identity');
    fs.mkdirSync(botDir, { recursive: true, mode: 0o700 });
    const release = () => {
        try {
            const held = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Number(held.pid) === self.pid && String(held.startTime) === String(self.startTime))
                fs.unlinkSync(file);
        }
        catch { }
    };
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.writeFileSync(file, JSON.stringify({ pid: self.pid, startTime: self.startTime, build }), { flag: 'wx', mode: 0o600 });
            return { claimed: true, release };
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        const holder = liveBotRelay(botDir);
        if (holder !== null)
            return { claimed: false, holder: holder.pid };
        // A stale lock: take it over once; a racing relay that wins the retry keeps it.
        try {
            fs.unlinkSync(file);
        }
        catch { }
    }
    return { claimed: false, holder: 0 };
}
/**
 * `claimBotRelay`, waiting up to `waitMs` for a holder to go: a restart starts the new relay in the pane while the
 * old one is still stopping, which takes at most ten seconds.
 */
async function claimBotRelayWhenFree(botDir, build, { waitMs = 15_000, everyMs = 100 } = {}) {
    const deadline = Date.now() + waitMs;
    for (;;) {
        const lock = claimBotRelay(botDir, build);
        if (lock.claimed || Date.now() >= deadline)
            return lock;
        await (0, promises_1.setTimeout)(everyMs);
    }
}
/** The live relay holding a bot's lock, or null. */
function liveBotRelay(botDir) {
    try {
        const holder = JSON.parse(fs.readFileSync(path.join(botDir, 'relay.lock'), 'utf8'));
        if (!(0, process_identity_1.processIdentityAlive)({ pid: Number(holder.pid), startTime: String(holder.startTime) }))
            return null;
        return { pid: Number(holder.pid), build: typeof holder.build === 'string' && holder.build ? holder.build : null };
    }
    catch {
        return null;
    }
}
/**
 * Resolves once each active bot's start has been tried; a failure is logged,
 * never thrown. A bot whose relay is still running (a pi-dish restart leaves
 * its pane alone) is not started again; one that runs another build, or
 * recorded none, goes to `restartStale`.
 */
async function startBots(ports) {
    const botsDir = ports.botsDir ?? path.join((0, dish_store_1.dishDir)(), 'bots');
    for (const bot of ports.registry.list()) {
        if (bot.status !== 'active')
            continue;
        try {
            const holder = liveBotRelay(path.join(botsDir, bot.id));
            if (holder && ports.build && ports.restartStale && holder.build !== ports.build) {
                ports.restartStale(bot, holder);
                continue;
            }
            await startBot(bot, ports);
        }
        catch (error) {
            ports.log(`bot ${bot.name} did not start: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
}
/** The session route of a bot, as pi-dish's session operations take it. */
function botRoute(id) {
    if (!(0, session_key_1.validSessionId)(id))
        throw new Error(`invalid bot id ${id}`);
    return (0, session_key_1.encodeSessionKey)('bot', id);
}
/**
 * Starts one bot: writes its mirror's header when it has never run, then
 * resumes its route. Returns `true` when it launched a relay, or `false` when
 * a live relay already holds the lock (left alone).
 */
async function startBot(bot, { resume, log, sessionsDir = (0, harnesses_1.getHarness)('bot').rootPath(), botsDir = path.join((0, dish_store_1.dishDir)(), 'bots'), }) {
    const route = botRoute(bot.id);
    const running = liveBotRelay(path.join(botsDir, bot.id));
    if (running !== null) {
        log(`bot ${bot.name}: relay ${running.pid} is already running`);
        return false;
    }
    new bot_mirror_1.BotMirror(path.join(sessionsDir, `${bot.id}.jsonl`), { id: bot.id, cwd: os.homedir(), name: bot.name });
    await resume(route);
    return true;
}
