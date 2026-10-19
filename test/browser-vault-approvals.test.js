// Generated test/tool from test/browser-vault-approvals.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { decodeVaultOverview, vaultCardsHtml, vaultPanelHtml, vaultListenerText, vaultRequestSession } = context.PiDishBrowser;
const NOW = Date.parse('2026-10-19T00:00:00Z');
const wire = {
    listener: { state: 'ready', account: 'me@example.com', stale: false },
    pending: [
        { id: 'r1', device: { name: 'desktop' }, item: 'fleet-sudo-desktop', fields: ['password'], reason: '<img src=x onerror=alert(1)>',
            session: { ref: 'desktop/01a0a845', name: 'Htpc <b>provision</b>', host: 'desktop' }, expiresAt: NOW + 95_000 },
        { id: '', item: 'dropped' }, null,
    ],
    grants: [{ id: 'g1', device: { name: 'desktop' }, item: 'github.com', fields: ['username', 'password'], sessionRef: 'desktop/01a0a845', expiresAt: NOW + 600_000 }],
    recent: [],
};
const options = { now: NOW, busy: new Set(), notice: '' };
test('the overview keeps usable requests and grants and drops malformed rows', () => {
    const view = decodeVaultOverview(wire);
    assert.deepEqual(view.pending.map(request => request.id), ['r1']);
    assert.equal(view.pending[0].sessionHost, 'desktop');
    assert.deepEqual(view.grants.map(grant => [grant.id, grant.sessionRef]), [['g1', 'desktop/01a0a845']]);
    assert.equal(decodeVaultOverview({ ...wire, listener: { state: 'open' } }).listener, null);
    assert.throws(() => decodeVaultOverview({ pending: [] }), /Invalid vault response/);
});
test('a request resolves to its session only on the host its ref names', () => {
    const [request] = decodeVaultOverview(wire).pending;
    const sessions = [
        { id: '01a0a845-cc06-772e-9e2c-51ae78b25cf6', host: 'h-framework', hostLabel: 'framework' },
        { id: '01a0a845-cc06-772e-9e2c-51ae78b25cf6', host: 'h-desktop', hostLabel: 'desktop' },
        { id: '01a0a999-0000-0000-0000-000000000000', host: 'h-desktop', hostLabel: 'desktop' },
    ];
    assert.equal(vaultRequestSession(request, sessions)?.host, 'h-desktop');
    assert.equal(vaultRequestSession(request, sessions.slice(0, 1)), null);
    assert.equal(vaultRequestSession({ ...request, sessionRef: '' }, sessions), null);
});
test('in-session cards omit the session line; panel cards link to it; claims render inert', () => {
    const view = decodeVaultOverview(wire);
    const card = vaultCardsHtml(view.pending, { ...options, inSession: true });
    assert.ok(!card.includes('data-vault-open'));
    assert.ok(!card.includes('<img'));
    assert.match(card, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(card, /in 1m 35s/);
    const panel = vaultPanelHtml(view, options);
    assert.match(panel, /data-vault-open="r1"/);
    assert.ok(!panel.includes('<b>'), 'session name markup is escaped');
    assert.match(panel, /data-vault-revoke="g1"/);
    assert.match(panel, /Vault ready \(me@example.com\)/);
});
test('an in-flight decision disables only that request', () => {
    const html = vaultCardsHtml(decodeVaultOverview(wire).pending, { ...options, busy: new Set(['r1']), inSession: true });
    assert.equal((html.match(/data-vault-decision="[a-z-]+" disabled/g) || []).length, 3);
});
test('the listener line says why an approval would not release anything', () => {
    assert.match(vaultListenerText(null), /offline/);
    assert.match(vaultListenerText({ state: 'ready', account: '', stale: true }), /offline/);
    assert.match(vaultListenerText({ state: 'locked', account: '', stale: false }), /locked/);
    assert.equal(vaultListenerText({ state: 'ready', account: 'me@example.com', stale: false }), 'Vault ready (me@example.com)');
});
