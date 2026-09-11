import type { ApiRequest, HostEndpoint } from './api-client';
import type { SelectionOwner, SessionState } from './session-state';
import { record } from './helper-values';
export interface SessionSearchMatch { readonly index: number; readonly role: string }
export interface SessionSearchOptions { readonly mode?: 'message' | 'any'; readonly closeIfEmpty?: boolean }
export function decodeSessionSearch(value: unknown): readonly SessionSearchMatch[] {
  if (!record(value) || !Array.isArray(value.matches)) throw new Error('Invalid session search response');
  return value.matches.flatMap((match: unknown) => record(match) && typeof match.index === 'number' && Number.isInteger(match.index) && match.index >= 0
    ? [{ index: match.index, role: typeof match.role === 'string' ? match.role : '' }] : []);
}
export function createSessionSearch(options: {
  document: Document; sessionState: SessionState; request: ApiRequest;
  endpoint: (host: string | null) => HostEndpoint | null; focusMode: () => boolean;
  oldestIndex: () => number | null; hasOlder: () => boolean; loadOlder: () => Promise<unknown>;
  stopFollowing: () => void; updateJumpButton: (container: HTMLElement) => void;
}) {
  const { document, sessionState } = options;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const value = document.getElementById(id); if (!value) throw new Error('Missing search element: ' + id); return value as T;
  };
  let query = '', matches: readonly SessionSearchMatch[] = [], pos = -1;
  let sequence = 0, disposed = false;
  let navigation: { owner: SelectionOwner; done: Promise<void> } | null = null;
  function updateCount(message?: string): void {
    if (disposed) return;
    element('searchCount').textContent = message !== undefined ? message : matches.length ? `${pos + 1}/${matches.length}` : query ? 'no matches' : '';
  }
  function clearMarks(): void {
    document.querySelectorAll('.message.search-current').forEach(el => el.classList.remove('search-current'));
    document.querySelectorAll('mark.search-mark').forEach(mark => {
      const parent = mark.parentNode;
      mark.replaceWith(document.createTextNode(mark.textContent || ''));
      parent?.normalize();
    });
  }
  function open(): void {
    if (disposed || !sessionState.currentSession) return;
    element('searchBar').style.display = '';
    const input = element<HTMLInputElement>('searchInput'); input.focus(); input.select();
  }
  function close(): void {
    if (disposed) return;
    sequence++;
    element('searchBar').style.display = 'none';
    query = ''; matches = []; pos = -1;
    clearMarks(); updateCount();
    // A page load already in progress is shared until it settles. Closing the
    // bar retires the highlight owner without starting a second page request.
  }
  function reset(): void { close(); navigation = null; }
  function toggle(): void { if (element('searchBar').style.display === 'none') open(); else close(); }
  function sameEndpoint(owner: SelectionOwner, endpoint: HostEndpoint): boolean {
    const current = options.endpoint(owner.host);
    return !!current && current.base === endpoint.base && (current.token || '') === (endpoint.token || '');
  }
  async function run(value: string, { mode = 'message', closeIfEmpty = false }: SessionSearchOptions = {}): Promise<void> {
    const owner = sessionState.captureSelection();
    const resolved = owner && options.endpoint(owner.host);
    if (disposed || !owner || !resolved) return;
    const endpoint = Object.freeze({ ...resolved }), seq = ++sequence;
    const owns = () => !disposed && seq === sequence && sessionState.ownsSelection(owner) && sameEndpoint(owner, endpoint);
    updateCount('searching…');
    try {
      const params = new URLSearchParams({ q: value }); if (mode !== 'message') params.set('mode', mode);
      const response = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/search?${params}`);
      const data: unknown = await response.json();
      if (!owns()) return;
      if (!response.ok || (record(data) && typeof data.error === 'string' && data.error)) throw new Error(record(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
      query = value;
      const decoded = decodeSessionSearch(data);
      matches = options.focusMode() ? decoded.filter(match => match.role !== 'toolResult') : decoded;
      pos = matches.length - 1;
      if (matches.length) await jump(); else if (closeIfEmpty) { close(); return; }
      if (owns()) updateCount();
    } catch (error) {
      if (owns()) { updateCount('search failed'); console.error('Session search failed:', error); }
    }
  }
  async function jump(): Promise<void> {
    const owner = sessionState.captureSelection(), match = matches[pos], seq = sequence, tokens = query.split(/\s+/).filter(Boolean);
    const resolved = owner && options.endpoint(owner.host);
    if (disposed || !owner || !match || !resolved) return;
    const endpoint = Object.freeze({ ...resolved });
    const owns = () => !disposed && seq === sequence && sessionState.ownsSelection(owner) && sameEndpoint(owner, endpoint);
    if (navigation) {
      const pending = navigation;
      await pending.done;
      if (owns()) await jump();
      return;
    }
    let finish!: () => void;
    const active = { owner, done: new Promise<void>(resolve => { finish = resolve; }) };
    navigation = active;
    try {
      const container = element('messages');
      let guard = 0;
      while (owns() && options.oldestIndex() !== null && match.index < options.oldestIndex()! && options.hasOlder() && guard++ < 200) await options.loadOlder();
      if (!owns()) return;
      const el = container.querySelector<HTMLElement>(`[data-msg-index="${match.index}"]`);
      if (!el) { updateCount('not loaded'); return; }
      const group = el.closest<HTMLDetailsElement>('details.tool-group'); if (group) group.open = true;
      clearMarks(); el.classList.add('search-current'); markSearchTokens(el, tokens);
      options.stopFollowing(); el.scrollIntoView({ block: 'center' }); options.updateJumpButton(container); updateCount();
    } finally { if (navigation === active) navigation = null; finish(); }
  }
  async function move(delta: number): Promise<void> {
    if (disposed || !matches.length || navigation) return;
    pos = (pos + delta + matches.length) % matches.length;
    updateCount(); await jump();
  }
  function key(event: KeyboardEvent): void {
    if (disposed) return;
    if (event.key === 'Enter') {
      event.preventDefault(); const value = element<HTMLInputElement>('searchInput').value.trim().toLowerCase();
      if (!value) return;
      if (value !== query) void run(value); else void move(event.shiftKey ? 1 : -1);
    } else if (event.key === 'Escape') { event.preventDefault(); close(); }
  }
  const state = Object.freeze({ get query() { return query; }, get matches() { return matches; }, get pos() { return pos; }, get navigating() { return navigation !== null; } });
  return { state, open, close, reset, toggle, run, jump, move, key, clearMarks, updateCount,
    dispose() { reset(); disposed = true; },
  };
}

export function markSearchTokens(el: HTMLElement, tokens: readonly string[]) {
  if (!tokens.length) return;
  const document = el.ownerDocument;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentElement?.closest('mark, script, style')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const text = node.textContent || '';
    const lower = text.toLowerCase();
    const ranges: [number, number][] = [];
    for (const token of tokens) {
      let from = 0, at;
      while ((at = lower.indexOf(token, from)) !== -1) {
        ranges.push([at, at + token.length]);
        from = at + token.length;
      }
    }
    if (!ranges.length) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start < cursor) continue; // overlapping token match
      frag.appendChild(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement('mark');
      mark.className = 'search-mark';
      mark.textContent = text.slice(start, end);
      frag.appendChild(mark);
      cursor = end;
    }
    frag.appendChild(document.createTextNode(text.slice(cursor)));
    node.replaceWith(frag);
  }
}

