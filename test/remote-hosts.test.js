/**
 * Fleet config, reachability and the /hosts/<name> reverse proxy.
 *
 * Two real pi-dish servers: a **peer** (own temp HOME, fixture JSONL, its own
 * bearer token) and a **hub** whose settings.json names the peer. Like
 * test/host-auth.test.js these boot as child processes, because the token and
 * the listening port are resolved at startup.
 *
 * A third "echo" peer is a plain http server that reflects what it received —
 * that is how the header rules (caller's Authorization stripped, peer's
 * attached, body streamed unparsed) are asserted directly rather than by
 * outcome.
 *
 * ssh transports are unit-tested on lib/remote-hosts.js exports; CI has no
 * ssh peer to forward to.
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
const PKG_VERSION = require('../package.json').version;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PEER_TOKEN = 'peer-token-abcdefghijklmnop';
const HUB_TOKEN = 'hub-token-0123456789abcdef';
const ECHO_TOKEN = 'echo-token-zyxwvutsrqponm';
const PEER_SESSION_ID = '2026-08-22T09-00-00-peerfix1';

const children = [];
const closables = [];
test.after(() => {
  for (const child of children) { try { child.kill('SIGKILL'); } catch {} }
  for (const server of closables) { try { server.close(); } catch {} }
});

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-fleet-'));
  fs.mkdirSync(path.join(home, '.pi', 'agent', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.pi', 'dish'), { recursive: true });
  return home;
}

function writeFixtureSession(home) {
  const dir = path.join(home, '.pi', 'agent', 'sessions', '--home-user-peerproj--');
  fs.mkdirSync(dir, { recursive: true });
  const entries = [
    { type: 'session', cwd: '/home/user/peerproj', timestamp: '2026-08-22T09:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'peer fixture prompt' }], timestamp: '2026-08-22T09:00:01.000Z' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'peer fixture reply' }], timestamp: '2026-08-22T09:00:02.000Z' } },
  ];
  fs.writeFileSync(path.join(dir, `${PEER_SESSION_ID}.jsonl`), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
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
  // The runner's own environment must not decide what the child advertises.
  delete env.PI_DISH_TOKEN;
  delete env.PI_DISH_TERMINAL;
  delete env.PI_DISH_SHARE_PORT;
  env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-fleet-tmux-'));
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

// --- lib/remote-hosts.js unit tests --------------------------------------

const remoteHosts = require('../lib/remote-hosts');

function withHome(settings, fn) {
  const home = makeHome();
  writeSettings(home, settings);
  const previous = process.env.HOME;
  process.env.HOME = home;
  try { return fn(home); } finally { process.env.HOME = previous; }
}

test('remotes are validated on load and bad entries are skipped, never thrown', () => {
  withHome({
    remotes: [
      { name: 'peer', url: 'http://10.0.0.4:3333', token: 'tok' },
      { name: 'work', sshDest: 'work-jump' },
      { name: 'work2', sshDest: 'user@box', remotePort: 4444 },
      // Every one of these becomes a path segment or a request target, so
      // each is rejected rather than sanitized.
      { name: 'Peer', url: 'http://10.0.0.5:3333' },              // uppercase
      { name: '-lead', url: 'http://10.0.0.5:3333' },             // leading dash
      { name: 'has/slash', url: 'http://10.0.0.5:3333' },
      { name: 'x'.repeat(33), url: 'http://10.0.0.5:3333' },
      { name: 'ftp', url: 'ftp://10.0.0.5' },
      { name: 'garbage', url: 'not a url' },
      { name: 'empty', url: '' },
      { name: 'neither' },
      { name: 'badport', sshDest: 'box', remotePort: 0 },
      { name: 'strport', sshDest: 'box', remotePort: 'nope' },
      'not-an-object',
      null,
      // A later duplicate never displaces the first entry.
      { name: 'peer', url: 'http://evil.example' },
    ],
  }, () => {
    const remotes = remoteHosts.listRemotes();
    assert.deepEqual(remotes.map((r) => r.name), ['peer', 'work', 'work2']);
    assert.deepEqual(remotes[0], { name: 'peer', kind: 'direct', origin: 'http://10.0.0.4:3333', token: 'tok' });
    assert.equal(remotes[1].kind, 'ssh');
    assert.equal(remotes[1].remotePort, 3333, 'remotePort defaults to 3333');
    assert.equal(remotes[2].remotePort, 4444);
    assert.equal(remoteHosts.getRemote('peer').origin, 'http://10.0.0.4:3333');
    assert.equal(remoteHosts.getRemote('nope'), null);
    assert.equal(remoteHosts.getRemote('../../etc'), null);
  });

  // A settings file that isn't there, or isn't JSON, is simply no fleet.
  withHome({}, () => assert.deepEqual(remoteHosts.listRemotes(), []));
  const home = makeHome();
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'), '{ broken');
  const previous = process.env.HOME;
  process.env.HOME = home;
  try { assert.deepEqual(remoteHosts.listRemotes(), []); } finally { process.env.HOME = previous; }
});

test('ssh forwards land on a per-remote socket under the dish run dir', () => {
  withHome({ remotes: [{ name: 'work', sshDest: 'user@box', remotePort: 4321 }] }, (home) => {
    const socketPath = remoteHosts.socketPathFor('work');
    assert.equal(socketPath, path.join(home, '.pi', 'dish', 'run', 'work.sock'));
    assert.equal(remoteHosts.runDir(), path.join(home, '.pi', 'dish', 'run'));

    // argv array, never a shell string (lib/tmux.js rules).
    assert.deepEqual(remoteHosts.sshArgv(remoteHosts.getRemote('work')), [
      '-N',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-L', `${socketPath}:127.0.0.1:4321`,
      'user@box',
    ]);
  });

  // A peer bound to a tailnet/LAN IP instead of loopback: the forward's far
  // end must match the peer's actual bind address.
  withHome({ remotes: [{ name: 'bee', sshDest: 'bee', remoteHost: '100.70.163.97' }] }, () => {
    const argv = remoteHosts.sshArgv(remoteHosts.getRemote('bee'));
    assert.equal(argv[argv.length - 2], `${remoteHosts.socketPathFor('bee')}:100.70.163.97:3333`);
  });
  withHome({ remotes: [{ name: 'bad', sshDest: 'bee', remoteHost: 'evil host' }] }, () => {
    assert.equal(remoteHosts.getRemote('bad'), null);
  });
});

test('ssh diagnostics are classified, never echoed', () => {
  const cases = [
    ['user@box: Permission denied (publickey).', 'ssh_auth_failed'],
    ['ssh: Could not resolve hostname box: Name or service not known', 'ssh_dns_failed'],
    ['ssh: connect to host box port 22: Connection refused', 'ssh_connection_refused'],
    ['ssh: connect to host box port 22: Connection timed out', 'ssh_timeout'],
    ['unix_listener: cannot bind to path: /run/work.sock', 'ssh_forward_failed'],
    ['Host key verification failed.', 'ssh_host_key_failed'],
    ['something nobody has seen before', 'ssh_failed'],
  ];
  for (const [stderr, code] of cases) {
    const classified = remoteHosts.classifySshStderr(stderr);
    assert.equal(classified, code);
    // ssh stderr carries host names, key paths and auth detail: the class is
    // all that may ever escape this module.
    assert.equal(classified.includes(stderr), false);
  }
});

test('probing an unconfigured name reports unknown_host without a request', async () => {
  await withHome({}, async () => {
    const result = await remoteHosts.probe('nobody');
    assert.equal(result.reachable, false);
    assert.equal(result.error, 'unknown_host');
  });
});

// --- reachability breaker -------------------------------------------------
//
// A sleeping tailscale peer black-holes the TCP connect instead of refusing
// it, so every proxied request would otherwise burn the whole first-byte
// timer. The cached probe result is what lets the proxy answer instantly, and
// the proxy's own failed dials feed the same cache.

async function withHomeAsync(settings, fn) {
  const home = makeHome();
  writeSettings(home, settings);
  const previous = process.env.HOME;
  process.env.HOME = home;
  try { return await fn(home); } finally { process.env.HOME = previous; }
}

/** Runs fn with Date.now() advanceable, so ladder slots need no real waiting. */
async function withFakeClock(fn) {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try { return await fn((ms) => { offset += ms; }); } finally { Date.now = realNow; }
}

