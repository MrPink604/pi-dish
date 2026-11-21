// Generated from src/core/bot-runtime.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORK_SEED = exports.SCRIPT_TIME_CAP_MS = exports.FORCED_RATIO = exports.REMINDER_RATIO = exports.WINDOW_TOKEN_CAP = exports.NOTEBOOK_MAX_BYTES = void 0;
exports.messageText = messageText;
exports.settledWorker = settledWorker;
exports.newContextRefusal = newContextRefusal;
exports.composeInstructions = composeInstructions;
exports.composeHandoff = composeHandoff;
exports.composePurpose = composePurpose;
exports.composeFreshPurpose = composeFreshPurpose;
exports.openBotModels = openBotModels;
exports.openBotRuntime = openBotRuntime;
/**
 * A bot's runtime: one pi-durable conversation in `durable.sqlite`, its tools,
 * and the mapping from its commits to pi-dish's bridge events and mirror.
 *
 * Every pi-durable call lives in this module: the package is pinned at 1.5.2
 * and its API changes between releases. pi-durable, pi-ai and pi-claude-code
 * are ES modules that need `node:sqlite`; they are imported when a runtime
 * opens, never when this module loads, so the server can import the pure
 * helpers on a host that cannot run a bot.
 *
 * pi-durable 1.5.2 has no Pi-style event stream. A watch of the conversation
 * yields each committed view: new transcript entries become `message_*` and
 * `tool_execution_end` events, the live document (`pi.live`) gives the run, the
 * streamed partial answer and the running tools.
 */
const crypto = require("crypto");
const fs = require("fs");
const nodeModule = require("module");
const path = require("path");
const url = require("url");
const esbuild = require("esbuild");
const helper_values_1 = require("./helper-values");
const helper_refs_1 = require("./helper-refs");
/** The notebook's cap, in UTF-8 bytes. */
exports.NOTEBOOK_MAX_BYTES = 16 * 1024;
/** A window is sized to this many tokens even on a model with a larger context. */
exports.WINDOW_TOKEN_CAP = 200_000;
/** From this share of the window on, each request carries a reminder to roll over. */
exports.REMINDER_RATIO = 0.75;
/** At this share the relay rolls the window over itself once the run ends. */
exports.FORCED_RATIO = 0.9;
const MEMORY_TOOLS = { context_notes: true, new_context: true, history: true };
const TAIL_MESSAGES = 8;
const TAIL_MESSAGE_CHARS = 2000;
const REPORT_CHARS = 8000;
const WATCH_FIRST_POLL_MS = 5_000;
const WATCH_MAX_POLL_MS = 60_000;
/** A worker still running after this long is reported as such and no longer watched. */
const WATCH_GIVE_UP_MS = 24 * 60 * 60_000;
/** A code mode script ends with an error after this long, whatever its options line asks for: the bot is busy while it runs. */
exports.SCRIPT_TIME_CAP_MS = 10 * 60_000;
/** The heap of one script's VM; the hub is short of memory. */
const SCRIPT_MEMORY_BYTES = 64 * 1024 * 1024;
/** `sessions wait`: how long it waits by default, and at most. */
const WAIT_DEFAULT_SECS = 300;
const WAIT_MAX_SECS = 600;
/** Text blocks of a Pi message, joined; tool calls and thinking are left out. */
function messageText(message) {
    if (!(0, helper_values_1.record)(message))
        return '';
    if (typeof message.content === 'string')
        return message.content;
    if (!Array.isArray(message.content))
        return '';
    return message.content
        .flatMap((part) => (0, helper_values_1.record)(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])
        .join('\n');
}
/**
 * The settle rule `pi-dish-sessions wait` uses: a worker has settled when it is
 * not working or compacting, its transcript holds more than `since` messages,
 * and its newest message is not the user's (a prompt not picked up yet). A
 * pending question counts as settled. `session` is the resolve row; `window` is
 * `/messages?limit=1`. Null means keep waiting.
 */
function settledWorker(session, window, since) {
    const row = (0, helper_values_1.record)(session) ? session : {};
    const page = (0, helper_values_1.record)(window) ? window : {};
    const totalMessages = Number(page.totalMessages) || 0;
    const messages = Array.isArray(page.messages) ? page.messages : [];
    const last = messages.at(-1);
    const busy = row.turnInProgress === true || row.compacting === true;
    if (!busy && totalMessages > since) {
        if (row.askPending === true)
            return { state: 'waiting', totalMessages, text: messageText(last) };
        if ((0, helper_values_1.record)(last) && last.role !== 'user')
            return { state: 'finished', totalMessages, text: messageText(last) };
    }
    if (row.isActive !== true)
        return { state: 'inactive', totalMessages, text: messageText(last) };
    return null;
}
/**
 * Version 1 workers kept the long ref and a `reportedAt`: their watch ended at
 * the one report, though the session may still be open.
 */
function migrateWorkers(value) {
    const workers = {};
    for (const [dispatchId, raw] of Object.entries((0, helper_values_1.record)(value) ? value : {})) {
        const old = raw;
        const prefix = old.host ? `${old.host}/` : '';
        const sessionId = prefix && old.ref.startsWith(prefix) ? old.ref.slice(prefix.length) : old.ref;
        workers[dispatchId] = {
            name: old.name, ref: `${prefix}${(0, helper_refs_1.stableSessionRef)(sessionId)}`, sessionId, harness: old.harness, host: old.host,
            startedAt: old.startedAt, reports: old.reportedAt ? 1 : 0, ...(old.reportedAt ? { watchEndedAt: old.reportedAt } : {}),
        };
    }
    return workers;
}
/** Why `new_context` is refused, or null when it may run. */
function newContextRefusal(memory, workSinceRollover) {
    if (!memory.notebook.trim()) {
        return 'Refused: your notebook is empty. Write what you need to keep with context_notes first; the new window starts from the notebook, not from this conversation.';
    }
    if (!workSinceRollover) {
        return 'Refused: nothing has happened since the last new window, so this is already the new window: a rollover you were asked for is done. Carry on with the work, or tell the user the new window is open; roll over again once this window has filled.';
    }
    if (memory.notebookSavedIn !== memory.windows.length) {
        return 'Refused: you have not saved your notebook in this window. Save it with context_notes (write the whole notebook, even if little changed), then call new_context again.';
    }
    return null;
}
/** The instructions of a window: fixed when it opens, never rewritten inside it. */
function composeInstructions(identity, notebook, places = []) {
    return [
        '<identity>', identity.trim(), '</identity>',
        ...(places.length ? ['', '<places>', ...places.map(place => `- ${place.label}: ${place.host ? `${place.host}:` : ''}${place.cwd}`), '</places>'] : []),
        '',
        '<notebook>', notebook.trim() || '(empty: nothing written down yet)', '</notebook>',
    ].join('\n');
}
/**
 * The first message of a new window: what the bot needs that its notebook does not hold. The latest request is
 * shown with what became of it: a rollover the bot made while handling it is done, and must not be read as a request
 * to roll over again.
 */
function composeHandoff({ windowNumber, closed, tail, request, workers, forced }) {
    const lines = [`[Context window ${windowNumber}. Your identity and notebook are in your instructions; earlier windows are readable with the history tool.]`];
    if (closed.length) {
        lines.push('', 'Earlier windows:');
        closed.forEach((window, index) => lines.push(`${index + 1}. ${window.line}${window.forced ? ' (closed at the context limit)' : ''}`));
    }
    if (tail.length) {
        lines.push('', 'The end of the last window:');
        for (const message of tail)
            lines.push(`${message.role}: ${message.text}`);
    }
    lines.push('', `Latest request: ${request ?? '(none)'}`);
    if (request !== null) {
        lines.push(forced
            ? 'It was answered in the last window, which was then closed at the context limit.'
            : 'You opened this window with new_context while handling it, and that call is done: this is the new window. Do not call new_context again for it; carry on with whatever else it asks, or tell the user the new window is open.');
    }
    lines.push('', workers.length ? 'Workers you started that are still open (each new answer arrives as a report):' : 'No workers are open.');
    for (const worker of workers)
        lines.push(`- ${worker.name}: ${worker.ref} (${worker.harness}${worker.host ? ` on ${worker.host}` : ''}, started ${worker.startedAt}${worker.watchEndedAt ? ', no longer watched' : ''})`);
    return lines.join('\n');
}
/** A sub-bot's start, written by its parent into the sub-bot's directory and read once by its first relay. */
exports.FORK_SEED = 'fork.json';
/** A sub-bot's first message: its purpose, and that the conversation above it is its parent's. */
function composePurpose(parent, child, purpose) {
    return [
        `[pi-dish: you are "${child}", a new bot that ${parent} created just now as its sub-bot. Everything above is ${parent}'s conversation up to that moment. Its requests, its workers and its tool calls are ${parent}'s, not yours: do not continue or repeat any of them. You have no workers; reports from ${parent}'s workers go to ${parent} only.`,
        `You keep ${parent}'s identity until your first new context window, which brings your own identity and an empty notebook of your own. Open it soon: until you do, every request carries ${parent}'s whole conversation. Within your first few turns, write what you need to keep into your notebook with context_notes and call new_context.]`,
        '',
        `Your purpose, from ${parent}:`,
        purpose.trim(),
    ].join('\n');
}
/** A fresh sub-bot's first message: its purpose, with nothing of its parent's conversation before it. */
function composeFreshPurpose(parent, child, purpose) {
    return [
        `[pi-dish: you are "${child}", a new bot that ${parent} created just now as its sub-bot. You start fresh: your instructions hold your own identity and an empty notebook, and nothing of ${parent}'s conversation is here. Write what you need to keep into your notebook with context_notes as you learn it.]`,
        '',
        `Your purpose, from ${parent}:`,
        purpose.trim(),
    ].join('\n');
}
const PREAMBLE = [
    'You are a pi-dish bot: a long-lived agent that is the standing contact for one area of work. You talk with the',
    'user, start pi-dish sessions (workers) to do the work, and keep what you learn. You have no shell and do not edit',
    'files; anything that needs doing on a machine goes to a worker.',
    '',
    'Workers: spawn_worker starts a session with a complete brief and returns its ref at once. Each time the worker',
    'ends a turn with something new, that answer is delivered to you once, as a message starting "[worker report]";',
    'do not poll for it. A worker may end a turn while background work runs and report again when it finishes. It is',
    'watched until it is closed or 24 hours pass, and the last report says so. Tell the user the ref when you start one',
    'and the outcome when it reports. Once you have what you need from a worker, close it with the sessions tool',
    '(action close); you can close only workers you started. A spawn whose outcome is unknown is never retried for you:',
    'look for the session with the sessions tool before starting another. The sessions tool lists, reads, searches,',
    'messages and closes sessions and reports the fleet\'s hosts and their load.',
    '',
    'Knowledge: the knowledge base holds topic pages every bot and session shares. Before sending a worker to find',
    'something out, look there (kb_search, kb_read). Write down durable facts you learn with kb_write, each with its',
    'source: what a host runs, where things live, how something is done. Code and task status do not belong there.',
    '',
    'Memory: your notebook (context_notes, at most 16 KiB) is the only thing that carries over to a new context window,',
    'with the end of the conversation and your running workers. Write what you need to carry on there, not chat. When',
    'the window is filling up, or a topic is done, save the notebook and call new_context with a one-line summary of',
    'the window. history reads and searches your earlier windows. Your instructions are fixed for a window; notebook',
    'edits show in them from the next window on.',
    '',
    'Bots: bot_update changes your own entry or a sub-bot\'s (name, identity, places, thinking); the user sees each change',
    'and can undo it, and only the user changes your own model. bot_create makes a sub-bot for a narrower area. Your',
    'family (your parent, your sub-bots and theirs) shares a room: room_post wakes only the bots you name, room_read shows',
    'the recent messages. ask_bot puts one question to a bot in another family; its answer arrives once as a message. A',
    'chain of bot messages is capped at a few hops, so post only what needs an answer and never just to acknowledge.',
    '',
    'The roster: the bots tool lists the bots you can see (you, your ancestors and your descendants) and shows one bot\'s',
    'whole entry with its revisions; look before you change anything, and do not guess a bot\'s name or place. You have',
    'authority over your descendants only. bot_update with parent moves a descendant under you or another of your',
    'descendants, with status "retired" retires one (it stops, and its sub-bots move up to its parent), and with status',
    '"active" brings a retired one back. Your own model, parent and status are the user\'s. bot_create starts a sub-bot',
    'from a copy of this conversation; give it fresh: true when its area is unrelated to this conversation, so it starts',
    'with its own identity and none of what is here. Bots nest at most four levels. Tell the user what you changed;',
    'each change shows in the chat with its undo.',
    '',
    'Schedules: when the user wants something done on a schedule ("check the backups every morning"), the schedule tool',
    'creates a routine that wakes you: at each time it sends you its prompt as a message starting "[routine". Write the',
    'prompt to your future self, complete on its own. Answer a routine\'s message in this chat as you would the user; it',
    'comes from the schedule, not from the user. A run missed while pi-dish was down arrives once when it is back.',
    '',
    'Code mode: the codemode tool runs a short JavaScript script that calls your tools as `await tools.<name>(args)`;',
    'only what the script prints or returns enters this conversation. Use it when a request takes several calls whose',
    'results you filter or combine, or the same call across hosts or sessions ("which sessions on any host have been',
    'idle longest"): one script, not a call per host. Do not use it for a single call; call the tool. A script runs',
    'for at most ten minutes and you are busy while it runs, so keep it short. In a script, sessions wait returns a',
    'session\'s answer once it settles, so a script may start short work with spawn_worker and use the answer; a',
    'worker\'s answer a script took is not reported to you again. Longer work still goes to a worker and comes back as',
    'its report. Scripts cannot call new_context, bot_create or bot_update.',
].join('\n');
let claudeCode = null;
/**
 * pi-claude-code ships TypeScript source with `.ts` specifiers and a parameter
 * property, which Node's type stripping refuses inside node_modules. A load
 * hook transpiles exactly that package's sources; everything they import, pi-ai
 * included, loads natively and is shared with pi-durable.
 */
