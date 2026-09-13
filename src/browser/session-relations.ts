import type { ApiRequest, HostEndpoint } from './api-client';
import type { SelectionOwner, SessionState } from './session-state';
import { formatRelativeTime } from './helper-format';
import { record } from './helper-values';

// The subagents viewer: one header link sized by the family count, opening a
// recursive tree of the session's whole family (native subagent edges plus
// pi-dish launch provenance), assembled server-side by /api/sessions/:id/lineage.
export interface LineageSession {
  readonly id: string; readonly name: string; readonly cwd: string;
  readonly harnessId: string; readonly model: string;
  readonly isActive: boolean; readonly subagentLive: boolean;
  readonly lastActivity: string | number | null;
}
export interface LineageEdge { readonly kind: string; readonly source: string; }
export interface LineageNode {
  readonly session: LineageSession; readonly edge: LineageEdge | null;
  readonly children: readonly LineageNode[];
}
export interface SessionLineage {
  readonly session: LineageSession | null;
  readonly tree: LineageNode | null;
  readonly members: number; readonly truncated: boolean;
}
const EMPTY_LINEAGE: SessionLineage = { session: null, tree: null, members: 0, truncated: false };

const text = (value: unknown) => typeof value === 'string' ? value : '';

function decodeLineageSession(value: unknown): LineageSession | null {
  if (!record(value) || typeof value.id !== 'string' || !value.id) return null;
  return {
    id: value.id, name: text(value.name), cwd: text(value.cwd),
    harnessId: text(value.harnessId), model: text(value.model),
    isActive: value.isActive === true, subagentLive: value.subagentLive === true,
    lastActivity: typeof value.lastActivity === 'string' || typeof value.lastActivity === 'number' ? value.lastActivity : null,
  };
}

// Defensive bound: the server caps the tree, but a hostile/buggy payload must
// not recurse the decoder forever either.
const LINEAGE_DECODE_NODE_CAP = 5000;
function decodeLineageNode(value: unknown, budget: { left: number }): LineageNode | null {
  if (!record(value) || budget.left <= 0) return null;
  const session = decodeLineageSession(value.session);
  if (!session) return null;
  budget.left -= 1;
  const edge = record(value.edge) ? { kind: text(value.edge.kind), source: text(value.edge.source) } : null;
  const children = Array.isArray(value.children)
    ? value.children.flatMap(child => {
      const node = decodeLineageNode(child, budget);
      return node ? [node] : [];
    })
    : [];
  return { session, edge, children };
}

function countLineageMembers(node: LineageNode | null): number {
  if (!node) return 0;
  return 1 + node.children.reduce((count, child) => count + countLineageMembers(child), 0);
}

export function decodeSessionLineage(value: unknown): SessionLineage {
  if (!record(value)) return EMPTY_LINEAGE;
  const tree = decodeLineageNode(value.tree, { left: LINEAGE_DECODE_NODE_CAP });
  const members = typeof value.members === 'number' && Number.isFinite(value.members) && value.members >= 0
    ? value.members : countLineageMembers(tree);
  return { session: decodeLineageSession(value.session), tree, members, truncated: value.truncated === true };
}

