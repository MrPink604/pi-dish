import test = require('node:test');
import { nativeId as checkedNativeId, present, record, records } from './test-types.js';
import assert = require('node:assert');
import http = require('node:http');
import path = require('node:path');
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs = require('node:fs');
import os = require('node:os');
const { encodeSessionKey }: typeof import('../lib/session-key') = require('../lib/session-key')
interface CapturedRequest {
  method?: string;
  url?: string;
  body: Record<string, unknown> | null;
  source?: string | string[];
}
const listenServer = (server: http.Server): Promise<string> => new Promise((resolve, reject) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('Mock server lacks TCP address'));
    resolve(`http://127.0.0.1:${address.port}`);
  });
});


const execFileAsync = promisify(execFile);
const cli = path.join(__dirname, '..', 'skills', 'pi-dish-sessions', 'scripts', 'pi-dish-sessions.js');

function mockServer({ renameError }: { renameError?: string } = {}) {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: Record<string, unknown> | null = null;
      try { body = record(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch {}
      requests.push({ method: req.method, url: req.url, body, source: req.headers['x-pi-dish-session-id'] });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/sessions/new') {
        res.statusCode = 202; res.end(JSON.stringify({ pending: true, spawnId: 'spawn-1' })); return;
      }
      if (req.method === 'GET' && req.url === '/api/session-spawns/spawn-1') {
        res.end(JSON.stringify({ status: 'ready', sessionId: 'peer-1' })); return;
      }
      if (req.method === 'GET' && req.url === '/api/harnesses') {
        res.end(JSON.stringify({ harnesses: [
          { id: 'pi', label: 'Pi', available: true },
          { id: 'omp', label: 'Oh My Pi', available: true },
          { id: 'prime', label: 'Prime', available: false },
        ] })); return;
      }
      if (req.method === 'GET' && (req.url === '/api/sessions' || req.url === '/api/sessions?active=1')) {
        res.end(JSON.stringify({ active: [{ id: 'peer-1', isActive: true, name: 'Peer', cwd: '/work' }], previous: [] })); return;
      }
      if (req.method === 'GET' && req.url === '/api/sessions/peer-1/related') {
        res.end(JSON.stringify({ relations: [{ kind: 'startedFrom', source: 'pi-dish-launch', session: { id: 'source-1', name: 'Source' } }] })); return;
      }
      if (req.method === 'GET' && req.url === '/api/sessions/peer-1/messages?limit=5') {
        res.end(JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }] })); return;
      }
      const url = req.url ?? '';
      if (renameError && req.method === 'POST' && url === '/api/sessions/peer-1/rename') {
        res.statusCode = 409; res.end(JSON.stringify({ error: renameError })); return;
      }
      if (req.method === 'POST' && /^\/api\/sessions\/peer-1\/(rename|prompt|steer|follow-up|abort|resume|close)$/.test(url)) {
        res.end(JSON.stringify({ success: true })); return;
      }
      if (req.method === 'GET' && url.startsWith('/api/search?')) {
        res.end(JSON.stringify({
          results: [
            { id: 'hit-1', isActive: false, name: 'Torn tail fix', cwd: '/work/api',
              lastActivity: '2026-08-01T10:00:00.000Z', matchCount: 3,
              snippets: ['skip the torn tail\non load', 'reindex after the torn tail'] },
            { id: 'hit-2', isActive: true, name: 'Follow-up', cwd: '/work/api',
              lastActivity: '2026-08-10T09:00:00.000Z', matchCount: 0, snippets: [] },
          ],
          total: 25, indexing: true,
        })); return;
      }
      res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  return { server, requests };
}

// A fixed caller host: provenance is fleet-qualified from ~/.pi/dish/host-id.
const CALLER_HOST_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const callerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-session-cli-'));
fs.mkdirSync(path.join(callerHome, '.pi', 'dish'), { recursive: true });
fs.writeFileSync(path.join(callerHome, '.pi', 'dish', 'host-id'), `${CALLER_HOST_ID}\n`);
test.after(() => fs.rmSync(callerHome, { recursive: true, force: true }));

async function run(args: string[], base: string) {
  return execFileAsync(process.execPath, [cli, ...args, '--url', base], {
    env: { ...process.env, HOME: callerHome, PI_DISH_SESSION_ID: 'source-1' },
  });
}

