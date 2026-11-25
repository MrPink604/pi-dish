import type { Page, Route } from '@playwright/test';
import { test, expect, ROOT, CHILD, type FleetFixture } from './fixtures.js';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

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

async function installTrackedCuEventSource(page: Page) {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    const streams: EventSource[] = [];
    const urls: string[] = [];
    Reflect.set(window, '__cuPanelStreams', streams);
    Reflect.set(window, '__cuPanelStreamUrls', urls);
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
        streams.push(this as unknown as EventSource);
        queueMicrotask(() => {
          if (this.readyState === 1) this.onopen?.(new Event('open'));
        });
      }
      close() {
        this.readyState = 2;
      }
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
}

async function setupCuSandboxFixture(page: Page, fleet: FleetFixture) {
  const expiresAgent = new Date(Date.now() + 90_000).toISOString();
  const expiresHuman = new Date(Date.now() + 600_000).toISOString();
  const state = {
    seatState: 'agent' as 'idle' | 'agent' | 'human',
    epoch: 4,
    ticketCount: 0,
    statusCount: 0,
    takeoverCount: 0,
    releaseCount: 0,
    takeoverPayload: null as Record<string, unknown> | null,
    releasePayload: null as Record<string, unknown> | null,
    selfCuCalls: 0,
    peerCuCalls: 0,
    expiresAgent,
    expiresHuman,
  };

  // Direct cross-origin peer claims computerUse, but lacks a supported transport -> must NEVER get panel, cue, or CU calls.
  await page.route(`${fleet.peer.base}/api/host`, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
    const response = await route.fetch();
    const json = (await response.json()) as Record<string, unknown>;
    const caps = (json.capabilities as Record<string, unknown>) || {};
    await fulfillPeerJson(route, fleet.self.base, { ...json, capabilities: { ...caps, computerUse: true } });
  });
  await page.route(`${fleet.peer.base}/api/cu/**`, route => {
    state.peerCuCalls += 1;
    return fulfillPeerJson(route, fleet.self.base, { error: 'unexpected peer CU call' }, 500);
  });
  await page.route(`${fleet.self.base}/api/cu/**`, route => {
    state.selfCuCalls += 1;
    return route.fulfill({ status: 404, json: { error: 'not a CU host' } });
  });

  // Hub advertises same-origin relayed cu-sandbox with two active sessions.
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

  await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions*`, route => {
    const q = new URL(route.request().url()).searchParams.get('q')?.trim().toLowerCase() ?? '';
    const allActive = [
      { id: ROOT, name: 'sandbox-one', cwd: '/work', isActive: true, host: RELAY_HOST_ID, lastActivity: Date.now() },
      { id: CHILD, name: 'sandbox-two', cwd: '/work', isActive: true, host: RELAY_HOST_ID, lastActivity: Date.now() - 1000 },
    ];
    const active = q ? allActive.filter(row => row.name.includes(q) || row.cwd.includes(q)) : allActive;
    return route.fulfill({ json: { active, previous: [] } });
  });
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/*/messages*`, route => {
    const url = route.request().url();
    const label = url.includes(CHILD) ? 'sandbox two transcript' : 'sandbox one transcript';
    return route.fulfill({
      json: {
        messages: [{ role: 'user', index: 0, content: [{ type: 'text', text: label }] }],
        total: 1,
        hasMore: false,
        nextBefore: null,
      },
    });
  });
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/*/stream*`, route => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: ': keepalive\n\n',
  }));
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/*/artifacts`, route => route.fulfill({ json: { artifacts: [] } }));
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/*/related`, route => route.fulfill({ json: { related: [] } }));
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/*/reviews`, route => route.fulfill({ json: { reviews: [] } }));
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/*/commands`, route => route.fulfill({ json: { commands: [] } }));
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/models*`, route => route.fulfill({ json: { models: [] } }));

  await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/status`, route => {
    state.statusCount += 1;
    if (state.seatState === 'idle') {
      return route.fulfill({ json: { ok: true, state: 'idle', epoch: state.epoch, lease: null, preempted: null } });
    }
    if (state.seatState === 'agent') {
      return route.fulfill({
        json: {
          ok: true,
          state: 'agent',
          epoch: state.epoch,
          lease: { leaseId: 'a1', sessionId: ROOT, holderKind: 'agent', label: 'omp-browsing', expiresAt: expiresAgent },
          preempted: null,
        },
      });
    }
    return route.fulfill({
      json: {
        ok: true,
        state: 'human',
        epoch: state.epoch,
        lease: { leaseId: 'h1', holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
        preempted: { sessionId: ROOT, label: 'omp-browsing' },
      },
    });
  });

  await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/viewer/ticket`, route => {
    state.ticketCount += 1;
    const body = route.request().postDataJSON() as { mode?: string } | null;
    const mode = body?.mode === 'interactive' ? 'interactive' : 'view-only';
    const ticket = `${mode}-${state.ticketCount}`;
    return route.fulfill({
      json: {
        ok: true,
        epoch: state.epoch,
        mode,
        ticket,
        path: '//evil/ignored',
        spacesPath: `/api/cu/spaces/viewer/#ticket=${ticket}`,
      },
    });
  });

  await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/takeover`, route => {
    state.takeoverCount += 1;
    state.takeoverPayload = route.request().postDataJSON() as Record<string, unknown>;
    state.seatState = 'human';
    state.epoch += 1;
    return route.fulfill({
      json: {
        ok: true,
        state: 'human',
        epoch: state.epoch,
        leaseId: 'h1',
        leaseToken: 'tok-human-1',
        lease: { leaseId: 'h1', holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
        preempted: { sessionId: ROOT, label: 'omp-browsing' },
        heartbeatIntervalSec: 60,
        viewer: {
          mode: 'interactive',
          ticket: `interactive-${state.takeoverCount}`,
          path: '//evil/ignored',
          spacesPath: `/api/cu/spaces/viewer/#ticket=interactive-${state.takeoverCount}`,
        },
      },
    });
  });

  await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/release`, route => {
    state.releaseCount += 1;
    state.releasePayload = route.request().postDataJSON() as Record<string, unknown>;
    state.seatState = 'agent';
    state.epoch += 1;
    return route.fulfill({
      json: {
        ok: true,
        state: 'agent',
        epoch: state.epoch,
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

  return state;
}

for (const { name, viewport, isPhone } of [
  { name: 'phone (390x844)', viewport: PHONE_VIEWPORT, isPhone: true },
  { name: 'desktop (1280x800)', viewport: DESKTOP_VIEWPORT, isPhone: false },
]) {
  test(`session Desktop panel lifecycle, handoff, teardown, and list cue at ${name}`, async ({ page, fleet }) => {
    await installTrackedCuEventSource(page);
    const fx = await setupCuSandboxFixture(page, fleet);
    await page.setViewportSize(viewport);
    await page.reload();

    if (isPhone) {
      await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    }
    await page.locator('#tabAll').click();

    const rowOne = page.locator(`.session-item[data-id="${ROOT}"][data-host="${RELAY_HOST_ID}"]`);
    const rowTwo = page.locator(`.session-item[data-id="${CHILD}"][data-host="${RELAY_HOST_ID}"]`);
    await expect(rowOne).toBeVisible();
    await expect(rowTwo).toBeVisible();

    // 1. Session-list cue appears for both rows on the CU host via ONE host-level SSE subscription.
    await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');
    await expect(rowTwo.locator('.cu-seat-cue')).toHaveText('desktop: agent');
    await expect(rowOne.locator('.cu-seat-cue')).toHaveAttribute('data-holder', 'agent');
    await expect(fleet.row(fleet.self).locator('.cu-seat-cue')).toHaveCount(0);
    await expect(fleet.row(fleet.peer).locator('.cu-seat-cue')).toHaveCount(0);

    const streamUrlsAfterList = await page.evaluate(() => Reflect.get(window, '__cuPanelStreamUrls') as string[]);
    expect(streamUrlsAfterList).toEqual([`${RELAY_BASE}/api/cu/stream`]);
    expect(fx.selfCuCalls).toBe(0);
    expect(fx.peerCuCalls).toBe(0);

    // SSE seat_idle hides the cue; SSE lease_changed (human) re-shows it; SSE agent restores it.
    await page.evaluate(() => {
      const stream = (Reflect.get(window, '__cuPanelStreams') as EventSource[]).at(-1)!;
      stream.dispatchEvent(new MessageEvent('seat_idle', {
        data: JSON.stringify({ state: 'idle', epoch: 5, lease: null, preempted: null }),
      }));
    });
    await expect(rowOne.locator('.cu-seat-cue')).toHaveCount(0);
    await expect(rowTwo.locator('.cu-seat-cue')).toHaveCount(0);

    await page.evaluate(expiresHuman => {
      const stream = (Reflect.get(window, '__cuPanelStreams') as EventSource[]).at(-1)!;
      stream.dispatchEvent(new MessageEvent('lease_changed', {
        data: JSON.stringify({
          state: 'human',
          epoch: 6,
          lease: { leaseId: 'other-human', holderKind: 'human', label: 'ssh-viewer', expiresAt: expiresHuman },
          preempted: null,
        }),
      }));
    }, fx.expiresHuman);
    await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: human');
    await expect(rowOne.locator('.cu-seat-cue')).toHaveAttribute('data-holder', 'human');

    fx.epoch = 7;
    await page.evaluate(expiresAgent => {
      const stream = (Reflect.get(window, '__cuPanelStreams') as EventSource[]).at(-1)!;
      stream.dispatchEvent(new MessageEvent('lease_changed', {
        data: JSON.stringify({
          state: 'agent',
          epoch: 7,
          lease: { leaseId: 'a1', sessionId: 's', holderKind: 'agent', label: 'omp-browsing', expiresAt: expiresAgent },
          preempted: null,
        }),
      }));
    }, fx.expiresAgent);
    await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');

    // 2. Select sandbox-one: panel is present and CLOSED by default (zero iframes).
    await rowOne.click();
    await expect(page.locator('#messages')).toContainText('sandbox one transcript');
    await expect(page.locator('#cuSessionPanel')).toBeVisible();
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#cuSessionPanelBody')).toBeHidden();
    await expect(page.locator('#cuPanelSummary')).toHaveText('Agent');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);

    // 3. Open the panel: shows view-only viewer, holder, remaining time, Take Over, and no duplicate SSE.
    await page.locator('#cuSessionPanelToggle').click();
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#cuSessionPanelBody')).toBeVisible();
    await expect(page.locator('#cuPanelModePill')).toHaveText('View only');
    await expect(page.locator('#cuPanelSeatBadge')).toHaveText('Agent');
    await expect(page.locator('#cuPanelSeatDetail')).toContainText('Agent: omp-browsing');
    await expect(page.locator('#cuPanelSeatDetail')).toContainText('left');
    await expect(page.locator('#cuPanelTakeoverBtn')).toBeVisible();
    await expect(page.locator('#cuPanelHandBackBtn')).toBeHidden();
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveAttribute(
      'src',
      /\/hosts\/cu-sandbox\/api\/cu\/spaces\/viewer\/#ticket=view-only-1/,
    );
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(1);
    expect(await page.evaluate(() => (Reflect.get(window, '__cuPanelStreamUrls') as string[]).length)).toBe(1);

    // Verify layout geometry & zero horizontal overflow at this viewport width.
    const layout = await page.evaluate(() => {
      const panel = document.getElementById('cuSessionPanel')!.getBoundingClientRect();
      const messages = document.getElementById('messages')!.getBoundingClientRect();
      const input = document.querySelector<HTMLElement>('.input-area')!.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom, width: panel.width, height: panel.height },
        messages: { left: messages.left, right: messages.right, top: messages.top, bottom: messages.bottom },
        input: { top: input.top, bottom: input.bottom },
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(0);
    if (isPhone) {
      // Phone: collapsible block pinned directly above the composer.
      expect(layout.panel.bottom).toBeLessThanOrEqual(layout.input.top + 2);
      expect(layout.panel.top).toBeGreaterThanOrEqual(layout.messages.top);
      expect(layout.panel.height).toBeGreaterThanOrEqual(180);
    } else {
      // Desktop: right-hand side panel beside the transcript.
      expect(layout.panel.left).toBeGreaterThanOrEqual(layout.messages.right - 2);
      expect(layout.panel.width).toBeGreaterThanOrEqual(360);
      expect(layout.panel.height).toBeGreaterThanOrEqual(400);
    }

    // 4. Take Over inside the panel.
    await page.locator('#cuPanelTakeoverBtn').click();
    await expect(page.locator('#cuPanelSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuPanelModePill')).toHaveText('Interactive');
    await expect(page.locator('#cuPanelHandBackBtn')).toBeVisible();
    await expect(page.locator('#cuPanelTakeoverBtn')).toBeHidden();
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveAttribute(
      'src',
      /\/hosts\/cu-sandbox\/api\/cu\/spaces\/viewer\/#ticket=interactive-1/,
    );
    expect(fx.takeoverCount).toBe(1);
    expect(fx.takeoverPayload).toEqual({ label: 'pi-dish', ttlSec: 600 });

    // 5. Opening the main-pane Desktop viewer for the SAME host hands off the single controller (no duplicate takeover, iframe, or SSE).
    await page.locator('#sessionDesktopChip').click();
    await expect(page.locator('.main')).toHaveClass(/cu-viewer-open/);
    await expect(page.locator('#cuViewerView')).toBeVisible();
    await expect(page.locator('#cuSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuViewerModePill')).toHaveText('Interactive');
    await expect(page.locator('#cuHandBackBtn')).toBeVisible();
    await expect(page.locator('#cuViewerStage iframe.cu-viewer-frame')).toHaveAttribute(
      'src',
      /\/hosts\/cu-sandbox\/api\/cu\/spaces\/viewer\/#ticket=interactive-1/,
    );
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(0);
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(1);
    expect(fx.takeoverCount).toBe(1);
    expect(await page.evaluate(() => (Reflect.get(window, '__cuPanelStreamUrls') as string[]).length)).toBe(1);

    // Close main-pane viewer -> zero iframes. Re-open panel -> resumes interactive lease cleanly.
    await page.locator('#cuViewerCloseBtn').click();
    await expect(page.locator('.main')).not.toHaveClass(/cu-viewer-open/);
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
    await page.locator('#cuSessionPanelToggle').click();
    await expect(page.locator('#cuPanelSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuPanelModePill')).toHaveText('Interactive');
    await expect(page.locator('#cuPanelHandBackBtn')).toBeVisible();
    expect(fx.takeoverCount).toBe(1);

    // 6. Hand Back inside the panel -> returns to view-only and sends handBack: true.
    await page.locator('#cuPanelHandBackBtn').click();
    await expect(page.locator('#cuPanelSeatBadge')).toHaveText('Agent');
    await expect(page.locator('#cuPanelModePill')).toHaveText('View only');
    await expect(page.locator('#cuPanelTakeoverBtn')).toBeVisible();
    await expect(page.locator('#cuPanelHandBackBtn')).toBeHidden();
    expect(fx.releaseCount).toBe(1);
    expect(fx.releasePayload).toEqual({ leaseId: 'h1', leaseToken: 'tok-human-1', handBack: true });

    // 7. Switching to sandbox-two (closed by default) tears down the iframe cleanly; switching back restores open state from sessionStorage.
    if (isPhone) await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await rowTwo.click();
    await expect(page.locator('#messages')).toContainText('sandbox two transcript');
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#cuSessionPanelBody')).toBeHidden();
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);

    if (isPhone) await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await rowOne.click();
    await expect(page.locator('#messages')).toContainText('sandbox one transcript');
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);

    // Collapsing clears iframe and remembers closed in sessionStorage.
    await page.locator('#cuSessionPanelToggle').click();
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);

    // Re-open on sandbox-one, then switch to non-CU self session -> panel hides and tears down cleanly.
    await page.locator('#cuSessionPanelToggle').click();
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    if (isPhone) await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await fleet.row(fleet.self).click();
    await expect(page.locator('#messages')).toContainText('self root transcript');
    await expect(page.locator('#cuSessionPanel')).toBeHidden();
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);

    // Direct cross-origin peer claiming computerUse also shows NO panel.
    if (isPhone) await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await fleet.row(fleet.peer).click();
    await expect(page.locator('#messages')).toContainText('peer root transcript');
    await expect(page.locator('#cuSessionPanel')).toBeHidden();
    await expect(page.locator('#sessionDesktopChip')).toBeHidden();
    expect(fx.peerCuCalls).toBe(0);
    expect(fx.selfCuCalls).toBe(0);
  });
}

test('closes the CU host SSE stream when its sessions leave the visible list, and tears down SSE on panel collapse and session switch', async ({ page, fleet }) => {
  await installTrackedCuEventSource(page);
  await setupCuSandboxFixture(page, fleet);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.reload();
  await page.locator('#tabAll').click();

  const rowOne = page.locator(`.session-item[data-id="${ROOT}"][data-host="${RELAY_HOST_ID}"]`);
  await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');
  await expect.poll(() => page.evaluate(() => {
    const streams = Reflect.get(window, '__cuPanelStreams') as EventSource[];
    return streams.map(s => s.readyState);
  })).toEqual([1]);

  // Select sandbox-one (panel closed by default), then filter sidebar to "self root" so cu-sandbox has zero visible sessions -> SSE closes immediately.
  await rowOne.click();
  await page.locator('#filterInput').fill('self root');
  await expect(rowOne).toHaveCount(0);
  await expect(fleet.row(fleet.self)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const streams = Reflect.get(window, '__cuPanelStreams') as EventSource[];
    return streams.map(s => s.readyState);
  })).toEqual([2]);

  // With cu-sandbox absent from the sidebar, opening the panel opens a dedicated SSE stream + iframe; collapsing tears down BOTH.
  await page.locator('#cuSessionPanelToggle').click();
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    const streams = Reflect.get(window, '__cuPanelStreams') as EventSource[];
    return streams.map(s => s.readyState);
  })).toEqual([2, 1]);

  await page.locator('#cuSessionPanelToggle').click();
  await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const streams = Reflect.get(window, '__cuPanelStreams') as EventSource[];
    return streams.map(s => s.readyState);
  })).toEqual([2, 2]);

  // Re-open the panel, then switch to self -> tears down BOTH iframe and SSE immediately.
  await page.locator('#cuSessionPanelToggle').click();
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    const streams = Reflect.get(window, '__cuPanelStreams') as EventSource[];
    return streams.map(s => s.readyState);
  })).toEqual([2, 2, 1]);

  await fleet.row(fleet.self).click();
  await expect(page.locator('#messages')).toContainText('self root transcript');
  await expect(page.locator('#cuSessionPanel')).toBeHidden();
  await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const streams = Reflect.get(window, '__cuPanelStreams') as EventSource[];
    return streams.map(s => s.readyState);
  })).toEqual([2, 2, 2]);
});

test.describe('session Desktop panel version skew', () => {
  test('new JS against old peers without computerUse shows no panel or cue and makes zero /api/cu requests', async ({ page, fleet }) => {
    let cuRequests = 0;
    await page.route('**/api/cu/**', route => {
      cuRequests += 1;
      return route.fulfill({ status: 404, json: { error: 'unsupported' } });
    });

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.reload();
    await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await page.locator('#tabAll').click();

    await expect(fleet.row(fleet.self)).toBeVisible();
    await expect(fleet.row(fleet.peer)).toBeVisible();
    await expect(page.locator('.cu-seat-cue')).toHaveCount(0);

    await fleet.row(fleet.peer).click();
    await expect(page.locator('#messages')).toContainText('peer root transcript');
    await expect(page.locator('#cuSessionPanel')).toHaveCount(0);
    await expect(page.locator('#sessionDesktopChip')).toBeHidden();
    expect(cuRequests).toBe(0);
  });

  test('new JS creates #cuSessionPanel dynamically on older cached HTML, while static HTML carries no panel markup for older JS', async ({ page, fleet }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    // Verify served static HTML has zero #cuSessionPanel markup (old JS sees unchanged HTML).
    const rawHtml = await (await fetch(`${fleet.self.base}/`)).text();
    expect(rawHtml).not.toContain('cuSessionPanel');
    expect(rawHtml).not.toContain('cu-session-panel');

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
      json: { ok: true, epoch: 1, mode: 'view-only', ticket: 'panel-skew-1', path: '/viewer/#ticket=panel-skew-1', spacesPath: '/api/cu/spaces/viewer/#ticket=panel-skew-1' },
    }));
    await page.route(`${fleet.self.base}/api/cu/spaces/viewer/*`, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FAKE_VIEWER_HTML,
    }));

    await page.goto(fleet.self.base);
    await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await page.locator('#tabAll').click();
    await fleet.row(fleet.self).click();

    await expect(page.locator('#cuSessionPanel')).toBeVisible();
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#cuSessionPanelToggle').click();
    await expect(page.locator('#cuPanelSeatBadge')).toHaveText('Idle');
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveAttribute('src', '/api/cu/spaces/viewer/#ticket=panel-skew-1');
    expect(errors).toEqual([]);
  });
});

export {};
