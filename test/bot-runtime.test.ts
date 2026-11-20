// A bot's runtime on pi-ai's faux provider: no live model, no live session.
// The sessions port stands in for the pi-dish-sessions CLI.
import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import type { BotRow } from '../lib/bot-registry';
import type { BotRuntime, SessionsPort } from '../lib/bot-runtime';
const { BotMirror }: typeof import('../lib/bot-mirror') = require('../lib/bot-mirror');
const runtimeModule: typeof import('../lib/bot-runtime') = require('../lib/bot-runtime');
const { openBotRuntime, settledWorker, newContextRefusal, composeHandoff } = runtimeModule;

type Faux = typeof import('@earendil-works/pi-ai/providers/faux');
type Step = import('@earendil-works/pi-ai/providers/faux').FauxResponseStep;
type Message = import('@earendil-works/pi-ai').Message;

const BOT: BotRow = {
  id: '0b0c5a1e-0000-4000-8000-000000000001', parentId: null, name: 'Fleet', status: 'active', model: 'faux/faux-1',
  thinking: null, identity: 'You are Fleet, the contact for the fleet.', places: [], revision: 1,
  createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z',
};

interface Harness {
  runtime: BotRuntime;
  events: { event: string; data: Record<string, unknown> }[];
  requests: Message[][];
  mirrorLines: () => Record<string, unknown>[];
  respond: (...steps: Step[]) => void;
  /** Closes the runtime, runs `between` while it is down, and opens it again on the same storage. */
  reopen: (between?: () => void) => Promise<void>;
  faux: Faux;
}

