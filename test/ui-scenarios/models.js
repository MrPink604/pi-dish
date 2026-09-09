// Shared by the full smoke and a fresh --scenario models run.
module.exports = async function models({ path, tmpHome, desktop, check, fs }) {
  // 6. Scoped models: dropdown edit mode toggles models and persists to
  // pi's settings.json (enabledModels), normal view hides disabled ones
  console.log('scoped models:');
  const settingsFile = path.join(tmpHome, '.pi', 'agent', 'settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch { return {}; } };
  await desktop.click('#sessionModel');
  await desktop.waitForSelector('.model-option', { timeout: 5000 });
  check(await desktop.locator('.model-option').count() === 3, 'all models listed when nothing is scoped');
  await desktop.click('.model-dropdown-footer >> text=Edit models');
  await desktop.waitForSelector('.model-check');
  check(await desktop.locator('.model-option .model-check').count() === 3, 'edit mode shows a checkbox per model');
  check(await desktop.locator('.model-group-toggle').count() === 1, 'provider header becomes a section toggle');
  await desktop.click('.model-option[title="test/other-model"]');
  check(await desktop.locator('.model-option[title="test/other-model"].disabled').count() === 1,
    'toggled model renders as disabled');
  await desktop.waitForTimeout(700); // debounced save
  check(JSON.stringify(readSettings().enabledModels) === JSON.stringify(['test/smoke-model', 'test/third-model']),
    'enabledModels persisted to pi settings.json');
  await desktop.click('.model-dropdown-footer >> text=Done');
  await desktop.waitForTimeout(100);
  check(await desktop.locator('.model-option').count() === 2, 'scoped view hides disabled models');
  const footerInfo = await desktop.locator('.model-footer-info').textContent();
  check(footerInfo === '1 hidden', `footer reports hidden count (got ${JSON.stringify(footerInfo)})`);
  // Reopen: the scope survives a fresh /api/models fetch (server-side resolve)
  await desktop.click('.messages');
  await desktop.waitForTimeout(200);
  await desktop.click('#sessionModel');
  await desktop.waitForSelector('.model-option', { timeout: 5000 });
  check(await desktop.locator('.model-option').count() === 2, 'scope survives reopening the dropdown');
  // Enable all clears the filter from settings
  await desktop.click('.model-dropdown-footer >> text=Edit models');
  await desktop.click('.model-dropdown-footer >> text=All');
  await desktop.waitForTimeout(700);
  check(!('enabledModels' in readSettings()), 'enabling everything clears enabledModels');
  // Provider header toggles its whole section: all on → all off → all on.
  await desktop.click('.model-group-toggle');
  check(await desktop.locator('.model-option.disabled').count() === 3,
    'provider toggle disables every model in the section');
  await desktop.click('.model-group-toggle');
  check(await desktop.locator('.model-option.disabled').count() === 0,
    'provider toggle re-enables the section');
  await desktop.waitForTimeout(700); // debounced save settles (round-trip = no filter)
  check(!('enabledModels' in readSettings()), 'provider round-trip leaves no filter persisted');
  await desktop.click('.model-dropdown-footer >> text=Done');
  await desktop.click('.messages');
  await desktop.waitForTimeout(200);
};
