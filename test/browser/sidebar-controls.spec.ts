import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures.js';
async function setup(page: Page) {
  await page.evaluate(() => {
    fixtureApp.features.sidebarControls.dispose();
    window.controlsLog = { render: 0, copied: [], statuses: [], closes: [], refresh: 0, selected: [] };
    window.controlsState = PiDishBrowser.createSessionState({ getSelfHostId: () => 'self', getHostLabel: id => id, onListsChanged() {}, onCurrentChanged() {} });
    window.controlsState.setSessionLists([{ hostId: 'self', active: [{ id: 'same' }] }, { hostId: 'peer', active: [{ id: 'same' }] }]);
    window.controlsState.setCurrentSession('same', 'self');
    window.controlHosts = { self: { base: 'http://self', token: 'first' }, peer: { base: 'http://peer' } };
    window.controlStorage = new Map();
    window.customSidebar = PiDishBrowser.createSidebarControls({ document, sessionState: window.controlsState,
      storage: { getItem: key => window.controlStorage.get(key) ?? null, setItem: (key, value) => window.controlStorage.set(key, value) },
      request: (host, path, init) => new Promise<Response>(resolve => { window.controlsLog.request = { host, path, method: init?.method }; window.finishCloseRequest = resolve; }),
      host: id => fixtureElement(window.controlHosts[id || 'self'], 'sidebar host'), render: () => window.controlsLog.render++, closeSidebar() {},
      select: (id, host) => window.controlsLog.selected.push({ id, host }), pending() {}, create() {},
      refresh: async () => { window.controlsLog.refresh++; }, finishClose: async (id, host, owner) => { window.controlsLog.closes.push({ id, host, owner }); },
      ref: row => `${row.host}/${row.id}`, copy: text => { window.controlsLog.copied.push(text); return new Promise<void>(resolve => { window.finishCopy = resolve; }); },
      status: message => window.controlsLog.statuses.push(message),
    });
  });
}
test('old clipboard completions and retained menu controls cannot change a replacement menu', async ({ page, fleet }) => {
  await setup(page);
  await page.evaluate(() => {
    window.customSidebar.openMenu({ id: 'old', host: 'peer' }, 20, 20);
    window.oldMenuButton = document.querySelector<HTMLElement>('#sessionMenu button'); fixtureElement(window.oldMenuButton, 'old menu button').click();
    window.customSidebar.openMenu({ id: 'new', host: 'self' }, 40, 40); fixtureElement(window.oldMenuButton, 'old menu button').click(); window.finishCopy();
  });
  await page.waitForTimeout(850);
  await expect(page.locator('#sessionMenu')).toBeVisible();
  await expect(page.locator('#sessionMenu')).toContainText('self/new');
  expect(await page.evaluate(() => window.controlsLog.copied)).toEqual(['peer/old']);
  expect(await page.locator('#sessionMenu .copied').count()).toBe(0);
});
test('a changed endpoint requires a fresh close confirmation and dispatch uses the refreshed token', async ({ page, fleet }) => {
  await setup(page);
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
  await setup(page);
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
  await setup(page);
  await page.evaluate(() => {
    window.controlsState.setCurrentSession(null); window.pendingControlClose = window.customSidebar.performClose('same', 'peer');
    window.controlsState.advanceSelection(); window.controlsState.setCurrentSession('same', 'self'); window.controlsState.advanceSelection(); window.controlsState.setCurrentSession(null);
    window.finishCloseRequest(new Response('{}', { status: 200 }));
  });
  await page.evaluate(() => window.pendingControlClose);
  expect(await page.evaluate(() => ({ refresh: window.controlsLog.refresh, closes: window.controlsLog.closes }))).toEqual({ refresh: 1, closes: [] });
});
test('family pin aliases and preference migration preserve host-qualified identities', async ({ page, fleet }) => {
  await setup(page);
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
  await setup(page);
  const result = await page.evaluate(() => {
    const list = fixtureElement(document.getElementById('sessionList'), '#sessionList');
    list.innerHTML = '<div class="pinned-segment"><div class="session-family-root" data-family-key="self a"><span class="session-drag-handle">drag</span></div><div class="session-family-root" data-family-key="peer b">b</div></div>';
    window.customSidebar.mount(); window.customSidebar.mount();
    fixtureElement(list.querySelector<HTMLElement>('.session-drag-handle'), '.session-drag-handle').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8 })); const kept = window.customSidebar.dragging;
    window.customSidebar.dispose(); const before = list.innerHTML;
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientY: 10000 })); document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }));
    return { kept, dragging: window.customSidebar.dragging, unchanged: before === list.innerHTML, pins: [...window.customSidebar.pinned] };
  });
  expect(result).toEqual({ kept: true, dragging: false, unchanged: true, pins: [] });
});
test('disposal retires close requests, confirmations, menu rows and delegated selection', async ({ page, fleet }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const list = fixtureElement(document.getElementById('sessionList'), '#sessionList'); list.innerHTML = '<div class="session-item" data-id="same" data-host="peer">row</div>';
    window.customSidebar.mount(); window.customSidebar.openMenu({ id: 'old', host: 'self' }, 10, 10); const button = fixtureElement(document.querySelector<HTMLElement>('#sessionMenu button'), '#sessionMenu button');
    const pending = window.customSidebar.performClose('same', 'peer'); window.customSidebar.dispose(); button.click(); fixtureElement(list.firstElementChild, 'session list row').dispatchEvent(new MouseEvent('click'));
    window.finishCloseRequest(new Response('{}', { status: 200 })); await pending;
    window.customSidebar.closeClick('same', 'self');
    return { closes: window.controlsLog.closes, copied: window.controlsLog.copied, selected: window.controlsLog.selected, menu: window.customSidebar.menuOpen, confirm: window.customSidebar.closeConfirm };
  });
  expect(result).toEqual({ closes: [], copied: [], selected: [], menu: false, confirm: null });
});

