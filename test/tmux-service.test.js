'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MANAGER = path.join(ROOT, 'scripts', 'pi-dish-tmux.sh');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function freePort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// The scripts locate their root from their own path and the manager kills every
// matching process under it, so the fixture copies them into a throwaway root:
// a test must never reap the developer's own server. `server.js` there is a
// stub that idles, which is all the supervisor and the /proc scan care about.
function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-service-'));
  t.after(() => {
    spawnSync(path.join(root, 'scripts', 'pi-dish-tmux.sh'), ['stop'], { env: fixtureEnv(root, 0) });
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'bin'));
  for (const script of ['pi-dish-tmux.sh', 'supervise-tailnet.sh', 'run-tailnet.sh']) {
    fs.copyFileSync(path.join(ROOT, 'scripts', script), path.join(root, 'scripts', script));
    fs.chmodSync(path.join(root, 'scripts', script), 0o755);
  }
  fs.writeFileSync(path.join(root, 'server.js'),
    `require('fs').writeFileSync(${JSON.stringify(path.join(root, 'started'))}, String(process.pid));\n`
    + 'setInterval(() => {}, 1000);\n');
  // tmux and curl are stubbed: the duplicate-instance guards under test are
  // process-level, and a real tmux server would outlive the temp root.
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin', 'curl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  return root;
}

function fixtureEnv(root, port) {
  return {
    ...process.env,
    PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
    // Never source the operator's env file - it would override HOST/PORT.
    PI_DISH_ENV_FILE: path.join(root, 'no-such-env'),
    XDG_RUNTIME_DIR: root,
    HOST: '127.0.0.1',
    PORT: String(port),
    PI_DISH_RESTART_DELAY: '1',
  };
}

test('a second supervisor on the same endpoint exits instead of looping', async t => {
  const root = fixtureRoot(t);
  const port = await freePort();
  const env = fixtureEnv(root, port);

  const first = spawn(path.join(root, 'scripts', 'supervise-tailnet.sh'), { env, stdio: 'ignore' });
  t.after(() => { try { process.kill(-first.pid, 'SIGKILL'); } catch {} first.kill('SIGKILL'); });
  await waitFor(() => fs.existsSync(path.join(root, 'started')), 'first server start');

  const second = spawnSync(path.join(root, 'scripts', 'supervise-tailnet.sh'),
    { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(second.status, 3, second.stderr);
  assert.match(second.stderr, /already served by another pi-dish/);
  assert.match(second.stderr, /supervisor exiting/);
  // The loser must not have restarted, and the winner must be untouched.
  assert.ok(!/restarting in/.test(second.stderr), second.stderr);
  assert.equal(alive(Number(fs.readFileSync(path.join(root, 'started'), 'utf8'))), true);
});

test('stop reaps the supervisor, not just the server it respawns', async t => {
  const root = fixtureRoot(t);
  const port = await freePort();
  const env = fixtureEnv(root, port);

  const supervisor = spawn(path.join(root, 'scripts', 'supervise-tailnet.sh'), { env, stdio: 'ignore' });
  await waitFor(() => fs.existsSync(path.join(root, 'started')), 'server start');
  const serverPid = Number(fs.readFileSync(path.join(root, 'started'), 'utf8'));

  const stop = spawnSync(path.join(root, 'scripts', 'pi-dish-tmux.sh'), ['stop'],
    { cwd: root, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(stop.status, 0, stop.stderr);
  await waitFor(() => !alive(supervisor.pid) && !alive(serverPid), 'supervisor and server exit');

  // Nothing respawned in the window a live supervisor would have used.
  fs.rmSync(path.join(root, 'started'));
  await delay(1500);
  assert.equal(fs.existsSync(path.join(root, 'started')), false);
});

test('tmux service manager ignores the caller tmux socket', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-tmux-service-'));
  const bin = path.join(temp, 'bin');
  const log = path.join(temp, 'tmux-env.log');
  fs.mkdirSync(bin);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\nif [ "\${TMUX+x}" = x ]; then\n  printf 'set:%s\\n' "$TMUX" >> "$TMUX_LOG"\nelse\n  printf 'unset\\n' >> "$TMUX_LOG"\nfi\nexit 0\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const result = spawnSync(MANAGER, ['status'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMUX: '/tmp/tmux-1000/other,123,0',
      TMUX_LOG: log,
      HOST: '127.0.0.1',
      PORT: '3333',
      PI_DISH_TMUX_SESSION: 'test-service',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['unset']);
});
