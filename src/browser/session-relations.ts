import type { ApiRequest, HostEndpoint } from './api-client';
import type { SelectionOwner, SessionState } from './session-state';
import { record } from '../core/helper-values';

// The subagents viewer: one header link sized by the family count, opening a
// recursive tree of the session's whole family (native subagent edges plus
// pi-dish launch provenance), assembled server-side by /api/sessions/:id/lineage.
export interface LineageCapabilities { readonly prompt: boolean; readonly steer: boolean; readonly followUp: boolean; }
export interface LineageSession {
  readonly id: string; readonly name: string; readonly cwd: string;
  readonly harnessId: string; readonly model: string;
  readonly isActive: boolean; readonly subagentLive: boolean;
  readonly turnInProgress: boolean; readonly capabilities: LineageCapabilities | null;
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
    turnInProgress: value.turnInProgress === true,
    capabilities: record(value.capabilities) ? {
      prompt: value.capabilities.prompt === true, steer: value.capabilities.steer === true,
      followUp: value.capabilities.followUp === true,
    } : null,
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
  openView: (owner: SelectionOwner, endpoint: HostEndpoint, initial: SessionLineage) => void;
  status: (message: string, kind: 'error') => void;
}) {
  const { document, sessionState } = options;
  const element = (id: string) => document.getElementById(id);
  let sessionRelationsSeq = 0;
  let disposed = false;
  let renderOwner: SelectionOwner | null = null;
  let renderEndpoint: HostEndpoint | null = null;
  let headerEvents = new AbortController();
  let indexingTimer: ReturnType<typeof setTimeout> | undefined;
  let lineage: SessionLineage = EMPTY_LINEAGE;

  function sameEndpoint(host: string | null, endpoint: HostEndpoint | null): boolean {
    const current = options.endpoint(host);
    return !!endpoint && !!current && current.base === endpoint.base && (current.token || '') === (endpoint.token || '');
  }
  const owns = (owner: SelectionOwner | null, endpoint = renderEndpoint) => !disposed && sessionState.ownsSelection(owner) && !!owner && sameEndpoint(owner.host, endpoint);

  function clearSessionRelations() {
    sessionRelationsSeq += 1;
    clearTimeout(indexingTimer);
    headerEvents.abort();
    renderOwner = null; renderEndpoint = null;
    lineage = EMPTY_LINEAGE;
    const el = element('sessionRelations');
    if (!el) return;
    el.replaceChildren();
    el.style.display = 'none';
  }

  // The family size is the glanceable signal; the takeover carries the tree,
  // peeking and signaling.
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
      if (owns(owner, endpoint) && owner && endpoint) options.openView(owner, endpoint, lineage);
    }, { signal: headerEvents.signal });
    el.appendChild(link);
  }

  async function loadSessionRelations(owner: SelectionOwner | null): Promise<void> {
    if (disposed || !owner || !sessionState.ownsSelection(owner)) return;
    const resolved = options.endpoint(owner.host);
    if (!resolved) return;
    const endpoint = Object.freeze({ ...resolved });
    const seq = ++sessionRelationsSeq;
    clearTimeout(indexingTimer);
    const current = () => seq === sessionRelationsSeq && owns(owner, endpoint);
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/lineage`);
      const data: unknown = await res.json();
      if (!current()) return;
      if (!res.ok) throw new Error(record(data) && text(data.error) || `HTTP ${res.status}`);
      const indexing = record(data) && data.indexing === true;
      lineage = decodeSessionLineage(data);
      renderRelationsLink(owner, endpoint);
      if (indexing) indexingTimer = setTimeout(() => {
        if (current()) void loadSessionRelations(owner);
      }, 1000);
    } catch (error) {
      if (current()) {
        lineage = EMPTY_LINEAGE;
        renderRelationsLink(owner, endpoint);
        console.error('Failed to load session lineage:', error);
      }
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
    get data() { return lineage; },
    dispose() { clearSessionRelations(); disposed = true; },
  };
}
