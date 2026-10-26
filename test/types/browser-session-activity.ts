import type { createSessionActivity } from '../../src/browser/session-activity';
import type { createSideChat } from '../../src/browser/side-chat';
declare const activity: ReturnType<typeof createSessionActivity>;
declare const sideChat: ReturnType<typeof createSideChat>;
// @ts-expect-error only the activity writer can change turn state
activity.turn = false;
// @ts-expect-error activity state accepts a boolean
activity.setCompacting('yes');
// @ts-expect-error stream snapshots carry their session identity
sideChat.apply({}, { id: 'session' });
// @ts-expect-error ask options only choose a fresh chat
sideChat.ask('question', { chatId: 'chat' });
// @ts-expect-error an abort gate cannot be retired with an unrelated string
activity.endAbort('self same', 'old request');
