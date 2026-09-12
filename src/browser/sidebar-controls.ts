import type { SessionState, SessionEntry, SelectionOwner } from './session-state';
import type { ApiRequest, HostEndpoint } from './api-client';
import { sendJson } from './api-client';
import { sessionKey, sessionRefKey, parseSessionKey } from './helper-identity';
import { buildSessionFamilies } from './helper-sessions';
import { escapeHtml } from './helper-format';
import type { SessionFamily } from './shared-helper-types';

/** Sidebar preferences and row actions own their DOM, timers and captured host endpoints. */
export function createSidebarControls(options: {
  document: Document; storage: Pick<Storage, 'getItem' | 'setItem'>; sessionState: SessionState; request: ApiRequest;
  host: (id: string | null) => HostEndpoint | null; render: () => void; closeSidebar: () => void;
  select: (id: string, host: string | null) => void; pending: (id: string) => void; create: (cwd: string, host: string | null) => void;
  refresh: () => Promise<unknown>;
  finishClose: (id: string, host: string | null, owner: SelectionOwner | null) => Promise<unknown>;
  ref: (session: SessionEntry) => string; copy: (text: string) => Promise<unknown>; status: (message: string, type?: string) => void;
}) {
  const { document, storage, sessionState } = options, window = document.defaultView!;
  const list = document.getElementById('sessionList')!;
  const lifetime = new AbortController();
  let disposed = false, mounted = false;
  function read(key: string): string[] { try { const value: unknown = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; } catch { return []; } }
  function write(key: string, value: Iterable<string>) { try { storage.setItem(key, JSON.stringify([...value])); } catch {} }
  const collapsed = new Set(read('pi-dish-collapsed-groups')), expanded = new Set(read('pi-dish-expanded-session-families'));
  let pinned = read('pi-dish-pinned-sessions');
  const render = () => { if (!disposed) options.render(); };
  function savePins() { write('pi-dish-pinned-sessions', pinned); }
  function saveExpanded() { write('pi-dish-expanded-session-families', expanded); }
  function reloadPreferences() {
    if (disposed) return;
    pinned = read('pi-dish-pinned-sessions'); expanded.clear(); for (const key of read('pi-dish-expanded-session-families')) expanded.add(key);
    collapsed.clear(); for (const key of read('pi-dish-collapsed-groups')) collapsed.add(key);
  }
  function migrate(host: string) {
    if (disposed) return;
    const qualify = (key: string) => parseSessionKey(key).hostId === null ? sessionKey(host, key) : key;
    pinned = pinned.map(qualify); savePins(); const next = [...expanded].map(qualify); expanded.clear(); for (const key of next) expanded.add(key); saveExpanded();
  }
  function toggleGroup(key: string) { if (disposed) return; if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key); write('pi-dish-collapsed-groups', collapsed); render(); }
  function toggleFamily(id: string, host = sessionState.sessionHostId(id)) {
    if (disposed) return; const key = sessionKey(host, id); if (expanded.has(key)) expanded.delete(key); else expanded.add(key); saveExpanded(); render();
  }
  const sessions = () => [...sessionState.sessions.active, ...sessionState.sessions.previous];
  function familyRoots() {
    const rows = sessions(), roots = buildSessionFamilies(rows), map = new Map<string, string>();
    const visit = (node: SessionFamily<SessionEntry>, root: string) => { map.set(sessionRefKey(node.session), root); for (const child of node.children) visit(child, root); };
    for (const root of roots) visit(root, sessionRefKey(root.session));
    const byKey = new Map(rows.map(row => [sessionRefKey(row), row]));
    for (const [member, visibleRoot] of map) {
      let canonical = visibleRoot, cursor = byKey.get(visibleRoot); const seen = new Set([canonical]);
      while (cursor?.familyParentId) {
        const parent = sessionKey(cursor.host, cursor.familyParentId); if (seen.has(parent)) break;
        canonical = parent; seen.add(canonical); cursor = byKey.get(canonical);
      }
      map.set(member, canonical);
    }
    return map;
  }
  function reveal(id: string, host = sessionState.sessionHostId(id)) {
    if (disposed) return; const key = sessionKey(host, id), roots = buildSessionFamilies(sessions());
    function find(node: SessionFamily<SessionEntry>, ancestors: string[]): string[] | null {
      if (sessionRefKey(node.session) === key) return ancestors;
      for (const child of node.children) { const found = find(child, [...ancestors, sessionRefKey(node.session)]); if (found) return found; }
      return null;
    }
    for (const root of roots) { const ancestors = find(root, []); if (ancestors) { for (const key of ancestors) expanded.add(key); saveExpanded(); return; } }
  }
  function togglePin(id: string, displayedRoot = id, members = [id], host = sessionState.sessionHostId(id)) {
    if (disposed) return;
    const roots = familyRoots(), key = sessionKey(host, id), canonical = roots.get(key) || key;
    const aliases = new Set(members.map(member => sessionKey(host, member))); aliases.add(sessionKey(host, displayedRoot));
    for (const [member, root] of roots) if (root === canonical) aliases.add(member);
    const visible = new Set(Array.from(list.querySelectorAll<HTMLElement>('.session-item[data-id]')).map(row => sessionKey(row.dataset.host, row.dataset.id)));
    for (const member of aliases) {
      const { hostId, sessionId } = parseSessionKey(member), parentId = sessionState.findSession(sessionId, hostId)?.familyParentId;
      const parentKey = sessionKey(hostId, parentId); if (typeof parentId === 'string' && parentId && !visible.has(parentKey)) aliases.add(parentKey);
    }
    const wasPinned = pinned.some(pin => aliases.has(pin)); pinned = pinned.filter(pin => !aliases.has(pin)); if (!wasPinned) pinned.push(canonical);
    savePins(); render();
  }
  interface Close { id: string; host: string | null; key: string; endpoint: Readonly<HostEndpoint>; owner: SelectionOwner | null; generation: number }
  let confirm: Close | null = null, busy: Close | null = null, confirmTimer: ReturnType<typeof setTimeout> | null = null;
  function captureClose(id: string, host: string | null): Close | null {
    const endpoint = options.host(host); return disposed || !endpoint ? null : { id, host, key: sessionKey(host, id), endpoint: Object.freeze({ ...endpoint }), owner: sessionState.captureSelection(), generation: sessionState.selectionGeneration };
  }
  const endpoint = (entry: Close) => { const current = options.host(entry.host); return !disposed && current && current.base === entry.endpoint.base ? { ...entry.endpoint, token: current.token } : null; };
  const ownsFeedback = (entry: Close) => entry.owner ? sessionState.ownsSelection(entry.owner) : sessionState.selectionGeneration === entry.generation && !sessionState.currentSession;
  function clearConfirm() { if (confirmTimer) clearTimeout(confirmTimer); confirmTimer = null; confirm = null; }
  async function performClose(id: string, host = sessionState.sessionHostId(id), captured?: Close) {
    if (disposed || busy) return; const entry = captured || captureClose(id, host); if (!entry) return;
    const target = endpoint(entry); if (!target) { clearConfirm(); render(); return; }
    clearConfirm(); busy = entry; render();
    try {
      await sendJson(options.request, target, `/api/sessions/${encodeURIComponent(id)}/close`, undefined);
      if (busy !== entry || !endpoint(entry)) return;
      busy = null;
      if (!entry.owner && !ownsFeedback(entry)) await options.refresh();
      else await options.finishClose(id, host, entry.owner);
    } catch (error) {
      if (busy !== entry || !endpoint(entry)) return;
      if (ownsFeedback(entry)) options.status('Close failed: ' + (error instanceof Error ? error.message : String(error)), 'error');
    } finally { if (busy === entry) busy = null; render(); }
  }
  function closeClick(id: string, host = sessionState.sessionHostId(id)) {
    if (disposed || busy) return; const key = sessionKey(host, id);
    if (confirm?.key === key && endpoint(confirm)) { void performClose(id, host, confirm); return; }
    clearConfirm(); confirm = captureClose(id, host); if (!confirm) return;
    const entry = confirm; confirmTimer = setTimeout(() => { if (confirm !== entry || disposed) return; clearConfirm(); render(); }, 3000); render();
  }
  let menu: HTMLElement | null = null, menuOwner: symbol | null = null, menuEvents = new AbortController();
  const menuTimers = new Set<ReturnType<typeof setTimeout>>();
  function later(callback: () => void, ms: number) { const timer = setTimeout(() => { menuTimers.delete(timer); if (!disposed) callback(); }, ms); menuTimers.add(timer); }
  function closeMenu() { menuOwner = null; menuEvents.abort(); for (const timer of menuTimers) clearTimeout(timer); menuTimers.clear(); if (menu) menu.style.display = 'none'; }
  function openMenu(session: SessionEntry, x: number, y: number) {
    if (disposed) return; closeMenu();
    if (!menu) { menu = document.createElement('div'); menu.id = 'sessionMenu'; menu.className = 'context-menu'; document.body.append(menu); }
    const el = menu, owner = Symbol('menu'); menuOwner = owner; menuEvents = new AbortController(); const { signal } = menuEvents;
    const current = () => !disposed && menuOwner === owner && !signal.aborted && el.isConnected;
    const ref = options.ref(session);
    el.innerHTML = [['Copy session ref', ref, ref], ['Copy session id', session.id, '']].map(([label, value, preview]) => `<button type="button" class="context-menu-item" data-copy="${escapeHtml(value)}"><span class="context-menu-label">${escapeHtml(label)}</span>${preview ? `<span class="context-menu-value">${escapeHtml(preview)}</span>` : ''}</button>`).join('');
    el.style.display = 'block'; el.style.left = '0px'; el.style.top = '0px';
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8))}px`; el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8))}px`;
    for (const item of Array.from(el.querySelectorAll<HTMLElement>('.context-menu-item'))) {
      const value = item.dataset.copy || '';
      item.addEventListener('click', () => {
        if (!current() || !el.contains(item)) return;
        void options.copy(value).then(() => {
          if (!current() || !el.contains(item)) return;
          const label = item.querySelector('.context-menu-label'); if (label) label.textContent = 'Copied'; item.classList.add('copied');
          later(() => { if (current()) closeMenu(); }, 700);
        }, () => { if (current()) { closeMenu(); options.status('Copy failed (clipboard blocked)', 'error'); } });
      }, { signal });
    }
    document.addEventListener('scroll', closeMenu, { capture: true, signal }); window.addEventListener('resize', closeMenu, { signal });
    later(() => { if (!current()) return; document.addEventListener('click', event => {
      if (current() && event.target instanceof Node && document.body.contains(event.target) && !el.contains(event.target)) closeMenu();
    }, { signal }); }, 0);
  }
  interface Drag { pointer: number; family: HTMLElement; segment: HTMLElement; events: AbortController }
  let drag: Drag | null = null;
  function finishDrag(entry: Drag, save: boolean) {
    if (drag !== entry) return; drag = null; entry.events.abort(); entry.family.classList.remove('dragging');
    if (save && !disposed && list.contains(entry.segment) && entry.segment.contains(entry.family)) {
      pinned = Array.from(entry.segment.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('session-family-root')).map(el => el.dataset.familyKey || '').filter(Boolean); savePins();
    }
    render();
  }
  function mount() {
    if (disposed || mounted) return; mounted = true; const { signal } = lifetime;
    list.addEventListener('pointerdown', event => {
      if (drag || !(event.target instanceof Element)) return;
      const handle = event.target.closest('.session-drag-handle'), family = handle?.closest<HTMLElement>('.session-family-root'), segment = family?.parentElement;
      if (!family || !segment?.classList.contains('pinned-segment') || !list.contains(segment)) return;
      event.preventDefault(); const entry: Drag = { pointer: event.pointerId, family, segment, events: new AbortController() }; drag = entry; family.classList.add('dragging');
      const signal = entry.events.signal;
      document.addEventListener('pointermove', move => {
        if (drag !== entry || move.pointerId !== entry.pointer || !list.contains(segment)) return;
        const siblings = Array.from(segment.children).filter(el => el.classList.contains('session-family-root') && el !== family);
        const next = siblings.find(sib => { const rect = sib.getBoundingClientRect(); return move.clientY < rect.top + rect.height / 2; });
        if (next) segment.insertBefore(family, next); else segment.appendChild(family);
      }, { signal });
      document.addEventListener('pointerup', up => { if (up.pointerId === entry.pointer) finishDrag(entry, true); }, { signal });
      document.addEventListener('pointercancel', cancel => { if (cancel.pointerId === entry.pointer) finishDrag(entry, true); }, { signal });
    }, { signal });
    list.addEventListener('click', event => {
      if (!(event.target instanceof Element) || !list.contains(event.target)) return;
      const target = event.target, item = target.closest<HTMLElement>('.session-item'), id = item?.dataset.id, host = item?.dataset.host || null;
      const familyToggle = target.closest<HTMLElement>('.session-family-toggle'); if (familyToggle) { if (familyToggle.dataset.familyId) toggleFamily(familyToggle.dataset.familyId, host); return; }
      if (target.closest('.session-pin-btn')) {
        if (id && item) { const family = item.closest<HTMLElement>('.session-family-root'); const members = family ? Array.from(family.querySelectorAll<HTMLElement>('.session-item[data-id]')).map(row => row.dataset.id!).filter(Boolean) : [id]; togglePin(id, family?.dataset.familyId || id, members, host); } return;
      }
      if (target.closest('.session-close-btn')) { event.stopPropagation(); if (id) closeClick(id, host); return; }
      if (target.closest('.session-drag-handle')) return;
      const newButton = target.closest<HTMLElement>('.workspace-new-btn'); if (newButton) { if (newButton.dataset.path) options.create(newButton.dataset.path, newButton.dataset.host || null); return; }
      const hostHeader = target.closest<HTMLElement>('.host-section-header'); if (hostHeader) { if (hostHeader.dataset.hostSection) toggleGroup(hostHeader.dataset.hostSection); return; }
      const header = target.closest<HTMLElement>('.workspace-group-header'); if (header) { if (header.dataset.cwd) toggleGroup(header.dataset.cwd); return; }
      if (!item) return;
      if (item.classList.contains('starting')) { if (item.dataset.spawnId) options.pending(item.dataset.spawnId); }
      else if (id) options.select(id, host);
      if (window.innerWidth <= 768) options.closeSidebar();
    }, { signal });
    list.addEventListener('contextmenu', event => {
      if (!(event.target instanceof Element)) return; const item = event.target.closest<HTMLElement>('.session-item[data-id]'); if (!item || !list.contains(item)) return;
      const session = sessionState.findSession(item.dataset.id, item.dataset.host || null); if (!session) return;
      event.preventDefault(); openMenu(session, event.clientX, event.clientY);
    }, { signal });
  }
  function dispose() { if (disposed) return; disposed = true; lifetime.abort(); clearConfirm(); busy = null; closeMenu(); menu?.remove(); menu = null; if (drag) finishDrag(drag, false); }
  return { mount, dispose, migrate, reloadPreferences, toggleGroup, toggleFamily, familyRoots, reveal, togglePin, closeClick, performClose, openMenu, closeMenu,
    get menuOpen() { return !!menuOwner; }, get dragging() { return !!drag; }, get closeConfirm() { return confirm?.key || null; }, get closeBusy() { return busy?.key || null; },
    get collapsed(): ReadonlySet<string> { return collapsed; }, get expanded(): ReadonlySet<string> { return expanded; }, get pinned(): readonly string[] { return pinned; } };
}
