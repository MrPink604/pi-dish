export interface TranscriptCursors { oldestIndex: number | null; lastIndex: number | null; hasOlder: boolean; total: number }
interface Entry extends TranscriptCursors { fragment: DocumentFragment; base: string; scrollTop: number; anchor: number | null; anchorOffset: number; moodDescription: string; moodFace: string; lastUsed: number; nodes: number; characters: number }
/**
 * Cache budgets stay deliberately conservative so one tool-heavy transcript
 * cannot pin megabytes: five sessions, fifteen minutes, plus an indexed,
 * element-node and character ceiling per entry and across the cache. Trimming
 * drops the oldest messages, which is exactly the region paging reloads, so a
 * smaller cache never makes content unreachable — and an entry that cannot fit
 * even after that trim is refused outright rather than cached misleadingly.
 */
const MAX_ENTRIES = 5, MAX_AGE = 15 * 60 * 1000, MAX_INDEXED = 300,
  MAX_ENTRY_NODES = 2000, MAX_ENTRY_CHARACTERS = 1_000_000,
  MAX_TOTAL_NODES = 8000, MAX_TOTAL_CHARACTERS = 4_000_000;
/** Attribute values are real payload the DOM holds — inline image data URLs, math and diagram source — yet textContent never sees them. */
function childCost(child: Element) {
  let characters = (child.textContent || '').length;
  const descendants = child.querySelectorAll('*');
  for (const attribute of child.attributes) characters += attribute.value.length;
  for (const element of descendants) for (const attribute of element.attributes) characters += attribute.value.length;
  return { nodes: descendants.length + 1, characters,
    indexed: child.querySelectorAll('[data-msg-index]').length + (child.matches('[data-msg-index]') ? 1 : 0) };
}
/**
 * Plan the leading messages to drop so the surviving entry fits its
 * indexed/node/character budgets. The plan is computed before anything is
 * removed so the caller can refuse the entry when even the last message alone
 * exceeds a budget, or when the drop would discard the reader's anchor.
 */
function planTrim(fragment: DocumentFragment) {
  const children = Array.from(fragment.children), costs = children.map(childCost);
  let nodes = 0, characters = 0, indexed = 0;
  for (const cost of costs) { nodes += cost.nodes; characters += cost.characters; indexed += cost.indexed; }
  let drop = 0;
  while (drop < children.length - 1 && (indexed > MAX_INDEXED || nodes > MAX_ENTRY_NODES || characters > MAX_ENTRY_CHARACTERS)) {
    const cost = costs[drop]!; indexed -= cost.indexed; nodes -= cost.nodes; characters -= cost.characters; drop++;
  }
  return { drop, nodes, characters, indexed };
}
/** Retain actual nodes so cached transcripts preserve expansion, highlighting and images. */
export function createTranscriptCache(document: Document) {
  const entries = new Map<string, Entry>();
  function prune(skip?: string) {
    const now = Date.now(); for (const [key, entry] of entries) if (key !== skip && now - entry.lastUsed > MAX_AGE) entries.delete(key);
    while (entries.size > MAX_ENTRIES) { const oldest = [...entries].filter(([key]) => key !== skip).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]; if (!oldest) break; entries.delete(oldest[0]); }
    for (;;) {
      let nodes = 0, characters = 0, victim: string | null = null, oldest = Infinity;
      for (const [key, entry] of entries) {
        nodes += entry.nodes; characters += entry.characters;
        if (key !== skip && entry.lastUsed < oldest) { oldest = entry.lastUsed; victim = key; }
      }
      if ((nodes <= MAX_TOTAL_NODES && characters <= MAX_TOTAL_CHARACTERS) || victim == null) break;
      entries.delete(victim);
    }
  }
  function stash(key: string, base: string, cursors: TranscriptCursors, container: HTMLElement) {
    if (cursors.lastIndex == null || container.querySelector('.loading, .error')) return;
    const scrollTop = container.scrollTop, viewportTop = container.getBoundingClientRect().top;
    const anchor = Array.from(container.querySelectorAll<HTMLElement>('[data-msg-index]')).find(node => node.getBoundingClientRect().bottom > viewportTop) || null;
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - viewportTop : 0;
    const mood = document.getElementById('moodIndicator'), fragment = entries.get(key)?.fragment || document.createDocumentFragment();
    fragment.replaceChildren(); while (container.firstChild) fragment.appendChild(container.firstChild);
    const children = Array.from(fragment.children), plan = planTrim(fragment);
    const anchorIndex = anchor ? children.findIndex(child => child.contains(anchor)) : -1;
    const overBudget = plan.indexed > MAX_INDEXED || plan.nodes > MAX_ENTRY_NODES || plan.characters > MAX_ENTRY_CHARACTERS;
    // A single huge message, or a reader anchor trimming would discard, is not
    // worth a misleading entry: reloading from JSONL restores the real thing.
    if (!children.length || overBudget || (plan.drop > 0 && anchor && plan.drop > anchorIndex)) {
      entries.delete(key); container.replaceChildren(fragment); return;
    }
    for (const child of children.slice(0, plan.drop)) child.remove();
    const entry: Entry = { ...cursors, fragment, base, lastUsed: Date.now(), nodes: plan.nodes, characters: plan.characters,
      scrollTop, anchor: anchor ? Number(anchor.dataset.msgIndex) : null, anchorOffset,
      moodDescription: mood?.dataset.moodDescription || '', moodFace: mood?.dataset.moodFace || '' };
    const first = fragment.querySelector<HTMLElement>('[data-msg-index]'), index = Number.parseInt(first?.dataset.msgIndex || '', 10);
    if (Number.isFinite(index)) { entry.oldestIndex = index; entry.hasOlder = index > 0; }
    entries.set(key, entry); prune(key);
  }
  function restore(key: string, base: string, container: HTMLElement) {
    const entry = entries.get(key); if (!entry) return null;
    if (entry.base !== base || Date.now() - entry.lastUsed > MAX_AGE) { entries.delete(key); return null; }
    if (!entry.fragment.childNodes.length) return null;
    container.replaceChildren(entry.fragment); container.scrollTop = entry.scrollTop; entry.lastUsed = Date.now();
    // Restore the actual reader anchor, not a sum of element heights: margins,
    // gaps and collapsed tool groups all affect its visual offset.
    const anchor = entry.anchor == null ? null : container.querySelector<HTMLElement>(`[data-msg-index="${entry.anchor}"]`);
    if (anchor) container.scrollTop += anchor.getBoundingClientRect().top - container.getBoundingClientRect().top - entry.anchorOffset;
    // The nodes now live in the active DOM, not the cache: stop charging them
    // against the cache-wide budgets until this session is stashed again.
    entry.nodes = 0; entry.characters = 0; prune(key); return entry;
  }
  return { stash, restore, prune, delete: (key: string) => entries.delete(key), roots: () => [...entries.values()].map(entry => entry.fragment), clear: () => entries.clear(), get size() { return entries.size; } };
}
