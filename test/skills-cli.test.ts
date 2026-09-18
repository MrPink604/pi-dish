/**
 * End-to-end tests for the pi-dish-sessions CLI against a real server.
 *
 * Boot pattern is test/server.test.js's: HOME is pointed at a temp dir holding
 * fixture session JSONL *before* server.js loads, so both the historical scan
 * and the bridge registry read the fixtures. The CLI is then run as a real
 * child process with PI_DISH_URL aimed at that server — what is under test is
 * the binary an agent actually invokes, including its exit codes and stderr.
 *
 * Run with: npm test
 */
import test = require('node:test');
import { errorMessage, present, record, records } from './test-types.js';
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-skills-cli-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
// Keep a tmux session enclosing `npm test` out of the runtime probes.
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-skills-cli-tmux-'));

const CLI = path.join(__dirname, '..', 'skills', 'pi-dish-sessions', 'scripts', 'pi-dish-sessions.js');

const UNIQUE_ID = '2026-08-24T09-00-00-uniq0001';
const AMBIGUOUS_A = '2026-08-25T09-00-00-ambi0001';
const AMBIGUOUS_B = '2026-08-25T09-00-00-ambi0002';
const AMBIGUOUS_PREFIX = '2026-08-25T09';

const sessionDir = path.join(tmpHome, '.pi', 'agent', 'sessions', '--home-user-skillproj--');
fs.mkdirSync(sessionDir, { recursive: true });

function writeSession(id: string, entries: unknown[]) {
  fs.writeFileSync(path.join(sessionDir, `${id}.jsonl`), entries.map((entry: unknown) => JSON.stringify(entry)).join('\n') + '\n');
}

writeSession(UNIQUE_ID, [
  { type: 'session', cwd: '/home/user/skillproj', timestamp: '2026-08-24T09:00:00.000Z' },
  { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'investigate the zarquon index stall' }], timestamp: '2026-08-24T09:00:01.000Z' } },
  { type: 'message', message: { role: 'assistant', content: [
    { type: 'thinking', thinking: 'secret deliberation about zarquon' },
    { type: 'text', text: 'The stall is a torn tail in the append buffer.' },
    { type: 'toolCall', id: 'tc1', name: 'bash', arguments: { command: 'tail -n 3 index.ndjson' } },
  ], timestamp: '2026-08-24T09:00:02.000Z' } },
  { type: 'message', message: { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'ndjson line one\nndjson line two' }], timestamp: '2026-08-24T09:00:03.000Z' } },
]);

for (const id of [AMBIGUOUS_A, AMBIGUOUS_B]) {
  writeSession(id, [
    { type: 'session', cwd: '/home/user/skillproj', timestamp: '2026-08-25T09:00:00.000Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: `shared prefix fixture ${id}` }], timestamp: '2026-08-25T09:00:01.000Z' } },
  ]);
}

const SHARED_UUID = '01a070d2-43fb-7360-aaba-a4ddf8d1deb0';
const REFERENCE_FIXTURES: Array<readonly [string, string, string]> = [
  ['pi', 'route-hit', 'Pi alias owner'],
  ['omp', 'route-hit', 'OMP alias collision'],
  ['omp', `2026-09-05T09-07-03-291Z_${SHARED_UUID}`, 'Shared UUID morning'],
  ['omp', `2026-09-06T09-07-03-291Z_${SHARED_UUID}`, 'Shared UUID next day'],
  ['omp', '2026-09-07T09-07-03-291Z_01a07264-131e-74a7-979a-1e763bf12b97', 'Ordinary UUID'],
];
for (const [harness, id, name] of REFERENCE_FIXTURES) {
  const dir = path.join(tmpHome, `.${harness}`, 'agent', 'sessions', 'references');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), [
    { type: 'session', version: 3, id, cwd: '/home/user/skillproj', timestamp: '2026-09-07T09:07:03.291Z' },
    { type: 'session_info', name },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: name }] } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
}

const server: import('node:http').Server = require('../server.js');

