/**
 * Fleet awareness in the peer-sessions skill (TASKS/multi-host.md block 6).
 *
 * The agent CLI never grows a host catalog: it talks to its own server and
 * reaches the fleet through that server's /hosts/<name> proxy. So these tests
 * drive the real CLI binary against a real hub that knows a real peer — the
 * hub+peer boot pattern of test/remote-hosts.test.js — rather than a mock,
 * because what is being asserted is that the existing routes compose behind a
 * path prefix and that one bearer token gets the CLI through.
 *
 * The hub is token-gated here, and the peer holds a *different* token that
 * only the hub knows: a CLI that made it to the peer's sessions did so with
 * one env var and the hub's own credential handling.
 *
 * Run with: npm test
 */
import test = require('node:test');
import { present, record, records } from './test-types.js';
import assert = require('node:assert');
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs = require('node:fs');
import http = require('node:http');
import net = require('node:net');
import os = require('node:os');
import path = require('node:path');
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SERVER = path.join(__dirname, '..', 'server.js');
const CLI = path.join(__dirname, '..', 'skills', 'pi-dish-sessions', 'scripts', 'pi-dish-sessions.js');

const HUB_TOKEN = 'hub-token-fleet-skill-0123456789';
const PEER_TOKEN = 'peer-token-fleet-skill-abcdefghij';
const PEER_SESSION_ID = '2026-08-22T11-00-00-peerskill1';

const children: ChildProcess[] = [];
test.after(() => {
  for (const child of children) { try { child.kill('SIGKILL'); } catch {} }
});

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-skill-fleet-'));
  fs.mkdirSync(path.join(home, '.pi', 'agent', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.pi', 'dish'), { recursive: true });
  return home;
}

function writeFixtureSession(home: string) {
  const dir = path.join(home, '.pi', 'agent', 'sessions', '--home-user-peerproj--');
  fs.mkdirSync(dir, { recursive: true });
  const entries = [
    { type: 'session', cwd: '/home/user/peerproj', timestamp: '2026-08-22T11:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'peer fixture prompt' }], timestamp: '2026-08-22T11:00:01.000Z' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'peer fixture reply' }], timestamp: '2026-08-22T11:00:02.000Z' } },
  ];
  fs.writeFileSync(path.join(dir, `${PEER_SESSION_ID}.jsonl`), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('Port probe lacks TCP address'));
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function boot(home: string) {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PORT: String(port) };
  // The runner's own environment must not decide what the child requires.
  delete env.PI_DISH_TOKEN;
  delete env.PI_DISH_TERMINAL;
  delete env.PI_DISH_SHARE_PORT;
  env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-skill-fleet-tmux-'));

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
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  return { base, port, child, home };
}

type BootedServer = Awaited<ReturnType<typeof boot>>;
let hub: BootedServer;
let peer: BootedServer;
let downPort: number;

function runCli(args: string[], options: { url?: string; token?: string | null; home?: string } = {}) {
  const { url, token = HUB_TOKEN, home = hub.home } = options;
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PI_DISH_URL: url || hub.base, PI_DISH_SESSION_ID: 'caller-session' };
  if (token) env.PI_DISH_TOKEN = token; else delete env.PI_DISH_TOKEN;
  return execFileAsync(process.execPath, [CLI, ...args], { env });
}

test('boot a token-gated peer and a token-gated hub that knows it', async () => {
  const peerHome = makeHome();
  writeFixtureSession(peerHome);
  fs.writeFileSync(path.join(peerHome, '.pi', 'dish', 'token'), `${PEER_TOKEN}\n`);
  fs.writeFileSync(path.join(peerHome, '.pi', 'dish', 'settings.json'), JSON.stringify({ hostLabel: 'tycho' }));
  peer = await boot(peerHome);

  downPort = await freePort();

  const hubHome = makeHome();
  fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'token'), `${HUB_TOKEN}\n`);
  fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'settings.json'), JSON.stringify({
    hostLabel: 'hub',
    remotes: [
      { name: 'peer', url: `http://127.0.0.1:${peer.port}`, token: PEER_TOKEN },
      { name: 'down', url: `http://127.0.0.1:${downPort}` },
    ],
  }));
  hub = await boot(hubHome);
});

