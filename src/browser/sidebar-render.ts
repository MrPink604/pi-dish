import type { SessionEntry } from './session-state';
import type { HelperHost } from '../core/helper-types';
import type { SessionFamily, WorkspaceNode } from './shared-helper-types';
import type { PendingSessionSpawn } from './session-spawns';
import { escapeHtml } from '../core/helper-format';
import { countLabel, cacheExpiryPresentation, contextClass, formatTokens, formatRelativeTime, shortCwd } from './helper-format';
import { shortModelName } from './helper-usage';
import { sessionKey, sessionRefKey, sessionSupports, harnessBadgeInfo, hostDisplayLabel, sortHostSections, hostSectionKey } from './helper-identity';
import { buildSessionFamilies, flattenSessionFamilies, partitionPinnedFamilies, groupSessionsByDate, groupByWorkspace, buildWorkspaceTree, collectTreeSessions } from './helper-sessions';
import { parseSessionQuery, positiveQueryTokens, highlightTokens, queryAsksForAutomation, isAutomationSession, applyHostTerms, evaluateSessionQuery, scoreSessionMatch } from '../core/helper-query';
import { hibernationSummary } from './hibernation';
export interface SidebarHost extends HelperHost { state: string; key: string; color: string; dot: string; hasCache: boolean }
export interface SidebarRenderOptions {
  active: readonly SessionEntry[]; previous: readonly SessionEntry[]; selected: SessionEntry | null;
  tab: string; view: string; query: string; queriedFor: string; scope: string; indexing: boolean;
  contextMetric: string; pending: readonly (readonly [string, PendingSessionSpawn])[]; selectedSpawn: string | null;
  expanded: ReadonlySet<string>; collapsed: ReadonlySet<string>; pinned: readonly string[]; roots: ReadonlyMap<string, string>;
  closeConfirm: string | null; closeBusy: string | null; multiHost: boolean; hosts: readonly SidebarHost[];
  unread: (row: SessionEntry) => boolean; hostChip: (id?: string | null) => string;
}
export interface SidebarProjection {
  readonly layout: string;
  readonly rows: readonly { key: string; html: string }[];
  readonly count: number;
  readonly html: string;
}
interface RowOptions { familyNode?: SessionFamily<SessionEntry>; familyRootKey?: string; familyDepth?: number; familyPinned?: boolean; pinnedRow?: boolean; showCwd?: boolean }
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

/** An unchanged fingerprint reuses the previous projection verbatim. */
export interface SidebarProjectionMemo {
  fingerprint?: readonly unknown[] | null;
  projection?: SidebarProjection | null;
}

export function renderSidebar(options: SidebarRenderOptions, memo?: SidebarProjectionMemo): SidebarProjection {
  if (!memo) return buildSidebar(options);
  const fingerprint = sidebarFingerprint(options);
  if (memo.projection && memo.fingerprint && sameFingerprint(memo.fingerprint, fingerprint)) return memo.projection;
  const projection = buildSidebar(options);
  memo.fingerprint = fingerprint;
  memo.projection = projection;
  return projection;
}

/** Clocks are bucketed at each label's switch boundary so polls inside a bucket hit the memo. */
function sidebarFingerprint(options: SidebarRenderOptions): readonly unknown[] {
  const now = Date.now();
  const parts: unknown[] = [
    options.tab, options.view, options.query, options.queriedFor, options.scope,
    options.indexing ? 1 : 0, options.contextMetric, options.multiHost ? 1 : 0,
    options.selected ? sessionRefKey(options.selected) : null,
    options.selectedSpawn, options.closeConfirm, options.closeBusy,
    new Date(now).setHours(0, 0, 0, 0),
  ];
  parts.push(options.pending.length);
  for (const [id, spawn] of options.pending) parts.push(id, spawn.cwd, spawn.harness, spawn.harnessLabel, spawn.target ? 1 : 0, spawn.host);
  parts.push(options.pinned.length);
  for (const key of options.pinned) parts.push(key);
  for (const set of [options.expanded, options.collapsed]) {
    parts.push(set.size);
    for (const key of set) parts.push(key);
  }
  parts.push(options.roots.size);
  for (const [key, value] of options.roots) parts.push(key, value);
  parts.push(options.hosts.length);
  const chipHosts = new Set<string | null>();
  for (const host of options.hosts) {
    parts.push(host.key, host.hostId, host.self ? 1 : 0, host.label, host.name, host.base, host.state, host.color, host.dot, host.hasCache ? 1 : 0);
    chipHosts.add(host.hostId || null);
  }
  for (const list of [options.active, options.previous]) for (const session of list) chipHosts.add(session.host || null);
  for (const [, spawn] of options.pending) chipHosts.add(spawn.host || null);
  // The chip's formatted output is itself a render input.
  for (const host of chipHosts) parts.push(host, options.hostChip(host));
  for (const list of [options.active, options.previous]) {
    parts.push(list.length);
    for (const session of list) {
      parts.push(
        session.id, session.host, session.hostLabel, session.name, session.model,
        session.harnessId, session.harnessLabel, session.thinkingLevel,
        session.isActive ? 1 : 0, session.subagentLive ? 1 : 0, session.turnInProgress ? 1 : 0,
        session.askPending ? 1 : 0, session.compacting ? 1 : 0,
        sessionSupports(session, 'close') ? 1 : 0, session.closeMode,
        session.contextPercent, session.contextTokens, session.cwd, session.routine, session.routineId,
        session.private ? 1 : 0,
        session.parentId, session.parentSource, session.familyParentId, session.searchScore,
        session.searchSnippet, session.lastActivity, relativeTimeFingerprint(session.lastActivity, now),
        cacheExpiryFingerprint(session.cacheExpiry, now), options.unread(session) ? 1 : 0,
        session.hibernation?.reason, relativeTimeFingerprint(session.hibernation?.hibernatedAt, now),
      );
    }
  }
  return parts;
}

