import type { Page } from '@playwright/test';
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
      closeConfirm: null, closeBusy: null, multiHost: false, hosts: [], bots: [], botRetireArmed: null, unread: () => false, hostChip: () => '' });
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
        closeConfirm: null, closeBusy: null, multiHost: false, hosts: [], bots: [], botRetireArmed: null, unread: () => false, hostChip: () => '' }));
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

test('bot tree toggles collapse/expand, closed-worker drawer toggles, and reveal expands hidden bot workers', async ({ page, fleet }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const HUB = '11111111-1111-4111-8111-111111111111';
    const PEER = '22222222-2222-4222-8222-222222222222';
    window.customSidebar.dispose();
    const state = window.controlsState;
    const botList = [
      { id: 'fleet', parentId: null, name: 'Fleet', status: 'active', model: 'claude-code/claude-opus-5-5', thinking: null, identity: 'Fleet', places: [], sessionId: 'route-fleet' },
      { id: 'hosts', parentId: 'fleet', name: 'Hosts', status: 'active', model: 'claude-code/claude-opus-5-5', thinking: null, identity: 'Hosts', places: [], sessionId: 'route-hosts' },
    ];
    state.setSessionLists([
      {
        hostId: HUB,
        active: [
          { id: 'route-fleet', name: 'Fleet', harnessId: 'bot', cwd: '/home', isActive: true },
          { id: 'route-hosts', name: 'Hosts', harnessId: 'bot', cwd: '/home', isActive: true },
        ],
        previous: [
          { id: 'w-closed', name: 'Closed check', cwd: '/repo', parentId: 'route-hosts', isActive: false },
        ],
      },
      {
        hostId: PEER,
        active: [
          { id: 'w-remote', name: 'Remote worker', cwd: '/srv', parentId: `${HUB}:route-fleet`, isActive: true },
        ],
      },
    ]);
    const controls = PiDishBrowser.createSidebarControls({
      document, sessionState: state,
      storage: { getItem: key => window.controlStorage.get(key) ?? null, setItem: (key, value) => window.controlStorage.set(key, value) },
      request: async () => new Response('{}'), host: () => ({ base: '' }),
      render: () => {
        controls.updateList(PiDishBrowser.renderSidebar({
          ...state.sessions, selected: null, tab: 'all', view: 'workspace', query: '', queriedFor: '', scope: '', indexing: false,
          contextMetric: 'percent', pending: [], selectedSpawn: null,
          expanded: controls.expanded, collapsed: controls.collapsed, pinned: controls.pinned, roots: controls.familyRoots(),
          closeConfirm: null, closeBusy: null, multiHost: true,
          hosts: [
            { hostId: HUB, self: true, label: 'beelink', state: 'reachable', key: 'self', color: '#1af', dot: '', hasCache: true },
            { hostId: PEER, self: false, label: 'tycho', state: 'reachable', key: 'tycho', color: '#fa1', dot: '', hasCache: true },
          ],
          bots: botList, botRetireArmed: null, selfHostId: HUB, unread: () => false, hostChip: id => id === PEER ? '<span>tycho</span>' : '',
        }));
      },
      closeSidebar() {}, select: (id, host) => window.controlsLog.selected.push({ id, host }),
      pending() {}, create() {}, refresh: async () => {}, finishClose: async () => {},
      ref: row => `${row.host}/${row.id}`, copy: async () => {}, status() {},
      bots: () => botList, selfHostId: () => HUB,
    });
    window.customSidebar = controls;
    controls.mount();
    const render = () => controls.updateList(PiDishBrowser.renderSidebar({
      ...state.sessions, selected: null, tab: 'all', view: 'workspace', query: '', queriedFor: '', scope: '', indexing: false,
      contextMetric: 'percent', pending: [], selectedSpawn: null,
      expanded: controls.expanded, collapsed: controls.collapsed, pinned: controls.pinned, roots: controls.familyRoots(),
      closeConfirm: null, closeBusy: null, multiHost: true,
      hosts: [
        { hostId: HUB, self: true, label: 'beelink', state: 'reachable', key: 'self', color: '#1af', dot: '', hasCache: true },
        { hostId: PEER, self: false, label: 'tycho', state: 'reachable', key: 'tycho', color: '#fa1', dot: '', hasCache: true },
      ],
      bots: botList, botRetireArmed: null, selfHostId: HUB, unread: () => false, hostChip: id => id === PEER ? '<span>tycho</span>' : '',
    }));
    render();
    const initialRemoteVisible = !!document.querySelector('[data-id="w-remote"]');
    const initialClosedVisible = !!document.querySelector('[data-id="w-closed"]');

    // Clicking Fleet's toggle collapses its subtree without selecting Fleet.
    fixtureElement(document.querySelector<HTMLElement>('[data-bot-toggle="fleet"]'), 'fleet toggle').click();
    const afterCollapseRemote = !!document.querySelector('[data-id="w-remote"]');
    const selectedAfterToggle = window.controlsLog.selected.length;

    // Revealing a closed worker under a nested sub-bot expands ancestor bots AND the closed drawer.
    controls.reveal('w-closed', HUB);
    render();
    const afterRevealClosed = !!document.querySelector('[data-id="w-closed"]');
    const expandedKeys = [...controls.expanded];

    // Clicking closed-worker toggle collapses it again, and migrate preserves bot-closed keys.
    fixtureElement(document.querySelector<HTMLElement>('[data-bot-closed="hosts"]'), 'closed toggle').click();
    const afterCloseDrawer = !!document.querySelector('[data-id="w-closed"]');
    controls.reveal('w-closed', HUB);
    controls.migrate(HUB);
    const migratedExpanded = [...controls.expanded];

    return {
      initialRemoteVisible, initialClosedVisible, afterCollapseRemote, selectedAfterToggle,
      afterRevealClosed, expandedKeys, afterCloseDrawer, migratedExpanded,
    };
  });
  expect(result).toEqual({
    initialRemoteVisible: true,
    initialClosedVisible: false,
    afterCollapseRemote: false,
    selectedAfterToggle: 0,
    afterRevealClosed: true,
    expandedKeys: ['bot-closed:hosts'],
    afterCloseDrawer: false,
    migratedExpanded: ['bot-closed:hosts'],
  });
});

