import { errorMessage, responseError, sameEndpoint, sendJson, type ApiRequest, type HostEndpoint } from './api-client';
import { requiredElement } from './dom';
import type { SelectionOwner, SessionState } from './session-state';
import { formatRelativeTime } from './helper-format';
import { escapeHtml } from '../core/helper-format';
import { finite, record, text } from '../core/helper-values';
import { createMessageRenderer } from './message-render';
import { decodeRenderMessage } from './message-data';
import type { createResponseDetails } from './response-details';
import {
  EMPTY_SWARM,
  decodeSessionSwarm,
  type SessionSwarmPayload,
  type SwarmBoardPost,
  type SwarmMember,
} from './agy-views-data';

type SwarmTab = 'board' | 'members' | 'overview';

interface SwarmModelOption {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
}

interface MentionCandidate {
  readonly token: string;
  readonly label: string;
  readonly meta: string;
}

const MEMBER_PALETTE = ['var(--cyan)', 'var(--accent)', 'var(--success-bright)', 'var(--warning)', 'var(--orange)', 'var(--error)'];
const WORKER_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const MENTION_TRIGGER_RE = /(?:^|[\s(])@([a-z0-9_#-]*)$/i;

function memberColor(name: string): string {
  if (name === 'coordinator') return 'var(--accent)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return MEMBER_PALETTE[Math.abs(hash) % MEMBER_PALETTE.length];
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
    out.push({
      id,
      name: text(row.name) || id,
      provider: text(row.provider) || 'google-antigravity',
    });
  }
  return out;
}

export function createSwarmView(options: {
  root: HTMLElement;
  request: ApiRequest;
  sessionState: SessionState;
  endpoint: (host: string | null) => HostEndpoint | null;
  closeOtherViews: () => void;
  loadPrevious: () => Promise<unknown>;
  selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
  status: (message: string, kind?: string) => void;
  confirm: (message: string) => boolean;
  markdown: (text: string) => string;
  assetUrl: (host: string | null | undefined, path: string) => string;
  matchRef: (ref: string) => { name?: string | null; isActive?: boolean } | null | undefined;
  details: ReturnType<typeof createResponseDetails>;
}) {
  const document = options.root.ownerDocument;
  const sessionState = options.sessionState;
  const element = requiredElement(document, 'swarm view');

  let disposed = false;
  let viewOwner: SelectionOwner | null = null;
  let viewEndpoint: HostEndpoint | null = null;
  let swarm: SessionSwarmPayload = EMPTY_SWARM;
  let postsBySeq = new Map<number, SwarmBoardPost>();
  let activeTab: SwarmTab = 'board';
  let channelFilter = 'all';
  let memberFilter: string | null = null;
  let followBoard = true;
  let selectedMemberName: string | null = null;
  let addDrawerOpen = false;
  let coordModelsForId: string | null = null;
  let coordModels: SwarmModelOption[] = [];
  let modelsLoadingForId: string | null = null;
  let mentionChoices: MentionCandidate[] = [];
  let mentionIndex = 0;
  let loadSeq = 0;
  let loadInFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let peekSeq = 0;
  let peekLastIndex: number | null = null;
  let peekTimer: ReturnType<typeof setInterval> | undefined;
  const rapidTimers = new Set<ReturnType<typeof setTimeout>>();
  let viewEvents = new AbortController();
  const staticEvents = new AbortController();

  const renderer = createMessageRenderer({
    document, sessionState, details: options.details,
    markdown: content => options.markdown(content), assetUrl: options.assetUrl, matchRef: options.matchRef,
    pinned: container => container.scrollHeight - container.scrollTop - container.clientHeight < 40,
    follow: () => true,
    scroll: container => { container.scrollTop = container.scrollHeight; },
    jump: () => {},
    peek: () => {
      const m = selectedMember();
      return m ? { host: viewOwner?.host ?? null, model: m.model || null } : null;
    },
  });

  const owns = () => !disposed && !!viewOwner && sessionState.ownsSelection(viewOwner)
    && sameEndpoint(options.endpoint(viewOwner.host), viewEndpoint);
  const isOpen = () => !disposed && options.root.classList.contains('swarm-open');

  function clearRapidTimers() {
    for (const timer of rapidTimers) clearTimeout(timer);
    rapidTimers.clear();
  }

  function scheduleRapidRefresh(full = false) {
    for (const delay of [800, 2200]) {
      const timer = setTimeout(() => {
        rapidTimers.delete(timer);
        if (owns() && !loadInFlight) void load(full);
      }, delay);
      rapidTimers.add(timer);
    }
  }

  function selectedMember(): SwarmMember | null {
    if (!selectedMemberName) return null;
    return swarm.members.find(m => m.name === selectedMemberName) ?? null;
  }

  function sortedPosts(): SwarmBoardPost[] {
    return [...postsBySeq.values()].sort((a, b) => a.seq - b.seq);
  }

  function preferredDeliveryMode(): 'prompt' | 'steer' {
    return swarm.coordinatorTurnInProgress ? 'steer' : 'prompt';
  }

  function open(owner: SelectionOwner, endpoint: HostEndpoint, focusMember?: string) {
    if (disposed || !sessionState.ownsSelection(owner)) return;
    close();
    options.closeOtherViews();
    viewOwner = owner;
    viewEndpoint = Object.freeze({ ...endpoint });
    swarm = EMPTY_SWARM;
    postsBySeq = new Map();
    activeTab = focusMember ? 'members' : 'board';
    channelFilter = 'all';
    memberFilter = null;
    followBoard = true;
    selectedMemberName = focusMember || null;
    addDrawerOpen = false;
    coordModelsForId = null;
    coordModels = [];
    modelsLoadingForId = null;
    peekLastIndex = null;
    hideMentionMenu();
    options.root.classList.add('swarm-open');
    render();
    void load(true);
    pollTimer = setInterval(() => {
      if (!owns() || loadInFlight) return;
      if (!swarm.isActive && !sessionState.currentSession?.isActive) return;
      void load(false);
    }, 2500);
  }

  function close() {
    if (!isOpen()) return;
    loadSeq++;
    peekSeq++;
    clearInterval(pollTimer); pollTimer = undefined;
    clearInterval(peekTimer); peekTimer = undefined;
    clearRapidTimers();
    viewEvents.abort();
    hideMentionMenu();
    addDrawerOpen = false;
    element('swarmAddDrawer').style.display = 'none';
    viewOwner = null;
    viewEndpoint = null;
    selectedMemberName = null;
    peekLastIndex = null;
    options.root.classList.remove('swarm-open');
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

  async function loadCoordinatorModels() {
    if (!owns() || !viewEndpoint || !swarm.coordinatorId || !swarm.isActive) return;
    const coordId = swarm.coordinatorId;
    if (coordModelsForId === coordId || modelsLoadingForId === coordId) return;
    const endpoint = viewEndpoint, owner = viewOwner;
    modelsLoadingForId = coordId;
    try {
      const res = await options.request(endpoint, `/api/models?sessionId=${encodeURIComponent(coordId)}`);
      const payload: unknown = await res.json();
      if (!owns() || viewOwner !== owner || swarm.coordinatorId !== coordId) return;
      if (!res.ok) return;
      coordModels = decodeModelOptions(payload);
      coordModelsForId = coordId;
      populateAddModelSelect();
      renderMemberDetail();
    } catch { /* Model switcher stays hidden if catalog is unavailable. */ }
    finally {
      if (modelsLoadingForId === coordId) modelsLoadingForId = null;
    }
  }

  async function load(full: boolean) {
    if (!owns() || !viewOwner || !viewEndpoint) return;
    const owner = viewOwner, endpoint = viewEndpoint, seq = ++loadSeq;
    loadInFlight = true;
    const current = () => seq === loadSeq && owns() && viewOwner === owner;
    const since = !full && swarm.head > 0 ? `?since=${swarm.head}` : '';
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/swarm${since}`);
      const payload: unknown = await res.json();
      if (!current()) return;
      if (!res.ok) throw new Error(responseError(res, payload));
      const next = decodeSessionSwarm(payload);
      if (full) postsBySeq.clear();
      for (const post of next.posts) postsBySeq.set(post.seq, post);
      swarm = next;
      if (!selectedMemberName || !swarm.members.some(m => m.name === selectedMemberName)) {
        const firstWorker = swarm.members.find(m => m.name !== 'coordinator') ?? swarm.members[0] ?? null;
        selectedMemberName = firstWorker?.name ?? null;
      }
      render();
      if (swarm.hasSwarm && swarm.isActive && coordModelsForId !== swarm.coordinatorId) {
        void loadCoordinatorModels();
      }
      if (activeTab === 'members' && selectedMember()) syncPeekTimer();
    } catch (error) {
      if (current()) console.error('Failed to load swarm state:', error);
    } finally {
      loadInFlight = false;
    }
  }

  function setTab(tab: SwarmTab) {
    if (!owns()) return;
    activeTab = tab;
    render();
    if (tab === 'members' && selectedMember()) {
      void loadPeek(true);
      syncPeekTimer();
    } else {
      clearInterval(peekTimer); peekTimer = undefined;
    }
  }

  function selectMember(name: string, switchToMembers = true) {
    if (!owns()) return;
    selectedMemberName = name;
    if (switchToMembers) activeTab = 'members';
    render();
    if (activeTab === 'members') {
      void loadPeek(true);
      syncPeekTimer();
    }
  }

  function jumpToPost(seq: number) {
    if (!owns()) return;
    activeTab = 'board';
    channelFilter = 'all';
    memberFilter = null;
    followBoard = false;
    render();
    const target = element('swarmBoardFeed').querySelector<HTMLElement>(`[data-post-seq="${seq}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('swarm-post-highlight');
      setTimeout(() => target.classList.remove('swarm-post-highlight'), 1800);
    }
  }

  function syncPeekTimer() {
    clearInterval(peekTimer); peekTimer = undefined;
    const member = selectedMember();
    if (!member || !swarm.isActive || member.state === 'killed') return;
    peekTimer = setInterval(() => {
      if (owns() && activeTab === 'members' && selectedMember()?.name === member.name) void loadPeek(false);
    }, 2500);
  }

  async function loadPeek(reset: boolean) {
    const member = selectedMember();
    if (!owns() || !member || !member.routeId || !viewEndpoint) return;
    const endpoint = viewEndpoint, seq = ++peekSeq, targetRoute = member.routeId;
    const trace = element('swarmMemberTrace');
    if (reset) {
      peekLastIndex = null;
      trace.replaceChildren();
    }
    const stale = () => seq !== peekSeq || !owns() || selectedMember()?.routeId !== targetRoute;
    const query = peekLastIndex == null ? '?limit=50' : `?after=${peekLastIndex}`;
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(targetRoute)}/messages${query}`);
      const payload: unknown = await res.json();
      if (stale()) return;
      if (!res.ok) throw new Error(responseError(res, payload));
      const data = record(payload) ? payload : {};
      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (reset && !messages.length) {
        const empty = document.createElement('div');
        empty.className = 'subagents-state';
        empty.textContent = 'No messages yet.';
        trace.appendChild(empty);
      }
      const stick = trace.scrollHeight - trace.scrollTop - trace.clientHeight < 80;
      for (const value of messages) {
        const html = renderer.message(decodeRenderMessage(value));
        if (!html) continue;
        const tpl = document.createElement('template');
        tpl.innerHTML = html.trim();
        const node = tpl.content.firstElementChild;
        if (node) trace.appendChild(node);
      }
      if (messages.length && (reset || stick)) trace.scrollTop = trace.scrollHeight;
      if (typeof data.lastIndex === 'number') peekLastIndex = data.lastIndex;
      else if (reset) peekLastIndex = null;
    } catch (error) {
      if (stale()) return;
      if (reset) {
        trace.replaceChildren();
        const fail = document.createElement('div');
        fail.className = 'subagents-state';
        fail.textContent = `Trace unavailable: ${errorMessage(error)}`;
        trace.appendChild(fail);
      }
    }
  }

  async function dispatchCoordinatorText(
    message: string,
    mode: 'prompt' | 'steer' | 'auto' = 'auto',
    opts: { fullReload?: boolean; successText?: string } = {},
  ): Promise<boolean> {
    if (!owns() || !viewEndpoint || !swarm.coordinatorId) return false;
    const trimmed = message.trim();
    if (!trimmed) return false;
    const kind = mode === 'auto' ? preferredDeliveryMode() : mode;
    const statusEl = element('swarmPromptStatus');
    const endpoint = viewEndpoint, coordId = swarm.coordinatorId;
    statusEl.textContent = kind === 'steer' ? 'Steering coordinator…' : 'Sending to coordinator…';
    try {
      await sendJson(options.request, endpoint, `/api/sessions/${encodeURIComponent(coordId)}/${kind}`, { message: trimmed });
      if (!owns()) return false;
      const doneText = opts.successText || (kind === 'steer' ? 'Steered coordinator' : 'Sent to coordinator');
      statusEl.textContent = doneText;
      options.status(doneText, 'success');
      scheduleRapidRefresh(opts.fullReload === true);
      return true;
    } catch (error) {
      if (owns()) {
        const msg = errorMessage(error);
        statusEl.textContent = msg;
        options.status(msg, 'error');
      }
      return false;
    }
  }

  async function sendCoordinatorMessage(mode: 'prompt' | 'steer' | 'auto') {
    const input = element<HTMLTextAreaElement>('swarmPromptInput');
    const message = input.value.trim();
    if (!message) return;
    hideMentionMenu();
    const ok = await dispatchCoordinatorText(message, mode);
    if (ok && owns()) input.value = '';
  }

  async function abortCoordinatorTurn() {
    if (!owns() || !viewEndpoint || !swarm.coordinatorId) return;
    const endpoint = viewEndpoint, coordId = swarm.coordinatorId;
    const statusEl = element('swarmPromptStatus');
    statusEl.textContent = 'Stopping coordinator turn…';
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(coordId)}/abort`, { method: 'POST' });
      const payload: unknown = await res.json().catch(() => ({}));
      if (!owns()) return;
      if (!res.ok) throw new Error(responseError(res, payload));
      statusEl.textContent = 'Stop requested';
      options.status('Coordinator turn stop requested', 'success');
      scheduleRapidRefresh(false);
    } catch (error) {
      if (owns()) {
        const msg = errorMessage(error);
        statusEl.textContent = msg;
        options.status(msg, 'error');
      }
    }
  }

  async function switchMemberModel(member: SwarmMember, modelId: string) {
    if (!owns() || !viewEndpoint || !swarm.coordinatorId || !modelId || modelId === member.model) return;
    if (member.name === 'coordinator') {
      const chosen = coordModels.find(m => m.id === modelId);
      const endpoint = viewEndpoint, coordId = swarm.coordinatorId;
      try {
        await sendJson(options.request, endpoint, `/api/sessions/${encodeURIComponent(coordId)}/model`, {
          provider: chosen?.provider || 'google-antigravity',
          modelId,
        });
        if (!owns()) return;
        options.status(`Switched coordinator model to ${chosen?.name || modelId}`, 'success');
        scheduleRapidRefresh(false);
      } catch (error) {
        if (owns()) {
          options.status(`Model switch failed: ${errorMessage(error)}`, 'error');
          renderMemberDetail();
        }
      }
      return;
    }
    if (member.state === 'working') {
      options.status(`@${member.name} must be waiting before switching models`, 'error');
      renderMemberDetail();
      return;
    }
    const ok = await dispatchCoordinatorText(
      `Switch swarm worker "${member.name}" to model "${modelId}" using swarm(action:"model", name:${JSON.stringify(member.name)}, model:${JSON.stringify(modelId)}).`,
      'auto',
      { successText: `Requested model ${modelId} for @${member.name}` },
    );
    if (!ok && owns()) renderMemberDetail();
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
    if (!options.confirm(warnings.join('\n\n'))) return;
    await dispatchCoordinatorText(
      `Kill swarm worker "${member.name}" using swarm(action:"kill", name:${JSON.stringify(member.name)}).`,
      'auto',
      { successText: `Requested kill for @${member.name}` },
    );
  }

  async function sendMemberInlineMessage() {
    const member = selectedMember();
    if (!owns() || !member || member.state === 'killed') return;
    const input = element<HTMLInputElement>('swarmMemberInput');
    const raw = input.value.trim();
    if (!raw) return;
    const message = member.name === 'coordinator'
      ? raw
      : (raw.toLowerCase().startsWith(`@${member.name.toLowerCase()}`)
        ? `Post this to the swarm board: ${raw}`
        : `Post this to the swarm board for @${member.name}: @${member.name} ${raw}`);
    const ok = await dispatchCoordinatorText(message, 'auto', {
      successText: member.name === 'coordinator' ? 'Sent to coordinator' : `Messaged @${member.name}`,
    });
    if (ok && owns()) input.value = '';
  }

  function populateAddModelSelect() {
    const select = element<HTMLSelectElement>('swarmAddModel');
    const prev = select.value;
    select.replaceChildren();
    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'Coordinator default';
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
    const select = element<HTMLSelectElement>('swarmAddFork');
    const prev = select.value;
    select.replaceChildren();
    const fresh = document.createElement('option');
    fresh.value = '';
    fresh.textContent = 'Fresh conversation';
    select.appendChild(fresh);
    for (const m of swarm.members) {
      if (m.state === 'killed') continue;
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name === 'coordinator' ? 'coordinator' : `@${m.name}`;
      select.appendChild(opt);
    }
    if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
  }

  function setAddDrawerOpen(openState: boolean) {
    addDrawerOpen = openState && swarm.hasSwarm && swarm.isActive;
    const drawer = element('swarmAddDrawer');
    drawer.style.display = addDrawerOpen ? 'flex' : 'none';
    element('swarmAddError').textContent = '';
    if (addDrawerOpen) {
      populateAddModelSelect();
      populateAddForkSelect();
      if (coordModelsForId !== swarm.coordinatorId) void loadCoordinatorModels();
      element<HTMLInputElement>('swarmAddName').focus();
    }
  }

  async function submitAddWorker() {
    if (!owns() || !swarm.hasSwarm || !swarm.isActive) return;
    const nameEl = element<HTMLInputElement>('swarmAddName');
    const briefEl = element<HTMLTextAreaElement>('swarmAddBrief');
    const modelEl = element<HTMLSelectElement>('swarmAddModel');
    const wsEl = element<HTMLSelectElement>('swarmAddWorkspace');
    const forkEl = element<HTMLSelectElement>('swarmAddFork');
    const errEl = element('swarmAddError');

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
    if (swarm.members.some(m => m.name.toLowerCase() === name)) {
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

    const params = [
      `action:"add"`,
      `name:${JSON.stringify(name)}`,
      `workspace:${JSON.stringify(workspace)}`,
    ];
    if (model) params.push(`model:${JSON.stringify(model)}`);
    if (fork) params.push(`fork:${JSON.stringify(fork)}`);
    params.push(`brief:${JSON.stringify(brief)}`);

    const ok = await dispatchCoordinatorText(
      `Add a new swarm worker using swarm(${params.join(', ')}).`,
      'auto',
      { successText: `Spawning @${name}…` },
    );
    if (ok && owns()) {
      nameEl.value = '';
      briefEl.value = '';
      setAddDrawerOpen(false);
    }
  }

  function insertMentionToken(token: string) {
    const input = element<HTMLTextAreaElement>('swarmPromptInput');
    const insert = `@${token} `;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const needsSpace = before.length > 0 && !/[\s(]$/.test(before);
    const prefix = needsSpace ? ' ' : '';
    input.value = `${before}${prefix}${insert}${after}`;
    const caret = before.length + prefix.length + insert.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    hideMentionMenu();
  }

  function prefillReply(post: SwarmBoardPost) {
    if (!owns() || !swarm.isActive) return;
    const input = element<HTMLTextAreaElement>('swarmPromptInput');
    const prefix = `@${post.agent} (re #${post.seq}) `;
    const current = input.value.trim();
    input.value = current ? `${prefix}${current}` : prefix;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function buildMentionCandidates(query: string): MentionCandidate[] {
    const q = query.toLowerCase();
    const out: MentionCandidate[] = [];
    for (const m of swarm.members) {
      if (m.state === 'killed') continue;
      if (!q || m.name.toLowerCase().includes(q)) {
        out.push({ token: m.name, label: `@${m.name}`, meta: m.state });
      }
    }
    if (!q || 'all'.includes(q)) {
      out.push({ token: 'all', label: '@all', meta: 'broadcast' });
    }
    for (const ch of swarm.channels) {
      if (ch.name === 'main' || ch.archived) continue;
      const chToken = `#${ch.name}`;
      if (!q || chToken.toLowerCase().includes(q) || ch.name.toLowerCase().includes(q)) {
        out.push({ token: chToken, label: `@${chToken}`, meta: ch.topic || 'channel' });
      }
    }
    return out.slice(0, 10);
  }

  function hideMentionMenu() {
    mentionChoices = [];
    mentionIndex = 0;
    const menu = element('swarmMentionMenu');
    menu.style.display = 'none';
    menu.replaceChildren();
  }

  function renderMentionMenu() {
    const menu = element('swarmMentionMenu');
    menu.replaceChildren();
    if (!mentionChoices.length) {
      menu.style.display = 'none';
      return;
    }
    mentionIndex = Math.max(0, Math.min(mentionIndex, mentionChoices.length - 1));
    menu.style.display = 'flex';
    mentionChoices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `swarm-mention-option${idx === mentionIndex ? ' active' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(idx === mentionIndex));
      const label = document.createElement('span');
      label.textContent = choice.label;
      const meta = document.createElement('span');
      meta.className = 'swarm-mention-option-meta';
      meta.textContent = choice.meta;
      btn.append(label, meta);
      btn.addEventListener('mousedown', (event) => {
        event.preventDefault();
        acceptMentionChoice(choice.token);
      });
      menu.appendChild(btn);
    });
  }

  function updateMentionMenuFromInput() {
    const input = element<HTMLTextAreaElement>('swarmPromptInput');
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    const match = MENTION_TRIGGER_RE.exec(before);
    if (!match) {
      hideMentionMenu();
      return;
    }
    mentionChoices = buildMentionCandidates(match[1]);
    mentionIndex = 0;
    renderMentionMenu();
  }

  function acceptMentionChoice(token: string) {
    const input = element<HTMLTextAreaElement>('swarmPromptInput');
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    const after = input.value.slice(caret);
    const match = MENTION_TRIGGER_RE.exec(before);
    if (!match) {
      insertMentionToken(token);
      return;
    }
    const atPos = before.lastIndexOf('@');
    const nextBefore = `${before.slice(0, atPos)}@${token} `;
    input.value = `${nextBefore}${after}`;
    input.focus();
    input.setSelectionRange(nextBefore.length, nextBefore.length);
    hideMentionMenu();
  }

  function renderMentionPills() {
    const pills = element('swarmMentionPills');
    pills.replaceChildren();
    if (!swarm.hasSwarm || !swarm.isActive) return;
    const liveWorkers = swarm.members.filter(m => m.state !== 'killed' && m.name !== 'coordinator');
    const tokens: { token: string; label: string; color?: string }[] = liveWorkers.map(m => ({
      token: m.name,
      label: `@${m.name}`,
      color: memberColor(m.name),
    }));
    if (liveWorkers.length) tokens.push({ token: 'all', label: '@all' });
    for (const ch of swarm.channels) {
      if (ch.name === 'main' || ch.archived) continue;
      tokens.push({ token: `#${ch.name}`, label: `@#${ch.name}` });
    }
    for (const item of tokens) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swarm-mention-pill';
      btn.textContent = item.label;
      if (item.color) btn.style.color = item.color;
      btn.title = `Insert ${item.label}`;
      btn.addEventListener('click', () => insertMentionToken(item.token), { signal: viewEvents.signal });
      pills.appendChild(btn);
    }
  }

  async function openSelectedMemberSession() {
    const member = selectedMember();
    if (!owns() || !member || !member.routeId || !viewOwner || !viewEndpoint) return;
    const id = member.routeId, owner = viewOwner, endpoint = viewEndpoint;
    close();
    if (!sessionState.findSession(id, owner.host)) await options.loadPrevious();
    if (disposed || !sessionState.ownsSelection(owner) || !sameEndpoint(options.endpoint(owner.host), endpoint)) return;
    if (!sessionState.findSession(id, owner.host)) {
      options.status('Swarm member session is not indexed yet', 'error');
      return;
    }
    await options.selectSession(id, { host: owner.host });
  }

  function renderRoster(container: HTMLElement, compact: boolean) {
    container.replaceChildren();
    if (!swarm.members.length) {
      const empty = document.createElement('div');
      empty.className = 'subagents-state';
      empty.textContent = 'No swarm members yet.';
      container.appendChild(empty);
      return;
    }
    for (const member of swarm.members) {
      const row = document.createElement('div');
      row.className = `swarm-member-row state-${member.state}${member.name === selectedMemberName && !compact ? ' selected' : ''}${memberFilter === member.name && compact ? ' filtered' : ''}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');

      const top = document.createElement('div');
      top.className = 'swarm-member-top';
      const dot = document.createElement('span');
      dot.className = `swarm-state-dot state-${member.state}`;
      const name = document.createElement('span');
      name.className = 'swarm-member-name';
      name.style.color = memberColor(member.name);
      name.textContent = member.name === 'coordinator' ? 'coordinator' : `@${member.name}`;
      const state = document.createElement('span');
      state.className = `swarm-state-pill state-${member.state}`;
      state.textContent = member.state;
      top.append(dot, name, state);

      if (compact) {
        const filterBtn = document.createElement('button');
        filterBtn.type = 'button';
        filterBtn.className = `swarm-filter-mini${memberFilter === member.name ? ' active' : ''}`;
        filterBtn.title = memberFilter === member.name ? 'Clear board filter' : `Filter board to ${member.name}`;
        filterBtn.textContent = '⚑';
        filterBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          memberFilter = memberFilter === member.name ? null : member.name;
          render();
        }, { signal: viewEvents.signal });
        top.appendChild(filterBtn);
      }
      row.appendChild(top);

      const meta = document.createElement('div');
      meta.className = 'swarm-member-meta';
      const bits: string[] = [];
      if (member.model) bits.push(member.model);
      if (member.workspaceMode && member.workspaceMode !== 'inherit') bits.push(member.workspaceMode);
      if (member.lastPostSeq !== null) bits.push(`#${member.lastPostSeq}`);
      if (member.unreadCount > 0) bits.push(`${member.unreadCount} unread`);
      meta.textContent = bits.join(' · ');
      row.appendChild(meta);

      if (member.currentAction) {
        const act = document.createElement('div');
        act.className = 'swarm-member-action';
        act.textContent = member.currentAction;
        row.appendChild(act);
      }

      const activate = () => selectMember(member.name, true);
      row.addEventListener('click', activate, { signal: viewEvents.signal });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      }, { signal: viewEvents.signal });
      container.appendChild(row);
    }
  }

  function renderBoard() {
    const filters = element('swarmBoardFilters');
    filters.replaceChildren();

    if (swarm.channels.length > 1) {
      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = `swarm-filter-chip${channelFilter === 'all' ? ' active' : ''}`;
      allBtn.textContent = `All (${swarm.head})`;
      allBtn.addEventListener('click', () => { channelFilter = 'all'; render(); }, { signal: viewEvents.signal });
      filters.appendChild(allBtn);
      for (const ch of swarm.channels) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `swarm-filter-chip${channelFilter === ch.name ? ' active' : ''}`;
        btn.textContent = `#${ch.name} (${ch.postCount})`;
        if (ch.topic) btn.title = ch.topic;
        btn.addEventListener('click', () => { channelFilter = ch.name; render(); }, { signal: viewEvents.signal });
        filters.appendChild(btn);
      }
    }

    if (memberFilter) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'swarm-filter-chip active';
      chip.textContent = `@${memberFilter} ×`;
      chip.title = 'Clear member filter';
      chip.addEventListener('click', () => { memberFilter = null; render(); }, { signal: viewEvents.signal });
      filters.appendChild(chip);
    }

    const spacer = document.createElement('span');
    spacer.className = 'swarm-filter-spacer';
    filters.appendChild(spacer);

    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    followBtn.className = `swarm-filter-chip${followBoard ? ' active' : ''}`;
    followBtn.textContent = followBoard ? '● Follow' : '○ Follow';
    followBtn.title = 'Auto-scroll to new board posts';
    followBtn.addEventListener('click', () => { followBoard = !followBoard; render(); }, { signal: viewEvents.signal });
    filters.appendChild(followBtn);

    const feed = element('swarmBoardFeed');
    const wasPinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
    const prevScroll = feed.scrollTop;
    feed.replaceChildren();

    if (!swarm.hasSwarm) {
      if (swarm.isActive) {
        const card = document.createElement('div');
        card.className = 'swarm-start-card';
        const heading = document.createElement('div');
        heading.className = 'swarm-overview-heading';
        heading.textContent = 'Start a Swarm';
        const desc = document.createElement('div');
        desc.className = 'swarm-overview-line';
        desc.textContent = 'Coordinate parallel Antigravity workers on a shared board in this session.';
        const ta = document.createElement('textarea');
        ta.id = 'swarmStartInput';
        ta.rows = 3;
        ta.placeholder = 'Describe the goal to split across workers…';
        const actions = document.createElement('div');
        actions.className = 'swarm-start-actions';
        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.id = 'swarmStartBtn';
        startBtn.className = 'btn btn-small btn-primary';
        startBtn.textContent = 'Start Swarm';
        const launch = async () => {
          const task = ta.value.trim();
          if (!task) { ta.focus(); return; }
          startBtn.disabled = true;
          const ok = await dispatchCoordinatorText(`/swarm ${task}`, 'prompt', {
            fullReload: true,
            successText: 'Swarm start sent',
          });
          if (owns()) {
            startBtn.disabled = false;
            if (ok) ta.value = '';
          }
        };
        startBtn.addEventListener('click', () => { void launch(); }, { signal: viewEvents.signal });
        ta.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void launch();
          }
        }, { signal: viewEvents.signal });
        actions.appendChild(startBtn);
        card.append(heading, desc, ta, actions);
        feed.appendChild(card);
        return;
      }
      const empty = document.createElement('div');
      empty.className = 'subagents-state';
      empty.textContent = 'No swarm recorded in this session.';
      feed.appendChild(empty);
      return;
    }

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
      return;
    }

    for (const post of filtered) {
      const card = document.createElement('article');
      card.className = `swarm-post${post.kind === 'brief' ? ' is-brief' : ''}${post.tags.includes('done') ? ' is-done' : ''}${post.tags.includes('stall') ? ' is-stall' : ''}`;
      card.dataset.postSeq = String(post.seq);

      const header = document.createElement('div');
      header.className = 'swarm-post-header';
      const seqEl = document.createElement('span');
      seqEl.className = 'swarm-post-seq';
      seqEl.textContent = `#${post.seq}`;
      const authorBtn = document.createElement('button');
      authorBtn.type = 'button';
      authorBtn.className = 'swarm-post-author';
      authorBtn.style.color = memberColor(post.agent);
      authorBtn.textContent = post.agent === 'coordinator' ? 'coordinator' : `@${post.agent}`;
      authorBtn.title = `Filter by ${post.agent}`;
      authorBtn.addEventListener('click', () => {
        memberFilter = memberFilter === post.agent ? null : post.agent;
        render();
      }, { signal: viewEvents.signal });
      header.append(seqEl, authorBtn);

      if (post.channel && post.channel !== 'main') {
        const ch = document.createElement('span');
        ch.className = 'swarm-post-badge';
        ch.textContent = `#${post.channel}`;
        header.appendChild(ch);
      }
      if (post.kind) {
        const kind = document.createElement('span');
        kind.className = 'swarm-post-badge';
        kind.textContent = post.kind;
        header.appendChild(kind);
      }
      for (const tag of post.tags) {
        const badge = document.createElement('span');
        badge.className = `swarm-post-badge tag-${tag}`;
        badge.textContent = tag;
        header.appendChild(badge);
      }
      if (post.mentions.length) {
        const to = document.createElement('span');
        to.className = 'swarm-post-mentions';
        to.textContent = `→ ${post.mentions.map(m => `@${m}`).join(' ')}`;
        header.appendChild(to);
      }
      const time = document.createElement('span');
      time.className = 'swarm-post-time';
      time.textContent = post.time;
      header.appendChild(time);

      if (swarm.isActive) {
        const replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'swarm-post-reply-btn';
        replyBtn.title = `Reply to #${post.seq}`;
        replyBtn.textContent = '↩';
        replyBtn.addEventListener('click', () => prefillReply(post), { signal: viewEvents.signal });
        header.appendChild(replyBtn);
      }

      const body = document.createElement('div');
      body.className = 'swarm-post-body markdown-body';
      body.innerHTML = options.markdown(post.text);

      card.append(header, body);
      feed.appendChild(card);
    }

    if (followBoard && wasPinned) feed.scrollTop = feed.scrollHeight;
    else feed.scrollTop = prevScroll;
  }

  function renderMemberDetail() {
    const empty = element('swarmMemberDetailEmpty');
    const content = element('swarmMemberDetailContent');
    const member = selectedMember();
    if (!member) {
      empty.style.display = '';
      content.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    content.style.display = 'flex';
    element('swarmMemberDetailName').textContent = member.name === 'coordinator' ? 'coordinator' : `@${member.name}`;
    const bits = [member.state, member.model, member.workspaceMode !== 'inherit' ? member.workspaceMode : '', member.lastActivity ? formatRelativeTime(member.lastActivity) : ''];
    element('swarmMemberDetailMeta').textContent = bits.filter(Boolean).join(' · ');

    const isCoord = member.name === 'coordinator';
    const alive = member.state !== 'killed';

    // Model selector (coordinator switches directly; waiting workers via swarm(action:"model"))
    const modelSel = element<HTMLSelectElement>('swarmMemberModelSelect');
    if (swarm.isActive && alive && coordModels.length > 0) {
      modelSel.style.display = '';
      modelSel.replaceChildren();
      const ids = new Set(coordModels.map(m => m.id));
      if (member.model && !ids.has(member.model)) {
        const cur = document.createElement('option');
        cur.value = member.model;
        cur.textContent = member.model;
        modelSel.appendChild(cur);
      }
      for (const m of coordModels) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        modelSel.appendChild(opt);
      }
      if (member.model) modelSel.value = member.model;
      const locked = !isCoord && member.state === 'working';
      modelSel.disabled = locked;
      modelSel.title = locked
        ? 'Model switch is only available while worker is waiting'
        : (isCoord ? 'Switch coordinator model' : `Switch @${member.name} model`);
    } else {
      modelSel.style.display = 'none';
    }

    // Ping / Resume button
    const pingBtn = element<HTMLButtonElement>('swarmMemberPingBtn');
    const canPing = swarm.isActive && !isCoord && alive && member.state !== 'working';
    pingBtn.style.display = canPing ? '' : 'none';
    if (canPing) {
      const isMonitor = /^monitor(?:-\d+)?$/.test(member.name);
      pingBtn.textContent = isMonitor || member.state === 'stopped' ? 'Resume' : 'Ping';
      pingBtn.title = isMonitor ? `Post @${member.name} resume` : `Nudge @${member.name} for a status update`;
    }

    // Kill button
    const killBtn = element<HTMLButtonElement>('swarmMemberKillBtn');
    killBtn.style.display = swarm.isActive && !isCoord && alive ? '' : 'none';

    // Inline @member message bar
    const memberComposer = element('swarmMemberComposer');
    memberComposer.style.display = swarm.isActive && alive ? 'flex' : 'none';
    const memberInput = element<HTMLInputElement>('swarmMemberInput');
    memberInput.placeholder = isCoord ? 'Message coordinator…' : `Message @${member.name} via board…`;
  }

  function renderOverview() {
    const container = element('swarmOverviewBody');
    container.replaceChildren();
    if (!swarm.hasSwarm) {
      const empty = document.createElement('div');
      empty.className = 'subagents-state';
      empty.textContent = 'No swarm active in this session.';
      container.appendChild(empty);
      return;
    }

    const view = swarm.narratorView;
    const plan = swarm.plan;
    const goal = (record(view?.goal) ? view.goal : record(plan?.goal) ? plan.goal : null);

    // Goal card
    const goalCard = document.createElement('div');
    goalCard.className = 'swarm-overview-card';
    const goalTitle = text(goal?.title) || swarm.title;
    const goalLine = text(goal?.line) || text(view?.headline) || `${swarm.members.length} members · ${swarm.head} board post${swarm.head === 1 ? '' : 's'}`;
    goalCard.innerHTML = `<div class="swarm-overview-heading">${escapeHtml(goalTitle)}</div><div class="swarm-overview-line">${escapeHtml(goalLine)}</div>`
      + (text(view?.running_summary) ? `<div class="swarm-overview-summary">${escapeHtml(text(view?.running_summary))}</div>` : '');
    container.appendChild(goalCard);

    // Attention items (from narrator view.json)
    const attention = Array.isArray(view?.attention) ? view.attention.filter(record) : [];
    if (attention.length) {
      const sec = document.createElement('div');
      sec.className = 'swarm-overview-section';
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
          const refRow = document.createElement('div');
          refRow.className = 'swarm-overview-refs';
          for (const ref of refs) {
            if (finite(ref.seq)) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'swarm-filter-chip';
              btn.textContent = `#${ref.seq}`;
              btn.addEventListener('click', () => jumpToPost(ref.seq as number), { signal: viewEvents.signal });
              refRow.appendChild(btn);
            }
          }
          card.appendChild(refRow);
        }
        sec.appendChild(card);
      }
      container.appendChild(sec);
    }

    // Threads / Workstreams (from plan.json or narrator view.json)
    const workstreams = Array.isArray(view?.workstreams) ? view.workstreams.filter(record) : [];
    const threads = Array.isArray(plan?.threads) ? plan.threads.filter(record) : [];
    const planTasks = record(plan?.tasks) ? plan.tasks : null;
    if (workstreams.length) {
      const sec = document.createElement('div');
      sec.className = 'swarm-overview-section';
      sec.innerHTML = '<div class="tasks-section-title">Workstreams</div>';
      for (const ws of workstreams) {
        const card = document.createElement('div');
        card.className = 'swarm-overview-card';
        const title = text(record(ws.short) ? ws.short.title : undefined) || text(ws.title);
        const note = text(record(ws.short) ? ws.short.line : undefined) || text(ws.note);
        const owners = Array.isArray(ws.owners) ? ws.owners.filter((o): o is string => typeof o === 'string').map(o => `@${o}`).join(' ') : '';
        card.innerHTML = `<div class="swarm-overview-item-title"><span class="swarm-state-pill state-${escapeHtml(text(ws.state))}">${escapeHtml(text(ws.state) || 'active')}</span> ${escapeHtml(title)}${owners ? ` <span class="swarm-post-mentions">${escapeHtml(owners)}</span>` : ''}</div>`
          + (note ? `<div class="swarm-overview-line">${escapeHtml(note)}</div>` : '');
        sec.appendChild(card);
      }
      container.appendChild(sec);
    } else if (threads.length) {
      const sec = document.createElement('div');
      sec.className = 'swarm-overview-section';
      sec.innerHTML = '<div class="tasks-section-title">Threads</div>';
      for (const thread of threads) {
        const card = document.createElement('div');
        card.className = 'swarm-overview-card';
        const taskNames = Array.isArray(thread.tasks) ? thread.tasks.filter((t): t is string => typeof t === 'string') : [];
        const listHtml = taskNames.map(name => `<li><code>@${escapeHtml(name)}</code> ${escapeHtml(text(planTasks?.[name]))}</li>`).join('');
        card.innerHTML = `<div class="swarm-overview-item-title">${escapeHtml(text(thread.title))}</div>`
          + (text(thread.goal) ? `<div class="swarm-overview-line">${escapeHtml(text(thread.goal))}</div>` : '')
          + (listHtml ? `<ul class="swarm-overview-tasks">${listHtml}</ul>` : '');
        sec.appendChild(card);
      }
      container.appendChild(sec);
    }

    // Narrator feedback bar (strips @ from body so workers aren't woken unintentionally)
    const narrator = swarm.members.find(m => /^narrator(?:-\d+)?$/.test(m.name) && m.state !== 'killed');
    if (swarm.isActive && narrator) {
      const fbCard = document.createElement('div');
      fbCard.className = 'swarm-overview-card';
      const title = document.createElement('div');
      title.className = 'swarm-overview-item-title';
      title.textContent = `Feedback for @${narrator.name}`;
      const row = document.createElement('div');
      row.className = 'swarm-narrator-feedback';
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'swarmNarratorFeedbackInput';
      input.placeholder = 'Correct summary, priority, or status…';
      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.id = 'swarmNarratorFeedbackBtn';
      sendBtn.className = 'btn btn-small';
      sendBtn.textContent = 'Send feedback';
      const submitFeedback = async () => {
        const raw = input.value.trim();
        if (!raw) { input.focus(); return; }
        const sanitized = raw.replace(/@([a-z0-9_#-]+)/gi, '$1');
        const ok = await dispatchCoordinatorText(
          `Post this verbatim to the swarm board: @${narrator.name} user feedback: ${sanitized}`,
          'auto',
          { successText: `Sent feedback to @${narrator.name}` },
        );
        if (ok && owns()) input.value = '';
      };
      sendBtn.addEventListener('click', () => { void submitFeedback(); }, { signal: viewEvents.signal });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void submitFeedback();
        }
      }, { signal: viewEvents.signal });
      row.append(input, sendBtn);
      fbCard.append(title, row);
      container.appendChild(fbCard);
    }

    // Live Member Summary
    const memberSec = document.createElement('div');
    memberSec.className = 'swarm-overview-section';
    memberSec.innerHTML = `<div class="tasks-section-title">Roster (${swarm.members.length})</div>`;
    for (const member of swarm.members) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'swarm-overview-card swarm-overview-member-btn';
      card.innerHTML = `<div class="swarm-overview-item-title"><span class="swarm-state-dot state-${escapeHtml(member.state)}"></span><strong style="color:${memberColor(member.name)}">${escapeHtml(member.name === 'coordinator' ? 'coordinator' : `@${member.name}`)}</strong> <span class="swarm-state-pill state-${escapeHtml(member.state)}">${escapeHtml(member.state)}</span> <span class="swarm-post-mentions">${escapeHtml(member.model)}</span></div>`
        + (member.currentAction ? `<div class="swarm-overview-line">${escapeHtml(member.currentAction)}</div>` : '');
      card.addEventListener('click', () => selectMember(member.name, true), { signal: viewEvents.signal });
      memberSec.appendChild(card);
    }
    container.appendChild(memberSec);
  }

  function render() {
    if (!owns() || !isOpen()) return;
    viewEvents.abort();
    viewEvents = new AbortController();

    element('swarmViewTitle').textContent = swarm.hasSwarm ? `Swarm · ${swarm.title}` : 'Swarm';
    const working = swarm.members.filter(m => m.state === 'working').length;
    const waiting = swarm.members.filter(m => m.state === 'waiting').length;
    const bits: string[] = [];
    if (swarm.hasSwarm) {
      if (working) bits.push(`${working} working`);
      if (waiting) bits.push(`${waiting} waiting`);
      bits.push(`${swarm.head} post${swarm.head === 1 ? '' : 's'}`);
      if (!swarm.isActive) bits.push('ended');
    } else {
      bits.push('No swarm yet');
    }
    element('swarmViewNote').textContent = bits.join(' · ');

    // Header + Add worker button
    const canManage = swarm.hasSwarm && swarm.isActive;
    element('swarmAddWorkerBtn').style.display = canManage ? '' : 'none';
    if (!canManage && addDrawerOpen) setAddDrawerOpen(false);
    else if (addDrawerOpen) populateAddForkSelect();

    // Tabs
    const tabs: { id: string; tab: SwarmTab }[] = [
      { id: 'swarmTabBoard', tab: 'board' },
      { id: 'swarmTabMembers', tab: 'members' },
      { id: 'swarmTabOverview', tab: 'overview' },
    ];
    for (const { id, tab } of tabs) {
      const btn = element(id);
      btn.classList.toggle('active', activeTab === tab);
      btn.setAttribute('aria-selected', String(activeTab === tab));
    }
    element('swarmTabMembersCount').textContent = swarm.members.length ? ` (${swarm.members.length})` : '';

    element('swarmPaneBoard').style.display = activeTab === 'board' ? 'flex' : 'none';
    element('swarmPaneMembers').style.display = activeTab === 'members' ? 'flex' : 'none';
    element('swarmPaneOverview').style.display = activeTab === 'overview' ? 'block' : 'none';

    if (activeTab === 'board') {
      renderRoster(element('swarmBoardRoster'), true);
      renderBoard();
    } else if (activeTab === 'members') {
      renderRoster(element('swarmMembersList'), false);
      renderMemberDetail();
    } else {
      renderOverview();
    }

    // Coordinator composer visibility & smart Send/Steer/Stop controls
    const composer = element('swarmComposer');
    composer.style.display = canManage ? '' : 'none';
    if (canManage) {
      renderMentionPills();
      const busy = swarm.coordinatorTurnInProgress;
      element('swarmCoordinatorStopBtn').style.display = busy ? '' : 'none';
      element('swarmPromptSteerBtn').classList.toggle('btn-primary', busy);
      element('swarmPromptSendBtn').classList.toggle('btn-primary', !busy);
    }
  }

  // Static listeners
  element('swarmTabBoard').addEventListener('click', () => setTab('board'), { signal: staticEvents.signal });
  element('swarmTabMembers').addEventListener('click', () => setTab('members'), { signal: staticEvents.signal });
  element('swarmTabOverview').addEventListener('click', () => setTab('overview'), { signal: staticEvents.signal });
  element('swarmAddWorkerBtn').addEventListener('click', () => setAddDrawerOpen(!addDrawerOpen), { signal: staticEvents.signal });
  element('swarmAddCancelBtn').addEventListener('click', () => setAddDrawerOpen(false), { signal: staticEvents.signal });
  element('swarmAddSubmitBtn').addEventListener('click', () => { void submitAddWorker(); }, { signal: staticEvents.signal });
  element<HTMLTextAreaElement>('swarmAddBrief').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitAddWorker();
    }
  }, { signal: staticEvents.signal });

  element('swarmMemberOpenBtn').addEventListener('click', () => { void openSelectedMemberSession(); }, { signal: staticEvents.signal });
  element('swarmMemberFilterBtn').addEventListener('click', () => {
    const member = selectedMember();
    if (!member) return;
    memberFilter = member.name;
    setTab('board');
  }, { signal: staticEvents.signal });
  element<HTMLSelectElement>('swarmMemberModelSelect').addEventListener('change', (event) => {
    const member = selectedMember();
    if (!member) return;
    const select = event.currentTarget as HTMLSelectElement;
    void switchMemberModel(member, select.value);
  }, { signal: staticEvents.signal });
  element('swarmMemberPingBtn').addEventListener('click', () => {
    const member = selectedMember();
    if (member) void pingMember(member);
  }, { signal: staticEvents.signal });
  element('swarmMemberKillBtn').addEventListener('click', () => {
    const member = selectedMember();
    if (member) void killMember(member);
  }, { signal: staticEvents.signal });
  element('swarmMemberSendBtn').addEventListener('click', () => { void sendMemberInlineMessage(); }, { signal: staticEvents.signal });
  element<HTMLInputElement>('swarmMemberInput').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void sendMemberInlineMessage();
  }, { signal: staticEvents.signal });

  element('swarmCoordinatorStopBtn').addEventListener('click', () => { void abortCoordinatorTurn(); }, { signal: staticEvents.signal });
  element('swarmPromptSendBtn').addEventListener('click', () => { void sendCoordinatorMessage('prompt'); }, { signal: staticEvents.signal });
  element('swarmPromptSteerBtn').addEventListener('click', () => { void sendCoordinatorMessage('steer'); }, { signal: staticEvents.signal });
  const promptInput = element<HTMLTextAreaElement>('swarmPromptInput');
  promptInput.addEventListener('input', () => updateMentionMenuFromInput(), { signal: staticEvents.signal });
  promptInput.addEventListener('blur', () => { setTimeout(() => hideMentionMenu(), 120); }, { signal: staticEvents.signal });
  promptInput.addEventListener('keydown', (event) => {
    if (mentionChoices.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        mentionIndex = (mentionIndex + 1) % mentionChoices.length;
        renderMentionMenu();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        mentionIndex = (mentionIndex - 1 + mentionChoices.length) % mentionChoices.length;
        renderMentionMenu();
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        acceptMentionChoice(mentionChoices[mentionIndex].token);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideMentionMenu();
        return;
      }
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void sendCoordinatorMessage('auto');
  }, { signal: staticEvents.signal });

  return {
    open,
    close,
    dismissOverlay,
    isOpen,
    reload: () => { if (owns()) void load(true); },
    dispose() { close(); staticEvents.abort(); renderer.dispose(); disposed = true; },
  };
}
