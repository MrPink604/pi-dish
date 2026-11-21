// A bot's runtime on pi-ai's faux provider: no live model, no live session.
// The sessions port stands in for the pi-dish-sessions CLI.
import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import type { BotRegistry, BotRow } from '../lib/bot-registry';
import type { BotControl, BotHandlers } from '../lib/bot-handlers';
import type { RouteHandler } from '../lib/http-boundary';
import type { BotRuntime, HubApi, SessionsPort, WorkerRecord } from '../lib/bot-runtime';
const { BotMirror }: typeof import('../lib/bot-mirror') = require('../lib/bot-mirror');
const runtimeModule: typeof import('../lib/bot-runtime') = require('../lib/bot-runtime');
const { openBotRuntime, settledWorker, newContextRefusal, composeHandoff, workerRefMatches, findOwnedWorker } = runtimeModule;
const { openBotRegistry }: typeof import('../lib/bot-registry') = require('../lib/bot-registry');
const { createBotHandlers, changeLines, ROOM_HOP_CAP }: typeof import('../lib/bot-handlers') = require('../lib/bot-handlers');

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

interface TestBotOptions {
  contextWindow?: number;
  api?: HubApi;
  /** A bots directory shared with other bots, as a parent and its sub-bot share one; the caller removes it. */
  botsDir?: string;
  /** The bot's registry row, read again whenever the runtime asks; Fleet by default. */
  row?: () => BotRow;
  /** Responses queued before the bot opens, for a bot that starts a run as it opens. */
  responses?: (faux: Faux) => Step[];
  /** How often a worker's watch polls; a long first poll stands for a worker no watch looks at. */
  pollMs?: { first: number; max: number };
  /** A code mode script's time cap. */
  scriptTimeoutMs?: number;
  /** A directory whose `durable.sqlite` and `mirror.jsonl` the bot starts from: state an earlier version stored. */
  from?: string;
}

