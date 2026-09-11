const { test, expect, ROOT } = require('./fixtures');
test.use({ liveSessions: true });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=';
async function pendingImage(page) {
  await page.evaluate(png => {
    window.bitmapClosed = 0; createImageBitmap = () => new Promise(resolve => { window.finishBitmap = () => resolve({ width: 1, height: 1, close() { window.bitmapClosed++; } }); });
    window.imagePending = addImageFiles([new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'fixture.png', { type: 'image/png' })]);
  }, PNG);
}

test('late image conversion stays with the same-id originating host', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await pendingImage(page); const owner = await page.evaluate(() => composerDrafts.key);
  await fleet.select(fleet.peer); await page.evaluate(async () => { window.finishBitmap(); await window.imagePending; });
  expect(await page.evaluate(owner => ({ current: composerDrafts.images.current().length, stored: composerDrafts.images.stored(owner).length, closed: window.bitmapClosed }), owner)).toEqual({ current: 0, stored: 1, closed: 1 });
  await fleet.select(fleet.self); await expect(page.locator('.attachment-thumb')).toHaveCount(1);
});

test('startup draft migration flushes pending text and carries unfinished image conversion to the registered session', async ({ page, fleet }) => {
  await fleet.select(fleet.self); const owner = await page.evaluate(() => composerDrafts.key);
  await page.evaluate(() => restorePromptState('spawn:fixture-start')); await page.locator('#promptInput').fill('Latest startup draft'); await pendingImage(page);
  await page.evaluate(async owner => { migratePromptState('spawn:fixture-start', owner); restorePromptState(owner); window.finishBitmap(); await window.imagePending; }, owner);
  await expect(page.locator('#promptInput')).toHaveValue('Latest startup draft'); await expect(page.locator('.attachment-thumb')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem(draftKey('spawn:fixture-start')))).toBeNull();
});

test('retained attachment remove buttons cannot affect a replacement or another host', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(png => { composerDrafts.images.replace(composerDrafts.key, [{ data: png, mimeType: 'image/png' }]); window.oldRemove = document.querySelector('.attachment-remove'); }, PNG);
  await fleet.select(fleet.peer);
  await page.evaluate(png => { composerDrafts.images.replace(composerDrafts.key, [{ data: png, mimeType: 'image/png' }]); window.oldRemove.click(); }, PNG);
  await expect(page.locator('.attachment-thumb')).toHaveCount(1);
  await page.evaluate(png => { window.replacedRemove = document.querySelector('.attachment-remove'); composerDrafts.images.replace(composerDrafts.key, [{ data: png, mimeType: 'image/png' }]); window.replacedRemove.click(); }, PNG);
  await expect(page.locator('.attachment-thumb')).toHaveCount(1); await page.locator('.attachment-remove').click(); await expect(page.locator('.attachment-thumb')).toHaveCount(0);
});

test('clearing a foreign draft does not cancel the visible draft debounce or mix its history', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await page.locator('#promptInput').fill('Visible pending draft');
  await page.evaluate(({ host, id }) => { clearDraft(sessionKey(host, id)); recordPrompt('foreign history', sessionKey(host, id)); recordPrompt('local history'); }, { host: fleet.peer.hostId, id: ROOT });
  await expect.poll(() => page.evaluate(() => localStorage.getItem(draftKey(composerDrafts.key)))).toBe('Visible pending draft');
  await page.evaluate(() => navigateHistory(-1, document.getElementById('promptInput'))); await expect(page.locator('#promptInput')).toHaveValue('local history');
  await page.evaluate(() => navigateHistory(-1, document.getElementById('promptInput'))); await expect(page.locator('#promptInput')).toHaveValue('local history');
  await page.evaluate(() => navigateHistory(1, document.getElementById('promptInput'))); await expect(page.locator('#promptInput')).toHaveValue('Visible pending draft');
});

test('discarded startup image conversion cannot recreate its stored attachments', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await page.evaluate(() => restorePromptState('spawn:discarded')); await pendingImage(page);
  await page.evaluate(async () => { composerDrafts.images.discard('spawn:discarded'); window.finishBitmap(); await window.imagePending; });
  expect(await page.evaluate(() => composerDrafts.images.stored('spawn:discarded').length)).toBe(0); await expect(page.locator('.attachment-thumb')).toHaveCount(0);
});

test('malformed history is narrowed and disposal flushes text while closing late bitmap and lightbox resources', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => { localStorage.setItem(historyKey(composerDrafts.key), JSON.stringify([17, 'typed history', null])); restorePromptState(composerDrafts.key); navigateHistory(-1); });
  await expect(page.locator('#promptInput')).toHaveValue('typed history'); await page.locator('#promptInput').fill('Flush on disposal'); await pendingImage(page);
  const owner = await page.evaluate(() => composerDrafts.key);
  await page.evaluate(png => { openImageLightbox('data:image/png;base64,' + png); composerDrafts.dispose(); }, PNG);
  await page.evaluate(async () => { window.finishBitmap(); await window.imagePending; });
  expect(await page.evaluate(owner => ({ text: localStorage.getItem(draftKey(owner)), closed: window.bitmapClosed }), owner)).toEqual({ text: 'Flush on disposal', closed: 1 });
  await expect(page.locator('.lightbox-overlay')).toHaveCount(0); await expect(page.locator('.attachment-thumb')).toHaveCount(0);
});
