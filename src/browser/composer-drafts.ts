import type { ComposerImage } from './composer-images';
import { createComposerImages } from './composer-images';
import { pushPromptHistory } from './helper-format';
export function mergeComposerText(existing: string, restored: string) { const current = existing.trim(); return !current || current === restored ? restored : `${existing}\n\n${restored}`; }
const HISTORY_PREFIX = 'pi-dish-history-', HISTORY_LIMIT = 50;
/** The composer owner named by a sent-prompt storage key, or null for any other key. */
export function promptHistoryOwner(storageKey: string | null) { return storageKey && storageKey.length > HISTORY_PREFIX.length && storageKey.startsWith(HISTORY_PREFIX) ? storageKey.slice(HISTORY_PREFIX.length) : null; }
export function decodePromptHistory(raw: string | null): string[] {
  try { const value: unknown = JSON.parse(raw || '[]'); return Array.isArray(value) ? value.filter((value: unknown): value is string => typeof value === 'string').slice(-HISTORY_LIMIT) : []; } catch { return []; }
}
/** Every non-empty sent-prompt history stored on this device, prompts oldest first. */
export function storedPromptHistories(storage: Pick<Storage, 'length' | 'key' | 'getItem'>) {
  const rows: { owner: string; prompts: string[] }[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const owner = promptHistoryOwner(storage.key(i)); if (!owner) continue;
      const prompts = decodePromptHistory(storage.getItem(HISTORY_PREFIX + owner)); if (prompts.length) rows.push({ owner, prompts });
    }
  } catch {}
  return rows;
}
export function createComposerDrafts(options: {
  document: Document; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; keyForSession: (id: string) => string;
  currentSessionId: () => string | null; autosize: (input: HTMLTextAreaElement) => void; status: (text: string, type?: string) => void;
  /** The visible owner or its sent prompts changed. */
  historyChanged?: () => void;
}) {
  const { document, storage } = options;
  let key: string | null = null, dirty = false, history: string[] = [], historyIndex = -1, historyStash = '', timer: ReturnType<typeof setTimeout> | null = null, generation = 0, disposed = false;
  const images = createComposerImages({ document, owner: () => key, status: options.status });
  const input = () => document.getElementById('promptInput') as HTMLTextAreaElement;
  function ownerKey(id: string) { return id.startsWith('spawn:') || id.includes(' ') ? id : options.keyForSession(id); }
  function draftKey(id: string) { return 'pi-dish-draft-' + ownerKey(id); }
  function historyKey(id: string) { return HISTORY_PREFIX + ownerKey(id); }
  function read(name: string) { try { return storage.getItem(name) || ''; } catch { return ''; } }
  function readHistory(id: string): string[] { return decodePromptHistory(read(historyKey(id))); }
  function changed() { if (!disposed) options.historyChanged?.(); }
  function cancelTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function write(id: string | null | undefined, value: string) { if (disposed || !id) return; try { if (value.trim() && value.length < 50000) storage.setItem(draftKey(id), value); else storage.removeItem(draftKey(id)); } catch {} }
  function stash() {
    cancelTimer(); generation++; if (!key) return;
    if (dirty) write(key, input().value); key = null; dirty = false; images.render(); changed();
  }
  function clear() { cancelTimer(); generation++; if (key) images.discard(key); key = null; dirty = false; input().value = ''; input().style.height = ''; images.render(); changed(); }
  function waiting(value: boolean) {
    input().placeholder = value ? 'Write your prompt while Pi starts…' : 'Send a message...'; const button = document.getElementById('btnSend') as HTMLButtonElement | null;
    if (button) { button.disabled = value; button.title = value ? 'Your draft will be preserved until Pi connects' : 'Send'; }
  }
  function saveSoon() {
    if (disposed) return; cancelTimer(); const owner = key, version = generation; dirty = true;
    timer = setTimeout(() => { timer = null; if (disposed || !owner || key !== owner || generation !== version) return; write(owner, input().value); dirty = false; }, 300);
  }
  function clearDraft(id: string | null = key) {
    if (disposed || !id) return; const owner = ownerKey(id);
    if (key === owner) { cancelTimer(); dirty = false; }
    try { storage.removeItem(draftKey(owner)); } catch {}
  }
  function restore(id: string | null = options.currentSessionId()) {
    if (disposed || !id) return; const owner = ownerKey(id);
    if (key && dirty) write(key, input().value); cancelTimer(); key = owner; dirty = false; generation++;
    input().value = read(draftKey(owner)); images.render(); options.autosize(input()); historyIndex = -1; historyStash = ''; history = readHistory(owner); changed();
  }
  function record(message: string, id: string | null = key) {
    if (disposed || !id) return; const owner = ownerKey(id), next = pushPromptHistory(key === owner ? history : readHistory(owner), message, HISTORY_LIMIT);
    if (key === owner) { history = next; historyIndex = -1; }
    try { storage.setItem(historyKey(owner), JSON.stringify(next)); } catch {}
    changed();
  }
  /** Sent prompts of one owner, oldest first; the visible owner reads its live list. */
  function prompts(id: string | null = key) { if (disposed || !id) return []; const owner = ownerKey(id); return key === owner ? [...history] : readHistory(owner); }
  function clearHistory(id: string) {
    if (disposed || !id) return; const owner = ownerKey(id);
    if (key === owner) { history = []; historyIndex = -1; historyStash = ''; }
    try { storage.removeItem(historyKey(owner)); } catch {}
    changed();
  }
  function migrate(from: string, to: string) {
    if (disposed) return; from = ownerKey(from); to = ownerKey(to); if (from === to) return;
    if (key === from && dirty) { cancelTimer(); write(from, input().value); dirty = false; }
    const source = read(draftKey(from)), destination = read(draftKey(to)); try { storage.removeItem(draftKey(from)); } catch {}
    if (source) {
      const merged = mergeComposerText(key === to ? input().value : destination, source); write(to, merged);
      if (key === to) { input().value = merged; dirty = false; options.autosize(input()); }
    }
    images.migrate(from, to);
  }
  function restorePayload(id: string, message: string, attachments: readonly ComposerImage[] | null) {
    if (disposed || !id) return; const owner = ownerKey(id), saved = read(draftKey(owner)); write(owner, message ? mergeComposerText(saved, message) : saved);
    if (attachments?.length) images.append(owner, attachments);
    if (key === owner && message) { input().value = mergeComposerText(input().value, message); input().dispatchEvent(new Event('input', { bubbles: true })); input().focus(); }
  }
  function navigate(direction: number, target: HTMLTextAreaElement = input()) {
    if (disposed || !key || !history.length || target !== input()) return false;
    if (direction < 0) { if (historyIndex === -1) { historyStash = target.value; historyIndex = history.length - 1; } else if (historyIndex > 0) historyIndex--; else return true; }
    else { historyIndex++; if (historyIndex >= history.length) historyIndex = -1; }
    const value = historyIndex === -1 ? historyStash : history[historyIndex]!; target.value = value; target.setSelectionRange(value.length, value.length); options.autosize(target); return true;
  }
  return { images, ownerKey, draftKey, historyKey, write, stash, clear, waiting, saveSoon, clearDraft, restore, record, prompts, clearHistory, migrate, restorePayload, navigate,
    exitHistory() { historyIndex = -1; }, get key() { return key; }, get historyIndex() { return historyIndex; },
    dispose() { stash(); disposed = true; images.dispose(); },
  };
}
