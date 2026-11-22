// Generated test/tool from test/browser/file-views.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const fixtures_js_1 = require("./fixtures.js");
const preview = (path) => ({ path: '/fixture/' + path, relPath: path, content: 'contents of ' + path, size: 24, mtime: 4 });
const published = (token, root = '/fixture/a.txt') => ({ token, root, path: '/p/' + token, url: 'https://pages.example/' + token });
const diffData = (snapshotId = 'one') => ({ root: '/fixture', gitAvailable: true, snapshotId, repos: [{ path: 'repo', files: [{ path: 'a.txt', status: 'M', patchDeferred: true }] }] });
const patchText = '@@ -1 +1 @@\n-old\n+new';
async function fileRoutes(page) {
    await page.route('**/api/sessions/*/file?*', (route) => route.fulfill({ json: preview(new URL(route.request().url()).searchParams.get('path') ?? '') }));
}
// A fixed, seekable VP8 clip: recording a canvas in headless Chromium can
// finish before it delivers any frames, leaving only a WebM header.
// ffmpeg -f lavfi -i color=c=blue:s=64x36:r=30:d=0.3 -an -c:v libvpx -threads 1 -fflags +bitexact -flags:v +bitexact demo.webm
const webmBytes = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAKJEU2bdLpNu4tTq4QVSalmU6yBoU27i1Or' +
    'hBZUrmtTrIHGTbuMU6uEElTDZ1OsggETTbuMU6uEHFO7a1OsggJz7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrX' +
    'sYMPQkBNgIRMYXZmV0GETGF2ZkSJiEBywAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCG' +
    'hVZfVlA4g4EBI+ODhAH8oFXgkLCBQLqBJJqBAlWwhFW5gQESVMNn0HNzzWPAi2PFiAAAAAAAAAABZ8iYRaOHRU5DT0RFUkSH' +
    'i0xhdmMgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4zMDAwMDAwMDAAH0O2dUEF54EAo8GBAACAUAMAnQEqQAAk' +
    'AABHCIWFiIWEiAICAnWqA/gCBwjVZ5mPN9IA/v9NEv/8WFfxYV/FhX/xYV/8/M7txfzmAKOWgQAhANEBAAUQrAAYABhYL/QA' +
    'CIwAAKOWgQBDANEBAAUQrAAYABhYL/QACIwAAKOWgQBkANEBAAUQrAAYABhYL/QACIwAAKOWgQCFANEBAAUQrAAYABhYL/QA' +
    'CIwAAKOWgQCnANEBAAUQrAAYABhYL/QACIwAAKOWgQDIANEBAAUQrAAYABhYL/QACIwAAKOVgQDpALEBAAUQEBRgAGFgv9AA' +
    'IjAAo5aBAQsA0QEABRCsABgAGFgv9AAIjAAAHFO7a5G7j7OBALeK94EB8YIBaPCBAw==', 'base64');
