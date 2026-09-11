/** Browser list/selection identity and writes. No DOM or transport. */
export type SessionEntry = { id: string; host?: string | null; hostLabel?: string } & Record<string, unknown>;
export interface SessionLists { active: SessionEntry[]; previous: SessionEntry[] }
export interface HostSessionLists { hostId?: string | null; active?: SessionEntry[]; previous?: SessionEntry[] }
export type SelectionOwner = Readonly<{ id: string; host: string | null; generation: number }>;
export interface SessionStateOptions {
  getSelfHostId: () => string | null;
  getHostLabel: (host: string | null) => string | null;
  onListsChanged: () => void;
  onCurrentChanged: () => void;
}

export function createSessionState(options: SessionStateOptions) {
  let sessions: SessionLists = { active: [], previous: [] };
  let currentSession: SessionEntry | null = null;
  let generation = 0;

  /**
   * A qualified miss never falls back to another host. Unqualified lookup
   * prefers the selected host, otherwise it requires an unambiguous identity.
   */
  function findSession(id?: string | null, host?: string | null) {
    if (!host && currentSession && currentSession.id === id) host = currentSession.host;
    let found: SessionEntry | undefined;
    for (const list of [sessions.active, sessions.previous]) {
      for (const session of list) {
        if (session.id !== id || (host && (session.host || null) !== host)) continue;
        if (found && (found.host || null) !== (session.host || null)) return undefined;
        // Active-only polls can retain a previous row for the same identity.
        if (!found) found = session;
      }
    }
    return found;
  }

  function sessionHostId(id?: string | null) {
    if (id && currentSession?.id === id && currentSession.host) return currentSession.host;
    return findSession(id)?.host || options.getSelfHostId();
  }

  /**
   * Stamping happens only in the four writers. Labels refresh on each write
   * because the host can be relabelled while its sessions remain in state.
   */
  function stampSessionHost(session: SessionEntry, hostId = options.getSelfHostId()) {
    if (!session.host && hostId) session.host = hostId;
    const label = options.getHostLabel(session.host || hostId);
    if (label) session.hostLabel = label;
    return session;
  }

  /**
   * Polls replace lists and fold fresh metadata into the detached selection.
   */
  function setSessionLists(next: HostSessionLists | HostSessionLists[], hostId = options.getSelfHostId()) {
    const parts = Array.isArray(next) ? next : [{ hostId, active: next.active, previous: next.previous }];
    const merged: SessionLists = { active: [], previous: [] };
    for (const part of parts) {
      for (const session of part.active || []) merged.active.push(stampSessionHost(session, part.hostId));
      for (const session of part.previous || []) merged.previous.push(stampSessionHost(session, part.hostId));
    }
    sessions = merged;
    if (currentSession) {
      const fresh = findSession(currentSession.id, currentSession.host);
      if (fresh) currentSession = { ...currentSession, ...fresh };
    }
    options.onListsChanged();
    options.onCurrentChanged();
  }

  /**
   * Selection returns a detached copy. The caller owns its broader view reset
   * and rendering, including invalidation before that reset starts.
   */
  function setCurrentSession(id: string | null, host?: string | null) {
    const entry = findSession(id, host);
    currentSession = entry ? stampSessionHost({ ...entry }) : null;
    return currentSession;
  }

  /**
   * Local mutations patch both lists and the selected copy for one host.
   */
  function patchSession(id: string, patch: Partial<SessionEntry>, host = sessionHostId(id)) {
    const matches = (session: SessionEntry | null) => session !== null && session.id === id && (session.host || null) === (host || null);
    for (const list of [sessions.active, sessions.previous]) {
      const session = list.find(matches);
      if (session) stampSessionHost(Object.assign(session, patch));
    }
    if (matches(currentSession) && currentSession) stampSessionHost(Object.assign(currentSession, patch));
    options.onListsChanged();
    if (matches(currentSession)) options.onCurrentChanged();
  }

  /**
   * Transcript metadata refreshes the header only. Registry-aware list fields
   * retain their own source of truth, and wire fields cannot change identity.
   */
  function mergeCurrentSession(owner: SelectionOwner | null | undefined, fields: Partial<SessionEntry> | null | undefined) {
    if (!fields || !ownsSelection(owner) || !currentSession) return;
    const { id, host } = currentSession;
    Object.assign(currentSession, fields);
    currentSession.id = id;
    currentSession.host = host;
    stampSessionHost(currentSession);
    options.onCurrentChanged();
  }

  // Every selection owns a new generation, including forced reloads and
  // provisional spawns. Invalidate before the view reset: an id alone cannot
  // prove that asynchronous work still owns the pane.
  function advanceSelection() { generation += 1; }

  function captureSelection(): SelectionOwner | null {
    return currentSession
      ? Object.freeze({ id: currentSession.id, host: currentSession.host || null, generation })
      : null;
  }

  function ownsSelection(owner: SelectionOwner | null | undefined) {
    return !!owner && !!currentSession && owner.id === currentSession.id
      && owner.host === (currentSession.host || null) && owner.generation === generation;
  }

  return {
    get sessions() { return sessions; },
    get currentSession() { return currentSession; },
    get selectionGeneration() { return generation; },
    findSession, sessionHostId, setSessionLists, setCurrentSession,
    patchSession, mergeCurrentSession, advanceSelection,
    captureSelection, ownsSelection,
  };
}

export type SessionState = ReturnType<typeof createSessionState>;
