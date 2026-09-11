const { test, expect, ROOT } = require('./fixtures');

test('thinking selector copies levels, carries owners and disposes without leaving active handlers', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const result = await page.evaluate(() => {
    const root = document.createElement('div');
    document.body.append(root);
    const owner = sessionState.captureSelection();
    const levels = ['off', 'high'];
    const unusual = "future'<b>level</b>";
    const calls = [];
    const actions = {
      selectLevel: (target, level) => calls.push(['select', target.host, level]),
      requestClose: target => calls.push(['close', target.host]),
    };
    const selector = PiDishBrowser.mountThinkingSelector(root, actions);
    const view = { owner, levels, currentLevel: unusual };
    selector.update(view);
    const labels = [...root.children].map(node => node.textContent);
    const active = root.querySelector('.active');
    const pressed = active.getAttribute('aria-pressed');
    const hasMarkup = !!root.querySelector('b, [onclick]');
    active.click();
    const oldButton = root.firstElementChild;
    selector.update({ ...view, owner: { ...owner, host: 'other-host' }, currentLevel: 'high' });
    oldButton.click(); // a detached option from the prior update is inert
    root.querySelector('.active').click();
    const nextLabels = [...root.children].map(node => node.textContent);
    selector.dispose();
    selector.dispose();
    selector.update(view);
    active.click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const empty = root.childElementCount === 0;
    const again = PiDishBrowser.mountThinkingSelector(root, actions);
    again.update(view);
    root.firstElementChild.click();
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
    window.thinkingFixture.update({ owner: sessionState.captureSelection(), levels: ['off', 'high'], currentLevel: 'high' });
  });
  const root = page.locator('#thinkingFixture');
  await root.getByRole('button', { name: 'high', exact: true }).press('Enter');
  await root.getByRole('button', { name: 'off', exact: true }).press('Space');
  await root.getByRole('button', { name: 'off', exact: true }).press('Escape');
  expect(await page.evaluate(() => window.thinkingFixtureCalls)).toEqual([
    ['select', fleet.self.hostId, 'high'], ['select', fleet.self.hostId, 'off'], ['close', fleet.self.hostId],
  ]);
  await page.evaluate(() => { window.thinkingFixture.dispose(); document.getElementById('thinkingFixture').remove(); });
});

test.describe('live thinking selector', () => {
  test.use({ liveSessions: true });

  test('an unusual current level is literal, uses the owning API and cannot leak into another session menu', async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    const unusual = "future'<b>level</b>";
    await page.evaluate(level => sessionState.mergeCurrentSession(sessionState.captureSelection(), { thinkingLevel: level }), unusual);
    const requests = [];
    await page.route(`${fleet.self.base}/api/sessions/${ROOT}/thinking`, route => {
      const body = route.request().postDataJSON();
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
    expect(await page.evaluate(() => thinkingSelector)).toBeNull();
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
      const request = apiFetch;
      let sends = 0;
      apiFetch = (target, path, options) => {
        if (path.endsWith('/thinking')) {
          sends++;
          return Promise.resolve(new Response(JSON.stringify({ success: true, level: 'high' })));
        }
        return request(target, path, options);
      };
      // Leave the old DOM in place to exercise the action adapter's owner check
      // independently of normal selection-change disposal.
      sessionState.advanceSelection();
      sessionState.setCurrentSession(id, host);
      document.querySelector('#thinkingDropdown .thinking-option').click();
      closeThinkingDropdown();
      apiFetch = request;
      return { owner: sessionState.captureSelection(), sends };
    }, { id: ROOT, host: fleet.peer.hostId });
    expect(after.owner.host).toBe(fleet.peer.hostId);
    expect(after.sends).toBe(0);
    await expect(page.locator('#thinkingDropdown .thinking-option')).toHaveCount(0);
  });
});