let base = '';
test.before(async () => {
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server lacks TCP address');
  base = `http://127.0.0.1:${address.port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: tmpHome, PI_DISH_URL: base };
  delete env.PI_DISH_TOKEN;
  delete env.PI_DISH_SESSION_ID;
  return env;
}

function run(args: string[]) {
  return execFileAsync(process.execPath, [CLI, ...args], { env: cliEnv() });
}

// The index builds in the background; a first request can legitimately serve a
// partial list. Retry until the fixtures are all indexed rather than sleeping.
async function settleIndex() {
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${base}/api/sessions`);
    const body = record(await res.json());
    const previous = Array.isArray(body.previous) ? body.previous : [];
    if (!body.indexing && previous.length >= 3 + REFERENCE_FIXTURES.length) return;
  }
  throw new Error('fixture sessions never finished indexing');
}

test('the index settles so refs and search have a full corpus', async () => {
  await settleIndex();
});

test('resolve expands a unique prefix to the full id', async () => {
  const { stdout } = await run(['resolve', '2026-08-24']);
  const lines = stdout.trim().split('\n');
  assert.equal(lines[0], UNIQUE_ID, 'the full id is the first line, ready to paste');
  assert.match(stdout, /^host: \(self\)$/m);
  assert.match(stdout, /^cwd: \/home\/user\/skillproj$/m);
  assert.match(stdout, /^state: inactive$/m);

  const parsed = record(JSON.parse((await run(['resolve', '2026-08-24', '--json'])).stdout));
  assert.equal(parsed.id, UNIQUE_ID);
  assert.equal(parsed.host, null, 'a local ref carries no proxy segment');
  assert.equal(record(parsed.session).cwd, '/home/user/skillproj');
});

test('an exact id and a self/ ref resolve to themselves', async () => {
  assert.equal((await run(['resolve', UNIQUE_ID])).stdout.split('\n')[0], UNIQUE_ID);
  assert.equal((await run(['resolve', `self/${UNIQUE_ID}`])).stdout.split('\n')[0], UNIQUE_ID);
});

test('every host-qualified ref form reaches this host, and unknown ones do not', async () => {
  const identity = record(await (await fetch(`${base}/api/host`)).json());
  const label = String(identity.label), hostId = String(identity.hostId);
  const first = async (ref: string) => (await run(['resolve', ref])).stdout.split('\n')[0];

  // Label (case-insensitive), full host uuid, uuid prefix, and the
  // hostId:sessionId provenance form all name *this* host.
  assert.equal(await first(`${label}/2026-08-24`), UNIQUE_ID);
  assert.equal(await first(`${label.toUpperCase()}/2026-08-24`), UNIQUE_ID);
  assert.equal(await first(`${hostId}/2026-08-24`), UNIQUE_ID);
  assert.equal(await first(`${hostId.slice(0, 8)}/2026-08-24`), UNIQUE_ID);
  assert.equal(await first(`${hostId}:${UNIQUE_ID}`), UNIQUE_ID);
  assert.equal(record(JSON.parse((await run(['resolve', `${label}/2026-08-24`, '--json'])).stdout)).host, null,
    'this host resolves to local, never to a proxy segment');

  // The provenance form carries a whole id by construction; prefix matching
  // there would silently retarget a stale reference.
  await assert.rejects(run(['resolve', `${hostId}:2026-08-24`]), (error: unknown) => {
    assert.match(errorMessage(error), /Session not found/);
    return true;
  });

  await assert.rejects(run(['resolve', 'nosuchhost/2026-08-24']), (error: unknown) => {
    const message = errorMessage(error);
    assert.match(message, /unknown host "nosuchhost"/);
    assert.match(message, /run 'hosts' to list the fleet/);
    return true;
  });

  // A ref that names a host and a --host flag that names another is a
  // contradiction, not a precedence puzzle.
  await assert.rejects(run(['resolve', `self/${UNIQUE_ID}`, '--host', 'elsewhere']), (error: unknown) => {
    assert.match(errorMessage(error), /names host "self" but --host elsewhere was also given/);
    return true;
  });
});

test('an ambiguous prefix fails with the candidates listed', async () => {
  await assert.rejects(
    run(['resolve', AMBIGUOUS_PREFIX]),
    (error: unknown) => {
      const detail = record(error);
      assert.equal(detail.code, 1, 'a ref that cannot be resolved is an error, not an empty result');
      const message = errorMessage(error);
      assert.match(message, /ambiguous session id prefix/);
      assert.ok(message.includes(AMBIGUOUS_A), 'both candidates are named');
      assert.ok(message.includes(AMBIGUOUS_B));
      return true;
    },
  );
});

