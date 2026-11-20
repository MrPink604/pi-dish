/**
 * ACP transport tests against the scripted fake agent: no `agy` install, no
 * provider traffic. Covers the handshake gates, prompt/steer/cancel contract,
 * tool normalisation, elicitation dialogs, the Pi mirror and the raw sidecar.
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { setTimeout as delay } from 'node:timers/promises';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-session-'));
process.env.HOME = tmp;
const workDir = path.join(tmp, 'work');
fs.mkdirSync(workDir, { recursive: true });
fs.writeFileSync(path.join(workDir, 'README.md'), '# scratch\n');

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-agy-acp.js');
const acp: typeof import('../lib/acp-session.js') = require('../lib/acp-session.js');
const acpTranscript: typeof import('../lib/acp-transcript.js') = require('../lib/acp-transcript.js');
const { asRecord } = require('../lib/wire-protocol.js') as typeof import('../lib/wire-protocol.js');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

type AcpSession = InstanceType<typeof acp.AcpSession>;
type AcpOptions = Parameters<typeof acp.createAcpSession>[0];
interface CapturedEvent { event: string; data: unknown }

function launch(script: string, extra: Partial<AcpOptions> = {}): Promise<AcpSession> {
  return acp.createAcpSession({
    cwd: workDir,
    command: process.execPath,
    args: [FIXTURE],
    env: { ...process.env, FAKE_AGY_SCRIPT: script },
    ...extra,
  });
}

function cleanup(t: test.TestContext, session?: AcpSession): void {
  t.after(async () => {
    if (session) await session.close().catch(() => {});
    await acp.shutdownAcpSessions();
  });
}

function capture(session: AcpSession): CapturedEvent[] {
  const events: CapturedEvent[] = [];
  const names = ['agent_start', 'turn_start', 'message_start', 'message_update', 'message_end',
    'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'turn_end', 'agent_end',
    'extension_ui_request', 'exit', 'close'];
  for (const event of names) session.on(event, (data: unknown) => events.push({ event, data }));
  return events;
}

async function until(predicate: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the fake agent');
    await delay(10);
  }
}

function mirrorEntries(file: string): Record<string, unknown>[] {
  return fs.readFileSync(file, 'utf8').trim().split('\n')
    .flatMap((line): Record<string, unknown>[] => {
      try {
        const value: unknown = JSON.parse(line);
        return value && typeof value === 'object' && !Array.isArray(value) ? [value as Record<string, unknown>] : [];
      } catch { return []; }
    });
}

function messages(events: CapturedEvent[], role: string): Record<string, unknown>[] {
  return events.flatMap(({ event, data }): Record<string, unknown>[] => {
    if (event !== 'message_end') return [];
    const message = asRecord(asRecord(data).message);
    return message.role === role ? [message] : [];
  });
}

/** Message content blocks arrive as `unknown[]`; anything unshaped reads as empty. */
function blockAt(value: unknown, index = 0): Record<string, unknown> {
  return asRecord(Array.isArray(value) ? value[index] : undefined);
}

function assistantText(messages: Record<string, unknown>[]): string {
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
  await assert.rejects(
    acp.createAcpSession({ cwd: workDir, command: path.join(tmp, 'missing-agy'), args: [] }),
    /ENOENT|spawn/);
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
  await delay(80);

  assert.equal(events.filter(event => event.event === 'turn_end').length, 1, 'handover is not a turn end');
  const assistants = messages(events, 'assistant');
  assert.equal(assistants.length, 1);
  assert.equal(asRecord(assistants[0].usage).totalTokens, 130, 'usage belongs to the newest response');
  assert.equal(messages(events, 'user').length, 2);
  assert.equal(session.turnInProgress, false);
});

