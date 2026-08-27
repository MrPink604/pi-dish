/**
 * Pure helpers shared by the frontend (loaded as globals before app.js) and
 * the node test suite (require('../public/helpers.js')). No DOM, no state —
 * keep it that way so everything here stays unit-testable.
 */

function escapeHtml(text) {
  if (text == null || text === '') return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Remove ANSI escape sequences (CSI colors, OSC titles, stray escapes).
 * Extension UI strings arrive styled for the terminal via pi's theme.fg();
 * a browser renders those codes as literal "[38;2;…m" garbage.
 */
function stripAnsi(text) {
  if (text == null || text === '') return '';
  return String(text)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '') // OSC … BEL/ST
    .replace(/\x1b\[[0-9;:?]*[ -\/]*[@-~]/g, '')        // CSI (colors, cursor)
    .replace(/\x1b[ -\/]*./g, '');                      // leftover ESC + intermediates + final
}

function formatTokens(tokens) {
  if (!tokens || tokens === 0) return '0';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

// Stats-modal "Cache" cell. OpenAI-style completions APIs report cache reads
// but have no write metric, so pi logs cacheWrite:0 even when writes clearly
// happened (a later nonzero cacheRead proves it). Writes therefore only show
// when actually reported; the hit rate — reads over all prompt tokens — is
// computable from logged data on every provider and is the number that says
// whether caching is working.
function formatCacheStat(cacheRead, cacheWrite, input) {
  const read = cacheRead || 0;
  const write = cacheWrite || 0;
  const prompt = read + write + (input || 0);
  if (prompt === 0) return '—';
  let s = `${formatTokens(read)} read (${Math.round((read / prompt) * 100)}% hit)`;
  if (write > 0) s += ` · ${formatTokens(write)} written`;
  else if (read > 0) s += ' · writes not reported';
  return s;
}

// One line for the stats modal's "Running in" row, from the server's runtime
// object (GET /stats): rpc = headless child of the pi-dish server, tmux = a
// TUI pane (session/window fields are null when the live pane query failed —
// the server name alone still locates it), terminal = a TUI outside tmux.
function formatRuntime(r) {
  if (!r || !r.kind) return '—';
  const pid = r.pid ? ` · pid ${r.pid}` : '';
  if (r.kind === 'rpc') return `pi-dish server (headless)${pid}`;
  if (r.kind === 'tmux') {
    // The hidden headless placement (dedicated pi-dish socket) reads as
    // "headless" to the user — the tmux part is plumbing worth a hint only.
    if (r.server === 'pi-dish') {
      const sess = r.tmuxSession && r.tmuxSession !== 'headless' ? ` · ${r.tmuxSession}` : '';
      return `headless (hidden tmux — survives restarts)${sess}${pid}`;
    }
    let where = `tmux ${r.server || '?'}`;
    if (r.tmuxSession) {
      where += ` · ${r.tmuxSession}`;
      if (r.windowIndex != null) where += `:${r.windowIndex}`;
      if (r.windowName) where += ` ${r.windowName}`;
    }
    return where + pid;
  }
  return `terminal${pid}`;
}

// Generation speed for one assistant message or a whole session. Null when
// the sample can't mean anything: no tokens, or under a second of generation
// (sub-second bursts read as absurd rates).
function formatTokSpeed(outputTokens, durationMs) {
  if (!outputTokens || !durationMs || durationMs < 1000) return null;
  const rate = outputTokens / (durationMs / 1000);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return (rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10) + ' tok/s';
}

/** Harness-catalog estimate; deliberately never presented as a provider bill. */
function formatEstimatedCost(value, digits = 4) {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value === 0) return '~$0';
  const precision = value < 0.0001 ? Math.max(digits, 6) : value < 0.01 ? Math.max(digits, 4) : 2;
  return `~$${value.toFixed(precision)}`;
}

/** Known catalog-priced subtotal; `*` means one or more calls were omitted. */
function formatUsageCost(value, unavailable = 0) {
  const formatted = formatEstimatedCost(value);
  return Number.isFinite(value) && unavailable ? `${formatted}*` : formatted;
}

/** Compact metadata label for an authoritative, indexed assistant response. */
function formatResponseMetadata(msg, mode = 'compact') {
  if (!msg || mode === 'hidden') return null;
  const usage = msg.usage || {};
  const speed = formatTokSpeed(msg.outputTokens || usage.output, msg.durationMs);
  const tokens = usage.output ? `${formatTokens(usage.output)} out` : null;
  const elapsed = Number.isFinite(msg.durationMs) && msg.durationMs > 0
    ? `${msg.durationMs < 10000 ? (msg.durationMs / 1000).toFixed(1) : Math.round(msg.durationMs / 1000)}s`
    : null;
  if (mode === 'compact') return speed || tokens;
  const performance = [elapsed, speed].filter(Boolean).join(' · ');
  if (mode === 'performance-cost') {
    const cost = msg.pricingKnown !== false && Number.isFinite(usage.cost?.total) ? formatEstimatedCost(usage.cost.total) : null;
    return [performance, cost].filter(Boolean).join(' · ') || tokens;
  }
  return performance || tokens;
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const s = Math.floor(diff / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (s < 60) return 'just now';
  if (m < 60) return m + 'm ago';
  if (h < 24) return h + 'h ago';
  if (d === 1) return 'yesterday';
  if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Compact elapsed time for the working indicator: 0:05, 4:32, 1:04:09. */
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:${mm}` : mm) + ':' + String(s).padStart(2, '0');
}

/** Shorten cwd for display */
function shortCwd(cwd) {
  if (!cwd) return '';
  return cwd.replace(/^\/home\/[^/]+\//, '~/').replace(/^\/home\/[^/]+$/, '~');
}

// No newline — truncated text also lands in one-line summary spans.
function truncate(text, maxLen, suffix = ' … (truncated)') {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + suffix;
}

function extractTextContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => typeof c === 'string' ? c : c.type === 'text' ? c.text : '').join('\n');
  return '';
}

function getToolSummary(toolName, args) {
  if (!args) return '';
  if (toolName === 'Bash' || toolName === 'bash') return args.command ? truncate(args.command.split('\n')[0], 60) : '';
  if (['Read', 'read', 'Edit', 'edit', 'Write', 'write'].includes(toolName)) return args.path || '';
  const keys = Object.keys(args);
  if (keys.length) return truncate(String(args[keys[0]]), 40);
  return '';
}

/**
 * Whether a message renders any prose (a non-empty text block or an error).
 * Drives the `.message.no-text` class that focus mode and tool-activity
 * grouping key on. One definition for the static and streaming renderers —
 * they used to derive it independently and disagreed about errorMessage.
 */
function messageHasVisibleText(msg) {
  if (!msg) return false;
  if (msg.errorMessage) return true;
  if (typeof msg.content === 'string') return !!msg.content;
  return Array.isArray(msg.content) && msg.content.some(b => b && b.type === 'text' && !!b.text);
}

function getToolOutputText(partialResult) {
  if (!partialResult || !partialResult.content) return '';
  return partialResult.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');
}

/**
 * Image content blocks from a message or tool-result content array. Live
 * events carry `{ data, mimeType }`; historical pages project those bytes to
 * `{ url, mimeType }` so the browser can cache/lazy-load them. Non-array
 * content and blocks without either source yield nothing; mimeType defaults
 * to image/png. Rendering stays with the DOM-owning caller.
 */
function extractImageBlocks(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    if (!block || block.type !== 'image') continue;
    if (block.url) out.push({ url: block.url, mimeType: block.mimeType || 'image/png' });
    else if (block.data) out.push({ data: block.data, mimeType: block.mimeType || 'image/png' });
  }
  return out;
}

/** Severity class for a context-usage percentage (session list + header badges). */
function contextClass(percent) {
  return percent > 80 ? 'critical' : percent > 50 ? 'high' : '';
}

/** Missing capability metadata is legacy Pi behavior: supported by default. */
function sessionSupports(session, capability) {
  return session?.capabilities?.[capability] !== false;
}

/** Compact sidebar identity for each supported agent harness. */
function harnessBadgeInfo(harnessId, harnessLabel) {
  const known = {
    pi: { label: 'Pi', icon: 'vendor/harness-pi.svg' },
    omp: { label: 'OMP', icon: 'vendor/harness-omp.svg' },
    prime: { label: 'Prime', icon: 'vendor/harness-prime.svg' },
  };
  return known[harnessId] || {
    label: harnessLabel || harnessId || 'Agent',
    icon: null,
  };
}

/** The searchable metadata text of a session — one definition for local
 * filtering and the server-side session search. */
function sessionMetaText(session) {
  return [session.name, session.cwd, session.model, session.id].join(' ').toLowerCase();
}

/** "provider/id" → { provider, id } (provider '' when the ref is bare). */
function parseModelId(fullModelId) {
  const slashIdx = fullModelId.indexOf('/');
  if (slashIdx > 0) {
    return { provider: fullModelId.slice(0, slashIdx), id: fullModelId.slice(slashIdx + 1) };
  }
  return { provider: '', id: fullModelId };
}

/** Model object (or string ref) → "provider/id" string, null when unknown. */
function formatModelRef(model) {
  if (!model) return null;
  if (typeof model === 'string') return model;
  const provider = model.provider;
  const id = model.id || model.modelId;
  return provider && id ? `${provider}/${id}` : null;
}

/**
 * Group sessions by workspace (cwd); groups and members sorted by last
 * activity. Groups whose cwd is in `collapsedSet` sort after all expanded
 * groups (still by recency among themselves).
 */
function groupByWorkspace(list, collapsedSet) {
  const groups = new Map(); // cwd -> [sessions]
  for (const s of list) {
    const key = s.cwd || '~';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  for (const [, sessions] of groups) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  const collapsed = (cwd) => (collapsedSet?.has(cwd) ? 1 : 0);
  return [...groups.entries()].sort((a, b) =>
    collapsed(a[0]) - collapsed(b[0])
    || new Date(b[1][0].lastActivity) - new Date(a[1][0].lastActivity));
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
function buildWorkspaceTree(groups, collapsedSet) {
  const root = { label: '', path: '', sessions: null, children: new Map(), order: 0 };
  groups.forEach(([cwd, sessions], order) => {
    let segs = cwd.split('/').filter(Boolean);
    if (segs.length === 0) segs = [cwd]; // degenerate cwd ('/') — don't drop it
    let node = root;
    for (const seg of segs) {
      const path = node === root
        ? (cwd[0] === '/' && seg !== cwd ? '/' + seg : seg)
        : node.path + '/' + seg;
      if (!node.children.has(seg)) {
        node.children.set(seg, { label: seg, path, sessions: null, children: new Map(), order });
      }
      node = node.children.get(seg);
      node.order = Math.min(node.order, order);
    }
    node.sessions = sessions;
  });

  // Flatten chains: a prefix-only node with a single child merges into it.
  const flatten = (node) => {
    while (node.children.size === 1 && !node.sessions) {
      const child = node.children.values().next().value;
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

  const collapsed = (path) => (collapsedSet?.has(path) ? 1 : 0);
  const finalize = (node, topLevel) => {
    const kids = [...node.children.values()];
    for (const k of kids) finalize(k, false);
    kids.sort((a, b) => collapsed(a.path) - collapsed(b.path) || a.order - b.order);
    node.children = kids;
    node.count = (node.sessions ? node.sessions.length : 0)
      + kids.reduce((n, k) => n + k.count, 0);
    if (topLevel) node.label = shortCwd(node.path);
  };
  for (const top of tops) finalize(top, true);
  return tops.sort((a, b) => collapsed(a.path) - collapsed(b.path) || a.order - b.order);
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
function groupSessionsByDate(list, now = Date.now()) {
  const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = day(now);
  const yesterday = today - 86400e3;
  const weekStart = today - (((new Date(today).getDay() + 6) % 7) * 86400e3);
  const lastWeekStart = weekStart - 7 * 86400e3;
  const bucketOf = (t) => {
    if (!Number.isFinite(t) || t <= 0) return { key: 'undated', label: 'Undated' };
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
  const timestampOf = (item) => Number.isFinite(item?.activity)
    ? item.activity : new Date(item?.lastActivity || 0).getTime();
  const sorted = [...list].sort((a, b) => timestampOf(b) - timestampOf(a));
  const buckets = new Map();
  for (const s of sorted) {
    const b = bucketOf(timestampOf(s));
    if (!buckets.has(b.key)) buckets.set(b.key, { ...b, sessions: [] });
    buckets.get(b.key).sessions.push(s);
  }
  // Input order is recency-desc, so buckets appear newest-first already —
  // except 'undated', which must sink below everything dated.
  const out = [...buckets.values()];
  const u = out.findIndex(b => b.key === 'undated');
  if (u !== -1) out.push(out.splice(u, 1)[0]);
  return out;
}

/** All sessions in a workspace-tree subtree (collapsed headers aggregate status). */
function collectTreeSessions(node, out = []) {
  if (node.sessions) out.push(...node.sessions);
  for (const child of node.children) collectTreeSessions(child, out);
  return out;
}

function sessionFamilyParentId(session) {
  return Object.prototype.hasOwnProperty.call(session || {}, 'familyParentId')
    ? session.familyParentId : session?.parentId;
}

/**
 * Build same-workspace parent/child trees from advisory `parentId` hints.
 * Roots and sibling subtrees sort as blocks by the newest activity anywhere
 * below them, while the parent session itself remains the first row.
 * Missing/cross-workspace parents and cycles degrade to standalone roots.
 */
function buildSessionFamilies(list) {
  const nodes = new Map();
  (list || []).forEach((session, order) => {
    if (session?.id && !nodes.has(session.id)) {
      nodes.set(session.id, { session, children: [], activity: 0, size: 1, order });
    }
  });

  const attached = new Set();
  for (const node of nodes.values()) {
    const parent = nodes.get(sessionFamilyParentId(node.session));
    if (!parent || parent === node || (parent.session.cwd || '~') !== (node.session.cwd || '~')) continue;
    // Follow the declared chain before attaching so malformed A→B→A hints
    // cannot remove both nodes from the root set or recurse forever.
    let cursor = parent;
    const seen = new Set();
    let cyclic = false;
    while (cursor && !seen.has(cursor)) {
      if (cursor === node) { cyclic = true; break; }
      seen.add(cursor);
      const next = nodes.get(sessionFamilyParentId(cursor.session));
      cursor = next && (next.session.cwd || '~') === (cursor.session.cwd || '~') ? next : null;
    }
    if (cyclic) continue;
    parent.children.push(node);
    attached.add(node.session.id);
  }

  const activityMs = (session) => {
    const value = new Date(session.lastActivity || 0).getTime();
    return Number.isFinite(value) ? value : 0;
  };
  const finalize = (node) => {
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
  const roots = [...nodes.values()].filter(node => !attached.has(node.session.id)).map(finalize);
  return roots.sort((a, b) => b.activity - a.activity || a.order - b.order);
}

function flattenSessionFamilies(families, out = []) {
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
function partitionPinnedFamilies(families, pinnedKeys) {
  if (!pinnedKeys?.length) return [[], families || []];
  const rootByMember = new Map();
  const index = (node, root) => {
    rootByMember.set(sessionRefKey(node.session), root);
    for (const child of node.children) index(child, root);
  };
  for (const root of families || []) index(root, root);
  // In a partial view (notably Active), an inactive parent may be absent while
  // its active children remain. Let the missing parent id alias those visible
  // root fragments; when the parent is present, normal same-cwd grouping wins.
  const rootsByMissingParent = new Map();
  for (const root of families || []) {
    const parentId = sessionFamilyParentId(root.session);
    if (!parentId) continue;
    const parentKey = sessionKey(root.session.host, parentId);
    if (rootByMember.has(parentKey)) continue;
    if (!rootsByMissingParent.has(parentKey)) rootsByMissingParent.set(parentKey, []);
    rootsByMissingParent.get(parentKey).push(root);
  }
  const pinned = [];
  const pinnedRoots = new Set();
  for (const id of pinnedKeys) {
    const matches = rootByMember.has(id)
      ? [rootByMember.get(id)] : (rootsByMissingParent.get(id) || []);
    for (const root of matches) {
      if (pinnedRoots.has(root.session.id)) continue;
      pinned.push(root);
      pinnedRoots.add(root.session.id);
    }
  }
  return [pinned, (families || []).filter(root => !pinnedRoots.has(root.session.id))];
}

/**
 * Split sessions into [pinned, rest]. Pinned sessions come back in
 * `pinnedIds` order (the user's manual arrangement); ids with no matching
 * session are skipped.
 */
function partitionPinned(list, pinnedIds) {
  if (!pinnedIds || pinnedIds.length === 0) return [[], list];
  const byId = new Map(list.map(s => [s.id, s]));
  const pinned = pinnedIds.map(id => byId.get(id)).filter(Boolean);
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
//   since:7d since:2026-07-01 before:...   lastActivity bounds (h/d/w or ISO)
//
// Unknown prefixes stay literal text ("subagent: fix" searches for the colon
// form), so the grammar never eats a query that wasn't meant for it.
// =========================================================================

// Related-session chips use a stable kind order for the modal and for the
// header's candidate list. Singular lineage links (parent, startedFrom) sort
// before the potentially long child lists; children keep the server's order
// within a kind.
const RELATION_KIND_ORDER = { parent: 0, startedFrom: 1, child: 2, startedHere: 3 };
const RELATION_CHILD_KINDS = new Set(['child', 'startedHere']);

function relationKindRank(kind) {
  const rank = RELATION_KIND_ORDER[kind];
  return rank === undefined ? 99 : rank;
}

function sortRelations(relations) {
  return (relations || [])
    .map((relation, index) => ({ relation, index }))
    .sort((a, b) => (relationKindRank(a.relation && a.relation.kind) - relationKindRank(b.relation && b.relation.kind)) || (a.index - b.index))
    .map(({ relation }) => relation);
}

function isChildRelation(relation) {
  return RELATION_CHILD_KINDS.has(relation && relation.kind);
}

/** Group relations by kind for the overflow modal, groups in rank order. */
function groupRelations(relations) {
  const groups = [];
  const byKind = new Map();
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

// `host` is the one client-evaluated field: hosts are a client concept (the
// client is the aggregator), so a server's own sessions carry neither
// hostLabel nor host. Clients strip host terms with stripQueryField() before
// querying any server and re-apply them locally.
const QUERY_FIELDS = new Set(['name', 'cwd', 'model', 'id', 'is', 'host']);

/** "7d"/"12h"/"2w" → ms span; ISO "YYYY-MM-DD" → ms epoch (local midnight); null otherwise. */
function parseQueryDate(value, now) {
  const rel = /^(\d+)([hdw])$/.exec(value);
  if (rel) {
    const ms = Number(rel[1]) * { h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[rel[2]];
    return now - ms;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const year = Number(iso[1]), month = Number(iso[2]), day = Number(iso[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const maxDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (!maxDay || day < 1 || day > maxDay) return null;
    const t = new Date(value + 'T00:00:00').getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// Tokens are non-space runs, but a double-quoted span (optionally after a
// -/field: prefix) keeps its spaces: -name:"two words", "two words". One
// builder, so the parser and stripQueryField can never tokenize differently.
function queryTokenRe() { return /(-?)([a-zA-Z]+:)?("([^"]*)"|\S+)/g; }

/**
 * The query minus every `field:`/`-field:` token (quoted values included),
 * whitespace normalized. Used to drop client-only terms — `host:` — from a
 * query before it reaches a server, which would match them against nothing
 * and so filter everything out.
 */
function stripQueryField(query, field) {
  if (!query) return '';
  const want = String(field || '').toLowerCase();
  const tokenRe = queryTokenRe();
  const kept = [];
  let m;
  while ((m = tokenRe.exec(query)) !== null) {
    const prefix = m[2] ? m[2].slice(0, -1).toLowerCase() : null;
    if (prefix !== want) kept.push(m[0]);
  }
  return kept.join(' ');
}

/**
 * Parse a filter query → { terms: [{ neg, field, value }], since, before }.
 * `since`/`before` are ms epochs (null when absent); multiple occurrences
 * AND (max since, min before). Values are lowercased. `now` is injectable
 * for tests. A malformed since:/before: value falls back to a literal term.
 */
function parseSessionQuery(query, now = Date.now()) {
  const parsed = { terms: [], since: null, before: null };
  if (!query) return parsed;
  const tokenRe = queryTokenRe();
  let m;
  while ((m = tokenRe.exec(query)) !== null) {
    const neg = m[1] === '-';
    const rawPrefix = m[2] ? m[2].slice(0, -1).toLowerCase() : null;
    const value = (m[4] !== undefined ? m[4] : m[3]).toLowerCase();
    if (!neg && (rawPrefix === 'since' || rawPrefix === 'before')) {
      const t = parseQueryDate(value, now);
      if (t !== null) {
        if (rawPrefix === 'since') parsed.since = Math.max(parsed.since ?? -Infinity, t);
        else parsed.before = Math.min(parsed.before ?? Infinity, t);
        continue;
      }
    }
    if (rawPrefix && QUERY_FIELDS.has(rawPrefix)) {
      if (value) parsed.terms.push({ neg, field: rawPrefix, value });
      continue;
    }
    // Unknown prefix (or date that didn't parse): the whole token is text.
    const literal = ((rawPrefix ? rawPrefix + ':' : '') + value);
    if (literal) parsed.terms.push({ neg, field: null, value: literal });
  }
  return parsed;
}

/** The positive plain-text terms of a parsed query — what content search and
 * snippet highlighting act on (field terms and negations never touch content). */
function positiveQueryTokens(parsed) {
  return parsed.terms.filter(t => !t.neg && !t.field).map(t => t.value);
}

/**
 * Evaluate a parsed query against a session. `contentText` (lowercased
 * message text) widens *positive plain* terms only: negations stay
 * metadata-only by design — excluding a session because its transcript
 * mentions a word would make `-subagent` hide half the corpus.
 */
function evaluateSessionQuery(parsed, session, contentText) {
  if (parsed.since !== null || parsed.before !== null) {
    const t = new Date(session.lastActivity || 0).getTime();
    if (parsed.since !== null && !(t >= parsed.since)) return false;
    if (parsed.before !== null && !(t < parsed.before)) return false;
  }
  const meta = sessionMetaText(session);
  for (const term of parsed.terms) {
    let hit;
    if (term.field === 'host') {
      // Client-only: the host's display label, falling back to its id. A
      // server's sessions carry neither, so a positive host: term matches
      // nothing there — which is exactly why clients strip these first.
      hit = String(session.hostLabel || session.host || '').toLowerCase().includes(term.value);
    } else if (term.field === 'is') {
      // Not a substring field: is:active tests liveness (anything else
      // simply never matches, so a typo can't silently mean "everything").
      hit = term.value === 'active' && !!session.isActive;
    } else {
      const hay = term.field ? String(session[term.field] || '').toLowerCase() : meta;
      hit = hay.includes(term.value);
      if (!hit && !term.neg && !term.field && contentText) hit = contentText.includes(term.value);
    }
    if (hit === term.neg) return false;
  }
  return true;
}

/** Non-overlapping occurrences of `token` in `text` (both lowercased). An
 * indexOf walk, not a regex: tokens are arbitrary user text. */
function countOccurrences(text, token) {
  if (!text || !token) return 0;
  let n = 0, i = text.indexOf(token);
  while (i !== -1) { n++; i = text.indexOf(token, i + token.length); }
  return n;
}

/**
 * Relevance score for a session against a parsed query — the shared ranking
 * used by the sidebar filter, `/api/sessions?q=` and `/api/search`.
 *
 * The philosophy is *coverage beats repetition*: every positive plain token
 * contributes independently, so a session hitting two distinct keywords
 * outranks one that says a single keyword fifty times. Metadata carries the
 * most signal (a name hit is what you meant; cwd/model/id is nearly as
 * deliberate), and the content contribution grows logarithmically from a
 * single hit and caps out — a transcript can't shout its way to the top.
 *
 * Only positive plain terms score: field terms, negations and since/before
 * are filters, so a purely field/date query scores 0 everywhere and the
 * caller's recency tiebreak stands. `contentText` is the (already lowercased)
 * indexed search text, optional.
 */
function scoreSessionMatch(parsed, session, contentText) {
  const tokens = positiveQueryTokens(parsed);
  if (!tokens.length) return 0;
  const name = String(session.name || '').toLowerCase();
  const other = [session.cwd, session.model, session.id].join(' ').toLowerCase();
  let total = 0;
  for (const token of tokens) {
    if (name.includes(token)) total += 100;
    if (other.includes(token)) total += 30;
    const n = countOccurrences(contentText, token);
    if (n > 0) total += 20 + Math.min(30, Math.round(8 * Math.log2(n)));
  }
  return Math.round(total);
}

/** Filter sessions locally (metadata + dates only — no content on this path),
 * relevance-ordered when the query has content-bearing tokens. */
function applyLocalFilter(list, query) {
  if (!query) return list;
  const parsed = parseSessionQuery(query);
  const out = list.filter(s => evaluateSessionQuery(parsed, s));
  if (!positiveQueryTokens(parsed).length) return out;
  return out
    .map(s => [s, scoreSessionMatch(parsed, s)])
    .sort((a, b) => b[1] - a[1] || new Date(b[0].lastActivity || 0) - new Date(a[0].lastActivity || 0))
    .map(([s]) => s);
}

/**
 * Narrow a list by a query's `host:` terms alone — the client-side half of a
 * query whose every other term a server already applied (host terms never
 * reach one). Returns the list untouched when the query names no host.
 */
function applyHostTerms(list, query) {
  if (!query) return list;
  const terms = parseSessionQuery(query).terms.filter(t => t.field === 'host');
  if (!terms.length) return list;
  const parsed = { terms, since: null, before: null };
  return list.filter(s => evaluateSessionQuery(parsed, s));
}

/** Simple fuzzy match: all chars of query appear in order in str; returns match indices or null */
function fuzzyMatch(query, str) {
  query = query.toLowerCase();
  str = str.toLowerCase();
  let qi = 0;
  const indices = [];
  for (let si = 0; si < str.length && qi < query.length; si++) {
    if (str[si] === query[qi]) { indices.push(si); qi++; }
  }
  return qi === query.length ? indices : null;
}

/** Score fuzzy match — prefer consecutive chars, earlier matches, shorter strings */
function fuzzyScore(indices, str) {
  if (!indices) return -Infinity;
  let score = 0;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i - 1] + 1) score += 10; // consecutive bonus
  }
  score -= indices[0]; // earlier match = better
  score -= str.length * 0.1; // shorter = better
  return score;
}

function highlightFuzzy(str, indices) {
  if (!indices || !indices.length) return escapeHtml(str);
  let result = '';
  let last = 0;
  for (const idx of indices) {
    result += escapeHtml(str.slice(last, idx));
    result += `<span class="cwd-match">${escapeHtml(str[idx])}</span>`;
    last = idx + 1;
  }
  result += escapeHtml(str.slice(last));
  return result;
}

// =========================================================================
// Hosts (TASKS/multi-host.md) — one client may aggregate several pi-dish
// hosts. Wire ids stay host-local; namespacing happens only in client keys.
// =========================================================================

/**
 * Composite client key for a session. A session id is unique only within its
 * host (generic session.jsonl header ids collide across machines), so every
 * client-side map/list/localStorage key that names a session uses this form.
 * A falsy host id yields the bare session id — the pre-multi-host shape,
 * which is what the client still speaks before GET /api/host has answered
 * and on servers too old to serve it.
 */
function sessionKey(hostId, sessionId) {
  const id = sessionId == null ? '' : String(sessionId);
  return hostId ? `${hostId} ${id}` : id;
}

/** Inverse of sessionKey; a key with no separator is a bare (host-less) id. */
function parseSessionKey(key) {
  const raw = key == null ? '' : String(key);
  const sep = raw.indexOf(' ');
  if (sep < 0) return { hostId: null, sessionId: raw };
  return { hostId: raw.slice(0, sep), sessionId: raw.slice(sep + 1) };
}

/** Composite key of a session object in client state (writers stamp `host`). */
function sessionRefKey(session) {
  return sessionKey(session && session.host, session && session.id);
}

/**
 * Normalize a catalog host base to something that can simply be prefixed to
 * an "/api/..." path: an http(s) origin (plus optional path prefix, which is
 * what the hub proxy's /hosts/<name> entries look like) with no trailing
 * slash. '' is the self host and stays ''. Anything that isn't explicitly
 * one of those forms is garbage and returns null rather than being guessed
 * at — a mistyped base must fail loudly at add time, not silently resolve
 * against the serving origin.
 */
function normalizeHostBase(input) {
  if (input == null) return '';
  const raw = String(input).trim();
  if (!raw) return '';
  if (/\s/.test(raw)) return null;
  const segmentsOk = (path) => path.split('/').filter(Boolean)
    .every(seg => seg !== '.' && seg !== '..' && /^[\w.~%\-]+$/.test(seg));
  if (raw.startsWith('/')) {
    if (!segmentsOk(raw)) return null;
    return raw.replace(/\/+$/, '');
  }
  if (!/^https?:\/\//i.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!url.hostname) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (!segmentsOk(path)) return null;
  return url.origin + path;
}

/**
 * Validate the localStorage host catalog. Broken entries are dropped, never
 * thrown on: a corrupt catalog must degrade to "fewer hosts", not a client
 * that won't boot. The self host is implicit (base ''), so entries without a
 * reachable base are dropped too.
 */
function sanitizeHostCatalog(raw) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    let base;
    try { base = normalizeHostBase(item.base); } catch { continue; }
    if (!base) continue;
    const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const hostId = str(item.hostId);
    const dedupe = hostId || base;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const entry = { base };
    if (hostId) entry.hostId = hostId;
    const label = str(item.label);
    if (label) entry.label = label;
    const token = str(item.token);
    if (token) entry.token = token;
    out.push(entry);
  }
  return out;
}

/**
 * Human label for a host entry: the server's own label if it gave one, else
 * the fleet name, else the bare authority of its base. The self host has no
 * base, so it says so rather than rendering an empty chip.
 */
function hostDisplayLabel(host) {
  if (!host) return '';
  if (host.label) return String(host.label);
  if (host.name) return String(host.name);
  if (!host.base) return 'this host';
  return String(host.base).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * The shortest id prefix of at least `minLen` characters that no peer id
 * shares, falling back to the whole id. A blind 8-character slice is fine
 * for a uuid and useless for a timestamp corpus, where three sessions
 * started the same day all begin `2026-08-`; the owning server rejects an
 * ambiguous prefix, so a ref built without looking at the corpus can simply
 * fail to resolve. Every caller that *has* the corpus should widen with it.
 */
function uniqueSessionPrefix(id, peerIds, minLen = 8) {
  const self = String(id == null ? '' : id);
  if (!self) return '';
  const peers = (peerIds || []).filter((peer) => peer && peer !== self);
  for (let len = Math.min(minLen, self.length); len < self.length; len++) {
    const candidate = self.slice(0, len);
    if (!peers.some((peer) => String(peer).startsWith(candidate))) return candidate;
  }
  return self;
}

/**
 * The pasteable handle for a session — what the sidebar's "Copy session ref"
 * and the stats modal put on the clipboard, and what an agent CLI takes back.
 * Three forms, ordered by what the reader on the other end can resolve:
 *
 *   `2026-07-0`           a session on this host (an id prefix the server resolves)
 *   `tycho/2026-07-0`     a session on a host the fleet map names
 *   `<hostId>:<full id>`  a host known only by identity (added by URL, unnamed)
 *
 * The bare prefix stays the single-host form, so a fleet-less pi-dish never
 * shows fleet syntax at all. An unnamed host can't be addressed by name, so
 * it falls back to its uuid — paired with the *full* id, because a prefix is
 * only safe where something can expand it, and nothing here can speak for a
 * corpus this client merely proxies to.
 *
 * `prefix` overrides the default 8-character slice; pass one from
 * `uniqueSessionPrefix` wherever the same-host sessions are known.
 */
function sessionRef(session, host, prefix) {
  const id = typeof session === 'string' ? session : (session && session.id) || '';
  if (typeof id !== 'string' || !id) return '';
  const short = typeof prefix === 'string' && prefix ? prefix : id.slice(0, 8);
  if (!host || typeof host !== 'object') return short;
  if (host.self === true || host.base === '') return short;
  if (host.name) return `${host.name}/${short}`;
  if (host.hostId) return `${host.hostId}:${id}`;
  return short;
}

// =========================================================================
// `#ref` session mentions
//
// A ref is only a string, and a model reading "8f3ab2c1" in a prompt has no
// reason to believe it addresses anything. Two halves fix that: the
// composer's `#` picker inserts exactly the ref `sessionRef` produces, and
// the send routes append one `<session-refs>` block naming what each token
// points at and which verbs act on it. The block is what makes the handle
// legible — the skill catalog in the system prompt describes the CLI but
// never says "this token in front of you is a live session".
//
// The block is *appended*, never substituted: the user's own text keeps the
// short `#ref` they typed, and the UI hides the block behind chips
// (splitSessionRefContext). Everything that compares a sent prompt against
// its echo has to strip it first — see consumePendingSelfEcho in app.js.
// =========================================================================

/** A `#ref` in prompt text. The ref charset is the docs/agent/refs.md
 *  grammar (`8f3ab2c1`, `tycho/8f3ab2c1`, `<hostId>:<fullId>`); the 4-char
 *  minimum is the server's shortest resolvable prefix, which also keeps
 *  `#1`-style tokens out. A markdown heading can't match (a space is not in
 *  the charset, and `##` fails the leading alphanumeric), and neither can a
 *  `#` glued to a word — the leading boundary is required. Backticks are
 *  deliberately not boundaries, so a ref quoted as code stays inert. */
const SESSION_REF_TOKEN_RE = /(?:^|[\s(\[{<"'])#([A-Za-z0-9][A-Za-z0-9._:/-]{3,})/g;

/** Distinct `#ref` tokens, in order of first appearance. */
function parseSessionRefTokens(text) {
  const out = [];
  if (!text) return out;
  const seen = new Set();
  SESSION_REF_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = SESSION_REF_TOKEN_RE.exec(String(text))) !== null) {
    // Only '.' and ':' can end a ref by accident — a full stop after the
    // token, or a stray separator. '-' and '_' are never punctuation here:
    // an 8-char prefix of a timestamp id really is "2026-08-", and trimming
    // it would silently rewrite the ref the picker wrote.
    const ref = match[1].replace(/[.:/]+$/, '');
    if (ref.length < 4 || seen.has(ref)) continue;
    seen.add(ref);
    out.push({ token: '#' + ref, ref });
  }
  return out;
}

const SESSION_REF_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Split a ref into host part and session part — the pure half of the CLI's
 * parser (skills/lib/pi-dish-client.js `parseRef`), same three forms and the
 * same return shape. `hostIdForm` marks the machine-produced
 * `<hostId>:<fullId>`, whose id is whole and must never prefix-match: a
 * partial expansion could retarget a recorded ref at a different session.
 */
function parseSessionRefParts(raw) {
  const ref = String(raw == null ? '' : raw).trim();
  if (!ref) return null;
  const slash = ref.indexOf('/');
  if (slash !== -1) {
    const hostPart = ref.slice(0, slash);
    const id = ref.slice(slash + 1);
    return hostPart && id ? { hostPart, hostIdForm: false, id } : null;
  }
  const colon = ref.indexOf(':');
  if (colon > 0) {
    const head = ref.slice(0, colon);
    const rest = ref.slice(colon + 1);
    if (SESSION_REF_UUID_RE.test(head) && rest) return { hostPart: head, hostIdForm: true, id: rest };
  }
  return { hostPart: null, hostIdForm: false, id: ref };
}

const SESSION_REF_BLOCK_RE = /\n*<session-refs>\n([\s\S]*?)\n<\/session-refs>[ \t]*$/;

// Names the thing and the verbs. Deliberately not the skill body: repeating
// ~1.5KB of SKILL.md on every prompt buys nothing the catalog entry and these
// four lines don't already give, and it would repeat per message.
const SESSION_REF_PREAMBLE = [
  'The message above references other pi-dish sessions by `#ref`. Each is a real',
  'peer session, not a label: use the pi-dish-sessions skill CLI to read its',
  'transcript (`read <ref>`) or to message it (`send` / `steer` / `follow-up`',
  '<ref>). Never guess what a referenced session holds — read it.',
].join('\n');

/** One `key=value | ...` field. The separators and the angle brackets that
 *  delimit the block are the only characters a value may not carry. */
function sessionRefField(value) {
  return String(value == null ? '' : value).replace(/[\r\n|<>]+/g, ' ').trim().slice(0, 200);
}

/** The `<session-refs>` block for resolved entries, '' when none resolved. */
function formatSessionRefContext(entries) {
  const rows = [];
  for (const entry of entries || []) {
    const ref = sessionRefField(entry && entry.ref);
    if (!ref) continue;
    const fields = [`ref=${ref}`];
    const name = sessionRefField(entry.name);
    if (name) fields.push(`name=${name}`);
    const host = sessionRefField(entry.host);
    if (host) fields.push(`host=${host}`);
    if (entry.isActive != null) fields.push(`active=${entry.isActive ? 'yes' : 'no'}`);
    const cwd = sessionRefField(entry.cwd);
    if (cwd) fields.push(`cwd=${cwd}`);
    rows.push('- ' + fields.join(' | '));
  }
  if (!rows.length) return '';
  return `<session-refs>\n${SESSION_REF_PREAMBLE}\n${rows.join('\n')}\n</session-refs>`;
}

/** Prompt text plus its ref block. Unresolvable tokens contribute nothing —
 *  a `#ref` that names no session is left as the prose it probably was. */
function appendSessionRefContext(text, entries) {
  const body = String(text == null ? '' : text);
  const block = formatSessionRefContext(entries);
  if (!block) return body;
  return body ? `${body}\n\n${block}` : block;
}

/** Inverse of appendSessionRefContext: the text as typed plus the parsed
 *  entries, for rendering chips and for comparing a prompt to its echo. */
function splitSessionRefContext(text) {
  const body = String(text == null ? '' : text);
  const match = body.match(SESSION_REF_BLOCK_RE);
  if (!match) return { text: body, refs: [] };
  const refs = [];
  for (const line of match[1].split('\n')) {
    if (!line.startsWith('- ref=')) continue;
    const entry = {};
    for (const field of line.slice(2).split(' | ')) {
      const eq = field.indexOf('=');
      if (eq > 0) entry[field.slice(0, eq)] = field.slice(eq + 1);
    }
    if (!entry.ref) continue;
    refs.push({
      ref: entry.ref,
      name: entry.name || '',
      host: entry.host || '',
      cwd: entry.cwd || '',
      isActive: entry.active === 'yes',
    });
  }
  return { text: body.slice(0, match.index).replace(/\s+$/, ''), refs };
}

/**
 * Rank sessions for the composer's `#` picker: a fuzzy subsequence match on
 * the name (what a human remembers), falling back to cwd and then to an id
 * prefix so a pasted ref finds its own session. Live sessions outrank
 * historical ones at equal score — a ref is usually aimed at something
 * running — and recency breaks the rest. An empty query is "most recent".
 */
function searchSessionsForRef(list, query, limit = 8) {
  const q = String(query == null ? '' : query).trim();
  const lower = q.toLowerCase();
  const rows = [];
  for (const session of list || []) {
    if (!session || !session.id) continue;
    let score = 0;
    let indices = null;
    if (q) {
      const name = String(session.name || '');
      indices = fuzzyMatch(q, name);
      if (indices) {
        score = 1000 + fuzzyScore(indices, name);
      } else {
        const cwd = String(session.cwd || '');
        const cwdIndices = fuzzyMatch(q, cwd);
        if (cwdIndices) score = 500 + fuzzyScore(cwdIndices, cwd);
        else if (String(session.id).toLowerCase().startsWith(lower)) score = 250;
        else continue;
      }
    }
    rows.push({ session, score, indices });
  }
  rows.sort((a, b) => b.score - a.score
    || (b.session.isActive ? 1 : 0) - (a.session.isActive ? 1 : 0)
    || new Date(b.session.lastActivity || 0) - new Date(a.session.lastActivity || 0));
  return rows.slice(0, Math.max(0, limit));
}

/**
 * The effective host list: self, then the fleet entries a host advertises
 * over GET /api/hosts (runtime only - never persisted), then the catalog of
 * directly-added hosts from localStorage. Identity is `hostId` when known
 * and the base otherwise, so the same host reached two ways (as a fleet
 * remote and as a directly-added URL) is one row.
 *
 * First source wins on conflict - a host reached through the fleet proxy is
 * same-origin, which is the connection least likely to be blocked - but a
 * later duplicate still contributes fields the winner lacks (most usefully
 * a user-entered token and label).
 */
function mergeHostEntries(self, fleet, catalog) {
  const out = [];
  const byId = new Map();
  const byBase = new Map();
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  const absorb = (into, extra) => {
    for (const key of ['label', 'name', 'token', 'version', 'capabilities', 'kind', 'error']) {
      if (into[key] == null && extra[key] != null) into[key] = extra[key];
    }
    return into;
  };

  const push = (entry) => {
    if (!entry) return;
    const hostId = str(entry.hostId);
    const base = typeof entry.base === 'string' ? entry.base : null;
    if (base == null) return;
    const existing = (hostId && byId.get(hostId)) || byBase.get(base);
    if (existing) { absorb(existing, entry); return; }
    const merged = { ...entry, base, hostId: hostId || null, key: hostId || base || 'self' };
    if (hostId) byId.set(hostId, merged);
    byBase.set(base, merged);
    out.push(merged);
  };

  push({
    hostId: self && self.hostId ? self.hostId : null,
    base: '',
    label: (self && self.label) || null,
    version: (self && self.version) || null,
    capabilities: (self && self.capabilities) || null,
    source: 'self',
    self: true,
    reachable: true,
  });
  for (const entry of Array.isArray(fleet) ? fleet : []) {
    if (!entry || typeof entry !== 'object' || entry.self) continue;
    let base;
    try { base = normalizeHostBase(entry.base); } catch { continue; }
    if (base == null) continue;
    push({
      hostId: str(entry.hostId), base, label: str(entry.label), name: str(entry.name),
      kind: str(entry.kind), version: entry.version || null,
      capabilities: entry.capabilities || null,
      reachable: entry.reachable !== false, error: str(entry.error),
      source: 'fleet',
    });
  }
  for (const entry of sanitizeHostCatalog(catalog)) push({ ...entry, source: 'user' });
  return out;
}

/**
 * Per-host feature gating. `capabilities` is the host's own advertisement
 * (GET /api/host) and absent means unsupported: an advertised set that omits
 * a feature hides the affordance rather than letting it die on connect.
 * A host that advertised nothing at all (older build, or /api/host hasn't
 * answered yet) is only trusted to the local /api/config when it is *this*
 * host — a remote of unknown build stays hidden, because a dead button is
 * worse than a missing one.
 */
function hostSupportsCapability(hostEntry, capability, config) {
  const caps = hostEntry && hostEntry.capabilities;
  if (caps && typeof caps === 'object') return caps[capability] === true;
  const isSelf = !!hostEntry && (hostEntry.self === true || hostEntry.base === '');
  return isSelf ? !!(config && config[capability]) : false;
}

/**
 * Terminal gating for the host that owns the session on screen — the entry
 * host's own PI_DISH_TERMINAL says nothing about a peer's.
 */
function hostSupportsTerminal(hostEntry, config) {
  return hostSupportsCapability(hostEntry, 'terminal', config);
}

// --- Host connection state (fan-out backoff) -----------------------------
// One host's connection state is a small state machine the fan-out reads
// before it spends a request: `reachable | backoff | blocked`. It lives here,
// pure, because it is the piece worth testing - app.js only maps events onto
// it and decides when the change is worth a re-render.

// t3code's ladder: a transient failure retries soon and settles at 16s. Auth
// failures never land here - they park in `blocked`.
const HOST_BACKOFF_LADDER = [3000, 4000, 8000, 16000];
// How long a host must stay reachable before its ladder position is forgiven.
// Without the hysteresis a host that flaps (answers one poll, hangs the next)
// resets to the first rung every cycle and is retried at 3s forever.
const HOST_BACKOFF_RESET_MS = 30000;

/**
 * Next connection state for one host. `prev` is its current record (null when
 * nothing is known), `event` is `'success'`, `'blocked'`, `{type:'failure',
 * error}` or `{type:'seed-down', error}`, and `now` is injected so the
 * hysteresis is testable. Returns `prev` itself when the event changes
 * nothing, so callers can skip work by identity.
 *
 * - failure climbs the ladder and never demotes `blocked` (a 401 is not
 *   transient: retrying it burns requests until a token is entered).
 * - success is only *fully* trusted after HOST_BACKOFF_RESET_MS of unbroken
 *   reachability; before that the host is reachable but keeps its rung, so a
 *   host that flaps keeps climbing instead of resetting every cycle.
 * - seed-down is the serving host's own probe result (a fleet entry with
 *   `reachable:false`) and applies only to a host this client has not
 *   observed itself, so a real observation is never overwritten.
 */
function hostConnReduce(prev, event, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const kind = typeof event === 'string' ? event : (event && event.type) || '';
  const state = prev && typeof prev === 'object' ? prev : null;
  const errText = (value) => {
    if (value == null) return null;
    const text = String((typeof value === 'object' && value.message) || value);
    return text || null;
  };
  const eventError = event && typeof event === 'object' ? errText(event.error) : null;

  if (kind === 'blocked') {
    if (state && state.state === 'blocked') return state;
    return { state: 'blocked', failures: 0, retryAt: 0, error: 'Unauthorized', reachableSince: 0 };
  }
  if (kind === 'success') {
    const since = state && state.state === 'reachable' && state.reachableSince ? state.reachableSince : at;
    const forgiven = at - since >= HOST_BACKOFF_RESET_MS;
    return {
      state: 'reachable',
      failures: forgiven ? 0 : (state && state.failures) || 0,
      retryAt: 0,
      error: null,
      reachableSince: since,
    };
  }
  if (kind === 'failure') {
    if (state && state.state === 'blocked') return state;
    const failures = ((state && state.failures) || 0) + 1;
    const wait = HOST_BACKOFF_LADDER[Math.min(failures - 1, HOST_BACKOFF_LADDER.length - 1)];
    return { state: 'backoff', failures, retryAt: at + wait, error: eventError, reachableSince: 0 };
  }
  if (kind === 'seed-down') {
    if (state) return state;
    return { state: 'backoff', failures: 1, retryAt: at + HOST_BACKOFF_LADDER[0], error: eventError, reachableSince: 0 };
  }
  return state;
}

// --- Host color coding (sidebar sections + chips) -------------------------
// A fleet is a handful of machines, and "which host is this?" is a question
// the eye should answer before the label is read - so hosts are color-coded.
// Auto colors are the theme's chart slots (tokens, so they follow the theme;
// the Theme section's no-raw-palette rule) assigned by first-seen order and
// never reshuffled; a user override is a concrete hex, which is user data and
// stored verbatim. None of this renders on a single host.

const HOST_COLOR_SLOTS = 5;

/** Keep only well-formed `#rrggbb` overrides - a corrupt map degrades to auto. */
function sanitizeHostColors(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!key || typeof value !== 'string') continue;
    if (/^#[0-9a-fA-F]{6}$/.test(value)) out[key] = value.toLowerCase();
  }
  return out;
}

/** The persisted first-seen order: a deduped list of host keys. */
function sanitizeHostColorOrder(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Resolve one host's color. An override wins outright; otherwise the host
 * takes the chart slot its position in `order` names, appending itself on
 * first sight. Returns the (possibly extended) order rather than mutating it,
 * plus `appended` so the caller knows when the order is worth persisting.
 */
function assignHostColor(order, key, overrides) {
  const list = sanitizeHostColorOrder(order);
  const map = sanitizeHostColors(overrides);
  let index = list.indexOf(key);
  const appended = !!key && index < 0;
  if (appended) { list.push(key); index = list.length - 1; }
  const auto = index < 0 ? 'var(--text-muted)' : `var(--chart-${(index % HOST_COLOR_SLOTS) + 1})`;
  return { color: map[key] || auto, order: list, index, appended, custom: !!map[key] };
}

/**
 * Order for the sidebar's host sections: this host first, then by display
 * label. Deliberately not by recency - a heading that jumps around whenever
 * another machine speaks is worse than a stale-looking one.
 */
function sortHostSections(hosts) {
  return (Array.isArray(hosts) ? [...hosts] : []).sort((a, b) => {
    if (!!a.self !== !!b.self) return a.self ? -1 : 1;
    const byLabel = hostDisplayLabel(a).localeCompare(hostDisplayLabel(b), undefined, { sensitivity: 'base' });
    if (byLabel) return byLabel;
    return String(a.hostId || a.base || '').localeCompare(String(b.hostId || b.base || ''));
  });
}

/** Collapse-store key for a host section (namespaced like `date:` buckets). */
function hostSectionKey(hostKey) { return 'host:' + (hostKey || 'self'); }

/**
 * `rgb(1, 2, 3)` / `rgba(...)` -> `#010203`. `<input type="color">` needs a
 * concrete hex, and a computed `var(--chart-N)` only ever comes back as rgb.
 */
function rgbStringToHex(value) {
  if (typeof value !== 'string') return null;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value.trim());
  if (!m) return null;
  const part = (n) => {
    const v = Math.max(0, Math.min(255, Math.round(Number(n))));
    return v.toString(16).padStart(2, '0');
  };
  return '#' + part(m[1]) + part(m[2]) + part(m[3]);
}

// --- Usage summary merging (multi-host) ----------------------------------
// The usage view fans /api/usage-summary out to every reachable host and
// merges the payloads here. Costs retain the known subtotal while
// costUnavailable counts the calls omitted from it; the renderer marks those
// partial estimates instead of presenting them as complete or free.

const USAGE_MERGE_COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
const USAGE_MERGE_TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];

/**
 * Coalesce a burst of healthy fan-out responses into one complete render.
 * If a peer is genuinely slow, the delayed call still publishes the useful
 * partial result; the final settlement always renders synchronously.
 */
function createFanoutRenderQueue(states, render, delayMs = 100) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    if (states.every(state => state !== 'pending')) render();
    else timer = setTimeout(render, delayMs);
  };
}

function emptyMergedUsage() {
  return {
    tokens: Object.fromEntries(USAGE_MERGE_TOKEN_KEYS.map(k => [k, 0])),
    costs: Object.fromEntries(USAGE_MERGE_COST_KEYS.map(k => [k, 0])),
    costUnavailable: Object.fromEntries(USAGE_MERGE_COST_KEYS.map(k => [k, 0])),
    calls: 0, measured: 0, durationMs: 0, slowestMs: 0,
  };
}

function addMergedUsage(to, from) {
  if (!from) return to;
  for (const k of USAGE_MERGE_TOKEN_KEYS) to.tokens[k] += from.tokens?.[k] || 0;
  for (const k of USAGE_MERGE_COST_KEYS) {
    to.costUnavailable[k] += from.costUnavailable?.[k] || 0;
    const value = from.costs?.[k];
    if (Number.isFinite(value)) {
      to.costs[k] = (Number.isFinite(to.costs[k]) ? to.costs[k] : 0) + value;
    }
  }
  for (const k of ['calls', 'measured', 'durationMs']) to[k] += from[k] || 0;
  to.slowestMs = Math.max(to.slowestMs, from.slowestMs || 0);
  return to;
}

function pricedUsageFields(bucket) {
  bucket.unpricedCalls = bucket.costUnavailable?.total || 0;
  bucket.priced = !bucket.unpricedCalls;
  return bucket;
}

function usageDisplayTokens(tokens) {
  return (tokens?.input || 0) + (tokens?.output || 0) + (tokens?.cacheRead || 0) + (tokens?.cacheWrite || 0);
}

/** The server's group comparator, so a merged list ranks like a local one. */
function compareUsageBuckets(a, b, sort) {
  if (sort === 'tokens') return usageDisplayTokens(b.tokens) - usageDisplayTokens(a.tokens) || b.calls - a.calls;
  const aKnown = Number.isFinite(a.costs?.total), bKnown = Number.isFinite(b.costs?.total);
  if (aKnown !== bKnown) return Number(bKnown) - Number(aKnown);
  return (bKnown ? b.costs.total - a.costs.total : 0) || b.calls - a.calls;
}

/**
 * Merge per-host /api/usage-summary payloads into one view.
 *
 * `list` items are either a bare payload or `{ hostId, hostLabel, summary }`
 * - the host is needed because a workspace path and a session id are only
 * unique *within* a host, while a model ref means the same thing everywhere
 * and so merges across hosts.
 *
 * A single payload passes through untouched, which is what keeps the
 * single-host view exactly what the server sent.
 *
 * Approximation, deliberately accepted: each host truncates its group lists
 * to its own top 20 before answering, so a workspace/model/session sitting
 * just below the cut on several hosts can be under-counted (or missing) in
 * the merged tail. Totals, headline KPIs, and the daily series are exact -
 * they are whole-corpus aggregates on each host. Don't "fix" this with a
 * hub-side merged endpoint; see TASKS/multi-host.md.
 */
function mergeUsageSummaries(list) {
  const entries = (Array.isArray(list) ? list : [])
    .map(item => (item && typeof item === 'object' && item.summary ? item : { summary: item }))
    .filter(item => item.summary && typeof item.summary === 'object');
  if (!entries.length) return null;
  if (entries.length === 1) return entries[0].summary;

  const first = entries[0].summary;
  const sort = first.sort === 'tokens' ? 'tokens' : 'cost';
  const totals = emptyMergedUsage();
  let unpricedModelCalls = 0;
  const headlineKeys = new Set();
  const headlineCosts = {}, headlineCostUnavailable = {};
  const days = new Map();          // day -> { bucket, models: Map(ref -> row) }
  const models = new Map();        // ref -> bucket
  const workspaces = new Map();    // host + cwd -> bucket
  const sessionRows = new Map();   // host + id -> row
  let indexing = false, discoveryTruncated = false, discoverySkipped = 0;
  let monthlyBudgetUsd = null;

  for (const { summary, hostId = null, hostLabel = null } of entries) {
    addMergedUsage(totals, summary.totals);
    unpricedModelCalls += summary.unpricedModelCalls || 0;
    for (const [key, value] of Object.entries(summary.headlineCosts || {})) {
      headlineKeys.add(key);
      headlineCostUnavailable[key] = (headlineCostUnavailable[key] || 0) +
        (summary.headlineCostUnavailable?.[key] || 0);
      if (Number.isFinite(value)) {
        headlineCosts[key] = (Number.isFinite(headlineCosts[key]) ? headlineCosts[key] : 0) + value;
      }
    }
    for (const day of summary.daily || []) {
      if (!day || !day.day) continue;
      let slot = days.get(day.day);
      if (!slot) { slot = { bucket: emptyMergedUsage(), models: new Map() }; days.set(day.day, slot); }
      addMergedUsage(slot.bucket, day);
      for (const model of day.models || []) {
        if (!model || !model.ref) continue;
        let row = slot.models.get(model.ref);
        if (!row) {
          row = {
            ref: model.ref, provider: model.provider, model: model.model, calls: 0, cost: 0,
            costUnavailable: Object.fromEntries(USAGE_MERGE_COST_KEYS.map(k => [k, 0])),
            tokens: Object.fromEntries(USAGE_MERGE_TOKEN_KEYS.map(k => [k, 0])),
          };
          slot.models.set(model.ref, row);
        }
        row.calls += model.calls || 0;
        for (const k of USAGE_MERGE_TOKEN_KEYS) row.tokens[k] += model.tokens?.[k] || 0;
        for (const k of USAGE_MERGE_COST_KEYS) row.costUnavailable[k] += model.costUnavailable?.[k] || 0;
        if (Number.isFinite(model.cost)) {
          row.cost = (Number.isFinite(row.cost) ? row.cost : 0) + model.cost;
        }
      }
    }
    for (const bucket of summary.groups?.models || []) {
      if (!bucket || !bucket.key) continue;
      let row = models.get(bucket.key);
      if (!row) {
        row = { key: bucket.key, provider: bucket.provider, model: bucket.model, ...emptyMergedUsage() };
        models.set(bucket.key, row);
      }
      addMergedUsage(row, bucket);
    }
    for (const bucket of summary.groups?.workspaces || []) {
      if (!bucket || bucket.key == null) continue;
      // The same path on two machines is two workspaces - never fold them.
      const key = hostId + ' ' + bucket.key;
      let row = workspaces.get(key);
      if (!row) {
        row = { key: bucket.key, host: hostId, hostLabel, ...emptyMergedUsage() };
        workspaces.set(key, row);
      }
      addMergedUsage(row, bucket);
    }
    for (const bucket of summary.groups?.sessions || []) {
      if (!bucket || bucket.id == null) continue;
      const key = hostId + ' ' + bucket.id;
      let row = sessionRows.get(key);
      if (!row) {
        row = { ...bucket, host: hostId, hostLabel, ...emptyMergedUsage() };
        sessionRows.set(key, row);
      }
      addMergedUsage(row, bucket);
    }
    if (summary.indexing) indexing = true;
    if (summary.discoveryTruncated) discoveryTruncated = true;
    discoverySkipped += Number(summary.discoverySkipped) || 0;
    if (monthlyBudgetUsd == null && summary.monthlyBudgetUsd != null) monthlyBudgetUsd = summary.monthlyBudgetUsd;
  }

  pricedUsageFields(totals);
  totals.unpricedCalls = unpricedModelCalls;
  const daily = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([day, slot]) => ({
      day,
      ...slot.bucket,
      models: [...slot.models.values()].sort((a, b) =>
        Number.isFinite(b.cost) - Number.isFinite(a.cost)
        || (Number.isFinite(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls),
    }));
  const rank = (rows) => rows.map(pricedUsageFields)
    .sort((a, b) => compareUsageBuckets(a, b, sort)).slice(0, 20);

  return {
    range: first.range,
    sort: first.sort,
    models: first.models || null,
    totals,
    groups: {
      models: rank([...models.values()]),
      workspaces: rank([...workspaces.values()]),
      sessions: rank([...sessionRows.values()]),
    },
    headlineCosts: Object.fromEntries([...headlineKeys].map(k => [k, headlineCosts[k] ?? null])),
    headlineCostUnavailable: Object.fromEntries([...headlineKeys].map(k => [k, headlineCostUnavailable[k] || 0])),
    daily,
    unpricedModelCalls,
    indexing,
    discoveryTruncated,
    discoverySkipped,
    monthlyBudgetUsd,
  };
}

/**
 * Unread = a live, idle session whose last activity is newer than when the
 * user last had it on screen. The session being viewed right now (visibly)
 * is never unread; a working session shows the working indicator instead.
 * Keys are composite (host + session), so `currentKey`/`seenMap` speak
 * sessionKey form; host-less sessions degrade to bare ids.
 */
function isUnreadSession(session, seenMap, currentKey, viewingVisible) {
  if (!session.isActive || session.turnInProgress) return false;
  const key = sessionRefKey(session);
  if (key === currentKey && viewingVisible) return false;
  const seen = seenMap[key];
  return !seen || new Date(session.lastActivity) > new Date(seen);
}

/**
 * pi "scoped models": settings.enabledModels holds patterns picking which
 * models are enabled for cycling (the TUI's /scoped-models selector persists
 * exact "provider/id" strings; hand-edited settings may use minimatch-style
 * globs and an optional ":level" thinking suffix). Mirror pi's
 * resolveModelScope matching: try the full "provider/id", then the bare id.
 */
const THINKING_LEVEL_NAMES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function stripThinkingSuffix(pattern) {
  const idx = pattern.lastIndexOf(':');
  if (idx === -1) return pattern;
  const suffix = pattern.slice(idx + 1).toLowerCase();
  return THINKING_LEVEL_NAMES.includes(suffix) ? pattern.slice(0, idx) : pattern;
}

// Glob → RegExp: * and ? don't cross "/" (minimatch semantics), [...] passes through.
// Returns null for a malformed glob (e.g. an unbalanced '[') rather than
// throwing — a hand-edited settings pattern must not take down /api/models.
function globToRegExp(glob) {
  const source = glob.replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  try {
    return new RegExp('^' + source + '$', 'i');
  } catch {
    return null;
  }
}

function modelMatchesPattern(pattern, model) {
  pattern = stripThinkingSuffix(String(pattern || ''));
  if (!pattern || !model || !model.id) return false;
  const fullId = (model.provider ? model.provider + '/' : '') + model.id;
  if (/[*?[]/.test(pattern)) {
    const re = globToRegExp(pattern);
    return !!re && (re.test(fullId) || re.test(model.id));
  }
  const p = pattern.toLowerCase();
  const id = model.id.toLowerCase();
  // Exact match, or the pattern is an alias for dated versions (claude-sonnet-4-5 → -20250929).
  return p === fullId.toLowerCase() || p === id || id.startsWith(p + '-');
}

/** No/empty patterns = no filter, everything enabled (pi's semantics). */
function isModelEnabled(patterns, model) {
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  return patterns.some(p => modelMatchesPattern(p, model));
}

/** Either half may be missing ({mood,label}-shaped tools send only one). */
function normalizeMood(description, face) {
  description = String(description || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  face = String(face || '').trim().replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ');
  if (!description && !face) return null;
  return { description, face };
}

/**
 * Append a sent prompt to a history list: trims, skips empties, dedupes an
 * immediate repeat, and caps the list (oldest dropped). Returns a new array.
 */
function pushPromptHistory(list, message, cap) {
  const out = Array.isArray(list) ? list.slice() : [];
  const msg = String(message || '').trim();
  if (!msg) return out;
  if (out[out.length - 1] === msg) return out;
  out.push(msg);
  const max = cap > 0 ? cap : 50;
  return out.length > max ? out.slice(out.length - max) : out;
}

/**
 * Neutralize URL schemes that execute script when a markdown link/image is
 * rendered into the DOM (the parsed markdown is written to innerHTML). Browsers
 * ignore whitespace and control characters spliced into a scheme, so strip
 * those before testing. Returns '#' for a blocked URL, otherwise the trimmed
 * original. Safe schemes (http/https/mailto), relative paths, and anchors pass.
 */
function sanitizeMarkdownUrl(url) {
  const raw = String(url == null ? '' : url).trim();
  const scheme = raw.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (/^(javascript|vbscript|data):/.test(scheme)) return '#';
  return raw;
}

/**
 * Marked extensions for LaTeX math rendering via KaTeX.
 * Supports:
 * - Block math: $$...$$ and \[...\] (multiline or single-line)
 * - Inline math: $...$, \(...\), and $$...$$ (within paragraphs)
 *
 * Avoids false positives on currency ($10 to $20) and escaped dollars (\$100).
 */
function createMathExtensions(katexLib) {
  const getKatex = () => katexLib || (typeof katex !== 'undefined' ? katex : null);

  const blockMath = {
    name: 'blockMath',
    level: 'block',
    start(src) {
      const match = src.match(/\$\$|\\\[/);
      return match ? match.index : -1;
    },
    tokenizer(src) {
      const match = /^(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])/.exec(src);
      if (match) {
        const text = match[1] !== undefined ? match[1] : match[2];
        return {
          type: 'blockMath',
          raw: match[0],
          text: text.trim(),
        };
      }
    },
    renderer(token) {
      const k = getKatex();
      if (!k) return `<pre class="math-block"><code>${escapeHtml(token.raw)}</code></pre>\n`;
      try {
        return `<div class="math-block">${k.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>\n`;
      } catch (e) {
        return `<pre class="math-error"><code>${escapeHtml(token.raw)}</code></pre>\n`;
      }
    },
  };

  const inlineMath = {
    name: 'inlineMath',
    level: 'inline',
    start(src) {
      const match = src.match(/\$|\\\(|\\\[/);
      return match ? match.index : -1;
    },
    tokenizer(src) {
      const bracketMatch = /^\\\[([\s\S]*?)\\\]/.exec(src);
      if (bracketMatch) {
        return {
          type: 'inlineMath',
          raw: bracketMatch[0],
          text: bracketMatch[1].trim(),
          display: true,
        };
      }
      const parenMatch = /^\\\(([\s\S]*?)\\\)/.exec(src);
      if (parenMatch) {
        return {
          type: 'inlineMath',
          raw: parenMatch[0],
          text: parenMatch[1].trim(),
          display: false,
        };
      }
      const doubleDollarMatch = /^\$\$([\s\S]*?)\$\$/.exec(src);
      if (doubleDollarMatch) {
        return {
          type: 'inlineMath',
          raw: doubleDollarMatch[0],
          text: doubleDollarMatch[1].trim(),
          display: true,
        };
      }
      const dollarMatch = /^\$((?:\\\$|[^\$\s\n])(?:(?:\\\$|[^\$\n])*?(?:\\\$|[^\$\s\n]))?)\$/.exec(src);
      if (dollarMatch) {
        return {
          type: 'inlineMath',
          raw: dollarMatch[0],
          text: dollarMatch[1],
          display: false,
        };
      }
    },
    renderer(token) {
      const k = getKatex();
      if (!k) return escapeHtml(token.raw);
      try {
        return k.renderToString(token.text, { displayMode: Boolean(token.display), throwOnError: false });
      } catch (e) {
        return escapeHtml(token.raw);
      }
    },
  };

  return [blockMath, inlineMath];
}

/**
 * Whether a chat-mentioned token plausibly names a file the viewer could
 * open: one path-safe token (optionally ~/, ./, ../ or / rooted, optional
 * trailing :line[:col]) that carries a '/' or a letter-led extension. The
 * extension rule keeps versions ("1.2.3") and prose out while accepting
 * "findings.md"; false positives are cheap (the server 404s), false
 * negatives are a dead filename the user can't tap.
 */
var FILE_MENTION_RE = /^(?:~\/|\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?$/;
var FILE_EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

function looksLikeFilePath(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s || s.length > 260) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false; // URLs
  if (!FILE_MENTION_RE.test(s)) return false;
  const stripped = s.replace(/:\d+(?::\d+)?$/, '');
  return stripped.includes('/') || FILE_EXT_RE.test(stripped);
}

/**
 * Path-looking tokens in plain prose (inline code is handled separately and
 * more permissively). Stricter than looksLikeFilePath: a bare word only
 * counts with a rooted prefix or a real extension — "and/or" and
 * "input/output" must not linkify — and domain-ish extensions are dropped
 * ("example.com" is prose, not a file). Returns [{ start, end, token }].
 */
var PATH_TOKEN_RE = /(?:~\/|\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?/g;
var BARE_EXT_STOPLIST = new Set(['com', 'org', 'net', 'io', 'ai', 'dev', 'co', 'app']);

function findPathTokens(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN_RE.exec(s))) {
    // '.' is a path char, so a sentence period rides along — trim it.
    const token = m[0].replace(/[.,;:!?]+$/, '');
    if (!token) continue;
    const prev = s[m.index - 1];
    if (prev && /[\w.@:/+-]/.test(prev)) continue; // mid-URL / mid-word
    if (!looksLikeFilePath(token)) continue;
    const stripped = token.replace(/:\d+(?::\d+)?$/, '');
    const rooted = /^(?:~\/|\.{1,2}\/|\/)/.test(stripped);
    const ext = (stripped.match(FILE_EXT_RE) || [''])[0].slice(1);
    if (!rooted && !ext) continue;
    if (!rooted && !stripped.includes('/') && BARE_EXT_STOPLIST.has(ext.toLowerCase())) continue;
    out.push({ start: m.index, end: m.index + token.length, token });
  }
  return out;
}

/**
 * A short plain-text excerpt of `text` around the first occurrence of any of
 * `tokens` (both already lowercased — this runs against the search corpus),
 * for showing *why* a content search matched. Trims to word boundaries and
 * marks elided ends with an ellipsis. '' when no token occurs.
 */
function buildSnippet(text, tokens, radius = 60) {
  return buildSnippets(text, tokens, { radius, max: 1 }).snippets[0] || '';
}

/**
 * Multi-window variant for the advanced-search view: up to `max` excerpts,
 * each around the next token occurrence past the previous window, plus the
 * total occurrence count of all tokens (which keeps counting past the last
 * window — "12 matches" with 4 snippets is meaningful).
 */
function buildSnippets(text, tokens, { radius = 60, max = 4 } = {}) {
  const valid = tokens.filter(Boolean);
  if (!valid.length) return { snippets: [], count: 0 };
  let count = 0;
  for (const t of valid) {
    let i = text.indexOf(t);
    while (i !== -1) { count++; i = text.indexOf(t, i + t.length); }
  }
  const snippets = [];
  let from = 0;
  while (snippets.length < max) {
    let at = -1, tokenLen = 0;
    for (const t of valid) {
      const i = text.indexOf(t, from);
      if (i !== -1 && (at === -1 || i < at)) { at = i; tokenLen = t.length; }
    }
    if (at === -1) break;
    // Never reach back into the previous window: repeated text between
    // adjacent excerpts reads like a rendering bug.
    let start = Math.max(snippets.length ? from : 0, at - radius);
    let end = Math.min(text.length, at + tokenLen + radius);
    // Don't cut words: pull the window edges in to the whitespace inside it.
    if (start > 0) {
      const ws = text.indexOf(' ', start);
      if (ws !== -1 && ws < at) start = ws + 1;
    }
    if (end < text.length) {
      const ws = text.lastIndexOf(' ', end);
      if (ws >= at + tokenLen) end = ws;
    }
    snippets.push((start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : ''));
    from = end + 1;
  }
  return { snippets, count };
}

/**
 * Escape `text` for HTML with every (case-insensitive) occurrence of the
 * given tokens wrapped in <mark>. Overlapping token ranges are merged so the
 * output never nests marks.
 */
function highlightTokens(text, tokens) {
  const str = String(text);
  const lower = str.toLowerCase();
  const ranges = [];
  for (const t of tokens) {
    if (!t) continue;
    const needle = String(t).toLowerCase();
    for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + 1)) {
      ranges.push([i, i + needle.length]);
    }
  }
  if (!ranges.length) return escapeHtml(str);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (const [s, e] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let out = '', pos = 0;
  for (const [s, e] of merged) {
    out += escapeHtml(str.slice(pos, s)) + '<mark>' + escapeHtml(str.slice(s, e)) + '</mark>';
    pos = e;
  }
  return out + escapeHtml(str.slice(pos));
}

/**
 * Render a unified diff's hunks as HTML lines for the diff modal. File-level
 * header lines (diff --git, index, ---/+++, mode/rename noise) are dropped —
 * the modal's file row already shows path and status; only content from the
 * first @@ onward renders. Returns '' for empty/missing patches.
 */
function renderDiffHtml(patch) {
  if (!patch) return '';
  const out = [];
  let inHunk = false;
  let oldLine = null, newLine = null;
  const lines = String(patch).split('\n');
  // A patch's terminating newline is a separator, not an additional blank
  // source line. Real blank context lines still carry the unified-diff ' '.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? Number(match[1]) : null;
      newLine = match ? Number(match[2]) : null;
      out.push(`<div class="diff-line diff-hunk" data-diff-line="1">${escapeHtml(line)}</div>`);
      continue;
    }
    if (!inHunk) continue;
    // Git's marker describes the preceding line; it is not itself a source
    // line and must not advance or expose old/new line coordinates.
    if (line[0] === '\\') {
      out.push(`<div class="diff-line diff-note">${escapeHtml(line)}</div>`);
      continue;
    }
    const cls = line[0] === '+' ? ' diff-add' : line[0] === '-' ? ' diff-del' : '';
    const oldAt = line[0] === '+' ? null : oldLine;
    const newAt = line[0] === '-' ? null : newLine;
    const attrs = ` data-diff-line="1" data-old-line="${oldAt ?? ''}" data-new-line="${newAt ?? ''}"`;
    out.push(`<div class="diff-line${cls}"${attrs}>${escapeHtml(line) || ' '}</div>`);
    if (line[0] !== '+' && oldLine != null) oldLine++;
    if (line[0] !== '-' && newLine != null) newLine++;
  }
  return out.join('');
}

/** CSS-safe class suffix for a git status letter (M/A/D/R/C/U/?/T). */
function diffStatusClass(letter) {
  switch (letter) {
    case 'A': case '?': return 'add';
    case 'D': return 'del';
    case 'R': case 'C': return 'ren';
    case 'U': return 'conflict';
    default: return 'mod';
  }
}

// --- Usage view (chart math and labels) ---

/**
 * Readable model name from a model id (provider stripped): drops
 * bedrock-style vendor prefixes ("us.anthropic."), trailing wire-format
 * versions ("-v1:0"), and trailing release-date stamps ("-20250929",
 * "-2024-11-20", "@20250219"). Display form only — keep the full ref in a
 * title attribute so nothing is hidden.
 */
function shortModelName(model) {
  if (!model) return 'unknown';
  let name = String(model);
  const slash = name.lastIndexOf('/');
  if (slash >= 0) name = name.slice(slash + 1);
  name = name.replace(/^(?:[a-z]{2,3}\.)?(?:anthropic|amazon|meta|mistral|cohere|ai21|google|deepseek|qwen)\./, '');
  name = name.replace(/-v\d+:\d+$/, ''); // bedrock wire format only — "-v4" is a real model name
  name = name.replace(/[-@](?:20\d{6}|20\d{2}-\d{2}-\d{2})$/, '');
  return name || String(model);
}

/**
 * Clean axis ticks for a positive maximum: ~`target` steps on a
 * 1/2/2.5/5×10^k grid, ascending from 0; `top` is the last tick (≥ max).
 */
function niceTicks(max, target = 4) {
  if (!Number.isFinite(max) || max <= 0) return { step: 1, top: 1, ticks: [0, 1] };
  const rawStep = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let step = 10 * mag;
  for (const m of [1, 2, 2.5, 5]) { if (rawStep <= m * mag) { step = m * mag; break; } }
  const ticks = [];
  const top = Math.ceil(max / step - 1e-9) * step;
  for (let i = 0; i * step <= top + step / 2; i++) ticks.push(Math.round(i * step * 1e9) / 1e9);
  return { step, top: ticks[ticks.length - 1], ticks };
}

const USAGE_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const USAGE_WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-07-12" → "Jul 12" ('short') or "Sat, Jul 12, 2026" ('long'). Locale-free. */
function formatUsageDay(day, style = 'short') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return String(day || '');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const label = `${USAGE_MONTH_NAMES[mo - 1] || m[2]} ${d}`;
  if (style !== 'long') return label;
  return `${USAGE_WEEKDAY_NAMES[new Date(y, mo - 1, d, 12).getDay()]}, ${label}, ${y}`;
}

/**
 * Fold a long daily usage series into week buckets (chart bars and their
 * 2px gaps stop reading past ~90 marks). Chunks of 7 anchored at the END so
 * the newest bucket always ends today; the oldest may be partial. Model rows
 * merge by ref. Entries keep the daily shape plus `days` (bucket span);
 * `day` is the bucket's first day.
 */
function aggregateUsageWeekly(daily) {
  const out = [];
  const tokenKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
  const costKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
  for (let end = daily.length; end > 0; end -= 7) {
    const chunk = daily.slice(Math.max(0, end - 7), end);
    const models = new Map();
    const agg = {
      day: chunk[0].day, days: chunk.length, calls: 0,
      tokens: Object.fromEntries(tokenKeys.map(k => [k, 0])),
      costs: Object.fromEntries(costKeys.map(k => [k, 0])),
      costUnavailable: Object.fromEntries(costKeys.map(k => [k, 0])),
      models: [],
    };
    for (const d of chunk) {
      agg.calls += d.calls || 0;
      for (const k of tokenKeys) agg.tokens[k] += d.tokens?.[k] || 0;
      for (const k of costKeys) {
        agg.costUnavailable[k] += d.costUnavailable?.[k] || 0;
        const value = d.costs?.[k];
        if (Number.isFinite(value)) {
          agg.costs[k] = (Number.isFinite(agg.costs[k]) ? agg.costs[k] : 0) + value;
        }
      }
      for (const dm of d.models || []) {
        const t = models.get(dm.ref) || { ref: dm.ref, provider: dm.provider, model: dm.model, calls: 0, cost: 0, costUnavailable: { total: 0 }, tokens: Object.fromEntries(tokenKeys.map(k => [k, 0])) };
        t.calls += dm.calls || 0;
        t.costUnavailable.total += dm.costUnavailable?.total || 0;
        if (Number.isFinite(dm.cost)) {
          t.cost = (Number.isFinite(t.cost) ? t.cost : 0) + dm.cost;
        }
        for (const k of tokenKeys) t.tokens[k] += dm.tokens?.[k] || 0;
        models.set(dm.ref, t);
      }
    }
    agg.models = [...models.values()].sort((a, b) => Number.isFinite(b.cost) - Number.isFinite(a.cost) || (Number.isFinite(b.cost) ? b.cost - a.cost : 0) || b.calls - a.calls);
    out.unshift(agg);
  }
  return out;
}

/**
 * tmux prefix key notation ("C-b", "C-a", "M-x", "C-Space") → the raw byte
 * sequence a terminal sends for it. Null when unmappable — the on-screen
 * prefix button hides rather than sending the wrong bytes.
 */
function tmuxPrefixSeq(prefix) {
  if (typeof prefix !== 'string') return null;
  if (/^C-Space$/i.test(prefix)) return '\x00';
  let m = /^C-([a-zA-Z@[\\\]^_?])$/.exec(prefix);
  if (m) {
    if (m[1] === '?') return '\x7f';
    const code = m[1].toUpperCase().charCodeAt(0);
    return String.fromCharCode(code & 31);
  }
  m = /^M-(.)$/.exec(prefix);
  if (m) return '\x1b' + m[1];
  return null;
}

/**
 * OMP's canonical model roles in the harness's own order, with the names its
 * TUI uses. The stored record may also carry arbitrary custom role keys, so
 * consumers must treat this as the labelled subset, not the whole vocabulary.
 */
const OMP_MODEL_ROLES = [
  { key: 'default', name: 'Default', description: 'Main agent model' },
  { key: 'smol', name: 'Fast', description: 'Fast/cheap model for lightweight tasks, summaries, and fallbacks' },
  { key: 'slow', name: 'Thinking', description: 'Deep-reasoning model for thorough analysis' },
  { key: 'vision', name: 'Vision', description: 'Vision-capable model for image inspection and descriptions' },
  { key: 'plan', name: 'Architect', description: 'Planning/architecture mode' },
  { key: 'designer', name: 'Designer', description: 'UI and design tasks' },
  { key: 'commit', name: 'Commit', description: 'Commit message generation' },
  { key: 'tiny', name: 'Tiny', description: 'Session titles and micro-classifiers (falls back to smol)' },
  { key: 'task', name: 'Subtask', description: 'Default model for subagent tasks' },
  { key: 'advisor', name: 'Advisor', description: 'Paired reviewer model that watches each turn' },
];

function modelRoleRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, model]) => typeof model === 'string' && model));
}