test('printed references preserve admitted Pi/OMP identity and avoid shared UUID ambiguity', async () => {
  const listed = (await run(['list'])).stdout.split('\n').map(line => line.split('\t'));
  const client: typeof import('../skills/lib/pi-dish-client.js') = require('../skills/lib/pi-dish-client.js')
  for (const [harness, native, name] of REFERENCE_FIXTURES) {
    const id = harness === 'pi' ? native : '~sk1_' + Buffer.from(JSON.stringify([harness, native])).toString('base64url');
    const row = listed.find(columns => columns[2] === name);
    assert.ok(row, `missing discovered fixture ${name}`);
    const printedRef = present(row[0]);
    assert.equal(record(JSON.parse((await run(['resolve', printedRef, '--json'])).stdout)).id, id, name);
    assert.equal(record(await client.resolveSessionClientSide(base, null, printedRef)).id, id, name);
    const reply = record(await (await fetch(`${base}/api/sessions/resolve?id=${encodeURIComponent(id)}`)).json());
    const roundTrip = record(await (await fetch(`${base}/api/sessions/resolve?id=${encodeURIComponent(String(reply.ref))}`)).json());
    assert.equal(record(roundTrip.session).id, id, name);
    if (name === 'Ordinary UUID') assert.equal(printedRef, '01a07264');
  }
  const ambiguous = await fetch(`${base}/api/sessions/resolve?id=${SHARED_UUID}`);
  assert.equal(ambiguous.status, 409);
  const ambiguousBody = record(await ambiguous.json());
  assert.deepEqual(records(ambiguousBody.matches).map(row => row.name).sort(), ['Shared UUID morning', 'Shared UUID next day']);
  await assert.rejects(run(['resolve', SHARED_UUID]), (error: unknown) => record(error).code === 1 && /ambiguous/.test(errorMessage(error)));
});

test('a prefix shorter than the minimum is rejected', async () => {
  await assert.rejects(run(['resolve', '20']), (error: unknown) => {
    assert.match(errorMessage(error), /at least 4 characters/);
    return true;
  });
});

