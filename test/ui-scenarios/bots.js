// Generated test/tool from test/ui-scenarios/bots.ts; edit that source and run npm run build:tests.
"use strict";
const bots = async ({ desktop, check, base, emit, fs, path, tmpHome, SESSION_ID, BETA_ID }) => {
    // Bots do not run under test (PI_DISH_BOTS=off): rows are created and retired, relays never start.
    console.log('bots:');
    const list = async () => (await (await fetch(`${base}/api/bots`)).json()).bots;
    const fleet = (await list()).find(bot => bot.name === 'Fleet');
    check(!!fleet, 'Fleet is seeded');
    await desktop.evaluate(() => fixtureApp.features.sidebarLists.refresh());
    await desktop.waitForSelector(`.bots-segment .bot-node[data-bot-id="${fleet.id}"]`, { timeout: 10000 });
    await desktop.click('.bots-segment .bot-new-btn');
    await desktop.waitForSelector('#botNewForm', { timeout: 5000 });
    await desktop.fill('#botName', 'Smoke');
    await desktop.fill('#botIdentity', 'You are Smoke, the contact for the smoke test.');
    await desktop.fill('#botPlaces', 'notes: ~/notes');
    await desktop.selectOption('#botParent', fleet.id);
    await desktop.click('#botCreateBtn');
    await desktop.waitForSelector('#botNewModal', { state: 'detached', timeout: 10000 });
    const smoke = (await list()).find(bot => bot.name === 'Smoke');
    check(smoke?.parentId === fleet.id && smoke.places[0]?.cwd === '~/notes', 'the form creates the bot under its parent, with its places');
    const node = `.bot-node[data-bot-id="${smoke.id}"]`;
    await desktop.waitForSelector(node, { timeout: 10000 });
    check(await desktop.locator(node).getAttribute('style') === 'padding-left:14px', 'the new bot is nested under Fleet');
    // Sessions launched by a bot nest under that bot (active directly, closed in a collapsed drawer on All),
    // collapsible via the bot's toggle, while ordinary sessions stay in the workspace list.
    const closedWorkerId = '2026-07-03T00-00-00-uismoke4';
    const provenanceFile = path.join(tmpHome, '.pi', 'dish', 'session-provenance.json');
    const priorProvenance = fs.existsSync(provenanceFile) ? fs.readFileSync(provenanceFile, 'utf8') : null;
    try {
        fs.mkdirSync(path.dirname(provenanceFile), { recursive: true });
        fs.writeFileSync(provenanceFile, JSON.stringify({
            version: 1,
            launches: {
                [SESSION_ID]: { sourceSessionId: fleet.sessionId, operationId: null, createdAt: Date.now() },
                [closedWorkerId]: { sourceSessionId: fleet.sessionId, operationId: null, createdAt: Date.now() - 1000 },
            },
        }));
        await desktop.evaluate(() => fixtureApp.features.sidebarLists.refresh());
        await desktop.waitForSelector(`.bot-children[data-bot-children="${fleet.id}"] .session-item[data-id="${SESSION_ID}"]`, { timeout: 10000 });
        check(await desktop.locator(`.session-item[data-id="${SESSION_ID}"]`).count() === 1, 'active worker appears once, nested under Fleet');
        // Collapsing Fleet hides both its worker and its sub-bot; clicking again expands them.
        await desktop.click(`.bot-tree-toggle[data-bot-toggle="${fleet.id}"]`);
        await desktop.waitForSelector(`.bot-children[data-bot-children="${fleet.id}"]`, { state: 'detached', timeout: 5000 });
        check(await desktop.locator(`.session-item[data-id="${SESSION_ID}"]`).count() === 0
            && await desktop.locator(node).count() === 0, 'collapsing Fleet hides its worker and sub-bot');
        await desktop.click(`.bot-tree-toggle[data-bot-toggle="${fleet.id}"]`);
        await desktop.waitForSelector(`.bot-children[data-bot-children="${fleet.id}"] .session-item[data-id="${SESSION_ID}"]`, { timeout: 5000 });
        // On All, closed workers sit in a collapsed drawer under Fleet while non-bot sessions stay in workspaces.
        await desktop.click('#tabAll');
        await desktop.waitForSelector(`.bot-closed-toggle[data-bot-closed="${fleet.id}"]`, { timeout: 10000 });
        check(await desktop.locator(`.session-item[data-id="${closedWorkerId}"]`).count() === 0, 'closed worker starts collapsed');
        await desktop.click(`.bot-closed-toggle[data-bot-closed="${fleet.id}"]`);
        await desktop.waitForSelector(`.bot-closed-list .session-item[data-id="${closedWorkerId}"]`, { timeout: 5000 });
        const independentId = '2026-07-05T00-03-00-uiswitch';
        check(await desktop.locator(`.bots-segment .session-item[data-id="${independentId}"]`).count() === 0
            && await desktop.locator(`.session-item[data-id="${independentId}"]`).count() === 1, 'sessions no bot started stay outside the Bots group');
        check(await desktop.locator(`.session-item[data-id="${BETA_ID}"]`).count()
            === await desktop.locator(`.bots-segment .session-item[data-id="${BETA_ID}"]`).count(), 'cross-workspace child of a bot worker stays nested inside Bots instead of leaking out');
        await desktop.click('#tabActive');
    }
    finally {
        if (priorProvenance === null)
            fs.rmSync(provenanceFile, { force: true });
        else
            fs.writeFileSync(provenanceFile, priorProvenance);
        await desktop.evaluate(() => fixtureApp.features.sidebarLists.refresh());
    }
    // Edit opens the same form filled in with the bot's entry, its parent included, and saves the user's change.
    await desktop.hover(node);
    await desktop.click(`${node} .bot-edit-btn`);
    await desktop.waitForSelector('#botNewForm', { timeout: 5000 });
    check(await desktop.inputValue('#botName') === 'Smoke' && await desktop.inputValue('#botPlaces') === 'notes: ~/notes'
        && await desktop.inputValue('#botParent') === fleet.id, 'the edit form shows the bot\u2019s entry and its parent');
    check(await desktop.locator(`#botParent option[value="${smoke.id}"]`).count() === 0, 'a bot is not offered as its own parent');
    await desktop.fill('#botIdentity', 'You are Smoke, edited.');
    await desktop.selectOption('#botThinking', 'high');
    await desktop.selectOption('#botParent', '');
    await desktop.click('#botCreateBtn');
    await desktop.waitForSelector('#botNewModal', { state: 'detached', timeout: 10000 });
    const edited = (await list()).find(bot => bot.id === smoke.id);
    check(edited?.identity === 'You are Smoke, edited.' && edited.thinking === 'high' && edited.places[0]?.cwd === '~/notes', 'the edit saves the change');
    check(edited?.parentId === null, 'the edit moves the bot to the top level');
    await desktop.waitForSelector(`${node}[style="padding-left:0px"]`, { timeout: 10000 });
    // Retire asks twice, then archives the bot and drops it from the group.
    await desktop.hover(node);
    await desktop.click(`${node} .bot-retire-btn`);
    await desktop.waitForSelector(`${node} .bot-retire-btn.confirm`, { timeout: 5000 });
    await desktop.click(`${node} .bot-retire-btn`);
    await desktop.waitForSelector(node, { state: 'detached', timeout: 10000 });
    check((await list()).find(bot => bot.id === smoke.id)?.status === 'retired', 'retire archives the bot');
    // A change a bot made shows in its chat with an undo that restores the field from the revision before.
    const renamed = await fetch(`${base}/api/bots/${fleet.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Armada' }),
    });
    const revision = (await renamed.json()).bot.revision;
    await desktop.evaluate((id) => fixtureApp.features.sessionView.select(id), SESSION_ID);
    await desktop.waitForSelector('#messages .message', { timeout: 5000 });
    emit('message_end', { type: 'message_end', message: {
            role: 'custom', customType: 'bot-change', display: true, timestamp: Date.now(), content: [{ type: 'text', text: 'Armada: name: "Fleet" → "Armada"' }],
            details: { botId: fleet.id, botName: 'Armada', revision, fields: ['name'], lines: ['name: "Fleet" → "Armada"'] },
        } });
    await desktop.waitForSelector('.message.bot-change .bot-change-undo', { timeout: 5000 });
    check((await desktop.locator('.message.bot-change').textContent())?.includes('name: "Fleet" → "Armada"'), 'the change is shown in the chat');
    await desktop.click('.message.bot-change .bot-change-undo');
    await desktop.waitForFunction(() => document.querySelector('.message.bot-change .bot-change-undo')?.textContent === 'Undone', null, { timeout: 5000 });
    check((await list()).find(bot => bot.id === fleet.id)?.name === 'Fleet', 'undo restores the old name');
};
module.exports = bots;
