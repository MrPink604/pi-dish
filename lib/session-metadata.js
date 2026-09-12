// Generated from src/core/session-metadata.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRecord = isRecord;
exports.decodeSessionInfo = decodeSessionInfo;
exports.sessionInfoFromEntries = sessionInfoFromEntries;
exports.extendSessionInfoFromEntries = extendSessionInfoFromEntries;
// These general browser helpers remain JavaScript. Their results are checked
// here before they enter authoritative metadata; the JSONL entries stay unknown.
const { extractTextContent, splitSessionRefContext, truncate } = require('../public/helpers.js');
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value) { return typeof value === 'string' && value.length > 0; }
function shortName(text) {
    const value = truncate(text, 40, '...');
    return typeof value === 'string' ? value : null;
}
/** Validate persisted accumulator output, reviving its serialized activity Date. */
function decodeSessionInfo(value) {
    if (!isRecord(value) || typeof value.model !== 'string' ||
        !['name', 'cwd', 'sessionId', 'parentSession'].every(key => value[key] === null || typeof value[key] === 'string') ||
        typeof value.messageCount !== 'number' || !Number.isFinite(value.messageCount) ||
        typeof value.contextTokens !== 'number' || !Number.isFinite(value.contextTokens))
        return null;
    const raw = value.lastActivity;
    if (!(raw instanceof Date) && typeof raw !== 'string' && typeof raw !== 'number')
        return null;
    const lastActivity = new Date(raw);
    if (!Number.isFinite(lastActivity.getTime()))
        return null;
    return { model: value.model, name: value.name,
        cwd: value.cwd, sessionId: value.sessionId,
        parentSession: value.parentSession,
        messageCount: value.messageCount, contextTokens: value.contextTokens, lastActivity };
}
function sessionInfoFromEntries(entries, mtime, candidate = {}) {
    const info = {
        model: 'unknown', name: null, messageCount: 0, contextTokens: 0,
        lastActivity: mtime || new Date(0), cwd: null, sessionId: null, parentSession: null,
    };
    return accumulateSessionInfo(info, entries, candidate, true);
}
/**
 * Extend an info object with entries appended after the range it was built
 * from — the O(delta) path lib/session-index.js uses for a streaming active
 * session, so a sidebar poll never re-parses a whole multi-MB JSONL because
 * one turn was appended. Mutates and returns `info`; `mtime` is the file's
 * new mtime (a full parse floors lastActivity at the mtime, so the extension
 * must too).
 */
function extendSessionInfoFromEntries(info, entries, mtime, candidate = {}) {
    if (mtime && mtime.getTime() > new Date(info.lastActivity).getTime())
        info.lastActivity = mtime;
    return accumulateSessionInfo(info, entries, candidate, false);
}
function accumulateSessionInfo(info, entries, candidate, fromStart) {
    const profileId = candidate.profileId || 'pi-v3';
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!isRecord(entry))
            continue;
        const message = isRecord(entry.message) ? entry.message : null;
        // Only an entry parsed from physical line zero can be Pi's SessionHeader
        // / OMP's title line (parseEntries marks that on the array). A blank or
        // torn first line means the file has no readable header, and a later
        // session-shaped entry must not be promoted to one.
        const isFirst = fromStart && i === 0 && entries.firstEntryOnFirstLine === true;
        if (profileId === 'omp-v1' && isFirst && entry.type === 'title' && nonempty(entry.title))
            info.name = entry.title;
        if (entry.type === 'session') {
            if (nonempty(entry.cwd))
                info.cwd = entry.cwd;
            // Native identity and lineage belong to Pi's first-line SessionHeader.
            // Later session-shaped custom entries must not rewrite provenance.
            if (isFirst || (profileId === 'omp-v1' && info.sessionId === null)) {
                if (typeof entry.id === 'string' && entry.id)
                    info.sessionId = entry.id;
                if (typeof entry.parentSession === 'string' && entry.parentSession)
                    info.parentSession = entry.parentSession;
            }
        }
        if (entry.type === 'model_change') {
            const model = profileId === 'omp-v1' ? entry.model : entry.modelId;
            if (nonempty(model))
                info.model = model;
        }
        // Explicit names assign unconditionally (later wins); the first user
        // message is only a fallback for a still-unnamed session. Same resolution
        // the whole-file parse performed at return time.
        if (entry.type === 'session_info' && nonempty(entry.name))
            info.name = entry.name;
        if (nonempty(entry.sessionName))
            info.name = entry.sessionName;
        if (entry.type === 'message' && message?.role === 'user') {
            info.messageCount++;
            if (info.name === null) {
                // The <session-refs> block is appended context, not something the
                // user wrote — a session named after its first prompt must not be
                // named after the block that followed it.
                const extracted = extractTextContent(message.content);
                const split = typeof extracted === 'string' ? splitSessionRefContext(extracted) : null;
                const text = isRecord(split) && typeof split.text === 'string' ? split.text : '';
                if (text)
                    info.name = shortName(text);
            }
        }
        if (info.name === null && entry.type === 'custom_message' &&
            entry.customType === 'session-message' && nonempty(entry.content)) {
            info.name = shortName(entry.content);
        }
        if (typeof entry.timestamp === 'string' || typeof entry.timestamp === 'number') {
            const ts = new Date(entry.timestamp).getTime();
            if (Number.isFinite(ts) && ts > new Date(info.lastActivity).getTime())
                info.lastActivity = new Date(ts);
        }
        if (entry.type === 'message' && message?.role === 'assistant' && isRecord(message.usage)) {
            const tokens = message.usage.totalTokens;
            info.contextTokens = typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : 0;
        }
        if (entry.type === 'compaction')
            info.contextTokens = 0;
    }
    return info;
}
