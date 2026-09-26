import type { Request as PlaywrightRequest, Route } from '@playwright/test';
import { test, expect, ROOT, requiredRoute } from './fixtures.js';
test.use({ liveSessions: true });

const menuKinds: readonly ('Model' | 'Thinking')[] = ['Model', 'Thinking'];

for (const kind of menuKinds) {
  test(`closing a pending ${kind.toLowerCase()} menu retires its catalog completion on the same session`, async ({ page, fleet }) => {
    await fleet.select(fleet.self);
    await page.evaluate(kind => {
      fixtureApp.features.modelCatalog.retire();
      // Only OMP's effort menu reads the catalog; the other harnesses use a
      // fixed ladder, so this case runs as the harness whose menu does fetch.
      if (kind === 'Thinking') window.fixtureSessionListPatch(fixtureCurrentSession().id, { harnessId: 'omp' });
      const load = fixtureApp.features.appModels.load; fixtureApp.features.appModels.load = () => { fixtureApp.features.appModels.load = load; return new Promise<void>(resolve => { window.finishHeaderCatalog = resolve; }); };
      window.headerMenu = kind === 'Model' ? fixtureApp.features.sessionControls.toggleModels() : fixtureApp.features.sessionControls.toggleThinking();
    }, kind);
    await expect(page.locator('#' + kind.toLowerCase() + 'Dropdown [role="status"]')).toBeVisible();
    await page.locator('#session' + kind).click();
    await page.evaluate(async () => { window.finishHeaderCatalog(); await window.headerMenu; });
    await expect(page.locator('#' + kind.toLowerCase() + 'Dropdown')).toBeHidden();
    await page.evaluate(kind => kind === 'Model' ? fixtureApp.features.sessionControls.toggleModels() : fixtureApp.features.sessionControls.toggleThinking(), kind);
    await expect(page.locator('#' + kind.toLowerCase() + 'Dropdown')).toBeVisible();
  });
}

test('reopening a session model menu reuses the warm catalog without another request', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  let requests = 0;
  await page.route('**/api/models*', route => { requests++; return route.fulfill({ json: [{ provider: 'test', id: 'warm-model', name: 'Warm', contextWindow: 200000 }] }); });
  await page.evaluate(() => fixtureApp.features.modelCatalog.clear());
  await page.evaluate(() => fixtureApp.features.sessionControls.toggleModels());
  await expect(page.locator('#modelDropdown .model-option')).toHaveAttribute('title', 'test/warm-model');
  await page.evaluate(() => fixtureApp.features.sessionControls.closeModels());
  const warm = requests;
  await page.evaluate(() => fixtureApp.features.sessionControls.toggleModels());
  await expect(page.locator('#modelDropdown .model-option')).toHaveAttribute('title', 'test/warm-model');
  expect(requests).toBe(warm);
});