/**
 * Editor row model: canonical roles first (always shown, assigned or not),
 * then custom keys present in the global record. `value` is the *global*
 * assignment — the only one the editor may write — while `override` carries a
 * differing effective value, which a project `.omp/config.yml` wins with in
 * that cwd.
 */
function buildModelRoleRows(globalRoles, effectiveRoles) {
  const global = modelRoleRecord(globalRoles);
  const effective = modelRoleRecord(effectiveRoles);
  const row = (key, name, description, custom) => {
    const value = global[key] || '';
    const effectiveValue = effective[key] || '';
    return {
      key, name, description, custom, value, effectiveValue,
      override: effectiveValue && effectiveValue !== value ? effectiveValue : null,
    };
  };
  const canonical = new Set(OMP_MODEL_ROLES.map(role => role.key));
  return [
    ...OMP_MODEL_ROLES.map(role => row(role.key, role.name, role.description, false)),
    ...Object.keys(global).filter(key => !canonical.has(key)).sort()
      .map(key => row(key, key, 'Custom role', true)),
  ];
}

/** One quiet line of role assignments for the new-session readout. */
function formatModelRoleSummary(roles, limit = 4) {
  const record = modelRoleRecord(roles);
  const order = OMP_MODEL_ROLES.map(role => role.key);
  const rank = (key) => (order.indexOf(key) < 0 ? order.length : order.indexOf(key));
  const entries = Object.keys(record)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(key => `${key} ${record[key]}`);
  if (!entries.length) return 'No roles assigned';
  const shown = entries.slice(0, limit);
  const rest = entries.length - shown.length;
  return shown.join(' · ') + (rest > 0 ? ` · +${rest} more` : '');
}