(0, fixtures_js_1.test)('late file response cannot replace a newer file or cross a same-id host selection', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    let held;
    await page.route('**/api/sessions/*/file?*', route => {
        const name = new URL(route.request().url()).searchParams.get('path');
        if (name === 'old.txt') {
            held = route;
            return;
        }
        return route.fulfill({ json: preview(name ?? '') });
    });
    await page.evaluate(() => { window.oldFile = fixtureApp.features.fileViews.openFile('old.txt'); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('new.txt'));
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: preview('old.txt') });
    await page.evaluate(() => window.oldFile);
    await (0, fixtures_js_1.expect)(page.locator('#fileViewTitle')).toHaveText('new.txt');
    held = null;
    await page.evaluate(() => { window.oldFile = fixtureApp.features.fileViews.openFile('old.txt'); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: preview('old.txt') });
    await page.evaluate(() => window.oldFile);
    await (0, fixtures_js_1.expect)(page.locator('#sessionView')).not.toHaveClass(/file-open/);
});
(0, fixtures_js_1.test)('publication lookup cannot overwrite a new publish and duplicate clicks dispatch once to the owning host', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    await fileRoutes(page);
    let lookup, publish;
    const writes = [];
    await page.route('**/api/pages', route => {
        if (route.request().method() === 'GET') {
            lookup = route;
            return;
        }
        writes.push({ origin: new URL(route.request().url()).origin, body: route.request().postDataJSON() });
        publish = route;
    });
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt'));
    await fixtures_js_1.expect.poll(() => !!lookup).toBe(true);
    await page.locator('#fileViewPublish').click();
    await page.evaluate(() => fixtureElement(document.getElementById('fileViewPublish'), "document.getElementById('fileViewPublish')").click());
    await fixtures_js_1.expect.poll(() => writes.length).toBe(1);
    await (0, fixtures_js_1.requiredRoute)(publish).fulfill({ json: published('new') });
    await (0, fixtures_js_1.expect)(page.locator('#fileViewPage')).toContainText('/new');
    await (0, fixtures_js_1.requiredRoute)(lookup).fulfill({ json: [published('old')] });
    await (0, fixtures_js_1.expect)(page.locator('#fileViewPage')).toContainText('/new');
    (0, fixtures_js_1.expect)(writes[0]).toEqual({ origin: fleet.peer.base, body: { path: '/fixture/a.txt', sessionId: fixtures_js_1.ROOT, title: 'a.txt', renderer: 'file' } });
});
(0, fixtures_js_1.test)('failed publication restores existing row controls and unpublish HTTP errors keep the link', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await fileRoutes(page);
    let deletes = 0;
    await page.route('**/api/pages', route => route.fulfill(route.request().method() === 'POST' ? { status: 500, json: { error: 'publish unavailable' } } : { json: [published('old')] }));
    await page.route('**/api/pages/old', route => { deletes++; return route.fulfill({ status: 500, json: { error: 'revoke unavailable' } }); });
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt'));
    await (0, fixtures_js_1.expect)(page.locator('#fileViewPage')).toContainText('/old');
    await page.locator('#fileViewPublish').click();
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('publish unavailable');
    await page.locator('#filePageRevoke').click();
    await fixtures_js_1.expect.poll(() => deletes).toBe(1);
    await (0, fixtures_js_1.expect)(page.locator('#status')).toContainText('revoke unavailable');
    await (0, fixtures_js_1.expect)(page.locator('#fileViewPage')).toContainText('/old');
    await (0, fixtures_js_1.expect)(page.locator('#filePageRevoke')).toBeEnabled();
});
(0, fixtures_js_1.test)('retired page controls and clipboard completion cannot affect a reopened file', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await fileRoutes(page);
    let deletes = 0;
    await page.route('**/api/pages', route => route.fulfill({ json: [published('old')] }));
    await page.route('**/api/pages/old', route => { deletes++; return route.fulfill({ json: { revoked: true } }); });
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt'));
    await (0, fixtures_js_1.expect)(page.locator('#filePageRevoke')).toBeVisible();
    await page.evaluate(() => {
        window.oldRevoke = document.getElementById('filePageRevoke');
        window.oldLink = document.querySelector('#fileViewPage .stats-copy');
        window.copyCalls = [];
        navigator.clipboard.writeText = text => { window.copyCalls.push(text); return new Promise(resolve => { window.finishCopy = resolve; }); };
        fixtureApp.features.fileViews.copy(fixtureElement(document.getElementById('fileViewCopy'), '#fileViewCopy'));
    });
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('b.txt'));
    await page.evaluate(async () => { fixtureElement(window.oldRevoke, 'old revoke').click(); fixtureElement(window.oldLink, 'old file link').click(); window.finishCopy(); await Promise.resolve(); });
    (0, fixtures_js_1.expect)(deletes).toBe(0);
    (0, fixtures_js_1.expect)(await page.evaluate(() => window.copyCalls)).toEqual(['contents of a.txt']);
    await (0, fixtures_js_1.expect)(page.locator('#fileViewCopy')).toHaveText('⧉');
});
(0, fixtures_js_1.test)('lazy patches reject retired rows and late responses after diff refresh', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    let held, requests = 0;
    await page.route('**/api/sessions/*/diff', route => route.fulfill({ json: diffData() }));
    await page.route('**/api/sessions/*/diff/patch?*', route => { requests++; held = route; });
    await page.evaluate(() => fixtureApp.features.fileViews.openDiff());
    await page.evaluate(() => { window.oldDetails = document.querySelector('details.diff-file'); const details = fixtureElement(window.oldDetails, 'old diff details'); window.oldPatch = details.querySelector('.diff-patch'); window.patchPromise = fixtureApp.features.fileViews.loadPatch(details); });
    await fixtures_js_1.expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => fixtureApp.features.fileViews.loadDiff());
    await (0, fixtures_js_1.requiredRoute)(held).fulfill({ json: { patch: patchText } });
    await page.evaluate(() => window.patchPromise);
    (0, fixtures_js_1.expect)(await page.evaluate(() => fixtureElement(window.oldPatch, 'old patch').textContent)).not.toContain('new');
    await page.evaluate(async () => { const details = fixtureElement(window.oldDetails, 'old diff details'); details.open = true; await fixtureApp.features.fileViews.loadPatch(details); });
    (0, fixtures_js_1.expect)(requests).toBe(1);
    await (0, fixtures_js_1.expect)(page.locator('#diffViewBody')).toContainText('Loading patch');
});
(0, fixtures_js_1.test)('stale diff snapshot refreshes once and failed patch remains retryable', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    let reads = 0, patches = 0;
    await page.route('**/api/sessions/*/diff', route => { reads++; return route.fulfill({ json: diffData(String(reads)) }); });
    await page.route('**/api/sessions/*/diff/patch?*', route => {
        patches++;
        return route.fulfill(patches === 1 ? { status: 409, json: { stale: true } } : patches === 2 ? { status: 500, json: { error: 'try again' } } : { json: { patch: patchText } });
    });
    await page.evaluate(() => fixtureApp.features.fileViews.openDiff());
    await page.evaluate(() => fixtureApp.features.fileViews.loadPatch(fixtureDetails(document.querySelector('details.diff-file'), 'diff file')));
    (0, fixtures_js_1.expect)(reads).toBe(2);
    await page.evaluate(() => fixtureApp.features.fileViews.loadPatch(fixtureDetails(document.querySelector('details.diff-file'), 'diff file')));
    await (0, fixtures_js_1.expect)(page.locator('.diff-patch')).toContainText('try again');
    await page.evaluate(() => fixtureApp.features.fileViews.loadPatch(fixtureDetails(document.querySelector('details.diff-file'), 'diff file')));
    await (0, fixtures_js_1.expect)(page.locator('.diff-patch')).toContainText('new');
    (0, fixtures_js_1.expect)(patches).toBe(3);
});
(0, fixtures_js_1.test)('file view plays videos with speed/frame controls, shows codec fallback on error, and upgrades markdown video embeds', async ({ page, fleet }) => {
    await fleet.select(fleet.peer);
    await page.route('**/api/sessions/*/file?*', route => {
        const reqPath = new URL(route.request().url()).searchParams.get('path') ?? '';
        if (reqPath === 'demo.webm') {
            return route.fulfill({
                json: {
                    path: '/fixture/demo.webm', relPath: 'demo.webm', size: 2 * 1024 * 1024, mtime: 10,
                    video: { url: `/api/sessions/${fixtures_js_1.ROOT}/file/content?path=demo.webm&v=10-2097152`, mimeType: 'video/webm' },
                },
            });
        }
        if (reqPath === 'unsupported.mkv') {
            return route.fulfill({
                json: {
                    path: '/fixture/unsupported.mkv', relPath: 'unsupported.mkv', size: 128, mtime: 12,
                    video: { url: `/api/sessions/${fixtures_js_1.ROOT}/file/content?path=unsupported.mkv&v=12-128`, mimeType: 'video/x-matroska' },
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
    await (0, fixtures_js_1.expect)(player).toHaveCount(1);
    await (0, fixtures_js_1.expect)(video).toHaveAttribute('preload', 'metadata');
    await (0, fixtures_js_1.expect)(video).toHaveAttribute('controls', '');
    await (0, fixtures_js_1.expect)(video).toHaveAttribute('playsinline', '');
    (0, fixtures_js_1.expect)(await video.getAttribute('autoplay')).toBeNull();
    (0, fixtures_js_1.expect)(await video.getAttribute('src')).toBe(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/file/content?path=demo.webm&v=10-2097152`);
    await (0, fixtures_js_1.expect)(page.locator('#fileViewPath')).toContainText('2.0 MB');
    await (0, fixtures_js_1.expect)(player).toHaveAttribute('data-video-state', 'ready');
    await (0, fixtures_js_1.expect)(player.locator('.video-meta')).toContainText('64×36');
    await (0, fixtures_js_1.expect)(player.locator('.video-fallback')).toBeHidden();
    // Speed and frame-stepping controls update playbackRate and currentTime.
    await player.locator('.video-speed').selectOption('1.5');
    (0, fixtures_js_1.expect)(await video.evaluate(node => node.playbackRate)).toBe(1.5);
    for (const [button, targetTime] of [['.video-step-fwd', 1 / 30], ['.video-step-back', 0]]) {
        await player.locator(button).click();
        await fixtures_js_1.expect.poll(() => video.evaluate(node => {
            const { currentTime, seeking } = node;
            return { currentTime, seeking };
        })).toEqual({ currentTime: fixtures_js_1.expect.closeTo(targetTime, 2), seeking: false });
    }
    // Unsupported codec error reveals the fallback card with Open and Download links and hides <video>.
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('unsupported.mkv'));
    const badPlayer = page.locator('#fileViewBody .file-view-video-player');
    await (0, fixtures_js_1.expect)(badPlayer.locator('.video-fallback')).toBeVisible();
    await (0, fixtures_js_1.expect)(badPlayer.locator('video.file-view-video')).toBeHidden();
    await (0, fixtures_js_1.expect)(badPlayer.locator('.video-fallback-open')).toHaveAttribute('href', `${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/file/content?path=unsupported.mkv&v=12-128`);
    await (0, fixtures_js_1.expect)(badPlayer.locator('.video-fallback-download')).toHaveAttribute('download', 'unsupported.mkv');
    await badPlayer.locator('.video-summary').click();
    await (0, fixtures_js_1.expect)(badPlayer.locator('.video-summary')).toHaveAccessibleName('unsupported.mkv 128 B');
    await (0, fixtures_js_1.expect)(badPlayer.locator('.video-fallback')).toBeHidden();
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('unsupported.mkv'));
    await (0, fixtures_js_1.expect)(badPlayer.locator('details')).toHaveJSProperty('open', false);
    // Closing the viewer unloads the video cleanly.
    await page.evaluate(() => fixtureApp.features.fileViews.closeFile());
    await (0, fixtures_js_1.expect)(page.locator('#fileViewBody video')).toHaveCount(0);
    // Opening a markdown file upgrades relative video image embeds to playable video elements.
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('notes.md'));
    const mdVideo = page.locator('#fileViewBody .msg-video-player video.msg-video');
    await (0, fixtures_js_1.expect)(mdVideo).toHaveCount(1);
    (0, fixtures_js_1.expect)(await mdVideo.getAttribute('src')).toBe(`${fleet.peer.base}/api/sessions/${fixtures_js_1.ROOT}/file/content?path=${encodeURIComponent('/fixture/clips/demo.webm')}`);
    await (0, fixtures_js_1.expect)(page.locator('#fileViewBody img')).toHaveCount(0);
    await page.locator('#fileViewBody .msg-video-player .video-summary').click();
    await (0, fixtures_js_1.expect)(mdVideo).toBeHidden();
});
(0, fixtures_js_1.test)('transcript video collapses at phone width, pauses, and stays collapsed when remounted', async ({ page, fleet }) => {
    await page.route('**/api/sessions/*/file/content?*', route => route.fulfill({ contentType: 'video/webm', body: webmBytes }));
    await page.route(`**/api/sessions/${fixtures_js_1.ROOT}/messages?**`, route => route.fulfill({
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
    await (0, fixtures_js_1.expect)(player).toHaveAttribute('data-video-state', 'ready');
    await (0, fixtures_js_1.expect)(row).toHaveAccessibleName(/demo\.webm.*0:00/);
    const accessibility = await page.context().newCDPSession(page);
    const { root } = await accessibility.send('DOM.getDocument');
    const { nodeId } = await accessibility.send('DOM.querySelector', {
        nodeId: root.nodeId, selector: '#messages [data-video-file-path="demo.webm"] summary',
    });
    const expanded = async () => {
        const { nodes } = await accessibility.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        return nodes[0]?.properties?.find(property => property.name === 'expanded')?.value.value;
    };
    (0, fixtures_js_1.expect)(await expanded()).toBe(true);
    const bounds = await row.boundingBox();
    (0, fixtures_js_1.expect)(bounds?.width).toBeGreaterThanOrEqual(44);
    (0, fixtures_js_1.expect)(bounds?.height).toBeGreaterThanOrEqual(44);
    const original = await video.elementHandle();
    // Loop the short fixture so a natural end can't masquerade as a pause.
    await video.evaluate(async (node) => {
        const clip = node;
        clip.loop = true;
        clip.muted = true;
        await clip.play();
    });
    (0, fixtures_js_1.expect)(await video.evaluate(node => node.paused)).toBe(false);
    await row.click();
    (0, fixtures_js_1.expect)(await expanded()).toBe(false);
    await accessibility.detach();
    await (0, fixtures_js_1.expect)(row.locator('.video-icon')).toBeVisible();
    await (0, fixtures_js_1.expect)(video).toBeHidden();
    await (0, fixtures_js_1.expect)(player.locator('.video-toolbar')).toBeHidden();
    (0, fixtures_js_1.expect)(await video.evaluate(node => node.paused)).toBe(true);
    await (0, fixtures_js_1.expect)(page.locator('#messages .msg-video-player').filter({ hasText: 'other.webm' }).locator('details')).toHaveJSProperty('open', true);
    await page.evaluate(() => fixtureApp.features.transcriptController.load());
    (0, fixtures_js_1.expect)(await original?.evaluate(node => node.isConnected)).toBe(false);
    await (0, fixtures_js_1.expect)(disclosure).toHaveJSProperty('open', false);
    await (0, fixtures_js_1.expect)(row).toHaveAccessibleName(/demo\.webm.*0:00/);
    await (0, fixtures_js_1.expect)(video).toBeHidden();
    await row.press('Enter');
    await (0, fixtures_js_1.expect)(disclosure).toHaveJSProperty('open', true);
    await (0, fixtures_js_1.expect)(video).toBeVisible();
    (0, fixtures_js_1.expect)(await video.evaluate(node => node.paused)).toBe(true);
    await row.press('Space');
    await (0, fixtures_js_1.expect)(disclosure).toHaveJSProperty('open', false);
    await fleet.select(fleet.self);
    await (0, fixtures_js_1.expect)(disclosure).toHaveJSProperty('open', true);
});
(0, fixtures_js_1.test)('a standalone published video pauses on collapse without relaxing the sandbox', async ({ page, fleet, request }) => {
    const path = (0, node_path_1.join)(fleet.self.home, 'demo.webm');
    (0, node_fs_1.writeFileSync)(path, webmBytes);
    const published = await request.post(`${fleet.self.base}/api/pages`, { data: { path, renderer: 'file' } });
    await (0, fixtures_js_1.expect)(published).toBeOK();
    const { path: url } = await published.json();
    await page.goto(`${fleet.self.base}${url}`);
    const player = page.locator('.video-player');
    const row = player.locator('.video-summary');
    const video = player.locator('video');
    (0, fixtures_js_1.expect)(await page.evaluate(() => self.origin)).toBe('null');
    await (0, fixtures_js_1.expect)(row).toHaveAccessibleName(`demo.webm ${webmBytes.length} B`);
    await video.evaluate(async (node) => {
        const clip = node;
        clip.loop = true;
        clip.muted = true;
        await clip.play();
    });
    await row.press('Space');
    await (0, fixtures_js_1.expect)(player.locator('details')).toHaveJSProperty('open', false);
    await (0, fixtures_js_1.expect)(video).toBeHidden();
    await fixtures_js_1.expect.poll(() => video.evaluate(node => node.paused)).toBe(true);
    await row.press('Enter');
    await (0, fixtures_js_1.expect)(video).toBeVisible();
    (0, fixtures_js_1.expect)(await video.evaluate(node => node.paused)).toBe(true);
});
(0, fixtures_js_1.test)('file view disposal retires publish, copy and diff patch actions', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await fileRoutes(page);
    let writes = 0;
    await page.route('**/api/pages', route => { if (route.request().method() === 'POST')
        writes++; return route.fulfill({ json: [] }); });
    await page.evaluate(() => fixtureApp.features.fileViews.openFile('a.txt'));
    await page.evaluate(async () => { fixtureApp.features.fileViews.dispose(); await fixtureApp.features.fileViews.publish(); await fixtureApp.features.fileViews.openFile('a.txt'); await fixtureApp.features.fileViews.openDiff(); fixtureElement(document.getElementById('fileViewPublish'), "document.getElementById('fileViewPublish')").click(); });
    (0, fixtures_js_1.expect)(writes).toBe(0);
    await (0, fixtures_js_1.expect)(page.locator('#sessionView')).not.toHaveClass(/file-open|diff-open/);
});
