/**
 * A bot relay's model in tests (`PI_DISH_BOT_MODELS` names this module): pi-ai's faux provider under the bot's own
 * selector. Every request is answered `echo <n>: <last user text>`, where n counts the user messages in its context,
 * so a test sees what the bot's conversation holds. While `hold` exists in `PI_DISH_BOT_FAUX_DIR` an answer waits
 * for it to go, and `holding` says one is waiting: a run a test keeps in progress.
 */
import fs = require('node:fs');
import path = require('node:path');
import { setTimeout as delay } from 'node:timers/promises';
import type { Models } from '@earendil-works/pi-ai' with { 'resolution-mode': 'import' };
import type { TranscriptContext } from '@earendil-works/pi-ai' with { 'resolution-mode': 'import' };

function text(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content.map(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' ? String((part as { text?: unknown }).text ?? '') : '').join('')
    : '';
}

export async function openBotModels(selector: string): Promise<{ models: Models; close(): Promise<void> }> {
  const faux = await import('@earendil-works/pi-ai/providers/faux');
  const { createModels } = await import('@earendil-works/pi-ai/models');
  const slash = selector.indexOf('/');
  const handle = faux.fauxProvider({ provider: selector.slice(0, slash), models: [{ id: selector.slice(slash + 1), contextWindow: 200_000 }] });
  const dir = process.env.PI_DISH_BOT_FAUX_DIR || '';
  const answer = async (context: TranscriptContext) => {
    if (dir && fs.existsSync(path.join(dir, 'hold'))) {
      fs.writeFileSync(path.join(dir, 'holding'), '');
      while (fs.existsSync(path.join(dir, 'hold'))) await delay(50);
      fs.rmSync(path.join(dir, 'holding'), { force: true });
    }
    const users = context.messages.filter(message => message.role === 'user');
    return faux.fauxAssistantMessage(`echo ${users.length}: ${text(users.at(-1))}`);
  };
  handle.appendResponses(Array.from({ length: 1000 }, () => answer));
  const models = createModels();
  models.setProvider(handle.provider);
  return { models, close: async () => {} };
}
