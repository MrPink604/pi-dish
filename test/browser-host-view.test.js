// Generated test/tool from test/browser-host-view.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test_types_js_1 = require("./test-types.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require.resolve('../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
test('host presentation narrows labels and capabilities without mutating discovery metadata', () => {
    const project = context.PiDishBrowser.createHostView();
    const projectUnknown = (value) => (0, test_types_js_1.record)(Reflect.apply(project, undefined, [value]));
    const host = { hostId: 'peer', key: 'peer', source: 'fleet', base: 'http://peer', label: 12, capabilities: { terminal: true, recovery: false, malformed: 'yes' } };
    const view = projectUnknown(host);
    assert.equal(view.label, '12');
    assert.deepEqual(JSON.parse(JSON.stringify((0, test_types_js_1.record)(view.capabilities))), { terminal: true, recovery: false });
    assert.equal(projectUnknown(host), view);
    assert.equal(host.label, 12);
    assert.equal(host.capabilities.malformed, 'yes');
    const changed = projectUnknown({ ...host, label: 'new' });
    assert.notEqual(changed, view);
    assert.equal(changed.label, 'new');
    assert.deepEqual(JSON.parse(JSON.stringify((0, test_types_js_1.record)(projectUnknown({ ...host, capabilities: {} }).capabilities))), {});
});
test('static shell markup uses registered typed actions and contains no executable event attributes', () => {
    const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
    assert.doesNotMatch(html, /\son(?:click|change|keydown|toggle)\s*=/i);
    const registered = new Set(context.PiDishBrowser.APP_ACTION_NAMES);
    const used = [...html.matchAll(/data-app-(?:click|change|keydown|toggle)="([^"]+)"/g)].map(match => match[1]);
    assert.ok(used.length > 50, 'the shell action inventory is populated');
    for (const name of used)
        assert.ok(registered.has(name), `Unregistered shell action ${name}`);
    for (const name of registered)
        assert.ok(used.includes(name), `Unused shell action ${name}`);
});
