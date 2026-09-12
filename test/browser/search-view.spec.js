const { test, expect, ROOT } = require('./fixtures');
const payload = name => ({ results: [{ id: ROOT, name, model: 'fixture/model', cwd: '/fixture/project', snippets: [name], matchCount: 0, searchScore: 5 }], total: 1 });

test('search facets and result cards retire on replacement while live cards retain their host', async ({ page, fleet }) => {
  await page.route('**/api/search?*', route => route.fulfill({ json: payload(new URL(route.request().url()).searchParams.get('q')) }));
  await fleet.select(fleet.peer);
  await page.evaluate(() => fixtureApp.features.searchViewController.open('first'));
  await expect(page.locator('.search-result')).toHaveCount(2);
  await page.evaluate(host => {
    window.retiredSearchCard = document.querySelector(`.search-result[data-host="${host}"]`);
    window.retiredSearchFacet = document.getElementById('searchFacetActive');
  }, fleet.self.hostId);
  await page.fill('#searchViewInput', 'second');
  await page.press('#searchViewInput', 'Enter');
  await expect(page.locator('.search-result-name').first()).toHaveText('second');
  await expect(page.locator('.search-result')).toHaveCount(2);
  await page.evaluate(() => { window.retiredSearchCard.click(); window.retiredSearchFacet.click(); });
  await expect(page.locator('.main')).toHaveClass(/search-open/);
  await expect(page.locator('#searchViewInput')).toHaveValue('second');
  await expect(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);
  await page.locator(`.search-result[data-host="${fleet.self.hostId}"]`).click();
  await expect(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
});

test('query typing retires old failures before the next debounce runs', async ({ page, fleet }) => {
  await page.clock.install();
  const held = [];
  await page.route('**/api/search?*', route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'old') held.push(route);
    else return route.fulfill({ json: payload('new result') });
  });
  await page.evaluate(() => fixtureApp.features.searchViewController.open('old'));
  await expect.poll(() => held.length).toBe(2);
  await page.fill('#searchViewInput', 'new');
  for (const route of held) await route.fulfill({ status: 500, json: { error: 'old request failed' } });
  await expect(page.locator('#searchViewBody')).not.toContainText('old request failed');
  await page.clock.runFor(350);
  // The injected failure puts the peer in backoff; the self host still answers.
  await expect(page.locator('.search-result')).not.toHaveCount(0);
  await expect(page.locator('.search-result-name').first()).toHaveText('new result');
});

test('search disposal retires indexing, input listeners and retained facets', async ({ page, fleet }) => {
  await page.clock.install();
  let reads = 0;
  await page.route('**/api/search?*', route => { reads++; return route.fulfill({ json: { ...payload('indexed'), indexing: true } }); });
  await page.evaluate(() => fixtureApp.features.searchViewController.open('indexed'));
  await expect(page.locator('.search-result')).toHaveCount(2);
  await page.evaluate(() => {
    window.retiredFacet = document.getElementById('searchFacetActive');
    fixtureApp.features.searchViewController.dispose();
    window.retiredFacet.click();
    const input = document.getElementById('searchViewInput'); input.value = 'later'; input.dispatchEvent(new Event('input'));
  });
  const before = reads;
  await page.clock.runFor(2000);
  expect(reads).toBe(before);
  await expect(page.locator('.main')).not.toHaveClass(/search-open/);
});
