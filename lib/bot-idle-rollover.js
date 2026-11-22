// Generated from src/core/bot-idle-rollover.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDLE_ROLLOVER_LOG_MAX_BYTES = exports.SHRINK_GUARD_RATIO = exports.SHRINK_GUARD_MIN_BYTES = exports.IDLE_ROLLOVER_DEFAULTS = exports.MIN_WARM_MS = exports.IDLE_ROLLOVER_LOG = exports.IDLE_ROLLOVER_SETTING = void 0;
exports.idleRolloverConfig = idleRolloverConfig;
exports.windowCacheExpiry = windowCacheExpiry;
exports.idleRolloverLead = idleRolloverLead;
exports.planIdleRollover = planIdleRollover;
exports.composeIdleDraftRequest = composeIdleDraftRequest;
exports.parseNotebookDraft = parseNotebookDraft;
exports.notebookShrinkRefusal = notebookShrinkRefusal;
exports.notebookDigest = notebookDigest;
exports.appendDecisionLog = appendDecisionLog;
/**
 * Pre-expiry idle rollover for bots. A bot idle with a large window would make the next message re-read that whole
 * window once its prompt cache expires. Shortly before it expires, while a read is still cheap, the relay has the bot
 * draft its notebook in a fork of its conversation (the same prefix, so the cache is read), then opens a fresh window
 * with that notebook in one commit on the live conversation, so the next message starts small.
 *
 * The rules, the draft's request and parse, and the decision log's file live here; the timer, the fork and the
 * commit live in bot-runtime.
 */