test('pinning a cross-host child preserves an unrelated pinned session sharing the parent id on the child host', async ({ page, fleet }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const HUB = '11111111-1111-4111-8111-111111111111';
    const PEER = '22222222-2222-4222-8222-222222222222';
    const state = window.controlsState, controls = window.customSidebar;
    state.setSessionLists([
      { hostId: HUB, active: [{ id: 'shared-id', name: 'Hub Root', cwd: '/orch', isActive: true }] },
      { hostId: PEER, active: [
        { id: 'shared-id', name: 'Peer Unrelated', cwd: '/other', isActive: true },
        { id: 'peer-child', name: 'Peer Child', cwd: '/gpu', parentId: `${HUB}:shared-id`, isActive: true },
      ] },
    ]);
    const render = () => controls.updateList(PiDishBrowser.renderSidebar({
      ...state.sessions, selected: null, tab: 'active', view: 'workspace', query: '', queriedFor: '', scope: '', indexing: false,
      contextMetric: 'percent', pending: [], selectedSpawn: null,
      expanded: new Set([`${HUB} shared-id`]), collapsed: controls.collapsed, pinned: controls.pinned, roots: controls.familyRoots(),
      closeConfirm: null, closeBusy: null, multiHost: true,
      hosts: [
        { hostId: HUB, self: true, label: 'beelink', state: 'reachable', key: 'self', color: '#1af', dot: '', hasCache: true },
        { hostId: PEER, self: false, label: 'tycho', state: 'reachable', key: 'tycho', color: '#fa1', dot: '', hasCache: true },
      ],
      bots: [], botRetireArmed: null, selfHostId: HUB, unread: () => false, hostChip: () => '',
    }));
    controls.mount();
    // Pin the unrelated peer session with id 'shared-id' first.
    controls.togglePin('shared-id', `${PEER} shared-id`, [`${PEER} shared-id`], PEER);
    render();
    // Now click the pin button on the cross-host child nested under HUB's 'shared-id'.
    fixtureElement(document.querySelector<HTMLButtonElement>('[data-id="peer-child"] .session-pin-btn'), 'peer-child pin').click();
    return [...controls.pinned];
  });
  expect(result).toEqual([
    '22222222-2222-4222-8222-222222222222 shared-id',
    '11111111-1111-4111-8111-111111111111 shared-id',
  ]);
});

