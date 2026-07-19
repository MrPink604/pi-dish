/**
 * tmux-spawning tests for server.js + lib/tmux.js.
 *
 * Uses the real tmux (3.6b) against a throwaway server on a socket inside a
 * temp TMUX_TMPDIR (never the user's default server). A fixture stands in for
 * the `pi` binary (test/fixtures/fake-pi.js): tmux runs it, it reads
 * PI_DISH_SPAWN_TOKEN and writes a bridge-style registry entry carrying that
 * token — the same handshake the real bridge extension performs.
 *
 * HOME and TMUX_TMPDIR are pointed at temp dirs before server.js loads.
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Short temp dirs — Unix socket paths have a ~108 char limit.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-home-'));
const tmuxTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-tmux-'));
process.env.HOME = tmpHome;
process.env.TMUX_TMPDIR = tmuxTmp;
process.env.PORT = '0';

const TMUX_SOCKET = path.join(tmuxTmp, 's');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-pi.js');
// getPiLaunchSpec() reads this — run our fixture instead of a real `pi`.
process.env.PI_DISH_PI_COMMAND = `${process.execPath} ${FIXTURE}`;
// Force the headless-tmux dispatch: the temp HOME has no bridge extension
// installed, so auto-detection would (correctly) fall back to RPC children.
process.env.PI_DISH_HEADLESS = 'tmux';

let tmuxOk = true;
try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); } catch { tmuxOk = false; }

function tmuxCmd(args) {
  return execFileSync('tmux', ['-S', TMUX_SOCKET, ...args], { encoding: 'utf8' });
}

if (tmuxOk) {
  // A config-less server with one session named "work" to new-window into.
  execFileSync('tmux', ['-S', TMUX_SOCKET, '-f', '/dev/null', 'new-session', '-d', '-s', 'work'], { stdio: 'ignore' });
}

const server = require('../server.js');
const tmux = require('../lib/tmux');

let base;
test.before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  try { execFileSync('tmux', ['-S', TMUX_SOCKET, 'kill-server'], { stdio: 'ignore' }); } catch {}
  try { execFileSync('tmux', ['-S', path.join(tmuxTmp, 'pi-dish'), 'kill-server'], { stdio: 'ignore' }); } catch {}
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmuxTmp, { recursive: true, force: true }); } catch {}
});

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

test('GET /api/config reports tmux availability', async () => {
  const { body } = await get('/api/config');
  assert.equal(body.tmux, tmuxOk);
});

test('GET /api/tmux/targets lists the running server and its sessions', { skip: !tmuxOk }, async () => {
  const { status, body } = await get('/api/tmux/targets');
  assert.equal(status, 200);
  assert.equal(body.available, true);
  const srv = body.servers.find((s) => path.resolve(s.socket) === path.resolve(TMUX_SOCKET));
  assert.ok(srv, 'our tmux socket is listed');
  assert.ok(srv.sessions.some((s) => s.name === 'work'), 'the "work" session is listed');
});

test('POST /api/sessions/new with a tmux target spawns and returns the registered id', { skip: !tmuxOk }, async () => {
  const { status, body } = await post('/api/sessions/new', {
    model: 'anthropic/claude-opus-4',
    target: { type: 'tmux', socket: TMUX_SOCKET, tmuxSession: 'work' },
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.id, 'a session id is returned');

  // It shows up as an active session (bridge registry entry present). Poll a
  // few times to ride out the registry listing's sub-second memo.
  let active = false;
  for (let i = 0; i < 10 && !active; i++) {
    const list = await get('/api/sessions?active=1');
    active = list.body.active.some((s) => s.id === body.id);
    if (!active) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(active, 'spawned session is active');

  // The placement was persisted for later re-priming.
  const spawn = tmux.getSpawn(body.id);
  assert.ok(spawn, 'tmux-spawns.json has the mapping');
  assert.equal(path.resolve(spawn.socket), path.resolve(TMUX_SOCKET));
  assert.match(spawn.paneId, /^%\d+$/);

  // The spawn must not steal focus: "work" was created with one window
  // (index 0) and an attached user would be looking at it — the pi window
  // appears in the background (new-window -d).
  const current = tmuxCmd(['display-message', '-p', '-t', 'work:', '#{window_index}']).trim();
  assert.equal(current, '0', `session's current window unchanged (got ${current})`);
  const panes = tmuxCmd(['list-panes', '-s', '-t', 'work', '-F', '#{pane_id}']).trim().split('\n');
  assert.ok(panes.includes(spawn.paneId), 'pi pane exists in the session');
});

test('/reload falls back to send-keys into the owning tmux pane when the bridge cannot run it', { skip: !tmuxOk }, async () => {
  const { status, body } = await post('/api/sessions/new', {
    target: { type: 'tmux', socket: TMUX_SOCKET, tmuxSession: 'work' },
  });
  assert.equal(status, 200, JSON.stringify(body));
  const id = body.id;
  let sess = null;
  for (let i = 0; i < 10 && !sess; i++) {
    const list = await get('/api/sessions?active=1');
    sess = list.body.active.find((s) => s.id === id) || null;
    if (!sess) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(sess, 'spawned session is active');

  // fake-pi answers run_command like an old bridge (unknown command), so the
  // server must locate the pane from the recorded spawn placement and type
  // /reload into the TUI instead of surfacing the bridge error.
  const rel = await post(`/api/sessions/${id}/command`, { message: '/reload' });
  assert.equal(rel.status, 200, JSON.stringify(rel.body));
  assert.match(rel.body.info || '', /tmux pane/i);

  // fake-pi logs its stdin (what tmux send-keys typed) next to its JSONL.
  const reg = JSON.parse(fs.readFileSync(path.join(tmpHome, '.pi', 'dish', 'sessions', `${id}.json`), 'utf8'));
  let keys = '';
  for (let i = 0; i < 20; i++) {
    try { keys = fs.readFileSync(`${reg.sessionFile}.keys`, 'utf8'); } catch {}
    if (/\/reload/.test(keys)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.match(keys, /\/reload/, `send-keys /reload reached the pane (got: ${JSON.stringify(keys)})`);
});

test('POST /api/sessions/new rejects a socket outside the tmux tmpdir', { skip: !tmuxOk }, async () => {
  const { status, body } = await post('/api/sessions/new', {
    target: { type: 'tmux', socket: '/tmp/not-a-real-tmux.sock', tmuxSession: 'work' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /invalid tmux socket/i);
});

test('POST /api/sessions/:id/resume with a tmux target resumes into tmux', { skip: !tmuxOk }, async () => {
  // A historical session on disk to resume.
  const id = '2026-07-09T09-00-00-resume01';
  const dir = path.join(tmpHome, '.pi', 'agent', 'sessions', 'resumeproj');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ type: 'session', cwd: tmpHome }) + '\n');

  const { status, body } = await post(`/api/sessions/${id}/resume`, {
    target: { type: 'tmux', socket: TMUX_SOCKET, tmuxSession: 'work' },
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.id, id, 'resume keeps the original session id');
  assert.ok(tmux.getSpawn(id), 'resume placement persisted');
});

// --- Durable headless sessions: no target → hidden tmux session -------------

test('POST /api/sessions/new with no target spawns into the hidden headless tmux session', { skip: !tmuxOk }, async () => {
  const { status, body } = await post('/api/sessions/new', { model: 'anthropic/claude-opus-4' });
  assert.equal(status, 200, JSON.stringify(body));

  const spawn = tmux.getSpawn(body.id);
  assert.ok(spawn, 'placement persisted like any tmux spawn');
  assert.equal(path.basename(spawn.socket), 'pi-dish', 'lands on the dedicated pi-dish socket');
  const loc = await tmux.paneLocation(spawn.socket, spawn.paneId);
  assert.equal(loc.tmuxSession, 'headless', 'pane lives in the hidden headless session');

  // The property the feature exists for: pi is not a child of this server
  // process, so a server restart can't take it down. (An RPC child's ppid
  // would be ours; a tmux pane's is the tmux server's.)
  const entry = JSON.parse(fs.readFileSync(path.join(tmpHome, '.pi', 'dish', 'sessions', `${body.id}.json`), 'utf8'));
  const stat = fs.readFileSync(`/proc/${entry.pid}/stat`, 'utf8');
  const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  assert.notEqual(ppid, process.pid, 'spawned pi is not a child of the pi-dish server');
});

test('a second headless spawn reuses the hidden session as a new window', { skip: !tmuxOk }, async () => {
  const { status, body } = await post('/api/sessions/new', {});
  assert.equal(status, 200, JSON.stringify(body));
  const socket = tmux.getSpawn(body.id).socket;
  const sessions = execFileSync('tmux', ['-S', socket, 'list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.deepEqual(sessions, ['headless'], 'still exactly one hidden session');
  const panes = execFileSync('tmux', ['-S', socket, 'list-panes', '-s', '-t', 'headless', '-F', '#{pane_id}'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.ok(panes.length >= 2, `both headless spawns share the session (got ${panes.length} panes)`);
});

test('POST /api/sessions/new times out (window left open) when pi never registers', { skip: !tmuxOk }, async () => {
  process.env.PI_DISH_SPAWN_TIMEOUT_MS = '2500';
  process.env.PI_DISH_PI_COMMAND = `env PI_FIXTURE_NOREGISTER=1 ${process.execPath} ${FIXTURE}`;
  const before = tmuxCmd(['list-windows', '-t', 'work']).split('\n').filter(Boolean).length;
  try {
    const { status, body } = await post('/api/sessions/new', {
      target: { type: 'tmux', socket: TMUX_SOCKET, tmuxSession: 'work' },
    });
    assert.equal(status, 500);
    assert.match(body.error, /pi-dish-bridge/);
    const after = tmuxCmd(['list-windows', '-t', 'work']).split('\n').filter(Boolean).length;
    assert.ok(after > before, 'the tmux window was left open for inspection');
  } finally {
    delete process.env.PI_DISH_SPAWN_TIMEOUT_MS;
    process.env.PI_DISH_PI_COMMAND = `${process.execPath} ${FIXTURE}`;
  }
});

test('findPaneByPid locates a pane by process ancestry', { skip: !tmuxOk }, async () => {
  // A window whose root process is a shell with a sleeping child: the direct
  // pane_pid must match, and so must a descendant (the registered pi is
  // usually a child/grandchild of the pane's shell).
  // The trailing `:` stops sh exec-optimizing the single command — sleep must
  // stay a *child* of the pane's sh for the ancestry-walk assertion below.
  const paneId = tmuxCmd(['new-window', '-d', '-t', 'work', '-P', '-F', '#{pane_id}', '--', 'sh', '-c', 'sleep 30; :']).trim();
  const panePid = Number(tmuxCmd(['display-message', '-p', '-t', paneId, '#{pane_pid}']).trim());
  assert.ok(panePid, 'spawned pane has a root pid');

  const direct = await tmux.findPaneByPid(panePid);
  assert.equal(direct?.paneId, paneId);
  assert.equal(direct?.tmuxSession, 'work');

  // Find the sleep child of the pane's sh and resolve from it (ancestry walk).
  let childPid = null;
  for (let i = 0; i < 20 && !childPid; i++) {
    try {
      childPid = Number(execFileSync('pgrep', ['-P', String(panePid)], { encoding: 'utf8' }).trim().split('\n')[0]) || null;
    } catch { /* child not up yet */ }
    if (!childPid) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(childPid, 'the sleep child exists');
  const viaChild = await tmux.findPaneByPid(childPid);
  assert.equal(viaChild?.paneId, paneId, 'a descendant pid resolves to the same pane');

  // A pid outside any pane on this tmpdir's servers finds nothing.
  assert.equal(await tmux.findPaneByPid(1), null);
});