async function openTestBot(t: test.TestContext, sessions: SessionsPort,
  { contextWindow = 200_000, api = noApi, botsDir, row = () => BOT, responses, pollMs = { first: 20, max: 40 }, scriptTimeoutMs, from }: TestBotOptions = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bot-'));
  const faux: Faux = await import('@earendil-works/pi-ai/providers/faux');
  const { createModels } = await import('@earendil-works/pi-ai/models');
  // faux-2 is a second model for a bot told to run on another one.
  const provider = faux.fauxProvider({ models: [{ id: 'faux-1', contextWindow }, { id: 'faux-2', contextWindow }] });
  const models = createModels();
  models.setProvider(provider.provider);
  const requests: Message[][] = [];
  const events: Harness['events'] = [];
  const bot = row();
  const mirrorFile = path.join(dir, 'sessions', `${bot.id}.jsonl`);
  if (from) {
    fs.mkdirSync(path.dirname(mirrorFile), { recursive: true });
    fs.copyFileSync(path.join(from, 'durable.sqlite'), path.join(dir, 'durable.sqlite'));
    fs.copyFileSync(path.join(from, 'mirror.jsonl'), mirrorFile);
  }
  const open = () => openBotRuntime({
    bot: row(), storageFile: botsDir ? path.join(botsDir, bot.id, 'durable.sqlite') : path.join(dir, 'durable.sqlite'),
    botsDir: botsDir ?? path.join(dir, 'bots'),
    mirror: new BotMirror(mirrorFile, { id: bot.id, cwd: dir, name: bot.name }),
    models, sessions, api, loadBot: row,
    emit: (event, data) => events.push({ event, data }),
    changed: () => {}, log: () => {}, pollMs, scriptTimeoutMs,
  });
  const recorded = (step: Step): Step => (context, ...rest) => {
    requests.push([...context.messages]);
    return typeof step === 'function' ? step(context, ...rest) : step;
  };
  if (responses) provider.appendResponses(responses(faux).map(recorded));
  const harness: Harness = {
    runtime: await open(), events, requests, faux,
    mirrorLines: () => fs.readFileSync(mirrorFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>),
    respond: (...steps) => provider.appendResponses(steps.map(recorded)),
    async reopen(between) { await harness.runtime.close(); between?.(); harness.runtime = await open(); },
  };
  t.after(async () => { await harness.runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return harness;
}

const noSessions: SessionsPort = async args => { throw new Error(`unexpected sessions call: ${args.join(' ')}`); };
const noApi: HubApi = async path => { throw new Error(`unexpected API call: ${path}`); };

test('kb_search, kb_read and kb_write reach the knowledge routes, and a write carries the bot\u2019s name', async t => {
  const calls: [string, unknown][] = [];
  const api: HubApi = async (path, body) => {
    calls.push([path, body]);
    if (path.startsWith('/api/knowledge/search')) {
      return { total: 1, results: [{ path: 'topics/backups.md', lines: [{ line: 3, text: 'Backups go to aeor nightly.' }] }] };
    }
    if (path === '/api/knowledge/page') return { path: 'index.md', text: '# Knowledge\n\n- [Backups](topics/backups.md)\n' };
    return { path: 'topics/tycho.md', created: true, commit: 'abc', pushed: false, pushError: 'git push: unreachable' };
  };
  const bot = await openTestBot(t, noSessions, { api });
  const call = (name: string, args: Record<string, string>) =>
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall(name, args)], { stopReason: 'toolUse' });
  bot.respond(
    call('kb_search', { query: 'backups aeor' }),
    call('kb_read', {}),
    call('kb_write', { page: 'tycho', text: 'tycho has the GPU.', source: 'nvidia-smi on tycho' }),
    bot.faux.fauxAssistantMessage('Noted.'),
  );
  await bot.runtime.prompt('Where do backups go, and remember tycho has the GPU', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'Noted.'), 'the run answers');
  assert.deepEqual(calls, [
    ['/api/knowledge/search?q=backups%20aeor', undefined],
    ['/api/knowledge/page', undefined],
    ['/api/knowledge/pages', { page: 'tycho', mode: 'append', text: 'tycho has the GPU.', author: 'Fleet', source: 'nvidia-smi on tycho' }],
  ]);
  const results = bot.mirrorLines().filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult')
    .map(line => textOf(line.message));
  assert.equal(results[0], 'topics/backups.md\n  3: Backups go to aeor nightly.');
  assert.equal(results[1], 'index.md:\n\n# Knowledge\n\n- [Backups](topics/backups.md)\n');
  assert.equal(results[2], 'Saved: topics/tycho.md (a new page, added to the index). It is not on the remote yet (git push: unreachable); the next write pushes it.');
});

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
  const bot = await openTestBot(t, async args => {
    calls.push(args);
    return args.includes('--json') ? JSON.stringify({ hosts: [{ self: true, name: null, label: 'beelink', reachable: true, capabilities: {} }] }) : 'beelink\treachable\tself\n';
  });
  bot.respond(
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('sessions', { action: 'hosts' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('One host: beelink.'),
  );
  await bot.runtime.prompt('Which hosts?', 'followUp');
  await until(() => bot.events.some(event => event.event === 'agent_end'), 'the run ends');
  // The model reads the CLI's text; the JSON is the value a script would get.
  assert.deepEqual(calls.sort(), [['hosts'], ['hosts', '--json']]);
  const result = bot.mirrorLines().find(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult');
  assert.equal(textOf(result?.message), 'beelink\treachable\tself');
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

const workerRecord = (sessionId: string, host: string | null, ref = host ? `${host}/${sessionId}` : sessionId): WorkerRecord => ({
  name: sessionId, ref, sessionId, harness: 'pi', host, startedAt: '', reports: 0,
});

test('worker ownership resolves full, unique, host-qualified and disambiguated refs without crossing hosts', () => {
  const desktopA = workerRecord('2026-11-21T02-49-16-118Z_01a1fc02-1055-722e-84fc-ff1a34d00ade', 'desktop', 'desktop/01a1fc02');
  const desktopB = workerRecord('2026-11-21T02-49-16-119Z_01a1fc02-2055-722e-84fc-ff1a34d00ade', 'desktop', 'desktop/01a1fc02');
  const beelink = workerRecord('2026-11-21T02-49-16-120Z_01a1fc02-3055-722e-84fc-ff1a34d00ade', 'beelink', '01a1fc02');
  const memory = { notebook: '', notebookSavedIn: -1, windows: [], workers: { a: desktopA, b: desktopB, c: beelink } };

  assert.equal(workerRefMatches(desktopA, desktopA.sessionId), true);
  assert.equal(workerRefMatches(desktopA, `desktop/${desktopA.sessionId}`), true);
  assert.equal(workerRefMatches(beelink, 'beelink/01a1fc02'), true);
  assert.equal(workerRefMatches(desktopA, 'beelink/01a1fc02'), false);
  assert.equal(findOwnedWorker(memory, desktopA.sessionId)?.[0], 'a');
  assert.equal(findOwnedWorker(memory, 'desktop/01a1fc02'), undefined, 'an old short ref is refused when that host is ambiguous');
  assert.equal(findOwnedWorker(memory, 'desktop/01a1fc02-0')?.[0], 'a');
  assert.equal(findOwnedWorker(memory, 'desktop/01a1fc02-1')?.[0], 'b');
  assert.equal(findOwnedWorker(memory, 'beelink/01a1fc02')?.[0], 'c', 'a legacy short ref remains usable when unique on its host');
});

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
  assert.match(textOf(started?.message), new RegExp(`Ref: ${WORKER_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`), 'the full session id is the durable ref');
  worker.answer('⏳ running in the background');
  await until(() => reportsOf(bot).length === 1, 'the interim note is reported');
  assert.equal(reportsOf(bot)[0], `[worker report] "clock" (${WORKER_ID}) finished.\n\n⏳ running in the background`);
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
  assert.equal(reportsOf(bot)[1], `[worker report] "clock" (${WORKER_ID}) finished another turn.\n\nFri Nov 20 12:01:15 UTC 2026`);
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
  assert.equal(reportsOf(bot)[1], `[worker report] "check" (${WORKER_ID}) has stopped.\n\nThe session is closed; it is no longer watched.`);
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
  assert.match(textOf(results[1]), new RegExp(`^Refused: deadbeef is not a worker you started.*Open workers: ${WORKER_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.$`));
  assert.equal(results[2].isError, false);
  assert.equal(textOf(results[2]), `Closed worker "check" (${WORKER_ID}).`);
  assert.deepEqual(worker.calls.filter(args => args[0] === 'close'), [['close', WORKER_ID]], 'only its own worker is closed');
  // The watch ends on the first poll that sees the closed session, and that poll may still be due.
  await severalPolls();
  const polls = worker.polls();
  await severalPolls();
  assert.equal(worker.polls(), polls, 'the watch has ended');
  assert.equal(reportsOf(bot).length, 1, 'its own close is not reported back');
});

test('a bot closes its worker through every equivalent ref form', async t => {
  for (const ref of [WORKER_ID, `desktop/${WORKER_ID}`, 'desktop/01a1f86c', 'desktop/01a1f86c-0']) {
    const worker = scriptedWorker();
    const bot = await openTestBot(t, worker.port);
    bot.respond(
      toolCall(bot, 'spawn_worker', { name: 'check', brief: 'Check it.', host: 'desktop' }), bot.faux.fauxAssistantMessage('Started check.'),
      toolCall(bot, 'sessions', { action: 'close', ref }), bot.faux.fauxAssistantMessage('Closed it.'),
    );
    await bot.runtime.prompt(`Close ${ref}`, 'followUp');
    await until(() => worker.polls() >= 1, `the watcher polls for ${ref}`);
    worker.answer('All good.');
    await until(() => said(bot, 'Closed it.'), `the bot closes ${ref}`);
    assert.deepEqual(worker.calls.filter(args => args[0] === 'close'), [['close', `desktop/${WORKER_ID}`]], ref);
  }
});

test('closing an own worker that was already closed from outside marks it closed, and a close that fails otherwise does not', async t => {
  const state = { active: true };
  const port: SessionsPort = async args => {
    if (args[0] === 'spawn') return JSON.stringify({ sessionId: WORKER_ID, harness: 'pi' });
    if (args[0] === 'resolve') return JSON.stringify({ session: { id: WORKER_ID, isActive: state.active, turnInProgress: true } });
    if (args[0] === 'close') throw new Error(state.active ? 'pi-dish is restarting' : 'Session not active');
    throw new Error(`unexpected ${args[0]}`);
  };
  // No watch looks at this worker while the test runs, as for one carried over from before workers were watched until closed.
  const bot = await openTestBot(t, port, { pollMs: { first: 600_000, max: 600_000 } });
  const close = (ref: string) => toolCall(bot, 'sessions', { action: 'close', ref });
  bot.respond(
    toolCall(bot, 'spawn_worker', { name: 'check', brief: 'Check it.' }), bot.faux.fauxAssistantMessage('Started check.'),
    close('01a1f86c'), bot.faux.fauxAssistantMessage('The close failed.'),
    close('01a1f86c'), close('deadbeef'), bot.faux.fauxAssistantMessage('It was closed already.'),
  );
  await bot.runtime.prompt('Check it', 'followUp');
  await until(() => said(bot, 'Started check.'), 'the worker starts');
  await bot.runtime.prompt('Close it', 'followUp');
  await until(() => said(bot, 'The close failed.'), 'the first close fails');
  state.active = false;
  await bot.runtime.prompt('I closed it myself; close it on your side', 'followUp');
  await until(() => said(bot, 'It was closed already.'), 'the second close');
  const results = toolResults(bot);
  assert.equal(results[1].isError, true);
  assert.match(textOf(results[1]), /pi-dish is restarting/, 'a worker still running stays open');
  assert.notEqual(results[2].isError, true);
  assert.equal(textOf(results[2]), `Worker "check" (${WORKER_ID}) had already been closed; it is now marked closed in your records.`);
  assert.match(textOf(results[3]), /Open workers: none\.$/, 'it is no longer among the open workers');
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
    tail: [{ role: 'user', text: 'and the backups?' }], request: 'and the backups?', workers: [], forced: true });
  assert.match(handoff, /Context window 2/);
  assert.match(handoff, /1\. Set up tycho/);
  assert.match(handoff, /Latest request: and the backups\?/);
  assert.match(handoff, /answered in the last window/);
});

test('a rollover the user asked for is handed over as done, not as a request to roll over again', async t => {
  const bot = await openTestBot(t, noSessions);
  const call = (name: string, args: Record<string, string>) =>
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall(name, args)], { stopReason: 'toolUse' });
  bot.respond(
    call('context_notes', { action: 'write', text: 'Nothing pending.' }),
    call('new_context', { summary: 'Rolled over on request' }),
    // The model reads the handoff wrongly and tries again; the refusal says the rollover is done.
    call('new_context', { summary: 'again' }),
    bot.faux.fauxAssistantMessage('The new window is open.'),
  );
  await bot.runtime.prompt('Start a new context window', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'The new window is open.'), 'the run answers');
  const handoff = textOf(bot.requests[2].find(message => message.role === 'user'));
  assert.match(handoff, /Latest request: Start a new context window\nYou opened this window with new_context while handling it, and that call is done/);
  const results = bot.mirrorLines().filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult')
    .map(line => textOf(line.message));
  assert.match(results[2], /^Refused: nothing has happened since the last new window, so this is already the new window/);
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
  assert.match(results[3], /nothing has happened since/, 'right after a rollover, the rollover is done');
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

