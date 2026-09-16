const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const cli = path.join(__dirname, '../skills/pi-dish-sessions/scripts/pi-dish-sessions.js');
const client = path.join(__dirname, '../skills/lib/pi-dish-client.js');

function fixture(t, entry) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-skill-ingress-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const registry = path.join(home, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registry, { recursive: true });
  if (entry) fs.writeFileSync(path.join(registry, 'entry.json'), JSON.stringify(entry));
  return {
    home,
    env: { ...process.env, HOME: home, PI_DISH_SESSION_ID: '', PI_DISH_TOKEN: '', PI_DISH_URL: '', TMUX: '', TMUX_PANE: '' },
  };
}

test('ancestor discovery retains truthy identities despite unused malformed metadata', async t => {
  const { env } = fixture(t, {
    sessionId: 42, pid: process.pid, name: { unexpected: true }, model: 17, cwd: 23,
  });
  const { stdout } = await run(process.execPath, [cli, 'session', '--json'], { env });
  assert.equal(JSON.parse(stdout), 42);
});

test('cwd discovery still exposes the native path error when malformed cwd is consumed', async t => {
  const { env } = fixture(t, { sessionId: 'cwd-only', cwd: 23 });
  const { stdout } = await run(process.execPath, ['-e', `
    const client = require(process.argv[1]);
    try {
      client.discoverSession();
      process.exitCode = 2;
    } catch (error) {
      process.stdout.write(JSON.stringify({ name: error.name, code: error.code }));
    }
  `, client], { env });
  assert.deepEqual(JSON.parse(stdout), { name: 'TypeError', code: 'ERR_INVALID_ARG_TYPE' });
});

test('attach JSON retains metadata that only interactive name matching needs to interpret', async t => {
  const { home, env } = fixture(t);
  const entry = {
    sessionId: 'attach-entry', pid: process.pid, name: 17, model: { id: 'opaque-model' }, cwd: home,
    tmux: { socket: path.join(home, 'absent-tmux.sock'), pane: '%1' },
  };
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'sessions', 'entry.json'), JSON.stringify(entry));
  const { stdout } = await run(process.execPath, [cli, 'attach', '--json'], { env });
  const [attached] = JSON.parse(stdout);
  assert.equal(attached.sessionId, 'attach-entry');
  assert.equal(attached.name, 17);
  assert.deepEqual(attached.model, { id: 'opaque-model' });
});

test('fleet name resolution retains malformed labels but label matching still fails on them', async t => {
  const { env } = fixture(t);
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/hosts') {
      res.end(JSON.stringify({ hosts: [{
        name: 'peer', label: 17, hostId: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', reachable: true,
        capabilities: { resolve: true, refAliases: true },
      }] }));
      return;
    }
    if (req.url === '/hosts/peer/api/sessions/resolve?id=peer-session') {
      res.end(JSON.stringify({ session: { id: 'peer-session', name: 'Peer' } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Session not found' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { stdout } = await run(process.execPath, [cli, 'resolve', 'peer/peer-session', '--url', base, '--json'], { env });
  const resolved = JSON.parse(stdout);
  assert.equal(resolved.host, 'peer');
  assert.equal(resolved.id, 'peer-session');
  await assert.rejects(
    run(process.execPath, [cli, 'resolve', 'unknown/peer-session', '--url', base], { env }),
    error => error.code === 1 && /toLowerCase is not a function/.test(error.stderr),
  );
});
