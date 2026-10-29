import type { ApiRequest, HostEndpoint } from './api-client';
import { sendJson } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { TranscriptTree, TranscriptTreeBranch, TranscriptTreeFilter, TranscriptTreeNode, TranscriptTreeProjection, TranscriptTreeTool } from './transcript-tree-data';
import { TRANSCRIPT_TREE_FILTERS, decodeTranscriptTree, nodePreview, projectTranscriptTree, transcriptTreeDescend, transcriptTreePath, transcriptTreeVisibleAnchor } from './transcript-tree-data';
import { formatRelativeTime } from './helper-format';
import { escapeHtml } from '../core/helper-format';
import { record } from '../core/helper-values';

const FILTER_KEY = 'pi-dish-tree-filter', SUMMARIZE_KEY = 'pi-dish-branch-summarize';
// Branches off the active path cycle through the categorical chart hues; the
// active path always wears the accent.
const LANES = ['var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];

export function createTranscriptTree(options: {
  document: Document; storage: Pick<Storage, 'getItem' | 'setItem'>; sessionState: SessionState;
  request: ApiRequest; host: (id: string | null) => HostEndpoint | null;
  status: (message: string, type?: string) => void;
  saveEditorDraft: (owner: SelectionOwner, text: string) => void;
  selectSession: (id: string, options: { host: string | null; forceTranscriptReload: true }) => Promise<unknown>;
  copyMessageLink: (button: HTMLElement) => void;
}) {
  const { document, sessionState, storage, status: setStatus } = options;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => { const value = document.getElementById(id); if (!value) throw new Error('Missing tree element: ' + id); return value as T; };
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
  const hoverPointer = () => document.defaultView?.matchMedia?.('(hover: hover)').matches ?? true;
  let disposed = false, treeViewGeneration = 0, branchGeneration = 0, operationGeneration = 0;
  let treeData: TranscriptTree | null = null, treeOwner: SelectionOwner | null = null, treeEndpoint: Readonly<HostEndpoint> | null = null;
  let projection: TranscriptTreeProjection | null = null, tipId: string | null = null, pendingBranchId: string | null = null;
  let filterMode: TranscriptTreeFilter = TRANSCRIPT_TREE_FILTERS.find(mode => mode === storage.getItem(FILTER_KEY)) ?? 'conversation';
  const nodesById = new Map<string, TranscriptTreeNode>(), treeToolCallMap = new Map<string, TranscriptTreeTool>();
  let viewEvents = new AbortController(), rowEvents = new AbortController(), branchEvents = new AbortController();
  function ownsSelection(owner: SelectionOwner | null, host: Readonly<HostEndpoint> | null): owner is SelectionOwner {
    if (disposed || !owner || !host || !sessionState.ownsSelection(owner)) return false;
    const current = options.host(owner.host); return !!current && current.base === host.base && (current.token || '') === (host.token || '');
  }
  function ownsView(owner: SelectionOwner | null, host: Readonly<HostEndpoint> | null, generation: number): owner is SelectionOwner {
    return generation === treeViewGeneration && owner === treeOwner && ownsSelection(owner, host);
  }
  function retireBranch() { branchGeneration++; pendingBranchId = null; branchEvents.abort(); branchEvents = new AbortController(); }
  function setMapOpen(open: boolean) { element('treeModal').querySelector('.tree-modal')?.classList.toggle('map-open', open); }
  function closeTreeModal() {
    treeViewGeneration++; treeOwner = null; treeEndpoint = null; treeData = null; projection = null; tipId = null;
    nodesById.clear(); treeToolCallMap.clear();
    viewEvents.abort(); rowEvents.abort(); retireBranch(); closeMessageMenu(); setMapOpen(false); element('treeModal').style.display = 'none';
  }
  async function openTreeModal(target: { locate?: string } = {}) {
    if (disposed || !sessionState.currentSession) return;
    closeTreeModal(); operationGeneration++;
    const owner = sessionState.captureSelection(); if (!owner) return;
    const endpoint = options.host(owner.host); if (!endpoint) return;
    const host = Object.freeze({ ...endpoint }), generation = ++treeViewGeneration;
    treeOwner = owner; treeEndpoint = host;
    setStatus('Loading tree...', 'working');
    try {
      const response = await options.request(host, '/api/sessions/' + encodeURIComponent(owner.id) + '/tree');
      if (!response.ok) throw new Error(await response.text());
      const data = decodeTranscriptTree(await response.json());
      if (!ownsView(owner, host, generation)) return;
      treeData = data;
      for (const node of data.nodes) {
        if (!nodesById.has(node.id)) nodesById.set(node.id, node);
        if (node.role === 'assistant') for (const tool of node.toolCalls) treeToolCallMap.set(tool.id, tool);
      }
      const search = element<HTMLInputElement>('treeSearch'); search.value = '';
      viewEvents = new AbortController(); const { signal } = viewEvents;
      const owned = () => ownsView(owner, host, generation);
      search.addEventListener('input', () => { if (owned()) renderTree(); }, { signal });
      element('treeFilter').addEventListener('click', event => {
        const mode = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-filter]')?.dataset.filter : undefined;
        const next = TRANSCRIPT_TREE_FILTERS.find(value => value === mode);
        if (next && owned()) setFilter(next);
      }, { signal });
      element('treeStrip').addEventListener('click', () => { if (owned()) setMapOpen(!element('treeModal').querySelector('.tree-modal.map-open')); }, { signal });
      element('treeMapScrim').addEventListener('click', () => { if (owned()) setMapOpen(false); }, { signal });
      element('treeModal').style.display = 'flex';
      projection = projectTranscriptTree(data, filterMode);
      tipId = data.leafId && projection.parentOf.has(data.leafId) ? data.leafId : projection.order[projection.order.length - 1] ?? null;
      renderTree(target.locate ? transcriptTreeVisibleAnchor(projection, data, target.locate) : null);
      if (hoverPointer()) search.focus();
      setStatus('');
    } catch (error) { if (ownsView(owner, host, generation)) setStatus('Failed to load tree: ' + errorMessage(error), 'error'); }
  }
  function setFilter(mode: TranscriptTreeFilter) {
    if (!treeData || !ownsView(treeOwner, treeEndpoint, treeViewGeneration)) return;
    filterMode = mode; storage.setItem(FILTER_KEY, mode);
    projection = projectTranscriptTree(treeData, mode);
    // Keep viewing the same conversation point: the tip, or what it collapses into.
    tipId = (tipId && transcriptTreeVisibleAnchor(projection, treeData, tipId)) ?? projection.order[projection.order.length - 1] ?? null;
    renderTree();
  }
  function showBranch(branchId: string) {
    const branch = projection?.branches.get(branchId);
    if (!branch || !treeData || !projection || !ownsView(treeOwner, treeEndpoint, treeViewGeneration)) return;
    element<HTMLInputElement>('treeSearch').value = '';
    tipId = transcriptTreeDescend(projection, treeData, branch.nodeIds[branch.nodeIds.length - 1]);
    setMapOpen(false); renderTree(branch.nodeIds[0]);
  }
  function switchSibling(entryId: string, direction: number) {
    if (!treeData || !projection || !ownsView(treeOwner, treeEndpoint, treeViewGeneration)) return;
    const siblings = projection.childrenOf.get(projection.parentOf.get(entryId) ?? null) || [];
    const next = siblings[siblings.indexOf(entryId) + direction];
    if (!next) return;
    tipId = transcriptTreeDescend(projection, treeData, next); renderTree(next);
  }
  function locateMatch(entryId: string) {
    if (!treeData || !projection || !ownsView(treeOwner, treeEndpoint, treeViewGeneration)) return;
    element<HTMLInputElement>('treeSearch').value = '';
    tipId = transcriptTreeDescend(projection, treeData, entryId); renderTree(entryId);
  }

function searchText(node: TranscriptTreeNode) {
  return [node.text, node.role, node.label, node.toolName, node.modelId, node.summary, node.errorMessage].filter(Boolean).join(' ').toLowerCase();
}

function renderTree(locate: string | null = null) {
  if (!treeData || !projection || !ownsView(treeOwner, treeEndpoint, treeViewGeneration)) return;
  const view = projection, data = treeData;
  retireBranch(); rowEvents.abort(); rowEvents = new AbortController();
  const tokens = element<HTMLInputElement>('treeSearch').value.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = tokens.length ? new Set(view.order.filter(id => { const text = searchText(nodesById.get(id)!); return tokens.every(token => text.includes(token)); })) : null;
  const path = tipId ? transcriptTreePath(view, tipId) : [];
  const viewing = new Set(path.map(id => view.branchOf.get(id)));
  const lanes = new Map<string, string>();
  let laneIndex = 0;
  for (const id of view.order) {
    const branchId = view.branchOf.get(id)!;
    if (!lanes.has(branchId)) lanes.set(branchId, view.branches.get(branchId)!.onActivePath ? 'var(--accent)' : LANES[laneIndex++ % LANES.length]);
  }
  element('treeFilter').querySelectorAll<HTMLElement>('[data-filter]').forEach(button => {
    const on = button.dataset.filter === filterMode; button.classList.toggle('active', on); button.setAttribute('aria-checked', String(on));
  });
  const panel = element('treeModal').querySelector('.tree-modal');
  panel?.classList.toggle('has-forks', view.forkCount > 0 || view.rootBranchIds.length > 1);

  function branchHtml(branch: TranscriptTreeBranch): string {
    const hit = matches ? branch.nodeIds.some(id => matches.has(id)) : false;
    const classes = 'tree-branch' + (viewing.has(branch.id) ? ' viewing' : '') + (tipId && view.branchOf.get(tipId) === branch.id ? ' current' : '')
      + (branch.onActivePath ? ' on-path' : '') + (matches ? (hit ? ' has-match' : ' no-match') : '');
    const meta = branch.nodeIds.length + (branch.newest ? ' · ' + formatRelativeTime(branch.newest) : '') + (branch.hasLeaf ? ' ★' : '');
    let html = `<button type="button" class="${classes}" data-branch="${escapeHtml(branch.id)}" style="--lane:${lanes.get(branch.id)}">`
      + '<span class="tree-branch-dot"></span><span class="tree-branch-main">'
      + `<span class="tree-branch-title">${escapeHtml(branch.title)}</span>`
      + (branch.ending ? `<span class="tree-branch-end">→ ${escapeHtml(branch.ending)}</span>` : '')
      + `</span><span class="tree-branch-meta">${escapeHtml(meta)}</span></button>`;
    if (branch.childIds.length) {
      html += `<div class="tree-fork"><span class="tree-fork-mark">◆</span>fork · ${branch.childIds.length} branches</div><div class="tree-branch-children">`
        + branch.childIds.map(id => branchHtml(view.branches.get(id)!)).join('') + '</div>';
    }
    return html;
  }
  const map = element('treeMap');
  map.innerHTML = '<div class="tree-map-title">Branches</div>' + view.rootBranchIds.map(id => branchHtml(view.branches.get(id)!)).join('');

  const active = new Set(data.activePathIds);
  const rows = matches ? view.order.filter(id => matches.has(id)) : path;
  const body = element('treeBody');
  body.innerHTML = rows.map(id => {
    const node = nodesById.get(id)!, branchId = view.branchOf.get(id)!;
    const siblings = view.childrenOf.get(view.parentOf.get(id) ?? null) || [], position = siblings.indexOf(id);
    const classes = 'tree-node' + (active.has(id) ? ' active' : '') + (node.isLeaf ? ' is-leaf' : '') + (!matches && siblings.length > 1 ? ' fork-start' : '');
    const switcher = !matches && siblings.length > 1
      ? `<span class="tree-switch"><button type="button" class="tree-switch-btn" data-switch="-1" aria-label="Previous branch"${position === 0 ? ' disabled' : ''}>‹</button>`
        + `<span class="tree-switch-pos">${position + 1}/${siblings.length}</span>`
        + `<button type="button" class="tree-switch-btn" data-switch="1" aria-label="Next branch"${position === siblings.length - 1 ? ' disabled' : ''}>›</button></span>` : '';
    const where = matches ? `<span class="tree-node-branch">${escapeHtml(view.branches.get(branchId)!.title)}</span>` : '';
    return `<div class="${classes}" data-id="${escapeHtml(id)}" style="--lane:${lanes.get(branchId)}">${renderTreeNodeContent(node)}${where}${switcher}${node.isLeaf ? '<span class="tree-leaf-mark" title="Current position">★</span>' : ''}</div>`;
  }).join('');

  const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration, { signal } = rowEvents;
  body.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !ownsView(owner, host, generation)) return;
    const row = event.target.closest<HTMLElement>('.tree-node'), id = row?.dataset.id;
    if (!row || !id || !body.contains(row)) return;
    const switchButton = event.target.closest<HTMLButtonElement>('[data-switch]');
    if (switchButton) { if (!switchButton.disabled) switchSibling(id, Number(switchButton.dataset.switch)); return; }
    if (matches) locateMatch(id); else selectTreeNode(id);
  }, { signal });
  map.addEventListener('click', event => {
    const branch = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-branch]')?.dataset.branch : undefined;
    if (branch && ownsView(owner, host, generation)) showBranch(branch);
  }, { signal });
  const strip = element('treeStrip'), tipBranch = tipId ? view.branches.get(view.branchOf.get(tipId)!) : undefined;
  strip.innerHTML = `<span class="tree-strip-title">⑂ ${escapeHtml(tipBranch?.title || 'Conversation')}</span>`
    + `<span class="tree-strip-meta">${view.forkCount} ${view.forkCount === 1 ? 'fork' : 'forks'} ▾</span>`;
  renderFooter(rows.length, !!matches);

  if (locate) {
    const row = Array.from(body.querySelectorAll<HTMLElement>('.tree-node')).find(candidate => candidate.dataset.id === locate);
    if (row) { row.scrollIntoView({ block: 'center', behavior: 'instant' }); row.classList.add('located'); }
  } else if (matches) body.scrollTop = 0;
  else body.scrollTop = body.scrollHeight;
  map.querySelector('.tree-branch.current')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

