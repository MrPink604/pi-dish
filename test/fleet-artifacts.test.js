/**
 * Fleet artifacts: shares and pages that live on a peer but are served
 * publicly by a hub (TASKS/multi-host.md block 7).
 *
 * Two real pi-dish servers, booted as child processes like
 * test/remote-hosts.test.js (tokens, ports and the share listener are all
 * resolved at startup): a **peer** with a v3 fixture session, a published
 * page directory and its own bearer token, and a **hub** whose settings.json
 * names the peer and which additionally runs a PI_DISH_SHARE_PORT listener.
 * A second hub (`hubPub`) exists only to prove the returned `url` is rewritten
 * to the *hub's* public base, not the peer's.
 *
 * A third "counter" remote is a plain http server that only answers
 * /api/host and tallies everything else — that is how "an unmapped token
 * never contacts a peer" is asserted directly rather than by timing alone.
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');
const CLI = path.join(__dirname, '..', 'skills', 'pi-dish-pages', 'scripts', 'pi-dish-pages.js');

const PEER_TOKEN = 'peer-token-artifacts-0123456';
const PEER_SESSION_ID = '2026-08-22T11-00-00-artfix01';
const PEER_BASE_URL = 'http://peer.example';
const HUB_BASE_URL = 'https://hub.example';

const children = [];
const closables = [];
test.after(() => {
  for (const child of children) { try { child.kill('SIGKILL'); } catch {} }
  for (const server of closables) { try { server.close(); } catch {} }
});

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-artifacts-'));
  fs.mkdirSync(path.join(home, '.pi', 'agent', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.pi', 'dish'), { recursive: true });
  return home;
}

// A valid pi v3 session: the HTML exporter behind /share rejects the id-less
// shorthand fixtures other suites use.
function writeFixtureSession(home) {
  // Sessions live under a cwd-encoded directory, like pi writes them.
  const dir = path.join(home, '.pi', 'agent', 'sessions', '--home-user-peerproj--');
  fs.mkdirSync(dir, { recursive: true });
  const entries = [
    { type: 'session', version: 3, id: 'ffff0000-1111-2222-3333-444455556666', cwd: '/home/user/peerproj', timestamp: '2026-08-22T11:00:00.000Z' },
    { type: 'message', id: 'p1', parentId: null, timestamp: '2026-08-22T11:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'peer fixture prompt' }], timestamp: '2026-08-22T11:00:01.000Z' } },
    { type: 'message', id: 'p2', parentId: 'p1', timestamp: '2026-08-22T11:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'peer fixture answer' }], timestamp: '2026-08-22T11:00:02.000Z' } },
  ];
  fs.writeFileSync(path.join(dir, `${PEER_SESSION_ID}.jsonl`), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function writePageDir(home, name, body) {
  const dir = path.join(home, 'artifacts', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><body><p>${body}</p></body></html>`);
  fs.writeFileSync(path.join(dir, 'style.css'), 'body { color: peer-asset-color; }');
  return dir;
}

function writeSettings(home, settings) {
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'), JSON.stringify(settings));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function boot(home, extraEnv = {}) {
  const port = await freePort();
  const env = { ...process.env, HOME: home, PORT: String(port) };
  delete env.PI_DISH_TOKEN;
  delete env.PI_DISH_TERMINAL;
  delete env.PI_DISH_SHARE_PORT;
  delete env.PI_DISH_SHARE_BASE_URL;
  env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-artifacts-tmux-'));
  Object.assign(env, extraEnv);

  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (b) => { stderr += b; });
  child.stdout.resume();

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode}): ${stderr}`);
    try {
      const res = await fetch(`${base}/api/host`);
      if (res.ok) { await res.json(); break; }
    } catch {}
    if (Date.now() > deadline) throw new Error(`server did not come up: ${stderr}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, port, child, home };
}

const authed = (token, init = {}) => ({
  ...init,
  headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
});

async function json(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`not JSON (${response.status}): ${text.slice(0, 200)}`); }
}

let peer;
let hub;
let hubPub;
let hubShareBase;
let counterHits;
let peerHostId;
let pageDir;
let secondPageDir;

test('boot a peer, a counting remote and two hubs that know about them', async () => {
  const peerHome = makeHome();
  writeFixtureSession(peerHome);
  pageDir = writePageDir(peerHome, 'plan', 'peer page body');
  secondPageDir = writePageDir(peerHome, 'report', 'second peer page');
  fs.writeFileSync(path.join(peerHome, '.pi', 'dish', 'token'), `${PEER_TOKEN}\n`);
  writeSettings(peerHome, { hostLabel: 'tycho' });
  // The peer hands out its own absolute URLs; a hub must not repeat them.
  peer = await boot(peerHome, { PI_DISH_SHARE_BASE_URL: PEER_BASE_URL });
  peerHostId = (await json(await fetch(`${peer.base}/api/host`))).hostId;

  counterHits = [];
  const counter = http.createServer((req, res) => {
    if (req.url === '/api/host') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ hostId: '22222222-2222-4222-8222-222222222222', label: 'counter', version: '9.9.9', capabilities: {} }));
    }
    counterHits.push(`${req.method} ${req.url}`);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
  closables.push(counter);
  await new Promise((resolve) => counter.listen(0, '127.0.0.1', resolve));
  const counterPort = counter.address().port;

  const remotes = [
    { name: 'peer', url: `http://127.0.0.1:${peer.port}`, token: PEER_TOKEN },
    { name: 'counter', url: `http://127.0.0.1:${counterPort}` },
  ];

  const hubHome = makeHome();
  writeSettings(hubHome, { hostLabel: 'hub', remotes });
  const sharePort = await freePort();
  hubShareBase = `http://127.0.0.1:${sharePort}`;
  hub = await boot(hubHome, { PI_DISH_SHARE_PORT: String(sharePort) });

  const hubPubHome = makeHome();
  writeSettings(hubPubHome, { hostLabel: 'hubpub', remotes });
  hubPub = await boot(hubPubHome, { PI_DISH_SHARE_BASE_URL: HUB_BASE_URL });
});

// --- shares created through the hub proxy --------------------------------

let shareToken;

test('a share created through the proxy is mapped to the peer and re-addressed to the hub', async () => {
  const created = await json(await fetch(`${hub.base}/hosts/peer/api/sessions/${PEER_SESSION_ID}/share`, { method: 'POST' }));
  assert.ok(created.token, 'the peer minted a token');
  shareToken = created.token;
  assert.equal(created.path, `/share/${shareToken}`);
  // The peer's own PI_DISH_SHARE_BASE_URL describes a front door this reader
  // may not have; the hub's answer is the hub's own (here: build it from the
  // origin the browser is already on).
  assert.equal(created.url, null, 'the peer\'s absolute url is replaced, not forwarded');

  const direct = await json(await fetch(`${peer.base}/api/sessions/${PEER_SESSION_ID}/share`, authed(PEER_TOKEN)));
  assert.equal(direct.token, shareToken, 'the token was minted on the owner, not invented by the hub');
  assert.equal(direct.url, `${PEER_BASE_URL}/share/${shareToken}`, 'the peer still hands out its own url');

  const { artifacts } = await json(await fetch(`${hub.base}/api/fleet-artifacts`));
  const entry = artifacts.find((a) => a.token === shareToken);
  assert.ok(entry, 'the hub recorded the mapping');
  assert.equal(entry.host, 'peer');
  assert.equal(entry.kind, 'share');
});

test('a hub with a public base url rewrites the share url to its own', async () => {
  const created = await json(await fetch(`${hubPub.base}/hosts/peer/api/sessions/${PEER_SESSION_ID}/share`, { method: 'POST' }));
  assert.equal(created.token, shareToken, 'the owner\'s share is idempotent across hubs');
  assert.equal(created.url, `${HUB_BASE_URL}/share/${shareToken}`);
});

test('the hub serves the peer\'s export at its own /share/:token', async () => {
  const res = await fetch(`${hub.base}/share/${shareToken}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('<html'), 'the peer\'s standalone export came through');
  const dataMatch = html.match(/id="session-data"[^>]*>([^<]+)</);
  assert.ok(dataMatch, 'export embeds session data');
  const payload = Buffer.from(dataMatch[1], 'base64').toString('utf8');
  assert.ok(payload.includes('peer fixture answer'), 'the content is the peer session, not a hub session');

  // The peer is token-gated; the hub's public route reaches it anyway
  // because the peer's credential lives in the hub's fleet map.
  assert.equal((await fetch(`${peer.base}/api/sessions`)).status, 401);
});

test('the hub\'s public share listener serves fleet shares too', async () => {
  const res = await fetch(`${hubShareBase}/share/${shareToken}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('<html'));
  const payload = Buffer.from(html.match(/id="session-data"[^>]*>([^<]+)</)[1], 'base64').toString('utf8');
  assert.ok(payload.includes('peer fixture answer'));

  // …and still mounts nothing else.
  assert.equal((await fetch(`${hubShareBase}/api/fleet-artifacts`)).status, 404);
  assert.equal((await fetch(`${hubShareBase}/hosts/peer/api/sessions`)).status, 404);
});

// --- pages mapped by an agent on the peer --------------------------------

let pageToken;

test('an agent on the peer maps its page onto the hub by hostId', async () => {
  const page = await json(await fetch(`${peer.base}/api/pages`, authed(PEER_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: pageDir, title: 'Peer plan', sessionId: PEER_SESSION_ID }),
  })));
  pageToken = page.token;
  assert.equal(page.url, `${PEER_BASE_URL}/page/${pageToken}`);

  const mapped = await json(await fetch(`${hub.base}/api/fleet-artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pageToken, kind: 'page', hostId: peerHostId }),
  }));
  assert.equal(mapped.token, pageToken);
  assert.equal(mapped.path, `/page/${pageToken}`);
  assert.equal(mapped.url, null);
  assert.equal(mapped.host, 'peer');
});

test('a hostId no configured remote claims is a 404', async () => {
  const res = await fetch(`${hub.base}/api/fleet-artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'unmappable-token', kind: 'page', hostId: '99999999-9999-4999-8999-999999999999' }),
  });
  assert.equal(res.status, 404);
  const { artifacts } = await json(await fetch(`${hub.base}/api/fleet-artifacts`));
  assert.equal(artifacts.some((a) => a.token === 'unmappable-token'), false);

  // The hub's own identity is not one of its remotes either.
  const hubHostId = (await json(await fetch(`${hub.base}/api/host`))).hostId;
  const self = await fetch(`${hub.base}/api/fleet-artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'self-token', kind: 'page', hostId: hubHostId }),
  });
  assert.equal(self.status, 404);
});

test('the hub serves the peer\'s page, its assets and its trailing-slash redirect', async () => {
  const index = await fetch(`${hub.base}/page/${pageToken}/`);
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.ok(html.includes('peer page body'), 'the page came from the peer\'s disk');

  const asset = await fetch(`${hub.base}/page/${pageToken}/style.css`);
  assert.equal(asset.status, 200);
  assert.ok((await asset.text()).includes('peer-asset-color'));

  // The bare token must still redirect, or the document's relative asset
  // URLs resolve outside the token.
  const bare = await fetch(`${hub.base}/page/${pageToken}`, { redirect: 'manual' });
  assert.equal(bare.status, 302);
  assert.equal(bare.headers.get('location'), `/page/${pageToken}/`);

  const missingAsset = await fetch(`${hub.base}/page/${pageToken}/nope.css`);
  assert.equal(missingAsset.status, 404);
});

test('a single-file page survives a slash-form fetch: redirect, no prune', async () => {
  const file = path.join(peer.home, 'artifacts', 'solo.html');
  fs.writeFileSync(file, '<!doctype html><html><body><p>solo file body</p></body></html>');
  const page = await json(await fetch(`${peer.base}/api/pages`, authed(PEER_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: file, title: 'Solo' }),
  })));
  const mapped = await json(await fetch(`${hub.base}/api/fleet-artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: page.token, kind: 'page', hostId: peerHostId }),
  }));
  assert.equal(mapped.host, 'peer');

  // The owner 404s /page/<t>/ for a file root while /page/<t> is alive —
  // the hub must not read that as a revocation.
  const slashed = await fetch(`${hub.base}/page/${page.token}/`, { redirect: 'manual' });
  assert.equal(slashed.status, 302);
  assert.equal(slashed.headers.get('location'), `/page/${page.token}`);

  const bare = await fetch(`${hub.base}/page/${page.token}`);
  assert.equal(bare.status, 200);
  assert.ok((await bare.text()).includes('solo file body'));

  // A dead token's slash form still prunes: revoke on the owner first.
  await fetch(`${peer.base}/api/pages/${page.token}`, authed(PEER_TOKEN, { method: 'DELETE' }));
  const gone = await fetch(`${hub.base}/page/${page.token}/`);
  assert.equal(gone.status, 404);
  const after = await fetch(`${hub.base}/page/${page.token}`);
  assert.equal(after.status, 404, 'mapping pruned once the bare form is dead too');
});

test('the hub\'s main app makes a fleet page commentable; its public listener does not', async () => {
  const onMain = await (await fetch(`${hub.base}/page/${pageToken}/`)).text();
  assert.ok(onMain.includes('artifact-comments.js'), 'the overlay is injected where /api can answer it');

  const onPublic = await fetch(`${hubShareBase}/page/${pageToken}/`);
  assert.equal(onPublic.status, 200);
  const publicHtml = await onPublic.text();
  assert.ok(publicHtml.includes('peer page body'));
  assert.equal(publicHtml.includes('artifact-comments.js'), false, 'the public listener serves raw page HTML');
});

test('an unmapped token is an instant bare 404 that contacts nobody', async () => {
  counterHits.length = 0;
  const started = Date.now();
  for (const url of [
    `${hub.base}/share/definitely-not-a-token`,
    `${hub.base}/page/definitely-not-a-token/`,
    `${hubShareBase}/share/definitely-not-a-token`,
    `${hubShareBase}/page/definitely-not-a-token/index.html`,
  ]) {
    const res = await fetch(url);
    assert.equal(res.status, 404, url);
    assert.equal((await res.text()).trim(), 'Not found');
  }
  assert.ok(Date.now() - started < 1000, 'unknown tokens must not wait on the fleet');
  assert.deepEqual(counterHits, [], 'no remote was asked about an unmapped token');
});

// --- comments on a fleet page --------------------------------------------

test('a comment on a fleet page files on the peer, where its agent reads it', async () => {
  const created = await fetch(`${hub.base}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: 'tighten this paragraph',
      target: { kind: 'page', pageToken, anchor: { type: 'text', quote: 'peer page body' } },
    }),
  });
  const comment = await json(created);
  assert.equal(created.status, 201, JSON.stringify(comment).slice(0, 200));
  assert.equal(comment.target.pageToken, pageToken);

  const peerComments = JSON.parse(fs.readFileSync(path.join(peer.home, '.pi', 'dish', 'comments.json'), 'utf8'));
  assert.ok(peerComments[comment.id], 'the comment landed in the owning host\'s store');
  assert.equal(peerComments[comment.id].body, 'tighten this paragraph');
  assert.equal(fs.existsSync(path.join(hub.home, '.pi', 'dish', 'comments.json')), false,
    'the hub keeps no copy of a peer\'s feedback');

  // The overlay's own read path routes the same way.
  const index = await json(await fetch(`${hub.base}/api/comments/index?pageToken=${pageToken}`));
  assert.deepEqual(index.comments.map((c) => c.id), [comment.id]);

  const full = await json(await fetch(`${hub.base}/api/comments/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: index.comments[0].sessionId, ids: [comment.id], pageToken }),
  }));
  assert.equal(full.comments[0].body, 'tighten this paragraph');

  // …and so do the edit routes, which the overlay now tags with its token.
  const patched = await json(await fetch(`${hub.base}/api/comments/${comment.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: comment.sessionId, body: 'tighten this paragraph, please', pageToken }),
  }));
  assert.equal(patched.body, 'tighten this paragraph, please');
  const afterPatch = JSON.parse(fs.readFileSync(path.join(peer.home, '.pi', 'dish', 'comments.json'), 'utf8'));
  assert.equal(afterPatch[comment.id].body, 'tighten this paragraph, please');

  // A request naming no page keeps the hub's own (empty) local behavior.
  const local = await fetch(`${hub.base}/api/comments/count?sessionId=${PEER_SESSION_ID}`);
  assert.equal(local.status, 200);
  assert.equal((await json(local)).total, 0);
});

// --- revocation ----------------------------------------------------------

test('revoking on the owner 404s the hub and prunes the mapping', async () => {
  const revoked = await json(await fetch(`${peer.base}/api/pages/${pageToken}`, authed(PEER_TOKEN, { method: 'DELETE' })));
  assert.equal(revoked.revoked, true);

  const res = await fetch(`${hub.base}/page/${pageToken}/`);
  assert.equal(res.status, 404);
  assert.equal((await res.text()).trim(), 'Not found');

  const { artifacts } = await json(await fetch(`${hub.base}/api/fleet-artifacts`));
  assert.equal(artifacts.some((a) => a.token === pageToken), false, 'the dead mapping was pruned lazily');
});

test('a revoke proxied through the hub prunes the mapping directly', async () => {
  // A second page, mapped and then revoked through the hub's own proxy.
  const page = await json(await fetch(`${hub.base}/hosts/peer/api/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: secondPageDir, title: 'Peer report', sessionId: PEER_SESSION_ID }),
  }));
  assert.equal(page.url, null, 'the proxied creation is re-addressed like the share');
  assert.ok((await (await fetch(`${hub.base}/page/${page.token}/`)).text()).includes('second peer page'));

  const revoked = await json(await fetch(`${hub.base}/hosts/peer/api/pages/${page.token}`, { method: 'DELETE' }));
  assert.equal(revoked.revoked, true);
  const { artifacts } = await json(await fetch(`${hub.base}/api/fleet-artifacts`));
  assert.equal(artifacts.some((a) => a.token === page.token), false);

  // The share revoke reports its token for the same reason.
  const shareRevoke = await json(await fetch(`${hub.base}/hosts/peer/api/sessions/${PEER_SESSION_ID}/share`, { method: 'DELETE' }));
  assert.equal(shareRevoke.revoked, true);
  assert.equal(shareRevoke.token, shareToken);
  const after = await json(await fetch(`${hub.base}/api/fleet-artifacts`));
  assert.equal(after.artifacts.some((a) => a.token === shareToken), false);
  assert.equal((await fetch(`${hub.base}/share/${shareToken}`)).status, 404);
});

test('the hub can unmap an artifact without touching the owner\'s copy', async () => {
  const page = await json(await fetch(`${hub.base}/hosts/peer/api/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: pageDir, title: 'Peer plan again', sessionId: PEER_SESSION_ID }),
  }));
  assert.equal((await fetch(`${hub.base}/page/${page.token}/`)).status, 200);

  const removed = await json(await fetch(`${hub.base}/api/fleet-artifacts/${page.token}`, { method: 'DELETE' }));
  assert.equal(removed.revoked, true);
  assert.equal((await fetch(`${hub.base}/page/${page.token}/`)).status, 404, 'public reachability ended');

  // The page itself is untouched on the host that owns it.
  const onOwner = await fetch(`${peer.base}/page/${page.token}/`);
  assert.equal(onOwner.status, 200);
  assert.ok((await onOwner.text()).includes('peer page body'));
});

// --- the pages skill's --via flow ----------------------------------------
//
// An agent publishes on its own host and asks a hub to front it, talking
// only to loopback: the mapping call rides its own server's /hosts proxy.

test('the pages skill publishes locally and maps onto a hub with --via', async () => {
  const home = makeHome();
  const dir = writePageDir(home, 'skillplan', 'skill page body');
  // The publishing host needs the hub in its fleet map (to reach it) and the
  // hub needs this host in its own — fleet-map membership is the
  // authorization, and settings are re-read per call, so no restart.
  writeSettings(home, { hostLabel: 'agenthost', remotes: [{ name: 'hub', url: hub.base }] });
  const agentHost = await boot(home);
  const hubSettings = JSON.parse(fs.readFileSync(path.join(hub.home, '.pi', 'dish', 'settings.json'), 'utf8'));
  hubSettings.remotes.push({ name: 'agenthost', url: agentHost.base });
  writeSettings(hub.home, hubSettings);

  const run = (args, env = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, HOME: home, PI_DISH_URL: agentHost.base, PI_DISH_PUBLIC_VIA: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  const viaFlag = await run(['publish', dir, '--title', 'Skill plan', '--via', 'hub', '--json']);
  assert.equal(viaFlag.code, 0, viaFlag.stderr);
  const published = JSON.parse(viaFlag.stdout);
  assert.equal(published.hubError, null);
  assert.equal(published.hub.via, 'hub');
  assert.equal(published.hub.owner, 'agenthost', 'the hub mapped it under the name it knows this host by');
  assert.equal(published.hub.path, `/page/${published.token}`);

  const served = await fetch(`${hub.base}${published.hub.path}/`);
  assert.equal(served.status, 200);
  assert.ok((await served.text()).includes('skill page body'), 'the hub serves the agent host\'s page');

  // The env default is the same flow without the flag, and re-publishing the
  // same path keeps the token.
  const viaEnv = await run(['publish', dir, '--json'], { PI_DISH_PUBLIC_VIA: 'hub' });
  assert.equal(viaEnv.code, 0, viaEnv.stderr);
  const again = JSON.parse(viaEnv.stdout);
  assert.equal(again.token, published.token);
  assert.equal(again.hubError, null);

  // A hub that isn't reachable (or is too old for the route) costs public
  // reachability, never the local publish.
  const missingHub = await run(['publish', dir, '--via', 'nosuchhub']);
  assert.equal(missingHub.code, 1);
  assert.ok(missingHub.stdout.includes(`/page/${published.token}`), 'the local link still prints');
  assert.match(missingHub.stderr, /nosuchhub/);
});
