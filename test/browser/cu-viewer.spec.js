// Generated test/tool from test/browser/cu-viewer.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const PHONE_VIEWPORT = { width: 390, height: 844 };
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
fixtures_js_1.test.describe('computer-use desktop viewer at phone width (390x844)', () => {
    (0, fixtures_js_1.test)('withholds Desktop on unsupported direct cross-origin peers and works via same-origin hub relay without cut controls', async ({ page, fleet }) => {
        await page.setViewportSize(PHONE_VIEWPORT);
        const expiresAgent = new Date(Date.now() + 90_000).toISOString();
        const expiresHuman = new Date(Date.now() + 600_000).toISOString();
        let seatState = 'agent';
        let epoch = 4;
        let ticketCount = 0;
        let takeoverPayload = null;
        let releasePayload = null;
        // Cross-origin direct peer advertises computerUse, but has an absolute cross-origin URL + bearer token -> must NOT offer Desktop.
        await page.route(`${fleet.peer.base}/api/host`, async (route) => {
            if (route.request().method() === 'OPTIONS')
                return route.fulfill({ status: 204, headers: corsHeaders(fleet.self.base) });
            const response = await route.fetch();
            const json = (await response.json());
            const caps = json.capabilities || {};
            await fulfillPeerJson(route, fleet.self.base, { ...json, capabilities: { ...caps, computerUse: true } });
        });
        // Hub /api/hosts advertises a same-origin relayed CU sandbox (/hosts/cu-sandbox).
        await page.route(`${fleet.self.base}/api/hosts`, async (route) => {
            const response = await route.fetch();
            const json = (await response.json());
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
            json: { active: [{ id: fixtures_js_1.ROOT, name: 'sandbox-agent', cwd: '/work', isActive: true, host: RELAY_HOST_ID }], previous: [] },
        }));
        await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/${fixtures_js_1.ROOT}/messages*`, route => route.fulfill({
            json: { messages: [], total: 0, hasMore: false, nextBefore: null },
        }));
        await page.route(`${fleet.self.base}${RELAY_BASE}/api/sessions/${fixtures_js_1.ROOT}/stream*`, route => route.fulfill({
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
                    lease: { leaseId: 'a1', sessionId: fixtures_js_1.ROOT, holderKind: 'agent', label: 'omp-browsing', expiresAt: expiresAgent },
                    preempted: null,
                }
                : {
                    ok: true,
                    state: 'human',
                    epoch,
                    lease: { leaseId: 'h1', holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
                    preempted: { sessionId: fixtures_js_1.ROOT, label: 'omp-browsing' },
                },
        }));
        await page.route(`${fleet.self.base}${RELAY_BASE}/api/cu/stream*`, route => route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: `event: hello\ndata: ${JSON.stringify({
                state: seatState,
                epoch,
                lease: seatState === 'agent'
                    ? { leaseId: 'a1', sessionId: fixtures_js_1.ROOT, holderKind: 'agent', label: 'omp-browsing', expiresAt: expiresAgent }
                    : { leaseId: 'h1', holderKind: 'human', label: 'pi-dish', expiresAt: expiresHuman },
                preempted: seatState === 'human' ? { sessionId: fixtures_js_1.ROOT, label: 'omp-browsing' } : null,
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
            takeoverPayload = route.request().postDataJSON();
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
            releasePayload = route.request().postDataJSON();
            seatState = 'agent';
            epoch += 1;
            return route.fulfill({
                json: {
                    ok: true,
                    state: 'agent',
                    epoch,
                    lease: { leaseId: 'a1', sessionId: fixtures_js_1.ROOT, holderKind: 'agent', label: 'omp-browsing', expiresAt: expiresAgent },
                    handedBackTo: { sessionId: fixtures_js_1.ROOT, label: 'omp-browsing' },
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
        await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/fleet-open/);
        const sandboxCard = page.locator('.fleet-host').filter({ hasText: 'cu-sandbox' });
        const directPeerCard = page.locator('.fleet-host').filter({ hasText: 'peer' });
        const selfCard = page.locator('.fleet-host').filter({ hasText: 'this server' });
        await (0, fixtures_js_1.expect)(sandboxCard.locator('.fleet-cu-btn')).toBeVisible();
        await (0, fixtures_js_1.expect)(directPeerCard.locator('.fleet-cu-btn')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(selfCard.locator('.fleet-cu-btn')).toHaveCount(0);
        // Programmatic open on unsupported cross-origin peer is refused.
        await page.evaluate(hostId => fixtureApp.features.cuViewerController.open(hostId), fleet.peer.hostId);
        await (0, fixtures_js_1.expect)(page.locator('.main')).not.toHaveClass(/cu-viewer-open/);
        // Tap Desktop on same-origin relayed cu-sandbox -> opens pane in view-only mode.
        await sandboxCard.locator('.fleet-cu-btn').click();
        await (0, fixtures_js_1.expect)(page.locator('.main')).toHaveClass(/cu-viewer-open/);
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerView')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerModePill')).toHaveText('View only');
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('Agent');
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatDetail')).toContainText('Agent: omp-browsing');
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatDetail')).toContainText('left');
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /\/hosts\/cu-sandbox\/api\/cu\/spaces\/viewer\/#ticket=view-only-1/);
        // Cut controls must not exist in DOM.
        await (0, fixtures_js_1.expect)(page.locator('#cuDetachDriver')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(page.locator('#cuReleaseSeatBtn')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(page.locator('#cuForceTakeoverBtn')).toHaveCount(0);
        // Phone viewport has zero horizontal overflow.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        (0, fixtures_js_1.expect)(overflow).toBeLessThanOrEqual(0);
        // Take Over sends { label: 'pi-dish', ttlSec: 600 } with no force or detachDriver.
        await page.locator('#cuTakeoverBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('You have control');
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerModePill')).toHaveText('Interactive');
        await (0, fixtures_js_1.expect)(page.locator('#cuHandBackBtn')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuTakeoverBtn')).toBeHidden();
        await (0, fixtures_js_1.expect)(page.locator('#cuReleaseSeatBtn')).toHaveCount(0);
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /\/hosts\/cu-sandbox\/api\/cu\/spaces\/viewer\/#ticket=interactive-1/);
        (0, fixtures_js_1.expect)(takeoverPayload).toEqual({ label: 'pi-dish', ttlSec: 600 });
        // Hand Back ALWAYS sends handBack: true (even though preempted was null in takeover payload!).
        await page.locator('#cuHandBackBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('Agent');
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerModePill')).toHaveText('View only');
        await (0, fixtures_js_1.expect)(page.locator('#cuTakeoverBtn')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuHandBackBtn')).toBeHidden();
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /\/hosts\/cu-sandbox\/api\/cu\/spaces\/viewer\/#ticket=view-only-2/);
        (0, fixtures_js_1.expect)(releasePayload).toEqual({ leaseId: 'h1', leaseToken: 'tok-human-1', handBack: true });
    });
    (0, fixtures_js_1.test)('shows busy 409 without Force Take Over, ignores stale view-only tickets/older epochs after takeover, and remints SSE ticket on reconnect', async ({ page, fleet }) => {
        await page.setViewportSize(PHONE_VIEWPORT);
        const otherHumanExpiry = new Date(Date.now() + 15 * 60_000).toISOString();
        const ourHumanExpiry = new Date(Date.now() + 600_000).toISOString();
        await page.route(`${fleet.self.base}/api/host`, async (route) => {
            const response = await route.fetch();
            const json = (await response.json());
            const caps = json.capabilities || {};
            await route.fulfill({ json: { ...json, capabilities: { ...caps, computerUse: true } } });
        });
        await page.route(`${fleet.self.base}/api/hosts`, async (route) => {
            const response = await route.fetch();
            const json = (await response.json());
            await route.fulfill({
                json: {
                    hosts: json.hosts.map(host => host.self
                        ? { ...host, capabilities: { ...(host.capabilities || {}), computerUse: true } }
                        : host),
                },
            });
        });
        await page.addInitScript(() => {
            const NativeEventSource = window.EventSource;
            const urls = [];
            Reflect.set(window, '__cuStreamUrls', urls);
            Reflect.set(window, '__cuStreams', []);
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
                    Reflect.get(window, '__cuStreams').push(this);
                    queueMicrotask(() => {
                        if (this.readyState === 1)
                            this.onopen?.(new Event('open'));
                    });
                }
                close() { this.readyState = 2; }
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
        await page.reload();
        await page.getByRole('button', { name: 'Open session list' }).filter({ visible: true }).click();
        await page.locator('#tabAll').click();
        let statusCount = 0;
        let releaseDelayedViewTicket;
        const delayedViewTicketGate = new Promise(resolve => { releaseDelayedViewTicket = resolve; });
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
        await page.route(`${fleet.self.base}/api/cu/viewer/ticket`, async (route) => {
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
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('Human');
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatDetail')).toContainText('Human: ssh-viewer');
        // First Take Over gets 409 busy -> shows clear busy notice naming holder with NO Force Take Over button.
        await page.locator('#cuTakeoverBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerNotice')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerNotice')).toHaveAttribute('data-kind', 'busy');
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerNotice')).toContainText('Busy');
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerNotice')).toContainText('ssh-viewer');
        await (0, fixtures_js_1.expect)(page.locator('#cuForceTakeoverBtn')).toHaveCount(0);
        // Second Take Over succeeds at epoch 10 while the initial epoch-9 view-only ticket is STILL in flight!
        await page.locator('#cuTakeoverBtn').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('You have control');
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerModePill')).toHaveText('Interactive');
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=interactive-epoch-10/);
        // Now release the stale epoch-9 view-only ticket AND dispatch an older-epoch SSE event -> neither may undo interactive control!
        releaseDelayedViewTicket();
        await page.evaluate(() => {
            const streams = Reflect.get(window, '__cuStreams');
            const latest = streams.at(-1);
            latest.dispatchEvent(new MessageEvent('lease_changed', {
                data: JSON.stringify({ state: 'agent', epoch: 9, lease: { leaseId: 'old', holderKind: 'agent', label: 'stale' }, preempted: null }),
            }));
        });
        await page.waitForTimeout(100);
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('You have control');
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerModePill')).toHaveText('Interactive');
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=interactive-epoch-10/);
        // Remote newer epoch end (epoch 11) DOES revert to view-only.
        await page.evaluate(() => {
            const streams = Reflect.get(window, '__cuStreams');
            const latest = streams.at(-1);
            latest.dispatchEvent(new MessageEvent('seat_idle', {
                data: JSON.stringify({ state: 'idle', epoch: 11, lease: null, preempted: null }),
            }));
        });
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('Idle');
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerModePill')).toHaveText('View only');
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=fresh-view-2/);
        // Verify SSE reconnect closes the dead EventSource and remints a fresh stream ticket on every retry.
        await page.addScriptTag({ url: `${fleet.self.base}/browser.js` });
        const reminted = await page.evaluate(async () => {
            const container = document.createElement('div');
            container.className = 'main';
            document.body.appendChild(container);
            const factory = window.PiDishBrowser.createCuViewer;
            const openedUrls = [];
            let minted = 0;
            const created = [];
            const viewer = factory({
                root: container,
                request: () => Promise.resolve(new Response(JSON.stringify({ ok: true, state: 'idle', epoch: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })),
                hosts: () => [],
                host: () => null,
                currentSession: () => null,
                supports: () => true,
                dot: () => '',
                ticket: async () => `remint-ticket-${++minted}`,
                source: (url) => {
                    openedUrls.push(url);
                    const fake = {
                        url,
                        closed: false,
                        onerror: null,
                        onopen: null,
                        onmessage: null,
                        close() { this.closed = true; },
                        addEventListener() { },
                    };
                    created.push(fake);
                    return fake;
                },
                closeOtherViews: () => { },
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
            const before = Reflect.get(window, '__cuStreams').length;
            const liveFirst = Reflect.get(window, '__cuStreams').at(-1);
            liveFirst.onerror?.(new Event('error'));
            const liveClosedFirst = liveFirst.readyState === EventSource.CLOSED;
            await new Promise(resolve => setTimeout(resolve, 1200));
            const after = Reflect.get(window, '__cuStreams').length;
            return { before, after, liveClosedFirst, closedFirst, openedUrls };
        });
        (0, fixtures_js_1.expect)(reminted.liveClosedFirst).toBe(true);
        (0, fixtures_js_1.expect)(reminted.after).toBeGreaterThan(reminted.before);
        (0, fixtures_js_1.expect)(reminted.closedFirst).toBe(true);
        (0, fixtures_js_1.expect)(reminted.openedUrls.length).toBeGreaterThanOrEqual(2);
        (0, fixtures_js_1.expect)(reminted.openedUrls[0]).toContain('?ticket=remint-ticket-1');
        (0, fixtures_js_1.expect)(reminted.openedUrls[1]).toContain('?ticket=remint-ticket-2');
    });
});
fixtures_js_1.test.describe('HTML/JS version skew safety', () => {
    (0, fixtures_js_1.test)('new JS boots cleanly on older cached HTML missing #cuViewerView and #sessionDesktopChip', async ({ page, fleet }) => {
        await page.setViewportSize(PHONE_VIEWPORT);
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
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
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toBeVisible();
        (0, fixtures_js_1.expect)(errors).toEqual([]);
        // Dynamic session chip & viewer pane work even when absent from cached HTML.
        await fleet.row(fleet.self).click();
        await (0, fixtures_js_1.expect)(page.locator('#sessionDesktopChip')).toBeVisible();
        await page.locator('#sessionDesktopChip').click();
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerView')).toBeVisible();
        await (0, fixtures_js_1.expect)(page.locator('#cuSeatBadge')).toHaveText('Idle');
        await (0, fixtures_js_1.expect)(page.locator('iframe.cu-viewer-frame')).toHaveAttribute('src', /#ticket=skew-1/);
        (0, fixtures_js_1.expect)(errors).toEqual([]);
    });
    (0, fixtures_js_1.test)('new HTML stays hidden and emits zero unknown-action errors under older JS bindings', async ({ page, fleet }) => {
        void fleet;
        await page.setViewportSize(PHONE_VIEWPORT);
        const consoleErrors = [];
        page.on('console', msg => { if (msg.type() === 'error')
            consoleErrors.push(msg.text()); });
        await (0, fixtures_js_1.expect)(page.locator('#cuViewerView')).toBeHidden();
        await (0, fixtures_js_1.expect)(page.locator('#sessionDesktopChip')).toBeHidden();
        const cuActions = await page.evaluate(() => {
            const view = document.getElementById('cuViewerView');
            const chip = document.getElementById('sessionDesktopChip');
            const attrs = (el) => el ? [...el.attributes].map(a => a.name).filter(n => n.startsWith('data-app-')) : [];
            return [...attrs(view), ...attrs(chip)];
        });
        (0, fixtures_js_1.expect)(cuActions).toEqual([]);
        (0, fixtures_js_1.expect)(consoleErrors).toEqual([]);
    });
});
