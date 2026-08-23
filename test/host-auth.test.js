/**
 * Host descriptor, opt-in bearer auth, stream tickets and CORS.
 *
 * Unlike test/server.test.js these need several servers with *different*
 * startup configuration (token vs no token, and the same HOME booted twice),
 * and the token is resolved once at startup — so each case boots server.js as
 * a child process against its own temp HOME instead of requiring the module.
 *
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');
const PKG_VERSION = require('../package.json').version;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const children = [];
test.after(() => {
  for (const child of children) { try { child.kill('SIGKILL'); } catch {} }
});

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-host-'));
  fs.mkdirSync(path.join(home, '.pi', 'agent', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.pi', 'dish'), { recursive: true });
  return home;
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
  // The runner's own environment must not decide what the child advertises.
  delete env.PI_DISH_TOKEN;
  delete env.PI_DISH_TERMINAL;
  delete env.PI_DISH_SHARE_PORT;
  env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-host-tmux-'));
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
  return { base, child, home };
}

const authed = (token, init = {}) => ({
  ...init,
  headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
});

// --- host descriptor ------------------------------------------------------

test('GET /api/host describes the host and its capabilities', async () => {
  const { base } = await boot(makeHome());
  const res = await fetch(`${base}/api/host`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.match(body.hostId, UUID_RE);
  assert.equal(typeof body.label, 'string');
  assert.ok(body.label.length > 0);
  assert.equal(body.version, PKG_VERSION);
  for (const cap of ['sessions', 'search', 'usage', 'spawns', 'shares', 'pages', 'comments', 'skills', 'harnesses']) {
    assert.equal(body.capabilities[cap], true, `${cap} should be advertised`);
  }
  // Absent means unsupported — a capability is never advertised as false.
  assert.deepEqual(Object.values(body.capabilities).filter((v) => v !== true), []);
  // The terminal is opt-in and this child ran without the flag.
  assert.equal('terminal' in body.capabilities, false);
});

test('hostId is generated once and survives a restart', async () => {
  const home = makeHome();
  const first = await boot(home);
  const a = await (await fetch(`${first.base}/api/host`)).json();
  first.child.kill('SIGKILL');

  const idFile = path.join(home, '.pi', 'dish', 'host-id');
  assert.equal(fs.readFileSync(idFile, 'utf8').trim(), a.hostId);

  const second = await boot(home);
  const b = await (await fetch(`${second.base}/api/host`)).json();
  assert.equal(b.hostId, a.hostId);
});

test('hostLabel in settings.json overrides the machine hostname', async () => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'), JSON.stringify({ hostLabel: 'tycho' }));
  const { base } = await boot(home);
  const body = await (await fetch(`${base}/api/host`)).json();
  assert.equal(body.label, 'tycho');
});

// --- no token configured: nothing changes --------------------------------

test('without a token the API is open and emits no CORS headers', async () => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'),
    JSON.stringify({ allowedOrigins: ['https://dash.example'] }));
  const { base } = await boot(home);

  const res = await fetch(`${base}/api/sessions`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).previous));

  // An allowlist without a token must stay inert: CORS on an unauthenticated
  // API would hand the browser's network reach to any page it visits.
  const cors = await fetch(`${base}/api/sessions`, { headers: { Origin: 'https://dash.example' } });
  assert.equal(cors.headers.get('access-control-allow-origin'), null);
  assert.equal(cors.headers.get('access-control-allow-methods'), null);

  // Tickets are pointless without a token, and the client is told so.
  const ticket = await fetch(`${base}/api/auth/ticket`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'stream' }),
  });
  assert.equal(ticket.status, 200);
  assert.deepEqual(await ticket.json(), { ticket: null });
});

// --- token configured -----------------------------------------------------

const TOKEN = 'test-token-abcdefghijklmnop';

test('a configured token gates /api and leaves public surfaces open', async () => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'token'), `${TOKEN}\n`);
  const { base } = await boot(home);

  assert.equal((await fetch(`${base}/api/sessions`)).status, 401);
  assert.equal((await fetch(`${base}/api/sessions`, authed('wrong-token'))).status, 401);
  // Same prefix, different length: the digest compare must not accept it.
  assert.equal((await fetch(`${base}/api/sessions`, authed(TOKEN.slice(0, -1)))).status, 401);
  assert.equal((await fetch(`${base}/api/sessions`, authed(`${TOKEN}x`))).status, 401);

  const unauthorized = await fetch(`${base}/api/sessions`);
  assert.equal(typeof (await unauthorized.json()).error, 'string');

  const ok = await fetch(`${base}/api/sessions`, authed(TOKEN));
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray((await ok.json()).previous));

  // Identity, the static bundle and the public share routes stay reachable —
  // a client must be able to identify a host it is not paired with yet.
  assert.equal((await fetch(`${base}/api/host`)).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/share/definitely-not-a-token`)).status, 404);
  assert.equal((await fetch(`${base}/page/definitely-not-a-token`)).status, 404);
});

test('PI_DISH_TOKEN takes precedence over the token file', async () => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'token'), 'file-token\n');
  const { base } = await boot(home, { PI_DISH_TOKEN: 'env-token' });
  assert.equal((await fetch(`${base}/api/sessions`, authed('file-token'))).status, 401);
  assert.equal((await fetch(`${base}/api/sessions`, authed('env-token'))).status, 200);
});

test('stream tickets are minted for authed callers only and unlock the SSE route', async () => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'token'), TOKEN);
  const { base } = await boot(home);

  const mint = (init = {}) => fetch(`${base}/api/auth/ticket`, {
    ...init, method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  assert.equal((await mint({ body: JSON.stringify({ purpose: 'stream' }) })).status, 401);

  const minted = await mint(authed(TOKEN, { body: JSON.stringify({ purpose: 'stream' }) }));
  assert.equal(minted.status, 200);
  const { ticket, expiresAt } = await minted.json();
  assert.match(ticket, /^[A-Za-z0-9_-]{20,}$/);
  assert.ok(expiresAt > Date.now() && expiresAt <= Date.now() + 60_000);

  const streamUrl = `${base}/api/sessions/nope/stream`;
  assert.equal((await fetch(streamUrl)).status, 401);
  assert.equal((await fetch(`${streamUrl}?ticket=not-a-real-ticket`)).status, 401);

  const ok = await fetch(`${streamUrl}?ticket=${ticket}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/event-stream/);
  assert.match(await ok.text(), /stream_error/);

  // Multi-use within the TTL: EventSource reconnects on its own, and a
  // single-use ticket would make every reconnect a hard failure.
  assert.equal((await fetch(`${streamUrl}?ticket=${ticket}`)).status, 200);

  // Purpose is enforced — a terminal ticket does not open the SSE route.
  const terminalTicket = (await (await mint(authed(TOKEN, { body: JSON.stringify({ purpose: 'terminal' }) }))).json()).ticket;
  assert.equal((await fetch(`${streamUrl}?ticket=${terminalTicket}`)).status, 401);

  assert.equal((await mint(authed(TOKEN, { body: JSON.stringify({ purpose: 'nonsense' }) }))).status, 400);
});

test('the terminal WebSocket upgrade is gated by ticket and origin', async (t) => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'token'), TOKEN);
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'),
    JSON.stringify({ allowedOrigins: ['https://dash.example'] }));
  const { base } = await boot(home, { PI_DISH_TERMINAL: '1' });
  const capabilities = (await (await fetch(`${base}/api/host`)).json()).capabilities;
  if (!capabilities.terminal) return t.skip('node-pty unavailable');

  // Resolves to the HTTP status of the refusal, or 101 when the upgrade is
  // accepted (an unknown session then 404s inside the handler, which is
  // itself proof the gate ran first).
  const upgrade = (query, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(`${base}/api/sessions/nope/terminal${query}`);
    const req = require('node:http').request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
        ...headers,
      },
    });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(101); });
    req.on('error', reject);
    req.end();
  });

  assert.equal(await upgrade(''), 401);
  assert.equal(await upgrade('?ticket=not-a-real-ticket'), 401);

  const stream = await (await fetch(`${base}/api/auth/ticket`, authed(TOKEN, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'stream' }),
  }))).json();
  assert.equal(await upgrade(`?ticket=${stream.ticket}`), 401, 'a stream ticket must not open a terminal');

  const mintTerminal = async () => (await (await fetch(`${base}/api/auth/ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'terminal' }),
  })).json()).ticket;

  // Past the gate: the unknown session is refused by the handler, not the auth check.
  assert.equal(await upgrade(`?ticket=${await mintTerminal()}`), 404);
  assert.equal(await upgrade(`?ticket=${await mintTerminal()}`, { Origin: 'https://dash.example' }), 404);
  // A browser opens cross-origin WebSockets without a CORS veto, so the
  // allowlist has to be enforced on the upgrade itself.
  assert.equal(await upgrade(`?ticket=${await mintTerminal()}`, { Origin: 'https://evil.example' }), 401);
});

test('CORS echoes allowlisted origins only, and only alongside the token', async () => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'token'), TOKEN);
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'),
    JSON.stringify({ allowedOrigins: ['https://dash.example'] }));
  const { base } = await boot(home);

  const allowed = await fetch(`${base}/api/sessions`, authed(TOKEN, { headers: { Origin: 'https://dash.example' } }));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://dash.example');
  assert.match(allowed.headers.get('vary') || '', /Origin/);
  assert.match(allowed.headers.get('access-control-allow-headers') || '', /Authorization/);

  const preflight = await fetch(`${base}/api/sessions`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://dash.example', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://dash.example');
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /POST/);

  const other = await fetch(`${base}/api/sessions`, authed(TOKEN, { headers: { Origin: 'https://evil.example' } }));
  assert.equal(other.status, 200);
  assert.equal(other.headers.get('access-control-allow-origin'), null);

  // A preflight from a non-allowlisted origin gets no CORS answer at all.
  const rejected = await fetch(`${base}/api/sessions`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
});

test('settings responses never carry the token or the origin allowlist', async () => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'token'), TOKEN);
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'),
    JSON.stringify({ allowedOrigins: ['https://dash.example'], hostLabel: 'tycho', monthlyBudgetUsd: 10 }));
  const { base } = await boot(home);

  const settings = await (await fetch(`${base}/api/settings`, authed(TOKEN))).json();
  assert.deepEqual(Object.keys(settings).sort(), ['monthlyBudgetUsd', 'savedFilters']);

  // A settings write must not drop the file-level fleet/auth config.
  const put = await fetch(`${base}/api/settings`, authed(TOKEN, {
    method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthlyBudgetUsd: 25 }),
  }));
  assert.equal(put.status, 200);
  const onDisk = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'settings.json'), 'utf8'));
  assert.deepEqual(onDisk.allowedOrigins, ['https://dash.example']);
  assert.equal(onDisk.hostLabel, 'tycho');
  assert.equal(onDisk.monthlyBudgetUsd, 25);
});
