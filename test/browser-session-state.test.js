const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
const { createSessionState } = context.PiDishBrowser;

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

test('browser lookups without a session id tolerate an empty selection', () => {
  const { state } = fixture();
  assert.equal(state.findSession(), undefined);
  assert.equal(state.sessionHostId(), 'self');
  state.setSessionLists({ active: [{ id: 'one' }] });
  assert.equal(state.findSession(), undefined);
  assert.equal(state.sessionHostId(), 'self');
});

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
  const owner = state.captureSelection();
  renders.length = 0;
  state.mergeCurrentSession({ ...owner, id: 'other' }, { name: 'wrong session' });
  assert.deepEqual(renders, []);
  state.mergeCurrentSession(owner, { id: 'wrong-id', name: 'history name', host: 'untrusted', model: 'old model' });
  assert.equal(state.currentSession.id, 'one');
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

test('browser state stamps discovered host identity and rejects peer-provided host claims', () => {
  const { state, identifySelf } = fixture();
  identifySelf(null);
  state.setSessionLists({ active: [{ id: 'one' }] });
  assert.equal(state.sessionHostId('one'), null);
  state.setCurrentSession('one');
  identifySelf('self');
  state.mergeCurrentSession(state.captureSelection(), { name: 'updated' });
  assert.equal(state.currentSession.host, 'self');
  state.setSessionLists({ active: [{ id: 'two', host: 'peer' }] });
  assert.equal(state.findSession('two').host, 'self');
  state.setSessionLists([{ hostId: 'peer', active: [{ id: 'two', host: 'self', hostLabel: 'forged' }] }]);
  assert.equal(state.findSession('two', 'peer').hostLabel, 'Other host');
});

test('browser selection generations reject stale work across same-id hosts, reloads and provisional views', () => {
  const { state } = fixture();
  state.setSessionLists([
    { hostId: 'self', active: [{ id: 'same' }] },
    { hostId: 'peer', active: [{ id: 'same' }] },
  ]);
  state.advanceSelection();
  state.setCurrentSession('same', 'self');
  const first = state.captureSelection();
  assert.equal(state.ownsSelection(first), true);
  state.advanceSelection();
  state.setCurrentSession('same', 'peer');
  const peer = state.captureSelection();
  assert.equal(state.ownsSelection(first), false);
  assert.equal(state.ownsSelection(peer), true);
  state.advanceSelection();
  const reload = state.captureSelection();
  assert.equal(state.ownsSelection(peer), false);
  assert.equal(state.ownsSelection(reload), true);
  state.advanceSelection();
  state.setCurrentSession(null);
  assert.equal(state.ownsSelection(reload), false);
});

test('captured browser ownership is immutable and distinguishes hosts even within the same generation', () => {
  const { state } = fixture();
  assert.equal(state.captureSelection(), null);
  assert.equal(state.ownsSelection(null), false);
  state.setSessionLists([
    { hostId: 'self', active: [{ id: 'same' }] },
    { hostId: 'peer', active: [{ id: 'same' }] },
  ]);
  state.setCurrentSession('same', 'self');
  const owner = state.captureSelection();
  assert.deepEqual({ ...owner }, { id: 'same', host: 'self', generation: 0 });
  assert.equal(Object.isFrozen(owner), true);
  assert.equal(Reflect.set(owner, 'host', 'peer'), false);
  state.patchSession('same', { name: 'fresh metadata' }, 'self');
  assert.equal(state.ownsSelection(owner), true);
  state.setCurrentSession('same', 'peer');
  assert.equal(state.ownsSelection(owner), false, 'host identity is checked independently of generation');
  assert.equal(owner.host, 'self');
});

