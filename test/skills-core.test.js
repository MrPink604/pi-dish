// Generated tool from test/skills-core.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for the pure parts of skills/lib/pi-dish-client.js — the shared
 * core the vended skill CLIs are built on.
 *
 * Everything here is DOM-free, network-free and deterministic: ref parsing,
 * the client-side fleet search merge (the client is the aggregator, so this
 * ordering *is* the fleet ranking), and transcript rendering.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const core = require(path.join(__dirname, '..', 'skills', 'lib', 'pi-dish-client.js'));
assert.ok(typeof core === 'object' && core !== null);
assert.ok('parseRef' in core && typeof core.parseRef === 'function');
assert.ok('mergeSearchResults' in core && typeof core.mergeSearchResults === 'function');
assert.ok('renderTranscript' in core && typeof core.renderTranscript === 'function');
const { parseRef, mergeSearchResults, renderTranscript } = core;
// --- parseRef -------------------------------------------------------------
test('parseRef reads a bare id or prefix as local', () => {
    const parsed = parseRef('8f3ab2c1');
    assert.deepEqual(parsed, { hostPart: null, hostIdForm: false, id: '8f3ab2c1' });
    const trimmed = parseRef('  8f3ab2c1  ');
    assert.deepEqual(trimmed, { hostPart: null, hostIdForm: false, id: '8f3ab2c1' });
});
test('parseRef splits a host-qualified ref on the first slash only', () => {
    const qualified = parseRef('tycho/8f3ab2c1');
    assert.deepEqual(qualified, { hostPart: 'tycho', hostIdForm: false, id: '8f3ab2c1' });
    // A session id may itself contain a slash; only the host part is peeled off.
    const nested = parseRef('tycho/a/b');
    assert.deepEqual(nested, { hostPart: 'tycho', hostIdForm: false, id: 'a/b' });
});
test('parseRef treats self/ as an explicit local ref', () => {
    const local = parseRef('self/8f3ab2c1');
    assert.deepEqual(local, { hostPart: 'self', hostIdForm: false, id: '8f3ab2c1' });
});
test('parseRef recognises the hostId:sessionId provenance form', () => {
    const uuid = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const provenance = parseRef(`${uuid}:2026-08-01T10-00-00-abcdef12`);
    assert.deepEqual(provenance, {
        hostPart: uuid, hostIdForm: true, id: '2026-08-01T10-00-00-abcdef12',
    });
});
test('parseRef leaves a non-uuid colon prefix as literal id text', () => {
    // Only a full uuid before the first colon means provenance; anything else is
    // just an id that happens to contain a colon.
    const literal = parseRef('tycho:8f3ab2c1');
    assert.deepEqual(literal, { hostPart: null, hostIdForm: false, id: 'tycho:8f3ab2c1' });
    const partialUuid = parseRef('aaaaaaaa-1111-4111-8111:x');
    assert.deepEqual(partialUuid, { hostPart: null, hostIdForm: false, id: 'aaaaaaaa-1111-4111-8111:x' });
});
test('parseRef rejects empty parts and empty refs', () => {
    assert.throws(() => parseRef('/8f3ab2c1'));
    assert.throws(() => parseRef('tycho/'));
    assert.throws(() => parseRef('   '));
    assert.throws(() => parseRef(undefined));
});
// --- mergeSearchResults ---------------------------------------------------
test('mergeSearchResults ranks by score, tags each row with its host', () => {
    const merged = mergeSearchResults([
        { host: '(self)', results: [{ id: 'a', searchScore: 5 }, { id: 'b', searchScore: 40 }] },
        { host: 'tycho', results: [{ id: 'c', searchScore: 12 }] },
    ]);
    assert.ok(Array.isArray(merged));
    assert.deepEqual(merged.map((row) => {
        assert.ok(typeof row === 'object' && row !== null && 'host' in row && 'session' in row);
        assert.ok(typeof row.host === 'string');
        const session = row.session;
        assert.ok(typeof session === 'object' && session !== null && 'id' in session);
        assert.ok(typeof session.id === 'string');
        return [row.host, session.id];
    }), [
        ['(self)', 'b'], ['tycho', 'c'], ['(self)', 'a'],
    ]);
});
test('mergeSearchResults sinks unscored sessions below scored ones, newest first', () => {
    const merged = mergeSearchResults([
        { host: 'tycho', results: [
                { id: 'old', lastActivity: '2026-01-01T00:00:00.000Z' },
                { id: 'new', lastActivity: '2026-08-01T00:00:00.000Z' },
            ] },
        { host: '(self)', results: [{ id: 'scored', searchScore: 0 }] },
    ]);
    // A score of 0 is still a score: field-only queries score every match 0 and
    // must not be reordered below the scoreless tail.
    assert.ok(Array.isArray(merged));
    assert.deepEqual(merged.map((row) => {
        assert.ok(typeof row === 'object' && row !== null && 'session' in row);
        const session = row.session;
        assert.ok(typeof session === 'object' && session !== null && 'id' in session);
        assert.ok(typeof session.id === 'string');
        return session.id;
    }), ['scored', 'new', 'old']);
});
test('mergeSearchResults applies the limit to the merged list', () => {
    const merged = mergeSearchResults([
        { host: '(self)', results: [{ id: 'a', searchScore: 1 }, { id: 'b', searchScore: 3 }] },
        { host: 'tycho', results: [{ id: 'c', searchScore: 2 }] },
    ], 2);
    assert.ok(Array.isArray(merged));
    assert.deepEqual(merged.map((row) => {
        assert.ok(typeof row === 'object' && row !== null && 'session' in row);
        const session = row.session;
        assert.ok(typeof session === 'object' && session !== null && 'id' in session);
        assert.ok(typeof session.id === 'string');
        return session.id;
    }), ['b', 'c']);
    const empty = mergeSearchResults([], 5);
    assert.ok(Array.isArray(empty));
    assert.equal(empty.length, 0);
    const absent = mergeSearchResults(null);
    assert.ok(Array.isArray(absent));
    assert.equal(absent.length, 0);
});
// --- renderTranscript -----------------------------------------------------
function samplePayload() {
    return {
        session: {
            id: '2026-08-01T10-00-00-abcdef12',
            name: 'Torn tail fix',
            cwd: '/work/api',
            model: 'anthropic/claude',
            isActive: false,
            lastActivity: '2026-08-01T10:05:00.000Z',
        },
        totalMessages: 40,
        firstIndex: 30,
        lastIndex: 39,
        hasMore: true,
        messages: [
            { index: 30, role: 'user', timestamp: '2026-08-01T10:00:01.000Z',
                content: [{ type: 'text', text: 'why does the tail tear' }] },
            { index: 31, role: 'assistant', timestamp: '2026-08-01T10:00:02.000Z', content: [
                    { type: 'thinking', thinking: 'private chain of reasoning' },
                    { type: 'text', text: 'Because the append is not atomic.' },
                    { type: 'toolCall', id: 't1', name: 'Bash', arguments: { verbosity: 'high', command: 'tail -n 5 session.jsonl' } },
                ] },
            { index: 32, role: 'toolResult', toolName: 'Bash', timestamp: '2026-08-01T10:00:03.000Z', content: [
                    { type: 'text', text: Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') },
                    { type: 'image', mimeType: 'image/png', url: '/api/…' },
                ] },
            { index: 33, role: 'branchSummary', timestamp: '2026-08-01T10:00:04.000Z',
                content: [{ type: 'text', text: 'abandoned branch recap' }] },
        ],
    };
}
test('renderTranscript writes a banner and renders prose verbatim', () => {
    const out = renderTranscript(samplePayload(), { ref: '8f3ab2c1', limit: 10 });
    assert.ok(typeof out === 'string');
    assert.match(out, /^# Torn tail fix \(/m);
    assert.match(out, /- id: 2026-08-01T10-00-00-abcdef12/);
    assert.match(out, /- cwd: \/work\/api/);
    assert.match(out, /- model: anthropic\/claude/);
    assert.match(out, /- state: inactive/);
    assert.match(out, /- messages: 4 of 40 \(indexes 30–39\)/);
    assert.match(out, /## user · 2026-08-01 10:00:01Z/);
    assert.ok(out.includes('why does the tail tear'));
    assert.ok(out.includes('Because the append is not atomic.'));
    assert.match(out, /## branch summary/);
    assert.ok(out.includes('abandoned branch recap'));
});
test('renderTranscript omits thinking by default and includes it on request', () => {
    const without = renderTranscript(samplePayload(), {});
    assert.ok(typeof without === 'string');
    assert.equal(without.includes('private chain of reasoning'), false);
    assert.equal(without.includes('<thinking>'), false);
    const with_ = renderTranscript(samplePayload(), { thinking: true });
    assert.ok(typeof with_ === 'string');
    assert.ok(with_.includes('<thinking>'));
    assert.ok(with_.includes('private chain of reasoning'));
});
test('renderTranscript summarizes a tool call on one line, path/command args first', () => {
    const out = renderTranscript(samplePayload(), {});
    assert.ok(typeof out === 'string');
    const line = out.split('\n').find((l) => l.startsWith('⚙ '));
    assert.equal(line, '⚙ Bash: command=tail -n 5 session.jsonl verbosity=high');
});
test('renderTranscript truncates tool results and marks images', () => {
    const out = renderTranscript(samplePayload(), {});
    assert.ok(typeof out === 'string');
    assert.ok(out.includes('line 7'), 'the first eight lines survive');
    assert.equal(out.includes('line 8'), false, 'the ninth line is cut');
    assert.match(out, /… \(\+12 more lines\)/);
    assert.ok(out.includes('[image]'));
});
test('renderTranscript ends with the exact invocation that pages further back', () => {
    const out = renderTranscript(samplePayload(), { ref: 'tycho/8f3ab2c1', limit: 30 });
    assert.ok(typeof out === 'string');
    assert.ok(out.trimEnd().endsWith('read tycho/8f3ab2c1 --limit 30 --before 30'));
});
test('renderTranscript handles an empty window and a host qualifier', () => {
    const out = renderTranscript({ session: { id: 'x', isActive: true }, messages: [], totalMessages: 0 }, { host: 'tycho' });
    assert.ok(typeof out === 'string');
    assert.match(out, /- host: tycho/);
    assert.match(out, /- state: active/);
});
// --- CLI native identity policy -------------------------------------------
assert.ok('nativeSessionId' in core && typeof core.nativeSessionId === 'function');
assert.ok('sessionHarnessId' in core && typeof core.sessionHarnessId === 'function');
const { nativeSessionId, sessionHarnessId } = core;
const OMP_A = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0'])).toString('base64url');
const PI_A = '2026-07-25T07-36-28-426Z_019f9834-3e0a-77bb-bd3b-7ee46212bdf1';
test('the CLI core reads the native id out of an encoded route id', () => {
    const ompNative = nativeSessionId(OMP_A);
    assert.equal(ompNative, '2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0');
    const piNative = nativeSessionId(PI_A);
    assert.equal(piNative, PI_A, 'a bare Pi id is its own native id');
    const malformed = nativeSessionId('~sk1_nonsense!!');
    assert.equal(malformed, null, 'a malformed key answers nothing, never a guess');
});
test('CLI harness inference survives absent native identity without inventing a native id', () => {
    for (const tuple of [['omp'], ['omp', null], ['omp', ''], ['omp', 42]]) {
        const route = '~sk1_' + Buffer.from(JSON.stringify(tuple)).toString('base64url');
        const harness = sessionHarnessId(route);
        const native = nativeSessionId(route);
        assert.equal(harness, 'omp');
        assert.equal(native, null);
    }
    for (const tuple of [[], ['', 'native'], [42, 'native']]) {
        const route = '~sk1_' + Buffer.from(JSON.stringify(tuple)).toString('base64url');
        const harness = sessionHarnessId(route);
        const native = nativeSessionId(route);
        assert.equal(harness, null);
        assert.equal(native, null);
    }
});
