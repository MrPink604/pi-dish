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
