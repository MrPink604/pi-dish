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
const sessionFiles = require('../lib/session-files.js');
const { encodeSessionKey } = require('../lib/session-key.js');

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

test('OMP candidates retain their combined model in indexed usage', () => {
  const file = writeSession([
    { type: 'title', title: 'OMP usage' },
    { type: 'session', id: 'omp-usage', cwd: '/omp' },
    { type: 'model_change', model: 'anthropic/claude-omp' },
    { type: 'message', timestamp: '2026-07-01T10:00:02.000Z', message: {
      role: 'assistant', content: [], usage: { input: 5, output: 2 },
    } },
  ]);
  const candidate = {
    file,
    harnessId: 'omp',
    nativeSessionId: 'omp-usage',
    sessionKey: encodeSessionKey('omp', 'omp-usage'),
    profileId: 'omp-v1',
    profileVersion: 1,
  };

  const { infos, indexing } = index.scanSessions([candidate]);
  assert.equal(indexing, false);
  const usage = infos.get(file).usage;
  assert.ok(usage.models['anthropic/claude-omp']);
  assert.equal(usage.models['unknown/unknown'], undefined);
});

test('index persists: a zero-budget scan after state reset still serves entries', () => {
  const file = writeSession([
    { type: 'session', id: 'persisted-core-id', cwd: '/proj', parentSession: '/sessions/native-parent.jsonl' },
    userMsg('persisted needle'),
  ]);
  index.scanSessions([file]);
  index.resetForTests(); // flushes logs, drops all in-memory state

  assert.ok(fs.existsSync(path.join(indexDir, 'meta.ndjson')), 'meta log written');
  assert.ok(fs.existsSync(path.join(indexDir, 'text.ndjson')), 'text log written');

  const { infos, indexing } = withBudget(0, () => index.scanSessions([file]));
  assert.equal(indexing, false, 'nothing left to index after reload');
  assert.equal(infos.get(file).messageCount, 1, 'served from disk, not re-parsed');
  assert.equal(infos.get(file).sessionId, 'persisted-core-id', 'core header id persisted');
  assert.equal(infos.get(file).parentSession, '/sessions/native-parent.jsonl', 'native lineage persisted');
  assert.ok(infos.get(file).lastActivity instanceof Date, 'lastActivity revived as Date');
  assert.ok(index.getSearchText(file).includes('persisted needle'), 'search text survived too');
});

test('versionless metadata is queued for reindex instead of being served stale', async () => {
  const file = writeSession([
    userMsg('fresh metadata'),
    { type: 'message', timestamp: '2026-07-01T10:00:02.000Z', message: {
      role: 'assistant', content: [], usage: { output: 5, cost: { total: 0.01 } },
    } },
  ]);
  const stats = fs.statSync(file);
  index.resetForTests();
  fs.mkdirSync(indexDir, { recursive: true });
  fs.appendFileSync(path.join(indexDir, 'meta.ndjson'), JSON.stringify({
    f: file, m: stats.mtimeMs, s: stats.size,
    v: { name: 'stale metadata', messageCount: 999, lastActivity: '2020-01-01T00:00:00.000Z' },
  }) + '\n');

  const first = withBudget(0, () => index.scanSessions([file]));
  assert.equal(first.infos.has(file), false, 'old schema is not served as current telemetry');
  assert.equal(first.indexing, true);
  await waitFor(() => withBudget(0, () => index.scanSessions([file])).indexing === false,
    'schema migration reindex');
  const fresh = withBudget(0, () => index.scanSessions([file])).infos.get(file);
  assert.equal(fresh.name, 'fresh metadata');
  assert.equal(fresh.messageCount, 1);
  assert.equal(fresh.usage.total.costs.total, 0.01);
});

