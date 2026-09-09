const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { sanitizeTestEnv } = require('./test-env');

async function bind(t, host = '127.0.0.1', port = 0) {
  const server = net.createServer(socket => socket.end());
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

async function alternateLoopback(t) {
  try {
    const probe = await bind(t, '127.0.0.2');
    await new Promise(resolve => probe.close(resolve));
    return true;
  } catch (error) {
    if (!['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error.code)) throw error;
    t.skip('this OS does not provide the alternate loopback address 127.0.0.2');
    return false;
  }
}

function boot(t, overrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-listener-'));
  fs.mkdirSync(path.join(home, 'tmux'));
  const child = fork(path.join(__dirname, 'fixtures/listener-server.js'), [], {
    env: { ...sanitizeTestEnv(), HOME: home, TMUX_TMPDIR: path.join(home, 'tmux'),
      PI_DISH_OMP_COMMAND: `${process.execPath} ${path.join(__dirname, 'fixtures/fake-omp-export.js')}`,
      ...overrides },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const events = [];
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  child.on('message', event => events.push(event));
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.kill('SIGTERM');
      await exited;
      clearTimeout(timer);
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const wait = async (predicate, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const event = events.find(predicate);
      if (event) return event;
      assert.equal(child.exitCode, null, `server exited before expected event:\n${output}`);
      assert.equal(child.signalCode, null, `server was killed before expected event:\n${output}`);
      await delay(20);
    }
    assert.fail(`listener event timed out:\n${output}`);
  };
  return { child, exited, events, wait, output: () => output };
}

async function descriptor(host, port) {
  const response = await fetch(`http://${host}:${port}/api/host`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  return response.json();
}

async function stopAndRebind(t, server, signal, listeners) {
  server.child.kill(signal);
  assert.deepEqual(await server.exited, { code: signal === 'SIGINT' ? 130 : 143, signal: null });
  for (const listener of listeners) await bind(t, listener.address.address, listener.address.port);
}

test('ephemeral loopback startup advertises its actual port and releases it on SIGTERM', { timeout: 15000 }, async t => {
  const server = boot(t);
  const main = await server.wait(event => event.type === 'listening');
  assert.equal(main.address.address, '127.0.0.1');
  assert.equal(main.advertised, `http://127.0.0.1:${main.address.port}`);
  assert.ok((await descriptor('127.0.0.1', main.address.port)).hostId);
  assert.equal(server.events.filter(event => event.type === 'listening').length, 1);
  await stopAndRebind(t, server, 'SIGTERM', [main]);
});

test('specific-host ephemeral startup shares a port with its loopback alias and releases both on SIGINT', { timeout: 15000 }, async t => {
  if (!await alternateLoopback(t)) return;
  const server = boot(t, { HOST: '127.0.0.2' });
  const main = await server.wait(event => event.address?.address === '127.0.0.2');
  const alias = await server.wait(event => event.address?.address === '127.0.0.1');
  assert.equal(alias.address.port, main.address.port);
  assert.ok([`http://127.0.0.2:${main.address.port}`, `http://127.0.0.1:${main.address.port}`].includes(main.advertised));
  assert.equal(alias.advertised, `http://127.0.0.1:${main.address.port}`);
  const primary = await descriptor('127.0.0.2', main.address.port);
  assert.equal((await descriptor('127.0.0.1', main.address.port)).hostId, primary.hostId);
  await stopAndRebind(t, server, 'SIGINT', [main, alias]);
});

test('loopback stays usable while a missing interface waits for the real bind retry', { timeout: 30000 }, async t => {
  if (!await alternateLoopback(t)) return;
  const reservation = await bind(t);
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = boot(t, { HOST: '127.0.0.2', PORT: String(port), PI_DISH_TEST_BIND_FAIL_ONCE: '1' });
  await server.wait(event => event.type === 'bind-failed');
  const alias = await server.wait(event => event.address?.address === '127.0.0.1');
  const before = await descriptor('127.0.0.1', port);
  assert.equal(server.events.some(event => event.address?.address === '127.0.0.2'), false);
  assert.match(server.output(), /not assigned yet; retrying/);
  const main = await server.wait(event => event.address?.address === '127.0.0.2', 20000);
  assert.equal(main.address.port, port);
  assert.equal(main.advertised, `http://127.0.0.1:${port}`);
  assert.equal((await descriptor('127.0.0.2', port)).hostId, before.hostId);
  assert.equal((await descriptor('127.0.0.1', port)).hostId, before.hostId);
  assert.equal(server.events.filter(event => event.address?.address === '127.0.0.1').length, 1);
  await stopAndRebind(t, server, 'SIGTERM', [main, alias]);
});

for (const explicitUrl of ['', 'https://fixture.invalid/dish']) {
  test(`a delayed alias advertises ${explicitUrl ? 'the explicit URL unchanged' : 'only an address already listening'}`, { timeout: 15000 }, async t => {
    if (!await alternateLoopback(t)) return;
    const server = boot(t, { HOST: '127.0.0.2', PI_DISH_TEST_HOLD_ALIAS: '1', PI_DISH_URL: explicitUrl });
    await server.wait(event => event.type === 'alias-held');
    const main = await server.wait(event => event.address?.address === '127.0.0.2');
    assert.equal(main.advertised, explicitUrl || `http://127.0.0.2:${main.address.port}`);
    assert.equal(server.events.some(event => event.address?.address === '127.0.0.1'), false);
    assert.ok((await descriptor('127.0.0.2', main.address.port)).hostId);
    server.child.send({ releaseAlias: true });
    const alias = await server.wait(event => event.address?.address === '127.0.0.1');
    assert.equal(alias.advertised, explicitUrl || `http://127.0.0.1:${main.address.port}`);
    assert.ok((await descriptor('127.0.0.1', main.address.port)).hostId);
    await stopAndRebind(t, server, 'SIGTERM', [main, alias]);
  });
}

test('an alias failure after primary startup keeps advertising the reachable primary', { timeout: 15000 }, async t => {
  if (!await alternateLoopback(t)) return;
  const server = boot(t, { HOST: '127.0.0.2', PI_DISH_TEST_HOLD_ALIAS: '1' });
  await server.wait(event => event.type === 'alias-held');
  const main = await server.wait(event => event.address?.address === '127.0.0.2');
  const occupied = await bind(t, '127.0.0.1', main.address.port);
  server.child.send({ releaseAlias: true });
  const failed = await server.wait(event => event.type === 'listen-error');
  assert.equal(failed.code, 'EADDRINUSE');
  assert.equal(failed.advertised, `http://127.0.0.2:${main.address.port}`);
  assert.ok((await descriptor('127.0.0.2', main.address.port)).hostId);
  await stopAndRebind(t, server, 'SIGTERM', [main]);
  assert.equal(occupied.listening, true);
});

test('a port collision exits with a useful error instead of retrying indefinitely', { timeout: 15000 }, async t => {
  const occupied = await bind(t);
  const server = boot(t, { PORT: String(occupied.address().port) });
  assert.deepEqual(await server.exited, { code: 1, signal: null });
  assert.match(server.output(), /cannot listen.*EADDRINUSE/);
  assert.doesNotMatch(server.output(), /retrying/);
  assert.equal(occupied.listening, true);
});

test('a failed loopback alias leaves the primary usable and advertises the primary address', { timeout: 15000 }, async t => {
  if (!await alternateLoopback(t)) return;
  const occupied = await bind(t);
  const port = occupied.address().port;
  const server = boot(t, { HOST: '127.0.0.2', PORT: String(port) });
  const main = await server.wait(event => event.address?.address === '127.0.0.2');
  assert.match(server.output(), /loopback alias not listening.*EADDRINUSE/);
  assert.equal(main.advertised, `http://127.0.0.2:${port}`);
  assert.ok((await descriptor('127.0.0.2', port)).hostId);
  await stopAndRebind(t, server, 'SIGTERM', [main]);
  assert.equal(occupied.listening, true);
});

test('startup preserves an explicit advertised URL', { timeout: 15000 }, async t => {
  const server = boot(t, { PI_DISH_URL: 'https://fixture.invalid/dish' });
  const main = await server.wait(event => event.type === 'listening');
  assert.equal(main.advertised, 'https://fixture.invalid/dish');
  assert.ok((await descriptor('127.0.0.1', main.address.port)).hostId);
});