const scrollCases = [
  { name: 'single host', singleHost: true },
  { name: 'last host section', singleHost: false },
];
for (const viewport of [{ width: 1280, height: 900 }, { width: 412, height: 915 }]) {
  for (const scrollCase of scrollCases) {
    test(`toggling a workspace group keeps its header in place in a scrolled list (${scrollCase.name}, ${viewport.width}px)`, async ({ page, fleet }) => {
      await page.setViewportSize(viewport);
      if (scrollCase.singleHost) {
        // Runs after the fixture's own init script, so the reload sees only the serving host.
        await page.addInitScript(() => localStorage.removeItem('pi-dish-hosts'));
        await page.reload();
        await expect.poll(() => page.evaluate(() => typeof fixtureApp !== 'undefined' && !!fixtureApp.features?.sidebarLists)).toBe(true);
      }
      const target = scrollCase.singleHost ? fleet.self : fleet.peer;
      await page.evaluate(({ hosts, target }) => {
        fixtureApp.features.sidebarLists.dispose(); // polls would replace the injected lists
        fixtureApp.features.sessionState.setSessionLists(hosts.map(hostId => ({ hostId, active: Array.from({ length: hostId === target ? 60 : 4 }, (_, index) => ({
          id: `scroll-${index}`, host: hostId, name: `Scroll ${index}`, isActive: true,
          cwd: `/work/proj-${String(Math.floor(index / 2)).padStart(2, '0')}`, lastActivity: Date.now() - index * 1000,
        })) })));
      }, { hosts: scrollCase.singleHost ? [fleet.self.hostId] : [fleet.self.hostId, fleet.peer.hostId], target: target.hostId });
      if (viewport.width <= 768) {
        await page.locator('.header-menu-btn:visible, .empty-menu-btn:visible').first().click();
        await expect(page.locator('#sidebar')).toHaveClass(/\bopen\b/);
        // A click during the slide-in retries after scrolling the header to the top.
        await expect.poll(async () => (await page.locator('#sidebar').boundingBox())?.x).toBe(0);
      }
      // Mid-list, newer than half its siblings: a collapse-driven re-sort would move it.
      const key = scrollCase.singleHost ? '/work/proj-15' : `${target.hostId} /work/proj-15`;
      const header = page.locator(`.workspace-group-header[data-cwd="${key}"]`);
      const offset = () => header.evaluate(element => {
        const list = fixtureElement(element.closest<HTMLElement>('#sessionList'), 'session list');
        return { top: element.getBoundingClientRect().top - list.getBoundingClientRect().top, scrollTop: list.scrollTop };
      });
      await header.evaluate(element => {
        const list = fixtureElement(element.closest<HTMLElement>('#sessionList'), 'session list');
        list.scrollTop += element.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 2;
      });
      const before = await offset();
      expect(before.scrollTop).toBeGreaterThan(1000);
      await header.click();
      await expect(page.locator('.session-segment.collapsed > .workspace-group-header')).toHaveAttribute('data-cwd', key);
      const collapsed = await offset();
      expect(Math.abs(collapsed.top - before.top)).toBeLessThanOrEqual(1);
      expect(collapsed.scrollTop).toBe(before.scrollTop);
      await header.click();
      await expect(page.locator('.session-segment.collapsed')).toHaveCount(0);
      expect(Math.abs((await offset()).top - before.top)).toBeLessThanOrEqual(1);
    });
  }
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`closing a session mid-list preserves sidebar scroll and DOM continuity (${viewport.width}px)`, async ({ page, fleet }) => {
    await page.setViewportSize(viewport);
    const now = Date.now();
    const state = {
      active: Array.from({ length: 40 }, (_, index) => ({
        id: `close-${String(index).padStart(2, '0')}`,
        name: `Close ${index}`,
        isActive: true,
        capabilities: { close: true },
        cwd: `/work/proj-${String(Math.floor(index / 2)).padStart(2, '0')}`,
        lastActivity: new Date(now - index * 60_000).toISOString(),
        model: 'claude-sonnet-4',
      })),
      previous: [] as Record<string, unknown>[],
    };
    await page.route(`${fleet.self.base}/api/sessions?*`, route => {
      const url = new URL(route.request().url());
      const activeOnly = url.searchParams.get('active') === '1';
      return route.fulfill({ json: { active: state.active, previous: activeOnly ? [] : state.previous, indexing: false } });
    });
    await page.route(`${fleet.peer.base}/api/sessions?*`, route => route.fulfill({ json: { active: [], previous: [], indexing: false } }));
    await page.route(`${fleet.self.base}/api/sessions/*/close`, route => {
      const match = /\/api\/sessions\/([^/]+)\/close/.exec(route.request().url());
      const id = decodeURIComponent(match?.[1] || '');
      const idx = state.active.findIndex(entry => entry.id === id);
      if (idx !== -1) {
        const [removed] = state.active.splice(idx, 1);
        state.previous.unshift({ ...removed, isActive: false });
      }
      return route.fulfill({ json: { ok: true } });
    });
    await page.route('**/api/sessions/*/messages*', route => route.fulfill({ json: { messages: [], total: 0, hasMore: false } }));
    await page.route('**/api/sessions/*/relations*', route => route.fulfill({ json: { parent: null, children: [], subagents: [] } }));
    await page.route('**/api/sessions/*/stream*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: init\ndata: {"turnInProgress":false}\n\n' }));
    await page.route('**/api/sessions/*/commands*', route => route.fulfill({ json: { commands: [] } }));
    await page.route('**/api/sessions/*/models*', route => route.fulfill({ json: { models: [] } }));
    await page.route('**/api/sessions/*/reviews*', route => route.fulfill({ json: { reviews: [] } }));
    await page.route('**/api/sessions/*/stats', route => route.fulfill({ json: { model: 'claude-sonnet-4', cwd: '/work', hardCacheMisses: 0, costs: { total: 0 } } }));
    await page.route('**/api/sessions/*/share*', route => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/pages?*', route => route.fulfill({ json: [] }));

    await page.evaluate(() => fixtureApp.features.sidebarQuery.switchTab('active'));
    await expect(page.locator('.session-item[data-id="close-20"]')).toHaveCount(1);
    await page.evaluate(host => fixtureApp.features.sessionView.select('close-00', { host }), fleet.self.hostId);

    if (viewport.width <= 768) {
      await page.locator('.header-menu-btn:visible, .empty-menu-btn:visible').first().click();
      await expect(page.locator('#sidebar')).toHaveClass(/\bopen\b/);
      await expect.poll(async () => (await page.locator('#sidebar').boundingBox())?.x).toBe(0);
    }

    const measure = () => page.evaluate(() => {
      const list = fixtureElement(document.getElementById('sessionList'), '#sessionList');
      const lr = list.getBoundingClientRect();
      const topOf = (id: string) => {
        const el = list.querySelector<HTMLElement>(`.session-item[data-id="${id}"]`);
        return el ? el.getBoundingClientRect().top - lr.top : null;
      };
      return {
        scrollTop: list.scrollTop,
        clientHeight: list.clientHeight,
        s18: topOf('close-18'),
        s20: topOf('close-20'),
        s21: topOf('close-21'),
        s22: topOf('close-22'),
      };
    });

    await page.evaluate(() => {
      const list = fixtureElement(document.getElementById('sessionList'), '#sessionList');
      const target = fixtureElement(list.querySelector<HTMLElement>('.session-item[data-id="close-20"]'), 'close-20');
      list.scrollTop += target.getBoundingClientRect().top - list.getBoundingClientRect().top - 220;
    });

    const before = await measure();
    expect(before.scrollTop).toBeGreaterThan(1000);
    expect(before.s20).not.toBeNull();
    // Keep a reference to an unaffected sibling segment; a full list.replaceChildren teardown detaches it.
    await page.evaluate(() => {
      const seg = fixtureElement(document.querySelector('.session-item[data-id="close-18"]')?.closest('.session-segment'), 'close-18 segment');
      (window as unknown as { __keptSeg?: Element }).__keptSeg = seg;
    });

    // 1. Close a non-selected session mid-list via the sidebar two-tap close button.
    const close20 = page.locator('.session-item[data-id="close-20"] .session-close-btn');
    await close20.hover();
    await close20.click();
    await expect(close20).toHaveClass(/\bconfirm\b/);
    await close20.click();
    await expect(page.locator('.session-item[data-id="close-20"]')).toHaveCount(0);

    const afterNonSelected = await measure();
    expect(Math.abs(afterNonSelected.scrollTop - before.scrollTop)).toBeLessThanOrEqual(2);
    expect(Math.abs((afterNonSelected.s18 ?? 0) - (before.s18 ?? 0))).toBeLessThanOrEqual(1);
    // The next session moves into close-20's place and stays inside the viewport.
    expect(afterNonSelected.s21).not.toBeNull();
    expect(Math.abs((afterNonSelected.s21 ?? 0) - (before.s20 ?? 0))).toBeLessThanOrEqual(2);
    expect(afterNonSelected.s21!).toBeGreaterThanOrEqual(0);
    expect(afterNonSelected.s21!).toBeLessThan(afterNonSelected.clientHeight);
    expect(await page.evaluate(() => (window as unknown as { __keptSeg?: Element }).__keptSeg?.isConnected)).toBe(true);

    // 2. Close the SELECTED session via the sidebar close button.
    await page.evaluate(host => fixtureApp.features.sessionView.select('close-21', { host }), fleet.self.hostId);
    await expect(page.locator('.session-item[data-id="close-21"]')).toHaveClass(/\bactive\b/);
    const beforeSelected = await measure();
    const close21 = page.locator('.session-item[data-id="close-21"] .session-close-btn');
    await close21.hover();
    await close21.click();
    await expect(close21).toHaveClass(/\bconfirm\b/);
    await close21.click();
    await expect(page.locator('.session-item[data-id="close-21"]')).toHaveCount(0);

    const afterSelected = await measure();
    expect(Math.abs(afterSelected.scrollTop - beforeSelected.scrollTop)).toBeLessThanOrEqual(2);
    expect(Math.abs((afterSelected.s18 ?? 0) - (beforeSelected.s18 ?? 0))).toBeLessThanOrEqual(1);
    expect(afterSelected.s22).not.toBeNull();
    expect(afterSelected.s22!).toBeGreaterThanOrEqual(0);
    expect(afterSelected.s22!).toBeLessThan(afterSelected.clientHeight);

    // 3. Close the selected session from the stats modal (header/context close path).
    await page.evaluate(host => fixtureApp.features.sessionView.select('close-22', { host }), fleet.self.hostId);
    await expect(page.locator('.session-item[data-id="close-22"]')).toHaveClass(/\bactive\b/);
    const beforeModal = await measure();
    if (viewport.width <= 768) {
      await page.evaluate(() => fixtureApp.features.sidebarQuery.close());
      await expect(page.locator('#sidebar')).not.toHaveClass(/\bopen\b/);
    }
    page.once('dialog', dialog => dialog.accept());
    await page.evaluate(() => fixtureApp.features.sessionInfo.openStats());
    await page.locator('#sessionCloseBtn').click();
    await expect(page.locator('#statsModal')).toBeHidden();
    await expect(page.locator('.session-item[data-id="close-22"]')).toHaveCount(0);
    if (viewport.width <= 768) {
      await page.locator('.header-menu-btn:visible, .empty-menu-btn:visible').first().click();
      await expect(page.locator('#sidebar')).toHaveClass(/\bopen\b/);
      await expect.poll(async () => (await page.locator('#sidebar').boundingBox())?.x).toBe(0);
    }
    const afterModal = await measure();
    expect(Math.abs(afterModal.scrollTop - beforeModal.scrollTop)).toBeLessThanOrEqual(2);
    expect(Math.abs((afterModal.s18 ?? 0) - (beforeModal.s18 ?? 0))).toBeLessThanOrEqual(1);
  });

  test(`background-spawned sessions and closed rows above the viewport keep scrolled sidebar rows in place (${viewport.width}px)`, async ({ page, fleet }) => {
    await page.setViewportSize(viewport);
    const now = Date.now();
    const bot = { id: 'fleet', parentId: null, name: 'Fleet', status: 'active', model: 'claude-sonnet-4', thinking: null, identity: 'Fleet', places: [], sessionId: 'route-fleet' };
    const selfState = {
      active: [
        { id: 'route-fleet', host: fleet.self.hostId, name: 'Fleet', harnessId: 'bot', cwd: '/home', isActive: true, lastActivity: new Date(now).toISOString() },
        { id: 'w-0', host: fleet.self.hostId, name: 'Worker 0', cwd: '/repo', parentId: 'route-fleet', isActive: true, capabilities: { close: true }, lastActivity: new Date(now - 5000).toISOString() },
        ...Array.from({ length: 16 }, (_, index) => ({
          id: `self-${String(index).padStart(2, '0')}`,
          host: fleet.self.hostId,
          name: `Self ${index}`,
          isActive: true,
          capabilities: { close: true },
          cwd: `/work/self-${String(Math.floor(index / 2)).padStart(2, '0')}`,
          lastActivity: new Date(now - (index + 1) * 60_000).toISOString(),
        })),
      ],
      previous: [] as Record<string, unknown>[],
    };
    const peerState = {
      active: Array.from({ length: 24 }, (_, index) => ({
        id: `peer-${String(index).padStart(2, '0')}`,
        host: fleet.peer.hostId,
        name: `Peer ${index}`,
        isActive: true,
        capabilities: { close: true },
        cwd: `/work/peer-${String(Math.floor(index / 2)).padStart(2, '0')}`,
        lastActivity: new Date(now - (index + 1) * 60_000).toISOString(),
      })),
      previous: [] as Record<string, unknown>[],
    };

    await page.evaluate(({ selfHost, peerHost, selfActive, peerActive, bot }) => {
      fixtureApp.features.sidebarLists.dispose();
      fixtureApp.features.sidebarQuery.switchTab('active');
      fixtureApp.features.sessionState.setSessionLists([
        { hostId: selfHost, active: selfActive, previous: [] },
        { hostId: peerHost, active: peerActive, previous: [] },
      ]);
      // Expose a helper to re-publish lists with bots via updateList-driving state writes.
      (window as unknown as { __bgBot?: unknown }).__bgBot = bot;
    }, { selfHost: fleet.self.hostId, peerHost: fleet.peer.hostId, selfActive: selfState.active, peerActive: peerState.active, bot });

    await expect(page.locator('.session-item[data-id="peer-14"]')).toHaveCount(1);
    if (viewport.width <= 768) {
      await page.locator('.header-menu-btn:visible, .empty-menu-btn:visible').first().click();
      await expect(page.locator('#sidebar')).toHaveClass(/\bopen\b/);
      await expect.poll(async () => (await page.locator('#sidebar').boundingBox())?.x).toBe(0);
    }

    const rowPos = (id: string) => page.evaluate(targetId => {
      const list = fixtureElement(document.getElementById('sessionList'), '#sessionList');
      const el = fixtureElement(list.querySelector<HTMLElement>(`.session-item[data-id="${targetId}"]`), targetId);
      return {
        scrollTop: list.scrollTop,
        top: el.getBoundingClientRect().top - list.getBoundingClientRect().top,
      };
    }, id);

    // Scroll down into the peer host section.
    await page.evaluate(() => {
      const list = fixtureElement(document.getElementById('sessionList'), '#sessionList');
      const target = fixtureElement(list.querySelector<HTMLElement>('.session-item[data-id="peer-14"]'), 'peer-14');
      list.scrollTop += target.getBoundingClientRect().top - list.getBoundingClientRect().top - 220;
    });
    const before = await rowPos('peer-14');
    expect(before.scrollTop).toBeGreaterThan(1000);

    // 1. Background spawn above the viewport (new workers + new workspace at top of self host).
    selfState.active.unshift(
      { id: 'w-bg-1', host: fleet.self.hostId, name: 'Background Worker 1', cwd: '/repo', parentId: 'route-fleet', isActive: true, capabilities: { close: true }, lastActivity: new Date(now + 1000).toISOString() },
      { id: 'w-bg-2', host: fleet.self.hostId, name: 'Background Worker 2', cwd: '/repo', parentId: 'route-fleet', isActive: true, capabilities: { close: true }, lastActivity: new Date(now + 2000).toISOString() },
      { id: 'self-bg-new', host: fleet.self.hostId, name: 'Background Session', cwd: '/work/self-new', isActive: true, capabilities: { close: true }, lastActivity: new Date(now + 3000).toISOString() },
    );
    await page.evaluate(({ selfHost, peerHost, selfActive, peerActive }) => {
      fixtureApp.features.sessionState.setSessionLists([
        { hostId: selfHost, active: selfActive, previous: [] },
        { hostId: peerHost, active: peerActive, previous: [] },
      ]);
    }, { selfHost: fleet.self.hostId, peerHost: fleet.peer.hostId, selfActive: selfState.active, peerActive: peerState.active });
    await expect(page.locator('.session-item[data-id="self-bg-new"]')).toHaveCount(1);

    const afterSpawnAbove = await rowPos('peer-14');
    expect(Math.abs(afterSpawnAbove.top - before.top)).toBeLessThanOrEqual(1);
    expect(afterSpawnAbove.scrollTop).toBeGreaterThan(before.scrollTop);

    // 2. Background spawn in an EXISTING workspace near the top of the viewport causes that workspace to jump to top;
    // the surrounding visible rows must stay put rather than following that workspace to the top.
    const beforePeer16 = await rowPos('peer-16');
    peerState.active.unshift({
      id: 'peer-bg-reordered',
      host: fleet.peer.hostId,
      name: 'Peer Reorder Spawn',
      isActive: true,
      capabilities: { close: true },
      cwd: '/work/peer-06', // workspace of peer-12 & peer-13 (right above peer-14)
      lastActivity: new Date(now + 4000).toISOString(),
    });
    await page.evaluate(({ selfHost, peerHost, selfActive, peerActive }) => {
      fixtureApp.features.sessionState.setSessionLists([
        { hostId: selfHost, active: selfActive, previous: [] },
        { hostId: peerHost, active: peerActive, previous: [] },
      ]);
    }, { selfHost: fleet.self.hostId, peerHost: fleet.peer.hostId, selfActive: selfState.active, peerActive: peerState.active });
    await expect(page.locator('.session-item[data-id="peer-bg-reordered"]')).toHaveCount(1);

    const afterReorderSpawn = await rowPos('peer-16');
    expect(Math.abs(afterReorderSpawn.top - beforePeer16.top)).toBeLessThanOrEqual(1);
    expect(afterReorderSpawn.scrollTop).toBeGreaterThan(1000);

    // 3. Background close of sessions ABOVE the viewport keeps visible rows pinned in place.
    const beforeCloseAbove = await rowPos('peer-16');
    selfState.active.splice(0, 3);
    await page.evaluate(({ selfHost, peerHost, selfActive, peerActive }) => {
      fixtureApp.features.sessionState.setSessionLists([
        { hostId: selfHost, active: selfActive, previous: [] },
        { hostId: peerHost, active: peerActive, previous: [] },
      ]);
    }, { selfHost: fleet.self.hostId, peerHost: fleet.peer.hostId, selfActive: selfState.active, peerActive: peerState.active });
    await expect(page.locator('.session-item[data-id="self-bg-new"]')).toHaveCount(0);

    const afterCloseAbove = await rowPos('peer-16');
    expect(Math.abs(afterCloseAbove.top - beforeCloseAbove.top)).toBeLessThanOrEqual(1);
    expect(afterCloseAbove.scrollTop).toBeGreaterThan(1000);

    // 4. When already at scrollTop === 0, a new background spawn at the top stays at 0 so the user sees it.
    await page.evaluate(() => { fixtureElement(document.getElementById('sessionList'), '#sessionList').scrollTop = 0; });
    selfState.active.unshift({
      id: 'self-top-check',
      host: fleet.self.hostId,
      name: 'Top Check',
      isActive: true,
      capabilities: { close: true },
      cwd: '/work/self-top',
      lastActivity: new Date(now + 5000).toISOString(),
    });
    await page.evaluate(({ selfHost, peerHost, selfActive, peerActive }) => {
      fixtureApp.features.sessionState.setSessionLists([
        { hostId: selfHost, active: selfActive, previous: [] },
        { hostId: peerHost, active: peerActive, previous: [] },
      ]);
    }, { selfHost: fleet.self.hostId, peerHost: fleet.peer.hostId, selfActive: selfState.active, peerActive: peerState.active });
    await expect(page.locator('.session-item[data-id="self-top-check"]')).toHaveCount(1);
    expect(await page.evaluate(() => fixtureElement(document.getElementById('sessionList'), '#sessionList').scrollTop)).toBe(0);
  });
}

