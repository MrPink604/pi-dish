// Generated test/tool from test/browser/selection-ownership.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('related-session navigation stays on its host when both target ids collide', async ({ page, fleet }) => {
    await fleet.select(fleet.peer, fixtures_js_1.CHILD);
    const link = page.locator('#sessionRelations .session-relation-chip');
    await (0, fixtures_js_1.expect)(link).toBeVisible();
    await link.click();
    await page.locator(`.lineage-row[data-session-id="${fixtures_js_1.ROOT}"]`).click();
    await page.locator('#subagentsOpenBtn').click();
    await (0, fixtures_js_1.expect)(fleet.row(fleet.peer, fixtures_js_1.ROOT)).toHaveClass(/\bactive\b/);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('peer root transcript');
    await (0, fixtures_js_1.expect)(fleet.row(fleet.self, fixtures_js_1.ROOT)).not.toHaveClass(/\bactive\b/);
});
fixtures_js_1.test.describe('live selection ownership', () => {
    fixtures_js_1.test.use({ liveSessions: true });
    (0, fixtures_js_1.test)('stale transcript and stream entrypoints leave the current host and connection untouched', async ({ page, fleet }) => {
        await fleet.select(fleet.peer);
        await page.evaluate(() => { window.staleSelection = fixtureApp.features.sessionState.captureSelection(); });
        await fleet.select(fleet.self);
        await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureApp.features.messageStreamController.source?.readyState)).toBe(1);
        const result = await page.evaluate(async () => {
            const stream = fixtureApp.features.messageStreamController.source;
            const before = fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").innerHTML;
            const fetch = fixtureApp.features.apiTransport.request;
            let requests = 0;
            fixtureApp.features.apiTransport.request = (...args) => { requests += 1; return fetch(...args); };
            try {
                await fixtureApp.features.transcriptController.load(window.staleSelection);
                await fixtureApp.features.transcriptController.catchup(window.staleSelection);
                await fixtureApp.features.sessionRelationsController.load(window.staleSelection);
                fixtureApp.features.messageStreamController.start(window.staleSelection);
                return { unchanged: before === fixtureElement(document.getElementById('messages'), "document.getElementById('messages')").innerHTML,
                    sameStream: stream === fixtureApp.features.messageStreamController.source, host: fixtureCurrentSession().host, requests };
            }
            finally {
                fixtureApp.features.apiTransport.request = fetch;
            }
        });
        (0, fixtures_js_1.expect)(result).toEqual({ unchanged: true, sameStream: true, host: fleet.self.hostId, requests: 0 });
    });
    (0, fixtures_js_1.test)('a delayed stream ticket cannot replace a newer host connection', async ({ page, fleet }) => {
        let receive;
        const received = new Promise(resolve => { receive = resolve; });
        await page.evaluate(() => {
            const mint = fixtureApp.ports.messageStreamController.ticket;
            fixtureApp.ports.messageStreamController.ticket = host => {
                const pending = mint(host);
                window.pendingStreamTicket = pending;
                return pending;
            };
        });
        await page.route(`${fleet.peer.base}/api/auth/ticket`, route => {
            if (!receive)
                throw new Error('Stream-ticket resolver not initialized');
            receive(route);
        });
        await fleet.select(fleet.peer);
        const ticket = await received;
        await fleet.select(fleet.self);
        await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureApp.features.messageStreamController.source?.readyState)).toBe(1);
        const before = await page.evaluate(() => fixtureElement(fixtureApp.features.messageStreamController.source, 'active message stream').url);
        await ticket.fulfill({ json: { ticket: 'superseded-fixture-ticket' } });
        await page.evaluate(() => window.pendingStreamTicket);
        (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureElement(fixtureApp.features.messageStreamController.source, 'active message stream').url)).toBe(before);
        (0, fixtures_js_1.expect)(before).toContain(fleet.self.base);
        await (0, fixtures_js_1.expect)(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
    });
});
