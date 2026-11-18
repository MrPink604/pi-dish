// Generated test/tool from test/fixtures/fake-agy-acp.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * A scripted `agy acp` stand-in: JSON-RPC/ACP v1 over stdio, replayed from the
 * signed-in captures in `docs/agy-acp-capture/`. Test-only; never contacts a
 * real Antigravity install, provider or token file.
 *
 * Run it as `node test/fixtures/fake-agy-acp.js` (build:tests compiles it).
 * `FAKE_AGY_SCRIPT` selects the scenario:
 *   default   - initialize, session/new/resume, text turn with usage, close
 *   fail-closed - agentInfo.name is not Google's server
 *   no-resume - loadSession true but no sessionCapabilities.resume
 *   auth      - session/new fails with -32000 "Authentication required"
 *   steer     - the first prompt hands over to the second (no usage)
 *   steer-usage - like steer, but the handed-over prompt reports its own usage
 *   background - the turn ends while a command runs; agy resumes on its own
 *   slow      - a prompt stays open until session/cancel
 *   tool      - read_file + run_command completed tool calls
 *   elicit    - ask_question + elicitation/create form
 *   permission - an unexpected session/request_permission
 *   version   - agentInfo.version outside the verified set
 */
const node_string_decoder_1 = require("node:string_decoder");
const crypto = require("node:crypto");
const VERSION = '1.5.10';
const UNVERIFIED_VERSION = '1.5.11';
let sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SCRIPT = process.env.FAKE_AGY_SCRIPT || 'default';
const cliArgs = process.argv.slice(2);
if (cliArgs[0] === '-p' && cliArgs[1] === '/usage' && cliArgs.includes('--output-format') && cliArgs.includes('json')) {
    if (SCRIPT === 'auth') {
        process.stderr.write('Authentication required. Please visit the URL to log in:\n'
            + '  https://accounts.google.com/o/oauth2/auth\n\n'
            + 'Waiting for authentication (timeout 60s)...\n');
        setTimeout(() => process.exit(1), 10000).unref();
    }
    else {
        process.stdout.write(JSON.stringify({
            conversation_id: '',
            status: 'SUCCESS',
            response: 'Gemini Models\tWeekly Limit Remaining\t99%\t2026-11-24T23:38:49Z\n',
            duration_seconds: 0,
            num_turns: 0,
            usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
            command: {
                name: 'usage',
                data: {
                    groups: [{
                            name: 'Gemini Models',
                            buckets: [{
                                    id: 'gemini-weekly',
                                    name: 'Weekly Limit Remaining',
                                    window: 'weekly',
                                    remaining_fraction: 0.91,
                                    reset_time: '2026-11-24T23:38:49Z',
                                }, {
                                    id: 'gemini-5h',
                                    name: 'Five Hour Limit Remaining',
                                    window: '5h',
                                    remaining_fraction: 0.75,
                                    reset_time: '2026-11-18T04:38:49Z',
                                }],
                        }, {
                            name: 'Claude and GPT models',
                            buckets: [{
                                    id: '3p-weekly',
                                    name: 'Weekly Limit Remaining',
                                    window: 'weekly',
                                    remaining_fraction: 1,
                                    reset_time: '2026-11-25T01:38:04Z',
                                }],
                        }],
                },
            },
        }) + '\n');
        process.exit(0);
    }
}
const USAGE = {
    inputTokens: 120,
    outputTokens: 8,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    thoughtTokens: 2,
    totalTokens: 130,
};
function write(frame) {
    process.stdout.write(JSON.stringify(frame) + '\n');
}
function respond(id, result) {
    write({ jsonrpc: '2.0', id, result });
}
function respondError(id, code, message) {
    write({ jsonrpc: '2.0', id, error: { code, message } });
}
function notify(method, params) {
    write({ jsonrpc: '2.0', method, params });
}
let cwd = process.cwd();
let model = 'gemini-4-carbon';
let thinking = 'medium';
let mode = 'default';
function configOptions() {
    return [{
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: model,
            options: [
                { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
                { value: 'gemini-4-argon', name: 'Gemini 4 Argon' },
                { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
                { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
                { value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
                { value: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
                { value: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
            ],
        }, {
            id: 'thought_level',
            name: 'Thinking Level',
            category: 'thought_level',
            type: 'select',
            currentValue: thinking,
            options: [
                { value: 'low', name: 'Low' },
                { value: 'medium', name: 'Medium' },
                { value: 'high', name: 'High' },
            ],
        }, {
            id: 'mode',
            name: 'Mode',
            category: 'mode',
            type: 'select',
            currentValue: mode,
            options: [
                { value: 'default', name: 'Default' },
                { value: 'accept-edits', name: 'Accept edits' },
                { value: 'auto', name: 'Auto' },
                { value: 'plan', name: 'Plan' },
            ],
        }];
}
function sessionState(sessionId, title) {
    return {
        sessionId,
        models: {
            currentModelId: `${model}-medium`,
            availableModels: [
                { modelId: 'gemini-4-carbon-medium', name: 'Gemini 4 Carbon (Medium)' },
                { modelId: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)' },
            ],
        },
        modes: {
            currentModeId: mode,
            availableModes: [
                { id: 'default', name: 'Default' },
                { id: 'accept-edits', name: 'Accept edits' },
                { id: 'auto', name: 'Auto' },
                { id: 'plan', name: 'Plan' },
            ],
        },
        configOptions: configOptions(),
        _meta: { antigravity: { tier: { name: 'Google AI Ultra', id: 'g1-ultra-tier', upgradeUri: '' } } },
        ...(title ? { title } : {}),
    };
}
function sessionUpdate(update) {
    notify('session/update', { sessionId, update });
}
function textChunk(chunk) {
    sessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } });
}
function usageUpdate(used) {
    sessionUpdate({ sessionUpdate: 'usage_update', used, size: 1048576 });
}
function announceCommands() {
    sessionUpdate({
        sessionUpdate: 'available_commands_update',
        availableCommands: [
            { name: 'compact', description: 'Compact the conversation now' },
            { name: 'goal', description: 'Run until the goal is finished' },
        ],
    });
}
function titles(title) {
    sessionUpdate({ sessionUpdate: 'session_info_update', title });
}
// Prompt bookkeeping shared by the scenarios.
const openPrompts = [];
const pendingClientRequests = new Map();
let lastPromptId = null;
function finishPrompt(id, stopReason, withUsage = true) {
    const index = openPrompts.indexOf(id);
    if (index >= 0)
        openPrompts.splice(index, 1);
    respond(id, { stopReason, ...(withUsage ? { usage: USAGE } : {}) });
}
function toolCall(id, name, args, title, kind) {
    sessionUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: id,
        name,
        args,
        status: 'in_progress',
        kind,
        title,
        rawInput: args,
    });
}
function toolUpdate(id, name, status, extra = {}) {
    sessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: id, name, status, ...extra });
}
function requestElicitation(id, toolCallId) {
    pendingClientRequests.set(String(id), { kind: 'elicitation', toolCallId, promptId: lastPromptId });
    write({
        jsonrpc: '2.0',
        id,
        method: 'elicitation/create',
        params: {
            sessionId,
            toolCallId,
            mode: 'form',
            message: 'The agent has a question.',
            requestedSchema: {
                type: 'object',
                properties: {
                    q1: {
                        type: 'string',
                        title: 'Save the result (42) to result.txt?',
                        oneOf: [{ const: '1', title: 'yes' }, { const: '2', title: 'no' }],
                    },
                    q1_other: {
                        type: 'string',
                        title: 'Other',
                        description: 'Optional free-form answer to: Save the result (42) to result.txt?',
                    },
                },
            },
        },
    });
}
function handlePrompt(id, params) {
    if (typeof params.cwd === 'string')
        cwd = params.cwd;
    lastPromptId = id;
    openPrompts.push(id);
    switch (SCRIPT) {
        case 'steer':
        case 'steer-usage': {
            if (openPrompts.length === 1)
                return;
            const previous = openPrompts[0];
            // The earlier prompt answers at the handover; agy 1.5.10 has been seen
            // both with and without that prompt's own usage.
            if (previous !== id)
                finishPrompt(previous, 'end_turn', SCRIPT === 'steer-usage');
            setTimeout(() => {
                textChunk('Steered turn answer.');
                usageUpdate(1200);
                finishPrompt(id, 'end_turn');
            }, 30);
            return;
        }
        case 'background': {
            // Observed live: a run_command goes async, the prompt is answered, and
            // agy wakes up on its own when the command finishes, with no prompt open.
            setTimeout(() => {
                toolCall('call-bg-1', 'run_command', { CommandLine: 'npm test', WaitMsBeforeAsync: 5000 }, 'npm test', 'execute');
                textChunk('Tests are running in the background.');
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
                setTimeout(() => {
                    toolUpdate('call-bg-1', 'run_command', 'completed', {
                        title: 'npm test',
                        kind: 'execute',
                        content: [{ type: 'content', content: { type: 'text', text: 'all passed\n' } }],
                        rawOutput: { output: 'all passed\n', exit_code: 0 },
                    });
                    sessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Tests passed.' } });
                    textChunk('Background tests passed.');
                    usageUpdate(800);
                }, 60);
            }, 5);
            return;
        }
        case 'slow':
            textChunk('Working on it.');
            return;
        case 'delayed':
            // Two chunks far apart, so a test can drop and re-open the bridge socket
            // mid-turn; the relay must keep streaming and finish the mirror.
            setTimeout(() => { textChunk('First part. '); usageUpdate(1200); }, 10);
            setTimeout(() => {
                textChunk('Second part.');
                usageUpdate(1400);
                finishPrompt(id, 'end_turn');
            }, 700);
            return;
        case 'prompt-error': {
            setTimeout(() => {
                const index = openPrompts.indexOf(id);
                if (index >= 0)
                    openPrompts.splice(index, 1);
                respondError(id, -32000, 'Quota exhausted');
            }, 5);
            return;
        }
        case 'refusal': {
            setTimeout(() => {
                finishPrompt(id, 'refusal');
            }, 5);
            return;
        }
        case 'timing': {
            const file = `${cwd}/README.md`;
            // Step 1: 110ms TTFT -> usage_update -> two sibling tool calls in one batch.
            setTimeout(() => {
                usageUpdate(400);
                toolCall('call-r1', 'read_file', { Path: file }, 'File README.md', 'read');
                toolUpdate('call-r1', 'read_file', 'completed', { title: 'File README.md', kind: 'read' });
                setTimeout(() => {
                    toolCall('call-r2', 'run_command', { CommandLine: 'sleep 0.14', WaitMsBeforeAsync: 5000 }, 'sleep 0.14', 'execute');
                    // 140ms of synchronous tool execution (must NOT count toward LLM genMs).
                    setTimeout(() => {
                        toolUpdate('call-r2', 'run_command', 'completed', {
                            title: 'sleep 0.14',
                            kind: 'execute',
                            content: [{ type: 'content', content: { type: 'text', text: 'done\n' } }],
                            rawOutput: { output: 'done\n', exit_code: 0 },
                        });
                        // Step 2: 110ms TTFT -> quick 10ms stream -> turn end.
                        setTimeout(() => {
                            textChunk('Measured ');
                            setTimeout(() => {
                                textChunk('reply.');
                                usageUpdate(520);
                                finishPrompt(id, 'end_turn');
                            }, 10);
                        }, 110);
                    }, 140);
                }, 5);
            }, 110);
            return;
        }
        case 'tool-only': {
            const file = `${cwd}/big.py`;
            const lines = Array.from({ length: 400 }, (_, i) => `line_${i} = ${i}`);
            const oldText = lines.join('\n') + '\n';
            const updated = [...lines];
            updated[200] = 'line_200 = "edited"';
            const newText = updated.join('\n') + '\n';
            setTimeout(() => {
                toolCall('call-edit-1', 'edit_file', {
                    Path: file, Target: 'line_200 = 200', Replacement: 'line_200 = "edited"',
                }, 'File big.py', 'edit');
                toolUpdate('call-edit-1', 'edit_file', 'completed', {
                    title: 'File big.py',
                    kind: 'edit',
                    content: [{ type: 'diff', path: file, oldText, newText }],
                });
                usageUpdate(1500);
                finishPrompt(id, 'end_turn');
            }, 5);
            return;
        }
        case 'tool': {
            const file = `${cwd}/README.md`;
            setTimeout(() => {
                toolCall('call-read-1', 'read_file', { Path: file }, 'File README.md', 'read');
                toolUpdate('call-read-1', 'read_file', 'completed', { title: 'File README.md', kind: 'read' });
                toolCall('call-run-1', 'run_command', { CommandLine: 'echo hi', WaitMsBeforeAsync: 5000 }, 'echo hi', 'execute');
                toolUpdate('call-run-1', 'run_command', 'completed', {
                    title: 'echo hi',
                    kind: 'execute',
                    content: [{ type: 'content', content: { type: 'text', text: 'hi\n' } }],
                    rawOutput: { output: 'hi\n', exit_code: 0 },
                });
                textChunk('Done.');
                usageUpdate(900);
                finishPrompt(id, 'end_turn');
            }, 10);
            return;
        }
        case 'elicit': {
            setTimeout(() => {
                const toolCallId = `call-ask-${id}`;
                toolCall(toolCallId, 'ask_question', {
                    questions: [{ is_multi_select: false, options: ['(Recommended) yes', 'no'], question: 'Save the result (42) to result.txt?' }],
                }, 'Run ask_question', 'other');
                toolUpdate(toolCallId, 'ask_question', 'pending', { kind: 'other' });
                requestElicitation(1000 + id, toolCallId);
            }, 5);
            return;
        }
        case 'permission': {
            setTimeout(() => {
                toolCall('call-run-perm', 'run_command', { CommandLine: 'touch made.txt' }, 'touch made.txt', 'execute');
                write({
                    jsonrpc: '2.0',
                    id: 500 + id,
                    method: 'session/request_permission',
                    params: {
                        sessionId,
                        toolCall: {
                            sessionUpdate: 'tool_call', toolCallId: 'call-run-perm', name: 'run_command',
                            args: { CommandLine: 'touch made.txt' }, status: 'pending', kind: 'execute', title: 'touch made.txt',
                        },
                        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }],
                    },
                });
                pendingClientRequests.set(String(500 + id), { kind: 'permission', toolCallId: 'call-run-perm', promptId: id });
            }, 5);
            return;
        }
        default:
            setTimeout(() => {
                textChunk('Fake Antigravity reply.');
                usageUpdate(130);
                finishPrompt(id, 'end_turn');
            }, 40);
    }
}
function clientResult(id, result) {
    const request = pendingClientRequests.get(String(id));
    pendingClientRequests.delete(String(id));
    if (!request || typeof request !== 'object')
        return;
    const state = request;
    if (state.kind === 'elicitation') {
        const toolCallId = String(state.toolCallId ?? 'call-ask');
        toolUpdate(toolCallId, 'ask_question', 'completed', { kind: 'other' });
        textChunk(`answer:${JSON.stringify(result)}`);
        if (typeof state.promptId === 'number')
            finishPrompt(state.promptId, 'end_turn');
        return;
    }
    if (state.kind === 'permission') {
        const option = typeof result.outcome === 'object' && result.outcome
            ? String(result.outcome.optionId ?? '')
            : '';
        const toolCallId = String(state.toolCallId ?? 'call-run-perm');
        if (option === 'allow') {
            toolUpdate(toolCallId, 'run_command', 'completed', {
                title: 'touch made.txt',
                kind: 'execute',
                content: [{ type: 'content', content: { type: 'text', text: 'ok' } }],
                rawOutput: { output: 'ok\n', exit_code: 0 },
            });
        }
        else {
            toolUpdate(toolCallId, 'run_command', 'failed', {
                title: 'touch made.txt',
                kind: 'execute',
                content: [{ type: 'content', content: { type: 'text', text: '' } }],
                rawOutput: { output: '' },
            });
        }
        textChunk(`permission:${option || 'cancelled'}`);
        finishPrompt(Number(state.promptId), 'end_turn');
    }
}
function handleRequest(id, method, params) {
    switch (method) {
        case 'initialize': {
            const capabilities = SCRIPT === 'no-resume'
                ? { loadSession: true, sessionCapabilities: { close: {}, load: {}, list: {} } }
                : {
                    loadSession: true,
                    promptCapabilities: { image: true, audio: false, embeddedContext: true },
                    sessionCapabilities: { resume: {}, close: {}, load: {}, list: {}, additionalDirectories: {} },
                };
            respond(id, {
                protocolVersion: 1,
                agentInfo: {
                    name: SCRIPT === 'fail-closed' ? 'Someone Else ACP' : 'Antigravity ACP Server',
                    version: SCRIPT === 'version' ? UNVERIFIED_VERSION : VERSION,
                },
                agentCapabilities: capabilities,
                authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
            });
            return;
        }
        case 'session/new': {
            if (SCRIPT === 'auth') {
                respondError(id, -32000, 'Authentication required');
                return;
            }
            if (typeof params.cwd === 'string')
                cwd = params.cwd;
            sessionId = crypto.randomUUID();
            respond(id, sessionState(sessionId));
            announceCommands();
            usageUpdate(0);
            return;
        }
        case 'session/resume': {
            if (typeof params.sessionId === 'string' && params.sessionId)
                sessionId = params.sessionId;
            respond(id, sessionState(sessionId, 'Resumed Fake Session'));
            announceCommands();
            titles('Resumed Fake Session');
            return;
        }
        case 'session/set_config_option': {
            const configId = String(params.configId ?? '');
            const value = String(params.value ?? '');
            if (configId === 'model')
                model = value;
            else if (configId === 'thought_level')
                thinking = value;
            else if (configId === 'mode')
                mode = value;
            respond(id, { configOptions: configOptions() });
            return;
        }
        case 'session/set_mode': {
            mode = String(params.modeId ?? mode);
            respond(id, {});
            return;
        }
        case 'session/close': {
            respond(id, {});
            setTimeout(() => process.exit(0), 10);
            return;
        }
        case 'session/cancel': {
            const newest = openPrompts.length ? openPrompts[openPrompts.length - 1] : null;
            if (newest !== null)
                finishPrompt(newest, 'cancelled');
            return;
        }
        case 'session/prompt': {
            handlePrompt(Number(id), params);
            return;
        }
        default:
            respondError(id, -32601, `Unsupported method: ${method}`);
    }
}
const decoder = new node_string_decoder_1.StringDecoder('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    let index = buffer.indexOf('\n');
    while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
        if (!line)
            continue;
        let frame;
        try {
            frame = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!frame || typeof frame !== 'object' || Array.isArray(frame))
            continue;
        const message = frame;
        if (typeof message.method === 'string' && message.id !== undefined && message.id !== null) {
            handleRequest(message.id, message.method, message.params && typeof message.params === 'object' ? message.params : {});
            continue;
        }
        // Notifications from the client: only cancel matters to this scripted agent.
        if (typeof message.method === 'string') {
            if (message.method === 'session/cancel') {
                handleRequest(null, 'session/cancel', message.params && typeof message.params === 'object' ? message.params : {});
            }
            continue;
        }
        if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
            if (message.error !== undefined)
                clientResult(message.id, { action: 'cancel' });
            else
                clientResult(message.id, message.result);
        }
    }
});
process.stdin.on('end', () => process.exit(0));