test('bot_update records the change against the turn, shows it with what an undo needs, and refuses the bot its own model', async t => {
  const calls: [string, unknown][] = [];
  const api: HubApi = async (path, body) => {
    calls.push([path, body]);
    const changes = (body as { changes: Record<string, unknown> }).changes;
    const after = { ...BOT, ...changes, revision: 2 };
    const fields = Object.keys(changes);
    return { bot: after, revision: 2, fields, before: BOT, lines: changeLines(fields, BOT, after, id => id), moved: [] };
  };
  const bot = await openTestBot(t, noSessions, { api });
  const call = (args: Record<string, string>) =>
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('bot_update', args)], { stopReason: 'toolUse' });
  bot.respond(
    call({ name: 'Armada', identity: 'You are Armada.' }),
    call({ model: 'faux/faux-2' }),
    bot.faux.fauxAssistantMessage('Renamed; the model is yours to change.'),
  );
  await bot.runtime.prompt('Call yourself Armada, and switch to faux-2', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message).startsWith('Renamed')), 'the run answers');
  assert.equal(calls.length, 1, 'the model change never reaches the hub');
  const [path, body] = calls[0] as [string, { by: string; turn: string; changes: unknown }];
  assert.equal(path, `/api/bots/${BOT.id}/edit`);
  assert.equal(body.by, BOT.id);
  const prompt = bot.mirrorLines().find(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'user');
  assert.equal(body.turn, `${BOT.id}/${String(prompt?.id).replace(/^bot-/, '')}`, 'the turn is the input that started the run');
  const results = bot.mirrorLines().filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult')
    .map(line => line.message as Record<string, unknown>);
  assert.match(textOf(results[0]), /^Changed your entry \(revision 2\):\nname: "Fleet" → "Armada"\nidentity: 41 characters → 15 characters\nThe new identity takes effect at your next context window/);
  assert.equal(results[1].isError, true);
  assert.match(textOf(results[1]), /you cannot change your own model.*only they can/);
  const change = bot.mirrorLines().find(line => line.customType === 'bot-change');
  assert.deepEqual(change?.details, {
    botId: BOT.id, botName: 'Armada', revision: 2, fields: ['name', 'identity'],
    lines: ['name: "Fleet" → "Armada"', 'identity: 41 characters → 15 characters'],
  });
  assert.ok(bot.events.some(event => event.event === 'message_end' && (event.data.message as Record<string, unknown>).customType === 'bot-change'));
});

function tempRegistry(t: test.TestContext): BotRegistry {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bots-'));
  const registry = openBotRegistry(path.join(dir, 'bots.sqlite'));
  t.after(() => { registry.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return registry;
}

const newBot = (registry: BotRegistry, name: string, parentId: string | null = null): BotRow =>
  registry.create({ name, identity: `You are ${name}.`, model: 'faux/faux-1', parentId }, { actor: 'user' });

async function callRoute(handler: RouteHandler, params: Record<string, string>, body: unknown, query: Record<string, string>) {
  let status = 200;
  let sent: unknown;
  const res = { status(code: number) { status = code; return res; }, json(value: unknown) { sent = value; return res; } };
  await handler({ params, body, query } as never, res as never, () => {});
  return { status, body: sent as Record<string, unknown> };
}

/** pi-dish's bot routes as a relay reaches them: an error answer throws its message, as the relay's fetch does. */
function hubOf(handlers: BotHandlers, calls: [string, unknown][] = []): HubApi {
  return async (pathname, body) => {
    calls.push([pathname, body]);
    const url = new URL(pathname, 'http://hub');
    const [api, bots, id, action, other] = url.pathname.split('/').filter(Boolean);
    const handler = api !== 'api' || bots !== 'bots' ? undefined
      : !id ? (body ? handlers.create : handlers.list)
        : action === 'room' ? (body ? handlers.roomPost : handlers.roomRead)
          : action === 'roster' ? (other ? handlers.rosterShow : handlers.roster)
            : action === 'edit' ? handlers.edit
              : action === 'ask' ? handlers.ask : action === 'answer' ? handlers.answer : undefined;
    if (!handler) throw new Error(`unexpected API call: ${pathname}`);
    const params = { ...(id ? { id: decodeURIComponent(id) } : {}), ...(other ? { bot: decodeURIComponent(other) } : {}) };
    const answer = await callRoute(handler, params, body ?? {}, Object.fromEntries(url.searchParams));
    if (answer.status >= 400) throw new Error(String(answer.body.error));
    return answer.body;
  };
}

type Delivery = { to: string; kind: string; hop: number };

/** Hands deliveries to the bots running in this process, as pi-dish hands them to their relays. */
function botControl(running: Map<string, Harness>, deliveries: Delivery[], start: (bot: BotRow) => Promise<void> = async () => {}, stop: (bot: BotRow) => Promise<void> = async () => {}): BotControl {
  return {
    start, stop, route: id => id,
    async deliver(bot, delivery) {
      deliveries.push({ to: bot.name, kind: delivery.kind, hop: delivery.data.hop });
      const harness = running.get(bot.id);
      if (!harness) return false;
      await harness.runtime.deliver(delivery);
      return true;
    },
    state: bot => ({ running: running.has(bot.id), lastTurnAt: running.has(bot.id) ? '2026-11-20T10:00:00.000Z' : null }),
  };
}

const toolCall = (bot: Harness, name: string, args: Record<string, string | string[]>) =>
  bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall(name, args)], { stopReason: 'toolUse' });
const said = (bot: Harness, text: string) => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === text);
const toolResults = (bot: Harness) => bot.mirrorLines()
  .filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult')
  .map(line => line.message as Record<string, unknown>);
const customs = (bot: Harness, type: string) => bot.mirrorLines().filter(line => line.customType === type).map(line => textOf(line));