function renderFooter(count: number, searching: boolean) {
  const status = element('treeStatus');
  if (!searching && tipId && treeData && tipId !== treeData.leafId && treeData.leafId && projection?.parentOf.has(treeData.leafId)) {
    status.innerHTML = '<div class="tree-view-note"><span>Viewing another branch</span><button type="button" class="btn-sm btn-branch" id="treeSwitchBtn">Switch to this branch</button></div>';
    const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration, target = tipId;
    element('treeSwitchBtn').addEventListener('click', () => { if (ownsView(owner, host, generation)) selectTreeNode(target); }, { signal: rowEvents.signal });
    return;
  }
  status.textContent = searching ? count + (count === 1 ? ' match' : ' matches') : count + (count === 1 ? ' entry' : ' entries');
}

function renderTreeNodeContent(node: TranscriptTreeNode) {
  if (node.type === 'message') {
    if (node.role === 'user') return '<span class="tree-role user" title="User">❯</span><span class="tree-text">' + escapeHtml(node.text || '(empty)') + '</span>';
    if (node.role === 'assistant') {
      if (!node.text && node.errorMessage) return '<span class="tree-role assistant" title="Assistant">●</span><span class="tree-text error-text">' + escapeHtml(node.errorMessage.substring(0, 160)) + '</span>';
      // Tool-only message: name the calls (server sends getToolSummary strings).
      const muted = !node.text && node.stopReason !== 'aborted';
      return '<span class="tree-role assistant" title="Assistant">●</span><span class="tree-text' + (muted ? ' muted' : '') + '">' + escapeHtml(nodePreview(node) || '(empty)') + '</span>';
    }
    if (node.role === 'toolResult') {
      const tool = node.toolCallId ? treeToolCallMap.get(node.toolCallId) : null;
      const label = tool ? '[' + tool.name + ': ' + tool.args + ']' : '[' + (node.toolName || 'tool') + ']';
      return '<span class="tree-role tool">' + escapeHtml(label) + '</span>' + (node.isError ? '<span class="tree-text error-text"> error</span>' : '');
    }
    return '<span class="tree-text muted">[' + escapeHtml(node.role || 'message') + ']</span>';
  }
  if (node.type === 'compaction') return '<span class="tree-role system">[compaction: ' + Math.round(node.tokensBefore / 1000) + 'k tokens]</span>';
  if (node.type === 'model_change') return '<span class="tree-text muted">[model: ' + escapeHtml(node.modelId) + ']</span>';
  if (node.type === 'branch_summary') return '<span class="tree-role system">[branch summary]</span> <span class="tree-text muted">' + escapeHtml(node.summary) + '</span>';
  if (node.type === 'session_info') return '<span class="tree-text muted">[session info]</span>';
  return '<span class="tree-text muted">[' + escapeHtml(node.type) + ']</span>';
}

  function selectTreeNode(entryId: string) {
    const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration;
    if (!treeData || !ownsView(owner, host, generation) || !nodesById.has(entryId)) return;
    if (entryId === treeData.leafId) { closeTreeModal(); return; }
    retireBranch(); pendingBranchId = entryId;
    const branch = branchGeneration;
    const current = () => branch === branchGeneration && pendingBranchId === entryId && ownsView(owner, host, generation);
    element('treeBody').querySelectorAll<HTMLElement>('.tree-node').forEach(row => row.classList.toggle('selected', row.dataset.id === entryId));
    const summarize = storage.getItem(SUMMARIZE_KEY) === '1';
    const allowInstructions = sessionState.currentSession?.harnessId !== 'omp';
    element('treeStatus').innerHTML = '<div class="branch-confirm">' +
      '<label class="branch-summarize-label"><input type="checkbox" id="branchSummarize"' + (summarize ? ' checked' : '') + '> Summarize abandoned branch</label>' +
      (allowInstructions ? '<input type="text" id="branchInstructions" class="branch-instructions" placeholder="Summary instructions (optional)"' + (summarize ? '' : ' style="display:none"') + '>' : '') +
      '<span class="branch-confirm-btns"><button class="btn-sm btn-branch" id="branchGoBtn">Branch from here</button><button class="btn-sm" id="branchCancelBtn">Cancel</button></span></div>';
    element('branchSummarize').addEventListener('change', () => { if (current()) toggleBranchInstructions(); }, { signal: branchEvents.signal });
    element('branchGoBtn').addEventListener('click', () => { if (current()) void confirmBranch(); }, { signal: branchEvents.signal });
    element('branchCancelBtn').addEventListener('click', () => { if (current()) cancelBranch(); }, { signal: branchEvents.signal });
  }
  function toggleBranchInstructions() {
    const input = document.getElementById('branchInstructions'); if (input) input.style.display = element<HTMLInputElement>('branchSummarize').checked ? '' : 'none';
  }
  function cancelBranch() {
    retireBranch(); element('treeBody').querySelectorAll('.selected').forEach(row => row.classList.remove('selected'));
    renderFooter(element('treeBody').querySelectorAll('.tree-node').length, !!element<HTMLInputElement>('treeSearch').value.trim());
  }
  /** Moves the leaf, stows a returned editor draft and reloads; 'stale' when superseded. */
  async function runBranch(owner: SelectionOwner, host: Readonly<HostEndpoint>, entryId: string, summarize: boolean, customInstructions: string | undefined): Promise<'done' | 'stale' | Error> {
    const operation = ++operationGeneration;
    storage.setItem(SUMMARIZE_KEY, summarize ? '1' : '0');
    setStatus(summarize ? 'Summarizing abandoned branch…' : 'Branching...', 'working');
    try {
      const data = await sendJson(options.request, host, '/api/sessions/' + encodeURIComponent(owner.id) + '/branch', { entryId, summarize, customInstructions });
      // The completed operation may return an origin draft after navigation.
      // Dismissal still permits a same-selection reload; reopening retires it.
      if (!disposed && record(data) && typeof data.editorText === 'string' && data.editorText) options.saveEditorDraft(owner, data.editorText);
      if (operation !== operationGeneration || !ownsSelection(owner, host)) return 'stale';
      closeTreeModal(); setStatus('Branched — reloading');
      await options.selectSession(owner.id, { host: owner.host, forceTranscriptReload: true });
      return 'done';
    } catch (error) {
      if (operation !== operationGeneration || !ownsSelection(owner, host)) return 'stale';
      setStatus('Branch failed: ' + errorMessage(error), 'error');
      return error instanceof Error ? error : new Error(String(error));
    }
  }
  async function confirmBranch() {
    const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration;
    if (!treeData || !pendingBranchId || !host || !ownsView(owner, host, generation)) return;
    const button = element<HTMLButtonElement>('branchGoBtn'); if (button.disabled) return;
    const entryId = pendingBranchId, branch = branchGeneration;
    const summarize = element<HTMLInputElement>('branchSummarize').checked;
    const customInstructions = (document.getElementById('branchInstructions') as HTMLInputElement | null)?.value.trim() || undefined;
    button.disabled = true; button.textContent = summarize ? 'Summarizing…' : 'Branching…';
    const result = await runBranch(owner, host, entryId, summarize, customInstructions);
    if (result instanceof Error && branch === branchGeneration && ownsView(owner, host, generation)) { button.disabled = false; button.textContent = 'Branch from here'; }
  }

  // Main-chat message actions: the ⑂ confirm popover and the touch ⋯ menu.
  let menu: HTMLElement | null = null, menuToken: symbol | null = null, menuEvents = new AbortController();
  function closeMessageMenu() { menuToken = null; menuEvents.abort(); if (menu) { menu.style.display = 'none'; menu.replaceChildren(); } }
  function placeMenu(el: HTMLElement, anchor: HTMLElement) {
    const view = document.defaultView; if (!view) return;
    const rect = anchor.getBoundingClientRect();
    el.style.left = '0px'; el.style.top = '0px';
    const width = el.offsetWidth, height = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(rect.right - width, view.innerWidth - width - 8))}px`;
    el.style.top = `${rect.bottom + 4 + height > view.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : rect.bottom + 4}px`;
  }
  function showMessageMenu(anchor: HTMLElement, html: string) {
    closeMessageMenu();
    if (!menu) { menu = document.createElement('div'); menu.id = 'messageActionMenu'; menu.className = 'context-menu message-action-menu'; document.body.append(menu); }
    const el = menu, token = Symbol('message-menu'); menuToken = token; menuEvents = new AbortController();
    const { signal } = menuEvents, current = () => !disposed && menuToken === token && !signal.aborted;
    el.innerHTML = html; el.style.display = 'block'; placeMenu(el, anchor);
    // Registered after the opening click finishes propagating.
    setTimeout(() => {
      if (current()) document.addEventListener('click', event => { if (current() && event.target instanceof Node && !el.contains(event.target)) closeMessageMenu(); }, { signal });
    }, 0);
    // Scrolling (including the on-screen keyboard's, when the instructions
    // field takes focus) carries the menu with its anchor; it closes only
    // once the anchor leaves the viewport or the DOM.
    const follow = () => {
      if (!current()) return;
      const rect = anchor.getBoundingClientRect(), view = document.defaultView;
      if (!anchor.isConnected || !view || rect.bottom < 0 || rect.top > view.innerHeight) closeMessageMenu(); else placeMenu(el, anchor);
    };
    document.addEventListener('scroll', event => { if (!(event.target instanceof Node && el.contains(event.target))) follow(); }, { capture: true, signal });
    document.defaultView?.addEventListener('resize', follow, { signal });
    return { el, signal, current };
  }
  function openMessageBranch(anchor: HTMLElement, entryId: string, role: string) {
    if (disposed) return;
    const owner = sessionState.captureSelection(); if (!owner) return;
    const endpoint = options.host(owner.host); if (!endpoint) return;
    const host = Object.freeze({ ...endpoint }), edit = role === 'user';
    const summarize = storage.getItem(SUMMARIZE_KEY) === '1', allowInstructions = sessionState.currentSession?.harnessId !== 'omp';
    const goLabel = edit ? 'Edit & resend' : 'Branch';
    const { el, signal, current } = showMessageMenu(anchor, '<div class="message-branch">'
      + `<div class="message-branch-title">${edit ? 'Edit &amp; resend from here' : 'Continue from here'}</div>`
      + `<div class="message-branch-desc">${edit ? 'Goes back to before this prompt and puts it in the composer to edit.' : 'Goes back to this reply; your next prompt starts a new branch.'}</div>`
      + `<label class="branch-summarize-label"><input type="checkbox" data-branch-summarize${summarize ? ' checked' : ''}> Summarize abandoned branch</label>`
      + (allowInstructions ? `<input type="text" class="branch-instructions" data-branch-instructions placeholder="Summary instructions (optional)"${summarize ? '' : ' hidden'}>` : '')
      + `<div class="branch-confirm-btns"><button type="button" class="btn-sm" data-branch-cancel>Cancel</button><button type="button" class="btn-sm btn-branch" data-branch-go>${escapeHtml(goLabel)}</button></div></div>`);
    const checkbox = el.querySelector<HTMLInputElement>('[data-branch-summarize]'), instructions = el.querySelector<HTMLInputElement>('[data-branch-instructions]');
    const go = el.querySelector<HTMLButtonElement>('[data-branch-go]'), cancel = el.querySelector<HTMLElement>('[data-branch-cancel]');
    if (!checkbox || !go || !cancel) return;
    checkbox.addEventListener('change', () => { if (current() && instructions) { instructions.hidden = !checkbox.checked; placeMenu(el, anchor); } }, { signal });
    cancel.addEventListener('click', () => { if (current()) closeMessageMenu(); }, { signal });
    go.addEventListener('click', () => {
      if (!current() || go.disabled || !ownsSelection(owner, host)) return;
      go.disabled = true; go.textContent = checkbox.checked ? 'Summarizing…' : 'Branching…';
      void runBranch(owner, host, entryId, checkbox.checked, instructions?.value.trim() || undefined).then(result => {
        if (!current()) return;
        if (result instanceof Error) { go.disabled = false; go.textContent = goLabel; } else closeMessageMenu();
      });
    }, { signal });
  }
  /** ⑂ in a message header (hover layouts). */
  function messageBranch(button: HTMLElement) {
    const entryId = button.dataset.entryId; if (entryId) openMessageBranch(button, entryId, button.dataset.role || '');
  }
  /** ⋯ in a message header (touch layouts): the header's actions as one menu. */
  function messageMenu(button: HTMLElement) {
    if (disposed) return;
    const header = button.closest('.message-header, .irc-header');
    const link = header?.querySelector<HTMLElement>('.msg-link-btn') ?? null, branch = header?.querySelector<HTMLElement>('.msg-branch-btn') ?? null;
    const entryId = branch?.dataset.entryId, role = branch?.dataset.role || '';
    const items: [string, string][] = [];
    if (link) items.push(['copy', 'Copy share link']);
    if (entryId) items.push(['branch', role === 'user' ? 'Edit & resend from here' : 'Continue from here'], ['locate', 'Show in tree']);
    if (!items.length) return;
    const { el, signal, current } = showMessageMenu(button, items.map(([act, label]) =>
      `<button type="button" class="context-menu-item" data-act="${act}"><span class="context-menu-label">${escapeHtml(label)}</span></button>`).join(''));
    el.addEventListener('click', event => {
      const act = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-act]')?.dataset.act : undefined;
      if (!act || !current()) return;
      if (act === 'copy' && link) { closeMessageMenu(); options.copyMessageLink(link); }
      else if (act === 'branch' && entryId) openMessageBranch(button, entryId, role);
      else if (act === 'locate' && entryId) { closeMessageMenu(); void openTreeModal({ locate: entryId }); }
    }, { signal });
  }
  return { open: openTreeModal, close: closeTreeModal, setFilter, showBranch, switchSibling, select: selectTreeNode, confirm: confirmBranch, cancel: cancelBranch,
    messageBranch, messageMenu, closeMessageMenu,
    get data() { return treeData; },
    get projection() { return projection; },
    dispose() { closeTreeModal(); operationGeneration++; disposed = true; menu?.remove(); menu = null; },
  };
}
