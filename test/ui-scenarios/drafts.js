// Shared by the full smoke and a fresh --scenario drafts run.
module.exports = async function drafts({ desktop, check, registryState }) {
  // 9. Drafts persist per session; ArrowUp recalls sent prompts
  console.log('drafts & history:');
  await desktop.evaluate(() => fixtureApp.features.composerDrafts.record('draft scenario history'));
  await desktop.fill('#promptInput', 'unsent draft');
  await desktop.waitForFunction(id => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(id)) === 'unsent draft',
    registryState.sessionId, { timeout: 5000 });
  check(true, 'draft saved to localStorage');
  // Wipe the input without an input event, re-select the session: the
  // draft must come back.
  await desktop.evaluate(() => { document.getElementById('promptInput').value = ''; });
  await desktop.evaluate(id => fixtureApp.features.sessionView.select(id, { forceTranscriptReload: true }), registryState.sessionId);
  await desktop.waitForFunction(() => document.getElementById('promptInput').value === 'unsent draft',
    null, { timeout: 5000 });
  check(true, 'draft restored on session select');
  // ArrowUp from the start of the box steps into history; ArrowDown
  // returns to the stashed draft.
  await desktop.evaluate(() => document.getElementById('promptInput').setSelectionRange(0, 0));
  await desktop.focus('#promptInput');
  await desktop.keyboard.press('ArrowUp');
  check(await desktop.inputValue('#promptInput') === 'draft scenario history',
    `ArrowUp recalls the last sent prompt (got ${JSON.stringify(await desktop.inputValue('#promptInput'))})`);
  await desktop.keyboard.press('ArrowDown');
  check(await desktop.inputValue('#promptInput') === 'unsent draft', 'ArrowDown restores the draft');
  // Clean up so later sections start with an empty composer + no draft.
  await desktop.fill('#promptInput', '');
  await desktop.waitForFunction(id => localStorage.getItem(fixtureApp.features.composerDrafts.draftKey(id)) === null,
    registryState.sessionId, { timeout: 5000 });
  check(true, 'clearing the box clears the draft');
};
