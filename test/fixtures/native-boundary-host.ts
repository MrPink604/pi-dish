import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHarnessBridge } from '../../extensions/pi-dish-bridge-prime/index.js';
import { patchOmpAgentSession, getOmpNativeCaptureStats } from '../../extensions/pi-dish-bridge-omp/native-state.js';

type HostRecord = Record<PropertyKey, unknown>;
type HostHandler = (event: HostRecord, context: HostRecord) => unknown | Promise<unknown>;
function record(value: unknown): value is HostRecord {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

const before = getOmpNativeCaptureStats();
for (const malformed of [null, 1, {}, { prototype: {} }, () => {}]) patchOmpAgentSession(malformed);
assert.deepEqual(getOmpNativeCaptureStats(), before);
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
let duplicateRegistered = false;
createHarnessBridge('native-token')({
  on() { duplicateRegistered = true; },
  registerCommand() { duplicateRegistered = true; },
});
assert.equal(duplicateRegistered, false);
const home = process.env.HOME;
if (!home) throw new Error('native boundary fixture requires HOME');
const file = path.join(home, 'prime-session.jsonl');
fs.writeFileSync(file, JSON.stringify({ type: 'session', id: 'prime-session', cwd: home }) + '\n');
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
  if (!record(claim) || !record(claim.capabilities)) throw new Error('native boundary fixture received invalid claim');
  assert.equal(claim.spawnToken, 'native-token');
  assert.equal(claim.harnessId, 'prime');
  assert.equal(claim.thinkingLevel, 'max');
  assert.equal(claim.capabilities.compact, false);
  assert.equal(claim.capabilities.queueCancel, false);
} finally {
  await shutdown({}, context);
}
console.log('native boundary passed');
