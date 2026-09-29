// Generated test/tool from test/browser-shared-helpers.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const test_types_js_1 = require("./test-types.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const H = require('../public/helpers');
function assertHelperContext(value) {
    for (const name of ['escapeHtml', 'sessionKey', 'decodeRouteSessionId', 'createMathExtensions']) {
        if (typeof value[name] !== 'function')
            throw new Error(`Missing browser helper ${name}`);
    }
}
test('the generated helper entry publishes its CommonJS API as ordinary browser globals', () => {
    const context = { atob };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/helpers.js'), 'utf8'), context);
    assertHelperContext(context);
    for (const [name, value] of Object.entries(H))
        assert.equal(typeof context[name], typeof value, name);
    assert.equal(context.escapeHtml('<tag>'), '&lt;tag&gt;');
    assert.equal(context.sessionKey('peer', 'same-id'), 'peer same-id');
    const route = '~sk1_' + Buffer.from(JSON.stringify(['omp', 'native-id'])).toString('base64url');
    const decoded = context.decodeRouteSessionId(route);
    assert.ok(decoded);
    assert.equal(decoded.nativeSessionId, (0, test_types_js_1.present)(H.decodeRouteSessionId(route)).nativeSessionId);
    const extension = context.createMathExtensions({ renderToString: (source) => 'math:' + source })[0];
    assert.ok(extension);
    const token = extension.tokenizer('$$x$$');
    assert.ok(token);
    assert.match(extension.renderer(token), /math:x/);
});
test('a retained browser math extension uses a renderer that arrives after construction', () => {
    const context = { atob };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/helpers.js'), 'utf8'), context);
    assertHelperContext(context);
    const extension = context.createMathExtensions()[0];
    assert.ok(extension);
    const token = extension.tokenizer('$$x < y$$');
    assert.ok(token);
    assert.match(extension.renderer(token), /<pre class="math-block">/);
    context.katex = { renderToString: (source) => 'rendered:' + source };
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
    const custom = H.buildModelRoleRows(globalRoles, {}).filter((row) => row.custom);
    assert.deepEqual(custom.map((row) => [row.key, row.value, row.effectiveValue, row.override]), [
        ['__proto__', 'fixture/prototype', '', null], ['constructor', 'fixture/custom', '', null],
    ]);
    assert.deepEqual(H.harnessBadgeInfo('constructor'), { label: 'constructor', icon: null });
});
test('cached date formatting follows local time-zone changes, DST and invalid timestamps', () => {
    const previousZone = process.env.TZ;
    try {
        for (const zone of ['America/New_York', 'UTC', 'Asia/Kathmandu', 'Europe/London']) {
            process.env.TZ = zone;
            for (const timestamp of ['2020-01-15T23:45:00Z', '2020-07-15T23:45:00Z', '2020-03-08T07:00:00Z']) {
                const date = new Date(timestamp);
                assert.equal(H.formatTime(timestamp), date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), `${zone}: ${timestamp}`);
                assert.equal(H.formatRelativeTime(timestamp), date.toLocaleDateString([], { month: 'short', day: 'numeric' }), `${zone}: ${timestamp}`);
            }
            for (const timestamp of ['invalid', -8.64e15, 8.64e15]) {
                assert.equal(H.formatTime(timestamp), new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            }
        }
    }
    finally {
        if (previousZone === undefined)
            delete process.env.TZ;
        else
            process.env.TZ = previousZone;
    }
});
