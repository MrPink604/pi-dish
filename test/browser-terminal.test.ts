import { loadBrowser } from './browser-vm.js';
import test = require('node:test');
import assert = require('node:assert/strict');
const { decodeTerminalOutput } = loadBrowser();
test('terminal wire messages narrow output and attachment metadata before rendering', () => {
  assert.equal(decodeTerminalOutput(null), null); assert.equal(decodeTerminalOutput({ type: 'output', data: {} }), null);
  assert.equal(decodeTerminalOutput({ type: 'unknown', data: 'text' }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(decodeTerminalOutput({ type: 'attach', replay: 'text', cwd: 3, tmuxPrefix: {} }))), { type: 'attach', replay: 'text', cwd: '', tmuxPrefix: null });
  const exit = decodeTerminalOutput({ type: 'exit', code: 'bad' }); assert.ok(exit && exit.type === 'exit'); assert.equal(exit.code, null);
});

export {};
