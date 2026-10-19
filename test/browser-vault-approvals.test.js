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
const { decodeVaultOverview, vaultSurfaceHtml, vaultListenerText } = context.PiDishBrowser;
const NOW = Date.parse('2026-10-19T00:00:00Z');
const wire = {
    listener: { state: 'ready', account: 'me@example.com', stale: false },
    pending: [
        { id: 'r1', device: { name: 'desktop' }, item: 'fleet-sudo-desktop', fields: ['password'], reason: '<img src=x onerror=alert(1)>',
            session: { ref: 'desktop/01a0a845', name: 'Htpc <b>provision</b>' }, expiresAt: NOW + 95_000 },
        { id: '', item: 'dropped' }, null,
    ],
    grants: [{ id: 'g1', device: { name: 'desktop' }, item: 'github.com', fields: ['username', 'password'], expiresAt: NOW + 600_000 }],
    recent: [],
};
test('the overview keeps usable requests and grants and drops malformed rows', () => {
    const view = decodeVaultOverview(wire);
    assert.deepEqual(view.pending.map(request => request.id), ['r1']);
    assert.equal(view.pending[0].sessionName, 'Htpc <b>provision</b>');
    assert.deepEqual(view.grants.map(grant => grant.id), ['g1']);
    assert.equal(decodeVaultOverview({ ...wire, listener: { state: 'open' } }).listener, null);
    assert.throws(() => decodeVaultOverview({ pending: [] }), /Invalid vault response/);
});
test('agent-supplied text renders inert and claims are labelled as reported', () => {
    const html = vaultSurfaceHtml(decodeVaultOverview(wire), { now: NOW, busy: new Set(), expanded: true, notice: '' });
    assert.ok(!html.includes('<img'), 'reason markup is escaped');
    assert.ok(!html.includes('<b>'), 'session name markup is escaped');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /Reason <small>\(reported\)<\/small>/);
    assert.match(html, /in 1m 35s/);
    assert.match(html, /data-vault-decision="approve-window"/);
    assert.match(html, /data-vault-revoke="g1"/);
    // A pending request has no close button: it must be answered or expire.
    assert.ok(!html.includes('data-vault-action="collapse"'));
});
test('an in-flight decision disables only that request', () => {
    const view = decodeVaultOverview(wire);
    const html = vaultSurfaceHtml(view, { now: NOW, busy: new Set(['r1']), expanded: true, notice: '' });
    assert.equal((html.match(/data-vault-decision="[a-z-]+" disabled/g) || []).length, 3);
});
test('the collapsed surface is a pill counting open windows', () => {
    const view = { ...decodeVaultOverview(wire), pending: [] };
    assert.match(vaultSurfaceHtml(view, { now: NOW, busy: new Set(), expanded: false, notice: '' }), /1 vault window open/);
});
test('the listener line says why an approval would not release anything', () => {
    assert.match(vaultListenerText(null), /offline/);
    assert.match(vaultListenerText({ state: 'ready', account: '', stale: true }), /offline/);
    assert.match(vaultListenerText({ state: 'locked', account: '', stale: false }), /locked/);
    assert.equal(vaultListenerText({ state: 'ready', account: 'me@example.com', stale: false }), 'Vault ready (me@example.com)');
});
