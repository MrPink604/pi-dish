import { loadBrowser } from './browser-vm.js';
import test = require('node:test');
import assert = require('node:assert/strict');
const { decodeVaultOverview, vaultCardsHtml, vaultPanelHtml, vaultListenerText, vaultRequestSession } = loadBrowser();

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
const options = { now: NOW, busy: new Set<string>(), notice: '' };

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

test('a create card names the folder and offers no window', () => {
  const [request] = decodeVaultOverview({ ...wire, pending: [{ ...wire.pending[0], action: 'create', item: 'grafana', folder: '<i>agent-created</i>', fields: ['password', 'uri'] }] }).pending;
  const html = vaultCardsHtml([request], { ...options, inSession: true });
  assert.match(html, /➕ Create grafana/);
  assert.match(html, /&lt;i&gt;agent-created&lt;\/i&gt;/);
  assert.ok(!html.includes('approve-window'));
});

test('the listener line says why an approval would not release anything', () => {
  assert.match(vaultListenerText(null), /offline/);
  assert.match(vaultListenerText({ state: 'ready', account: '', stale: true }), /offline/);
  assert.match(vaultListenerText({ state: 'locked', account: '', stale: false }), /locked/);
  assert.equal(vaultListenerText({ state: 'ready', account: 'me@example.com', stale: false }), 'Vault ready (me@example.com)');
});

test('cards show origin, match badge, policy name, and hide Approve 15 min when allowWindow is false', () => {
  const policyWire = {
    ...wire,
    pending: [
      {
        id: 'r-match',
        device: { name: 'cu-sandbox-proxy', fingerprint: 'cc'.repeat(16) },
        action: 'release',
        itemId: 'bw-1',
        item: 'Acme Portal',
        folder: 'cu-sandbox',
        fields: ['username', 'password'],
        origin: 'https://portal.acme.com',
        originMatch: 'match',
        allowWindow: false,
        policyName: 'cu-sandbox<script>',
        policyResult: 'allowed',
        reason: 'sign in',
        session: null,
        expiresAt: NOW + 90_000,
      },
      {
        id: 'r-mismatch',
        device: { name: 'desktop', fingerprint: 'ab'.repeat(16) },
        action: 'release',
        item: 'Other',
        fields: ['password'],
        origin: 'https://evil.example',
        originMatch: 'mismatch',
        allowWindow: true,
        policyName: null,
        expiresAt: NOW + 90_000,
      },
      {
        id: 'r-legacy',
        device: { name: 'desktop' },
        item: 'Legacy Item',
        fields: ['password'],
        expiresAt: NOW + 90_000,
      },
    ],
  };
  const view = decodeVaultOverview(policyWire);
  assert.equal(view.pending.length, 3);
  assert.equal(view.pending[0].allowWindow, false);
  assert.equal(view.pending[0].origin, 'https://portal.acme.com');
  assert.equal(view.pending[0].originMatch, 'match');
  assert.equal(view.pending[0].policyName, 'cu-sandbox<script>');
  assert.equal(view.pending[1].allowWindow, true);
  assert.equal(view.pending[1].originMatch, 'mismatch');
  assert.equal(view.pending[2].allowWindow, true);
  assert.equal(view.pending[2].originMatch, 'no-origin');

  const restrictedHtml = vaultCardsHtml([view.pending[0]], { ...options, inSession: false });
  assert.match(restrictedHtml, /https:\/\/portal\.acme\.com/);
  assert.match(restrictedHtml, /data-vault-origin-match="match">exact match/);
  assert.match(restrictedHtml, /cu-sandbox&lt;script&gt;/);
  assert.ok(!restrictedHtml.includes('<script>'));
  assert.ok(!restrictedHtml.includes('approve-window'), 'window button must be hidden when allowWindow is false');

  const mismatchHtml = vaultCardsHtml([view.pending[1]], { ...options, inSession: false });
  assert.match(mismatchHtml, /https:\/\/evil\.example/);
  assert.match(mismatchHtml, /data-vault-origin-match="mismatch">mismatch/);
  assert.ok(mismatchHtml.includes('approve-window'));

  const legacyHtml = vaultCardsHtml([view.pending[2]], { ...options, inSession: false });
  assert.match(legacyHtml, /data-vault-origin-match="no-origin">no origin/);
  assert.ok(!legacyHtml.includes('data-vault-policy'));
  assert.ok(legacyHtml.includes('approve-window'));

  // Old cached JS contract decoding a new server payload: additive fields must still yield a renderable card.
  const legacyDecode = (value: { pending: readonly Record<string, unknown>[] }) => value.pending.flatMap(entry => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.expiresAt !== 'number' || !Number.isFinite(entry.expiresAt)) return [];
    const device = entry.device && typeof entry.device === 'object' ? entry.device as Record<string, unknown> : {};
    const session = entry.session && typeof entry.session === 'object' ? entry.session as Record<string, unknown> : {};
    return [{
      id: entry.id,
      device: typeof device.name === 'string' ? device.name : '',
      action: entry.action === 'create' ? 'create' : 'release',
      item: typeof entry.item === 'string' ? entry.item : '',
      folder: typeof entry.folder === 'string' ? entry.folder : '',
      fields: Array.isArray(entry.fields) ? entry.fields.filter((f): f is string => typeof f === 'string') : [],
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      sessionName: typeof session.name === 'string' ? session.name : '',
      sessionRef: typeof session.ref === 'string' ? session.ref : '',
      sessionHost: typeof session.host === 'string' ? session.host : '',
      expiresAt: entry.expiresAt,
    }];
  });
  const legacyDecoded = legacyDecode(policyWire as { pending: readonly Record<string, unknown>[] });
  assert.equal(legacyDecoded.length, 3);
  assert.equal(legacyDecoded[0].id, 'r-match');
  assert.equal(legacyDecoded[0].item, 'Acme Portal');
  assert.deepEqual(legacyDecoded[0].fields, ['username', 'password']);
});

export {};
