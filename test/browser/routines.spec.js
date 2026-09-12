const { test, expect, ROOT } = require('./fixtures');
const routine = (name, id = 'shared') => ({ id, name, harness: 'pi', cwd: '/fixture/project', prompt: name + ' prompt', promptVersion: 1, versions: [{ version: 1, prompt: name + ' prompt', savedAt: Date.now() }] });
const invocations = label => ({ invocations: [{ id: label, version: 1, status: 'completed', startedAt: Date.now(), sessionId: ROOT }], nextBefore: null });
async function setup(page, fleet) {
  await page.route('**/api/routines', route => route.fulfill({ json: { routines: [routine(new URL(route.request().url()).origin === fleet.self.base ? 'Self' : 'Peer')] } }));
  await page.route('**/api/routines/shared', route => route.fulfill({ json: { routine: routine(new URL(route.request().url()).origin === fleet.self.base ? 'Self' : 'Peer') } }));
  await page.route('**/api/routines/shared/invocations?*', route => route.fulfill({ json: invocations(new URL(route.request().url()).origin === fleet.self.base ? 'self-run' : 'peer-run') }));
  await page.route('**/api/models**', route => route.fulfill({ json: [] }));
  await page.route('**/api/harnesses', route => route.fulfill({ json: { harnesses: [{ id: 'pi', label: 'Pi', available: true }] } }));
  page.on('dialog', dialog => dialog.accept());
  await page.evaluate(() => {
    const hosts = fixtureApp.ports.hostDiscovery.hosts().map(host => Object.freeze({ ...host, capabilities: { ...host.capabilities, routines: true } }));
    window.routineHosts = hosts;
    fixtureApp.features.routinesController.dispose();
    window.rt = PiDishBrowser.createRoutinesView({ root: document.querySelector('.main'), request: (host, path, options) => fixtureApp.features.apiTransport.request(host, path, options), storage: localStorage, sessionState: fixtureApp.features.sessionState,
      hosts: () => hosts, effectiveHosts: () => hosts, host: id => window.routineHostRemoved === id ? null : hosts.find(host => host.hostId === id) || hosts[0], fleetReady: async () => {}, config: () => ({ routines: true }), multiHost: () => true,
      hostChip: host => fixtureApp.features.hostPresentation.chipHtml(host), closeOtherViews: () => {}, connection: () => {}, autocomplete: options => fixtureApp.ports.routinesController.autocomplete(options),
      copy: async () => {}, status: () => {}, confirm: text => confirm(text), loadPrevious: () => fixtureApp.features.sidebarLists.load(undefined, { withPrevious: true }), selectSession: (id, options) => fixtureApp.features.sessionView.select(id, options),
    }); window.rt.open();
  });
  await expect(page.locator('.rt-row')).toHaveCount(2);
}
async function select(page, host) { await page.locator(`.rt-row[data-host="${host.hostId}"]`).click(); }

test('routine detail and invocation reads remain with their host after a same-id selection change', async ({ page, fleet }) => {
  await setup(page, fleet);
  let held;
  await page.route(fleet.self.base + '/api/routines/shared', route => { held = route; });
  await select(page, fleet.self);
  await expect.poll(() => !!held).toBe(true);
  await select(page, fleet.peer);
  await expect(page.locator('#rtName')).toHaveValue('Peer');
  await held.fulfill({ json: { routine: routine('Old self') } });
  await expect(page.locator('#rtName')).toHaveValue('Peer');
  await page.unroute(fleet.self.base + '/api/routines/shared');
  let heldRuns;
  await page.route(fleet.self.base + '/api/routines/shared/invocations?*', route => { heldRuns = route; });
  await select(page, fleet.self);
  await expect.poll(() => !!heldRuns).toBe(true);
  await select(page, fleet.peer);
  await expect(page.locator('[data-invocation="peer-run"]')).toBeVisible();
  await heldRuns.fulfill({ json: invocations('old-self-run') });
  await expect(page.locator('[data-invocation="old-self-run"]')).toHaveCount(0);
});

