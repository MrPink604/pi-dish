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
const os = require('node:os');
const path = require('node:path');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-test-'));
process.env.HOME = tmpHome;
process.env.PORT = '0'; // random free port

const SESSION_ID = '2026-07-04T10-00-00-abcdef12';
const sessionDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-proj--');
fs.mkdirSync(sessionDir, { recursive: true });

const entries = [
  { type: 'session', cwd: '/home/user/proj', timestamp: '2026-07-04T10:00:00.000Z' },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hello alpha' }], timestamp: '2026-07-04T10:00:01.000Z' } },
  { type: 'message', message: { role: 'assistant', content: [
    { type: 'text', text: 'bravo reply with **markdown**' },
    { type: 'toolCall', id: 'tc1', name: 'Bash', arguments: { command: 'ls' } },
  ], usage: { input: 100, output: 40, cacheRead: 10, cacheWrite: 5, totalTokens: 1234, cost: { total: 0.03 } }, timestamp: '2026-07-04T10:00:02.000Z' } },
  { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'charlie output' }], timestamp: '2026-07-04T10:00:03.000Z' } },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'delta question alpha' }], timestamp: '2026-07-04T10:00:04.000Z' } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'echo final' }], usage: { input: 200, output: 60, cacheRead: 0, cacheWrite: 0, totalTokens: 1234, cost: { total: 0.02 } }, timestamp: '2026-07-04T10:00:05.000Z' } },
];
const SESSION_FILE = path.join(sessionDir, `${SESSION_ID}.jsonl`);
fs.writeFileSync(SESSION_FILE, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

// Second fixture whose cwd exists on disk — exercises /files fuzzy search.
const REAL_CWD_ID = '2026-07-04T11-00-00-bbccdd34';
const realCwd = path.join(tmpHome, 'workspace', 'proj-alpha');
fs.mkdirSync(path.join(realCwd, 'src'), { recursive: true });
fs.writeFileSync(path.join(realCwd, 'src', 'main.js'), 'console.log(1);\n');
fs.writeFileSync(path.join(realCwd, 'README.md'), '# alpha\n');
fs.writeFileSync(
  path.join(sessionDir, `${REAL_CWD_ID}.jsonl`),
  [
    { type: 'session', cwd: realCwd, timestamp: '2026-07-04T11:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: '2026-07-04T11:00:01.000Z' } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n',
);

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

test('GET /api/sessions?active=1 skips the historical scan', async () => {
  const { status, body } = await get('/api/sessions?active=1');
  assert.equal(status, 200);
  assert.deepEqual(body.previous, [], 'previous list omitted on active-only polls');
  assert.ok(Array.isArray(body.active));
});

test('GET /api/sessions?q= filters on message content', async () => {
  const hit = await get('/api/sessions?q=bravo');
  assert.ok(hit.body.previous.some(s => s.id === SESSION_ID));
  const miss = await get('/api/sessions?q=zzz-not-there');
  assert.ok(!miss.body.previous.some(s => s.id === SESSION_ID));
});

test('GET /messages returns the tail with indexes', async () => {
  const { body } = await get(`/api/sessions/${SESSION_ID}/messages`);
  assert.equal(body.totalMessages, 5);
  assert.equal(body.firstIndex, 0);
  assert.equal(body.lastIndex, 4);
  assert.equal(body.hasMore, false);
  assert.deepEqual(body.messages.map(m => m.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(body.messages.map(m => m.role), ['user', 'assistant', 'toolResult', 'user', 'assistant']);
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

test('GET /files with a missing cwd degrades to an empty list', async () => {
  // fixture session's cwd (/home/user/proj) does not exist on disk
  const { status, body } = await get(`/api/sessions/${SESSION_ID}/files?q=x`);
  assert.equal(status, 200);
  assert.deepEqual(body.files, []);
});

test('PUT /api/models/enabled persists pi scoped models in settings.json', async () => {
  const settingsFile = path.join(tmpHome, '.pi', 'agent', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }));

  const put = async (body) => {
    const res = await fetch(base + '/api/models/enabled', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  // Scope down to two models — other settings fields survive
  const scoped = await put({ enabledIds: ['anthropic/claude-sonnet-4-5', 'zai/glm-5.2'] });
  assert.equal(scoped.status, 200);
  let settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  assert.deepEqual(settings.enabledModels, ['anthropic/claude-sonnet-4-5', 'zai/glm-5.2']);
  assert.equal(settings.theme, 'dark');

  // null clears the filter entirely (pi treats absent/empty as all enabled)
  const cleared = await put({ enabledIds: null });
  assert.equal(cleared.status, 200);
  settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  assert.equal('enabledModels' in settings, false);

  // Empty array behaves like clearing too
  await put({ enabledIds: ['x/y'] });
  await put({ enabledIds: [] });
  settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  assert.equal('enabledModels' in settings, false);

  // Malformed bodies are rejected
  const bad = await put({ enabledIds: 'not-an-array' });
  assert.equal(bad.status, 400);
  const badItems = await put({ enabledIds: ['ok', 42] });
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
  assert.equal(body.cwd, '/home/user/proj');
  assert.equal(body.contextUsage.tokens, 1234);
  const missing = await get('/api/sessions/nope/stats');
  assert.equal(missing.status, 404);
});

test('POST endpoints validate input and reject inactive sessions', async () => {
  const post = async (p, body) => {
    const res = await fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

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