/** The slot the breaker is currently holding, i.e. which ladder rung it is on. */
function heldSlot(name) {
  const state = remoteHosts.reachability(name);
  return state ? state.until - state.at : null;
}

test('reachability() is a pure cache read that expires on the ladder', async () => {
  await withHomeAsync({ remotes: [{ name: 'peer', url: 'http://127.0.0.1:1/' }] }, async () => {
    await withFakeClock(async (advance) => {
      // Nothing has been probed or dialed yet: no opinion, and asking for one
      // must not dial.
      assert.equal(remoteHosts.reachability('peer'), null);
      assert.equal(remoteHosts.reachability('nobody'), null);

      remoteHosts.noteTransportFailure('peer', 'timeout');
      const down = remoteHosts.reachability('peer');
      assert.equal(down.reachable, false);
      assert.equal(down.error, 'timeout');
      assert.equal(down.until - down.at, remoteHosts.BACKOFF_LADDER[0]);

      advance(remoteHosts.BACKOFF_LADDER[0] - 1);
      assert.equal(remoteHosts.reachability('peer').reachable, false);
      // Past the slot the breaker simply stops answering: the next request
      // dials for real, which is the whole recovery mechanism.
      advance(2);
      assert.equal(remoteHosts.reachability('peer'), null);

      remoteHosts.noteTransportFailure('peer', 'connection_refused');
      assert.equal(heldSlot('peer'), remoteHosts.BACKOFF_LADDER[1], 'a second failure climbs a rung');
    });
  });
});

