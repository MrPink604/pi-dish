const { test, expect } = require('./fixtures');

async function holdBody(page, url) {
  await page.evaluate(url => {
    const original = Response.prototype.json;
    Response.prototype.json = async function() {
      const data = await original.call(this);
      if (this.url === url) {
        window.directoryBodyWaiting = true;
        await new Promise(resolve => { window.releaseDirectoryBody = resolve; });
      }
      return data;
    };
  }, url);
}
async function releaseBody(page) {
  await page.evaluate(async () => {
    window.releaseDirectoryBody();
    // Drain the resumed body reader and its publication callback before observing DOM.
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

test('known cwd responses stay with their host across picker changes', async ({ page, fleet }) => {
  const held = [];
  await page.route('**/api/cwds', route => held.push(route));
  await page.evaluate(() => {
    const original = loadKnownCwds;
    window.cwdLoads = [];
    loadKnownCwds = (...args) => { const work = original(...args); window.cwdLoads.push(work); return work; };
    openNewSessionView();
  });
  await expect.poll(() => held.length).toBe(1);
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await expect.poll(() => held.length).toBe(2);
  await held[1].fulfill({ json: [{ path: '/peer-only', short: '~/peer-only' }] });
  await page.evaluate(() => window.cwdLoads[1]);
  await held[0].fulfill({ json: [{ path: '/old-self', short: '~/old-self' }] });
  await page.evaluate(() => window.cwdLoads[0]);
  expect(await page.evaluate(() => directoryCatalog.current().map(row => row.short))).toEqual(['~/peer-only']);
});

test('typing retires an old directory body before the next debounce starts', async ({ page, fleet }) => {
  const oldUrl = `${fleet.self.base}/api/dirs?q=older`;
  let next;
  await holdBody(page, oldUrl);
  await page.route(oldUrl, route => route.fulfill({ json: [{ path: '/older', short: '~/older' }] }));
  await page.route(`${fleet.self.base}/api/dirs?q=newer`, route => { next = route; });
  await page.evaluate(() => openNewSessionView());
  await page.locator('#newSessionCwd').fill('older');
  await expect.poll(() => page.evaluate(() => window.directoryBodyWaiting)).toBe(true);
  const afterOldBody = await page.evaluate(async () => {
    const input = document.getElementById('newSessionCwd');
    input.value = 'newer';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.releaseDirectoryBody();
    await new Promise(resolve => setTimeout(resolve, 0));
    return document.getElementById('cwdDropdown').textContent;
  });
  expect(afterOldBody).not.toContain('~/older');
  await expect.poll(() => !!next).toBe(true);
  await next.fulfill({ json: [{ path: '/newer', short: '~/newer' }] });
  await expect(page.locator('#cwdDropdown .cwd-option')).toHaveText('~/newer');
});

test('leaving and returning to a host retires its old autocomplete body', async ({ page, fleet }) => {
  const url = `${fleet.self.base}/api/dirs?q=retired`;
  await holdBody(page, url);
  await page.route(url, route => route.fulfill({ json: [{ path: '/retired', short: '~/retired' }] }));
  await page.evaluate(() => openNewSessionView());
  await page.locator('#newSessionCwd').fill('retired');
  await expect.poll(() => page.evaluate(() => window.directoryBodyWaiting)).toBe(true);
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await page.selectOption('#nsHostSelect', fleet.self.hostId);
  await releaseBody(page);
  await expect(page.locator('#cwdDropdown')).toBeHidden();
  await expect(page.locator('#newSessionCwd')).toHaveValue('retired');
});

test('a retired directory tree cannot publish children or act on the current host', async ({ page, fleet }) => {
  const url = `${fleet.self.base}/api/dirs/children?path=~`;
  await holdBody(page, url);
  await page.route(url, route => route.fulfill({ json: { dirs: [{ path: '/retired', name: 'retired' }] } }));
  await page.route(`${fleet.peer.base}/api/dirs/children?path=~`, route => route.fulfill({ json: { dirs: [{ path: '/peer-dir', name: 'peer-dir' }] } }));
  await page.evaluate(() => openNewSessionView());
  await page.locator('#nsTree .ns-tree-chevron').first().click();
  await expect.poll(() => page.evaluate(() => window.directoryBodyWaiting)).toBe(true);
  await page.evaluate(() => { window.retiredTreeRow = document.querySelector('#nsTree .ns-tree-row'); });
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await page.locator('#nsTree .ns-tree-chevron').first().click();
  await expect(page.locator('#nsTree .ns-tree-name')).toHaveText(['~', 'peer-dir']);
  await releaseBody(page);
  await expect(page.locator('#nsTree .ns-tree-name')).toHaveText(['~', 'peer-dir']);
  await page.locator('#nsTree .ns-tree-row').filter({ hasText: 'peer-dir' }).click();
  await page.evaluate(() => window.retiredTreeRow.click());
  await expect(page.locator('#newSessionCwd')).toHaveValue('/peer-dir');
});

test('existing cwd suggestions remain navigable during debounce and Escape only closes the dropdown', async ({ page, fleet }) => {
  await page.route(`${fleet.self.base}/api/cwds`, route => route.fulfill({ json: [] }));
  await page.route(`${fleet.self.base}/api/dirs?q=shown`, route => route.fulfill({ json: [{ path: '/shown', short: '~/shown' }] }));
  let pending;
  await page.route(`${fleet.self.base}/api/dirs?q=pending`, route => { pending = route; });
  await page.evaluate(() => openNewSessionView());
  const input = page.locator('#newSessionCwd');
  await input.fill('shown');
  await expect(page.locator('#cwdDropdown .cwd-option')).toHaveText('~/shown');
  await input.fill('pending');
  await expect(page.locator('#cwdDropdown')).toBeVisible();
  await input.press('ArrowDown');
  await expect(page.locator('#cwdDropdown .cwd-option')).toHaveClass(/active/);
  await input.press('Escape');
  await expect(page.locator('#cwdDropdown')).toBeHidden();
  await expect(page.locator('.main')).toHaveClass(/new-session-open/);
  if (pending) await pending.fulfill({ json: [] });
});

test('visible cwd paths can still be picked while a replacement query is pending', async ({ page, fleet }) => {
  await page.route(`${fleet.self.base}/api/cwds`, route => route.fulfill({ json: [] }));
  await page.route('**/api/dirs?q=*', route => route.fulfill({ json: [{ path: '/shown', short: '~/shown' }] }));
  await page.evaluate(() => openNewSessionView());
  const input = page.locator('#newSessionCwd');
  await input.fill('shown');
  await expect(page.locator('#cwdDropdown .cwd-option')).toHaveText('~/shown');
  await page.evaluate(() => {
    const input = document.getElementById('newSessionCwd');
    input.value = 'pending';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const row = document.querySelector('#cwdDropdown .cwd-option');
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await expect(input).toHaveValue('~/shown');
  await expect(page.locator('#cwdDropdown')).toBeHidden();
});

test('catalog edits renew an open directory tree with the current host token', async ({ page, fleet }) => {
  const auth = [], cwds = [];
  await page.route(`${fleet.peer.base}/api/dirs/children?path=~`, route => {
    auth.push(route.request().headers().authorization);
    return route.fulfill({ json: { dirs: [{ path: '/peer', name: 'peer' }] } });
  });
  await page.route(`${fleet.peer.base}/api/cwds`, route => {
    cwds.push(route.request().headers().authorization);
    return route.fulfill({ json: [{ path: '/peer', short: '~/peer' }] });
  });
  await page.evaluate(() => openNewSessionView());
  await page.selectOption('#nsHostSelect', fleet.peer.hostId);
  await page.locator('#nsTree .ns-tree-chevron').first().click();
  await expect(page.locator('#nsTree .ns-tree-name')).toHaveText(['~', 'peer']);
  await page.evaluate(id => {
    hostDirectory.setToken(id, 'rotated-fixture');
    saveHostCatalog();
  }, fleet.peer.hostId);
  await expect(page.locator('#nsTree .ns-tree-name')).toHaveText(['~']);
  await page.locator('#nsTree .ns-tree-chevron').first().click();
  await expect(page.locator('#nsTree .ns-tree-name')).toHaveText(['~', 'peer']);
  expect(auth.at(-1)).toBe('Bearer rotated-fixture');
  await expect.poll(() => cwds.at(-1)).toBe('Bearer rotated-fixture');
});

test('learning self identity renews directories opened before startup discovery completes', async ({ page, fleet }) => {
  let identity;
  await page.route(`${fleet.self.base}/api/host`, route => { identity = route; });
  await page.route(`${fleet.self.base}/api/dirs/children?path=~`, route => route.fulfill({ json: { dirs: [{ path: '/early', name: 'early' }] } }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => !!identity).toBe(true);
  await page.evaluate(() => openNewSessionView());
  await page.locator('#nsTree .ns-tree-chevron').first().click();
  await expect(page.locator('#nsTree .ns-tree-name')).toHaveText(['~', 'early']);
  await identity.fulfill({ json: { hostId: fleet.self.hostId, label: 'self' } });
  await expect(page.locator('#nsTree .ns-tree-name')).toHaveText(['~']);
  await page.locator('#nsTree .ns-tree-chevron').first().click();
  await expect(page.locator('#nsTree .ns-tree-name')).toHaveText(['~', 'early']);
  await page.locator('#nsTree .ns-tree-row').filter({ hasText: 'early' }).click();
  await expect(page.locator('#newSessionCwd')).toHaveValue('/early');
});