/**
 * Filename for a downloaded attachment: the one the response names in its
 * Content-Disposition, else `fallback`. RFC 5987 `filename*` wins over the
 * plain `filename`, matching what browsers do for a real navigation.
 *
 * The value arrives over the wire, and on a fleet that wire ends at a *peer* —
 * a fleet mapping is reachability, never authority — so it is reduced to a
 * bare basename with no separators, traversal or control characters before
 * it can reach an <a download>.
 */
function filenameFromContentDisposition(header, fallback) {
  const clean = (raw) => {
    if (typeof raw !== 'string') return '';
    const base = raw.replace(/\\/g, '/').split('/').pop()
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return base === '.' || base === '..' ? '' : base;
  };
  const value = typeof header === 'string' ? header : '';
  const extended = value.match(/;\s*filename\*\s*=\s*([^;]+)/i);
  if (extended) {
    // charset'language'percent-encoded-value
    const parts = extended[1].trim().match(/^[^']*'[^']*'(.*)$/);
    if (parts) {
      try {
        const decoded = clean(decodeURIComponent(parts[1]));
        if (decoded) return decoded;
      } catch { /* a malformed encoding just falls through to `filename` */ }
    }
  }
  const quoted = value.match(/;\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
  if (quoted) {
    const decoded = clean(quoted[1].replace(/\\(.)/g, '$1'));
    if (decoded) return decoded;
  }
  const bare = value.match(/;\s*filename\s*=\s*([^;"][^;]*)/i);
  if (bare) {
    const decoded = clean(bare[1]);
    if (decoded) return decoded;
  }
  return fallback;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml, stripAnsi, formatTokens, formatCacheStat, formatRuntime, formatRelativeTime, formatTime, formatDuration, formatTokSpeed,
    formatEstimatedCost, formatUsageCost, formatResponseMetadata,
    shortCwd, truncate, extractTextContent, getToolSummary, getToolOutputText, extractImageBlocks, messageHasVisibleText,
    contextClass, sessionSupports, harnessBadgeInfo, sessionMetaText, parseModelId, formatModelRef,
    groupByWorkspace, buildWorkspaceTree, collectTreeSessions, groupSessionsByDate,
    buildSessionFamilies, flattenSessionFamilies, partitionPinnedFamilies,
    partitionPinned, applyLocalFilter, applyHostTerms, fuzzyMatch, fuzzyScore,
    RELATION_KIND_ORDER, sortRelations, isChildRelation, groupRelations,
    parseSessionQuery, evaluateSessionQuery, positiveQueryTokens, scoreSessionMatch, stripQueryField,
    highlightFuzzy, normalizeMood, isUnreadSession, THINKING_LEVEL_NAMES,
    sessionKey, parseSessionKey, sessionRefKey, normalizeHostBase, sanitizeHostCatalog,
    hostDisplayLabel, sessionRef, uniqueSessionPrefix, mergeHostEntries, mergeUsageSummaries, createFanoutRenderQueue,
    parseSessionRefTokens, parseSessionRefParts, formatSessionRefContext,
    appendSessionRefContext, splitSessionRefContext, searchSessionsForRef,
    hostSupportsCapability, hostSupportsTerminal,
    HOST_BACKOFF_LADDER, HOST_BACKOFF_RESET_MS, hostConnReduce,
    HOST_COLOR_SLOTS, sanitizeHostColors, sanitizeHostColorOrder, assignHostColor,
    sortHostSections, hostSectionKey, rgbStringToHex,
    modelMatchesPattern, isModelEnabled, pushPromptHistory, sanitizeMarkdownUrl, createMathExtensions,
    buildSnippet, buildSnippets, highlightTokens, looksLikeFilePath, findPathTokens,
    renderDiffHtml, diffStatusClass,
    shortModelName, niceTicks, formatUsageDay, aggregateUsageWeekly,
    tmuxPrefixSeq, filenameFromContentDisposition,
    OMP_MODEL_ROLES, buildModelRoleRows, formatModelRoleSummary,
  };
}
