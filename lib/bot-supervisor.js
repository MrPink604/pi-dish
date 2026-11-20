// Generated from src/core/bot-supervisor.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimBotRelay = claimBotRelay;
exports.liveBotRelay = liveBotRelay;
exports.startBots = startBots;
/**
 * Starts every active bot when pi-dish starts: a bot's relay is resumed from
 * its mirror, and pi-dish writes the mirror's header first for a bot that has
 * never run. A bot already running is left alone (the resume reports it live).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const bot_mirror_1 = require("./bot-mirror");
const harnesses_1 = require("./harnesses");
const session_key_1 = require("./session-key");
const http_boundary_1 = require("./http-boundary");
const process_identity_1 = require("./process-identity");
const dish_store_1 = require("./dish-store");
/**
 * Makes this process the bot's only relay: two relays on one durable store
 * would both run its work. The lock file names the holder's pid and start time;
 * a holder that is gone (killed, crashed, or a reused pid) is replaced. Returns
 * false while another live relay holds it; `release` removes only our own lock.
 */
function claimBotRelay(botDir) {
    const file = path.join(botDir, 'relay.lock');
    const self = (0, process_identity_1.processIdentity)(process.pid);
    if (!self)
        throw new Error('Cannot read this process birth identity');
    const mine = JSON.stringify({ pid: self.pid, startTime: self.startTime });
    fs.mkdirSync(botDir, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.writeFileSync(file, mine, { flag: 'wx', mode: 0o600 });
            return { claimed: true, release: () => { try {
                    if (fs.readFileSync(file, 'utf8') === mine)
                        fs.unlinkSync(file);
                }
                catch { } } };
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        const holder = liveBotRelay(botDir);
        if (holder !== null)
            return { claimed: false, holder };
        // A stale lock: take it over once; a racing relay that wins the retry keeps it.
        try {
            fs.unlinkSync(file);
        }
        catch { }
    }
    return { claimed: false, holder: 0 };
}
/** The pid of the live relay holding a bot's lock, or null. */
function liveBotRelay(botDir) {
    try {
        const holder = JSON.parse(fs.readFileSync(path.join(botDir, 'relay.lock'), 'utf8'));
        return (0, process_identity_1.processIdentityAlive)({ pid: Number(holder.pid), startTime: String(holder.startTime) }) ? Number(holder.pid) : null;
    }
    catch {
        return null;
    }
}
/**
 * Resolves once each active bot's start has been tried; a failure is logged,
 * never thrown. A bot whose relay is still running (a pi-dish restart leaves
 * its pane alone) is not started again.
 */
async function startBots({ registry, resume, log, sessionsDir = (0, harnesses_1.getHarness)('bot').rootPath(), botsDir = path.join((0, dish_store_1.dishDir)(), 'bots'), }) {
    for (const bot of registry.list()) {
        if (bot.status !== 'active')
            continue;
        if (!(0, session_key_1.validSessionId)(bot.id)) {
            log(`bot ${bot.name}: invalid id ${bot.id}`);
            continue;
        }
        const running = liveBotRelay(path.join(botsDir, bot.id));
        if (running !== null) {
            log(`bot ${bot.name}: relay ${running} is already running`);
            continue;
        }
        try {
            new bot_mirror_1.BotMirror(path.join(sessionsDir, `${bot.id}.jsonl`), { id: bot.id, cwd: os.homedir(), name: bot.name });
            await resume((0, session_key_1.encodeSessionKey)('bot', bot.id));
        }
        catch (error) {
            log(`bot ${bot.name} did not start: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
}
