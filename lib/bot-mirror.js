// Generated from src/core/bot-mirror.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotMirror = void 0;
exports.readBotMirrorHeader = readBotMirrorHeader;
exports.lastBotTurn = lastBotTurn;
/**
 * A bot's Pi-format mirror: the transcript pi-dish lists, reads and searches.
 * The bot's durable conversation is the source of truth; the relay appends one
 * mirror entry per durable entry it shows, and gives it the id `bot-<entry>`
 * so a restarted relay knows where to continue.
 *
 * Every append is synchronous, so a reader reacting to `message_end` already
 * finds the entry on disk.
 */
const fs = require("fs");
const path = require("path");
const helper_values_1 = require("./helper-values");
const TAIL_BYTES = 256 * 1024;
const ENTRY_ID = /^bot-(\d+)(?:-|$)/;
function tail(file) {
    const size = fs.statSync(file).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
        fs.readSync(fd, buffer, 0, length, size - length);
    }
    finally {
        fs.closeSync(fd);
    }
    return length === size ? buffer.toString('utf8') : buffer.toString('utf8').slice(buffer.indexOf(10) + 1);
}
/** The bot id a mirror belongs to; throws when the file is not a bot mirror. */
function readBotMirrorHeader(file) {
    const first = fs.readFileSync(file, 'utf8').split('\n', 1)[0];
    let header = null;
    try {
        header = JSON.parse(first);
    }
    catch { }
    if (!(0, helper_values_1.record)(header) || header.type !== 'session' || typeof header.id !== 'string' || !(0, helper_values_1.record)(header.bot)) {
        throw new Error(`Not a bot mirror: ${file}`);
    }
    return { id: header.id, cwd: typeof header.cwd === 'string' ? header.cwd : '', name: String(header.bot.name ?? '') };
}
/** When the bot last answered: the time of the newest model message in its mirror, or null for none or no mirror. */
function lastBotTurn(file) {
    let lines;
    try {
        lines = tail(file).split('\n');
    }
    catch {
        return null;
    }
    for (let index = lines.length - 1; index >= 0; index--) {
        let entry;
        try {
            entry = JSON.parse(lines[index]);
        }
        catch {
            continue;
        }
        if ((0, helper_values_1.record)(entry) && entry.type === 'message' && (0, helper_values_1.record)(entry.message) && entry.message.role === 'assistant' && typeof entry.timestamp === 'string')
            return entry.timestamp;
    }
    return null;
}
class BotMirror {
    file;
    parentId = null;
    /** Newest durable entry the mirror shows; 0 for none. */
    lastEntryId = 0;
    /** The name the mirror shows now: its newest name entry, or the header's. */
    name;
    constructor(file, header) {
        this.file = file;
        this.name = header.name;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        let exists = false;
        try {
            exists = fs.statSync(file).size > 0;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        if (!exists) {
            const entry = {
                type: 'session', version: 3, id: header.id, cwd: header.cwd, timestamp: new Date().toISOString(),
                bot: { name: header.name },
            };
            fs.writeFileSync(file, JSON.stringify(entry) + '\n');
            this.append('session_info', `bot-0-name`, { name: header.name });
            return;
        }
        const lines = tail(file).split('\n');
        let named = false;
        for (let index = lines.length - 1; index >= 0; index--) {
            let entry;
            try {
                entry = JSON.parse(lines[index]);
            }
            catch {
                continue;
            }
            if (!(0, helper_values_1.record)(entry) || entry.type === 'session' || typeof entry.id !== 'string')
                continue;
            if (!named && entry.type === 'session_info' && typeof entry.name === 'string') {
                this.name = entry.name;
                named = true;
            }
            this.parentId ??= entry.id;
            const match = ENTRY_ID.exec(entry.id);
            if (match && !this.lastEntryId)
                this.lastEntryId = Number(match[1]);
            if (this.lastEntryId && named)
                break;
        }
    }
    append(type, id, fields, at = Date.now()) {
        const entry = { type, id, parentId: this.parentId, timestamp: new Date(at).toISOString(), ...fields };
        fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
        this.parentId = id;
    }
    advance(entryId) {
        if (entryId > this.lastEntryId)
            this.lastEntryId = entryId;
    }
    /** A user, assistant or tool-result message, exactly as the model saw it. */
    appendMessage(entryId, message) {
        const at = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
        this.append('message', `bot-${entryId}`, { message }, at);
        this.advance(entryId);
    }
    /**
     * A message the model sees as user input but the transcript shows as itself:
     * a worker's report, or the start of a new context window.
     */
    appendCustom(entryId, customType, text, details, suffix) {
        this.append('custom_message', suffix ? `bot-${entryId}-${suffix}` : `bot-${entryId}`, {
            customType, content: [{ type: 'text', text }], display: true, ...(details ? { details } : {}),
        });
        this.advance(entryId);
    }
    /** A run that ended without an answer, shown as a failed assistant turn. */
    appendRunFailure(entryId, taskId, errorMessage, model) {
        this.append('message', `bot-${entryId}-failed-${taskId}`, {
            message: {
                role: 'assistant', content: [], stopReason: 'error', errorMessage,
                provider: model.provider, model: model.id, timestamp: Date.now(),
            },
        });
    }
    appendModelChange(entryId, provider, modelId) {
        this.append('model_change', `bot-${entryId}-model`, { provider, modelId });
    }
    /** A rename; the id is unique, as a bot may be renamed twice between two entries. */
    appendName(entryId, name) {
        this.append('session_info', `bot-${entryId}-name-${Date.now().toString(36)}`, { name });
        this.name = name;
    }
}
exports.BotMirror = BotMirror;