test('a sub-bot starts from its parent\u2019s last request plus its purpose, leaves the parent\u2019s worker to it, and takes its own identity and notebook at its first rollover', async t => {
  const registry = tempRegistry(t);
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bots-dir-'));
  t.after(() => fs.rmSync(botsDir, { recursive: true, force: true }));
  const personal = registry.create({ name: 'Personal', identity: 'You are Personal, the contact for personal matters.', model: 'faux/faux-1' }, { actor: 'user' });
  const worker = scriptedWorker();
  const childCalls: string[][] = [];
  let child: Harness | undefined;
  const hub: HubApi = (pathname, body) => routes(pathname, body);
  const routes = hubOf(createBotHandlers(() => registry, botControl(new Map(), [], async row => {
    child = await openTestBot(t, async args => { childCalls.push(args); throw new Error('a sub-bot has no workers of its own here'); }, {
      botsDir, row: () => registry.get(row.id)!, api: hub,
      responses: faux => [
        faux.fauxAssistantMessage([faux.fauxToolCall('context_notes', { action: 'read' })], { stopReason: 'toolUse' }),
        faux.fauxAssistantMessage('On it.'),
      ],
    });
  })));
  const parent = await openTestBot(t, worker.port, { botsDir, row: () => registry.get(personal.id)!, api: hub });
  parent.respond(
    // The parent forks from its second window, so the copy starts at a rollover.
    toolCall(parent, 'context_notes', { action: 'write', text: 'The dentist is on Friday.' }),
    toolCall(parent, 'new_context', { summary: 'Noted the dentist' }),
    toolCall(parent, 'spawn_worker', { name: 'clock', brief: 'sleep 75; date' }),
    parent.faux.fauxAssistantMessage('Started clock.'),
    toolCall(parent, 'bot_create', { name: 'Medical', purpose: 'Keep track of appointments.', identity: 'You are Medical, the contact for appointments.' }),
    parent.faux.fauxAssistantMessage('Created Medical.'),
    relay(parent),
  );
  await parent.runtime.prompt('Note the dentist and time a sleep', 'followUp');
  await until(() => said(parent, 'Started clock.') && worker.polls() >= 1, 'the parent watches its worker');
  await parent.runtime.prompt('Make a sub-bot for medical things', 'followUp');
  await until(() => !!child && said(child, 'On it.') && said(parent, 'Created Medical.'), 'the sub-bot answers its purpose');
  const sub = child!;

  // Its first request is the parent's last one, message for message, with the purpose after it.
  const first = sub.requests[0];
  // Its system messages carry the instructions and the tools, so those are the parent's too.
  assert.deepStrictEqual(first.slice(0, -1), parent.requests[4]);
  assert.match(systemText(first), /The dentist is on Friday\./, 'the parent\u2019s notebook, in the parent\u2019s instructions');
  assert.equal(first.at(-1)?.role, 'user');
  assert.match(textOf(first.at(-1)), /^\[pi-dish: you are "Medical", a new bot that Personal created just now/);
  assert.match(textOf(first.at(-1)), /Your purpose, from Personal:\nKeep track of appointments\.$/);
  const medical = registry.list().find(row => row.name === 'Medical')!;
  assert.equal(medical.parentId, personal.id);
  assert.equal(medical.model, personal.model);
  assert.ok(!fs.existsSync(path.join(botsDir, medical.id, 'fork.json')), 'the start is read once');
  assert.match(textOf(toolResults(parent).at(-1)), /^Created sub-bot "Medical"/);
  // Its chat starts at a marker, not with the parent's conversation; its notebook is its own and empty.
  assert.deepEqual(sub.mirrorLines().filter(line => line.customType).map(line => line.customType), ['bot-forked', 'bot-purpose']);
  assert.ok(!sub.mirrorLines().some(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'user'));
  assert.equal(textOf(toolResults(sub)[0]), '(the notebook is empty)');

  // The parent's worker reports once, to the parent only.
  worker.answer('Fri Nov 20 12:01:15 UTC 2026');
  await until(() => reportsOf(parent).length === 1 && parent.mirrorLines().some(line => line.type === 'message' && textOf(line.message).startsWith('Relayed:')), 'the parent hears its worker');
  await severalPolls();
  assert.equal(reportsOf(parent).length, 1);
  assert.deepEqual(reportsOf(sub), []);
  assert.deepEqual(childCalls, [], 'the sub-bot never watches the parent\u2019s worker');

  // Its first rollover brings its own identity and notebook.
  sub.respond(
    toolCall(sub, 'context_notes', { action: 'write', text: 'Appointments: none yet.' }),
    toolCall(sub, 'new_context', { summary: 'Started from Personal' }),
    sub.faux.fauxAssistantMessage('Fresh window.'),
  );
  await sub.runtime.prompt('Open your own window now', 'followUp');
  await until(() => said(sub, 'Fresh window.'), 'the sub-bot rolls over');
  const fresh = systemText(sub.requests.at(-1)!);
  assert.match(fresh, /You are Medical, the contact for appointments\./);
  assert.match(fresh, /Appointments: none yet\./);
  assert.doesNotMatch(fresh, /You are Personal|The dentist is on Friday/);
});

test('a room post wakes only the bots it names, and a chain of replies is refused past the hop cap', async t => {
  const registry = tempRegistry(t);
  const top = newBot(registry, 'Personal');
  const medical = newBot(registry, 'Medical', top.id);
  const dental = newBot(registry, 'Dental', top.id);
  const running = new Map<string, Harness>();
  const deliveries: Delivery[] = [];
  const hub = hubOf(createBotHandlers(() => registry, botControl(running, deliveries)));
  const parent = await openTestBot(t, noSessions, { row: () => registry.get(top.id)!, api: hub });
  const child = await openTestBot(t, noSessions, { row: () => registry.get(medical.id)!, api: hub });
  running.set(top.id, parent);
  running.set(medical.id, child);
  const post = (bot: Harness, to: string, message: string) => toolCall(bot, 'room_post', { to: [to], message });
  parent.respond(
    post(parent, 'Medical', 'hop one'), parent.faux.fauxAssistantMessage('Posted.'),
    post(parent, 'medical', 'hop three'), parent.faux.fauxAssistantMessage('Posted again.'),
    post(parent, 'Medical', 'hop five'), parent.faux.fauxAssistantMessage('Stopped at the cap.'),
  );
  child.respond(
    post(child, 'Personal', 'hop two'), child.faux.fauxAssistantMessage('Replied.'),
    post(child, 'Personal', 'hop four'), child.faux.fauxAssistantMessage('Replied again.'),
  );
  await parent.runtime.prompt('Check in with Medical', 'followUp');
  await until(() => said(parent, 'Stopped at the cap.') && said(child, 'Replied again.'), 'the chain ends at the cap');

  const messages = registry.room(top.id, 10);
  assert.deepEqual(messages.map(message => [message.text, message.hop]), [['hop one', 1], ['hop two', 2], ['hop three', 3], ['hop four', 4]]);
  assert.equal(new Set(messages.map(message => message.chain)).size, 1, 'one chain, started by the user\u2019s turn');
  assert.match(messages[0].chain, new RegExp(`^${top.id}/\\d+$`));
  assert.deepEqual(deliveries.map(delivery => delivery.to), ['Medical', 'Personal', 'Medical', 'Personal'], 'Dental is never woken');
  const refused = toolResults(parent).at(-1)!;
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), new RegExp(`has reached ${ROOM_HOP_CAP} hops, the cap`));
  assert.deepEqual(customs(child, 'bot-room').map(text => text.split('\n')[0]), ['[room] Personal to Medical: hop one', '[room] Personal to Medical: hop three']);
  assert.equal(customs(parent, 'bot-room').length, 2);
  // Any bot in the family reads the room, also one that was not named.
  const read = await hub(`/api/bots/${dental.id}/room?limit=10`) as { messages: { fromName: string; toNames: string[] }[] };
  assert.deepEqual(read.messages.map(message => `${message.fromName}>${message.toNames.join(',')}`),
    ['Personal>Medical', 'Medical>Personal', 'Personal>Medical', 'Medical>Personal']);
});

