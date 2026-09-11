const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeTranscriptTree } = context.PiDishBrowser;
test('tree decoding bounds indentation and narrows ids, roles and tool summaries', () => {
  const tree = decodeTranscriptTree({ nodes: [null, { id: 7 }, { id: 'entry', depth: 1e200, childCount: -1, role: {}, toolCalls: [null, { id: 'call', name: 'bash', args: 'pwd' }] }], activePathIds: ['entry', 3], leafId: false });
  assert.equal(tree.nodes.length, 1); assert.equal(tree.nodes[0].depth, 3); assert.equal(tree.nodes[0].childCount, 0); assert.equal(tree.nodes[0].role, '');
  assert.equal(tree.nodes[0].toolCalls[0].args, 'pwd'); assert.equal(tree.activePathIds.length, 1); assert.equal(tree.leafId, null);
  assert.throws(() => decodeTranscriptTree({ error: 'bad' }), /Invalid session tree/);
});
