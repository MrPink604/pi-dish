// A bot's runtime on pi-ai's faux provider: no live model, no live session.
// The sessions port stands in for the pi-dish-sessions CLI.
import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import nodeModule = require('node:module');
import path = require('node:path');
import url = require('node:url');
import esbuild = require('esbuild');
import type { BotRegistry, BotRow } from '../lib/bot-registry';
import type { BotControl, BotHandlers } from '../lib/bot-handlers';
import type { RouteHandler } from '../lib/http-boundary';
import type { BotRuntime, HubApi, IdleRolloverPorts, IdleRolloverRecord, SessionsPort, WorkerRecord } from '../lib/bot-runtime';
const { BotMirror, readBotMirrorHeader, lastBotTurn }: typeof import('../lib/bot-mirror') = require('../lib/bot-mirror');
const runtimeModule: typeof import('../lib/bot-runtime') = require('../lib/bot-runtime');
const {
  openBotRuntime, settledWorker, newContextRefusal, composeHandoff, composeInstructions,
  formatKnowledgeIndex, formatKnowledgeIndexes, KB_INDEX_MAX_BYTES, workerRefMatches, findOwnedWorker,
} = runtimeModule;
const { openBotRegistry }: typeof import('../lib/bot-registry') = require('../lib/bot-registry');
const { createBotHandlers, changeLines, ROOM_HOP_CAP }: typeof import('../lib/bot-handlers') = require('../lib/bot-handlers');
const { turnEnd }: typeof import('../lib/session-api') = require('../lib/session-api');

type Faux = typeof import('@earendil-works/pi-ai/providers/faux');
type Step = import('@earendil-works/pi-ai/providers/faux').FauxResponseStep;
type Message = import('@earendil-works/pi-ai').Message;
type TranscriptContext = import('@earendil-works/pi-ai').TranscriptContext;

const BOT: BotRow = {
  id: '0b0c5a1e-0000-4000-8000-000000000001', parentId: null, name: 'Fleet', status: 'active', model: 'faux/faux-1',
  thinking: null, identity: 'You are Fleet, the contact for the fleet.', places: [], revision: 1,
  createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z',
};

interface Harness {
  runtime: BotRuntime;
  events: { event: string; data: Record<string, unknown> }[];
  requests: Message[][];
  /** Each request's whole context (system, messages, tools), as the provider received it. */
  contexts: TranscriptContext[];
  mirrorPath: string;
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
  /** The idle rollover's settings, cache TTLs, routines, log and clock; by default no cache TTL is known, so it never fires. */
  idleRollover?: IdleRolloverPorts;
  /** What the faux models take; text and images by default. */
  input?: ('text' | 'image')[];
  /** Optional smaller/different context window for `faux-2` when testing a model switch across restart. */
  faux2ContextWindow?: number;
}

const noIdleRollover: IdleRolloverPorts = { settings: () => ({}), cacheRetention: () => ({ revision: 'none', rules: [] }) };

async function openTestBot(t: test.TestContext, sessions: SessionsPort,
  { contextWindow = 200_000, api = noApi, botsDir, row = () => BOT, responses, pollMs = { first: 20, max: 40 }, scriptTimeoutMs, from,
    idleRollover = noIdleRollover, input, faux2ContextWindow }: TestBotOptions = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bot-'));
  const faux: Faux = await import('@earendil-works/pi-ai/providers/faux');
  const { createModels } = await import('@earendil-works/pi-ai/models');
  // faux-2 is a second model for a bot told to run on another one.
  const provider = faux.fauxProvider({ models: [{ id: 'faux-1', contextWindow, input }, { id: 'faux-2', contextWindow: faux2ContextWindow ?? contextWindow, input }] });
  const models = createModels();
  models.setProvider(provider.provider);
  const requests: Message[][] = [];
  const contexts: TranscriptContext[] = [];
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
    changed: () => {}, log: () => {}, pollMs, scriptTimeoutMs, idleRollover,
  });
  const recorded = (step: Step): Step => (context, ...rest) => {
    requests.push([...context.messages]);
    contexts.push({ ...context, messages: [...context.messages] });
    return typeof step === 'function' ? step(context, ...rest) : step;
  };
  if (responses) provider.appendResponses(responses(faux).map(recorded));
  const harness: Harness = {
    runtime: await open(), events, requests, contexts, faux,
    mirrorPath: mirrorFile,
    mirrorLines: () => fs.readFileSync(mirrorFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>),
    respond: (...steps) => provider.appendResponses(steps.map(recorded)),
    async reopen(between) { await harness.runtime.close(); between?.(); harness.runtime = await open(); },
  };
  t.after(async () => { await harness.runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return harness;
}

const noSessions: SessionsPort = async args => { throw new Error(`unexpected sessions call: ${args.join(' ')}`); };
const noApi: HubApi = async path => { throw new Error(`unexpected API call: ${path}`); };

test('kb_search, kb_read and kb_write reach the knowledge routes, and a write carries the bot\u2019s name and scope', async t => {
  const calls: [string, unknown][] = [];
  const api: HubApi = async (pathname, body) => {
    if (pathname === '/api/knowledge/page' || pathname.startsWith('/api/knowledge/page?scope=bot&')) {
      throw new Error('off');
    }
    calls.push([pathname, body]);
    if (pathname === '/api/knowledge/pages') {
      return { path: 'topics/tycho.md', scope: 'shared', created: true, revision: '112233445566', pageBytes: 80, commit: 'abc', pushed: false, pushError: 'git push: unreachable' };
    }
    if (pathname.startsWith('/api/knowledge/search')) {
      return { total: 1, results: [{ path: 'topics/backups.md', scope: 'shared', lines: [{ line: 3, text: 'Backups go to aeor nightly.' }] }] };
    }
    return { path: 'index.md', scope: 'shared', revision: 'abcdef012345', text: '# Knowledge\n\n- [Backups](topics/backups.md): Nightly backups\n' };
  };
  const bot = await openTestBot(t, noSessions, { api });
  const call = (name: string, args: Record<string, string>) =>
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall(name, args)], { stopReason: 'toolUse' });
  bot.respond(
    call('kb_search', { query: 'backups aeor' }),
    call('kb_read', {}),
    call('kb_write', { page: 'tycho', scope: 'shared', text: 'tycho has the GPU.', source: 'nvidia-smi on tycho', summary: 'Tycho GPU workstation' }),
    bot.faux.fauxAssistantMessage('Noted.'),
  );
  await bot.runtime.prompt('Where do backups go, and remember tycho has the GPU', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'Noted.'), 'the run answers');
  assert.deepEqual(calls, [
    [`/api/knowledge/search?q=backups+aeor&botId=${BOT.id}&ancestors=1`, undefined],
    [`/api/knowledge/page?botId=${BOT.id}&ancestors=1`, undefined],
    ['/api/knowledge/pages', {
      page: 'tycho', scope: 'shared', botId: BOT.id, botName: 'Fleet', mode: 'append',
      text: 'tycho has the GPU.', author: 'Fleet', source: 'nvidia-smi on tycho', summary: 'Tycho GPU workstation',
    }],
  ]);
  const results = bot.mirrorLines().filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult')
    .map(line => textOf(line.message));
  assert.equal(results[0], '[shared] topics/backups.md\n  3: Backups go to aeor nightly.');
  assert.equal(results[1], '[shared] index.md (revision abcdef012345):\n\n# Knowledge\n\n- [Backups](topics/backups.md): Nightly backups\n');
  assert.equal(results[2], 'Saved: topics/tycho.md (revision 112233445566) (a new page, added to the index). It is not on the remote yet (git push: unreachable); the next write pushes it.');
});

test('request_review posts the deck to the bot\'s own session without waiting, and a refusal reaches the bot', async t => {
  const calls: [string, unknown][] = [];
  const api: HubApi = async (pathname, body) => {
    // The knowledge index the bot reads as it opens is off here.
    if (pathname.startsWith('/api/knowledge/')) throw new Error('off');
    calls.push([pathname, body]);
    if (calls.length > 1) throw new Error('cards has 7 items; max is 6 — ask fewer things now, or post a follow-up deck after these answers');
    return { review: { id: 'rv_0123456789abcdef' } };
  };
  const bot = await openTestBot(t, noSessions, { api });
  const cards = [{ id: 'mags', title: 'Magazines', context: 'Pick one.', questions: [{ id: 'q', type: 'choice', prompt: 'Which?', options: ['a', 'b'], default: 'a' }] }];
  const call = (args: Parameters<Faux['fauxToolCall']>[1]) =>
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('request_review', args)], { stopReason: 'toolUse' });
  bot.respond(call({ title: 'Looks', cards }), call({ title: 'Too big', cards }), bot.faux.fauxAssistantMessage('Posted.'));
  await bot.runtime.prompt('Ask me about the magazines', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'Posted.'), 'the run answers');
  const route = `~sk1_${Buffer.from(JSON.stringify(['bot', BOT.id])).toString('base64url')}`;
  assert.deepEqual(calls[0], [`/api/sessions/${encodeURIComponent(route)}/reviews`, { title: 'Looks', cards, wait: false }]);
  const results = bot.mirrorLines().filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'toolResult')
    .map(line => line.message as Record<string, unknown>);
  assert.match(textOf(results[0]), /^Posted review rv_0123456789abcdef: 1 card, shown in your chat\./);
  assert.equal(results[1].isError, true);
  assert.match(textOf(results[1]), /^The review was refused: cards has 7 items; max is 6/);
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

