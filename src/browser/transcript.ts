import type { ApiRequest, HostEndpoint } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { RenderMessage } from './message-data';
import { sessionRefKey } from './helper-identity';
import { escapeHtml } from '../core/helper-format';
import { record } from '../core/helper-values';
import { createTranscriptCache } from './transcript-cache';
import type { TranscriptCursors } from './transcript-cache';
import { decodeTranscriptPage, type TranscriptPage } from './transcript-data';
/** The selected transcript owns its paging cursors, endpoint, requests and retained DOM. */
export function createTranscript(options: {
  document: Document; sessionState: SessionState; request: ApiRequest; host: (id: string | null) => HostEndpoint | null;
  renderMessage: (message: RenderMessage) => string; finalize: (root: HTMLElement, options?: { stripLive?: boolean }) => void;
  closeSearch: () => void; cancelStreaming: () => void; mood: (description: string, face: string) => void; updateMood: (messages: readonly RenderMessage[]) => void;
  pinned: (root: HTMLElement) => boolean; scroll: (root: HTMLElement) => void; jump: (root: HTMLElement) => void;
  consumeEcho: (id: string, content: unknown) => void;
}) {
  const { document, sessionState } = options, container = document.getElementById('messages')!;
  const cache = createTranscriptCache(document), requests = new Set<AbortController>();
  let disposed = false, generation = 0, catchupSequence = 0, seekSequence = 0, older: symbol | null = null, olderFlight: Promise<void> | null = null, barEvents = new AbortController();
  let cursors: TranscriptCursors = { oldestIndex: null, lastIndex: null, hasOlder: false, total: 0 };
  let loaded: { key: string; base: string } | null = null;
  interface Owner { selection: SelectionOwner; endpoint: Readonly<HostEndpoint>; generation: number }
  const windowFlights = new Map<number, { owner: Owner; done: Promise<TranscriptPage> }>();
  function capture(selection = sessionState.captureSelection()): Owner | null {
    if (disposed || !selection || !sessionState.ownsSelection(selection)) return null;
    const endpoint = options.host(selection.host); return endpoint ? { selection, endpoint: Object.freeze({ ...endpoint }), generation } : null;
  }
  const owns = (owner: Owner) => {
    const endpoint = options.host(owner.selection.host);
    return !disposed && owner.generation === generation && sessionState.ownsSelection(owner.selection)
      && endpoint?.base === owner.endpoint.base && (endpoint.token || '') === (owner.endpoint.token || '');
  };
  function retire() { generation++; catchupSequence++; older = null; olderFlight = null; windowFlights.clear(); barEvents.abort(); for (const request of requests) request.abort(); requests.clear(); }
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
    barEvents.abort(); barEvents = new AbortController(); const owner = capture(), button = container.querySelector<HTMLButtonElement>('#loadOlderBar .load-older-btn');
    if (!owner) return;
    if (button) button.addEventListener('click', () => { if (owns(owner) && button.isConnected && container.contains(button)) void loadOlder(); }, { signal: barEvents.signal });
    for (const gap of container.querySelectorAll<HTMLElement>('.transcript-gap')) {
      for (const control of gap.querySelectorAll<HTMLButtonElement>('[data-before]')) control.addEventListener('click', () => {
        if (owns(owner) && container.contains(gap)) void loadGap(owner, gap, Number(control.dataset.before), control.dataset.direction === 'newer');
      }, { signal: barEvents.signal });
    }
  }
  function topLevel(node: HTMLElement): HTMLElement {
    while (node.parentElement && node.parentElement !== container) node = node.parentElement;
    return node;
  }
  /** Gaps are real group boundaries, not invented contiguous transcript history. */
  function refreshPaging() {
    container.querySelectorAll('#loadOlderBar, .transcript-gap').forEach(node => node.remove());
    container.insertAdjacentHTML('afterbegin', barHtml());
    let previous: number | null = null;
    for (const node of container.querySelectorAll<HTMLElement>('[data-msg-index]')) {
      const index = Number(node.dataset.msgIndex);
      if (previous != null && index > previous + 1) {
        const start = previous + 1, end = index, gap = document.createElement('div');
        gap.className = 'load-older-bar transcript-gap';
        gap.innerHTML = `<span>${end - start} messages not loaded</span> <button class="load-older-btn" data-direction="newer" data-before="${Math.min(start + 50, end)}">Load newer messages</button> <button class="load-older-btn" data-direction="older" data-before="${end}">Load older messages</button>`;
        topLevel(node).before(gap);
      }
      previous = index;
    }
    bindBar();
  }
  /** Insert only the missing portion; move neither retained nodes nor the live tail. */
  function insertWindow(messages: readonly RenderMessage[], stripLive = false) {
    const indexed = Array.from(container.querySelectorAll<HTMLElement>('[data-msg-index]'));
    const existing = new Set(indexed.map(node => Number(node.dataset.msgIndex)));
    const fresh = messages.filter(message => message.index == null || !existing.has(message.index));
    let next = 0, anchor: HTMLElement | null = null, html = '';
    const flush = () => {
      if (!html) return;
      if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else container.insertAdjacentHTML('beforeend', html);
      html = '';
    };
    for (const message of fresh) {
      const index = message.index;
      while (index != null && next < indexed.length && Number(indexed[next]!.dataset.msgIndex) < index) next++;
      const target = index != null && next < indexed.length ? topLevel(indexed[next]!) : null;
      if (target !== anchor) { flush(); anchor = target; }
      html += options.renderMessage(message);
      if (index != null) cursors.oldestIndex = Math.min(cursors.oldestIndex ?? index, index);
    }
    flush();
    cursors.hasOlder = cursors.oldestIndex != null && cursors.oldestIndex > 0;
    refreshPaging(); options.finalize(container, { stripLive });
  }
  async function loadGap(owner: Owner, gap: HTMLElement, before: number, newer: boolean) {
    if (gap.dataset.loading) return;
    gap.dataset.loading = 'true';
    gap.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
    const anchor = newer ? gap.previousElementSibling : gap.nextElementSibling, offset = anchor?.getBoundingClientRect().top ?? 0;
    const retained = anchor instanceof HTMLElement && anchor.matches('[data-msg-index]') ? anchor : anchor?.querySelector<HTMLElement>('[data-msg-index]');
    try {
      const data = await page(owner, 'limit=50&before=' + before);
      if (!owns(owner) || !container.contains(gap)) return;
      insertWindow(data.messages);
      if (retained?.isConnected && container.contains(retained)) container.scrollTop += topLevel(retained).getBoundingClientRect().top - offset;
    } catch (error) {
      if (owns(owner) && container.contains(gap)) {
        const label = gap.querySelector('span');
        if (label) label.textContent = `Failed: ${error instanceof Error ? error.message : String(error)} — retry`;
      }
    } finally {
      delete gap.dataset.loading;
      gap.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; });
    }
  }
  async function ensureMessage(index: number, isCurrent: () => boolean): Promise<void> {
    const sequence = ++seekSequence, owner = capture();
    if (!owner || !loaded || loaded.key !== sessionRefKey(owner.selection) || loaded.base !== owner.endpoint.base
      || !isCurrent() || !Number.isSafeInteger(index) || index < 0
      || container.querySelector(`[data-msg-index="${index}"]`)) return;
    // The existing API slices before projection. One bounded window works at
    // any depth, while lastIndex continues to describe the retained live tail.
    const before = Math.min(Math.max(cursors.total, index + 1), Math.max(50, index + 26));
    let flight = windowFlights.get(before);
    if (!flight || !owns(flight.owner)) {
      const done = page(owner, 'limit=50&before=' + before).finally(() => {
        if (windowFlights.get(before)?.done === done) windowFlights.delete(before);
      });
      flight = { owner, done }; windowFlights.set(before, flight);
    }
    const data = await flight.done;
    if (!owns(owner) || sequence !== seekSequence || !isCurrent()
      || !data.messages.some(message => message.index === index)) return;
    insertWindow(data.messages);
  }
  function stash() {
    const selected = sessionState.currentSession; if (disposed || !selected || !loaded || loaded.key !== sessionRefKey(selected)) return;
    cache.stash(loaded.key, loaded.base, cursors, container);
  }
  function restore(id: string) {
    const owner = capture(); if (!owner || owner.selection.id !== id) return false;
    const key = sessionRefKey(owner.selection), entry = cache.restore(key, owner.endpoint.base, container); if (!entry) return false;
    cursors = { oldestIndex: entry.oldestIndex, lastIndex: entry.lastIndex, hasOlder: entry.hasOlder, total: entry.total }; loaded = { key, base: owner.endpoint.base };
    options.mood(entry.moodDescription, entry.moodFace); refreshPaging(); options.jump(container); return true;
  }
  function render(messages: readonly RenderMessage[]) {
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
    // Concurrent consumers join the existing request; the original operation
    // keeps its selection owner and applies the page under its own guards.
    const owner = capture(); if (!owner) return;
    if (olderFlight) return olderFlight;
    if (!cursors.hasOlder || cursors.oldestIndex == null) return;
    const operation = Symbol('older'), before = cursors.oldestIndex; older = operation;
    const flight: Promise<void> = fetchOlderPage(owner, operation, before).finally(() => {
      if (older === operation) older = null;
      if (olderFlight === flight) olderFlight = null;
    });
    olderFlight = flight;
    return flight;
  }
  async function fetchOlderPage(owner: Owner, operation: symbol, before: number) {
    const bar = container.querySelector<HTMLElement>('#loadOlderBar'), button = bar?.querySelector<HTMLElement>('.load-older-btn'); if (button) button.textContent = 'Loading...';
    const anchor = container.querySelector<HTMLElement>(':scope > .message, :scope > details.tool-group'), offset = anchor?.getBoundingClientRect().top || 0;
    try {
      const data = await page(owner, 'limit=50&before=' + before); if (!owns(owner) || older !== operation) return;
      if (data.messages.length) {
        insertWindow(data.messages);
        if (!document.getElementById('moodIndicator')) options.updateMood(data.messages);
        if (anchor?.isConnected && container.contains(anchor)) container.scrollTop += anchor.getBoundingClientRect().top - offset;
      } else if (cursors.oldestIndex === before) { cursors.hasOlder = false; container.querySelector('#loadOlderBar')?.remove(); bindBar(); }
    } catch (error) { if (owns(owner) && older === operation && button?.isConnected) button.textContent = `Failed: ${error instanceof Error ? error.message : String(error)} — retry`; }
  }
  async function catchup(selection = sessionState.captureSelection()): Promise<void> {
    const owner = capture(selection); if (!owner) return; if (cursors.lastIndex == null) return load(selection);
    const sequence = ++catchupSequence, after = cursors.lastIndex;
    try {
      const data = await page(owner, 'after=' + after); if (!owns(owner) || sequence !== catchupSequence) return;
      sessionState.mergeCurrentSession(owner.selection, data.session); if (data.totalMessages != null) cursors.total = data.totalMessages;
      if (!data.messages.length) return;
      const indexed = container.querySelectorAll<HTMLElement>('[data-msg-index]');
      const existing = new Set(Array.from(indexed, el => Number.parseInt(el.dataset.msgIndex || '', 10)));
      const fresh = data.messages.filter(message => message.index == null || !existing.has(message.index));
      for (const message of fresh) if (message.role === 'user') options.consumeEcho(owner.selection.id, message.content);
      options.updateMood(fresh);
      if (!fresh.length) { if (data.lastIndex != null) cursors.lastIndex = Math.max(cursors.lastIndex ?? 0, data.lastIndex); return; }
      const pinned = options.pinned(container), assistant = fresh.some(message => message.role === 'assistant');
      container.querySelectorAll('.message:not([data-msg-index])').forEach(el => { if (el.classList.contains('assistant') && !assistant) return; el.remove(); });
      // A search can find output newer than the last SSE catch-up. Fill that
      // sparse window chronologically, but keep the normal live append cheap.
      if (Number(indexed[indexed.length - 1]?.dataset.msgIndex) > after) insertWindow(fresh, true);
      else { container.insertAdjacentHTML('beforeend', fresh.map(options.renderMessage).join('')); options.finalize(container); }
      if (data.lastIndex != null) cursors.lastIndex = Math.max(cursors.lastIndex ?? 0, data.lastIndex);
      if (pinned) options.scroll(container); else options.jump(container);
    } catch (error) { if (owns(owner) && sequence === catchupSequence) console.error('fetchNewMessagesSince failed:', error); }
  }
  return { load, loadOlder, ensureMessage, catchup, render, stash, restore, reset, retire, barHtml, maybeOlder(root: HTMLElement | null) { if (root && root.scrollTop <= 200) void loadOlder(); },
    deleteCached: (key: string) => cache.delete(key), retainedRoots: cache.roots, pruneCache: cache.prune,
    get oldestIndex() { return cursors.oldestIndex; }, get lastIndex() { return cursors.lastIndex; }, get hasOlder() { return cursors.hasOlder; }, get total() { return cursors.total; }, get loadingOlder() { return !!older; },
    dispose() { if (disposed) return; retire(); disposed = true; cache.clear(); loaded = null; } };
}
