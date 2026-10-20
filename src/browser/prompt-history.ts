import { storedPromptHistories } from './composer-drafts';

export interface PromptHistoryOwnerLabel { readonly name: string | null; readonly detail: string }
/** The composer-draft surface this controller drives; owner keys are host-qualified. */
export interface PromptHistoryDrafts {
  readonly key: string | null;
  prompts(id?: string | null): string[];
  clearHistory(id: string): void;
  restorePayload(id: string, message: string, attachments: null): void;
}
export interface PromptHistoryController {
  open(): void; close(): void; toggle(): void; isOpen(): boolean;
  /** Re-evaluates the composer button after the visible owner or its prompts change. */
  update(): void;
  renderSettings(container: HTMLElement, signal: AbortSignal): void;
  dispose(): void;
}

/**
 * Sent-prompt recall without a keyboard: the composer sheet lists the visible
 * owner's prompts newest first, and the settings section manages every stored
 * history. The sheet captures its owner when it opens; a retained row never
 * writes into whichever session became visible since.
 */
export function createPromptHistory(options: {
  document: Document; storage: Pick<Storage, 'length' | 'key' | 'getItem'>; drafts: PromptHistoryDrafts;
  label: (owner: string) => PromptHistoryOwnerLabel; copy: (text: string) => Promise<void>;
  status: (text: string, type?: string) => void; confirm: (text: string) => boolean;
}): PromptHistoryController {
  const { document, drafts } = options;
  const button = document.getElementById('btnPromptHistory') as HTMLButtonElement, panel = document.getElementById('promptHistoryPanel')!;
  let owner: string | null = null, events = new AbortController(), disposed = false, generation = 0;

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
    const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
  }
  function copyButton(text: string, signal: AbortSignal) {
    const copy = element('button', 'btn-small prompt-copy', 'Copy'); copy.type = 'button'; copy.title = 'Copy prompt';
    copy.addEventListener('click', event => {
      event.stopPropagation();
      options.copy(text).then(() => { if (!signal.aborted) { copy.textContent = 'Copied'; options.status('Prompt copied'); } }, () => { if (!signal.aborted) options.status('Copy failed', 'error'); });
    }, { signal });
    return copy;
  }

  function close() {
    generation++; events.abort(); owner = null;
    panel.classList.remove('open'); panel.replaceChildren(); button.classList.remove('active'); button.setAttribute('aria-expanded', 'false');
  }
  /** Shows the button only for a composer owner with sent prompts; an owner change closes the sheet. */
  function update() {
    if (disposed) return; const key = drafts.key, any = !!key && drafts.prompts(key).length > 0;
    button.style.display = any ? '' : 'none'; button.disabled = !any;
    if (owner && (owner !== key || !any)) close();
  }
  function open() {
    if (disposed) return; close(); const captured = drafts.key; if (!captured) return;
    const prompts = drafts.prompts(captured).reverse(); if (!prompts.length) { update(); return; }
    owner = captured; events = new AbortController(); const { signal } = events, version = generation;
    const header = element('div', 'prompt-history-header'); header.append(element('strong', '', 'Sent prompts'), element('small', '', 'Tap to insert into the composer'));
    const list = element('ol', 'prompt-history-list');
    for (const prompt of prompts) {
      const row = element('li', 'prompt-history-item'), insert = element('button', 'prompt-history-text'); insert.type = 'button'; insert.title = 'Insert into composer';
      insert.append(element('span', 'prompt-history-clamp', prompt));
      insert.addEventListener('click', () => {
        if (version !== generation || drafts.key !== captured) { close(); return; }
        close(); drafts.restorePayload(captured, prompt, null);
      }, { signal });
      row.append(insert, copyButton(prompt, signal)); list.append(row);
    }
    panel.replaceChildren(header, list); panel.classList.add('open'); button.classList.add('active'); button.setAttribute('aria-expanded', 'true'); panel.scrollTop = 0;
    // Outside taps dismiss the sheet; registered after the opening click finishes bubbling.
    setTimeout(() => {
      if (signal.aborted) return;
      document.addEventListener('click', event => {
        const target = event.target instanceof Node ? event.target : null;
        if (target && document.body.contains(target) && !panel.contains(target) && !button.contains(target)) close();
      }, { signal });
    }, 0);
  }

  function renderSettings(container: HTMLElement, signal: AbortSignal) {
    if (disposed || signal.aborted) return;
    const expanded = new Set(Array.from(container.querySelectorAll<HTMLDetailsElement>('details.sent-prompts-session[open]'), node => node.dataset.owner || ''));
    const rows = storedPromptHistories(options.storage).map(row => ({ ...row, label: options.label(row.owner) }))
      .sort((a, b) => (a.label.name || a.label.detail).localeCompare(b.label.name || b.label.detail));
    const section = element('div', 'preference-row sent-prompts-row'), label = element('label');
    label.append(element('strong', '', 'Sent prompts'), element('small', '', 'Stored on this device: the last 50 prompts this browser sent to each session.'));
    const clearAll = element('button', 'btn-small', 'Clear all'); clearAll.type = 'button'; clearAll.id = 'sentPromptsClearAll'; clearAll.disabled = !rows.length;
    clearAll.addEventListener('click', () => {
      if (signal.aborted || !options.confirm(`Clear sent prompts for all ${rows.length} session${rows.length === 1 ? '' : 's'} on this device?`)) return;
      for (const row of rows) drafts.clearHistory(row.owner);
      renderSettings(container, signal);
    }, { signal });
    const list = element('div', 'sent-prompts-list');
    if (!rows.length) list.append(element('small', 'sent-prompts-empty', 'No sent prompts stored on this device.'));
    for (const row of rows) {
      const details = element('details', 'sent-prompts-session'); details.dataset.owner = row.owner; details.open = expanded.has(row.owner);
      const summary = element('summary');
      summary.append(element('span', 'sent-prompts-name', row.label.name || row.label.detail), element('span', 'sent-prompts-meta', `${row.label.name ? row.label.detail + ' · ' : ''}${row.prompts.length} prompt${row.prompts.length === 1 ? '' : 's'}`));
      const clear = element('button', 'btn-small sent-prompts-clear', 'Clear session'); clear.type = 'button';
      clear.addEventListener('click', () => {
        if (signal.aborted || !options.confirm(`Clear ${row.prompts.length} sent prompt${row.prompts.length === 1 ? '' : 's'} for “${row.label.name || row.label.detail}”?`)) return;
        drafts.clearHistory(row.owner); renderSettings(container, signal);
      }, { signal });
      const entries = element('ol', 'sent-prompts-entries');
      for (const prompt of [...row.prompts].reverse()) { const entry = element('li', 'sent-prompts-entry'); entry.append(element('div', 'sent-prompts-text', prompt), copyButton(prompt, signal)); entries.append(entry); }
      details.append(summary, clear, entries); list.append(details);
    }
    section.append(label, clearAll, list); container.replaceChildren(section);
  }

  return { open, close, update, renderSettings, toggle() { if (owner) close(); else open(); }, isOpen() { return owner !== null; },
    dispose() { if (disposed) return; close(); disposed = true; } };
}
