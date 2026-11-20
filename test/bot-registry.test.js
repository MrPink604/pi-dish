// Generated test/tool from test/bot-registry.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openBotRegistry, validateBotPatch, DEFAULT_BOT_MODEL } = require('../lib/bot-registry');
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
