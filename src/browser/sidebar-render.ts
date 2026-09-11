import type { SessionEntry } from './session-state';
import type { HelperSession, HelperHost, SessionFamily, WorkspaceNode } from './shared-helper-types';
import type { PendingSessionSpawn } from './session-spawns';
import { record, finite } from './helper-values';
import { escapeHtml, contextClass, formatTokens, formatRelativeTime, shortCwd } from './helper-format';
import { shortModelName } from './helper-usage';
import { sessionKey, sessionRefKey, sessionSupports, harnessBadgeInfo, hostDisplayLabel, sortHostSections, hostSectionKey } from './helper-identity';
import { buildSessionFamilies, flattenSessionFamilies, partitionPinnedFamilies, groupSessionsByDate, groupByWorkspace, buildWorkspaceTree, collectTreeSessions } from './helper-sessions';
import { parseSessionQuery, positiveQueryTokens, highlightTokens, queryAsksForAutomation, isAutomationSession, applyHostTerms, applyLocalFilter, evaluateSessionQuery, scoreSessionMatch } from './helper-query';
export interface SidebarSession extends HelperSession {
  subagentLive: boolean; compacting: boolean; contextPercent: number; contextTokens?: number;
  thinkingLevel: string; closeMode: string; harnessId: string; harnessLabel: string; searchSnippet: string; searchScore?: number;
}
/** Narrow list metadata once before grouping; the session store retains its original payloads. */
export function sidebarSession(row: SessionEntry): SidebarSession {
  const string = (value: unknown) => typeof value === 'string' ? value : '';
  const capabilities: Record<string, boolean> = {};
  if (record(row.capabilities)) for (const [key, value] of Object.entries(row.capabilities)) if (typeof value === 'boolean') capabilities[key] = value;
  const parent = typeof row.familyParentId === 'string' ? row.familyParentId : null;
  return { id: row.id, host: row.host, hostLabel: row.hostLabel, name: string(row.name), cwd: string(row.cwd), model: string(row.model),
    lastActivity: typeof row.lastActivity === 'string' || finite(row.lastActivity) ? row.lastActivity : null,
    isActive: row.isActive === true, turnInProgress: row.turnInProgress === true, subagentLive: row.subagentLive === true, compacting: row.compacting === true,
    parentId: string(row.parentId), ...(Object.hasOwn(row, 'familyParentId') ? { familyParentId: parent } : {}),
    routine: string(row.routine), routineId: string(row.routineId), capabilities,
    contextPercent: finite(row.contextPercent) ? row.contextPercent : 0, contextTokens: finite(row.contextTokens) ? row.contextTokens : undefined,
    thinkingLevel: string(row.thinkingLevel), closeMode: string(row.closeMode), harnessId: string(row.harnessId), harnessLabel: string(row.harnessLabel),
    searchSnippet: string(row.searchSnippet), searchScore: finite(row.searchScore) ? row.searchScore : undefined };
}
export interface SidebarHost extends HelperHost { state: string; key: string; color: string; dot: string; hasCache: boolean }
export interface SidebarRenderOptions {
  active: readonly SessionEntry[]; previous: readonly SessionEntry[]; selected: SessionEntry | null;
  tab: string; view: string; query: string; queriedFor: string; scope: string; indexing: boolean;
  contextMetric: string; pending: readonly (readonly [string, PendingSessionSpawn])[]; selectedSpawn: string | null;
  expanded: ReadonlySet<string>; collapsed: ReadonlySet<string>; pinned: readonly string[]; roots: ReadonlyMap<string, string>;
  closeConfirm: string | null; closeBusy: string | null; multiHost: boolean; hosts: readonly SidebarHost[];
  unread: (row: SidebarSession) => boolean; hostChip: (id?: string | null) => string;
}
interface RowOptions { familyNode?: SessionFamily<SidebarSession>; familyRootKey?: string; familyDepth?: number; familyPinned?: boolean; pinnedRow?: boolean; showCwd?: boolean }
interface FamilyOptions { pinnedFamily?: boolean; showCwd?: boolean }
export function harnessBadgeInnerHtml(info: ReturnType<typeof harnessBadgeInfo>) {
  const icon = info.icon
    ? `<img class="harness-badge-icon" src="${escapeHtml(info.icon)}" alt="">`
    : '<span class="harness-badge-icon harness-badge-icon-fallback" aria-hidden="true">◆</span>';
  return icon + `<span class="harness-badge-label">${escapeHtml(info.label)}</span>`;
}

