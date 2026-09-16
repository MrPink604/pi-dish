const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { sanitizeTestEnv } = require('./test-env');

const execute = promisify(execFile);

test('native unknown-host guards retain Prime duplicate token adoption', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-native-boundary-'));
  const env = sanitizeTestEnv({ PATH: process.env.PATH, HOME: root, TMUX: '', TMUX_PANE: '' });
  env.PI_DISH_SOCKET_DIR = path.join(root, 'sockets');
  const prime = pathToFileURL(path.resolve(__dirname, '../extensions/pi-dish-bridge-prime/index.ts')).href;
  const native = pathToFileURL(path.resolve(__dirname, '../extensions/pi-dish-bridge-omp/native-state.ts')).href;
  const program = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { createHarnessBridge } from ${JSON.stringify(prime)};
    import { patchOmpAgentSession, getOmpNativeCaptureStats } from ${JSON.stringify(native)};
    const before = getOmpNativeCaptureStats();
    for (const malformed of [null, 1, {}, { prototype: {} }, () => {}]) patchOmpAgentSession(malformed);
    assert.deepEqual(getOmpNativeCaptureStats(), before);
    const load = createHarnessBridge();
    for (const malformed of [null, {}, { on: true, registerCommand() {} }, { on() {} }]) {
      assert.throws(() => load(malformed), /host with on and registerCommand/);
    }
    const handlers = new Map();
    const host = {
      on(name, handler) { handlers.set(name, handler); },
      registerCommand() {},
      getThinkingLevel() { return 'max'; },
    };
    load(host);
    let duplicateRegistered = false;
    createHarnessBridge('native-token')({
      on() { duplicateRegistered = true; },
      registerCommand() { duplicateRegistered = true; },
    });
    assert.equal(duplicateRegistered, false);
    const file = path.join(process.env.HOME, 'prime-session.jsonl');
    fs.writeFileSync(file, JSON.stringify({ type: 'session', id: 'prime-session', cwd: process.env.HOME }) + '\\n');
    const ctx = {
      cwd: process.env.HOME, ui: {},
      sessionManager: { getSessionFile() { return file; }, getSessionName() { return 'native boundary'; } },
    };
    try {
      await handlers.get('session_start')({}, ctx);
      const registry = path.join(process.env.HOME, '.pi', 'dish', 'sessions');
      const deadline = Date.now() + 3000;
      while (!fs.readdirSync(registry).some(name => name.endsWith('.json'))) {
        if (Date.now() > deadline) throw new Error('bridge did not publish its bound socket');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const files = fs.readdirSync(registry).filter(name => name.endsWith('.json'));
      assert.equal(files.length, 1);
      const claim = JSON.parse(fs.readFileSync(path.join(registry, files[0]), 'utf8'));
      assert.equal(claim.spawnToken, 'native-token');
      assert.equal(claim.harnessId, 'prime');
      assert.equal(claim.thinkingLevel, 'max');
      assert.equal(claim.capabilities.compact, false);
      assert.equal(claim.capabilities.queueCancel, false);
    } finally {
      await handlers.get('session_shutdown')({}, ctx);
    }
    console.log('native boundary passed');
  `;
  try {
    const result = await execute('bun', ['--eval', program], { env, cwd: root, timeout: 10000 });
    assert.match(result.stdout, /native boundary passed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Pi malformed queue alignment refuses cancellation without losing display or delivered messages', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-pi-private-'));
  const env = sanitizeTestEnv({ PATH: process.env.PATH, HOME: root, TMUX: '', TMUX_PANE: '' });
  const adapter = pathToFileURL(path.resolve(__dirname, '../extensions/pi-dish-bridge/pi-private.ts')).href;
  const program = `
    import assert from 'node:assert/strict';
    const sdk = import.meta.resolve('@earendil-works/pi-coding-agent', ${JSON.stringify(adapter)});
    const { AgentSession } = await import(sdk);
    const { Agent } = await import(import.meta.resolve('@earendil-works/pi-agent-core', sdk));
    import { piPrivate } from ${JSON.stringify(adapter)};
    const reply = {
      role: 'assistant', content: [], api: 'fixture', provider: 'fixture', model: 'fixture',
      stopReason: 'stop', timestamp: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    for (const kind of ['steering', 'followUp']) {
      const agent = new Agent({
        streamFn: () => ({
          async *[Symbol.asyncIterator]() { yield { type: 'done', reason: 'stop', message: reply }; },
          async result() { return reply; },
        }),
      });
      // Use the actual SDK queue producers and capture patch, without creating
      // a provider-backed session. Only the malformed mirror is fixture-owned.
      const session = Object.assign(Object.create(AgentSession.prototype), {
        agent, _eventListeners: [], _steeringMessages: [], _followUpMessages: [],
      });
      const release = session.subscribe(() => {});
      const queued = [
        { text: 'duplicate', images: [{ type: 'image', mimeType: 'image/png', data: 'first' }] },
        { text: 'other', images: [] },
        { text: 'duplicate', images: [{ type: 'image', mimeType: 'image/gif', data: 'second' }] },
      ];
      for (const { text, images } of queued) {
        if (kind === 'steering') await session._queueSteer(text, images);
        else await session._queueFollowUp(text, images);
      }
      if (kind === 'steering') {
        session._steeringMessages.pop();
      } else {
        session._followUpMessages[2] = 'changed display';
      }
      const before = piPrivate.readQueue();
      assert.throws(
        () => piPrivate.cancelQueued(kind, kind === 'steering' ? 0 : 2,
          kind === 'steering' ? 'duplicate' : 'changed display'),
        kind === 'steering' ? /queues are out of sync/ : /message already delivered or queue changed/,
      );
      assert.deepEqual(piPrivate.readQueue(), before, 'a rejected edit leaves the displayed queue intact');
      await agent.prompt('drain queued messages');
      const delivered = agent.state.messages.filter(message =>
        message.role === 'user' && message.content[0]?.text !== 'drain queued messages');
      assert.deepEqual(delivered.map(message => message.content), queued.map(({ text, images }) =>
        [{ type: 'text', text }, ...images]), 'a rejected edit preserves delivery order and both duplicate images');
      release();
    }
    console.log('Pi malformed queue alignment passed');
  `;
  try {
    const result = await execute('bun', ['--eval', program], { env, cwd: root, timeout: 10000 });
    assert.match(result.stdout, /Pi malformed queue alignment passed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
