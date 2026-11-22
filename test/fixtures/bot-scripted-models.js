// Generated test/tool from test/fixtures/bot-scripted-models.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openBotModels = openBotModels;
/**
 * A bot relay's model in tests (`PI_DISH_BOT_MODELS` names this module): pi-ai's faux provider under the bot's own
 * selector. Every request is answered `echo <n>: <last user text>`, where n counts the user messages in its context,
 * followed by `[<k> image(s)]` when that message holds images,
 * so a test sees what the bot's conversation holds. While `hold` exists in `PI_DISH_BOT_FAUX_DIR` an answer waits
 * for it to go, and `holding` says one is waiting: a run a test keeps in progress. pi-dish's idle-rollover draft
 * request is answered as a bot should: `Summary: <line>`, then the notebook between its markers.
 */
const fs = require("node:fs");
const path = require("node:path");
const promises_1 = require("node:timers/promises");
function text(message) {
    if (!message || typeof message !== 'object')
        return '';
    const content = message.content;
    if (typeof content === 'string')
        return content;
    return Array.isArray(content)
        ? content.map(part => part && typeof part === 'object' && part.type === 'text' ? String(part.text ?? '') : '').join('')
        : '';
}
async function openBotModels(selector) {
    const faux = await import('@earendil-works/pi-ai/providers/faux');
    const { createModels } = await import('@earendil-works/pi-ai/models');
    const slash = selector.indexOf('/');
    const handle = faux.fauxProvider({ provider: selector.slice(0, slash), models: [{ id: selector.slice(slash + 1), contextWindow: 200_000 }] });
    const dir = process.env.PI_DISH_BOT_FAUX_DIR || '';
    const answer = async (context) => {
        if (dir && fs.existsSync(path.join(dir, 'hold'))) {
            fs.writeFileSync(path.join(dir, 'holding'), '');
            while (fs.existsSync(path.join(dir, 'hold')))
                await (0, promises_1.setTimeout)(50);
            fs.rmSync(path.join(dir, 'holding'), { force: true });
        }
        const last = context.messages.at(-1);
        if (last?.role === 'user' && text(last).startsWith('[pi-dish: this context window is') && text(last).includes('opening a fresh window')) {
            return faux.fauxAssistantMessage('Summary: Rolled over while idle\n<<<NOTEBOOK\nNotes kept over the rollover.\nNOTEBOOK>>>');
        }
        const users = context.messages.filter(message => message.role === 'user');
        const latest = users.at(-1);
        const images = Array.isArray(latest?.content) ? latest.content.filter(part => part.type === 'image').length : 0;
        const note = images ? `[${images} image${images === 1 ? '' : 's'}]` : '';
        return faux.fauxAssistantMessage(`echo ${users.length}: ${[text(latest), note].filter(Boolean).join(' ')}`);
    };
    handle.appendResponses(Array.from({ length: 1000 }, () => answer));
    const models = createModels();
    models.setProvider(handle.provider);
    return { models, close: async () => { } };
}
