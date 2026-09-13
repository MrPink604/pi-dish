const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeSessionLineage, decodeSessionSearch } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));
test('session lineage narrows nested identities and decodes the tree recursively', () => {
  const node = (id, children, edge) => ({ session: { id, name: [], isActive: 'true', subagentLive: 1, lastActivity: false, harnessId: 9, model: {} }, children, edge });
  const wire = {
    session: { id: 'current', name: 'Current' },
    tree: node('root', [
      null,
      node(8, []),
      node('child', [node('gc', [])], { kind: 'child', source: {} }),
    ]),
    members: 'many', truncated: true,
  };
  const result = decodeSessionLineage(wire);
  wire.tree.children[2].session.id = 'mutated';
  assert.deepEqual(plain(result), {
    session: { id: 'current', name: 'Current', cwd: '', harnessId: '', model: '', isActive: false, subagentLive: false, turnInProgress: false, capabilities: null, lastActivity: null },
    tree: {
      session: { id: 'root', name: '', cwd: '', harnessId: '', model: '', isActive: false, subagentLive: false, turnInProgress: false, capabilities: null, lastActivity: null },
      edge: null,
      children: [{
        session: { id: 'child', name: '', cwd: '', harnessId: '', model: '', isActive: false, subagentLive: false, turnInProgress: false, capabilities: null, lastActivity: null },
        edge: { kind: 'child', source: '' },
        children: [{
          session: { id: 'gc', name: '', cwd: '', harnessId: '', model: '', isActive: false, subagentLive: false, turnInProgress: false, capabilities: null, lastActivity: null },
          edge: null,
          children: [],
        }],
      }],
    },
    members: 3, truncated: true,
  });
  assert.deepEqual(plain(decodeSessionLineage(null)), { session: null, tree: null, members: 0, truncated: false });
});
test('session search rejects invalid indices before DOM navigation', () => {
  assert.deepEqual(plain(decodeSessionSearch({ matches: [null, { index: -1 }, { index: 1.5 }, { index: '0' }, { index: 0, role: {} }, { index: 2, role: 'toolResult' }] })), [{ index: 0, role: '' }, { index: 2, role: 'toolResult' }]);
  assert.throws(() => decodeSessionSearch({ error: 'failed' }), /Invalid session search/);
});
