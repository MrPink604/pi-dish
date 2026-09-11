const { test, expect, ROOT } = require('./fixtures');
const preview = path => ({ path: '/fixture/' + path, relPath: path, content: 'contents of ' + path, size: 24, mtime: 4 });
const published = (token, root = '/fixture/a.txt') => ({ token, root, path: '/p/' + token, url: 'https://pages.example/' + token });
const diffData = (snapshotId = 'one') => ({ root: '/fixture', gitAvailable: true, snapshotId, repos: [{ path: 'repo', files: [{ path: 'a.txt', status: 'M', patchDeferred: true }] }] });
const patchText = '@@ -1 +1 @@\n-old\n+new';
async function fileRoutes(page) {
  await page.route('**/api/sessions/*/file?*', route => route.fulfill({ json: preview(new URL(route.request().url()).searchParams.get('path')) }));
}

test('late file response cannot replace a newer file or cross a same-id host selection', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); let held;
  await page.route('**/api/sessions/*/file?*', route => {
    const name = new URL(route.request().url()).searchParams.get('path');
    if (name === 'old.txt') { held = route; return; }
    return route.fulfill({ json: preview(name) });
  });
  await page.evaluate(() => { window.oldFile = openFileViewer('old.txt'); }); await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => openFileViewer('new.txt')); await held.fulfill({ json: preview('old.txt') }); await page.evaluate(() => window.oldFile);
  await expect(page.locator('#fileViewTitle')).toHaveText('new.txt');
  held = null; await page.evaluate(() => { window.oldFile = openFileViewer('old.txt'); }); await expect.poll(() => !!held).toBe(true);
  await fleet.select(fleet.self); await held.fulfill({ json: preview('old.txt') }); await page.evaluate(() => window.oldFile);
  await expect(page.locator('#sessionView')).not.toHaveClass(/file-open/);
});

test('publication lookup cannot overwrite a new publish and duplicate clicks dispatch once to the owning host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); await fileRoutes(page); let lookup, publish; const writes = [];
  await page.route('**/api/pages', route => {
    if (route.request().method() === 'GET') { lookup = route; return; }
    writes.push({ origin: new URL(route.request().url()).origin, body: route.request().postDataJSON() }); publish = route;
  });
  await page.evaluate(() => openFileViewer('a.txt')); await expect.poll(() => !!lookup).toBe(true);
  await page.locator('#fileViewPublish').click(); await page.evaluate(() => document.getElementById('fileViewPublish').click());
  await expect.poll(() => writes.length).toBe(1); await publish.fulfill({ json: published('new') });
  await expect(page.locator('#fileViewPage')).toContainText('/new'); await lookup.fulfill({ json: [published('old')] });
  await expect(page.locator('#fileViewPage')).toContainText('/new');
  expect(writes[0]).toEqual({ origin: fleet.peer.base, body: { path: '/fixture/a.txt', sessionId: ROOT, title: 'a.txt', renderer: 'file' } });
});

test('failed publication restores existing row controls and unpublish HTTP errors keep the link', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await fileRoutes(page); let deletes = 0;
  await page.route('**/api/pages', route => route.fulfill(route.request().method() === 'POST' ? { status: 500, json: { error: 'publish unavailable' } } : { json: [published('old')] }));
  await page.route('**/api/pages/old', route => { deletes++; return route.fulfill({ status: 500, json: { error: 'revoke unavailable' } }); });
  await page.evaluate(() => openFileViewer('a.txt')); await expect(page.locator('#fileViewPage')).toContainText('/old');
  await page.locator('#fileViewPublish').click(); await expect(page.locator('#status')).toContainText('publish unavailable');
  await page.locator('#filePageRevoke').click(); await expect.poll(() => deletes).toBe(1);
  await expect(page.locator('#status')).toContainText('revoke unavailable'); await expect(page.locator('#fileViewPage')).toContainText('/old');
  await expect(page.locator('#filePageRevoke')).toBeEnabled();
});