test('a flapping peer climbs the ladder; only sustained health resets it', async () => {
  const up = http.createServer((req, res) => {
    if (req.url !== '/api/host') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ hostId: '11111111-2222-3333-4444-555555555555', label: 'flapper', version: PKG_VERSION, capabilities: {} }));
  });
  closables.push(up);
  await new Promise((resolve) => up.listen(0, '127.0.0.1', resolve));
  const port = up.address().port;

  await withHomeAsync({ remotes: [{ name: 'flapper', url: `http://127.0.0.1:${port}` }] }, async () => {
    await withFakeClock(async (advance) => {
      remoteHosts.noteTransportFailure('flapper', 'timeout');
      remoteHosts.noteTransportFailure('flapper', 'timeout');
      assert.equal(heldSlot('flapper'), remoteHosts.BACKOFF_LADDER[1]);

      assert.equal((await remoteHosts.probe('flapper', { force: true })).reachable, true);
      advance(1000);
      assert.equal((await remoteHosts.probe('flapper', { force: true })).reachable, true);
      // Up for one second, then down again: the ladder must remember.
      remoteHosts.noteTransportFailure('flapper', 'timeout');
      assert.equal(heldSlot('flapper'), remoteHosts.BACKOFF_LADDER[2], 'a brief recovery must not forgive the failures');

      assert.equal((await remoteHosts.probe('flapper', { force: true })).reachable, true);
      advance(remoteHosts.STABLE_RESET_MS + 1000);
      assert.equal((await remoteHosts.probe('flapper', { force: true })).reachable, true);
      remoteHosts.noteTransportFailure('flapper', 'timeout');
      assert.equal(heldSlot('flapper'), remoteHosts.BACKOFF_LADDER[0], 'sustained health starts the ladder over');
    });
  });
});

// --- fleet over real servers ---------------------------------------------

let hub;        // no token: the everyday loopback/tailnet posture
let peer;
let echo;       // in-process reflector, registered as a second remote
let echoPort;
let downPort;   // nothing listens here

test('boot a peer, an echo peer and a hub that knows about them', async () => {
  const peerHome = makeHome();
  writeFixtureSession(peerHome);
  fs.writeFileSync(path.join(peerHome, '.pi', 'dish', 'token'), `${PEER_TOKEN}\n`);
  writeSettings(peerHome, { hostLabel: 'tycho' });
  peer = await boot(peerHome, { PI_DISH_TERMINAL: '1' });

  const echoServer = http.createServer((req, res) => {
    if (req.url === '/api/host') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        hostId: '11111111-1111-4111-8111-111111111111',
        label: 'echo', version: '9.9.9', capabilities: { sessions: true, terminal: true },
      }));
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body }));
    });
  });
  closables.push(echoServer);
  await new Promise((resolve) => echoServer.listen(0, '127.0.0.1', resolve));
  echo = echoServer;
  echoPort = echoServer.address().port;

  downPort = await freePort();

  const hubHome = makeHome();
  writeSettings(hubHome, {
    hostLabel: 'hub',
    remotes: [
      { name: 'peer', url: `http://127.0.0.1:${peer.port}`, token: PEER_TOKEN },
      { name: 'echo', url: `http://127.0.0.1:${echoPort}`, token: ECHO_TOKEN },
      { name: 'down', url: `http://127.0.0.1:${downPort}` },
    ],
  });
  hub = await boot(hubHome);
});

