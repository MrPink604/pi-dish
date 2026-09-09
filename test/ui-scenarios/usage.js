// Shared by the full smoke and a fresh --scenario usage run.
module.exports = async function usage({ desktop, check, SESSION_ID }) {
  // Usage view: the global usage overview as a main-pane takeover (sidebar
  // header bar-chart button). Range presets re-scope the sections, a bar
  // click opens that day's per-model detail, a session row jumps into the
  // session, and Escape closes the pane. Asserted on the all-time range so
  // the fixed fixture dates stay in-window whenever the smoke runs.
  console.log('usage view:');
  await desktop.click('[title="Usage and spend"]');
  await desktop.waitForSelector('.usage-kpis', { timeout: 5000 });
  check(await desktop.evaluate(() => document.querySelector('.main').classList.contains('usage-open')),
    'usage button opens the takeover pane');
  check(await desktop.evaluate(() => document.getElementById('sessionView').offsetParent === null),
    'session view hidden while usage is open');
  await desktop.click('[data-range="all"]');
  await desktop.waitForFunction(() =>
    [...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('smoke-model')),
    null, { timeout: 5000 });
  check(true, 'all-time range lists the fixture model with its share');
  // Token breakdowns: the totals line splits in/out with a cache rate
  // (fixture: 100 in, 45 out, 20 cacheRead over a 130-token prompt side =
  // 15% hit), and the model rows carry the compact per-row form.
  check(await desktop.evaluate(() => {
    const line = document.querySelector('.usage-token-line');
    return !!line && line.textContent.includes('100 in') && line.textContent.includes('45 out') &&
      line.textContent.includes('(15% hit)');
  }), 'range totals break down in/out tokens and the cache rate');
  check(await desktop.evaluate(() =>
    [...document.querySelectorAll('#usageViewBody .usage-row.model-toggle')]
      .some((r) => r.textContent.includes('100 in / 45 out') && r.textContent.includes('15% cached'))),
    'model rows carry in/out and cached-share breakdowns');
  check(await desktop.evaluate(() => {
    const value = document.querySelector('.usage-total-line strong')?.textContent || '';
    return value.startsWith('~$') && value.endsWith('*');
  }), 'mixed usage total shows its marked known subtotal');
  check(await desktop.evaluate(() =>
    [...document.querySelectorAll('#usageViewBody .usage-row.model-toggle')]
      .some((r) => r.textContent.includes('unpriced') && r.textContent.includes('*'))),
    'partially priced model rows show their subtotal and unpriced count');
  check(await desktop.evaluate(() =>
    document.querySelector('#usageViewBody .usage-notice')?.textContent
      .includes('Known priced usage only')),
    'usage notice explains the partial-estimate marker');
  await desktop.waitForSelector('#usageChart svg', { timeout: 5000 });
  check(await desktop.locator('#usageChart .usage-col').count() >= 2,
    'stacked daily chart renders one column per bucket');
  check(await desktop.locator('#usageChart text.tick').count() >= 4,
    'chart draws axis tick labels');
  check((await desktop.locator('#usageChart svg').getAttribute('aria-label')).startsWith('Estimated spend'),
    'a positive known subtotal keeps cost chart geometry');
  // Cost bucket pivot: the range totals break into read/cached/output/
  // cache-write, and the stack toggle re-pivots the chart itself.
  check(await desktop.evaluate(() => {
    const items = [...document.querySelectorAll('#usageViewBody .usage-section .usage-share-bar + .usage-legend .usage-legend-item')]
      .map(el => el.textContent);
    return ['Read', 'Cached read', 'Output', 'Cache write'].every(label =>
      items.some(text => text.includes(label) && text.includes('~$'))) &&
      items.some(text => text.includes('Unattributed') && text.includes('~$'));
  }), 'spend-by-bucket section prices all four cost buckets and preserves total-only remainder');
  check(await desktop.evaluate(() =>
    [...document.querySelectorAll('#usageViewBody .usage-kpi')]
      .some(k => (k.getAttribute('title') || '').includes('Cached read'))),
    'KPI tiles pivot their window spend into buckets on hover');
  check(await desktop.evaluate(() =>
    [...document.querySelectorAll('#usageViewBody .usage-row.model-toggle')]
      .some(r => (r.getAttribute('title') || '').includes('Cache write'))),
    'model rows carry their bucket breakdown in the tooltip');
  // Index refreshes replace the controls and chart wholesale. Wait until
  // that background work is done before exercising a click-driven pivot;
  // otherwise the assertion races a render from an older request.
  await desktop.waitForFunction(() => usageData && !usageData.indexing, null, { timeout: 10000 });
  await desktop.click('[data-stack="buckets"]');
  await desktop.waitForFunction(() =>
    [...document.querySelectorAll('#usageChart .usage-legend-item')].some(el => el.textContent === 'Cached read') &&
    [...document.querySelectorAll('#usageChart .usage-legend-item')].some(el => el.textContent === 'Unattributed') &&
    document.querySelector('#usageChart .seg.sother') !== null,
    null, { timeout: 5000 });
  check(await desktop.evaluate(() => localStorage.getItem('pi-dish-usage-stack') === 'buckets'),
    'bucket stacking re-pivots the chart and persists device-locally');
  await desktop.click('[data-stack="models"]');
  await desktop.waitForFunction(() =>
    [...document.querySelectorAll('#usageChart .usage-legend-item')].some(el => el.textContent.includes('smoke-model')),
    null, { timeout: 5000 });
  check(true, 'model stacking restores the per-model legend');
  // Event-driven: while the session index is still settling, the view
  // repolls at 1s and each re-render can shift the chart's day axis (the
  // 'all' range starts at the earliest *indexed* day), so a bucket index
  // captured mid-indexing goes stale by click time. Wait for indexing to
  // settle with the smoke model present, then resolve the index once.
  await desktop.waitForFunction(() =>
    usageData && !usageData.indexing &&
    usageChart.buckets.some(b => b.models?.some(m => m.ref === 'test/smoke-model')),
    null, { timeout: 10000 });
  const smokeBucket = await desktop.evaluate(() => usageChart.buckets.findIndex(b =>
    b.models?.some(m => m.ref === 'test/smoke-model')));
  await desktop.locator('#usageChart .usage-col').nth(smokeBucket).click();
  await desktop.waitForSelector('.usage-day-detail', { timeout: 2000 });
  check(await desktop.evaluate(() => document.querySelector('.usage-day-detail').textContent.includes('smoke-model')),
    "clicking a bar opens that day's per-model detail");
  check(await desktop.evaluate(() => document.querySelector('.usage-day-detail').textContent.includes('% hit')),
    'day detail includes the cache hit rate');
  // Sort toggle refetches with sort=tokens and re-renders the breakdowns.
  await desktop.click('.usage-sort [data-sort="tokens"]');
  await desktop.waitForFunction(() =>
    document.querySelector('.usage-sort [data-sort="tokens"]')?.classList.contains('active') &&
    [...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('smoke-model')),
    null, { timeout: 5000 });
  check(await desktop.evaluate(() => localStorage.getItem('pi-dish-usage-sort') === 'tokens'),
    'tokens sort activates and persists device-locally');
  await desktop.waitForFunction(() =>
    document.querySelector('#usageChart svg')?.getAttribute('aria-label')?.startsWith('Tokens'),
    null, { timeout: 5000 });
  check(true, 'tokens metric drives the daily chart, not just the tables');
  await desktop.click('.usage-sort [data-sort="cost"]');
  await desktop.waitForFunction(() =>
    document.querySelector('.usage-sort [data-sort="cost"]')?.classList.contains('active'),
    null, { timeout: 5000 });
  // Model filter: model rows are multi-select toggles; the filter is
  // applied server-side, so the workspace/session groups reflect it. The
  // beta session's calls index under unknown/unknown, so filtering to the
  // fixture's smoke-model must drop the beta workspace.
  check(await desktop.evaluate(() =>
    [...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('proj-beta'))),
    'unfiltered usage lists the beta workspace');
  await desktop.click('.usage-row.model-toggle[data-model-ref="test/smoke-model"]');
  await desktop.waitForFunction(() =>
    document.querySelector('.usage-filter-note')?.textContent.includes('smoke-model'),
    null, { timeout: 5000 });
  check(await desktop.evaluate(() =>
    ![...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('proj-beta'))),
    'model filter drops workspaces/sessions without that model');
  check(await desktop.evaluate(() => {
    const rows = [...document.querySelectorAll('#usageViewBody .usage-row.model-toggle')];
    return rows.some((r) => r.classList.contains('on') && r.textContent.includes('smoke-model')) &&
      rows.some((r) => r.classList.contains('off'));
  }), 'facet list keeps deselected models, dimmed');
  await desktop.click('#usageViewBody .usage-row.model-toggle.off');
  await desktop.waitForFunction(() =>
    [...document.querySelectorAll('#usageViewBody .usage-row')].some((r) => r.textContent.includes('proj-beta')),
    null, { timeout: 5000 });
  check(true, 'multi-select re-adds a second model and the beta workspace returns');
  await desktop.click('[data-clear-models]');
  await desktop.waitForFunction(() => !document.querySelector('.usage-filter-note'),
    null, { timeout: 5000 });
  check(true, 'clear removes the model filter');
  await desktop.click(`[data-session-id="${SESSION_ID}"]`);
  await desktop.waitForFunction(() => !document.querySelector('.main').classList.contains('usage-open'),
    null, { timeout: 2000 });
  check(await desktop.evaluate(() => document.getElementById('sessionView').offsetParent !== null),
    'session row closes the takeover and shows that session');
  await desktop.click('[title="Usage and spend"]');
  await desktop.waitForSelector('.usage-kpis', { timeout: 5000 });
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => !document.querySelector('.main').classList.contains('usage-open'),
    null, { timeout: 2000 });
  check(true, 'Escape closes the usage view');
};
