#!/usr/bin/env node
'use strict';

/**
 * Opt-in integration canary for the real OMP and Prime Agent CLIs.
 *
 * This intentionally does not run under `npm test`: both harnesses are large,
 * independently released tools. Install them, then provide their executable
 * paths (and Bun's bin directory for OMP):
 *
 *   PI_DISH_REAL_OMP_BIN=/path/to/omp \
 *   PI_DISH_REAL_PRIME_BIN=/path/to/prime-agent \
 *   PI_DISH_REAL_BUN_BIN_DIR=/path/containing/bun \
 *   npm run test:lineage
 *
 * The canary uses an isolated HOME, tmux server, bridge socket directory, and
 * Prime daemon. It sends real streamed turns only to a localhost fake OpenAI
 * Responses endpoint, with a dummy key; no paid credentials are used.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ompBin = process.env.PI_DISH_REAL_OMP_BIN;
const primeBin = process.env.PI_DISH_REAL_PRIME_BIN;
const bunBinDir = process.env.PI_DISH_REAL_BUN_BIN_DIR;
if (!ompBin || !primeBin || !bunBinDir) {
  throw new Error('PI_DISH_REAL_OMP_BIN, PI_DISH_REAL_PRIME_BIN, and PI_DISH_REAL_BUN_BIN_DIR are required');
}
for (const [name, file] of [['OMP', ompBin], ['Prime Agent', primeBin]]) {
  fs.accessSync(file, fs.constants.X_OK);
  if (!path.isAbsolute(file)) throw new Error(`${name} executable path must be absolute`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-lineage-real-'));
const home = path.join(root, 'home');
const tmuxDir = path.join(root, 'tmux');
const tmuxSocket = path.join(tmuxDir, 's');
const work = path.join(root, 'work');
const socketDir = path.join(root, 'sockets');
const primeDaemon = path.join(root, 'prime-daemon.sock');
for (const dir of [home, tmuxDir, work, socketDir]) fs.mkdirSync(dir, { recursive: true });
fs.chmodSync(socketDir, 0o700);

// Drop the operator's deployment env (HOST/PORT/share port) before pinning
// this run's own — see test/test-env.js.
require('../test/test-env').applyTestEnv();
const originalPath = process.env.PATH || '';
process.env.PATH = [bunBinDir, path.dirname(ompBin), path.dirname(primeBin), originalPath].join(path.delimiter);
process.env.HOME = home;
process.env.TMUX_TMPDIR = tmuxDir;
process.env.PORT = '0';
process.env.PI_DISH_SOCKET_DIR = socketDir;
process.env.PI_DISH_SPAWN_TIMEOUT_MS = '20000';

const shellWord = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
process.env.PI_DISH_OMP_COMMAND = [
  shellWord(ompBin), '--no-extensions', '--no-skills', '--no-rules',
].join(' ');
process.env.PI_DISH_PRIME_COMMAND = [
  shellWord(primeBin), '--offline', '--daemon-socket', shellWord(primeDaemon),
  '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files',
].join(' ');

const { encodeSessionKey } = require('../lib/session-key');
let server = null;
let tmux = null;

let fakeRequestCount = 0;
const fakeRequests = [];
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
    let request;
    try { request = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    assert.equal(request.stream, true);
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
      await sleep(25);
    }
    res.end();
  });
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let base;

async function request(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, body: data };
}

const get = route => request('GET', route);
const post = (route, body = {}) => request('POST', route, body);
const target = () => ({ type: 'tmux', socket: tmuxSocket, tmuxSession: 'work' });

async function waitFor(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function runStreamedTurn(sessionId, prompt) {
  const requestCountBefore = fakeRequestCount;
  const expectedAssistantText = `pi-dish fake provider response ${requestCountBefore + 1}`;
  const abort = new AbortController();
  const response = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/stream`, { signal: abort.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  const eventPayloads = [];
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
            try { eventPayloads.push({ event, data: JSON.parse(data) }); } catch {}
          }
        }
      }
    }
  })().catch(error => {
    if (error.name !== 'AbortError') throw error;
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
        && messages.body.messages?.some(message => JSON.stringify(message.content).includes(expectedAssistantText))
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
    throw new Error(`${error.message} (${details})`, { cause: error });
  } finally {
    abort.abort();
    try { await reader.cancel(); } catch {}
    await pump;
  }
}

async function shutdownPrime() {
  if (!fs.existsSync(primeDaemon)) return { success: true };
  // Prime 0.7.1's public `shutdown` command discovers every daemon and cannot
  // be scoped to a socket. Use the installed protocol client so this canary
  // stops only the isolated supervisor it created.
  const packageRoot = path.resolve(path.dirname(fs.realpathSync(primeBin)), '..', '..');
  const clientModule = path.join(packageRoot, 'dist', 'modes', 'daemon', 'daemon-client.js');
  const { DaemonClient } = await import(pathToFileURL(clientModule).href);
  const client = new DaemonClient(primeDaemon);
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
  assert.match(created.body.id, /^~sk1_/);
  const id = created.body.id;
  const active = await waitFor(async () => {
    const list = await get('/api/sessions?active=1');
    return list.body.active?.find(session => session.id === id);
  }, 'real OMP active session');
  assert.equal(active.harnessId, 'omp');
  assert.equal(active.capabilities.prompt, true);
  assert.equal(active.capabilities.close, true);
  assert.equal(active.capabilities.queueCancel, false);
  assert.equal(active.capabilities.tree, false);

  const commands = await get(`/api/commands?sessionId=${encodeURIComponent(id)}`);
  assert.equal(commands.status, 200, JSON.stringify(commands.body));
  assert.ok(Array.isArray(commands.body) && commands.body.length > 0);
  const models = await get(`/api/models?sessionId=${encodeURIComponent(id)}`);
  assert.equal(models.status, 200, JSON.stringify(models.body));
  assert.ok(Array.isArray(models.body) && models.body.some(model => model.provider === 'openai' && model.id === 'gpt-4o-mini'));
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/rename`, { name: 'OMP managed real canary' })).status, 200);
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/thinking`, { level: 'low' })).status, 200);
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/command`, { message: '/dish-push' })).status, 200);
  const turn = await runStreamedTurn(id, 'pi-dish managed OMP integration canary');
  const closeSpawn = tmux.getSpawn(id);
  assert.ok(closeSpawn?.paneProcess?.startTime, 'real OMP close has an owned pane identity');
  const close = await post(`/api/sessions/${encodeURIComponent(id)}/close`);
  assert.equal(close.status, 200, JSON.stringify(close.body));
  assert.equal(await tmux.paneExists(closeSpawn.socket, closeSpawn.paneId), false);
  assert.equal(tmux.getSpawn(id), null);

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
  ].map(JSON.stringify).join('\n') + '\n');

  const resumeId = encodeSessionKey('omp', resumeNativeId);
  const resumed = await post(`/api/sessions/${encodeURIComponent(resumeId)}/resume`, { target: target() });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.id, resumeId);
  const messages = await get(`/api/sessions/${encodeURIComponent(resumeId)}/messages`);
  assert.equal(messages.status, 200, JSON.stringify(messages.body));
  assert.equal(messages.body.session.harnessId, 'omp');
  assert.ok(messages.body.messages.some(message => JSON.stringify(message.content).includes('real OMP resume canary')),
    JSON.stringify({ session: messages.body.session, messages: messages.body.messages, file: fs.readFileSync(resumeFile, 'utf8') }));

  return {
    version: '17.2.11',
    routeNamespace: id.slice(0, 5),
    commands: commands.body.length,
    models: models.body.length,
    streamedTurnEvents: turn.events,
    persistedAssistantMessage: true,
    closeStatus: close.status,
    resumeSameRoute: resumed.body.id === resumeId,
    historyMessageRead: true,
  };
}

async function findPrimeClaim(spawn) {
  const registryDir = path.join(home, '.pi', 'dish', 'sessions');
  return waitFor(() => {
    let names;
    try { names = fs.readdirSync(registryDir); } catch { return null; }
    for (const name of names) {
      try {
        const file = path.join(registryDir, name);
        const claim = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (claim.wrapper?.harnessId === 'prime' && claim.spawnToken === spawn.spawnToken) {
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
  assert.match(created.body.id, /^~sk1_/);
  const id = created.body.id;
  const active = await waitFor(async () => {
    const list = await get('/api/sessions?active=1');
    return list.body.active?.find(session => session.id === id);
  }, 'real Prime active session');
  assert.equal(active.harnessId, 'prime');
  assert.equal(active.capabilities.close, false,
    'Prime 0.7.1 worker remains a client descendant, so detach must be disabled');
  assert.equal(active.capabilities.queueCancel, false);

  const commands = await get(`/api/commands?sessionId=${encodeURIComponent(id)}`);
  assert.equal(commands.status, 200, JSON.stringify(commands.body));
  assert.ok(Array.isArray(commands.body) && commands.body.length > 0);
  const models = await get(`/api/models?sessionId=${encodeURIComponent(id)}`);
  assert.equal(models.status, 200, JSON.stringify(models.body));
  assert.ok(Array.isArray(models.body) && models.body.some(model => model.provider === 'openai' && model.id === 'gpt-4o-mini'));
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/rename`, { name: 'Prime managed real canary' })).status, 200);
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/thinking`, { level: 'low' })).status, 200);
  assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/command`, { message: '/dish-push' })).status, 200);
  const turn = await runStreamedTurn(id, 'pi-dish managed Prime integration canary');

  const spawn = tmux.getSpawn(id);
  assert.ok(spawn?.wrapperPath && fs.existsSync(spawn.wrapperPath));
  assert.ok(spawn.spawnToken && spawn.paneProcess?.startTime);
  const first = await findPrimeClaim(spawn);
  assert.notEqual(Number(first.claim.pid), Number(spawn.paneProcess.pid), 'Prime worker and client pane must differ');
  process.kill(first.claim.pid, 0);

  const refusedClose = await post(`/api/sessions/${encodeURIComponent(id)}/close`);
  assert.equal(refusedClose.status, 409, JSON.stringify(refusedClose.body));
  assert.match(refusedClose.body.error, /worker is still in .* client pane.*process tree/i);
  process.kill(first.claim.pid, 0);
  assert.equal(await tmux.paneExists(spawn.socket, spawn.paneId), true);

  // Stop only the isolated daemon. Once the worker is gone it is safe to clean
  // up this canary's exact pane, then prove the persisted flat JSONL resumes
  // via the actual Prime CLI and a fresh generated correlation wrapper.
  const shutdown = await shutdownPrime();
  assert.equal(shutdown.success, true, shutdown.error);
  await waitFor(() => {
    try { process.kill(first.claim.pid, 0); return false; } catch { return true; }
  }, 'Prime worker shutdown', 20000);
  if (await tmux.paneExists(spawn.socket, spawn.paneId)) {
    await tmux.killPane(spawn.socket, spawn.paneId);
  }
  tmux.removeSpawn(id, spawn);
  await sleep(800); // expire the server registry memo before resume dispatch
  const inactiveList = await get('/api/sessions?active=1');
  assert.ok(!inactiveList.body.active.some(session => session.id === id));

  const resumed = await post(`/api/sessions/${encodeURIComponent(id)}/resume`, { target: target() });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.id, id);
  const resumedSpawn = tmux.getSpawn(id);
  assert.ok(resumedSpawn?.spawnToken && resumedSpawn.spawnToken !== spawn.spawnToken);
  const second = await findPrimeClaim(resumedSpawn);
  assert.notEqual(Number(second.claim.pid), Number(resumedSpawn.paneProcess.pid));
  const messages = await get(`/api/sessions/${encodeURIComponent(id)}/messages`);
  assert.equal(messages.status, 200, JSON.stringify(messages.body));
  assert.equal(messages.body.session.harnessId, 'prime');
  const resumedTurn = await runStreamedTurn(id, 'pi-dish managed Prime post-resume integration canary');
  assert.ok(resumedTurn.providerRequestSequence > turn.providerRequestSequence,
    'post-resume turn must issue a new fake-provider request');
  assert.ok(resumedTurn.transcript.body.messages.some(message =>
    JSON.stringify(message.content).includes(resumedTurn.assistantText)),
  'post-resume assistant message must persist in Prime history');
  const resumedClose = await post(`/api/sessions/${encodeURIComponent(id)}/close`);
  assert.equal(resumedClose.status, 409, JSON.stringify(resumedClose.body));
  assert.match(resumedClose.body.error, /worker is still in .* client pane.*process tree/i);

  return {
    version: '0.7.1',
    routeNamespace: id.slice(0, 5),
    commands: commands.body.length,
    models: models.body.length,
    streamedTurnEvents: turn.events,
    persistedAssistantMessage: true,
    wrapperTokenClaimed: true,
    workerClientSplit: true,
    unsafeDetachRefused: true,
    resumeSameRoute: resumed.body.id === id,
    historyRouteRead: true,
    postResumeStreamedTurnEvents: resumedTurn.events,
    postResumePersistedAssistantMessage: true,
  };
}

async function cleanup() {
  try { await shutdownPrime(); } catch {}
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (fakeOpenAi.listening) await new Promise(resolve => fakeOpenAi.close(resolve));
  try { execFileSync('tmux', ['-S', tmuxSocket, 'kill-server'], { stdio: 'ignore' }); } catch {}
  await sleep(250);
  fs.rmSync(root, { recursive: true, force: true });
}

(async () => {
  try {
    await new Promise((resolve, reject) => {
      fakeOpenAi.once('error', reject);
      fakeOpenAi.listen(0, '127.0.0.1', resolve);
    });
    process.env.OPENAI_API_KEY = 'pi-dish-local-canary-key';
    const fakeBaseUrl = `http://127.0.0.1:${fakeOpenAi.address().port}/v1`;
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
    execFileSync('tmux', [
      '-S', tmuxSocket, '-f', '/dev/null', 'new-session', '-d', '-s', 'work', '-c', work,
    ], { stdio: 'ignore' });
    server = require('../server.js');
    tmux = require('../lib/tmux');
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const harnesses = await get('/api/harnesses');
    assert.equal(harnesses.status, 200);
    for (const id of ['omp', 'prime']) {
      const harness = harnesses.body.harnesses.find(item => item.id === id);
      assert.equal(harness?.available, true, `${id} must be reported installed`);
      assert.equal(harness.rpcFallback, false);
    }
    const result = { omp: await testOmp(), prime: await testPrime() };
    assert.ok(fakeRequestCount >= 3, `expected at least three fake provider calls, got ${fakeRequestCount}`);
    result.fakeProviderRequests = fakeRequestCount;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await cleanup();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
