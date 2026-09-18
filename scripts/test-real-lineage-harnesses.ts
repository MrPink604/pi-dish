#!/usr/bin/env node
'use strict';

/**
 * Opt-in integration canary for the real OMP and Prime Agent CLIs.
 *
 * This intentionally does not run under `npm test`: the harnesses are large,
 * independently released tools. Install them, then provide their executable
 * paths (and Bun's bin directory for OMP):
 *
 *   PI_DISH_REAL_OMP_BIN=/path/to/omp \
 *   PI_DISH_REAL_PRIME_BIN=/path/to/prime-agent \
 *   PI_DISH_REAL_BUN_BIN_DIR=/path/containing/bun \
 *   npm run test:lineage
 *
 * Select just one with `npm run test:lineage -- omp` (or `prime`); only its
 * executable is required, plus Bun for OMP.
 *
 * The canary uses an isolated HOME, tmux server, bridge socket directory, and
 * Prime daemon. It sends real streamed turns only to a localhost fake OpenAI
 * Responses endpoint, with a dummy key; no paid credentials are used.
 */
import assert = require('node:assert/strict');
import crypto = require('node:crypto');
import fs = require('node:fs');
import http = require('node:http');
import os = require('node:os');
import path = require('node:path');
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const sessionKeys: typeof import('../lib/session-key') = require('../lib/session-key');
const checkedNativeId = (value: unknown) => {
  if (!sessionKeys.validSessionId(value)) throw new TypeError('Invalid fixture session id');
  return value;
};
const idleChild = path.join(__dirname, '..', 'test', 'fixtures', 'idle-child.js');
type Harness = 'omp' | 'prime';
type TestRecord = Record<string, unknown>;
const record = (value: unknown): TestRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
  const out: TestRecord = {};
  for (const [key, item] of Object.entries(value)) out[key] = item;
  return out;
};
const records = (value: unknown): TestRecord[] => {
  if (!Array.isArray(value)) throw new TypeError('Expected array');
  return value.map(record);
};
const present = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new TypeError('Expected value');
  return value;
};
const text = (value: unknown): string => String(value ?? '');
const tmuxApi = () => {
  if (!tmux) throw new Error('tmux module not loaded');
  return tmux;
};

const selection = process.argv[2] || 'all';
if (process.argv.length > 3 || !['all', 'omp', 'prime'].includes(selection)) {
  throw new Error('Usage: npm run test:lineage -- [all|omp|prime]');
}
const selected: Harness[] = selection === 'all' ? ['omp', 'prime'] : [selection === 'omp' ? 'omp' : 'prime'];
const ompBin = process.env.PI_DISH_REAL_OMP_BIN;
const primeBin = process.env.PI_DISH_REAL_PRIME_BIN;
const bunBinDir = process.env.PI_DISH_REAL_BUN_BIN_DIR;
const binaries: Record<Harness, string | undefined> = { omp: ompBin, prime: primeBin };
for (const name of selected) {
  const file = binaries[name];
  if (!file) throw new Error(`PI_DISH_REAL_${name.toUpperCase()}_BIN is required for ${name}`);
  if (!path.isAbsolute(file)) throw new Error(`${name} executable path must be absolute`);
  fs.accessSync(file, fs.constants.X_OK);
}
if (selected.includes('omp')) {
  if (!bunBinDir || !path.isAbsolute(bunBinDir)) {
    throw new Error('PI_DISH_REAL_BUN_BIN_DIR must be an absolute directory for OMP');
  }
  fs.accessSync(path.join(bunBinDir, 'bun'), fs.constants.X_OK);
}
const repoRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-lineage-real-'));
const home = path.join(root, 'home');
const tmuxDir = path.join(root, 'tmux');
const tmuxSocket = path.join(tmuxDir, 's');
const work = path.join(root, 'work');
const socketDir = path.join(root, 'sockets');
const primeDaemon = path.join(root, 'prime-daemon.sock');
fs.chmodSync(socketDir, 0o700);

