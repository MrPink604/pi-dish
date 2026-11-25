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

async function setupCuSandboxFixture(
  page: Page,
  fleet: FleetFixture,
  opts: {
    relayBase?: () => string;
    releaseStatus?: () => number;
    holdStatus?: () => Promise<{ status?: number; json: Record<string, unknown> } | null> | null;
    holdTicket?: () => Promise<void> | null;
  } = {},
) {
  const expiresAgent = new Date(Date.now() + 90_000).toISOString();
  const expiresHuman = new Date(Date.now() + 600_000).toISOString();
  const state = {
    seatState: 'agent' as 'idle' | 'agent' | 'human',
    epoch: 4,
    ticketCount: 0,
    statusCount: 0,
    takeoverCount: 0,
    releaseCount: 0,
    heartbeatCount: 0,
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
    const base = opts.relayBase ? opts.relayBase() : RELAY_BASE;
    await route.fulfill({
      json: {
        hosts: [
          ...json.hosts,
          {
            name: 'cu-sandbox',
            base,
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
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/*/file?*`, route => route.fulfill({
    json: { path: '/work/a.txt', relPath: 'a.txt', content: 'sandbox file body', size: 17, mtime: 1 },
  }));
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/*/diff`, route => route.fulfill({
    json: { root: '/work', gitAvailable: true, repos: [] },
  }));
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/pages`, route => route.fulfill({ json: [] }));
  await page.route(`${fleet.self.base}${RELAY_BASE}/api/models*`, route => route.fulfill({ json: { models: [] } }));

  await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/status`, async route => {
    state.statusCount += 1;
    const held = opts.holdStatus?.();
    if (held) {
      const custom = await held;
      if (custom) return route.fulfill({ status: custom.status ?? 200, json: custom.json });
    }
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
        lease: { leaseId: `h${state.takeoverCount || 1}`, holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
        preempted: { sessionId: ROOT, label: 'omp-browsing' },
      },
    });
  });

  await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/heartbeat`, route => {
    state.heartbeatCount += 1;
    return route.fulfill({
      json: {
        ok: true,
        state: state.seatState,
        epoch: state.epoch,
        lease: state.seatState === 'human'
          ? { leaseId: `h${state.takeoverCount || 1}`, holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman }
          : null,
      },
    });
  });

  await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/viewer/ticket`, async route => {
    state.ticketCount += 1;
    const gate = opts.holdTicket?.();
    if (gate) await gate;
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
    const leaseId = `h${state.takeoverCount}`;
    const leaseToken = `tok-human-${state.takeoverCount}`;
    state.takeoverPayload = route.request().postDataJSON() as Record<string, unknown>;
    state.seatState = 'human';
    state.epoch += 1;
    return route.fulfill({
      json: {
        ok: true,
        state: 'human',
        epoch: state.epoch,
        leaseId,
        leaseToken,
        lease: { leaseId, holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
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
    const status = opts.releaseStatus ? opts.releaseStatus() : 200;
    if (status !== 200) {
      return route.fulfill({ status, json: { error: 'broker unavailable' } });
    }
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

for (const [label, viewport] of [
  ['phone (390x844)', PHONE_VIEWPORT],
  ['desktop (1280x800)', DESKTOP_VIEWPORT],
] as const) {
  test(`view-only session Desktop panel, Take Over handoff to standalone pane, Hand Back in pane, and list cue at ${label}`, async ({ page, fleet }) => {
    await installTrackedCuEventSource(page);
    const fx = await setupCuSandboxFixture(page, fleet);
    await page.setViewportSize(viewport);
    await page.reload();

    if (viewport.width < 900) {
      await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    }
    await page.locator('#tabAll').click();

    const rowOne = page.locator(`.session-item[data-id="${ROOT}"][data-host="${RELAY_HOST_ID}"]`);
    const rowTwo = page.locator(`.session-item[data-id="${CHILD}"][data-host="${RELAY_HOST_ID}"]`);
    await expect(rowOne).toBeVisible();
    await expect(rowTwo).toBeVisible();

    // Host-level list cue appears on CU host rows ONLY, using a SINGLE shared SSE stream for the CU host.
    await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');
    await expect(rowTwo.locator('.cu-seat-cue')).toHaveText('desktop: agent');
    await expect(fleet.row(fleet.self).locator('.cu-seat-cue')).toHaveCount(0);
    await expect(fleet.row(fleet.peer).locator('.cu-seat-cue')).toHaveCount(0);
    const streamCountAfterList = await page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).length);
    expect(streamCountAfterList).toBe(1);

    // Unsupported direct cross-origin peer never gets a session panel even when claiming computerUse.
    await fleet.row(fleet.peer).click();
    await expect(page.locator('#messages')).toContainText('peer root transcript');
    await expect(page.locator('#cuSessionPanel')).toHaveCount(0);
    expect(fx.peerCuCalls).toBe(0);
    expect(fx.selfCuCalls).toBe(0);

    // Select CU host session -> panel appears CLOSED by default with host-level seat summary.
    if (viewport.width < 900) {
      await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    }
    await rowOne.click();
    await expect(page.locator('#messages')).toContainText('sandbox one transcript');
    await expect(page.locator('#cuSessionPanel')).toBeVisible();
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#cuSessionPanelBody')).toBeHidden();
    await expect(page.locator('#cuPanelSummary')).toHaveText('desktop: agent');
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);

    // Open the session panel -> strictly view-only, zero Hand Back button, reuses the shared SSE stream.
    await page.locator('#cuSessionPanelToggle').click();
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#cuSessionPanelBody')).toBeVisible();
    await expect(page.locator('#cuPanelModePill')).toHaveText('View only');
    await expect(page.locator('#cuPanelSeatBadge')).toHaveText('Agent');
    await expect(page.locator('#cuPanelSeatDetail')).toContainText('Agent: omp-browsing');
    await expect(page.locator('#cuPanelSeatDetail')).toContainText('left');
    await expect(page.locator('#cuPanelTakeoverBtn')).toBeVisible();
    await expect(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveAttribute(
      'src',
      `${RELAY_BASE}/api/cu/spaces/viewer/#ticket=view-only-1`,
    );

    const streamCountAfterPanelOpen = await page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).length);
    expect(streamCountAfterPanelOpen).toBe(1);
    expect(fx.takeoverCount).toBe(0);
    expect(fx.heartbeatCount).toBe(0);
    expect(fx.releaseCount).toBe(0);

    // Verify layout geometry at each width and zero horizontal overflow.
    const layout = await page.evaluate(() => {
      const panel = document.getElementById('cuSessionPanel')!.getBoundingClientRect();
      const input = document.querySelector<HTMLElement>('.input-area')!.getBoundingClientRect();
      const messages = document.getElementById('messages')!.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        panelAboveInput: panel.bottom <= input.top + 2,
        panelBesideMessages: panel.left >= messages.right - 2,
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(0);
    if (viewport.width < 900) {
      expect(layout.panelAboveInput).toBe(true);
    } else {
      expect(layout.panelBesideMessages).toBe(true);
    }

    // Open/closed state is remembered per session in sessionStorage across reload (still view-only).
    await page.reload();
    await expect(page.locator('#messages')).toContainText('sandbox one transcript');
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    await expect(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
    expect(fx.takeoverCount).toBe(0);
    expect(fx.heartbeatCount).toBe(0);
    expect(fx.releaseCount).toBe(0);

    // Clicking "Take Over" inside the panel opens the standalone Desktop pane and NEVER calls takeover/heartbeat/release itself.
    await page.locator('#cuPanelTakeoverBtn').click();
    await expect(page.locator('.main')).toHaveClass(/cu-viewer-open/);
    await expect(page.locator('#cuViewerView')).toBeVisible();
    await expect(page.locator('#cuViewerModePill')).toHaveText('View only');
    await expect(page.locator('#cuSeatBadge')).toHaveText('Agent');
    await expect(page.locator('#cuTakeoverBtn')).toBeVisible();
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(0);
    await expect(page.locator('#cuViewerStage iframe.cu-viewer-frame')).toHaveCount(1);
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(1);
    expect(fx.takeoverCount).toBe(0);
    expect(fx.heartbeatCount).toBe(0);
    expect(fx.releaseCount).toBe(0);
    expect(fx.seatState).toBe('agent');

    // Take Over inside the standalone pane uses the slice-1 control flow and updates the sidebar cue.
    await page.locator('#cuTakeoverBtn').click();
    await expect(page.locator('#cuSeatBadge')).toHaveText('You have control');
    await expect(page.locator('#cuViewerModePill')).toHaveText('Interactive');
    await expect(page.locator('#cuHandBackBtn')).toBeVisible();
    expect(fx.takeoverCount).toBe(1);
    expect(fx.takeoverPayload).toEqual({ label: 'pi-dish', ttlSec: 600 });
    expect(fx.seatState).toBe('human');
    if (viewport.width >= 900) {
      await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: you');
    }

    // Hand Back inside the standalone pane returns the broker to agent.
    await page.locator('#cuHandBackBtn').click();
    await expect(page.locator('#cuSeatBadge')).toHaveText('Agent');
    await expect(page.locator('#cuViewerModePill')).toHaveText('View only');
    await expect(page.locator('#cuTakeoverBtn')).toBeVisible();
    await expect(page.locator('#cuHandBackBtn')).toBeHidden();
    expect(fx.releaseCount).toBe(1);
    expect(fx.releasePayload).toEqual({ leaseId: 'h1', leaseToken: 'tok-human-1', handBack: true });
    expect(fx.seatState).toBe('agent');
    if (viewport.width >= 900) {
      await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');
    }

    // Closing the standalone pane returns cleanly to the session view with no iframe.
    await page.locator('#cuViewerCloseBtn').click();
    await expect(page.locator('.main')).not.toHaveClass(/cu-viewer-open/);
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);

    // Re-expand panel (view-only), then collapse tears down its iframe with zero lease calls.
    await page.locator('#cuSessionPanelToggle').click();
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    await page.locator('#cuSessionPanelToggle').click();
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#cuSessionPanelBody')).toBeHidden();
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);

    // Switching to another CU session keeps it closed by default (sessionStorage is per session).
    if (viewport.width < 900) {
      await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    }
    await page.locator('#tabAll').click();
    await rowTwo.click();
    await expect(page.locator('#messages')).toContainText('sandbox two transcript');
    await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');

    // Open on session two, then switch to non-CU self session -> panel hides and iframe tears down cleanly.
    await page.locator('#cuSessionPanelToggle').click();
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    if (viewport.width < 900) {
      await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    }
    await fleet.row(fleet.self).click();
    await expect(page.locator('#messages')).toContainText('self root transcript');
    await expect(page.locator('#cuSessionPanel')).toBeHidden();
    await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);

    // Verify list cue disappears when broker transitions to idle via SSE.
    if (viewport.width < 900) {
      await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    }
    await page.evaluate(() => {
      const streams = Reflect.get(window, '__cuPanelStreams') as EventSource[];
      const open = [...streams].reverse().find(s => s.readyState === 1)!;
      open.dispatchEvent(new MessageEvent('seat_idle', {
        data: JSON.stringify({ state: 'idle', epoch: 9, lease: null, preempted: null }),
      }));
    });
    await expect(rowOne.locator('.cu-seat-cue')).toHaveCount(0);
    await expect(rowTwo.locator('.cu-seat-cue')).toHaveCount(0);

    expect(fx.takeoverCount).toBe(1);
    expect(fx.releaseCount).toBe(1);
    expect(fx.heartbeatCount).toBe(0);
    expect(fx.selfCuCalls).toBe(0);
    expect(fx.peerCuCalls).toBe(0);
  });
}

