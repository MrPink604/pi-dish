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
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-test-'));
process.env.HOME = tmpHome;
process.env.PORT = '0'; // random free port
process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${path.join(__dirname, 'fixtures', 'fake-omp-export.js')}`;
// The runtime pid-fallback (describeRuntime → findPaneByPid) scans every tmux
// server under the tmpdir; point it at an empty temp dir so a tmux session
// enclosing `npm test` can't leak into the runtime assertions below.
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-test-tmux-'));
const { encodeSessionKey } = require('../lib/session-key');

const SESSION_ID = '2026-07-04T10-00-00-abcdef12';
const OMP_SESSION_ID = 'omp-prefix-real';
const OMP_ROUTE_ID = encodeSessionKey('omp', OMP_SESSION_ID);
const ompCwd = path.join(tmpHome, 'workspace', 'omp-project');
const ompSessionFile = path.join(tmpHome, '.omp', 'agent', 'sessions', 'project', `${OMP_SESSION_ID}.jsonl`);
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
  { type: 'message', id: 'img00001', message: { role: 'toolResult', content: [
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

// Nested generic session.jsonl, matching alternative launcher layouts. Its
// authoritative identity comes from the core Pi header and its native
// parentSession relationship points at the ordinary fixture above.
const NESTED_SESSION_ID = 'nested-core-child';
const NESTED_SESSION_FILE = path.join(sessionDir, SESSION_ID, 'scope-a', 'run-0', 'session.jsonl');
fs.mkdirSync(path.dirname(NESTED_SESSION_FILE), { recursive: true });
fs.writeFileSync(NESTED_SESSION_FILE, [
  { type: 'session', version: 3, id: NESTED_SESSION_ID, cwd: '/home/user/proj', parentSession: SESSION_FILE, timestamp: '2026-07-04T10:10:00.000Z' },
  { type: 'message', id: 'nested-u1', parentId: null, timestamp: '2026-07-04T10:10:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'nested peer question' }] } },
].map(e => JSON.stringify(e)).join('\n') + '\n');

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

// Fifth fixture: an image on a tree branch. Its resource URL must remain
// bound to the JSONL entry after a later append selects a sibling branch.
const IMAGE_TREE_ID = '2026-07-04T14-30-00-imgtree1';
const IMAGE_TREE_FILE = path.join(sessionDir, `${IMAGE_TREE_ID}.jsonl`);
fs.writeFileSync(IMAGE_TREE_FILE, [
  { type: 'session', version: 3, id: 'image-tree-session', cwd: '/home/user/proj', timestamp: '2026-07-04T14:30:00.000Z' },
  { type: 'message', id: 'root0001', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'show image' }] } },
  { type: 'message', id: 'base0001', parentId: 'root0001', message: { role: 'assistant', content: [{ type: 'text', text: 'reading' }] } },
  { type: 'message', id: 'image001', parentId: 'base0001', message: { role: 'toolResult', content: [
    { type: 'image', data: TINY_PNG_BASE64, mimeType: 'image/png' },
  ] } },
].map(e => JSON.stringify(e)).join('\n') + '\n');

// OMP blob-store fixture: OMP persists image bytes (≥1KB base64) outside the
// JSONL as `data: "blob:sha256:<hex>"` refs, raw bytes content-addressed in
// ~/.omp/agent/blobs/<hex>. The image resource route must serve those bytes
// (decoding the ref as base64 yields garbage) and 404 on a missing blob.
const OMP_BLOB_SESSION_ID = 'omp-blob-image';
const OMP_BLOB_ROUTE_ID = encodeSessionKey('omp', OMP_BLOB_SESSION_ID);
const TINY_PNG_SHA256 = crypto.createHash('sha256').update(TINY_PNG).digest('hex');
const ompBlobsDir = path.join(tmpHome, '.omp', 'agent', 'blobs');
fs.mkdirSync(ompBlobsDir, { recursive: true });
fs.writeFileSync(path.join(ompBlobsDir, TINY_PNG_SHA256), TINY_PNG);
const ompBlobSessionFile = path.join(tmpHome, '.omp', 'agent', 'sessions', 'project', `${OMP_BLOB_SESSION_ID}.jsonl`);
fs.mkdirSync(path.dirname(ompBlobSessionFile), { recursive: true });
fs.writeFileSync(ompBlobSessionFile, [
  { type: 'session', version: 3, id: OMP_BLOB_SESSION_ID, cwd: '/home/user/proj' },
  { type: 'message', id: 'blob-u1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'screenshot the page' }] } },
  { type: 'message', id: 'blob-t1', parentId: 'blob-u1', message: { role: 'toolResult', toolName: 'browser', content: [
    { type: 'image', data: `blob:sha256:${TINY_PNG_SHA256}`, mimeType: 'image/png' },
    { type: 'image', data: `blob:sha256:${'f'.repeat(64)}`, mimeType: 'image/png' },
  ] } },
].map(e => JSON.stringify(e)).join('\n') + '\n');

// Skills fixture: a global user skill plus a session that reads part of it,
// invokes it explicitly (/skill: block), and greps it (targeted touch).
const SKILL_DIR = path.join(tmpHome, '.pi', 'agent', 'skills', 'demo');
fs.mkdirSync(SKILL_DIR, { recursive: true });
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const skillBody = [
  '---', 'name: demo', 'description: A demo skill for the skills-view tests.', '---',
  '', '# Demo skill', 'Intro paragraph line.', '',
  '## Section A', ...Array.from({ length: 10 }, (_, i) => `A body line ${i} with some words here.`),
  '', '## Section B (never read)', ...Array.from({ length: 10 }, (_, i) => `B body line ${i} that no read will ever reach in these tests.`),
  '', '## Section C (never read)', ...Array.from({ length: 10 }, (_, i) => `C appendix line ${i} of legacy notes nobody loads.`),
  '',
].join('\n');
fs.writeFileSync(SKILL_MD, skillBody);
// Age the skill so the fixture reads (2026-07-20) map against it, while the
// explicit invocation (2026-07-10) predates it and is excluded from the map.
const skillEdited = new Date('2026-07-15T00:00:00.000Z');
fs.utimesSync(SKILL_MD, skillEdited, skillEdited);
const explicitBlock = `<skill name="demo" location="${SKILL_MD}">\nReferences are relative to ${SKILL_DIR}.\n\n${skillBody}\n</skill>`;
const SKILLS_SESSION_ID = '2026-07-20T09-00-00-skill001';
fs.writeFileSync(path.join(sessionDir, `${SKILLS_SESSION_ID}.jsonl`), [
  { type: 'session', cwd: '/home/user/proj', timestamp: '2026-07-20T09:00:00.000Z' },
  { type: 'model_change', provider: 'anthropic', modelId: 'claude-demo' },
  { type: 'message', id: 'skx1', timestamp: '2026-07-10T09:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: explicitBlock }] } },
  { type: 'message', id: 'skr1', timestamp: '2026-07-20T09:00:01.000Z', message: { role: 'assistant', content: [
    { type: 'toolCall', id: 'sktc1', name: 'read', arguments: { path: SKILL_MD, offset: 1, limit: 12 } },
  ] } },
  { type: 'message', id: 'skb1', timestamp: '2026-07-20T09:00:02.000Z', message: { role: 'assistant', content: [
    { type: 'toolCall', id: 'sktc2', name: 'bash', arguments: { command: `grep -n Section ${SKILL_MD}` } },
  ] } },
].map(e => JSON.stringify(e)).join('\n') + '\n');

const server = require('../server.js');
const piSDK = require('../lib/pi-sdk');
const tmux = require('../lib/tmux');
const harnessPricing = require('../lib/harness-pricing');
const { invalidateRegistryCache } = require('../lib/bridge-session');
const { processIdentity, processIdentityAlive } = require('../lib/process-identity');
const sessionProvenance = require('../lib/session-provenance');

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

const patch = async (p, body) => {
  const res = await fetch(base + p, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const del = async (p, body) => {
  const res = await fetch(base + p, body === undefined ? { method: 'DELETE' } : {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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

test('encoded alternative-harness routes never fall back to a partial native id', async () => {
  const ompDir = path.join(tmpHome, '.omp', 'agent', 'sessions', 'project');
  fs.mkdirSync(ompDir, { recursive: true });
  fs.mkdirSync(ompCwd, { recursive: true });
  fs.writeFileSync(ompSessionFile, [
    { type: 'title', title: 'Exact OMP fixture' },
    { type: 'session', version: 3, id: OMP_SESSION_ID, cwd: ompCwd },
    { type: 'message', id: 'omp-u1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'OMP shared prompt' }] } },
    { type: 'message', id: 'omp-a1', parentId: 'omp-u1', message: { role: 'assistant', content: [{ type: 'text', text: 'OMP shared answer' }] } },
  ].map(JSON.stringify).join('\n') + '\n');

  const exact = await get(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/stats`);
  assert.equal(exact.status, 200, JSON.stringify(exact.body));

  const partial = await get(`/api/sessions/${encodeURIComponent(encodeSessionKey('omp', 'omp-prefix'))}/stats`);
  assert.equal(partial.status, 404, 'a canonical encoded route must not select a partial native-id match');
});

test('OMP sibling-directory subagents are addressable and appear as session relations', async () => {
  const childNativeId = 'omp-subagent-native-id';
  const childRouteId = encodeSessionKey('omp', childNativeId);
  const childFile = path.join(ompSessionFile.slice(0, -'.jsonl'.length), 'Explore.jsonl');
  fs.mkdirSync(path.dirname(childFile), { recursive: true });
  fs.writeFileSync(childFile, [
    { type: 'title', title: 'Explore subagent' },
    { type: 'session', version: 3, id: childNativeId, cwd: ompCwd },
    { type: 'message', id: 'omp-sub-u1', parentId: null, message: {
      role: 'user', content: [{ type: 'text', text: 'Inspect the OMP code' }],
    } },
  ].map(JSON.stringify).join('\n') + '\n');

  const listed = await get('/api/sessions');
  const child = listed.body.previous.find(session => session.id === childRouteId);
  assert.ok(child, 'OMP subagent is listed under its native header id');
  assert.equal(child.parentId, OMP_ROUTE_ID);
  assert.equal(child.parentSource, 'omp-subsession-layout');
  assert.equal(child.familyParentId, OMP_ROUTE_ID, 'same-workspace OMP subagent joins the sidebar family');

  const childRelated = await get(`/api/sessions/${encodeURIComponent(childRouteId)}/related`);
  assert.ok(childRelated.body.relations.some(relation =>
    relation.kind === 'parent' && relation.source === 'omp-subsession-layout' && relation.session.id === OMP_ROUTE_ID));
  const parentRelated = await get(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/related`);
  assert.ok(parentRelated.body.relations.some(relation =>
    relation.kind === 'child' && relation.source === 'omp-subsession-layout' && relation.session.id === childRouteId));

  const messages = await get(`/api/sessions/${encodeURIComponent(childRouteId)}/messages?limit=10`);
  assert.equal(messages.status, 200);
  assert.equal(messages.body.messages[0].content[0].text, 'Inspect the OMP code');
});

test('fresh live routes distinguish missing history, then use the session file before indexing', async () => {
  const nativeId = 'fresh-live-unindexed';
  const routeId = encodeSessionKey('omp', nativeId);
  const liveDir = path.join(tmpHome, 'live-only');
  const sessionFile = path.join(liveDir, 'fresh.jsonl');
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  const socketPath = path.join(liveDir, 'socket-stub');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.mkdirSync(liveDir, { recursive: true });
  fs.writeFileSync(socketPath, 'registry reachability stub');
  const identity = processIdentity(process.pid);
  const registryPath = path.join(registryDir, `${nativeId}.json`);
  fs.writeFileSync(registryPath, JSON.stringify({
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp', nativeSessionId: nativeId, sessionId: nativeId,
    bridgeInstanceId: 'fresh-live-bridge', instanceId: 'fresh-live-bridge',
    sessionFile, socketPath, cwd: liveDir,
    pid: identity.pid, startTime: identity.startTime,
    capabilities: {}, spawnToken: null,
  }));
  invalidateRegistryCache();

  try {
    for (const [method, suffix] of [['GET', 'stats'], ['GET', 'export'], ['POST', 'share']]) {
      const response = await fetch(`${base}/api/sessions/${encodeURIComponent(routeId)}/${suffix}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? '{}' : undefined,
      });
      assert.equal(response.status, 409, `${method} /${suffix}`);
      assert.deepEqual(await response.json(), { error: 'Session has no persisted history yet' });
    }

    fs.writeFileSync(sessionFile, [
      { type: 'title', title: 'Fresh live OMP fixture' },
      { type: 'session', version: 3, id: nativeId, cwd: liveDir },
      { type: 'message', id: 'fresh-u1', parentId: null, message: { role: 'user', content: 'not indexed yet' } },
    ].map(JSON.stringify).join('\n') + '\n');

    const stats = await get(`/api/sessions/${encodeURIComponent(routeId)}/stats`);
    assert.equal(stats.status, 200, JSON.stringify(stats.body));
    assert.equal(stats.body.sessionFile, sessionFile);

    const exported = await fetch(`${base}/api/sessions/${encodeURIComponent(routeId)}/export`);
    assert.equal(exported.status, 200, await exported.text());
    assert.match(exported.headers.get('content-type') || '', /text\/html/);

    const shared = await post(`/api/sessions/${encodeURIComponent(routeId)}/share`, {});
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.ok(shared.body.token);

    const tree = await get(`/api/sessions/${encodeURIComponent(routeId)}/tree`);
    assert.equal(tree.status, 409, JSON.stringify(tree.body));
    assert.match(tree.body.error, /no reachable live bridge for tree reads/i);
    await del(`/api/sessions/${encodeURIComponent(routeId)}/share`);
  } finally {
    fs.rmSync(registryPath, { force: true });
    invalidateRegistryCache();
  }
});

