import type { ApiRequest, HostEndpoint } from './api-client';
import { sendJson } from './api-client';
import type { SessionState, SelectionOwner } from './session-state';
import type { TranscriptTree, TranscriptTreeNode, TranscriptTreeTool } from './transcript-tree-data';
import { decodeTranscriptTree } from './transcript-tree-data';
import { escapeHtml } from './helper-format';
import { record } from './helper-values';

export function createTranscriptTree(options: {
  document: Document; storage: Pick<Storage, 'getItem' | 'setItem'>; sessionState: SessionState;
  request: ApiRequest; host: (id: string | null) => HostEndpoint | null;
  status: (message: string, type?: string) => void;
  saveEditorDraft: (owner: SelectionOwner, text: string) => void;
  selectSession: (id: string, options: { host: string | null; forceTranscriptReload: true }) => Promise<unknown>;
}) {
  const { document, sessionState, storage, status: setStatus } = options;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => { const value = document.getElementById(id); if (!value) throw new Error('Missing tree element: ' + id); return value as T; };
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
  let disposed = false, treeViewGeneration = 0, branchGeneration = 0, operationGeneration = 0;
  let treeData: TranscriptTree | null = null, treeOwner: SelectionOwner | null = null, treeEndpoint: Readonly<HostEndpoint> | null = null;
  let pendingBranchId: string | null = null;
  const treeToolCallMap = new Map<string, TranscriptTreeTool>();
  let viewEvents = new AbortController(), rowEvents = new AbortController(), branchEvents = new AbortController();
  function ownsSelection(owner: SelectionOwner | null, host: Readonly<HostEndpoint> | null): owner is SelectionOwner {
    if (disposed || !owner || !host || !sessionState.ownsSelection(owner)) return false;
    const current = options.host(owner.host); return !!current && current.base === host.base && (current.token || '') === (host.token || '');
  }
  function ownsView(owner: SelectionOwner | null, host: Readonly<HostEndpoint> | null, generation: number): owner is SelectionOwner {
    return generation === treeViewGeneration && owner === treeOwner && ownsSelection(owner, host);
  }
  function retireBranch() { branchGeneration++; pendingBranchId = null; branchEvents.abort(); branchEvents = new AbortController(); }
  function closeTreeModal() {
    treeViewGeneration++; treeOwner = null; treeEndpoint = null; treeData = null; treeToolCallMap.clear();
    viewEvents.abort(); rowEvents.abort(); retireBranch(); element('treeModal').style.display = 'none';
  }
  async function openTreeModal() {
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
      for (const node of data.nodes) if (node.role === 'assistant') for (const tool of node.toolCalls) treeToolCallMap.set(tool.id, tool);
      const search = element<HTMLInputElement>('treeSearch'), filter = element<HTMLSelectElement>('treeFilter');
      search.value = ''; filter.value = 'default';
      viewEvents = new AbortController();
      const update = () => { if (ownsView(owner, host, generation)) filterTree(search.value); };
      search.addEventListener('input', update, { signal: viewEvents.signal }); filter.addEventListener('change', update, { signal: viewEvents.signal });
      filterTree(''); element('treeModal').style.display = 'flex'; search.focus(); setStatus('');
    } catch (error) { if (ownsView(owner, host, generation)) setStatus('Failed to load tree: ' + errorMessage(error), 'error'); }
  }
function filterTree(query: string) {
  if (!treeData || !ownsView(treeOwner, treeEndpoint, treeViewGeneration)) return;
  var filterMode = element<HTMLSelectElement>('treeFilter').value;
  var tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  
  var filtered = treeData.nodes.filter(function(node) {
    if (filterMode === 'user-only' && !(node.type === 'message' && node.role === 'user')) return false;
    // No Tools hides the whole tool layer: results AND the text-less
    // assistant messages that only carry tool calls (keep the leaf — it's
    // the branch point the modal exists to show).
    if (filterMode === 'no-tools' && node.type === 'message' &&
        (node.role === 'toolResult' ||
         (node.role === 'assistant' && !node.text && !node.isLeaf))) return false;
    if (filterMode === 'default') {
      if (['model_change','thinking_level_change','label','custom'].includes(node.type)) return false;
      if (node.type === 'message' && node.role === 'assistant' && !node.text && !node.isLeaf) return false;
    }
    if (tokens.length > 0) {
      var text = getNodeSearchText(node).toLowerCase();
      return tokens.every(t => text.includes(t));
    }
    return true;
  });
  renderTree(filtered);
}

