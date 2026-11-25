import fs = require('node:fs');
import path = require('node:path');
import type { Route } from '@playwright/test';
import { injectFetchCredsScript, validateOpenMediaRequest } from '../../lib/cu-handlers';
import { test, expect, ROOT } from './fixtures.js';

const PHONE_VIEWPORT = { width: 390, height: 844 };

const FAKE_VIEWER_HTML = `<!doctype html><html><body style="margin:0;background:#00212b;color:#dbe5e6;font-family:monospace;padding:12px">
<div id="viewerHash"></div>
<script>document.getElementById('viewerHash').textContent = location.hash;</script>
</body></html>`;

const RELAY_HOST_ID = '00000000-0000-4000-8000-00000000c0de';
const RELAY_BASE = '/hosts/cu-sandbox';

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
  test('withholds Desktop on unsupported direct cross-origin peers and works via same-origin hub relay without cut controls', async ({ page, fleet }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const expiresAgent = new Date(Date.now() + 90_000).toISOString();
    const expiresHuman = new Date(Date.now() + 600_000).toISOString();
    let seatState: 'agent' | 'human' = 'agent';
    let epoch = 4;
    let ticketCount = 0;
    let takeoverPayload: Record<string, unknown> | null = null;
    let releasePayload: Record<string, unknown> | null = null;

    // Cross-origin direct peer advertises computerUse, but has an absolute cross-origin URL + bearer token -> must NOT offer Desktop.
    await page.route(`${fleet.peer.base}/api/host`, async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      const caps = (json.capabilities as Record<string, unknown>) || {};
      await fulfillPeerJson(route, fleet.self.base, { ...json, capabilities: { ...caps, computerUse: true } });
    });

    // Hub /api/hosts advertises a same-origin relayed CU sandbox (/hosts/cu-sandbox).
    await page.route(`${fleet.self.base}/api/hosts`, async route => {
      const response = await route.fetch();
      const json = (await response.json()) as { hosts: Array<Record<string, unknown>> };
      await route.fulfill({
        json: {
          hosts: [
            ...json.hosts,
            {
              name: 'cu-sandbox',
              base: RELAY_BASE,
              kind: 'direct',
              reachable: true,
              hostId: RELAY_HOST_ID,
              label: 'cu-sandbox',
              version: '1.0.0',
              capabilities: { sessions: true, hostHealth: true, computerUse: true },
            },
          ],
        },
      });
    });
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions*`, route => route.fulfill({
      json: { active: [{ id: ROOT, name: 'sandbox-agent', cwd: '/work', isActive: true, host: RELAY_HOST_ID }], previous: [] },
    }));
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/${ROOT}/messages*`, route => route.fulfill({
      json: { messages: [], total: 0, hasMore: false, nextBefore: null },
    }));
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/${ROOT}/stream*`, route => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': keepalive\n\n',
    }));
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/host/health`, route => route.fulfill({
      json: { uptimeSec: 600, platform: 'linux', arch: 'x64', cpu: { cores: 4, utilization: 0.1, load: [0.1, 0.1, 0.1] }, memory: null, disk: null, disks: [], gpus: [], sessions: { live: 1, working: 0, waiting: 0, subagents: 0 } },
    }));
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/status`, route => route.fulfill({
      json: seatState === 'agent'
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
    }));
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/stream*`, route => route.fulfill({
      status: 200,
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
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/viewer/ticket`, route => {
      ticketCount += 1;
      const ticket = `view-only-${ticketCount}`;
      return route.fulfill({
        json: { ok: true, epoch, mode: 'view-only', ticket, path: `/viewer/#ticket=${ticket}`, spacesPath: `/api/cu/spaces/viewer/#ticket=${ticket}` },
      });
    });
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/takeover`, route => {
      takeoverPayload = route.request().postDataJSON() as Record<string, unknown>;
      seatState = 'human';
      epoch += 1;
      return route.fulfill({
        json: {
          ok: true,
          state: 'human',
          epoch,
          leaseId: 'h1',
          leaseToken: 'tok-human-1',
          lease: { leaseId: 'h1', holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
          preempted: null,
          heartbeatIntervalSec: 60,
          viewer: {
            mode: 'interactive',
            ticket: 'interactive-1',
            path: '/viewer/#ticket=interactive-1',
            spacesPath: '/api/cu/spaces/viewer/#ticket=interactive-1',
          },
        },
      });
    });
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/release`, route => {
      releasePayload = route.request().postDataJSON() as Record<string, unknown>;
      seatState = 'agent';
      epoch += 1;
      return route.fulfill({
        json: {
          ok: true,
          state: 'agent',
          epoch,
          lease: { leaseId: 'a1', sessionId: ROOT, holderKind: 'agent', label: 'omp-browsing', expiresAt: expiresAgent },
          handedBackTo: { sessionId: ROOT, label: 'omp-browsing' },
        },
      });
    });
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/spaces/viewer/*`, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FAKE_VIEWER_HTML,
    }));

    // Refresh fleet & peer identity.
    await page.evaluate(async () => {
      await fixtureApp.features.hostDiscovery.loadFleet();
      await fixtureApp.features.hostDiscovery.identify(true);
    });

    // Open Fleet on phone width -> ONLY same-origin relayed cu-sandbox shows Desktop; direct cross-origin peer does NOT.
    await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await page.locator('#btnFleet').click();
    await expect(page.locator('.main')).toHaveClass(/fleet-open/);
    const sandboxCard = page.locator('.fleet-host').filter({ hasText: 'cu-sandbox' });
    const directPeerCard = page.locator('.fleet-host').filter({ hasText: 'peer' });
    const selfCard = page.locator('.fleet-host').filter({ hasText: 'this server' });
    await expect(sandboxCard.locator('.fleet-cu-btn')).toBeVisible();
    await expect(directPeerCard.locator('.fleet-cu-btn')).toHaveCount(0);
    await expect(selfCard.locator('.fleet-cu-btn')).toHaveCount(0);

    // Programmatic open on unsupported cross-origin peer is refused.
    await page.evaluate(hostId => fixtureApp.features.cuViewerController.open(hostId), fleet.peer.hostId);
    await expect(page.locator('.main')).not.toHaveClass(/cu-viewer-open/);

    // Tap Desktop on same-origin relayed cu-sandbox -> opens pane in view-only mode.
    await sandboxCard.locator('.fleet-cu-btn').click();
    await expect(page.locator('.main')).toHaveClass(/cu-viewer-open/);
    await expect(page.locator('#cuViewerView')).toBeVisible();
    await expect(page.locator('#cuViewerModePill')).toHaveText('View only');
    await expect(page.locator('#cuSeatBadge')).toHaveText('Agent');
    await expect(page.locator('#cuSeatDetail')).toContainText('Agent: omp-browsing');
    await expect(page.locator('#cuSeatDetail')).toContainText('left');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /\/hosts\/cu-sandbox\/api\/cu\/spaces\/viewer\/#ticket=view-only-1/);

    // Cut controls must not exist in DOM.
    await expect(page.locator('#cuDetachDriver')).toHaveCount(0);
    await expect(page.locator('#cuReleaseSeatBtn')).toHaveCount(0);
    await expect(page.locator('#cuForceTakeoverBtn')).toHaveCount(0);

    // Phone viewport has zero horizontal overflow.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Take Over sends { label: 'pi-dish', ttlSec: 600 } with no force or detachDriver.
    await page.locator('#cuTakeoverBtn').click();
    await expect(page.locator('#cuSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuViewerModePill')).toHaveText('Interactive');
    await expect(page.locator('#cuHandBackBtn')).toBeVisible();
    await expect(page.locator('#cuTakeoverBtn')).toBeHidden();
    await expect(page.locator('#cuReleaseSeatBtn')).toHaveCount(0);
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /\/hosts\/cu-sandbox\/api\/cu\/spaces\/viewer\/#ticket=interactive-1/);
    expect(takeoverPayload).toEqual({ label: 'pi-dish', ttlSec: 600 });

    // Hand Back ALWAYS sends handBack: true (even though preempted was null in takeover payload!).
    await page.locator('#cuHandBackBtn').click();
    await expect(page.locator('#cuSeatBadge')).toHaveText('Agent');
    await expect(page.locator('#cuViewerModePill')).toHaveText('View only');
    await expect(page.locator('#cuTakeoverBtn')).toBeVisible();
    await expect(page.locator('#cuHandBackBtn')).toBeHidden();
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /\/hosts\/cu-sandbox\/api\/cu\/spaces\/viewer\/#ticket=view-only-2/);
    expect(releasePayload).toEqual({ leaseId: 'h1', leaseToken: 'tok-human-1', handBack: true });
  });

  test('shows busy 409 without Force Take Over, ignores stale view-only tickets/older epochs after takeover, and remints SSE ticket on reconnect', async ({ page, fleet }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const otherHumanExpiry = new Date(Date.now() + 15 * 60_000).toISOString();
    const ourHumanExpiry = new Date(Date.now() + 600_000).toISOString();

    await page.route(`${fleet.self.base}/api/host`, async route => {
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      const caps = (json.capabilities as Record<string, unknown>) || {};
      await route.fulfill({ json: { ...json, capabilities: { ...caps, computerUse: true } } });
    });
    await page.route(`${fleet.self.base}/api/hosts`, async route => {
      const response = await route.fetch();
      const json = (await response.json()) as { hosts: Array<Record<string, unknown>> };
      await route.fulfill({
        json: {
          hosts: json.hosts.map(host => host.self
            ? { ...host, capabilities: { ...(host.capabilities as Record<string, unknown> || {}), computerUse: true } }
            : host),
        },
      });
    });

    await page.addInitScript(() => {
      const NativeEventSource = window.EventSource;
      const urls: string[] = [];
      Reflect.set(window, '__cuStreamUrls', urls);
      Reflect.set(window, '__cuStreams', [] as EventSource[]);
      class FakeCuEventSource extends EventTarget {
        readonly url: string;
        readyState = 1;
        onmessage: ((ev: MessageEvent) => void) | null = null;
        onopen: ((ev: Event) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSED = 2;
        readonly CONNECTING = 0;
        readonly OPEN = 1;
        readonly CLOSED = 2;
        constructor(url: string) {
          super();
          this.url = url;
          urls.push(url);
          (Reflect.get(window, '__cuStreams') as EventSource[]).push(this as unknown as EventSource);
          queueMicrotask(() => {
            if (this.readyState === 1) this.onopen?.(new Event('open'));
          });
        }
        close() { this.readyState = 2; }
      }
      class TrackedEventSource extends NativeEventSource {
        constructor(url: string | URL, init?: EventSourceInit) {
          const text = String(url);
          if (text.includes('/api/cu/stream')) {
            return new FakeCuEventSource(text) as unknown as TrackedEventSource;
          }
          super(url, init);
        }
      }
      window.EventSource = TrackedEventSource;
    });
    await page.reload();
    await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await page.locator('#tabAll').click();

    let statusCount = 0;
    let releaseDelayedViewTicket!: () => void;
    const delayedViewTicketGate = new Promise<void>(resolve => { releaseDelayedViewTicket = resolve; });
    let ticketCalls = 0;
    let takeoverCalls = 0;

    await page.route(`${fleet.self.base}/api/cu/status`, route => {
      statusCount += 1;
      if (statusCount === 1) {
        return route.fulfill({
          json: {
            ok: true,
            state: 'human',
            epoch: 9,
            lease: { leaseId: 'ssh-1', holderKind: 'human', label: 'ssh-viewer', expiresAt: otherHumanExpiry },
            preempted: null,
          },
        });
      }
      return route.fulfill({
        json: { ok: true, state: 'agent', epoch: 9, lease: { leaseId: 'a1', holderKind: 'agent', label: 'old-agent' }, preempted: null },
      });
    });
    await page.route(`${fleet.self.base}/api/cu/stream*`, route => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': keepalive\n\n',
    }));
    await page.route(`${fleet.self.base}/api/cu/viewer/ticket`, async route => {
      ticketCalls += 1;
      if (ticketCalls === 1) {
        // Hold the initial view-only ticket until AFTER Take Over succeeds!
        await delayedViewTicketGate;
        return route.fulfill({
          json: { ok: true, epoch: 9, mode: 'view-only', ticket: 'stale-view-1', path: '/viewer/#ticket=stale-view-1', spacesPath: '/api/cu/spaces/viewer/#ticket=stale-view-1' },
        });
      }
      return route.fulfill({
        json: { ok: true, epoch: 11, mode: 'view-only', ticket: `fresh-view-${ticketCalls}`, path: `/viewer/#ticket=fresh-view-${ticketCalls}`, spacesPath: `/api/cu/spaces/viewer/#ticket=fresh-view-${ticketCalls}` },
      });
    });
    await page.route(`${fleet.self.base}/api/cu/takeover`, route => {
      takeoverCalls += 1;
      if (takeoverCalls === 1) {
        return route.fulfill({
          status: 409,
          json: {
            ok: false,
            code: 'seat_busy',
            state: 'human',
            epoch: 9,
            holder: { leaseId: 'ssh-1', holderKind: 'human', label: 'ssh-viewer', expiresAt: otherHumanExpiry },
            error: 'Desktop is currently held by ssh-viewer',
          },
        });
      }
      return route.fulfill({
        json: {
          ok: true,
          state: 'human',
          epoch: 10,
          leaseId: 'h-ours',
          leaseToken: 'tok-ours',
          lease: { leaseId: 'h-ours', holderKind: 'human', label: 'pi-dish', expiresAt: ourHumanExpiry },
          preempted: null,
          heartbeatIntervalSec: 60,
          viewer: {
            mode: 'interactive',
            ticket: 'interactive-epoch-10',
            path: '/viewer/#ticket=interactive-epoch-10',
            spacesPath: '/api/cu/spaces/viewer/#ticket=interactive-epoch-10',
          },
        },
      });
    });
    await page.route(`${fleet.self.base}/api/cu/spaces/viewer/*`, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FAKE_VIEWER_HTML,
    }));

    await page.evaluate(() => fixtureApp.features.hostDiscovery.identify(true));
    await page.evaluate(hostId => fixtureApp.features.cuViewerController.open(hostId), fleet.self.hostId);
    await expect(page.locator('#cuSeatBadge')).toHaveText('Human');
    await expect(page.locator('#cuSeatDetail')).toContainText('Human: ssh-viewer');

    // First Take Over gets 409 busy -> shows clear busy notice naming holder with NO Force Take Over button.
    await page.locator('#cuTakeoverBtn').click();
    await expect(page.locator('#cuViewerNotice')).toBeVisible();
    await expect(page.locator('#cuViewerNotice')).toHaveAttribute('data-kind', 'busy');
    await expect(page.locator('#cuViewerNotice')).toContainText('Busy');
    await expect(page.locator('#cuViewerNotice')).toContainText('ssh-viewer');
    await expect(page.locator('#cuForceTakeoverBtn')).toHaveCount(0);

    // Second Take Over succeeds at epoch 10 while the initial epoch-9 view-only ticket is STILL in flight!
    await page.locator('#cuTakeoverBtn').click();
    await expect(page.locator('#cuSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuViewerModePill')).toHaveText('Interactive');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=interactive-epoch-10/);

    // Now release the stale epoch-9 view-only ticket AND dispatch an older-epoch SSE event -> neither may undo interactive control!
    releaseDelayedViewTicket();
    await page.evaluate(() => {
      const streams = Reflect.get(window, '__cuStreams') as EventSource[];
      const latest = streams.at(-1)!;
      latest.dispatchEvent(new MessageEvent('lease_changed', {
        data: JSON.stringify({ state: 'agent', epoch: 9, lease: { leaseId: 'old', holderKind: 'agent', label: 'stale' }, preempted: null }),
      }));
    });
    await page.waitForTimeout(100);
    await expect(page.locator('#cuSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuViewerModePill')).toHaveText('Interactive');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=interactive-epoch-10/);

    // Remote newer epoch end (epoch 11) DOES revert to view-only.
    await page.evaluate(() => {
      const streams = Reflect.get(window, '__cuStreams') as EventSource[];
      const latest = streams.at(-1)!;
      latest.dispatchEvent(new MessageEvent('seat_idle', {
        data: JSON.stringify({ state: 'idle', epoch: 11, lease: null, preempted: null }),
      }));
    });
    await expect(page.locator('#cuSeatBadge')).toHaveText('Idle');
    await expect(page.locator('#cuViewerModePill')).toHaveText('View only');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=fresh-view-2/);

    // Verify SSE reconnect closes the dead EventSource and remints a fresh stream ticket on every retry.
    await page.addScriptTag({ url: `${fleet.self.base}/browser.js` });
    const reminted = await page.evaluate(async () => {
      const container = document.createElement('div');
      container.className = 'main';
      document.body.appendChild(container);
      const factory = (window as unknown as {
        PiDishBrowser: { createCuViewer: (opts: Record<string, unknown>) => { open(host: unknown): void; dispose(): void } };
      }).PiDishBrowser.createCuViewer;
      const openedUrls: string[] = [];
      let minted = 0;
      const created: Array<{ closed: boolean; onerror: ((ev: Event) => void) | null }> = [];
      const viewer = factory({
        root: container,
        request: () => Promise.resolve(new Response(JSON.stringify({ ok: true, state: 'idle', epoch: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })),
        hosts: () => [],
        host: () => null,
        currentSession: () => null,
        supports: () => true,
        dot: () => '',
        ticket: async () => `remint-ticket-${++minted}`,
        source: (url: string) => {
          openedUrls.push(url);
          const fake = {
            url,
            closed: false,
            onerror: null as ((ev: Event) => void) | null,
            onopen: null as (() => void) | null,
            onmessage: null as ((ev: MessageEvent) => void) | null,
            close() { this.closed = true; },
            addEventListener() {},
          };
          created.push(fake);
          return fake as unknown as EventSource;
        },
        closeOtherViews: () => {},
        streamRetryMs: 25,
      });
      viewer.open({ hostId: 'remint-host', base: '/hosts/cu-sandbox', token: 'bearer-tok' });
      await new Promise(resolve => setTimeout(resolve, 40));
      created[0]?.onerror?.(new Event('error'));
      const closedFirst = !!created[0]?.closed;
      await new Promise(resolve => setTimeout(resolve, 80));
      viewer.dispose();
      container.remove();
      // Also verify the live app's EventSource closes and reconnects on error.
      const before = (Reflect.get(window, '__cuStreams') as EventSource[]).length;
      const liveFirst = (Reflect.get(window, '__cuStreams') as EventSource[]).at(-1)!;
      liveFirst.onerror?.(new Event('error'));
      const liveClosedFirst = liveFirst.readyState === EventSource.CLOSED;
      await new Promise(resolve => setTimeout(resolve, 1200));
      const after = (Reflect.get(window, '__cuStreams') as EventSource[]).length;
      return { before, after, liveClosedFirst, closedFirst, openedUrls };
    });
    expect(reminted.liveClosedFirst).toBe(true);
    expect(reminted.after).toBeGreaterThan(reminted.before);
    expect(reminted.closedFirst).toBe(true);
    expect(reminted.openedUrls.length).toBeGreaterThanOrEqual(2);
    expect(reminted.openedUrls[0]).toContain('?ticket=remint-ticket-1');
    expect(reminted.openedUrls[1]).toContain('?ticket=remint-ticket-2');
  });

  test('late initial status reply arriving after Take Over keeps control and Hand Back visible', async ({ page, fleet }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const expiresAgent = new Date(Date.now() + 90_000).toISOString();
    const expiresHuman = new Date(Date.now() + 600_000).toISOString();
    let releaseInitialStatus!: () => void;
    const initialStatusGate = new Promise<void>(resolve => { releaseInitialStatus = resolve; });
    let statusCalls = 0;

    await page.route(`${fleet.self.base}/api/host`, async route => {
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      const caps = (json.capabilities as Record<string, unknown>) || {};
      await route.fulfill({ json: { ...json, capabilities: { ...caps, computerUse: true } } });
    });
    await page.route(`${fleet.self.base}/api/hosts`, async route => {
      const response = await route.fetch();
      const json = (await response.json()) as { hosts: Array<Record<string, unknown>> };
      await route.fulfill({
        json: {
          hosts: json.hosts.map(host => host.self
            ? { ...host, capabilities: { ...(host.capabilities as Record<string, unknown> || {}), computerUse: true } }
            : host),
        },
      });
    });
    await page.reload();

    await page.route(`${fleet.self.base}/api/cu/status`, async route => {
      statusCalls += 1;
      if (statusCalls === 1) {
        // Hold the initial status reply until AFTER Take Over succeeds.
        await initialStatusGate;
      }
      await route.fulfill({
        json: {
          ok: true,
          state: 'agent',
          epoch: 4,
          lease: { leaseId: 'a1', sessionId: ROOT, holderKind: 'agent', label: 'omp-worker', expiresAt: expiresAgent },
          preempted: null,
        },
      });
    });
    await page.route(`${fleet.self.base}/api/cu/stream*`, route => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': keepalive\n\n',
    }));
    await page.route(`${fleet.self.base}/api/cu/viewer/ticket`, route => route.fulfill({
      json: { ok: true, epoch: 4, mode: 'view-only', ticket: 'late-view-only', path: '//evil/ignored', spacesPath: '/api/cu/spaces/../../ignored' },
    }));
    await page.route(`${fleet.self.base}/api/cu/takeover`, route => route.fulfill({
      json: {
        ok: true,
        state: 'human',
        epoch: 5,
        leaseId: 'h-late-1',
        leaseToken: 'tok-late-1',
        lease: { leaseId: 'h-late-1', holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
        preempted: { sessionId: ROOT, label: 'omp-worker' },
        heartbeatIntervalSec: 60,
        viewer: {
          mode: 'interactive',
          ticket: 'interactive-epoch-5',
          path: '//evil/ignored',
          spacesPath: '/api/cu/spaces/../../ignored',
        },
      },
    }));
    await page.route(`${fleet.self.base}/api/cu/spaces/viewer/*`, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FAKE_VIEWER_HTML,
    }));

    // Open viewer (initial GET /api/cu/status is held in flight), then immediately click Take Over.
    await page.evaluate(hostId => fixtureApp.features.cuViewerController.open(hostId), fleet.self.hostId);
    await expect(page.locator('#cuTakeoverBtn')).toBeVisible();
    await page.locator('#cuTakeoverBtn').click();

    await expect(page.locator('#cuSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuViewerModePill')).toHaveText('Interactive');
    await expect(page.locator('#cuHandBackBtn')).toBeVisible();
    await expect(page.locator('#cuTakeoverBtn')).toBeHidden();
    // Iframe URL ignores hostile guest path/spacesPath and pins /api/cu/spaces/viewer/#ticket=...
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', '/api/cu/spaces/viewer/#ticket=interactive-epoch-5');

    // Now deliver the delayed initial status reply (epoch 4, agent).
    releaseInitialStatus();
    await page.waitForTimeout(150);

    // Accepted takeover state, Hand Back button, and interactive iframe must stay intact!
    await expect(page.locator('#cuSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuViewerModePill')).toHaveText('Interactive');
    await expect(page.locator('#cuHandBackBtn')).toBeVisible();
    await expect(page.locator('#cuTakeoverBtn')).toBeHidden();
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', '/api/cu/spaces/viewer/#ticket=interactive-epoch-5');
  });

  test('vendored viewer.js emits a real OpenMediaRequest accepted by display-only observe-only validation', async ({ page, fleet }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const vendorDir = path.resolve(__dirname, '..', '..', 'vendor', 'cua-viewer');
    const indexHtml = injectFetchCredsScript(fs.readFileSync(path.join(vendorDir, 'index.html'), 'utf8'));
    const viewerJs = fs.readFileSync(path.join(vendorDir, 'viewer.js'), 'utf8');
    const indexCss = fs.readFileSync(path.join(vendorDir, 'index.css'), 'utf8');

    const grpcFrame = (payload: Buffer): Buffer => {
      const hdr = Buffer.alloc(5);
      hdr[0] = 0x00;
      hdr.writeUInt32BE(payload.length, 1);
      const trailer = Buffer.from('grpc-status: 0\r\n', 'ascii');
      const tHdr = Buffer.alloc(5);
      tHdr[0] = 0x80;
      tHdr.writeUInt32BE(trailer.length, 1);
      return Buffer.concat([hdr, payload, tHdr, trailer]);
    };
    // ListTargetsResponse { targets: [ StreamTarget { display: Display { id: "xvfb-0", primary: true }, available: true } ] }
    const displayMsg = Buffer.concat([Buffer.from([0x0a, 6]), Buffer.from('xvfb-0', 'utf8'), Buffer.from([0x18, 0x01])]);
    const streamTargetMsg = Buffer.concat([Buffer.from([0x0a, displayMsg.length]), displayMsg, Buffer.from([0x18, 0x01])]);
    const listTargetsBody = grpcFrame(Buffer.concat([Buffer.from([0x0a, streamTargetMsg.length]), streamTargetMsg]));

    let capturedOpenMedia: { contentType: string | undefined; contentEncoding: string | undefined; grpcEncoding: string | undefined; body: Buffer } | null = null;
    let resolveOpenMedia!: () => void;
    const openMediaSeen = new Promise<void>(resolve => { resolveOpenMedia = resolve; });

    const base = `${fleet.self.base}/hosts/cu-sandbox/api/cu/spaces`;
    await page.route(`${base}/viewer/`, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: indexHtml }));
    await page.route(`${base}/viewer/index.css`, route => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: indexCss }));
    await page.route(`${base}/viewer/viewer.js`, route => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: viewerJs }));
    await page.route(`${base}/viewer/cu-fetch-creds.js`, route => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: '' }));
    await page.route(`${base}/cua.env.v1.SystemService/GetCapabilities`, route => route.fulfill({
      status: 200,
      contentType: 'application/grpc-web+proto',
      body: grpcFrame(Buffer.alloc(0)),
    }));
    await page.route(`${base}/cua.env.v1.StreamService/ListTargets`, route => route.fulfill({
      status: 200,
      contentType: 'application/grpc-web+proto',
      body: listTargetsBody,
    }));
    await page.route(`${base}/cua.env.v1.StreamService/OpenMedia`, async route => {
      const headers = route.request().headers();
      capturedOpenMedia = {
        contentType: headers['content-type'],
        contentEncoding: headers['content-encoding'],
        grpcEncoding: headers['grpc-encoding'],
        body: route.request().postDataBuffer() ?? Buffer.alloc(0),
      };
      resolveOpenMedia();
      await route.fulfill({ status: 200, contentType: 'application/grpc-web+proto', headers: { 'grpc-status': '1' }, body: Buffer.alloc(0) });
    });

    await page.goto(`${base}/viewer/#ticket=real-viewer-check`);
    await openMediaSeen;
    expect(capturedOpenMedia).not.toBeNull();
    const verdict = validateOpenMediaRequest(
      capturedOpenMedia!.contentType,
      capturedOpenMedia!.contentEncoding,
      capturedOpenMedia!.grpcEncoding,
      capturedOpenMedia!.body,
    );
    expect(verdict).toEqual({ ok: true, displayId: 'xvfb-0' });
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
