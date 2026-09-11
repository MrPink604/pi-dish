const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeRoutine, decodeRoutineList, decodeRoutineInvocations } = context.PiDishBrowser;
const host = { hostId: 'peer', base: '/hosts/peer', label: 'Peer' };
test('routine decoding retains literal prompt versions and stamps immutable host endpoints', () => {
  const routine = decodeRoutine({ id: 'routine', host: 'forged', onBusy: 'bad', prompt: 'Text <xml>', versions: [{ version: 1, prompt: 'old', savedAt: 3 }, { version: 'wrong', prompt: 'bad' }], stats: { lastInvocation: { id: 'run', status: 'completed', startedAt: 4 } } }, host);
  assert.equal(routine.host, 'peer'); assert.equal(routine.onBusy, 'skip'); assert.equal(routine.prompt, 'Text <xml>');
  assert.equal(routine.versions.length, 1); assert.equal(routine.stats.lastInvocation.id, 'run');
  host.base = '/replacement'; assert.equal(routine.endpoint.base, '/hosts/peer'); assert.equal(Object.isFrozen(routine.endpoint), true);
  assert.equal(decodeRoutineList({ routines: [null, { id: 3 }, { id: 'valid' }] }, host).length, 1);
});
test('routine invocation decoding rejects malformed rows and cursor types', () => {
  const data = decodeRoutineInvocations({ invocations: [{ id: 'run', durationMs: 'wrong', sessionId: 'session' }, null], nextBefore: 'wrong' });
  assert.equal(data.invocations.length, 1); assert.equal(data.invocations[0].durationMs, null); assert.equal(data.nextBefore, null);
  assert.throws(() => decodeRoutine({}, host), /identity/);
});
