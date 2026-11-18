// Generated from src/core/session-slash-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSlashCommandHandler = createSlashCommandHandler;
const http_boundary_1 = require("./http-boundary");
const bridge_session_1 = require("./bridge-session");
const prime_daemon_1 = require("./prime-daemon");
const helper_models_js_1 = require("./helper-models.js");
const harnesses_1 = require("./harnesses");
const session_ownership_1 = require("./session-ownership");
const helper_values_1 = require("./helper-values");
const wire_protocol_1 = require("./wire-protocol");
const tmux = require("./tmux");
const session_mutation_handlers_1 = require("./session-mutation-handlers");
/** Slash-command names from a `get_commands` payload. */
function commandNames(data) {
    const payload = (0, helper_values_1.record)(data) ? data : {};
    return Array.isArray(payload.commands)
        ? payload.commands.flatMap(row => (0, helper_values_1.record)(row) && typeof row.name === 'string' ? [row.name] : [])
        : [];
}
function availableModels(data) {
    const payload = (0, helper_values_1.record)(data) ? data : {};
    return Array.isArray(payload.models)
        ? payload.models.flatMap(row => (0, helper_values_1.record)(row) && typeof row.id === 'string'
            ? [{ id: row.id, provider: typeof row.provider === 'string' ? row.provider : '' }] : [])
        : [];
}
function splitCommand(message) {
    const space = message.indexOf(' ');
    return {
        name: (space === -1 ? message.slice(1) : message.slice(1, space)).trim(),
        args: space === -1 ? '' : message.slice(space + 1).trim(),
    };
}
function createSlashCommandHandler(ports) {
    /** /reload against a bridge session, with tmux and socket-teardown fallbacks. */
    async function reloadBridgeSession(sess, sessionId) {
        let bridgeError = null;
        if ((0, session_ownership_1.liveSessionSupports)(sess, 'reload')) {
            try {
                const data = await sess.runCommand('/reload');
                return { info: (0, wire_protocol_1.asRecord)(data).info || 'Reloading extensions…' };
            }
            catch (error) {
                // Bridges that fire the reload in the same tick lose the response frame
                // to their own teardown; that rejection means the reload started.
                if (/socket closed/i.test((0, http_boundary_1.errorMessage)(error)))
                    return { info: 'Reloading extensions…' };
                bridgeError = error;
            }
        }
        bridgeError ||= new Error('This session does not support remote extension reload.');
        const pane = sess.harnessId === 'pi' || sess.harnessId === 'omp' ? await ports.locatePiPane(sessionId) : null;
        if (!pane) {
            Object.assign(Object(bridgeError), { statusCode: 409 }, sess.harnessId === 'omp' ? { message: 'Oh My Pi extension reload requires a reachable tmux pane.' } : {});
            throw bridgeError;
        }
        await tmux.sendKeys(pane.socket, pane.paneId, sess.harnessId === 'omp' ? '/dish-reload' : '/reload');
        return { info: 'Sent /reload to the session’s tmux pane' };
    }
    function parseHostBuiltin(descriptor, message) {
        if (!descriptor?.hostBuiltins?.length)
            return null;
        const trimmed = message.trim();
        const separator = trimmed.search(/\s/);
        const name = trimmed.slice(1, separator === -1 ? undefined : separator);
        const command = descriptor.hostBuiltins.find(candidate => candidate.name === name);
        if (!command)
            return null;
        if (/[\x00-\x1f\x7f]/.test(trimmed))
            throw (0, http_boundary_1.httpError)(`Invalid arguments for /${name}.`, 400);
        const args = separator === -1 ? '' : trimmed.slice(separator).trim();
        if (!args && command.requireArgs) {
            throw (0, http_boundary_1.httpError)(`/${name} requires arguments${command.args ? `; expected ${command.args}` : ''}.`, 400);
        }
        // Blocked sub-forms open TUI overlays a remote pilot cannot answer. A bare
        // string blocks that sub-command and everything under it; `exact` blocks
        // only the argument-less form.
        const blockedEntry = command.blockedArgs?.find((entry) => {
            const value = typeof entry === 'string' ? entry : entry.arg;
            return args === value || (!(typeof entry !== 'string' && entry.exact) && args.startsWith(`${value} `));
        });
        if (blockedEntry) {
            const blocked = typeof blockedEntry === 'string' ? blockedEntry : blockedEntry.arg;
            throw (0, http_boundary_1.httpError)(`/${name} ${blocked} is only available in the ${descriptor.label} terminal UI.`, 400);
        }
        if (args && !command.freeArgs && !command.allowedArgs?.includes(args)) {
            const allowed = command.allowedArgs?.join(' or ');
            throw (0, http_boundary_1.httpError)(`Invalid arguments for /${name}${allowed ? `; expected ${allowed}` : ''}.`, 400);
        }
        return { command, text: `/${name}${args ? ` ${args}` : ''}`, hasArgs: !!args };
    }
    // Host builtins execute by typing into the session's TUI pane; the capability
    // is a reachable pane, not only a pi-dish-owned one.
    async function runHostBuiltin(sessionId, descriptor, parsed) {
        const pane = descriptor.hostBuiltins?.length ? await ports.locatePiPane(sessionId) : null;
        if (!pane) {
            throw (0, http_boundary_1.httpError)(`Host command /${parsed.command.name} requires a reachable ${descriptor.label} tmux pane.`, 409);
        }
        await tmux.sendKeys(pane.socket, pane.paneId, parsed.text);
        if (parsed.hasArgs) {
            // OMP's subcommand autocomplete consumes the first Enter after an exact
            // argument; a second Enter submits the accepted command.
            await new Promise(resolve => setTimeout(resolve, 50));
            await tmux.sendKeys(pane.socket, pane.paneId, '');
        }
        return { info: `Sent ${parsed.text} to the session’s tmux pane` };
    }
    async function runRpcSlashCommand(rpc, message) {
        const { name, args } = splitCommand(message);
        switch (name) {
            case 'compact': {
                // pi's compact() aborts the agent and rewrites its message list; a
                // second compact would race that rewrite.
                if (rpc.compacting)
                    throw new Error('Compaction already in progress — wait for it to finish.');
                rpc.compacting = true;
                try {
                    const result = await rpc.compact(args || undefined);
                    rpc._refreshStats();
                    const saved = result ? ` (${(0, wire_protocol_1.asRecord)(result).tokensBefore} → ~${(0, wire_protocol_1.asRecord)(result).estimatedTokensAfter} tokens)` : '';
                    return { info: `Compacted${saved}` };
                }
                finally {
                    rpc.compacting = false;
                }
            }
            case 'abort':
                await rpc.abort();
                return { info: 'Aborted' };
            case 'name':
                if (!args)
                    throw new Error('usage: /name <name>');
                await rpc.setName(args);
                return { info: 'Session renamed' };
            case 'thinking':
                if (!args)
                    throw new Error('usage: /thinking <off|minimal|low|medium|high|xhigh>');
                await rpc.setThinkingLevel(args);
                return { info: `Thinking level: ${args}` };
            case 'model': {
                if (!args)
                    throw new Error('usage: /model <provider/model-id>');
                let { provider, id } = (0, helper_models_js_1.parseModelId)(args);
                if (!provider) {
                    const models = availableModels(await rpc.getAvailableModels());
                    const match = models.find(model => model.id === args)
                        || models.find(model => model.id.includes(args));
                    if (!match)
                        throw new Error(`model not found: ${args}`);
                    provider = match.provider;
                    id = match.id;
                }
                await rpc.setModel(provider, id);
                return { info: `Model set to ${provider}/${id}` };
            }
            case 'new':
                await rpc.newSession();
                return { info: 'New session started' };
            case 'reload':
                // RPC `prompt` executes extension commands with a full command context,
                // the only remote path to ctx.reload().
                await rpc.prompt('/dish-reload');
                return { info: 'Reloading extensions...' };
            case 'export': {
                const data = await rpc.exportHtml(args || undefined);
                return { info: `Exported to ${(0, wire_protocol_1.asRecord)(data).path || 'HTML'}` };
            }
            default: {
                // Extension commands, skills, and prompt templates execute via RPC
                // prompt; verify the command exists so typos are not sent as text.
                const known = commandNames(await rpc.getCommands().catch(() => null));
                if (!known.includes(name))
                    throw new Error(`unknown or unsupported command: /${name}`);
                await rpc.prompt(message);
                return {};
            }
        }
    }
    /**
     * Slash commands against a Prime daemon root: its daemon session commands are
     * the API, and unknown names are verified against `get_commands` before a
     * prompt carries them.
     */
    async function runPrimeSlashCommand(prime, message) {
        const { name, args } = splitCommand(message);
        if (!(0, session_ownership_1.liveSessionSupports)(prime, 'commands'))
            throw new Error('This session does not support remote commands.');
        switch (name) {
            case 'compact': {
                if (!(0, session_ownership_1.liveSessionSupports)(prime, 'compact'))
                    throw new Error('This session does not support compaction.');
                if (prime.compacting)
                    throw new Error('Compaction already in progress — wait for it to finish.');
                prime.compacting = true;
                try {
                    return { info: (0, wire_protocol_1.asRecord)(await prime.compact(args || undefined)).info };
                }
                finally {
                    prime.compacting = false;
                }
            }
            case 'abort':
                await prime.abort();
                return { info: 'Aborted' };
            case 'name':
                if (!args)
                    throw new Error('usage: /name <name>');
                await prime.setName(args);
                return { info: 'Session renamed' };
            case 'thinking':
                if (!args)
                    throw new Error(`usage: /thinking <${(0, helper_models_js_1.thinkingLevelNamesFor)('prime').join('|')}>`);
                await prime.setThinkingLevel(args);
                return { info: `Thinking level: ${args}` };
            case 'model': {
                if (!args)
                    throw new Error('usage: /model <provider/model-id>');
                let { provider, id } = (0, helper_models_js_1.parseModelId)(args);
                if (!provider) {
                    // The daemon owns Prime's model catalog; resolve short ids there.
                    const models = availableModels(await prime.getAvailableModels());
                    const match = models.find(model => model.id === args)
                        || models.find(model => model.id.includes(args));
                    if (!match)
                        throw new Error(`model not found: ${args}`);
                    provider = match.provider;
                    id = match.id;
                }
                await prime.setModel(provider, id);
                return { info: `Model set to ${provider}/${id}` };
            }
            case 'reload':
                await prime.send('reload');
                return { info: 'Reloading…' };
            case 'export': {
                const data = await prime.exportHtml(args || undefined);
                return { info: `Exported to ${(0, wire_protocol_1.asRecord)(data).path || 'HTML'}` };
            }
            case 'new':
                throw (0, http_boundary_1.httpError)('Prime Agent cannot start a new session from pi-dish.', 400);
            default: {
                // Prime's own commands/skills execute from a prompt; verify the name so
                // a typo is not sent to the model as literal text.
                const known = commandNames(await prime.getCommands().catch(() => null));
                if (!known.includes(name))
                    throw new Error(`unknown or unsupported command: /${name}`);
                await prime.prompt(message);
                return {};
            }
        }
    }
    const command = async (req, res) => {
        const { message, deliverAs } = (0, http_boundary_1.requestBody)(req);
        if (typeof message !== 'string' || !message.startsWith('/')) {
            return res.status(400).json({ error: 'message must start with /' });
        }
        try {
            const sess = await ports.getLiveSession(req.params.id);
            if (!sess)
                return res.status(404).json({ error: 'Session not active' });
            if (sess instanceof bridge_session_1.BridgeSession) {
                const descriptor = (0, harnesses_1.getHarness)(sess.harnessId);
                const hostBuiltin = parseHostBuiltin(descriptor, message);
                if (hostBuiltin && descriptor) {
                    const result = await runHostBuiltin(req.params.id, descriptor, hostBuiltin);
                    return res.json({ success: true, info: result.info });
                }
                const compactMatch = message.match(/^\/compact(?:\s+(.*))?\s*$/);
                if (compactMatch) {
                    if (!(0, session_ownership_1.liveSessionSupports)(sess, 'compact')) {
                        return res.status(409).json({ error: 'This session does not support compaction.' });
                    }
                    if (sess.compacting)
                        throw new Error('Compaction already in progress — wait for it to finish.');
                    // Raise the guard before the bridge event arrives so two concurrent
                    // requests cannot both pass it; compaction_end owns the normal reset.
                    sess.compacting = true;
                    try {
                        const data = await sess.compact(compactMatch[1]?.trim() || undefined);
                        return res.json({ success: true, info: (0, wire_protocol_1.asRecord)(data).info });
                    }
                    catch (error) {
                        sess.compacting = false;
                        throw error;
                    }
                }
                // /btw starts a NEW side chat and returns immediately; the answer
                // streams over side_chat events, never the transcript.
                const btwMatch = message.match(/^\/btw(?:\s+([\s\S]*))?\s*$/);
                if (btwMatch) {
                    if (!(0, session_mutation_handlers_1.sideChatSupported)(sess, res))
                        return;
                    const question = btwMatch[1]?.trim();
                    if (!question)
                        return res.status(400).json({ error: 'usage: /btw <question>' });
                    const data = await sess.sideChatAsk(question);
                    return res.json({ success: true, info: 'Asked in side chat', sideChat: (0, wire_protocol_1.asRecord)(data).sideChat ?? null });
                }
                if (/^\/login(\s|$)/.test(message) && !(0, session_ownership_1.liveSessionSupports)(sess, 'login')) {
                    return res.status(409).json({ error: `This ${descriptor?.label ?? 'harness'} session does not support signing in from pi-dish.` });
                }
                if (!(0, session_ownership_1.liveSessionSupports)(sess, 'commands')) {
                    return res.status(409).json({ error: 'This session does not support remote commands.' });
                }
                if (message.trim() === '/reload') {
                    const result = await reloadBridgeSession(sess, req.params.id);
                    return res.json({ success: true, info: result.info });
                }
                const data = await sess.runCommand(message, deliverAs);
                return res.json({ success: true, info: (0, wire_protocol_1.asRecord)(data).info });
            }
            if (sess instanceof prime_daemon_1.PrimeDaemonSession) {
                if (/^\/btw(\s|$)/.test(message)) {
                    return res.status(409).json({ error: 'This session does not support side chats.' });
                }
                if (/^\/login(\s|$)/.test(message)) {
                    return res.status(409).json({ error: 'This Prime Agent session does not support signing in from pi-dish.' });
                }
                const result = await runPrimeSlashCommand(sess, message);
                return res.json({ success: true, info: result.info });
            }
            const result = await runRpcSlashCommand(sess, message);
            res.json({ success: true, info: result.info });
        }
        catch (error) {
            res.status((0, http_boundary_1.errorStatus)(error, 400)).json({ error: (0, http_boundary_1.errorMessage)(error) });
        }
    };
    return { command };
}