test('a wrapper bridge claiming a session hides the stock pi bridge riding in the same process', async () => {
  // OMP embeds pi's extension API, so the stock pi-dish-bridge from the
  // wrapper's user-extension directory also loads and used to register the
  // same session a second time as a plain pi session — one logical session
  // listed twice, with the pi claim thrashing the session index.
  const nativeId = 'wrapped-double-claim';
  const ompRouteId = encodeSessionKey('omp', nativeId);
  const liveDir = path.join(tmpHome, 'wrapped-live');
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(liveDir, { recursive: true });
  fs.mkdirSync(registryDir, { recursive: true });
  const socketOmp = path.join(liveDir, 'sock-omp');
  const socketPi = path.join(liveDir, 'sock-pi');
  fs.writeFileSync(socketOmp, 'stub');
  fs.writeFileSync(socketPi, 'stub');
  const identity = processIdentity(process.pid);
  const ompEntry = {
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp', nativeSessionId: nativeId, sessionId: nativeId,
    bridgeInstanceId: 'wrapped-omp-bridge', instanceId: 'wrapped-omp-bridge',
    socketPath: socketOmp, cwd: liveDir,
    pid: identity.pid, startTime: identity.startTime,
    capabilities: {}, spawnToken: null,
  };
  const piEntry = {
    sessionId: nativeId,
    socketPath: socketPi,
    cwd: liveDir,
    pid: process.pid,
  };
  const ompRegistryPath = path.join(registryDir, 'omp-wrapped-double-claim.json');
  const piRegistryPath = path.join(registryDir, 'pi-wrapped-double-claim.json');

  fs.writeFileSync(piRegistryPath, JSON.stringify(piEntry));
  invalidateRegistryCache();
  try {
    // Before the wrapper claims the process, the stock pi entry stands on
    // its own (legacy shape, live pid) and is listed as a live pi session.
    let active = await get('/api/sessions?active=1');
    assert.ok(active.body.active.some((s) => s.harnessId === 'pi' && s.nativeSessionId === nativeId),
      'lone stock bridge claim is listed');

    // The wrapper's sessionFile matches the OMP corpus, not any pi session.
    const sessionFile = path.join(tmpHome, '.omp', 'agent', 'sessions', '--tmp--', `${nativeId}.jsonl`);
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, [
      { type: 'title', title: 'Wrapped session' },
      { type: 'session', version: 3, id: nativeId, cwd: liveDir },
    ].map(JSON.stringify).join('\n') + '\n');

    // A manually launched wrapper host has no wrapper bridge claim at all —
    // only the stock bridge riding its user-extension directory. Its claim
    // points into the OMP config tree, which a pi session can never own.
    fs.writeFileSync(piRegistryPath, JSON.stringify({ ...piEntry, sessionFile }));
    invalidateRegistryCache();
    active = await get('/api/sessions?active=1');
    assert.ok(!active.body.active.some((s) => s.nativeSessionId === nativeId),
      'a pi claim on a wrapper-corpus file is hidden even without a competing wrapper claim');
    const orphanRoute = await get(`/api/sessions/${encodeURIComponent(nativeId)}/stats`);
    assert.equal(orphanRoute.status, 404, 'the bare pi route must not address a wrapper-corpus session');

    fs.writeFileSync(ompRegistryPath, JSON.stringify({ ...ompEntry, sessionFile }));
    invalidateRegistryCache();

    active = await get('/api/sessions?active=1');
    const claimed = active.body.active.filter((s) => s.nativeSessionId === nativeId);
    assert.equal(claimed.length, 1, `exactly one row for the doubly-claimed session: ${JSON.stringify(claimed.map((s) => s.harnessId))}`);
    assert.equal(claimed[0].harnessId, 'omp', 'the wrapper-specific claim wins');

    // The shadowed bare pi route no longer resolves through the registry.
    const bare = await get(`/api/sessions/${encodeURIComponent(nativeId)}/stats`);
    assert.equal(bare.status, 404, 'shadowed generic-pi route must not address the wrapper session');
    const viaWrapper = await get(`/api/sessions/${encodeURIComponent(ompRouteId)}/stats`);
    assert.equal(viaWrapper.status, 200, 'wrapper route still resolves');
  } finally {
    fs.rmSync(ompRegistryPath, { force: true });
    fs.rmSync(piRegistryPath, { force: true });
    invalidateRegistryCache();
  }
});

test('historical alternative-harness IDs associate pages and workspace choices canonically', async () => {
  const artifact = path.join(ompCwd, 'omp-page.html');
  fs.writeFileSync(artifact, '<p>OMP page</p>');
  const published = await post('/api/pages', { path: artifact, sessionId: OMP_ROUTE_ID });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.sessionId, OMP_ROUTE_ID);

  const cwds = await get('/api/cwds');
  assert.equal(cwds.status, 200);
  assert.ok(cwds.body.some((entry) => entry.path === ompCwd), 'OMP session cwd is offered to launch controls');
  await del(`/api/pages/${published.body.token}`);
});

test('alternative harnesses do not decode Pi workspace directory names as cwd', async () => {
  const nativeId = 'omp-headerless-cwd';
  const misleadingDir = path.join(tmpHome, '.omp', 'agent', 'sessions', '--tmp--');
  fs.mkdirSync(misleadingDir, { recursive: true });
  fs.writeFileSync(path.join(misleadingDir, `${nativeId}.jsonl`),
    JSON.stringify({ type: 'message', message: { role: 'user', content: 'no cwd header' } }) + '\n');
  const sessions = await get('/api/sessions');
  const routeId = encodeSessionKey('omp', nativeId);
  const listed = sessions.body.previous.find((entry) => entry.id === routeId);
  assert.ok(listed, 'headerless OMP fixture is discoverable');
  assert.equal(listed.cwd, null, 'existing /tmp is not fabricated from Pi directory-name conventions');
});

test('nested generic sessions use the core header id and remain fully addressable', async () => {
  const listed = await get('/api/sessions');
  const nested = listed.body.previous.find(s => s.id === NESTED_SESSION_ID);
  assert.ok(nested, 'nested session should be indexed under its header id');
  assert.equal(nested.parentSession, SESSION_FILE);
  assert.equal(nested.parentId, SESSION_ID, 'list rows carry resolved native parent identity');
  assert.equal(nested.parentSource, 'pi-session-header');
  assert.equal(nested.familyParentId, SESSION_ID, 'same-cwd lineage is approved for sidebar grouping');
  const filtered = await get('/api/sessions?q=nested%20peer%20question');
  const filteredChild = filtered.body.previous.find(s => s.id === NESTED_SESSION_ID);
  assert.equal(filteredChild.familyParentId, SESSION_ID,
    'filtered child retains stable family identity when the parent row is absent');

  const messages = await get(`/api/sessions/${NESTED_SESSION_ID}/messages?limit=10`);
  assert.equal(messages.status, 200);
  assert.equal(messages.body.messages[0].content[0].text, 'nested peer question');

  const related = await get(`/api/sessions/${NESTED_SESSION_ID}/related`);
  assert.equal(related.status, 200);
  const parent = related.body.relations.find(r => r.kind === 'parent' && r.source === 'pi-session-header');
  assert.equal(parent.session.id, SESSION_ID);

  const inverse = await get(`/api/sessions/${SESSION_ID}/related`);
  const child = inverse.body.relations.find(r => r.kind === 'child' && r.source === 'pi-session-header');
  assert.equal(child.session.id, NESTED_SESSION_ID);
});

