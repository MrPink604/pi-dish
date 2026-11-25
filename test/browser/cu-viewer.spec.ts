import type { Route } from '@playwright/test';
import { test, expect, ROOT } from './fixtures.js';

const PHONE_VIEWPORT = { width: 390, height: 844 };

const FAKE_VIEWER_HTML = `<!doctype html><html><body style="margin:0;background:#00212b;color:#dbe5e6;font-family:monospace;padding:12px">
<div id="viewerHash"></div>
<script>document.getElementById('viewerHash').textContent = location.hash;</script>
</body></html>`;

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, x-pi-dish-private-unlock',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function fulfillPeerJson(route: Route, origin: string, json: unknown, status = 200) {
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: corsHeaders(origin) });
  }
  return route.fulfill({ status, headers: corsHeaders(origin), json });
}

test.describe('computer-use desktop viewer at phone width (390x844)', () => {
  test('reachable from Fleet and session chip, displays holder/time left, and Take Over / Hand Back work', async ({ page, fleet }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const expiresAgent = new Date(Date.now() + 90_000).toISOString();
    const expiresHuman = new Date(Date.now() + 600_000).toISOString();
    let seatState: 'agent' | 'human' = 'agent';
    let epoch = 4;
    let ticketCount = 0;
    let takeoverPayload: Record<string, unknown> | null = null;
    let releasePayload: Record<string, unknown> | null = null;

    await page.route(`${fleet.peer.base}/api/host`, async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      const caps = (json.capabilities as Record<string, unknown>) || {};
      await fulfillPeerJson(route, fleet.self.base, { ...json, capabilities: { ...caps, computerUse: true } });
    });
    await page.route(`${fleet.peer.base}/api/cu/status`, route => fulfillPeerJson(route, fleet.self.base,
      seatState === 'agent'
        ? {
            ok: true,
            state: 'agent',
            epoch,
            lease: { leaseId: 'a1', sessionId: ROOT, holderKind: 'agent', label: 'omp-browsing', expiresAt: expiresAgent },
            preempted: null,
          }
        : {
            ok: true,
            state: 'human',
            epoch,
            lease: { leaseId: 'h1', holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
            preempted: { sessionId: ROOT, label: 'omp-browsing' },
          },
    ));
    await page.route(`${fleet.peer.base}/api/cu/stream*`, route => route.fulfill({
      status: 200,
      headers: corsHeaders(fleet.self.base),
      contentType: 'text/event-stream',
      body: `event: hello\ndata: ${JSON.stringify({
        state: seatState,
        epoch,
        lease: seatState === 'agent'
          ? { leaseId: 'a1', sessionId: ROOT, holderKind: 'agent', label: 'omp-browsing', expiresAt: expiresAgent }
          : { leaseId: 'h1', holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
        preempted: seatState === 'human' ? { sessionId: ROOT, label: 'omp-browsing' } : null,
      })}\n\n`,
    }));
    await page.route(`${fleet.peer.base}/api/cu/viewer/ticket`, route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
      ticketCount += 1;
      const ticket = `view-only-${ticketCount}`;
      return fulfillPeerJson(route, fleet.self.base, {
        ok: true, epoch, mode: 'view-only', ticket, path: `/viewer/#ticket=${ticket}`, spacesPath: `/api/cu/spaces/viewer/#ticket=${ticket}`,
      });
    });
    await page.route(`${fleet.peer.base}/api/cu/takeover`, route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
      takeoverPayload = route.request().postDataJSON() as Record<string, unknown>;
      seatState = 'human';
      epoch += 1;
      return fulfillPeerJson(route, fleet.self.base, {
        ok: true,
        state: 'human',
        epoch,
        leaseId: 'h1',
        leaseToken: 'tok-human-1',
        lease: { leaseId: 'h1', holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
        preempted: { sessionId: ROOT, label: 'omp-browsing' },
        driverDetached: false,
        heartbeatIntervalSec: 60,
        viewer: {
          mode: 'interactive',
          ticket: 'interactive-1',
          path: '/viewer/#ticket=interactive-1',
          spacesPath: '/api/cu/spaces/viewer/#ticket=interactive-1',
        },
      });
    });
    await page.route(`${fleet.peer.base}/api/cu/release`, route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
      releasePayload = route.request().postDataJSON() as Record<string, unknown>;
      seatState = 'agent';
      epoch += 1;
      return fulfillPeerJson(route, fleet.self.base, {
        ok: true,
        state: 'agent',
        epoch,
        lease: { leaseId: 'a1', sessionId: ROOT, holderKind: 'agent', label: 'omp-browsing', expiresAt: expiresAgent },
        handedBackTo: { sessionId: ROOT, label: 'omp-browsing' },
      });
    });
    await page.route(`${fleet.peer.base}/api/cu/spaces/viewer/*`, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FAKE_VIEWER_HTML,
    }));

    // Refresh peer identity so capabilities.computerUse is discovered.
    await page.evaluate(() => fixtureApp.features.hostDiscovery.identify(true));

    // Open Fleet on phone width -> only the CU-capable peer card shows Desktop.
    await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await page.locator('#btnFleet').click();
    await expect(page.locator('.main')).toHaveClass(/fleet-open/);
    const peerCard = page.locator('.fleet-host').filter({ hasText: 'peer' });
    const selfCard = page.locator('.fleet-host').filter({ hasText: 'this server' });
    await expect(peerCard.locator('.fleet-cu-btn')).toBeVisible();
    await expect(selfCard.locator('.fleet-cu-btn')).toHaveCount(0);

    // Tap Desktop -> opens computer-use viewer pane in view-only mode.
    await peerCard.locator('.fleet-cu-btn').click();
    await expect(page.locator('.main')).toHaveClass(/cu-viewer-open/);
    await expect(page.locator('#cuViewerView')).toBeVisible();
    await expect(page.locator('#cuViewerModePill')).toHaveText('View only');
    await expect(page.locator('#cuSeatBadge')).toHaveText('Agent');
    await expect(page.locator('#cuSeatDetail')).toContainText('Agent: omp-browsing');
    await expect(page.locator('#cuSeatDetail')).toContainText('left');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /\/api\/cu\/spaces\/viewer\/#ticket=view-only-1/);

    // Verify phone viewport has no horizontal overflow.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Click Take Over -> preempts agent (10-min lease), switches iframe to interactive ticket, shows Hand Back.
    await page.locator('#cuTakeoverBtn').click();
    await expect(page.locator('#cuSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuSeatDetail')).toContainText('left');
    await expect(page.locator('#cuViewerModePill')).toHaveText('Interactive');
    await expect(page.locator('#cuHandBackBtn')).toBeVisible();
    await expect(page.locator('#cuTakeoverBtn')).toBeHidden();
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /\/api\/cu\/spaces\/viewer\/#ticket=interactive-1/);
    expect(takeoverPayload).toMatchObject({ ttlSec: 600, detachDriver: false });

    // Click Hand Back -> releases with handBack: true and returns iframe to view-only.
    await page.locator('#cuHandBackBtn').click();
    await expect(page.locator('#cuSeatBadge')).toHaveText('Agent');
    await expect(page.locator('#cuViewerModePill')).toHaveText('View only');
    await expect(page.locator('#cuTakeoverBtn')).toBeVisible();
    await expect(page.locator('#cuHandBackBtn')).toBeHidden();
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /\/api\/cu\/spaces\/viewer\/#ticket=view-only-2/);
    expect(releasePayload).toMatchObject({ leaseId: 'h1', leaseToken: 'tok-human-1', handBack: true });

    // Close viewer -> select a session on the CU host -> Desktop chip opens viewer directly.
    await page.locator('#cuViewerCloseBtn').click();
    await expect(page.locator('.main')).not.toHaveClass(/cu-viewer-open/);
    await fleet.select(fleet.peer);
    await expect(page.locator('#sessionDesktopChip')).toBeVisible();
    await page.locator('#sessionDesktopChip').click();
    await expect(page.locator('.main')).toHaveClass(/cu-viewer-open/);
  });

  test('displays clear busy 409 state with holder, supports Force Take Over, and reverts on remote epoch end', async ({ page, fleet }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const otherHumanExpiry = new Date(Date.now() + 15 * 60_000).toISOString();
    const ourHumanExpiry = new Date(Date.now() + 600_000).toISOString();
    let forceSeen = false;
    let ticketCount = 0;

    await page.addInitScript(() => {
      const NativeEventSource = window.EventSource;
      class TrackedEventSource extends NativeEventSource {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init);
          if (String(url).includes('/api/cu/stream')) {
            Reflect.set(window, '__cuTestStream', this);
          }
        }
      }
      window.EventSource = TrackedEventSource;
    });
    await page.reload();
    await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await page.locator('#tabAll').click();

    await page.route(`${fleet.peer.base}/api/host`, async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      const caps = (json.capabilities as Record<string, unknown>) || {};
      await fulfillPeerJson(route, fleet.self.base, { ...json, capabilities: { ...caps, computerUse: true } });
    });
    await page.route(`${fleet.peer.base}/api/cu/status`, route => fulfillPeerJson(route, fleet.self.base, {
      ok: true,
      state: 'human',
      epoch: 9,
      lease: { leaseId: 'ssh-1', holderKind: 'human', label: 'ssh-viewer', expiresAt: otherHumanExpiry },
      preempted: null,
    }));
    await page.route(`${fleet.peer.base}/api/cu/stream*`, route => route.fulfill({
      status: 200,
      headers: corsHeaders(fleet.self.base),
      contentType: 'text/event-stream',
      body: ': keepalive\n\n',
    }));
    await page.route(`${fleet.peer.base}/api/cu/viewer/ticket`, route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
      ticketCount += 1;
      const ticket = `view-${ticketCount}`;
      return fulfillPeerJson(route, fleet.self.base, {
        ok: true, epoch: 9, mode: 'view-only', ticket, path: `/viewer/#ticket=${ticket}`, spacesPath: `/api/cu/spaces/viewer/#ticket=${ticket}`,
      });
    });
    await page.route(`${fleet.peer.base}/api/cu/takeover`, route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.force !== true) {
        return fulfillPeerJson(route, fleet.self.base, {
          ok: false,
          code: 'seat_busy',
          state: 'human',
          epoch: 9,
          holder: { leaseId: 'ssh-1', holderKind: 'human', label: 'ssh-viewer', expiresAt: otherHumanExpiry },
          lease: { leaseId: 'ssh-1', holderKind: 'human', label: 'ssh-viewer', expiresAt: otherHumanExpiry },
          error: 'Desktop is currently held by ssh-viewer',
        }, 409);
      }
      forceSeen = true;
      return fulfillPeerJson(route, fleet.self.base, {
        ok: true,
        state: 'human',
        epoch: 10,
        leaseId: 'h-forced',
        leaseToken: 'tok-forced',
        lease: { leaseId: 'h-forced', holderKind: 'human', label: 'pi-dish', expiresAt: ourHumanExpiry },
        preempted: null,
        driverDetached: false,
        heartbeatIntervalSec: 60,
        viewer: {
          mode: 'interactive',
          ticket: 'interactive-forced',
          path: '/viewer/#ticket=interactive-forced',
          spacesPath: '/api/cu/spaces/viewer/#ticket=interactive-forced',
        },
      });
    });
    await page.route(`${fleet.peer.base}/api/cu/spaces/viewer/*`, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FAKE_VIEWER_HTML,
    }));

    await page.evaluate(() => fixtureApp.features.hostDiscovery.identify(true));
    await page.evaluate(hostId => fixtureApp.features.cuViewerController.open(hostId), fleet.peer.hostId);
    await expect(page.locator('#cuSeatBadge')).toHaveText('Human');
    await expect(page.locator('#cuSeatDetail')).toContainText('Human: ssh-viewer');

    // Take Over returns 409 busy -> shows clear busy notice naming holder + Force Take Over button.
    await page.locator('#cuTakeoverBtn').click();
    await expect(page.locator('#cuViewerNotice')).toBeVisible();
    await expect(page.locator('#cuViewerNotice')).toHaveAttribute('data-kind', 'busy');
    await expect(page.locator('#cuViewerNotice')).toContainText('Busy');
    await expect(page.locator('#cuViewerNotice')).toContainText('ssh-viewer');
    await expect(page.locator('#cuForceTakeoverBtn')).toBeVisible();

    // Force Take Over sends force: true and grants interactive control.
    await page.locator('#cuForceTakeoverBtn').click();
    expect(forceSeen).toBe(true);
    await expect(page.locator('#cuSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuViewerModePill')).toHaveText('Interactive');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=interactive-forced/);

    // Remote epoch end (e.g. TTL expiry or cu-seat release) reverts to view-only immediately.
    await page.evaluate(() => {
      const stream = Reflect.get(window, '__cuTestStream') as EventSource | undefined;
      if (!stream) throw new Error('Expected tracked /api/cu/stream EventSource');
      stream.dispatchEvent(new MessageEvent('seat_idle', {
        data: JSON.stringify({ state: 'idle', epoch: 11, lease: null, preempted: null }),
      }));
    });
    await expect(page.locator('#cuSeatBadge')).toHaveText('Idle');
    await expect(page.locator('#cuViewerModePill')).toHaveText('View only');
    await expect(page.locator('#cuTakeoverBtn')).toBeVisible();
    await expect(page.locator('#cuHandBackBtn')).toBeHidden();
    await expect(page.locator('#cuViewerNotice')).toContainText('returned to view-only');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=view-2/);
  });
});

