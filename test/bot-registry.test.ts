import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import type { BotRegistry } from '../lib/bot-registry';
const { openBotRegistry, validateBotPatch, DEFAULT_BOT_MODEL }: typeof import('../lib/bot-registry') = require('../lib/bot-registry');
const { startBots, claimBotRelay }: typeof import('../lib/bot-supervisor') = require('../lib/bot-supervisor');
const { encodeSessionKey }: typeof import('../lib/session-key') = require('../lib/session-key');

function tempRegistry(t: test.TestContext): { registry: BotRegistry; file: string } {
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

  assert.equal(registry.update(fleet.id, { identity: 'You are Fleet.' }, { actor: 'user' }).revision, 2,
    'an edit that changes nothing writes no revision');
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
  assert.deepEqual(validateBotPatch({ places: [{ host: '', cwd: '/x', label: 'x' }], thinking: null }),
    { places: [{ host: null, cwd: '/x', label: 'x' }], thinking: null });
});

test('pi-dish starts each active bot: writes a missing mirror, then resumes its route', async t => {
  const { registry, file } = tempRegistry(t);
  const fleet = registry.seedFleet();
  const sessionsDir = path.join(path.dirname(file), 'sessions');
  const resumed: string[] = [];
  const logged: string[] = [];
  await startBots({ registry, sessionsDir, resume: async id => { resumed.push(id); }, log: line => logged.push(line) });
  const route = encodeSessionKey('bot', fleet.id as Parameters<typeof encodeSessionKey>[1]);
  assert.deepEqual(resumed, [route]);
  const mirror = path.join(sessionsDir, `${fleet.id}.jsonl`);
  const header = JSON.parse(fs.readFileSync(mirror, 'utf8').split('\n')[0]) as Record<string, unknown>;
  assert.equal(header.id, fleet.id);
  assert.deepEqual(header.bot, { name: 'Fleet' });
  const before = fs.readFileSync(mirror, 'utf8');

  // A second start leaves the mirror alone; a failed resume is logged, not thrown; a paused bot is skipped.
  await startBots({ registry, sessionsDir, resume: async () => { throw new Error('tmux is not available'); }, log: line => logged.push(line) });
  assert.equal(fs.readFileSync(mirror, 'utf8'), before);
  assert.deepEqual(logged, ['bot Fleet did not start: tmux is not available']);
  registry.update(fleet.id, { status: 'paused' }, { actor: 'user' });
  await startBots({ registry, sessionsDir, resume: async id => { resumed.push(id); }, log: line => logged.push(line) });
  assert.equal(resumed.length, 1);
});

test('a bot has one relay: a live holder keeps the lock and pi-dish does not start a second', async t => {
  const { registry, file } = tempRegistry(t);
  const fleet = registry.seedFleet();
  const botsDir = path.join(path.dirname(file), 'bots');
  const botDir = path.join(botsDir, fleet.id);

  const first = claimBotRelay(botDir);
  assert.equal(first.claimed, true);
  assert.deepEqual(claimBotRelay(botDir), { claimed: false, holder: process.pid }, 'a second relay is refused');

  const resumed: string[] = [];
  const logged: string[] = [];
  await startBots({ registry, botsDir, sessionsDir: path.join(path.dirname(file), 'sessions'),
    resume: async id => { resumed.push(id); }, log: line => logged.push(line) });
  assert.deepEqual(resumed, [], 'a server restarted under a running relay leaves it alone');
  assert.deepEqual(logged, [`bot Fleet: relay ${process.pid} is already running`]);

  if (first.claimed) first.release();
  // A lock left by a relay that died is taken over.
  fs.writeFileSync(path.join(botDir, 'relay.lock'), JSON.stringify({ pid: 2 ** 22 + 1, startTime: '0' }));
  const next = claimBotRelay(botDir);
  assert.equal(next.claimed, true);
  if (next.claimed) next.release();
  assert.equal(fs.existsSync(path.join(botDir, 'relay.lock')), false);
});