test('retired page controls and clipboard completion cannot affect a reopened file', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await fileRoutes(page); let deletes = 0;
  await page.route('**/api/pages', route => route.fulfill({ json: [published('old')] }));
  await page.route('**/api/pages/old', route => { deletes++; return route.fulfill({ json: { revoked: true } }); });
  await page.evaluate(() => openFileViewer('a.txt')); await expect(page.locator('#filePageRevoke')).toBeVisible();
  await page.evaluate(() => {
    window.oldRevoke = document.getElementById('filePageRevoke'); window.oldLink = document.querySelector('#fileViewPage .stats-copy');
    window.copyCalls = []; copyTextToClipboard = text => { window.copyCalls.push(text); return new Promise(resolve => { window.finishCopy = resolve; }); };
    copyFileViewContent(document.getElementById('fileViewCopy'));
  });
  await page.evaluate(() => openFileViewer('b.txt'));
  await page.evaluate(async () => { window.oldRevoke.click(); window.oldLink.click(); window.finishCopy(); await Promise.resolve(); });
  expect(deletes).toBe(0); expect(await page.evaluate(() => window.copyCalls)).toEqual(['contents of a.txt']);
  await expect(page.locator('#fileViewCopy')).toHaveText('⧉');
});

test('lazy patches reject retired rows and late responses after diff refresh', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); let held, requests = 0;
  await page.route('**/api/sessions/*/diff', route => route.fulfill({ json: diffData() }));
  await page.route('**/api/sessions/*/diff/patch?*', route => { requests++; held = route; });
  await page.evaluate(() => openDiffView());
  await page.evaluate(() => { window.oldDetails = document.querySelector('details.diff-file'); window.oldPatch = window.oldDetails.querySelector('.diff-patch'); window.patchPromise = loadDeferredDiffPatch(window.oldDetails); });
  await expect.poll(() => !!held).toBe(true); await page.evaluate(() => loadDiffView());
  await held.fulfill({ json: { patch: patchText } }); await page.evaluate(() => window.patchPromise);
  expect(await page.evaluate(() => window.oldPatch.textContent)).not.toContain('new');
  await page.evaluate(async () => { window.oldDetails.open = true; await loadDeferredDiffPatch(window.oldDetails); });
  expect(requests).toBe(1); await expect(page.locator('#diffViewBody')).toContainText('Loading patch');
});

test('stale diff snapshot refreshes once and failed patch remains retryable', async ({ page, fleet }) => {
  await fleet.select(fleet.self); let reads = 0, patches = 0;
  await page.route('**/api/sessions/*/diff', route => { reads++; return route.fulfill({ json: diffData(String(reads)) }); });
  await page.route('**/api/sessions/*/diff/patch?*', route => {
    patches++; return route.fulfill(patches === 1 ? { status: 409, json: { stale: true } } : patches === 2 ? { status: 500, json: { error: 'try again' } } : { json: { patch: patchText } });
  });
  await page.evaluate(() => openDiffView()); await page.evaluate(() => loadDeferredDiffPatch(document.querySelector('details.diff-file')));
  expect(reads).toBe(2); await page.evaluate(() => loadDeferredDiffPatch(document.querySelector('details.diff-file')));
  await expect(page.locator('.diff-patch')).toContainText('try again');
  await page.evaluate(() => loadDeferredDiffPatch(document.querySelector('details.diff-file')));
  await expect(page.locator('.diff-patch')).toContainText('new'); expect(patches).toBe(3);
});

test('file view disposal retires publish, copy and diff patch actions', async ({ page, fleet }) => {
  await fleet.select(fleet.self); await fileRoutes(page); let writes = 0;
  await page.route('**/api/pages', route => { if (route.request().method() === 'POST') writes++; return route.fulfill({ json: [] }); });
  await page.evaluate(() => openFileViewer('a.txt'));
  await page.evaluate(async () => { fileViews.dispose(); await publishFileView(); await openFileViewer('a.txt'); await openDiffView(); document.getElementById('fileViewPublish').click(); });
  expect(writes).toBe(0); await expect(page.locator('#sessionView')).not.toHaveClass(/file-open|diff-open/);
});