async function until(predicate: () => boolean, message: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function openTestBot(t: test.TestContext, sessions: SessionsPort, { contextWindow = 200_000 } = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bot-'));
  const faux: Faux = await import('@earendil-works/pi-ai/providers/faux');
  const { createModels } = await import('@earendil-works/pi-ai/models');
  const provider = faux.fauxProvider({ models: [{ id: 'faux-1', contextWindow }] });
  const models = createModels();
  models.setProvider(provider.provider);
  const requests: Message[][] = [];
  const events: Harness['events'] = [];
  const mirrorFile = path.join(dir, 'sessions', `${BOT.id}.jsonl`);
  const open = () => openBotRuntime({
    bot: BOT, storageFile: path.join(dir, 'durable.sqlite'),
    mirror: new BotMirror(mirrorFile, { id: BOT.id, cwd: dir, name: BOT.name }),
    models, sessions, loadBot: () => BOT,
    emit: (event, data) => events.push({ event, data }),
    changed: () => {}, log: () => {}, pollMs: { first: 20, max: 40 },
  });
  const harness: Harness = {
    runtime: await open(), events, requests, faux,
    mirrorLines: () => fs.readFileSync(mirrorFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>),
    respond: (...steps) => provider.appendResponses(steps.map(step => typeof step === 'function'
      ? ((context, ...rest) => { requests.push([...context.messages]); return step(context, ...rest); }) as Step
      : ((context) => { requests.push([...context.messages]); return step; }) as Step)),
    async reopen(between) { await harness.runtime.close(); between?.(); harness.runtime = await open(); },
  };
  t.after(async () => { await harness.runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return harness;
}

const noSessions: SessionsPort = async args => { throw new Error(`unexpected sessions call: ${args.join(' ')}`); };

function textOf(message: unknown): string {
  return runtimeModule.messageText(message);
}

test('a prompt streams as bridge events and lands in the mirror before message_end', async t => {
  const bot = await openTestBot(t, noSessions);
  bot.respond(bot.faux.fauxAssistantMessage('Hello from Fleet.'));
  const ends: number[] = [];
  const original = bot.mirrorLines;
  bot.events.push = function push(...items) {
    for (const item of items) if (item.event === 'message_end') ends.push(original().length);
    return Array.prototype.push.apply(this, items);
  };
  await bot.runtime.prompt('Hi', 'followUp');
  await until(() => bot.events.some(event => event.event === 'agent_end'), 'the run ends');
  const names = bot.events.map(event => event.event);
  assert.deepEqual(names.filter(name => name !== 'message_update'),
    ['agent_start', 'turn_start', 'message_start', 'message_end', 'message_start', 'message_end', 'turn_end', 'agent_end']);
  const lines = bot.mirrorLines();
  assert.equal(lines[0].type, 'session');
  assert.equal(lines[0].id, BOT.id);
  assert.deepEqual(lines.filter(line => line.type === 'session_info').map(line => line.name), ['Fleet']);
  const messages = lines.filter(line => line.type === 'message').map(line => line.message as Record<string, unknown>);
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant']);
  assert.equal(textOf(messages[1]), 'Hello from Fleet.');
  assert.ok(lines.some(line => line.type === 'model_change' && line.provider === 'faux'));
  assert.deepEqual(messages[0].content, [{ type: 'text', text: 'Hi' }], 'user text is a block, as Pi transcripts hold it');
  assert.equal(ends.length, 2);
  assert.ok(ends[1] >= lines.length, 'the assistant entry is on disk when message_end is emitted');
  for (let index = 2; index < lines.length; index++) assert.equal(lines[index].parentId, lines[index - 1].id, 'one linear chain');

  // A restarted relay continues the mirror where it stopped, without repeating anything.
  await bot.reopen();
  bot.respond(bot.faux.fauxAssistantMessage('Still here.'));
  await bot.runtime.prompt('Again', 'followUp');
  await until(() => bot.mirrorLines().filter(line => line.type === 'message').length === 4, 'the second turn is mirrored');
  const after = bot.mirrorLines().filter(line => line.type === 'message').map(line => textOf(line.message));
  assert.deepEqual(after, ['Hi', 'Hello from Fleet.', 'Again', 'Still here.']);
});

test('a tool call maps to tool_execution events and its result to the mirror', async t => {
  const calls: string[][] = [];
  const bot = await openTestBot(t, async args => { calls.push(args); return 'beelink\treachable\tself\n'; });
  bot.respond(
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('sessions', { action: 'hosts' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('One host: beelink.'),
  );
  await bot.runtime.prompt('Which hosts?', 'followUp');
  await until(() => bot.events.some(event => event.event === 'agent_end'), 'the run ends');
  assert.deepEqual(calls, [['hosts']]);
  const start = bot.events.find(event => event.event === 'tool_execution_start');
  const end = bot.events.find(event => event.event === 'tool_execution_end');
  assert.equal(start?.data.toolName, 'sessions');
  assert.deepEqual(start?.data.args, { action: 'hosts' });
  assert.equal(end?.data.toolCallId, start?.data.toolCallId);
  assert.equal(end?.data.isError, false);
  const roles = bot.mirrorLines().filter(line => line.type === 'message').map(line => (line.message as Record<string, unknown>).role);
  assert.deepEqual(roles, ['user', 'assistant', 'toolResult', 'assistant']);
});

/** A sessions port for one worker that works for `busyPolls` polls, then answers. */
function workerSessions(busyPolls: number) {
  const calls: string[][] = [];
  let polls = 0;
  const port: SessionsPort = async args => {
    calls.push(args);
    if (args[0] === 'spawn') return JSON.stringify({ sessionId: 'worker-1', harness: 'pi' });
    if (args[0] === 'resolve') {
      polls++;
      return JSON.stringify({ session: { id: 'worker-1', isActive: true, turnInProgress: polls <= busyPolls } });
    }
    if (args[0] === 'show') {
      const done = polls > busyPolls;
      return JSON.stringify({ totalMessages: done ? 2 : 1, messages: [done
        ? { role: 'assistant', content: [{ type: 'text', text: 'WORKER-OK main' }] }
        : { role: 'user', content: 'brief' }] });
    }
    throw new Error(`unexpected ${args[0]}`);
  };
  return { port, calls, polls: () => polls };
}

test('spawn_worker returns the ref at once and the worker\u2019s answer arrives once as a report', async t => {
  const worker = workerSessions(2);
  const bot = await openTestBot(t, worker.port);
  bot.respond(
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('spawn_worker', { name: 'branch check', brief: 'Report the git branch.' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Started branch check as worker-1.'),
    (context) => bot.faux.fauxAssistantMessage(`Relayed: ${textOf(context.messages.at(-1))}`),
  );
  await bot.runtime.prompt('Which branch is checked out?', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message).startsWith('Relayed:')), 'the report is answered');
  const spawns = worker.calls.filter(args => args[0] === 'spawn');
  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].slice(0, 2), ['spawn', '--json']);
  assert.match(spawns[0][spawns[0].indexOf('--name') + 1], /^branch check · [0-9a-f]{8}$/);
  assert.equal(spawns[0][spawns[0].indexOf('--prompt') + 1], 'Report the git branch.');
  const result = bot.mirrorLines().find(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult');
  assert.match(textOf(result?.message), /Ref: worker-1/);
  const reports = bot.mirrorLines().filter(line => line.customType === 'bot-worker-report');
  assert.equal(reports.length, 1);
  assert.match(textOf(reports[0]), /^\[worker report\] "branch check" \(worker-1\) finished\.\n\nWORKER-OK main$/);
  assert.equal(bot.events.filter(event => event.event === 'agent_start').length, 2, 'the report starts its own run');
});

test('a relay restarted while a worker runs delivers the report once', async t => {
  let worker = workerSessions(1_000_000);
  const bot = await openTestBot(t, args => worker.port(args));
  bot.respond(
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('spawn_worker', { name: 'slow', brief: 'Take a while.' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Started slow.'),
  );
  await bot.runtime.prompt('Start the slow one', 'followUp');
  await until(() => worker.polls() >= 2, 'the watcher polls');
  // The worker finishes while the relay is down; the watcher resumes from storage.
  await bot.reopen(() => { worker = workerSessions(0); });
  bot.respond((context) => bot.faux.fauxAssistantMessage(`Relayed: ${textOf(context.messages.at(-1))}`));
  await until(() => bot.mirrorLines().filter(line => line.customType === 'bot-worker-report').length === 1, 'the report arrives', 15_000);
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message).startsWith('Relayed:')), 'the report is answered');
  // Nothing signals a report that never comes: give a duplicate the time of several polls to show up.
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(bot.mirrorLines().filter(line => line.customType === 'bot-worker-report').length, 1, 'never twice');
  assert.equal(worker.calls.filter(args => args[0] === 'spawn').length, 0, 'the worker is not launched again');
});

const WORKER_ID = '2026-11-20T10-07-13-963Z_01a1f86c-1111-4222-8333-444455556666';

/** A sessions port for one worker the test drives: it works until `answer`, and `close` stops it. */
function scriptedWorker() {
  const calls: string[][] = [];
  const state = { active: true, busy: true, messages: [{ role: 'user', content: 'brief' }] as Record<string, unknown>[] };
  const port: SessionsPort = async args => {
    calls.push(args);
    if (args[0] === 'spawn') return JSON.stringify({ sessionId: WORKER_ID, harness: 'pi' });
    if (args[0] === 'resolve') return JSON.stringify({ session: { id: WORKER_ID, isActive: state.active, turnInProgress: state.busy } });
    if (args[0] === 'show') return JSON.stringify({ totalMessages: state.messages.length, messages: state.messages.slice(-1) });
    if (args[0] === 'close') {
      state.active = false;
      state.busy = false;
      return '{"ok":true}';
    }
    throw new Error(`unexpected ${args[0]}`);
  };
  return {
    port, calls, state,
    polls: () => calls.filter(args => args[0] === 'resolve').length,
    answer(text: string) {
      state.messages.push({ role: 'assistant', content: [{ type: 'text', text }] });
      state.busy = false;
    },
  };
}

const reportsOf = (bot: Harness) => bot.mirrorLines().filter(line => line.customType === 'bot-worker-report').map(line => textOf(line));
const relay = (bot: Harness): Step => context => bot.faux.fauxAssistantMessage(`Relayed: ${textOf(context.messages.at(-1))}`);
// Nothing signals a report or poll that never comes: give one the time of several polls to show up.
const severalPolls = () => new Promise(resolve => setTimeout(resolve, 200));

test('a worker that settles again with new messages reports again, each report once, also across a restart', async t => {
  const worker = scriptedWorker();
  const bot = await openTestBot(t, worker.port);
  bot.respond(
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('spawn_worker', { name: 'clock', brief: 'sleep 75; date' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Started clock.'),
    relay(bot),
  );
  await bot.runtime.prompt('What time is it after a sleep?', 'followUp');
  await until(() => worker.polls() >= 1, 'the watcher polls');
  const started = bot.mirrorLines().find(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult');
  assert.match(textOf(started?.message), /Ref: 01a1f86c\./, 'the short ref, not the session id');
  worker.answer('⏳ running in the background');
  await until(() => reportsOf(bot).length === 1, 'the interim note is reported');
  assert.equal(reportsOf(bot)[0], '[worker report] "clock" (01a1f86c) finished.\n\n⏳ running in the background');
  // The watch goes on after a report.
  const after = worker.polls();
  await until(() => worker.polls() > after + 1, 'the watcher keeps polling');

  await bot.reopen(() => {
    worker.state.busy = true;
    worker.state.messages.push({ role: 'user', content: 'background job finished' });
    worker.answer('Fri Nov 20 12:01:15 UTC 2026');
  });
  bot.respond(relay(bot));
  await until(() => reportsOf(bot).length === 2, 'the real result is reported', 15_000);
  assert.equal(reportsOf(bot)[1], '[worker report] "clock" (01a1f86c) finished another turn.\n\nFri Nov 20 12:01:15 UTC 2026');
  await until(() => bot.mirrorLines().filter(line => line.type === 'message' && textOf(line.message).startsWith('Relayed:')).length === 2, 'both are answered');
  await severalPolls();
  assert.equal(reportsOf(bot).length, 2, 'each report once');
  assert.equal(worker.calls.filter(args => args[0] === 'spawn').length, 1);
});

test('a worker whose session closes ends the watch with a last report that says so', async t => {
  const worker = scriptedWorker();
  const bot = await openTestBot(t, worker.port);
  bot.respond(
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('spawn_worker', { name: 'check', brief: 'Check it.' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Started check.'),
    relay(bot),
    relay(bot),
  );
  await bot.runtime.prompt('Check it', 'followUp');
  await until(() => worker.polls() >= 1, 'the watcher polls');
  worker.answer('All good.');
  await until(() => reportsOf(bot).length === 1, 'the answer is reported');
  worker.state.active = false;
  await until(() => reportsOf(bot).length === 2, 'the close is reported');
  assert.equal(reportsOf(bot)[1], '[worker report] "check" (01a1f86c) has stopped.\n\nThe session is closed; it is no longer watched.');
  const polls = worker.polls();
  await severalPolls();
  assert.equal(worker.polls(), polls, 'no polls after the watch ends');
  assert.equal(reportsOf(bot).length, 2);
});

test('a bot closes a worker it started and is refused for any other ref', async t => {
  const worker = scriptedWorker();
  const bot = await openTestBot(t, worker.port);
  const call = (name: string, args: Record<string, string>) =>
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall(name, args)], { stopReason: 'toolUse' });
  bot.respond(
    call('spawn_worker', { name: 'check', brief: 'Check it.' }),
    bot.faux.fauxAssistantMessage('Started check.'),
    call('sessions', { action: 'close', ref: 'deadbeef' }),
    call('sessions', { action: 'close', ref: '01a1f86c' }),
    bot.faux.fauxAssistantMessage('Closed it.'),
  );
  await bot.runtime.prompt('Check it', 'followUp');
  await until(() => worker.polls() >= 1, 'the watcher polls');
  worker.answer('All good.');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'Closed it.'), 'the bot closes its worker');
  const results = bot.mirrorLines().filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult')
    .map(line => line.message as Record<string, unknown>);
  assert.equal(results[1].isError, true);
  assert.match(textOf(results[1]), /^Refused: deadbeef is not a worker you started.*Open workers: 01a1f86c\.$/);
  assert.equal(results[2].isError, false);
  assert.equal(textOf(results[2]), 'Closed worker "check" (01a1f86c).');
  assert.deepEqual(worker.calls.filter(args => args[0] === 'close'), [['close', '01a1f86c']], 'only its own worker is closed');
  const polls = worker.polls();
  await severalPolls();
  assert.equal(worker.polls(), polls, 'the watch has ended');
  assert.equal(reportsOf(bot).length, 1, 'its own close is not reported back');
});

test('the settle rule waits for the turn to end and for new messages', () => {
  const finished = { totalMessages: 4, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }] };
  assert.equal(settledWorker({ isActive: true, turnInProgress: true }, finished, 0), null, 'still working');
  assert.equal(settledWorker({ isActive: true, compacting: true }, finished, 0), null, 'compacting');
  assert.deepEqual(settledWorker({ isActive: true }, finished, 0), { state: 'finished', totalMessages: 4, text: 'done' });
  assert.equal(settledWorker({ isActive: true }, finished, 4), null, 'nothing new since the count');
  assert.equal(settledWorker({ isActive: true }, { totalMessages: 1, messages: [{ role: 'user', content: 'go' }] }, 0), null,
    'a prompt not picked up yet');
  assert.equal(settledWorker({ isActive: true, askPending: true }, finished, 0)?.state, 'waiting');
  assert.equal(settledWorker({ isActive: false }, { totalMessages: 0, messages: [] }, 0)?.state, 'inactive');
  assert.equal(settledWorker({ isActive: true, messageCount: 1 }, { totalMessages: 0, messages: [] }, 0), null,
    'the resolve row\u2019s messageCount decides nothing');
});

test('new_context is refused without a saved notebook or new work', () => {
  const memory = { notebook: '', notebookSavedIn: -1, windows: [], workers: {} };
  assert.match(String(newContextRefusal(memory, true)), /notebook is empty/);
  assert.match(String(newContextRefusal({ ...memory, notebook: 'x', notebookSavedIn: 0, windows: [{ line: 'a', closedAt: '', forced: false }] }, true)),
    /not saved your notebook in this window/);
  assert.match(String(newContextRefusal({ ...memory, notebook: 'x', notebookSavedIn: 0 }, false)), /nothing has happened since/);
  assert.equal(newContextRefusal({ ...memory, notebook: 'x', notebookSavedIn: 0 }, true), null);
  const handoff = composeHandoff({ windowNumber: 2, closed: [{ line: 'Set up tycho', closedAt: '', forced: false }],
    tail: [{ role: 'user', text: 'and the backups?' }], request: 'and the backups?', workers: [] });
  assert.match(handoff, /Context window 2/);
  assert.match(handoff, /1\. Set up tycho/);
  assert.match(handoff, /Latest request: and the backups\?/);
});

function systemText(messages: Message[]): string {
  return JSON.stringify(messages.filter(message => (message.role as string) === 'system'));
}

test('new_context opens a window holding the identity, the notebook and the recent tail; history reads the old one', async t => {
  const bot = await openTestBot(t, noSessions);
  const call = (name: string, args: Record<string, string>) =>
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall(name, args)], { stopReason: 'toolUse' });
  bot.respond(
    call('new_context', { summary: 'too early' }),
    call('context_notes', { action: 'write', text: 'tycho runs the backups.' }),
    call('new_context', { summary: 'Learned where backups run' }),
    call('new_context', { summary: 'again' }),
    call('context_notes', { action: 'write', text: 'tycho runs the backups.' }),
    call('new_context', { summary: 'again' }),
    bot.faux.fauxAssistantMessage('Done.'),
    call('history', { action: 'search', query: 'backups' }),
    bot.faux.fauxAssistantMessage('Found it.'),
  );
  await bot.runtime.prompt('Where do backups run? It is tycho.', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'Done.'), 'the run answers');
  const results = bot.mirrorLines().filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult')
    .map(line => textOf(line.message));
  assert.match(results[0], /notebook is empty/);
  assert.match(results[1], /^Saved/);
  assert.match(results[2], /new context window starts/);
  assert.match(results[3], /not saved your notebook in this window/, 'the new window needs its own save');
  assert.match(results[4], /^Saved/);
  assert.match(results[5], /nothing has happened since/, 'a second rollover right away is refused');

  // The request after the rollover: the new instructions and the handoff, nothing of the old window.
  const next = bot.requests[3];
  assert.match(systemText(next), /You are Fleet, the contact for the fleet\./);
  assert.match(systemText(next), /tycho runs the backups\./);
  const handoff = next.find(message => message.role === 'user');
  assert.match(textOf(handoff), /Context window 2/);
  assert.match(textOf(handoff), /1\. Learned where backups run/);
  assert.match(textOf(handoff), /Latest request: Where do backups run\? It is tycho\./);
  assert.ok(!next.some(message => message.role === 'toolResult' && textOf(message).includes('notebook is empty')), 'the old window is gone');
  assert.ok(bot.mirrorLines().some(line => line.customType === 'bot-context-window'));

  await bot.runtime.prompt('Search your history', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'Found it.'), 'history answers');
  const search = bot.mirrorLines().filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult').at(-1);
  assert.match(textOf(search?.message), /window 1: …\[user\] Where do backups run\?/);
});

test('a full window carries a reminder and is rolled over when the run ends', async t => {
  const bot = await openTestBot(t, noSessions, { contextWindow: 10 });
  bot.respond(
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('context_notes', { action: 'write', text: 'Keep me.' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Noted.'),
    bot.faux.fauxAssistantMessage('Fresh window.'),
  );
  await bot.runtime.prompt('Remember this', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.customType === 'bot-context-window'), 'the window is rolled over');
  assert.match(textOf(bot.requests[1].at(-1)), /^\[pi-dish: this context window is \d+% full/);
  const marker = bot.mirrorLines().find(line => line.customType === 'bot-context-window');
  assert.match(textOf(marker), /1\. Closed at the context limit\. \(closed at the context limit\)/);
  await bot.runtime.prompt('Still there?', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'Fresh window.'), 'the next run answers');
  assert.match(systemText(bot.requests[2]), /Keep me\./);
});
