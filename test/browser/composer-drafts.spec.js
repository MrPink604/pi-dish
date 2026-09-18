// Generated test/tool from test/browser/composer-drafts.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
fixtures_js_1.test.use({ liveSessions: true });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=';
async function pendingImage(page) {
    await page.evaluate(png => {
        window.bitmapClosed = 0;
        Object.defineProperty(window, 'createImageBitmap', {
            configurable: true,
            value: () => new Promise(resolve => {
                window.finishBitmap = async () => {
                    resolve({
                        width: 1,
                        height: 1,
                        close() { window.bitmapClosed++; },
                    });
                };
            }),
        });
        window.imagePending = fixtureApp.features.composerDrafts.images.add([new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'fixture.png', { type: 'image/png' })]);
    }, PNG);
}
(0, fixtures_js_1.test)('late image conversion stays with the same-id originating host', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await pendingImage(page);
    const owner = await page.evaluate(() => fixtureApp.features.composerDrafts.key);
    if (owner === null)
        throw new Error('Missing self composer owner');
    await fleet.select(fleet.peer);
    await page.evaluate(async () => { void window.finishBitmap(); await window.imagePending; });
    (0, fixtures_js_1.expect)(await page.evaluate(owner => ({ current: fixtureApp.features.composerDrafts.images.current().length, stored: fixtureApp.features.composerDrafts.images.stored(owner).length, closed: window.bitmapClosed }), owner)).toEqual({ current: 0, stored: 1, closed: 1 });
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.expect)(page.locator('.attachment-thumb')).toHaveCount(1);
});
(0, fixtures_js_1.test)('startup draft migration flushes pending text and carries unfinished image conversion to the registered session', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const owner = await page.evaluate(() => fixtureApp.features.composerDrafts.key);
    if (owner === null)
        throw new Error('Missing startup composer owner');
    await page.evaluate(() => fixtureApp.features.composerDrafts.restore('spawn:fixture-start'));
    await page.locator('#promptInput').fill('Latest startup draft');
    await pendingImage(page);
    await page.evaluate(async (owner) => { fixtureApp.features.composerDrafts.migrate('spawn:fixture-start', owner); fixtureApp.features.composerDrafts.restore(owner); void window.finishBitmap(); await window.imagePending; }, owner);
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('Latest startup draft');
    await (0, fixtures_js_1.expect)(page.locator('.attachment-thumb')).toHaveCount(1);
    (0, fixtures_js_1.expect)(await page.evaluate(() => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey('spawn:fixture-start')))).toBeNull();
});
(0, fixtures_js_1.test)('retained attachment remove buttons cannot affect a replacement or another host', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(png => { const owner = fixtureElement(fixtureApp.features.composerDrafts.key, 'composer owner'); fixtureApp.features.composerDrafts.images.replace(owner, [{ data: png, mimeType: 'image/png' }]); window.oldRemove = document.querySelector('.attachment-remove'); }, PNG);
    await fleet.select(fleet.peer);
    await page.evaluate(png => { const owner = fixtureElement(fixtureApp.features.composerDrafts.key, 'composer owner'); fixtureApp.features.composerDrafts.images.replace(owner, [{ data: png, mimeType: 'image/png' }]); fixtureElement(window.oldRemove, 'old attachment remove').click(); }, PNG);
    await (0, fixtures_js_1.expect)(page.locator('.attachment-thumb')).toHaveCount(1);
    await page.evaluate(png => { window.replacedRemove = document.querySelector('.attachment-remove'); const owner = fixtureElement(fixtureApp.features.composerDrafts.key, 'composer owner'); fixtureApp.features.composerDrafts.images.replace(owner, [{ data: png, mimeType: 'image/png' }]); fixtureElement(window.replacedRemove, 'replaced attachment remove').click(); }, PNG);
    await (0, fixtures_js_1.expect)(page.locator('.attachment-thumb')).toHaveCount(1);
    await page.locator('.attachment-remove').click();
    await (0, fixtures_js_1.expect)(page.locator('.attachment-thumb')).toHaveCount(0);
});
(0, fixtures_js_1.test)('clearing a foreign draft does not cancel the visible draft debounce or mix its history', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.locator('#promptInput').fill('Visible pending draft');
    await page.evaluate(({ host, id }) => { fixtureApp.features.composerDrafts.clearDraft(sessionKey(host, id)); fixtureApp.features.composerDrafts.record('foreign history', sessionKey(host, id)); fixtureApp.features.composerDrafts.record('local history'); }, { host: fleet.peer.hostId, id: fixtures_js_1.ROOT });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(fixtureElement(fixtureApp.features.composerDrafts.key, 'composer key'))))).toBe('Visible pending draft');
    await page.evaluate(() => fixtureApp.features.composerDrafts.navigate(-1, fixtureElement(document.querySelector('#promptInput'), '#promptInput')));
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('local history');
    await page.evaluate(() => fixtureApp.features.composerDrafts.navigate(-1, fixtureElement(document.querySelector('#promptInput'), '#promptInput')));
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('local history');
    await page.evaluate(() => fixtureApp.features.composerDrafts.navigate(1, fixtureElement(document.querySelector('#promptInput'), '#promptInput')));
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('Visible pending draft');
});
(0, fixtures_js_1.test)('discarded startup image conversion cannot recreate its stored attachments', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => fixtureApp.features.composerDrafts.restore('spawn:discarded'));
    await pendingImage(page);
    await page.evaluate(async () => { fixtureApp.features.composerDrafts.images.discard('spawn:discarded'); void window.finishBitmap(); await window.imagePending; });
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.composerDrafts.images.stored('spawn:discarded').length)).toBe(0);
    await (0, fixtures_js_1.expect)(page.locator('.attachment-thumb')).toHaveCount(0);
});
(0, fixtures_js_1.test)('malformed history is narrowed and disposal flushes text while closing late bitmap and lightbox resources', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => { const key = fixtureElement(fixtureApp.features.composerDrafts.key, 'composer key'); localStorage.setItem(fixtureApp.features.composerDrafts.historyKey(key), JSON.stringify([17, 'typed history', null])); fixtureApp.features.composerDrafts.restore(key); fixtureApp.features.composerDrafts.navigate(-1); });
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('typed history');
    await page.locator('#promptInput').fill('Flush on disposal');
    await pendingImage(page);
    const owner = await page.evaluate(() => fixtureApp.features.composerDrafts.key);
    if (owner === null)
        throw new Error('Missing disposal composer owner');
    await page.evaluate(png => { fixtureApp.features.composerDrafts.images.openLightbox('data:image/png;base64,' + png); fixtureApp.features.composerDrafts.dispose(); }, PNG);
    await page.evaluate(async () => { void window.finishBitmap(); await window.imagePending; });
    (0, fixtures_js_1.expect)(await page.evaluate(owner => ({ text: localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(owner)), closed: window.bitmapClosed }), owner)).toEqual({ text: 'Flush on disposal', closed: 1 });
    await (0, fixtures_js_1.expect)(page.locator('.lightbox-overlay')).toHaveCount(0);
    await (0, fixtures_js_1.expect)(page.locator('.attachment-thumb')).toHaveCount(0);
});
