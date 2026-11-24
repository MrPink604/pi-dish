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
 *   background-unfinished - after end_turn: a tool and a thought (no thought with
 *               FAKE_AGY_SKIP_THOUGHT), then prose after FAKE_AGY_FINAL_DELAY_MS
 *               (never when unset)
 *   max-turn-requests - a text reply answered with stopReason max_turn_requests
 *   slow      - a prompt stays open until session/cancel
 *   tool      - read_file + run_command completed tool calls
 *   elicit    - ask_question + elicitation/create form
 *   permission - an unexpected session/request_permission
 *   crash     - partial turn + completed tool, then the agent dies; a resumed process replies
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
/** `FAKE_AGY_LIST` drives `session/list`; import tests seed external conversations. */
const CONVERSATIONS = (() => {
    try {
        const parsed = JSON.parse(process.env.FAKE_AGY_LIST || '[]');
        return Array.isArray(parsed)
            ? parsed.filter((row) => !!row && typeof row === 'object' && !Array.isArray(row))
            : [];
    }
    catch {
        return [];
    }
})();
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
let resumed = false;
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
                // Hydrogen offers xhigh; Carbon does not, so the per-model ladder is testable.
                ...(model.includes('hydrogen') ? [{ value: 'xhigh', name: 'XHigh' }] : []),
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
const sideSessions = new Set();
const sideOpenPrompts = new Map();
let mainSessionCreated = false;
const pendingClientRequests = new Map();
let lastPromptId = null;
function handleSidePrompt(id, targetSid, params) {
    const promptArr = Array.isArray(params.prompt) ? params.prompt : [];
    const firstText = promptArr.find((p) => !!p && typeof p === 'object' && p.type === 'text');
    const q = typeof firstText?.text === 'string' ? firstText.text : '';
    const slowSide = /\bslow\b/i.test(q);
    const sendChunk = (chunk) => {
        notify('session/update', { sessionId: targetSid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } });
    };
    sendChunk('Side: ');
    if (slowSide) {
        sideOpenPrompts.set(targetSid, { id, timer: null });
        return;
    }
    const timer = setTimeout(() => {
        sideOpenPrompts.delete(targetSid);
        sendChunk(`answered "${q}"`);
        respond(id, { stopReason: 'end_turn', usage: USAGE });
    }, 25);
    sideOpenPrompts.set(targetSid, { id, timer });
}
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
/** `session/load` replay shaped like docs/agy-acp-capture/load.jsonl. */
function replayHistory() {
    const readme = `${cwd}/README.md`;
    const calc = `${cwd}/calc.py`;
    sessionUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Read README.md and tell me in one sentence what it says.' } });
    sessionUpdate({
        sessionUpdate: 'tool_call', toolCallId: 'call-load-read', name: 'read_file',
        args: { Path: readme }, status: 'completed', kind: 'read', title: 'File README.md',
        locations: [{ path: readme }], rawInput: { Path: readme },
    });
    sessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'I am thinking about the loaded history.' } });
    sessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'README.md contains a single heading.' } });
    sessionUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Fix add() in calc.py.' } });
    sessionUpdate({
        sessionUpdate: 'tool_call', toolCallId: 'call-load-edit', name: 'edit_file',
        args: { Path: calc, Target: 'return a - b', Replacement: 'return a + b' },
        status: 'completed', kind: 'edit', title: 'File calc.py', locations: [{ path: calc }],
        rawInput: { Path: calc, Target: 'return a - b', Replacement: 'return a + b' },
        content: [{
                type: 'diff', path: calc,
                oldText: 'def add(a, b):\n    return a - b\n',
                newText: 'def add(a, b):\n    return a + b\n',
            }],
    });
    sessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Fixed add().' } });
    usageUpdate(2400);
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
        case 'background-unfinished': {
            // Observed live (framework b43204e7): agy answers end_turn while a command
            // runs, then reads, thinks and goes quiet while it writes its next step.
            const finalDelay = Number(process.env.FAKE_AGY_FINAL_DELAY_MS);
            setTimeout(() => {
                toolCall('call-bg-u', 'run_command', { CommandLine: 'npm test', WaitMsBeforeAsync: 5000 }, 'npm test', 'execute');
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
                setTimeout(() => {
                    toolUpdate('call-bg-u', 'run_command', 'completed', {
                        title: 'npm test',
                        kind: 'execute',
                        content: [{ type: 'content', content: { type: 'text', text: 'all passed\n' } }],
                        rawOutput: { output: 'all passed\n', exit_code: 0 },
                    });
                    toolCall('call-read-u', 'read_file', { Path: `${cwd}/README.md` }, 'File README.md', 'read');
                    toolUpdate('call-read-u', 'read_file', 'completed', {
                        title: 'File README.md',
                        kind: 'read',
                        content: [{ type: 'content', content: { type: 'text', text: '# scratch\n' } }],
                    });
                    if (!process.env.FAKE_AGY_SKIP_THOUGHT) {
                        sessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking the result.' } });
                    }
                    if (!(finalDelay > 0))
                        return;
                    setTimeout(() => {
                        textChunk('Final report.');
                        usageUpdate(900);
                    }, finalDelay);
                }, 40);
            }, 5);
            return;
        }
        case 'background-chain': {
            // Observed live: first background command yields end_turn; when it finishes,
            // agy launches a second long background command that outlives the autonomous
            // idle window and emits interim status text while waiting for it.
            setTimeout(() => {
                toolCall('call-bg-1', 'run_command', { CommandLine: 'npm run check', WaitMsBeforeAsync: 5000 }, 'npm run check', 'execute');
                textChunk('Running check in the background.');
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
                setTimeout(() => {
                    toolUpdate('call-bg-1', 'run_command', 'completed', {
                        title: 'npm run check',
                        kind: 'execute',
                        content: [{ type: 'content', content: { type: 'text', text: 'check ok\n' } }],
                        rawOutput: { output: 'check ok\n', exit_code: 0 },
                    });
                    toolCall('call-bg-2', 'run_command', { CommandLine: 'npm test', WaitMsBeforeAsync: 5000 }, 'npm test', 'execute');
                    textChunk('Waiting on full test suite.');
                    usageUpdate(800);
                    setTimeout(() => {
                        toolUpdate('call-bg-2', 'run_command', 'completed', {
                            title: 'npm test',
                            kind: 'execute',
                            content: [{ type: 'content', content: { type: 'text', text: 'suite ok\n' } }],
                            rawOutput: { output: 'suite ok\n', exit_code: 0 },
                        });
                        textChunk('All tests passed.');
                        usageUpdate(900);
                    }, 260);
                }, 50);
            }, 5);
            return;
        }
        case 'background-daemon': {
            // A daemon command (IsDaemon: true) is meant to keep running after the turn ends.
            setTimeout(() => {
                toolCall('call-daemon-1', 'run_command', { CommandLine: 'npm run dev', WaitMsBeforeAsync: 500, IsDaemon: true }, 'npm run dev', 'execute');
                textChunk('Dev server started.');
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
            }, 5);
            return;
        }
        case 'background-schedule': {
            // Observed live: `schedule` stays `in_progress` over ACP until the timer fires
            // (or forever for a cron), even though the agent yielded with `end_turn`.
            setTimeout(() => {
                toolCall('call-sched-1', 'schedule', { DurationSeconds: 180, Prompt: 'Check status later', TimerCondition: 'any' }, 'Run schedule', 'other');
                textChunk('Timer scheduled for 3m.');
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
            }, 5);
            return;
        }
        case 'background-cancelled': {
            // A background command terminated with `cancelled` status (e.g. kill/cancel).
            setTimeout(() => {
                toolCall('call-bg-cancel', 'run_command', { CommandLine: 'sleep 60', WaitMsBeforeAsync: 5000 }, 'sleep 60', 'execute');
                textChunk('Waiting on background sleep.');
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
                setTimeout(() => {
                    toolUpdate('call-bg-cancel', 'run_command', 'cancelled', {
                        title: 'sleep 60',
                        kind: 'execute',
                        content: [{ type: 'content', content: { type: 'text', text: 'Tool execution was canceled\n' } }],
                    });
                }, 40);
            }, 5);
            return;
        }
        case 'background-abort': {
            // Background command stays running after end_turn until the client aborts.
            setTimeout(() => {
                toolCall('call-bg-hang', 'run_command', { CommandLine: 'npm test', WaitMsBeforeAsync: 5000 }, 'npm test', 'execute');
                textChunk('Running long background task.');
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
            }, 5);
            return;
        }
        case 'background-rerun': {
            // Each prompt launches a fresh background run_command (or run_workflow) that stays
            // open past end_turn so brain reconciliation can be exercised across re-runs.
            const promptArr = Array.isArray(params.prompt) ? params.prompt : [];
            const firstText = promptArr.find((p) => !!p && typeof p === 'object' && p.type === 'text');
            const promptText = typeof firstText?.text === 'string' ? firstText.text : '';
            setTimeout(() => {
                if (promptText.includes('workflow')) {
                    toolCall(`call-wf-${id}`, 'run_workflow', { Description: 'Audit modules' }, 'Audit modules', 'other');
                    textChunk('Running workflow.');
                }
                else {
                    toolCall(`call-bg-run-${id}`, 'run_command', { CommandLine: 'npm test', WaitMsBeforeAsync: 5000 }, 'npm test', 'execute');
                    textChunk('Running background test.');
                }
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
            }, 5);
            return;
        }
        case 'autonomous-permission': {
            // After end_turn and background tool completion, the agent emits closing prose
            // and requests permission with no open tools; after approval it pauses before replying.
            setTimeout(() => {
                toolCall('call-bg-auto-perm', 'run_command', { CommandLine: 'npm run build', WaitMsBeforeAsync: 5000 }, 'npm run build', 'execute');
                textChunk('Building in background.');
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
                setTimeout(() => {
                    toolUpdate('call-bg-auto-perm', 'run_command', 'completed', {
                        title: 'npm run build',
                        kind: 'execute',
                        content: [{ type: 'content', content: { type: 'text', text: 'built\n' } }],
                        rawOutput: { output: 'built\n', exit_code: 0 },
                    });
                    textChunk('Need permission to continue.');
                    const permReqId = 600 + id;
                    pendingClientRequests.set(String(permReqId), { kind: 'autonomous-permission' });
                    write({
                        jsonrpc: '2.0',
                        id: permReqId,
                        method: 'session/request_permission',
                        params: {
                            sessionId,
                            toolCall: { title: 'Deploy build' },
                            options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }],
                        },
                    });
                }, 30);
            }, 5);
            return;
        }
        case 'foreign-live': {
            const foreignSid = '44444444-4444-4444-8444-444444444444';
            const collected = {};
            const maybeFinish = () => {
                if (!('perm' in collected && 'elicit' in collected && 'unknown' in collected))
                    return;
                notify('session/update', {
                    sessionId: '',
                    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'empty-sid-ok ' } },
                });
                textChunk(`foreign-responses:${JSON.stringify(collected)}`);
                usageUpdate(200);
                finishPrompt(id, 'end_turn');
            };
            setTimeout(() => {
                notify('session/update', {
                    sessionId: foreignSid,
                    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'FOREIGN LEAK CHUNK' } },
                });
                notify('session/update', {
                    sessionId: foreignSid,
                    update: { sessionUpdate: 'session_info_update', title: 'Foreign Title' },
                });
                pendingClientRequests.set('foreign-perm-1', { kind: 'foreign-probe', slot: 'perm', collected, maybeFinish });
                write({
                    jsonrpc: '2.0',
                    id: 'foreign-perm-1',
                    method: 'session/request_permission',
                    params: {
                        sessionId: foreignSid,
                        toolCall: { title: 'Foreign command' },
                        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
                    },
                });
                pendingClientRequests.set('foreign-elicit-1', { kind: 'foreign-probe', slot: 'elicit', collected, maybeFinish });
                write({
                    jsonrpc: '2.0',
                    id: 'foreign-elicit-1',
                    method: 'elicitation/create',
                    params: {
                        sessionId: foreignSid,
                        toolCallId: 'foreign-ask-1',
                        mode: 'form',
                        message: 'Foreign question',
                        requestedSchema: {
                            type: 'object',
                            properties: { q1: { type: 'string', title: 'Foreign?', oneOf: [{ const: '1', title: 'yes' }] } },
                        },
                    },
                });
                pendingClientRequests.set('foreign-unknown-1', { kind: 'foreign-probe', slot: 'unknown', collected, maybeFinish });
                write({
                    jsonrpc: '2.0',
                    id: 'foreign-unknown-1',
                    method: 'custom/ping',
                    params: { sessionId: foreignSid },
                });
            }, 5);
            return;
        }
        case 'background-reconnect': {
            // Background command stays running long enough for a bridge reconnect test.
            setTimeout(() => {
                toolCall('call-bg-reconn', 'run_command', { CommandLine: 'npm test', WaitMsBeforeAsync: 5000 }, 'npm test', 'execute');
                textChunk('Running background suite.');
                usageUpdate(700);
                finishPrompt(id, 'end_turn');
                setTimeout(() => {
                    toolUpdate('call-bg-reconn', 'run_command', 'completed', {
                        title: 'npm test',
                        kind: 'execute',
                        content: [{ type: 'content', content: { type: 'text', text: 'suite ok\n' } }],
                        rawOutput: { output: 'suite ok\n', exit_code: 0 },
                    });
                    textChunk('Background suite finished.');
                    usageUpdate(850);
                }, 700);
            }, 5);
            return;
        }
        case 'slow':
            textChunk('Working on it.');
            return;
        case 'crash': {
            if (resumed) {
                setTimeout(() => {
                    textChunk('Fake Antigravity reply.');
                    usageUpdate(130);
                    finishPrompt(id, 'end_turn');
                }, 40);
                return;
            }
            setTimeout(() => {
                textChunk('Partial before crash. ');
                toolCall('call-crash-1', 'read_file', { Path: `${cwd}/README.md` }, 'File README.md', 'read');
                toolUpdate('call-crash-1', 'read_file', 'completed', { title: 'File README.md', kind: 'read' });
                setTimeout(() => process.exit(1), 30);
            }, 10);
            return;
        }
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
        case 'max-turn-requests': {
            setTimeout(() => {
                textChunk('Stopping at the request limit.');
                finishPrompt(id, 'max_turn_requests');
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
        case 'tasks-and-plan': {
            setTimeout(() => {
                sessionUpdate({
                    sessionUpdate: 'plan',
                    entries: [
                        { content: 'Verify auth fix', status: 'in_progress', priority: 'high' },
                        { content: 'Run smoke tests', status: 'pending', priority: 'medium' },
                    ],
                });
                toolCall('call-swarm-1', 'swarm', { action: 'add', name: 'reader' }, 'swarm add', 'other');
                toolUpdate('call-swarm-1', 'swarm', 'completed', { title: 'swarm add', kind: 'other' });
                toolCall('call-bg-log', 'run_command', { CommandLine: 'npm run watch', WaitMsBeforeAsync: 500 }, 'npm run watch', 'execute');
                setTimeout(() => {
                    toolUpdate('call-bg-log', 'run_command', 'completed', {
                        title: 'npm run watch',
                        kind: 'execute',
                        content: [{ type: 'content', content: { type: 'text', text: 'watch complete\n' } }],
                        rawOutput: { output: 'watch complete\n', exit_code: 0 },
                    });
                    sessionUpdate({ sessionUpdate: 'plan', entries: [] });
                    textChunk('All tasks finished.');
                    usageUpdate(950);
                    finishPrompt(id, 'end_turn');
                }, 1700);
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
function clientResult(id, result, error) {
    const request = pendingClientRequests.get(String(id));
    pendingClientRequests.delete(String(id));
    if (!request || typeof request !== 'object')
        return;
    const state = request;
    if (state.kind === 'foreign-probe') {
        const collected = state.collected;
        collected[String(state.slot)] = error !== undefined ? { error } : { result };
        if (typeof state.maybeFinish === 'function')
            state.maybeFinish();
        return;
    }
    if (state.kind === 'autonomous-permission') {
        const option = typeof result.outcome === 'object' && result.outcome
            ? String(result.outcome.optionId ?? '')
            : '';
        const replyDelay = Number(process.env.FAKE_AGY_FINAL_DELAY_MS) || 180;
        setTimeout(() => {
            textChunk(`Approved:${option || 'cancelled'}.`);
            usageUpdate(900);
        }, replyDelay);
        return;
    }
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
            const freshId = crypto.randomUUID();
            if (!mainSessionCreated) {
                mainSessionCreated = true;
                sessionId = freshId;
                respond(id, sessionState(sessionId));
                announceCommands();
                usageUpdate(0);
            }
            else {
                sideSessions.add(freshId);
                if (SCRIPT === 'side-trailing-close') {
                    notify('session/update', { sessionId: freshId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'EARLY SIDE CHUNK' } } });
                }
                else if (SCRIPT === 'side-speculative-open') {
                    notify('session/update', {
                        sessionId: '33333333-3333-4333-8333-333333333333',
                        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'SPECULATIVE FOREIGN CHUNK' } },
                    });
                }
                respond(id, sessionState(freshId));
            }
            return;
        }
        case 'session/list': {
            respond(id, { sessions: CONVERSATIONS });
            return;
        }
        case 'session/load': {
            mainSessionCreated = true;
            if (typeof params.sessionId === 'string' && params.sessionId)
                sessionId = params.sessionId;
            if (typeof params.cwd === 'string' && params.cwd)
                cwd = params.cwd;
            const row = CONVERSATIONS.find(entry => entry.sessionId === sessionId);
            replayHistory();
            respond(id, sessionState(sessionId, row && typeof row.title === 'string' ? row.title : 'Loaded Fake Session'));
            return;
        }
        case 'session/resume': {
            mainSessionCreated = true;
            resumed = true;
            if (typeof params.sessionId === 'string' && params.sessionId)
                sessionId = params.sessionId;
            respond(id, sessionState(sessionId, 'Resumed Fake Session'));
            announceCommands();
            titles('Resumed Fake Session');
            return;
        }
        case 'session/set_config_option': {
            const targetSid = typeof params.sessionId === 'string' ? params.sessionId : sessionId;
            const configId = String(params.configId ?? '');
            const value = String(params.value ?? '');
            if (!sideSessions.has(targetSid)) {
                if (configId === 'model')
                    model = value;
                else if (configId === 'thought_level')
                    thinking = value;
                else if (configId === 'mode')
                    mode = value;
            }
            // Like agy 1.5.10: the refreshed options (Hydrogen adds xhigh) arrive only in
            // the result, never as a config_option_update notification.
            respond(id, { configOptions: configOptions() });
            return;
        }
        case 'session/set_mode': {
            mode = String(params.modeId ?? mode);
            respond(id, {});
            return;
        }
        case 'session/close': {
            const targetSid = typeof params.sessionId === 'string' ? params.sessionId : '';
            if (targetSid && sideSessions.has(targetSid)) {
                const openSide = sideOpenPrompts.get(targetSid);
                if (openSide?.timer)
                    clearTimeout(openSide.timer);
                sideOpenPrompts.delete(targetSid);
                sideSessions.delete(targetSid);
                if (SCRIPT === 'side-trailing-close') {
                    notify('session/update', { sessionId: targetSid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'TRAILING SIDE CHUNK' } } });
                    write({
                        jsonrpc: '2.0',
                        id: 'side-perm-close-1',
                        method: 'session/request_permission',
                        params: {
                            sessionId: targetSid,
                            toolCall: { title: 'Side-session trailing command' },
                            options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
                        },
                    });
                    respond(id, {});
                    setTimeout(() => {
                        notify('session/update', { sessionId: targetSid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'POST-CLOSE SIDE CHUNK' } } });
                    }, 15);
                    return;
                }
                respond(id, {});
                return;
            }
            respond(id, {});
            setTimeout(() => process.exit(0), 10);
            return;
        }
        case 'session/cancel': {
            const targetSid = typeof params.sessionId === 'string' ? params.sessionId : '';
            if (targetSid && sideSessions.has(targetSid)) {
                const openSide = sideOpenPrompts.get(targetSid);
                if (openSide) {
                    if (openSide.timer)
                        clearTimeout(openSide.timer);
                    sideOpenPrompts.delete(targetSid);
                    respond(openSide.id, { stopReason: 'cancelled' });
                }
                return;
            }
            const newest = openPrompts.length ? openPrompts[openPrompts.length - 1] : null;
            if (newest !== null)
                finishPrompt(newest, 'cancelled');
            return;
        }
        case 'session/prompt': {
            const targetSid = typeof params.sessionId === 'string' ? params.sessionId : sessionId;
            if (sideSessions.has(targetSid)) {
                handleSidePrompt(Number(id), targetSid, params);
                return;
            }
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
                clientResult(message.id, { action: 'cancel' }, message.error);
            else
                clientResult(message.id, message.result);
        }
    }
});
process.stdin.on('end', () => process.exit(0));
