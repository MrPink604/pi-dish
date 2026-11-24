import type { Page, Route } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, ROOT, requiredRoute } from './fixtures.js';
const preview = (path: string) => ({ path: '/fixture/' + path, relPath: path, content: 'contents of ' + path, size: 24, mtime: 4 });
const published = (token: string, root = '/fixture/a.txt') => ({ token, root, path: '/p/' + token, url: 'https://pages.example/' + token });
const diffData = (snapshotId = 'one') => ({ root: '/fixture', gitAvailable: true, snapshotId, repos: [{ path: 'repo', files: [{ path: 'a.txt', status: 'M', patchDeferred: true }] }] });
const patchText = '@@ -1 +1 @@\n-old\n+new';
async function fileRoutes(page: Page) {
  await page.route('**/api/sessions/*/file?*', (route: Route) => route.fulfill({ json: preview(new URL(route.request().url()).searchParams.get('path') ?? '') }));
}

// A fixed, seekable VP8 clip: recording a canvas in headless Chromium can
// finish before it delivers any frames, leaving only a WebM header.
// ffmpeg -f lavfi -i color=c=blue:s=64x36:r=30:d=0.3 -an -c:v libvpx -threads 1 -fflags +bitexact -flags:v +bitexact demo.webm
const webmBytes = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAKJEU2bdLpNu4tTq4QVSalmU6yBoU27i1Or' +
  'hBZUrmtTrIHGTbuMU6uEElTDZ1OsggETTbuMU6uEHFO7a1OsggJz7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrX' +
  'sYMPQkBNgIRMYXZmV0GETGF2ZkSJiEBywAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCG' +
  'hVZfVlA4g4EBI+ODhAH8oFXgkLCBQLqBJJqBAlWwhFW5gQESVMNn0HNzzWPAi2PFiAAAAAAAAAABZ8iYRaOHRU5DT0RFUkSH' +
  'i0xhdmMgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4zMDAwMDAwMDAAH0O2dUEF54EAo8GBAACAUAMAnQEqQAAk' +
  'AABHCIWFiIWEiAICAnWqA/gCBwjVZ5mPN9IA/v9NEv/8WFfxYV/FhX/xYV/8/M7txfzmAKOWgQAhANEBAAUQrAAYABhYL/QA' +
  'CIwAAKOWgQBDANEBAAUQrAAYABhYL/QACIwAAKOWgQBkANEBAAUQrAAYABhYL/QACIwAAKOWgQCFANEBAAUQrAAYABhYL/QA' +
  'CIwAAKOWgQCnANEBAAUQrAAYABhYL/QACIwAAKOWgQDIANEBAAUQrAAYABhYL/QACIwAAKOVgQDpALEBAAUQEBRgAGFgv9AA' +
  'IjAAo5aBAQsA0QEABRCsABgAGFgv9AAIjAAAHFO7a5G7j7OBALeK94EB8YIBaPCBAw==',
  'base64',
);

test('late file response cannot replace a newer file or cross a same-id host selection', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); let held: Route | null | undefined;
  await page.route('**/api/sessions/*/file?*', route => {
    const name = new URL(route.request().url()).searchParams.get('path');
    if (name === 'old.txt') { held = route; return; }
    return route.fulfill({ json: preview(name ?? '') });
  });
  await page.evaluate(() => { window.oldFile = fixtureApp.features.fileViews.openFile('old.txt'); }); await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('new.txt')); await requiredRoute(held).fulfill({ json: preview('old.txt') }); await page.evaluate(() => window.oldFile);
  await expect(page.locator('#fileViewTitle')).toHaveText('new.txt');
  held = null; await page.evaluate(() => { window.oldFile = fixtureApp.features.fileViews.openFile('old.txt'); }); await expect.poll(() => !!held).toBe(true);
  await fleet.select(fleet.self); await requiredRoute(held).fulfill({ json: preview('old.txt') }); await page.evaluate(() => window.oldFile);
  await expect(page.locator('#sessionView')).not.toHaveClass(/file-open/);
});

