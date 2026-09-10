/**
 * Browser session state, shared with the node tests. No DOM or transport.
 * Metadata stays opaque; this boundary owns list/selection identity and writes.
 * @typedef {{ id: string, host?: string | null, hostLabel?: string } & Record<string, unknown>} SessionEntry
 * @typedef {{ active: SessionEntry[], previous: SessionEntry[] }} SessionLists
 * @typedef {{ hostId?: string | null, active?: SessionEntry[], previous?: SessionEntry[] }} HostSessionLists
 * @typedef {{ getSelfHostId: () => string | null, getHostLabel: (host: string | null) => string | null,
 *   onListsChanged: () => void, onCurrentChanged: () => void }} SessionStateOptions
 */

/** @param {SessionStateOptions} options */
function createSessionState(options) {
  /** @type {SessionLists} */
  let sessions = { active: [], previous: [] };
  /** @type {SessionEntry | null} */
  let currentSession = null;
  let generation = 0;

  /**
   * A qualified miss never falls back to another host. Unqualified lookup
   * prefers the selected host, otherwise it requires an unambiguous identity.
   * @param {string | null} [id]
   * @param {string | null} [host]
   */
  function findSession(id, host) {
    if (!host && currentSession?.id === id) host = currentSession.host;
    /** @type {SessionEntry | undefined} */
    let found;
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

  /** @param {string | null} [id] */
  function sessionHostId(id) {
    if (id && currentSession?.id === id && currentSession.host) return currentSession.host;
    return findSession(id)?.host || options.getSelfHostId();
  }

  /**
   * Stamping happens only in the four writers. Labels refresh on each write
   * because the host can be relabelled while its sessions remain in state.
   * @param {SessionEntry} session
   * @param {string | null} [hostId]
   */
  function stampSessionHost(session, hostId = options.getSelfHostId()) {
    if (!session.host && hostId) session.host = hostId;
    const label = options.getHostLabel(session.host || hostId);
    if (label) session.hostLabel = label;
    return session;
  }

  /**
   * Polls replace lists and fold fresh metadata into the detached selection.
   * @param {HostSessionLists | HostSessionLists[]} next
   * @param {string | null} [hostId]
   */
  function setSessionLists(next, hostId = options.getSelfHostId()) {
    const parts = Array.isArray(next) ? next : [{ hostId, active: next.active, previous: next.previous }];
    /** @type {SessionLists} */
    const merged = { active: [], previous: [] };
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
   * @param {string | null} id
   * @param {string | null} [host]
   */
  function setCurrentSession(id, host) {
    const entry = findSession(id, host);
    currentSession = entry ? stampSessionHost({ ...entry }) : null;
    return currentSession;
  }

  /**
   * Local mutations patch both lists and the selected copy for one host.
   * @param {string} id
   * @param {Partial<SessionEntry>} patch
   * @param {string | null} [host]
   */
  function patchSession(id, patch, host = sessionHostId(id)) {
    /** @param {SessionEntry | null} session */
    const matches = session => session !== null && session.id === id && (session.host || null) === (host || null);
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
   * retain their own source of truth, and wire fields cannot change the host.
   * @param {string} id
   * @param {Partial<SessionEntry> | null | undefined} fields
   */
  function mergeCurrentSession(id, fields) {
    if (!fields || currentSession?.id !== id) return;
    const host = currentSession.host;
    Object.assign(currentSession, fields);
    currentSession.host = host;
    stampSessionHost(currentSession);
    options.onCurrentChanged();
  }

  // Every selection owns a new generation, including forced reloads and
  // provisional spawns. Invalidate before the view reset: an id alone cannot
  // prove that asynchronous work still owns the pane.
  function advanceSelection() { return ++generation; }
  /** @param {string} sessionId @param {number} selectedGeneration */
  function ownsSessionView(sessionId, selectedGeneration) {
    return currentSession?.id === sessionId && generation === selectedGeneration;
  }

  return {
    get sessions() { return sessions; },
    get currentSession() { return currentSession; },
    get generation() { return generation; },
    findSession, sessionHostId, setSessionLists, setCurrentSession,
    patchSession, mergeCurrentSession, advanceSelection, ownsSessionView,
  };
}

if (typeof module !== 'undefined') module.exports = { createSessionState };