test('ask_bot puts a question to a bot in another family and brings its answer back once', async t => {
  const registry = tempRegistry(t);
  const fleet = newBot(registry, 'Fleet');
  const osbg = newBot(registry, 'OSBG');
  const running = new Map<string, Harness>();
  const deliveries: Delivery[] = [];
  const calls: [string, unknown][] = [];
  const hub = hubOf(createBotHandlers(() => registry, botControl(running, deliveries)), calls);
  const asker = await openTestBot(t, noSessions, { row: () => registry.get(osbg.id)!, api: hub });
  const asked = await openTestBot(t, noSessions, { row: () => registry.get(fleet.id)!, api: hub });
  running.set(osbg.id, asker);
  running.set(fleet.id, asked);
  asker.respond(toolCall(asker, 'ask_bot', { bot: 'Fleet', question: 'Which host has the GPU?' }), asker.faux.fauxAssistantMessage('Asked Fleet.'), relay(asker));
  asked.respond(asked.faux.fauxAssistantMessage('tycho has the GPU.'), asked.faux.fauxAssistantMessage('Nothing else.'));
  await asker.runtime.prompt('Ask Fleet where the GPU is', 'followUp');
  await until(() => asker.mirrorLines().some(line => line.type === 'message' && textOf(line.message).startsWith('Relayed:')), 'the answer arrives');
  assert.match(textOf(toolResults(asker)[0]), /^Asked Fleet\./);
  assert.deepEqual(customs(asked, 'bot-question').map(text => text.split('\n')[0]), ['[question from OSBG, a bot in another family] Which host has the GPU?']);
  assert.deepEqual(customs(asker, 'bot-answer'), ['[answer from Fleet] to your question "Which host has the GPU?": tycho has the GPU.']);
  assert.deepEqual(deliveries.map(delivery => [delivery.to, delivery.kind, delivery.hop]), [['Fleet', 'ask', 1], ['OSBG', 'answer', 2]]);

  // Later runs of the bot asked, also after a restart, send nothing again.
  await asked.reopen();
  await asked.runtime.prompt('Anything else?', 'followUp');
  await until(() => said(asked, 'Nothing else.'), 'the next run ends');
  await severalPolls();
  assert.equal(customs(asker, 'bot-answer').length, 1);
  assert.equal(calls.filter(([pathname]) => pathname.endsWith('/answer')).length, 1);
});

test('a routine\u2019s run arrives once as its own notice, and waits as a follow-up behind a run in progress', async t => {
  const bot = await openTestBot(t, noSessions);
  let open: () => void = () => {};
  const gate = new Promise<void>(resolve => { open = resolve; });
  bot.respond(
    async () => { await gate; return bot.faux.fauxAssistantMessage('Hello to you.'); },
    bot.faux.fauxAssistantMessage('The backups are fine.'),
  );
  await bot.runtime.prompt('Hello', 'followUp');
  await until(() => bot.runtime.busy, 'the user\u2019s run starts');
  const run = {
    kind: 'routine' as const, requestId: 'routine:inv-1',
    text: '[routine "backup-check", scheduled for 2026-11-20 09:04. This message comes from the routine, not from the user: do what it asks and answer here, in your chat.]\n\nCheck the backups.',
    data: { routineId: 'r-1', routineName: 'backup-check', invocationId: 'inv-1', trigger: 'schedule' },
  };
  await bot.runtime.deliver(run);
  await bot.runtime.deliver(run);
  open();
  await until(() => said(bot, 'The backups are fine.'), 'the routine\u2019s run is answered');
  await severalPolls();
  assert.deepEqual(customs(bot, 'bot-routine'), [run.text], 'one notice, however often it is sent');
  const order = bot.mirrorLines().flatMap(line => line.customType === 'bot-routine' ? ['routine'] : line.type === 'message' ? [textOf(line.message)] : []);
  assert.deepEqual(order, ['Hello', 'Hello to you.', 'routine', 'The backups are fine.'], 'it waited for the user\u2019s run to end');
  assert.equal(bot.requests.length, 2);
  assert.equal(textOf(bot.requests[1].at(-1)), run.text);
});

test('the schedule tool creates, lists and removes the bot\u2019s own routines, and passes on a refusal', async t => {
  const calls: [string, unknown][] = [];
  const api: HubApi = async (pathname, body) => {
    calls.push([pathname, body]);
    if (pathname.endsWith('/routines/backups-nightly/remove')) {
      throw new Error('Refused: "backups-nightly" is another bot\u2019s schedule, not yours. You can remove only the schedules you made for yourself.');
    }
    if (pathname.endsWith('/remove')) return { removed: 'host-check' };
    if (body) return { routine: { ...body, nextRunAt: null } };
    return { routines: [{ name: 'host-check', description: '', prompt: 'Check the hosts.', enabled: true, schedule: { cron: '*/2 * * * *' }, stats: { nextRunAt: null, lastInvocation: null } }] };
  };
  const bot = await openTestBot(t, noSessions, { api });
  bot.respond(
    toolCall(bot, 'schedule', { action: 'create', name: 'host-check', cron: '*/2 * * * *', prompt: 'Check the hosts.' }),
    toolCall(bot, 'schedule', { action: 'list' }),
    toolCall(bot, 'schedule', { action: 'remove', name: 'backups-nightly' }),
    toolCall(bot, 'schedule', { action: 'remove', name: 'host-check' }),
    bot.faux.fauxAssistantMessage('Done.'),
  );
  await bot.runtime.prompt('Check the hosts every two minutes', 'followUp');
  await until(() => said(bot, 'Done.'), 'the run ends');
  const base = `/api/bots/${BOT.id}/routines`;
  assert.deepEqual(calls, [
    [base, { name: 'host-check', prompt: 'Check the hosts.', schedule: { cron: '*/2 * * * *' } }],
    [base, undefined],
    [`${base}/backups-nightly/remove`, {}],
    [`${base}/host-check/remove`, {}],
  ]);
  const results = toolResults(bot);
  assert.match(textOf(results[0]), /^Created the schedule "host-check" \(\*\/2 \* \* \* \*\)\. Each run arrives here/);
  assert.equal(textOf(results[1]), 'host-check: */2 * * * *\n  Prompt: Check the hosts.');
  assert.equal(results[2].isError, true);
  assert.match(textOf(results[2]), /^Refused: "backups-nightly" is another bot\u2019s schedule/);
  assert.equal(textOf(results[3]), 'Removed the schedule "host-check". Its runs so far stay in its record.');
});

// Code mode -------------------------------------------------------------------

const script = (bot: Harness, code: string) => toolCall(bot, 'codemode', { code });
/** The value a script returned, from the code mode result the model reads. */
const returned = (result: Record<string, unknown>): unknown => {
  const shown = textOf(result);
  return JSON.parse(shown.slice(shown.indexOf('{'), shown.lastIndexOf('}') + 1));
};
const LIST = {
  active: [
    { id: 'id-a', ref: 'aaaa1111', name: 'build', cwd: '/w', harnessId: 'pi', model: 'm1', isActive: true, turnInProgress: true, lastActivity: '2026-11-20T10:00:00.000Z', messageCount: 4 },
    { id: 'id-b', ref: 'bbbb2222', name: 'NESTED-ONLY review', cwd: '/w', harnessId: 'omp', isActive: true, turnInProgress: false, lastActivity: '2026-11-19T10:00:00.000Z', messageCount: 9 },
  ],
  previous: [], children: [], total: 2,
};
const KB = { total: 1, results: [{ path: 'topics/idle.md', lines: [{ line: 2, text: 'KB-LINE-ONLY in the script' }] }] };

test('a script chains two tools and only its output reaches the model', async t => {
  const calls: string[][] = [];
  const bot = await openTestBot(t, async args => { calls.push(args); return JSON.stringify(LIST); }, { api: async () => KB });
  bot.respond(
    script(bot, [
      'const list = await tools.sessions({ action: "list" });',
      'const kb = await tools.kb_search({ query: "idle" });',
      'return { idle: list.sessions.filter(s => s.state === "active").map(s => s.ref), pages: kb.results.map(r => r.path) };',
    ].join('\n')),
    bot.faux.fauxAssistantMessage('bbbb2222 is idle.'),
  );
  await bot.runtime.prompt('Which sessions are idle?', 'followUp');
  await until(() => said(bot, 'bbbb2222 is idle.'), 'the run ends');
  // A script's call runs only the JSON command: nobody reads the text.
  assert.deepEqual(calls, [['list', '--active', '--full', '--json']]);
  const result = toolResults(bot)[0];
  assert.equal(result.toolName, 'codemode');
  assert.equal(result.isError, false);
  assert.deepEqual(returned(result), { idle: ['bbbb2222'], pages: ['topics/idle.md'] });
  const next = JSON.stringify(bot.requests[1]);
  assert.ok(next.includes('{\\"idle\\":[\\"bbbb2222\\"]'), 'the next request holds the script\u2019s output');
  for (const nested of ['NESTED-ONLY', 'KB-LINE-ONLY', 'aaaa1111']) assert.ok(!next.includes(nested), `${nested} stayed in the script`);
});

