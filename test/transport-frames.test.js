const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { decodeRPCFrame, decodeBridgeFrame } = require('../lib/wire-protocol');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-frames-'));
process.env.HOME = tmp;
const { BridgeSession } = require('../lib/bridge-session');
const { RPCSession } = require('../lib/rpc-session');
const { processIdentity } = require('../lib/process-identity');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function rpcFixture(t) {
  const proc = Object.assign(new EventEmitter(), {
    pid: process.pid, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  });
  const session = new RPCSession('fixture', proc);
  t.after(() => {
    proc.emit('exit', 0);
    for (const stream of [proc.stdin, proc.stdout, proc.stderr]) stream.destroy();
  });
  return { session, proc };
}

test('transport decoders reject malformed envelopes without interpreting payloads', () => {
  for (const value of [null, undefined, 3, true, 'text', [], {}, { type: 42 }, { type: '' }]) {
    assert.equal(decodeRPCFrame(value), null);
    assert.equal(decodeBridgeFrame(value), null);
  }
  for (const response of [
    { type: 'response', id: 1 },
    { type: 'response', id: 1, success: 'true' },
    { type: 'response', id: {}, success: true },
    { type: 'response', id: Infinity, success: true },
    { type: 'response', id: 1, success: false, error: {} },
  ]) {
    assert.equal(decodeRPCFrame(response), null);
    assert.equal(decodeBridgeFrame(response), null);
  }
});

test('response correlation retains numeric/string ids and unknown payloads', () => {
  for (const id of [1, '1', null, undefined]) {
    const response = { type: 'response', id, success: true, data: ['feature-specific'] };
    for (const decode of [decodeRPCFrame, decodeBridgeFrame]) {
      const frame = decode(response);
      assert.equal(frame.kind, 'response');
      assert.equal(frame.response, response, 'decoding must not rewrite the wire payload');
    }
  }
});

test('unknown agent events remain forwardable and hello decoding grants no ownership', () => {
  const rpc = { type: 'future_event', custom: { value: 123 } };
  assert.deepEqual(decodeRPCFrame(rpc), { kind: 'event', event: 'future_event', data: rpc });
  const data = ['opaque', null];
  assert.deepEqual(decodeBridgeFrame({ type: 'event', event: 'future_event', data }), { kind: 'event', event: 'future_event', data });
  const hello = { type: 'hello', sessionId: 'unproven' };
  assert.deepEqual(decodeBridgeFrame(hello), { kind: 'hello', hello });
  for (const event of [null, 12, {}, '']) assert.equal(decodeBridgeFrame({ type: 'event', event }), null);
});