test('schema-3 zero-filled usage migrates through the bounded reindex backlog', async () => {
  const file = writeSession([
    userMsg('cost availability source'),
    { type: 'message', timestamp: '2026-07-01T10:00:02.000Z', message: {
      role: 'assistant', provider: 'test', model: 'total-only', content: [],
      usage: { input: 5, output: 2, cost: { total: 0.25 } },
    } },
  ]);
  const stats = fs.statSync(file);
  index.resetForTests();
  fs.mkdirSync(indexDir, { recursive: true });
  fs.appendFileSync(path.join(indexDir, 'meta.ndjson'), JSON.stringify({
    f: file, m: stats.mtimeMs, s: stats.size, ver: 3,
    v: {
      name: 'stale zero-filled metadata', messageCount: 1, lastActivity: '2026-07-01T10:00:02.000Z',
      usage: { total: { calls: 1, costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 } } },
    },
  }) + '\n');
  fs.appendFileSync(path.join(indexDir, 'text.ndjson'), JSON.stringify({
    f: file, m: stats.mtimeMs, s: stats.size, ver: 1, nl: 1, t: 'cost availability source',
  }) + '\n');

  const first = withBudget(0, () => index.scanSessions([file]));
  assert.equal(first.infos.has(file), false, 'schema-3 metadata is never served with false zeros');
  assert.equal(first.indexing, true, 'migration honors the synchronous reindex budget');
  await waitFor(() => withBudget(0, () => index.scanSessions([file])).indexing === false,
    'cost availability schema migration');
  const fresh = withBudget(0, () => index.scanSessions([file])).infos.get(file);
  assert.deepEqual(fresh.usage.total.costs,
    { input: null, output: null, cacheRead: null, cacheWrite: null, total: 0.25 });
  assert.deepEqual(fresh.usage.total.costUnavailable,
    { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, total: 0 });

  index.resetForTests();
  const persisted = withBudget(0, () => index.scanSessions([file]));
  assert.equal(persisted.indexing, false, 'rebuilt current-schema metadata persists');
  assert.equal(persisted.infos.get(file).usage.total.costs.input, null);
});