test('a handed-over prompt that reports usage adds it to the turn total', async (t) => {
  const session = await launch('steer-usage');
  cleanup(t, session);
  const events = capture(session);

  await session.prompt('first');
  await session.steer('second');
  await until(() => events.some(event => event.event === 'turn_end'));

  assert.equal(events.filter(event => event.event === 'turn_end').length, 1);
  const usage = asRecord(messages(events, 'assistant').at(-1)?.usage);
  assert.equal(usage.totalTokens, 260, 'both prompts report usage and the turn keeps both');
  assert.equal(usage.input, 240);
});

test('background commands keep the turn alive past end_turn until completion and autonomous idle', async (t) => {
  const saved = process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS;
  process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS = '120';
  t.after(() => {
    if (saved === undefined) delete process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS;
    else process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS = saved;
  });
  const session = await launch('background');
  cleanup(t, session);
  const events = capture(session);

  await session.prompt('run the tests');
  // Once the interim message closes (at end_turn), the background tool is still
  // running so the turn and runningToolCalls must remain active.
  await until(() => assistantText(messages(events, 'assistant')).includes('Tests are running in the background.'));
  assert.equal(session.turnInProgress, true, 'turn stays active while background command runs');
  assert.equal(session.hasActiveToolWork, true);
  assert.equal(session.runningToolCalls.has('call-bg-1'), true, 'running tool card stays live');
  assert.equal(events.filter(event => event.event === 'turn_end').length, 0);

  await until(() => events.some(event => event.event === 'turn_end'), 5000);

  const order = events.map(event => event.event).filter(name => name === 'turn_start' || name === 'turn_end');
  assert.deepEqual(order, ['turn_start', 'turn_end'], 'background work completes within one continuous turn');
  assert.equal(session.turnInProgress, false);
  assert.equal(session.hasActiveToolWork, false);

  // The background command's result and the text after it reach the mirror in order.
  const mirrored = mirrorEntries(session.sessionFile)
    .filter(entry => entry.type === 'message').map(entry => asRecord(entry.message));
  const roles = mirrored.map(message => `${String(message.role)}${message.toolName ? `:${String(message.toolName)}` : ''}`);
  assert.deepEqual(roles, ['user', 'assistant', 'assistant', 'toolResult:bash', 'assistant']);
  assert.match(assistantText([mirrored[4]]), /Background tests passed\./);
  assert.equal(blockAt(mirrored[1].content).type, 'toolCall', 'the call precedes its result');
});

test('chained long background commands outliving autonomous idle keep the turn active and preserve mirror order', async (t) => {
  const saved = process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS;
  process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS = '80';
  t.after(() => {
    if (saved === undefined) delete process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS;
    else process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS = saved;
  });
  const session = await launch('background-chain');
  cleanup(t, session);
  const events = capture(session);

  await session.prompt('verify everything');
  await until(() => events.some(event => event.event === 'tool_execution_start' && asRecord(event.data).toolCallId === 'call-bg-2'));
  // Wait longer than PI_DISH_AGY_AUTONOMOUS_IDLE_MS (80ms) while call-bg-2 is still running (260ms).
  await delay(140);
  assert.equal(session.turnInProgress, true, 'autonomous idle timer does not end the turn while call-bg-2 runs');
  assert.equal(session.hasActiveToolWork, true);
  assert.equal(session.runningToolCalls.has('call-bg-2'), true);
  assert.equal(events.filter(event => event.event === 'turn_end').length, 0);

  await until(() => events.some(event => event.event === 'turn_end'), 5000);
  const order = events.map(event => event.event).filter(name => name === 'turn_start' || name === 'turn_end');
  assert.deepEqual(order, ['turn_start', 'turn_end']);
  assert.equal(session.turnInProgress, false);

  const mirrored = mirrorEntries(session.sessionFile)
    .filter(entry => entry.type === 'message').map(entry => asRecord(entry.message));
  const roles = mirrored.map(message => `${String(message.role)}${message.toolName ? `:${String(message.toolName)}` : ''}`);
  assert.deepEqual(roles, [
    'user',
    'assistant', 'assistant', 'toolResult:bash',
    'assistant', 'assistant', 'toolResult:bash',
    'assistant',
  ]);
  assert.match(assistantText([mirrored[5]]), /Waiting on full test suite\./);
  assert.match(assistantText([mirrored[7]]), /All tests passed\./);
});

