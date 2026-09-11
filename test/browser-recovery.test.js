const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeRecoveryMode, decodeRecoveryReport } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));

test('recovery wire data narrows rows and mode values without borrowing malformed payloads', () => {
  const wire = { mode: 'constructor', sessions: [null, { id: 5 }, { id: '' }, { id: 's', status: 'needs-review', name: { bad: true }, excluded: 'false', updatedAt: false }], truncated: true, totalRecords: Infinity };
  const result = decodeRecoveryReport(wire);
  wire.sessions[3].status = 'changed';
  assert.deepEqual(plain(result), { mode: 'constructor', sessions: [{ id: 's', name: '', status: 'needs-review', harnessId: '', cwd: '', reason: '', excluded: false, updatedAt: null }], truncated: true, totalRecords: 1 });
  assert.equal(decodeRecoveryMode('continue'), 'continue');
  assert.equal(decodeRecoveryMode('restore'), 'restore');
  assert.equal(decodeRecoveryMode('constructor'), 'off');
  assert.throws(() => decodeRecoveryReport([]), /Invalid recovery report/);
});
