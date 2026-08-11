const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { discoverSessionCandidates, findSessionCandidate, readSessionHeader } = require('../lib/session-discovery');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-discovery-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function write(file, header) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(header) + '\n');
}

test('discovers traditional and nested generic Pi sessions with compatible identities', () => {
  const sessions = path.join(root, 'sessions-a');
  const workspace = path.join(sessions, '--workspace--');
  write(path.join(workspace, '2026-01-01_parent.jsonl'), { type: 'session', id: 'core-parent', cwd: '/workspace' });
  write(path.join(workspace, '2026-01-01_parent', 'scope', 'run-0', 'session.jsonl'), {
    type: 'session', id: 'core-child', cwd: '/workspace', parentSession: path.join(workspace, '2026-01-01_parent.jsonl'),
  });
  write(path.join(workspace, 'bad', 'session.jsonl'), { type: 'message', id: 'not-a-header' });
  write(path.join(workspace, 'scope', 'events.jsonl'), { type: 'session', id: 'not-a-session-artifact' });

  const result = discoverSessionCandidates(sessions);
  assert.deepEqual(result.candidates.map(c => c.id), ['2026-01-01_parent', 'core-child']);
  assert.equal(result.truncated, false);
  const child = result.candidates.find(c => c.id === 'core-child');
  assert.equal(child.depth, 3);
  assert.equal(readSessionHeader(child.file).parentSession, path.join(workspace, '2026-01-01_parent.jsonl'));
  assert.equal(findSessionCandidate(sessions, 'core-child', { allowPartial: false }).candidate.file, child.file);
});

test('bounded discovery skips over-depth directories, symlinks, and reports caps', () => {
  const sessions = path.join(root, 'sessions-b');
  const workspace = path.join(sessions, '--workspace--');
  write(path.join(workspace, 'one.jsonl'), { type: 'session', id: 'one' });
  write(path.join(workspace, 'a', 'b', 'session.jsonl'), { type: 'session', id: 'deep' });
  const outside = path.join(root, 'outside');
  write(path.join(outside, 'session.jsonl'), { type: 'session', id: 'linked' });
  fs.mkdirSync(workspace, { recursive: true });
  try { fs.symlinkSync(outside, path.join(workspace, 'linked'), 'dir'); } catch {}

  const shallow = discoverSessionCandidates(sessions, { maxDepth: 1 });
  assert.deepEqual(shallow.candidates.map(c => c.id), ['one']);
  const capped = discoverSessionCandidates(sessions, { maxFiles: 1 });
  assert.equal(capped.candidates.length, 1);
  assert.equal(capped.truncated, true);
  const entryCapped = discoverSessionCandidates(sessions, { maxEntries: 1 });
  assert.equal(entryCapped.truncated, true);
  assert.equal(capped.candidates.some(c => c.id === 'linked'), false);
});

test('generic header cache reuses positive and negative results', () => {
  const sessions = path.join(root, 'sessions-cache');
  const workspace = path.join(sessions, '--workspace--');
  write(path.join(workspace, 'a', 'session.jsonl'), { type: 'session', id: 'cached-good' });
  write(path.join(workspace, 'b', 'session.jsonl'), { type: 'message', id: 'cached-negative' });
  const oversized = path.join(workspace, 'c', 'session.jsonl');
  fs.mkdirSync(path.dirname(oversized), { recursive: true });
  fs.writeFileSync(oversized, JSON.stringify({ type: 'session', id: 'x'.repeat(20 * 1024) }) + '\n');
  discoverSessionCandidates(sessions);

  const originalOpen = fs.openSync;
  let opens = 0;
  fs.openSync = (...args) => { opens += 1; return originalOpen(...args); };
  try {
    discoverSessionCandidates(sessions);
  } finally {
    fs.openSync = originalOpen;
  }
  assert.equal(opens, 0, 'unchanged generic headers are not reopened on the next scan');
});

test('generic session header ids are path-safe and duplicate ids are not routable', () => {
  const sessions = path.join(root, 'sessions-c');
  const workspace = path.join(sessions, '--workspace--');
  write(path.join(workspace, 'z', 'session.jsonl'), { type: 'session', id: '../escape' });
  write(path.join(workspace, 'b', 'session.jsonl'), { type: 'session', id: 'same' });
  write(path.join(workspace, 'a', 'session.jsonl'), { type: 'session', id: 'same' });
  const result = discoverSessionCandidates(sessions);
  assert.equal(result.candidates.length, 0, 'unsafe and ambiguous native identities are omitted');
  assert.equal(findSessionCandidate(sessions, 'same', { allowPartial: false }).candidate, null);
});

test('invalid basename identities are skipped and warned once without aborting discovery', () => {
  const sessions = path.join(root, 'sessions-invalid-basename');
  const workspace = path.join(sessions, '--workspace--');
  write(path.join(workspace, 'valid-session.jsonl'), { type: 'session', cwd: '/workspace' });
  write(path.join(workspace, '2026-01-01T00-00-00+00-00_deadbeef.jsonl'), { type: 'session', cwd: '/workspace' });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const first = discoverSessionCandidates(sessions);
    assert.deepEqual(first.candidates.map(c => c.id), ['valid-session']);
    assert.equal(first.skipped, 1);
    assert.equal(first.truncated, false);
    assert.equal(discoverSessionCandidates(sessions).skipped, 1, 'each scan reports its skipped count');
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, 'a repeatedly scanned alien file does not spam logs');
  assert.match(warnings[0], /skipping invalid pi identity/);
});
