import type { Timestamp, HelperSession } from '../core/helper-types';
import type { WorkspaceNode, WorkspaceBranch, SessionFamily, Relation } from './shared-helper-types';
import { shortCwd } from './helper-format';
import { finite, timestampMillis } from '../core/helper-values';
import { sessionRefKey, sessionKey } from './helper-identity';

/** Collapsed groups sort after expanded ones, still by recency. */
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
 * Tree of path nodes with single-child chains flattened, so a narrow sidebar shows the
 * shared prefix once. `path` is the collapse key; collapsed nodes sink below siblings.
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

  // A bare "~" top node is noise and costs phones an indent level; hoist its children.
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

/** Recent-view date buckets; epoch-0 timestamps go to a trailing 'undated' bucket, not "January 1970". */
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
  // Input is recency-desc, so only 'undated' needs moving to the end.
  const out = [...buckets.values()];
  const u = out.findIndex(b => b.key === 'undated');
  if (u !== -1) out.push(out.splice(u, 1)[0]);
  return out;
}

export function collectTreeSessions<T>(node: WorkspaceNode<T>, out: T[] = []) {
  if (node.sessions) out.push(...node.sessions);
  for (const child of node.children) collectTreeSessions(child, out);
  return out;
}


const HOST_QUALIFIED_PARENT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+)$/i;

export function parseParentSessionRef(host?: string | null, parentId?: string | null): { hostId: string | null; sessionId: string } | null {
  if (!parentId) return null;
  const qualified = HOST_QUALIFIED_PARENT.exec(parentId);
  if (qualified) return { hostId: qualified[1].toLowerCase(), sessionId: qualified[2] };
  return { hostId: host || null, sessionId: parentId };
}

export function resolveParentKey(host?: string | null, parentId?: string | null, hostByLower?: ReadonlyMap<string, string>): string | null {
  const ref = parseParentSessionRef(host, parentId);
  if (!ref) return null;
  const resolvedHost = ref.hostId ? (hostByLower?.get(ref.hostId.toLowerCase()) ?? ref.hostId) : null;
  return sessionKey(resolvedHost, ref.sessionId);
}

export function sessionFamilyParentId(session?: HelperSession | null) {
  if (Object.prototype.hasOwnProperty.call(session || {}, 'familyParentId')) {
    if (session?.familyParentId) return session.familyParentId;
    if (session?.parentId && HOST_QUALIFIED_PARENT.test(session.parentId)) return session.parentId;
    return session?.familyParentId;
  }
  return session?.parentId;
}

/**
 * Recursive session families from advisory `parentId` hints across workspaces and hosts;
 * blocks sort by newest descendant activity. Missing parents and cycles become roots.
 * Optional `bridgePool` inserts closed intermediate parents only when they connect a
 * visible descendant to a visible ancestor (or a key in `bridgeRoots`).
 */