test('runtime location is cached per pid: a rename shows the old name within TTL', { skip: !tmuxOk }, async () => {
  // A dedicated tmux session whose pane shell becomes the registered pi pid —
  // no tmux stamp on the registry entry, so resolution goes through the
  // pid-ancestry scan (the expensive path the cache exists for).
  tmuxCmd(['new-session', '-d', '-s', 'cachesrc']);
  const panePid = Number(tmuxCmd(['display-message', '-p', '-t', 'cachesrc:0', '#{pane_pid}']).trim());

  const CACHE_ID = '2026-07-16T00-00-00-runcache1';
  const sdir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--x--');
  fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(path.join(sdir, `${CACHE_ID}.jsonl`),
    JSON.stringify({ type: 'session', cwd: '/tmp', timestamp: '2026-07-16T00:00:00.000Z' }) + '\n');
  const regDir = path.join(tmpHome, '.pi', 'dish', 'sessions');
  fs.mkdirSync(regDir, { recursive: true });
  const sockStub = path.join(tmpHome, 'runtime-sock-stub');
  fs.writeFileSync(sockStub, ''); // prune only checks existence, never connects
  fs.writeFileSync(path.join(regDir, `${CACHE_ID}.json`),
    JSON.stringify({ sessionId: CACHE_ID, socketPath: sockStub, pid: panePid, cwd: '/tmp' }));
  await new Promise((r) => setTimeout(r, 600)); // registry scan memo TTL

  try {
    const first = await get(`/api/sessions/${CACHE_ID}/stats`);
    assert.equal(first.status, 200);
    assert.equal(first.body.runtime.kind, 'tmux');
    assert.equal(first.body.runtime.tmuxSession, 'cachesrc', 'pid scan finds the pane');

    // Structural cache proof: rename the tmux session, ask again — a live
    // lookup would see the new name, so the old one must have come from the
    // (sessionId, pid) cache.
    tmuxCmd(['rename-session', '-t', 'cachesrc', 'cachedst']);
    const second = await get(`/api/sessions/${CACHE_ID}/stats`);
    assert.equal(second.body.runtime.tmuxSession, 'cachesrc', 'served from cache, not re-resolved');
  } finally {
    try { tmuxCmd(['kill-session', '-t', 'cachedst']); } catch {}
    try { tmuxCmd(['kill-session', '-t', 'cachesrc']); } catch {}
    fs.rmSync(path.join(regDir, `${CACHE_ID}.json`), { force: true });
  }
});