test('publication lookup cannot overwrite a new publish and duplicate clicks dispatch once to the owning host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); await fileRoutes(page); let lookup: Route | undefined, publish: Route | undefined; const writes: unknown[] = [];
  await page.route('**/api/pages', route => {
    if (route.request().method() === 'GET') { lookup = route; return; }
    writes.push({ origin: new URL(route.request().url()).origin, body: route.request().postDataJSON() }); publish = route;
  });
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt')); await expect.poll(() => !!lookup).toBe(true);
  await page.locator('#fileViewPublish').click(); await page.evaluate(() => fixtureElement(document.getElementById('fileViewPublish'), "document.getElementById('fileViewPublish')").click());
  await expect.poll(() => writes.length).toBe(1); await requiredRoute(publish).fulfill({ json: published('new') });
  await expect(page.locator('#fileViewPage')).toContainText('/new'); await requiredRoute(lookup).fulfill({ json: [published('old')] });
  await expect(page.locator('#fileViewPage')).toContainText('/new');
  expect(writes[0]).toEqual({ origin: fleet.peer.base, body: { path: '/fixture/a.txt', sessionId: ROOT, title: 'a.txt', renderer: 'file' } });
});

test('failed publication restores existing row controls and unpublish HTTP errors keep the link', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await fileRoutes(page); let deletes = 0;
  await page.route('**/api/pages', route => route.fulfill(route.request().method() === 'POST' ? { status: 500, json: { error: 'publish unavailable' } } : { json: [published('old')] }));
  await page.route('**/api/pages/old', route => { deletes++; return route.fulfill({ status: 500, json: { error: 'revoke unavailable' } }); });
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt')); await expect(page.locator('#fileViewPage')).toContainText('/old');
  await page.locator('#fileViewPublish').click(); await expect(page.locator('#status')).toContainText('publish unavailable');
  await page.locator('#filePageRevoke').click(); await expect.poll(() => deletes).toBe(1);
  await expect(page.locator('#status')).toContainText('revoke unavailable'); await expect(page.locator('#fileViewPage')).toContainText('/old');
  await expect(page.locator('#filePageRevoke')).toBeEnabled();
});

test('retired page controls and clipboard completion cannot affect a reopened file', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await fileRoutes(page); let deletes = 0;
  await page.route('**/api/pages', route => route.fulfill({ json: [published('old')] }));
  await page.route('**/api/pages/old', route => { deletes++; return route.fulfill({ json: { revoked: true } }); });
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt')); await expect(page.locator('#filePageRevoke')).toBeVisible();
  await page.evaluate(() => {
    window.oldRevoke = document.getElementById('filePageRevoke'); window.oldLink = document.querySelector<HTMLElement>('#fileViewPage .stats-copy');
    window.copyCalls = []; navigator.clipboard.writeText = text => { window.copyCalls.push(text); return new Promise<void>(resolve => { window.finishCopy = resolve; }); };
    fixtureApp.features.fileViews.copy(fixtureElement(document.getElementById('fileViewCopy'), '#fileViewCopy'));
  });
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('b.txt'));
  await page.evaluate(async () => { fixtureElement(window.oldRevoke, 'old revoke').click(); fixtureElement(window.oldLink, 'old file link').click(); window.finishCopy(); await Promise.resolve(); });
  expect(deletes).toBe(0); expect(await page.evaluate(() => window.copyCalls)).toEqual(['contents of a.txt']);
  await expect(page.locator('#fileViewCopy')).toHaveText('⧉');
});