test('a fixed-vocabulary session opens its effort menu while a model request is pending', async ({ page, fleet }) => {
  const held: Route[] = [];
  await page.route('**/api/models*', route => { held.push(route); });
  await fleet.select(fleet.self);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await page.evaluate(() => window.fixtureSessionListPatch(fixtureCurrentSession().id, { thinkingLevel: 'high' }));
  await page.evaluate(() => fixtureApp.features.sessionControls.toggleThinking());
  await expect(page.locator('#thinkingDropdown')).toBeVisible();
  await expect(page.locator('#thinkingDropdown button')).toHaveText(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  for (const route of held) await route.abort();
});

test('a warm OMP catalog feeds the effort ladder without another request', async ({ page, fleet }) => {
  let requests = 0;
  await page.route('**/api/models*', route => { requests++; return route.fulfill({ json: [
    { provider: 'test', id: 'ladder-model', name: 'Ladder', contextWindow: 200000, thinking: ['low', 'high'] },
  ] }); });
  // Keep authoritative list refreshes OMP-shaped too; a one-off client patch
  // would be overwritten by the fixture's real Pi registry on the next poll.
  await page.route(url => url.origin === fleet.self.base && url.pathname === '/api/sessions', async route => {
    const response = await route.fetch();
    const body: { active: Record<string, unknown>[]; previous: Record<string, unknown>[] } = await response.json();
    for (const row of [...body.active, ...body.previous]) {
      if (row.id === ROOT) Object.assign(row, { harnessId: 'omp', model: 'test/ladder-model', thinkingLevel: 'high' });
    }
    await route.fulfill({ response, json: body });
  });
  await page.route(`${fleet.self.base}/api/sessions/${ROOT}/messages?*`, async route => {
    const response = await route.fetch();
    const body: { session: Record<string, unknown> } = await response.json();
    body.session.model = 'test/ladder-model';
    await route.fulfill({ response, json: body });
  });
  await page.evaluate(() => fixtureApp.features.sidebarLists.refresh());
  await fleet.select(fleet.self);
  await page.evaluate(() => fixtureApp.features.modelCatalog.clear());
  await page.evaluate(() => fixtureApp.features.sessionControls.toggleModels());
  await expect(page.locator('#modelDropdown .model-option')).toHaveAttribute('title', 'test/ladder-model');
  await page.evaluate(() => fixtureApp.features.sessionControls.closeModels());
  const warm = requests;
  await page.evaluate(() => fixtureApp.features.sessionControls.toggleThinking());
  await expect(page.locator('#thinkingDropdown')).toBeVisible();
  await expect(page.locator('#thinkingDropdown button')).toHaveText(['off', 'low', 'high', 'auto']);
  expect(requests).toBe(warm);
});

test('a rename editor cannot commit its old text after selecting the same session id on another host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); let writes = 0;
  await page.route('**/api/sessions/*/rename', route => { writes++; return route.fulfill({ json: { success: true } }); });
  await page.evaluate(() => { fixtureApp.features.sessionControls.startRename(); fixtureInput(document.getElementById('sessionNameInput'), "document.getElementById('sessionNameInput')").value = 'Old peer edit'; });
  await fleet.select(fleet.self);
  await page.evaluate(() => { fixtureElement(document.getElementById('sessionNameInput'), "document.getElementById('sessionNameInput')").dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return fixtureApp.features.sessionControls.commitRename(); });
  expect(writes).toBe(0);
});

test('out-of-order model mutations preserve the latest selection on their originating host', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); const held: Route[] = [];
  await page.route('**/api/sessions/*/model', route => { held.push(route); });
  await page.evaluate(() => {
    window.firstModel = fixtureApp.features.sessionControls.selectModel('test/first'); window.secondModel = fixtureApp.features.sessionControls.selectModel('test/second');
  });
  await expect.poll(() => held.length).toBe(2);
  await held[1].fulfill({ json: { success: true } }); await page.evaluate(() => window.secondModel);
  await held[0].fulfill({ json: { success: true } }); await page.evaluate(() => window.firstModel);
  expect(await page.evaluate(({ id, host }) => fixtureElement(fixtureApp.features.sessionState.findSession(id, host), 'peer session').model,
    { id: ROOT, host: fleet.peer.hostId })).toBe('test/second');
});