test('hosts lists self and every remote, with reachability and capabilities', async () => {
  const { stdout } = await runCli(['hosts']);
  const lines = stdout.trim().split('\n');

  const self = present(lines[0]), peerLine = present(lines[1]), downLine = present(lines[2]);
  assert.match(self, /^\(self\)\treachable\thub\t/, 'this host comes first and is marked');
  assert.match(self, /sessions/, 'capabilities an agent can act on are listed');

  const peerFields = peerLine.split('\t');
  assert.deepEqual(peerFields.slice(0, 3), ['peer', 'reachable', 'tycho']);
  assert.match(String(peerFields[3]), /sessions/);

  // An unreachable host is listed with its classified reason, not hidden.
  const downFields = downLine.split('\t');
  assert.equal(downFields[0], 'down');
  assert.equal(downFields[1], 'unreachable:connection_refused');
  assert.equal(downFields[3], '-', 'nothing is claimed for a host that did not answer');

  assert.match(present(lines.at(-1)), /^# Add --host <name>/);

  const parsed = record(JSON.parse((await runCli(['hosts', '--json'])).stdout));
  const hosts = records(parsed.hosts);
  assert.deepEqual(hosts.map(host => host.name), [null, 'peer', 'down']);
  assert.equal(present(hosts[0]).self, true);
});

test('--host routes a session command to that host, default stays local', async () => {
  const remote = await runCli(['list', '--host', 'peer']);
  assert.match(remote.stdout, new RegExp(`^${PEER_SESSION_ID}\\tinactive\\t`, 'm'), "the peer's own sessions came back");

  // The same command without --host is the local server, as before.
  const local = await runCli(['list']);
  assert.equal(local.stdout.includes(PEER_SESSION_ID), false);

  // Session-scoped routes compose behind the prefix too.
  const shown = record(JSON.parse((await runCli(['show', PEER_SESSION_ID, '--limit', '5', '--host', 'peer'])).stdout));
  assert.equal(record(shown.session).id, PEER_SESSION_ID);
  const messages = records(shown.messages), final = present(messages.at(-1));
  assert.equal(record(present(records(final.content)[0])).text, 'peer fixture reply');

  const searched = await runCli(['search', 'peer fixture', '--host', 'peer']);
  assert.match(searched.stdout, new RegExp(PEER_SESSION_ID));
});

test('an unknown host names the fleet instead of leaking a bare 404', async () => {
  await assert.rejects(
    runCli(['list', '--host', 'nope']),
    (error: unknown) => {
      const stderr = String(record(error).stderr ?? '');
      assert.match(stderr, /unknown host "nope"/);
      assert.match(stderr, /known: peer, down/);
      assert.match(stderr, /run 'hosts'/);
      return true;
    },
  );

  // A 404 from a host that *is* configured stays the host's own error.
  await assert.rejects(
    runCli(['related', 'no-such-session', '--host', 'peer']),
    (error: unknown) => {
      assert.equal(/unknown host/.test(String(record(error).stderr ?? '')), false);
      return true;
    },
  );
});

test('PI_DISH_TOKEN is what gets the CLI through a token-gated server', async () => {
  // The hub is closed to anyone without its token…
  assert.equal((await fetch(`${hub.base}/api/hosts`)).status, 401);
  assert.equal((await fetch(`${hub.base}/hosts/peer/api/sessions`)).status, 401);

  // …and the CLI carrying it reaches both the hub and, through it, the peer —
  // whose own token the CLI never sees.
  assert.match((await runCli(['hosts'])).stdout, /^\(self\)/);
  assert.match((await runCli(['list', '--host', 'peer'])).stdout, new RegExp(PEER_SESSION_ID));

  await assert.rejects(
    runCli(['hosts'], { token: null }),
    (error: unknown) => { assert.match(String(record(error).stderr ?? ''), /Unauthorized/); return true; },
  );
});

// --- cross-host launch provenance ----------------------------------------
//
// A spawn against a peer is the one command whose *body* changes cross-host,
// and a live spawn needs a real pi. A reflecting server stands in for the hub
// so the request the CLI builds can be read directly.

interface ReflectedRequest { url?: string; body: Record<string, unknown> | null; caller?: string | string[] }
function fakeHub({ rejectProvenance }: { rejectProvenance: boolean }) {
  const requests: ReflectedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: Record<string, unknown> | null = null;
      try { body = record(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch {}
      requests.push({ url: req.url, body, caller: req.headers['x-pi-dish-session-id'] });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/host') return res.end(JSON.stringify({ hostId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', label: 'local', capabilities: {} }));
      if (req.url === '/hosts/peer/api/sessions/new') {
        if (rejectProvenance && body?.requestedBySessionId) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'requestedBySessionId must identify an existing session' }));
        }
        res.statusCode = 202;
        return res.end(JSON.stringify({ success: true, pending: true, spawnId: 'spawn-1' }));
      }
      if (req.url === '/hosts/peer/api/session-spawns/spawn-1') return res.end(JSON.stringify({ status: 'ready', sessionId: 'peer-new-1' }));
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  return { server, requests };
}

test('a cross-host spawn attributes the caller host-qualified', async (t) => {
  const { server, requests } = fakeHub({ rejectProvenance: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fake hub lacks TCP address');
  const url = `http://127.0.0.1:${address.port}`;

  const spawned = await runCli(['spawn', '--host', 'peer', '--cwd', '/work', '--json'], { url, token: null, home: os.tmpdir() });
  const result = record(JSON.parse(spawned.stdout));
  assert.equal(result.sessionId, 'peer-new-1');
  assert.equal(result.host, 'peer');

  const create = present(requests.find(request => request.url === '/hosts/peer/api/sessions/new'));
  const body = present(create.body);
  // Same advisory fields as a local spawn; the host id only says whose
  // session id this is (TASKS/multi-host.md block 6).
  assert.equal(body.requestedBySessionId, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa:caller-session');
  assert.equal(create.caller, body.requestedBySessionId);
  assert.equal(body.cwd, '/work');
});

test('a peer that refuses foreign provenance still gets the session spawned', async (t) => {
  const { server, requests } = fakeHub({ rejectProvenance: true });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fake hub lacks TCP address');
  const url = `http://127.0.0.1:${address.port}`;

  const spawned = await runCli(['spawn', '--host', 'peer', '--json'], { url, token: null, home: os.tmpdir() });
  assert.equal(record(JSON.parse(spawned.stdout)).sessionId, 'peer-new-1');
  assert.match(spawned.stderr, /did not accept cross-host launch provenance/);

  const creates = requests.filter(request => request.url === '/hosts/peer/api/sessions/new');
  assert.equal(creates.length, 2);
  // Provenance is advisory: dropped, never fatal, and never re-invented.
  assert.equal(present(present(creates[1]).body).requestedBySessionId, undefined);
});

export {};
