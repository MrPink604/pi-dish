const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sanitizeTestEnv, applyTestEnv } = require('./test-env');

// This is the harness defending itself: `npm test` runs from the operator's
// own shell, where the wrapper has exported the live deployment. Every var
// below, inherited, breaks suites in ways that look like product bugs.
const OPERATOR_ENV = {
  HOME: '/home/operator',
  PATH: '/usr/bin',
  HOST: '100.70.163.97',        // binds the test server off-loopback
  PORT: '3333',                 // fights the running deployment
  PI_DISH_SHARE_PORT: '3334',   // EADDRINUSE on the share listener
  PI_DISH_SHARE_HOST: '127.0.0.1',
  PI_DISH_SHARE_BASE_URL: 'https://share.example.dev',
  PI_DISH_URL: 'http://100.70.163.97:3333',
  PI_DISH_TOKEN: 'operator-token',
  PI_DISH_TERMINAL: '1',
  PI_DISH_SOCKET_DIR: '',
  PI_DISH_SPAWN_TOKEN: 'deadbeef',
  PI_DISH_INDEX_SYNC_BUDGET: '0',
  PI_DISH_ENV_FILE: '/home/operator/.config/pi-dish/env',
  PI_DISH_PI_COMMAND: '/usr/local/bin/pi',
  PI_DISH_SKIP_INTEGRATION: '1',
};

test('sanitizeTestEnv pins the bind target and drops the operator deployment', () => {
  const env = sanitizeTestEnv(OPERATOR_ENV);

  assert.equal(env.HOST, '127.0.0.1', 'a test listener is loopback-only');
  assert.equal(env.PORT, '0', 'and never contends for the deployment port');
  for (const key of [
    'PI_DISH_SHARE_PORT', 'PI_DISH_SHARE_HOST', 'PI_DISH_SHARE_BASE_URL',
    'PI_DISH_URL', 'PI_DISH_TOKEN', 'PI_DISH_TERMINAL', 'PI_DISH_SOCKET_DIR',
    'PI_DISH_SPAWN_TOKEN', 'PI_DISH_INDEX_SYNC_BUDGET', 'PI_DISH_ENV_FILE',
  ]) {
    assert.equal(key in env, false, `${key} must not reach a suite`);
  }

  // Host tooling and opt-outs are how a run is *configured*, not retargeted.
  assert.equal(env.PI_DISH_PI_COMMAND, '/usr/local/bin/pi');
  assert.equal(env.PI_DISH_SKIP_INTEGRATION, '1');
  assert.equal(env.HOME, '/home/operator', 'unrelated variables pass through');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(OPERATOR_ENV.HOST, '100.70.163.97', 'the input env is not mutated');
});

test('sanitizeTestEnv puts a user-installed bun on PATH, but never replaces one', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-testenv-'));
  const bunBin = path.join(home, '.bun', 'bin');
  fs.mkdirSync(bunBin, { recursive: true });
  fs.writeFileSync(path.join(bunBin, 'bun'), '#!/bin/sh\n', { mode: 0o755 });
  try {
    // The OMP bridge suites spawn `bun`; a non-login shell has no ~/.bun/bin.
    const added = sanitizeTestEnv({ ...OPERATOR_ENV, HOME: home });
    assert.deepEqual(added.PATH.split(path.delimiter), [bunBin, '/usr/bin']);

    const already = path.join(home, 'other-bin');
    fs.mkdirSync(already);
    fs.writeFileSync(path.join(already, 'bun'), '#!/bin/sh\n', { mode: 0o755 });
    const untouched = sanitizeTestEnv({ ...OPERATOR_ENV, HOME: home, PATH: already });
    assert.equal(untouched.PATH, already, 'a bun already on PATH wins');

    assert.equal(sanitizeTestEnv(OPERATOR_ENV).PATH, '/usr/bin', 'no bun installed, no PATH change');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('applyTestEnv sanitizes this process in place', () => {
  const saved = { ...process.env };
  try {
    process.env.PI_DISH_SHARE_PORT = '3334';
    process.env.HOST = '100.70.163.97';
    applyTestEnv();
    assert.equal('PI_DISH_SHARE_PORT' in process.env, false);
    assert.equal(process.env.HOST, '127.0.0.1');
    assert.equal(process.env.PORT, '0');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