test('stale native parent paths do not attach by basename alone', async () => {
  const id = '2026-07-04T10-12-00-stale-parent';
  const file = path.join(sessionDir, `${id}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({
    type: 'session', id: 'stale-core-id', cwd: '/home/user/proj',
    parentSession: path.join(tmpHome, 'old-location', `${SESSION_ID}.jsonl`),
    timestamp: '2026-07-04T10:12:00.000Z',
  }) + '\n');
  try {
    const listed = await get('/api/sessions');
    const stale = listed.body.previous.find(s => s.id === id);
    assert.ok(stale);
    assert.equal(stale.parentId, null, 'unresolved path cannot collide with a current basename');
    assert.equal(stale.familyParentId, null);
  } finally {
    fs.rmSync(file, { force: true });
    await get('/api/sessions');
  }
});

test('alien JSONL basenames are skipped without breaking sessions or usage APIs', async () => {
  const alien = path.join(sessionDir, '2026-01-01T00-00-00+00-00_deadbeef.jsonl');
  fs.writeFileSync(alien, JSON.stringify({ type: 'session', cwd: '/alien' }) + '\n');
  try {
    const listed = await get('/api/sessions');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.discoverySkipped, 1);
    assert.equal(listed.body.previous.some(session => session.sessionFile === alien), false);

    const usage = await get('/api/usage-summary?days=all');
    assert.equal(usage.status, 200);
    assert.equal(usage.body.discoverySkipped, 1);
  } finally {
    fs.rmSync(alien, { force: true });
  }
});

test('a newly ambiguous nested header id invalidates route lookup', async () => {
  const cached = await get(`/api/sessions/${NESTED_SESSION_ID}/messages?limit=10`);
  assert.equal(cached.status, 200);
  const duplicate = path.join(sessionDir, 'duplicate-scope', 'run-0', 'session.jsonl');
  fs.mkdirSync(path.dirname(duplicate), { recursive: true });
  fs.writeFileSync(duplicate, JSON.stringify({
    type: 'session', id: NESTED_SESSION_ID, cwd: '/home/user/proj', timestamp: '2026-07-04T10:11:00.000Z',
  }) + '\n');
  try {
    const routed = await get(`/api/sessions/${NESTED_SESSION_ID}/messages?limit=10`);
    assert.equal(routed.status, 200, 'the messages endpoint preserves its empty-unknown response contract');
    assert.equal(routed.body.totalMessages, 0,
      'route access revalidates generic ambiguity before the next full list scan');
    const listed = await get('/api/sessions');
    assert.equal(listed.body.previous.some(s => s.id === NESTED_SESSION_ID), false);
  } finally {
    fs.rmSync(path.dirname(duplicate), { recursive: true, force: true });
    await get('/api/sessions');
  }
});

test('pi-dish launch provenance adds neutral related-session navigation', async () => {
  sessionProvenance.recordLaunch(REAL_CWD_ID, SESSION_ID, 'test-operation');
  const listed = await get('/api/sessions');
  const launched = listed.body.previous.find(s => s.id === REAL_CWD_ID);
  assert.equal(launched.parentId, SESSION_ID, 'list rows carry advisory pi-dish launch parent');
  assert.equal(launched.parentSource, 'pi-dish-launch');
  assert.equal(launched.familyParentId, null, 'cross-workspace launch remains visually independent');
  const source = await get(`/api/sessions/${SESSION_ID}/related`);
  assert.ok(source.body.relations.some(r => r.kind === 'startedHere' && r.session.id === REAL_CWD_ID));
  const child = await get(`/api/sessions/${REAL_CWD_ID}/related`);
  assert.ok(child.body.relations.some(r => r.kind === 'startedFrom' && r.session.id === SESSION_ID));
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

test('GET /api/sessions?active=1&q= content-matches registered sessions', async () => {
  // The sidebar's Active tab searches server-side too — a live session must
  // match on transcript content (with a snippet), not just metadata.
  const ID = '2026-07-27T10-00-00-actsrch1';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const sockStub = path.join(tmpHome, 'actsearch-sock-stub');
  fs.writeFileSync(sockStub, '');
  fs.writeFileSync(path.join(registryDir, `${ID}.json`), JSON.stringify({
    sessionId: ID, socketPath: sockStub, pid: process.pid, cwd: tmpHome,
    sessionFile: SESSION_FILE, name: 'plain name',
  }));
  await new Promise(r => setTimeout(r, 600)); // registry scan memo TTL
  try {
    const hit = await get('/api/sessions?active=1&q=bravo');
    const sess = hit.body.active.find(s => s.id === ID);
    assert.ok(sess, 'content match keeps the live session in the active list');
    assert.ok(sess.searchSnippet.includes('bravo'), `snippet shows the hit: ${sess.searchSnippet}`);
    const miss = await get('/api/sessions?active=1&q=zzz-not-there');
    assert.ok(!miss.body.active.some(s => s.id === ID), 'non-matching query filters it out');
  } finally {
    fs.rmSync(path.join(registryDir, `${ID}.json`), { force: true });
  }
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

// Relevance-ranking fixtures: two sessions matching "orchid". The older one
// says it in its name (first user message); the newer one only in content,
// repeatedly — recency alone would put the wrong one on top.
const RANK_NAME_ID = '2026-07-05T08-00-00-rankname';
const RANK_CONTENT_ID = '2026-07-06T08-00-00-rankbody';
{
  const write = (id, entries, mtime) => {
    const file = path.join(sessionDir, `${id}.jsonl`);
    fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
    fs.utimesSync(file, new Date(mtime), new Date(mtime));
  };
  write(RANK_NAME_ID, [
    { type: 'session', cwd: '/home/user/proj', timestamp: '2026-07-05T08:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'orchid rollout plan' }], timestamp: '2026-07-05T08:00:01.000Z' } },
  ], '2026-07-05T08:00:01.000Z');
  write(RANK_CONTENT_ID, [
    { type: 'session', cwd: '/home/user/proj', timestamp: '2026-07-06T08:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'unrelated heading' }], timestamp: '2026-07-06T08:00:01.000Z' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'orchid '.repeat(80) }], timestamp: '2026-07-06T08:00:02.000Z' } },
  ], '2026-07-06T08:00:02.000Z');
}

test('GET /api/sessions?q= ranks by relevance, recency only as tiebreaker', async () => {
  const { body } = await get('/api/sessions?q=orchid');
  const ids = body.previous.map(s => s.id).filter(id => id === RANK_NAME_ID || id === RANK_CONTENT_ID);
  assert.deepEqual(ids, [RANK_NAME_ID, RANK_CONTENT_ID],
    'the name match outranks the newer session that only repeats the word');
  const named = body.previous.find(s => s.id === RANK_NAME_ID);
  const shouted = body.previous.find(s => s.id === RANK_CONTENT_ID);
  assert.ok(named.searchScore > shouted.searchScore,
    `scores exposed to the client (${named.searchScore} vs ${shouted.searchScore})`);
  // Content occurrences count even when the metadata already explained the
  // match — the snippet rule is unchanged (metadata match ⇒ no snippet).
  assert.equal(named.searchSnippet, undefined);
  assert.ok(shouted.searchSnippet.includes('orchid'));

  // Field/date-only queries can't score: the list keeps its recency order.
  const meta = await get(`/api/sessions?q=${encodeURIComponent('cwd:proj')}`);
  const metaTimes = meta.body.previous.map(s => new Date(s.lastActivity || 0).getTime());
  assert.ok(metaTimes.every((t, i) => i === 0 || t <= metaTimes[i - 1]), 'recency order');
  assert.equal(meta.body.previous[0].searchScore, undefined);
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

  // Ranked, not recency-ordered: the older name match leads the newer
  // session that merely repeats the word 80 times.
  const ranked = await get('/api/search?q=orchid');
  const rankIds = ranked.body.results.map(s => s.id);
  assert.deepEqual(rankIds, [RANK_NAME_ID, RANK_CONTENT_ID]);
  assert.ok(ranked.body.results[0].searchScore > ranked.body.results[1].searchScore,
    'result objects carry the score they were ranked by');
  assert.ok(ranked.body.results[0].matchCount === 1 && ranked.body.results[1].matchCount > 50,
    `occurrence counts stay independent of the ranking ${JSON.stringify(ranked.body.results.map(r => [r.id, r.matchCount]))}`);

  // Empty query browses everything, recency-first.
  const all = await get('/api/search?q=');
  assert.ok(all.body.results.length >= 3);
  const times = all.body.results.map(s => new Date(s.lastActivity || 0).getTime());
  assert.ok(times.every((t, i) => i === 0 || t <= times[i - 1]), 'recency order');
});

test('GET /api/search applies saved scope before the 100-result cap', async (t) => {
  const oldBudget = process.env.PI_DISH_INDEX_SYNC_BUDGET;
  process.env.PI_DISH_INDEX_SYNC_BUDGET = '1000';
  const scopeDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--scope-cap-test--');
  fs.mkdirSync(scopeDir, { recursive: true });
  t.after(() => {
    if (oldBudget === undefined) delete process.env.PI_DISH_INDEX_SYNC_BUDGET;
    else process.env.PI_DISH_INDEX_SYNC_BUDGET = oldBudget;
    fs.rmSync(scopeDir, { recursive: true, force: true });
  });

  const writeCapSession = (id, cwd, timestamp) => {
    const file = path.join(scopeDir, `${id}.jsonl`);
    fs.writeFileSync(file, [
      { type: 'session', cwd, timestamp },
      { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'scope-cap-boundary' }], timestamp } },
    ].map(e => JSON.stringify(e)).join('\n') + '\n');
    const at = new Date(timestamp);
    fs.utimesSync(file, at, at);
  };

  const targetId = '2026-07-01T00-00-00-scope-target';
  writeCapSession(targetId, '/workspace/scope-target', '2026-07-01T00:00:00.000Z');
  for (let i = 0; i < 100; i++) {
    writeCapSession(
      `2026-07-02T00-00-${String(i).padStart(2, '0')}-scope-filler`,
      '/workspace/scope-other',
      new Date(Date.parse('2026-07-02T00:00:00.000Z') + i * 1000).toISOString(),
    );
  }

  const unscoped = await get('/api/search?q=scope-cap-boundary');
  assert.equal(unscoped.body.total, 101);
  assert.equal(unscoped.body.results.length, 100);
  assert.ok(!unscoped.body.results.some(s => s.id === targetId),
    'the older target is beyond the unscoped cap');

  const scoped = await get(`/api/search?q=scope-cap-boundary&scope=${encodeURIComponent('cwd:scope-target')}`);
  assert.equal(scoped.body.total, 1, 'total describes the scoped result set');
  assert.deepEqual(scoped.body.results.map(s => s.id), [targetId]);
  assert.equal(scoped.body.hiddenByScopes, 100, 'hidden count covers the full pre-cap query result set');
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
  assert.match(image.url, /\/messages\/img00001\/images\/1$/,
    'resource identity is the stable JSONL entry id');
  assert.equal(image.data, undefined, 'base64 bytes are not duplicated into chat JSON');

  const res = await fetch(base + image.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), TINY_PNG);

  const invalid = await fetch(`${base}/api/sessions/${SESSION_ID}/messages/%20/images/0`);
  assert.equal(invalid.status, 400, 'malformed entry ids are rejected');
});

test('OMP blob-store image refs resolve to the stored bytes', async () => {
  const { body } = await get(`/api/sessions/${encodeURIComponent(OMP_BLOB_ROUTE_ID)}/messages`);
  const images = body.messages.flatMap(m => (Array.isArray(m.content) ? m.content : []))
    .filter(block => block.type === 'image');
  assert.equal(images.length, 2);
  assert.ok(images.every(block => block.url && block.data === undefined),
    'blob refs are projected to resource URLs, never sent to the client as bogus base64');

  const ok = await fetch(base + images[0].url);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), TINY_PNG,
    'bytes come from ~/.omp/agent/blobs, not from base64-decoding the ref');

  const missing = await fetch(base + images[1].url);
  assert.equal(missing.status, 404, 'a missing/pruned blob 404s instead of serving garbage bytes');
});

test('historical image resource stays stable after active branch navigation', async () => {
  const before = await get(`/api/sessions/${IMAGE_TREE_ID}/messages`);
  const image = before.body.messages.flatMap(message => message.content)
    .find(block => block.type === 'image');
  assert.match(image.url, /\/messages\/image001\/images\/0$/);
  const first = await fetch(base + image.url);
  assert.equal(first.status, 200);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), TINY_PNG);

  fs.appendFileSync(IMAGE_TREE_FILE, JSON.stringify({
    type: 'message', id: 'retry001', parentId: 'base0001',
    message: { role: 'user', content: [{ type: 'text', text: 'take the other branch' }] },
  }) + '\n');
  const after = await get(`/api/sessions/${IMAGE_TREE_ID}/messages`);
  assert.equal(after.body.messages.some(message =>
    message.content.some(block => block.type === 'image')), false,
  'image entry is no longer on the active branch');

  const second = await fetch(base + image.url);
  assert.equal(second.status, 200, 'old lazy resource URL remains addressable');
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), TINY_PNG,
    'the stable URL still resolves to the original entry bytes');
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

test('GET /search mode=any returns relevant messages for session-wide advanced matches', async () => {
  const advanced = await get(`/api/search?q=${encodeURIComponent('delta bravo')}`);
  assert.ok(advanced.body.results.some(s => s.id === SESSION_ID),
    'advanced search keeps session-wide AND semantics');
  const clickThrough = await get(`/api/sessions/${SESSION_ID}/search?q=${encodeURIComponent('delta bravo')}&mode=any`);
  assert.deepEqual(clickThrough.body.matches, [
    { index: 1, role: 'assistant' },
    { index: 3, role: 'user' },
  ]);
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

test('GET /api/dirs/children lists subdirs, excluding dotdirs and heavies', async () => {
  const treeRoot = path.join(tmpHome, 'treeroot');
  fs.mkdirSync(path.join(treeRoot, 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(treeRoot, 'beta'), { recursive: true });
  fs.mkdirSync(path.join(treeRoot, '.hidden'), { recursive: true });
  fs.mkdirSync(path.join(treeRoot, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'a-file.txt'), 'x\n');

  const { status, body } = await get('/api/dirs/children?path=' + encodeURIComponent(treeRoot));
  assert.equal(status, 200);
  assert.equal(body.path, treeRoot);
  const names = body.dirs.map(d => d.name);
  assert.deepEqual(names, ['alpha', 'beta'], 'dotdir + node_modules + file excluded, sorted');
  assert.equal(body.dirs[0].path, path.join(treeRoot, 'alpha'));

  // ~ expands to $HOME
  const home = await get('/api/dirs/children?path=' + encodeURIComponent('~'));
  assert.equal(home.status, 200);
  assert.equal(home.body.path, tmpHome);
  assert.ok(home.body.dirs.some(d => d.name === 'treeroot'));

  // non-absolute → 400
  const rel = await get('/api/dirs/children?path=' + encodeURIComponent('relative/path'));
  assert.equal(rel.status, 400);

  // nonexistent → 200 with error + empty dirs (degrade, don't blank)
  const missing = await get('/api/dirs/children?path=' + encodeURIComponent(path.join(tmpHome, 'no-such-dir')));
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.body.dirs, []);
  assert.ok(missing.body.error);
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

test('GET /file content serves the raw source of text previews inline', async () => {
  const resource = `/api/sessions/${REAL_CWD_ID}/file/content?path=${encodeURIComponent('deep/nest/findings.md')}`;
  const res = await fetch(base + resource);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await res.text(), '# deep findings\n');
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

  const query = new URLSearchParams({
    repo: 'repo-big', path: 'file-3.txt', snapshot: body.snapshotId,
  });
  const patch = await get(`/api/sessions/${REAL_CWD_ID}/diff/patch?${query}`);
  assert.equal(patch.status, 200);
  assert.match(patch.body.patch, /\+new 3/);
  assert.equal(patch.body.truncated, false);

  fs.writeFileSync(path.join(repo, 'file-3.txt'), 'old 3\nnew 3\ndrifted after summary\n');
  const stale = await get(`/api/sessions/${REAL_CWD_ID}/diff/patch?${query}`);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.patch, undefined, 'a changed working tree is never served under the old pane');
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

test('file-viewer pages render as standalone read-only documents', async () => {
  const viewedFile = path.join(realCwd, 'published-view.md');
  fs.writeFileSync(viewedFile, [
    '# Rendered file',
    '',
    'A **formatted** finding.',
    '',
    '```js',
    'const answer = 42;',
    '```',
    '',
    '<script>globalThis.pwned = true</script>',
    '[unsafe](javascript:alert(1))',
  ].join('\n'));

  const published = await post('/api/pages', {
    path: viewedFile,
    sessionId: REAL_CWD_ID,
    title: 'published-view.md',
    renderer: 'file',
  });
  assert.equal(published.status, 200);
  assert.equal(published.body.renderer, 'file');

  const response = await fetch(base + published.body.path);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await response.text();
  assert.match(html, /<body class="standalone-file-page">/);
  assert.match(html, /<h1>Rendered file<\/h1>/);
  assert.match(html, /A <strong>formatted<\/strong> finding/);
  assert.match(html, /class="hljs language-js"/);
  assert.match(html, /&lt;script&gt;globalThis\.pwned = true&lt;\/script&gt;/);
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /artifact-comments|commentBubble|app\.js/,
    'the standalone renderer has no app or commenting UI');

  // File-rendered pages are not valid page-comment targets, even through the
  // trusted main API.
  const comment = await post('/api/comments', {
    body: 'This should not be accepted.',
    target: {
      kind: 'page', pageToken: published.body.token,
      anchor: { type: 'text', quote: 'Rendered file' },
    },
  });
  assert.equal(comment.status, 400);

  // The view remains live from disk like every other published page.
  fs.writeFileSync(viewedFile, '## Revised file\n');
  assert.match(await (await fetch(base + published.body.path)).text(), /<h2>Revised file<\/h2>/);

  const image = await post('/api/pages', {
    path: path.join(realCwd, 'preview.png'),
    sessionId: REAL_CWD_ID,
    renderer: 'file',
  });
  const imageHtml = await (await fetch(base + image.body.path)).text();
  const imageSrc = imageHtml.match(/<img[^>]+src="([^"]+)"/)[1].replace(/&amp;/g, '&');
  const imageContent = await fetch(base + imageSrc);
  assert.equal(imageContent.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await imageContent.arrayBuffer()), TINY_PNG);

  await del(`/api/pages/${published.body.token}`);
  await del(`/api/pages/${image.body.token}`);
});

test('POST /api/pages rejects malformed or unknown explicit sessionIds without creating a page', async () => {
  const artifact = path.join(realCwd, 'invalid-session-page.html');
  fs.writeFileSync(artifact, '<p>must not publish</p>');

  for (const sessionId of [null, '', { arbitrary: true }, 'x'.repeat(513)]) {
    const invalid = await post('/api/pages', { path: artifact, sessionId });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.error, /sessionId.*non-empty string.*512/);
  }

  const unknown = await post('/api/pages', { path: artifact, sessionId: 'missing-page-session' });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /known active or historical session/);

  const historicalPrefix = REAL_CWD_ID.slice(0, -4);
  assert.ok(REAL_CWD_ID.startsWith(historicalPrefix));
  const partial = await post('/api/pages', { path: artifact, sessionId: historicalPrefix });
  assert.equal(partial.status, 404, 'a prefix of a historical JSONL basename is not a valid association');

  const list = await get('/api/pages');
  assert.ok(!list.body.some((page) => page.root === artifact), 'an invalid association creates no page record');
});

test('POST /api/pages with an invalid explicit sessionId cannot mutate an existing page association', async () => {
  const artifact = path.join(realCwd, 'stable-page-session.html');
  fs.writeFileSync(artifact, '<p>stable association</p>');
  const published = await post('/api/pages', {
    path: artifact, sessionId: REAL_CWD_ID, title: 'Original title',
  });
  assert.equal(published.status, 200);

  const rejected = await post('/api/pages', {
    path: artifact, sessionId: REAL_CWD_ID.slice(0, -4), title: 'Poisoned title',
  });
  assert.equal(rejected.status, 404, 'a historical id prefix is rejected before persistence');

  const list = await get('/api/pages');
  const preserved = list.body.find((page) => page.token === published.body.token);
  assert.ok(preserved);
  assert.equal(preserved.sessionId, REAL_CWD_ID);
  assert.equal(preserved.title, 'Original title');
  assert.equal(preserved.createdAt, published.body.createdAt);
  await del(`/api/pages/${published.body.token}`);
});

