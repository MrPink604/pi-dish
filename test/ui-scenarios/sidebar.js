// Shared by the full smoke and a fresh --scenario sidebar run.
module.exports = async function sidebar({ desktop, registryState, check, SKILL_SESSION_ID, CWD, BETA_ID, SESSION_ID }) {
  console.log('sidebar tree collapse & pin:');
  await desktop.waitForSelector(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`, { timeout: 5000 });
  check(await desktop.locator(`.session-item[data-id="${SKILL_SESSION_ID}"]`).count() === 0,
    'same-workspace child session is grouped under its parent and collapsed by default');
  const familyRootId = await desktop.locator(`.session-item[data-id="${registryState.sessionId}"]`)
    .evaluate(el => el.closest('.session-family-root')?.dataset.familyId);
  check(familyRootId === registryState.sessionId, 'parent anchors the session family block');
  await desktop.click(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
  await desktop.waitForSelector(`.session-item[data-id="${SKILL_SESSION_ID}"]`, { timeout: 2000 });
  const familyIds = await desktop.locator(`.session-family-root[data-family-id="${registryState.sessionId}"] .session-item`)
    .evaluateAll(rows => rows.map(row => row.dataset.id));
  check(JSON.stringify(familyIds) === JSON.stringify([registryState.sessionId, SKILL_SESSION_ID]),
    'expanded family keeps the parent first with its child directly beneath');
  check(await desktop.evaluate((id) =>
    JSON.parse(localStorage.getItem('pi-dish-expanded-session-families') || '[]')
      .some((key) => parseSessionKey(key).sessionId === id), registryState.sessionId),
    'family expansion persists device-locally');
  await desktop.click(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
  await desktop.waitForFunction((id) => !document.querySelector(`.session-item[data-id="${id}"]`), SKILL_SESSION_ID);
  await desktop.evaluate((id) => sessionState.patchSession(id, { turnInProgress: true }), SKILL_SESSION_ID);
  check(await desktop.locator(`.session-item[data-id="${registryState.sessionId}"] .session-item-status.working`).count() === 1,
    'collapsed parent surfaces a working child status');
  await desktop.evaluate((id) => sessionState.patchSession(id, { turnInProgress: false }), SKILL_SESSION_ID);
  await desktop.evaluate((id) => selectSession(id), SKILL_SESSION_ID);
  await desktop.waitForFunction((id) => sessionState.currentSession?.id === id &&
    document.querySelector(`.session-item[data-id="${id}"]`)?.classList.contains('active'), SKILL_SESSION_ID);
  check(await desktop.locator(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`)
    .getAttribute('aria-expanded') === 'true',
    'selecting a collapsed child reveals its ancestor and active row');
  await desktop.evaluate((id) => selectSession(id), registryState.sessionId);
  await desktop.waitForFunction((id) => sessionState.currentSession?.id === id, registryState.sessionId);
  await desktop.click(`.session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
  await desktop.waitForFunction((id) => !document.querySelector(`.session-item[data-id="${id}"]`), SKILL_SESSION_ID);

  const groupLabels = () => desktop.evaluate(() =>
    [...document.querySelectorAll('.session-segment:not(.pinned-segment) .workspace-group-label')]
      .map((el) => el.textContent));
  await desktop.waitForFunction(() =>
    document.querySelectorAll('.session-segment').length >= 3, null, { timeout: 5000 });
  const labelsBefore = await groupLabels();
  check(labelsBefore.length === 3, `prefix node + two children on All (got ${JSON.stringify(labelsBefore)})`);
  check(labelsBefore[0].endsWith('/workspace'), 'prefix node shows the shared path once');
  check(labelsBefore[1] === 'proj-alpha' && labelsBefore[2] === 'proj-beta',
    'children show distinguishing tails, newest first');
  await desktop.click('.workspace-children .workspace-group-header'); // first (newest) child
  await desktop.waitForSelector('.session-segment.collapsed', { timeout: 2000 });
  const labelsAfter = await groupLabels();
  check(labelsAfter[labelsAfter.length - 1] === 'proj-alpha', 'collapsed child sinks below its expanded sibling');
  check(await desktop.locator('.session-segment.collapsed .session-item').count() === 0,
    'collapsed group hides its sessions');
  check(await desktop.evaluate(() =>
    JSON.parse(localStorage.getItem('pi-dish-collapsed-groups') || '[]').length) === 1,
    'collapse persisted to localStorage');
  await desktop.click('.session-segment.collapsed .workspace-group-header');
  await desktop.waitForFunction(() => !document.querySelector('.session-segment.collapsed'), null, { timeout: 2000 });
  check(JSON.stringify(await groupLabels()) === JSON.stringify(labelsBefore),
    'expanding restores the original order');
  // Collapsing the prefix node takes the whole subtree with it.
  await desktop.click('.session-segment .workspace-group-header'); // first = prefix node
  await desktop.waitForSelector('.session-segment.collapsed', { timeout: 2000 });
  check(await desktop.evaluate(() =>
    document.querySelectorAll('#sessionList .session-item').length) === 0,
    'collapsed prefix node hides all descendant sessions');
  await desktop.click('.session-segment.collapsed .workspace-group-header');
  await desktop.waitForFunction(() => !document.querySelector('.session-segment.collapsed'), null, { timeout: 2000 });
  // The header + spawns a session at the node's path (stubbed — a real
  // createSession would launch `pi --mode rpc`), and must not toggle collapse.
  await desktop.evaluate(() => {
    window.__newSessionCwd = null;
    window.createSession = (cwd) => { window.__newSessionCwd = cwd; };
  });
  await desktop.hover('.workspace-children .workspace-group-header');
  await desktop.click('.workspace-children .workspace-group-header .workspace-new-btn');
  check(await desktop.evaluate(() => window.__newSessionCwd) === CWD,
    'header + button targets the node cwd');
  check(await desktop.locator('.session-segment.collapsed').count() === 0,
    'header + button does not toggle collapse');

  const pinToggle = async (id) => {
    await desktop.hover(`.session-item[data-id="${id}"]`);
    await desktop.click(`.session-item[data-id="${id}"] .session-pin-btn`);
  };
  await pinToggle(registryState.sessionId);
  await desktop.waitForSelector('.pinned-segment', { timeout: 2000 });
  check(await desktop.evaluate(() =>
    document.querySelector('#sessionList .session-segment')?.classList.contains('pinned-segment')),
    'pinned section renders at the top');
  check(await desktop.locator(`.pinned-segment .session-item[data-id="${SKILL_SESSION_ID}"]`).count() === 0,
    'pinned family remains collapsed by default');
  await pinToggle(BETA_ID);
  await desktop.waitForFunction(() =>
    document.querySelectorAll('.pinned-segment > .session-family-root').length === 2, null, { timeout: 2000 });
  check(await desktop.locator('.pinned-segment .session-drag-handle').count() === 2,
    'pinned families carry one drag handle each');
  check(await desktop.locator('.pinned-segment .session-item-cwd').count() === 2,
    'pinned rows show their workspace');
  // Expand the pinned parent, then drag beta above it: the child must move
  // with the parent wrapper rather than becoming an independently sorted row.
  await desktop.click(`.pinned-segment .session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
  await desktop.waitForSelector(`.pinned-segment .session-item[data-id="${SKILL_SESSION_ID}"]`);
  // Polls can replace rows between protocol calls. Locator actions re-resolve
  // detached elements and wait for visibility before issuing pointer input.
  await desktop.locator(`.pinned-segment .session-item[data-id="${BETA_ID}"] .session-drag-handle`)
    .dragTo(desktop.locator(`.pinned-segment .session-item[data-id="${registryState.sessionId}"]`), {
      targetPosition: { x: 20, y: 2 }, steps: 5, timeout: 5000,
    });
  await desktop.waitForFunction((want) =>
    JSON.stringify([...document.querySelectorAll('.pinned-segment > .session-family-root')].map((el) => el.dataset.familyId)) === want,
    JSON.stringify([BETA_ID, registryState.sessionId]), { timeout: 2000 });
  const draggedFamilyIds = await desktop.locator(`.pinned-segment .session-family-root[data-family-id="${registryState.sessionId}"] .session-item`)
    .evaluateAll(rows => rows.map(row => row.dataset.id));
  check(JSON.stringify(draggedFamilyIds) === JSON.stringify([registryState.sessionId, SKILL_SESSION_ID]),
    'drag handle moves the expanded family as one block');
  check(JSON.stringify(await desktop.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') || '[]')
    .map((key) => parseSessionKey(key).sessionId))) ===
    JSON.stringify([BETA_ID, registryState.sessionId]), 'manual family order persisted to localStorage');
  // Collapse, then unpin both; the section disappears and families rejoin.
  await desktop.click(`.pinned-segment .session-item[data-id="${registryState.sessionId}"] .session-family-toggle`);
  await pinToggle(BETA_ID);
  await pinToggle(registryState.sessionId);
  await desktop.waitForFunction(() => !document.querySelector('.pinned-segment'), null, { timeout: 2000 });
  check(true, 'unpinning removes the pinned section');

  // A filtered result can contain only the child. Pinning that fragment must
  // still persist and later render the canonical parent family.
  await desktop.fill('#filterInput', 'use smoke skill');
  await desktop.waitForSelector(`.ranked-segment .session-item[data-id="${SKILL_SESSION_ID}"]`, { timeout: 5000 });
  await pinToggle(SKILL_SESSION_ID);
  check(JSON.stringify(await desktop.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') || '[]')
    .map((key) => parseSessionKey(key).sessionId))) ===
    JSON.stringify([SESSION_ID]), 'pinning a filtered child stores the stable parent family id');
  await desktop.fill('#filterInput', '');
  await desktop.waitForFunction((id) => document.querySelector('.pinned-segment .session-item')?.dataset.id === id,
    SESSION_ID, { timeout: 5000 });
  check(await desktop.locator(`.pinned-segment .session-item[data-id="${SKILL_SESSION_ID}"]`).count() === 0,
    'filtered child pin restores the whole family in its collapsed state');
  await pinToggle(SESSION_ID);
  await desktop.waitForFunction(() => !document.querySelector('.pinned-segment'), null, { timeout: 2000 });

  // Cross-workspace lineage is navigation-only: pinning its filtered child
  // must not toggle or absorb the independently pinned parent.
  await pinToggle(SESSION_ID);
  await desktop.fill('#filterInput', 'beta answer');
  await desktop.waitForSelector(`.ranked-segment .session-item[data-id="${BETA_ID}"]`, { timeout: 5000 });
  await pinToggle(BETA_ID);
  check(JSON.stringify(await desktop.evaluate(() => JSON.parse(localStorage.getItem('pi-dish-pinned-sessions') || '[]')
    .map((key) => parseSessionKey(key).sessionId))) ===
    JSON.stringify([SESSION_ID, BETA_ID]), 'cross-workspace filtered child pins independently');
  await desktop.fill('#filterInput', '');
  await desktop.waitForFunction(() => document.querySelectorAll('.pinned-segment > .session-family-root').length === 2,
    null, { timeout: 5000 });
  await pinToggle(BETA_ID);
  await pinToggle(SESSION_ID);
  await desktop.waitForFunction(() => !document.querySelector('.pinned-segment'), null, { timeout: 2000 });
};
