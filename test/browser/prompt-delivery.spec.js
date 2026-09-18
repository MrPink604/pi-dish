// Generated test/tool from test/browser/prompt-delivery.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('queue decoder ignores malformed rows and displays valid text literally', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => window.fixtureSessionListPatch(fixtureCurrentSession().id, { capabilities: { queueCancel: true } }));
    await page.evaluate(() => fixtureApp.features.promptDelivery.render({ steering: [null, {}, '<img src=x onerror=alert(1)>'], followUp: 'bad' }));
    await (0, fixtures_js_1.expect)(page.locator('.queue-item')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('.queue-item-text')).toHaveText('<img src=x onerror=alert(1)>');
    await (0, fixtures_js_1.expect)(page.locator('#queuePanel img')).toHaveCount(0);
});
(0, fixtures_js_1.test)('replaced queue controls are inert and a double click sends one cancellation', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => window.fixtureSessionListPatch(fixtureCurrentSession().id, { capabilities: { queueCancel: true } }));
    await page.evaluate(() => {
        window.queueCancels = [];
        fixtureApp.features.apiTransport.request = (...args) => new Promise(resolve => window.queueCancels.push({ args, resolve }));
        fixtureApp.features.promptDelivery.render({ followUp: ['first'] });
        window.oldQueueEdit = document.querySelector('.queue-item-edit');
        fixtureApp.features.promptDelivery.render({ followUp: ['replacement'] });
        fixtureElement(window.oldQueueEdit, 'old queue edit').click();
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.queueCancels.length)).toBe(0);
    await page.evaluate(() => { const button = fixtureElement(document.querySelector('.queue-item-edit'), '.queue-item-edit'); window.firstQueueEdit = fixtureApp.features.promptDelivery.edit(button); void fixtureApp.features.promptDelivery.edit(button); });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.queueCancels.length)).toBe(1);
    (0, fixtures_js_1.expect)(await page.evaluate(() => {
        const options = fixtureElement(window.queueCancels[0], 'queue cancellation').args[2];
        if (typeof options?.body !== 'string')
            throw new Error('Queue cancellation lacks JSON body');
        return JSON.parse(options.body);
    })).toEqual({ kind: 'followUp', index: 0, text: 'replacement' });
    await page.evaluate(() => { fixtureElement(window.queueCancels[0], 'queue cancellation').resolve(new Response('{}')); return window.firstQueueEdit; });
    (0, fixtures_js_1.expect)(await page.evaluate(() => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(fixtureCurrentSession().id)))).toBe('replacement');
});
(0, fixtures_js_1.test)('queue rows retain endpoint ownership and disposal retires response effects', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => window.fixtureSessionListPatch(fixtureCurrentSession().id, { capabilities: { queueCancel: true } }));
    await page.evaluate(() => {
        fixtureApp.features.promptDelivery.dispose();
        window.deliveryEndpoint = { base: 'http://original' };
        window.deliveryCalls = [];
        window.deliveryRestores = [];
        window.ownedDelivery = PiDishBrowser.createPromptDelivery({ document, sessionState: fixtureApp.features.sessionState, endpoint: () => window.deliveryEndpoint,
            request: (...args) => new Promise(resolve => window.deliveryCalls.push({ args, resolve })), restore: (...args) => window.deliveryRestores.push(args), status() { } });
        window.ownedDelivery.render({ followUp: ['first'] });
        window.deliveryEndpoint = { base: 'http://replacement' };
        fixtureElement(document.querySelector('.queue-item-edit'), '.queue-item-edit').click();
    });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.deliveryCalls.length)).toBe(0);
    await page.evaluate(() => { window.ownedDelivery.render({ followUp: ['second'] }); window.deliveryEdit = window.ownedDelivery.edit(fixtureElement(document.querySelector('.queue-item-edit'), '.queue-item-edit')); window.ownedDelivery.dispose(); fixtureElement(window.deliveryCalls[0], 'delivery call').resolve(new Response('{}')); return window.deliveryEdit; });
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.deliveryRestores)).toEqual([]);
});
(0, fixtures_js_1.test)('late side-command success cannot replace a newer answer or status', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => window.fixtureSessionListPatch(fixtureCurrentSession().id, { capabilities: { queueCancel: true } }));
    await page.evaluate(() => {
        window.commandReplies = [];
        fixtureApp.features.apiTransport.request = (...args) => new Promise(resolve => window.commandReplies.push({ args, resolve }));
        fixtureInput(document.getElementById('promptInput'), "document.getElementById('promptInput')").value = '/btw first';
        window.firstCommand = fixtureApp.features.composerSubmit.sendPrompt();
        fixtureInput(document.getElementById('promptInput'), "document.getElementById('promptInput')").value = '/btw second';
        window.secondCommand = fixtureApp.features.composerSubmit.sendPrompt();
        fixtureElement(window.commandReplies[1], 'second command reply').resolve(new Response(JSON.stringify({ answer: 'second answer', info: 'second finished' })));
    });
    await page.evaluate(() => window.secondCommand);
    await page.evaluate(() => { fixtureElement(window.commandReplies[0], 'first command reply').resolve(new Response(JSON.stringify({ answer: 'old answer', info: 'old finished' }))); return window.firstCommand; });
    await (0, fixtures_js_1.expect)(page.locator('.btw-panel-answer')).toHaveText('second answer');
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureElement(document.getElementById('status'), "document.getElementById('status')").textContent)).toBe('second finished');
});
(0, fixtures_js_1.test)('disposing submit retires late command effects while preserving the next composer', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => window.fixtureSessionListPatch(fixtureCurrentSession().id, { capabilities: { queueCancel: true } }));
    await page.evaluate(() => {
        fixtureApp.features.apiTransport.request = () => new Promise(resolve => { window.finishDisposedCommand = resolve; });
        fixtureInput(document.getElementById('promptInput'), "document.getElementById('promptInput')").value = '/btw question';
        window.disposedCommand = fixtureApp.features.composerSubmit.sendPrompt();
        fixtureApp.features.composerSubmit.dispose();
        fixtureInput(document.getElementById('promptInput'), "document.getElementById('promptInput')").value = 'later draft';
        window.finishDisposedCommand(new Response(JSON.stringify({ answer: 'disposed answer', info: 'disposed status' })));
    });
    await page.evaluate(() => window.disposedCommand);
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('later draft');
    await (0, fixtures_js_1.expect)(page.locator('.btw-panel-answer')).toHaveText('Asking…');
});
