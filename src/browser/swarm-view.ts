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

const MEMBER_PALETTE = ['var(--cyan)', 'var(--accent)', 'var(--success-bright)', 'var(--warning)', 'var(--orange)', 'var(--error)'];

function memberColor(name: string): string {
  if (name === 'coordinator') return 'var(--accent)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return MEMBER_PALETTE[Math.abs(hash) % MEMBER_PALETTE.length];
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
  let loadSeq = 0;
  let loadInFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let peekSeq = 0;
  let peekLastIndex: number | null = null;
  let peekTimer: ReturnType<typeof setInterval> | undefined;
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

  function selectedMember(): SwarmMember | null {
    if (!selectedMemberName) return null;
    return swarm.members.find(m => m.name === selectedMemberName) ?? null;
  }

  function sortedPosts(): SwarmBoardPost[] {
    return [...postsBySeq.values()].sort((a, b) => a.seq - b.seq);
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
    peekLastIndex = null;
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
    viewEvents.abort();
    viewOwner = null;
    viewEndpoint = null;
    selectedMemberName = null;
    peekLastIndex = null;
    options.root.classList.remove('swarm-open');
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

  async function sendCoordinatorMessage(kind: 'prompt' | 'steer') {
    if (!owns() || !viewEndpoint || !swarm.coordinatorId) return;
    const input = element<HTMLTextAreaElement>('swarmPromptInput');
    const message = input.value.trim();
    if (!message) return;
    const status = element('swarmPromptStatus');
    const endpoint = viewEndpoint, coordId = swarm.coordinatorId;
    status.textContent = kind === 'steer' ? 'Steering coordinator…' : 'Sending to coordinator…';
    try {
      await sendJson(options.request, endpoint, `/api/sessions/${encodeURIComponent(coordId)}/${kind}`, { message });
      if (!owns()) return;
      input.value = '';
      status.textContent = kind === 'steer' ? 'Steered coordinator' : 'Sent to coordinator';
      setTimeout(() => { if (owns()) void load(false); }, 800);
    } catch (error) {
      if (owns()) status.textContent = errorMessage(error);
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
      empty.textContent = swarm.hasSwarm ? 'No board posts match the current filter.' : 'No swarm active in this session. Start one with /swarm <task>.';
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

    // Coordinator composer visibility
    const composer = element('swarmComposer');
    const canMessage = swarm.hasSwarm && swarm.isActive;
    composer.style.display = canMessage ? '' : 'none';
  }

  // Static listeners
  element('swarmTabBoard').addEventListener('click', () => setTab('board'), { signal: staticEvents.signal });
  element('swarmTabMembers').addEventListener('click', () => setTab('members'), { signal: staticEvents.signal });
  element('swarmTabOverview').addEventListener('click', () => setTab('overview'), { signal: staticEvents.signal });
  element('swarmMemberOpenBtn').addEventListener('click', () => { void openSelectedMemberSession(); }, { signal: staticEvents.signal });
  element('swarmMemberFilterBtn').addEventListener('click', () => {
    const member = selectedMember();
    if (!member) return;
    memberFilter = member.name;
    setTab('board');
  }, { signal: staticEvents.signal });
  element('swarmPromptSendBtn').addEventListener('click', () => { void sendCoordinatorMessage('prompt'); }, { signal: staticEvents.signal });
  element('swarmPromptSteerBtn').addEventListener('click', () => { void sendCoordinatorMessage('steer'); }, { signal: staticEvents.signal });
  element<HTMLTextAreaElement>('swarmPromptInput').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void sendCoordinatorMessage('prompt');
  }, { signal: staticEvents.signal });

  return {
    open,
    close,
    isOpen,
    reload: () => { if (owns()) void load(true); },
    dispose() { close(); staticEvents.abort(); renderer.dispose(); disposed = true; },
  };
}
