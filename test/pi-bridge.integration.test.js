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
 *   - navigate_tree through a self-primed command context (the bridge runs
 *     its /dish-prime via the captured AgentSession's prompt())
 *   - version skew: the bundled SDK (lib/pi-sdk.js — share export, branch
 *     summaries, model registry) must match the host pi that writes the
 *     session files; `npm test` goes red when the host upgrades past it
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

// Deliberately long HOME: the default bridge socket path exceeds the
// conservative cross-platform sun_path limit. The explicit short override
// must let the real extension load and bind successfully.
// HOME must be set before resolving the pi launch spec so the alias lookup
// reads the (empty) temp HOME, not the developer's rc files.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-int-'));
const tmpHome = path.join(tmpRoot, `long-home-${'x'.repeat(90)}`);
const socketDir = path.join(tmpRoot, 's');
fs.mkdirSync(tmpHome, { recursive: true });
// Existing private overrides are valid and must not be mutated by bridge init.
fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
process.env.HOME = tmpHome;
process.env.PORT = '0';
process.env.PI_DISH_SOCKET_DIR = socketDir;
const QUEUE_IMAGE_A = {
  mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
};
const QUEUE_IMAGE_B = {
  mimeType: 'image/gif',
  data: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
};

// Resolve the HOST pi like the server does. A bare `pi` here would hit
// node_modules/.bin first (npm prepends it under `npm test`), silently
// canary-ing the bundled — usually older — copy instead of the host.
const { getPiLaunchSpec } = require('../lib/rpc-session.js');
const piSpec = getPiLaunchSpec();
const piEnv = { ...process.env, ...piSpec.env };

let piOk = !process.env.PI_DISH_SKIP_INTEGRATION;
let hostPiVersion = null;
try {
  const out = execFileSync(piSpec.argv[0], [...piSpec.argv.slice(1), '--version'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, env: piEnv });
  hostPiVersion = (out.match(/\d+\.\d+\.\d+\S*/g) || []).pop() || null;
} catch { piOk = false; }

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

// Marker extension: appends a line on every evaluation, so the /reload test
// can prove extensions really re-evaluated (not just that the command 200'd).
const loadLog = path.join(tmpHome, 'ext-loads.log');
fs.mkdirSync(path.join(extDir, 'load-marker'), { recursive: true });
fs.writeFileSync(path.join(extDir, 'load-marker', 'index.ts'), [
  'import * as fs from "node:fs";',
  `export default function () { fs.appendFileSync(${JSON.stringify(loadLog)}, Date.now() + "\\n"); }`,
  '',
].join('\n'));
const extLoadCount = () => {
  try { return fs.readFileSync(loadLog, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
};

const server = require('../server.js');
const { getBridgeSession } = require('../lib/bridge-session');
const { processIdentity } = require('../lib/process-identity');

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

  // A tiny keep-recent window so the compaction test can compact the small
  // test session (the default 20k keeps everything and pi refuses with
  // "Nothing to compact"). Auto-compaction still never triggers: its
  // threshold is context-window-relative and this session stays tiny.
  fs.writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify({
    compaction: { keepRecentTokens: 1 },
  }, null, 2));

  pi = spawn(piSpec.argv[0], [...piSpec.argv.slice(1), '--mode', 'rpc', '--model', 'fakeprov/fake-model'], {
    cwd: projDir,
    env: { ...piEnv, HOME: tmpHome },
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
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('bundled pi SDK version matches the host pi', { skip: !piOk }, () => {
  const bundled = require('../node_modules/@earendil-works/pi-coding-agent/package.json').version;
  assert.ok(hostPiVersion, 'could not parse a version from host pi --version output');
  assert.equal(bundled, hostPiVersion,
    `bundled pi SDK ${bundled} != host pi ${hostPiVersion} — lib/pi-sdk.js runs against the bundled copy `
    + `while sessions run the host, so share export / branch summaries drift from the session files. `
    + `Run: npm i @earendil-works/pi-coding-agent@${hostPiVersion} (or upgrade host pi), then re-run this canary.`);
});

async function bridgeConfigFailure(socketOverride) {
  const env = { ...piEnv, HOME: tmpHome };
  if (socketOverride === null) delete env.PI_DISH_SOCKET_DIR;
  else env.PI_DISH_SOCKET_DIR = socketOverride;
  const child = spawn(piSpec.argv[0], [...piSpec.argv.slice(1), '--mode', 'rpc', '--model', 'fakeprov/fake-model'], {
    cwd: projDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdout.resume();
  try {
    const deadline = Date.now() + 10000;
    while (!/PI_DISH_SOCKET_DIR/.test(stderr) && child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
    let childRegistered = false;
    try {
      childRegistered = fs.readdirSync(registryDir).some((name) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(registryDir, name), 'utf8')).pid === child.pid;
        } catch {
          return false;
        }
      });
    } catch {}
    return { stderr, childRegistered };
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

test('a long HOME without PI_DISH_SOCKET_DIR fails bridge startup with an actionable error', { skip: !piOk, timeout: 30000 }, async () => {
  const { stderr, childRegistered } = await bridgeConfigFailure(null);
  assert.match(stderr, /Unix socket path is \d+ bytes \(maximum 103\)/,
    `bridge should report the byte limit, got stderr:\n${stderr}`);
  assert.match(stderr, /Set PI_DISH_SOCKET_DIR to a short absolute directory/);
  assert.equal(childRegistered, false, 'over-limit bridge never writes a registry entry');
});

test('an existing shared PI_DISH_SOCKET_DIR is rejected without permission mutation', { skip: !piOk, timeout: 30000 }, async () => {
  const unsafeDir = path.join(tmpRoot, 'shared-socket-dir');
  fs.mkdirSync(unsafeDir, { recursive: true, mode: 0o755 });
  fs.chmodSync(unsafeDir, 0o755);
  const { stderr, childRegistered } = await bridgeConfigFailure(unsafeDir);
  assert.match(stderr, /PI_DISH_SOCKET_DIR is not a private usable directory/);
  assert.match(stderr, /mode is 0755, expected 0700/);
  assert.equal(childRegistered, false, 'unsafe override never writes a registry entry');
  assert.equal(fs.statSync(unsafeDir).mode & 0o777, 0o755,
    'bridge did not mutate the existing directory mode');
});

test('the real bridge migrates its owned default socket directory from 0755 to 0700', { skip: !piOk, timeout: 30000 }, async () => {
  const migrationHome = path.join(tmpRoot, 'migration-home');
  const migrationAgentDir = path.join(migrationHome, '.pi', 'agent');
  const migrationExtDir = path.join(migrationAgentDir, 'extensions');
  const migrationProject = path.join(migrationHome, 'proj');
  const migrationSocketDir = path.join(migrationHome, '.pi', 'dish', 'sockets');
  fs.mkdirSync(migrationExtDir, { recursive: true });
  fs.mkdirSync(migrationProject, { recursive: true });
  fs.symlinkSync(
    path.join(__dirname, '..', 'extensions', 'pi-dish-bridge'),
    path.join(migrationExtDir, 'pi-dish-bridge'),
  );
  fs.copyFileSync(path.join(agentDir, 'models.json'), path.join(migrationAgentDir, 'models.json'));
  fs.mkdirSync(migrationSocketDir, { recursive: true });
  fs.chmodSync(migrationSocketDir, 0o755);

  const env = { ...piEnv, HOME: migrationHome };
  delete env.PI_DISH_SOCKET_DIR;
  const child = spawn(piSpec.argv[0], [...piSpec.argv.slice(1), '--mode', 'rpc', '--model', 'fakeprov/fake-model'], {
    cwd: migrationProject,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdout.resume();
  try {
    const registryDir = path.join(migrationHome, '.pi', 'dish', 'sessions');
    const deadline = Date.now() + 10000;
    let entry = null;
    while (!entry && child.exitCode === null && Date.now() < deadline) {
      try {
        for (const name of fs.readdirSync(registryDir)) {
          const candidate = JSON.parse(fs.readFileSync(path.join(registryDir, name), 'utf8'));
          if (candidate.pid === child.pid && fs.existsSync(candidate.socketPath)) {
            entry = candidate;
            break;
          }
        }
      } catch {}
      if (!entry) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(entry, `bridge did not bind/register after default migration; stderr:\n${stderr}`);
    assert.equal(fs.statSync(migrationSocketDir).mode & 0o777, 0o700,
      'bridge tightened the self-owned default directory');
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

test('the real bridge binds under a long HOME using PI_DISH_SOCKET_DIR and registers', { skip: !piOk, timeout: 60000 }, async () => {
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
  assert.equal(entry.startTime, processIdentity(pi.pid)?.startTime,
    'registry entry carries the pi process birth marker');
  // This is an actual successful bind from a HOME whose default full path is
  // too long, not merely an assertion about basename length.
  const defaultPath = path.join(tmpHome, '.pi', 'dish', 'sockets', path.basename(entry.socketPath));
  assert.ok(Buffer.byteLength(defaultPath) > 103, `test HOME must exceed sun_path limit (got ${defaultPath})`);
  assert.equal(path.resolve(path.dirname(entry.socketPath)), path.resolve(socketDir));
  assert.ok(fs.statSync(entry.socketPath).isSocket(), 'override contains the live Unix socket');
  assert.equal(fs.statSync(socketDir).mode & 0o777, 0o700, 'socket directory is private');

  // The socket file remains named by a fixed-length hash, not the session id.
  // 30 chars covers the hash plus ".sock" with slack.
  assert.ok(path.basename(entry.socketPath).length <= 30,
    `socket basename must be hash-sized, got ${path.basename(entry.socketPath)}`);
  assert.ok(!path.basename(entry.socketPath).includes(sessionId),
    'socket path must not embed the literal session id');

  const bridge = await getBridgeSession(sessionId);
  const hello = await bridge.waitForHello();
  assert.equal(hello.pid, pi.pid, 'bridge hello identifies the pi process');
  assert.equal(hello.startTime, entry.startTime, 'bridge hello proves the registry birth marker');

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

test('steering queue cancellation preserves duplicate index and image identity', { skip: !piOk, timeout: 60000 }, async () => {
  const stream = sseReader(`${base}/api/sessions/${sessionId}/stream`);
  try {
    await stream.waitFor((e) => e.event === 'init');

    // Pin a turn open at the fake LLM, then queue a steer behind it.
    const held = new Promise((r) => { holdArrived = r; });
    await post(`/api/sessions/${sessionId}/prompt`, { message: 'HOLD this turn' });
    await stream.waitFor((e) => e.event === 'turn_start', 20000);
    await held;

    for (const body of [
      { message: 'duplicate queued steer', images: [QUEUE_IMAGE_A] },
      { message: 'other queued steer' },
      { message: 'duplicate queued steer', images: [QUEUE_IMAGE_B] },
    ]) {
      const queued = await post(`/api/sessions/${sessionId}/prompt`, body);
      assert.equal(queued.status, 200, JSON.stringify(queued.body));
    }

    // queue_update reaches us only through the bridge's AgentSession
    // prototype-capture patch — this is the pi-upgrade canary.
    const update = await stream.waitFor(
      (e) => e.event === 'queue_update' && JSON.stringify(e.data?.steering) ===
        JSON.stringify(['duplicate queued steer', 'other queued steer', 'duplicate queued steer']), 15000);
    assert.ok(update, 'queue_update observed via the AgentSession capture');

    // Cancel the second duplicate. The text-only AgentSession mirror and the
    // agent core's full-content queue must both remove index 2, not the first
    // text match (which carries a distinguishable PNG attachment).
    const cancel = await post(`/api/sessions/${sessionId}/queue/cancel`,
      { kind: 'steering', index: 2, text: 'duplicate queued steer' });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    await stream.waitFor(
      (e) => e.event === 'queue_update' && JSON.stringify(e.data?.steering) ===
        JSON.stringify(['duplicate queued steer', 'other queued steer']), 15000);

    holdRelease();
    await stream.waitFor((e) => e.event === 'agent_end', 20000);

    // Exact queue order and image identity survive delivery: the first
    // duplicate (PNG) remains, while the selected second duplicate (GIF) is
    // absent. Removing the core queue's first text match reverses this order
    // and delivers the GIF, so both regressions are pinned here.
    const { body: msgs } = await get(`/api/sessions/${sessionId}/messages`);
    const queuedUsers = msgs.messages.filter((m) => m.role === 'user').map((m) => ({
      message: m,
      text: (Array.isArray(m.content) ? m.content : [])
        .filter((b) => b.type === 'text').map((b) => b.text).join(''),
    })).filter(({ text }) => text === 'duplicate queued steer' || text === 'other queued steer');
    assert.deepEqual(queuedUsers.map(({ text }) => text), ['duplicate queued steer', 'other queued steer']);
    const image = queuedUsers[0].message.content.find((b) => b.type === 'image');
    assert.equal(image?.mimeType, QUEUE_IMAGE_A.mimeType, 'the uncancelled duplicate kept its image metadata');
    const imageResponse = await fetch(base + image.url);
    assert.equal(imageResponse.status, 200);
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from(QUEUE_IMAGE_A.data, 'base64'));
  } finally {
    stream.close();
    if (holdRelease) holdRelease();
  }
});

test('navigate_tree: self-primes a command context via the captured AgentSession', { skip: !piOk, timeout: 60000 }, async () => {
  const { body: tree } = await get(`/api/sessions/${sessionId}/tree`);
  const target = (tree.nodes || []).find((n) =>
    n.type === 'message' && n.role === 'user' && n.text === 'hello integration');
  assert.ok(target?.id, 'found the first prompt in the tree');

  // No command context has been stashed (no /dish-* command ran) and this pi
  // isn't a server-spawned child, so no external prime path exists. The
  // bridge must acquire the ctx itself: its /dish-prime through the captured
  // AgentSession's prompt() — the version-sensitive seam this canary pins.
  const stream = sseReader(`${base}/api/sessions/${sessionId}/stream`);
  try {
    await stream.waitFor((e) => e.event === 'init');
    const branched = await post(`/api/sessions/${sessionId}/branch`, { entryId: target.id });
    assert.equal(branched.status, 200, JSON.stringify(branched.body));
    assert.equal(branched.body.editorText, 'hello integration', 'user-message target returns its text for re-edit');

    // The bridge broadcasts session_tree so open clients re-render the
    // transcript (also covers /tree typed into the TUI).
    await stream.waitFor((e) => e.event === 'session_tree', 15000);
  } finally {
    stream.close();
  }

  // A no-summary navigation persists nothing by itself (pi's branch() only
  // moves an in-memory pointer) — the bridge must anchor the new leaf on
  // disk, so the tree and the transcript reflect it immediately, not after
  // the next turn.
  const { body: after } = await get(`/api/sessions/${sessionId}/tree`);
  assert.ok(!new Set(after.activePathIds).has(target.id),
    'the branched-away turn left the active path without another append');
  const { body: msgs } = await get(`/api/sessions/${sessionId}/messages`);
  const texts = msgs.messages.map((m) => (Array.isArray(m.content) ? m.content : [])
    .filter((b) => b.type === 'text').map((b) => b.text).join(''));
  assert.ok(!texts.some((t) => t.includes('hello integration')),
    'the abandoned branch no longer renders in the transcript');
});

// The compaction gate, against real pi: a /compact issued while a compaction
// runs used to race pi's message rewrite and corrupt the session. The
// summarization request goes to the fake LLM like any turn, so HOLD in the
// custom instructions pins the compaction open; the events observed here come
// through the bridge's AgentSession subscription (compaction_start/_end are
// internal AgentSession events — another version-sensitive seam this pins).
test('compaction: second /compact refused, prompts queue until compaction ends', { skip: !piOk, timeout: 60000 }, async () => {
  const stream = sseReader(`${base}/api/sessions/${sessionId}/stream`);
  try {
    await stream.waitFor((e) => e.event === 'init');

    // navigate_tree just cut the active branch back to the root — rebuild
    // some history so prepareCompaction has something to summarize.
    for (const m of ['compaction filler one', 'compaction filler two']) {
      await post(`/api/sessions/${sessionId}/prompt`, { message: m });
      await stream.waitFor((e) => e.event === 'turn_end', 20000);
    }

    const held = new Promise((r) => { holdArrived = r; });
    const first = await post(`/api/sessions/${sessionId}/command`, { message: '/compact HOLD the essentials' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    await stream.waitFor((e) => e.event === 'compaction_start', 15000);
    await held;

    // The gate: a concurrent /compact is refused with a clear error.
    const second = await post(`/api/sessions/${sessionId}/command`, { message: '/compact' });
    assert.equal(second.status, 400, JSON.stringify(second.body));
    assert.match(second.body.error || '', /already in progress/i);

    // Prompts sent mid-compaction are held by the bridge and reported queued.
    // Cancel index 2 from duplicate/other/duplicate: compactionQueue must use
    // the selected merged-row index rather than its first matching text.
    for (const message of ['compaction duplicate', 'compaction other', 'compaction duplicate']) {
      const queued = await post(`/api/sessions/${sessionId}/prompt`, { message });
      assert.equal(queued.status, 200);
      assert.equal(queued.body.result?.queued, true, JSON.stringify(queued.body));
    }
    await stream.waitFor((e) => e.event === 'queue_update' &&
      JSON.stringify(e.data?.followUp) === JSON.stringify([
        'compaction duplicate', 'compaction other', 'compaction duplicate',
      ]), 15000);
    const cancelled = await post(`/api/sessions/${sessionId}/queue/cancel`, {
      kind: 'followUp', index: 2, text: 'compaction duplicate',
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    await stream.waitFor((e) => e.event === 'queue_update' &&
      JSON.stringify(e.data?.followUp) === JSON.stringify(['compaction duplicate', 'compaction other']), 15000);
    // Leave one buffered row to flush. The extension send API is deliberately
    // fire-and-forget, so testing two-row delivery here would exercise an
    // unrelated send-scheduling race rather than cancellation identity.
    const cancelledOther = await post(`/api/sessions/${sessionId}/queue/cancel`, {
      kind: 'followUp', index: 1, text: 'compaction other',
    });
    assert.equal(cancelledOther.status, 200, JSON.stringify(cancelledOther.body));

    holdRelease();
    const end = await stream.waitFor((e) => e.event === 'compaction_end', 20000);
    assert.ok(!end.data?.errorMessage, `compaction failed: ${JSON.stringify(end.data)}`);

    // Gate released: the first duplicate remains and flushes as a real turn.
    const msgs = await waitFor(async () => {
      const { body } = await get(`/api/sessions/${sessionId}/messages`);
      const texts = body.messages.filter((m) => m.role === 'user').map((m) =>
        (Array.isArray(m.content) ? m.content : []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
      return texts.includes('compaction duplicate') ? body : null;
    }, 20000, 'compaction queue flush');
    const texts = msgs.messages.map((m) => (Array.isArray(m.content) ? m.content : [])
      .filter((b) => b.type === 'text').map((b) => b.text).join(''));
    assert.deepEqual(texts.filter((text) => text === 'compaction duplicate' || text === 'compaction other'),
      ['compaction duplicate']);
    const { body: tree } = await get(`/api/sessions/${sessionId}/tree`);
    assert.ok((tree.nodes || []).some((n) => n.type === 'compaction'),
      'compaction entry persisted to the JSONL');
  } finally {
    stream.close();
    if (holdRelease) holdRelease();
  }
});

// Last on purpose: reload tears the bridge down and re-registers it.
test('/reload from the API: responds ok, re-evaluates extensions, session stays usable', { skip: !piOk, timeout: 60000 }, async () => {
  const before = extLoadCount();
  assert.ok(before > 0, 'marker extension loaded at startup');

  // The bridge must answer run_command *before* its own reload teardown —
  // fired in the same tick, the socket dies first and this comes back 400
  // "socket closed" for a reload that actually ran.
  const rel = await post(`/api/sessions/${sessionId}/command`, { message: '/reload' });
  assert.equal(rel.status, 200, JSON.stringify(rel.body));

  await waitFor(() => extLoadCount() > before, 15000, 'extension re-evaluation after /reload');

  // The re-loaded bridge re-registers the same session and it keeps working.
  await waitFor(async () => {
    const { body } = await get('/api/sessions?active=1');
    return body.active.some((s) => s.id === sessionId);
  }, 15000, 'session active again after reload');
  const p = await post(`/api/sessions/${sessionId}/prompt`, { message: 'after reload' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  await waitFor(async () => {
    const { body } = await get(`/api/sessions/${sessionId}/messages`);
    return body.messages?.some((m) => JSON.stringify(m.content || '').includes('echo: after reload'));
  }, 20000, 'post-reload turn persisted');
});
