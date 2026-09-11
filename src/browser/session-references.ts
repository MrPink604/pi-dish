import type { SessionState, SessionEntry } from './session-state';
import type { EffectiveHost } from './host-catalog';
import { shortSessionRef, uniqueSessionPrefix, parseSessionRefParts, parseSessionRefTokens, searchSessionsForRef } from './helper-refs';
import { record } from './helper-values';
export function createSessionReferences(options: {
  sessionState: SessionState; selfId: () => string | null; host: (id: string | null) => Readonly<EffectiveHost> | null;
  hostLabel: (id: string | null) => string; config: () => Readonly<Record<string, unknown>>;
}) {
  const { sessionState } = options;
  type SessionIdentity = Pick<SessionEntry, 'id' | 'host'>;
  function hostId(session: Pick<SessionEntry, 'host'> | null | undefined) { return session?.host || options.selfId(); }
  function all() { return [...sessionState.sessions.active, ...sessionState.sessions.previous].map(row => ({
    id: row.id, host: row.host || null, name: typeof row.name === 'string' ? row.name : '', cwd: typeof row.cwd === 'string' ? row.cwd : '', isActive: row.isActive === true,
    lastActivity: typeof row.lastActivity === 'number' || typeof row.lastActivity === 'string' ? row.lastActivity : 0,
  })); }
  function candidates() { const current = sessionState.currentSession; return all().filter(row => !current || row.id !== current.id || hostId(row) !== hostId(current)); }
  function sameHostIds(session: SessionIdentity) { return all().filter(row => hostId(row) === hostId(session)).map(row => row.id); }
  function prefix(session: SessionIdentity) {
    const endpoint = options.host(hostId(session)), ids = sameHostIds(session);
    const aliases = endpoint && (record(endpoint.capabilities) ? endpoint.capabilities.refAliases === true : (endpoint.self === true || endpoint.base === '') && !!options.config().refAliases);
    return aliases ? shortSessionRef(session.id, ids) : uniqueSessionPrefix(session.id, ids);
  }
  function ref(session: SessionIdentity, target: SessionIdentity | null) {
    const sourceHost = hostId(session), targetHost = hostId(target), short = prefix(session);
    if (sourceHost === targetHost) return short;
    if (targetHost === options.selfId()) { const entry = options.host(sourceHost); if (entry?.name) return `${entry.name}/${short}`; }
    return `${sourceHost}:${session.id}`;
  }
  function match(value: string, localHostId = sessionState.currentSession ? hostId(sessionState.currentSession) : options.selfId()) {
    const parts = parseSessionRefParts(value); if (!parts) return null;
    const onHost = all().filter(session => {
      const host = hostId(session); if (!parts.hostPart) return host === localHostId;
      if (parts.hostIdForm) return host === parts.hostPart;
      if (parts.hostPart.toLowerCase() === 'self') return host === localHostId;
      const entry = options.host(host); return !!entry && String(entry.name || '').toLowerCase() === parts.hostPart.toLowerCase();
    });
    const exact = onHost.find(row => row.id === parts.id); if (exact || parts.hostIdForm) return exact || null;
    const matches = onHost.filter(row => row.id.startsWith(parts.id)); return matches.length === 1 ? matches[0]! : null;
  }
  function hints(message: string) {
    return parseSessionRefTokens(message).flatMap(({ ref }) => { const session = match(ref); return session ? [{ ref, name: session.name, host: options.hostLabel(session.host) || '', cwd: session.cwd, isActive: session.isActive }] : []; });
  }
  return { all, hostId, candidates, sameHostIds, prefix, ref, match, hints, search: (token: string) => searchSessionsForRef(candidates(), token, 8) };
}