test('lazy patches reject retired rows and late responses after diff refresh', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); let held: Route | undefined, requests = 0;
  await page.route('**/api/sessions/*/diff', route => route.fulfill({ json: diffData() }));
  await page.route('**/api/sessions/*/diff/patch?*', route => { requests++; held = route; });
  await page.evaluate(() => fixtureApp.features.fileViews.openDiff());
  await page.evaluate(() => { window.oldDetails = document.querySelector<HTMLDetailsElement>('details.diff-file'); const details = fixtureElement(window.oldDetails, 'old diff details'); window.oldPatch = details.querySelector<HTMLElement>('.diff-patch'); window.patchPromise = fixtureApp.features.fileViews.loadPatch(details); });
  await expect.poll(() => !!held).toBe(true); await page.evaluate(() => fixtureApp.features.fileViews.loadDiff());
  await requiredRoute(held).fulfill({ json: { patch: patchText } }); await page.evaluate(() => window.patchPromise);
  expect(await page.evaluate(() => fixtureElement(window.oldPatch, 'old patch').textContent)).not.toContain('new');
  await page.evaluate(async () => { const details = fixtureElement(window.oldDetails, 'old diff details'); details.open = true; await fixtureApp.features.fileViews.loadPatch(details); });
  expect(requests).toBe(1); await expect(page.locator('#diffViewBody')).toContainText('Loading patch');
});

test('stale diff snapshot refreshes once and failed patch remains retryable', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let reads = 0, patches = 0;
  await page.route('**/api/sessions/*/diff', route => { reads++; return route.fulfill({ json: diffData(String(reads)) }); });
  await page.route('**/api/sessions/*/diff/patch?*', route => {
    patches++; return route.fulfill(patches === 1 ? { status: 409, json: { stale: true } } : patches === 2 ? { status: 500, json: { error: 'try again' } } : { json: { patch: patchText } });
  });
  await page.evaluate(() => fixtureApp.features.fileViews.openDiff()); await page.evaluate(() => fixtureApp.features.fileViews.loadPatch(fixtureDetails(document.querySelector('details.diff-file'), 'diff file')));
  expect(reads).toBe(2); await page.evaluate(() => fixtureApp.features.fileViews.loadPatch(fixtureDetails(document.querySelector('details.diff-file'), 'diff file')));
  await expect(page.locator('.diff-patch')).toContainText('try again');
  await page.evaluate(() => fixtureApp.features.fileViews.loadPatch(fixtureDetails(document.querySelector('details.diff-file'), 'diff file')));
  await expect(page.locator('.diff-patch')).toContainText('new'); expect(patches).toBe(3);
});

