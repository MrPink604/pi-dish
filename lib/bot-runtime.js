// Generated from src/core/bot-runtime.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORCED_RATIO = exports.REMINDER_RATIO = exports.WINDOW_TOKEN_CAP = exports.NOTEBOOK_MAX_BYTES = void 0;
exports.messageText = messageText;
exports.settledWorker = settledWorker;
exports.newContextRefusal = newContextRefusal;
exports.composeInstructions = composeInstructions;
exports.composeHandoff = composeHandoff;
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
/** Why `new_context` is refused, or null when it may run. */
function newContextRefusal(memory, workSinceRollover) {
    if (!memory.notebook.trim()) {
        return 'Refused: your notebook is empty. Write what you need to keep with context_notes first; the new window starts from the notebook, not from this conversation.';
    }
    if (memory.notebookSavedIn !== memory.windows.length) {
        return 'Refused: you have not saved your notebook in this window. Save it with context_notes (write the whole notebook, even if little changed), then call new_context again.';
    }
    if (!workSinceRollover) {
        return 'Refused: nothing has happened since the last new window. Carry on with the work; roll over again once this window has filled.';
    }
    return null;
}
/** The instructions of a window: fixed when it opens, never rewritten inside it. */
function composeInstructions(identity, notebook) {
    return [
        '<identity>', identity.trim(), '</identity>',
        '',
        '<notebook>', notebook.trim() || '(empty: nothing written down yet)', '</notebook>',
    ].join('\n');
}
/** The first message of a new window: what the bot needs that its notebook does not hold. */
function composeHandoff({ windowNumber, closed, tail, request, workers }) {
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
    lines.push('', workers.length ? 'Workers still running (their reports will arrive as messages):' : 'No workers are running.');
    for (const worker of workers)
        lines.push(`- ${worker.name}: ${worker.ref} (${worker.harness}${worker.host ? ` on ${worker.host}` : ''}, started ${worker.startedAt})`);
    return lines.join('\n');
}
const PREAMBLE = [
    'You are a pi-dish bot: a long-lived agent that is the standing contact for one area of work. You talk with the',
    'user, start pi-dish sessions (workers) to do the work, and keep what you learn. You have no shell and do not edit',
    'files; anything that needs doing on a machine goes to a worker.',
    '',
    'Workers: spawn_worker starts a session with a complete brief and returns its ref at once. Its final answer is',
    'delivered to you once, as a message starting "[worker report]"; do not poll for it. Tell the user the ref when you',
    'start one and the outcome when it reports. A spawn whose outcome is unknown is never retried for you: look for the',
    'session with the sessions tool before starting another. The sessions tool lists, reads, searches and messages',
    'sessions and reports the fleet\'s hosts and their load.',
    '',
    'Memory: your notebook (context_notes, at most 16 KiB) is the only thing that carries over to a new context window,',
    'with the end of the conversation and your running workers. Write durable facts there, not chat. When the window is',
    'filling up, or a topic is done, save the notebook and call new_context with a one-line summary of the window.',
    'history reads and searches your earlier windows. Your instructions are fixed for a window; notebook edits show in',
    'them from the next window on.',
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
    const schema = await import('@earendil-works/pi-schema');
    const { obj, opt, str, num, oneOf } = schema;
    const { bot, mirror, sessions, emit, log } = options;
    const ctx = BACKGROUND_CONTEXT;
    const pollMs = options.pollMs ?? { first: WATCH_FIRST_POLL_MS, max: WATCH_MAX_POLL_MS };
    const slash = bot.model.indexOf('/');
    const modelRef = { provider: bot.model.slice(0, slash), modelId: bot.model.slice(slash + 1) };
    const modelInfo = options.models.getModel(modelRef.provider, modelRef.modelId);
    const windowLimit = Math.min(modelInfo?.contextWindow || exports.WINDOW_TOKEN_CAP, exports.WINDOW_TOKEN_CAP);
    const MemoryDoc = durable.defineDoc({
        kind: 'bot.memory',
        version: 1,
        scope: 'conversation',
        history: 'latest',
        fork: 'current',
        initial: () => ({ notebook: '', notebookSavedIn: -1, windows: [], workers: {} }),
        checkpointWhen: () => true,
    });
    const ReportEntry = 'bot.report';
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
        if (entry.kind === 'pi.user' || entry.kind === ReportEntry)
            return true;
        const message = entryMessage(entry);
        return entry.kind === 'pi.tool-result' && !!message && !Object.hasOwn(MEMORY_TOOLS, String(message.toolName));
    }
    /** Closes the current window and fixes the next one's instructions; returns its handoff. */
    async function rollover(tx, conversationId, line, forced, window) {
        const memory = await tx.doc(MemoryDoc, conversationId);
        memory.windows.push({ line: line.trim().slice(0, 300) || '(no summary)', closedAt: new Date().toISOString(), forced });
        const current = options.loadBot();
        await durable.configure(tx, conversationId, { instructions: composeInstructions(current.identity, memory.notebook) });
        const tail = window
            .filter(entry => entry.kind === 'pi.user' || entry.kind === ReportEntry || entry.kind === 'pi.assistant')
            .map(entry => ({ role: entry.kind === 'pi.assistant' ? 'assistant' : entry.kind === ReportEntry ? 'report' : 'user', text: messageText(entryMessage(entry)).trim() }))
            .filter(message => message.text)
            .slice(0, TAIL_MESSAGES)
            .reverse()
            .map(message => ({ ...message, text: message.text.length > TAIL_MESSAGE_CHARS ? `${message.text.slice(0, TAIL_MESSAGE_CHARS)}…` : message.text }));
        const request = window.find(entry => entry.kind === 'pi.user' || entry.kind === ReportEntry);
        return composeHandoff({
            windowNumber: memory.windows.length + 1,
            closed: memory.windows,
            tail,
            request: request ? messageText(entryMessage(request)) : null,
            workers: Object.values(memory.workers).filter(worker => !worker.reportedAt),
        });
    }
    const WorkerWatch = durable.defineTask({
        name: 'bot.worker-watch',
        version: 1,
        initial: () => ({ phase: 'poll', delayMs: pollMs.first }),
        phases: {
            poll: async (task, runtime, taskContext) => {
                const { ref, name, since, startedAt } = task.input;
                const { delayMs } = task.state.checkpoint;
                let settled = null;
                try {
                    const resolved = JSON.parse(await sessions(['resolve', ref, '--json', '--fields', 'all']));
                    const window = JSON.parse(await sessions(['show', ref, '--limit', '1', '--json']));
                    settled = settledWorker((0, helper_values_1.record)(resolved) ? resolved.session : null, window, since);
                }
                catch (error) {
                    // The hub may be restarting; a failed poll is retried, never reported.
                    log(`watch ${name} (${ref}): ${error instanceof Error ? error.message : String(error)}`);
                }
                if (!settled && runtime.now() - startedAt > WATCH_GIVE_UP_MS) {
                    settled = { state: 'inactive', totalMessages: 0, text: 'Still working after 24 hours; no longer watched.' };
                }
                if (!settled) {
                    const next = { phase: 'poll', delayMs: Math.min(Math.round(delayMs * 1.5), pollMs.max) };
                    return runtime.sleepUntil(runtime.now() + delayMs, next, taskContext);
                }
                const heading = settled.state === 'finished' ? 'finished'
                    : settled.state === 'waiting' ? 'is waiting for an answer' : 'stopped without a final answer';
                const body = settled.text.length > REPORT_CHARS ? `${settled.text.slice(0, REPORT_CHARS)}\n[cut at ${REPORT_CHARS} characters; read the rest with sessions read ${ref}]` : settled.text;
                const report = `[worker report] "${name}" (${ref}) ${heading}.\n\n${body || '(no text)'}`;
                await runtime.commit(() => ({ status: 'running', checkpoint: { phase: 'report', report, state: settled.state } }), taskContext);
            },
            report: async (task, runtime, taskContext) => {
                const { dispatchId, ref, name } = task.input;
                const { report, state } = task.state.checkpoint;
                const handle = (await runtime.conversation(runtime.conversationId, taskContext));
                // The request id makes this post happen once, also when a crash reruns the phase.
                await handle.submit({
                    type: 'input', content: report, whenBusy: 'followUp', requestId: `worker-report:${dispatchId}`,
                    entry: { kind: ReportEntry, data: { dispatchId, ref, name, state } },
                }, taskContext);
                await runtime.commit(async (tx) => {
                    const memory = await tx.doc(MemoryDoc, runtime.conversationId);
                    const worker = memory.workers[dispatchId];
                    if (worker)
                        worker.reportedAt = new Date().toISOString();
                    return { status: 'terminal', outcome: { status: 'completed', result: null } };
                }, taskContext);
            },
        },
        abort: (_task, runtime, taskContext) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), taskContext),
    });
    const text = (value) => ({ output: [{ type: 'text', text: value }] });
    const refusal = (value) => ({ ...text(value), isError: true });
    const spawnWorker = durable.defineTool({
        name: 'spawn_worker',
        description: 'Start a pi-dish session that carries out one task on its own. Returns its ref at once; its final answer arrives later as a "[worker report]" message. Give it a complete brief: it knows nothing of this conversation.',
        parameters: obj({
            name: str({ description: 'Short name for the worker session' }),
            brief: str({ description: 'The complete task: goal, context, constraints, and what to report back' }),
            host: opt(str({ description: 'Fleet host to run on; omitted: this host' })),
            cwd: opt(str({ description: 'Working directory; omitted: the home directory' })),
            harness: opt(str({ description: 'pi (default), omp or agy' })),
            model: opt(str({ description: 'provider/model-id; omitted: the harness default' })),
            thinking: opt(str({ description: 'Thinking level for the worker' })),
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
                    ref: `${args.host ? `${args.host}/` : ''}${result.sessionId}`, harness: String(result.harness ?? args.harness ?? 'pi'),
                }, callContext);
            }
            const { ref, harness } = spawned;
            await api.commit(async (tx) => {
                const memory = await tx.doc(MemoryDoc, api.conversationId);
                if (memory.workers[dispatchId])
                    return;
                memory.workers[dispatchId] = { name: args.name, ref, harness, host: args.host ?? null, startedAt: new Date().toISOString() };
                // A fresh spawn's transcript is empty, so any answer is its own.
                await tx.createTask(WorkerWatch, { dispatchId, ref, name: args.name, since: 0, startedAt: api.now() }, { ownership: { kind: 'conversation' }, background: true });
            }, callContext);
            return text(`Started worker "${args.name}" (${harness}${args.host ? ` on ${args.host}` : ''}). Ref: ${ref}. Its report will arrive as a message.`);
        },
    });
    const sessionsTool = durable.defineTool({
        name: 'sessions',
        description: 'pi-dish sessions and hosts: list live sessions, read a transcript, search every transcript, send a message to a session, list the fleet\'s hosts, or show how busy each host is.',
        parameters: obj({
            action: oneOf(['list', 'read', 'search', 'send', 'hosts', 'load']),
            ref: opt(str({ description: 'Session ref, for read and send' })),
            query: opt(str({ description: 'Search terms, for search' })),
            message: opt(str({ description: 'Text to send, for send' })),
            host: opt(str({ description: 'Limit list or search to one host' })),
            limit: opt(num({ description: 'Rows or messages to show' })),
        }),
        replay: 'unsafe',
        execute: async (args) => {
            const host = args.host ? ['--host', args.host] : [];
            const limit = args.limit ? ['--limit', String(Math.max(1, Math.floor(args.limit)))] : [];
            const need = (value, field) => {
                if (!value)
                    throw new Error(`${args.action} needs ${field}`);
                return value;
            };
            const argv = args.action === 'list' ? ['list', '--active', ...host, ...limit]
                : args.action === 'read' ? ['read', need(args.ref, 'ref'), ...limit]
                    : args.action === 'search' ? ['search', need(args.query, 'query'), ...(args.host ? host : ['--all-hosts']), ...limit]
                        : args.action === 'send' ? ['send', need(args.ref, 'ref'), need(args.message, 'message')]
                            : [args.action];
            return text((await sessions(argv)).trim() || '(no output)');
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
        replay: 'safe',
        execute: async (args, api, callContext) => {
            const windows = await allWindows();
            const memory = await api.snapshot(MemoryDoc, api.conversationId, callContext);
            const lines = (entries) => entries.flatMap(entry => {
                const message = entryMessage(entry);
                const body = messageText(message).trim();
                if (!body || entry.kind === 'pi.system')
                    return [];
                const role = entry.kind === ReportEntry ? 'report' : entry.kind === 'pi.reset' ? 'handoff' : String(message?.role ?? entry.kind);
                return [`[${role}] ${body}`];
            });
            if (args.action === 'windows') {
                return text(windows.map((entries, index) => {
                    const closed = memory?.windows[index];
                    return `${index + 1}. ${closed ? closed.line : '(current window)'} — ${lines(entries).length} messages`;
                }).join('\n'));
            }
            if (args.action === 'read') {
                const number = Math.floor(args.window ?? windows.length);
                const entries = windows[number - 1];
                if (!entries)
                    return refusal(`There is no window ${number}; there are ${windows.length}.`);
                const all = lines(entries);
                const offset = Math.max(0, Math.floor(args.offset ?? 0));
                const page = all.slice(offset, offset + 40);
                const more = offset + page.length < all.length ? `\n[${all.length - offset - page.length} more; read again with offset ${offset + page.length}]` : '';
                return text(`Window ${number}, messages ${offset + 1}–${offset + page.length} of ${all.length}:\n\n${page.join('\n\n')}${more}`);
            }
            const query = (args.query ?? '').trim().toLowerCase();
            if (!query)
                return refusal('search needs a query');
            const hits = [];
            windows.forEach((entries, index) => {
                for (const line of lines(entries)) {
                    const at = line.toLowerCase().indexOf(query);
                    if (at < 0 || hits.length >= 20)
                        continue;
                    hits.push(`window ${index + 1}: …${line.slice(Math.max(0, at - 120), at + query.length + 200).replace(/\s+/g, ' ')}…`);
                }
            });
            return text(hits.length ? hits.join('\n') : `No match for "${args.query}".`);
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
        tools: [spawnWorker, sessionsTool, contextNotes, newContext, history],
        tasks: [WorkerWatch],
        hooks: [reminder],
    });
    const registry = durable.createRegistry();
    registry.install(BotExtension);
    fs.mkdirSync(path.dirname(options.storageFile), { recursive: true });
    const harness = await durable.Harness.open(await openNodeSqliteStorage(options.storageFile), {
        models: options.models,
        registry,
        // Nothing is summarised: a bot rolls its window over instead.
        settings: { compaction: { enabled: false } },
        onReport: (report) => log(`durable ${report.kind}: ${report.error instanceof Error ? report.error.message : String(report.error)}`),
    }, ctx);
    root = await harness.root(ctx, {
        agent: {
            model: modelRef,
            ...(bot.thinking ? { thinkingLevel: bot.thinking } : {}),
            instructions: composeInstructions(bot.identity, ''),
        },
    });
    // The model is the user's choice in the registry; the instructions stay those of the open window.
    const agent = await root.agent(ctx);
    if (agent.model?.provider !== modelRef.provider || agent.model?.modelId !== modelRef.modelId) {
        await root.configure({ model: modelRef }, ctx);
    }
    harness.resume();
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
        else if (entry.kind === ReportEntry || entry.kind === 'pi.reset') {
            const customType = entry.kind === ReportEntry ? 'bot-worker-report' : 'bot-context-window';
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
                isError: message.isError === true, result: { content: message.content },
            });
            calls.delete(callId);
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
            try {
                await forceRolloverIfFull();
            }
            catch (error) {
                log(`forced rollover failed: ${error instanceof Error ? error.message : String(error)}`);
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
        async prompt(message, mode) {
            if (!busy)
                await forceRolloverIfFull();
            await conversation().submit({ type: 'input', content: message, whenBusy: mode }, ctx);
        },
        abort: () => conversation().abort(ctx),
        async close() {
            await watch.stop();
            await harness.close(ctx);
        },
    };
}