test('POST /api/pages accepts historical and active sessionIds with idempotent reassociation', async () => {
  const ACTIVE_ID = '2026-07-28T10-00-00-pageact1';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const sockStub = path.join(tmpHome, 'page-active-sock-stub');
  fs.writeFileSync(sockStub, '');
  fs.writeFileSync(path.join(registryDir, `${ACTIVE_ID}.json`), JSON.stringify({
    sessionId: ACTIVE_ID, socketPath: sockStub, pid: process.pid, cwd: realCwd,
  }));
  await new Promise(r => setTimeout(r, 600)); // registry scan memo TTL

  const artifact = path.join(realCwd, 'valid-page-sessions.html');
  fs.writeFileSync(artifact, '<p>valid associations</p>');
  try {
    const historical = await post('/api/pages', { path: artifact, sessionId: REAL_CWD_ID });
    assert.equal(historical.status, 200);
    assert.equal(historical.body.sessionId, REAL_CWD_ID);

    const active = await post('/api/pages', { path: artifact, sessionId: ACTIVE_ID });
    assert.equal(active.status, 200);
    assert.equal(active.body.token, historical.body.token, 'republishing the root reuses its page token');
    assert.equal(active.body.sessionId, ACTIVE_ID, 'a valid explicit session updates the association');
    await del(`/api/pages/${active.body.token}`);
  } finally {
    fs.rmSync(path.join(registryDir, `${ACTIVE_ID}.json`), { force: true });
  }
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
  assert.equal(index.body.comments[0].sessionId, REAL_CWD_ID,
    'index entries carry the session so a page overlay can read/edit them');
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

test('open comments are editable and deletable, acknowledged ones are not', async () => {
  const target = {
    kind: 'file', path: path.join(realCwd, 'README.md'), relPath: 'README.md',
    anchor: { type: 'text', quote: 'alpha', prefix: '# ', suffix: '\n' },
  };
  const editable = await post('/api/comments', {
    sessionId: REAL_CWD_ID, body: 'First wording.', target,
  });
  assert.equal(editable.status, 201);
  assert.equal(editable.body.updatedAt, undefined, 'a fresh comment has no edit stamp');

  assert.equal((await patch(`/api/comments/${editable.body.id}`,
    { sessionId: SESSION_ID, body: 'hijacked' })).status, 403);
  assert.equal((await patch('/api/comments/nope',
    { sessionId: REAL_CWD_ID, body: 'ghost' })).status, 404);
  assert.equal((await patch(`/api/comments/${editable.body.id}`,
    { sessionId: REAL_CWD_ID, body: '   ' })).status, 400, 'an emptied body is not an edit');

  const edited = await patch(`/api/comments/${editable.body.id}`,
    { sessionId: REAL_CWD_ID, body: 'Second wording.' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.body, 'Second wording.');
  assert.ok(edited.body.updatedAt >= edited.body.createdAt, 'an edit stamps updatedAt');
  assert.equal((await post('/api/comments/get',
    { sessionId: REAL_CWD_ID, ids: [editable.body.id] })).body.comments[0].body, 'Second wording.');

  // Deleting drops it from the agent-facing inventory entirely.
  const disposable = await post('/api/comments', {
    sessionId: REAL_CWD_ID, body: 'Never mind.', target,
  });
  assert.equal((await del(`/api/comments/${disposable.body.id}`,
    { sessionId: SESSION_ID })).status, 403);
  assert.deepEqual((await del(`/api/comments/${disposable.body.id}`,
    { sessionId: REAL_CWD_ID })).body, { ok: true });
  const afterDelete = await get(`/api/comments/index?sessionId=${REAL_CWD_ID}`);
  assert.ok(!afterDelete.body.comments.some((c) => c.id === disposable.body.id),
    'a deleted comment leaves the open index');
  assert.equal((await del(`/api/comments/${disposable.body.id}`,
    { sessionId: REAL_CWD_ID })).status, 404);

  // After acknowledgment the comment is the agent's record: frozen.
  await post(`/api/comments/${editable.body.id}/ack`, { sessionId: REAL_CWD_ID });
  const lateEdit = await patch(`/api/comments/${editable.body.id}`,
    { sessionId: REAL_CWD_ID, body: 'Too late.' });
  assert.equal(lateEdit.status, 409);
  assert.equal(lateEdit.body.error, 'comment already acknowledged');
  assert.equal((await del(`/api/comments/${editable.body.id}`,
    { sessionId: REAL_CWD_ID })).status, 409);
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

  // The page overlay only knows its own token; the index scopes on it and
  // hands back the session the overlay needs for get/edit/delete.
  const byToken = await get(`/api/comments/index?pageToken=${page.body.token}`);
  assert.equal(byToken.status, 200);
  assert.deepEqual(byToken.body.comments.map((c) => c.id), [created.body.id]);
  assert.equal(byToken.body.comments[0].sessionId, REAL_CWD_ID);
  assert.equal((await get('/api/comments/index?pageToken=missing')).body.total, 0);

  await post(`/api/comments/${created.body.id}/ack`, { sessionId: REAL_CWD_ID });
  assert.equal((await get(`/api/comments/index?pageToken=${page.body.token}`)).body.total, 0,
    'the page index tracks open comments only');
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
    sessionId: REAL_CWD_ID.slice(0, -4), body: 'partial id',
    target: { kind: 'file', path: path.join(realCwd, 'README.md'), anchor: { type: 'text', quote: 'x' } },
  })).status, 404, 'comment creation does not persist a partial Pi route');
  assert.equal((await post('/api/comments', {
    sessionId: REAL_CWD_ID, body: 'hello',
    target: { kind: 'page', pageToken: 'missing', anchor: { type: 'text', quote: 'x' } },
  })).status, 400);
  assert.equal((await post('/api/comments/get', { sessionId: REAL_CWD_ID, ids: [] })).status, 400);
  assert.equal((await get('/api/comments/index')).status, 400, 'the index must be scoped');
});

