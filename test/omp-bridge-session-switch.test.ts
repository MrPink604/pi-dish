import test = require('node:test');
import { errorMessage, record } from './test-types.js';
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { spawn, spawnSync } from 'node:child_process';

const { BridgeSession }: typeof import('../lib/bridge-session') = require('../lib/bridge-session')

const bunAvailable = spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0;
const fixture = path.join(__dirname, 'fixtures', 'fake-session-switch-host.ts');
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function waitFor<T>(read: () => T | null | undefined | false, label: string, timeout = 5000): Promise<T> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = read();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${errorMessage(lastError)}` : ''}`);
}

async function startHost(profile: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pi-dish-switch-${profile}-`));
  const home = path.join(root, 'home');
  const oldFile = path.join(root, 'sessions', 'old-session.jsonl');
  const newFile = path.join(root, 'sessions', 'new-session.jsonl');
  const marker = path.join(root, 'switches.log');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(marker, '');
  const child = spawn('bun', [fixture], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      HOME: home,
      // See omp-tree-bridge.test.js: a fake host must not adopt (and rename)
      // the tmux pane running the tests.
      TMUX: '',
      TMUX_PANE: '',
      PI_DISH_SOCKET_DIR: path.join(root, 'sockets'),
      FAKE_SWITCH_PROFILE: profile,
      FAKE_SWITCH_OLD_FILE: oldFile,
      FAKE_SWITCH_NEW_FILE: newFile,
      FAKE_SWITCH_MARKER: marker,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await waitFor(() => {
      if (child.exitCode !== null) throw new Error(`host exited ${child.exitCode}: ${stderr}`);
      return stdout.includes('READY');
    }, 'fake host readiness');
    const registryDir = path.join(home, '.pi', 'dish', 'sessions');
    const registryPath = await waitFor(() => {
      const name = fs.readdirSync(registryDir).find(file => file.endsWith('.json'));
      return name && path.join(registryDir, name);
    }, 'registry entry');
    const claim = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const session = new BridgeSession(claim);
    await session.connect();
    return {
      root, oldFile, newFile, marker, child, registryPath, claim, session,
      async stop() {
        session.close();
        if (child.exitCode === null) child.kill('SIGTERM');
        await Promise.race([
          new Promise<void>(resolve => child.once('exit', () => resolve())),
          delay(2000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); }),
        ]);
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test('OMP bridge adopts session_switch identity in place and suppresses same-id reloads', { skip: !bunAvailable }, async () => {
  const host = await startHost('omp');
  const events: unknown[] = [];
  host.session.on('session_switch', (data: unknown) => events.push(data));
  try {
    host.child.kill('SIGUSR1');
    const updated = await waitFor(() => {
      const entry = record(JSON.parse(fs.readFileSync(host.registryPath, 'utf8')));
      return entry.nativeSessionId === 'new-session' && entry;
    }, 'rewritten OMP registry identity');
    await waitFor(() => events.length === 1, 'session_switch wire event');

    assert.equal(updated.sessionFile, host.newFile);
    assert.equal(updated.cwd, '/workspace/new');
    assert.equal(updated.socketPath, host.claim.socketPath, 'socket stays instance-keyed');
    assert.equal(updated.bridgeInstanceId, host.claim.bridgeInstanceId, 'registry claim stays instance-keyed');
    assert.equal(host.session.registryClaim.nativeSessionId, 'new-session', 'connected client adopts the rewritten claim');
    assert.equal(host.session.registryClaim.sessionFile, host.newFile);
    assert.equal(fs.existsSync(host.newFile), false, 'the bridge does not synthesize a fresh OMP JSONL');
    assert.deepEqual(events[0], {
      sessionId: 'new-session',
      sessionFile: host.newFile,
      previousSessionId: 'old-session',
      previousSessionFile: host.oldFile,
      cwd: '/workspace/new',
      reason: 'new',
    });

    // Re-emitting the current file (OMP reload behavior) may refresh mutable
    // registry fields but must not bounce connected clients.
    host.child.kill('SIGUSR1');
    await waitFor(() => fs.readFileSync(host.marker, 'utf8').trim().split('\n').length === 2, 'same-id switch completion');
    await delay(100);
    assert.equal(events.length, 1);
  } finally {
    await host.stop();
  }
});

test('Pi descriptor does not subscribe to preserved-runner session_switch events', { skip: !bunAvailable }, async () => {
  const host = await startHost('pi');
  const events: unknown[] = [];
  host.session.on('session_switch', (data: unknown) => events.push(data));
  try {
    host.child.kill('SIGUSR1');
    await waitFor(() => fs.readFileSync(host.marker, 'utf8').includes('new'), 'fake Pi switch completion');
    await delay(100);
    const unchanged = record(JSON.parse(fs.readFileSync(host.registryPath, 'utf8')));
    assert.equal(unchanged.nativeSessionId, 'old-session');
    assert.equal(unchanged.sessionFile, host.oldFile);
    assert.equal(events.length, 0);
  } finally {
    await host.stop();
  }
});

export {};