test('bot-worker spawns, bot-worker closes, and filtered-list closes keep scrolled sidebar rows anchored', async ({ page, fleet }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const HUB = '11111111-1111-4111-8111-111111111111';
    const PEER = '22222222-2222-4222-8222-222222222222';
    const list = fixtureElement(document.getElementById('sessionList'), '#sessionList');
    const state = window.controlsState, controls = window.customSidebar;
    const now = Date.now();
    const botList = [
      { id: 'fleet', parentId: null, name: 'Fleet', status: 'active', model: 'claude-sonnet-4', thinking: null, identity: 'Fleet', places: [], sessionId: 'route-fleet' },
    ];
    const hosts = [
      { hostId: HUB, self: true, label: 'beelink', state: 'reachable', key: 'self', color: '#1af', dot: '', hasCache: true },
      { hostId: PEER, self: false, label: 'tycho', state: 'reachable', key: 'tycho', color: '#fa1', dot: '', hasCache: true },
    ];
    const selfActive: { id: string; host: string; name: string; cwd: string; isActive: boolean; lastActivity: number; harnessId?: string; parentId?: string; capabilities?: { close: boolean } }[] = [
      { id: 'route-fleet', host: HUB, name: 'Fleet', harnessId: 'bot', cwd: '/home', isActive: true, lastActivity: now },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `worker-${String(index).padStart(2, '0')}`, host: HUB, name: `Worker ${index}`, cwd: '/repo',
        parentId: 'route-fleet', isActive: true, capabilities: { close: true }, lastActivity: now - (index + 1) * 1000,
      })),
    ];
    const peerActive = Array.from({ length: 30 }, (_, index) => ({
      id: `peer-${String(index).padStart(2, '0')}`, host: PEER, name: `Peer ${index}`, cwd: `/srv/app-${String(Math.floor(index / 2)).padStart(2, '0')}`,
      isActive: true, capabilities: { close: true }, lastActivity: now - (index + 1) * 60_000,
    }));
    const render = (query = '') => {
      state.setSessionLists([{ hostId: HUB, active: selfActive }, { hostId: PEER, active: peerActive }]);
      controls.updateList(PiDishBrowser.renderSidebar({
        ...state.sessions, selected: null, tab: 'active', view: 'workspace', query, queriedFor: query, scope: '', indexing: false,
        contextMetric: 'percent', pending: [], selectedSpawn: null,
        expanded: controls.expanded, collapsed: controls.collapsed, pinned: controls.pinned, roots: controls.familyRoots(),
        closeConfirm: null, closeBusy: null, multiHost: true, hosts, bots: botList, botRetireArmed: null,
        botsHostId: HUB, selfHostId: HUB, unread: () => false, hostChip: () => '',
      }));
    };
    render();
    const topOf = (id: string) => {
      const el = fixtureElement(list.querySelector<HTMLElement>(`.session-item[data-id="${id}"]`), id);
      return el.getBoundingClientRect().top - list.getBoundingClientRect().top;
    };
    // Scroll down into the peer host section well below the Bots segment.
    const peer15 = fixtureElement(list.querySelector<HTMLElement>('.session-item[data-id="peer-15"]'), 'peer-15');
    list.scrollTop += peer15.getBoundingClientRect().top - list.getBoundingClientRect().top - 220;
    const beforeScroll = list.scrollTop;
    const beforeTop = topOf('peer-15');
    const botsSeg = fixtureElement(list.querySelector('.bots-segment'), '.bots-segment');
    const hostSeg = fixtureElement(peer15.closest('.host-section'), 'peer host section');

    // 1. Bot spawns 3 new workers nested inside .bots-segment above the scrolled viewport.
    for (let index = 1; index <= 3; index++) {
      selfActive.push({
        id: `worker-new-${index}`, host: HUB, name: `New Worker ${index}`, cwd: '/repo',
        parentId: 'route-fleet', isActive: true, capabilities: { close: true }, lastActivity: now + index * 1000,
      });
    }
    render();
    const afterBotSpawnTop = topOf('peer-15');
    const afterBotSpawnScroll = list.scrollTop;
    const keptAfterBotSpawn = botsSeg.isConnected && hostSeg.isConnected;

    // 2. Close a bot worker inside .bots-segment above the viewport.
    selfActive.splice(1, 2);
    render();
    const afterBotCloseTop = topOf('peer-15');
    const keptAfterBotClose = botsSeg.isConnected && hostSeg.isConnected;

    // 3. Switch to filtered search (.ranked-segment), scroll mid-list, close a mid-list row.
    render('Peer');
    const filteredTarget = fixtureElement(list.querySelector<HTMLElement>('.session-item[data-id="peer-15"]'), 'filtered peer-15');
    list.scrollTop += filteredTarget.getBoundingClientRect().top - list.getBoundingClientRect().top - 220;
    const beforeFilteredScroll = list.scrollTop;
    const beforeFiltered13 = topOf('peer-13');
    const beforeFiltered15 = topOf('peer-15');
    const idx = peerActive.findIndex(entry => entry.id === 'peer-15');
    peerActive.splice(idx, 1);
    render('Peer');
    const afterFilteredScroll = list.scrollTop;
    const afterFiltered13 = topOf('peer-13');
    const afterFiltered16 = topOf('peer-16');

    return {
      beforeScroll, afterBotSpawnScroll,
      botSpawnDelta: Math.abs(afterBotSpawnTop - beforeTop),
      botCloseDelta: Math.abs(afterBotCloseTop - beforeTop),
      keptAfterBotSpawn, keptAfterBotClose,
      filteredScrollDelta: Math.abs(afterFilteredScroll - beforeFilteredScroll),
      filtered13Delta: Math.abs(afterFiltered13 - beforeFiltered13),
      filtered16SlotDelta: Math.abs(afterFiltered16 - beforeFiltered15),
    };
  });
  expect(result.beforeScroll).toBeGreaterThan(1000);
  expect(result.afterBotSpawnScroll).toBeGreaterThan(result.beforeScroll);
  expect(result.botSpawnDelta).toBeLessThanOrEqual(1);
  expect(result.botCloseDelta).toBeLessThanOrEqual(1);
  expect(result.keptAfterBotSpawn).toBe(true);
  expect(result.keptAfterBotClose).toBe(true);
  expect(result.filteredScrollDelta).toBeLessThanOrEqual(1);
  expect(result.filtered13Delta).toBeLessThanOrEqual(1);
  expect(result.filtered16SlotDelta).toBeLessThanOrEqual(2);
});

export {};
