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
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

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

function writeSession(id, entries) {
  fs.writeFileSync(path.join(sessionDir, `${id}.jsonl`), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
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

const server = require('../server.js');

let base;
test.before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function cliEnv() {
  const env = { ...process.env, HOME: tmpHome, PI_DISH_URL: base };
  delete env.PI_DISH_TOKEN;
  delete env.PI_DISH_SESSION_ID;
  return env;
}

function run(args) {
  return execFileAsync(process.execPath, [CLI, ...args], { env: cliEnv() });
}

// The index builds in the background; a first request can legitimately serve a
// partial list. Retry until the fixtures are all indexed rather than sleeping.
async function settleIndex() {
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${base}/api/sessions`);
    const body = await res.json();
    if (!body.indexing && (body.previous || []).length >= 3) return;
    await new Promise((r) => setTimeout(r, 50));
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

  const parsed = JSON.parse((await run(['resolve', '2026-08-24', '--json'])).stdout);
  assert.equal(parsed.id, UNIQUE_ID);
  assert.equal(parsed.host, null, 'a local ref carries no proxy segment');
  assert.equal(parsed.session.cwd, '/home/user/skillproj');
});

test('an exact id and a self/ ref resolve to themselves', async () => {
  assert.equal((await run(['resolve', UNIQUE_ID])).stdout.split('\n')[0], UNIQUE_ID);
  assert.equal((await run(['resolve', `self/${UNIQUE_ID}`])).stdout.split('\n')[0], UNIQUE_ID);
});

test('every host-qualified ref form reaches this host, and unknown ones do not', async () => {
  const identity = await (await fetch(`${base}/api/host`)).json();
  const first = async (ref) => (await run(['resolve', ref])).stdout.split('\n')[0];

  // Label (case-insensitive), full host uuid, uuid prefix, and the
  // hostId:sessionId provenance form all name *this* host.
  assert.equal(await first(`${identity.label}/2026-08-24`), UNIQUE_ID);
  assert.equal(await first(`${identity.label.toUpperCase()}/2026-08-24`), UNIQUE_ID);
  assert.equal(await first(`${identity.hostId}/2026-08-24`), UNIQUE_ID);
  assert.equal(await first(`${identity.hostId.slice(0, 8)}/2026-08-24`), UNIQUE_ID);
  assert.equal(await first(`${identity.hostId}:${UNIQUE_ID}`), UNIQUE_ID);
  assert.equal(JSON.parse((await run(['resolve', `${identity.label}/2026-08-24`, '--json'])).stdout).host, null,
    'this host resolves to local, never to a proxy segment');

  // The provenance form carries a whole id by construction; prefix matching
  // there would silently retarget a stale reference.
  await assert.rejects(run(['resolve', `${identity.hostId}:2026-08-24`]), (e) => {
    assert.match(e.stderr, /Session not found/);
    return true;
  });

  await assert.rejects(run(['resolve', 'nosuchhost/2026-08-24']), (e) => {
    assert.match(e.stderr, /unknown host "nosuchhost"/);
    assert.match(e.stderr, /run 'hosts' to list the fleet/);
    return true;
  });

  // A ref that names a host and a --host flag that names another is a
  // contradiction, not a precedence puzzle.
  await assert.rejects(run(['resolve', `self/${UNIQUE_ID}`, '--host', 'elsewhere']), (e) => {
    assert.match(e.stderr, /names host "self" but --host elsewhere was also given/);
    return true;
  });
});

test('an ambiguous prefix fails with the candidates listed', async () => {
  await assert.rejects(
    run(['resolve', AMBIGUOUS_PREFIX]),
    (e) => {
      assert.equal(e.code, 1, 'a ref that cannot be resolved is an error, not an empty result');
      assert.match(e.stderr, /ambiguous session id prefix/);
      assert.ok(e.stderr.includes(AMBIGUOUS_A), 'both candidates are named');
      assert.ok(e.stderr.includes(AMBIGUOUS_B));
      return true;
    },
  );
});

test('a prefix shorter than the minimum is rejected', async () => {
  await assert.rejects(run(['resolve', '20']), (e) => {
    assert.match(e.stderr, /at least 4 characters/);
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
  const hint = first.stdout.trim().split('\n').at(-1);
  assert.match(hint, /^— 1 older message\. Page back with: read 2026-08-24 --limit 2 --before 1$/);
  // The banner's session name is derived from the first user turn, so look at
  // the message sections only.
  const body = (out) => out.slice(out.indexOf('\n## '));
  assert.equal(body(first.stdout).includes('investigate the zarquon index stall'), false, 'the oldest turns are off this page');

  // Replaying the printed command verbatim is the contract.
  const command = hint.slice(hint.indexOf('read ')).split(' ');
  const older = await run(command);
  assert.ok(body(older.stdout).includes('investigate the zarquon index stall'));
});

test('show returns the same window as raw JSON', async () => {
  const shown = JSON.parse((await run(['show', '2026-08-24', '--limit', '5'])).stdout);
  assert.equal(shown.session.id, UNIQUE_ID);
  assert.ok(shown.messages.some((m) => (m.content || []).some((b) => b.text === 'investigate the zarquon index stall')));
});

test('search finds the fixture session by a term from its transcript', async () => {
  const { stdout } = await run(['search', 'zarquon']);
  assert.ok(stdout.includes(UNIQUE_ID), stdout);
  assert.match(stdout, /\tinactive\t/);

  const parsed = JSON.parse((await run(['search', 'zarquon', '--json'])).stdout);
  assert.ok(parsed.results.some((r) => r.id === UNIQUE_ID));
});

test('search rejects --all-hosts together with --host', async () => {
  await assert.rejects(run(['search', 'zarquon', '--all-hosts', '--host', 'nope']), (e) => {
    assert.match(e.stderr, /mutually exclusive/);
    return true;
  });
});

test('search --all-hosts works on a fleet of one', async () => {
  const { stdout } = await run(['search', 'zarquon', '--all-hosts']);
  assert.match(stdout, new RegExp(`^\\(self\\)\t${UNIQUE_ID}`, 'm'), 'rows are prefixed with their host');

  const parsed = JSON.parse((await run(['search', 'zarquon', '--all-hosts', '--json'])).stdout);
  assert.equal(parsed.hosts['(self)'].status, 'ok');
  assert.ok(parsed.results.some((r) => r.id === UNIQUE_ID && r.host === '(self)'));
});

test('docs lists the topics this server actually ships', async () => {
  const { stdout } = await run(['docs']);
  for (const topic of ['refs', 'sessions', 'search', 'fleet', 'routines']) {
    assert.match(stdout, new RegExp(`^${topic} — `, 'm'), `${topic} is listed`);
  }
  const parsed = JSON.parse((await run(['docs', '--json'])).stdout);
  assert.deepEqual(parsed.topics.map((t) => t.name).sort(), ['fleet', 'refs', 'routines', 'search', 'sessions']);
});

test('docs <topic> prints the raw markdown', async () => {
  const { stdout } = await run(['docs', 'refs']);
  assert.match(stdout, /^# Session refs/m);
  assert.ok(stdout.includes('hostId'), 'the ref grammar itself is in the doc');
});

test('an unknown docs topic names the ones that exist', async () => {
  await assert.rejects(run(['docs', 'nosuchtopic']), (e) => {
    assert.match(e.stderr, /unknown docs topic "nosuchtopic"/);
    assert.match(e.stderr, /available: .*refs/);
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
  await assert.rejects(run(['frobnicate']), (e) => {
    assert.equal(e.code, 1);
    assert.match(e.stderr, /unknown command: frobnicate/);
    assert.match(e.stderr, /--help/);
    return true;
  });
  await assert.rejects(run(['help', 'frobnicate']), (e) => {
    assert.match(e.stderr, /unknown command: frobnicate/);
    return true;
  });
});

test('a ref for a session that does not exist is a plain not-found', async () => {
  await assert.rejects(run(['read', 'zzzz-no-such-session']), (e) => {
    assert.match(e.stderr, /Session not found|not found/i);
    assert.equal(/unknown host/.test(e.stderr), false);
    return true;
  });
});