test('a script sees sessions list and kb_search as structured values', async t => {
  const bot = await openTestBot(t, async () => JSON.stringify(LIST), { api: async () => KB });
  bot.respond(
    script(bot, 'return { list: await tools.sessions({ action: "list", host: "tycho" }), kb: await tools.kb_search({ query: "idle" }) };'),
    bot.faux.fauxAssistantMessage('Seen.'),
  );
  await bot.runtime.prompt('Show me', 'followUp');
  await until(() => said(bot, 'Seen.'), 'the run ends');
  assert.deepEqual(returned(toolResults(bot)[0]), {
    list: {
      action: 'list', total: 2,
      sessions: [
        { ref: 'tycho/aaaa1111', name: 'build', cwd: '/w', harness: 'pi', model: 'm1', state: 'working', lastActivity: '2026-11-20T10:00:00.000Z', messages: 4, host: 'tycho' },
        { ref: 'tycho/bbbb2222', name: 'NESTED-ONLY review', cwd: '/w', harness: 'omp', state: 'active', lastActivity: '2026-11-19T10:00:00.000Z', messages: 9, host: 'tycho' },
      ],
    },
    kb: { total: 1, results: [{ path: 'topics/idle.md', lines: [{ line: 2, text: 'KB-LINE-ONLY in the script' }] }] },
  });
});

const settledJson = (text: string, totalMessages = 2) =>
  JSON.stringify({ state: 'finished', totalMessages, message: { role: 'assistant', content: [{ type: 'text', text }] } });

test('a script waiting on its second call when the bot restarts finishes without repeating its first', async t => {
  const kbCalls: string[] = [];
  let waits = 0;
  let settled = false;
  const port: SessionsPort = async (args, signal) => {
    if (args[0] !== 'wait') throw new Error(`unexpected ${args[0]}`);
    waits++;
    if (settled) return settledJson('DONE');
    // Still working when the relay goes down; its CLI is stopped with it.
    return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
  };
  const bot = await openTestBot(t, port, { api: async path => { kbCalls.push(path); return KB; } });
  bot.respond(
    script(bot, [
      'const kb = await tools.kb_search({ query: "one" });',
      'const done = await tools.sessions({ action: "wait", ref: "ffff0000" });',
      'return { pages: kb.total, answer: done.text };',
    ].join('\n')),
    bot.faux.fauxAssistantMessage('Finished.'),
  );
  await bot.runtime.prompt('Wait for ffff0000', 'followUp');
  await until(() => waits === 1, 'the script waits on its second call');
  await bot.reopen(() => { settled = true; });
  await until(() => said(bot, 'Finished.'), 'the script finishes after the restart', 15_000);
  assert.equal(kbCalls.length, 1, 'the first call is not made again');
  assert.equal(waits, 2, 'the wait runs again');
  assert.deepEqual(returned(toolResults(bot)[0]), { pages: 1, answer: 'DONE' });
});

test('a script cannot call new_context, bot_create or bot_update', async t => {
  const bot = await openTestBot(t, noSessions);
  bot.respond(
    script(bot, 'await tools.new_context({ summary: "from a script" });'),
    bot.faux.fauxAssistantMessage('It refused.'),
  );
  await bot.runtime.prompt('Roll over from a script', 'followUp');
  await until(() => said(bot, 'It refused.'), 'the run ends');
  const result = toolResults(bot)[0];
  assert.equal(result.isError, true);
  assert.match(textOf(result), /TypeError: tools\.new_context does not exist\. Available: ([\w, ]+)\./);
  const available = /Available: ([\w, ]+)\./.exec(textOf(result))![1].split(', ');
  assert.ok(available.includes('sessions') && available.includes('kb_search'));
  for (const modelOnly of ['new_context', 'bot_create', 'bot_update', 'codemode']) assert.ok(!available.includes(modelOnly), `${modelOnly} is not callable`);
  assert.ok(!bot.mirrorLines().some(line => line.customType === 'bot-context-window'), 'no new window');
});

test('a script past the time cap ends with an error, whatever its options line asks, and the bot is free again', async t => {
  let stopped = false;
  const port: SessionsPort = async (args, signal) => {
    if (args[0] !== 'wait') throw new Error(`unexpected ${args[0]}`);
    return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => { stopped = true; reject(new Error('stopped')); }, { once: true }));
  };
  const bot = await openTestBot(t, port, { scriptTimeoutMs: 300 });
  bot.respond(
    script(bot, '// @options: {"timeout_ms": 3600000}\nawait tools.sessions({ action: "wait", ref: "ffff0000", timeout: 600 });'),
    bot.faux.fauxAssistantMessage('It timed out.'),
    bot.faux.fauxAssistantMessage('Free again.'),
  );
  await bot.runtime.prompt('Wait a long time', 'followUp');
  await until(() => said(bot, 'It timed out.'), 'the script ends');
  const result = toolResults(bot)[0];
  assert.equal(result.isError, true);
  assert.match(textOf(result), /timed out/i);
  await until(() => stopped, 'the call the script waited on is stopped');
  await until(() => !bot.runtime.busy, 'the run ends');
  await bot.runtime.prompt('Still there?', 'followUp');
  await until(() => said(bot, 'Free again.'), 'the bot answers the next message');
});

test('a worker whose answer a script waited for does not report it, and reports its next turn', async t => {
  const worker = scriptedWorker();
  const port: SessionsPort = async (args, signal) => {
    if (args[0] !== 'wait') return worker.port(args, signal);
    worker.calls.push(args);
    // The worker answers while the script waits; the watch polls meanwhile.
    worker.answer('QUICK-ANSWER');
    await severalPolls();
    return settledJson('QUICK-ANSWER', worker.state.messages.length);
  };
  const bot = await openTestBot(t, port);
  bot.respond(
    script(bot, [
      'const w = await tools.spawn_worker({ name: "quick", brief: "Say hello." });',
      'const done = await tools.sessions({ action: "wait", ref: w.ref, timeout: 60 });',
      'return { ref: w.ref, answer: done.text };',
    ].join('\n')),
    bot.faux.fauxAssistantMessage('It said hello.'),
    relay(bot),
  );
  await bot.runtime.prompt('Ask a worker to say hello', 'followUp');
  await until(() => said(bot, 'It said hello.'), 'the script ends');
  assert.deepEqual(returned(toolResults(bot)[0]), { ref: WORKER_ID, answer: 'QUICK-ANSWER' });
  assert.deepEqual(worker.calls.find(args => args[0] === 'wait'), ['wait', WORKER_ID, '--timeout', '60', '--json']);
  const polled = worker.polls();
  await until(() => worker.polls() > polled + 2, 'the watch keeps polling');
  assert.deepEqual(reportsOf(bot), [], 'the answer the script took is not reported');
  worker.state.busy = true;
  worker.state.messages.push({ role: 'user', content: 'more' });
  worker.answer('LATER-ANSWER');
  await until(() => reportsOf(bot).length === 1, 'the next turn is reported');
  assert.equal(reportsOf(bot)[0], `[worker report] "quick" (${WORKER_ID}) finished.\n\nLATER-ANSWER`);
});

