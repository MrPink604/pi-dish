const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeHarnessConfig, decodeHarnessAgents } = context.PiDishBrowser;
const plain = value => JSON.parse(JSON.stringify(value));

test('harness settings decode owned string role records and reject malformed top levels', () => {
  const wire = { defaultModel: 'p/main', defaultThinkingLevel: [], globalModelRoles: { smol: 'p/fast', bad: false }, modelRoles: { constructor: 'p/custom' } };
  const result = decodeHarnessConfig(wire);
  wire.globalModelRoles.smol = 'changed';
  assert.deepEqual(plain(result), { defaultModel: 'p/main', defaultThinkingLevel: '', globalModelRoles: { smol: 'p/fast' }, modelRoles: { constructor: 'p/custom' } });
  assert.equal(result.globalModelRoles.constructor, undefined);
  assert.throws(() => decodeHarnessConfig(null), /Invalid harness configuration/);
});

test('agent settings narrow rows and copy maps without inherited agent names', () => {
  const wire = { agents: [null, { name: '' }, { name: 'constructor', model: '@smol', description: 1 }],
    globalSettings: { disabled: ['scout', 3], modelOverrides: { scout: 'p/fast' }, prewalk: { scout: false, bad: 'yes' }, advisor: {} } };
  const result = decodeHarnessAgents(wire);
  wire.globalSettings.disabled.push('another');
  wire.globalSettings.modelOverrides.scout = 'changed';
  assert.deepEqual(plain(result), { agents: [{ name: 'constructor', model: '@smol', description: '', source: '', thinkingLevel: '' }],
    settings: null, globalSettings: { disabled: ['scout'], modelOverrides: { scout: 'p/fast' }, prewalk: { scout: false }, advisor: {} } });
  assert.equal(result.globalSettings.modelOverrides.constructor, undefined);
  assert.equal(result.globalSettings.prewalk.constructor, undefined);
  assert.throws(() => decodeHarnessAgents([]), /Invalid harness agents/);
});
