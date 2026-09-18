// Generated test/tool from test/browser-harness-discovery.test.ts; edit that source and run npm run build:tests.
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
const { createHarnessDiscovery } = context.PiDishBrowser;
const catalog = (id) => ({ harnesses: [{ id, label: id, available: true }] });
function fixture() {
    let host = 'self', self = 'self', preferred = null;
    const calls = [], events = [];
    const request = (kind) => (target) => new Promise((resolve, reject) => calls.push({ kind, target, resolve, reject }));
    const discovery = createHarnessDiscovery({
        selectedHostId: () => host,
        selfHostId: () => self,
        requestPicker: request('picker'),
        requestBackground: request('background'),
        preferredHarness: () => preferred,
        onPreferredHarness: id => { events.push(['preferred', id]); },
        onPickerChange: () => { events.push(['picker']); },
        onCacheChange: () => { events.push(['cache']); },
    });
    return { discovery, calls, events, setHost: (value) => { host = value; },
        setSelf: (value) => { self = value; }, setPreferred: (value) => { preferred = value; } };
}
for (const failure of [false, true])
    test(`retired picker ${failure ? 'failure' : 'success'} cannot change rows or cache`, async () => {
        const { discovery, calls, events, setPreferred } = fixture();
        const old = discovery.load();
        const current = discovery.load();
        setPreferred('omp');
        (0, test_types_js_1.present)(calls[1]).resolve(catalog('omp'));
        await current;
        if (failure)
            (0, test_types_js_1.present)(calls[0]).reject(new Error('offline'));
        else
            (0, test_types_js_1.present)(calls[0]).resolve(catalog('pi'));
        await old;
        assert.equal((0, test_types_js_1.present)(discovery.rows()[0]).id, 'omp');
        assert.equal((0, test_types_js_1.present)(discovery.cachedRows('self'))[0]?.id, 'omp');
        assert.deepEqual(events, [['cache'], ['preferred', 'omp'], ['picker']]);
    });
test('switching hosts retires picker writes; cache keys capture the self alias before awaiting', async () => {
    const { discovery, calls, events, setHost, setSelf } = fixture();
    const old = discovery.load();
    setHost('peer');
    (0, test_types_js_1.present)(calls[0]).resolve(catalog('omp'));
    await old;
    assert.equal(discovery.cachedRows('self'), undefined);
    assert.equal(events.length, 0);
    setHost(null);
    const current = discovery.load();
    setSelf('renamed-self');
    (0, test_types_js_1.present)(calls[1]).resolve(catalog('prime'));
    await current;
    assert.equal((0, test_types_js_1.present)(discovery.cachedRows('self'))[0]?.id, 'prime');
    assert.equal(discovery.cachedRows('renamed-self'), undefined);
});
test('background discovery shares requests per host and retries failure independently', async () => {
    const { discovery, calls, events } = fixture();
    const first = discovery.ensure(null);
    assert.equal(discovery.ensure('self'), first);
    const peer = discovery.ensure('peer');
    assert.deepEqual(calls.map(call => call.target), ['self', 'peer']);
    (0, test_types_js_1.present)(calls[0]).reject(new Error('offline'));
    (0, test_types_js_1.present)(calls[1]).resolve({ harnesses: [{ id: 'omp', pilotConfig: true }] });
    await Promise.all([first, peer]);
    assert.equal(discovery.cachedRows(null), undefined);
    assert.equal((0, test_types_js_1.present)(discovery.row('peer', 'omp')).pilotConfig, true);
    assert.equal(discovery.row('self', 'omp'), null);
    await discovery.ensure('peer');
    assert.equal(calls.length, 2);
    const retry = discovery.ensure(null);
    (0, test_types_js_1.present)(calls[2]).resolve({ harnesses: [] });
    await retry;
    await discovery.ensure(null);
    assert.equal(calls.length, 3, 'successful empty catalogs are cached');
    assert.deepEqual(events, [['cache'], ['cache']]);
});
test('a delayed background catalog cannot replace a newer picker catalog', async () => {
    const { discovery, calls, events } = fixture();
    const background = discovery.ensure('self');
    const foreground = discovery.load();
    (0, test_types_js_1.present)(calls[1]).resolve({ harnesses: [{ id: 'omp', pilotConfig: true }] });
    await foreground;
    (0, test_types_js_1.present)(calls[0]).resolve(catalog('pi'));
    await background;
    assert.equal((0, test_types_js_1.present)(discovery.row('self', 'omp')).pilotConfig, true);
    assert.equal(discovery.row('self', 'pi'), null);
    assert.deepEqual(events, [['cache'], ['picker']]);
});
test('malformed rows are isolated, missing flags remain optional, and failed discovery retains the cache', async () => {
    const { discovery, calls, events, setPreferred } = fixture();
    setPreferred('disabled');
    let pending = discovery.load();
    (0, test_types_js_1.present)(calls[0]).resolve({ harnesses: [null, 7, {}, { id: 8 }, { id: '' },
            { id: 'omp', label: {}, pilotConfig: { legacy: true }, extra: 'kept' },
            { id: 'disabled', available: false }] });
    await pending;
    const first = (0, test_types_js_1.present)(discovery.rows()[0]);
    assert.deepEqual(Array.from(discovery.rows(), row => row.id), ['omp', 'disabled']);
    assert.equal(first.label, undefined);
    assert.equal(first.available, undefined);
    assert.equal(first.extra, 'kept');
    assert.deepEqual(events, [['cache'], ['picker']]);
    pending = discovery.load();
    (0, test_types_js_1.present)(calls[1]).resolve({ harnesses: [] });
    await pending;
    assert.equal((0, test_types_js_1.present)(discovery.rows()[0]).id, 'omp', 'empty response keeps the existing picker');
    pending = discovery.load();
    (0, test_types_js_1.present)(calls[2]).reject(new Error('HTTP 404'));
    await pending;
    assert.equal((0, test_types_js_1.present)(discovery.rows()[0]).id, 'pi', 'older servers retain the Pi fallback');
    assert.equal((0, test_types_js_1.present)(discovery.cachedRows('self'))[0]?.id, 'omp', 'failure does not erase settings metadata');
});
