const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeSlashCommands, decodeFileCompletions, createSessionState, createSessionReferences } = context.PiDishBrowser;
test('autocomplete wire data narrows command and file fields without mutating input', () => {
  const wire = [null, { name: 1 }, { name: 'valid', args: {}, source: 'extension', description: ['bad'] }];
  const commands = decodeSlashCommands(wire); assert.equal(commands.length, 1); assert.equal(commands[0].args, ''); assert.equal(commands[0].description, '');
  const files = decodeFileCompletions([{ path: 'a', isDir: 'yes', gitStatus: '__proto__' }, { path: 1 }]); assert.equal(files.length, 1); assert.equal(files[0].isDir, false);
  assert.equal(wire[2].source, 'extension');
});
test('session refs use target-host naming and keep exact host-id references unambiguous', () => {
  const state = createSessionState({ getSelfHostId: () => 'self', getHostLabel: id => id, onListsChanged() {}, onCurrentChanged() {} });
  state.setSessionLists([{ hostId: 'self', active: [{ id: 'same-id', name: 'Local' }] },
    { hostId: 'peer', active: [{ id: 'same-id', name: 'Remote' }, { id: 'other-id' }] }]);
  state.setCurrentSession('same-id', 'peer');
  const hosts = { self: { hostId: 'self', base: '', capabilities: {} }, peer: { hostId: 'peer', base: 'http://peer', name: 'named-peer', capabilities: {} } };
  const refs = createSessionReferences({ sessionState: state, selfId: () => 'self', host: id => hosts[id || 'self'], hostLabel: id => id, config: () => ({}) });
  assert.equal(refs.match('same-id').host, 'peer'); assert.equal(refs.candidates().filter(row => row.id === 'same-id').length, 1);
  assert.equal(refs.ref({ id: 'same-id', host: 'peer' }, { id: 'same-id', host: 'self' }), 'named-peer/same-id');
  assert.equal(refs.ref({ id: 'same-id', host: 'self' }, { id: 'same-id', host: 'peer' }), 'self:same-id');
});