test('a bot stored before code mode opens with the tool and the preamble of the code it runs now, and answers', async t => {
  const bot = await openTestBot(t, noSessions, { from: path.join(__dirname, 'fixtures', 'bot-before-codemode') });
  bot.respond(bot.faux.fauxAssistantMessage('Still here, and beelink is the hub.'));
  await bot.runtime.prompt('Do you remember the hub?', 'followUp');
  await until(() => said(bot, 'Still here, and beelink is the hub.'), 'the bot answers');
  const request = bot.requests[0];
  assert.ok(request.some(message => textOf(message) === 'Remember that beelink is the hub.'), 'its earlier conversation is in the request');
  assert.match(systemText(request), /<codemode>[^]*declare const tools: \{ sessions\(/, 'the code mode section lists its tools');
  // The preamble is a section rendered for each request: a changed one is sent as a later system message at the
  // first request after a restart, and is the one in effect from then on.
  const rules = request.filter(message => (message.role as string) === 'system')
    .map(message => (message as unknown as { sections?: Record<string, string | null> }).sections?.['bot-rules'])
    .filter(text => typeof text === 'string');
  assert.equal(rules.length, 2, 'the stored preamble, then the current one');
  assert.doesNotMatch(rules[0], /Code mode:/, 'stored before the preamble had its code mode rule');
  assert.match(rules[1], /^You are a pi-dish bot[^]*Code mode: the codemode tool/);
  const texts = bot.mirrorLines().filter(line => line.type === 'message').map(line => textOf(line.message));
  assert.deepEqual(texts.filter(text => text), ['Remember that beelink is the hub.', 'Saved (19 of 16384 bytes). Your instructions show it from the next window on.',
    'Noted: beelink is the hub.', 'Do you remember the hub?', 'Still here, and beelink is the hub.']);
});

test('a run, a script in it and input queued behind it keep a bot from restarting; a watched worker does not, and reports once after the restart', async t => {
  const worker = scriptedWorker();
  let finishWait: (text: string) => void = () => {};
  let waits = 0;
  const port: SessionsPort = async (args, signal) => {
    if (args[0] !== 'wait') return worker.port(args, signal);
    waits++;
    return new Promise<string>(resolve => { finishWait = text => resolve(settledJson(text)); });
  };
  const bot = await openTestBot(t, port);
  const idle = { running: false, queued: false };

  // A worker being watched: background work, which resumes after a restart.
  bot.respond(
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('spawn_worker', { name: 'clock', brief: 'sleep 75; date' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Started clock.'),
  );
  await bot.runtime.prompt('What time is it after a sleep?', 'followUp');
  await until(() => said(bot, 'Started clock.') && !bot.runtime.busy && worker.polls() >= 1, 'the run ends and the watch polls');
  assert.deepEqual(await bot.runtime.activity(), idle, 'a watched worker does not block a restart');

  // A run in progress, and a message queued behind it.
  let answer: () => void = () => {};
  const answered = new Promise<void>(resolve => { answer = resolve; });
  bot.respond(
    async () => { await answered; return bot.faux.fauxAssistantMessage('Thinking done.'); },
    bot.faux.fauxAssistantMessage('And the follow-up.'),
  );
  await bot.runtime.prompt('Think about it.', 'followUp');
  await until(() => bot.runtime.busy, 'the run starts');
  assert.deepEqual(await bot.runtime.activity(), { running: true, queued: false });
  await bot.runtime.prompt('One more thing.', 'followUp');
  assert.deepEqual(await bot.runtime.activity(), { running: true, queued: true });
  answer();
  await until(() => said(bot, 'And the follow-up.') && !bot.runtime.busy, 'both are answered');
  assert.deepEqual(await bot.runtime.activity(), idle);

  // A code mode script is part of its run.
  bot.respond(script(bot, 'return (await tools.sessions({ action: "wait", ref: "ffff0000" })).text;'), bot.faux.fauxAssistantMessage('Waited.'));
  await bot.runtime.prompt('Wait for ffff0000.', 'followUp');
  await until(() => waits === 1, 'the script waits on its call');
  assert.equal((await bot.runtime.activity()).running, true, 'a script waiting on a call blocks a restart');
  finishWait('DONE');
  await until(() => said(bot, 'Waited.') && !bot.runtime.busy, 'the script and its run end');
  assert.deepEqual(await bot.runtime.activity(), idle);

  // Restarted while the worker is watched: the watch goes on and reports its answer once.
  await bot.reopen(() => worker.answer('Fri Nov 20 12:01:15 UTC 2026'));
  bot.respond(relay(bot));
  await until(() => reportsOf(bot).length === 1, 'the watch reports after the restart', 15_000);
  assert.equal(reportsOf(bot)[0], `[worker report] "clock" (${WORKER_ID}) finished.\n\nFri Nov 20 12:01:15 UTC 2026`);
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message).startsWith('Relayed:')), 'the report is answered');
  await severalPolls();
  assert.equal(reportsOf(bot).length, 1, 'once');
});

// The roster ------------------------------------------------------------------

test('a bot lists the roster: itself, its ancestors and its descendants with their fields, and nothing elsewhere in the tree', async t => {
  const registry = tempRegistry(t);
  const chief = newBot(registry, 'Chief');
  const fleet = newBot(registry, 'Fleet', chief.id);
  const backups = newBot(registry, 'Backups', fleet.id);
  newBot(registry, 'Personal', chief.id);
  newBot(registry, 'Other');
  const running = new Map<string, Harness>();
  const hub = hubOf(createBotHandlers(() => registry, botControl(running, [])));
  const bot = await openTestBot(t, noSessions, { row: () => registry.get(fleet.id)!, api: hub });
  running.set(fleet.id, bot);
  bot.respond(
    script(bot, 'const { bots } = await tools.bots({ action: "list" }); return { bots };'),
    toolCall(bot, 'bots', { action: 'show', bot: 'backups' }),
    bot.faux.fauxAssistantMessage('Three bots.'),
  );
  await bot.runtime.prompt('Who is on the roster?', 'followUp');
  await until(() => said(bot, 'Three bots.'), 'the run ends');
  const [listed, shown] = toolResults(bot);
  const { bots } = returned(listed) as { bots: Record<string, unknown>[] };
  assert.deepEqual(bots.map(row => [row.name, row.relation, row.parentName, row.running, row.lastTurnAt]), [
    ['Chief', 'ancestor', null, false, null],
    ['Fleet', 'self', 'Chief', true, '2026-11-20T10:00:00.000Z'],
    ['Backups', 'descendant', 'Fleet', false, null],
  ], 'Personal, a sibling, and Other, another family, are not on it');
  assert.deepEqual(bots[2], {
    id: backups.id, name: 'Backups', parentId: fleet.id, parentName: 'Fleet', relation: 'descendant', status: 'active',
    model: 'faux/faux-1', thinking: null, places: [], revision: 1, running: false, lastTurnAt: null,
  });
  assert.equal(shown.isError, false);
  assert.match(textOf(shown), /^Backups · not running · faux\/faux-1 · revision 1\nId: \S+\. Parent: Fleet\./);
  assert.match(textOf(shown), /\nIdentity:\nYou are Backups\.\n\nRevisions:\n1\. \S+ by user: created$/);
});

test('bot_update moves a descendant within its subtree and shows the move with its undo; outside it, a cycle and the nesting limit are refused', async t => {
  const registry = tempRegistry(t);
  const chief = newBot(registry, 'Chief');
  const fleet = newBot(registry, 'Fleet', chief.id);
  const hosts = newBot(registry, 'Hosts', fleet.id);
  const backups = newBot(registry, 'Backups', chief.id);
  const nightly = newBot(registry, 'Nightly', backups.id);
  newBot(registry, 'Tapes', nightly.id);
  newBot(registry, 'Personal');
  const hub = hubOf(createBotHandlers(() => registry, botControl(new Map(), [])));
  const bot = await openTestBot(t, noSessions, { row: () => registry.get(chief.id)!, api: hub });
  const update = (args: Record<string, string>) => toolCall(bot, 'bot_update', args);
  bot.respond(
    update({ bot: 'Hosts', parent: 'Backups' }),
    update({ bot: 'Personal', name: 'Mine' }),
    update({ bot: 'Backups', parent: 'Tapes' }),
    update({ bot: 'Fleet', parent: 'Tapes' }),
    update({ parent: 'Backups' }),
    bot.faux.fauxAssistantMessage('Moved Hosts.'),
  );
  await bot.runtime.prompt('Put Hosts under Backups', 'followUp');
  await until(() => said(bot, 'Moved Hosts.'), 'the run ends');
  const [moved, outside, cycle, deep, own] = toolResults(bot);
  assert.match(textOf(moved), /^Changed Hosts's entry \(revision 2\):\nparent: Fleet → Backups\nThe user sees the change and can undo it\.$/);
  assert.equal(registry.get(hosts.id)!.parentId, backups.id);
  assert.deepEqual(bot.mirrorLines().find(line => line.customType === 'bot-change')?.details, {
    botId: hosts.id, botName: 'Hosts', revision: 2, fields: ['parentId'], lines: ['parent: Fleet → Backups'],
  });
  for (const result of [outside, cycle, deep, own]) assert.equal(result.isError, true);
  assert.match(textOf(outside), /^There is no bot named "Personal" among the bots you can see/);
  assert.equal(textOf(cycle), 'Refused: Tapes is one of Backups\'s own sub-bots, so Backups cannot move under it.');
  assert.equal(textOf(deep), 'Refused: Tapes is 4 levels deep, so Fleet would reach level 5 under it, and bots nest at most 4 levels.');
  assert.match(textOf(own), /^Refused: you cannot change your own parent/);
  assert.deepEqual([registry.get(backups.id)!.parentId, registry.get(fleet.id)!.parentId], [chief.id, chief.id], 'a refused move changes nothing');
});

test('a bot retires a descendant and brings it back with bot_update, each a recorded change; the relay stops and starts and its sub-bot moves up and back', async t => {
  const registry = tempRegistry(t);
  const chief = newBot(registry, 'Chief');
  const backups = newBot(registry, 'Backups', chief.id);
  newBot(registry, 'Nightly', backups.id);
  const relays: string[] = [];
  const hub = hubOf(createBotHandlers(() => registry, botControl(new Map(), [],
    async row => { relays.push(`start ${row.name}`); }, async row => { relays.push(`stop ${row.name}`); })));
  const bot = await openTestBot(t, noSessions, { row: () => registry.get(chief.id)!, api: hub });
  bot.respond(
    toolCall(bot, 'bot_update', { bot: 'Backups', status: 'retired' }),
    toolCall(bot, 'bot_update', { bot: 'Backups', status: 'active' }),
    bot.faux.fauxAssistantMessage('Backups is back.'),
  );
  await bot.runtime.prompt('Retire Backups, then bring it back', 'followUp');
  await until(() => said(bot, 'Backups is back.'), 'the run ends');
  const [retired, back] = toolResults(bot);
  assert.equal(textOf(retired), 'Changed Backups\'s entry (revision 2):\nstatus: "active" → "retired"\nBackups is retired and stopped. Its sub-bots moved up: Nightly (now under Chief). The user sees the change and can undo it.');
  assert.equal(textOf(back), 'Changed Backups\'s entry (revision 3):\nstatus: "retired" → "active"\nBackups is back and starting. Its former sub-bots moved back: Nightly (now under Backups). The user sees the change and can undo it.');
  assert.deepEqual(relays, ['stop Backups', 'start Backups']);
  assert.deepEqual(registry.revisions(backups.id).slice(1).map(revision => [revision.actor, revision.fields, revision.after.status]),
    [[chief.id, ['status'], 'retired'], [chief.id, ['status'], 'active']]);
  assert.deepEqual(bot.mirrorLines().filter(line => line.customType === 'bot-change').map(line => (line.details as { revision: number }).revision), [2, 3]);
});

test('bot_create with fresh starts a child whose first request holds its own identity and none of its creator\u2019s conversation, on the model given', async t => {
  const registry = tempRegistry(t);
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bots-dir-'));
  t.after(() => fs.rmSync(botsDir, { recursive: true, force: true }));
  const personal = registry.create({ name: 'Personal', identity: 'You are Personal, the contact for personal matters.', model: 'faux/faux-1' }, { actor: 'user' });
  let child: Harness | undefined;
  const hub: HubApi = (pathname, body) => routes(pathname, body);
  const routes = hubOf(createBotHandlers(() => registry, botControl(new Map(), [], async row => {
    child = await openTestBot(t, noSessions, { botsDir, row: () => registry.get(row.id)!, api: hub, responses: faux => [faux.fauxAssistantMessage('Ready.')] });
  })));
  const parent = await openTestBot(t, noSessions, { botsDir, row: () => registry.get(personal.id)!, api: hub });
  parent.respond(
    parent.faux.fauxAssistantMessage('Noted: Dr Molar.'),
    parent.faux.fauxAssistantMessage([parent.faux.fauxToolCall('bot_create', {
      name: 'Garden', purpose: 'Plan the vegetable beds.', identity: 'You are Garden, the contact for the garden.', fresh: true, model: 'faux/faux-2',
    })], { stopReason: 'toolUse' }),
    parent.faux.fauxAssistantMessage('Created Garden.'),
  );
  await parent.runtime.prompt('My dentist is Dr Molar', 'followUp');
  await until(() => said(parent, 'Noted: Dr Molar.'), 'the parent answers');
  await parent.runtime.prompt('Make a bot for the garden', 'followUp');
  await until(() => !!child && said(child, 'Ready.') && said(parent, 'Created Garden.'), 'the fresh bot answers its purpose');
  const garden = registry.list().find(row => row.name === 'Garden')!;
  assert.deepEqual([garden.parentId, garden.model], [personal.id, 'faux/faux-2']);
  assert.match(textOf(toolResults(parent).at(-1)), /^Created sub-bot "Garden" on faux\/faux-2\. It starts fresh, with its own identity and none of this conversation,/);

  const first = child!.requests[0];
  assert.match(systemText(first), /You are Garden, the contact for the garden\./);
  assert.doesNotMatch(systemText(first), /You are Personal/);
  const conversation = first.filter(message => (message.role as string) !== 'system');
  assert.equal(conversation.length, 1, 'its purpose is its whole conversation');
  assert.match(textOf(conversation[0]), /^\[pi-dish: you are "Garden", a new bot that Personal created just now as its sub-bot\. You start fresh/);
  assert.match(textOf(conversation[0]), /Your purpose, from Personal:\nPlan the vegetable beds\.$/);
  for (const parentText of ['Dr Molar', 'Make a bot for the garden']) assert.ok(!JSON.stringify(first).includes(parentText), `${parentText} stayed with Personal`);
  assert.deepEqual(child!.mirrorLines().filter(line => line.customType).map(line => line.customType), ['bot-purpose']);
  assert.ok(child!.mirrorLines().some(line => line.type === 'model_change' && line.modelId === 'faux-2'), 'it runs on the model given');
  assert.ok(!fs.existsSync(path.join(botsDir, garden.id, 'fork.json')), 'the start is read once');
});
