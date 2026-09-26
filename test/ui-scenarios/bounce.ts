// Shared by the full smoke and a fresh --scenario bounce run.
import type { UiScenario } from './contracts.js';
import { record, records } from '../test-types.js';

const bounce: UiScenario = async ({ base, CWD, desktop, check }) => {
  // Bulk restart lives in the Fleet takeover beside each host's load.
  console.log('bounce agents:');
  const bounceSpawn = await fetch(base + '/api/sessions/new', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ harness: 'pi', cwd: CWD, name: 'Bounce smoke' }),
  }).then(async response => {
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body;
  });
  let bouncedId = bounceSpawn.id;
  try {
    await desktop.click('#btnFleet');
    await desktop.waitForSelector('.main.fleet-open #fleetView', { state: 'visible' });
    await desktop.click('#openBounceAgents');
    check(await desktop.locator('.main.fleet-open #bounceView #bounceMode').isVisible() &&
      !(await desktop.locator('#settingsModal').isVisible()),
    'bounce controls expand inside the Fleet view, not Settings');
    const bouncePosition = await desktop.locator('#openBounceAgents').boundingBox();
    if (bouncePosition === null) throw new Error('Missing bouncePosition');
    const connectionsPosition = await desktop.locator('#fleetConnections').boundingBox();
    if (connectionsPosition === null) throw new Error('Missing connectionsPosition');
    const hostsPosition = await desktop.locator('#fleetHosts').boundingBox();
    if (hostsPosition === null) throw new Error('Missing hostsPosition');
    check(hostsPosition.y < connectionsPosition.y && connectionsPosition.y < bouncePosition.y,
      'Bounce agents sits below the host cards and connections in the Fleet view');
    await desktop.click('#openBounceAgents');
    check(!(await desktop.locator('#bounceMode').isVisible()), 'second click collapses bounce controls');
    await desktop.click('#openBounceAgents');
    await desktop.waitForSelector('#bounceMode', { state: 'visible' });
    await desktop.selectOption('#bounceMode', 'restart');
    const bounceTarget = desktop.locator('.bounce-target').filter({ hasText: 'Bounce smoke' });
    await bounceTarget.locator('input').check();
    await desktop.click('#bounceSubmit');
    await desktop.waitForSelector('.bounce-result[data-status="completed"]', { timeout: 15000 });
    const bounceBody = record(await fetch(base + '/api/session-bounces').then(response => response.json()));
    const bounced = records(bounceBody.operations).flatMap(operation => records(operation.targets))
      .find(target => target.sessionId === bounceSpawn.id);
    check(bounced?.status === 'completed', 'Bounce agents completes the selected owned RPC restart');
    if (!bounced) throw new Error('Bounce operation did not include the requested session');
    bouncedId = bounced.replacementId || bouncedId;
    await desktop.evaluate(() => fixtureApp.features.fleetController.open());
    await desktop.waitForSelector('#openRecoveryReport', { state: 'visible' });
    await desktop.click('#openRecoveryReport');
    await desktop.waitForSelector('.main.recovery-open');
    check(!(await desktop.locator('.main').evaluate(main => main.classList.contains('fleet-open'))) &&
      !(await desktop.locator('#bounceMode').isVisible()),
    'opening the recovery report closes the Fleet view and its bounce controls');
    await desktop.click('#btnFleet');
    await desktop.click('#openBounceAgents');
    check(await desktop.locator('.main.fleet-open #bounceMode').isVisible() &&
      !(await desktop.locator('.main').evaluate(main => main.classList.contains('recovery-open'))),
    'Fleet replaces the recovery report and its bounce controls reopen');
    await desktop.keyboard.press('Escape');
    check(!(await desktop.locator('.main').evaluate(main => main.classList.contains('fleet-open'))) &&
      !(await desktop.locator('#bounceMode').isVisible()),
    'Escape closes the Fleet view and its bounce controls');
  } finally {
    await fetch(`${base}/api/sessions/${encodeURIComponent(bouncedId)}/close`, { method: 'POST' });
  }
};

export = bounce;