test('attachPaneArgv builds a grouped viewer; getPrefixKey reads the server prefix', { skip: !tmuxOk }, async () => {
  const paneId = tmuxCmd(['list-panes', '-t', 'work:0', '-F', '#{pane_id}']).trim().split('\n')[0];
  const argv = await tmux.attachPaneArgv(TMUX_SOCKET, paneId);
  assert.equal(argv[0], 'tmux');
  assert.ok(argv.includes('new-session'), 'creates a session (grouped), never a bare attach');
  const t = argv.indexOf('-t');
  assert.equal(argv[t + 1], '=work', 'grouped with the owning session, exact-matched');
  assert.ok(argv.includes('destroy-unattached'), 'viewer session dies with its client');
  assert.ok(argv.filter((a) => a === paneId).length >= 2, 'selects the pi window and pane');

  assert.equal(await tmux.getPrefixKey(TMUX_SOCKET), 'C-b', 'config-less server default prefix');
  assert.equal(await tmux.attachPaneArgv(TMUX_SOCKET, '%9999'), null, 'gone pane yields null');
});

test('tmux-spawns.json persistence and prune', async () => {
  // Persist two mappings; one is "registered", one has a dead pane.
  tmux.recordSpawn('kept-session', { socket: TMUX_SOCKET, paneId: '%999' });
  tmux.recordSpawn('gone-session', { socket: '/tmp/dead-tmux.sock', paneId: '%998' });
  assert.ok(tmux.getSpawn('kept-session'), 'mapping is readable back');

  await tmux.pruneSpawns(new Set(['kept-session']));
  assert.ok(tmux.getSpawn('kept-session'), 'registered session kept even with a bogus pane');
  assert.equal(tmux.getSpawn('gone-session'), null, 'unregistered dead-pane mapping pruned');
});