for (const operation of ['save', 'run', 'delete']) test(`late routine ${operation} cannot replace another host's form`, async ({ page, fleet }) => {
  await setup(page, fleet); await select(page, fleet.self);
  await expect(page.locator('#rtName')).toHaveValue('Self');
  let held;
  const path = fleet.self.base + '/api/routines/shared' + (operation === 'run' ? '/invoke' : '');
  await page.route(path, route => { if (route.request().method() !== 'GET') { held = route; return; } return route.fallback(); });
  const button = page.locator(operation === 'save' ? '#rtSaveBtn' : operation === 'run' ? '#rtRunBtn' : '#rtDeleteBtn');
  await button.click(); if (operation === 'delete') await button.click();
  await expect.poll(() => !!held).toBe(true);
  await select(page, fleet.peer);
  await expect(page.locator('#rtName')).toHaveValue('Peer');
  await held.fulfill({ json: { routine: routine('Saved self') } });
  await expect(page.locator('#rtName')).toHaveValue('Peer');
  await expect(page.locator('#rtSaveBtn')).toBeEnabled();
  await expect(page.locator('#rtNotice')).toHaveText('');
});

test('routine host catalog changes retire old options and reopening preserves the draft', async ({ page, fleet }) => {
  await setup(page, fleet);
  let held;
  await page.route(fleet.self.base + '/api/harnesses', route => { held = route; });
  await page.route(fleet.peer.base + '/api/harnesses', route => route.fulfill({ json: { harnesses: [{ id: 'peer-agent', label: 'Peer agent', available: true }] } }));
  await page.locator('#rtNewBtn').click();
  await expect.poll(() => !!held).toBe(true);
  await page.fill('#rtName', 'Unsaved draft');
  await page.selectOption('#rtHost', fleet.peer.hostId);
  await expect(page.locator('#rtHarness option[value="peer-agent"]')).toHaveCount(1);
  await held.fulfill({ json: { harnesses: [{ id: 'old-agent', available: true }] } });
  await expect(page.locator('#rtHarness option[value="old-agent"]')).toHaveCount(0);
  await page.evaluate(() => { window.rt.close(); window.rt.open(); });
  await expect(page.locator('#rtName')).toHaveValue('Unsaved draft');
  await expect(page.locator('#rtSaveBtn')).toBeEnabled();
});

test('retained routine controls retire and disposal cancels polling and delete arming', async ({ page, fleet }) => {
  await page.clock.install(); await setup(page, fleet); await select(page, fleet.self);
  await expect(page.locator('#rtName')).toHaveValue('Self');
  await page.evaluate(() => {
    window.oldRoutineControls = [document.getElementById('rtRunBtn'), document.getElementById('rtDeleteBtn'), document.querySelector('.rt-version-restore'), document.querySelector('.rt-row')];
  });
  await select(page, fleet.peer);
  let writes = 0, reads = 0;
  await page.route('**/api/routines/**', route => { if (route.request().method() !== 'GET') writes++; else reads++; return route.fallback(); });
  await page.evaluate(() => window.oldRoutineControls.forEach(button => button.click()));
  await expect(page.locator('#rtName')).toHaveValue('Peer');
  await expect(page.locator('#rtPrompt')).toHaveValue('Peer prompt');
  expect(writes).toBe(0);
  await page.locator('#rtDeleteBtn').click();
  await page.evaluate(() => window.rt.dispose());
  const before = reads;
  await page.clock.runFor(20000);
  expect(reads).toBe(before); expect(writes).toBe(0);
  await expect(page.locator('.main')).not.toHaveClass(/routines-open/);
});

test('routine session navigation preserves the answering host and drops a delayed lookup after selection', async ({ page, fleet }) => {
  await setup(page, fleet); await fleet.select(fleet.self); await select(page, fleet.peer);
  await expect(page.locator('.rt-session-link')).toBeVisible();
  await page.locator('.rt-session-link').click();
  await expect(fleet.row(fleet.peer)).toHaveClass(/\bactive\b/);
  await page.evaluate(() => window.rt.open());
  await expect(page.locator('.rt-session-link')).toBeVisible();
  await page.evaluate(() => {
    const original = fixtureApp.features.sessionState.findSession;
    window.restoreRoutineLookup = () => { fixtureApp.features.sessionState.findSession = original; };
    fixtureApp.features.sessionState.findSession = () => undefined;
    const originalLoad = fixtureApp.features.sidebarLists.load;
    fixtureApp.features.sidebarLists.load = () => new Promise(resolve => { window.finishRoutineLookup = () => { fixtureApp.features.sidebarLists.load = originalLoad; window.restoreRoutineLookup(); resolve(); }; });
  });
  await page.locator('.rt-session-link').click();
  await expect.poll(() => page.evaluate(() => !!window.finishRoutineLookup)).toBe(true);
  await page.evaluate(() => window.restoreRoutineLookup());
  await fleet.select(fleet.self);
  await page.evaluate(() => window.finishRoutineLookup());
  await expect(fleet.row(fleet.self)).toHaveClass(/\bactive\b/);
});


