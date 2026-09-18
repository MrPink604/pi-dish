// Generated test/tool from test/browser/file-views.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
const preview = (path) => ({ path: '/fixture/' + path, relPath: path, content: 'contents of ' + path, size: 24, mtime: 4 });
const published = (token, root = '/fixture/a.txt') => ({ token, root, path: '/p/' + token, url: 'https://pages.example/' + token });
const diffData = (snapshotId = 'one') => ({ root: '/fixture', gitAvailable: true, snapshotId, repos: [{ path: 'repo', files: [{ path: 'a.txt', status: 'M', patchDeferred: true }] }] });
const patchText = '@@ -1 +1 @@\n-old\n+new';
async function fileRoutes(page) {
    await page.route('**/api/sessions/*/file?*', (route) => route.fulfill({ json: preview(new URL(route.request().url()).searchParams.get('path') ?? '') }));
}
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
