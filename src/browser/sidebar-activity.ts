import type { SessionState, SessionEntry } from './session-state';
import { record } from './helper-values';
import { sessionKey, sessionRefKey, parseSessionKey } from './helper-identity';
import { isUnreadSession } from './helper-sessions';
import { sidebarSession } from './sidebar-render';
/** Device-local activity markers are qualified by the session's owning host. */
export function createSidebarActivity(options: { document: Document; storage: Pick<Storage, 'getItem' | 'setItem'>; sessionState: SessionState }) {
  const { document, storage, sessionState } = options;
  let seen: Record<string, string | number> = Object.create(null);
  function reload() { try { const value: unknown = JSON.parse(storage.getItem('pi-dish-seen') || '{}'); seen = Object.create(null); if (record(value)) for (const [key, at] of Object.entries(value)) if (typeof at === 'string' || typeof at === 'number' && Number.isFinite(at)) seen[key] = at; } catch {} }
  function save() { try { storage.setItem('pi-dish-seen', JSON.stringify(seen)); } catch {} }
  function mark(session: SessionEntry | null, at: unknown = session?.lastActivity) { if (!session || !at || typeof at !== 'string' && typeof at !== 'number') return; seen[sessionRefKey(session)] = at; save(); }
  function unread(session: Pick<SessionEntry, 'id' | 'host'> & Record<string, unknown>) { return isUnreadSession(sidebarSession(session), seen, sessionState.currentSession ? sessionRefKey(sessionState.currentSession) : null, !document.hidden); }
  function title() { const count = sessionState.sessions.active.filter(unread).length; document.title = count ? `(${count}) pi-dish` : 'pi-dish'; }
  function prune(host: string | null, active: readonly SessionEntry[]) { const live = new Set(active.map(row => sessionKey(row.host || host, row.id))); for (const key of Object.keys(seen)) if (parseSessionKey(key).hostId === host && !live.has(key)) delete seen[key]; }
  function migrate(host: string) { const next: Record<string, string | number> = Object.create(null); for (const [key, at] of Object.entries(seen)) next[parseSessionKey(key).hostId ? key : sessionKey(host, key)] = at; seen = next; save(); }
  reload(); return { reload, mark, unread, title, prune, migrate };
}
