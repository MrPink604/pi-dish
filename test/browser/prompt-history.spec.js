// Generated test/tool from test/browser/prompt-history.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
fixtures_js_1.test.use({ liveSessions: true });
async function record(page, prompts, host) {
    await page.evaluate(({ prompts, host, id }) => {
        for (const prompt of prompts)
            fixtureApp.features.composerDrafts.record(prompt, host ? sessionKey(host, id) : fixtureApp.features.composerDrafts.key);
    }, { prompts, host, id: fixtures_js_1.ROOT });
}
(0, fixtures_js_1.test)('the composer sheet lists the visible session newest first and inserts with the draft merge', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.expect)(page.locator('#btnPromptHistory')).toBeHidden();
    await record(page, ['first prompt', 'second <b>prompt</b>']);
    await record(page, ['peer only'], fleet.peer.hostId);
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copiedPrompt = text; } } }); });
    await page.locator('#btnPromptHistory').click();
    await (0, fixtures_js_1.expect)(page.locator('#promptHistoryPanel .prompt-history-text')).toHaveText(['second <b>prompt</b>', 'first prompt']);
    await page.locator('#promptHistoryPanel .prompt-copy').first().click();
    await fixtures_js_1.expect.poll(() => page.evaluate(() => window.copiedPrompt)).toBe('second <b>prompt</b>');
    await page.locator('#promptInput').fill('Half-written');
    await page.locator('#promptHistoryPanel .prompt-history-text', { hasText: 'first prompt' }).click();
    await (0, fixtures_js_1.expect)(page.locator('#promptHistoryPanel')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('Half-written\n\nfirst prompt');
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toBeFocused();
});
(0, fixtures_js_1.test)('a sheet opened for one session never inserts into the session selected afterwards', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await record(page, ['self prompt']);
    await page.locator('#btnPromptHistory').click();
    await (0, fixtures_js_1.expect)(page.locator('#promptHistoryPanel')).toBeVisible();
    await page.evaluate(() => { window.retainedHistoryRow = fixtureElement(document.querySelector('#promptHistoryPanel .prompt-history-text'), 'history row'); });
    const selfOwner = await page.evaluate(() => fixtureApp.features.composerDrafts.key);
    await fleet.select(fleet.peer);
    await (0, fixtures_js_1.expect)(page.locator('#promptHistoryPanel')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#btnPromptHistory')).toBeHidden();
    await page.locator('#promptInput').fill('Peer draft');
    await page.evaluate(() => { const row = fixtureElement(window.retainedHistoryRow, 'retained row'); document.body.append(row); row.click(); row.remove(); });
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('Peer draft');
    (0, fixtures_js_1.expect)(await page.evaluate(owner => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(fixtureElement(owner, 'self owner'))), selfOwner)).toBeNull();
});
(0, fixtures_js_1.test)('settings lists every stored session history and clears one or all after confirmation', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await record(page, ['self one', 'self two']);
    await record(page, ['peer one'], fleet.peer.hostId);
    await page.evaluate(() => fixtureApp.features.displayPreferences.open());
    const sessions = page.locator('#settingsSentPrompts .sent-prompts-session');
    await (0, fixtures_js_1.expect)(sessions).toHaveCount(2);
    const self = sessions.filter({ hasText: '2 prompts' });
    const name = await page.evaluate(({ host, id }) => fixtureApp.features.sessionState.findSession(id, host)?.name || '', { host: fleet.self.hostId, id: fixtures_js_1.ROOT });
    (0, fixtures_js_1.expect)(name).not.toBe('');
    await (0, fixtures_js_1.expect)(self.locator('.sent-prompts-name')).toHaveText(name);
    await self.locator('summary').click();
    await (0, fixtures_js_1.expect)(self.locator('.sent-prompts-text')).toHaveText(['self two', 'self one']);
    const peer = sessions.filter({ hasText: '1 prompt' });
    page.once('dialog', dialog => { void dialog.dismiss(); });
    await peer.locator('summary').click();
    await peer.locator('.sent-prompts-clear').click();
    await (0, fixtures_js_1.expect)(sessions).toHaveCount(2);
    page.once('dialog', dialog => { void dialog.accept(); });
    await peer.locator('.sent-prompts-clear').click();
    await (0, fixtures_js_1.expect)(sessions).toHaveCount(1);
    await (0, fixtures_js_1.expect)(self).toHaveAttribute('open', '');
    (0, fixtures_js_1.expect)(await page.evaluate(({ host, id }) => localStorage.getItem(fixtureApp.features.composerDrafts.historyKey(sessionKey(host, id))), { host: fleet.peer.hostId, id: fixtures_js_1.ROOT })).toBeNull();
    page.once('dialog', dialog => { void dialog.accept(); });
    await page.locator('#sentPromptsClearAll').click();
    await (0, fixtures_js_1.expect)(sessions).toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('#settingsSentPrompts .sent-prompts-empty')).toBeVisible();
    await page.evaluate(() => fixtureApp.features.displayPreferences.close());
    await (0, fixtures_js_1.expect)(page.locator('#btnPromptHistory')).toBeHidden();
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.composerDrafts.navigate(-1))).toBe(false);
});
(0, fixtures_js_1.test)('the sheet spans a phone-width input area', async ({ page, fleet }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fleet.select(fleet.self);
    await record(page, ['x'.repeat(600)]);
    await page.locator('#btnPromptHistory').click();
    const box = await page.locator('#promptHistoryPanel').boundingBox();
    if (!box)
        throw new Error('Missing history sheet box');
    (0, fixtures_js_1.expect)(box.x).toBeGreaterThanOrEqual(0);
    (0, fixtures_js_1.expect)(box.x + box.width).toBeLessThanOrEqual(390);
    (0, fixtures_js_1.expect)(box.width).toBeGreaterThan(300);
    (0, fixtures_js_1.expect)(box.y).toBeGreaterThanOrEqual(0);
});