function loadClaudeCode() {
    claudeCode ??= (async () => {
        const root = path.dirname(require.resolve('@earendil-works/pi-claude-code/package.json'));
        const sources = url.pathToFileURL(path.join(root, 'src') + path.sep).href;
        nodeModule.registerHooks({
            load(specifier, context, nextLoad) {
                if (!specifier.startsWith(sources) || !specifier.endsWith('.ts'))
                    return nextLoad(specifier, context);
                const file = url.fileURLToPath(specifier);
                const { code } = esbuild.transformSync(fs.readFileSync(file, 'utf8'), {
                    loader: 'ts', format: 'esm', target: 'node22', sourcefile: file,
                });
                return { format: 'module', source: code, shortCircuit: true };
            },
        });
        // The package has no type declarations a CommonJS program can resolve.
        const provider = await import(`${sources}provider.ts`);
        const cli = await import(`${sources}claude-cli.ts`);
        return { createClaudeCodeProvider: provider.createClaudeCodeProvider, closeClaudeProcesses: cli.closeClaudeProcesses };
    })();
    return claudeCode;
}
/**
 * `claude-code/<id>` runs on the Claude subscription through the Claude Code
 * CLI; anything else goes through Pi's model runtime and its credentials.
 */
async function openBotModels(selector) {
    // Tests run a relay on a scripted model: the module the environment names stands in for this function.
    const scripted = process.env.PI_DISH_BOT_MODELS;
    if (scripted)
        return (await import(url.pathToFileURL(scripted).href)).openBotModels(selector);
    const provider = selector.slice(0, selector.indexOf('/'));
    if (provider === 'claude-code') {
        const pcc = await loadClaudeCode();
        const { createModels } = await import('@earendil-works/pi-ai/models');
        const models = createModels();
        models.setProvider(pcc.createClaudeCodeProvider());
        return { models, close: () => pcc.closeClaudeProcesses() };
    }
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
    return { models: await ModelRuntime.create(), close: async () => { } };
}
function liveOf(view) {
    const live = view.docs['pi.live'];
    return (0, helper_values_1.record)(live) ? live : {};
}
function usageTokens(message) {
    if (!(0, helper_values_1.record)(message) || !(0, helper_values_1.record)(message.usage))
        return 0;
    const usage = message.usage;
    return ['input', 'output', 'cacheRead', 'cacheWrite']
        .reduce((sum, key) => sum + (typeof usage[key] === 'number' ? usage[key] : 0), 0);
}
/** The entry's message; string content becomes a text block, as Pi transcripts hold it. */
function entryMessage(entry) {
    const message = entry.model?.[0];
    if (!(0, helper_values_1.record)(message))
        return null;
    return typeof message.content === 'string' ? { ...message, content: [{ type: 'text', text: message.content }] } : message;
}
async function openBotRuntime(options) {
    // ES modules needing node:sqlite: imported when a bot opens, never when this CommonJS module loads.
    const durable = await import('@earendil-works/pi-durable');
    const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
    const { createCodemodeExtension } = await import('@earendil-works/pi-durable/codemode');
    const { CodemodeSandbox } = await import('@earendil-works/pi-codemode');
    const schema = await import('@earendil-works/pi-schema');
    const { obj, opt, str, num, oneOf, arr, bool, lit, union, unknown: anyValue, nullable } = schema;
    const { bot, mirror, sessions, api: hub, emit, log } = options;
    const ctx = BACKGROUND_CONTEXT;
    const pollMs = options.pollMs ?? { first: WATCH_FIRST_POLL_MS, max: WATCH_MAX_POLL_MS };
    const slash = bot.model.indexOf('/');
    const modelRef = { provider: bot.model.slice(0, slash), modelId: bot.model.slice(slash + 1) };
    const modelInfo = options.models.getModel(modelRef.provider, modelRef.modelId);
    const windowLimit = Math.min(modelInfo?.contextWindow || exports.WINDOW_TOKEN_CAP, exports.WINDOW_TOKEN_CAP);
    const MemoryDoc = durable.defineDoc({
        kind: 'bot.memory',
        version: 2,
        scope: 'conversation',
        history: 'latest',
        fork: 'current',
        initial: () => ({ notebook: '', notebookSavedIn: -1, windows: [], workers: {} }),
        migrate: (value) => ({ ...value, workers: migrateWorkers(value.workers) }),
        checkpointWhen: () => true,
    });
    const ReportEntry = 'bot.report';
    /** Entries that start a run: what a change made in the run is attributed to. */
    const INPUT_KINDS = {
        'pi.user': true, [ReportEntry]: true, 'bot.room': true, 'bot.ask': true, 'bot.answer': true, 'bot.purpose': true, 'bot.routine': true,
    };
    /** Inputs from other bots: a turn they wake continues their chain one hop on. */
    const CHAINED_KINDS = { 'bot.room': true, 'bot.ask': true, 'bot.answer': true };
    /** Entries the transcript shows as notices rather than as the user's words. */
    const CUSTOM_TYPES = {
        [ReportEntry]: 'bot-worker-report', 'pi.reset': 'bot-context-window', 'bot.room': 'bot-room', 'bot.ask': 'bot-question',
        'bot.answer': 'bot-answer', 'bot.purpose': 'bot-purpose', 'bot.routine': 'bot-routine',
    };
    const roleOf = (kind) => kind === 'pi.assistant' ? 'assistant' : kind === 'pi.user' ? 'user' : kind === 'pi.reset' ? 'handoff' : kind.replace(/^bot\./, '');
    /** Questions from other families this bot has answered, so each answer goes back once. */
    const AsksDoc = durable.defineDoc({
        kind: 'bot.asks', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
        initial: () => ({ answered: {} }), checkpointWhen: () => true,
    });
    let root = null;
    const conversation = () => {
        if (!root)
            throw new Error('the bot conversation is not open yet');
        return root;
    };
    /** Entries from the newest reset (exclusive) to the end, newest first, up to `limit`. */
    async function currentWindow(limit) {
        const found = [];
        let cursor;
        do {
            const page = await conversation().entries({ order: 'descending' }, 200, cursor, ctx);
            for (const entry of page.items) {
                if (entry.kind === 'pi.reset')
                    return found;
                found.push(entry);
                if (found.length >= limit)
                    return found;
            }
            cursor = page.next;
        } while (cursor);
        return found;
    }
    /** Every entry, oldest first, split into windows at each reset. */
    async function allWindows() {
        const windows = [[]];
        let cursor;
        do {
            const page = await conversation().entries({ order: 'ascending' }, 500, cursor, ctx);
            for (const entry of page.items) {
                if (entry.kind === 'pi.reset')
                    windows.push([]);
                windows.at(-1).push(entry);
            }
            cursor = page.next;
        } while (cursor);
        return windows;
    }
    function isWork(entry) {
        if (Object.hasOwn(INPUT_KINDS, entry.kind))
            return true;
        const message = entryMessage(entry);
        return entry.kind === 'pi.tool-result' && !!message && !Object.hasOwn(MEMORY_TOOLS, String(message.toolName));
    }
    /** Closes the current window and fixes the next one's instructions; returns its handoff. */
    async function rollover(tx, conversationId, line, forced, window) {
        const memory = await tx.doc(MemoryDoc, conversationId);
        memory.windows.push({ line: line.trim().slice(0, 300) || '(no summary)', closedAt: new Date().toISOString(), forced });
        const current = options.loadBot();
        await durable.configure(tx, conversationId, {
            instructions: composeInstructions(current.identity, memory.notebook, current.places),
            thinkingLevel: current.thinking ? current.thinking : null,
        });
        const tail = window
            .filter(entry => Object.hasOwn(INPUT_KINDS, entry.kind) || entry.kind === 'pi.assistant')
            .map(entry => ({ role: roleOf(entry.kind), text: messageText(entryMessage(entry)).trim() }))
            .filter(message => message.text)
            .slice(0, TAIL_MESSAGES)
            .reverse()
            .map(message => ({ ...message, text: message.text.length > TAIL_MESSAGE_CHARS ? `${message.text.slice(0, TAIL_MESSAGE_CHARS)}…` : message.text }));
        const request = window.find(entry => Object.hasOwn(INPUT_KINDS, entry.kind));
        return composeHandoff({
            windowNumber: memory.windows.length + 1,
            closed: memory.windows,
            tail,
            request: request ? messageText(entryMessage(request)) : null,
            workers: Object.values(memory.workers).filter(worker => !worker.closedAt),
            forced,
        });
    }
    const WorkerWatch = durable.defineTask({
        name: 'bot.worker-watch',
        version: 2,
        initial: (input) => ({ phase: 'poll', delayMs: pollMs.first, since: input.since, reports: 0 }),
        // Version 1 ended the watch at its one report, posted as `worker-report:<dispatch>`.
        migrate: (rawInput, rawCheckpoint) => {
            const input = rawInput;
            const old = rawCheckpoint;
            const checkpoint = old.phase === 'report'
                ? { phase: 'report', report: String(old.report), state: String(old.state), requestId: `worker-report:${input.dispatchId}`,
                    since: input.since, reports: 1, final: true, stopped: old.state === 'inactive' }
                : { phase: 'poll', delayMs: old.delayMs ?? pollMs.first, since: input.since, reports: 0 };
            return { input, checkpoint };
        },
        phases: {
            poll: async (task, runtime, taskContext) => {
                const { dispatchId, ref, name, startedAt } = task.input;
                const { delayMs, since, reports } = task.state.checkpoint;
                let settled = null;
                let active = null;
                try {
                    const resolved = JSON.parse(await sessions(['resolve', ref, '--json', '--fields', 'all']));
                    const window = JSON.parse(await sessions(['show', ref, '--limit', '1', '--json']));
                    const row = (0, helper_values_1.record)(resolved) ? resolved.session : null;
                    settled = settledWorker(row, window, since);
                    active = (0, helper_values_1.record)(row) && row.isActive === true;
                }
                catch (error) {
                    // The hub may be restarting; a failed poll is retried, never reported.
                    log(`watch ${name} (${ref}): ${error instanceof Error ? error.message : String(error)}`);
                }
                const expired = runtime.now() - startedAt > WATCH_GIVE_UP_MS;
                if (!settled && !expired) {
                    const next = { phase: 'poll', delayMs: Math.min(Math.round(delayMs * 1.5), pollMs.max), since, reports };
                    return runtime.sleepUntil(runtime.now() + delayMs, next, taskContext);
                }
                const stopped = active === false;
                const number = reports + 1;
                const now = new Date().toISOString();
                await runtime.commit(async (tx) => {
                    const worker = (await tx.doc(MemoryDoc, runtime.conversationId)).workers[dispatchId];
                    // The bot closed this worker itself, so it already has what it needs.
                    if (stopped && worker?.closing) {
                        worker.closedAt ??= now;
                        worker.watchEndedAt = now;
                        return { status: 'terminal', outcome: { status: 'completed', result: null } };
                    }
                    const later = (nextSince) => ({
                        status: 'sleeping', until: runtime.now() + delayMs,
                        checkpoint: { phase: 'poll', delayMs: Math.min(Math.round(delayMs * 1.5), pollMs.max), since: nextSince, reports },
                    });
                    // A script is waiting for this answer with sessions wait: it is the script's, unless the wait gives up.
                    if (!stopped && !expired && worker?.waitingUntil !== undefined && runtime.now() < worker.waitingUntil)
                        return later(since);
                    const fresh = settled && settled.state !== 'inactive' ? settled : null;
                    // A script already took this answer, so the bot has it.
                    const taken = fresh !== null && (worker?.seen ?? -1) >= fresh.totalMessages;
                    if (taken && !stopped && !expired)
                        return later(fresh.totalMessages);
                    const answered = taken ? null : fresh;
                    const heading = answered?.state === 'waiting' ? 'is waiting for an answer'
                        : answered ? (number === 1 ? 'finished' : 'finished another turn')
                            : stopped ? (number === 1 && !taken ? 'stopped without a final answer' : 'has stopped')
                                : 'is still working after 24 hours';
                    const parts = [`[worker report] "${name}" (${ref}) ${heading}.`];
                    if (answered) {
                        parts.push(answered.text.length > REPORT_CHARS
                            ? `${answered.text.slice(0, REPORT_CHARS)}\n[cut at ${REPORT_CHARS} characters; read the rest with sessions read ${ref}]`
                            : answered.text || '(no text)');
                    }
                    if (stopped)
                        parts.push('The session is closed; it is no longer watched.');
                    else if (expired)
                        parts.push('It has been watched for 24 hours and is no longer watched.');
                    return {
                        status: 'running',
                        checkpoint: {
                            phase: 'report', report: parts.join('\n\n'), state: settled?.state ?? 'working',
                            requestId: `worker-report:${dispatchId}:${number}`, since: settled?.totalMessages ?? since, reports: number,
                            final: stopped || expired, stopped,
                        },
                    };
                }, taskContext);
            },
            report: async (task, runtime, taskContext) => {
                const { dispatchId, ref, name } = task.input;
                const { report, state, requestId, since, reports, final, stopped } = task.state.checkpoint;
                const handle = (await runtime.conversation(runtime.conversationId, taskContext));
                // The request id makes each report post once, also when a crash reruns the phase.
                await handle.submit({
                    type: 'input', content: report, whenBusy: 'followUp', requestId,
                    entry: { kind: ReportEntry, data: { dispatchId, ref, name, state, report: reports } },
                }, taskContext);
                await runtime.commit(async (tx) => {
                    const worker = (await tx.doc(MemoryDoc, runtime.conversationId)).workers[dispatchId];
                    const now = new Date().toISOString();
                    if (worker) {
                        worker.reports = reports;
                        if (stopped)
                            worker.closedAt ??= now;
                        if (final)
                            worker.watchEndedAt = now;
                    }
                    if (final)
                        return { status: 'terminal', outcome: { status: 'completed', result: null } };
                    // Back to watching: a later turn that adds messages is the next report.
                    return { status: 'sleeping', until: runtime.now() + pollMs.first, checkpoint: { phase: 'poll', delayMs: pollMs.first, since, reports } };
                }, taskContext);
            },
        },
        abort: (_task, runtime, taskContext) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), taskContext),
    });
    const text = (value) => ({ output: [{ type: 'text', text: value }] });
    const refusal = (value) => ({ ...text(value), isError: true });
    /** A result for both readers: `shown` for the model, `value` for a script. */
    const both = (shown, value) => ({ ...text(shown), structuredOutput: value });
    /**
     * Whether a script, not the model, made this call: a nested call's id is its caller's id, a slash and its key. A
     * script never reads the model's text, so a tool may skip the work of making it.
     */
    const fromScript = (api) => api.callId.includes('/');
    const spawnWorker = durable.defineTool({
        name: 'spawn_worker',
        description: 'Start a pi-dish session that carries out one task on its own. Returns its ref at once; each answer it gives arrives later as a "[worker report]" message. Give it a complete brief: it knows nothing of this conversation.',
        parameters: obj({
            name: str({ description: 'Short name for the worker session' }),
            brief: str({ description: 'The complete task: goal, context, constraints, and what to report back' }),
            host: opt(str({ description: 'Fleet host to run on; omitted: this host' })),
            cwd: opt(str({ description: 'Working directory; omitted: the home directory' })),
            harness: opt(str({ description: 'pi (default), omp or agy' })),
            model: opt(str({ description: 'provider/model-id; omitted: the harness default' })),
            thinking: opt(str({ description: 'Thinking level for the worker' })),
        }),
        structuredOutputSchema: obj({
            ref: str({ description: 'The worker\'s ref, for sessions read, wait and close' }),
            name: str(),
            host: nullable(str({ description: 'Fleet host it runs on; null: this host' })),
        }),
        // A rerun finds its own dispatch id and never launches twice (below).
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const dispatchId = await api.memo('dispatch', crypto.randomUUID(), callContext);
            let spawned = await api.memo('spawned', callContext);
            if (!spawned) {
                if (await api.memo('attempted', callContext)) {
                    return refusal(`The launch of "${args.name}" (dispatch ${dispatchId.slice(0, 8)}) was cut off and its outcome is unknown, so it was not started again. Look for a session named "${args.name} · ${dispatchId.slice(0, 8)}" with the sessions tool before starting another.`);
                }
                await api.memo('attempted', true, callContext);
                const argv = ['spawn', '--json', '--name', `${args.name} · ${dispatchId.slice(0, 8)}`, '--harness', args.harness || 'pi',
                    '--cwd', args.cwd || '~', '--prompt', args.brief];
                if (args.host)
                    argv.push('--host', args.host);
                if (args.model)
                    argv.push('--model', args.model);
                if (args.thinking)
                    argv.push('--thinking-level', args.thinking);
                const result = JSON.parse(await sessions(argv));
                if (!(0, helper_values_1.record)(result) || typeof result.sessionId !== 'string')
                    throw new Error('spawn returned no session id');
                spawned = await api.memo('spawned', {
                    sessionId: result.sessionId, harness: String(result.harness ?? args.harness ?? 'pi'),
                }, callContext);
            }
            const { sessionId, harness } = spawned;
            // The short ref `list` shows: what the bot repeats to the user and watches by.
            const ref = `${args.host ? `${args.host}/` : ''}${(0, helper_refs_1.stableSessionRef)(sessionId)}`;
            await api.commit(async (tx) => {
                const memory = await tx.doc(MemoryDoc, api.conversationId);
                if (memory.workers[dispatchId])
                    return;
                memory.workers[dispatchId] = {
                    name: args.name, ref, sessionId, harness, host: args.host ?? null, startedAt: new Date().toISOString(), reports: 0,
                };
                // A fresh spawn's transcript is empty, so any answer is its own.
                await tx.createTask(WorkerWatch, { dispatchId, ref, name: args.name, since: 0, startedAt: api.now() }, { ownership: { kind: 'conversation' }, background: true });
            }, callContext);
            return both(`Started worker "${args.name}" (${harness}${args.host ? ` on ${args.host}` : ''}). Ref: ${ref}. Each answer it gives arrives as a "[worker report]" message.`, { ref, name: args.name, host: args.host ?? null });
        },
    });
    /** A worker this bot started, by its ref or session id. */
    function ownWorker(memory, wanted) {
        return Object.entries(memory?.workers ?? {}).find(([, worker]) => wanted === worker.ref || wanted === worker.sessionId
            || (worker.host !== null && wanted === `${worker.host}/${worker.sessionId}`));
    }
    /** Closes a session this bot started; any other ref is refused. */
    async function closeWorker(wanted, api, callContext) {
        const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
        const found = ownWorker(memory, wanted);
        if (!found) {
            const open = Object.values(memory?.workers ?? {}).filter(worker => !worker.closedAt).map(worker => worker.ref);
            return refusal(`Refused: ${wanted} is not a worker you started, and you can close only your own workers. Open workers: ${open.join(', ') || 'none'}.`);
        }
        const [dispatchId, worker] = found;
        const mark = (closing) => api.commit(async (tx) => {
            const draft = (await tx.doc(MemoryDoc, api.conversationId)).workers[dispatchId];
            if (closing)
                draft.closing = true;
            else
                delete draft.closing;
        }, callContext);
        // Marked first, so its watch, seeing the session stop, ends without reporting the close back.
        await mark(true);
        let alreadyClosed = false;
        try {
            await sessions(['close', worker.ref]);
        }
        catch (error) {
            // A worker closed from outside whose watch is gone, such as one carried over from before workers were watched
            // until closed, is refused as not active: the bot's record of it is closed instead.
            let active = true;
            try {
                const resolved = JSON.parse(await sessions(['resolve', worker.ref, '--json', '--fields', 'all']));
                active = !((0, helper_values_1.record)(resolved) && (0, helper_values_1.record)(resolved.session) && resolved.session.isActive === false);
            }
            catch { }
            if (active) {
                await mark(false);
                throw error;
            }
            alreadyClosed = true;
        }
        await api.commit(async (tx) => {
            const draft = (await tx.doc(MemoryDoc, api.conversationId)).workers[dispatchId];
            draft.closedAt ??= new Date().toISOString();
        }, callContext);
        return both(alreadyClosed
            ? `Worker "${worker.name}" (${worker.ref}) had already been closed; it is now marked closed in your records.`
            : `Closed worker "${worker.name}" (${worker.ref}).`, { action: 'close', ref: worker.ref, alreadyClosed });
    }
    /**
     * Waits until a session settles or `timeout` seconds pass, with the CLI's settle rule, and returns its answer. While
     * it waits for one of the bot's own workers, the worker's watch holds its report, and an answer it returns is never
     * reported: the script that asked has it.
     */
    async function waitFor(ref, since, timeout, api, callContext) {
        const secs = Math.min(Math.max(1, Math.floor(timeout ?? WAIT_DEFAULT_SECS)), WAIT_MAX_SECS);
        const own = ownWorker(await api.snapshot(MemoryDoc, api.conversationId, callContext), ref)?.[0];
        const mark = (change) => own === undefined ? Promise.resolve() : api.commit(async (tx) => {
            const worker = (await tx.doc(MemoryDoc, api.conversationId)).workers[own];
            if (worker)
                change(worker);
        }, callContext);
        // Past the wait, plus time for the CLI to start and answer, the watch reports as usual.
        await mark(worker => { worker.waitingUntil = api.now() + (secs + 30) * 1000; });
        let settled;
        try {
            const argv = ['wait', ref, '--timeout', String(secs), '--json', ...(since === undefined ? [] : ['--since', String(Math.max(0, Math.floor(since)))])];
            const data = JSON.parse(await sessions(argv, callContext.abortSignal));
            const row = (0, helper_values_1.record)(data) ? data : {};
            settled = { state: row.state === 'waiting' ? 'waiting' : 'finished', totalMessages: Number(row.totalMessages) || 0, text: messageText(row.message) };
        }
        finally {
            await mark(worker => { delete worker.waitingUntil; });
        }
        await mark(worker => { worker.seen = Math.max(worker.seen ?? 0, settled.totalMessages); });
        return both(`# ${settled.state === 'waiting' ? 'waiting for an answer' : 'finished'}: ${ref} · ${settled.totalMessages} messages\n${settled.text}`, { action: 'wait', ref, ...settled });
    }
    /** A session row of `list` or `search --json`, as a script sees it; `host` is the fleet host, absent for this one. */
    function sessionRow(raw, host) {
        const row = (0, helper_values_1.record)(raw) ? raw : {};
        const where = host && host !== '(self)' ? host : undefined;
        const ref = String(row.ref || row.id || '');
        const state = row.isActive === true ? (row.turnInProgress === true || row.compacting === true ? 'working' : 'active')
            : row.subagentLive === true ? 'subagent' : 'inactive';
        return {
            ref: where ? `${where}/${ref}` : ref, name: String(row.name || 'Unnamed'), cwd: String(row.cwd ?? ''), harness: String(row.harnessId ?? ''),
            ...(typeof row.model === 'string' ? { model: row.model } : {}), state,
            ...(typeof row.lastActivity === 'string' ? { lastActivity: row.lastActivity } : {}),
            ...(typeof row.messageCount === 'number' ? { messages: row.messageCount } : {}),
            ...(where ? { host: where } : {}),
        };
    }
    /** What a script gets from `list`, `read`, `search`, `hosts` or `load`, made from the CLI's JSON. */
    function sessionsValue(action, data, args) {
        const page = (0, helper_values_1.record)(data) ? data : {};
        const list = (value) => Array.isArray(value) ? value : [];
        const share = (value) => {
            const bytes = (0, helper_values_1.record)(value) ? value : {};
            const total = Number(bytes.totalBytes), available = Number(bytes.availableBytes);
            return total > 0 && Number.isFinite(available) ? Math.round((total - available) / total * 100) : undefined;
        };
        if (action === 'list') {
            const rows = [...list(page.active), ...list(page.children), ...list(page.previous)];
            return { action, sessions: rows.map(row => sessionRow(row, args.host)), total: Number(page.total) || rows.length };
        }
        if (action === 'search') {
            return {
                action,
                results: list(page.results).map(raw => {
                    const row = (0, helper_values_1.record)(raw) ? raw : {};
                    return { ...sessionRow(row, typeof row.host === 'string' ? row.host : args.host), matches: Number(row.matchCount) || 0, snippets: list(row.snippets).map(String) };
                }),
                ...(typeof page.total === 'number' ? { total: page.total } : {}),
            };
        }
        if (action === 'read') {
            return {
                action, ref: args.ref ?? '', totalMessages: Number(page.totalMessages) || 0,
                messages: list(page.messages).map(raw => {
                    const message = (0, helper_values_1.record)(raw) ? raw : {};
                    return { role: String(message.role ?? ''), text: messageText(message), ...(typeof message.toolName === 'string' ? { tool: message.toolName } : {}) };
                }),
            };
        }
        if (action === 'hosts') {
            return {
                action,
                hosts: list(page.hosts).map(raw => {
                    const host = (0, helper_values_1.record)(raw) ? raw : {};
                    const capabilities = (0, helper_values_1.record)(host.capabilities) ? host.capabilities : {};
                    return {
                        ...(host.self === true || typeof host.name !== 'string' ? {} : { name: host.name }), self: host.self === true,
                        label: String(host.label ?? host.name ?? ''), reachable: host.self === true || host.reachable === true,
                        ...(typeof host.error === 'string' ? { error: host.error } : {}),
                        capabilities: Object.keys(capabilities).filter(key => capabilities[key] === true),
                    };
                }),
            };
        }
        const cpu = (0, helper_values_1.record)(page.cpu) ? page.cpu : {};
        const live = (0, helper_values_1.record)(page.sessions) ? page.sessions : {};
        const numbers = {
            live: Number(live.live) || 0, working: Number(live.working) || 0,
            cpuPercent: typeof cpu.utilization === 'number' ? Math.round(cpu.utilization * 100) : undefined,
            load1: Array.isArray(cpu.load) && typeof cpu.load[0] === 'number' ? cpu.load[0] : undefined,
            cores: typeof cpu.cores === 'number' ? cpu.cores : undefined,
            memoryUsedPercent: share(page.memory), diskUsedPercent: share(page.disk),
        };
        const known = Object.fromEntries(Object.entries(numbers).filter((entry) => entry[1] !== undefined));
        return { action, ...(args.host ? { host: args.host } : {}), ...known };
    }
    const sessionRowSchema = {
        ref: str({ description: 'What to pass as ref; host/ref for another host' }),
        name: str(), cwd: str(), harness: str(), model: opt(str()),
        state: oneOf(['working', 'active', 'subagent', 'inactive']),
        lastActivity: opt(str({ description: 'ISO time of its last activity' })),
        messages: opt(num({ description: 'Messages in its transcript' })),
        host: opt(str({ description: 'Fleet host; absent: this host' })),
    };
    const sessionsTool = durable.defineTool({
        name: 'sessions',
        description: 'pi-dish sessions and hosts: list live sessions, read a transcript, search every transcript, send a message to a session, close a worker you started, list the fleet\'s hosts, or show how busy a host is. In a code mode script, wait blocks until a session settles and returns its answer.',
        parameters: obj({
            action: oneOf(['list', 'read', 'search', 'send', 'close', 'hosts', 'load', 'wait']),
            ref: opt(str({ description: 'Session ref, for read, send, close and wait' })),
            query: opt(str({ description: 'Search terms, for search' })),
            message: opt(str({ description: 'Text to send, for send' })),
            host: opt(str({ description: 'Limit list or search to one host; the host for load' })),
            limit: opt(num({ description: 'Rows or messages to show' })),
            since: opt(num({ description: 'For wait: settle only once the transcript holds more than this many messages; omitted: a fresh worker\'s first answer, or an idle session\'s last' })),
            timeout: opt(num({ description: `For wait: seconds to wait, at most ${WAIT_MAX_SECS}; default ${WAIT_DEFAULT_SECS}. Past it the call fails` })),
        }),
        structuredOutputSchema: union([
            obj({ action: lit('list'), sessions: arr(obj(sessionRowSchema)), total: num() }),
            obj({ action: lit('search'), results: arr(obj({ ...sessionRowSchema, matches: num(), snippets: arr(str()) })), total: opt(num()) }),
            obj({
                action: lit('read'), ref: str(), totalMessages: num(),
                messages: arr(obj({ role: str(), text: str(), tool: opt(str({ description: 'The tool of a toolResult' })) }), { description: 'Oldest first' }),
            }),
            obj({
                action: lit('hosts'),
                hosts: arr(obj({
                    name: opt(str({ description: 'Pass as host; absent for this host' })), self: bool(), label: str(), reachable: bool(),
                    error: opt(str()), capabilities: arr(str()),
                })),
            }),
            obj({
                action: lit('load'), host: opt(str()), live: num(), working: num(), cpuPercent: opt(num()), load1: opt(num()), cores: opt(num()),
                memoryUsedPercent: opt(num()), diskUsedPercent: opt(num()),
            }),
            obj({ action: lit('send'), ref: str(), response: anyValue({ description: 'The host\'s answer: held and until when it holds the message' }) }),
            obj({ action: lit('close'), ref: str(), alreadyClosed: bool() }),
            obj({ action: lit('wait'), ref: str(), state: oneOf(['finished', 'waiting']), totalMessages: num(), text: str({ description: 'Its final answer' }) }),
        ]),
        // Reads rerun after a restart, so a script's wait carries on; send guards itself below, and close is idempotent.
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const signal = callContext.abortSignal;
            const host = args.host ? ['--host', args.host] : [];
            const limit = args.limit ? ['--limit', String(Math.max(1, Math.floor(args.limit)))] : [];
            const need = (value, field) => {
                if (!value)
                    throw new Error(`${args.action} needs ${field}`);
                return value;
            };
            if (args.action === 'close')
                return closeWorker(need(args.ref, 'ref'), api, callContext);
            if (args.action === 'wait')
                return waitFor(need(args.ref, 'ref'), args.since, args.timeout, api, callContext);
            if (args.action === 'send') {
                const ref = need(args.ref, 'ref');
                if (await api.memo('sending', callContext)) {
                    return refusal(`The send to ${ref} was cut off by a restart and its outcome is unknown, so it was not sent again. Read the session before sending it again.`);
                }
                await api.memo('sending', true, callContext);
                const shown = (await sessions(['send', ref, need(args.message, 'message'), '--json'], signal)).trim();
                return both(shown || '(no output)', { action: 'send', ref, response: JSON.parse(shown || 'null') });
            }
            const action = args.action;
            const [textArgv, jsonArgv] = action === 'list' ? [['list', '--active', ...host, ...limit], ['list', '--active', ...host, ...(limit.length ? limit : ['--full'])]]
                : action === 'read' ? [['read', need(args.ref, 'ref'), ...limit], ['show', need(args.ref, 'ref'), ...(limit.length ? limit : ['--limit', '30']), '--max-chars', '0']]
                    : action === 'search' ? [['search', need(args.query, 'query'), ...(args.host ? host : ['--all-hosts']), ...limit], null]
                        : [[action, ...(action === 'load' ? host : [])], null];
            // The model's text is the CLI's, as before; a script's value comes from the same command's JSON.
            const [shown, data] = await Promise.all([
                fromScript(api) ? null : sessions(textArgv, signal),
                sessions([...(jsonArgv ?? textArgv), '--json'], signal),
            ]);
            const value = sessionsValue(action, JSON.parse(data), args);
            return both(shown === null ? JSON.stringify(value) : shown.trim() || '(no output)', value);
        },
    });
    const contextNotes = durable.defineTool({
        name: 'context_notes',
        description: `Read or replace your notebook (at most ${exports.NOTEBOOK_MAX_BYTES} bytes). It is the memory that carries over to a new context window. "write" replaces the whole notebook.`,
        parameters: obj({ action: oneOf(['read', 'write']), text: opt(str()) }),
        replay: 'safe',
        execute: async (args, api, callContext) => {
            if (args.action === 'read') {
                const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
                return text(memory?.notebook || '(the notebook is empty)');
            }
            const notebook = args.text ?? '';
            const bytes = Buffer.byteLength(notebook, 'utf8');
            if (bytes > exports.NOTEBOOK_MAX_BYTES)
                return refusal(`Not saved: ${bytes} bytes is over the ${exports.NOTEBOOK_MAX_BYTES}-byte cap. Shorten it and write it again.`);
            await api.commit(async (tx) => {
                const memory = await tx.doc(MemoryDoc, api.conversationId);
                memory.notebook = notebook;
                memory.notebookSavedIn = memory.windows.length;
            }, callContext);
            return text(`Saved (${bytes} of ${exports.NOTEBOOK_MAX_BYTES} bytes). Your instructions show it from the next window on.`);
        },
    });
    const newContext = durable.defineTool({
        name: 'new_context',
        description: 'Close this context window and continue in a fresh one that holds your identity, your saved notebook, the end of this conversation, the latest request and your running workers. Nothing else carries over; earlier windows stay readable with history.',
        parameters: obj({ summary: str({ description: 'One line saying what this window covered' }) }),
        // A script must not roll the window over under the model.
        callers: ['model'],
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const window = await currentWindow(Number.MAX_SAFE_INTEGER);
            const outcome = await api.commit(async (tx) => {
                const memory = await tx.doc(MemoryDoc, api.conversationId);
                const refused = newContextRefusal(memory, window.some(isWork));
                if (refused)
                    return { refused };
                return { handoff: await rollover(tx, api.conversationId, args.summary, false, window) };
            }, callContext);
            if ('refused' in outcome)
                return refusal(outcome.refused);
            return { ...text('A new context window starts with the next request.'), control: { handoff: outcome.handoff } };
        },
    });
    const history = durable.defineTool({
        name: 'history',
        description: 'Your earlier context windows: "windows" lists them, "read" shows one (numbered from 1; the current one is the last), "search" finds text in all of them.',
        parameters: obj({
            action: oneOf(['windows', 'read', 'search']),
            window: opt(num()),
            query: opt(str()),
            offset: opt(num({ description: 'For read: messages to skip' })),
        }),
        structuredOutputSchema: union([
            obj({ action: lit('windows'), windows: arr(obj({ number: num(), summary: nullable(str({ description: 'Its one-line summary; null for the current window' })), messages: num() })) }),
            obj({ action: lit('read'), window: num(), offset: num(), total: num(), messages: arr(obj({ role: str(), text: str() }), { description: 'At most 40, from offset' }) }),
            obj({ action: lit('search'), hits: arr(obj({ window: num(), text: str({ description: 'The match with some text around it' }) }), { description: 'At most 20' }) }),
        ]),
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const windows = await allWindows();
            const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
            const messagesOf = (entries) => entries.flatMap(entry => {
                const message = entryMessage(entry);
                const body = messageText(message).trim();
                if (!body || entry.kind === 'pi.system')
                    return [];
                const role = entry.kind.startsWith('bot.') || entry.kind === 'pi.reset' ? roleOf(entry.kind) : String(message?.role ?? entry.kind);
                return [{ role, text: body }];
            });
            const line = (message) => `[${message.role}] ${message.text}`;
            if (args.action === 'windows') {
                const listed = windows.map((entries, index) => ({ number: index + 1, summary: memory?.windows[index]?.line ?? null, messages: messagesOf(entries).length }));
                return both(listed.map(window => `${window.number}. ${window.summary ?? '(current window)'} — ${window.messages} messages`).join('\n'), { action: 'windows', windows: listed });
            }
            if (args.action === 'read') {
                const number = Math.floor(args.window ?? windows.length);
                const entries = windows[number - 1];
                if (!entries)
                    return refusal(`There is no window ${number}; there are ${windows.length}.`);
                const all = messagesOf(entries);
                const offset = Math.max(0, Math.floor(args.offset ?? 0));
                const page = all.slice(offset, offset + 40);
                const more = offset + page.length < all.length ? `\n[${all.length - offset - page.length} more; read again with offset ${offset + page.length}]` : '';
                return both(`Window ${number}, messages ${offset + 1}–${offset + page.length} of ${all.length}:\n\n${page.map(line).join('\n\n')}${more}`, { action: 'read', window: number, offset, total: all.length, messages: page });
            }
            const query = (args.query ?? '').trim().toLowerCase();
            if (!query)
                return refusal('search needs a query');
            const hits = [];
            windows.forEach((entries, index) => {
                for (const message of messagesOf(entries)) {
                    const shown = line(message);
                    const at = shown.toLowerCase().indexOf(query);
                    if (at < 0 || hits.length >= 20)
                        continue;
                    hits.push({ window: index + 1, text: `…${shown.slice(Math.max(0, at - 120), at + query.length + 200).replace(/\s+/g, ' ')}…` });
                }
            });
            return both(hits.length ? hits.map(hit => `window ${hit.window}: ${hit.text}`).join('\n') : `No match for "${args.query}".`, { action: 'search', hits });
        },
    });
    const kbSearch = durable.defineTool({
        name: 'kb_search',
        description: 'Search the shared knowledge base: pages holding every term (case-insensitive), with their matching lines.',
        parameters: obj({ query: str({ description: 'Search terms' }) }),
        structuredOutputSchema: obj({
            results: arr(obj({ path: str({ description: 'The page, for kb_read' }), lines: arr(obj({ line: num(), text: str() })) })),
            total: num({ description: 'Pages that match; more than results when the list was cut' }),
        }),
        replay: 'safe',
        execute: async (args) => {
            const found = await hub(`/api/knowledge/search?q=${encodeURIComponent(args.query)}`);
            const value = {
                results: found.results.map(hit => ({ path: hit.path, lines: hit.lines.map(line => ({ line: line.line, text: line.text })) })),
                total: found.total,
            };
            if (!found.results.length)
                return both(`Nothing in the knowledge base matches "${args.query}".`, value);
            const pages = found.results.map(hit => [hit.path, ...hit.lines.map(line => `  ${line.line}: ${line.text}`)].join('\n'));
            const more = found.total > found.results.length ? `\n\n[${found.total - found.results.length} more pages match; add a term to narrow it]` : '';
            return both(`${pages.join('\n\n')}${more}`, value);
        },
    });
    const kbRead = durable.defineTool({
        name: 'kb_read',
        description: 'Read a knowledge base page, or the index (one line per page) when no page is named.',
        parameters: obj({ page: opt(str({ description: 'Page name, such as "beelink" or "topics/beelink.md"; omitted: the index' })) }),
        structuredOutputSchema: obj({ path: str(), text: str({ description: 'The page\'s markdown' }) }),
        replay: 'safe',
        execute: async (args) => {
            const page = await hub(`/api/knowledge/page${args.page ? `?page=${encodeURIComponent(args.page)}` : ''}`);
            return both(`${page.path}:\n\n${page.text}`, { path: page.path, text: page.text });
        },
    });
    const kbWrite = durable.defineTool({
        name: 'kb_write',
        description: 'Write to the shared knowledge base. "append" (the default) adds one entry, a short paragraph or bullet, to a page and creates the page when it is new; the date and your name are added for you. "replace" rewrites a whole page, for tidying it: keep each entry\'s source and date.',
        parameters: obj({
            page: str({ description: 'Page name: lowercase words joined by hyphens, one page per topic, such as "beelink" or "backups"' }),
            text: str({ description: 'The entry, or the whole page for replace' }),
            source: opt(str({ description: 'Where the fact comes from: a command and host, a file, a URL, a worker\'s report. Required for append' })),
            mode: opt(oneOf(['append', 'replace'])),
            title: opt(str({ description: 'Title of a new page; omitted: the page name' })),
        }),
        // A rerun could add the entry twice.
        replay: 'unsafe',
        execute: async (args) => {
            const written = await hub('/api/knowledge/pages', {
                page: args.page, mode: args.mode ?? 'append', text: args.text, author: options.loadBot().name,
                ...(args.source ? { source: args.source } : {}), ...(args.title ? { title: args.title } : {}),
            });
            const pushed = written.pushed ? '' : ` It is not on the remote yet (${written.pushError ?? 'push failed'}); the next write pushes it.`;
            return text(`${written.commit ? 'Saved' : 'Unchanged'}: ${written.path}${written.created ? ' (a new page, added to the index)' : ''}.${pushed}`);
        },
    });
    /** The input that started the current run: the newest input entry. */
    async function currentInput() {
        let cursor;
        do {
            const page = await conversation().entries({ order: 'descending' }, 200, cursor, ctx);
            const input = page.items.find(entry => Object.hasOwn(INPUT_KINDS, entry.kind));
            if (input)
                return input;
            cursor = page.next;
        } while (cursor);
        return null;
    }
    /**
     * The current turn as `<bot>/<entry>`, and the chain a post or question made in it belongs to: a turn another
     * bot's message woke continues that chain one hop on; any other turn starts a chain of its own at hop 1.
     */
    async function currentChain() {
        const input = await currentInput();
        const turn = `${bot.id}/${input?.id ?? 0}`;
        const data = input && Object.hasOwn(CHAINED_KINDS, input.kind) && (0, helper_values_1.record)(input.data) ? input.data : null;
        if (data && typeof data.chain === 'string' && typeof data.hop === 'number')
            return { turn, chain: data.chain, hop: data.hop + 1 };
        return { turn, chain: turn, hop: 1 };
    }
    /** A bot by name or id, from the registry; retired bots are not found. */
    async function findBot(wanted) {
        const { bots } = await hub('/api/bots');
        const name = wanted.trim().toLowerCase();
        return bots.find(row => row.status !== 'retired' && (row.id === wanted || row.name.toLowerCase() === name)) ?? null;
    }
    /** A bot this one can see (itself, an ancestor or a descendant) by name or id; a retired one only when no other matches. */
    async function rosterBot(wanted) {
        const { bots } = await hub(`/api/bots/${bot.id}/roster`);
        const name = wanted.trim().toLowerCase();
        const matches = bots.filter(row => row.id === wanted || row.name.toLowerCase() === name);
        return matches.find(row => row.status !== 'retired') ?? matches[0] ?? null;
    }
    /**
     * The current window as a sub-bot starts from it: from its handoff up to the newest model response, which holds
     * the call creating the sub-bot and any call beside it. What is copied is exactly what this bot's last request
     * sent, so the sub-bot's first request repeats it and reads it from the prompt cache, and it holds no unfinished
     * tool call to continue.
     */
    async function forkEntries() {
        const newestFirst = [];
        let cursor;
        let reset = false;
        do {
            const page = await conversation().entries({ order: 'descending' }, 200, cursor, ctx);
            for (const entry of page.items) {
                newestFirst.push(entry);
                if (entry.kind === 'pi.reset') {
                    reset = true;
                    break;
                }
            }
            cursor = page.next;
        } while (cursor && !reset);
        const cut = newestFirst.findIndex(entry => entry.kind === 'pi.assistant');
        return newestFirst.slice(cut + 1).reverse().map(entry => ({
            kind: entry.kind,
            ...(entry.model ? { model: [...entry.model] } : {}),
            ...(entry.data !== undefined ? { data: entry.data } : {}),
            ...(entry.head === entry.id ? { head: 'self' } : {}),
        }));
    }
    const placesParameter = opt(arr(obj({
        host: opt(str({ description: 'Fleet host; omitted: this host' })), cwd: str(), label: str({ description: 'What the bot calls the place' }),
    }), { description: 'Where the bot works; replaces the whole list' }));
    const botCreate = durable.defineTool({
        name: 'bot_create',
        description: 'Create a sub-bot under you: a long-lived bot that is the standing contact for a narrower area. By default it starts from this conversation as it stood before this call, so it knows what you know, and keeps your identity until its first new context window, where it takes the identity you give here and a notebook of its own. With fresh, it starts with an empty conversation and that identity from its first turn: use it for an area this conversation has nothing to do with. Either way its purpose arrives as its first message. It runs on your model unless you name one. Bots nest at most four levels deep.',
        // Bot changes stay deliberate: the model's own, each shown to the user.
        callers: ['model'],
        parameters: obj({
            name: str({ description: 'Its name' }),
            purpose: str({ description: 'What it is for and what to do first; its first message' }),
            identity: str({ description: 'Its standing identity: who it is, what it is the contact for, how it works. A fresh bot has it from its first turn, a copy from its first new window' }),
            places: placesParameter,
            fresh: opt(bool({ description: 'Start it with an empty conversation and its own identity instead of a copy of this conversation' })),
            model: opt(str({ description: 'provider/model-id; omitted: your model' })),
        }),
        // A rerun finds its own child id: the registry creates a bot once per id.
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const childId = await api.memo('child', crypto.randomUUID(), callContext);
            const self = options.loadBot();
            const childDir = path.join(options.botsDir, childId);
            if (!await api.memo('seeded', callContext)) {
                let seed;
                if (args.fresh) {
                    seed = { fresh: true, parentId: bot.id, parentName: self.name, purpose: composeFreshPurpose(self.name, args.name, args.purpose) };
                }
                else {
                    const agent = await api.agent(callContext);
                    seed = {
                        parentId: bot.id, parentName: self.name, instructions: agent.instructions ?? '', thinkingLevel: agent.thinkingLevel,
                        purpose: composePurpose(self.name, args.name, args.purpose), entries: await forkEntries(),
                    };
                }
                fs.mkdirSync(childDir, { recursive: true, mode: 0o700 });
                const file = path.join(childDir, exports.FORK_SEED);
                fs.writeFileSync(`${file}.tmp`, JSON.stringify(seed), { mode: 0o600 });
                fs.renameSync(`${file}.tmp`, file);
                await api.memo('seeded', true, callContext);
            }
            let created;
            try {
                created = await hub('/api/bots', {
                    id: childId, parentId: bot.id, name: args.name, identity: args.identity, model: args.model ?? self.model,
                    ...(self.thinking ? { thinking: self.thinking } : {}), places: args.places ?? [], by: bot.id, turn: (await currentChain()).turn,
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                // A refusal leaves no bot behind; a bot that was created but did not start keeps its start for a retry.
                if (!message.startsWith('Created '))
                    fs.rmSync(childDir, { recursive: true, force: true });
                return refusal(message);
            }
            const start = args.fresh ? 'It starts fresh, with its own identity and none of this conversation,' : 'It starts from this conversation';
            return text(`Created sub-bot "${created.bot.name}" on ${created.bot.model}. ${start} and is reading its purpose now; it reports to the user in its own chat. Reach it with room_post.`);
        },
    });
    const roomPost = durable.defineTool({
        name: 'room_post',
        description: 'Post a message to your family\'s room: your parent, your sub-bots and theirs. Only the bots you name are woken; it arrives in their conversation. A chain of replies is capped, so post only what needs their attention, and do not reply just to acknowledge.',
        parameters: obj({
            to: arr(str(), { description: 'Names of the bots the message is for' }),
            message: str(),
        }),
        // A rerun would post twice.
        replay: 'unsafe',
        execute: async (args) => {
            const { chain, hop } = await currentChain();
            let posted;
            try {
                posted = await hub(`/api/bots/${bot.id}/room`, { to: args.to, text: args.message, chain, hop });
            }
            catch (error) {
                return refusal(error instanceof Error ? error.message : String(error));
            }
            const parts = [`Posted room message ${posted.message.id}${posted.delivered.length ? ` to ${posted.delivered.join(', ')}` : ''}.`];
            if (posted.notRunning.length)
                parts.push(`Not running, so not woken: ${posted.notRunning.join(', ')}; they can read it in the room later.`);
            return text(parts.join(' '));
        },
    });
    const roomRead = durable.defineTool({
        name: 'room_read',
        description: 'Read the newest messages in your family\'s room, including those not addressed to you.',
        parameters: obj({ limit: opt(num({ description: 'How many; default 20' })) }),
        structuredOutputSchema: obj({
            messages: arr(obj({ id: num(), from: str(), to: arr(str()), text: str(), hop: num(), createdAt: str() }), { description: 'Oldest first' }),
        }),
        replay: 'safe',
        execute: async (args) => {
            const limit = Math.max(1, Math.floor(args.limit ?? 20));
            const { messages } = await hub(`/api/bots/${bot.id}/room?limit=${limit}`);
            const value = { messages: messages.map(message => ({ id: message.id, from: message.fromName, to: message.toNames, text: message.text, hop: message.hop, createdAt: message.createdAt })) };
            if (!messages.length)
                return both('The room is empty.', value);
            return both(messages.map(message => `#${message.id} ${message.createdAt} ${message.fromName} → ${message.toNames.join(', ')} (hop ${message.hop}): ${message.text}`).join('\n'), value);
        },
    });
    const when = (ms) => new Date(ms).toLocaleString('sv-SE', { hour12: false }).slice(0, 16);
    const scheduleTool = durable.defineTool({
        name: 'schedule',
        description: 'Your schedules: pi-dish routines that wake you with a message at set times. "create" adds one, which at each time sends you its prompt as a message starting "[routine"; "list" shows yours; "remove" deletes one by name. You can see and remove only your own. A run missed while pi-dish was down arrives once when it is back.',
        parameters: obj({
            action: oneOf(['create', 'list', 'remove']),
            name: opt(str({ description: 'The routine\'s name: lowercase letters, digits and dashes, such as "backup-check"; unique on the hub. For create and remove' })),
            cron: opt(str({ description: 'For create: five cron fields in the hub\'s local time, such as "0 7 * * *" (every day at 07:00) or "*/30 * * * *" (every half hour); @hourly, @daily, @weekly and @monthly also work' })),
            prompt: opt(str({ description: 'For create: what the message asks you to do each time, written to your future self and complete on its own' })),
            description: opt(str({ description: 'For create: one line on what it is for' })),
        }),
        structuredOutputSchema: union([
            obj({
                action: lit('list'),
                routines: arr(obj({
                    name: str(), cron: nullable(str()), enabled: bool(), description: str(), prompt: str(),
                    nextRunAt: nullable(str({ description: 'ISO time' })), lastRun: nullable(obj({ at: str({ description: 'ISO time' }), status: str() })),
                })),
            }),
            obj({ action: lit('create'), name: str(), nextRunAt: nullable(str({ description: 'ISO time of its first run' })) }),
            obj({ action: lit('remove'), name: str() }),
        ]),
        // A rerun could create the routine twice, or report a removed one as missing.
        replay: 'unsafe',
        execute: async (args) => {
            const iso = (ms) => typeof ms === 'number' ? new Date(ms).toISOString() : null;
            try {
                if (args.action === 'list') {
                    const { routines } = await hub(`/api/bots/${bot.id}/routines`);
                    const value = {
                        action: 'list',
                        routines: routines.map(routine => {
                            const last = routine.stats?.lastInvocation;
                            return {
                                name: routine.name, cron: routine.schedule?.cron ?? null, enabled: routine.enabled, description: routine.description ?? '', prompt: routine.prompt,
                                nextRunAt: routine.enabled ? iso(routine.stats?.nextRunAt) : null, lastRun: last ? { at: iso(last.startedAt), status: last.status } : null,
                            };
                        }),
                    };
                    if (!routines.length)
                        return both('You have no schedules.', value);
                    return both(routines.map(routine => {
                        const next = routine.stats?.nextRunAt;
                        const last = routine.stats?.lastInvocation;
                        return [
                            `${routine.name}: ${routine.schedule?.cron ?? 'no schedule'}${routine.enabled ? '' : ' (switched off)'}${next && routine.enabled ? `, next ${when(next)}` : ''}${last ? `, last run ${when(last.startedAt)} ${last.status}` : ''}`,
                            ...(routine.description ? [`  ${routine.description}`] : []),
                            `  Prompt: ${routine.prompt}`,
                        ].join('\n');
                    }).join('\n'), value);
                }
                if (!args.name)
                    return refusal(`${args.action} needs the routine's name.`);
                if (args.action === 'remove') {
                    await hub(`/api/bots/${bot.id}/routines/${encodeURIComponent(args.name)}/remove`, {});
                    return both(`Removed the schedule "${args.name}". Its runs so far stay in its record.`, { action: 'remove', name: args.name });
                }
                if (!args.cron || !args.prompt)
                    return refusal('create needs a name, a cron schedule and a prompt.');
                const { routine } = await hub(`/api/bots/${bot.id}/routines`, {
                    name: args.name, prompt: args.prompt, schedule: { cron: args.cron }, ...(args.description ? { description: args.description } : {}),
                });
                return both(`Created the schedule "${routine.name}" (${args.cron})${routine.nextRunAt ? `; its first run is at ${when(routine.nextRunAt)}` : ''}. Each run arrives here as a message starting [routine "${routine.name}". The user sees it on pi-dish's Routines screen.`, { action: 'create', name: routine.name, nextRunAt: iso(routine.nextRunAt) });
            }
            catch (error) {
                return refusal(error instanceof Error ? error.message : String(error));
            }
        },
    });
    const askBot = durable.defineTool({
        name: 'ask_bot',
        description: 'Put one question to a bot in another family, such as asking Fleet about a host. Returns at once; its answer arrives once, as a message starting "[answer from". Do not poll for it.',
        parameters: obj({ bot: str({ description: 'Name of the bot to ask' }), question: str({ description: 'The whole question; it knows nothing of this conversation' }) }),
        // A rerun finds its own question id, and the bot asked takes each question once.
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const askId = await api.memo('ask', crypto.randomUUID(), callContext);
            const target = await findBot(args.bot);
            if (!target)
                return refusal(`There is no bot named "${args.bot}".`);
            const { chain, hop } = await currentChain();
            try {
                await hub(`/api/bots/${target.id}/ask`, { by: bot.id, question: args.question, askId, chain, hop });
            }
            catch (error) {
                return refusal(error instanceof Error ? error.message : String(error));
            }
            return text(`Asked ${target.name}. Its answer arrives once, as a message starting "[answer from ${target.name}]".`);
        },
    });
    /**
     * Sends back the answer to each question from another family whose run has ended; each goes once. `through` is the
     * newest entry of a view in which the bot was idle: every question up to it has had its run, and one that arrived
     * later waits for the end of its own. The answer is the last model text of that run, before the next input; it is
     * one more hop of the question's chain and is never refused, since the question was taken.
     */
    async function answerAsks(through) {
        const recent = (await conversation().entries({ order: 'descending', maxEntryId: through }, 200, undefined, ctx)).items;
        const asks = recent.filter(entry => entry.kind === 'bot.ask');
        if (!asks.length)
            return;
        const answered = (await harness.snapshot(AsksDoc, conversation().id, ctx))?.answered ?? {};
        for (const ask of asks) {
            const data = (0, helper_values_1.record)(ask.data) ? ask.data : {};
            const askId = typeof data.askId === 'string' ? data.askId : '';
            if (!askId || answered[askId])
                continue;
            const next = recent.filter(entry => entry.id > ask.id && Object.hasOwn(INPUT_KINDS, entry.kind)).at(-1)?.id ?? Infinity;
            const reply = recent.find(entry => entry.id > ask.id && entry.id < next && entry.kind === 'pi.assistant' && messageText(entryMessage(entry)).trim());
            await hub(`/api/bots/${encodeURIComponent(String(data.from))}/answer`, {
                by: bot.id, askId, text: reply ? messageText(entryMessage(reply)).trim() : '(it ended its turn without a reply)',
                question: String(data.question ?? ''), chain: String(data.chain), hop: Number(data.hop) + 1,
            });
            await conversation().commit(async (tx) => {
                (await tx.doc(AsksDoc, conversation().id)).answered[askId] = new Date().toISOString();
            }, ctx);
        }
    }
    const botUpdate = durable.defineTool({
        name: 'bot_update',
        description: 'Change your own entry or a descendant bot\'s: its name, identity, places or thinking level; or, for a descendant only, its model, its parent (move it under you or another of your descendants) or its status ("retired" retires it: it stops and its sub-bots move up to its parent; "active" brings a retired one back). Your own model, parent and status are the user\'s. Every change is recorded, shown to the user with an undo, and a changed identity, places or thinking level takes effect at that bot\'s next context window.',
        // Bot changes stay deliberate: the model's own, each with its undo.
        callers: ['model'],
        parameters: obj({
            bot: opt(str({ description: 'Name or id of a descendant bot; omitted: yourself' })),
            name: opt(str()),
            identity: opt(str({ description: 'The whole new identity; it replaces the old one' })),
            places: opt(arr(obj({
                host: opt(str({ description: 'Fleet host; omitted: this host' })), cwd: str(), label: str({ description: 'What you call the place' }),
            }), { description: 'Where the bot works; replaces the whole list' })),
            thinking: opt(str({ description: 'Thinking level: off, minimal, low, medium, high or xhigh' })),
            model: opt(str({ description: 'provider/model-id; only for a descendant' })),
            parent: opt(str({ description: 'Name or id of its new parent: you or another of your descendants; only for a descendant' })),
            status: opt(oneOf(['retired', 'active'], { description: '"retired" retires a descendant, "active" brings a retired one back' })),
        }),
        // A rerun would write a second revision.
        replay: 'unsafe',
        execute: async (args) => {
            let target = bot.id;
            if (args.bot) {
                const found = await rosterBot(args.bot);
                if (!found)
                    return refusal(`There is no bot named "${args.bot}" among the bots you can see (you, your ancestors and your descendants).`);
                target = found.id;
            }
            const changes = {};
            for (const field of ['name', 'identity', 'places', 'thinking', 'model', 'status'])
                if (args[field] !== undefined)
                    changes[field] = args[field];
            if (args.parent !== undefined) {
                const parent = await rosterBot(args.parent);
                if (!parent)
                    return refusal(`There is no bot named "${args.parent}" among the bots you can see, so it cannot be the new parent.`);
                changes.parentId = parent.id;
            }
            if (!Object.keys(changes).length)
                return refusal('Name at least one field to change.');
            if (target === bot.id && changes.model !== undefined) {
                return refusal('Refused: you cannot change your own model. Tell the user: only they can change it, with "edit" on your row in pi-dish\'s Bots list.');
            }
            let change;
            try {
                change = await hub(`/api/bots/${encodeURIComponent(target)}/edit`, { by: bot.id, turn: (await currentChain()).turn, changes });
            }
            catch (error) {
                return refusal(error instanceof Error ? error.message : String(error));
            }
            const own = target === bot.id;
            const who = own ? 'your' : `${change.before.name}'s`;
            if (!change.fields.length)
                return text(`Nothing changed: ${who} entry already says that.`);
            const later = change.fields.filter(field => field === 'identity' || field === 'places' || field === 'thinking');
            const name = change.bot.name;
            const status = change.fields.includes('status') ? change.bot.status : null;
            const notes = [
                later.length && status !== 'retired' ? `The new ${later.join(', ')} take${later.length === 1 ? 's' : ''} effect at ${own ? 'your' : 'its'} next context window, not in this one.` : '',
                change.fields.includes('model') && change.bot.status === 'active' ? `${name} restarts on the new model.` : '',
                status === 'retired' ? `${name} is retired and stopped.` : status === 'active' ? `${name} is back and starting.` : '',
                change.moved.length
                    ? `${status === 'retired' ? 'Its sub-bots moved up' : 'Its former sub-bots moved back'}: ${change.moved.map(row => `${row.name} (now ${row.parentName ? `under ${row.parentName}` : 'at the top level'})`).join(', ')}.`
                    : '',
                'The user sees the change and can undo it.',
            ].filter(Boolean);
            return {
                ...text(`Changed ${who} entry (revision ${change.revision}):\n${change.lines.join('\n')}\n${notes.join(' ')}`),
                details: { botChange: { botId: change.bot.id, botName: name, revision: change.revision, fields: change.fields, lines: change.lines } },
            };
        },
    });
    const rosterFields = {
        id: str(), name: str(), parentId: nullable(str()), parentName: nullable(str()),
        relation: oneOf(['self', 'ancestor', 'descendant'], { description: 'How it stands to you' }),
        status: str({ description: 'active, paused or retired' }), model: str(), thinking: nullable(str()),
        places: arr(obj({ host: nullable(str()), cwd: str(), label: str() })), revision: num(),
        running: bool({ description: 'Whether its relay runs now' }), lastTurnAt: nullable(str({ description: 'ISO time of its last answer' })),
    };
    const rosterLine = (row) => [
        `${row.name}${row.relation === 'self' ? ' (you)' : ''}`,
        row.status === 'active' ? (row.running ? 'running' : 'not running') : row.status,
        row.model, ...(row.thinking ? [`thinking ${row.thinking}`] : []), `revision ${row.revision}`,
        ...(row.lastTurnAt ? [`last turn ${when(Date.parse(row.lastTurnAt))}`] : []),
        ...(row.places.length ? [`places: ${row.places.map(place => place.label).join(', ')}`] : []),
    ].join(' · ');
    const botsTool = durable.defineTool({
        name: 'bots',
        description: 'The roster of bots you can see: you, your ancestors and your descendants, retired ones included. "list" shows each with its parent, status, model, thinking, places, revision, whether it runs and its last turn; "show" gives one bot\'s whole entry, identity included, and its revisions with what each changed.',
        parameters: obj({
            action: oneOf(['list', 'show']),
            bot: opt(str({ description: 'For show: the bot\'s name or id' })),
        }),
        structuredOutputSchema: union([
            obj({ action: lit('list'), bots: arr(obj(rosterFields), { description: 'In tree order, each after its parent' }) }),
            obj({
                action: lit('show'),
                bot: obj({ ...rosterFields, identity: str(), createdAt: str(), updatedAt: str() }),
                revisions: arr(obj({
                    revision: num(), by: str({ description: '"user", "pi-dish" or the name of the bot that made it' }), turn: nullable(str()),
                    fields: arr(str()), at: str({ description: 'ISO time' }), changes: arr(str({ description: 'One line per changed field' })),
                }), { description: 'Oldest first' }),
            }),
        ]),
        replay: 'safe',
        execute: async (args) => {
            // The hub's answers are parsed JSON, so they are JSON values as they stand.
            const asJson = (value) => value;
            try {
                if (args.action === 'show') {
                    if (!args.bot)
                        return refusal('show needs the bot\'s name or id.');
                    const shown = await hub(`/api/bots/${bot.id}/roster/${encodeURIComponent(args.bot)}`);
                    const entry = shown.bot;
                    const recent = shown.revisions.slice(-20);
                    return both([
                        `${rosterLine(entry)}`,
                        `Id: ${entry.id}. Parent: ${entry.parentName ?? '(top level)'}. Created ${entry.createdAt}.`,
                        ...(entry.places.length ? ['Places:', ...entry.places.map(place => `- ${place.label}: ${place.host ? `${place.host}:` : ''}${place.cwd}`)] : []),
                        '', 'Identity:', entry.identity, '',
                        `Revisions${shown.revisions.length > recent.length ? ` (the last ${recent.length} of ${shown.revisions.length})` : ''}:`,
                        ...recent.map(revision => `${revision.revision}. ${revision.at} by ${revision.by}: ${revision.changes.join('; ')}`),
                    ].join('\n'), asJson({ action: 'show', bot: entry, revisions: shown.revisions }));
                }
                const { bots } = await hub(`/api/bots/${bot.id}/roster`);
                const ids = new Set(bots.map(row => row.id));
                const ordered = [];
                const walk = (parent, depth) => {
                    for (const row of bots) {
                        if ((row.parentId && ids.has(row.parentId) ? row.parentId : null) !== parent)
                            continue;
                        ordered.push({ row, depth });
                        walk(row.id, depth + 1);
                    }
                };
                walk(null, 0);
                return both(ordered.map(({ row, depth }) => `${'  '.repeat(depth)}- ${rosterLine(row)}`).join('\n'), asJson({ action: 'list', bots: ordered.map(({ row }) => row) }));
            }
            catch (error) {
                return refusal(error instanceof Error ? error.message : String(error));
            }
        },
    });
    const reminder = durable.hook(durable.GenerationTask, {
        beforeRequest: (request) => {
            const last = [...request.messages].reverse().find(message => message.role === 'assistant');
            const used = usageTokens(last);
            if (used < exports.REMINDER_RATIO * windowLimit)
                return undefined;
            const percent = Math.round(used / windowLimit * 100);
            // For this request only: the stored transcript, and the cached prefix, are unchanged.
            const note = {
                role: 'user',
                content: `[pi-dish: this context window is ${percent}% full. Save your notebook with context_notes and call new_context at the next natural break; at ${Math.round(exports.FORCED_RATIO * 100)}% the window is closed for you.]`,
                timestamp: Date.now(),
            };
            return { messages: [...request.messages, note] };
        },
    });
    const BotExtension = durable.defineExtension({
        name: 'bot',
        sections: [durable.section('bot-rules', () => PREAMBLE, { tag: false })],
        tools: [spawnWorker, sessionsTool, contextNotes, newContext, history, kbSearch, kbRead, kbWrite, botsTool, botUpdate, botCreate, roomPost, roomRead, askBot, scheduleTool],
        tasks: [WorkerWatch],
        hooks: [reminder],
    });
    const registry = durable.createRegistry();
    registry.install(BotExtension);
    const scriptCap = options.scriptTimeoutMs ?? exports.SCRIPT_TIME_CAP_MS;
    /**
     * Every script ends by its start plus the cap: an options line may ask for less, never more, and a script resumed
     * after a restart keeps the deadline it started with, since `startedAt` is the one its run recorded.
     */
    class CappedSandbox extends CodemodeSandbox {
        start(code, run) {
            const left = Math.max(1, run.startedAt + scriptCap - Date.now());
            return super.start(code, { ...run, timeoutMs: Math.min(run.timeoutMs ?? left, left) });
        }
    }
    const sandbox = new CappedSandbox({ memoryLimitBytes: SCRIPT_MEMORY_BYTES });
    // Scripts reach only the bot's own tools, and start no model calls of their own.
    registry.install(createCodemodeExtension({ sandbox, models: false }));
    fs.mkdirSync(path.dirname(options.storageFile), { recursive: true });
    const harness = await durable.Harness.open(await openNodeSqliteStorage(options.storageFile), {
        models: options.models,
        registry,
        // Nothing is summarised: a bot rolls its window over instead.
        settings: { compaction: { enabled: false } },
        onReport: (report) => log(`durable ${report.kind}: ${report.error instanceof Error ? report.error.message : String(report.error)}`),
    }, ctx);
    // A sub-bot's first start: its parent wrote where it starts from into its directory. A fresh one starts from its own
    // identity like any new bot, with only its purpose; a fork from a copy of its parent's window.
    const seedFile = path.join(path.dirname(options.storageFile), exports.FORK_SEED);
    const seed = fs.existsSync(seedFile) ? JSON.parse(fs.readFileSync(seedFile, 'utf8')) : null;
    const fork = seed && !seed.fresh ? seed : null;
    root = await harness.root(ctx, {
        // A forked sub-bot keeps its parent's instructions and thinking level until its first rollover, so its first
        // request repeats the parent's last one.
        agent: fork
            ? { model: modelRef, thinkingLevel: fork.thinkingLevel, instructions: fork.instructions }
            : {
                model: modelRef,
                ...(bot.thinking ? { thinkingLevel: bot.thinking } : {}),
                instructions: composeInstructions(bot.identity, '', bot.places),
            },
    });
    if (fork) {
        const started = (await root.entries({ order: 'ascending' }, 1, undefined, ctx)).items.length > 0;
        if (!started) {
            await root.commit(async (tx) => {
                for (const entry of fork.entries)
                    await tx.appendEntry(root.id, entry);
                // Questions the parent took are the parent's to answer.
                const asks = await tx.doc(AsksDoc, root.id);
                for (const entry of fork.entries) {
                    const askId = entry.kind === 'bot.ask' && (0, helper_values_1.record)(entry.data) ? entry.data.askId : undefined;
                    if (typeof askId === 'string')
                        asks.answered[askId] = `by ${fork.parentName}`;
                }
            }, ctx);
        }
        // The parent's conversation is not this bot's to show: the transcript starts at a marker after it.
        const copied = (await root.entries({ order: 'ascending' }, fork.entries.length, undefined, ctx)).items.at(-1);
        if (copied && copied.id > mirror.lastEntryId) {
            mirror.appendCustom(copied.id, 'bot-forked', `Started from ${fork.parentName}'s conversation; its purpose follows.`, { parentId: fork.parentId, parentName: fork.parentName });
        }
    }
    // The model is the user's choice in the registry; the instructions stay those of the open window.
    const agent = await root.agent(ctx);
    if (agent.model?.provider !== modelRef.provider || agent.model?.modelId !== modelRef.modelId) {
        await root.configure({ model: modelRef }, ctx);
    }
    harness.resume();
    if (seed) {
        // The request id makes the purpose arrive once, also when a crash comes before the start file is gone.
        await root.submit({
            type: 'input', content: seed.purpose, whenBusy: 'followUp', requestId: 'bot-purpose',
            entry: { kind: 'bot.purpose', data: { from: seed.parentId, fromName: seed.parentName } },
        }, ctx);
        fs.rmSync(seedFile, { force: true });
    }
    // Event mapping --------------------------------------------------------------
    let busy = false;
    let processed = mirror.lastEntryId;
    let streaming = false;
    let lastUsage = 0;
    let lastModel = '';
    let lastFailure = -1;
    const calls = new Map();
    const running = new Map();
    function startTool(callId, name) {
        let slot = running.get(callId);
        if (!slot) {
            slot = { output: '', startedAt: Date.now() };
            running.set(callId, slot);
            emit('tool_execution_start', { toolCallId: callId, toolName: name, args: calls.get(callId)?.args ?? {}, startedAt: slot.startedAt });
        }
        return slot;
    }
    function show(entry) {
        processed = Math.max(processed, entry.id);
        const message = entryMessage(entry);
        if (!message)
            return;
        if (entry.kind === 'pi.user') {
            mirror.appendMessage(entry.id, message);
            emit('message_start', { message });
            emit('message_end', { message });
        }
        else if (Object.hasOwn(CUSTOM_TYPES, entry.kind)) {
            const customType = CUSTOM_TYPES[entry.kind];
            const details = (0, helper_values_1.record)(entry.data) ? entry.data : undefined;
            mirror.appendCustom(entry.id, customType, messageText(message), details);
            emit('message_end', { message: { role: 'custom', customType, content: [{ type: 'text', text: messageText(message) }], display: true, timestamp: Date.now() } });
        }
        else if (entry.kind === 'pi.assistant') {
            const selector = `${String(message.provider ?? '')}/${String(message.model ?? '')}`;
            if (message.provider && message.model && selector !== lastModel) {
                lastModel = selector;
                mirror.appendModelChange(entry.id, String(message.provider), String(message.model));
            }
            if (Array.isArray(message.content)) {
                for (const part of message.content) {
                    if ((0, helper_values_1.record)(part) && part.type === 'toolCall' && typeof part.id === 'string')
                        calls.set(part.id, { name: String(part.name), args: part.arguments });
                }
            }
            lastUsage = usageTokens(message) || lastUsage;
            mirror.appendMessage(entry.id, message);
            if (!streaming)
                emit('message_start', { message });
            streaming = false;
            emit('message_end', { message });
        }
        else if (entry.kind === 'pi.tool-result') {
            const callId = String(message.toolCallId);
            const name = String(message.toolName);
            mirror.appendMessage(entry.id, message);
            const slot = startTool(callId, name);
            running.delete(callId);
            emit('tool_execution_end', {
                toolCallId: callId, toolName: name, args: calls.get(callId)?.args ?? {}, startedAt: slot.startedAt,
                isError: message.isError === true, result: { content: message.content, ...(message.details !== undefined ? { details: message.details } : {}) },
            });
            calls.delete(callId);
            // A change to a bot's entry is shown as itself, with what the user needs to undo it.
            const change = (0, helper_values_1.record)(message.details) && (0, helper_values_1.record)(message.details.botChange) ? message.details.botChange : null;
            if (name === 'bot_update' && change) {
                const summary = `${String(change.botName)}: ${Array.isArray(change.lines) ? change.lines.join('; ') : ''}`;
                mirror.appendCustom(entry.id, 'bot-change', summary, change, 'change');
                emit('message_end', { message: { role: 'custom', customType: 'bot-change', content: [{ type: 'text', text: summary }], details: change, display: true, timestamp: Date.now() } });
            }
        }
    }
    function showLive(live) {
        const partial = live.generation?.message;
        if (partial && Array.isArray(partial.content) && partial.content.length) {
            if (!streaming)
                emit('message_start', { message: partial });
            streaming = true;
            emit('message_update', { message: partial });
        }
        for (const slot of live.tools ?? []) {
            if (slot.status === 'pending')
                continue;
            const tracked = startTool(slot.callId, slot.name);
            if (slot.output && slot.output !== tracked.output) {
                tracked.output = slot.output;
                emit('tool_execution_update', {
                    toolCallId: slot.callId, toolName: slot.name, args: calls.get(slot.callId)?.args ?? {}, startedAt: tracked.startedAt,
                    partialResult: { content: [{ type: 'text', text: slot.output }] },
                });
            }
        }
    }
    async function catchUp(through) {
        let cursor;
        do {
            const page = await conversation().entries({ minEntryId: (processed + 1), maxEntryId: through, order: 'ascending' }, 200, cursor, ctx);
            for (const entry of page.items)
                if (entry.id > processed)
                    show(entry);
            cursor = page.next;
        } while (cursor);
    }
    async function forceRolloverIfFull() {
        if (lastUsage < exports.FORCED_RATIO * windowLimit)
            return;
        const window = await currentWindow(Number.MAX_SAFE_INTEGER);
        const handoff = await conversation().commit(tx => rollover(tx, conversation().id, 'Closed at the context limit.', true, window), ctx);
        await conversation().reset(handoff, ctx);
        lastUsage = 0;
        log('rolled the context window over at the limit');
    }
    async function onView(view) {
        const live = liveOf(view);
        const busyNow = live.run !== undefined;
        if (busyNow && !busy) {
            busy = true;
            emit('agent_start', {});
            emit('turn_start', {});
        }
        if (view.before !== undefined && view.before > processed)
            await catchUp(view.before);
        for (const entry of view.entries)
            if (entry.id > processed)
                show(entry);
        if (busyNow)
            showLive(live);
        else if (busy) {
            busy = false;
            streaming = false;
            running.clear();
            const failure = live.runFailure;
            if (failure && failure.taskId !== lastFailure) {
                lastFailure = failure.taskId;
                const errorMessage = `${failure.reason}${failure.detail ? `: ${failure.detail}` : ''}`;
                mirror.appendRunFailure(processed, failure.taskId, errorMessage, { provider: modelRef.provider, id: modelRef.modelId });
                emit('message_end', { message: { role: 'assistant', content: [], stopReason: 'error', errorMessage, provider: modelRef.provider, model: modelRef.modelId, timestamp: Date.now() } });
            }
            emit('turn_end', {});
            emit('agent_end', {});
            const through = processed;
            try {
                await forceRolloverIfFull();
            }
            catch (error) {
                log(`forced rollover failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            try {
                await answerAsks(through);
            }
            catch (error) {
                log(`answer to another bot failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        options.changed();
    }
    const watch = await root.watch(ctx, { from: (processed + 1), min: 50, max: 1000 });
    watch.start(async (call) => {
        if (call.kind !== 'value')
            return;
        try {
            await onView(call.value);
        }
        catch (error) {
            log(`view mapping failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    return {
        get busy() { return busy; },
        get model() { return bot.model; },
        contextUsage() {
            if (!lastUsage)
                return null;
            return { tokens: lastUsage, contextWindow: windowLimit, percent: Math.round(lastUsage / windowLimit * 1000) / 10 };
        },
        async activity() {
            const { tasks, submissions } = await harness.inspect(ctx);
            const byId = new Map(tasks.map(task => [task.record.id, task.record]));
            // A task a background task owns is part of that background work.
            const background = (task) => !!task && (task.background || (task.owner !== undefined && background(byId.get(task.owner))));
            return {
                running: busy || tasks.some(task => !background(task.record)),
                queued: submissions.some(submission => submission.status === 'queued'),
            };
        },
        async prompt(message, mode) {
            if (!busy)
                await forceRolloverIfFull();
            await conversation().submit({ type: 'input', content: message, whenBusy: mode }, ctx);
        },
        async deliver(input) {
            await conversation().submit({
                type: 'input', content: input.text, whenBusy: 'followUp', requestId: input.requestId,
                entry: { kind: `bot.${input.kind}`, data: input.data },
            }, ctx);
        },
        abort: () => conversation().abort(ctx),
        async close() {
            await watch.stop();
            // The sandbox first: a script it stops is left unfinished, and resumes when the bot opens again.
            await sandbox.close();
            await harness.close(ctx);
        },
    };
}