test.describe('HTML/JS version skew safety', () => {
  test('new JS boots cleanly on older cached HTML missing #cuViewerView and #sessionDesktopChip', async ({ page, fleet }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.route(`${fleet.self.base}/`, async route => {
      const response = await route.fetch();
      const html = (await response.text())
        .replace(/<div class="cu-viewer-view" id="cuViewerView"[^>]*><\/div>/, '')
        .replace(/<button[^>]*id="sessionDesktopChip"[^>]*>.*?<\/button>/, '');
      await route.fulfill({ response, body: html });
    });
    await page.route(`${fleet.self.base}/api/host`, async route => {
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      const caps = (json.capabilities as Record<string, unknown>) || {};
      await route.fulfill({ json: { ...json, capabilities: { ...caps, computerUse: true } } });
    });
    await page.route(`${fleet.self.base}/api/cu/status`, route => route.fulfill({
      json: { ok: true, state: 'idle', epoch: 1, lease: null, preempted: null },
    }));
    await page.route(`${fleet.self.base}/api/cu/stream*`, route => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': keepalive\n\n',
    }));
    await page.route(`${fleet.self.base}/api/cu/viewer/ticket`, route => route.fulfill({
      json: { ok: true, epoch: 1, mode: 'view-only', ticket: 'skew-1', path: '/viewer/#ticket=skew-1', spacesPath: '/api/cu/spaces/viewer/#ticket=skew-1' },
    }));
    await page.route(`${fleet.self.base}/api/cu/spaces/viewer/*`, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FAKE_VIEWER_HTML,
    }));

    await page.goto(fleet.self.base);
    await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await page.locator('#tabAll').click();
    await expect(fleet.row(fleet.self)).toBeVisible();
    expect(errors).toEqual([]);

    // Dynamic session chip & viewer pane work even when absent from cached HTML.
    await fleet.row(fleet.self).click();
    await expect(page.locator('#sessionDesktopChip')).toBeVisible();
    await page.locator('#sessionDesktopChip').click();
    await expect(page.locator('#cuViewerView')).toBeVisible();
    await expect(page.locator('#cuSeatBadge')).toHaveText('Idle');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=skew-1/);
    expect(errors).toEqual([]);
  });

  test('new HTML stays hidden and emits zero unknown-action errors under older JS bindings', async ({ page, fleet }) => {
    void fleet;
    await page.setViewportSize(PHONE_VIEWPORT);
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await expect(page.locator('#cuViewerView')).toBeHidden();
    await expect(page.locator('#sessionDesktopChip')).toBeHidden();
    // Static HTML carries no new data-app-* action names that older app-bindings would reject.
    const cuActions = await page.evaluate(() => {
      const view = document.getElementById('cuViewerView');
      const chip = document.getElementById('sessionDesktopChip');
      const attrs = (el: Element | null) => el ? [...el.attributes].map(a => a.name).filter(n => n.startsWith('data-app-')) : [];
      return [...attrs(view), ...attrs(chip)];
    });
    expect(cuActions).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

export {};
