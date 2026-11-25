import { countLabel } from './helper-format';
import type { ApiRequest, HostEndpoint } from './api-client';
import type { SelectionOwner, SessionState } from './session-state';
import { record, text } from '../core/helper-values';
import { EMPTY_TASKS, decodeSessionTasks, type SessionTasksPayload } from './agy-views-data';

// The family tree is assembled server-side by /api/sessions/:id/lineage.
export interface LineageCapabilities { readonly prompt: boolean; readonly steer: boolean; readonly followUp: boolean; }
export interface LineageSession {
  readonly id: string; readonly name: string; readonly cwd: string;
  readonly harnessId: string; readonly model: string;
  readonly isActive: boolean; readonly subagentLive: boolean;
  readonly turnInProgress: boolean; readonly capabilities: LineageCapabilities | null;
  readonly lastActivity: string | number | null;
  /** OMP task subagent id, matching the id its background-job rows show ('' otherwise). */
  readonly agentId: string;
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
    agentId: text(value.agentId),
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

function countWorkingRelatives(node: LineageNode | null, excludeId: string | null): number {
  if (!node) return 0;
  const self = node.session.id !== excludeId && node.session.turnInProgress ? 1 : 0;
  return self + node.children.reduce((count, child) => count + countWorkingRelatives(child, excludeId), 0);
}

export function createSessionRelations(options: {
  document: Document; window: Window; sessionState: SessionState; request: ApiRequest;
  endpoint: (host: string | null) => HostEndpoint | null;
  loadPrevious: () => Promise<unknown>; selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
  openView: (owner: SelectionOwner, endpoint: HostEndpoint, initial: SessionLineage) => void;
  openTasksView?: (owner: SelectionOwner, endpoint: HostEndpoint, initial: SessionTasksPayload) => void;
  openSwarmView?: (owner: SelectionOwner, endpoint: HostEndpoint) => void;
  status: (message: string, kind: 'error') => void;
  onLineage?: (owner: SelectionOwner, lineage: SessionLineage) => void;
  // True while a related takeover owns the main pane. Its own poll covers
  // the family/tasks/swarm there and the header chips are hidden, so this poll stands down.
  takeoverActive?: () => boolean;
}) {
  const { document, sessionState } = options;
  const element = (id: string) => document.getElementById(id);
  let sessionRelationsSeq = 0;
  let disposed = false;
  let renderOwner: SelectionOwner | null = null;
  let renderEndpoint: HostEndpoint | null = null;
  let headerEvents = new AbortController();
  let indexingTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastIndexing = false;
  let loadInFlight = false;
  let lineage: SessionLineage = EMPTY_LINEAGE;
  let tasksData: SessionTasksPayload = EMPTY_TASKS;

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
    tasksData = EMPTY_TASKS;
    const el = element('sessionRelations');
    if (!el) return;
    el.replaceChildren();
    el.style.display = 'none';
  }