test('drops shared SSE when CU host collapses or filters out, tears down on panel collapse/switch, and retires on relay change', async ({ page, fleet }) => {
  await installTrackedCuEventSource(page);
  let activeRelayBase = RELAY_BASE;
  const fx = await setupCuSandboxFixture(page, fleet, { relayBase: () => activeRelayBase });
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.reload();
  await page.locator('#tabAll').click();

  const rowOne = page.locator(`.session-item[data-id="${ROOT}"][data-host="${RELAY_HOST_ID}"]`);
  const cuHostHeader = page.locator('.host-section-header').filter({ hasText: 'cu-sandbox' });
  await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).map(s => s.readyState))).toEqual([1]);

  // Collapsing the CU host section hides emitted rows -> shared SSE stream closes immediately.
  await cuHostHeader.click();
  await expect(rowOne).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).map(s => s.readyState))).toEqual([2]);

  // Expanding restores the stream and cue.
  await cuHostHeader.click();
  await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).map(s => s.readyState))).toEqual([2, 1]);

  // Open panel, filter CU rows out of sidebar -> panel keeps stream alive until collapse tears down both iframe and SSE.
  await rowOne.click();
  await page.locator('#cuSessionPanelToggle').click();
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
  await page.locator('#filterInput').fill('self root');
  await expect(rowOne).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).map(s => s.readyState))).toEqual([2, 1]);

  await page.locator('#cuSessionPanelToggle').click();
  await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).map(s => s.readyState))).toEqual([2, 2]);

  // Reopen panel while filtered, then switch to self -> tears down both iframe and SSE.
  await page.locator('#cuSessionPanelToggle').click();
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).map(s => s.readyState))).toEqual([2, 2, 1]);

  await fleet.row(fleet.self).click();
  await expect(page.locator('#messages')).toContainText('self root transcript');
  await expect(page.locator('#cuSessionPanel')).toBeHidden();
  await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).map(s => s.readyState))).toEqual([2, 2, 2]);

  // Clear filter, re-select rowOne (panel auto-restores open from sessionStorage), change relay base for same hostId -> panel retires cleanly with zero lease calls.
  await page.locator('#filterInput').fill('');
  await expect(rowOne).toBeVisible();
  await rowOne.click();
  await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);

  activeRelayBase = '/hosts/cu-sandbox-v2';
  await page.route(`${fleet.self.base}/hosts/cu-sandbox-v2/api/cu/status`, route => route.fulfill({
    json: { ok: true, state: 'idle', epoch: 1, lease: null, preempted: null },
  }));
  await page.evaluate(() => fixtureApp.features.hostDiscovery.loadFleet());

  await expect(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
  expect(fx.takeoverCount).toBe(0);
  expect(fx.heartbeatCount).toBe(0);
  expect(fx.releaseCount).toBe(0);
});

