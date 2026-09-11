export interface TranscriptCursors { oldestIndex: number | null; lastIndex: number | null; hasOlder: boolean; total: number }
interface Entry extends TranscriptCursors { fragment: DocumentFragment; base: string; scrollTop: number; moodDescription: string; moodFace: string; lastUsed: number }
/** Retain actual nodes so cached transcripts preserve expansion, highlighting and images. */
export function createTranscriptCache(document: Document) {
  const entries = new Map<string, Entry>();
  function prune(skip?: string) {
    const now = Date.now(); for (const [key, entry] of entries) if (key !== skip && now - entry.lastUsed > 15 * 60 * 1000) entries.delete(key);
    while (entries.size > 5) { const oldest = [...entries].filter(([key]) => key !== skip).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]; if (!oldest) break; entries.delete(oldest[0]); }
  }
  function stash(key: string, base: string, cursors: TranscriptCursors, container: HTMLElement) {
    if (cursors.lastIndex == null || container.querySelector('.loading, .error')) return;
    const scrollTop = container.scrollTop, mood = document.getElementById('moodIndicator'), fragment = entries.get(key)?.fragment || document.createDocumentFragment();
    fragment.replaceChildren(); while (container.firstChild) fragment.appendChild(container.firstChild);
    const entry: Entry = { ...cursors, fragment, base, scrollTop, moodDescription: mood?.dataset.moodDescription || '', moodFace: mood?.dataset.moodFace || '', lastUsed: Date.now() };
    const indexed = fragment.querySelectorAll<HTMLElement>('[data-msg-index]');
    if (indexed.length > 300) {
      let keep: Node = indexed[indexed.length - 300]!; while (keep.parentNode && keep.parentNode !== fragment) keep = keep.parentNode;
      while (fragment.firstChild && fragment.firstChild !== keep) fragment.firstChild.remove();
      const first = fragment.querySelector<HTMLElement>('[data-msg-index]'), index = Number.parseInt(first?.dataset.msgIndex || '', 10);
      if (Number.isFinite(index)) { entry.oldestIndex = index; entry.hasOlder = index > 0; }
    }
    entries.set(key, entry); prune(key);
  }
  function restore(key: string, base: string, container: HTMLElement) {
    const entry = entries.get(key); if (!entry) return null;
    if (entry.base !== base || Date.now() - entry.lastUsed > 15 * 60 * 1000) { entries.delete(key); return null; }
    if (!entry.fragment.childNodes.length) return null;
    container.replaceChildren(entry.fragment); container.scrollTop = entry.scrollTop; entry.lastUsed = Date.now(); prune(key); return entry;
  }
  return { stash, restore, prune, delete: (key: string) => entries.delete(key), roots: () => [...entries.values()].map(entry => entry.fragment), clear: () => entries.clear(), get size() { return entries.size; } };
}
