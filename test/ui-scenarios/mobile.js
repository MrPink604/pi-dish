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

  // Layout contract: title gets its own row above the top-right model
  // selector, while the context badge stays bottom-left.
  const vp = mobile.viewportSize();
  const title = await mobile.locator('#sessionName').boundingBox();
  const model = await mobile.locator('#sessionModel').boundingBox();
  check(title && model && title.y + title.height <= model.y,
    'session title sits above the model selector');
  check(model && model.x > vp.width / 2 && model.y < 60, 'model selector sits top-right');
  const ctx = await mobile.locator('#sessionContextBar').boundingBox();
  check(ctx && ctx.x >= 0 && ctx.x + ctx.width < vp.width / 2 && ctx.y > vp.height / 2, `context badge sits bottom-left (got ${JSON.stringify(ctx)}, viewport ${JSON.stringify(vp)})`);
  check(!(await mobile.locator('#sessionContext').isVisible()), 'header context badge hidden on mobile');

  // Composer contract on a phone: the content tools (📎/🎙) sit inside the
  // prompt field, over a strip the field reserves for them, and every
  // control of a running turn stays fully on screen — Follow-up used to be
  // pushed past the right edge once attach and dictate shared that row.
  await mobile.evaluate(() => setTurnInProgress(true));
  const composer = await mobile.evaluate(() => {
    const field = document.getElementById('promptInput');
    const rect = field.getBoundingClientRect();
    const attach = document.getElementById('btnAttach').getBoundingClientRect();
    const visible = [...document.querySelectorAll('.input-actions button')]
      .filter(el => el.offsetParent !== null);
    return {
      reserved: parseFloat(getComputedStyle(field).paddingBottom),
      attachInField: attach.left >= rect.left && attach.right <= rect.right &&
        attach.top >= rect.top && attach.bottom <= rect.bottom,
      attachHeight: attach.height,
      ids: visible.map(el => el.id),
      overflowing: visible
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.left < 0 || r.right > window.innerWidth;
        })
        .map(el => el.id),
    };
  });
  check(composer.attachInField && composer.reserved >= composer.attachHeight,
    `attach sits inside the prompt field's reserved strip (got ${JSON.stringify(composer)})`);
  check(composer.ids.includes('btnFollowUp') && composer.overflowing.length === 0,
    `every turn control fits the phone row (got ${JSON.stringify(composer)})`);
  check(await mobile.locator('#btnAttach').isVisible() &&
    await mobile.evaluate(() => document.querySelector('.input-actions #btnAttach') === null),
    'attach moved out of the actions row and stayed clickable');
  await mobile.evaluate(() => setTurnInProgress(false));

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
