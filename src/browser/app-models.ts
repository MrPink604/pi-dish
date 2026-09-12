import { sameDirectoryHost } from './directory-catalog';
import type { DirectoryHost } from './directory-catalog';
import type { createModelCatalog } from './model-catalog';
import type { createNewSession } from './new-session';
import type { SessionState } from './session-state';

// The composition root supplies the two views that can own the shared catalog.
// Read the takeover lazily: it is constructed after the session controls.
export function createAppModels(options: {
  sessions: SessionState;
  catalog: ReturnType<typeof createModelCatalog>;
  host: (id: string | null) => DirectoryHost | null;
  takeover: () => Pick<ReturnType<typeof createNewSession>, 'generation' | 'isOpen' | 'hostId' | 'selectedHarness' | 'cwd'>;
}) {
  function load(sessionId?: string | null, harnessId?: string, cwd?: string, host?: string | null) {
    const { sessions, catalog } = options;
    const owner = sessionId ? sessions.captureSelection() : null;
    const storedHarness = sessionId ? sessions.findSession(sessionId)?.harnessId : null;
    const requestedHarnessId = harnessId || (typeof storedHarness === 'string' ? storedHarness : '') || 'pi';
    const requestedHost = sessionId ? sessions.sessionHostId(sessionId) : (host === undefined ? null : host);
    const endpoint = options.host(requestedHost);
    if (!endpoint) { catalog.clear(); return Promise.resolve(); }
    const captured = Object.freeze({ ...endpoint });
    const generation = options.takeover().generation;
    const ownsRows = () => sameDirectoryHost(captured, options.host(requestedHost))
      && (sessionId ? !!owner && owner.id === sessionId && sessions.ownsSelection(owner)
        : generation === options.takeover().generation && options.takeover().isOpen()
          && options.takeover().hostId() === captured.hostId && options.takeover().selectedHarness() === requestedHarnessId);
    const ownsRequest = () => ownsRows() && (!!sessionId || options.takeover().cwd() === (cwd || ''));
    return catalog.load({ host: captured, sessionId: sessionId || undefined, harnessId: requestedHarnessId, cwd }, ownsRequest, ownsRows);
  }
  return { load };
}
