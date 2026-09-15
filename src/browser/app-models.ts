import { sameDirectoryHost } from './directory-catalog';
import type { DirectoryHost } from './directory-catalog';
import type { createModelCatalog } from './model-catalog';
import type { SessionState } from './session-state';

// Session catalogs follow the captured selection and resolved host endpoint.
export function createAppModels(options: {
  sessions: SessionState;
  catalog: ReturnType<typeof createModelCatalog>;
  host: (id: string | null) => DirectoryHost | null;
}) {
  function load(sessionId: string, harnessId?: string) {
    const { sessions, catalog } = options;
    const owner = sessions.captureSelection();
    const storedHarness = sessions.findSession(sessionId)?.harnessId;
    const requestedHarnessId = harnessId || (typeof storedHarness === 'string' ? storedHarness : '') || 'pi';
    const requestedHost = sessions.sessionHostId(sessionId);
    const endpoint = options.host(requestedHost);
    if (!endpoint) { catalog.clear(); return Promise.resolve(); }
    const captured = Object.freeze({ ...endpoint });
    const owns = () => sameDirectoryHost(captured, options.host(requestedHost))
      && !!owner && owner.id === sessionId && sessions.ownsSelection(owner);
    return catalog.load({ host: captured, sessionId, harnessId: requestedHarnessId }, owns);
  }
  return { load };
}
