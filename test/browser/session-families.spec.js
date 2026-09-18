// Generated test/tool from test/browser/session-families.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fixtures_js_1 = require("./fixtures.js");
(0, fixtures_js_1.test)('expanding an unselected peer family leaves the selected host collapsed', async ({ page, fleet }) => {
    const { self, peer, select, row } = fleet;
    await select(self);
    await row(peer).locator('.session-family-toggle').click();
    await (0, fixtures_js_1.expect)(row(peer, fixtures_js_1.CHILD)).toBeVisible();
    await (0, fixtures_js_1.expect)(row(self, fixtures_js_1.CHILD)).toHaveCount(0);
    await (0, fixtures_js_1.expect)(row(self)).toHaveClass(/\bactive\b/);
    await row(peer).locator('.session-family-toggle').click();
    await (0, fixtures_js_1.expect)(row(peer, fixtures_js_1.CHILD)).toHaveCount(0);
});
const hostTargets = ['self', 'peer'];
for (const target of hostTargets) {
    (0, fixtures_js_1.test)(`selecting a hidden ${target} child reveals only its own ancestors`, async ({ fleet }) => {
        const { select, row } = fleet;
        const host = fleet[target];
        const other = fleet[target === 'self' ? 'peer' : 'self'];
        await select(other);
        await select(host, fixtures_js_1.CHILD);
        await (0, fixtures_js_1.expect)(row(host, fixtures_js_1.CHILD)).toBeVisible();
        await (0, fixtures_js_1.expect)(row(host, fixtures_js_1.CHILD)).toHaveClass(/\bactive\b/);
        await (0, fixtures_js_1.expect)(row(other, fixtures_js_1.CHILD)).toHaveCount(0);
    });
}
(0, fixtures_js_1.test)('pinning an unselected peer family persists only that host', async ({ page, fleet }) => {
    const { self, peer, select, row } = fleet;
    await select(self);
    await row(peer).locator('.session-pin-btn').click();
    await fixtures_js_1.expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') ?? '[]')))
        .toEqual([`${peer.hostId} ${fixtures_js_1.ROOT}`]);
    await page.reload();
    await page.locator('#tabAll').click();
    await (0, fixtures_js_1.expect)(row(peer).locator('.session-pin-btn')).toHaveAttribute('title', /Unpin/);
    await (0, fixtures_js_1.expect)(row(self).locator('.session-pin-btn')).toHaveAttribute('title', /Pin/);
    await row(peer).locator('.session-pin-btn').click();
    await fixtures_js_1.expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') ?? '[]')))
        .toEqual([]);
});
(0, fixtures_js_1.test)('a peer-only parent hint cannot change another host child pin', async ({ page, fleet }) => {
    const { self, peer, select, row } = fleet;
    await select(self, fixtures_js_1.CHILD);
    // Simulate an API refresh where the peer's ancestor is outside the loaded
    // history page. The self-host child still belongs to its visible root.
    await page.evaluate(({ id, host }) => window.fixtureSessionListPatch(id, { familyParentId: 'peer-only-parent' }, host), { id: fixtures_js_1.CHILD, host: peer.hostId });
    await row(self, fixtures_js_1.CHILD).locator('.session-pin-btn').click();
    await fixtures_js_1.expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') ?? '[]')))
        .toEqual([`${self.hostId} ${fixtures_js_1.ROOT}`]);
});
(0, fixtures_js_1.test)('dragging same-id pinned families preserves both hosts and their order', async ({ page, fleet }) => {
    const { self, peer, select, row } = fleet;
    await select(self);
    await row(self).locator('.session-pin-btn').click();
    await row(peer).locator('.session-pin-btn').click();
    const source = await row(peer).locator('.session-drag-handle').boundingBox();
    if (source === null)
        throw new Error('Missing source');
    const destination = await row(self).boundingBox();
    if (destination === null)
        throw new Error('Missing destination');
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(destination.x + 20, destination.y + 2, { steps: 5 });
    await page.mouse.up();
    await fixtures_js_1.expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') ?? '[]')))
        .toEqual([`${peer.hostId} ${fixtures_js_1.ROOT}`, `${self.hostId} ${fixtures_js_1.ROOT}`]);
    await (0, fixtures_js_1.expect)(page.locator('.pinned-segment > .session-family-root')).toHaveCount(2);
});