function getNodeSearchText(node: TranscriptTreeNode) {
  return [node.text, node.role, node.label, node.toolName, node.modelId, node.summary].filter(Boolean).join(' ');
}

function renderTree(nodes: readonly TranscriptTreeNode[]) {
  var body = element('treeBody');
  if (!treeData || !ownsView(treeOwner, treeEndpoint, treeViewGeneration)) return;
  var activeSet = new Set(treeData.activePathIds);
  const childrenOf = new Map<string, TranscriptTreeNode[]>();
  for (var n of nodes) {
    var pid = n.parentId || '__root__';
    const siblings = childrenOf.get(pid) || []; siblings.push(n); childrenOf.set(pid, siblings);
  }
  
  var html = '';
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var isActive = activeSet.has(node.id);
    var indent = '  '.repeat(Math.min(node.depth, treeData.nodes.length));
    var siblings = childrenOf.get(node.parentId || '__root__') || [];
    var isLast = siblings.indexOf(node) === siblings.length - 1;
    var connector = (node.depth > 0 && siblings.length > 1) ? (isLast ? '└ ' : '├ ') : '';
    var marker = isActive ? '•' : ' ';
    var classes = 'tree-node' + (isActive ? ' active' : '') + (node.isLeaf ? ' is-leaf' : '');
    var badge = node.childCount > 1 ? '<span class="tree-branch-badge">' + node.childCount + '</span>' : '';
    
    html += '<div class="' + classes + '" data-id="' + escapeHtml(node.id) + '" style="--tree-depth:' + node.depth + '">';
    html += '<span class="tree-prefix">' + indent + connector + '</span>';
    html += '<span class="tree-marker ' + (isActive ? 'active-marker' : 'inactive-marker') + '">' + marker + ' </span>';
    html += renderTreeNodeContent(node) + badge + '</div>';
  }
  
  retireBranch(); rowEvents.abort(); rowEvents = new AbortController();
  const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration;
  body.innerHTML = html;
  body.querySelectorAll<HTMLElement>('.tree-node').forEach(row => {
    const id = row.dataset.id;
    row.addEventListener('click', () => { if (id && ownsView(owner, host, generation)) selectTreeNode(id); }, { signal: rowEvents.signal });
  });
  element('treeStatus').textContent = nodes.length + ' entries';
  var leaf = body.querySelector('.is-leaf');
  if (leaf) leaf.scrollIntoView({ block: 'center', behavior: 'instant' });
}

