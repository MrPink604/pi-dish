import { errorMessage, responseError, sameEndpoint, sendJson, setSessionModel, type ApiRequest, type HostEndpoint } from './api-client';
import { requiredElement } from './dom';
import type { SelectionOwner, SessionState } from './session-state';
import { formatRelativeTime } from './helper-format';
import { escapeHtml } from '../core/helper-format';
import { finite, record, text } from '../core/helper-values';
import { createMessageRenderer } from './message-render';
import { decodeRenderMessage } from './message-data';
import type { createResponseDetails } from './response-details';
import { decodeSessionLineage } from './session-relations';
import type { LineageNode, LineageSession, SessionLineage } from './session-relations';
import type { RenderVideoPreview } from './video-player';
import {
  EMPTY_SWARM,
  EMPTY_TASKS,
  decodeSessionSwarm,
  decodeSessionTasks,
  decodeTaskLog,
  type BackgroundTaskItem,
  type SessionSwarmPayload,
  type SessionTasksPayload,
  type SwarmBoardPost,
  type SwarmMember,
  type TaskLogPayload,
} from './agy-views-data';

export type SubagentsOpenFocus =
  | string
  | { kind: 'session'; id: string }
  | { kind: 'swarm'; member?: string }
  | { kind: 'overview' }
  | { kind: 'tasks'; taskId?: string; initialTasks?: SessionTasksPayload };

type DetailSelection =
  | { kind: 'session'; id: string }
  | { kind: 'swarm-board' }
  | { kind: 'swarm-overview' }
  | { kind: 'task'; taskId: string }
  | null;

interface SwarmModelOption {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly selector: string;
}

interface MentionCandidate {
  readonly token: string;
  readonly label: string;
  readonly meta: string;
}

interface SwarmComposer {
  root: HTMLDivElement;
  pills: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  menu: HTMLDivElement;
  status: HTMLSpanElement;
  stop: HTMLButtonElement;
  steer: HTMLButtonElement;
  send: HTMLButtonElement;
}

