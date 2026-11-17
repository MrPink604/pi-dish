// Generated test/tool from test/acp-session.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * ACP transport tests against the scripted fake agent: no `agy` install, no
 * provider traffic. Covers the handshake gates, prompt/steer/cancel contract,
 * tool normalisation, elicitation dialogs, the Pi mirror and the raw sidecar.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const promises_1 = require("node:timers/promises");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-session-'));
process.env.HOME = tmp;
const workDir = path.join(tmp, 'work');
fs.mkdirSync(workDir, { recursive: true });
fs.writeFileSync(path.join(workDir, 'README.md'), '# scratch\n');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-agy-acp.js');
const acp = require('../lib/acp-session.js');
const { asRecord } = require('../lib/wire-protocol.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
function launch(script, extra = {}) {
    return acp.createAcpSession({
        cwd: workDir,
        command: process.execPath,
        args: [FIXTURE],
        env: { ...process.env, FAKE_AGY_SCRIPT: script },
        ...extra,
    });
}
function cleanup(t, session) {
    t.after(async () => {
        if (session)
            await session.close().catch(() => { });
        await acp.shutdownAcpSessions();
    });
}
function capture(session) {
    const events = [];
    const names = ['agent_start', 'turn_start', 'message_start', 'message_update', 'message_end',
        'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'turn_end', 'agent_end',
        'extension_ui_request', 'exit', 'close'];
    for (const event of names)
        session.on(event, (data) => events.push({ event, data }));
    return events;
}
async function until(predicate, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > deadline)
            throw new Error('Timed out waiting for the fake agent');
        await (0, promises_1.setTimeout)(10);
    }
}
function mirrorEntries(file) {
    return fs.readFileSync(file, 'utf8').trim().split('\n')
        .flatMap((line) => {
        try {
            const value = JSON.parse(line);
            return value && typeof value === 'object' && !Array.isArray(value) ? [value] : [];
        }
        catch {
            return [];
        }
    });
}
function messages(events, role) {
    return events.flatMap(({ event, data }) => {
        if (event !== 'message_end')
            return [];
        const message = asRecord(asRecord(data).message);
        return message.role === role ? [message] : [];
    });
}
/** Message content blocks arrive as `unknown[]`; anything unshaped reads as empty. */
function blockAt(value, index = 0) {
    return asRecord(Array.isArray(value) ? value[index] : undefined);
}
function assistantText(messages) {
    return messages.flatMap(message => Array.isArray(message.content)
        ? message.content.flatMap(block => asRecord(block).type === 'text' ? [String(asRecord(block).text ?? '')] : [])
        : []).join('\n');
}
test('handshake fails closed on the wrong agent or missing resume capability', async (t) => {
    cleanup(t);
    await assert.rejects(launch('fail-closed'), /Unexpected ACP agent/);
    await assert.rejects(launch('no-resume'), /session resume/);
});
test('an unauthenticated agent reports the sign-in instruction', async (t) => {
    cleanup(t);
    await assert.rejects(launch('auth'), /not signed in on this host/);
});
test('a missing agy binary fails startup instead of waiting on the handshake', async (t) => {
    cleanup(t);
    await assert.rejects(acp.createAcpSession({ cwd: workDir, command: path.join(tmp, 'missing-agy'), args: [] }), /ENOENT|spawn/);
});
test('offers Gemini models only and keeps thinking levels from the config options', async (t) => {
    const session = await launch('default');
    cleanup(t, session);
    const payload = asRecord(await session.getAvailableModels());
    const models = Array.isArray(payload.models) ? payload.models : [];
    assert.ok(models.length > 0);
    for (const model of models) {
        assert.ok(String(asRecord(model).id).startsWith('gemini-'), `unexpected model ${String(asRecord(model).id)}`);
        assert.equal(asRecord(model).provider, 'google-antigravity');
    }
    assert.ok(!models.some(model => /claude|gpt/.test(String(asRecord(model).id))));
    await assert.rejects(session.setModel('google-antigravity', 'claude-sonnet-4-6'), /Gemini models only/);
    await assert.rejects(session.setModel('anthropic', 'gemini-4-carbon'), /Gemini models only/);
    await session.setModel('google-antigravity', 'gemini-4-argon');
    assert.deepEqual(asRecord(session.state.model).id, 'gemini-4-argon');
    await session.setThinkingLevel('high');
    assert.equal(session.state.thinkingLevel, 'high');
    await assert.rejects(session.setThinkingLevel('maximum'), /thinking level/);
    await assert.rejects(session.setName('renamed'), /renaming is not supported/);
});
test('prompt resolves once written, before the ACP turn ends', async (t) => {
    const session = await launch('default');
    cleanup(t, session);
    const events = capture(session);
    const written = await session.prompt('hello');
    assert.deepEqual(written, { ok: true });
    assert.equal(session.turnInProgress, true);
    assert.equal(events.filter(event => event.event === 'turn_end').length, 0, 'the turn outlives the write');
    await until(() => events.some(event => event.event === 'turn_end'));
    const assistants = messages(events, 'assistant');
    assert.equal(assistants.length, 1);
    assert.equal(assistants[0].stopReason, 'stop');
    assert.equal(asRecord(assistants[0].usage).totalTokens, 130);
    assert.equal(assistants[0].provider, 'google-antigravity');
    assert.equal(messages(events, 'user').length, 1);
    assert.equal(events.filter(event => event.event === 'agent_end').length, 1);
    assert.equal(session.turnInProgress, false);
});
test('steering hands the turn over: one turn_end with usage on the newest prompt', async (t) => {
    const session = await launch('steer');
    cleanup(t, session);
    const events = capture(session);
    await session.prompt('first');
    await session.steer('second');
    await until(() => events.some(event => event.event === 'turn_end'));
    await (0, promises_1.setTimeout)(80);
    assert.equal(events.filter(event => event.event === 'turn_end').length, 1, 'handover is not a turn end');
    const assistants = messages(events, 'assistant');
    assert.equal(assistants.length, 1);
    assert.equal(asRecord(assistants[0].usage).totalTokens, 130, 'usage belongs to the newest response');
    assert.equal(messages(events, 'user').length, 2);
    assert.equal(session.turnInProgress, false);
});
test('normalises tool calls, orders the mirror, and keeps bash exit details', async (t) => {
    const session = await launch('tool');
    cleanup(t, session);
    const events = capture(session);
    await session.prompt('use tools');
    await until(() => events.some(event => event.event === 'turn_end'));
    const starts = events.filter(event => event.event === 'tool_execution_start').map(event => asRecord(event.data));
    assert.deepEqual(starts.map(start => start.toolName), ['read', 'bash']);
    assert.deepEqual(asRecord(starts[0].args), { path: path.join(workDir, 'README.md') });
    assert.deepEqual(asRecord(starts[1].args), { command: 'echo hi' });
    const ends = events.filter(event => event.event === 'tool_execution_end').map(event => asRecord(event.data));
    assert.equal(ends.length, 2);
    const bashEnd = ends[1];
    assert.equal(bashEnd.isError, false);
    assert.equal(asRecord(asRecord(bashEnd.result).details).exitCode, 0);
    assert.equal(blockAt(asRecord(bashEnd.result).content).text, 'hi\n');
    const entries = mirrorEntries(session.sessionFile);
    assert.equal(entries[0].type, 'session');
    assert.equal(asRecord(entries[0].agy).version, '1.5.10');
    const assistantIndex = entries.findIndex(entry => {
        const message = asRecord(entry.message);
        return entry.type === 'message' && message.role === 'assistant'
            && Array.isArray(message.content)
            && message.content.some(block => asRecord(block).type === 'toolCall' && asRecord(block).name === 'read');
    });
    const resultIndex = entries.findIndex(entry => {
        const message = asRecord(entry.message);
        return entry.type === 'message' && message.role === 'toolResult' && message.toolName === 'read';
    });
    assert.ok(assistantIndex >= 0 && resultIndex > assistantIndex, 'assistant toolCall precedes its toolResult');
    assert.deepEqual(blockAt(asRecord(entries[assistantIndex].message).content).arguments, { path: path.join(workDir, 'README.md') });
    const bashResult = entries.flatMap(entry => {
        const message = asRecord(entry.message);
        return message.role === 'toolResult' && message.toolName === 'bash' ? [message] : [];
    })[0];
    assert.equal(blockAt(bashResult.content).text, 'hi\n');
    assert.equal(asRecord(bashResult.details).exitCode, 0);
    assert.ok(entries.some(entry => entry.type === 'model_change' && entry.provider === 'google-antigravity'));
});
test('maps elicitation forms to ask dialogs and answers back as ACP content', async (t) => {
    const session = await launch('elicit');
    cleanup(t, session);
    const events = capture(session);
    await session.prompt('ask me');
    await until(() => events.some(event => event.event === 'extension_ui_request' && asRecord(event.data).method === 'ask'));
    const request = asRecord(events.find(event => event.event === 'extension_ui_request').data);
    const questions = Array.isArray(request.questions) ? request.questions.map(asRecord) : [];
    assert.equal(questions.length, 1);
    assert.equal(questions[0].id, 'q1');
    assert.equal(questions[0].question, 'Save the result (42) to result.txt?');
    assert.equal(questions[0].recommended, 0);
    assert.deepEqual(questions[0].options.map(option => asRecord(option).label), ['yes', 'no']);
    await session.respondExtensionUI(String(request.id), {
        value: {
            kind: 'submit',
            results: [{ id: 'q1', question: String(questions[0].question), options: ['yes', 'no'], multi: false, selectedOptions: ['yes'], customInput: 'ok' }],
        },
    });
    await until(() => events.some(event => event.event === 'turn_end'));
    const firstText = assistantText(messages(events, 'assistant'));
    assert.match(firstText, /"action":"accept"/);
    assert.match(firstText, /"q1":"1"/);
    assert.match(firstText, /"q1_other":"ok"/);
    await session.prompt('ask again');
    await until(() => events.filter(event => event.event === 'extension_ui_request').length === 2);
    const second = events.filter(event => event.event === 'extension_ui_request')[1];
    await session.respondExtensionUI(String(asRecord(second.data).id), { value: { kind: 'chat' } });
    await until(() => events.filter(event => event.event === 'turn_end').length === 2);
    const answers = assistantText(messages(events, 'assistant'));
    assert.match(answers, /"action":"decline"/);
});
test('shows an unexpected permission request as a select and answers with its option id', async (t) => {
    const session = await launch('permission');
    cleanup(t, session);
    const events = capture(session);
    await session.prompt('touch it');
    await until(() => events.some(event => event.event === 'extension_ui_request'));
    const request = asRecord(events.find(event => event.event === 'extension_ui_request').data);
    assert.equal(request.method, 'select');
    assert.deepEqual(request.options.map(option => asRecord(option).label), ['Allow', 'Deny']);
    assert.equal(asRecord(session.extUIState.dialogs.get(String(request.id))).method, 'select');
    await session.respondExtensionUI(String(request.id), { value: 'Allow' });
    await until(() => events.some(event => event.event === 'turn_end'));
    const end = events.filter(event => event.event === 'tool_execution_end').map(event => asRecord(event.data))[0];
    assert.equal(end.isError, false);
    assert.match(assistantText(messages(events, 'assistant')), /permission:allow/);
});
test('cancel ends the turn with an aborted assistant message', async (t) => {
    const session = await launch('slow');
    cleanup(t, session);
    const events = capture(session);
    await session.prompt('long task');
    await until(() => events.some(event => event.event === 'message_update'));
    await session.abort();
    await until(() => events.some(event => event.event === 'turn_end'));
    const assistant = messages(events, 'assistant')[0];
    assert.equal(assistant.stopReason, 'aborted');
    assert.equal(asRecord(assistant.usage).totalTokens, 130);
    const entries = mirrorEntries(session.sessionFile);
    const persisted = entries.flatMap(entry => asRecord(entry.message).role === 'assistant' ? [asRecord(entry.message)] : []);
    assert.equal(persisted[0].stopReason, 'aborted');
});
test('warns when the agent version is outside the verified set', async (t) => {
    const session = await launch('version');
    cleanup(t, session);
    assert.equal(session.agentVersion, '1.5.11');
    assert.ok(acp.AGY_VERIFIED_VERSIONS.includes('1.5.10'));
    const status = asRecord(session.extUIState.statuses.get('agy-version'));
    assert.match(String(status.statusText), /unverified/);
});
test('records both directions in the raw sidecar', async (t) => {
    const session = await launch('default');
    cleanup(t, session);
    await session.prompt('sidecar');
    await until(() => session.turnInProgress === false && fs.existsSync(session.sessionFile));
    const sidecar = session.sessionFile.replace(/\.jsonl$/, '.acp.jsonl');
    const frames = fs.readFileSync(sidecar, 'utf8').trim().split('\n').map(line => asRecord(JSON.parse(line)));
    assert.ok(frames.some(frame => frame.dir === 'out' && asRecord(frame.msg).method === 'initialize'));
    assert.ok(frames.some(frame => frame.dir === 'out' && asRecord(frame.msg).method === 'session/prompt'));
    assert.ok(frames.some(frame => frame.dir === 'in' && asRecord(frame.msg).method === 'session/update'));
    assert.ok(frames.some(frame => frame.dir === 'in' && asRecord(frame.msg).result !== undefined));
    assert.ok(frames.every(frame => typeof frame.t === 'number'));
});
test('resumes a mirror without replaying or rewriting its header', async (t) => {
    const first = await launch('default');
    cleanup(t);
    const events = capture(first);
    await first.prompt('before restart');
    await until(() => events.some(event => event.event === 'turn_end'));
    const file = first.sessionFile;
    const id = first.id;
    await first.close();
    assert.equal(first.alive, false);
    const options = { command: process.execPath, args: [FIXTURE], env: { ...process.env, FAKE_AGY_SCRIPT: 'default' } };
    const [left, right] = await Promise.all([
        acp.resumeAcpSession(file, options),
        acp.resumeAcpSession(file, options),
    ]);
    cleanup(t, left);
    assert.equal(left, right, 'concurrent resumes share one child');
    assert.equal(left.id, id);
    assert.equal(left.sessionFile, file);
    assert.equal(acp.getAcpSession(id), left);
    assert.equal(left.state.sessionName, 'Resumed Fake Session');
    const resumedEvents = capture(left);
    await left.prompt('after restart');
    await until(() => resumedEvents.some(event => event.event === 'turn_end'));
    const entries = mirrorEntries(file);
    assert.equal(entries.filter(entry => entry.type === 'session').length, 1, 'the header is written once');
    assert.equal(entries.filter(entry => asRecord(entry.message).role === 'user').length, 2);
    assert.equal(entries.filter(entry => asRecord(entry.message).role === 'assistant').length, 2);
});