test('schema-5 ZAI plan usage is reindexed instead of remaining falsely free', async () => {
  const file = writeSession([
    userMsg('zai cost source'),
    { type: 'message', timestamp: '2026-07-01T10:00:02.000Z', message: {
      role: 'assistant', provider: 'zai', model: 'glm-5.2', content: [],
      usage: { input: 400, output: 38, totalTokens: 438,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } },
  ]);
  const stats = fs.statSync(file);
  index.resetForTests();
  fs.mkdirSync(indexDir, { recursive: true });
  fs.appendFileSync(path.join(indexDir, 'meta.ndjson'), JSON.stringify({
    f: file, m: stats.mtimeMs, s: stats.size, ver: 5,
    v: {
      name: 'stale free ZAI usage', messageCount: 1, lastActivity: '2026-07-01T10:00:02.000Z',
      usage: { total: { calls: 1, costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
    },
  }) + '\n');
  fs.appendFileSync(path.join(indexDir, 'text.ndjson'), JSON.stringify({
    f: file, m: stats.mtimeMs, s: stats.size, ver: 1, nl: 1, t: 'zai cost source',
  }) + '\n');

  const first = withBudget(0, () => index.scanSessions([file]));
  assert.equal(first.infos.has(file), false, 'schema-5 false-zero telemetry is not served');
  assert.equal(first.indexing, true);
  await waitFor(() => withBudget(0, () => index.scanSessions([file])).indexing === false,
    'ZAI pricing schema migration');
  const fresh = withBudget(0, () => index.scanSessions([file])).infos.get(file);
  assert.equal(fresh.usage.total.costs.total, null);
  assert.equal(fresh.usage.total.costUnavailable.total, 1);
});

test('versionless search text migrates through the bounded indexing backlog', async () => {
  const file = writeSession([userMsg('fresh searchable text')]);
  const stats = fs.statSync(file);
  index.resetForTests();
  fs.mkdirSync(indexDir, { recursive: true });
  fs.appendFileSync(path.join(indexDir, 'meta.ndjson'), JSON.stringify({
    f: file, m: stats.mtimeMs, s: stats.size, ver: 4,
    v: { name: 'fresh searchable text', messageCount: 1, lastActivity: '2026-07-01T10:00:00.000Z' },
  }) + '\n');
  fs.appendFileSync(path.join(indexDir, 'text.ndjson'), JSON.stringify({
    f: file, m: stats.mtimeMs, s: stats.size, nl: 1, t: 'stale schema text',
  }) + '\n');

  const first = withBudget(0, () => index.scanSessions([file]));
  assert.equal(first.infos.has(file), false, 'old text schema is not paired with current metadata');
  assert.equal(first.indexing, true, 'migration honors the zero synchronous budget');
  await waitFor(() => withBudget(0, () => index.scanSessions([file])).indexing === false,
    'search schema migration reindex');
  const text = index.getSearchText(file);
  assert.ok(text.includes('fresh searchable text'));
  assert.ok(!text.includes('stale schema text'));
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

test('the byte-range extension honors the session text cap, keeping the newest', () => {
  const big = 'y'.repeat(99_000);
  const entries = [];
  for (let i = 0; i < 45; i++) entries.push(userMsg(`cap${i} ${big}`));
  const file = writeSession(entries);
  const built = index.getSearchText(file);
  assert.ok(built.length <= sessionFiles.SEARCH_TEXT_SESSION_CAP);
  assert.ok(!built.includes('cap0 '), 'the oldest text was evicted at build time');

  fs.appendFileSync(file, JSON.stringify(userMsg('overflow_marker_zulu')) + '\n');
  const extended = index.getSearchText(file);
  assert.ok(extended.length <= sessionFiles.SEARCH_TEXT_SESSION_CAP,
    'a streaming append cannot grow the text past the cap one delta at a time');
  assert.ok(extended.includes('overflow_marker_zulu'),
    'the appended (newest) turn is searchable; overflow evicts old text instead');

  // Drop the cap-sized entry so later tests' live-size expectations for the
  // shared text log hold.
  fs.rmSync(file);
  index.scanSessions([]);
});

test('a pre-v2 text entry is re-indexed to pick up tool-call args', () => {
  const file = writeSession([
    userMsg('plain prose'),
    { type: 'message', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 't1', name: 'bash',
        arguments: { command: 'grep migration_needle lib/x.js' } },
    ] } },
  ]);
  assert.ok(index.getSearchText(file).includes('migration_needle'));
  index.resetForTests(); // flush the logs so the downgrade below edits real state

  // Rewrite this file's persisted text entry as a v1 line: no tool-call text,
  // old schema version. The next scan must treat it as stale and re-derive.
  const textLog = path.join(indexDir, 'text.ndjson');
  fs.writeFileSync(textLog, fs.readFileSync(textLog, 'utf-8').split('\n').map(line => {
    if (!line || !line.includes(JSON.stringify(file))) return line;
    const obj = JSON.parse(line);
    obj.ver = 1;
    obj.t = 'plain prose';
    return JSON.stringify(obj);
  }).join('\n'));

  index.resetForTests();
  withBudget(1, () => index.scanSessions([file]));
  assert.ok(index.getSearchText(file).includes('migration_needle'),
    'the stale-version entry was rebuilt with the v2 extraction');
});

test('getSearchText rebuilds when an append changes the active tree branch', () => {
  const treeMsg = (id, parentId, role, text) => ({
    type: 'message', id, parentId,
    message: { role, content: [{ type: 'text', text }] },
  });
  const file = writeSession([
    { type: 'session', version: 3, id: 'session-tree', cwd: '/p' },
    treeMsg('e1', null, 'user', 'root prompt'),
    treeMsg('e2', 'e1', 'assistant', 'root answer'),
    treeMsg('e3', 'e2', 'user', 'SECRET_ABANDONED prompt'),
    treeMsg('e4', 'e3', 'assistant', 'SECRET_ABANDONED answer'),
  ]);

  assert.ok(index.getSearchText(file).includes('secret_abandoned'),
    'the original leaf is searchable before navigation');
  fs.appendFileSync(file, [
    { type: 'branch_summary', id: 'bs1', parentId: 'e2', fromId: 'e2', summary: 'tried another route' },
    treeMsg('e5', 'bs1', 'user', 'authoritative retry'),
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');

  const text = index.getSearchText(file);
  const transcript = sessionFiles.readSessionMessages(file)
    .map(message => message.content[0].text.toLowerCase());
  assert.ok(!text.includes('secret_abandoned'), 'abandoned branch text is discarded');
  assert.ok(transcript.every(part => text.includes(part)),
    `indexed text agrees with the active transcript: ${transcript.join(', ')}`);

  index.resetForTests();
  const persisted = withBudget(0, () => index.scanSessions([file]));
  assert.equal(persisted.indexing, false, 'rebuilt branch-aware text was persisted');
  assert.ok(!index.getSearchText(file).includes('secret_abandoned'));
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

test('skills.ndjson persists: a zero-budget scan serves mined activations from disk', () => {
  const SKILL = path.join(tmpHome, '.pi', 'agent', 'skills', 'demo', 'SKILL.md');
  index.setSkillRoots([SKILL]);
  const file = writeSession([
    { type: 'session', cwd: '/home/u/proj', timestamp: '2026-07-20T10:00:00.000Z' },
    { type: 'model_change', provider: 'anthropic', modelId: 'claude-x' },
    { type: 'message', id: 'r1', timestamp: '2026-07-20T10:00:01.000Z', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'tc1', name: 'read', arguments: { path: SKILL, offset: 1, limit: 30 } },
    ] } },
  ]);
  index.scanSessions([file]);
  index.resetForTests(); // flush + drop in-memory state

  assert.ok(fs.existsSync(path.join(indexDir, 'skills.ndjson')), 'skills log written');

  // Zero-budget scan can't parse JSONL — records must come from disk.
  const { indexing } = withBudget(0, () => index.scanSessions([file]));
  assert.equal(indexing, false, 'nothing left to index after reload');
  const recs = index.getSkillActivations({ skill: SKILL });
  assert.equal(recs.length, 1, 'activation served from persisted skills.ndjson');
  assert.equal(recs[0].kind, 'read');
  assert.deepEqual(recs[0].ranges, [[1, 30]]);
  assert.equal(recs[0].model, 'anthropic/claude-x');

  // Filters honored against the persisted records.
  assert.equal(index.getSkillActivations({ skill: SKILL, kind: 'targeted' }).length, 0);
  assert.equal(index.getSkillActivations({ skill: SKILL, cwd: '/home/u/proj' }).length, 1);
  assert.equal(index.getSkillActivations({ skill: SKILL, sinceMs: Date.parse('2027-01-01') }).length, 0);
});

test('append extension matches a full re-index (meta, usage, text, skills)', () => {
  // The O(delta) extension (tryExtendIndexEntry) must be observationally
  // identical to throwing the index away and re-parsing the whole file.
  const SKILL = path.join(tmpHome, '.pi', 'agent', 'skills', 'eq', 'SKILL.md');
  index.setSkillRoots([SKILL]);
  const base = [
    { type: 'session', id: 'sess-eq', cwd: '/home/u/proj', timestamp: '2026-07-01T09:00:00.000Z' },
    { type: 'model_change', provider: 'anthropic', modelId: 'claude-a' },
    userMsg('base question'),
    { type: 'message', timestamp: '2026-07-01T10:00:02.000Z', message: {
      role: 'assistant', content: [{ type: 'text', text: 'base answer' }],
      usage: { input: 100, output: 20, cacheRead: 5, totalTokens: 12000 },
    } },
  ];
  const delta = [
    { type: 'model_change', provider: 'openai', modelId: 'gpt-b' },
    userMsg('appended question'),
    { type: 'message', timestamp: '2026-07-02T11:00:00.000Z', message: {
      role: 'assistant', content: [{ type: 'text', text: 'appended answer' }],
      usage: { input: 50, output: 9, totalTokens: 15000 },
    } },
    { type: 'message', timestamp: '2026-07-02T11:00:01.000Z', message: {
      role: 'assistant', content: [
        { type: 'toolCall', id: 'tc9', name: 'read', arguments: { path: SKILL, offset: 2, limit: 8 } },
      ],
      usage: { input: 1, output: 1, totalTokens: 15100 },
    } },
  ];

  const fileA = writeSession(base);
  index.scanSessions([fileA]);
  fs.appendFileSync(fileA, delta.map(e => JSON.stringify(e)).join('\n') + '\n');
  // Structural proof this went through the extension: a zero-budget scan is
  // forbidden from re-parsing the file synchronously.
  const extended = withBudget(0, () => index.scanSessions([fileA]));
  assert.equal(extended.indexing, false, 'appended file served without sync budget');
  const extInfo = extended.infos.get(fileA);

  const fileB = writeSession(base.concat(delta));
  const fullInfo = index.scanSessions([fileB]).infos.get(fileB);

  for (const key of ['model', 'name', 'messageCount', 'contextTokens', 'cwd', 'sessionId', 'parentSession']) {
    assert.deepEqual(extInfo[key], fullInfo[key], `info.${key} matches full re-index`);
  }
  assert.deepEqual(extInfo.usage, fullInfo.usage, 'usage (totals, days, models, continuity state) matches');
  assert.equal(index.getSearchText(fileA), index.getSearchText(fileB), 'search text matches');

  const stripSession = (r) => { const { sessionId, ...rest } = r; return rest; };
  const recsA = index.getSkillActivations({ skill: SKILL }).filter(r => r.sessionId === path.basename(fileA, '.jsonl'));
  const recsB = index.getSkillActivations({ skill: SKILL }).filter(r => r.sessionId === path.basename(fileB, '.jsonl'));
  assert.equal(recsA.length, 1, 'appended skill activation mined through the extension');
  assert.deepEqual(recsA.map(stripSession), recsB.map(stripSession), 'skill records match full re-index');
});

test('getSessionInfo serves the session-files shape and extends on append', () => {
  const file = writeSession([
    { type: 'session', id: 'sess-info', cwd: '/home/u/proj' },
    { type: 'model_change', provider: 'anthropic', modelId: 'claude-a' },
    userMsg('first'),
  ]);
  const before = index.getSessionInfo(file);
  assert.deepEqual(before, sessionFiles.getSessionInfo(file), 'matches session-files on first index');

  fs.appendFileSync(file, JSON.stringify(userMsg('second')) + '\n');
  const after = index.getSessionInfo(file);
  assert.deepEqual(after, sessionFiles.getSessionInfo(file), 'matches session-files after append');
  assert.equal(after.messageCount, before.messageCount + 1);
  // Index-internal fields must not leak into API responses that spread info.
  for (const internal of ['usage', 'sessionKey', 'harnessId', 'nativeSessionId', 'profileId', 'profileVersion']) {
    assert.ok(!(internal in after), `${internal} stripped from public info`);
  }

  assert.throws(() => index.getSessionInfo(path.join(sessionsDir, 'missing.jsonl')),
    'unreadable file throws like session-files.getSessionInfo');
});

test('an index populated before skills mining re-mines its files (upgrade path)', () => {
  // A pre-skills pi-dish build left meta/text current but no skills entries.
  // The staleness check must treat those files as stale, or a machine with an
  // existing index reports zero skill usage for its whole historical corpus.
  const SKILL = path.join(tmpHome, '.pi', 'agent', 'skills', 'demo', 'SKILL.md');
  const file = writeSession([
    { type: 'session', cwd: '/home/u/proj', timestamp: '2026-07-20T10:00:00.000Z' },
    { type: 'message', id: 'r1', timestamp: '2026-07-20T10:00:01.000Z', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'tc1', name: 'read', arguments: { path: SKILL, offset: 5, limit: 10 } },
    ] } },
  ]);
  index.scanSessions([file]);
  index.resetForTests(); // flush everything to disk

  // Simulate the pre-skills index: meta/text logs exist, skills log doesn't.
  fs.rmSync(path.join(indexDir, 'skills.ndjson'));

  // Budgeted scan: meta/text are current, but the missing skills entry makes
  // the file stale, so it re-parses and re-mines.
  const { indexing } = index.scanSessions([file]);
  assert.equal(indexing, false);
  const recs = index.getSkillActivations({ skill: SKILL });
  assert.equal(recs.length, 1, 'historical file was re-mined despite current meta/text');
  assert.deepEqual(recs[0].ranges, [[5, 14]]);
});
