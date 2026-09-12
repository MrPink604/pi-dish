const { test, expect } = require('./fixtures');
async function setup(page) {
  await page.evaluate(() => {
    fixtureApp.features.sidebarControls.dispose();
    window.controlsLog = { render: 0, copied: [], statuses: [], closes: [], refresh: 0, selected: [] };
    window.controlsState = PiDishBrowser.createSessionState({ getSelfHostId: () => 'self', getHostLabel: id => id, onListsChanged() {}, onCurrentChanged() {} });
    window.controlsState.setSessionLists([{ hostId: 'self', active: [{ id: 'same' }] }, { hostId: 'peer', active: [{ id: 'same' }] }]);
    window.controlsState.setCurrentSession('same', 'self');
    window.controlHosts = { self: { base: 'http://self', token: 'first' }, peer: { base: 'http://peer' } };
    window.controlStorage = new Map();
    window.customSidebar = PiDishBrowser.createSidebarControls({ document, sessionState: window.controlsState,
      storage: { getItem: key => window.controlStorage.get(key) || null, setItem: (key, value) => window.controlStorage.set(key, value) },
      request: (host, path, init) => new Promise(resolve => { window.controlsLog.request = { host, path, method: init.method }; window.finishCloseRequest = resolve; }),
      host: id => window.controlHosts[id || 'self'], render: () => window.controlsLog.render++, closeSidebar() {},
      select: (id, host) => window.controlsLog.selected.push({ id, host }), pending() {}, create() {},
      refresh: async () => { window.controlsLog.refresh++; }, finishClose: async (id, host, owner) => { window.controlsLog.closes.push({ id, host, owner }); },
      ref: row => `${row.host}/${row.id}`, copy: text => { window.controlsLog.copied.push(text); return new Promise(resolve => { window.finishCopy = resolve; }); },
      status: message => window.controlsLog.statuses.push(message),
    });
  });
}
test('old clipboard completions and retained menu controls cannot change a replacement menu', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    window.customSidebar.openMenu({ id: 'old', host: 'peer' }, 20, 20);
    window.oldMenuButton = document.querySelector('#sessionMenu button'); window.oldMenuButton.click();
    window.customSidebar.openMenu({ id: 'new', host: 'self' }, 40, 40); window.oldMenuButton.click(); window.finishCopy();
  });
  await page.waitForTimeout(850);
  await expect(page.locator('#sessionMenu')).toBeVisible();
  await expect(page.locator('#sessionMenu')).toContainText('self/new');
  expect(await page.evaluate(() => window.controlsLog.copied)).toEqual(['peer/old']);
  expect(await page.locator('#sessionMenu .copied').count()).toBe(0);
});
test('a changed endpoint requires a fresh close confirmation and dispatch uses the refreshed token', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    window.customSidebar.closeClick('same', 'self'); window.controlHosts.self = { base: 'http://replacement', token: 'second' };
    window.customSidebar.closeClick('same', 'self');
  });
  expect(await page.evaluate(() => window.controlsLog.request)).toBeUndefined();
  await page.evaluate(() => { window.controlHosts.self.token = 'fresh'; window.customSidebar.closeClick('same', 'self'); });
  expect(await page.evaluate(() => window.controlsLog.request)).toEqual({ host: { base: 'http://replacement', token: 'fresh' }, path: '/api/sessions/same/close', method: 'POST' });
  await page.evaluate(() => window.finishCloseRequest(new Response('{}', { status: 200 })));
  await expect.poll(() => page.evaluate(() => window.customSidebar.closeBusy)).toBeNull();
  expect(await page.evaluate(() => window.controlsLog.closes.length)).toBe(1);
});
test('a delayed close failure cannot report into a same-id peer selection', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    window.pendingControlClose = window.customSidebar.performClose('same', 'self');
    window.controlsState.advanceSelection(); window.controlsState.setCurrentSession('same', 'peer');
    window.finishCloseRequest(new Response(JSON.stringify({ error: 'old host failed' }), { status: 500 }));
  });
  await page.evaluate(() => window.pendingControlClose);
  expect(await page.evaluate(() => window.controlsLog.statuses)).toEqual([]);
  expect(await page.evaluate(() => window.customSidebar.closeBusy)).toBeNull();
});
test('closing from an empty selection cannot report after a later selection cycle', async ({ page, fleet }) => {
  await setup(page, fleet);
  await page.evaluate(() => {
    window.controlsState.setCurrentSession(null); window.pendingControlClose = window.customSidebar.performClose('same', 'peer');
    window.controlsState.advanceSelection(); window.controlsState.setCurrentSession('same', 'self'); window.controlsState.advanceSelection(); window.controlsState.setCurrentSession(null);
    window.finishCloseRequest(new Response('{}', { status: 200 }));
  });
  await page.evaluate(() => window.pendingControlClose);
  expect(await page.evaluate(() => ({ refresh: window.controlsLog.refresh, closes: window.controlsLog.closes }))).toEqual({ refresh: 1, closes: [] });
});
test('family pin aliases and preference migration preserve host-qualified identities', async ({ page, fleet }) => {
  await setup(page, fleet);
  const result = await page.evaluate(() => {
    window.controlsState.setSessionLists([{ hostId: 'peer', active: [{ id: 'child', familyParentId: 'parent', cwd: '/repo' }] },
      { hostId: 'self', active: [{ id: 'parent', cwd: '/repo' }] }]);
    window.customSidebar.togglePin('child', 'child', ['child'], 'peer'); window.customSidebar.togglePin('parent', 'parent', ['parent'], 'self');
    const pins = [...window.customSidebar.pinned]; window.customSidebar.togglePin('child', 'child', ['child'], 'peer');
    window.controlStorage.set('pi-dish-expanded-session-families', JSON.stringify(['bare', 'peer child', 1]));
    window.controlStorage.set('pi-dish-pinned-sessions', JSON.stringify(['bare', 'peer parent', null]));
    window.customSidebar.reloadPreferences(); window.customSidebar.migrate('self');
    return { pins, migrated: [...window.customSidebar.pinned], expanded: [...window.customSidebar.expanded] };
  });
  expect(result).toEqual({ pins: ['peer parent', 'self parent'], migrated: ['self bare', 'peer parent'], expanded: ['self bare', 'peer child'] });
});
test('only the owning pointer ends a pin drag and disposal retires document listeners', async ({ page, fleet }) => {
  await setup(page, fleet);
  const result = await page.evaluate(() => {
    const list = document.getElementById('sessionList');
    list.innerHTML = '<div class="pinned-segment"><div class="session-family-root" data-family-key="self a"><span class="session-drag-handle">drag</span></div><div class="session-family-root" data-family-key="peer b">b</div></div>';
    window.customSidebar.mount(); window.customSidebar.mount();
    list.querySelector('.session-drag-handle').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8 })); const kept = window.customSidebar.dragging;
    window.customSidebar.dispose(); const before = list.innerHTML;
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientY: 10000 })); document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }));
    return { kept, dragging: window.customSidebar.dragging, unchanged: before === list.innerHTML, pins: [...window.customSidebar.pinned] };
  });
  expect(result).toEqual({ kept: true, dragging: false, unchanged: true, pins: [] });
});
test('disposal retires close requests, confirmations, menu rows and delegated selection', async ({ page, fleet }) => {
  await setup(page, fleet);
  const result = await page.evaluate(async () => {
    const list = document.getElementById('sessionList'); list.innerHTML = '<div class="session-item" data-id="same" data-host="peer">row</div>';
    window.customSidebar.mount(); window.customSidebar.openMenu({ id: 'old', host: 'self' }, 10, 10); const button = document.querySelector('#sessionMenu button');
    const pending = window.customSidebar.performClose('same', 'peer'); window.customSidebar.dispose(); button.click(); list.firstElementChild.click();
    window.finishCloseRequest(new Response('{}', { status: 200 })); await pending;
    window.customSidebar.closeClick('same', 'self');
    return { closes: window.controlsLog.closes, copied: window.controlsLog.copied, selected: window.controlsLog.selected, menu: window.customSidebar.menuOpen, confirm: window.customSidebar.closeConfirm };
  });
  expect(result).toEqual({ closes: [], copied: [], selected: [], menu: false, confirm: null });
});