export function renderHarnessBadge(harnessId?: string | null, harnessLabel?: string | null) {
  const id = harnessId || 'pi';
  const info = harnessBadgeInfo(id, harnessLabel);
  const title = harnessLabel || info.label;
  return `<span class="harness-badge harness-badge-${escapeHtml(id)}" title="${escapeHtml(title)} harness" aria-label="${escapeHtml(title)} harness">${harnessBadgeInnerHtml(info)}</span>`;
}

/** One render uses a single projection; no DOM, requests, timers or retained row closures. */
export function renderSidebar(options: SidebarRenderOptions) {
  const canonical = (key: string) => options.roots.get(key) || key;
  const hostIsDown = (host: SidebarHost) => host.state === 'blocked' || host.state === 'backoff';
function renderSessionItem(session: SidebarSession, opts: RowOptions = {}) {
  const ctxClass = contextClass(session.contextPercent);
  const activeClass = options.selected && sessionRefKey(options.selected) === sessionRefKey(session) ? 'active' : '';
  // A live subagent has no bridge of its own (its parent's process owns it),
  // so `isActive` is false — but it is a running session, not history, and
  // must not read as dimmed.
  const inactiveClass = session.isActive || session.subagentLive ? '' : 'inactive';
  const familyNode = opts.familyNode || null;
  const hasChildren = !!familyNode?.children?.length;
  const familyExpanded = hasChildren && options.expanded.has(sessionRefKey(session));
  const statusSessions = hasChildren && !familyExpanded
    ? flattenSessionFamilies(familyNode ? [familyNode] : []) : [session];
  // One dot, best signal wins: working (pulsing) > unread (accent) >
  // live-in-All > live subagent. A collapsed parent aggregates its
  // descendants so hiding rows never hides the fact that a child is working,
  // has unread activity, or is still running inside it.
  let liveDot = '';
  if (statusSessions.some(s => s.compacting || s.turnInProgress)) {
    liveDot = '<span class="session-item-status working" title="Session family working"></span>';
  } else if (statusSessions.some(options.unread)) {
    liveDot = '<span class="session-item-status unread" title="New activity in session family"></span>';
  } else if (options.tab === 'all' && statusSessions.some(s => s.isActive)) {
    liveDot = '<span class="live-dot" title="Active session family"></span>';
  } else if (statusSessions.some(s => s.subagentLive)) {
    // Deliberately the static dot: the file says the session is still loaded
    // in its parent, never whether it is mid-turn.
    liveDot = '<span class="live-dot" title="Subagent still loaded in its parent session"></span>';
  }
  const displayName = session.name || 'Unnamed';
  // One context readout, not three: percent or absolute tokens per the device
  // setting (tokens falls back to percent when the session has no token
  // count). The colour still comes from the percent — that's the warning.
  const ctxText = options.contextMetric === 'tokens' && session.contextTokens
    ? `${formatTokens(session.contextTokens)} tok`
    : `${session.contextPercent}%`;
  const ctxTitle = session.contextTokens
    ? `${session.contextPercent}% of context · ${formatTokens(session.contextTokens)} tokens`
    : `${session.contextPercent}% of context`;
  const timeAgo = formatRelativeTime(hasChildren ? familyNode!.activity : session.lastActivity);
  const canonicalRootKey = canonical(opts.familyRootKey || sessionRefKey(session));
  const isPinned = opts.familyPinned ?? options.pinned.some(pin =>
    canonical(pin) === canonicalRootKey);
  const pinBtn = `<button class="session-pin-btn${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Unpin family' : 'Pin family to top'}">📌</button>`;
  const familyToggle = hasChildren
    ? `<button class="session-family-toggle" data-family-id="${escapeHtml(session.id)}" aria-expanded="${familyExpanded}" aria-label="${familyExpanded ? 'Collapse' : 'Show'} ${familyNode!.size - 1} child session${familyNode!.size === 2 ? '' : 's'}" title="${familyExpanded ? 'Collapse' : 'Show'} ${familyNode!.size - 1} child session${familyNode!.size === 2 ? '' : 's'}"><span>${familyExpanded ? '▾' : '▸'}</span><small>${familyNode!.size - 1}</small></button>`
    : ((opts.familyDepth || 0) > 0 ? '<span class="session-family-leaf" aria-hidden="true">↳</span>' : '');
  // Live rows only; the confirm/busy states read the module vars so a poll
  // re-render restores an armed confirm rather than silently clearing it.
  const closeArmed = options.closeConfirm === sessionRefKey(session);
  const closeBusy = options.closeBusy === sessionRefKey(session);
  const detachClient = session.closeMode === 'client-only';
  const closeTitle = detachClient ? 'Detach client'
    : session.closeMode === 'owned-agent' ? 'Stop this agent and its children (transcript stays resumable)'
      : 'Close session (transcript stays resumable)';
  const closeBtn = session.isActive && sessionSupports(session, 'close')
    ? `<button class="session-close-btn${closeArmed ? ' confirm' : ''}" title="${closeArmed ? 'Tap again: ' : ''}${closeTitle}">${closeBusy ? '…' : closeArmed ? (detachClient ? 'detach?' : 'close?') : '✕'}</button>`
    : '';
  const harnessBadge = renderHarnessBadge(session.harnessId, session.harnessLabel);
  // Provenance stamp from the routine ledger (server-side, presentation only,
  // like the parent hints): this session is one routine's run.
  const routineChip = session.routine
    ? `<span class="routine-chip" title="Started by the &quot;${escapeHtml(session.routine)}&quot; routine">⏱ ${escapeHtml(session.routine)}</span>`
    : '';
  // Rows in the pinned section get a drag handle (reorder); pinned and
  // Recent-view rows get a cwd hint — they've left their workspace group,
  // so the group label isn't there.
  const dragHandle = opts.pinnedRow ? '<span class="session-drag-handle" title="Drag to reorder">⠿</span>' : '';
  const cwdHint = (opts.pinnedRow || opts.showCwd) ? `<span class="session-item-cwd">${escapeHtml(shortCwd(session.cwd || '~'))}</span>` : '';
  // Rows that have left their workspace group (pinned, Recent, search) name
  // their host too — in the workspace tree the group header carries it.
  const hostChip = (opts.pinnedRow || opts.showCwd) ? options.hostChip(session.host) : '';
  // Rows served from a host that stopped answering are last-known, not live.
  const staleHost = options.hosts.some(host => (host.hostId || null) === (session.host || null) && hostIsDown(host)) ? ' stale-host' : '';
  // Server search attaches a snippet when a session matched on message
  // content the row's metadata doesn't show — render it so the match
  // doesn't look arbitrary. Only positive plain terms can cause a content
  // match, so only they get marked.
  const snippetLine = session.searchSnippet
    ? `<div class="session-item-snippet">${highlightTokens(session.searchSnippet,
        positiveQueryTokens(parseSessionQuery(options.query)))}</div>`
    : '';
  // Live sessions report their thinking level; historical rows have none to
  // show, so the chip simply doesn't render there.
  const thinkingChip = session.thinkingLevel
    ? `<span class="session-item-thinking" title="Thinking level: ${escapeHtml(session.thinkingLevel)}">${escapeHtml(session.thinkingLevel)}</span>`
    : '';

  return `
    <div class="session-item ${activeClass} ${inactiveClass}${closeBusy ? ' closing' : ''}${staleHost}" data-id="${escapeHtml(session.id)}"${session.host ? ` data-host="${escapeHtml(session.host)}"` : ''}>
      <div class="session-item-header">
        ${dragHandle}${familyToggle}${liveDot}<span class="session-item-name" title="${escapeHtml(session.id)}">${escapeHtml(displayName)}</span>
        <span class="session-item-time">${timeAgo}</span>
        ${pinBtn}${closeBtn}
      </div>
      <div class="session-item-meta">
        <span class="session-item-model" title="${escapeHtml(session.model || '')}">${escapeHtml(shortModelName(session.model))}</span>
        ${thinkingChip}
        <span class="session-item-context ${ctxClass}" title="${escapeHtml(ctxTitle)}">${escapeHtml(ctxText)}</span>
      </div>
      <div class="session-item-tags${hostChip ? ' with-host' : ''}">
        ${hostChip}${harnessBadge}${routineChip}${cwdHint}
      </div>
      ${snippetLine}
    </div>
  `;
}

function renderSessionFamily(node: SessionFamily<SidebarSession>, opts: FamilyOptions = {}, depth = 0, rootId = node.session.id,
  rootKey = sessionRefKey(node.session)): string {
  const expanded = node.children.length > 0 && options.expanded.has(sessionRefKey(node.session));
  const row = renderSessionItem(node.session, {
    familyNode: node,
    // Carried down so a row never has to look its root's host back up: the
    // sidebar renders thousands of rows and findSession is a linear scan.
    familyRootKey: rootKey,
    familyDepth: depth,
    familyPinned: !!opts.pinnedFamily,
    pinnedRow: !!opts.pinnedFamily && depth === 0,
    showCwd: !!opts.showCwd && depth === 0,
  });
  const children = expanded
    ? `<div class="session-family-children">${node.children.map(child =>
        renderSessionFamily(child, opts, depth + 1, rootId, rootKey)).join('')}</div>`
    : '';
  const classes = depth === 0 ? 'session-family session-family-root' : 'session-family session-family-child';
  const familyAttr = depth === 0 ? ` data-family-id="${escapeHtml(rootId)}" data-family-key="${escapeHtml(rootKey)}"` : '';
  return `<div class="${classes}"${familyAttr}>${row}${children}</div>`;
}

function renderPendingSessionItem(spawnId: string, spawn: PendingSessionSpawn) {
  const cwd = spawn.cwd || '~';
  const label = spawn.harnessLabel || 'Pi';
  const harnessBadge = renderHarnessBadge(spawn.harness, label);
  return `
    <div class="session-item starting${options.selectedSpawn === spawnId ? ' active' : ''}" data-spawn-id="${escapeHtml(spawnId)}">
      <div class="session-item-header">
        <span class="session-item-status working" title="Starting session"></span>
        <span class="session-item-name">Starting ${escapeHtml(label)}…</span>${harnessBadge}
        <span class="session-item-time">now</span>
      </div>
      <div class="session-item-meta">
        ${options.hostChip(spawn.host)}<span class="session-item-cwd" title="${escapeHtml(cwd)}">${escapeHtml(shortCwd(cwd))}</span>
        <span>${spawn.target ? 'tmux' : 'headless'}</span>
      </div>
    </div>
  `;
}

function renderSessions() {
  hostSectionsShown = null; // only the workspace view builds host sections
  const active = options.active.map(sidebarSession), previous = options.previous.map(sidebarSession);
  // A live subagent runs inside a live session's process, so it belongs on
  // the Active tab even though it is a historical row everywhere else (its
  // parent owns it; pi-dish has no socket to it). The count badge stays a
  // count of *controllable* sessions.
  const showing = options.tab === 'active'
    ? [...active, ...previous.filter(session => session.subagentLive)]
    : [...active, ...previous];
  const pending = options.pending;

  // Routine-invoked sessions are automation: every cron tick is one, so the
  // historical list fills with them. They stay out of the sidebar unless the
  // typed query or an active scope affirmatively asks (`is:automation`,
  // `routine:name`); a live one is real work in flight and stays. Hidden
  // rows remain in `sessions` — selection, refs, restore and the search
  // facets all keep working; only this render skips them.
  const sq = options.scope;
  const scopeParsed = sq ? parseSessionQuery(sq) : null;
  const asksAutomation = queryAsksForAutomation(parseSessionQuery(options.query))
    || (scopeParsed ? queryAsksForAutomation(scopeParsed) : false);
  let visible = showing, automationHidden = 0;
  if (!asksAutomation) {
    visible = showing.filter((session) => {
      if (session.isActive || !isAutomationSession(session)) return true;
      automationHidden++;
      return false;
    });
  }
  // Once the lists reflect the typed query, the server's filtering (which
  // includes message content) is authoritative — re-filtering locally would
  // drop content-only matches, since the local pass is metadata-only. Until
  // that response lands, narrow locally so typing feels instant.
  // `host:` is the exception: it never reached the server, so it is applied
  // here on top of what the server-filtered lists came back with (the
  // debounce-window applyLocalFilter path evaluates it inline).
  const queried = (options.query && options.queriedFor === options.query)
    ? applyHostTerms(visible, options.query)
    : applyLocalFilter(visible, options.query);
  // Active scopes apply client-side on top of whatever the query kept —
  // metadata/date-only by design, so they behave identically on both tabs.
  const filtered = scopeParsed ? queried.filter(s => evaluateSessionQuery(scopeParsed, s)) : queried;
  const scopesHidden = queried.length - filtered.length;

  let html = '';
  // First boot over a big corpus: the server is still indexing and the list
  // below is partial — say so (loadSessions re-polls until it settles).
  if (options.tab === 'all' && options.indexing) {
    html += '<div class="indexing-note">Indexing sessions…</div>';
  }
  if (pending.length) {
    html += `<div class="session-segment starting-segment">
      <div class="workspace-group-header starting-header">
        <span class="workspace-group-label">Starting</span>
        <span class="workspace-group-count">${pending.length}</span>
      </div>
      ${pending.map(([id, spawn]) => renderPendingSessionItem(id, spawn)).join('')}
    </div>`;
  }
  if (filtered.length === 0 && pending.length === 0) {
    // With a query, `active` is the server-filtered list — an empty one
    // means "no matches", not "no sessions running".
    const msg = options.tab === 'active'
      ? (active.length === 0 && !options.query ? 'No active sessions<br><span style="font-size:11px">Click "+ New Session" or resume one from All</span>' : 'No matches')
      : (visible.length === 0 && !options.query ? 'No sessions found' : 'No matches');
    html += `<div class="empty-session"><p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">${msg}</p></div>`;
  } else if (options.query) {
    // Search results are one flat relevance-ranked list — grouping (and the
    // pinned section, a navigation aid for the unfiltered list) would scatter
    // the best matches across workspace/date buckets. The server's
    // searchScore counts transcript occurrences too, so it wins where present;
    // the interim local-filter pass scores metadata only. Recency breaks ties.
    const parsed = parseSessionQuery(options.query);
    const ranked = filtered
      .map(s => [s, s.searchScore ?? scoreSessionMatch(parsed, s)] as const)
      .sort((a, b) => b[1] - a[1]
        || new Date(b[0].lastActivity || 0).getTime() - new Date(a[0].lastActivity || 0).getTime());
    html += `<div class="session-segment ranked-segment">
      ${ranked.map(([s]) => renderSessionItem(s, { showCwd: true })).join('')}
    </div>`;
  } else {
    const families = buildSessionFamilies(filtered);
    const [pinnedFamilies, restFamilies] = partitionPinnedFamilies(families, options.pinned);
    if (pinnedFamilies.length > 0) {
      html += `<div class="session-segment pinned-segment">
        <div class="workspace-group-header pinned-header">
          <span class="workspace-group-label">📌 Pinned</span>
          <span class="workspace-group-count">${pinnedFamilies.length}</span>
        </div>
        ${pinnedFamilies.map(family => renderSessionFamily(family, { pinnedFamily: true, showCwd: true })).join('')}
      </div>`;
    }
    if (options.view === 'recent') {
      // A family belongs to the date bucket of its newest member, so a recent
      // child moves the whole parent-first block instead of splitting it.
      html += groupSessionsByDate(restFamilies).map(renderDateBucket).join('');
    } else {
      html += renderWorkspaceTrees(flattenSessionFamilies(restFamilies));
    }
  }
  // A host that is down and has no cached rows would otherwise vanish
  // silently. One quiet line, no retry button: the poll keeps trying.
  html += hostOfflineNotesHtml();
  // Sessions a forgotten chip silently removed must stay discoverable — the
  // note is the audit trail for "why isn't my session in the list?".
  if (automationHidden > 0) {
    html += `<div class="scope-hidden-note">${automationHidden} automation run${automationHidden === 1 ? '' : 's'} hidden (is:automation shows them)</div>`;
  }
  if (scopesHidden > 0) {
    html += `<div class="scope-hidden-note">${scopesHidden} hidden by scopes</div>`;
  }

  return { html, count: active.length + pending.length };
}

/**
 * Collapse-state key for a workspace node. With several hosts in the list the
 * same cwd on two machines is two different workspaces (the doc's rule), so
 * the key — and therefore the tree, the count, and the collapse state — is
 * host-qualified. Single-host keys stay the bare path they have always been,
 * which is what keeps existing collapse state valid.
 */
function workspaceGroupKey(hostId: string | null, path: string) {
  return options.multiHost && hostId ? sessionKey(hostId, path) : path;
}

// Host ids that got their own section in the current render — the offline
// notes below are the fallback for hosts *without* one, so a down host is
// never announced twice.
let hostSectionsShown: Set<string> | null = null;

/**
 * The workspace view. One host: exactly the tree it always built. Several:
 * one **host section** per host — a prominent heading (color dot, label,
 * count, reachability, collapse chevron) over that host's own workspace tree.
 * Sections, not interleaved top-level nodes: a fleet is read machine-first,
 * and a heading that names the host makes the per-node chips redundant.
 * Order is self first then by label — stable, deliberately not recency, so
 * the headings don't shuffle under the cursor.
 */
function renderWorkspaceTrees(list: readonly SidebarSession[]) {
  if (!options.multiHost) {
    const tree = buildWorkspaceTree(groupByWorkspace(list, options.collapsed), options.collapsed);
    return tree.map(node => renderWorkspaceNode(node)).join('');
  }
  hostSectionsShown = new Set();
  let html = '';
  for (const host of sortHostSections(options.hosts)) {
    const hostId = host.hostId || null;
    const mine = list.filter(s => (s.host || null) === hostId);
    const down = hostIsDown(host);
    // A reachable host with nothing in the list is simply absent. A *down*
    // one still gets its heading — with the state on it — so "where did that
    // machine go?" is answered in place rather than in a footnote.
    if (!mine.length && !down) continue;
    hostSectionsShown.add(host.key);
    const key = hostSectionKey(host.key);
    const isCollapsed = options.collapsed.has(key);
    let body = '';
    if (!isCollapsed) {
      // A collapsed-set view over the host-qualified keys: groupByWorkspace and
      // buildWorkspaceTree only ever ask `has(path)`, so no helper change.
      const collapsedView = hostId ? new Set([...options.collapsed].filter(key => key.startsWith(hostId + ' ')).map(key => key.slice((hostId + ' ').length))) : options.collapsed;
      body = buildWorkspaceTree(groupByWorkspace(mine, collapsedView), collapsedView)
        .map(node => renderWorkspaceNode(node, { hostId })).join('');
      if (!mine.length) {
        body = `<div class="host-section-empty">${escapeHtml(host.state === 'blocked'
          ? 'Enter this host’s token in Settings.' : 'Nothing cached from this host yet.')}</div>`;
      }
    }
    // Collapsing a section hides the whole machine, so the heading must not
    // hide activity — same rule (and same signals) as a workspace node.
    let headerDot = '';
    if (isCollapsed && mine.length) {
      if (mine.some(s => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
      else if (mine.some(options.unread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
    }
    const stateNote = down
      ? `<span class="host-section-state">${host.state === 'blocked' ? 'needs a token' : 'unreachable'}</span>`
      : '';
    html += `<div class="host-section${isCollapsed ? ' collapsed' : ''}${down ? ' offline' : ''}" style="--host-color:${escapeHtml(host.color)}">
      <div class="host-section-header" data-host-section="${escapeHtml(key)}" title="${escapeHtml(hostDisplayLabel(host) + (down ? ' — showing last known sessions' : ''))}">
        <span class="host-section-chevron">${isCollapsed ? '▸' : '▾'}</span>
        ${host.dot}
        <span class="host-section-name">${escapeHtml(hostDisplayLabel(host))}</span>
        ${stateNote}${headerDot}<span class="host-section-count">${mine.length}</span>
      </div>
      ${isCollapsed ? '' : `<div class="host-section-body">${body}</div>`}
    </div>`;
  }
  return html;
}

/**
 * Hosts that are down and have nothing to show in the current view — one
 * quiet line each. In the workspace view their section heading already says
 * it, so those are skipped.
 */
function hostOfflineNotesHtml() {
  if (!options.multiHost) return '';
  return options.hosts.filter(host => {
    if (!hostIsDown(host)) return false;
    if (hostSectionsShown && hostSectionsShown.has(host.key)) return false;
    return !host.hasCache;
  }).map(host => `<div class="host-offline-note">${escapeHtml(hostDisplayLabel(host))} — ${
    host.state === 'blocked' ? 'needs a token (Settings)' : 'unreachable'}</div>`).join('');
}

/**
 * One workspace-tree node → a .session-segment: header (collapse toggle via
 * data-cwd, the node's path prefix), child nodes nested in an indented
 * .workspace-children, then this node's own sessions — folders before loose
 * sessions, file-manager style. Collapsing a node hides its whole subtree,
 * so the header must not hide activity: surface the best signal
 * (working > unread) from all descendant sessions as a header dot. Multi-host
 * trees sit inside a .host-section whose heading names the machine, so no
 * node header carries a host chip.
 */
function renderWorkspaceNode(node: WorkspaceNode<SidebarSession>, opts: { hostId?: string | null } = {}): string {
  const hostId = opts.hostId || null;
  const groupKey = workspaceGroupKey(hostId, node.path);
  const isCollapsed = options.collapsed.has(groupKey);
  let headerDot = '';
  if (isCollapsed) {
    const all = collectTreeSessions(node);
    if (all.some(s => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
    else if (all.some(options.unread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
  }
  let body = '';
  if (!isCollapsed) {
    if (node.children.length) {
      body = `<div class="workspace-children">${node.children.map(child => renderWorkspaceNode(child, { hostId })).join('')}</div>`;
    }
    body += buildSessionFamilies(node.sessions || []).map(family => renderSessionFamily(family)).join('');
  }
  return `<div class="session-segment${isCollapsed ? ' collapsed' : ''}">
    <div class="workspace-group-header" data-cwd="${escapeHtml(groupKey)}">
      <span class="workspace-group-chevron">${isCollapsed ? '▸' : '▾'}</span>
      <span class="workspace-group-label" title="${escapeHtml(node.path)}">${escapeHtml(node.label)}</span>
      ${headerDot}<span class="workspace-group-count">${node.count}</span>
      <button class="workspace-new-btn" data-path="${escapeHtml(node.path)}"${hostId ? ` data-host="${escapeHtml(hostId)}"` : ''} title="New session in ${escapeHtml(node.path)}">+</button>
    </div>
    ${body}
  </div>`;
}

/**
 * One Recent-view date bucket → a .session-segment sharing the workspace
 * header chrome (same collapse delegation via data-cwd, keyed 'date:<key>' so
 * the two views' collapse states can't collide). Unlike workspace groups,
 * collapsed buckets stay in chronological place — sinking "Today" below
 * "May" would break the timeline. Rows carry the cwd hint: the workspace
 * label isn't above them in this view.
 */
function renderDateBucket(bucket: { key: string; label: string; sessions: readonly SessionFamily<SidebarSession>[] }) {
  const key = 'date:' + bucket.key;
  const isCollapsed = options.collapsed.has(key);
  const bucketMembers = flattenSessionFamilies(bucket.sessions);
  let headerDot = '';
  if (isCollapsed) {
    if (bucketMembers.some(s => s.turnInProgress || s.compacting)) headerDot = '<span class="session-item-status working" title="Agent working"></span>';
    else if (bucketMembers.some(options.unread)) headerDot = '<span class="session-item-status unread" title="New activity"></span>';
  }
  const body = isCollapsed ? '' : bucket.sessions.map(family => renderSessionFamily(family, { showCwd: true })).join('');
  return `<div class="session-segment${isCollapsed ? ' collapsed' : ''}">
    <div class="workspace-group-header" data-cwd="${escapeHtml(key)}">
      <span class="workspace-group-chevron">${isCollapsed ? '▸' : '▾'}</span>
      <span class="workspace-group-label">${escapeHtml(bucket.label)}</span>
      ${headerDot}<span class="workspace-group-count">${bucketMembers.length}</span>
    </div>
    ${body}
  </div>`;
}


return renderSessions();
}
