import type { ApiRequest, HostEndpoint } from './api-client';
import { sendJson } from './api-client';
import type { SelectionOwner, SessionState } from './session-state';
import { formatRelativeTime } from './helper-format';
import { record } from './helper-values';
import { createMessageRenderer } from './message-render';
import type { createResponseDetails } from './response-details';
import { decodeSessionLineage } from './session-relations';
import type { LineageNode, LineageSession, SessionLineage } from './session-relations';

// --- Subagents view (main-pane takeover) ---
// One session's whole family: the /lineage tree on the left, a peek pane on
// the right showing the selected relative's transcript tail (full message
// fidelity, read-only) plus a signal composer that prompts/steers the target
// through the existing per-session routes. The underlying session selection
// never changes — peeking and signaling never turn the main view into the
// subagent's trace, and closing returns exactly to the viewed session.
export function createSubagentsView(options: {
  root: HTMLElement; request: ApiRequest; sessionState: SessionState;
  endpoint: (host: string | null) => HostEndpoint | null;
  closeOtherViews: () => void; loadPrevious: () => Promise<unknown>;
  selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
  status: (message: string, kind?: string) => void;
  markdown: (text: string) => string;
  assetUrl: (host: string | null | undefined, path: string) => string;
  matchRef: (ref: string) => { name?: string | null; isActive?: boolean } | null | undefined;
  details: ReturnType<typeof createResponseDetails>;
}) {
  const document = options.root.ownerDocument, sessionState = options.sessionState;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const value = document.getElementById(id); if (!value) throw new Error('Missing subagents view element: ' + id); return value as T;
  };
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  let disposed = false;
  let viewOwner: SelectionOwner | null = null;
  let viewEndpoint: HostEndpoint | null = null;
  let lineage: SessionLineage = decodeSessionLineage(null);
  let lineageSeq = 0, loadInFlight = false, lastIndexing = false;
  const collapsed = new Set<string>();
  let selectedId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let indexingTimer: ReturnType<typeof setTimeout> | undefined;
  let treeEvents = new AbortController();
  const events = new AbortController();
  // Peek state: the selected relative's trace, loaded tail-first and caught up
  // through the after-cursor while the target stays live.
  let peekSeq = 0;
  let peekTarget: LineageSession | null = null;
  let peekLastIndex: number | null = null;
  let peekTimer: ReturnType<typeof setInterval> | undefined;

  const renderer = createMessageRenderer({
    document, sessionState, details: options.details,
    markdown: text => options.markdown(text), assetUrl: options.assetUrl, matchRef: options.matchRef,
    pinned: container => container.scrollHeight - container.scrollTop - container.clientHeight < 40,
    follow: () => true,
    scroll: container => { container.scrollTop = container.scrollHeight; },
    jump: () => {},
    peek: () => peekTarget ? { host: viewOwner?.host ?? null, model: peekTarget.model || null } : null,
  });

  function sameEndpoint(host: string | null, endpoint: HostEndpoint | null): boolean {
    const current = options.endpoint(host);
    return !!endpoint && !!current && current.base === endpoint.base && (current.token || '') === (endpoint.token || '');
  }
  const owns = () => !disposed && !!viewOwner && sessionState.ownsSelection(viewOwner) && sameEndpoint(viewOwner.host, viewEndpoint);
  const isOpen = () => !disposed && options.root.classList.contains('subagents-open');

  function findNode(node: LineageNode | null, id: string): LineageNode | null {
    if (!node) return null;
    if (node.session.id === id) return node;
    for (const child of node.children) { const hit = findNode(child, id); if (hit) return hit; }
    return null;
  }

  function open(owner: SelectionOwner, endpoint: HostEndpoint, initial: SessionLineage) {
    if (disposed || !sessionState.ownsSelection(owner)) return;
    close(); options.closeOtherViews();
    viewOwner = owner; viewEndpoint = Object.freeze({ ...endpoint });
    lineage = initial.tree ? initial : decodeSessionLineage(null);
    lastIndexing = false; selectedId = null; peekTarget = null; peekLastIndex = null;
    collapsed.clear();
    element('subagentsViewNote').textContent = lineage.session?.name ? `Family of ${lineage.session.name}` : '';
    options.root.classList.add('subagents-open');
    renderTree(); renderDetail();
    void loadLineage();
    // Repoll while the viewed session can still gain relatives (active or the
    // catalog is still indexing) — the rule the tree view has always had.
    pollTimer = setInterval(() => {
      if (!owns() || loadInFlight) return;
      if (!sessionState.currentSession?.isActive && !lastIndexing) return;
      void loadLineage();
    }, 4000);
  }

  function close() {
    if (!isOpen()) return;
    lineageSeq++; peekSeq++;
    clearInterval(pollTimer); pollTimer = undefined;
    clearInterval(peekTimer); peekTimer = undefined;
    clearTimeout(indexingTimer);
    treeEvents.abort();
    viewOwner = null; viewEndpoint = null; peekTarget = null; selectedId = null;
    options.root.classList.remove('subagents-open');
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
      if (!res.ok) throw new Error(record(data) && typeof data.error === 'string' && data.error || `HTTP ${res.status}`);
      lastIndexing = record(data) && data.indexing === true;
      lineage = decodeSessionLineage(data);
      renderTree();
      // Refresh the detail pane against fresh summaries (capabilities flip as
      // sessions start/stop) without disturbing the trace's paging state.
      if (selectedId) {
        const node = findNode(lineage.tree, selectedId);
        peekTarget = node?.session || null;
        renderDetail();
        syncPeekTimer();
      }
      if (lastIndexing) indexingTimer = setTimeout(() => { if (current()) void loadLineage(); }, 1000);
    } catch (error) {
      if (current()) console.error('Failed to load session lineage:', error);
    } finally {
      if (current()) loadInFlight = false;
      else loadInFlight = false;
    }
  }

  function renderTree() {
    if (!owns() || !isOpen()) return;
    treeEvents.abort(); treeEvents = new AbortController();
    const body = element('subagentsTree');
    body.replaceChildren();
    const tree = lineage.tree;
    if (!tree) {
      const empty = document.createElement('div');
      empty.className = 'subagents-state';
      empty.textContent = 'No related sessions.';
      body.appendChild(empty);
      return;
    }
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
      if (target.id === currentId) row.classList.add('lineage-current');
      if (target.id === selectedId) row.classList.add('lineage-selected');

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
      if (target.turnInProgress) {
        const badge = document.createElement('span');
        badge.className = 'lineage-badge lineage-busy';
        badge.textContent = 'working';
        badge.title = 'A turn is in progress';
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
  }

  function selectNode(id: string) {
    if (!owns()) return;
    selectedId = id;
    peekTarget = findNode(lineage.tree, id)?.session || null;
    renderTree(); renderDetail();
    void loadPeek(true);
    syncPeekTimer();
  }

  // The detail pane: meta line, read-only trace tail, and a signal composer
  // whose buttons mirror exactly what the target's capabilities allow.
  function renderDetail() {
    const empty = element('subagentsDetailEmpty');
    const content = element('subagentsDetailContent');
    const target = peekTarget;
    if (!selectedId || !target) {
      empty.style.display = ''; content.style.display = 'none';
      return;
    }
    empty.style.display = 'none'; content.style.display = 'flex';
    element('subagentsDetailName').textContent = target.name || target.id.slice(0, 8);
    const live = target.isActive ? 'live' : target.subagentLive ? 'live in parent' : 'ended';
    element('subagentsDetailMeta').textContent =
      [target.harnessId, target.model !== 'unknown' ? target.model : '', live, formatRelativeTime(target.lastActivity)].filter(Boolean).join(' · ');

    const caps = target.capabilities;
    const canPrompt = target.isActive && caps?.prompt === true;
    const canSteer = target.isActive && caps?.steer === true;
    const canFollowUp = target.isActive && caps?.followUp === true;
    const signalable = canPrompt || canSteer || canFollowUp;
    const box = element('subagentsSignalBox'), note = element('subagentsSignalNote');
    box.style.display = signalable ? '' : 'none';
    note.style.display = signalable ? 'none' : '';
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

  function syncPeekTimer() {
    clearInterval(peekTimer); peekTimer = undefined;
    if (!peekTarget || (!peekTarget.isActive && !peekTarget.subagentLive)) return;
    peekTimer = setInterval(() => { if (owns() && peekTarget) void loadPeek(false); }, 3000);
  }

  async function loadPeek(reset: boolean) {
    if (!owns() || !peekTarget || !viewEndpoint) return;
    const target = peekTarget, endpoint = viewEndpoint, seq = ++peekSeq;
    if (reset) { peekLastIndex = null; element('subagentsTrace').replaceChildren(); }
    const stale = () => seq !== peekSeq || !owns() || peekTarget !== target;
    const query = peekLastIndex == null ? '?limit=50' : `?after=${peekLastIndex}`;
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(target.id)}/messages${query}`);
      const data: unknown = await res.json();
      if (stale()) return;
      if (!res.ok) throw new Error(record(data) && typeof data.error === 'string' && data.error || `HTTP ${res.status}`);
      const payload = record(data) ? data : {};
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const trace = element('subagentsTrace');
      if (reset && !messages.length) {
        const empty = document.createElement('div');
        empty.className = 'subagents-state';
        empty.textContent = 'No messages yet.';
        trace.appendChild(empty);
      }
      // Follow the tail only while the reader is already at it.
      const stickToTail = trace.scrollHeight - trace.scrollTop - trace.clientHeight < 80;
      for (const value of messages) {
        const html = renderer.message(value);
        if (!html) continue;
        const template = document.createElement('template');
        template.innerHTML = html.trim();
        const el = template.content.firstElementChild;
        if (el) trace.appendChild(el);
      }
      if (messages.length && (reset || stickToTail)) trace.scrollTop = trace.scrollHeight;
      // The empty after-page reports lastIndex null; keep the prior cursor.
      if (typeof payload.lastIndex === 'number') peekLastIndex = payload.lastIndex;
      else if (reset && typeof payload.lastIndex !== 'number') peekLastIndex = null;
    } catch (error) {
      if (stale()) return;
      if (reset) {
        const trace = element('subagentsTrace');
        trace.replaceChildren();
        const failure = document.createElement('div');
        failure.className = 'subagents-state';
        failure.textContent = `Trace unavailable: ${message(error)}`;
        trace.appendChild(failure);
      }
    }
  }

  async function sendSignal(kind: 'prompt' | 'steer' | 'followUp') {
    if (!owns() || !peekTarget || !viewEndpoint) return;
    const target = peekTarget, endpoint = viewEndpoint, seq = peekSeq;
    const input = element<HTMLTextAreaElement>('subagentsSignalInput');
    const text = input.value.trim();
    if (!text) return;
    const status = element('subagentsSignalStatus');
    const path = kind === 'steer' ? 'steer' : kind === 'followUp' ? 'follow-up' : 'prompt';
    status.textContent = 'Sending…';
    try {
      await sendJson(options.request, endpoint, `/api/sessions/${encodeURIComponent(target.id)}/${path}`, { message: text });
      if (!owns() || seq !== peekSeq || peekTarget !== target) return;
      input.value = '';
      status.textContent = kind === 'steer' ? 'Steered' : kind === 'followUp' ? 'Follow-up queued' : 'Sent';
    } catch (error) {
      if (!owns() || seq !== peekSeq || peekTarget !== target) return;
      status.textContent = message(error);
    }
  }

  async function openTarget() {
    if (!owns() || !peekTarget || !viewOwner || !viewEndpoint) return;
    const id = peekTarget.id, owner = viewOwner, endpoint = viewEndpoint;
    close();
    if (!sessionState.findSession(id, owner.host)) await options.loadPrevious();
    if (disposed || !sessionState.ownsSelection(owner) || !sameEndpoint(owner.host, endpoint)) return;
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
    const kind = target?.capabilities?.prompt ? 'prompt' : target?.capabilities?.steer ? 'steer' : 'followUp';
    void sendSignal(kind);
  }, { signal: events.signal });

  return {
    open, close, isOpen, reload: () => { if (owns()) void loadLineage(); },
    get selected() { return selectedId; },
    dispose() { close(); events.abort(); renderer.dispose(); disposed = true; },
  };
}
