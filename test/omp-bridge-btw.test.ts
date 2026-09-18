import test = require('node:test');
import assert = require('node:assert/strict');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { record, records } from './test-types.js';
import type { BridgeRegistryEntry } from '../lib/contracts.js';
const sessionKey: typeof import('../lib/session-key.js') = require('../lib/session-key.js');

function decodeClaim(value: unknown): BridgeRegistryEntry {
  const claim = record(value);
  assert.ok(sessionKey.validSessionId(claim.sessionId));
  assert.ok(typeof claim.socketPath === 'string');
  return { ...claim, sessionId: claim.sessionId, socketPath: claim.socketPath };
}

const bridge: typeof import('../lib/bridge-session.js') = require('../lib/bridge-session.js');

const bunAvailable = spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0;

async function startFakeHost({ btwError = '', btwAnswer = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-btw-'));
  const home = path.join(root, 'home');
  const socketDir = path.join(root, 'sockets');
  const sessionFile = path.join(root, 'fake-omp.jsonl');
  const callFile = path.join(root, 'btw-call.json');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  const child = spawn('bun', [path.join(__dirname, 'fixtures', 'fake-omp-bridge-host.ts')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOME: home,
      // A fake host must not adopt (and rename) the tmux pane running the tests.
      TMUX: '',
      TMUX_PANE: '',
      PI_DISH_SOCKET_DIR: socketDir,
      FAKE_OMP_SESSION_FILE: sessionFile,
      FAKE_OMP_HAS_BTW: '1',
      FAKE_OMP_BTW_CALL: callFile,
      FAKE_OMP_BTW_ERROR: btwError,
      FAKE_OMP_BTW_ANSWER: btwAnswer,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    let stdout = '';
    const ready = (async (): Promise<void> => {
      for await (const chunk of child.stdout) {
        stdout += chunk;
        if (stdout.includes('READY')) return;
      }
      throw new Error(`fake host exited ${child.exitCode}: ${stderr}`);
    })();
    // The external Bun fixture exposes only its READY line; real time bounds a missing process signal.
    const timeout = new AbortController();
    try {
      await Promise.race([
        ready,
        delay(5000, undefined, { signal: timeout.signal }).then(() => { throw new Error(`fake host timeout: ${stderr}`); }),
      ]);
    } finally {
      timeout.abort();
    }
  } catch (error) {
    child.kill('SIGTERM');
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const registryDir = path.join(home, '.pi', 'dish', 'sessions');
  const registryName = fs.readdirSync(registryDir).find(name => name.endsWith('.json'));
  assert.ok(registryName);
  const parsedClaim: unknown = JSON.parse(fs.readFileSync(path.join(registryDir, registryName), 'utf8'));
  const claim = decodeClaim(parsedClaim);
  return {
    root, sessionFile, callFile, claim, child,
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        let closed = once(child, 'close');
        child.kill('SIGTERM');
        await Promise.race([closed, delay(3000)]);
        if (child.exitCode === null && child.signalCode === null) {
          closed = once(child, 'close');
          child.kill('SIGKILL');
          await closed;
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('OMP bridge /btw answers an ephemeral side question without touching the transcript', { skip: !bunAvailable }, async () => {
  const host = await startFakeHost({ btwAnswer: '42 — the ephemeral answer' });
  const session = new bridge.BridgeSession(host.claim);
  try {
    await session.connect();
    assert.equal(session.capabilities.btw, true, 'wrapper advertises the btw capability');

    const commandBody = record(await session.getCommands());
    const listed = records(commandBody.commands).find(command => command.name === 'btw');
    assert.ok(listed, 'btw is listed');
    assert.equal(listed.supported, true);

    const before = fs.readFileSync(host.sessionFile, 'utf8');
    const result = record(await session.runCommand('/btw what is the answer?', undefined, { timeout: 180000 }));
    assert.equal(result.answer, '42 — the ephemeral answer');

    const call: unknown = JSON.parse(fs.readFileSync(host.callFile, 'utf8'));
    const callRecord = record(call);
    assert.ok(typeof callRecord.promptText === 'string');
    assert.match(callRecord.promptText, /what is the answer\?/, 'question reaches the ephemeral turn');
    assert.match(callRecord.promptText, /Ephemeral side question/, 'OMP’s btw template wraps the question');

    assert.equal(fs.readFileSync(host.sessionFile, 'utf8'), before, 'side question never persists');
  } finally {
    session.close();
    await host.close();
  }
});

test('OMP bridge /btw requires a question and surfaces host failures', { skip: !bunAvailable }, async () => {
  const host = await startFakeHost({ btwError: 'no model configured' });
  const session = new bridge.BridgeSession(host.claim);
  try {
    await session.connect();
    await assert.rejects(session.runCommand('/btw', undefined, { timeout: 180000 }), /usage: \/btw <question>/);
    assert.ok(!fs.existsSync(host.callFile), 'a bare /btw never reaches the session');
    await assert.rejects(
      session.runCommand('/btw will this fail?', undefined, { timeout: 180000 }),
      /no model configured/,
    );
  } finally {
    session.close();
    await host.close();
  }
});

export {};
