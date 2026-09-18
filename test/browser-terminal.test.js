// Generated test/tool from test/browser-terminal.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { decodeTerminalOutput } = context.PiDishBrowser;
test('terminal wire messages narrow output and attachment metadata before rendering', () => {
    assert.equal(decodeTerminalOutput(null), null);
    assert.equal(decodeTerminalOutput({ type: 'output', data: {} }), null);
    assert.equal(decodeTerminalOutput({ type: 'unknown', data: 'text' }), null);
    assert.deepEqual(JSON.parse(JSON.stringify(decodeTerminalOutput({ type: 'attach', replay: 'text', cwd: 3, tmuxPrefix: {} }))), { type: 'attach', replay: 'text', cwd: '', tmuxPrefix: null });
    const exit = decodeTerminalOutput({ type: 'exit', code: 'bad' });
    assert.ok(exit && exit.type === 'exit');
    assert.equal(exit.code, null);
});