test('rename refreshes credentials without retargeting its captured endpoint', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  await page.evaluate(() => {
    const ports = fixtureApp.ports.sessionControls, host = ports.host;
    window.controlEndpoint = { ...fixtureElement(host(fixtureCurrentSession().host ?? null), 'control endpoint') };
    ports.host = id => id === fixtureCurrentSession().host ? window.controlEndpoint : host(id);
    fixtureApp.features.sessionControls.startRename();
    fixtureInput(document.getElementById('sessionNameInput'), "document.getElementById('sessionNameInput')").value = 'Rotated peer';
    window.controlEndpoint.token = 'fresh-fixture-token';
  });
  let request: PlaywrightRequest | undefined;
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/rename`, route => {
    request = route.request();
    return route.fulfill({ json: { success: true } });
  });
  const result = await page.evaluate(async ({ id, self, peer }) => {
    await fixtureApp.features.sessionControls.commitRename();
    return {
      header: fixtureElement(document.getElementById('sessionName'), "document.getElementById('sessionName')").textContent,
      peer: fixtureElement(fixtureApp.features.sessionState.findSession(id, peer), 'peer session').name,
      self: fixtureElement(fixtureApp.features.sessionState.findSession(id, self), 'self session').name,
    };
  }, { id: ROOT, self: fleet.self.hostId, peer: fleet.peer.hostId });
  if (!request) throw new Error('Missing rename request');
  expect(request.headers().authorization).toBe('Bearer fresh-fixture-token');
  expect(result.header).toBe('Rotated peer');
  expect(result.peer).toBe('Rotated peer');
  expect(result.self).not.toBe('Rotated peer');
});

test('changed endpoint base retires rename editors and pending mutation completions', async ({ page, fleet }) => {
  await fleet.select(fleet.peer);
  await page.evaluate(() => {
    const ports = fixtureApp.ports.sessionControls, host = ports.host;
    window.controlEndpoint = { ...fixtureElement(host(fixtureCurrentSession().host ?? null), 'control endpoint') };
    ports.host = () => window.controlEndpoint;
    fixtureApp.features.sessionControls.startRename();
    fixtureInput(document.getElementById('sessionNameInput'), "document.getElementById('sessionNameInput')").value = 'Retired rename';
    window.controlEndpoint.base += '/replacement';
  });
  let renameWrites = 0;
  await page.route('**/api/sessions/*/rename', route => { renameWrites++; return route.fulfill({ json: { success: true } }); });
  await page.evaluate(() => fixtureApp.features.sessionControls.commitRename());
  expect(renameWrites).toBe(0);
  await expect(page.locator('#sessionName')).not.toHaveText('Retired rename');
  await page.evaluate(base => { window.controlEndpoint.base = base; }, fleet.peer.base);
  let held: Route | null | undefined;
  await page.route(`${fleet.peer.base}/api/sessions/${ROOT}/thinking`, route => { held = route; });
  const before = await page.locator('#sessionThinking').textContent();
  await page.evaluate(() => { window.pendingThinking = fixtureApp.features.sessionControls.selectThinking('high'); });
  await expect.poll(() => !!held).toBe(true);
  await page.evaluate(() => { window.controlEndpoint.base += '/replacement'; });
  await requiredRoute(held).fulfill({ json: { success: true, level: 'high' } });
  await page.evaluate(() => window.pendingThinking);
  await expect(page.locator('#sessionThinking')).toHaveText(before ?? '');
});

test('enabled-model debounce retains the serving host preference after menu close and selection change', async ({ page, fleet }) => {
  let write: { origin: string; body: unknown } | undefined;
  await page.route(`${fleet.self.base}/api/models?sessionId=${ROOT}`, route => route.fulfill({ json: [{ id: 'a', provider: 'p', enabled: true }, { id: 'b', provider: 'p', enabled: false }] }));
  await page.route('**/api/models/enabled', route => { write = { origin: new URL(route.request().url()).origin, body: route.request().postDataJSON() }; return route.fulfill({ json: { success: true } }); });
  await fleet.select(fleet.self);
  await page.evaluate(async () => { await fixtureApp.features.sessionControls.toggleModels(); (() => fixtureApp.features.sessionControls.setEditMode(true))(); fixtureApp.features.sessionControls.toggleModel('p/a'); fixtureApp.features.sessionControls.closeModels(); });
  await fleet.select(fleet.peer); await expect.poll(() => !!write).toBe(true);
  expect(write).toEqual({ origin: fleet.self.base, body: { enabledIds: [] } });
});

test('token export downloads the captured peer bytes after navigation and owns URL cleanup', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); let held: Route | null | undefined;
  await page.route('**/api/sessions/*/export', route => { held = route; });
  await page.evaluate(() => {
    window.exports = []; window.revokedExports = []; window.downloadNames = [];
    URL.createObjectURL = blob => { window.exports.push(blob); return 'blob:fixture-export-' + window.exports.length; };
    URL.revokeObjectURL = url => window.revokedExports.push(url);
    HTMLAnchorElement.prototype.click = function () { window.downloadNames.push(this.download); };
    window.exportPromise = fixtureApp.features.sessionControls.export();
  });
  await expect.poll(() => !!held).toBe(true); expect(new URL(requiredRoute(held).request().url()).origin).toBe(fleet.peer.base);
  await fleet.select(fleet.self);
  await requiredRoute(held).fulfill({ body: '<h1>Peer export</h1>', headers: { 'content-type': 'text/html', 'content-disposition': "attachment; filename*=UTF-8''peer%20transcript.html" } });
  await page.evaluate(() => window.exportPromise);
  const value = await page.evaluate(async () => ({ name: window.downloadNames[0], text: await fixtureElement(window.exports[0], 'export blob').text(), revoked: window.revokedExports.length }));
  expect(value).toEqual({ name: 'peer-root-transcript.html', text: '<h1>Peer export</h1>', revoked: 0 });
  await page.evaluate(() => fixtureApp.features.sessionControls.dispose()); expect(await page.evaluate(() => window.revokedExports)).toEqual(['blob:fixture-export-1']);
});

test('tokenless export uses navigation and disposal retires pending exports and header controls', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const navigation = await page.evaluate(async () => {
    const calls: unknown[] = []; window.open = (...args) => { calls.push(args); return null; }; await fixtureApp.features.sessionControls.export(); return calls;
  });
  expect(navigation).toEqual([[`/api/sessions/${ROOT}/export`, '_blank']]);
  await fleet.select(fleet.peer); let held: Route | null | undefined;
  await page.route('**/api/sessions/*/export', route => { held = route; });
  await page.evaluate(() => { window.exportBlobs = 0; URL.createObjectURL = () => { window.exportBlobs++; return 'blob:late'; }; window.lateExport = fixtureApp.features.sessionControls.export(); });
  await expect.poll(() => !!held).toBe(true); await page.evaluate(() => fixtureApp.features.sessionControls.dispose());
  await requiredRoute(held).fulfill({ body: 'late', contentType: 'text/html' }); await page.evaluate(() => window.lateExport);
  await page.locator('#sessionModel').click(); await page.locator('#sessionThinking').click(); await page.locator('#sessionName').click();
  expect(await page.evaluate(() => window.exportBlobs)).toBe(0); await expect(page.locator('#modelDropdown')).toBeHidden(); await expect(page.locator('#thinkingDropdown')).toBeHidden(); await expect(page.locator('#sessionNameInput')).toBeHidden();
});


test('overlapping peer exports both download after a later tokenless export', async ({ page, fleet }) => {
  await fleet.select(fleet.peer); const held: Route[] = [];
  await page.route('**/api/sessions/*/export', route => { held.push(route); });
  await page.evaluate(() => {
    window.exportedBlobs = []; URL.createObjectURL = value => {
      if (!(value instanceof Blob)) throw new Error('Expected export Blob');
      window.exportedBlobs.push(value); return 'blob:export-' + window.exportedBlobs.length;
    };
    HTMLAnchorElement.prototype.click = function () {}; window.open = () => null;
    window.exportOne = fixtureApp.features.sessionControls.export(); window.exportTwo = fixtureApp.features.sessionControls.export();
  });
  await expect.poll(() => held.length).toBe(2); await fleet.select(fleet.self); await page.evaluate(() => fixtureApp.features.sessionControls.export());
  await held[1].fulfill({ body: 'second peer export', contentType: 'text/html' }); await page.evaluate(() => window.exportTwo);
  await held[0].fulfill({ body: 'first peer export', contentType: 'text/html' }); await page.evaluate(() => window.exportOne);
  expect(await page.evaluate(() => Promise.all(window.exportedBlobs.map(blob => blob.text())))).toEqual(['second peer export', 'first peer export']);
});

export {};