// Drop the operator's deployment env (HOST/PORT/share port) before pinning
// this run's own — see test/test-env.js.
const testEnv: typeof import('../test/test-env.js') = require('../test/test-env.js');
testEnv.applyTestEnv();
const originalPath = process.env.PATH || '';
process.env.PATH = [selected.includes('omp') && bunBinDir, ...selected.map(name => path.dirname(String(binaries[name]))), originalPath]
  .filter((value): value is string => typeof value === 'string' && !!value).join(path.delimiter);
process.env.HOME = home;
// Fleet CLI overlays may otherwise override this canary's model configuration.
for (const key of ['PI_CONFIG_FILES', 'PI_CODING_AGENT_DIR', 'OMP_AGENT_DIR']) delete process.env[key];
process.env.TMUX_TMPDIR = tmuxDir;
process.env.PORT = '0';
process.env.PI_DISH_SOCKET_DIR = socketDir;
process.env.PI_DISH_SPAWN_TIMEOUT_MS = '20000';

const shellWord = (value: unknown) => `'${String(value).replace(/'/g, `'\\''`)}'`;
if (selected.includes('omp')) process.env.PI_DISH_OMP_COMMAND = [
  shellWord(ompBin), '--no-extensions', '--no-skills', '--no-rules',
].join(' ');
if (selected.includes('prime')) {
  process.env.PI_DISH_PRIME_COMMAND = [
    shellWord(primeBin), '--offline', '--daemon-socket', shellWord(primeDaemon),
    '--no-skills', '--no-prompt-templates', '--no-context-files',
  ].join(' ');
  // Mirror install.sh: link the wrapper plus the shared core into the
  // isolated home's discovery directory. This deliberately leaves discovery
  // enabled for managed clients (no --no-extensions here) so the canary
  // exercises pi-dish's own discovery suppression on token-wrapper launches.
  const primeExtensions = path.join(home, '.prime', 'agent', 'extensions');
  fs.mkdirSync(primeExtensions, { recursive: true });
  fs.symlinkSync(path.join(repoRoot, 'extensions', 'pi-dish-bridge-prime'),
    path.join(primeExtensions, 'pi-dish-bridge-prime'));
  fs.symlinkSync(path.join(repoRoot, 'extensions', 'pi-dish-bridge'),
    path.join(primeExtensions, 'pi-dish-bridge'));
}

const { encodeSessionKey }: typeof import('../lib/session-key') = require('../lib/session-key')
let server: http.Server | null = null;
let tmux: typeof import('../lib/tmux') | null = null;

let fakeRequestCount = 0;
let holdNextResponse = false;
const fakeRequests: string[] = [];
const fakeOpenAi = http.createServer((req, res) => {
  fakeRequests.push(`${req.method} ${req.url}`);
  if (req.method !== 'POST' || req.url !== '/v1/responses') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let request: TestRecord;
    try { request = record(JSON.parse(body)); } catch { res.writeHead(400).end(); return; }
    assert.equal(request.stream, true);
    const holdResponse = holdNextResponse;
    holdNextResponse = false;
    const sequence = ++fakeRequestCount;
    const messageId = `msg_pi_dish_${sequence}`;
    const responseId = `resp_pi_dish_${sequence}`;
    const text = `pi-dish fake provider response ${sequence}`;
    const responseBase = {
      id: responseId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model: request.model,
      output: [],
      usage: null,
      incomplete_details: null,
    };
    const completedItem = {
      type: 'message', id: messageId, role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    };
    const events = [
      { type: 'response.created', response: { ...responseBase, status: 'in_progress' } },
      { type: 'response.in_progress', response: { ...responseBase, status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0,
        item: { type: 'message', id: messageId, role: 'assistant', status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', output_index: 0, item_id: messageId, content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', output_index: 0, item_id: messageId, content_index: 0, delta: text },
      { type: 'response.output_text.done', output_index: 0, item_id: messageId, content_index: 0,
        text, logprobs: [] },
      { type: 'response.content_part.done', output_index: 0, item_id: messageId, content_index: 0,
        part: { type: 'output_text', text, annotations: [] } },
      { type: 'response.output_item.done', output_index: 0, item: completedItem },
      { type: 'response.completed', response: { ...responseBase, status: 'completed', output: [completedItem],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15,
          input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
    ];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    for (const event of events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (holdResponse && event.type === 'response.output_text.delta') {
        // Keep a real provider turn in flight until Prime aborts the request.
        return;
      }
      await sleep(25);
    }
    res.end();
  });
});

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
let base = '';
const getArray = async (route: string) => {
  const response = await fetch(base + route);
  return { status: response.status, body: records(await response.json()) };
};

async function request(method: string, route: string, body?: unknown) {
  const response = await fetch(base + route, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = record(await response.json().catch(() => ({})));
  return { status: response.status, body: data };
}

const get = (route: string) => request('GET', route);
const post = (route: string, body: unknown = {}) => request('POST', route, body);
let tmuxSessionId = ''; // Stable even when the rename endpoint renames the tmux session.
const target = () => ({ type: 'tmux', socket: tmuxSocket, tmuxSession: tmuxSessionId });

async function waitFor<T>(check: () => T | null | undefined | false | Promise<T | null | undefined | false>, label: string, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function runStreamedTurn(sessionId: string, prompt: string) {
  const requestCountBefore = fakeRequestCount;
  const expectedAssistantText = `pi-dish fake provider response ${requestCountBefore + 1}`;
  const abort = new AbortController();
  const response = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/stream`, { signal: abort.signal });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Stream response has no body');
  const decoder = new TextDecoder();
  const events: string[] = [];
  const eventPayloads: TestRecord[] = [];
  let buffer = '';
  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const lines = frame.split('\n');
        const event = lines.find(line => line.startsWith('event: '))?.slice(7);
        if (event) {
          events.push(event);
          const data = lines.find(line => line.startsWith('data: '))?.slice(6);
          if (data) {
            try { eventPayloads.push({ event, data: record(JSON.parse(data)) }); } catch {}
          }
        }
      }
    }
  })().catch((error: unknown) => {
    if (record(error).name !== 'AbortError') throw error;
  });
  try {
    await waitFor(() => events.includes('init'), 'SSE init');
    const accepted = await post(`/api/sessions/${encodeURIComponent(sessionId)}/prompt`, { message: prompt });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    await waitFor(() => events.includes('turn_start'), 'bridge turn_start', 30000);
    await waitFor(() => events.includes('message_update') || events.includes('turn_end') || events.includes('agent_end'),
      'bridge message_update or terminal event', 30000);
    assert.ok(events.includes('message_update'), 'turn ended without a bridge message_update');
    await waitFor(() => events.includes('message_end'), 'bridge message_end', 30000);
    await waitFor(() => events.includes('turn_end') || events.includes('agent_end'), 'bridge turn completion', 30000);
    const transcript = await waitFor(async () => {
      const messages = await get(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
      return fakeRequestCount > requestCountBefore
        && records(messages.body.messages).some(message => JSON.stringify(message.content).includes(expectedAssistantText))
        ? messages : null;
    }, 'persisted streamed assistant message', 30000);
    return {
      events: [...new Set(events)],
      transcript,
      providerRequestSequence: requestCountBefore + 1,
      assistantText: expectedAssistantText,
    };
  } catch (error) {
    const details = `events: ${events.join(', ') || 'none'}; payloads: ${JSON.stringify(eventPayloads.slice(-8))}; fake requests: ${fakeRequests.join(', ') || 'none'}`;
    throw new Error(`${error instanceof Error ? error.message : String(error)} (${details})`, { cause: error });
  } finally {
    abort.abort();
    try { await reader.cancel(); } catch {}
    await pump;
  }
}

