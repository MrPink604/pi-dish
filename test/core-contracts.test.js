// Generated tool from test/core-contracts.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const session_key_1 = require("../lib/session-key");
const host_identity_1 = require("../lib/host-identity");
const dish_store_1 = require("../lib/dish-store");
const pending_requests_1 = require("../lib/pending-requests");
const line_splitter_1 = require("../lib/line-splitter");
const process_identity_1 = require("../lib/process-identity");
test('canonical route ids retain legacy Pi bytes and distinguish alternate harnesses', () => {
    const native = 'same-native:id';
    assert.ok((0, session_key_1.validSessionId)(native));
    assert.equal((0, session_key_1.canonicalSessionId)((0, session_key_1.encodeSessionKey)('pi', native)), native);
    assert.equal((0, session_key_1.canonicalSessionId)(native), native);
    const omp = (0, session_key_1.canonicalSessionId)((0, session_key_1.encodeSessionKey)('omp', native));
    const prime = (0, session_key_1.canonicalSessionId)((0, session_key_1.encodeSessionKey)('prime', native));
    assert.notEqual(omp, prime);
    assert.equal((0, session_key_1.canonicalSessionId)(omp), omp);
    assert.deepEqual((0, session_key_1.resolveSessionRoute)(prime), { harnessId: 'prime', nativeSessionId: native });
    // Persisted routes must reject noncanonical encodings, not quietly acquire aliases.
    assert.throws(() => (0, session_key_1.canonicalSessionId)(`${omp}=`));
    for (const input of [null, undefined, 42, {}, ['id']])
        assert.throws(() => (0, session_key_1.canonicalSessionId)(input));
});
test('socket framing preserves split UTF-8 and JSON Unicode separators', () => {
    const lines = [];
    const feed = (0, line_splitter_1.createLineSplitter)(line => lines.push(line));
    const message = JSON.stringify({ text: '🦉\u2028middle\u2029end' });
    const bytes = Buffer.from(`\r\n${message}\r\n\nunfinished`);
    // Every possible multibyte boundary is crossed by one-byte chunks.
    for (const byte of bytes)
        feed(new Uint8Array([byte]));
    assert.deepEqual(lines, [message]);
    feed('\n');
    assert.deepEqual(lines, [message, 'unfinished']);
});
test('request correlation distinguishes numeric/string ids and ignores late responses', async () => {
    const pending = new pending_requests_1.PendingRequests();
    const numeric = pending.track(1);
    const text = pending.track('1');
    assert.equal(pending.settle('1', true, { owner: 'text' }), true);
    assert.equal(pending.settle(1, true, { owner: 'number' }), true);
    assert.deepEqual(await numeric, { owner: 'number' });
    assert.deepEqual(await text, { owner: 'text' });
    assert.equal(pending.settle(1, true, 'late'), false);
    assert.equal(pending.settle(null, true), false);
});
test('request timeout and socket failure reject and release their pending entries', async () => {
    const pending = new pending_requests_1.PendingRequests();
    await assert.rejects(pending.track('slow', { timeout: 5, label: 'bridge test' }), Error);
    assert.equal(pending.settle('slow', true, 'late'), false);
    const rejected = assert.rejects(pending.track('rejected'), /wire failure/);
    pending.settle('rejected', false, undefined, 'wire failure');
    await rejected;
    const writeFailure = new Error('write failed');
    const failedWrite = assert.rejects(pending.track('write'), (error) => error === writeFailure);
    pending.fail('write', writeFailure);
    await failedWrite;
    const disconnected = new Error('disconnected');
    const first = assert.rejects(pending.track('a'), (error) => error === disconnected);
    const second = assert.rejects(pending.track('b'), (error) => error === disconnected);
    pending.failAll(disconnected);
    await Promise.all([first, second]);
    assert.equal(pending.settle('a', true), false);
    assert.equal(pending.settle('b', true), false);
});
test('host identity and core stores follow temporary HOME changes', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-core-home-'));
    const original = process.env.HOME;
    try {
        process.env.HOME = path.join(home, 'first');
        const first = (0, host_identity_1.getHostId)();
        assert.equal((0, host_identity_1.getHostId)(), first);
        (0, dish_store_1.writeStore)('settings.json', { hostLabel: ' first host ' });
        assert.equal((0, host_identity_1.getHostLabel)(), 'first host');
        process.env.HOME = path.join(home, 'second');
        assert.notEqual((0, host_identity_1.getHostId)(), first);
        assert.deepEqual((0, dish_store_1.readStore)('settings.json'), {});
        (0, dish_store_1.writeStore)('settings.json', ['not a record']);
        assert.deepEqual((0, dish_store_1.readStore)('settings.json'), {});
        process.env.HOME = path.join(home, 'first');
        assert.equal((0, host_identity_1.getHostId)(), first);
        assert.equal((0, host_identity_1.getHostLabel)(), 'first host');
    }
    finally {
        if (original === undefined)
            delete process.env.HOME;
        else
            process.env.HOME = original;
        fs.rmSync(home, { recursive: true, force: true });
    }
});
test('process proofs preserve birth identity and fail closed for incomplete input', { skip: process.platform !== 'linux' }, () => {
    const identity = (0, process_identity_1.processIdentity)(process.pid);
    assert.ok(identity);
    assert.equal((0, process_identity_1.processIdentityAlive)(identity), true);
    assert.equal((0, process_identity_1.processIdentityAlive)({ pid: process.pid, startTime: '0' }), false);
    assert.equal((0, process_identity_1.processIdentityAlive)({ pid: process.pid }), false);
    assert.equal((0, process_identity_1.processIdentityAlive)(null), false);
    assert.deepEqual((0, process_identity_1.inspectProcessAncestry)({ pid: process.pid }), { complete: false, processes: [] });
    assert.deepEqual((0, process_identity_1.inspectProcessAncestry)({ ...identity, startTime: '0' }), { complete: false, processes: [] });
    const bounded = (0, process_identity_1.inspectProcessAncestry)(identity, { maxDepth: 1 });
    assert.deepEqual(bounded.processes, [identity]);
    assert.equal(bounded.complete, false);
});
