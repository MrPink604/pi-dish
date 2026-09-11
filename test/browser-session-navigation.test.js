const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeSessionRelations, decodeSessionSearch } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));
test('session relations narrow nested identities and retain unknown relation names literally', () => {
  const wire = [null, { session: { id: 8 } }, { kind: 'constructor', source: {}, session: { id: 's', name: [], isActive: 'true', lastActivity: false } }];
  const result = decodeSessionRelations(wire); wire[2].session.id = 'new';
  assert.deepEqual(plain(result), [{ kind: 'constructor', source: '', session: { id: 's', name: '', cwd: '', isActive: false, lastActivity: null } }]);
});
test('session search rejects invalid indices before DOM navigation', () => {
  assert.deepEqual(plain(decodeSessionSearch({ matches: [null, { index: -1 }, { index: 1.5 }, { index: '0' }, { index: 0, role: {} }, { index: 2, role: 'toolResult' }] })), [{ index: 0, role: '' }, { index: 2, role: 'toolResult' }]);
  assert.throws(() => decodeSessionSearch({ error: 'failed' }), /Invalid session search/);
});
