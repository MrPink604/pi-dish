// Generated test/tool from test/browser/vault-approvals.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
function buildOverview(expiresAt, session) {
    return {
        listener: { state: 'ready', account: 'operator@example.com', stale: false },
        pending: [
            {
                id: 'vault-req-cu-1',
                device: { name: 'cu-sandbox-proxy', fingerprint: 'cc'.repeat(16) },
                action: 'release',
                itemId: 'bw-acme-1',
                item: 'Acme Portal',
                folder: 'cu-sandbox',
                fields: ['username', 'password'],
                origin: 'https://portal.acme.com',
                originMatch: 'match',
                allowWindow: false,
                policyName: 'cu-sandbox',
                policyResult: 'allowed',
                reason: 'sign in to check order',
                session: session ? { ref: session.ref, name: 'CU Task', host: session.host } : null,
                expiresAt,
            },
            {
                id: 'vault-req-legacy-1',
                device: { name: 'desktop', fingerprint: 'ab'.repeat(16) },
                action: 'release',
                item: 'fleet-sudo-desktop',
                folder: null,
                fields: ['password'],
                origin: null,
                originMatch: 'no-origin',
                allowWindow: true,
                policyName: null,
                policyResult: 'default',
                reason: 'install package',
                session: null,
                expiresAt,
            },
            {
                id: 'vault-req-mismatch-1',
                device: { name: 'desktop', fingerprint: 'ab'.repeat(16) },
                action: 'release',
                item: 'Unrestricted Origin Test',
                folder: null,
                fields: ['password'],
                origin: 'https://other.example',
                originMatch: 'mismatch',
                allowWindow: true,
                policyName: null,
                policyResult: 'default',
                reason: null,
                session: null,
                expiresAt,
            },
        ],
        recent: [],
        grants: [],
    };
}
async function openVaultPanel(page, overview) {
    await page.route('**/api/vault', route => route.fulfill({ json: overview }));
    await page.evaluate(() => fixtureApp.features.vaultApprovals.open(''));
    await (0, fixtures_js_1.expect)(page.locator('.vault-panel')).toBeVisible();
}
(0, fixtures_js_1.test)('approval cards render origin, match badges, policy name, and window gating cleanly at phone width (390x844)', async ({ page, fleet }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const overview = buildOverview(Date.now() + 180_000);
    const decisions = [];
    await page.route(`${fleet.self.base}/api/vault/requests/*/decision`, async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        decisions.push({ url: new URL(route.request().url()).pathname, decision: body.decision });
        await route.fulfill({ json: { request: { id: 'vault-req-cu-1', status: 'approved' } } });
    });
    await openVaultPanel(page, overview);
    const cuCard = page.locator('.vault-panel .vault-card[data-vault-request="vault-req-cu-1"]');
    await (0, fixtures_js_1.expect)(cuCard).toBeVisible();
    await (0, fixtures_js_1.expect)(cuCard.locator('.vault-policy')).toHaveText('cu-sandbox');
    await (0, fixtures_js_1.expect)(cuCard.locator('.vault-origin')).toHaveText('https://portal.acme.com');
    await (0, fixtures_js_1.expect)(cuCard.locator('[data-vault-origin-match="match"]')).toHaveText('exact match');
    await (0, fixtures_js_1.expect)(cuCard.locator('[data-vault-decision="approve"]')).toBeVisible();
    await (0, fixtures_js_1.expect)(cuCard.locator('[data-vault-decision="deny"]')).toBeVisible();
    await (0, fixtures_js_1.expect)(cuCard.locator('[data-vault-decision="approve-window"]')).toHaveCount(0);
    const legacyCard = page.locator('.vault-panel .vault-card[data-vault-request="vault-req-legacy-1"]');
    await (0, fixtures_js_1.expect)(legacyCard.locator('[data-vault-origin-match="no-origin"]')).toHaveText('no origin');
    await (0, fixtures_js_1.expect)(legacyCard.locator('.vault-policy')).toHaveCount(0);
    await (0, fixtures_js_1.expect)(legacyCard.locator('[data-vault-decision="approve-window"]')).toBeVisible();
    const mismatchCard = page.locator('.vault-panel .vault-card[data-vault-request="vault-req-mismatch-1"]');
    await (0, fixtures_js_1.expect)(mismatchCard.locator('.vault-origin')).toHaveText('https://other.example');
    await (0, fixtures_js_1.expect)(mismatchCard.locator('[data-vault-origin-match="mismatch"]')).toHaveText('mismatch');
    const panelMetrics = await page.locator('.vault-panel').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return {
            left: rect.left,
            right: rect.right,
            viewportWidth: window.innerWidth,
            overflowX: el.scrollWidth - el.clientWidth,
        };
    });
    (0, fixtures_js_1.expect)(panelMetrics.left).toBeGreaterThanOrEqual(0);
    (0, fixtures_js_1.expect)(panelMetrics.right).toBeLessThanOrEqual(panelMetrics.viewportWidth);
    (0, fixtures_js_1.expect)(panelMetrics.overflowX).toBeLessThanOrEqual(1);
    await cuCard.locator('[data-vault-decision="approve"]').click();
    await fixtures_js_1.expect.poll(() => decisions.length).toBe(1);
    (0, fixtures_js_1.expect)(decisions[0]).toEqual({ url: '/api/vault/requests/vault-req-cu-1/decision', decision: 'approve' });
});
fixtures_js_1.test.describe('desktop approval cards (1280x800)', () => {
    fixtures_js_1.test.use({ liveSessions: true });
    (0, fixtures_js_1.test)('approval cards render policy badge, origin match, docked card, and server error feedback on desktop', async ({ page, fleet }) => {
        await page.setViewportSize(DESKTOP_VIEWPORT);
        await fleet.select(fleet.self, fixtures_js_1.ROOT);
        const selfHostLabel = await page.evaluate((id) => {
            const all = [...fixtureApp.features.sessionState.sessions.active, ...fixtureApp.features.sessionState.sessions.previous];
            const match = all.find(entry => entry.id === id && (entry.host || null) === (fixtureApp.features.sessionState.currentSession?.host || null));
            return match?.hostLabel || '';
        }, fixtures_js_1.ROOT);
        const overview = buildOverview(Date.now() + 180_000, {
            ref: selfHostLabel ? `${selfHostLabel}/${fixtures_js_1.ROOT}` : fixtures_js_1.ROOT,
            host: selfHostLabel || null,
        });
        await page.route(`${fleet.self.base}/api/vault`, route => route.fulfill({ json: overview }));
        await page.route(`${fleet.self.base}/api/vault/requests/vault-req-legacy-1/decision`, route => route.fulfill({ status: 400, json: { error: 'Window approvals are disabled by policy for this device' } }));
        await page.evaluate(() => fixtureApp.features.vaultApprovals.open(''));
        const panel = page.locator('.vault-panel');
        await (0, fixtures_js_1.expect)(panel).toBeVisible();
        // The session-linked CU request also docks above the composer without a window button.
        const dockedCard = page.locator('#vaultSessionDock .vault-card[data-vault-request="vault-req-cu-1"]');
        await (0, fixtures_js_1.expect)(dockedCard).toBeVisible();
        await (0, fixtures_js_1.expect)(dockedCard.locator('.vault-policy')).toHaveText('cu-sandbox');
        await (0, fixtures_js_1.expect)(dockedCard.locator('.vault-origin')).toHaveText('https://portal.acme.com');
        await (0, fixtures_js_1.expect)(dockedCard.locator('[data-vault-origin-match="match"]')).toHaveText('exact match');
        await (0, fixtures_js_1.expect)(dockedCard.locator('[data-vault-decision="approve-window"]')).toHaveCount(0);
        // Panel also renders the legacy no-origin card and mismatch badge cleanly at desktop width.
        const mismatchCard = panel.locator('.vault-card[data-vault-request="vault-req-mismatch-1"]');
        await (0, fixtures_js_1.expect)(mismatchCard.locator('.vault-origin')).toHaveText('https://other.example');
        await (0, fixtures_js_1.expect)(mismatchCard.locator('[data-vault-origin-match="mismatch"]')).toHaveText('mismatch');
        // If the server rejects a window decision (e.g. policy tightened after load), the panel surfaces the server error.
        await panel.locator('.vault-card[data-vault-request="vault-req-legacy-1"] [data-vault-decision="approve-window"]').click();
        await (0, fixtures_js_1.expect)(panel.locator('.vault-notice')).toContainText('Window approvals are disabled by policy for this device');
    });
});
