/**
 * Tests for lib/terminal.js (PTY pool) and the WebSocket terminal endpoint.
 *
 * PI_DISH_TERMINAL=1 and a temp HOME are set before server.js loads so the
 * upgrade handler is registered and session discovery reads fixtures. Each
 * node:test file runs in its own process, so this doesn't leak into
 * server.test.js (which asserts the flag-off default).
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-term-test-'));
process.env.HOME = tmpHome;
// The mode=tmux tests run a throwaway tmux server in here; pinning the tmpdir
// also keeps pid-walk fallbacks away from the developer's real tmux.
const tmuxTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-tt-'));
process.env.TMUX_TMPDIR = tmuxTmp;
// A configless HOME makes zsh launch its zsh-newuser-install wizard, which
// swallows the first line of input — give it an empty rc file instead.
fs.writeFileSync(path.join(tmpHome, '.zshrc'), '');
process.env.PORT = '0';
process.env.PI_DISH_TERMINAL = '1';

// Fixture session whose cwd is a real directory the PTY should start in.
const SESSION_ID = '2026-07-07T10-00-00-term1234';
const sessionCwd = path.join(tmpHome, 'workspace', 'term-proj');
fs.mkdirSync(sessionCwd, { recursive: true });
const sessionDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--term-proj--');
fs.mkdirSync(sessionDir, { recursive: true });
fs.writeFileSync(
  path.join(sessionDir, `${SESSION_ID}.jsonl`),
  [
    { type: 'session', cwd: sessionCwd, timestamp: '2026-07-07T10:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: '2026-07-07T10:00:01.000Z' } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n',
);

const terminal = require('../lib/terminal');
const server = require('../server.js');

let base, wsBase;
test.before(async () => {
  if (!server.listening) await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  wsBase = `ws://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  terminal.killAllTerminals();
  server.close();
});

// A stand-in for a ws connection, good enough for lib-level tests:
// attachClient only uses send/on/readyState.
class FakeWS extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.sent = []; }
  send(payload) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = 3; this.emit('close'); }
  messages(type) { return this.sent.filter(m => m.type === type); }
  input(data) { this.emit('message', JSON.stringify({ type: 'input', data })); }
}

const until = async (fn, ms = 5000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise(r => setTimeout(r, 20));
  }
};

test('terminal is available (node-pty loaded)', () => {
  assert.equal(terminal.isTerminalAvailable(), true);
  assert.equal(terminal.isTerminalEnabled(), true);
});

test('attachClient spawns a shell in the given cwd and round-trips input/output', async () => {
  const ws = new FakeWS();
  terminal.attachClient('lib-echo', sessionCwd, ws);
  assert.equal(ws.messages('attach').length, 1);

  ws.input('pwd; echo done-$((20+22))\r');
  await until(() => ws.sent.some(m => m.type === 'output' && m.data.includes('done-42')));
  const out = ws.messages('output').map(m => m.data).join('');
  assert.ok(out.includes(sessionCwd), `pwd output should contain ${sessionCwd}`);
  terminal.killTerminal('lib-echo');
});

test('attachClient with a command argv runs it, applies the env overlay, and stamps meta on attach', async () => {
  process.env.PD_TEST_GONE = 'must-not-leak';
  const ws = new FakeWS();
  terminal.attachClient('lib-cmd', sessionCwd, ws, {
    command: [process.execPath, '-e',
      'console.log("cmd-out-" + (40+3), process.env.PD_TEST_EXTRA, "stripped:" + (process.env.PD_TEST_GONE === undefined))'],
    env: { PD_TEST_EXTRA: 'extra-ok', PD_TEST_GONE: undefined },
    meta: { tmuxPrefix: 'C-b' },
  });
  const attach = ws.messages('attach')[0];
  assert.equal(attach.tmuxPrefix, 'C-b', 'meta fields ride on the attach frame');

  await until(() => ws.sent.some(m => m.type === 'output' && m.data.includes('cmd-out-43')));
  const out = ws.messages('output').map(m => m.data).join('');
  assert.ok(out.includes('extra-ok'), 'env overlay is visible to the command');
  assert.ok(out.includes('stripped:true'), 'undefined overlay keys are removed from the env');
  delete process.env.PD_TEST_GONE;
  terminal.killTerminal('lib-cmd');
});

test('reattach replays buffered output after the first client drops', async () => {
  const ws1 = new FakeWS();
  terminal.attachClient('lib-replay', sessionCwd, ws1, { idleKillMs: 60_000 });
  ws1.input('echo marker-replay-123\r');
  await until(() => ws1.sent.some(m => m.type === 'output' && m.data.includes('marker-replay-123')));
  ws1.close();

  const ws2 = new FakeWS();
  terminal.attachClient('lib-replay', sessionCwd, ws2);
  const attach = ws2.messages('attach')[0];
  assert.ok(attach.replay.includes('marker-replay-123'), 'replay buffer should contain earlier output');
  terminal.killTerminal('lib-replay');
});

test('ring buffer trims to bufferMax', async () => {
  const ws = new FakeWS();
  terminal.attachClient('lib-ring', sessionCwd, ws, { bufferMax: 1000 });
  ws.input('for i in $(seq 1 200); do echo ring-line-$i; done\r');
  await until(() => ws.sent.some(m => m.type === 'output' && m.data.includes('ring-line-200')));
  const term = terminal._terminals.get('lib-ring');
  assert.ok(term.buffer.length <= 1000, `buffer ${term.buffer.length} should be <= 1000`);
  assert.ok(term.buffer.includes('ring-line-200'), 'newest output survives the trim');
  assert.ok(!term.buffer.includes('ring-line-1\r'), 'oldest output is trimmed');
  terminal.killTerminal('lib-ring');
});

test('PTY is killed after sitting client-less past idleKillMs', async () => {
  const ws = new FakeWS();
  terminal.attachClient('lib-idle', sessionCwd, ws, { idleKillMs: 100 });
  assert.ok(terminal._terminals.has('lib-idle'));
  ws.close();
  await until(() => !terminal._terminals.has('lib-idle'), 3000);
});

test('reattaching within the idle window cancels the pending kill', async () => {
  const ws1 = new FakeWS();
  terminal.attachClient('lib-cancel', sessionCwd, ws1, { idleKillMs: 200 });
  ws1.close();
  const ws2 = new FakeWS();
  terminal.attachClient('lib-cancel', sessionCwd, ws2);
  await new Promise(r => setTimeout(r, 400));
  assert.ok(terminal._terminals.has('lib-cancel'), 'reattach should cancel the idle kill');
  terminal.killTerminal('lib-cancel');
});

test('idle kill defers while a detached shell is still producing output', async () => {
  const ws = new FakeWS();
  terminal.attachClient('lib-busy', sessionCwd, ws, { idleKillMs: 500 });
  // ~1.5s of output at a cadence (50ms) far inside idleKillMs — with only a
  // 3x margin, one slow loop iteration under parallel-suite load opened a
  // false idle window and killed the shell mid-assertion (flaked under load).
  ws.input('for i in $(seq 1 30); do echo busy-$i; sleep 0.05; done\r');
  await until(() => ws.sent.some(m => m.type === 'output' && m.data.includes('busy-1')));
  ws.close();

  await new Promise(r => setTimeout(r, 1000)); // idleKillMs would have fired twice
  assert.ok(terminal._terminals.has('lib-busy'), 'still alive while output continues');

  const term = terminal._terminals.get('lib-busy');
  await until(() => Date.now() - term.lastOutputAt > 550, 5000); // loop finished + silence window
  await until(() => !terminal._terminals.has('lib-busy'), 3000);
});

test('restart frame respawns the shell, keeping the attached client', async () => {
  const ws = new FakeWS();
  terminal.attachClient('lib-restart', sessionCwd, ws);
  ws.input('echo before-restart-$((1+1))\r');
  await until(() => ws.sent.some(m => m.type === 'output' && m.data.includes('before-restart-2')));
  const oldPid = terminal._terminals.get('lib-restart').proc.pid;

  ws.emit('message', JSON.stringify({ type: 'restart' }));
  await until(() => ws.messages('attach').length === 2);
  assert.equal(ws.messages('attach')[1].replay, '', 'fresh shell attaches with an empty buffer');
  assert.equal(ws.messages('exit').length, 0, 'surviving client gets no exit frame');
  const term = terminal._terminals.get('lib-restart');
  assert.notEqual(term.proc.pid, oldPid, 'a new PTY process was spawned');
  assert.ok(!term.buffer.includes('before-restart-2'), 'old scrollback discarded');

  ws.input('echo after-restart-$((2+2))\r');
  await until(() => ws.sent.some(m => m.type === 'output' && m.data.includes('after-restart-4')));
  terminal.killTerminal('lib-restart');
});

test('client exit frame is sent when the shell exits', async () => {
  const ws = new FakeWS();
  terminal.attachClient('lib-exit', sessionCwd, ws);
  ws.input('exit 7\r');
  await until(() => ws.messages('exit').length > 0);
  assert.equal(ws.messages('exit')[0].code, 7);
  await until(() => !terminal._terminals.has('lib-exit'));
});

test('GET /api/config reports the terminal feature enabled', async () => {
  const res = await fetch(base + '/api/config');
  const cfg = await res.json();
  assert.equal(cfg.terminal, true);
});

test('WS endpoint: end-to-end echo through a real WebSocket', async () => {
  const ws = new WebSocket(`${wsBase}/api/sessions/${SESSION_ID}/terminal`);
  const frames = [];
  ws.onmessage = (ev) => frames.push(JSON.parse(ev.data));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  await until(() => frames.some(f => f.type === 'attach'));
  assert.equal(frames[0].cwd, sessionCwd, 'PTY starts at the session cwd');

  ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
  ws.send(JSON.stringify({ type: 'input', data: 'echo cols-$COLUMNS-ws-e2e\r' }));
  await until(() => frames.some(f => f.type === 'output' && f.data.includes('cols-120-ws-e2e')));

  ws.close();
  terminal.killTerminal(SESSION_ID);
});

test('WS endpoint: mode=tmux without a locatable pane sends an error frame and closes', async () => {
  const ws = new WebSocket(`${wsBase}/api/sessions/${SESSION_ID}/terminal?mode=tmux`);
  const frames = [];
  ws.onmessage = (ev) => frames.push(JSON.parse(ev.data));
  const closed = new Promise((resolve) => { ws.onclose = resolve; ws.onerror = resolve; });
  await closed;
  assert.ok(frames.some(f => f.type === 'error' && /tmux pane/i.test(f.error)),
    `expected a no-pane error frame, got ${JSON.stringify(frames)}`);
});

let tmuxOk = true;
try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); } catch { tmuxOk = false; }

test('WS endpoint: mode=tmux attaches a grouped viewer of the owning pane and cleans up', { skip: !tmuxOk, timeout: 30000 }, async () => {
  const TMUX_ID = '2026-07-19T11-00-00-tmxview1';
  const sock = path.join(tmuxTmp, 'view-test');
  execFileSync('tmux', ['-S', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'owner', '-x', '80', '-y', '24']);
  const paneId = execFileSync('tmux', ['-S', sock, 'list-panes', '-t', 'owner:0', '-F', '#{pane_id}'], { encoding: 'utf8' }).trim();
  // Arithmetic marker (the echoed input can't satisfy the assertion) printed
  // *in the owning pane* — the viewer must render it.
  execFileSync('tmux', ['-S', sock, 'send-keys', '-t', paneId, 'echo pane-marker-$((40+2))', 'Enter']);

  // Bridge-style registry entry stamped with the pane, like the real bridge
  // writes from $TMUX/$TMUX_PANE. The socket must accept or the registry
  // scan prunes the entry.
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const bridgeSock = path.join(tmpHome, 'view-bridge.sock');
  const bridge = net.createServer((s) => s.write(JSON.stringify({ type: 'hello' }) + '\n'));
  await new Promise(r => bridge.listen(bridgeSock, r));
  fs.writeFileSync(path.join(registryDir, `${TMUX_ID}.json`), JSON.stringify({
    sessionId: TMUX_ID, socketPath: bridgeSock, pid: process.pid, cwd: sessionCwd,
    tmux: { socket: sock, pane: paneId },
  }));
  await new Promise(r => setTimeout(r, 600)); // registry memo TTL

  try {
    const ws = new WebSocket(`${wsBase}/api/sessions/${TMUX_ID}/terminal?mode=tmux`);
    const frames = [];
    ws.onmessage = (ev) => frames.push(JSON.parse(ev.data));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws refused')); });

    await until(() => frames.some(f => f.type === 'attach'));
    assert.equal(frames[0].tmuxPrefix, 'C-b', 'attach frame carries the server prefix (config-less default)');

    // The viewer draws the owning pane's content, through its own grouped
    // session — never by attaching the owner directly (which would drag the
    // user's real client along on window switches).
    await until(() => frames.some(f => f.type === 'output' && f.data.includes('pane-marker-42')), 10000);
    const sessions = execFileSync('tmux', ['-S', sock, 'list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' })
      .trim().split('\n');
    assert.ok(sessions.some(s => s.startsWith('dish-view-')), `viewer session exists (got ${sessions})`);
    assert.equal(execFileSync('tmux', ['-S', sock, 'list-clients', '-t', '=owner', '-F', 'x'], { encoding: 'utf8' }).trim(),
      '', 'no client attached to the owner session itself');

    // Killing the PTY detaches the viewer client; destroy-unattached reaps
    // the grouped session so they can't pile up on the user's server.
    ws.close();
    terminal.killTerminal(`${TMUX_ID}:tmux`);
    await until(() => {
      const left = execFileSync('tmux', ['-S', sock, 'list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' })
        .trim().split('\n');
      return !left.some(s => s.startsWith('dish-view-'));
    }, 10000);
  } finally {
    fs.rmSync(path.join(registryDir, `${TMUX_ID}.json`), { force: true });
    bridge.close();
    try { execFileSync('tmux', ['-S', sock, 'kill-server'], { stdio: 'ignore' }); } catch {}
  }
});

test('WS endpoint: unknown session id is rejected', async () => {
  const ws = new WebSocket(`${wsBase}/api/sessions/definitely-not-a-session/terminal`);
  const result = await new Promise((resolve) => {
    ws.onopen = () => resolve('open');
    ws.onerror = () => resolve('error');
    ws.onclose = () => resolve('closed');
  });
  assert.notEqual(result, 'open', 'connection should be refused');
});

test('WS endpoint: non-terminal upgrade paths are destroyed', async () => {
  const ws = new WebSocket(`${wsBase}/api/other/path`);
  const result = await new Promise((resolve) => {
    ws.onopen = () => resolve('open');
    ws.onerror = () => resolve('error');
    ws.onclose = () => resolve('closed');
  });
  assert.notEqual(result, 'open');
});