function sameFingerprint(previous: readonly unknown[], next: readonly unknown[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index++) if (!Object.is(previous[index], next[index])) return false;
  return true;
}

function relativeTimeFingerprint(ts: SessionEntry['lastActivity'], now: number): string {
  if (!ts) return '';
  const seconds = Math.floor(Math.max(0, now - new Date(ts).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `m${minutes}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `h${hours}`;
  const days = Math.floor(hours / 24);
  // Past a week the label is a fixed date.
  return days < 7 ? `d${days}` : 'dated';
}

function cacheExpiryFingerprint(expiry: SessionEntry['cacheExpiry'], now: number): string {
  if (!expiry) return '';
  const remaining = expiry.expiresAt - now;
  if (remaining <= 0) return `cold|${expiry.retention}`;
  return `${expiry.basis || ''}|${expiry.retention}|${Math.ceil(remaining / 60_000)}`;
}

function buildSidebar(options: SidebarRenderOptions): SidebarProjection {
  const canonical = (key: string) => options.roots.get(key) || key;
  const hostIsDown = (host: SidebarHost) => host.state === 'blocked' || host.state === 'backoff';
  const selectedKey = options.selected ? sessionRefKey(options.selected) : null;
  const parsedQuery = parseSessionQuery(options.query), queryTokens = positiveQueryTokens(parsedQuery);
  const pinnedRoots = new Set(options.pinned.map(canonical));
  const downHosts = new Set(options.hosts.filter(hostIsDown).map(host => host.hostId || null));
  const badges = new Map<string, string>(), hostChips = new Map<string | null, string>();
  const rows: { key: string; html: string }[] = [], occurrences = new Map<string, number>();
function renderSessionItem(session: SessionEntry, opts: RowOptions = {}) {
  const contextPercent = session.contextPercent ?? 0;
  const ctxClass = contextClass(contextPercent);
  const key = sessionRefKey(session);
  const activeClass = selectedKey === key ? 'active' : '';
  // Live subagents have no bridge (isActive false) but aren't history.
  const inactiveClass = session.isActive || session.subagentLive ? '' : 'inactive';
  const familyNode = opts.familyNode || null;
  const hasChildren = !!familyNode?.children?.length;
  const familyExpanded = hasChildren && options.expanded.has(key);
  const statusSessions = hasChildren && !familyExpanded
    ? flattenSessionFamilies(familyNode ? [familyNode] : []) : [session];
  // One dot, best signal wins: asking > working > unread > live > live subagent.
  // Collapsed parents aggregate descendants so hidden children stay visible.
  let liveDot = '';
  if (statusSessions.some(s => s.askPending)) {
    liveDot = '<span class="session-item-status asking" title="Waiting for an answer to a question">?</span>';
  } else if (statusSessions.some(s => s.compacting || s.turnInProgress)) {
    liveDot = '<span class="session-item-status working" title="Session family working"></span>';
  } else if (statusSessions.some(options.unread)) {
    liveDot = '<span class="session-item-status unread" title="New activity in session family"></span>';
  } else if (options.tab === 'all' && statusSessions.some(s => s.isActive)) {
    liveDot = '<span class="live-dot" title="Active session family"></span>';
  } else if (statusSessions.some(s => s.subagentLive)) {
    // Static dot: the session is loaded in its parent, not necessarily mid-turn.
    liveDot = '<span class="live-dot" title="Subagent still loaded in its parent session"></span>';
  }
  const displayName = session.name || 'Unnamed';
  // Colour always comes from the percent; that's the warning.
  const ctxText = options.contextMetric === 'tokens' && session.contextTokens
    ? `${formatTokens(session.contextTokens)} tok`
    : `${contextPercent}%`;
  const ctxTitle = session.contextTokens
    ? `${contextPercent}% of context · ${formatTokens(session.contextTokens)} tokens`
    : `${contextPercent}% of context`;
  const cache = cacheExpiryPresentation(session.cacheExpiry);
  const cacheHtml = cache
    ? `<span class="session-item-cache${cache.severity ? ` ${cache.severity}` : ''}" title="${escapeHtml(cache.detail)}" aria-label="${escapeHtml(cache.detail)}">${escapeHtml(cache.compact)}</span>`
    : '';
  const timeAgo = formatRelativeTime(hasChildren ? familyNode!.activity : session.lastActivity);
  const canonicalRootKey = canonical(opts.familyRootKey || key);
  const isPinned = opts.familyPinned ?? pinnedRoots.has(canonicalRootKey);
  const pinBtn = `<button class="session-pin-btn${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Unpin family' : 'Pin family to top'}">📌</button>`;
  const familyToggle = hasChildren
    ? `<button class="session-family-toggle" data-family-id="${escapeHtml(session.id)}" aria-expanded="${familyExpanded}" aria-label="${familyExpanded ? 'Collapse' : 'Show'} ${familyNode!.size - 1} child session${familyNode!.size === 2 ? '' : 's'}" title="${familyExpanded ? 'Collapse' : 'Show'} ${familyNode!.size - 1} child session${familyNode!.size === 2 ? '' : 's'}"><span>${familyExpanded ? '▾' : '▸'}</span><small>${familyNode!.size - 1}</small></button>`
    : ((opts.familyDepth || 0) > 0 ? '<span class="session-family-leaf" aria-hidden="true">↳</span>' : '');
  // Read confirm/busy from options so a poll re-render keeps an armed confirm.
  const closeArmed = options.closeConfirm === key;
  const closeBusy = options.closeBusy === key;
  const detachClient = session.closeMode === 'client-only';
  const closeTitle = detachClient ? 'Detach client'
    : session.closeMode === 'owned-agent' ? 'Stop this agent and its children (transcript stays resumable)'
      : 'Close session (transcript stays resumable)';
  const closeBtn = session.isActive && sessionSupports(session, 'close')
    ? `<button class="session-close-btn${closeArmed ? ' confirm' : ''}" title="${closeArmed ? 'Tap again: ' : ''}${closeTitle}">${closeBusy ? '…' : closeArmed ? (detachClient ? 'detach?' : 'close?') : '✕'}</button>`
    : '';
  const badgeKey = JSON.stringify([session.harnessId, session.harnessLabel]);
  let harnessBadge = badges.get(badgeKey);
  if (harnessBadge === undefined) { harnessBadge = renderHarnessBadge(session.harnessId, session.harnessLabel); badges.set(badgeKey, harnessBadge); }
  const routineChip = session.routine
    ? `<span class="routine-chip" title="Started by the &quot;${escapeHtml(session.routine)}&quot; routine">⏱ ${escapeHtml(session.routine)}</span>`
    : '';
  const hibernationChip = session.hibernation
    ? `<span class="hibernation-chip" title="${escapeHtml(hibernationSummary(session.hibernation))}">hibernated</span>`
    : '';
  // Private transcripts live outside backed-up folders; this chip is the only on-row signal.
  const privateChip = session.private
    ? '<span class="private-chip" title="Private session — stored outside backed-up session folders">private</span>'
    : '';
  // Pinned rows get a drag handle; out-of-group rows get a cwd hint.
  const dragHandle = opts.pinnedRow ? '<span class="session-drag-handle" title="Drag to reorder">⠿</span>' : '';
  const cwdHint = (opts.pinnedRow || opts.showCwd) ? `<span class="session-item-cwd">${escapeHtml(shortCwd(session.cwd || '~'))}</span>` : '';
  // Out-of-group rows name their host; in the tree the group header does.
  let hostChip = '';
  if (opts.pinnedRow || opts.showCwd) {
    const host = session.host || null;
    if (!hostChips.has(host)) hostChips.set(host, options.hostChip(host));
    hostChip = hostChips.get(host)!;
  }
  const staleHost = downHosts.has(session.host || null) ? ' stale-host' : '';
  // Snippet explains content-only matches; only positive plain terms are highlighted.
  const snippetLine = session.searchSnippet
    ? `<div class="session-item-snippet">${highlightTokens(session.searchSnippet, queryTokens)}</div>`
    : '';
  const thinkingChip = session.thinkingLevel
    ? `<span class="session-item-thinking" title="Thinking level: ${escapeHtml(session.thinkingLevel)}">${escapeHtml(session.thinkingLevel)}</span>`
    : '';

  const html = `
    <div class="session-item ${activeClass} ${inactiveClass}${closeBusy ? ' closing' : ''}${staleHost}" data-id="${escapeHtml(session.id)}"${session.host ? ` data-host="${escapeHtml(session.host)}"` : ''}>
      <div class="session-item-header">
        ${dragHandle}${familyToggle}${liveDot}<span class="session-item-name" title="${escapeHtml(session.id)}">${escapeHtml(displayName)}</span>
        <span class="session-item-time">${timeAgo}</span>
        ${pinBtn}${closeBtn}
      </div>
      <div class="session-item-meta">
        <span class="session-item-model" title="${escapeHtml(session.model || '')}">${escapeHtml(shortModelName(session.model))}</span>
        ${thinkingChip}
        ${cacheHtml}<span class="session-item-context ${ctxClass}" title="${escapeHtml(ctxTitle)}">${escapeHtml(ctxText)}</span>
      </div>
      <div class="session-item-tags${hostChip ? ' with-host' : ''}">
        ${hostChip}${harnessBadge}${routineChip}${hibernationChip}${privateChip}${cwdHint}
      </div>
      ${snippetLine}
    </div>
  `;
  const occurrence = occurrences.get(key) || 0;
  occurrences.set(key, occurrence + 1);
  const rowKey = JSON.stringify([key, occurrence]);
  rows.push({ key: rowKey, html });
  return `<template data-sidebar-row="${escapeHtml(rowKey)}"></template>`;
}

function renderSessionFamily(node: SessionFamily<SessionEntry>, opts: FamilyOptions = {}, depth = 0, rootId = node.session.id,
  rootKey = sessionRefKey(node.session)): string {
  const expanded = node.children.length > 0 && options.expanded.has(sessionRefKey(node.session));
  const row = renderSessionItem(node.session, {
    familyNode: node,
    // Avoids findSession's linear scan per row.
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
  const { active, previous } = options;
  // Live subagents belong on the Active tab; the count badge still counts only controllable sessions.
  const showing = options.tab === 'active'
    ? [...active, ...previous.filter(session => session.subagentLive)]
    : [...active, ...previous];
  const pending = options.pending;

  // Routine runs flood history, so they're hidden unless the query/scope asks for
  // them; live ones stay. Hidden rows remain in `sessions` for selection and refs.
  const sq = options.scope;
  const scopeParsed = sq ? parseSessionQuery(sq) : null;
  const asksAutomation = queryAsksForAutomation(parsedQuery)
    || (scopeParsed ? queryAsksForAutomation(scopeParsed) : false);
  let visible = showing, automationHidden = 0;
  if (!asksAutomation) {
    visible = showing.filter((session) => {
      if (session.isActive || !isAutomationSession(session)) return true;
      automationHidden++;
      return false;
    });
  }
  // Once the server answered this query it is authoritative (it matches content;
  // the local pass is metadata-only). `host:` never reaches the server, so apply it here.
  const authoritative = !!options.query && options.queriedFor === options.query;
  // Not applyLocalFilter: it would sort, and we re-sort after scopes anyway.
  const queried = authoritative ? applyHostTerms(visible, options.query)
    : options.query ? visible.filter(session => evaluateSessionQuery(parsedQuery, session)) : visible;
  // Scopes are metadata/date-only so they behave identically on both tabs.
  const filtered = scopeParsed ? queried.filter(s => evaluateSessionQuery(scopeParsed, s)) : queried;
  const scopesHidden = queried.length - filtered.length;

  let html = '';
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
    // With a query, `active` is server-filtered: empty means "no matches".
    const msg = options.tab === 'active'
      ? (active.length === 0 && !options.query ? 'No active sessions<br><span style="font-size:11px">Click "+ New Session" or resume one from All</span>' : 'No matches')
      : (visible.length === 0 && !options.query ? 'No sessions found' : 'No matches');
    html += `<div class="empty-session"><p style="color: var(--text-muted); font-size: 13px; padding: 16px; text-align: center;">${msg}</p></div>`;
  } else if (options.query) {
    // Search results are one flat ranked list; server searchScore (which counts
    // transcript hits) wins where present, recency breaks ties.
    const ranked = filtered
      .map(session => {
        const localScore = authoritative ? 0 : scoreSessionMatch(parsedQuery, session);
        return { session, localScore, score: session.searchScore ?? (authoritative ? scoreSessionMatch(parsedQuery, session) : localScore),
          activity: new Date(session.lastActivity || 0).getTime() };
      })
      // Equal server scores fall back to the local ordering during debounce.
      .sort((a, b) => b.score - a.score || b.activity - a.activity || b.localScore - a.localScore);
    html += `<div class="session-segment ranked-segment">
      ${ranked.map(({ session }) => renderSessionItem(session, { showCwd: true })).join('')}
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
      // A family sits in its newest member's bucket so it isn't split.
      html += groupSessionsByDate(restFamilies).map(renderDateBucket).join('');
    } else {
      html += renderWorkspaceTrees(flattenSessionFamilies(restFamilies));
    }
  }
  // Down hosts with no cached rows would otherwise vanish silently.
  html += hostOfflineNotesHtml();
  // Keep automation-hidden rows discoverable.
  if (automationHidden > 0) {
    html += `<div class="scope-hidden-note">${countLabel(automationHidden, 'automation run')} hidden (is:automation shows them)</div>`;
  }
  if (scopesHidden > 0) {
    html += `<div class="scope-hidden-note">${scopesHidden} hidden by scopes</div>`;
  }

  return { layout: html, rows, count: active.length + pending.length,
    // String consumers get complete markup; the DOM controller only parses changed rows.
    get html() { let index = 0; return html.replace(/<template data-sidebar-row="[^"]*"><\/template>/g, () => rows[index++].html); } };
}

/** Multi-host keys are host-qualified; single-host keys stay bare so existing collapse state stays valid. */
function workspaceGroupKey(hostId: string | null, path: string) {
  return options.multiHost && hostId ? sessionKey(hostId, path) : path;
}

// Hosts with their own section; offline notes skip them so nothing is announced twice.
let hostSectionsShown: Set<string> | null = null;

/** Multi-host: one section per host, self first then by label (not recency, so headings stay put). */
function renderWorkspaceTrees(list: readonly SessionEntry[]) {
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
    // A down host keeps its heading so its absence is explained in place.
    if (!mine.length && !down) continue;
    hostSectionsShown.add(host.key);
    const key = hostSectionKey(host.key);
    const isCollapsed = options.collapsed.has(key);
    let body = '';
    if (!isCollapsed) {
      // groupByWorkspace/buildWorkspaceTree only ask `has(path)`; strip the host prefix.
      const collapsedView = hostId ? new Set([...options.collapsed].filter(key => key.startsWith(hostId + ' ')).map(key => key.slice((hostId + ' ').length))) : options.collapsed;
      body = buildWorkspaceTree(groupByWorkspace(mine, collapsedView), collapsedView)
        .map(node => renderWorkspaceNode(node, { hostId })).join('');
      if (!mine.length) {
        body = `<div class="host-section-empty">${escapeHtml(host.state === 'blocked'
          ? 'Enter this host’s token in Settings.' : 'Nothing cached from this host yet.')}</div>`;
      }
    }
    // A collapsed section must not hide activity.
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

/** Down hosts without a workspace section heading get one quiet line each. */
function hostOfflineNotesHtml() {
  if (!options.multiHost) return '';
  return options.hosts.filter(host => {
    if (!hostIsDown(host)) return false;
    if (hostSectionsShown && hostSectionsShown.has(host.key)) return false;
    return !host.hasCache;
  }).map(host => `<div class="host-offline-note">${escapeHtml(hostDisplayLabel(host))} — ${
    host.state === 'blocked' ? 'needs a token (Settings)' : 'unreachable'}</div>`).join('');
}

/** Collapsing hides the subtree, so the header surfaces the best descendant signal. */
function renderWorkspaceNode(node: WorkspaceNode<SessionEntry>, opts: { hostId?: string | null } = {}): string {
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

/** Date buckets key collapse state as 'date:<key>' so it can't collide with workspace paths. */
function renderDateBucket(bucket: { key: string; label: string; sessions: readonly SessionFamily<SessionEntry>[] }) {
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
