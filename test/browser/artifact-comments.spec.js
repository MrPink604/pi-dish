// Generated test/tool from test/browser/artifact-comments.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const fs = require("node:fs");
const path = require("node:path");
const script = fs.readFileSync(path.resolve(__dirname, '../../public/artifact-comments.js'), 'utf8');
const LIST = '/api/page-comments/page-fixture';
async function setup(page, comments = [], html = '<p id="text">before <b>selected</b> text after</p>') {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript((list) => {
        const request = window.fetch;
        window.artifactBodiesRead = 0;
        window.fetch = async (...args) => {
            const response = await request(...args);
            if (new URL(response.url).pathname === list && (args[1]?.method ?? 'GET') === 'GET') {
                const read = response.json.bind(response);
                response.json = async () => { const value = await read(); window.artifactBodiesRead++; return value; };
            }
            return response;
        };
        const original = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init) {
            return original.call(this, { ...init, mode: 'open' });
        };
    }, LIST);
    await page.route('http://artifact.test/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/artifact-comments.js')
            return route.fulfill({ contentType: 'application/javascript', body: script });
        if (url.pathname === LIST)
            return route.fulfill({ json: { comments } });
        return route.fulfill({ contentType: 'text/html', body: `${html}<script src="/artifact-comments.js" data-page-token="page-fixture"></script>` });
    });
    await page.goto('http://artifact.test/page');
    await (0, test_1.expect)(page.locator('#pi-dish-comment-layer')).toBeAttached();
    return errors;
}
async function select(page) {
    await page.evaluate(() => {
        const range = document.createRange();
        const node = document.querySelector('#text b');
        if (node === null)
            throw new Error('Missing selection node');
        range.selectNodeContents(node);
        const selection = window.getSelection();
        if (selection === null)
            throw new Error('Missing selection');
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    await (0, test_1.expect)(page.locator('#pi-dish-comment-layer #card')).toBeVisible();
}
function requiredRoute(route) {
    if (!route)
        throw new Error('Expected a held Playwright route');
    return route;
}
const comment = { id: 'comment-a', body: 'original',
    anchor: { type: 'text', quote: 'selected text', prefix: 'before ', suffix: ' after' } };
// The overlay's list and create calls share one URL; let creates fall through.
function listOnly(handler) {
    return (route) => route.request().method() === 'GET' ? handler(route) : route.fallback();
}
(0, test_1.test)('published comments anchor across nodes, edit with page-scoped routes and confirm delete', async ({ page }) => {
    const errors = await setup(page, [null, { id: {} }, comment]);
    await (0, test_1.expect)(page.locator('mark[data-pi-dish-comment="comment-a"]')).toHaveCount(2);
    await page.locator('mark').first().click();
    const body = page.locator('#pi-dish-comment-layer #body');
    await (0, test_1.expect)(body).toHaveValue('original');
    let patch;
    await page.route(`**${LIST}/comment-a`, async (route) => {
        const body = route.request().postData() ? route.request().postDataJSON() : {};
        if (!(0, wire_protocol_js_1.isRecord)(body))
            throw new Error('Invalid comment request');
        patch = { method: route.request().method(), ...body };
        await route.fulfill({ json: { ok: true } });
    });
    await body.fill('updated');
    await page.locator('#pi-dish-comment-layer #send').click();
    await (0, test_1.expect)(page.locator('#pi-dish-comment-layer #card')).toBeHidden();
    (0, test_1.expect)(patch).toEqual({ method: 'PATCH', body: 'updated' });
    await page.locator('mark').first().click();
    const del = page.locator('#pi-dish-comment-layer #del');
    await del.click();
    await (0, test_1.expect)(del).toHaveText('Delete?');
    await del.click();
    await (0, test_1.expect)(page.locator('#pi-dish-comment-layer #card')).toBeHidden();
    (0, test_1.expect)(patch).toEqual({ method: 'DELETE' });
    (0, test_1.expect)(errors).toEqual([]);
});
(0, test_1.test)('published marks preserve exact context and exclude scripts, styles and the overlay on refresh', async ({ page }) => {
    const exact = { ...comment, anchor: { type: 'text', quote: ' selected text ', prefix: 'right', suffix: 'after' } };
    const errors = await setup(page, [exact], '<p id="first">wrong <b>selected</b> text after</p><p id="chosen">right <b>selected</b><script type="application/json">ignored</script><style>/* ignored */</style> text after</p>');
    await (0, test_1.expect)(page.locator('#first mark')).toHaveCount(0);
    await (0, test_1.expect)(page.locator('#chosen mark')).toHaveCount(3);
    (0, test_1.expect)(await page.locator('#chosen mark').evaluateAll(marks => marks.map(mark => mark.textContent))).toEqual([' ', 'selected', ' text ']);
    (0, test_1.expect)(await page.locator('#chosen script').textContent()).toBe('ignored');
    (0, test_1.expect)(await page.locator('#chosen style').textContent()).toBe('/* ignored */');
    await page.locator('#chosen mark').nth(1).click();
    await (0, test_1.expect)(page.locator('#pi-dish-comment-layer #body')).toHaveValue('original');
    await page.evaluate(() => {
        const host = document.getElementById('pi-dish-comment-layer');
        if (!host)
            throw new Error('Missing comment layer');
        // Artifact scripts may relocate the injected host into the body. Its
        // light DOM must not steal a repeated quote from the artifact prose.
        host.append(document.createTextNode('right selected text after'));
        document.body.prepend(host);
    });
    await page.route(`**${LIST}/comment-a`, route => route.fulfill({ json: { ok: true } }));
    await page.locator('#pi-dish-comment-layer #send').click();
    await test_1.expect.poll(() => page.evaluate(() => window.artifactBodiesRead)).toBe(2);
    await (0, test_1.expect)(page.locator('#pi-dish-comment-layer mark')).toHaveCount(0);
    (0, test_1.expect)(await page.locator('#chosen mark').evaluateAll(marks => marks.map(mark => mark.textContent))).toEqual([' ', 'selected', ' text ']);
    (0, test_1.expect)(errors).toEqual([]);
});
(0, test_1.test)('a delayed save leaves a replacement draft intact and stays within mobile bounds', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 460 });
    const errors = await setup(page);
    let held;
    await page.route(`**${LIST}`, (route) => route.request().method() === 'POST' ? held = route : route.fallback());
    await select(page);
    const layer = page.locator('#pi-dish-comment-layer');
    await layer.locator('#body').fill('first');
    await layer.locator('#send').click();
    await test_1.expect.poll(() => !!held).toBe(true);
    await layer.locator('#cancel').click();
    await select(page);
    await layer.locator('#body').fill('replacement');
    await requiredRoute(held).fulfill({ json: { ok: true } });
    await (0, test_1.expect)(layer.locator('#toast')).toHaveText('Comment saved');
    await (0, test_1.expect)(layer.locator('#body')).toHaveValue('replacement');
    await (0, test_1.expect)(layer.locator('#card')).toBeVisible();
    await (0, test_1.expect)(layer.locator('#send')).toBeEnabled();
    const bounds = await layer.locator('#card').boundingBox();
    if (bounds === null)
        throw new Error('Missing comment card bounds');
    (0, test_1.expect)(bounds.x).toBeGreaterThanOrEqual(0);
    (0, test_1.expect)(bounds.y).toBeGreaterThanOrEqual(0);
    (0, test_1.expect)(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    (0, test_1.expect)(bounds.y + bounds.height).toBeLessThanOrEqual(460);
    (0, test_1.expect)(errors).toEqual([]);
});
(0, test_1.test)('an older comment list cannot restore marks after a newer empty one', async ({ page }) => {
    const errors = await setup(page);
    let held;
    await page.route(`**${LIST}`, listOnly((route) => { held = route; }));
    await page.reload();
    await test_1.expect.poll(() => !!held).toBe(true);
    const stale = requiredRoute(held);
    await page.route(`**${LIST}`, listOnly((route) => route.fulfill({ json: { comments: [] } })));
    await select(page);
    await page.locator('#pi-dish-comment-layer #body').fill('trigger refresh');
    const fresh = page.waitForResponse(response => new URL(response.url()).pathname === LIST
        && response.request().method() === 'GET');
    await page.locator('#pi-dish-comment-layer #send').click();
    await fresh;
    await test_1.expect.poll(() => page.evaluate(() => window.artifactBodiesRead)).toBe(1);
    await stale.fulfill({ json: { comments: [comment] } });
    await test_1.expect.poll(() => page.evaluate(() => window.artifactBodiesRead)).toBe(2);
    await (0, test_1.expect)(page.locator('mark[data-pi-dish-comment]')).toHaveCount(0);
    (0, test_1.expect)(errors).toEqual([]);
});
(0, test_1.test)('finishing an old delete cannot enable the button for a newer pending delete', async ({ page }) => {
    const errors = await setup(page, [comment]);
    const pending = [];
    await page.route(`**${LIST}/comment-a`, (route) => { pending.push(route); });
    const layer = page.locator('#pi-dish-comment-layer');
    await page.locator('mark').first().click();
    await layer.locator('#del').click();
    await layer.locator('#del').click();
    await test_1.expect.poll(() => pending.length).toBe(1);
    await layer.locator('#cancel').click();
    await page.locator('mark').first().click();
    await (0, test_1.expect)(layer.locator('#del')).toBeEnabled();
    await layer.locator('#del').click();
    await layer.locator('#del').click();
    await test_1.expect.poll(() => pending.length).toBe(2);
    await pending[0].fulfill({ status: 500, json: { error: 'old failure' } });
    await (0, test_1.expect)(layer.locator('#status')).toHaveText('Deleting…');
    await (0, test_1.expect)(layer.locator('#del')).toBeDisabled();
    await pending[1].fulfill({ status: 500, json: { error: 'current failure' } });
    await (0, test_1.expect)(layer.locator('#status')).toHaveText('current failure');
    await (0, test_1.expect)(layer.locator('#del')).toBeEnabled();
    (0, test_1.expect)(errors).toEqual([]);
});
