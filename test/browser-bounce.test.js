const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeBouncePreview, decodeBounceOperation, decodeBounceOperations } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));
test('bounce previews narrow eligibility and copy valid blocker text', () => {
  const wire = { targets: [null, { sessionId: '' }, { sessionId: 's', name: 7, eligible: 'true', blockers: ['busy', false] }] };
  const result = decodeBouncePreview(wire); wire.targets[2].blockers.push('new');
  assert.deepEqual(plain(result), [{ sessionId: 's', name: '', harnessId: '', eligible: false, reason: '', blockers: ['busy'] }]);
  assert.throws(() => decodeBouncePreview({}), /Invalid preview/);
});
test('bounce operations reject unusable top levels and narrow each result', () => {
  const result = decodeBounceOperation({ id: 'op', mode: 'restart', targets: [{ sessionId: 's', status: 'completed', replacementId: 'new', name: {}, reason: [] }, null] });
  assert.deepEqual(plain(result), { id: 'op', mode: 'restart', createdAt: '', targets: [{ sessionId: 's', status: 'completed', replacementId: 'new', name: '', reason: '', harnessId: '' }] });
  assert.throws(() => decodeBounceOperation({ id: 'op', mode: 'constructor', targets: [] }), /Invalid operation/);
  assert.throws(() => decodeBounceOperations({ operations: [null] }), /Invalid operation/);
});
