import type { Route } from '@playwright/test';
import { test, expect, ROOT } from './fixtures.js';

test('a retired peer poll cannot mark the host blocked after a newer poll succeeds', async ({ page, fleet }) => {
  let releaseOld: ((route: Route) => void) | undefined;
  const oldRequested = new Promise<Route>(resolve => { releaseOld = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions?**`, route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'old-poll') {
      if (!releaseOld) throw new Error('Old poll resolver not initialized');
      releaseOld(route); return;
    }
    if (query === 'new-poll') return route.fulfill({ json: {
      active: [], previous: [{ id: ROOT, name: 'new peer result', harnessId: 'pi' }],
    } });
    return route.continue();
  });
  await page.evaluate(() => { window.__oldHostPoll = fixtureApp.features.sidebarLists.load('old-poll', { withPrevious: true }); });
  const oldRoute = await oldRequested;
  await page.evaluate(() => fixtureApp.features.sidebarLists.load('new-poll', { withPrevious: true }));
  await expect(fleet.row(fleet.peer)).toContainText('new peer result');
  await oldRoute.fulfill({ status: 401, json: { error: 'retired request' } });
  await page.evaluate(() => window.__oldHostPoll);
  expect(await page.evaluate(id => fixtureApp.features.hostConnections.stateOf(fixtureApp.ports.appModels.host(id)), fleet.peer.hostId)).toBe('reachable');
  expect(await page.evaluate(() => fixtureApp.features.sidebarLists.queriedFor)).toBe('new-poll');
  await expect(fleet.row(fleet.peer)).toContainText('new peer result');
});

test('saved peer restoration does not wait for a slow local list', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  const held: Route[] = [];
  await page.route(`${fleet.self.base}/api/sessions?**`, route => { held.push(route); });
  try {
    await page.reload();
    await expect(page.locator('#messages')).toContainText('peer root transcript');
  } finally {
    await page.unroute(`${fleet.self.base}/api/sessions?**`);
    await Promise.all(held.map(route => route.continue().catch(() => {})));
  }
});

test('startup restores the local saved transcript while peer identity and lists are held', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const held: Route[] = [];
  await page.route(`${fleet.peer.base}/api/host`, route => { held.push(route); });
  await page.route(`${fleet.peer.base}/api/sessions?**`, route => { held.push(route); });
  try {
    await page.reload();
    await expect(page.locator('#messages')).toContainText('self root transcript');
    expect(held.length).toBeGreaterThan(0);
  } finally {
    await page.unroute(`${fleet.peer.base}/api/host`);
    await page.unroute(`${fleet.peer.base}/api/sessions?**`);
    await Promise.all(held.map(route => route.continue().catch(() => {})));
  }
});

test('healthy search results finish locally while the pending peer stays identified', async ({ page, fleet }) => {
  let release: ((route: Route) => void) | undefined;
  const held = new Promise<Route>(resolve => { release = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions?**`, route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'root') { release?.(route); return; }
    return route.continue();
  });
  await page.locator('#filterInput').fill('root');
  const peerRequest = await held;
  try {
    await expect(fleet.row(fleet.self)).toBeVisible();
    await expect(page.locator('.sidebar-filter')).not.toHaveClass(/\bsearching\b/);
    await expect(page.locator('.sidebar-host-progress')).toContainText('peer');
    const listTop = await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top);
    // A periodic refresh joins the pending search without retiring its progress.
    await page.evaluate(() => { void fixtureApp.features.sidebarLists.refresh(); });
    await expect(page.locator('.sidebar-host-progress')).toContainText('peer');
    await peerRequest.fulfill({ json: { active: [], previous: [{ id: ROOT, name: 'late peer root', harnessId: 'pi' }] } });
    await expect(fleet.row(fleet.peer)).toContainText('late peer root');
    await expect(page.locator('.sidebar-host-progress')).toBeHidden();
    expect(await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top)).toBe(listTop);
  } finally {
    await page.unroute(`${fleet.peer.base}/api/sessions?**`);
    await peerRequest.abort().catch(() => {});
  }
});

test('background polling leaves cached rows and sidebar geometry undisturbed', async ({ page, fleet }) => {
  await expect(page.locator('.sidebar-host-progress')).toBeHidden();
  const listTop = await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top);
  const selfRow = await fleet.row(fleet.self).elementHandle();
  let release: ((route: Route) => void) | undefined;
  const held = new Promise<Route>(resolve => { release = resolve; });
  await page.route(`${fleet.peer.base}/api/sessions?**`, route => { release?.(route); });
  await page.evaluate(() => { void fixtureApp.features.sidebarLists.refresh(); });
  const peerRequest = await held;
  try {
    await expect(page.locator('.sidebar-host-progress')).toBeHidden();
    await expect(fleet.row(fleet.self)).toBeVisible();
    await expect(fleet.row(fleet.peer)).toBeVisible();
    expect(await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top)).toBe(listTop);
    await peerRequest.fulfill({ json: { active: [], previous: [{ id: ROOT, name: 'refreshed peer root', harnessId: 'pi' }] } });
    await expect(fleet.row(fleet.peer)).toContainText('refreshed peer root');
    await expect(page.locator('.sidebar-host-progress')).toBeHidden();
    expect(await page.locator('#sessionList').evaluate(node => node.getBoundingClientRect().top)).toBe(listTop);
    expect(await selfRow?.evaluate(node => node.isConnected)).toBe(true);
  } finally {
    await page.unroute(`${fleet.peer.base}/api/sessions?**`);
    await peerRequest.abort().catch(() => {});
    await selfRow?.dispose();
  }
});

test('an unchanged poll repaints nothing in the session list', async ({ page, fleet }) => {
  await expect(fleet.row(fleet.self)).toBeVisible();
  const mutations = await page.evaluate(async () => {
    const list = document.getElementById('sessionList');
    if (!list) throw new Error('Missing session list');
    const refresh = async () => {
      await fixtureApp.features.sidebarLists.refresh();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    };
    await refresh(); // settle indexing and host health so the observed poll is a true repeat
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(list, { childList: true, subtree: true, characterData: true, attributes: true });
    await refresh();
    observer.disconnect();
    return count;
  });
  expect(mutations).toBe(0);
});

test('background polling stops while the document is hidden and resumes on return', async ({ page, fleet }) => {
  // Speed the 10s sidebar poll up so the pause/resume is observable without a
  // real wait; no other timer in the app runs on that period.
  await page.addInitScript(() => {
    const realSetInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      realSetInterval(handler, timeout === 10000 ? 200 : timeout, ...args)) as typeof window.setInterval;
  });
  await page.reload();
  const polls: string[] = [];
  await page.route(`${fleet.self.base}/api/sessions?**`, route => { polls.push(route.request().url()); return route.continue(); });
  await expect.poll(() => polls.length).toBeGreaterThan(1);

  // The page-reported visibility is a DOM-backed flag so the app's own getter
  // and listener stay the only code path exercised.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true,
      get: () => document.documentElement.hasAttribute('data-fixture-hidden') });
  });
  const setHidden = (value: boolean) => page.evaluate(visible => {
    document.documentElement.toggleAttribute('data-fixture-hidden', visible);
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
  await setHidden(true);
  await page.waitForTimeout(200);
  const paused = polls.length;
  await page.waitForTimeout(800);
  expect(polls.length).toBe(paused);

  await setHidden(false);
  await expect.poll(() => polls.length).toBeGreaterThan(paused);
});

export {};
