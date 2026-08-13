/**
 * Tests for the RPC session backend (lib/rpc-session.js) and the server
 * routes that ride on it — the default headless `pi --mode rpc` path that
 * POST /api/sessions/new and /resume take when no tmux target is given.
 *
 * PI_DISH_PI_COMMAND points at test/fixtures/fake-rpc-pi.js, which speaks
 * pi's real RPC stdio protocol (JSONL commands in, responses + agent events
 * out) and logs every command it receives to PI_FIXTURE_LOG, so tests assert
 * both the HTTP-visible outcome and what pi was actually asked.
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sseReader } = require('./sse-reader');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-rpc-test-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
// This suite is about the RPC child backend — pin the headless dispatch to it
// so a host with tmux doesn't divert target-less spawns to hidden tmux.
process.env.PI_DISH_HEADLESS = 'rpc';

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-rpc-pi.js');
const CMD_LOG = path.join(tmpHome, 'rpc-commands.jsonl');
const START_LOG = path.join(tmpHome, 'rpc-starts.jsonl');
process.env.PI_DISH_PI_COMMAND = `env PI_FIXTURE_LOG=${CMD_LOG} ${process.execPath} ${FIXTURE}`;
process.env.PI_FIXTURE_START_LOG = START_LOG;

const server = require('../server.js');
const { getAllRPCSessions, getRPCSession } = require('../lib/rpc-session');
const { invalidateRegistryCache } = require('../lib/bridge-session');
const { processIdentity } = require('../lib/process-identity');

let base;
test.before(async () => {
  if (!server.listening) await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  // The spawned fixture children are live handles — without killing them the
  // node:test process never exits.
  for (const rpc of getAllRPCSessions()) rpc.kill();
  server.close();
});

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const readLog = () => {
  try {
    return fs.readFileSync(CMD_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
};

const readStarts = () => {
  try {
    return fs.readFileSync(START_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
};

const findActive = async (id) => {
  const { body } = await get('/api/sessions?active=1');
  return body.active.find(s => s.id === id) || null;
};

// One RPC session shared by the ordered tests below (each spawn is a real
// child process; reusing it also proves the session stays usable).
let sessionId;

test('getPiLaunchSpec resolves a bare `pi` past node_modules/.bin shims', () => {
  // Under npm-run PATHs, pi-dish's own dependency shim would shadow the host
  // pi — the spec must skip node_modules dirs when resolving the bare word.
  const { getPiLaunchSpec } = require('../lib/rpc-session');
  const saved = { cmd: process.env.PI_DISH_PI_COMMAND, path: process.env.PATH };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-path-'));
  const shimDir = path.join(dir, 'node_modules', '.bin');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(shimDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(shimDir, 'pi'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'pi'), '#!/bin/sh\n', { mode: 0o755 });
  try {
    delete process.env.PI_DISH_PI_COMMAND;
    process.env.PATH = `${shimDir}${path.delimiter}${binDir}`;
    assert.equal(getPiLaunchSpec().argv[0], path.join(binDir, 'pi'),
      'shim dir is skipped, host pi wins');
    // With nothing but shims on PATH, degrade to the bare word.
    process.env.PATH = shimDir;
    assert.equal(getPiLaunchSpec().argv[0], 'pi');
  } finally {
    process.env.PI_DISH_PI_COMMAND = saved.cmd;
    process.env.PATH = saved.path;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/models lists what the host pi reports, not the vendored CLI', async () => {
  // lib/pi-sdk.js runs --list-models through the same launch spec sessions
  // use (PI_DISH_PI_COMMAND here) — a host pi upgrade must show up without
  // touching pi-dish's own node_modules copy.
  const { status, body } = await get('/api/models');
  assert.equal(status, 200);
  const ids = body.map((m) => `${m.provider}/${m.id}`);
  assert.ok(ids.includes('test/fake-model'), `host pi models listed (got ${ids.join(', ')})`);
  assert.ok(ids.includes('test/fresh-model'), 'a model only the host pi knows shows up');
  assert.equal(body.find((m) => m.id === 'fresh-model').contextWindow, 200000,
    'context window parsed from the host table');
});

test('POST /api/sessions/new spawns a headless RPC pi and lists it active', async () => {
  const { status, body } = await post('/api/sessions/new', { name: 'Named from creation', thinking: 'high' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.id, 'a session id is returned');
  assert.equal(Object.hasOwn(body, 'operationId'), false, 'ordinary blocking response stays backward-compatible');
  sessionId = body.id;
  const start = readStarts().find(entry => entry.sessionFile.endsWith(`${sessionId}.jsonl`));
  assert.deepEqual(start?.args.slice(start.args.indexOf('--thinking'), start.args.indexOf('--thinking') + 2),
    ['--thinking', 'high'], 'reasoning level is forwarded to the pi CLI');

  const sess = await findActive(sessionId);
  assert.ok(sess, 'spawned session is in the active list');
  assert.equal(sess.isActive, true);
  assert.equal(sess.name, 'Named from creation', 'the requested name is applied before creation completes');
  assert.ok(readLog().some(c => c.type === 'set_session_name' && c.name === 'Named from creation'),
    'creation names the session through the live RPC backend');
  assert.equal(sess.model, 'test/fake-model', 'model comes from get_state');
  assert.equal(sess.turnInProgress, false);
  assert.ok(sess.pid, 'the child pid is reported');

  // The fixture created a real session JSONL — the message reader sees it.
  const messages = await get(`/api/sessions/${sessionId}/messages`);
  assert.equal(messages.status, 200);
});

test('POST /api/sessions/new rejects an invalid reasoning level', async () => {
  const { status, body } = await post('/api/sessions/new', { thinking: 'extreme' });
  assert.equal(status, 400);
  assert.match(body.error, /reasoning level/i);
});

test('POST /api/sessions/new rejects a blank session name', async () => {
  const { status, body } = await post('/api/sessions/new', { name: '   ' });
  assert.equal(status, 400);
  assert.match(body.error, /name/i);
});

test('source-aware spawn records advisory peer provenance', async () => {
  const spawned = await post('/api/sessions/new', { requestedBySessionId: sessionId });
  assert.equal(spawned.status, 200, JSON.stringify(spawned.body));
  const peerId = spawned.body.id;
  assert.ok(spawned.body.operationId, 'attributed blocking spawn returns its recorded operation id');
  assert.ok(await findActive(peerId), 'peer is an otherwise ordinary active RPC session');

  const sourceRelated = await get(`/api/sessions/${sessionId}/related`);
  assert.ok(sourceRelated.body.relations.some(r => r.kind === 'startedHere' && r.session.id === peerId));
  const peerRelated = await get(`/api/sessions/${peerId}/related`);
  assert.ok(peerRelated.body.relations.some(r => r.kind === 'startedFrom' && r.session.id === sessionId));

  const pending = await post('/api/sessions/new', {
    async: true,
    name: 'Named async peer',
    requestedBySessionId: sessionId,
  });
  assert.equal(pending.status, 202, JSON.stringify(pending.body));
  let operation;
  for (let i = 0; i < 80; i++) {
    const state = await get(`/api/session-spawns/${pending.body.spawnId}`);
    operation = state.body;
    if (state.status !== 202) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(operation?.status, 'ready', JSON.stringify(operation));
  assert.equal((await findActive(operation.sessionId))?.name, 'Named async peer',
    'an async spawn is not ready until its requested name is applied');
  const asyncRelated = await get(`/api/sessions/${operation.sessionId}/related`);
  assert.ok(asyncRelated.body.relations.some(r => r.kind === 'startedFrom' && r.session.id === sessionId),
    'async spawn persists the same advisory provenance');
});

test('an unreachable bridge falls back to the existing RPC transport without spawning', async () => {
  const rpc = getRPCSession(sessionId);
  assert.ok(rpc?.alive, 'fixture RPC transport is healthy');
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  const registryPath = path.join(registryDir, `${sessionId}.json`);
  const socketPath = path.join(tmpHome, 'unreachable-bridge.sock');
  fs.mkdirSync(registryDir, { recursive: true });
  // A regular file exists (so registry scanning retains the claim) but cannot
  // accept a Unix-socket connection, deterministically yielding ECONNREFUSED.
  fs.writeFileSync(socketPath, 'not a listening socket');
  const identity = processIdentity(process.pid);
  fs.writeFileSync(registryPath, JSON.stringify({
    sessionId,
    sessionFile: rpc.sessionFile,
    cwd: rpc.cwd,
    socketPath,
    pid: identity.pid,
    startTime: identity.startTime,
  }));
  invalidateRegistryCache();
  const startsBefore = readStarts().length;
  const processCountBefore = getAllRPCSessions().length;

  try {
    const commands = await get(`/api/commands?sessionId=${encodeURIComponent(sessionId)}`);
    assert.equal(commands.status, 200, JSON.stringify(commands.body));
    assert.equal(readStarts().length, startsBefore, 'transport fallback did not launch another pi');
    assert.equal(getAllRPCSessions().length, processCountBefore, 'RPC session set is unchanged');
    assert.equal(getRPCSession(sessionId), rpc, 'the already-owned RPCSession was reused');
    assert.equal(fs.existsSync(registryPath), false, 'definitively unreachable claim was pruned');
  } finally {
    fs.rmSync(registryPath, { force: true });
    fs.rmSync(socketPath, { force: true });
    invalidateRegistryCache();
  }
});

test('prompt round-trips: RPC events stream over SSE and land in the JSONL', async () => {
  const sse = sseReader(`${base}/api/sessions/${sessionId}/stream`);
  try {
    await sse.waitFor(e => e.event === 'init');

    const { status } = await post(`/api/sessions/${sessionId}/prompt`, { message: 'hello fixture' });
    assert.equal(status, 200);

    await sse.waitFor(e => e.event === 'turn_start');
    const update = await sse.waitFor(e => e.event === 'message_update');
    assert.equal(update.data.message.role, 'assistant');
    assert.ok(update.data.message.content[0].text.length > 0,
      'Pi 0.84 delta-only updates are reassembled into full SSE messages');
    const end = await sse.waitFor(e => e.event === 'message_end');
    assert.equal(end.data.message.content[0].text, 'reply to: hello fixture');
    await sse.waitFor(e => e.event === 'turn_end');

    // The turn's final message was appended to the session JSONL.
    const { body } = await get(`/api/sessions/${sessionId}/messages`);
    const texts = body.messages.map(m => m.content?.[0]?.text || '');
    assert.ok(texts.includes('reply to: hello fixture'), 'assistant reply is in the JSONL');
  } finally {
    sse.close();
  }
});

test('RPC SSE reconnect replays a running tool start and latest update', async () => {
  const rpc = getRPCSession(sessionId);
  rpc._handleMessage({ type: 'turn_start' });
  rpc._handleMessage({
    type: 'tool_execution_start', toolCallId: 'rpc-replay-tool',
    toolName: 'Read', args: { path: 'README.md' }, startedAt: 456,
  });
  rpc._handleMessage({
    type: 'tool_execution_update', toolCallId: 'rpc-replay-tool',
    partialResult: { content: [{ type: 'text', text: 'partial read' }] },
  });

  const sse = sseReader(`${base}/api/sessions/${sessionId}/stream`);
  try {
    await sse.waitFor(e => e.event === 'init');
    const start = await sse.waitFor(e => e.event === 'tool_execution_start' && e.data?.toolCallId === 'rpc-replay-tool');
    const update = await sse.waitFor(e => e.event === 'tool_execution_update' && e.data?.toolCallId === 'rpc-replay-tool');
    assert.equal(start.data.toolName, 'Read');
    assert.deepEqual(start.data.args, { path: 'README.md' });
    assert.equal(start.data.startedAt, 456);
    assert.equal(update.data.partialResult.content[0].text, 'partial read');

    rpc._handleMessage({
      type: 'tool_execution_end', toolCallId: 'rpc-replay-tool', toolName: 'Read',
      args: { path: 'README.md' }, result: { content: [{ type: 'text', text: 'done' }] }, isError: false,
    });
    await sse.waitFor(e => e.event === 'tool_execution_end' && e.data?.toolCallId === 'rpc-replay-tool');
  } finally {
    rpc._handleMessage({ type: 'turn_end' });
    sse.close();
  }
});

test('a prompt sent mid-turn is delivered with steer behavior', async () => {
  const sse = sseReader(`${base}/api/sessions/${sessionId}/stream`);
  try {
    await sse.waitFor(e => e.event === 'init');
    await post(`/api/sessions/${sessionId}/prompt`, { message: 'slow: take your time' });
    await sse.waitFor(e => e.event === 'turn_start');

    const before = readLog().length;
    const { status } = await post(`/api/sessions/${sessionId}/prompt`, { message: 'second thought' });
    assert.equal(status, 200);

    const steered = readLog().slice(before).find(c => c.type === 'prompt' && c.message === 'second thought');
    assert.ok(steered, 'the mid-turn prompt reached pi');
    assert.equal(steered.streamingBehavior, 'steer', 'mid-turn prompts auto-steer instead of erroring');

    const followBefore = readLog().length;
    const follow = await post(`/api/sessions/${sessionId}/follow-up`, { message: 'after that' });
    assert.equal(follow.status, 200);
    const queued = readLog().slice(followBefore).find(c => c.type === 'prompt' && c.message === 'after that');
    assert.equal(queued.streamingBehavior, 'followUp', 'dedicated endpoint requests Pi follow-up delivery');

    await sse.waitFor(e => e.event === 'turn_end');
  } finally {
    sse.close();
  }
});

test('abort mid-turn ends the turn via agent_end (no paired turn_end)', async () => {
  const sse = sseReader(`${base}/api/sessions/${sessionId}/stream`);
  try {
    await sse.waitFor(e => e.event === 'init');
    await post(`/api/sessions/${sessionId}/prompt`, { message: 'slow: doomed turn' });
    await sse.waitFor(e => e.event === 'turn_start');

    const { status } = await post(`/api/sessions/${sessionId}/abort`, {});
    assert.equal(status, 200);
    await sse.waitFor(e => e.event === 'agent_end');
    assert.ok(!sse.events.some(e => e.event === 'turn_end'), 'aborted turn has no turn_end');

    // The backend must not think a turn is still running.
    const sess = await findActive(sessionId);
    assert.equal(sess.turnInProgress, false);
  } finally {
    sse.close();
  }
});

test('slash commands map onto RPC protocol commands', async () => {
  // /name → set_session_name, and the session list reflects it without a
  // re-fetch of get_state (setName patches this.state itself).
  const rename = await post(`/api/sessions/${sessionId}/command`, { message: '/name renamed via rpc' });
  assert.equal(rename.status, 200);
  assert.ok(readLog().some(c => c.type === 'set_session_name' && c.name === 'renamed via rpc'));
  assert.equal((await findActive(sessionId)).name, 'renamed via rpc');

  // /model with an explicit provider/id → set_model, state patched likewise.
  const model = await post(`/api/sessions/${sessionId}/command`, { message: '/model test/other-model' });
  assert.equal(model.status, 200);
  const setModel = readLog().find(c => c.type === 'set_model' && c.modelId === 'other-model');
  assert.ok(setModel, 'set_model was sent');
  assert.equal(setModel.provider, 'test');
  assert.equal((await findActive(sessionId)).model, 'test/other-model');

  // /thinking → set_thinking_level.
  const thinking = await post(`/api/sessions/${sessionId}/command`, { message: '/thinking high' });
  assert.equal(thinking.status, 200);
  assert.ok(readLog().some(c => c.type === 'set_thinking_level' && c.level === 'high'));

  // /compact → compact, with the token delta surfaced.
  const compact = await post(`/api/sessions/${sessionId}/command`, { message: '/compact' });
  assert.equal(compact.status, 200);
  assert.match(compact.body.info, /Compacted \(1000 → ~200 tokens\)/);

  // An extension command known via get_commands is sent as a prompt…
  const before = readLog().length;
  const ext = await post(`/api/sessions/${sessionId}/command`, { message: '/dish-ext' });
  assert.equal(ext.status, 200);
  assert.ok(readLog().slice(before).some(c => c.type === 'prompt' && c.message === '/dish-ext'));

  // …but a typo is rejected instead of reaching the model as literal text.
  const typo = await post(`/api/sessions/${sessionId}/command`, { message: '/nope' });
  assert.equal(typo.status, 400);
  assert.match(typo.body.error, /unknown or unsupported command/);
});

test('a /compact issued while one runs is refused, not forwarded to pi', async () => {
  const before = readLog().filter(c => c.type === 'compact').length;
  // The fixture holds the compaction open ~150ms (compaction_start streamed,
  // response deferred) — long enough to prove the second command is gated.
  const rpc = getRPCSession(sessionId);
  const started = new Promise(resolve => {
    const off = rpc.on('compaction_start', event => { off(); resolve(event); });
  });
  const firstP = post(`/api/sessions/${sessionId}/command`, { message: '/compact' });
  await started;

  // Mid-compaction the session list must say so (the client's sidebar dot
  // and SSE init frame read this flag).
  assert.equal((await findActive(sessionId)).compacting, true, 'list reflects compacting');

  const second = await post(`/api/sessions/${sessionId}/command`, { message: '/compact' });
  assert.equal(second.status, 400);
  assert.match(second.body.error, /already in progress/i);

  const first = await firstP;
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.match(first.body.info, /Compacted/);
  assert.equal((await findActive(sessionId)).compacting, false, 'flag clears when compaction ends');

  const compacts = readLog().filter(c => c.type === 'compact').length;
  assert.equal(compacts - before, 1, 'exactly one compact command reached pi');
});

test('overlapping RPC resumes launch exactly one process for the JSONL', async () => {
  const id = '2026-07-10T09-00-00-rpcflight';
  const dir = path.join(tmpHome, '.pi', 'agent', 'sessions', 'rpcflight');
  const startLog = path.join(tmpHome, 'rpc-resume-starts.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), JSON.stringify({ type: 'session', cwd: tmpHome }) + '\n');

  const saved = process.env.PI_DISH_PI_COMMAND;
  process.env.PI_DISH_PI_COMMAND = `env PI_FIXTURE_LOG=${CMD_LOG} PI_FIXTURE_START_LOG=${startLog} PI_FIXTURE_STARTUP_DELAY_MS=400 ${process.execPath} ${FIXTURE}`;
  try {
    const [a, b] = await Promise.all([
      post(`/api/sessions/${id}/resume`, {}),
      post(`/api/sessions/${id}/resume`, {}),
    ]);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(a.body.id, id);
    assert.equal(b.body.id, id);
    assert.equal([a.body, b.body].filter((body) => body.sharedResume).length, 1,
      'one caller owns the launch and one reports sharing it');
    const starts = fs.readFileSync(startLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(starts.length, 1, `exactly one RPC process started (got ${starts.length})`);
    assert.equal(path.resolve(starts[0].sessionFile), path.resolve(path.join(dir, `${id}.jsonl`)));

    const closed = await post(`/api/sessions/${id}/close`, {});
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
  } finally {
    process.env.PI_DISH_PI_COMMAND = saved;
  }
});

test('POST /resume spawns pi --session and keeps the original id', async () => {
  const id = '2026-07-10T09-00-00-rpcres01';
  const dir = path.join(tmpHome, '.pi', 'agent', 'sessions', 'resumerpc');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), [
    { type: 'session', cwd: tmpHome },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'old prompt' }], timestamp: '2026-07-10T09:00:01.000Z' } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n');

  const { status, body } = await post(`/api/sessions/${id}/resume`, {});
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.id, id, 'resume keeps the session id (derived from the --session file)');
  assert.ok(await findActive(id), 'resumed session is active');

  const again = await post(`/api/sessions/${id}/resume`, {});
  assert.equal(again.body.alreadyActive, true, 'resuming an active session is a no-op');
});

test('POST /resume preserves a nested generic session header id', async () => {
  const id = 'nested-rpc-core-id';
  const file = path.join(tmpHome, '.pi', 'agent', 'sessions', 'resumerpc', 'parent', 'scope', 'run-0', 'session.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    { type: 'session', id, cwd: tmpHome },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'nested prompt' }] } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n');

  const resumed = await post(`/api/sessions/${id}/resume`, {});
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.id, id, 'RPC identity matches bridge and historical discovery');
  assert.ok(await findActive(id), 'nested session is active under its header id');
  assert.equal(getRPCSession('session'), null, 'generic basename does not create a duplicate live identity');

  const closed = await post(`/api/sessions/${id}/close`, {});
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
});

test('a dead pi disappears from the active list', async () => {
  const sess = await findActive(sessionId);
  assert.ok(sess?.pid, 'need the child pid');
  process.kill(sess.pid, 'SIGKILL');

  // The exit handler prunes rpcSessions; poll until the list reflects it.
  let gone = false;
  for (let i = 0; i < 50 && !gone; i++) {
    gone = !(await findActive(sessionId));
    if (!gone) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(gone, 'killed session left the active list');
});

test('POST /close shuts down an RPC child and removes it from the active list', async () => {
  const { status, body } = await post('/api/sessions/new', {});
  assert.equal(status, 200, JSON.stringify(body));
  const id = body.id;
  assert.ok(await findActive(id), 'fresh session is active');

  // The stats modal's "Running in" row: a server-owned headless child.
  const stats = await get(`/api/sessions/${id}/stats`);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.runtime.kind, 'rpc');
  assert.ok(stats.body.runtime.pid, 'child pid is reported');

  const closed = await post(`/api/sessions/${id}/close`, {});
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.success, true);
  // /close responds only after the child exited, so no pruning race here.
  assert.equal(await findActive(id), null, 'closed session left the active list');
});

test('a pi that dies on startup surfaces as a 500, not a hang', async () => {
  const saved = process.env.PI_DISH_PI_COMMAND;
  process.env.PI_DISH_PI_COMMAND = `env PI_FIXTURE_EXIT_ON_START=1 ${process.execPath} ${FIXTURE}`;
  try {
    const { status, body } = await post('/api/sessions/new', {});
    assert.equal(status, 500);
    assert.match(body.error, /exited during startup/);
  } finally {
    process.env.PI_DISH_PI_COMMAND = saved;
  }
});
