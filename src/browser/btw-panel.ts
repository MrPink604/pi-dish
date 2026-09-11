import { escapeHtml } from './helper-format';
import type { SelectionOwner, createSessionState } from './session-state';
export type BtwOwner = Readonly<{ selection: SelectionOwner; generation: number }>;
/** Each question owns its response and controls, including clipboard completion. */
export function createBtwPanel(options: {
  document: Document; sessionState: ReturnType<typeof createSessionState>;
  markdown: (text: string) => string; copy: (text: string) => Promise<unknown>;
}) {
  const panel = options.document.getElementById('btwPanel')!;
  let current: BtwOwner | null = null, generation = 0, answer: string | null = null, disposed = false;
  let events = new AbortController(), timer: ReturnType<typeof setTimeout> | null = null;
  function owns(owner: BtwOwner | null | undefined): owner is BtwOwner {
    return !disposed && !!owner && current === owner && options.sessionState.ownsSelection(owner.selection);
  }
  function close() {
    current = null; answer = null; events.abort(); if (timer) clearTimeout(timer); timer = null;
    panel.style.display = 'none'; panel.innerHTML = '';
  }
  function show(question: string): BtwOwner | null {
    if (disposed) return null; close(); const selection = options.sessionState.captureSelection(); if (!selection) return null;
    const owner = Object.freeze({ selection, generation: ++generation }); current = owner; events = new AbortController(); const { signal } = events;
    panel.className = 'btw-panel pending';
    panel.innerHTML = `<div class="btw-panel-header"><span class="btw-panel-tag">btw</span>
      <span class="btw-panel-question" title="Click to expand">${escapeHtml(question)}</span>
      <button class="btw-panel-btn btw-copy" style="display:none" title="Copy answer">Copy</button>
      <button class="btw-panel-btn btw-dismiss" title="Dismiss">✕</button></div><div class="btw-panel-answer">Asking…</div>`;
    panel.style.display = '';
    panel.querySelector('.btw-panel-question')!.addEventListener('click', event => { if (owns(owner)) (event.currentTarget as HTMLElement).classList.toggle('expanded'); }, { signal });
    panel.querySelector('.btw-dismiss')!.addEventListener('click', () => { if (owns(owner)) close(); }, { signal });
    const button = panel.querySelector<HTMLButtonElement>('.btw-copy')!;
    button.addEventListener('click', () => { void copy(button, owner); }, { signal });
    return owner;
  }
  function resolve(text: string, owner: BtwOwner | null | undefined) {
    if (!owns(owner)) return; answer = text; panel.className = 'btw-panel';
    panel.querySelector('.btw-panel-answer')!.innerHTML = `<div class="markdown-body">${options.markdown(text)}</div>`;
    panel.querySelector<HTMLElement>('.btw-copy')!.style.display = '';
  }
  function fail(error: string, owner: BtwOwner | null | undefined) {
    if (!owns(owner)) return; panel.className = 'btw-panel error'; panel.querySelector('.btw-panel-answer')!.textContent = error;
  }
  async function copy(button: HTMLButtonElement, owner = current) {
    if (!owns(owner) || !answer || !panel.contains(button)) return; const captured = answer; button.disabled = true;
    try {
      await options.copy(captured); if (!owns(owner) || !panel.contains(button)) return;
      button.textContent = 'Copied'; if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; if (owns(owner) && panel.contains(button)) button.textContent = 'Copy'; }, 1500);
    } catch { if (owns(owner) && panel.contains(button)) button.textContent = 'Failed'; }
    finally { if (owns(owner) && panel.contains(button)) button.disabled = false; }
  }
  function dispose() { if (disposed) return; close(); disposed = true; }
  return { show, resolve, fail, close, copy, owns, dispose };
}
