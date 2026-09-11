import type { ApiRequest, HostEndpoint } from './api-client';
import type { SelectionOwner, SessionState } from './session-state';
import { formatRelativeTime } from './helper-format';
import { sortRelations, groupRelations, isChildRelation } from './helper-sessions';
import { record } from './helper-values';
export interface SessionRelation {
  readonly kind: string; readonly source: string;
  readonly session: { readonly id: string; readonly name: string; readonly cwd: string;
    readonly isActive: boolean; readonly lastActivity: string | number | null };
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
export function decodeSessionRelations(value: unknown): readonly SessionRelation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    if (!record(row) || !record(row.session) || typeof row.session.id !== 'string' || !row.session.id) return [];
    const session = row.session;
    return [{ kind: text(row.kind), source: text(row.source), session: { id: session.id as string,
      name: text(session.name), cwd: text(session.cwd), isActive: session.isActive === true,
      lastActivity: typeof session.lastActivity === 'string' || typeof session.lastActivity === 'number' ? session.lastActivity : null } }];
  });
}
export function createSessionRelations(options: {
  document: Document; window: Window; sessionState: SessionState; request: ApiRequest;
  endpoint: (host: string | null) => HostEndpoint | null;
  loadPrevious: () => Promise<unknown>; selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
  status: (message: string, kind: 'error') => void;
}) {
  const { document, window, sessionState } = options;
  const element = (id: string) => document.getElementById(id);
  let sessionRelationsSeq = 0;
  let disposed = false;
  let renderOwner: SelectionOwner | null = null;
  let renderEndpoint: HostEndpoint | null = null;
  let headerEvents = new AbortController(), modalEvents = new AbortController();
  const events = new AbortController();
  let indexingTimer: ReturnType<typeof setTimeout> | undefined;
  function sameEndpoint(host: string | null, endpoint: HostEndpoint | null): boolean {
    const current = options.endpoint(host);
    return !!endpoint && !!current && current.base === endpoint.base && (current.token || '') === (endpoint.token || '');
  }
  const owns = (owner: SelectionOwner | null, endpoint = renderEndpoint) => !disposed && sessionState.ownsSelection(owner) && !!owner && sameEndpoint(owner.host, endpoint);
  const label = (labels: Readonly<Record<string, string>>, kind: string, fallback: string) => Object.hasOwn(labels, kind) ? labels[kind] : fallback;
  function clearSessionRelations() {
    sessionRelationsSeq += 1;
    clearTimeout(indexingTimer); clearTimeout(relationResizeTimer);
    headerEvents.abort(); renderOwner = null; renderEndpoint = null;
    sessionRelations = [];
    closeRelationsModal();
    const el = document.getElementById('sessionRelations');
    if (!el) return;
    el.replaceChildren();
    el.style.display = 'none';
  }

  const RELATION_LABELS: Readonly<Record<string, string>> = {
    parent: 'Parent',
    child: 'Child',
    startedFrom: 'Started from',
    startedHere: 'Started here',
  };

  // Plural forms for the overflow modal's group headings.
  const RELATION_GROUP_LABELS: Readonly<Record<string, string>> = {
    parent: 'Parent',
    child: 'Children',
    startedFrom: 'Started from',
    startedHere: 'Started here',
  };

  // Subagent fan-outs can relate a session to dozens of children. The header
  // fills one physical row with live child chips; closed children and any live
  // chips that do not fit go behind a "+N more" chip that opens the relations
  // modal. The fallback is only used if the header has no measurable width yet.
  const RELATION_FALLBACK_VISIBLE_CHIPS = 6;
  let sessionRelations: readonly SessionRelation[] = [];
  let relationResizeTimer: ReturnType<typeof setTimeout> | undefined;

  function createRelationChip(relation: SessionRelation) {
    const target = relation?.session;
    if (!target?.id) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-relation-chip';
    button.title = `${label(RELATION_LABELS, relation.kind, 'Related session')} · ${relation.source || 'session metadata'}`;
    const kind = document.createElement('span');
    kind.className = 'session-relation-kind';
    kind.textContent = label(RELATION_LABELS, relation.kind, 'Related');
    const name = document.createElement('span');
    name.className = 'session-relation-name';
    name.textContent = target.name || target.id.slice(0, 8);
    button.append(kind, name);
    const owner = renderOwner, endpoint = renderEndpoint;
    button.addEventListener('click', () => {
      if (owns(owner, endpoint)) void openRelatedSession(target.id, owner, endpoint);
    }, { signal: headerEvents.signal });
    return button;
  }

  function createMoreRelationChip(hiddenCount: number) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'session-relation-chip session-relation-more';
    more.title = `Show ${hiddenCount} hidden related session${hiddenCount === 1 ? '' : 's'}`;
    const count = document.createElement('span');
    count.className = 'session-relation-kind';
    count.textContent = `+${hiddenCount}`;
    const label = document.createElement('span');
    label.className = 'session-relation-name';
    label.textContent = 'more';
    more.append(count, label);
    const owner = renderOwner, endpoint = renderEndpoint;
    more.addEventListener('click', () => { if (owns(owner, endpoint)) openRelationsModal(); }, { signal: headerEvents.signal });
    return more;
  }

  // Pick the largest prefix that fits in one row, reserving room for the
  // overflow chip when any relation is hidden. The buttons are measured after
  // insertion so long/short child names naturally determine how many fit.
  function fitRelationChipCount(el: HTMLElement, chips: readonly HTMLButtonElement[], totalCount: number) {
    const available = el.clientWidth;
    if (!available) return Math.min(chips.length, RELATION_FALLBACK_VISIBLE_CHIPS);

    const style = getComputedStyle(el);
    const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
    const moreProbe = createMoreRelationChip(totalCount);
    el.replaceChildren(...chips, moreProbe);
    const widths = chips.map(chip => chip.offsetWidth);
    const prefixWidths = [0];
    for (const width of widths) prefixWidths.push(prefixWidths[prefixWidths.length - 1] + width);

    let chosen = 0;
    for (let count = chips.length; count >= 0; count -= 1) {
      const hiddenCount = totalCount - count;
      let needed = prefixWidths[count] + Math.max(0, count - 1) * gap;
      if (hiddenCount > 0) {
        moreProbe.querySelector<HTMLElement>('.session-relation-kind')!.textContent = `+${hiddenCount}`;
        needed += (count ? gap : 0) + moreProbe.offsetWidth;
      }
      if (needed <= available) {
        chosen = count;
        break;
      }
    }
    return chosen;
  }

  function renderSessionRelations(relations: readonly SessionRelation[], owner: SelectionOwner | null = renderOwner, endpoint: HostEndpoint | null = renderEndpoint) {
    if (!owns(owner, endpoint)) return;
    renderOwner = owner; renderEndpoint = endpoint;
    headerEvents.abort(); headerEvents = new AbortController();
    const el = element('sessionRelations');
    if (!el) return;
    // Keep all valid relations for the modal, but only live child relations are
    // eligible for the header. Parent/started-from links remain useful even
    // when those sessions are no longer active.
    sessionRelations = sortRelations(relations).filter(relation => relation?.session?.id);
    el.replaceChildren();
    if (!sessionRelations.length) {
      closeRelationsModal();
      el.style.display = 'none';
      return;
    }
    el.style.display = '';

    const headerRelations = [
      // Keep live child bubbles visible when the row is tight; parent/source
      // links can still be reached from the overflow modal.
      ...sessionRelations.filter(relation => isChildRelation(relation) && relation.session.isActive),
      ...sessionRelations.filter(relation => !isChildRelation(relation)),
    ];
    const chips = headerRelations.map(createRelationChip).filter((chip): chip is HTMLButtonElement => chip !== null);
    const visibleCount = fitRelationChipCount(el, chips, sessionRelations.length);
    const hiddenCount = sessionRelations.length - visibleCount;
    el.replaceChildren(...chips.slice(0, visibleCount));
    if (hiddenCount > 0) el.appendChild(createMoreRelationChip(hiddenCount));

    // The indexing re-poll can grow the list while the modal is open.
    const modal = document.getElementById('relationsModal');
    if (modal && modal.style.display !== 'none') renderRelationsModal();
  }

  window.addEventListener('resize', () => {
    if (!owns(renderOwner) || !sessionRelations.length) return;
    clearTimeout(relationResizeTimer);
    relationResizeTimer = setTimeout(() => {
      const el = document.getElementById('sessionRelations');
      if (sessionState.currentSession && el?.style.display !== 'none') renderSessionRelations(sessionRelations);
    }, 100);
  }, { signal: events.signal });

  function openRelationsModal() {
    if (!owns(renderOwner) || !sessionRelations.length) return;
    const modal = element('relationsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderRelationsModal();
  }

  function closeRelationsModal() {
    modalEvents.abort();
    const modal = document.getElementById('relationsModal');
    if (modal) modal.style.display = 'none';
  }

  function renderRelationsModal() {
    if (!owns(renderOwner)) return;
    modalEvents.abort(); modalEvents = new AbortController();
    const body = document.getElementById('relationsBody');
    if (!body) return;
    body.replaceChildren();
    const owner = renderOwner, endpoint = renderEndpoint;
    for (const group of groupRelations(sessionRelations)) {
      const title = document.createElement('div');
      title.className = 'stats-share-title relation-group-title';
      const groupLabel = label(RELATION_GROUP_LABELS, group.kind || '', label(RELATION_LABELS, group.kind || '', 'Related'));
      title.textContent = group.relations.length > 1 ? `${groupLabel} (${group.relations.length})` : groupLabel;
      body.appendChild(title);
      for (const relation of group.relations) {
        const target = relation?.session;
        if (!target?.id) continue;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'relation-row';
        row.title = target.cwd || target.id;
        if (target.isActive) {
          const dot = document.createElement('span');
          dot.className = 'live-dot';
          row.appendChild(dot);
        }
        const name = document.createElement('span');
        name.className = 'relation-row-name';
        name.textContent = target.name || target.id.slice(0, 8);
        row.appendChild(name);
        const meta = document.createElement('span');
        meta.className = 'relation-row-meta';
        meta.textContent = formatRelativeTime(target.lastActivity);
        row.appendChild(meta);
        row.addEventListener('click', () => {
          if (!owns(owner, endpoint)) return;
          closeRelationsModal();
          void openRelatedSession(target.id, owner, endpoint);
        }, { signal: modalEvents.signal });
        body.appendChild(row);
      }
    }
  }

  async function loadSessionRelations(owner: SelectionOwner | null): Promise<void> {
    if (disposed || !owner || !sessionState.ownsSelection(owner)) return;
    const resolved = options.endpoint(owner.host);
    if (!resolved) return;
    const endpoint = Object.freeze({ ...resolved });
    const seq = ++sessionRelationsSeq;
    clearTimeout(indexingTimer);
    const current = () => seq === sessionRelationsSeq && owns(owner, endpoint);
    try {
      const res = await options.request(endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/related`);
      const data: unknown = await res.json();
      if (!current()) return;
      if (!res.ok) throw new Error(record(data) && text(data.error) || `HTTP ${res.status}`);
      renderSessionRelations(decodeSessionRelations(record(data) ? data.relations : null), owner, endpoint);
      if (record(data) && data.indexing === true) indexingTimer = setTimeout(() => {
        if (current()) void loadSessionRelations(owner);
      }, 1000);
    } catch (error) {
      if (current()) { renderSessionRelations([], owner, endpoint); console.error('Failed to load related sessions:', error); }
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
    openModal: openRelationsModal, closeModal: closeRelationsModal,
    dispose() { clearSessionRelations(); events.abort(); disposed = true; },
  };
}
