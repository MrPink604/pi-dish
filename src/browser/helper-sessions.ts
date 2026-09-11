import type { Timestamp, HelperSession, WorkspaceNode, WorkspaceBranch, SessionFamily, Relation } from './shared-helper-types';
import { shortCwd } from './helper-format';
import { finite, timestampMillis } from './helper-values';
import { sessionRefKey, sessionKey } from './helper-identity';

/**
 * Group sessions by workspace (cwd); groups and members sorted by last
 * activity. Groups whose cwd is in `collapsedSet` sort after all expanded
 * groups (still by recency among themselves).
 */
export function groupByWorkspace<T extends HelperSession>(list: readonly T[], collapsedSet?: ReadonlySet<string>) {
  const groups = new Map<string, T[]>(); // cwd -> [sessions]
  for (const s of list) {
    const key = s.cwd || '~';
    let group = groups.get(key);
    if (!group) { group = []; groups.set(key, group); }
    group.push(s);
  }

  for (const [, sessions] of groups) {
    sessions.sort((a, b) => timestampMillis(b.lastActivity) - timestampMillis(a.lastActivity));
  }

  const collapsed = (cwd: string) => (collapsedSet?.has(cwd) ? 1 : 0);
  return [...groups.entries()].sort((a, b) =>
    collapsed(a[0]) - collapsed(b[0])
    || timestampMillis(b[1][0].lastActivity) - timestampMillis(a[1][0].lastActivity));
}

/**
 * Fold groupByWorkspace's flat [cwd, sessions] pairs into a tree of path
 * nodes with single-child chains flattened (a node exists only where paths
 * diverge or sessions live). Flat labels in a narrow sidebar all show the
 * same prefix and ellipsize away the part that differs — the tree shows
 * the shared prefix once and each workspace by its distinguishing tail.
 * Returns root nodes { label, path, sessions, children, count }: `path` is
 * the full prefix (collapse-state key — equals the cwd for leaf nodes),
 * `sessions` the sessions living exactly at `path` (null if none), `count`
 * the subtree total. Sibling order follows the input's (recency), with
 * collapsed nodes sunk below expanded siblings at every level.
 */
export function buildWorkspaceTree<T>(groups: readonly (readonly [string, readonly T[]])[], collapsedSet?: ReadonlySet<string>) {
  const root: WorkspaceBranch<T> = { label: '', path: '', sessions: null, children: new Map(), order: 0 };
  groups.forEach(([cwd, sessions], order) => {
    let segs = cwd.split('/').filter(Boolean);
    if (segs.length === 0) segs = [cwd]; // degenerate cwd ('/') — don't drop it
    let node = root;
    for (const seg of segs) {
      const path = node === root
        ? (cwd[0] === '/' && seg !== cwd ? '/' + seg : seg)
        : node.path + '/' + seg;
      let child = node.children.get(seg);
      if (!child) { child = { label: seg, path, sessions: null, children: new Map(), order }; node.children.set(seg, child); }
      node = child;
      node.order = Math.min(node.order, order);
    }
    node.sessions = sessions;
  });

  // Flatten chains: a prefix-only node with a single child merges into it.
  const flatten = (node: WorkspaceBranch<T>): void => {
    while (node.children.size === 1 && !node.sessions) {
      const child = node.children.values().next().value;
      if (!child) break;
      node.label = node.label ? node.label + '/' + child.label : child.label;
      node.path = child.path;
      node.sessions = child.sessions;
      node.children = child.children;
    }
    for (const child of node.children.values()) flatten(child);
  };
  for (const top of root.children.values()) flatten(top);

  // The home dir is the shared root of practically everything — a bare "~"
  // top node is pure noise (and an indent level phones can't spare). Hoist
  // its children to top level; shortCwd gives them their ~/ labels below.
  const tops = [...root.children.values()];
  const homeIdx = tops.findIndex(t => shortCwd(t.path) === '~' && !t.sessions && t.children.size);
  if (homeIdx !== -1) tops.splice(homeIdx, 1, ...tops[homeIdx].children.values());

  const collapsed = (path: string) => (collapsedSet?.has(path) ? 1 : 0);
  const finalize = (node: WorkspaceBranch<T>, topLevel: boolean): WorkspaceNode<T> => {
    const children = [...node.children.values()].map(child => finalize(child, false));
    children.sort((a, b) => collapsed(a.path) - collapsed(b.path) || a.order - b.order);
    return { ...node, children,
      count: (node.sessions ? node.sessions.length : 0) + children.reduce((n, child) => n + child.count, 0),
      label: topLevel ? shortCwd(node.path) : node.label };
  };
  return tops.map(top => finalize(top, true)).sort((a, b) => collapsed(a.path) - collapsed(b.path) || a.order - b.order);
}

