// Compile-only consumers of the browser's strict JavaScript boundary.
import { createSessionState } from '../../public/session-state';

const state = createSessionState({
  getSelfHostId: () => 'self', getHostLabel: host => host,
  onListsChanged() {}, onCurrentChanged() {},
});
state.setSessionLists({ active: [{ id: 'session', model: { opaque: true } }] });
state.setCurrentSession('session', 'self');
state.findSession();
state.sessionHostId();
state.patchSession('session', { name: 'new name' }, 'self');
const generation: number = state.advanceSelection();
state.ownsSessionView('session', generation);
// @ts-expect-error Session lookup requires a string host identity.
state.findSession('session', 7);
// @ts-expect-error Session rows require an id even though metadata stays opaque.
state.setSessionLists({ active: [{ name: 'missing id' }] });
// @ts-expect-error A generation is numeric, not a session id.
state.ownsSessionView('session', 'session');
// @ts-expect-error Snapshot replacement belongs to the state writers.
state.currentSession = null;
// @ts-expect-error Metadata updates retain the identity field's string type.
state.patchSession('session', { id: 7 });
// @ts-expect-error Opaque metadata needs a feature-specific check.
const model: string = state.currentSession?.model;
void model;
