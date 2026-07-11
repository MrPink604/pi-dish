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
const net = require('node:net');
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

const del = async (p) => {
  const res = await fetch(base + p, { method: 'DELETE' });
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
  assert.equal(await res.text(), '<h1>the plan</h1>');

  // Live from disk: an edit shows without re-publishing.
  fs.writeFileSync(planFile, '<h1>the revised plan</h1>');
  assert.equal(await (await fetch(base + body.path)).text(), '<h1>the revised plan</h1>');

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

test('POST /api/pages validates the root and gates it to session reach', async () => {
  const rel = await post('/api/pages', { path: 'plan.html' });
  assert.equal(rel.status, 400, 'relative paths rejected');
  const missing = await post('/api/pages', { path: path.join(realCwd, 'nope.html') });
  assert.equal(missing.status, 404, 'nonexistent path rejected');

  // Outside every session cwd and the drop dir → 403, with or without a
  // session id (tokens can be exposed on the public share listener).
  const secret = path.join(tmpHome, 'secret.txt');
  assert.equal((await post('/api/pages', { path: secret })).status, 403);
  assert.equal((await post('/api/pages', { path: secret, sessionId: REAL_CWD_ID })).status, 403);

  // A directory without index.html can't be a page.
  const bare = path.join(realCwd, 'no-index');
  fs.mkdirSync(bare, { recursive: true });
  assert.equal((await post('/api/pages', { path: bare, sessionId: REAL_CWD_ID })).status, 400);

  // The ~/.pi/dish/pages drop dir is publishable without any session.
  const dropDir = path.join(tmpHome, '.pi', 'dish', 'pages');
  fs.mkdirSync(dropDir, { recursive: true });
  const dropped = path.join(dropDir, 'note.html');
  fs.writeFileSync(dropped, '<p>dropped</p>');
  const ok = await post('/api/pages', { path: dropped });
  assert.equal(ok.status, 200);
  await del(`/api/pages/${ok.body.token}`);
});

test('GET /page with an unknown token is a bare 404', async () => {
  const res = await fetch(base + '/page/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'Not found');
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

test('dedicated share listener serves only /share/:token', async () => {
  const { spawn } = require('node:child_process');
  // Create a share on the main server (writes shares.json under tmpHome; the
  // child reads the same HOME).
  const created = await post(`/api/sessions/${TREE_ID}/share`, {});

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

test('GET /api/config reports terminal disabled without PI_DISH_TERMINAL=1', async () => {
  const { status, body } = await get('/api/config');
  assert.equal(status, 200);
  assert.equal(body.terminal, false);
});
