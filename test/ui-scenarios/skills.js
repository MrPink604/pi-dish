// Shared by the full smoke and a fresh --scenario skills run.
module.exports = async function skills({ desktop, check }) {
  // Skills view: the observational directory + in-takeover detail + refine
  // launcher. Opened from the sidebar-header shield button.
  console.log('skills view:');
  await desktop.click('[title="Skills"]');
  await desktop.waitForFunction(() =>
    document.querySelector('.main').classList.contains('skills-open') &&
    [...document.querySelectorAll('.sk-row .sk-name')].some((n) => n.textContent.includes('smoke-skill')),
    null, { timeout: 8000 });
  check(await desktop.evaluate(() => document.getElementById('sessionView').offsetParent === null),
    'session view hidden while the skills takeover is open');
  check(await desktop.evaluate(() =>
    /inferred from tool calls/.test(document.querySelector('.sk-summary')?.textContent || '') &&
    /catalog ~\d/.test(document.querySelector('.sk-summary')?.textContent || '')),
    'directory summary badges inferred usage and the estimated catalog footprint');
  // Open the detail page for the fixture skill.
  await desktop.evaluate(() => {
    [...document.querySelectorAll('.sk-row')].find((r) => r.querySelector('.sk-name').textContent.includes('smoke-skill')).click();
  });
  await desktop.waitForSelector('.skills-detail-wrap', { timeout: 8000 });
  check(await desktop.evaluate(() => !!document.querySelector('.skills-detail-title')?.textContent.includes('smoke-skill')),
    'detail header names the skill in-takeover (not a modal)');
  check(await desktop.evaluate(() =>
    [...document.querySelectorAll('.sec-row.cold .never')].some((n) => /never read/.test(n.textContent))),
    'coverage map flags a never-read section');
  check(await desktop.evaluate(() => !!document.querySelector('.spark-lg') && document.querySelectorAll('.spark-lg i').length === 26),
    'side column renders the 26-week sparkline');
  // Refine launcher: prefills the new-session takeover with a draft (never sends).
  await desktop.click('.refine-btn');
  await desktop.waitForFunction(() =>
    document.querySelector('.main').classList.contains('new-session-open'), null, { timeout: 5000 });
  check(await desktop.evaluate(() => (document.getElementById('newSessionCwd').value || '').includes('smoke-skill')),
    'refine sets the new-session cwd to the skill directory');
  check(await desktop.evaluate(() => typeof fixtureApp.features.newSessionController.pendingDraft === 'string' &&
    fixtureApp.features.newSessionController.pendingDraft.includes('SKILL.md') && /coverage\?skill=/.test(fixtureApp.features.newSessionController.pendingDraft)),
    'refine stashes an evidence-bundle draft (path + coverage URL), never auto-sent');
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => !document.querySelector('.main').classList.contains('new-session-open'),
    null, { timeout: 2000 });
  check(true, 'Escape closes the new-session takeover opened by refine');
};