test('GET /api/hosts lists self first, then every configured remote', async () => {
  const started = Date.now();
  const { hosts } = await (await fetch(`${hub.base}/api/hosts`)).json();
  assert.ok(Date.now() - started < 3500, 'the fleet list must not wait on a dead peer');

  const self = hosts[0];
  assert.equal(self.self, true);
  assert.equal(self.name, null);
  assert.equal(self.base, '');
  assert.equal(self.reachable, true);
  assert.match(self.hostId, UUID_RE);
  assert.equal(self.label, 'hub');
  assert.equal(self.version, PKG_VERSION);
  assert.equal(self.capabilities.sessions, true);

  assert.deepEqual(hosts.slice(1).map((h) => h.name), ['peer', 'echo', 'down']);

  const peerDescriptor = await (await fetch(`${peer.base}/api/host`)).json();
  const entry = hosts.find((h) => h.name === 'peer');
  assert.equal(entry.base, '/hosts/peer');
  assert.equal(entry.kind, 'direct');
  assert.equal(entry.reachable, true);
  assert.equal(entry.hostId, peerDescriptor.hostId);
  assert.notEqual(entry.hostId, self.hostId);
  assert.equal(entry.label, 'tycho');
  assert.equal(entry.version, PKG_VERSION);
  assert.deepEqual(entry.capabilities, peerDescriptor.capabilities);
  assert.equal(entry.error, undefined);

  // An unreachable peer is reported, with a classified reason and no raw
  // socket/ssh text.
  const down = hosts.find((h) => h.name === 'down');
  assert.equal(down.reachable, false);
  assert.equal(down.hostId, undefined);
  assert.match(down.error, /^[a-z_]+$/);
  assert.equal(down.error, 'connection_refused');
});

test('the proxy reaches the peer with the peer\'s own credential', async () => {
  // The peer is closed to anyone who does not hold its token…
  const direct = await fetch(`${peer.base}/api/sessions`);
  assert.equal(direct.status, 401);

  // …and the hub, holding it, re-serves the peer's sessions under /hosts.
  const proxied = await fetch(`${hub.base}/hosts/peer/api/sessions`);
  assert.equal(proxied.status, 200);
  const body = await proxied.json();
  assert.ok(body.previous.some((s) => s.id === PEER_SESSION_ID), 'the peer\'s fixture session should be listed');

  // The peer's own session list is what came back, not the hub's (empty) one.
  const local = await (await fetch(`${hub.base}/api/sessions`)).json();
  assert.equal(local.previous.some((s) => s.id === PEER_SESSION_ID), false);

  // Sub-paths and query strings survive the hop.
  const messages = await fetch(`${hub.base}/hosts/peer/api/sessions/${PEER_SESSION_ID}/messages?limit=1`);
  assert.equal(messages.status, 200);
  const page = await messages.json();
  assert.equal(page.messages.length, 1);
});

