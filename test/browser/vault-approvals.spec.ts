import type { Page } from '@playwright/test';
import { test, expect, ROOT } from './fixtures.js';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

function buildOverview(expiresAt: number, session?: { ref: string; host: string | null }) {
  return {
    listener: { state: 'ready', account: 'operator@example.com', stale: false },
    pending: [
      {
        id: 'vault-req-cu-1',
        device: { name: 'cu-sandbox-proxy', fingerprint: 'cc'.repeat(32) },
        action: 'release',
        itemId: 'bw-acme-1',
        item: 'Acme Portal',
        folderId: 'folder-cu-1',
        folder: 'cu-sandbox',
        fields: ['username', 'password'],
        origin: 'https://portal.acme.com',
        topOrigin: 'https://www.acme.com',
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
        device: { name: 'desktop', fingerprint: 'ab'.repeat(32) },
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
        device: { name: 'desktop', fingerprint: 'ab'.repeat(32) },
        action: 'release',
        item: 'Unrestricted Origin Test',
        folder: null,
        fields: ['password'],
        origin: 'https://other.example',
        topOrigin: 'https://other.example',
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

async function openVaultPanel(page: Page, overview: ReturnType<typeof buildOverview>) {
  await page.route('**/api/vault', route => route.fulfill({ json: overview }));
  await page.evaluate(() => fixtureApp.features.vaultApprovals.open(''));
  await expect(page.locator('.vault-panel')).toBeVisible();
}

test('approval cards render origin, match badges, policy name, and window gating cleanly at phone width (390x844)', async ({ page, fleet }) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  const overview = buildOverview(Date.now() + 180_000);
  const decisions: Array<{ url: string; decision: unknown }> = [];
  await page.route(`${fleet.self.base}/api/vault/requests/*/decision`, async route => {
    const body = JSON.parse(route.request().postData() || '{}') as { decision?: unknown };
    decisions.push({ url: new URL(route.request().url()).pathname, decision: body.decision });
    await route.fulfill({ json: { request: { id: 'vault-req-cu-1', status: 'approved' } } });
  });

  await openVaultPanel(page, overview);

  const cuCard = page.locator('.vault-panel .vault-card[data-vault-request="vault-req-cu-1"]');
  await expect(cuCard).toBeVisible();
  await expect(cuCard.locator('.vault-policy')).toHaveText('cu-sandbox');
  await expect(cuCard.locator('.vault-origin').first()).toHaveText('https://portal.acme.com');
  await expect(cuCard.locator('.vault-top-origin')).toHaveText('https://www.acme.com');
  await expect(cuCard.locator('[data-vault-origin-match="match"]')).toHaveText('exact match');
  await expect(cuCard.locator('[data-vault-decision="approve"]')).toBeVisible();
  await expect(cuCard.locator('[data-vault-decision="deny"]')).toBeVisible();
  await expect(cuCard.locator('[data-vault-decision="approve-window"]')).toHaveCount(0);

  const legacyCard = page.locator('.vault-panel .vault-card[data-vault-request="vault-req-legacy-1"]');
  await expect(legacyCard.locator('[data-vault-origin-match="no-origin"]')).toHaveText('no origin');
  await expect(legacyCard.locator('.vault-policy')).toHaveCount(0);
  await expect(legacyCard.locator('[data-vault-decision="approve-window"]')).toBeVisible();

  const mismatchCard = page.locator('.vault-panel .vault-card[data-vault-request="vault-req-mismatch-1"]');
  await expect(mismatchCard.locator('.vault-origin')).toHaveText('https://other.example');
  await expect(mismatchCard.locator('.vault-top-origin')).toHaveCount(0);
  await expect(mismatchCard.locator('[data-vault-origin-match="mismatch"]')).toHaveText('mismatch');

  const panelMetrics = await page.locator('.vault-panel').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      overflowX: el.scrollWidth - el.clientWidth,
    };
  });
  expect(panelMetrics.left).toBeGreaterThanOrEqual(0);
  expect(panelMetrics.right).toBeLessThanOrEqual(panelMetrics.viewportWidth);
  expect(panelMetrics.overflowX).toBeLessThanOrEqual(1);

  await cuCard.locator('[data-vault-decision="approve"]').click();
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0]).toEqual({ url: '/api/vault/requests/vault-req-cu-1/decision', decision: 'approve' });
});

test.describe('desktop approval cards (1280x800)', () => {
  test.use({ liveSessions: true });

  test('approval cards render policy badge, origin match, docked card, and server error feedback on desktop', async ({ page, fleet }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await fleet.select(fleet.self, ROOT);
    const selfHostLabel = await page.evaluate((id) => {
      const all = [...fixtureApp.features.sessionState.sessions.active, ...fixtureApp.features.sessionState.sessions.previous];
      const match = all.find(entry => entry.id === id && (entry.host || null) === (fixtureApp.features.sessionState.currentSession?.host || null));
      return match?.hostLabel || '';
    }, ROOT);
    const overview = buildOverview(Date.now() + 180_000, {
      ref: selfHostLabel ? `${selfHostLabel}/${ROOT}` : ROOT,
      host: selfHostLabel || null,
    });
    await page.route(`${fleet.self.base}/api/vault`, route => route.fulfill({ json: overview }));
    await page.route(`${fleet.self.base}/api/vault/requests/vault-req-legacy-1/decision`, route =>
      route.fulfill({ status: 400, json: { error: 'Window approvals are disabled by policy for this device' } }),
    );

    await page.evaluate(() => fixtureApp.features.vaultApprovals.open(''));
    const panel = page.locator('.vault-panel');
    await expect(panel).toBeVisible();

    // The session-linked CU request also docks above the composer without a window button.
    const dockedCard = page.locator('#vaultSessionDock .vault-card[data-vault-request="vault-req-cu-1"]');
    await expect(dockedCard).toBeVisible();
    await expect(dockedCard.locator('.vault-policy')).toHaveText('cu-sandbox');
    await expect(dockedCard.locator('.vault-origin').first()).toHaveText('https://portal.acme.com');
    await expect(dockedCard.locator('.vault-top-origin')).toHaveText('https://www.acme.com');
    await expect(dockedCard.locator('[data-vault-origin-match="match"]')).toHaveText('exact match');
    await expect(dockedCard.locator('[data-vault-decision="approve-window"]')).toHaveCount(0);

    // Panel also renders the legacy no-origin card and mismatch badge cleanly at desktop width.
    const mismatchCard = panel.locator('.vault-card[data-vault-request="vault-req-mismatch-1"]');
    await expect(mismatchCard.locator('.vault-origin')).toHaveText('https://other.example');
    await expect(mismatchCard.locator('[data-vault-origin-match="mismatch"]')).toHaveText('mismatch');

    // If the server rejects a window decision (e.g. policy tightened after load), the panel surfaces the server error.
    await panel.locator('.vault-card[data-vault-request="vault-req-legacy-1"] [data-vault-decision="approve-window"]').click();
    await expect(panel.locator('.vault-notice')).toContainText('Window approvals are disabled by policy for this device');
  });
});

export {};
