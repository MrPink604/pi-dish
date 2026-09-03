const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const { encodeSessionKey } = require('../lib/session-key');

const execFileAsync = promisify(execFile);
const cli = path.join(__dirname, '..', 'skills', 'pi-dish-sessions', 'scripts', 'pi-dish-sessions.js');

function mockServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch {}
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
      if (req.method === 'POST' && /^\/api\/sessions\/peer-1\/(rename|prompt|steer|follow-up|abort|resume|close)$/.test(req.url)) {
        res.end(JSON.stringify({ success: true })); return;
      }
      if (req.method === 'GET' && req.url.startsWith('/api/search?')) {
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

async function run(args, base) {
  return execFileAsync(process.execPath, [cli, ...args, '--url', base], {
    env: { ...process.env, PI_DISH_SESSION_ID: 'source-1' },
  });
}

test('peer-session CLI attributes spawn and uses semantic control routes', async t => {
  const { server, requests } = mockServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const spawned = await run(['spawn', '--cwd', '/work', '--name', 'Peer', '--prompt', 'Investigate', '--json'], base);
  assert.equal(JSON.parse(spawned.stdout).sessionId, 'peer-1');
  const create = requests.find(r => r.url === '/api/sessions/new');
  assert.equal(create.body.requestedBySessionId, 'source-1');
  assert.equal(create.body.cwd, '/work');
  assert.equal(create.body.harness, 'pi', 'a bare Pi caller id inherits the Pi harness');
  assert.equal(create.source, 'source-1');
  assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/rename'));
  assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/prompt' && r.body.message === 'Investigate'));

  for (const [command, route] of [['send', 'prompt'], ['steer', 'steer'], ['follow-up', 'follow-up']]) {
    await run([command, 'peer-1', 'Then', 'summarize'], base);
    assert.ok(requests.some(r => r.url === `/api/sessions/peer-1/${route}` && r.body.message === 'Then summarize'));
  }
  for (const command of ['interrupt', 'resume', 'close']) await run([command, 'peer-1'], base);
  assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/abort'));
  assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/resume'));
  assert.ok(requests.some(r => r.url === '/api/sessions/peer-1/close'));

  const related = await run(['related', 'peer-1'], base);
  assert.match(related.stdout, /startedFrom\s+source-1\s+Source/);
  const shown = await run(['show', 'peer-1', '--limit', '5'], base);
  assert.equal(JSON.parse(shown.stdout).messages[0].content[0].text, 'done');
  const listed = await run(['list', '--active'], base);
  assert.match(listed.stdout, /peer-1\s+active\s+Peer/);

  const searched = await run(['search', 'torn', 'tail', 'cwd:/work/api'], base);
  const searchReq = requests.find(r => r.url.startsWith('/api/search?'));
  assert.equal(new URL(searchReq.url, base).searchParams.get('q'), 'torn tail cwd:/work/api',
    'positional terms join into one grammar query');
  assert.match(searched.stdout, /hit-1\tinactive\tTorn tail fix\t\/work\/api\t2026-08-01\t3 matches/);
  assert.match(searched.stdout, /…skip the torn tail on load…/, 'snippets are shown with whitespace flattened');
  assert.match(searched.stdout, /hit-2\tactive\t.*metadata match/);
  assert.match(searched.stdout, /# 23 more results not shown/);
  assert.match(searched.stdout, /index is still building/);

  const searchedJson = await run(['search', 'torn', '--limit', '1', '--json'], base);
  const parsed = JSON.parse(searchedJson.stdout);
  assert.equal(parsed.results.length, 1, '--limit slices JSON results too');
  assert.equal(parsed.results[0].id, 'hit-1');
  assert.equal(parsed.total, 25);
});

// A peer spawned from an OMP session must be an OMP session: the harness comes
// from the caller's own identity, never the HTTP route's Pi default.
test('peer-session CLI spawns the caller\'s own harness and honours --harness', async t => {
  const { server, requests } = mockServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const ompCaller = encodeSessionKey('omp', 'omp-native');
  const asOmp = (args) => execFileAsync(process.execPath, [cli, ...args, '--url', base], {
    env: { ...process.env, PI_DISH_SESSION_ID: ompCaller },
  });

  const spawned = await asOmp(['spawn', '--cwd', '/work', '--json']);
  assert.equal(JSON.parse(spawned.stdout).harness, 'omp', 'the spawn result names the harness launched');
  assert.equal(requests.filter(r => r.url === '/api/sessions/new').at(-1).body.harness, 'omp');

  await asOmp(['spawn', '--harness', 'pi', '--json']);
  assert.equal(requests.filter(r => r.url === '/api/sessions/new').at(-1).body.harness, 'pi',
    '--harness crosses harnesses deliberately');

  await assert.rejects(() => asOmp(['spawn', '--harness', 'prime']), (e) => {
    assert.match(e.stderr, /harness "prime" is not installed.*available: pi, omp/);
    return true;
  }, 'a harness the host lacks fails before launching');
  await assert.rejects(() => asOmp(['spawn', '--harness', 'nope']), (e) => {
    assert.match(e.stderr, /unknown harness "nope" \(available: pi, omp\)/);
    return true;
  });
  assert.equal(requests.filter(r => r.url === '/api/sessions/new').length, 2,
    'rejected harnesses never reach the spawn route');
});

test('peer-session CLI reports the canonical route for an alternative registry entry', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-session-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const registry = path.join(home, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registry, { recursive: true });
  fs.writeFileSync(path.join(registry, 'prime-worker.json'), JSON.stringify({
    protocolVersion: 2,
    wrapper: { harnessId: 'prime' },
    harnessId: 'prime',
    nativeSessionId: 'prime-native',
    sessionId: 'prime-native',
    pid: process.pid,
    cwd: process.cwd(),
    updatedAt: new Date().toISOString(),
  }));
  const env = { ...process.env, HOME: home };
  delete env.PI_DISH_SESSION_ID;
  const result = await execFileAsync(process.execPath, [cli, 'session'], { env });
  assert.equal(result.stdout.trim(), encodeSessionKey('prime', 'prime-native'));
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

  const env = { ...process.env, HOME: home };
  const res = await execFileAsync(process.execPath, [cli, 'attach', '--json'], { env });
  const entries = JSON.parse(res.stdout);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'refactor-auth');
  assert.equal(entries[0].socket, '/tmp/tmux-test');
  assert.equal(entries[0].pane, '%42');
});
