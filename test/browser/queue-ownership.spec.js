// Generated test/tool from test/browser/queue-ownership.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
fixtures_js_1.test.use({ liveSessions: true });
(0, fixtures_js_1.test)('identical queued prompts retain their own bubbles and cancellation owner', async ({ page, fleet }) => {
    const ids = {};
    for (const host of [fleet.self, fleet.peer]) {
        await fleet.select(host);
        await page.route(`${host.base}/api/sessions/${fixtures_js_1.ROOT}/prompt`, route => route.fulfill({ json: { result: { queued: true } } }));
        await page.locator('#promptInput').fill('identical queued message');
        await page.evaluate(() => fixtureApp.features.composerSubmit.sendPrompt());
        const id = await page.locator('#messages [data-client-prompt-id]').last().getAttribute('data-client-prompt-id');
        if (id === null)
            throw new Error(`Missing queued prompt id for ${host.label}`);
        ids[host.label] = id;
        await page.waitForFunction(() => fixtureApp.features.messageStreamController.source?.readyState === 1);
        host.emit('queue_update', { followUp: ['identical queued message'] });
        await (0, fixtures_js_1.expect)(page.locator('.queue-item')).toHaveAttribute('data-client-prompt-id', id);
    }
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/queue/cancel`, route => {
        if (!receive)
            throw new Error('Queue-cancel route resolver not initialized');
        receive(route);
    });
    await page.evaluate(() => { window.editRequest = fixtureApp.features.promptDelivery.edit(fixtureElement(document.querySelector('.queue-item-edit'), '.queue-item-edit')); });
    const route = await received;
    await fleet.select(fleet.self);
    await page.locator('#promptInput').fill('self work');
    await route.fulfill({ json: { success: true } });
    await page.evaluate(() => window.editRequest);
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('self work');
    (0, fixtures_js_1.expect)(await page.evaluate(ids => [fixtureApp.features.promptDelivery.has(fixtureElement(ids.self, 'self prompt id')), fixtureApp.features.promptDelivery.has(fixtureElement(ids.peer, 'peer prompt id'))], ids)).toEqual([true, false]);
    await fleet.select(fleet.peer);
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('identical queued message');
});
(0, fixtures_js_1.test)('a peer echo cannot consume the selected host-independent pending prompt', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/prompt`, route => route.fulfill({ json: { result: { queued: true } } }));
    await page.locator('#promptInput').fill('shared echo text');
    await page.evaluate(() => fixtureApp.features.composerSubmit.sendPrompt());
    const id = await page.locator('#messages [data-client-prompt-id]').last().getAttribute('data-client-prompt-id');
    if (id === null)
        throw new Error('Missing pending prompt id');
    await fleet.select(fleet.peer);
    await page.waitForFunction(() => fixtureApp.features.messageStreamController.source?.readyState === 1);
    fleet.peer.emit('message_end', { message: { role: 'user', content: 'shared echo text' } });
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('shared echo text');
    (0, fixtures_js_1.expect)(await page.evaluate(id => fixtureApp.features.promptDelivery.has(id), id)).toBe(true);
});
(0, fixtures_js_1.test)('stopping one host does not block stopping its same-id peer', async ({ page, fleet }) => {
    let receive;
    const received = new Promise(resolve => { receive = resolve; });
    await fleet.select(fleet.self);
    await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/abort`, route => {
        if (!receive)
            throw new Error('Abort route resolver not initialized');
        receive(route);
    });
    await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); window.selfAbort = fixtureApp.features.composerSubmit.abortTurn(); });
    const pending = await received;
    await fleet.select(fleet.peer);
    const endpoint = `${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/abort`;
    await page.route(endpoint, route => route.fulfill({ json: { success: true } }));
    const sent = page.waitForRequest(endpoint);
    await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); return fixtureApp.features.composerSubmit.abortTurn(); });
    await sent;
    await pending.fulfill({ json: { success: true } });
    await page.evaluate(() => window.selfAbort);
});
