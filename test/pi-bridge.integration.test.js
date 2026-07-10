/**
 * Real-pi integration test: spawns the actual `pi` binary (skipped when not
 * installed) with the real pi-dish-bridge extension from this repo, in a temp
 * HOME whose models.json points pi at a fake Anthropic /v1/messages server —
 * so real agent turns run without touching a real API.
 *
 * This is the pi-upgrade canary. Every other suite fakes the bridge side of
 * the socket; this one exercises the seams that live *inside* pi and break
 * silently on pi version bumps:
 *   - bridge registration (registry entry + socket) from a real session_start
 *   - prompt → real agent turn → bridge event forwarding → SSE → JSONL
 *   - queue_update via the AgentSession prototype-capture patch
 *   - cancel_queued splicing pi's private queue arrays
 *   - navigate_tree through a stashed command context (/dish-prime via RPC)
 *
 * Run with: npm test  (≈15s; set PI_DISH_SKIP_INTEGRATION=1 to skip)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const { sseReader } = require('./sse-reader');

let piOk = !process.env.PI_DISH_SKIP_INTEGRATION;
try { execFileSync('pi', ['--version'], { stdio: 'ignore', timeout: 15000 }); } catch { piOk = false; }

// Short temp dir — the bridge's Unix socket path must stay under ~108 chars.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-int-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';

// --- fake Anthropic endpoint -------------------------------------------------
// Streams a scripted reply for each /v1/messages request. A user message
// containing HOLD keeps the stream open until releaseHold() — that's how tests
// pin a turn in progress to exercise the steering queue.
let holdRelease = null;
let holdArrived = null; // resolves when a HOLD request is being served
const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const llm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    if (!/\/messages/.test(req.url)) { res.writeHead(404); return res.end(); }
    let userText = '';
    try {
      const parsed = JSON.parse(body);
      const lastUser = [...parsed.messages].reverse().find((m) => m.role === 'user');
      const content = lastUser?.content;
      userText = typeof content === 'string'
        ? content
        : (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    } catch {}

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    sse(res, 'message_start', { type: 'message_start', message: {
      id: 'msg_fake', type: 'message', role: 'assistant', content: [], model: 'fake-model',
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 },
    } });
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'echo: ' } });

    if (/HOLD/.test(userText)) {
      await new Promise((r) => {
        holdRelease = r;
        if (holdArrived) { holdArrived(); holdArrived = null; }
      });
      holdRelease = null;
    }

    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: userText } });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    sse(res, 'message_stop', { type: 'message_stop' });
    res.end();
  });
});

// --- temp HOME: models.json + the real bridge extension ----------------------
const agentDir = path.join(tmpHome, '.pi', 'agent');
const extDir = path.join(agentDir, 'extensions');
fs.mkdirSync(extDir, { recursive: true });
fs.symlinkSync(path.join(__dirname, '..', 'extensions', 'pi-dish-bridge'), path.join(extDir, 'pi-dish-bridge'));

const projDir = path.join(tmpHome, 'proj');
fs.mkdirSync(projDir, { recursive: true });

const server = require('../server.js');

let base;
let pi; // the spawned real-pi child
let piStdout = []; // parsed RPC JSONL lines from pi's stdout
let piStderr = '';
let sessionId;

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// Send an RPC command on the real pi's stdin and await its response — the
// same channel server.js uses to prime RPC-backed sessions.
let rpcSeq = 0;
function piRpc(type, params = {}, timeout = 30000) {
  const id = `int-${++rpcSeq}`;
  pi.stdin.write(JSON.stringify({ id, type, ...params }) + '\n');
  return waitFor(() => piStdout.find((m) => m.type === 'response' && m.id === id), timeout, `response to ${type}`);
}

async function waitFor(fn, timeout = 10000, label = 'condition') {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}\npi stderr:\n${piStderr}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test.before(async () => {
  if (!piOk) return;
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  await new Promise((r) => llm.listen(0, '127.0.0.1', r));
  fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      fakeprov: {
        name: 'Fake Provider',
        baseUrl: `http://127.0.0.1:${llm.address().port}`,
        apiKey: 'test-key',
        api: 'anthropic-messages',
        models: [{ id: 'fake-model', name: 'Fake Model', contextWindow: 200000, maxTokens: 8192 }],
      },
    },
  }, null, 2));

  pi = spawn('pi', ['--mode', 'rpc', '--model', 'fakeprov/fake-model'], {
    cwd: projDir,
    env: { ...process.env, HOME: tmpHome },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  pi.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try { piStdout.push(JSON.parse(line)); } catch {}
    }
  });
  pi.stderr.on('data', (c) => { piStderr += c.toString(); });
  pi.on('error', () => { piOk = false; });
}, { timeout: 60000 });

test.after(async () => {
  if (pi && pi.exitCode === null) {
    pi.kill('SIGTERM');
    await new Promise((r) => { pi.on('exit', r); setTimeout(r, 3000); });
    if (pi.exitCode === null) pi.kill('SIGKILL');
  }
  llm.close();
  server.close();
});

test('the real bridge registers the session and pi-dish lists it', { skip: !piOk, timeout: 60000 }, async () => {
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  const entry = await waitFor(() => {
    try {
      for (const f of fs.readdirSync(registryDir)) {
        if (!f.endsWith('.json')) continue;
        const reg = JSON.parse(fs.readFileSync(path.join(registryDir, f), 'utf8'));
        if (reg.socketPath && fs.existsSync(reg.socketPath)) return reg;
      }
    } catch {}
    return null;
  }, 30000, 'bridge registry entry (is the bridge extension loading in this pi version?)');

  sessionId = entry.sessionId;
  assert.ok(sessionId, 'registry entry carries the session id');
  assert.equal(entry.pid, pi.pid, 'entry belongs to the pi we spawned');

  const sess = await waitFor(async () => {
    const { body } = await get('/api/sessions?active=1');
    return body.active.find((s) => s.id === sessionId);
  }, 10000, 'session in the active list');
  assert.equal(sess.model, 'fakeprov/fake-model', 'model comes from the bridge state');
});

test('prompt round-trip: real agent turn → bridge events → SSE → JSONL', { skip: !piOk, timeout: 60000 }, async () => {
  const stream = sseReader(`${base}/api/sessions/${sessionId}/stream`);
  try {
    await stream.waitFor((e) => e.event === 'init');
    const { status, body } = await post(`/api/sessions/${sessionId}/prompt`, { message: 'hello integration' });
    assert.equal(status, 200, JSON.stringify(body));

    await stream.waitFor((e) => e.event === 'turn_start', 20000);
    const end = await stream.waitFor((e) => e.event === 'message_end' && e.data?.message?.role === 'assistant', 20000);
    const text = end.data.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    assert.equal(text, 'echo: hello integration', 'the fake LLM reply came back through the bridge');
    await stream.waitFor((e) => e.event === 'turn_end', 20000);

    // The turn was persisted by real pi — the JSONL reader sees both sides.
    const { body: msgs } = await get(`/api/sessions/${sessionId}/messages`);
    const texts = msgs.messages.map((m) => (Array.isArray(m.content) ? m.content : [])
      .filter((b) => b.type === 'text').map((b) => b.text).join(''));
    assert.ok(texts.includes('hello integration'), 'user message persisted');
    assert.ok(texts.includes('echo: hello integration'), 'assistant reply persisted');
  } finally {
    stream.close();
  }
});

test('steering queue: queue_update fires and cancel_queued splices pi internals', { skip: !piOk, timeout: 60000 }, async () => {
  const stream = sseReader(`${base}/api/sessions/${sessionId}/stream`);
  try {
    await stream.waitFor((e) => e.event === 'init');

    // Pin a turn open at the fake LLM, then queue a steer behind it.
    const held = new Promise((r) => { holdArrived = r; });
    await post(`/api/sessions/${sessionId}/prompt`, { message: 'HOLD this turn' });
    await stream.waitFor((e) => e.event === 'turn_start', 20000);
    await held;

    const queued = await post(`/api/sessions/${sessionId}/prompt`, { message: 'queued steer text' });
    assert.equal(queued.status, 200);

    // queue_update reaches us only through the bridge's AgentSession
    // prototype-capture patch — this is the pi-upgrade canary.
    const update = await stream.waitFor(
      (e) => e.event === 'queue_update' && (e.data?.steering || []).includes('queued steer text'), 15000);
    assert.ok(update, 'queue_update observed via the AgentSession capture');

    // cancel_queued splices pi's private queue arrays (version-sensitive).
    const cancel = await post(`/api/sessions/${sessionId}/queue/cancel`,
      { kind: 'steering', index: 0, text: 'queued steer text' });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    await stream.waitFor(
      (e) => e.event === 'queue_update' && !(e.data?.steering || []).includes('queued steer text'), 15000);

    holdRelease();
    await stream.waitFor((e) => e.event === 'turn_end', 20000);

    // The cancelled steer must never have been delivered to the model.
    const { body: msgs } = await get(`/api/sessions/${sessionId}/messages`);
    const texts = msgs.messages.map((m) => (Array.isArray(m.content) ? m.content : [])
      .filter((b) => b.type === 'text').map((b) => b.text).join(''));
    assert.ok(!texts.includes('queued steer text'), 'cancelled steer stayed out of the transcript');
  } finally {
    stream.close();
    if (holdRelease) holdRelease();
  }
});

test('navigate_tree: 409 without a command context, works after /dish-prime', { skip: !piOk, timeout: 60000 }, async () => {
  const { body: tree } = await get(`/api/sessions/${sessionId}/tree`);
  const target = (tree.nodes || []).find((n) =>
    n.type === 'message' && n.role === 'user' && n.text === 'hello integration');
  assert.ok(target?.id, 'found the first prompt in the tree');

  // No command context stashed yet, no spawn pane to prime through → 409
  // with the actionable hint.
  const blocked = await post(`/api/sessions/${sessionId}/branch`, { entryId: target.id });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.match(blocked.body.error, /dish-push/);

  // Prime the command context the same way the server primes RPC sessions:
  // a slash command through pi's own executor stashes its ctx in the bridge.
  const primed = await piRpc('prompt', { message: '/dish-prime' });
  assert.equal(primed.success, true, JSON.stringify(primed));

  const branched = await post(`/api/sessions/${sessionId}/branch`, { entryId: target.id });
  assert.equal(branched.status, 200, JSON.stringify(branched.body));
  assert.equal(branched.body.editorText, 'hello integration', 'user-message target returns its text for re-edit');
});
