// Generated test/tool from test/browser-directory-catalog.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test_types_js_1 = require("./test-types.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { createDirectoryCatalog, decodeKnownDirectories, decodeDirectoryChildren } = context.PiDishBrowser;
const plain = (value) => JSON.parse(JSON.stringify(value));
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve: value => (0, test_types_js_1.present)(resolve)(value) };
}
function fixture() {
    let selected = { hostId: 'a', base: '/hosts/a', token: 'a-fixture' };
    const requests = [];
    const catalog = createDirectoryCatalog({ host: () => selected, request: (host, url) => {
            const response = deferred();
            requests.push({ host, url, ...response });
            return response.promise;
        } });
    return { catalog, requests, select(hostId, token = hostId + '-fixture') { selected = hostId ? { hostId, base: '/hosts/' + hostId, token } : null; },
        current: () => selected };
}
const row = (short) => ({ path: '/home/fixture/' + short.slice(2), short });
const response = (rows) => new Response(JSON.stringify(rows), { status: 200 });
test('directory boundaries narrow only the fields consumed by the views', () => {
    assert.deepEqual(plain(decodeKnownDirectories([row('~/a'), null, { path: 1, short: 'bad' }, { path: '/a', short: 2 }])), [row('~/a')]);
    assert.deepEqual(plain(decodeKnownDirectories({ error: 'bad' })), []);
    assert.deepEqual(plain(decodeDirectoryChildren({ dirs: [{ path: '/a', name: 'a' }, { path: '/b', name: null }] })), { dirs: [{ path: '/a', name: 'a' }], error: false });
    assert.equal(decodeDirectoryChildren(null).error, true);
    assert.equal(decodeDirectoryChildren({ error: 'unreadable', dirs: [] }).error, true);
});
test('known directory rows disappear immediately when their selected host changes', async () => {
    const f = fixture();
    const first = f.catalog.load();
    (0, test_types_js_1.present)(f.requests[0]).resolve(response([row('~/a')]));
    await first;
    assert.deepEqual(plain(f.catalog.current()), [row('~/a')]);
    f.select('b');
    assert.deepEqual(plain(f.catalog.current()), []);
    const second = f.catalog.load();
    (0, test_types_js_1.present)(f.requests[1]).resolve(response([row('~/b')]));
    await second;
    assert.deepEqual(plain(f.catalog.current()), [row('~/b')]);
});
test('an older host request cannot replace the current host directory catalog', async () => {
    const f = fixture();
    const first = f.catalog.load();
    f.select('b');
    const second = f.catalog.load();
    (0, test_types_js_1.present)(f.requests[1]).resolve(response([row('~/b')]));
    await second;
    (0, test_types_js_1.present)(f.requests[0]).resolve(response([row('~/retired-a')]));
    await first;
    assert.deepEqual(plain(f.catalog.current()), [row('~/b')]);
    const firstRequest = (0, test_types_js_1.present)(f.requests[0]);
    assert.equal(typeof firstRequest.host === 'object' && firstRequest.host ? firstRequest.host.base : undefined, '/hosts/a');
    assert.equal(typeof firstRequest.host === 'object' && firstRequest.host ? firstRequest.host.token : undefined, 'a-fixture');
    assert.equal(Object.isFrozen(firstRequest.host), true);
});
test('directory body reads retire after a new request, close, or changed credentials', async () => {
    for (const action of ['newer', 'close', 'token']) {
        const f = fixture(), body = deferred();
        const first = f.catalog.load();
        const delayed = new Response('{}');
        Object.defineProperty(delayed, 'json', { value: () => body.promise });
        (0, test_types_js_1.present)(f.requests[0]).resolve(delayed);
        await Promise.resolve();
        if (action === 'newer') {
            const second = f.catalog.load();
            (0, test_types_js_1.present)(f.requests[1]).resolve(response([row('~/new')]));
            await second;
        }
        else if (action === 'close')
            f.catalog.retire();
        else
            (0, test_types_js_1.present)(f.current()).token = 'replacement-fixture';
        body.resolve([row('~/retired')]);
        await first;
        assert.deepEqual(plain(f.catalog.current()), action === 'newer' ? [row('~/new')] : []);
        const firstRequest = (0, test_types_js_1.present)(f.requests[0]);
        assert.equal(typeof firstRequest.host === 'object' && firstRequest.host ? firstRequest.host.token : undefined, 'a-fixture');
    }
});
test('failed directory refresh retains only the same host previous catalog', async () => {
    const f = fixture();
    const first = f.catalog.load();
    (0, test_types_js_1.present)(f.requests[0]).resolve(response([row('~/saved')]));
    await first;
    const failed = f.catalog.load();
    (0, test_types_js_1.present)(f.requests[1]).resolve(new Response('{}', { status: 500 }));
    await failed;
    assert.deepEqual(plain(f.catalog.current()), [row('~/saved')]);
    f.select(null);
    await f.catalog.load();
    assert.equal(f.requests.length, 2);
    assert.deepEqual(plain(f.catalog.current()), []);
});
