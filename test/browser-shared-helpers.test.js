const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('../public/helpers');

test('the generated helper entry publishes its CommonJS API as ordinary browser globals', () => {
  const context = { atob };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/helpers.js'), 'utf8'), context);
  for (const name of Object.keys(H)) assert.equal(typeof context[name], typeof H[name], name);
  assert.equal(context.escapeHtml('<tag>'), '&lt;tag&gt;');
  assert.equal(context.sessionKey('peer', 'same-id'), 'peer same-id');
  const route = '~sk1_' + Buffer.from(JSON.stringify(['omp', 'native-id'])).toString('base64url');
  assert.equal(context.decodeRouteSessionId(route).nativeSessionId, H.decodeRouteSessionId(route).nativeSessionId);
  const extension = context.createMathExtensions({ renderToString: source => 'math:' + source })[0];
  assert.match(extension.renderer(extension.tokenizer('$$x$$')), /math:x/);
});

test('content helpers narrow malformed block fields without inventing text or image sources', () => {
  const content = [null, 3, { type: 'text', text: {} }, { type: 'text', text: 'valid' },
    { type: 'image', url: {}, data: 'base64', mimeType: 7 }, { type: 'image', data: [] }];
  assert.equal(H.extractTextContent(content), '\n\n\nvalid\n\n');
  assert.equal(H.extractTextBlocks(content), '\nvalid');
  assert.equal(H.getToolOutputText({ content }), 'valid');
  assert.equal(H.getToolOutputText({ content: {} }), '');
  assert.deepEqual(H.extractImageBlocks(content), [{ data: 'base64', mimeType: 'image/png' }]);
  assert.equal(H.getToolSummary('bash', { command: {} }), '');
});

test('prototype-like role and harness names remain literal values', () => {
  const globalRoles = JSON.parse('{"constructor":"fixture/custom","__proto__":"fixture/prototype"}');
  const custom = H.buildModelRoleRows(globalRoles, {}).filter(row => row.custom);
  assert.deepEqual(custom.map(row => [row.key, row.value, row.effectiveValue, row.override]), [
    ['__proto__', 'fixture/prototype', '', null], ['constructor', 'fixture/custom', '', null],
  ]);
  assert.deepEqual(H.harnessBadgeInfo('constructor'), { label: 'constructor', icon: null });
});
