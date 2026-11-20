import type { UiScenario } from './contracts.js';

const routines: UiScenario = async ({ desktop, check, CWD, base }) => {
  // Routines takeover: create/edit, a real Run now through the fake RPC pi,
  // and the provenance chip on the resulting session's sidebar row.
  console.log('routines:');
  await desktop.waitForSelector('#btnRoutines', { state: 'visible', timeout: 5000 });
  await desktop.click('#btnRoutines');
  await desktop.waitForSelector('.main.routines-open #rtNewBtn', { timeout: 5000 });
  check(await desktop.evaluate(() => fixtureElement(document.getElementById('sessionView'), "document.getElementById('sessionView')").offsetParent === null),
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
  const rowText = await desktop.locator('.rt-row').first().textContent();
  check(!!rowText?.includes('smoke-routine'), 'the new routine appears in the list');
  const scheduleText = await desktop.locator('.rt-row-sched').first().textContent();
  check(!!scheduleText?.includes('0 9 * * 1-5'), 'the list row shows the cron expression');
  const curlText = await desktop.locator('#rtCurl').textContent();
  check(!!curlText?.includes('/api/routines/') && curlText.includes('"input"'),
    'the invoke box shows a curl carrying an input body');

  // A changed prompt appends a version; nothing else does.
  await desktop.fill('#rtPrompt', 'smoke routine prompt v2');
  await desktop.click('#rtSaveBtn');
  await desktop.waitForFunction(() =>
    document.querySelector('.rt-version-badge')?.textContent === 'v2', null, { timeout: 10000 });
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

  // Provenance: the session the routine produced wears its chip.
  const routineSessionId = await desktop.evaluate(() => fixtureApp.features.routinesController.invocations[0]?.sessionId || null);
  check(!!routineSessionId, 'the invocation records the session it ran in');
  await desktop.evaluate(() => { fixtureApp.features.sidebarQuery.switchTab('all'); });
  await desktop.evaluate(() => { fixtureApp.features.sidebarLists.load(undefined, { withPrevious: true }); });
  // Inactive automation runs stay off the All tab unless the query asks
  // (the oneShot run's session is closed after its close grace), so ask
  // for the routine by name before asserting its chip.
  await desktop.evaluate(() => {
    fixtureInput(document.querySelector<HTMLInputElement>('#filterInput'), '#filterInput').value = 'routine:smoke-routine';
    fixtureApp.features.sidebarQuery.onInput();
  });
  await desktop.waitForSelector('.routine-chip', { timeout: 10000 });
  check(!!(await desktop.locator('.routine-chip').first().textContent())?.includes('smoke-routine'),
    'the routine\'s session wears a ⏱ chip in the sidebar');
  check(await desktop.evaluate((id) =>
    !!document.querySelector(`.session-item[data-id="${id}"] .routine-chip`), routineSessionId),
  'the chip sits on the row of the session the run actually used');

  // The `routine:` grammar field is metadata-only and shared everywhere.
  await desktop.evaluate(() => {
    fixtureInput(document.querySelector<HTMLInputElement>('#filterInput'), '#filterInput').value = 'routine:smoke-routine';
    fixtureApp.features.sidebarQuery.onInput();
  });
  await desktop.waitForFunction((id) => {
    const rows = [...document.querySelectorAll<HTMLElement>('.session-item')];
    return rows.length === 1 && rows[0]?.dataset.id === id;
  }, routineSessionId, { timeout: 10000 });
  await desktop.evaluate(() => {
    fixtureInput(document.querySelector<HTMLInputElement>('#filterInput'), '#filterInput').value = '';
    fixtureApp.features.sidebarQuery.onInput();
  });
  await desktop.evaluate(() => fixtureApp.features.sidebarQuery.switchTab('active'));

  // A bot's own schedule names the bot as its destination, with no session fields to edit.
  const { bots } = await (await fetch(`${base}/api/bots`)).json() as { bots: { id: string; name: string; status: string }[] };
  const bot = bots.find(row => row.status === 'active')!;
  const made = await fetch(`${base}/api/bots/${bot.id}/routines`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'smoke-bot-check', prompt: 'Check the smoke hosts.', schedule: { cron: '0 7 * * *' } }),
  });
  const { routine: botRoutine } = await made.json() as { routine: { id: string } };
  check(made.status === 201, `a bot makes its own schedule (got ${made.status})`);
  // The takeover may still be open from above, where opening it again would not reload the list.
  await desktop.evaluate(() => { fixtureApp.features.routinesController.open(); fixtureApp.features.routinesController.refresh(); });
  const botRow = `.rt-row[data-routine="${botRoutine.id}"]`;
  await desktop.waitForSelector(botRow, { timeout: 10000 });
  check((await desktop.locator(`${botRow} .rt-row-meta`).textContent())?.trim() === `to bot ${bot.name}`,
    'the list row names the bot as the destination');
  await desktop.click(botRow);
  await desktop.waitForSelector('#rtDestination', { timeout: 5000 });
  check((await desktop.locator('#rtDestination').textContent()) === `Bot ${bot.name}`, 'the routine shows its bot as the destination');
  check(await desktop.locator('#rtCwd, #rtHarness, #rtModel, input[name="rtMode"], #rtOnBusy').count() === 0,
    'a bot routine has no session fields');
  await desktop.fill('#rtPrompt', 'Check the smoke hosts and say which answered.');
  await desktop.click('#rtSaveBtn');
  await desktop.waitForFunction(() => document.querySelector('.rt-version-badge')?.textContent === 'v2', null, { timeout: 10000 });
  check(await desktop.locator('#rtError').textContent() === '', 'a bot routine saves without its session fields');
  await fetch(`${base}/api/routines/${botRoutine.id}`, { method: 'DELETE' });
  await desktop.evaluate(() => fixtureApp.features.routinesController.close());

  // Takeovers are mutually exclusive, and Escape closes this one.
  await desktop.evaluate(() => fixtureApp.features.routinesController.open());
  await desktop.waitForSelector('.main.routines-open', { timeout: 5000 });
  await desktop.click('[title="Usage and spend"]');
  await desktop.waitForFunction(() => fixtureElement(document.querySelector('.main'), "document.querySelector('.main')").classList.contains('usage-open') &&
    !fixtureElement(document.querySelector('.main'), "document.querySelector('.main')").classList.contains('routines-open'), null, { timeout: 5000 });
  await desktop.keyboard.press('Escape');
  await desktop.evaluate(() => fixtureApp.features.routinesController.open());
  await desktop.waitForSelector('.main.routines-open', { timeout: 5000 });
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => !fixtureElement(document.querySelector('.main'), "document.querySelector('.main')").classList.contains('routines-open'),
    null, { timeout: 3000 });
};

export = routines;
