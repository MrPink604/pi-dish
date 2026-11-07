import { loadBrowser } from './browser-vm.js';
import test = require('node:test');
import assert = require('node:assert/strict');
const { decodeBouncePreview, decodeBounceOperation, decodeBounceOperations } = loadBrowser();
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
test('bounce previews narrow eligibility and copy valid blocker text', () => {
  const wire = { targets: [null, { sessionId: '' }, { sessionId: 's', name: 7, eligible: 'true', blockers: ['busy', false] }] };
  const result = decodeBouncePreview(wire); const blockers = wire.targets[2]?.blockers; assert.ok(blockers); blockers.push('new');
  assert.deepEqual(plain(result), [{ sessionId: 's', name: '', harnessId: '', eligible: false, reason: '', blockers: ['busy'] }]);
  assert.throws(() => decodeBouncePreview({}), /Invalid preview/);
});
test('bounce operations reject unusable top levels and narrow each result', () => {
  const result = decodeBounceOperation({ id: 'op', mode: 'restart', targets: [{ sessionId: 's', status: 'completed', replacementId: 'new', name: {}, reason: [] }, null] });
  assert.deepEqual(plain(result), { id: 'op', mode: 'restart', createdAt: '', targets: [{ sessionId: 's', status: 'completed', replacementId: 'new', name: '', reason: '', harnessId: '' }] });
  assert.throws(() => decodeBounceOperation({ id: 'op', mode: 'constructor', targets: [] }), /Invalid operation/);
  assert.throws(() => decodeBounceOperations({ operations: [null] }), /Invalid operation/);
});

export {};