export function createSessionRelations(options: {
  document: Document; window: Window; sessionState: SessionState; request: ApiRequest;
  endpoint: (host: string | null) => HostEndpoint | null;
  loadPrevious: () => Promise<unknown>; selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
  status: (message: string, kind: 'error') => void;
}) {
  const { document, sessionState } = options;
  const element = (id: string) => document.getElementById(id);
  let sessionRelationsSeq = 0;
  let disposed = false;
  let renderOwner: SelectionOwner | null = null;
  let renderEndpoint: HostEndpoint | null = null;
  let headerEvents = new AbortController(), modalEvents = new AbortController();
  let indexingTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let loadInFlight = false;
  let lastIndexing = false;
  let lineage: SessionLineage = EMPTY_LINEAGE;
  const collapsed = new Set<string>();

  function sameEndpoint(host: string | null, endpoint: HostEndpoint | null): boolean {
    const current = options.endpoint(host);
    return !!endpoint && !!current && current.base === endpoint.base && (current.token || '') === (endpoint.token || '');
  }
  const owns = (owner: SelectionOwner | null, endpoint = renderEndpoint) => !disposed && sessionState.ownsSelection(owner) && !!owner && sameEndpoint(owner.host, endpoint);

  function clearSessionRelations() {
    sessionRelationsSeq += 1;
    clearTimeout(indexingTimer);
    clearInterval(pollTimer); pollTimer = undefined;
    headerEvents.abort();
    renderOwner = null; renderEndpoint = null;
    lineage = EMPTY_LINEAGE;
    collapsed.clear();
    closeRelationsModal();
    const el = element('sessionRelations');
    if (!el) return;
    el.replaceChildren();
    el.style.display = 'none';
  }

  // One compact affordance replaces the old chip strip: the family size is
  // the glanceable signal, and the tree modal carries navigation.
  function renderRelationsLink(owner: SelectionOwner | null = renderOwner, endpoint: HostEndpoint | null = renderEndpoint) {
    if (!owns(owner, endpoint)) return;
    renderOwner = owner; renderEndpoint = endpoint;
    headerEvents.abort(); headerEvents = new AbortController();
    const el = element('sessionRelations');
    if (!el) return;
    el.replaceChildren();
    const others = lineage.tree ? lineage.members - 1 : 0;
    if (others <= 0) {
      el.style.display = 'none';
      closeRelationsModal();
      return;
    }
    el.style.display = '';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'session-relation-chip session-relation-tree-link';
    link.title = `View the session family tree (${others} related session${others === 1 ? '' : 's'})`;
    const icon = document.createElement('span');
    icon.className = 'session-relation-kind';
    icon.textContent = '⎇';
    const name = document.createElement('span');
    name.className = 'session-relation-name';
    name.textContent = `Subagents · ${others}`;
    link.append(icon, name);
    link.addEventListener('click', () => {
      if (owns(owner, endpoint)) openRelationsModal();
    }, { signal: headerEvents.signal });
    el.appendChild(link);
  }

  function openRelationsModal() {
    if (!owns(renderOwner) || !lineage.tree) return;
    const modal = element('relationsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderLineageTree();
    // A live fan-out is the viewer's main case: repoll while open, but only
    // while the viewed session can still gain relatives (active or indexing).
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!owns(renderOwner) || loadInFlight) return;
      if (!sessionState.currentSession?.isActive && !lastIndexing) return;
      void loadSessionRelations(renderOwner);
    }, 4000);
  }

  function closeRelationsModal() {
    modalEvents.abort();
    clearInterval(pollTimer); pollTimer = undefined;
    const modal = element('relationsModal');
    if (modal) modal.style.display = 'none';
  }

  function renderLineageTree() {
    if (!owns(renderOwner) || !lineage.tree) return;
    modalEvents.abort(); modalEvents = new AbortController();
    const body = element('relationsBody');
    if (!body) return;
    body.replaceChildren();
    const owner = renderOwner, endpoint = renderEndpoint;
    const tree = lineage.tree;
    const harnesses = new Set<string>();
    (function collect(node: LineageNode) {
      if (node.session.harnessId) harnesses.add(node.session.harnessId);
      for (const child of node.children) collect(child);
    })(tree);
    const mixedHarnesses = harnesses.size > 1;
    const currentId = lineage.session?.id || sessionState.currentSession?.id || null;

    const rows: { node: LineageNode; depth: number }[] = [];
    (function flatten(node: LineageNode, depth: number) {
      rows.push({ node, depth });
      if (collapsed.has(node.session.id)) return;
      for (const child of node.children) flatten(child, depth + 1);
    })(tree, 0);

    for (const { node, depth } of rows) {
      const target = node.session;
      const row = document.createElement('div');
      row.className = 'lineage-row';
      row.style.setProperty('--depth', String(depth));
      row.dataset.sessionId = target.id;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.title = target.cwd || target.id;
      const isCurrent = target.id === currentId;
      if (isCurrent) row.classList.add('lineage-current');

      const twisty = document.createElement('span');
      twisty.className = 'lineage-twisty';
      if (node.children.length) {
        const isCollapsed = collapsed.has(target.id);
        twisty.textContent = isCollapsed ? '▸' : '▾';
        twisty.title = isCollapsed ? 'Expand subtree' : 'Collapse subtree';
        twisty.addEventListener('click', (event) => {
          event.stopPropagation();
          if (!owns(owner, endpoint)) return;
          if (collapsed.has(target.id)) collapsed.delete(target.id); else collapsed.add(target.id);
          renderLineageTree();
        }, { signal: modalEvents.signal });
      }
      row.appendChild(twisty);

      if (target.isActive || target.subagentLive) {
        const dot = document.createElement('span');
        dot.className = 'live-dot';
        dot.title = target.isActive ? 'Live session' : 'Subagent still loaded in its parent';
        row.appendChild(dot);
      }
      const name = document.createElement('span');
      name.className = 'lineage-name';
      name.textContent = target.name || target.id.slice(0, 8);
      row.appendChild(name);
      if (node.edge?.kind === 'startedHere') {
        const badge = document.createElement('span');
        badge.className = 'lineage-badge';
        badge.textContent = 'launched';
        badge.title = `Started from its relative by pi-dish (${node.edge.source || 'launch metadata'})`;
        row.appendChild(badge);
      }
      if (mixedHarnesses && target.harnessId) {
        const badge = document.createElement('span');
        badge.className = 'lineage-badge lineage-harness';
        badge.textContent = target.harnessId;
        row.appendChild(badge);
      }
      if (isCurrent) {
        const badge = document.createElement('span');
        badge.className = 'lineage-badge lineage-current-badge';
        badge.textContent = 'current';
        row.appendChild(badge);
      }
      const meta = document.createElement('span');
      meta.className = 'lineage-meta';
      meta.textContent = formatRelativeTime(target.lastActivity);
      row.appendChild(meta);

      const activate = () => {
        if (!owns(owner, endpoint)) return;
        closeRelationsModal();
        void openRelatedSession(target.id, owner, endpoint);
      };
      row.addEventListener('click', activate, { signal: modalEvents.signal });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      }, { signal: modalEvents.signal });
      body.appendChild(row);
    }
    if (lineage.truncated) {
      const note = document.createElement('div');
      note.className = 'lineage-truncated';
      note.textContent = 'This family is too large to show in full — the tree is truncated.';
      body.appendChild(note);
    }
  }

  async function loadSessionRelations(owner: SelectionOwner | null): Promise<void> {
    if (disposed || !owner || !sessionState.ownsSelection(owner)) return;
    const resolved = options.endpoint(owner.host);
    if (!resolved) return;
    const endpoint = Object.freeze({ ...resolved });
    const seq = ++sessionRelationsSeq;
    clearTimeout(indexingTimer);
    loadInFlight = true;
    const current = () => seq === sessionRelationsSeq && owns(owner, endpoint);
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/lineage`);
      const data: unknown = await res.json();
      if (!current()) return;
      if (!res.ok) throw new Error(record(data) && text(data.error) || `HTTP ${res.status}`);
      lastIndexing = record(data) && data.indexing === true;
      lineage = decodeSessionLineage(data);
      renderRelationsLink(owner, endpoint);
      const modal = element('relationsModal');
      if (modal && modal.style.display !== 'none') renderLineageTree();
      if (lastIndexing) indexingTimer = setTimeout(() => {
        if (current()) void loadSessionRelations(owner);
      }, 1000);
    } catch (error) {
      if (current()) {
        lineage = EMPTY_LINEAGE;
        lastIndexing = false;
        renderRelationsLink(owner, endpoint);
        console.error('Failed to load session lineage:', error);
      }
    } finally {
      loadInFlight = false;
    }
  }
  async function openRelatedSession(id: string, owner: SelectionOwner | null, endpoint: HostEndpoint | null = owner ? options.endpoint(owner.host) : null): Promise<void> {
    if (!owns(owner, endpoint) || !owner) return;
    const captured = endpoint ? Object.freeze({ ...endpoint }) : null;
    if (!sessionState.findSession(id, owner.host)) await options.loadPrevious();
    if (!owns(owner, captured)) return;
    if (!sessionState.findSession(id, owner.host)) { options.status('Related session is not available yet', 'error'); return; }
    await options.selectSession(id, { host: owner.host });
  }

  return { clear: clearSessionRelations, load: loadSessionRelations, openRelated: openRelatedSession,
    openModal: openRelationsModal, closeModal: closeRelationsModal,
    get data() { return lineage; },
    dispose() { clearSessionRelations(); disposed = true; },
  };
}
