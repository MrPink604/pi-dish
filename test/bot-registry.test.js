// Generated test/tool from test/bot-registry.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_events_1 = require("node:events");
const { createBotHandlers } = require('../lib/bot-handlers');
const { openBotRegistry, validateBotPatch, DEFAULT_BOT_MODEL } = require('../lib/bot-registry');
const { startBots, claimBotRelay, claimBotRelayWhenFree, deliverStartingBot, deliverToBot, liveBotRelay } = require('../lib/bot-supervisor');
const { relaySocketPath } = require('../lib/relay-socket');
const { processIdentity } = require('../lib/process-identity');
const { encodeSessionKey } = require('../lib/session-key');
function tempRegistry(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bots-'));
    const file = path.join(dir, 'bots.sqlite');
    const registry = openBotRegistry(file);
    t.after(() => { registry.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    return { registry, file };
}
test('the registry seeds Fleet once, with its first revision', t => {
    const { registry } = tempRegistry(t);
    const fleet = registry.seedFleet();
    assert.equal(fleet.name, 'Fleet');
    assert.equal(fleet.model, DEFAULT_BOT_MODEL);
    assert.equal(fleet.status, 'active');
    assert.equal(fleet.revision, 1);
    assert.match(fleet.identity, /standing contact for the hosts/);
    assert.deepEqual(registry.seedFleet(), fleet, 'a second seed returns the same bot');
    assert.equal(registry.list().length, 1);
    const [first] = registry.revisions(fleet.id);
    assert.equal(first.actor, 'pi-dish');
    assert.equal(first.before, null);
    assert.deepEqual(first.after, fleet);
});
test('an edit writes a revision holding who changed what, before and after', t => {
    const { registry } = tempRegistry(t);
    const fleet = registry.seedFleet();
    const places = [{ host: 'tycho', cwd: '/srv', label: 'tycho services' }];
    const edited = registry.update(fleet.id, { identity: 'You are Fleet.', places }, { actor: 'user' });
    assert.equal(edited.revision, 2);
    assert.deepEqual(edited.places, places);
    const revision = registry.revisions(fleet.id)[1];
    assert.deepEqual(revision.fields, ['identity', 'places']);
    assert.equal(revision.actor, 'user');
    assert.equal(revision.turn, null);
    assert.equal(revision.before?.identity, fleet.identity);
    assert.equal(revision.after.identity, 'You are Fleet.');
    assert.equal(registry.update(fleet.id, { identity: 'You are Fleet.' }, { actor: 'user' }).revision, 2, 'an edit that changes nothing writes no revision');
    const bot = registry.update(fleet.id, { name: 'Fleet', thinking: 'high' }, { actor: fleet.id, turn: 'entry:42' });
    assert.equal(bot.revision, 3);
    assert.deepEqual(registry.revisions(fleet.id)[2].fields, ['thinking']);
    assert.equal(registry.revisions(fleet.id)[2].turn, 'entry:42');
});
test('restoring a revision writes a new one, and reads see it through a read-only open', t => {
    const { registry, file } = tempRegistry(t);
    const fleet = registry.seedFleet();
    registry.update(fleet.id, { identity: 'Changed.' }, { actor: 'user' });
    const restored = registry.restore(fleet.id, 1, { actor: 'user' });
    assert.equal(restored.revision, 3);
    assert.equal(restored.identity, fleet.identity);
    assert.deepEqual(registry.revisions(fleet.id).map(revision => revision.revision), [1, 2, 3]);
    assert.throws(() => registry.restore(fleet.id, 9, { actor: 'user' }), /has no revision 9/);
    const reader = openBotRegistry(file, { readOnly: true });
    t.after(() => reader.close());
    assert.equal(reader.get(fleet.id)?.revision, 3);
    assert.equal(reader.get('missing'), null);
});
test('edits are validated: unknown fields, bad models and bad places are refused', () => {
    assert.throws(() => validateBotPatch({ nmae: 'x' }), /unknown bot fields: nmae/);
    assert.throws(() => validateBotPatch({ model: 'opus' }), /provider\/model-id/);
    assert.throws(() => validateBotPatch({ status: 'sleeping' }), /status must be one of/);
    assert.throws(() => validateBotPatch({ places: [{ cwd: '/x' }] }), /place.label/);
    assert.deepEqual(validateBotPatch({ places: [{ host: '', cwd: '/x', label: 'x' }], thinking: null }), { places: [{ host: null, cwd: '/x', label: 'x' }], thinking: null });
});
test('pi-dish starts each active bot: writes a missing mirror, then resumes its route', async (t) => {
    const { registry, file } = tempRegistry(t);
    const fleet = registry.seedFleet();
    const sessionsDir = path.join(path.dirname(file), 'sessions');
    const resumed = [];
    const logged = [];
    await startBots({ registry, sessionsDir, resume: async (id) => { resumed.push(id); }, log: line => logged.push(line) });
    const route = encodeSessionKey('bot', fleet.id);
    assert.deepEqual(resumed, [route]);
    const mirror = path.join(sessionsDir, `${fleet.id}.jsonl`);
    const header = JSON.parse(fs.readFileSync(mirror, 'utf8').split('\n')[0]);
    assert.equal(header.id, fleet.id);
    assert.deepEqual(header.bot, { name: 'Fleet' });
    const before = fs.readFileSync(mirror, 'utf8');
    // A second start leaves the mirror alone; a failed resume is logged, not thrown; a paused bot is skipped.
    await startBots({ registry, sessionsDir, resume: async () => { throw new Error('tmux is not available'); }, log: line => logged.push(line) });
    assert.equal(fs.readFileSync(mirror, 'utf8'), before);
    assert.deepEqual(logged, ['bot Fleet did not start: tmux is not available']);
    registry.update(fleet.id, { status: 'paused' }, { actor: 'user' });
    await startBots({ registry, sessionsDir, resume: async (id) => { resumed.push(id); }, log: line => logged.push(line) });
    assert.equal(resumed.length, 1);
});
test('a bot has one relay: a live holder keeps the lock and pi-dish does not start a second', async (t) => {
    const { registry, file } = tempRegistry(t);
    const fleet = registry.seedFleet();
    const botsDir = path.join(path.dirname(file), 'bots');
    const botDir = path.join(botsDir, fleet.id);
    const first = claimBotRelay(botDir, 'build-a');
    assert.equal(first.claimed, true);
    assert.deepEqual(claimBotRelay(botDir, 'build-a'), { claimed: false, holder: process.pid }, 'a second relay is refused');
    assert.deepEqual(liveBotRelay(botDir), { pid: process.pid, build: 'build-a' }, 'the lock records the build the relay started from');
    const resumed = [];
    const logged = [];
    const stale = [];
    const ports = {
        registry, botsDir, sessionsDir: path.join(path.dirname(file), 'sessions'),
        resume: async (id) => { resumed.push(id); }, log: (line) => logged.push(line),
        restartStale: (bot, holder) => { stale.push([bot.name, holder]); },
    };
    await startBots({ ...ports, build: 'build-a' });
    assert.deepEqual(resumed, [], 'a server restarted under a running relay leaves it alone');
    assert.deepEqual(stale, [], 'a relay on the same build is not restarted');
    assert.deepEqual(logged, [`bot Fleet: relay ${process.pid} is already running`]);
    // A relay from another build is handed over for a restart, and is not started a second time.
    await startBots({ ...ports, build: 'build-b' });
    assert.deepEqual(stale, [['Fleet', { pid: process.pid, build: 'build-a' }]]);
    assert.deepEqual(resumed, []);
    // So is one started before relays recorded their build.
    const held = JSON.parse(fs.readFileSync(path.join(botDir, 'relay.lock'), 'utf8'));
    fs.writeFileSync(path.join(botDir, 'relay.lock'), JSON.stringify({ pid: held.pid, startTime: held.startTime }));
    await startBots({ ...ports, build: 'build-a' });
    assert.deepEqual(stale[1], ['Fleet', { pid: process.pid, build: null }]);
    if (first.claimed)
        first.release();
    assert.equal(fs.existsSync(path.join(botDir, 'relay.lock')), false, 'release removes the lock it holds, however it was rewritten');
    // A lock left by a relay that died is taken over.
    fs.writeFileSync(path.join(botDir, 'relay.lock'), JSON.stringify({ pid: 2 ** 22 + 1, startTime: '0' }));
    const next = claimBotRelay(botDir, 'build-a');
    assert.equal(next.claimed, true);
    if (next.claimed)
        next.release();
    assert.equal(fs.existsSync(path.join(botDir, 'relay.lock')), false);
});
test('a restarted relay waits for the one it replaces to stop', async (t) => {
    const { file } = tempRegistry(t);
    const botDir = path.join(path.dirname(file), 'bots', 'fleet');
    const old = (0, node_child_process_1.spawn)(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    t.after(() => { old.kill('SIGKILL'); });
    await (0, node_events_1.once)(old, 'spawn');
    const identity = processIdentity(old.pid);
    assert.ok(identity, 'the old relay stand-in runs');
    fs.mkdirSync(botDir, { recursive: true });
    fs.writeFileSync(path.join(botDir, 'relay.lock'), JSON.stringify({ pid: identity.pid, startTime: identity.startTime, build: 'old' }));
    assert.deepEqual(await claimBotRelayWhenFree(botDir, 'new', { waitMs: 50, everyMs: 10 }), { claimed: false, holder: identity.pid }, 'a holder that does not stop keeps the lock');
    const claiming = claimBotRelayWhenFree(botDir, 'new', { waitMs: 10_000, everyMs: 10 });
    old.kill('SIGTERM');
    await (0, node_events_1.once)(old, 'exit');
    const lock = await claiming;
    assert.equal(lock.claimed, true, 'the new relay takes the lock once the old one is gone');
    assert.equal(liveBotRelay(botDir)?.build, 'new');
    if (lock.claimed)
        lock.release();
});
test('a routine\u2019s run to a bot that is not running starts it and is delivered once its relay takes it', async () => {
    const tries = [];
    let started = 0;
    // The relay takes the fourth try: the first finds no relay, the next two find one still starting.
    const deliver = async (id) => { tries.push(id); return tries.length === 4 ? { queued: false } : null; };
    const taken = await deliverStartingBot('fleet', { kind: 'routine' }, async () => { started += 1; }, { everyMs: 1, deliver });
    assert.deepEqual(taken, { queued: false });
    assert.equal(started, 1, 'started once, however many tries it took');
    assert.equal(tries.length, 4);
    // A start refused while the bot's relay restarts is tried again, and the delivery waits for the restarted relay.
    let attempts = 0;
    const refusedFirst = async () => { attempts += 1; if (attempts === 1)
        throw new Error('The session is being restarted.'); };
    let polls = 0;
    assert.deepEqual(await deliverStartingBot('fleet', {}, refusedFirst, { everyMs: 1, deliver: async () => ++polls === 5 ? { queued: true } : null }), { queued: true });
    assert.equal(attempts, 2);
    // A relay that never comes up fails the delivery.
    await assert.rejects(deliverStartingBot('fleet', {}, async () => { }, { waitMs: 5, everyMs: 1, deliver: async () => null }), /did not take the message within 0s/);
});
test('bots nest at most four levels, and a retry with the same id finds the bot it made', t => {
    const { registry } = tempRegistry(t);
    const fleet = registry.seedFleet();
    const child = registry.create({ name: 'Hosts', identity: 'You watch the hosts.', parentId: fleet.id }, { actor: fleet.id, turn: 't1' });
    assert.equal(child.model, DEFAULT_BOT_MODEL);
    assert.equal(child.status, 'active');
    assert.deepEqual(registry.revisions(child.id).map(revision => [revision.actor, revision.turn]), [[fleet.id, 't1']]);
    const id = '11111111-2222-4333-8444-555555555555';
    const grandchild = registry.create({ id, name: 'Disks', identity: 'You watch the disks.', parentId: child.id }, { actor: child.id });
    assert.deepEqual(registry.lineage(grandchild.id), [grandchild.id, child.id, fleet.id]);
    assert.deepEqual(registry.create({ id, name: 'Other', identity: 'x', parentId: child.id }, { actor: child.id }), grandchild, 'a retried create returns the bot unchanged');
    const fourth = registry.create({ name: 'SMART', identity: 'You read SMART data.', parentId: grandchild.id }, { actor: grandchild.id });
    assert.equal(registry.lineage(fourth.id).length, 4);
    assert.throws(() => registry.create({ name: 'Too deep', identity: 'x', parentId: fourth.id }, { actor: fourth.id }), /Refused: SMART is already 4 levels deep, and bots nest at most 4 levels/);
    assert.throws(() => registry.create({ name: '', identity: 'x' }, { actor: 'user' }), /name must be a non-empty string/);
    assert.equal(registry.list().length, 4);
});
test('retiring a bot archives it and moves its children up to its parent, each with a revision', t => {
    const { registry } = tempRegistry(t);
    const fleet = registry.seedFleet();
    const middle = registry.create({ name: 'Middle', identity: 'x', parentId: fleet.id }, { actor: 'user' });
    const a = registry.create({ name: 'A', identity: 'x', parentId: middle.id }, { actor: 'user' });
    const b = registry.create({ name: 'B', identity: 'x', parentId: middle.id }, { actor: 'user' });
    const { bot, moved } = registry.retire(middle.id, { actor: 'user' });
    assert.equal(bot.status, 'retired');
    assert.deepEqual(moved.map(row => [row.name, row.parentId]), [['A', fleet.id], ['B', fleet.id]]);
    assert.deepEqual(registry.revisions(a.id).at(-1)?.fields, ['parentId']);
    assert.equal(registry.get(b.id)?.parentId, fleet.id);
    // A retired top-level bot's children become top-level.
    registry.retire(fleet.id, { actor: 'user' });
    assert.equal(registry.get(a.id)?.parentId, null);
    assert.throws(() => registry.create({ name: 'C', identity: 'x', parentId: middle.id }, { actor: 'user' }), /no active bot/);
});
test('an undo restores only the fields its change touched', t => {
    const { registry } = tempRegistry(t);
    const fleet = registry.seedFleet();
    const renamed = registry.update(fleet.id, { name: 'Armada' }, { actor: fleet.id, turn: 't1' });
    registry.update(fleet.id, { thinking: 'high' }, { actor: 'user' });
    const undone = registry.restore(fleet.id, renamed.revision - 1, { actor: 'user' }, ['name']);
    assert.equal(undone.name, 'Fleet');
    assert.equal(undone.thinking, 'high', 'a later change to another field stays');
    assert.deepEqual(registry.revisions(fleet.id).at(-1)?.fields, ['name']);
});
/** A route handler's answer, through stand-ins for Express's request and response. */
async function call(handler, params, body = {}) {
    let status = 200;
    let sent;
    const res = { status(code) { status = code; return res; }, json(value) { sent = value; return res; } };
    await handler({ params, body }, res, () => { });
    return { status, body: sent };
}
test('the routes create and start a bot, refuse a bot its own model, and retire with a stop', async (t) => {
    const { registry } = tempRegistry(t);
    const fleet = registry.seedFleet();
    const started = [];
    const stopped = [];
    const handlers = createBotHandlers(() => registry, {
        route: id => `bot:${id}`,
        start: async (bot) => { started.push(bot.name); },
        stop: async (bot) => { stopped.push(bot.name); },
        deliver: async () => false,
        state: () => ({ running: false, lastTurnAt: null }),
    });
    const created = await call(handlers.create, {}, { name: 'Personal', identity: 'You are Personal.', places: [{ cwd: '~/notes', label: 'notes' }] });
    assert.equal(created.status, 201);
    const personal = created.body.bot;
    assert.deepEqual(personal.places, [{ host: null, cwd: '~/notes', label: 'notes' }]);
    assert.deepEqual(started, ['Personal']);
    const own = await call(handlers.edit, { id: fleet.id }, { by: fleet.id, turn: 't1', changes: { model: 'faux/faux-1' } });
    assert.equal(own.status, 403);
    assert.match(String(own.body.error), /cannot change your own model/);
    const stranger = await call(handlers.edit, { id: personal.id }, { by: fleet.id, changes: { name: 'Mine' } });
    assert.equal(stranger.status, 403, 'a bot outside the lineage is refused');
    const renamed = await call(handlers.edit, { id: fleet.id }, { by: fleet.id, turn: 't2', changes: { name: 'Armada' } });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.body.fields, ['name']);
    assert.equal(renamed.body.before.name, 'Fleet');
    assert.deepEqual(registry.revisions(fleet.id).at(-1)?.turn, 't2');
    const child = registry.create({ name: 'Child', identity: 'x', parentId: personal.id }, { actor: personal.id });
    const model = await call(handlers.edit, { id: child.id }, { by: personal.id, changes: { model: 'faux/faux-1' } });
    assert.equal(model.status, 200, 'a parent may change its child\u2019s model');
    assert.deepEqual([stopped, started], [['Child'], ['Personal', 'Child']], 'and the child restarts on it');
    const retired = await call(handlers.retire, { id: personal.id });
    assert.equal(retired.status, 200);
    assert.deepEqual(retired.body.moved.map(row => [row.name, row.parentId]), [['Child', null]]);
    assert.deepEqual(stopped, ['Child', 'Personal']);
    assert.equal((await call(handlers.retire, { id: personal.id })).status, 409);
});
/** The routes over a registry, recording which relays a change starts and stops. */
function routes(registry, running = {}) {
    const relays = [];
    const handlers = createBotHandlers(() => registry, {
        route: id => `bot:${id}`,
        start: async (bot) => { relays.push(`start ${bot.name}`); },
        stop: async (bot) => { relays.push(`stop ${bot.name}`); },
        deliver: async () => false,
        state: bot => ({ running: bot.id in running, lastTurnAt: running[bot.id] ?? null }),
    });
    return { handlers, relays };
}
const make = (registry, name, parentId = null) => registry.create({ name, identity: `You are ${name}.`, parentId }, { actor: 'user' });
test('a bot moves a descendant within its own subtree, and is refused outside it, for a cycle and past the nesting limit', async (t) => {
    const { registry } = tempRegistry(t);
    const chief = make(registry, 'Chief');
    const fleet = make(registry, 'Fleet', chief.id);
    const hosts = make(registry, 'Hosts', fleet.id);
    const backups = make(registry, 'Backups', chief.id);
    const nightly = make(registry, 'Nightly', backups.id);
    const tapes = make(registry, 'Tapes', nightly.id);
    const personal = make(registry, 'Personal');
    const { handlers } = routes(registry);
    const edit = (by, target, parent) => call(handlers.edit, { id: target.id }, { by: by.id, turn: `${by.id}/7`, changes: { parentId: parent.id } });
    const moved = await edit(chief, hosts, backups);
    assert.equal(moved.status, 200);
    assert.deepEqual(moved.body.lines, ['parent: Fleet → Backups']);
    assert.deepEqual(moved.body.fields, ['parentId']);
    const revision = registry.revisions(hosts.id).at(-1);
    assert.deepEqual([revision.actor, revision.turn], [chief.id, `${chief.id}/7`]);
    assert.equal((await edit(fleet, fleet, chief)).status, 403, 'a bot cannot move itself');
    assert.match(String((await edit(fleet, fleet, chief)).body.error), /cannot change your own parent/);
    const outside = await edit(chief, personal, chief);
    assert.deepEqual([outside.status, outside.body.error], [403, 'Refused: Personal is not you or one of your descendants.']);
    const up = await edit(backups, nightly, chief);
    assert.deepEqual([up.status, up.body.error], [403, 'Refused: a bot can move Nightly only under itself or one of its own descendants.'], 'not under its own ancestor');
    const cycle = await edit(chief, backups, tapes);
    assert.deepEqual([cycle.status, cycle.body.error], [400, 'Refused: Tapes is one of Backups\'s own sub-bots, so Backups cannot move under it.']);
    const deep = await edit(chief, fleet, tapes);
    assert.deepEqual([deep.status, deep.body.error], [400, 'Refused: Tapes is 4 levels deep, so Fleet would reach level 5 under it, and bots nest at most 4 levels.']);
    assert.equal(registry.get(fleet.id).parentId, chief.id, 'a refused move changes nothing');
});
test('a bot retires a descendant and brings it back: its relay stops and starts, and its sub-bots move up and back', async (t) => {
    const { registry } = tempRegistry(t);
    const chief = make(registry, 'Chief');
    const backups = make(registry, 'Backups', chief.id);
    const nightly = make(registry, 'Nightly', backups.id);
    const { handlers, relays } = routes(registry);
    const status = (by, target, value) => call(handlers.edit, { id: target.id }, { by: by.id, turn: `${by.id}/1`, changes: { status: value } });
    assert.match(String((await status(backups, backups, 'retired')).body.error), /cannot change your own status/);
    assert.equal((await status(chief, backups, 'paused')).status, 400);
    const retired = await status(chief, backups, 'retired');
    assert.equal(retired.status, 200);
    assert.deepEqual(retired.body.lines, ['status: "active" → "retired"']);
    assert.deepEqual(retired.body.moved, [{ id: nightly.id, name: 'Nightly', parentId: chief.id, parentName: 'Chief' }]);
    assert.deepEqual(relays, ['stop Backups']);
    assert.equal(registry.get(nightly.id).parentId, chief.id);
    assert.deepEqual(registry.revisions(nightly.id).at(-1).actor, chief.id);
    const back = await status(chief, backups, 'active');
    assert.equal(back.status, 200);
    assert.deepEqual(back.body.lines, ['status: "retired" → "active"']);
    assert.deepEqual(back.body.moved, [{ id: nightly.id, name: 'Nightly', parentId: backups.id, parentName: 'Backups' }]);
    assert.deepEqual(relays, ['stop Backups', 'start Backups']);
    // The chat's undo of a retire is a restore of the status, which brings the bot back the same way.
    const again = await status(chief, backups, 'retired');
    await call(handlers.restore, { id: backups.id }, { revision: Number(again.body.revision) - 1, fields: ['status'] });
    assert.equal(registry.get(backups.id).status, 'active');
    assert.equal(registry.get(nightly.id).parentId, backups.id);
    assert.deepEqual(relays, ['stop Backups', 'start Backups', 'stop Backups', 'start Backups']);
    // A sub-bot moved again since the retire stays where it is; a bot whose parent is retired waits for it.
    await status(chief, backups, 'retired');
    await call(handlers.edit, { id: nightly.id }, { by: chief.id, changes: { name: 'Nightly runs' } });
    await status(chief, backups, 'active');
    assert.equal(registry.get(nightly.id).parentId, chief.id);
    await status(chief, nightly, 'retired');
    await call(handlers.update, { id: nightly.id }, { parentId: backups.id });
    await status(chief, backups, 'retired');
    const orphan = await status(chief, nightly, 'active');
    assert.deepEqual([orphan.status, orphan.body.error], [400, 'Refused: Nightly runs\'s parent Backups is retired. Bring Backups back first, or give Nightly runs another parent as it comes back.']);
});
test('a bot sees itself, its ancestors and its descendants on the roster, with how each runs, and nothing elsewhere in the tree', async (t) => {
    const { registry } = tempRegistry(t);
    const chief = make(registry, 'Chief');
    const fleet = make(registry, 'Fleet', chief.id);
    const backups = make(registry, 'Backups', fleet.id);
    make(registry, 'Personal', chief.id);
    const other = make(registry, 'Other');
    const { handlers } = routes(registry, { [backups.id]: '2026-11-20T10:00:00.000Z' });
    const listed = await call(handlers.roster, { id: fleet.id });
    const bots = listed.body.bots;
    assert.deepEqual(bots.map(row => [row.name, row.relation, row.parentName, row.running, row.lastTurnAt]), [
        ['Chief', 'ancestor', null, false, null],
        ['Fleet', 'self', 'Chief', false, null],
        ['Backups', 'descendant', 'Fleet', true, '2026-11-20T10:00:00.000Z'],
    ], 'Personal, a sibling, and Other, another family, are not on it');
    assert.deepEqual(Object.keys(bots[2]).sort(), ['id', 'lastTurnAt', 'model', 'name', 'parentId', 'parentName', 'places', 'relation', 'revision', 'running', 'status', 'thinking']);
    assert.equal((await call(handlers.rosterShow, { id: fleet.id, bot: other.name })).status, 404);
    await call(handlers.edit, { id: backups.id }, { by: fleet.id, turn: 't', changes: { name: 'Archive' } });
    const shown = await call(handlers.rosterShow, { id: fleet.id, bot: 'archive' });
    assert.equal(shown.body.bot.identity, 'You are Backups.');
    assert.deepEqual(shown.body.revisions.map(row => [row.revision, row.by, row.changes]), [[1, 'user', ['created']], [2, 'Fleet', ['name: "Backups" → "Archive"']]]);
});
test('deliverToBot decodes multi-byte UTF-8 responses split across socket chunks', async (t) => {
    const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-sock-'));
    const prevSockDir = process.env.PI_DISH_SOCKET_DIR;
    process.env.PI_DISH_SOCKET_DIR = sockDir;
    t.after(() => {
        if (prevSockDir === undefined)
            delete process.env.PI_DISH_SOCKET_DIR;
        else
            process.env.PI_DISH_SOCKET_DIR = prevSockDir;
        fs.rmSync(sockDir, { recursive: true, force: true });
    });
    const botId = 'utf8-split-bot';
    const sockPath = relaySocketPath(botId);
    const server = net.createServer((conn) => {
        let raw = '';
        conn.on('data', (chunk) => {
            raw += chunk.toString('utf8');
            const nl = raw.indexOf('\n');
            if (nl < 0)
                return;
            const cmd = JSON.parse(raw.slice(0, nl));
            // Embed a 4-byte UTF-8 character (🚀) and split the buffer right in the middle of it.
            const payload = Buffer.from(JSON.stringify({ type: 'response', id: cmd.id, command: 'deliver', success: true, data: { queued: true, note: '🚀日本語' } }) + '\n', 'utf8');
            const emojiIdx = payload.indexOf(Buffer.from('🚀', 'utf8'));
            assert.ok(emojiIdx > 0);
            conn.write(payload.subarray(0, emojiIdx + 2));
            setTimeout(() => conn.write(payload.subarray(emojiIdx + 2)), 15);
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(sockPath, () => resolve());
    });
    t.after(() => new Promise(resolve => server.close(() => resolve())));
    const result = await deliverToBot(botId, { kind: 'routine', requestId: 'r1', text: 'hi', data: {} }, 5000);
    assert.deepEqual(result, { queued: true });
});