test('proxied requests carry the peer token and nothing of the caller\'s', async () => {
  const res = await fetch(`${hub.base}/hosts/echo/api/sessions/abc/prompt?x=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // A caller's credential and browser origin must not reach a peer.
      Authorization: 'Bearer caller-secret',
      Origin: 'https://dash.example',
      'X-Custom': 'kept',
    },
    body: JSON.stringify({ message: 'hello from the hub' }),
  });
  assert.equal(res.status, 200);
  const seen = await res.json();

  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/api/sessions/abc/prompt?x=1');
  assert.equal(seen.headers.authorization, `Bearer ${ECHO_TOKEN}`);
  assert.equal(seen.headers.origin, undefined);
  assert.equal(seen.headers.host, `127.0.0.1:${echoPort}`);
  assert.equal(seen.headers['x-custom'], 'kept');
  assert.equal(seen.headers['content-type'], 'application/json');
  // The body reached the peer as bytes: nothing parsed or re-serialized it.
  assert.deepEqual(JSON.parse(seen.body), { message: 'hello from the hub' });
});

test('unknown and malformed host names are bare 404s; peer statuses pass through', async () => {
  for (const name of ['nobody', 'PEER', '-peer', 'peer.evil', 'x'.repeat(40)]) {
    const res = await fetch(`${hub.base}/hosts/${name}/api/sessions`);
    assert.equal(res.status, 404, name);
    assert.equal((await res.text()).includes('Cannot GET'), false, 'the fleet map is not a discovery surface');
  }
  // Encoded traversal never resolves to a configured name either.
  assert.equal((await fetch(`${hub.base}/hosts/..%2Fpeer/api/sessions`)).status, 404);

  // A route the peer doesn't have answers with the *peer's* 404, not the hub's.
  const missing = await fetch(`${hub.base}/hosts/peer/api/definitely-not-a-route`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Cannot GET/);

  // A validation error keeps the peer's status and body.
  const bad = await fetch(`${hub.base}/hosts/peer/api/usage-summary?days=nonsense`);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /days must be/);
});

test('a proxied event stream arrives identity-encoded and unbuffered', async () => {
  const res = await fetch(`${hub.base}/hosts/peer/api/sessions/nope/stream`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  // The peer excluded it from compression; the hub must not add any of its
  // own (the /hosts/* compression exclusion), or SSE buffers.
  assert.equal(res.headers.get('content-encoding'), null);
  assert.match(await res.text(), /stream_error/);
});

test('an unreachable peer fails fast instead of hanging', async () => {
  const started = Date.now();
  const res = await fetch(`${hub.base}/hosts/down/api/sessions`);
  assert.equal(res.status, 502);
  assert.ok(Date.now() - started < 5000, 'a refused connection must not wait on a timeout');
  const body = await res.json();
  assert.match(body.error, /down/);
  assert.equal(body.reason, 'connection_refused');
});

test('a proxied terminal upgrade is spliced through to the peer', async (t) => {
  const capabilities = (await (await fetch(`${peer.base}/api/host`)).json()).capabilities;
  if (!capabilities.terminal) return t.skip('node-pty unavailable on the peer');
  // The hub itself has no terminal: a proxied PTY lives on the peer.
  const hubCapabilities = (await (await fetch(`${hub.base}/api/host`)).json()).capabilities;
  assert.equal('terminal' in hubCapabilities, false);

  const upgrade = (urlString, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = http.request({
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

  // The peer answers 404 for a session it doesn't know — which is proof the
  // handshake reached the peer's own terminal handler through the splice.
  assert.equal(await upgrade(`${hub.base}/hosts/peer/api/sessions/nope/terminal`), 404);
  // A known session upgrades all the way to 101.
  assert.equal(await upgrade(`${hub.base}/hosts/peer/api/sessions/${PEER_SESSION_ID}/terminal`), 101);
  // Unknown host names never open a socket.
  assert.equal(await upgrade(`${hub.base}/hosts/nobody/api/sessions/nope/terminal`), 404);
});

// --- ssh transport --------------------------------------------------------

/** A PATH whose `ssh` is test/fixtures/fake-ssh.js. */
function fakeSshPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-fleet-bin-'));
  const script = `#!/bin/sh\nexec ${process.execPath} ${path.join(__dirname, 'fixtures', 'fake-ssh.js')} "$@"\n`;
  fs.writeFileSync(path.join(dir, 'ssh'), script, { mode: 0o755 });
  return `${dir}:${process.env.PATH}`;
}

test('the ssh transport forwards through a socket in the dish run dir', async () => {
  const home = makeHome();
  writeSettings(home, {
    // remotePort is the peer's port on the far side of the (fake) hop.
    remotes: [{ name: 'work', sshDest: 'user@box', remotePort: peer.port, token: PEER_TOKEN }],
  });
  const sshHub = await boot(home, { PATH: fakeSshPath() });
  const socketPath = path.join(home, '.pi', 'dish', 'run', 'work.sock');

  // Forwards are lazy: nothing is spawned until the first request needs one.
  assert.equal(fs.existsSync(socketPath), false);

  const hosts = (await (await fetch(`${sshHub.base}/api/hosts`)).json()).hosts;
  const work = hosts.find((h) => h.name === 'work');
  assert.equal(work.kind, 'ssh');
  assert.equal(work.reachable, true);
  assert.equal(work.label, 'tycho');
  assert.ok(fs.existsSync(socketPath), 'the forward listens on the per-remote socket');
  assert.equal(fs.statSync(path.dirname(socketPath)).mode & 0o777, 0o700, 'the run dir is not readable by other users');

  const proxied = await fetch(`${sshHub.base}/hosts/work/api/sessions`);
  assert.equal(proxied.status, 200);
  assert.ok((await proxied.json()).previous.some((s) => s.id === PEER_SESSION_ID));

  // The forward is a child of the server and goes down with it.
  sshHub.child.kill('SIGTERM');
  const deadline = Date.now() + 5000;
  while (fs.existsSync(socketPath) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(socketPath), false, 'the ssh child must not outlive the server');
});

test('a failing ssh forward is reported as a class, never as its stderr', async () => {
  const home = makeHome();
  writeSettings(home, { remotes: [{ name: 'work', sshDest: 'user@box' }] });
  const sshHub = await boot(home, { PATH: fakeSshPath(), PI_DISH_FAKE_SSH_FAIL: '1' });

  const hosts = (await (await fetch(`${sshHub.base}/api/hosts`)).json()).hosts;
  const work = hosts.find((h) => h.name === 'work');
  assert.equal(work.reachable, false);
  assert.equal(work.error, 'ssh_auth_failed');

  const proxied = await fetch(`${sshHub.base}/hosts/work/api/sessions`);
  assert.equal(proxied.status, 502);
  const body = await proxied.json();
  assert.equal(body.reason, 'ssh_auth_failed');
  assert.equal(/publickey|Permission denied/.test(JSON.stringify(body)), false);
});

// --- hub-side auth over the proxy ----------------------------------------

test('a hub token gates /hosts/* exactly like /api/*', async () => {
  const home = makeHome();
  writeSettings(home, {
    remotes: [{ name: 'peer', url: `http://127.0.0.1:${peer.port}`, token: PEER_TOKEN }],
  });
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'token'), `${HUB_TOKEN}\n`);
  const gated = await boot(home);

  assert.equal((await fetch(`${gated.base}/api/hosts`)).status, 401);
  assert.equal((await fetch(`${gated.base}/hosts/peer/api/sessions`)).status, 401);
  assert.equal((await fetch(`${gated.base}/hosts/peer/api/sessions`, authed('wrong'))).status, 401);
  // The gate runs before the fleet lookup: an unknown host is still 401.
  assert.equal((await fetch(`${gated.base}/hosts/nobody/api/sessions`)).status, 401);

  // The hub's token opens the proxy — and the *peer's* token is what the peer
  // sees, so the hub credential never travels (it would 401 there).
  const ok = await fetch(`${gated.base}/hosts/peer/api/sessions`, authed(HUB_TOKEN));
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).previous.some((s) => s.id === PEER_SESSION_ID));
  assert.equal((await fetch(`${peer.base}/api/sessions`, authed(HUB_TOKEN))).status, 401);

  const hosts = (await (await fetch(`${gated.base}/api/hosts`, authed(HUB_TOKEN))).json()).hosts;
  assert.equal(hosts.find((h) => h.name === 'peer').reachable, true);

  // EventSource can't send a header, so the hub's own ticket opens the
  // proxied stream route — and only that route.
  const ticket = (await (await fetch(`${gated.base}/api/auth/ticket`, authed(HUB_TOKEN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'stream' }),
  }))).json()).ticket;

  const stream = await fetch(`${gated.base}/hosts/peer/api/sessions/nope/stream?ticket=${ticket}`);
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  assert.equal(stream.headers.get('content-encoding'), null);
  assert.equal((await fetch(`${gated.base}/hosts/peer/api/sessions?ticket=${ticket}`)).status, 401);
  assert.equal((await fetch(`${gated.base}/hosts/peer/api/sessions/nope/stream?ticket=not-a-ticket`)).status, 401);
});