test('transcript merges reject stale ownership after host switches and same-session reloads', () => {
  const { state, renders } = fixture();
  state.setSessionLists([
    { hostId: 'self', active: [{ id: 'same', name: 'local' }] },
    { hostId: 'peer', active: [{ id: 'same', name: 'remote' }] },
  ]);
  state.setCurrentSession('same', 'self');
  const local = state.captureSelection();
  state.setCurrentSession('same', 'peer');
  renders.length = 0;
  state.mergeCurrentSession(local, { name: 'stale local' });
  assert.equal(state.currentSession.name, 'remote');
  const peer = state.captureSelection();
  state.advanceSelection();
  state.mergeCurrentSession(peer, { name: 'stale remote' });
  assert.equal(state.currentSession.name, 'remote');
  assert.deepEqual(renders, []);
  state.mergeCurrentSession(state.captureSelection(), { name: 'current remote' });
  assert.equal(state.currentSession.name, 'current remote');
  assert.deepEqual(renders, ['header']);
});

test('state writers filter identity, capability, family and extras independently of permitted metadata', () => {
  const { state } = fixture();
  const extras = { custom: { name: 'extension name' } };
  state.setSessionLists([{ hostId: 'peer', active: [{ id: 'one', name: 'live', model: 'p/m', isActive: true, capabilities: { resume: false }, parentId: 'parent', extras }] }]);
  state.setCurrentSession('one', 'peer');
  state.patchSession('one', { name: '', id: 'other', host: 'self', extras: { replaced: true }, capabilities: { resume: true }, parentId: null, isActive: false, turnInProgress: true }, 'peer');
  assert.equal(state.currentSession.name, '');
  assert.equal(state.currentSession.id, 'one');
  assert.equal(state.currentSession.host, 'peer');
  assert.equal(state.currentSession.extras, extras);
  assert.equal(state.currentSession.capabilities.resume, false);
  assert.equal(state.currentSession.parentId, 'parent');
  assert.equal(state.currentSession.isActive, true);
  assert.equal(state.currentSession.turnInProgress, undefined);
  state.patchSessionActivity('one', { turnInProgress: false, compacting: true, name: 'not activity', isActive: false }, 'peer');
  assert.equal(state.currentSession.name, '');
  assert.equal(state.currentSession.turnInProgress, false);
  assert.equal(state.currentSession.compacting, true);
  assert.equal(state.currentSession.isActive, true);
  state.mergeCurrentSession(state.captureSelection(), { name: null, model: null, lastActivity: 0, contextTokens: 0, isActive: false, thinkingLevel: 'high', compacting: false, harnessId: 'forged', parentId: null, capabilities: { resume: true }, extras: {} });
  assert.equal(state.currentSession.name, null);
  assert.equal(state.currentSession.model, null);
  assert.equal(state.currentSession.lastActivity, 0);
  assert.equal(state.currentSession.contextTokens, 0);
  assert.equal(state.currentSession.isActive, false);
  assert.equal(state.currentSession.thinkingLevel, undefined);
  assert.equal(state.currentSession.compacting, true);
  assert.equal(state.currentSession.harnessId, undefined);
  assert.equal(state.currentSession.parentId, 'parent');
  assert.equal(state.currentSession.capabilities.resume, false);
  assert.equal(state.currentSession.extras, extras);
  assert.equal(state.findSession('one', 'peer').isActive, true);
  assert.equal(state.findSession('one', 'peer').model, 'p/m');
  assert.throws(() => state.patchSession('one', { model: 123 }, 'peer'), /Invalid session patch/);
  assert.throws(() => state.patchSessionActivity('one', { compacting: 'yes' }, 'peer'), /Invalid session patch/);
});

test('list replacement and detached selection preserve omission without swallowing explicit null or false', () => {
  const { state } = fixture();
  state.setSessionLists({ active: [{ id: 'one', name: 'original', model: 'p/m', cwd: '/work', turnInProgress: true }] });
  state.setCurrentSession('one');
  state.setSessionLists({ active: [{ id: 'one', name: null, cwd: '', turnInProgress: false, contextPercent: 0 }] });
  assert.equal(state.findSession('one').model, undefined);
  assert.equal(state.currentSession.model, 'p/m');
  assert.equal(state.currentSession.name, null);
  assert.equal(state.currentSession.cwd, '');
  assert.equal(state.currentSession.turnInProgress, false);
  assert.equal(state.currentSession.contextPercent, 0);
});