test('peer-session CLI attributes spawn and uses semantic control routes', async t => {
  const { server, requests } = mockServer();
  const base = await listenServer(server);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  const spawned = await run(['spawn', '--cwd', '/work', '--name', 'Peer', '--prompt', 'Investigate', '--json'], base);
  assert.equal(record(JSON.parse(spawned.stdout)).sessionId, 'peer-1');
  const create = present(requests.find(request => request.url === '/api/sessions/new')), createBody = present(create.body);
  assert.equal(createBody.requestedBySessionId, `${CALLER_HOST_ID}:source-1`);
  assert.equal(createBody.cwd, '/work');
  assert.equal(createBody.harness, 'pi', 'a bare Pi caller id inherits the Pi harness');
  assert.equal(create.source, `${CALLER_HOST_ID}:source-1`);
  assert.ok(requests.some(request => request.url === '/api/sessions/peer-1/rename'));
  assert.ok(requests.some(request => request.url === '/api/sessions/peer-1/prompt' && request.body?.message === 'Investigate'));

  const controls: Array<readonly [string, string]> = [['send', 'prompt'], ['steer', 'steer'], ['follow-up', 'follow-up']];
  for (const [command, route] of controls) {
    await run([command, 'peer-1', 'Then', 'summarize'], base);
    const control = present(requests.find(request => request.url === `/api/sessions/peer-1/${route}` && request.body?.message === 'Then summarize'));
    // The calling session is stamped on send/follow-up so the target's host can
    // hold it; steer interrupts, so it carries no identity and is never held.
    const sender = record(control.body).sender;
    if (command === 'steer') assert.equal(sender, undefined, 'steer carries no sender');
    else assert.equal(record(sender).id, 'source-1', `${command} carries the calling session as sender`);
  }
  for (const command of ['interrupt', 'resume', 'close']) await run([command, 'peer-1'], base);
  assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/abort'));
  assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/resume'));
  assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/close'));

  const related = await run(['related', 'peer-1'], base);
  assert.match(related.stdout, /startedFrom\s+source-1\s+Source/);
  const shown = await run(['show', 'peer-1', '--limit', '5'], base);
  const shownBody = record(JSON.parse(shown.stdout)), shownMessages = records(shownBody.messages);
  assert.equal(record(present(records(present(shownMessages[0]).content)[0])).text, 'done');
  const listed = await run(['list', '--active'], base);
  assert.match(listed.stdout, /peer-1\s+active\s+Peer/);

  const searched = await run(['search', 'torn', 'tail', 'cwd:/work/api'], base);
  const searchReq = present(requests.find(request => request.url?.startsWith('/api/search?')));
  assert.equal(new URL(present(searchReq.url), base).searchParams.get('q'), 'torn tail cwd:/work/api',
    'positional terms join into one grammar query');
  assert.match(searched.stdout, /hit-1\tinactive\tTorn tail fix\t\/work\/api\t2026-08-01\t3 matches/);
  assert.match(searched.stdout, /…skip the torn tail on load…/, 'snippets are shown with whitespace flattened');
  assert.match(searched.stdout, /hit-2\tactive\t.*metadata match/);
  assert.match(searched.stdout, /# 23 more results not shown/);
  assert.match(searched.stdout, /index is still building/);

  const searchedJson = await run(['search', 'torn', '--limit', '1', '--json'], base);
  const parsed = record(JSON.parse(searchedJson.stdout)), results = records(parsed.results);
  assert.equal(results.length, 1, '--limit slices JSON results too');
  assert.equal(present(results[0]).id, 'hit-1');
  assert.equal(parsed.total, 25);
});

// A peer spawned from an OMP session must be an OMP session: the harness comes
// from the caller's own identity, never the HTTP route's Pi default.
test('peer-session CLI spawns the caller\'s own harness and honours --harness', async t => {
  const { server, requests } = mockServer();
  const base = await listenServer(server);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const ompCaller = encodeSessionKey('omp', checkedNativeId('omp-native'));
  const asOmp = (args: string[]) => execFileAsync(process.execPath, [cli, ...args, '--url', base], {
    env: { ...process.env, PI_DISH_SESSION_ID: ompCaller },
  });

  const spawned = await asOmp(['spawn', '--cwd', '/work', '--json']);
  assert.equal(record(JSON.parse(spawned.stdout)).harness, 'omp', 'the spawn result names the harness launched');
  const creates = () => requests.filter(request => request.url === '/api/sessions/new');
  assert.equal(present(present(creates().at(-1)).body).harness, 'omp');

  await asOmp(['spawn', '--harness', 'pi', '--json']);
  assert.equal(present(present(creates().at(-1)).body).harness, 'pi',
    '--harness crosses harnesses deliberately');

  await assert.rejects(() => asOmp(['spawn', '--harness', 'prime']), (error: unknown) => {
    assert.match(String(record(error).stderr ?? ''), /harness "prime" is not installed.*available: pi, omp/);
    return true;
  }, 'a harness the host lacks fails before launching');
  await assert.rejects(() => asOmp(['spawn', '--harness', 'nope']), (error: unknown) => {
    assert.match(String(record(error).stderr ?? ''), /unknown harness "nope" \(available: pi, omp\)/);
    return true;
  });
  assert.equal(requests.filter(r => r.url === '/api/sessions/new').length, 2,
    'rejected harnesses never reach the spawn route');
});

// An agy session titles itself and refuses a rename. It is already running by
// then, so the spawn must still deliver its prompt and report success: a
// failure here leaves an orphan and invites the caller to spawn a second one.
test('peer-session CLI spawn outlives a refused rename and passes a thinking level', async t => {
  const { server, requests } = mockServer({ renameError: 'This session does not support renaming.' });
  const base = await listenServer(server);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  const spawned = await run(
    ['spawn', '--cwd', '/work', '--name', 'Peer', '--thinking-level', 'high', '--prompt', 'Investigate', '--json'], base);
  const result = record(JSON.parse(spawned.stdout));
  assert.equal(result.sessionId, 'peer-1');
  assert.match(String(result.nameError), /does not support renaming/);
  assert.match(spawned.stderr, /session started but not named \(.*does not support renaming/);
  assert.ok(requests.some(request => request.url === '/api/sessions/peer-1/prompt' && request.body?.message === 'Investigate'),
    'the prompt is still delivered');
  assert.equal(present(present(requests.find(request => request.url === '/api/sessions/new')).body).thinking, 'high');
});

test('peer-session CLI reports the canonical route for an alternative registry entry', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-session-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const registry = path.join(home, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registry, { recursive: true });
  fs.writeFileSync(path.join(registry, 'omp-worker.json'), JSON.stringify({
    protocolVersion: 2,
    wrapper: { harnessId: 'omp' },
    harnessId: 'omp',
    nativeSessionId: 'omp-native',
    sessionId: 'omp-native',
    pid: process.pid,
    cwd: process.cwd(),
    updatedAt: new Date().toISOString(),
  }));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.PI_DISH_SESSION_ID;
  const result = await execFileAsync(process.execPath, [cli, 'session'], { env });
  assert.equal(result.stdout.trim(), encodeSessionKey('omp', checkedNativeId('omp-native')));
});
test('peer-session CLI attach command lists active tmux entries with --json', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-session-attach-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const registry = path.join(home, '.pi', 'dish', 'sessions');
  const sockets = path.join(home, '.pi', 'dish', 'sockets');
  fs.mkdirSync(registry, { recursive: true });
  fs.mkdirSync(sockets, { recursive: true });

  const sockPath = path.join(sockets, 'test.sock');
  fs.writeFileSync(sockPath, '');
  fs.writeFileSync(path.join(registry, 'pi-test.json'), JSON.stringify({
    sessionId: 'session-xyz',
    pid: process.pid,
    name: 'refactor-auth',
    cwd: '/work/app',
    model: 'anthropic/claude-3-5-sonnet',
    socketPath: sockPath,
    tmux: { socket: '/tmp/tmux-test', pane: '%42' },
    updatedAt: new Date().toISOString(),
  }));

  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  const res = await execFileAsync(process.execPath, [cli, 'attach', '--json'], { env });
  const entries = records(JSON.parse(res.stdout));
  assert.equal(entries.length, 1);
  assert.equal(present(entries[0]).name, 'refactor-auth');
  assert.equal(present(entries[0]).socket, '/tmp/tmux-test');
  assert.equal(present(entries[0]).pane, '%42');
});

