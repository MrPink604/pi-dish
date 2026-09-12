// Compile-only consumers of the browser's strict TypeScript state boundary.
import { createSessionState } from '../../src/browser/session-state';
import type { SessionStateOptions } from '../../src/browser/session-state';

// Host identity can be unknown before discovery; callbacks must accept null.
declare const options: SessionStateOptions;
createSessionState({
  ...options,
  // @ts-expect-error A string-only callback cannot label an unidentified host.
  getHostLabel: (host: string) => host,
});

const state = createSessionState({
  getSelfHostId: () => 'self', getHostLabel: host => host,
  onListsChanged() {}, onCurrentChanged() {},
});
state.setSessionLists({ active: [{ id: 'session', model: 'p/m', extras: { custom: { opaque: true } } }] });
// @ts-expect-error Named list metadata cannot contain opaque values.
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
// @ts-expect-error Session rows require an id at the closed metadata boundary.
state.setSessionLists({ active: [{ name: 'missing id' }] });
// @ts-expect-error A generation is numeric, not a session id.
state.ownsSelection({ id: 'session', host: 'self', generation: 'session' });
// @ts-expect-error The old id-plus-counter guard is retired.
state.ownsSessionView('session', 1);
// @ts-expect-error Snapshot replacement belongs to the state writers.
state.currentSession = null;
// @ts-expect-error Metadata updates cannot replace identity.
state.patchSession('session', { id: 7 });
// @ts-expect-error Optional nullable metadata still requires presentation fallback.
const model: string = state.currentSession?.model;
void model;

state.patchSessionActivity('session', { turnInProgress: false, compacting: true }, 'self');
state.mergeCurrentSession(owner, { cwd: null, contextTokens: 0, lastActivity: 0, isActive: false });
// @ts-expect-error Misspelled metadata cannot enter a patch.
state.patchSession('session', { modle: 'typo' }, 'self');
// @ts-expect-error Known fields reject wrong types.
state.patchSession('session', { model: 123 }, 'self');
// @ts-expect-error Even a correctly typed identity is not mutation metadata.
state.patchSession('session', { id: 'replacement' }, 'self');
// @ts-expect-error Activity writers do not rename sessions.
state.patchSessionActivity('session', { name: 'wrong writer' }, 'self');
// @ts-expect-error Mutation writers do not control stream activity.
state.patchSession('session', { turnInProgress: true }, 'self');
// @ts-expect-error Transcript metadata cannot change capability advice.
state.mergeCurrentSession(owner, { capabilities: { resume: true } });
// @ts-expect-error Transcript metadata cannot change harness identity.
state.mergeCurrentSession(owner, { harnessId: 'omp' });
// @ts-expect-error Transcript metadata cannot import routine annotations.
state.mergeCurrentSession(owner, { routine: 'automation' });
// @ts-expect-error Opaque extras do not belong to authoritative patches.
state.mergeCurrentSession(owner, { extras: { name: 'replacement' } });
// @ts-expect-error Named session rows have no open index signature.
state.setSessionLists({ active: [{ id: 'session', modle: 'typo' }] });
