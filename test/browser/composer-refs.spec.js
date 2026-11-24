// Generated test/tool from test/browser/composer-refs.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("node:path");
const fixtures_js_1 = require("./fixtures.js");
fixtures_js_1.test.use({ liveSessions: true });
// Two distinct valid 1x1 PNGs so image ordering is verifiable byte-for-byte.
const PNG_A = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_B = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_C = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=';
const notesFile = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello notes') };
const reportFile = { name: 'quarterly-revenue-summary-2026.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') };
function sentPrompts(host) {
    return host.commands.filter(command => command.command === 'prompt');
}
async function pasteImage(page, base64, name = 'shot.png') {
    await page.evaluate(({ base64, name }) => {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], name, { type: 'image/png' }));
        const input = fixtureInput(document.getElementById('promptInput'), '#promptInput');
        input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, { base64, name });
}
(0, fixtures_js_1.test)('pasting images and attaching files inserts inline tokens at caret and labels strip cards', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const input = page.locator('#promptInput');
    await input.fill('Compare and contrast');
    await input.focus();
    await input.evaluate(el => { el.setSelectionRange(8, 8); });
    await pasteImage(page, PNG_A, 'first.png');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb .attachment-ref-badge')).toHaveText(['#1']);
    await (0, fixtures_js_1.expect)(input).toHaveValue('Compare [Image #1] and contrast');
    await page.locator('#attachFileInput').setInputFiles([notesFile, reportFile]);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-chip')).toHaveCount(2);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-chip .attachment-ref-badge')).toHaveText(['#1', '#2']);
    const value = await input.inputValue();
    (0, fixtures_js_1.expect)(value).toContain('[Image #1]');
    (0, fixtures_js_1.expect)(value).toContain('[File #1: notes.txt]');
    (0, fixtures_js_1.expect)(value).toContain('[File #2: quarterly-revenue-s….pdf]');
});
(0, fixtures_js_1.test)('atomic Backspace deletes token text while keeping the attachment, Undo revives token, and strip ✕ removes both', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const input = page.locator('#promptInput');
    await input.focus();
    await pasteImage(page, PNG_A, 'one.png');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(1);
    await pasteImage(page, PNG_B, 'two.png');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(2);
    await (0, fixtures_js_1.expect)(input).toHaveValue('[Image #1] [Image #2] ');
    // Backspace once deletes trailing space; second Backspace deletes `[Image #2]` atomically.
    await input.press('Backspace');
    await (0, fixtures_js_1.expect)(input).toHaveValue('[Image #1] [Image #2]');
    await input.press('Backspace');
    await (0, fixtures_js_1.expect)(input).toHaveValue('[Image #1] ');
    // OWNER OVERRIDE: deleting the token in text NEVER drops the attachment from the strip.
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(2);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb .attachment-ref-badge')).toHaveText(['#1', '#2']);
    // Native Undo brings `[Image #2]` back still paired with `#2`.
    await input.press('Control+z');
    await (0, fixtures_js_1.expect)(input).toHaveValue('[Image #1] [Image #2]');
    // Partial manual edit of a token also keeps the attachment in the strip.
    await input.fill('Keep [Image #1 and [Image #2]');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(2);
    // Clicking strip ✕ on #1 removes #1 AND strips any exact `[Image #1]` tokens while #2 stays `#2`.
    await input.fill('Compare [Image #1] with [Image #2] and [Image #1]');
    await page.locator('#attachmentStrip .attachment-thumb').first().locator('.attachment-remove').click();
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb .attachment-ref-badge')).toHaveText(['#2']);
    await (0, fixtures_js_1.expect)(input).toHaveValue('Compare with [Image #2] and');
});
(0, fixtures_js_1.test)('send keeps deleted-label attachments, compacts gaps consistently on omp/pi, and records resolved history', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(id => window.fixtureSessionListPatch(id, { harnessId: 'omp' }), fixtures_js_1.ROOT);
    const input = page.locator('#promptInput');
    await input.focus();
    // Stage 3 images, remove #1 via ✕ so #2 (PNG_B) and #3 (PNG_C) remain.
    await pasteImage(page, PNG_A, 'a.png');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(1);
    await pasteImage(page, PNG_B, 'b.png');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(2);
    await pasteImage(page, PNG_C, 'c.png');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(3);
    await page.locator('#attachmentStrip .attachment-thumb').first().locator('.attachment-remove').click();
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb .attachment-ref-badge')).toHaveText(['#2', '#3']);
    // Delete `[Image #2]` from prose, keep `[Image #3]`, and add an unattached prose `[Image #99]`.
    await input.fill('Check [Image #3] against [Image #99]');
    await input.press('Enter');
    await fixtures_js_1.expect.poll(() => sentPrompts(fleet.self).length).toBe(1);
    const ompPrompt = sentPrompts(fleet.self)[0];
    // Both remaining images are sent in strip order [PNG_B (#1), PNG_C (#2)],
    // and `[Image #3]` compacts to `[Image #2]` while prose `[Image #99]` stays untouched.
    (0, fixtures_js_1.expect)(ompPrompt.message).toBe('Check [Image #2] against [Image #99]');
    (0, fixtures_js_1.expect)(ompPrompt.images).toEqual([
        { type: 'image', data: PNG_B, mimeType: 'image/png' },
        { type: 'image', data: PNG_C, mimeType: 'image/png' },
    ]);
    // History strips unbacked staged image tokens so ↑ never re-inserts dead `[Image #2]`.
    await input.evaluate(el => { el.setSelectionRange(0, 0); });
    await input.press('ArrowUp');
    await (0, fixtures_js_1.expect)(input).toHaveValue('Check against [Image #99]');
    // Send a file with inline `[File #1: notes.txt]` to a pi session and verify manifest footer + history.
    await page.evaluate(id => window.fixtureSessionListPatch(id, { harnessId: 'pi' }), fixtures_js_1.ROOT);
    await input.fill('Review ');
    await input.focus();
    await input.evaluate(el => { const ta = el; ta.setSelectionRange(ta.value.length, ta.value.length); });
    await page.locator('#attachFileInput').setInputFiles([notesFile]);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-chip')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(input).toHaveValue('Review [File #1: notes.txt] ');
    await input.press('Enter');
    await fixtures_js_1.expect.poll(() => sentPrompts(fleet.self).length).toBe(2);
    const piPrompt = sentPrompts(fleet.self)[1];
    const msg = String(piPrompt.message);
    (0, fixtures_js_1.expect)(msg).toMatch(/^Review \[File #1: notes\.txt\]\n\n\[File #1\] \[Attached file: \/.*\/notes\.txt \(text\/plain, 11 B\)\]$/);
    const match = /\[Attached file: (\S+) \(/.exec(msg);
    (0, fixtures_js_1.expect)(path.basename(match[1])).toBe('notes.txt');
    // ↑ history recalls the resolved file prompt with its uploaded path.
    await input.evaluate(el => { el.setSelectionRange(0, 0); });
    await input.press('ArrowUp');
    await (0, fixtures_js_1.expect)(input).toHaveValue(msg);
});
(0, fixtures_js_1.test)('image-only send to an agy session works both with token and when token is deleted', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(id => window.fixtureSessionListPatch(id, { harnessId: 'agy' }), fixtures_js_1.ROOT);
    const posted = [];
    await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/prompt`, async (route) => {
        posted.push(route.request().postDataJSON());
        await route.continue();
    });
    const input = page.locator('#promptInput');
    await input.focus();
    await pasteImage(page, PNG_A, 'agy1.png');
    await (0, fixtures_js_1.expect)(input).toHaveValue('[Image #1] ');
    await input.press('Enter');
    await fixtures_js_1.expect.poll(() => posted.length).toBe(1);
    (0, fixtures_js_1.expect)(posted[0]).toEqual({ message: '[Image #1]', images: [{ data: PNG_A, mimeType: 'image/png' }] });
    // Image-only send with only a staged token must not clutter prompt history.
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.composerDrafts.prompts())).toEqual([]);
    // Now attach an image, delete its `[Image #1]` token completely so message is `""`, and send.
    await pasteImage(page, PNG_B, 'agy2.png');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(1);
    await input.fill('');
    await input.press('Enter');
    await fixtures_js_1.expect.poll(() => posted.length).toBe(2);
    (0, fixtures_js_1.expect)(posted[1]).toEqual({ message: '', images: [{ data: PNG_B, mimeType: 'image/png' }] });
});
(0, fixtures_js_1.test)('draft restore keeps tokens across in-tab switches and strips orphaned refs with a quiet note after reload', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const input = page.locator('#promptInput');
    await input.fill('Check prose [Image #99] and ');
    await input.focus();
    await input.evaluate(el => { const ta = el; ta.setSelectionRange(ta.value.length, ta.value.length); });
    await pasteImage(page, PNG_A, 'reload.png');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(input).toHaveValue('Check prose [Image #99] and [Image #1] ');
    const refsKey = await page.evaluate(() => {
        const key = fixtureElement(fixtureApp.features.composerDrafts.key, 'draft key');
        return {
            key: fixtureApp.features.composerDrafts.draftRefsKey(key),
            value: localStorage.getItem(fixtureApp.features.composerDrafts.draftRefsKey(key)),
        };
    });
    (0, fixtures_js_1.expect)(refsKey.key).toMatch(/^pi-dish-draft-refs-/);
    (0, fixtures_js_1.expect)(JSON.parse(refsKey.value)).toEqual(['[Image #1]']);
    // In-tab session switch preserves both the token and staged thumb with no reload note.
    await fleet.select(fleet.peer);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip')).toBeHidden();
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.expect)(input).toHaveValue('Check prose [Image #99] and [Image #1] ');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb')).toHaveCount(1);
    await (0, fixtures_js_1.expect)(page.locator('#composerNote')).toBeHidden();
    // Full page reload loses in-memory attachments, strips ONLY `[Image #1]`, keeps prose `[Image #99]`, and shows note.
    await page.reload();
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    await (0, fixtures_js_1.expect)(input).toHaveValue('Check prose [Image #99] and ');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#composerNote')).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#composerNote')).toContainText('Attachments were cleared on reload');
    // Second reload does not repeat the note or touch prose `[Image #99]`.
    await page.reload();
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    await (0, fixtures_js_1.expect)(input).toHaveValue('Check prose [Image #99] and ');
    await (0, fixtures_js_1.expect)(page.locator('#composerNote')).toBeHidden();
});
(0, fixtures_js_1.test)('phone-width (390px) layout keeps badges visible and non-overlapping without horizontal page overflow', async ({ page, fleet }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fleet.select(fleet.self);
    await page.locator('#attachFileInput').setInputFiles([
        { name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from(PNG_A, 'base64') },
        reportFile,
    ]);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb .attachment-ref-badge')).toHaveText(['#1']);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-chip .attachment-ref-badge')).toHaveText(['#1']);
    const geometry = await page.evaluate(() => {
        const strip = fixtureElement(document.getElementById('attachmentStrip'), '#attachmentStrip').getBoundingClientRect();
        const thumbBadge = fixtureElement(document.querySelector('#attachmentStrip .attachment-thumb .attachment-ref-badge'), 'thumb badge').getBoundingClientRect();
        const thumbRemove = fixtureElement(document.querySelector('#attachmentStrip .attachment-thumb .attachment-remove'), 'thumb remove').getBoundingClientRect();
        const chipBadge = fixtureElement(document.querySelector('#attachmentStrip .attachment-chip .attachment-ref-badge'), 'chip badge').getBoundingClientRect();
        const input = fixtureElement(document.getElementById('promptInput'), '#promptInput').getBoundingClientRect();
        return {
            overflow: document.documentElement.scrollWidth > window.innerWidth,
            stripRight: strip.right,
            inputRight: input.right,
            thumbBadge,
            thumbRemove,
            chipBadge,
        };
    });
    (0, fixtures_js_1.expect)(geometry.overflow).toBe(false);
    (0, fixtures_js_1.expect)(geometry.stripRight).toBeLessThanOrEqual(390);
    (0, fixtures_js_1.expect)(geometry.inputRight).toBeLessThanOrEqual(390);
    (0, fixtures_js_1.expect)(geometry.thumbBadge.width).toBeGreaterThan(0);
    (0, fixtures_js_1.expect)(geometry.chipBadge.width).toBeGreaterThan(0);
    // Bottom-left `#1` badge must not overlap top-right `✕` remove button.
    const overlaps = !(geometry.thumbBadge.right <= geometry.thumbRemove.left
        || geometry.thumbBadge.left >= geometry.thumbRemove.right
        || geometry.thumbBadge.bottom <= geometry.thumbRemove.top
        || geometry.thumbBadge.top >= geometry.thumbRemove.bottom);
    (0, fixtures_js_1.expect)(overlaps).toBe(false);
});
(0, fixtures_js_1.test)('version skew: cached old shell without composerNote and legacy drafts without ref keys still work cleanly', async ({ page, fleet }) => {
    // Seed a legacy plain-string draft with prose `[Image #1]` and NO `pi-dish-draft-refs-*` key.
    await fleet.select(fleet.self);
    const owner = await page.evaluate(() => {
        const key = fixtureElement(fixtureApp.features.composerDrafts.key, 'draft key');
        localStorage.setItem(fixtureApp.features.composerDrafts.draftKey(key), 'Legacy draft mentioning [Image #1]');
        localStorage.removeItem(fixtureApp.features.composerDrafts.draftRefsKey(key));
        return key;
    });
    // Serve an older cached index.html lacking `#composerNote` and carrying the old image picker id.
    await page.route(`${fleet.self.base}/`, async (route) => {
        const response = await route.fetch();
        const body = (await response.text())
            .replace(/<div class="composer-note"[^>]*><\/div>/, '')
            .replace('id="attachFileInput"', 'id="imageFileInput" accept="image/*"');
        await route.fulfill({ response, body });
    });
    await page.reload();
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    // Legacy prose `[Image #1]` was not recorded in draft-refs, so it survives reload untouched.
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('Legacy draft mentioning [Image #1]');
    // Attaching still works cleanly on the old shell and keeps the attachment if its label is edited away.
    await pasteImage(page, PNG_A, 'skew.png');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb .attachment-ref-badge')).toHaveText(['#1']);
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('Legacy draft mentioning [Image #1] [Image #1] ');
    (0, fixtures_js_1.expect)(owner).toBeTruthy();
});
(0, fixtures_js_1.test)('image prep reserves label at attach time, gates send/steer/follow-up per owner, and never overwrites later selection', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const input = page.locator('#promptInput');
    await input.fill('Draft before image');
    await input.focus();
    await input.evaluate(el => { const ta = el; ta.setSelectionRange(ta.value.length, ta.value.length); });
    await page.evaluate(png => {
        window.bitmapClosed = 0;
        Object.defineProperty(window, 'createImageBitmap', {
            configurable: true,
            value: () => new Promise(resolve => {
                window.finishBitmap = async () => {
                    resolve({ width: 1, height: 1, close() { window.bitmapClosed++; } });
                };
            }),
        });
        const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
        window.imagePending = fixtureApp.features.composerDrafts.images.add([new File([bytes], 'slow.png', { type: 'image/png' })]);
    }, PNG_A);
    // Immediately at attach time: token inserted, pending card shown with accessible remove button, send buttons disabled.
    await (0, fixtures_js_1.expect)(input).toHaveValue('Draft before image [Image #1] ');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-chip.preparing .attachment-ref-badge')).toHaveText(['#1']);
    await (0, fixtures_js_1.expect)(page.getByRole('button', { name: 'Remove image #1' })).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#btnSend')).toBeDisabled();
    await (0, fixtures_js_1.expect)(page.locator('#btnSteer')).toBeDisabled();
    await (0, fixtures_js_1.expect)(page.locator('#btnFollowUp')).toBeDisabled();
    // Send, Steer, and Follow-up are gated while preparing.
    for (const method of ['sendPrompt', 'sendSteer', 'sendFollowUp']) {
        await page.evaluate(m => fixtureApp.features.composerSubmit[m](), method);
        await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Wait for the attachments to finish preparing');
    }
    (0, fixtures_js_1.expect)(sentPrompts(fleet.self)).toHaveLength(0);
    // Gating is per owner: peer stays enabled, and switching back preserves pending state without reload stripping.
    await fleet.select(fleet.peer);
    await (0, fixtures_js_1.expect)(page.locator('#btnSend')).toBeEnabled();
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.expect)(page.locator('#btnSend')).toBeDisabled();
    await (0, fixtures_js_1.expect)(input).toHaveValue('Draft before image [Image #1] ');
    await (0, fixtures_js_1.expect)(page.locator('#composerNote')).toBeHidden();
    // Selecting prose while decode is in flight must not be replaced when decode completes.
    await input.focus();
    await input.evaluate(el => { const ta = el; ta.setSelectionRange(0, ta.value.length); });
    await page.evaluate(async () => { void window.finishBitmap(); await window.imagePending; });
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-thumb .attachment-ref-badge')).toHaveText(['#1']);
    await (0, fixtures_js_1.expect)(page.getByRole('button', { name: 'Remove image #1' })).toBeVisible();
    await (0, fixtures_js_1.expect)(page.locator('#btnSend')).toBeEnabled();
    const afterDecode = await input.evaluate(el => {
        const ta = el;
        return { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
    });
    (0, fixtures_js_1.expect)(afterDecode).toEqual({ value: 'Draft before image [Image #1] ', start: 0, end: 30 });
    await input.press('Enter');
    await fixtures_js_1.expect.poll(() => sentPrompts(fleet.self).length).toBe(1);
    (0, fixtures_js_1.expect)(sentPrompts(fleet.self)[0].message).toBe('Draft before image [Image #1]');
    (0, fixtures_js_1.expect)(sentPrompts(fleet.self)[0].images).toEqual([{ type: 'image', data: PNG_A, mimeType: 'image/png' }]);
    // Failed decode removes pending entry, re-enables send, and leaves label text untouched (strip is truth).
    await page.evaluate(id => {
        window.fixtureSessionListPatch(id, { harnessId: 'bot' });
        Object.defineProperty(window, 'createImageBitmap', {
            configurable: true,
            value: () => Promise.reject(new Error('decode failed')),
        });
    }, fixtures_js_1.ROOT);
    await input.fill('Before broken');
    await input.focus();
    await input.evaluate(el => { const ta = el; ta.setSelectionRange(ta.value.length, ta.value.length); });
    await page.locator('#attachFileInput').setInputFiles([{ name: 'broken.webp', mimeType: 'image/webp', buffer: Buffer.from('bad') }]);
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Could not attach broken.webp');
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#btnSend')).toBeEnabled();
    await (0, fixtures_js_1.expect)(input).toHaveValue('Before broken [Image #1] ');
});
(0, fixtures_js_1.test)('reload mid-upload recovers prose from prompt history and normal upload upgrades the history entry in place', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const input = page.locator('#promptInput');
    await input.fill('Important prose for');
    await input.focus();
    await input.evaluate(el => { const ta = el; ta.setSelectionRange(ta.value.length, ta.value.length); });
    await page.locator('#attachFileInput').setInputFiles([notesFile]);
    await (0, fixtures_js_1.expect)(page.getByRole('button', { name: 'Remove file #1: notes.txt' })).toBeVisible();
    await (0, fixtures_js_1.expect)(input).toHaveValue('Important prose for [File #1: notes.txt] ');
    const upload = (0, fixtures_js_1.heldRoute)();
    await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/uploads?*`, upload.hold);
    await input.press('Enter');
    await upload.received;
    // Prose is persisted in history before the upload settles, surviving a mid-upload reload.
    const preUploadHistory = await page.evaluate(() => fixtureApp.features.composerDrafts.prompts());
    (0, fixtures_js_1.expect)(preUploadHistory).toEqual(['Important prose for [File #1: notes.txt]']);
    // Reload while the upload is still in flight; draft is gone, ↑ recovers prose from history.
    await page.reload();
    await page.unroute(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/uploads?*`);
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    await (0, fixtures_js_1.expect)(input).toHaveValue('');
    await input.focus();
    await input.evaluate(el => { el.setSelectionRange(0, 0); });
    await input.press('ArrowUp');
    await (0, fixtures_js_1.expect)(input).toHaveValue('Important prose for [File #1: notes.txt]');
    // When a file upload completes normally, history holds one upgraded entry (no duplicate).
    await input.fill('Second upload for');
    await input.focus();
    await input.evaluate(el => { const ta = el; ta.setSelectionRange(ta.value.length, ta.value.length); });
    await page.locator('#attachFileInput').setInputFiles([notesFile]);
    await input.press('Enter');
    await fixtures_js_1.expect.poll(() => sentPrompts(fleet.self).length).toBe(1);
    const finalHistory = await page.evaluate(() => fixtureApp.features.composerDrafts.prompts());
    (0, fixtures_js_1.expect)(finalHistory).toHaveLength(2);
    (0, fixtures_js_1.expect)(finalHistory[0]).toBe('Important prose for [File #1: notes.txt]');
    (0, fixtures_js_1.expect)(finalHistory[1]).toMatch(/^Second upload for \[File #1: notes\.txt\]\n\n\[File #1\] \[Attached file: \/.*\/notes\.txt \(text\/plain, 11 B\)\]$/);
});
(0, fixtures_js_1.test)('bare-key migration preserves pi-dish-draft-refs- prefix, non-canonical refs never strip prose, and IME Enter does not send', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    // Seed legacy bare keys (both draft and draft-refs containing a non-canonical entry "hello") and re-run migration on reload.
    await page.evaluate(id => {
        localStorage.removeItem('pi-dish-keys-migrated');
        const owner = fixtureElement(fixtureApp.features.composerDrafts.key, 'draft key');
        localStorage.removeItem(fixtureApp.features.composerDrafts.draftKey(owner));
        localStorage.removeItem(fixtureApp.features.composerDrafts.draftRefsKey(owner));
        localStorage.setItem(`pi-dish-draft-${id}`, 'Keep hello and [Image #1]');
        localStorage.setItem(`pi-dish-draft-refs-${id}`, JSON.stringify(['hello', '[Image #1]']));
    }, fixtures_js_1.ROOT);
    await page.reload();
    await (0, fixtures_js_1.expect)(page.locator('#messages')).toContainText('self root transcript');
    // Bare pi-dish-draft-refs-<id> migrated under pi-dish-draft-refs- (not mangled into pi-dish-draft-<host> refs-<id>),
    // canonical `[Image #1]` was stripped, and non-canonical `"hello"` stayed untouched in prose.
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('Keep hello and');
    await (0, fixtures_js_1.expect)(page.locator('#composerNote')).toBeVisible();
    const keys = await page.evaluate(() => {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith('pi-dish-draft-'))
                out.push(k);
        }
        return out;
    });
    (0, fixtures_js_1.expect)(keys.some(k => k.includes(' refs-'))).toBe(false);
    (0, fixtures_js_1.expect)(keys.includes(`pi-dish-draft-refs-${fixtures_js_1.ROOT}`)).toBe(false);
    // IME composition Enter (isComposing or keyCode 229) must not submit the composer.
    await page.evaluate(() => {
        const input = fixtureInput(document.getElementById('promptInput'), '#promptInput');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
        const legacy = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        Object.defineProperty(legacy, 'keyCode', { value: 229 });
        input.dispatchEvent(legacy);
    });
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('Keep hello and');
    (0, fixtures_js_1.expect)(sentPrompts(fleet.self)).toHaveLength(0);
});
(0, fixtures_js_1.test)('upload history preserves an earlier identical prompt, rolls back on upload failure, and empty Enter preserves error feedback', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const input = page.locator('#promptInput');
    // 1. Send plain "review", then send "review" with a file chip (label removed) -> both entries remain in history.
    await input.fill('review');
    await input.press('Enter');
    await fixtures_js_1.expect.poll(() => sentPrompts(fleet.self).length).toBe(1);
    await page.locator('#attachFileInput').setInputFiles([notesFile]);
    await input.fill('review');
    await input.press('Enter');
    await fixtures_js_1.expect.poll(() => sentPrompts(fleet.self).length).toBe(2);
    const historyAfterFile = await page.evaluate(() => fixtureApp.features.composerDrafts.prompts());
    (0, fixtures_js_1.expect)(historyAfterFile).toHaveLength(2);
    (0, fixtures_js_1.expect)(historyAfterFile[0]).toBe('review');
    (0, fixtures_js_1.expect)(historyAfterFile[1]).toMatch(/^review\n\n\[Attached file: \/.*\/notes\.txt \(text\/plain, 11 B\)\]$/);
    // 2. Failed upload rolls back its provisional history entry.
    await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/uploads`, route => route.fulfill({ json: { maxBytes: 4 } }));
    await page.locator('#attachFileInput').setInputFiles([notesFile]);
    await input.fill('should roll back');
    await input.press('Enter');
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Upload failed:');
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureApp.features.composerDrafts.prompts())).toEqual(historyAfterFile);
    await page.unroute(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/uploads`);
    await page.locator('#attachmentStrip .attachment-remove').click();
    // 3. Pressing Enter / Ctrl+Enter on an empty composer does not swallow an in-flight request's feedback.
    const failingPrompt = (0, fixtures_js_1.heldRoute)();
    await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/prompt`, failingPrompt.hold);
    await input.fill('first failing request');
    await input.press('Enter');
    const promptRoute = await failingPrompt.received;
    await (0, fixtures_js_1.expect)(input).toHaveValue('');
    await input.press('Enter'); // empty no-op must not bump feedbackSequence
    await promptRoute.fulfill({ status: 503, json: { error: 'upstream down' } });
    await fixtures_js_1.expect.poll(() => page.evaluate(() => fixtureApp.features.sessionActivity.turn)).toBe(false);
    await page.unroute(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/prompt`);
    const failingSteer = (0, fixtures_js_1.heldRoute)();
    await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/steer`, failingSteer.hold);
    await input.fill('failing steer request');
    await input.press('Control+Enter');
    const steerRoute = await failingSteer.received;
    await (0, fixtures_js_1.expect)(input).toHaveValue('');
    await input.press('Control+Enter'); // empty no-op must not suppress steer error feedback
    await steerRoute.fulfill({ status: 503, json: { error: 'steer upstream down' } });
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Steer failed: steer upstream down');
});