test('sidebar updates retain keyboard focus and keep same-id peer cards independently actionable', async ({ page, fleet }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const state = window.controlsState, controls = window.customSidebar;
    state.setSessionLists([{ hostId: 'self', active: [{ id: 'same', name: 'Self work', cwd: '/repo', isActive: true }] },
      { hostId: 'peer', active: [{ id: 'same', name: 'Peer work', cwd: '/repo', isActive: true }] }]);
    const project = () => PiDishBrowser.renderSidebar({ ...state.sessions, selected: state.currentSession, tab: 'all', view: 'recent',
      query: 'work', queriedFor: 'work', scope: '', indexing: false, contextMetric: 'percent', pending: [], selectedSpawn: null,
      expanded: controls.expanded, collapsed: controls.collapsed, pinned: controls.pinned, roots: controls.familyRoots(),
      closeConfirm: null, closeBusy: null, multiHost: false, hosts: [], unread: () => false, hostChip: () => '' });
    controls.mount(); controls.updateList(project());
    const selfPin = fixtureElement(document.querySelector<HTMLButtonElement>('[data-host="self"] .session-pin-btn'), 'self pin');
    selfPin.focus();
    state.patchSession('same', { name: 'Peer changed work' }, 'peer'); controls.updateList(project());
    const focusAfterPeer = document.activeElement === selfPin;
    state.patchSession('same', { name: 'Self changed work' }, 'self'); controls.updateList(project());
    const focused = document.activeElement;
    const focusAfterSelf = focused?.closest<HTMLElement>('.session-item')?.dataset.host === 'self'
      && focused.classList.contains('session-pin-btn');
    fixtureElement(document.querySelector<HTMLElement>('[data-host="peer"] .session-item-name'), 'peer card').click();
    return { focusAfterPeer, focusAfterSelf, selected: window.controlsLog.selected,
      names: Array.from(document.querySelectorAll('.session-item-name')).map(el => el.textContent) };
  });
  expect(result).toEqual({ focusAfterPeer: true, focusAfterSelf: true, selected: [{ id: 'same', host: 'peer' }],
    names: ['Self changed work', 'Peer changed work'] });
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => [...window.customSidebar.pinned])).toEqual(['self same']);
});
test('ranked sidebar updates reorder and remove rows without retiring an unaffected keyboard target', async ({ page, fleet }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const state = window.controlsState, controls = window.customSidebar;
    const rows = [{ id: 'a', name: 'work A', searchScore: 30 }, { id: 'b', name: 'work B', searchScore: 20 }, { id: 'c', name: 'work C', searchScore: 10 }];
    const update = () => {
      state.setSessionLists({ active: rows }, 'self');
      controls.updateList(PiDishBrowser.renderSidebar({ ...state.sessions, selected: null, tab: 'all', view: 'recent', query: 'work',
        queriedFor: 'work', scope: '', indexing: false, contextMetric: 'percent', pending: [], selectedSpawn: null,
        expanded: controls.expanded, collapsed: controls.collapsed, pinned: controls.pinned, roots: controls.familyRoots(),
        closeConfirm: null, closeBusy: null, multiHost: false, hosts: [], unread: () => false, hostChip: () => '' }));
    };
    controls.mount(); update();
    const pin = fixtureElement(document.querySelector<HTMLButtonElement>('[data-id="b"] .session-pin-btn'), 'B pin');
    pin.focus(); rows[2].searchScore = 40; rows.shift(); update();
    return { order: Array.from(document.querySelectorAll<HTMLElement>('.session-item')).map(el => el.dataset.id),
      focusRetained: document.activeElement === pin };
  });
  expect(result).toEqual({ order: ['c', 'b'], focusRetained: true });
});

test('family roots follow replacement lineage without accepting lineage through metadata patches', async ({ page, fleet }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const state = window.controlsState, controls = window.customSidebar;
    state.setSessionLists({ active: [{ id: 'old', cwd: '/repo' }, { id: 'child', familyParentId: 'old', cwd: '/repo' }] }, 'self');
    const before = controls.familyRoots().get('self child');
    const patch = { name: 'Renamed', cwd: '/wrong', familyParentId: 'wrong' };
    state.patchSession('child', patch, 'self');
    const patched = controls.familyRoots().get('self child');
    state.setSessionLists([{ hostId: 'self', active: [{ id: 'new', cwd: '/new' }, { id: 'child', familyParentId: 'new', cwd: '/new' }] },
      { hostId: 'peer', active: [{ id: 'child', familyParentId: 'peer-parent', cwd: '/new' }] }]);
    controls.togglePin('child', 'child', ['child'], 'self');
    return { before, patched, after: controls.familyRoots().get('self child'), peer: controls.familyRoots().get('peer child'),
      pinned: [...controls.pinned] };
  });
  expect(result).toEqual({ before: 'self old', patched: 'self old', after: 'self new', peer: 'peer peer-parent', pinned: ['self new'] });
});

export {};
