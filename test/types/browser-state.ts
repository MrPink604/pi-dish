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
state.advanceSelection();
const owner = state.captureSelection();
state.ownsSelection(owner);
state.mergeCurrentSession(owner, { model: 'opaque model' });
if (owner) {
  const generation: number = owner.generation;
  void generation;
  // @ts-expect-error Ownership cannot be retargeted after capture.
  owner.host = 'peer';
}
// @ts-expect-error A session id alone cannot authorize a transcript merge.
state.mergeCurrentSession('session', { name: 'stale' });
// @ts-expect-error Host identity is required in addition to id and generation.
state.ownsSelection({ id: 'session', generation: 1 });
// @ts-expect-error Session lookup requires a string host identity.
state.findSession('session', 7);
// @ts-expect-error Session rows require an id even though metadata stays opaque.
state.setSessionLists({ active: [{ name: 'missing id' }] });
// @ts-expect-error A generation is numeric, not a session id.
state.ownsSelection({ id: 'session', host: 'self', generation: 'session' });
// @ts-expect-error The old id-plus-counter guard is retired.
state.ownsSessionView('session', 1);
// @ts-expect-error Snapshot replacement belongs to the state writers.
state.currentSession = null;
// @ts-expect-error Metadata updates retain the identity field's string type.
state.patchSession('session', { id: 7 });
// @ts-expect-error Opaque metadata needs a feature-specific check.
const model: string = state.currentSession?.model;
void model;
