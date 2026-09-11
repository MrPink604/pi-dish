const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeAnchoredComments, decodeCommentIndex, findQuoteOffset } = context.PiDishBrowser;
test('anchored comment decoders narrow target kinds, identity and positive line coordinates', () => {
  const values = [null, { id: 'bad', sessionId: 's', body: 'b', target: { kind: 'execute', path: 'a' } }, { id: 'good', sessionId: 's', body: 'b', target: { kind: 'diff', repo: 'r', path: 'a', anchor: { type: 'lines', quote: 'q', oldStart: 0, oldEnd: 1.5, newStart: 2, newEnd: Infinity } } }];
  const decoded = decodeAnchoredComments(values); assert.equal(decoded.length, 1); assert.equal(decoded[0].target.anchor.newStart, 2);
  assert.equal(decoded[0].target.anchor.oldStart, undefined); assert.equal(decoded[0].target.anchor.oldEnd, undefined); assert.equal(decoded[0].target.anchor.newEnd, undefined);
  assert.equal(decodeCommentIndex({ comments: [{ id: 'i', target: { kind: 'file', path: '/file' } }] }).length, 1);
});
test('quote matching uses surrounding context and preserves exact whitespace extent', () => {
  const text = 'one alpha two; three alpha four';
  assert.equal(findQuoteOffset(text, { type: 'text', quote: 'alpha', prefix: 'three ', suffix: ' four' }), 21);
  assert.equal(findQuoteOffset('  alpha  ', { type: 'text', quote: ' alpha ' }), 1);
  assert.equal(findQuoteOffset(text, { type: 'text', quote: 'missing' }), -1);
});
