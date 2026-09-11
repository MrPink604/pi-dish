import type { ApiRequest, HostEndpoint } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import { sessionRefKey } from './helper-identity';
import { escapeHtml } from './helper-format';
import { record } from './helper-values';
import { createTranscriptCache } from './transcript-cache';
import type { TranscriptCursors } from './transcript-cache';
import { decodeTranscriptPage } from './transcript-data';
/** The selected transcript owns its paging cursors, endpoint, requests and retained DOM. */
export function createTranscript(options: {
  document: Document; sessionState: SessionState; request: ApiRequest; host: (id: string | null) => HostEndpoint | null;
  renderMessage: (message: unknown) => string; finalize: (root: HTMLElement, options?: { stripLive?: boolean }) => void;
  closeSearch: () => void; cancelStreaming: () => void; mood: (description: string, face: string) => void; updateMood: (messages: readonly unknown[]) => void;
  pinned: (root: HTMLElement) => boolean; scroll: (root: HTMLElement) => void; jump: (root: HTMLElement) => void;
  consumeEcho: (id: string, content: unknown) => void;
}) {
  const { document, sessionState } = options, container = document.getElementById('messages')!;
  const cache = createTranscriptCache(document), requests = new Set<AbortController>();
  let disposed = false, generation = 0, catchupSequence = 0, older: symbol | null = null, barEvents = new AbortController();
  let cursors: TranscriptCursors = { oldestIndex: null, lastIndex: null, hasOlder: false, total: 0 };
  let loaded: { key: string; base: string } | null = null;
  interface Owner { selection: SelectionOwner; endpoint: Readonly<HostEndpoint>; generation: number }
  function capture(selection = sessionState.captureSelection()): Owner | null {
    if (disposed || !selection || !sessionState.ownsSelection(selection)) return null;
    const endpoint = options.host(selection.host); return endpoint ? { selection, endpoint: Object.freeze({ ...endpoint }), generation } : null;
  }
  const owns = (owner: Owner) => !disposed && owner.generation === generation && sessionState.ownsSelection(owner.selection) && options.host(owner.selection.host)?.base === owner.endpoint.base;
  function retire() { generation++; catchupSequence++; older = null; barEvents.abort(); for (const request of requests) request.abort(); requests.clear(); }
  function reset() { retire(); loaded = null; cursors = { oldestIndex: null, lastIndex: null, hasOlder: false, total: 0 }; }
  async function page(owner: Owner, suffix: string) {
    const endpoint = options.host(owner.selection.host); if (!owns(owner) || !endpoint) throw new Error('Transcript ownership changed');
    const controller = new AbortController(); requests.add(controller);
    try {
      const response = await options.request({ ...owner.endpoint, token: endpoint.token }, `/api/sessions/${encodeURIComponent(owner.selection.id)}/messages?${suffix}`, { signal: controller.signal });
      const value: unknown = await response.json(); if (!response.ok) throw new Error(record(value) && typeof value.error === 'string' ? value.error : `Transcript request failed (${response.status})`);
      return decodeTranscriptPage(value);
    } finally { requests.delete(controller); }
  }
  function barHtml() { return cursors.hasOlder ? `<div class="load-older-bar" id="loadOlderBar"><button class="load-older-btn">Load older messages (${cursors.oldestIndex ?? 0} earlier)</button></div>` : ''; }
  function bindBar() {
    barEvents.abort(); barEvents = new AbortController(); const owner = capture(), button = container.querySelector<HTMLButtonElement>('.load-older-btn');
    if (owner && button) button.addEventListener('click', () => { if (owns(owner) && button.isConnected && container.contains(button)) void loadOlder(); }, { signal: barEvents.signal });
  }
  function stash() {
    const selected = sessionState.currentSession; if (disposed || !selected || !loaded || loaded.key !== sessionRefKey(selected)) return;
    cache.stash(loaded.key, loaded.base, cursors, container);
  }
  function restore(id: string) {
    const owner = capture(); if (!owner || owner.selection.id !== id) return false;
    const key = sessionRefKey(owner.selection), entry = cache.restore(key, owner.endpoint.base, container); if (!entry) return false;
    cursors = { oldestIndex: entry.oldestIndex, lastIndex: entry.lastIndex, hasOlder: entry.hasOlder, total: entry.total }; loaded = { key, base: owner.endpoint.base };
    options.mood(entry.moodDescription, entry.moodFace); options.jump(container); bindBar(); return true;
  }
  function render(messages: readonly unknown[]) {
    if (disposed) return; options.updateMood(messages);
    if (!messages.length) { container.innerHTML = '<div class="empty-state" style="padding: 48px;"><p style="color: var(--text-muted);">No messages yet</p></div>'; barEvents.abort(); return; }
    container.innerHTML = barHtml() + messages.map(options.renderMessage).join(''); bindBar(); options.finalize(container); options.scroll(container);
  }
  async function load(selection = sessionState.captureSelection()) {
    if (!capture(selection)) return; retire(); const owner = capture(selection); if (!owner) return;
    options.cancelStreaming(); options.closeSearch();
    if (restore(owner.selection.id)) { await catchup(selection); return; }
    loaded = null; container.innerHTML = '<div class="loading">Loading...</div>'; cursors = { oldestIndex: null, lastIndex: null, hasOlder: false, total: 0 }; options.mood('', '');
    try {
      const data = await page(owner, 'limit=50'); if (!owns(owner)) return;
      sessionState.mergeCurrentSession(owner.selection, data.session); loaded = { key: sessionRefKey(owner.selection), base: owner.endpoint.base };
      cursors = { oldestIndex: data.firstIndex, lastIndex: data.lastIndex, hasOlder: data.hasMore, total: data.totalMessages || 0 }; render(data.messages);
    } catch (error) { if (owns(owner)) container.innerHTML = `<div class="error">Failed to load messages: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`; }
  }
  async function loadOlder() {
    if (older || !cursors.hasOlder || cursors.oldestIndex == null) return; const owner = capture(); if (!owner) return;
    const operation = Symbol('older'), before = cursors.oldestIndex; older = operation;
    const bar = container.querySelector<HTMLElement>('#loadOlderBar'), button = bar?.querySelector<HTMLElement>('.load-older-btn'); if (button) button.textContent = 'Loading...';
    const anchor = container.querySelector<HTMLElement>(':scope > .message, :scope > details.tool-group'), offset = anchor?.getBoundingClientRect().top || 0;
    try {
      const data = await page(owner, 'limit=50&before=' + before); if (!owns(owner) || older !== operation) return;
      if (data.messages.length) {
        const html = data.messages.map(options.renderMessage).join(''); container.querySelector('#loadOlderBar')?.remove();
        cursors.oldestIndex = data.firstIndex ?? cursors.oldestIndex; cursors.hasOlder = data.hasMore;
        container.insertAdjacentHTML('afterbegin', barHtml() + html); bindBar(); options.finalize(container, { stripLive: false });
        if (!document.getElementById('moodIndicator')) options.updateMood(data.messages);
        if (anchor?.isConnected && container.contains(anchor)) container.scrollTop += anchor.getBoundingClientRect().top - offset;
      } else { cursors.hasOlder = false; container.querySelector('#loadOlderBar')?.remove(); barEvents.abort(); }
    } catch (error) { if (owns(owner) && older === operation && button?.isConnected) button.textContent = `Failed: ${error instanceof Error ? error.message : String(error)} — retry`; }
    finally { if (older === operation) older = null; }
  }
  async function catchup(selection = sessionState.captureSelection()): Promise<void> {
    const owner = capture(selection); if (!owner) return; if (cursors.lastIndex == null) return load(selection);
    const sequence = ++catchupSequence, after = cursors.lastIndex;
    try {
      const data = await page(owner, 'after=' + after); if (!owns(owner) || sequence !== catchupSequence) return;
      sessionState.mergeCurrentSession(owner.selection, data.session); if (data.totalMessages != null) cursors.total = data.totalMessages;
      if (!data.messages.length) return;
      const existing = new Set(Array.from(container.querySelectorAll<HTMLElement>('[data-msg-index]')).map(el => Number.parseInt(el.dataset.msgIndex || '', 10)));
      const fresh = data.messages.filter(message => message.index == null || !existing.has(message.index));
      for (const message of fresh) if (message.role === 'user') options.consumeEcho(owner.selection.id, message.content);
      options.updateMood(fresh);
      if (!fresh.length) { if (data.lastIndex != null) cursors.lastIndex = Math.max(cursors.lastIndex ?? 0, data.lastIndex); return; }
      const pinned = options.pinned(container), assistant = fresh.some(message => message.role === 'assistant');
      container.querySelectorAll('.message:not([data-msg-index])').forEach(el => { if (el.classList.contains('assistant') && !assistant) return; el.remove(); });
      container.insertAdjacentHTML('beforeend', fresh.map(options.renderMessage).join('')); if (data.lastIndex != null) cursors.lastIndex = Math.max(cursors.lastIndex ?? 0, data.lastIndex);
      options.finalize(container); if (pinned) options.scroll(container); else options.jump(container);
    } catch (error) { if (owns(owner) && sequence === catchupSequence) console.error('fetchNewMessagesSince failed:', error); }
  }
  return { load, loadOlder, catchup, render, stash, restore, reset, retire, barHtml, maybeOlder(root: HTMLElement | null) { if (root && root.scrollTop <= 200) void loadOlder(); },
    deleteCached: (key: string) => cache.delete(key), retainedRoots: cache.roots, pruneCache: cache.prune,
    get oldestIndex() { return cursors.oldestIndex; }, get lastIndex() { return cursors.lastIndex; }, get hasOlder() { return cursors.hasOlder; }, get total() { return cursors.total; }, get loadingOlder() { return !!older; },
    dispose() { if (disposed) return; retire(); disposed = true; cache.clear(); loaded = null; } };
}
