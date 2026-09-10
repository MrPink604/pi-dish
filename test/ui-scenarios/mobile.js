// Shared by the full smoke and a fresh --scenario mobile run.
module.exports = async function mobile({ browser, watch, base, check, emit, SESSION_ID }) {
  // 3. Mobile: hamburger + drawer from empty state and session header
  console.log('mobile:');
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  watch(mobile, 'mobile');
  await mobile.goto(base, { waitUntil: 'networkidle' });
  await mobile.evaluate(() => localStorage.removeItem('pi-dish-session'));
  await mobile.reload({ waitUntil: 'networkidle' });
  check(await mobile.locator('.empty-menu-btn').isVisible(), 'empty-state hamburger visible');
  await mobile.click('.empty-menu-btn');
  await mobile.waitForSelector('.sidebar.open');
  check(true, 'drawer opens from empty state');
  await mobile.click(`.session-item[data-id="${SESSION_ID}"]`);
  await mobile.waitForSelector('.message.assistant');
  check(!(await mobile.locator('.sidebar').evaluate(el => el.classList.contains('open'))),
    'drawer closes after picking a session');
  const box = await mobile.locator('.header-menu-btn').boundingBox();
  check(box && box.x >= 0 && box.y >= 0 && box.width >= 36, 'header hamburger visible in layout');
  await mobile.waitForSelector('#sessionRelations .session-relation-chip', { timeout: 5000 });
  const relationLayout = await mobile.evaluate(() => {
    const strip = document.getElementById('sessionRelations');
    const chips = [...strip.querySelectorAll('.session-relation-chip')];
    const rect = strip.getBoundingClientRect();
    const tops = chips.map(chip => Math.round(chip.getBoundingClientRect().top));
    return {
      height: rect.height,
      rows: new Set(tops).size,
      flexWrap: getComputedStyle(strip).flexWrap,
      maxChipWidth: Math.max(...chips.map(chip => chip.getBoundingClientRect().width)),
    };
  });
  check(relationLayout.rows === 1 && relationLayout.flexWrap === 'nowrap' &&
    relationLayout.height <= 32 && relationLayout.maxChipWidth <= 171,
    `related-session chips stay in one compact mobile strip (got ${JSON.stringify(relationLayout)})`);

  // Header contract: three rows. The title owns row 1; row 2 carries the
  // four controls that always matter, unclipped, with the model chip the
  // only one allowed to shrink; row 3 scrolls and leads with run state.
  const title = await mobile.locator('#sessionName').boundingBox();
  const model = await mobile.locator('#sessionModel').boundingBox();
  check(title && model && title.y + title.height <= model.y,
    'session title sits above the model selector');
  // The fixture is a single-host pi session, so host and harness are
  // legitimately absent; populate them to prove the worst case — all four
  // controls plus a long model ref — still fits without clipping.
  const primary = await mobile.evaluate(() => {
    const row = document.querySelector('.session-meta-desktop');
    const host = document.getElementById('sessionHost');
    const harness = document.getElementById('sessionHarness');
    host.style.display = ''; host.textContent = 'tycho';
    harness.style.display = ''; harness.textContent = '◆';
    document.getElementById('sessionThinking').style.display = '';
    const model = document.getElementById('sessionModel');
    model.textContent = 'anthropic/claude-opus-4-5-20260101 ▾';
    const shown = [...row.children].filter(el => el.offsetParent !== null);
    return {
      ids: shown.map(el => el.id || el.className),
      overflowing: shown.filter(el => {
        const r = el.getBoundingClientRect();
        return r.left < 0 || r.right > window.innerWidth;
      }).length,
      clipped: shown.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.id || el.className),
      shrinkable: shown.filter(el => getComputedStyle(el).flexShrink !== '0').map(el => el.id || el.className),
    };
  });
  check(primary.ids.includes('sessionHost') && primary.ids.includes('sessionHarness') &&
    primary.ids.includes('sessionThinking') && primary.overflowing === 0,
    `host, harness and reasoning fit beside the model (got ${JSON.stringify(primary)})`);
  check(primary.clipped.length <= 1 && (primary.clipped[0] || 'sessionModel').includes('odel'),
    `only the model chip gives up width (got ${JSON.stringify(primary.clipped)})`);
  check(primary.shrinkable.length === 1 && primary.shrinkable[0].includes('model'),
    `only the model chip may shrink (got ${JSON.stringify(primary.shrinkable)})`);
  const chipRow = await mobile.evaluate(() => {
    const row = document.getElementById('sessionChips');
    const first = [...row.children].find(el => el.offsetParent !== null);
    return {
      first: first?.id,
      text: first?.textContent.trim(),
      scrolls: getComputedStyle(row).overflowX === 'auto',
    };
  });
  check(chipRow.first === 'sessionWorkingMobile' && chipRow.text === 'idle' && chipRow.scrolls,
    `the chip row scrolls and leads with run state (got ${JSON.stringify(chipRow)})`);
  const statusVisibility = await mobile.evaluate(() => {
    const el = document.getElementById('status');
    setStatus('Waiting for response...', 'working');
    const working = el.offsetParent !== null;
    setStatus('Send failed', 'error');
    const error = el.offsetParent !== null;
    setStatus('');
    return { working, error };
  });
  check(!statusVisibility.working && statusVisibility.error,
    `the run chip carries turn state alone; only errors add prose (got ${JSON.stringify(statusVisibility)})`);

  // Composer contract on a phone: every control lives inside the field's
  // box, in a strip below the text (an overlaid rail let scrolled lines run
  // under the glyphs), and the context readout holds one position across the
  // idle/running switch — a turn starting used to reflow the whole row and
  // push Follow-up off screen.
  const ctxRight = () => mobile.evaluate(() =>
    Math.round(document.getElementById('sessionContext').getBoundingClientRect().right));
  const ctxIdle = await ctxRight();
  await mobile.evaluate(() => setTurnInProgress(true));
  const composer = await mobile.evaluate(() => {
    const box = document.querySelector('.composer-box').getBoundingClientRect();
    const text = document.getElementById('promptInput').getBoundingClientRect();
    const inBox = (r) => r.left >= box.left && r.right <= box.right &&
      r.top >= box.top && r.bottom <= box.bottom;
    const visible = [...document.querySelectorAll('.composer-tools button')]
      .filter(el => el.offsetParent !== null);
    return {
      textBottom: Math.round(text.bottom),
      railTop: Math.round(document.querySelector('.composer-tools').getBoundingClientRect().top),
      ids: visible.map(el => el.id),
      outside: visible.filter(el => !inBox(el.getBoundingClientRect())).map(el => el.id),
      overflowing: visible.filter(el => {
        const r = el.getBoundingClientRect();
        return r.left < 0 || r.right > window.innerWidth;
      }).map(el => el.id),
    };
  });
  check(composer.outside.length === 0 && composer.textBottom <= composer.railTop,
    `the control strip sits inside the field, below the text (got ${JSON.stringify(composer)})`);
  check(composer.ids.includes('btnFollowUp') && composer.ids.includes('btnSteer') &&
    composer.overflowing.length === 0,
    `steer and follow-up stay reachable mid-turn (got ${JSON.stringify(composer)})`);
  check(await ctxRight() === ctxIdle,
    `the context readout keeps its slot when a turn starts (idle ${ctxIdle})`);
  await mobile.evaluate(() => setTurnInProgress(false));
  check(await ctxRight() === ctxIdle, 'and when the turn ends');

  // A long host status line (OMP's goal line runs to ~60 chars) must not
  // grow the header: the strip clips to one line until the ▾ opens it.
  const headerHeight = () => mobile.evaluate(() =>
    document.querySelector('.session-header').getBoundingClientRect().height);
  const baseHeader = await headerHeight();
  emit('extension_ui_request', {
    method: 'setStatus',
    statusKey: 'goal',
    statusText: 'Goal · make the 2 client test work and continue progressing…',
  });
  await mobile.waitForSelector('#extUiStatuses .ext-ui-status-badge', { timeout: 5000 });
  const collapsedStatus = await mobile.evaluate(() => {
    const badge = document.querySelector('#extUiStatuses .ext-ui-status-badge');
    return { height: badge.getBoundingClientRect().height, clipped: badge.scrollWidth > badge.clientWidth };
  });
  const withStatus = await headerHeight();
  check(collapsedStatus.height <= 24 && collapsedStatus.clipped && withStatus - baseHeader <= 30,
    `collapsed status stays one clipped line (got ${JSON.stringify(collapsedStatus)}, header ${baseHeader}→${withStatus})`);
  await mobile.click('#extUiStatusToggle');
  check(await mobile.evaluate(() => {
    const badge = document.querySelector('#extUiStatuses .ext-ui-status-badge');
    return badge.scrollWidth <= badge.clientWidth + 1 && badge.getBoundingClientRect().height > 24;
  }), 'the ▾ expands the status strip to the full line');
  emit('extension_ui_request', { method: 'setStatus', statusKey: 'goal', statusText: '' });
  await mobile.waitForFunction(() =>
    document.getElementById('extUiStatuses').style.display === 'none', { timeout: 5000 });
  check(true, 'the strip hides itself when the last status clears');
  await mobile.click('#sessionModel');
  await mobile.waitForSelector('.model-option', { timeout: 5000 });
  check(await mobile.locator('.model-option').count() >= 2, 'model dropdown opens from header');
  const sheet = await mobile.locator('.model-dropdown').boundingBox();
  check(sheet && sheet.y < 120, 'model dropdown drops from the top on mobile');
  await mobile.click('.messages'); // dismiss dropdown
  await mobile.waitForTimeout(200);
  await mobile.click('.header-menu-btn');
  await mobile.waitForSelector('.sidebar.open');
  check(true, 'drawer opens from session header');
  await mobile.click('.sidebar-overlay'); // close the drawer again

  // Terminal on mobile: opened from the ⚙ control panel; the extra-keys
  // bar (esc/tab/ctrl/arrows) is part of the touch layout. ^C must reach
  // the shell as SIGINT (kills a running sleep), and the ctrl latch turns
  // the next typed key into a control character.
  // Routines on a phone: one column at a time, with a ‹ back control.
  await mobile.evaluate(() => openRoutinesView());
  await mobile.waitForSelector('.main.routines-open .rt-row', { timeout: 10000 });
  check(await mobile.evaluate(() => document.getElementById('routinesDetail').offsetParent === null),
    'mobile routines opens on the list, detail stacked out of view');
  await mobile.click('.rt-row');
  await mobile.waitForSelector('.routines-view.detail-open #rtName', { timeout: 5000 });
  check(await mobile.evaluate(() => document.getElementById('routinesList').offsetParent === null &&
    document.getElementById('routinesDetail').offsetParent !== null),
  'tapping a routine swaps the list for the detail');
  await mobile.click('.rt-back');
  check(await mobile.evaluate(() => document.getElementById('routinesList').offsetParent !== null),
    'the ‹ back control returns to the routine list');
  await mobile.evaluate(() => closeRoutinesView());

  console.log('mobile terminal:');
  await mobile.click('#btnPanel');
  await mobile.waitForSelector('#cpTerminalRow', { state: 'visible' });
  await mobile.click('#cpTerminalRow');
  await mobile.waitForSelector('#terminalPanel .xterm', { timeout: 5000 });
  check(await mobile.locator('#terminalKeybar').isVisible(), 'extra-keys bar visible on mobile');
  await mobile.waitForFunction(() => document.getElementById('terminalStatus').textContent === '',
    { timeout: 5000 });
  await mobile.keyboard.type('sleep 100\r');
  await mobile.waitForTimeout(300);
  await mobile.tap('#terminalKeybar button[data-termkey="ctrl-c"]');
  await mobile.keyboard.type('echo after-$((1+1))\r');
  await mobile.waitForFunction(() => {
    const rows = document.querySelector('#terminalPanel .xterm');
    return rows && rows.textContent.includes('after-2');
  }, { timeout: 5000 });
  check(true, '^C key interrupts a running command (prompt came back)');
  // Ctrl latch: tap ctrl, type c → ^C again (nothing running; just assert
  // the latch visually arms and clears).
  await mobile.tap('#terminalKeybar button[data-termkey="ctrl"]');
  check(await mobile.evaluate(() => document.getElementById('termKeyCtrl').classList.contains('latched')),
    'ctrl key latches');
  await mobile.keyboard.type('c');
  check(await mobile.evaluate(() => !document.getElementById('termKeyCtrl').classList.contains('latched')),
    'latch clears after the next key');
  await mobile.click('#termCloseBtn');
};
