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
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const core = require(path.join(__dirname, '..', 'skills', 'lib', 'pi-dish-client.js'));
const { parseRef, mergeSearchResults, renderTranscript } = core;

// --- parseRef -------------------------------------------------------------

test('parseRef reads a bare id or prefix as local', () => {
  assert.deepEqual(parseRef('8f3ab2c1'), { hostPart: null, hostIdForm: false, id: '8f3ab2c1' });
  assert.deepEqual(parseRef('  8f3ab2c1  '), { hostPart: null, hostIdForm: false, id: '8f3ab2c1' });
});

test('parseRef splits a host-qualified ref on the first slash only', () => {
  assert.deepEqual(parseRef('tycho/8f3ab2c1'), { hostPart: 'tycho', hostIdForm: false, id: '8f3ab2c1' });
  // A session id may itself contain a slash; only the host part is peeled off.
  assert.deepEqual(parseRef('tycho/a/b'), { hostPart: 'tycho', hostIdForm: false, id: 'a/b' });
});

test('parseRef treats self/ as an explicit local ref', () => {
  assert.deepEqual(parseRef('self/8f3ab2c1'), { hostPart: 'self', hostIdForm: false, id: '8f3ab2c1' });
});

test('parseRef recognises the hostId:sessionId provenance form', () => {
  const uuid = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  assert.deepEqual(parseRef(`${uuid}:2026-08-01T10-00-00-abcdef12`), {
    hostPart: uuid, hostIdForm: true, id: '2026-08-01T10-00-00-abcdef12',
  });
});

test('parseRef leaves a non-uuid colon prefix as literal id text', () => {
  // Only a full uuid before the first colon means provenance; anything else is
  // just an id that happens to contain a colon.
  assert.deepEqual(parseRef('tycho:8f3ab2c1'), { hostPart: null, hostIdForm: false, id: 'tycho:8f3ab2c1' });
  assert.deepEqual(parseRef('aaaaaaaa-1111-4111-8111:x'), { hostPart: null, hostIdForm: false, id: 'aaaaaaaa-1111-4111-8111:x' });
});

test('parseRef rejects empty parts and empty refs', () => {
  assert.throws(() => parseRef('/8f3ab2c1'), /nothing before the "\/"/);
  assert.throws(() => parseRef('tycho/'), /nothing after the "\/"/);
  assert.throws(() => parseRef('   '), /session ref is required/);
  assert.throws(() => parseRef(undefined), /session ref is required/);
});

// --- mergeSearchResults ---------------------------------------------------

test('mergeSearchResults ranks by score, tags each row with its host', () => {
  const merged = mergeSearchResults([
    { host: '(self)', results: [{ id: 'a', searchScore: 5 }, { id: 'b', searchScore: 40 }] },
    { host: 'tycho', results: [{ id: 'c', searchScore: 12 }] },
  ]);
  assert.deepEqual(merged.map((row) => [row.host, row.session.id]), [
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
  assert.deepEqual(merged.map((row) => row.session.id), ['scored', 'new', 'old']);
});

test('mergeSearchResults applies the limit to the merged list', () => {
  const merged = mergeSearchResults([
    { host: '(self)', results: [{ id: 'a', searchScore: 1 }, { id: 'b', searchScore: 3 }] },
    { host: 'tycho', results: [{ id: 'c', searchScore: 2 }] },
  ], 2);
  assert.deepEqual(merged.map((row) => row.session.id), ['b', 'c']);
  assert.equal(mergeSearchResults([], 5).length, 0);
  assert.equal(mergeSearchResults(null).length, 0);
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
  assert.match(out, /^# Torn tail fix \(2026-08-01T1\)/m);
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
  assert.equal(without.includes('private chain of reasoning'), false);
  assert.equal(without.includes('<thinking>'), false);

  const with_ = renderTranscript(samplePayload(), { thinking: true });
  assert.ok(with_.includes('<thinking>'));
  assert.ok(with_.includes('private chain of reasoning'));
});

test('renderTranscript summarizes a tool call on one line, path/command args first', () => {
  const out = renderTranscript(samplePayload(), {});
  const line = out.split('\n').find((l) => l.startsWith('⚙ '));
  assert.equal(line, '⚙ Bash: command=tail -n 5 session.jsonl verbosity=high');
  assert.ok(line.length <= 120 + '⚙ Bash: '.length);
});

test('renderTranscript truncates tool results and marks images', () => {
  const out = renderTranscript(samplePayload(), {});
  assert.ok(out.includes('line 7'), 'the first eight lines survive');
  assert.equal(out.includes('line 8'), false, 'the ninth line is cut');
  assert.match(out, /… \(\+12 more lines\)/);
  assert.ok(out.includes('[image]'));
});

test('renderTranscript ends with the exact invocation that pages further back', () => {
  const out = renderTranscript(samplePayload(), { ref: 'tycho/8f3ab2c1', limit: 30 });
  assert.match(out, /— 30 older messages\. Page back with: read tycho\/8f3ab2c1 --limit 30 --before 30/);
});

test('renderTranscript handles an empty window and a host qualifier', () => {
  const out = renderTranscript({ session: { id: 'x', isActive: true }, messages: [], totalMessages: 0 }, { host: 'tycho' });
  assert.match(out, /- host: tycho/);
  assert.match(out, /- state: active/);
  assert.match(out, /_No messages in this window\._/);
});
