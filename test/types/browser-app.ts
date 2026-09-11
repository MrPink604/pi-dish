import type { createAppChrome } from '../../src/browser/app-chrome';
import type { createHostView } from '../../src/browser/host-view';
declare const chrome: ReturnType<typeof createAppChrome>;
declare const project: ReturnType<typeof createHostView>;
// @ts-expect-error viewport following is owned by the chrome controller
chrome.following = true;
// @ts-expect-error focus uses a boolean preference
chrome.setFocus('on');
// @ts-expect-error host projection requires normalized endpoint identity
project({ base: '/peer' });

import type { AppActions } from '../../src/browser/app-bindings';
// @ts-expect-error all registered static actions must have typed callbacks
const incompleteActions: AppActions = { openUsageView() {} };
void incompleteActions;
