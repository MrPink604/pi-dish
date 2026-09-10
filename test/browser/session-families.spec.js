const { test, expect, ROOT, CHILD } = require('./fixtures');

test('expanding an unselected peer family leaves the selected host collapsed', async ({ page, fleet }) => {
  const { self, peer, select, row } = fleet;
  await select(self);
  await row(peer).locator('.session-family-toggle').click();
  await expect(row(peer, CHILD)).toBeVisible();
  await expect(row(self, CHILD)).toHaveCount(0);
  await expect(row(self)).toHaveClass(/\bactive\b/);
  await row(peer).locator('.session-family-toggle').click();
  await expect(row(peer, CHILD)).toHaveCount(0);
});

for (const target of ['self', 'peer']) {
  test(`selecting a hidden ${target} child reveals only its own ancestors`, async ({ fleet }) => {
    const { select, row } = fleet;
    const host = fleet[target];
    const other = fleet[target === 'self' ? 'peer' : 'self'];
    await select(other);
    await select(host, CHILD);
    await expect(row(host, CHILD)).toBeVisible();
    await expect(row(host, CHILD)).toHaveClass(/\bactive\b/);
    await expect(row(other, CHILD)).toHaveCount(0);
  });
}

test('pinning an unselected peer family persists only that host', async ({ page, fleet }) => {
  const { self, peer, select, row } = fleet;
  await select(self);
  await row(peer).locator('.session-pin-btn').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions'))))
    .toEqual([`${peer.hostId} ${ROOT}`]);
  await page.reload();
  await page.locator('#tabAll').click();
  await expect(row(peer).locator('.session-pin-btn')).toHaveAttribute('title', /Unpin/);
  await expect(row(self).locator('.session-pin-btn')).toHaveAttribute('title', /Pin/);
  await row(peer).locator('.session-pin-btn').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions'))))
    .toEqual([]);
});

test('a peer-only parent hint cannot change another host child pin', async ({ page, fleet }) => {
  const { self, peer, select, row } = fleet;
  await select(self, CHILD);
  // Simulate an API refresh where the peer's ancestor is outside the loaded
  // history page. The self-host child still belongs to its visible root.
  await page.evaluate(({ id, host }) => sessionState.patchSession(id, { familyParentId: 'peer-only-parent' }, host),
    { id: CHILD, host: peer.hostId });
  await row(self, CHILD).locator('.session-pin-btn').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions'))))
    .toEqual([`${self.hostId} ${ROOT}`]);
});

test('dragging same-id pinned families preserves both hosts and their order', async ({ page, fleet }) => {
  const { self, peer, select, row } = fleet;
  await select(self);
  await row(self).locator('.session-pin-btn').click();
  await row(peer).locator('.session-pin-btn').click();
  const source = await row(peer).locator('.session-drag-handle').boundingBox();
  const destination = await row(self).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x + 20, destination.y + 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions'))))
    .toEqual([`${peer.hostId} ${ROOT}`, `${self.hostId} ${ROOT}`]);
  await expect(page.locator('.pinned-segment > .session-family-root')).toHaveCount(2);
});
