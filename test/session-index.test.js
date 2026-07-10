/**
 * Unit tests for lib/session-index.js — the persistent (mtimeMs, size) index
 * behind the historical session scan and server-side list search.
 *
 * The structural persistence proof used throughout: scans with
 * PI_DISH_INDEX_SYNC_BUDGET=0 are forbidden from parsing anything
 * synchronously, so any entry they serve can only have come from the
 * persisted NDJSON (or a finished background build).
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-idx-'));
process.env.HOME = tmpHome;

const index = require('../lib/session-index.js');

const sessionsDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--proj--');
fs.mkdirSync(sessionsDir, { recursive: true });
const indexDir = path.join(tmpHome, '.pi', 'dish', 'session-index');

test.after(() => {
  index.resetForTests();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

let fileSeq = 0;
function writeSession(entries) {
  const file = path.join(sessionsDir, `sess-${fileSeq++}.jsonl`);
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const userMsg = (text) =>
  ({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }], timestamp: '2026-07-01T10:00:00.000Z' } });

function withBudget(n, fn) {
  process.env.PI_DISH_INDEX_SYNC_BUDGET = String(n);
  try { return fn(); } finally { delete process.env.PI_DISH_INDEX_SYNC_BUDGET; }
}

async function waitFor(cond, what, ms = 2000) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 10));
  }
}

test('scanSessions indexes files and revalidates on append', () => {
  const file = writeSession([userMsg('first question')]);
  let { infos, indexing } = index.scanSessions([file]);
  assert.equal(indexing, false);
  assert.equal(infos.get(file).messageCount, 1);
  assert.equal(infos.get(file).name, 'first question');

  fs.appendFileSync(file, JSON.stringify(userMsg('second question')) + '\n');
  ({ infos } = index.scanSessions([file]));
  assert.equal(infos.get(file).messageCount, 2, 'appended file re-indexed');
});

test('index persists: a zero-budget scan after state reset still serves entries', () => {
  const file = writeSession([userMsg('persisted needle')]);
  index.scanSessions([file]);
  index.resetForTests(); // flushes logs, drops all in-memory state

  assert.ok(fs.existsSync(path.join(indexDir, 'meta.ndjson')), 'meta log written');
  assert.ok(fs.existsSync(path.join(indexDir, 'text.ndjson')), 'text log written');

  const { infos, indexing } = withBudget(0, () => index.scanSessions([file]));
  assert.equal(indexing, false, 'nothing left to index after reload');
  assert.equal(infos.get(file).messageCount, 1, 'served from disk, not re-parsed');
  assert.ok(infos.get(file).lastActivity instanceof Date, 'lastActivity revived as Date');
  assert.ok(index.getSearchText(file).includes('persisted needle'), 'search text survived too');
});

test('zero sync budget queues a backlog that the background build drains', async () => {
  const files = [writeSession([userMsg('aaa')]), writeSession([userMsg('bbb')])];
  const first = withBudget(0, () => index.scanSessions(files));
  assert.equal(first.infos.size, 0, 'nothing indexed synchronously');
  assert.equal(first.indexing, true);

  await waitFor(() => withBudget(0, () => index.scanSessions(files)).indexing === false,
    'background build to drain');
  const { infos } = withBudget(0, () => index.scanSessions(files));
  assert.equal(infos.size, 2, 'background build indexed the backlog');
});

test('sync budget bounds per-scan parsing; the rest lands via the builder', async () => {
  const files = Array.from({ length: 5 }, (_, i) => writeSession([userMsg(`msg ${i}`)]));
  const first = withBudget(2, () => index.scanSessions(files));
  assert.equal(first.infos.size, 2, 'exactly budget files parsed in-line');
  assert.equal(first.indexing, true);
  await waitFor(() => withBudget(0, () => index.scanSessions(files)).indexing === false,
    'builder to finish the remaining files');
  assert.equal(withBudget(0, () => index.scanSessions(files)).infos.size, 5);
});

test('getSearchText extends from the appended byte range', () => {
  const file = writeSession([userMsg('alpha bravo')]);
  assert.ok(index.getSearchText(file).includes('alpha bravo'));

  fs.appendFileSync(file, JSON.stringify(userMsg('charlie delta')) + '\n');
  const text = index.getSearchText(file);
  assert.ok(text.includes('alpha bravo'), 'old text kept');
  assert.ok(text.includes('charlie delta'), 'appended text searchable immediately');

  // A rewritten (shrunk) file falls back to a full re-index.
  fs.writeFileSync(file, JSON.stringify(userMsg('echo only')) + '\n');
  const rewritten = index.getSearchText(file);
  assert.ok(rewritten.includes('echo only'));
  assert.ok(!rewritten.includes('charlie'), 'stale text dropped on rewrite');

  assert.equal(index.getSearchText(path.join(sessionsDir, 'missing.jsonl')), '',
    'missing file degrades to empty');
});

test('deleted session files are dropped from the index', () => {
  const file = writeSession([userMsg('doomed')]);
  index.scanSessions([file]);
  fs.rmSync(file);
  const { infos } = index.scanSessions([]);
  assert.ok(!infos.has(file));
  index.resetForTests();
  const after = withBudget(0, () => index.scanSessions([]));
  assert.equal(after.infos.size, 0);
  assert.equal(index.getSearchText(file), '', 'tombstone survived the reload');
});

test('log compaction keeps the text log near its live size', () => {
  // ~50KB of searchable text per index pass; re-index enough times that dead
  // lines cross the compaction threshold (dead > 1MB and dead > live).
  const big = Array.from({ length: 100 }, (_, i) => userMsg(`filler ${i} ` + 'y'.repeat(480)));
  const file = writeSession(big);
  index.scanSessions([file]);
  for (let i = 0; i < 45; i++) {
    fs.appendFileSync(file, JSON.stringify(userMsg(`update ${i}`)) + '\n');
    index.scanSessions([file]);
  }
  index.resetForTests(); // flush pending appends
  const logSize = fs.statSync(path.join(indexDir, 'text.ndjson')).size;
  assert.ok(logSize < 500_000,
    `text log should be compacted near one live entry (~50KB), got ${logSize}`);
  // And the compacted log still round-trips.
  const { infos } = withBudget(0, () => index.scanSessions([file]));
  assert.equal(infos.get(file).messageCount, 145);
});