test('removed routine hosts retire form actions and pending polling safely', async ({ page, fleet }) => {
  await setup(page, fleet); await select(page, fleet.peer);
  await expect(page.locator('#rtName')).toHaveValue('Peer');
  let writes = 0;
  await page.route('**/api/routines/**', route => { if (route.request().method() !== 'GET') writes++; return route.fallback(); });
  await page.evaluate(async host => {
    window.routineHostRemoved = host;
    document.getElementById('rtRunBtn').click(); await window.rt.save(); await window.rt.delete();
    window.rt.refresh(); window.rt.close(); window.rt.open(); window.rt.dispose();
  }, fleet.peer.hostId);
  expect(writes).toBe(0);
  await expect(page.locator('.main')).not.toHaveClass(/routines-open/);
});

test('a routine save preserves edits made while the submitted form is in flight', async ({ page, fleet }) => {
  await setup(page, fleet); await select(page, fleet.self);
  await expect(page.locator('#rtName')).toHaveValue('Self');
  let held;
  await page.route(fleet.self.base + '/api/routines/shared', route => { if (route.request().method() === 'PUT') { held = route; return; } return route.fallback(); });
  await page.fill('#rtPrompt', 'Submitted prompt'); await page.locator('#rtSaveBtn').click();
  await expect.poll(() => !!held).toBe(true);
  await page.fill('#rtPrompt', 'Newer unsaved prompt');
  await held.fulfill({ json: { routine: { ...routine('Self'), prompt: 'Submitted prompt', promptVersion: 2 } } });
  await expect(page.locator('.rt-version-badge')).toHaveText('v2');
  await expect(page.locator('#rtPrompt')).toHaveValue('Newer unsaved prompt');
  await page.evaluate(() => { window.rt.close(); window.rt.open(); });
  await expect(page.locator('#rtPrompt')).toHaveValue('Newer unsaved prompt');
});


test('routine token rotation keeps the retained draft editable and sends the fresh credential', async ({ page, fleet }) => {
  await setup(page, fleet); await select(page, fleet.peer);
  await expect(page.locator('#rtName')).toHaveValue('Peer');
  await page.fill('#rtPrompt', 'Retained rotation draft');
  await page.evaluate(id => {
    const index = window.routineHosts.findIndex(host => host.hostId === id);
    window.routineHosts[index] = { ...window.routineHosts[index], token: 'fixture-rotated-token' };
    window.rt.close(); window.rt.open();
  }, fleet.peer.hostId);
  await expect(page.locator('#rtPrompt')).toHaveValue('Retained rotation draft');
  let credential;
  await page.route(fleet.peer.base + '/api/routines/shared', route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    credential = route.request().headers().authorization;
    return route.fulfill({ json: { routine: { ...routine('Peer'), prompt: 'Retained rotation draft', promptVersion: 2 } } });
  });
  await page.locator('#rtSaveBtn').click();
  await expect.poll(() => credential).toBe('Bearer fixture-rotated-token');
  await expect(page.locator('.rt-version-badge')).toHaveText('v2');
});

test('a changed routine base offers a working back control and same-row reload', async ({ page, fleet }) => {
  await setup(page, fleet); await select(page, fleet.peer);
  await expect(page.locator('#rtName')).toHaveValue('Peer');
  await page.evaluate(({ id, base }) => {
    const index = window.routineHosts.findIndex(host => host.hostId === id);
    window.routineHosts[index] = { ...window.routineHosts[index], base };
    window.rt.close(); window.rt.open();
  }, { id: fleet.peer.hostId, base: fleet.self.base });
  await expect(page.locator('#rtError')).toContainText('host changed');
  await expect(page.locator('#rtSaveBtn')).toBeDisabled();
  await page.evaluate(() => document.querySelector('.rt-back').click());
  await expect(page.locator('#routinesView')).not.toHaveClass(/detail-open/);
  await select(page, fleet.peer);
  await expect(page.locator('#rtName')).toHaveValue('Self');
  await expect(page.locator('#rtSaveBtn')).toBeEnabled();
});
