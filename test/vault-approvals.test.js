// Generated test/tool from test/vault-approvals.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Vault approvals (lib/vault-approvals.js): the request lifecycle the
 * listener polls, time-boxed grants, input validation, and the loopback
 * bridge's admission rules against a real server — including that the fleet
 * proxy can never carry a request into a peer's bridge, even when the peer is
 * reached over loopback and the caller holds the token.
 *
 * HOME points at a temp dir so ~/.pi/dish/{vault/bridge.token,settings.json} are per-run state.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test_types_js_1 = require("./test-types.js");
const vault_approvals_1 = require("../lib/vault-approvals");
const originalHome = process.env.HOME;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-vault-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
const T0 = Date.parse('2026-10-19T00:00:00Z');
const device = { name: 'desktop', fingerprint: 'ab'.repeat(32) };
const restrictedDevice = { name: 'cu-sandbox-proxy', fingerprint: 'cc'.repeat(32) };
const session = { ref: 'desktop/01a0a845', name: 'Htpc provision', host: 'desktop' };
function vault(options = {}) {
    const clock = { now: T0 };
    const notified = [];
    const stateDir = fs.mkdtempSync(path.join(tmpHome, 'case-'));
    const policyPath = path.join(stateDir, 'vault', vault_approvals_1.VAULT_POLICY_FILE);
    const enrolledPath = path.join(stateDir, 'vault', vault_approvals_1.VAULT_ENROLLED_FILE);
    const auditPath = path.join(stateDir, vault_approvals_1.VAULT_AUDIT_FILE);
    const writePolicy = (data) => {
        fs.mkdirSync(path.dirname(policyPath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(policyPath, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    };
    if (options.rawPolicyText !== undefined)
        writePolicy(options.rawPolicyText);
    else if (options.policy !== undefined)
        writePolicy(options.policy);
    const instance = (0, vault_approvals_1.createVaultApprovals)({
        notify: request => notified.push(request),
        now: () => clock.now,
        policyFile: () => policyPath,
        enrolledFile: () => enrolledPath,
        auditFile: () => auditPath,
        auditMaxBytes: options.auditMaxBytes,
    });
    return { instance, clock, notified, stateDir, policyPath, enrolledPath, auditPath, writePolicy };
}
let nextId = 0;
function create(instance, overrides = {}) {
    nextId += 1;
    return instance.createRequest({
        id: `request-${String(nextId).padStart(4, '0')}`, device, item: 'fleet-sudo-desktop', fields: ['password'],
        reason: 'install rocprofiler', session, expiresAt: T0 + 60_000, ...overrides,
    });
}
function created(instance, overrides = {}) {
    const result = create(instance, overrides);
    assert.ok(result.ok, result.ok ? '' : result.error);
    return result.value;
}
test('a request is pending until decided once; a second decision conflicts', () => {
    const { instance, notified } = vault();
    const approved = created(instance);
    assert.equal(approved.status, 'pending');
    assert.deepEqual(notified.map(request => request.id), [approved.id]);
    assert.deepEqual(instance.overview().pending.map(request => request.id), [approved.id]);
    const decision = instance.decide(approved.id, 'approve');
    assert.ok(decision.ok);
    assert.equal(decision.value.status, 'approved');
    assert.deepEqual(instance.decide(approved.id, 'deny'), { ok: false, status: 409, error: 'This request is already approved' });
    const denied = created(instance);
    assert.equal(instance.decide(denied.id, 'deny').ok, true);
    const overview = instance.overview();
    assert.deepEqual(overview.pending, []);
    assert.deepEqual(overview.recent.map(request => [request.id, request.status]).sort(), [[approved.id, 'approved'], [denied.id, 'denied']].sort());
    assert.deepEqual(instance.decide('request-none', 'approve'), { ok: false, status: 404, error: 'Unknown vault request' });
    assert.equal(instance.decide(denied.id, 'maybe').ok, false);
});
test('an undecided request expires at its deadline, and an abandoned one immediately', () => {
    const { instance, clock } = vault();
    const late = created(instance, { expiresAt: T0 + 5_000 });
    const abandoned = created(instance);
    clock.now = T0 + 5_000;
    assert.equal((0, test_types_js_1.record)(instance.requestStatus(late.id)).ok, true);
    assert.equal(late.status, 'expired');
    assert.equal(instance.decide(late.id, 'approve').ok, false);
    instance.abandon(abandoned.id);
    assert.equal(abandoned.status, 'expired');
});
test('a request cannot outlive the ten-minute cap', () => {
    const { instance } = vault();
    const request = created(instance, { expiresAt: T0 + 60 * 60_000 });
    assert.equal(request.expiresAt, T0 + 10 * 60_000);
});
test('a window approves the same device, item, fields and session for fifteen minutes only', () => {
    const { instance, clock, notified } = vault();
    const first = created(instance);
    const decision = instance.decide(first.id, 'approve-window');
    assert.ok(decision.ok);
    const [grant] = instance.overview().grants;
    assert.equal(grant.expiresAt, T0 + vault_approvals_1.GRANT_WINDOW_MS);
    const repeat = created(instance);
    assert.equal(repeat.status, 'approved');
    assert.equal(repeat.auto, true);
    assert.equal(repeat.grantId, grant.id);
    assert.equal(notified.length, 1, 'auto-approvals do not ring');
    assert.equal(created(instance, { fields: ['username', 'password'] }).status, 'pending');
    assert.equal(created(instance, { session: { ref: 'desktop/other' } }).status, 'pending');
    assert.equal(created(instance, { device: { name: 'framework', fingerprint: 'cd'.repeat(32) } }).status, 'pending');
    clock.now = T0 + vault_approvals_1.GRANT_WINDOW_MS;
    assert.deepEqual(instance.overview().grants, []);
    assert.equal(created(instance, { expiresAt: clock.now + 60_000 }).status, 'pending');
});
test('revoking a window makes the next identical request ask again', () => {
    const { instance } = vault();
    instance.decide(created(instance).id, 'approve-window');
    const [grant] = instance.overview().grants;
    assert.equal(instance.revokeGrant(grant.id).ok, true);
    assert.equal(instance.revokeGrant(grant.id).ok, false);
    assert.equal(created(instance).status, 'pending');
});
test('malformed requests are refused before anything is pending', () => {
    const { instance, notified } = vault();
    const status = (overrides) => {
        const result = create(instance, overrides);
        return result.ok ? 201 : result.status;
    };
    assert.equal(status({ fields: ['password', 'password'] }), 400);
    assert.equal(status({ fields: ['ssn'] }), 400);
    assert.equal(status({ fields: ['field:'] }), 400);
    assert.equal(status({ fields: ['field:a\nb'] }), 400);
    assert.equal(status({ fields: [] }), 400);
    assert.equal(status({ item: '  ' }), 400);
    assert.equal(status({ expiresAt: T0 }), 400);
    assert.equal(status({ device: { name: 'x', fingerprint: 'not-hex' } }), 400);
    assert.equal(status({ session: { name: 'no ref' } }), 400);
    assert.equal(status({ reason: 'x'.repeat(501) }), 400);
    assert.equal(status({ id: 'short' }), 400);
    const accepted = created(instance, { session: undefined, reason: undefined });
    assert.equal(accepted.session, null);
    assert.equal(instance.createRequest({ id: accepted.id, device, item: 'x', fields: ['password'], expiresAt: T0 + 1000 }).ok, false);
    assert.equal(notified.length, 1);
});
test('fields are reported in canonical order', () => {
    const { instance } = vault();
    assert.deepEqual(created(instance, { fields: ['totp', 'username', 'password'] }).fields, ['username', 'password', 'totp']);
    assert.deepEqual(created(instance, { fields: ['field:api key', 'notes', 'field:Token'] }).fields, ['notes', 'field:api key', 'field:Token']);
});
test('the listener reads as stale without a heartbeat for 45 seconds', () => {
    const { instance, clock } = vault();
    assert.equal(instance.overview().listener, null);
    assert.equal(instance.reportStatus({ state: 'unlocked' }).ok, false);
    assert.equal(instance.reportStatus({ state: 'ready', account: 'me@example.com', devices: [device] }).ok, true);
    assert.equal(instance.overview().listener?.stale, false);
    clock.now = T0 + vault_approvals_1.LISTENER_STALE_MS + 1;
    assert.equal(instance.overview().listener?.stale, true);
});
test('the notification names the claimed session, the device and the item', () => {
    const { instance } = vault();
    const payload = (0, vault_approvals_1.vaultPushPayload)(created(instance));
    assert.equal(payload.kind, 'vault');
    assert.equal(payload.body, 'Htpc provision on desktop wants fleet-sudo-desktop (password) — install rocprofiler');
    assert.equal(payload.tag, `vault:${payload.vaultRequestId}`);
    assert.equal((0, vault_approvals_1.vaultPushPayload)(created(instance, { session: null, reason: 'r'.repeat(400) })).body.length, 180);
    // topOrigin is validated and surfaced when it differs from origin (hidden when equal).
    const crossFrame = created(instance, {
        session: null,
        origin: 'https://auth.acme.example',
        topOrigin: 'https://www.acme.example',
        itemUris: ['https://auth.acme.example/login'],
        reason: 'sign in',
    });
    assert.equal(crossFrame.topOrigin, 'https://www.acme.example');
    assert.match((0, vault_approvals_1.vaultPushPayload)(crossFrame).body, /on https:\/\/auth\.acme\.example \(page https:\/\/www\.acme\.example\) \[origin matched\]/);
    const sameFrame = created(instance, {
        session: null,
        origin: 'https://auth.acme.example',
        topOrigin: 'https://auth.acme.example',
        itemUris: ['https://auth.acme.example/login'],
        reason: 'sign in',
    });
    assert.ok(!(0, vault_approvals_1.vaultPushPayload)(sameFrame).body.includes('(page '));
    assert.equal(create(instance, { topOrigin: 'https://bad.example/path' }).ok, false);
});
test('a create always asks: no window opens, and a release window never covers it', () => {
    const { instance, notified } = vault();
    instance.decide(created(instance, { item: 'grafana', fields: ['password', 'uri'] }).id, 'approve-window');
    const request = created(instance, { action: 'create', item: 'grafana', fields: ['password', 'uri'], folder: 'agent-created' });
    assert.equal(request.status, 'pending');
    assert.equal(notified.length, 2);
    assert.deepEqual(instance.decide(request.id, 'approve-window'), { ok: false, status: 400, error: 'A create is approved once; it opens no window' });
    assert.equal(request.status, 'pending');
    assert.equal((0, vault_approvals_1.vaultPushPayload)(request).body, 'Htpc provision on desktop wants to create grafana in agent-created (password, uri) — install rocprofiler');
    assert.equal(create(instance, { action: 'create' }).ok, false, 'a create names its folder');
    assert.equal(create(instance, { action: 'delete' }).ok, false);
});
test('the bridge refuses a peer that is not loopback even with the token', () => {
    const handlers = (0, vault_approvals_1.createVaultHandlers)(vault().instance, () => 'secret-token');
    const outcome = (remoteAddress, header) => {
        let status = 0;
        let passed = false;
        const req = { socket: { remoteAddress }, get: () => header };
        const res = { status(code) { status = code; return this; }, json() { return this; } };
        handlers.bridgeGate(req, res, () => { passed = true; });
        return passed ? 'next' : status;
    };
    assert.equal(outcome('127.0.0.1', 'secret-token'), 'next');
    assert.equal(outcome('::ffff:127.0.0.1', 'secret-token'), 'next');
    assert.equal(outcome('100.70.163.97', 'secret-token'), 403);
    assert.equal(outcome('127.0.0.1', 'wrong-token!'), 403);
    assert.equal(outcome('127.0.0.1', undefined), 403);
    // An empty or whitespace-only stored bridge token fails closed (never matches empty header).
    for (const emptyToken of ['', '   ', '\n']) {
        const emptyHandlers = (0, vault_approvals_1.createVaultHandlers)(vault().instance, () => emptyToken);
        let status = 0;
        let passed = false;
        const req = { socket: { remoteAddress: '127.0.0.1' }, get: () => '' };
        const res = { status(code) { status = code; return this; }, json() { return this; } };
        emptyHandlers.bridgeGate(req, res, () => { passed = true; });
        assert.equal(passed, false);
        assert.equal(status, 403);
    }
});
test('origin parsing and matching require exact https scheme, host, and port and reject wildcards and empty userinfo', () => {
    assert.deepEqual((0, vault_approvals_1.parseOrigin)('https://PORTAL.Acme.com:443'), { origin: 'https://portal.acme.com', https: true });
    assert.deepEqual((0, vault_approvals_1.parseOrigin)('https://portal.acme.com:8443'), { origin: 'https://portal.acme.com:8443', https: true });
    assert.deepEqual((0, vault_approvals_1.parseOrigin)('http://portal.acme.com'), { origin: 'http://portal.acme.com', https: false });
    for (const invalid of [
        'https://portal.acme.com/login',
        'https://portal.acme.com/',
        'https://portal.acme.com?a=1',
        'https://portal.acme.com#frag',
        'https://user:pass@portal.acme.com',
        'https://@portal.acme.com',
        'https://:@portal.acme.com',
        'https://*.acme.com',
        'https://%2a.acme.com',
        'javascript:alert(1)',
        'portal.acme.com',
        'https://portal.acme.com\\path',
    ]) {
        assert.equal((0, vault_approvals_1.parseOrigin)(invalid), null, invalid);
    }
    assert.equal((0, vault_approvals_1.httpsOriginOfUri)('https://portal.acme.com/login?next=/home'), 'https://portal.acme.com');
    assert.equal((0, vault_approvals_1.httpsOriginOfUri)('https://portal.acme.com/@alice/profile'), 'https://portal.acme.com');
    assert.equal((0, vault_approvals_1.httpsOriginOfUri)('https://portal.acme.com/search?q=*'), 'https://portal.acme.com');
    assert.equal((0, vault_approvals_1.httpsOriginOfUri)('https://portal.acme.com:8443/app'), 'https://portal.acme.com:8443');
    for (const badUri of [
        'http://portal.acme.com/login',
        'portal.acme.com',
        'https://user:pass@portal.acme.com/login',
        'https://@portal.acme.com/login',
        'https://:@portal.acme.com/login',
        'https://user:@portal.acme.com/login',
        'https://*.acme.com/login',
        'https://%2a.acme.com/login',
        'https://%2A.acme.com/login',
    ]) {
        assert.equal((0, vault_approvals_1.httpsOriginOfUri)(badUri), null, badUri);
    }
    const httpsOrigin = (0, vault_approvals_1.parseOrigin)('https://portal.acme.com');
    assert.equal((0, vault_approvals_1.evaluateOriginMatch)(httpsOrigin, ['https://other.example/a', 'https://portal.acme.com:443/login']), 'match');
    assert.equal((0, vault_approvals_1.evaluateOriginMatch)(httpsOrigin, ['https://sub.portal.acme.com/login']), 'mismatch');
    assert.equal((0, vault_approvals_1.evaluateOriginMatch)(httpsOrigin, ['https://*.acme.com/login']), 'mismatch');
    assert.equal((0, vault_approvals_1.evaluateOriginMatch)(httpsOrigin, ['https://@portal.acme.com/login']), 'mismatch');
    assert.equal((0, vault_approvals_1.evaluateOriginMatch)(httpsOrigin, ['https://portal.acme.com:8443/login']), 'mismatch');
    assert.equal((0, vault_approvals_1.evaluateOriginMatch)(httpsOrigin, ['http://portal.acme.com/login']), 'mismatch');
    assert.equal((0, vault_approvals_1.evaluateOriginMatch)(httpsOrigin, []), 'mismatch');
    assert.equal((0, vault_approvals_1.evaluateOriginMatch)(null, ['https://portal.acme.com/login']), 'no-origin');
});
test('per-device policy enforces allowFolder, allowedFields, allowCreate, and refuses before any push', () => {
    const { instance, notified, auditPath } = vault({
        policy: {
            devices: {
                // Uppercase hex key in config must match lowercase fingerprint on wire.
                [restrictedDevice.fingerprint.toUpperCase()]: {
                    name: 'cu-sandbox',
                    allowFolder: 'cu-sandbox',
                    allowedFields: ['username', 'password', 'totp', 'uri'],
                    allowCreate: false,
                    allowWindow: false,
                },
            },
        },
    });
    // Unlisted device behaves identically to today (old-listener request without folder/origin/itemUris).
    const unrestricted = created(instance, { device, fields: ['notes'] });
    assert.equal(unrestricted.allowWindow, true);
    assert.equal(unrestricted.policyName, null);
    assert.equal(unrestricted.originMatch, 'no-origin');
    assert.equal(notified.length, 1);
    // allowCreate: false refuses create before push.
    const refusedCreate = create(instance, {
        device: restrictedDevice, action: 'create', item: 'new-login', folder: 'cu-sandbox', fields: ['password'],
    });
    assert.equal(refusedCreate.ok, false);
    if (!refusedCreate.ok)
        assert.equal(refusedCreate.status, 403);
    // allowFolder refuses missing folder (old listener) and wrong folder before push.
    const refusedNoFolder = create(instance, { device: restrictedDevice, item: 'Acme', fields: ['password'] });
    assert.equal(refusedNoFolder.ok, false);
    if (!refusedNoFolder.ok)
        assert.equal(refusedNoFolder.status, 403);
    const refusedWrongFolder = create(instance, { device: restrictedDevice, item: 'Acme', folder: 'personal', fields: ['password'] });
    assert.equal(refusedWrongFolder.ok, false);
    if (!refusedWrongFolder.ok)
        assert.equal(refusedWrongFolder.status, 403);
    // allowedFields refuses notes and unlisted custom fields before push.
    const refusedField = create(instance, { device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox', fields: ['password', 'notes'] });
    assert.equal(refusedField.ok, false);
    if (!refusedField.ok)
        assert.equal(refusedField.status, 403);
    const refusedCustom = create(instance, { device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox', fields: ['field:api-key'] });
    assert.equal(refusedCustom.ok, false);
    if (!refusedCustom.ok)
        assert.equal(refusedCustom.status, 403);
    assert.equal(notified.length, 1, 'refused requests never trigger push');
    assert.equal(instance.overview().pending.length, 1, 'refused requests never become pending');
    // Matching folder + allowed fields succeeds and carries policy metadata.
    const allowed = created(instance, {
        device: restrictedDevice, itemId: 'item-uuid-1', item: 'Acme Portal', folder: 'cu-sandbox', fields: ['username', 'password'],
    });
    assert.equal(allowed.policyName, 'cu-sandbox');
    assert.equal(allowed.allowWindow, false);
    assert.equal(allowed.itemId, 'item-uuid-1');
    assert.equal(notified.length, 2);
    const refusedResults = (0, vault_approvals_1.readVaultAudit)(auditPath, { device: restrictedDevice.fingerprint, decision: 'refused' })
        .map(entry => entry.policyResult);
    assert.deepEqual(refusedResults.sort(), [
        'denied:create_not_allowed',
        'denied:field_not_allowed',
        'denied:field_not_allowed',
        'denied:folder_not_allowed',
        'denied:folder_not_allowed',
    ]);
});
test('requireOriginMatch refuses missing origin, non-https origin, missing item URIs, and mismatches before push', () => {
    const { instance, notified, auditPath } = vault({
        policy: {
            devices: {
                [restrictedDevice.fingerprint]: {
                    name: 'cu-fill',
                    allowFolder: 'cu-sandbox',
                    requireOriginMatch: true,
                    allowWindow: false,
                },
            },
        },
    });
    // Old listener (no origin) is refused before push.
    const noOrigin = create(instance, {
        device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox', itemUris: ['https://portal.acme.com/login'],
    });
    assert.equal(noOrigin.ok, false);
    if (!noOrigin.ok)
        assert.equal(noOrigin.status, 403);
    // HTTP downgrade is refused before push.
    const httpOrigin = create(instance, {
        device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox',
        origin: 'http://portal.acme.com', itemUris: ['http://portal.acme.com/login'],
    });
    assert.equal(httpOrigin.ok, false);
    if (!httpOrigin.ok)
        assert.equal(httpOrigin.status, 403);
    // Item with no stored URI is refused before push.
    const noUri = create(instance, {
        device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox',
        origin: 'https://portal.acme.com', itemUris: [],
    });
    assert.equal(noUri.ok, false);
    if (!noUri.ok)
        assert.equal(noUri.status, 403);
    // Subdomain / port / host mismatch are refused before push.
    for (const itemUris of [
        ['https://evil.portal.acme.com/login'],
        ['https://portal.acme.com:8443/login'],
        ['https://other.example/login'],
        ['http://portal.acme.com/login'],
    ]) {
        const mismatch = create(instance, {
            device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox', origin: 'https://portal.acme.com', itemUris,
        });
        assert.equal(mismatch.ok, false);
        if (!mismatch.ok)
            assert.equal(mismatch.status, 403);
    }
    // Malformed origin (contains path) is rejected with 400 before push.
    const badOrigin = create(instance, {
        device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox',
        origin: 'https://portal.acme.com/login', itemUris: ['https://portal.acme.com/login'],
    });
    assert.equal(badOrigin.ok, false);
    if (!badOrigin.ok)
        assert.equal(badOrigin.status, 400);
    assert.equal(notified.length, 0, 'no refused request ever rings push');
    // Exact https match succeeds and annotates push payload.
    const matched = created(instance, {
        device: restrictedDevice,
        itemId: 'bw-acme-1',
        item: 'Acme Portal',
        folder: 'cu-sandbox',
        fields: ['username', 'password'],
        origin: 'https://PORTAL.Acme.com:443',
        itemUris: ['https://status.acme.com', 'https://portal.acme.com/signin?next=/home'],
        reason: 'sign in',
    });
    assert.equal(matched.origin, 'https://portal.acme.com');
    assert.equal(matched.originMatch, 'match');
    assert.equal(notified.length, 1);
    assert.match((0, vault_approvals_1.vaultPushPayload)(matched).body, /on https:\/\/portal\.acme\.com \[origin matched\]/);
    const auditReasons = (0, vault_approvals_1.readVaultAudit)(auditPath, { decision: 'refused' }).map(entry => entry.policyResult);
    assert.ok(auditReasons.includes('denied:origin_required'));
    assert.ok(auditReasons.includes('denied:origin_not_https'));
    assert.ok(auditReasons.includes('denied:item_has_no_uri'));
    assert.ok(auditReasons.includes('denied:origin_mismatch'));
});
test('allowWindow: false bypasses existing grants and refuses approve-window server-side', () => {
    const { instance, notified, writePolicy, auditPath } = vault();
    // First, open a 15-minute grant while the device is unrestricted.
    const initial = created(instance, { device: restrictedDevice, item: 'Acme Portal', fields: ['password'], folder: 'cu-sandbox' });
    assert.equal(instance.decide(initial.id, 'approve-window').ok, true);
    assert.equal(instance.overview().grants.length, 1);
    assert.equal(created(instance, { device: restrictedDevice, item: 'Acme Portal', fields: ['password'], folder: 'cu-sandbox' }).auto, true);
    // Also leave one pending request open before tightening the policy.
    const prePolicyPending = created(instance, { device: restrictedDevice, item: 'Other Item', fields: ['password'], folder: 'cu-sandbox' });
    assert.equal(prePolicyPending.allowWindow, true);
    // Tighten policy to disable windows for this device.
    writePolicy({
        devices: {
            [restrictedDevice.fingerprint]: { name: 'cu-no-window', allowFolder: 'cu-sandbox', allowWindow: false },
        },
    });
    // Live overview hides window on the already-pending request and decide() refuses approve-window server-side.
    const projected = instance.overview().pending.find(entry => entry.id === prePolicyPending.id);
    assert.equal(projected?.allowWindow, false);
    const preRefused = instance.decide(prePolicyPending.id, 'approve-window');
    assert.equal(preRefused.ok, false);
    if (!preRefused.ok)
        assert.equal(preRefused.status, 400);
    assert.equal(prePolicyPending.status, 'pending');
    // New request matching the earlier grant MUST bypass the grant and trigger a fresh push.
    const notifyBefore = notified.length;
    const fresh = created(instance, { device: restrictedDevice, item: 'Acme Portal', fields: ['password'], folder: 'cu-sandbox' });
    assert.equal(fresh.status, 'pending');
    assert.equal(fresh.auto, false);
    assert.equal(fresh.allowWindow, false);
    assert.equal(notified.length, notifyBefore + 1);
    const windowAttempt = instance.decide(fresh.id, 'approve-window');
    assert.equal(windowAttempt.ok, false);
    if (!windowAttempt.ok)
        assert.equal(windowAttempt.status, 400);
    assert.equal(fresh.status, 'pending');
    assert.equal(instance.decide(fresh.id, 'approve').ok, true);
    assert.equal(fresh.status, 'approved');
    assert.equal(instance.overview().grants.length, 1, 'no new grant created');
    const windowRefusals = (0, vault_approvals_1.readVaultAudit)(auditPath, { decision: 'window-refused' });
    assert.equal(windowRefusals.length, 2);
    assert.equal(windowRefusals[0].policyResult, 'denied:window_not_allowed');
});
test('folder policy compares exact names without trimming and enforces folderId when configured', () => {
    const exactName = vault({
        policy: {
            devices: {
                [restrictedDevice.fingerprint]: { name: 'exact-folder', allowFolder: 'cu-sandbox' },
            },
        },
    });
    // Untrimmed comparison: leading/trailing whitespace must NOT match 'cu-sandbox'.
    for (const wrong of [' cu-sandbox', 'cu-sandbox ', ' cu-sandbox ']) {
        const res = create(exactName.instance, { device: restrictedDevice, item: 'Acme', folder: wrong });
        assert.equal(res.ok, false, JSON.stringify(wrong));
        if (!res.ok)
            assert.equal(res.status, 403);
    }
    assert.equal(create(exactName.instance, { device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox' }).ok, true);
    // When allowFolderId is set, enforcement matches folderId strictly and folder name is display-only.
    const byId = vault({
        policy: {
            devices: {
                [restrictedDevice.fingerprint]: {
                    name: 'folder-id-policy',
                    allowFolder: 'cu-sandbox',
                    allowFolderId: 'folder-uuid-1',
                },
            },
        },
    });
    const missingId = create(byId.instance, { device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox' });
    assert.equal(missingId.ok, false);
    if (!missingId.ok)
        assert.equal(missingId.status, 403);
    const wrongId = create(byId.instance, { device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox', folderId: 'folder-uuid-2' });
    assert.equal(wrongId.ok, false);
    if (!wrongId.ok)
        assert.equal(wrongId.status, 403);
    const okRenamedDisplay = created(byId.instance, {
        device: restrictedDevice, item: 'Acme', folder: 'Renamed Display Name', folderId: 'folder-uuid-1',
    });
    assert.equal(okRenamedDisplay.folderId, 'folder-uuid-1');
    assert.equal(okRenamedDisplay.folder, 'Renamed Display Name');
});
test('grants match itemId when carried and compare field arrays without comma collisions', () => {
    const { instance } = vault();
    // Two items sharing display name 'github.com' with different itemIds must never share a grant.
    const first = created(instance, { itemId: 'bw-id-1', item: 'github.com', fields: ['password'] });
    assert.equal(instance.decide(first.id, 'approve-window').ok, true);
    assert.equal(created(instance, { itemId: 'bw-id-1', item: 'github.com', fields: ['password'] }).auto, true);
    assert.equal(created(instance, { itemId: 'bw-id-2', item: 'github.com', fields: ['password'] }).status, 'pending');
    assert.equal(created(instance, { item: 'github.com', fields: ['password'] }).status, 'pending');
    // Legacy grant (itemId null) must not auto-approve a request carrying an itemId.
    const legacyFirst = created(instance, { item: 'legacy-only', fields: ['password'] });
    assert.equal(instance.decide(legacyFirst.id, 'approve-window').ok, true);
    assert.equal(created(instance, { item: 'legacy-only', fields: ['password'] }).auto, true);
    assert.equal(created(instance, { itemId: 'bw-id-9', item: 'legacy-only', fields: ['password'] }).status, 'pending');
    // Comma in custom field name must not collide with two separate custom fields.
    const commaGrantReq = created(instance, { item: 'custom-fields', fields: ['field:a,field:b'] });
    assert.equal(instance.decide(commaGrantReq.id, 'approve-window').ok, true);
    assert.equal(created(instance, { item: 'custom-fields', fields: ['field:a', 'field:b'] }).status, 'pending');
    assert.equal(created(instance, { item: 'custom-fields', fields: ['field:a,field:b'] }).auto, true);
});
test('approve and approve-window re-evaluate full policy; deny always succeeds even when policy is unreadable', () => {
    const { instance, writePolicy, policyPath, auditPath } = vault();
    const pendingFolder = created(instance, { device: restrictedDevice, item: 'Acme', folder: 'personal', folderId: 'f-personal', fields: ['password'] });
    const pendingFields = created(instance, { device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox', folderId: 'f-cu', fields: ['notes'] });
    const pendingOrigin = created(instance, { device: restrictedDevice, item: 'Acme', folder: 'cu-sandbox', folderId: 'f-cu', fields: ['password'] });
    const pendingCreate = created(instance, { device: restrictedDevice, action: 'create', item: 'NewItem', folder: 'cu-sandbox', fields: ['password'] });
    const pendingToDeny = created(instance, { device: restrictedDevice, item: 'DenyMe', folder: 'personal', fields: ['password'] });
    // Tighten policy AFTER requests were already pending.
    writePolicy({
        devices: {
            [restrictedDevice.fingerprint]: {
                name: 'cu-tight',
                allowFolderId: 'f-cu',
                allowedFields: ['username', 'password'],
                allowCreate: false,
                requireOriginMatch: true,
                allowWindow: false,
            },
        },
    });
    for (const pending of [pendingFolder, pendingFields, pendingOrigin, pendingCreate]) {
        const res = instance.decide(pending.id, 'approve');
        assert.equal(res.ok, false, pending.id);
        if (!res.ok)
            assert.equal(res.status, 403);
        assert.equal(pending.status, 'pending');
    }
    const refusedDecisions = (0, vault_approvals_1.readVaultAudit)(auditPath, { device: restrictedDevice.fingerprint, decision: 'refused' })
        .map(entry => entry.policyResult);
    assert.deepEqual(refusedDecisions.sort(), [
        'denied:create_not_allowed',
        'denied:field_not_allowed',
        'denied:folder_not_allowed',
        'denied:origin_required',
    ]);
    // Now corrupt policies.json: approve fails closed for the enrolled device, while deny MUST still succeed.
    fs.writeFileSync(policyPath, '{ broken json');
    const approveBroken = instance.decide(pendingToDeny.id, 'approve');
    assert.equal(approveBroken.ok, false);
    if (!approveBroken.ok)
        assert.equal(approveBroken.status, 500);
    assert.equal(pendingToDeny.status, 'pending');
    const denyBroken = instance.decide(pendingToDeny.id, 'deny');
    assert.equal(denyBroken.ok, true);
    assert.equal(pendingToDeny.status, 'denied');
});
test('enrolled.json persists on valid load and fails closed on missing/corrupt policies without blocking never-enrolled devices', () => {
    // 1. Policy key validation requires exactly 64 hex characters (32-byte ids) and rejects typos/bad types.
    for (const bad of [
        '{ not valid json',
        '{}',
        JSON.stringify({ devices: { ['ab'.repeat(16)]: { allowWindow: false } } }), // 32 hex chars: too short
        JSON.stringify({ devices: { [`${'a'.repeat(63)}`]: { allowWindow: false } } }),
        JSON.stringify({ devices: { [`${'a'.repeat(65)}`]: { allowWindow: false } } }),
        JSON.stringify({ devices: { [device.fingerprint]: { allowFields: ['password'] } } }),
        JSON.stringify({ devices: { 'not-a-hex-fp': { allowWindow: false } } }),
        JSON.stringify({ devices: { [device.fingerprint]: { allowWindow: 'false' } } }),
    ]) {
        const { policyPath, enrolledPath, instance } = vault({ rawPolicyText: bad });
        assert.equal((0, vault_approvals_1.loadVaultPolicies)(policyPath, enrolledPath).ok, false, bad);
        // Never-enrolled device STILL keeps legacy path even when policies.json is malformed.
        assert.equal(create(instance, { device }).ok, true, `never-enrolled device keeps legacy path for ${bad}`);
    }
    // 2. Valid load atomically persists enrolled.json (0600) with case-normalised 64-hex fingerprints.
    const ctx = vault();
    // Give restrictedDevice a grant before enrolling it so we can verify grants are ignored when policy is lost.
    const preGrant = created(ctx.instance, { device: restrictedDevice, item: 'Acme', fields: ['password'], folder: 'cu-sandbox' });
    assert.equal(ctx.instance.decide(preGrant.id, 'approve-window').ok, true);
    ctx.writePolicy({
        devices: {
            [restrictedDevice.fingerprint.toUpperCase()]: { name: 'cu-enrolled', allowFolder: 'cu-sandbox', allowWindow: true },
        },
    });
    const loaded = (0, vault_approvals_1.loadVaultPolicies)(ctx.policyPath, ctx.enrolledPath);
    assert.equal(loaded.ok, true);
    assert.equal(fs.statSync(ctx.enrolledPath).mode & 0o777, 0o600);
    const enrolled = (0, vault_approvals_1.loadEnrolledFingerprints)(ctx.enrolledPath);
    assert.equal(enrolled.state, 'ok');
    if (enrolled.state === 'ok')
        assert.deepEqual([...enrolled.fingerprints], [restrictedDevice.fingerprint]);
    // 3. Delete policies.json: enrolled device is refused and its grant is ignored; unlisted device stays legacy.
    fs.unlinkSync(ctx.policyPath);
    const missingEnrolled = create(ctx.instance, { device: restrictedDevice, item: 'Acme', fields: ['password'], folder: 'cu-sandbox' });
    assert.equal(missingEnrolled.ok, false);
    if (!missingEnrolled.ok)
        assert.equal(missingEnrolled.status, 500);
    assert.equal(create(ctx.instance, { device, item: 'Legacy', fields: ['password'] }).ok, true);
    // 4. Malformed policies.json: enrolled device is refused and its grant is ignored; never-enrolled device stays legacy.
    fs.writeFileSync(ctx.policyPath, '{ malformed');
    const corruptEnrolled = create(ctx.instance, { device: restrictedDevice, item: 'Acme', fields: ['password'], folder: 'cu-sandbox' });
    assert.equal(corruptEnrolled.ok, false);
    if (!corruptEnrolled.ok)
        assert.equal(corruptEnrolled.status, 500);
    assert.equal(create(ctx.instance, { device, item: 'Legacy2', fields: ['password'] }).ok, true);
    // 5. Missing policies.json + unreadable/corrupt enrolled.json -> logs and falls back to legacy.
    fs.unlinkSync(ctx.policyPath);
    fs.writeFileSync(ctx.enrolledPath, '{ corrupt enrolled');
    const logged = [];
    const origError = console.error;
    console.error = (...args) => { logged.push(args.map(String).join(' ')); };
    try {
        assert.equal(create(ctx.instance, { device, item: 'Legacy3', fields: ['password'] }).ok, true);
    }
    finally {
        console.error = origError;
    }
    assert.ok(logged.some(line => line.includes('unreadable enrolled.json')));
});
test('positive decisions and grants fail closed (500) if audit write or over-cap rotation fails; deny still succeeds', () => {
    // 1. Audit write failure (auditPath is a directory): approve, approve-window, and grant auto-approve refuse (500).
    const ctx = vault();
    const reqApprove = created(ctx.instance, { item: 'A', fields: ['password'] });
    const reqWindow = created(ctx.instance, { item: 'B', fields: ['password'] });
    const reqDeny = created(ctx.instance, { item: 'C', fields: ['password'] });
    const grantSeed = created(ctx.instance, { item: 'Granted', fields: ['password'] });
    assert.equal(ctx.instance.decide(grantSeed.id, 'approve-window').ok, true);
    // Replace audit file with a directory to force write failure.
    fs.rmSync(ctx.auditPath, { force: true });
    fs.mkdirSync(ctx.auditPath);
    const failApprove = ctx.instance.decide(reqApprove.id, 'approve');
    assert.equal(failApprove.ok, false);
    if (!failApprove.ok)
        assert.equal(failApprove.status, 500);
    assert.equal(reqApprove.status, 'pending', 'positive decision must not publish on audit failure');
    const failWindow = ctx.instance.decide(reqWindow.id, 'approve-window');
    assert.equal(failWindow.ok, false);
    if (!failWindow.ok)
        assert.equal(failWindow.status, 500);
    assert.equal(reqWindow.status, 'pending');
    assert.equal(ctx.instance.overview().grants.length, 1, 'no new grant published on audit failure');
    const failAuto = create(ctx.instance, { item: 'Granted', fields: ['password'] });
    assert.equal(failAuto.ok, false);
    if (!failAuto.ok)
        assert.equal(failAuto.status, 500);
    // Deny MUST still work even when audit cannot be written.
    const okDeny = ctx.instance.decide(reqDeny.id, 'deny');
    assert.equal(okDeny.ok, true);
    assert.equal(reqDeny.status, 'denied');
    // 2. Rotation failure while over cap stops appending and refuses positive decisions (500).
    const rot = vault({ auditMaxBytes: 450 });
    const pending = created(rot.instance, { item: 'CapCheck', fields: ['password'] });
    const sizeBefore = fs.statSync(rot.auditPath).size;
    // Block rename to .1 by placing a non-empty directory at `${auditPath}.1`.
    fs.mkdirSync(`${rot.auditPath}.1`);
    fs.writeFileSync(path.join(`${rot.auditPath}.1`, 'blocker'), 'x');
    const blockedApprove = rot.instance.decide(pending.id, 'approve');
    assert.equal(blockedApprove.ok, false);
    if (!blockedApprove.ok)
        assert.equal(blockedApprove.status, 500);
    assert.equal(pending.status, 'pending');
    assert.equal(fs.statSync(rot.auditPath).size, sizeBefore, 'must stop appending when over-cap rotation fails');
    assert.equal(rot.instance.decide(pending.id, 'deny').ok, true);
});
test('durable audit log is 0600, records every lifecycle event, omits secrets, projects on read, bounds reads, and rotates against projected size', () => {
    const { instance, clock, auditPath } = vault({
        policy: {
            devices: {
                [restrictedDevice.fingerprint]: {
                    name: 'cu-sandbox',
                    allowFolder: 'cu-sandbox',
                    allowWindow: false,
                    requireOriginMatch: true,
                },
            },
        },
    });
    // Deliberately include bogus secret-like keys and sensitive reason text to prove none ever reach disk.
    const req1 = created(instance, {
        device: restrictedDevice,
        itemId: 'item-42',
        item: 'Acme Portal',
        folderId: 'folder-cu-1',
        folder: 'cu-sandbox',
        fields: ['username', 'password'],
        origin: 'https://portal.acme.com',
        itemUris: ['https://portal.acme.com/login'],
        reason: 'SECRET_REASON_SHOULD_NOT_BE_LOGGED',
        password: 'SUPER_SECRET_PASSWORD_123',
        secret: 'TOP_SECRET_VALUE',
        totp: '999888',
    });
    assert.equal(instance.decide(req1.id, 'approve').ok, true);
    const req2 = created(instance, { device, itemId: 'item-99', item: 'Expiring Item', expiresAt: T0 + 1000 });
    clock.now = T0 + 1000;
    assert.equal(instance.requestStatus(req2.id).ok, true);
    const req3 = created(instance, { device, item: 'Abandoned Item', expiresAt: clock.now + 60_000 });
    assert.equal(instance.abandon(req3.id).ok, true);
    assert.equal(fs.statSync(auditPath).mode & 0o777, 0o600);
    const raw = fs.readFileSync(auditPath, 'utf8');
    assert.equal(raw.includes('SUPER_SECRET_PASSWORD_123'), false);
    assert.equal(raw.includes('TOP_SECRET_VALUE'), false);
    assert.equal(raw.includes('999888'), false);
    assert.equal(raw.includes('SECRET_REASON_SHOULD_NOT_BE_LOGGED'), false);
    const lines = raw.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.length, 6);
    assert.deepEqual(lines.map(entry => [entry.event, entry.decision, entry.by, entry.policyResult]), [
        ['request', 'pending', 'listener', 'allowed'],
        ['decision', 'approved', 'operator', 'allowed'],
        ['request', 'pending', 'listener', 'default'],
        ['decision', 'expired', 'timeout', 'default'],
        ['request', 'pending', 'listener', 'default'],
        ['decision', 'abandoned', 'listener', 'default'],
    ]);
    assert.equal(lines[0].itemId, 'item-42');
    assert.equal(lines[0].itemName, 'Acme Portal');
    assert.equal(lines[0].deviceFingerprint, restrictedDevice.fingerprint);
    assert.equal(lines[0].deviceName, restrictedDevice.name);
    assert.equal(lines[0].folderId, 'folder-cu-1');
    assert.equal(lines[0].folder, 'cu-sandbox');
    assert.equal(lines[0].origin, 'https://portal.acme.com');
    assert.equal(lines[0].originMatch, 'match');
    assert.equal(lines[0].policyName, 'cu-sandbox');
    // Inject an extra unexpected key and oversized string on disk; read projection must strip/truncate them.
    fs.appendFileSync(auditPath, `${JSON.stringify({
        ...lines[0],
        requestId: 'rogue-extra-key',
        itemName: 'x'.repeat(500),
        secretLeak: 'SHOULD_NEVER_BE_RETURNED',
    })}\n`);
    const projected = (0, vault_approvals_1.readVaultAudit)(auditPath, { limit: 1 })[0];
    assert.equal(projected.requestId, 'rogue-extra-key');
    assert.equal('secretLeak' in projected, false);
    assert.equal(projected.itemName.length, 256);
    // Verify projected-size rotation keeps active file <= maxBytes, 0600 on both files, and tail-read respects byte budget.
    const rotated = vault({ auditMaxBytes: 600 });
    for (let i = 0; i < 6; i += 1) {
        const entry = created(rotated.instance, { item: `item-${i}` });
        rotated.instance.decide(entry.id, 'deny');
    }
    assert.equal(fs.existsSync(`${rotated.auditPath}.1`), true);
    assert.ok(fs.statSync(rotated.auditPath).size <= 600, 'active file rotated against projected size stays under cap');
    assert.equal(fs.statSync(rotated.auditPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(`${rotated.auditPath}.1`).mode & 0o777, 0o600);
    const allRead = rotated.instance.audit({ limit: 50 });
    assert.ok(allRead.length >= 2, 'reads entries across rotation boundary');
    assert.equal(allRead[0].itemName, 'item-5', 'newest-first order');
    const budgeted = (0, vault_approvals_1.readVaultAudit)(rotated.auditPath, { limit: 50, maxBytes: 420 });
    assert.ok(budgeted.length >= 1 && budgeted.length < allRead.length, 'tail-read stops within byte budget');
});
test.describe('server routes', () => {
    const server = require('../server.js');
    let base = '';
    let token = '';
    test.before(async () => {
        if (!server.listening)
            await new Promise(resolve => server.once('listening', resolve));
        const address = server.address();
        if (!address || typeof address === 'string')
            throw new Error('Test server lacks TCP address');
        base = `http://127.0.0.1:${address.port}`;
        // The peer is this same server, reached over loopback: the worst case for the bridge.
        fs.writeFileSync(path.join(tmpHome, '.pi', 'dish', 'settings.json'), JSON.stringify({ remotes: [{ name: 'peer', url: base }] }));
    });
    test.after(() => {
        server.close();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined)
            delete process.env.HOME;
        else
            process.env.HOME = originalHome;
    });
    async function call(method, route, body, bridge) {
        const headers = {};
        if (body !== undefined)
            headers['Content-Type'] = 'application/json';
        if (bridge !== undefined)
            headers['X-Pi-Dish-Vault-Bridge'] = bridge;
        const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await response.text();
        const json = response.headers.get('content-type')?.includes('application/json');
        return {
            status: response.status,
            headers: response.headers,
            body: text && json ? JSON.parse(text) : text || null,
        };
    }
    test('the listener drives a request through approval over the bridge', async () => {
        assert.equal((await call('POST', '/api/vault/bridge/status', { state: 'ready', devices: [] })).status, 403);
        const tokenFile = path.join(tmpHome, '.pi', 'dish', 'vault', 'bridge.token');
        assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
        assert.equal(fs.statSync(path.dirname(tokenFile)).mode & 0o777, 0o700);
        token = fs.readFileSync(tokenFile, 'utf8').trim();
        assert.equal((await call('POST', '/api/vault/bridge/status', { state: 'ready', account: 'me@example.com', devices: [device] }, token)).status, 204);
        const id = 'bridge-request-1';
        const posted = await call('POST', '/api/vault/bridge/requests', {
            id, device, item: 'github.com', fields: ['username', 'password'], session, expiresAt: Date.now() + 60_000,
        }, token);
        assert.deepEqual({ status: posted.status, body: posted.body }, { status: 201, body: { status: 'pending' } });
        const overview = (0, test_types_js_1.record)((await call('GET', '/api/vault')).body);
        assert.equal((0, test_types_js_1.record)(overview.listener).state, 'ready');
        assert.deepEqual((0, test_types_js_1.records)(overview.pending).map(request => request.id), [id]);
        assert.deepEqual((await call('GET', `/api/vault/bridge/requests/${id}`, undefined, token)).body, { status: 'pending' });
        const decided = await call('POST', `/api/vault/requests/${id}/decision`, { decision: 'approve' });
        assert.equal(decided.status, 200);
        assert.deepEqual((await call('GET', `/api/vault/bridge/requests/${id}`, undefined, token)).body, { status: 'approved' });
        assert.equal((await call('POST', `/api/vault/requests/${id}/decision`, { decision: 'deny' })).status, 409);
    });
    test('the fleet proxy never forwards into a bridge, even a loopback peer with the token or obfuscated paths', async () => {
        for (const pathVariant of [
            '/hosts/peer/api/vault/bridge/status',
            '/hosts/peer/api/VAULT/BRIDGE/status',
            '/hosts/peer/api/vault/%62ridge/status',
            '/hosts/peer/api/foo/../vault/bridge/status',
        ]) {
            const proxied = await call('POST', pathVariant, { state: 'locked', devices: [] }, token);
            assert.equal(proxied.status, 404, pathVariant);
        }
        assert.equal((0, test_types_js_1.record)((await call('GET', '/hosts/peer/api/vault')).body).listener !== undefined, true, 'the browser routes still proxy');
    });
    test('policy enforcement, server-side window rejection, and operator audit endpoint work end-to-end', async () => {
        const policyFile = path.join(tmpHome, '.pi', 'dish', 'vault', vault_approvals_1.VAULT_POLICY_FILE);
        fs.mkdirSync(path.dirname(policyFile), { recursive: true, mode: 0o700 });
        fs.writeFileSync(policyFile, JSON.stringify({
            devices: {
                [restrictedDevice.fingerprint]: {
                    name: 'cu-sandbox',
                    allowFolder: 'cu-sandbox',
                    allowFolderId: 'folder-cu-1',
                    allowedFields: ['username', 'password', 'totp', 'uri'],
                    allowWindow: false,
                    allowCreate: false,
                    requireOriginMatch: true,
                },
            },
        }));
        // Refused request (missing origin) returns 403 and never enters pending.
        const refused = await call('POST', '/api/vault/bridge/requests', {
            id: 'bridge-policy-refused-1',
            device: restrictedDevice,
            itemId: 'bw-1',
            item: 'Acme Portal',
            folderId: 'folder-cu-1',
            folder: 'cu-sandbox',
            fields: ['username', 'password'],
            itemUris: ['https://portal.acme.com/login'],
            expiresAt: Date.now() + 60_000,
        }, token);
        assert.equal(refused.status, 403);
        assert.equal((0, test_types_js_1.records)((0, test_types_js_1.record)((await call('GET', '/api/vault')).body).pending).some(entry => entry.id === 'bridge-policy-refused-1'), false);
        // Valid policy-governed request becomes pending with allowWindow: false and originMatch: match.
        const admitted = await call('POST', '/api/vault/bridge/requests', {
            id: 'bridge-policy-ok-1',
            device: restrictedDevice,
            itemId: 'bw-1',
            item: 'Acme Portal',
            folderId: 'folder-cu-1',
            folder: 'cu-sandbox',
            fields: ['username', 'password'],
            origin: 'https://portal.acme.com',
            itemUris: ['https://portal.acme.com/login'],
            expiresAt: Date.now() + 60_000,
        }, token);
        assert.deepEqual({ status: admitted.status, body: admitted.body }, { status: 201, body: { status: 'pending' } });
        const pending = (0, test_types_js_1.records)((0, test_types_js_1.record)((await call('GET', '/api/vault')).body).pending)
            .find(entry => entry.id === 'bridge-policy-ok-1');
        assert.ok(pending);
        assert.equal(pending.allowWindow, false);
        assert.equal(pending.folderId, 'folder-cu-1');
        assert.equal(pending.origin, 'https://portal.acme.com');
        assert.equal(pending.originMatch, 'match');
        assert.equal(pending.policyName, 'cu-sandbox');
        // Window decision is rejected server-side with 400; single approve succeeds.
        assert.equal((await call('POST', '/api/vault/requests/bridge-policy-ok-1/decision', { decision: 'approve-window' })).status, 400);
        assert.equal((await call('POST', '/api/vault/requests/bridge-policy-ok-1/decision', { decision: 'approve' })).status, 200);
        // Durable audit file exists in state dir with 0600 permissions and /api/vault/audit sends private, no-store.
        const auditFile = path.join(tmpHome, '.pi', 'dish', vault_approvals_1.VAULT_AUDIT_FILE);
        assert.equal(fs.statSync(auditFile).mode & 0o777, 0o600);
        const auditRes = await call('GET', `/api/vault/audit?device=${restrictedDevice.fingerprint}&limit=10`);
        assert.equal(auditRes.status, 200);
        assert.equal(auditRes.headers.get('cache-control'), 'private, no-store');
        const entries = (0, test_types_js_1.records)((0, test_types_js_1.record)(auditRes.body).entries);
        assert.deepEqual(entries.map(entry => [entry.requestId, entry.decision, entry.policyResult]), [
            ['bridge-policy-ok-1', 'approved', 'allowed'],
            ['bridge-policy-ok-1', 'window-refused', 'denied:window_not_allowed'],
            ['bridge-policy-ok-1', 'pending', 'allowed'],
            ['bridge-policy-refused-1', 'refused', 'denied:origin_required'],
        ]);
        assert.equal((await call('GET', '/api/vault/audit?limit=abc')).status, 400);
        assert.equal((await call('GET', '/api/vault/audit?device=bad-fp')).status, 400);
    });
});
