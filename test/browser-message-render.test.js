// Generated test/tool from test/browser-message-render.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test_types_js_1 = require("./test-types.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { decodeRenderMessage } = context.PiDishBrowser;
test('message projection preserves text/image content but narrows identifiers and telemetry', () => {
    const raw = { role: 'assistant', index: '0" onclick="bad', timestamp: 'literal', content: ['plain', { type: 'text', text: 'text' }, { type: 'image', url: '/image', mimeType: 'image/png' }, null],
        usage: { input: '9', output: 4, cost: { total: null, output: 0.1 } }, durationMs: Infinity };
    const row = decodeRenderMessage(raw);
    assert.equal(row.index, undefined);
    assert.equal(row.timestamp, 'literal');
    assert.equal(row.durationMs, undefined);
    const content = row.content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0], 'plain');
    assert.equal((0, test_types_js_1.record)(content[2]).url, '/image');
    assert.equal(content.length, 3);
    const usage = (0, test_types_js_1.present)(row.usage), cost = (0, test_types_js_1.present)(usage.cost);
    assert.equal(usage.input, undefined);
    assert.equal(cost.total, null);
    raw.usage.cost.output = 99;
    assert.equal(cost.output, 0.1);
});
test('custom-message projection separates hidden state, structured advisor notes and job metadata', () => {
    const row = decodeRenderMessage({ role: 'custom', display: false, details: { notes: ['plain', { note: '<literal>', severity: 'concern', advisor: 'a' }, { note: {} }], jobs: [{ jobId: 'job', durationMs: 2500 }, { label: {}, durationMs: '3' }], from: 'Main', message: 'body', extra: 'dropped' } });
    const details = (0, test_types_js_1.present)(row.details), notes = (0, test_types_js_1.present)(details.notes), jobs = (0, test_types_js_1.present)(details.jobs);
    assert.equal(row.display, false);
    assert.equal(notes.length, 2);
    assert.equal((0, test_types_js_1.present)(notes[0]).note, 'plain');
    assert.equal((0, test_types_js_1.present)(notes[1]).note, '<literal>');
    assert.equal((0, test_types_js_1.present)(jobs[0]).durationMs, 2500);
    assert.equal((0, test_types_js_1.present)(jobs[1]).label, undefined);
    const empty = decodeRenderMessage({ role: 'assistant', content: [] }).content;
    assert.ok(Array.isArray(empty));
    assert.equal(empty.length, 0);
    assert.equal(details.from, 'Main');
    assert.equal(details.message, 'body');
    assert.equal('extra' in details ? details.extra : undefined, undefined);
    assert.equal(decodeRenderMessage({ role: 'assistant' }).content, undefined);
});
test('message timestamps retain accepted formats without borrowing an external Date', () => {
    const timestamp = vm.runInNewContext('new Date("2026-09-15T12:00:00Z")', context);
    const expected = timestamp.getTime(), row = decodeRenderMessage({ role: 'assistant', timestamp });
    timestamp.setTime(0);
    assert.ok(row.timestamp && typeof row.timestamp === 'object');
    assert.equal(row.timestamp.getTime(), expected);
    assert.equal(decodeRenderMessage({ role: 'assistant', timestamp: expected }).timestamp, expected);
    assert.equal(decodeRenderMessage({ role: 'assistant', timestamp: '2026-09-15T12:00:00Z' }).timestamp, '2026-09-15T12:00:00Z');
});