async function shutdownPrime(daemonSocket = primeDaemon) {
  if (!selected.includes('prime') || !fs.existsSync(daemonSocket)) return { success: true };
  // Prime's public `shutdown` command discovers every daemon and cannot
  // be scoped to a socket. Use the installed protocol client so this canary
  // stops only the isolated supervisor it created.
  const packageRoot = path.resolve(path.dirname(fs.realpathSync(String(primeBin))), '..', '..');
  const clientModule = path.join(packageRoot, 'dist', 'modes', 'daemon', 'daemon-client.js');
  const { DaemonClient } = await import(pathToFileURL(clientModule).href);
  const client = new DaemonClient(daemonSocket);
  await client.connect();
  try {
    return await client.request({ type: 'shutdown', force: true }, 20000);
  } finally {
    client.close();
  }
}

async function testOmp() {
  const created = await post('/api/sessions/new', { harness: 'omp', model: 'openai/gpt-4o-mini', target: target() });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = text(created.body.id);
  assert.match(id, /^~sk1_/);
  const active = await waitFor(async () => {
    const list = await get('/api/sessions?active=1');
    return records(list.body.active).find(session => session.id === id);
  }, 'real OMP active session');
  assert.equal(active.harnessId, 'omp');
  const capabilities = record(active.capabilities);
  assert.equal(capabilities.prompt, true);
  assert.equal(capabilities.close, true);
  assert.equal(capabilities.queueCancel, false);
  assert.equal(capabilities.tree, true);

  const commands = await getArray(`/api/commands?sessionId=${encodeURIComponent(id)}`);
  assert.equal(commands.status, 200, JSON.stringify(commands.body));
  assert.ok(commands.body.length > 0);
  assert.ok(commands.body.some(command => command.name === 'btw' && command.supported === true),
    'real OMP advertises /btw through the bridge');
  const models = await getArray(`/api/models?sessionId=${encodeURIComponent(id)}`);
  assert.equal(models.status, 200, JSON.stringify(models.body));
  assert.ok(models.body.some(model => model.provider === 'openai' && model.id === 'gpt-4o-mini'));
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/rename`, { name: 'OMP managed real canary' })).status, 200);
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/thinking`, { level: 'low' })).status, 200);
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/command`, { message: '/dish-push' })).status, 200);
  const turn = await runStreamedTurn(id, 'pi-dish managed OMP integration canary');
  // /btw runs an ephemeral side turn against the same fake provider: the
  // answer comes back over the command response and nothing is persisted.
  const btw = await post(`/api/sessions/${encodeURIComponent(id)}/command`, { message: '/btw summarize this session' });
  assert.equal(btw.status, 200, JSON.stringify(btw.body));
  assert.match(text(btw.body.answer), /^pi-dish fake provider response \d+$/, 'real OMP /btw answer');
  const tree = await get(`/api/sessions/${encodeURIComponent(id)}/tree`);
  assert.equal(tree.status, 200, JSON.stringify(tree.body));
  assert.ok(records(tree.body.nodes).some(node => node.role === 'assistant' && node.text === turn.assistantText && node.active),
    'the real OMP live tree includes the persisted assistant response on its active path');
  const closeSpawn = present(tmuxApi().getSpawn(id));
  assert.ok(record(closeSpawn.paneProcess).startTime, 'real OMP close has an owned pane identity');
  const close = await post(`/api/sessions/${encodeURIComponent(id)}/close`);
  assert.equal(close.status, 200, JSON.stringify(close.body));
  assert.equal(await tmuxApi().paneExists(text(closeSpawn.socket), text(closeSpawn.paneId)), false);
  assert.equal(tmuxApi().getSpawn(id), null);
  assert.equal((await get(`/api/sessions/${encodeURIComponent(id)}/tree`)).status, 409,
    'inactive OMP tree reads remain capability-gated');

  // A fresh model-less OMP TUI does not create its JSONL until a real turn.
  // Resume a minimal current-format corpus through the actual OMP loader so
  // CLI dialect, wrapper loading, routing, and historical reads are covered.
  const headerId = crypto.randomUUID();
  const resumeNativeId = `2026-08-08T00-00-00-000Z_${headerId}`;
  const resumeFile = path.join(home, '.omp', 'agent', 'sessions', '-real-canary-work', `${resumeNativeId}.jsonl`);
  fs.mkdirSync(path.dirname(resumeFile), { recursive: true });
  const now = new Date().toISOString();
  // OMP patches its title in place. Give the v1 title record the same fixed
  // width its SessionManager creates, or a current OMP correctly rejects the
  // old spike-era fixture as malformed and initializes a fresh session.
  const title = { type: 'title', v: 1, title: 'OMP real resume fixture', updatedAt: now, pad: '' };
  title.pad = ' '.repeat(Math.max(0, 255 - Buffer.byteLength(JSON.stringify(title))));
  fs.writeFileSync(resumeFile, [
    title,
    { type: 'session', version: 3, id: headerId, timestamp: now, cwd: work },
    { type: 'message', id: 'user-1', parentId: null, timestamp: now,
      message: { role: 'user', content: [{ type: 'text', text: 'real OMP resume canary' }], timestamp: now } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');

  const resumeId = encodeSessionKey('omp', checkedNativeId(resumeNativeId));
  const resumed = await post(`/api/sessions/${encodeURIComponent(resumeId)}/resume`, { target: target() });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.id, resumeId);
  const messages = await get(`/api/sessions/${encodeURIComponent(resumeId)}/messages`);
  assert.equal(messages.status, 200, JSON.stringify(messages.body));
  assert.equal(record(messages.body.session).harnessId, 'omp');
  assert.ok(records(messages.body.messages).some(message => JSON.stringify(message.content).includes('real OMP resume canary')),
    JSON.stringify({ session: messages.body.session, messages: messages.body.messages, file: fs.readFileSync(resumeFile, 'utf8') }));

  return {
    version: execFileSync(String(ompBin), ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(),
    routeNamespace: id.slice(0, 5),
    commands: commands.body.length,
    models: models.body.length,
    streamedTurnEvents: turn.events,
    persistedAssistantMessage: true,
    liveTreeRead: true,
    inactiveTreeReadRefused: true,
    closeStatus: close.status,
    resumeSameRoute: resumed.body.id === resumeId,
    historyMessageRead: true,
    btwAnswer: btw.body.answer,
  };
}

async function findPrimeClaim(spawnValue: unknown) {
  const spawn = record(spawnValue);
  const registryDir = path.join(home, '.pi', 'dish', 'sessions');
  return waitFor(() => {
    let names: string[];
    try { names = fs.readdirSync(registryDir); } catch { return null; }
    for (const name of names) {
      try {
        const file = path.join(registryDir, name);
        const claim = record(JSON.parse(fs.readFileSync(file, 'utf8')));
        if (record(claim.wrapper).harnessId === 'prime' && claim.spawnToken === spawn.spawnToken) {
          return { file, claim };
        }
      } catch {}
    }
    return null;
  }, 'Prime generated-wrapper registry claim');
}
async function testPrime() {
  const created = await post('/api/sessions/new', { harness: 'prime', model: 'openai/gpt-4o-mini', target: target() });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = text(created.body.id);
  assert.match(id, /^~sk1_/);
  const active = await waitFor(async () => {
    const list = await get('/api/sessions?active=1');
    return records(list.body.active).find(session => session.id === id);
  }, 'real Prime active session');
  assert.equal(active.harnessId, 'prime');
  const capabilities = record(active.capabilities);
  assert.equal(capabilities.close, true, 'owned Prime roots can stop through their supervisor');
  assert.equal(capabilities.restart, true);
  assert.equal(capabilities.queueCancel, false);

  const commands = await getArray(`/api/commands?sessionId=${encodeURIComponent(id)}`);
  const models = await getArray(`/api/models?sessionId=${encodeURIComponent(id)}`);
  assert.ok(commands.body.length > 0);
  assert.ok(models.body.some(model => model.provider === 'openai' && model.id === 'gpt-4o-mini'));
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/rename`, { name: 'Prime managed real canary' })).status, 200);
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/thinking`, { level: 'low' })).status, 200);
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/command`, { message: '/dish-push' })).status, 200);
  const turn = await runStreamedTurn(id, 'pi-dish managed Prime integration canary');

  const spawn = record(present(tmuxApi().getSpawn(id)));
  assert.ok(spawn.wrapperPath && fs.existsSync(text(spawn.wrapperPath)));
  assert.ok(spawn.spawnToken && record(spawn.paneProcess).startTime);
  const first = await findPrimeClaim(spawn);
  assert.notEqual(Number(first.claim.pid), Number(record(spawn.paneProcess).pid), 'Prime worker and client pane must differ');
  process.kill(Number(first.claim.pid), 0);

  const peer = await post('/api/sessions/new', { harness: 'prime', model: 'openai/gpt-4o-mini', target: target() });
  const peerId = text(peer.body.id);
  const peerSpawn = record(present(tmuxApi().getSpawn(peerId)));
  const peerClaim = await findPrimeClaim(peerSpawn);
  const { processIdentityAlive }: typeof import('../lib/process-identity') = require('../lib/process-identity')
  const originalLocation = await tmuxApi().paneLocation(text(spawn.socket), text(spawn.paneId));
  const restarted = await post(`/api/sessions/${encodeURIComponent(id)}/restart`);
  assert.equal(restarted.status, 200, JSON.stringify(restarted.body));
  assert.equal(processIdentityAlive(first.claim), false, 'restart exits the worker, not just the client');
  assert.equal(processIdentityAlive(peerClaim.claim), true, 'restart leaves other roots alive');
  const restartedSpawn = record(present(tmuxApi().getSpawn(id)));
  const restartedClaim = await findPrimeClaim(restartedSpawn);
  assert.notEqual(restartedSpawn.spawnToken, spawn.spawnToken);
  assert.equal(restartedClaim.claim.sessionFile, first.claim.sessionFile);
  assert.deepEqual(await tmuxApi().paneLocation(text(restartedSpawn.socket), text(restartedSpawn.paneId)), originalLocation);
  const restartedTurn = await runStreamedTurn(id, 'Prime answers after same-pane restart');
  assert.ok(records(restartedTurn.transcript.body.messages).some(message => JSON.stringify(message.content).includes(turn.assistantText)),
    'pre-restart transcript survives');
  await runStreamedTurn(peerId, 'Prime peer still answers after another root restarts');

  const closed = await post(`/api/sessions/${encodeURIComponent(id)}/close`);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(processIdentityAlive(restartedClaim.claim), false);
  assert.equal(await tmuxApi().paneExists(text(spawn.socket), text(spawn.paneId)), false);
  assert.equal(processIdentityAlive(peerClaim.claim), true);
  await runStreamedTurn(peerId, 'Prime peer still answers after another root closes');
  const inactiveList = await get('/api/sessions?active=1');
  assert.ok(!records(inactiveList.body.active).some(session => session.id === id));

  const resumed = await post(`/api/sessions/${encodeURIComponent(id)}/resume`, { target: target() });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  const resumedSpawn = record(present(tmuxApi().getSpawn(id)));
  const second = await findPrimeClaim(resumedSpawn);
  assert.notEqual(Number(second.claim.pid), Number(record(resumedSpawn.paneProcess).pid));
  const messages = await get(`/api/sessions/${encodeURIComponent(id)}/messages`);
  assert.equal(record(messages.body.session).harnessId, 'prime');
  const resumedTurn = await runStreamedTurn(id, 'pi-dish managed Prime post-resume integration canary');
  assert.ok(resumedTurn.providerRequestSequence > turn.providerRequestSequence);
  assert.ok(records(resumedTurn.transcript.body.messages).some(message =>
    JSON.stringify(message.content).includes(resumedTurn.assistantText)));

  holdNextResponse = true;
  const beforeBusyTurn = fakeRequestCount;
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/prompt`, { message: 'Keep this turn open for the close canary' })).status, 200);
  await waitFor(async () => fakeRequestCount > beforeBusyTurn
    && records((await get('/api/sessions?active=1')).body.active).some(row => row.id === id && row.turnInProgress), 'Prime turn in progress');
  const busyRestart = await post(`/api/sessions/${encodeURIComponent(id)}/restart`);
  assert.equal(busyRestart.status, 200, JSON.stringify(busyRestart.body));
  assert.equal(processIdentityAlive(second.claim), false);
  const busyReplacement = await findPrimeClaim(tmuxApi().getSpawn(id));
  await runStreamedTurn(id, 'Prime answers after restarting during a turn');

  holdNextResponse = true;
  const beforeBusyClose = fakeRequestCount;
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/prompt`, { message: 'Keep this turn open for close' })).status, 200);
  await waitFor(async () => fakeRequestCount > beforeBusyClose
    && records((await get('/api/sessions?active=1')).body.active).some(row => row.id === id && row.turnInProgress), 'Prime turn before close');
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/close`)).status, 200);
  assert.equal(processIdentityAlive(busyReplacement.claim), false);
  assert.equal(processIdentityAlive(peerClaim.claim), true);

  const manualDaemon = path.join(root, 'prime-manual-daemon.sock');
  execFileSync('tmux', ['-S', tmuxSocket, 'new-session', '-d', '-s', 'prime-manual', [
    'env', `HOME=${shellWord(home)}`, `PI_DISH_SOCKET_DIR=${shellWord(socketDir)}`,
    shellWord(primeBin), '--offline', '--daemon-socket', shellWord(manualDaemon),
    '--model', 'openai/gpt-4o-mini',
  ].join(' ')], { stdio: 'ignore' });
  try {
    await waitFor(() => {
      let names: string[];
      try { names = fs.readdirSync(path.join(home, '.pi', 'dish', 'sessions')); } catch { return null; }
      for (const name of names) {
        try {
          const claim = record(JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'sessions', name), 'utf8')));
          if (record(claim.wrapper).harnessId === 'prime' && !claim.spawnToken) return claim;
        } catch {}
      }
      return null;
    }, 'tokenless discovery registration from a manual prime TUI', 30000);
    const manualList = await get('/api/sessions?active=1');
    const primeSessions = records(manualList.body.active).filter(session => session.harnessId === 'prime');
    assert.ok(primeSessions.length >= 2);
    const manual = present(primeSessions.find(session => session.id !== peerId));
    assert.equal(record(manual.capabilities).close, false);
    assert.equal((await post(`/api/sessions/${encodeURIComponent(text(manual.id))}/close`)).status, 409);
  } finally {
    try { execFileSync('tmux', ['-S', tmuxSocket, 'kill-session', '-t', 'prime-manual'], { stdio: 'ignore' }); } catch {}
    try { await shutdownPrime(manualDaemon); } catch {}
  }

  await tmuxApi().killPane(text(peerSpawn.socket), text(peerSpawn.paneId));
  await waitFor(async () => !processIdentityAlive(record(peerSpawn.paneProcess))
    && !await tmuxApi().paneExists(text(peerSpawn.socket), text(peerSpawn.paneId)), 'Prime client exit after pane removal');
  const headlessClose = await post(`/api/sessions/${encodeURIComponent(peerId)}/close`);
  assert.equal(headlessClose.status, 200, JSON.stringify(headlessClose.body));
  assert.equal(processIdentityAlive(peerClaim.claim), false);

  return {
    version: execFileSync(String(primeBin), ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(),
    routeNamespace: id.slice(0, 5),
    commands: commands.body.length,
    models: models.body.length,
    streamedTurnEvents: turn.events,
    persistedAssistantMessage: true,
    wrapperTokenClaimed: true,
    workerClientSplit: true,
    ownedRootClosed: true,
    busyRootClosed: true,
    samePaneRestarted: true,
    busyRootRestarted: true,
    postRestartPersistedAssistantMessage: true,
    otherRootSurvivedAndAnswered: true,
    closeAfterClientExit: true,
    manualDiscoveryRegistered: true,
    manualCloseRefused: true,
    postResumePersistedAssistantMessage: true,
  };
}

async function cleanup() {
  try { await shutdownPrime(); } catch {}
  const activeServer = server;
  if (activeServer?.listening) await new Promise<void>((resolve, reject) => activeServer.close(error => error ? reject(error) : resolve()));
  if (fakeOpenAi.listening) await new Promise<void>((resolve, reject) => fakeOpenAi.close(error => error ? reject(error) : resolve()));
  try { execFileSync('tmux', ['-S', tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch {}
  await sleep(250);
  fs.rmSync(root, { recursive: true, force: true });
}

(async () => {
  try {
    await new Promise<void>((resolve, reject) => {
      fakeOpenAi.once('error', reject);
      fakeOpenAi.listen(0, '127.0.0.1', resolve);
    });
    process.env.OPENAI_API_KEY = 'pi-dish-local-canary-key';
    const fakeAddress = fakeOpenAi.address();
    if (!fakeAddress || typeof fakeAddress === 'string') throw new Error('Fake provider lacks TCP address');
    const fakeBaseUrl = `http://127.0.0.1:${fakeAddress.port}/v1`;
    process.env.OPENAI_BASE_URL = fakeBaseUrl;
    for (const agentDir of [path.join(home, '.omp', 'agent'), path.join(home, '.prime', 'agent')]) {
      fs.mkdirSync(agentDir, { recursive: true });
    }
    fs.writeFileSync(path.join(home, '.omp', 'agent', 'models.yml'), [
      'providers:',
      '  openai:',
      `    baseUrl: ${JSON.stringify(fakeBaseUrl)}`,
      '    apiKey: pi-dish-local-canary-key',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(home, '.prime', 'agent', 'models.json'), JSON.stringify({
      providers: { openai: { baseUrl: fakeBaseUrl, apiKey: 'pi-dish-local-canary-key' } },
    }, null, 2));
    tmuxSessionId = execFileSync('tmux', [
      '-S', tmuxSocket, '-f', '/dev/null', 'new-session', '-d', '-s', 'work', '-c', work,
      '-P', '-F', '#{session_id}',
      process.execPath, idleChild,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const activeServer: http.Server = require('../server.js');
    server = activeServer;
    tmux = require('../lib/tmux');
    if (!activeServer.listening) await new Promise<void>(resolve => activeServer.once('listening', resolve));
    const serverAddress = activeServer.address();
    if (!serverAddress || typeof serverAddress === 'string') throw new Error('Canary server lacks TCP address');
    base = `http://127.0.0.1:${serverAddress.port}`;
    const harnesses = await get('/api/harnesses');
    assert.equal(harnesses.status, 200);
    const installed = records(harnesses.body.harnesses);
    for (const id of selected) {
      const harness = present(installed.find(item => item.id === id));
      assert.equal(harness.available, true, `${id} must be reported installed`);
      assert.equal(harness.rpcFallback, false);
    }
    const result: TestRecord = {};
    for (const id of selected) result[id] = await (id === 'omp' ? testOmp() : testPrime());
    // OMP: one streamed turn plus one ephemeral /btw side turn.
    const expectedCalls = (selected.includes('omp') ? 2 : 0) + (selected.includes('prime') ? 8 : 0);
    assert.equal(fakeRequestCount, expectedCalls, 'each streamed turn must use the local fake provider');
    result.fakeProviderRequests = fakeRequestCount;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await cleanup();
  }
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

export {};