test('a CI attempt wakes the bot and is mirrored as one notice across relay restarts', async t => {
  const bot = await openTestBot(t, noSessions);
  const input = {
    kind: 'ci' as const, requestId: 'ci:mrpink604/pi-dish:123:2',
    text: '[CI failure]\nTests failed on main.', data: { repo: 'MrPink604/pi-dish', runId: 123, attempt: 2 },
  };
  bot.respond(bot.faux.fauxAssistantMessage('Received.'));
  await bot.runtime.deliver(input);
  await until(() => bot.events.some(event => event.event === 'agent_end'), 'the bot reacts to CI');
  await bot.reopen();
  await bot.runtime.deliver(input);
  bot.respond(bot.faux.fauxAssistantMessage('Still here.'));
  await bot.runtime.prompt('Continue', 'followUp');
  await until(() => bot.requests.length >= 2 && !bot.runtime.busy, 'the bot drains its queue');
  assert.deepEqual(bot.mirrorLines().filter(line => line.customType === 'bot-ci').map(textOf), [input.text]);
  assert.equal(bot.requests.length, 2, 're-delivery did not start another CI turn');
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

test('worker ownership resolves full, unique, host-qualified and UUID-prefix refs without ordinal fallback or crossing hosts', () => {
  const desktopA = workerRecord('2026-11-21T02-49-16-118Z_01a1fc02-2055-722e-84fc-ff1a34d00ade', 'desktop', 'desktop/2026-11-21T02-49-16-118Z_01a1fc02-2055-722e-84fc-ff1a34d00ade');
  const desktopB = workerRecord('2026-11-21T02-49-16-119Z_01a1fc02-3055-722e-84fc-ff1a34d00ade', 'desktop', 'desktop/2026-11-21T02-49-16-119Z_01a1fc02-3055-722e-84fc-ff1a34d00ade');
  const beelink = workerRecord('2026-11-21T02-49-16-120Z_01a1fc02-4055-722e-84fc-ff1a34d00ade', 'beelink', '01a1fc02');
  const memory = { notebook: '', notebookSavedIn: -1, windows: [], workers: { a: desktopA, b: desktopB, c: beelink } };

  assert.equal(workerRefMatches(desktopA, desktopA.sessionId), true);
  assert.equal(workerRefMatches(desktopA, `desktop/${desktopA.sessionId}`), true);
  assert.equal(workerRefMatches(beelink, 'beelink/01a1fc02'), true);
  assert.equal(workerRefMatches(desktopA, 'beelink/01a1fc02'), false);
  assert.equal(findOwnedWorker(memory, desktopA.sessionId)?.[0], 'a');
  assert.equal(findOwnedWorker(memory, 'desktop/01a1fc02'), undefined, 'an ambiguous prefix on that host is refused');
  // Direct UUID prefixes resolve the matching owned worker; non-owned colliding UUIDv7 refs (like C = 01a1fc02-1)
  // and legacy ordinal guesses (-0, -1) must NEVER resolve to an unrelated owned worker.
  assert.equal(findOwnedWorker(memory, 'desktop/01a1fc02-2')?.[0], 'a');
  assert.equal(findOwnedWorker(memory, 'desktop/01a1fc02-3')?.[0], 'b');
  assert.equal(findOwnedWorker(memory, 'desktop/01a1fc02-1'), undefined, 'non-owned C ref must not match worker B via ordinal 1');
  assert.equal(findOwnedWorker(memory, '01a1fc02-1'), undefined, 'unqualified non-owned C ref must not match worker B via ordinal 1');
  assert.equal(findOwnedWorker(memory, 'desktop/01a1fc02-0'), undefined, 'ordinal -0 fallback is removed');
  assert.equal(findOwnedWorker(memory, 'desktop/'), undefined, 'empty id segment never matches');
  assert.equal(findOwnedWorker(memory, '-0'), undefined, 'bare ordinal without prefix never matches');
  assert.equal(findOwnedWorker(memory, 'beelink/01a1fc02')?.[0], 'c', 'a short ref remains usable when unique on its host');
});

test('sessions send canonicalizes direct owned worker refs and passes non-owned colliding refs raw to the CLI', async t => {
  const idA = '2026-11-21T02-49-16-118Z_01a1fc02-2055-722e-84fc-ff1a34d00ade';
  const idB = '2026-11-21T02-49-16-119Z_01a1fc02-3055-722e-84fc-ff1a34d00ade';
  const spawnIds = [idA, idB];
  const calls: string[][] = [];
  const port: SessionsPort = async args => {
    calls.push(args);
    if (args[0] === 'spawn') return JSON.stringify({ sessionId: spawnIds.shift(), harness: 'pi' });
    if (args[0] === 'resolve') return JSON.stringify({ session: { id: args[1], isActive: true, turnInProgress: true } });
    if (args[0] === 'send') return JSON.stringify({ ok: true, sentTo: args[1] });
    throw new Error(`unexpected ${args[0]}`);
  };
  const bot = await openTestBot(t, port);
  bot.respond(
    bot.faux.fauxAssistantMessage([
      bot.faux.fauxToolCall('spawn_worker', { name: 'worker A', host: 'desktop', brief: 'Work A' }),
      bot.faux.fauxToolCall('spawn_worker', { name: 'worker B', host: 'desktop', brief: 'Work B' }),
    ], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage([
      bot.faux.fauxToolCall('sessions', { action: 'send', ref: 'desktop/01a1fc02-1', message: 'For non-owned C' }),
      bot.faux.fauxToolCall('sessions', { action: 'send', ref: 'desktop/01a1fc02-2', message: 'For owned A' }),
    ], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Sent both.'),
  );
  await bot.runtime.prompt('Spawn A and B then send to C and A', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'Sent both.'), 'both sends finish');

  const sends = calls.filter(args => args[0] === 'send');
  assert.deepEqual(sends, [
    ['send', 'desktop/01a1fc02-1', 'For non-owned C', '--json'],
    ['send', `desktop/${idA}`, 'For owned A', '--json'],
  ]);
});

test('sessions send skips closed owned workers while read still resolves them', async t => {
  const idA = '2026-11-21T02-49-16-118Z_01a1fc02-2055-722e-84fc-ff1a34d00ade';
  const idB = '2026-11-21T02-49-16-119Z_01a1fc02-3055-722e-84fc-ff1a34d00ade';

  // Unit check: openOnly skips closed workers so shared prefixes resolve the open worker and closed-only refs miss.
  const closedA: WorkerRecord = { ...workerRecord(idA, 'desktop', `desktop/${idA}`), closedAt: '2026-11-21T03:00:00.000Z' };
  const openB = workerRecord(idB, 'desktop', `desktop/${idB}`);
  const mixed = { notebook: '', notebookSavedIn: -1, windows: [], workers: { a: closedA, b: openB } };
  assert.equal(findOwnedWorker(mixed, 'desktop/01a1fc02'), undefined, 'default lookup still treats closed + open prefix as ambiguous');
  assert.equal(findOwnedWorker(mixed, 'desktop/01a1fc02', { openOnly: true })?.[0], 'b', 'openOnly skips closed A and resolves open B');
  assert.equal(findOwnedWorker(mixed, 'desktop/01a1fc02-2')?.[0], 'a', 'default lookup still resolves closed A for read/close');
  assert.equal(findOwnedWorker(mixed, 'desktop/01a1fc02-2', { openOnly: true }), undefined, 'openOnly never matches closed A');
  const onlyClosed = { notebook: '', notebookSavedIn: -1, windows: [], workers: { a: closedA } };
  assert.equal(findOwnedWorker(onlyClosed, 'desktop/01a1fc02', { openOnly: true }), undefined, 'openOnly never matches sole closed worker');

  // Integration check through sessions tool: close A, then send using shared prefix and closed-A prefix; close B and send again.
  const spawnIds = [idA, idB];
  const calls: string[][] = [];
  const closedRefs = new Set<string>();
  const port: SessionsPort = async args => {
    calls.push(args);
    if (args[0] === 'spawn') return JSON.stringify({ sessionId: spawnIds.shift(), harness: 'pi' });
    if (args[0] === 'close') { closedRefs.add(args[1]); return '{"ok":true}'; }
    if (args[0] === 'resolve') return JSON.stringify({ session: { id: args[1], isActive: !closedRefs.has(args[1]), turnInProgress: !closedRefs.has(args[1]) } });
    if (args[0] === 'send') return JSON.stringify({ ok: true, sentTo: args[1] });
    if (args[0] === 'read') return 'transcript text';
    if (args[0] === 'show') return JSON.stringify({ totalMessages: 1, messages: [{ role: 'assistant', content: 'done' }] });
    throw new Error(`unexpected ${args[0]}`);
  };
  const bot = await openTestBot(t, port, { pollMs: { first: 60_000, max: 60_000 } });
  bot.respond(
    bot.faux.fauxAssistantMessage([
      bot.faux.fauxToolCall('spawn_worker', { name: 'worker A', host: 'desktop', brief: 'Work A' }),
      bot.faux.fauxToolCall('spawn_worker', { name: 'worker B', host: 'desktop', brief: 'Work B' }),
    ], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage([
      bot.faux.fauxToolCall('sessions', { action: 'close', ref: 'desktop/01a1fc02-2' }),
    ], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage([
      bot.faux.fauxToolCall('sessions', { action: 'send', ref: 'desktop/01a1fc02', message: 'For open B' }),
      bot.faux.fauxToolCall('sessions', { action: 'send', ref: 'desktop/01a1fc02-2', message: 'Raw closed prefix' }),
      bot.faux.fauxToolCall('sessions', { action: 'read', ref: 'desktop/01a1fc02-2' }),
    ], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage([
      bot.faux.fauxToolCall('sessions', { action: 'close', ref: 'desktop/01a1fc02-3' }),
    ], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage([
      bot.faux.fauxToolCall('sessions', { action: 'send', ref: 'desktop/01a1fc02', message: 'For non-owned live session' }),
    ], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Done.'),
  );
  await bot.runtime.prompt('Spawn, close A, send and read, then close B and send', 'followUp');
  await until(() => bot.mirrorLines().some(line => line.type === 'message' && textOf(line.message) === 'Done.'), 'send/read sequence completes');

  const sends = calls.filter(args => args[0] === 'send');
  assert.deepEqual(sends, [
    ['send', `desktop/${idB}`, 'For open B', '--json'],
    ['send', 'desktop/01a1fc02-2', 'Raw closed prefix', '--json'],
    ['send', 'desktop/01a1fc02', 'For non-owned live session', '--json'],
  ]);
  const reads = calls.filter(args => args[0] === 'read');
  assert.deepEqual(reads, [['read', `desktop/${idA}`]]);
});

/** A sessions port for one worker the test drives: it works until `answer`, and `close` stops it. */
function scriptedWorker() {
  const calls: string[][] = [];
  const state = { active: true, busy: true, ask: false, messages: [{ role: 'user', content: 'brief' }] as Record<string, unknown>[] };
  const port: SessionsPort = async args => {
    calls.push(args);
    if (args[0] === 'spawn') return JSON.stringify({ sessionId: WORKER_ID, harness: 'pi' });
    if (args[0] === 'resolve') {
      return JSON.stringify({ session: { id: WORKER_ID, isActive: state.active, turnInProgress: state.busy, askPending: state.ask } });
    }
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
      state.messages.push({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' });
      state.busy = false;
    },
    /** Adds `message` and leaves the session looking idle, as OMP does between steps of one turn. */
    step(message: Record<string, unknown>) {
      state.messages.push(message);
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

// The incident: OMP clears its busy bit at each step's turn_end, so a poll can find the session idle on a tool result.
const bashResult = { role: 'toolResult', toolCallId: 'call-1', toolName: 'bash', content: [{ type: 'text', text: 'ok 42 tests' }], isError: false };
const bashCall = {
  role: 'assistant', stopReason: 'toolUse',
  content: [{ type: 'text', text: 'The tests pass; now the lint.' }, { type: 'toolCall', id: 'call-2', name: 'bash', arguments: { command: 'npm run lint' } }],
};

test('a worker idle between steps is not reported until a turn-ending answer, which is reported once as finished', async t => {
  const worker = scriptedWorker();
  const bot = await openTestBot(t, worker.port);
  bot.respond(toolCall(bot, 'spawn_worker', { name: 'suite', brief: 'Run the suite.' }), bot.faux.fauxAssistantMessage('Started suite.'), relay(bot));
  await bot.runtime.prompt('Run the suite', 'followUp');
  await until(() => worker.polls() >= 1, 'the watcher polls');
  worker.step(bashResult);
  let seen = worker.polls();
  await until(() => worker.polls() > seen + 2, 'the watcher keeps polling past a tool result');
  worker.step(bashCall);
  seen = worker.polls();
  await until(() => worker.polls() > seen + 2, 'the watcher keeps polling past a tool call with prose');
  assert.deepEqual(reportsOf(bot), [], 'no step is reported as the answer');
  worker.answer('All green: 42 tests, lint clean.');
  await until(() => reportsOf(bot).length === 1, 'the answer is reported');
  await severalPolls();
  assert.deepEqual(reportsOf(bot), [`[worker report] "suite" (${WORKER_ID}) finished.\n\nAll green: 42 tests, lint clean.`]);
});

test('a worker that stops on a tool result is reported as stopped, and one with a question as waiting', async t => {
  const stopped = scriptedWorker();
  const bot = await openTestBot(t, stopped.port);
  bot.respond(toolCall(bot, 'spawn_worker', { name: 'dies', brief: 'Run it.' }), bot.faux.fauxAssistantMessage('Started dies.'), relay(bot));
  await bot.runtime.prompt('Run it', 'followUp');
  await until(() => stopped.polls() >= 1, 'the watcher polls');
  stopped.step(bashResult);
  stopped.state.active = false;
  await until(() => reportsOf(bot).length === 1, 'the stop is reported');
  assert.equal(reportsOf(bot)[0], `[worker report] "dies" (${WORKER_ID}) stopped without a final answer.\n\nThe session is closed; it is no longer watched.`);

  const asking = scriptedWorker();
  const other = await openTestBot(t, asking.port);
  other.respond(toolCall(other, 'spawn_worker', { name: 'asks', brief: 'Ask first.' }), other.faux.fauxAssistantMessage('Started asks.'), relay(other));
  await other.runtime.prompt('Ask first', 'followUp');
  await until(() => asking.polls() >= 1, 'the watcher polls');
  // The dialog holds the agent mid-turn: the bridge publishes the question while the session is still busy.
  asking.state.messages.push({ role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'Which branch?' }, { type: 'toolCall', id: 'q', name: 'ask', arguments: {} }] });
  asking.state.ask = true;
  assert.equal(asking.state.busy, true);
  await until(() => reportsOf(other).length === 1, 'the question is reported');
  assert.equal(reportsOf(other)[0], `[worker report] "asks" (${WORKER_ID}) is waiting for an answer.\n\nWhich branch?`);
  await severalPolls();
  assert.equal(reportsOf(other).length, 1, 'the open question is reported once');
});

test('a worker turn that fails is reported as an error, not as finished', async t => {
  const worker = scriptedWorker();
  const bot = await openTestBot(t, worker.port);
  bot.respond(toolCall(bot, 'spawn_worker', { name: 'fails', brief: 'Try it.' }), bot.faux.fauxAssistantMessage('Started fails.'), relay(bot));
  await bot.runtime.prompt('Try it', 'followUp');
  await until(() => worker.polls() >= 1, 'the watcher polls');
  worker.step({ role: 'assistant', content: [], stopReason: 'error', errorMessage: '429 rate limited' });
  await until(() => reportsOf(bot).length === 1, 'the failure is reported');
  assert.equal(reportsOf(bot)[0], `[worker report] "fails" (${WORKER_ID}) ended with an error.\n\n429 rate limited`);
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
  for (const ref of [WORKER_ID, `desktop/${WORKER_ID}`, 'desktop/01a1f86c', 'desktop/01a1f86c-1']) {
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
  const tail = (message: Record<string, unknown>) => ({ totalMessages: 5, messages: [message] });
  const idle = { isActive: true };
  assert.equal(settledWorker(idle, tail({ role: 'toolResult', content: [{ type: 'text', text: 'ok' }] }), 4), null, 'a tool result between steps');
  assert.equal(settledWorker(idle, tail({ role: 'custom', customType: 'notice', content: 'Background job done' }), 4), null, 'a notice');
  assert.equal(settledWorker(idle, tail({ role: 'developer', content: 'note' }), 4), null, 'a developer message');
  assert.equal(settledWorker(idle, tail(bashCall), 4), null, 'a tool call with prose');
  assert.equal(settledWorker(idle, tail({ role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'toolCall', id: 'c', name: 'bash' }], stopReason: 'stop' }), 4),
    null, 'a tool call under a stop reason still runs');
  assert.equal(settledWorker(idle, tail({ role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }] }), 4), null, 'a thinking-only shell');
  assert.deepEqual(settledWorker(idle, tail({ role: 'assistant', content: [{ type: 'text', text: 'cut' }], stopReason: 'length' }), 4),
    { state: 'finished', totalMessages: 5, text: 'cut' });
  assert.deepEqual(settledWorker(idle, tail({ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'overloaded' }), 4),
    { state: 'finished', totalMessages: 5, text: 'overloaded', failed: 'error' });
  assert.deepEqual(settledWorker(idle, tail({ role: 'assistant', content: [{ type: 'text', text: 'half' }], stopReason: 'aborted' }), 4),
    { state: 'finished', totalMessages: 5, text: 'half', failed: 'aborted' });
  assert.equal(settledWorker({ isActive: false }, tail(bashResult), 4)?.state, 'inactive', 'a stopped session settles on any tail');
  assert.equal(settledWorker({ isActive: true, askPending: true }, tail(bashCall), 4)?.state, 'waiting', 'a pending question on a tool call');
  assert.equal(settledWorker({ isActive: true, turnInProgress: true, askPending: true }, tail(bashCall), 4)?.state, 'waiting',
    'a question while the dialog holds the turn');
  assert.equal(settledWorker({ isActive: true, turnInProgress: true, askPending: true }, tail(bashCall), 5), null, 'an asked question, already reported');
});

test('a turn ends on an assistant message that is final', () => {
  const shell = { role: 'assistant', content: [], stopReason: 'stop', usage: { input: 1, output: 0 } };
  assert.equal(turnEnd(shell, true), null, 'an agy usage-only stop while the session works');
  assert.equal(turnEnd(shell, false), 'stop', 'an agy usage-only stop once it is idle: a real end');
  assert.equal(turnEnd({ role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' }, true), 'stop');
  assert.equal(turnEnd({ role: 'assistant', content: [{ type: 'text', text: 'wait' }], stopReason: 'toolUse' }, false), null);
  assert.equal(turnEnd({ role: 'assistant', content: [], usage: {} }, false), null, 'an unmarked usage-only shell');
  assert.equal(turnEnd({ role: 'assistant', content: 'plain' }, false), 'stop', 'an unmarked answer');
  assert.equal(turnEnd({ role: 'assistant', content: [{ type: 'text', text: 'x' }], stopReason: 'deferred' }, false), null, 'an unfinished stop reason');
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
  const api: HubApi = async (pathname, body) => {
    if (pathname.startsWith('/api/knowledge/')) throw new Error('off');
    calls.push([pathname, body]);
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
    if (pathname.startsWith('/api/knowledge/')) throw new Error('off');
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
    kb: { total: 1, results: [{ path: 'topics/idle.md', scope: 'shared', lines: [{ line: 2, text: 'KB-LINE-ONLY in the script' }] }] },
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
  const bot = await openTestBot(t, port, {
    api: async pathname => {
      if (pathname.startsWith('/api/knowledge/page')) throw new Error('off');
      kbCalls.push(pathname);
      return KB;
    },
  });
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

// Knowledge index injection, dual scopes & 90% rescue rollover ----------------

function instructionsText(messages: Message[]): string {
  return messages
    .filter(message => (message.role as string) === 'system')
    .map(message => (message as unknown as { sections?: Record<string, string | null> }).sections?.instructions ?? '')
    .join('\n');
}

test('formatKnowledgeIndex and formatKnowledgeIndexes cap at 3072 bytes without cutting mid-line and split dual scopes fairly', () => {
  assert.equal(formatKnowledgeIndex(''), null);
  assert.equal(formatKnowledgeIndex('The knowledge base has no pages yet.\n'), '(no pages yet — write durable facts with kb_write)');

  const makeIndex = (prefix: string, count: number) =>
    '# Knowledge\n\nOne line per topic page.\n\n' +
    Array.from({ length: count }, (_, i) => `- [${prefix} ${i}](topics/${prefix.toLowerCase()}-${i}.md): Summary for ${prefix} topic ${i} with enough description to grow past 3 KB`).join('\n') +
    '\n';

  const bigShared = makeIndex('Shared', 50);
  const capped = formatKnowledgeIndex(bigShared)!;
  assert.ok(Buffer.byteLength(capped, 'utf8') <= KB_INDEX_MAX_BYTES);
  const lines = capped.split('\n');
  assert.match(lines.at(-1)!, /^…and \d+ more pages \(call kb_read with no page for the full index, or kb_search\)\.$/);
  for (const line of lines.slice(0, -1)) assert.match(line, /^- \[Shared \d+\]\(topics\/shared-\d+\.md\): /);

  const bigBot = makeIndex('Bot', 50);
  const dual = formatKnowledgeIndexes(bigShared, bigBot);
  assert.ok(dual.bot && dual.shared);
  const totalBytes = Buffer.byteLength(dual.bot, 'utf8') + Buffer.byteLength(dual.shared, 'utf8');
  assert.ok(totalBytes <= KB_INDEX_MAX_BYTES, `combined ${totalBytes} <= ${KB_INDEX_MAX_BYTES}`);
  assert.match(dual.bot.split('\n').at(-1)!, /^…and \d+ more pages \(call kb_read with scope "bot"/);
  assert.match(dual.shared.split('\n').at(-1)!, /^…and \d+ more pages \(call kb_read with no page/);

  const instructions = composeInstructions('You are Fleet.', '', [], dual);
  assert.match(instructions, /<knowledge-index scope="bot">\n- \[Bot 0\]/);
  assert.match(instructions, /<knowledge-index scope="shared">\n- \[Shared 0\]/);
});

test('<knowledge-index> injects both scopes capped at 3 KB, omits on 503, skips on reopen and non-fresh fork, and refreshes on rollover', async t => {
  const bigIndex = (prefix: string) => '# Knowledge\n\n' + Array.from(
    { length: 45 },
    (_, i) => `- [${prefix} ${i}](topics/${prefix.toLowerCase()}-${i}.md): Description of ${prefix} page number ${i} for truncation testing`,
  ).join('\n') + '\n';

  let sharedIndex = bigIndex('Shared');
  let botIndex = bigIndex('Bot');
  const indexFetches: string[] = [];
  const api: HubApi = async (pathname) => {
    if (pathname === '/api/knowledge/page') {
      indexFetches.push(pathname);
      return { path: 'index.md', scope: 'shared', revision: 'aaaaaaaaaaaa', text: sharedIndex };
    }
    if (pathname === `/api/knowledge/page?scope=bot&botId=${BOT.id}`) {
      indexFetches.push(pathname);
      return { path: `bots/${BOT.id}/index.md`, scope: 'bot', botId: BOT.id, revision: 'bbbbbbbbbbbb', text: botIndex };
    }
    throw new Error(`unexpected ${pathname}`);
  };

  const bot = await openTestBot(t, noSessions, { api });
  assert.equal(indexFetches.length, 2, 'initial open fetches shared and bot indexes');
  bot.respond(bot.faux.fauxAssistantMessage('Hi.'));
  await bot.runtime.prompt('Hello', 'followUp');
  await until(() => said(bot, 'Hi.'), 'first turn completes');

  const sys1 = systemText(bot.requests[0]);
  assert.match(sys1, /<knowledge-index scope=\\"bot\\">/);
  assert.match(sys1, /<knowledge-index scope=\\"shared\\">/);
  assert.match(sys1, /…and \d+ more pages/);

  // Reopening an existing durable.sqlite must make ZERO /api/knowledge/page calls and keep open instructions unchanged.
  indexFetches.length = 0;
  sharedIndex = '# Knowledge\n\n- [Brand New](topics/brand-new.md): Added after window 1 opened\n';
  botIndex = '# Fleet Knowledge\n\n- [Bot New](topics/bot-new.md): Added after window 1 opened\n';
  await bot.reopen();
  assert.deepEqual(indexFetches, [], 'reopening an existing durable.sqlite does not fetch KB index');
  bot.respond(
    bot.faux.fauxAssistantMessage('Still window 1.'),
    toolCall(bot, 'context_notes', { action: 'write', text: 'Carry over.' }),
    toolCall(bot, 'new_context', { summary: 'Done with window 1' }),
    bot.faux.fauxAssistantMessage('Now window 2.'),
  );
  await bot.runtime.prompt('Still in window 1?', 'followUp');
  await until(() => said(bot, 'Still window 1.'), 'reopened turn completes');
  assert.doesNotMatch(systemText(bot.requests[1]), /Brand New/, 'open window instructions remain frozen across restart');

  // Calling new_context fetches the updated shared + bot indexes for window 2.
  await bot.runtime.prompt('Roll over now', 'followUp');
  await until(() => said(bot, 'Now window 2.'), 'window 2 answers');
  assert.equal(indexFetches.length, 2, 'rollover fetches updated indexes');
  const sys2 = systemText(bot.requests.at(-1)!);
  assert.match(sys2, /Brand New/);
  assert.match(sys2, /Bot New/);

  // When KB is off (503), <knowledge-index> is omitted cleanly from instructions.
  const offBot = await openTestBot(t, noSessions, { api: async () => { throw new Error('The knowledge base is off (503)'); } });
  offBot.respond(offBot.faux.fauxAssistantMessage('No KB.'));
  await offBot.runtime.prompt('Hi', 'followUp');
  await until(() => said(offBot, 'No KB.'), 'off-KB bot answers');
  assert.doesNotMatch(instructionsText(offBot.requests[0]), /<knowledge-index/);

  // Non-fresh forked sub-bot makes ZERO /api/knowledge/page calls and keeps parent instructions byte-identical;
  // fresh sub-bot fetches and injects <knowledge-index>.
  const registry = tempRegistry(t);
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bots-kb-fork-'));
  t.after(() => fs.rmSync(botsDir, { recursive: true, force: true }));
  const parentRow = registry.create({ name: 'Parent', identity: 'You are Parent.', model: 'faux/faux-1' }, { actor: 'user' });
  const kbCallsByBot: string[] = [];
  let forkedChild: Harness | undefined;
  let freshChild: Harness | undefined;
  const routes = hubOf(createBotHandlers(() => registry, botControl(new Map(), [], async row => {
    const childHarness = await openTestBot(t, noSessions, {
      botsDir, row: () => registry.get(row.id)!, api: combinedHub,
      responses: faux => [faux.fauxAssistantMessage(`${row.name} ready.`)],
    });
    if (row.name === 'Forked') forkedChild = childHarness;
    if (row.name === 'Fresh') freshChild = childHarness;
  })));
  const combinedHub: HubApi = async (pathname, body) => {
    if (pathname.startsWith('/api/knowledge/page')) {
      kbCallsByBot.push(pathname);
      if (pathname.includes('scope=bot')) {
        const id = new URL(pathname, 'http://hub').searchParams.get('botId')!;
        return { path: `bots/${id}/index.md`, scope: 'bot', botId: id, text: 'This bot has no knowledge base pages yet.\n', revision: null };
      }
      return { path: 'index.md', scope: 'shared', text: '# Knowledge\n\n- [Hub](topics/hub.md): Beelink hub\n', revision: '1234567890ab' };
    }
    return routes(pathname, body);
  };
  const parentBot = await openTestBot(t, noSessions, { botsDir, row: () => registry.get(parentRow.id)!, api: combinedHub });
  parentBot.respond(
    parentBot.faux.fauxAssistantMessage([parentBot.faux.fauxToolCall('bot_create', {
      name: 'Forked', purpose: 'Handle fork.', identity: 'You are Forked.',
    })], { stopReason: 'toolUse' }),
    parentBot.faux.fauxAssistantMessage('Created Forked.'),
    parentBot.faux.fauxAssistantMessage([parentBot.faux.fauxToolCall('bot_create', {
      name: 'Fresh', purpose: 'Handle fresh.', identity: 'You are Fresh.', fresh: true,
    })], { stopReason: 'toolUse' }),
    parentBot.faux.fauxAssistantMessage('Created Fresh.'),
  );
  kbCallsByBot.length = 0;
  await parentBot.runtime.prompt('Create a forked child', 'followUp');
  await until(() => !!forkedChild && said(forkedChild, 'Forked ready.') && said(parentBot, 'Created Forked.'), 'forked child answers');
  assert.deepEqual(kbCallsByBot, [], 'non-fresh forked sub-bot makes zero KB index fetches on open');
  assert.deepStrictEqual(forkedChild!.requests[0].slice(0, -1), parentBot.requests[0], 'forked sub-bot keeps parent prefix byte-identical');

  await parentBot.runtime.prompt('Create a fresh child', 'followUp');
  await until(() => !!freshChild && said(freshChild, 'Fresh ready.') && said(parentBot, 'Created Fresh.'), 'fresh child answers');
  assert.equal(kbCallsByBot.length, 2, 'fresh sub-bot fetches shared + bot indexes on open');
  assert.match(systemText(freshChild!.requests[0]), /<knowledge-index scope=\\"shared\\">[^]*Beelink hub/);
  assert.match(systemText(freshChild!.requests[0]), /<knowledge-index scope=\\"bot\\">/);
});

test('kb_read/kb_write/kb_search enforce required scope, expose revision to codemode, label scopes, and surface 409 conflicts and warnings', async t => {
  const posted: unknown[] = [];
  const api: HubApi = async (pathname, body) => {
    if (pathname === '/api/knowledge/page' || pathname.startsWith('/api/knowledge/page?scope=bot&')) throw new Error('off');
    if (pathname.startsWith('/api/knowledge/search')) {
      return {
        total: 3,
        results: [
          { path: 'topics/beelink.md', scope: 'shared', lines: [{ line: 3, text: 'Hub host.' }] },
          { path: `bots/${BOT.id}/topics/notes.md`, scope: 'bot', botId: BOT.id, botName: 'Fleet', lines: [{ line: 3, text: 'Own note.' }] },
          { path: 'bots/chief-1/topics/policy.md', scope: 'bot', botId: 'chief-1', botName: 'Chief', lines: [{ line: 3, text: 'Ancestor note.' }] },
        ],
      };
    }
    if (pathname.startsWith('/api/knowledge/page?')) {
      return { path: 'topics/beelink.md', scope: 'shared', revision: 'deadbeef1234', text: '# Beelink\n\nHub.\n' };
    }
    if (pathname === '/api/knowledge/pages') {
      posted.push(body);
      const b = body as Record<string, unknown>;
      if (b.revision === 'stale0000000') {
        throw new Error('Conflict: "topics/beelink.md" is at revision deadbeef1234, not "stale0000000".');
      }
      return {
        path: 'topics/beelink.md', scope: 'shared', created: false, revision: 'faceb00c9999',
        pageBytes: 17000, commit: 'abcdef', pushed: true,
        warning: 'topics/beelink.md is now 17000 bytes (over the 16384-byte guideline).',
      };
    }
    throw new Error(`unexpected ${pathname}`);
  };

  const bot = await openTestBot(t, noSessions, { api });
  bot.respond(
    // Missing scope refused before hitting hub, explaining bot vs shared.
    toolCall(bot, 'kb_write', { page: 'beelink', text: 'fact', source: 'cmd', summary: 'Beelink' }),
    // kb_search labels shared, own bot, and read-only ancestor bot.
    toolCall(bot, 'kb_search', { query: 'note' }),
    // kb_read returns revision in structuredOutput for codemode.
    script(bot, 'return await tools.kb_read({ page: "beelink" });'),
    // kb_write with stale revision surfaces 409 conflict as isError: true.
    toolCall(bot, 'kb_write', { page: 'beelink', scope: 'shared', mode: 'replace', text: '# Beelink\n\n(Source: x)', revision: 'stale0000000' }),
    // kb_write with current revision + droppedSources succeeds and prints Warning.
    toolCall(bot, 'kb_write', {
      page: 'beelink', scope: 'shared', mode: 'replace', text: '# Beelink\n\n(Source: x)',
      summary: 'Updated hub summary', revision: 'deadbeef1234', droppedSources: ['old source'],
    }),
    bot.faux.fauxAssistantMessage('All checked.'),
  );
  await bot.runtime.prompt('Exercise KB tools', 'followUp');
  await until(() => said(bot, 'All checked.'), 'KB tool run completes');

  const results = toolResults(bot);
  assert.equal(results[0].isError, true);
  assert.match(textOf(results[0]), /scope is required.*"bot".*"shared"/);

  assert.equal(textOf(results[1]), [
    '[shared] topics/beelink.md\n  3: Hub host.',
    `[bot] bots/${BOT.id}/topics/notes.md\n  3: Own note.`,
    '[bot: Chief, read-only] bots/chief-1/topics/policy.md\n  3: Ancestor note.',
  ].join('\n\n'));

  assert.deepEqual(returned(results[2]), {
    path: 'topics/beelink.md', scope: 'shared', revision: 'deadbeef1234', text: '# Beelink\n\nHub.\n',
  });

  assert.equal(results[3].isError, true);
  assert.match(textOf(results[3]), /Conflict: "topics\/beelink\.md" is at revision deadbeef1234/);

  assert.equal(results[4].isError, false);
  assert.match(textOf(results[4]), /Saved: topics\/beelink\.md \(revision faceb00c9999\)\. Warning: topics\/beelink\.md is now 17000 bytes/);
  assert.deepEqual(posted[1], {
    page: 'beelink', scope: 'shared', botId: BOT.id, botName: 'Fleet', mode: 'replace',
    text: '# Beelink\n\n(Source: x)', author: 'Fleet',
    summary: 'Updated hub summary', revision: 'deadbeef1234', droppedSources: ['old source'],
  });
});

test('at 90%-96% with an unsaved notebook, pi-dish grants one durable rescue turn; saving and calling new_context rolls over cleanly', async t => {
  // fauxProvider estimates tokens as ceil(chars / 4); with contextWindow = 100_000 and ~8k system tokens,
  // a ~340k-char prompt lands cleanly at ~93% (>= 90% FORCED_RATIO and < 97% HARD_FORCED_RATIO).
  const bot = await openTestBot(t, noSessions, { contextWindow: 100_000 });
  bot.respond(
    bot.faux.fauxAssistantMessage('Finished the task.'),
    // Rescue turn arrives: bot saves notebook and calls new_context.
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('context_notes', { action: 'write', text: 'Rescued facts.' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('new_context', { summary: 'Rescued before limit' })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Rolled over cleanly.'),
  );
  await bot.runtime.prompt(`Do some heavy work ${'w'.repeat(340_000)}`, 'followUp');
  await until(() => said(bot, 'Rolled over cleanly.'), 'rescue turn completes rollover');

  const limits = customs(bot, 'bot-context-limit');
  assert.equal(limits.length, 1);
  assert.match(limits[0], /^\[pi-dish: this context window is 9\d% full and your notebook has not been saved in this window\./);

  const marker = bot.mirrorLines().find(line => line.customType === 'bot-context-window');
  assert.ok(marker, 'window rolled over');
  assert.match(textOf(marker), /1\. Rescued before limit/);
  assert.doesNotMatch(textOf(marker), /WARNING:/, 'no unsaved warning when rescue succeeded');
  assert.match(instructionsText(bot.requests.at(-1)!), /Rescued facts\./);
});

test('ignoring the 90% rescue turn force-closes after one turn with an unsaved-notebook WARNING, and >=97% skips the rescue turn', async t => {
  // Case 1: ~93% unsaved, bot ignores rescue turn -> force-closes after that one turn with WARNING.
  const ignoringBot = await openTestBot(t, noSessions, { contextWindow: 100_000 });
  ignoringBot.respond(
    ignoringBot.faux.fauxAssistantMessage('First answer.'),
    ignoringBot.faux.fauxAssistantMessage('I ignored the rescue.'),
  );
  await ignoringBot.runtime.prompt(`Heavy work ${'w'.repeat(340_000)}`, 'followUp');
  await until(() => ignoringBot.mirrorLines().some(line => line.customType === 'bot-context-window'), 'forced rollover after ignored rescue');
  assert.equal(customs(ignoringBot, 'bot-context-limit').length, 1, 'at most one rescue turn per window');
  const ignoredMarker = ignoringBot.mirrorLines().find(line => line.customType === 'bot-context-window');
  assert.match(textOf(ignoredMarker), /WARNING: Window 1 was closed at the context limit without saving your notebook in that window\./);
  assert.match(textOf(ignoredMarker), /history read or search on window 1/);
  assert.match(textOf(ignoredMarker), /Latest request: Heavy work /);
  assert.doesNotMatch(textOf(ignoredMarker), /Latest request: \[pi-dish: this context window is/);
  assert.doesNotMatch(textOf(ignoredMarker), /limit: \[pi-dish: this context window is/);

  // Case 2: ~98% (>= HARD_FORCED_RATIO) unsaved -> skips rescue turn, force-closes immediately with WARNING.
  const hardBot = await openTestBot(t, noSessions, { contextWindow: 100_000 });
  hardBot.respond(
    hardBot.faux.fauxAssistantMessage('Spiked past 97%.'),
  );
  await hardBot.runtime.prompt(`Huge spike ${'w'.repeat(380_000)}`, 'followUp');
  await until(() => hardBot.mirrorLines().some(line => line.customType === 'bot-context-window'), 'immediate forced rollover at >=97%');
  assert.equal(customs(hardBot, 'bot-context-limit').length, 0, 'skips rescue turn at >=97%');
  const hardMarker = hardBot.mirrorLines().find(line => line.customType === 'bot-context-window');
  assert.match(textOf(hardMarker), /WARNING: Window 1 was closed at the context limit without saving your notebook in that window\./);
});

/** A clock and timer a test moves by hand: `advance` runs each timer that falls due. */
function fakeClock() {
  let now = Date.now();
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    clock: {
      now: () => now,
      setTimeout(run: () => void, ms: number) { timers.set(++next, { at: now + ms, run }); return next; },
      clearTimeout(handle: unknown) { timers.delete(handle as number); },
    },
    pending: () => [...timers.values()].map(timer => timer.at),
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(handle);
        timer.run();
      }
    },
  };
}

const MINUTE = 60_000;
/** faux answers with a 1h fixed cache, as Claude Code's subscription route does; the floor is half of a 30k window. */
function idlePorts(clock: ReturnType<typeof fakeClock>, records: IdleRolloverRecord[], settings: Record<string, unknown> = {},
  retention = { retentionMs: 60 * MINUTE, retention: '1h' }, nextRoutineAt: number | null = null): IdleRolloverPorts {
  return {
    settings: () => settings,
    cacheRetention: () => ({ revision: 'faux', rules: [{ provider: 'faux', model: '', basis: 'fixed', ...retention }] }),
    nextRoutineAt: () => nextRoutineAt,
    record: entry => records.push(entry),
    clock: clock.clock,
  };
}

/** Decisions after start: the plan at start races the first prompt, so tests that count decisions leave it out. */
const decided = (records: IdleRolloverRecord[], event: string, outcome: string) =>
  records.filter(entry => entry.source !== 'start' && entry.event === event && entry.outcome === outcome);
/** About 60% of a 30k window: over the floor, under the early trigger. */
const MID_WINDOW = `Remember that tycho runs the backups. ${'w'.repeat(40_000)}`;

/**
 * A bot past the floor on a 1h cache with its timer armed; `row` may be a mutable registry row. The last request is a
 * short one, so the next window's handoff (which repeats it) stays under the floor.
 */
async function armedBot(t: test.TestContext, options: { row?: () => BotRow; sessions?: SessionsPort; settings?: Record<string, unknown>;
  retention?: { retentionMs: number; retention: string } } = {}) {
  const time = fakeClock();
  const records: IdleRolloverRecord[] = [];
  const bot = await openTestBot(t, options.sessions ?? noSessions, {
    contextWindow: 30_000, row: options.row, idleRollover: idlePorts(time, records, options.settings, options.retention),
  });
  bot.respond(bot.faux.fauxAssistantMessage('Noted.'), bot.faux.fauxAssistantMessage('Good.'));
  await bot.runtime.prompt(MID_WINDOW, 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 1, 'armed');
  await bot.runtime.prompt('That is all for now.', 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 2, 'armed after the last turn');
  return { bot, time, records };
}

const requestHas = (messages: Message[], text: string) => messages.some(message => textOf(message).includes(text));
/** The draft's request goes to a fork; every other request is the live conversation's. */
const DRAFT_MARK = 'opening a fresh window';
const liveRequests = (bot: Harness) => bot.requests.filter(request => !requestHas(request, DRAFT_MARK));
const DRAFT = 'Summary: Backups on tycho\n<<<NOTEBOOK\ntycho runs the backups.\nNOTEBOOK>>>';

/** Waits until the bot has no run and nothing queued: drafts in forks count as runs. */
async function untilSettled(bot: Harness, message: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { running, queued } = await bot.runtime.activity();
    if (!running && !queued) return;
    if (Date.now() > deadline) throw new Error(`timed out: ${message}`);
    await new Promise(resolve => setImmediate(resolve));
  }
}

/** A response that waits until the test opens it: a draft kept in flight. */
function held(step: () => Step) {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  let started = false;
  const response: Step = async (...args) => {
    started = true;
    await opened;
    const value = step();
    return typeof value === 'function' ? value(...args) : value;
  };
  return { response, open, started: () => started };
}

test('idle rollover: 6 min before a 1h cache expires, a fork drafts the notebook and the new window opens in one commit', async t => {
  const spawned: string[][] = [];
  const sessions: SessionsPort = async (args) => { spawned.push(args); throw new Error('no sessions here'); };
  const { bot, time, records } = await armedBot(t, { sessions });
  const armed = decided(records, 'plan', 'armed').at(-1)!;
  assert.equal(armed.trigger, 'expiry');
  assert.equal(armed.retention, '1h');
  assert.ok(Number(armed.percent) >= 50 && Number(armed.percent) < 75, `window at ${armed.percent}%`);
  assert.equal(Date.parse(String(armed.dueAt)), Date.parse(String(armed.expiresAt)) - 6 * MINUTE, 'due 6 min before expiry');
  assert.deepEqual(time.pending(), [Date.parse(String(armed.dueAt))]);

  // The draft tries a tool first: it is blocked, and the draft answers.
  bot.respond(toolCall(bot, 'spawn_worker', { name: 'x', brief: 'do something' }), bot.faux.fauxAssistantMessage(DRAFT));
  time.advance(53 * MINUTE);
  assert.ok(!bot.requests.some(request => requestHas(request, DRAFT_MARK)), 'nothing before the due time');
  time.advance(MINUTE + 1_000);
  await until(() => decided(records, 'result', 'rolled-over').length === 1, 'the window is rolled over');
  assert.deepEqual(spawned, [], 'no tool ran in the draft');

  const drafts = bot.requests.filter(request => requestHas(request, DRAFT_MARK));
  assert.ok(requestHas(drafts[0], 'Remember that tycho runs the backups.'), 'the draft reads the whole window');
  // Anthropic's prompt cache is keyed by the request prefix, not a session: the fork's first request is the live
  // conversation's last request, byte for byte (system, instructions, every message), then its answer and the draft
  // request. (faux keys its simulated cache by provider session, which a fork does not share, so it reports no read.)
  const lastLive = liveRequests(bot).filter(request => bot.requests.indexOf(request) < bot.requests.indexOf(drafts[0])).at(-1)!;
  assert.deepEqual(drafts[0].slice(0, -2), lastLive, 'the same prefix');
  assert.equal(textOf(drafts[0].at(-2)), 'Good.', 'then the last answer');
  assert.match(textOf(drafts[0].at(-1)), /^\[pi-dish: this context window is/);
  const marker = bot.mirrorLines().find(line => line.customType === 'bot-context-window');
  const details = marker?.details as Record<string, unknown>;
  assert.deepEqual({ idle: details.idleRollover, expiresAt: details.expiresAt }, { idle: true, expiresAt: Date.parse(String(armed.expiresAt)) });
  const handoff = textOf(marker);
  assert.match(handoff, /1\. Backups on tycho/);
  assert.match(handoff, /Latest request: That is all for now\./);
  assert.match(handoff, /While you were idle, pi-dish opened this window before the prompt cache expired/);
  assert.ok(!bot.mirrorLines().some(line => JSON.stringify(line).includes(DRAFT_MARK)), 'the draft never reaches the transcript');
  assert.deepEqual(records.filter(entry => entry.source !== 'start').map(entry => `${String(entry.event)}:${String(entry.outcome)}`),
    ['plan:armed', 'plan:armed', 'fire:triggered', 'result:rolled-over']);

  // The next message starts the small window: the handoff and the message, the drafted notebook in the instructions.
  bot.respond(bot.faux.fauxAssistantMessage('Hello again.'));
  await bot.runtime.prompt('Back again', 'followUp');
  await until(() => said(bot, 'Hello again.'), 'answered');
  const next = liveRequests(bot).at(-1)!;
  assert.deepEqual(next.filter(message => message.role !== 'system').map(message => message.role), ['user', 'user']);
  assert.match(textOf(next.find(message => message.role === 'user')), /^\[Context window 2\./);
  assert.match(instructionsText(next), /tycho runs the backups\./);
  await until(() => records.some(entry => entry.event === 'return'), 'the return is logged');
  const back = records.find(entry => entry.event === 'return')!;
  assert.deepEqual([back.input, back.beforeExpiry, back.key], ['pi.user', true, `${String(decided(records, 'result', 'rolled-over')[0].head)}:return`]);
});

test('idle rollover: a draft that is not a notebook changes nothing, and the window gets one attempt', async t => {
  const { bot, time, records } = await armedBot(t);
  bot.respond(bot.faux.fauxAssistantMessage('I will keep this window.'));
  time.advance(55 * MINUTE);
  await until(() => decided(records, 'result', 'not-rolled-over').length === 1, 'the draft is refused');
  assert.match(String(decided(records, 'result', 'not-rolled-over')[0].reason), /not in the Summary/);
  assert.ok(!bot.mirrorLines().some(line => line.customType === 'bot-context-window'));

  bot.respond(bot.faux.fauxAssistantMessage('Sure.'));
  await bot.runtime.prompt('One more thing', 'followUp');
  await until(() => decided(records, 'plan', 'skipped').length === 1, 'planned after the next turn');
  assert.equal(decided(records, 'plan', 'skipped')[0].reason, 'already tried in this window');
  assert.ok(!liveRequests(bot).some(request => requestHas(request, 'I will keep this window.')), 'the declined draft is not in the live context');
  assert.deepEqual(time.pending(), []);
});

test('idle rollover: off per bot, a 5m cache, a small window or a routine due arm nothing; input before the due time cancels the timer', async t => {
  const cases: [string, Partial<{ settings: Record<string, unknown>; retention: { retentionMs: number; retention: string }; routine: boolean; prompt: string }>, RegExp][] = [
    ['off for this bot', { settings: { botIdleRollover: { bots: { Fleet: { enabled: false } } } } }, /^turned off in settings$/],
    ['5m cache', { retention: { retentionMs: 5 * MINUTE, retention: '5m' } }, /the 5m cache is shorter than 30 min/],
    ['small window', { prompt: 'Hi' }, /k tokens is under the 15k floor/],
    ['routine due', { routine: true }, /^a routine runs at .* before the cache expires$/],
  ];
  for (const [name, options, reason] of cases) {
    const time = fakeClock();
    const records: IdleRolloverRecord[] = [];
    const bot = await openTestBot(t, noSessions, { contextWindow: 30_000, idleRollover: idlePorts(time, records, options.settings,
      options.retention, options.routine ? time.clock.now() + 30 * MINUTE : null) });
    bot.respond(bot.faux.fauxAssistantMessage('Noted.'));
    await bot.runtime.prompt(options.prompt ?? MID_WINDOW, 'followUp');
    await until(() => decided(records, 'plan', 'skipped').length === 1, `${name}: planned`);
    assert.match(String(decided(records, 'plan', 'skipped')[0].reason), reason, name);
    assert.deepEqual(time.pending(), [], `${name}: no timer`);
  }

  const time = fakeClock();
  const records: IdleRolloverRecord[] = [];
  const bot = await openTestBot(t, noSessions, { contextWindow: 30_000, idleRollover: idlePorts(time, records) });
  bot.respond(bot.faux.fauxAssistantMessage('Noted.'), bot.faux.fauxAssistantMessage('Answered.'));
  await bot.runtime.prompt(MID_WINDOW, 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 1, 'armed');
  time.advance(20 * MINUTE);
  await bot.runtime.prompt('A question', 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 2, 'the next run end arms again');
  assert.equal(time.pending().length, 1, 'the first timer was cleared');
  assert.ok(!bot.requests.some(request => requestHas(request, DRAFT_MARK)));
});

// Regressions from the reviews: each reproduces the reviewer's scenario.

test('idle rollover regression: input that enters the relay after the plan, before the draft starts, wins', async t => {
  const { bot, time, records } = await armedBot(t);
  bot.respond(bot.faux.fauxAssistantMessage('Answered the question.'), bot.faux.fauxAssistantMessage(DRAFT));
  // The timer fires and plans synchronously up to its first read; the prompt enters before the draft's commit.
  time.advance(55 * MINUTE);
  await bot.runtime.prompt('A real question', 'steer');
  await until(() => said(bot, 'Answered the question.'), 'the question is answered');
  await until(() => records.some(entry => entry.event === 'fire'), 'the fire is logged');
  const fire = records.find(entry => entry.event === 'fire')!;
  const settled = fire.outcome === 'triggered' ? decided(records, 'result', 'not-rolled-over')[0]?.reason : fire.reason;
  assert.match(String(settled), /^(input arrived first|input arrived during the draft|a turn is running|the transcript changed since the plan|a run started or a newer plan replaced this one)$/);
  // The clock runs 55 min ahead of the answers' timestamps, so a later plan may roll over: only after the question.
  const lines = bot.mirrorLines();
  const marker = lines.findIndex(line => line.customType === 'bot-context-window');
  const answered = lines.findIndex(line => line.type === 'message' && textOf(line.message) === 'Answered the question.');
  assert.ok(marker === -1 || marker > answered, 'no window opened over the question');
  assert.ok(!requestHas(liveRequests(bot).find(request => requestHas(request, 'A real question'))!, '[Context window 2'));
});

test('idle rollover regression 1: ending a draft never withdraws input: a steer and a room message sent during it both run', async t => {
  const { bot, time, records } = await armedBot(t);
  const draft = held(() => bot.faux.fauxAssistantMessage(DRAFT));
  const echo: Step = context => bot.faux.fauxAssistantMessage(`echo: ${textOf(context.messages.filter(message => message.role === 'user').at(-1))}`);
  bot.respond(draft.response, echo, echo, echo);
  time.advance(55 * MINUTE);
  await until(draft.started, 'the draft is in flight');
  await bot.runtime.deliver({ kind: 'room', requestId: 'room:1', text: '[room] Ops to Fleet: the disk on tycho is full.', data: { messageId: 1, hop: 1 } });
  await bot.runtime.prompt('Urgent question', 'steer');
  draft.open();
  await until(() => liveRequests(bot).some(request => requestHas(request, 'Urgent question')) && liveRequests(bot).some(request => requestHas(request, 'the disk on tycho is full')), 'both reach the model');
  await untilSettled(bot, 'nothing is left running or queued');
  assert.equal(decided(records, 'result', 'not-rolled-over')[0]?.reason, 'input arrived during the draft');
  assert.ok(!bot.mirrorLines().some(line => line.customType === 'bot-context-window'), 'the voided draft opens no window');
  assert.ok(!bot.requests.filter(request => requestHas(request, DRAFT_MARK)).some(request => requestHas(request, 'Urgent question')), 'the draft never sees live input');
  assert.ok(!instructionsText(liveRequests(bot).at(-1)!).includes('tycho runs the backups.'), 'the instructions keep the old notebook');
});

test('idle rollover regression 2: a failed draft, a restart during one and a declined one leave the live conversation untouched', async t => {
  // A provider error: nothing in the live conversation, nothing queued.
  const failed = await armedBot(t);
  failed.bot.respond(failed.bot.faux.fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'provider down' }));
  failed.time.advance(55 * MINUTE);
  await until(() => decided(failed.records, 'result', 'not-rolled-over').length === 1, 'the failed draft settles');
  assert.match(String(decided(failed.records, 'result', 'not-rolled-over')[0].reason), /^the draft ended unanswered/);
  assert.deepEqual(await failed.bot.runtime.activity(), { running: false, queued: false });
  failed.bot.respond(failed.bot.faux.fauxAssistantMessage('Still here.'));
  await failed.bot.runtime.prompt('Hello?', 'followUp');
  await until(() => said(failed.bot, 'Still here.'), 'the next message runs');
  assert.ok(!requestHas(liveRequests(failed.bot).at(-1)!, 'pi-dish: this context window'), 'no rollover instruction in the live context');

  // A restart while the draft is in flight: the new relay abandons it; nothing is left running or queued.
  const restarted = await armedBot(t);
  const draft = held(() => restarted.bot.faux.fauxAssistantMessage(DRAFT));
  restarted.bot.respond(draft.response);
  restarted.time.advance(55 * MINUTE);
  await until(draft.started, 'the draft is in flight');
  const closing = restarted.bot.reopen();
  draft.open();
  await closing;
  await until(() => restarted.records.some(entry => entry.event === 'result' && entry.recovered === true), 'the new relay settles the draft');
  assert.equal(restarted.records.find(entry => entry.event === 'result')?.reason, 'the relay restarted during the draft');
  assert.deepEqual(await restarted.bot.runtime.activity(), { running: false, queued: false });
  assert.ok(!restarted.bot.mirrorLines().some(line => line.customType === 'bot-context-window'));
  restarted.bot.respond(restarted.bot.faux.fauxAssistantMessage('Back.'));
  await restarted.bot.runtime.prompt('After the restart', 'followUp');
  await until(() => said(restarted.bot, 'Back.'), 'answered');
  assert.ok(!requestHas(liveRequests(restarted.bot).at(-1)!, 'pi-dish: this context window'));
});

test('idle rollover regression: a fork.submit() failure clears draft, settles idleAttempt, and does not block later planning', async t => {
  const durable = await import('@earendil-works/pi-durable');
  const originalOpen = durable.Harness.open;
  t.after(() => { durable.Harness.open = originalOpen; });
  const failFirstForkSubmit = (message: string) => {
    let failed = 0;
    durable.Harness.open = async (...args) => {
      const harness = await originalOpen.apply(durable.Harness, args);
      const originalConversation = harness.conversation.bind(harness);
      harness.conversation = async (id, context) => {
        const conv = await originalConversation(id, context);
        if (conv && id !== durable.ROOT_CONVERSATION_ID && failed === 0) {
          const originalSubmit = conv.submit.bind(conv);
          conv.submit = ((...submitArgs: Parameters<typeof conv.submit>) => {
            if (failed === 0) {
              failed++;
              return Promise.reject(new Error(message));
            }
            return originalSubmit(...submitArgs);
          }) as typeof conv.submit;
        }
        return conv;
      };
      return harness;
    };
    return () => failed;
  };

  const failedSubmits = failFirstForkSubmit('fork submit boom');
  const { bot, time, records } = await armedBot(t);
  durable.Harness.open = originalOpen;

  time.advance(55 * MINUTE);
  await until(() => decided(records, 'result', 'not-rolled-over').length === 1, 'failed fork.submit settles attempt');
  assert.equal(failedSubmits(), 1);
  assert.equal(decided(records, 'result', 'not-rolled-over')[0].reason, 'the draft failed: fork submit boom');
  assert.ok(records.some(entry => entry.event === 'fire' && entry.outcome === 'triggered'));
  assert.deepEqual(await bot.runtime.activity(), { running: false, queued: false });

  // draft must be cleared so reconsiderIdle() still plans (and sees already-tried, not busy).
  bot.runtime.reconsiderIdle();
  await until(() => records.some(entry => entry.source === 'change' && entry.outcome === 'skipped'), 'reconsiderIdle plans after submit failure');
  const afterFailure = records.filter(entry => entry.source === 'change').at(-1)!;
  assert.equal(afterFailure.reason, 'already tried in this window');

  // Opening a new window on the SAME runtime instance must allow idle rollover to arm and complete cleanly.
  bot.respond(
    toolCall(bot, 'context_notes', { action: 'write', text: 'Saved before window 2.' }),
    toolCall(bot, 'new_context', { summary: 'Window 1 done' }),
    bot.faux.fauxAssistantMessage('Opened window 2.'),
  );
  await bot.runtime.prompt('Open a fresh window', 'followUp');
  await until(() => said(bot, 'Opened window 2.'), 'window 2 opened');

  const armedBefore = decided(records, 'plan', 'armed').length;
  bot.respond(
    bot.faux.fauxAssistantMessage('Filled window 2.', { timestamp: time.clock.now() }),
    bot.faux.fauxAssistantMessage('Done.', { timestamp: time.clock.now() }),
    bot.faux.fauxAssistantMessage(DRAFT, { timestamp: time.clock.now() }),
  );
  await bot.runtime.prompt(MID_WINDOW, 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === armedBefore + 1, 'window 2 arms idle rollover');
  await bot.runtime.prompt('Done for now.', 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === armedBefore + 2, 'window 2 re-arms after short turn');
  time.advance(55 * MINUTE);
  await until(() => decided(records, 'result', 'rolled-over').length === 1, 'window 2 rolls over without being blocked by leaked draft');

  // Reopening after a fork.submit() failure must NOT see an unsettled idleAttempt needing recovery.
  failFirstForkSubmit('second submit boom');
  const persisted = await armedBot(t);
  durable.Harness.open = originalOpen;
  persisted.time.advance(55 * MINUTE);
  await until(() => decided(persisted.records, 'result', 'not-rolled-over').length === 1, 'second failed submit settles');
  await persisted.bot.reopen();
  assert.equal(persisted.records.filter(entry => entry.event === 'result').length, 1, 'reopen does not recover an already-settled attempt');
});

test('idle rollover regression 3: after a restart that follows the new window, a steer starts its own run in it', async t => {
  const { bot, time, records } = await armedBot(t);
  bot.respond(bot.faux.fauxAssistantMessage(DRAFT));
  time.advance(55 * MINUTE);
  await until(() => decided(records, 'result', 'rolled-over').length === 1, 'rolled over');
  await bot.reopen();
  assert.deepEqual(await bot.runtime.activity(), { running: false, queued: false }, 'no rollover run exists to join');
  bot.respond(bot.faux.fauxAssistantMessage('Answering the urgent question.'));
  await bot.runtime.prompt('Urgent question', 'steer');
  await until(() => said(bot, 'Answering the urgent question.'), 'the steer is answered');
  const answering = liveRequests(bot).at(-1)!;
  assert.match(textOf(answering.find(message => message.role === 'user')), /^\[Context window 2\./);
  assert.equal(textOf(answering.at(-1)), 'Urgent question');
  assert.ok(!requestHas(answering, 'pi-dish: this context window'));
  assert.equal(records.filter(entry => entry.event === 'result').length, 1, 'the restart does not log the result again');
});

test('idle rollover regression 4: two forced closes at the hard limit close one window, with the notebook and the reset together', async t => {
  const bot = await openTestBot(t, noSessions, { contextWindow: 100_000 });
  let raced = false;
  const push = bot.events.push.bind(bot.events);
  bot.events.push = (...items) => {
    // The run's end and a prompt both find the window at the hard limit.
    if (!raced && items.some(item => item.event === 'agent_end')) {
      raced = true;
      void bot.runtime.prompt('Next question', 'followUp');
    }
    return push(...items);
  };
  bot.respond(
    bot.faux.fauxAssistantMessage('Spiked past 97%.'),
    bot.faux.fauxAssistantMessage('Next answered.'),
    toolCall(bot, 'history', { action: 'windows' }),
    bot.faux.fauxAssistantMessage('Listed.'),
  );
  await bot.runtime.prompt(`Huge spike ${'w'.repeat(380_000)}`, 'followUp');
  await until(() => said(bot, 'Next answered.'), 'the next question is answered');
  await bot.runtime.prompt('Which windows are there?', 'followUp');
  await until(() => said(bot, 'Listed.'), 'history answers');
  // Memory agrees with the transcript: one closed window per marker, and one current window, the last. (The handoff
  // repeats the huge latest request, so the next window may legitimately close at the limit too.)
  const listed = textOf(toolResults(bot).at(-1)).split('\n');
  const closes = bot.mirrorLines().filter(line => line.customType === 'bot-context-window').length;
  assert.equal(listed.length, closes + 1, listed.join('\n'));
  assert.equal(listed.filter(line => line.includes('(current window)')).length, 1, 'one current window');
  assert.match(listed.at(-1)!, /^\d+\. \(current window\)/);
  assert.match(listed[0], /^1\. Closed at the context limit\./);
  // The race closed window 1 once: the prompt's request is in window 2, after exactly one marker.
  const asked = liveRequests(bot).find(request => requestHas(request, 'Next question'))!;
  assert.match(textOf(asked.find(message => message.role === 'user')), /^\[Context window 2\./);
});

test('idle rollover regression 5: a pause or a model change ends a draft in flight, and the new relay abandons it', async t => {
  let row: BotRow = { ...BOT };
  const paused = await armedBot(t, { row: () => row });
  const first = held(() => paused.bot.faux.fauxAssistantMessage(DRAFT));
  paused.bot.respond(first.response);
  paused.time.advance(55 * MINUTE);
  await until(first.started, 'the draft is in flight');
  row = { ...row, status: 'paused' };
  paused.bot.runtime.reconsiderIdle();
  first.open();
  await until(() => decided(paused.records, 'result', 'not-rolled-over').length === 1, 'the pause ends the draft');
  assert.equal(decided(paused.records, 'result', 'not-rolled-over')[0].reason, 'the bot is paused');
  await untilSettled(paused.bot, 'the draft\u2019s fork stops');
  assert.ok(!paused.bot.mirrorLines().some(line => line.customType === 'bot-context-window'), 'no window opens for a paused bot');

  // The model changes and pi-dish restarts the relay on faux-2 while the draft runs: it is abandoned, never applied.
  let other: BotRow = { ...BOT };
  const switched = await armedBot(t, { row: () => other });
  const second = held(() => switched.bot.faux.fauxAssistantMessage(DRAFT));
  switched.bot.respond(second.response);
  switched.time.advance(55 * MINUTE);
  await until(second.started, 'the draft is in flight');
  other = { ...other, model: 'faux/faux-2' };
  const reopening = switched.bot.reopen();
  second.open();
  await reopening;
  await until(() => switched.records.some(entry => entry.event === 'result'), 'the draft settles');
  assert.match(String(switched.records.find(entry => entry.event === 'result')?.reason), /^(the bot's model is now faux\/faux-2; this relay runs faux\/faux-1|the relay restarted during the draft)$/);
  assert.ok(!switched.bot.mirrorLines().some(line => line.customType === 'bot-context-window'));
  switched.bot.respond(switched.bot.faux.fauxAssistantMessage('On faux-2.'));
  await switched.bot.runtime.prompt('Which model?', 'followUp');
  await until(() => said(switched.bot, 'On faux-2.'), 'answered on the new model');
  const answering = liveRequests(switched.bot).at(-1)!;
  assert.ok(requestHas(answering, 'Remember that tycho runs the backups.'), 'the old window is still the live one');
  assert.ok(!requestHas(answering, 'pi-dish: this context window') && !instructionsText(answering).includes('tycho runs the backups.'));
});

test('idle rollover regression: a 30-day TTL waits in bounded timer steps and plans again at each wake', async t => {
  const { time, records } = await armedBot(t, { retention: { retentionMs: 30 * 24 * 60 * MINUTE, retention: '30d' } });
  const MAX = 2 ** 31 - 1;
  const [due] = time.pending();
  assert.ok(due - time.clock.now() <= MAX, 'never longer than a Node timer can wait');
  time.advance(MAX);
  await until(() => records.some(entry => entry.event === 'fire'), 'the bounded wake plans again');
  const fire = records.find(entry => entry.event === 'fire')!;
  assert.equal(fire.outcome, 'armed');
  assert.equal(time.pending().length, 1);
  assert.equal(records.filter(entry => entry.event === 'fire').length, 1, 'one wake, no tight loop');
});

test('idle rollover regression: a pause disarms the timer and is refused when the timer fires; another model\u2019s answer anchors nothing', async t => {
  let row: BotRow = { ...BOT };
  const { bot, time, records } = await armedBot(t, { row: () => row });
  row = { ...row, status: 'paused' };
  bot.runtime.reconsiderIdle();
  await until(() => decided(records, 'plan', 'skipped').length === 1, 'the change is planned');
  assert.equal(decided(records, 'plan', 'skipped')[0].reason, 'the bot is paused');
  assert.deepEqual(time.pending(), [], 'disarmed');
  row = { ...row, status: 'active' };
  bot.runtime.reconsiderIdle();
  await until(() => decided(records, 'plan', 'armed').length === 3, 're-armed');
  row = { ...row, status: 'paused' };
  time.advance(55 * MINUTE);
  await until(() => records.some(entry => entry.event === 'fire'), 'fired');
  assert.equal(records.find(entry => entry.event === 'fire')?.reason, 'the bot is paused');
  assert.ok(!bot.requests.some(request => requestHas(request, DRAFT_MARK)));
  row = { ...row, status: 'active', model: 'faux/faux-2' };
  await bot.reopen();
  await until(() => records.filter(entry => entry.source === 'start').length === 2, 'the new relay plans');
  assert.equal(records.filter(entry => entry.source === 'start').at(-1)?.reason, 'the last answer is from faux/faux-1, not faux/faux-2');
  assert.deepEqual(time.pending(), []);
});

test('idle rollover regression: the result and the return survive a relay restart, once each', async t => {
  const { bot, time, records } = await armedBot(t);
  bot.respond(bot.faux.fauxAssistantMessage(DRAFT));
  time.advance(55 * MINUTE);
  await until(() => decided(records, 'result', 'rolled-over').length === 1, 'rolled over');
  await bot.reopen();
  await until(() => records.filter(entry => entry.source === 'start').length === 2, 'the new relay plans');
  bot.respond(bot.faux.fauxAssistantMessage('Welcome back.'));
  await bot.runtime.prompt('Back again', 'followUp');
  await until(() => records.some(entry => entry.event === 'return'), 'the return is logged after the restart');
  await until(() => said(bot, 'Welcome back.'), 'answered');
  assert.equal(records.filter(entry => entry.event === 'result').length, 1, 'the result is not logged again');
  await bot.reopen();
  await until(() => records.filter(entry => entry.source === 'start').length === 3, 'planned again');
  assert.equal(records.filter(entry => entry.event === 'return').length, 1, 'nor the return');
});

// Regressions from the third review: the apply step.

test('idle rollover regression 6: a draft cut off at its output limit, or a refusal shaped like a draft, never replaces the notebook', async t => {
  for (const [name, reason] of [['truncated', /^the draft (stopped with length|ended unanswered)/], ['refusal', /^the draft is not in the Summary/]] as const) {
    const { bot, time, records } = await armedBot(t);
    bot.respond(name === 'truncated'
      ? bot.faux.fauxAssistantMessage('Summary: Backups on tycho\n<<<NOTEBOOK\ntycho runs the back', { stopReason: 'length' })
      // The fourth review's case: a normal stop, a separator, and no notebook.
      : bot.faux.fauxAssistantMessage('I could not draft a notebook.\n---\nPlease try again later.'));
    time.advance(55 * MINUTE);
    await until(() => decided(records, 'result', 'not-rolled-over').length === 1, `${name}: the draft is refused`);
    assert.match(String(decided(records, 'result', 'not-rolled-over')[0].reason), reason, name);
    assert.ok(!bot.mirrorLines().some(line => line.customType === 'bot-context-window'), `${name}: no window opens`);
    bot.respond(bot.faux.fauxAssistantMessage('Still here.'));
    await bot.runtime.prompt('Hello?', 'followUp');
    await until(() => said(bot, 'Still here.'), `${name}: answered`);
    const instructions = instructionsText(liveRequests(bot).at(-1)!);
    assert.ok(!instructions.includes('tycho runs the back') && !instructions.includes('Please try again later.'), `${name}: the notebook is unchanged`);
  }
});

test('idle rollover regression 7: the draft is shown the notebook as stored, newer than the window\u2019s instructions', async t => {
  const time = fakeClock();
  const records: IdleRolloverRecord[] = [];
  const bot = await openTestBot(t, noSessions, { contextWindow: 30_000, idleRollover: idlePorts(time, records) });
  bot.respond(
    toolCall(bot, 'context_notes', { action: 'write', text: 'Fresh fact: tycho has the GPU.' }),
    bot.faux.fauxAssistantMessage('Noted.'),
    bot.faux.fauxAssistantMessage('Good.'),
  );
  await bot.runtime.prompt(MID_WINDOW, 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 1, 'armed');
  await bot.runtime.prompt('That is all for now.', 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 2, 'armed after the last turn');
  bot.respond(bot.faux.fauxAssistantMessage('Summary: GPU notes\n<<<NOTEBOOK\nFresh fact: tycho has the GPU.\ntycho runs the backups.\nNOTEBOOK>>>'));
  time.advance(55 * MINUTE);
  await until(() => decided(records, 'result', 'rolled-over').length === 1, 'rolled over');
  const draft = bot.requests.find(request => requestHas(request, DRAFT_MARK))!;
  assert.ok(!instructionsText(draft).includes('Fresh fact'), 'the window\u2019s instructions predate the write');
  assert.match(textOf(draft.at(-1)), /<notebook>\nFresh fact: tycho has the GPU\.\n<\/notebook>$/, 'the request ends with the stored notebook');
  assert.equal(textOf(draft.at(-2)), 'Good.', 'after the cached prefix');
});

test('idle rollover regression 8: after a failed run, no window opens over its unanswered request', async t => {
  const time = fakeClock();
  const records: IdleRolloverRecord[] = [];
  const bot = await openTestBot(t, noSessions, { contextWindow: 30_000, idleRollover: idlePorts(time, records) });
  bot.respond(bot.faux.fauxAssistantMessage('Noted.'), bot.faux.fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'provider down' }));
  await bot.runtime.prompt(MID_WINDOW, 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 1, 'armed');
  await bot.runtime.prompt('Check the backups', 'followUp');
  await until(() => decided(records, 'plan', 'skipped').length === 1, 'the failed run plans');
  assert.equal(decided(records, 'plan', 'skipped')[0].reason, 'the last run failed, so its request is unanswered');
  assert.deepEqual(time.pending(), [], 'no timer');
  time.advance(55 * MINUTE);
  assert.ok(!bot.requests.some(request => requestHas(request, DRAFT_MARK)), 'no draft');

  // A run that answers clears it: the window may roll over again, and the handoff's request was answered.
  bot.respond(bot.faux.fauxAssistantMessage('Backups are fine.'), bot.faux.fauxAssistantMessage(DRAFT));
  await bot.runtime.prompt('Check the backups again', 'followUp');
  await until(() => decided(records, 'result', 'rolled-over').length === 1, 'rolled over after an answered run');
  assert.match(textOf(bot.mirrorLines().find(line => line.customType === 'bot-context-window')), /Latest request: Check the backups again\nIt was answered in the last window\./);
});

// Regressions from the fourth review.

/** A bot whose window wrote `notebook` with context_notes, then went idle with its timer armed. */
async function armedWithNotebook(t: test.TestContext, notebook: string) {
  const time = fakeClock();
  const records: IdleRolloverRecord[] = [];
  const bot = await openTestBot(t, noSessions, { contextWindow: 30_000, idleRollover: idlePorts(time, records) });
  bot.respond(toolCall(bot, 'context_notes', { action: 'write', text: notebook }), bot.faux.fauxAssistantMessage('Noted.'), bot.faux.fauxAssistantMessage('Good.'));
  await bot.runtime.prompt(MID_WINDOW, 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 1, 'armed');
  await bot.runtime.prompt('That is all for now.', 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 2, 'armed after the last turn');
  return { bot, time, records };
}

test('idle rollover regression 9: a draft that drops more than half of a 1 KiB+ notebook is refused; an applied one keeps the old notebook for history', async t => {
  const facts = Array.from({ length: 40 }, (_, index) => `- fact ${index}: tycho serves backup set ${index}.`).join('\n');
  const shrunk = await armedWithNotebook(t, facts);
  shrunk.bot.respond(shrunk.bot.faux.fauxAssistantMessage('Summary: Backups\n<<<NOTEBOOK\n- tycho runs the backups.\nNOTEBOOK>>>'));
  shrunk.time.advance(55 * MINUTE);
  await until(() => decided(shrunk.records, 'result', 'not-rolled-over').length === 1, 'the shrunk draft is refused');
  assert.match(String(decided(shrunk.records, 'result', 'not-rolled-over')[0].reason),
    new RegExp(`^the drafted notebook is \\d+ bytes, under half of the ${Buffer.byteLength(facts)}-byte notebook it would replace$`));
  assert.ok(!shrunk.bot.mirrorLines().some(line => line.customType === 'bot-context-window'));

  const kept = await armedWithNotebook(t, 'Old fact: tycho runs the backups.');
  kept.bot.respond(kept.bot.faux.fauxAssistantMessage(DRAFT));
  kept.time.advance(55 * MINUTE);
  await until(() => decided(kept.records, 'result', 'rolled-over').length === 1, 'rolled over');
  const marker = kept.bot.mirrorLines().find(line => line.customType === 'bot-context-window');
  assert.equal((marker?.details as Record<string, unknown>).notebookBefore, 'Old fact: tycho runs the backups.');
  kept.bot.respond(kept.bot.faux.fauxAssistantMessage([kept.bot.faux.fauxToolCall('history', { action: 'read', window: 2 })], { stopReason: 'toolUse' }),
    kept.bot.faux.fauxAssistantMessage('Read.'));
  await kept.bot.runtime.prompt('What was in the notebook before?', 'followUp');
  await until(() => said(kept.bot, 'Read.'), 'history answers');
  assert.match(textOf(toolResults(kept.bot).at(-1)), /\[notebook before the idle rollover\] Old fact: tycho runs the backups\./);
});

test('idle rollover regression 10: after an answer cut off at its output limit, no window opens over its request', async t => {
  const time = fakeClock();
  const records: IdleRolloverRecord[] = [];
  const bot = await openTestBot(t, noSessions, { contextWindow: 30_000, idleRollover: idlePorts(time, records) });
  bot.respond(bot.faux.fauxAssistantMessage('Noted.'), bot.faux.fauxAssistantMessage('The backups are', { stopReason: 'length' }));
  await bot.runtime.prompt(MID_WINDOW, 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 1, 'armed');
  await bot.runtime.prompt('Check the backups', 'followUp');
  await until(() => decided(records, 'plan', 'skipped').length === 1, 'the cut-off run plans');
  assert.match(String(decided(records, 'plan', 'skipped')[0].reason), /^the (last answer stopped with length|last run failed), so its request is unanswered$/);
  assert.deepEqual(time.pending(), [], 'no timer');
  time.advance(55 * MINUTE);
  assert.ok(!bot.requests.some(request => requestHas(request, DRAFT_MARK)), 'no draft');
});

// Regressions from the fifth review: the draft's provider payload above 75%, and the handoff's size.

/** pi-ai's Anthropic Messages request for `context`, captured before it is sent. */
async function anthropicPayload(context: TranscriptContext): Promise<{ system: unknown; tools: unknown; messages: unknown[] }> {
  // pi-ai is ESM-only: this CommonJS test loads it dynamically, as openTestBot loads its faux provider.
  const api = await import('@earendil-works/pi-ai/api/anthropic-messages');
  const model = {
    id: 'claude-opus-4-5', name: 'Claude Opus', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'https://api.anthropic.com',
    reasoning: false, input: ['text', 'image'], cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, contextWindow: 200_000, maxTokens: 64_000,
  } as const;
  let payload: { system: unknown; tools: unknown; messages: unknown[] } | undefined;
  const client = { beta: { messages: { create: () => { throw new Error('captured, not sent'); } } } };
  const stream = api.stream(model as never, context, {
    client, onPayload: (params: unknown) => { payload = params as typeof payload; return params; },
  } as never);
  await stream.result();
  return payload!;
}

/** pi-claude-code's replay of `context` to the Claude Code CLI: the frames it feeds, which the CLI turns into its request. */
async function claudeCodeFrames(messages: readonly Message[]): Promise<unknown[]> {
  const root = path.dirname(require.resolve('@earendil-works/pi-claude-code/package.json'));
  const sources = url.pathToFileURL(path.join(root, 'src') + path.sep).href;
  // As bot-runtime loads the package: its TypeScript sources, transpiled on load.
  nodeModule.registerHooks({
    load(specifier, context, nextLoad) {
      if (!specifier.startsWith(sources) || !specifier.endsWith('.ts')) return nextLoad(specifier, context);
      const file = url.fileURLToPath(specifier);
      const { code } = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'esm', target: 'node22', sourcefile: file });
      return { format: 'module', source: code, shortCircuit: true };
    },
  });
  const transcript = await import(`${sources}transcript.ts`) as {
    prepareMessages(messages: readonly Message[], model: unknown): Message[];
    prepareFrames(messages: readonly Message[]): { shouldQuery?: boolean }[];
  };
  const model = { id: 'claude-opus-4-5', api: 'claude-code', provider: 'claude-code' };
  // `shouldQuery` only says which frame is the newest.
  return transcript.prepareFrames(transcript.prepareMessages(messages, model)).map(({ shouldQuery: _query, ...frame }) => frame);
}

/** What Anthropic's prefix cache compares: the content, without cache markers, a string as its one text block. */
function cacheContent(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, field: unknown) => {
    if (key === 'cache_control' || key === 'shouldQuery') return undefined;
    if (key === 'content' && typeof field === 'string') return [{ type: 'text', text: field }];
    return field;
  }));
}

test('idle rollover regression 11: above 75% the draft\u2019s prefix is the live request with its reminder, in pi-ai\u2019s Anthropic payload and the Claude Code replay', async t => {
  const time = fakeClock();
  const records: IdleRolloverRecord[] = [];
  const bot = await openTestBot(t, noSessions, { contextWindow: 30_000, idleRollover: idlePorts(time, records) });
  bot.respond(bot.faux.fauxAssistantMessage('Noted.'), bot.faux.fauxAssistantMessage('Good.'), bot.faux.fauxAssistantMessage(DRAFT));
  await bot.runtime.prompt(`Remember that tycho runs the backups. ${'w'.repeat(64_000)}`, 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 1, 'armed');
  await bot.runtime.prompt('That is all for now.', 'followUp');
  await until(() => decided(records, 'plan', 'armed').length === 2, 'armed after the last turn');
  assert.equal(decided(records, 'plan', 'armed')[1].trigger, 'early', 'the window is over 75%');
  const live = bot.contexts.at(-1)!;
  assert.match(textOf(live.messages.at(-1)), /^\[pi-dish: this context window is \d+% full\. Save your notebook/, 'the live request carries the reminder');
  time.advance(11 * MINUTE);
  await until(() => decided(records, 'result', 'rolled-over').length === 1, 'rolled over');
  const fork = bot.contexts.find(context => requestHas(context.messages, DRAFT_MARK))!;
  // A short latest request is quoted whole, once: the tail refers to it.
  const handoff = textOf(bot.mirrorLines().find(line => line.customType === 'bot-context-window'));
  assert.ok(handoff.includes('\nuser: (the latest request, quoted below)\n') && handoff.includes('\nLatest request: That is all for now.\n'));
  assert.equal(handoff.split('That is all for now.').length, 2, 'quoted once');

  // The messages the provider gets: the live request exactly, its reminder included, then the answer and the draft request.
  assert.deepEqual(fork.messages.slice(0, -2), live.messages);
  assert.equal(textOf(fork.messages.at(-2)), 'Good.');

  // pi-ai's Anthropic payload: the live request's cache marker sits on its reminder, and the fork carries that exact
  // prefix, a few blocks before its own marker, within Anthropic's lookback.
  const [livePayload, forkPayload] = [await anthropicPayload(live), await anthropicPayload(fork)];
  assert.match(JSON.stringify(livePayload.messages.at(-1)), /this context window is \d+% full\..*"cache_control"/, 'the live marker is on the reminder');
  assert.deepEqual(cacheContent(forkPayload.system), cacheContent(livePayload.system));
  assert.deepEqual(cacheContent(forkPayload.tools), cacheContent(livePayload.tools));
  assert.deepEqual(cacheContent(forkPayload.messages.slice(0, livePayload.messages.length)), cacheContent(livePayload.messages), 'the same prefix');
  // Anthropic looks back about 20 blocks from a breakpoint: from the fork's marker, the live prefix's last block is
  // within that, counting every serialized content block up to and including the marked one.
  const blocks = (messages: unknown[]) => messages.flatMap(message => {
    const content = (message as { content: unknown }).content;
    return Array.isArray(content) ? content as Record<string, unknown>[] : [{ type: 'text', text: content }];
  });
  const forkBlocks = blocks(forkPayload.messages);
  const marked = forkBlocks.map((block, index) => block.cache_control ? index : -1).filter(index => index >= 0);
  assert.equal(marked.length, 1, 'one marker in the fork\u2019s messages');
  const prefixEnd = blocks(livePayload.messages).length - 1;
  assert.ok(marked[0] > prefixEnd && marked[0] - prefixEnd <= 20, `the marker is ${marked[0] - prefixEnd} blocks after the prefix`);

  // The Claude Code replay: the frames up to the live request's are the live request's frames.
  const [liveFrames, forkFrames] = [await claudeCodeFrames(live.messages), await claudeCodeFrames(fork.messages)];
  assert.deepEqual(forkFrames.slice(0, liveFrames.length), liveFrames, 'the same frames');

  // Without the reminder put back, neither prefix matches: the cost the review found.
  const bare = fork.messages.filter(message => !(message.role === 'user' && /^\[pi-dish: this context window is \d+% full\. Save/.test(textOf(message))));
  assert.notDeepEqual(cacheContent((await anthropicPayload({ ...fork, messages: bare })).messages.slice(0, livePayload.messages.length)), cacheContent(livePayload.messages));
  assert.notDeepEqual((await claudeCodeFrames(bare)).slice(0, liveFrames.length), liveFrames);
});

/** Sends `request` and lets the bot roll over while idle; then follows the handoff's pointer with history read. */
async function rollOverAndFollow(bot: Harness, time: ReturnType<typeof fakeClock>, records: IdleRolloverRecord[], request: string) {
  const [armed, rolled] = [decided(records, 'plan', 'armed').length, decided(records, 'result', 'rolled-over').length];
  bot.respond(bot.faux.fauxAssistantMessage('Noted.'), bot.faux.fauxAssistantMessage(DRAFT));
  await bot.runtime.prompt(request, 'followUp');
  await until(() => decided(records, 'plan', 'armed').length > armed, 'armed');
  time.advance(55 * MINUTE);
  await until(() => decided(records, 'result', 'rolled-over').length > rolled, 'rolled over');
  const handoff = textOf(bot.mirrorLines().filter(line => line.customType === 'bot-context-window').at(-1));
  const window = Number(/history read (\d+) has all of it\]/.exec(handoff)?.[1]);
  bot.respond(bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall('history', { action: 'read', window })], { stopReason: 'toolUse' }),
    bot.faux.fauxAssistantMessage('Read.'));
  await bot.runtime.prompt('What did that request say after the quote?', 'followUp');
  await until(() => said(bot, 'Read.'), 'history answers');
  return { handoff, window, read: textOf(toolResults(bot).at(-1)) };
}

/** A request over the idle quote's length whose end, past the quote, is unique. */
const LONG_REQUEST = `Remember that tycho runs the backups. ${'w'.repeat(40_000)} The restore key is in the blue binder.`;

test('idle rollover regression 12: an idle rollover quotes at most 1,500 characters of the latest request once, and its history pointer has the rest', async t => {
  const time = fakeClock();
  const records: IdleRolloverRecord[] = [];
  const bot = await openTestBot(t, noSessions, { contextWindow: 30_000, idleRollover: idlePorts(time, records) });
  const { handoff, window, read } = await rollOverAndFollow(bot, time, records, LONG_REQUEST);
  assert.equal(window, 1);
  assert.ok(handoff.includes(`\nLatest request: ${LONG_REQUEST.slice(0, 1_500)}… [the first 1500 of ${LONG_REQUEST.length} characters; history read 1 has all of it]`));
  // The tail does not quote it again.
  assert.ok(handoff.includes('\nuser: (the latest request, quoted below)\n'));
  assert.equal(handoff.split(LONG_REQUEST.slice(0, 200)).length, 2, 'quoted once');
  assert.ok(handoff.length < 5_000, `the handoff is ${handoff.length} characters`);
  assert.match(read, /The restore key is in the blue binder\./, 'history read 1 has the text past the quote');
});

test('idle rollover regression 13: a forked sub-bot\u2019s inherited window is its window 1, so its handoff\u2019s history pointer finds the request', async t => {
  const registry = tempRegistry(t);
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bots-dir-'));
  t.after(() => fs.rmSync(botsDir, { recursive: true, force: true }));
  const personal = registry.create({ name: 'Personal', identity: 'You are Personal, the contact for personal matters.', model: 'faux/faux-1' }, { actor: 'user' });
  const time = fakeClock();
  const records: IdleRolloverRecord[] = [];
  let child: Harness | undefined;
  const hub: HubApi = (pathname, body) => routes(pathname, body);
  const routes = hubOf(createBotHandlers(() => registry, botControl(new Map(), [], async row => {
    child = await openTestBot(t, noSessions, {
      botsDir, row: () => registry.get(row.id)!, api: hub, contextWindow: 30_000, idleRollover: idlePorts(time, records),
      responses: faux => [faux.fauxAssistantMessage('On it.')],
    });
  })));
  const parent = await openTestBot(t, noSessions, { botsDir, row: () => registry.get(personal.id)!, api: hub });
  parent.respond(
    // The parent forks from its second window: the child's copy starts with the parent's reset.
    toolCall(parent, 'context_notes', { action: 'write', text: 'The dentist is on Friday.' }),
    toolCall(parent, 'new_context', { summary: 'Noted the dentist' }),
    toolCall(parent, 'bot_create', { name: 'Medical', purpose: 'Keep track of appointments.', identity: 'You are Medical, the contact for appointments.' }),
    parent.faux.fauxAssistantMessage('Created Medical.'),
  );
  await parent.runtime.prompt('Note the dentist, then make a sub-bot for medical things', 'followUp');
  await until(() => !!child && said(child, 'On it.') && said(parent, 'Created Medical.'), 'the sub-bot answers its purpose');
  const sub = child!;
  const { handoff, window, read } = await rollOverAndFollow(sub, time, records, LONG_REQUEST);
  assert.match(handoff, /^\[Context window 2\./, 'the child\u2019s second window');
  assert.equal(window, 1);
  assert.match(read, /^Window 1, /);
  assert.match(read, /The restore key is in the blue binder\./, 'history read 1 has the text past the quote');
  assert.match(read, /\[handoff\] \[Context window 2\. /, 'and starts at the inherited window\u2019s handoff');

  // The list agrees: two windows, the first with the summary the child gave it.
  sub.respond(toolCall(sub, 'history', { action: 'windows' }), sub.faux.fauxAssistantMessage('Listed.'));
  await sub.runtime.prompt('List your windows', 'followUp');
  await until(() => said(sub, 'Listed.'), 'history lists');
  assert.match(textOf(toolResults(sub).at(-1)), /^1\. Backups on tycho — \d+ messages\n2\. \(current window\) — \d+ messages$/);
});

test('an idle handoff\u2019s quote never ends inside a surrogate pair', () => {
  const request = `${'a'.repeat(1_499)}\u{1F600}${'b'.repeat(100)}`;
  const handoff = composeHandoff({ windowNumber: 3, closed: [], tail: [], request, workers: [], forced: false, idle: true });
  assert.ok(handoff.includes(`Latest request: ${'a'.repeat(1_499)}… [the first 1499 of ${request.length} characters; history read 2 has all of it]`));
  assert.doesNotMatch(handoff, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  assert.ok(composeHandoff({ windowNumber: 2, closed: [], tail: [], request, workers: [], forced: true }).includes(request), 'other rollovers quote it whole');
});

// Images sent to a bot: they reach its model, on every route a bot runs on, and a window holds a bounded number.

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/** A 2×1 grey JPEG. */
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAFA3PEY8MlBGQUZaVVBfeMiCeG5uePWvuZHI////////////////////////////////////////////////////wAALCAABAAIBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/ACv/2Q==';
const image = (data = PNG, mimeType = 'image/png') => ({ type: 'image' as const, data, mimeType });
/** A PNG header followed by `bytes` of padding: an image as large as a test needs. */
const largePng = (bytes: number) => Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(bytes)]).toString('base64');

/** The request body `api` builds for `context`, captured from its payload hook; nothing is sent. */
async function routePayload(api: string, model: Record<string, unknown>, context: TranscriptContext, options: Record<string, unknown> = {}): Promise<unknown> {
  // pi-ai is ESM-only and each route is its own module: this CommonJS test loads the one named, as anthropicPayload does.
  const module = await import(`@earendil-works/pi-ai/api/${api}`) as { stream(model: never, context: TranscriptContext, options: never): { result(): Promise<unknown> } };
  let payload: unknown;
  const full = {
    api, provider: 'test', baseUrl: 'https://example.invalid/v1', reasoning: false, input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 8_000, ...model,
  };
  await module.stream(full as never, context, {
    apiKey: 'test-key', ...options, onPayload: (params: unknown) => { payload = params; throw new Error('captured, not sent'); },
  } as never).result();
  assert.ok(payload, `${api} built a payload`);
  return payload;
}

/** The blocks of `payload` (anywhere in it) that `match` picks. */
function blocksIn(payload: unknown, match: (block: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    const block = value as Record<string, unknown>;
    if (match(block)) found.push(block);
    Object.values(block).forEach(walk);
  };
  walk(payload);
  return found;
}

/** A ChatGPT-style token whose only claim is the account Codex reads from it. */
const codexToken = `x.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct' } })).toString('base64url')}.x`;

test('an image reaches the bot\u2019s model after its text, an image alone is a message, and each route sends it in its own image block', async t => {
  const bot = await openTestBot(t, noSessions);
  bot.respond(bot.faux.fauxAssistantMessage('A pixel.'), bot.faux.fauxAssistantMessage('Another pixel.'));
  await bot.runtime.prompt('What is this?', 'followUp', [image()]);
  await until(() => said(bot, 'A pixel.'), 'the first answer');
  assert.deepEqual(bot.requests[0].at(-1)!.content, [{ type: 'text', text: 'What is this?' }, image()], 'the text, then the image');
  const second = image(JPEG, 'image/jpeg');
  await bot.runtime.prompt('', 'followUp', [second]);
  await until(() => said(bot, 'Another pixel.'), 'the image alone is answered');
  assert.deepEqual(bot.requests[1].at(-1)!.content, [second], 'no empty text block');
  // The chat shows each message with its image, as a session's transcript holds one.
  const users = bot.mirrorLines().filter(line => line.type === 'message' && (line.message as Record<string, unknown>).role === 'user')
    .map(line => (line.message as Record<string, unknown>).content);
  assert.deepEqual(users, [[{ type: 'text', text: 'What is this?' }, image()], [second]]);

  const context = bot.contexts[1];
  const anthropic = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } };
  const anthropicJpeg = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: second.data } };
  // Anthropic Messages, through Pi's model runtime, and the Claude Code replay of the subscription route.
  const messages = (await anthropicPayload(context)).messages;
  assert.deepEqual(cacheContent(blocksIn(messages, block => block.type === 'image')), [anthropic, anthropicJpeg]);
  const frames = await claudeCodeFrames(context.messages);
  assert.deepEqual(cacheContent(blocksIn(frames, block => block.type === 'image')), [anthropic, anthropicJpeg]);
  // OpenAI Responses, the Codex subscription's Responses body, Chat Completions and Gemini.
  const dataUrl = (data: string, mimeType: string) => `data:${mimeType};base64,${data}`;
  for (const [api, options] of [['openai-responses', {}], ['openai-codex-responses', { apiKey: codexToken }]] as const) {
    const payload = await routePayload(api, { id: 'gpt-5', provider: api === 'openai-responses' ? 'openai' : 'openai-codex' }, context, options);
    assert.deepEqual(blocksIn(payload, block => block.type === 'input_image').map(block => block.image_url),
      [dataUrl(PNG, 'image/png'), dataUrl(second.data, 'image/jpeg')], api);
  }
  const completions = await routePayload('openai-completions', { id: 'gpt-4o', provider: 'openai' }, context);
  assert.deepEqual(blocksIn(completions, block => block.type === 'image_url').map(block => block.image_url),
    [{ url: dataUrl(PNG, 'image/png') }, { url: dataUrl(second.data, 'image/jpeg') }]);
  const gemini = await routePayload('google-generative-ai', { id: 'gemini-2.5-pro', provider: 'google' }, context);
  assert.deepEqual(blocksIn(gemini, block => 'inlineData' in block).map(block => block.inlineData),
    [{ mimeType: 'image/png', data: PNG }, { mimeType: 'image/jpeg', data: second.data }]);
});

test('images a bot cannot pass on are refused with the reason, before they count as input; a malformed image is refused, not dropped', async t => {
  const { botImages } = runtimeModule;
  assert.deepEqual(botImages(undefined), []);
  assert.deepEqual(botImages([{ data: PNG, mimeType: 'image/png' }]), [image()]);
  // Typed by its content, whatever it claims.
  assert.deepEqual(botImages([{ data: JPEG, mimeType: 'image/png' }]), [image(JPEG, 'image/jpeg')]);
  assert.deepEqual(runtimeModule.imageHeader(Buffer.from(JPEG, 'base64')), { mimeType: 'image/jpeg', width: 2, height: 1 });
  assert.deepEqual(botImages([{ data: PNG, mimeType: 'image/jpeg' }]), [image()]);
  // GIF and WebP are not taken, a whole one or not.
  for (const [data, kind] of [['R0lGODdhAgABAIEAAP8AAAAAAAAAAAAAACwAAAAAAgABAAAIBQABAAgIADs=', 'a GIF'], ['R0lGODlhAQABAA==', 'a GIF'],
    ['UklGRhwAAABXRUJQVlA4TA8AAAAvAQAAEAcQ/Y8CBiKi/wEA', 'a WebP image']]) {
    assert.throws(() => botImages([{ data, mimeType: 'image/png' }]), new RegExp(`^Error: Image 1 is ${kind}; a bot takes only PNG and JPEG images\\. Nothing was sent\\.$`));
  }
  // What a provider could not decode would fail every later request of the window: it is never stored. A PNG without
  // its image data, and a JPEG cut before its scan, have a header but are not whole.
  const png = Buffer.from(PNG, 'base64');
  const idat = png.indexOf('IDAT') - 4;
  const noIdat = Buffer.concat([png.subarray(0, idat), png.subarray(idat + 12 + png.readUInt32BE(idat))]).toString('base64');
  const jpeg = Buffer.from(JPEG, 'base64');
  const sos = jpeg.indexOf(Buffer.from([0xff, 0xda]));
  assert.ok(sos > jpeg.indexOf(Buffer.from([0xff, 0xc0])), 'the scan follows the frame header');
  const noSos = Buffer.concat([jpeg.subarray(0, sos), Buffer.from([0xff, 0xd9])]).toString('base64');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  for (const data of ['A', 'not base64!', svg, 'AAAA', noIdat, noSos]) {
    assert.throws(() => botImages([image(), { data, mimeType: 'image/png' }]), /^Error: Image 2 is not a whole PNG or JPEG image; a bot takes only PNG and JPEG images\. Nothing was sent\.$/);
  }
  const tall = 'iVBORw0KGgoAAAANSUhEUgAAH0EAAAABCAAAAACZyqz4AAAAHUlEQVR4nO3BAQEAAACAkP6v7ggKAAAAAAAAAKgBH0IAAWX13dsAAAAASUVORK5CYII=';
  assert.throws(() => botImages([{ data: tall, mimeType: 'image/png' }]), /^Error: Image 1 is 8001×1 px; a bot takes images of at most 8000 px a side/);
  assert.throws(() => botImages('x'), /images must be a list/);

  const textOnly = await openTestBot(t, noSessions, { input: ['text'] });
  await assert.rejects(textOnly.runtime.prompt('Look', 'followUp', [image()]), /model \(faux\/faux-1\) does not take images/);
  const bot = await openTestBot(t, noSessions);
  await assert.rejects(bot.runtime.prompt('Look', 'followUp', [image(), image('A')]), /Image 2 is not a whole PNG or JPEG/, 'the store checks for itself');
  await assert.rejects(bot.runtime.prompt('Look', 'followUp', [image(), image(largePng(3.4 * 1024 * 1024))]),
    /^Error: Image 2 is 4\.5 MB; a bot takes images of at most 4\.5 MB/);
  await assert.rejects(bot.runtime.prompt('Look', 'followUp', Array.from({ length: 21 }, () => image())),
    /With these 21 images .* the limit of 20 images or 16\.0 MB per context window.*Nothing was sent/);
  for (const refused of [textOnly, bot]) {
    assert.equal(refused.requests.length, 0, 'no request');
    assert.ok(!refused.mirrorLines().some(line => line.type === 'message'), 'nothing in the chat');
  }
});

test('a window full of images refuses another until a new window opens; the handoff notes the images and carries none', async t => {
  const bot = await openTestBot(t, noSessions);
  const call = (name: string, args: Record<string, string>) =>
    bot.faux.fauxAssistantMessage([bot.faux.fauxToolCall(name, args)], { stopReason: 'toolUse' });
  bot.respond(bot.faux.fauxAssistantMessage('Twenty pixels.'));
  await bot.runtime.prompt('', 'followUp', Array.from({ length: 20 }, () => image()));
  await until(() => said(bot, 'Twenty pixels.'), 'twenty images fit a window');
  await assert.rejects(bot.runtime.prompt('And this one', 'followUp', [image()]),
    /^Error: This bot's context window already holds 20 images \(0\.0 MB\); with this image .*or ask the bot to start a new context window first\.$/);
  assert.ok(!bot.mirrorLines().some(line => textOf(line.message) === 'And this one'), 'the refused message is not in the chat');

  bot.respond(
    call('context_notes', { action: 'write', text: 'The user sends pixels.' }),
    call('new_context', { summary: 'Looked at pixels' }),
    bot.faux.fauxAssistantMessage('New window.'),
    bot.faux.fauxAssistantMessage('One pixel.'),
  );
  await bot.runtime.prompt('Start a new context window', 'followUp');
  await until(() => said(bot, 'New window.'), 'the window rolls over');
  const handoff = textOf(bot.requests.at(-1)!.find(message => message.role === 'user'));
  assert.match(handoff, /\nuser: \[20 images attached\]\n/);
  assert.ok(!JSON.stringify(bot.requests.at(-1)).includes(PNG), 'no image data in the new window');
  await bot.runtime.prompt('And this one', 'followUp', [image()]);
  await until(() => said(bot, 'One pixel.'), 'the new window takes images again');
  assert.deepEqual(bot.requests.at(-1)!.at(-1)!.content, [{ type: 'text', text: 'And this one' }, image()]);
});

test('a photo and a message sent after it to a busy bot reach the model in the order they were sent', async t => {
  const bot = await openTestBot(t, noSessions);
  const first = held(() => bot.faux.fauxAssistantMessage('Working.'));
  bot.respond(first.response, bot.faux.fauxAssistantMessage('Seen.'), bot.faux.fauxAssistantMessage('Seen again.'));
  await bot.runtime.prompt('Start', 'followUp');
  await until(first.started, 'the bot is busy');
  // The photo's window check takes longer than the text's admission: the text must still wait its turn.
  await Promise.all([bot.runtime.prompt('', 'followUp', [image()]), bot.runtime.prompt('After the photo', 'followUp')]);
  first.open();
  await until(() => bot.requests.some(request => request.some(message => textOf(message) === 'After the photo')), 'both reach the model');
  await untilSettled(bot, 'the follow-ups ran');
  const users = bot.requests.at(-1)!.filter(message => message.role === 'user');
  const photo = users.findIndex(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image'));
  const text = users.findIndex(message => textOf(message) === 'After the photo');
  assert.ok(photo > 0 && text > photo, `the photo (${photo}) comes before the text (${text})`);
});

test('a mirror reopened after a large image row keeps its cursor and its chain', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bot-mirror-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, `${BOT.id}.jsonl`);
  const header = { id: BOT.id, cwd: dir, name: 'Fleet' };
  const mirror = new BotMirror(file, header);
  mirror.appendMessage(7, { role: 'assistant', content: [{ type: 'text', text: 'Ready.' }], timestamp: Date.parse('2026-11-22T10:00:00Z') });
  // A ~410k-character row, longer than any fixed tail the mirror could read: the relay restarts before the answer.
  mirror.appendMessage(8, { role: 'user', content: [image(largePng(310 * 1024))], timestamp: Date.now() });
  assert.ok(fs.statSync(file).size > 410_000);

  const reopened = new BotMirror(file, header);
  assert.equal(reopened.lastEntryId, 8, 'the cursor is kept');
  assert.equal(reopened.name, 'Fleet');
  reopened.appendMessage(9, { role: 'assistant', content: [{ type: 'text', text: 'A big picture.' }], timestamp: Date.parse('2026-11-22T10:05:00Z') });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
  const ids = lines.slice(1).map(line => line.id);
  assert.deepEqual(ids, ['bot-0-name', 'bot-7', 'bot-8', 'bot-9'], 'nothing replayed');
  assert.equal(lines.at(-1)!.parentId, 'bot-8', 'one chain');
  assert.deepEqual(readBotMirrorHeader(file), header);
  assert.equal(lastBotTurn(file), '2026-11-22T10:05:00.000Z');
});

test('reopening a mirror and runtime restores lastModel without duplicate model_change and restores lastUsage for contextUsage and forced rollover', async t => {
  // Unit checks on BotMirror.lastModel across creation, model changes, renames and reopen.
  const mirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bot-mirror-model-'));
  t.after(() => fs.rmSync(mirrorDir, { recursive: true, force: true }));
  const mirrorFile = path.join(mirrorDir, `${BOT.id}.jsonl`);
  const mirrorHeader = { id: BOT.id, cwd: mirrorDir, name: 'Fleet' };
  const freshMirror = new BotMirror(mirrorFile, mirrorHeader);
  assert.equal(freshMirror.lastModel, '', 'brand-new mirror starts with empty lastModel');
  freshMirror.appendModelChange(2, 'faux', 'faux-1');
  assert.equal(freshMirror.lastModel, 'faux/faux-1');
  freshMirror.appendMessage(2, { role: 'assistant', content: [{ type: 'text', text: 'Hi.' }], timestamp: Date.now() });
  freshMirror.appendName(2, 'Fleet Prime');
  const reopenedMirror = new BotMirror(mirrorFile, mirrorHeader);
  assert.equal(reopenedMirror.lastModel, 'faux/faux-1', 'reopen scans past newer session_info and messages to restore lastModel');
  assert.equal(reopenedMirror.name, 'Fleet Prime');
  reopenedMirror.appendModelChange(3, 'faux', 'faux-2');
  reopenedMirror.appendMessage(3, { role: 'assistant', content: [{ type: 'text', text: 'Switched.' }], timestamp: Date.now() });
  assert.equal(new BotMirror(mirrorFile, mirrorHeader).lastModel, 'faux/faux-2', 'reopen picks the newest model_change');

  // Runtime restart: same model emits no duplicate model_change, restores contextUsage immediately, and enforces forceRolloverIfFull.
  let currentRow: BotRow = { ...BOT, model: 'faux/faux-1' };
  const bot = await openTestBot(t, noSessions, { contextWindow: 200_000, faux2ContextWindow: 100_000, row: () => currentRow });
  bot.respond(bot.faux.fauxAssistantMessage('First answer.'));
  await bot.runtime.prompt('Hello once', 'followUp');
  await until(() => said(bot, 'First answer.'), 'first turn completes');
  const usageBefore = bot.runtime.contextUsage();
  assert.ok(usageBefore && usageBefore.tokens > 0, 'usage recorded after first turn');
  assert.deepEqual(
    bot.mirrorLines().filter(line => line.type === 'model_change').map(line => `${String(line.provider)}/${String(line.modelId)}`),
    ['faux/faux-1'],
  );

  // Reopen on the same model: contextUsage is restored immediately before any turn, and next turn emits no duplicate model_change.
  await bot.reopen();
  assert.deepEqual(bot.runtime.contextUsage(), usageBefore, 'contextUsage is restored immediately after restart');
  bot.respond(bot.faux.fauxAssistantMessage('Filled to ~98k.'), bot.faux.fauxAssistantMessage('Short follow-up done.'));
  await bot.runtime.prompt(`Big payload ${'w'.repeat(380_000)}`, 'followUp');
  await until(() => said(bot, 'Filled to ~98k.'), 'second turn completes under 200k limit');
  await bot.runtime.prompt('Short follow-up.', 'followUp');
  await until(() => said(bot, 'Short follow-up done.'), 'short turn keeps latest request small');
  assert.equal(bot.mirrorLines().filter(line => line.customType === 'bot-context-window').length, 0, 'under 200k limit does not roll over yet');
  assert.deepEqual(
    bot.mirrorLines().filter(line => line.type === 'model_change').map(line => `${String(line.provider)}/${String(line.modelId)}`),
    ['faux/faux-1'],
    'restarting on the same model emits no duplicate model_change',
  );

  // Reopen onto faux-2 (100k context window): restored ~98k tokens is >=97% hard limit, so contextUsage shows >=97% and next prompt force-rolls over first.
  currentRow = { ...BOT, model: 'faux/faux-2' };
  await bot.reopen();
  const usageAfterSwitch = bot.runtime.contextUsage();
  assert.ok(usageAfterSwitch && usageAfterSwitch.contextWindow === 100_000 && usageAfterSwitch.percent >= 97,
    `expected restored usage >=97% of 100k after restart, got ${JSON.stringify(usageAfterSwitch)}`);

  bot.respond(bot.faux.fauxAssistantMessage('Answered in window 2.'));
  await bot.runtime.prompt('Continue after restart', 'followUp');
  await until(() => said(bot, 'Answered in window 2.'), 'prompt after restart answered');
  assert.equal(bot.mirrorLines().filter(line => line.customType === 'bot-context-window').length, 1, 'forceRolloverIfFull closed window 1 immediately after restart');
  const postRestartReq = bot.requests.at(-1)!;
  assert.match(textOf(postRestartReq.find(message => message.role === 'user')), /^\[Context window 2\./, 'prompt ran in fresh window 2');
  assert.deepEqual(
    bot.mirrorLines().filter(line => line.type === 'model_change').map(line => `${String(line.provider)}/${String(line.modelId)}`),
    ['faux/faux-1', 'faux/faux-2'],
    'real model change across restart still emits model_change',
  );

  // Reopening when the newest entry is pi.reset (empty fresh window) restores lastUsage = 0 (contextUsage() === null), not window 1's usage.
  const resetBot = await openTestBot(t, noSessions, { contextWindow: 100_000 });
  resetBot.respond(resetBot.faux.fauxAssistantMessage('Spiked past 97%.'));
  await resetBot.runtime.prompt(`Huge spike ${'w'.repeat(380_000)}`, 'followUp');
  await until(() => resetBot.mirrorLines().some(line => line.customType === 'bot-context-window'), 'forced rollover writes pi.reset');
  await resetBot.reopen();
  assert.equal(resetBot.runtime.contextUsage(), null, 'restored usage stops at pi.reset boundary');
  resetBot.respond(resetBot.faux.fauxAssistantMessage('In fresh window.'));
  await resetBot.runtime.prompt('Hello window 2', 'followUp');
  await until(() => said(resetBot, 'In fresh window.'), 'window 2 turn completes');
  assert.equal(resetBot.mirrorLines().filter(line => line.type === 'model_change').length, 1, 'no duplicate model_change after reset + restart');

  // Lagging mirror: pi.reset is committed in SQLite, but the mirror JSONL crashed before flushing it.
  // Reopen must apply the initial durable watch snapshot before admitting input so usage is 0 and no extra window 3 opens.
  // Build past 97% across two turns so window 2's handoff stays well below 90% when quoting the second request.
  const laggingBot = await openTestBot(t, noSessions, { contextWindow: 100_000 });
  laggingBot.respond(
    laggingBot.faux.fauxAssistantMessage('First chunk done.'),
    laggingBot.faux.fauxAssistantMessage('Spiked past 97% before mirror crash.'),
  );
  await laggingBot.runtime.prompt(`Chunk one ${'w'.repeat(200_000)}`, 'followUp');
  await until(() => said(laggingBot, 'First chunk done.'), 'first chunk stays under limit');
  await laggingBot.runtime.prompt(`Chunk two ${'w'.repeat(170_000)}`, 'followUp');
  await until(() => laggingBot.mirrorLines().some(line => line.customType === 'bot-context-window'), 'forced rollover commits pi.reset');
  await laggingBot.runtime.close();
  // Drop the last mirror line (bot-context-window) so mirror.lastEntryId points to window 1's >97% assistant entry.
  const rawMirror = fs.readFileSync(laggingBot.mirrorPath, 'utf8').trimEnd().split('\n');
  assert.equal((JSON.parse(rawMirror.at(-1)!) as Record<string, unknown>).customType, 'bot-context-window');
  fs.writeFileSync(laggingBot.mirrorPath, `${rawMirror.slice(0, -1).join('\n')}\n`);

  await laggingBot.reopen();
  assert.equal(laggingBot.runtime.contextUsage(), null, 'initial durable snapshot cleared stale usage before returning');
  assert.equal(laggingBot.mirrorLines().filter(line => line.customType === 'bot-context-window').length, 1, 'initial snapshot caught up the lagging mirror');
  laggingBot.respond(laggingBot.faux.fauxAssistantMessage('Answered in window 2 without extra rollover.'));
  await laggingBot.runtime.prompt('Next prompt after lagging restart', 'followUp');
  await until(() => said(laggingBot, 'Answered in window 2 without extra rollover.'), 'prompt answered in window 2');
  assert.equal(laggingBot.mirrorLines().filter(line => line.customType === 'bot-context-window').length, 1, 'no needless window 3 rollover');
});
