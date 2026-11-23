// Generated test/tool from test/browser/reachability.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const OFFLINE = "Can't reach server. Tap to reload.";
const SIGN_IN = 'Sign-in expired. Tap to sign in again.';
fixtures_js_1.test.use({ instrumentApp: false });
(0, fixtures_js_1.test)('an initial auth redirect blocks the app until the origin recovers', async ({ page, fleet }) => {
    const sessions = `${fleet.self.base}/api/sessions?*`;
    const descriptor = `${fleet.self.base}/api/host`;
    const login = `${fleet.peer.base}/access-login`;
    const overlay = page.locator('#reachabilitySignIn');
    let followedLogin = false;
    page.on('request', request => { if (request.url() === login)
        followedLogin = true; });
    await page.setViewportSize({ width: 390, height: 720 });
    await page.route(descriptor, route => route.fulfill({ status: 302, headers: { location: login } }));
    await page.route(sessions, route => route.fulfill({ status: 302, headers: { location: login } }));
    await page.clock.install();
    await page.reload();
    await (0, fixtures_js_1.expect)(overlay).toBeVisible();
    await (0, fixtures_js_1.expect)(overlay).toHaveText(SIGN_IN);
    await (0, fixtures_js_1.expect)(overlay).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await (0, fixtures_js_1.expect)(overlay).toBeVisible();
    (0, fixtures_js_1.expect)(await overlay.evaluate(dialog => dialog.matches(':modal'))).toBe(true);
    await (0, fixtures_js_1.expect)(page.locator('#sessionList .empty-session')).toHaveText('Couldn’t load sessions. Retrying…');
    (0, fixtures_js_1.expect)(followedLogin).toBe(false);
    await page.unroute(sessions);
    await page.unroute(descriptor);
    await page.clock.runFor(11_000);
    await (0, fixtures_js_1.expect)(overlay).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#sessionList .empty-session')).toContainText('No active sessions');
    await page.getByRole('button', { name: 'Open session list' }).click();
    await page.locator('#tabAll').click();
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toBeVisible();
});
for (const kind of ['abort', 'html502']) {
    (0, fixtures_js_1.test)(`an initial ${kind} failure shows the non-blocking banner, not the sign-in modal`, async ({ page, fleet }) => {
        const sessions = `${fleet.self.base}/api/sessions?*`;
        const banner = page.locator('#reachabilityBanner');
        const overlay = page.locator('#reachabilitySignIn');
        await page.route(sessions, route => kind === 'abort'
            ? route.abort('failed')
            : route.fulfill({ status: 502, contentType: 'text/html; charset=utf-8', body: '<html><body>502 Bad Gateway</body></html>' }));
        await page.clock.install();
        await page.reload();
        await (0, fixtures_js_1.expect)(banner).toHaveText(OFFLINE);
        await (0, fixtures_js_1.expect)(overlay).toBeHidden();
        await page.unroute(sessions);
        await page.clock.runFor(11_000);
        await (0, fixtures_js_1.expect)(banner).toBeHidden();
        await (0, fixtures_js_1.expect)(overlay).toBeHidden();
        await (0, fixtures_js_1.expect)(page.locator('#sessionList .empty-session')).toContainText('No active sessions');
    });
}
(0, fixtures_js_1.test)('sign-in starts a top-level navigation and preserves the current URL', async ({ page, fleet }) => {
    const sessions = `${fleet.self.base}/api/sessions?*`;
    const url = `${fleet.self.base}/?source=pwa#retained`;
    await page.route(sessions, route => route.fulfill({ status: 401, json: { error: 'Signed out' } }));
    await page.goto(url);
    await (0, fixtures_js_1.expect)(page.locator('#reachabilitySignIn')).toHaveText(SIGN_IN);
    await page.unroute(sessions);
    await Promise.all([
        page.waitForRequest(request => request.isNavigationRequest() && new URL(request.url()).search === '?source=pwa'),
        page.getByRole('button', { name: 'Tap to sign in again.' }).click(),
    ]);
    await (0, fixtures_js_1.expect)(page).toHaveURL(url);
    await (0, fixtures_js_1.expect)(page.locator('#reachabilitySignIn')).toBeHidden();
});
(0, fixtures_js_1.test)('polling ignores a single blip, backs off after repeated failures, and the banner reloads the document', async ({ page, fleet }) => {
    const sessions = `${fleet.self.base}/api/sessions?*`;
    const banner = page.locator('#reachabilityBanner');
    await page.clock.install();
    await Promise.all([
        page.waitForResponse(response => response.url().startsWith(`${fleet.self.base}/api/sessions?`) && response.ok()),
        page.reload(),
    ]);
    await (0, fixtures_js_1.expect)(page.locator('#sessionList .empty-session')).toContainText('No active sessions');
    let calls = 0;
    await page.route(sessions, route => {
        calls++;
        return route.fulfill({ status: 502, json: { error: 'Bad Gateway' } });
    });
    await page.clock.fastForward(11_000);
    await (0, fixtures_js_1.expect)(page.locator('#sessionList .empty-session')).toHaveText('Couldn’t load sessions. Retrying…');
    await (0, fixtures_js_1.expect)(banner).toBeHidden();
    await page.clock.fastForward(11_000);
    await (0, fixtures_js_1.expect)(banner).toHaveText(OFFLINE);
    await page.clock.fastForward(11_000);
    await fixtures_js_1.expect.poll(() => calls).toBe(3);
    await page.clock.fastForward(11_000);
    (0, fixtures_js_1.expect)(calls).toBe(3);
    await page.unroute(sessions);
    await Promise.all([
        page.waitForRequest(request => request.isNavigationRequest() && request.url() === `${fleet.self.base}/`),
        banner.click(),
    ]);
    await (0, fixtures_js_1.expect)(page.locator('#sessionList .empty-session')).toContainText('No active sessions');
    await (0, fixtures_js_1.expect)(banner).toBeHidden();
});
(0, fixtures_js_1.test)('failed self identity shows a reachability note in Fleet, then recovers capacity', async ({ page, fleet }) => {
    const descriptor = `${fleet.self.base}/api/host`;
    const overlay = page.locator('#reachabilitySignIn');
    const banner = page.locator('#reachabilityBanner');
    const self = page.locator('#fleetHosts .fleet-host').filter({ hasText: 'this server' });
    const pending = (0, fixtures_js_1.heldRoute)();
    await page.route(descriptor, pending.hold);
    await page.clock.install();
    await page.reload();
    const request = await pending.received;
    await page.locator('#btnFleet').click();
    await request.abort('failed');
    await (0, fixtures_js_1.expect)(banner).toHaveText(OFFLINE);
    await (0, fixtures_js_1.expect)(overlay).toBeHidden();
    await (0, fixtures_js_1.expect)(self).toContainText("Can't reach host. Reload to try again.");
    await (0, fixtures_js_1.expect)(self).not.toContainText('Update pi-dish');
    await page.unroute(descriptor);
    await page.clock.runFor(11_000);
    await (0, fixtures_js_1.expect)(self.getByRole('meter', { name: 'CPU' })).toBeVisible();
    await (0, fixtures_js_1.expect)(banner).toBeHidden();
    await (0, fixtures_js_1.expect)(overlay).toBeHidden();
});
(0, fixtures_js_1.test)('opening a listed session surfaces a login redirect and reloads the transcript after recovery', async ({ page, fleet }) => {
    const messages = `${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/messages?*`;
    const overlay = page.locator('#reachabilitySignIn');
    await page.clock.install();
    await page.route(messages, route => route.fulfill({ status: 302, headers: { location: `${fleet.peer.base}/access-login` } }));
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.expect)(overlay).toHaveText(SIGN_IN);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('Couldn’t load messages. Retrying…');
    await page.unroute(messages);
    await page.clock.runFor(3100);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    await (0, fixtures_js_1.expect)(overlay).toBeHidden();
});
fixtures_js_1.test.describe('live sessions', () => {
    fixtures_js_1.test.use({ liveSessions: true });
    (0, fixtures_js_1.test)('a failing self stream does not show sign-in when /api/host is healthy, and shows sign-in when /api/host redirects', async ({ page, fleet }) => {
        const stream = `${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/stream`;
        const descriptor = `${fleet.self.base}/api/host`;
        const overlay = page.locator('#reachabilitySignIn');
        const banner = page.locator('#reachabilityBanner');
        await page.clock.install();
        await page.route(stream, route => route.abort('failed'));
        await fleet.select(fleet.self);
        await (0, fixtures_js_1.expect)(page.locator('#status')).toHaveText('Stream disconnected');
        await (0, fixtures_js_1.expect)(overlay).toBeHidden();
        // Second stream failure probes /api/host; with auth intact, no modal or banner appears.
        await page.clock.runFor(3100);
        await (0, fixtures_js_1.expect)(overlay).toBeHidden();
        await (0, fixtures_js_1.expect)(banner).toBeHidden();
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toBeVisible();
        // When /api/host actually redirects to sign-in, the next stream failure surfaces the modal.
        await page.route(descriptor, route => route.fulfill({ status: 302, headers: { location: `${fleet.peer.base}/access-login` } }));
        await page.clock.runFor(6100);
        await (0, fixtures_js_1.expect)(overlay).toHaveText(SIGN_IN);
        await page.unroute(descriptor);
        await page.unroute(stream);
        await page.clock.runFor(12_100);
        await (0, fixtures_js_1.expect)(overlay).toBeHidden();
    });
    (0, fixtures_js_1.test)('a failing self WebSocket probes /api/host before showing sign-in and clears on reconnect', async ({ page, fleet }) => {
        const descriptor = `${fleet.self.base}/api/host`;
        const overlay = page.locator('#reachabilitySignIn');
        let authLost = false;
        await page.route(descriptor, route => authLost
            ? route.fulfill({ status: 302, headers: { location: `${fleet.peer.base}/access-login` } })
            : route.fulfill({ json: { hostId: fleet.self.hostId, label: fleet.self.label, capabilities: { terminal: true } } }));
        let attempts = 0;
        await page.routeWebSocket(`${fleet.self.base.replace(/^http/, 'ws')}/api/sessions/${fixtures_js_1.ROOT}/terminal`, socket => {
            if (++attempts <= 3)
                void socket.close({ code: 1011 });
            else
                socket.send(JSON.stringify({ type: 'attach', replay: 'terminal recovered' }));
        });
        await page.clock.install();
        await page.reload();
        await fleet.select(fleet.self);
        await page.locator('#btnTerminal').click();
        await (0, fixtures_js_1.expect)(page.locator('#terminalStatus')).toContainText('disconnected');
        await (0, fixtures_js_1.expect)(overlay).toBeHidden();
        // 2nd close with healthy /api/host does not flash the sign-in modal.
        await page.clock.runFor(1100);
        await fixtures_js_1.expect.poll(() => attempts).toBe(2);
        await (0, fixtures_js_1.expect)(overlay).toBeHidden();
        // 3rd close with /api/host redirecting to login opens the sign-in modal.
        authLost = true;
        await page.clock.runFor(2100);
        await (0, fixtures_js_1.expect)(overlay).toHaveText(SIGN_IN);
        // Recovery clears it.
        authLost = false;
        await page.clock.runFor(4100);
        await fixtures_js_1.expect.poll(() => attempts).toBe(4);
        await (0, fixtures_js_1.expect)(overlay).toBeHidden();
    });
});