// An OMP route id is ~100 base64 characters whose leading ~30 are shared by
// every OMP session on the host, and a mistyped key still decodes. The CLI
// prints the shortest handle the owning host can resolve; a host too old to
// resolve aliases is handled client-side.

const ALIAS_NATIVE = '2026-09-05T09-07-03-291Z_01a070d2-43fb-7360-aaba-a4ddf8d1deb0';
const ALIAS_ROUTE = encodeSessionKey('omp', checkedNativeId(ALIAS_NATIVE));

function aliasServer({ refAliases }: { refAliases: boolean }) {
  const requests: string[] = [];
  const session = { id: ALIAS_ROUTE, isActive: true, name: 'Orchestrator', cwd: '/work/osbg' };
  const capabilities: Record<string, boolean> = { sessions: true, search: true, resolve: true, docs: true };
  if (refAliases) capabilities.refAliases = true;
  const server = http.createServer((req, res) => {
    const requestUrl = req.url ?? '';
    requests.push(requestUrl);
    res.setHeader('Content-Type', 'application/json');
    if (requestUrl === '/api/hosts') {
      res.end(JSON.stringify({ hosts: [{ self: true, name: null, label: 'framework', reachable: true, capabilities }] }));
      return;
    }
    if (requestUrl === '/api/sessions' || requestUrl === '/api/sessions?active=1') {
      res.end(JSON.stringify({ active: [session], previous: [] }));
      return;
    }
    if (requestUrl.startsWith('/api/sessions/resolve?')) {
      const ref = new URL(requestUrl, 'http://x').searchParams.get('id') ?? '';
      // The legacy shape: route-id prefixes only, and no `ref` in the reply.
      const hit = refAliases
        ? [ALIAS_ROUTE, ALIAS_NATIVE, '01a070d2-43fb-7360-aaba-a4ddf8d1deb0'].some(a => a.startsWith(ref))
        : ALIAS_ROUTE.startsWith(ref);
      if (!hit) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Session not found' })); return; }
      res.end(JSON.stringify(refAliases ? { session, ref: '01a070d2' } : { session }));
      return;
    }
    if (req.method === 'POST' && requestUrl === `/api/sessions/${encodeURIComponent(ALIAS_ROUTE)}/steer`) {
      res.end(JSON.stringify({ success: true }));
      return;
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
  });
  return { server, requests };
}

async function withAliasServer(t: test.TestContext, options: { refAliases: boolean }) {
  const { server, requests } = aliasServer(options);
  const base = await listenServer(server);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return { base, requests };
}

test('peer-session CLI prints short refs and resolves them on a capable host', async t => {
  const { base, requests } = await withAliasServer(t, { refAliases: true });

  const listed = await run(['list', '--active'], base);
  assert.match(listed.stdout, /^01a070d2\tactive\tOrchestrator\t\/work\/osbg$/m,
    'the row leads with a handle an agent can retype, not the encoded key');
  assert.ok(!listed.stdout.includes(ALIAS_ROUTE), 'the ~100-char route id is not what the CLI hands back');

  const resolved = await run(['resolve', '01a070d2'], base);
  assert.match(resolved.stdout, /^ref: 01a070d2$/m);
  assert.match(resolved.stdout, new RegExp(`^${ALIAS_ROUTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    'the full route id is still shown — it is what the HTTP routes speak');

  // The short ref drives a real control call; the route still gets the full id.
  await run(['steer', '01a070d2', 'Use the new routing'], base);
  assert.ok(requests.includes(`/api/sessions/${encodeURIComponent(ALIAS_ROUTE)}/steer`));
});

test('peer-session CLI resolves a short ref client-side on a host without ref aliases', async t => {
  const { base, requests } = await withAliasServer(t, { refAliases: false });

  // The host's resolver 404s the uuid tail, so the CLI resolves it against
  // that host's own session list and carries on with the full route id.
  await run(['steer', '01a070d2', 'Use the new routing'], base);
  assert.ok(requests.includes(`/api/sessions/${encodeURIComponent(ALIAS_ROUTE)}/steer`),
    'the control call reaches the session despite the older resolver');

  // Rows on such a host keep printing full ids: a short one would not resolve.
  const listed = await run(['list', '--active'], base);
  assert.match(listed.stdout, new RegExp(`^${ALIAS_ROUTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\tactive`, 'm'));

  // A genuinely unknown ref is still an error, not a retry loop.
  await assert.rejects(() => run(['resolve', 'ffffffff'], base), (error: unknown) => {
    assert.match(String(record(error).stderr ?? ''), /Session not found/);
    return true;
  });
});

// `load --all-hosts` fans out through the entry server's /hosts proxy, only to
// reachable hosts advertising hostHealth, and names the ones it skipped.
test('peer-session CLI load reports each capable host and names skipped ones', async t => {
  const GB = 1024 ** 3;
  const health = (live: number, utilization: number) => ({
    sampledAt: '2026-09-26T00:00:00.000Z', uptimeSec: 60, platform: 'linux', arch: 'x64',
    cpu: { cores: 8, model: 'fixture', utilization, windowMs: 10000, load: [2.5, 2, 1] },
    memory: { totalBytes: 16 * GB, availableBytes: 4 * GB },
    disk: { path: '~', totalBytes: 200 * GB, availableBytes: 50 * GB },
    sessions: { live, working: 1, waiting: 0, subagents: 0, byHarness: {} },
  });
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/hosts') {
      res.end(JSON.stringify({ hosts: [
        { self: true, hostId: 'self-id', label: 'self', reachable: true, capabilities: { sessions: true, hostHealth: true } },
        { name: 'tycho', hostId: 'tycho-id', label: 'tycho', reachable: true, capabilities: { sessions: true, hostHealth: true } },
        { name: 'oldie', hostId: 'oldie-id', label: 'oldie', reachable: true, capabilities: { sessions: true } },
        { name: 'down', reachable: false, error: 'refused' },
        { name: 'broken', hostId: 'broken-id', label: 'broken', reachable: true, capabilities: { hostHealth: true } },
      ] }));
      return;
    }
    if (req.url === '/api/host/health') { res.end(JSON.stringify(health(3, 0.25))); return; }
    if (req.url === '/hosts/tycho/api/host/health') { res.end(JSON.stringify(health(5, 0.9))); return; }
    if (req.url === '/hosts/broken/api/host/health') { res.statusCode = 502; res.end(JSON.stringify({ error: 'peer unreachable', reason: 'refused' })); return; }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
  });
  const base = await listenServer(server);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  const single = await run(['load'], base);
  assert.equal(single.stdout, '(self)\t3 live, 1 working\tcpu 25% load 2.50/8\tmem 75% of 16.0G\tdisk 75% of 200G\n');
  const peer = await run(['load', '--host', 'tycho'], base);
  assert.match(peer.stdout, /^tycho\t5 live, 1 working\tcpu 90% load 2\.50\/8\t/);
  await assert.rejects(run(['load', '--host', 'oldie'], base), (error: unknown) => {
    assert.match(String(record(error).stderr ?? ''), /does not report load/);
    return true;
  });
  assert.ok(!requests.includes('/hosts/oldie/api/host/health'), 'an unadvertised capability is never probed');

  const fleet = await run(['load', '--all-hosts'], base);
  assert.deepEqual(fleet.stdout.trim().split('\n'), [
    '(self)\t3 live, 1 working\tcpu 25% load 2.50/8\tmem 75% of 16.0G\tdisk 75% of 200G',
    'tycho\t5 live, 1 working\tcpu 90% load 2.50/8\tmem 75% of 16.0G\tdisk 75% of 200G',
    '# oldie: does not report load',
    '# down: refused',
    '# broken: peer unreachable',
  ]);
  const parsed = record(record(JSON.parse((await run(['load', '--all-hosts', '--json'], base)).stdout)).hosts);
  assert.deepEqual(Object.keys(parsed), ['(self)', 'tycho', 'oldie', 'down', 'broken']);
  assert.equal(record(parsed['(self)']).status, 'ok');
  assert.equal(record(record(parsed.tycho).sessions).live, 5);
  assert.deepEqual(parsed.oldie, { status: 'skipped', error: 'does not report load' });
  assert.deepEqual(parsed.down, { status: 'skipped', error: 'refused' });
  assert.equal(record(parsed.broken).status, 'error');
  assert.ok(!requests.includes('/hosts/down/api/host/health'), 'an unreachable host is not dialled');

  const hosts = await run(['hosts'], base);
  assert.match(hosts.stdout, /^\(self\)\treachable\tself\tsessions,hostHealth$/m);
});

test('peer-session CLI models lists GET /api/models as lines and as the route JSON', async t => {
  const catalog = [
    { id: 'big', provider: 'acme', name: 'Acme Big', selector: 'acme/big', contextWindow: 200000, reasoning: true, thinking: ['low', 'high'], pricing: null, free: false, enabled: true },
    { id: 'tiny', provider: 'acme', name: 'tiny', contextWindow: 0, pricing: { input: 0, output: 0 }, free: true, enabled: false },
  ];
  const urls: string[] = [];
  const server = http.createServer((req, res) => {
    urls.push(req.url ?? '');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(catalog));
  });
  const base = await listenServer(server);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  assert.deepEqual(JSON.parse((await run(['models', '--json'], base)).stdout), catalog);
  assert.equal(urls.at(-1), '/api/models', 'no harness means the route default');
  const text = await run(['models', '--harness', 'omp', '--cwd', '/work/api'], base);
  assert.equal(urls.at(-1), '/api/models?harness=omp&cwd=%2Fwork%2Fapi');
  assert.equal(text.stdout, 'acme/big\tAcme Big\tctx 200.0k\treasoning\nacme/tiny\ttiny\tctx ?\tfree,disabled\n');
});

// `wait` takes the live state from the resolve route and the newest message
// and its count from the transcript window: a resolve row's messageCount is
// stale for an agy session, so it must not decide anything.
function waitServer() {
  let resolves = 0;
  const urls: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    urls.push(url);
    res.setHeader('Content-Type', 'application/json');
    if (url === '/api/hosts') {
      res.end(JSON.stringify({ hosts: [{ self: true, name: null, label: 'self', reachable: true,
        capabilities: { sessions: true, resolve: true } }] }));
      return;
    }
    if (url.startsWith('/api/sessions/resolve?')) {
      // The first resolve is the ref lookup; the first poll is the second.
      resolves++;
      res.end(JSON.stringify({ session: { id: 'w-1', isActive: true, name: 'Worker', messageCount: 1,
        turnInProgress: resolves < 3 } }));
      return;
    }
    if (url === '/api/sessions/w-1/messages?limit=1') {
      // The first poll sees only the prompt; by the second the answer is in.
      const done = resolves >= 3;
      res.end(JSON.stringify({ totalMessages: done ? 2 : 1, messages: [done
        ? { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'All green.' }] }
        : { role: 'user', content: 'Run the suite' }] }));
      return;
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
  });
  return { server, urls, polls: () => resolves };
}

test('peer-session CLI wait prints the answer once the turn ends', async t => {
  const { server, urls, polls } = waitServer();
  const base = await listenServer(server);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  const waited = await run(['wait', 'w-1', '--since', '0', '--timeout', '20'], base);
  assert.equal(polls(), 3, 'one resolve for the ref, then a working poll and a finished one');
  assert.match(waited.stdout, /^# finished: w-1 · 2 messages\nAll green\.\n$/);
  assert.ok(urls.includes('/api/sessions/w-1/messages?limit=1'));
});

test('peer-session CLI wait exits non-zero when nothing new arrives in time', async t => {
  const { server } = waitServer();
  const base = await listenServer(server);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  await assert.rejects(() => run(['wait', 'w-1', '--since', '2', '--timeout', '1'], base), (error: unknown) => {
    assert.match(String(record(error).stderr ?? ''), /w-1 was still working after 1s/);
    return true;
  });
});

test('peer-session CLI kb searches and reads the knowledge base on whichever host serves it', async t => {
  let hubServes = true;
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    res.setHeader('Content-Type', 'application/json');
    if (url === '/api/hosts') {
      res.end(JSON.stringify({ hosts: [
        { self: true, label: 'self', reachable: true, capabilities: { sessions: true } },
        { name: 'hub', label: 'hub', reachable: true, capabilities: { sessions: true, knowledge: hubServes } },
      ] }));
      return;
    }
    if (url === '/hosts/hub/api/knowledge/search?q=backups%20aeor') {
      res.end(JSON.stringify({ total: 1, results: [{ path: 'topics/beelink.md', lines: [{ line: 3, text: 'Backups go to aeor.' }] }] }));
      return;
    }
    if (url === '/hosts/hub/api/knowledge/page?page=beelink') {
      res.end(JSON.stringify({ path: 'topics/beelink.md', text: '# Beelink\n\nBackups go to aeor.\n' }));
      return;
    }
    if (url === '/api/knowledge/page') {
      res.statusCode = 503; res.end(JSON.stringify({ error: 'The knowledge base is off on this host', off: true })); return;
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
  });
  const base = await listenServer(server);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  const searched = await run(['kb', 'search', 'backups', 'aeor'], base);
  assert.equal(searched.stdout, '# from hub\ntopics/beelink.md\n  3: Backups go to aeor.\n# Read a page with: kb read <path>\n');
  const read = await run(['kb', 'read', 'beelink'], base);
  assert.equal(read.stdout, '# from hub\n# Beelink\n\nBackups go to aeor.\n');
  hubServes = false;
  await assert.rejects(run(['kb', 'read'], base), (error: unknown) => {
    assert.match(String(record(error).stderr ?? ''), /knowledge base is off/);
    return true;
  });
  await assert.rejects(run(['kb', 'write', 'x'], base), (error: unknown) => {
    assert.match(String(record(error).stderr ?? ''), /kb needs 'search <terms…>' or 'read \[page\]'/);
    return true;
  });
});

export {};
