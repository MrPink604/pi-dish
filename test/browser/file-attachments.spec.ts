import fs = require('node:fs');
import path = require('node:path');
import type { Page } from '@playwright/test';
import { test, expect, ROOT, heldRoute, type BrowserHost } from './fixtures.js';
test.use({ liveSessions: true });

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// An MPEG-1 Layer III frame header and padding: enough to be an .mp3 by name and type.
const MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(413)]);
const notes = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello agent') };
const clip = { name: 'clip.mp3', mimeType: 'audio/mpeg', buffer: MP3 };
const image = { name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') };

function sentPrompts(host: BrowserHost) {
  return host.commands.filter(command => command.command === 'prompt');
}

/** The `[Attached file: …]` paths of the host's last prompt, after checking each names a stored upload. */
function attachedPaths(host: BrowserHost) {
  const prompt = sentPrompts(host).at(-1);
  const message = String(prompt?.message);
  const uploads = path.join(host.home, '.pi/dish/uploads', `pi-${ROOT}`);
  return [...message.matchAll(/\[Attached file: (\S+) \(/g)].map(([, file]) => {
    expect(path.dirname(path.dirname(file!))).toBe(uploads);
    return file!;
  });
}

async function chips(page: Page) {
  return page.locator('#attachmentStrip .attachment-chip').evaluateAll(nodes => nodes.map(node => ({
    name: node.querySelector('.attachment-chip-name')?.textContent, size: node.querySelector('.attachment-chip-size')?.textContent,
    icon: !!node.querySelector('svg.attachment-chip-icon path'),
  })));
}

test('a cached shell with the old image picker still opens sessions and attaches images', async ({ page, fleet }) => {
  await page.route(`${fleet.self.base}/`, async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/app\.js\?v=[0-9a-f]+/, 'app.js')
      .replace('id="attachFileInput"', 'id="imageFileInput" accept="image/*"')
      .replace('id="btnAttach"', 'id="btnAttach" data-app-click="attachImage"');
    await route.fulfill({ response, body });
  });
  await page.reload();
  await fleet.row(fleet.self).click();
  await expect(page.locator('#messages')).toContainText('self root transcript');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#btnAttach').click();
  await (await chooser).setFiles(image);
  await expect(page.locator('#attachmentStrip img')).toHaveCount(1);
});

test('text and audio attach as files while an image stays an image block', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.locator('#attachFileInput').setInputFiles([notes, clip, image]);
  await expect(page.locator('#attachmentStrip img')).toHaveCount(1);
  expect(await chips(page)).toEqual([
    { name: 'notes.txt', size: '11 B', icon: true },
    { name: 'clip.mp3', size: '417 B', icon: true },
  ]);
  await page.locator('#promptInput').fill('Summarize these');
  await page.locator('#promptInput').press('Enter');
  await expect.poll(() => sentPrompts(fleet.self).length).toBe(1);
  const [prompt] = sentPrompts(fleet.self);
  const [textFile, audioFile] = attachedPaths(fleet.self);
  expect(prompt!.message).toBe([
    'Summarize these', '',
    `[Attached file: ${textFile} (text/plain, 11 B)]`,
    `[Attached file: ${audioFile} (audio/mpeg, 417 B)]`,
  ].join('\n'));
  expect(path.basename(textFile!)).toBe('notes.txt');
  expect(fs.readFileSync(textFile!, 'utf8')).toBe('hello agent');
  expect(fs.readFileSync(audioFile!).equals(MP3)).toBe(true);
  expect(prompt!.images).toEqual([{ type: 'image', data: PNG, mimeType: 'image/png' }]);
  await expect(page.locator('#attachmentStrip')).toBeHidden();
  await expect(page.locator('#messages .message.user').last()).toContainText(`[Attached file: ${textFile}`);
});