test('read renders a transcript from a prefix ref', async () => {
  const { stdout } = await run(['read', '2026-08-24']);
  // Banner
  assert.match(stdout, /^# .+ \(2026-08-24T0\)/m);
  assert.ok(stdout.includes(`- id: ${UNIQUE_ID}`));
  assert.match(stdout, /- cwd: \/home\/user\/skillproj/);
  assert.match(stdout, /- state: inactive/);
  // Prose verbatim, both sides of the conversation
  assert.ok(stdout.includes('investigate the zarquon index stall'));
  assert.ok(stdout.includes('The stall is a torn tail in the append buffer.'));
  // Tool call one-liner, tool result body
  assert.match(stdout, /⚙ bash: command=tail -n 3 index\.ndjson/);
  assert.ok(stdout.includes('ndjson line one'));
  // Thinking is off by default and on with the flag.
  assert.equal(stdout.includes('secret deliberation about zarquon'), false);
  const withThinking = await run(['read', '2026-08-24', '--thinking']);
  assert.ok(withThinking.stdout.includes('secret deliberation about zarquon'));
});

test('read prints the exact invocation that pages further back, and it works', async () => {
  const first = await run(['read', '2026-08-24', '--limit', '2']);
  const hint = present(first.stdout.trim().split('\n').at(-1));
  assert.match(hint, /^— 1 older message\. Page back with: read 2026-08-24 --limit 2 --before 1$/);
  // The banner's session name is derived from the first user turn, so look at
  // the message sections only.
  const body = (out: string) => out.slice(out.indexOf('\n## '));
  assert.equal(body(first.stdout).includes('investigate the zarquon index stall'), false, 'the oldest turns are off this page');

  // Replaying the printed command verbatim is the contract.
  const command = hint.slice(hint.indexOf('read ')).split(' ');
  const older = await run(command);
  assert.ok(body(older.stdout).includes('investigate the zarquon index stall'));
});

test('show returns the same window as raw JSON', async () => {
  const shown = record(JSON.parse((await run(['show', '2026-08-24', '--limit', '5'])).stdout));
  assert.equal(record(shown.session).id, UNIQUE_ID);
  assert.ok(records(shown.messages).some(message => records(message.content).some(block => block.text === 'investigate the zarquon index stall')));
});

test('search finds the fixture session by a term from its transcript', async () => {
  const { stdout } = await run(['search', 'zarquon']);
  assert.ok(stdout.includes(UNIQUE_ID), stdout);
  assert.match(stdout, /\tinactive\t/);

  const parsed = record(JSON.parse((await run(['search', 'zarquon', '--json'])).stdout));
  assert.ok(records(parsed.results).some(result => result.id === UNIQUE_ID));
});

test('search rejects --all-hosts together with --host', async () => {
  await assert.rejects(run(['search', 'zarquon', '--all-hosts', '--host', 'nope']), (error: unknown) => {
    assert.match(errorMessage(error), /mutually exclusive/);
    return true;
  });
});

test('search --all-hosts works on a fleet of one', async () => {
  const { stdout } = await run(['search', 'zarquon', '--all-hosts']);
  assert.match(stdout, new RegExp(`^\\(self\\)\t${UNIQUE_ID}`, 'm'), 'rows are prefixed with their host');

  const parsed = record(JSON.parse((await run(['search', 'zarquon', '--all-hosts', '--json'])).stdout));
  assert.equal(record(record(parsed.hosts)['(self)']).status, 'ok');
  assert.ok(records(parsed.results).some(result => result.id === UNIQUE_ID && result.host === '(self)'));
});

test('docs lists the topics this server actually ships', async () => {
  const { stdout } = await run(['docs']);
  for (const topic of ['refs', 'sessions', 'search', 'fleet', 'routines']) {
    assert.match(stdout, new RegExp(`^${topic} — `, 'm'), `${topic} is listed`);
  }
  const parsed = record(JSON.parse((await run(['docs', '--json'])).stdout));
  assert.deepEqual(records(parsed.topics).map(topic => topic.name).sort(), ['fleet', 'refs', 'routines', 'search', 'sessions']);
});

test('docs <topic> prints the raw markdown', async () => {
  const { stdout } = await run(['docs', 'refs']);
  assert.match(stdout, /^# Session refs/m);
  assert.ok(stdout.includes('hostId'), 'the ref grammar itself is in the doc');
});

test('an unknown docs topic names the ones that exist', async () => {
  await assert.rejects(run(['docs', 'nosuchtopic']), (error: unknown) => {
    const message = errorMessage(error);
    assert.match(message, /unknown docs topic "nosuchtopic"/);
    assert.match(message, /available: .*refs/);
    return true;
  });
});

test('global help explains refs, lists commands and points at docs', async () => {
  for (const argv of [['--help'], ['-h'], ['help']]) {
    const { stdout } = await run(argv);
    assert.match(stdout, /Usage: pi-dish-sessions <command>/);
    assert.match(stdout, /Session refs/);
    assert.match(stdout, /host-qualified/);
    assert.match(stdout, /<hostId>:<sessionId>/);
    assert.match(stdout, /^\s+read\s+/m);
    assert.match(stdout, /^\s+search\s+/m);
    assert.match(stdout, /--host NAME/);
    assert.match(stdout, /docs.*refs, search grammar, fleet, session control/);
  }
});

test('per-command help carries usage, flags and a worked example', async () => {
  for (const argv of [['help', 'read'], ['read', '--help']]) {
    const { stdout } = await run(argv);
    assert.match(stdout, /Usage: read <ref>/);
    assert.match(stdout, /--thinking/);
    assert.match(stdout, /--before INDEX/);
    assert.match(stdout, /Example:/);
  }
  // Aliases resolve to the command they alias.
  assert.match((await run(['help', 'abort'])).stdout, /Usage: interrupt <ref>/);
});

test('an unknown command errors and points at the command list', async () => {
  await assert.rejects(run(['frobnicate']), (error: unknown) => {
    const detail = record(error), message = errorMessage(error);
    assert.equal(detail.code, 1);
    assert.match(message, /unknown command: frobnicate/);
    assert.match(message, /--help/);
    return true;
  });
  await assert.rejects(run(['help', 'frobnicate']), (error: unknown) => {
    assert.match(errorMessage(error), /unknown command: frobnicate/);
    return true;
  });
});

test('a ref for a session that does not exist is a plain not-found', async () => {
  await assert.rejects(run(['read', 'zzzz-no-such-session']), (error: unknown) => {
    const message = errorMessage(error);
    assert.match(message, /Session not found|not found/i);
    assert.equal(/unknown host/.test(message), false);
    return true;
  });
});

export {};