export function buildSessionFamilies<T extends HelperSession>(
  list?: readonly T[] | null,
  options?: { bridgePool?: readonly T[] | null; bridgeRoots?: ReadonlySet<string> | null },
) {
  const nodes = new Map<string, SessionFamily<T>>();
  const hostByLower = new Map<string, string>();
  const registerHost = (host?: string | null) => {
    if (host) {
      const lower = host.toLowerCase();
      if (!hostByLower.has(lower)) hostByLower.set(lower, host);
    }
  };
  (list || []).forEach((session, order) => {
    if (session?.id && !nodes.has(sessionRefKey(session))) {
      registerHost(session.host);
      nodes.set(sessionRefKey(session), { session, children: [], activity: 0, size: 1, order });
    }
  });

  if (options?.bridgePool?.length) {
    const poolByKey = new Map<string, T>();
    for (const session of options.bridgePool) {
      if (!session?.id) continue;
      registerHost(session.host);
      const key = sessionRefKey(session);
      if (!nodes.has(key) && !poolByKey.has(key)) poolByKey.set(key, session);
    }
    const bridgeRoots = options.bridgeRoots;
    let bridgeOrder = nodes.size;
    const ensureBridge = (key: string, session: T) => {
      if (!nodes.has(key)) {
        nodes.set(key, { session, children: [], activity: 0, size: 0, order: bridgeOrder++, bridge: true });
      }
    };
    for (const node of [...nodes.values()]) {
      const chain: [string, T][] = [];
      const seen = new Set<string>([sessionRefKey(node.session)]);
      let cursor: T | undefined = node.session;
      while (cursor) {
        const parentKey = resolveParentKey(cursor.host, sessionFamilyParentId(cursor), hostByLower);
        if (!parentKey || seen.has(parentKey)) break;
        seen.add(parentKey);
        if (nodes.has(parentKey)) {
          for (const [bKey, bSession] of chain) ensureBridge(bKey, bSession);
          break;
        }
        const pooled = poolByKey.get(parentKey);
        if (!pooled) break;
        chain.push([parentKey, pooled]);
        if (bridgeRoots?.has(parentKey)) {
          for (const [bKey, bSession] of chain) ensureBridge(bKey, bSession);
          break;
        }
        cursor = pooled;
      }
    }
  }

  const parentOf = (session: T): SessionFamily<T> | undefined => {
    const key = resolveParentKey(session.host, sessionFamilyParentId(session), hostByLower);
    return key ? nodes.get(key) : undefined;
  };

  const attached = new Set<string>();
  for (const node of nodes.values()) {
    const parent = parentOf(node.session);
    if (!parent || parent === node) continue;
    // Walk the chain first so A→B→A cycles can't drop both nodes or recurse forever.
    let cursor: SessionFamily<T> | undefined = parent;
    const seen = new Set<SessionFamily<T>>();
    let cyclic = false;
    while (cursor && !seen.has(cursor)) {
      if (cursor === node) { cyclic = true; break; }
      seen.add(cursor);
      cursor = parentOf(cursor.session);
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
    node.activity = node.bridge ? 0 : activityMs(node.session);
    node.size = node.bridge ? 0 : 1;
    for (const child of node.children) {
      finalize(child);
      node.activity = Math.max(node.activity, child.activity);
      node.size += child.size;
    }
    if (node.bridge && node.activity === 0) node.activity = activityMs(node.session);
    node.children.sort((a, b) => b.activity - a.activity || a.order - b.order);
    return node;
  };
  const roots = [...nodes.values()].filter(node => !attached.has(sessionRefKey(node.session))).map(finalize);
  return roots.sort((a, b) => b.activity - a.activity || a.order - b.order);
}


export function flattenSessionFamilies<T>(families?: readonly SessionFamily<T>[] | null, out: T[] = []) {
  for (const family of families || []) {
    if (!family.bridge) out.push(family.session);
    flattenSessionFamilies(family.children, out);
  }
  return out;
}

export function partitionPinnedFamilies<T extends HelperSession>(families?: readonly SessionFamily<T>[] | null, pinnedKeys?: readonly string[] | null) {
  if (!pinnedKeys?.length) return [[], families || []];
  const rootByMember = new Map<string, SessionFamily<T>>();
  const index = (node: SessionFamily<T>, root: SessionFamily<T>): void => {
    rootByMember.set(sessionRefKey(node.session), root);
    for (const child of node.children) index(child, root);
  };
  for (const root of families || []) index(root, root);
  // In partial views (Active) a missing parent id aliases its visible child roots.
  const rootsByMissingParent = new Map<string, SessionFamily<T>[]>();
  for (const root of families || []) {
    const parentId = sessionFamilyParentId(root.session);
    if (!parentId) continue;
    const parentKey = resolveParentKey(root.session.host, parentId);
    if (!parentKey || rootByMember.has(parentKey)) continue;
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

/** Pinned come back in `pinnedIds` order; ids with no matching session are skipped. */
export function partitionPinned<T extends { id: string }>(list: readonly T[], pinnedIds?: readonly string[] | null) {
  if (!pinnedIds || pinnedIds.length === 0) return [[], list];
  const byId = new Map(list.map(s => [s.id, s]));
  const pinned = pinnedIds.map(id => byId.get(id)).filter((value): value is T => value !== undefined);
  const pinnedSet = new Set(pinned.map(s => s.id));
  return [pinned, list.filter(s => !pinnedSet.has(s.id))];
}

// Singular lineage links sort before the potentially long child lists.
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

/** Unread = live, idle, and active since last on screen; the visibly viewed session never is. */
export function isUnreadSession(session: HelperSession, seenMap: Readonly<Record<string, Timestamp>>, currentKey: string | null, viewingVisible: boolean) {
  if (!session.isActive || session.turnInProgress) return false;
  const key = sessionRefKey(session);
  if (key === currentKey && viewingVisible) return false;
  const seen = seenMap[key];
  return !seen || timestampMillis(session.lastActivity) > timestampMillis(seen);
}
