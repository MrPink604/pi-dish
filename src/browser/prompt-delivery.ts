import { record } from './helper-values';
import { escapeHtml } from './helper-format';
import { sessionRefKey } from './helper-identity';
import { splitSessionRefContext } from './helper-refs';
import { extractTextBlocks } from './helper-content';
import { sendJson } from './api-client';
import type { ApiRequest, HostEndpoint } from './api-client';
import type { SelectionOwner, SessionState } from './session-state';
type PromptStatus = 'sending' | 'queued' | 'accepted' | 'cancelling';
interface PendingPrompt { key: string; message: string; element: Element | null; status: PromptStatus }
type QueueKind = 'steering' | 'followUp';
export interface QueueData { readonly steering: readonly string[]; readonly followUp: readonly string[] }
export function decodeQueueData(value: unknown): QueueData {
  const strings = (items: unknown) => Array.isArray(items) ? items.filter((item: unknown): item is string => typeof item === 'string') : [];
  return { steering: strings(record(value) ? value.steering : null), followUp: strings(record(value) ? value.followUp : null) };
}
/** Optimistic echoes and queue cancellation share one ledger, independent of pane selection. */
export function createPromptDelivery(options: {
  document: Document; sessionState: SessionState; request: ApiRequest; endpoint: (host: string | null) => HostEndpoint;
  restore: (key: string, text: string) => void; status: (text: string, type?: string) => void;
}) {
  const { document, sessionState } = options, pending = new Map<string, PendingPrompt>();
  const panel = document.getElementById('queuePanel')!;
  let sequence = 0, generation = 0, disposed = false, events = new AbortController();
  let data: QueueData = decodeQueueData(null);
  type QueueRow = Readonly<{ owner: SelectionOwner; endpoint: Readonly<HostEndpoint>; generation: number; kind: QueueKind; index: number; text: string; clientId: string | null }>;
  const rows = new WeakMap<Element, QueueRow>(), cancelling = new Set<QueueRow>();
  function add(key: string, message: string, element: Element | null, id = nextId()) { if (!disposed) pending.set(id, { key, message, element, status: 'sending' }); return id; }
  function nextId() { return `prompt-${Date.now().toString(36)}-${(++sequence).toString(36)}`; }
  function acknowledge(id: string, queued: boolean) { const entry = pending.get(id); if (entry && entry.status === 'sending') entry.status = queued ? 'queued' : 'accepted'; }
  function discard(id: string) { const entry = pending.get(id); if (!entry) return; pending.delete(id); entry.element?.remove(); }
  function consume(key: string, content: unknown) {
    const text = splitSessionRefContext(extractTextBlocks(content)).text;
    for (const [id, entry] of pending) { if (entry.key === key && entry.message === text) { pending.delete(id); return true; } }
    return false;
  }
  function canCancelQueue() { const caps = sessionState.currentSession?.capabilities; return !record(caps) || caps.queueCancel !== false; }
  function owns(row: QueueRow) { return !disposed && row.generation === generation && sessionState.ownsSelection(row.owner) && options.endpoint(row.owner.host).base === row.endpoint.base; }
  function render(value: unknown) {
    if (disposed) return; data = decodeQueueData(value); generation++; events.abort(); events = new AbortController();
    panel.innerHTML = ''; panel.style.display = 'none'; const owner = sessionState.captureSelection(); if (!owner) return;
    const endpoint = Object.freeze({ ...options.endpoint(owner.host) }), key = sessionRefKey(owner), associated = new Set<string>();
    const canCancel = canCancelQueue();
    for (const kind of ['steering', 'followUp'] as const) data[kind].forEach((text, index) => {
      const stripped = splitSessionRefContext(text).text; let clientId: string | null = null;
      for (const [id, entry] of pending) {
        if (!associated.has(id) && entry.key === key && entry.status === 'queued' && entry.message === stripped) { clientId = id; associated.add(id); break; }
      }
      const element = document.createElement('div'); element.className = 'queue-item'; element.dataset.kind = kind; element.dataset.index = String(index);
      if (clientId) element.dataset.clientPromptId = clientId;
      element.innerHTML = `<span class="queue-item-kind">${kind === 'steering' ? 'steer' : 'follow-up'}</span><span class="queue-item-text" title="Click to expand">${escapeHtml(stripped)}</span>${canCancel ? '<button class="queue-item-edit" title="Remove from queue and edit">↩ Edit</button>' : ''}`;
      const row: QueueRow = Object.freeze({ owner, endpoint, generation, kind, index, text, clientId }); rows.set(element, row);
      const label = element.querySelector('.queue-item-text')!;
      label.addEventListener('click', () => { if (owns(row)) label.classList.toggle('expanded'); }, { signal: events.signal });
      const button = element.querySelector<HTMLButtonElement>('.queue-item-edit');
      button?.addEventListener('click', () => { void edit(button); }, { signal: events.signal }); panel.append(element);
    });
    if (panel.childElementCount) panel.style.display = '';
  }
  async function edit(button: Element) {
    const element = button.closest('.queue-item'), row = element && rows.get(element);
    if (!row || !owns(row) || !panel.contains(button) || cancelling.has(row) || !row.text || !canCancelQueue()) return;
    cancelling.add(row); const prompt = row.clientId ? pending.get(row.clientId) : undefined, previous = prompt?.status;
    if (prompt) prompt.status = 'cancelling'; if (button instanceof HTMLButtonElement) button.disabled = true;
    try {
      await sendJson(options.request, Object.freeze({ ...options.endpoint(row.owner.host) }), `/api/sessions/${encodeURIComponent(row.owner.id)}/queue/cancel`, { kind: row.kind, index: row.index, text: row.text });
      if (disposed) return; if (row.clientId) discard(row.clientId); options.restore(sessionRefKey(row.owner), splitSessionRefContext(row.text).text);
    } catch (error) {
      if (disposed) return;
      if (prompt && row.clientId && pending.get(row.clientId) === prompt && previous) prompt.status = previous;
      if (sessionState.ownsSelection(row.owner) && options.endpoint(row.owner.host).base === row.endpoint.base) { render(data); options.status(error instanceof Error ? error.message : String(error), 'error'); }
    } finally { cancelling.delete(row); if (owns(row) && button instanceof HTMLButtonElement) button.disabled = false; }
  }
  function dispose() { if (disposed) return; disposed = true; generation++; events.abort(); pending.clear(); cancelling.clear(); }
  return { add, nextId, acknowledge, discard, consume, render, edit, dispose, has: (id: string) => pending.has(id), get queue(): QueueData { return data; } };
}