  // Glanceable header chips for session family, background tasks/plan, and live swarm.
  function renderRelationsLink(owner: SelectionOwner | null = renderOwner, endpoint: HostEndpoint | null = renderEndpoint) {
    if (!owns(owner, endpoint)) return;
    renderOwner = owner; renderEndpoint = endpoint;
    headerEvents.abort(); headerEvents = new AbortController();
    const el = element('sessionRelations');
    if (!el) return;
    el.replaceChildren();
    const others = lineage.tree ? lineage.members - 1 : 0;
    const isAgy = sessionState.currentSession?.harnessId === 'agy';
    const taskCount = isAgy ? tasksData.tasks.length : 0;
    const planCount = isAgy ? tasksData.plan.length : 0;
    const showTasks = isAgy && !!options.openTasksView && (taskCount > 0 || planCount > 0);
    const swarmSummary = isAgy && !!options.openSwarmView ? tasksData.swarm : null;

    if (others <= 0 && !showTasks && !swarmSummary) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';

    if (others > 0) {
      const workingRelatives = countWorkingRelatives(lineage.tree, owner?.id ?? null);
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'session-relation-chip session-relation-tree-link';
      link.title = `View the session family tree (${countLabel(others, 'related session')})`;
      if (workingRelatives > 0) {
        const dot = document.createElement('span');
        dot.className = 'session-relation-dot working';
        link.appendChild(dot);
      }
      const icon = document.createElement('span');
      icon.className = 'session-relation-kind';
      icon.textContent = '⎇';
      const name = document.createElement('span');
      name.className = 'session-relation-name';
      name.textContent = `Subagents · ${others}`;
      link.append(icon, name);
      if (workingRelatives > 0) {
        const badge = document.createElement('span');
        badge.className = 'session-relation-badge';
        badge.textContent = `${workingRelatives} working`;
        link.appendChild(badge);
      }
      link.addEventListener('click', () => {
        if (owns(owner, endpoint) && owner && endpoint) options.openView(owner, endpoint, lineage);
      }, { signal: headerEvents.signal });
      el.appendChild(link);
    }

    if (showTasks && options.openTasksView) {
      const running = tasksData.tasks.filter(t => t.status === 'running').length;
      const scheduled = tasksData.tasks.filter(t => t.status === 'scheduled').length;
      const planDone = tasksData.plan.filter(p => p.status === 'completed').length;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'session-relation-chip session-relation-tasks-link';
      chip.title = 'View background tasks, scheduled jobs, and plan (/tasks)';
      if (running > 0 || scheduled > 0) {
        const dot = document.createElement('span');
        dot.className = `session-relation-dot ${running > 0 ? 'working' : 'scheduled'}`;
        chip.appendChild(dot);
      }
      const icon = document.createElement('span');
      icon.className = 'session-relation-kind';
      icon.textContent = '☰';
      const name = document.createElement('span');
      name.className = 'session-relation-name';
      if (running > 0) name.textContent = `Tasks · ${running} running`;
      else if (scheduled > 0) name.textContent = `Tasks · ${scheduled} scheduled`;
      else if (taskCount > 0) name.textContent = `Tasks · ${taskCount}`;
      else name.textContent = `Plan · ${planDone}/${planCount}`;
      chip.append(icon, name);
      const openTasks = options.openTasksView;
      chip.addEventListener('click', () => {
        if (owns(owner, endpoint) && owner && endpoint) openTasks(owner, endpoint, tasksData);
      }, { signal: headerEvents.signal });
      el.appendChild(chip);
    }

    if (swarmSummary && options.openSwarmView) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'session-relation-chip session-relation-swarm-link';
      chip.title = `Open Swarm board: ${swarmSummary.title} (/swarm board)`;
      if (swarmSummary.workingCount > 0) {
        const dot = document.createElement('span');
        dot.className = 'session-relation-dot working';
        chip.appendChild(dot);
      }
      const icon = document.createElement('span');
      icon.className = 'session-relation-kind';
      icon.textContent = '⬡';
      const name = document.createElement('span');
      name.className = 'session-relation-name';
      name.textContent = `Swarm · ${swarmSummary.title}`;
      chip.append(icon, name);
      const badge = document.createElement('span');
      badge.className = 'session-relation-badge';
      badge.textContent = swarmSummary.workingCount > 0
        ? `${swarmSummary.workingCount} working`
        : `#${swarmSummary.postCount}`;
      chip.appendChild(badge);
      const openSwarm = options.openSwarmView;
      chip.addEventListener('click', () => {
        if (owns(owner, endpoint) && owner && endpoint) openSwarm(owner, endpoint);
      }, { signal: headerEvents.signal });
      el.appendChild(chip);
    }
  }

  // Repoll so spawned subagents/tasks/swarms appear without a reselect; stands down once the session
  // can't gain relatives and while a takeover polls its own copy.
  function startPoll(owner: SelectionOwner, endpoint: HostEndpoint) {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (disposed || !owns(owner, endpoint) || loadInFlight) return;
      if (options.takeoverActive?.()) return;
      if (!sessionState.currentSession?.isActive && !lastIndexing && !tasksData.swarm?.active) return;
      void loadSessionRelations(owner);
    }, 4000);
  }

  async function fetchAgyTasks(owner: SelectionOwner, endpoint: HostEndpoint): Promise<SessionTasksPayload> {
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/tasks`);
      if (!res.ok) return EMPTY_TASKS;
      const payload: unknown = await res.json();
      return decodeSessionTasks(payload);
    } catch {
      return EMPTY_TASKS;
    }
  }

  async function loadSessionRelations(owner: SelectionOwner | null): Promise<void> {
    if (disposed || !owner || !sessionState.ownsSelection(owner)) return;
    const resolved = options.endpoint(owner.host);
    if (!resolved) return;
    const endpoint = Object.freeze({ ...resolved });
    const seq = ++sessionRelationsSeq;
    const isAgy = sessionState.currentSession?.harnessId === 'agy';
    clearTimeout(indexingTimer);
    loadInFlight = true;
    startPoll(owner, endpoint);
    const current = () => seq === sessionRelationsSeq && owns(owner, endpoint);
    const tasksPromise = isAgy ? fetchAgyTasks(owner, endpoint) : Promise.resolve(EMPTY_TASKS);
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/lineage`);
      const data: unknown = await res.json();
      const loadedTasks = await tasksPromise;
      if (!current()) return;
      if (!res.ok) throw new Error(record(data) && text(data.error) || `HTTP ${res.status}`);
      const indexing = record(data) && data.indexing === true;
      lastIndexing = indexing;
      lineage = decodeSessionLineage(data);
      tasksData = loadedTasks;
      options.onLineage?.(owner, lineage);
      renderRelationsLink(owner, endpoint);
      if (indexing) indexingTimer = setTimeout(() => {
        if (current()) void loadSessionRelations(owner);
      }, 1000);
    } catch (error) {
      if (current()) {
        lineage = EMPTY_LINEAGE;
        tasksData = await tasksPromise;
        renderRelationsLink(owner, endpoint);
        console.error('Failed to load session lineage:', error);
      }
    } finally {
      if (seq === sessionRelationsSeq) loadInFlight = false;
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
    get tasks() { return tasksData; },
    get hasSwarm() { return !!tasksData.swarm; },
    dispose() { clearSessionRelations(); disposed = true; },
  };
}