test('the proxy trips a breaker on a down peer and re-dials when the slot expires', async () => {
  // Its own hub, so the ladder position is exactly what this test put there.
  const port = await freePort();          // nothing listening yet
  const home = makeHome();
  writeSettings(home, { remotes: [{ name: 'flap', url: `http://127.0.0.1:${port}` }] });
  const breakerHub = await boot(home);

  const started = Date.now();
  const first = await fetch(`${breakerHub.base}/hosts/flap/api/sessions`);
  assert.equal(first.status, 502);
  const body = await first.json();
  assert.equal(body.host, 'flap');
  assert.equal(body.reason, 'connection_refused');

  // The peer comes up immediately - and is still refused, because the answer
  // now comes from the cached failure rather than a dial.
  const peerUp = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ awake: true }));
  });
  closables.push(peerUp);
  await new Promise((resolve) => peerUp.listen(port, '127.0.0.1', resolve));

  const shorted = await fetch(`${breakerHub.base}/hosts/flap/api/sessions`);
  assert.equal(shorted.status, 502, 'a known-down peer is not dialed again inside its slot');
  assert.equal((await shorted.json()).reason, 'connection_refused');

  // Nothing else expires the breaker: the ladder slot does.
  const elapsed = Date.now() - started;
  await new Promise((r) => setTimeout(r, Math.max(0, remoteHosts.BACKOFF_LADDER[0] - elapsed) + 400));
  const recovered = await fetch(`${breakerHub.base}/hosts/flap/api/sessions`);
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { awake: true });
});
