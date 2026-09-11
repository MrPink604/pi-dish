import type { ApiRequest, HostEndpoint, RequestOptions } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { createFileViews } from './file-views';
import type { AnchoredComment, CommentDraft, CommentAnchor } from './anchored-comment-data';
import { decodeAnchoredComments, decodeCommentIndex } from './anchored-comment-data';
import { selectionTextAnchor, clearCommentMarks, markCommentQuote } from './comment-anchors';
import { escapeHtml } from './helper-format';
import { record } from './helper-values';
export function createAnchoredComments(options: {
  document: Document; sessionState: SessionState; views: ReturnType<typeof createFileViews>; request: ApiRequest;
  host: (id: string | null) => HostEndpoint | null; status: (message: string, type?: string) => void;
  loadPatch: (details: HTMLDetailsElement) => Promise<unknown>;
}) {
  const { document, sessionState, views } = options, window = document.defaultView!;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => { const value = document.getElementById(id); if (!value) throw new Error('Missing comment element: ' + id); return value as T; };
  interface ViewOwner { kind: 'file' | 'diff'; owner: SelectionOwner; endpoint: Readonly<HostEndpoint>; id: string; generation: number; path: string | null }
  interface Bubble { view: ViewOwner; draft: CommentDraft | null; editing: AnchoredComment | null; range: Range; busy: boolean }
  let disposed = false, mounted = false, refreshSequence = 0, focusSequence = 0;
  let bubble: Bubble | null = null, comments: readonly AnchoredComment[] = [], listOwner: ViewOwner | null = null;
  let deleteArmed = false, deleteTimer: ReturnType<typeof setTimeout> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const lifetime = new AbortController(); let bubbleEvents = new AbortController(), listEvents = new AbortController();
  let observer: ResizeObserver | null = null;
  const marks = new WeakMap<Element, { view: ViewOwner; comment: AnchoredComment }>();
  function later(callback: () => void, ms = 0) { const timer = setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, ms); timers.add(timer); return timer; }
  function cancelTimer(timer: ReturnType<typeof setTimeout> | null) { if (timer !== null) { clearTimeout(timer); timers.delete(timer); } }
  function capture(): ViewOwner | null {
    if (disposed) return null;
    const kind = views.isFileOpen() ? 'file' : views.isDiffOpen() ? 'diff' : null; if (!kind) return null;
    const view = kind === 'file' ? views.file : views.diff;
    if (!view.owner || !view.endpoint || !view.sessionId) return null;
    const captured: ViewOwner = { kind, owner: view.owner, endpoint: view.endpoint, id: view.sessionId, generation: view.generation, path: kind === 'file' ? views.file.path : null };
    return owns(captured) ? captured : null;
  }
  function owns(view: ViewOwner | null): view is ViewOwner {
    return !!view && !disposed && (view.kind === 'file'
      ? views.ownsFile(view.id, view.generation) && views.file.path === view.path
      : views.ownsDiff(view.id, view.generation));
  }
  function belongs(comment: AnchoredComment, view: ViewOwner) { return comment.sessionId === view.id && (view.kind === 'file' ? comment.target.kind === 'file' && comment.target.path === view.path : comment.target.kind === 'diff'); }
  function ownsBubble(entry: Bubble | null): entry is Bubble { return !!entry && bubble === entry && owns(entry.view) && isOpen(); }
  function isOpen() { return !disposed && element('commentBubble').style.display !== 'none'; }
  function isListOpen() { return !disposed && element('commentListPopover').style.display !== 'none'; }
  async function request(view: ViewOwner, path: string, init?: RequestOptions): Promise<unknown> {
    const endpoint = options.host(view.owner.host);
    if (!owns(view) || !endpoint || endpoint.base !== view.endpoint.base) throw new Error('Comment view changed');
    const response = await options.request({ ...view.endpoint, token: endpoint.token }, path, init);
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
    return data;
  }
  function position() {
    const entry = bubble; if (!ownsBubble(entry)) return;
    const el = element('commentBubble'); let rect: DOMRect;
    try { rect = entry.range.getBoundingClientRect(); } catch { return; }
    const viewport = window.visualViewport, left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight, margin = 8, gap = 8;
    el.style.maxWidth = `${Math.max(0, width - 2 * margin)}px`; el.style.maxHeight = `${Math.max(0, height - 2 * margin)}px`;
    el.style.left = `${Math.max(left + margin, Math.min(left + width - el.offsetWidth - margin, rect.left + (rect.width - el.offsetWidth) / 2))}px`;
    const below = rect.bottom + gap, preferred = below + el.offsetHeight <= top + height - margin ? below : rect.top - el.offsetHeight - gap;
    el.style.top = `${Math.max(top + margin, Math.min(top + height - el.offsetHeight - margin, preferred))}px`;
  }
  function disarmDelete() {
    cancelTimer(deleteTimer); deleteTimer = null; deleteArmed = false;
    const button = element('commentDeleteBtn'); button.textContent = 'Delete'; button.classList.remove('armed');
  }
  function close() {
    bubbleEvents.abort(); bubble = null; focusSequence++;
    element('commentBubble').style.display = 'none'; element('commentStatus').textContent = ''; element('commentDeleteBtn').style.display = 'none'; disarmDelete();
    for (const timer of timers) clearTimeout(timer); timers.clear();
  }
  function bindBubble(entry: Bubble, focus: boolean) {
    bubbleEvents.abort(); bubbleEvents = new AbortController(); bubble = entry; disarmDelete();
    const { draft, editing } = entry;
    element('commentBubbleTitle').textContent = editing ? 'Edit comment' : 'Comment for agent';
    element('commentAnchorPreview').textContent = editing?.target.anchor.quote || draft?.quote || '';
    element<HTMLTextAreaElement>('commentBody').value = editing?.body || '';
    element('commentStatus').textContent = '';
    const send = element<HTMLButtonElement>('commentSendBtn'), remove = element<HTMLButtonElement>('commentDeleteBtn');
    send.disabled = false; remove.disabled = false; remove.style.display = editing ? '' : 'none';
    element('commentBubble').style.display = 'block'; position();
    const signal = bubbleEvents.signal;
    send.addEventListener('click', () => { if (ownsBubble(entry)) void submit(); }, { signal });
    remove.addEventListener('click', () => { if (ownsBubble(entry)) void removeComment(); }, { signal });
    element('commentBody').addEventListener('keydown', event => { if (ownsBubble(entry)) key(event); }, { signal });
    element('commentBubble').querySelectorAll<HTMLElement>('[data-comment-close]').forEach(button => button.addEventListener('click', () => { if (ownsBubble(entry)) close(); }, { signal }));
    if (focus) { element('commentBody').focus(); later(() => { if (ownsBubble(entry)) position(); }); }
  }
  function openDraft(draft: CommentDraft, range: Range, focus = false) {
    const view = capture(); if (!view || draft.sessionId !== view.id || draft.target.kind !== view.kind || (draft.target.kind === 'file' && draft.target.path !== view.path)) return;
    bindBubble({ view, draft, editing: null, range: range.cloneRange(), busy: false }, focus);
  }
  function openEditor(comment: AnchoredComment, anchor: HTMLElement) {
    const view = capture();
    if (!view || !owns(listOwner) || !comments.includes(comment) || !belongs(comment, view) || !anchor.isConnected) return;
    const range = document.createRange(); range.selectNodeContents(anchor);
    bindBubble({ view, draft: null, editing: comment, range, busy: false }, true);
  }
  function captureFile(focus = false) {
    if (isOpen()) return;
    const view = capture(), raw = views.file.raw, path = views.file.path;
    if (!view || view.kind !== 'file' || !path || raw === null) return;
    const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const root = element('fileViewBody'), range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const text = range.toString(); if (!text.trim() || text.length > 12000) return;
    const base = selectionTextAnchor(root, range), first = raw.indexOf(base.quote);
    const startLine = first >= 0 && raw.indexOf(base.quote, first + 1) < 0 ? raw.slice(0, first).split('\n').length : null;
    const anchor: CommentAnchor = startLine === null ? base : { ...base, startLine, endLine: startLine + base.quote.split('\n').length - 1 };
    openDraft({ sessionId: view.id, quote: anchor.quote, target: { kind: 'file', path, relPath: views.file.relPath, anchor } }, range, focus);
  }
  function captureDiff(focus = false) {
    if (isOpen()) return;
    const view = capture(); if (!view || view.kind !== 'diff') return;
    const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0), node = range.commonAncestorContainer;
    const patch = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.diff-patch');
    if (!patch || !element('diffViewBody').contains(patch)) return;
    const lines = [...patch.querySelectorAll<HTMLElement>('.diff-line[data-diff-line="1"]:not(.diff-hunk)')].filter(line => { try { return range.intersectsNode(line); } catch { return false; } });
    if (!lines.length) return;
    const nums = (key: string) => lines.map(line => Number(line.dataset[key])).filter(n => Number.isInteger(n) && n > 0);
    const oldNums = nums('oldLine'), newNums = nums('newLine'), quote = lines.map(line => line.textContent).join('\n').slice(0, 12000);
    openDraft({ sessionId: view.id, quote, target: { kind: 'diff', repo: patch.dataset.repo || '', path: patch.dataset.path || '', oldPath: patch.dataset.oldPath || null,
      anchor: { type: 'lines', quote, ...(oldNums.length ? { oldStart: Math.min(...oldNums), oldEnd: Math.max(...oldNums) } : {}), ...(newNums.length ? { newStart: Math.min(...newNums), newEnd: Math.max(...newNums) } : {}) } } }, range, focus);
  }
  function key(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit(); } }
  async function submit() {
    const entry = bubble; if (!ownsBubble(entry) || entry.busy) return;
    const body = element<HTMLTextAreaElement>('commentBody').value.trim(); if (!body) { element('commentBody').focus(); return; }
    const { editing, draft, view } = entry; if (!editing && !draft) return;
    entry.busy = true; element<HTMLButtonElement>('commentSendBtn').disabled = true; element<HTMLButtonElement>('commentDeleteBtn').disabled = true;
    element('commentStatus').textContent = 'Saving…';
    try {
      await request(view, editing ? `/api/comments/${encodeURIComponent(editing.id)}` : '/api/comments', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing ? { sessionId: editing.sessionId, body } : { sessionId: draft!.sessionId, body, target: draft!.target }) });
      if (!owns(view)) return;
      if (ownsBubble(entry)) { close(); window.getSelection()?.removeAllRanges(); }
      options.status(editing ? 'Comment updated' : 'Comment saved'); void refresh();
    } catch (error) { if (ownsBubble(entry)) element('commentStatus').textContent = error instanceof Error ? error.message : String(error); }
    finally { entry.busy = false; if (ownsBubble(entry)) { element<HTMLButtonElement>('commentSendBtn').disabled = false; element<HTMLButtonElement>('commentDeleteBtn').disabled = false; } }
  }
  async function removeComment() {
    const entry = bubble; if (!ownsBubble(entry) || entry.busy || !entry.editing) return;
    const button = element<HTMLButtonElement>('commentDeleteBtn');
    if (!deleteArmed) { deleteArmed = true; button.textContent = 'Delete?'; button.classList.add('armed'); deleteTimer = later(() => { if (ownsBubble(entry)) disarmDelete(); }, 3000); return; }
    const { editing, view } = entry; entry.busy = true; button.disabled = true; element<HTMLButtonElement>('commentSendBtn').disabled = true; element('commentStatus').textContent = 'Deleting…';
    try {
      await request(view, `/api/comments/${encodeURIComponent(editing.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: editing.sessionId }) });
      if (!owns(view)) return;
      if (ownsBubble(entry)) close(); options.status('Comment deleted'); void refresh();
    } catch (error) { if (ownsBubble(entry)) { element('commentStatus').textContent = error instanceof Error ? error.message : String(error); disarmDelete(); } }
    finally { entry.busy = false; if (ownsBubble(entry)) { button.disabled = false; element<HTMLButtonElement>('commentSendBtn').disabled = false; } }
  }
  function set(value: unknown) {
    refreshSequence++; listOwner = capture(); comments = listOwner ? decodeAnchoredComments(value).filter(comment => belongs(comment, listOwner!)) : [];
    applyMarks(); renderChips();
  }
  async function refresh() {
    const view = capture(), sequence = ++refreshSequence;
    if (!view || (view.kind === 'file' && !view.path)) { set([]); return; }
    const current = () => owns(view) && refreshSequence === sequence;
    try {
      const index = decodeCommentIndex(await request(view, `/api/comments/index?sessionId=${encodeURIComponent(view.id)}`));
      if (!current()) return;
      const ids = index.filter(entry => view.kind === 'file' ? entry.target.kind === 'file' && entry.target.path === view.path : entry.target.kind === 'diff').map(entry => entry.id);
      if (!ids.length) { set([]); return; }
      const full = await request(view, '/api/comments/get', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: view.id, ids }) });
      if (!current()) return;
      set(record(full) ? full.comments : []);
    } catch { /* Comments enrich a view; failures leave the current marks alone. */ }
  }
  function diffPatch(comment: AnchoredComment) {
    const target = comment.target;
    return target.kind === 'diff' ? [...element('diffViewBody').querySelectorAll<HTMLElement>('.diff-patch')].find(patch => patch.dataset.repo === target.repo && patch.dataset.path === target.path) || null : null;
  }
  function applyMarks() {
    if (disposed) return;
    const current = owns(listOwner);
    if (views.isFileOpen()) {
      const root = element('fileViewBody'); clearCommentMarks(root);
      if (current) for (const comment of comments) if (comment.target.kind === 'file') {
        markCommentQuote(root, comment.target.anchor, comment.id);
        for (const mark of root.querySelectorAll<HTMLElement>('mark.comment-mark')) if (mark.dataset.commentId === comment.id) marks.set(mark, { view: listOwner!, comment });
      }
    } else if (views.isDiffOpen()) {
      for (const line of element('diffViewBody').querySelectorAll<HTMLElement>('.diff-line.comment-line')) { line.classList.remove('comment-line'); delete line.dataset.commentId; }
      if (current) for (const comment of comments) {
        if (comment.target.kind !== 'diff') continue;
        const patch = diffPatch(comment); if (!patch) continue;
        const anchor = comment.target.anchor;
        const inRange = (value: string | undefined, from: number | undefined, to: number | undefined) => !!value && from !== undefined && to !== undefined && Number.isInteger(Number(value)) && Number(value) >= from && Number(value) <= to;
        for (const line of patch.querySelectorAll<HTMLElement>('.diff-line')) {
          const hit = inRange(line.dataset.newLine, anchor.newStart, anchor.newEnd) || (anchor.newStart === undefined && inRange(line.dataset.oldLine, anchor.oldStart, anchor.oldEnd));
          if (hit) { line.classList.add('comment-line'); line.dataset.commentId = comment.id; marks.set(line, { view: listOwner!, comment }); }
        }
      }
    }
  }
  function renderChips() {
    const active = owns(listOwner) ? listOwner.kind === 'file' ? 'fileViewComments' : 'diffViewComments' : null;
    for (const id of ['fileViewComments', 'diffViewComments']) { const chip = element(id); chip.style.display = id === active && comments.length ? '' : 'none'; chip.textContent = `💬 ${comments.length}`; }
    if (!comments.length || !active) closeList(); else if (isListOpen()) renderList();
  }
  function closeList() { listEvents.abort(); const popover = element('commentListPopover'); popover.style.display = 'none'; popover.innerHTML = ''; }
  function renderList() {
    listEvents.abort(); listEvents = new AbortController(); const events = listEvents, view = listOwner;
    const popover = element('commentListPopover'); popover.innerHTML = comments.map(comment => {
      const quote = comment.target.anchor.quote.replace(/\s+/g, ' ').trim();
      return `<button type="button" class="comment-list-row" data-comment-id="${escapeHtml(comment.id)}"><span class="comment-list-body">${escapeHtml(comment.body.slice(0, 160))}</span>${quote ? `<span class="comment-list-quote">${escapeHtml(quote.slice(0, 90))}</span>` : ''}</button>`;
    }).join('');
    for (const row of popover.querySelectorAll<HTMLElement>('.comment-list-row')) row.addEventListener('click', () => { if (!events.signal.aborted && owns(view) && isListOpen()) void focus(row.dataset.commentId || ''); }, { signal: events.signal });
  }
  function toggleList(chip: HTMLElement) {
    if (isListOpen()) { closeList(); return; }
    if (!owns(listOwner) || !comments.length || !chip.isConnected) return;
    renderList(); const popover = element('commentListPopover'); popover.style.display = 'block'; const rect = chip.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, rect.left))}px`; popover.style.top = `${rect.bottom + 6}px`;
  }
  async function focus(id: string) {
    const view = listOwner, comment = comments.find(entry => entry.id === id); if (!owns(view) || !comment) return;
    const sequence = ++focusSequence; const current = () => owns(view) && comments.includes(comment) && focusSequence === sequence;
    closeList();
    if (comment.target.kind === 'diff') {
      const details = diffPatch(comment)?.closest<HTMLDetailsElement>('details.diff-file');
      if (details && !details.open) { details.open = true; await options.loadPatch(details); if (!current()) return; applyMarks(); }
    }
    if (!current()) return;
    const root = element(view.kind === 'file' ? 'fileViewBody' : 'diffViewBody');
    const mark = [...root.querySelectorAll<HTMLElement>('[data-comment-id]')].find(el => el.dataset.commentId === id);
    mark?.scrollIntoView({ block: 'center' }); openEditor(comment, mark || element(view.kind === 'file' ? 'fileViewComments' : 'diffViewComments'));
  }
  function mount() {
    if (disposed || mounted) return; mounted = true; const signal = lifetime.signal;
    const queueSelection = (kind: 'file' | 'diff', focusComposer = false) => { const view = capture(); if (!view || view.kind !== kind) return; later(() => { if (owns(view)) { if (kind === 'file') captureFile(focusComposer); else captureDiff(focusComposer); } }); };
    for (const kind of ['file', 'diff'] as const) {
      const body = element(kind + 'ViewBody'); body.addEventListener('pointerup', () => queueSelection(kind), { signal }); body.addEventListener('scroll', position, { signal });
      const chip = element(kind + 'ViewComments'); chip.addEventListener('click', () => toggleList(chip), { signal });
    }
    document.addEventListener('keyup', event => { if (event.shiftKey) { if (views.isFileOpen()) queueSelection('file', true); else if (views.isDiffOpen()) queueSelection('diff', true); } }, { signal });
    document.addEventListener('click', event => {
      const target = event.target; if (!(target instanceof Element)) return;
      const marked = target.closest<HTMLElement>('mark.comment-mark, .diff-line.comment-line');
      const entry = marked ? marks.get(marked) : null;
      if (marked && entry && marked.isConnected && owns(entry.view) && comments.includes(entry.comment) && window.getSelection()?.isCollapsed !== false) { openEditor(entry.comment, marked); return; }
      if (isListOpen() && !target.closest('.view-comment-chip, .comment-list-popover')) closeList();
    }, { signal });
    const reposition = () => { position(); closeList(); };
    window.addEventListener('resize', reposition, { signal }); window.visualViewport?.addEventListener('resize', reposition, { signal }); window.visualViewport?.addEventListener('scroll', reposition, { signal });
    if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(reposition); observer.observe(element('commentBubble')); }
  }
  return { mount, isOpen, close, openDraft, openEditor, captureFile, captureDiff, position, key, submit, remove: removeComment, disarmDelete,
    set, refresh, applyMarks, renderChips, isListOpen, closeList, toggleList, renderList, focus,
    get editing() { return bubble?.editing || null; },
    dispose() { close(); closeList(); set([]); lifetime.abort(); observer?.disconnect(); disposed = true; },
  };
}
