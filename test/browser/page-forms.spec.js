// Generated test/tool from test/browser/page-forms.spec.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const helper_values_js_1 = require("../../lib/helper-values.js");
const fixtures_js_1 = require("./fixtures.js");
fixtures_js_1.test.use({ liveSessions: true });
// A 1x1 PNG stands in for the gallery's images.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SPEC = {
    title: 'Gallery picks',
    fields: [
        { id: 'row4', type: 'grid', label: 'Row 4', rows: [
                { id: '4.1', label: 'Hero', default: 'A', options: [{ value: 'A', image: 'a.png' }, { value: 'B', image: 'b.png' }] },
                { id: '4.2', label: 'Kitchen', default: 'A', options: [{ value: 'A', image: 'a.png' }, { value: 'B', image: 'b.png' }] },
            ] },
        { id: '12.2', type: 'choice', label: 'Garden', default: 'C', options: ['A', 'B', 'C'] },
        { id: 'rule6', type: 'approve', label: 'Rule 6', yes: 'ok', no: 'not ok', default: true },
        { id: 'notes', type: 'longtext', label: 'Notes' },
    ],
};
async function publish(self, name, body) {
    const site = path.join(self.home, name);
    fs.mkdirSync(site);
    fs.writeFileSync(path.join(site, 'a.png'), PIXEL);
    fs.writeFileSync(path.join(site, 'b.png'), PIXEL);
    fs.writeFileSync(path.join(site, 'index.html'), body);
    const response = await fetch(`${self.base}/api/pages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: site, sessionId: fixtures_js_1.ROOT, title: 'OSBG gallery' }),
    });
    const published = await response.json();
    if (!(0, helper_values_js_1.record)(published) || typeof published.path !== 'string' || typeof published.token !== 'string') {
        throw new Error(`Page publish failed: ${JSON.stringify(published)}`);
    }
    return { path: published.path, token: published.token };
}
// The form API refuses callers that do not name themselves; the test calls as the CLI does.
function formApi(self, token, suffix = '', init = {}) {
    return fetch(`${self.base}/api/page-forms/${token}${suffix}`, { ...init, headers: { 'X-Pi-Dish-Form-Client': 'cli', ...init.headers } });
}
// Another view's submission, waited on until delivered.
async function submitElsewhere(self, token, submissionId, answers) {
    const state = await (await formApi(self, token)).json();
    if (!(0, helper_values_js_1.record)(state))
        throw new Error('no form state');
    const response = await formApi(self, token, '', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, fingerprint: state.fingerprint, expectedRevision: state.revision, answers }),
    });
    (0, fixtures_js_1.expect)(response.status).toBe(202);
    await fixtures_js_1.expect.poll(async () => {
        const body = await (await formApi(self, token, `/receipts/${submissionId}`)).json();
        return (0, helper_values_js_1.record)(body) && (0, helper_values_js_1.record)(body.receipt) ? body.receipt.state : null;
    }).toBe('delivered');
}
const formHtml = (extra = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>
<h1>Gallery</h1><script type="application/pi-dish-form">${JSON.stringify(SPEC)}</script>${extra}</body></html>`;
(0, fixtures_js_1.test)('the owner answers in pi-dish\'s own form view: defaults, changes, a kept draft, submit and a revision', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'gallery', formHtml());
    const prompts = () => self.commands.filter(command => command.command === 'prompt');
    const tab = await page.context().newPage();
    await tab.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    // The sandboxed page is a read-only preview whose only way in is a plain link.
    await tab.goto(`${self.base}${published.path}/`);
    const preview = tab.locator('[data-pi-dish-form]');
    await (0, fixtures_js_1.expect)(preview.locator('fieldset[data-q="4.2"] input[value="B"]')).toBeDisabled();
    await (0, fixtures_js_1.expect)(preview.locator('button, [type="submit"]')).toHaveCount(0);
    await preview.locator('a[data-pi-dish-answer]').click();
    await (0, fixtures_js_1.expect)(tab).toHaveURL(`${self.base}/forms/${published.token}`);
    const form = tab.locator('#pdfApp form.pdf');
    const question = (id) => form.locator(`fieldset[data-q="${id}"]`);
    const option = (id, value) => question(id).locator('.pdf-opt', { has: tab.locator(`input[value="${value}"]`) });
    const summary = form.locator('.pdf-summary');
    const status = form.locator('.pdf-status');
    const submit = form.locator('button[type="submit"]');
    await (0, fixtures_js_1.expect)(summary).toHaveText('No changes from the defaults');
    await (0, fixtures_js_1.expect)(question('4.2').locator('input[value="A"]')).toBeChecked();
    await (0, fixtures_js_1.expect)(question('4.2').locator('img').first()).toHaveAttribute('src', `/page/${published.token}/a.png`);
    for (const target of [option('4.2', 'B'), option('rule6', 'false'), submit]) {
        const box = await target.boundingBox();
        (0, fixtures_js_1.expect)(box && box.height >= 44 && box.width >= 44, 'tap targets are at least 44px').toBe(true);
    }
    await option('4.2', 'B').click();
    await option('12.2', 'A').click();
    await (0, fixtures_js_1.expect)(question('4.2')).toHaveAttribute('data-changed', '');
    await (0, fixtures_js_1.expect)(question('12.2')).toHaveAttribute('data-changed', '');
    await (0, fixtures_js_1.expect)(question('4.1')).not.toHaveAttribute('data-changed');
    await (0, fixtures_js_1.expect)(summary).toHaveText('2 changed from default: 4.2 → B, 12.2 → A');
    await tab.reload();
    await (0, fixtures_js_1.expect)(status).toHaveText('Draft restored');
    await (0, fixtures_js_1.expect)(question('4.2').locator('input[value="B"]')).toBeChecked();
    await (0, fixtures_js_1.expect)(submit).toBeInViewport();
    // Hold the first receipt poll and edit meanwhile: the edit must survive the delivery.
    const held = (0, fixtures_js_1.heldRoute)();
    await tab.route('**/receipts/**', route => held.hold(route), { times: 1 });
    await submit.click();
    const route = (0, fixtures_js_1.requiredRoute)(await held.received);
    await form.locator('fieldset[data-q="notes"] textarea').fill('typed while sending');
    await route.continue();
    await (0, fixtures_js_1.expect)(status).toHaveText(/^Submitted .+ — delivered to the agent$/);
    await (0, fixtures_js_1.expect)(form).toHaveAttribute('data-submitted', '1');
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(1);
    const first = String(prompts()[0].message);
    (0, fixtures_js_1.expect)(first).toMatch(new RegExp(`^\\[form response: OSBG gallery \\(${published.token}\\), submitted \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ\\]\\n`));
    const lines = first.split('\n').slice(1);
    (0, fixtures_js_1.expect)(lines.slice(0, -1)).toEqual([
        '4.2: B (default A)', '12.2: A (default C)', 'all other fields: default', 'unanswered: notes',
    ]);
    // The footer names this submission's own stored answer set.
    const footer = new RegExp(`^full answer set: pi-dish-pages answers ${published.token} --submission ([0-9a-f]{32})$`).exec(lines.at(-1) ?? '');
    (0, fixtures_js_1.expect)(footer).not.toBeNull();
    const named = await (await formApi(self, published.token, `?submission=${footer?.[1]}`)).json();
    (0, fixtures_js_1.expect)((0, helper_values_js_1.record)(named) && (0, helper_values_js_1.record)(named.submission) ? named.submission.answers : null)
        .toEqual({ '4.1': 'A', '4.2': 'B', '12.2': 'A', rule6: true, notes: null });
    (0, fixtures_js_1.expect)(prompts()[0].deliverAs, 'an idle session gets an ordinary prompt').toBeUndefined();
    await (0, fixtures_js_1.expect)(summary).toContainText('edited since submitting');
    // The submitted answers come back from the server; the later edit stays a draft.
    await tab.reload();
    await (0, fixtures_js_1.expect)(status).toHaveText(/^Draft restored · last submitted /);
    await (0, fixtures_js_1.expect)(question('12.2').locator('input[value="A"]')).toBeChecked();
    await (0, fixtures_js_1.expect)(form.locator('fieldset[data-q="notes"] textarea')).toHaveValue('typed while sending');
    await (0, fixtures_js_1.expect)(submit).toHaveText('Submit revision');
    await option('rule6', 'false').click();
    await (0, fixtures_js_1.expect)(summary).toHaveText('3 changed from default: 4.2 → B, 12.2 → A, rule6 → not ok · edited since submitting');
    await submit.click();
    await (0, fixtures_js_1.expect)(form).toHaveAttribute('data-submitted', '2');
    await (0, fixtures_js_1.expect)(status).toHaveText(/^Submitted .+ \(revision 2\) — delivered to the agent$/);
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(2);
    (0, fixtures_js_1.expect)(String(prompts()[1].message)).toMatch(/^\[form response revision 2: OSBG gallery .*; replaces the response of .*\]\n4\.2: B \(default A\)\n12\.2: A \(default C\)\nrule6: not ok \(default ok\)\nall other fields: default\nnotes: typed while sending\n/);
    (0, fixtures_js_1.expect)(errors).toEqual([]);
    await tab.close();
});
(0, fixtures_js_1.test)('a script in the published page cannot read or submit its form, even with a correct payload', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'hostile', formHtml());
    const state = await (await formApi(self, published.token)).json();
    const fingerprint = (0, helper_values_js_1.record)(state) ? state.fingerprint : null;
    (0, fixtures_js_1.expect)(typeof fingerprint).toBe('string');
    const payload = JSON.stringify({ submissionId: 'hostile-0001', fingerprint, expectedRevision: 0, answers: { '4.2': 'B' } });
    // The agent's own script: every route to the form API, with the owner's cookie available.
    fs.writeFileSync(path.join(self.home, 'hostile', 'index.html'), formHtml(`
<output id="read">pending</output><output id="json">pending</output><output id="plain">pending</output>
<form id="post" method="post" action="/api/page-forms/${published.token}" enctype="text/plain" target="sink"><input name='${payload.slice(0, -1)}, "x":"' value='"}'></form>
<iframe name="sink" id="sink"></iframe>
<script>
  const url = '/api/page-forms/${published.token}';
  const show = (id, value) => { document.getElementById(id).textContent = value; };
  fetch(url, { credentials: 'include' }).then(r => r.text().then(t => show('read', r.status + ' ' + t)), e => show('read', e.name));
  fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(payload)} })
    .then(r => show('json', String(r.status)), e => show('json', e.name));
  fetch(url, { method: 'POST', credentials: 'include', body: ${JSON.stringify(payload)} })
    .then(r => show('plain', String(r.status)), e => show('plain', e.name));
  document.getElementById('post').submit();
</script>`));
    const tab = await page.context().newPage();
    const app = self.base.replace('127.0.0.1', 'localhost');
    await tab.goto(`${app}/api/host`);
    await tab.evaluate(() => { document.cookie = 'CF_Authorization=proxy-session; Path=/; SameSite=None; Secure'; });
    const attempted = [];
    const statuses = [];
    const callsFormApi = (url) => new URL(url).pathname.startsWith('/api/page-forms/');
    tab.on('request', (request) => { if (callsFormApi(request.url()))
        attempted.push(request.method()); });
    tab.on('response', response => { if (callsFormApi(response.url()))
        statuses.push(response.status()); });
    await tab.goto(`${app}${published.path}/`);
    await (0, fixtures_js_1.expect)(tab.locator('#read')).toHaveText('TypeError');
    await (0, fixtures_js_1.expect)(tab.locator('#json')).toHaveText('TypeError');
    await (0, fixtures_js_1.expect)(tab.locator('#plain')).toHaveText('TypeError');
    // The form post navigates the frame, so its refusal is observable; the fetches fail CORS.
    await fixtures_js_1.expect.poll(() => statuses.length).toBeGreaterThanOrEqual(1);
    (0, fixtures_js_1.expect)(attempted.filter(method => method === 'POST').length).toBeGreaterThanOrEqual(2);
    for (const status of statuses)
        (0, fixtures_js_1.expect)([403, 415]).toContain(status);
    const receipt = await formApi(self, published.token, '/receipts/hostile-0001');
    (0, fixtures_js_1.expect)(receipt.status, 'no attempt was ever accepted').toBe(404);
    const after = await (await formApi(self, published.token)).json();
    (0, fixtures_js_1.expect)((0, helper_values_js_1.record)(after) ? after.revision : null).toBe(0);
    (0, fixtures_js_1.expect)(self.commands.filter(command => command.command === 'prompt')).toHaveLength(0);
    await tab.close();
});
(0, fixtures_js_1.test)('pi-dish\'s form view cannot be framed', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'framed', formHtml());
    const response = await fetch(`${self.base}/forms/${published.token}`);
    (0, fixtures_js_1.expect)(response.headers.get('x-frame-options')).toBe('DENY');
    const tab = await page.context().newPage();
    await tab.goto(`${self.base}/api/host`);
    await tab.setContent(`<iframe id="victim" src="${self.base}/forms/${published.token}"></iframe>`);
    const frame = tab.frameLocator('#victim');
    await (0, fixtures_js_1.expect)(frame.locator('#pdfApp')).toHaveCount(0);
    await tab.close();
});
// OSBG's published form, as its bot linked it: `[Aurel paint](/forms/<token>)`.
const OSBG_SPEC = {
    title: 'Aurel\'s colours',
    intro: 'One pick: the colourway. Racing green is preselected as my guess.',
    fields: [
        { id: 'paint', type: 'choice', label: 'Which colourway is Aurel\'s', required: true, default: '3 Racing green', options: [
                { value: '1 Service', image: 'a.png' }, { value: '2 Umber', image: 'b.png' }, { value: '3 Racing green', image: 'a.png' },
                { value: '4 Oxblood', image: 'b.png' }, { value: '5 Night', image: 'a.png' },
            ] },
        { id: 'rule6', type: 'approve', label: 'New wording of style rule 6', yes: 'fine', no: 'change it', default: true },
        { id: 'names', type: 'approve', label: 'Names: Halden Arsenal and Aurel Foundry', yes: 'keep both', no: 'replace', default: true },
        { id: 'notes', type: 'longtext', label: 'Anything else?' },
    ],
};
(0, fixtures_js_1.test)('a /forms link in the transcript opens the live form view, not the file viewer', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'osbg', `<!doctype html><html><body><h1>Your pick</h1><script type="application/pi-dish-form">${JSON.stringify(OSBG_SPEC)}</script></body></html>`);
    const markdown = `Both forms still need your answers:\n1. [Aurel paint](/forms/${published.token})\n2. \`/forms/${published.token}\``;
    await page.route(`${self.base}/api/sessions/${fixtures_js_1.ROOT}/messages?**`, route => route.fulfill({
        json: { messages: [{ role: 'assistant', index: 0, content: markdown }], session: {} },
    }));
    await fleet.select(self);
    const links = page.locator('#messages a.published-link');
    await (0, fixtures_js_1.expect)(links).toHaveCount(2);
    await (0, fixtures_js_1.expect)(page.locator('#messages .file-link')).toHaveCount(0);
    const opened = page.context().waitForEvent('page');
    await links.first().click();
    const tab = await opened;
    await (0, fixtures_js_1.expect)(tab).toHaveURL(`${self.base}/forms/${published.token}`);
    await (0, fixtures_js_1.expect)(page.locator('#sessionView.file-open')).toHaveCount(0);
    await tab.setViewportSize({ width: 390, height: 844 });
    const paint = tab.locator('#pdfApp form.pdf fieldset[data-q="paint"]');
    await (0, fixtures_js_1.expect)(paint.locator('input[value="3 Racing green"]')).toBeChecked();
    await paint.locator('.pdf-opt', { has: tab.locator('input[value="2 Umber"]') }).click();
    await (0, fixtures_js_1.expect)(paint.locator('input[value="2 Umber"]')).toBeChecked();
    await (0, fixtures_js_1.expect)(tab.locator('#pdfApp .pdf-summary')).toHaveText('1 changed from default: paint → 2 Umber');
    await tab.close();
});
(0, fixtures_js_1.test)('the page preview reads as disabled and turns a tap anywhere on it into the answer button (phone width)', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'osbg-preview', `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><h1>Your pick</h1><script type="application/pi-dish-form">${JSON.stringify(OSBG_SPEC)}</script></body></html>`);
    const tab = await page.context().newPage();
    await tab.setViewportSize({ width: 390, height: 844 });
    await tab.goto(`${self.base}${published.path}/`);
    const preview = tab.locator('[data-pi-dish-form]');
    const answer = preview.locator('a[data-pi-dish-answer]');
    const night = preview.locator('fieldset[data-q="paint"] .pdf-opt', { has: tab.locator('input[value="5 Night"]') });
    await (0, fixtures_js_1.expect)(night).toHaveCSS('cursor', 'not-allowed');
    await (0, fixtures_js_1.expect)(night).toHaveCSS('border-top-style', 'dashed');
    // Far down the form the button stays in view, stuck to the form's top.
    const notes = preview.locator('fieldset[data-q="notes"] textarea');
    await notes.scrollIntoViewIfNeeded();
    const noticeTop = await preview.locator('.pdf-head').evaluate(head => head.getBoundingClientRect().bottom);
    (0, fixtures_js_1.expect)(noticeTop, 'the notice\'s own place has scrolled away').toBeLessThan(0);
    await (0, fixtures_js_1.expect)(answer).toBeInViewport();
    // A tap on a disabled control lands on the cover: nothing changes but the hash.
    for (const target of [notes, night]) {
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        if (!box)
            throw new Error('control has no box');
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        (0, fixtures_js_1.expect)(await tab.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, point)).toBe('pdf-preview-cover');
        await tab.mouse.click(point.x, point.y);
        await (0, fixtures_js_1.expect)(tab).toHaveURL(`${self.base}${published.path}/#pi-dish-form-answer`);
        await (0, fixtures_js_1.expect)(answer).toBeInViewport();
    }
    await (0, fixtures_js_1.expect)(night.locator('input')).not.toBeChecked();
    await (0, fixtures_js_1.expect)(preview.locator('input[value="3 Racing green"]')).toBeChecked();
    await answer.click();
    await (0, fixtures_js_1.expect)(tab).toHaveURL(`${self.base}/forms/${published.token}`);
    await tab.close();
});
(0, fixtures_js_1.test)('an unconfirmed submit keeps its id: a retry sends the same submission once', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'reconcile', formHtml());
    const prompts = () => self.commands.filter(command => command.command === 'prompt');
    const formUrl = `${self.base}/forms/${published.token}`;
    const tab = await page.context().newPage();
    await tab.goto(formUrl);
    const form = tab.locator('#pdfApp form.pdf');
    const status = form.locator('.pdf-status');
    const submit = form.locator('button[type="submit"]');
    await (0, fixtures_js_1.expect)(submit).toBeEnabled();
    // A success whose body never arrived (a relay cut off mid-body): nothing confirms
    // the id, so the retry carries the same one and the agent gets one message.
    const sentIds = [];
    await tab.route(`**/api/page-forms/${published.token}`, async (route) => {
        if (route.request().method() !== 'POST')
            return route.continue();
        sentIds.push(String(JSON.parse(route.request().postData() ?? '{}').submissionId));
        if (sentIds.length === 1)
            return route.fulfill({ status: 200, contentType: 'application/json', body: '' });
        return route.continue();
    });
    await submit.click();
    await (0, fixtures_js_1.expect)(status).toContainText('Retrying sends this same submission');
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(0);
    await form.locator('.pdf-actions button', { hasText: 'Retry' }).click();
    await (0, fixtures_js_1.expect)(status).toHaveText(/delivered to the agent$/);
    (0, fixtures_js_1.expect)(sentIds).toHaveLength(2);
    (0, fixtures_js_1.expect)(sentIds[1]).toBe(sentIds[0]);
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(1);
    await tab.unroute(`**/api/page-forms/${published.token}`);
});
(0, fixtures_js_1.test)('reload reconciliation never moves the form back and clears only its own pending id', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'reload-order', formHtml());
    const prompts = () => self.commands.filter(command => command.command === 'prompt');
    const keys = { pending: `pi-dish-form-pending:${published.token}`, draft: `pi-dish-form-draft:${published.token}` };
    const base = { '4.1': 'A', '4.2': 'A', '12.2': 'C', rule6: true };
    // An earlier submit became revision 1; another view then made revision 2.
    await submitElsewhere(self, published.token, 'early-0000001', { ...base, notes: 'first answers' });
    await submitElsewhere(self, published.token, 'later-0000002', { ...base, '4.2': 'B', notes: 'second answers' });
    const state = await (await formApi(self, published.token)).json();
    const fingerprint = (0, helper_values_js_1.record)(state) ? String(state.fingerprint) : '';
    const tab = await page.context().newPage();
    await tab.goto(`${self.base}/forms/${published.token}`);
    const form = tab.locator('#pdfApp form.pdf');
    const status = form.locator('.pdf-status');
    const notes = form.locator('fieldset[data-q="notes"] textarea');
    await (0, fixtures_js_1.expect)(form).toHaveAttribute('data-submitted', '2');
    // Drafts and pending submits live in this tab's session storage.
    const remember = (values) => tab.evaluate((entries) => {
        for (const [key, value] of Object.entries(entries))
            sessionStorage.setItem(key, JSON.stringify(value));
    }, values);
    const storedPending = () => tab.evaluate(key => {
        const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
        return value && typeof value === 'object' && 'submissionId' in value ? String(value.submissionId) : null;
    }, keys.pending);
    // This tab, before a reload, had that first submit pending and an edit made on revision 0.
    await remember({
        [keys.pending]: { fingerprint, submissionId: 'early-0000001', expectedRevision: 0, answers: { ...base, notes: 'first answers' } },
        [keys.draft]: { fingerprint, revision: 0, answers: { ...base, notes: 'edit against revision 0' } },
    });
    await tab.reload();
    await (0, fixtures_js_1.expect)(status).toContainText('from another view is the current one. The form changed since you started editing; check your answers.');
    await (0, fixtures_js_1.expect)(form, 'the older receipt does not move the form back').toHaveAttribute('data-submitted', '2');
    await (0, fixtures_js_1.expect)(notes, 'the edit stays in the controls').toHaveValue('edit against revision 0');
    (0, fixtures_js_1.expect)(await storedPending()).toBeNull();
    await tab.evaluate(key => { sessionStorage.removeItem(key); }, keys.draft);
    // A pending submit from an earlier form version answers late, after this view
    // stored a newer pending submit: only its own entry may go.
    await remember({ [keys.pending]: { fingerprint: 'an-earlier-version', submissionId: 'oldver-000001', expectedRevision: 0, answers: {} } });
    const oldReceipt = (0, fixtures_js_1.heldRoute)();
    await tab.route('**/receipts/oldver-000001', route => oldReceipt.hold(route), { times: 1 });
    const submitHeld = (0, fixtures_js_1.heldRoute)();
    const formPost = `**/api/page-forms/${published.token}`;
    await tab.route(formPost, route => route.request().method() === 'POST' ? submitHeld.hold(route) : route.continue());
    await tab.reload();
    const late = (0, fixtures_js_1.requiredRoute)(await oldReceipt.received);
    await notes.fill('newest answers');
    await form.locator('button[type="submit"]').click();
    (0, fixtures_js_1.requiredRoute)(await submitHeld.received);
    const newId = await storedPending();
    (0, fixtures_js_1.expect)(newId).toMatch(/^[0-9a-f]{32}$/);
    const answered = tab.waitForResponse('**/receipts/oldver-000001');
    await late.continue();
    await (await answered).finished();
    await tab.evaluate(() => new Promise(resolve => { setTimeout(resolve, 0); }));
    (0, fixtures_js_1.expect)(await storedPending(), 'the late receipt cleared only its own id').toBe(newId);
    // The held submit never left this tab: the next view reconciles it under its id and sends it once.
    await tab.unroute(formPost);
    const before = prompts().length;
    await tab.reload();
    await (0, fixtures_js_1.expect)(status).toHaveText(/^Submitted .+ \(revision 3\) — delivered to the agent$/);
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(before + 1);
    (0, fixtures_js_1.expect)(String(prompts().at(-1)?.message)).toContain('notes: newest answers');
    await tab.close();
});
const pendingIn = (tab, token) => tab.evaluate(key => {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return value && typeof value === 'object' && 'submissionId' in value ? String(value.submissionId) : null;
}, `pi-dish-form-pending:${token}`);
(0, fixtures_js_1.test)('a pending submit belongs to its tab: another tab never takes it over or overwrites it', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'two-tabs', formHtml());
    const prompts = () => self.commands.filter(command => command.command === 'prompt');
    const formUrl = `${self.base}/forms/${published.token}`;
    const first = await page.context().newPage();
    await first.goto(formUrl);
    const firstForm = first.locator('#pdfApp form.pdf');
    await (0, fixtures_js_1.expect)(firstForm.locator('button[type="submit"]')).toBeEnabled();
    const held = (0, fixtures_js_1.heldRoute)();
    const formPost = `**/api/page-forms/${published.token}`;
    await first.route(formPost, route => route.request().method() === 'POST' ? held.hold(route) : route.continue());
    await firstForm.locator('fieldset[data-q="4.2"] .pdf-opt', { has: first.locator('input[value="B"]') }).click();
    await firstForm.locator('button[type="submit"]').click();
    const firstPost = (0, fixtures_js_1.requiredRoute)(await held.received);
    const firstId = await pendingIn(first, published.token);
    (0, fixtures_js_1.expect)(firstId).toMatch(/^[0-9a-f]{32}$/);
    const second = await page.context().newPage();
    await second.goto(formUrl);
    const secondForm = second.locator('#pdfApp form.pdf');
    await (0, fixtures_js_1.expect)(secondForm.locator('button[type="submit"]'), 'not held up by the other tab\'s submit').toBeEnabled();
    (0, fixtures_js_1.expect)(await pendingIn(second, published.token)).toBeNull();
    await secondForm.locator('fieldset[data-q="12.2"] .pdf-opt', { has: second.locator('input[value="A"]') }).click();
    await secondForm.locator('button[type="submit"]').click();
    await (0, fixtures_js_1.expect)(secondForm.locator('.pdf-status')).toHaveText(/delivered to the agent$/);
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(1);
    (0, fixtures_js_1.expect)(await pendingIn(first, published.token), 'the other tab left this one\'s pending id alone').toBe(firstId);
    // The first tab's submit now reaches the server, a revision behind: refused, and only its own id clears.
    await firstPost.continue();
    await (0, fixtures_js_1.expect)(firstForm.locator('.pdf-status')).toContainText('Not sent: answers were submitted from another view');
    (0, fixtures_js_1.expect)(await pendingIn(first, published.token)).toBeNull();
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(1);
    (0, fixtures_js_1.expect)((await formApi(self, published.token, `/receipts/${String(firstId)}`)).status).toBe(404);
    await first.close();
    await second.close();
});
(0, fixtures_js_1.test)('a failed lookup leaves the pending submit; Check again settles it without losing edits made meanwhile', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'check-again', formHtml());
    const prompts = () => self.commands.filter(command => command.command === 'prompt');
    const tab = await page.context().newPage();
    await tab.clock.install();
    await tab.goto(`${self.base}/forms/${published.token}`);
    const form = tab.locator('#pdfApp form.pdf');
    const status = form.locator('.pdf-status');
    const notes = form.locator('fieldset[data-q="notes"] textarea');
    const actions = form.locator('.pdf-actions');
    const kitchenB = form.locator('fieldset[data-q="4.2"] input[value="B"]');
    await (0, fixtures_js_1.expect)(form.locator('button[type="submit"]')).toBeEnabled();
    // Every receipt lookup fails: whether the server took the submit is unknown.
    await tab.route('**/receipts/**', route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'proxy unavailable' }));
    await form.locator('fieldset[data-q="4.2"] .pdf-opt', { has: tab.locator('input[value="B"]') }).click();
    const posted = tab.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/page-forms/${published.token}`));
    await form.locator('button[type="submit"]').click();
    (0, fixtures_js_1.expect)((await posted).status()).toBe(202);
    await fixtures_js_1.expect.poll(() => prompts().length).toBe(1);
    const id = await pendingIn(tab, published.token);
    await tab.reload();
    await (0, fixtures_js_1.expect)(status).toContainText('could not be checked yet');
    (0, fixtures_js_1.expect)(await pendingIn(tab, published.token), 'an unknown answer is not a miss').toBe(id);
    await (0, fixtures_js_1.expect)(kitchenB).toBeChecked();
    // The server now says it is still delivering, until the poll gives up.
    await tab.unroute('**/receipts/**');
    await tab.route('**/receipts/**', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ receipt: { id, state: 'delivering', revision: 1, acceptedAt: Date.now(), finishedAt: null, error: null } }),
    }));
    await actions.locator('button', { hasText: 'Check again' }).click();
    await fixtures_js_1.expect.poll(async () => { await tab.clock.fastForward(30_000); return status.textContent(); }, { timeout: 15_000 }).toContain('Still delivering');
    await notes.fill('typed while it was unsettled');
    await tab.unroute('**/receipts/**');
    await actions.locator('button', { hasText: 'Check again' }).click();
    await fixtures_js_1.expect.poll(async () => { await tab.clock.fastForward(2_000); return status.textContent(); }, { timeout: 15_000 }).toMatch(/delivered to the agent$/);
    await (0, fixtures_js_1.expect)(notes, 'the confirmed answers fill the form, then the draft on top').toHaveValue('typed while it was unsettled');
    await (0, fixtures_js_1.expect)(kitchenB).toBeChecked();
    await (0, fixtures_js_1.expect)(form).toHaveAttribute('data-submitted', '1');
    (0, fixtures_js_1.expect)(await pendingIn(tab, published.token)).toBeNull();
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(1);
    await tab.close();
});
(0, fixtures_js_1.test)('a draft made on an older revision keeps its edits and cannot submit silently', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'stale-base', formHtml());
    const prompts = () => self.commands.filter(command => command.command === 'prompt');
    const tab = await page.context().newPage();
    await tab.goto(`${self.base}/forms/${published.token}`);
    const form = tab.locator('#pdfApp form.pdf');
    const status = form.locator('.pdf-status');
    const notes = form.locator('fieldset[data-q="notes"] textarea');
    const submit = form.locator('button[type="submit"]');
    await (0, fixtures_js_1.expect)(submit).toBeEnabled();
    await notes.fill('mine, on revision 0');
    // Another view submits meanwhile; this tab reloads onto revision 1 with its draft.
    await submitElsewhere(self, published.token, 'elsewhere-0001', { '4.1': 'A', '4.2': 'B', '12.2': 'C', rule6: true, notes: 'theirs' });
    // Keys a review build left behind go on load.
    await tab.evaluate(token => {
        localStorage.setItem(`pi-dish-form-draft:${token}:old-tab`, '{}');
        localStorage.setItem(`pi-dish-form-stale:${token}`, '{}');
        sessionStorage.setItem('pi-dish-form-tab', 'old-tab');
    }, published.token);
    await tab.reload();
    await (0, fixtures_js_1.expect)(form).toHaveAttribute('data-submitted', '1');
    (0, fixtures_js_1.expect)(await tab.evaluate(() => [Object.keys(localStorage).filter(key => key.startsWith('pi-dish-form-')), sessionStorage.getItem('pi-dish-form-tab')]))
        .toEqual([[], null]);
    await (0, fixtures_js_1.expect)(notes, 'the edits stay in the controls').toHaveValue('mine, on revision 0');
    await (0, fixtures_js_1.expect)(status).toHaveText('The form changed since you started editing; check your answers.');
    // The submit carries the draft's base, so the server's conflict check refuses it.
    await submit.click();
    await (0, fixtures_js_1.expect)(status).toHaveText('Not sent: answers were submitted from another view (revision 1). Your answers are still here; check them against the newer ones.');
    (0, fixtures_js_1.expect)(prompts(), 'nothing went out on the stale base').toHaveLength(1);
    await (0, fixtures_js_1.expect)(notes).toHaveValue('mine, on revision 0');
    await (0, fixtures_js_1.expect)(submit, 'Submit cannot go over the newer answers').toBeDisabled();
    // Only the separate control in the conflict notice does, deliberately.
    await form.locator('.pdf-conflict button', { hasText: 'Submit my answers over the newer ones' }).click();
    await (0, fixtures_js_1.expect)(status).toHaveText(/\(revision 2\) — delivered to the agent$/);
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(2);
    (0, fixtures_js_1.expect)(String(prompts().at(-1)?.message)).toContain('notes: mine, on revision 0');
    await tab.close();
});
(0, fixtures_js_1.test)('a reload restores this tab\'s draft before its pending submit is checked, and keeps edits made while it is', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'draft-first', formHtml());
    const prompts = () => self.commands.filter(command => command.command === 'prompt');
    const tab = await page.context().newPage();
    await tab.goto(`${self.base}/forms/${published.token}`);
    const form = tab.locator('#pdfApp form.pdf');
    const notes = form.locator('fieldset[data-q="notes"] textarea');
    await (0, fixtures_js_1.expect)(form.locator('button[type="submit"]')).toBeEnabled();
    // Every receipt lookup waits: the submit stays pending across the reload.
    const lookups = [];
    await tab.route('**/receipts/**', (route) => { lookups.push(route); });
    await form.locator('fieldset[data-q="4.2"] .pdf-opt', { has: tab.locator('input[value="B"]') }).click();
    await form.locator('button[type="submit"]').click();
    await fixtures_js_1.expect.poll(() => prompts().length).toBe(1);
    await notes.fill('typed while sending');
    const before = lookups.length;
    await tab.reload();
    await fixtures_js_1.expect.poll(() => lookups.length).toBeGreaterThan(before);
    await (0, fixtures_js_1.expect)(notes, 'restored before the lookup answers').toHaveValue('typed while sending');
    await notes.fill('typed while sending, and more');
    // Unrouting lets the held lookup through to the server.
    await tab.unroute('**/receipts/**');
    await (0, fixtures_js_1.expect)(form.locator('.pdf-status')).toHaveText(/delivered to the agent$/);
    await (0, fixtures_js_1.expect)(notes).toHaveValue('typed while sending, and more');
    await (0, fixtures_js_1.expect)(form.locator('fieldset[data-q="4.2"] input[value="B"]')).toBeChecked();
    (0, fixtures_js_1.expect)(prompts()).toHaveLength(1);
    await tab.close();
});
(0, fixtures_js_1.test)('a receipt that arrives after a reload keeps edits typed since', async ({ page, fleet }) => {
    const { self } = fleet;
    const published = await publish(self, 'receipt-keeps-edits', formHtml());
    const prompts = () => self.commands.filter(command => command.command === 'prompt');
    const tab = await page.context().newPage();
    await tab.goto(`${self.base}/forms/${published.token}`);
    const form = tab.locator('#pdfApp form.pdf');
    const status = form.locator('.pdf-status');
    const notes = form.locator('fieldset[data-q="notes"] textarea');
    await (0, fixtures_js_1.expect)(form.locator('button[type="submit"]')).toBeEnabled();
    // The untouched defaults go out, and are delivered, while every receipt lookup waits.
    const lookups = [];
    await tab.route('**/receipts/**', (route) => { lookups.push(route); });
    await form.locator('button[type="submit"]').click();
    await fixtures_js_1.expect.poll(() => prompts().length).toBe(1);
    await fixtures_js_1.expect.poll(async () => {
        const state = await (await formApi(self, published.token)).json();
        return (0, helper_values_js_1.record)(state) ? state.revision : null;
    }).toBe(1);
    const before = lookups.length;
    await tab.reload();
    await fixtures_js_1.expect.poll(() => lookups.length).toBeGreaterThan(before);
    await notes.fill('typed after the reload');
    await tab.unroute('**/receipts/**');
    await (0, fixtures_js_1.expect)(status).toHaveText(/delivered to the agent$/);
    await (0, fixtures_js_1.expect)(notes, 'the receipt does not put the defaults back').toHaveValue('typed after the reload');
    await tab.reload();
    await (0, fixtures_js_1.expect)(notes, 'and the draft was kept').toHaveValue('typed after the reload');
    await tab.close();
});
// A phone-width page with a form tall enough to scroll under its sticky footer.
const TALL_SPEC = { ...SPEC, fields: [...SPEC.fields, ...Array.from({ length: 24 }, (_, index) => ({ id: `extra${index}`, type: 'longtext', label: `Extra question ${index}` }))] };
const tallFormHtml = () => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>
<h1>Gallery</h1><script type="application/pi-dish-form">${JSON.stringify(TALL_SPEC)}</script></body></html>`;
for (const [label, viewport, html] of [
    ['desktop', null, formHtml()],
    ['phone width', { width: 320, height: 740 }, tallFormHtml()],
]) {
    (0, fixtures_js_1.test)(`a double-click after another view's submission stops at the conflict and sends nothing more (${label})`, async ({ page, fleet }) => {
        const { self } = fleet;
        const published = await publish(self, `double-click-${label.replace(' ', '-')}`, html);
        const prompts = () => self.commands.filter(command => command.command === 'prompt');
        const tab = await page.context().newPage();
        if (viewport)
            await tab.setViewportSize(viewport);
        await tab.goto(`${self.base}/forms/${published.token}`);
        const form = tab.locator('#pdfApp form.pdf');
        const status = form.locator('.pdf-status');
        const submit = form.locator('button[type="submit"]');
        await (0, fixtures_js_1.expect)(submit).toBeEnabled();
        await form.locator('fieldset[data-q="4.2"] .pdf-opt', { has: tab.locator('input[value="B"]') }).click();
        await submit.click();
        await (0, fixtures_js_1.expect)(form).toHaveAttribute('data-submitted', '1');
        // Another view makes revision 2; this one still stands on revision 1.
        await submitElsewhere(self, published.token, 'other-view-0002', { '4.1': 'A', '4.2': 'A', '12.2': 'C', rule6: true, notes: 'theirs' });
        await form.locator('fieldset[data-q="notes"] textarea').fill('mine, on revision 1');
        const posts = [];
        tab.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/page-forms/${published.token}`)
            posts.push(request.url()); });
        // Record the override's state the moment it is added to the page.
        await tab.evaluate(() => {
            new MutationObserver(() => {
                const button = [...document.querySelectorAll('.pdf-conflict button')].find(node => node.textContent?.includes('over the newer ones'));
                if (button instanceof HTMLButtonElement)
                    document.body.dataset.overrideFirstSeen ??= String(button.disabled);
            }).observe(document.body, { childList: true, subtree: true });
        });
        await submit.dblclick({ delay: 80 });
        await (0, fixtures_js_1.expect)(status).toHaveText('Not sent: answers were submitted from another view (revision 2). Your answers are still here; check them against the newer ones.');
        await (0, fixtures_js_1.expect)(submit).toBeDisabled();
        // The override is in the notice in the page body, never in the sticky footer, and arms a second later.
        const override = form.locator('.pdf-conflict button', { hasText: 'Submit my answers over the newer ones' });
        await (0, fixtures_js_1.expect)(override).toBeVisible();
        (0, fixtures_js_1.expect)(await form.locator('.pdf-bar button', { hasText: 'Submit my answers over the newer ones' }).count()).toBe(0);
        (0, fixtures_js_1.expect)(await tab.evaluate(() => document.body.dataset.overrideFirstSeen), 'disabled when it first appears').toBe('true');
        await (0, fixtures_js_1.expect)(override).toBeEnabled();
        (0, fixtures_js_1.expect)(posts, 'one submission, refused').toHaveLength(1);
        (0, fixtures_js_1.expect)(prompts(), 'the other view\'s answers stand').toHaveLength(2);
        const state = await (await formApi(self, published.token)).json();
        (0, fixtures_js_1.expect)((0, helper_values_js_1.record)(state) ? state.revision : null).toBe(2);
        await tab.close();
    });
}
