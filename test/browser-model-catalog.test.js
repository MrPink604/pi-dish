// Generated test/tool from test/browser-model-catalog.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test_types_js_1 = require("./test-types.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = { URL, Date };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { createModelCatalog, modelsCacheKey, modelSelectOptionsHtml } = context.PiDishBrowser;
const plain = (value) => JSON.parse(JSON.stringify(value));
function deferred() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve: value => (0, test_types_js_1.present)(resolve)(value), reject: reason => (0, test_types_js_1.present)(reject)(reason) };
}
const model = (id, provider = 'fixture', enabled = true) => ({ id, provider, enabled });
const scope = (id, cwd = '') => ({ host: { hostId: id, base: '/' + id, token: 'fixture-' + id }, harnessId: 'pi', cwd });
function fixture() {
    const requests = [];
    const persisted = [];
    const errors = [], changes = [];
    const catalog = createModelCatalog({ read: scope => { const request = deferred(); requests.push({ scope, ...request }); return request.promise; },
        persist: (scope, rows) => persisted.push({ scope, rows }), failed: error => errors.push(error), changed: () => { changes.push(catalog.rows().length); } });
    return { catalog, requests, persisted, errors, changes };
}
test('model cache keys retain self compatibility and separate remote harnesses', () => {
    assert.equal(modelsCacheKey('pi', 'self', 'self'), 'pi-dish-models-cache');
    assert.equal(modelsCacheKey('omp', null, 'self'), 'pi-dish-models-cache:omp');
    assert.equal(modelsCacheKey('pi', 'peer', 'self'), 'pi-dish-models-cache@peer');
    assert.equal(modelsCacheKey('omp', 'peer', 'self'), 'pi-dish-models-cache:omp@peer');
});
test('model catalog rejects superseded responses and captures the request endpoint', async () => {
    const f = fixture(), firstScope = scope('a'), old = f.catalog.load(firstScope, () => true);
    firstScope.host.token = 'replacement';
    const next = f.catalog.load(scope('b'), () => true);
    (0, test_types_js_1.present)(f.requests[1]).resolve([model('new')]);
    await next;
    (0, test_types_js_1.present)(f.requests[0]).resolve([model('old')]);
    await old;
    assert.equal((0, test_types_js_1.present)(f.catalog.rows()[0]).id, 'new');
    assert.equal((0, test_types_js_1.present)(f.requests[0]).scope.host.token, 'fixture-a');
    assert.equal(Object.isFrozen((0, test_types_js_1.present)(f.requests[0]).scope.host), true);
    assert.equal(f.persisted.length, 1);
});
test('retired or invalid model owners cannot publish success or failure', async () => {
    for (const action of ['retire', 'view', 'clear']) {
        const f = fixture();
        let owns = true;
        const old = f.catalog.load(scope('a'), () => owns);
        if (action === 'retire')
            f.catalog.retire();
        else if (action === 'clear')
            f.catalog.clear();
        else
            owns = false;
        (0, test_types_js_1.present)(f.requests[0]).reject(new Error('retired failure'));
        await old;
        assert.equal(f.errors.length, 0);
        assert.equal(f.persisted.length, 0);
        assert.equal(f.catalog.rows().length, 0);
    }
});
test('cached models remain visible during a cwd refresh while the stale request cannot publish', async () => {
    const f = fixture();
    let cwd = 'old', hostOwned = true;
    f.catalog.seed(scope('a', 'old'), [model('cached')], () => hostOwned);
    const old = f.catalog.load(scope('a', 'old'), () => cwd === 'old' && hostOwned, () => hostOwned);
    cwd = 'new';
    assert.equal((0, test_types_js_1.present)(f.catalog.rows()[0]).id, 'cached');
    (0, test_types_js_1.present)(f.requests[0]).resolve([model('stale')]);
    await old;
    assert.equal((0, test_types_js_1.present)(f.catalog.rows()[0]).id, 'cached');
    hostOwned = false;
    assert.equal(f.catalog.rows().length, 0);
    assert.equal(f.catalog.scope, null);
    assert.equal(f.catalog.enabledIds(), undefined);
});
test('model edit writers preserve persisted snapshots and provider filtering', async () => {
    const f = fixture(), load = f.catalog.load(scope('a'), () => true);
    (0, test_types_js_1.present)(f.requests[0]).resolve([model('first'), model('second'), model('outside', 'other')]);
    await load;
    const persisted = (0, test_types_js_1.present)(f.persisted[0]).rows;
    f.catalog.toggleProvider('fixture', 'first');
    assert.deepEqual(plain(f.catalog.enabledIds()), ['fixture/second', 'other/outside']);
    assert.equal((0, test_types_js_1.present)(persisted[0]).enabled, true);
    f.catalog.toggle('fixture/first');
    assert.equal(f.catalog.enabledIds(), null);
    f.catalog.setAll(false);
    assert.deepEqual(plain(f.catalog.enabledIds()), []);
    assert.deepEqual(plain(f.catalog.filter('second').map(row => row.id)), ['second']);
});
test('model option grouping supports literal prototype names and escapes labels', () => {
    const f = fixture();
    f.catalog.seed(scope('a'), [model('one', 'constructor'), model('two', '__proto__'), model('<hidden>', 'fixture', false)], () => true);
    const result = modelSelectOptionsHtml(f.catalog.rows(), text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'));
    assert.equal(result.hidden, 1);
    assert.match(result.html, /value="constructor\/one"/);
    assert.match(result.html, /value="__proto__\/two"/);
    assert.equal(result.html.includes('<hidden>'), false);
});
test('a catalog is reusable only for its recent scope and window', async (t) => {
    const f = fixture(), load = f.catalog.load(scope('a'), () => true);
    (0, test_types_js_1.present)(f.requests[0]).resolve([model('one')]);
    await load;
    const target = { harnessId: 'pi', base: '/a' };
    assert.equal(f.catalog.reusable(target), true);
    assert.equal(f.catalog.reusable({ ...target, sessionId: 'other' }), false);
    assert.equal(f.catalog.reusable({ ...target, harnessId: 'omp' }), false);
    assert.equal(f.catalog.reusable({ ...target, base: '/b' }), false);
    f.catalog.seed(scope('a'), [model('cached')], () => true);
    assert.equal(f.catalog.reusable(target), false);
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    f.catalog.retire();
    const reload = f.catalog.load(scope('a'), () => true);
    (0, test_types_js_1.present)(f.requests[1]).resolve([model('fresh')]);
    await reload;
    assert.equal(f.catalog.reusable(target), true);
    now += 5 * 60_000; // well past any reuse window
    assert.equal(f.catalog.reusable(target), false);
    const refreshed = f.catalog.load(scope('a'), () => true);
    (0, test_types_js_1.present)(f.requests[2]).resolve([model('latest')]);
    await refreshed;
    assert.equal(f.catalog.reusable(target), true);
    f.catalog.retire();
    assert.equal(f.catalog.reusable(target), false);
});
test('malformed cached rows leave no catalog scope or owner', () => {
    const f = fixture();
    assert.throws(() => f.catalog.seed(scope('a'), [null], () => true), /model catalog/);
    assert.equal(f.catalog.scope, null);
    assert.equal(f.catalog.rows().length, 0);
});