test('file view plays videos with speed/frame controls, shows codec fallback on error, and upgrades markdown video embeds', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);

  await page.route('**/api/sessions/*/file?*', route => {
    const reqPath = new URL(route.request().url()).searchParams.get('path') ?? '';
    if (reqPath === 'demo.webm') {
      return route.fulfill({
        json: {
          path: '/fixture/demo.webm', relPath: 'demo.webm', size: 2 * 1024 * 1024, mtime: 10,
          video: { url: `/api/sessions/${ROOT}/file/content?path=demo.webm&v=10-2097152`, mimeType: 'video/webm' },
        },
      });
    }
    if (reqPath === 'unsupported.mkv') {
      return route.fulfill({
        json: {
          path: '/fixture/unsupported.mkv', relPath: 'unsupported.mkv', size: 128, mtime: 12,
          video: { url: `/api/sessions/${ROOT}/file/content?path=unsupported.mkv&v=12-128`, mimeType: 'video/x-matroska' },
        },
      });
    }
    if (reqPath === 'notes.md') {
      return route.fulfill({
        json: {
          path: '/fixture/docs/notes.md', relPath: 'docs/notes.md', size: 64, mtime: 11, truncated: false,
          content: '# Notes\n\n![Walkthrough](../clips/demo.webm)\n',
        },
      });
    }
    return route.fulfill({ json: preview(reqPath) });
  });
  await page.route('**/api/sessions/*/file/content?*', route => {
    const reqPath = new URL(route.request().url()).searchParams.get('path') ?? '';
    if (reqPath.endsWith('unsupported.mkv')) {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes' },
        body: Buffer.from('not-a-real-codec-payload'),
      });
    }
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' },
      body: webmBytes,
    });
  });

  await page.evaluate(() => fixtureApp.features.fileViews.openFile('demo.webm'));
  const player = page.locator('#fileViewBody .file-view-video-player');
  const video = player.locator('video.file-view-video');
  await expect(player).toHaveCount(1);
  await expect(video).toHaveAttribute('preload', 'metadata');
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('playsinline', '');
  expect(await video.getAttribute('autoplay')).toBeNull();
  expect(await video.getAttribute('src')).toBe(`${fleet.peer.base}/api/sessions/${ROOT}/file/content?path=demo.webm&v=10-2097152`);
  await expect(page.locator('#fileViewPath')).toContainText('2.0 MB');
  await expect(player).toHaveAttribute('data-video-state', 'ready');
  await expect(player.locator('.video-meta')).toContainText('64×36');
  await expect(player.locator('.video-fallback')).toBeHidden();

  // Speed and frame-stepping controls update playbackRate and currentTime.
  await player.locator('.video-speed').selectOption('1.5');
  expect(await video.evaluate(node => (node as HTMLVideoElement).playbackRate)).toBe(1.5);
  for (const [button, targetTime] of [['.video-step-fwd', 1 / 30], ['.video-step-back', 0]] as const) {
    await player.locator(button).click();
    await expect.poll(() => video.evaluate(node => {
      const { currentTime, seeking } = node as HTMLVideoElement;
      return { currentTime, seeking };
    })).toEqual({ currentTime: expect.closeTo(targetTime, 2), seeking: false });
  }

  // Unsupported codec error reveals the fallback card with Open and Download links and hides <video>.
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('unsupported.mkv'));
  const badPlayer = page.locator('#fileViewBody .file-view-video-player');
  await expect(badPlayer.locator('.video-fallback')).toBeVisible();
  await expect(badPlayer.locator('video.file-view-video')).toBeHidden();
  await expect(badPlayer.locator('.video-fallback-open')).toHaveAttribute('href', `${fleet.peer.base}/api/sessions/${ROOT}/file/content?path=unsupported.mkv&v=12-128`);
  await expect(badPlayer.locator('.video-fallback-download')).toHaveAttribute('download', 'unsupported.mkv');
  await badPlayer.locator('.video-summary').click();
  await expect(badPlayer.locator('.video-summary')).toHaveAccessibleName('unsupported.mkv 128 B');
  await expect(badPlayer.locator('.video-fallback')).toBeHidden();
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('unsupported.mkv'));
  await expect(badPlayer.locator('details')).toHaveJSProperty('open', false);

  // Closing the viewer unloads the video cleanly.
  await page.evaluate(() => fixtureApp.features.fileViews.closeFile());
  await expect(page.locator('#fileViewBody video')).toHaveCount(0);

  // Opening a markdown file upgrades relative video image embeds to playable video elements.
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('notes.md'));
  const mdVideo = page.locator('#fileViewBody .msg-video-player video.msg-video');
  await expect(mdVideo).toHaveCount(1);
  expect(await mdVideo.getAttribute('src')).toBe(`${fleet.peer.base}/api/sessions/${ROOT}/file/content?path=${encodeURIComponent('/fixture/clips/demo.webm')}`);
  await expect(page.locator('#fileViewBody img')).toHaveCount(0);
  await page.locator('#fileViewBody .msg-video-player .video-summary').click();
  await expect(mdVideo).toBeHidden();
});

