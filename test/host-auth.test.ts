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
import test = require('node:test');
import type { TestContext } from 'node:test';
import assert = require('node:assert');
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type OutgoingHttpHeaders } from 'node:http';
import fs = require('node:fs');
import net = require('node:net');
import os = require('node:os');
import path = require('node:path');
import type { AddressInfo } from 'node:net';
import { sanitizeTestEnv } from './test-env.js';

const SERVER = path.join(__dirname, '..', 'server.js');
const pkg: unknown = require('../package.json');
assertRecord(pkg);
assert.ok(typeof pkg.version === 'string');
const PKG_VERSION = pkg.version;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
}

const children = new Map<ChildProcess, Promise<void>>();
const ownedRoots = new Set<string>();
test.after(async () => {
  for (const child of children.keys()) {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  }
  await Promise.all(children.values());
  for (const root of ownedRoots) fs.rmSync(root, { recursive: true, force: true });
});

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-host-'));
  ownedRoots.add(home);
  fs.mkdirSync(path.join(home, '.pi', 'agent', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.pi', 'dish'), { recursive: true });
  return home;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Expected a loopback TCP address')));
        return;
      }
      const { port }: AddressInfo = address;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function boot(home: string, extraEnv: NodeJS.ProcessEnv = {}) {
  assert.ok(ownedRoots.has(home));
  const tmuxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-host-tmux-'));
  ownedRoots.add(tmuxRoot);
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...sanitizeTestEnv(process.env), HOME: home, PORT: String(port), TMUX_TMPDIR: tmuxRoot };
  // The runner's own environment must not decide what the child advertises.
  delete env.PI_DISH_TOKEN;
  delete env.PI_DISH_TERMINAL;
  delete env.PI_DISH_SHARE_PORT;
  Object.assign(env, extraEnv);
  env.PI_OFFLINE = '1';

  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.set(child, new Promise<void>((resolve) => child.once('close', () => resolve())));
  let spawnError: Error | undefined;
  child.once('error', (error: Error) => { spawnError = error; });
  let stderr = '';
  child.stderr.on('data', (b: Buffer) => { stderr += b; });
  child.stdout.resume();

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`server exited (${child.exitCode ?? child.signalCode}): ${stderr}`);
    try {
      const res = await fetch(`${base}/api/host`);
      if (res.ok) { await res.json(); break; }
    } catch {}
    if (Date.now() > deadline) throw new Error(`server did not come up: ${stderr}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  // Host readiness precedes model warmup; drain it before any case can kill the child.
  const tokenFile = path.join(home, '.pi', 'dish', 'token');
  let token = extraEnv.PI_DISH_TOKEN?.trim() || '';
  if (!token && fs.existsSync(tokenFile)) token = fs.readFileSync(tokenFile, 'utf8').trim();
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`server model warmup exceeded startup deadline: ${stderr}`);
  const init: RequestInit = { signal: AbortSignal.timeout(remaining) };
  const models = await fetch(`${base}/api/models`, token ? authed(token, init) : init);
  await models.arrayBuffer();
  assert.ok(models.ok, `server model warmup failed (${models.status})`);
  return { base, child, home };
}

const authed = (token: string, init: RequestInit = {}): RequestInit => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
};

// --- host descriptor ------------------------------------------------------

test('GET /api/host describes the host and its capabilities', async () => {
  const { base } = await boot(makeHome());
  const res = await fetch(`${base}/api/host`);
  assert.equal(res.status, 200);
  const body: unknown = await res.json();
  assertRecord(body);

  assert.ok(typeof body.hostId === 'string');
  assert.match(body.hostId, UUID_RE);
  assert.ok(typeof body.label === 'string');
  assert.ok(body.label.length > 0);
  assert.equal(body.version, PKG_VERSION);
  assertRecord(body.capabilities);
  for (const cap of ['sessions', 'search', 'usage', 'spawns', 'shares', 'pages', 'comments', 'skills', 'harnesses']) {
    assert.equal(body.capabilities[cap], true, `${cap} should be advertised`);
  }
  // Absent means unsupported — a capability is never advertised as false.
  assert.deepEqual(Object.values(body.capabilities).filter((v) => v !== true), []);
  // The terminal is opt-in and this child ran without the flag.
  assert.equal('terminal' in body.capabilities, false);
  // Coarse host capacity for the fleet view and `load`.
  assert.equal(body.capabilities.hostHealth, true);
});

test('hostId is generated once and survives a restart', async () => {
  const home = makeHome();
  const first = await boot(home);
  const a: unknown = await (await fetch(`${first.base}/api/host`)).json();
  assertRecord(a);
  assert.ok(typeof a.hostId === 'string');
  first.child.kill('SIGKILL');

  const idFile = path.join(home, '.pi', 'dish', 'host-id');
  assert.equal(fs.readFileSync(idFile, 'utf8').trim(), a.hostId);

  const second = await boot(home);
  const b: unknown = await (await fetch(`${second.base}/api/host`)).json();
  assertRecord(b);
  assert.ok(typeof b.hostId === 'string');
  assert.equal(b.hostId, a.hostId);
});

test('hostLabel in settings.json overrides the machine hostname', async () => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'), JSON.stringify({ hostLabel: 'tycho' }));
  const { base } = await boot(home);
  const body: unknown = await (await fetch(`${base}/api/host`)).json();
  assertRecord(body);
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
  const body: unknown = await res.json();
  assertRecord(body);
  assert.ok(Array.isArray(body.previous));

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
  const ticketBody: unknown = await ticket.json();
  assert.deepEqual(ticketBody, { ticket: null });
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
  const unauthorizedBody: unknown = await unauthorized.json();
  assertRecord(unauthorizedBody);
  assert.equal(typeof unauthorizedBody.error, 'string');

  // Host capacity is fleet data, not identity: it stays behind the token.
  assert.equal((await fetch(`${base}/api/host/health`)).status, 401);
  const health = await fetch(`${base}/api/host/health`, authed(TOKEN));
  assert.equal(health.status, 200);
  const healthBody: unknown = await health.json();
  assertRecord(healthBody);
  assertRecord(healthBody.sessions);
  assert.equal(typeof healthBody.sessions.live, 'number');

  const ok = await fetch(`${base}/api/sessions`, authed(TOKEN));
  assert.equal(ok.status, 200);
  const okBody: unknown = await ok.json();
  assertRecord(okBody);
  assert.ok(Array.isArray(okBody.previous));

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

  const mint = (init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(`${base}/api/auth/ticket`, { ...init, method: 'POST', headers });
  };
  assert.equal((await mint({ body: JSON.stringify({ purpose: 'stream' }) })).status, 401);

  const minted = await mint(authed(TOKEN, { body: JSON.stringify({ purpose: 'stream' }) }));
  assert.equal(minted.status, 200);
  const mintedBody: unknown = await minted.json();
  assertRecord(mintedBody);
  const { ticket, expiresAt } = mintedBody;
  assert.ok(typeof ticket === 'string');
  assert.ok(typeof expiresAt === 'number');
  assert.match(ticket, /^[A-Za-z0-9_-]{20,}$/);
  assert.ok(expiresAt > Date.now() && expiresAt <= Date.now() + 60_000);

  const streamUrl = `${base}/api/sessions/nope/stream`;
  assert.equal((await fetch(streamUrl)).status, 401);
  assert.equal((await fetch(`${streamUrl}?ticket=not-a-real-ticket`)).status, 401);

  const ok = await fetch(`${streamUrl}?ticket=${ticket}`);
  assert.equal(ok.status, 200);
  const contentType = ok.headers.get('content-type');
  assert.ok(typeof contentType === 'string');
  assert.match(contentType, /text\/event-stream/);
  assert.match(await ok.text(), /stream_error/);

  // Multi-use within the TTL: EventSource reconnects on its own, and a
  // single-use ticket would make every reconnect a hard failure.
  assert.equal((await fetch(`${streamUrl}?ticket=${ticket}`)).status, 200);

  // Purpose is enforced — a terminal ticket does not open the SSE route.
  const terminalBody: unknown = await (await mint(authed(TOKEN, { body: JSON.stringify({ purpose: 'terminal' }) }))).json();
  assertRecord(terminalBody);
  const terminalTicket = terminalBody.ticket;
  assert.ok(typeof terminalTicket === 'string');
  assert.equal((await fetch(`${streamUrl}?ticket=${terminalTicket}`)).status, 401);

  assert.equal((await mint(authed(TOKEN, { body: JSON.stringify({ purpose: 'nonsense' }) }))).status, 400);
});

test('the terminal WebSocket upgrade is gated by ticket and origin', async (t: TestContext) => {
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'token'), TOKEN);
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'),
    JSON.stringify({ allowedOrigins: ['https://dash.example'] }));
  const { base } = await boot(home, { PI_DISH_TERMINAL: '1' });
  const hostBody: unknown = await (await fetch(`${base}/api/host`)).json();
  assertRecord(hostBody);
  const capabilities = hostBody.capabilities;
  assertRecord(capabilities);
  assert.ok(capabilities.terminal === undefined || typeof capabilities.terminal === 'boolean');
  if (!capabilities.terminal) return t.skip('node-pty unavailable');

  // Resolves to the HTTP status of the refusal, or 101 when the upgrade is
  // accepted (an unknown session then 404s inside the handler, which is
  // itself proof the gate ran first).
  const upgrade = (query: string, headers: OutgoingHttpHeaders = {}) => new Promise<number>((resolve, reject) => {
    const url = new URL(`${base}/api/sessions/nope/terminal${query}`);
    const req = request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
        ...headers,
      },
    });
    req.on('response', (res) => {
      res.resume();
      if (typeof res.statusCode !== 'number') reject(new Error('Expected an HTTP response status'));
      else resolve(res.statusCode);
    });
    req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(101); });
    req.on('error', reject);
    req.end();
  });

  assert.equal(await upgrade(''), 401);
  assert.equal(await upgrade('?ticket=not-a-real-ticket'), 401);

  const stream: unknown = await (await fetch(`${base}/api/auth/ticket`, authed(TOKEN, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'stream' }),
  }))).json();
  assertRecord(stream);
  assert.ok(typeof stream.ticket === 'string');
  assert.equal(await upgrade(`?ticket=${stream.ticket}`), 401, 'a stream ticket must not open a terminal');

  const mintTerminal = async (): Promise<string> => {
    const body: unknown = await (await fetch(`${base}/api/auth/ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: 'terminal' }),
    })).json();
    assertRecord(body);
    assert.ok(typeof body.ticket === 'string');
    return body.ticket;
  };

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

  const settings: unknown = await (await fetch(`${base}/api/settings`, authed(TOKEN))).json();
  assertRecord(settings);
  assert.equal(Object.hasOwn(settings, 'token'), false);
  assert.equal(Object.hasOwn(settings, 'allowedOrigins'), false);
  assert.equal(Object.hasOwn(settings, 'remotes'), false);

  // A settings write must not drop the file-level fleet/auth config.
  const put = await fetch(`${base}/api/settings`, authed(TOKEN, {
    method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthlyBudgetUsd: 25 }),
  }));
  assert.equal(put.status, 200);
  const onDisk: unknown = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'dish', 'settings.json'), 'utf8'));
  assertRecord(onDisk);
  assert.deepEqual(onDisk.allowedOrigins, ['https://dash.example']);
  assert.equal(onDisk.hostLabel, 'tycho');
  assert.equal(onDisk.monthlyBudgetUsd, 25);
});
