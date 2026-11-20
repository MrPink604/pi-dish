// Generated from src/core/bot-supervisor.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBots = startBots;
/**
 * Starts every active bot when pi-dish starts: a bot's relay is resumed from
 * its mirror, and pi-dish writes the mirror's header first for a bot that has
 * never run. A bot already running is left alone (the resume reports it live).
 */
const os = require("os");
const path = require("path");
const bot_mirror_1 = require("./bot-mirror");
const harnesses_1 = require("./harnesses");
const session_key_1 = require("./session-key");
const http_boundary_1 = require("./http-boundary");
/** Resolves once each active bot's start has been tried; a failure is logged, never thrown. */
async function startBots({ registry, resume, log, sessionsDir = (0, harnesses_1.getHarness)('bot').rootPath() }) {
    for (const bot of registry.list()) {
        if (bot.status !== 'active')
            continue;
        if (!(0, session_key_1.validSessionId)(bot.id)) {
            log(`bot ${bot.name}: invalid id ${bot.id}`);
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