test('daemon tool calls (IsDaemon: true) do not hold a turn open after end_turn', async (t) => {
  const session = await launch('background-daemon');
  cleanup(t, session);
  const events = capture(session);

  await session.prompt('start dev server');
  await until(() => events.some(event => event.event === 'turn_end'), 5000);
  assert.equal(session.turnInProgress, false);
  assert.equal(session.hasActiveToolWork, false);
  assert.match(assistantText(messages(events, 'assistant')), /Dev server started\./);
});

test('abort ends a turn that is waiting on a background tool after end_turn', async (t) => {
  const session = await launch('background-abort');
  cleanup(t, session);
  const events = capture(session);

  await session.prompt('run forever');
  await until(() => assistantText(messages(events, 'assistant')).includes('Running long background task.'));
  assert.equal(session.turnInProgress, true);
  assert.equal(session.hasActiveToolWork, true);

  await session.abort();
  assert.equal(session.turnInProgress, false);
  assert.equal(session.hasActiveToolWork, false);
  assert.equal(events.filter(event => event.event === 'turn_end').length, 1);
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
  const request = asRecord(events.find(event => event.event === 'extension_ui_request')!.data);
  const questions = Array.isArray(request.questions) ? request.questions.map(asRecord) : [];
  assert.equal(questions.length, 1);
  assert.equal(questions[0].id, 'q1');
  assert.equal(questions[0].question, 'Save the result (42) to result.txt?');
  assert.equal(questions[0].recommended, 0);
  assert.deepEqual((questions[0].options as unknown[]).map(option => asRecord(option).label), ['yes', 'no']);

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
  const request = asRecord(events.find(event => event.event === 'extension_ui_request')!.data);
  assert.equal(request.method, 'select');
  assert.deepEqual((request.options as unknown[]).map(option => asRecord(option).label), ['Allow', 'Deny']);
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

test('surfaces prompt RPC errors and refusals even when no chunks streamed', async (t) => {
  const errored = await launch('prompt-error');
  cleanup(t, errored);
  const errorEvents = capture(errored);
  await errored.prompt('trigger quota error');
  await until(() => errorEvents.some(event => event.event === 'turn_end'));
  const errorAssistant = messages(errorEvents, 'assistant')[0];
  assert.equal(errorAssistant.stopReason, 'error');
  assert.equal(errorAssistant.errorMessage, 'Quota exhausted');
  const persistedError = mirrorEntries(errored.sessionFile)
    .flatMap(entry => asRecord(entry.message).role === 'assistant' ? [asRecord(entry.message)] : [])[0];
  assert.equal(persistedError.errorMessage, 'Quota exhausted');

  const refused = await launch('refusal');
  cleanup(t, refused);
  const refusalEvents = capture(refused);
  await refused.prompt('trigger refusal');
  await until(() => refusalEvents.some(event => event.event === 'turn_end'));
  const refusalAssistant = messages(refusalEvents, 'assistant')[0];
  assert.equal(refusalAssistant.stopReason, 'error');
  assert.equal(refusalAssistant.errorMessage, 'Antigravity refused this request.');
  assert.equal(asRecord(refusalAssistant.usage).totalTokens, 130);
});

test('preserves usage on tool-only turns and trims whole-file diffs into hunks', async (t) => {
  const session = await launch('tool-only');
  cleanup(t, session);
  const events = capture(session);
  await session.prompt('edit big file');
  await until(() => events.some(event => event.event === 'turn_end'));

  const assistants = messages(events, 'assistant');
  assert.equal(assistants.length, 2, 'toolUse segment plus trailing usage shell');
  assert.equal(assistants[0].stopReason, 'toolUse');
  assert.equal(assistants[1].stopReason, 'stop');
  assert.deepEqual(assistants[1].content, []);
  assert.equal(asRecord(assistants[1].usage).totalTokens, 130);

  const entries = mirrorEntries(session.sessionFile);
  const editResult = entries.flatMap(entry => {
    const message = asRecord(entry.message);
    return message.role === 'toolResult' && message.toolName === 'edit' ? [message] : [];
  })[0];
  const diff = String(blockAt(editResult.content).text ?? '');
  assert.match(diff, /@@ -198,7 \+198,7 @@/);
  assert.match(diff, /-line_200 = 200/);
  assert.match(diff, /\+line_200 = "edited"/);
  assert.ok(diff.split('\n').length < 20, `whole-file diff was not trimmed (${diff.split('\n').length} lines)`);
});

test('persists attached images in user mirror entries without empty text blocks', async (t) => {
  const session = await launch('default');
  cleanup(t, session);
  const events = capture(session);
  await session.prompt('', { images: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] });
  await until(() => events.some(event => event.event === 'turn_end'));

  const entries = mirrorEntries(session.sessionFile);
  const user = entries.flatMap(entry => asRecord(entry.message).role === 'user' ? [asRecord(entry.message)] : [])[0];
  const content = Array.isArray(user.content) ? user.content.map(asRecord) : [];
  assert.equal(content.length, 1, 'image-only prompt omits an empty text block');
  assert.deepEqual(content[0], { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' });
});

test('formats multi-region diffs, caps giant writes, and fills read_file placeholders', () => {
  const base = Array.from({ length: 1000 }, (_, i) => `rule_${i} { color: red; }`);
  const multi = [...base];
  multi.splice(20, 1, 'rule_20 { color: blue; }', 'rule_20_extra { display: block; }');
  multi.splice(801, 1, 'rule_800 { color: green; }');
  const editCall = acpTranscript.normalizeAcpTool({ name: 'edit_file', args: { Path: '/proj/style.css' } });
  const multiDiff = acpTranscript.acpToolResult({
    status: 'completed',
    content: [{ type: 'diff', path: '/proj/style.css', oldText: base.join('\n') + '\n', newText: multi.join('\n') + '\n' }],
  }, editCall).text;
  const hunks = multiDiff.split('\n').filter(line => line.startsWith('@@ '));
  assert.equal(hunks.length, 2, 'far-apart edits split into two compact hunks');
  assert.match(multiDiff, /-rule_20 \{ color: red; \}/);
  assert.match(multiDiff, /\+rule_20_extra \{ display: block; \}/);
  assert.match(multiDiff, /-rule_800 \{ color: red; \}/);
  assert.match(multiDiff, /\+rule_800 \{ color: green; \}/);
  assert.ok(multiDiff.split('\n').length < 30, `multi-region diff was not trimmed (${multiDiff.split('\n').length} lines)`);

  const writeCall = acpTranscript.normalizeAcpTool({ name: 'write_file', args: { Path: '/proj/huge.txt' } });
  const huge = Array.from({ length: 320 }, (_, i) => `added_${i}`).join('\n') + '\n';
  const cappedDiff = acpTranscript.acpToolResult({
    status: 'completed',
    content: [{ type: 'diff', path: '/proj/huge.txt', oldText: '', newText: huge }],
  }, writeCall).text;
  assert.match(cappedDiff, /\.\.\. \(121 more diff lines\)$/);
  assert.equal(cappedDiff.split('\n').length, 202, 'path line + 200 diff lines + omission trailer');

  const readCall = acpTranscript.normalizeAcpTool({ name: 'read_file', args: { Path: '/proj/README.md' } });
  assert.equal(acpTranscript.acpToolResult({ status: 'in_progress' }, readCall).text, '', 'running reads keep empty partial text');
  assert.equal(
    acpTranscript.acpToolResult({ status: 'completed' }, readCall).text,
    '/proj/README.md\n(content not reported by agy)',
  );
});

test('acpToolResult and extractAcpImageBlock preserve inline, resource, and contained local images', () => {
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-acp-img-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-acp-out-'));
  try {
    const localPng = path.join(imgDir, 'chart.png');
    fs.writeFileSync(localPng, Buffer.from(pngB64, 'base64'));
    const sysPng = path.join(imgDir, '.system_generated', 'internal.png');
    fs.mkdirSync(path.dirname(sysPng), { recursive: true });
    fs.writeFileSync(sysPng, Buffer.from(pngB64, 'base64'));
    const outsidePng = path.join(outsideDir, 'secret.png');
    fs.writeFileSync(outsidePng, Buffer.from(pngB64, 'base64'));
    const symPng = path.join(imgDir, 'escape.png');
    fs.symlinkSync(outsidePng, symPng);

    const call = acpTranscript.normalizeAcpTool({ name: 'image-generator', args: {} });
    const res = acpTranscript.acpToolResult({
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: 'Generated chart' } },
        { type: 'image', data: `data:image/png;base64,${pngB64}`, mimeType: 'image/png' },
        { type: 'resource', resource: { mimeType: 'image/webp', blob: pngB64 } },
        { type: 'resource_link', uri: `file://${localPng}`, mimeType: 'image/png' },
        { type: 'resource_link', uri: `file://${sysPng}`, mimeType: 'image/png' },
        { type: 'resource_link', uri: `file://${symPng}`, mimeType: 'image/png' },
        { type: 'resource_link', uri: `file://${outsidePng}`, mimeType: 'image/png' },
      ],
    }, call, { allowedRoots: [imgDir] });
    assert.equal(res.text, 'Generated chart');
    assert.equal(res.images?.length, 3, 'keeps inline image, resource blob, and contained local file; drops internal/symlink/outside');
    assert.equal(res.images?.[0].data, pngB64);
    assert.equal(res.images?.[1].mimeType, 'image/webp');
    assert.equal(res.images?.[2].data, pngB64);

    // read_file on a contained image surfaces the image block too.
    const readImgCall = acpTranscript.normalizeAcpTool({ name: 'read_file', args: { Path: localPng } });
    const readRes = acpTranscript.acpToolResult({ status: 'completed' }, readImgCall, { allowedRoots: [imgDir] });
    assert.equal(readRes.images?.length, 1);
    assert.equal(readRes.images?.[0].mimeType, 'image/png');
  } finally {
    fs.rmSync(imgDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('askFromElicitation and askElicitationResult support multi-select array items (anyOf and enum)', () => {
  const ask = acpTranscript.askFromElicitation('elicit-1', {
    message: 'The agent has a question.',
    requestedSchema: {
      type: 'object',
      required: ['q2'],
      properties: {
        q1: {
          type: 'array',
          title: 'Pick colors',
          items: {
            anyOf: [
              { const: '1', title: '(Recommended) Red' },
              { const: '2', title: 'Blue' },
              { const: '3', title: 'Green' },
            ],
          },
        },
        q1_other: { type: 'string', title: 'Other' },
        q2: {
          type: 'array',
          title: 'Targets',
          items: {
            type: 'string',
            enum: ['web', 'cli'],
            enumNames: ['Web UI', 'CLI'],
          },
        },
      },
    },
  }, []);
  assert.ok(ask, 'multi-select ask');

  const reqQuestions = ask.request.questions as { multi: boolean; recommended: number | null; options: { label: string }[] }[];
  assert.equal(reqQuestions.length, 2);
  assert.equal(reqQuestions[0].multi, true);
  assert.equal(reqQuestions[0].recommended, 0, 'detects (Recommended) directly from schema title');
  assert.deepEqual(reqQuestions[0].options.map(o => o.label), ['Red', 'Blue', 'Green']);
  assert.equal(reqQuestions[1].multi, true);
  assert.deepEqual(reqQuestions[1].options.map(o => o.label), ['Web UI', 'CLI']);

  const submitted = acpTranscript.askElicitationResult({
    value: {
      kind: 'submit',
      results: [
        { id: 'q1', selectedOptions: ['Red', 'Green'], customInput: 'Yellow' },
        { id: 'q2', selectedOptions: [], customInput: '' },
      ],
    },
  }, ask.questions);
  assert.deepEqual(submitted, {
    action: 'accept',
    content: { q1: ['1', '3'], q1_other: 'Yellow', q2: [] },
  });
});

test('normalises agy /usage JSON to Gemini-only windows and rejects error envelopes', () => {
  const reports = acpTranscript.normalizeAgyUsageReports({
    status: 'SUCCESS',
    command: {
      name: 'usage',
      data: {
        groups: [{
          name: 'Gemini Models',
          buckets: [
            { id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0.9, reset_time: '2026-11-24T23:38:49Z' },
            { id: 'gemini-5h', name: 'Five Hour Limit Remaining', window: '5h', remaining_fraction: 0, reset_time: '2026-11-18T04:38:49Z' },
          ],
        }, {
          name: 'Claude and GPT models',
          buckets: [
            { id: '3p-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0.5, reset_time: '2026-11-25T01:38:04Z' },
          ],
        }],
      },
    },
  }, { planType: 'Google AI Ultra', fetchedAt: 1700000000000 });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].provider, 'google-antigravity');
  assert.equal(reports[0].planType, 'Google AI Ultra');
  assert.equal(reports[0].limits.length, 2, '3p buckets are excluded');
  assert.equal(reports[0].limits[0].label, '5 hours');
  assert.equal(reports[0].limits[0].usedFraction, 1);
  assert.equal(reports[0].limits[0].status, 'exhausted');
  assert.equal(reports[0].limits[1].label, '7 days');
  assert.ok(Math.abs(reports[0].limits[1].usedFraction - 0.1) < 1e-9);
  assert.equal(reports[0].limits[1].resetsAt, Date.parse('2026-11-24T23:38:49Z'));

  assert.throws(
    () => acpTranscript.normalizeAgyUsageReports({ status: 'ERROR', error: 'authentication required' }),
    /authentication required/,
  );
});

test('includes TTFT per LLM step, skips tool execution and sibling batch calls, and pairs turn usage with turnDurationMs', async (t) => {
  const sessionFiles: typeof import('../lib/session-files.js') = require('../lib/session-files.js');
  const session = await launch('timing');
  cleanup(t, session);
  const events = capture(session);

  await session.prompt('measure generation speed');
  await until(() => events.some(event => event.event === 'turn_end'));

  const parsed = sessionFiles.readSessionMessages(session.sessionFile);
  const assistants = parsed.filter(m => m.role === 'assistant');
  assert.equal(assistants.length, 3, 'two toolUse segments + final stop segment');
  assert.ok((assistants[0].durationMs ?? 0) >= 90, `step 1 includes TTFT (${assistants[0].durationMs}ms)`);
  assert.ok((assistants[0].ttftMs ?? 0) >= 90, `step 1 records TTFT (${assistants[0].ttftMs}ms)`);
  assert.equal(assistants[1].durationMs, undefined, 'sibling tool call in the same LLM batch does not invent a second step');
  assert.equal(assistants[1].ttftMs, undefined);
  assert.ok((assistants[2].durationMs ?? 0) >= 200,
    `closing message durationMs covers both LLM steps including TTFT (${assistants[2].durationMs}ms), not just the 10ms streaming tail`);
  assert.ok((assistants[2].durationMs ?? 0) < 350,
    `closing message durationMs excludes the 140ms tool execution window (${assistants[2].durationMs}ms)`);
  assert.ok((assistants[2].ttftMs ?? 0) >= 90, `closing step records its own TTFT (${assistants[2].ttftMs}ms)`);
  assert.ok((assistants[2].streamMs ?? 0) > 0 && (assistants[2].streamMs ?? 0) < 100,
    `closing message streamMs isolates post-TTFT streaming (${assistants[2].streamMs}ms)`);

  const stats = sessionFiles.getSessionStats(session.sessionFile);
  assert.equal(stats.responseTiming.measured, 2, 'only the two real LLM calls count as measured responses');
  assert.equal(stats.ttftTiming.measured, 2, 'both real LLM calls report TTFT');
  assert.ok((stats.ttftTiming.medianMs ?? 0) >= 90);
  assert.equal(stats.genMs, assistants[2].durationMs, 'session genMs matches the turn LLM duration without double counting');
  assert.equal(stats.genOutput, 8);
  assert.equal(stats.streamOutput, 8);
  assert.deepEqual(stats.providers, ['google-antigravity']);
  assert.deepEqual(stats.apis, ['acp']);

  const indexed = sessionFiles.buildIndexedUsageFromContent(fs.readFileSync(session.sessionFile, 'utf8'));
  assert.equal(indexed.total.measured, 2);
  assert.equal(indexed.total.ttftCount, 2);
  assert.equal(indexed.total.durationMs, stats.genMs, 'indexed per-step sum equals turnDurationMs without double counting');
  assert.equal(indexed.total.genMs, stats.genMs);
  assert.equal(indexed.total.genOutput, 8);
  assert.deepEqual(indexed.models['google-antigravity/gemini-4-carbon'].apis, ['acp']);
});

test('plan widget clears on empty entries, tool results enrich from brain step output, and running bash streams task logs', async (t) => {
  // Pure unit check on planWidgetRequest clearing empty plans.
  const clearReq = acpTranscript.planWidgetRequest('plan-clear-1', []);
  assert.ok(clearReq);
  assert.equal(clearReq.widgetKey, 'agy-plan');
  assert.deepEqual(clearReq.widgetLines, []);

  const session = await launch('tasks-and-plan');
  cleanup(t, session);
  const events = capture(session);

  // Seed Antigravity brain step output and running task log for this session id.
  const sysDir = path.join(tmp, '.gemini', 'antigravity-cli', 'brain', session.id, '.system_generated');
  fs.mkdirSync(path.join(sysDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(sysDir, 'steps', '2'), { recursive: true });
  fs.mkdirSync(path.join(sysDir, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(sysDir, 'logs', 'transcript.jsonl'), [
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'swarm', args: {} }] }),
    JSON.stringify({ step_index: 2, type: 'GENERIC', status: 'DONE', content: 'Spawned worker @reader' }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(sysDir, 'steps', '2', 'output.txt'), 'Spawned worker @reader (conv-123)\n');
  fs.writeFileSync(path.join(sysDir, 'tasks', 'task-7.log'), 'building bundle...\nwatching for changes...\n');

  await session.prompt('run tasks');
  await until(() => session.getPlan().length === 2, 3000);
  assert.equal(session.getPlan()[0].content, 'Verify auth fix');

  await until(() => events.some(e => e.event === 'turn_end'), 5000);
  assert.deepEqual(session.getPlan(), [], 'empty plan update clears getPlan()');

  const planWidgets = events
    .filter(e => e.event === 'extension_ui_request' && asRecord(e.data).widgetKey === 'agy-plan')
    .map(e => asRecord(e.data).widgetLines);
  assert.equal(planWidgets.length, 2);
  assert.equal(Array.isArray(planWidgets[0]) ? planWidgets[0].length : 0, 2);
  assert.deepEqual(planWidgets[1], [], 'clearing widget emits empty widgetLines');

  const swarmEnd = events.find(e => e.event === 'tool_execution_end' && asRecord(e.data).toolCallId === 'call-swarm-1');
  assert.ok(swarmEnd, 'swarm tool_execution_end emitted');
  const swarmText = blockAt(asRecord(asRecord(swarmEnd.data).result).content).text;
  assert.match(String(swarmText ?? ''), /Spawned worker @reader \(conv-123\)/);

  const bgUpdates = events
    .filter(e => e.event === 'tool_execution_update' && asRecord(e.data).toolCallId === 'call-bg-log')
    .map(e => String(blockAt(asRecord(asRecord(e.data).partialResult).content).text ?? ''));
  assert.ok(bgUpdates.some(text => text.includes('watching for changes...')),
    `expected running bash tool to stream task-7.log tail, got: ${JSON.stringify(bgUpdates)}`);
});
