// Generated test/tool from test/browser/file-attachments.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const fixtures_js_1 = require("./fixtures.js");
fixtures_js_1.test.use({ liveSessions: true });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// An MPEG-1 Layer III frame header and padding: enough to be an .mp3 by name and type.
const MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(413)]);
const notes = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello agent') };
const clip = { name: 'clip.mp3', mimeType: 'audio/mpeg', buffer: MP3 };
const image = { name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') };
function sentPrompts(host) {
    return host.commands.filter(command => command.command === 'prompt');
}
/** The `[Attached file: …]` paths of the host's last prompt, after checking each names a stored upload. */
function attachedPaths(host) {
    const prompt = sentPrompts(host).at(-1);
    const message = String(prompt?.message);
    const uploads = path.join(host.home, '.pi/dish/uploads', `pi-${fixtures_js_1.ROOT}`);
    return [...message.matchAll(/\[Attached file: (\S+) \(/g)].map(([, file]) => {
        (0, fixtures_js_1.expect)(path.dirname(path.dirname(file))).toBe(uploads);
        return file;
    });
}
async function chips(page) {
    return page.locator('#attachmentStrip .attachment-chip').evaluateAll(nodes => nodes.map(node => ({
        name: node.querySelector('.attachment-chip-name')?.textContent, size: node.querySelector('.attachment-chip-size')?.textContent,
        icon: !!node.querySelector('svg.attachment-chip-icon path'),
    })));
}
(0, fixtures_js_1.test)('text and audio attach as files while an image stays an image block', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.locator('#attachFileInput').setInputFiles([notes, clip, image]);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip img')).toHaveCount(1);
    (0, fixtures_js_1.expect)(await chips(page)).toEqual([
        { name: 'notes.txt', size: '11 B', icon: true },
        { name: 'clip.mp3', size: '417 B', icon: true },
    ]);
    await page.locator('#promptInput').fill('Summarize these');
    await page.locator('#promptInput').press('Enter');
    await fixtures_js_1.expect.poll(() => sentPrompts(fleet.self).length).toBe(1);
    const [prompt] = sentPrompts(fleet.self);
    const [textFile, audioFile] = attachedPaths(fleet.self);
    (0, fixtures_js_1.expect)(prompt.message).toBe([
        'Summarize these', '',
        `[Attached file: ${textFile} (text/plain, 11 B)]`,
        `[Attached file: ${audioFile} (audio/mpeg, 417 B)]`,
    ].join('\n'));
    (0, fixtures_js_1.expect)(path.basename(textFile)).toBe('notes.txt');
    (0, fixtures_js_1.expect)(fs.readFileSync(textFile, 'utf8')).toBe('hello agent');
    (0, fixtures_js_1.expect)(fs.readFileSync(audioFile).equals(MP3)).toBe(true);
    (0, fixtures_js_1.expect)(prompt.images).toEqual([{ type: 'image', data: PNG, mimeType: 'image/png' }]);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip')).toBeHidden();
    await (0, fixtures_js_1.expect)(page.locator('#messages .message.user').last()).toContainText(`[Attached file: ${textFile}`);
});
(0, fixtures_js_1.test)('a peer session receives its files on its own host, with progress shown and removal before send', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    await page.locator('#attachFileInput').setInputFiles([notes, { name: 'movie.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) }]);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-chip')).toHaveCount(2);
    await page.locator('#attachmentStrip .attachment-chip', { hasText: 'notes.txt' }).locator('.attachment-remove').click();
    (0, fixtures_js_1.expect)((await chips(page)).map(chip => chip.name)).toEqual(['movie.mp4']);
    const upload = (0, fixtures_js_1.heldRoute)();
    await page.route(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/uploads?*`, upload.hold);
    await page.locator('#promptInput').press('Enter');
    const held = await upload.received;
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip .attachment-chip.uploading progress')).toHaveCount(1);
    // A second send waits for the upload instead of overtaking it.
    await page.locator('#promptInput').fill('second');
    await page.evaluate(() => fixtureApp.features.composerSubmit.sendPrompt());
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Wait for the attachments to finish uploading');
    await held.continue();
    await fixtures_js_1.expect.poll(() => sentPrompts(fleet.peer).length).toBe(1);
    const [movie] = attachedPaths(fleet.peer);
    (0, fixtures_js_1.expect)(sentPrompts(fleet.peer)[0].message).toBe(`[Attached file: ${movie} (video/mp4, 2.0 KB)]`);
    (0, fixtures_js_1.expect)(fs.statSync(movie).size).toBe(2048);
    (0, fixtures_js_1.expect)(sentPrompts(fleet.self)).toEqual([]);
    await (0, fixtures_js_1.expect)(page.locator('#attachmentStrip')).toBeHidden();
});
(0, fixtures_js_1.test)('dropped and pasted files attach to the composer', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(() => {
        const dropped = new DataTransfer();
        dropped.items.add(new File(['a,b\n1,2\n'], 'table.csv', { type: 'text/csv' }));
        fixtureElement(document.querySelector('.input-area'), '.input-area').dispatchEvent(new DragEvent('drop', { dataTransfer: dropped, bubbles: true, cancelable: true }));
        const pasted = new DataTransfer();
        pasted.items.add(new File(['PK'], 'bundle.zip', { type: 'application/zip' }));
        fixtureElement(document.getElementById('promptInput'), '#promptInput').dispatchEvent(new ClipboardEvent('paste', { clipboardData: pasted, bubbles: true, cancelable: true }));
    });
    await fixtures_js_1.expect.poll(() => chips(page)).toEqual([
        { name: 'table.csv', size: '8 B', icon: true },
        { name: 'bundle.zip', size: '2 B', icon: true },
    ]);
});
(0, fixtures_js_1.test)('a file over the host limit is refused before upload and stays attached', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.route(`${fleet.self.base}/api/sessions/${fixtures_js_1.ROOT}/uploads`, route => route.fulfill({ json: { maxBytes: 4 } }));
    await page.locator('#attachFileInput').setInputFiles([notes]);
    await page.locator('#promptInput').fill('too big');
    await page.locator('#promptInput').press('Enter');
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('Upload failed: notes.txt is 11 B; this host accepts files up to 4 B (PI_DISH_UPLOAD_MAX_MB)');
    await (0, fixtures_js_1.expect)(page.locator('#promptInput')).toHaveValue('too big');
    (0, fixtures_js_1.expect)((await chips(page)).map(chip => chip.name)).toEqual(['notes.txt']);
    (0, fixtures_js_1.expect)(sentPrompts(fleet.self)).toEqual([]);
    (0, fixtures_js_1.expect)(fs.existsSync(path.join(fleet.self.home, '.pi/dish/uploads'))).toBe(false);
});
