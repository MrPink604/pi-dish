import { isRecord } from '../../lib/wire-protocol.js';
import type { SelectionOwner } from '../../src/browser/session-state.js';
import { test, expect, ROOT } from './fixtures.js';

test('thinking selector copies levels, carries owners and disposes without leaving active handlers', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const root = document.createElement('div');
    document.body.append(root);
    const owner = fixtureApp.features.sessionState.captureSelection();
    if (owner === null) throw new Error('Missing owner');
    const levels = ['off', 'high'];
    const unusual = "future'<b>level</b>";
    const calls: unknown[] = [];
    const actions = {
      selectLevel: (target: SelectionOwner, level: string) => calls.push(['select', target.host, level]),
      requestClose: (target: SelectionOwner) => calls.push(['close', target.host]),
    };
    const selector = PiDishBrowser.mountThinkingSelector(root, actions);
    const view = { owner, levels, currentLevel: unusual };
    selector.update(view);
    const labels = [...root.children].map(node => node.textContent);
    const active = fixtureElement(root.querySelector<HTMLElement>('.active'), 'active thinking option');
    const pressed = active.getAttribute('aria-pressed');
    const hasMarkup = !!root.querySelector('b, [onclick]');
    active.click();
    const oldButton = fixtureElement(root.querySelector<HTMLElement>(':scope > *'), 'old thinking button');
    selector.update({ ...view, owner: { ...owner, host: 'other-host' }, currentLevel: 'high' });
    oldButton.click(); // a detached option from the prior update is inert
    fixtureElement(root.querySelector<HTMLElement>('.active'), 'active thinking option').click();
    const nextLabels = [...root.children].map(node => node.textContent);
    selector.dispose();
    selector.dispose();
    selector.update(view);
    active.click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const empty = root.childElementCount === 0;
    const again = PiDishBrowser.mountThinkingSelector(root, actions);
    again.update(view);
    fixtureElement(root.querySelector<HTMLElement>(':scope > *'), 'thinking option').click();
    again.dispose(); root.remove();
    return { labels, nextLabels, levels, pressed, hasMarkup, empty, calls, host: owner.host, unusual };
  });
  expect(result.labels).toEqual(['off', 'high', result.unusual]);
  expect(result.nextLabels).toEqual(['off', 'high']);
  expect(result.levels).toEqual(['off', 'high']);
  expect(result.pressed).toBe('true');
  expect(result.hasMarkup).toBe(false);
  expect(result.empty).toBe(true);
  expect(result.calls).toEqual([
    ['select', result.host, result.unusual], ['select', 'other-host', 'high'], ['select', result.host, 'off'],
  ]);
});

test('thinking options support native Enter and Space activation and owned Escape', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    const root = document.createElement('div');
    root.id = 'thinkingFixture';
    root.className = 'thinking-dropdown';
    root.style.top = '20px'; root.style.left = '20px';
    document.body.append(root);
    window.thinkingFixtureCalls = [];
    window.thinkingFixture = PiDishBrowser.mountThinkingSelector(root, {
      selectLevel: (owner, level) => window.thinkingFixtureCalls.push(['select', owner.host, level]),
      requestClose: owner => window.thinkingFixtureCalls.push(['close', owner.host]),
    });
    window.thinkingFixture.update({ owner: fixtureElement(fixtureApp.features.sessionState.captureSelection(), 'thinking fixture owner'), levels: ['off', 'high'], currentLevel: 'high' });
  });
  const root = page.locator('#thinkingFixture');
  await root.getByRole('button', { name: 'high', exact: true }).press('Enter');
  await root.getByRole('button', { name: 'off', exact: true }).press('Space');
  await root.getByRole('button', { name: 'off', exact: true }).press('Escape');
  expect(await page.evaluate(() => window.thinkingFixtureCalls)).toEqual([
    ['select', fleet.self.hostId, 'high'], ['select', fleet.self.hostId, 'off'], ['close', fleet.self.hostId],
  ]);
  await page.evaluate(() => { window.thinkingFixture.dispose(); fixtureElement(document.getElementById('thinkingFixture'), "document.getElementById('thinkingFixture')").remove(); });
});

test.describe('live thinking selector', () => {
  test.use({ liveSessions: true });

  test('an unusual current level is literal, uses the owning API and cannot leak into another session menu', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const unusual = "future'<b>level</b>";
    await page.evaluate(level => window.fixtureSessionListPatch(fixtureCurrentSession().id, { thinkingLevel: level }), unusual);
    const requests: unknown[] = [];
    await page.route(`${fleet.self.base}/api/sessions/${ROOT}/thinking`, route => {
      const body: unknown = route.request().postDataJSON();
      if (!isRecord(body)) throw new Error('Invalid thinking request');
      requests.push(body);
      return route.fulfill({ json: { success: true, level: body.level } });
    });
    await page.click('#sessionThinking');
    const root = page.locator('#thinkingDropdown');
    await expect(root.getByRole('button', { name: unusual, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(root.locator('b, [onclick]')).toHaveCount(0);
    await root.getByRole('button', { name: unusual, exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests).toEqual([{ level: unusual }]);
    await expect(root).toBeHidden();
    expect(await page.evaluate(() => fixtureApp.features.sessionControls.thinkingSelector)).toBeNull();
    expect(await page.evaluate(() => [...THINKING_LEVEL_NAMES])).not.toContain(unusual);

    await fleet.select(fleet.peer);
    await page.click('#sessionThinking');
    await expect(root.getByRole('button', { name: unusual, exact: true })).toHaveCount(0);
    await root.getByRole('button').first().press('Escape');
    await expect(root).toBeHidden();
    await expect(root.locator('.thinking-option')).toHaveCount(0);
  });

  test('the app drops a thinking action whose captured owner no longer owns selection', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.click('#sessionThinking');
    await expect(page.locator('#thinkingDropdown .thinking-option')).not.toHaveCount(0);
    const after = await page.evaluate(({ id, host }) => {
      const request = fixtureApp.features.apiTransport.request;
      let sends = 0;
      fixtureApp.features.apiTransport.request = (target, path, options) => {
        if (path.endsWith('/thinking')) {
          sends++;
          return Promise.resolve(new Response(JSON.stringify({ success: true, level: 'high' })));
        }
        return request(target, path, options);
      };
      // Leave the old DOM in place to exercise the action adapter's owner check
      // independently of normal selection-change disposal.
      fixtureApp.features.sessionState.advanceSelection();
      fixtureApp.features.sessionState.setCurrentSession(id, host);
      fixtureElement(document.querySelector<HTMLElement>('#thinkingDropdown .thinking-option'), 'thinking option').click();
      fixtureApp.features.sessionControls.closeThinking();
      fixtureApp.features.apiTransport.request = request;
      return { owner: fixtureApp.features.sessionState.captureSelection(), sends };
    }, { id: ROOT, host: fleet.peer.hostId });
    if (after.owner === null) throw new Error('Missing replacement thinking owner');
    expect(after.owner.host).toBe(fleet.peer.hostId);
    expect(after.sends).toBe(0);
    await expect(page.locator('#thinkingDropdown .thinking-option')).toHaveCount(0);
  });
});

export {};
