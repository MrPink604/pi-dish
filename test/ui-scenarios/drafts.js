// Shared by the full smoke and a fresh --scenario drafts run.
module.exports = async function drafts({ desktop, check, registryState }) {
  // 9. Drafts persist per session; ArrowUp recalls sent prompts
  console.log('drafts & history:');
  await desktop.evaluate(() => recordPrompt('draft scenario history'));
  await desktop.fill('#promptInput', 'unsent draft');
  await desktop.waitForTimeout(500); // debounced draft save
  check(await desktop.evaluate((id) => localStorage.getItem(draftKey(id)),
    registryState.sessionId) === 'unsent draft', 'draft saved to localStorage');
  // Wipe the input without an input event, re-select the session: the
  // draft must come back.
  await desktop.evaluate(() => { document.getElementById('promptInput').value = ''; });
  await desktop.evaluate(id => selectSession(id, { forceTranscriptReload: true }), registryState.sessionId);
  await desktop.waitForTimeout(300);
  check(await desktop.inputValue('#promptInput') === 'unsent draft', 'draft restored on session select');
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
  await desktop.waitForTimeout(500);
  check(await desktop.evaluate((id) => localStorage.getItem(draftKey(id)),
    registryState.sessionId) === null, 'clearing the box clears the draft');
};
