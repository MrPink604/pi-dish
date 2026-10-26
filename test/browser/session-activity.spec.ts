import { test, expect, CHILD } from './fixtures.js';
test('compaction retains the activity badge and stop control when a turn ends', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); fixtureApp.features.sessionActivity.setCompacting(true); fixtureApp.features.sessionActivity.setTurn(false); });
  await expect(page.locator('#sessionWorking')).toHaveClass(/active/);
  await expect(page.locator('#sessionWorking .spinner-text')).toContainText('Compacting');
  await expect(page.locator('#btnStop')).toHaveCSS('visibility', 'visible');
  await page.evaluate(() => fixtureApp.features.sessionActivity.setCompacting(false));
  await expect(page.locator('#sessionWorking')).not.toHaveClass(/active/);
  await expect(page.locator('#btnStop')).toHaveCSS('visibility', 'hidden');
});
test('activity ticker and setters retire on disposal', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => { fixtureApp.features.sessionActivity.setTurn(true); fixtureApp.features.sessionActivity.toolStarted('a', 'Bash'); });
  await expect(page.locator('#sessionWorking .spinner-text')).toContainText('Bash');
  await page.evaluate(() => { fixtureApp.features.sessionActivity.dispose(); fixtureElement(document.querySelector('#sessionWorking .spinner-text'), "document.querySelector('#sessionWorking .spinner-text')").textContent = 'retained'; fixtureApp.features.sessionActivity.toolStarted('b', 'Wrong'); fixtureApp.features.sessionActivity.setCompacting(true); });
  await page.waitForTimeout(1100);
  await expect(page.locator('#sessionWorking .spinner-text')).toHaveText('retained');
});
test('a failed old abort cannot release the gate of a subsequent turn', async ({ page, fleet }) => {
  const result = await page.evaluate(() => {
    const first = fixtureApp.features.sessionActivity.beginAbort('self same'); fixtureApp.features.sessionActivity.endAbort('self same');
    const second = fixtureApp.features.sessionActivity.beginAbort('self same'); fixtureApp.features.sessionActivity.endAbort('self same', fixtureElement(first, 'first abort token'));
    const retained = fixtureApp.features.sessionActivity.isAborting('self same'); fixtureApp.features.sessionActivity.endAbort('self same', fixtureElement(second, 'second abort token'));
    return { retained, released: !fixtureApp.features.sessionActivity.isAborting('self same'), peer: !!fixtureApp.features.sessionActivity.beginAbort('peer same') };
  });
  expect(result).toEqual({ retained: true, released: true, peer: true });
});
test.describe('side chat snapshots', () => {
  // Only a live session shows the composer the side chat belongs to.
  test.use({ liveSessions: true });
test('foreign or stale side-chat snapshots never render, and a selection switch clears the panel', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const initial = await page.evaluate((peerHost) => {
    fixtureApp.features.messageStreamController.stop();
    const session = fixtureCurrentSession();
    window.sideChatOwner = { id: session.id, host: session.host || null };
    const snapshot = (question: string) => ({ id: 'chat', createdAt: 1, turns: [{ id: 'turn-1', question, answer: 'peer answer', status: 'complete', startedAt: 1, updatedAt: 2 }] });
    fixtureApp.features.sideChat.apply(snapshot('foreign host'), { id: session.id, host: peerHost });
    fixtureApp.features.sideChat.apply(snapshot('foreign session'), { id: 'other-session', host: window.sideChatOwner.host });
    return fixtureApp.features.sideChat.active();
  }, fleet.peer.hostId);
  expect(initial).toBeNull();
  await expect(page.locator('#sideChat')).toBeHidden();
  await page.evaluate(() => {
    fixtureApp.features.sideChat.apply({ id: 'chat', createdAt: 1, turns: [{ id: 'turn-1', question: 'visible question', answer: 'visible answer', status: 'complete', startedAt: 1, updatedAt: 2 }] }, window.sideChatOwner);
  });
  await expect(page.locator('#sideChat')).toBeVisible();
  await expect(page.locator('.side-chat-question')).toHaveText('visible question');
  await expect(page.locator('.side-chat-answer-body')).toContainText('visible answer');
  await fleet.select(fleet.self, CHILD);
  await expect(page.locator('#sideChat')).toBeHidden();
});
});
test('side-chat clipboard completion cannot modify the replacement panel', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    fixtureApp.features.sideChat.dispose();
    window.sideChatPanel = PiDishBrowser.createSideChat({ document, sessionState: fixtureApp.features.sessionState,
      markdown: text => text, copy: () => new Promise<void>(resolve => { window.finishSideCopy = resolve; }),
      request: () => Promise.resolve(new Response(JSON.stringify({ success: true, sideChat: null }))),
      endpoint: () => ({ base: '' }), status: () => {}, onChange: () => {} });
    const session = fixtureCurrentSession();
    window.sideChatOwner = { id: session.id, host: session.host || null };
    const snapshot = (chatId: string, question: string) => ({ id: chatId, createdAt: 1, turns: [{ id: 'turn-' + chatId, question, answer: question + ' answer', status: 'complete', startedAt: 1, updatedAt: 2 }] });
    window.sideChatPanel.apply(snapshot('first', 'first question'), window.sideChatOwner);
    window.oldSideCopy = fixtureElement(document.querySelector<HTMLElement>('.side-chat-copy'), '.side-chat-copy');
    fixtureElement(window.oldSideCopy, 'old side copy').click();
    window.sideChatPanel.apply(snapshot('next', 'next question'), window.sideChatOwner);
  });
  await expect(page.locator('.side-chat-question')).toHaveText('next question');
  await page.evaluate(() => window.finishSideCopy());
  await expect(page.locator('.side-chat-copy')).toHaveText('Copy');
  expect(await page.evaluate(() => ({ detached: !document.contains(window.oldSideCopy), questions: document.querySelectorAll('.side-chat-question').length })))
    .toEqual({ detached: true, questions: 1 });
  await page.evaluate(() => fixtureElement(document.querySelector<HTMLElement>('.side-chat-close'), '.side-chat-close').click());
  await expect(page.locator('#sideChat')).toBeHidden();
  await page.evaluate(() => { window.sideChatPanel.dispose(); window.sideChatPanel.apply({ id: 'after', createdAt: 1, turns: [] }, window.sideChatOwner); });
  await expect(page.locator('#sideChat')).toBeHidden();
});
test.describe('side chat composer routing', () => {
  test.use({ liveSessions: true });
  test('a running main turn routes /btw and side-chat follow-ups away from steer', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  const btwCalls = await page.evaluate(async () => {
    fixtureApp.features.messageStreamController.stop();
    const recorded: Array<{ path: string; body: unknown }> = [];
    fixtureApp.features.apiTransport.request = (_host, path, init) => {
      recorded.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(new Response(JSON.stringify({ success: true, sideChat: null })));
    };
    fixtureApp.features.sessionActivity.setTurn(true);
    const input = fixtureInput(document.getElementById('promptInput'), "document.getElementById('promptInput')");
    input.value = '/btw why';
    await fixtureApp.features.composerSubmit.sendSteer();
    input.value = '/btw why';
    await fixtureApp.features.composerSubmit.sendPrompt();
    return recorded;
  });
  expect(btwCalls.map(call => call.path.split('/').pop())).toEqual(['side-chat', 'side-chat']);
  expect(btwCalls.some(call => call.path.includes('/steer'))).toBe(false);
  expect(btwCalls.map(call => call.body)).toEqual([{ question: 'why' }, { question: 'why' }]);

  await page.evaluate(() => {
    const session = fixtureCurrentSession();
    window.sideChatOwner = { id: session.id, host: session.host || null };
    fixtureApp.features.sideChat.apply({ id: 'chat-9', createdAt: 1, turns: [{ id: 'turn-1', question: 'why', answer: 'because', status: 'complete', startedAt: 1, updatedAt: 2 }] }, window.sideChatOwner);
  });
  await expect(page.locator('#btnSend')).toBeVisible();
  await expect(page.locator('#btnSteer')).toBeHidden();
  await expect(page.locator('#btnFollowUp')).toBeHidden();
  await expect(page.locator('#promptInput')).toHaveAttribute('placeholder', 'Ask a follow-up in the side chat…');

  const followUp = await page.evaluate(async () => {
    const recorded: Array<{ path: string; body: unknown }> = [];
    fixtureApp.features.apiTransport.request = (_host, path, init) => {
      recorded.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(new Response(JSON.stringify({ success: true, sideChat: null })));
    };
    fixtureInput(document.getElementById('promptInput'), "document.getElementById('promptInput')").value = 'and then?';
    await fixtureApp.features.composerSubmit.sendSteer();
    return recorded;
  });
  expect(followUp).toHaveLength(1);
  expect(followUp[0].path).toContain('/side-chat');
  expect(followUp[0].body).toEqual({ question: 'and then?', chatId: 'chat-9' });
  });
});
test('a late side-chat ask response cannot render into the next selection', async ({ page, fleet }) => {
  await fleet.select(fleet.self);
  await page.evaluate(() => {
    fixtureApp.features.messageStreamController.stop();
    const original = fixtureApp.features.apiTransport.request;
    window.lateReplies = [];
    fixtureApp.features.apiTransport.request = (...args) => String(args[1]).endsWith('/side-chat')
      ? new Promise<Response>(resolve => window.lateReplies.push(resolve))
      : original(...args);
    fixtureInput(document.getElementById('promptInput'), "document.getElementById('promptInput')").value = '/btw late';
    window.lateAsk = fixtureApp.features.composerSubmit.sendPrompt();
  });
  await fleet.select(fleet.self, CHILD);
  await page.evaluate(() => {
    for (const resolve of window.lateReplies) {
      resolve(new Response(JSON.stringify({ success: true, sideChat: { id: 'chat-late', createdAt: 1, turns: [{ id: 'turn-late', question: 'late', answer: 'late answer', status: 'complete', startedAt: 1, updatedAt: 2 }] } })));
    }
  });
  await page.evaluate(() => window.lateAsk);
  await expect(page.locator('#sideChat')).toBeHidden();
});

export {};
