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
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-term-test-'));
process.env.HOME = tmpHome;
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
