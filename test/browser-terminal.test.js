const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { decodeTerminalOutput } = context.PiDishBrowser;
test('terminal wire messages narrow output and attachment metadata before rendering', () => {
  assert.equal(decodeTerminalOutput(null), null); assert.equal(decodeTerminalOutput({ type: 'output', data: {} }), null);
  assert.equal(decodeTerminalOutput({ type: 'unknown', data: 'text' }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(decodeTerminalOutput({ type: 'attach', replay: 'text', cwd: 3, tmuxPrefix: {} }))), { type: 'attach', replay: 'text', cwd: '', tmuxPrefix: null });
  assert.equal(decodeTerminalOutput({ type: 'exit', code: 'bad' }).code, null);
});
