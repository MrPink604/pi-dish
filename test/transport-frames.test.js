// Generated tool from test/transport-frames.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const node_child_process_1 = require("node:child_process");
const node_stream_1 = require("node:stream");
const wire_protocol_js_1 = require("../lib/wire-protocol.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-frames-'));
process.env.HOME = tmp;
const { BridgeSession } = require('../lib/bridge-session.js');
const { RPCSession } = require('../lib/rpc-session.js');
const { processIdentity } = require('../lib/process-identity.js');
const { validSessionId } = require('../lib/session-key.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
function rpcFixture(t) {
    const stdin = new node_stream_1.PassThrough();
    const stdout = new node_stream_1.PassThrough();
    const stderr = new node_stream_1.PassThrough();
    const stdio = [stdin, stdout, stderr, null, null];
    // Native process/event methods, but no child is spawned or killed by this fixture.
    const proc = Object.assign(new node_child_process_1.ChildProcess(), { pid: process.pid, stdin, stdout, stderr, stdio });
    const id = 'fixture';
    assert.ok(validSessionId(id));
    const session = new RPCSession(id, proc);
    t.after(() => {
        proc.emit('exit', 0);
        for (const stream of [proc.stdin, proc.stdout, proc.stderr])
            stream.destroy();
    });
    return { session, proc };
}
test('transport decoders reject malformed envelopes without interpreting payloads', () => {
    for (const value of [null, undefined, 3, true, 'text', [], {}, { type: 42 }, { type: '' }]) {
        assert.equal((0, wire_protocol_js_1.decodeRPCFrame)(value), null);
        assert.equal((0, wire_protocol_js_1.decodeBridgeFrame)(value), null);
    }
    for (const response of [
        { type: 'response', id: 1 },
        { type: 'response', id: 1, success: 'true' },
        { type: 'response', id: {}, success: true },
        { type: 'response', id: Infinity, success: true },
        { type: 'response', id: 1, success: false, error: {} },
    ]) {
        assert.equal((0, wire_protocol_js_1.decodeRPCFrame)(response), null);
        assert.equal((0, wire_protocol_js_1.decodeBridgeFrame)(response), null);
    }
});
test('response correlation retains numeric/string ids and unknown payloads', () => {
    for (const id of [1, '1', null, undefined]) {
        const response = { type: 'response', id, success: true, data: ['feature-specific'] };
        for (const decode of [wire_protocol_js_1.decodeRPCFrame, wire_protocol_js_1.decodeBridgeFrame]) {
            const frame = decode(response);
            assert.ok(frame && frame.kind === 'response');
            assert.equal(frame.response, response, 'decoding must not rewrite the wire payload');
        }
    }
});
test('unknown agent events remain forwardable and hello decoding grants no ownership', () => {
    const rpc = { type: 'future_event', custom: { value: 123 } };
    assert.deepEqual((0, wire_protocol_js_1.decodeRPCFrame)(rpc), { kind: 'event', event: 'future_event', data: rpc });
    const data = ['opaque', null];
    assert.deepEqual((0, wire_protocol_js_1.decodeBridgeFrame)({ type: 'event', event: 'future_event', data }), { kind: 'event', event: 'future_event', data });
    const hello = { type: 'hello', sessionId: 'unproven' };
    assert.deepEqual((0, wire_protocol_js_1.decodeBridgeFrame)(hello), { kind: 'hello', hello });
    for (const event of [null, 12, {}, ''])
        assert.equal((0, wire_protocol_js_1.decodeBridgeFrame)({ type: 'event', event }), null);
});
test('bridge socket ignores bad frames and continues through a valid response and event', async (t) => {
    const socketPath = path.join(tmp, 'bridge.sock');
    const clients = new Set();
    const server = net.createServer(sock => {
        clients.add(sock);
        sock.on('error', () => { });
        sock.on('data', (chunk) => {
            const command = JSON.parse(chunk.toString());
            assert.ok((0, wire_protocol_js_1.isRecord)(command));
            const frames = [null, [], { type: 'event', event: 17 },
                { type: 'response', id: command.id, success: 'true', data: 'invalid' },
                { type: 'response', id: command.id, success: true, data: 'valid' },
                { type: 'event', event: 'future_event', data: { preserved: true } }];
            sock.write(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n');
        });
    });
    t.after(async () => {
        for (const sock of clients)
            sock.destroy();
        await new Promise(resolve => server.close(() => resolve()));
    });
    await new Promise(resolve => server.listen(socketPath, resolve));
    const id = 'test';
    assert.ok(validSessionId(id));
    const session = new BridgeSession({ sessionId: id, socketPath, pid: process.pid });
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
    const commandBytes = proc.stdin.read();
    assert.ok(Buffer.isBuffer(commandBytes));
    const command = JSON.parse(commandBytes.toString());
    assert.ok((0, wire_protocol_js_1.isRecord)(command));
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
    session.on('message_update', data => {
        assert.ok((0, wire_protocol_js_1.isRecord)(data) && (0, wire_protocol_js_1.isRecord)(data.message));
        snapshots.push(data.message);
    });
    const start = { role: 'assistant', content: [], timestamp: 123, customMetadata: { kept: true } };
    session._handleMessage({ type: 'message_start', message: start });
    const update = (event) => session._handleMessage({ type: 'message_update', assistantMessageEvent: event });
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
    const firstSnapshot = snapshots[0];
    assert.ok(firstSnapshot && Array.isArray(firstSnapshot.content));
    const firstBlock = firstSnapshot.content[0];
    assert.ok((0, wire_protocol_js_1.isRecord)(firstBlock));
    assert.equal(firstBlock.text, '', 'later deltas cannot mutate already emitted snapshots');
    for (const event of [
        { type: 'text_delta', contentIndex: -1, delta: 'bad' },
        { type: 'text_delta', contentIndex: '__proto__', delta: 'bad' },
        { type: 'text_delta', contentIndex: 0, delta: {} },
        { type: 'thinking_end', contentIndex: 1, content: [] },
    ])
        update(event);
    assert.deepEqual(snapshots.at(-1)?.content, content, 'malformed delta fields do not corrupt the snapshot');
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
    }
    finally {
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
    }
    finally {
        fs.rmSync(file);
    }
    assert.equal(session._canObserveRecovery(), false, 'removing the bridge claim must not transfer recovery ownership');
});