test('encoded Pi aliases share the canonical raw Pi comment identity', async () => {
  const alias = encodeSessionKey('pi', REAL_CWD_ID);
  const created = await post('/api/comments', {
    sessionId: alias, body: 'Alias identity comment.',
    target: {
      kind: 'file', path: path.join(realCwd, 'README.md'),
      anchor: { type: 'text', quote: 'alpha' },
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.sessionId, REAL_CWD_ID, 'encoded Pi aliases persist as the legacy raw route');
  assert.equal((await get(`/api/comments/count?sessionId=${alias}`)).body.total, 1);
  assert.equal((await get(`/api/comments/count?sessionId=${REAL_CWD_ID}`)).body.total, 1);
  assert.equal((await post(`/api/comments/${created.body.id}/ack`, { sessionId: alias })).status, 200);
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
  assert.equal(ok.body.sessionId, null, 'omitted sessionId remains null when no live cwd contains the page');
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
    assert.equal(body.sessionId, INNER_ID);
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

test('inferred alternative-harness pages and comments keep the encoded harness identity', async () => {
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const socketPath = path.join(tmpHome, 'omp-infer-socket-stub');
  fs.writeFileSync(socketPath, '');
  const bridgeInstanceId = 'omp-infer-bridge';
  fs.writeFileSync(path.join(registryDir, `${OMP_SESSION_ID}.json`), JSON.stringify({
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp', nativeSessionId: OMP_SESSION_ID, sessionId: OMP_SESSION_ID,
    bridgeInstanceId, instanceId: bridgeInstanceId,
    sessionFile: ompSessionFile, socketPath, pid: process.pid,
    startTime: processIdentity(process.pid).startTime,
    cwd: ompCwd, capabilities: {}, spawnToken: null,
  }));
  await new Promise(r => setTimeout(r, 600));

  const artifact = path.join(ompCwd, 'inferred-omp.html');
  fs.writeFileSync(artifact, '<p>inferred OMP artifact</p>');
  try {
    const page = await post('/api/pages', { path: artifact });
    assert.equal(page.status, 200);
    assert.equal(page.body.sessionId, OMP_ROUTE_ID);
    const comment = await post('/api/comments', {
      body: 'Keep this canonical.',
      target: {
        kind: 'page', pageToken: page.body.token,
        anchor: { type: 'text', quote: 'OMP artifact' },
      },
    });
    assert.equal(comment.status, 201, JSON.stringify(comment.body));
    assert.equal(comment.body.sessionId, OMP_ROUTE_ID);
    await post(`/api/comments/${comment.body.id}/ack`, { sessionId: OMP_ROUTE_ID });
    await del(`/api/pages/${page.body.token}`);
  } finally {
    fs.rmSync(path.join(registryDir, `${OMP_SESSION_ID}.json`), { force: true });
  }
});

test('the session list forwards the registry compacting flag', async () => {
  // The bridge stamps compacting on its registry entry (auto- and manual
  // compaction alike); the list must surface it — the sidebar dot and the
  // client's per-session seed on select read it from here.
  const ID = '2026-07-24T10-00-00-compctd1';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const sockStub = path.join(tmpHome, 'compact-sock-stub');
  fs.writeFileSync(sockStub, '');
  fs.writeFileSync(path.join(registryDir, `${ID}.json`), JSON.stringify({
    sessionId: ID, socketPath: sockStub, pid: process.pid, cwd: tmpHome,
    sessionFile: SESSION_FILE, turnInProgress: true, compacting: true,
  }));
  await new Promise(r => setTimeout(r, 600)); // registry scan memo TTL
  try {
    const { body } = await get('/api/sessions');
    const sess = body.active.find(s => s.id === ID);
    assert.ok(sess, 'registered session is listed');
    assert.equal(sess.compacting, true);
    assert.equal(sess.turnInProgress, true);
  } finally {
    fs.rmSync(path.join(registryDir, `${ID}.json`), { force: true });
  }
});

test('OMP /compact routes through the advertised bridge operation and rejects overlap', async () => {
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.mkdirSync(path.dirname(ompSessionFile), { recursive: true });
  if (!fs.existsSync(ompSessionFile)) {
    fs.writeFileSync(ompSessionFile, [
      { type: 'title', title: 'OMP compact route fixture' },
      { type: 'session', version: 3, id: OMP_SESSION_ID, cwd: ompCwd },
    ].map(JSON.stringify).join('\n') + '\n');
  }
  const socketPath = path.join(tmpHome, 'omp-compact-route.sock');
  const identity = processIdentity(process.pid);
  const claim = {
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp', nativeSessionId: OMP_SESSION_ID, sessionId: OMP_SESSION_ID,
    sessionFile: ompSessionFile, cwd: ompCwd,
    bridgeInstanceId: 'omp-compact-route', instanceId: 'omp-compact-route',
    socketPath, pid: identity.pid, startTime: identity.startTime,
    spawnToken: null,
    capabilities: { compact: true, commands: true },
  };
  const received = [];
  const bridgeSockets = new Set();
  const bridge = net.createServer(sock => {
    bridgeSockets.add(sock);
    sock.on('close', () => bridgeSockets.delete(sock));
    sock.write(JSON.stringify({ type: 'hello', ...claim, compacting: false }) + '\n');
    sock.on('data', chunk => {
      for (const line of chunk.toString().trim().split('\n')) {
        if (!line) continue;
        const command = JSON.parse(line);
        received.push(command);
        if (command.command !== 'compact') continue;
        sock.write(JSON.stringify({ type: 'event', event: 'compaction_start', data: { reason: 'manual' } }) + '\n');
        sock.write(JSON.stringify({ type: 'response', id: command.id, success: true, data: { info: 'Compaction started' } }) + '\n');
        setTimeout(() => sock.write(JSON.stringify({
          type: 'event', event: 'compaction_end', data: { reason: 'manual', result: { tokensBefore: 100 } },
        }) + '\n'), 120);
      }
    });
  });
  await new Promise(resolve => bridge.listen(socketPath, resolve));
  const registryPath = path.join(registryDir, 'omp-compact-route.json');
  fs.writeFileSync(registryPath, JSON.stringify(claim));
  invalidateRegistryCache();

  try {
    const first = await post(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/command`, {
      message: '/compact retain decisions',
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await post(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/command`, { message: '/compact' });
    assert.equal(second.status, 400, JSON.stringify(second.body));
    assert.match(second.body.error, /already in progress/i);
    assert.deepEqual(received.filter(command => command.command === 'compact').map(command => command.instructions),
      ['retain decisions'], 'only one compact operation reaches the bridge');
  } finally {
    fs.rmSync(registryPath, { force: true });
    invalidateRegistryCache();
    for (const sock of bridgeSockets) sock.destroy();
    await new Promise(resolve => bridge.close(resolve));
  }
});

test('OMP /compact is denied when the live bridge does not advertise it', async () => {
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const socketPath = path.join(tmpHome, 'omp-no-compact-route.sock');
  const identity = processIdentity(process.pid);
  const claim = {
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp', nativeSessionId: OMP_SESSION_ID, sessionId: OMP_SESSION_ID,
    sessionFile: ompSessionFile, cwd: ompCwd,
    bridgeInstanceId: 'omp-no-compact-route', instanceId: 'omp-no-compact-route',
    socketPath, pid: identity.pid, startTime: identity.startTime,
    spawnToken: null,
    capabilities: { compact: false, commands: true },
  };
  let commandCount = 0;
  const bridgeSockets = new Set();
  const bridge = net.createServer(sock => {
    bridgeSockets.add(sock);
    sock.on('close', () => bridgeSockets.delete(sock));
    sock.write(JSON.stringify({ type: 'hello', ...claim }) + '\n');
    sock.on('data', () => { commandCount++; });
  });
  await new Promise(resolve => bridge.listen(socketPath, resolve));
  const registryPath = path.join(registryDir, 'omp-no-compact-route.json');
  fs.writeFileSync(registryPath, JSON.stringify(claim));
  invalidateRegistryCache();

  try {
    const result = await post(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/command`, { message: '/compact' });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.match(result.body.error, /does not support compaction/i);
    assert.equal(commandCount, 0, 'unsupported compact never reaches the bridge socket');
  } finally {
    fs.rmSync(registryPath, { force: true });
    invalidateRegistryCache();
    for (const sock of bridgeSockets) sock.destroy();
    await new Promise(resolve => bridge.close(resolve));
  }
});

test('OMP command discovery includes pane-backed host commands and API aliases stay capability-first', async () => {
  const nativeId = 'omp-command-filter';
  const routeId = encodeSessionKey('omp', nativeId);
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  const socketPath = path.join(tmpHome, 'omp-command-filter.sock');
  fs.mkdirSync(registryDir, { recursive: true });
  const identity = processIdentity(process.pid);
  const claim = {
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp', nativeSessionId: nativeId, sessionId: nativeId,
    bridgeInstanceId: 'omp-command-filter', instanceId: 'omp-command-filter',
    sessionFile: ompSessionFile, socketPath, cwd: ompCwd,
    pid: identity.pid, startTime: identity.startTime, spawnToken: null,
    capabilities: {
      commands: true, compact: true, setModel: true, rename: true,
      setThinking: false, abort: true, queueCancel: false,
      treeRead: true, treeNavigation: true,
    },
  };
  const advertised = [
    ...['tree', 'fork', 'new', 'resume', 'session', 'settings', 'export', 'share', 'copy',
      'login', 'logout', 'scoped-models', 'hotkeys', 'quit'].map(name =>
      ({ name, source: 'builtin', supported: false })),
    { name: 'compact', source: 'builtin', supported: false },
    { name: 'model', source: 'builtin', supported: false },
    { name: 'name', source: 'builtin', supported: false },
    { name: 'thinking', source: 'builtin', supported: false },
    { name: 'abort', source: 'builtin', supported: false },
    { name: 'skill:review', source: 'skill', supported: true },
    { name: 'daily', source: 'prompt', supported: true },
    { name: 'dish-push', source: 'extension', supported: true },
    { name: 'dish-prime', source: 'extension', supported: false },
  ];
  const received = [];
  const sockets = new Set();
  const bridge = net.createServer(sock => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.write(JSON.stringify({ type: 'hello', ...claim }) + '\n');
    let buffered = '';
    sock.on('data', chunk => {
      buffered += chunk;
      let newline;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        const command = JSON.parse(line);
        received.push(command);
        const data = command.command === 'get_commands' ? { commands: advertised } : {};
        sock.write(JSON.stringify({ type: 'response', id: command.id, success: true, data }) + '\n');
      }
    });
  });
  await new Promise(resolve => bridge.listen(socketPath, resolve));
  const registryPath = path.join(registryDir, `${nativeId}.json`);
  fs.writeFileSync(registryPath, JSON.stringify(claim));
  invalidateRegistryCache();

  const originalPaneExists = tmux.paneExists;
  const originalSendKeys = tmux.sendKeys;
  const injected = [];
  try {
    const unownedCommands = await get(`/api/commands?sessionId=${encodeURIComponent(routeId)}`);
    assert.equal(unownedCommands.status, 200, JSON.stringify(unownedCommands.body));
    assert.deepEqual(unownedCommands.body.map(command => command.name),
      ['tree', 'compact', 'model', 'name', 'abort', 'skill:review', 'daily', 'dish-push']);

    tmux.recordSpawn(routeId, { socket: '/fake/owned-omp.sock', paneId: '%88' });
    tmux.paneExists = async (socket, paneId) => socket === '/fake/owned-omp.sock' && paneId === '%88';
    tmux.sendKeys = async (socket, paneId, text) => injected.push({ socket, paneId, text });

    const commands = await get(`/api/commands?sessionId=${encodeURIComponent(routeId)}`);
    assert.equal(commands.status, 200, JSON.stringify(commands.body));
    assert.deepEqual(commands.body.map(command => command.name),
      ['tree', 'compact', 'model', 'name', 'abort', 'skill:review', 'daily', 'dish-push',
        'shake', 'retry', 'fresh', 'clear', 'reload']);
    assert.deepEqual(commands.body.slice(-5).map(({ name, source, supported }) => ({ name, source, supported })), [
      { name: 'shake', source: 'host', supported: true },
      { name: 'retry', source: 'host', supported: true },
      { name: 'fresh', source: 'host', supported: true },
      { name: 'clear', source: 'host', supported: true },
      { name: 'reload', source: 'host', supported: true },
    ]);
    assert.equal(commands.body.find(command => command.name === 'shake').args, '[images]');

    const shake = await post(`/api/sessions/${encodeURIComponent(routeId)}/command`, { message: '/shake' });
    assert.equal(shake.status, 200, JSON.stringify(shake.body));
    const shakeImages = await post(`/api/sessions/${encodeURIComponent(routeId)}/command`, { message: '/shake images' });
    assert.equal(shakeImages.status, 200, JSON.stringify(shakeImages.body));
    const retry = await post(`/api/sessions/${encodeURIComponent(routeId)}/command`, { message: '/retry' });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.deepEqual(injected, [
      { socket: '/fake/owned-omp.sock', paneId: '%88', text: '/shake' },
      { socket: '/fake/owned-omp.sock', paneId: '%88', text: '/shake images' },
      { socket: '/fake/owned-omp.sock', paneId: '%88', text: '' },
      { socket: '/fake/owned-omp.sock', paneId: '%88', text: '/retry' },
    ]);
    const retryArgs = await post(`/api/sessions/${encodeURIComponent(routeId)}/command`, { message: '/retry now' });
    assert.equal(retryArgs.status, 400, JSON.stringify(retryArgs.body));
    assert.match(retryArgs.body.error, /invalid arguments/i);

    const badArgs = await post(`/api/sessions/${encodeURIComponent(routeId)}/command`, {
      message: '/shake images; touch /tmp/nope',
    });
    assert.equal(badArgs.status, 400, JSON.stringify(badArgs.body));
    assert.match(badArgs.body.error, /invalid arguments/i);
    assert.equal(injected.length, 4, 'invalid host arguments never reach tmux');

    const notAllowlisted = await post(`/api/sessions/${encodeURIComponent(routeId)}/command`, {
      message: '/handoff',
    });
    assert.equal(notAllowlisted.status, 200, JSON.stringify(notAllowlisted.body));
    assert.equal(injected.length, 4, 'non-allowlisted commands stay on the bridge path');
    assert.ok(received.some(command => command.command === 'run_command' && command.message === '/handoff'));

    // A reachable-but-unowned pane (the bridge's own tmux stamp) is enough:
    // host commands follow the /reload rule, not spawn ownership.
    tmux.removeSpawn(routeId);
    fs.writeFileSync(registryPath, JSON.stringify({ ...claim, tmux: { socket: '/fake/stamped-omp.sock', pane: '%77' } }));
    invalidateRegistryCache();
    tmux.paneExists = async (socket, paneId) => socket === '/fake/stamped-omp.sock' && paneId === '%77';
    const stampedCommands = await get(`/api/commands?sessionId=${encodeURIComponent(routeId)}`);
    assert.equal(stampedCommands.status, 200, JSON.stringify(stampedCommands.body));
    assert.ok(stampedCommands.body.some(command => command.name === 'retry' && command.source === 'host'));
    const stampedRetry = await post(`/api/sessions/${encodeURIComponent(routeId)}/command`, { message: '/retry' });
    assert.equal(stampedRetry.status, 200, JSON.stringify(stampedRetry.body));
    assert.deepEqual(injected.at(-1), { socket: '/fake/stamped-omp.sock', paneId: '%77', text: '/retry' });

    fs.writeFileSync(registryPath, JSON.stringify(claim));
    invalidateRegistryCache();
    const noPane = await post(`/api/sessions/${encodeURIComponent(routeId)}/command`, { message: '/shake' });
    assert.equal(noPane.status, 409, JSON.stringify(noPane.body));
    assert.match(noPane.body.error, /reachable Oh My Pi tmux pane/i);

    const cancelled = await post(`/api/sessions/${encodeURIComponent(routeId)}/queue/cancel`, {});
    assert.equal(cancelled.status, 409, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.error, 'This session does not support queue cancellation.');
    assert.equal(received.some(command => command.command === 'cancel_queued'), false);

    const byModel = await post(`/api/sessions/${encodeURIComponent(routeId)}/model`, { model: 'zai/glm-4.7-flash' });
    assert.equal(byModel.status, 200, JSON.stringify(byModel.body));
    const byModelId = await post(`/api/sessions/${encodeURIComponent(routeId)}/model`, { modelId: 'zai/glm-4.5-flash' });
    assert.equal(byModelId.status, 200, JSON.stringify(byModelId.body));
    assert.deepEqual(received.filter(command => command.command === 'set_model').map(command => command.model),
      ['zai/glm-4.7-flash', 'zai/glm-4.5-flash']);
  } finally {
    tmux.paneExists = originalPaneExists;
    tmux.sendKeys = originalSendKeys;
    tmux.removeSpawn(routeId);
    fs.rmSync(registryPath, { force: true });
    invalidateRegistryCache();
    for (const sock of sockets) sock.destroy();
    await new Promise(resolve => bridge.close(resolve));
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

  // Scope down to two models — ids are normalized and other fields survive.
  const scoped = await put('/api/models/enabled', { enabledIds: [' anthropic/claude-sonnet-4-5 ', 'zai/glm-5.2'] });
  assert.equal(scoped.status, 200);
  assert.deepEqual(scoped.body.enabledModels, ['anthropic/claude-sonnet-4-5', 'zai/glm-5.2']);
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
  const duplicate = await put('/api/models/enabled', { enabledIds: ['x/y', ' x/y '] });
  assert.equal(duplicate.status, 400);
});

test('PUT /api/models/enabled preserves a concurrent pi settings write', async () => {
  const settingsFile = path.join(tmpHome, '.pi', 'agent', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }));

  // Model a separate pi process: hold pi's own settings lock with a snapshot,
  // then commit an unrelated field before releasing it. The API must wait,
  // re-read that write under the same lock, and merge enabledModels into it.
  const lockfilePath = path.join(__dirname, '..', 'node_modules', '@earendil-works',
    'pi-coding-agent', 'node_modules', 'proper-lockfile');
  const script = `
    const fs = require('node:fs');
    const lockfile = require(${JSON.stringify(lockfilePath)});
    const file = process.argv[1];
    const release = lockfile.lockSync(file, { realpath: false });
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    process.stdout.write('locked\\n');
    setTimeout(() => {
      snapshot.concurrentPiWrite = 'preserved';
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
      release();
    }, 60);
  `;
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', script, settingsFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let childStderr = '';
  child.stderr.on('data', (chunk) => { childStderr += chunk; });
  const locked = new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('error', reject);
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await locked;

  const [updated, exitCode] = await Promise.all([
    put('/api/models/enabled', { enabledIds: ['anthropic/concurrent-model'] }),
    exited,
  ]);
  assert.equal(exitCode, 0, childStderr);
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.concurrentPiWrite, 'preserved');
  assert.deepEqual(settings.enabledModels, ['anthropic/concurrent-model']);
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
  assert.deepEqual(body.costs, { input: null, output: null, cacheRead: null, cacheWrite: null, total: 0.05 });
  assert.deepEqual(body.costUnavailable, { input: 2, output: 2, cacheRead: 2, cacheWrite: 2, total: 0 });
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

test('usage summary preserves cost availability through every grouping and filter', async () => {
  const usageId = 'usage-summary-' + Date.now();
  const usageFile = path.join(sessionDir, usageId + '.jsonl');
  const now = new Date();
  const old = new Date(now); old.setDate(old.getDate() - 10);
  const baselineToday = (await get('/api/usage-summary?days=1')).body;
  const refs = ['audit/paid', 'audit/free', 'audit/total-only', 'audit/mixed', 'audit/old-paid', 'audit/dateless-paid'];
  const filterUrl = (models, days = 'all', sort = 'cost') =>
    `/api/usage-summary?days=${days}&sort=${sort}&models=${encodeURIComponent(models)}`;
  const entries = [
    { type: 'session', cwd: '/workspace/usage', timestamp: now.toISOString() },
    { type: 'message', timestamp: now.toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'usage fixture' }] } },
    { type: 'message', timestamp: now.toISOString(), message: { role: 'assistant', provider: 'audit', model: 'paid', content: [],
      usage: { input: 100, output: 10, cost: { input: 0.4, output: 0.6, cacheRead: 0, cacheWrite: 0, total: 1 } } } },
    { type: 'message', timestamp: now.toISOString(), message: { role: 'assistant', provider: 'audit', model: 'free', content: [],
      usage: { input: 50, output: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
    { type: 'message', timestamp: now.toISOString(), message: { role: 'assistant', provider: 'audit', model: 'total-only', content: [],
      usage: { input: 20, output: 2, cost: { total: 0.5 } } } },
    { type: 'message', timestamp: now.toISOString(), message: { role: 'assistant', provider: 'audit', model: 'mixed', content: [],
      usage: { input: 2, output: 1, cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0, total: 0.2 } } } },
    { type: 'message', timestamp: old.toISOString(), message: { role: 'assistant', provider: 'audit', model: 'old-paid', content: [],
      usage: { input: 20, output: 2, cost: { total: 2 } } } },
    { type: 'message', message: { role: 'assistant', provider: 'audit', model: 'dateless-paid', content: [],
      usage: { input: 30, output: 3, cost: { total: 4 } } } },
  ];
  fs.writeFileSync(usageFile, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  try {
    const knownToday = (await get(filterUrl(refs.join(','), '1'))).body;
    assert.equal(knownToday.range, '1');
    assert.equal(knownToday.totals.calls, 4);
    assert.ok(Math.abs(knownToday.totals.costs.total - 1.7) < 1e-9,
      'total stays known when every selected call reports it');
    assert.equal(knownToday.totals.costs.input, null,
      'a total-only call keeps the component aggregate unavailable');
    assert.equal(knownToday.totals.costUnavailable.input, 1);
    assert.ok(Math.abs(knownToday.headlineCosts.today - baselineToday.headlineCosts.today - 1.7) < 1e-9);
    assert.ok(Math.abs(knownToday.headlineCosts.days7 - baselineToday.headlineCosts.days7 - 1.7) < 1e-9,
      'old and dateless usage stay out of the recent headline');

    const free = (await get(filterUrl('audit/free'))).body;
    assert.equal(free.totals.costs.total, 0, 'explicit-zero/free totals stay numeric');
    assert.deepEqual(free.totals.costUnavailable,
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
    assert.equal(free.groups.models.find(m => m.key === 'audit/free').priced, true,
      'explicit zero is available even without catalog inference');

    const totalOnly = (await get(filterUrl('audit/total-only'))).body;
    assert.equal(totalOnly.totals.costs.total, 0.5);
    assert.equal(totalOnly.totals.costs.input, null);
    assert.equal(totalOnly.totals.costUnavailable.input, 1);

    // Add a second mixed-model call which reports input cost but no total.
    // Every aggregate containing it must become unavailable rather than
    // exposing the first call's partial cost.
    fs.appendFileSync(usageFile, JSON.stringify({
      type: 'message', timestamp: now.toISOString(), message: {
        role: 'assistant', provider: 'audit', model: 'mixed', content: [],
        usage: { input: 3, output: 1, cost: { input: 0.1 } },
      },
    }) + '\n');

    const all = (await get(filterUrl(refs.join(',')))).body;
    assert.equal(all.totals.calls, 7);
    assert.equal(all.totals.costs.total, null, 'range total is unavailable for mixed calls');
    assert.equal(all.totals.costUnavailable.total, 1);
    assert.equal(all.unpricedModelCalls, 1);
    const workspace = all.groups.workspaces.find(w => w.key === '/workspace/usage');
    const session = all.groups.sessions.find(s => s.id === usageId);
    assert.equal(workspace.costs.total, null);
    assert.equal(workspace.unpricedCalls, 1);
    assert.equal(workspace.priced, false);
    assert.equal(session.costs.total, null);
    assert.equal(session.unpricedCalls, 1);

    const mixed = all.groups.models.find(m => m.key === 'audit/mixed');
    assert.equal(mixed.calls, 2);
    assert.equal(mixed.costs.input, 0.2, 'a component reported by every mixed call remains known');
    assert.equal(mixed.costs.output, null);
    assert.equal(mixed.costs.total, null);
    assert.equal(mixed.costUnavailable.total, 1);
    assert.equal(mixed.priced, false);

    // The daily series spans the requested range and stacks per-model data.
    assert.equal(all.daily.some(d => d.day === 'unknown'), false, 'dateless usage stays out of daily series');
    const todayEntry = (await get(filterUrl(refs.join(','), '7'))).body.daily.at(-1);
    assert.equal(todayEntry.costs.total, null);
    const mixedDay = todayEntry.models.find(m => m.ref === 'audit/mixed');
    assert.equal(mixedDay.cost, null);
    assert.equal(mixedDay.costUnavailable.total, 1);
    assert.ok(todayEntry.models.some(m => m.ref === 'audit/paid' && m.cost === 1),
      'daily model data keeps known totals beside unavailable ones');
    const thirty = (await get(filterUrl(refs.join(','), '30'))).body;
    assert.equal(thirty.daily.length, 30);
    assert.ok(thirty.daily.some(d => d.models.some(m => m.ref === 'audit/old-paid' && m.cost === 2)),
      '10-day-old usage must land on its own day');
    assert.ok(all.daily.length >= 11 && all.daily.length <= 365,
      'all-time daily spans from the earliest dated day, capped at a year');
    const afterMixedToday = (await get('/api/usage-summary?days=1')).body;
    assert.equal(afterMixedToday.headlineCosts.today, null, 'headline becomes unavailable for a missing total');
    assert.equal(afterMixedToday.headlineCostUnavailable.today - baselineToday.headlineCostUnavailable.today, 1);

    const invalid = await get('/api/usage-summary?days=2');
    assert.equal(invalid.status, 400);

    // Cost sorting keeps known explicit zero ahead of unavailable totals;
    // token sorting still follows the displayed token accounting.
    const modelPos = (body, ref) => body.groups.models.findIndex(m => m.key === ref);
    assert.ok(modelPos(all, 'audit/dateless-paid') < modelPos(all, 'audit/paid'));
    assert.ok(modelPos(all, 'audit/free') < modelPos(all, 'audit/mixed'),
      'known zero sorts ahead of unavailable cost');
    const byTokens = (await get(filterUrl(refs.join(','), 'all', 'tokens'))).body;
    assert.equal(byTokens.sort, 'tokens');
    assert.ok(modelPos(byTokens, 'audit/paid') < modelPos(byTokens, 'audit/free'));
    assert.ok(modelPos(byTokens, 'audit/free') < modelPos(byTokens, 'audit/dateless-paid'));
    const badSort = await get('/api/usage-summary?days=all&sort=calls');
    assert.equal(badSort.status, 400);

    // Model filter: totals, daily series, and the workspace/session groups
    // reflect only the selected refs; groups.models stays the unfiltered
    // facet list the client toggles from.
    const paid = (await get(filterUrl('audit/paid'))).body;
    assert.deepEqual(paid.models, ['audit/paid']);
    assert.equal(paid.totals.calls, 1);
    assert.equal(paid.totals.costs.total, 1);
    assert.ok(paid.groups.models.some(m => m.key === 'audit/dateless-paid'),
      'facet list keeps deselected models');
    const paidSession = paid.groups.sessions.find(s => s.id === usageId);
    assert.ok(paidSession && paidSession.calls === 1 && paidSession.costs.total === 1,
      'session group carries only the filtered model usage');
    const wsPaid = paid.groups.workspaces.find(w => w.key === '/workspace/usage');
    assert.equal(wsPaid.calls, 1, 'workspace group carries only filtered usage');
    assert.ok(paid.daily.every(d => d.models.every(m => m.ref === 'audit/paid')),
      'daily per-model breakdowns are filtered');
    assert.equal(paid.headlineCosts.today, afterMixedToday.headlineCosts.today,
      'headline KPIs stay global under model filters');

    const pair = (await get(filterUrl('audit/paid,audit/old-paid'))).body;
    assert.equal(pair.totals.calls, 2);
    assert.equal(pair.totals.costs.total, 3);

    const unavailable = (await get(filterUrl('audit/mixed'))).body;
    assert.equal(unavailable.totals.calls, 2);
    assert.equal(unavailable.totals.costs.total, null);
    assert.equal(unavailable.unpricedModelCalls, 1);
    assert.equal(unavailable.groups.sessions.find(s => s.id === usageId)?.unpricedCalls, 1);

    const tooMany = await get(filterUrl(Array.from({ length: 101 }, (_, i) => 'p/m' + i).join(',')));
    assert.equal(tooMany.status, 400);
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
  const badDelivery = await post(`/api/sessions/${SESSION_ID}/prompt`, { message: 'hi', deliverAs: 'sometime' });
  assert.equal(badDelivery.status, 400);
  const noFollowUp = await post(`/api/sessions/${SESSION_ID}/follow-up`, {});
  assert.equal(noFollowUp.status, 400);
  const deadFollowUp = await post(`/api/sessions/${SESSION_ID}/follow-up`, { message: 'later' });
  assert.equal(deadFollowUp.status, 404);

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
  const missingIndex = await post(`/api/sessions/${SESSION_ID}/queue/cancel`, { kind: 'steering', text: 'x' });
  assert.equal(missingIndex.status, 400);
  // Valid body, but the fixture session is not live
  const deadCancel = await post(`/api/sessions/${SESSION_ID}/queue/cancel`, { kind: 'followUp', index: 0, text: 'x' });
  assert.equal(deadCancel.status, 404);
});

// --- Close session + runtime location --------------------------------------

test('POST /close prunes a reused registry PID without signaling the new process', async () => {
  const { spawn } = require('node:child_process');
  const id = '2026-07-04T15-50-00-reusedpid';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  const registryPath = path.join(registryDir, `${id}.json`);
  const socketPath = path.join(tmpHome, 'reused-pid-close.sock');
  fs.mkdirSync(registryDir, { recursive: true });
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const actual = processIdentity(child.pid);
  fs.writeFileSync(socketPath, 'stale socket path');
  fs.writeFileSync(registryPath, JSON.stringify({
    sessionId: id,
    socketPath,
    pid: child.pid,
    startTime: '0',
    sessionFile: SESSION_FILE,
  }));
  invalidateRegistryCache();

  try {
    const closed = await post(`/api/sessions/${id}/close`, {});
    assert.equal(closed.status, 404, JSON.stringify(closed.body));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(processIdentityAlive(actual), true, 'unrelated reused-PID process received no signal');
    assert.equal(fs.existsSync(registryPath), false, 'mismatched current claim was pruned');
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    fs.rmSync(registryPath, { force: true });
    fs.rmSync(socketPath, { force: true });
    invalidateRegistryCache();
  }
});

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
  const identity = processIdentity(child.pid);
  fs.writeFileSync(path.join(registryDir, `${CLOSE_ID}.json`), JSON.stringify({
    sessionId: CLOSE_ID, socketPath: sockStub, pid: child.pid, startTime: identity.startTime,
    cwd: '/home/user/proj',
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

test('POST /close refuses an unreachable legacy registry PID without signaling it', async () => {
  const { spawn } = require('node:child_process');
  const id = '2026-07-04T16-10-00-legacy-refuse';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  const registryPath = path.join(registryDir, `${id}.json`);
  const socketPath = path.join(tmpHome, 'legacy-refuse.sock');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const identity = processIdentity(child.pid);
  fs.writeFileSync(socketPath, 'not a listening socket');
  fs.writeFileSync(registryPath, JSON.stringify({
    sessionId: id, socketPath, pid: child.pid, sessionFile: SESSION_FILE,
  }));
  invalidateRegistryCache();

  try {
    const listed = await get('/api/sessions?active=1');
    assert.ok(listed.body.active.some((session) => session.id === id),
      'a live legacy PID remains visible without a birth marker');
    const closed = await post(`/api/sessions/${id}/close`, {});
    assert.equal(closed.status, 409, JSON.stringify(closed.body));
    assert.match(closed.body.error, /without a successful bridge identity handshake/);
    assert.equal(processIdentityAlive(identity), true, 'legacy PID received no unproven signal');
    assert.equal(fs.existsSync(registryPath), false, 'unreachable legacy claim was pruned');
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    fs.rmSync(registryPath, { force: true });
    fs.rmSync(socketPath, { force: true });
    invalidateRegistryCache();
  }
});

test('POST /close accepts a legacy entry only after its bridge hello proves session and PID', async () => {
  const { spawn } = require('node:child_process');
  const id = '2026-07-04T16-20-00-legacy-proof';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  const registryPath = path.join(registryDir, `${id}.json`);
  const socketPath = path.join(tmpHome, 'legacy-proof.sock');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const sockets = [];
  const bridge = net.createServer((sock) => {
    sockets.push(sock);
    sock.write(JSON.stringify({ type: 'hello', sessionId: id, pid: child.pid }) + '\n');
  });
  await new Promise((r) => bridge.listen(socketPath, r));
  fs.writeFileSync(registryPath, JSON.stringify({
    sessionId: id, socketPath, pid: child.pid, sessionFile: SESSION_FILE,
  }));
  invalidateRegistryCache();

  try {
    const exited = new Promise((r) => child.once('exit', (code, signal) => r(signal)));
    const closed = await post(`/api/sessions/${id}/close`, {});
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(await exited, 'SIGTERM', 'proved legacy pi received graceful SIGTERM');
    assert.equal(fs.existsSync(registryPath), false, 'closed legacy claim was pruned');
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    for (const sock of sockets) sock.destroy();
    await new Promise((r) => bridge.close(r));
    fs.rmSync(registryPath, { force: true });
    invalidateRegistryCache();
  }
});

test('POST /close preserves a legacy claim when a stale pooled hello does not match', async () => {
  const { spawn } = require('node:child_process');
  const id = '2026-07-04T16-30-00-legacy-mismatch';
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  const registryPath = path.join(registryDir, `${id}.json`);
  const socketPath = path.join(tmpHome, 'legacy-mismatch.sock');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const identity = processIdentity(child.pid);
  const sockets = [];
  const bridge = net.createServer((sock) => {
    sockets.push(sock);
    sock.write(JSON.stringify({ type: 'hello', sessionId: id, pid: process.pid }) + '\n');
  });
  await new Promise((r) => bridge.listen(socketPath, r));
  fs.writeFileSync(registryPath, JSON.stringify({
    sessionId: id, socketPath, pid: child.pid, sessionFile: SESSION_FILE,
  }));
  invalidateRegistryCache();

  try {
    const closed = await post(`/api/sessions/${id}/close`, {});
    assert.equal(closed.status, 409, JSON.stringify(closed.body));
    assert.match(closed.body.error, /did not prove the registered session and PID/);
    assert.equal(processIdentityAlive(identity), true, 'mismatched hello authorized no signal');
    assert.equal(fs.existsSync(registryPath), true, 'mismatch does not erase the current claim');
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    for (const sock of sockets) sock.destroy();
    await new Promise((r) => bridge.close(r));
    fs.rmSync(registryPath, { force: true });
    invalidateRegistryCache();
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

test('inactive OMP tree routes return capability errors without calling the Pi SDK', async () => {
  const originalGetTree = piSDK.getSessionTree;
  const originalBranch = piSDK.branchSession;
  let sdkCalls = 0;
  piSDK.getSessionTree = piSDK.branchSession = async () => {
    sdkCalls++;
    throw new Error('OMP file reached the Pi SDK');
  };
  try {
    const tree = await get(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/tree`);
    assert.equal(tree.status, 409);
    assert.match(tree.body.error, /inactive Oh My Pi session/i);

    const navigate = await post(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/branch`, { entryId: 'omp-u1' });
    assert.equal(navigate.status, 409);
    assert.match(navigate.body.error, /inactive Oh My Pi session/i);
    assert.equal(sdkCalls, 0, 'no inactive OMP tree path may enter lib/pi-sdk.js');
  } finally {
    piSDK.getSessionTree = originalGetTree;
    piSDK.branchSession = originalBranch;
  }
});

test('OMP transcript loading does not wait for the optional pricing catalog', async (t) => {
  fs.rmSync(path.join(tmpHome, '.pi', 'dish', 'pricing', 'omp.json'), { force: true });
  harnessPricing.resetForTests();
  let catalogCallback;
  let catalogStartedResolve;
  const catalogStarted = new Promise(resolve => { catalogStartedResolve = resolve; });
  t.mock.method(childProcess, 'execFile', (_file, _args, _options, callback) => {
    catalogCallback = callback;
    catalogStartedResolve();
    return {};
  });

  const request = get(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/messages`);
  await catalogStarted;
  let timeout;
  const raced = await Promise.race([
    request.then(result => ({ result })),
    new Promise(resolve => { timeout = setTimeout(() => resolve({ timedOut: true }), 500); }),
  ]);
  clearTimeout(timeout);
  // Settle the background refresh before the mock is restored, including on
  // an old/blocking implementation where the request lost the race.
  catalogCallback(null, JSON.stringify({ models: [{
    provider: 'zai', id: 'glm-test', cost: { input: 1, output: 2 },
  }] }), '');
  await harnessPricing.refreshHarnessPricing('omp');
  const result = raced.result || await request;
  assert.equal(raced.timedOut, undefined, 'transcript response was held behind catalog refresh');
  assert.equal(result.status, 200);
  assert.ok(result.body.messages.length > 0);
});

test('live OMP tree routes use tree_read/tree_navigate and the transcript follows the bridge leaf', async () => {
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const socketPath = path.join(tmpHome, 'dish-omp-tree-test.sock');
  const bridgeInstanceId = 'omp-tree-server-test';
  const capabilities = { treeRead: true, treeNavigation: true };
  const claim = {
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp',
    nativeSessionId: OMP_SESSION_ID,
    sessionId: OMP_SESSION_ID,
    sessionFile: ompSessionFile,
    bridgeInstanceId,
    instanceId: bridgeInstanceId,
    socketPath,
    pid: process.pid,
    startTime: processIdentity(process.pid).startTime,
    spawnToken: null,
    capabilities,
    cwd: ompCwd,
  };
  let leafId = 'omp-a1';
  let pendingNavigation = null;
  const received = [];
  const socks = [];
  const bridge = net.createServer((sock) => {
    socks.push(sock);
    sock.write(JSON.stringify({ type: 'hello', ...claim, turnInProgress: false }) + '\n');
    let buffer = '';
    sock.on('data', (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const command = JSON.parse(line);
        received.push(command);
        if (command.command === 'tree_read') {
          const activePathIds = leafId === 'omp-u1' ? ['omp-u1'] : ['omp-a1', 'omp-u1'];
          sock.write(JSON.stringify({
            type: 'response', id: command.id, command: command.command, success: true,
            data: {
              leafId,
              activePathIds,
              nodes: [
                { id: 'omp-u1', parentId: null, type: 'message', role: 'user', text: 'OMP shared prompt', depth: 0, active: true, isLeaf: leafId === 'omp-u1', childCount: 1 },
                { id: 'omp-a1', parentId: 'omp-u1', type: 'message', role: 'assistant', text: 'OMP shared answer', depth: 0, active: leafId === 'omp-a1', isLeaf: leafId === 'omp-a1', childCount: 0 },
              ],
            },
          }) + '\n');
        } else if (command.command === 'tree_navigate') {
          // Real OMP cannot service this until the server types the internal
          // bridge command into its TUI and OMP supplies a command context.
          pendingNavigation = { sock, command };
          sock.write(JSON.stringify({
            type: 'event', event: 'tree_operation_queued',
            data: { requestId: command.id, operation: 'navigate' },
          }) + '\n');
        } else {
          sock.write(JSON.stringify({ type: 'response', id: command.id, command: command.command, success: false, error: `unknown command: ${command.command}` }) + '\n');
        }
      }
    });
  });
  await new Promise((resolve) => bridge.listen(socketPath, resolve));
  const registryPath = path.join(registryDir, 'omp-tree-server-test.json');
  fs.writeFileSync(registryPath, JSON.stringify(claim));
  invalidateRegistryCache();

  const originalGetTree = piSDK.getSessionTree;
  const originalBranch = piSDK.branchSession;
  const originalFindPaneByPid = tmux.findPaneByPid;
  const originalSendKeys = tmux.sendKeys;
  let sdkCalls = 0;
  const serviceCommands = [];
  piSDK.getSessionTree = piSDK.branchSession = async () => {
    sdkCalls++;
    throw new Error('live OMP file reached the Pi SDK');
  };
  tmux.findPaneByPid = async () => ({ socket: '/fake/omp-tmux.sock', paneId: '%42' });
  tmux.sendKeys = async (socket, paneId, text) => {
    serviceCommands.push({ socket, paneId, text });
    assert.ok(pendingNavigation, 'bridge operation was queued before command-context acquisition');
    const { sock, command } = pendingNavigation;
    pendingNavigation = null;
    leafId = command.targetId;
    sock.write(JSON.stringify({
      type: 'response', id: command.id, command: command.command, success: true,
      data: { editorText: 'OMP shared prompt', leafId },
    }) + '\n');
  };
  try {
    const tree = await get(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/tree`);
    assert.equal(tree.status, 200, JSON.stringify(tree.body));
    assert.equal(tree.body.leafId, 'omp-a1');

    const navigate = await post(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/branch`, {
      entryId: 'omp-u1', summarize: true, customInstructions: 'not supported by OMP',
    });
    assert.equal(navigate.status, 200, JSON.stringify(navigate.body));
    assert.equal(navigate.body.editorText, 'OMP shared prompt');
    const wireNavigate = received.find((command) => command.command === 'tree_navigate');
    assert.ok(wireNavigate, 'server used OMP tree_navigate');
    assert.equal(wireNavigate.targetId, 'omp-u1');
    assert.equal(wireNavigate.summarize, true);
    assert.equal(wireNavigate.customInstructions, undefined, 'unsupported OMP summary instructions stay off the wire');
    assert.deepEqual(serviceCommands, [{
      socket: '/fake/omp-tmux.sock', paneId: '%42', text: '/dish-tree-service',
    }]);

    const messages = await get(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/messages`);
    assert.equal(messages.status, 200, JSON.stringify(messages.body));
    assert.deepEqual(messages.body.messages.map((message) => message.content?.[0]?.text), ['OMP shared prompt']);
    assert.equal(sdkCalls, 0, 'no live OMP tree path may enter lib/pi-sdk.js');
  } finally {
    piSDK.getSessionTree = originalGetTree;
    piSDK.branchSession = originalBranch;
    tmux.findPaneByPid = originalFindPaneByPid;
    tmux.sendKeys = originalSendKeys;
    fs.rmSync(registryPath, { force: true });
    invalidateRegistryCache();
    for (const sock of socks) sock.destroy();
    await new Promise((resolve) => bridge.close(resolve));
  }
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

  const piAlias = encodeSessionKey('pi', TREE_ID);
  const throughAlias = await post(`/api/sessions/${piAlias}/share`, {});
  assert.equal(throughAlias.body.token, first.body.token, 'encoded Pi alias reuses the raw Pi share identity');
  const aliasState = await get(`/api/sessions/${piAlias}/share`);
  assert.equal(aliasState.body.token, first.body.token);

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

test('OMP sessions can create and render public share links', async () => {
  const created = await post(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/share`, {});
  assert.equal(created.status, 200, JSON.stringify(created.body));

  const res = await fetch(`${base}${created.body.path}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Native OMP fixture export'), 'sharing uses the OMP renderer');
  const dataMatch = html.match(/id="session-data"[^>]*>([^<]+)</);
  assert.ok(dataMatch, 'OMP export embeds session data');
  const payload = JSON.parse(Buffer.from(dataMatch[1], 'base64').toString('utf8'));
  assert.equal(payload.header.id, OMP_SESSION_ID);
  assert.ok(payload.entries.some(entry => entry.id === 'omp-a1'), 'OMP transcript entries reach the export');
  assert.ok(payload.entries.some(entry => entry.type === 'title'), 'OMP pre-header records are preserved');
  assert.equal(fs.readFileSync(ompSessionFile, 'utf8').split('\n')[0],
    JSON.stringify({ type: 'title', title: 'Exact OMP fixture' }), 'sharing does not rewrite the OMP session');
});

test('live OMP shares include the effective system prompt and active tools', async () => {
  const socketPath = path.join(tmpHome, 'omp-share-snapshot.sock');
  const identity = processIdentity(process.pid);
  const instanceId = 'omp-share-snapshot';
  const claim = {
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp', nativeSessionId: OMP_SESSION_ID, sessionId: OMP_SESSION_ID,
    bridgeInstanceId: instanceId, instanceId,
    sessionFile: ompSessionFile, socketPath, cwd: ompCwd,
    pid: identity.pid, startTime: identity.startTime,
    capabilities: { shareSnapshot: true }, spawnToken: null,
  };
  const sockets = new Set();
  const bridge = net.createServer(sock => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.write(JSON.stringify({ type: 'hello', ...claim }) + '\n');
    let pending = '';
    sock.on('data', chunk => {
      pending += chunk;
      for (;;) {
        const newline = pending.indexOf('\n');
        if (newline < 0) break;
        const command = JSON.parse(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        if (command.command === 'share_snapshot') {
          sock.write(JSON.stringify({
            type: 'response', id: command.id, success: true,
            data: {
              systemPrompt: 'effective OMP system prompt',
              tools: [{ name: 'read', description: 'Read a file' }],
            },
          }) + '\n');
        }
      }
    });
  });
  await new Promise(resolve => bridge.listen(socketPath, resolve));
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const registryPath = path.join(registryDir, `${instanceId}.json`);
  fs.writeFileSync(registryPath, JSON.stringify(claim));
  invalidateRegistryCache();

  try {
    const created = await post(`/api/sessions/${encodeURIComponent(OMP_ROUTE_ID)}/share`, {});
    const shared = await fetch(`${base}${created.body.path}`);
    assert.equal(shared.status, 200);
    const html = await shared.text();
    const dataMatch = html.match(/id="session-data"[^>]*>([^<]+)</);
    const payload = JSON.parse(Buffer.from(dataMatch[1], 'base64').toString('utf8'));
    assert.equal(payload.systemPrompt, 'effective OMP system prompt');
    assert.deepEqual(payload.tools, [{ name: 'read', description: 'Read a file' }]);
  } finally {
    fs.rmSync(registryPath, { force: true });
    invalidateRegistryCache();
    for (const sock of sockets) sock.destroy();
    await new Promise(resolve => bridge.close(resolve));
  }
});

test('OMP custom /share imports and serves its exact native live HTML', async () => {
  const data = {
    header: { type: 'session', id: 'live-omp-share' },
    entries: [{ type: 'message', id: 'live-a1' }],
    systemPrompt: 'effective live system prompt',
    tools: [{ name: 'read', description: 'Read a file' }],
  };
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
  const html = `<!doctype html><html><body><h1>exact native OMP snapshot</h1><script id="session-data">${encoded}</script></body></html>`;
  const imported = await fetch(`${base}/api/shares/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  });
  const result = await imported.json();
  assert.equal(imported.status, 200, JSON.stringify(result));
  assert.equal(result.path, `/share/${result.token}`);

  const shared = await fetch(`${base}${result.path}`);
  assert.equal(shared.status, 200);
  assert.equal(await shared.text(), html, 'the live export is not reconstructed or altered');

  const invalid = await fetch(`${base}/api/shares/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/html' },
    body: '<html><h1>not an OMP export</h1></html>',
  });
  assert.equal(invalid.status, 400);
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

test('dedicated share listener serves shared sessions, pages, and standalone file styles', async () => {
  const { spawn } = require('node:child_process');
  // Create a share on the main server (writes shares.json under tmpHome; the
  // child reads the same HOME).
  const created = await post(`/api/sessions/${TREE_ID}/share`, {});
  const pageFile = path.join(realCwd, 'share-listener-page.html');
  const rawPage = '<!doctype html><h1>raw shared page</h1>';
  fs.writeFileSync(pageFile, rawPage);
  const page = await post('/api/pages', { path: pageFile, sessionId: REAL_CWD_ID });
  const viewedFile = path.join(realCwd, 'share-listener-file.md');
  fs.writeFileSync(viewedFile, '# shared rendered file\n');
  const viewedPage = await post('/api/pages', {
    path: viewedFile, sessionId: REAL_CWD_ID, renderer: 'file',
  });

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

    const viewedRes = await fetch(`${shareBase}/page/${viewedPage.body.token}`);
    assert.equal(viewedRes.status, 200);
    assert.match(await viewedRes.text(), /<h1>shared rendered file<\/h1>/);
    assert.equal((await fetch(`${shareBase}/style.css`)).status, 200,
      'standalone file pages can load their shared renderer styles');
    assert.equal((await fetch(`${shareBase}/vendor/hljs-theme.min.css`)).status, 200);

    const notFound = await fetch(`${shareBase}/api/sessions`);
    assert.equal(notFound.status, 404, 'the share listener does not expose the main API');
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

test('OMP session_switch re-keys the owned pane, active route, history source, and old-route SSE', async () => {
  const oldNativeId = 'omp-switch-old';
  const newNativeId = 'omp-switch-new';
  const oldRouteId = encodeSessionKey('omp', oldNativeId);
  const newRouteId = encodeSessionKey('omp', newNativeId);
  const switchDir = path.join(tmpHome, '.omp', 'agent', 'sessions', 'session-switch');
  const oldFile = path.join(switchDir, `${oldNativeId}.jsonl`);
  const newFile = path.join(switchDir, `${newNativeId}.jsonl`);
  fs.mkdirSync(switchDir, { recursive: true });
  fs.writeFileSync(oldFile, [
    { type: 'title', title: 'Old switched session' },
    { type: 'session', version: 3, id: oldNativeId, cwd: ompCwd },
    { type: 'message', id: 'switch-old-u1', parentId: null, message: { role: 'user', content: 'old history marker' } },
  ].map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(newFile, [
    { type: 'title', title: 'New switched session' },
    { type: 'session', version: 3, id: newNativeId, cwd: ompCwd },
    { type: 'message', id: 'switch-new-u1', parentId: null, message: { role: 'user', content: 'new history marker' } },
  ].map(JSON.stringify).join('\n') + '\n');

  const socketPath = path.join(tmpHome, 'omp-session-switch.sock');
  const identity = processIdentity(process.pid);
  const instanceId = 'omp-session-switch-instance';
  const baseClaim = {
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp', bridgeInstanceId: instanceId, instanceId,
    socketPath, pid: identity.pid, startTime: identity.startTime,
    cwd: ompCwd, spawnToken: null,
    capabilities: { commands: true },
  };
  let claim = {
    ...baseClaim,
    nativeSessionId: oldNativeId, sessionId: oldNativeId, sessionFile: oldFile,
  };
  const bridgeSockets = new Set();
  let bridgeConnectionCount = 0;
  const bridge = net.createServer(sock => {
    bridgeConnectionCount++;
    bridgeSockets.add(sock);
    sock.on('close', () => bridgeSockets.delete(sock));
    sock.on('error', () => {});
    sock.write(JSON.stringify({ type: 'hello', ...claim, turnInProgress: false }) + '\n');
  });
  await new Promise(resolve => bridge.listen(socketPath, resolve));
  const registryDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registryDir, { recursive: true });
  const registryPath = path.join(registryDir, `omp-${instanceId}.json`);
  fs.writeFileSync(registryPath, JSON.stringify(claim));
  invalidateRegistryCache();

  const originalPaneExists = tmux.paneExists;
  const originalSendKeys = tmux.sendKeys;
  const injected = [];
  const stream = sseReader(`${base}/api/sessions/${encodeURIComponent(oldRouteId)}/stream`);
  try {
    await stream.waitFor(event => event.event === 'init');
    tmux.recordSpawn(oldRouteId, {
      socket: '/fake/omp-session-switch.sock', paneId: '%91', bridgeInstanceId: instanceId,
    });
    tmux.paneExists = async (socket, paneId) => socket === '/fake/omp-session-switch.sock' && paneId === '%91';
    tmux.sendKeys = async (socket, paneId, text) => injected.push({ socket, paneId, text });

    claim = {
      ...baseClaim,
      nativeSessionId: newNativeId, sessionId: newNativeId, sessionFile: newFile,
    };
    fs.writeFileSync(registryPath, JSON.stringify(claim));
    for (const sock of bridgeSockets) sock.write(JSON.stringify({
      type: 'event',
      event: 'session_switch',
      data: {
        sessionId: newNativeId,
        sessionFile: newFile,
        previousSessionId: oldNativeId,
        previousSessionFile: oldFile,
        cwd: ompCwd,
        reason: 'new',
      },
    }) + '\n');

    const switchEvent = await stream.waitFor(event => event.event === 'session_switch');
    assert.equal(switchEvent.data.sessionId, newRouteId);
    assert.equal(switchEvent.data.previousSessionId, oldRouteId);
    assert.equal(switchEvent.data.nativeSessionId, newNativeId);
    assert.equal(tmux.getSpawn(oldRouteId), null);
    assert.equal(tmux.getSpawn(newRouteId)?.paneId, '%91');

    const listed = await get('/api/sessions');
    assert.ok(listed.body.active.some(session => session.id === newRouteId), 'new route is active');
    assert.ok(listed.body.previous.some(session => session.id === oldRouteId), 'old route remains historical');
    assert.equal(listed.body.active.some(session => session.id === oldRouteId), false);

    const newMessages = await get(`/api/sessions/${encodeURIComponent(newRouteId)}/messages`);
    const oldMessages = await get(`/api/sessions/${encodeURIComponent(oldRouteId)}/messages`);
    assert.match(JSON.stringify(newMessages.body.messages), /new history marker/);
    assert.match(JSON.stringify(oldMessages.body.messages), /old history marker/);
    assert.doesNotMatch(JSON.stringify(newMessages.body.messages), /old history marker/);
    assert.equal(bridgeConnectionCount, 1, 'new route reuses the instance-keyed bridge connection');

    const shake = await post(`/api/sessions/${encodeURIComponent(newRouteId)}/command`, { message: '/shake' });
    assert.equal(shake.status, 200, JSON.stringify(shake.body));
    assert.deepEqual(injected, [{ socket: '/fake/omp-session-switch.sock', paneId: '%91', text: '/shake' }]);
  } finally {
    stream.close();
    tmux.paneExists = originalPaneExists;
    tmux.sendKeys = originalSendKeys;
    tmux.removeSpawn(oldRouteId);
    tmux.removeSpawn(newRouteId);
    fs.rmSync(registryPath, { force: true });
    fs.rmSync(switchDir, { recursive: true, force: true });
    invalidateRegistryCache();
    for (const sock of bridgeSockets) sock.destroy();
    await new Promise(resolve => bridge.close(resolve));
  }
});

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
    emit('tool_execution_start', {
      toolCallId: 'replay-tool', toolName: 'Bash', args: { command: 'sleep 12' }, startedAt: 123,
    });
    emit('tool_execution_update', {
      toolCallId: 'replay-tool', partialResult: { content: [{ type: 'text', text: 'still running' }] },
    });
    emit('message_end', { message: {
      role: 'custom', customType: 'interrupted-thinking',
      content: 'private interrupted reasoning', display: false, timestamp: 124,
    } });
    emit('message_end', { message: {
      role: 'custom', customType: 'private-host-state',
      content: 'private host state', display: false, timestamp: 125,
    } });
    emit('message_end', { message: {
      role: 'custom', customType: 'visible-sentinel',
      content: 'visible custom notice', display: true, timestamp: 126,
    } });
    await s1.waitFor(e => e.event === 'extension_ui_request' && e.data?.method === 'confirm');
    await s1.waitFor(e => e.event === 'tool_execution_update' && e.data?.toolCallId === 'replay-tool');
    const interrupted = await s1.waitFor(e =>
      e.event === 'message_end' && e.data?.message?.customType === 'interrupted-thinking');
    assert.deepEqual(interrupted.data.message.content, [], 'hidden interrupted reasoning is projected to a marker');
    await s1.waitFor(e => e.event === 'message_end' && e.data?.message?.customType === 'visible-sentinel');
    assert.equal(s1.events.some(e => e.data?.message?.customType === 'private-host-state'), false,
      'other hidden custom messages are explicitly skipped');
    s1.close();

    // Second client connects with the bridge silent: the remembered widget
    // and dialog plus the in-flight tool's start/latest update are replayed.
    const s2 = sseReader(`${base}/api/sessions/${BRIDGE_ID}/stream`);
    const replayStart = await s2.waitFor(e => e.event === 'tool_execution_start' && e.data?.toolCallId === 'replay-tool');
    const replayUpdate = await s2.waitFor(e => e.event === 'tool_execution_update' && e.data?.toolCallId === 'replay-tool');
    assert.deepEqual(replayStart.data, {
      toolCallId: 'replay-tool', toolName: 'Bash', args: { command: 'sleep 12' }, startedAt: 123,
    });
    assert.equal(replayUpdate.data.partialResult.content[0].text, 'still running');
    assert.ok(s2.events.findIndex(e => e.event === 'init') <
      s2.events.findIndex(e => e.event === 'tool_execution_start'), 'tool replay follows init');
    const widget = await s2.waitFor(e => e.event === 'extension_ui_request' && e.data?.method === 'setWidget');
    assert.deepEqual(widget.data.widgetLines, ['one', 'two']);
    assert.equal(widget.data.widgetKey, 'procs');
    await s2.waitFor(e => e.event === 'extension_ui_request' && e.data?.id === 'dlg1');

    // Clearing the widget and resolving the dialog empties the replay set.
    // Wait for both on the open connection so the server has seen them.
    emit('tool_execution_end', {
      toolCallId: 'replay-tool', toolName: 'Bash', args: { command: 'sleep 12' },
      result: { content: [{ type: 'text', text: 'done' }] }, isError: false,
    });
    emit('extension_ui_request', { method: 'setWidget', widgetKey: 'procs', widgetLines: [] });
    emit('extension_ui_resolved', { id: 'dlg1' });
    await s2.waitFor(e => e.event === 'tool_execution_end' && e.data?.toolCallId === 'replay-tool');
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
    assert.equal(s3.events.some(e => e.event.startsWith('tool_execution_')), false,
      'completed tools are absent from later reconnect snapshots');
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

// --- Skills view -----------------------------------------------------------

test('GET /api/skills discovers the fixture skill with mined usage rollups', async () => {
  const { status, body } = await get('/api/skills');
  assert.equal(status, 200);
  assert.equal(body.precision, 'estimate');
  assert.ok(body.summary.discovered >= 1);
  const demo = body.skills.find(s => s.name === 'demo');
  assert.ok(demo, 'demo skill discovered via pi\'s loader');
  assert.equal(demo.skill, SKILL_MD, 'identity is the absolute SKILL.md path');
  assert.equal(demo.source, 'global');
  assert.equal(demo.advertised, true);
  assert.ok(demo.bodyTokensEst > 0);
  assert.ok(demo.catalogTokensEst > 0);
  // Mined activations: one explicit + one read + one targeted grep.
  assert.equal(demo.usage.kindSplit.read, 1);
  assert.equal(demo.usage.kindSplit.explicit, 1);
  assert.equal(demo.usage.kindSplit.targeted, 1);
  assert.equal(demo.usage.total, 3);
  assert.equal(demo.usage.weeks12.length, 12);
  assert.ok(demo.usage.lastUsedTs > 0);
  assert.ok(body.refine, 'refine config present');
});

test('disable-model-invocation skills would be manual with zero advertised cost', async () => {
  // The fixture skill is advertised; assert the invariant the endpoint encodes:
  // advertised catalog tokens come only from non-manual skills.
  const { body } = await get('/api/skills');
  const advertisedTokens = body.skills.filter(s => s.advertised).reduce((a, s) => a + s.catalogTokensEst, 0);
  const manualTokens = body.skills.filter(s => !s.advertised).reduce((a, s) => a + s.catalogTokensEst, 0);
  assert.equal(manualTokens, 0, 'manual-only skills add zero advertised cost');
  assert.ok(advertisedTokens > 0);
});

test('GET /api/skills/activations streams NDJSON and honors filters', async () => {
  const url = '/api/skills/activations?skill=' + encodeURIComponent(SKILL_MD);
  const res = await fetch(base + url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/x-ndjson/);
  const lines = (await res.text()).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.ok(lines.every(r => r.skill === SKILL_MD));

  const explicit = await fetch(base + url + '&kind=explicit').then(r => r.text());
  const exLines = explicit.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(exLines.length, 1);
  assert.equal(exLines[0].kind, 'explicit', 'a /skill: block shows as kind explicit');

  const reads = await fetch(base + url + '&kind=read').then(r => r.text());
  assert.equal(reads.trim().split('\n').filter(Boolean).length, 1);

  const byCwd = await fetch(base + url + '&cwd=' + encodeURIComponent('/nope')).then(r => r.text());
  assert.equal(byCwd.trim(), '', 'cwd filter excludes non-matching records');

  const since = await fetch(base + url + '&since=' + encodeURIComponent('2027-01-01')).then(r => r.text());
  assert.equal(since.trim(), '', 'since filter excludes older records');
});

test('GET /api/skills/coverage maps ranged reads since mtime; targeted are touches', async () => {
  const { status, body } = await get('/api/skills/coverage?skill=' + encodeURIComponent(SKILL_MD));
  assert.equal(status, 200);
  assert.equal(body.skill, SKILL_MD);
  assert.equal(body.numMapped, 1, 'only the ranged read since mtime maps');
  assert.equal(body.targetedTouches, 1, 'the grep is a touch, not a mapped read');
  assert.equal(body.excludedBeforeMtime, 1, 'the pre-mtime explicit invocation is excluded from the map');
  assert.equal(body.flatFullRead, false, 'a partial read is not the flat case');
  assert.ok(body.unreadTokensEst > 0, 'the unread sections carry an estimate');
  const cold = body.sections.filter(s => s.neverRead);
  assert.ok(cold.length >= 2, 'Sections B and C are never read');
  assert.ok(body.sections.some(s => s.reads === 1), 'the read touches at least one section');
  assert.ok(body.latest && body.latest.sessionId === SKILLS_SESSION_ID, 'latest activation deep-links its session');
  assert.equal(body.weeks26.length, 26);
});

test('GET /api/skills/coverage validates the skill path', async () => {
  assert.equal((await get('/api/skills/coverage')).status, 400);
  assert.equal((await get('/api/skills/coverage?skill=' + encodeURIComponent('/not/a/skill.txt'))).status, 400);
  assert.equal((await get('/api/skills/coverage?skill=' + encodeURIComponent('/nope/SKILL.md'))).status, 404);
});
