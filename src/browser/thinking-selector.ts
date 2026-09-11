import type { SelectionOwner } from './session-state';

export interface ThinkingSelectorView {
  readonly owner: SelectionOwner;
  readonly levels: readonly string[];
  readonly currentLevel: string | null;
}
export interface ThinkingSelectorActions {
  selectLevel: (owner: SelectionOwner, level: string) => void;
  requestClose: (owner: SelectionOwner) => void;
}

/** Own the dropdown's children and listeners; the shell owns its visibility. */
export function mountThinkingSelector(root: HTMLElement, actions: ThinkingSelectorActions) {
  let view: ThinkingSelectorView | null = null;
  let disposed = false;

  function update(next: ThinkingSelectorView): void {
    if (disposed) return;
    // The helper's Pi vocabulary is shared. An unsupported current level is
    // visible in this menu only; it must not mutate that shared vocabulary.
    const levels = [...next.levels];
    if (next.currentLevel && !levels.includes(next.currentLevel)) levels.push(next.currentLevel);
    view = { owner: next.owner, levels, currentLevel: next.currentLevel };
    const fragment = root.ownerDocument.createDocumentFragment();
    for (const level of levels) {
      const button = root.ownerDocument.createElement('button');
      button.type = 'button';
      const active = level === next.currentLevel;
      button.className = 'thinking-option' + (active ? ' active' : '');
      button.setAttribute('aria-pressed', String(active));
      button.dataset.level = level;
      button.textContent = level;
      fragment.append(button);
    }
    root.replaceChildren(fragment);
  }

  function onClick(event: MouseEvent): void {
    if (!view || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button.thinking-option');
    if (!button || !root.contains(button)) return;
    actions.selectLevel(view.owner, button.dataset.level || '');
  }

  function onKeydown(event: KeyboardEvent): void {
    // Keep the shell's Escape policy reachable (including cancelling a live
    // microphone), matching the model selector's event propagation.
    if (view && event.key === 'Escape') actions.requestClose(view.owner);
  }

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeydown);
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      view = null;
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeydown);
      root.replaceChildren();
    },
  };
}
