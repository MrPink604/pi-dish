import type { UiScenario } from './contracts.js';

interface BotRow { id: string; name: string; parentId: string | null; status: string; identity: string; thinking: string | null; places: { label: string; cwd: string }[] }

const bots: UiScenario = async ({ desktop, check, base, emit, SESSION_ID }) => {
  // Bots do not run under test (PI_DISH_BOTS=off): rows are created and retired, relays never start.
  console.log('bots:');
  const list = async (): Promise<BotRow[]> => ((await (await fetch(`${base}/api/bots`)).json()) as { bots: BotRow[] }).bots;
  const fleet = (await list()).find(bot => bot.name === 'Fleet');
  check(!!fleet, 'Fleet is seeded');
  await desktop.evaluate(() => fixtureApp.features.sidebarLists.refresh());
  await desktop.waitForSelector(`.bots-segment .bot-node[data-bot-id="${fleet!.id}"]`, { timeout: 10000 });

  await desktop.click('.bots-segment .bot-new-btn');
  await desktop.waitForSelector('#botNewForm', { timeout: 5000 });
  await desktop.fill('#botName', 'Smoke');
  await desktop.fill('#botIdentity', 'You are Smoke, the contact for the smoke test.');
  await desktop.fill('#botPlaces', 'notes: ~/notes');
  await desktop.selectOption('#botParent', fleet!.id);
  await desktop.click('#botCreateBtn');
  await desktop.waitForSelector('#botNewModal', { state: 'detached', timeout: 10000 });
  const smoke = (await list()).find(bot => bot.name === 'Smoke');
  check(smoke?.parentId === fleet!.id && smoke.places[0]?.cwd === '~/notes', 'the form creates the bot under its parent, with its places');
  const node = `.bot-node[data-bot-id="${smoke!.id}"]`;
  await desktop.waitForSelector(node, { timeout: 10000 });
  check(await desktop.locator(node).getAttribute('style') === 'padding-left:14px', 'the new bot is nested under Fleet');

  // Edit opens the same form filled in with the bot's entry, its parent included, and saves the user's change.
  await desktop.hover(node);
  await desktop.click(`${node} .bot-edit-btn`);
  await desktop.waitForSelector('#botNewForm', { timeout: 5000 });
  check(await desktop.inputValue('#botName') === 'Smoke' && await desktop.inputValue('#botPlaces') === 'notes: ~/notes'
    && await desktop.inputValue('#botParent') === fleet!.id, 'the edit form shows the bot\u2019s entry and its parent');
  check(await desktop.locator(`#botParent option[value="${smoke!.id}"]`).count() === 0, 'a bot is not offered as its own parent');
  await desktop.fill('#botIdentity', 'You are Smoke, edited.');
  await desktop.selectOption('#botThinking', 'high');
  await desktop.selectOption('#botParent', '');
  await desktop.click('#botCreateBtn');
  await desktop.waitForSelector('#botNewModal', { state: 'detached', timeout: 10000 });
  const edited = (await list()).find(bot => bot.id === smoke!.id);
  check(edited?.identity === 'You are Smoke, edited.' && edited.thinking === 'high' && edited.places[0]?.cwd === '~/notes', 'the edit saves the change');
  check(edited?.parentId === null, 'the edit moves the bot to the top level');
  await desktop.waitForSelector(`${node}[style="padding-left:0px"]`, { timeout: 10000 });

  // Retire asks twice, then archives the bot and drops it from the group.
  await desktop.hover(node);
  await desktop.click(`${node} .bot-retire-btn`);
  await desktop.waitForSelector(`${node} .bot-retire-btn.confirm`, { timeout: 5000 });
  await desktop.click(`${node} .bot-retire-btn`);
  await desktop.waitForSelector(node, { state: 'detached', timeout: 10000 });
  check((await list()).find(bot => bot.id === smoke!.id)?.status === 'retired', 'retire archives the bot');

  // A change a bot made shows in its chat with an undo that restores the field from the revision before.
  const renamed = await fetch(`${base}/api/bots/${fleet!.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Armada' }),
  });
  const revision = ((await renamed.json()) as { bot: { revision: number } }).bot.revision;
  await desktop.evaluate((id: string) => fixtureApp.features.sessionView.select(id), SESSION_ID);
  await desktop.waitForSelector('#messages .message', { timeout: 5000 });
  emit('message_end', { type: 'message_end', message: {
    role: 'custom', customType: 'bot-change', display: true, timestamp: Date.now(), content: [{ type: 'text', text: 'Armada: name: "Fleet" → "Armada"' }],
    details: { botId: fleet!.id, botName: 'Armada', revision, fields: ['name'], lines: ['name: "Fleet" → "Armada"'] },
  } });
  await desktop.waitForSelector('.message.bot-change .bot-change-undo', { timeout: 5000 });
  check((await desktop.locator('.message.bot-change').textContent())?.includes('name: "Fleet" → "Armada"'), 'the change is shown in the chat');
  await desktop.click('.message.bot-change .bot-change-undo');
  await desktop.waitForFunction(() => document.querySelector('.message.bot-change .bot-change-undo')?.textContent === 'Undone', null, { timeout: 5000 });
  check((await list()).find(bot => bot.id === fleet!.id)?.name === 'Fleet', 'undo restores the old name');
};

export = bots;
