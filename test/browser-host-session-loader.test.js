// Generated test/tool from test/browser-host-session-loader.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const xmldom_1 = require("@xmldom/xmldom");
const test_types_js_1 = require("./test-types.js");
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const { stripQueryField } = require('../lib/helper-query');
const { decodeSessionList } = require('../lib/session-api');
const context = { URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { createHostSessionLoader, createSessionState, createSidebarLists, ApiHttpError } = context.PiDishBrowser;
const at = (values, index) => (0, test_types_js_1.present)(values[index]);
function fixture() {
    let sequence = 1;
    const calls = [], events = [];
    const loader = createHostSessionLoader({
        requestList: (host, requestPath, options) => new Promise((resolve, reject) => calls.push({
            host, path: requestPath, options, resolve: (wire) => resolve(decodeSessionList(wire)), reject,
        })),
        currentSequence: () => sequence,
        stripHostQuery: query => stripQueryField(query, 'host'),
        onConnection: (currentHost, event) => { events.push({ type: 'connection', host: currentHost, event }); },
        onIndexing: () => { events.push({ type: 'indexing' }); },
        beforePublish: (currentHost, lists, wireQuery) => { events.push({ type: 'before', host: currentHost, lists, wireQuery }); },
        onPublish: query => { events.push({ type: 'publish', query }); },
        onError: (currentHost, error) => { events.push({ type: 'error', host: currentHost, error }); },
    });
    return { loader, calls, events, setSequence: (value) => { sequence = value; } };
}
const host = { hostId: 'peer', base: '/hosts/peer' };
const rows = (name) => ({ active: [{ id: 'one', name }], previous: [] });
test('identical host polls share a request and publish for the newest joining query', async () => {
    const { loader, calls, events, setSequence } = fixture();
    const first = loader.load(host, 'host:old needle', false, 1);
    setSequence(2);
    const joined = loader.load(host, 'host:new needle', false, 2);
    assert.equal(first, joined);
    assert.equal(calls.length, 1);
    const url = new URL(at(calls, 0).path, 'http://fixture');
    assert.equal(url.searchParams.get('q'), 'needle');
    assert.equal(url.searchParams.get('active'), '1');
    assert.equal(url.searchParams.get('view'), 'client');
    assert.equal(at(calls, 0).options.timeoutMs, 20000);
    at(calls, 0).resolve(rows('current'));
    await joined;
    assert.deepEqual(events.map(event => event.type), ['connection', 'before', 'publish']);
    assert.equal(at(events, 1).wireQuery, 'needle');
    assert.equal(at(events, 2).query, 'host:new needle');
    assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).name, 'current');
});
test('superseded responses cannot publish or clear a newer in-flight request', async () => {
    const { loader, calls, events, setSequence } = fixture();
    const first = loader.load(host, 'old', true, 1);
    setSequence(2);
    const second = loader.load(host, 'new', true, 2);
    at(calls, 0).resolve(rows('stale'));
    await first;
    assert.equal(loader.getCache(host), undefined);
    assert.equal(events.length, 0);
    assert.equal(loader.load(host, 'new', true, 2), second, 'old finally must not erase the new request');
    assert.equal(calls.length, 2);
    at(calls, 1).resolve(rows('fresh'));
    await second;
    assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).name, 'fresh');
});
test('hosts publish independently and an obsolete fan-out cannot change cached rows', async () => {
    const { loader, calls, events, setSequence } = fixture();
    const self = { hostId: 'self', base: '', self: true };
    const slow = loader.load(host, undefined, true, 1);
    const fast = loader.load(self, undefined, true, 1);
    at(calls, 1).resolve(rows('local'));
    await fast;
    assert.equal(at((0, test_types_js_1.present)(loader.getCache(self)).active, 0).name, 'local');
    assert.equal(loader.getCache(host), undefined);
    setSequence(2);
    at(calls, 0).resolve(rows('obsolete query'));
    await slow;
    assert.equal(loader.getCache(host), undefined);
    assert.equal(events.filter(event => event.type === 'publish').length, 1);
});
test('active polls preserve advisory family hints and merge live children until a full refresh', async () => {
    const { loader, calls, events } = fixture();
    let pending = loader.load(host, undefined, true, 1);
    at(calls, 0).resolve({
        active: [{ id: 'one', parentId: 'parent', parentSource: 'native', familyParentId: 'family' }],
        previous: [{ id: 'child', name: 'old', subagentLive: true }, { id: 'finished', subagentLive: true }], indexing: true,
    });
    await pending;
    assert.equal(loader.isIndexing(), true);
    assert.equal(events.filter(event => event.type === 'indexing').length, 1);
    pending = loader.load(host, undefined, false, 1);
    const incoming = {
        active: [{ id: 'one', name: 'fresh' }], previous: [],
        children: [{ id: 'child', name: 'live', subagentLive: true }, { id: 'new', subagentLive: true }],
    };
    at(calls, 1).resolve(incoming);
    await pending;
    const cached = (0, test_types_js_1.present)(loader.getCache(host));
    assert.equal(at(cached.active, 0).parentId, 'parent');
    assert.equal(at(cached.active, 0).parentSource, 'native');
    assert.equal(at(cached.active, 0).familyParentId, 'family');
    assert.equal(at(incoming.active, 0).parentId, undefined, 'hint merging does not mutate the wire row');
    assert.deepEqual(Array.from(cached.previous, row => [row.id, row.name, row.subagentLive]), [
        ['child', 'live', true], ['finished', undefined, false], ['new', undefined, true],
    ]);
    assert.equal(loader.isIndexing(), true, 'active-only responses cannot end full-list indexing');
    pending = loader.load(host, undefined, true, 1);
    at(calls, 2).resolve(rows('full refresh'));
    await pending;
    assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).parentId, undefined);
    assert.equal((0, test_types_js_1.present)(loader.getCache(host)).previous.length, 0);
    assert.equal(loader.isIndexing(), false);
});
test('failed and unauthorized polls retain cached rows and report the current host state', async () => {
    const { loader, calls, events } = fixture();
    let pending = loader.load(host, undefined, true, 1);
    at(calls, 0).resolve(rows('cached'));
    await pending;
    events.length = 0;
    pending = loader.load(host, undefined, true, 1);
    at(calls, 1).reject(new ApiHttpError('Unauthorized', 401));
    await pending;
    assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).name, 'cached');
    assert.deepEqual(events.map(event => event.type), ['connection', 'publish']);
    assert.equal(at(events, 0).event, 'blocked');
    assert.equal(at(events, 1).query, undefined, 'a failure must not claim the lists match a different query');
    events.length = 0;
    pending = loader.load(host, undefined, true, 1);
    const offline = new Error('offline');
    at(calls, 2).reject(offline);
    await pending;
    assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).name, 'cached');
    assert.deepEqual(events.map(event => event.type), ['connection', 'error', 'publish']);
    assert.equal((0, test_types_js_1.record)(at(events, 0).event).error, offline);
});
test('pruning retires old requests even when the same host is added again', async () => {
    const { loader, calls, events } = fixture();
    let pending = loader.load(host, undefined, true, 1);
    at(calls, 0).resolve({ ...rows('cached'), indexing: true });
    await pending;
    const old = loader.load(host, undefined, true, 1);
    loader.prune(new Set());
    assert.equal(loader.getCache(host), undefined);
    assert.equal(loader.isIndexing(), false);
    events.length = 0;
    pending = loader.load(host, undefined, true, 1);
    at(calls, 2).resolve(rows('replacement'));
    await pending;
    const count = events.length;
    at(calls, 1).resolve({ ...rows('retired'), indexing: true });
    await old;
    assert.equal(events.length, count);
    assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).name, 'replacement');
    assert.equal(loader.isIndexing(), false);
});
test('a changed host endpoint starts a new request and a retired 401 cannot block its success', async () => {
    const { loader, calls, events } = fixture();
    const mutable = { ...host, token: 'fixture-old' };
    const old = loader.load(mutable, undefined, true, 1);
    mutable.base = '/hosts/replacement';
    mutable.token = 'fixture-new';
    const replacement = loader.load(mutable, undefined, true, 1);
    assert.notEqual(old, replacement);
    assert.equal((0, test_types_js_1.record)(at(calls, 0).host).base, '/hosts/peer');
    assert.equal((0, test_types_js_1.record)(at(calls, 0).host).token, 'fixture-old');
    assert.equal(Object.isFrozen(at(calls, 0).host), true);
    at(calls, 1).resolve(rows('replacement'));
    await replacement;
    const count = events.length;
    at(calls, 0).reject(new ApiHttpError('Unauthorized', 401));
    await old;
    assert.equal(events.length, count);
    assert.equal(at((0, test_types_js_1.present)(loader.getCache(mutable)).active, 0).name, 'replacement');
});
for (const hint of [undefined, null, '']) {
    test(`active-only hints preserve prior parent and family for ${String(hint)} while full scans replace them`, async () => {
        const { loader, calls } = fixture();
        let pending = loader.load(host, undefined, true, 1);
        at(calls, 0).resolve({ active: [{ id: 'one', parentId: 'parent', parentSource: 'native', familyParentId: 'family' }], previous: [] });
        await pending;
        const incoming = { active: [{ id: 'one', parentId: hint, parentSource: null, familyParentId: hint }], previous: [] };
        pending = loader.load(host, undefined, false, 1);
        at(calls, 1).resolve(incoming);
        await pending;
        assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).parentId, 'parent');
        assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).parentSource, 'native');
        assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).familyParentId, 'family');
        pending = loader.load(host, undefined, true, 1);
        at(calls, 2).resolve(incoming);
        await pending;
        assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).parentId, hint);
        assert.equal(at((0, test_types_js_1.present)(loader.getCache(host)).active, 0).familyParentId, hint);
    });
}
test('acknowledged metadata survives failed fan-out and partial child replay through sidebar publication', async () => {
    const calls = [];
    const hosts = [{ hostId: 'self', base: '', self: true }, host];
    const state = createSessionState({
        getSelfHostId: () => 'self', getHostLabel: hostId => hostId,
        onListsChanged() { }, onCurrentChanged() { },
    });
    const fixtureDocument = new xmldom_1.DOMParser().parseFromString('<html><body/></html>', 'text/html');
    Object.defineProperties(fixtureDocument, {
        hidden: { value: false },
        querySelector: { value: () => null },
    });
    const lists = createSidebarLists({
        document: fixtureDocument,
        sessionState: state,
        activity: { reload() { }, mark() { }, unread() { return false; }, title() { }, prune() { }, migrate() { } },
        hosts: () => hosts, pollable: () => hosts, selfId: () => 'self', query: () => '', all: () => true,
        refreshFleet() { }, connection() { },
        request: (target, requestPath) => new Promise((resolve, reject) => calls.push({
            target, path: requestPath, reject, resolve: (wire) => resolve(new Response(JSON.stringify(wire))),
        })),
    });
    try {
        let pending = lists.load();
        at(calls, 0).resolve({ active: [{ id: 'same', name: 'local' }], previous: [] });
        at(calls, 1).resolve({
            active: [{ id: 'same', name: 'remote', model: 'old/model' }],
            previous: [{ id: 'child', name: 'old child', model: 'old/child', subagentLive: true }],
        });
        await pending;
        state.setCurrentSession('child', 'peer');
        pending = lists.load(undefined, { withPrevious: false });
        state.patchSession('same', { name: 'remote acknowledgement', model: 'ack/model' }, 'peer');
        state.patchSession('child', { name: 'child acknowledgement', model: 'ack/child' }, 'peer');
        at(calls, 2).resolve({ active: [{ id: 'same', name: 'fresh local' }], previous: [] });
        at(calls, 3).reject(new Error('peer offline'));
        await pending;
        assert.equal((0, test_types_js_1.present)(state.findSession('same', 'self')).name, 'fresh local');
        assert.equal((0, test_types_js_1.present)(state.findSession('same', 'peer')).name, 'remote acknowledgement');
        assert.equal((0, test_types_js_1.present)(state.findSession('same', 'peer')).model, 'ack/model');
        assert.equal(at((0, test_types_js_1.present)(lists.loader.getCache(host)).active, 0).model, 'ack/model');
        assert.equal((0, test_types_js_1.present)(state.currentSession).model, 'ack/child');
        pending = lists.load(undefined, { withPrevious: false });
        state.patchSession('child', { name: 'new child acknowledgement' }, 'peer');
        state.patchSessionActivity('child', { compacting: true }, 'peer');
        at(calls, 4).reject(new ApiHttpError('Unauthorized', 401));
        at(calls, 5).resolve({
            active: [{ id: 'same', name: 'fresh remote' }], previous: [],
            children: [{ id: 'child', subagentLive: true, turnInProgress: false }],
        });
        await pending;
        assert.equal((0, test_types_js_1.present)(state.findSession('same', 'self')).name, 'fresh local');
        assert.equal((0, test_types_js_1.present)(state.findSession('same', 'peer')).name, 'fresh remote', 'fresh HTTP facts remain authoritative');
        assert.equal((0, test_types_js_1.present)(state.findSession('same', 'peer')).model, undefined, 'fresh active rows do not inherit omitted metadata');
        const child = (0, test_types_js_1.present)(state.findSession('child', 'peer'));
        assert.equal(child.name, 'new child acknowledgement');
        assert.equal(child.model, 'ack/child');
        assert.equal(child.compacting, true);
        assert.equal(child.turnInProgress, false);
        assert.equal((0, test_types_js_1.present)(state.currentSession).name, 'new child acknowledgement');
        assert.equal(at((0, test_types_js_1.present)(lists.loader.getCache(host)).previous, 0).model, 'ack/child');
        state.mergeCurrentSession(state.captureSelection(), { model: 'transcript/only' });
        assert.equal((0, test_types_js_1.present)(state.currentSession).model, 'transcript/only');
        assert.equal(at((0, test_types_js_1.present)(lists.loader.getCache(host)).previous, 0).model, 'ack/child', 'transcript metadata cannot enter the borrowed list cache');
    }
    finally {
        lists.dispose();
    }
});
test('ask-blocked toast fires once per transition and skips the selected session', async () => {
    const calls = [];
    const blocked = [];
    const state = createSessionState({
        getSelfHostId: () => 'self', getHostLabel: hostId => hostId,
        onListsChanged() { }, onCurrentChanged() { },
    });
    const fixtureDocument = new xmldom_1.DOMParser().parseFromString('<html><body/></html>', 'text/html');
    Object.defineProperties(fixtureDocument, {
        hidden: { value: false },
        querySelector: { value: () => null },
    });
    const hosts = [{ hostId: 'self', base: '', self: true }];
    const lists = createSidebarLists({
        document: fixtureDocument,
        sessionState: state,
        activity: { reload() { }, mark() { }, unread() { return false; }, title() { }, prune() { }, migrate() { } },
        hosts: () => hosts, pollable: () => hosts, selfId: () => 'self', query: () => '', all: () => true,
        refreshFleet() { }, connection() { }, askBlocked: session => blocked.push(session.id),
        request: () => new Promise(resolve => calls.push({
            resolve: (wire) => resolve(new Response(JSON.stringify(wire))),
        })),
    });
    try {
        let pending = lists.load();
        at(calls, 0).resolve({ active: [{ id: 'one', askPending: true }, { id: 'two', askPending: true }], previous: [] });
        await pending;
        assert.deepEqual(blocked, ['one', 'two']);
        pending = lists.load();
        at(calls, 1).resolve({ active: [{ id: 'one', askPending: true }, { id: 'two', askPending: true }], previous: [] });
        await pending;
        assert.deepEqual(blocked, ['one', 'two'], 'a confirming poll does not re-toast');
        state.setCurrentSession('one', 'self');
        pending = lists.load();
        at(calls, 2).resolve({ active: [{ id: 'one', askPending: false }, { id: 'two', askPending: true }], previous: [] });
        await pending;
        pending = lists.load();
        at(calls, 3).resolve({ active: [{ id: 'one', askPending: true }, { id: 'two', askPending: true }], previous: [] });
        await pending;
        assert.deepEqual(blocked, ['one', 'two'], 'the selected session shows its own ask dialog instead of a toast');
        state.setCurrentSession(null);
        pending = lists.load();
        at(calls, 4).resolve({ active: [{ id: 'one', askPending: true }, { id: 'two', askPending: false }], previous: [] });
        await pending;
        pending = lists.load();
        at(calls, 5).resolve({ active: [{ id: 'one', askPending: true }, { id: 'two', askPending: true }], previous: [] });
        await pending;
        assert.deepEqual(blocked, ['one', 'two', 'two'], 'a session whose ask cleared and returned re-arms');
    }
    finally {
        lists.dispose();
    }
});
