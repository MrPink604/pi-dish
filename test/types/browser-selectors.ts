import { mountThinkingSelector } from '../../src/browser/thinking-selector';
import type { ThinkingSelectorActions, ThinkingSelectorView } from '../../src/browser/thinking-selector';

declare const root: HTMLElement;
declare const view: ThinkingSelectorView;
declare const actions: ThinkingSelectorActions;
const selector = mountThinkingSelector(root, actions);
selector.update(view);
selector.dispose();
// @ts-expect-error The renderer cannot append a current level to a caller's shared vocabulary.
view.levels.push('future-level');
// @ts-expect-error Actions carry a complete host/id/generation owner.
actions.selectLevel({ id: 'one' }, 'high');
mountThinkingSelector(root, {
  ...actions,
  // @ts-expect-error A level-only action discards selection ownership.
  selectLevel: (level: string) => { void level; },
});
