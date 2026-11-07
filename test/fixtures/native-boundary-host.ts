import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHarnessBridge } from '../../extensions/pi-dish-bridge-omp/index.js';
import { patchOmpAgentSession, getOmpNativeCaptureStats } from '../../extensions/pi-dish-bridge-omp/native-state.js';
import { isObject, type HostObject as HostRecord } from '../../extensions/pi-dish-bridge/host.js';

type HostHandler = (event: HostRecord, context: HostRecord) => unknown | Promise<unknown>;

const before = getOmpNativeCaptureStats(null);
for (const malformed of [null, 1, {}, { prototype: {} }, () => {}]) patchOmpAgentSession(malformed);
assert.deepEqual(getOmpNativeCaptureStats(null), before);
const load = createHarnessBridge();
for (const malformed of [null, {}, { on: true, registerCommand() {} }, { on() {} }]) {
  assert.throws(() => load(malformed), /host with on and registerCommand/);
}
const handlers = new Map<string, HostHandler>();
const host = {
  on(name: string, handler: HostHandler) { handlers.set(name, handler); },
  registerCommand() {},
  getThinkingLevel() { return 'max'; },
};
load(host);
// A second copy of the same harness's bridge must stay inactive. Launch
// tokens no longer get adopted into the already-claimed copy: harnesses that
// inject a token wrapper load exactly one bridge copy per process.
let duplicateRegistered = false;
createHarnessBridge('native-token')({
  on() { duplicateRegistered = true; },
  registerCommand() { duplicateRegistered = true; },
});
assert.equal(duplicateRegistered, false);
const home = process.env.HOME;
if (!home) throw new Error('native boundary fixture requires HOME');
const file = path.join(home, 'omp-session.jsonl');
fs.writeFileSync(file, JSON.stringify({ type: 'session', id: 'omp-session', cwd: home }) + '\n');
const context = {
  cwd: home,
  ui: {},
  sessionManager: { getSessionFile() { return file; }, getSessionName() { return 'native boundary'; } },
};
const start = handlers.get('session_start');
const shutdown = handlers.get('session_shutdown');
if (!start || !shutdown) throw new Error('native boundary fixture missed lifecycle handlers');
try {
  await start({}, context);
  const registry = path.join(home, '.pi', 'dish', 'sessions');
  const deadline = Date.now() + 3000;
  while (!fs.readdirSync(registry).some(name => name.endsWith('.json'))) {
    if (Date.now() > deadline) throw new Error('bridge did not publish its bound socket');
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  const files = fs.readdirSync(registry).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 1);
  const claim: unknown = JSON.parse(fs.readFileSync(path.join(registry, files[0]!), 'utf8'));
  if (!isObject(claim) || !isObject(claim.capabilities)) throw new Error('native boundary fixture received invalid claim');
  assert.equal(claim.spawnToken, null);
  assert.equal(claim.harnessId, 'omp');
  assert.equal(claim.thinkingLevel, 'max');
  // This fixture context has no compact method, so the bridge must withdraw
  // the descriptor's optimistic claim.
  assert.equal(claim.capabilities.compact, false);
  assert.equal(claim.capabilities.prompt, true);
  assert.equal(claim.capabilities.queueCancel, false);
} finally {
  await shutdown({}, context);
}
console.log('native boundary passed');
