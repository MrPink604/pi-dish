const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionState } = require('../public/session-state');

function fixture() {
  let selfHostId = 'self';
  const labels = { self: 'This host', peer: 'Other host' };
  const renders = [];
  const state = createSessionState({
    getSelfHostId: () => selfHostId,
    getHostLabel: host => labels[host] || null,
    onListsChanged: () => renders.push('lists'),
    onCurrentChanged: () => renders.push('header'),
  });
  return { state, renders, labels, identifySelf: host => { selfHostId = host; } };
}

test('browser state resolves colliding ids by host and prefers active rows of the same identity', () => {
  const { state } = fixture();
  state.setSessionLists([
    { hostId: 'self', active: [{ id: 'same', name: 'local' }], previous: [{ id: 'same', name: 'old local' }] },
    { hostId: 'peer', active: [{ id: 'same', name: 'remote' }] },
  ]);
  assert.equal(state.findSession('same'), undefined);
  assert.equal(state.findSession('same', 'absent'), undefined);
  assert.equal(state.findSession('same', 'self').name, 'local');
  state.setCurrentSession('same', 'peer');
  assert.equal(state.findSession('same').name, 'remote');
  assert.equal(state.sessionHostId('same'), 'peer');
  assert.equal(state.sessionHostId('unknown'), 'self');
  assert.equal(state.findSession('same', 'absent'), undefined);
});

test('browser state patches exactly one host across active, previous and selected snapshots', () => {
  const { state, renders, labels } = fixture();
  state.setSessionLists([
    { hostId: 'self', active: [{ id: 'same', name: 'local' }] },
    { hostId: 'peer', active: [{ id: 'same', name: 'remote' }], previous: [{ id: 'same', name: 'old remote' }] },
  ]);
  const selected = state.setCurrentSession('same', 'peer');
  assert.notEqual(selected, state.findSession('same', 'peer'));
  renders.length = 0;
  labels.peer = 'Renamed host';
  state.patchSession('same', { name: 'new remote' }, 'peer');
  assert.equal(state.currentSession.name, 'new remote');
  assert.equal(state.currentSession.hostLabel, 'Renamed host');
  assert.equal(state.findSession('same', 'self').name, 'local');
  assert.equal(state.sessions.previous[0].name, 'new remote');
  assert.deepEqual(renders, ['lists', 'header']);
  renders.length = 0;
  state.patchSession('same', { name: 'new local' }, 'self');
  assert.equal(state.currentSession.name, 'new remote');
  assert.deepEqual(renders, ['lists']);
});

test('browser transcript metadata stays detached from registry lists and cannot overwrite the host', () => {
  const { state, renders } = fixture();
  state.setSessionLists({ active: [{ id: 'one', name: 'registry name' }] });
  state.setCurrentSession('one');
  renders.length = 0;
  state.mergeCurrentSession('other', { name: 'wrong session' });
  assert.deepEqual(renders, []);
  state.mergeCurrentSession('one', { name: 'history name', host: 'untrusted', model: 'old model' });
  assert.equal(state.currentSession.host, 'self');
  assert.equal(state.currentSession.name, 'history name');
  assert.equal(state.findSession('one').name, 'registry name');
  assert.deepEqual(renders, ['header']);
  renders.length = 0;
  state.setSessionLists({ active: [{ id: 'one', name: 'fresh registry name' }] });
  assert.equal(state.currentSession.name, 'fresh registry name');
  assert.equal(state.currentSession.model, 'old model', 'fields absent from a poll survive in the detached selection');
  assert.notEqual(state.currentSession, state.findSession('one'));
  assert.deepEqual(renders, ['lists', 'header']);
});

test('browser state keeps selected metadata when filtered lists omit it and clears on explicit selection miss', () => {
  const { state, renders } = fixture();
  state.setSessionLists({ active: [{ id: 'one' }] });
  state.setCurrentSession('one');
  state.setSessionLists({ previous: [{ id: 'two' }] });
  assert.equal(state.currentSession.id, 'one');
  assert.equal(state.sessions.active.length, 0);
  renders.length = 0;
  assert.equal(state.setCurrentSession(null), null);
  assert.equal(state.currentSession, null);
  assert.deepEqual(renders, [], 'the selection caller owns its broader rendering/reset');
});

test('browser state stamps legacy entries once host identity becomes known and preserves qualified hosts', () => {
  const { state, identifySelf } = fixture();
  identifySelf(null);
  state.setSessionLists({ active: [{ id: 'one' }] });
  assert.equal(state.sessionHostId('one'), null);
  state.setCurrentSession('one');
  identifySelf('self');
  state.mergeCurrentSession('one', { name: 'updated' });
  assert.equal(state.currentSession.host, 'self');
  state.setSessionLists({ active: [{ id: 'two', host: 'peer' }] });
  assert.equal(state.findSession('two').host, 'peer');
});

test('browser selection generations reject stale work across same-id hosts, reloads and provisional views', () => {
  const { state } = fixture();
  state.setSessionLists([
    { hostId: 'self', active: [{ id: 'same' }] },
    { hostId: 'peer', active: [{ id: 'same' }] },
  ]);
  const first = state.advanceSelection();
  state.setCurrentSession('same', 'self');
  assert.equal(state.ownsSessionView('same', first), true);
  const peer = state.advanceSelection();
  state.setCurrentSession('same', 'peer');
  assert.equal(state.ownsSessionView('same', first), false);
  assert.equal(state.ownsSessionView('same', peer), true);
  const reload = state.advanceSelection();
  assert.equal(state.ownsSessionView('same', peer), false);
  assert.equal(state.ownsSessionView('same', reload), true);
  state.advanceSelection();
  state.setCurrentSession(null);
  assert.equal(state.ownsSessionView('same', reload), false);
});
