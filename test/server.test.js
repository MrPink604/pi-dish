/**
 * API tests for server.js against a fixture session JSONL.
 *
 * HOME is pointed at a temp dir before the server module loads, so both the
 * historical-session scan (~/.pi/agent/sessions) and the bridge registry
 * (~/.pi/dish/sessions) read from the fixture instead of the real machine.
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-test-'));
process.env.HOME = tmpHome;
process.env.PORT = '0'; // random free port
// The runtime pid-fallback (describeRuntime → findPaneByPid) scans every tmux
// server under the tmpdir; point it at an empty temp dir so a tmux session
// enclosing `npm test` can't leak into the runtime assertions below.
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-test-tmux-'));

const SESSION_ID = '2026-07-04T10-00-00-abcdef12';
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, 'base64');
const sessionDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-proj--');
fs.mkdirSync(sessionDir, { recursive: true });

const entries = [
  { type: 'session', cwd: '/home/user/proj', timestamp: '2026-07-04T10:00:00.000Z' },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hello alpha' }], timestamp: '2026-07-04T10:00:01.000Z' } },
  { type: 'message', message: { role: 'assistant', content: [
    { type: 'text', text: 'bravo reply with **markdown**' },
    { type: 'toolCall', id: 'tc1', name: 'Bash', arguments: { command: 'ls' } },
  ], usage: { input: 100, output: 40, cacheRead: 10, cacheWrite: 5, totalTokens: 1234, cost: { total: 0.03 } }, timestamp: '2026-07-04T10:00:02.000Z' } },
  { type: 'message', message: { role: 'toolResult', content: [
    { type: 'text', text: 'charlie output' },
    { type: 'image', data: TINY_PNG_BASE64, mimeType: 'image/png' },
  ], timestamp: '2026-07-04T10:00:03.000Z' } },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'delta question alpha' }], timestamp: '2026-07-04T10:00:04.000Z' } },
  // The last assistant entry carries an entry id (per-message share links)
  // and real response timing: message.timestamp = start (ms epoch),
  // entry timestamp = end → 2s for 60 output tokens.
  { type: 'message', id: 'ent5', timestamp: '2026-07-04T10:00:05.000Z', message: { role: 'assistant', provider: 'test', model: 'selected-model', responseModel: 'routed-model', content: [{ type: 'text', text: 'echo final' }], usage: { input: 200, output: 60, cacheRead: 0, cacheWrite: 0, totalTokens: 1234, providerRaw: 'do not expose', cost: { total: 0.02, providerRaw: 99 } }, timestamp: Date.parse('2026-07-04T10:00:03.000Z') } },
];
const SESSION_FILE = path.join(sessionDir, `${SESSION_ID}.jsonl`);
fs.writeFileSync(SESSION_FILE, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

// Repetitive but realistically large chat payload for wire-size assertions.
// Kept in its own session so cursor/count tests on SESSION_ID stay stable.
const BANDWIDTH_ID = '2026-07-04T10-30-00-bandwidth';
fs.writeFileSync(path.join(sessionDir, `${BANDWIDTH_ID}.jsonl`), [
  { type: 'session', cwd: '/home/user/proj', timestamp: '2026-07-04T10:30:00.000Z' },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'measure chat transfer' }], timestamp: '2026-07-04T10:30:01.000Z' } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: ('repeated transcript content '.repeat(2500)) }], timestamp: '2026-07-04T10:30:02.000Z' } },
].map(e => JSON.stringify(e)).join('\n') + '\n');

// Second fixture whose cwd exists on disk — exercises /files fuzzy search
// and the /file mention viewer (tool calls referencing a deep file plus a
// scratch file outside the cwd; secret.txt sits outside the session's reach).
const REAL_CWD_ID = '2026-07-04T11-00-00-bbccdd34';
const realCwd = path.join(tmpHome, 'workspace', 'proj-alpha');
const deepDir = path.join(realCwd, 'deep', 'nest');
const scratchDir = path.join(tmpHome, 'scratch');
fs.mkdirSync(path.join(realCwd, 'src'), { recursive: true });
fs.mkdirSync(deepDir, { recursive: true });
fs.mkdirSync(scratchDir, { recursive: true });
fs.writeFileSync(path.join(realCwd, 'src', 'main.js'), 'console.log(1);\n');
fs.writeFileSync(path.join(realCwd, 'README.md'), '# alpha\n');
fs.writeFileSync(path.join(realCwd, 'preview.png'), TINY_PNG);
fs.writeFileSync(path.join(realCwd, 'large.md'), ('# repeated document\n\nbody text for compression\n'.repeat(3000)));
fs.writeFileSync(path.join(deepDir, 'findings.md'), '# deep findings\n');
fs.writeFileSync(path.join(scratchDir, 'notes.md'), 'scratch notes\n');
fs.writeFileSync(path.join(tmpHome, 'secret.txt'), 'outside the session reach\n');
fs.writeFileSync(
  path.join(sessionDir, `${REAL_CWD_ID}.jsonl`),
  [
    { type: 'session', cwd: realCwd, timestamp: '2026-07-04T11:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: '2026-07-04T11:00:01.000Z' } },
    { type: 'message', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'tw1', name: 'write', arguments: { path: path.join(deepDir, 'findings.md'), content: '# deep findings\n' } },
      { type: 'toolCall', id: 'tr1', name: 'read', arguments: { path: path.join(scratchDir, 'notes.md') } },
    ], timestamp: '2026-07-04T11:00:02.000Z' } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n',
);

// Third fixture: no cwd in the session header, in a dir whose name decodes to
// a nonexistent path — the lossy dir-name decode (every '-' → '/') must not
// be trusted as the cwd in that case.
const NO_CWD_ID = '2026-07-04T12-00-00-ccddeeff';
const bogusDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-my-hyphen-proj--');
fs.mkdirSync(bogusDir, { recursive: true });
fs.writeFileSync(
  path.join(bogusDir, `${NO_CWD_ID}.jsonl`),
  JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'headerless fixture' }], timestamp: '2026-07-04T12:00:01.000Z' } }) + '\n',
);

// Fourth fixture: a *valid pi v3 session* (header id + entry ids) — the tree
// branch endpoints open it through pi's own SessionManager, which rejects
// the id-less shorthand the other fixtures use.
const TREE_ID = '2026-07-04T14-00-00-treefix1';
const TREE_FILE = path.join(sessionDir, `${TREE_ID}.jsonl`);
fs.writeFileSync(TREE_FILE, [
  { type: 'session', version: 3, id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111', cwd: '/home/user/proj', timestamp: '2026-07-04T14:00:00.000Z' },
  { type: 'message', id: 'e1', parentId: null, timestamp: '2026-07-04T14:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'first prompt' }], timestamp: '2026-07-04T14:00:01.000Z' } },
  { type: 'message', id: 'e2', parentId: 'e1', timestamp: '2026-07-04T14:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }], timestamp: '2026-07-04T14:00:02.000Z' } },
  { type: 'message', id: 'e3', parentId: 'e2', timestamp: '2026-07-04T14:00:03.000Z', message: { role: 'user', content: [{ type: 'text', text: 'second prompt' }], timestamp: '2026-07-04T14:00:03.000Z' } },
  { type: 'message', id: 'e4', parentId: 'e3', timestamp: '2026-07-04T14:00:04.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'second answer' }], timestamp: '2026-07-04T14:00:04.000Z' } },
].map(e => JSON.stringify(e)).join('\n') + '\n');

const server = require('../server.js');

let base;
test.before(async () => {
  if (!server.listening) await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() };
};

const post = async (p, body) => {
  const res = await fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const put = async (p, body) => {
  const res = await fetch(base + p, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const del = async (p) => {
  const res = await fetch(base + p, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
};

// Node's fetch transparently decompresses response bodies. This lower-level
// helper keeps the wire bytes intact so compression ratios are meaningful.
const rawGet = (p, headers = {}) => new Promise((resolve, reject) => {
  const req = http.get(base + p, { headers }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
});

test('GET /api/sessions lists the fixture session with derived metadata', async () => {
  const { status, body } = await get('/api/sessions');
  assert.equal(status, 200);
  const sess = body.previous.find(s => s.id === SESSION_ID);
  assert.ok(sess, 'fixture session should be listed as previous');
  assert.equal(sess.isActive, false);
  assert.equal(sess.cwd, '/home/user/proj');
  assert.equal(sess.name, 'hello alpha'); // first user message
  assert.equal(sess.messageCount, 2); // user messages only
});

test('cwd falls back to the dir-name decode only when the decoded path exists', async () => {
  const { body } = await get('/api/sessions');
  const sess = body.previous.find(s => s.id === NO_CWD_ID);
  assert.ok(sess, 'headerless fixture should still be listed');
  assert.equal(sess.cwd, null, 'bogus decode (/home/user/my/hyphen/proj) must not be used as cwd');
});

test('GET /api/sessions?active=1 skips the historical scan', async () => {
  const { status, body } = await get('/api/sessions?active=1');
  assert.equal(status, 200);
  assert.deepEqual(body.previous, [], 'previous list omitted on active-only polls');
  assert.ok(Array.isArray(body.active));
});

test('GET /api/sessions?q= filters on message content', async () => {
  const hit = await get('/api/sessions?q=bravo');
  const sess = hit.body.previous.find(s => s.id === SESSION_ID);
  assert.ok(sess);
  // Content matches carry a snippet showing why the row is in the results…
  assert.ok(sess.searchSnippet.includes('bravo'), `snippet shows the hit: ${sess.searchSnippet}`);
  const miss = await get('/api/sessions?q=zzz-not-there');
  assert.ok(!miss.body.previous.some(s => s.id === SESSION_ID));

  // …metadata matches (name/cwd/model/id) don't need one.
  const byName = await get('/api/sessions?q=hello');
  const metaMatch = byName.body.previous.find(s => s.id === SESSION_ID);
  assert.ok(metaMatch, 'name match');
  assert.equal(metaMatch.searchSnippet, undefined);
});

test('GET /api/sessions?q= speaks the filter grammar: negation, fields, dates', async () => {
  // Negation is metadata-only: the fixture's *content* has "bravo", but the
  // metadata doesn't, so -bravo must NOT hide it.
  const negContent = await get(`/api/sessions?q=${encodeURIComponent('-bravo')}`);
  assert.ok(negContent.body.previous.some(s => s.id === SESSION_ID), 'content-only word must not exclude via negation');
  const negName = await get(`/api/sessions?q=${encodeURIComponent('-name:hello')}`);
  assert.ok(!negName.body.previous.some(s => s.id === SESSION_ID), 'name negation excludes');

  // Field terms scope to one field: "proj" is in the cwd, not the name.
  const byCwd = await get(`/api/sessions?q=${encodeURIComponent('cwd:proj')}`);
  assert.ok(byCwd.body.previous.some(s => s.id === SESSION_ID));
  const byWrongField = await get(`/api/sessions?q=${encodeURIComponent('name:proj')}`);
  assert.ok(!byWrongField.body.previous.some(s => s.id === SESSION_ID));

  // Date bounds run against lastActivity = max(file mtime, entry timestamps),
  // so pin a dedicated fixture's mtime to a known past date.
  const DATED_ID = '2026-06-15T09-00-00-datedfix';
  const datedFile = path.join(sessionDir, `${DATED_ID}.jsonl`);
  fs.writeFileSync(datedFile, [
    { type: 'session', cwd: '/home/user/proj', timestamp: '2026-06-15T09:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'dated fixture' }], timestamp: '2026-06-15T09:00:01.000Z' } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n');
  const datedAt = new Date('2026-06-15T09:00:01.000Z');
  fs.utimesSync(datedFile, datedAt, datedAt);
  const inRange = await get(`/api/sessions?q=${encodeURIComponent('dated since:2026-06-01 before:2026-07-01')}`);
  assert.ok(inRange.body.previous.some(s => s.id === DATED_ID));
  const tooOld = await get(`/api/sessions?q=${encodeURIComponent('dated since:2026-07-01')}`);
  assert.ok(!tooOld.body.previous.some(s => s.id === DATED_ID));

  // Combined: a content term plus a negation still yields a snippet.
  const combo = await get(`/api/sessions?q=${encodeURIComponent('bravo -name:zzz')}`);
  const sess = combo.body.previous.find(s => s.id === SESSION_ID);
  assert.ok(sess?.searchSnippet?.includes('bravo'), 'snippet from the positive term');
});

test('GET /api/search returns flat results with multi-snippets and match counts', async () => {
  // "alpha" occurs in the fixture's name AND twice in its content ("hello
  // alpha", "delta question alpha") — a metadata match still carries content
  // snippets so the count is honest.
  const { status, body } = await get('/api/search?q=alpha');
  assert.equal(status, 200);
  assert.equal(typeof body.indexing, 'boolean');
  assert.ok(body.total >= 1);
  const sess = body.results.find(s => s.id === SESSION_ID);
  assert.ok(sess, 'fixture session in results');
  assert.ok(sess.matchCount >= 2, `content occurrences counted (got ${sess.matchCount})`);
  assert.ok(sess.snippets.length >= 1 && sess.snippets.every(s => s.includes('alpha')),
    'every snippet shows the token');

  // Pure metadata query (no positive plain term): matches carry no snippets.
  const byCwd = await get(`/api/search?q=${encodeURIComponent('cwd:proj')}`);
  const metaSess = byCwd.body.results.find(s => s.id === SESSION_ID);
  assert.ok(metaSess);
  assert.deepEqual(metaSess.snippets, []);
  assert.equal(metaSess.matchCount, 0);

  // Grammar holds here too: negation excludes, is:active scopes to live.
  const neg = await get(`/api/search?q=${encodeURIComponent('alpha -name:hello')}`);
  assert.ok(!neg.body.results.some(s => s.id === SESSION_ID));
  const liveOnly = await get(`/api/search?q=${encodeURIComponent('alpha is:active')}`);
  assert.ok(!liveOnly.body.results.some(s => s.id === SESSION_ID), 'historical session excluded by is:active');

  // Empty query browses everything, recency-first.
  const all = await get('/api/search?q=');
  assert.ok(all.body.results.length >= 3);
  const times = all.body.results.map(s => new Date(s.lastActivity || 0).getTime());
  assert.ok(times.every((t, i) => i === 0 || t <= times[i - 1]), 'recency order');
});

test('GET /api/sessions reports indexing:false once the corpus is indexed', async () => {
  const { body } = await get('/api/sessions');
  assert.equal(body.indexing, false);
});

test('GET /messages returns the tail with indexes', async () => {
  const { body } = await get(`/api/sessions/${SESSION_ID}/messages`);
  assert.equal(body.totalMessages, 5);
  assert.equal(body.firstIndex, 0);
  assert.equal(body.lastIndex, 4);
  assert.equal(body.hasMore, false);
  assert.deepEqual(body.messages.map(m => m.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(body.messages.map(m => m.role), ['user', 'assistant', 'toolResult', 'user', 'assistant']);
  // Entry id + generation stats ride the message (share deep links, tok/s).
  const last = body.messages[4];
  assert.equal(last.id, 'ent5');
  assert.equal(last.durationMs, 2000);
  assert.equal(last.outputTokens, 60);
  assert.equal(last.provider, 'test');
  assert.equal(last.model, 'selected-model');
  assert.equal(last.responseModel, 'routed-model');
  assert.deepEqual(last.usage, {
    input: 200, output: 60, cacheRead: 0, cacheWrite: 0, totalTokens: 1234,
    cost: { total: 0.02 },
  }, 'usage API exposes only documented counters and estimated costs');
});

test('GET /messages honors limit / before / after cursors', async () => {
  const tail = await get(`/api/sessions/${SESSION_ID}/messages?limit=2`);
  assert.deepEqual(tail.body.messages.map(m => m.index), [3, 4]);
  assert.equal(tail.body.hasMore, true);

  const older = await get(`/api/sessions/${SESSION_ID}/messages?limit=2&before=3`);
  assert.deepEqual(older.body.messages.map(m => m.index), [1, 2]);
  assert.equal(older.body.hasMore, true);

  const catchup = await get(`/api/sessions/${SESSION_ID}/messages?after=2`);
  assert.deepEqual(catchup.body.messages.map(m => m.index), [3, 4]);

  // A non-numeric cursor must not defeat the limit and dump the whole session
  // with null indexes — it falls through to the limited tail.
  const bogus = await get(`/api/sessions/${SESSION_ID}/messages?after=abc&limit=2`);
  assert.deepEqual(bogus.body.messages.map(m => m.index), [3, 4]);
  assert.ok(bogus.body.messages.every(m => Number.isFinite(m.index)), 'indexes stay numeric');
});

test('GET /messages moves historical image bytes to a cacheable resource', async () => {
  const { body } = await get(`/api/sessions/${SESSION_ID}/messages`);
  const image = body.messages[2].content.find(block => block.type === 'image');
  assert.ok(image?.url, 'message payload carries an image resource URL');
  assert.equal(image.data, undefined, 'base64 bytes are not duplicated into chat JSON');

  const res = await fetch(base + image.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), TINY_PNG);
});

test('large chat JSON negotiates gzip and materially reduces wire bytes', async () => {
  const resource = `/api/sessions/${BANDWIDTH_ID}/messages`;
  const identity = await rawGet(resource, { 'Accept-Encoding': 'identity' });
  const gzip = await rawGet(resource, { 'Accept-Encoding': 'gzip' });

  assert.equal(identity.status, 200);
  assert.equal(gzip.status, 200);
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.match(gzip.headers.vary || '', /Accept-Encoding/i);
  assert.deepEqual(zlib.gunzipSync(gzip.body), identity.body, 'compression preserves the JSON bytes');
  assert.ok(gzip.body.length < identity.body.length * 0.5,
    `expected at least 50% savings (${identity.body.length} -> ${gzip.body.length})`);
});

test('GET /search returns match indexes with roles', async () => {
  const { body } = await get(`/api/sessions/${SESSION_ID}/search?q=alpha`);
  assert.equal(body.totalMessages, 5);
  assert.deepEqual(body.matches, [
    { index: 0, role: 'user' },
    { index: 3, role: 'user' },
  ]);
});

test('GET /search matches tool results and is case-insensitive', async () => {
  const { body } = await get(`/api/sessions/${SESSION_ID}/search?q=CHARLIE`);
  assert.deepEqual(body.matches, [{ index: 2, role: 'toolResult' }]);
});

test('GET /search requires all tokens to match within one message', async () => {
  const both = await get(`/api/sessions/${SESSION_ID}/search?q=delta alpha`);
  assert.deepEqual(both.body.matches.map(m => m.index), [3]);
  const none = await get(`/api/sessions/${SESSION_ID}/search?q=delta bravo`);
  assert.deepEqual(none.body.matches, []);
});

test('GET /search with empty query or unknown session', async () => {
  const empty = await get(`/api/sessions/${SESSION_ID}/search?q=`);
  assert.deepEqual(empty.body.matches, []);
  const missing = await get('/api/sessions/nope/search?q=x');
  assert.equal(missing.status, 404);
});

test('GET /api/dirs fuzzy-finds directories under $HOME', async () => {
  const { status, body } = await get('/api/dirs?q=alpha');
  assert.equal(status, 200);
  const hit = body.find(d => d.path === realCwd);
  assert.ok(hit, 'proj-alpha should match');
  assert.equal(hit.short, '~/workspace/proj-alpha');
  // typo tolerance comes from in-order char matching
  const fuzzy = await get('/api/dirs?q=wkspalpha');
  assert.ok(fuzzy.body.some(d => d.path === realCwd));
});

test('GET /files fuzzy-searches the session cwd', async () => {
  const { status, body } = await get(`/api/sessions/${REAL_CWD_ID}/files?q=main`);
  assert.equal(status, 200);
  assert.equal(body.cwd, realCwd);
  assert.ok(body.files.some(f => f.path === 'src/main.js'));
});

test('GET /files completes absolute paths outside the session cwd', async () => {
  // partial basename → the matching directory, flagged so the client drills in
  let { status, body } = await get(`/api/sessions/${REAL_CWD_ID}/files?q=${encodeURIComponent(tmpHome + '/scr')}`);
  assert.equal(status, 200);
  const dirHit = body.files.find(f => f.path === path.join(tmpHome, 'scratch'));
  assert.ok(dirHit, 'scratch dir suggested from its absolute parent');
  assert.equal(dirHit.isDir, true);
  // trailing slash → list inside that directory
  ({ body } = await get(`/api/sessions/${REAL_CWD_ID}/files?q=${encodeURIComponent(tmpHome + '/scratch/')}`));
  const fileHit = body.files.find(f => f.path === path.join(tmpHome, 'scratch', 'notes.md'));
  assert.ok(fileHit && !fileHit.isDir);
});

test('GET /files completes ~ and ../ tokens, preserving the typed form', async () => {
  // ~ expands against $HOME but suggestions stay ~-relative
  let { body } = await get(`/api/sessions/${REAL_CWD_ID}/files?q=${encodeURIComponent('~/scratch/no')}`);
  assert.ok(body.files.some(f => f.path === '~/scratch/notes.md'));
  // dotfiles hidden unless the partial starts with a dot
  ({ body } = await get(`/api/sessions/${REAL_CWD_ID}/files?q=${encodeURIComponent('~/')}`));
  assert.ok(!body.files.some(f => f.path.includes('/.')), 'no dotfiles for a bare listing');
  ({ body } = await get(`/api/sessions/${REAL_CWD_ID}/files?q=${encodeURIComponent('~/.p')}`));
  assert.ok(body.files.some(f => f.path === '~/.pi' && f.isDir));
  // ../ resolves against the session cwd
  ({ body } = await get(`/api/sessions/${REAL_CWD_ID}/files?q=${encodeURIComponent('../proj-al')}`));
  assert.ok(body.files.some(f => f.path === '../proj-alpha' && f.isDir));
});

test('GET /files path completion works even when the session cwd is missing', async () => {
  // fixture session's cwd doesn't exist, but ~ completion doesn't need it
  const { status, body } = await get(`/api/sessions/${SESSION_ID}/files?q=${encodeURIComponent('~/scratch/')}`);
  assert.equal(status, 200);
  assert.ok(body.files.some(f => f.path === '~/scratch/notes.md'));
});

test('GET /files with a missing cwd degrades to an empty list', async () => {
  // fixture session's cwd (/home/user/proj) does not exist on disk
  const { status, body } = await get(`/api/sessions/${SESSION_ID}/files?q=x`);
  assert.equal(status, 200);
  assert.deepEqual(body.files, []);
});

test('GET /file resolves a bare filename through the session tool calls', async () => {
  const { status, body } = await get(`/api/sessions/${REAL_CWD_ID}/file?path=findings.md`);
  assert.equal(status, 200);
  assert.equal(body.path, path.join(deepDir, 'findings.md'), 'the deep tool-written file, not a cwd guess');
  assert.equal(body.relPath, 'deep/nest/findings.md');
  assert.equal(body.content, '# deep findings\n');
  assert.equal(body.truncated, false);
});

test('GET /file reaches tool-touched files outside the cwd', async () => {
  const { status, body } = await get(`/api/sessions/${REAL_CWD_ID}/file?path=notes.md`);
  assert.equal(status, 200);
  assert.equal(body.path, path.join(scratchDir, 'notes.md'));
  assert.equal(body.relPath, null, 'outside the cwd there is no relative form');
});

test('GET /file serves cwd-relative paths and strips :line suffixes', async () => {
  const { status, body } = await get(`/api/sessions/${REAL_CWD_ID}/file?path=${encodeURIComponent('src/main.js:1')}`);
  assert.equal(status, 200);
  assert.equal(body.content, 'console.log(1);\n');
  assert.equal(body.line, 1);
});

test('GET /file returns image metadata while a resource route serves the bytes', async () => {
  const { status, body } = await get(`/api/sessions/${REAL_CWD_ID}/file?path=preview.png`);
  assert.equal(status, 200);
  assert.equal(body.image.mimeType, 'image/png');
  assert.ok(body.image.url, 'viewer JSON carries a resource URL');
  assert.equal(body.image.data, undefined, 'viewer JSON does not carry base64 bytes');

  const res = await fetch(base + body.image.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), TINY_PNG);
});

test('large document JSON negotiates gzip with substantial savings', async () => {
  const resource = `/api/sessions/${REAL_CWD_ID}/file?path=large.md`;
  const identity = await rawGet(resource, { 'Accept-Encoding': 'identity' });
  const gzip = await rawGet(resource, { 'Accept-Encoding': 'gzip' });
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.deepEqual(zlib.gunzipSync(gzip.body), identity.body);
  assert.ok(gzip.body.length < identity.body.length * 0.5,
    `expected at least 50% savings (${identity.body.length} -> ${gzip.body.length})`);
});

test('GET /file rejects traversal and unreachable absolute paths', async () => {
  const dotdot = await get(`/api/sessions/${REAL_CWD_ID}/file?path=${encodeURIComponent('../../secret.txt')}`);
  assert.equal(dotdot.status, 404, 'lexical traversal out of the cwd must not read');
  const abs = await get(`/api/sessions/${REAL_CWD_ID}/file?path=${encodeURIComponent(path.join(tmpHome, 'secret.txt'))}`);
  assert.equal(abs.status, 404, 'absolute path outside cwd + tool trail must not read');
  const missing = await get(`/api/sessions/${REAL_CWD_ID}/file?path=never-written.md`);
  assert.equal(missing.status, 404);
  const empty = await get(`/api/sessions/${REAL_CWD_ID}/file?path=`);
  assert.equal(empty.status, 400);
});

test('GET /diff aggregates uncommitted changes across repos under the session cwd', async (t) => {
  const { execFileSync } = require('node:child_process');
  const git = (cwd, ...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
  try { git(tmpHome, '--version'); } catch { return t.skip('git not available'); }

  // A repo *under* the session cwd (the polyrepo case: cwd itself isn't one).
  const repo = path.join(realCwd, 'repo-x');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n'); // modified
  fs.writeFileSync(path.join(repo, 'new.txt'), 'fresh\n');  // untracked

  const { status, body } = await get(`/api/sessions/${REAL_CWD_ID}/diff`);
  assert.equal(status, 200);
  assert.equal(body.root, realCwd);
  assert.equal(body.gitAvailable, true);
  const entry = body.repos.find(r => r.path === 'repo-x');
  assert.ok(entry, 'repo under the cwd is discovered');
  assert.equal(entry.branch, 'main');
  const byPath = Object.fromEntries(entry.files.map(f => [f.path, f]));
  assert.equal(byPath['a.txt'].status, 'M');
  assert.ok(byPath['a.txt'].patch.includes('+two'));
  assert.equal(byPath['new.txt'].status, '?');
  assert.ok(byPath['new.txt'].patch.includes('+fresh'), 'untracked files get synthesized patches');
});

test('large diff summaries defer collapsed patches and serve one on demand', async (t) => {
  const { execFileSync } = require('node:child_process');
  const git = (cwd, ...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
  try { git(tmpHome, '--version'); } catch { return t.skip('git not available'); }

  const repo = path.join(realCwd, 'repo-big');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  for (let i = 0; i < 7; i++) fs.writeFileSync(path.join(repo, `file-${i}.txt`), `old ${i}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  for (let i = 0; i < 7; i++) fs.writeFileSync(path.join(repo, `file-${i}.txt`), `old ${i}\nnew ${i}\n`);

  const { body } = await get(`/api/sessions/${REAL_CWD_ID}/diff`);
  const entry = body.repos.find(r => r.path === 'repo-big');
  assert.ok(entry, 'large repo is present in the summary');
  assert.equal(entry.files.length, 7);
  assert.ok(entry.files.every(f => f.patch === undefined && f.patchDeferred === true),
    'collapsed patch text is absent from the summary payload');

  const query = new URLSearchParams({ repo: 'repo-big', path: 'file-3.txt' });
  const patch = await get(`/api/sessions/${REAL_CWD_ID}/diff/patch?${query}`);
  assert.equal(patch.status, 200);
  assert.match(patch.body.patch, /\+new 3/);
  assert.equal(patch.body.truncated, false);
});

test('GET /diff 404s when the session cwd is unknown', async () => {
  const { status } = await get(`/api/sessions/${NO_CWD_ID}/diff`);
  assert.equal(status, 404);
});

// --- published pages (lib/pages.js, /api/pages, /page/:token) ---------------

test('POST /api/pages publishes a file and /page/:token serves it live from disk', async () => {
  const planFile = path.join(realCwd, 'plan.html');
  fs.writeFileSync(planFile, '<h1>the plan</h1>');
  const { status, body } = await post('/api/pages', {
    path: planFile, sessionId: REAL_CWD_ID, title: 'The Plan',
  });
  assert.equal(status, 200);
  assert.ok(body.token);
  assert.equal(body.path, `/page/${body.token}`);
  assert.equal(body.title, 'The Plan');

  const res = await fetch(base + body.path);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const firstHtml = await res.text();
  assert.match(firstHtml, /<h1>the plan<\/h1>/);
  assert.match(firstHtml, new RegExp(`artifact-comments\\.js[^>]+${body.token}`), 'main page view gets the comment overlay');

  // Live from disk: an edit shows without re-publishing.
  fs.writeFileSync(planFile, '<h1>the revised plan</h1>');
  assert.match(await (await fetch(base + body.path)).text(), /<h1>the revised plan<\/h1>/);

  // Idempotent per path: re-publishing reuses the token.
  const again = await post('/api/pages', { path: planFile, sessionId: REAL_CWD_ID });
  assert.equal(again.body.token, body.token);

  // Listed for the session, then revocable.
  const list = await get(`/api/pages?sessionId=${REAL_CWD_ID}`);
  assert.ok(list.body.some((p) => p.token === body.token && p.missing === false));
  const revoked = await del(`/api/pages/${body.token}`);
  assert.equal(revoked.body.revoked, true);
  assert.equal((await fetch(base + body.path)).status, 404);
});

test('directory pages serve index.html and contained assets only', async () => {
  const dir = path.join(realCwd, 'report');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<link href="assets/s.css"><p>report</p>');
  fs.writeFileSync(path.join(dir, 'assets', 's.css'), 'p { color: red; }');
  const { status, body } = await post('/api/pages', { path: dir, sessionId: REAL_CWD_ID });
  assert.equal(status, 200);

  // Bare token URL redirects to the trailing-slash form so the document's
  // relative asset URLs resolve under the token.
  const bare = await fetch(base + body.path, { redirect: 'manual' });
  assert.equal(bare.status, 302);
  assert.equal(bare.headers.get('location'), `${body.path}/`);

  const index = await fetch(base + body.path + '/');
  assert.match(await index.text(), /report/);
  const asset = await fetch(base + body.path + '/assets/s.css');
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /color: red/);

  // Traversal out of the root must 404 (encoded so the client can't
  // normalize it away), as must missing assets.
  assert.equal((await fetch(base + body.path + '/%2e%2e/secret.txt')).status, 404);
  assert.equal((await fetch(base + body.path + '/nope.css')).status, 404);
  await del(`/api/pages/${body.token}`);
});

// --- anchored comments (lib/comments.js, /api/comments) -------------------

test('comments support unpaginated indexing, selected reads, and acknowledgment', async () => {
  const fileTarget = {
    kind: 'file', path: path.join(realCwd, 'README.md'), relPath: 'README.md',
    anchor: { type: 'text', quote: 'alpha', prefix: '# ', suffix: '\n', startLine: 1, endLine: 1 },
  };
  const first = await post('/api/comments', {
    sessionId: REAL_CWD_ID, body: 'Clarify this heading.', target: fileTarget,
  });
  assert.equal(first.status, 201);
  assert.ok(first.body.id);
  assert.equal(first.body.acknowledgedAt, null);
  assert.equal(first.body.notifySuggested, undefined, 'creating a comment carries no agent-turn notification');

  const second = await post('/api/comments', {
    sessionId: REAL_CWD_ID, body: 'Use the stronger name.',
    target: {
      kind: 'diff', repo: 'repo-x', path: 'a.txt',
      anchor: { type: 'lines', quote: '+two', oldStart: 1, oldEnd: 1, newStart: 2, newEnd: 2 },
    },
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.notifySuggested, undefined);

  const index = await get(`/api/comments/index?sessionId=${REAL_CWD_ID}`);
  assert.equal(index.status, 200);
  assert.equal(index.body.total, 2, 'the full open index is not gated by acknowledgment');
  assert.deepEqual(index.body.comments.map((c) => c.id), [first.body.id, second.body.id]);
  assert.equal(index.body.comments[0].bodyPreview, 'Clarify this heading.');
  assert.equal(index.body.comments[0].target.anchor.quotePreview, 'alpha');
  assert.equal(index.body.comments[0].target.anchor.prefix, undefined, 'index omits full anchor context');

  const selected = await post('/api/comments/get', {
    sessionId: REAL_CWD_ID, ids: [second.body.id, first.body.id],
  });
  assert.equal(selected.status, 200);
  assert.deepEqual(selected.body.comments.map((c) => c.id), [second.body.id, first.body.id],
    'the agent can fetch any inferred group in its requested order without acking earlier comments');
  assert.equal(selected.body.comments[1].target.anchor.prefix, '# ', 'selected fetch returns the full anchor');
  assert.deepEqual(selected.body.missing, []);

  const count = await get(`/api/comments/count?sessionId=${REAL_CWD_ID}`);
  assert.deepEqual(count.body, { total: 2 });

  const wrongSession = await post(`/api/comments/${first.body.id}/ack`, { sessionId: SESSION_ID });
  assert.equal(wrongSession.status, 403);
  const ack = await post(`/api/comments/${first.body.id}/ack`, { sessionId: REAL_CWD_ID });
  assert.equal(ack.status, 200);
  assert.ok(ack.body.acknowledgedAt);

  const indexAfterAck = await get(`/api/comments/index?sessionId=${REAL_CWD_ID}`);
  assert.deepEqual(indexAfterAck.body.comments.map((c) => c.id), [second.body.id]);

  await post(`/api/comments/${second.body.id}/ack`, { sessionId: REAL_CWD_ID });
});

test('published-page comments inherit the page session and artifact identity', async () => {
  const artifact = path.join(realCwd, 'commentable.html');
  fs.writeFileSync(artifact, '<p>Selected artifact prose</p>');
  const page = await post('/api/pages', { path: artifact, sessionId: REAL_CWD_ID, title: 'Commentable' });
  const created = await post('/api/comments', {
    body: 'Make this more concrete.',
    target: {
      kind: 'page', pageToken: page.body.token,
      anchor: { type: 'text', quote: 'artifact prose', prefix: 'Selected ', suffix: '' },
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.sessionId, REAL_CWD_ID);
  assert.equal(created.body.target.root, artifact);

  const selected = await post('/api/comments/get', { sessionId: REAL_CWD_ID, ids: [created.body.id] });
  assert.deepEqual(selected.body.comments.map((c) => c.id), [created.body.id]);
  await post(`/api/comments/${created.body.id}/ack`, { sessionId: REAL_CWD_ID });
  await del(`/api/pages/${page.body.token}`);
});

test('comments reject unanchored targets and unknown sessions/pages', async () => {
  assert.equal((await post('/api/comments', {
    sessionId: REAL_CWD_ID, body: 'no anchor', target: { kind: 'file', path: path.join(realCwd, 'README.md') },
  })).status, 400);
  assert.equal((await post('/api/comments', {
    sessionId: 'missing-session', body: 'hello',
    target: { kind: 'file', path: path.join(realCwd, 'README.md'), anchor: { type: 'text', quote: 'x' } },
  })).status, 404);
  assert.equal((await post('/api/comments', {
    sessionId: REAL_CWD_ID, body: 'hello',
    target: { kind: 'page', pageToken: 'missing', anchor: { type: 'text', quote: 'x' } },
  })).status, 400);
  assert.equal((await post('/api/comments/get', { sessionId: REAL_CWD_ID, ids: [] })).status, 400);
});

test('POST /api/pages validates the root but imposes no path gate', async () => {
  const rel = await post('/api/pages', { path: 'plan.html' });
  assert.equal(rel.status, 400, 'relative paths rejected');
  const missing = await post('/api/pages', { path: path.join(realCwd, 'nope.html') });
  assert.equal(missing.status, 404, 'nonexistent path rejected');

  // A directory without index.html can't be a page.
  const bare = path.join(realCwd, 'no-index');
  fs.mkdirSync(bare, { recursive: true });
  assert.equal((await post('/api/pages', { path: bare, sessionId: REAL_CWD_ID })).status, 400);

  // Deliberately no workspace containment: sharing governance rests with
  // whoever can reach the main app (an agent could copy any file into its
  // cwd anyway, so a gate would only be theater). Paths outside any session
  // cwd — /tmp artifacts, this temp HOME — publish fine.
  const outside = path.join(tmpHome, 'outside-any-cwd.html');
  fs.writeFileSync(outside, '<p>outside</p>');
  const ok = await post('/api/pages', { path: outside });
  assert.equal(ok.status, 200);
  assert.match(await (await fetch(base + ok.body.path)).text(), /<p>outside<\/p>/);
  await del(`/api/pages/${ok.body.token}`);
});

test('publishing without a sessionId infers the most specific containing cwd', async () => {
  // Nested session cwds (a checkout under a workspace root another session
  // sits in) must route to the deepest match, not bail as ambiguous — a page
  // stored with sessionId null makes every later page comment 404.
  const OUTER_ID = '2026-07-04T16-00-00-inferout';
  const INNER_ID = '2026-07-04T16-00-00-inferinn';
  const outerCwd = path.join(tmpHome, 'ws');
  const innerCwd = path.join(outerCwd, 'repo');
  fs.mkdirSync(innerCwd, { recursive: true });
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const sockStub = path.join(tmpHome, 'infer-sock-stub');
  fs.writeFileSync(sockStub, '');
  for (const [id, cwd] of [[OUTER_ID, outerCwd], [INNER_ID, innerCwd]]) {
    fs.writeFileSync(path.join(registryDir, `${id}.json`), JSON.stringify({
      sessionId: id, socketPath: sockStub, pid: process.pid, cwd, sessionFile: SESSION_FILE,
    }));
  }
  await new Promise(r => setTimeout(r, 600)); // registry scan memo TTL

  const artifact = path.join(innerCwd, 'findings.html');
  fs.writeFileSync(artifact, '<p>findings</p>');
  try {
    const { status, body } = await post('/api/pages', { path: artifact });
    assert.equal(status, 200);
    const inner = await get(`/api/pages?sessionId=${INNER_ID}`);
    assert.ok(inner.body.some((p) => p.token === body.token),
      'the page routes to the deepest containing session cwd');
    await del(`/api/pages/${body.token}`);
  } finally {
    for (const id of [OUTER_ID, INNER_ID]) {
      fs.rmSync(path.join(registryDir, `${id}.json`), { force: true });
    }
  }
});

test('GET /page with an unknown token is a bare 404', async () => {
  const res = await fetch(base + '/page/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'Not found');
});

test('the server exports PI_DISH_URL for spawned agents (pi-dish-pages skill)', () => {
  assert.equal(process.env.PI_DISH_URL, base);
});

test('PUT /api/models/enabled persists pi scoped models in settings.json', async () => {
  const settingsFile = path.join(tmpHome, '.pi', 'agent', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }));

  // Scope down to two models — other settings fields survive
  const scoped = await put('/api/models/enabled', { enabledIds: ['anthropic/claude-sonnet-4-5', 'zai/glm-5.2'] });
  assert.equal(scoped.status, 200);
  let settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  assert.deepEqual(settings.enabledModels, ['anthropic/claude-sonnet-4-5', 'zai/glm-5.2']);
  assert.equal(settings.theme, 'dark');

  // null clears the filter entirely (pi treats absent/empty as all enabled)
  const cleared = await put('/api/models/enabled', { enabledIds: null });
  assert.equal(cleared.status, 200);
  settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  assert.equal('enabledModels' in settings, false);

  // Empty array behaves like clearing too
  await put('/api/models/enabled', { enabledIds: ['x/y'] });
  await put('/api/models/enabled', { enabledIds: [] });
  settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  assert.equal('enabledModels' in settings, false);

  // Malformed bodies are rejected
  const bad = await put('/api/models/enabled', { enabledIds: 'not-an-array' });
  assert.equal(bad.status, 400);
  const badItems = await put('/api/models/enabled', { enabledIds: ['ok', 42] });
  assert.equal(badItems.status, 400);
});

test('GET /stats aggregates tokens, cost, and message counts from the JSONL', async () => {
  const { status, body } = await get(`/api/sessions/${SESSION_ID}/stats`);
  assert.equal(status, 200);
  assert.equal(body.userMessages, 2);
  assert.equal(body.assistantMessages, 2);
  assert.equal(body.toolCalls, 1);
  assert.equal(body.toolResults, 1);
  assert.equal(body.totalMessages, 5);
  assert.deepEqual(body.tokens, { input: 300, output: 100, cacheRead: 10, cacheWrite: 5, total: 415 });
  assert.ok(Math.abs(body.cost - 0.05) < 1e-9);
  assert.deepEqual(body.costs, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.05 });
  assert.equal(body.reasoningTokens, 0);
  assert.deepEqual(body.responseTiming, { measured: 1, medianMs: 2000, slowestMs: 2000 });
  // Effective speed inputs: only the last assistant message has measurable
  // timing (2s for 60 output tokens) — the other's timestamps are unusable.
  assert.equal(body.genMs, 2000);
  assert.equal(body.genOutput, 60);
  assert.equal(body.cwd, '/home/user/proj');
  assert.equal(body.contextUsage.tokens, 1234);
  const missing = await get('/api/sessions/nope/stats');
  assert.equal(missing.status, 404);
});

test('usage summary filters local-day ranges and keeps timestamp-less cost all-time only', async () => {
  const usageId = 'usage-summary-' + Date.now();
  const usageFile = path.join(sessionDir, usageId + '.jsonl');
  const now = new Date();
  const old = new Date(now); old.setDate(old.getDate() - 10);
  const baselineToday = (await get('/api/usage-summary?days=1')).body;
  const baselineAll = (await get('/api/usage-summary?days=all')).body;
  const entries = [
    { type: 'session', cwd: '/workspace/usage', timestamp: now.toISOString() },
    { type: 'message', timestamp: now.toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'usage fixture' }] } },
    { type: 'message', timestamp: now.toISOString(), message: { role: 'assistant', provider: 'known', model: 'paid', content: [],
      usage: { input: 100, output: 10, cost: { input: 0.4, output: 0.6, total: 1 } } } },
    { type: 'message', timestamp: now.toISOString(), message: { role: 'assistant', provider: 'missing', model: 'unpriced', content: [],
      usage: { input: 50, output: 5, cost: { total: 0 } } } },
    { type: 'message', timestamp: old.toISOString(), message: { role: 'assistant', provider: 'known', model: 'old-paid', content: [],
      usage: { input: 20, output: 2, cost: { total: 2 } } } },
    { type: 'message', message: { role: 'assistant', provider: 'known', model: 'dateless-paid', content: [],
      usage: { input: 30, output: 3, cost: { total: 4 } } } },
  ];
  fs.writeFileSync(usageFile, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  try {
    const today = await get('/api/usage-summary?days=1');
    assert.equal(today.status, 200);
    assert.equal(today.body.range, '1');
    assert.equal(today.body.totals.calls - baselineToday.totals.calls, 2);
    assert.equal(today.body.totals.costs.total - baselineToday.totals.costs.total, 1);
    assert.equal(today.body.headlineCosts.today - baselineToday.headlineCosts.today, 1);
    assert.equal(today.body.headlineCosts.days7 - baselineToday.headlineCosts.days7, 1,
      'dateless usage must not leak into recent ranges');
    assert.equal(today.body.headlineCosts.days30 - baselineToday.headlineCosts.days30, 3);
    assert.equal(today.body.headlineCosts.all - baselineToday.headlineCosts.all, 7);
    assert.equal(today.body.unpricedModelCalls - baselineToday.unpricedModelCalls, 1);
    assert.ok(today.body.groups.models.some(m => m.key === 'missing/unpriced' && m.priced === false));

    const all = await get('/api/usage-summary?days=all');
    assert.equal(all.body.totals.calls - baselineAll.totals.calls, 4);
    assert.equal(all.body.totals.costs.total - baselineAll.totals.costs.total, 7);
    assert.ok(all.body.groups.workspaces.some(w => w.key === '/workspace/usage'));

    // The daily series spans the requested range and stacks per-model data.
    assert.equal(today.body.daily.length, 1);
    const seven = await get('/api/usage-summary?days=7');
    assert.equal(seven.body.daily.length, 7);
    const todayEntry = seven.body.daily[6];
    assert.ok(todayEntry.models.some(m => m.ref === 'known/paid' && m.cost >= 1 && m.calls >= 1),
      'today must carry a per-model breakdown');
    const thirty = await get('/api/usage-summary?days=30');
    assert.equal(thirty.body.daily.length, 30);
    assert.ok(thirty.body.daily[19].models.some(m => m.ref === 'known/old-paid' && m.cost >= 2),
      '10-day-old usage must land on its own day');
    assert.ok(all.body.daily.length >= 11 && all.body.daily.length <= 365,
      'all-time daily spans from the earliest dated day, capped at a year');
    assert.ok(!all.body.daily.some(d => d.day === 'unknown'), 'dateless usage stays out of the daily series');

    const invalid = await get('/api/usage-summary?days=2');
    assert.equal(invalid.status, 400);
  } finally {
    fs.rmSync(usageFile, { force: true });
  }
});

test('server-global telemetry settings preserve unrelated fields and validate budgets', async () => {
  const settingsFile = path.join(tmpHome, '.pi', 'dish', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ keep: 'yes' }));

  const saved = await put('/api/settings', { monthlyBudgetUsd: 25.5 });
  assert.deepEqual(saved, { status: 200, body: { monthlyBudgetUsd: 25.5, savedFilters: [] } });
  assert.deepEqual(await get('/api/settings'), saved);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).keep, 'yes');

  for (const value of [0, -1, 1000001, '25']) {
    assert.equal((await put('/api/settings', { monthlyBudgetUsd: value })).status, 400);
  }
  const cleared = await put('/api/settings', { monthlyBudgetUsd: null });
  assert.deepEqual(cleared.body, { monthlyBudgetUsd: null, savedFilters: [] });
  assert.equal('monthlyBudgetUsd' in JSON.parse(fs.readFileSync(settingsFile, 'utf8')), false);
});

test('saved filters persist server-globally and update independently of the budget', async () => {
  const settingsFile = path.join(tmpHome, '.pi', 'dish', 'settings.json');
  await put('/api/settings', { monthlyBudgetUsd: 10 });
  const filters = [{ name: 'No subagents', query: '-name:subagent' }, { name: 'This week', query: 'since:7d' }];
  const saved = await put('/api/settings', { savedFilters: filters });
  assert.deepEqual(saved, { status: 200, body: { monthlyBudgetUsd: 10, savedFilters: filters } });
  assert.deepEqual((await get('/api/settings')).body.savedFilters, filters);
  // A budget-only PUT must not clobber the filters (and vice versa).
  await put('/api/settings', { monthlyBudgetUsd: null });
  assert.deepEqual((await get('/api/settings')).body.savedFilters, filters);

  for (const bad of ['nope', [{ name: '', query: 'x' }], [{ name: 'a', query: '' }],
      [{ name: 'dup', query: 'x' }, { name: 'dup', query: 'y' }], [{ name: 'x'.repeat(61), query: 'q' }]]) {
    assert.equal((await put('/api/settings', { savedFilters: bad })).status, 400, JSON.stringify(bad));
  }

  const clearedAll = await put('/api/settings', { savedFilters: [] });
  assert.deepEqual(clearedAll.body.savedFilters, []);
  assert.equal('savedFilters' in JSON.parse(fs.readFileSync(settingsFile, 'utf8')), false);
});

test('POST endpoints validate input and reject inactive sessions', async () => {
  // Bad thinking level is rejected before any session lookup
  const badLevel = await post(`/api/sessions/${SESSION_ID}/thinking`, { level: 'ultra' });
  assert.equal(badLevel.status, 400);
  // Valid level, but the fixture session is not live
  const inactive = await post(`/api/sessions/${SESSION_ID}/thinking`, { level: 'high' });
  assert.equal(inactive.status, 404);

  // Prompting needs a message (or images) and a live session
  const noMsg = await post(`/api/sessions/${SESSION_ID}/prompt`, {});
  assert.equal(noMsg.status, 400);
  const deadPrompt = await post(`/api/sessions/${SESSION_ID}/prompt`, { message: 'hi' });
  assert.equal(deadPrompt.status, 404);

  // A non-base64 image is dropped by sanitizeImages, so an images-only prompt
  // with malformed data has nothing left and is rejected as empty (not stored).
  const badImage = await post(`/api/sessions/${SESSION_ID}/prompt`,
    { images: [{ mimeType: 'image/png', data: 'not valid base64!' }] });
  assert.equal(badImage.status, 400);
  // Well-formed base64 survives sanitizing and reaches the (dead) session.
  const okImage = await post(`/api/sessions/${SESSION_ID}/prompt`,
    { images: [{ mimeType: 'image/png', data: 'aGVsbG8=' }] });
  assert.equal(okImage.status, 404);

  // Slash-command endpoint requires a leading slash
  const notSlash = await post(`/api/sessions/${SESSION_ID}/command`, { message: 'hello' });
  assert.equal(notSlash.status, 400);

  // Queue-cancel validates kind + non-empty text before any session lookup
  const badKind = await post(`/api/sessions/${SESSION_ID}/queue/cancel`, { kind: 'nope', text: 'x' });
  assert.equal(badKind.status, 400);
  const noText = await post(`/api/sessions/${SESSION_ID}/queue/cancel`, { kind: 'steering' });
  assert.equal(noText.status, 400);
  const badIndex = await post(`/api/sessions/${SESSION_ID}/queue/cancel`, { kind: 'steering', text: 'x', index: 'first' });
  assert.equal(badIndex.status, 400);
  // Valid body, but the fixture session is not live
  const deadCancel = await post(`/api/sessions/${SESSION_ID}/queue/cancel`, { kind: 'followUp', text: 'x' });
  assert.equal(deadCancel.status, 404);
});

// --- Close session + runtime location --------------------------------------

test('POST /close SIGTERMs the registry pid; /stats reports where it runs', async () => {
  const { spawn } = require('node:child_process');
  const CLOSE_ID = '2026-07-04T16-00-00-close001';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  // A real process to kill — the fake-bridge pattern of pid: process.pid
  // would SIGTERM the test itself here.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  // The registry prune only stats socketPath — a plain file keeps the entry
  // alive without a listener (the close route never connects).
  const sockStub = path.join(tmpHome, 'close-sock-stub');
  fs.writeFileSync(sockStub, '');
  fs.writeFileSync(path.join(registryDir, `${CLOSE_ID}.json`), JSON.stringify({
    sessionId: CLOSE_ID, socketPath: sockStub, pid: child.pid, cwd: '/home/user/proj',
    sessionFile: SESSION_FILE,
    // The bridge's $TMUX stamp. The socket doesn't exist, so the live pane
    // query fails — session/window stay null but the server name still shows.
    tmux: { socket: '/tmp/tmux-99999/work', pane: '%7' },
  }));
  await new Promise(r => setTimeout(r, 600)); // registry scan memo TTL

  try {
    const stats = await get(`/api/sessions/${CLOSE_ID}/stats`);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.runtime.kind, 'tmux');
    assert.equal(stats.body.runtime.server, 'work');
    assert.equal(stats.body.runtime.pid, child.pid);
    assert.equal(stats.body.runtime.tmuxSession, null);

    const exited = new Promise(r => child.once('exit', (code, signal) => r(signal)));
    const closed = await post(`/api/sessions/${CLOSE_ID}/close`, {});
    assert.equal(closed.status, 200);
    assert.equal(closed.body.success, true);
    assert.equal(await exited, 'SIGTERM', 'the pi process got a graceful SIGTERM');
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    fs.rmSync(path.join(registryDir, `${CLOSE_ID}.json`), { force: true });
  }
});

test('POST /close on an inactive session is a 404; inactive /stats has no runtime', async () => {
  const closed = await post(`/api/sessions/${SESSION_ID}/close`, {});
  assert.equal(closed.status, 404);
  const stats = await get(`/api/sessions/${SESSION_ID}/stats`);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.runtime, null);
});

// --- Tree branching (inactive sessions go through pi's SDK) ---------------
// These mutate TREE_FILE (branching appends entries by design) and so run
// in this order.

test('POST /branch on a user message returns its text and persists the leaf move', async () => {
  const { status, body } = await post(`/api/sessions/${TREE_ID}/branch`, { entryId: 'e3' });
  assert.equal(status, 200);
  assert.equal(body.editorText, 'second prompt', 'user-message target means re-edit: text comes back for the composer');

  // A reopened SessionManager derives its leaf from the last entry — the
  // branch must survive that (this is what plain sm.branch() got wrong).
  const tree = await get(`/api/sessions/${TREE_ID}/tree`);
  assert.equal(tree.status, 200);
  const active = new Set(tree.body.activePathIds);
  assert.ok(active.has('e1') && active.has('e2'), 'path up to the target parent stays active');
  assert.ok(!active.has('e3') && !active.has('e4'), 'the abandoned branch is no longer the active path');

  // The transcript follows the same active path — the abandoned turn stays
  // in the file but must no longer render in /messages.
  const msgs = await get(`/api/sessions/${TREE_ID}/messages`);
  assert.equal(msgs.status, 200);
  const texts = msgs.body.messages.map(m => m.content?.[0]?.text);
  assert.ok(texts.includes('first prompt') && texts.includes('first answer'), 'active path still renders');
  assert.ok(!texts.includes('second prompt') && !texts.includes('second answer'),
    'abandoned branch messages are gone from the transcript');
});

test('POST /branch with an unknown entry id fails without touching the file', async () => {
  const size = fs.statSync(TREE_FILE).size;
  const { status } = await post(`/api/sessions/${TREE_ID}/branch`, { entryId: 'nope' });
  assert.equal(status, 500);
  assert.equal(fs.statSync(TREE_FILE).size, size);
});

test('branch_summary entries surface in /messages as branchSummary role', async () => {
  fs.appendFileSync(TREE_FILE, JSON.stringify({
    type: 'branch_summary', id: 'bs1', parentId: 'e2', fromId: 'e2',
    timestamp: '2026-07-04T14:00:05.000Z', summary: 'Explored **X**; conclusion Y.',
  }) + '\n');
  const { status, body } = await get(`/api/sessions/${TREE_ID}/messages`);
  assert.equal(status, 200);
  const bs = body.messages.find(m => m.role === 'branchSummary');
  assert.ok(bs, 'branch summary appears in the message stream');
  assert.equal(bs.content[0].text, 'Explored **X**; conclusion Y.');
});

test('POST /branch on a live bridge session forwards navigate_tree', async () => {
  const BRIDGE_ID = '2026-07-04T15-00-00-treelive';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const socketPath = path.join(tmpHome, 'dish-tree-test.sock');

  // Fake bridge that answers navigate_tree; records what it was asked.
  const received = [];
  let reply = { success: true, data: { editorText: 'from bridge' } };
  const socks = [];
  const bridge = net.createServer((sock) => {
    socks.push(sock);
    sock.write(JSON.stringify({ type: 'hello', turnInProgress: false }) + '\n');
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const cmd = JSON.parse(line);
        received.push(cmd);
        sock.write(JSON.stringify({ type: 'response', id: cmd.id, command: cmd.command, ...reply }) + '\n');
      }
    });
  });
  await new Promise(r => bridge.listen(socketPath, r));
  fs.writeFileSync(path.join(registryDir, `${BRIDGE_ID}.json`), JSON.stringify({
    sessionId: BRIDGE_ID, socketPath, pid: process.pid, cwd: '/home/user/proj', sessionFile: TREE_FILE,
  }));
  await new Promise(r => setTimeout(r, 600)); // registry scan memo TTL

  try {
    const ok = await post(`/api/sessions/${BRIDGE_ID}/branch`,
      { entryId: 'e2', summarize: true, customInstructions: 'focus on files' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.editorText, 'from bridge');
    const nav = received.find(c => c.command === 'navigate_tree');
    assert.ok(nav, 'bridge received navigate_tree');
    assert.equal(nav.targetId, 'e2');
    assert.equal(nav.summarize, true);
    assert.equal(nav.customInstructions, 'focus on files');

    // A bridge without a stashed command context (and no RPC backing to
    // prime it with) is a user-actionable condition, not a plain 500.
    reply = { success: false, error: 'no command context' };
    const blocked = await post(`/api/sessions/${BRIDGE_ID}/branch`, { entryId: 'e2' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /dish-push/);
  } finally {
    fs.rmSync(path.join(registryDir, `${BRIDGE_ID}.json`), { force: true });
    for (const s of socks) s.destroy();
    bridge.close();
  }
});

// --- Themes ----------------------------------------------------------------

test('GET /api/themes lists built-ins plus valid user theme files', async () => {
  const themesDir = path.join(tmpHome, '.pi', 'dish', 'themes');
  fs.mkdirSync(themesDir, { recursive: true });
  fs.writeFileSync(path.join(themesDir, 'mytheme.json'), JSON.stringify({
    '--bg-dark': '#101010',
    '--accent': 'rgb(1, 2, 3)',
    'not-a-token': '#fff',            // key must be a custom property
    '--evil': 'url(javascript:1)',    // value gated to color-ish strings
    '--also-bad': 42,                 // non-string value
  }));
  fs.writeFileSync(path.join(themesDir, 'broken.json'), '{ torn');

  const { status, body } = await get('/api/themes');
  assert.equal(status, 200);
  assert.deepEqual(body.themes.filter(t => t.builtin).map(t => t.id), ['solarized', 'graphite']);
  const custom = body.themes.find(t => t.id === 'mytheme');
  assert.ok(custom, 'user theme file is listed');
  assert.deepEqual(custom.tokens, { '--bg-dark': '#101010', '--accent': 'rgb(1, 2, 3)' },
    'invalid keys/values are dropped');
  assert.ok(!body.themes.some(t => t.id === 'broken'), 'unparseable file is skipped');
});

test('GET /api/themes without a themes dir serves the built-ins', async () => {
  fs.rmSync(path.join(tmpHome, '.pi', 'dish', 'themes'), { recursive: true, force: true });
  const { status, body } = await get('/api/themes');
  assert.equal(status, 200);
  assert.deepEqual(body.themes.map(t => t.id), ['solarized', 'graphite']);
});

// --- Public share links --------------------------------------------------
// TREE_ID is a valid pi v3 session; the HTML exporter (and thus GET
// /share/:token) rejects the id-less shorthand fixtures.

test('POST /share is idempotent and 404s for an unknown session', async () => {
  const first = await post(`/api/sessions/${TREE_ID}/share`, {});
  assert.equal(first.status, 200);
  assert.ok(first.body.token, 'a token is returned');
  assert.equal(first.body.path, `/share/${first.body.token}`);
  assert.equal(first.body.url, null, 'url is null without PI_DISH_SHARE_BASE_URL');

  const again = await post(`/api/sessions/${TREE_ID}/share`, {});
  assert.equal(again.body.token, first.body.token, 'same session reuses its token');

  const missing = await post('/api/sessions/does-not-exist/share', {});
  assert.equal(missing.status, 404);
});

test('GET /share/:token renders the exported HTML inline; unknown token 404s', async () => {
  const { body } = await post(`/api/sessions/${TREE_ID}/share`, {});
  const res = await fetch(`${base}/share/${body.token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('<html'), 'body is the standalone export');
  // The export embeds the entries (ids included) as base64 JSON and its
  // loader reads ?targetId= — the contract per-message share links rely on.
  const dataMatch = html.match(/id="session-data"[^>]*>([^<]+)</);
  assert.ok(dataMatch, 'export embeds session data');
  const payload = Buffer.from(dataMatch[1], 'base64').toString('utf8');
  assert.ok(payload.includes('"id":"e4"'), 'entry ids reach the export payload');
  assert.ok(html.includes('targetId'), 'export understands targetId deep links');

  const unknown = await fetch(`${base}/share/nonexistent-token`);
  assert.equal(unknown.status, 404);
});

test('GET/DELETE /share reflect and revoke the current share state', async () => {
  const created = await post(`/api/sessions/${TREE_ID}/share`, {});
  const state = await get(`/api/sessions/${TREE_ID}/share`);
  assert.equal(state.status, 200);
  assert.equal(state.body.token, created.body.token);

  const revoked = await del(`/api/sessions/${TREE_ID}/share`);
  assert.deepEqual(revoked.body, { revoked: true });

  const gone = await fetch(`${base}/share/${created.body.token}`);
  assert.equal(gone.status, 404, 'the token no longer resolves');
  const stateGone = await get(`/api/sessions/${TREE_ID}/share`);
  assert.equal(stateGone.status, 404, 'no share state after revoke');
  const revokedAgain = await del(`/api/sessions/${TREE_ID}/share`);
  assert.deepEqual(revokedAgain.body, { revoked: false });
});

test('dedicated share listener serves only raw shared sessions and pages', async () => {
  const { spawn } = require('node:child_process');
  // Create a share on the main server (writes shares.json under tmpHome; the
  // child reads the same HOME).
  const created = await post(`/api/sessions/${TREE_ID}/share`, {});
  const pageFile = path.join(realCwd, 'share-listener-page.html');
  const rawPage = '<!doctype html><h1>raw shared page</h1>';
  fs.writeFileSync(pageFile, rawPage);
  const page = await post('/api/pages', { path: pageFile, sessionId: REAL_CWD_ID });

  // Grab a free port for the share listener.
  const sharePort = await new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOME: tmpHome, PORT: '0', PI_DISH_SHARE_PORT: String(sharePort), PI_DISH_SHARE_HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  try {
    // Wait for the share listener to accept connections.
    const shareBase = `http://127.0.0.1:${sharePort}`;
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try {
        const r = await fetch(`${shareBase}/share/${created.body.token}`);
        if (r.status === 200) ready = true;
        await r.text();
      } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(ready, 'share listener came up and served the token');

    const pageRes = await fetch(`${shareBase}/page/${page.body.token}`);
    assert.equal(pageRes.status, 200);
    assert.equal(await pageRes.text(), rawPage, 'share listener does not inject the comment overlay');

    const notFound = await fetch(`${shareBase}/api/sessions`);
    assert.equal(notFound.status, 404, 'the share listener exposes nothing but /share');
  } finally {
    child.kill();
    await new Promise(r => child.on('exit', r));
  }
});

// Keep this test last: it appends to the fixture JSONL, changing the
// counts earlier tests assert on. It proves the parse caches revalidate.
test('session caches pick up JSONL appends (mtime/size revalidation)', async () => {
  const before = await get(`/api/sessions/${SESSION_ID}/messages`);
  assert.equal(before.body.totalMessages, 5);

  fs.appendFileSync(SESSION_FILE, JSON.stringify(
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'zulu addendum' }], timestamp: '2026-07-04T10:00:06.000Z' } },
  ) + '\n');

  const after = await get(`/api/sessions/${SESSION_ID}/messages`);
  assert.equal(after.body.totalMessages, 6, '/messages sees the appended message');

  const list = await get('/api/sessions');
  const sess = list.body.previous.find(s => s.id === SESSION_ID);
  assert.equal(sess.messageCount, 3, 'session list metadata refreshed');

  const search = await get(`/api/sessions/${SESSION_ID}/search?q=zulu`);
  assert.deepEqual(search.body.matches, [{ index: 5, role: 'user' }]);

  const listSearch = await get('/api/sessions?q=zulu');
  assert.ok(listSearch.body.previous.some(s => s.id === SESSION_ID), 'list search text refreshed');

  const stats = await get(`/api/sessions/${SESSION_ID}/stats`);
  assert.equal(stats.body.userMessages, 3, '/stats aggregate refreshed');
});

const { sseReader } = require('./sse-reader');

test('SSE replays remembered extension UI state to new connections', async () => {
  const BRIDGE_ID = '2026-07-04T13-00-00-eeff0011';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const socketPath = path.join(tmpHome, 'dish-bridge-test.sock');

  // Fake bridge: accept the server's socket, say hello, let the test emit
  // events (the real bridge's UI replay to *this* socket is irrelevant here —
  // we're proving the server's own replay to SSE clients).
  const bridgeSocks = [];
  const bridge = net.createServer((sock) => {
    bridgeSocks.push(sock);
    sock.write(JSON.stringify({ type: 'hello', turnInProgress: false }) + '\n');
  });
  await new Promise(r => bridge.listen(socketPath, r));
  fs.writeFileSync(path.join(registryDir, `${BRIDGE_ID}.json`), JSON.stringify({
    sessionId: BRIDGE_ID, socketPath, pid: process.pid, cwd: '/home/user/proj', sessionFile: SESSION_FILE,
  }));
  // The registry scan is memoized (~500ms); wait out the TTL so the stream
  // route sees the fresh entry.
  await new Promise(r => setTimeout(r, 600));
  const emit = (event, data) => {
    for (const s of bridgeSocks) s.write(JSON.stringify({ type: 'event', event, data }) + '\n');
  };

  try {
    // Compression middleware must not buffer event-stream chunks. Asking for
    // gzip still yields an identity-encoded stream.
    const streamHeaders = await fetch(`${base}/api/sessions/${BRIDGE_ID}/stream`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    assert.equal(streamHeaders.headers.get('content-encoding'), null);
    await streamHeaders.body.cancel();

    // First client: receives live emissions (and causes the server to connect).
    const s1 = sseReader(`${base}/api/sessions/${BRIDGE_ID}/stream`);
    await s1.waitFor(e => e.event === 'init');
    emit('extension_ui_request', { method: 'setWidget', widgetKey: 'procs', widgetLines: ['one', 'two'] });
    emit('extension_ui_request', { method: 'confirm', id: 'dlg1', title: 'Deploy?' });
    await s1.waitFor(e => e.event === 'extension_ui_request' && e.data?.method === 'confirm');
    s1.close();

    // Second client connects with the bridge silent: the remembered widget
    // and the still-pending dialog are replayed.
    const s2 = sseReader(`${base}/api/sessions/${BRIDGE_ID}/stream`);
    const widget = await s2.waitFor(e => e.event === 'extension_ui_request' && e.data?.method === 'setWidget');
    assert.deepEqual(widget.data.widgetLines, ['one', 'two']);
    assert.equal(widget.data.widgetKey, 'procs');
    await s2.waitFor(e => e.event === 'extension_ui_request' && e.data?.id === 'dlg1');

    // Clearing the widget and resolving the dialog empties the replay set.
    // Wait for both on the open connection so the server has seen them.
    emit('extension_ui_request', { method: 'setWidget', widgetKey: 'procs', widgetLines: [] });
    emit('extension_ui_resolved', { id: 'dlg1' });
    await s2.waitFor(e => e.event === 'extension_ui_resolved');
    s2.close();

    // Third client: nothing replayed. The sentinel notify proves we waited
    // long enough for a replay to have arrived if there were one.
    const s3 = sseReader(`${base}/api/sessions/${BRIDGE_ID}/stream`);
    await s3.waitFor(e => e.event === 'init');
    emit('extension_ui_request', { method: 'notify', message: 'sentinel' });
    await s3.waitFor(e => e.event === 'extension_ui_request' && e.data?.method === 'notify');
    const extEvents = s3.events.filter(e => e.event === 'extension_ui_request');
    assert.equal(extEvents.length, 1, 'cleared widget / resolved dialog must not be replayed');
    s3.close();
  } finally {
    fs.rmSync(path.join(registryDir, `${BRIDGE_ID}.json`), { force: true });
    for (const s of bridgeSocks) s.destroy();
    bridge.close();
  }
});

test('/reload maps a run_command socket teardown to success (old-bridge race)', async () => {
  const BRIDGE_ID = '2026-07-19T10-00-00-re10ad01';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const socketPath = path.join(tmpHome, 'dish-reload-test.sock');

  // A bridge that fires its reload before the response frame flushes looks
  // like this from the server: the run_command request goes out, the socket
  // dies. That must read as "reload started", not an error.
  const bridge = net.createServer((sock) => {
    sock.write(JSON.stringify({ type: 'hello', turnInProgress: false }) + '\n');
    sock.on('data', () => sock.destroy());
    sock.on('error', () => {});
  });
  await new Promise(r => bridge.listen(socketPath, r));
  fs.writeFileSync(path.join(registryDir, `${BRIDGE_ID}.json`), JSON.stringify({
    sessionId: BRIDGE_ID, socketPath, pid: process.pid, cwd: '/home/user/proj', sessionFile: SESSION_FILE,
  }));
  await new Promise(r => setTimeout(r, 600)); // registry memo TTL

  try {
    const { status, body } = await post(`/api/sessions/${BRIDGE_ID}/command`, { message: '/reload' });
    assert.equal(status, 200, JSON.stringify(body));
    assert.match(body.info || '', /reload/i);
  } finally {
    fs.rmSync(path.join(registryDir, `${BRIDGE_ID}.json`), { force: true });
    bridge.close();
  }
});

test('GET /api/config reports terminal disabled without PI_DISH_TERMINAL=1', async () => {
  const { status, body } = await get('/api/config');
  assert.equal(status, 200);
  assert.equal(body.terminal, false);
});

test('terminal-disabled startup omits xterm assets and compresses large static text', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.doesNotMatch(html, /vendor\/xterm(?:-addon-fit)?\.(?:js|css)/,
    'feature-gated terminal assets must not be part of the initial document');

  const identity = await rawGet('/app.js', { 'Accept-Encoding': 'identity' });
  const gzip = await rawGet('/app.js', { 'Accept-Encoding': 'gzip' });
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.match(gzip.headers.vary || '', /Accept-Encoding/i);
  assert.deepEqual(zlib.gunzipSync(gzip.body), identity.body);
  assert.ok(gzip.body.length < identity.body.length * 0.5,
    `expected at least 50% savings (${identity.body.length} -> ${gzip.body.length})`);
});