test('transcript video collapses at phone width, pauses, and stays collapsed when remounted', async ({ page, fleet }) => {
  await page.route('**/api/sessions/*/file/content?*', route => route.fulfill({ contentType: 'video/webm', body: webmBytes }));
  await page.route(`**/api/sessions/${ROOT}/messages?**`, route => route.fulfill({
    json: { messages: [{ role: 'assistant', index: 0, content: [
      { type: 'video', path: 'demo.webm' },
      { type: 'video', path: 'other.webm' },
    ] }], session: {} },
  }));
  await fleet.select(fleet.peer);
  await page.setViewportSize({ width: 390, height: 844 });

  const player = page.locator('#messages .msg-video-player').filter({ hasText: 'demo.webm' });
  const video = player.locator('video');
  const row = player.locator('.video-summary');
  const disclosure = player.locator('details');
  await expect(player).toHaveAttribute('data-video-state', 'ready');
  await expect(row).toHaveAccessibleName(/demo\.webm.*0:00/);
  const accessibility = await page.context().newCDPSession(page);
  const { root } = await accessibility.send('DOM.getDocument');
  const { nodeId } = await accessibility.send('DOM.querySelector', {
    nodeId: root.nodeId, selector: '#messages [data-video-file-path="demo.webm"] summary',
  });
  const expanded = async () => {
    const { nodes } = await accessibility.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    return nodes[0]?.properties?.find(property => property.name === 'expanded')?.value.value;
  };
  expect(await expanded()).toBe(true);
  const bounds = await row.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  const original = await video.elementHandle();
  // Loop the short fixture so a natural end can't masquerade as a pause.
  await video.evaluate(async node => {
    const clip = node as HTMLVideoElement;
    clip.loop = true;
    clip.muted = true;
    await clip.play();
  });
  expect(await video.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await row.click();
  expect(await expanded()).toBe(false);
  await accessibility.detach();
  await expect(row.locator('.video-icon')).toBeVisible();
  await expect(video).toBeHidden();
  await expect(player.locator('.video-toolbar')).toBeHidden();
  expect(await video.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  await expect(page.locator('#messages .msg-video-player').filter({ hasText: 'other.webm' }).locator('details')).toHaveJSProperty('open', true);

  await page.evaluate(() => fixtureApp.features.transcriptController.load());
  expect(await original?.evaluate(node => node.isConnected)).toBe(false);
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(row).toHaveAccessibleName(/demo\.webm.*0:00/);
  await expect(video).toBeHidden();

  await row.press('Enter');
  await expect(disclosure).toHaveJSProperty('open', true);
  await expect(video).toBeVisible();
  expect(await video.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);

  await row.press('Space');
  await expect(disclosure).toHaveJSProperty('open', false);
  await fleet.select(fleet.self);
  await expect(disclosure).toHaveJSProperty('open', true);
});

test('a standalone published video pauses on collapse without relaxing the sandbox', async ({ page, fleet, request }) => {
  const path = join(fleet.self.home, 'demo.webm');
  writeFileSync(path, webmBytes);
  const published = await request.post(`${fleet.self.base}/api/pages`, { data: { path, renderer: 'file' } });
  await expect(published).toBeOK();
  const { path: url } = await published.json() as { path: string };
  await page.goto(`${fleet.self.base}${url}`);
  const player = page.locator('.video-player');
  const row = player.locator('.video-summary');
  const video = player.locator('video');
  expect(await page.evaluate(() => self.origin)).toBe('null');
  await expect(row).toHaveAccessibleName(`demo.webm ${webmBytes.length} B`);
  await video.evaluate(async node => {
    const clip = node as HTMLVideoElement;
    clip.loop = true;
    clip.muted = true;
    await clip.play();
  });
  await row.press('Space');
  await expect(player.locator('details')).toHaveJSProperty('open', false);
  await expect(video).toBeHidden();
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  await row.press('Enter');
  await expect(video).toBeVisible();
  expect(await video.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
});

test('SVG previews render as images while sandbox CSP blocks scripts on direct navigation and published pages', async ({ page, fleet, request }) => {
  const svgMarkup = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">'
    + '<rect width="120" height="60" fill="#22c55e"/>'
    + '<script>window.__svgScriptRan = true;</script>'
    + '</svg>';

  // Upload into the session's own upload dir so /file and /file/content serve the real file.
  const uploaded = await request.post(
    `${fleet.self.base}/api/sessions/${ROOT}/uploads?name=diagram.svg&type=image%2Fsvg%2Bxml`,
    { headers: { 'content-type': 'application/octet-stream' }, data: Buffer.from(svgMarkup, 'utf8') },
  );
  await expect(uploaded).toBeOK();
  const { path: uploadedPath } = await uploaded.json() as { path: string };

  const contentUrl = `${fleet.self.base}/api/sessions/${ROOT}/file/content?path=${encodeURIComponent(uploadedPath)}`;
  const contentRes = await request.get(contentUrl);
  await expect(contentRes).toBeOK();
  expect(contentRes.headers()['content-type']).toBe('image/svg+xml');
  expect(contentRes.headers()['x-content-type-options']).toBe('nosniff');
  const fileCsp = contentRes.headers()['content-security-policy'] ?? '';
  expect(fileCsp).toContain("default-src 'none'");
  expect(fileCsp).toContain('sandbox');
  expect(fileCsp).not.toContain('allow-scripts');
  expect(fileCsp).not.toContain('allow-same-origin');

  // 1. Inside #fileView, Chromium renders the SVG inside <img> with naturalWidth > 0.
  await fleet.select(fleet.self);
  await page.evaluate((p) => fixtureApp.features.fileViews.openFile(p), uploadedPath);
  const img = page.locator('#fileViewBody img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate(el => {
    const image = el as HTMLImageElement;
    return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight };
  })).toEqual({ complete: true, width: 120, height: 60 });

  // 2. Opening the raw /file/content URL directly in a tab isolates the origin and blocks inline <script>.
  const rawTab = await page.context().newPage();
  await rawTab.goto(contentUrl);
  expect(await rawTab.evaluate(() => self.origin)).toBe('null');
  expect(await rawTab.evaluate(() => Reflect.get(globalThis, '__svgScriptRan'))).toBeUndefined();
  await rawTab.close();

  // 3. A standalone published SVG file page renders the <img> and serves ?content=1 with image/svg+xml + strict sandbox CSP.
  const pubFile = join(fleet.self.home, 'published-diagram.svg');
  writeFileSync(pubFile, svgMarkup);
  const publishedRes = await request.post(`${fleet.self.base}/api/pages`, { data: { path: pubFile, renderer: 'file' } });
  await expect(publishedRes).toBeOK();
  const { path: pubUrl } = await publishedRes.json() as { path: string };
  const pubContentRes = await request.get(`${fleet.self.base}${pubUrl}?content=1`);
  await expect(pubContentRes).toBeOK();
  expect(pubContentRes.headers()['content-type']).toBe('image/svg+xml');
  expect(pubContentRes.headers()['x-content-type-options']).toBe('nosniff');
  expect(pubContentRes.headers()['content-security-policy'] ?? '').toContain("default-src 'none'");

  await page.goto(`${fleet.self.base}${pubUrl}`);
  const pubImg = page.locator('img');
  await expect(pubImg).toBeVisible();
  await expect.poll(() => pubImg.evaluate(el => {
    const image = el as HTMLImageElement;
    return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight };
  })).toEqual({ complete: true, width: 120, height: 60 });
});

test('file view disposal retires publish, copy and diff patch actions', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await fileRoutes(page); let writes = 0;
  await page.route('**/api/pages', route => { if (route.request().method() === 'POST') writes++; return route.fulfill({ json: [] }); });
  await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt'));
  await page.evaluate(async () => { fixtureApp.features.fileViews.dispose(); await fixtureApp.features.fileViews.publish(); await fixtureApp.features.fileViews.openFile('a.txt'); await fixtureApp.features.fileViews.openDiff(); fixtureElement(document.getElementById('fileViewPublish'), "document.getElementById('fileViewPublish')").click(); });
  expect(writes).toBe(0); await expect(page.locator('#sessionView')).not.toHaveClass(/file-open|diff-open/);
});

export {};