function renderTreeNodeContent(node: TranscriptTreeNode) {
  if (node.type === 'message') {
    if (node.role === 'user') return '<span class="tree-role user">user:</span><span class="tree-text">' + escapeHtml(node.text || '(empty)') + '</span>';
    if (node.role === 'assistant') {
      var text = node.text || '';
      if (!text && node.stopReason === 'aborted') text = '(aborted)';
      if (!text && node.errorMessage) return '<span class="tree-role assistant">assistant:</span><span class="tree-text error-text">' + escapeHtml(node.errorMessage.substring(0, 80)) + '</span>';
      // Tool-only message: name the calls (server sends getToolSummary
      // strings) instead of an anonymous "(tool use)".
      if (!text && node.toolCalls && node.toolCalls.length) {
        var calls = node.toolCalls.map(function(tc) { return tc.args ? tc.name + ': ' + tc.args : tc.name; }).join(' · ');
        return '<span class="tree-role assistant">assistant:</span><span class="tree-text muted">' + escapeHtml(calls) + '</span>';
      }
      if (!text) text = '(empty)';
      return '<span class="tree-role assistant">assistant:</span><span class="tree-text">' + escapeHtml(text) + '</span>';
    }
    if (node.role === 'toolResult') {
      var tc = node.toolCallId ? treeToolCallMap.get(node.toolCallId) : null;
      var disp = tc ? '[' + tc.name + ': ' + tc.args + ']' : '[' + (node.toolName || 'tool') + ']';
      return '<span class="tree-role tool">' + escapeHtml(disp) + '</span>' + (node.isError ? '<span class="tree-text error-text"> error</span>' : '');
    }
    return '<span class="tree-text muted">[' + escapeHtml(node.role || 'message') + ']</span>';
  }
  if (node.type === 'compaction') return '<span class="tree-role system">[compaction: ' + Math.round((node.tokensBefore || 0) / 1000) + 'k tokens]</span>';
  if (node.type === 'model_change') return '<span class="tree-text muted">[model: ' + escapeHtml(node.modelId || '') + ']</span>';
  if (node.type === 'branch_summary') return '<span class="tree-role system">[branch summary]</span> <span class="tree-text muted">' + escapeHtml(node.summary || '') + '</span>';
  if (node.type === 'session_info') return '<span class="tree-text muted">[session info]</span>';
  return '<span class="tree-text muted">[' + escapeHtml(node.type) + ']</span>';
}


  function selectTreeNode(entryId: string) {
    const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration;
    if (!treeData || !ownsView(owner, host, generation) || !treeData.nodes.some(node => node.id === entryId)) return;
    if (entryId === treeData.leafId) { closeTreeModal(); return; }
    retireBranch(); pendingBranchId = entryId;
    const branch = branchGeneration;
    const current = () => branch === branchGeneration && pendingBranchId === entryId && ownsView(owner, host, generation);
    element('treeBody').querySelectorAll<HTMLElement>('.tree-node').forEach(row => row.classList.toggle('selected', row.dataset.id === entryId));
    const summarize = storage.getItem('pi-dish-branch-summarize') === '1';
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
    element('treeStatus').textContent = element('treeBody').querySelectorAll('.tree-node').length + ' entries';
  }
  async function confirmBranch() {
    const owner = treeOwner, host = treeEndpoint, generation = treeViewGeneration;
    if (!treeData || !pendingBranchId || !host || !ownsView(owner, host, generation)) return;
    const button = element<HTMLButtonElement>('branchGoBtn'); if (button.disabled) return;
    const entryId = pendingBranchId, branch = branchGeneration, operation = ++operationGeneration;
    const summarize = element<HTMLInputElement>('branchSummarize').checked;
    const customInstructions = (document.getElementById('branchInstructions') as HTMLInputElement | null)?.value.trim() || undefined;
    storage.setItem('pi-dish-branch-summarize', summarize ? '1' : '0');
    button.disabled = true; button.textContent = summarize ? 'Summarizing…' : 'Branching…';
    setStatus(summarize ? 'Summarizing abandoned branch…' : 'Branching...', 'working');
    try {
      const data = await sendJson(options.request, host, '/api/sessions/' + encodeURIComponent(owner.id) + '/branch', { entryId, summarize, customInstructions });
      // The completed operation may return an origin draft after navigation.
      // Dismissal still permits a same-selection reload; reopening retires it.
      if (!disposed && record(data) && typeof data.editorText === 'string' && data.editorText) options.saveEditorDraft(owner, data.editorText);
      if (operation !== operationGeneration || !ownsSelection(owner, host)) return;
      closeTreeModal(); setStatus('Branched — reloading');
      await options.selectSession(owner.id, { host: owner.host, forceTranscriptReload: true });
    } catch (error) {
      if (operation !== operationGeneration || !ownsSelection(owner, host)) return;
      setStatus('Branch failed: ' + errorMessage(error), 'error');
      if (branch === branchGeneration && ownsView(owner, host, generation)) { button.disabled = false; button.textContent = 'Branch from here'; }
    }
  }
  return { open: openTreeModal, close: closeTreeModal, filter: filterTree, select: selectTreeNode, confirm: confirmBranch, cancel: cancelBranch,
    get data() { return treeData; },
    dispose() { closeTreeModal(); operationGeneration++; disposed = true; },
  };
}
