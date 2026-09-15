// Compile-only consumers of the browser's strict TypeScript state boundary.
import { createSessionState } from '../../src/browser/session-state';
import type { SessionEntry, SessionLists, HostSessionLists, SessionStateOptions } from '../../src/browser/session-state';

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

// Published inputs and outputs are borrowed readonly views, including fan-out order.
declare const rows: readonly SessionEntry[];
declare const observations: readonly HostSessionLists[];
const published: SessionLists = state.setSessionLists({ active: rows, previous: rows }, 'peer');
const hostPublications: readonly SessionLists[] = state.setSessionLists(observations);
state.setSessionLists(published, 'peer');
state.setSessionLists(state.sessions);
void hostPublications;
// @ts-expect-error Host observations cannot be retargeted by a reader.
observations[0].hostId = 'self';
// @ts-expect-error Host observations cannot replace borrowed lists.
observations[0].active = [];
// @ts-expect-error List containers belong to publication.
state.sessions = { active: [], previous: [] };
// @ts-expect-error List properties belong to publication.
state.sessions.active = [];
// @ts-expect-error Previous lists cannot be replaced through a published result.
published.previous = [];
// @ts-expect-error List membership cannot be appended by a reader.
state.sessions.active.push({ id: 'foreign' });
// @ts-expect-error List membership cannot be removed by a reader.
state.sessions.previous.splice(0, 1);
// @ts-expect-error List ordering belongs to publication.
published.active.sort();
// @ts-expect-error Metadata is changed only through its named writer.
state.sessions.active[0].model = 'foreign/model';
// @ts-expect-error Host identity belongs to the answering endpoint.
state.sessions.previous[0].host = 'foreign';
// @ts-expect-error Host labels belong to state stamping.
published.active[0].hostLabel = 'Foreign host';
// @ts-expect-error Capability maps cannot be replaced by a reader.
published.active[0].capabilities = { resume: false };
const capabilities = published.active[0].capabilities;
if (capabilities) {
  // @ts-expect-error First-party capability advice is readonly.
  capabilities.resume = false;
}
const found = state.findSession('session', 'peer');
if (found) {
  // @ts-expect-error Lookup is not a mutation escape hatch.
  found.name = 'foreign';
  // @ts-expect-error Lookup capability advice is readonly too.
  if (found.capabilities) found.capabilities.prompt = true;
}
const selected = state.setCurrentSession('session', 'peer');
if (selected) {
  // @ts-expect-error Selection returns a read view, not a mutable builder.
  selected.model = 'foreign/model';
  // @ts-expect-error Selection cannot be retargeted.
  selected.host = 'self';
  // @ts-expect-error Selected capability advice cannot be mutated.
  if (selected.capabilities) selected.capabilities.resume = false;
}
if (state.currentSession) {
  // @ts-expect-error Selected metadata remains owned by state writers.
  state.currentSession.model = 'foreign/model';
  // @ts-expect-error Selected host labels remain owned by state stamping.
  state.currentSession.hostLabel = 'Foreign host';
}
