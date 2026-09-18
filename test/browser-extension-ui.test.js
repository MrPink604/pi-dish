// Generated test/tool from test/browser-extension-ui.test.ts; edit that source and run npm run build:tests.
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
const { decodeExtensionRequest } = context.PiDishBrowser;
test('extension payloads narrow malformed fields and strip ANSI without mutating the wire object', () => {
    const value = { id: 'ask', method: 'ask', title: '\x1b[31mTitle\x1b[0m', questions: [null, { id: 2 }, { id: 'q', question: '\x1b[32mQuestion\x1b[0m', multi: 'yes', recommended: 0.5, options: ['\x1b[31mFirst\x1b[0m', { label: 'Second', preview: '\x1b[31mPreview\x1b[0m' }] }] };
    const result = decodeExtensionRequest(value);
    assert.ok(result);
    const question = result.questions[0];
    assert.ok(question);
    const first = question.options[0], second = question.options[1];
    assert.ok(first);
    assert.ok(second);
    assert.equal(result.title, 'Title');
    assert.equal(result.questions.length, 1);
    assert.equal(first.label, 'First');
    assert.equal(second.preview, 'Preview');
    assert.equal(question.recommended, null);
    assert.equal(question.multi, false);
    assert.equal(value.title, '\x1b[31mTitle\x1b[0m');
    assert.equal(decodeExtensionRequest(null), null);
});
test('extension state identities retain raw keys while empty fields clear projected state', () => {
    const result = decodeExtensionRequest({ method: 'setWidget', widgetKey: 'quoted"key', widgetLines: false, notifyType: 'injected class' });
    assert.ok(result);
    assert.equal(result.widgetKey, 'quoted"key');
    assert.equal(result.widgetLines.length, 0);
    assert.equal(result.notifyType, 'info');
});
