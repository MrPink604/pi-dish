import type { createSessionActivity } from '../../src/browser/session-activity';
import type { createBtwPanel } from '../../src/browser/btw-panel';
declare const activity: ReturnType<typeof createSessionActivity>;
declare const panel: ReturnType<typeof createBtwPanel>;
// @ts-expect-error only the activity writer can change turn state
activity.turn = false;
// @ts-expect-error activity state accepts a boolean
activity.setCompacting('yes');
// @ts-expect-error response delivery requires its captured question owner
panel.resolve('unowned');
// @ts-expect-error an abort gate cannot be retired with an unrelated string
activity.endAbort('self same', 'old request');
