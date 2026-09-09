// Shared by the full smoke and a fresh --scenario routines run.
module.exports = async function routines({ desktop, check, CWD }) {
  // Routines takeover: the fifth sidebar-header icon, the create/edit
  // round-trip (a changed prompt is a new version), a real Run now through
  // the fake RPC pi, and the routine provenance chip that lands on the
  // resulting session's sidebar row. See TASKS/routines.md.
  console.log('routines:');
  await desktop.waitForSelector('#btnRoutines', { state: 'visible', timeout: 5000 });
  check(true, 'sidebar header shows the routines icon on a routines-capable host');
  await desktop.click('#btnRoutines');
  await desktop.waitForSelector('.main.routines-open #rtNewBtn', { timeout: 5000 });
  check(await desktop.evaluate(() => document.getElementById('sessionView').offsetParent === null),
    'session view hidden while the routines takeover is open');
  check(await desktop.evaluate(() => document.querySelectorAll('.host-chip').length === 0 ||
    !document.querySelector('.routines-list .host-chip')),
    'no host chrome in the routines list on a single host');

  await desktop.click('#rtNewBtn');
  await desktop.waitForSelector('#rtName', { timeout: 5000 });
  await desktop.fill('#rtName', 'smoke-routine');
  await desktop.fill('#rtDescription', 'the smoke test routine');
  await desktop.fill('#rtCwd', CWD);
  await desktop.selectOption('#rtCronPreset', '0 9 * * 1-5');
  check(await desktop.inputValue('#rtCron') === '0 9 * * 1-5',
    'a schedule preset writes into the cron input');
  await desktop.fill('#rtPrompt', 'smoke routine prompt v1');
  await desktop.click('#rtSaveBtn');
  await desktop.waitForSelector('.rt-row', { timeout: 10000 });
  check(await desktop.locator('#rtError').textContent() === '',
    `routine created without a validation error (got "${await desktop.locator('#rtError').textContent()}")`);
  check((await desktop.locator('.rt-row').first().textContent()).includes('smoke-routine'),
    'the new routine appears in the list');
  check((await desktop.locator('.rt-row-sched').first().textContent()).includes('0 9 * * 1-5'),
    'the list row shows the cron expression');
  check((await desktop.locator('#rtCurl').textContent()).includes('/api/routines/') &&
    (await desktop.locator('#rtCurl').textContent()).includes('"input"'),
    'the invoke box shows a curl carrying an input body');

  // A changed prompt appends a version; nothing else does.
  await desktop.fill('#rtPrompt', 'smoke routine prompt v2');
  await desktop.click('#rtSaveBtn');
  await desktop.waitForFunction(() =>
    document.querySelector('.rt-version-badge')?.textContent === 'v2', null, { timeout: 10000 });
  check(true, 'editing the prompt bumps the routine to version 2');
  await desktop.click('#rtVersions > summary');
  await desktop.waitForSelector('.rt-version-row', { timeout: 5000 });
  check(await desktop.locator('.rt-version-row').count() === 2,
    'the versions block lists both prompt versions');
  await desktop.click('.rt-version-restore[data-restore="1"]');
  check(await desktop.inputValue('#rtPrompt') === 'smoke routine prompt v1',
    'restore writes the older prompt back into the editor (a save would make it a new version)');
  await desktop.fill('#rtPrompt', 'smoke routine prompt v2');

  // Run now: a real spawn through the fake RPC pi, observed to completion.
  await desktop.click('#rtRunBtn');
  await desktop.waitForSelector('.rt-table tbody tr', { timeout: 30000 });
  check(true, 'Run now lands an invocation row in the runs table');
  await desktop.waitForFunction(() =>
    /completed/.test(document.querySelector('.rt-table tbody tr')?.textContent || ''),
  null, { timeout: 40000 });
  const runRow = (await desktop.locator('.rt-table tbody tr').first().innerText()).replace(/\s+/g, ' ');
  check(runRow.includes('v2') && runRow.includes('invoke') && runRow.includes('prompt'),
    `the run records its version, trigger and delivery (got "${runRow}")`);
  // Clicking a version row filters the table to that version's runs.
  await desktop.click('.rt-version-row[data-version="1"]');
  check(await desktop.locator('.rt-table tbody tr').count() === 0 &&
    await desktop.locator('.rt-filter-chip').count() === 1,
    'clicking a version row filters the runs table to that version');
  await desktop.click('.rt-filter-clear');
  await desktop.waitForFunction(() => document.querySelectorAll('.rt-table tbody tr').length === 1,
    null, { timeout: 5000 });
  check(true, 'clearing the version filter restores every run');

  // Provenance: the session the routine produced wears its chip.
  const routineSessionId = await desktop.evaluate(() => routineInvocations[0]?.sessionId || null);
  check(!!routineSessionId, 'the invocation records the session it ran in');
  await desktop.evaluate(() => { switchTab('all'); });
  await desktop.evaluate(() => { loadSessions(undefined, { withPrevious: true }); });
  // Inactive automation runs stay off the All tab unless the query asks
  // (the oneShot run's session is closed after its close grace), so ask
  // for the routine by name before asserting its chip.
  await desktop.evaluate(() => {
    document.getElementById('filterInput').value = 'routine:smoke-routine';
    onFilterInput();
  });
  await desktop.waitForSelector('.routine-chip', { timeout: 10000 });
  check((await desktop.locator('.routine-chip').first().textContent()).includes('smoke-routine'),
    'the routine\'s session wears a ⏱ chip in the sidebar');
  check(await desktop.evaluate((id) =>
    !!document.querySelector(`.session-item[data-id="${id}"] .routine-chip`), routineSessionId),
  'the chip sits on the row of the session the run actually used');

  // The `routine:` grammar field is metadata-only and shared everywhere.
  await desktop.evaluate(() => {
    document.getElementById('filterInput').value = 'routine:smoke-routine';
    onFilterInput();
  });
  await desktop.waitForFunction((id) => {
    const rows = [...document.querySelectorAll('.session-item')];
    return rows.length === 1 && rows[0].dataset.id === id;
  }, routineSessionId, { timeout: 10000 });
  check(true, 'routine:<name> narrows the sidebar to that routine\'s sessions');
  await desktop.evaluate(() => {
    document.getElementById('filterInput').value = '';
    onFilterInput();
  });
  await desktop.evaluate(() => switchTab('active'));

  // Takeovers are mutually exclusive, and Escape closes this one.
  await desktop.evaluate(() => openRoutinesView());
  await desktop.waitForSelector('.main.routines-open', { timeout: 5000 });
  await desktop.click('[title="Usage and spend"]');
  await desktop.waitForFunction(() => document.querySelector('.main').classList.contains('usage-open') &&
    !document.querySelector('.main').classList.contains('routines-open'), null, { timeout: 5000 });
  check(true, 'opening the usage view closes the routines takeover');
  await desktop.keyboard.press('Escape');
  await desktop.evaluate(() => openRoutinesView());
  await desktop.waitForSelector('.main.routines-open', { timeout: 5000 });
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => !document.querySelector('.main').classList.contains('routines-open'),
    null, { timeout: 3000 });
  check(true, 'Escape closes the routines takeover');
};
