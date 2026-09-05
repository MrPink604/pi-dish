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

// --- ref aliases ----------------------------------------------------------
//
// The CLIs import nothing from the server (see the module header), so this
// rule exists twice: here and in public/helpers.js. These tests pin the two
// copies to each other — a divergence would make a ref mean different things
// depending on whether the server or the CLI expanded it.

const H = require('../public/helpers.js');
const { sessionRefAliases, resolveRefAmong, shortSessionRef, stableSessionRef, nativeSessionId } = core;

const OMP_A = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0'])).toString('base64url');
const OMP_B = '~sk1_' + Buffer.from(JSON.stringify(['omp', '2026-09-05T16-25-56-254Z_01a07264-131e-74a7-979a-1e763bf12b97'])).toString('base64url');
const PI_A = '2026-07-25T07-36-28-426Z_019f9834-3e0a-77bb-bd3b-7ee46212bdf1';
const CORPUS = [{ id: OMP_A, name: 'a' }, { id: OMP_B, name: 'b' }, { id: PI_A, name: 'c' }];

test('the CLI core reads the native id out of an encoded route id', () => {
  assert.equal(nativeSessionId(OMP_A), '2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0');
  assert.equal(nativeSessionId(PI_A), PI_A, 'a bare Pi id is its own native id');
  assert.equal(nativeSessionId('~sk1_nonsense!!'), null, 'a malformed key answers nothing, never a guess');
});

test('CLI ref resolution matches the server rule exactly', () => {
  const refs = [
    OMP_A, OMP_B, PI_A,
    '2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0',
    '01a070d2-43fb-7360-aaba-a4ddf8d1deb0', '01a070d2', '01a07264', '019f9834',
    '~sk1_WyJvbXAi', '2026-', 'nope1234', OMP_A.replace('LTA1VDA5', 'LTA5'),
  ];
  for (const ref of refs) {
    const mine = resolveRefAmong(CORPUS, ref, false);
    const theirs = H.resolveSessionRefAmong(CORPUS, ref);
    assert.equal(mine.session?.name ?? null, theirs.session?.name ?? null, ref);
    assert.deepEqual(mine.matches.map(s => s.name), theirs.matches.map(s => s.name), ref);
  }
  // exactOnly (the provenance form) agrees too.
  assert.equal(resolveRefAmong(CORPUS, '01a070d2', true).session, null);
  assert.equal(resolveRefAmong(CORPUS, OMP_A, true).session.name, 'a');
});

test('CLI short refs match the server rule and resolve back', () => {
  const ids = CORPUS.map(s => s.id);
  for (const session of CORPUS) {
    const ref = shortSessionRef(session.id, ids);
    assert.equal(ref, H.shortSessionRef(session.id, ids), session.id);
    assert.equal(resolveRefAmong(CORPUS, ref, false).session.name, session.name, ref);
  }
  assert.equal(shortSessionRef(OMP_A, ids), '01a070d2');
  assert.deepEqual(sessionRefAliases(OMP_A), H.sessionRefAliases(OMP_A));
  assert.deepEqual(sessionRefAliases(PI_A), H.sessionRefAliases(PI_A));
  // The printable form agrees too, including its refusal to shorten an id
  // that has no second identifier to name.
  const legacy = ['2026-08-20T10-00-00-aaaa1111', '2026-08-21T10-00-00-bbbb2222'];
  for (const id of [...ids, ...legacy]) {
    const peers = [...ids, ...legacy];
    assert.equal(stableSessionRef(id, peers), H.stableSessionRef(id, peers), id);
  }
  assert.equal(stableSessionRef(legacy[0], legacy), legacy[0]);
});
