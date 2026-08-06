const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

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
});
