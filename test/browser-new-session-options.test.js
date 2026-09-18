// Generated test/tool from test/browser-new-session-options.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test_types_js_1 = require("./test-types.js");
const xmldom_1 = require("@xmldom/xmldom");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = { URL, encodeURIComponent };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { createNewSessionConfigPreview, decodeHarnessConfigPreview } = context.PiDishBrowser;
const plain = (value) => JSON.parse(JSON.stringify(value));
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve: value => (0, test_types_js_1.present)(resolve)(value) };
}
const response = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const fixtureDocument = new xmldom_1.DOMParser().parseFromString('<html><body/></html>', 'text/html');
function element() {
    const value = fixtureDocument.createElement('div');
    Object.defineProperty(value, 'style', { value: { display: '' } });
    return value;
}
function fixture() {
    const initial = { host: { hostId: 'a', base: '/a', token: 'fixture-a' }, harnessId: 'omp', cwd: '/old', view: 1 };
    let scope = initial;
    const wrap = element(), values = element(), roles = element(), buttons = [element(), element()];
    const reads = [];
    const controller = createNewSessionConfigPreview({ wrap, values, roles, buttons, scope: () => scope,
        request: (host, url) => { const wait = deferred(); reads.push({ ...wait, host, url }); return wait.promise; },
        roleSummary: roles => Object.values(roles).join(', ') });
    return { controller, reads, wrap, values, roles, buttons, initial, scope: () => scope, setScope: (next) => { scope = next; } };
}
test('harness defaults narrow wire fields and copy valid custom role names', () => {
    const wire = { defaultModel: 7, defaultThinkingLevel: 'high', modelRoles: { smol: 'p/small', wrong: [], constructor: 'p/custom' } };
    const value = decodeHarnessConfigPreview(wire, '/cwd');
    wire.modelRoles.smol = 'changed';
    assert.deepEqual(plain(value), { cwd: '/cwd', defaultModel: '', defaultThinkingLevel: 'high', modelRoles: { smol: 'p/small', constructor: 'p/custom' } });
    assert.throws(() => decodeHarnessConfigPreview(null, ''), /Invalid harness defaults/);
});
test('config preview binds delayed bodies to the original cwd and retires editor actions immediately', async () => {
    const f = fixture();
    let load = f.controller.load();
    (0, test_types_js_1.present)(f.reads[0]).resolve(response({ defaultModel: 'ready' }));
    await load;
    assert.equal((0, test_types_js_1.present)(f.controller.config).defaultModel, 'ready');
    assert.equal((0, test_types_js_1.present)(f.buttons[0]).style.display, '');
    const body = deferred();
    load = f.controller.load();
    const delayed = new Response('{}', { status: 200 });
    Object.defineProperty(delayed, 'json', { value: () => body.promise });
    (0, test_types_js_1.present)(f.reads[1]).resolve(delayed);
    await Promise.resolve();
    f.setScope({ ...(0, test_types_js_1.present)(f.scope()), cwd: '/new' });
    f.controller.retire();
    assert.equal(f.controller.config, null);
    assert.equal((0, test_types_js_1.present)(f.buttons[0]).style.display, 'none');
    body.resolve({ defaultModel: 'old' });
    await load;
    assert.equal(f.controller.config, null);
    assert.equal(f.values.textContent, 'Loading…');
});
test('preview request captures endpoint credentials and ignores token rotation, close and old failures', async () => {
    const f = fixture(), first = f.controller.load();
    f.initial.host.token = 'rotated';
    const capturedHost = (0, test_types_js_1.present)(f.reads[0]).host;
    assert.equal(capturedHost && typeof capturedHost === 'object' ? capturedHost.token : undefined, 'fixture-a');
    (0, test_types_js_1.present)(f.reads[0]).resolve(response({ defaultModel: 'obsolete' }));
    await first;
    assert.equal(f.controller.config, null);
    const second = f.controller.load();
    f.setScope(null);
    (0, test_types_js_1.present)(f.reads[1]).resolve(new Response(JSON.stringify({ error: 'closed' }), { status: 500 }));
    await second;
    assert.equal(f.values.textContent, 'Loading…');
    assert.equal(f.controller.config, null);
});
test('successful preview exposes copied scope and current errors without showing unsupported harness actions', async () => {
    const f = fixture(), load = f.controller.load('/old');
    assert.equal((0, test_types_js_1.present)(f.reads[0]).url, '/api/harnesses/omp/config?cwd=%2Fold');
    (0, test_types_js_1.present)(f.reads[0]).resolve(response({ defaultModel: 'p/model', modelRoles: { smol: 'p/smol' } }));
    await load;
    assert.equal(f.values.textContent, 'Model: p/model · Thinking: host default');
    assert.equal(f.roles.textContent, 'Roles: p/smol');
    const fail = f.controller.load();
    (0, test_types_js_1.present)(f.reads[1]).resolve(new Response(JSON.stringify({ error: 4 }), { status: 503 }));
    await fail;
    assert.equal(f.values.textContent, 'Defaults unavailable: HTTP 503');
    assert.equal(f.controller.config, null);
    f.setScope({ ...(0, test_types_js_1.present)(f.scope()), harnessId: 'pi' });
    await f.controller.load();
    assert.equal(f.reads.length, 2);
    assert.equal(f.wrap.style.display, 'none');
});
