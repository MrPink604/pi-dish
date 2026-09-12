// Shared by the full smoke and a fresh --scenario bounce run.
module.exports = async function bounce({ base, CWD, desktop, check }) {
  // Bulk restart stays inside Settings rather than replacing the session.
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
    await desktop.evaluate(() => fixtureApp.features.displayPreferences.open());
    await desktop.click('#openBounceAgents');
    check(await desktop.locator('#settingsModal').isVisible() &&
      await desktop.locator('#settingsModal #bounceMode').isVisible(),
    'bounce controls expand inside Settings');
    const bouncePosition = await desktop.locator('#openBounceAgents').boundingBox();
    const themePosition = await desktop.locator('#settingsTheme').boundingBox();
    check(bouncePosition.y < themePosition.y, 'Bounce agents is at the top of Settings');
    await desktop.click('#openBounceAgents');
    check(!(await desktop.locator('#bounceMode').isVisible()), 'second click collapses bounce controls');
    await desktop.click('#openBounceAgents');
    await desktop.waitForSelector('#bounceMode', { state: 'visible' });
    await desktop.selectOption('#bounceMode', 'restart');
    const bounceTarget = desktop.locator('.bounce-target').filter({ hasText: 'Bounce smoke' });
    await bounceTarget.locator('input').check();
    await desktop.click('#bounceSubmit');
    await desktop.waitForSelector('.bounce-result[data-status="completed"]', { timeout: 15000 });
    const bounceOperations = await fetch(base + '/api/session-bounces').then(r => r.json());
    const bounced = bounceOperations.operations.flatMap(op => op.targets).find(t => t.sessionId === bounceSpawn.id);
    check(bounced?.status === 'completed', 'Bounce agents completes the selected owned RPC restart');
    bouncedId = bounced.replacementId || bouncedId;
    await desktop.evaluate(() => fixtureApp.features.displayPreferences.open());
    await desktop.click('#openRecoveryReport');
    check(!(await desktop.locator('#settingsModal').isVisible()) &&
      !(await desktop.locator('#bounceMode').isVisible()),
    'opening recovery closes Settings and its bounce controls');
    await desktop.evaluate(() => fixtureApp.features.displayPreferences.open());
    await desktop.click('#openBounceAgents');
    check(await desktop.locator('#settingsModal #bounceMode').isVisible(),
      'bounce controls reopen in Settings over the current view');
    await desktop.keyboard.press('Escape');
    check(!(await desktop.locator('#settingsModal').isVisible()),
      'Escape closes Settings and its bounce controls');
  } finally {
    await fetch(`${base}/api/sessions/${encodeURIComponent(bouncedId)}/close`, { method: 'POST' });
  }
};