test('Astra round-2 probes cannot produce a human lease from the view-only panel, and reconnect restores stale cue & reissues discarded viewer ticket', async ({ page, fleet }) => {
  await installTrackedCuEventSource(page);
  let releaseStatusCode = 503;
  const statusGateControl: { release: ((res: { status?: number; json: Record<string, unknown> } | null) => void) | null } = { release: null };
  let statusGate: Promise<{ status?: number; json: Record<string, unknown> } | null> | null = null;
  const ticketGateControl: { release: (() => void) | null } = { release: null };
  let ticketGate: Promise<void> | null = null;

  const fx = await setupCuSandboxFixture(page, fleet, {
    releaseStatus: () => releaseStatusCode,
    holdStatus: () => statusGate,
    holdTicket: () => ticketGate,
  });
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.reload();
  await page.locator('#tabAll').click();

  const rowOne = page.locator(`.session-item[data-id="${ROOT}"][data-host="${RELAY_HOST_ID}"]`);
  const cuHostHeader = page.locator('.host-section-header').filter({ hasText: 'cu-sandbox' });
  await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');
  await rowOne.click();

  // Probe 1 (503 on release + Diff/File occlusion + collapse): view-only panel never calls takeover, heartbeat, or release.
  await page.locator('#cuSessionPanelToggle').click();
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
  await expect(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);

  await page.evaluate(() => void fixtureApp.features.fileViews.openDiff());
  await expect(page.locator('#cuSessionPanel')).toBeHidden();
  await page.evaluate(() => fixtureApp.features.fileViews.closeDiff());
  await expect(page.locator('#cuSessionPanel')).toBeVisible();

  await page.evaluate(() => void fixtureApp.features.fileViews.openFile('a.txt'));
  await expect(page.locator('#cuSessionPanel')).toBeHidden();
  await page.evaluate(() => fixtureApp.features.fileViews.closeFile());
  await expect(page.locator('#cuSessionPanel')).toBeVisible();

  await page.locator('#cuSessionPanelToggle').click();
  expect(fx.takeoverCount).toBe(0);
  expect(fx.heartbeatCount).toBe(0);
  expect(fx.releaseCount).toBe(0);
  expect(fx.seatState).toBe('agent');

  // Probe 2 (delayed status GET returning null/error) + Probe 3 (disconnect stale cue + reconnect epoch-0 hello + discarded viewer ticket reissue):
  // Hold the panel's view-only viewer ticket across a disconnect + reconnect so connGen bumps while it is in flight.
  releaseStatusCode = 200;
  ticketGate = new Promise<void>(resolve => { ticketGateControl.release = resolve; });
  await page.locator('#cuSessionPanelToggle').click();
  await expect.poll(() => fx.ticketCount).toBe(2);
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(0);

  // Also queue a delayed pre-restart status refresh (will resolve later with stale epoch 99).
  const statusCallsBefore = fx.statusCount;
  statusGate = new Promise(resolve => { statusGateControl.release = resolve; });
  await page.evaluate(() => { void fixtureApp.features.cuViewerController.refreshPanel(); });
  await expect.poll(() => fx.statusCount).toBe(statusCallsBefore + 1);

  // Disconnect SSE -> sidebar cue clears (stale/unknown), panel shows Connecting…, still zero Hand Back or lease calls.
  const streamsBefore = await page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).length);
  await page.evaluate(() => {
    const stream = (Reflect.get(window, '__cuPanelStreams') as EventSource[]).at(-1)!;
    stream.onerror?.(new Event('error'));
  });
  await expect(rowOne.locator('.cu-seat-cue')).toHaveCount(0);
  await expect(page.locator('#cuPanelSeatBadge')).toHaveText('Connecting…');
  await expect(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);

  // Release the old-connGen in-flight ticket while disconnected -> discarded cleanly without mounting stale iframe.
  ticketGate = null;
  ticketGateControl.release?.();
  await page.waitForTimeout(80);
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(0);

  // Wait for reconnect EventSource and deliver authoritative epoch-0 hello ->
  // (a) restores display state even with epoch 0 < prior epoch 4,
  // (b) reissues the discarded view-only viewer ticket automatically so the panel iframe mounts!
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__cuPanelStreams') as EventSource[]).length)).toBeGreaterThan(streamsBefore);
  fx.epoch = 0;
  fx.seatState = 'agent';
  await page.evaluate(() => {
    const stream = (Reflect.get(window, '__cuPanelStreams') as EventSource[]).at(-1)!;
    stream.dispatchEvent(new MessageEvent('hello', {
      data: JSON.stringify({
        state: 'agent',
        epoch: 0,
        lease: { leaseId: 'a-restarted', sessionId: 's', holderKind: 'agent', label: 'restarted-agent' },
        preempted: null,
      }),
    }));
  });
  await expect(page.locator('#cuPanelSeatBadge')).toHaveText('Agent');
  await expect(page.locator('#cuPanelSeatDetail')).toContainText('Agent: restarted-agent');
  await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
  expect(fx.ticketCount).toBeGreaterThanOrEqual(3);

  // Release delayed pre-restart status GET (epoch 99 / error) -> rejected by connGen without touching display or leases.
  statusGate = null;
  statusGateControl.release?.({
    status: 200,
    json: {
      ok: true,
      state: 'human',
      epoch: 99,
      lease: { leaseId: 'stale-human', holderKind: 'human', label: 'stale-pre-restart' },
      preempted: null,
    },
  });
  await page.waitForTimeout(80);
  await expect(page.locator('#cuPanelSeatBadge')).toHaveText('Agent');
  await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');

  // Probe 4 (host entry destroyed & recreated at same connGen = 1): collapse panel + host section, then expand again.
  await page.locator('#cuSessionPanelToggle').click();
  await cuHostHeader.click();
  await expect(rowOne).toHaveCount(0);
  await cuHostHeader.click();
  await expect(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: agent');
  await page.locator('#cuSessionPanelToggle').click();
  await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
  await expect(page.locator('#cuPanelModePill')).toHaveText('View only');
  await expect(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);

  // Across all four probes: zero takeover, heartbeat, or release requests from the session panel.
  expect(fx.takeoverCount).toBe(0);
  expect(fx.heartbeatCount).toBe(0);
  expect(fx.releaseCount).toBe(0);
  expect(fx.seatState).toBe('agent');
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
    await installTrackedCuEventSource(page);
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
    await expect(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
    await expect(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveAttribute('src', '/api/cu/spaces/viewer/#ticket=panel-skew-1');
    expect(errors).toEqual([]);
  });
});

export {};