/**
 * Group sessions into date buckets for the sidebar's Recent view: Today,
 * Yesterday, This week / Last week (Monday-start), then one bucket per
 * month, newest first; sessions sort by recency inside each. Returns
 * [{ key, label, sessions }] — `key` is the stable collapse-state handle
 * ('today', 'week', 'm:2026-06', …), `label` the header text. Sessions with
 * no usable timestamp (epoch-0 fallbacks) land in a trailing 'undated'
 * bucket instead of a comical "January 1970" month.
 */
export function groupSessionsByDate<T extends { activity?: number; lastActivity?: Timestamp | null }>(list: readonly T[], now = Date.now()) {
  const day = (t: Timestamp) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = day(now);
  const yesterday = today - 86400e3;
  const weekStart = today - (((new Date(today).getDay() + 6) % 7) * 86400e3);
  const lastWeekStart = weekStart - 7 * 86400e3;
  const bucketOf = (t: number) => {
    if (!finite(t) || t <= 0) return { key: 'undated', label: 'Undated' };
    if (t >= today) return { key: 'today', label: 'Today' };
    if (t >= yesterday) return { key: 'yesterday', label: 'Yesterday' };
    if (t >= weekStart) return { key: 'week', label: 'This week' };
    if (t >= lastWeekStart) return { key: 'lastweek', label: 'Last week' };
    const d = new Date(t);
    return {
      key: `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  };
  const timestampOf = (item: T) => finite(item?.activity)
    ? item.activity : new Date(item?.lastActivity || 0).getTime();
  const sorted = [...list].sort((a, b) => timestampOf(b) - timestampOf(a));
  const buckets = new Map<string, { key: string; label: string; sessions: T[] }>();
  for (const s of sorted) {
    const b = bucketOf(timestampOf(s));
    let bucket = buckets.get(b.key);
    if (!bucket) { bucket = { ...b, sessions: [] }; buckets.set(b.key, bucket); }
    bucket.sessions.push(s);
  }
  // Input order is recency-desc, so buckets appear newest-first already —
  // except 'undated', which must sink below everything dated.
  const out = [...buckets.values()];
  const u = out.findIndex(b => b.key === 'undated');
  if (u !== -1) out.push(out.splice(u, 1)[0]);
  return out;
}

/** All sessions in a workspace-tree subtree (collapsed headers aggregate status). */
export function collectTreeSessions<T>(node: WorkspaceNode<T>, out: T[] = []) {
  if (node.sessions) out.push(...node.sessions);
  for (const child of node.children) collectTreeSessions(child, out);
  return out;
}


export function sessionFamilyParentId(session?: HelperSession | null) {
  return Object.prototype.hasOwnProperty.call(session || {}, 'familyParentId')
    ? session?.familyParentId : session?.parentId;
}

/**
 * Build same-host, same-workspace parent/child trees from advisory `parentId` hints.
 * Roots and sibling subtrees sort as blocks by the newest activity anywhere
 * below them, while the parent session itself remains the first row.
 * Missing/cross-workspace parents and cycles degrade to standalone roots.
 */
export function buildSessionFamilies<T extends HelperSession>(list?: readonly T[] | null) {
  const nodes = new Map<string, SessionFamily<T>>();
  (list || []).forEach((session, order) => {
    if (session?.id && !nodes.has(sessionRefKey(session))) {
      nodes.set(sessionRefKey(session), { session, children: [], activity: 0, size: 1, order });
    }
  });

  const attached = new Set();
  for (const node of nodes.values()) {
    const parent = nodes.get(sessionKey(node.session.host, sessionFamilyParentId(node.session)));
    if (!parent || parent === node || (parent.session.cwd || '~') !== (node.session.cwd || '~')) continue;
    // Follow the declared chain before attaching so malformed A→B→A hints
    // cannot remove both nodes from the root set or recurse forever.
    let cursor: SessionFamily<T> | null = parent;
    const seen = new Set();
    let cyclic = false;
    while (cursor && !seen.has(cursor)) {
      if (cursor === node) { cyclic = true; break; }
      seen.add(cursor);
      const next = nodes.get(sessionKey(cursor.session.host, sessionFamilyParentId(cursor.session)));
      cursor = next && (next.session.cwd || '~') === (cursor.session.cwd || '~') ? next : null;
    }
    if (cyclic) continue;
    parent.children.push(node);
    attached.add(sessionRefKey(node.session));
  }

  const activityMs = (session: T) => {
    const value = new Date(session.lastActivity || 0).getTime();
    return finite(value) ? value : 0;
  };
  const finalize = (node: SessionFamily<T>): SessionFamily<T> => {
    node.activity = activityMs(node.session);
    node.size = 1;
    for (const child of node.children) {
      finalize(child);
      node.activity = Math.max(node.activity, child.activity);
      node.size += child.size;
    }
    node.children.sort((a, b) => b.activity - a.activity || a.order - b.order);
    return node;
  };
  const roots = [...nodes.values()].filter(node => !attached.has(sessionRefKey(node.session))).map(finalize);
  return roots.sort((a, b) => b.activity - a.activity || a.order - b.order);
}


export function flattenSessionFamilies<T>(families?: readonly SessionFamily<T>[] | null, out: T[] = []) {
  for (const family of families || []) {
    out.push(family.session);
    flattenSessionFamilies(family.children, out);
  }
  return out;
}

/**
 * Split family roots by any pinned member, preserving manual family order.
 * Pins are composite session keys (see sessionKey), so the index is built on
 * keys too; host-less sessions key on their bare id and behave as before.
 */
export function partitionPinnedFamilies<T extends HelperSession>(families?: readonly SessionFamily<T>[] | null, pinnedKeys?: readonly string[] | null) {
  if (!pinnedKeys?.length) return [[], families || []];
  const rootByMember = new Map<string, SessionFamily<T>>();
  const index = (node: SessionFamily<T>, root: SessionFamily<T>): void => {
    rootByMember.set(sessionRefKey(node.session), root);
    for (const child of node.children) index(child, root);
  };
  for (const root of families || []) index(root, root);
  // In a partial view (notably Active), an inactive parent may be absent while
  // its active children remain. Let the missing parent id alias those visible
  // root fragments; when the parent is present, normal same-cwd grouping wins.
  const rootsByMissingParent = new Map<string, SessionFamily<T>[]>();
  for (const root of families || []) {
    const parentId = sessionFamilyParentId(root.session);
    if (!parentId) continue;
    const parentKey = sessionKey(root.session.host, parentId);
    if (rootByMember.has(parentKey)) continue;
    const roots = rootsByMissingParent.get(parentKey) || [];
    roots.push(root);
    rootsByMissingParent.set(parentKey, roots);
  }
  const pinned = [];
  const pinnedRoots = new Set();
  for (const id of pinnedKeys) {
    const known = rootByMember.get(id);
    const matches = known ? [known] : (rootsByMissingParent.get(id) || []);
    for (const root of matches) {
      if (pinnedRoots.has(sessionRefKey(root.session))) continue;
      pinned.push(root);
      pinnedRoots.add(sessionRefKey(root.session));
    }
  }
  return [pinned, (families || []).filter(root => !pinnedRoots.has(sessionRefKey(root.session)))];
}

/**
 * Split sessions into [pinned, rest]. Pinned sessions come back in
 * `pinnedIds` order (the user's manual arrangement); ids with no matching
 * session are skipped.
 */
export function partitionPinned<T extends { id: string }>(list: readonly T[], pinnedIds?: readonly string[] | null) {
  if (!pinnedIds || pinnedIds.length === 0) return [[], list];
  const byId = new Map(list.map(s => [s.id, s]));
  const pinned = pinnedIds.map(id => byId.get(id)).filter((value): value is T => value !== undefined);
  const pinnedSet = new Set(pinned.map(s => s.id));
  return [pinned, list.filter(s => !pinnedSet.has(s.id))];
}

// =========================================================================
// Session filter query grammar — one dialect for the sidebar's local filter,
// the server-side list search, and saved scopes, so a query means the same
// thing everywhere it can be typed.
//
//   foo "two words"        plain terms (AND) — metadata, plus message content
//                          where the caller supplies it (server search)
//   -foo -name:subagent    negation — always metadata-only, so a session
//                          whose *content* merely mentions the word survives
//   name:x cwd:x model:x id:x   field-scoped terms
//   is:active               live sessions only (-is:active for historical)
//   is:automation           routine-invoked sessions (see isAutomationSession)
//   since:7d since:2026-07-01 before:...   lastActivity bounds (h/d/w or ISO)
//
// Unknown prefixes stay literal text ("subagent: fix" searches for the colon
// form), so the grammar never eats a query that wasn't meant for it.
// =========================================================================
// Related-session chips use a stable kind order for the modal and for the
// header's candidate list. Singular lineage links (parent, startedFrom) sort
// before the potentially long child lists; children keep the server's order
// within a kind.
export const RELATION_KIND_ORDER: Readonly<Record<string, number>> = { parent: 0, startedFrom: 1, child: 2, startedHere: 3 };


export const RELATION_CHILD_KINDS = new Set(['child', 'startedHere']);


export function relationKindRank(kind?: string | null) {
  const rank = kind && Object.hasOwn(RELATION_KIND_ORDER, kind) ? RELATION_KIND_ORDER[kind] : undefined;
  return rank === undefined ? 99 : rank;
}


export function sortRelations<T extends Relation>(relations?: readonly T[] | null) {
  return (relations || [])
    .map((relation, index) => ({ relation, index }))
    .sort((a, b) => (relationKindRank(a.relation && a.relation.kind) - relationKindRank(b.relation && b.relation.kind)) || (a.index - b.index))
    .map(({ relation }) => relation);
}


export function isChildRelation(relation?: Relation | null) {
  return RELATION_CHILD_KINDS.has(relation?.kind || '');
}

/** Group relations by kind for the overflow modal, groups in rank order. */
export function groupRelations<T extends Relation>(relations?: readonly T[] | null) {
  const groups: { kind: string; relations: T[] }[] = [];
  const byKind = new Map<string, { kind: string; relations: T[] }>();
  for (const relation of relations || []) {
    const kind = (relation && relation.kind) || 'related';
    let group = byKind.get(kind);
    if (!group) {
      group = { kind, relations: [] };
      byKind.set(kind, group);
      groups.push(group);
    }
    group.relations.push(relation);
  }
  groups.sort((a, b) => relationKindRank(a.kind) - relationKindRank(b.kind));
  return groups;
}

/**
 * Unread = a live, idle session whose last activity is newer than when the
 * user last had it on screen. The session being viewed right now (visibly)
 * is never unread; a working session shows the working indicator instead.
 * Keys are composite (host + session), so `currentKey`/`seenMap` speak
 * sessionKey form; host-less sessions degrade to bare ids.
 */
export function isUnreadSession(session: HelperSession, seenMap: Readonly<Record<string, Timestamp>>, currentKey: string | null, viewingVisible: boolean) {
  if (!session.isActive || session.turnInProgress) return false;
  const key = sessionRefKey(session);
  if (key === currentKey && viewingVisible) return false;
  const seen = seenMap[key];
  return !seen || timestampMillis(session.lastActivity) > timestampMillis(seen);
}