const DEFAULT_LOG_TAIL = 65_536;
const MAX_LOG_TAIL = 262_144;
const WORKER_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const MENTION_TRIGGER_RE = /(?:^|[\s(])@([a-z0-9_#-]*)$/i;
const MEMBER_PALETTE = ['var(--cyan)', 'var(--accent)', 'var(--success-bright)', 'var(--warning)', 'var(--orange)', 'var(--error)'];

function memberColor(name: string): string {
  if (name === 'coordinator') return 'var(--accent)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return MEMBER_PALETTE[Math.abs(hash) % MEMBER_PALETTE.length];
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeModelOptions(raw: unknown): SwarmModelOption[] {
  if (!Array.isArray(raw)) return [];
  const out: SwarmModelOption[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!record(row)) continue;
    const id = text(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const provider = text(row.provider) || 'google-antigravity';
    const selector = text(row.selector) || `${provider}/${id}`;
    out.push({ id, name: text(row.name) || id, provider, selector });
  }
  return out;
}

export function createSubagentsView(options: {
  root: HTMLElement; request: ApiRequest; sessionState: SessionState;
  endpoint: (host: string | null) => HostEndpoint | null;
  closeOtherViews: () => void; loadPrevious: () => Promise<unknown>;
  selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
  status: (message: string, kind?: string) => void;
  copy?: (text: string) => Promise<void>;
  confirm?: (message: string) => boolean;
  markdown: (text: string) => string;
  video: RenderVideoPreview;
  assetUrl: (host: string | null | undefined, path: string) => string;
  matchRef: (ref: string) => { name?: string | null; isActive?: boolean } | null | undefined;
  details: ReturnType<typeof createResponseDetails>;
}) {
  const document = options.root.ownerDocument, sessionState = options.sessionState;
  const element = requiredElement(document, 'subagents view');
  const confirmAction = options.confirm ?? ((msg: string) => (document.defaultView?.confirm(msg) ?? true));
  const copyText = options.copy ?? (async () => {});

  let disposed = false;
  let viewOwner: SelectionOwner | null = null;
  let viewEndpoint: HostEndpoint | null = null;
  let lineage: SessionLineage = decodeSessionLineage(null);
  let tasksData: SessionTasksPayload = EMPTY_TASKS;
  let swarmData: SessionSwarmPayload = EMPTY_SWARM;
  let postsBySeq = new Map<number, SwarmBoardPost>();
  let lineageSeq = 0, agySeq = 0, loadInFlight = false, lastIndexing = false;
  const collapsed = new Set<string>();
  let selection: DetailSelection = null;
  // A job row asked for this OMP/agy subagent; selected once lineage lists it.
  let pendingAgentId: string | null = null;
  let pendingSwarmMember: string | null = null;
  let showStartSwarmRow = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let indexingTimer: ReturnType<typeof setTimeout> | undefined;
  let treeEvents = new AbortController();
  let auxEvents = new AbortController();
  const events = new AbortController();
  const rapidTimers = new Set<ReturnType<typeof setTimeout>>();

  // Peek state: the selected relative's trace, loaded tail-first and caught up
  // through the after-cursor while the target stays live.
  let peekSeq = 0;
  let peekTarget: LineageSession | null = null;
  let peekLastIndex: number | null = null;
  let peekTimer: ReturnType<typeof setInterval> | undefined;

  // Task log state (when a background task is selected)
  let logSeq = 0;
  let followLog = true;
  let logTailBytes = DEFAULT_LOG_TAIL;
  let lastLogText = '';
  let lastLogTruncated = false;
  let logTimer: ReturnType<typeof setInterval> | undefined;

  // Swarm board/composer state (when Swarm Board or Add Worker is active)
  let channelFilter = 'all';
  let memberFilter: string | null = null;
  let followBoard = true;
  let boardDraft = '';
  let boardStatusText = '';
  let addDrawerOpen = false;
  let boardComposer: SwarmComposer | null = null;
  let swarmStartCard: HTMLElement | null = null;
  let tasksStdin: { taskId: string; fullTaskId: string; root: HTMLElement; input: HTMLInputElement } | null = null;
  let coordModelsForId: string | null = null;
  let coordModels: SwarmModelOption[] = [];
  let modelsLoadingForId: string | null = null;
  let mentionChoices: MentionCandidate[] = [];
  let mentionIndex = 0;

  const renderer = createMessageRenderer({
    document, sessionState, details: options.details,
    markdown: text => options.markdown(text), assetUrl: options.assetUrl, matchRef: options.matchRef,
    video: options.video,
    pinned: container => container.scrollHeight - container.scrollTop - container.clientHeight < 40,
    follow: () => true,
    scroll: container => { container.scrollTop = container.scrollHeight; },
    jump: () => {},
    peek: () => peekTarget ? { id: peekTarget.id, host: viewOwner?.host ?? null, model: peekTarget.model || null } : null,
  });

  const owns = () => !disposed && !!viewOwner && sessionState.ownsSelection(viewOwner) && sameEndpoint(options.endpoint(viewOwner.host), viewEndpoint);
  const isOpen = () => !disposed && options.root.classList.contains('subagents-open');
  const isAgy = () => sessionState.currentSession?.harnessId === 'agy';

  function clearRapidTimers() {
    for (const timer of rapidTimers) clearTimeout(timer);
    rapidTimers.clear();
  }

  function scheduleRapidRefresh(fullSwarm = false) {
    for (const delay of [800, 2200]) {
      const timer = setTimeout(() => {
        rapidTimers.delete(timer);
        if (owns() && !loadInFlight) void reloadAll(fullSwarm);
      }, delay);
      rapidTimers.add(timer);
    }
  }

  function findNode(node: LineageNode | null, match: (session: LineageSession) => boolean): LineageNode | null {
    if (!node) return null;
    if (match(node.session)) return node;
    for (const child of node.children) { const hit = findNode(child, match); if (hit) return hit; }
    return null;
  }

  function swarmMemberForSession(sessionId: string | null): SwarmMember | null {
    if (!sessionId || !swarmData.hasSwarm) return null;
    return swarmData.members.find(m => m.routeId === sessionId) ?? null;
  }

  function selectedTask(): BackgroundTaskItem | null {
    const sel = selection;
    if (sel?.kind !== 'task') return null;
    return tasksData.tasks.find(t => t.id === sel.taskId) ?? null;
  }

  function sortedPosts(): SwarmBoardPost[] {
    return [...postsBySeq.values()].sort((a, b) => a.seq - b.seq);
  }

  function preferredCoordDelivery(): 'prompt' | 'steer' {
    return swarmData.coordinatorTurnInProgress ? 'steer' : 'prompt';
  }

  /** Select the requested subagent once a lineage load includes it; report it missing once loading settles. */
  function focusPendingAgent() {
    if (pendingSwarmMember && swarmData.hasSwarm) {
      const m = swarmData.members.find(x => x.name === pendingSwarmMember);
      if (m?.routeId) {
        pendingSwarmMember = null;
        const node = findNode(lineage.tree, s => s.id === m.routeId);
        if (node) { selectNode(node.session.id); return; }
      }
    }
    if (!pendingAgentId) return;
    const agentId = pendingAgentId;
    const node = findNode(lineage.tree, session => session.agentId === agentId || session.id === agentId);
    if (node) { pendingAgentId = null; selectNode(node.session.id); return; }
    if (!loadInFlight && !lastIndexing) { pendingAgentId = null; options.status(`Subagent run ${agentId} is not indexed yet`, 'error'); }
  }

  function open(owner: SelectionOwner, endpoint: HostEndpoint, initial: SessionLineage, focus?: SubagentsOpenFocus) {
    if (disposed || !sessionState.ownsSelection(owner)) return;
    close(); options.closeOtherViews();
    viewOwner = owner; viewEndpoint = Object.freeze({ ...endpoint });
    lineage = initial.tree ? initial : decodeSessionLineage(null);
    tasksData = (typeof focus === 'object' && focus.kind === 'tasks' && focus.initialTasks?.supported) ? focus.initialTasks : EMPTY_TASKS;
    swarmData = EMPTY_SWARM;
    postsBySeq = new Map();
    lastIndexing = false; selection = null; peekTarget = null; peekLastIndex = null;
    pendingAgentId = null; pendingSwarmMember = null; showStartSwarmRow = false;
    channelFilter = 'all'; memberFilter = null; followBoard = true; boardDraft = ''; boardStatusText = '';
    addDrawerOpen = false; coordModelsForId = null; coordModels = []; modelsLoadingForId = null;
    mentionChoices = []; mentionIndex = 0;
    followLog = true; logTailBytes = DEFAULT_LOG_TAIL; lastLogText = ''; lastLogTruncated = false;
    collapsed.clear();

    if (typeof focus === 'string' && focus) {
      pendingAgentId = focus;
    } else if (typeof focus === 'object' && focus) {
      if (focus.kind === 'session') pendingAgentId = focus.id;
      else if (focus.kind === 'swarm') {
        showStartSwarmRow = true;
        if (focus.member) pendingSwarmMember = focus.member;
        else selection = { kind: 'swarm-board' };
      } else if (focus.kind === 'overview') {
        selection = { kind: 'swarm-overview' };
      } else if (focus.kind === 'tasks') {
        const firstTask = focus.taskId || tasksData.tasks[0]?.id || null;
        if (firstTask) selection = { kind: 'task', taskId: firstTask };
      }
    }

    element('subagentsViewNote').textContent = lineage.session?.name ? `Family of ${lineage.session.name}` : '';
    options.root.classList.add('subagents-open');
    renderAll();
    if (selection?.kind === 'task') void loadTaskLog(selection.taskId, true);
    void reloadAll(true);
    focusPendingAgent();
    pollTimer = setInterval(() => {
      if (!owns() || loadInFlight) return;
      if (!sessionState.currentSession?.isActive && !lastIndexing && !tasksData.isActive && !swarmData.isActive) return;
      void reloadAll(false);
    }, isAgy() ? 2500 : 4000);
  }

  function close() {
    if (!isOpen()) return;
    lineageSeq++; agySeq++; peekSeq++; logSeq++;
    clearInterval(pollTimer); pollTimer = undefined;
    clearInterval(peekTimer); peekTimer = undefined;
    clearInterval(logTimer); logTimer = undefined;
    clearTimeout(indexingTimer);
    clearRapidTimers();
    treeEvents.abort();
    auxEvents.abort();
    boardComposer = null;
    swarmStartCard = null;
    tasksStdin = null;
    addDrawerOpen = false;
    element('subagentsAddDrawer').style.display = 'none';
    element('subagentsAddWorkerBtn').style.display = 'none';
    element('subagentsAuxPanel').style.display = 'none';
    element('subagentsAuxPanel').replaceChildren();
    const trace = element('subagentsTrace');
    delete trace.dataset.videoSessionId;
    delete trace.dataset.videoHost;
    mentionChoices = []; mentionIndex = 0;
    viewOwner = null; viewEndpoint = null; peekTarget = null; selection = null;
    pendingAgentId = null; pendingSwarmMember = null; showStartSwarmRow = false;
    lastLogText = ''; lastLogTruncated = false;
    options.root.classList.remove('subagents-open');
  }

  function dismissOverlay(): boolean {
    if (mentionChoices.length) {
      hideMentionMenu();
      return true;
    }
    if (addDrawerOpen) {
      setAddDrawerOpen(false);
      return true;
    }
    return false;
  }

  async function reloadAll(fullSwarm: boolean) {
    if (!owns()) return;
    if (isAgy()) {
      await Promise.all([loadLineage(), loadAgyExtras(fullSwarm)]);
    } else {
      await loadLineage();
    }
  }

  async function loadLineage() {
    if (!owns() || !viewOwner || !viewEndpoint) return;
    const owner = viewOwner, endpoint = viewEndpoint, seq = ++lineageSeq;
    clearTimeout(indexingTimer);
    loadInFlight = true;
    const current = () => seq === lineageSeq && owns() && viewOwner === owner;
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/lineage`);
      const data: unknown = await res.json();
      if (!current()) return;
      if (!res.ok) throw new Error(responseError(res, data));
      lastIndexing = record(data) && data.indexing === true;
      lineage = decodeSessionLineage(data);
      const sel = selection;
      if (sel?.kind === 'session') {
        const node = findNode(lineage.tree, session => session.id === sel.id);
        peekTarget = node?.session || null;
      }
      renderAll();
      if (selection?.kind === 'session') syncPeekTimer();
      if (lastIndexing) indexingTimer = setTimeout(() => { if (current()) void loadLineage(); }, 1000);
    } catch (error) {
      if (current()) console.error('Failed to load session lineage:', error);
    } finally {
      loadInFlight = false;
      if (current()) focusPendingAgent();
    }
  }

  async function loadAgyExtras(fullSwarm: boolean) {
    if (!owns() || !viewOwner || !viewEndpoint || !isAgy()) return;
    const owner = viewOwner, endpoint = viewEndpoint, seq = ++agySeq;
    const current = () => seq === agySeq && owns() && viewOwner === owner;
    const since = !fullSwarm && swarmData.head > 0 ? `?since=${swarmData.head}` : '';
    try {
      const [tasksRes, swarmRes] = await Promise.all([
        options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/tasks`),
        options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/swarm${since}`),
      ]);
      const tasksJson: unknown = tasksRes.ok ? await tasksRes.json() : null;
      const swarmJson: unknown = swarmRes.ok ? await swarmRes.json() : null;
      if (!current()) return;
      if (tasksJson) tasksData = decodeSessionTasks(tasksJson);
      if (swarmJson) {
        const nextSwarm = decodeSessionSwarm(swarmJson);
        if (fullSwarm) postsBySeq.clear();
        for (const post of nextSwarm.posts) postsBySeq.set(post.seq, post);
        swarmData = nextSwarm;
      }
      // If opened via /tasks before initial tasks arrived, select the first task automatically.
      const sel = selection;
      if (sel?.kind === 'task' && !tasksData.tasks.some(t => t.id === sel.taskId)) {
        selection = tasksData.tasks[0] ? { kind: 'task', taskId: tasksData.tasks[0].id } : null;
        logTailBytes = DEFAULT_LOG_TAIL;
      }
      renderAll();
      if (selection?.kind === 'task') {
        syncLogTimer();
        void loadTaskLog(selection.taskId, false);
      }
      if (swarmData.hasSwarm && swarmData.isActive && coordModelsForId !== swarmData.coordinatorId) {
        void loadCoordinatorModels();
      }
      focusPendingAgent();
    } catch (error) {
      if (current()) console.error('Failed to load Antigravity tasks/swarm:', error);
    }
  }

  async function loadCoordinatorModels() {
    if (!owns() || !viewEndpoint || !swarmData.coordinatorId || !swarmData.isActive) return;
    const coordId = swarmData.coordinatorId;
    if (coordModelsForId === coordId || modelsLoadingForId === coordId) return;
    const endpoint = viewEndpoint, owner = viewOwner;
    modelsLoadingForId = coordId;
    try {
      const res = await options.request(endpoint, `/api/models?sessionId=${encodeURIComponent(coordId)}`);
      const payload: unknown = await res.json();
      if (!owns() || viewOwner !== owner || swarmData.coordinatorId !== coordId) return;
      if (!res.ok) return;
      coordModels = decodeModelOptions(payload);
      coordModelsForId = coordId;
      populateAddModelSelect();
      renderDetail();
    } catch { /* Model switcher stays hidden if catalog is unavailable. */ }
    finally {
      if (modelsLoadingForId === coordId) modelsLoadingForId = null;
    }
  }

  function renderAll() {
    if (!owns() || !isOpen()) return;
    const agy = isAgy();
    const canManageSwarm = agy && swarmData.hasSwarm && swarmData.isActive;
    element('subagentsAddWorkerBtn').style.display = canManageSwarm ? '' : 'none';
    if (!canManageSwarm && addDrawerOpen) setAddDrawerOpen(false);
    else if (addDrawerOpen) populateAddForkSelect();

    const titleEl = element('subagentsViewTitle');
    titleEl.textContent = agy && swarmData.hasSwarm ? `Subagents · ${swarmData.title}` : 'Subagents';

    const noteBits: string[] = [];
    if (lineage.session?.name) noteBits.push(`Family of ${lineage.session.name}`);
    if (agy && swarmData.hasSwarm) {
      const working = swarmData.members.filter(m => m.state === 'working').length;
      if (working) noteBits.push(`${working} working`);
      noteBits.push(`${swarmData.head} post${swarmData.head === 1 ? '' : 's'}`);
    }
    if (agy && tasksData.tasks.length) {
      const running = tasksData.tasks.filter(t => t.status === 'running').length;
      noteBits.push(running ? `${running} running task${running === 1 ? '' : 's'}` : `${tasksData.tasks.length} task${tasksData.tasks.length === 1 ? '' : 's'}`);
    }
    element('subagentsViewNote').textContent = noteBits.join(' · ');

    renderTree();
    renderDetail();
  }

  function renderTree() {
    if (!owns() || !isOpen()) return;
    treeEvents.abort(); treeEvents = new AbortController();
    const body = element('subagentsTree');
    body.replaceChildren();
    const agy = isAgy();
    const tree = lineage.tree;

    const swarmByRoute = new Map<string, SwarmMember>(swarmData.members.map(m => [m.routeId, m]));

    // 1. Family tree (exact existing UX for Pi/OMP/Prime + agy sessions/subagents/workers)
    if (tree) {
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
        const member = agy ? swarmByRoute.get(target.id) : undefined;
        const row = document.createElement('div');
        row.className = 'lineage-row';
        row.style.setProperty('--depth', String(depth));
        row.dataset.sessionId = target.id;
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.title = target.cwd || target.id;
        if (target.id === currentId) row.classList.add('lineage-current');
        if (selection?.kind === 'session' && selection.id === target.id) row.classList.add('lineage-selected');

        const twisty = document.createElement('span');
        twisty.className = 'lineage-twisty';
        if (node.children.length) {
          const isCollapsed = collapsed.has(target.id);
          twisty.textContent = isCollapsed ? '▸' : '▾';
          twisty.title = isCollapsed ? 'Expand subtree' : 'Collapse subtree';
          twisty.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!owns()) return;
            if (collapsed.has(target.id)) collapsed.delete(target.id); else collapsed.add(target.id);
            renderTree();
          }, { signal: treeEvents.signal });
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
        if (member) name.style.color = memberColor(member.name);
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
        if (member && member.state === 'killed') {
          const badge = document.createElement('span');
          badge.className = 'lineage-badge';
          badge.textContent = 'killed';
          row.appendChild(badge);
        } else if (target.turnInProgress || member?.state === 'working') {
          const badge = document.createElement('span');
          badge.className = 'lineage-badge lineage-busy';
          badge.textContent = 'working';
          badge.title = 'A turn is in progress';
          row.appendChild(badge);
        } else if (member && member.state === 'waiting') {
          const badge = document.createElement('span');
          badge.className = 'lineage-badge';
          badge.textContent = 'waiting';
          row.appendChild(badge);
        }
        if (target.id === currentId) {
          const badge = document.createElement('span');
          badge.className = 'lineage-badge lineage-current-badge';
          badge.textContent = 'current';
          row.appendChild(badge);
        }
        const meta = document.createElement('span');
        meta.className = 'lineage-meta';
        meta.textContent = formatRelativeTime(target.lastActivity);
        row.appendChild(meta);

        const activate = () => { if (owns()) selectNode(target.id); };
        row.addEventListener('click', activate, { signal: treeEvents.signal });
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          activate();
        }, { signal: treeEvents.signal });
        body.appendChild(row);
      }
      if (lineage.truncated) {
        const note = document.createElement('div');
        note.className = 'lineage-truncated';
        note.textContent = 'This family is too large to show in full — the tree is truncated.';
        body.appendChild(note);
      }
    } else if (!agy || (!swarmData.hasSwarm && !tasksData.tasks.length && !tasksData.plan.length && !showStartSwarmRow)) {
      const empty = document.createElement('div');
      empty.className = 'subagents-state';
      empty.textContent = 'No related sessions.';
      body.appendChild(empty);
      return;
    }

    if (!agy) return;

    // 2. Swarm section (only for agy sessions with a swarm or when opened via /swarm board)
    if (swarmData.hasSwarm || showStartSwarmRow || selection?.kind === 'swarm-board' || selection?.kind === 'swarm-overview') {
      const sec = document.createElement('div');
      sec.className = 'subagents-tree-section';
      const head = document.createElement('div');
      head.className = 'subagents-tree-section-title';
      head.textContent = swarmData.hasSwarm ? `Swarm · ${swarmData.title}` : 'Swarm';
      sec.appendChild(head);

      const makeRow = (label: string, badgeText: string, selected: boolean, onClick: () => void, attr: string) => {
        const row = document.createElement('div');
        row.className = `lineage-row${selected ? ' lineage-selected' : ''}`;
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.dataset.subagentsAux = attr;
        const name = document.createElement('span');
        name.className = 'lineage-name';
        name.textContent = label;
        row.appendChild(name);
        if (badgeText) {
          const badge = document.createElement('span');
          badge.className = 'lineage-badge';
          badge.textContent = badgeText;
          row.appendChild(badge);
        }
        row.addEventListener('click', onClick, { signal: treeEvents.signal });
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onClick();
        }, { signal: treeEvents.signal });
        return row;
      };

      sec.appendChild(makeRow(
        swarmData.hasSwarm ? '⬡ Board' : '⬡ Start Swarm',
        swarmData.hasSwarm ? `#${swarmData.head}` : '',
        selection?.kind === 'swarm-board',
        () => selectSwarmBoard(),
        'swarm-board',
      ));

      if (swarmData.hasSwarm) {
        sec.appendChild(makeRow(
          '◈ Overview',
          '',
          selection?.kind === 'swarm-overview',
          () => selectSwarmOverview(),
          'swarm-overview',
        ));
      }
      body.appendChild(sec);
    }

    // 3. Background tasks section (only for agy sessions with tasks)
    if (tasksData.tasks.length) {
      const sec = document.createElement('div');
      sec.className = 'subagents-tree-section';
      const head = document.createElement('div');
      head.className = 'subagents-tree-section-title';
      head.textContent = `Background tasks (${tasksData.tasks.length})`;
      sec.appendChild(head);

      for (const task of tasksData.tasks) {
        const row = document.createElement('div');
        row.className = `lineage-row${selection?.kind === 'task' && selection.taskId === task.id ? ' lineage-selected' : ''}`;
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.dataset.taskId = task.id;
        if (task.status === 'running' || task.status === 'scheduled') {
          const dot = document.createElement('span');
          dot.className = `tasks-dot ${task.status}`;
          row.appendChild(dot);
        }
        const name = document.createElement('span');
        name.className = 'lineage-name';
        name.textContent = task.title;
        row.appendChild(name);
        const badge = document.createElement('span');
        badge.className = `lineage-badge${task.status === 'running' ? ' lineage-busy' : ''}`;
        badge.textContent = task.exitCode !== null && task.exitCode !== 0 ? `exit ${task.exitCode}` : task.status;
        row.appendChild(badge);
        if (task.startedAt) {
          const meta = document.createElement('span');
          meta.className = 'lineage-meta';
          meta.textContent = formatRelativeTime(task.startedAt);
          row.appendChild(meta);
        }
        const activate = () => selectTask(task.id);
        row.addEventListener('click', activate, { signal: treeEvents.signal });
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          activate();
        }, { signal: treeEvents.signal });
        sec.appendChild(row);
      }
      body.appendChild(sec);
    }

    // 4. Plan checklist (only for agy sessions with plan entries)
    if (tasksData.plan.length) {
      const sec = document.createElement('div');
      sec.className = 'subagents-tree-section';
      const done = tasksData.plan.filter(p => p.status === 'completed').length;
      const head = document.createElement('div');
      head.className = 'subagents-tree-section-title';
      head.textContent = `Plan (${done}/${tasksData.plan.length})`;
      sec.appendChild(head);
      for (const item of tasksData.plan) {
        const row = document.createElement('div');
        row.className = `tasks-plan-row status-${item.status}`;
        const mark = document.createElement('span');
        mark.className = 'tasks-plan-mark';
        mark.textContent = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '▸' : '○';
        const textEl = document.createElement('span');
        textEl.className = 'tasks-plan-text';
        textEl.textContent = item.content;
        row.append(mark, textEl);
        sec.appendChild(row);
      }
      body.appendChild(sec);
    }
  }

  function selectNode(id: string) {
    if (!owns()) return;
    clearInterval(logTimer); logTimer = undefined;
    selection = { kind: 'session', id };
    peekTarget = findNode(lineage.tree, session => session.id === id)?.session || null;
    renderTree(); renderDetail();
    void loadPeek(true);
    syncPeekTimer();
  }

  function selectSwarmBoard() {
    if (!owns()) return;
    clearInterval(peekTimer); peekTimer = undefined;
    clearInterval(logTimer); logTimer = undefined;
    selection = { kind: 'swarm-board' };
    peekTarget = null;
    renderTree(); renderDetail();
  }

  function selectSwarmOverview() {
    if (!owns()) return;
    clearInterval(peekTimer); peekTimer = undefined;
    clearInterval(logTimer); logTimer = undefined;
    selection = { kind: 'swarm-overview' };
    peekTarget = null;
    renderTree(); renderDetail();
  }

  function selectTask(taskId: string) {
    if (!owns()) return;
    clearInterval(peekTimer); peekTimer = undefined;
    selection = { kind: 'task', taskId };
    peekTarget = null;
    followLog = true;
    logTailBytes = DEFAULT_LOG_TAIL;
    lastLogText = '';
    lastLogTruncated = false;
    renderTree(); renderDetail();
    syncLogTimer();
    void loadTaskLog(taskId, true);
  }

  function jumpToPost(seq: number) {
    if (!owns()) return;
    channelFilter = 'all';
    memberFilter = null;
    followBoard = false;
    selectSwarmBoard();
    const target = element('subagentsAuxPanel').querySelector<HTMLElement>(`[data-post-seq="${seq}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('swarm-post-highlight');
      setTimeout(() => target.classList.remove('swarm-post-highlight'), 1800);
    }
  }

  // ---- Right pane dispatcher ------------------------------------------------

  function renderDetail() {
    const empty = element('subagentsDetailEmpty');
    const content = element('subagentsDetailContent');
    const aux = element('subagentsAuxPanel');

    if (selection?.kind === 'swarm-board') {
      tasksStdin = null;
      empty.style.display = 'none';
      content.style.display = 'none';
      aux.style.display = 'flex';
      renderSwarmBoardPanel(aux);
      return;
    }
    if (boardComposer) {
      hideMentionMenu();
      boardComposer = null;
    }
    swarmStartCard = null;
    if (selection?.kind === 'swarm-overview') {
      tasksStdin = null;
      empty.style.display = 'none';
      content.style.display = 'none';
      aux.style.display = 'flex';
      renderSwarmOverviewPanel(aux);
      return;
    }
    if (selection?.kind === 'task') {
      empty.style.display = 'none';
      content.style.display = 'none';
      aux.style.display = 'flex';
      renderTaskDetailPanel(aux);
      return;
    }
    tasksStdin = null;

    aux.style.display = 'none';
    auxEvents.abort();
    if (aux.hasChildNodes()) aux.replaceChildren();
    const target = peekTarget;
    if (selection?.kind !== 'session' || !target) {
      empty.style.display = '';
      content.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    content.style.display = 'flex';
    element('subagentsDetailName').textContent = target.name || target.id.slice(0, 8);
    const member = isAgy() ? swarmMemberForSession(target.id) : null;
    const live = member ? member.state : (target.isActive ? 'live' : target.subagentLive ? 'live in parent' : 'ended');
    element('subagentsDetailMeta').textContent =
      [target.harnessId, (member?.model || (target.model !== 'unknown' ? target.model : '')), member && member.workspaceMode !== 'inherit' ? member.workspaceMode : '', live, formatRelativeTime(target.lastActivity)].filter(Boolean).join(' · ');

    // Swarm member inline controls (hidden for non-agy or non-swarm sessions)
    const isSwarmLive = !!member && swarmData.isActive && member.state !== 'killed';
    const isCoord = member?.name === 'coordinator';
    const modelSel = element<HTMLSelectElement>('subagentsMemberModelSelect');
    if (isSwarmLive && coordModels.length > 0 && member) {
      modelSel.style.display = '';
      modelSel.replaceChildren();
      const ids = new Set(coordModels.map(m => m.id));
      if (member.model && !ids.has(member.model)) {
        const cur = document.createElement('option');
        cur.value = member.model; cur.textContent = member.model;
        modelSel.appendChild(cur);
      }
      for (const m of coordModels) {
        const opt = document.createElement('option');
        opt.value = m.id; opt.textContent = m.name || m.id;
        modelSel.appendChild(opt);
      }
      if (member.model) modelSel.value = member.model;
      const locked = !isCoord && member.state === 'working';
      modelSel.disabled = locked;
      modelSel.title = locked ? 'Model switch is only available while worker is waiting' : (isCoord ? 'Switch coordinator model' : `Switch @${member.name} model`);
    } else {
      modelSel.style.display = 'none';
    }
    element('subagentsCoordStopBtn').style.display = isSwarmLive && isCoord && swarmData.coordinatorTurnInProgress ? '' : 'none';
    const pingBtn = element<HTMLButtonElement>('subagentsMemberPingBtn');
    const canPing = isSwarmLive && !isCoord && member!.state !== 'working';
    pingBtn.style.display = canPing ? '' : 'none';
    if (canPing && member) {
      const isMonitor = /^monitor(?:-\d+)?$/.test(member.name);
      pingBtn.textContent = isMonitor || member.state === 'stopped' ? 'Resume' : 'Ping';
      pingBtn.title = isMonitor ? `Post @${member.name} resume` : `Nudge @${member.name} for an update`;
    }
    element('subagentsMemberKillBtn').style.display = isSwarmLive && !isCoord ? '' : 'none';

    const caps = target.capabilities;
    const swarmRoutableWorker = isSwarmLive && !isCoord;
    const canPrompt = (target.isActive && caps?.prompt === true) || swarmRoutableWorker;
    const canSteer = (target.isActive && caps?.steer === true) || swarmRoutableWorker;
    const canFollowUp = target.isActive && caps?.followUp === true;
    const signalable = canPrompt || canSteer || canFollowUp;
    const box = element('subagentsSignalBox'), note = element('subagentsSignalNote');
    box.style.display = signalable ? '' : 'none';
    note.style.display = signalable ? 'none' : '';
    const signalInput = element<HTMLTextAreaElement>('subagentsSignalInput');
    signalInput.placeholder = swarmRoutableWorker && member
      ? `Message @${member.name} via coordinator… (Enter to send)`
      : 'Message this session… (Enter to send)';
    if (!signalable) {
      note.textContent = !target.isActive && !target.subagentLive
        ? 'This session has ended — open it to resume or branch from it.'
        : target.subagentLive && !target.isActive
          ? 'A native subagent of a live parent — pi-dish has no direct control path to it.'
          : 'This session is not accepting input.';
    }
    element<HTMLButtonElement>('subagentsSendBtn').style.display = canPrompt ? '' : 'none';
    element<HTMLButtonElement>('subagentsSteerBtn').style.display = canSteer ? '' : 'none';
    element<HTMLButtonElement>('subagentsFollowUpBtn').style.display = canFollowUp ? '' : 'none';
    element('subagentsSignalStatus').textContent = '';
  }

  // ---- Coordinator / Swarm actions -----------------------------------------

  async function dispatchCoordinatorText(
    message: string,
    mode: 'prompt' | 'steer' | 'auto' = 'auto',
    opts: { fullReload?: boolean; successText?: string } = {},
  ): Promise<boolean> {
    if (!owns() || !viewEndpoint || !swarmData.coordinatorId) return false;
    const trimmed = message.trim();
    if (!trimmed) return false;
    const kind = mode === 'auto' ? preferredCoordDelivery() : mode;
    const endpoint = viewEndpoint, coordId = swarmData.coordinatorId;
    boardStatusText = kind === 'steer' ? 'Steering coordinator…' : 'Sending to coordinator…';
    const liveStatus = document.getElementById('swarmPromptStatus');
    if (liveStatus) liveStatus.textContent = boardStatusText;
    try {
      await sendJson(options.request, endpoint, `/api/sessions/${encodeURIComponent(coordId)}/${kind}`, { message: trimmed });
      if (!owns()) return false;
      const doneText = opts.successText || (kind === 'steer' ? 'Steered coordinator' : 'Sent to coordinator');
      boardStatusText = doneText;
      if (liveStatus) liveStatus.textContent = doneText;
      options.status(doneText, 'success');
      scheduleRapidRefresh(opts.fullReload === true);
      return true;
    } catch (error) {
      if (owns()) {
        const msg = errorMessage(error);
        boardStatusText = msg;
        if (liveStatus) liveStatus.textContent = msg;
        options.status(msg, 'error');
      }
      return false;
    }
  }

  async function abortCoordinatorTurn() {
    if (!owns() || !viewEndpoint || !swarmData.coordinatorId) return;
    const endpoint = viewEndpoint, coordId = swarmData.coordinatorId;
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(coordId)}/abort`, { method: 'POST' });
      const payload: unknown = await res.json().catch(() => ({}));
      if (!owns()) return;
      if (!res.ok) throw new Error(responseError(res, payload));
      boardStatusText = 'Stop requested';
      const liveStatus = document.getElementById('swarmPromptStatus');
      if (liveStatus) liveStatus.textContent = boardStatusText;
      options.status('Coordinator turn stop requested', 'success');
      scheduleRapidRefresh(false);
    } catch (error) {
      if (owns()) options.status(errorMessage(error), 'error');
    }
  }

  async function switchMemberModel(member: SwarmMember, modelId: string) {
    if (!owns() || !viewEndpoint || !swarmData.coordinatorId || !modelId || modelId === member.model) return;
    if (member.name === 'coordinator') {
      const chosen = coordModels.find(m => m.id === modelId);
      const selector = chosen?.selector || `${chosen?.provider || 'google-antigravity'}/${modelId}`;
      const endpoint = viewEndpoint, coordId = swarmData.coordinatorId;
      try {
        await setSessionModel(options.request, endpoint, coordId, selector);
        if (!owns()) return;
        options.status(`Switched coordinator model to ${chosen?.name || modelId}`, 'success');
        scheduleRapidRefresh(false);
      } catch (error) {
        if (owns()) {
          options.status(`Model switch failed: ${errorMessage(error)}`, 'error');
          renderDetail();
        }
      }
      return;
    }
    if (member.state === 'working') {
      options.status(`@${member.name} must be waiting before switching models`, 'error');
      renderDetail();
      return;
    }
    const ok = await dispatchCoordinatorText(
      `Switch swarm worker "${member.name}" to model "${modelId}" using swarm(action:"model", name:${JSON.stringify(member.name)}, model:${JSON.stringify(modelId)}).`,
      'auto',
      { successText: `Requested model ${modelId} for @${member.name}` },
    );
    if (!ok && owns()) renderDetail();
  }

  async function pingMember(member: SwarmMember) {
    if (!owns() || member.name === 'coordinator' || member.state === 'killed') return;
    const isMonitor = /^monitor(?:-\d+)?$/.test(member.name);
    const body = isMonitor
      ? `Post "@${member.name} resume" on the swarm board to resume monitoring.`
      : `Post a status check to @${member.name} on the swarm board asking for a brief progress update.`;
    await dispatchCoordinatorText(body, 'auto', {
      successText: isMonitor ? `Resuming @${member.name}` : `Pinged @${member.name}`,
    });
  }

  async function killMember(member: SwarmMember) {
    if (!owns() || member.name === 'coordinator' || member.state === 'killed') return;
    const warnings: string[] = [
      `Permanently kill @${member.name}? Killed workers cannot be revived and their name cannot be reused.`,
    ];
    if (member.workspaceMode === 'share' || member.workspaceMode === 'branch') {
      warnings.push(`WARNING: This will DELETE @${member.name}'s "${member.workspaceMode}" workspace! Make sure its changes are landed first.`);
    }
    if (/^(?:narrator|monitor)(?:-\d+)?$/.test(member.name)) {
      warnings.push(`Note: @${member.name} is a swarm support worker.`);
    }
    if (!confirmAction(warnings.join('\n\n'))) return;
    await dispatchCoordinatorText(
      `Kill swarm worker "${member.name}" using swarm(action:"kill", name:${JSON.stringify(member.name)}).`,
      'auto',
      { successText: `Requested kill for @${member.name}` },
    );
  }

  // ---- Add worker drawer ---------------------------------------------------

  function populateAddModelSelect() {
    const select = element<HTMLSelectElement>('subagentsAddModel');
    const prev = select.value;
    select.replaceChildren();
    const def = document.createElement('option');
    def.value = ''; def.textContent = 'Coordinator default';
    select.appendChild(def);
    for (const m of coordModels) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name !== m.id ? `${m.name} (${m.id})` : m.id;
      select.appendChild(opt);
    }
    if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
  }

  function populateAddForkSelect() {
    const select = element<HTMLSelectElement>('subagentsAddFork');
    const prev = select.value;
    select.replaceChildren();
    const fresh = document.createElement('option');
    fresh.value = ''; fresh.textContent = 'Fresh conversation';
    select.appendChild(fresh);
    for (const m of swarmData.members) {
      if (m.state === 'killed') continue;
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name === 'coordinator' ? 'coordinator' : `@${m.name}`;
      select.appendChild(opt);
    }
    if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
  }

  function setAddDrawerOpen(openState: boolean) {
    addDrawerOpen = openState && swarmData.hasSwarm && swarmData.isActive;
    const drawer = element('subagentsAddDrawer');
    drawer.style.display = addDrawerOpen ? 'flex' : 'none';
    element('subagentsAddError').textContent = '';
    if (addDrawerOpen) {
      populateAddModelSelect();
      populateAddForkSelect();
      if (coordModelsForId !== swarmData.coordinatorId) void loadCoordinatorModels();
      element<HTMLInputElement>('subagentsAddName').focus();
    }
  }

  async function submitAddWorker() {
    if (!owns() || !swarmData.hasSwarm || !swarmData.isActive) return;
    const nameEl = element<HTMLInputElement>('subagentsAddName');
    const briefEl = element<HTMLTextAreaElement>('subagentsAddBrief');
    const modelEl = element<HTMLSelectElement>('subagentsAddModel');
    const wsEl = element<HTMLSelectElement>('subagentsAddWorkspace');
    const forkEl = element<HTMLSelectElement>('subagentsAddFork');
    const errEl = element('subagentsAddError');

    const name = nameEl.value.trim().toLowerCase();
    const brief = briefEl.value.trim();
    const model = modelEl.value.trim();
    const workspace = wsEl.value || 'inherit';
    const fork = forkEl.value.trim();

    if (!WORKER_NAME_RE.test(name)) {
      errEl.textContent = 'Name must be lowercase letters/digits/-/_ (1–24 chars, starting with a-z or 0-9).';
      nameEl.focus();
      return;
    }
    if (name === 'all' || name === 'coordinator' || name.startsWith('coordinator-')) {
      errEl.textContent = `"${name}" is a reserved swarm name.`;
      nameEl.focus();
      return;
    }
    if (swarmData.members.some(m => m.name.toLowerCase() === name)) {
      errEl.textContent = `"@${name}" already exists (or was previously killed) in this swarm.`;
      nameEl.focus();
      return;
    }
    if (!brief) {
      errEl.textContent = 'Enter a brief describing what this worker owns.';
      briefEl.focus();
      return;
    }
    errEl.textContent = '';

    const params = [`action:"add"`, `name:${JSON.stringify(name)}`, `workspace:${JSON.stringify(workspace)}`];
    if (model) params.push(`model:${JSON.stringify(model)}`);
    if (fork) params.push(`fork:${JSON.stringify(fork)}`);
    params.push(`brief:${JSON.stringify(brief)}`);

    const ok = await dispatchCoordinatorText(`Add a new swarm worker using swarm(${params.join(', ')}).`, 'auto', {
      successText: `Spawning @${name}…`,
    });
    if (ok && owns()) {
      nameEl.value = '';
      briefEl.value = '';
      setAddDrawerOpen(false);
    }
  }

  // ---- Swarm Board & Overview panels inside #subagentsAuxPanel -------------

  function hideMentionMenu() {
    mentionChoices = [];
    mentionIndex = 0;
    const menu = document.getElementById('swarmMentionMenu');
    if (menu) { menu.style.display = 'none'; menu.replaceChildren(); }
  }

  function buildMentionCandidates(query: string): MentionCandidate[] {
    const q = query.toLowerCase();
    const out: MentionCandidate[] = [];
    for (const m of swarmData.members) {
      if (m.state === 'killed') continue;
      if (!q || m.name.toLowerCase().includes(q)) out.push({ token: m.name, label: `@${m.name}`, meta: m.state });
    }
    if (!q || 'all'.includes(q)) out.push({ token: 'all', label: '@all', meta: 'broadcast' });
    for (const ch of swarmData.channels) {
      if (ch.name === 'main' || ch.archived) continue;
      const chToken = `#${ch.name}`;
      if (!q || chToken.toLowerCase().includes(q) || ch.name.toLowerCase().includes(q)) {
        out.push({ token: chToken, label: `@${chToken}`, meta: ch.topic || 'channel' });
      }
    }
    return out.slice(0, 10);
  }

  function renderMentionMenu(input: HTMLTextAreaElement, menu: HTMLElement) {
    menu.replaceChildren();
    if (!mentionChoices.length) { menu.style.display = 'none'; return; }
    mentionIndex = Math.max(0, Math.min(mentionIndex, mentionChoices.length - 1));
    menu.style.display = 'flex';
    mentionChoices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `swarm-mention-option${idx === mentionIndex ? ' active' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(idx === mentionIndex));
      const label = document.createElement('span'); label.textContent = choice.label;
      const meta = document.createElement('span'); meta.className = 'swarm-mention-option-meta'; meta.textContent = choice.meta;
      btn.append(label, meta);
      btn.addEventListener('mousedown', (event) => {
        event.preventDefault();
        acceptMentionChoice(input, choice.token);
      });
      menu.appendChild(btn);
    });
  }

  function acceptMentionChoice(input: HTMLTextAreaElement, token: string) {
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    const after = input.value.slice(caret);
    if (!MENTION_TRIGGER_RE.test(before)) {
      insertMentionToken(input, token);
      return;
    }
    const atPos = before.lastIndexOf('@');
    const nextBefore = `${before.slice(0, atPos)}@${token} `;
    input.value = `${nextBefore}${after}`;
    boardDraft = input.value;
    input.focus();
    input.setSelectionRange(nextBefore.length, nextBefore.length);
    hideMentionMenu();
  }

  function insertMentionToken(input: HTMLTextAreaElement, token: string) {
    const insert = `@${token} `;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const prefix = before.length > 0 && !/[\s(]$/.test(before) ? ' ' : '';
    input.value = `${before}${prefix}${insert}${after}`;
    boardDraft = input.value;
    const caret = before.length + prefix.length + insert.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    hideMentionMenu();
  }

  function renderSwarmBoardPanel(container: HTMLElement) {
    auxEvents.abort();
    auxEvents = new AbortController();
    const prevFeed = container.querySelector<HTMLElement>('#swarmBoardFeed');
    const wasPinned = !prevFeed || prevFeed.scrollHeight - prevFeed.scrollTop - prevFeed.clientHeight < 60;
    const prevScroll = prevFeed?.scrollTop ?? 0;
    if (!swarmData.hasSwarm || !swarmData.isActive) {
      hideMentionMenu();
      boardComposer = null;
    }
    if (swarmData.hasSwarm || !swarmData.isActive) {
      swarmStartCard = null;
    }
    const keepStartCard = !swarmData.hasSwarm && swarmData.isActive ? swarmStartCard : null;
    const composer = boardComposer?.root ?? null;
    // Keep any live composer or start-swarm card attached while replacing read-only neighbors.
    for (const child of Array.from(container.children)) {
      if (child !== composer && child !== keepStartCard) child.remove();
    }

    if (!swarmData.hasSwarm) {
      if (swarmData.isActive) {
        if (keepStartCard && keepStartCard.parentElement === container) return;
        const card = document.createElement('div');
        card.className = 'swarm-start-card';
        const heading = document.createElement('div'); heading.className = 'swarm-overview-heading'; heading.textContent = 'Start a Swarm';
        const desc = document.createElement('div'); desc.className = 'swarm-overview-line'; desc.textContent = 'Coordinate parallel Antigravity workers on a shared board in this session.';
        const ta = document.createElement('textarea'); ta.id = 'swarmStartInput'; ta.rows = 3; ta.placeholder = 'Describe the goal to split across workers…';
        const actions = document.createElement('div'); actions.className = 'swarm-start-actions';
        const startBtn = document.createElement('button'); startBtn.type = 'button'; startBtn.id = 'swarmStartBtn'; startBtn.className = 'btn btn-small btn-primary'; startBtn.textContent = 'Start Swarm';
        const launch = async () => {
          if (swarmStartCard !== card) return;
          const task = ta.value.trim();
          if (!task) { ta.focus(); return; }
          startBtn.disabled = true;
          const ok = await dispatchCoordinatorText(`/swarm ${task}`, 'prompt', { fullReload: true, successText: 'Swarm start sent' });
          if (owns() && swarmStartCard === card) { startBtn.disabled = false; if (ok) ta.value = ''; }
        };
        startBtn.addEventListener('click', () => { void launch(); }, { signal: events.signal });
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void launch(); } }, { signal: events.signal });
        actions.appendChild(startBtn);
        card.append(heading, desc, ta, actions);
        swarmStartCard = card;
        container.appendChild(card);
        return;
      }
      const empty = document.createElement('div');
      empty.className = 'subagents-state';
      empty.textContent = 'No swarm recorded in this session.';
      container.appendChild(empty);
      return;
    }

    // Filter bar
    const filters = document.createElement('div');
    filters.className = 'swarm-board-filters';
    filters.id = 'swarmBoardFilters';
    if (swarmData.channels.length > 1) {
      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = `swarm-filter-chip${channelFilter === 'all' ? ' active' : ''}`;
      allBtn.textContent = `All (${swarmData.head})`;
      allBtn.addEventListener('click', () => { channelFilter = 'all'; renderDetail(); }, { signal: auxEvents.signal });
      filters.appendChild(allBtn);
      for (const ch of swarmData.channels) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `swarm-filter-chip${channelFilter === ch.name ? ' active' : ''}`;
        btn.textContent = `#${ch.name} (${ch.postCount})`;
        if (ch.topic) btn.title = ch.topic;
        btn.addEventListener('click', () => { channelFilter = ch.name; renderDetail(); }, { signal: auxEvents.signal });
        filters.appendChild(btn);
      }
    }
    if (memberFilter) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'swarm-filter-chip active';
      chip.textContent = `@${memberFilter} ×`;
      chip.title = 'Clear member filter';
      chip.addEventListener('click', () => { memberFilter = null; renderDetail(); }, { signal: auxEvents.signal });
      filters.appendChild(chip);
    }
    const spacer = document.createElement('span'); spacer.className = 'swarm-filter-spacer';
    filters.appendChild(spacer);
    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    followBtn.className = `swarm-filter-chip${followBoard ? ' active' : ''}`;
    followBtn.textContent = followBoard ? '● Follow' : '○ Follow';
    followBtn.addEventListener('click', () => { followBoard = !followBoard; renderDetail(); }, { signal: auxEvents.signal });
    filters.appendChild(followBtn);
    container.insertBefore(filters, composer);

    // Feed
    const feed = document.createElement('div');
    feed.className = 'swarm-board-feed';
    feed.id = 'swarmBoardFeed';
    const filtered = sortedPosts().filter((post) => {
      if (channelFilter !== 'all' && post.channel !== channelFilter) return false;
      if (memberFilter) {
        const lower = memberFilter.toLowerCase();
        if (post.agent.toLowerCase() !== lower && !post.mentions.includes(lower) && !post.mentions.includes('all')) return false;
      }
      return true;
    });
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'subagents-state';
      empty.textContent = 'No board posts match the current filter.';
      feed.appendChild(empty);
    } else {
      for (const post of filtered) {
        const card = document.createElement('article');
        card.className = `swarm-post${post.kind === 'brief' ? ' is-brief' : ''}${post.tags.includes('done') ? ' is-done' : ''}${post.tags.includes('stall') ? ' is-stall' : ''}`;
        card.dataset.postSeq = String(post.seq);

        const header = document.createElement('div');
        header.className = 'swarm-post-header';
        const seqEl = document.createElement('span'); seqEl.className = 'swarm-post-seq'; seqEl.textContent = `#${post.seq}`;
        const authorBtn = document.createElement('button');
        authorBtn.type = 'button'; authorBtn.className = 'swarm-post-author';
        authorBtn.style.color = memberColor(post.agent);
        authorBtn.textContent = post.agent === 'coordinator' ? 'coordinator' : `@${post.agent}`;
        authorBtn.title = `Filter by ${post.agent}`;
        authorBtn.addEventListener('click', () => { memberFilter = memberFilter === post.agent ? null : post.agent; renderDetail(); }, { signal: auxEvents.signal });
        header.append(seqEl, authorBtn);

        if (post.channel && post.channel !== 'main') {
          const ch = document.createElement('span'); ch.className = 'swarm-post-badge'; ch.textContent = `#${post.channel}`; header.appendChild(ch);
        }
        if (post.kind) {
          const kind = document.createElement('span'); kind.className = 'swarm-post-badge'; kind.textContent = post.kind; header.appendChild(kind);
        }
        for (const tag of post.tags) {
          const badge = document.createElement('span'); badge.className = `swarm-post-badge tag-${tag}`; badge.textContent = tag; header.appendChild(badge);
        }
        if (post.mentions.length) {
          const to = document.createElement('span'); to.className = 'swarm-post-mentions'; to.textContent = `→ ${post.mentions.map(m => `@${m}`).join(' ')}`; header.appendChild(to);
        }
        const time = document.createElement('span'); time.className = 'swarm-post-time'; time.textContent = post.time; header.appendChild(time);

        if (swarmData.isActive) {
          const replyBtn = document.createElement('button');
          replyBtn.type = 'button'; replyBtn.className = 'swarm-post-reply-btn';
          replyBtn.title = `Reply to #${post.seq}`; replyBtn.textContent = '↩';
          replyBtn.addEventListener('click', () => {
            const input = container.querySelector<HTMLTextAreaElement>('#swarmPromptInput');
            if (!input) return;
            const prefix = `@${post.agent} (re #${post.seq}) `;
            const cur = input.value.trim();
            input.value = cur ? `${prefix}${cur}` : prefix;
            boardDraft = input.value;
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }, { signal: auxEvents.signal });
          header.appendChild(replyBtn);
        }

        const body = document.createElement('div');
        body.className = 'swarm-post-body markdown-body';
        body.innerHTML = options.markdown(post.text);
        card.append(header, body);
        feed.appendChild(card);
      }
    }
    container.insertBefore(feed, composer);
    if (swarmData.isActive) {
      if (!boardComposer) {
        boardComposer = createSwarmComposer();
        container.appendChild(boardComposer.root);
      }
      updateSwarmComposer(boardComposer);
    }

    if (followBoard && wasPinned) feed.scrollTop = feed.scrollHeight;
    else feed.scrollTop = prevScroll;
  }

  function createSwarmComposer(): SwarmComposer {
    const root = document.createElement('div');
    root.className = 'swarm-composer';
    root.id = 'swarmComposer';

    const pills = document.createElement('div');
    pills.className = 'swarm-mention-pills';
    pills.id = 'swarmMentionPills';
    const wrap = document.createElement('div');
    wrap.className = 'swarm-composer-input-wrap';
    const menu = document.createElement('div');
    menu.className = 'swarm-mention-menu'; menu.id = 'swarmMentionMenu';
    menu.setAttribute('role', 'listbox'); menu.style.display = 'none';
    const textarea = document.createElement('textarea');
    textarea.id = 'swarmPromptInput'; textarea.rows = 2;
    textarea.placeholder = 'Message coordinator… (@ to mention, Enter to send, Shift+Enter for newline)';
    textarea.value = boardDraft;
    wrap.append(menu, textarea);

    const actions = document.createElement('div');
    actions.className = 'subagents-signal-actions';
    const status = document.createElement('span');
    status.className = 'subagents-signal-status'; status.id = 'swarmPromptStatus';
    const stop = document.createElement('button');
    stop.type = 'button'; stop.className = 'btn btn-small swarm-btn-danger'; stop.id = 'swarmCoordinatorStopBtn';
    stop.textContent = 'Stop';
    const steer = document.createElement('button');
    steer.type = 'button'; steer.className = 'btn btn-small'; steer.id = 'swarmPromptSteerBtn';
    steer.textContent = 'Steer';
    const send = document.createElement('button');
    send.type = 'button'; send.className = 'btn btn-small'; send.id = 'swarmPromptSendBtn';
    send.textContent = 'Send';
    actions.append(status, stop, steer, send);

    const submitBoard = async (mode: 'prompt' | 'steer' | 'auto') => {
      const draft = textarea.value;
      if (boardComposer?.root !== root || !draft.trim()) return;
      hideMentionMenu();
      const owner = viewOwner;
      const ok = await dispatchCoordinatorText(draft, mode);
      if (ok && viewOwner === owner && boardDraft === draft) {
        boardDraft = '';
        if (boardComposer) boardComposer.textarea.value = '';
      }
    };

    stop.addEventListener('click', () => { if (boardComposer?.root === root) void abortCoordinatorTurn(); });
    steer.addEventListener('click', () => { void submitBoard('steer'); });
    send.addEventListener('click', () => { void submitBoard('prompt'); });
    textarea.addEventListener('input', () => {
      boardDraft = textarea.value;
      const match = MENTION_TRIGGER_RE.exec(textarea.value.slice(0, textarea.selectionStart));
      if (!match) { hideMentionMenu(); return; }
      mentionChoices = buildMentionCandidates(match[1]);
      mentionIndex = 0;
      renderMentionMenu(textarea, menu);
    });
    // Choosing a menu option prevents the mousedown default, so it does not blur the input.
    textarea.addEventListener('blur', hideMentionMenu);
    textarea.addEventListener('keydown', (event) => {
      if (mentionChoices.length) {
        if (event.key === 'ArrowDown') { event.preventDefault(); mentionIndex = (mentionIndex + 1) % mentionChoices.length; renderMentionMenu(textarea, menu); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); mentionIndex = (mentionIndex - 1 + mentionChoices.length) % mentionChoices.length; renderMentionMenu(textarea, menu); return; }
        if (event.key === 'Tab' || event.key === 'Enter') { event.preventDefault(); acceptMentionChoice(textarea, mentionChoices[mentionIndex].token); return; }
        if (event.key === 'Escape') { event.preventDefault(); hideMentionMenu(); return; }
      }
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      void submitBoard('auto');
    });

    root.append(pills, wrap, actions);
    return { root, pills, textarea, menu, status, stop, steer, send };
  }

  function updateSwarmComposer({ pills, textarea, menu, status, stop, steer, send }: SwarmComposer) {
    const busy = swarmData.coordinatorTurnInProgress;
    status.textContent = boardStatusText;
    stop.style.display = busy ? '' : 'none';
    steer.classList.toggle('btn-primary', busy);
    send.classList.toggle('btn-primary', !busy);

    const tokens = document.createDocumentFragment();
    function addPill(token: string, color?: string) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'swarm-mention-pill';
      btn.textContent = `@${token}`;
      if (color) btn.style.color = color;
      btn.addEventListener('click', () => insertMentionToken(textarea, token));
      tokens.appendChild(btn);
    }
    let hasWorker = false;
    for (const member of swarmData.members) {
      if (member.name === 'coordinator' || member.state === 'killed') continue;
      addPill(member.name, memberColor(member.name));
      hasWorker = true;
    }
    if (hasWorker) addPill('all');
    for (const ch of swarmData.channels) {
      if (ch.name !== 'main' && !ch.archived) addPill(`#${ch.name}`);
    }
    pills.replaceChildren(tokens);

    if (mentionChoices.length) {
      const token = mentionChoices[mentionIndex].token;
      const match = MENTION_TRIGGER_RE.exec(textarea.value.slice(0, textarea.selectionStart));
      if (!match) { hideMentionMenu(); return; }
      mentionChoices = buildMentionCandidates(match[1]);
      mentionIndex = Math.max(0, mentionChoices.findIndex(choice => choice.token === token));
      renderMentionMenu(textarea, menu);
    }
  }

  function renderSwarmOverviewPanel(container: HTMLElement) {
    auxEvents.abort();
    auxEvents = new AbortController();
    let body = container.querySelector<HTMLElement>('#swarmOverviewBody');
    if (!body) {
      body = document.createElement('div');
      body.className = 'swarm-overview-body';
      body.id = 'swarmOverviewBody';
      container.replaceChildren(body);
    }

    if (!swarmData.hasSwarm) {
      const empty = document.createElement('div'); empty.className = 'subagents-state'; empty.textContent = 'No swarm active in this session.';
      body.replaceChildren(empty);
      return;
    }

    const view = swarmData.narratorView;
    const plan = swarmData.plan;
    const goal = (record(view?.goal) ? view.goal : record(plan?.goal) ? plan.goal : null);

    const goalCard = document.createElement('div');
    goalCard.className = 'swarm-overview-card';
    const goalTitle = text(goal?.title) || swarmData.title;
    const goalLine = text(goal?.line) || text(view?.headline) || `${swarmData.members.length} members · ${swarmData.head} board post${swarmData.head === 1 ? '' : 's'}`;
    goalCard.innerHTML = `<div class="swarm-overview-heading">${escapeHtml(goalTitle)}</div><div class="swarm-overview-line">${escapeHtml(goalLine)}</div>`
      + (text(view?.running_summary) ? `<div class="swarm-overview-summary">${escapeHtml(text(view?.running_summary))}</div>` : '');
    const content = document.createDocumentFragment();
    content.appendChild(goalCard);

    const attention = Array.isArray(view?.attention) ? view.attention.filter(record) : [];
    if (attention.length) {
      const sec = document.createElement('div'); sec.className = 'swarm-overview-section';
      sec.innerHTML = '<div class="tasks-section-title">Needs attention</div>';
      for (const item of attention) {
        const card = document.createElement('div');
        card.className = `swarm-overview-card severity-${escapeHtml(text(item.severity) || 'med')}`;
        const title = text(record(item.short) ? item.short.title : undefined) || text(item.title);
        const why = text(record(item.short) ? item.short.line : undefined) || text(item.why);
        card.innerHTML = `<div class="swarm-overview-item-title"><span class="swarm-post-badge">${escapeHtml(text(item.kind) || 'fyi')}</span> ${escapeHtml(title)}</div>`
          + (why ? `<div class="swarm-overview-line">${escapeHtml(why)}</div>` : '');
        const refs = Array.isArray(item.refs) ? item.refs.filter(record) : [];
        if (refs.length) {
          const refRow = document.createElement('div'); refRow.className = 'swarm-overview-refs';
          for (const ref of refs) {
            if (finite(ref.seq)) {
              const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'swarm-filter-chip'; btn.textContent = `#${ref.seq}`;
              btn.addEventListener('click', () => jumpToPost(ref.seq as number), { signal: auxEvents.signal });
              refRow.appendChild(btn);
            }
          }
          card.appendChild(refRow);
        }
        sec.appendChild(card);
      }
      content.appendChild(sec);
    }

    const workstreams = Array.isArray(view?.workstreams) ? view.workstreams.filter(record) : [];
    const threads = Array.isArray(plan?.threads) ? plan.threads.filter(record) : [];
    const planTasks = record(plan?.tasks) ? plan.tasks : null;
    if (workstreams.length) {
      const sec = document.createElement('div'); sec.className = 'swarm-overview-section';
      sec.innerHTML = '<div class="tasks-section-title">Workstreams</div>';
      for (const ws of workstreams) {
        const card = document.createElement('div'); card.className = 'swarm-overview-card';
        const title = text(record(ws.short) ? ws.short.title : undefined) || text(ws.title);
        const note = text(record(ws.short) ? ws.short.line : undefined) || text(ws.note);
        const owners = Array.isArray(ws.owners) ? ws.owners.filter((o): o is string => typeof o === 'string').map(o => `@${o}`).join(' ') : '';
        card.innerHTML = `<div class="swarm-overview-item-title"><span class="swarm-state-pill state-${escapeHtml(text(ws.state))}">${escapeHtml(text(ws.state) || 'active')}</span> ${escapeHtml(title)}${owners ? ` <span class="swarm-post-mentions">${escapeHtml(owners)}</span>` : ''}</div>`
          + (note ? `<div class="swarm-overview-line">${escapeHtml(note)}</div>` : '');
        sec.appendChild(card);
      }
      content.appendChild(sec);
    } else if (threads.length) {
      const sec = document.createElement('div'); sec.className = 'swarm-overview-section';
      sec.innerHTML = '<div class="tasks-section-title">Threads</div>';
      for (const thread of threads) {
        const card = document.createElement('div'); card.className = 'swarm-overview-card';
        const taskNames = Array.isArray(thread.tasks) ? thread.tasks.filter((t): t is string => typeof t === 'string') : [];
        const listHtml = taskNames.map(name => `<li><code>@${escapeHtml(name)}</code> ${escapeHtml(text(planTasks?.[name]))}</li>`).join('');
        card.innerHTML = `<div class="swarm-overview-item-title">${escapeHtml(text(thread.title))}</div>`
          + (text(thread.goal) ? `<div class="swarm-overview-line">${escapeHtml(text(thread.goal))}</div>` : '')
          + (listHtml ? `<ul class="swarm-overview-tasks">${listHtml}</ul>` : '');
        sec.appendChild(card);
      }
      content.appendChild(sec);
    }

    const narrator = swarmData.members.find(m => /^narrator(?:-\d+)?$/.test(m.name) && m.state !== 'killed');
    const coordId = swarmData.coordinatorId;
    const feedback = body.lastElementChild as HTMLElement | null;
    if (swarmData.isActive && narrator && coordId) {
      if (feedback?.dataset.narrator === narrator.name && feedback.dataset.coordinatorId === coordId) {
        // Keep the form attached so a refresh cannot erase a draft or interrupt a click.
        while (body.firstChild && body.firstChild !== feedback) body.firstChild.remove();
        body.insertBefore(content, feedback);
        return;
      }
      content.appendChild(createNarratorFeedback(narrator.name, coordId));
    }
    body.replaceChildren(content);
  }

  function createNarratorFeedback(narrator: string, coordId: string) {
    const card = document.createElement('div'); card.className = 'swarm-overview-card';
    card.dataset.narrator = narrator;
    card.dataset.coordinatorId = coordId;
    const title = document.createElement('div'); title.className = 'swarm-overview-item-title'; title.textContent = `Feedback for @${narrator}`;
    const row = document.createElement('div'); row.className = 'swarm-narrator-feedback';
    const input = document.createElement('input'); input.type = 'text'; input.id = 'swarmNarratorFeedbackInput'; input.placeholder = 'Correct summary, priority, or status…';
    const sendBtn = document.createElement('button'); sendBtn.type = 'button'; sendBtn.id = 'swarmNarratorFeedbackBtn'; sendBtn.className = 'btn btn-small'; sendBtn.textContent = 'Send feedback';
    const submitFeedback = async () => {
      if (!card.isConnected) return;
      const draft = input.value;
      const raw = draft.trim();
      if (!raw) { input.focus(); return; }
      const sanitized = raw.replace(/@([a-z0-9_#-]+)/gi, '$1');
      const ok = await dispatchCoordinatorText(`Post this verbatim to the swarm board: @${narrator} user feedback: ${sanitized}`, 'auto', {
        successText: `Sent feedback to @${narrator}`,
      });
      if (ok && card.isConnected && input.value === draft) input.value = '';
    };
    sendBtn.addEventListener('click', () => { void submitFeedback(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void submitFeedback(); } });
    row.append(input, sendBtn);
    card.append(title, row);
    return card;
  }

  // ---- Background Task detail panel inside #subagentsAuxPanel ---------------

  function syncLogTimer() {
    clearInterval(logTimer); logTimer = undefined;
    const task = selectedTask();
    if (!task || !task.hasLog || task.status !== 'running') return;
    logTimer = setInterval(() => {
      if (owns() && selection?.kind === 'task' && selection.taskId === task.id) void loadTaskLog(task.id, false);
    }, 2000);
  }

  async function loadTaskLog(taskId: string, reset: boolean) {
    if (!owns() || !viewOwner || !viewEndpoint) return;
    const task = tasksData.tasks.find(t => t.id === taskId);
    const logEl = document.getElementById('tasksDetailLog');
    const logMeta = document.getElementById('tasksDetailLogMeta');
    const moreBtn = document.getElementById('tasksLogMoreBtn');
    if (!task || !task.hasLog) {
      lastLogText = task?.preview || '';
      lastLogTruncated = false;
      if (logEl) logEl.textContent = lastLogText || (task?.status === 'running' ? 'Waiting for background task log…' : 'No log file recorded for this task.');
      if (logMeta) logMeta.textContent = '';
      if (moreBtn) moreBtn.style.display = 'none';
      return;
    }
    const owner = viewOwner, endpoint = viewEndpoint, seq = ++logSeq;
    if (reset && logEl) logEl.textContent = 'Loading log…';
    const stale = () => seq !== logSeq || !owns() || viewOwner !== owner || selection?.kind !== 'task' || selection.taskId !== taskId;
    const query = logTailBytes > DEFAULT_LOG_TAIL ? `?tail=${logTailBytes}` : '';
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/tasks/${encodeURIComponent(taskId)}/log${query}`);
      const payload: unknown = await res.json();
      if (stale()) return;
      if (!res.ok) throw new Error(responseError(res, payload));
      const log: TaskLogPayload | null = decodeTaskLog(payload);
      if (!log) return;
      const curLogEl = document.getElementById('tasksDetailLog');
      const curMetaEl = document.getElementById('tasksDetailLogMeta');
      const curMoreBtn = document.getElementById('tasksLogMoreBtn');
      const stickToTail = !!curLogEl && followLog && curLogEl.scrollHeight - curLogEl.scrollTop - curLogEl.clientHeight < 60;
      lastLogText = log.content;
      lastLogTruncated = log.truncated;
      if (curLogEl) {
        curLogEl.textContent = log.content || '(empty log)';
        if (reset || stickToTail) curLogEl.scrollTop = curLogEl.scrollHeight;
      }
      if (curMetaEl) curMetaEl.textContent = `${formatByteSize(log.totalBytes)}${log.truncated ? ' (tail)' : ''} · updated ${formatRelativeTime(log.updatedAt)}`;
      if (curMoreBtn) curMoreBtn.style.display = lastLogTruncated && logTailBytes < MAX_LOG_TAIL ? '' : 'none';
    } catch (error) {
      if (stale()) return;
      const curLogEl = document.getElementById('tasksDetailLog');
      if (reset && curLogEl) curLogEl.textContent = `Log unavailable: ${errorMessage(error)}`;
    }
  }

  async function sendTaskControlPrompt(message: string, successText: string): Promise<boolean> {
    if (!owns() || !viewOwner || !viewEndpoint || !tasksData.canControl) return false;
    const endpoint = viewEndpoint, sessionId = viewOwner.id;
    const kind = sessionState.currentSession?.turnInProgress ? 'steer' : 'prompt';
    try {
      await sendJson(options.request, endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/${kind}`, { message });
      if (!owns()) return false;
      options.status(successText, 'success');
      scheduleRapidRefresh(false);
      return true;
    } catch (error) {
      if (owns()) options.status(errorMessage(error), 'error');
      return false;
    }
  }

  function renderTaskDetailPanel(container: HTMLElement) {
    auxEvents.abort();
    auxEvents = new AbortController();
    const task = selectedTask();
    const canStdin = !!(task && tasksData.canControl && task.kind === 'shell' && task.status === 'running');
    if (!canStdin || tasksStdin?.taskId !== task.id) tasksStdin = null;
    else tasksStdin.fullTaskId = task.fullTaskId || task.id;
    const prevLog = container.querySelector<HTMLElement>('#tasksDetailLog');
    const prevLogScroll = prevLog?.scrollTop ?? 0;
    const keptStdin = tasksStdin?.root ?? null;
    // Keep the live stdin bar attached across 2.5s polls so drafts and focus survive.
    for (const child of Array.from(container.children)) {
      if (child !== keptStdin) child.remove();
    }
    if (!task) {
      const empty = document.createElement('div'); empty.className = 'subagents-state'; empty.textContent = 'Select a background task to inspect its log.';
      container.appendChild(empty);
      return;
    }

    const insertBeforeStdin = (node: Node) => {
      if (keptStdin && keptStdin.parentElement === container) container.insertBefore(node, keptStdin);
      else container.appendChild(node);
    };

    const header = document.createElement('div');
    header.className = 'tasks-detail-header';
    const heading = document.createElement('div'); heading.className = 'tasks-detail-heading';
    const titleEl = document.createElement('div'); titleEl.className = 'tasks-detail-title'; titleEl.textContent = task.title;
    const metaBits = [task.id, task.kind, task.status];
    if (task.exitCode !== null) metaBits.push(`exit ${task.exitCode}`);
    if (task.cron) metaBits.push(`cron ${task.cron}`);
    if (task.durationSeconds !== null) metaBits.push(`timer ${task.durationSeconds}s`);
    if (task.isDaemon) metaBits.push('daemon');
    if (task.startedAt) metaBits.push(`started ${formatRelativeTime(task.startedAt)}`);
    if (task.finishedAt) metaBits.push(`ended ${formatRelativeTime(task.finishedAt)}`);
    const metaEl = document.createElement('div'); metaEl.className = 'tasks-detail-meta'; metaEl.textContent = metaBits.join(' · ');
    heading.append(titleEl, metaEl);

    const actions = document.createElement('div'); actions.className = 'tasks-detail-actions';
    if (tasksData.canControl && task.kind === 'tool' && task.status === 'running') {
      const abortBtn = document.createElement('button');
      abortBtn.type = 'button'; abortBtn.id = 'tasksAbortTurnBtn'; abortBtn.className = 'btn btn-small swarm-btn-danger';
      abortBtn.textContent = 'Stop turn';
      abortBtn.addEventListener('click', async () => {
        if (!owns() || !viewOwner || !viewEndpoint) return;
        try {
          const res = await options.request(viewEndpoint, `/api/sessions/${encodeURIComponent(viewOwner.id)}/abort`, { method: 'POST' });
          const payload: unknown = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(responseError(res, payload));
          if (owns()) { options.status('Turn abort requested', 'success'); scheduleRapidRefresh(false); }
        } catch (err) { if (owns()) options.status(errorMessage(err), 'error'); }
      }, { signal: auxEvents.signal });
      actions.appendChild(abortBtn);
    }
    if (tasksData.canControl && task.kind !== 'tool' && (task.status === 'running' || task.status === 'scheduled')) {
      const killBtn = document.createElement('button');
      killBtn.type = 'button'; killBtn.id = 'tasksKillBtn'; killBtn.className = 'btn btn-small swarm-btn-danger';
      killBtn.textContent = task.kind === 'schedule' ? 'Cancel' : 'Kill';
      killBtn.addEventListener('click', async () => {
        const label = task.kind === 'schedule' ? 'Cancel schedule' : 'Kill background task';
        if (!confirmAction(`${label} "${task.title}" (${task.id})?`)) return;
        const targetId = task.fullTaskId || task.id;
        await sendTaskControlPrompt(
          `Kill background task "${targetId}" using manage_task with Action="kill" and TaskId=${JSON.stringify(targetId)}.`,
          task.kind === 'schedule' ? `Cancelling ${task.id}…` : `Killing ${task.id}…`,
        );
      }, { signal: auxEvents.signal });
      actions.appendChild(killBtn);
    }
    header.append(heading, actions);
    insertBeforeStdin(header);

    const cmdText = task.command || (task.cron ? `${task.cron} — ${task.preview}` : task.preview);
    if (cmdText) {
      const cmdEl = document.createElement('pre'); cmdEl.className = 'tasks-detail-command'; cmdEl.textContent = cmdText;
      insertBeforeStdin(cmdEl);
    }

    const logBar = document.createElement('div'); logBar.className = 'tasks-detail-log-bar';
    const logLabel = document.createElement('span'); logLabel.className = 'tasks-detail-log-label'; logLabel.textContent = 'Output log';
    const logMeta = document.createElement('span'); logMeta.className = 'tasks-detail-log-meta'; logMeta.id = 'tasksDetailLogMeta';
    const logActions = document.createElement('div'); logActions.className = 'tasks-detail-log-actions';
    const followBtn = document.createElement('button');
    followBtn.type = 'button'; followBtn.id = 'tasksLogFollowBtn';
    followBtn.className = `swarm-filter-chip${followLog ? ' active' : ''}`;
    followBtn.textContent = followLog ? '● Follow' : '○ Follow';
    followBtn.addEventListener('click', () => {
      followLog = !followLog;
      followBtn.classList.toggle('active', followLog);
      followBtn.textContent = followLog ? '● Follow' : '○ Follow';
      if (followLog) { const el = document.getElementById('tasksDetailLog'); if (el) el.scrollTop = el.scrollHeight; }
    }, { signal: auxEvents.signal });
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button'; moreBtn.id = 'tasksLogMoreBtn'; moreBtn.className = 'swarm-filter-chip'; moreBtn.textContent = 'Load more';
    moreBtn.style.display = lastLogTruncated && logTailBytes < MAX_LOG_TAIL ? '' : 'none';
    moreBtn.addEventListener('click', () => { logTailBytes = MAX_LOG_TAIL; void loadTaskLog(task.id, false); }, { signal: auxEvents.signal });
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button'; copyBtn.id = 'tasksLogCopyBtn'; copyBtn.className = 'swarm-filter-chip'; copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      const txt = lastLogText || document.getElementById('tasksDetailLog')?.textContent || '';
      if (!txt) return;
      try { await copyText(txt); if (owns()) options.status('Copied task log', 'success'); }
      catch (err) { if (owns()) options.status(`Copy failed: ${errorMessage(err)}`, 'error'); }
    }, { signal: auxEvents.signal });
    logActions.append(followBtn, moreBtn, copyBtn);
    logBar.append(logLabel, logMeta, logActions);
    insertBeforeStdin(logBar);

    const logEl = document.createElement('pre');
    logEl.className = 'tasks-detail-log'; logEl.id = 'tasksDetailLog';
    logEl.textContent = lastLogText || (task.hasLog ? 'Loading log…' : (task.preview || 'No log file recorded for this task.'));
    insertBeforeStdin(logEl);
    if (followLog) logEl.scrollTop = logEl.scrollHeight;
    else if (prevLog) logEl.scrollTop = prevLogScroll;

    if (canStdin && (!keptStdin || keptStdin.parentElement !== container)) {
      const stdinBar = document.createElement('div'); stdinBar.className = 'tasks-stdin-bar'; stdinBar.id = 'tasksStdinBar';
      const input = document.createElement('input'); input.type = 'text'; input.id = 'tasksStdinInput'; input.placeholder = 'Send stdin line to running task…';
      const sendBtn = document.createElement('button'); sendBtn.type = 'button'; sendBtn.id = 'tasksStdinSendBtn'; sendBtn.className = 'btn btn-small'; sendBtn.textContent = 'Send';
      const entry = { taskId: task.id, fullTaskId: task.fullTaskId || task.id, root: stdinBar, input };
      const submitStdin = async () => {
        if (tasksStdin !== entry) return;
        const line = input.value;
        if (!line.trim()) return;
        const targetId = entry.fullTaskId;
        const ok = await sendTaskControlPrompt(
          `Send stdin to running task "${targetId}" using manage_task with Action="send_input", TaskId=${JSON.stringify(targetId)}, and Input=${JSON.stringify(line + '\n')}.`,
          `Sent input to ${entry.taskId}`,
        );
        if (ok && owns() && tasksStdin === entry) input.value = '';
      };
      sendBtn.addEventListener('click', () => { void submitStdin(); }, { signal: events.signal });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void submitStdin(); } }, { signal: events.signal });
      stdinBar.append(input, sendBtn);
      tasksStdin = entry;
      container.appendChild(stdinBar);
    }
  }

  // ---- Existing Subagents peek & signal ------------------------------------

  function syncPeekTimer() {
    clearInterval(peekTimer); peekTimer = undefined;
    if (!peekTarget || (!peekTarget.isActive && !peekTarget.subagentLive)) return;
    peekTimer = setInterval(() => { if (owns() && peekTarget) void loadPeek(false); }, 3000);
  }

  async function loadPeek(reset: boolean) {
    if (!owns() || !peekTarget || !viewEndpoint) return;
    const target = peekTarget, endpoint = viewEndpoint, seq = ++peekSeq;
    const trace = element('subagentsTrace');
    // Tag the trace container so lazy video enhancement (e.g. toggling a tool result) resolves
    // against the peeked subagent and its host instead of the parent session.
    trace.dataset.videoSessionId = target.id;
    if (viewOwner?.host) trace.dataset.videoHost = viewOwner.host;
    else delete trace.dataset.videoHost;
    if (reset) { peekLastIndex = null; trace.replaceChildren(); }
    const stale = () => seq !== peekSeq || !owns() || peekTarget !== target;
    const query = peekLastIndex == null ? '?limit=50' : `?after=${peekLastIndex}`;
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(target.id)}/messages${query}`);
      const data: unknown = await res.json();
      if (stale()) return;
      if (!res.ok) throw new Error(responseError(res, data));
      const payload = record(data) ? data : {};
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      if (reset && !messages.length) {
        const empty = document.createElement('div');
        empty.className = 'subagents-state';
        empty.textContent = 'No messages yet.';
        trace.appendChild(empty);
      }
      const stickToTail = trace.scrollHeight - trace.scrollTop - trace.clientHeight < 80;
      for (const value of messages) {
        const html = renderer.message(decodeRenderMessage(value));
        if (!html) continue;
        const template = document.createElement('template');
        template.innerHTML = html.trim();
        const el = template.content.firstElementChild;
        if (el) trace.appendChild(el);
      }
      if (messages.length && (reset || stickToTail)) trace.scrollTop = trace.scrollHeight;
      if (typeof payload.lastIndex === 'number') peekLastIndex = payload.lastIndex;
      else if (reset && typeof payload.lastIndex !== 'number') peekLastIndex = null;
    } catch (error) {
      if (stale()) return;
      if (reset) {
        trace.replaceChildren();
        const failure = document.createElement('div');
        failure.className = 'subagents-state';
        failure.textContent = `Trace unavailable: ${errorMessage(error)}`;
        trace.appendChild(failure);
      }
    }
  }

  async function sendSignal(kind: 'prompt' | 'steer' | 'followUp') {
    if (!owns() || !peekTarget || !viewEndpoint) return;
    const target = peekTarget, endpoint = viewEndpoint, seq = ++peekSeq - 1;
    const input = element<HTMLTextAreaElement>('subagentsSignalInput');
    const raw = input.value.trim();
    if (!raw) return;
    const status = element('subagentsSignalStatus');

    // For a live agy swarm worker without its own bridge socket, route through coordinator!
    const member = isAgy() ? swarmMemberForSession(target.id) : null;
    if (member && member.name !== 'coordinator' && swarmData.isActive && member.state !== 'killed' && !target.isActive) {
      const msg = raw.toLowerCase().startsWith(`@${member.name.toLowerCase()}`)
        ? `Post this to the swarm board: ${raw}`
        : `Post this to the swarm board for @${member.name}: @${member.name} ${raw}`;
      status.textContent = 'Sending via coordinator…';
      const ok = await dispatchCoordinatorText(msg, kind === 'steer' ? 'steer' : 'auto', {
        successText: `Messaged @${member.name}`,
      });
      if (owns() && peekTarget === target) {
        if (ok) { input.value = ''; status.textContent = `Messaged @${member.name}`; }
        else status.textContent = boardStatusText || 'Failed';
      }
      return;
    }

    const path = kind === 'steer' ? 'steer' : kind === 'followUp' ? 'follow-up' : 'prompt';
    status.textContent = 'Sending…';
    try {
      await sendJson(options.request, endpoint, `/api/sessions/${encodeURIComponent(target.id)}/${path}`, { message: raw });
      if (!owns() || seq !== peekSeq - 1 || peekTarget !== target) return;
      input.value = '';
      status.textContent = kind === 'steer' ? 'Steered' : kind === 'followUp' ? 'Follow-up queued' : 'Sent';
    } catch (error) {
      if (!owns() || peekTarget !== target) return;
      status.textContent = errorMessage(error);
    }
  }

  async function openTarget() {
    if (!owns() || !peekTarget || !viewOwner || !viewEndpoint) return;
    const id = peekTarget.id, owner = viewOwner, endpoint = viewEndpoint;
    close();
    if (!sessionState.findSession(id, owner.host)) await options.loadPrevious();
    if (disposed || !sessionState.ownsSelection(owner) || !sameEndpoint(options.endpoint(owner.host), endpoint)) return;
    if (!sessionState.findSession(id, owner.host)) { options.status('Related session is not available yet', 'error'); return; }
    await options.selectSession(id, { host: owner.host });
  }

  // Static control listeners live for the module's lifetime.
  element('subagentsOpenBtn').addEventListener('click', () => { void openTarget(); }, { signal: events.signal });
  element('subagentsSendBtn').addEventListener('click', () => { void sendSignal('prompt'); }, { signal: events.signal });
  element('subagentsSteerBtn').addEventListener('click', () => { void sendSignal('steer'); }, { signal: events.signal });
  element('subagentsFollowUpBtn').addEventListener('click', () => { void sendSignal('followUp'); }, { signal: events.signal });
  element<HTMLTextAreaElement>('subagentsSignalInput').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const target = peekTarget;
    const member = target && isAgy() ? swarmMemberForSession(target.id) : null;
    if (member && member.name !== 'coordinator' && swarmData.isActive && !target?.isActive) {
      void sendSignal(swarmData.coordinatorTurnInProgress ? 'steer' : 'prompt');
      return;
    }
    const kind = target?.capabilities?.prompt ? 'prompt' : target?.capabilities?.steer ? 'steer' : 'followUp';
    void sendSignal(kind);
  }, { signal: events.signal });

  element('subagentsAddWorkerBtn').addEventListener('click', () => setAddDrawerOpen(!addDrawerOpen), { signal: events.signal });
  element('subagentsAddCancelBtn').addEventListener('click', () => setAddDrawerOpen(false), { signal: events.signal });
  element('subagentsAddSubmitBtn').addEventListener('click', () => { void submitAddWorker(); }, { signal: events.signal });
  element<HTMLTextAreaElement>('subagentsAddBrief').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submitAddWorker(); }
  }, { signal: events.signal });
  element<HTMLSelectElement>('subagentsMemberModelSelect').addEventListener('change', (event) => {
    const member = peekTarget ? swarmMemberForSession(peekTarget.id) : null;
    if (member) void switchMemberModel(member, (event.currentTarget as HTMLSelectElement).value);
  }, { signal: events.signal });
  element('subagentsCoordStopBtn').addEventListener('click', () => { void abortCoordinatorTurn(); }, { signal: events.signal });
  element('subagentsMemberPingBtn').addEventListener('click', () => {
    const member = peekTarget ? swarmMemberForSession(peekTarget.id) : null;
    if (member) void pingMember(member);
  }, { signal: events.signal });
  element('subagentsMemberKillBtn').addEventListener('click', () => {
    const member = peekTarget ? swarmMemberForSession(peekTarget.id) : null;
    if (member) void killMember(member);
  }, { signal: events.signal });

  return {
    open, close, dismissOverlay, isOpen, reload: () => { if (owns()) void reloadAll(true); },
    get selected() { return selection?.kind === 'session' ? selection.id : null; },
    dispose() { close(); events.abort(); renderer.dispose(); disposed = true; },
  };
}
