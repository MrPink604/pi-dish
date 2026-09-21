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
function render(overrides = {}) {
    return renderSidebar({ active: [], previous: [], selected: null, tab: 'all', view: 'workspace', query: '', queriedFor: '', scope: '', indexing: false,
        contextMetric: 'percent', pending: [], selectedSpawn: null, expanded: new Set(), collapsed: new Set(), pinned: [], roots: new Map(),
        closeConfirm: null, closeBusy: null, multiHost: false, hosts: [], unread: () => false, hostChip: () => '', ...overrides });
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
