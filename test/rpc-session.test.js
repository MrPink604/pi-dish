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
process.env.PI_DISH_PI_COMMAND = `env PI_FIXTURE_LOG=${CMD_LOG} ${process.execPath} ${FIXTURE}`;

const server = require('../server.js');
const { getAllRPCSessions } = require('../lib/rpc-session');

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
  const { status, body } = await post('/api/sessions/new', {});
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.id, 'a session id is returned');
  sessionId = body.id;

  const sess = await findActive(sessionId);
  assert.ok(sess, 'spawned session is in the active list');
  assert.equal(sess.isActive, true);
  assert.equal(sess.model, 'test/fake-model', 'model comes from get_state');
  assert.equal(sess.turnInProgress, false);
  assert.ok(sess.pid, 'the child pid is reported');

  // The fixture created a real session JSONL — the message reader sees it.
  const messages = await get(`/api/sessions/${sessionId}/messages`);
  assert.equal(messages.status, 200);
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