const node_crypto_1 = require("node:crypto");
const fs = require("fs");
const helper_values_1 = require("./helper-values");
const session_metadata_1 = require("./session-metadata");
/** The key in `~/.pi/dish/settings.json`; `false` turns the feature off, an object tunes it. */
exports.IDLE_ROLLOVER_SETTING = 'botIdleRollover';
/** The decision log in each bot's directory: one JSON line per plan, draft, skip, outcome and return. Best-effort. */
exports.IDLE_ROLLOVER_LOG = 'idle-rollover.jsonl';
/** The draft's request must still read the cache: closer to expiry than this, it is too late. */
exports.MIN_WARM_MS = 60_000;
/** Expiry bases trusted to fire: documented TTLs and floors. An estimate alone never rolls a window over. */
const TRUSTED_BASES = { fixed: true, minimum: true };
exports.IDLE_ROLLOVER_DEFAULTS = Object.freeze({
    enabled: true,
    minTokens: 100_000,
    minPercent: 50,
    minRetentionMs: 30 * 60_000,
    leadMs: 3 * 60_000,
    leadPercent: 10,
    earlyPercent: 75,
    earlyIdleMs: 10 * 60_000,
});
function bounded(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
/** One settings layer over `base`: `false`/`true` sets `enabled`; invalid knobs keep the value below them. */
function applyLayer(base, layer) {
    if (typeof layer === 'boolean')
        return { ...base, enabled: layer };
    if (!(0, helper_values_1.record)(layer))
        return base;
    const minutes = (key, fallback) => {
        const value = bounded(layer[key], 0, 24 * 60);
        return value === null ? fallback : value * 60_000;
    };
    const percent = (key, fallback) => bounded(layer[key], 0, 100) ?? fallback;
    return {
        enabled: typeof layer.enabled === 'boolean' ? layer.enabled : base.enabled,
        minTokens: bounded(layer.minTokens, 0, 10_000_000) ?? base.minTokens,
        minPercent: percent('minPercent', base.minPercent),
        minRetentionMs: minutes('minRetentionMinutes', base.minRetentionMs),
        leadMs: minutes('leadMinutes', base.leadMs),
        leadPercent: percent('leadPercent', base.leadPercent),
        earlyPercent: percent('earlyPercent', base.earlyPercent),
        earlyIdleMs: minutes('earlyIdleMinutes', base.earlyIdleMs),
    };
}
/**
 * The configuration for one bot: the defaults, then `botIdleRollover` in settings, then its `bots` entry for this bot
 * (by id, or by name ignoring case). Either layer may be `false` to turn the feature off.
 */
function idleRolloverConfig(settings, bot) {
    const block = (0, helper_values_1.record)(settings) ? settings[exports.IDLE_ROLLOVER_SETTING] : undefined;
    const global = applyLayer({ ...exports.IDLE_ROLLOVER_DEFAULTS }, block);
    const bots = (0, helper_values_1.record)(block) && (0, helper_values_1.record)(block.bots) ? block.bots : {};
    const name = bot.name.toLowerCase();
    const own = Object.hasOwn(bots, bot.id) ? bots[bot.id]
        : Object.entries(bots).find(([key]) => key.toLowerCase() === name)?.[1];
    return applyLayer(global, own);
}
/**
 * The window's prompt-cache expiry, projected through its assistant messages oldest first, as the session list
 * projects it from the bot's mirror (a warm read keeps the tier its write chose).
 */
function windowCacheExpiry(messages, config) {
    let expiry = null;
    for (const message of messages) {
        if (!(0, helper_values_1.record)(message) || message.role !== 'assistant' || !(0, session_metadata_1.hasCacheActivity)(message))
            continue;
        expiry = (0, session_metadata_1.cacheExpiryForMessage)(message, expiry, undefined, config);
    }
    return expiry;
}
const minutesText = (ms) => `${Math.round(ms / 60_000)} min`;
const tokensText = (tokens) => `${Math.round(tokens / 1000)}k`;
/** The lead before expiry at which trigger A fires. */
function idleRolloverLead(config, retentionMs) {
    return Math.max(config.leadMs, retentionMs * config.leadPercent / 100);
}
/**
 * Whether to roll the window over now, when to look again, or why not in this idle period. A skip is final until the
 * next run ends: anything that changes the answer (a turn, queued input, a report, a routine run) ends in one.
 */
function planIdleRollover(state) {
    const { now, config, cache, tokens, windowLimit } = state;
    const percent = windowLimit > 0 ? Math.round(tokens / windowLimit * 1000) / 10 : 0;
    const facts = {
        tokens, percent, expiresAt: cache?.expiresAt ?? null, retention: cache?.retention ?? null,
        basis: cache?.basis ?? null, idleMs: Math.max(0, now - state.idleSince),
    };
    const skip = (reason) => ({ ...facts, action: 'skip', reason });
    if (!config.enabled)
        return skip('turned off in settings');
    if (state.ineligible)
        return skip(state.ineligible);
    if (state.attempted)
        return skip('already tried in this window');
    if (!state.workSinceRollover)
        return skip('nothing has happened since the window opened');
    if (state.busy)
        return skip('a turn is running');
    if (state.queued)
        return skip('input is queued');
    if (state.reportPending)
        return skip('a worker report is being delivered');
    if (!cache)
        return skip('no prompt-cache expiry is known');
    if (!Object.hasOwn(TRUSTED_BASES, cache.basis))
        return skip(`the cache expiry's basis is ${cache.basis}, not a documented TTL`);
    const warmUntil = cache.expiresAt - exports.MIN_WARM_MS;
    if (now >= warmUntil)
        return skip(now >= cache.expiresAt ? 'the cache has already expired' : 'the cache expires in under a minute');
    const floor = Math.min(config.minTokens, windowLimit * config.minPercent / 100);
    const candidates = [];
    const declined = [];
    if (cache.retentionMs < config.minRetentionMs)
        declined.push(`the ${cache.retention} cache is shorter than ${minutesText(config.minRetentionMs)}`);
    else if (tokens < floor)
        declined.push(`${tokensText(tokens)} tokens is under the ${tokensText(floor)} floor`);
    else
        candidates.push({ trigger: 'expiry', at: cache.expiresAt - idleRolloverLead(config, cache.retentionMs) });
    if (percent < config.earlyPercent)
        declined.push(`${percent}% full is under ${config.earlyPercent}%`);
    else if (state.idleSince + config.earlyIdleMs >= warmUntil)
        declined.push(`the cache expires before ${minutesText(config.earlyIdleMs)} idle`);
    else
        candidates.push({ trigger: 'early', at: state.idleSince + config.earlyIdleMs });
    if (!candidates.length)
        return skip(declined.join('; '));
    const next = candidates.reduce((a, b) => b.at < a.at ? b : a);
    if (state.nextRoutineAt !== null && state.nextRoutineAt >= now && state.nextRoutineAt <= cache.expiresAt) {
        return skip(`a routine runs at ${new Date(state.nextRoutineAt).toISOString()}, before the cache expires`);
    }
    return next.at > now
        ? { ...facts, action: 'wait', trigger: next.trigger, at: next.at }
        : { ...facts, action: 'roll', trigger: next.trigger };
}
/** The markers around the drafted notebook: the only answer taken is one in exactly this form. */
const OPEN = '<<<NOTEBOOK';
const CLOSE = 'NOTEBOOK>>>';
/**
 * The draft's request, sent to a fork of the conversation. It starts like the context reminder, so the reminder is not
 * added to it as well. Tools are blocked in a fork: the answer is the only thing taken from it. `notebook` is the
 * notebook as stored now: the window's instructions hold the one it opened with, and context_notes may have replaced
 * it since. It comes last, after the cached prefix, with any `</notebook>` inside it escaped so it cannot end the block.
 */
function composeIdleDraftRequest(plan, now, maxBytes, notebook) {
    const left = plan.expiresAt === null ? '' : `; its prompt cache expires in about ${minutesText(Math.max(0, plan.expiresAt - now))}`;
    const stored = notebook.trim().replace(/<\/notebook>/gi, '<\\/notebook>') || '(empty)';
    return `[pi-dish: this context window is ${Math.round(plan.percent)}% full (${tokensText(plan.tokens)} tokens) and you have been idle for ${minutesText(plan.idleMs)}${left}. `
        + 'pi-dish is opening a fresh window for you now, so the next message does not re-read this one. '
        + 'Start from your notebook as it stands now, below (your instructions may show an older one), and keep what still matters. '
        + 'Tools are off for this reply, and it is not shown to the user; it comes from pi-dish, not from the user. '
        + `Reply in exactly this form and nothing else, your whole notebook at most ${maxBytes} bytes; any other reply keeps this window as it is:]\n`
        + `Summary: <one line saying what this window covered>\n${OPEN}\n<your whole new notebook>\n${CLOSE}\n\n`
        + `<notebook>\n${stored}\n</notebook>`;
}
/**
 * The summary and notebook of a draft answer, or why it is not one. Only the exact form counts: `Summary: <line>`, then
 * the notebook between its marker lines (each alone on its line, trailing blanks allowed), then nothing. Anything else
 * (a refusal, a fragment, prose around it) is a decline.
 */
function parseNotebookDraft(text, maxBytes) {
    const form = /^Summary:[ \t]*([^\n]*)\n<<<NOTEBOOK[ \t]*\n([\s\S]*)\nNOTEBOOK>>>[ \t]*$/.exec(text.replace(/\r\n/g, '\n').trim());
    if (!form)
        return { error: `the draft is not in the Summary / ${OPEN} … ${CLOSE} form` };
    const summary = form[1].trim();
    const notebook = form[2].trim();
    if (!summary)
        return { error: 'the draft has an empty summary' };
    // A marker alone on a line inside the notebook means a second notebook; one mentioned in a sentence is text.
    if (notebook.split('\n').some(line => line.trim() === OPEN || line.trim() === CLOSE))
        return { error: 'the draft has more than one notebook' };
    if (!notebook)
        return { error: 'the draft has an empty notebook' };
    const bytes = Buffer.byteLength(notebook, 'utf8');
    if (bytes > maxBytes)
        return { error: `the drafted notebook is ${bytes} bytes, over the ${maxBytes}-byte cap` };
    return { summary, notebook };
}
/** A notebook smaller than this is replaced whatever its draft's size. */
exports.SHRINK_GUARD_MIN_BYTES = 1024;
/** A draft keeps at least this share of a larger notebook's bytes, or it is refused. */
exports.SHRINK_GUARD_RATIO = 0.5;
/** Why a draft may not replace `previous`: it would drop more than half of a notebook that held something. */
function notebookShrinkRefusal(previous, next) {
    const before = Buffer.byteLength(previous.trim(), 'utf8');
    const after = Buffer.byteLength(next.trim(), 'utf8');
    if (before < exports.SHRINK_GUARD_MIN_BYTES || after >= before * exports.SHRINK_GUARD_RATIO)
        return null;
    return `the drafted notebook is ${after} bytes, under half of the ${before}-byte notebook it would replace`;
}
/** A version of a notebook: the draft is applied only over the notebook it was shown. */
function notebookDigest(notebook) {
    return (0, node_crypto_1.createHash)('sha256').update(notebook).digest('hex');
}
/** The decision log keeps its newest megabyte or two: past it, the file moves to `.1`, replacing the one before. */
exports.IDLE_ROLLOVER_LOG_MAX_BYTES = 1024 * 1024;
/**
 * Appends one decision to the log, owner-only (0600) like its rotated copy. A failed rotation still appends, then
 * throws so the caller reports it; the log only grows past its cap until a rotation succeeds.
 */
function appendDecisionLog(file, entry, maxBytes = exports.IDLE_ROLLOVER_LOG_MAX_BYTES) {
    let rotation = null;
    try {
        if (fs.statSync(file).size > maxBytes) {
            fs.renameSync(file, `${file}.1`);
            fs.chmodSync(`${file}.1`, 0o600);
        }
    }
    catch (error) {
        if (!(0, helper_values_1.record)(error) || error.code !== 'ENOENT')
            rotation = error;
    }
    const fd = fs.openSync(file, 'a', 0o600);
    try {
        fs.fchmodSync(fd, 0o600);
        fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
    }
    finally {
        fs.closeSync(fd);
    }
    if (rotation)
        throw new Error(`could not rotate ${file}: ${rotation instanceof Error ? rotation.message : String(rotation)}`);
}
