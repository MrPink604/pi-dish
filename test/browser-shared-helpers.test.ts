import test = require('node:test');
import { present } from './test-types.js';
import assert = require('node:assert/strict');
import fs = require('node:fs');
import path = require('node:path');
const vm: typeof import('node:vm') = require('node:vm')
const H: typeof import('../src/browser/shared-helpers.js') = require('../public/helpers');
type HelperApi = typeof import('../src/browser/shared-helpers.js');
type HelperContext = Record<string, unknown> & HelperApi & { katex?: { renderToString(source: string): string } };
type ModelRoleRow = ReturnType<typeof import('../src/core/helper-models.js').buildModelRoleRows>[number];
function assertHelperContext(value: Record<string, unknown>): asserts value is HelperContext {
  for (const name of ['escapeHtml', 'sessionKey', 'decodeRouteSessionId', 'createMathExtensions']) {
    if (typeof value[name] !== 'function') throw new Error(`Missing browser helper ${name}`);
  }
}


test('the generated helper entry publishes its CommonJS API as ordinary browser globals', () => {
  const context: Record<string, unknown> = { atob };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/helpers.js'), 'utf8'), context);
  assertHelperContext(context);
  for (const [name, value] of Object.entries(H)) assert.equal(typeof context[name], typeof value, name);
  assert.equal(context.escapeHtml('<tag>'), '&lt;tag&gt;');
  assert.equal(context.sessionKey('peer', 'same-id'), 'peer same-id');
  const route = '~sk1_' + Buffer.from(JSON.stringify(['omp', 'native-id'])).toString('base64url');
  const decoded = context.decodeRouteSessionId(route); assert.ok(decoded);
  assert.equal(decoded.nativeSessionId, present(H.decodeRouteSessionId(route)).nativeSessionId);
  const extension = context.createMathExtensions({ renderToString: (source: string) => 'math:' + source })[0]; assert.ok(extension);
  const token = extension.tokenizer('$$x$$'); assert.ok(token);
  assert.match(extension.renderer(token), /math:x/);
});

test('a retained browser math extension uses a renderer that arrives after construction', () => {
  const context: Record<string, unknown> = { atob };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/helpers.js'), 'utf8'), context);
  assertHelperContext(context);
  const extension = context.createMathExtensions()[0]; assert.ok(extension);
  const token = extension.tokenizer('$$x < y$$'); assert.ok(token);
  assert.match(extension.renderer(token), /<pre class="math-block">/);
  context.katex = { renderToString: (source: string) => 'rendered:' + source };
  assert.match(extension.renderer(token), /rendered:x < y/);
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
  const custom = H.buildModelRoleRows(globalRoles, {}).filter((row: ModelRoleRow) => row.custom);
  assert.deepEqual(custom.map((row: ModelRoleRow) => [row.key, row.value, row.effectiveValue, row.override]), [
    ['__proto__', 'fixture/prototype', '', null], ['constructor', 'fixture/custom', '', null],
  ]);
  assert.deepEqual(H.harnessBadgeInfo('constructor'), { label: 'constructor', icon: null });
});

export {};
