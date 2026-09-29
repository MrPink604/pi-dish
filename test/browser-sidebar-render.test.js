// Generated test/tool from test/browser-sidebar-render.test.ts; edit that source and run npm run build:tests.
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
const { renderSidebar } = context.PiDishBrowser;
function options(overrides = {}) {
    return { active: [], previous: [], selected: null, tab: 'all', view: 'workspace', query: '', queriedFor: '', scope: '', indexing: false,
        contextMetric: 'percent', pending: [], selectedSpawn: null, expanded: new Set(), collapsed: new Set(), pinned: [], roots: new Map(),
        closeConfirm: null, closeBusy: null, multiHost: false, hosts: [], unread: () => false, hostChip: () => '', ...overrides };
}
function render(overrides = {}) {
    return renderSidebar(options(overrides));
}
/** Run `body` with the vm's clock frozen at `start`, movable by the callback. */
function withClock(start, body) {
    const previous = Reflect.get(context, 'Date');
    let now = start;
    Reflect.set(context, 'Date', class extends Date {
        constructor(...args) { super(args.length ? args[0] : now); }
        static now() { return now; }
    });
    try {
        return body(ms => { now += ms; });
    }
    finally {
        if (previous === undefined)
            Reflect.deleteProperty(context, 'Date');
        else
            Reflect.set(context, 'Date', previous);
    }
}
test('sidebar presents decoded optional fields and retains explicit null family boundaries', () => {
    const parent = { id: 'parent', name: '<parent>', cwd: '/repo' };
    const implicitChild = { id: 'child', parentId: 'parent', cwd: '/repo', name: 'implicit child' };
    const separated = { id: 'separate', parentId: 'parent', familyParentId: null, cwd: '/repo', name: 'separate child' };
    const { html } = render({ previous: [parent, implicitChild, separated] });
    assert.match(html, /&lt;parent&gt;/);
    assert.match(html, /separate child/);
    assert.doesNotMatch(html, /implicit child/);
    assert.match(html, /0%/);
    assert.equal(Object.hasOwn(implicitChild, 'familyParentId'), false);
    assert.equal(separated.familyParentId, null);
});
test('sidebar places the warning cache countdown immediately before context', () => {
    const cacheExpiry = { refreshedAt: Date.now(), expiresAt: Date.now() + 4 * 60_000,
        retentionMs: 5 * 60_000, retention: '5m', basis: 'fixed', identity: '' };
    const { html } = render({ previous: [{ id: 'cached', name: 'Cached', cwd: '/repo',
                contextPercent: 42, cacheExpiry }] });
    assert.match(html, /session-item-cache warning[^>]*>~4m<\/span>/);
    assert.ok(html.indexOf('session-item-cache') < html.indexOf('session-item-context'), 'cache countdown precedes context utilization');
});
test('sidebar replaces an expired countdown with the cold-cache glyph', () => {
    const cacheExpiry = { refreshedAt: Date.now() - 6 * 60_000, expiresAt: Date.now() - 60_000,
        retentionMs: 5 * 60_000, retention: '5m', basis: 'fixed', identity: '' };
    const { html } = render({ previous: [{ id: 'cold', name: 'Cold', cwd: '/repo',
                contextPercent: 42, cacheExpiry }] });
    assert.match(html, /session-item-cache cold[^>]*title="Cache likely cold · 5m retention"[^>]*aria-label="Cache likely cold · 5m retention"[^>]*>❄<\/span>/);
    assert.doesNotMatch(html, /&lt;1m/);
});
test('host-qualified workspace collapse and family status stay independent for identical ids and paths', () => {
    const hosts = ['self', 'peer'].map(hostId => ({ hostId, label: hostId, state: 'reachable', key: hostId, color: '#abc', dot: '', hasCache: true }));
    const active = ['self', 'peer'].flatMap(host => [{ id: 'parent', host, cwd: '/repo', name: host + ' parent', isActive: true },
        { id: 'child', host, cwd: '/repo', name: host + ' child', parentId: 'parent', isActive: true, turnInProgress: host === 'peer' }]);
    const { html, count } = render({ active, hosts, multiHost: true, collapsed: new Set(['self /repo']), selected: active[2] });
    assert.equal(count, 4);
    assert.match(html, /data-cwd="self \/repo"/);
    assert.doesNotMatch(html, /self parent/);
    assert.match(html, /peer parent/);
    assert.match(html, /Session family working/);
    assert.match(html, /session-item active/);
    assert.doesNotMatch(html, /peer child/);
});
test('sidebar shows the asking bubble ahead of the working pulse', () => {
    const active = [{ id: 'blocked', name: 'Blocked', cwd: '/repo', isActive: true, askPending: true, turnInProgress: true },
        { id: 'busy', name: 'Busy', cwd: '/repo', isActive: true, turnInProgress: true }];
    const { html } = render({ active });
    assert.match(html, /data-id="blocked"[\s\S]*?session-item-status asking" title="Waiting for an answer to a question">\?</);
    assert.doesNotMatch(html, /data-id="blocked"[\s\S]*?session-item-status working[\s\S]*?data-id="busy"/);
    assert.match(html, /data-id="busy"[\s\S]*?session-item-status working/);
});
test('collapsed family aggregates a blocked child into the asking bubble', () => {
    const active = [{ id: 'parent', name: 'Parent', cwd: '/repo', isActive: true },
        { id: 'child', name: 'Child', cwd: '/repo', parentId: 'parent', isActive: true, askPending: true }];
    const { html } = render({ active });
    assert.doesNotMatch(html, />Child</);
    assert.match(html, /session-item-status asking/);
});
test('server content search stays authoritative while scopes and automation remain visible in audit notes', () => {
    const previous = [{ id: 'match', name: '<b>content match</b>', cwd: '/repo', searchScore: 12, searchSnippet: 'needle <img>', routine: '' },
        { id: 'auto', name: 'robot', routine: 'daily' }];
    const result = render({ previous, query: 'needle', queriedFor: 'needle' });
    assert.match(result.html, /&lt;b&gt;content match&lt;\/b&gt;/);
    assert.match(result.html, /&lt;img&gt;/);
    assert.match(result.html, /1 automation run hidden/);
    assert.doesNotMatch(result.html, /robot/);
    const scoped = render({ previous, query: 'needle', queriedFor: 'needle', scope: 'name:absent' });
    assert.match(scoped.html, /1 hidden by scopes/);
});
test('debounced ranking preserves metadata tie order under equal stale server scores', () => {
    const previous = [
        { id: 'metadata', name: 'Other', cwd: '/work', searchScore: 10, lastActivity: 1000 },
        { id: 'named', name: 'Work', cwd: '/repo', searchScore: 10, lastActivity: 1000 },
        { id: 'content', name: 'Content only', cwd: '/repo', searchScore: 20, lastActivity: 1000 },
    ];
    const interim = render({ previous, query: 'work', queriedFor: 'old' }).html;
    assert.ok(interim.indexOf('data-id="named"') < interim.indexOf('data-id="metadata"'));
    assert.doesNotMatch(interim, /data-id="content"/);
    const authoritative = render({ previous, query: 'work', queriedFor: 'work' }).html;
    assert.ok(authoritative.indexOf('data-id="content"') < authoritative.indexOf('data-id="metadata"'));
    assert.ok(authoritative.indexOf('data-id="metadata"') < authoritative.indexOf('data-id="named"'));
});
test('an unchanged poll reuses the sidebar projection while semantic changes rebuild it', () => {
    const memo = {};
    const first = renderSidebar(options(), memo);
    assert.equal(renderSidebar(options(), memo), first, 'equal inputs reuse the built projection');
    const renamed = renderSidebar(options({ previous: [{ id: 'a', name: 'Renamed', cwd: '/repo' }] }), memo);
    assert.notEqual(renamed, first, 'a renamed session rebuilds');
    assert.match(renamed.html, /Renamed/);
    assert.equal(renderSidebar(options({ previous: [{ id: 'a', name: 'Renamed', cwd: '/repo' }] }), memo), renamed);
});
test('unread, selection, pins, host health and query state invalidate the reused projection', () => {
    const memo = {};
    const row = { id: 'a', name: 'Alpha', cwd: '/repo', isActive: false };
    const idle = renderSidebar(options({ active: [row] }), memo);
    const unread = renderSidebar(options({ active: [row], unread: () => true }), memo);
    assert.notEqual(unread, idle);
    assert.match(unread.html, /session-item-status unread/);
    const selected = renderSidebar(options({ active: [row], selected: row }), memo);
    assert.notEqual(selected, unread);
    assert.match(selected.html, /session-item active/);
    const pinned = renderSidebar(options({ active: [row], pinned: ['a'] }), memo);
    assert.notEqual(pinned, selected);
    assert.match(pinned.html, /pinned-header/);
    const host = { hostId: 'peer', label: 'Peer', state: 'reachable', key: 'peer', color: '#abc', dot: '', hasCache: true };
    const peer = { id: 'p', name: 'Peer root', cwd: '/repo', host: 'peer', isActive: true, lastActivity: 1 };
    const online = renderSidebar(options({ active: [peer], multiHost: true, hosts: [host] }), memo);
    const offline = renderSidebar(options({ active: [peer], multiHost: true, hosts: [{ ...host, state: 'backoff' }] }), memo);
    assert.notEqual(offline, online);
    assert.match(offline.html, /host-section offline/);
    const searched = renderSidebar(options({ active: [peer], multiHost: true, hosts: [host], query: 'peer' }), memo);
    assert.notEqual(searched, offline);
    assert.match(searched.html, /ranked-segment/);
});
test('relative-time labels roll with the clock while a poll inside their bucket reuses the projection', () => {
    withClock(1_700_000_000_000, advance => {
        const memo = {};
        const lastActivity = 1_700_000_000_000 - 90_000;
        const at = () => options({ active: [{ id: 'a', name: 'Alpha', cwd: '/repo', isActive: true, lastActivity }] });
        const first = renderSidebar(at(), memo);
        assert.match(first.html, /1m ago/);
        advance(5_000);
        assert.equal(renderSidebar(at(), memo), first, 'an unchanged poll inside the minute reuses');
        advance(55_000);
        const rolled = renderSidebar(at(), memo);
        assert.notEqual(rolled, first, 'the next minute rebuilds the label');
        assert.match(rolled.html, /2m ago/);
    });
});
test('the cache countdown rolls its minute while sub-minute polls reuse the projection', () => {
    withClock(1_700_000_000_000, advance => {
        const memo = {};
        const cacheExpiry = { refreshedAt: 1_700_000_000_000, expiresAt: 1_700_000_000_000 + 4 * 60_000 + 20_000,
            retentionMs: 5 * 60_000, retention: '5m', basis: 'fixed' };
        const at = () => options({ active: [{ id: 'a', name: 'Alpha', cwd: '/repo', cacheExpiry: { ...cacheExpiry } }] });
        const first = renderSidebar(at(), memo);
        assert.match(first.html, /~5m/);
        advance(10_000);
        assert.equal(renderSidebar(at(), memo), first, 'a sub-minute countdown tick reuses');
        advance(50_000);
        assert.notEqual(renderSidebar(at(), memo), first, 'the countdown minute rolls');
    });
});
test('the sidebar without a memo still builds an independent projection', () => {
    assert.notEqual(render(), render());
});