test('a peer session receives its files on its own host, with progress shown and removal before send', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  await page.locator('#attachFileInput').setInputFiles([notes, { name: 'movie.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) }]);
  await expect(page.locator('#attachmentStrip .attachment-chip')).toHaveCount(2);
  await page.locator('#attachmentStrip .attachment-chip', { hasText: 'notes.txt' }).locator('.attachment-remove').click();
  expect((await chips(page)).map(chip => chip.name)).toEqual(['movie.mp4']);

  const upload = heldRoute();
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/uploads?*`, upload.hold);
  await page.locator('#promptInput').press('Enter');
  const held = await upload.received;
  await expect(page.locator('#attachmentStrip .attachment-chip.uploading progress')).toHaveCount(1);
  // A second send waits for the upload instead of overtaking it.
  await page.locator('#promptInput').fill('second');
  await page.evaluate(() => fixtureApp.features.composerSubmit.sendPrompt());
  await expect(page.locator('#status')).toContainText('Wait for the attachments to finish uploading');
  await held.continue();

  await expect.poll(() => sentPrompts(fleet.peer).length).toBe(1);
  const [movie] = attachedPaths(fleet.peer);
  expect(sentPrompts(fleet.peer)[0]!.message).toBe(`[File #1: movie.mp4]\n\n[File #1] [Attached file: ${movie} (video/mp4, 2.0 KB)]`);
  expect(fs.statSync(movie!).size).toBe(2048);
  expect(sentPrompts(fleet.self)).toEqual([]);
  await expect(page.locator('#attachmentStrip')).toBeHidden();
});

test('dropped and pasted files attach to the composer', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    const dropped = new DataTransfer();
    dropped.items.add(new File(['a,b\n1,2\n'], 'table.csv', { type: 'text/csv' }));
    fixtureElement(document.querySelector('.input-area'), '.input-area').dispatchEvent(new DragEvent('drop', { dataTransfer: dropped, bubbles: true, cancelable: true }));
    const pasted = new DataTransfer();
    pasted.items.add(new File(['PK'], 'bundle.zip', { type: 'application/zip' }));
    fixtureElement(document.getElementById('promptInput'), '#promptInput').dispatchEvent(new ClipboardEvent('paste', { clipboardData: pasted, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => chips(page)).toEqual([
    { name: 'table.csv', size: '8 B', icon: true },
    { name: 'bundle.zip', size: '2 B', icon: true },
  ]);
});

test('a file over the host limit is refused before upload and stays attached', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/uploads`, route => route.fulfill({ json: { maxBytes: 4 } }));
  await page.locator('#attachFileInput').setInputFiles([notes]);
  await page.locator('#promptInput').fill('too big');
  await page.locator('#promptInput').press('Enter');
  await expect(page.locator('#status')).toContainText('Upload failed: notes.txt is 11 B; this host accepts files up to 4 B (PI_DISH_UPLOAD_MAX_MB)');
  await expect(page.locator('#promptInput')).toHaveValue('too big');
  expect((await chips(page)).map(chip => chip.name)).toEqual(['notes.txt']);
  expect(sentPrompts(fleet.self)).toEqual([]);
  expect(fs.existsSync(path.join(fleet.self.home, '.pi/dish/uploads'))).toBe(false);
});

test('non-bot chats keep small animated/transparent GIF and WebP attachments byte-for-byte intact', async ({ page, fleet }) => {
  // Valid 2-frame GIF89a with transparent frame 1 and opaque white frame 2.
  const ANIMATED_GIF = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, // 1x1, 2-color GCT
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff, // black, white
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00,
    0x21, 0xf9, 0x04, 0x01, 0x0a, 0x00, 0x00, 0x00, // frame 1: transparent index 0
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, // frame 2: opaque
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x4c, 0x01, 0x00,
    0x3b,
  ]);
  const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
  await fleet.select(fleet.self);
  await page.locator('#attachFileInput').setInputFiles([
    { name: 'anim.gif', mimeType: 'image/gif', buffer: ANIMATED_GIF },
    { name: 'tiny.webp', mimeType: 'image/webp', buffer: WEBP },
    image,
  ]);
  await expect(page.locator('#attachmentStrip img')).toHaveCount(3);
  await page.locator('#promptInput').fill('Check normal chat images');
  await page.locator('#promptInput').press('Enter');
  await expect.poll(() => sentPrompts(fleet.self).length).toBe(1);
  const images = sentPrompts(fleet.self)[0]!.images as Array<{ type: string; mimeType: string; data: string }>;
  expect(images.map(img => img.mimeType)).toEqual(['image/gif', 'image/webp', 'image/png']);
  expect(images[0]!.data).toBe(ANIMATED_GIF.toString('base64'));
  expect(images[1]!.data).toBe(WEBP.toString('base64'));
  expect(images[2]!.data).toBe(PNG);
});

test('bot chats convert transparent GIF to PNG, opaque GIF/WebP to JPEG, pass PNG through, and refuse undecodable WebP/GIF', async ({ page, fleet }) => {
  const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const OPAQUE_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
  await fleet.select(fleet.self);
  await page.evaluate((id) => {
    window.fixtureSessionListPatch(id, { harnessId: 'bot' });
  }, ROOT);

  // Corrupt WebP on a bot destination must surface an error rather than passing raw WebP.
  await page.locator('#attachFileInput').setInputFiles([
    { name: 'broken.webp', mimeType: 'image/webp', buffer: Buffer.from('not-a-valid-webp') },
  ]);
  await expect(page.locator('#status')).toContainText('Could not attach broken.webp');
  await expect(page.locator('#attachmentStrip img')).toHaveCount(0);

  await page.locator('#attachFileInput').setInputFiles([
    { name: 'alpha.gif', mimeType: 'image/gif', buffer: TRANSPARENT_GIF },
    { name: 'opaque.gif', mimeType: 'image/gif', buffer: OPAQUE_GIF },
    { name: 'tiny.webp', mimeType: 'image/webp', buffer: WEBP },
    image,
  ]);
  await expect(page.locator('#attachmentStrip img')).toHaveCount(4);
  await page.locator('#promptInput').fill('Check bot images');
  await page.locator('#promptInput').press('Enter');
  await expect.poll(() => sentPrompts(fleet.self).length).toBe(1);
  const images = sentPrompts(fleet.self)[0]!.images as Array<{ type: string; mimeType: string; data: string }>;
  expect(images.map(img => img.mimeType)).toEqual(['image/png', 'image/jpeg', 'image/jpeg', 'image/png']);
  // Transparent GIF -> PNG (magic 89 50 4E 47).
  const pngBytes = Buffer.from(images[0]!.data, 'base64');
  expect(Array.from(pngBytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  // Opaque GIF and opaque WebP -> JPEG (SOI FF D8 FF).
  for (const jpeg of images.slice(1, 3)) {
    const bytes = Buffer.from(jpeg.data, 'base64');
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  }
  expect(images[3]!.data).toBe(PNG);
});

export {};