test('bridge socket ignores bad frames and continues through a valid response and event', async (t) => {
  const socketPath = path.join(tmp, 'bridge.sock');
  const clients = new Set();
  const server = net.createServer(sock => {
    clients.add(sock);
    sock.on('error', () => {});
    sock.on('data', chunk => {
      const command = JSON.parse(chunk.toString());
      const frames = [null, [], { type: 'event', event: 17 },
        { type: 'response', id: command.id, success: 'true', data: 'invalid' },
        { type: 'response', id: command.id, success: true, data: 'valid' },
        { type: 'event', event: 'future_event', data: { preserved: true } }];
      sock.write(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n');
    });
  });
  t.after(async () => {
    for (const sock of clients) sock.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  const session = new BridgeSession({ sessionId: 'test', socketPath, pid: process.pid });
  t.after(() => session.close());
  await session.connect();
  const events = [];
  session.on('future_event', data => events.push(data));
  const forwarded = new Promise(resolve => session.once('future_event', resolve));
  assert.equal(await session.send('test', {}, { timeout: 1000 }), 'valid');
  await forwarded;
  assert.deepEqual(events, [{ preserved: true }]);
  assert.equal(session.alive, true);
});

test('RPC stdio ignores bad response status and still forwards subsequent agent events', async (t) => {
  const { session, proc } = rpcFixture(t);
  const events = [];
  session.on('future_event', data => events.push(data));
  const response = session.send('test', {}, { timeout: 1000 });
  const command = JSON.parse(proc.stdin.read().toString());
  const event = { type: 'future_event', preserved: true };
  const frames = [null, [], { type: 'response', id: command.id, success: 'true', data: 'invalid' },
    { type: 'response', id: command.id, success: true, data: 'valid' }, event];
  proc.stdout.write(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n');
  assert.equal(await response, 'valid');
  assert.deepEqual(events, [event]);
  assert.equal(session.alive, true);
});

test('RPC reconstructs text, thinking and tool-call deltas without mutating prior snapshots', (t) => {
  const { session } = rpcFixture(t);
  const snapshots = [];
  session.on('message_update', data => snapshots.push(data.message));
  const start = { role: 'assistant', content: [], timestamp: 123, customMetadata: { kept: true } };
  session._handleMessage({ type: 'message_start', message: start });
  const update = event => session._handleMessage({ type: 'message_update', assistantMessageEvent: event });
  update({ type: 'text_start', contentIndex: 0 });
  update({ type: 'text_delta', contentIndex: 0, delta: 'hello' });
  update({ type: 'text_delta', contentIndex: 0, delta: ' world' });
  update({ type: 'text_end', contentIndex: 0, content: 'hello world!' });
  update({ type: 'thinking_start', contentIndex: 1 });
  update({ type: 'thinking_delta', contentIndex: 1, delta: 'reasoning' });
  update({ type: 'thinking_end', contentIndex: 1, content: 'reasoning complete' });
  const tool = { type: 'toolCall', id: 't1', name: 'Read', arguments: { path: 'README.md' } };
  update({ type: 'toolcall_end', contentIndex: 2, toolCall: tool });
  const content = [
    { type: 'text', text: 'hello world!' },
    { type: 'thinking', thinking: 'reasoning complete' }, tool,
  ];
  assert.deepEqual(snapshots.at(-1), { ...start, content });
  assert.deepEqual(start.content, [], 'wire message_start remains untouched');
  assert.equal(snapshots[0].content[0].text, '', 'later deltas cannot mutate already emitted snapshots');

  for (const event of [
    { type: 'text_delta', contentIndex: -1, delta: 'bad' },
    { type: 'text_delta', contentIndex: '__proto__', delta: 'bad' },
    { type: 'text_delta', contentIndex: 0, delta: {} },
    { type: 'thinking_end', contentIndex: 1, content: [] },
  ]) update(event);
  assert.deepEqual(snapshots.at(-1).content, content, 'malformed delta fields do not corrupt the snapshot');

  const final = { ...start, content, stopReason: 'stop', usage: { totalTokens: 10 } };
  update({ type: 'done', message: final });
  assert.deepEqual(snapshots.at(-1), final);
  const error = { ...final, stopReason: 'error', errorMessage: 'provider stopped' };
  update({ type: 'error', error });
  assert.deepEqual(snapshots.at(-1), error);
  session._handleMessage({ type: 'message_end', message: error });
  assert.equal(session.streamingAssistantMessage, null);
});

test('RPC recovery observation retains fail-closed handling of null bridge claims', (t) => {
  const { session } = rpcFixture(t);
  session.sessionFile = path.join(tmp, 'session.jsonl');
  const dir = path.join(tmp, '.pi', 'dish', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'invalid.json');
  fs.writeFileSync(file, 'null');
  try {
    assert.throws(() => session._canObserveRecovery(), TypeError);
  } finally {
    fs.rmSync(file);
  }
});

test('RPC recovery observation preserves coercible process proof and sticky bridge ownership', (t) => {
  const { session } = rpcFixture(t);
  session.sessionFile = path.join(tmp, 'session.jsonl');
  const identity = processIdentity(process.pid);
  assert.ok(identity);
  const dir = path.join(tmp, '.pi', 'dish', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'owned.json');
  fs.writeFileSync(file, JSON.stringify({
    recoveryObservation: true, harnessId: 'pi', sessionFile: session.sessionFile,
    pid: String(identity.pid), startTime: Number(identity.startTime),
  }));
  try {
    assert.equal(session._canObserveRecovery(), false);
    assert.equal(session.recoveryBridgeOwned, true);
  } finally {
    fs.rmSync(file);
  }
  assert.equal(session._canObserveRecovery(), false, 'removing the bridge claim must not transfer recovery ownership');
});
