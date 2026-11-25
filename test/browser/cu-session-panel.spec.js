// Generated test/tool from test/browser/cu-session-panel.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const FAKE_VIEWER_HTML = `<!doctype html><html><body style="margin:0;background:#00212b;color:#dbe5e6;font-family:monospace;padding:12px">
<div id="viewerHash"></div>
<script>document.getElementById('viewerHash').textContent = location.hash;</script>
</body></html>`;
const RELAY_HOST_ID = '00000000-0000-4000-8000-00000000c0de';
const RELAY_BASE = '/hosts/cu-sandbox';
function corsHeaders(origin) {
    return {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, content-type, x-pi-dish-private-unlock',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
}
function fulfillPeerJson(route, origin, json, status = 200) {
    if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: corsHeaders(origin) });
    }
    return route.fulfill({ status, headers: corsHeaders(origin), json });
}
async function installTrackedCuEventSource(page) {
    await page.addInitScript(() => {
        const NativeEventSource = window.EventSource;
        const streams = [];
        const urls = [];
        Reflect.set(window, '__cuPanelStreams', streams);
        Reflect.set(window, '__cuPanelStreamUrls', urls);
        class FakeCuEventSource extends EventTarget {
            url;
            readyState = 1;
            onmessage = null;
            onopen = null;
            onerror = null;
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSED = 2;
            CONNECTING = 0;
            OPEN = 1;
            CLOSED = 2;
            constructor(url) {
                super();
                this.url = url;
                urls.push(url);
                streams.push(this);
                queueMicrotask(() => {
                    if (this.readyState === 1)
                        this.onopen?.(new Event('open'));
                });
            }
            close() {
                this.readyState = 2;
            }
        }
        class TrackedEventSource extends NativeEventSource {
            constructor(url, init) {
                const text = String(url);
                if (text.includes('/api/cu/stream')) {
                    return new FakeCuEventSource(text);
                }
                super(url, init);
            }
        }
        window.EventSource = TrackedEventSource;
    });
}
async function setupCuSandboxFixture(page, fleet, opts = {}) {
    const expiresAgent = new Date(Date.now() + 90_000).toISOString();
    const expiresHuman = new Date(Date.now() + 600_000).toISOString();
    const state = {
        seatState: 'agent',
        agentLabel: fixtures_js_1.ROOT,
        waitingSessionIds: new Set(),
        epoch: 4,
        ticketCount: 0,
        statusCount: 0,
        takeoverCount: 0,
        releaseCount: 0,
        heartbeatCount: 0,
        takeoverPayload: null,
        releasePayload: null,
        selfCuCalls: 0,
        peerCuCalls: 0,
        expiresAgent,
        expiresHuman,
    };
    // Direct cross-origin peer claims computerUse, but lacks a supported transport -> must NEVER get panel, cue, or CU calls.
    await page.route(`${fleet.peer.base}/api/host`, async (route) => {
        if (route.request().method() === 'OPTIONS')
            return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
        const response = await route.fetch();
        const json = (await response.json());
        const caps = json.capabilities || {};
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
    await page.route(`${fleet.self.base}/api/hosts`, async (route) => {
        const response = await route.fetch();
        const json = (await response.json());
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
            {
                id: fixtures_js_1.ROOT,
                name: 'sandbox-one',
                cwd: '/work',
                isActive: true,
                host: RELAY_HOST_ID,
                lastActivity: Date.now(),
                ...(state.waitingSessionIds.has(fixtures_js_1.ROOT) ? { cuWaitingForDesktop: true } : {}),
            },
            {
                id: fixtures_js_1.CHILD,
                name: 'sandbox-two',
                cwd: '/work',
                isActive: true,
                host: RELAY_HOST_ID,
                lastActivity: Date.now() - 1000,
                ...(state.waitingSessionIds.has(fixtures_js_1.CHILD) ? { cuWaitingForDesktop: true } : {}),
            },
        ];
        const active = q ? allActive.filter(row => row.name.includes(q) || row.cwd.includes(q)) : allActive;
        return route.fulfill({ json: { active, previous: [] } });
    });
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/*/messages*`, route => {
        const url = route.request().url();
        const label = url.includes(fixtures_js_1.CHILD) ? 'sandbox two transcript' : 'sandbox one transcript';
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
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/status`, async (route) => {
        state.statusCount += 1;
        const held = opts.holdStatus?.();
        if (held) {
            const custom = await held;
            if (custom)
                return route.fulfill({ status: custom.status ?? 200, json: custom.json });
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
                    lease: { leaseId: 'a1', sessionId: state.agentLabel, holderKind: 'agent', label: state.agentLabel, expiresAt: expiresAgent },
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
                preempted: { sessionId: state.agentLabel, label: state.agentLabel },
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
    await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/viewer/ticket`, async (route) => {
        state.ticketCount += 1;
        const gate = opts.holdTicket?.();
        if (gate)
            await gate;
        const body = route.request().postDataJSON();
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
        state.takeoverPayload = route.request().postDataJSON();
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
                preempted: { sessionId: state.agentLabel, label: state.agentLabel },
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
        state.releasePayload = route.request().postDataJSON();
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
                lease: { leaseId: 'a1', sessionId: state.agentLabel, holderKind: 'agent', label: state.agentLabel, expiresAt: expiresAgent },
                handedBackTo: { sessionId: state.agentLabel, label: state.agentLabel },
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
]) {
    (0, fixtures_js_1.test)(`view-only session Desktop panel, Take Over handoff to standalone pane, Hand Back in pane, and list cue at ${label}`, async ({ page, fleet }) => {
        await installTrackedCuEventSource(page);
        const fx = await setupCuSandboxFixture(page, fleet);
        await page.setViewportSize(viewport);
        await page.reload();
        if (viewport.width < 900) {
            await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
        }
        await page.locator('#tabAll').click();
        const rowOne = page.locator(`.session-item[data-id="${fixtures_js_1.ROOT}"][data-host="${RELAY_HOST_ID}"]`);
        const rowTwo = page.locator(`.session-item[data-id="${fixtures_js_1.CHILD}"][data-host="${RELAY_HOST_ID}"]`);
        await (0, fixtures_js_1.expect)(rowOne).toBeVisible();
        await (0, fixtures_js_1.expect)(rowTwo).toBeVisible();
        // Per-session list cue appears on CU host rows ONLY, using a SINGLE shared SSE stream for the CU host:
        // lease.label === ROOT -> "agent: this session" on rowOne and "agent: other session" on rowTwo.
        await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: this session');
        await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveAttribute('data-owner', 'this');
        await (0, fixtures_js_1.expect)(rowTwo.locator('.cu-seat-cue')).toHaveText('agent: other session');
        await (0, fixtures_js_1.expect)(rowTwo.locator('.cu-seat-cue')).toHaveAttribute('data-owner', 'other');
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self).locator('.cu-seat-cue')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(fleet.row(fleet.peer).locator('.cu-seat-cue')).toHaveCount(0);
        const streamCountAfterList = await page.evaluate(() => Reflect.get(window, '__cuPanelStreams').length);
        (0, fixtures_js_1.expect)(streamCountAfterList).toBe(1);
        // Unsupported direct cross-origin peer never gets a session panel even when claiming computerUse.
        await fleet.row(fleet.peer).click();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('peer root transcript');
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toHaveCount(0);
        (0, fixtures_js_1.expect)(fx.peerCuCalls).toBe(0);
        (0, fixtures_js_1.expect)(fx.selfCuCalls).toBe(0);
        // Select CU host session -> panel appears CLOSED by default with per-session seat summary.
        if (viewport.width < 900) {
            await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
        }
        await rowOne.click();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('sandbox one transcript');
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelBody')).toBeHidden();
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelSummary')).toHaveText('agent: this session');
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
        // Open the session panel -> strictly view-only, zero Hand Back button, reuses the shared SSE stream.
        await page.locator('#cuSessionPanelToggle').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'true');
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelBody')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelModePill')).toHaveText('View only');
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatBadge')).toHaveText('agent: this session');
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatDetail')).toContainText(`Agent: ${fixtures_js_1.ROOT}`);
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatDetail')).toContainText('left');
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelTakeoverBtn')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveAttribute('src', `${RELAY_BASE}/api/cu/spaces/viewer/#ticket=view-only-1`);
        const streamCountAfterPanelOpen = await page.evaluate(() => Reflect.get(window, '__cuPanelStreams').length);
        (0, fixtures_js_1.expect)(streamCountAfterPanelOpen).toBe(1);
        (0, fixtures_js_1.expect)(fx.takeoverCount).toBe(0);
        (0, fixtures_js_1.expect)(fx.heartbeatCount).toBe(0);
        (0, fixtures_js_1.expect)(fx.releaseCount).toBe(0);
        // Verify layout geometry at each width and zero horizontal overflow.
        const layout = await page.evaluate(() => {
            const panel = document.getElementById('cuSessionPanel').getBoundingClientRect();
            const input = document.querySelector('.input-area').getBoundingClientRect();
            const messages = document.getElementById('messages').getBoundingClientRect();
            return {
                overflow: document.documentElement.scrollWidth - window.innerWidth,
                panelAboveInput: panel.bottom <= input.top + 2,
                panelBesideMessages: panel.left >= messages.right - 2,
            };
        });
        (0, fixtures_js_1.expect)(layout.overflow).toBeLessThanOrEqual(0);
        if (viewport.width < 900) {
            (0, fixtures_js_1.expect)(layout.panelAboveInput).toBe(true);
        }
        else {
            (0, fixtures_js_1.expect)(layout.panelBesideMessages).toBe(true);
        }
        // Open/closed state is remembered per session in sessionStorage across reload (still view-only).
        await page.reload();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('sandbox one transcript');
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'true');
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
        (0, fixtures_js_1.expect)(fx.takeoverCount).toBe(0);
        (0, fixtures_js_1.expect)(fx.heartbeatCount).toBe(0);
        (0, fixtures_js_1.expect)(fx.releaseCount).toBe(0);
        // Clicking "Take Over" inside the panel opens the standalone Desktop pane and NEVER calls takeover/heartbeat/release itself.
        await page.locator('#cuPanelTakeoverBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/cu-viewer-open/);
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerView')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerModePill')).toHaveText('View only');
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('Agent');
        await (0, fixtures_js_1.expect)(page.locator('#cuTakeoverBtn')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerStage iframe.cu-viewer-frame')).toHaveCount(1);
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveCount(1);
        (0, fixtures_js_1.expect)(fx.takeoverCount).toBe(0);
        (0, fixtures_js_1.expect)(fx.heartbeatCount).toBe(0);
        (0, fixtures_js_1.expect)(fx.releaseCount).toBe(0);
        (0, fixtures_js_1.expect)(fx.seatState).toBe('agent');
        // Take Over inside the standalone pane uses the slice-1 control flow and updates the sidebar cue.
        await page.locator('#cuTakeoverBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('You have control');
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerModePill')).toHaveText('Interactive');
        await (0, fixtures_js_1.expect)(page.locator('#cuHandBackBtn')).toBeVisible();
        (0, fixtures_js_1.expect)(fx.takeoverCount).toBe(1);
        (0, fixtures_js_1.expect)(fx.takeoverPayload).toEqual({ label: 'pi-dish', ttlSec: 600 });
        (0, fixtures_js_1.expect)(fx.seatState).toBe('human');
        if (viewport.width >= 900) {
            await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('desktop: you');
        }
        // Hand Back inside the standalone pane returns the broker to agent.
        await page.locator('#cuHandBackBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('Agent');
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerModePill')).toHaveText('View only');
        await (0, fixtures_js_1.expect)(page.locator('#cuTakeoverBtn')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuHandBackBtn')).toBeHidden();
        (0, fixtures_js_1.expect)(fx.releaseCount).toBe(1);
        (0, fixtures_js_1.expect)(fx.releasePayload).toEqual({ leaseId: 'h1', leaseToken: 'tok-human-1', handBack: true });
        (0, fixtures_js_1.expect)(fx.seatState).toBe('agent');
        if (viewport.width >= 900) {
            await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: this session');
            await (0, fixtures_js_1.expect)(rowTwo.locator('.cu-seat-cue')).toHaveText('agent: other session');
        }
        // Closing the standalone pane returns cleanly to the session view with no iframe.
        await page.locator('#cuViewerCloseBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/cu-viewer-open/);
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
        // Re-expand panel (view-only), then collapse tears down its iframe with zero lease calls.
        await page.locator('#cuSessionPanelToggle').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
        await page.locator('#cuSessionPanelToggle').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelBody')).toBeHidden();
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
        // Switching to another CU session keeps it closed by default (sessionStorage is per session).
        if (viewport.width < 900) {
            await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
        }
        await page.locator('#tabAll').click();
        await rowTwo.click();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('sandbox two transcript');
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelSummary')).toHaveText('agent: other session');
        // Open on session two -> shows "agent: other session", then switch to non-CU self session -> panel hides and iframe tears down cleanly.
        await page.locator('#cuSessionPanelToggle').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatBadge')).toHaveText('agent: other session');
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
        if (viewport.width < 900) {
            await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
        }
        await fleet.row(fleet.self).click();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toBeHidden();
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
        // Verify list cue disappears when broker transitions to idle via SSE.
        if (viewport.width < 900) {
            await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
        }
        await page.evaluate(() => {
            const streams = Reflect.get(window, '__cuPanelStreams');
            const open = [...streams].reverse().find(s => s.readyState === 1);
            open.dispatchEvent(new MessageEvent('seat_idle', {
                data: JSON.stringify({ state: 'idle', epoch: 9, lease: null, preempted: null }),
            }));
        });
        await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(rowTwo.locator('.cu-seat-cue')).toHaveCount(0);
        (0, fixtures_js_1.expect)(fx.takeoverCount).toBe(1);
        (0, fixtures_js_1.expect)(fx.releaseCount).toBe(1);
        (0, fixtures_js_1.expect)(fx.heartbeatCount).toBe(0);
        (0, fixtures_js_1.expect)(fx.selfCuCalls).toBe(0);
        (0, fixtures_js_1.expect)(fx.peerCuCalls).toBe(0);
    });
}
(0, fixtures_js_1.test)('drops shared SSE when CU host collapses or filters out, tears down on panel collapse/switch, and retires on relay change', async ({ page, fleet }) => {
    await installTrackedCuEventSource(page);
    let activeRelayBase = RELAY_BASE;
    const fx = await setupCuSandboxFixture(page, fleet, { relayBase: () => activeRelayBase });
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.reload();
    await page.locator('#tabAll').click();
    const rowOne = page.locator(`.session-item[data-id="${fixtures_js_1.ROOT}"][data-host="${RELAY_HOST_ID}"]`);
    const cuHostHeader = page.locator('.host-section-header').filter({ hasText: 'cu-sandbox' });
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: this session');
    await fixtures_js_1.expect.poll(() => page.evaluate(() => Reflect.get(window, '__cuPanelStreams').map(s => s.readyState))).toEqual([1]);
    // Collapsing the CU host section hides emitted rows -> shared SSE stream closes immediately.
    await cuHostHeader.click();
    await (0, fixtures_js_1.expect)(rowOne).toHaveCount(0);
    await fixtures_js_1.expect.poll(() => page.evaluate(() => Reflect.get(window, '__cuPanelStreams').map(s => s.readyState))).toEqual([2]);
    // Expanding restores the stream and cue.
    await cuHostHeader.click();
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: this session');
    await fixtures_js_1.expect.poll(() => page.evaluate(() => Reflect.get(window, '__cuPanelStreams').map(s => s.readyState))).toEqual([2, 1]);
    // Open panel, filter CU rows out of sidebar -> panel keeps stream alive until collapse tears down both iframe and SSE.
    await rowOne.click();
    await page.locator('#cuSessionPanelToggle').click();
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    await page.locator('#filterInput').fill('self root');
    await (0, fixtures_js_1.expect)(rowOne).toHaveCount(0);
    await fixtures_js_1.expect.poll(() => page.evaluate(() => Reflect.get(window, '__cuPanelStreams').map(s => s.readyState))).toEqual([2, 1]);
    await page.locator('#cuSessionPanelToggle').click();
    await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
    await fixtures_js_1.expect.poll(() => page.evaluate(() => Reflect.get(window, '__cuPanelStreams').map(s => s.readyState))).toEqual([2, 2]);
    // Reopen panel while filtered, then switch to self -> tears down both iframe and SSE.
    await page.locator('#cuSessionPanelToggle').click();
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    await fixtures_js_1.expect.poll(() => page.evaluate(() => Reflect.get(window, '__cuPanelStreams').map(s => s.readyState))).toEqual([2, 2, 1]);
    await fleet.row(fleet.self).click();
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
    await fixtures_js_1.expect.poll(() => page.evaluate(() => Reflect.get(window, '__cuPanelStreams').map(s => s.readyState))).toEqual([2, 2, 2]);
    // Clear filter, re-select rowOne (panel auto-restores open from sessionStorage), change relay base for same hostId -> panel retires cleanly with zero lease calls.
    await page.locator('#filterInput').fill('');
    await (0, fixtures_js_1.expect)(rowOne).toBeVisible();
    await rowOne.click();
    await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'true');
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    activeRelayBase = '/hosts/cu-sandbox-v2';
    await page.route(`${fleet.self.base}/hosts/cu-sandbox-v2/api/cu/status`, route => route.fulfill({
        json: { ok: true, state: 'idle', epoch: 1, lease: null, preempted: null },
    }));
    await page.evaluate(() => fixtureApp.features.hostDiscovery.loadFleet());
    await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
    await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveCount(0);
    (0, fixtures_js_1.expect)(fx.takeoverCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.heartbeatCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.releaseCount).toBe(0);
});
(0, fixtures_js_1.test)('Astra round-2 probes cannot produce a human lease from the view-only panel, and reconnect restores stale cue & reissues discarded viewer ticket', async ({ page, fleet }) => {
    await installTrackedCuEventSource(page);
    let releaseStatusCode = 503;
    const statusGateControl = { release: null };
    let statusGate = null;
    const ticketGateControl = { release: null };
    let ticketGate = null;
    const fx = await setupCuSandboxFixture(page, fleet, {
        releaseStatus: () => releaseStatusCode,
        holdStatus: () => statusGate,
        holdTicket: () => ticketGate,
    });
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.reload();
    await page.locator('#tabAll').click();
    const rowOne = page.locator(`.session-item[data-id="${fixtures_js_1.ROOT}"][data-host="${RELAY_HOST_ID}"]`);
    const cuHostHeader = page.locator('.host-section-header').filter({ hasText: 'cu-sandbox' });
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: this session');
    await rowOne.click();
    // Probe 1 (503 on release + Diff/File occlusion + collapse): view-only panel never calls takeover, heartbeat, or release.
    await page.locator('#cuSessionPanelToggle').click();
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
    await page.evaluate(() => void fixtureApp.features.fileViews.openDiff());
    await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toBeHidden();
    await page.evaluate(() => fixtureApp.features.fileViews.closeDiff());
    await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toBeVisible();
    await page.evaluate(() => void fixtureApp.features.fileViews.openFile('a.txt'));
    await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toBeHidden();
    await page.evaluate(() => fixtureApp.features.fileViews.closeFile());
    await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toBeVisible();
    await page.locator('#cuSessionPanelToggle').click();
    (0, fixtures_js_1.expect)(fx.takeoverCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.heartbeatCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.releaseCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.seatState).toBe('agent');
    // Probe 2 (delayed status GET returning null/error) + Probe 3 (disconnect stale cue + reconnect epoch-0 hello + discarded viewer ticket reissue):
    // Hold the panel's view-only viewer ticket across a disconnect + reconnect so connGen bumps while it is in flight.
    releaseStatusCode = 200;
    ticketGate = new Promise(resolve => { ticketGateControl.release = resolve; });
    await page.locator('#cuSessionPanelToggle').click();
    await fixtures_js_1.expect.poll(() => fx.ticketCount).toBe(2);
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(0);
    // Also queue a delayed pre-restart status refresh (will resolve later with stale epoch 99).
    const statusCallsBefore = fx.statusCount;
    statusGate = new Promise(resolve => { statusGateControl.release = resolve; });
    await page.evaluate(() => { void fixtureApp.features.cuViewerController.refreshPanel(); });
    await fixtures_js_1.expect.poll(() => fx.statusCount).toBe(statusCallsBefore + 1);
    // Disconnect SSE -> sidebar cue clears (stale/unknown), panel shows Connecting…, still zero Hand Back or lease calls.
    const streamsBefore = await page.evaluate(() => Reflect.get(window, '__cuPanelStreams').length);
    await page.evaluate(() => {
        const stream = Reflect.get(window, '__cuPanelStreams').at(-1);
        stream.onerror?.(new Event('error'));
    });
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatBadge')).toHaveText('Connecting…');
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
    // Release the old-connGen in-flight ticket while disconnected -> discarded cleanly without mounting stale iframe.
    ticketGate = null;
    ticketGateControl.release?.();
    await page.waitForTimeout(80);
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(0);
    // Wait for reconnect EventSource and deliver authoritative epoch-0 hello ->
    // (a) restores display state even with epoch 0 < prior epoch 4,
    // (b) reissues the discarded view-only viewer ticket automatically so the panel iframe mounts!
    await fixtures_js_1.expect.poll(() => page.evaluate(() => Reflect.get(window, '__cuPanelStreams').length)).toBeGreaterThan(streamsBefore);
    fx.epoch = 0;
    fx.seatState = 'agent';
    await page.evaluate(() => {
        const stream = Reflect.get(window, '__cuPanelStreams').at(-1);
        stream.dispatchEvent(new MessageEvent('hello', {
            data: JSON.stringify({
                state: 'agent',
                epoch: 0,
                lease: { leaseId: 'a-restarted', sessionId: 's', holderKind: 'agent', label: 'restarted-agent' },
                preempted: null,
            }),
        }));
    });
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatBadge')).toHaveText('agent: other session');
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatDetail')).toContainText('Agent: restarted-agent');
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: other session');
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    (0, fixtures_js_1.expect)(fx.ticketCount).toBeGreaterThanOrEqual(3);
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
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatBadge')).toHaveText('agent: other session');
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: other session');
    // Probe 4 (host entry destroyed & recreated at same connGen = 1): collapse panel + host section, then expand again.
    await page.locator('#cuSessionPanelToggle').click();
    await cuHostHeader.click();
    await (0, fixtures_js_1.expect)(rowOne).toHaveCount(0);
    await cuHostHeader.click();
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: this session');
    await page.locator('#cuSessionPanelToggle').click();
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelModePill')).toHaveText('View only');
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
    // Across all four probes: zero takeover, heartbeat, or release requests from the session panel.
    (0, fixtures_js_1.expect)(fx.takeoverCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.heartbeatCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.releaseCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.seatState).toBe('agent');
});
(0, fixtures_js_1.test)('per-session lease switch via SSE and waiting-for-desktop state render accurately at phone 390x844', async ({ page, fleet }) => {
    await installTrackedCuEventSource(page);
    const fx = await setupCuSandboxFixture(page, fleet);
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.reload();
    await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await page.locator('#tabAll').click();
    const rowOne = page.locator(`.session-item[data-id="${fixtures_js_1.ROOT}"][data-host="${RELAY_HOST_ID}"]`);
    const rowTwo = page.locator(`.session-item[data-id="${fixtures_js_1.CHILD}"][data-host="${RELAY_HOST_ID}"]`);
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: this session');
    await (0, fixtures_js_1.expect)(rowTwo.locator('.cu-seat-cue')).toHaveText('agent: other session');
    // Live SSE lease transfer from ROOT to CHILD updates both sidebar rows via exact matching.
    await page.evaluate((childId) => {
        const streams = Reflect.get(window, '__cuPanelStreams');
        const open = [...streams].reverse().find(s => s.readyState === 1);
        open.dispatchEvent(new MessageEvent('lease_changed', {
            data: JSON.stringify({
                state: 'agent',
                epoch: 5,
                lease: { leaseId: 'a2', sessionId: childId, holderKind: 'agent', label: childId },
                preempted: null,
            }),
        }));
    }, fixtures_js_1.CHILD);
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: other session');
    await (0, fixtures_js_1.expect)(rowTwo.locator('.cu-seat-cue')).toHaveText('agent: this session');
    // Prefix near-miss never counts as this session (matching is exact).
    await page.evaluate((childId) => {
        const streams = Reflect.get(window, '__cuPanelStreams');
        const open = [...streams].reverse().find(s => s.readyState === 1);
        open.dispatchEvent(new MessageEvent('lease_changed', {
            data: JSON.stringify({
                state: 'agent',
                epoch: 6,
                lease: { leaseId: 'a3', sessionId: `${childId}-x`, holderKind: 'agent', label: `${childId}-x` },
                preempted: null,
            }),
        }));
    }, fixtures_js_1.CHILD);
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('agent: other session');
    await (0, fixtures_js_1.expect)(rowTwo.locator('.cu-seat-cue')).toHaveText('agent: other session');
    // Human-held spawn waiting for desktop: rowOne has cuWaitingForDesktop=true while broker is in human state.
    fx.seatState = 'human';
    fx.epoch = 7;
    fx.waitingSessionIds.add(fixtures_js_1.ROOT);
    await page.reload();
    await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
    await page.locator('#tabAll').click();
    await (0, fixtures_js_1.expect)(rowOne.locator('.cu-seat-cue')).toHaveText('waiting for desktop');
    await (0, fixtures_js_1.expect)(rowTwo.locator('.cu-seat-cue')).toHaveText('desktop: human');
    await rowOne.click();
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelSummary')).toHaveText('waiting for desktop');
    await page.locator('#cuSessionPanelToggle').click();
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatBadge')).toHaveText('waiting for desktop');
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatDetail')).toContainText('Held by human');
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelModePill')).toHaveText('View only');
    await (0, fixtures_js_1.expect)(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    (0, fixtures_js_1.expect)(overflow).toBeLessThanOrEqual(0);
    (0, fixtures_js_1.expect)(fx.takeoverCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.heartbeatCount).toBe(0);
    (0, fixtures_js_1.expect)(fx.releaseCount).toBe(0);
});
fixtures_js_1.test.describe('session Desktop panel version skew', () => {
    (0, fixtures_js_1.test)('new JS against old peers without computerUse shows no panel or cue and makes zero /api/cu requests', async ({ page, fleet }) => {
        let cuRequests = 0;
        await page.route('**/api/cu/**', route => {
            cuRequests += 1;
            return route.fulfill({ status: 404, json: { error: 'unsupported' } });
        });
        await page.setViewportSize(PHONE_VIEWPORT);
        await page.reload();
        await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
        await page.locator('#tabAll').click();
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toBeVisible();
        await (0, fixtures_js_1.expect)(fleet.row(fleet.peer)).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('.cu-seat-cue')).toHaveCount(0);
        await fleet.row(fleet.peer).click();
        await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('peer root transcript');
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(page.locator('#sessionDesktopChip')).toBeHidden();
        (0, fixtures_js_1.expect)(cuRequests).toBe(0);
    });
    (0, fixtures_js_1.test)('new JS creates #cuSessionPanel dynamically on older cached HTML, while static HTML carries no panel markup for older JS', async ({ page, fleet }) => {
        await installTrackedCuEventSource(page);
        await page.setViewportSize(PHONE_VIEWPORT);
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        // Verify served static HTML has zero #cuSessionPanel markup (old JS sees unchanged HTML).
        const rawHtml = await (await fetch(`${fleet.self.base}/`)).text();
        (0, fixtures_js_1.expect)(rawHtml).not.toContain('cuSessionPanel');
        (0, fixtures_js_1.expect)(rawHtml).not.toContain('cu-session-panel');
        await page.route(`${fleet.self.base}/`, async (route) => {
            const response = await route.fetch();
            const html = (await response.text())
                .replace(/<div class="cu-viewer-view" id="cuViewerView"[^>]*><\/div>/, '')
                .replace(/<button[^>]*id="sessionDesktopChip"[^>]*>.*?<\/button>/, '');
            await route.fulfill({ response, body: html });
        });
        await page.route(`${fleet.self.base}/api/host`, async (route) => {
            const response = await route.fetch();
            const json = (await response.json());
            const caps = json.capabilities || {};
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
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanel')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuSessionPanelToggle')).toHaveAttribute('aria-expanded', 'false');
        await page.locator('#cuSessionPanelToggle').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelSeatBadge')).toHaveText('Idle');
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelHandBackBtn')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(page.locator('#cuPanelStage iframe.cu-viewer-frame')).toHaveAttribute('src', '/api/cu/spaces/viewer/#ticket=panel-skew-1');
        (0, fixtures_js_1.expect)(errors).toEqual([]);
    });
});
